import test from 'node:test';
import assert from 'node:assert/strict';
import { enfileirarLiberacaoOmsRobo } from '../api/_robo-core.mjs';

// Banco falso minimo: encadeia select/eq/neq/limit e insert sobre fatura_oms_envios.
function dbFalso({ existentes = [], erroInsert = null } = {}) {
  const inseridos = [];
  const consulta = { eq: () => consulta, neq: () => consulta, limit: async () => ({ data: existentes }) };
  return {
    inseridos,
    from: (tabela) => {
      assert.equal(tabela, 'fatura_oms_envios');
      return { select: () => consulta, insert: async (linha) => { if (!erroInsert) inseridos.push(linha); return { error: erroInsert }; } };
    },
  };
}
const fatura = { id: 'f1', valor_fatura: 1234.5, oms_invoice_id: '6566F0A1B2C3D4E5F6A7B8C9' };

test('robo de NFS-e: enfileira a liberacao no OMS (so release, operador do robo, status enviando)', async () => {
  const db = dbFalso();
  assert.equal(await enfileirarLiberacaoOmsRobo(db, fatura), 'enfileirado');
  const [l] = db.inseridos;
  assert.equal(l.status, 'enviando');
  assert.equal(l.tentativas, 0);
  assert.equal(l.oms_invoice_id, '6566f0a1b2c3d4e5f6a7b8c9');
  assert.equal(l.payload.requestId, l.request_id);
  assert.deepEqual(l.payload.performedBy, { id: 'robo-auditor', name: 'Robo Auditor' });
  assert.deepEqual(l.payload.invoices, [{ invoiceId: '6566f0a1b2c3d4e5f6a7b8c9', approvedChargeValue: 1234.5, release: true }]);
});

test('robo de NFS-e: sem Id do OMS, ja enfileirada ou erro no banco nao lancam e nao duplicam', async () => {
  assert.equal(await enfileirarLiberacaoOmsRobo(dbFalso(), { ...fatura, oms_invoice_id: null }), 'sem_id_oms');
  const db = dbFalso({ existentes: [{ id: 'x', status: 'enviado' }] });
  assert.equal(await enfileirarLiberacaoOmsRobo(db, fatura), 'ja_enfileirado');
  assert.equal(db.inseridos.length, 0);
  assert.equal(await enfileirarLiberacaoOmsRobo(dbFalso({ erroInsert: { message: 'boom' } }), fatura), 'erro_enfileirar');
});
