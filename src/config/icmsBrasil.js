const UF_BY_IBGE_PREFIX = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

const GRUPO_SUL_SUDESTE_EXCETO_ES = new Set(['SP', 'RJ', 'MG', 'PR', 'SC', 'RS']);
const GRUPO_N_NE_CO_E_ES = new Set(['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'RN', 'RO', 'RR', 'SE', 'TO']);

const ALIQUOTA_INTERESTADUAL_PADRAO = 12;
const ALIQUOTA_INTERESTADUAL_REDUZIDA = 7;
const ALIQUOTA_IMPORTADO = 4;
const ALIQUOTA_INTRAESTADUAL_FALLBACK = 12;

export function getUfFromIbge(ibge) {
  const digits = String(ibge || '').replace(/\D/g, '');
  if (digits.length < 2) return '';
  return UF_BY_IBGE_PREFIX[digits.slice(0, 2)] || '';
}

export function calcularAliquotaIcmsBrasil({ ibgeOrigem, ibgeDestino, ufOrigem, ufDestino, aliquotaCustomizada, origemImportada = false }) {
  const custom = Number(aliquotaCustomizada || 0);
  if (custom > 0) {
    return { aliquota: custom, origem: 'configuracao_da_transportadora' };
  }

  const ufO = String(ufOrigem || getUfFromIbge(ibgeOrigem) || '').toUpperCase();
  const ufD = String(ufDestino || getUfFromIbge(ibgeDestino) || '').toUpperCase();

  if (!ufO || !ufD) {
    return { aliquota: 0, origem: 'sem_uf' };
  }

  if (origemImportada) {
    return { aliquota: ALIQUOTA_IMPORTADO, origem: 'resolucao_senado_13_2012' };
  }

  if (ufO === ufD) {
    return { aliquota: ALIQUOTA_INTRAESTADUAL_FALLBACK, origem: 'fallback_interno_padrao' };
  }

  if (GRUPO_SUL_SUDESTE_EXCETO_ES.has(ufO) && GRUPO_N_NE_CO_E_ES.has(ufD)) {
    return { aliquota: ALIQUOTA_INTERESTADUAL_REDUZIDA, origem: 'interestadual_7' };
  }

  return { aliquota: ALIQUOTA_INTERESTADUAL_PADRAO, origem: 'interestadual_12' };
}

export function descreverRegraIcms(codigoOrigem) {
  switch (codigoOrigem) {
    case 'configuracao_da_transportadora':
      return 'Alíquota da transportadora';
    case 'resolucao_senado_13_2012':
      return 'Importado 4%';
    case 'interestadual_7':
      return 'Interestadual 7%';
    case 'interestadual_12':
      return 'Interestadual 12%';
    case 'fallback_interno_padrao':
      return 'Interno padrão';
    default:
      return 'Sem alíquota';
  }
}
