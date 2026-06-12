import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gerarDadosEmailReajuste,
  gerarEmlEmailReajuste,
  gerarHtmlEmailReajuste,
  nomeArquivoEmlReajuste,
  nomeArquivoEmailReajuste,
  obterPeriodoPadraoEmailReajuste,
} from '../src/services/reajusteEmailService.js';

const serie = {
  meses: [
    { mes: '2026-03', impactoRealizadoSolicitado: 1000, impactoRealizadoRepassado: 700 },
    { mes: '2026-04', impactoRealizadoSolicitado: 2000, impactoRealizadoRepassado: 1500 },
    { mes: '2026-05', impactoRealizadoSolicitado: 3000, impactoRealizadoRepassado: 1800 },
    { mes: '2026-06', impactoRealizadoSolicitado: 5000, impactoRealizadoRepassado: 4000 },
  ],
  porItem: [
    { mes: '2026-03', transportadora: 'ALFA', impactoRealizadoSolicitado: 700, impactoRealizadoRepassado: 500 },
    { mes: '2026-03', transportadora: 'BETA', impactoRealizadoSolicitado: 300, impactoRealizadoRepassado: 200 },
    { mes: '2026-04', transportadora: 'ALFA', impactoRealizadoSolicitado: 1200, impactoRealizadoRepassado: 1000 },
    { mes: '2026-04', transportadora: 'BETA', impactoRealizadoSolicitado: 800, impactoRealizadoRepassado: 500 },
    { mes: '2026-05', transportadora: 'ALFA', impactoRealizadoSolicitado: 1600, impactoRealizadoRepassado: 1000 },
    { mes: '2026-05', transportadora: 'BETA', impactoRealizadoSolicitado: 1400, impactoRealizadoRepassado: 800 },
  ],
};

test('periodo padrao termina no ultimo mes fechado', () => {
  const periodo = obterPeriodoPadraoEmailReajuste(serie, new Date('2026-06-12T12:00:00'));
  assert.deepEqual(periodo, {
    mesInicial: '2026-03',
    mesFinal: '2026-05',
    somenteMesesFechados: true,
  });
});

test('periodo padrao ignora meses anteriores sem impacto', () => {
  const serieComBaseAnterior = {
    meses: [
      { mes: '2025-12', impactoRealizadoSolicitado: 0, impactoRealizadoRepassado: 0 },
      { mes: '2026-01', impactoRealizadoSolicitado: 0, impactoRealizadoRepassado: 0 },
      { mes: '2026-02', impactoRealizadoSolicitado: 0, impactoRealizadoRepassado: 0 },
      ...serie.meses,
    ],
  };
  const periodo = obterPeriodoPadraoEmailReajuste(
    serieComBaseAnterior,
    new Date('2026-06-12T12:00:00'),
  );
  assert.equal(periodo.mesInicial, '2026-03');
  assert.equal(periodo.mesFinal, '2026-05');
});

test('dados somam solicitado, repassado e segurado no periodo', () => {
  const dados = gerarDadosEmailReajuste(serie, {
    mesInicial: '2026-03',
    mesFinal: '2026-05',
    somenteMesesFechados: true,
  }, new Date('2026-06-12T12:00:00'));

  assert.equal(dados.totais.solicitado, 6000);
  assert.equal(dados.totais.repassado, 4000);
  assert.equal(dados.totais.segurado, 2000);
  assert.ok(Math.abs(dados.totais.percentualSegurado - (1 / 3)) < 0.0001);
  assert.equal(dados.melhorMes.mes, '2026-05');
});

test('somente meses fechados exclui o mes atual', () => {
  const dados = gerarDadosEmailReajuste(serie, {
    mesInicial: '2026-03',
    mesFinal: '2026-06',
    somenteMesesFechados: true,
  }, new Date('2026-06-12T12:00:00'));

  assert.equal(dados.mesFinal, '2026-05');
  assert.equal(dados.meses.length, 3);
});

test('transportadoras sao agregadas e classificadas por impacto', () => {
  const dados = gerarDadosEmailReajuste(serie, {
    mesInicial: '2026-03',
    mesFinal: '2026-05',
    somenteMesesFechados: false,
  }, new Date('2026-06-12T12:00:00'));

  assert.equal(dados.transportadoras[0].transportadora, 'ALFA');
  assert.equal(dados.transportadoras[0].repassado, 2500);
  assert.equal(dados.reducoes[0].segurado, 1000);
  assert.deepEqual(
    dados.reducoes.map((linha) => linha.transportadora).sort(),
    ['ALFA', 'BETA'],
  );
  assert.match(dados.transportadoras[0].curva, /^[ABC]$/);
});

test('html final usa tabelas e estilos inline sem javascript', () => {
  const dados = gerarDadosEmailReajuste(serie, {
    mesInicial: '2026-03',
    mesFinal: '2026-05',
  }, new Date('2026-06-12T12:00:00'));
  const html = gerarHtmlEmailReajuste(dados);

  assert.match(html, /<table role="presentation"/);
  assert.match(html, /Solicitado/);
  assert.match(html, /ALFA/);
  assert.match(html, /Leitura executiva/);
  assert.doesNotMatch(html, /<script/i);
  assert.equal(nomeArquivoEmailReajuste(dados), 'email-impacto-reajustes-ate-maio-2026.html');
});

test('eml inclui alternativas texto e html para abrir no Outlook', () => {
  const dados = gerarDadosEmailReajuste(serie, {
    mesInicial: '2026-03',
    mesFinal: '2026-05',
  }, new Date('2026-06-12T12:00:00'));
  const html = gerarHtmlEmailReajuste(dados);
  const eml = gerarEmlEmailReajuste(dados, html);

  assert.match(eml, /X-Unsent: 1/);
  assert.match(eml, /Content-Type: multipart\/alternative/);
  assert.match(eml, /Content-Type: text\/plain; charset="utf-8"/);
  assert.match(eml, /Content-Type: text\/html; charset="utf-8"/);
  assert.match(eml, /Content-Transfer-Encoding: base64/);
  assert.equal(nomeArquivoEmlReajuste(dados), 'email-impacto-reajustes-outlook-ate-maio-2026.eml');
});
