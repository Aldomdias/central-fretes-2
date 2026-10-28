// Relatorio de partidas do fornecedor exportado do SAP HANA (Fiori, "Exportacao SAPUI5"): traz, por
// Referencia (NF/CT-e) + CNPJ, o lancamento contabil da fatura e se ja foi pago (compensado).
// Cada nota pode ter varias linhas (fatura, estorno MIR4, compensacao de devolucao): vale a linha da
// fatura (valor negativo, sem ser compensacao) mais recente.
import { apenasDigitos, dataParaIso, mapearColunas } from './lancamentoComum';

const ALIASES = {
  referencia: ['Referência', 'Referencia', 'Reference'],
  cnpj: ['Nº ID fiscal 1', 'N ID fiscal 1', 'ID fiscal 1', 'Tax Number 1'],
  contabil: ['Lançamento contábil', 'Lancamento contabil', 'Journal Entry', 'Nº documento'],
  compensacao: ['Lançto.compensação', 'Lancto compensacao', 'Lançamento de compensação', 'Clearing Journal Entry'],
  dataCompensacao: ['Data de compensação', 'Data de compensacao', 'Clearing Date'],
  vencimento: ['Data vencimento líq.', 'Data vencimento liq', 'Net Due Date'],
  montante: ['Montante (ME)', 'Montante', 'Amount in Transaction Currency'],
  status: ['Status comp.', 'Status comp', 'Clearing Status'],
  dataLancamento: ['Dt.lançamento', 'Dt lancamento', 'Posting Date'],
  texto: ['Texto de item', 'Item Text'],
  empresa: ['Empresa', 'Company Code'],
  fornecedor: ['Nome do fornecedor', 'Supplier Name'],
};

const chave = (ref, cnpj) => `${String(ref || '').trim().toUpperCase()}|${apenasDigitos(cnpj)}`;
const numero = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/\./g, '').replace(',', '.')) || 0);

export function ehRelatorioContabil(cabecalho = []) {
  const m = mapearColunas(cabecalho, ALIASES);
  return m.referencia !== undefined && m.contabil !== undefined && m.cnpj !== undefined;
}

// matriz: linhas da planilha (a 1a e o cabecalho). Devolve Map "REF|CNPJ" -> dados da fatura.
export function lerRelatorioContabil(matriz = []) {
  const [cab = [], ...linhas] = matriz;
  const m = mapearColunas(cab, ALIASES);
  if (m.referencia === undefined || m.contabil === undefined || m.cnpj === undefined) {
    throw new Error('Nao achei as colunas Referencia, Lancamento contabil e N ID fiscal 1 no relatorio.');
  }
  const pega = (l, c) => (m[c] === undefined ? '' : l[m[c]]);
  const porNota = new Map();
  linhas.forEach((l) => {
    const ref = String(pega(l, 'referencia') || '').trim();
    const doc = String(pega(l, 'contabil') || '').trim();
    if (!ref || !doc) return;
    const texto = String(pega(l, 'texto') || '');
    const montante = numero(pega(l, 'montante'));
    // fatura = valor negativo (credito do fornecedor); fica de fora a compensacao de devolucao ("Comp.Devol...")
    // e o estorno (MIR4, valor positivo). O texto da fatura pode ter sido trocado (Pix, dados do banco).
    if (!(montante < 0) || /^comp/i.test(texto.trim())) return;
    const item = {
      referencia: ref.toUpperCase(),
      cnpj: apenasDigitos(pega(l, 'cnpj')),
      fornecedor: String(pega(l, 'fornecedor') || '').trim(),
      empresa: String(pega(l, 'empresa') || '').trim(),
      lancamento_contabil: doc,
      compensacao: String(pega(l, 'compensacao') || '').trim(),
      data_compensacao: dataParaIso(pega(l, 'dataCompensacao')) || null,
      vencimento_liquido: dataParaIso(pega(l, 'vencimento')) || null,
      data_lancamento: dataParaIso(pega(l, 'dataLancamento')) || '',
      montante: Math.abs(montante),
    };
    item.situacao_pagamento = item.compensacao || String(pega(l, 'status')).trim() === '1' ? 'pago' : 'aberto';
    const k = chave(item.referencia, item.cnpj);
    const atual = porNota.get(k);
    if (!atual || item.data_lancamento > atual.data_lancamento || (item.data_lancamento === atual.data_lancamento && item.lancamento_contabil > atual.lancamento_contabil)) {
      porNota.set(k, item);
    }
  });
  return porNota;
}

const CAMPOS = ['lancamento_contabil', 'compensacao', 'data_compensacao', 'vencimento_liquido', 'situacao_pagamento'];

// registros: historico (robos_lancamentos). Casa por documento + CNPJ; sem CNPJ no historico, so pelo
// documento quando ele e unico no relatorio. Devolve o que mudar e o que ficou sem casar.
export function casarContabil(registros = [], porNota = new Map()) {
  const porRef = new Map();
  porNota.forEach((item) => {
    const lista = porRef.get(item.referencia) || [];
    lista.push(item);
    porRef.set(item.referencia, lista);
  });
  const usados = new Set();
  const atualizar = [];
  let iguais = 0;
  registros.forEach((r) => {
    if (!r.miro) return; // so pedido: ainda nao tem fatura
    const ref = String(r.documento || '').trim().toUpperCase();
    let item = porNota.get(chave(ref, r.cnpj_transp));
    if (!item && !apenasDigitos(r.cnpj_transp)) item = (porRef.get(ref) || []).length === 1 ? porRef.get(ref)[0] : null;
    if (!item) return;
    usados.add(chave(item.referencia, item.cnpj));
    const novo = Object.fromEntries(CAMPOS.map((c) => [c, item[c] || null]));
    if (CAMPOS.every((c) => (r[c] || null) === novo[c])) { iguais += 1; return; }
    atualizar.push({ ...r, ...novo });
  });
  const semHistorico = [...porNota.entries()].filter(([k]) => !usados.has(k)).map(([, v]) => v);
  return { atualizar, iguais, semHistorico };
}
