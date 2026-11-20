import test from 'node:test';
import assert from 'node:assert/strict';

test('reimportacao so completa: nunca sobrescreve a fatura e preserva a tratada', async () => {
  const { camposParaCompletar, faturaJaTratada } = await import('../src/utils/auditoriaFretesImport.js');
  const atual = { valor_fatura: 100, data_vencimento: null, banco: '', status: 'PRONTA_PARA_PAGAMENTO', oms_invoice_id: null };
  const nova = { valor_fatura: 999, data_vencimento: '2026-11-30', banco: 'Itau', status: 'RECEBIDA', oms_invoice_id: 'abc', transportadora: 'X' };
  assert.deepEqual(camposParaCompletar(atual, nova, ['transportadora', 'status']), { data_vencimento: '2026-11-30', banco: 'Itau', oms_invoice_id: 'abc' });
  assert.equal(faturaJaTratada({ status: 'RECEBIDA', ctes_auditados: 0 }), false);
  assert.equal(faturaJaTratada({ status: 'RECEBIDA', ctes_auditados: 3 }), true);
  assert.equal(faturaJaTratada({ status: 'COM_DIVERGENCIA' }), true);
});

test('reimportacao de CT-es: acrescenta os que faltam e completa vazios, sem apagar nem sobrescrever', async () => {
  const { planejarCtesReimportacao } = await import('../src/utils/auditoriaFretesImport.js');
  const chave = (n) => `4325110522209200033057013${String(n).padStart(9, '0')}1000000000`.slice(0, 44);
  const existentes = [
    { id: 'a', numero_cte: '100', serie_cte: '1', cnpj_emissor: '05222092000330', chave_cte: '', valor_frete: 50, calculado_frete: 48 },
    { id: 'b', numero_cte: '200', serie_cte: '1', cnpj_emissor: '05222092000330', chave_cte: chave(200), valor_frete: 70, calculado_frete: 70 },
  ];
  const novos = [
    { numero_cte: '0100', serie_cte: '001', cnpj_emissor: '05222092000330', chave_cte: chave(100), valor_frete: 0, calculado_frete: 0 },
    { numero_cte: '200', serie_cte: '1', cnpj_emissor: '05222092000330', chave_cte: chave(200), valor_frete: 999, calculado_frete: 1 },
    { numero_cte: '300', serie_cte: '1', cnpj_emissor: '05222092000330', chave_cte: chave(300), valor_frete: 30 },
    { numero_cte: '300', serie_cte: '1', cnpj_emissor: '05222092000330', chave_cte: chave(300), valor_frete: 30 },
  ];
  const plano = planejarCtesReimportacao(existentes, novos);
  assert.deepEqual(plano.completar, [{ id: 'a', campos: { chave_cte: chave(100) } }]);
  assert.equal(plano.inserir.length, 1);
  assert.equal(plano.inserir[0].numero_cte, '300');
});

test('reimportacao atualiza o envio ao ERP mesmo em fatura tratada, e nada mais', async () => {
  const { camposDaReimportacao } = await import('../src/utils/auditoriaFretesImport.js');
  const atual = { status: 'PAGA', valor_fatura: 100, data_envio_erp: '2026-10-01T10:00:00Z', enviado_por: 'Ana', valor_enviado: null };
  const nova = { status: 'RECEBIDA', valor_fatura: 999, data_envio_erp: '2026-10-05T09:00:00Z', enviado_por: 'Ana', valor_enviado: 100 };
  assert.deepEqual(camposDaReimportacao(atual, nova, ['status']), { valor_enviado: 100, data_envio_erp: '2026-10-05T09:00:00Z' });
  assert.deepEqual(camposDaReimportacao(atual, { ...nova, data_envio_erp: '' }, ['status']), { valor_enviado: 100 });
});
