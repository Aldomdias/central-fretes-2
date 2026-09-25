import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
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
  try {
    for (let i = 0; i < chaves.length; i += 100) {
      const lote = chaves.slice(i, i + 100);
      const { data } = await client.from('tracking_rows').select('chave_cte,chave_nfe,pedido_erp,mk:raw->>Pedido Marketplace').in('chave_cte', lote);
      (data || []).forEach((row) => {
        const chave = soDigitos(row.chave_cte);
        const atual = mapa.get(chave) || { chaveNfe: '', pedido: '' };
        mapa.set(chave, { chaveNfe: atual.chaveNfe || soDigitos(row.chave_nfe), pedido: atual.pedido || row.mk || row.pedido_erp || '' });
      });
      const faltamNfe = lote.filter((chave) => !mapa.get(chave)?.chaveNfe);
      if (faltamNfe.length) {
        const { data: realizado } = await client.from('realizado_local_ctes').select('chave_cte,chave_nfe').in('chave_cte', faltamNfe);
        (realizado || []).forEach((row) => {
          const chave = soDigitos(row.chave_cte);
          const atual = mapa.get(chave) || { chaveNfe: '', pedido: '' };
          if (soDigitos(row.chave_nfe)) mapa.set(chave, { ...atual, chaveNfe: soDigitos(row.chave_nfe) });
        });
      }
    }
  } catch (error) {
    console.warn('[Autorizacoes transporte] vinculo por CT-e indisponivel.', error?.message || error);
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
    if (chaveNfe) linha = await buscar('tracking_rows', 'chave_nfe', chaveNfe, 'chave_cte,chave_nfe,pedido,pedido_erp,mk:raw->>Pedido Marketplace');
    if (!linha && chaveNfe) linha = await buscar('realizado_local_ctes', 'chave_nfe', chaveNfe, 'chave_cte,chave_nfe');
    if (!linha && chaveCte) linha = await buscar('tracking_rows', 'chave_cte', chaveCte, 'chave_cte,chave_nfe,pedido,pedido_erp,mk:raw->>Pedido Marketplace');
    if (!linha && chaveCte) linha = await buscar('realizado_local_ctes', 'chave_cte', chaveCte, 'chave_cte,chave_nfe');
    if (!linha && pedido) {
      // "Numero do pedido" = Pedido Marketplace (o que a operacao usa); aceita tambem o ERP.
      linha = await buscar('tracking_rows', 'raw->>Pedido Marketplace', pedido, 'chave_cte,chave_nfe,pedido,pedido_erp,mk:raw->>Pedido Marketplace')
        || await buscar('tracking_rows', 'pedido_erp', pedido, 'chave_cte,chave_nfe,pedido,pedido_erp,mk:raw->>Pedido Marketplace')
        || await buscar('tracking_rows', 'pedido', pedido, 'chave_cte,chave_nfe,pedido,pedido_erp,mk:raw->>Pedido Marketplace');
    }
    if (linha) {
      achado.chaveCte = achado.chaveCte || soDigitos(linha.chave_cte);
      achado.chaveNfe = achado.chaveNfe || soDigitos(linha.chave_nfe);
      achado.pedido = linha.mk || achado.pedido || linha.pedido_erp || linha.pedido || '';
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
