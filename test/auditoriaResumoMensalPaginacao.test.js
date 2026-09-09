import test from 'node:test';
import assert from 'node:assert/strict';
import { carregarResultadosSalvosCompetenciaPaginados } from '../src/utils/auditoriaResumoMensalPaginacao.js';

function criarSupabasePaginado(linhas) {
  const faixas = [];
  const cliente = {
    from(tabela) {
      assert.equal(tabela, 'auditoria_cte_resultados');
      const query = {
        select() { return query; },
        eq(campo, valor) {
          assert.equal(campo, 'competencia');
          assert.equal(valor, '2026-08');
          return query;
        },
        order(campo) {
          assert.equal(campo, 'id');
          return query;
        },
        range(inicio, fim) {
          faixas.push([inicio, fim]);
          return Promise.resolve({ data: linhas.slice(inicio, fim + 1), error: null });
        },
      };
      return query;
    },
  };
  return { cliente, faixas };
}

test('releitura do resumo mensal percorre todos os CT-es além da primeira página', async () => {
  const linhas = Array.from({ length: 2_305 }, (_, i) => ({ id: i + 1 }));
  const { cliente, faixas } = criarSupabasePaginado(linhas);

  const resposta = await carregarResultadosSalvosCompetenciaPaginados(cliente, '2026-08');

  assert.equal(resposta.error, null);
  assert.equal(resposta.data.length, 2_305);
  assert.deepEqual(faixas, [[0, 999], [1000, 1999], [2000, 2999]]);
});
