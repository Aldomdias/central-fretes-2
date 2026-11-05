// Tracking do mes x base de CT-es (provisao por competencia).
// Cada NF do tracking (data da NF dentro da competencia) e' classificada:
//  - COM_CTE: tem chave de CT-e e o CT-e esta na base (veio da Sefaz)
//  - CTE_FORA_BASE: tracking traz a chave do CT-e, mas o CT-e nao esta na base
//  - SEM_CTE: tracking nao traz chave de CT-e (documento pode nao ter entrado)
// Os dois ultimos sao candidatos a provisao: o frete e' estimado pelo % frete/valor NF
// das NFs da mesma transportadora que tem CT-e na base (senao, % geral do mes).

const digitos = (v) => String(v ?? '').replace(/\D/g, '');

export const SITUACOES_TRACKING = {
  COM_CTE: 'Com CT-e na base',
  CTE_FORA_BASE: 'CT-e fora da base',
  SEM_CTE: 'Sem CT-e vinculado',
};

export const CORES_TRACKING = { COM_CTE: '#15803d', CTE_FORA_BASE: '#c2410c', SEM_CTE: '#b91c1c' };

export function cancelada(linha) {
  return ['CAN', 'DEV'].includes(String(linha.status_pedido || '').trim().toUpperCase().slice(0, 3));
}

// Agrupa as linhas do tracking por NF (chave da NF; sem ela, numero + transportadora).
export function agruparNfsTracking(linhas = []) {
  const porNf = new Map();
  let canceladas = 0;
  for (const l of linhas) {
    if (cancelada(l)) { canceladas += 1; continue; }
    const chaveNfe = digitos(l.chave_nfe);
    const id = chaveNfe.length === 44 ? chaveNfe : `${String(l.nota_fiscal || '').trim()}|${String(l.transportadora || '').trim().toUpperCase()}`;
    if (!porNf.has(id)) {
      porNf.set(id, {
        id, chave_nfe: chaveNfe.length === 44 ? chaveNfe : '', nota_fiscal: l.nota_fiscal || '', data: String(l.data || '').slice(0, 10),
        transportadora: String(l.transportadora || '').trim() || '(sem transportadora)', canal: l.canal || '', pedido: l.pedido || '',
        origem: `${l.cidade_origem || ''}${l.uf_origem ? `/${l.uf_origem}` : ''}`, destino: `${l.cidade_destino || ''}${l.uf_destino ? `/${l.uf_destino}` : ''}`,
        valor_nf: 0, chaves_cte: new Set(), cte_numero: '',
      });
    }
    const nf = porNf.get(id);
    nf.valor_nf += Number(l.valor_nf || 0);
    const cte = digitos(l.chave_cte);
    if (cte.length === 44) nf.chaves_cte.add(cte);
    if (!nf.cte_numero && l.cte_numero) nf.cte_numero = String(l.cte_numero);
  }
  return { nfs: [...porNf.values()], canceladas };
}

// Empresa SAP pelo CNPJ emitente da NF (pos. 7-20 da chave) nas Filiais dos robos.
export function empresaDaChaveNfe(chaveNfe, filiaisPorCnpj = new Map()) {
  const d = digitos(chaveNfe);
  return d.length === 44 ? filiaisPorCnpj.get(d.slice(6, 20))?.emp || '' : '';
}

/**
 * nfs: saida de agruparNfsTracking. valorCtePorChave: Map(chave_cte -> valor) dos CT-es na base.
 * Devolve as NFs classificadas, com frete estimado nas que nao tem CT-e na base.
 */
export function classificarNfsTracking(nfs = [], valorCtePorChave = new Map(), filiaisPorCnpj = new Map()) {
  const razao = new Map();
  let geralNf = 0;
  let geralFrete = 0;
  const base = nfs.map((nf) => {
    const chaves = [...nf.chaves_cte];
    const naBase = chaves.filter((c) => valorCtePorChave.has(c));
    const situacao = !chaves.length ? 'SEM_CTE' : naBase.length ? 'COM_CTE' : 'CTE_FORA_BASE';
    const freteBase = naBase.reduce((acc, c) => acc + Number(valorCtePorChave.get(c) || 0), 0);
    if (situacao === 'COM_CTE' && nf.valor_nf > 0 && freteBase > 0) {
      const r = razao.get(nf.transportadora) || { nf: 0, frete: 0 };
      r.nf += nf.valor_nf; r.frete += freteBase;
      razao.set(nf.transportadora, r);
      geralNf += nf.valor_nf; geralFrete += freteBase;
    }
    return { ...nf, chaves_cte: chaves, situacao, frete_base: freteBase };
  });
  const pctGeral = geralNf > 0 ? geralFrete / geralNf : 0;
  return base.map((nf) => {
    const r = razao.get(nf.transportadora);
    const pct = r && r.nf > 0 ? r.frete / r.nf : pctGeral;
    const estimado = nf.situacao === 'COM_CTE' ? 0 : Math.round(nf.valor_nf * pct * 100) / 100;
    return { ...nf, pct_frete: pct, frete_estimado: estimado, empresa: empresaDaChaveNfe(nf.chave_nfe, filiaisPorCnpj) };
  });
}

export function resumirTracking(nfs = [], canceladas = 0) {
  const vazio = () => ({ qtd: 0, valor_nf: 0, estimado: 0 });
  const total = { geral: vazio(), pendente: vazio() };
  Object.keys(SITUACOES_TRACKING).forEach((k) => { total[k] = vazio(); });
  const porTransp = new Map();
  for (const nf of nfs) {
    const somar = (a) => { a.qtd += 1; a.valor_nf += nf.valor_nf; a.estimado += nf.frete_estimado; };
    somar(total.geral); somar(total[nf.situacao]);
    if (nf.situacao !== 'COM_CTE') somar(total.pendente);
    if (!porTransp.has(nf.transportadora)) {
      const t = { nome: nf.transportadora, geral: vazio(), pendente: vazio(), pct_frete: nf.pct_frete };
      Object.keys(SITUACOES_TRACKING).forEach((k) => { t[k] = vazio(); });
      porTransp.set(nf.transportadora, t);
    }
    const t = porTransp.get(nf.transportadora);
    somar(t.geral); somar(t[nf.situacao]);
    if (nf.situacao !== 'COM_CTE') somar(t.pendente);
  }
  return {
    total, canceladas,
    porTransportadora: [...porTransp.values()].sort((a, b) => b.pendente.qtd - a.pendente.qtd || b.pendente.estimado - a.pendente.estimado),
  };
}

// ---------------------------------------------------------------- empresa / centro de custo
export const CENTROS_CUSTO_PADRAO = {
  1401: 'C140130045',
  1404: 'C140430045',
  1420: 'C420130045',
  1430: 'C430130045',
  1491: 'C491030045',
};

const CHAVE_CC = 'provisao_ctes_centros_custo';

export function carregarCentrosCusto() {
  try {
    const salvo = JSON.parse(window.localStorage.getItem(CHAVE_CC) || 'null');
    if (salvo && typeof salvo === 'object') return { ...CENTROS_CUSTO_PADRAO, ...salvo };
  } catch { /* localStorage indisponivel */ }
  return { ...CENTROS_CUSTO_PADRAO };
}

export function guardarCentrosCusto(mapa) {
  try { window.localStorage.setItem(CHAVE_CC, JSON.stringify(mapa)); } catch { /* localStorage indisponivel */ }
}

// Provisao (CT-es) + estimativa do tracking, por empresa.
export function resumirPorEmpresa(ctesProvisao = [], nfsPendentes = [], centros = {}) {
  const mapa = new Map();
  const pegar = (emp) => {
    const k = emp || '(sem empresa)';
    if (!mapa.has(k)) mapa.set(k, { empresa: k, cc: centros[emp] || '', qtd: 0, valor: 0, qtd_nf: 0, estimado_nf: 0 });
    return mapa.get(k);
  };
  ctesProvisao.forEach((c) => { const e = pegar(c.empresa); e.qtd += 1; e.valor += Number(c.valor_cte || 0); });
  nfsPendentes.forEach((n) => { const e = pegar(n.empresa); e.qtd_nf += 1; e.estimado_nf += Number(n.frete_estimado || 0); });
  return [...mapa.values()].sort((a, b) => b.valor - a.valor);
}
