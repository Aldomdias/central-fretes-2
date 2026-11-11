import test from 'node:test';
import assert from 'node:assert/strict';
import { dadosDoLaudo, gerarHtmlLaudo } from '../src/utils/laudoDiagnostico.js';

const fat = (extra = {}) => ({ id: 'x', numero_fatura: '1', transportadora: 'WM', status: 'PRONTA_PARA_PAGAMENTO', partida: '51', valor_fatura: 100, ctes_totais: 2, ctes_auditados: 2, data_vencimento: '2026-11-01', ...extra });

test('laudo: pago, programado, em tratativa e fora do total', () => {
  const linhas = [
    { numero: '1', fatura: fat({ status: 'PAGA', valor_pago: 90, data_pagamento: '2026-11-09' }) },
    { numero: '2', fatura: fat({ agrupamento_manual: true, data_previsao_pagamento: '2026-11-19', ctes_auditados: 0 }) },
    { numero: '3', fatura: fat({ fenix_ajuste_status: 'ENVIADO' }), ctes: { total: 2, lancados: 2, nfse: 0, fenix: [{ partida: 'p' }] } },
    { numero: '4', fatura: fat({ status: 'CANCELADA' }) },
    { numero: '5', fatura: null },
  ];
  const { itens, canceladas, naoLocalizadas } = dadosDoLaudo(linhas);
  assert.equal(canceladas, 1);
  assert.equal(naoLocalizadas, 1);
  assert.deepEqual(itens.map((i) => [i.n, i.cat]), [['1', 'PAGA'], ['2', 'PROGRAMADA'], ['3', 'TRAT']]);
  assert.equal(itens[0].pago, 90);
  // Programada nao aparece como "Auditar": esta no protocolo, aguardando o pagamento.
  assert.equal(itens[1].acao, 'Aguardar pagamento');
  assert.equal(itens[2].acao, 'Aguardar retorno do financeiro (Fênix)');
});

test('laudo: HTML autonomo, sem texto do usuario quebrando o script', () => {
  const html = gerarHtmlLaudo({
    linhas: [{ numero: '</script><b>9', fatura: fat({ transportadora: 'A & B <x>' }) }],
    titulo: 'A & B <x>',
    filtros: [['Transportadora', 'A & B <x>'], ['Vazio', '']],
    hoje: new Date(2026, 10, 11),
  });
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.match(html, /Posição em <strong>11\/11\/2026<\/strong>/);
  assert.match(html, /<h1>A &amp; B &lt;x&gt;: situação das faturas<\/h1>/);
  assert.equal(html.split('</script>').length - 1, 1);
  assert.ok(!html.includes('Vazio'));
});
