import test from 'node:test';
import assert from 'node:assert/strict';
import { planejarAjustesParaAderencia, gerarHtmlLaudoProjecaoAderencia, gerarWorkbookTabelaSugerida } from '../src/utils/tabelaSugeridaAderencia.js';

const resultado = {
  ctesAnalisados: 100, ctesComTabelaSelecionada: 100, ctesGanhariaSelecionada: 50, ctesPerdidosSelecionada: 50,
  rotasCotacao: [
    { nome: 'Rota A', faixaPeso: '0-10', ctes: 30, ctesGanharia: 10, ctesPerderia: 20, reducaoMediaNecessaria: 10 },
    { nome: 'Rota B', faixaPeso: '0-10', ctes: 40, ctesGanharia: 20, ctesPerderia: 20, reducaoMediaNecessaria: 5 },
    { nome: 'Rota C', faixaPeso: '0-10', ctes: 30, ctesGanharia: 20, ctesPerderia: 10, reducaoMediaNecessaria: 20 },
  ],
  ctesAjusteRotaExcel: [
    ...Array.from({ length: 50 }, (_, i) => ({ rota: 'Rota Atual', faixaPeso: '0-10', cte: `G${i}`, tabelaRpa: 90, freteCobrado: 100 })),
    ...Array.from({ length: 20 }, (_, i) => ({ rota: 'Rota A', faixaPeso: '0-10', cte: `A${i}`, tabelaRpa: 110, freteCobrado: 100 })),
    ...Array.from({ length: 20 }, (_, i) => ({ rota: 'Rota B', faixaPeso: '0-10', cte: `B${i}`, tabelaRpa: 105, freteCobrado: 100 })),
    ...Array.from({ length: 10 }, (_, i) => ({ rota: 'Rota C', faixaPeso: '0-10', cte: `C${i}`, tabelaRpa: 125, freteCobrado: 100 })),
  ],
};

test('seleciona o menor conjunto de rotas para a meta', () => {
  const plano = planejarAjustesParaAderencia(resultado, 70);
  assert.equal(plano.ajustes.length, 1);
  assert.equal(plano.aderenciaProjetada, 70);
  assert.equal(plano.atingivel, true);
  assert.equal(plano.ajustes[0].rota, 'Rota B');
  assert.ok(plano.ajustes[0].reduzirPctSugerido > 4.76);
  assert.ok(plano.ajustes[0].reduzirPctSugerido < 5);
  assert.ok(plano.faturamentoProjetadoNasGanhas > plano.faturamentoAtualNasGanhas);
  assert.ok(plano.faturamentoCapturadoConcorrentes > 0);
  assert.ok(plano.savingProjetadoPeriodo > 0);
  assert.equal(plano.savingProjetadoAnual, plano.savingProjetadoMensal * 12);
});

test('gera laudo visual com meta e aderencia projetada', () => {
  const html = gerarHtmlLaudoProjecaoAderencia(resultado, 70);
  assert.match(html, /Laudo de projeção de aderência/);
  assert.match(html, /Meta mínima solicitada/);
  assert.match(html, /70\.00%/);
  assert.match(html, /Rotas\/faixas incluídas nesta meta/);
  assert.doesNotMatch(html, /Sem alteração/);
});

test('aplica margem abaixo do ganhador e nao aceita apenas empate', () => {
  const plano = planejarAjustesParaAderencia(resultado, 70, 2);
  assert.equal(plano.margemCompetitiva, 2);
  assert.ok(plano.ajustes[0].reduzirPctSugerido > 6.6);
  const html = gerarHtmlLaudoProjecaoAderencia(resultado, 70, 2);
  assert.doesNotMatch(html, /Margem abaixo do ganhador/);
  assert.doesNotMatch(html, /Valor-alvo com margem/);
  assert.doesNotMatch(html, /Frete ganhador/);
});

test('calcula a projeção com aliases financeiros de análises salvas', () => {
  const legado = {
    ...resultado,
    ctesAjusteRotaExcel: resultado.ctesAjusteRotaExcel.map((item) => ({
      ...item,
      freteSelecionada: item.tabelaRpa,
      freteRealizado: item.freteCobrado,
      tabelaRpa: undefined,
      freteCobrado: undefined,
    })),
  };

  const plano = planejarAjustesParaAderencia(legado, 70);
  assert.equal(plano.aderenciaProjetada, 70);
  assert.equal(plano.ajustes.length, 1);
  assert.ok(plano.faturamentoProjetadoNasGanhas > 0);
});

test('preserva colunas originais e reduz somente preco da rota escolhida', () => {
  const negociacao = { itens: [
    { faixa_peso: '0-10', dados_originais: { rota: 'Rota A', faixa: '0-10', destino: 'X', percentual: 10 } },
    { faixa_peso: '0-10', dados_originais: { rota: 'Rota B', faixa: '0-10', destino: 'Y', percentual: 8 } },
  ] };
  const { workbook } = gerarWorkbookTabelaSugerida({ resultado, negociacao, meta: 70 });
  const rows = workbook.Sheets['3. Tabela para importar'];
  assert.equal(rows.A2.v, 'Rota A');
  assert.equal(rows.D2.v, 10);
  assert.ok(rows.D3.v < 8);
  const textosExcel = Object.values(workbook.Sheets)
    .flatMap((sheet) => Object.entries(sheet).filter(([ref]) => !ref.startsWith('!')).map(([, cell]) => String(cell.v ?? '')))
    .join(' ');
  assert.doesNotMatch(textosExcel, /margem abaixo|frete ganhador|valor-alvo|saving projetado/i);
});
