import test from 'node:test';
import assert from 'node:assert/strict';
import { gerarRecomendacoes, formatarBytes, formatarSegundos } from '../src/utils/consumoRecomendacoes.js';

const MB = 1048576;

test('auditoria com muitos CT-es gera alerta de dividir em lotes', () => {
  const recs = gerarRecomendacoes({
    totais: { bytes_recebidos: 100 * MB },
    processos_tipo: [{ tipo: 'AUDITORIA_CTE', execucoes: 4, itens: 40000, itens_max: 15000, ms_total: 4 * 1800000, ms_medio: 1800000, ms_max: 2400000, heap_mb_pico: 2600, falhas: 0 }],
  });
  const lote = recs.find((r) => r.area === 'Processos');
  assert.equal(lote.nivel, 'critico');
  assert.match(lote.acao, /transportadora/);
  assert.ok(recs.some((r) => r.area === 'Memória (RAM)' && r.nivel === 'critico'));
});

test('tabela que concentra download e timeouts aparece', () => {
  const recs = gerarRecomendacoes({
    totais: { bytes_recebidos: 1000 * MB },
    tabelas: [{ tabela: 'realizado_local_ctes', bytes_recebidos: 700 * MB, requisicoes: 300, ms_rede: 900000, timeouts: 25, usuario_top: 'Fulano', pagina_top: 'simulador' }],
  });
  assert.ok(recs.some((r) => r.titulo.includes('70%') && r.nivel === 'critico'));
  assert.ok(recs.some((r) => r.titulo.includes('25 timeouts')));
});

test('painel vazio não gera nada e formatadores', () => {
  assert.deepEqual(gerarRecomendacoes({}), []);
  assert.equal(formatarBytes(1536 * MB), '1,5 GB');
  assert.equal(formatarSegundos(3720), '1h 02min');
});
