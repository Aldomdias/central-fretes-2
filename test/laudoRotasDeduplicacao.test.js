import test from 'node:test';
import assert from 'node:assert/strict';
import { montarLaudosRodadasNegociacao } from '../src/utils/laudosRodadasNegociacaoHtml.js';

test('rotas criticas escolhem uma fonte de detalhes sem duplicar os mesmos CT-es', () => {
  const rotaCompleta = {
    origem: 'Contagem',
    destino: 'Belo Horizonte',
    ufDestino: 'MG',
    rota: 'Contagem > Belo Horizonte',
    ctesGanhos: 522,
    ctesPerdidos: 675,
    freteRealizado: 60000,
    freteRealizadoGanhos: 30000,
    percentualReducaoNecessaria: 19.12,
  };
  const mesmaRotaResumida = {
    origem: 'Contagem',
    destino: 'Belo Horizonte',
    ufDestino: 'MG',
    rota: 'Contagem > Belo Horizonte',
    ctesGanhos: 200,
    ctesPerdidos: 369,
    freteRealizado: 30000,
    freteRealizadoGanhos: 10000,
    percentualReducaoNecessaria: 19.12,
  };
  const laudos = montarLaudosRodadasNegociacao({
    transportadora: 'Camilo',
    origem: 'Contagem',
    resumo_simulacao: {
      historico_rodadas: [{
        tipo_registro: 'SIMULACAO',
        rodada: 1,
        criado_em: '2026-05-30T12:00:00.000Z',
        indicadores: {
          ctes_analisados: 7303,
          ctes_com_tabela: 1197,
          ctes_ganhos: 522,
          ctes_perdidos: 675,
        },
        resumo: {
          ctesDetalhes: [rotaCompleta],
          rotas: [mesmaRotaResumida],
        },
      }],
    },
  });

  const rota = laudos.transportador.ondeAjustar[0];
  assert.equal(rota.ctesGanhos + rota.ctesPerdidos, 1197);
  assert.notEqual(rota.ctesGanhos + rota.ctesPerdidos, 1766);
});
