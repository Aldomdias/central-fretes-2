import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

// Status de entrega dos CT-es da auditoria, lido do tracking (tracking_rows).
// Regra de pagamento: fatura só é liberada quando TODOS os CT-es estão entregues.
export const STATUS_ENTREGA = {
  ENTREGUE: 'ENTREGUE',
  NAO_ENTREGUE: 'NAO_ENTREGUE', // achado no tracking, sem data de entrega
  SEM_TRACKING: 'SEM_TRACKING', // não achado no tracking
};

export const ROTULO_ENTREGA = {
  ENTREGUE: 'Entregue',
  NAO_ENTREGUE: 'Não entregue',
  SEM_TRACKING: 'Sem tracking',
};

const LOTE = 150;
const soDigitos = (v) => String(v || '').replace(/\D/g, '');

function parseDetalhes(d) {
  if (!d) return {};
  if (typeof d === 'object') return d;
  try { return JSON.parse(d); } catch { return {}; }
}

export function chaveNfeDoRegistro(r = {}) {
  const det = parseDetalhes(r.detalhes_calculo);
  const candidatos = [r.chave_nfe_manual, r.chave_nf_manual, r.chave_nfe, r.chaveNfe, r.chave_nf, det.chave_nfe, det.chaveNfe, det.chave_nf];
  return candidatos.map(soDigitos).find((v) => v.length === 44) || '';
}

export function chaveEntregaRegistro(r = {}) {
  return soDigitos(r.chave_cte) || String(r.numero_cte || '');
}

async function consultar(campo, valores) {
  const supabase = getSupabaseClient();
  const saida = [];
  for (let i = 0; i < valores.length; i += LOTE) {
    const parte = valores.slice(i, i + LOTE);
    const { data, error } = await supabase.from('tracking_rows')
      .select('chave_cte,chave_nfe,data_entrega')
      .in(campo, parte)
      .limit(2000);
    if (error) throw new Error(error.message);
    saida.push(...(data || []));
  }
  return saida;
}

/**
 * Recebe registros da auditoria e devolve Map(chaveEntregaRegistro -> {status, dataEntrega}).
 * Casa primeiro pela chave do CT-e; o que sobrar, pela chave da NF.
 */
export async function buscarStatusEntregaCtes(registros = []) {
  const resultado = new Map();
  if (!isSupabaseConfigured() || !registros.length) return resultado;

  const porCte = new Map();
  const porNfe = new Map();
  for (const r of registros) {
    const id = chaveEntregaRegistro(r);
    if (!id) continue;
    const cte = soDigitos(r.chave_cte);
    if (cte.length === 44) porCte.set(cte, id);
    const nfe = chaveNfeDoRegistro(r);
    if (nfe) porNfe.set(nfe, id);
    resultado.set(id, { status: STATUS_ENTREGA.SEM_TRACKING, dataEntrega: null });
  }

  const aplicar = (id, linha) => {
    const atual = resultado.get(id);
    if (atual?.status === STATUS_ENTREGA.ENTREGUE) return;
    resultado.set(id, linha.data_entrega
      ? { status: STATUS_ENTREGA.ENTREGUE, dataEntrega: linha.data_entrega }
      : { status: STATUS_ENTREGA.NAO_ENTREGUE, dataEntrega: null });
  };

  const linhasCte = await consultar('chave_cte', [...porCte.keys()]);
  for (const l of linhasCte) {
    const id = porCte.get(soDigitos(l.chave_cte));
    if (id) aplicar(id, l);
  }

  const nfesPendentes = [...porNfe.entries()]
    .filter(([, id]) => resultado.get(id)?.status !== STATUS_ENTREGA.ENTREGUE)
    .map(([nfe]) => nfe);
  if (nfesPendentes.length) {
    const linhasNfe = await consultar('chave_nfe', nfesPendentes);
    for (const l of linhasNfe) {
      const id = porNfe.get(soDigitos(l.chave_nfe));
      if (id) aplicar(id, l);
    }
  }
  return resultado;
}

/** Agrupa por fatura: total, entregues, pendentes e se está liberada para pagamento. */
export function resumirEntregaPorFatura(registros = [], statusPorChave = new Map()) {
  const faturas = new Map();
  for (const r of registros) {
    if (!r.tem_fatura) continue;
    const numeros = (r.numeros_fatura || []).length ? r.numeros_fatura : ['(sem número)'];
    const st = statusPorChave.get(chaveEntregaRegistro(r))?.status;
    for (const numero of numeros) {
      const chave = `${r.transportadora || ''}|${numero}`;
      if (!faturas.has(chave)) faturas.set(chave, { fatura: numero, transportadora: r.transportadora || '—', total: 0, entregues: 0, pendentes: [], carregando: 0, valor: 0 });
      const f = faturas.get(chave);
      f.total += 1;
      f.valor += Number(r.valor_cte || 0);
      if (!st) f.carregando += 1;
      else if (st === STATUS_ENTREGA.ENTREGUE) f.entregues += 1;
      else f.pendentes.push(r.numero_cte || r.chave_cte);
    }
  }
  return [...faturas.values()]
    .map((f) => ({ ...f, liberada: f.carregando === 0 && f.pendentes.length === 0 }))
    .sort((a, b) => (a.liberada - b.liberada) || (b.pendentes.length - a.pendentes.length));
}
