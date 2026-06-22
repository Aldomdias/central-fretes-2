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

test('tomador fora da lista padrão é rejeitado, mas entra com incluirTodosTomadores', () => {
  const row = { tomador_servico: 'CLIENTE NOVO JABOATAO LTDA' };
  const off = avaliarCteParaBase(row, {});
  const on = avaliarCteParaBase(row, { incluirTodosTomadores: true });
  assert.equal(off.aceito, false, 'tomador fora da lista deveria ser rejeitado por padrão');
  assert.equal(off.codigo, 'tomador_nao_aceito');
  assert.equal(on.aceito, true, 'tomador fora da lista deveria entrar com incluirTodosTomadores');
});

test('tomador vazio entra apenas com incluirTodosTomadores', () => {
  const row = { tomador_servico: '' };
  assert.equal(avaliarCteParaBase(row, {}).codigo, 'tomador_vazio');
  assert.equal(avaliarCteParaBase(row, { incluirTodosTomadores: true }).aceito, true);
});

test('incluirTodosTomadores não anula exclusão de EBAZAR/CPS LOG', () => {
  const ebazar = avaliarCteParaBase(
    { tomador_servico: 'EBAZAR COM', transportadora: 'EBAZAR' },
    { incluirTodosTomadores: true },
  );
  assert.equal(ebazar.aceito, false, 'EBAZAR deve continuar excluído');
  assert.equal(ebazar.codigo, 'ebazar');

  const cpsLog = avaliarCteParaBase(
    { tomador_servico: 'QUALQUER', transportadora: 'CPS LOG TRANSPORTES' },
    { incluirTodosTomadores: true },
  );
  assert.equal(cpsLog.aceito, false, 'CPS LOG deve continuar excluído sem a própria flag');
  assert.equal(cpsLog.codigo, 'cps_log');
});
