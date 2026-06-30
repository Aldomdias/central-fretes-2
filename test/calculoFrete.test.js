import test from 'node:test';
import assert from 'node:assert/strict';

import { simularPorTransportadora } from '../src/utils/calculoFrete.js';

function tabela(nome, canal, freteMinimo) {
  return {
    nome,
    origens: [
      {
        cidade: 'Itajai',
        canal,
        generalidades: { tipoCalculo: 'PERCENTUAL' },
        rotas: [{ nomeRota: 'Guarulhos/SP', ibgeOrigem: '4208203', ibgeDestino: '3518800', prazoEntregaDias: nome === 'WM' ? 3 : 4 }],
        cotacoes: [{ rota: 'Guarulhos/SP', pesoMin: 0, pesoMax: 999999, freteMinimo }],
        taxasEspeciais: [],
      },
    ],
  };
}

test('origem AMBOS rankeia junto com B2C na simulacao por transportadora', () => {
  const resultado = simularPorTransportadora({
    transportadoras: [
      tabela('BRASIL WEB', 'B2C', 61.35),
      tabela('WM', 'AMBOS', 68.18),
    ],
    nomeTransportadora: 'WM',
    canal: 'B2C',
    origem: 'Itajai',
    destinoCodigos: ['3518800'],
    peso: 10,
    valorNF: 1200,
    cidadePorIbge: new Map([['3518800', 'Guarulhos/SP']]),
  });

  assert.equal(resultado.length, 1);
  assert.equal(resultado[0].transportadora, 'WM');
  assert.equal(resultado[0].ranking, 2);
  assert.equal(resultado[0].perdeuPara, 'BRASIL WEB');
  assert.equal(resultado[0].liderTransportadora, 'BRASIL WEB');
  assert.equal(resultado[0].canal, 'B2C');
});

test('ranking nao duplica a mesma transportadora na mesma origem destino e faixa', () => {
  const totalExpress = tabela('TOTAL EXPRESS', 'B2C', 70);
  totalExpress.origens[0].rotas.push({ nomeRota: 'Guarulhos/SP', ibgeOrigem: '4208203', ibgeDestino: '3518800', prazoEntregaDias: 4 });

  const resultado = simularPorTransportadora({
    transportadoras: [
      tabela('BRASIL WEB', 'B2C', 61.35),
      totalExpress,
    ],
    nomeTransportadora: 'TOTAL EXPRESS',
    canal: 'B2C',
    origem: 'Itajai',
    destinoCodigos: ['3518800'],
    peso: 10,
    valorNF: 1200,
    cidadePorIbge: new Map([['3518800', 'Guarulhos/SP']]),
  });

  assert.equal(resultado.length, 1);
  assert.equal(resultado[0].transportadora, 'TOTAL EXPRESS');
  assert.equal(resultado[0].ranking, 2);
  assert.equal(resultado[0].perdeuPara, 'BRASIL WEB');
});
