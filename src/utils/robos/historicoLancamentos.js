// Historico de lancamentos dos robos (NFS-e e CT-e): mapeamento das linhas para o registro e
// agregacao mensal para o acompanhamento ("quantas notas por mes").

export const TIPOS_LANCAMENTO = { NFSE: 'NFS-e', CTE: 'CT-e' };

function dataOuNulo(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null;
}

// Linha calculada pelo robo -> registro do historico. Entra o que tem MIRO e tambem o que so tem
// pedido (miro = '' ate a MIRO sair; ai entra outro registro e o de pedido deixa de aparecer).
export function linhaParaRegistro(tipo, l) {
  if (!l?.miro && !l?.pedido) return null;
  return {
    tipo,
    documento: String(tipo === 'CTE' ? l.cte : l.nf || '').trim(),
    cnpj_transp: l.cnpjTransp || null,
    transportadora: l.transportadora || null,
    empresa: l.emp || null,
    centro: l.centro || null,
    centro_custo: l.cc || null,
    valor: Number(tipo === 'CTE' ? l.bruto : l.valor) || 0,
    data_emissao: dataOuNulo(l.dataEmissao),
    vencimento: dataOuNulo(l.vencimento),
    fatura: l.fatura || null,
    pedido: l.pedido || null,
    miro: String(l.miro || ''),
  };
}

// Tira do historico o registro "so pedido" de quem ja tem MIRO.
export function registrosVisiveis(registros = []) {
  const comMiro = new Set(registros.filter((r) => r.miro).map((r) => `${r.tipo}|${r.documento}`));
  return registros.filter((r) => r.miro || !comMiro.has(`${r.tipo}|${r.documento}`));
}

export function chaveRegistro(r) {
  return `${r.tipo}|${r.miro}|${r.documento}`;
}

function mesDe(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// registros: [{ tipo, valor, transportadora, lancado_em }] -> uma linha por mes do ano
export function agregarPorMes(registros = [], ano, tipo = '') {
  const meses = Array.from({ length: 12 }, (_, i) => ({
    mes: `${ano}-${String(i + 1).padStart(2, '0')}`, nfse: 0, cte: 0, total: 0, valor: 0, transportadoras: new Set(),
  }));
  registros.forEach((r) => {
    if (tipo && r.tipo !== tipo) return;
    if (r.miro === '') return; // so pedido: ainda nao e lancamento concluido
    const m = meses.find((x) => x.mes === mesDe(r.lancado_em));
    if (!m) return;
    if (r.tipo === 'NFSE') m.nfse += 1; else if (r.tipo === 'CTE') m.cte += 1;
    m.total += 1;
    m.valor += Number(r.valor) || 0;
    if (r.transportadora) m.transportadoras.add(r.transportadora);
  });
  return meses.map((m) => ({ ...m, transportadoras: m.transportadoras.size, valor: Math.round(m.valor * 100) / 100 }));
}

export function anosDisponiveis(registros = []) {
  const anos = new Set(registros.map((r) => mesDe(r.lancado_em).slice(0, 4)).filter(Boolean));
  anos.add(String(new Date().getFullYear()));
  return [...anos].sort().reverse();
}

// Numero da fatura sem zeros a esquerda e sem pontuacao ("005.508" e "5508" sao a mesma fatura).
export function normalizarNumeroFatura(v) {
  return String(v ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+(?=.)/, '');
}

const raiz = (cnpj) => String(cnpj || '').replace(/\D/g, '').slice(0, 8);
const nomeChave = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  .replace(/\b(LTDA|EIRELI|S\/?A|ME|EPP)\b/g, '').replace(/[^A-Z0-9]/g, '');

// O lancamento do robo e desta fatura? Mesmo numero de fatura e mesma transportadora
// (raiz do CNPJ quando os dois lados tem; senao o nome).
export function lancamentoDaFatura(registro = {}, fatura = {}) {
  const num = normalizarNumeroFatura(registro.fatura);
  if (!num || num !== normalizarNumeroFatura(fatura.numero_fatura)) return false;
  const rr = raiz(registro.cnpj_transp);
  const rf = raiz(fatura.cnpj_transportadora);
  if (rr.length === 8 && rf.length === 8) return rr === rf;
  const nr = nomeChave(registro.transportadora);
  const nf = nomeChave(fatura.transportadora);
  return Boolean(nr && nf) && (nr === nf || nr.startsWith(nf) || nf.startsWith(nr));
}

// Etapa do lancamento: pedido -> MIRO -> partida (lancamento contabil) -> pago.
export function etapaLancamento(r = {}) {
  if (r.situacao_pagamento === 'pago') return 'pago';
  if (r.lancamento_contabil) return 'partida';
  if (r.miro) return 'miro';
  return 'pedido';
}

// Resumo dos lancamentos de uma fatura (ja filtrados): quantos em cada etapa e o valor.
export function resumirLancamentosFatura(registros = []) {
  const visiveis = registrosVisiveis(registros);
  const etapas = { pedido: 0, miro: 0, partida: 0, pago: 0 };
  let valor = 0;
  visiveis.forEach((r) => { etapas[etapaLancamento(r)] += 1; valor += Number(r.valor) || 0; });
  const total = visiveis.length;
  let etapa = 'pedido';
  if (total && etapas.pago === total) etapa = 'pago';
  else if (total && etapas.partida + etapas.pago === total) etapa = 'partida';
  else if (total && etapas.miro + etapas.partida + etapas.pago === total) etapa = 'miro';
  return { registros: visiveis, total, etapas, etapa, valor: Math.round(valor * 100) / 100 };
}
