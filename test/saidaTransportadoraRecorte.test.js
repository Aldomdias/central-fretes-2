import test from 'node:test';
import assert from 'node:assert/strict';
import { intervaloEmissao, janelasEmissao, pesoComoSimuladorRealizado } from '../src/utils/saidaTransportadoraRecorte.js';

test('competência vira o mês inteiro por data de emissão (fim exclusivo)', () => {
  assert.deepEqual(intervaloEmissao({ competencia: '2026-10' }), { inicio: '2026-10-01', fimExclusivo: '2026-11-01' });
  assert.deepEqual(intervaloEmissao({ competencia: '2026-12' }), { inicio: '2026-12-01', fimExclusivo: '2027-01-01' });
});

test('período tem prioridade e inclui o último dia inteiro', () => {
  assert.deepEqual(intervaloEmissao({ competencia: '2026-10', dataInicio: '2026-09-05', dataFim: '2026-09-30' }), { inicio: '2026-09-05', fimExclusivo: '2026-10-01' });
  assert.deepEqual(intervaloEmissao({ dataFim: '2026-06-31' }), { inicio: '', fimExclusivo: '2026-07-01' });
});

test('janelas diárias cobrem o intervalo sem buracos', () => {
  const j = janelasEmissao({ inicio: '2026-10-01', fimExclusivo: '2026-11-01' }, 1);
  assert.equal(j.length, 31);
  assert.equal(j[0].inicio, '2026-10-01');
  assert.equal(j.at(-1).fimExclusivo, '2026-11-01');
});

test('peso igual ao simulador: peso do CT-e, declarado só como fallback, sem cubado', () => {
  assert.equal(pesoComoSimuladorRealizado({ peso: 12, peso_declarado: 30, peso_cubado: 80 }), 12);
  assert.equal(pesoComoSimuladorRealizado({ peso: 0, peso_declarado: 30 }), 30);
});
