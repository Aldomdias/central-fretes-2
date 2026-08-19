import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { importarTemplatePadraoSeparado } from '../src/utils/importadorTemplatePadrao.js';

function arquivoDe(aoa, nomeAba) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // formato "#,##0.000" faz o SheetJS (raw:false) devolver "1,999" pro valor 1.999
  ['A2', 'A3'].forEach((ref) => { if (ws[ref] && ws[ref].t === 'n') ws[ref].z = '#,##0.000'; });
  ['B2', 'B3'].forEach((ref) => { if (ws[ref] && ws[ref].t === 'n') ws[ref].z = '#,##0.000'; });
  XLSX.utils.book_append_sheet(wb, ws, nomeAba);
  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return { arrayBuffer: async () => buffer };
}

const CABECALHO = ['Peso Inicial', 'Peso Final', 'Cotação', 'Taxa Aplicada', 'Faixa Peso'];

function arquivoRotas() {
  return arquivoDe([
    ['Cotação', 'Cidade Destino', 'UF Destino', 'Cidade Origem', 'UF Origem'],
    ['SC X AC X INTERIOR', 'RIO BRANCO', 'AC', 'ITAJAI', 'SC'],
  ], 'Rotas');
}

test('faixa 0 a 1,999 nao vira 0 a 1999 (celula numerica)', async () => {
  const arquivo = arquivoDe([
    CABECALHO,
    [0, 1.999, 'SC X AC X INTERIOR', 237.1, '0 a 1,999'],
    [2, 4.999, 'SC X AC X INTERIOR', 283.94, '2 a 4,999'],
  ], 'Fretes');

  const { fretes } = await importarTemplatePadraoSeparado({ arquivoRotas: arquivoRotas(), arquivoFretes: arquivo });
  assert.equal(fretes[0].pesoInicial, 0);
  assert.equal(fretes[0].pesoFinal, 1.999);
  assert.equal(fretes[1].pesoInicial, 2);
  assert.equal(fretes[1].pesoFinal, 4.999);
});

test('faixa com peso como TEXTO tambem le virgula como decimal', async () => {
  const arquivo = arquivoDe([
    CABECALHO,
    ['0', '1,999', 'SC X AC X INTERIOR', '237,10', '0 a 1,999'],
    ['2', '4,999', 'SC X AC X INTERIOR', '283,94', '2 a 4,999'],
  ], 'Fretes');

  const { fretes } = await importarTemplatePadraoSeparado({ arquivoRotas: arquivoRotas(), arquivoFretes: arquivo });
  assert.equal(fretes[0].pesoFinal, 1.999);
  assert.equal(fretes[1].pesoFinal, 4.999);
});
