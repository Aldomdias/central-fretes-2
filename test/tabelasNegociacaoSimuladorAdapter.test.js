import test from 'node:test';
import assert from 'node:assert/strict';

import {
  converterTabelaNegociacaoParaSimulador,
  converterTransportadoraOficialParaNegociacao,
} from '../src/utils/tabelasNegociacaoSimuladorAdapter.js';

function tabelaComGrupoCompartilhado() {
  const destinos = ['2927408', '2910800', '2933307', '2900306'];
  const itens = destinos.map((ibge, i) => ({
    id: `rota-${i}`,
    item_tipo: 'ROTA',
    ibge_destino: ibge,
    dados_originais: JSON.stringify({ cotacao: 'BA - FRETE 3% - MIN 60' }),
  }));
  itens.push({
    id: 'preco-1',
    faixa_peso: 'BA - FRETE 3% - MIN 60',
    frete_percentual: 3,
    frete_minimo: 60,
    peso_inicial: 0,
    peso_final: 0,
  });

  return {
    id: 'teste-grupo',
    transportadora: 'Transportadora Teste',
    canal: 'ATACADO',
    origem: 'Itajai',
    uf_origem: 'SC',
    tabelas_negociacao_itens: itens,
    tabelas_negociacao_taxas_destino: [],
  };
}

test('agrupa cotações de negociação por tarifa compartilhada em vez de duplicar por destino', () => {
  const resultado = converterTabelaNegociacaoParaSimulador(tabelaComGrupoCompartilhado());
  const origem = resultado.origens[0];

  assert.equal(origem.rotas.length, 4, 'deve manter uma rota por destino');
  assert.equal(origem.cotacoes.length, 1, 'deve reaproveitar uma única cotação para todos os destinos do mesmo grupo');
  assert.ok(
    origem.rotas.every((rota) => rota.nomeRota === origem.cotacoes[0].rota),
    'toda rota deve apontar para o nome do grupo da cotação (para o motor casar rota x cotação)'
  );
});

test('sem nome de grupo no item, cai no nome por destino (comportamento anterior preservado)', () => {
  const tabela = {
    id: 'teste-sem-grupo',
    transportadora: 'Transportadora Teste',
    canal: 'ATACADO',
    origem: 'Itajai',
    uf_origem: 'SC',
    tabelas_negociacao_itens: [
      { id: 'item-1', ibge_destino: '2927408', frete_percentual: 3, frete_minimo: 60, peso_inicial: 0, peso_final: 0 },
      { id: 'item-2', ibge_destino: '2910800', frete_percentual: 3, frete_minimo: 60, peso_inicial: 0, peso_final: 0 },
    ],
    tabelas_negociacao_taxas_destino: [],
  };

  const resultado = converterTabelaNegociacaoParaSimulador(tabela);
  const origem = resultado.origens[0];

  assert.equal(origem.rotas.length, 2);
  assert.equal(origem.cotacoes.length, 2, 'sem nome de grupo, cada destino continua com sua própria cotação');
});

test('copia o IBGE destino da rota oficial para a revisão mesmo quando vem em alias legado', () => {
  const resultado = converterTransportadoraOficialParaNegociacao({
    nome: 'Transportadora Oficial',
    origens: [{
      cidade: 'Itajai',
      uf: 'SC',
      canal: 'ATACADO',
      rotas: [{
        nomeRota: 'Salvador / BA',
        codigoIbgeDestino: '2927408',
        prazoEntregaDias: 4,
      }],
      cotacoes: [],
      taxasEspeciais: [],
      generalidades: {},
    }],
  }, { canal: 'ATACADO', origem: 'Itajai' });

  assert.equal(resultado.itens.length, 1);
  assert.equal(resultado.itens[0].tipo_item, 'ROTA');
  assert.equal(resultado.itens[0].ibge_destino, '2927408');
  assert.equal(resultado.itens[0].cidade_destino, 'Salvador');
  assert.equal(resultado.itens[0].uf_destino, 'BA');
});
