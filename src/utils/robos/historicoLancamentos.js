// Historico de lancamentos dos robos (NFS-e e CT-e): mapeamento das linhas para o registro e
// agregacao mensal para o acompanhamento ("quantas notas por mes").

export const TIPOS_LANCAMENTO = { NFSE: 'NFS-e', CTE: 'CT-e' };

function dataOuNulo(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null;
}

// Linha calculada pelo robo -> registro do historico. So entra o que tem MIRO.
export function linhaParaRegistro(tipo, l) {
  if (!l?.miro) return null;
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
    miro: String(l.miro),
  };
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
