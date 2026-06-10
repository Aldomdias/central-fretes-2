export const TOMADORES_CTE_PADRAO = ['CPX', 'ITR', 'GP PNEUS', 'GRIP', 'CANTU'];
export const CTE_BASE_CONFIG_STORAGE_KEY = 'central_fretes_cte_base_config_v1';
export const CTE_BASE_CONFIG_EVENT = 'central-fretes:cte-base-config';

export const MOTIVOS_EXCLUSAO_CTE = Object.freeze({
  tomador_vazio: { codigo: 'tomador_vazio', label: 'Tomador vazio ou ausente' },
  tomador_nao_aceito: { codigo: 'tomador_nao_aceito', label: 'Tomador fora da lista permitida' },
  ebazar: { codigo: 'ebazar', label: 'EBAZAR excluído pela política' },
  cps_log: { codigo: 'cps_log', label: 'CPS LOG excluído (flag desligada)' },
  cp_comercial: { codigo: 'cp_comercial', label: 'CP COMERCIAL / CP excluído (flag desligada)' },
  remetente: { codigo: 'remetente', label: 'Remetente (informativo, não filtra)' },
});

const CONFIG_PADRAO = Object.freeze({
  incluirCpComercial: false,
  incluirCpsLog: false,
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

export function getRemetenteCte(row = {}) {
  return primeiroValorCte(
    row.remetente,
    row.nome_remetente,
    row.nomeRemetente,
    row.razao_social_remetente,
    row.raw?.remetente,
    row.raw?.nomeRemetente,
  );
}

export function getDestinatarioCte(row = {}) {
  return primeiroValorCte(
    row.destinatario,
    row.nome_destinatario,
    row.nomeDestinatario,
    row.razao_social_destinatario,
    row.raw?.destinatario,
    row.raw?.nomeDestinatario,
  );
}

export function getCnpjTomadorCte(row = {}) {
  const bruto = primeiroValorCte(
    row.cnpj_tomador,
    row.cnpjTomador,
    row.cnpjTomadorServico,
    row.raw?.cnpjTomador,
    row.raw?.cnpj_tomador,
  );
  return String(bruto || '').replace(/\D/g, '');
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
  const tomador = normalizarTextoCte(getTomadorCte(row))
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (/\bCP\s+COMERCIAL\b/.test(tomador)) return true;

  const compacto = tomador.replace(/\s+/g, '');
  if (compacto === 'CP') return true;

  const tokens = tomador.split(' ').filter(Boolean);
  if (tokens.length === 1 && tokens[0] === 'CP') return true;

  return false;
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
      incluirCpsLog: salva?.incluirCpsLog === true,
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
    incluirCpsLog: config.incluirCpsLog === true,
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
    incluirCpsLog: opcoes.incluirCpsLog === undefined
      ? configuracao.incluirCpsLog
      : opcoes.incluirCpsLog === true,
    incluirCpComercial: opcoes.incluirCpComercial === undefined
      ? configuracao.incluirCpComercial
      : opcoes.incluirCpComercial === true,
  };
}

export function getOpcoesImportacaoPadrao() {
  const configuracao = carregarConfiguracaoBaseCte();
  return {
    ocultarEbazar: true,
    incluirCpsLog: configuracao.incluirCpsLog === true,
    incluirCpComercial: configuracao.incluirCpComercial === true,
  };
}

export function getOpcoesExibicaoPadrao() {
  return getOpcoesImportacaoPadrao();
}

function tomadorCorrespondeLista(tomadorNorm, permitido) {
  return tomadorNorm.includes(normalizarTextoCte(permitido));
}

function isTomadorListaPadrao(row = {}) {
  const tomador = normalizarTextoCte(getTomadorCte(row));
  if (!tomador || tomador === '-') return false;
  return TOMADORES_CTE_PADRAO.some((permitido) => tomadorCorrespondeLista(tomador, permitido));
}

export function isTomadorPermitidoCte(row = {}, opcoes = {}) {
  const resolvidas = resolverOpcoesBaseCte(opcoes);
  const tomador = normalizarTextoCte(getTomadorCte(row));

  if (!tomador || tomador === '-') return true;
  if (resolvidas.incluirCpComercial && isCpComercialCte(row)) return true;

  return isTomadorListaPadrao(row);
}

export function avaliarCteParaBase(row = {}, opcoes = {}) {
  const resolvidas = resolverOpcoesBaseCte(opcoes);
  const tomadorTexto = getTomadorCte(row);
  const tomador = normalizarTextoCte(tomadorTexto);
  const remetente = getRemetenteCte(row);
  const destinatario = getDestinatarioCte(row);
  const cnpjTomador = getCnpjTomadorCte(row);

  const base = {
    tomador: tomadorTexto,
    remetente,
    destinatario,
    cnpjTomador,
  };

  const rejeitar = (codigo) => ({
    aceito: false,
    codigo,
    motivo: MOTIVOS_EXCLUSAO_CTE[codigo]?.label || codigo,
    ...base,
  });

  if (!tomador || tomador === '-') {
    return rejeitar('tomador_vazio');
  }

  if (resolvidas.ocultarEbazar && isEbazarCte(row)) {
    return rejeitar('ebazar');
  }

  if (!resolvidas.incluirCpsLog && isCpsLogCte(row)) {
    return rejeitar('cps_log');
  }

  if (!resolvidas.incluirCpComercial && isCpComercialCte(row)) {
    return rejeitar('cp_comercial');
  }

  if (resolvidas.incluirCpComercial && isCpComercialCte(row)) {
    return { aceito: true, codigo: null, motivo: null, ...base };
  }

  if (!isTomadorListaPadrao(row)) {
    return rejeitar('tomador_nao_aceito');
  }

  return { aceito: true, codigo: null, motivo: null, ...base };
}

export function particionarCtesPorPolitica(rows = [], opcoes = {}) {
  const aceitos = [];
  const ignorados = [];

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const avaliacao = avaliarCteParaBase(row, opcoes);
    if (avaliacao.aceito) {
      aceitos.push(row);
    } else {
      ignorados.push({
        ...row,
        codigoExclusao: avaliacao.codigo,
        motivoExclusao: avaliacao.motivo,
        tomadorExclusao: avaliacao.tomador,
        remetenteExclusao: avaliacao.remetente,
        destinatarioExclusao: avaliacao.destinatario,
        cnpjTomadorExclusao: avaliacao.cnpjTomador,
      });
    }
  });

  return { aceitos, ignorados };
}

export function diagnosticarChaveCte(chave = '', contexto = {}) {
  const {
    registroBase = null,
    registroIgnorado = null,
    registroArquivo = null,
    opcoes = {},
  } = contexto;

  const chaveNorm = String(chave || '').replace(/\D/g, '');
  const resolvidas = resolverOpcoesBaseCte(opcoes);

  if (registroBase) {
    const avaliacao = avaliarCteParaBase(registroBase, resolvidas);
    return {
      status: 'na_base',
      chave: chaveNorm,
      avaliacao,
      registro: registroBase,
    };
  }

  if (registroIgnorado) {
    const avaliacao = avaliarCteParaBase(registroIgnorado, resolvidas);
    return {
      status: avaliacao.aceito ? 'ignorado_reprocessavel' : 'ignorado_importacao',
      chave: chaveNorm,
      avaliacao,
      registro: registroIgnorado,
      motivoIgnorado: registroIgnorado.motivoExclusao || avaliacao.motivo,
    };
  }

  if (registroArquivo) {
    const avaliacao = avaliarCteParaBase(registroArquivo, resolvidas);
    return {
      status: avaliacao.aceito ? 'aceito_arquivo' : 'rejeitado_politica',
      chave: chaveNorm,
      avaliacao,
      registro: registroArquivo,
    };
  }

  return {
    status: 'nao_encontrado',
    chave: chaveNorm,
    avaliacao: null,
    registro: null,
  };
}

export function aplicarPoliticaBaseCte(rows = [], opcoes = {}) {
  const resolvidas = resolverOpcoesBaseCte(opcoes);
  const filtradosCp = filtrarCpComercialCte(rows, resolvidas);

  return filtradosCp.filter((row) => {
    const avaliacao = avaliarCteParaBase(row, resolvidas);
    return avaliacao.aceito;
  });
}

export function filtrarCpComercialCte(rows = [], opcoes = {}) {
  const { incluirCpComercial } = resolverOpcoesBaseCte(opcoes);
  if (incluirCpComercial) return Array.isArray(rows) ? rows : [];
  return (Array.isArray(rows) ? rows : []).filter((row) => !isCpComercialCte(row));
}
