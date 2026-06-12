import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularImpactosReajustes, calcularSerieMensalReajustes } from '../src/utils/reajustesLocal.js';

const itemBase = {
  id: '1',
  transportadoraInformada: 'TESTE',
  transportadorasRealizado: ['TESTE'],
  dataInicio: '2026-03-23',
  reajusteSolicitado: 0.057,
  reajusteAplicado: 0.05,
};

function gerarRealizados(ultimoDia = '2026-03-22') {
  const datas = ['2025-12-23', '2026-01-15', '2026-02-15', '2026-03-15', '2026-03-22'];
  const extras = ['2026-03-23', '2026-04-15', '2026-05-15'].filter((d) => d <= ultimoDia);
  return [...datas, ...extras].map((dataEmissao) => ({
    transportadora: 'TESTE',
    dataEmissao,
    valorCte: 170341.38,
    valorNF: 1770000,
    ctes: 739,
  }));
}

test('previsto usa media dos meses anteriores a data inicio', () => {
  const calc = calcularImpactosReajustes([itemBase], gerarRealizados('2026-03-22'), { mesesBaseImpacto: 3 })[0];
  assert.equal(calc.inicioImpactoBase, '2025-12-23');
  assert.equal(calc.fimImpactoBase, '2026-03-22');
  assert.ok(calc.valorFretePeriodo > 0);
  assert.ok(Math.abs(calc.impactoPrevistoRepassado - calc.valorFretePeriodo * 0.05) < 0.01);
});

test('realizado fica zerado quando base nao tem CT-es apos data inicio', () => {
  const calc = calcularImpactosReajustes([itemBase], gerarRealizados('2026-03-22'), { mesesBaseImpacto: 3 })[0];
  assert.equal(calc.fimImpactoRealizado, '');
  assert.equal(calc.ctesRealizadoReajuste, 0);
  assert.equal(calc.impactoRealizadoRepassado, 0);
});

test('realizado preenche quando existem CT-es apos data inicio', () => {
  const calc = calcularImpactosReajustes([itemBase], gerarRealizados('2026-05-15'), { mesesBaseImpacto: 3 })[0];
  assert.equal(calc.fimImpactoRealizado, '2026-05-15');
  assert.ok(calc.ctesRealizadoReajuste > 0);
  assert.ok(calc.impactoRealizadoRepassado > 0);
  assert.equal(calc.motivoRealizadoIndisponivel, '');
});

test('motivo explica quando a base termina antes da vigencia', () => {
  const calc = calcularImpactosReajustes([itemBase], gerarRealizados('2026-03-22'), { mesesBaseImpacto: 3 })[0];
  assert.match(calc.motivoRealizadoIndisponivel, /2026-03-22|22\/03\/2026/);
});

test('mes de referencia retorna o total do mes sem mensalizar', () => {
  const realizados = gerarRealizados('2026-05-15');
  const calc = calcularImpactosReajustes([itemBase], realizados, { mesesBaseImpacto: 3, mesReferencia: '2026-05' })[0];
  assert.equal(calc.mesReferenciaImpacto, '2026-05');
  assert.equal(calc.inicioImpactoRealizado, '2026-05-01');
  assert.equal(calc.fimImpactoRealizado, '2026-05-15');
  assert.equal(calc.mesesRealizadosImpacto, 1);
  assert.ok(calc.ctesRealizadoReajuste > 0);
  // Apenas o CT-e de maio (1 linha de 170341.38), sem dividir por meses equivalentes.
  assert.ok(Math.abs(calc.valorFreteRealizadoReajuste - 170341.38) < 0.01);
  assert.ok(Math.abs(calc.valorFreteRealizadoTotal - 170341.38) < 0.01);
  assert.ok(Math.abs(calc.impactoRealizadoRepassado - 170341.38 * 0.05) < 0.01);
  assert.equal(calc.motivoRealizadoIndisponivel, '');
});

test('mes de inicio conta apenas a partir da data de vigencia', () => {
  const realizados = gerarRealizados('2026-05-15');
  const calc = calcularImpactosReajustes([itemBase], realizados, { mesesBaseImpacto: 3, mesReferencia: '2026-03' })[0];
  // dataInicio 2026-03-23: ignora 2026-03-15 e 2026-03-22, considera somente 2026-03-23.
  assert.equal(calc.inicioImpactoRealizado, '2026-03-23');
  assert.equal(calc.fimImpactoRealizado, '2026-03-23');
  assert.ok(Math.abs(calc.valorFreteRealizadoReajuste - 170341.38) < 0.01);
});

test('mes de referencia anterior a data inicio zera o realizado', () => {
  const realizados = gerarRealizados('2026-05-15');
  const calc = calcularImpactosReajustes([itemBase], realizados, { mesesBaseImpacto: 3, mesReferencia: '2026-02' })[0];
  assert.equal(calc.mesReferenciaAntesInicio, true);
  assert.equal(calc.ctesRealizadoReajuste, 0);
  assert.equal(calc.valorFreteRealizadoReajuste, 0);
  assert.equal(calc.impactoRealizadoRepassado, 0);
  assert.equal(calc.fimImpactoRealizado, '');
  assert.match(calc.motivoRealizadoIndisponivel, /anterior/);
  // O previsto continua disponivel como referencia de comparacao.
  assert.ok(calc.valorFretePeriodo > 0);
  assert.ok(calc.impactoPrevistoRepassado > 0);
});

test('todo o periodo mantem o realizado mensalizado', () => {
  const realizados = gerarRealizados('2026-05-15');
  const calc = calcularImpactosReajustes([itemBase], realizados, { mesesBaseImpacto: 3 })[0];
  assert.equal(calc.mesReferenciaImpacto, '');
  assert.equal(calc.fimImpactoRealizado, '2026-05-15');
  assert.ok(calc.ctesRealizadoReajuste > 0);
  // 3 CT-es da vigencia mensalizados (~1.8 meses) => media menor que o total.
  assert.ok(calc.mesesRealizadosImpacto > 1);
  assert.ok(calc.valorFreteRealizadoReajuste < calc.valorFreteRealizadoTotal);
});

test('serie mensal cobre do menor inicioBase ate a ultima data do realizado', () => {
  const serie = calcularSerieMensalReajustes([itemBase], gerarRealizados('2026-05-15'), { mesesBaseImpacto: 3 });
  const meses = serie.meses.map((m) => m.mes);
  // inicioBase = 2025-12-23 (3 meses antes de 2026-03-23) ate 2026-05.
  assert.deepEqual(meses, ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05']);
});

test('serie mensal respeita a vigencia: meses anteriores ao inicio ficam zerados', () => {
  const serie = calcularSerieMensalReajustes([itemBase], gerarRealizados('2026-05-15'), { mesesBaseImpacto: 3 });
  const porMes = Object.fromEntries(serie.meses.map((m) => [m.mes, m]));
  // Antes da vigencia (2026-03-23) nao ha item vigente: tudo zerado.
  for (const mes of ['2025-12', '2026-01', '2026-02']) {
    assert.equal(porMes[mes].itensVigentes, 0);
    assert.equal(porMes[mes].freteRealizado, 0);
    assert.equal(porMes[mes].impactoRealizadoRepassado, 0);
    assert.equal(porMes[mes].impactoPrevistoRepassado, 0);
  }
});

test('serie mensal soma o realizado por mes civil a partir da vigencia', () => {
  const serie = calcularSerieMensalReajustes([itemBase], gerarRealizados('2026-05-15'), { mesesBaseImpacto: 3 });
  const porMes = Object.fromEntries(serie.meses.map((m) => [m.mes, m]));
  // Mes de inicio: ignora 2026-03-15 e 2026-03-22, considera somente 2026-03-23 (1 CT-e).
  assert.equal(porMes['2026-03'].itensVigentes, 1);
  assert.ok(Math.abs(porMes['2026-03'].freteRealizado - 170341.38) < 0.01);
  assert.ok(Math.abs(porMes['2026-03'].impactoRealizadoRepassado - 170341.38 * 0.05) < 0.01);
  // Meses seguintes: mes civil inteiro (1 CT-e cada).
  assert.ok(Math.abs(porMes['2026-04'].freteRealizado - 170341.38) < 0.01);
  assert.ok(Math.abs(porMes['2026-05'].freteRealizado - 170341.38) < 0.01);
});

test('serie mensal gera detalhe por reajuste x mes apenas com volume', () => {
  const serie = calcularSerieMensalReajustes([itemBase], gerarRealizados('2026-05-15'), { mesesBaseImpacto: 3 });
  const meses = serie.porItem.map((linha) => linha.mes).sort();
  // Detalhe so existe nos meses com CT-es apos a vigencia.
  assert.deepEqual(meses, ['2026-03', '2026-04', '2026-05']);
  assert.ok(serie.porItem.every((linha) => linha.transportadora === 'TESTE'));
});

test('serie mensal vazia quando nao ha realizado', () => {
  const serie = calcularSerieMensalReajustes([itemBase], [], { mesesBaseImpacto: 3 });
  assert.deepEqual(serie.meses, []);
  assert.deepEqual(serie.porItem, []);
});
