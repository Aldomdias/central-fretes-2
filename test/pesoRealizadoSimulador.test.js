import test from 'node:test';
import assert from 'node:assert/strict';
import { resolverPesoCteRealizado } from '../src/utils/pesoRealizadoSimulador.js';

test('usar peso do CT-e prioriza peso sobre peso declarado/bruto da NF', () => {
  assert.equal(resolverPesoCteRealizado(
    { peso: 29.6, pesoDeclarado: 44.8 },
    { ignorarCubagem: true },
  ), 29.6);
});

test('peso declarado vira fallback somente quando o CT-e não possui peso', () => {
  assert.equal(resolverPesoCteRealizado(
    { peso: 0, pesoDeclarado: 44.8 },
    { ignorarCubagem: true },
  ), 44.8);
});

test('contingência é aplicada sobre o peso do CT-e', () => {
  assert.equal(resolverPesoCteRealizado(
    { peso: '20,0', pesoDeclarado: 50 },
    { ignorarCubagem: true, percentualContingenciaPeso: 10 },
  ), 22);
});

