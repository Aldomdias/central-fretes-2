function valor(row, nomes) {
  for (const nome of nomes) {
    if (row[nome] !== undefined && row[nome] !== null && row[nome] !== '') return row[nome];
  }
  return '';
}

function texto(row, nomes) {
  return String(valor(row, nomes) || '').trim();
}

function numero(row, nomes) {
  const original = valor(row, nomes);
  if (typeof original === 'number') return original;
  const normalizado = String(original || '').trim().replace(/\./g, '').replace(',', '.');
  const convertido = Number(normalizado);
  return Number.isFinite(convertido) ? convertido : 0;
}

function somenteDigitos(row, nomes) {
  return texto(row, nomes).replace(/\D/g, '');
}

export function excelDateToISO(valorData) {
  if (!valorData) return null;
  if (valorData instanceof Date && !Number.isNaN(valorData.getTime())) {
    return valorData.toISOString().slice(0, 10);
  }
  if (typeof valorData === 'number') {
    const data = new Date(Math.round((valorData - 25569) * 86400 * 1000));
    return Number.isNaN(data.getTime()) ? null : data.toISOString().slice(0, 10);
  }
  const entrada = String(valorData).trim();
  const brasileira = entrada.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (brasileira) {
    return `${brasileira[3]}-${brasileira[2].padStart(2, '0')}-${brasileira[1].padStart(2, '0')}`;
  }
  const iso = entrada.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return iso ? `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}` : null;
}

export function parseFaturaVerum(row) {
  return {
    transportadora: texto(row, ['Transportadora']),
    cnpj_transportadora: somenteDigitos(row, ['CNPJ Transportadora']),
    data_envio: excelDateToISO(valor(row, ['Data Envio'])),
    data_emissao: excelDateToISO(valor(row, ['Data Emissao', 'Data Emissão'])),
    data_vencimento: excelDateToISO(valor(row, ['Data Vencimento'])),
    numero_fatura: texto(row, ['Numero Fatura', 'Número Fatura']),
    serie_fatura: texto(row, ['Serie Fatura', 'Série Fatura']),
    ctes_totais: numero(row, ['CTes Totais', 'CTes Total']),
    ctes_vinculados: numero(row, ['CTes Vinculados']),
    valor_fatura: numero(row, ['Valor Fatura']),
    valor_icms: numero(row, ['Valor ICMS']),
    valor_calculado: numero(row, ['Valor Calculado']),
    diferenca: numero(row, ['Diferenca', 'Diferença']),
    banco: texto(row, ['Banco']),
    status: texto(row, ['Status']) || 'RECEBIDA',
    status_fatura: texto(row, ['Status da fatura', 'Status Fatura']),
    status_pagamento: texto(row, ['Status pagamento', 'Status Pagamento']),
    cnpj_tomador: somenteDigitos(row, ['CNPJ Tomador da Fatura', 'CNPJ Tomador']),
    nome_tomador: texto(row, ['Nome Tomador da Fatura', 'Nome Tomador']),
    enviado_para_pagamento: texto(row, ['Enviado para pagamento']).toUpperCase() === 'SIM',
  };
}

export function parseDetalheFaturaVerum(row, faturaId, fatura) {
  return {
    fatura_id: faturaId,
    numero_fatura: fatura.numero_fatura,
    serie_fatura: fatura.serie_fatura,
    transportadora: texto(row, ['Transportadora']),
    cnpj_transportadora: somenteDigitos(row, ['CNPJ Transportadora']),
    chave_cte: texto(row, ['Chave CTe', 'Chave CT-e']),
    numero_cte: texto(row, ['Numero CTe', 'Numero CT-e', 'Número CT-e']),
    serie_cte: texto(row, ['Serie CTe', 'Série CT-e']),
    mes_ano_emissao_cte: texto(row, ['Mes/Ano Emissao CTe', 'Mes/Ano Emissão CTe']),
    cnpj_emissor: somenteDigitos(row, ['CNPJ Emissor']),
    cnpj_tomador: somenteDigitos(row, ['CNPJ Tomador da Fatura', 'CNPJ Tomador']),
    nome_tomador: texto(row, ['Nome Tomador da Fatura', 'Nome Tomador']),
    valor_frete: numero(row, ['Valor Frete']),
    custo_frete: numero(row, ['Custo Frete']),
    preco_frete: numero(row, ['Preco Frete', 'Preço Frete']),
    calculado_frete: numero(row, ['Calculado Frete']),
    diferenca: numero(row, ['Diferenca', 'Diferença']),
    status_conciliacao: texto(row, ['Status Conciliacao', 'Status Conciliação']),
    status_processamento: texto(row, ['Status Processamento']),
    cte_integrado_erp: texto(row, ['CTe Integrado ERP']).toUpperCase() === 'SIM',
    status: texto(row, ['Status']) || 'PENDENTE',
    codigo_tratativa: texto(row, ['Codigo da Tratativa', 'Código da Tratativa']),
    tratativa: texto(row, ['Tratativa']),
    observacao: texto(row, ['Observacao', 'Observação']),
    usuario: texto(row, ['Usuario', 'Usuário']),
    justificativa_inativacao: texto(row, ['Justificativa da inativacao', 'Justificativa da inativação']),
  };
}

export function chaveFatura(numeroFatura, serieFatura) {
  return `${String(numeroFatura || '').trim()}::${String(serieFatura || '').trim()}`;
}

export function analisarLayoutVerum(rowsFaturas = [], rowsDetalhes = []) {
  const faturas = rowsFaturas.map(parseFaturaVerum);
  const validas = faturas.filter((item) => item.numero_fatura && item.transportadora);
  const chaves = new Set(validas.map((item) => chaveFatura(item.numero_fatura, item.serie_fatura)));
  const detalhesReconhecidos = rowsDetalhes.filter((row) => chaves.has(chaveFatura(
    texto(row, ['Numero Fatura', 'Número Fatura']),
    texto(row, ['Serie Fatura', 'Série Fatura']),
  )));
  return {
    totalFaturas: rowsFaturas.length,
    faturasValidas: validas.length,
    faturasIgnoradas: rowsFaturas.length - validas.length,
    totalDetalhes: rowsDetalhes.length,
    detalhesReconhecidos: detalhesReconhecidos.length,
    detalhesNaoVinculados: rowsDetalhes.length - detalhesReconhecidos.length,
  };
}
