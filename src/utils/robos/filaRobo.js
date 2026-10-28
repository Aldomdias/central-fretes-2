// Fila dos robos de lancamento: o que vai para a tabela robos_fila (tudo o que o robo precisa para
// lancar a nota de novo) e o caminho de volta, da fila para o lote salvo da tela do robo.
import { hojeIso } from './lancamentoComum';
import { motivoCurto } from './lancamentoNfse';

export const CHAVE_LOTE_NFSE = 'central_fretes_robo_nfse_lote_v2';
export const CHAVE_LOTE_CTE = 'central_fretes_robo_cte_lote_v1';

function semVazio(obj) {
  return obj && Object.keys(obj).length ? obj : undefined;
}

// l: linha calculada da NFS-e; entrada: a linha digitada/importada da grade (sem o uid).
export function itemFilaNfse(l, entrada) {
  const { uid, ...resto } = entrada || {};
  return {
    tipo: 'NFSE',
    chave: l.id,
    documento: l.nf,
    transportadora: l.transportadora,
    cnpj_transp: l.cnpjTransp,
    valor: l.valor,
    entrada: semVazio(resto),
    pedido: l.pedido || '',
    miro: l.miro || '',
    motivo: l.falhaSap && !l.miro ? motivoCurto(l.falhaSap.motivo) : undefined,
  };
}

// l: linha calculada do CT-e (l.ct = o XML lido); partida: NF de venda do ZSD0004; manual: o que foi
// digitado na tela (ex.: centro de custo).
export function itemFilaCte(l, partida, manual = {}) {
  const { pedido, miro, ...digitado } = manual || {};
  return {
    tipo: 'CTE',
    chave: l.id,
    documento: l.cte,
    transportadora: l.transportadora,
    cnpj_transp: l.cnpjTransp,
    valor: l.bruto,
    entrada: l.ct ? { ct: l.ct, partida: l.danfe && partida ? [l.danfe, partida] : null, manual: digitado } : undefined,
    pedido: l.pedido || '',
    miro: l.miro || '',
  };
}

function lerLocal(chave) {
  try { return JSON.parse(window.localStorage.getItem(chave) || 'null') || {}; } catch { return {}; }
}

function gravarLocal(chave, valor) {
  window.localStorage.setItem(chave, JSON.stringify(valor));
}

// Quantas notas o lote salvo da tela tem hoje (para confirmar antes de substituir).
export function tamanhoLoteSalvo(tipo) {
  const lote = lerLocal(tipo === 'CTE' ? CHAVE_LOTE_CTE : CHAVE_LOTE_NFSE);
  return (tipo === 'CTE' ? lote.cts : lote.entradas)?.length || 0;
}

let contador = 0;
const novoUid = () => { contador += 1; return `f${Date.now().toString(36)}${contador}`; };

// Itens da fila -> lote salvo da tela (substitui o lote). Quem ja tem pedido vai so para a MIRO.
export function mandarParaLote(tipo, itens = []) {
  const comEntrada = itens.filter((i) => i.entrada);
  if (tipo === 'CTE') {
    const cts = comEntrada.map((i) => i.entrada.ct).filter(Boolean);
    const partidas = comEntrada.map((i) => i.entrada.partida).filter(Boolean);
    const manuais = Object.fromEntries(comEntrada.map((i) => [i.chave, { ...(i.entrada.manual || {}), ...(i.pedido ? { pedido: i.pedido } : {}) }]));
    gravarLocal(CHAVE_LOTE_CTE, { cts, partidas, docnums: [], vencimento: hojeIso(), manuais, removidos: [] });
    return cts.length;
  }
  const entradas = [];
  const manuais = {};
  comEntrada.forEach((i) => {
    const uid = novoUid();
    entradas.push({ ...i.entrada, uid, vencimento: '' });
    manuais[uid] = {
      pedido: i.pedido || '',
      miro: '',
      ...(i.motivo ? { falhaSap: { etapa: i.pedido ? 'MIRO' : 'pedido', motivo: i.motivo } } : {}),
    };
  });
  gravarLocal(CHAVE_LOTE_NFSE, { entradas, vencimento: hojeIso(), manuais });
  return entradas.length;
}
