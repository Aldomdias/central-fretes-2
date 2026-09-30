// Robo "Lancamento NFS-e" — substitui a planilha "Lancamento NFS-e 4.0.xlsm".
//
// A planilha tinha: a aba "Preencher Dados" (digitada), a consulta Power Query que monta a aba
// "Lancamento" (empresa e centro pelo CNPJ do tomador, centro de custo pelo escritorio de
// vendas) e as macros CriarPedido (ME21N) e CriarMiro (MIRO). Aqui: a leitura da entrada, o
// calculo da aba "Lancamento" e a exportacao do resumo "Enviar". As macros viram o script .vbs
// (sapLancamentoVbs.js).

import {
  apenasDigitos,
  dataParaIso,
  gerarIds,
  hojeIso,
  isoParaBr,
  isoParaDdmmaaaa,
  mapearColunas,
  normalizarCnpj,
  numeroPlanilha,
  valorParaSap,
} from './lancamentoComum';

export const ALIASES_ENTRADA_NFSE = {
  nf: ['NF', 'NF Servico', 'NF Serviço', 'Nota'],
  transportadora: ['Transportadora'],
  cnpjTransp: ['CNPJ Transp', 'CNPJ Transportadora', 'CNPJ Prestador'],
  dataEmissao: ['Data Emissão', 'Data Emissao', 'Emissão', 'Emissao'],
  valor: ['Valor', 'Valor Bruto'],
  codImp: ['Cod', 'Cod Imp', 'Código Imposto', 'Codigo Imposto'],
  cfop: ['CFOP'],
  cnpjTomador: ['CNPJ Tomador', 'Tomador'],
  escrV: ['EscrV', 'Escr', 'Escritório de vendas', 'Escritorio de vendas'],
  fatura: ['Fatura'],
};

// matriz: 1a linha = cabecalho (mesmas colunas da aba "Preencher Dados").
export function lerEntradaNfse(matriz = []) {
  if (matriz.length < 2) throw new Error('Cole ou carregue uma tabela com o cabecalho e ao menos uma nota.');
  const mapa = mapearColunas(matriz[0], ALIASES_ENTRADA_NFSE);
  const faltando = ['nf', 'cnpjTransp', 'dataEmissao', 'valor', 'codImp', 'cfop', 'cnpjTomador', 'escrV'].filter((c) => mapa[c] === undefined);
  if (faltando.length) {
    const nomes = { nf: 'NF', cnpjTransp: 'CNPJ Transp', dataEmissao: 'Data Emissão', valor: 'Valor', codImp: 'Cod', cfop: 'CFOP', cnpjTomador: 'CNPJ Tomador', escrV: 'EscrV' };
    throw new Error(`Faltam colunas no cabecalho: ${faltando.map((c) => nomes[c]).join(', ')}.`);
  }
  return matriz.slice(1)
    .filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
    .map((r) => ({
      nf: String(r[mapa.nf] ?? '').trim(),
      transportadora: mapa.transportadora !== undefined ? String(r[mapa.transportadora] ?? '').trim() : '',
      cnpjTransp: normalizarCnpj(r[mapa.cnpjTransp]),
      dataEmissao: dataParaIso(r[mapa.dataEmissao]),
      valor: numeroPlanilha(r[mapa.valor]),
      codImp: String(r[mapa.codImp] ?? '').trim().toUpperCase(),
      cfop: String(r[mapa.cfop] ?? '').trim().toUpperCase(),
      cnpjTomador: normalizarCnpj(r[mapa.cnpjTomador]),
      escrV: String(r[mapa.escrV] ?? '').trim().toUpperCase(),
      fatura: mapa.fatura !== undefined ? String(r[mapa.fatura] ?? '').trim() : '',
    }));
}

// Linha em branco da grade (nada digitado): nao entra no calculo.
export function entradaVazia(e = {}) {
  return ['nf', 'transportadora', 'cnpjTransp', 'dataEmissao', 'valor', 'codImp', 'cfop', 'cnpjTomador', 'escrV', 'fatura']
    .every((c) => String(e[c] ?? '').trim() === '');
}

export function novaEntradaNfse(uid, base = {}) {
  return { uid, nf: '', transportadora: '', cnpjTransp: '', dataEmissao: '', valor: '', codImp: '', cfop: '', cnpjTomador: '', escrV: '', fatura: '', vencimento: '', ...base };
}

// Equivale a consulta "Lancamento (2)" do Power Query + regras das colunas. Aceita os campos
// como vieram da grade (texto digitado) ou de importacao.
export function montarLancamentoNfse(entradas = [], indices, { vencimento = hojeIso() } = {}) {
  const ids = gerarIds(entradas, (e) => `${String(e.nf ?? '').trim()}/${normalizarCnpj(e.cnpjTransp)}`);
  return entradas.map((e0, i) => {
    const e = {
      ...e0,
      nf: String(e0.nf ?? '').trim(),
      cnpjTransp: normalizarCnpj(e0.cnpjTransp),
      cnpjTomador: normalizarCnpj(e0.cnpjTomador),
      dataEmissao: dataParaIso(e0.dataEmissao),
      valor: numeroPlanilha(e0.valor),
      codImp: String(e0.codImp ?? '').trim().toUpperCase(),
      cfop: String(e0.cfop ?? '').trim().toUpperCase(),
      escrV: String(e0.escrV ?? '').trim().toUpperCase(),
    };
    const filial = indices.filiais.get(e.cnpjTomador);
    const emp = filial?.emp || '';
    const centro = filial?.centro || '';
    const cc = emp && e.escrV ? indices.escritorios.get(`${emp}${e.escrV}`) || '' : '';
    const erros = [];
    if (!e.nf) erros.push('NF vazia');
    if (e.cnpjTransp.length !== 14) erros.push('CNPJ do prestador invalido');
    if (!e.dataEmissao) erros.push('data de emissao invalida');
    if (!(e.valor > 0)) erros.push('valor invalido');
    if (!e.codImp) erros.push('codigo de imposto vazio');
    if (!e.cfop) erros.push('CFOP vazio');
    if (!e.cnpjTomador) erros.push('CNPJ do tomador vazio');
    else if (!emp) erros.push('CNPJ do tomador nao esta em Filiais');
    else if (!e.escrV) erros.push('escritorio de vendas vazio');
    else if (!cc) erros.push(`sem centro de custo para ${emp}${e.escrV}`);
    return {
      uid: e0.uid,
      id: ids[i],
      emp,
      nf: e.nf,
      transportadora: String(e0.transportadora ?? '').trim(),
      cnpjTransp: e.cnpjTransp,
      dataEmissao: e.dataEmissao,
      valor: e.valor,
      codImp: e.codImp,
      cfop: e.cfop,
      vencimento: dataParaIso(e0.vencimento) || vencimento,
      centro,
      cc,
      escrV: e.escrV,
      cnpjTomador: e.cnpjTomador,
      fatura: String(e0.fatura ?? '').trim(),
      pedido: '',
      miro: '',
      erros,
    };
  });
}

// Modelo de importacao (mesmas colunas da antiga aba "Preencher Dados") com uma linha de exemplo.
export const CABECALHO_MODELO_NFSE = ['NF', 'Transportadora', 'CNPJ Transp', 'Data Emissão', 'Valor', 'Cod', 'CFOP', 'CNPJ Tomador', 'EscrV', 'Fatura'];
export const EXEMPLO_MODELO_NFSE = { NF: '1428-F', Transportadora: 'ROCHA E MIURA TRANSPORTES LTDA', 'CNPJ Transp': '16615755000130', 'Data Emissão': '30/06/2026', Valor: '57,53', Cod: 'IQ', CFOP: '1933AA', 'CNPJ Tomador': '10158356013866', EscrV: 'Z044', Fatura: '5199' };

// Linhas no formato esperado por gerarScriptNfse.
export function linhasParaScriptNfse(linhas = []) {
  return linhas.map((l) => ({
    id: l.id,
    emp: l.emp,
    nf: l.nf,
    cnpj: apenasDigitos(l.cnpjTransp),
    dtEmissao: isoParaDdmmaaaa(l.dataEmissao),
    valor: valorParaSap(l.valor),
    codImp: l.codImp,
    cfop: l.cfop,
    dtVenc: isoParaDdmmaaaa(l.vencimento),
    centro: l.centro,
    cc: l.cc,
    pedido: l.pedido || '',
    miro: l.miro || '',
  }));
}

// Aplica o arquivo de resultado do SAP (id -> {pedido, miro}) nas linhas.
export function aplicarResultado(linhas = [], resultado = new Map()) {
  let atualizadas = 0;
  const novas = linhas.map((l) => {
    const r = resultado.get(l.id);
    if (!r) return l;
    atualizadas += 1;
    return { ...l, pedido: r.pedido || l.pedido, miro: r.miro || l.miro };
  });
  return { linhas: novas, atualizadas };
}

// Aba "Enviar" da planilha: Transportadora, Fatura, NF Servico, NrPedido, NrMIRO.
export const CABECALHO_ENVIAR_NFSE = ['Transportadora', 'Fatura', 'NF Serviço', 'NrPedido', 'NrMIRO'];

export function linhasEnviarNfse(linhas = []) {
  return linhas
    .filter((l) => l.pedido || l.miro)
    .map((l) => ({ Transportadora: l.transportadora, Fatura: l.fatura, 'NF Serviço': l.nf, NrPedido: l.pedido, NrMIRO: l.miro }));
}

// Aba "Lancados (Historico)": o que foi lancado, com data.
export const CABECALHO_HISTORICO_NFSE = ['Emp.', 'NF Serviço', 'Transportadora', 'CNPJ Transp.', 'Data Emissão', 'Vencimento', 'Valor', 'Cod.Imposto', 'CFOP', 'Fatura', 'Centro', 'EscrV', 'C.Custo', 'NrPedido', 'NrMIRO', 'Lançado em'];

export function linhasHistoricoNfse(linhas = []) {
  const hoje = isoParaBr(hojeIso());
  return linhas
    .filter((l) => l.miro)
    .map((l) => ({
      'Emp.': l.emp,
      'NF Serviço': l.nf,
      Transportadora: l.transportadora,
      'CNPJ Transp.': l.cnpjTransp,
      'Data Emissão': isoParaBr(l.dataEmissao),
      Vencimento: isoParaBr(l.vencimento),
      Valor: l.valor,
      'Cod.Imposto': l.codImp,
      CFOP: l.cfop,
      Fatura: l.fatura,
      Centro: l.centro,
      EscrV: l.escrV,
      'C.Custo': l.cc,
      NrPedido: l.pedido,
      NrMIRO: l.miro,
      'Lançado em': hoje,
    }));
}
