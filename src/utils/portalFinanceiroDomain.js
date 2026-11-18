// Regras puras do Portal Financeiro. Este modulo concentra os criterios que precisam ser
// identicos nos cards, listas, totais, laudo, exportacao e importacoes SAP/HANA.

import { parseNumeroPlanilha } from './parseNumeroPlanilha.js';

const texto = (v) => String(v ?? '').trim();
const digitos = (v) => texto(v).replace(/\D/g, '');
const data = (v) => texto(v).slice(0, 10);
const dinheiro = (v) => Number(Number(v || 0).toFixed(2));

export function variantesReferenciaFatura(valor) {
  const original = digitos(valor);
  if (!original) return [];
  const semZeros = original.replace(/^0+(?=\d)/, '');
  const variantes = new Set([original, semZeros]);
  // O SAP costuma anexar o ano (AAAA) ao numero AMD.
  if (/20\d{2}$/.test(semZeros) && semZeros.length > 4) variantes.add(semZeros.slice(0, -4).replace(/^0+(?=\d)/, ''));
  return [...variantes].filter(Boolean);
}

// A busca exata tem prioridade. Se falhar, o numero completo mais curto pode aparecer como
// sequencia continua no mais longo, nos dois sentidos. O resultado informa por que casou.
export function compararReferenciasFatura(amd, sap) {
  const a = variantesReferenciaFatura(amd);
  const s = variantesReferenciaFatura(sap);
  if (!a.length || !s.length) return { corresponde: false, criterio: 'SEM_REFERENCIA' };
  if (a.some((x) => s.includes(x))) return { corresponde: true, criterio: 'EXATA_OU_FORMATO' };
  // Sequencia continua so vale para o numero mais curto com 4 digitos ou mais: '12' ou '2026' casariam com qualquer fatura.
  const par = a.flatMap((x) => s.map((y) => [x, y])).find(([x, y]) => Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)));
  return par ? { corresponde: true, criterio: 'SEQUENCIA_CONTINUA', amd: par[0], sap: par[1] }
    : { corresponde: false, criterio: 'DIVERGENTE' };
}

const referenciaSap = (p) => p.referencia_fatura ?? p.numero_fatura ?? p.referencia;
const empresa = (o) => texto(o.empresa ?? o.codigo_empresa).toUpperCase();
const moeda = (o) => texto(o.moeda || 'BRL').toUpperCase();
const fornecedor = (o) => texto(o.codigo_fornecedor).toUpperCase();
const cnpj = (o) => digitos(o.cnpj ?? o.cnpj_transportadora);
const vencimento = (o) => data(o.data_vencimento ?? o.vencimento);

export function pagamentoSapEfetivo(p = {}) {
  const partida = texto(p.partida ?? p.documento_compensacao);
  return Boolean(
    (p.pagamento_confirmado === true || p.compensado === true)
    && partida.startsWith('200')
    && !p.estornado
    && p.disponivel_para_vinculo !== false
    && !p.fatura_id
  );
}

function transportadoraConfere(f, p, fornecedores = new Map()) {
  if (cnpj(f) && cnpj(p) && cnpj(f) === cnpj(p)) return true;
  const cod = fornecedor(p);
  if (!cod) return false;
  const esperado = texto(f.codigo_fornecedor).toUpperCase();
  if (esperado && esperado === cod) return true;
  const mapeado = fornecedores instanceof Map ? fornecedores.get(cod) : fornecedores[cod];
  return Boolean(mapeado && (digitos(mapeado) === cnpj(f) || texto(mapeado).toUpperCase() === esperado));
}

export function compararFaturaPagamento(fatura = {}, pagamento = {}, fornecedores = new Map()) {
  const referencia = compararReferenciasFatura(fatura.numero_fatura, referenciaSap(pagamento));
  const campos = {
    referencia: referencia.corresponde,
    transportadora: transportadoraConfere(fatura, pagamento, fornecedores),
    // A fatura AMD nem sempre traz empresa: so diverge quando os dois lados informam e diferem.
    empresa: !empresa(fatura) || !empresa(pagamento) || empresa(fatura) === empresa(pagamento),
    valor: dinheiro(fatura.valor_fatura) === dinheiro(pagamento.valor_pago ?? pagamento.valor),
    moeda: moeda(fatura) === moeda(pagamento),
    vencimento: Boolean(vencimento(fatura)) && vencimento(fatura) === vencimento(pagamento),
    pagamentoEfetivo: pagamentoSapEfetivo(pagamento),
  };
  const divergencias = Object.entries(campos).filter(([, ok]) => !ok).map(([campo]) => campo);
  return { corresponde: divergencias.length === 0, campos, divergencias, criterioReferencia: referencia.criterio };
}

// Vinculo automatico somente quando ha correspondencia unica dos dois lados. Todo o restante
// fica para revisao com os candidatos e os campos que sustentaram (ou impediram) o vinculo.
export function conciliarPagamentosPortal(faturas = [], pagamentos = [], fornecedores = new Map()) {
  const comparacoes = [];
  faturas.forEach((fatura) => pagamentos.forEach((pagamento) => {
    const comparacao = compararFaturaPagamento(fatura, pagamento, fornecedores);
    if (comparacao.campos.referencia || Object.values(comparacao.campos).filter(Boolean).length >= 4) {
      comparacoes.push({ fatura, pagamento, comparacao });
    }
  }));
  const validas = comparacoes.filter((c) => c.comparacao.corresponde);
  const porFatura = new Map(); const porPagamento = new Map();
  validas.forEach((c) => {
    porFatura.set(c.fatura.id, [...(porFatura.get(c.fatura.id) || []), c]);
    const id = c.pagamento.id ?? c.pagamento.partida ?? c.pagamento.documento_compensacao;
    porPagamento.set(id, [...(porPagamento.get(id) || []), c]);
  });
  const vinculados = validas.filter((c) => {
    const id = c.pagamento.id ?? c.pagamento.partida ?? c.pagamento.documento_compensacao;
    return porFatura.get(c.fatura.id)?.length === 1 && porPagamento.get(id)?.length === 1;
  }).map((c) => ({
    fatura_id: c.fatura.id,
    pagamento_id: c.pagamento.id ?? null,
    partida: c.pagamento.partida ?? c.pagamento.documento_compensacao,
    data_pagamento: data(c.pagamento.data_pagamento ?? c.pagamento.data_compensacao),
    campos_vinculo: c.comparacao.campos,
    criterio_referencia: c.comparacao.criterioReferencia,
  }));
  const chavesVinculadas = new Set(vinculados.map((v) => `${v.fatura_id}|${v.partida}`));
  const revisao = comparacoes.filter((c) => {
    const partida = c.pagamento.partida ?? c.pagamento.documento_compensacao;
    return !chavesVinculadas.has(`${c.fatura.id}|${partida}`);
  }).map((c) => ({ fatura_id: c.fatura.id, pagamento_id: c.pagamento.id ?? null, partida: c.pagamento.partida ?? c.pagamento.documento_compensacao, motivo: c.comparacao.divergencias.length ? c.comparacao.divergencias.join(', ') : 'MULTIPLOS_CANDIDATOS', ...c.comparacao }));
  return { vinculados, revisao };
}

const momento = (m) => `${data(m.data_lancamento ?? m.data)}T${texto(m.hora || '00:00:00')}`;
const documento = (m) => texto(m.documento ?? m.lancamento_contabil);

// Prefixo 17 e apenas indício. Estorno confirmado exige vinculo explicito com o documento original
// (ou indicador de anulacao da origem). Um lancamento valido posterior reabre o fluxo.
export function avaliarEstornoSap(movimentos = []) {
  const ordenados = [...movimentos].sort((a, b) => momento(a).localeCompare(momento(b)) || documento(a).localeCompare(documento(b)));
  // Lancamento = documento 19...; compensacao (200...) e outros documentos nunca contam como relancamento.
  const lancamentos = ordenados.filter((m) => m.tipo === 'LANCAMENTO' || (!m.tipo && documento(m).startsWith('19')));
  const estornos = ordenados.filter((m) => m.tipo === 'ESTORNO' || documento(m).startsWith('17'));
  const confirmado = [...estornos].reverse().find((e) => {
    const alvo = texto(e.documento_original ?? e.anula_documento ?? e.documento_estornado);
    return (e.anulacao_confirmada === true || alvo) && lancamentos.some((l) => documento(l) === alvo);
  });
  if (!confirmado) return { status: estornos.length ? 'REVISAR_INDICIO' : 'SEM_ESTORNO', indicios: estornos };
  const alvo = texto(confirmado.documento_original ?? confirmado.anula_documento ?? confirmado.documento_estornado);
  const relancamento = lancamentos.find((l) => documento(l) !== alvo && momento(l) > momento(confirmado) && l.valido !== false && !l.estornado);
  return {
    status: relancamento ? 'RELANÇADA' : 'ESTORNADA_SEM_RELANÇAMENTO',
    lancamento_original: lancamentos.find((l) => documento(l) === alvo) || null,
    documento_estorno: documento(confirmado), data_estorno: data(confirmado.data_lancamento ?? confirmado.data),
    motivo: texto(confirmado.motivo), relancamento: relancamento || null,
  };
}

const norm = (v) => texto(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const primeiro = (linha, nomes) => {
  const chaves = Object.keys(linha || {});
  for (const nome of nomes) {
    const k = chaves.find((c) => norm(c) === norm(nome));
    if (k !== undefined && texto(linha[k]) !== '') return linha[k];
  }
  return '';
};
const dataIso = (v) => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const t = texto(v);
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
};

// Programacao de pagamento confirmada pelo SAP/HANA (relatorio de programacao). Casa cada linha com UMA fatura em
// aberto por referencia + raiz do CNPJ (obrigatorio) + valor (quando informado). Nunca comprova pagamento: so
// atualiza a data vigente. Ambiguo/sem CNPJ/divergente vai para revisao. A data anterior e' preservada no historico
// de previsao (marcarPrevisaoPagamento).
export function conciliarProgramacaoSap(linhas = [], faturas = [], { abertaFn = () => true } = {}) {
  const aplicar = []; const revisao = [];
  const raiz = (c) => digitos(c).slice(0, 8);
  linhas.forEach((linha, i) => {
    const referencia = primeiro(linha, ['Referência', 'Referencia', 'Fatura', 'Numero fatura', 'Nº fatura']);
    const cnpjLinha = raiz(primeiro(linha, ['CNPJ', 'Nº ID fiscal 1', 'No ID fiscal 1', 'ID fiscal']));
    const data = dataIso(primeiro(linha, ['Data programada', 'Data de pagamento', 'Data pagamento programado', 'Dt.pagamento', 'Programação', 'Programacao', 'Data prevista']));
    const valorTxt = primeiro(linha, ['Valor', 'Montante', 'Montante (ME)']);
    const base = { linha: i + 2, referencia: texto(referencia) };
    if (!referencia || !data) { revisao.push({ ...base, motivo: 'SEM_REFERENCIA_OU_DATA' }); return; }
    if (cnpjLinha.length < 8) { revisao.push({ ...base, motivo: 'SEM_CNPJ' }); return; }
    const candidatas = faturas.filter((f) => abertaFn(f) && raiz(f.cnpj_transportadora) === cnpjLinha
      && compararReferenciasFatura(f.numero_fatura, referencia).corresponde
      && (valorTxt === '' || dinheiro(f.valor_fatura) === dinheiro(parseNumeroPlanilha(valorTxt, 0))));
    if (candidatas.length === 1) aplicar.push({ ...base, fatura_id: candidatas[0].id, data, origem: 'SAP_HANA', confirmada: true });
    else revisao.push({ ...base, motivo: candidatas.length ? 'MULTIPLOS_CANDIDATOS' : 'FATURA_NAO_LOCALIZADA_OU_DADOS_DIVERGENTES' });
  });
  return { aplicar, revisao };
}

export const estornadaSemRelancamento = (f) => f?.sap_estorno_status === 'ESTORNADA_SEM_RELANÇAMENTO';

export function previsaoInicialFinanceiro(fatura = {}, referencia = new Date()) {
  if (!fatura.data_vencimento) return '';
  const hoje = new Date(referencia); hoje.setHours(0, 0, 0, 0);
  const venc = new Date(`${data(fatura.data_vencimento)}T00:00:00`);
  return venc >= hoje ? data(fatura.data_vencimento) : '';
}

export function situacaoFinanceiro(f = {}) {
  if (String(f.status || '').startsWith('PAGA') && f.pagamento_confirmado === true) return 'PAGA';
  if (!f.encaminhado_financeiro_em) return 'AGUARDA_ENCAMINHAMENTO';
  if (f.programacao_confirmada === true && f.data_previsao_pagamento) return 'PROGRAMADA';
  return f.data_previsao_pagamento ? 'ENCAMINHADA_COM_PREVISAO' : 'ENCAMINHADA_SEM_PREVISAO';
}

// Resultado da leitura incremental da pasta. O hash e calculado pelo adaptador de arquivos; aqui a
// deduplicacao e o vinculo ficam deterministas e independentes do navegador/servidor.
export function vincularBoletosLidos(arquivos = [], faturas = [], versoesAnteriores = []) {
  const hashes = new Set(versoesAnteriores.map((v) => v.hash_conteudo).filter(Boolean));
  const resultados = [];
  for (const arquivo of arquivos) {
    if (hashes.has(arquivo.hash_conteudo)) {
      resultados.push({ arquivo, status: 'REPETIDO', fatura_id: versoesAnteriores.find((v) => v.hash_conteudo === arquivo.hash_conteudo)?.fatura_id || null });
      continue;
    }
    hashes.add(arquivo.hash_conteudo);
    if (arquivo.legivel === false) { resultados.push({ arquivo, status: 'DIVERGENTE', motivo: 'ILEGIVEL' }); continue; }
    const candidatos = faturas.map((fatura) => {
      const ref = compararReferenciasFatura(fatura.numero_fatura, arquivo.referencia_fatura);
      const cnpjOk = Boolean(cnpj(fatura) && cnpj(arquivo) && cnpj(fatura) === cnpj(arquivo));
      const valorOk = dinheiro(fatura.valor_fatura) === dinheiro(arquivo.valor);
      const vencOk = vencimento(fatura) === data(arquivo.vencimento);
      // Referencia inequivoca + beneficiario/CNPJ e dados financeiros compativeis. Valor e
      // vencimento, sozinhos, deliberadamente nao formam candidato automatico.
      return { fatura, ref, cnpjOk, valorOk, vencOk, valido: ref.corresponde && cnpjOk && valorOk && vencOk };
    }).filter((c) => c.ref.corresponde || c.cnpjOk || (c.valorOk && c.vencOk));
    const validos = candidatos.filter((c) => c.valido);
    if (validos.length === 1) resultados.push({ arquivo, status: 'LOCALIZADO_NA_PASTA', fatura_id: validos[0].fatura.id, campos: { referencia: true, cnpj: true, valor: true, vencimento: true } });
    else if (validos.length > 1) resultados.push({ arquivo, status: 'VINCULO_A_CONFIRMAR', candidatos: validos.map((c) => c.fatura.id), motivo: 'AMBIGUO' });
    else resultados.push({ arquivo, status: candidatos.length ? 'DIVERGENTE' : 'AGUARDANDO_BOLETO', candidatos: candidatos.map((c) => c.fatura.id), motivo: candidatos.length ? 'CAMPOS_DIVERGENTES' : 'SEM_REFERENCIA' });
  }
  return resultados;
}


