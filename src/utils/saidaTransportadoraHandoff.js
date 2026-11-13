// Repasse Simulador -> Simular Saída de Transportadora.
// O Simulador grava os parâmetros da análise (período, canal, transportadora
// executada e a tabela em negociação) e abre a tela de Saída numa nova aba,
// que lê, consome e roda sozinha: carrega o período, escolhe a transportadora,
// marca a tabela nova e simula. Fica em localStorage porque a nova aba não
// herda o estado React; expira em poucos minutos para não disparar depois.

const CHAVE = 'amd-saida-transportadora-handoff';
const VALIDADE_MS = 5 * 60 * 1000;

export function gravarHandoffSaidaTransportadora({ dataInicio = '', dataFim = '', canal = '', transportadora = '', negociacaoId = '', negociacaoLabel = '' } = {}) {
  if (typeof window === 'undefined') return;
  const payload = { dataInicio, dataFim, canal, transportadora, negociacaoId, negociacaoLabel, criadoEm: Date.now() };
  window.localStorage.setItem(CHAVE, JSON.stringify(payload));
}

export function consumirHandoffSaidaTransportadora() {
  if (typeof window === 'undefined') return null;
  const bruto = window.localStorage.getItem(CHAVE);
  if (!bruto) return null;
  window.localStorage.removeItem(CHAVE);
  try {
    const payload = JSON.parse(bruto);
    if (!payload || Date.now() - Number(payload.criadoEm || 0) > VALIDADE_MS) return null;
    return payload;
  } catch {
    return null;
  }
}

export function urlTelaSaidaTransportadora() {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams();
  params.set('nf_page', 'simular-saida-transportadora');
  return `${window.location.pathname}?${params.toString()}`;
}

// Escolhe, entre os grupos unificados da tela de Saída, o que corresponde à
// transportadora executada informada pelo Simulador (nome igual, ou um nome
// começando pelo outro: "RODOCAP" x "RODOCAP CARGAS LTDA").
export function escolherGrupoTransportadora(grupos = [], nomes = [], normalizar = (v) => String(v || '').toUpperCase().trim()) {
  const alvos = nomes.map(normalizar).filter((n) => n.length >= 3);
  if (!alvos.length) return null;
  const nomesDoGrupo = (g) => [g.nome, ...(g.variantes || []), ...(g.nomesTabela || [])].map(normalizar).filter(Boolean);
  const exato = grupos.find((g) => nomesDoGrupo(g).some((n) => alvos.includes(n)));
  if (exato) return exato;
  return grupos.find((g) => nomesDoGrupo(g).some((n) => alvos.some((a) => (a.length >= 4 && n.startsWith(a)) || (n.length >= 4 && a.startsWith(n))))) || null;
}
