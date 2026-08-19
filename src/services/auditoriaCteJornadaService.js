import { getSupabaseClient } from '../lib/supabaseClient';
import { usuarioEhGestorAuditoria } from '../utils/authLocal';

function ensureClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase não configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');
  }
  return client;
}

export const STATUS_OPERACIONAL = {
  NAO_AUDITADO: 'Não auditado',
  AUDITADO_OK: 'Auditado OK',
  DIVERGENTE: 'Divergente',
  AGUARDANDO_ENVIO_TRANSPORTADORA: 'Aguardando envio à transportadora',
  AGUARDANDO_RETORNO_TRANSPORTADORA: 'Aguardando retorno da transportadora',
  EM_TRATATIVA: 'Em tratativa',
  ACORDO_FECHADO: 'Acordo fechado',
  CANCELAMENTO_SOLICITADO: 'Cancelamento solicitado',
  CANCELADO: 'Cancelado',
  REEMITIDO: 'Reemitido',
  AGUARDANDO_FATURA: 'Aguardando fatura',
  FATURADO: 'Faturado',
  CONCILIADO_FATURA: 'Conciliado com fatura',
  ENCERRADO: 'Encerrado',
};

export const STATUS_FINANCEIRO = {
  SEM_IMPACTO: 'Sem impacto',
  DIVERGENCIA_IDENTIFICADA: 'Divergência identificada',
  DESCONTO_SOLICITADO: 'Desconto solicitado',
  DESCONTO_ACEITO: 'Desconto aceito',
  DESCONTO_PENDENTE_APLICACAO: 'Desconto pendente de aplicação',
  DESCONTO_APLICADO_FATURA: 'Desconto aplicado na fatura',
  RECUPERADO_CANCELAMENTO: 'Recuperado por cancelamento',
  COBRANCA_A_MENOR: 'Cobrança a menor',
  ENCERRADO_SEM_RECUPERACAO: 'Encerrado sem recuperação',
  PAGO: 'Pago',
  CONCILIADO: 'Conciliado',
};

// Opções do mini-formulário "registrar retorno da transportadora" — usado
// tanto na tabela de detalhe quanto na Auditoria por chave/lista.
export const RESULTADOS_RETORNO_TRANSPORTADORA = {
  concordou_desconto: { label: 'Concordou — desconto na fatura', statusOperacional: 'ACORDO_FECHADO', statusFinanceiro: 'DESCONTO_ACEITO', pedeValor: true },
  concordou_cancelamento: { label: 'Concordou — cancelar e reemitir', statusOperacional: 'CANCELAMENTO_SOLICITADO', statusFinanceiro: 'DIVERGENCIA_IDENTIFICADA', pedeValor: false },
  nao_concordou: { label: 'Não concordou', statusOperacional: 'EM_TRATATIVA', statusFinanceiro: 'DIVERGENCIA_IDENTIFICADA', pedeValor: false },
  em_analise: { label: 'Em análise (transportadora ainda avaliando)', statusOperacional: 'EM_TRATATIVA', statusFinanceiro: null, pedeValor: false },
};

export const JORNADA_COR = {
  NAO_AUDITADO: { bg: '#e2e8f0', fg: '#475569' },
  AUDITADO_OK: { bg: '#dcfce7', fg: '#166534' },
  DIVERGENTE: { bg: '#fef3c7', fg: '#92400e' },
  AGUARDANDO_ENVIO_TRANSPORTADORA: { bg: '#dbeafe', fg: '#1e40af' },
  AGUARDANDO_RETORNO_TRANSPORTADORA: { bg: '#dbeafe', fg: '#1e40af' },
  EM_TRATATIVA: { bg: '#fae8ff', fg: '#86198f' },
  ACORDO_FECHADO: { bg: '#d1fae5', fg: '#065f46' },
  CANCELAMENTO_SOLICITADO: { bg: '#fee2e2', fg: '#991b1b' },
  CANCELADO: { bg: '#fee2e2', fg: '#991b1b' },
  REEMITIDO: { bg: '#e0e7ff', fg: '#3730a3' },
  AGUARDANDO_FATURA: { bg: '#fef9c3', fg: '#854d0e' },
  FATURADO: { bg: '#cffafe', fg: '#155e75' },
  CONCILIADO_FATURA: { bg: '#d1fae5', fg: '#065f46' },
  ENCERRADO: { bg: '#e2e8f0', fg: '#334155' },
};

const DIAS_ALERTA_AGUARDANDO_RETORNO = 7;
const DIAS_ALERTA_AUDITADO_SEM_FATURA = 15;

function nowIso() {
  return new Date().toISOString();
}

/**
 * Garante que exista uma linha de jornada para cada chave_cte informada,
 * atualizando status_operacional/valores a partir do resultado do cálculo.
 * Upsert por chave_cte — não sobrescreve campos de tratativa/financeiro
 * que não vieram no resultado do cálculo.
 */
export async function sincronizarJornadaComResultados(resultados = []) {
  if (!resultados.length) return { atualizados: 0 };
  const client = ensureClient();

  const linhas = resultados
    .filter((r) => r.chave_cte || r.chaveCte)
    .map((r) => {
      const chaveCte = r.chave_cte || r.chaveCte;
      const divergente = Number(r.diferenca_abs ?? r.diferencaAbs ?? 0) > 0;
      return {
        chave_cte: chaveCte,
        numero_cte: r.numero_cte || r.numeroCte || null,
        competencia: r.competencia || null,
        transportadora: r.transportadora || null,
        cnpj_transportadora: r.cnpj_transportadora || r.cnpjTransportadora || null,
        status_operacional: divergente ? 'DIVERGENTE' : 'AUDITADO_OK',
        status_financeiro: divergente ? 'DIVERGENCIA_IDENTIFICADA' : 'SEM_IMPACTO',
        valor_cobrado: Number(r.valor_cte ?? r.valorCte ?? 0),
        valor_correto: Number(r.valor_calculado ?? r.valorCalculado ?? 0),
        valor_divergencia_identificada: Number(r.diferenca_abs ?? r.diferencaAbs ?? 0),
        updated_at: nowIso(),
      };
    });

  if (!linhas.length) return { atualizados: 0 };

  const { error } = await client
    .from('auditoria_cte_jornada')
    .upsert(linhas, { onConflict: 'chave_cte' });

  if (error) throw error;
  return { atualizados: linhas.length };
}

export async function buscarJornadaPorChaves(chaves = []) {
  if (!chaves.length) return [];
  const client = ensureClient();
  const { data, error } = await client
    .from('auditoria_cte_jornada')
    .select('*')
    .in('chave_cte', chaves);
  if (error) throw error;
  return data || [];
}

async function registrarEvento(client, { chaveCte, processoId, jornadaId, acao, statusAnterior, statusNovo, comentario, usuario }) {
  await client.from('audit_historico_eventos').insert({
    chave_cte: chaveCte || null,
    processo_id: processoId || null,
    jornada_id: jornadaId || null,
    acao,
    status_anterior: statusAnterior || null,
    status_novo: statusNovo || null,
    comentario: comentario || null,
    user_id: usuario?.id || null,
    user_name: usuario?.nome || null,
    user_email: usuario?.email || null,
    origem_tela: 'auditoria-cte',
  });
}

/**
 * Gera o registro do laudo como um "processo" (Fase 6).
 * Gerar != enviar: só marca CT-es como AGUARDANDO_RETORNO_TRANSPORTADORA
 * quando `enviarAgora` for true (Fase 7).
 */
export async function registrarLaudoGerado({
  transportadora,
  cnpjTransportadora,
  competencia,
  ctes = [],
  observacao,
  enviarAgora,
  usuario,
  // Token já embutido no laudo que acabou de ser baixado. Vem de fora porque o
  // download precisa sair junto com o clique, sem esperar o banco.
  tokenPortal,
}) {
  const client = ensureClient();

  const valorTotalCobrado = ctes.reduce((acc, c) => acc + Number(c.valor_cte || c.valorCte || 0), 0);
  const valorTotalCalculado = ctes.reduce((acc, c) => acc + Number(c.valor_calculado || c.valorCalculado || 0), 0);
  const valorTotalDivergente = ctes.reduce((acc, c) => acc + Number(c.diferenca_abs || c.diferencaAbs || 0), 0);

  const { data: processo, error: erroProcesso } = await client
    .from('auditoria_cte_processos')
    .insert({
      competencia: competencia || null,
      transportadora: transportadora || null,
      cnpj_transportadora: cnpjTransportadora || null,
      auditor_id: usuario?.id || null,
      auditor_nome: usuario?.nome || null,
      qtd_ctes: ctes.length,
      valor_total_cobrado: valorTotalCobrado,
      valor_total_calculado: valorTotalCalculado,
      valor_total_divergente: valorTotalDivergente,
      laudo_gerado_em: nowIso(),
      laudo_gerado_por: usuario?.nome || null,
      observacao: observacao || null,
      enviado: Boolean(enviarAgora),
      enviado_em: enviarAgora ? nowIso() : null,
      enviado_por: enviarAgora ? usuario?.nome || null : null,
      status: enviarAgora ? 'AGUARDANDO_RETORNO' : 'GERADO',
    })
    .select()
    .single();

  if (erroProcesso) throw erroProcesso;

  const itens = ctes
    .map((c) => c.chave_cte || c.chaveCte)
    .filter(Boolean)
    .map((chaveCte, idx) => ({
      processo_id: processo.id,
      chave_cte: chaveCte,
      numero_cte: ctes[idx]?.numero_cte || ctes[idx]?.numeroCte || null,
      valor_cte: Number(ctes[idx]?.valor_cte || ctes[idx]?.valorCte || 0),
      valor_calculado: Number(ctes[idx]?.valor_calculado || ctes[idx]?.valorCalculado || 0),
      diferenca: Number(ctes[idx]?.diferenca_abs || ctes[idx]?.diferencaAbs || 0),
    }));

  if (itens.length) {
    const { error: erroItens } = await client.from('auditoria_cte_processo_ctes').insert(itens);
    if (erroItens) throw erroItens;
  }

  await registrarEvento(client, {
    processoId: processo.id,
    acao: 'LAUDO_GERADO',
    comentario: `Laudo ${processo.codigo} gerado com ${ctes.length} CT-e(s).`,
    usuario,
  });

  if (itens.length) {
    // Regenerar um laudo (ex: só pra conferir de novo) não pode "rebaixar" um
    // CT-e que já avançou na jornada (ex: já está aguardando retorno, em
    // tratativa, com acordo fechado...) de volta pra DIVERGENTE/AUDITADO_OK.
    // Só os status "iniciais" (sem jornada ainda, ou NAO_AUDITADO) são
    // substituídos livremente pelo resultado do cálculo.
    const chavesDoLaudo = ctes.map((c) => c.chave_cte || c.chaveCte).filter(Boolean);
    const { data: existentes, error: erroExistentes } = await client
      .from('auditoria_cte_jornada')
      .select('chave_cte, status_operacional, status_financeiro, aguardando_desde')
      .in('chave_cte', chavesDoLaudo);
    if (erroExistentes) throw erroExistentes;
    const existentePorChave = new Map((existentes || []).map((l) => [l.chave_cte, l]));
    const STATUS_INICIAIS = new Set([undefined, null, 'NAO_AUDITADO', 'AUDITADO_OK', 'DIVERGENTE']);

    // Upsert (não update): a jornada pode ainda não ter linha para este CT-e
    // se ele nunca passou pela sincronização automática do cálculo — o laudo
    // é, por si só, evidência suficiente de que o CT-e foi auditado.
    const linhasJornada = ctes
      .filter((c) => c.chave_cte || c.chaveCte)
      .map((c) => {
        const chaveCte = c.chave_cte || c.chaveCte;
        const divergente = Number(c.diferenca_abs ?? c.diferencaAbs ?? 0) > 0;
        const existente = existentePorChave.get(chaveCte);
        const statusAtual = existente?.status_operacional;
        const podeAvancarPeloCalculo = STATUS_INICIAIS.has(statusAtual);
        const statusOperacional = enviarAgora
          ? 'AGUARDANDO_RETORNO_TRANSPORTADORA'
          : (podeAvancarPeloCalculo ? (divergente ? 'DIVERGENTE' : 'AUDITADO_OK') : statusAtual);
        // status_financeiro e aguardando_desde só mudam quando o status
        // operacional também está sendo (re)definido nesta chamada — senão
        // preserva o valor que já existia (upsert em lote precisa de chaves
        // consistentes em todas as linhas, então sempre incluímos as duas).
        const statusFinanceiro = (enviarAgora || podeAvancarPeloCalculo)
          ? (divergente ? 'DIVERGENCIA_IDENTIFICADA' : 'SEM_IMPACTO')
          : (existente?.status_financeiro ?? null);
        const aguardandoDesde = enviarAgora ? nowIso() : (existente?.aguardando_desde ?? null);
        return {
          chave_cte: chaveCte,
          numero_cte: c.numero_cte || c.numeroCte || null,
          competencia: competencia || null,
          transportadora: transportadora || null,
          cnpj_transportadora: cnpjTransportadora || null,
          status_operacional: statusOperacional,
          status_financeiro: statusFinanceiro,
          valor_cobrado: Number(c.valor_cte ?? c.valorCte ?? 0),
          valor_correto: Number(c.valor_calculado ?? c.valorCalculado ?? 0),
          valor_divergencia_identificada: Number(c.diferenca_abs ?? c.diferencaAbs ?? 0),
          processo_id: processo.id,
          auditor_responsavel_id: usuario?.id || null,
          auditor_responsavel_nome: usuario?.nome || null,
          aguardando_desde: aguardandoDesde,
          updated_at: nowIso(),
        };
      });

    const { error: erroUpsert } = await client
      .from('auditoria_cte_jornada')
      .upsert(linhasJornada, { onConflict: 'chave_cte' });
    if (erroUpsert) throw erroUpsert;

    if (enviarAgora) {
      await registrarEvento(client, {
        processoId: processo.id,
        acao: 'LAUDO_ENVIADO',
        statusNovo: 'AGUARDANDO_RETORNO_TRANSPORTADORA',
        comentario: `Laudo ${processo.codigo} enviado à transportadora ${transportadora || ''}.`,
        usuario,
      });
    }
  }

  // Fase 14: todo laudo ganha um link de conferência. Mesmo quando é só
  // "gerar/visualizar", o link já existe para o caso de o auditor decidir
  // enviar depois — o que muda com `enviarAgora` é só o status dos CT-es.
  //
  // O portal é aditivo: se a migration dele ainda não rodou (ou o insert
  // falha por qualquer motivo), o laudo e a jornada continuam funcionando
  // normalmente — só sai sem o botão de resposta.
  let portal = null;
  try {
    portal = await gerarTokenPortal({
      client,
      processoId: processo.id,
      transportadora,
      cnpjTransportadora,
      usuario,
      token: tokenPortal,
    });
  } catch (error) {
    console.warn('[Jornada CT-e] link do portal não gerado (a migration do portal já rodou?):', error?.message || error);
  }

  return { ...processo, portal };
}

/** Token opaco de 32 bytes — Web Crypto, disponível no browser e no Node moderno.
 * Exportado porque o laudo precisa do token ANTES de gravar no banco: o download
 * tem que sair junto com o clique do usuário, sem esperar ida ao Supabase. */
export function gerarTokenAleatorio() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function urlPortalTransportadora(token) {
  if (!token) return '';
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  return `${base}/api/portal/${token}`;
}

async function gerarTokenPortal({ client, processoId, transportadora, cnpjTransportadora, usuario, diasValidade = 90, token: tokenPreGerado }) {
  const token = tokenPreGerado || gerarTokenAleatorio();
  const expiraEm = new Date(Date.now() + diasValidade * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await client
    .from('auditoria_cte_portal_tokens')
    .insert({
      token,
      processo_id: processoId,
      transportadora: transportadora || null,
      cnpj_transportadora: cnpjTransportadora || null,
      criado_por: usuario?.nome || usuario?.email || null,
      expira_em: expiraEm,
    })
    .select()
    .single();
  if (error) throw error;
  return { ...data, url: urlPortalTransportadora(token) };
}

/**
 * Fase 15 — respostas que a transportadora mandou pelo portal e ainda
 * não foram validadas pelo auditor. A resposta NUNCA aplica sozinha.
 */
export async function listarRespostasPortalPendentes({ competencia } = {}) {
  const client = ensureClient();
  const { data, error } = await client
    .from('auditoria_cte_portal_respostas')
    .select('*, processo:auditoria_cte_processos(codigo, competencia, transportadora)')
    .eq('status_validacao', 'PENDENTE')
    .order('respondido_em', { ascending: false });
  if (error) throw error;
  const linhas = data || [];
  if (!competencia) return linhas;
  return linhas.filter((l) => !l.processo?.competencia || l.processo.competencia === competencia);
}

/**
 * Aplica (ou rejeita) a resposta do portal. Aplicar = mesmo efeito de
 * registrar o retorno manualmente, só que partindo do que a transportadora
 * respondeu — com o auditor confirmando.
 */
export async function validarRespostaPortal({ resposta, aplicar, observacao, usuario }) {
  const client = ensureClient();

  if (aplicar) {
    const config = RESULTADOS_RETORNO_TRANSPORTADORA[resposta.resultado];
    if (!config) throw new Error(`Resultado desconhecido na resposta: ${resposta.resultado}`);

    const { data: jornada } = await client
      .from('auditoria_cte_jornada')
      .select('valor_divergencia_identificada')
      .eq('chave_cte', resposta.chave_cte)
      .maybeSingle();

    await atualizarStatusJornada({
      chaveCte: resposta.chave_cte,
      statusOperacional: config.statusOperacional,
      statusFinanceiro: config.statusFinanceiro || undefined,
      valorAcordado: config.pedeValor
        ? Number(resposta.valor_proposto ?? jornada?.valor_divergencia_identificada ?? 0)
        : undefined,
      observacao: `Via portal (${resposta.respondido_por || 'transportadora'}): ${config.label}`
        + (resposta.justificativa ? ` — ${resposta.justificativa}` : ''),
      usuario,
    });
  }

  const { error } = await client
    .from('auditoria_cte_portal_respostas')
    .update({
      status_validacao: aplicar ? 'APLICADO' : 'REJEITADO',
      validado_em: nowIso(),
      validado_por: usuario?.nome || usuario?.email || null,
      observacao_validacao: observacao || null,
    })
    .eq('id', resposta.id);
  if (error) throw error;

  await registrarEvento(client, {
    chaveCte: resposta.chave_cte,
    processoId: resposta.processo_id,
    acao: aplicar ? 'RESPOSTA_PORTAL_APLICADA' : 'RESPOSTA_PORTAL_REJEITADA',
    comentario: `Resposta do portal ${aplicar ? 'aplicada' : 'rejeitada'} pelo auditor.`
      + (observacao ? ` Obs: ${observacao}` : ''),
    usuario,
  });
}

/**
 * Busca a jornada de um conjunto de CT-es (por chave ou número), em lotes de 200.
 * Usado para mostrar "em que fase está" na tabela de detalhe da auditoria.
 * Retorna um Map chave_cte|numero_cte -> linha da jornada.
 */
export async function buscarJornadaPorIdentificadores(identificadores = []) {
  const normalizados = [...new Set((identificadores || []).map((v) => String(v || '').trim()).filter(Boolean))];
  if (!normalizados.length) return new Map();
  const client = ensureClient();
  const linhas = [];
  for (let inicio = 0; inicio < normalizados.length; inicio += 200) {
    const lote = normalizados.slice(inicio, inicio + 200);
    const { data, error } = await client.from('auditoria_cte_jornada').select('*').in('chave_cte', lote);
    if (error) throw error;
    linhas.push(...(data || []));
  }
  const mapa = new Map();
  linhas.forEach((l) => {
    if (l.chave_cte) mapa.set(String(l.chave_cte), l);
    if (l.numero_cte) mapa.set(String(l.numero_cte), l);
  });
  return mapa;
}

export async function listarProcessos({ competencia, transportadora, status } = {}) {
  const client = ensureClient();
  let query = client.from('auditoria_cte_processos').select('*').order('created_at', { ascending: false });
  if (competencia) query = query.eq('competencia', competencia);
  if (transportadora) query = query.eq('transportadora', transportadora);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Painel de pendências (Fase 10/11) — carrega da jornada os grupos
 * de CT-es que precisam de atenção.
 */
export async function carregarPainelPendencias({ competencia } = {}) {
  const client = ensureClient();
  let query = client.from('auditoria_cte_jornada').select('*');
  if (competencia) query = query.eq('competencia', competencia);
  const { data, error } = await query;
  if (error) throw error;

  const linhas = data || [];
  const agora = Date.now();
  const diasDesde = (iso) => (iso ? (agora - new Date(iso).getTime()) / (1000 * 60 * 60 * 24) : null);

  const naoAuditados = linhas.filter((l) => l.status_operacional === 'NAO_AUDITADO');
  const auditadosOk = linhas.filter((l) => l.status_operacional === 'AUDITADO_OK');
  const divergentes = linhas.filter((l) => l.status_operacional === 'DIVERGENTE');
  const aguardandoRetorno = linhas.filter((l) => l.status_operacional === 'AGUARDANDO_RETORNO_TRANSPORTADORA');
  const aguardandoRetornoAtrasados = aguardandoRetorno.filter((l) => {
    const dias = diasDesde(l.aguardando_desde);
    return dias !== null && dias >= DIAS_ALERTA_AGUARDANDO_RETORNO;
  });
  const acordosFechadosAguardandoFatura = linhas.filter((l) => l.status_operacional === 'ACORDO_FECHADO' || l.status_operacional === 'AGUARDANDO_FATURA');
  const auditadosSemFatura = linhas.filter((l) => {
    if (!['AUDITADO_OK', 'DIVERGENTE', 'ACORDO_FECHADO', 'AGUARDANDO_FATURA'].includes(l.status_operacional)) return false;
    if (l.fatura_id) return false;
    const dias = diasDesde(l.updated_at);
    return dias !== null && dias >= DIAS_ALERTA_AUDITADO_SEM_FATURA;
  });
  const descontosAguardandoConciliacao = linhas.filter((l) => l.status_financeiro === 'DESCONTO_PENDENTE_APLICACAO' || l.status_financeiro === 'DESCONTO_ACEITO');
  // Fase 4/11: transportadora já concordou em cancelar, mas o CT-e substituto
  // ainda não foi vinculado (chave_cte_substituto vazio).
  const cancelamentosAguardandoReemissao = linhas.filter((l) => l.status_operacional === 'CANCELAMENTO_SOLICITADO' && !l.chave_cte_substituto);

  const valorDivergenteIdentificado = linhas.reduce((acc, l) => acc + Number(l.valor_divergencia_identificada || 0), 0);
  const valorAcordado = linhas.reduce((acc, l) => acc + Number(l.valor_acordado || 0), 0);
  const valorRecuperado = linhas.reduce((acc, l) => acc + Number(l.valor_recuperado || 0), 0);

  // Respostas que chegaram pelo portal e ainda dependem do aval do auditor.
  // Consulta separada porque não vivem na tabela de jornada — e é aditiva:
  // se a migration do portal ainda não rodou, o painel segue funcionando.
  let respostasPortalPendentes = [];
  try {
    const { data: respostas } = await client
      .from('auditoria_cte_portal_respostas')
      .select('id, chave_cte, numero_cte, transportadora, resultado, respondido_em')
      .eq('status_validacao', 'PENDENTE');
    respostasPortalPendentes = respostas || [];
  } catch (error) {
    console.warn('[Jornada CT-e] respostas do portal indisponíveis:', error?.message || error);
  }

  // Chaves que já têm uma decisão registrada — o painel usa isso pra saber o
  // que ainda falta auditar entre os CT-es carregados na tela, sem precisar
  // buscar a jornada de milhares de chaves uma a uma.
  const chavesTratadas = new Set(
    linhas.filter((l) => l.status_operacional && l.status_operacional !== 'NAO_AUDITADO').map((l) => String(l.chave_cte)),
  );

  return {
    naoAuditados,
    auditadosOk,
    divergentes,
    aguardandoRetorno,
    aguardandoRetornoAtrasados,
    acordosFechadosAguardandoFatura,
    auditadosSemFatura,
    descontosAguardandoConciliacao,
    cancelamentosAguardandoReemissao,
    respostasPortalPendentes,
    chavesTratadas,
    valorDivergenteIdentificado,
    valorAcordado,
    valorRecuperado,
    totalCtes: linhas.length,
  };
}

export async function atualizarStatusJornada({
  chaveCte,
  statusOperacional,
  statusFinanceiro,
  valorAcordado,
  valorRecuperado,
  origemRecuperacao,
  observacao,
  usuario,
}) {
  const client = ensureClient();

  const { data: atual } = await client
    .from('auditoria_cte_jornada')
    .select('status_operacional, status_financeiro, id')
    .eq('chave_cte', chaveCte)
    .maybeSingle();

  const patch = { updated_at: nowIso() };
  if (statusOperacional) patch.status_operacional = statusOperacional;
  if (statusFinanceiro) patch.status_financeiro = statusFinanceiro;
  if (valorAcordado !== undefined && valorAcordado !== null) patch.valor_acordado = Number(valorAcordado) || 0;
  if (valorRecuperado !== undefined && valorRecuperado !== null) patch.valor_recuperado = Number(valorRecuperado) || 0;
  if (origemRecuperacao) patch.origem_recuperacao = origemRecuperacao;
  if (observacao) patch.observacao = observacao;
  // Saiu de "aguardando retorno" -> zera o cronômetro de SLA (Fase 10).
  if (statusOperacional && statusOperacional !== 'AGUARDANDO_RETORNO_TRANSPORTADORA') patch.aguardando_desde = null;

  const { error } = await client.from('auditoria_cte_jornada').update(patch).eq('chave_cte', chaveCte);
  if (error) throw error;

  await registrarEvento(client, {
    chaveCte,
    jornadaId: atual?.id,
    acao: 'STATUS_ATUALIZADO',
    statusAnterior: atual?.status_operacional,
    statusNovo: statusOperacional || atual?.status_operacional,
    comentario: observacao,
    usuario,
  });
}

/**
 * Fase 4 — vincula o CT-e cancelado ao CT-e substituto (reemissão).
 * O CT-e original nunca desaparece: fica CANCELADO, com a divergência
 * identificada marcada como recuperada (origem = CANCELAMENTO_CTE) e o
 * link pro substituto. O substituto ganha uma jornada própria (se ainda
 * não tinha) já apontando de volta pro original, pra rastreabilidade nos
 * dois sentidos.
 */
export async function vincularCancelamentoReemissao({ chaveCteOriginal, chaveCteSubstituto, motivo, usuario }) {
  const client = ensureClient();

  const { data: original, error: erroOriginal } = await client
    .from('auditoria_cte_jornada')
    .select('*')
    .eq('chave_cte', chaveCteOriginal)
    .maybeSingle();
  if (erroOriginal) throw erroOriginal;
  if (!original) throw new Error('Este CT-e não tem jornada registrada.');

  const valorRecuperado = Number(original.valor_divergencia_identificada || 0);

  const { error: erroUpdateOriginal } = await client
    .from('auditoria_cte_jornada')
    .update({
      status_operacional: 'CANCELADO',
      status_financeiro: 'RECUPERADO_CANCELAMENTO',
      chave_cte_substituto: chaveCteSubstituto,
      motivo_cancelamento_reemissao: motivo || null,
      valor_recuperado: valorRecuperado,
      origem_recuperacao: 'CANCELAMENTO_CTE',
      aguardando_desde: null,
      updated_at: nowIso(),
    })
    .eq('chave_cte', chaveCteOriginal);
  if (erroUpdateOriginal) throw erroUpdateOriginal;

  // Upsert do substituto — pode já ter jornada própria (se já foi auditado)
  // ou não (recém emitido); os dois casos viram um único registro linkado.
  const { error: erroUpsertSubstituto } = await client
    .from('auditoria_cte_jornada')
    .upsert({
      chave_cte: chaveCteSubstituto,
      chave_cte_original: chaveCteOriginal,
      competencia: original.competencia,
      transportadora: original.transportadora,
      cnpj_transportadora: original.cnpj_transportadora,
      status_operacional: 'REEMITIDO',
      updated_at: nowIso(),
    }, { onConflict: 'chave_cte', ignoreDuplicates: false })
    .select();
  if (erroUpsertSubstituto) throw erroUpsertSubstituto;
  // upsert acima sobrescreveria status_operacional mesmo se o substituto já
  // tivesse avançado além de REEMITIDO; como isso é o registro inicial do
  // vínculo (feito uma vez, na hora que a reemissão é identificada), não tem
  // como já existir estado mais avançado — mantém simples.

  await registrarEvento(client, {
    chaveCte: chaveCteOriginal,
    jornadaId: original.id,
    acao: 'CANCELADO_REEMITIDO',
    statusAnterior: original.status_operacional,
    statusNovo: 'CANCELADO',
    comentario: `Cancelado e substituído pelo CT-e ${chaveCteSubstituto}. Recuperação: ${valorRecuperado}. Motivo: ${motivo || '-'}`,
    usuario,
  });
  await registrarEvento(client, {
    chaveCte: chaveCteSubstituto,
    acao: 'REEMISSAO_VINCULADA',
    statusNovo: 'REEMITIDO',
    comentario: `Reemissão do CT-e cancelado ${chaveCteOriginal}. Motivo: ${motivo || '-'}`,
    usuario,
  });
}

/**
 * Anula a auditoria de um CT-e — volta a jornada pro estado inicial
 * (NAO_AUDITADO, sem acordo/recuperação), preservando o motivo e um evento
 * ANULADO no histórico. Só gestores (perfil GESTAO ou GESTOR_AUDITORIA_FRETES)
 * podem fazer isso — usado quando algo foi registrado errado e precisa voltar.
 */
export async function anularJornada({ chaveCte, motivo, usuario }) {
  if (!usuarioEhGestorAuditoria(usuario)) {
    throw new Error('Só gestores podem anular uma auditoria já registrada.');
  }
  if (!motivo || !motivo.trim()) {
    throw new Error('Informe o motivo da anulação.');
  }
  const client = ensureClient();

  const { data: atual } = await client
    .from('auditoria_cte_jornada')
    .select('status_operacional, status_financeiro, valor_acordado, valor_recuperado, id')
    .eq('chave_cte', chaveCte)
    .maybeSingle();
  if (!atual) throw new Error('Este CT-e não tem jornada registrada — nada para anular.');

  const { error } = await client
    .from('auditoria_cte_jornada')
    .update({
      status_operacional: 'NAO_AUDITADO',
      status_financeiro: 'SEM_IMPACTO',
      valor_acordado: 0,
      valor_recuperado: 0,
      origem_recuperacao: null,
      processo_id: null,
      auditor_responsavel_id: null,
      auditor_responsavel_nome: null,
      aguardando_desde: null,
      observacao: `Anulado por ${usuario?.nome || usuario?.email || 'gestor'}: ${motivo}`,
      updated_at: nowIso(),
    })
    .eq('chave_cte', chaveCte);
  if (error) throw error;

  await registrarEvento(client, {
    chaveCte,
    jornadaId: atual.id,
    acao: 'ANULADO',
    statusAnterior: atual.status_operacional,
    statusNovo: 'NAO_AUDITADO',
    comentario: `Anulação (estava: ${STATUS_OPERACIONAL[atual.status_operacional] || atual.status_operacional}, `
      + `financeiro: ${STATUS_FINANCEIRO[atual.status_financeiro] || atual.status_financeiro || '-'}, `
      + `acordado: ${atual.valor_acordado || 0}, recuperado: ${atual.valor_recuperado || 0}). Motivo: ${motivo}`,
    usuario,
  });
}

/**
 * Aplica a mesma decisão a muitos CT-es de uma vez.
 *
 * Faz upsert (não update): boa parte dos CT-es de um mês nunca passou por
 * laudo, logo não tem linha de jornada ainda — um update simples não gravaria
 * nada e a tela "salvaria" sem efeito. Vai em lotes pra não fazer uma ida ao
 * banco por CT-e.
 */
export async function registrarDecisaoJornadaEmLote({
  ctes = [],
  competencia,
  statusOperacional,
  statusFinanceiro,
  valorAcordadoPorChave,
  observacaoPorChave,
  observacao,
  usuario,
  onProgress,
  tamanhoLote = 200,
}) {
  const linhas = ctes.filter((c) => c.chave_cte);
  if (!linhas.length) return { atualizados: 0 };
  const client = ensureClient();

  const chaves = linhas.map((c) => String(c.chave_cte));
  const existentes = new Map();
  for (let i = 0; i < chaves.length; i += tamanhoLote) {
    const { data } = await client
      .from('auditoria_cte_jornada')
      .select('chave_cte, status_operacional, valor_acordado, valor_recuperado, aguardando_desde')
      .in('chave_cte', chaves.slice(i, i + tamanhoLote));
    (data || []).forEach((l) => existentes.set(String(l.chave_cte), l));
  }

  const agora = nowIso();
  const payload = linhas.map((c) => {
    const chave = String(c.chave_cte);
    const anterior = existentes.get(chave);
    const divergencia = Math.abs(Number(c.diferenca ?? ((Number(c.valor_cte || 0)) - (Number(c.valor_calculado || 0)))));
    return {
      chave_cte: chave,
      numero_cte: c.numero_cte || null,
      competencia: c.competencia || competencia || null,
      transportadora: c.transportadora || null,
      cnpj_transportadora: c.cnpj_transportadora || null,
      status_operacional: statusOperacional,
      status_financeiro: statusFinanceiro || (anterior?.status_financeiro ?? 'SEM_IMPACTO'),
      valor_cobrado: Number(c.valor_cte || 0),
      valor_correto: Number(c.valor_calculado || 0),
      valor_divergencia_identificada: divergencia,
      valor_acordado: valorAcordadoPorChave?.get?.(chave) ?? Number(anterior?.valor_acordado || 0),
      valor_recuperado: Number(anterior?.valor_recuperado || 0),
      auditor_responsavel_id: usuario?.id || null,
      auditor_responsavel_nome: usuario?.nome || null,
      // Sair de "aguardando retorno" zera o cronômetro de SLA (Fase 10).
      aguardando_desde: statusOperacional === 'AGUARDANDO_RETORNO_TRANSPORTADORA'
        ? (anterior?.aguardando_desde || agora)
        : null,
      observacao: observacaoPorChave?.get?.(chave) ?? observacao ?? null,
      updated_at: agora,
    };
  });

  let gravados = 0;
  for (let i = 0; i < payload.length; i += tamanhoLote) {
    const lote = payload.slice(i, i + tamanhoLote);
    const { error } = await client.from('auditoria_cte_jornada').upsert(lote, { onConflict: 'chave_cte' });
    if (error) throw error;

    const eventos = lote.map((linha) => ({
      chave_cte: linha.chave_cte,
      acao: 'STATUS_ATUALIZADO',
      status_anterior: existentes.get(linha.chave_cte)?.status_operacional || null,
      status_novo: statusOperacional,
      comentario: linha.observacao,
      user_id: usuario?.id || null,
      user_name: usuario?.nome || null,
      user_email: usuario?.email || null,
      origem_tela: 'auditoria-cte',
    }));
    // Histórico é complementar: se falhar, a decisão já gravada continua valendo.
    const { error: erroEventos } = await client.from('audit_historico_eventos').insert(eventos);
    if (erroEventos) console.warn('[Jornada CT-e] eventos não gravados neste lote:', erroEventos.message);

    gravados += lote.length;
    onProgress?.({ etapa: 'salvando_jornada', carregados: gravados, total: payload.length });
  }

  return { atualizados: gravados };
}

/**
 * Valida (aplica ou rejeita) várias respostas do portal de uma vez.
 *
 * Diferente de registrarDecisaoJornadaEmLote, aqui os valores do CT-e vêm da
 * jornada já existente — a resposta do portal não carrega valor_cte/calculado,
 * e sobrescrevê-los com zero apagaria a divergência identificada.
 */
export async function validarRespostasPortalEmLote({ respostas = [], aplicar, observacao, usuario, onProgress, tamanhoLote = 200 }) {
  const lista = respostas.filter((r) => r?.id);
  if (!lista.length) return { validadas: 0 };
  const client = ensureClient();
  const agora = nowIso();

  if (aplicar) {
    const chaves = [...new Set(lista.map((r) => String(r.chave_cte)).filter(Boolean))];
    const jornadaPorChave = new Map();
    for (let i = 0; i < chaves.length; i += tamanhoLote) {
      const { data } = await client
        .from('auditoria_cte_jornada')
        .select('*')
        .in('chave_cte', chaves.slice(i, i + tamanhoLote));
      (data || []).forEach((l) => jornadaPorChave.set(String(l.chave_cte), l));
    }

    const payload = [];
    const eventos = [];
    lista.forEach((resposta) => {
      const config = RESULTADOS_RETORNO_TRANSPORTADORA[resposta.resultado];
      if (!config) return;
      const chave = String(resposta.chave_cte);
      const atual = jornadaPorChave.get(chave);
      const divergencia = Number(atual?.valor_divergencia_identificada || 0);
      payload.push({
        ...(atual || { chave_cte: chave, numero_cte: resposta.numero_cte || null, transportadora: resposta.transportadora || null }),
        chave_cte: chave,
        status_operacional: config.statusOperacional,
        status_financeiro: config.statusFinanceiro || atual?.status_financeiro || 'SEM_IMPACTO',
        valor_acordado: config.pedeValor
          ? Number(resposta.valor_proposto ?? divergencia)
          : Number(atual?.valor_acordado || 0),
        aguardando_desde: null,
        observacao: `Via portal (${resposta.respondido_por || 'transportadora'}): ${config.label}`
          + (resposta.justificativa ? ` — ${resposta.justificativa}` : ''),
        updated_at: agora,
      });
      eventos.push({
        chave_cte: chave,
        processo_id: resposta.processo_id || null,
        acao: 'RESPOSTA_PORTAL_APLICADA',
        status_anterior: atual?.status_operacional || null,
        status_novo: config.statusOperacional,
        comentario: `Resposta do portal aplicada pelo auditor.${observacao ? ` Obs: ${observacao}` : ''}`,
        user_id: usuario?.id || null,
        user_name: usuario?.nome || null,
        user_email: usuario?.email || null,
        origem_tela: 'auditoria-cte',
      });
    });

    for (let i = 0; i < payload.length; i += tamanhoLote) {
      const lote = payload.slice(i, i + tamanhoLote);
      const { error } = await client.from('auditoria_cte_jornada').upsert(lote, { onConflict: 'chave_cte' });
      if (error) throw error;
      const { error: erroEventos } = await client.from('audit_historico_eventos').insert(eventos.slice(i, i + tamanhoLote));
      if (erroEventos) console.warn('[Jornada CT-e] eventos não gravados neste lote:', erroEventos.message);
      onProgress?.({ etapa: 'salvando_jornada', carregados: Math.min(i + tamanhoLote, payload.length), total: payload.length });
    }
  }

  const ids = lista.map((r) => r.id);
  for (let i = 0; i < ids.length; i += tamanhoLote) {
    const { error } = await client
      .from('auditoria_cte_portal_respostas')
      .update({
        status_validacao: aplicar ? 'APLICADO' : 'REJEITADO',
        validado_em: agora,
        validado_por: usuario?.nome || usuario?.email || null,
        observacao_validacao: observacao || null,
      })
      .in('id', ids.slice(i, i + tamanhoLote));
    if (error) throw error;
  }

  return { validadas: lista.length };
}

export async function carregarTimelineCte(chaveCte) {
  const client = ensureClient();
  const { data, error } = await client
    .from('audit_historico_eventos')
    .select('*')
    .eq('chave_cte', chaveCte)
    .order('data_hora', { ascending: false });
  if (error) throw error;
  return data || [];
}
