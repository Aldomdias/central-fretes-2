import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { parseNumeroPlanilha } from '../utils/parseNumeroPlanilha';
import { assumirSolicitacaoCentral, criarSolicitacaoCentralNegociacao } from './centralSolicitacoesService';

const TABELA = 'transporte_autorizacoes';

const soDigitos = (valor) => String(valor || '').replace(/\D/g, '');
const numero = (valor) => Number(valor || 0) || 0;

function exigirClient() {
  if (!isSupabaseConfigured()) throw new Error('Supabase nao configurado.');
  return getSupabaseClient();
}

export function normalizarCanalAutorizacao(canal) {
  const texto = String(canal || '').toUpperCase();
  if (texto.includes('SUPRIMENTOS')) return 'SUPRIMENTOS';
  return texto.includes('B2C') ? 'B2C' : 'ATACADO';
}

// Analise do frete pra quem decide: frete atual (calculado pela AMD), quanto
// vira com o adicional cobrado e quanto isso pesa sobre o valor da NF.
export function analisarFrete({ valor_nf: valorNf, valor_calculado: calculado, valor_divergente: adicional, valor_cte: cobrado } = {}) {
  const nf = numero(valorNf);
  const atual = numero(calculado);
  const extra = numero(adicional);
  const comAdicional = atual > 0 ? atual + extra : numero(cobrado);
  const pct = (valor) => (nf > 0 ? (valor / nf) * 100 : null);
  return { valorNf: nf, freteAtual: atual, adicional: extra, freteComAdicional: comAdicional, pctAtual: atual > 0 ? pct(atual) : null, pctComAdicional: pct(comAdicional) };
}

export const formatarPct = (valor) => (valor == null ? '-' : `${valor.toFixed(2).replace('.', ',')}%`);

export async function listarAutorizacoes({ canal, status } = {}) {
  let query = exigirClient().from(TABELA).select('*').eq('ativo', true).order('enviado_em', { ascending: false }).limit(2000);
  if (canal) query = query.eq('canal', canal);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw new Error(`Erro ao listar autorizacoes: ${error.message}. Rode a migration 20260923_003_transporte_autorizacoes.sql.`);
  return data || [];
}

// Pedido (Marketplace) e chave da NF de cada CT-e, pela base (tracking primeiro,
// realizado como reserva). Quem autoriza precisa desses dados na tela.
export async function buscarVinculoPorCte(chavesCte = []) {
  const mapa = new Map();
  const chaves = [...new Set(chavesCte.map(soDigitos).filter(Boolean))];
  if (!chaves.length || !isSupabaseConfigured()) return mapa;
  const client = getSupabaseClient();
  // Cada fonte roda isolada: se uma consulta falhar, as outras seguem (antes um
  // erro no select do tracking zerava tudo em silencio).
  const mesclar = (chaveCte, { chaveNfe, pedido }) => {
    const chave = soDigitos(chaveCte);
    if (!chave) return;
    const atual = mapa.get(chave) || { chaveNfe: '', pedido: '' };
    mapa.set(chave, { chaveNfe: atual.chaveNfe || soDigitos(chaveNfe), pedido: atual.pedido || pedido || '' });
  };
  const tentar = async (rotulo, fn) => {
    try { await fn(); } catch (error) { console.warn(`[Autorizacoes transporte] vinculo (${rotulo}) indisponivel.`, error?.message || error); }
  };
  for (let i = 0; i < chaves.length; i += 100) {
    const lote = chaves.slice(i, i + 100);
    await tentar('marketplace', async () => {
      const { data } = await client.from('tracking_pedido_marketplace_map').select('pedido_marketplace,chave_cte,pedido_erp').in('chave_cte', lote);
      (data || []).forEach((row) => mesclar(row.chave_cte, { pedido: row.pedido_marketplace || row.pedido_erp }));
    });
    await tentar('tracking', async () => {
      const { data } = await client.from('tracking_rows').select('id,chave_cte,chave_nfe,pedido,pedido_erp').in('chave_cte', lote);
      (data || []).forEach((row) => {
        const doId = String(row.id || '').startsWith('nf-') ? soDigitos(String(row.id).slice(3)) : '';
        mesclar(row.chave_cte, { chaveNfe: row.chave_nfe || (doId.length === 44 ? doId : ''), pedido: row.pedido_erp || row.pedido });
      });
    });
    const faltamNfe = lote.filter((chave) => !mapa.get(chave)?.chaveNfe);
    if (faltamNfe.length) {
      await tentar('realizado', async () => {
        const { data } = await client.from('realizado_local_ctes').select('chave_cte,chave_nfe').in('chave_cte', faltamNfe);
        (data || []).forEach((row) => mesclar(row.chave_cte, { chaveNfe: row.chave_nfe }));
      });
    }
  }
  return mapa;
}

// Canal real (B2C/Atacado) de cada CT-e pela base do realizado. Na fila de
// Suprimentos o canal do registro e "SUPRIMENTOS", entao o real vem daqui.
export async function buscarCanalPorCte(chavesCte = []) {
  const mapa = new Map();
  const chaves = [...new Set(chavesCte.map(soDigitos).filter(Boolean))];
  if (!chaves.length || !isSupabaseConfigured()) return mapa;
  const client = getSupabaseClient();
  try {
    for (let i = 0; i < chaves.length; i += 100) {
      const { data } = await client.from('realizado_local_ctes').select('chave_cte,canal').in('chave_cte', chaves.slice(i, i + 100));
      (data || []).forEach((row) => { if (row.canal) mapa.set(soDigitos(row.chave_cte), String(row.canal).toUpperCase()); });
    }
  } catch (error) {
    console.warn('[Autorizacoes] canal por CT-e indisponivel.', error?.message || error);
  }
  return mapa;
}

// Preenche pedido/NF que faltam nos itens da fila (enviados antes do vinculo).
export async function completarVinculosPendentes(itens = []) {
  const incompletos = itens.filter((item) => item.chave_cte && (!item.numero_pedido || !item.chave_nfe));
  if (!incompletos.length) return 0;
  const vinculos = await buscarVinculoPorCte(incompletos.map((item) => item.chave_cte));
  let atualizados = 0;
  for (const item of incompletos) {
    const achado = vinculos.get(soDigitos(item.chave_cte));
    const patch = {};
    if (!item.numero_pedido && achado?.pedido) patch.numero_pedido = achado.pedido;
    if (!item.chave_nfe && achado?.chaveNfe) patch.chave_nfe = achado.chaveNfe;
    if (!Object.keys(patch).length) continue;
    const { error } = await exigirClient().from(TABELA).update(patch).eq('id', item.id);
    if (!error) atualizados += 1;
  }
  return atualizados;
}

// Auditoria -> fila do gestor do canal. Nao duplica CT-e que ja esta na fila
// (PENDENTE) ou ja autorizado.
export async function enviarParaAutorizacao(itens = [], usuarioNome = '') {
  const client = exigirClient();
  const chaves = itens.map((item) => soDigitos(item.chave_cte)).filter(Boolean);
  let existentes = new Set();
  if (chaves.length) {
    const { data, error } = await client.from(TABELA).select('chave_cte').eq('ativo', true).in('status', ['PENDENTE', 'AUTORIZADA']).in('chave_cte', chaves);
    if (error) throw new Error(`Erro ao verificar fila: ${error.message}`);
    existentes = new Set((data || []).map((row) => row.chave_cte));
  }
  const vinculos = await buscarVinculoPorCte(itens.filter((item) => !item.numero_pedido || !item.chave_nfe).map((item) => item.chave_cte));
  const novos = itens
    .filter((item) => soDigitos(item.chave_cte) || soDigitos(item.chave_nfe))
    .filter((item) => !existentes.has(soDigitos(item.chave_cte)))
    .map((item) => ({
      canal: normalizarCanalAutorizacao(item.canal),
      origem: 'AUDITORIA',
      status: 'PENDENTE',
      chave_cte: soDigitos(item.chave_cte) || null,
      chave_nfe: soDigitos(item.chave_nfe) || vinculos.get(soDigitos(item.chave_cte))?.chaveNfe || null,
      numero_pedido: item.numero_pedido || vinculos.get(soDigitos(item.chave_cte))?.pedido || null,
      transportadora: item.transportadora || null,
      cidade_origem: item.cidade_origem || null,
      cidade_destino: item.cidade_destino || null,
      valor_nf: numero(item.valor_nf),
      valor_cte: numero(item.valor_cte),
      valor_calculado: numero(item.valor_calculado),
      valor_divergente: numero(item.valor_divergente),
      observacao_auditoria: item.observacao || null,
      enviado_por: usuarioNome || null,
      fatura_id: item.fatura_id || null,
    }));
  if (novos.length) {
    const { error } = await client.from(TABELA).insert(novos);
    if (error) throw new Error(`Erro ao enviar para autorizacao: ${error.message}`);
  }
  return { enviados: novos.length, jaNaFila: itens.length - novos.length };
}

// Suprimentos identifica que o caso nao e dele: passa a solicitacao pendente pra
// fila do transporte (B2C ou Atacado). O motivo fica no historico da observacao.
export async function transferirParaTransporte(itens = [], { destino, motivo, usuarioNome } = {}) {
  const canalDestino = String(destino || '').toUpperCase();
  if (!['B2C', 'ATACADO'].includes(canalDestino)) throw new Error('Escolha o destino: B2C ou Atacado.');
  if (!String(motivo || '').trim()) throw new Error('Informe o motivo da transferencia.');
  const quando = new Date().toLocaleString('pt-BR');
  for (const item of itens) {
    const nota = `[Transferido de ${item.canal === 'SUPRIMENTOS' ? 'Suprimentos' : item.canal} para ${canalDestino} por ${usuarioNome || '-'} em ${quando}: ${String(motivo).trim()}]`;
    const { error } = await exigirClient().from(TABELA).update({
      canal: canalDestino,
      observacao_auditoria: [item.observacao_auditoria, nota].filter(Boolean).join(' '),
    }).eq('id', item.id).eq('status', 'PENDENTE');
    if (error) throw new Error(`Erro ao transferir: ${error.message}`);
  }
  return { transferidos: itens.length, destino: canalDestino };
}

export async function decidirAutorizacao({ id, autorizar, valorAutorizado, observacao, usuarioNome, item = null }) {
  const { error } = await exigirClient().from(TABELA).update({
    status: autorizar ? 'AUTORIZADA' : 'RECUSADA',
    valor_autorizado: autorizar ? numero(valorAutorizado) : 0,
    observacao_gestor: observacao || null,
    decidido_por: usuarioNome || null,
    decidido_em: new Date().toISOString(),
  }).eq('id', id);
  if (error) throw new Error(`Erro ao registrar decisao: ${error.message}`);
  // Suprimentos: quem aprova o valor assume o chamado AMD (vai corrigir a tabela depois).
  let chamadoAssumido = false;
  if (autorizar && item?.canal === 'SUPRIMENTOS' && item?.protocolo_amd) {
    try {
      const res = await assumirSolicitacaoCentral(item.protocolo_amd, {
        responsavel: usuarioNome,
        mensagem: `Valor de ${numero(valorAutorizado).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} aprovado por ${usuarioNome} (CT-e ${item.chave_cte || item.chave_nfe}). Justificativa: ${observacao}. Chamado assumido pra corrigir a tabela.`,
      });
      chamadoAssumido = Boolean(res?.ok);
    } catch (erroChamado) {
      console.warn('[Suprimentos] chamado nao assumido.', erroChamado?.message || erroChamado);
    }
  }
  return { chamadoAssumido };
}

// Auditor -> Suprimentos: abre um chamado AMD (Central de Solicitacoes) e coloca
// os CT-es na fila do modulo Suprimentos pra aprovar o valor.
// `autorizadoPor`: a gestao (Aprovacao de Gestao) ja aprovou o valor; entra na fila
// como AUTORIZADA (saldo ja vale na auditoria) e Suprimentos so assume o chamado.
const BUCKET_ANEXOS = 'autorizacoes-anexos';
const LIMITE_ANEXO_MB = 20;

// Sobe os arquivos (File) pro Storage e devolve [{nome, tamanho, path, url}].
export async function enviarAnexosAutorizacao(arquivos = []) {
  const client = exigirClient();
  const pasta = `${new Date().toISOString().slice(0, 10)}/${Math.random().toString(36).slice(2, 10)}`;
  const anexos = [];
  for (const arquivo of arquivos) {
    if (arquivo.size > LIMITE_ANEXO_MB * 1024 * 1024) throw new Error(`O arquivo "${arquivo.name}" passa de ${LIMITE_ANEXO_MB} MB.`);
    const nomeSeguro = arquivo.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${pasta}/${nomeSeguro}`;
    const { error } = await client.storage.from(BUCKET_ANEXOS).upload(path, arquivo, { upsert: false, contentType: arquivo.type || undefined });
    if (error) throw new Error(`Erro ao anexar "${arquivo.name}": ${error.message}. Rode a migration 20260925_002_autorizacoes_anexos.sql.`);
    const { data } = client.storage.from(BUCKET_ANEXOS).getPublicUrl(path);
    anexos.push({ nome: arquivo.name, tamanho: arquivo.size, path, url: data?.publicUrl || '' });
  }
  return anexos;
}

export async function enviarParaSuprimentos(itens = [], { tipoAjuste, justificativa, usuarioNome, usuarioEmail, autorizadoPor = '', anexos = [] } = {}) {
  if (!itens.length) throw new Error('Selecione ao menos um CT-e.');
  if (!autorizadoPor && !anexos.length) throw new Error('Anexe ao menos um arquivo (tabela, lista de TDE ou documento de apoio).');
  if (String(justificativa || '').trim().length < 30) throw new Error('Justificativa muito curta — explique bem a diferenca (minimo 30 caracteres).');
  const client = exigirClient();
  const transportadoras = [...new Set(itens.map((item) => item.transportadora).filter(Boolean))];
  const linhas = itens.map((item) => `- CT-e ${item.chave_cte || item.chave_nfe || '-'} | ${item.transportadora || '-'} | NF ${numero(item.valor_nf).toFixed(2)} | pago ${numero(item.valor_cte).toFixed(2)} | calculado ${numero(item.valor_calculado).toFixed(2)} (${formatarPct(analisarFrete(item).pctAtual)} da NF) | diferenca ${numero(item.valor_divergente).toFixed(2)} | frete com adicional ${formatarPct(analisarFrete(item).pctComAdicional)} da NF`);
  let protocolo = null;
  const chamado = await criarSolicitacaoCentralNegociacao({
    tipoSolicitacao: 'AJUSTE DE TABELA',
    tipoAjuste: tipoAjuste || 'Outro ajuste de tabela',
    area: 'Suprimentos',
    nome: usuarioNome,
    email: usuarioEmail,
    transportadora: transportadoras.join(', '),
    assunto: `${tipoAjuste || 'Ajuste de tabela'} — ${transportadoras.join(', ')} (${itens.length} CT-e)`,
    descricao: `Diferenca identificada pela Auditoria de Fretes.${autorizadoPor ? `\n\nValor JA AUTORIZADO pela gestao (${autorizadoPor}) e lancado na auditoria; Suprimentos deve assumir o chamado e ajustar a tabela.` : ''}\n\nJustificativa:\n${justificativa.trim()}\n\nCT-es:\n${linhas.join('\n')}${anexos.length ? `\n\nAnexos:\n${anexos.map((a) => `- ${a.nome}: ${a.url}`).join('\n')}` : ''}`,
    mensagemStatus: 'Aberta pela Auditoria de Fretes; aguardando aprovacao do valor em Suprimentos.',
  });
  if (chamado?.ok) protocolo = chamado.solicitacao?.protocolo || null;
  const vinculos = await buscarVinculoPorCte(itens.map((item) => item.chave_cte));
  const novos = itens.map((item) => ({
    canal: 'SUPRIMENTOS',
    origem: 'AUDITORIA',
    status: autorizadoPor ? 'AUTORIZADA' : 'PENDENTE',
    ...(autorizadoPor ? { valor_autorizado: numero(item.valor_divergente), decidido_por: autorizadoPor, decidido_em: new Date().toISOString(), observacao_gestor: justificativa.trim() } : {}),
    chave_cte: soDigitos(item.chave_cte) || null,
    chave_nfe: soDigitos(item.chave_nfe) || vinculos.get(soDigitos(item.chave_cte))?.chaveNfe || null,
    numero_pedido: item.numero_pedido || vinculos.get(soDigitos(item.chave_cte))?.pedido || null,
    transportadora: item.transportadora || null,
    cidade_origem: item.cidade_origem || null,
    cidade_destino: item.cidade_destino || null,
    valor_nf: numero(item.valor_nf),
    valor_cte: numero(item.valor_cte),
    valor_calculado: numero(item.valor_calculado),
    valor_divergente: numero(item.valor_divergente),
    observacao_auditoria: justificativa.trim(),
    enviado_por: usuarioNome || null,
    fatura_id: item.fatura_id || null,
    protocolo_amd: protocolo,
    tipo_ajuste: tipoAjuste || null,
    ...(anexos.length ? { anexos } : {}),
  })).filter((item) => item.chave_cte || item.chave_nfe);
  if (!novos.length) throw new Error('Nenhum CT-e com chave valida para enviar.');
  const { error } = await client.from(TABELA).insert(novos);
  if (error) throw new Error(`Erro ao enviar para Suprimentos: ${error.message}. Rode as migrations 20260924_002_transporte_autorizacoes_suprimentos.sql e 20260925_001_autorizacoes_valor_nf.sql.`);
  return { enviados: novos.length, protocolo };
}

// Liga chave do CT-e, chave da NF e pedido usando a base (tracking e realizado),
// pra o saldo lancado por qualquer um dos tres ja ficar vinculado ao CT-e — a
// auditoria depois so casa pela chave do CT-e, sem mexer em mais nada.
async function resolverVinculo({ chaveCte, chaveNfe, pedido }) {
  const client = exigirClient();
  const achado = { chaveCte: chaveCte || '', chaveNfe: chaveNfe || '', pedido: pedido || '' };
  const buscar = async (tabela, coluna, valor, select) => {
    const { data } = await client.from(tabela).select(select).eq(coluna, valor).limit(1);
    return data?.[0] || null;
  };
  try {
    let linha = null;
    if (chaveNfe) linha = await buscar('tracking_rows', 'chave_nfe', chaveNfe, 'chave_cte,chave_nfe,pedido,pedido_erp');
    if (!linha && chaveNfe) linha = await buscar('realizado_local_ctes', 'chave_nfe', chaveNfe, 'chave_cte,chave_nfe');
    if (!linha && chaveCte) linha = await buscar('tracking_rows', 'chave_cte', chaveCte, 'chave_cte,chave_nfe,pedido,pedido_erp');
    if (!linha && chaveCte) linha = await buscar('realizado_local_ctes', 'chave_cte', chaveCte, 'chave_cte,chave_nfe');
    if (!linha && pedido) {
      // "Numero do pedido" = Pedido Marketplace (o que a operacao usa); aceita tambem o ERP.
      const mapaMk = await buscar('tracking_pedido_marketplace_map', 'pedido_marketplace', pedido, 'chave_cte,pedido_marketplace');
      if (mapaMk?.chave_cte) linha = await buscar('tracking_rows', 'chave_cte', mapaMk.chave_cte, 'chave_cte,chave_nfe,pedido,pedido_erp') || { chave_cte: mapaMk.chave_cte };
      if (!linha) linha = await buscar('tracking_rows', 'pedido_erp', pedido, 'chave_cte,chave_nfe,pedido,pedido_erp')
        || await buscar('tracking_rows', 'pedido', pedido, 'chave_cte,chave_nfe,pedido,pedido_erp');
    }
    if (linha) {
      achado.chaveCte = achado.chaveCte || soDigitos(linha.chave_cte);
      achado.chaveNfe = achado.chaveNfe || soDigitos(linha.chave_nfe);
      achado.pedido = achado.pedido || linha.pedido_erp || linha.pedido || '';
    }
  } catch (error) {
    console.warn('[Autorizacoes transporte] vinculo nao resolvido; segue com o que foi informado.', error?.message || error);
  }
  return achado;
}

// Gestor lanca a autorizacao antes da auditoria (chave do CT-e, da NF ou pedido).
export async function lancarSaldoAntecipado({ canal, chaveCte, chaveNfe, numeroPedido, valor, observacao, usuarioNome }) {
  const informado = { chaveCte: soDigitos(chaveCte), chaveNfe: soDigitos(chaveNfe), pedido: String(numeroPedido || '').replace(/^#/, '').trim() };
  if (!informado.chaveCte && !informado.chaveNfe && !informado.pedido) throw new Error('Informe a chave do CT-e, da nota fiscal ou o numero do pedido.');
  if (!(numero(valor) > 0)) throw new Error('Informe o valor autorizado.');
  const vinculo = await resolverVinculo(informado);
  if (!vinculo.chaveCte && !vinculo.chaveNfe) throw new Error('Pedido nao encontrado no tracking — informe a chave do CT-e ou da nota.');
  const agora = new Date().toISOString();
  const { error } = await exigirClient().from(TABELA).insert({
    canal: normalizarCanalAutorizacao(canal),
    origem: 'GESTOR',
    status: 'AUTORIZADA',
    chave_cte: vinculo.chaveCte || null,
    chave_nfe: vinculo.chaveNfe || null,
    numero_pedido: vinculo.pedido || null,
    valor_autorizado: numero(valor),
    observacao_gestor: observacao || null,
    enviado_por: usuarioNome || null,
    decidido_por: usuarioNome || null,
    decidido_em: agora,
  });
  if (error) throw new Error(`Erro ao lancar saldo: ${error.message}`);
  return { vinculadoCte: Boolean(vinculo.chaveCte), chaveCte: vinculo.chaveCte, chaveNfe: vinculo.chaveNfe, pedido: vinculo.pedido };
}

// Gestao (Aprovacao de Gestao) aprova a fatura SEM desconto: o adicional de cada
// CT-e vira saldo AUTORIZADO (mesma tabela) e a auditoria passa a considerar.
export async function autorizarPelaGestao(itens = [], { observacao, usuarioNome } = {}) {
  const validos = itens.filter((item) => (soDigitos(item.chave_cte) || soDigitos(item.chave_nfe)) && numero(item.valor_divergente) > 0);
  if (!validos.length) return { autorizados: 0 };
  const agora = new Date().toISOString();
  const { error } = await exigirClient().from(TABELA).insert(validos.map((item) => ({
    canal: normalizarCanalAutorizacao(item.canal),
    origem: 'GESTOR',
    status: 'AUTORIZADA',
    chave_cte: soDigitos(item.chave_cte) || null,
    chave_nfe: soDigitos(item.chave_nfe) || null,
    numero_pedido: item.numero_pedido || null,
    transportadora: item.transportadora || null,
    cidade_origem: item.cidade_origem || null,
    cidade_destino: item.cidade_destino || null,
    valor_nf: numero(item.valor_nf),
    valor_cte: numero(item.valor_cte),
    valor_calculado: numero(item.valor_calculado),
    valor_divergente: numero(item.valor_divergente),
    valor_autorizado: numero(item.valor_divergente),
    observacao_gestor: observacao || 'Autorizado na Aprovacao de Gestao (fatura sem desconto).',
    enviado_por: usuarioNome || null,
    decidido_por: usuarioNome || null,
    decidido_em: agora,
    fatura_id: item.fatura_id || null,
  })));
  if (error) throw new Error(`Erro ao registrar autorizacao da gestao: ${error.message}. Rode a migration 20260925_001_autorizacoes_valor_nf.sql.`);
  return { autorizados: validos.length };
}

export async function desativarAutorizacao(id) {
  const { error } = await exigirClient().from(TABELA).update({ ativo: false }).eq('id', id);
  if (error) throw new Error(`Erro ao remover autorizacao: ${error.message}`);
}

// Decisoes do gestor (autorizou/recusou/na fila) por chave de CT-e ou NF, com
// justificativa e quem decidiu — pra mostrar no CT-e (tooltip da coluna Saldo).
export async function carregarDecisoesPorChave(chaves = []) {
  const mapa = new Map();
  if (!isSupabaseConfigured()) return mapa;
  const unicas = [...new Set(chaves.map(soDigitos).filter(Boolean))];
  const client = getSupabaseClient();
  try {
    for (let inicio = 0; inicio < unicas.length; inicio += 150) {
      const lote = unicas.slice(inicio, inicio + 150).join(',');
      const { data, error } = await client.from(TABELA)
        .select('id, canal, status, chave_cte, chave_nfe, valor_autorizado, valor_divergente, observacao_gestor, observacao_auditoria, decidido_por, decidido_em, enviado_por, enviado_em')
        .eq('ativo', true)
        .or(`chave_cte.in.(${lote}),chave_nfe.in.(${lote})`)
        .order('enviado_em', { ascending: false });
      if (error) throw error;
      (data || []).forEach((row) => {
        [row.chave_cte, row.chave_nfe].filter(Boolean).forEach((chave) => {
          if (!unicas.includes(chave)) return;
          const lista = mapa.get(chave) || [];
          if (!lista.some((item) => item.id === row.id)) lista.push(row);
          mapa.set(chave, lista);
        });
      });
    }
  } catch (error) {
    console.warn('[Autorizacoes transporte] decisoes indisponiveis.', error?.message || error);
  }
  return mapa;
}

// Saldo autorizado por chave (CT-e ou NF), somando se houver mais de uma.
// Retorna Map<chaveSoDigitos, valor>. Falha aqui nunca pode travar a auditoria.
export async function carregarSaldosAutorizadosPorChave(chaves = []) {
  const mapa = new Map();
  if (!isSupabaseConfigured()) return mapa;
  const unicas = [...new Set(chaves.map(soDigitos).filter(Boolean))];
  const client = getSupabaseClient();
  try {
    for (let inicio = 0; inicio < unicas.length; inicio += 150) {
      const lote = unicas.slice(inicio, inicio + 150).join(',');
      const { data, error } = await client.from(TABELA)
        .select('chave_cte, chave_nfe, valor_autorizado')
        .eq('ativo', true).eq('status', 'AUTORIZADA')
        .or(`chave_cte.in.(${lote}),chave_nfe.in.(${lote})`);
      if (error) throw error;
      (data || []).forEach((row) => {
        const chave = row.chave_cte && unicas.includes(row.chave_cte) ? row.chave_cte : row.chave_nfe;
        if (chave) mapa.set(chave, numero(mapa.get(chave)) + numero(row.valor_autorizado));
      });
    }
  } catch (error) {
    console.warn('[Autorizacoes transporte] saldos indisponiveis; seguindo sem eles.', error?.message || error);
  }
  return mapa;
}

// ---- Importacao da planilha "custos-aprovado" (fluxo do time de transporte) ----
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function dataBR(texto) {
  const m = String(texto || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 12), Number(m[5] || 0));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Acha chave do CT-e / NF pela OP (pedido) ou pelo numero da NF (+ valor da NF).
async function resolverLinhaPlanilha(client, { op, nf, valorNf }) {
  const tentar = async (fn) => { try { return await fn(); } catch { return null; } };
  const cols = 'id,chave_cte,chave_nfe,nota_fiscal,valor_nf,pedido,pedido_erp';
  let linha = null;
  if (op) {
    const mapa = await tentar(async () => (await client.from('tracking_pedido_marketplace_map').select('pedido_marketplace,chave_cte').eq('pedido_marketplace', op).limit(1)).data?.[0]);
    if (mapa?.chave_cte) linha = (await tentar(async () => (await client.from('tracking_rows').select(cols).eq('chave_cte', mapa.chave_cte).limit(1)).data?.[0])) || { chave_cte: mapa.chave_cte };
    if (!linha) linha = await tentar(async () => (await client.from('tracking_rows').select(cols).eq('pedido_erp', op).limit(1)).data?.[0]);
    if (!linha) linha = await tentar(async () => (await client.from('tracking_rows').select(cols).eq('pedido', op).limit(1)).data?.[0]);
  }
  if (!linha && nf) {
    const lista = (await tentar(async () => (await client.from('tracking_rows').select(cols).eq('nota_fiscal', nf).limit(50)).data)) || [];
    const porValor = valorNf > 0 ? lista.filter((r) => Math.abs(numero(r.valor_nf) - valorNf) < 0.02) : [];
    linha = porValor[0] || (lista.length === 1 ? lista[0] : null);
  }
  if (!linha) return { chaveCte: '', chaveNfe: '', pedido: op || '' };
  const doId = String(linha.id || '').startsWith('nf-') ? soDigitos(String(linha.id).slice(3)) : '';
  return {
    chaveCte: soDigitos(linha.chave_cte),
    chaveNfe: soDigitos(linha.chave_nfe) || (doId.length === 44 ? doId : ''),
    pedido: op || linha.pedido_erp || linha.pedido || '',
  };
}

export const MARCA_IMPORTACAO = '[IMPORTADO-PLANILHA]';

// Fonte de cada registro, pra nao misturar no historico: planilha do atacado,
// aprovacao da gestao (fatura), lancamento do gestor ou fila da auditoria.
export function fonteAutorizacao(item = {}) {
  if (String(item.observacao_auditoria || '').startsWith(MARCA_IMPORTACAO)) return 'IMPORTADO';
  if (item.origem === 'GESTOR' && (item.fatura_id || /Aprovacao de Gestao/i.test(item.observacao_gestor || ''))) return 'GESTAO';
  return item.origem === 'GESTOR' ? 'LANCADO' : 'AUDITORIA';
}

// linhas = objetos da planilha (NF, OP, Custo (R$), Valor NF (R$), Status, ...).
// Cria/atualiza as autorizacoes do canal ja decididas (AUTORIZADA/RECUSADA).
export async function importarAprovacoesPlanilha(linhas = [], { canal, usuarioNome = '', onProgress } = {}) {
  const client = exigirClient();
  const canalAlvo = normalizarCanalAutorizacao(canal);
  // A planilha de aprovacoes e so do atacado: nunca entra em B2C/Suprimentos.
  if (canalAlvo !== 'ATACADO') throw new Error('A importacao da planilha e so para o canal Atacado.');
  const resumo = { importadas: 0, atualizadas: 0, jaExistiam: 0, foraDoCanal: 0, pendentes: 0, semVinculo: [], erros: [] };
  const existentes = await listarAutorizacoes({ canal: canalAlvo });
  const porCte = new Map();
  existentes.forEach((item) => { if (item.chave_cte) porCte.set(soDigitos(item.chave_cte), item); });
  const pega = (linha, nome) => {
    const chave = Object.keys(linha).find((k) => semAcento(k) === semAcento(nome));
    return chave ? linha[chave] : '';
  };
  const validas = linhas.filter((l) => l && Object.values(l).some((v) => String(v || '').trim()));
  for (let i = 0; i < validas.length; i += 6) {
    onProgress?.(i, validas.length);
    await Promise.all(validas.slice(i, i + 6).map(async (linha) => {
      const rotuloLinha = `NF ${pega(linha, 'NF') || '-'} / OP ${pega(linha, 'OP') || '-'}`;
      try {
        const status = semAcento(pega(linha, 'Status'));
        const statusNovo = status.startsWith('aprov') ? 'AUTORIZADA' : (status.startsWith('rejeit') || status.startsWith('recus')) ? 'RECUSADA' : '';
        if (!statusNovo) { resumo.pendentes += 1; return; }
        const canalLinha = semAcento(pega(linha, 'Canal')).includes('b2c') ? 'B2C' : 'ATACADO';
        if (canalLinha !== canalAlvo) { resumo.foraDoCanal += 1; return; }
        const nf = String(pega(linha, 'NF') || '').replace(/\D/g, '').replace(/^0+/, '');
        const op = String(pega(linha, 'OP') || '').replace(/^#/, '').trim();
        const custo = numero(parseNumeroPlanilha(pega(linha, 'Custo (R$)'), 0));
        const valorNf = numero(parseNumeroPlanilha(pega(linha, 'Valor NF (R$)'), 0));
        const vinculo = await resolverLinhaPlanilha(client, { op, nf, valorNf });
        if (!vinculo.chaveCte && !vinculo.chaveNfe) { resumo.semVinculo.push(rotuloLinha); return; }
        const decididoPor = String(pega(linha, 'Aprovado/Rejeitado por') || '').trim() || usuarioNome;
        const decididoEm = dataBR(pega(linha, 'Data Decisão')) || dataBR(pega(linha, 'Data')) || new Date().toISOString();
        const motivo = [pega(linha, 'Motivo do Erro'), pega(linha, 'Classificação')].filter(Boolean).join(' - ');
        const obs = [pega(linha, 'Observações'), statusNovo === 'RECUSADA' ? pega(linha, 'Motivo Rejeição') : ''].map((t) => String(t || '').trim()).filter(Boolean).join(' | ');
        const campos = {
          status: statusNovo,
          valor_autorizado: statusNovo === 'AUTORIZADA' ? custo : 0,
          observacao_gestor: obs || null,
          decidido_por: decididoPor || null,
          decidido_em: decididoEm,
        };
        const atual = vinculo.chaveCte ? porCte.get(vinculo.chaveCte) : null;
        if (atual && atual.status !== 'PENDENTE') { resumo.jaExistiam += 1; return; }
        if (atual) {
          const { error } = await client.from(TABELA).update({ ...campos, chave_nfe: atual.chave_nfe || vinculo.chaveNfe || null, numero_pedido: atual.numero_pedido || vinculo.pedido || null }).eq('id', atual.id);
          if (error) throw error;
          resumo.atualizadas += 1;
          return;
        }
        const registro = {
          ...campos,
          canal: canalAlvo,
          origem: 'GESTOR',
          chave_cte: vinculo.chaveCte || null,
          chave_nfe: vinculo.chaveNfe || null,
          numero_pedido: vinculo.pedido || null,
          transportadora: String(pega(linha, 'Transportadora') || '').trim() || null,
          valor_nf: valorNf,
          observacao_auditoria: `${MARCA_IMPORTACAO} ${motivo}`.trim(),
          enviado_por: usuarioNome || decididoPor || null,
          enviado_em: dataBR(pega(linha, 'Data')) || decididoEm,
        };
        const { error } = await client.from(TABELA).insert(registro);
        if (error) throw error;
        if (vinculo.chaveCte) porCte.set(vinculo.chaveCte, { ...registro });
        resumo.importadas += 1;
      } catch (error) {
        resumo.erros.push(`${rotuloLinha}: ${error?.message || error}`);
      }
    }));
  }
  onProgress?.(validas.length, validas.length);
  return resumo;
}

// Auditor/gestor informa a chave da NF quando o tracking nao trouxe. Tenta tambem
// completar o pedido pela propria chave.
export async function salvarChaveNfe(item, chaveNfe) {
  const client = exigirClient();
  const chave = soDigitos(chaveNfe);
  if (chave.length !== 44) throw new Error('A chave da NF precisa ter 44 digitos.');
  const patch = { chave_nfe: chave };
  if (!item.numero_pedido) {
    try {
      const { data } = await client.from('tracking_rows').select('pedido_erp,pedido').eq('chave_nfe', chave).limit(1);
      const achado = data?.[0]?.pedido_erp || data?.[0]?.pedido;
      if (achado) patch.numero_pedido = achado;
    } catch { /* pedido segue vazio */ }
  }
  const { error } = await client.from(TABELA).update(patch).eq('id', item.id);
  if (error) throw new Error('Erro ao salvar a chave da NF: ' + error.message);
}
