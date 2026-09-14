import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarResumoInicialRevisao } from '../src/utils/tabelasNegociacaoRevisao.js';

test('revisao nasce com o vinculo no resumo do proprio insert', () => {
  const vinculo = {
    revisao_de_id: 'publicada-1',
    revisao_numero: 2,
    aberta_em: '2026-09-14T17:00:00.000Z',
  };

  const resumo = montarResumoInicialRevisao(vinculo);

  assert.deepEqual(resumo, { revisao: vinculo });
  assert.notEqual(resumo.revisao, vinculo);
});
