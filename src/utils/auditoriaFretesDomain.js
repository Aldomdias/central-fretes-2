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
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_');
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

// --- DOCCOB EDI (padrao PROCEDA 3.0A, registros de largura fixa 170) ---
// Campos "A" (alfanumericos): maiusculos, alinhados a esquerda, espacos a direita.
// Campos "N" (numericos): alinhados a direita, zeros a esquerda, valores 13,2
// viram 15 digitos sem separador decimal. Datas DDMMAAAA (DDMMAA no registro 000).

const TAMANHO_REGISTRO_EDI = 170;

function campoAlfa(valor, tamanho) {
  const texto = String(valor ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[\r\n;|]+/g, ' ')
    .toUpperCase();
  return texto.slice(0, tamanho).padEnd(tamanho, ' ');
}

function campoNumerico(valor, tamanho) {
  const digitos = String(valor ?? '').replace(/\D/g, '').slice(-tamanho);
  return digitos.padStart(tamanho, '0');
}

function campoValorEdi(valor, inteiros = 13, decimais = 2) {
  const centavos = Math.round(Math.abs(Number(valor || 0)) * 10 ** decimais);
  return String(centavos).slice(-(inteiros + decimais)).padStart(inteiros + decimais, '0');
}

function dataEdi(iso, tamanho = 8) {
  const [ano, mes, dia] = String(iso || '').slice(0, 10).split('-');
  if (!ano || !mes || !dia) return '0'.repeat(tamanho);
  return tamanho === 6 ? `${dia}${mes}${ano.slice(2)}` : `${dia}${mes}${ano}`;
}

function fecharRegistroEdi(campos) {
  const linha = campos.join('');
  return linha.padEnd(TAMANHO_REGISTRO_EDI, ' ').slice(0, TAMANHO_REGISTRO_EDI);
}

export function montarArquivoDoccobEdi(fatura, detalhes = [], selecionados = [], opcoes = {}) {
  const referencia = opcoes.referencia ? new Date(opcoes.referencia) : new Date();
  const ids = new Set(selecionados);
  const ctes = detalhes.filter((item) => ids.size === 0 || ids.has(item.id));
  const valorTotal = ctes.reduce((total, item) => total + Number(item.valor_frete || 0), 0);
  const dd = String(referencia.getDate()).padStart(2, '0');
  const mm = String(referencia.getMonth() + 1).padStart(2, '0');
  const hh = String(referencia.getHours()).padStart(2, '0');
  const mi = String(referencia.getMinutes()).padStart(2, '0');
  const dataIso = referencia.toISOString().slice(0, 10);
  const filial = fatura?.filial || '';

  const linhas = [
    fecharRegistroEdi([
      '000',
      campoAlfa(opcoes.remetente || fatura?.transportadora, 35),
      campoAlfa(opcoes.destinatario || 'AMD', 35),
      dataEdi(dataIso, 6),
      `${hh}${mi}`,
      campoAlfa(`COB${dd}${mm}${hh}${mi}0`, 12),
    ]),
    fecharRegistroEdi(['350', campoAlfa(`COBRA${dd}${mm}${hh}${mi}0`, 14)]),
    fecharRegistroEdi(['351', campoNumerico(fatura?.cnpj_transportadora, 14), campoAlfa(fatura?.transportadora, 40)]),
    fecharRegistroEdi([
      '352',
      campoAlfa(filial, 10),
      '0',
      campoAlfa(fatura?.serie_fatura, 3),
      campoNumerico(fatura?.numero_fatura, 10),
      dataEdi(fatura?.data_emissao),
      dataEdi(fatura?.data_vencimento),
      campoValorEdi(valorTotal),
      campoAlfa(opcoes.tipoCobranca, 3),
      campoValorEdi(fatura?.valor_icms),
      campoValorEdi(0), // juros por dia de atraso (condicional)
      '0'.repeat(8), // data limite p/ desconto (condicional)
      campoValorEdi(0), // valor do desconto (condicional)
      campoAlfa(opcoes.agenteCobranca, 35),
      campoNumerico(0, 4),
      ' ',
      campoNumerico(0, 10),
      '  ',
      'I',
    ]),
    ...ctes.map((item) => fecharRegistroEdi([
      '353',
      campoAlfa(filial, 10),
      campoAlfa(item.serie_cte, 5),
      campoAlfa(item.numero_cte, 12),
    ])),
    fecharRegistroEdi(['355', campoNumerico(1, 4), campoValorEdi(valorTotal)]),
  ];
  return linhas.join('\r\n');
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
  const normalizar = (valor) => String(valor || '').trim().toUpperCase();
  const porNumero = new Map();
  for (const fatura of faturas) {
    const numero = normalizar(fatura.numero_fatura);
    if (!numero) continue;
    porNumero.set(numero, [...(porNumero.get(numero) || []), fatura]);
  }
  return pagamentos.map((pagamento) => {
    const numero = normalizar(pagamento.numero_fatura || pagamento.fatura);
    const candidatas = porNumero.get(numero) || [];
    // O mesmo numero de fatura pode existir em transportadoras diferentes e em
    // faturas ja encerradas (substituida/cancelada): prioriza as em aberto e,
    // persistindo empate, exige a transportadora do relatorio para desambiguar.
    const abertas = candidatas.filter((fatura) => !ENCERRADOS.has(fatura.status));
    let alvo = abertas.length ? abertas : candidatas;
    const transportadoraPagamento = normalizar(pagamento.transportadora || pagamento.cnpj_transportadora);
    if (alvo.length > 1 && transportadoraPagamento) {
      const filtradas = alvo.filter((fatura) =>
        normalizar(fatura.transportadora) === transportadoraPagamento
        || normalizar(fatura.cnpj_transportadora) === transportadoraPagamento);
      if (filtradas.length) alvo = filtradas;
    }
    if (!alvo.length) return { ...pagamento, resultado: 'NAO_LOCALIZADO' };
    if (alvo.length > 1) return { ...pagamento, resultado: 'AMBIGUO' };
    const fatura = alvo[0];
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
