import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { aplicarReauditoriaDetalhes, ENCERRADOS, gerarProtocolo, isoDate, normalizarChaveCte } from '../utils/auditoriaFretesDomain';
import { chaveFatura } from '../utils/auditoriaFretesImport';
import { obterRaizCnpj, raizCnpjValida } from '../utils/cnpj';
import { gerarTokenAleatorio } from './auditoriaCteJornadaService';
import { carregarSaldosAutorizadosPorChave } from './transporteAutorizacoesService';

const STORAGE_KEY = 'central_fretes_plataforma_auditoria_440_v1';

function uid(prefix) {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

function demoState() {
  const faturas = [
    {
      id: 'fat-demo-1', numero_fatura: '84521', transportadora: 'Tomasi', data_emissao: addDays(-8),
      data_vencimento: addDays(2), valor_fatura: 128450.72, valor_calculado: 124930.5, diferenca: 3520.22,
      valor_recuperado: 2100, ctes_totais: 38, ctes_vinculados: 38, ctes_auditados: 38,
      ctes_divergentes: 3, ctes_sem_calculo: 1, ctes_sem_tabela: 0, auditor_nome: 'Joao',
      auditor_email: 'joao@amdlog.local', status: 'COM_DIVERGENCIA', boleto_status: 'RECEBIDO',
    },
    {
      id: 'fat-demo-2', numero_fatura: 'WM-2026-190', transportadora: 'WM', data_emissao: addDays(-5),
      data_vencimento: addDays(6), valor_fatura: 88730, valor_calculado: 88730, diferenca: 0,
      ctes_totais: 27, ctes_vinculados: 27, ctes_auditados: 27, ctes_divergentes: 0,
      ctes_sem_calculo: 0, ctes_sem_tabela: 0, auditor_nome: 'Maria',
      auditor_email: 'maria@amdlog.local', status: 'PRONTA_PARA_PAGAMENTO', boleto_status: 'RECEBIDO',
    },
    {
      id: 'fat-demo-3', numero_fatura: 'AT-7781', transportadora: 'Atual', data_emissao: addDays(-12),
      data_vencimento: addDays(-1), valor_fatura: 64200, valor_calculado: 63000, diferenca: 1200,
      ctes_totais: 19, ctes_vinculados: 18, ctes_auditados: 18, ctes_divergentes: 2,
      ctes_sem_calculo: 1, ctes_sem_tabela: 1, auditor_nome: 'Joao',
      auditor_email: 'joao@amdlog.local', status: 'AGUARDANDO_TRANSPORTADORA', boleto_status: 'SEM_BOLETO',
    },
    {
      id: 'fat-demo-4', numero_fatura: 'CP-00441', transportadora: 'CP Comercial', data_emissao: addDays(-15),
      data_vencimento: addDays(1), valor_fatura: 45110.35, valor_calculado: 45110.35, diferenca: 0,
      ctes_totais: 14, ctes_vinculados: 14, ctes_auditados: 14, ctes_divergentes: 0,
      ctes_sem_calculo: 0, ctes_sem_tabela: 0, auditor_nome: '', auditor_email: '',
      status: 'ENVIADA_AO_FINANCEIRO', boleto_status: 'ENVIADO_FINANCEIRO',
    },
  ];
  const detalhes = {
    'fat-demo-1': [
      { id: 'cte-d1', chave_cte: '35260600000000000000570010000018211000018210', numero_cte: '1821', valor_frete: 4250.22, calculado_frete: 3900, diferenca: 350.22, status: 'DIVERGENTE', motivo_divergencia: 'TARIFA_DIVERGENTE', observacao: 'Tarifa acima da tabela.' },
      { id: 'cte-d2', chave_cte: '35260600000000000000570010000018221000018220', numero_cte: '1822', valor_frete: 3170, calculado_frete: 0, diferenca: 3170, status: 'SEM_CALCULO', motivo_divergencia: 'SEM_TABELA', observacao: 'Rota sem tabela vigente.' },
      { id: 'cte-d3', chave_cte: '35260600000000000000570010000018231000018230', numero_cte: '1823', valor_frete: 2890, calculado_frete: 2890, diferenca: 0, status: 'OK', observacao: '' },
    ],
    'fat-demo-2': [
      { id: 'cte-d4', chave_cte: '41260600000000000000570010000099211000099210', numero_cte: '9921', valor_frete: 3286.3, calculado_frete: 3286.3, diferenca: 0, status: 'OK' },
    ],
    'fat-demo-3': [
      { id: 'cte-d5', chave_cte: '42260600000000000000570010000044011000044010', numero_cte: '4401', valor_frete: 5400, calculado_frete: 4200, diferenca: 1200, status: 'DIVERGENTE', motivo_divergencia: 'ADICIONAL_INDEVIDO' },
    ],
    'fat-demo-4': [],
  };
  return {
    faturas,
    detalhes,
    carteiras: [
      { id: 'cart-1', transportadora: 'Tomasi', auditor_nome: 'Joao', auditor_email: 'joao@amdlog.local' },
      { id: 'cart-2', transportadora: 'Atual', auditor_nome: 'Joao', auditor_email: 'joao@amdlog.local' },
      { id: 'cart-3', transportadora: 'Brenex', auditor_nome: 'Joao', auditor_email: 'joao@amdlog.local' },
      { id: 'cart-4', transportadora: 'WM', auditor_nome: 'Maria', auditor_email: 'maria@amdlog.local' },
      { id: 'cart-5', transportadora: 'Tausen', auditor_nome: 'Maria', auditor_email: 'maria@amdlog.local' },
      { id: 'cart-6', transportadora: 'CP Comercial', auditor_nome: '', auditor_email: '' },
    ],
    tratativas: [
      { id: 'trt-1', fatura_id: 'fat-demo-1', protocolo: 'TRT-2026-000001', descricao: 'Validar tarifa e solicitar correcao.', status: 'AGUARDANDO_TRANSPORTADORA', prazo_sla: addDays(1), created_at: new Date().toISOString() },
    ],
    historico: [
      { id: 'hist-1', fatura_id: 'fat-demo-1', acao: 'FATURA_RECEBIDA', descricao: 'Fatura importada do Verum.', created_at: new Date(Date.now() - 86400000 * 8).toISOString(), usuario_nome: 'Sistema' },
      { id: 'hist-2', fatura_id: 'fat-demo-1', acao: 'REAUDITORIA_CONCLUIDA', descricao: '3 divergencias identificadas.', created_at: new Date(Date.now() - 86400000 * 2).toISOString(), usuario_nome: 'Joao' },
    ],
    doccobs: [],
    protocolos: [
      { id: 'fin-1', protocolo: 'FIN-2026-000001', fatura_ids: ['fat-demo-4'], valor: 45110.35, canal: 'PROTOCOLO_FINANCEIRO', status: 'ENVIADO', lote: '2026-06-13 14:00', responsavel_nome: 'Maria', created_at: new Date().toISOString() },
    ],
    solicitacoes: [
      { id: 'sol-1', protocolo: 'FIN-SLA-2026-000001', tipo: 'COMPROVANTE_PAGAMENTO', descricao: 'Enviar comprovante da fatura CP-00441.', status: 'ABERTA', prazo_sla: addDays(1), responsavel_nome: 'Financeiro', created_at: new Date().toISOString() },
    ],
    solicitacaoHistorico: [],
    boletos: faturas.map((fatura) => ({
      id: `bol-${fatura.id}`, fatura_id: fatura.id, status: fatura.boleto_status, vencimento: fatura.data_vencimento,
    })),
    pagamentos: [],
  };
}

function readLocal() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (parsed?.faturas) return parsed;
  } catch {
    // Recria a base local quando o armazenamento estiver invalido.
  }
  const initial = demoState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  return initial;
}

function writeLocal(state) {
  // Com Supabase configurado o estado vive só no banco: gravar no localStorage
  // misturaria dados de demonstração/antigos com dados reais entre sessões.
  if (!isSupabaseConfigured()) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return state;
}

const CODIGO_TABELA_INEXISTENTE = '42P01';
const CAMPOS_OPCIONAIS_FATURA = [
  'auditoria_cobranca_acima',
  'auditoria_cobranca_abaixo',
  'auditoria_total_descontar',
  'auditoria_tolerancia_acima',
  'auditoria_tolerancia_abaixo',
];

async function selecionarTabela(table, order = 'created_at') {
  const client = getSupabaseClient();
  const { data, error } = await client.from(table).select('*').order(order, { ascending: false }).limit(1000);
  if (error) {
    if (error.code === CODIGO_TABELA_INEXISTENTE) return [];
    throw new Error(`Erro ao carregar ${table}: ${error.message}`);
  }
  return data || [];
}

async function safeUpsert(table, payload) {
  if (!isSupabaseConfigured()) return false;
  const client = getSupabaseClient();
  let { error } = await client.from(table).upsert(payload, { onConflict: 'id' });
  for (let tentativa = 0; error && tentativa < 8; tentativa += 1) {
    const mensagemOriginal = String(error.message || '');
    const mensagem = mensagemOriginal.toLowerCase();
    const matchColuna = mensagemOriginal.match(/'([^']+)'\s+column/i);
    const campoInexistente = matchColuna?.[1];
    const campoOpcionalFatura = table === 'faturas'
      ? CAMPOS_OPCIONAIS_FATURA.find((campo) => mensagem.includes(campo))
      : '';
    const campoParaRemover = campoInexistente || campoOpcionalFatura;
    // Coluna do link de confirmacao ausente (migration nao aplicada): nao
    // descartar em silencio, senao o link vai no laudo mas nao fica salvo.
    if (String(campoParaRemover || '').startsWith('confirmacao_transportador')) break;
    if (campoParaRemover && (mensagem.includes('schema cache') || mensagem.includes('column'))) {
      const limpar = (row) => {
        const next = { ...(row || {}) };
        delete next[campoParaRemover];
        if (table === 'faturas') CAMPOS_OPCIONAIS_FATURA.forEach((campo) => delete next[campo]);
        return next;
      };
      const payloadCompat = Array.isArray(payload) ? payload.map(limpar) : limpar(payload);
      ({ error } = await client.from(table).upsert(payloadCompat, { onConflict: 'id' }));
      payload = payloadCompat;
    } else {
      break;
    }
  }
  if (error) throw new Error(`Erro ao salvar em ${table}: ${error.message}`);
  return true;
}

async function inserirHistorico(table, payload) {
  // Historico é trilha de auditoria: só insert, nunca upsert/update.
  if (!isSupabaseConfigured()) return false;
  const client = getSupabaseClient();
  const { error } = await client.from(table).insert(payload);
  if (error) throw new Error(`Erro ao registrar historico em ${table}: ${error.message}`);
  return true;
}

export async function carregarPlataformaAuditoria() {
  if (!isSupabaseConfigured()) return { ...readLocal(), modo: 'DEMONSTRACAO_LOCAL' };

  // Faturas não pode ficar preso no limite de 1000 do selecionarTabela: com
  // mais que isso no banco, faturas mais antigas somem da tela (mas continuam
  // no banco e no dedup, que já consulta direto).
  // protocolos/solicitacaoHistorico/pagamentos ficam de fora do carregamento
  // inicial (só a aba Financeiro usa) — ver carregarPlataformaAuditoriaFinanceiro,
  // chamada sob demanda quando o usuario abre essa aba, pra nao atrasar o
  // primeiro carregamento da pagina com dados que a maioria das visitas nao usa.
  const client = getSupabaseClient();
  const [faturas, carteiras, tratativas, historico, doccobs, solicitacoes, boletos] = await Promise.all([
    paginarTudo(client, 'faturas', '*'),
    selecionarTabela('auditoria_carteiras', 'transportadora'),
    selecionarTabela('tratativas'),
    selecionarTabela('auditoria_fatura_historico'),
    selecionarTabela('auditoria_doccobs'),
    selecionarTabela('financeiro_solicitacoes'),
    selecionarTabela('financeiro_boletos', 'vencimento'),
  ]);

  // Detalhes (CT-es) são carregados sob demanda ao abrir cada fatura.
  return {
    faturas,
    detalhes: {},
    carteiras,
    tratativas,
    historico,
    doccobs,
    protocolos: [],
    solicitacoes,
    solicitacaoHistorico: [],
    boletos,
    pagamentos: [],
    modo: 'SUPABASE',
  };
}

export async function carregarPlataformaAuditoriaFinanceiro() {
  if (!isSupabaseConfigured()) return {};
  const [protocolos, solicitacaoHistorico, pagamentos] = await Promise.all([
    selecionarTabela('financeiro_protocolos'),
    selecionarTabela('financeiro_solicitacao_historico'),
    selecionarTabela('financeiro_pagamentos', 'data_pagamento'),
  ]);
  return { protocolos, solicitacaoHistorico, pagamentos };
}

// Busca faturas existentes por numero_fatura direto no banco, sem depender do
// state.faturas em memória (que só carrega as 1000 mais recentes — com mais
// faturas que isso no banco, faturas antigas "somem" da checagem de dedup e
// reimportar duplica em vez de atualizar).
export async function buscarFaturasExistentesPorNumero(numeros = []) {
  const mapa = new Map();
  const unicos = [...new Set((numeros || []).map((n) => String(n || '').trim()).filter(Boolean))];
  if (!isSupabaseConfigured() || !unicos.length) return mapa;
  const client = getSupabaseClient();
  for (let inicio = 0; inicio < unicos.length; inicio += 200) {
    const lote = unicos.slice(inicio, inicio + 200);
    const { data, error } = await client
      .from('faturas')
      .select('id, numero_fatura, serie_fatura, transportadora')
      .in('numero_fatura', lote);
    if (error) throw new Error(`Erro ao verificar faturas existentes: ${error.message}`);
    for (const row of data || []) {
      const chave = `${chaveFatura(row.numero_fatura, row.serie_fatura)}::${String(row.transportadora || '').trim().toUpperCase()}`;
      mapa.set(chave, row.id);
    }
  }
  return mapa;
}

// Campos do link de confirmacao: um objeto de fatura velho (carregado antes do
// laudo ser enviado) nao pode zerar o token no banco — senao o link enviado
// para a transportadora passa a dar "Link invalido".
const CAMPOS_PROTEGIDOS_CONFIRMACAO = [
  'confirmacao_transportador_token',
  'confirmacao_transportador_status',
  'confirmacao_transportador_enviado_em',
];

export async function atualizarFaturaAuditoria(state, fatura, evento) {
  const atual = state.faturas.find((item) => item.id === fatura.id);
  if (atual) {
    fatura = { ...fatura };
    CAMPOS_PROTEGIDOS_CONFIRMACAO.forEach((campo) => {
      if (!fatura[campo] && atual[campo]) fatura[campo] = atual[campo];
    });
  }
  // Nunca manda null/vazio nos campos do link: um objeto velho (sem o token que
  // acabou de ser gerado) sobrescreveria o token no banco e o link daria "invalido".
  fatura = { ...fatura };
  CAMPOS_PROTEGIDOS_CONFIRMACAO.forEach((campo) => {
    if (!fatura[campo]) delete fatura[campo];
  });
  const next = {
    ...state,
    faturas: state.faturas.map((item) => item.id === fatura.id ? { ...item, ...fatura, updated_at: new Date().toISOString() } : item),
  };
  await safeUpsert('faturas', fatura);
  if (evento) {
    const historico = {
      id: uid('hist'), fatura_id: fatura.id, created_at: new Date().toISOString(), ...evento,
    };
    next.historico = [historico, ...(next.historico || [])];
    await inserirHistorico('auditoria_fatura_historico', historico);
  }
  return writeLocal(next);
}

// Atribui um auditor a varias faturas de uma vez (lote), usado pra corrigir o
// vinculo de uma transportadora cujo nome na fatura nao casa com a carteira.
// So mexe nas faturas informadas que ainda estao SEM auditor.
export async function atribuirAuditorEmLote(state, ids = [], { auditorNome, auditorEmail = '', descricao = '', usuarioNome = 'Gestao' } = {}) {
  const alvo = new Set(ids);
  const agora = new Date().toISOString();
  const afetadas = state.faturas.filter((f) => alvo.has(f.id) && !f.auditor_nome);
  if (!afetadas.length || !auditorNome) return { state, atualizadas: 0 };
  const TAM = 200;
  for (let i = 0; i < afetadas.length; i += TAM) {
    const lote = afetadas.slice(i, i + TAM);
    // eslint-disable-next-line no-await-in-loop
    await safeUpsert('faturas', lote.map((f) => ({ id: f.id, auditor_nome: auditorNome, auditor_email: auditorEmail, updated_at: agora })));
  }
  const historicos = afetadas.map((f) => ({
    id: uid('hist'), fatura_id: f.id, created_at: agora, acao: 'AUDITOR_ATRIBUIDO',
    descricao: descricao || `Auditor ${auditorNome} atribuido em lote.`, usuario_nome: usuarioNome,
  }));
  try {
    for (let i = 0; i < historicos.length; i += 200) {
      // eslint-disable-next-line no-await-in-loop
      await inserirHistorico('auditoria_fatura_historico', historicos.slice(i, i + 200));
    }
  } catch (histError) {
    console.warn('Não foi possível registrar histórico da atribuição em lote.', histError.message || histError);
  }
  const ids2 = new Set(afetadas.map((f) => f.id));
  const next = {
    ...state,
    faturas: state.faturas.map((f) => (ids2.has(f.id) ? { ...f, auditor_nome: auditorNome, auditor_email: auditorEmail, updated_at: agora } : f)),
  };
  return { state: writeLocal(next), atualizadas: afetadas.length };
}

// Enriquecimento: puxa da base reauditada (auditoria_cte_resultados) o que ja
// sabemos de cada CT-e da fatura - rota, peso, canal, competencia e valores.
// E consulta de referencia: falha aqui nao pode travar a tela da fatura.
export async function buscarReferenciaCtes(chaves = [], { comDetalhes = false, lancarErro = false } = {}) {
  const referencia = new Map();
  if (!isSupabaseConfigured() || !chaves.length) return referencia;
  const normalizadas = [...new Set(chaves.map(normalizarChaveCte).filter(Boolean))];
  const client = getSupabaseClient();
  for (let inicio = 0; inicio < normalizadas.length; inicio += 200) {
    const lote = normalizadas.slice(inicio, inicio + 200);
    const { data, error } = await client
      .from('auditoria_cte_resultados')
      // A listagem precisa apenas do resumo. `detalhes_calculo` pode conter a
      // memória completa e comparativos de tabelas; transferi-lo para todos os
      // CT-es fazia até uma fatura de 6 itens exceder 12 s. O JSON completo é
      // buscado sob demanda quando o usuário abre o detalhe de um CT-e.
      // `comDetalhes` e usado na geracao de laudo, que precisa da memoria de calculo.
      .select(`chave_cte, numero_cte, competencia, cidade_origem, uf_origem, cidade_destino, uf_destino, canal, peso, valor_nf, valor_cte, valor_calculado, valor_calculado_verum, diferenca, diferenca_verum, status_calculo, motivo_sem_calculo, updated_at${comDetalhes ? ', detalhes_calculo' : ''}`)
      .in('chave_cte', lote);
    if (error) {
      if (lancarErro) throw new Error(`Erro ao consultar a base: ${error.message}`);
      break;
    }
    // Podem existir registros duplicados pra mesma chave/competencia (recalculos
    // antigos que inseriram em vez de atualizar) — sempre ficar com o mais
    // recente por updated_at, senao a tela pode pegar um resultado desatualizado
    // (sem detalhe de calculo ou com motivo de uma falha ja corrigida).
    const maisRecente = (atual, novo) => {
      if (!atual) return novo;
      const tAtual = new Date(atual.updated_at || 0).getTime();
      const tNovo = new Date(novo.updated_at || 0).getTime();
      return tNovo >= tAtual ? novo : atual;
    };
    for (const row of data || []) {
      const chave = normalizarChaveCte(row.chave_cte);
      if (chave) referencia.set(chave, maisRecente(referencia.get(chave), row));
      const numero = normalizarChaveCte(row.numero_cte);
      if (numero) referencia.set(numero, maisRecente(referencia.get(numero), row));
    }
  }
  // Fallback: CT-e que ainda nao foi calculado na auditoria mas existe no
  // realizado. So enriquece rota/canal/peso/NF (por chave, nunca por numero,
  // que se repete entre emitentes); valores calculados ficam zerados de
  // proposito para nao passar como resultado da auditoria.
  const faltando = normalizadas.filter((chave) => chave.length >= 40 && !referencia.has(chave));
  for (let inicio = 0; inicio < faltando.length; inicio += 200) {
    const lote = faltando.slice(inicio, inicio + 200);
    const { data, error } = await client
      .from('realizado_local_ctes')
      .select('chave_cte, numero_cte, competencia, cidade_origem, uf_origem, ibge_origem, cidade_destino, uf_destino, ibge_destino, canal, peso, valor_nf, valor_cte, updated_at')
      .in('chave_cte', lote);
    if (error) {
      if (lancarErro) throw new Error(`Erro ao consultar o realizado: ${error.message}`);
      break;
    }
    for (const row of data || []) {
      const chave = normalizarChaveCte(row.chave_cte);
      if (!chave || referencia.has(chave)) continue;
      referencia.set(chave, {
        ...row,
        valor_calculado: 0,
        valor_calculado_verum: 0,
        status_calculo: 'SEM_CALCULO',
        motivo_sem_calculo: 'CT-e no realizado, ainda nao calculado na auditoria',
        origem_referencia: 'realizado',
      });
    }
  }
  return referencia;
}

// Corrige no realizado (base dos CT-es) a origem/destino que divergem do
// tracking (ex.: importacao gravou "VITORIA/SE" com IBGE de Vitoria/ES quando o
// tracking diz Serra/ES -> Aracaju/SE). O tracking manda; so corrige quando o
// tracking traz IBGE de origem e destino validos. Depois disso o CT-e pode ser
// recalculado normalmente.
export async function corrigirBaseCtesPeloTracking(chaves = [], onProgress = null) {
  const resultado = { corrigidos: [], iguais: 0, semTracking: 0 };
  const normalizadas = [...new Set((chaves || []).map((c) => String(c || '').replace(/\D/g, '')).filter((c) => c.length >= 40))];
  if (!isSupabaseConfigured() || !normalizadas.length) return resultado;
  const client = getSupabaseClient();
  const dig7 = (v) => String(v || '').replace(/\D/g, '').slice(0, 7);
  for (let inicio = 0; inicio < normalizadas.length; inicio += 100) {
    const lote = normalizadas.slice(inicio, inicio + 100);
    const [{ data: tracking, error: erroTracking }, { data: base, error: erroBase }] = await Promise.all([
      client.from('tracking_rows').select('chave_cte, cidade_origem, uf_origem, ibge_origem, cidade_destino, uf_destino, ibge_destino').in('chave_cte', lote),
      client.from('realizado_local_ctes').select('chave_cte, cidade_origem, uf_origem, ibge_origem, cidade_destino, uf_destino, ibge_destino').in('chave_cte', lote),
    ]);
    if (erroTracking) throw new Error(`Erro ao consultar o tracking: ${erroTracking.message}`);
    if (erroBase) throw new Error(`Erro ao consultar a base de CT-es: ${erroBase.message}`);
    onProgress?.({ etapa: 'consultando', processados: inicio, total: normalizadas.length, corrigidos: resultado.corrigidos.length });
    const trackingPorChave = new Map();
    (tracking || []).forEach((row) => {
      if (dig7(row.ibge_origem).length !== 7 || dig7(row.ibge_destino).length !== 7) return;
      if (!trackingPorChave.has(row.chave_cte)) trackingPorChave.set(row.chave_cte, row);
    });
    let processados = 0;
    for (const atual of base || []) {
      processados += 1;
      onProgress?.({ etapa: 'corrigindo', processados: inicio + processados, total: normalizadas.length, corrigidos: resultado.corrigidos.length });
      const t = trackingPorChave.get(atual.chave_cte);
      if (!t) { resultado.semTracking += 1; continue; }
      if (dig7(t.ibge_origem) === dig7(atual.ibge_origem) && dig7(t.ibge_destino) === dig7(atual.ibge_destino)
        && String(t.uf_origem || '') === String(atual.uf_origem || '') && String(t.uf_destino || '') === String(atual.uf_destino || '')) {
        resultado.iguais += 1;
        continue;
      }
      const novo = {
        cidade_origem: t.cidade_origem, uf_origem: t.uf_origem, ibge_origem: dig7(t.ibge_origem),
        cidade_destino: t.cidade_destino, uf_destino: t.uf_destino, ibge_destino: dig7(t.ibge_destino),
        chave_rota_ibge: `${dig7(t.ibge_origem)}-${dig7(t.ibge_destino)}`,
        updated_at: new Date().toISOString(),
      };
      const { error } = await client.from('realizado_local_ctes').update(novo).eq('chave_cte', atual.chave_cte);
      if (error) throw new Error(`Erro ao corrigir o CT-e na base: ${error.message}`);
      resultado.corrigidos.push({
        chave: atual.chave_cte,
        de: `${atual.cidade_origem}/${atual.uf_origem} → ${atual.cidade_destino}/${atual.uf_destino}`,
        para: `${t.cidade_origem}/${t.uf_origem} → ${t.cidade_destino}/${t.uf_destino}`,
      });
    }
  }
  return resultado;
}

export async function buscarResumoOrigensFaturas(faturaIds = []) {
  const resumo = new Map();
  if (!isSupabaseConfigured() || !faturaIds.length) return resumo;
  const client = getSupabaseClient();
  const ids = [...new Set(faturaIds.filter(Boolean))];
  const detalhes = [];
  for (let inicio = 0; inicio < ids.length; inicio += 100) {
    const { data, error } = await client
      .from('fatura_detalhes')
      .select('fatura_id, chave_cte, numero_cte')
      .in('fatura_id', ids.slice(inicio, inicio + 100));
    if (error) return resumo;
    detalhes.push(...(data || []));
  }

  const porChave = new Map();
  const chaves = [];
  for (const item of detalhes) {
    const chave = normalizarChaveCte(item.chave_cte);
    if (!chave) continue;
    chaves.push(chave);
    if (!porChave.has(chave)) porChave.set(chave, []);
    porChave.get(chave).push(item.fatura_id);
  }

  for (let inicio = 0; inicio < chaves.length; inicio += 200) {
    const lote = [...new Set(chaves.slice(inicio, inicio + 200))];
    const { data, error } = await client
      .from('auditoria_cte_resultados')
      .select('chave_cte, cidade_origem, uf_origem')
      .in('chave_cte', lote);
    if (error) continue;
    for (const row of data || []) {
      const origem = [row.cidade_origem, row.uf_origem].filter(Boolean).join('/');
      if (!origem) continue;
      for (const faturaId of porChave.get(normalizarChaveCte(row.chave_cte)) || []) {
        if (!resumo.has(faturaId)) resumo.set(faturaId, new Map());
        const mapa = resumo.get(faturaId);
        mapa.set(origem, (mapa.get(origem) || 0) + 1);
      }
    }
  }

  return new Map([...resumo.entries()].map(([faturaId, mapa]) => {
    const origens = [...mapa.entries()]
      .map(([origem, qtd]) => ({ origem, qtd }))
      .sort((a, b) => b.qtd - a.qtd || a.origem.localeCompare(b.origem));
    return [faturaId, {
      principal: origens[0]?.origem || '',
      totalOrigens: origens.length,
      origens,
      tooltip: origens.map((item) => `${item.origem}: ${item.qtd} CT-e(s)`).join('\n'),
    }];
  }));
}

// Reauditoria da fatura: cruza cada CT-e (chave) com a base recalculada pelo
// motor (auditoria_cte_resultados), grava calculado/diferenca/status nos
// detalhes e atualiza os agregados e o status da fatura.
export async function reauditarFatura(state, fatura, detalhes, usuarioNome = 'Usuario local') {
  if (!isSupabaseConfigured()) {
    throw new Error('Reauditoria disponivel apenas com o Supabase configurado.');
  }
  if (!detalhes?.length) {
    throw new Error('Esta fatura nao possui CT-es vinculados para reauditar.');
  }
  const chaves = [...new Set(detalhes.map((item) => normalizarChaveCte(item.chave_cte)).filter(Boolean))];
  const client = getSupabaseClient();
  const resultados = new Map();
  for (let inicio = 0; inicio < chaves.length; inicio += 200) {
    const lote = chaves.slice(inicio, inicio + 200);
    let { data, error } = await client
      .from('auditoria_cte_resultados')
      .select('chave_cte, numero_cte, valor_cte, valor_calculado, valor_calculado_verum, diferenca, diferenca_verum, competencia, status_calculo, motivo_sem_calculo, detalhes_calculo, updated_at')
      .in('chave_cte', lote);
    if (error && String(error.message || '').includes('detalhes_calculo')) {
      ({ data, error } = await client
        .from('auditoria_cte_resultados')
        .select('chave_cte, numero_cte, valor_cte, valor_calculado, valor_calculado_verum, diferenca, diferenca_verum, competencia, status_calculo, motivo_sem_calculo, updated_at')
        .in('chave_cte', lote));
    }
    if (error) throw new Error(`Erro ao consultar a base reauditada: ${error.message}`);
    for (const row of data || []) {
      const guardarMaisRecente = (chave) => {
        if (!chave) return;
        const anterior = resultados.get(chave);
        const dataAnterior = new Date(anterior?.updated_at || 0).getTime();
        const dataAtual = new Date(row.updated_at || 0).getTime();
        if (!anterior || dataAtual >= dataAnterior) resultados.set(chave, row);
      };
      guardarMaisRecente(normalizarChaveCte(row.chave_cte));
      const numero = normalizarChaveCte(row.numero_cte);
      guardarMaisRecente(numero);
    }
  }

  // Saldos autorizados pelo gestor do transporte (B2C/Atacado) por chave de CT-e
  // ou NF: somam ao calculado na comparacao, sem tocar no motor.
  const saldosAutorizados = await carregarSaldosAutorizadosPorChave(
    detalhes.flatMap((item) => [item.chave_cte, item.chave_nfe]),
  );
  const { detalhes: atualizados, resumo } = aplicarReauditoriaDetalhes(detalhes, resultados, saldosAutorizados);
  for (let inicio = 0; inicio < atualizados.length; inicio += 200) {
    await safeUpsert('fatura_detalhes', atualizados.slice(inicio, inicio + 200));
  }

  // Diferenca da fatura = valor_fatura (confiavel, vem da aba Faturas) menos
  // o calculado total — nao a soma da diferenca de cada CT-e (resumo.valorDivergente),
  // que fica errada quando o valor_frete por CT-e veio zerado/incompleto no
  // arquivo mas o total da fatura esta correto.
  const diferencaFatura = Number((Number(fatura.valor_fatura || 0) - resumo.valorCalculado).toFixed(2));
  const statusNovo = resumo.divergentes > 0 ? 'COM_DIVERGENCIA' : 'REAUDITADA_CENTRAL';
  const next = await atualizarFaturaAuditoria(state, {
    ...fatura,
    valor_calculado: resumo.valorCalculado,
    diferenca: diferencaFatura,
    ctes_auditados: resumo.total - resumo.semCalculo,
    ctes_divergentes: resumo.divergentes,
    ctes_sem_calculo: resumo.semCalculo,
    status: statusNovo,
  }, {
    acao: 'REAUDITORIA_CONCLUIDA',
    status_anterior: fatura.status,
    status_novo: statusNovo,
    descricao: `${resumo.total} CT-e(s) reauditado(s): ${resumo.divergentes} divergente(s), ${resumo.semCalculo} sem calculo.`,
    usuario_nome: usuarioNome,
  });
  next.detalhes = { ...next.detalhes, [fatura.id]: atualizados };
  return writeLocal(next);
}

export async function vincularNovaFatura(state, original, nova, usuarioNome = 'Usuario local') {
  if (!original?.id || !nova?.id || original.id === nova.id) {
    throw new Error('Selecione uma nova fatura diferente da original.');
  }
  if (original.substituida_por_id) {
    throw new Error('Esta fatura ja possui uma substituta vinculada.');
  }
  let next = await atualizarFaturaAuditoria(state, {
    ...original,
    substituida_por_id: nova.id,
    status: 'SUBSTITUIDA',
  }, {
    acao: 'FATURA_SUBSTITUIDA',
    status_anterior: original.status,
    status_novo: 'SUBSTITUIDA',
    descricao: `Substituida pela fatura ${nova.numero_fatura} (${nova.transportadora}).`,
    metadata: { nova_fatura_id: nova.id, nova_fatura_numero: nova.numero_fatura },
    usuario_nome: usuarioNome,
  });
  next = await atualizarFaturaAuditoria(next, { ...nova }, {
    acao: 'VINCULADA_COMO_SUBSTITUTA',
    descricao: `Substitui a fatura ${original.numero_fatura} (${original.transportadora}).`,
    metadata: { fatura_original_id: original.id, fatura_original_numero: original.numero_fatura },
    usuario_nome: usuarioNome,
  });
  return next;
}

export async function salvarCarteiraAuditoria(state, carteira) {
  // ...carteira precisa vir ANTES do id: se carteira.id for null (transportadora
  // sem carteira ainda), colocar id: antes seria sobrescrito de volta pra null
  // pelo spread — e o insert falha com "null value in column id" (not-null).
  const payload = { ...carteira, id: carteira.id || uid('cart'), updated_at: new Date().toISOString() };
  const existe = state.carteiras.some((item) => item.id === payload.id);
  const next = { ...state, carteiras: existe
    ? state.carteiras.map((item) => item.id === payload.id ? payload : item)
    : [...state.carteiras, payload] };
  await safeUpsert('auditoria_carteiras', payload);
  return writeLocal(next);
}

/**
 * Registra 1 evento de troca de auditor por transportadora, independente de
 * ela ter fatura vinculada (o historico de fatura so grava se houver fatura
 * relacionada na hora da atribuicao). E' esse registro que responde "quem
 * era responsavel pela transportadora X na data Y".
 */
export async function registrarHistoricoCarteiraAuditoria({ transportadora, auditorNome, auditorEmail, atribuidoPor }) {
  const payload = {
    id: uid('cart-hist'),
    transportadora,
    auditor_nome: auditorNome || '',
    auditor_email: auditorEmail || '',
    atribuido_por: atribuidoPor || '',
    atribuido_em: new Date().toISOString(),
  };
  try {
    await safeUpsert('auditoria_carteiras_historico', payload);
  } catch (error) {
    // Nao deixa a atribuicao do auditor falhar so porque o historico nao
    // gravou (ex.: migration da tabela auditoria_carteiras_historico ainda
    // nao rodou no banco). A atribuicao em si (auditoria_carteiras/faturas)
    // ja foi salva antes desta chamada.
    console.warn('Não foi possível registrar histórico de carteira.', error.message || error);
  }
  return payload;
}

// Espelha o auditor da carteira nas faturas ABERTAS e ainda sem auditor
// dessa transportadora. Usada fora do modulo de auditoria (ex.: tela de
// Transportadoras em Ferramentas), que so grava em auditoria_carteiras e,
// sem isso, deixava as faturas existentes com "SEM AUDITOR DEFINIDO" mesmo
// depois de a transportadora ja ter responsavel definido.
// `matchesTransportadora(nomeFatura)` decide o casamento de nome (o chamador
// resolve vinculo/normalizacao do jeito que ja usa) — faturas com outro
// auditor ja definido nunca sao tocadas aqui (evita pisar em atribuicao
// alheia sem o fluxo de confirmacao que existe no Centro de Gestores).
// Casamento em duas etapas: primeiro tenta pela raiz do CNPJ da carteira
// (mais confiavel, imune a variacao de nome/razao social), so cai pro nome
// com vinculo manual (matchesTransportadora) quando a carteira nao tem CNPJ
// cadastrado ou a fatura nao tem CNPJ pra comparar.
function raizBateComCarteira(fatura, raizCarteira, cnpjCarteiraValido, matchesTransportadora) {
  if (cnpjCarteiraValido) {
    const raizFatura = obterRaizCnpj(fatura.cnpj_transportadora);
    if (raizCnpjValida(raizFatura)) return raizFatura === raizCarteira;
  }
  return matchesTransportadora(fatura.transportadora);
}

// Le as faturas da transportadora antes de decidir o que propagar — usado
// pra saber se precisa perguntar (tem fatura aberta com OUTRO auditor? tem
// encerrada sem nenhum?) antes de chamar propagarAuditorParaFaturas. Mesmo
// casamento em 2 etapas (CNPJ, depois nome+vinculo) do propagar.
export async function analisarImpactoAuditor({ novoAuditorNome, matchesTransportadora, cnpjTransportadora }) {
  if (!isSupabaseConfigured() || typeof matchesTransportadora !== 'function') return { abertasComOutroAuditor: 0, encerradasSemAuditor: 0 };
  const client = getSupabaseClient();
  const { data, error } = await client.from('faturas').select('id, transportadora, cnpj_transportadora, status, auditor_nome');
  if (error) return { abertasComOutroAuditor: 0, encerradasSemAuditor: 0 };
  const raizCarteira = obterRaizCnpj(cnpjTransportadora);
  const cnpjCarteiraValido = raizCnpjValida(raizCarteira);
  const daTransportadora = (data || []).filter((f) => raizBateComCarteira(f, raizCarteira, cnpjCarteiraValido, matchesTransportadora));
  return {
    abertasComOutroAuditor: daTransportadora.filter((f) => !ENCERRADOS.has(f.status) && f.auditor_nome && f.auditor_nome !== novoAuditorNome).length,
    encerradasSemAuditor: daTransportadora.filter((f) => ENCERRADOS.has(f.status) && !f.auditor_nome).length,
  };
}

// `transferirAbertas`: faturas abertas com OUTRO auditor tambem mudam pro
// novo (default false = so preenche o que estava vazio, comportamento
// seguro de sempre). `atualizarEncerradasAgora`: faturas ja encerradas
// (pagas/canceladas) sem nenhum auditor recebem `auditorAntigoNome` (o dono
// anterior da carteira, preenchimento provisorio ate a base historica
// entrar) ou o novo auditor se nunca teve um antes. Encerrada que JA TEM
// auditor nunca muda, em nenhum caso — preserva a metrica de delegacao.
export async function propagarAuditorParaFaturas({
  auditorNome, auditorEmail, atribuidoPor, matchesTransportadora, cnpjTransportadora,
  transferirAbertas = false, atualizarEncerradasAgora = false, auditorAntigoNome = null, auditorAntigoEmail = '',
}) {
  if (!isSupabaseConfigured() || !auditorNome || typeof matchesTransportadora !== 'function') return { atualizadas: 0 };
  const client = getSupabaseClient();
  const { data, error } = await client.from('faturas').select('id, transportadora, cnpj_transportadora, status, auditor_nome');
  if (error) {
    console.warn('Não foi possível carregar faturas para propagar auditor.', error.message || error);
    return { atualizadas: 0 };
  }
  const raizCarteira = obterRaizCnpj(cnpjTransportadora);
  const cnpjCarteiraValido = raizCnpjValida(raizCarteira);
  const daTransportadora = (data || []).filter((f) => raizBateComCarteira(f, raizCarteira, cnpjCarteiraValido, matchesTransportadora));

  const preenchimentoEncerradas = auditorAntigoNome
    ? { auditor_nome: auditorAntigoNome, auditor_email: auditorAntigoEmail || '' }
    : { auditor_nome: auditorNome, auditor_email: auditorEmail || '' };

  const alvo = [];
  daTransportadora.forEach((f) => {
    if (ENCERRADOS.has(f.status)) {
      if (f.auditor_nome || !atualizarEncerradasAgora) return;
      alvo.push({ id: f.id, ...preenchimentoEncerradas, descricao: `Preenchimento provisorio (${preenchimentoEncerradas.auditor_nome}) ao atribuir carteira a ${auditorNome}.` });
      return;
    }
    if (f.auditor_nome && f.auditor_nome !== auditorNome && !transferirAbertas) return;
    alvo.push({ id: f.id, auditor_nome: auditorNome, auditor_email: auditorEmail || '', descricao: `Carteira atribuida a ${auditorNome}.` });
  });
  if (!alvo.length) return { atualizadas: 0 };
  const agora = new Date().toISOString();
  await safeUpsert('faturas', alvo.map((f) => ({ id: f.id, auditor_nome: f.auditor_nome, auditor_email: f.auditor_email, updated_at: agora })));
  try {
    await inserirHistorico('auditoria_fatura_historico', alvo.map((f) => ({
      id: uid('hist'), fatura_id: f.id, created_at: agora,
      acao: 'AUDITOR_ATRIBUIDO', descricao: f.descricao, usuario_nome: atribuidoPor || 'Gestao',
    })));
  } catch (histError) {
    console.warn('Não foi possível registrar histórico de atribuição em massa.', histError.message || histError);
  }
  return { atualizadas: alvo.length };
}

// Passivo antigo: faturas ja encerradas (pagas/canceladas/etc) sem nenhum
// auditor, de antes do fluxo atual de atribuicao existir. Usa o campo
// `usuario` da base Verum (fatura_detalhes — quem enviou cada CT-e pro
// pagamento) como fonte real do auditor da epoca, em vez de um chute.
// Acao manual, chamada sob demanda (nao roda sozinha) — varre a base de
// CT-es fatura por fatura e pode pesar em bases grandes.
export async function preencherAuditorPagasPeloHistoricoCte({ usuarioNome } = {}) {
  if (!isSupabaseConfigured()) return { corrigidas: 0, semUsuarioNoCte: 0 };
  const client = getSupabaseClient();
  const { data: faturas, error } = await client.from('faturas').select('id, status, auditor_nome');
  if (error) throw new Error(error.message || 'Erro ao carregar faturas.');
  const pendentes = (faturas || []).filter((f) => ENCERRADOS.has(f.status) && !f.auditor_nome);
  if (!pendentes.length) return { corrigidas: 0, semUsuarioNoCte: 0 };

  const usuarioPorFatura = new Map();
  const CHUNK = 300;
  for (let inicio = 0; inicio < pendentes.length; inicio += CHUNK) {
    const lote = pendentes.slice(inicio, inicio + CHUNK).map((f) => f.id);
    // eslint-disable-next-line no-await-in-loop
    const { data, error: errDetalhes } = await client.from('fatura_detalhes').select('fatura_id, usuario').in('fatura_id', lote);
    if (errDetalhes) throw new Error(errDetalhes.message || 'Erro ao consultar histórico de CT-es.');
    (data || []).forEach((linha) => {
      const nome = String(linha.usuario || '').trim();
      if (!nome) return;
      const contagem = usuarioPorFatura.get(linha.fatura_id) || new Map();
      contagem.set(nome, (contagem.get(nome) || 0) + 1);
      usuarioPorFatura.set(linha.fatura_id, contagem);
    });
  }

  const alvoCte = pendentes
    .map((f) => {
      const contagem = usuarioPorFatura.get(f.id);
      if (!contagem || !contagem.size) return null;
      const nomeMaisFrequente = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return { id: f.id, auditor_nome: nomeMaisFrequente, descricao: 'Preenchido a partir do histórico Verum (usuário que enviou o CT-e para pagamento).' };
    })
    .filter(Boolean);

  // Sobrou sem usuario no CT-e: tenta pela trilha de eventos da fatura
  // (auditoria_fatura_historico) — nomes genericos ('Sistema', 'Gestao',
  // vazio) nao contam, só quem realmente mexeu na fatura em algum momento.
  const idsResolvidosCte = new Set(alvoCte.map((f) => f.id));
  const semUsuarioCte = pendentes.filter((f) => !idsResolvidosCte.has(f.id));
  const NOMES_GENERICOS = new Set(['', 'SISTEMA', 'GESTAO', 'GESTÃO', 'USUARIO LOCAL', 'FINANCEIRO']);
  const usuarioPorFaturaHistorico = new Map();
  for (let inicio = 0; inicio < semUsuarioCte.length; inicio += CHUNK) {
    const lote = semUsuarioCte.slice(inicio, inicio + CHUNK).map((f) => f.id);
    // eslint-disable-next-line no-await-in-loop
    const { data, error: errHistorico } = await client.from('auditoria_fatura_historico').select('fatura_id, usuario_nome').in('fatura_id', lote);
    if (errHistorico) throw new Error(errHistorico.message || 'Erro ao consultar histórico de eventos da fatura.');
    (data || []).forEach((linha) => {
      const nome = String(linha.usuario_nome || '').trim();
      if (NOMES_GENERICOS.has(nome.toUpperCase())) return;
      const contagem = usuarioPorFaturaHistorico.get(linha.fatura_id) || new Map();
      contagem.set(nome, (contagem.get(nome) || 0) + 1);
      usuarioPorFaturaHistorico.set(linha.fatura_id, contagem);
    });
  }
  const alvoHistorico = semUsuarioCte
    .map((f) => {
      const contagem = usuarioPorFaturaHistorico.get(f.id);
      if (!contagem || !contagem.size) return null;
      const nomeMaisFrequente = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return { id: f.id, auditor_nome: nomeMaisFrequente, descricao: 'Preenchido a partir da trilha de eventos da fatura (histórico de atendimento).' };
    })
    .filter(Boolean);

  const alvo = [...alvoCte, ...alvoHistorico];
  if (!alvo.length) return { corrigidas: 0, semUsuarioNoCte: pendentes.length };

  const agora = new Date().toISOString();
  await safeUpsert('faturas', alvo.map((f) => ({ id: f.id, auditor_nome: f.auditor_nome, auditor_email: '', updated_at: agora })));
  try {
    await inserirHistorico('auditoria_fatura_historico', alvo.map((f) => ({
      id: uid('hist'), fatura_id: f.id, created_at: agora,
      acao: 'AUDITOR_ATRIBUIDO', descricao: f.descricao, usuario_nome: usuarioNome || 'Gestao',
    })));
  } catch (histError) {
    console.warn('Não foi possível registrar histórico de preenchimento retroativo.', histError.message || histError);
  }
  return { corrigidas: alvo.length, semUsuarioNoCte: pendentes.length - alvo.length };
}

// Lista leve de carteiras (transportadora -> auditor), sem o resto do estado
// da plataforma de auditoria. Usada em telas fora do módulo de auditoria que
// só precisam saber quem é o auditor responsável por cada transportadora.
export async function listarCarteirasAuditoria() {
  if (!isSupabaseConfigured()) return [];
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('auditoria_carteiras')
    .select('id, transportadora, cnpj_transportadora, auditor_nome, auditor_email');
  if (error) {
    console.warn('Não foi possível carregar carteiras de auditoria.', error.message || error);
    return [];
  }
  return data || [];
}

export async function listarHistoricoCarteiraAuditoria(transportadora) {
  if (!isSupabaseConfigured()) return [];
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('auditoria_carteiras_historico')
    .select('id, transportadora, auditor_nome, auditor_email, atribuido_por, atribuido_em')
    .eq('transportadora', transportadora)
    .order('atribuido_em', { ascending: false });
  if (error) throw new Error(error.message || 'Erro ao carregar histórico da carteira.');
  return data || [];
}

export async function registrarDoccob(state, doccob) {
  const payload = { id: uid('doccob'), created_at: new Date().toISOString(), ...doccob };
  const next = { ...state, doccobs: [payload, ...(state.doccobs || [])] };
  await safeUpsert('auditoria_doccobs', payload);
  return writeLocal(next);
}

// O numero do protocolo é gerado no cliente a partir do estado carregado: dois
// usuários simultâneos podem gerar o mesmo. A unique do banco barra a colisão e
// aqui tentamos de novo com o próximo número em vez de estourar para o usuário.
async function salvarComProtocoloUnico(table, montarPayload, prefixo, existentes) {
  const usados = existentes.map((item) => item?.protocolo).filter(Boolean);
  // O estado local pode estar sem os protocolos ja gravados (ou incompleto): parte do
  // maior numero que ja existe no banco, senao as tentativas batem nos numeros usados.
  try {
    const inicio = `${prefixo}-${new Date().getFullYear()}-`;
    const { data } = await getSupabaseClient().from(table).select('protocolo').like('protocolo', `${inicio}%`).order('protocolo', { ascending: false }).limit(5);
    (data || []).forEach((linha) => linha?.protocolo && usados.push(linha.protocolo));
  } catch { /* segue com o estado local */ }
  for (let tentativa = 0; tentativa < 8; tentativa += 1) {
    const protocolo = gerarProtocolo(prefixo, usados);
    const payload = montarPayload(protocolo);
    try {
      await safeUpsert(table, payload);
      return payload;
    } catch (error) {
      if (!/duplicate key|23505/i.test(error?.message || '')) throw error;
      usados.push(protocolo);
    }
  }
  throw new Error(`Nao foi possivel gerar um protocolo ${prefixo} unico. Atualize a pagina e tente novamente.`);
}

export async function criarProtocoloFinanceiro(state, dados) {
  const montar = (protocolo) => ({
    id: uid('fin'),
    protocolo,
    status: 'ENVIADO',
    created_at: new Date().toISOString(),
    ...dados,
  });
  const payload = isSupabaseConfigured()
    ? await salvarComProtocoloUnico('financeiro_protocolos', montar, 'FIN', state.protocolos)
    : montar(gerarProtocolo('FIN', state.protocolos));
  const next = { ...state, protocolos: [payload, ...state.protocolos] };
  return writeLocal(next);
}

export async function criarSolicitacaoFinanceira(state, dados) {
  const montar = (protocolo) => ({
    id: uid('fin-sla'),
    protocolo,
    status: 'ABERTA',
    created_at: new Date().toISOString(),
    ...dados,
  });
  const payload = isSupabaseConfigured()
    ? await salvarComProtocoloUnico('financeiro_solicitacoes', montar, 'FIN-SLA', state.solicitacoes)
    : montar(gerarProtocolo('FIN-SLA', state.solicitacoes));
  const next = { ...state, solicitacoes: [payload, ...state.solicitacoes] };
  return writeLocal(next);
}

export async function atenderSolicitacaoFinanceira(state, solicitacao, atendimento) {
  const agora = new Date().toISOString();
  const statusAnterior = solicitacao.status;
  const payload = {
    ...solicitacao,
    status: atendimento.status,
    responsavel_id: atendimento.responsavel_id || solicitacao.responsavel_id || null,
    responsavel_nome: atendimento.responsavel_nome || solicitacao.responsavel_nome || 'Financeiro',
    concluido_em: atendimento.status === 'CONCLUIDA' ? agora : null,
    updated_at: agora,
  };
  const evento = {
    id: uid('fin-hist'),
    solicitacao_id: solicitacao.id,
    acao: atendimento.status,
    comentario: atendimento.comentario || '',
    anexos: atendimento.anexo_nome ? [{ nome: atendimento.anexo_nome }] : [],
    usuario_id: atendimento.usuario_id || '',
    usuario_nome: atendimento.usuario_nome || '',
    created_at: agora,
  };
  const next = {
    ...state,
    solicitacoes: state.solicitacoes.map((item) => item.id === solicitacao.id ? payload : item),
    solicitacaoHistorico: [evento, ...(state.solicitacaoHistorico || [])],
  };
  if (isSupabaseConfigured()) {
    // Update condicional: se outro usuario ja concluiu a solicitacao, nao
    // sobrescreve o atendimento dele — avisa para recarregar a fila.
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('financeiro_solicitacoes')
      .update({
        status: payload.status,
        responsavel_id: payload.responsavel_id,
        responsavel_nome: payload.responsavel_nome,
        concluido_em: payload.concluido_em,
        updated_at: payload.updated_at,
      })
      .eq('id', solicitacao.id)
      .neq('status', 'CONCLUIDA')
      .select('id');
    if (error) throw new Error(`Erro ao atender solicitacao: ${error.message}`);
    if (!data?.length) {
      throw new Error('Esta solicitacao ja foi concluida por outro usuario. Recarregue a pagina para atualizar a fila.');
    }
    await inserirHistorico('financeiro_solicitacao_historico', evento);
  }
  return writeLocal(next);
}

export async function salvarBoletoFinanceiro(state, boleto) {
  const payload = { id: boleto.id || uid('bol'), ...boleto, updated_at: new Date().toISOString() };
  const existe = state.boletos.some((item) => item.fatura_id === payload.fatura_id);
  const next = { ...state, boletos: existe
    ? state.boletos.map((item) => item.fatura_id === payload.fatura_id ? { ...item, ...payload } : item)
    : [payload, ...state.boletos] };
  await safeUpsert('financeiro_boletos', payload);
  return writeLocal(next);
}

export async function salvarPagamentosFinanceiros(state, pagamentos) {
  const novos = pagamentos.map((item) => ({ id: item.id || uid('pag'), imported_at: new Date().toISOString(), ...item }));
  const next = { ...state, pagamentos: [...novos, ...state.pagamentos] };
  if (isSupabaseConfigured()) {
    const client = getSupabaseClient();
    await client.from('financeiro_pagamentos').upsert(novos, { onConflict: 'id' });
  }
  return writeLocal(next);
}

// Importacao de relatorios grandes (ex.: exportacao SAP com dezenas de
// milhares de linhas de toda a empresa): grava só os pagamentos que
// casaram com uma fatura (os demais nao dizem respeito a fretes) e em
// lotes, pra nao estourar o limite de uma unica chamada ao Supabase nem
// travar a aba com uma tabela gigante.
export async function salvarPagamentosFinanceirosEmLote(pagamentosConciliados, onProgress) {
  const comId = pagamentosConciliados
    .filter((item) => item.fatura_id)
    .map((item) => ({ id: item.id || uid('pag'), imported_at: new Date().toISOString(), ...item }));
  // transportadora/compensado/cnpj sao so pra conciliar e exibir na tela -
  // nao existem em financeiro_pagamentos.
  const paraSalvar = comId.map(({ transportadora, compensado, cnpj, ...item }) => item);
  if (!isSupabaseConfigured() || !paraSalvar.length) return comId;
  const client = getSupabaseClient();
  const LOTE = 500;
  for (let inicio = 0; inicio < paraSalvar.length; inicio += LOTE) {
    const lote = paraSalvar.slice(inicio, inicio + LOTE);
    const { error } = await client.from('financeiro_pagamentos').upsert(lote, { onConflict: 'id' });
    if (error) throw new Error(`Erro ao salvar pagamentos: ${error.message}`);
    onProgress?.({ carregados: Math.min(inicio + LOTE, paraSalvar.length), total: paraSalvar.length });
  }
  return comId;
}

// Atualiza em lote o status das faturas cujo pagamento SAP ja compensou
// (PAGO/DIVERGENTE). Faturas so com partida lancada (ainda nao compensada)
// nao mudam de status aqui.
export async function atualizarStatusFaturasPagasEmLote(state, pagamentosCompensados, usuarioNome, onProgress) {
  if (!isSupabaseConfigured() || !pagamentosCompensados.length) return state;
  const client = getSupabaseClient();
  const agora = new Date().toISOString();
  // Uma mesma fatura pode ter mais de uma linha compensada no relatorio (ex.:
  // pagamento parcelado): o upsert nao aceita dois updates pro mesmo id no
  // mesmo lote, entao consolida por fatura antes de enviar (soma o valor
  // pago e fica com a data mais recente).
  // Fatura que passou por aprovacao da gestao com desconto (LIBERADA_COM_DESCONTO)
  // vira PAGA_COM_DESCONTO em vez de PAGA simples, pra nao perder esse historico
  // quando o pagamento compensa — mesma logica de "esse pagamento teve desconto".
  const faturasPorId = new Map((state.faturas || []).map((item) => [item.id, item]));
  const porFatura = new Map();
  for (const pagamento of pagamentosCompensados) {
    const atual = porFatura.get(pagamento.fatura_id);
    const teveDesconto = faturasPorId.get(pagamento.fatura_id)?.status === 'LIBERADA_COM_DESCONTO';
    const status = pagamento.resultado === 'PAGO' ? (teveDesconto ? 'PAGA_COM_DESCONTO' : 'PAGA') : 'PAGA_COM_DIVERGENCIA';
    if (!atual) {
      porFatura.set(pagamento.fatura_id, {
        id: pagamento.fatura_id,
        status,
        valor_pago: Number(pagamento.valor_pago || 0),
        data_pagamento: pagamento.data_pagamento,
        partida: pagamento.partida || null,
        updated_at: agora,
      });
    } else {
      atual.valor_pago = Number((atual.valor_pago + Number(pagamento.valor_pago || 0)).toFixed(2));
      if (status === 'PAGA_COM_DIVERGENCIA') atual.status = 'PAGA_COM_DIVERGENCIA';
      if (pagamento.data_pagamento && (!atual.data_pagamento || pagamento.data_pagamento > atual.data_pagamento)) {
        atual.data_pagamento = pagamento.data_pagamento;
        atual.partida = pagamento.partida || atual.partida;
      }
    }
  }
  const atualizacoesFatura = [...porFatura.values()];
  const historico = pagamentosCompensados.map((pagamento) => ({
    id: uid('hist'),
    fatura_id: pagamento.fatura_id,
    acao: 'PAGAMENTO_CONCILIADO',
    status_novo: porFatura.get(pagamento.fatura_id)?.status || (pagamento.resultado === 'PAGO' ? 'PAGA' : 'PAGA_COM_DIVERGENCIA'),
    descricao: `Pagamento conciliado via relatorio SAP: ${pagamento.resultado} (doc. ${pagamento.documento_compensacao || '-'}).`,
    usuario_nome: usuarioNome,
    created_at: agora,
  }));

  for (let inicio = 0; inicio < atualizacoesFatura.length; inicio += 200) {
    const lote = atualizacoesFatura.slice(inicio, inicio + 200);
    const { error } = await client.from('faturas').upsert(lote, { onConflict: 'id' });
    if (error) throw new Error(`Erro ao atualizar status das faturas: ${error.message}`);
    onProgress?.({ carregados: Math.min(inicio + 200, atualizacoesFatura.length), total: atualizacoesFatura.length });
  }
  for (let inicio = 0; inicio < historico.length; inicio += 500) {
    await client.from('auditoria_fatura_historico').insert(historico.slice(inicio, inicio + 500));
  }

  const statusPorFatura = new Map(atualizacoesFatura.map((item) => [item.id, item]));
  return {
    ...state,
    faturas: state.faturas.map((fatura) => statusPorFatura.has(fatura.id) ? { ...fatura, ...statusPorFatura.get(fatura.id) } : fatura),
    historico: [...historico, ...(state.historico || [])],
  };
}

// Marca na fatura que ela ja foi lancada/reclassificada no financeiro
// (resultado LANCADA_FINANCEIRO - documento "190..." intermediario, ainda
// nao e' pagamento). Nao altera o status da fatura, so' da visibilidade.
export async function marcarFaturasLancadasFinanceiroEmLote(state, pagamentosLancados, onProgress) {
  if (!isSupabaseConfigured() || !pagamentosLancados.length) return state;
  const client = getSupabaseClient();
  const agora = new Date().toISOString();
  const porFatura = new Map();
  for (const pagamento of pagamentosLancados) {
    const atual = porFatura.get(pagamento.fatura_id);
    if (!atual) {
      porFatura.set(pagamento.fatura_id, {
        id: pagamento.fatura_id,
        lancamento_financeiro: pagamento.lancamento_contabil || null,
        lancamento_financeiro_em: pagamento.data_lancamento || null,
        updated_at: agora,
      });
    } else if (pagamento.data_lancamento && (!atual.lancamento_financeiro_em || pagamento.data_lancamento > atual.lancamento_financeiro_em)) {
      // Fica com o lancamento mais recente quando ha varios hops de reclassificacao.
      atual.lancamento_financeiro = pagamento.lancamento_contabil || atual.lancamento_financeiro;
      atual.lancamento_financeiro_em = pagamento.data_lancamento;
    }
  }
  const atualizacoesFatura = [...porFatura.values()].filter((item) => item.lancamento_financeiro);
  if (!atualizacoesFatura.length) return state;

  for (let inicio = 0; inicio < atualizacoesFatura.length; inicio += 200) {
    const lote = atualizacoesFatura.slice(inicio, inicio + 200);
    const { error } = await client.from('faturas').upsert(lote, { onConflict: 'id' });
    if (error) throw new Error(`Erro ao marcar faturas lancadas no financeiro: ${error.message}`);
    onProgress?.({ carregados: Math.min(inicio + 200, atualizacoesFatura.length), total: atualizacoesFatura.length });
  }

  const porFaturaFinal = new Map(atualizacoesFatura.map((item) => [item.id, item]));
  return {
    ...state,
    faturas: state.faturas.map((fatura) => porFaturaFinal.has(fatura.id) ? { ...fatura, ...porFaturaFinal.get(fatura.id) } : fatura),
  };
}

// Le a tabela inteira em paginas de 1000 (limite do PostgREST), disparando um
// lote de paginas em paralelo por vez. Era sequencial: com 14 mil faturas isso
// segurava a Central de Auditoria em "Carregando..." por dezenas de segundos.
//
// Sem ORDER BY de proposito: ordenar por id fazia o Postgres reordenar a tabela
// inteira em cada pagina e, com varias paginas simultaneas, ficava mais lento
// que o modo sequencial. Como o range sem ordem nao garante particao perfeita,
// o resultado e deduplicado por id no final.
const PAGINACAO_LOTE = 8;

async function paginarTudo(client, table, select, onProgress) {
  const PAGE = 1000;
  const porId = new Map();
  const semId = [];

  const acumular = (linhas) => {
    for (const linha of linhas) {
      if (linha?.id == null) semId.push(linha);
      else porId.set(linha.id, linha);
    }
    onProgress?.({ tabela: table, carregados: porId.size + semId.length });
  };

  const lerPagina = async (inicio) => {
    const { data, error } = await client.from(table).select(select).range(inicio, inicio + PAGE - 1);
    if (error) throw new Error(`Erro ao ler ${table}: ${error.message}`);
    return data || [];
  };

  for (let lote = 0; ; lote += 1) {
    const inicios = Array.from({ length: PAGINACAO_LOTE }, (_, i) => (lote * PAGINACAO_LOTE + i) * PAGE);
    const paginas = await Promise.all(inicios.map(lerPagina));
    paginas.forEach(acumular);
    // Ultima pagina do lote incompleta = a tabela acabou dentro deste lote.
    if (paginas[paginas.length - 1].length < PAGE) break;
  }

  return [...porId.values(), ...semId];
}

// Canal não vem no arquivo Verum (nem em Faturas nem em Detalhes) — só existe
// por CT-e, em auditoria_cte_resultados. Essa função varre fatura_detalhes +
// auditoria_cte_resultados uma vez, calcula o canal predominante de cada
// fatura e grava em faturas.canal, pra dar pra filtrar a lista sem reabrir
// cada fatura. É uma ação sob demanda (não roda automático), porque varre as
// duas tabelas inteiras.
export async function detectarCanaisFaturas(state, onProgress) {
  if (!isSupabaseConfigured()) {
    throw new Error('Detecção de canal disponível apenas com o Supabase configurado.');
  }
  const client = getSupabaseClient();

  const detalhes = await paginarTudo(client, 'fatura_detalhes', 'fatura_id, chave_cte', onProgress);
  const chavesPorFatura = new Map();
  for (const item of detalhes) {
    const chave = normalizarChaveCte(item.chave_cte);
    if (!chave) continue;
    if (!chavesPorFatura.has(item.fatura_id)) chavesPorFatura.set(item.fatura_id, []);
    chavesPorFatura.get(item.fatura_id).push(chave);
  }

  const resultados = await paginarTudo(client, 'auditoria_cte_resultados', 'chave_cte, canal', onProgress);
  const canalPorChave = new Map();
  for (const item of resultados) {
    const chave = normalizarChaveCte(item.chave_cte);
    if (chave && item.canal) canalPorChave.set(chave, item.canal);
  }

  const atualizacoes = [];
  for (const [faturaId, chaves] of chavesPorFatura.entries()) {
    const contagem = new Map();
    for (const chave of chaves) {
      const canal = canalPorChave.get(chave);
      if (!canal) continue;
      contagem.set(canal, (contagem.get(canal) || 0) + 1);
    }
    if (!contagem.size) continue;
    const predominante = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0][0];
    atualizacoes.push({ id: faturaId, canal: predominante });
  }

  for (let inicio = 0; inicio < atualizacoes.length; inicio += 200) {
    const lote = atualizacoes.slice(inicio, inicio + 200);
    const { error } = await client.from('faturas').upsert(lote, { onConflict: 'id' });
    if (error) throw new Error(`Erro ao gravar canal das faturas: ${error.message}`);
    onProgress?.({ tabela: 'faturas.canal', carregados: Math.min(inicio + 200, atualizacoes.length), total: atualizacoes.length });
  }

  const canalPorFatura = new Map(atualizacoes.map((item) => [item.id, item.canal]));
  const next = {
    ...state,
    faturas: state.faturas.map((fatura) => canalPorFatura.has(fatura.id) ? { ...fatura, canal: canalPorFatura.get(fatura.id) } : fatura),
  };
  return { state: writeLocal(next), atualizadas: atualizacoes.length };
}

// --- Protocolo Financeiro (demanda 4.40A) ---------------------------------

function normalizarTexto(valor) {
  return String(valor || '').trim().toUpperCase();
}

// Busca o cadastro de dados bancarios da transportadora (por CNPJ, com
// fallback pelo nome). Retorna a conta principal e a lista completa, para o
// auditor poder trocar de conta quando houver mais de uma cadastrada.
export async function buscarDadosBancariosTransportadora(transportadora, cnpj) {
  if (!isSupabaseConfigured()) return { principal: null, contas: [] };
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('transportadora_dados_bancarios')
    .select('*')
    .eq('ativo', true)
    .order('principal', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) return { principal: null, contas: [] };
  const cnpjAlvo = normalizarTexto(cnpj).replace(/\D/g, '');
  const nomeAlvo = normalizarTexto(transportadora);
  const contas = (data || []).filter((item) => {
    const itemCnpj = normalizarTexto(item.cnpj).replace(/\D/g, '');
    if (cnpjAlvo && itemCnpj) return itemCnpj === cnpjAlvo;
    return normalizarTexto(item.transportadora) === nomeAlvo;
  });
  return { principal: contas.find((item) => item.principal) || contas[0] || null, contas };
}

export async function salvarDadosBancariosTransportadora(payload) {
  if (!isSupabaseConfigured()) throw new Error('Cadastro de dados bancarios disponivel apenas com o Supabase configurado.');
  const registro = { id: payload.id || uid('banc'), updated_at: new Date().toISOString(), ...payload };
  await safeUpsert('transportadora_dados_bancarios', registro);
  return registro;
}

export async function listarDadosBancariosTransportadoras() {
  if (!isSupabaseConfigured()) return [];
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('transportadora_dados_bancarios')
    .select('*')
    .order('transportadora')
    .order('principal', { ascending: false });
  if (error) throw new Error(`Erro ao carregar dados bancarios: ${error.message}`);
  return data || [];
}

export async function inativarDadosBancariosTransportadora(id) {
  if (!isSupabaseConfigured()) throw new Error('Disponivel apenas com o Supabase configurado.');
  await safeUpsert('transportadora_dados_bancarios', { id, ativo: false, updated_at: new Date().toISOString() });
}

// Importacao em massa da planilha de dados bancarios (cadastro inicial ou
// atualizacao). Faz upsert por CNPJ quando disponivel; senao, casa pelo nome
// normalizado da transportadora. Cada transportadora fica com no maximo um
// registro "principal" - se ja existir cadastro ativo, a importacao atualiza
// os dados em vez de duplicar.
export async function importarDadosBancariosTransportadoras(registros = [], usuario = {}) {
  if (!isSupabaseConfigured()) throw new Error('Importacao disponivel apenas com o Supabase configurado.');
  if (!registros.length) return { importados: 0, atualizados: 0 };
  const existentes = await listarDadosBancariosTransportadoras();
  const porCnpj = new Map();
  const porNome = new Map();
  for (const item of existentes) {
    const cnpjNorm = normalizarTexto(item.cnpj).replace(/\D/g, '');
    if (cnpjNorm) porCnpj.set(cnpjNorm, item);
    porNome.set(normalizarTexto(item.transportadora), item);
  }

  let importados = 0;
  let atualizados = 0;
  const payloads = [];
  for (const registro of registros) {
    const cnpjNorm = normalizarTexto(registro.cnpj).replace(/\D/g, '');
    const existente = (cnpjNorm && porCnpj.get(cnpjNorm)) || porNome.get(normalizarTexto(registro.transportadora));
    const agora = new Date().toISOString();
    if (existente) {
      atualizados += 1;
      payloads.push({ ...existente, ...registro, id: existente.id, atualizado_por: usuario.nome || 'Importacao', updated_at: agora });
    } else {
      importados += 1;
      payloads.push({ id: uid('banc'), ...registro, criado_por: usuario.nome || 'Importacao', atualizado_por: usuario.nome || 'Importacao', created_at: agora, updated_at: agora });
    }
  }
  await safeUpsert('transportadora_dados_bancarios', payloads);
  return { importados, atualizados };
}

export async function listarCentrosCusto() {
  if (!isSupabaseConfigured()) return [];
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('financeiro_centros_custo')
    .select('*')
    .eq('ativo', true)
    .order('codigo');
  if (error) return [];
  return data || [];
}

// Fatura ja protocolada e ativa (evita duplicidade acidental - secao 17).
export async function buscarProtocoloAtivoPorFatura(faturaId) {
  if (!isSupabaseConfigured() || !faturaId) return null;
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('financeiro_protocolos')
    .select('*')
    .contains('fatura_ids', JSON.stringify([faturaId]))
    .eq('ativo', true)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error || !data?.length) return null;
  return data[0];
}

export async function listarHistoricoProtocoloFinanceiro(protocoloId) {
  if (!isSupabaseConfigured() || !protocoloId) return [];
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('financeiro_protocolo_historico')
    .select('*')
    .eq('protocolo_id', protocoloId)
    .order('created_at', { ascending: false });
  if (error) return [];
  return data || [];
}

// Cria o protocolo financeiro a partir da tela de conferencia da Auditoria de
// Fretes: grava o protocolo (financeiro_protocolos, ja usado pela demanda
// 4.40), os anexos de lancamento manual e o historico de criacao, atualiza a
// fatura para ENVIADA_AO_FINANCEIRO e registra o evento no historico da
// fatura. dados ja deve ter passado por validarProtocoloFinanceiro().
export async function enviarFaturaParaProtocolo(state, fatura, dados, usuario = {}) {
  if (!isSupabaseConfigured()) {
    throw new Error('Envio para Protocolo Financeiro disponivel apenas com o Supabase configurado.');
  }
  const ativo = await buscarProtocoloAtivoPorFatura(fatura.id);
  if (ativo && !dados.substituirProtocoloId) {
    const erro = new Error('Esta fatura ja possui protocolo financeiro.');
    erro.protocoloExistente = ativo;
    throw erro;
  }

  const montar = (protocolo) => ({
    id: uid('fin'),
    protocolo,
    canal: 'PROTOCOLO_FINANCEIRO',
    fatura_ids: [fatura.id],
    numero_fatura: fatura.numero_fatura,
    transportadora: fatura.transportadora,
    cnpj_transportadora: fatura.cnpj_transportadora,
    vencimento: fatura.data_vencimento,
    valor: Number(dados.valor_real_a_pagar || 0),
    valor_fatura_original: Number(dados.valor_fatura_original || 0),
    desconto_automatico: Number(dados.desconto_automatico || 0),
    desconto_manual: Number(dados.desconto_manual || 0),
    desconto_manual_justificativa: dados.desconto_manual_justificativa || null,
    desconto_total: Number(dados.desconto_total || 0),
    valor_real_a_pagar: Number(dados.valor_real_a_pagar || 0),
    partida: dados.partida || null,
    valor_cobranca_processada: dados.valor_cobranca_processada != null ? Number(dados.valor_cobranca_processada) : null,
    valor_lancamento_manual: dados.valor_lancamento_manual != null ? Number(dados.valor_lancamento_manual) : null,
    centro_custo_codigo: dados.centro_custo_codigo || null,
    centro_custo_descricao: dados.centro_custo_descricao || null,
    tipo_envio: dados.tipo_envio,
    status_fatura_protocolo: dados.status_fatura_protocolo,
    dados_bancarios: dados.dados_bancarios || null,
    dados_bancarios_id: dados.dados_bancarios?.id || null,
    dados_bancarios_divergentes: !!dados.dados_bancarios_divergentes,
    composicao_descontos: dados.composicao_descontos || [],
    observacoes: dados.observacoes || null,
    responsavel_id: dados.responsavel_id || null,
    responsavel_user_id: dados.responsavel_id || null,
    responsavel_nome: dados.responsavel_nome || '',
    lote: dados.lote || null,
    ativo: true,
    protocolo_anterior_id: dados.substituirProtocoloId || null,
    criado_por_id: usuario.id || '',
    criado_por_nome: usuario.nome || '',
    status: 'ENVIADO',
    enviado_em: new Date().toISOString(),
  });

  const payload = await salvarComProtocoloUnico('financeiro_protocolos', montar, 'FIN', state.protocolos || []);

  if (ativo && dados.substituirProtocoloId) {
    await safeUpsert('financeiro_protocolos', { id: ativo.id, ativo: false, updated_at: new Date().toISOString() });
  }

  if (dados.anexos?.length) {
    const anexos = dados.anexos.map((anexo) => ({
      id: uid('fin-anexo'),
      protocolo_id: payload.id,
      tipo: 'LANCAMENTO_MANUAL',
      nome_arquivo: anexo.nome,
      url: anexo.url || null,
      tamanho: anexo.tamanho || null,
      enviado_por_id: usuario.id || '',
      enviado_por_nome: usuario.nome || '',
      enviado_em: new Date().toISOString(),
    }));
    await safeUpsert('financeiro_protocolo_anexos', anexos);
  }

  const eventoProtocolo = {
    id: uid('fin-prot-hist'),
    protocolo_id: payload.id,
    acao: 'PROTOCOLO_ENVIADO',
    descricao: `Protocolo ${payload.protocolo} enviado para o Financeiro. Valor real a pagar ${Number(payload.valor_real_a_pagar || 0).toFixed(2)}.`,
    dados: {
      status_fatura_protocolo: payload.status_fatura_protocolo,
      desconto_total: payload.desconto_total,
      centro_custo_codigo: payload.centro_custo_codigo,
      partida: payload.partida,
    },
    usuario_id: usuario.id || '',
    usuario_nome: usuario.nome || '',
    created_at: new Date().toISOString(),
  };
  await inserirHistorico('financeiro_protocolo_historico', eventoProtocolo);

  const faturaAtualizada = {
    ...fatura,
    status: 'ENVIADA_AO_FINANCEIRO',
    canal_envio_financeiro: 'PROTOCOLO_FINANCEIRO',
    protocolo_financeiro_id: payload.id,
  };
  const proximoEstado = await atualizarFaturaAuditoria({ ...state, protocolos: [payload, ...(state.protocolos || [])] }, faturaAtualizada, {
    acao: 'ENVIADA_AO_FINANCEIRO',
    status_anterior: fatura.status,
    status_novo: 'ENVIADA_AO_FINANCEIRO',
    descricao: `Enviada para Protocolo Financeiro (${payload.protocolo}).`,
    usuario_nome: usuario.nome || 'Usuario local',
    usuario_email: usuario.email || '',
  });

  return { state: proximoEstado, protocolo: payload };
}

export function restaurarDemonstracaoAuditoria() {
  return writeLocal(demoState());
}

export function urlPortalFatura(token) {
  if (!token) return '';
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  return `${base}/api/portal-fatura/${token}`;
}

// Gera (uma vez) o link de confirmacao da fatura pro transportador clicar OK
// direto no laudo — reaproveita o mesmo token em reenvios, ate ele confirmar.
export async function gerarLinkConfirmacaoFatura(state, fatura) {
  const viva = state.faturas?.find((item) => item.id === fatura.id);
  if (viva?.confirmacao_transportador_token && !fatura.confirmacao_transportador_token) {
    fatura = { ...fatura, confirmacao_transportador_token: viva.confirmacao_transportador_token };
  }
  if (!fatura.confirmacao_transportador_token && isSupabaseConfigured()) {
    // Estado local pode estar sem o token que ja existe no banco: reaproveita
    // em vez de gerar outro (que invalidaria o link ja enviado).
    try {
      const { data } = await getSupabaseClient().from('faturas').select('confirmacao_transportador_token').eq('id', fatura.id).maybeSingle();
      if (data?.confirmacao_transportador_token) fatura = { ...fatura, confirmacao_transportador_token: data.confirmacao_transportador_token };
    } catch { /* segue e gera um novo */ }
  }
  if (fatura.confirmacao_transportador_token) {
    return { state, url: urlPortalFatura(fatura.confirmacao_transportador_token), token: fatura.confirmacao_transportador_token };
  }
  const token = gerarTokenAleatorio();
  const agora = new Date().toISOString();
  const next = await atualizarFaturaAuditoria(state, {
    ...fatura,
    confirmacao_transportador_token: token,
    confirmacao_transportador_status: fatura.confirmacao_transportador_status || 'ENVIADO',
    confirmacao_transportador_enviado_em: agora,
  }, {
    acao: 'LINK_CONFIRMACAO_GERADO',
    descricao: 'Link de confirmacao da fatura gerado para envio ao transportador.',
  });
  // So devolve o link se o token realmente ficou no banco (o portal busca la).
  if (isSupabaseConfigured()) {
    const { data } = await getSupabaseClient().from('faturas').select('confirmacao_transportador_token').eq('id', fatura.id).maybeSingle();
    if (data?.confirmacao_transportador_token !== token) {
      throw new Error('o token do link nao foi gravado no banco. Tente novamente.');
    }
  }
  return { state: next, url: urlPortalFatura(token), token };
}
