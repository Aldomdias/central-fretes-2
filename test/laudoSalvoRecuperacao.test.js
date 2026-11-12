import test from 'node:test';
import assert from 'node:assert/strict';
import { montarLaudosNegociacao, recuperarLaudoNegociacao } from '../src/utils/laudosNegociacaoHtml.js';

const resumo = { ctesAnalisados: 1645, ctesComTabelaSelecionada: 1592, ctesGanhariaSelecionada: 44, savingSelecionadaVsRealMes: 6342.65, filtros: { inicio: '2026-09-01', fim: '2026-09-30', canal: 'B2C', origem: 'Contagem' } };
const gerado = montarLaudosNegociacao(resumo, { transportadora: 'PAJUCARA' }).executivo;
test('recupera laudos legados vazios a partir dos valores salvos, sem recalcular fretes', () => {
  for (const salvo of [null, { assunto: 'legado' }, { dados: {} }, { dados: { transportadora: 'Transportadora', indicadores: { ctesAnalisados: 0 } } }]) {
    const dados = recuperarLaudoNegociacao(salvo, gerado);
    assert.equal(dados.indicadores.ctesAnalisados, 1645);
    assert.equal(dados.indicadores.savingMes, 6342.65);
    assert.equal(dados.periodo, '2026-09-01 a 2026-09-30');
    assert.equal(dados.transportadora, 'PAJUCARA');
  }
});
test('preserva payload visual completo e desembrulha dados', () => {
  const salvo = { ...gerado, assunto: 'assunto preservado' };
  assert.equal(recuperarLaudoNegociacao({ dados: salvo }, gerado), salvo);
  assert.equal(recuperarLaudoNegociacao(salvo, gerado, true), gerado);
});
test('regenera reajuste a partir da mesma base salva', () => {
  const reajuste = montarLaudosNegociacao({ ...resumo, valor_atual_realizado: 179933.05, valor_simulado_nova_tabela: 192525.29, impacto_mensal: 12592.24 }, { tipoNegociacao: 'REAJUSTE_TABELA_EXISTENTE', transportadora: 'PAJUCARA' }).executivo;
  assert.equal(recuperarLaudoNegociacao({}, reajuste, true).indicadores.impactoMes, 12592.24);
});
