import test from 'node:test';
import assert from 'node:assert/strict';
import { cnpjPreenchidoValido, criarIndicePorRaizCnpj, formatarCnpj, obterRaizCnpj, raizCnpjValida, resolverPorCnpjRaiz } from '../src/utils/cnpj.js';

test('formata o CNPJ e extrai a raiz usada nos vínculos', () => {
  assert.equal(formatarCnpj('12345678000190'), '12.345.678/0001-90');
  assert.equal(obterRaizCnpj('12.345.678/0001-90'), '12345678');
  assert.equal(raizCnpjValida('12.345.678'), true);
});

test('considera obrigatório o documento completo de 14 dígitos', () => {
  assert.equal(cnpjPreenchidoValido('12.345.678/0001-90'), true);
  assert.equal(cnpjPreenchidoValido('12345678'), false);
});

test('resolve transportadora por raiz do CNPJ antes do nome', () => {
  const transportadoras = [
    { id: 'a', nome: 'Nome diferente', cnpj: '12.345.678/0001-90' },
    { id: 'b', nome: 'Outra', cnpj: '98.765.432/0001-10' },
  ];
  const indice = criarIndicePorRaizCnpj(transportadoras);
  assert.equal(resolverPorCnpjRaiz('12.345.678/9999-00', indice)?.id, 'a');
});

test('não escolhe automaticamente quando a mesma raiz está duplicada', () => {
  const indice = criarIndicePorRaizCnpj([
    { id: 'a', cnpj: '12.345.678/0001-90' },
    { id: 'b', cnpj: '12.345.678/0002-70' },
  ]);
  assert.equal(resolverPorCnpjRaiz('12.345.678/9999-00', indice), null);
});
