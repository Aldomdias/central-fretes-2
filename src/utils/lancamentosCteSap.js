import { excelDateToISO } from './auditoriaFretesImport.js';

// Lancamento de CT-e no relatorio SAP (Exportacao SAPUI5): documento de fatura
// de fornecedor (Lancamento contabil 51..., MIRO) com Referencia "numero-serie"
// (ex.: "000033944-1"). Casamento com a base de CT-es: CNPJ completo do
// emitente + numero + serie (nunca so numero: o mesmo numero existe em NFs
// e CT-es de outros fornecedores).
const REF_NUMERO_SERIE = /^0*(\d+)-0*(\d+)$/;

const digitos = (v) => String(v ?? '').replace(/\D/g, '');
const semZeros = (v) => String(Number(digitos(v) || 0));

export function cnpj14(v) {
  const d = digitos(v);
  return d ? d.padStart(14, '0') : '';
}

// Serie do CT-e a partir da chave de acesso (posicoes 23-25).
export function serieDaChave(chave) {
  const d = digitos(chave);
  return d.length === 44 ? String(Number(d.slice(22, 25))) : '';
}

export function chaveCasamentoCte({ cnpj, numero, serie }) {
  return `${cnpj14(cnpj)}|${semZeros(numero)}|${semZeros(serie)}`;
}

export function chaveCasamentoDoCte(cte = {}) {
  return chaveCasamentoCte({ cnpj: cte.cnpj_transportadora, numero: cte.numero_cte, serie: serieDaChave(cte.chave_cte) });
}

// Linhas do relatorio SAP que podem ser lancamento de CT-e.
export function extrairLancamentosCteSap(rows = [], arquivoOrigem = '') {
  const porChave = new Map();
  for (const row of rows) {
    const lancamento = String(row['Lançamento contábil'] ?? row['Lancamento contabil'] ?? '').trim();
    if (!lancamento.startsWith('51')) continue;
    const referencia = String(row['Referência'] ?? row['Referencia'] ?? '').trim();
    const m = referencia.match(REF_NUMERO_SERIE);
    if (!m) continue;
    const cnpj = cnpj14(row['Nº ID fiscal 1'] ?? row['No ID fiscal 1'] ?? row.CNPJ);
    if (cnpj.length !== 14 || /^0+$/.test(cnpj)) continue;
    const montante = Number(Number(row['Montante (ME)'] ?? row.Montante ?? 0).toFixed(2));
    const numero = String(Number(m[1]));
    const serie = String(Number(m[2]));
    const chave = `${cnpj}|${numero}|${serie}|${lancamento}|${Math.round(montante * 100)}`;
    porChave.set(chave, {
      chave,
      cnpj_emitente: cnpj,
      numero_cte: numero,
      serie_cte: serie,
      referencia,
      fornecedor: String(row['Nome do fornecedor'] ?? '').trim() || null,
      codigo_fornecedor: String(row.Fornecedor ?? '').trim() || null,
      empresa: String(row.Empresa ?? '').trim() || null,
      lancamento_contabil: lancamento,
      documento_compensacao: String(row['Lançto.compensação'] ?? row['Lancto.compensacao'] ?? '').trim() || null,
      // "Dt.lançamento" = data de lancamento (posting date); "Dt.lçto.cont." = data do documento.
      data_lancamento: excelDateToISO(row['Dt.lançamento']) || null,
      data_documento: excelDateToISO(row['Dt.lçto.cont.']) || null,
      data_compensacao: excelDateToISO(row['Data de compensação']) || null,
      data_vencimento: excelDateToISO(row['Data vencimento líq.']) || null,
      montante,
      status_comp: String(row['Status comp.'] ?? '').trim() || null,
      criado_por: String(row['Lançamento contábil criado por'] ?? '').trim() || null,
      texto: String(row['Texto de item'] ?? '').trim() || null,
      arquivo_origem: arquivoOrigem || null,
    });
  }
  return [...porChave.values()];
}

// ---------------------------------------------------------------- partidas gravadas pelos robos
// Quando a Central lanca o CT-e (robo de Lancamento CT-e, Escrituracao/Reprocessar ou Correcao de
// saldo), a partida entra na mesma tabela sem esperar o relatorio do SAP. Marcada por
// arquivo_origem "ROBO:<origem>"; quando o relatorio do SAP traz a partida real, a do robo e apagada
// (e, enquanto as duas existirem, a do robo nao conta: situacaoLancamentoCte).
export const PREFIXO_ORIGEM_ROBO = 'ROBO:';

export function ehPartidaDoRobo(linha = {}) {
  return String(linha.arquivo_origem || '').startsWith(PREFIXO_ORIGEM_ROBO);
}

function hojeIsoLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// { cnpj, numero, serie, documento (MIRO), valor (CT-e, positivo), ... } -> linha de ctes_lancamentos_sap.
export function partidaDoRobo({ cnpj, numero, serie, documento, valor, origem = 'LANCAMENTO', fornecedor = '', empresa = '', data = '', por = '' }) {
  const c = cnpj14(cnpj);
  const n = semZeros(numero);
  const s = semZeros(serie);
  const doc = digitos(documento);
  const v = Math.abs(Number(valor) || 0);
  if (c.length !== 14 || /^0+$/.test(c) || n === '0' || !doc || !(v > 0)) return null;
  const montante = -Number(v.toFixed(2));
  return {
    chave: `${c}|${n}|${s}|${doc}|${Math.round(montante * 100)}`,
    cnpj_emitente: c,
    numero_cte: n,
    serie_cte: s,
    referencia: `${n}-${s}`,
    fornecedor: fornecedor || null,
    empresa: empresa || null,
    lancamento_contabil: doc,
    data_lancamento: /^\d{4}-\d{2}-\d{2}$/.test(String(data)) ? data : hojeIsoLocal(),
    montante,
    criado_por: por ? `ROBO CENTRAL (${por})` : 'ROBO CENTRAL',
    texto: `Lancado pela Central (${origem.toLowerCase()})`,
    arquivo_origem: `${PREFIXO_ORIGEM_ROBO}${origem}`,
  };
}

// Registro do historico dos robos (robos_lancamentos, tipo CTE, documento "numero-serie") -> partida.
export function partidaDoRegistroRobo(r = {}) {
  if (r.tipo !== 'CTE' || !r.miro) return null;
  const m = String(r.documento || '').match(/^0*(\d+)-0*(\d+)$/);
  if (!m) return null;
  return partidaDoRobo({ cnpj: r.cnpj_transp, numero: m[1], serie: m[2], documento: r.miro, valor: r.valor, origem: 'LANCAMENTO', fornecedor: r.transportadora || '', empresa: r.empresa || '', por: r.lancado_por || '' });
}

// Situacao de lancamento de um CT-e a partir das suas linhas no SAP: montante
// negativo lanca, positivo estorna (MIR4). Vale a data em que o saldo ficou
// lancado pela ultima vez (estornou e relancou = data do relancamento).
export function situacaoLancamentoCte(linhas = []) {
  // Partida gravada pelo robo (lancamento/escrituracao/correcao de saldo feitos pela Central) so vale
  // ate o relatorio do SAP trazer a partida de verdade desse CT-e; depois disso ela e ignorada.
  const doSap = linhas.filter((l) => !ehPartidaDoRobo(l));
  const base = doSap.length ? doSap : linhas;
  const ordenadas = [...base].sort((a, b) => String(a.data_lancamento || '').localeCompare(String(b.data_lancamento || ''))
    || String(a.lancamento_contabil || '').localeCompare(String(b.lancamento_contabil || '')));
  let saldo = 0;
  let data = null;
  let documento = null;
  for (const l of ordenadas) {
    const antes = saldo;
    saldo = Number((saldo + Number(l.montante || 0)).toFixed(2));
    if (saldo < -0.004 && antes >= -0.004) { data = l.data_lancamento; documento = l.lancamento_contabil; }
  }
  const lancado = saldo < -0.004;
  return { lancado, estornado: !lancado && ordenadas.length > 0, data_lancamento: lancado ? data : null, lancamento_contabil: lancado ? documento : null, valor_lancado: lancado ? Math.abs(saldo) : 0 };
}

export const SITUACOES_PROVISAO = {
  NO_MES: 'Lançado no mês',
  APOS_MES: 'Lançado após o mês',
  NAO_LANCADO: 'Não lançado',
};

// Classifica cada CT-e da competencia (AAAA-MM). Lancado = tem partida propria no SAP
// (CNPJ emitente + numero + serie). Entra na provisao: lancado depois da virada + nao lancado.
export function classificarProvisao(ctes = [], lancamentosPorChave = new Map(), competencia = '') {
  const fimMes = `${competencia}-31`;
  return ctes.map((cte) => {
    const linhasSap = lancamentosPorChave.get(chaveCasamentoDoCte(cte)) || [];
    const sit = situacaoLancamentoCte(linhasSap);
    const situacao = sit.lancado ? (String(sit.data_lancamento || '') <= fimMes ? 'NO_MES' : 'APOS_MES') : 'NAO_LANCADO';
    return {
      ...cte,
      situacao,
      provisao: situacao !== 'NO_MES',
      estornado: sit.estornado,
      data_lancamento: sit.data_lancamento || null,
      lancamento_contabil: sit.lancamento_contabil || null,
      valor_lancado: sit.valor_lancado,
      numero_fatura: null,
      empresa_sap: linhasSap.find((l) => l.empresa)?.empresa || null,
    };
  });
}

export function resumirProvisao(itens = []) {
  const vazio = () => ({ qtd: 0, valor: 0 });
  const total = { geral: vazio(), provisao: vazio() };
  Object.keys(SITUACOES_PROVISAO).forEach((k) => { total[k] = vazio(); });
  const porTransp = new Map();
  for (const it of itens) {
    const v = Number(it.valor_cte || 0);
    const somar = (alvo) => { alvo.qtd += 1; alvo.valor += v; };
    somar(total.geral); if (total[it.situacao]) somar(total[it.situacao]);
    if (it.provisao) somar(total.provisao);
    const nome = it.transportadora || '(sem nome)';
    if (!porTransp.has(nome)) {
      const t = { nome, geral: vazio(), provisao: vazio() };
      Object.keys(SITUACOES_PROVISAO).forEach((k) => { t[k] = vazio(); });
      porTransp.set(nome, t);
    }
    const t = porTransp.get(nome);
    somar(t.geral); if (t[it.situacao]) somar(t[it.situacao]);
    if (it.provisao) somar(t.provisao);
  }
  return { total, porTransportadora: [...porTransp.values()].sort((a, b) => b.provisao.valor - a.provisao.valor) };
}
