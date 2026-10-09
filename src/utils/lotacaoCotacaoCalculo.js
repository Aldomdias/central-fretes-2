// Calculo de ICMS/bruto da cotacao de lotacao (mesma regra do portal em api/lotacao-cotacao).
// Aliquota: tabela do sistema (tela ICMS UF) e, fora dela, a legislacao.
const UF_SUL_SUDESTE = new Set(['SP', 'RJ', 'MG', 'PR', 'SC', 'RS']);

// Aliquotas internas de referencia (conferir na tela ICMS UF; a tabela do sistema tem prioridade).
export const ALIQUOTA_INTERNA_UF = {
  AC: 19, AL: 20, AM: 20, AP: 18, BA: 20.5, CE: 20, DF: 20, ES: 17, GO: 19, MA: 23, MG: 18, MS: 17, MT: 17,
  PA: 19, PB: 20, PE: 20.5, PI: 22.5, PR: 19.5, RJ: 22, RN: 20, RO: 19.5, RR: 20, RS: 17, SC: 17, SE: 19, SP: 18, TO: 20,
};

const arred = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function aliquotaDaRota(matriz, ufOrigem, ufDestino) {
  const uo = String(ufOrigem || '').toUpperCase();
  const ud = String(ufDestino || '').toUpperCase();
  const candidatas = (matriz || []).filter((m) => String(m.ufOrigem).toUpperCase() === uo && String(m.ufDestino).toUpperCase() === ud && Number(m.aliquota) > 0);
  const generica = candidatas.find((m) => !m.transportadora && !m.cidadeOrigem && !m.canal);
  const achada = generica || candidatas[0];
  if (achada) return { aliquota: Number(achada.aliquota), fonte: 'matriz' };
  if (!uo || !ud) return { aliquota: null, fonte: 'sem_uf' };
  if (uo === ud) {
    const interna = ALIQUOTA_INTERNA_UF[uo];
    return interna ? { aliquota: interna, fonte: 'estimada_interna' } : { aliquota: null, fonte: 'sem_uf' };
  }
  const para7 = UF_SUL_SUDESTE.has(uo) && !UF_SUL_SUDESTE.has(ud);
  return { aliquota: para7 ? 7 : 12, fonte: 'legislacao_interestadual' };
}

// bruto = liquido / (1 - aliquota)
export function calcularBruto(liquido, aliquota) {
  const liq = Number(liquido) || 0;
  if (!(aliquota > 0) || aliquota >= 100) return { bruto: arred(liq), icms: 0 };
  const bruto = arred(liq / (1 - aliquota / 100));
  return { bruto, icms: arred(bruto - liq) };
}

export function liquidoDoBruto(bruto, aliquota) {
  const b = Number(bruto) || 0;
  if (!(aliquota > 0) || aliquota >= 100) return arred(b);
  return arred(b * (1 - aliquota / 100));
}
