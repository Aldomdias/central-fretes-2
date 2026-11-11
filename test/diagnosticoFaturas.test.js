import test from 'node:test';
import assert from 'node:assert/strict';
import {
  faixaDaLinha,
  faixaDiagnostico,
  filtrarPorCards,
  identificacaoSapDoCte,
  montarLinhasDiagnostico,
  parseListaFaturas,
  proximaAcao,
  resumirCtesFatura,
  situacaoAuditoria,
  situacaoCtes,
  textoPagamentoLinha,
} from '../src/utils/diagnosticoFaturas.js';
import { chaveFatura } from '../src/utils/auditoriaFretesImport.js';
import { chaveCasamentoCte } from '../src/utils/lancamentosCteSap.js';

test('lista solta: separadores variados, zeros a esquerda e repetidos', () => {
  const { itens, repetidosNaLista } = parseListaFaturas('00123\n456, 789;123');
  assert.deepEqual(itens.map((i) => i.comparavel), ['123', '456', '789']);
  assert.equal(repetidosNaLista, 1);
});

test('tabela do Excel com cabecalho le numero, vencimento e valor pela coluna', () => {
  const { itens } = parseListaFaturas('Emissao\tFatura\tVencimento\tValor\n01/10/2026\t555\t20/10/2026\t1.234,56');
  assert.equal(itens.length, 1);
  assert.deepEqual(itens[0], { numero: '555', comparavel: '555', vencimento: '2026-10-20', valor: 1234.56 });
});

test('tabela sem cabecalho nao confunde data e valor com numero de fatura', () => {
  const { itens } = parseListaFaturas('777\t01/10/2026\t20/10/2026\t99,90');
  assert.equal(itens[0].comparavel, '777');
  assert.equal(itens[0].vencimento, '2026-10-20');
  assert.equal(itens[0].valor, 99.9);
});

test('linha com espacos e valor pega so o numero', () => {
  const { itens } = parseListaFaturas('888 20/10/2026 1.000,00');
  assert.deepEqual(itens.map((i) => i.comparavel), ['888']);
});

const faturas = [
  { id: 'a', numero_fatura: '100', transportadora: 'TAM', cnpj_transportadora: '11222333000181', valor_fatura: 50, status: 'RECEBIDA' },
  { id: 'b', numero_fatura: '100', transportadora: 'WM', cnpj_transportadora: '44555666000199', valor_fatura: 60, status: 'RECEBIDA' },
  { id: 'c', numero_fatura: '200', transportadora: 'TAM FILIAL', cnpj_transportadora: '11222333000262', valor_fatura: 70, status: 'SUBSTITUIDA' },
  { id: 'd', numero_fatura: '200', transportadora: 'TAM', cnpj_transportadora: '11222333000181', valor_fatura: 70, status: 'PAGA' },
];

test('transportadora escolhida desempata e numero de outra vira nao localizado com aviso', () => {
  const { itens } = parseListaFaturas('100\n300');
  const linhas = montarLinhasDiagnostico({ itens, faturas, transportadora: 'WM' });
  assert.equal(linhas[0].fatura.id, 'b');
  assert.equal(linhas[1].fatura, null);
  const { itens: soCem } = parseListaFaturas('200');
  const outra = montarLinhasDiagnostico({ itens: soCem, faturas, transportadora: 'WM' });
  assert.deepEqual(outra[0].outrasTransportadoras.sort(), ['TAM', 'TAM FILIAL']);
});

test('sem transportadora, numero em duas gera duas linhas repetidas; substituida sai se ha ativa', () => {
  const { itens } = parseListaFaturas('100\n200');
  const linhas = montarLinhasDiagnostico({ itens, faturas });
  assert.deepEqual(linhas.map((l) => l.fatura.id), ['a', 'b', 'd']);
  assert.equal(linhas[0].repetida, 2);
  assert.equal(linhas[2].repetida, 1);
});

test('sem lista lista todas da transportadora, incluindo filial pela raiz do CNPJ', () => {
  const linhas = montarLinhasDiagnostico({ faturas, transportadora: 'TAM' });
  assert.deepEqual(linhas.map((l) => l.fatura.id), ['a', 'c', 'd']);
});

test('situacao de auditoria segue o fluxo', () => {
  assert.equal(situacaoAuditoria({ status: 'RECEBIDA', ctes_totais: 3, ctes_auditados: 0 }), 'NAO_AUDITADA');
  assert.equal(situacaoAuditoria({ status: 'COM_DIVERGENCIA', ctes_totais: 3, ctes_auditados: 2 }), 'PARCIAL');
  assert.equal(situacaoAuditoria({ status: 'COM_DIVERGENCIA', ctes_totais: 3, ctes_auditados: 3 }), 'AUDITADA');
  assert.equal(situacaoAuditoria({ status: 'REAUDITADA_CENTRAL', confirmacao_transportador_status: 'ENVIADO' }), 'FORNECEDOR');
  assert.equal(situacaoAuditoria({ status: 'PAGA_COM_DESCONTO' }), 'LIBERADA');
});

test('faixa de vencimento ignora pagas', () => {
  const ref = new Date('2026-11-10T12:00:00');
  assert.equal(faixaDiagnostico({ status: 'RECEBIDA', data_vencimento: '2026-11-09' }, ref), 'VENCIDA');
  assert.equal(faixaDiagnostico({ status: 'RECEBIDA', data_vencimento: '2026-11-11' }, ref), 'HOJE_AMANHA');
  assert.equal(faixaDiagnostico({ status: 'RECEBIDA', data_vencimento: '2026-11-17' }, ref), 'ATE_7');
  assert.equal(faixaDiagnostico({ status: 'RECEBIDA', data_vencimento: '2026-11-18' }, ref), 'MAIS_7');
  assert.equal(faixaDiagnostico({ status: 'PAGA_COM_DESCONTO', data_vencimento: '2026-11-09' }, ref), 'ENCERRADA');
});

const chave = (numero) => `3526101122233300018157001${String(numero).padStart(9, '0')}10000000000`.slice(0, 44);

test('identificacao SAP usa emitente, numero e serie da chave', () => {
  const id = identificacaoSapDoCte({ chave_cte: chave(1234), cnpj_transportadora: '99999999000199' });
  assert.equal(id.cnpj, '11222333000181');
  assert.equal(id.numero, '1234');
  assert.equal(id.serie, '1');
});

test('resumo de CT-es: lancado, estornado, duplicado e NFS-e', () => {
  const detalhes = [
    { chave_cte: chave(1), numero_cte: '1', valor_frete: 10 },
    { chave_cte: chave(1), numero_cte: '1', valor_frete: 10 },
    { chave_cte: chave(2), numero_cte: '2', valor_frete: 20 },
    { chave_cte: chave(3), numero_cte: '3', valor_frete: 30 },
    { numero_cte: '9', serie_cte: 'SPN', valor_frete: 5 },
  ];
  const k = (n) => chaveCasamentoCte({ cnpj: '11222333000181', numero: n, serie: 1 });
  const sap = new Map([
    [k(1), [{ montante: -10, data_lancamento: '2026-10-01', lancamento_contabil: '51' }]],
    [k(2), [{ montante: -20, data_lancamento: '2026-10-01', lancamento_contabil: '51' }, { montante: 20, data_lancamento: '2026-10-02', lancamento_contabil: '52' }]],
  ]);
  const r = resumirCtesFatura(detalhes, sap);
  assert.equal(r.total, 3);
  assert.equal(r.lancados, 1);
  assert.equal(r.nfse, 1);
  assert.equal(r.valorSemPartida, 50);
  assert.equal(r.semPartida.find((c) => c.numero_cte === '2').estornado, true);
  assert.equal(situacaoCtes(r), 'PARCIAL');
  assert.equal(situacaoCtes({ total: 0, lancados: 0, nfse: 1 }), 'SO_NFSE');
});

test('cards de grupos diferentes se somam', () => {
  const ref = { status: 'RECEBIDA', ctes_totais: 1, ctes_auditados: 0, data_vencimento: '2020-01-01' };
  const linhas = [{ fatura: ref }, { fatura: { ...ref, status: 'PAGA' } }, { fatura: null }];
  assert.equal(filtrarPorCards(linhas, { auditoria: 'nao_auditadas', vencimento: 'vencidas' }).length, 1);
  assert.equal(filtrarPorCards(linhas, {}).length, 3);
});

test('nao localizada usa o vencimento da lista e conta como em aberto', () => {
  const ref = new Date('2026-11-10T12:00:00');
  assert.equal(faixaDaLinha({ fatura: null, vencimentoLista: '2026-11-30' }, ref), 'MAIS_7');
  assert.equal(faixaDaLinha({ fatura: null, vencimentoLista: '2026-11-01' }, ref), 'VENCIDA');
  assert.equal(faixaDaLinha({ fatura: null, vencimentoLista: '' }, ref), 'NAO_LOCALIZADA');
  const futuro = { fatura: null, vencimentoLista: '2099-01-01' };
  assert.equal(filtrarPorCards([futuro], { vencimento: 'a_vencer', pagamento: 'abertas' }).length, 1);
});

test('enviada ao ERP sem partida e sinalizada; com partida ou paga nao', () => {
  const enviada = { status: 'ENVIADA_AO_FINANCEIRO', data_envio_erp: '2026-11-01T10:00:00Z' };
  const parcial = { total: 2, lancados: 1, nfse: 0, semPartida: [{}], valorSemPartida: 1 };
  const todos = { total: 2, lancados: 2, nfse: 0, semPartida: [], valorSemPartida: 0 };
  const linhas = [
    { fatura: enviada, ctes: parcial },
    { fatura: enviada, ctes: todos },
    { fatura: enviada },
    { fatura: { ...enviada, partida: '123' } },
    { fatura: { ...enviada, status: 'PAGA' } },
    { fatura: { status: 'RECEBIDA' } },
    { fatura: null },
  ];
  assert.equal(filtrarPorCards(linhas, { erp: 'enviadas_sem_partida' }).length, 1);
  assert.equal(filtrarPorCards(linhas, { erp: 'enviadas_partida_ctes' }).length, 1);
  assert.equal(filtrarPorCards(linhas, { erp: 'enviadas_com_partida' }).length, 2);
  assert.equal(filtrarPorCards(linhas, { erp: 'nao_enviadas' }).length, 1);
  assert.equal(proximaAcao({ fatura: { ...enviada, status: 'RECEBIDA' }, ctes: parcial }), 'Verificar envio ao ERP (sem partida)');
  assert.equal(proximaAcao({ fatura: { ...enviada, status: 'RECEBIDA', ctes_auditados: 0 }, ctes: todos }), 'Auditar');
});

test('coluna pagamento mostra ate onde o lancamento chegou', () => {
  const aberta = { status: 'RECEBIDA' };
  assert.equal(textoPagamentoLinha({ fatura: null }), 'Sem registro');
  assert.equal(textoPagamentoLinha({ fatura: { status: 'PAGA' } }), 'Paga');
  assert.equal(textoPagamentoLinha({ fatura: { ...aberta, lancamento_financeiro: '19' } }), 'Lançada, não paga');
  assert.equal(textoPagamentoLinha({ fatura: aberta, ctes: { total: 2, lancados: 2, nfse: 0 } }), 'Lançada nos CT-es, não paga');
  assert.equal(textoPagamentoLinha({ fatura: aberta, ctes: { total: 2, lancados: 1, nfse: 0 } }), 'Não lançada');
});

test('serie vazia e serie 0 geram a mesma chave de fatura', () => {
  assert.equal(chaveFatura('918817', ''), chaveFatura('918817', '0'));
  assert.equal(chaveFatura('918817', '000'), chaveFatura('918817', null));
  assert.notEqual(chaveFatura('918817', '1'), chaveFatura('918817', ''));
});

test('proxima acao', () => {
  assert.equal(proximaAcao({ fatura: null }), 'Localizar / importar a fatura');
  const liberada = { status: 'PRONTA_PARA_PAGAMENTO' };
  assert.equal(proximaAcao({ fatura: liberada, ctes: { total: 2, lancados: 1, nfse: 0 } }), 'Lançar CT-es sem partida');
  assert.equal(proximaAcao({ fatura: liberada, ctes: { total: 2, lancados: 2, nfse: 0 } }), 'Lançar a fatura');
  assert.equal(proximaAcao({ fatura: { ...liberada, partida: '123' }, ctes: { total: 2, lancados: 2, nfse: 0 } }), 'Aguardar pagamento');
});
