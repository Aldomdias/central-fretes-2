import { excelDateToISO } from './auditoriaFretesImport.js';
import { obterRaizCnpj, raizCnpjValida } from './cnpj.js';

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

export const ENCERRADOS = new Set(['PAGA', 'PAGA_COM_DIVERGENCIA', 'CANCELADA', 'SUBSTITUIDA']);

export const TIPOS_ENVIO_PROTOCOLO = ['DADOS_BANCARIOS', 'BOLETO'];

export const STATUS_FATURA_PROTOCOLO = ['LANCAMENTO_MANUAL', 'COBRANCA_PROCESSADA', 'MISTA'];

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

export function normalizarChaveCte(chave) {
  return String(chave || '').replace(/\D/g, '');
}

// Cruza os CT-es da fatura com a base reauditada pelo motor Central Fretes
// (auditoria_cte_resultados). Convencoes iguais as da Auditoria CT-e:
// diferenca = cobrado - calculado; sem calculo => diferenca 0 (a pendencia
// aparece na aba "Sem calculo", nao no valor divergente).
export function aplicarReauditoriaDetalhes(detalhes = [], resultadosPorChave = new Map()) {
  const atualizados = detalhes.map((item) => {
    const resultado = resultadosPorChave.get(normalizarChaveCte(item.chave_cte))
      || resultadosPorChave.get(normalizarChaveCte(item.numero_cte));
    const calculado = Number(resultado?.valor_calculado || 0);
    const calculadoVerum = Number(resultado?.valor_calculado_verum ?? resultado?.valor_calculado ?? item.calculado_frete_verum ?? 0);
    const valor = Number(item.valor_frete || 0);
    if (calculado <= 0) {
      return {
        ...item,
        calculado_frete_verum: calculadoVerum || Number(item.calculado_frete_verum || 0),
        calculado_frete: 0,
        diferenca: 0,
        status: 'SEM_CALCULO',
        motivo_divergencia: resultado?.motivo_sem_calculo || item.motivo_divergencia || 'CT-e sem calculo AMD.',
      };
    }
    const diferenca = Number((valor - calculado).toFixed(2));
    return {
      ...item,
      calculado_frete_verum: calculadoVerum,
      calculado_frete: calculado,
      diferenca,
      status: Math.abs(diferenca) <= 0.01 ? 'OK' : 'DIVERGENTE',
      motivo_divergencia: resultado?.motivo_sem_calculo || item.motivo_divergencia || '',
    };
  });
  const divergentes = atualizados.filter((item) => item.status === 'DIVERGENTE');
  const resumo = {
    total: atualizados.length,
    divergentes: divergentes.length,
    semCalculo: atualizados.filter((item) => item.status === 'SEM_CALCULO').length,
    valorCalculado: Number(atualizados.reduce((total, item) => total + Number(item.calculado_frete || 0), 0).toFixed(2)),
    valorDivergente: Number(divergentes.reduce((total, item) => total + Number(item.diferenca || 0), 0).toFixed(2)),
  };
  return { detalhes: atualizados, resumo };
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
  const filial = fatura?.filial || ctes[0]?.filial || '';
  const cnpjTransportadora = fatura?.cnpj_transportadora || ctes[0]?.cnpj_transportadora || '';
  const nomeTransportadora = fatura?.transportadora || ctes[0]?.transportadora || '';

  const linhas = [
    fecharRegistroEdi([
      '000',
      campoAlfa(opcoes.remetente || nomeTransportadora, 35),
      // Nome do TOMADOR do servico (o cliente/embarcador cobrado), nao da
      // AMD nem da transportadora - confirmado num arquivo real que
      // integrou certo com outra transportadora.
      campoAlfa(opcoes.destinatario || ctes[0]?.tomador_servico || 'AMD', 35),
      dataEdi(dataIso, 6),
      `${hh}${mi}`,
      campoAlfa(`COB${dd}${mm}${hh}${mi}0`, 12),
    ]),
    fecharRegistroEdi(['350', campoAlfa(`COBRA${dd}${mm}${hh}${mi}0`, 14)]),
    fecharRegistroEdi(['351', campoNumerico(cnpjTransportadora, 14), campoAlfa(nomeTransportadora, 40)]),
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
    ...ctes.flatMap((item) => [
      fecharRegistroEdi([
        '353',
        campoAlfa(item.filial || filial, 10),
        campoAlfa(item.serie_cte, 5),
        campoAlfa(item.numero_cte, 12),
        // Bloco extra (fora do manual PROCEDA padrao, mas confirmado num
        // arquivo real que integrou certo com outra transportadora nessa
        // mesma integracao AMD/Verum): 10 zeros + 5 zeros + data do CT-e +
        // CGC emissor da NF + CGC do tomador + CGC da transportadora. E o
        // que preenche o "CNPJ Emissor" que o Verum pede pra achar o CT-e.
        '0'.repeat(10),
        '0'.repeat(5),
        dataEdi(item.data_emissao),
        campoNumerico(item.cnpj_emissor_nf || opcoes.cnpjEmissorNf, 14),
        campoNumerico(item.cnpj_tomador, 14),
        campoNumerico(item.cnpj_transportadora || cnpjTransportadora, 14),
      ]),
      // CNF - nota(s) fiscal(is) do conhecimento (registro condicional, mas o
      // Verum so casa o CT-e na importacao se essa linha existir).
      fecharRegistroEdi([
        '354',
        campoAlfa(item.serie_nf, 3),
        campoNumerico(item.numero_nf, 8),
        dataEdi(item.data_emissao_nf || item.data_emissao),
        campoValorEdi(item.peso_nf ?? item.peso, 5, 2),
        campoValorEdi(item.valor_nf, 13, 2),
        // CGC de quem EMITIU a nota fiscal (cliente/embarcador cadastrado no
        // Verum) - nao confundir com o CNPJ da transportadora. Sem esse dado
        // na base, precisa vir explicito (opcoes.cnpjEmissorNf ou por item);
        // NAO usar a transportadora como fallback (Verum rejeita o arquivo).
        campoNumerico(item.cnpj_emissor_nf || opcoes.cnpjEmissorNf, 14),
      ]),
    ]),
    fecharRegistroEdi(['355', campoNumerico(ctes.length, 4), campoValorEdi(valorTotal)]),
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

// Composicao do desconto automatico por CT-e para o Protocolo Financeiro:
// mesma regra usada em resumirDetalhesAuditoria/liberarParaPagamento
// (cobranca acima da tolerancia = desconto aplicado na fatura).
export function montarComposicaoDescontoCtes(detalhes = [], tolerancia = { acima: 1, abaixo: 5 }) {
  const acima = Math.max(0, Number(tolerancia?.acima || 0));
  const abaixo = Math.max(0, Number(tolerancia?.abaixo || 0));
  const dentroTolerancia = (diferenca) => {
    const valor = Number(diferenca);
    if (!Number.isFinite(valor)) return false;
    return valor <= acima && valor >= -abaixo;
  };
  return detalhes.map((item) => {
    const valorOriginal = Number(item.valor_frete || 0);
    const calculado = Number(item.calculado_frete || 0);
    const diferenca = Number(item.diferenca || 0);
    const temDesconto = calculado > 0 && !dentroTolerancia(diferenca) && diferenca > 0;
    const desconto = temDesconto ? Number(diferenca.toFixed(2)) : 0;
    return {
      chave_cte: item.chave_cte || '',
      numero_cte: item.numero_cte || '',
      valor_original: Number(valorOriginal.toFixed(2)),
      desconto,
      motivo: desconto > 0 ? (item.motivo_divergencia || 'DIVERGENCIA_AUDITORIA') : '',
      valor_final: Number((valorOriginal - desconto).toFixed(2)),
    };
  });
}

export function calcularDescontoAutomaticoFatura(detalhes = [], tolerancia) {
  const composicao = montarComposicaoDescontoCtes(detalhes, tolerancia);
  const total = Number(composicao.reduce((acc, item) => acc + item.desconto, 0).toFixed(2));
  return { composicao, total };
}

// Validacao centralizada antes de permitir o envio para o Protocolo
// Financeiro (secao 12 da demanda 4.40A). Retorna a lista de pendencias;
// vazio significa que o envio pode prosseguir.
export function validarProtocoloFinanceiro(dados = {}) {
  const erros = [];
  if (!dados.fatura_id) erros.push('Fatura nao identificada.');
  if (!dados.responsavel_nome) erros.push('Responsavel nao identificado.');
  if (!dados.transportadora) erros.push('Transportadora nao identificada.');
  if (!dados.cnpj_transportadora) erros.push('CNPJ da transportadora nao identificado.');
  if (!dados.vencimento) erros.push('Vencimento da fatura nao identificado.');
  if (!Number.isFinite(Number(dados.valor_fatura_original)) || Number(dados.valor_fatura_original) <= 0) {
    erros.push('Valor da fatura invalido.');
  }
  if (!Number.isFinite(Number(dados.valor_real_a_pagar))) {
    erros.push('Valor real a pagar invalido.');
  }
  if (!dados.tipo_envio || !TIPOS_ENVIO_PROTOCOLO.includes(dados.tipo_envio)) {
    erros.push('Selecione o tipo de envio.');
  }
  if (dados.tipo_envio === 'DADOS_BANCARIOS' && !dados.dados_bancarios) {
    erros.push('Selecione ou informe os dados bancarios da transportadora.');
  }
  if (!dados.status_fatura_protocolo || !STATUS_FATURA_PROTOCOLO.includes(dados.status_fatura_protocolo)) {
    erros.push('Selecione o status da fatura para protocolo (Lancamento Manual, Cobranca Processada ou Mista).');
    return erros;
  }

  if (dados.status_fatura_protocolo === 'COBRANCA_PROCESSADA' && !String(dados.partida || '').trim()) {
    erros.push('Informe a partida da cobranca processada.');
  }
  if (dados.status_fatura_protocolo === 'LANCAMENTO_MANUAL' && !dados.anexos?.length) {
    erros.push('Anexe ao menos um documento de lancamento manual.');
  }
  if (dados.status_fatura_protocolo === 'MISTA') {
    if (!String(dados.partida || '').trim()) erros.push('Informe a partida da parcela de cobranca processada (Mista).');
    if (!dados.anexos?.length) erros.push('Anexe o documento de lancamento manual da parcela manual (Mista).');
    const processada = Number(dados.valor_cobranca_processada || 0);
    const manual = Number(dados.valor_lancamento_manual || 0);
    const alvo = Number(dados.valor_real_a_pagar || 0);
    if (Math.abs(processada + manual - alvo) > 0.05) {
      erros.push('A soma de cobranca processada + lancamento manual precisa fechar com o valor real a pagar.');
    }
  }

  const descontoTotal = Number(dados.desconto_total || 0);
  if (descontoTotal > 0 && !String(dados.centro_custo_codigo || '').trim()) {
    erros.push('Informe o Centro de Custo do desconto.');
  }
  if (Number(dados.desconto_manual || 0) > 0 && !String(dados.desconto_manual_justificativa || '').trim()) {
    erros.push('Informe a justificativa do ajuste manual de desconto.');
  }

  return erros;
}

// Reconhece o relatorio "Exportação SAPUI5" (contas a pagar): uma linha por
// lancamento contabil, valido para qualquer fornecedor da empresa (nao so
// transportadoras). "Status comp." = 1 e Lançto.compensação preenchido
// significa que o pagamento ja foi compensado no banco; caso contrario o
// lancamento (partida) existe mas ainda esta aguardando pagamento.
export function pareceRelatorioPagamentosSap(headers = []) {
  const normalizados = new Set(headers.map((h) => String(h || '').trim()));
  return normalizados.has('Referência') && normalizados.has('Nome do fornecedor') && normalizados.has('Montante (ME)');
}

// Prefixo real de documento de pagamento (partida) observado no relatorio.
// Documentos "190..." sao lancamentos contabeis (fatura original ou
// reclassificacoes internas entre faturas); so "200..." e' o documento do
// pagamento efetivo (banco/boleto).
const PREFIXO_PARTIDA_PAGAMENTO = '200';

export function mapearPagamentoSap(row = {}) {
  const referencia = String(row['Referência'] ?? row['Referencia'] ?? '').trim();
  const montante = Number(row['Montante (ME)'] ?? row['Montante'] ?? 0);
  const statusComp = String(row['Status comp.'] ?? '').trim();
  // Uma fatura pode passar por varios lancamentos intermediarios ("190..."
  // compensado contra outro "190...") antes do pagamento de fato - isso e'
  // reclassificacao/agrupamento interno (a fatura ja foi lancada pro
  // financeiro, so ainda nao foi paga). Só e' pagamento real quando o
  // documento de compensação comeca com "200...".
  const documentoCompensacao = String(row['Lançto.compensação'] ?? row['Lancto.compensacao'] ?? '').trim();
  const lancamentoContabil = String(row['Lançamento contábil'] ?? row['Lancamento contabil'] ?? '').trim();
  const ehPartidaDePagamento = documentoCompensacao.startsWith(PREFIXO_PARTIDA_PAGAMENTO);
  // Autorreferenciada (compensação = o proprio lancamento): e' so o espelho
  // contabil da partida dobrada (par positivo/negativo que sempre zera a
  // conta) - nao traz informacao nova, sempre existe em par com outra linha.
  const autoReferenciada = !!documentoCompensacao && documentoCompensacao === lancamentoContabil;
  // Reclassificacao/agrupamento real: compensação preenchida, nao e' "200"
  // e nao e' autorreferenciada - a fatura ja foi absorvida por outro
  // documento no financeiro, aguardando o pagamento final.
  const lancadaFinanceiro = !!documentoCompensacao && !ehPartidaDePagamento && !autoReferenciada;
  const compensado = statusComp === '1' && ehPartidaDePagamento;
  return {
    numero_fatura: referencia,
    transportadora: String(row['Nome do fornecedor'] ?? '').trim(),
    cnpj: String(row['Nº ID fiscal 1'] ?? row['No ID fiscal 1'] ?? row['CNPJ'] ?? '').trim(),
    valor_pago: Number(Math.abs(montante).toFixed(2)),
    documento_compensacao: ehPartidaDePagamento ? documentoCompensacao : null,
    partida: ehPartidaDePagamento ? documentoCompensacao : null,
    lancamento_contabil: lancamentoContabil || null,
    autoReferenciada,
    lancadaFinanceiro,
    data_pagamento: ehPartidaDePagamento
      ? excelDateToISO(row['Data de compensação'] ?? row['Dt.lançamento'] ?? row['Dt.lçto.cont.'])
      : null,
    // Data do lancamento contabil em si (existe mesmo antes de compensar) -
    // mostra ha quanto tempo a fatura esta parada no financeiro esperando pagamento.
    data_lancamento: excelDateToISO(row['Dt.lançamento'] ?? row['Dt.lçto.cont.']),
    compensado,
    origem: 'SAP_EXPORTACAO',
  };
}

// Conciliacao do relatorio SAP: casar so pelo numero da fatura e' arriscado
// (o mesmo numero pode existir em transportadoras diferentes) - exige numero
// da fatura + raiz do CNPJ da transportadora batendo. O valor NAO entra no
// casamento (desconto de auditoria e pagamento parcial fazem o valor
// legitimamente diferir); ele so define o resultado (PAGO/DIVERGENTE) depois
// que a fatura ja foi identificada com seguranca. Linhas com numero batendo
// mas CNPJ divergente ficam como CNPJ_DIVERGENTE em vez de casar errado.
export function conciliarPagamentosSap(faturas = [], linhasSap = []) {
  const normalizar = (valor) => String(valor || '').trim().toUpperCase();
  const porNumero = new Map();
  for (const fatura of faturas) {
    const numero = normalizar(fatura.numero_fatura);
    if (!numero) continue;
    porNumero.set(numero, [...(porNumero.get(numero) || []), fatura]);
  }

  return linhasSap
    .map(mapearPagamentoSap)
    .filter((item) => item.numero_fatura)
    // A linha autorreferenciada (compensação = o proprio lancamento) e' so o
    // espelho contabil da partida dobrada - sempre existe em par com outra
    // linha da mesma fatura e nao traz informacao nova, entao e' descartada.
    // Reclassificacoes reais (compensação preenchida, diferente do proprio
    // lancamento, ainda nao "200...") ficam - mostram que a fatura ja saiu
    // da auditoria e foi lancada no financeiro, aguardando o pagamento final.
    .filter((item) => !item.autoReferenciada)
    .map(({ autoReferenciada, ...pagamento }) => pagamento)
    .map((pagamento) => {
      const numero = normalizar(pagamento.numero_fatura);
      const candidatas = porNumero.get(numero) || [];
      if (!candidatas.length) return { ...pagamento, resultado: 'NAO_LOCALIZADO' };

      const raizPagamento = obterRaizCnpj(pagamento.cnpj);
      const cnpjValido = raizCnpjValida(raizPagamento);
      const candidatasPorCnpj = cnpjValido
        ? candidatas.filter((fatura) => obterRaizCnpj(fatura.cnpj_transportadora) === raizPagamento)
        : [];
      if (cnpjValido && !candidatasPorCnpj.length) {
        return { ...pagamento, resultado: 'CNPJ_DIVERGENTE' };
      }

      let alvo = candidatasPorCnpj.length ? candidatasPorCnpj : candidatas;
      const abertas = alvo.filter((fatura) => !ENCERRADOS.has(fatura.status));
      if (abertas.length) alvo = abertas;

      if (!cnpjValido) {
        // Sem CNPJ confiavel na linha do relatorio: so aceita se o nome do
        // fornecedor bater com a transportadora, senao fica ambiguo.
        const nomePagamento = normalizar(pagamento.transportadora);
        const porNome = alvo.filter((fatura) => normalizar(fatura.transportadora) === nomePagamento);
        if (porNome.length) alvo = porNome;
      }

      if (alvo.length > 1) return { ...pagamento, resultado: 'AMBIGUO' };
      if (!alvo.length) return { ...pagamento, resultado: 'NAO_LOCALIZADO' };

      const fatura = alvo[0];
      const pago = Number(pagamento.valor_pago || 0);
      const esperado = Number(fatura.valor_fatura || 0);
      const diferenca = Number((pago - esperado).toFixed(2));
      const { lancadaFinanceiro, ...resto } = pagamento;
      const resultado = lancadaFinanceiro
        ? 'LANCADA_FINANCEIRO'
        : !pagamento.compensado
          ? 'PARTIDA_LANCADA'
          : (Math.abs(diferenca) <= 0.01 ? 'PAGO' : 'DIVERGENTE');
      // Reclassificacao interna: o valor comparado com a fatura nao e'
      // conclusivo (a fatura pode ter sido agrupada com outras nesse
      // documento), entao nao expomos diferenca nem contamos como pago.
      return { ...resto, fatura_id: fatura.id, resultado, diferenca: lancadaFinanceiro ? 0 : diferenca };
    });
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
