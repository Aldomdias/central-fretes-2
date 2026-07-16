export const ICMS_UF_MATRIX_KEY = 'central-fretes:icms-uf-matrix-v1';

export const UFS_BR = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
];

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value)
    .replace(/R\$/gi, '')
    .replace(/%/g, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^0-9.-]/g, '');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normUf(value) {
  return String(value || '').trim().toUpperCase().slice(0, 2);
}

function normText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function campo(row = {}, nomes = []) {
  const keys = Object.keys(row || {});
  for (const nome of nomes) {
    const alvo = String(nome).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    const key = keys.find((k) => String(k).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase() === alvo);
    if (key && row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') return row[key];
  }
  return '';
}

export function normalizarLinhaIcms(row = {}) {
  const ufOrigem = normUf(campo(row, ['UF_ORIGEM', 'UF ORIGEM', 'ORIGEM', 'UF Origem']));
  const ufDestino = normUf(campo(row, ['UF_DESTINO', 'UF DESTINO', 'DESTINO', 'UF Destino']));
  const aliquota = toNumber(campo(row, ['ALIQUOTA', 'ALÍQUOTA', 'ICMS', 'ALIQUOTA_ICMS', 'ALÍQUOTA ICMS']));
  if (!UFS_BR.includes(ufOrigem) || !UFS_BR.includes(ufDestino) || aliquota <= 0) return null;
  return {
    transportadora: String(campo(row, ['TRANSPORTADORA', 'TRANSPORTADORA_TABELA', 'TRANSPORTADORA TABELA']) || row.transportadora || '').trim(),
    cidadeOrigem: String(campo(row, ['CIDADE_ORIGEM', 'CIDADE ORIGEM', 'ORIGEM_CIDADE', 'ORIGEM CIDADE']) || row.cidadeOrigem || '').trim(),
    canal: String(campo(row, ['CANAL']) || row.canal || '').trim().toUpperCase(),
    ufOrigem,
    ufDestino,
    aliquota,
    observacao: String(campo(row, ['OBS', 'OBSERVACAO', 'OBSERVAÇÃO']) || '').trim(),
  };
}

export function carregarMatrizIcmsUf() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ICMS_UF_MATRIX_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((row) => row?.ufOrigem && row?.ufDestino && Number(row?.aliquota) > 0) : [];
  } catch {
    return [];
  }
}

export function salvarMatrizIcmsUf(linhas = []) {
  const mapa = new Map();
  (linhas || []).forEach((row) => {
    const normalizada = normalizarLinhaIcms(row) || row;
    const ufOrigem = normUf(normalizada.ufOrigem);
    const ufDestino = normUf(normalizada.ufDestino);
    const aliquota = toNumber(normalizada.aliquota);
    if (!UFS_BR.includes(ufOrigem) || !UFS_BR.includes(ufDestino) || aliquota <= 0) return;
    const transportadora = String(normalizada.transportadora || '').trim();
    const cidadeOrigem = String(normalizada.cidadeOrigem || '').trim();
    const canal = String(normalizada.canal || '').trim().toUpperCase();
    mapa.set(`${normText(transportadora)}-${normText(cidadeOrigem)}-${canal}-${ufOrigem}-${ufDestino}`, {
      transportadora,
      cidadeOrigem,
      canal,
      ufOrigem,
      ufDestino,
      aliquota,
      observacao: String(normalizada.observacao || '').trim(),
    });
  });
  const lista = Array.from(mapa.values()).sort((a, b) => a.ufOrigem.localeCompare(b.ufOrigem) || a.ufDestino.localeCompare(b.ufDestino));
  localStorage.setItem(ICMS_UF_MATRIX_KEY, JSON.stringify(lista));
  return lista;
}

export function resolverAliquotaIcmsUf(ufOrigem, ufDestino) {
  return resolverAliquotaIcmsUfContexto({ ufOrigem, ufDestino });
}

export function resolverAliquotaIcmsUfContexto({ ufOrigem, ufDestino, transportadora = '', cidadeOrigem = '', canal = '' } = {}) {
  const origem = normUf(ufOrigem);
  const destino = normUf(ufDestino);
  if (!origem || !destino) return null;
  const transpNorm = normText(transportadora);
  const cidadeNorm = normText(cidadeOrigem);
  const canalNorm = String(canal || '').trim().toUpperCase();
  const candidatos = carregarMatrizIcmsUf()
    .filter((row) => row.ufOrigem === origem && row.ufDestino === destino)
    .filter((row) => !row.transportadora || normText(row.transportadora) === transpNorm)
    .filter((row) => !row.cidadeOrigem || normText(row.cidadeOrigem) === cidadeNorm)
    .filter((row) => !row.canal || String(row.canal).trim().toUpperCase() === canalNorm)
    .map((row) => ({
      row,
      score: (row.transportadora ? 4 : 0) + (row.cidadeOrigem ? 2 : 0) + (row.canal ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  const linha = candidatos[0]?.row;
  if (!linha) return null;
  return {
    aliquota: Number(linha.aliquota),
    origem: linha.transportadora || linha.cidadeOrigem || linha.canal ? 'excecao_icms_transportadora' : 'matriz_icms_uf',
    ufOrigem: origem,
    ufDestino: destino,
  };
}

export function modeloMatrizIcmsUf() {
  return UFS_BR.flatMap((ufOrigem) => UFS_BR.map((ufDestino) => ({
    TRANSPORTADORA: '',
    CIDADE_ORIGEM: '',
    CANAL: '',
    UF_ORIGEM: ufOrigem,
    UF_DESTINO: ufDestino,
    ALIQUOTA: ufOrigem === ufDestino ? 17 : '',
    OBSERVACAO: '',
  })));
}
