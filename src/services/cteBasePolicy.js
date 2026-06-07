export const TOMADORES_CTE_PADRAO = ['CPX', 'ITR', 'GP PNEUS'];
export const CTE_BASE_CONFIG_STORAGE_KEY = 'central_fretes_cte_base_config_v1';
export const CTE_BASE_CONFIG_EVENT = 'central-fretes:cte-base-config';

const CONFIG_PADRAO = Object.freeze({
  incluirCpComercial: false,
});

export function normalizarTextoCte(valor = '') {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function primeiroValorCte(...valores) {
  return valores.find((valor) => (
    valor !== undefined && valor !== null && String(valor).trim() !== ''
  )) ?? '';
}

export function getTomadorCte(row = {}) {
  return primeiroValorCte(
    row.tomador_servico,
    row.tomadorServico,
    row.tomador,
    row.nome_tomador,
    row.nomeTomador,
    row.razao_social_tomador,
    row.raw?.tomador_servico,
    row.raw?.tomadorServico,
    row.raw?.tomador,
  );
}

export function getTransportadoraCte(row = {}) {
  return primeiroValorCte(
    row.transportadora,
    row.nome_transportadora,
    row.nomeTransportadora,
    row.transportadora_realizada,
    row.transportadoraReal,
    row.transportador,
    row.raw?.transportadora,
    row.raw?.nome_transportadora,
  );
}

export function isCpComercialCte(row = {}) {
  const tomador = normalizarTextoCte(getTomadorCte(row)).replace(/[^A-Z0-9]+/g, ' ');
  return /\bCP\s+COMERCIAL\b/.test(tomador);
}

export function isCpsLogCte(row = {}) {
  const texto = normalizarTextoCte(`${getTransportadoraCte(row)} ${getTomadorCte(row)}`)
    .replace(/[^A-Z0-9]+/g, '');
  return texto.includes('CPSLOG');
}

export function isEbazarCte(row = {}) {
  return normalizarTextoCte(`${getTransportadoraCte(row)} ${getTomadorCte(row)}`)
    .includes('EBAZAR');
}

export function carregarConfiguracaoBaseCte() {
  if (typeof localStorage === 'undefined') return { ...CONFIG_PADRAO };

  try {
    const salva = JSON.parse(localStorage.getItem(CTE_BASE_CONFIG_STORAGE_KEY) || 'null');
    return {
      ...CONFIG_PADRAO,
      ...(salva && typeof salva === 'object' ? salva : {}),
      incluirCpComercial: salva?.incluirCpComercial === true,
    };
  } catch {
    return { ...CONFIG_PADRAO };
  }
}

export function salvarConfiguracaoBaseCte(config = {}) {
  const normalizada = {
    ...carregarConfiguracaoBaseCte(),
    ...config,
    incluirCpComercial: config.incluirCpComercial === true,
  };

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(CTE_BASE_CONFIG_STORAGE_KEY, JSON.stringify(normalizada));
    } catch {
      // A preferência continua válida na tela atual mesmo sem persistência local.
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CTE_BASE_CONFIG_EVENT, { detail: normalizada }));
  }

  return normalizada;
}

export function resolverOpcoesBaseCte(opcoes = {}) {
  const configuracao = carregarConfiguracaoBaseCte();
  return {
    ocultarEbazar: opcoes.ocultarEbazar !== false,
    incluirCpsLog: opcoes.incluirCpsLog === true,
    incluirCpComercial: opcoes.incluirCpComercial === undefined
      ? configuracao.incluirCpComercial
      : opcoes.incluirCpComercial === true,
  };
}

export function isTomadorPermitidoCte(row = {}, opcoes = {}) {
  const { incluirCpComercial } = resolverOpcoesBaseCte(opcoes);
  const tomador = normalizarTextoCte(getTomadorCte(row));

  if (!tomador || tomador === '-') return true;
  if (incluirCpComercial && isCpComercialCte(row)) return true;

  return TOMADORES_CTE_PADRAO.some((permitido) => (
    tomador.includes(normalizarTextoCte(permitido))
  ));
}

export function aplicarPoliticaBaseCte(rows = [], opcoes = {}) {
  const resolvidas = resolverOpcoesBaseCte(opcoes);

  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!isTomadorPermitidoCte(row, resolvidas)) return false;
    if (resolvidas.ocultarEbazar && isEbazarCte(row)) return false;
    if (!resolvidas.incluirCpsLog && isCpsLogCte(row)) return false;
    return true;
  });
}

export function filtrarCpComercialCte(rows = [], opcoes = {}) {
  const { incluirCpComercial } = resolverOpcoesBaseCte(opcoes);
  if (incluirCpComercial) return Array.isArray(rows) ? rows : [];
  return (Array.isArray(rows) ? rows : []).filter((row) => !isCpComercialCte(row));
}
