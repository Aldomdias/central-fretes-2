import test from 'node:test';
import assert from 'node:assert/strict';
import { consolidarLaudoAuditoriaEcommerce, gerarHtmlLaudoAuditoriaEcommerce } from '../src/utils/laudoAuditoriaEcommerce.js';

const itens = [
  { pedido: 'P1', dataCriacao: '2026-07-10', valorPago: 120, valorIdeal: 90, perda: 30, diferencaPeso: true, pesoCotado: 10, pesoFaturado: 20, campanha: true, descontoCampanha: 5, adicionalTributario: 4, transportadoraUsada: 'A', transportadoraIdeal: 'B', origemUsada: 'SP' },
  { pedido: 'P2', dataCriacao: '2026-08-10', valorPago: 80, valorIdeal: 80, perda: 0, transportadoraUsada: 'A', origemUsada: 'SP' },
];

test('consolida valores e causas do laudo ecommerce', () => {
  const resumo = consolidarLaudoAuditoriaEcommerce(itens);
  assert.equal(resumo.totalPedidos, 2); assert.equal(resumo.totalDesvios, 1); assert.equal(resumo.totalPago, 200); assert.equal(resumo.perda, 30);
  assert.equal(resumo.comPeso.perda, 30); assert.equal(resumo.comCampanha.descontos, 5); assert.equal(resumo.comTributo.adicionais, 4);
  assert.deepEqual(resumo.competencias.map((item) => item.nome), ['2026-07', '2026-08']);
});

test('gera laudo imprimivel com metodologia e evidencias', () => {
  const html = gerarHtmlLaudoAuditoriaEcommerce(itens, { cenario: 'faturado' });
  assert.match(html, /Laudo de Auditoria E-commerce/); assert.match(html, /R\$\s*30,00/); assert.match(html, /Divergência de peso/);
  assert.match(html, /Adicionais tributários/); assert.match(html, /P1/); assert.match(html, /window\.print/);
});
