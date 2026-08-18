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

  return processo;
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

  const valorDivergenteIdentificado = linhas.reduce((acc, l) => acc + Number(l.valor_divergencia_identificada || 0), 0);
  const valorAcordado = linhas.reduce((acc, l) => acc + Number(l.valor_acordado || 0), 0);
  const valorRecuperado = linhas.reduce((acc, l) => acc + Number(l.valor_recuperado || 0), 0);

  return {
    naoAuditados,
    auditadosOk,
    divergentes,
    aguardandoRetorno,
    aguardandoRetornoAtrasados,
    acordosFechadosAguardandoFatura,
    auditadosSemFatura,
    descontosAguardandoConciliacao,
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
