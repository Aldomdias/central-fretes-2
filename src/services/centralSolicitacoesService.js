import { createClient } from '@supabase/supabase-js';

const CENTRAL_SOLICITACOES_URL =
  import.meta.env.VITE_CENTRAL_SOLICITACOES_SUPABASE_URL ||
  'https://zejguyckbnmyxkuagsyj.supabase.co';

const CENTRAL_SOLICITACOES_KEY =
  import.meta.env.VITE_CENTRAL_SOLICITACOES_SUPABASE_KEY ||
  'sb_publishable_J0i_Olz3JBp_86-Xcd4MPQ_uH5vnHUS';

let client = null;

function getClient() {
  if (!CENTRAL_SOLICITACOES_URL || !CENTRAL_SOLICITACOES_KEY) return null;
  if (!client) client = createClient(CENTRAL_SOLICITACOES_URL, CENTRAL_SOLICITACOES_KEY);
  return client;
}

function normalizarProtocolo(valor) {
  return String(valor || '').trim().toUpperCase();
}

function gerarProtocoloAmd() {
  return `AMD-${Math.floor(100000 + Math.random() * 900000)}`;
}

function normalizarBusca(valor = '') {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

const STATUS_FECHADOS = new Set(['CONCLUIDA', 'CONCLUIDO', 'CANCELADA', 'CANCELADO', 'RECUSADA', 'RECUSADO']);

function solicitacaoAberta(row = {}) {
  return !STATUS_FECHADOS.has(normalizarBusca(row.status));
}

function scoreSolicitacaoNegociacao(row = {}, dados = {}) {
  const transportadora = normalizarBusca(dados.transportadora);
  const origem = normalizarBusca(dados.origem);
  const canal = normalizarBusca(dados.canal);
  const tipoAjuste = normalizarBusca(dados.tipoAjuste);
  const camposTexto = normalizarBusca([
    row.transportadora_cadastro,
    row.assunto,
    row.descricao,
    row.cidade_centro,
    row.canal,
    row.tipo_ajuste,
  ].filter(Boolean).join(' '));

  let score = 0;
  if (transportadora && normalizarBusca(row.transportadora_cadastro) === transportadora) score += 80;
  else if (transportadora && camposTexto.includes(transportadora)) score += 45;
  if (origem && normalizarBusca(row.cidade_centro) === origem) score += 20;
  else if (origem && camposTexto.includes(origem)) score += 10;
  if (canal && normalizarBusca(row.canal) === canal) score += 8;
  if (tipoAjuste && normalizarBusca(row.tipo_ajuste).includes(tipoAjuste.split(' ')[0] || tipoAjuste)) score += 5;
  return score;
}

export function centralSolicitacoesConfigurada() {
  return Boolean(getClient());
}

export async function buscarSolicitacaoCentralPorProtocolo(protocolo) {
  const supabase = getClient();
  const protocoloNorm = normalizarProtocolo(protocolo);
  if (!supabase || !protocoloNorm) return { ok: false, ignorado: true, solicitacao: null };

  const { data, error } = await supabase
    .from('solicitacoes')
    .select('id, protocolo, status, tipo_solicitacao, tipo_ajuste, assunto, descricao, transportadora_cadastro, cidade_centro, canal, data_abertura, data_ultima_atualizacao')
    .eq('protocolo', protocoloNorm)
    .maybeSingle();

  if (error) throw new Error(error.message || 'Erro ao buscar protocolo AMD na Central.');
  return { ok: Boolean(data?.id), solicitacao: data || null };
}

export async function carregarResumoCentralSolicitacoes(protocolos = []) {
  const supabase = getClient();
  if (!supabase) return { configurado: false, total: 0, porStatus: [], porTipo: [], porMes: [], protocolos: [] };

  const [listaResp, protocolosResp] = await Promise.all([
    supabase
      .from('solicitacoes')
      .select('status, tipo_solicitacao, data_abertura')
      .in('tipo_solicitacao', ['NEGOCIAÇÃO', 'GESTÃO E CADASTRO DE TABELA']),
    protocolos.length
      ? supabase
        .from('solicitacoes')
        .select('id, protocolo, status, tipo_solicitacao, assunto, transportadora_cadastro, data_abertura, data_ultima_atualizacao')
        .in('protocolo', [...new Set(protocolos.map(normalizarProtocolo).filter(Boolean))])
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (listaResp.error) throw new Error(listaResp.error.message || 'Erro ao carregar a Central de Solicitações.');
  if (protocolosResp.error) throw new Error(protocolosResp.error.message || 'Erro ao cruzar protocolos AMD.');

  const linhas = listaResp.data || [];
  const agrupar = (campo) => {
    const mapa = new Map();
    linhas.forEach((row) => {
      const chave = row[campo] || 'Não informado';
      mapa.set(chave, (mapa.get(chave) || 0) + 1);
    });
    return [...mapa.entries()]
      .map(([nome, qtd]) => ({ nome, qtd }))
      .sort((a, b) => b.qtd - a.qtd);
  };

  const mapaMes = new Map();
  linhas.forEach((row) => {
    const mes = String(row.data_abertura || '').slice(0, 7);
    if (!mes) return;
    mapaMes.set(mes, (mapaMes.get(mes) || 0) + 1);
  });
  const porMes = [...mapaMes.entries()]
    .map(([mes, qtd]) => ({ mes, qtd }))
    .sort((a, b) => a.mes.localeCompare(b.mes));

  return {
    configurado: true,
    total: linhas.length,
    porStatus: agrupar('status'),
    porTipo: agrupar('tipo_solicitacao'),
    porMes,
    protocolos: protocolosResp.data || [],
  };
}

export async function carregarSolicitacoesDetalhado() {
  const supabase = getClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('solicitacoes')
    .select('protocolo, tipo_registro, protocolo_pai, tipo_solicitacao, tipo_ajuste, status, prioridade, area, nome, email, responsavel, assunto, descricao, mensagem_status, transportadora_cadastro, cidade_centro, centro_origem, canal, data_abertura, data_ultima_atualizacao')
    .order('data_abertura', { ascending: true });

  if (error) throw new Error(error.message || 'Erro ao carregar solicitações detalhadas da Central.');
  return data || [];
}

export async function concluirSolicitacaoCentral(protocolo, dados = {}) {
  const supabase = getClient();
  const protocoloNorm = normalizarProtocolo(protocolo);
  if (!supabase || !protocoloNorm) return { ok: false, ignorado: true };

  const mensagem = [
    'Negociação finalizada na Central Fretes.',
    dados.transportadora ? `Transportadora: ${dados.transportadora}.` : '',
    dados.saving !== undefined ? `Saving: ${Number(dados.saving || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.` : '',
    dados.negociacaoId ? `Negociação: ${dados.negociacaoId}.` : '',
  ].filter(Boolean).join(' ');

  const { data, error } = await supabase
    .from('solicitacoes')
    .update({
      status: 'Concluída',
      mensagem_status: mensagem,
      data_ultima_atualizacao: new Date().toISOString(),
    })
    .eq('protocolo', protocoloNorm)
    .select('id, protocolo, status')
    .maybeSingle();

  if (error) throw new Error(error.message || 'Erro ao concluir solicitação na Central de Solicitações.');
  if (!data?.id) return { ok: false, naoEncontrada: true, protocolo: protocoloNorm };

  await supabase.from('historico_solicitacoes').insert({
    solicitacao_id: data.id,
    acao: 'Concluída via Central Fretes',
    usuario: dados.usuario || 'Central Fretes',
    mensagem,
    data_evento: new Date().toISOString(),
  });

  return { ok: true, solicitacao: data };
}

export async function atualizarSolicitacaoCentralNegociacao(protocolo, dados = {}) {
  const supabase = getClient();
  const protocoloNorm = normalizarProtocolo(protocolo);
  if (!supabase || !protocoloNorm) return { ok: false, ignorado: true };

  const partes = [
    'Negociação atualizada na Central Fretes.',
    dados.transportadora ? `Transportadora: ${dados.transportadora}.` : '',
    dados.origem ? `Origem: ${dados.origem}.` : '',
    dados.canal ? `Canal: ${dados.canal}.` : '',
    dados.status ? `Status: ${dados.status}.` : '',
    dados.statusGestao ? `Etapa gestão: ${dados.statusGestao}.` : '',
    dados.tipoNegociacao ? `Tipo: ${dados.tipoNegociacao}.` : '',
    dados.ehReajuste ? 'Fluxo: reajuste de tabela existente.' : '',
    dados.transportadoraBase ? `Base atual: ${dados.transportadoraBase}.` : '',
    dados.negociacaoId ? `Negociação: ${dados.negociacaoId}.` : '',
    dados.observacao ? `Observação: ${dados.observacao}.` : '',
  ].filter(Boolean);
  const mensagem = partes.join(' ');

  const update = {
    mensagem_status: mensagem,
    data_ultima_atualizacao: new Date().toISOString(),
  };
  if (dados.assunto !== undefined) update.assunto = dados.assunto;
  if (dados.descricao !== undefined) update.descricao = dados.descricao;
  if (dados.transportadora !== undefined) update.transportadora_cadastro = dados.transportadora || null;
  if (dados.origem !== undefined) update.cidade_centro = dados.origem || null;
  if (dados.canal !== undefined) update.canal = dados.canal || null;
  if (dados.tipoAjuste !== undefined) update.tipo_ajuste = dados.tipoAjuste || null;

  const { data, error } = await supabase
    .from('solicitacoes')
    .update(update)
    .eq('protocolo', protocoloNorm)
    .select('id, protocolo, status')
    .maybeSingle();

  if (error) throw new Error(error.message || 'Erro ao atualizar solicitação na Central de Solicitações.');
  if (!data?.id) return { ok: false, naoEncontrada: true, protocolo: protocoloNorm };

  await supabase.from('historico_solicitacoes').insert({
    solicitacao_id: data.id,
    acao: 'Atualizada via Central Fretes',
    usuario: dados.usuario || 'Central Fretes',
    mensagem,
    data_evento: new Date().toISOString(),
  });

  return { ok: true, solicitacao: data };
}

export async function criarSolicitacaoCentralNegociacao(dados = {}) {
  const supabase = getClient();
  if (!supabase) return { ok: false, ignorado: true };

  const agora = new Date().toISOString();
  const tipoSolicitacao = dados.tipoSolicitacao || 'NEGOCIAÇÃO';
  const tipoAjuste = dados.tipoAjuste || 'Nova negociação de tabela';
  const transportadora = String(dados.transportadora || '').trim();
  const origem = String(dados.origem || '').trim();
  const canal = String(dados.canal || '').trim().toUpperCase();
  const assunto = dados.assunto || [tipoAjuste, transportadora, origem].filter(Boolean).join(' - ');
  const descricao = [
    dados.descricao || 'Solicitação criada pela Central Fretes para vínculo com negociação de tabela.',
    transportadora ? `Transportadora: ${transportadora}` : '',
    origem ? `Origem: ${origem}` : '',
    canal ? `Canal: ${canal}` : '',
    dados.tipoNegociacao ? `Tipo de negociação: ${dados.tipoNegociacao}` : '',
    dados.ehReajuste ? 'Fluxo: reajuste de tabela existente.' : '',
    dados.transportadoraBase ? `Transportadora base atual: ${dados.transportadoraBase}` : '',
    dados.tabelaBase ? `Tabela oficial atual: ${dados.tabelaBase}` : '',
    dados.negociacaoId ? `Negociação Central Fretes: ${dados.negociacaoId}` : '',
    dados.observacao ? `Observação: ${dados.observacao}` : '',
  ].filter(Boolean).join('\n');

  for (let tentativa = 0; tentativa < 8; tentativa += 1) {
    const protocolo = gerarProtocoloAmd();
    const payload = {
      protocolo,
      nome: dados.nome || dados.usuario?.nome || 'Central Fretes',
      email: dados.email || dados.usuario?.email || '',
      area: dados.area || 'Suprimentos',
      tipo_solicitacao: tipoSolicitacao,
      tipo_ajuste: tipoAjuste,
      prioridade: dados.prioridade || 'Média',
      assunto,
      descricao,
      status: dados.status || 'Aberta',
      responsavel: dados.responsavel || null,
      data_abertura: agora,
      data_ultima_atualizacao: agora,
      mensagem_status: dados.mensagemStatus || 'Criada pela Central Fretes.',
      tipo_registro: 'principal',
      protocolo_pai: null,
      canal: canal || null,
      transportadora_cadastro: transportadora || null,
      cidade_centro: origem || null,
      emails_envolvidos: dados.emailsEnvolvidos || [],
      lista_ceps: [],
      usa_lista_ceps: false,
    };

    const { data, error } = await supabase
      .from('solicitacoes')
      .insert(payload)
      .select('id, protocolo, status')
      .single();

    if (!error) {
      return { ok: true, solicitacao: data };
    }

    if (error.code !== '23505') {
      throw new Error(error.message || 'Erro ao criar solicitação na Central de Solicitações.');
    }
  }

  throw new Error('Não foi possível gerar um protocolo AMD único. Tente novamente.');
}

export async function garantirSubsolicitacoesCentralNegociacao(protocoloPai, origens = [], dados = {}) {
  const supabase = getClient();
  const protocoloPaiNorm = normalizarProtocolo(protocoloPai);
  const lista = (origens || []).filter((item) => String(item?.origem || item?.label || '').trim());
  if (!supabase || !protocoloPaiNorm || lista.length <= 1) return { ok: true, ignorado: true, total: 0, subsolicitacoes: [] };

  const agora = new Date().toISOString();
  const tipoSolicitacao = dados.tipoSolicitacao || 'NEGOCIAÇÃO';
  const tipoAjuste = dados.tipoAjuste || (dados.ehReajuste ? 'Reajuste de tabela' : 'Inclusão de tabela');
  const transportadora = String(dados.transportadora || '').trim();
  const canal = String(dados.canal || '').trim().toUpperCase();

  const payload = lista.map((item, index) => {
    const origem = String(item.origem || item.label || '').trim();
    const protocolo = `${protocoloPaiNorm}.${index + 1}`;
    const assunto = [tipoAjuste, transportadora, origem].filter(Boolean).join(' - ');
    const descricao = [
      `Subsolicitação da ${protocoloPaiNorm} para acompanhar a origem ${origem}.`,
      transportadora ? `Transportadora: ${transportadora}` : '',
      origem ? `Origem: ${origem}` : '',
      canal ? `Canal: ${canal}` : '',
      dados.tipoNegociacao ? `Tipo de negociação: ${dados.tipoNegociacao}` : '',
      dados.ehReajuste ? 'Fluxo: reajuste de tabela existente.' : '',
      dados.transportadoraBase ? `Transportadora base atual: ${dados.transportadoraBase}` : '',
      item.negociacaoId ? `Negociação Central Fretes: ${item.negociacaoId}` : '',
    ].filter(Boolean).join('\n');

    return {
      protocolo,
      nome: dados.nome || dados.usuario?.nome || 'Central Fretes',
      email: dados.email || dados.usuario?.email || '',
      area: dados.area || 'Suprimentos',
      tipo_solicitacao: tipoSolicitacao,
      tipo_ajuste: tipoAjuste,
      prioridade: dados.prioridade || 'Média',
      assunto,
      descricao,
      status: dados.status || 'Aberta',
      responsavel: dados.responsavel || null,
      data_abertura: agora,
      data_ultima_atualizacao: agora,
      mensagem_status: `Subsolicitação vinculada à negociação ${item.negociacaoId || ''}.`.trim(),
      tipo_registro: 'subtarefa',
      protocolo_pai: protocoloPaiNorm,
      canal: canal || null,
      transportadora_cadastro: transportadora || null,
      cidade_centro: origem || null,
      emails_envolvidos: dados.emailsEnvolvidos || [],
      lista_ceps: [],
      usa_lista_ceps: false,
    };
  });

  const protocolos = payload.map((item) => item.protocolo);
  const existentesResp = await supabase
    .from('solicitacoes')
    .select('protocolo')
    .in('protocolo', protocolos);
  if (existentesResp.error) throw new Error(existentesResp.error.message || 'Erro ao buscar subsolicitações na Central de Solicitações.');

  const existentes = new Set((existentesResp.data || []).map((row) => normalizarProtocolo(row.protocolo)));
  const payloadInserir = payload.filter((item) => !existentes.has(normalizarProtocolo(item.protocolo)));
  if (!payloadInserir.length) {
    return { ok: true, total: 0, subsolicitacoes: [], existentes: existentes.size };
  }

  const { data, error } = await supabase
    .from('solicitacoes')
    .insert(payloadInserir)
    .select('id, protocolo, protocolo_pai, status, cidade_centro');

  if (error) throw new Error(error.message || 'Erro ao criar subsolicitações na Central de Solicitações.');
  return { ok: true, total: data?.length || 0, subsolicitacoes: data || [] };
}

export async function buscarSolicitacaoCentralNegociacaoAberta(dados = {}) {
  const supabase = getClient();
  const transportadora = String(dados.transportadora || '').trim();
  if (!supabase || !transportadora) return { ok: false, ignorado: true, solicitacao: null };

  const selectCols = 'id, protocolo, status, tipo_solicitacao, tipo_ajuste, assunto, descricao, transportadora_cadastro, cidade_centro, canal, data_abertura, data_ultima_atualizacao';
  const tiposNegociacao = ['NEGOCIAÇÃO', 'GESTÃO E CADASTRO DE TABELA', 'NEGOCIAÃ‡ÃƒO', 'GESTÃƒO E CADASTRO DE TABELA'];

  let { data, error } = await supabase
    .from('solicitacoes')
    .select(selectCols)
    .in('tipo_solicitacao', tiposNegociacao)
    .ilike('transportadora_cadastro', `%${transportadora}%`)
    .order('data_ultima_atualizacao', { ascending: false })
    .limit(20);

  if (error) throw new Error(error.message || 'Erro ao buscar solicitações abertas na Central.');

  if (!(data || []).length) {
    const fallback = await supabase
      .from('solicitacoes')
      .select(selectCols)
      .in('tipo_solicitacao', tiposNegociacao)
      .order('data_ultima_atualizacao', { ascending: false })
      .limit(80);
    if (fallback.error) throw new Error(fallback.error.message || 'Erro ao buscar solicitações abertas na Central.');
    data = fallback.data || [];
  }

  const candidatos = (data || [])
    .filter(solicitacaoAberta)
    .map((row) => ({ row, score: scoreSolicitacaoNegociacao(row, dados) }))
    .filter((item) => item.score >= 45)
    .sort((a, b) => b.score - a.score || new Date(b.row.data_ultima_atualizacao || b.row.data_abertura || 0) - new Date(a.row.data_ultima_atualizacao || a.row.data_abertura || 0));

  return { ok: true, solicitacao: candidatos[0]?.row || null, candidatos: candidatos.map((item) => item.row) };
}

export async function obterOuCriarSolicitacaoCentralNegociacao(dados = {}) {
  const encontrada = await buscarSolicitacaoCentralNegociacaoAberta(dados);
  if (encontrada?.solicitacao?.protocolo) {
    return { ok: true, encontrada: true, solicitacao: encontrada.solicitacao };
  }

  const criada = await criarSolicitacaoCentralNegociacao(dados);
  return { ...criada, encontrada: false };
}
