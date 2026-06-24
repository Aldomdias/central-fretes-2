// Regras de casamento cidade -> IBGE para reduzir cidades "não resolvidas".
// Usado pelos resolvedores da Gestão Base CT-e e do Simulador.
//
// 1) DF é município único (Distrito Federal) -> sempre 5300108.
// 2) Nome com sufixo de UF colado ("VITORIA-ES", "SANTA RITA-PB") -> tira o sufixo.
// 3) Parêntese de região ("BRASILIA (TAGUATINGA)") -> tira o conteúdo.
// 4) Chave "compacta" sem espaços resolve apóstrofo/espacos:
//    "Sant'Ana"=="SANTANA", "Santa Barbara d'Oeste"=="SANTA BARBARA D OESTE",
//    "Dias d'Ávila"=="Dias DAvila".

export const UFS_VALIDAS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

export const IBGE_DISTRITO_FEDERAL = '5300108';

export function normalizarCidadeIbge(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Forma compacta: só letras/dígitos, sem espaços. Neutraliza apóstrofo e espaços.
export function compactarCidadeIbge(texto) {
  return normalizarCidadeIbge(texto).replace(/\s+/g, '');
}

export function ibgeDistritoFederal(uf) {
  return String(uf || '').trim().toUpperCase() === 'DF' ? IBGE_DISTRITO_FEDERAL : '';
}

// Variantes do NOME (não normalizadas) a tentar, em ordem de preferência.
export function variantesCidadeIbge(cidade, uf) {
  const base = String(cidade || '').trim();
  if (!base) return [];
  const out = [];
  const add = (v) => { const t = String(v || '').trim(); if (t && !out.includes(t)) out.push(t); };

  add(base);

  // remove parêntese e conteúdo: "BRASILIA (TAGUATINGA)" -> "BRASILIA"
  const semParens = base.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  add(semParens);

  // remove sufixo de UF colado no fim do nome: "VITORIA-ES", "SANTA RITA PB"
  const ufAlvo = String(uf || '').trim().toUpperCase();
  for (const v of [...out]) {
    const m = v.match(/^(.*[a-z0-9])[\s-]+([A-Za-z]{2})$/i);
    if (m) {
      const sufixo = m[2].toUpperCase();
      if (sufixo === ufAlvo || UFS_VALIDAS.has(sufixo)) add(m[1].trim());
    }
  }

  return out;
}

// Resolve o IBGE aplicando as regras. `buscarNorm` consulta o índice por chave
// normalizada (cidade e cidade/uf); `buscarCompacto` consulta o índice compacto.
// Ambos devem retornar o código IBGE (string) ou '' quando não acham.
export function resolverIbgeComRegras(cidade, uf, buscarNorm, buscarCompacto) {
  const df = ibgeDistritoFederal(uf);
  if (df) return df;

  const temUf = Boolean(String(uf || '').trim());
  const variantes = variantesCidadeIbge(cidade, uf);

  // 1ª passada: casamento normal (com e sem UF). A chave com UF normaliza a
  // string inteira "cidade/uf" (a barra vira espaço) — igual aos índices.
  for (const nome of variantes) {
    const so = normalizarCidadeIbge(nome);
    if (!so) continue;
    const hit = (temUf && buscarNorm(normalizarCidadeIbge(`${nome}/${uf}`))) || buscarNorm(so);
    if (hit) return hit;
  }

  // 2ª passada: forma compacta (apóstrofo/espacos).
  if (typeof buscarCompacto === 'function') {
    for (const nome of variantes) {
      const so = compactarCidadeIbge(nome);
      if (!so) continue;
      const hit = (temUf && buscarCompacto(compactarCidadeIbge(`${nome}/${uf}`))) || buscarCompacto(so);
      if (hit) return hit;
    }
  }

  return '';
}
