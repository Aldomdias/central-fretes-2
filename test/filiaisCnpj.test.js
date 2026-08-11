import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buscarEmpresaPorCnpj,
  cnpjPertenceEmpresaCadastrada,
} from '../src/utils/filiaisCnpj.js';
import { avaliarCteParaBase } from '../src/services/cteBasePolicy.js';

test('reconhece qualquer filial da mesma empresa pela raiz', () => {
    assert.deepEqual(buscarEmpresaPorCnpj('10.158.356/9999-00'), {
      codigo: 'CPX',
      nome: 'CPX / GP',
      raizCnpj: '10158356',
    });
});

test('nao vincula CNPJ de raiz desconhecida', () => {
  assert.equal(cnpjPertenceEmpresaCadastrada('12.345.678/0001-90'), false);
});

test('aceita o tomador pelo CNPJ raiz mesmo quando o nome varia', () => {
  const resultado = avaliarCteParaBase({
    tomador_servico: 'Nome importado diferente',
    cnpj_tomador: '46.378.127/4321-00',
  });

  assert.equal(resultado.aceito, true);
  assert.equal(resultado.empresaTomadora?.codigo, 'GP');
});
