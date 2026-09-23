import test from 'node:test';
import assert from 'node:assert/strict';
import { testarTransportadoraRapido } from '../src/utils/testeRapidoTransportadora.js';

function transportadoraValida() {
  return {
    nome: 'Transportadora Teste',
    origens: [{
      cidade: 'Itajai',
      canal: 'ATACADO',
      generalidades: { tipoCalculo: 'PERCENTUAL' },
      rotas: [{ nomeRota: 'SAO PAULO', ibgeDestino: '3550308', prazoEntregaDias: 2 }],
      cotacoes: [{ rota: 'SAO PAULO', pesoMin: 0, pesoMax: 999999, freteMinimo: 50 }],
      taxasEspeciais: [],
    }],
  };
}

test('pré-teste executa cenários representativos sem alterar a tabela', () => {
  const transportadora = transportadoraValida();
  const resultado = testarTransportadoraRapido(transportadora);
  assert.equal(resultado.totais.origens, 1);
  assert.equal(resultado.simulacoes.executadas, 3);
  assert.equal(resultado.simulacoes.sucesso, 3);
  assert.equal(resultado.status, 'aprovada');
});

test('pré-teste bloqueia origem com volume anormal de cotações', () => {
  const transportadora = transportadoraValida();
  transportadora.origens[0].cotacoes = Array.from({ length: 50001 }, (_, i) => ({
    rota: 'SAO PAULO', pesoMin: i, pesoMax: i + 1, freteMinimo: 50,
  }));
  const resultado = testarTransportadoraRapido(transportadora);
  assert.equal(resultado.status, 'bloqueada');
  assert.ok(resultado.erros.some((erro) => erro.includes('volume anormal')));
  assert.equal(resultado.simulacoes.executadas, 3);
});

