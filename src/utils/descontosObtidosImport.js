import * as XLSX from 'xlsx';
import { parseNumeroPlanilha } from './parseNumeroPlanilha';

// Regras de origem (definidas pelo usuário a partir do extrato contábil do SAP):
// - Até a mudança de padrão em 2026: conta 41301002 (Desc. Fin. Obtidos),
//   valor negativo, restrito a centros de lucro de transporte (ex.: "L420110024
//   (TRANSPORTE)", "L430110024 (TRANSPORTE)").
// - A partir da mudança: conta 32208005 (Fretes e Carretos) já é só
//   desconto direto de transportadora, valor negativo, sem filtro de centro
//   de lucro (tudo nessa conta é nosso).
const CONTA_DESC_FIN_OBTIDOS = '41301002';
const CONTA_FRETES_CARRETOS = '32208005';

// Contrapartidas contábeis internas que aparecem na coluna de contrapartida
// mas não são transportadora de verdade (provisão, rateio, reclassificação
// interna) — não representam desconto concedido por transportadora nenhuma.
const CONTRAPARTIDAS_IGNORADAS = new Set([
  'provisão fretes',
  'desc. fin. obtidos',
  'custo fretes não apr',
]);

function normalizarTexto(valor) {
  return String(valor ?? '').trim();
}

function extrairCodigoConta(valorConta) {
  const texto = normalizarTexto(valorConta);
  const match = texto.match(/^(\d+)/);
  return match ? match[1] : texto;
}

// "2861967 (REUNIDAS TRANSPORTES S.A)" -> { codigo: '2861967', nome: 'REUNIDAS TRANSPORTES S.A' }
function separarCodigoNome(valor) {
  const texto = normalizarTexto(valor);
  const match = texto.match(/^([^(]*)\(([^)]+)\)\s*$/);
  if (match) {
    return { codigo: match[1].trim() || null, nome: match[2].trim() };
  }
  return { codigo: null, nome: texto };
}

function centroLucroEhTransporte(valorCentroLucro) {
  return /transporte/i.test(normalizarTexto(valorCentroLucro));
}

// Datas vêm ora como serial numérico do Excel (célula sem formato de data
// aplicado), ora como texto já formatado "DD.MM.YYYY" ou "DD/MM/YYYY" (raw:false
// respeita o número de formato da célula) — arquivos diferentes do mesmo extrato
// SAP se comportam de forma diferente aqui, então é preciso aceitar os dois.
function excelSerialParaISO(valor) {
  const texto = normalizarTexto(valor);

  const matchTexto = texto.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (matchTexto) {
    const [, dia, mes, ano] = matchTexto;
    const diaN = Number(dia);
    const mesN = Number(mes);
    const anoN = Number(ano);
    if (mesN < 1 || mesN > 12 || diaN < 1 || diaN > 31) return null;
    return `${anoN}-${String(mesN).padStart(2, '0')}-${String(diaN).padStart(2, '0')}`;
  }

  const numero = Number(texto);
  if (!Number.isFinite(numero) || !texto) return null;
  // Excel: dia 1 = 1900-01-01 (com o bug histórico do ano bissexto de 1900,
  // que a própria SheetJS/Excel já compensam com a época 1899-12-30).
  const epoch = Date.UTC(1899, 11, 30);
  const ms = epoch + numero * 86400000;
  const data = new Date(ms);
  if (Number.isNaN(data.getTime())) return null;
  return data.toISOString().slice(0, 10);
}

function simpleHash(texto) {
  let hash = 0;
  for (let i = 0; i < texto.length; i += 1) {
    hash = (hash * 31 + texto.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

// Identidade estável de um lançamento do SAP: empresa + conta + nº do
// lançamento contábil + data + valor. NÃO entra nome da contrapartida nem o
// texto da partida — o SAP exporta esses textos de jeitos diferentes a cada
// extração ("CONEXAO LOG TRANSP" x "CONEXAO LOG TRANSPORTES", "K - 2" x
// "K 2", nome truncado, caixa alta/baixa), e foi isso que duplicou
// lançamentos ao reimportar o mesmo mês (nov/2026).
export function chaveNaturalDescontoObtido({ empresa, contaRazao, lancamentoContabil, dataLancamento, valor }) {
  return [
    normalizarTexto(empresa).toUpperCase(),
    extrairCodigoConta(contaRazao),
    normalizarTexto(lancamentoContabil),
    normalizarTexto(dataLancamento).slice(0, 10),
    Math.abs(Number(valor || 0)).toFixed(2),
  ].join('|');
}

export async function parseDescontosObtidosFile(file) {
  if (!file) {
    return { registros: [], meta: { arquivo: '', linhasOriginais: 0, linhasElegiveis: 0 } };
  }

  const buffer = await file.arrayBuffer();
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'array', cellDates: false, raw: false });
  } catch (e) {
    throw new Error(`Não consegui ler "${file.name || 'arquivo'}". Abra no Excel e salve como .xlsx. Detalhe: ${e.message}`);
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) {
    throw new Error(`Não encontrei nenhuma aba em "${file.name || 'arquivo'}".`);
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false, blankrows: false });
  const registros = [];
  // Um mesmo lançamento pode ter dois itens legítimos com o mesmo valor —
  // a ocorrência (1ª, 2ª...) dentro do arquivo entra no hash pra não fundi-los.
  const ocorrencias = new Map();

  rows.forEach((row) => {
    const contaCodigo = extrairCodigoConta(row['Conta do Razão']);
    let regraAplicada = null;

    if (contaCodigo === CONTA_DESC_FIN_OBTIDOS) {
      if (!centroLucroEhTransporte(row['Centro de lucro'])) return;
      regraAplicada = 'desc_fin_obtidos';
    } else if (contaCodigo === CONTA_FRETES_CARRETOS) {
      regraAplicada = 'fretes_carretos';
    } else {
      return;
    }

    const valor = parseNumeroPlanilha(row['Mont.moeda empresa'], null);
    if (valor === null || valor >= 0) return;

    const dataIso = excelSerialParaISO(row['Data de lançamento']);
    if (!dataIso) return;
    const [anoStr, mesStr] = dataIso.split('-');

    const { codigo: transportadoraCodigo, nome: transportadoraNome } = separarCodigoNome(
      row['Cta.contrapartida'] || row['Nome cta.contrapart.']
    );

    if (CONTRAPARTIDAS_IGNORADAS.has(transportadoraNome.trim().toLowerCase())) return;

    const empresa = normalizarTexto(row['Nome da empresa']) || normalizarTexto(row['Empresa']);
    const lancamentoContabil = normalizarTexto(row['Lançamento contábil']);
    const chaveNatural = chaveNaturalDescontoObtido({
      empresa, contaRazao: row['Conta do Razão'], lancamentoContabil, dataLancamento: dataIso, valor,
    });
    const ocorrencia = (ocorrencias.get(chaveNatural) || 0) + 1;
    ocorrencias.set(chaveNatural, ocorrencia);

    registros.push({
      ano: Number(anoStr),
      mes: Number(mesStr),
      dataLancamento: dataIso,
      contaRazao: normalizarTexto(row['Conta do Razão']),
      regraAplicada,
      transportadoraNome: transportadoraNome || 'Não identificado',
      transportadoraCodigo,
      empresa,
      centroLucro: normalizarTexto(row['Nome centro de lucro']) || normalizarTexto(row['Centro de lucro']),
      valor: Math.abs(valor),
      lancamentoContabil,
      textoPartida: normalizarTexto(row['Txt.it.partida indv.']),
      chaveNatural,
      ocorrencia,
      linhaHash: `v2:${simpleHash(chaveNatural)}:${ocorrencia}`,
    });
  });

  return {
    registros,
    meta: {
      arquivo: file.name || '',
      linhasOriginais: rows.length,
      linhasElegiveis: registros.length,
    },
  };
}
