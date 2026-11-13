import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resumirCtesFatura, proximaAcao, filtrarPorCards } from '../src/utils/diagnosticoFaturas.js';
import { chaveCasamentoCte } from '../src/utils/lancamentosCteSap.js';
import { lerZip } from '../src/utils/zipLeitor.js';
import { dataPorExtenso, ehCompensacaoFenix, gerarTermoDocx, montarDocumentoTermo, nomeEmpresaSap, partidasDoTermo } from '../src/utils/termoCorrecaoFenix.js';

const chave = (n) => `42261011222333000181570010000000${String(n).padStart(2, '0')}1000000001`.slice(0, 44);
const k = (n) => chaveCasamentoCte({ cnpj: '11222333000181', numero: n, serie: 1 });

test('compensacao Fenix: reconhece o documento com ou sem zeros', () => {
  assert.equal(ehCompensacaoFenix('1501163056'), true);
  assert.equal(ehCompensacaoFenix('001501163056'), true);
  assert.equal(ehCompensacaoFenix('2000012345'), false);
  assert.equal(ehCompensacaoFenix(''), false);
  assert.equal(nomeEmpresaSap('1420'), 'CPX DISTRIBUIDORA SA');
  assert.equal(nomeEmpresaSap('9999'), '9999');
});

test('resumo de CT-es separa os compensados pela Fenix (continuam lancados)', () => {
  const detalhes = [
    { chave_cte: chave(1), numero_cte: '1', valor_frete: 10 },
    { chave_cte: chave(2), numero_cte: '2', valor_frete: 20 },
  ];
  const sap = new Map([
    [k(1), [{ montante: -10, data_lancamento: '2026-10-01', lancamento_contabil: '5105361580', documento_compensacao: '1501163056', empresa: '1420', codigo_fornecedor: '2311162', fornecedor: 'TEX COURIER S.A' }]],
    [k(2), [{ montante: -20, data_lancamento: '2026-10-01', lancamento_contabil: '5105000001', documento_compensacao: '2000000001' }]],
  ]);
  const r = resumirCtesFatura(detalhes, sap);
  assert.equal(r.lancados, 2);
  assert.equal(r.fenix.length, 1);
  assert.equal(r.fenix[0].partida, '5105361580');
  assert.equal(r.fenix[0].codigo_fornecedor, '2311162');
  assert.equal(r.valorFenix, 10);
  assert.equal(r.itens.find((c) => c.numero_cte === '1').fenix, true);

  const linha = { fatura: { id: 1, status: 'PRONTA_PARA_PAGAMENTO', ctes_totais: 2, ctes_auditados: 2 }, ctes: r };
  assert.match(proximaAcao(linha), /Fênix/);
  assert.equal(filtrarPorCards([linha, { ...linha, ctes: { ...r, fenix: [] } }], { fenix: 'com_fenix' }).length, 1);
});

test('termo: um bloco por partida, dados escapados e data por extenso', () => {
  const modelo = 'A {{DATA_EXTENSO}}<!--BLOCO-->[{{EMPRESA}}|{{FORNECEDOR_CODIGO}}|{{FORNECEDOR_NOME}}|{{PEDIDO}} {{PEDIDO_ROTULO}}|{{PARTIDA}}|{{SOLICITANTE}}|{{MOTIVO}}]<!--/BLOCO-->Z';
  const itens = [
    { empresa: '1420', codigo_fornecedor: '2311162', fornecedor: 'TEX & CIA', documento_compensacao: '1501163056', partida: '5105361580' },
    { empresa: '1420', codigo_fornecedor: '2311162', fornecedor: 'TEX & CIA', documento_compensacao: '1501163056', partida: '5105361580' },
    { empresa: '1420', codigo_fornecedor: '2311162', fornecedor: 'TEX & CIA', documento_compensacao: '1501163056', partida: '5105618016' },
  ];
  assert.equal(partidasDoTermo(itens).length, 2);
  const xml = montarDocumentoTermo(modelo, itens, { solicitante: 'Fulano', data: new Date(2026, 10, 11) });
  assert.equal(xml, 'A 11 de novembro de 2026'
    + '[CPX DISTRIBUIDORA SA|2311162|TEX &amp; CIA|1501163056 (PL FÊNIX)|5105361580|Fulano|Estornar compensação não paga]'
    + '[CPX DISTRIBUIDORA SA|2311162|TEX &amp; CIA|1501163056 (PL FÊNIX)|5105618016|Fulano|Estornar compensação não paga]Z');
  assert.equal(dataPorExtenso(new Date(2026, 0, 2)), '2 de janeiro de 2026');
});

test('termo: gera o .docx a partir do modelo do financeiro', () => {
  const modelo = readFileSync(new URL('../src/assets/modelos/termo-correcao-lancamento.docx', import.meta.url));
  const itens = [{ empresa: '1420', codigo_fornecedor: '2311162', fornecedor: 'TEX COURIER S.A', documento_compensacao: '1501163056', partida: '5105361580' }];
  const bytes = gerarTermoDocx(new Uint8Array(modelo), itens, { solicitante: 'Fulano' });
  const arquivos = lerZip(bytes);
  const xml = new TextDecoder().decode(arquivos['word/document.xml']);
  assert.ok(xml.includes('>5105361580<'));
  assert.ok(xml.includes('>Fulano<'));
  assert.ok(!xml.includes('{{'));
  assert.ok(!xml.includes('BLOCO'));
  assert.ok(arquivos['word/media/image1.png']);
  assert.ok(Object.keys(arquivos).includes('[Content_Types].xml'));
});
