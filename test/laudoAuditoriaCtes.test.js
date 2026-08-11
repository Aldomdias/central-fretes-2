import test from 'node:test';
import assert from 'node:assert/strict';
import { cteDivergenteAuditoria, gerarHtmlLaudoAuditoriaCtes } from '../src/utils/laudoAuditoriaCtes.js';

test('identifica divergência somente quando existe cálculo', () => {
  assert.equal(cteDivergenteAuditoria({ valor_cte: 120, valor_calculado: 100 }, (dif) => dif > 5), true);
  assert.equal(cteDivergenteAuditoria({ valor_cte: 120, valor_calculado: 0 }, () => true), false);
});

test('gera laudo por CT-e com orientação de cancelamento e escape', () => {
  const html = gerarHtmlLaudoAuditoriaCtes([{ numero_cte: '123', chave_cte: '<chave>', transportadora: 'Teste', valor_cte: 120, valor_calculado: 100, diferenca: 20 }], { competencia: '2026-08' });
  assert.match(html, /CT-e 123/); assert.match(html, /cancelamento do CT-e/i);
  assert.doesNotMatch(html, /<chave>/); assert.match(html, /&lt;chave&gt;/);
  assert.match(html, /Clique em um CT-e/);
  assert.match(html, /toggleDetail/);
  assert.match(html, /Detalhes do cálculo/);
  assert.doesNotMatch(html, /Verum/i);
  assert.match(html, /COBRADO ACIMA/);
  assert.doesNotMatch(html, />CALCULADO</);
  assert.match(html, /Sem fatura/);
  assert.match(html, /Validação pendente/);
});

test('oculta cobrança a menor por padrão e permite exibi-la', () => {
  const row = { numero_cte: '9', valor_cte: 80, valor_calculado: 100, diferenca: -20 };
  const oculto = gerarHtmlLaudoAuditoriaCtes([row]);
  const visivel = gerarHtmlLaudoAuditoriaCtes([row], { mostrarCobrancaAMenor: true });
  assert.match(oculto, />OK</);
  assert.doesNotMatch(oculto, /-R\$|R\$ -20,00|R\$ -20,00/);
  assert.match(visivel, /-R\$|R\$ -20,00|R\$ -20,00/);
});
