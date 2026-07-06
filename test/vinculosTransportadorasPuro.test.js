import test from 'node:test';
import assert from 'node:assert/strict';

import { criarMapaVinculosTransportadoras, aplicarVinculoTransportadora } from '../src/services/vinculosTransportadorasPuro.js';

test('aplicarVinculoTransportadora segue a cadeia de vinculos ate estabilizar', () => {
  const mapa = criarMapaVinculosTransportadoras([
    { nomeCte: 'GUANABARA EXPRESS TRANSP DE CARGAS LTDA', nomeTabela: 'GUANABARA EXPRESS' },
    { nomeCte: 'GUANABARA EXPRESS', nomeTabela: 'Gbex Reajuste' },
  ]);

  assert.equal(
    aplicarVinculoTransportadora('GUANABARA EXPRESS TRANSP DE CARGAS LTDA', mapa),
    'Gbex Reajuste',
    'deve resolver os dois saltos ate o nome final da negociacao'
  );
});

test('aplicarVinculoTransportadora sem vinculo mantem o nome original', () => {
  const mapa = criarMapaVinculosTransportadoras([]);
  assert.equal(aplicarVinculoTransportadora('TRANSPORTADORA SEM VINCULO', mapa), 'TRANSPORTADORA SEM VINCULO');
});

test('aplicarVinculoTransportadora nao entra em loop com vinculo circular', () => {
  const mapa = criarMapaVinculosTransportadoras([
    { nomeCte: 'A', nomeTabela: 'B' },
    { nomeCte: 'B', nomeTabela: 'A' },
  ]);

  const resultado = aplicarVinculoTransportadora('A', mapa);
  assert.ok(resultado === 'A' || resultado === 'B', 'deve retornar um dos dois nomes sem travar');
});
