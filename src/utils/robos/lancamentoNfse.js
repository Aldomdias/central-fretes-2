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
  naoAntesDeHoje,
  isoParaBr,
  isoParaDdmmaaaa,
  mapearColunas,
  normalizarCnpj,
  numeroPlanilha,
  valorParaSap,
} from './lancamentoComum';
import { nfComSufixoF } from './nfsePdf';

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
  const ids = gerarIds(entradas, (e) => `${nfComSufixoF(e.nf)}/${normalizarCnpj(e.cnpjTransp)}`);
  return entradas.map((e0, i) => {
    const e = {
      ...e0,
      nf: nfComSufixoF(e0.nf), // a NF do SAP sempre leva o sufixo -F (3773 -> 3773-F)
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
    // Escritorio "N/D": centro de custo sem escritorio de vendas, aceito como digitado (sem vinculo)
    const semVinculo = e.escrV === 'N/D';
    const ccDireto = String(e0.ccDireto ?? '').trim().toUpperCase();
    const cc = semVinculo ? ccDireto : emp && e.escrV ? indices.escritorios.get(`${emp}${e.escrV}`) || '' : '';
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
    else if (!cc) erros.push(semVinculo ? 'N/D: informe o centro de custo' : `sem centro de custo para ${emp}${e.escrV}`);
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
      vencimento: naoAntesDeHoje(dataParaIso(e0.vencimento) || vencimento),
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

// Notas que o robo pulou: pendencias_nfse.csv ("etapa;NF;motivo") ou as linhas "ERRO em MIRO (3773-F): ..."
// do log. NF -> { etapa, motivo }; a ultima falha da nota vence.
export function lerPendencias(texto = '') {
  const mapa = new Map();
  String(texto).split(/\r?\n/).forEach((linha) => {
    const log = linha.match(/ERRO em (pedido|MIRO) \((\S+)\):\s*(.*)$/i);
    const csv = log ? null : linha.match(/^\s*(pedido|MIRO);([^;]+);(.*)$/i);
    const m = log || csv;
    if (!m) return;
    mapa.set(nfComSufixoF(m[2].trim()).toUpperCase(), { etapa: /^pedido/i.test(m[1]) ? 'pedido' : 'MIRO', motivo: m[3].trim() });
  });
  return mapa;
}

// Texto curto do motivo: a mensagem do SAP quando houver, senao o erro do script.
export function motivoCurto(motivo = '') {
  const sap = String(motivo).match(/.*SAP:\s*(.+)$/); // a ultima "SAP:" e a barra de status
  const texto = sap && !/^\(sem mensagem\)$/.test(sap[1].trim()) ? sap[1] : String(motivo).split(' | ')[0].replace(/\s*\[erro.*$/, '');
  return texto.trim();
}

// Le o log_lancamento_nfse.txt ("Pedido criado: NF 3773-F -> 4510183552" / "MIRO criada: ...").
// O log so tem a NF (sem CNPJ), entao o casamento e por NF.
export function lerLogLancamento(texto = '') {
  const mapa = new Map();
  String(texto).split(/\r?\n/).forEach((linha) => {
    const m = linha.match(/(Pedido criado|MIRO criada):\s*NF\s+(\S+)\s*->\s*(\d+)/i);
    if (!m) return;
    const nf = nfComSufixoF(m[2]).toUpperCase();
    const atual = mapa.get(nf) || {};
    atual[/^pedido/i.test(m[1]) ? 'pedido' : 'miro'] = m[3];
    mapa.set(nf, atual);
  });
  return mapa;
}

// NF repetida no lote (outra transportadora) fica de fora: sem CNPJ no log nao da para saber de quem e.
export function aplicarLog(linhas = [], logPorNf = new Map()) {
  const contagem = new Map();
  linhas.forEach((l) => { const nf = String(l.nf || '').toUpperCase(); contagem.set(nf, (contagem.get(nf) || 0) + 1); });
  let atualizadas = 0;
  let ambiguas = 0;
  const novas = linhas.map((l) => {
    const nf = String(l.nf || '').toUpperCase();
    const r = logPorNf.get(nf);
    if (!r) return l;
    if (contagem.get(nf) > 1) { ambiguas += 1; return l; }
    atualizadas += 1;
    return { ...l, pedido: r.pedido || l.pedido, miro: r.miro || l.miro };
  });
  return { linhas: novas, atualizadas, ambiguas };
}

// Notas que falharam no SAP e continuam sem MIRO, para tratar (Excel).
export const CABECALHO_PENDENTES_NFSE = ['NF', 'Transportadora', 'CNPJ Transp', 'Valor', 'Fatura', 'Etapa', 'Motivo', 'Detalhe'];

export function linhasPendentesNfse(linhas = []) {
  return linhas
    .filter((l) => l.falhaSap && !l.miro)
    .map((l) => ({ NF: l.nf, Transportadora: l.transportadora, 'CNPJ Transp': l.cnpjTransp, Valor: l.valor, Fatura: l.fatura, Etapa: l.falhaSap.etapa, Motivo: motivoCurto(l.falhaSap.motivo), Detalhe: l.falhaSap.motivo }));
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
