import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buscarCargaPorDistOuCte,
  buscarViagensUnicasPorDistOuCte,
} from '../src/utils/lotacaoFluxoCargas.js';

test('busca nao perde viagens depois de muitas linhas da mesma DIST', () => {
  const repetidas = Array.from({ length: 45 }, (_, index) => ({
    id: `repetida-${index}`,
    dist: 'NAC-202602-1309',
    cteRaw: `CTE-${index}`,
    cteKeys: [`CTE-${index}`],
    referencia: 'HUB-BARUERI',
    importadoEm: '2026-06-15T16:00:00.000Z',
  }));
  const procurada = {
    id: 'procurada',
    dist: 'NAC-190001-1258',
    cteRaw: '42260427736323000102570010000681461328898353',
    cteKeys: ['42260427736323000102570010000681461328898353'],
    referencia: 'HUB-CONTAGEM',
    importadoEm: '2026-06-15T16:56:00.000Z',
  };

  const resultados = buscarCargaPorDistOuCte([...repetidas, procurada], 'NAC');

  assert.equal(resultados.length, 46);
  assert.ok(resultados.some((item) => item.id === 'procurada'));

  const viagens = buscarViagensUnicasPorDistOuCte([...repetidas, procurada], 'NAC');
  assert.equal(viagens.length, 2);
  assert.ok(viagens.some((item) => item.id === 'procurada'));
});

test('busca localiza viagem por HUB ou referencia', () => {
  const cargas = [{
    id: 'hub',
    dist: 'NAC-202606-9999',
    referencia: 'HUB EXTREMA 03',
    operacao: 'TRANSFERENCIA NOTURNA',
  }];

  assert.equal(buscarCargaPorDistOuCte(cargas, 'extrema 03')[0]?.id, 'hub');
  assert.equal(buscarCargaPorDistOuCte(cargas, 'noturna')[0]?.id, 'hub');
});
