// Tracking do mes x base de CT-es (provisao por competencia).
// Cada NF do tracking (data da NF dentro da competencia) e' classificada:
//  - COM_CTE: o CT-e da NF esta na base (pela chave do CT-e ou pela chave da NF)
//  - CTE_FORA_BASE: tracking traz a chave do CT-e, mas o CT-e nao esta na base
//  - NFSE: frete cobrado por nota fiscal de servico (tracking marca "Nota fiscal de servico")
//  - RETIRA: "Tipo NF" = Retira (cliente retira a mercadoria, nao tem frete) (informativo)
//  - SEM_TRANSPORTADORA: sem documento e "Transportadora nao cadastrada no SAP" (informativo)
//  - CTE_MES_SEGUINTE: CT-e (pela chave) emitido depois da competencia: e' do mes seguinte (informativo)
//  - SEM_CTE: tracking nao traz nenhum documento de frete
// CTE_FORA_BASE + SEM_CTE sao candidatos a provisao. Frete estimado = % frete real da transportadora
// (CT-es da base contados uma vez / valor NF); sem historico, frete do tracking (se plausivel) ou % geral.

const digitos = (v) => String(v ?? '').replace(/\D/g, '');

export const SITUACOES_TRACKING = {
  COM_CTE: 'Com CT-e na base',
  CTE_FORA_BASE: 'CT-e fora da base',
  SEM_CTE: 'Sem CT-e vinculado',
  NFSE: 'Frete por NFS-e',
  RETIRA: 'Cliente retira',
  SEM_TRANSPORTADORA: 'Transportadora não cadastrada',
  CTE_MES_SEGUINTE: 'CT-e emitido após o mês',
};

export const CORES_TRACKING = { COM_CTE: '#15803d', CTE_FORA_BASE: '#c2410c', SEM_CTE: '#b91c1c', NFSE: '#0369a1', RETIRA: '#7c2d12', SEM_TRANSPORTADORA: '#64748b', CTE_MES_SEGUINTE: '#0f766e' };

// Entram no "a provisionar".
export const SITUACOES_PENDENTES = new Set(['CTE_FORA_BASE', 'SEM_CTE']);

// Cancelada/devolvida: "Status Pedido" CAN/DEV ou "Situacao" = Cancelada.
export function cancelada(linha) {
  return ['CAN', 'DEV'].includes(String(linha.status_pedido || '').trim().toUpperCase().slice(0, 3))
    || /cancel/i.test(String(linha.situacao_tracking || ''));
}

const numeroBr = (v) => {
  if (typeof v === 'number') return v;
  const t = String(v ?? '').trim();
  if (!t || !/\d/.test(t)) return 0;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : 0;
};

const ehNfse = (v) => /servi/i.test(String(v || ''));
// Tracking sem transportadora definida no SAP (ex.: retira/frota): nao e' frete a provisionar.
const SEM_TRANSP = /n[aã]o cadastrada|sem transportadora/i;

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
        valor_nf: 0, frete_tracking: 0, chaves_cte: new Set(), cte_numero: '', nfse: false, retira: false,
      });
    }
    const nf = porNf.get(id);
    nf.valor_nf += Number(l.valor_nf || 0);
    nf.frete_tracking += numeroBr(l.frete_calculado);
    const cte = digitos(l.chave_cte);
    if (cte.length === 44) nf.chaves_cte.add(cte);
    if (ehNfse(l.cte_numero) || ehNfse(l.cte_numero_serie)) nf.nfse = true;
    if (/retira/i.test(String(l.tipo_nf || ''))) nf.retira = true; // "Tipo NF" = Retira: cliente retira, sem frete
    const num = [l.cte_numero, l.cte_numero_serie].find((v) => v && !ehNfse(v) && /\d/.test(String(v)));
    if (!nf.cte_numero && num) nf.cte_numero = String(num).trim();
  }
  return { nfs: [...porNf.values()], canceladas };
}

// ---------------------------------------------------------------- empresa SAP
// Cada raiz de CNPJ do grupo tem uma empresa SAP so (CPX 1420, ITR 1430...): a raiz
// resolve quando o CNPJ exato nao esta nas Filiais.
export function criarResolvedorEmpresa(filiaisPorCnpj = new Map()) {
  const porRaiz = new Map();
  filiaisPorCnpj.forEach((f, cnpj) => {
    const raiz = String(cnpj).slice(0, 8);
    if (!f?.emp) return;
    if (!porRaiz.has(raiz)) porRaiz.set(raiz, new Set());
    porRaiz.get(raiz).add(f.emp);
  });
  const raizUnica = (raiz) => { const s = porRaiz.get(raiz); return s && s.size === 1 ? [...s][0] : ''; };
  const porCnpj = (cnpj) => {
    const d = digitos(cnpj);
    if (d.length < 8) return '';
    const c = d.padStart(14, '0');
    return filiaisPorCnpj.get(c)?.emp || raizUnica(c.slice(0, 8));
  };
  // Nome do tomador (base sem CNPJ do tomador): grupo pelo nome -> raiz -> empresa.
  const NOMES = [[/\bCPX\b/, '10158356'], [/\bITR\b/, '15426874'], [/\bGP\s+PNEUS\b/, '46378127'], [/\bGRIP/, '08265644'], [/\bAFB\b/, '43362585'], [/\bCP\s+COMERCIAL\b/, '08888040']];
  const porNome = (nome) => {
    const t = String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    const achou = NOMES.find(([re]) => re.test(t));
    return achou ? raizUnica(achou[1]) : '';
  };
  const porChaveNfe = (chave) => { const d = digitos(chave); return d.length === 44 ? porCnpj(d.slice(6, 20)) : ''; };
  return { porCnpj, porNome, porChaveNfe };
}

// Empresa SAP pelo CNPJ emitente da NF (pos. 7-20 da chave) nas Filiais dos robos.
export function empresaDaChaveNfe(chaveNfe, filiaisPorCnpj = new Map()) {
  return criarResolvedorEmpresa(filiaisPorCnpj).porChaveNfe(chaveNfe);
}

/**
 * nfs: saida de agruparNfsTracking. valorCtePorChave: Map(chave_cte -> valor) dos CT-es na base.
 * Devolve as NFs classificadas, com frete estimado nas que nao tem CT-e na base.
 */
export function classificarNfsTracking(nfs = [], valorCtePorChave = new Map(), filiaisPorCnpj = new Map(), competencia = '') {
  // AAMM da competencia, para reconhecer CT-e emitido depois do mes pela chave (pos. 3-6).
  const aamm = competencia ? `${competencia.slice(2, 4)}${competencia.slice(5, 7)}` : '';
  const resolver = criarResolvedorEmpresa(filiaisPorCnpj);
  // % frete/valor NF por transportadora: cada CT-e entra uma vez (um CT-e pode ter varias NFs).
  const razao = new Map();
  const contados = new Set();
  let geralNf = 0;
  let geralFrete = 0;
  const base = nfs.map((nf) => {
    const chaves = [...nf.chaves_cte];
    const naBase = chaves.filter((c) => valorCtePorChave.has(c));
    let situacao;
    if (naBase.length) situacao = 'COM_CTE';
    else if (nf.retira) situacao = 'RETIRA';
    else if (chaves.length && aamm && chaves.every((c) => c.slice(2, 6) > aamm)) situacao = 'CTE_MES_SEGUINTE';
    else if (chaves.length) situacao = 'CTE_FORA_BASE';
    else if (nf.nfse) situacao = 'NFSE';
    else if (SEM_TRANSP.test(nf.transportadora)) situacao = 'SEM_TRANSPORTADORA';
    else situacao = 'SEM_CTE';
    let freteBase = 0;
    naBase.forEach((c) => { if (!contados.has(c)) { contados.add(c); freteBase += Number(valorCtePorChave.get(c) || 0); } });
    if (situacao === 'COM_CTE' && nf.valor_nf > 0) {
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
    const pct = r && r.nf > 0 && r.frete > 0 ? r.frete / r.nf : pctGeral;
    // Estimativa: % frete real da transportadora (CT-es da base / valor das NFs). O "Vlr. Calculado
    // Frete" do tracking so' entra sem historico da transportadora e se for plausivel (ate 30% da NF).
    let estimado = 0;
    let origemEstimativa = '';
    if (SITUACOES_PENDENTES.has(nf.situacao)) {
      if (r && r.nf > 0 && r.frete > 0) { estimado = nf.valor_nf * pct; origemEstimativa = '% frete real da transportadora'; }
      else if (nf.frete_tracking > 0 && nf.frete_tracking <= nf.valor_nf * 0.3) { estimado = nf.frete_tracking; origemEstimativa = 'Frete calculado no tracking'; }
      else { estimado = nf.valor_nf * pctGeral; origemEstimativa = '% frete geral do mês'; }
    }
    return {
      ...nf, pct_frete: pct, frete_estimado: Math.round(estimado * 100) / 100, origem_estimativa: origemEstimativa,
      empresa: resolver.porChaveNfe(nf.chave_nfe),
    };
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
    if (SITUACOES_PENDENTES.has(nf.situacao)) somar(total.pendente);
    if (!porTransp.has(nf.transportadora)) {
      const t = { nome: nf.transportadora, geral: vazio(), pendente: vazio(), pct_frete: nf.pct_frete };
      Object.keys(SITUACOES_TRACKING).forEach((k) => { t[k] = vazio(); });
      porTransp.set(nf.transportadora, t);
    }
    const t = porTransp.get(nf.transportadora);
    somar(t.geral); somar(t[nf.situacao]);
    if (SITUACOES_PENDENTES.has(nf.situacao)) somar(t.pendente);
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
