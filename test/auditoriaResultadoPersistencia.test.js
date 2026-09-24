import test from 'node:test';
import assert from 'node:assert/strict';
import { marcarResultadoRecalculado } from '../src/utils/auditoriaResultadoPersistencia.js';

test('resultado recalculado renova updated_at sem alterar os valores calculados', () => {
  const instante = new Date('2026-09-24T15:30:00.000Z');
  const linha = marcarResultadoRecalculado({
    chave_cte: '35260951448309000180570010003530821002742660',
    valor_calculado: 225.70,
  }, instante);

  assert.equal(linha.updated_at, instante.toISOString());
  assert.equal(linha.valor_calculado, 225.70);
});
