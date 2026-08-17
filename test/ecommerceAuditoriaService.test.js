import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deduplicarCandidatosEcommerce,
  isTransportadoraEbazarEcommerce,
  normalizarNomeCidade,
} from '../src/utils/ecommerceAuditoriaPuro.js';

test('normaliza variantes acentuadas de Itajai para a mesma origem', () => {
  assert.equal(normalizarNomeCidade('Itajaí'), 'ITAJAI');
  assert.equal(normalizarNomeCidade('ITAJAÍ'), 'ITAJAI');
  assert.equal(normalizarNomeCidade('  Itajai  '), 'ITAJAI');
});

test('normaliza espacos duplicados em Jaboatao dos Guararapes', () => {
  assert.equal(normalizarNomeCidade('Jaboatão  dos Guararapes'), 'JABOATAO DOS GUARARAPES');
});

test('identifica EBAZAR para exclusao da auditoria ecommerce', () => {
  assert.equal(isTransportadoraEbazarEcommerce('EBAZAR.COM.BR LTDA'), true);
  assert.equal(isTransportadoraEbazarEcommerce('TOTAL EXPRESS'), false);
});

test('deduplica rotas repetidas sem remover opcoes realmente diferentes', () => {
  const base = {
    transportadora: 'TAM LINHAS AEREAS',
    origem: 'Campo Grande',
    ibgeDestino: '2927408',
    rotaNome: 'CGRSSA',
    faixaPeso: '10 a 20 kg',
    total: 137.4,
    prazo: 4,
  };
  const resultado = deduplicarCandidatosEcommerce([
    base,
    { ...base },
    { ...base, origem: 'CAMPO GRANDE' },
    { ...base, total: 139.9 },
  ]);
  assert.equal(resultado.length, 2);
  assert.deepEqual(resultado.map((item) => item.total), [137.4, 139.9]);
});
