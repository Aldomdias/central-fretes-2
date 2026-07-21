import test from 'node:test';
import assert from 'node:assert/strict';

import { analisarTransportadoraPorGrade, simularPorTransportadora, simularSimples } from '../src/utils/calculoFrete.js';

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

test('analise de transportadora rankeia AMBOS junto com concorrentes do canal', () => {
  const resultado = analisarTransportadoraPorGrade({
    transportadoras: [
      tabela('BRASIL WEB', 'B2C', 61.35),
      tabela('WM', 'AMBOS', 68.18),
    ],
    nomeTransportadora: 'WM',
    canal: 'B2C',
    origem: 'Itajai',
    grade: [{ peso: 10, valorNF: 1200 }],
    cidadePorIbge: new Map([['3518800', 'Guarulhos/SP']]),
  });

  assert.equal(resultado.rotasAvaliadas, 1);
  assert.equal(resultado.vitorias, 0);
  assert.equal(resultado.aderencia, 0);
  assert.equal(resultado.detalhes[0].ranking, 2);
  assert.equal(resultado.detalhes[0].perdeuPara, 'BRASIL WEB');
  assert.equal(resultado.detalhes[0].canal, 'B2C');
});

test('taxa coringa por peso da Taxa Especial aparece nos detalhes da Simulacao Simples', () => {
  const transportadora = tabela('WM', 'ATACADO', 0);
  transportadora.origens[0].taxasEspeciais = [
    {
      ibgeDestino: '3518800',
      taxasExtras: [{ nome: 'teste', valorPorPeso: 1, pesoBase: 100 }],
    },
  ];

  const resultado = simularSimples({
    transportadoras: [transportadora],
    origem: 'Itajai',
    canal: 'ATACADO',
    peso: 150,
    valorNF: 1200,
    destinoCodigo: '3518800',
    cidadePorIbge: new Map([['3518800', 'Guarulhos/SP']]),
  });

  assert.equal(resultado.length, 1);
  const coringas = resultado[0].detalhes.taxas.taxasExtrasDetalhes;
  assert.equal(coringas.length, 1);
  assert.equal(coringas[0].nome, 'teste');
  // 150 kg / 100 kg base = 2 fracoes arredondadas para cima x R$ 1,00.
  assert.equal(coringas[0].valor, 2);
  assert.equal(resultado[0].detalhes.taxas.taxaExtra, 2);
  assert.ok(resultado[0].detalhes.taxas.totalTaxas >= 2);
});

test('taxa coringa e reconhecida mesmo com IBGE salvo em formato diferente do IBGE da rota', () => {
  const transportadora = tabela('WM', 'ATACADO', 0);
  // IBGE cadastrado na Taxa Especial com espacos e digito extra, como pode
  // acontecer no campo de texto livre da tela de Transportadoras — deve
  // casar do mesmo jeito com a rota (3518800), pois ambos sao normalizados
  // para 7 digitos antes da comparacao.
  transportadora.origens[0].taxasEspeciais = [
    {
      ibgeDestino: ' 3518800-9 ',
      taxasExtras: [{ nome: 'coringa-formatado', valor: 10 }],
    },
  ];

  const resultado = simularSimples({
    transportadoras: [transportadora],
    origem: 'Itajai',
    canal: 'ATACADO',
    peso: 10,
    valorNF: 1000,
    destinoCodigo: '3518800',
    cidadePorIbge: new Map([['3518800', 'Guarulhos/SP']]),
  });

  assert.equal(resultado.length, 1);
  const coringas = resultado[0].detalhes.taxas.taxasExtrasDetalhes;
  assert.equal(coringas.length, 1);
  assert.equal(coringas[0].nome, 'coringa-formatado');
  assert.equal(coringas[0].valor, 10);
});

test('TDR nao entra no total de taxas mesmo se vier preenchido na taxa especial', () => {
  const transportadora = tabela('WM', 'ATACADO', 0);
  transportadora.origens[0].taxasEspeciais = [{ ibgeDestino: '3518800', tdr: 99 }];

  const resultado = simularSimples({
    transportadoras: [transportadora],
    origem: 'Itajai',
    canal: 'ATACADO',
    peso: 10,
    valorNF: 1000,
    destinoCodigo: '3518800',
    cidadePorIbge: new Map([['3518800', 'Guarulhos/SP']]),
  });

  assert.equal(resultado.length, 1);
  assert.equal(resultado[0].detalhes.taxas.tdr, 0);
});
