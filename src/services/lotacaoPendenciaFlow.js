export const STATUS_AGUARDANDO_COMPLEMENTO_OPERACAO = 'AGUARDANDO_COMPLEMENTO_OPERACAO';
export const TIPO_SOLICITACAO_EXCECAO_SEM_CTE = 'EXCECAO_SEM_CTE';
export const PREFIXO_QUESTIONAMENTO_AUDITORIA_LOTACAO = 'Questionamento para Operação — Auditoria Lotação';

export function isStatusAguardandoOperacao(status = '') {
  return [
    'PENDENTE',
    'PENDENTE_OPERACAO',
    'EXCEDEU_AGUARDANDO_OPERACAO',
    'AGUARDANDO_OPERACAO',
    'AGUARDANDO_INFORMACAO',
    'AGUARDANDO_RESPOSTA',
    'AGUARDANDO_COMPLEMENTO_OPERACAO',
    'EM_ANALISE',
    'ABERTO',
  ].includes(String(status || '').trim().toUpperCase());
}

export function isMovimentoEncerradoAuditoria(item = {}) {
  const status = String(item.status || '').trim().toUpperCase();
  if ([
    'RECUSADO',
    'RECUSADO_OPERACAO',
    'REPROVADO',
    'NEGADO',
    'TRATADO',
    'CONCLUIDO',
    'CONCLUÍDO',
    'FINALIZADO',
    'AUDITADO_OK',
    'BAIXADO',
    'ENCERRADO',
    'LIBERADO_PAGAMENTO',
  ].includes(status)) return true;

  const questionamento = item.tipo === 'QUESTIONAMENTO_OPERACAO'
    || item.categoria === 'QUESTIONAMENTO_OPERACAO'
    || item.tipoGestao === 'QUESTIONAMENTO';
  const distVinculada = Boolean(item.dist || item.distKey || item.dist_key);
  return questionamento && status === 'RESPONDIDO_OPERACAO' && distVinculada;
}

export function montarComentarioDevolucaoOperacao(item = {}, complemento = '') {
  const respostaAnterior = String(
    item.resposta_operacao
    || item.respostaOperacao
    || item.resposta
    || '',
  ).trim();
  const justificativaAnterior = String(
    item.justificativa_operacao
    || item.justificativaOperacao
    || '',
  ).trim();

  return [
    `Complemento solicitado pela Auditoria: ${String(complemento || '').trim()}`,
    respostaAnterior ? `Resposta anterior da Operacao: ${respostaAnterior}` : '',
    justificativaAnterior ? `Justificativa anterior da Operacao: ${justificativaAnterior}` : '',
  ].filter(Boolean).join('\n\n');
}

export function isSolicitacaoExcecaoSemCte(item = {}) {
  const tipo = String(item.tipoOriginal || item.tipo || item.tipo_solicitacao || '').trim().toUpperCase();
  const descricao = String(item.descricaoProblema || item.descricao_problema || item.observacao || '').trim();
  return tipo === TIPO_SOLICITACAO_EXCECAO_SEM_CTE
    || descricao.includes('Tipo de solicitação: Exceção sem chave CT-e/CTU');
}
