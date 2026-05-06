export const GRADE_FRETE_STORAGE_KEY = 'amd-grade-peso-v2';

export const GRADE_FRETE_PADRAO = {
  B2C: [
    { peso: 2, valorNF: 150, cubagem: 0 },
    { peso: 5, valorNF: 250, cubagem: 0 },
    { peso: 10, valorNF: 400, cubagem: 0 },
    { peso: 20, valorNF: 800, cubagem: 0 },
    { peso: 30, valorNF: 1200, cubagem: 0 },
    { peso: 50, valorNF: 1800, cubagem: 0 },
    { peso: 70, valorNF: 2400, cubagem: 0 },
    { peso: 100, valorNF: 3000, cubagem: 0 },
    { peso: 999999999, valorNF: 4500, cubagem: 0 },
  ],
  ATACADO: [
    { peso: 20, valorNF: 1200, cubagem: 0 },
    { peso: 30, valorNF: 1600, cubagem: 0 },
    { peso: 50, valorNF: 2000, cubagem: 0 },
    { peso: 70, valorNF: 2600, cubagem: 0 },
    { peso: 100, valorNF: 3000, cubagem: 0 },
    { peso: 150, valorNF: 5000, cubagem: 0 },
    { peso: 250, valorNF: 8000, cubagem: 0 },
    { peso: 500, valorNF: 12000, cubagem: 0 },
    { peso: 999999999, valorNF: 20000, cubagem: 0 },
  ],
};

export function numeroGradeFrete(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value).trim();
  if (!text) return 0;
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  return Number(normalized.replace(/[^0-9.-]/g, '')) || 0;
}

export function normalizarCanalGrade(canal = '') {
  const value = String(canal || '').trim().toUpperCase();
  if (value.includes('B2C') || value.includes('ECOMMERCE') || value.includes('MARKET')) return 'B2C';
  return 'ATACADO';
}

export function normalizarGradeFrete(grade = {}) {
  const base = { ...GRADE_FRETE_PADRAO, ...(grade || {}) };
  return Object.entries(base).reduce((acc, [canal, linhas]) => {
    const key = normalizarCanalGrade(canal);
    const normalizadas = (Array.isArray(linhas) ? linhas : [])
      .map((item) => ({
        peso: numeroGradeFrete(item?.peso),
        valorNF: numeroGradeFrete(item?.valorNF ?? item?.valorNf ?? item?.nf),
        cubagem: numeroGradeFrete(item?.cubagem ?? item?.m3 ?? item?.metrosCubicos),
      }))
      .filter((item) => item.peso > 0)
      .sort((a, b) => a.peso - b.peso);
    acc[key] = normalizadas.length ? normalizadas : GRADE_FRETE_PADRAO[key];
    return acc;
  }, {});
}

export function carregarGradeFrete() {
  try {
    const raw = localStorage.getItem(GRADE_FRETE_STORAGE_KEY);
    if (!raw) return normalizarGradeFrete(GRADE_FRETE_PADRAO);
    return normalizarGradeFrete(JSON.parse(raw));
  } catch {
    return normalizarGradeFrete(GRADE_FRETE_PADRAO);
  }
}

export function salvarGradeFrete(grade = {}) {
  const normalizada = normalizarGradeFrete(grade);
  localStorage.setItem(GRADE_FRETE_STORAGE_KEY, JSON.stringify(normalizada));
  return normalizada;
}

export function restaurarGradeFretePadrao() {
  return salvarGradeFrete(GRADE_FRETE_PADRAO);
}

export function encontrarLinhaGradePorPeso(gradeCanal = [], pesoInformado = 0) {
  const peso = numeroGradeFrete(pesoInformado);
  const lista = (Array.isArray(gradeCanal) ? gradeCanal : [])
    .map((item) => ({
      peso: numeroGradeFrete(item?.peso),
      valorNF: numeroGradeFrete(item?.valorNF ?? item?.valorNf ?? item?.nf),
      cubagem: numeroGradeFrete(item?.cubagem ?? item?.m3 ?? item?.metrosCubicos),
    }))
    .filter((item) => item.peso > 0)
    .sort((a, b) => a.peso - b.peso);

  if (!lista.length) return null;
  return lista.find((item) => peso <= item.peso) || lista[lista.length - 1];
}

export function clonarGradeFrete(grade = {}) {
  return normalizarGradeFrete(grade);
}
