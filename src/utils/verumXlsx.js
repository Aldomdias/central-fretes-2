import { zipSync, strToU8 } from 'fflate';
import { VERUM_TEMPLATES } from './verumTemplateArquivos.js';
import { parseNumeroPlanilha } from './parseNumeroPlanilha.js';

// Gera Fretes/Rotas do Verum identicos aos arquivos oficiais: mesmo pacote
// (estilos, formatos de celula, tabela, comentarios), so as linhas de dados mudam.

const X = 'x:';

const ESPEC = {
  cotacoes: {
    titulo: 'Valores de frete',
    spans: '1:15',
    colunas: [
      { col: 'C', chave: 'Nome da transportadora', tipo: 's', estilo: 0 },
      { col: 'D', chave: 'Código da unidade', tipo: 's', estilo: 6 },
      { col: 'E', chave: 'Regra de cálculo', tipo: 's', estilo: 0 },
      { col: 'F', chave: 'Rota do frete', tipo: 's', estilo: 0 },
      { col: 'G', chave: 'Peso mínimo', tipo: 'n', estilo: 7 },
      { col: 'H', chave: 'Peso limite', tipo: 'n', estilo: 8 },
      { col: 'I', chave: 'Excesso de peso', tipo: 'n', estilo: 8 },
      { col: 'J', chave: 'Taxa aplicada', tipo: 'n', estilo: 9 },
      { col: 'K', chave: 'Frete percentual', tipo: 'n', estilo: 10 },
      { col: 'L', chave: 'Frete mínimo', tipo: 'n', estilo: 9 },
      { col: 'M', chave: 'Início da vigência', tipo: 'd', estilo: 11 },
      { col: 'N', chave: 'Fim da vigência', tipo: 'd', estilo: 11 },
    ],
    filler: ['B', 'O'],
    ultimaCol: 'O',
  },
  rotas: {
    titulo: 'Prazos de frete',
    spans: '1:14',
    // No arquivo oficial a coluna "Nome da transportadora" das rotas vai vazia.
    colunas: [
      { col: 'D', chave: 'Código da unidade', tipo: 's', estilo: 6 },
      { col: 'E', chave: 'Cotação', tipo: 's', estilo: 0 },
      { col: 'F', chave: 'Código IBGE Origem', tipo: 'i', estilo: 0 },
      { col: 'G', chave: 'Código IBGE Destino', tipo: 'i', estilo: 1 },
      { col: 'H', chave: 'CEP inicial', tipo: 'i', estilo: 7 },
      { col: 'I', chave: 'CEP final', tipo: 'i', estilo: 7 },
      { col: 'J', chave: 'Método de envio', tipo: 's', estilo: 0 },
      { col: 'K', chave: 'Prazo de entrega', tipo: 'n', estilo: 8 },
      { col: 'L', chave: 'Início da vigência', tipo: 'd', estilo: 9 },
      { col: 'M', chave: 'Término da vigência', tipo: 'd', estilo: 9 },
    ],
    filler: ['B', 'N'],
    ultimaCol: 'N',
  },
};

function esc(valor) {
  return String(valor).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function numeroOuNulo(valor) {
  const n = parseNumeroPlanilha(valor, null);
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function inteiroOuNulo(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const digitos = String(valor).replace(/\D/g, '');
  return digitos ? Number(digitos) : null;
}

const MS_DIA = 86400000;
function serialData(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (valor instanceof Date) return Math.round((Date.UTC(valor.getFullYear(), valor.getMonth(), valor.getDate()) - Date.UTC(1899, 11, 30)) / MS_DIA);
  if (typeof valor === 'number') return valor > 20000 && valor < 80000 ? valor : null;
  const texto = String(valor).trim();
  let ano; let mes; let dia;
  let m = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) { [, ano, mes, dia] = m; } else {
    m = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return null;
    [, dia, mes, ano] = m;
  }
  return Math.round((Date.UTC(Number(ano), Number(mes) - 1, Number(dia)) - Date.UTC(1899, 11, 30)) / MS_DIA);
}

function vigenciaPadrao() {
  const hoje = new Date();
  const fim = new Date(hoje);
  fim.setFullYear(fim.getFullYear() + 5);
  return { inicio: serialData(hoje), fim: serialData(fim) };
}

export function montarXlsxVerum(tipo, linhas = []) {
  const espec = ESPEC[tipo];
  const modelo = VERUM_TEMPLATES[tipo];
  const padrao = vigenciaPadrao();
  const iniKey = espec.colunas.find((c) => c.tipo === 'd').chave;
  const fimKey = espec.colunas.filter((c) => c.tipo === 'd')[1].chave;

  // Textos compartilhados: titulo + cabecalhos primeiro, como no arquivo oficial.
  const textos = [espec.titulo, ...espec.colunas.map((c) => c.chave)];
  if (tipo === 'rotas') textos.splice(1, 0, 'Nome da transportadora');
  const indice = new Map();
  textos.forEach((t, i) => { if (!indice.has(t)) indice.set(t, i); });
  const idxTexto = (t) => {
    if (!indice.has(t)) { indice.set(t, textos.length); textos.push(t); }
    return indice.get(t);
  };

  const xmlLinhas = [];
  linhas.forEach((linha, i) => {
    const r = i + 5;
    const celulas = [`<${X}c r="B${r}" s="2" t="s" />`];
    espec.colunas.forEach((c) => {
      const ref = `${c.col}${r}`;
      let bruto = linha[c.chave];
      if (c.tipo === 'd') {
        const s = serialData(bruto) ?? (c.chave === iniKey ? padrao.inicio : c.chave === fimKey ? padrao.fim : null);
        celulas.push(s === null ? `<${X}c r="${ref}" s="${c.estilo}" />` : `<${X}c r="${ref}" s="${c.estilo}"><${X}v>${s}</${X}v></${X}c>`);
        return;
      }
      if (c.tipo === 's') {
        const t = bruto === null || bruto === undefined ? '' : String(bruto).trim();
        celulas.push(t === '' ? `<${X}c r="${ref}" s="${c.estilo}" />` : `<${X}c r="${ref}" s="${c.estilo}" t="s"><${X}v>${idxTexto(t)}</${X}v></${X}c>`);
        return;
      }
      const n = c.tipo === 'i' ? inteiroOuNulo(bruto) : numeroOuNulo(bruto);
      celulas.push(n === null ? `<${X}c r="${ref}" s="${c.estilo}" />` : `<${X}c r="${ref}" s="${c.estilo}" t="n"><${X}v>${n}</${X}v></${X}c>`);
    });
    celulas.push(`<${X}c r="${espec.ultimaCol}${r}" s="2" t="s" />`);
    xmlLinhas.push(`<${X}row r="${r}" spans="${espec.spans}">${celulas.join('')}</${X}row>`);
  });

  const ultimaLinha = linhas.length + 5;
  const dim = `A1:${espec.ultimaCol}${ultimaLinha}`;
  const refTabela = `C4:${espec.colunas[espec.colunas.length - 1].col}${linhas.length + 4}`;

  const sheet = modelo.cabecalhoSheet.replace('{DIM}', dim)
    + `<${X}sheetData>`
    + modelo.topo
    + xmlLinhas.join('')
    + modelo.ultimaLinha.split('{R}').join(String(ultimaLinha))
    + modelo.caudaSheet;

  const sst = `<?xml version="1.0" encoding="utf-8"?><x:sst count="${textos.length}" uniqueCount="${textos.length}" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + textos.map((t) => `<x:si><x:t${/^\s|\s$/.test(t) ? ' xml:space="preserve"' : ''}>${esc(t)}</x:t></x:si>`).join('')
    + '</x:sst>';

  const arquivos = { '[Content_Types].xml': strToU8(modelo.arquivos['[Content_Types].xml']) };
  Object.keys(modelo.arquivos).forEach((caminho) => {
    if (caminho !== '[Content_Types].xml') arquivos[caminho] = strToU8(modelo.arquivos[caminho]);
  });
  arquivos['xl/sharedStrings.xml'] = strToU8(sst);
  arquivos['xl/worksheets/sheet1.xml'] = strToU8(sheet);
  arquivos['xl/tables/table1.xml'] = strToU8(modelo.tabela.split('{REF}').join(refTabela));
  return zipSync(arquivos, { level: 6 });
}

export function baixarXlsxVerum(tipo, linhas, nomeArquivo) {
  const bytes = montarXlsxVerum(tipo, linhas);
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
