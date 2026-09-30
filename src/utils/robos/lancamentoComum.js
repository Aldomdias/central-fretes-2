// Base comum dos robos de lancamento (NFS-e e CT-e): tabelas de parametros (Filiais e
// Escritorios BI, que nas planilhas vinham do "Parametros.xlsx" via Power Query), datas,
// leitura do arquivo de resultado do SAP e utilitarios de planilha.

import { parseNumeroPlanilha } from '../parseNumeroPlanilha';

const CHAVE_PARAMETROS = 'central_fretes_robo_lancamento_parametros_v1';

export function semAcento(texto = '') {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function normalizarCabecalho(texto = '') {
  return semAcento(texto).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function apenasDigitos(valor) {
  return String(valor ?? '').replace(/\D/g, '');
}

// CNPJ vindo de planilha pode perder zeros a esquerda (numero) ou vir mascarado.
export function normalizarCnpj(valor) {
  const d = apenasDigitos(valor);
  if (!d) return '';
  return d.length < 14 ? d.padStart(14, '0') : d;
}

// ---------------------------------------------------------------- datas
function pad(n) { return String(n).padStart(2, '0'); }

export function hojeIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Aceita serial do Excel, Date, "dd/mm/aaaa", "dd.mm.aaaa", "aaaa-mm-dd" e "aaaa-mm-ddThh:..".
export function dataParaIso(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? '' : `${valor.getFullYear()}-${pad(valor.getMonth() + 1)}-${pad(valor.getDate())}`;
  }
  if (typeof valor === 'number') {
    if (valor < 20000 || valor > 80000) return '';
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(valor) * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const t = String(valor).trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
  if (m) {
    const ano = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${ano}-${pad(m[2])}-${pad(m[1])}`;
  }
  if (/^\d{5}$/.test(t)) return dataParaIso(Number(t));
  return '';
}

export function isoParaDdmmaaaa(iso = '') {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}${m[2]}${m[1]}` : '';
}

export function isoParaBr(iso = '') {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

// ---------------------------------------------------------------- valores
export function numeroPlanilha(valor) {
  const n = parseNumeroPlanilha(valor, null);
  return n === null ? null : n;
}

// Formato que o SAP (usuario pt-BR) recebe no campo: 2 casas, virgula decimal.
export function valorParaSap(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '';
  return (Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',');
}

// ---------------------------------------------------------------- planilhas
// Converte texto colado do Excel (TSV) em matriz.
export function tsvParaMatriz(texto = '') {
  const linhas = String(texto).replace(/\r/g, '').split('\n');
  while (linhas.length && !linhas[linhas.length - 1].trim()) linhas.pop();
  return linhas.map((l) => l.split('\t').map((c) => c.replace(/^"(.*)"$/s, '$1').trim()));
}

export async function lerPlanilhaArquivo(arquivo) {
  const XLSX = await import('xlsx');
  const buffer = await arquivo.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false, raw: true });
  return wb;
}

export function abaParaMatriz(XLSX, ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: false });
}

// Mapeia cabecalhos (com aliases) para indices de coluna.
export function mapearColunas(cabecalho = [], aliases = {}) {
  const norm = cabecalho.map(normalizarCabecalho);
  const mapa = {};
  Object.entries(aliases).forEach(([campo, lista]) => {
    for (const alias of lista) {
      const idx = norm.indexOf(normalizarCabecalho(alias));
      if (idx >= 0) { mapa[campo] = idx; break; }
    }
  });
  return mapa;
}

// ---------------------------------------------------------------- parametros
const TITULOS_EXCLUIDOS = new Set(['C7K0110004', 'C7K0110036', 'C7K0110128', 'C7K0111380', 'C7K0127244', 'C7K0130045', 'C7K1011206', 'C7K1027266']);
const CONC_EXCLUIDOS = new Set([
  '1401', '1710M001', '1710M023', '1710Y001', '1710Y007', '1710Y011', '1710Y022', '1710Y030', '1710Y031', '1710Y052', '1710Y053', '1710Y055', '1710Y056',
  '1710Z044', '1710Z056', '1710Z082', '1710Z093', '1710Z110', '1710Z111', '1710Z113', '1710Z116', '1710Z117', '1710Z118', '1710ZTRD',
  '5510G003', '5510M001', '5510M002', '5510M003', '5510M004', '5510M006', '5510M023', '5510Z111',
  '6210G003', '6210Y044', '6210Z023', '6210Z093', '6210Z110', '6210Z117', '6210Z118',
]);

// Regras do Power Query "Escritorios BI": tira titulos/escritorios excluidos, monta Conc =
// Empresa & Escritorio, ordena por Titulo decrescente e fica com o 1o de cada Conc.
export function tratarEscritoriosBi(linhas = []) {
  const validas = linhas
    .map((l) => ({
      titulo: String(l.titulo ?? '').trim(),
      escritorio: String(l.escritorio ?? '').trim(),
      empresa: String(l.empresa ?? '').trim(),
    }))
    .filter((l) => l.titulo && l.escritorio && l.empresa)
    .filter((l) => !TITULOS_EXCLUIDOS.has(l.titulo) && l.escritorio !== 'N/A' && l.escritorio !== 'N/D');
  validas.sort((a, b) => (a.titulo < b.titulo ? 1 : a.titulo > b.titulo ? -1 : 0));
  const vistos = new Set();
  const out = [];
  validas.forEach((l) => {
    const conc = `${l.empresa}${l.escritorio}`;
    if (vistos.has(conc) || CONC_EXCLUIDOS.has(conc)) { vistos.add(conc); return; }
    vistos.add(conc);
    out.push({ conc, titulo: l.titulo });
  });
  return out;
}

const ALIAS_FILIAIS = {
  cnpj: ['CNPJ OK'],
  emp: ['FILIAL SAP'],
  centro: ['FILIAL SAP_1', 'FILIAL SAP 1'],
};
const ALIAS_ESCRITORIOS = {
  titulo: ['Titulo', 'Título'],
  escritorio: ['Escritorio', 'Escritório'],
  empresa: ['Empresa'],
};

// Procura, entre as abas de um arquivo, a de Filiais (CNPJ OK + FILIAL SAP) e a de
// Escritorios (Titulo + Escritorio + Empresa). Serve para o Parametros.xlsx (abas
// Filiais_Cantu / Centro_C) e para as proprias planilhas de lancamento.
export async function extrairParametrosDeArquivo(arquivo) {
  const XLSX = await import('xlsx');
  const wb = await lerPlanilhaArquivo(arquivo);
  let filiais = null;
  let escritorios = null;
  wb.SheetNames.forEach((nome) => {
    const matriz = abaParaMatriz(XLSX, wb.Sheets[nome]);
    if (!matriz.length) return;
    const cab = matriz[0];
    const mf = mapearColunas(cab, ALIAS_FILIAIS);
    if (!filiais && mf.cnpj !== undefined && mf.emp !== undefined && mf.centro !== undefined) {
      const mapa = new Map();
      matriz.slice(1).forEach((r) => {
        const cnpj = normalizarCnpj(r[mf.cnpj]);
        const emp = String(r[mf.emp] ?? '').trim();
        const centro = String(r[mf.centro] ?? '').trim();
        if (cnpj && emp && !mapa.has(cnpj)) mapa.set(cnpj, { cnpj, emp, centro });
      });
      filiais = [...mapa.values()];
      return;
    }
    const me = mapearColunas(cab, ALIAS_ESCRITORIOS);
    if (!escritorios && me.titulo !== undefined && me.escritorio !== undefined && me.empresa !== undefined && matriz.length > 50) {
      escritorios = tratarEscritoriosBi(matriz.slice(1).map((r) => ({ titulo: r[me.titulo], escritorio: r[me.escritorio], empresa: r[me.empresa] })));
    }
  });
  if (!filiais && !escritorios) throw new Error('Nao encontrei as abas de Filiais (colunas "CNPJ OK" e "FILIAL SAP") nem de Escritorios BI neste arquivo.');
  return { filiais, escritorios };
}

export function carregarParametros() {
  try {
    const bruto = JSON.parse(window.localStorage.getItem(CHAVE_PARAMETROS) || 'null');
    if (bruto && Array.isArray(bruto.filiais) && Array.isArray(bruto.escritorios)) return bruto;
  } catch { /* localStorage indisponivel ou corrompido */ }
  return { filiais: [], escritorios: [], atualizadoEm: null };
}

export function salvarParametros({ filiais, escritorios }) {
  const atual = carregarParametros();
  const novo = {
    filiais: filiais || atual.filiais,
    escritorios: escritorios || atual.escritorios,
    atualizadoEm: new Date().toISOString(),
  };
  window.localStorage.setItem(CHAVE_PARAMETROS, JSON.stringify(novo));
  return novo;
}

export function criarIndices(parametros) {
  const filiais = new Map((parametros.filiais || []).map((f) => [f.cnpj, f]));
  const escritorios = new Map((parametros.escritorios || []).map((e) => [e.conc, e.titulo]));
  return { filiais, escritorios };
}

// ---------------------------------------------------------------- resultado do SAP
// Arquivo gravado pelo script: uma linha por documento, "id;pedido|miro;numero".
export function lerResultadoCsv(texto = '') {
  const mapa = new Map();
  String(texto).split(/\r?\n/).forEach((linha) => {
    const [id, tipo, numero] = linha.split(';').map((p) => (p ?? '').trim());
    if (!id || !numero || (tipo !== 'pedido' && tipo !== 'miro')) return;
    const atual = mapa.get(id) || {};
    atual[tipo] = numero;
    mapa.set(id, atual);
  });
  return mapa;
}

// Id estavel da linha, ASCII e sem ";" (vai no script e volta no resultado).
export function gerarIds(itens, chaveFn) {
  const usados = new Map();
  return itens.map((item) => {
    const base = semAcento(chaveFn(item)).replace(/[^\x20-\x7e]/g, '?').replace(/[;"|]/g, ',');
    const n = (usados.get(base) || 0) + 1;
    usados.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  });
}

export function baixarArquivo(nome, conteudo, mime = 'application/octet-stream') {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function baixarXlsx(nome, linhas, cabecalho) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([cabecalho, ...linhas.map((l) => cabecalho.map((c) => l[c] ?? ''))]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Dados');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  baixarArquivo(nome, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}
