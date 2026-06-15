import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularDashboard,
  conciliarPagamentos,
  faixaVencimento,
  gerarProtocolo,
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
