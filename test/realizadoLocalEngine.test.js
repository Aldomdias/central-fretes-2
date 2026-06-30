import test from 'node:test';
import assert from 'node:assert/strict';

import {
  construirEscopoTransportadoraSimulada,
  construirIndiceFretesPorRota,
} from '../src/utils/realizadoLocalEngine.js';

const MUNICIPIOS = [
  { ibge: '4208203', cidade: 'Itajai', uf: 'SC' },
  { ibge: '3550308', cidade: 'Sao Paulo', uf: 'SP' },
];

const TRANSPORTADORAS = [
  {
    nome: 'Teste Transportes',
    origens: [
      {
        cidade: 'Itajai',
        canal: 'ATACADO',
        rotas: [
          {
            nomeRota: 'Sao Paulo',
            ibgeDestino: '3550308',
            prazoEntregaDias: 2,
          },
        ],
      },
    ],
  },
];

test('indice do realizado resolve IBGE de origem pela cidade quando a rota so traz destino', () => {
  const { index, stats } = construirIndiceFretesPorRota(TRANSPORTADORAS, MUNICIPIOS);

  assert.equal(stats.rotasComIbge, 1);
  assert.equal(stats.rotasSemIbge, 0);
  assert.equal(index.has('ATACADO|4208203-3550308'), true);
});

test('escopo da transportadora simulada usa o mesmo fallback de IBGE da origem', () => {
  const escopo = construirEscopoTransportadoraSimulada({
    transportadoras: TRANSPORTADORAS,
    nomeTransportadora: 'Teste Transportes',
    municipios: MUNICIPIOS,
  });

  assert.equal(escopo.totalRotas, 1);
  assert.equal(escopo.rotasSemIbge, 0);
  assert.equal(escopo.routeKeys.has('ATACADO|4208203-3550308'), true);
});

test('escopo da transportadora simulada expande origem AMBOS para B2C e ATACADO', () => {
  const escopo = construirEscopoTransportadoraSimulada({
    transportadoras: [
      {
        nome: 'Ambos Transportes',
        origens: [
          {
            cidade: 'Itajai',
            canal: 'AMBOS',
            rotas: [{ nomeRota: 'Sao Paulo', ibgeDestino: '3550308' }],
          },
        ],
      },
    ],
    nomeTransportadora: 'Ambos Transportes',
    municipios: MUNICIPIOS,
  });

  assert.equal(escopo.routeKeys.has('ATACADO|4208203-3550308'), true);
  assert.equal(escopo.routeKeys.has('B2C|4208203-3550308'), true);
  assert.deepEqual(escopo.canais, ['ATACADO', 'B2C']);
});
