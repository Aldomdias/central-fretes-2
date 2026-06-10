export const PAGE_URL_KEY = 'nf_page';
export const ID_URL_KEY = 'nf_id';
export const ABA_URL_KEY = 'nf_aba';

export const ABAS_GESTAO_URL = [
  'visao-geral',
  'negociacoes',
  'transportadora',
  'aprovacoes',
  'historico',
];

export function lerEstadoUrlNegociacao() {
  if (typeof window === 'undefined') {
    return { page: '', negociacaoId: '', aba: 'visao-geral' };
  }
  const params = new URLSearchParams(window.location.search);
  const abaRaw = params.get(ABA_URL_KEY) || '';
  return {
    page: params.get(PAGE_URL_KEY) || '',
    negociacaoId: params.get(ID_URL_KEY) || '',
    aba: ABAS_GESTAO_URL.includes(abaRaw) ? abaRaw : 'visao-geral',
  };
}

function montarUrl(params) {
  const qs = params.toString();
  return qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
}

function paramsAtuais() {
  return new URLSearchParams(window.location.search);
}

export function escreverEstadoUrlNegociacao(partial = {}, { empilhar = false } = {}) {
  if (typeof window === 'undefined') return;
  const params = paramsAtuais();

  if (partial.page !== undefined) {
    if (partial.page) params.set(PAGE_URL_KEY, partial.page);
    else params.delete(PAGE_URL_KEY);
  }

  if (partial.negociacaoId !== undefined) {
    if (partial.negociacaoId) params.set(ID_URL_KEY, partial.negociacaoId);
    else params.delete(ID_URL_KEY);
  }

  if (partial.aba !== undefined) {
    if (partial.aba && partial.aba !== 'visao-geral') params.set(ABA_URL_KEY, partial.aba);
    else params.delete(ABA_URL_KEY);
  }

  const url = montarUrl(params);
  const state = { nfNegociacao: Boolean(params.get(ID_URL_KEY)) };

  if (empilhar) window.history.pushState(state, '', url);
  else window.history.replaceState(state, '', url);
}

export function limparNegociacaoDaUrl(aba = 'visao-geral') {
  escreverEstadoUrlNegociacao({
    page: 'tabelas-negociacao',
    negociacaoId: '',
    aba,
  });
}

export function abrirNegociacaoNaUrl(id, aba) {
  escreverEstadoUrlNegociacao({
    page: 'tabelas-negociacao',
    negociacaoId: id,
    aba: aba || undefined,
  }, { empilhar: true });
}

export function sincronizarPaginaAppNaUrl(page) {
  if (!page) return;
  const params = paramsAtuais();
  params.set(PAGE_URL_KEY, page);
  if (page !== 'tabelas-negociacao') {
    params.delete(ID_URL_KEY);
    params.delete(ABA_URL_KEY);
  }
  window.history.replaceState({}, '', montarUrl(params));
}
