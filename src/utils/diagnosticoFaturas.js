// Diagnostico gerencial de uma lista de faturas (aba Diagnostico da Auditoria de Fretes): le a lista
// colada, casa com as faturas da plataforma e classifica cada uma por localizacao, auditoria,
// lancamento, CT-es no SAP, pagamento e vencimento. Tudo aqui e puro; a busca dos CT-es fica no service.
import { diasAte } from './auditoriaFretesDomain.js';
import { obterRaizCnpj, raizCnpjValida } from './cnpj.js';
import { chaveCasamentoCte, cnpj14, serieDaChave, situacaoLancamentoCte } from './lancamentosCteSap.js';
import { ehLinhaNfse } from './nfseFatura.js';
import { parseNumeroPlanilha } from './parseNumeroPlanilha.js';

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

// Monta as linhas do diagnostico. Com lista: uma linha por numero colado (mais de uma so se o numero
// existir em faturas ativas diferentes). Sem lista: todas as faturas da transportadora escolhida.
export function montarLinhasDiagnostico({ itens = [], faturas = [], transportadora = '' }) {
  const daTransportadora = criarFiltroTransportadora(faturas, transportadora);
  if (!itens.length) return transportadora ? faturas.filter(daTransportadora).map((f) => linhaDaFatura(f)) : [];
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
    if (!daEscolhida.length) {
      linhas.push({
        id: `lista-${item.comparavel}`, fatura: null, numero: item.numero, valorLista: item.valor, vencimentoLista: item.vencimento, repetida: 0,
        outrasTransportadoras: [...new Set(candidatas.map((f) => f.transportadora).filter(Boolean))],
      });
      return;
    }
    const ativas = daEscolhida.filter((f) => !inativa(f));
    const escolhidas = ativas.length ? ativas : daEscolhida;
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
  const resumo = { total: 0, lancados: 0, nfse: 0, semPartida: [], valorSemPartida: 0 };
  detalhes.forEach((item) => {
    if (item.excluido_da_versao === true) return;
    const unico = digitos(item.chave_cte) || `${digitos(item.numero_cte)}-${item.serie_cte || ''}`;
    if (vistos.has(unico)) return;
    vistos.add(unico);
    if (ehLinhaNfse(item)) { resumo.nfse += 1; return; }
    resumo.total += 1;
    const situacao = situacaoLancamentoCte(lancamentosPorChave.get(chaveCasamentoCte(identificacaoSapDoCte(item))) || []);
    if (situacao.lancado) { resumo.lancados += 1; return; }
    resumo.semPartida.push({ numero_cte: item.numero_cte, serie_cte: item.serie_cte, chave_cte: item.chave_cte, valor_frete: Number(item.valor_frete || 0), estornado: situacao.estornado });
    resumo.valorSemPartida += Number(item.valor_frete || 0);
  });
  resumo.valorSemPartida = Number(resumo.valorSemPartida.toFixed(2));
  return resumo;
}

export function situacaoCtes(resumo) {
  if (!resumo) return 'VERIFICANDO';
  if (!resumo.total) return resumo.nfse ? 'SO_NFSE' : 'SEM_CTES';
  if (resumo.lancados === resumo.total) return 'TODOS';
  return resumo.lancados ? 'PARCIAL' : 'NENHUM';
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
  if (situacaoEnvioErp(linha) === 'SEM_PARTIDA') return 'Verificar envio ao ERP (sem partida)';
  if (auditoria === 'NAO_AUDITADA' || auditoria === 'PARCIAL') return 'Auditar';
  if (auditoria === 'AUDITADA') return 'Tratar e liberar';
  if (auditoria === 'FORNECEDOR') return 'Cobrar retorno do fornecedor';
  if (auditoria === 'GESTAO') return 'Aprovar na gestão';
  if (['PARCIAL', 'NENHUM'].includes(situacaoCtes(linha.ctes))) return 'Lançar CT-es sem partida';
  return faturaLancada(f) ? 'Aguardar pagamento' : 'Lançar a fatura';
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
  { id: 'ctes', titulo: 'CT-es no SAP', cards: [
    { id: 'todos', rotulo: 'Todos os CT-es lançados', cor: '#14733b', teste: ctes('TODOS'), dica: 'Todos os CT-es da fatura tem partida própria no SAP.' },
    { id: 'sem_partida', rotulo: 'Com CT-e sem partida', cor: '#e67e22', teste: ctes('PARCIAL', 'NENHUM'), dica: 'Pelo menos um CT-e da fatura sem partida no SAP.', detalheCtes: true },
    { id: 'nenhum', rotulo: 'Nenhum CT-e lançado', cor: '#9b1111', teste: ctes('NENHUM'), dica: 'Nenhum CT-e da fatura tem partida no SAP.', detalheCtes: true },
    { id: 'sem_ctes', rotulo: 'Sem CT-e / só NFS-e', cor: '#64748b', teste: ctes('SEM_CTES', 'SO_NFSE'), dica: 'Fatura sem CT-e vinculado ou só com NFS-e (não entram no relatório SAP de CT-e).' },
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
