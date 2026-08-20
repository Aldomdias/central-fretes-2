import test from 'node:test';
import assert from 'node:assert/strict';
import {
  derivarStatusOperacional,
  diffAlocacao,
  montarAlocacaoPorTabela,
  montarPainelAlocacao,
  pendenciasDaCarga,
  rankingTransportadorasParaCarga,
  tabelaVigenteNaData,
} from '../src/utils/lotacaoAlocacao.js';

const tabelas = [
  {
    id: 't1',
    tipo: 'TRANSPORTADORA',
    nome: 'TRANSP A',
    linhas: [
      { id: 'r1', transportadora: 'TRANSP A', origem: 'ITAJAI', destino: 'MACEIO', tipo: 'CARRETA BAU', valor: 10000, target: 9500 },
      { id: 'r2', transportadora: 'TRANSP A', origem: 'ITAJAI', destino: 'MACEIO', tipo: 'CARRETA BAU', valor: 9800, target: 9500 },
    ],
  },
  {
    id: 't2',
    tipo: 'TRANSPORTADORA',
    nome: 'TRANSP B',
    linhas: [
      { id: 'r3', transportadora: 'TRANSP B', origem: 'Itajaí', destino: 'Maceió', tipo: 'CARRETA BAU', valor: 9000, target: 9500 },
    ],
  },
  {
    id: 'antt',
    tipo: 'ANTT',
    nome: 'ANTT',
    linhas: [
      { id: 'a1', origem: 'ITAJAI', destino: 'MACEIO', tipo: 'CARRETA BAU', valor: 9200 },
    ],
  },
];

const carga = { origem: 'ITAJAI', destino: 'MACEIO', tipoVeiculo: 'CARRETA BAU' };

test('ranking ordena do menor valor e ignora acento na rota', () => {
  const ranking = rankingTransportadorasParaCarga(tabelas, carga);
  assert.equal(ranking.length, 2);
  assert.equal(ranking[0].transportadora, 'TRANSP B');
  assert.equal(ranking[0].valor, 9000);
  assert.equal(ranking[0].melhorPreco, true);
});

test('mesma transportadora na mesma rota fica com a menor linha', () => {
  const ranking = rankingTransportadorasParaCarga(tabelas, carga);
  const transpA = ranking.find((item) => item.transportadora === 'TRANSP A');
  assert.equal(transpA.valor, 9800);
  assert.equal(transpA.diferencaMelhor, 800);
});

test('ranking marca acima do target e abaixo do piso ANTT', () => {
  const ranking = rankingTransportadorasParaCarga(tabelas, carga);
  const transpB = ranking.find((item) => item.transportadora === 'TRANSP B');
  const transpA = ranking.find((item) => item.transportadora === 'TRANSP A');
  assert.equal(transpB.abaixoAntt, true);   // 9000 < piso 9200
  assert.equal(transpA.acimaTarget, true);  // 9800 > target 9500
});

test('tabela fora da vigencia sai do ranking', () => {
  const comVigencia = tabelas.map((tabela) => (
    tabela.id === 't2' ? { ...tabela, vigenciaInicio: '2030-01-01' } : tabela
  ));
  const ranking = rankingTransportadorasParaCarga(comVigencia, { ...carga, coletaPlanejada: '2026-08-19' });
  assert.equal(ranking.length, 1);
  assert.equal(ranking[0].transportadora, 'TRANSP A');
});

test('tabela sem vigencia declarada continua valendo', () => {
  assert.equal(tabelaVigenteNaData({}, '2026-08-19'), true);
});

test('status operacional e deduzido do que o fluxo ja preencheu', () => {
  assert.equal(derivarStatusOperacional({}), 'PLANEJADA');
  assert.equal(derivarStatusOperacional({ transportadora: 'X', placaCavalo: 'ABC1D23' }), 'ALOCADA');
  assert.equal(derivarStatusOperacional({ coletaRealizada: '2026-08-18' }), 'EM_TRANSITO');
  assert.equal(derivarStatusOperacional({ descarga: true }), 'ENTREGUE');
  assert.equal(derivarStatusOperacional({ ctes: ['123'] }), 'FATURADA');
  assert.equal(derivarStatusOperacional({ statusOperacional: 'EM_COTACAO', descarga: true }), 'EM_COTACAO');
});

test('alocacao pela tabela vira snapshot do valor e da origem', () => {
  const ranking = rankingTransportadorasParaCarga(tabelas, carga);
  const alocacao = montarAlocacaoPorTabela(ranking[0], { usuario: 'Aldo' });
  assert.equal(alocacao.statusOperacional, 'ALOCADA');
  assert.equal(alocacao.valorFonte, 'TABELA');
  assert.equal(alocacao.valorComparacao, 9000);
  assert.equal(alocacao.valorTabela, 9000);
  assert.equal(alocacao.valorTarget, 9500);
  assert.equal(alocacao.valorAntt, 9200);
  assert.equal(alocacao.tabelaRotaId, 'r3');
  assert.equal(alocacao.alocadoPor, 'Aldo');
});

test('pendencias apontam o que falta para a carga rodar', () => {
  const ids = pendenciasDaCarga({ origem: 'A', destino: 'B' }).map((item) => item.id);
  assert.ok(ids.includes('SEM_TRANSPORTADORA'));
  assert.ok(ids.includes('SEM_PLACA'));
  assert.ok(ids.includes('SEM_VALOR'));
  assert.ok(ids.includes('SEM_TIPO_VEICULO'));
});

test('valor acima do target e abaixo do ANTT viram pendencia grave', () => {
  const acima = pendenciasDaCarga({ transportadora: 'X', valorComparacao: 10000, valorTarget: 9500 });
  assert.ok(acima.find((item) => item.id === 'ACIMA_TARGET')?.grave);

  const abaixo = pendenciasDaCarga({ transportadora: 'X', valorComparacao: 9000, valorAntt: 9200 });
  assert.ok(abaixo.find((item) => item.id === 'ABAIXO_ANTT')?.grave);
});

test('carga entregue nao cobra placa', () => {
  const ids = pendenciasDaCarga({ descarga: true, transportadora: 'X', valorComparacao: 100, tipoVeiculo: 'TRUCK', valorFonte: 'TABELA' })
    .map((item) => item.id);
  assert.ok(!ids.includes('SEM_PLACA'));
});

test('painel filtra pelo dia e poe pendencia grave na frente', () => {
  const painel = montarPainelAlocacao([
    { id: '1', dist: 'D1', origem: 'ITAJAI', destino: 'MACEIO', tipoVeiculo: 'TRUCK', transportadora: 'X', placaCavalo: 'AAA1A11', valorComparacao: 100, valorFonte: 'TABELA', coletaPlanejada: '2026-08-19T10:00:00Z' },
    { id: '2', dist: 'D2', origem: 'ITAJAI', destino: 'RECIFE', coletaPlanejada: '2026-08-19T08:00:00Z' },
    { id: '3', dist: 'D3', origem: 'ITAJAI', destino: 'NATAL', coletaPlanejada: '2026-08-20T08:00:00Z' },
  ], { data: '2026-08-19' });

  assert.equal(painel.total, 2);
  assert.equal(painel.cargas[0].dist, 'D2');
  assert.equal(painel.comPendenciaGrave, 1);
});

test('painel busca por DIST, destino ou placa', () => {
  const base = [{ id: '1', dist: 'D1', origem: 'ITAJAI', destino: 'MACEIO', placaCavalo: 'AAA1A11' }];
  assert.equal(montarPainelAlocacao(base, { busca: 'maceio' }).total, 1);
  assert.equal(montarPainelAlocacao(base, { busca: 'AAA1A11' }).total, 1);
  assert.equal(montarPainelAlocacao(base, { busca: 'ZZZ' }).total, 0);
});

test('trilha registra so o que mudou de verdade', () => {
  const antes = { transportadora: 'TRANSP A', placaCavalo: 'AAA1A11', valorComparacao: 9000 };
  const eventos = diffAlocacao(antes, { transportadora: 'TRANSP B', placaCavalo: 'AAA1A11', valorComparacao: 9500 });
  assert.equal(eventos.length, 2);
  const troca = eventos.find((item) => item.campo === 'Transportadora');
  assert.equal(troca.valorAnterior, 'TRANSP A');
  assert.equal(troca.valorNovo, 'TRANSP B');
});
