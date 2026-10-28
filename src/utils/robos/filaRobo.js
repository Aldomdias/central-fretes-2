// Fila dos robos de lancamento: o que vai para a tabela robos_fila (tudo o que o robo precisa para
// lancar a nota de novo) e o caminho de volta, da fila para o lote salvo da tela do robo.
import { hojeIso } from './lancamentoComum';
import { motivoCurto } from './lancamentoNfse';
import { linhaParaRegistro } from './historicoLancamentos';

export const CHAVE_LOTE_NFSE = 'central_fretes_robo_nfse_lote_v2';
export const CHAVE_LOTE_CTE = 'central_fretes_robo_cte_lote_v1';

function semVazio(obj) {
  return obj && Object.keys(obj).length ? obj : undefined;
}

// Registro do historico (robos_lancamentos) desta linha, sem pedido/MIRO: quando a MIRO chega pela
// planilha do robo (direto na fila), a Central monta o historico com ele.
function registroBase(tipo, l) {
  const r = linhaParaRegistro(tipo, { ...l, pedido: l.pedido || '-' });
  if (!r) return undefined;
  const { pedido, miro, tipo: t, ...resto } = r;
  return resto;
}

// l: linha calculada da NFS-e; entrada: a linha digitada/importada da grade (sem o uid).
export function itemFilaNfse(l, entrada) {
  const { uid, registro, ...resto } = entrada || {};
  return {
    tipo: 'NFSE',
    chave: l.id,
    documento: l.nf,
    transportadora: l.transportadora,
    cnpj_transp: l.cnpjTransp,
    valor: l.valor,
    entrada: semVazio(resto) ? { ...resto, registro: registroBase('NFSE', l) } : undefined,
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
    entrada: l.ct ? { ct: l.ct, partida: l.danfe && partida ? [l.danfe, partida] : null, manual: digitado, registro: registroBase('CTE', l) } : undefined,
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
    const { registro, ...entrada } = i.entrada;
    entradas.push({ ...entrada, uid, vencimento: '' });
    manuais[uid] = {
      pedido: i.pedido || '',
      miro: '',
      ...(i.motivo ? { falhaSap: { etapa: i.pedido ? 'MIRO' : 'pedido', motivo: i.motivo } } : {}),
    };
  });
  gravarLocal(CHAVE_LOTE_NFSE, { entradas, vencimento: hojeIso(), manuais });
  return entradas.length;
}

// Numeros que ja estao na fila (ex.: a planilha do robo mandou direto) e faltam na tela.
// mapa: chave -> item da fila. Devolve so as linhas que ganharam algo, ja com pedido/MIRO/falha.
export function numerosDaFila(linhas = [], mapa = new Map()) {
  const mudou = [];
  linhas.forEach((l) => {
    const f = mapa.get(l.id);
    if (!f) return;
    const pedido = l.pedido || f.pedido || '';
    const miro = l.miro || f.miro || '';
    const motivo = !miro && f.motivo && !l.falhaSap ? f.motivo : null;
    if (pedido === (l.pedido || '') && miro === (l.miro || '') && !motivo) return;
    mudou.push({ ...l, pedido, miro, ...(motivo ? { falhaSap: { etapa: pedido ? 'MIRO' : 'pedido', motivo } } : {}) });
  });
  return mudou;
}

// Itens mandados para o robo que ainda nao voltaram com nada (sem pedido, MIRO ou motivo), por pessoa e dia.
export function aguardandoResultado(itens = []) {
  const grupos = new Map();
  itens.filter((i) => !i.pedido && !i.miro && !i.motivo && !i.descartado).forEach((i) => {
    const quando = String(i.atualizado_em || '');
    const k = `${i.tipo}|${i.atualizado_por || ''}|${quando.slice(0, 10)}`;
    const g = grupos.get(k) || { tipo: i.tipo, por: i.atualizado_por || '', quando, total: 0 };
    g.total += 1;
    if (quando > g.quando) g.quando = quando;
    grupos.set(k, g);
  });
  return [...grupos.values()].sort((a, b) => b.quando.localeCompare(a.quando));
}
