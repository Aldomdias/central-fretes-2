import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseRealizadoCtesFile } from '../src/utils/realizadoCtes.js';

function arquivoXlsx(rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Registros');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return {
    name: 'base-ctes.xlsx',
    size: buffer.length,
    async arrayBuffer() {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
  };
}

test('preserva CT-e identificado mesmo quando os valores financeiros estão vazios', async () => {
  const chave = '42260853237962003493570010004245191015628810';
  const arquivo = arquivoXlsx([{
    'Chave CT-e': chave,
    'Número CT-e': '424519',
    'Data emissão': '12/08/2026',
    'Valor CT-e': '',
    'Valor NF': '',
  }]);

  const resultado = await parseRealizadoCtesFile(arquivo);

  assert.equal(resultado.registros.length, 1);
  assert.equal(resultado.registros[0].chaveCte, chave);
  assert.equal(resultado.meta.registrosSemValorFinanceiro, 1);
});
