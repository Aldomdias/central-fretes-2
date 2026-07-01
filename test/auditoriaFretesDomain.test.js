import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularDashboard,
  conciliarPagamentos,
  faixaVencimento,
  gerarProtocolo,
  montarArquivoDoccobEdi,
  montarLinhasDoccob,
  statusSla,
} from '../src/utils/auditoriaFretesDomain.js';
import {
  analisarLayoutVerum,
  excelDateToISO,
  parseDetalheFaturaVerum,
  parseFaturaVerum,
} from '../src/utils/auditoriaFretesImport.js';

const referencia = new Date('2026-06-13T12:00:00Z');

test('classifica vencimentos sem considerar faturas encerradas', () => {
  assert.equal(faixaVencimento({ data_vencimento: '2026-06-12', status: 'RECEBIDA' }, referencia), 'VENCIDA');
  assert.equal(faixaVencimento({ data_vencimento: '2026-06-14', status: 'RECEBIDA' }, referencia), 'CRITICO');
  assert.equal(faixaVencimento({ data_vencimento: '2026-06-12', status: 'PAGA' }, referencia), 'SEM_ALERTA');
});

test('gera protocolos sequenciais por prefixo e ano', () => {
  const existentes = [{ protocolo: 'FIN-2026-000003' }, { protocolo: 'FIN-SLA-2026-000100' }];
  assert.equal(gerarProtocolo('FIN', existentes, referencia), 'FIN-2026-000004');
  assert.equal(gerarProtocolo('FIN-SLA', existentes, referencia), 'FIN-SLA-2026-000101');
});

test('dashboard consolida status, valores e CT-es na unidade fatura', () => {
  const resumo = calcularDashboard([
    { status: 'COM_DIVERGENCIA', data_vencimento: '2026-06-12', valor_fatura: 100, diferenca: 10, ctes_auditados: 2, ctes_divergentes: 1 },
    { status: 'PRONTA_PARA_PAGAMENTO', data_vencimento: '2026-06-15', valor_fatura: 200, diferenca: 0, ctes_auditados: 3 },
  ], referencia);
  assert.equal(resumo.vencidas, 1);
  assert.equal(resumo.vencendo3, 1);
  assert.equal(resumo.prontas, 1);
  assert.equal(resumo.valorAuditado, 300);
  assert.equal(resumo.valorDivergente, 10);
  assert.equal(resumo.ctesAuditados, 5);
});

test('DOCCOB exporta somente CT-es selecionados', () => {
  const linhas = montarLinhasDoccob(
    { numero_fatura: '123', transportadora: 'Tomasi' },
    [{ id: 'a', numero_cte: '1', valor_frete: 10 }, { id: 'b', numero_cte: '2', valor_frete: 20 }],
    ['b'],
  );
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0]['Numero CT-e'], '2');
});

test('concilia pagamentos por numero e identifica divergencia', () => {
  const resultado = conciliarPagamentos(
    [{ id: 'f1', numero_fatura: '100', valor_fatura: 80 }],
    [{ numero_fatura: '100', valor_pago: 70 }, { numero_fatura: '999', valor_pago: 10 }],
  );
  assert.equal(resultado[0].resultado, 'DIVERGENTE');
  assert.equal(resultado[0].diferenca, -10);
  assert.equal(resultado[1].resultado, 'NAO_LOCALIZADO');
});

test('conciliacao marca como ambiguo o numero repetido em transportadoras diferentes', () => {
  const faturas = [
    { id: 'f1', numero_fatura: '100', transportadora: 'Tomasi', valor_fatura: 80 },
    { id: 'f2', numero_fatura: '100', transportadora: 'WM', valor_fatura: 90 },
  ];
  const semTransportadora = conciliarPagamentos(faturas, [{ numero_fatura: '100', valor_pago: 90 }]);
  assert.equal(semTransportadora[0].resultado, 'AMBIGUO');
  assert.equal(semTransportadora[0].fatura_id, undefined);

  const comTransportadora = conciliarPagamentos(faturas, [{ numero_fatura: '100', transportadora: 'WM', valor_pago: 90 }]);
  assert.equal(comTransportadora[0].resultado, 'PAGO');
  assert.equal(comTransportadora[0].fatura_id, 'f2');
});

test('conciliacao ignora fatura substituida quando existe fatura em aberto com o mesmo numero', () => {
  const faturas = [
    { id: 'f1', numero_fatura: '200', transportadora: 'Tomasi', valor_fatura: 100, status: 'SUBSTITUIDA' },
    { id: 'f2', numero_fatura: '200', transportadora: 'Tomasi', valor_fatura: 95, status: 'ENVIADA_AO_FINANCEIRO' },
  ];
  const resultado = conciliarPagamentos(faturas, [{ numero_fatura: '200', valor_pago: 95 }]);
  assert.equal(resultado[0].resultado, 'PAGO');
  assert.equal(resultado[0].fatura_id, 'f2');
});

test('DOCCOB EDI gera registros PROCEDA de 170 posicoes na hierarquia correta', () => {
  const arquivo = montarArquivoDoccobEdi(
    {
      numero_fatura: 'FAT-8452', transportadora: 'Tomasi Logística',
      cnpj_transportadora: '12.345.678/0001-90', serie_fatura: '1',
      data_emissao: '2026-06-20', data_vencimento: '2026-07-05',
    },
    [
      { id: 'a', numero_cte: '1821', valor_frete: 4250.22 },
      { id: 'b', numero_cte: '1822', valor_frete: 3170 },
      { id: 'c', numero_cte: '1823', valor_frete: 999 },
    ],
    ['a', 'b'],
    { referencia: '2026-07-01T14:30:00' },
  );
  const linhas = arquivo.split('\r\n');
  assert.deepEqual(linhas.map((linha) => linha.slice(0, 3)), ['000', '350', '351', '352', '353', '353', '355']);
  assert.ok(linhas.every((linha) => linha.length === 170), 'todos os registros devem ter 170 posicoes');

  const doc = linhas[3];
  assert.equal(doc.slice(17, 27), '0000008452'); // numero do documento N10
  assert.equal(doc.slice(27, 35), '20062026'); // emissao DDMMAAAA
  assert.equal(doc.slice(35, 43), '05072026'); // vencimento DDMMAAAA
  assert.equal(doc.slice(43, 58), '000000000742022'); // valor 13,2 sem separador (7.420,22)
  assert.equal(doc[166], 'I'); // acao do documento

  assert.equal(linhas[2].slice(3, 17), '12345678000190'); // CNPJ sem mascara
  assert.equal(linhas[4].slice(18, 30).trim(), '1821'); // numero do conhecimento
  assert.equal(linhas.at(-1).slice(3, 7), '0001'); // total de documentos
  assert.equal(linhas.at(-1).slice(7, 22), '000000000742022'); // valor total
});

test('SLA distingue vencendo e fora do prazo', () => {
  assert.equal(statusSla({ prazo_sla: '2026-06-14', status: 'ABERTA' }, referencia), 'VENCENDO_SLA');
  assert.equal(statusSla({ prazo_sla: '2026-06-12', status: 'ABERTA' }, referencia), 'FORA_SLA');
});

test('parser Verum reconhece cabecalho, datas e valores brasileiros', () => {
  const fatura = parseFaturaVerum({
    Transportadora: 'Transportadora Teste',
    'Número Fatura': 'FAT-10',
    'Data Vencimento': '20/06/2026',
    'Valor Fatura': '1.234,56',
    'CNPJ Transportadora': '12.345.678/0001-90',
  });
  assert.equal(fatura.numero_fatura, 'FAT-10');
  assert.equal(fatura.data_vencimento, '2026-06-20');
  assert.equal(fatura.valor_fatura, 1234.56);
  assert.equal(fatura.cnpj_transportadora, '12345678000190');
  assert.equal(fatura.status, 'RECEBIDA');
});

test('parser Verum vincula detalhes pela fatura e serie', () => {
  const rowsFaturas = [{ Transportadora: 'Teste', 'Numero Fatura': '10', 'Serie Fatura': 'A' }];
  const rowsDetalhes = [
    { 'Numero Fatura': '10', 'Serie Fatura': 'A', 'Chave CTe': '123', 'Valor Frete': 20 },
    { 'Numero Fatura': '99', 'Serie Fatura': 'A', 'Chave CTe': '999', 'Valor Frete': 30 },
  ];
  const analise = analisarLayoutVerum(rowsFaturas, rowsDetalhes);
  assert.equal(analise.faturasValidas, 1);
  assert.equal(analise.detalhesReconhecidos, 1);
  assert.equal(analise.detalhesNaoVinculados, 1);
  const detalhe = parseDetalheFaturaVerum(rowsDetalhes[0], 'fatura-id', parseFaturaVerum(rowsFaturas[0]));
  assert.equal(detalhe.fatura_id, 'fatura-id');
  assert.equal(detalhe.chave_cte, '123');
});

test('conversao de data Excel preserva formato ISO', () => {
  assert.equal(excelDateToISO('2026-06-15'), '2026-06-15');
  assert.equal(excelDateToISO('15/06/2026'), '2026-06-15');
});
