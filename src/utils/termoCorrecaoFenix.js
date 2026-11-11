// Partida Fenix: documento de compensacao do SAP (1501163056, "PL FENIX") que aparece compensando
// CT-es que nao foram pagos. Com um CT-e assim a fatura nao escritura, mesmo com todos os CT-es
// lancados. O financeiro precisa estornar a compensacao: o Diagnostico lista esses CT-es e gera o
// Termo de Correcao de Lancamento (Word, no modelo usado hoje) e a planilha do mesmo pedido.
import { strToU8, zipSync } from 'fflate';
import { lerZip } from './zipLeitor.js';

export const PARTIDAS_FENIX = Object.freeze(['1501163056']);
export const ROTULO_FENIX = '(PL FÊNIX)';
export const MOTIVO_FENIX = 'Estornar compensação não paga';

// Empresa SAP (codigo da coluna "Empresa" do relatorio) -> nome no termo. Codigo sem nome sai como veio.
export const EMPRESAS_SAP = Object.freeze({ 1420: 'CPX DISTRIBUIDORA SA' });

const digitos = (v) => String(v ?? '').replace(/\D/g, '');
const semZeros = (v) => digitos(v).replace(/^0+(?=\d)/, '');

export const ehCompensacaoFenix = (documento) => Boolean(documento) && PARTIDAS_FENIX.includes(semZeros(documento));

export function nomeEmpresaSap(codigo) {
  const c = String(codigo ?? '').trim();
  return EMPRESAS_SAP[semZeros(c)] || c;
}

// Linha SAP de lancamento (montante negativo) do CT-e compensada pela Fenix, ou null.
export function linhaFenixDoCte(linhas = []) {
  return linhas.find((l) => ehCompensacaoFenix(l.documento_compensacao) && Number(l.montante || 0) < 0) || null;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const dataPorExtenso = (d = new Date()) => `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;

const escapar = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const preencher = (xml, campos) => xml.replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => escapar(campos[k] ?? ''));

// Um bloco do termo por partida (a mesma partida em dois CT-es sai uma vez so).
export function partidasDoTermo(itens = []) {
  const vistas = new Map();
  itens.forEach((it) => {
    const chave = `${it.empresa || ''}|${it.partida || ''}`;
    if (it.partida && !vistas.has(chave)) vistas.set(chave, it);
  });
  return [...vistas.values()];
}

// document.xml do modelo tem o bloco (tabela) entre <!--BLOCO--> e <!--/BLOCO-->: repete por partida.
export function montarDocumentoTermo(modeloXml, itens = [], { solicitante = '', data = new Date() } = {}) {
  const ini = modeloXml.indexOf('<!--BLOCO-->');
  const fim = modeloXml.indexOf('<!--/BLOCO-->');
  if (ini < 0 || fim < 0) throw new Error('Modelo do termo sem marcação de bloco.');
  const bloco = modeloXml.slice(ini + '<!--BLOCO-->'.length, fim);
  const blocos = partidasDoTermo(itens).map((it) => preencher(bloco, {
    EMPRESA: nomeEmpresaSap(it.empresa),
    FORNECEDOR_CODIGO: it.codigo_fornecedor || '',
    FORNECEDOR_NOME: it.fornecedor || it.transportadora || '',
    PEDIDO: it.documento_compensacao || PARTIDAS_FENIX[0],
    PEDIDO_ROTULO: ROTULO_FENIX,
    PARTIDA: it.partida,
    SOLICITANTE: solicitante,
    MOTIVO: MOTIVO_FENIX,
  })).join('');
  return preencher(`${modeloXml.slice(0, ini)}${blocos}${modeloXml.slice(fim + '<!--/BLOCO-->'.length)}`, { DATA_EXTENSO: dataPorExtenso(data) });
}

// Gera o .docx (bytes) a partir do modelo (bytes do termo-correcao-lancamento.docx).
export function gerarTermoDocx(modeloBytes, itens, opcoes) {
  const arquivos = lerZip(modeloBytes instanceof Uint8Array ? modeloBytes : new Uint8Array(modeloBytes));
  const xml = new TextDecoder('utf-8').decode(arquivos['word/document.xml']);
  const saida = { '[Content_Types].xml': arquivos['[Content_Types].xml'] };
  Object.entries(arquivos).forEach(([nome, bytes]) => { if (nome !== '[Content_Types].xml') saida[nome] = bytes; });
  saida['word/document.xml'] = strToU8(montarDocumentoTermo(xml, itens, opcoes));
  return zipSync(saida, { level: 6 });
}
