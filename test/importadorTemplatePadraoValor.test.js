import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { importarTemplatePadraoSeparado } from '../src/utils/importadorTemplatePadrao.js';

// Reproduz o cenario do laudo CARVALIMA: taxa de R$ 173,503 formatada com
// "#,##0.000" chega no texto (raw:false) como "173,503" e era lida como
// 173.503 (mil vezes maior), inflando o frete simulado.
function arquivoDe(aoa, nomeAba, formatarColunas = []) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  formatarColunas.forEach((ref) => { if (ws[ref] && ws[ref].t === 'n') ws[ref].z = '#,##0.000'; });
  XLSX.utils.book_append_sheet(wb, ws, nomeAba);
  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return { arrayBuffer: async () => buffer };
}

function arquivoRotas() {
  return arquivoDe([
    ['Cotação', 'Cidade Destino', 'UF Destino', 'Cidade Origem', 'UF Origem'],
    ['SC X AC X INTERIOR', 'RIO BRANCO', 'AC', 'ITAJAI', 'SC'],
  ], 'Rotas');
}

const CABECALHO = ['Peso Inicial', 'Peso Final', 'Cotação', 'Taxa Aplicada', 'Frete Mínimo', 'Excesso de peso', 'Faixa Peso'];

test('taxa 173,503 nao vira 173503 (celula numerica formatada com milhar)', async () => {
  const arquivo = arquivoDe([
    CABECALHO,
    [30, 49.999, 'SC X AC X INTERIOR', 173.503, 120.75, 2.505, '30 até 49,999'],
  ], 'Fretes', ['D2', 'E2', 'F2']);

  const { fretes } = await importarTemplatePadraoSeparado({ arquivoRotas: arquivoRotas(), arquivoFretes: arquivo });
  assert.equal(fretes[0].taxaAplicada, 173.503);
  assert.equal(fretes[0].freteMinimo, 120.75);
  assert.equal(fretes[0].excedente, 2.505);
});

test('valores em texto BR continuam sendo lidos pelo parser', async () => {
  const arquivo = arquivoDe([
    CABECALHO,
    [30, 49.999, 'SC X AC X INTERIOR', '173,50', 'R$ 120,75', '2,50', '30 até 49,999'],
  ], 'Fretes');

  const { fretes } = await importarTemplatePadraoSeparado({ arquivoRotas: arquivoRotas(), arquivoFretes: arquivo });
  assert.equal(fretes[0].taxaAplicada, 173.5);
  assert.equal(fretes[0].freteMinimo, 120.75);
  assert.equal(fretes[0].excedente, 2.5);
});
