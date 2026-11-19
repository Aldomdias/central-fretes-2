import test from 'node:test';
import assert from 'node:assert/strict';
import { casarIdsOms } from '../src/utils/omsIdFaturas.js';

const ID1 = '6566f0a1b2c3d4e5f6a7b8c9';
const ID2 = '6566f0a1b2c3d4e5f6a7b8d0';
const banco = (extra = {}) => ({ id: 'f1', numero_fatura: '100', serie_fatura: '', transportadora: 'TRANSP A', cnpj_transportadora: '12345678000190', oms_invoice_id: null, ...extra });
const linha = (extra = {}) => ({ 'Numero Fatura': '100', 'Serie Fatura': '0', Transportadora: 'Transp A', 'CNPJ Transportadora': '12.345.678/0001-90', Id: ID1, ...extra });

test('casa por CNPJ (serie vazia = 0) e grava so o Id', () => {
  const r = casarIdsOms([linha()], [banco()]);
  assert.deepEqual(r.gravar, [{ id: 'f1', omsId: ID1, numero: '100' }]);
  assert.equal(r.contagem.gravar, 1);
});

test('nome diferente do arquivo casa pelo CNPJ; sem CNPJ cai no nome', () => {
  assert.equal(casarIdsOms([linha({ Transportadora: 'OUTRO NOME' })], [banco()]).gravar.length, 1);
  assert.equal(casarIdsOms([linha({ 'CNPJ Transportadora': '' })], [banco({ cnpj_transportadora: '' })]).gravar.length, 1);
});

test('nao cria nem grava na duvida: nao encontrada, sem Id, ambigua, Id diferente, ja tinha', () => {
  assert.equal(casarIdsOms([linha()], []).contagem.naoEncontrada, 1);
  assert.equal(casarIdsOms([linha({ Id: '' })], [banco()]).contagem.semId, 1);
  const amb = casarIdsOms([linha()], [banco(), banco({ id: 'f2' })]);
  assert.deepEqual([amb.contagem.ambigua, amb.gravar.length], [1, 0]);
  const dif = casarIdsOms([linha()], [banco({ oms_invoice_id: ID2 })]);
  assert.deepEqual([dif.contagem.idDiferente, dif.gravar.length], [1, 0]);
  const ja = casarIdsOms([linha()], [banco({ oms_invoice_id: ID1.toUpperCase() })]);
  assert.deepEqual([ja.contagem.jaTinha, ja.gravar.length], [1, 0]);
});

test('Id repetido em faturas diferentes nao grava nenhuma; linha repetida da mesma fatura grava uma vez', () => {
  const dois = casarIdsOms([linha(), linha({ 'Numero Fatura': '200' })], [banco(), banco({ id: 'f2', numero_fatura: '200' })]);
  assert.deepEqual([dois.contagem.idRepetido, dois.gravar.length], [2, 0]);
  const rep = casarIdsOms([linha(), linha()], [banco()]);
  assert.equal(rep.gravar.length, 1);
});
