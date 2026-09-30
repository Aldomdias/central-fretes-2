import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import XLSX from 'xlsx';
import {
  dataParaIso, isoParaDdmmaaaa, valorParaSap, tratarEscritoriosBi, lerResultadoCsv, gerarIds, tsvParaMatriz, normalizarCnpj,
  criarIndices, mapearColunas, abaParaMatriz,
} from '../src/utils/robos/lancamentoComum.js';
import { lerEntradaNfse, montarLancamentoNfse, linhasParaScriptNfse, aplicarResultado, linhasEnviarNfse } from '../src/utils/robos/lancamentoNfse.js';
import { gerarScriptNfse, gerarScriptCte } from '../src/utils/robos/sapLancamentoVbs.js';

test('datas e valores no formato do SAP', () => {
  assert.equal(dataParaIso(46203), '2026-06-30'); // serial do Excel
  assert.equal(dataParaIso('30/06/2026'), '2026-06-30');
  assert.equal(dataParaIso('2026-06-30T00:00:00'), '2026-06-30');
  assert.equal(isoParaDdmmaaaa('2026-06-30'), '30062026');
  assert.equal(valorParaSap(57.5), '57,50');
  assert.equal(valorParaSap(1234.567), '1234,57');
  assert.equal(normalizarCnpj(1615755000130), '01615755000130');
});

test('escritorios BI: filtros e desempate do Power Query', () => {
  const r = tratarEscritoriosBi([
    { titulo: 'C420110200', escritorio: 'ZTRD', empresa: '1420' },
    { titulo: 'C420199999', escritorio: 'ZTRD', empresa: '1420' }, // mesmo Conc: fica o maior titulo
    { titulo: 'C7K0110004', escritorio: 'Z001', empresa: '1420' }, // titulo excluido
    { titulo: 'C1', escritorio: 'N/A', empresa: '1420' },
    { titulo: 'C2', escritorio: 'Z044', empresa: '1710' }, // Conc excluido (1710Z044)
    { titulo: 'C420130045', escritorio: 'Z044', empresa: '1420' },
  ]);
  assert.deepEqual(r, [{ conc: '1420ZTRD', titulo: 'C420199999' }, { conc: '1420Z044', titulo: 'C420130045' }]);
});

test('resultado do SAP e ids estaveis', () => {
  const m = lerResultadoCsv('1428-F/1;pedido;4500000001\r\n1428-F/1;miro;5110000002\r\nlixo\r\n');
  assert.deepEqual(m.get('1428-F/1'), { pedido: '4500000001', miro: '5110000002' });
  assert.deepEqual(gerarIds([{ a: 'x' }, { a: 'x' }], (i) => i.a), ['x', 'x#2']);
});

test('NFS-e: monta a aba Lancamento (empresa, centro, centro de custo) e gera o script', () => {
  const indices = criarIndices({
    filiais: [{ cnpj: '10158356013866', emp: '1420', centro: 'X138' }],
    escritorios: [{ conc: '1420Z044', titulo: 'C420130045' }],
  });
  const matriz = tsvParaMatriz('NF\tTransportadora\tCNPJ Transp\tData Emissão\tValor\tCod\tCFOP\tCNPJ Tomador\tEscrV\tFatura\n1428-F\tROCHA E MIURA\t16615755000130\t30/06/2026\t57,53\tiq\t1933aa\t10158356013866\tZ044\t5199\n9-F\tOUTRA\t16615755000130\t30/06/2026\t10,00\tIQ\t1933AA\t99999999999999\tZ044\t1');
  const linhas = montarLancamentoNfse(lerEntradaNfse(matriz), indices, { vencimento: '2026-08-19' });
  assert.equal(linhas.length, 2);
  assert.deepEqual([linhas[0].emp, linhas[0].centro, linhas[0].cc, linhas[0].codImp, linhas[0].cfop, linhas[0].valor], ['1420', 'X138', 'C420130045', 'IQ', '1933AA', 57.53]);
  assert.ok(linhas[1].erros[0].includes('nao esta em Filiais'));
  const vbs = gerarScriptNfse({ linhas: linhasParaScriptNfse([linhas[0]]) });
  assert.ok(vbs.includes('"57,53"') && vbs.includes('"30062026"') && vbs.includes('"19082026"'));
  assert.throws(() => gerarScriptNfse({ linhas: linhasParaScriptNfse([linhas[1]]) }), /sem empresa/);
  const r = aplicarResultado(linhas, lerResultadoCsv(`${linhas[0].id};pedido;4500000001\n${linhas[0].id};miro;5110000002`));
  assert.equal(r.atualizadas, 1);
  assert.deepEqual(linhasEnviarNfse(r.linhas), [{ Transportadora: 'ROCHA E MIURA', Fatura: '5199', 'NF Serviço': '1428-F', NrPedido: '4500000001', NrMIRO: '5110000002' }]);
});

test('script CT-e: linhas curtas e ascii', () => {
  const vbs = gerarScriptCte({ linhas: [{ id: 'a', emp: '1420', cte: '1-1', bruto: '1,00', prot: '1', cnpj: '1', centro: '4201', liquido: '0,90', aliquota: '12', cc: 'C', codImp: 'F1', dtEmissao: '30062026', dtVenc: '19082026', tpEmis: '1', cNF: '1', dv: '1', centro1: 'CEN4201', pedido: '', miro: '' }] });
  const ls = vbs.split('\r\n');
  assert.ok(Math.max(...ls.map((l) => l.length)) < 900);
  assert.ok(!/[^\x00-\x7f]/.test(vbs));
});

const DL = 'C:/Users/aldom/Downloads/';
test('parametros reais: as planilhas de lancamento trazem Filiais e Escritorios BI', { skip: !fs.existsSync(`${DL}Lançamento NFS-e - 4.0.xlsm`) }, () => {
  const wb = XLSX.read(fs.readFileSync(`${DL}Lançamento NFS-e - 4.0.xlsm`), { type: 'buffer', raw: true });
  const filiaisM = abaParaMatriz(XLSX, wb.Sheets.Filiais_Cantu);
  const mf = mapearColunas(filiaisM[0], { cnpj: ['CNPJ OK'], emp: ['FILIAL SAP'], centro: ['FILIAL SAP_1'] });
  assert.deepEqual(Object.keys(mf).sort(), ['centro', 'cnpj', 'emp']);
  const bi = abaParaMatriz(XLSX, wb.Sheets['Escritorios BI']);
  const me = mapearColunas(bi[0], { titulo: ['Título'], escritorio: ['Escritório'], empresa: ['Empresa'] });
  const esc = tratarEscritoriosBi(bi.slice(1).map((r) => ({ titulo: r[me.titulo], escritorio: r[me.escritorio], empresa: r[me.empresa] })));
  assert.ok(esc.length > 500);
  assert.ok(esc.some((e) => e.conc === '1420ZTRD'));
});

test('exportar e importar de volta as tabelas de parametros (ida e volta)', async () => {
  const { baixarParametrosXlsx: _ignorado, ...resto } = await import('../src/utils/robos/lancamentoComum.js');
  assert.ok(resto.tratarEscritoriosBi);
  // o que a exportacao escreve precisa ser lido pelo importador: Conc = Empresa + Escritorio
  const escritorios = [{ conc: '1420Z044', titulo: 'C420130045' }, { conc: '1710ZTRD', titulo: 'C1' }];
  const linhas = escritorios.map((e) => ({ titulo: e.titulo, escritorio: String(e.conc).slice(4), empresa: String(e.conc).slice(0, 4) }));
  const volta = tratarEscritoriosBi(linhas);
  assert.deepEqual(volta, [{ conc: '1420Z044', titulo: 'C420130045' }]); // 1710ZTRD esta na lista de excluidos do Power Query
});

test('importar arquivo exportado: mantem linha ajustada a mao (inclusive Conc da lista de exclusao)', async () => {
  const { baixarParametrosXlsx, extrairParametrosDeArquivo } = await import('../src/utils/robos/lancamentoComum.js');
  let bytes = null;
  globalThis.window = { localStorage: { getItem: () => null, setItem: () => {} } };
  globalThis.document = { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } };
  globalThis.URL.createObjectURL = (b) => { bytes = b; return 'blob:x'; };
  globalThis.URL.revokeObjectURL = () => {};
  await baixarParametrosXlsx({
    filiais: [{ cnpj: '10158356013866', emp: '1420', centro: 'X138' }],
    escritorios: [{ conc: '1420Z044', titulo: 'C420130045' }, { conc: '1710ZTRD', titulo: 'C171010200' }],
  });
  const arq = { arrayBuffer: async () => bytes.arrayBuffer() };
  const r = await extrairParametrosDeArquivo(arq);
  assert.deepEqual(r.filiais, [{ cnpj: '10158356013866', emp: '1420', centro: 'X138' }]);
  assert.deepEqual(r.escritorios.map((e) => e.conc), ['1420Z044', '1710ZTRD']);
});

import { agregarPorMes, anosDisponiveis, linhaParaRegistro, chaveRegistro } from '../src/utils/robos/historicoLancamentos.js';

test('historico: so entra o que tem MIRO e agrega por mes', () => {
  assert.equal(linhaParaRegistro('NFSE', { nf: '1', miro: '' }), null);
  const r = linhaParaRegistro('NFSE', { nf: '1428-F', miro: '5110000002', pedido: '4500000001', valor: 57.53, emp: '1420', cnpjTransp: '1', transportadora: 'RM', dataEmissao: '2026-06-30', vencimento: '' });
  assert.deepEqual([r.tipo, r.documento, r.valor, r.vencimento, chaveRegistro(r)], ['NFSE', '1428-F', 57.53, null, 'NFSE|5110000002|1428-F']);
  const c = linhaParaRegistro('CTE', { cte: '123-1', bruto: 100, miro: '5110000003' });
  assert.deepEqual([c.documento, c.valor], ['123-1', 100]);
  const regs = [
    { tipo: 'NFSE', valor: 10, transportadora: 'A', lancado_em: '2026-09-05T12:00:00Z' },
    { tipo: 'NFSE', valor: 5.5, transportadora: 'A', lancado_em: '2026-09-20T12:00:00Z' },
    { tipo: 'CTE', valor: 100, transportadora: 'B', lancado_em: '2026-09-21T12:00:00Z' },
    { tipo: 'CTE', valor: 1, transportadora: 'B', lancado_em: '2025-01-21T12:00:00Z' },
  ];
  const set = agregarPorMes(regs, '2026')[8];
  assert.deepEqual([set.nfse, set.cte, set.total, set.valor, set.transportadoras], [2, 1, 3, 115.5, 2]);
  assert.equal(agregarPorMes(regs, '2026', 'CTE')[8].total, 1);
  assert.ok(anosDisponiveis(regs).includes('2025'));
});
