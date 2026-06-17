#!/usr/bin/env node
/**
 * Converte o relatório de Generalidades exportado da Vera (formato "longo": uma
 * linha por Transportadora + Filial + Tipo de generalidade) para o modelo que a
 * tela de Importação > Generalidades do Central Fretes espera (uma linha por
 * Transportadora + Origem).
 *
 * Uso:
 *   node scripts/converter-generalidades-vera.js "<arquivo Vera.xlsx>" "<arquivo saida.xlsx>"
 */
const XLSX = require('xlsx');

const ESTADOS_UF = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

const PLACEHOLDERS_TESTE = new Set(['-', '', 'TESTE', 'UNI TESTE', 'TRANSPTEST']);

function normalizeAccents(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function normTipo(value) {
  return normalizeAccents(value).toUpperCase().trim().replace(/\s+/g, ' ');
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  return Number(String(value).replace(',', '.')) || 0;
}

function toBool(value) {
  return String(value ?? '').trim().toLowerCase() === 'true';
}

function isTesteTransportadora(nome) {
  const n = normalizeAccents(nome).toUpperCase();
  return /TESTE|^TRANSPTEST$/i.test(n);
}

// Tenta extrair o nome da cidade a partir do nome da filial.
// Padrões observados: "TRANSP - CIDADE - UF", "TRANSP - FILIAL CIDADE",
// "TRANSP FILIAL CIDADE", "TRANSP - CIDADE".
function extrairCidade(filial, transportadora) {
  let texto = String(filial ?? '').trim();
  if (!texto) return { cidade: '', motivo: 'Filial vazia' };

  const textoUpper = normalizeAccents(texto).toUpperCase().trim();
  if (PLACEHOLDERS_TESTE.has(textoUpper)) {
    return { cidade: '', motivo: 'Filial é placeholder de teste' };
  }

  // remove o prefixo com o nome da transportadora, se repetido no início
  const transpUpper = normalizeAccents(transportadora).toUpperCase().trim();
  let resto = texto;
  if (transpUpper && normalizeAccents(resto).toUpperCase().startsWith(transpUpper)) {
    resto = resto.slice(transportadora.length);
  }

  // separa por hífen e pega o último segmento "significativo"
  const partes = resto
    .split('-')
    .map((p) => p.trim())
    .filter(Boolean);

  if (partes.length === 0) {
    return { cidade: '', motivo: 'Não foi possível separar a filial em partes' };
  }

  let ultima = partes[partes.length - 1];
  let penultima = partes.length > 1 ? partes[partes.length - 2] : '';

  // se a última parte é UF (2 letras), a cidade é a penúltima
  let cidadeCandidata;
  if (normalizeAccents(ultima).toUpperCase().length === 2 && ESTADOS_UF.has(normalizeAccents(ultima).toUpperCase())) {
    cidadeCandidata = penultima || ultima;
  } else {
    cidadeCandidata = ultima;
  }

  cidadeCandidata = cidadeCandidata.replace(/\bFILIAL\b/gi, '').trim();

  if (!cidadeCandidata || PLACEHOLDERS_TESTE.has(normalizeAccents(cidadeCandidata).toUpperCase())) {
    return { cidade: '', motivo: 'Não sobrou texto reconhecível como cidade' };
  }

  // heurística de baixa confiança: nome muito curto ou igual ao nome da transportadora
  if (cidadeCandidata.length < 3 || normalizeAccents(cidadeCandidata).toUpperCase() === transpUpper) {
    return { cidade: cidadeCandidata, motivo: 'Resultado pouco confiável, revisar manualmente' };
  }

  return { cidade: cidadeCandidata, motivo: '' };
}

function escolherLinha(linhas) {
  const ativas = linhas.filter((l) => toBool(l['Ativo']));
  const pool = ativas.length ? ativas : linhas;
  return pool.slice().sort((a, b) => {
    const da = new Date(a['Duração Inicial'] || 0).getTime();
    const db = new Date(b['Duração Inicial'] || 0).getTime();
    return db - da;
  })[0];
}

function converter(linhasVera) {
  const grupos = new Map();
  const ignorados = [];

  linhasVera.forEach((row) => {
    const transportadora = String(row['Nome da transportadora'] || '').trim();
    const codigoUnidade = String(row['Código de Unidade'] || '').trim();
    const filial = String(row['Nome da Filial da Transportadora'] || '').trim();

    if (!transportadora || isTesteTransportadora(transportadora)) {
      ignorados.push({ ...row, motivo: 'Transportadora de teste' });
      return;
    }

    const chave = `${transportadora}__${codigoUnidade}`;
    if (!grupos.has(chave)) {
      grupos.set(chave, { transportadora, codigoUnidade, filial, porTipo: new Map() });
    }
    const grupo = grupos.get(chave);
    const tipo = normTipo(row['Nome da Generalidade']);
    if (!tipo) return;
    if (!grupo.porTipo.has(tipo)) grupo.porTipo.set(tipo, []);
    grupo.porTipo.get(tipo).push(row);
  });

  const saida = [];
  const revisar = [];

  for (const grupo of grupos.values()) {
    const { cidade, motivo } = extrairCidade(grupo.filial, grupo.transportadora);

    const linha = (tipo) => {
      const linhas = grupo.porTipo.get(tipo);
      return linhas ? escolherLinha(linhas) : null;
    };

    const tas = linha('TAS');
    const adValorem = linha('AD VALOREM') || linha('ADVALOREM');
    const gris = linha('GRIS');
    const pedagio = linha('PEDAGIO');
    const cubagem = linha('CUBAGEM');
    const icms = linha('ICMS');
    const ctrc = linha('TAXA DE EMISSAO DE CONHECIMENTO');

    const fracaoPedagio = pedagio ? toNumber(pedagio['Fração de peso']) || 100 : 100;
    const pedagioValor = pedagio
      ? toNumber(pedagio['Valor do Frete']) * (100 / fracaoPedagio)
      : 0;

    const tiposConhecidos = new Set([
      'TAS', 'AD VALOREM', 'ADVALOREM', 'GRIS', 'PEDAGIO', 'CUBAGEM', 'ICMS',
      'TAXA DE EMISSAO DE CONHECIMENTO',
    ]);
    const observacoesPartes = [];
    for (const [tipo, linhas] of grupo.porTipo.entries()) {
      if (tiposConhecidos.has(tipo)) continue;
      const l = escolherLinha(linhas);
      const valor = toNumber(l['Valor do Frete']) || toNumber(l['% Do Valor do Frete']) || toNumber(l['Cubagem']);
      if (valor) observacoesPartes.push(`${tipo}: ${valor}`);
    }

    const out = {
      Transportadora: grupo.transportadora,
      Origem: cidade,
      Canal: 'ATACADO',
      'Incide ICMS': icms ? 'Sim' : 'Não',
      'Alíquota ICMS %': icms ? toNumber(icms['% Do Valor do Frete']) : '',
      'Ad Valorem %': adValorem ? toNumber(adValorem['% Do Valor do Frete']) : '',
      'Ad Valorem Mínimo R$': adValorem ? toNumber(adValorem['Valor Mínimo de Frete']) : '',
      'Pedágio R$ 100kg': pedagio ? pedagioValor : '',
      'GRIS %': gris ? toNumber(gris['% Do Valor do Frete']) : '',
      'GRIS Mínimo R$': gris ? toNumber(gris['Valor Mínimo de Frete']) : '',
      'TAS R$': tas ? toNumber(tas['Valor do Frete']) : '',
      'CTRC Emitido R$': ctrc ? toNumber(ctrc['Valor do Frete']) : '',
      'Cubagem kg m3': cubagem ? toNumber(cubagem['Cubagem']) : '',
      'Tipo de cálculo': 'PERCENTUAL',
      Observações: observacoesPartes.join('; '),
      'Código de Unidade (Vera)': grupo.codigoUnidade,
      'Filial (Vera)': grupo.filial,
    };

    if (!cidade) {
      revisar.push({ ...out, 'Motivo da revisão': motivo });
    } else {
      saida.push(out);
      if (motivo) revisar.push({ ...out, 'Motivo da revisão': motivo });
    }
  }

  return { saida, revisar, ignorados };
}

function main() {
  const [, , entrada, saidaPath] = process.argv;
  if (!entrada || !saidaPath) {
    console.error('Uso: node scripts/converter-generalidades-vera.js <entrada.xlsx> <saida.xlsx>');
    process.exit(1);
  }

  const wb = XLSX.readFile(entrada);
  const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
  const { saida, revisar, ignorados } = converter(linhas);

  const wbOut = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbOut, XLSX.utils.json_to_sheet(saida), 'Dados');
  XLSX.utils.book_append_sheet(
    wbOut,
    XLSX.utils.json_to_sheet(revisar.length ? revisar : [{ aviso: 'Nenhuma linha para revisar' }]),
    'Revisar manualmente'
  );
  XLSX.utils.book_append_sheet(
    wbOut,
    XLSX.utils.json_to_sheet(ignorados.length ? ignorados : [{ aviso: 'Nenhuma linha ignorada' }]),
    'Ignorados (teste)'
  );
  XLSX.writeFile(wbOut, saidaPath);

  console.log(`Transportadoras+unidades convertidas: ${saida.length}`);
  console.log(`Linhas para revisar manualmente: ${revisar.length}`);
  console.log(`Linhas ignoradas (transportadoras de teste): ${ignorados.length}`);
  console.log(`Arquivo gerado em: ${saidaPath}`);
}

main();
