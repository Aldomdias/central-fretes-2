import * as XLSX from 'xlsx';
import { parseNumeroPlanilha } from './parseNumeroPlanilha';

function texto(valor) {
  return String(valor ?? '').trim();
}

function apenasDigitos(valor) {
  return texto(valor).replace(/\D/g, '');
}

function dataIso(valor) {
  if (!valor) return null;
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor.toISOString().slice(0, 10);
  if (typeof valor === 'number') {
    const parsed = XLSX.SSF.parse_date_code(valor);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const bruto = texto(valor);
  const br = bruto.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (br) {
    const ano = br[3].length === 2 ? `20${br[3]}` : br[3];
    return `${ano}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  }
  const date = new Date(bruto);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function hashSimples(valor) {
  let hash = 2166136261;
  for (let i = 0; i < valor.length; i += 1) {
    hash ^= valor.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function dataEnvioPeloArquivo(nome, anoReferencia) {
  const match = texto(nome).match(/(\d{1,2})[-_.](\d{1,2})(?:[-_.](\d{2,4}))?/);
  if (!match) return null;
  let ano = match[3] || anoReferencia;
  if (!ano) return null;
  if (String(ano).length === 2) ano = `20${ano}`;
  // anoReferencia vem do Vencimento das linhas do arquivo — se essa coluna
  // veio vazia/com valor quebrado em todas as linhas, o ano cai pra algo
  // implausível (ex.: 1900, de uma célula de data do Excel mal lida). Não
  // grava uma data claramente errada; melhor não ter data de envio do que
  // ter uma errada.
  if (Number(ano) < 2000 || Number(ano) > 2100) return null;
  return `${ano}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

function localizarCabecalho(matriz) {
  return matriz.findIndex((row) => row.some((cell) => /^fatura$/i.test(texto(cell))));
}

export async function parseProtocolosFinanceirosFile(file) {
  if (!file) return { registros: [], meta: { arquivo: '', linhasOriginais: 0, linhasComDesconto: 0 } };
  let workbook;
  try {
    workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true, raw: true });
  } catch (error) {
    throw new Error(`Não consegui ler "${file.name || 'arquivo'}": ${error.message}`);
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error(`Não encontrei nenhuma aba em "${file.name || 'arquivo'}".`);
  const matriz = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false, raw: true });
  const indiceCabecalho = localizarCabecalho(matriz);
  if (indiceCabecalho < 0) throw new Error(`Cabeçalho "Fatura" não encontrado em "${file.name || 'arquivo'}".`);
  const cabecalhos = matriz[indiceCabecalho].map(texto);
  const linhas = matriz.slice(indiceCabecalho + 1).filter((row) => row.some((cell) => texto(cell)));
  const objetos = linhas.map((row) => Object.fromEntries(cabecalhos.map((cabecalho, i) => [cabecalho, row[i]])));
  const anoReferencia = objetos.map((row) => dataIso(row.Vencimento)?.slice(0, 4)).find(Boolean);
  const dataEnvio = dataEnvioPeloArquivo(file.name, anoReferencia);
  const registros = objetos.map((row) => {
    const desconto = parseNumeroPlanilha(row.Desconto, 0) || 0;
    const numeroFatura = texto(row.Fatura);
    const cnpj = apenasDigitos(row.CNPJ);
    const transportadora = texto(row.Transportadora);
    const baseHash = [file.name, dataEnvio, numeroFatura, cnpj, transportadora, desconto].join('|').toUpperCase();
    return {
      dataEnvio,
      numeroFatura,
      responsavel: texto(row['Responsável'] ?? row['Respons�vel']),
      tipoEnvio: texto(row['Tipo Envio']),
      transportadora,
      cnpj,
      vencimento: dataIso(row.Vencimento),
      statusFatura: texto(row['Status Fatura']),
      valorFatura: parseNumeroPlanilha(row['Valor Fatura'], 0) || 0,
      descontoEnviado: desconto,
      valorRealPagar: parseNumeroPlanilha(row['Valor real a pagar'], 0) || 0,
      partida: texto(row.Partida),
      centroCustoDesconto: texto(row['CC Desconto']),
      observacao: texto(row['Observação'] ?? row['Observa��o']),
      dadosBancarios: texto(row['Dados Bancários'] ?? row['Dados Banc�rios']),
      arquivoOrigem: file.name || '',
      linhaHash: hashSimples(baseHash),
    };
  }).filter((row) => row.numeroFatura && row.descontoEnviado > 0);

  return {
    registros,
    meta: { arquivo: file.name || '', linhasOriginais: objetos.length, linhasComDesconto: registros.length },
  };
}

