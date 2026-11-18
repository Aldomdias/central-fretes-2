import test from 'node:test';
import assert from 'node:assert/strict';
import { escolherValorTabela, mesmaTransportadora, precisaValorDeTabela } from '../api/_freteTabelaFallback.mjs';

const tabela = (rotas, extra = {}) => ({ id: 't1', nome: 'COOTRAVALE', vigencia_inicio: null, vigencia_fim: null, rotas, ...extra });
const rota = (extra = {}) => ({ id: 'r1', transportadora: 'COOTRAVALE', origem: 'Azurra Matriz', destino: 'São Luís', uf_origem: 'SP', uf_destino: 'MA', tipo_veiculo: 'CARRETA', valor: 15000, pedagio: 500, target: 16000, ...extra });
const carga = (extra = {}) => ({ transportadora: 'COOPERATIVA DOS TRANSPORTADORES DO VALE - COOTRAVALE', origem: 'AZURRA MATRIZ', destino: 'SAO LUIS', tipo_veiculo: 'CARRETA', coleta_planejada: '2026-08-28T10:00:00Z', ...extra });

test('nome da transportadora casa por contencao', () => {
  assert.equal(mesmaTransportadora('COOPERATIVA DOS TRANSPORTADORES DO VALE - COOTRAVALE', 'Cootravale'), true);
  assert.equal(mesmaTransportadora('ABC', 'ABC'), true);
  assert.equal(mesmaTransportadora('TAM', 'TRANSPORTES TAMOIO'), false);
});

test('acha o valor da rota ignorando acento e caixa', () => {
  const r = escolherValorTabela(carga(), [tabela([rota()])]);
  assert.equal(r.valor, 15000);
  assert.equal(r.pedagio, 500);
});

test('sem rota ou fora da vigencia nao devolve nada', () => {
  assert.equal(escolherValorTabela(carga({ destino: 'RECIFE' }), [tabela([rota()])]), null);
  assert.equal(escolherValorTabela(carga(), [tabela([rota()], { vigencia_inicio: '2026-09-01' })]), null);
});

test('sem tipo de veiculo e valores diferentes nao chuta', () => {
  const rotas = [rota({ id: 'a', valor: 15000 }), rota({ id: 'b', tipo_veiculo: 'TRUCK', valor: 9000 })];
  assert.equal(escolherValorTabela(carga({ tipo_veiculo: '' }), [tabela(rotas)]), null);
  assert.equal(escolherValorTabela(carga({ tipo_veiculo: 'TRUCK' }), [tabela(rotas)]).valor, 9000);
});

test('so preenche carga sem valor e nao alocada pela Operacao', () => {
  assert.equal(precisaValorDeTabela({ transportadora: 'X', frete_transp: 0 }), true);
  assert.equal(precisaValorDeTabela({ transportadora: 'X', frete_transp: 100 }), false);
  assert.equal(precisaValorDeTabela({ transportadora: 'X', frete_transp: 0, alocado_em: '2026-11-01' }), false);
  assert.equal(precisaValorDeTabela({ transportadora: '', frete_transp: 0 }), false);
  assert.equal(precisaValorDeTabela({ transportadora: 'X', frete_transp: 15000, valor_fonte: 'TABELA_AUTO' }), true);
});
