export const FATURA_STATUS = [
  'RECEBIDA',
  'PRE_AUDITADA_VERUM',
  'REAUDITADA_CENTRAL',
  'COM_DIVERGENCIA',
  'AGUARDANDO_TRANSPORTADORA',
  'AGUARDANDO_NOVA_FATURA',
  'PRONTA_PARA_PAGAMENTO',
  'ENVIADA_AO_FINANCEIRO',
  'PAGA',
  'PAGA_COM_DIVERGENCIA',
  'TRATADA',
  'CANCELADA',
  'SUBSTITUIDA',
];

export const BOLETO_STATUS = [
  'PENDENTE',
  'RECEBIDO',
  'ENVIADO_FINANCEIRO',
  'PAGO',
  'VENCIDO',
  'SEM_BOLETO',
];

export const SOLICITACAO_FINANCEIRA_TIPOS = [
  'COMPROVANTE_PAGAMENTO',
  'REVERSAO_LANCAMENTO',
  'AJUSTE_FINANCEIRO',
  'PAGAMENTO_NAO_LOCALIZADO',
  'CORRECAO_FORNECEDOR',
  'CORRECAO_FATURA',
  'OUTROS',
];

const ENCERRADOS = new Set(['PAGA', 'PAGA_COM_DIVERGENCIA', 'CANCELADA', 'SUBSTITUIDA']);

export function isoDate(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

export function diasAte(data, referencia = new Date()) {
  if (!data) return null;
  const alvo = new Date(`${String(data).slice(0, 10)}T12:00:00`);
  const base = new Date(`${isoDate(referencia)}T12:00:00`);
  if (Number.isNaN(alvo.getTime())) return null;
  return Math.ceil((alvo.getTime() - base.getTime()) / 86400000);
}

export function faixaVencimento(fatura, referencia = new Date()) {
  if (!fatura?.data_vencimento || ENCERRADOS.has(fatura.status)) return 'SEM_ALERTA';
  const dias = diasAte(fatura.data_vencimento, referencia);
  if (dias == null) return 'SEM_ALERTA';
  if (dias < 0) return 'VENCIDA';
  if (dias <= 1) return 'CRITICO';
  if (dias <= 3) return 'LARANJA';
  if (dias <= 5) return 'AMARELO';
  if (dias <= 7) return 'VENCENDO_7_DIAS';
  return 'EM_DIA';
}

export function statusSla(item, referencia = new Date()) {
  if (!item?.prazo_sla) return 'SEM_PRAZO';
  if (['CONCLUIDA', 'CANCELADA'].includes(item.status)) return 'CONCLUIDO';
  const dias = diasAte(item.prazo_sla, referencia);
  if (dias == null) return 'SEM_PRAZO';
  if (dias < 0) return 'FORA_SLA';
  if (dias <= 1) return 'VENCENDO_SLA';
  return 'DENTRO_SLA';
}

export function gerarProtocolo(prefixo, existentes = [], referencia = new Date()) {
  const ano = new Date(referencia).getFullYear();
  const inicio = `${prefixo}-${ano}-`;
  const maior = existentes.reduce((max, item) => {
    const protocolo = typeof item === 'string' ? item : item?.protocolo;
    if (!String(protocolo || '').startsWith(inicio)) return max;
    const numero = Number(String(protocolo).slice(inicio.length));
    return Number.isFinite(numero) ? Math.max(max, numero) : max;
  }, 0);
  return `${inicio}${String(maior + 1).padStart(6, '0')}`;
}

export function montarNomeDoccob(fatura, referencia = new Date()) {
  const numero = String(fatura?.numero_fatura || 'SEM_FATURA').replace(/[^\w-]+/g, '_');
  const transportadora = String(fatura?.transportadora || 'SEM_TRANSPORTADORA')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w-]+/g, '_');
  return `DOCCOB_${numero}_${transportadora}_${isoDate(referencia).replaceAll('-', '')}`;
}

export function montarLinhasDoccob(fatura, detalhes = [], selecionados = []) {
  const ids = new Set(selecionados);
  return detalhes
    .filter((item) => ids.size === 0 || ids.has(item.id))
    .map((item) => ({
      Transportadora: fatura?.transportadora || item.transportadora || '',
      Fatura: fatura?.numero_fatura || item.numero_fatura || '',
      'Chave CT-e': item.chave_cte || '',
      'Numero CT-e': item.numero_cte || '',
      Valor: Number(item.valor_frete || 0),
      Motivo: item.motivo_divergencia || item.tratativa || 'DIVERGENCIA_AUDITORIA',
      Observacao: item.observacao || '',
    }));
}

export function calcularDashboard(faturas = [], referencia = new Date()) {
  const soma = (lista, campo) => lista.reduce((total, item) => total + Number(item[campo] || 0), 0);
  const porStatus = Object.fromEntries(FATURA_STATUS.map((status) => [
    status,
    faturas.filter((fatura) => fatura.status === status).length,
  ]));
  const vencidas = faturas.filter((fatura) => faixaVencimento(fatura, referencia) === 'VENCIDA');
  const vencendo3 = faturas.filter((fatura) => {
    const dias = diasAte(fatura.data_vencimento, referencia);
    return dias != null && dias >= 0 && dias <= 3 && !ENCERRADOS.has(fatura.status);
  });
  const vencendo7 = faturas.filter((fatura) => {
    const dias = diasAte(fatura.data_vencimento, referencia);
    return dias != null && dias >= 0 && dias <= 7 && !ENCERRADOS.has(fatura.status);
  });
  const divergentes = faturas.filter((fatura) =>
    fatura.status === 'COM_DIVERGENCIA' || Number(fatura.diferenca || 0) !== 0);
  const prontas = faturas.filter((fatura) => fatura.status === 'PRONTA_PARA_PAGAMENTO');
  const enviadas = faturas.filter((fatura) => fatura.status === 'ENVIADA_AO_FINANCEIRO');
  const pagas = faturas.filter((fatura) => ['PAGA', 'PAGA_COM_DIVERGENCIA'].includes(fatura.status));

  return {
    porStatus,
    recebidas: porStatus.RECEBIDA,
    emAuditoria: porStatus.PRE_AUDITADA_VERUM + porStatus.REAUDITADA_CENTRAL,
    aguardandoTransportadora: porStatus.AGUARDANDO_TRANSPORTADORA,
    aguardandoNovaFatura: porStatus.AGUARDANDO_NOVA_FATURA,
    prontas: prontas.length,
    enviadas: enviadas.length,
    pagas: pagas.length,
    vencidas: vencidas.length,
    vencendo3: vencendo3.length,
    vencendo7: vencendo7.length,
    valorAuditado: soma(faturas, 'valor_fatura'),
    valorDivergente: divergentes.reduce((total, item) => total + Math.abs(Number(item.diferenca || 0)), 0),
    valorRecuperado: soma(faturas, 'valor_recuperado'),
    valorAguardando: soma(
      faturas.filter((fatura) => ['AGUARDANDO_TRANSPORTADORA', 'AGUARDANDO_NOVA_FATURA'].includes(fatura.status)),
      'valor_fatura',
    ),
    valorPronto: soma(prontas, 'valor_fatura'),
    valorEnviado: soma(enviadas, 'valor_fatura'),
    valorPago: soma(pagas, 'valor_pago') || soma(pagas, 'valor_fatura'),
    ctesAuditados: soma(faturas, 'ctes_auditados') || soma(faturas, 'ctes_vinculados'),
    ctesDivergentes: soma(faturas, 'ctes_divergentes'),
    ctesSemCalculo: soma(faturas, 'ctes_sem_calculo'),
    ctesSemTabela: soma(faturas, 'ctes_sem_tabela'),
  };
}

export function conciliarPagamentos(faturas = [], pagamentos = []) {
  const porNumero = new Map(faturas.map((fatura) => [String(fatura.numero_fatura || '').trim(), fatura]));
  return pagamentos.map((pagamento) => {
    const numero = String(pagamento.numero_fatura || pagamento.fatura || '').trim();
    const fatura = porNumero.get(numero);
    if (!fatura) return { ...pagamento, resultado: 'NAO_LOCALIZADO' };
    const pago = Number(pagamento.valor_pago || pagamento.valor || 0);
    const esperado = Number(fatura.valor_fatura || 0);
    return {
      ...pagamento,
      fatura_id: fatura.id,
      resultado: Math.abs(pago - esperado) <= 0.01 ? 'PAGO' : 'DIVERGENTE',
      diferenca: pago - esperado,
    };
  });
}
