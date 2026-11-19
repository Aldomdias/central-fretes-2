import test from 'node:test';
import assert from 'node:assert/strict';
import { lerOmsInvoiceId } from '../src/utils/auditoriaFretesImport.js';

test('Id do OMS: so aceita 24 hex (coluna "Id" da planilha)', () => {
  assert.equal(lerOmsInvoiceId({ Id: '6566F0A1B2C3D4E5F6A7B8C9' }), '6566f0a1b2c3d4e5f6a7b8c9');
  assert.equal(lerOmsInvoiceId({ Id: '123' }), '');
  assert.equal(lerOmsInvoiceId({}), '');
});
