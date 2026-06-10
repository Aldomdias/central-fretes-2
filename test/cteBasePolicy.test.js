import test from 'node:test';
import assert from 'node:assert/strict';
import {
  avaliarCteParaBase,
  isCpComercialCte,
} from '../src/services/cteBasePolicy.js';

const VARIANTES_EXCEL = [
  'CP COMERCIAL S A',
  'CP COMERCIAL S/A',
  'Cp Comercial SA',
  'CP COMERCIAL SA.',
  'CP COMERCIAL LTDA',
];

test('isCpComercialCte reconhece variantes do Excel', () => {
  VARIANTES_EXCEL.forEach((tomador) => {
    assert.equal(isCpComercialCte({ tomador_servico: tomador }), true, tomador);
  });
});

test('CP COMERCIAL fica fora com flag desligada e entra com flag ligada', () => {
  VARIANTES_EXCEL.forEach((tomador) => {
    const row = { tomador_servico: tomador };
    const off = avaliarCteParaBase(row, { incluirCpComercial: false });
    const on = avaliarCteParaBase(row, { incluirCpComercial: true });
    assert.equal(off.aceito, false, `${tomador} deveria ser rejeitado sem flag`);
    assert.equal(off.codigo, 'cp_comercial');
    assert.equal(on.aceito, true, `${tomador} deveria ser aceito com flag`);
  });
});

test('tomador CP isolado também é CP COMERCIAL', () => {
  assert.equal(isCpComercialCte({ tomador_servico: 'CP' }), true);
});
