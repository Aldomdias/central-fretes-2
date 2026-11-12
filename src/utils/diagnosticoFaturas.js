// Diagnostico gerencial de uma lista de faturas (aba Diagnostico da Auditoria de Fretes): le a lista
// colada, casa com as faturas da plataforma e classifica cada uma por localizacao, auditoria,
// lancamento, CT-es no SAP, pagamento e vencimento. Tudo aqui e puro; a busca dos CT-es fica no service.
import { diasAte } from './auditoriaFretesDomain.js';
import { obterRaizCnpj, raizCnpjValida } from './cnpj.js';
import { chaveCasamentoCte, cnpj14, serieDaChave, situacaoLancamentoCte } from './lancamentosCteSap.js';
import { ehLinhaNfse } from './nfseFatura.js';
import { parseNumeroPlanilha } from './parseNumeroPlanilha.js';
import { linhaFenixDoCte } from './termoCorrecaoFenix.js';

export const TOLERANCIA_VALOR_LISTA = 0.05;

const norm = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
const digitos = (v) => String(v ?? '').replace(/\D/g, '');

export const numeroComparavel = (numero) => digitos(numero).replace(/^0+(?=\d)/, '');

const RE_DATA = /^(\d{2})[/.-](\d{2})[/.-](\d{2}|\d{4})$/;
const RE_DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})/;
const RE_DINHEIRO = /^(R\$\s*)?-?\d{1,3}([.,]?\d{3})*[.,]\d{2}$/i;

function dataIso(texto) {
  const t = String(texto || '').trim();
  const iso = t.match(RE_DATA_ISO);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = t.match(RE_DATA);
  if (!m) return '';
  return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2]}-${m[1]}`;
}

const ehData = (c) => Boolean(dataIso(c));
const ehDinheiro = (c) => RE_DINHEIRO.test(String(c || '').trim());

function colunasDoCabecalho(celulas) {
  const achar = (re) => celulas.findIndex((c) => re.test(norm(c)));
  let numero = achar(/FATURA|TITULO|DUPLICATA/);
  if (numero < 0) numero = achar(/DOCUMENTO|^DOC|NUMERO|^NRO|^N[º°O.]/);
  return { numero, vencimento: achar(/VENC/), valor: achar(/VALOR|SALDO|MONTANTE|TOTAL/) };
}

function itemDaLinhaSemCabecalho(celulas) {
  const numero = celulas.find((c) => digitos(c) && !ehData(c) && !ehDinheiro(c)) || '';
  const datas = celulas.filter(ehData);
  const valores = celulas.filter(ehDinheiro);
  // Duas datas numa linha costumam ser emissao e vencimento, nessa ordem.
  return { numero, vencimento: datas.at(-1) || '', valor: valores.at(-1) || '' };
}

// Le a lista colada. Aceita numeros soltos (um por linha, virgula, ponto e virgula ou espaco) e
// tabela copiada do Excel/e-mail (com ou sem cabecalho). Vencimento e valor sao opcionais.
export function parseListaFaturas(texto = '') {
  const linhas = String(texto || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const brutos = [];
  const tabular = String(texto).includes('\t') || (linhas.length > 1 && linhas.filter((l) => l.includes(';')).length > 1);
  if (tabular) {
    const separador = String(texto).includes('\t') ? '\t' : ';';
    const tabela = linhas.map((l) => l.split(separador).map((c) => c.trim()));
    const cab = colunasDoCabecalho(tabela[0]);
    const temCabecalho = !digitos(tabela[0].join('')) || cab.numero >= 0;
    (temCabecalho ? tabela.slice(1) : tabela).forEach((celulas) => {
      if (temCabecalho && cab.numero >= 0) {
        brutos.push({ numero: celulas[cab.numero], vencimento: celulas[cab.vencimento] || '', valor: celulas[cab.valor] || '' });
      } else brutos.push(itemDaLinhaSemCabecalho(celulas));
    });
  } else {
    linhas.forEach((linha) => {
      const partes = linha.split(/\s+/);
      if (partes.length > 1 && partes.some((p) => ehData(p) || ehDinheiro(p))) brutos.push(itemDaLinhaSemCabecalho(partes));
      else linha.split(/[\s,;]+/).forEach((numero) => brutos.push({ numero, vencimento: '', valor: '' }));
    });
  }
  const porNumero = new Map();
  let repetidosNaLista = 0;
  brutos.forEach((b) => {
    const comparavel = numeroComparavel(b.numero);
    if (!comparavel) return;
    if (porNumero.has(comparavel)) { repetidosNaLista += 1; return; }
    const valor = b.valor ? parseNumeroPlanilha(b.valor, null) : null;
    porNumero.set(comparavel, { numero: String(b.numero).trim(), comparavel, vencimento: dataIso(b.vencimento), valor });
  });
  return { itens: [...porNumero.values()], repetidosNaLista };
}

// Funcao que diz se uma fatura e da transportadora escolhida: pelo nome ou pela raiz do CNPJ (filiais).
export function criarFiltroTransportadora(faturas = [], transportadora = '') {
  if (!transportadora) return () => true;
  const alvo = norm(transportadora);
  const raizes = new Set(faturas.filter((f) => norm(f.transportadora) === alvo)
    .map((f) => obterRaizCnpj(f.cnpj_transportadora)).filter(raizCnpjValida));
  return (f) => norm(f.transportadora) === alvo || raizes.has(obterRaizCnpj(f.cnpj_transportadora));
}

const inativa = (f) => ['CANCELADA', 'SUBSTITUIDA'].includes(f.status);
const linhaDaFatura = (fatura, extra = {}) => ({ id: String(fatura.id), fatura, numero: String(fatura.numero_fatura || ''), repetida: 1, ...extra });

export const nomeAuditor = (f) => String(f?.auditor_nome || '').trim() || 'Sem auditor';

// Monta as linhas do diagnostico. Com lista: uma linha por numero colado (mais de uma so se o numero
// existir em faturas ativas diferentes). Sem lista: todas as faturas da transportadora escolhida.
// Auditor: so as faturas dele. Escolhido sozinho (sem lista e sem transportadora), mostra as que ele
// ainda esta tratando: nao pagas (protocolo, Fenix, previsao...), mais as canceladas para o card delas.
export function montarLinhasDiagnostico({ itens = [], faturas = [], transportadora = '', auditor = '' }) {
  const daTransportadora = criarFiltroTransportadora(faturas, transportadora);
  const doAuditor = (f) => !auditor || nomeAuditor(f) === auditor;
  if (!itens.length) {
    if (transportadora) return faturas.filter((f) => daTransportadora(f) && doAuditor(f)).map((f) => linhaDaFatura(f));
    if (!auditor) return [];
    // As canceladas entram tambem: ficam fora da lista e so aparecem no card "Canceladas".
    return faturas.filter((f) => doAuditor(f) && (inativa(f) || situacaoPagamento(f) === 'ABERTA')).map((f) => linhaDaFatura(f));
  }
  const indice = new Map();
  faturas.forEach((f) => {
    const n = numeroComparavel(f.numero_fatura);
    if (n) indice.set(n, [...(indice.get(n) || []), f]);
  });
  const linhas = [];
  itens.forEach((item) => {
    // "12345-1" ou "12345/1" colado com a serie junto: tenta tambem so o numero.
    const semSerie = numeroComparavel(item.numero.replace(/[-/]\d{1,3}$/, ''));
    const candidatas = indice.get(item.comparavel) || indice.get(semSerie) || [];
    const daEscolhida = candidatas.filter(daTransportadora);
    // Numero de outro auditor sai da lista; o nao localizado fica (nao da para saber de quem e).
    if (daEscolhida.length && !daEscolhida.some(doAuditor)) return;
    if (!daEscolhida.length) {
      linhas.push({
        id: `lista-${item.comparavel}`, fatura: null, numero: item.numero, valorLista: item.valor, vencimentoLista: item.vencimento, repetida: 0,
        outrasTransportadoras: [...new Set(candidatas.map((f) => f.transportadora).filter(Boolean))],
      });
      return;
    }
    const ativas = daEscolhida.filter((f) => doAuditor(f) && !inativa(f));
    const escolhidas = ativas.length ? ativas : daEscolhida.filter(doAuditor);
    escolhidas.forEach((fatura) => {
      const diferencaLista = item.valor == null ? null : Number((Number(fatura.valor_fatura || 0) - item.valor).toFixed(2));
      linhas.push(linhaDaFatura(fatura, { numero: String(fatura.numero_fatura || item.numero), valorLista: item.valor, vencimentoLista: item.vencimento, repetida: escolhidas.length, diferencaLista }));
    });
  });
  return linhas;
}

const STATUS_LIBERADAS = new Set(['PRONTA_PARA_PAGAMENTO', 'LIBERADA_COM_DESCONTO', 'ENVIADA_AO_FINANCEIRO', 'TRATADA']);

export function situacaoAuditoria(f) {
  if (inativa(f)) return 'CANCELADA';
  if (String(f.status || '').startsWith('PAGA') || STATUS_LIBERADAS.has(f.status)) return 'LIBERADA';
  if (f.status === 'AGUARDANDO_APROVACAO_GESTAO') return 'GESTAO';
  if (['AGUARDANDO_TRANSPORTADORA', 'AGUARDANDO_NOVA_FATURA'].includes(f.status) || f.confirmacao_transportador_status === 'ENVIADO') return 'FORNECEDOR';
  const total = Number(f.ctes_totais || 0);
  const auditados = Number(f.ctes_auditados || 0);
  if (total > 0 && auditados >= total) return 'AUDITADA';
  return auditados > 0 ? 'PARCIAL' : 'NAO_AUDITADA';
}

export function situacaoPagamento(f) {
  if (inativa(f)) return 'CANCELADA';
  if (f.status === 'PAGA_COM_DIVERGENCIA') return 'PAGA_DIVERGENTE';
  return String(f.status || '').startsWith('PAGA') ? 'PAGA' : 'ABERTA';
}

export const faturaLancada = (f) => Boolean(f.partida || f.lancamento_financeiro || situacaoPagamento(f).startsWith('PAGA'));

export const enviadaErp = (f) => Boolean(f.data_envio_erp);
// Contingencia: fatura que vai para protocolo por agrupamento manual (fora do AMD).
export const agrupamentoManual = (f) => Boolean(f?.agrupamento_manual);

// Ha transportadora cujo SAP so tem partida por CT-e (Referencia "numero-serie"), sem linha com o numero
// da fatura: com todos os CT-es lancados a fatura nao e erro de envio.
export function situacaoEnvioErp(linha) {
  const f = linha.fatura;
  if (!f) return '';
  if (!enviadaErp(f)) return 'NAO_ENVIADA';
  if (faturaLancada(f)) return 'COM_PARTIDA';
  const ctes = situacaoCtes(linha.ctes);
  if (ctes === 'VERIFICANDO') return 'VERIFICANDO';
  return ctes === 'TODOS' ? 'PARTIDA_NOS_CTES' : 'SEM_PARTIDA';
}

// So o que ainda sera pago tem faixa de vencimento.
export function faixaDiagnostico(f, referencia = new Date()) {
  if (situacaoPagamento(f) !== 'ABERTA') return 'ENCERRADA';
  const dias = diasAte(f.data_vencimento, referencia);
  if (dias == null) return 'SEM_DATA';
  if (dias < 0) return 'VENCIDA';
  if (dias <= 1) return 'HOJE_AMANHA';
  return dias <= 7 ? 'ATE_7' : 'MAIS_7';
}

// Fatura fora da plataforma nao tem registro de pagamento: conta como em aberto.
export const situacaoPagamentoLinha = (l) => (l.fatura ? situacaoPagamento(l.fatura) : 'ABERTA');

// Faixa da linha; a fatura nao localizada usa o vencimento informado na lista colada.
export function faixaDaLinha(l, referencia = new Date()) {
  if (l.fatura) return faixaDiagnostico(l.fatura, referencia);
  return l.vencimentoLista ? faixaDiagnostico({ data_vencimento: l.vencimentoLista }, referencia) : 'NAO_LOCALIZADA';
}

export const FAIXAS_A_VENCER = ['HOJE_AMANHA', 'ATE_7', 'MAIS_7'];

// Previsao de pagamento combinada com o financeiro no protocolo (agrupamento manual). Fora do protocolo
// o prazo e o vencimento. So vale enquanto a fatura esta no protocolo e nao foi paga.
export const previsaoPagamento = (f) => (f && f.agrupamento_manual && situacaoPagamento(f) === 'ABERTA' ? String(f.data_previsao_pagamento || '').slice(0, 10) : '');

// SEM_PREVISAO, PREVISTA (hoje ou adiante) ou ATRASADA (a data combinada passou e nao pagou).
export function situacaoPrevisao(f, referencia = new Date()) {
  const data = previsaoPagamento(f);
  if (!data) return 'SEM_PREVISAO';
  const dias = diasAte(data, referencia);
  return dias != null && dias < 0 ? 'ATRASADA' : 'PREVISTA';
}

// Identificacao do CT-e no SAP: emitente e serie saem da chave de acesso (e o CNPJ da filial que emitiu).
export function identificacaoSapDoCte(item = {}) {
  const chave = digitos(item.chave_cte);
  const temChave = chave.length === 44;
  return {
    cnpj: cnpj14(temChave ? chave.slice(6, 20) : (item.cnpj_emissor || item.cnpj_transportadora)),
    numero: String(Number(digitos(item.numero_cte) || (temChave ? chave.slice(25, 34) : 0))),
    serie: temChave ? serieDaChave(chave) : String(Number(digitos(item.serie_cte) || 0)),
  };
}

// Resumo dos CT-es de uma fatura contra as linhas SAP (Map chaveCasamento -> linhas).
export function resumirCtesFatura(detalhes = [], lancamentosPorChave = new Map()) {
  const vistos = new Set();
  // itens: todos os CT-es da fatura (com partida, sem partida, NFS-e) para a planilha completa.
  // fenix: CT-es compensados pela partida Fenix (compensacao nao paga): travam a escrituracao da fatura.
  const resumo = { total: 0, lancados: 0, nfse: 0, itens: [], semPartida: [], valorSemPartida: 0, fenix: [], valorFenix: 0 };
  detalhes.forEach((item) => {
    if (item.excluido_da_versao === true) return;
    const unico = digitos(item.chave_cte) || `${digitos(item.numero_cte)}-${item.serie_cte || ''}`;
    if (vistos.has(unico)) return;
    vistos.add(unico);
    const base = { numero_cte: item.numero_cte, serie_cte: item.serie_cte, chave_cte: item.chave_cte, valor_frete: Number(item.valor_frete || 0) };
    if (ehLinhaNfse(item)) { resumo.nfse += 1; resumo.itens.push({ ...base, situacao: 'NFSE' }); return; }
    resumo.total += 1;
    const linhasSap = lancamentosPorChave.get(chaveCasamentoCte(identificacaoSapDoCte(item))) || [];
    const situacao = situacaoLancamentoCte(linhasSap);
    if (situacao.lancado) {
      resumo.lancados += 1;
      const fenix = linhaFenixDoCte(linhasSap);
      resumo.itens.push({ ...base, situacao: 'COM_PARTIDA', lancamento_contabil: situacao.lancamento_contabil, data_lancamento: situacao.data_lancamento, valor_lancado: situacao.valor_lancado, fenix: Boolean(fenix) });
      if (fenix) {
        resumo.fenix.push({
          ...base, partida: fenix.lancamento_contabil, documento_compensacao: fenix.documento_compensacao, data_compensacao: fenix.data_compensacao || null,
          data_lancamento: fenix.data_lancamento || null, montante: Math.abs(Number(fenix.montante || 0)), empresa: fenix.empresa || '', codigo_fornecedor: fenix.codigo_fornecedor || '', fornecedor: fenix.fornecedor || '',
        });
        resumo.valorFenix += Number(item.valor_frete || 0);
      }
      return;
    }
    resumo.itens.push({ ...base, situacao: situacao.estornado ? 'ESTORNADO' : 'SEM_PARTIDA' });
    resumo.semPartida.push({ ...base, estornado: situacao.estornado });
    resumo.valorSemPartida += Number(item.valor_frete || 0);
  });
  resumo.valorSemPartida = Number(resumo.valorSemPartida.toFixed(2));
  resumo.valorFenix = Number(resumo.valorFenix.toFixed(2));
  return resumo;
}

export function situacaoCtes(resumo) {
  if (!resumo) return 'VERIFICANDO';
  if (!resumo.total) return resumo.nfse ? 'SO_NFSE' : 'SEM_CTES';
  if (resumo.lancados === resumo.total) return 'TODOS';
  return resumo.lancados ? 'PARCIAL' : 'NENHUM';
}

export const temFenix = (linha) => Boolean(linha?.ctes?.fenix?.length);

// Pedido de estorno da Fenix ao financeiro, antes do protocolo (marcacao feita na tela):
// A_ENVIAR -> AGUARDANDO (enviada ao financeiro) -> RETORNO (estorno feito: mandar protocolo) -> PROTOCOLO.
// O retorno vale pela marcacao manual ou sozinho, quando o SAP reimportado ja nao mostra a Fenix.
export const statusAjusteFenix = (f) => (['ENVIADO', 'RETORNADO'].includes(f?.fenix_ajuste_status) ? f.fenix_ajuste_status : '');

export function etapaFenix(linha) {
  const f = linha?.fatura;
  if (!f || inativa(f) || situacaoPagamento(f) !== 'ABERTA') return '';
  const status = statusAjusteFenix(f);
  if (!status) return temFenix(linha) ? 'A_ENVIAR' : '';
  if (agrupamentoManual(f)) return 'PROTOCOLO';
  if (status === 'RETORNADO') return 'RETORNO';
  // Sem o resumo dos CT-es ainda nao da para saber se o estorno chegou.
  return linha.ctes && !temFenix(linha) ? 'RETORNO' : 'AGUARDANDO';
}

const ROTULO_PAGAMENTO = { PAGA: 'Paga', PAGA_DIVERGENTE: 'Paga c/ divergência', CANCELADA: 'Cancelada' };

// Texto da coluna Pagamento: a fatura em aberto mostra tambem ate onde o lancamento chegou.
export function textoPagamentoLinha(linha) {
  const f = linha.fatura;
  if (!f) return 'Sem registro';
  const situacao = situacaoPagamento(f);
  if (situacao !== 'ABERTA') return ROTULO_PAGAMENTO[situacao];
  if (faturaLancada(f)) return 'Lançada, não paga';
  return situacaoCtes(linha.ctes) === 'TODOS' ? 'Lançada nos CT-es, não paga' : 'Não lançada';
}

// O que falta fazer com a fatura, na ordem do fluxo.
export function proximaAcao(linha) {
  const f = linha.fatura;
  if (!f) return 'Localizar / importar a fatura';
  const auditoria = situacaoAuditoria(f);
  if (auditoria === 'CANCELADA') return 'Nenhuma (cancelada/substituída)';
  if (situacaoPagamento(f) !== 'ABERTA') return 'Nenhuma (paga)';
  const fenix = etapaFenix(linha);
  if (fenix === 'A_ENVIAR') return 'Pedir estorno da compensação Fênix ao financeiro';
  if (fenix === 'AGUARDANDO') return 'Aguardar retorno do financeiro (Fênix)';
  if (fenix === 'RETORNO') return 'Mandar protocolo (Fênix ajustada)';
  if (agrupamentoManual(f) && !faturaLancada(f)) {
    const previsto = previsaoPagamento(f);
    return `Aguardar agrupamento manual do financeiro${previsto ? ` (pagamento previsto ${previsto.split('-').reverse().join('/')})` : ''}`;
  }
  if (situacaoEnvioErp(linha) === 'SEM_PARTIDA') return 'Verificar envio ao ERP (sem partida)';
  if (auditoria === 'NAO_AUDITADA' || auditoria === 'PARCIAL') return 'Auditar';
  if (auditoria === 'AUDITADA') return 'Tratar e liberar';
  if (auditoria === 'FORNECEDOR') return 'Cobrar retorno do fornecedor';
  if (auditoria === 'GESTAO') return 'Aprovar na gestão';
  if (['PARCIAL', 'NENHUM'].includes(situacaoCtes(linha.ctes))) return 'Lançar CT-es sem partida';
  if (!faturaLancada(f)) return 'Lançar a fatura';
  const previsao = previsaoPagamento(f);
  return previsao ? `Aguardar pagamento (previsto ${previsao.split('-').reverse().join('/')})` : 'Aguardar pagamento';
}

const comFatura = (fn) => (l) => Boolean(l.fatura) && fn(l);
const auditoria = (...ids) => comFatura((l) => ids.includes(situacaoAuditoria(l.fatura)));
const pagamento = (id) => (l) => situacaoPagamentoLinha(l) === id;
const faixa = (...ids) => (l) => ids.includes(faixaDaLinha(l));
const ctes = (...ids) => comFatura((l) => ids.includes(situacaoCtes(l.ctes)));
const ativa = (l) => !inativa(l.fatura);

// Grupos de cards. Dentro do grupo escolhe-se um card; entre grupos os filtros se somam.
export const GRUPOS_DIAGNOSTICO = [
  { id: 'localizacao', titulo: 'Na plataforma', soComLista: true, cards: [
    { id: 'localizadas', rotulo: 'Localizadas', cor: '#315ee7', teste: (l) => Boolean(l.fatura), dica: 'Número colado que existe na plataforma.' },
    { id: 'nao_localizadas', rotulo: 'Não localizadas', cor: '#9b1111', teste: (l) => !l.fatura, dica: 'Número colado que não existe na plataforma para esta transportadora.' },
    { id: 'repetidas', rotulo: 'Número repetido', cor: '#b78700', teste: (l) => l.repetida > 1, dica: 'O número existe em mais de uma fatura ativa.' },
    { id: 'valor_difere', rotulo: 'Valor difere da lista', cor: '#e67e22', teste: (l) => l.diferencaLista != null && Math.abs(l.diferencaLista) > TOLERANCIA_VALOR_LISTA, dica: 'Valor da plataforma diferente do valor colado na lista.' },
  ] },
  { id: 'auditoria', titulo: 'Auditoria', cards: [
    { id: 'nao_auditadas', rotulo: 'Não auditadas', cor: '#9b1111', teste: auditoria('NAO_AUDITADA'), dica: 'Em aberto e nenhum CT-e auditado.' },
    { id: 'parciais', rotulo: 'Parcialmente auditadas', cor: '#e67e22', teste: auditoria('PARCIAL'), dica: 'Em aberto com parte dos CT-es auditados.' },
    { id: 'auditadas', rotulo: 'Auditadas, falta liberar', cor: '#315ee7', teste: auditoria('AUDITADA'), dica: 'Todos os CT-es auditados, ainda sem liberação.' },
    { id: 'fornecedor', rotulo: 'Aguardando fornecedor', cor: '#b78700', teste: auditoria('FORNECEDOR'), dica: 'Laudo enviado ou aguardando nova fatura.' },
    { id: 'gestao', rotulo: 'Aguardando gestão', cor: '#9153F0', teste: auditoria('GESTAO'), dica: 'Na aprovacao da gestão.' },
    { id: 'liberadas', rotulo: 'Liberadas', cor: '#04a484', teste: auditoria('LIBERADA'), dica: 'Liberadas, no financeiro ou já pagas.' },
  ] },
  { id: 'lancamento', titulo: 'Lançamento da fatura', cards: [
    { id: 'lancadas', rotulo: 'Já lançadas', cor: '#14733b', teste: comFatura((l) => ativa(l) && faturaLancada(l.fatura)), dica: 'Com partida ou lançamento financeiro, ou já paga.' },
    { id: 'nao_lancadas', rotulo: 'Não lançadas', cor: '#9b1111', teste: comFatura((l) => ativa(l) && !faturaLancada(l.fatura)), dica: 'Sem partida e sem lançamento financeiro.' },
  ] },
  { id: 'erp', titulo: 'Envio ao ERP', cards: [
    { id: 'enviadas', rotulo: 'Enviadas ao ERP', cor: '#315ee7', teste: comFatura((l) => ativa(l) && enviadaErp(l.fatura)), dica: 'Com data de envio ao ERP.' },
    { id: 'enviadas_sem_partida', rotulo: 'Enviadas sem partida', cor: '#9b1111', teste: comFatura((l) => ativa(l) && situacaoEnvioErp(l) === 'SEM_PARTIDA'), dica: 'Enviadas ao ERP sem partida na fatura e com CT-e sem partida no SAP: possível erro no envio.' },
    { id: 'enviadas_partida_ctes', rotulo: 'Partida só nos CT-es', cor: '#b78700', teste: comFatura((l) => ativa(l) && situacaoEnvioErp(l) === 'PARTIDA_NOS_CTES'), dica: 'Enviadas ao ERP com todos os CT-es lançados no SAP, mas sem partida pelo número da fatura.' },
    { id: 'enviadas_com_partida', rotulo: 'Enviadas com partida', cor: '#14733b', teste: comFatura((l) => ativa(l) && situacaoEnvioErp(l) === 'COM_PARTIDA'), dica: 'Enviadas ao ERP com partida na fatura, lançamento ou já pagas.' },
    { id: 'nao_enviadas', rotulo: 'Não enviadas', cor: '#64748b', teste: comFatura((l) => ativa(l) && !enviadaErp(l.fatura)), dica: 'Sem data de envio ao ERP.' },
  ] },
  // Contingencia ate o protocolo funcionar dentro do AMD: marcacao feita na propria tela.
  { id: 'protocolo', titulo: 'Protocolo (contingência)', cards: [
    // Sai do card "a agrupar" sozinha quando a fatura recebe partida (o financeiro ja agrupou).
    { id: 'manual_a_agrupar', rotulo: 'Agrupamento manual a enviar', cor: '#9153F0', teste: comFatura((l) => ativa(l) && agrupamentoManual(l.fatura) && !faturaLancada(l.fatura)), dica: 'Marcadas para protocolo por agrupamento manual (fora do AMD) e ainda sem partida na fatura.' },
    { id: 'manual_agrupadas', rotulo: 'Já agrupadas pelo financeiro', cor: '#14733b', teste: comFatura((l) => agrupamentoManual(l.fatura) && faturaLancada(l.fatura)), dica: 'Marcadas para agrupamento manual que já receberam partida, lançamento ou pagamento.' },
    { id: 'sem_marcacao', rotulo: 'Sem marcação', cor: '#64748b', teste: comFatura((l) => ativa(l) && !agrupamentoManual(l.fatura)), dica: 'Seguem o fluxo normal do AMD.' },
  ] },
  { id: 'ctes', titulo: 'CT-es no SAP', cards: [
    { id: 'todos', rotulo: 'Todos os CT-es lançados', cor: '#14733b', teste: ctes('TODOS'), dica: 'Todos os CT-es da fatura tem partida própria no SAP.' },
    { id: 'sem_partida', rotulo: 'Com CT-e sem partida', cor: '#e67e22', teste: ctes('PARCIAL', 'NENHUM'), dica: 'Pelo menos um CT-e da fatura sem partida no SAP.', detalheCtes: true },
    { id: 'nenhum', rotulo: 'Nenhum CT-e lançado', cor: '#9b1111', teste: ctes('NENHUM'), dica: 'Nenhum CT-e da fatura tem partida no SAP.', detalheCtes: true },
    { id: 'sem_ctes', rotulo: 'Sem CT-e / só NFS-e', cor: '#64748b', teste: ctes('SEM_CTES', 'SO_NFSE'), dica: 'Fatura sem CT-e vinculado ou só com NFS-e (não entram no relatório SAP de CT-e).' },
  ] },
  // Partida Fenix (1501163056): compensacao nao paga em CT-e. A fatura nao escritura ate o financeiro estornar.
  { id: 'fenix', titulo: 'Partida Fênix (compensação não paga)', cards: [
    { id: 'com_fenix', rotulo: 'CT-es com a Fênix', cor: '#b91c1c', teste: comFatura((l) => ativa(l) && temFenix(l)), dica: 'Faturas com CT-e compensado pela partida Fênix (1501163056): o financeiro precisa estornar a compensação para a fatura escriturar.', detalheFenix: true },
    { id: 'sem_fenix', rotulo: 'Sem Fênix', cor: '#64748b', teste: comFatura((l) => ativa(l) && Boolean(l.ctes) && !temFenix(l)), dica: 'Faturas verificadas sem CT-e na partida Fênix.' },
  ] },
  // Controle do pedido ao financeiro: a fatura anda de card conforme e marcada na tela.
  { id: 'fenix_ajuste', titulo: 'Ajuste Fênix no financeiro (antes do protocolo)', cards: [
    { id: 'fenix_a_enviar', rotulo: 'Fênix a enviar ao financeiro', cor: '#b91c1c', teste: (l) => etapaFenix(l) === 'A_ENVIAR', dica: 'Com CT-e na Fênix e ainda não marcadas como enviadas ao financeiro. Gere o termo, envie e marque "Enviado para ajustar Fênix".', detalheFenix: true },
    { id: 'fenix_aguardando', rotulo: 'Enviadas, aguardando retorno', cor: '#b78700', teste: (l) => etapaFenix(l) === 'AGUARDANDO', dica: 'Enviadas ao financeiro para estornar a compensação Fênix; aguardando o retorno.', detalheFenix: true },
    { id: 'fenix_retorno', rotulo: 'Retorno recebido: mandar protocolo', cor: '#315ee7', teste: (l) => etapaFenix(l) === 'RETORNO', dica: 'O financeiro já ajustou (marcado como retorno recebido, ou a Fênix sumiu do relatório SAP reimportado). Falta marcar para protocolo.' },
    { id: 'fenix_protocolo', rotulo: 'Já no protocolo', cor: '#14733b', teste: (l) => etapaFenix(l) === 'PROTOCOLO', dica: 'Passaram pelo ajuste Fênix e já foram marcadas para protocolo (agrupamento manual).' },
  ] },
  // Data combinada com o financeiro para as faturas do protocolo, para repassar a transportadora.
  { id: 'previsao', titulo: 'Previsão de pagamento (protocolo)', cards: [
    { id: 'protocolo_sem_previsao', rotulo: 'No protocolo sem previsão', cor: '#9b1111', teste: comFatura((l) => ativa(l) && agrupamentoManual(l.fatura) && situacaoPagamento(l.fatura) === 'ABERTA' && situacaoPrevisao(l.fatura) === 'SEM_PREVISAO'), dica: 'Marcadas para protocolo, não pagas e ainda sem a data alinhada com o financeiro.' },
    { id: 'com_previsao', rotulo: 'Com previsão', cor: '#04a484', teste: comFatura((l) => ativa(l) && situacaoPrevisao(l.fatura) === 'PREVISTA'), dica: 'No protocolo com pagamento previsto para hoje ou adiante: dá para avisar a transportadora.' },
    { id: 'previsao_atrasada', rotulo: 'Previsão passou, não paga', cor: '#e67e22', teste: comFatura((l) => ativa(l) && situacaoPrevisao(l.fatura) === 'ATRASADA'), dica: 'A data prevista já passou e a fatura segue sem pagamento: cobrar o financeiro ou atualizar a data.' },
  ] },
  { id: 'pagamento', titulo: 'Pagamento', cards: [
    { id: 'pagas', rotulo: 'Pagas', cor: '#14733b', teste: pagamento('PAGA'), dica: 'Pagas ou pagas com desconto.' },
    { id: 'pagas_divergentes', rotulo: 'Pagas com divergência', cor: '#b78700', teste: pagamento('PAGA_DIVERGENTE'), dica: 'Valor pago diferente do esperado.' },
    { id: 'abertas', rotulo: 'Não pagas', cor: '#315ee7', teste: pagamento('ABERTA'), dica: 'Ainda sem pagamento. Inclui as não localizadas.' },
    { id: 'canceladas', rotulo: 'Canceladas/substituídas', cor: '#64748b', teste: pagamento('CANCELADA'), dica: 'Canceladas ou substituídas.' },
    // Sem card proprio: usado pelo card "Pago" do topo, que soma pagas e pagas com divergencia.
    { id: 'pagas_todas', rotulo: 'Pagas (todas)', cor: '#14733b', oculto: true, teste: comFatura((l) => situacaoPagamento(l.fatura).startsWith('PAGA')), dica: 'Todas as pagas.' },
  ] },
  { id: 'vencimento', titulo: 'Vencimento (não pagas)', cards: [
    { id: 'vencidas', rotulo: 'Vencidas', cor: '#9b1111', teste: faixa('VENCIDA'), dica: 'Não pagas com vencimento passado. Nas não localizadas vale o vencimento da lista.' },
    { id: 'a_vencer', rotulo: 'A vencer', cor: '#e67e22', teste: faixa(...FAIXAS_A_VENCER), dica: 'Não pagas que ainda vão vencer. Nas não localizadas vale o vencimento da lista.' },
    { id: 'hoje_amanha', rotulo: 'Hoje / amanhã', cor: '#cf2f2f', teste: faixa('HOJE_AMANHA'), dica: 'Não pagas vencendo hoje ou amanhã.' },
    { id: 'ate_7', rotulo: '2 a 7 dias', cor: '#e67e22', teste: faixa('ATE_7'), dica: 'Não pagas vencendo em 2 a 7 dias.' },
    { id: 'mais_7', rotulo: 'Mais de 7 dias', cor: '#04a484', teste: faixa('MAIS_7'), dica: 'Não pagas vencendo em mais de 7 dias.' },
    { id: 'sem_data', rotulo: 'Sem vencimento', cor: '#64748b', teste: faixa('SEM_DATA'), dica: 'Não pagas sem data de vencimento.' },
  ] },
];

// Aplica os cards escolhidos.
export function filtrarPorCards(linhas = [], escolhidos = {}) {
  const testes = GRUPOS_DIAGNOSTICO
    .filter((g) => escolhidos[g.id])
    .map((g) => g.cards.find((c) => c.id === escolhidos[g.id])?.teste)
    .filter(Boolean);
  return testes.length ? linhas.filter((l) => testes.every((t) => t(l))) : linhas;
}

export const valorDaLinha = (l) => Number(l.fatura ? l.fatura.valor_fatura || 0 : l.valorLista || 0);
