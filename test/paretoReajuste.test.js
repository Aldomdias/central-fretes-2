import test from 'node:test';
import assert from 'node:assert/strict';
import { classificarCteNaGrade, montarParetoReajuste } from '../src/utils/paretoReajuste.js';
import { montarLaudosNegociacao } from '../src/utils/laudosNegociacaoHtml.js';

const grade = {
  B2C: [
    { peso: 2, valorNF: 100, cubagem: 0.01 },
    { peso: 5, valorNF: 300, cubagem: 0.03 },
    { peso: 10, valorNF: 500, cubagem: 0.05 },
    { peso: 100, valorNF: 3000, cubagem: 0.5 },
    { peso: 999999999, valorNF: 999999999, cubagem: 999999999 },
  ],
  ATACADO: [
    { peso: 20, valorNF: 1200, cubagem: 0.1 },
    { peso: 50, valorNF: 2000, cubagem: 0.3 },
    { peso: 100, valorNF: 3000, cubagem: 0.5 },
    { peso: 999999999, valorNF: 999999999, cubagem: 999999999 },
  ],
};

test('classifica cada CT-e pela grade do proprio canal', () => {
  const b2c = classificarCteNaGrade({ canal: 'B2C', peso: 4, valorNF: 250, cubagem: 0.02 }, grade);
  const atacado = classificarCteNaGrade({ canal: 'ATACADO', peso: 40, valorNF: 1800, cubagem: 0.2 }, grade);

  assert.equal(b2c.peso, '2 a 5 kg');
  assert.equal(b2c.valorNF, '100 a 300 R$');
  assert.equal(atacado.peso, '20 a 50 kg');
  assert.equal(atacado.cubagem, '0,1 a 0,3 m³');
});

test('marcador tecnico final vira faixa aberta legivel', () => {
  const atacado = classificarCteNaGrade({ canal: 'ATACADO', peso: 700, valorNF: 25000 }, grade);
  const b2c = classificarCteNaGrade({ canal: 'B2C', peso: 150, valorNF: 6000 }, grade);

  assert.equal(atacado.peso, 'Acima de 100 kg');
  assert.equal(atacado.valorNF, 'Acima de 3.000 R$');
  assert.equal(b2c.peso, 'Acima de 100 kg');
  assert.equal(b2c.valorNF, 'Acima de 3.000 R$');
});

test('Pareto classifica antes de agrupar e nao soma pesos dos CT-es', () => {
  const pareto = montarParetoReajuste([
    { canal: 'B2C', peso: 70, valorNF: 200, cubagem: 0.02, volumes: 1 },
    { canal: 'B2C', peso: 70, valorNF: 200, cubagem: 0.02, volumes: 1 },
  ], grade);

  assert.equal(pareto.totalCtes, 2);
  assert.equal(pareto.peso.length, 1);
  assert.equal(pareto.peso[0].faixa, '10 a 100 kg');
  assert.equal(pareto.peso[0].ctes, 2);
  assert.equal(pareto.peso.some((item) => item.faixa.includes('140')), false);
});

test('laudo de reajuste traz visoes financeira, competitiva e paretos', () => {
  const laudo = montarLaudosNegociacao({
    tipoNegociacao: 'REAJUSTE_TABELA_EXISTENTE',
    ctesAnalisados: 2,
    ctesComTabelaSelecionada: 2,
    valor_atual_realizado: 200,
    valor_simulado_nova_tabela: 220,
    impacto_valor: 20,
    impacto_percentual: 10,
    impacto_mensal: 20,
    impacto_anual: 240,
    gradeFrete: grade,
    ctesDetalhes: [
      { canal: 'B2C', peso: 4, valorNF: 250, cubagem: 0.02, freteRealizado: 100, freteSelecionada: 110 },
      { canal: 'ATACADO', peso: 40, valorNF: 1800, cubagem: 0.2, freteRealizado: 100, freteSelecionada: 110 },
    ],
    analiseReajuste: {
      compararConcorrentes: true,
      impactoProprio: {},
      competitividade: {
        ganhosAtuais: 1,
        ganhosProjetados: 2,
        volumesAtuais: 2,
        volumesProjetados: 3,
        rotasGanhas: 1,
        rotasPerdidas: 0,
        rotasMantidas: 1,
      },
    },
  }).executivo;

  assert.equal(laudo.indicadores.tipoLaudo, 'REAJUSTE');
  assert.equal(laudo.visaoFinanceira.freteMedioAtual, 100);
  assert.equal(laudo.visaoCompetitiva.variacaoCtes, 1);
  assert.equal(laudo.pareto.peso.length, 2);
});
