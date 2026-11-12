import test from 'node:test';
import assert from 'node:assert/strict';
import {
  criarUnificadorAuditores,
  etapaFenix,
  faixaDaLinha,
  faixaDiagnostico,
  filtrarPorCards,
  GRUPOS_DIAGNOSTICO,
  identificacaoSapDoCte,
  montarLinhasDiagnostico,
  parseListaFaturas,
  previsaoPagamento,
  situacaoPrevisao,
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
  // Lista completa para a planilha: todos os CT-es, com a partida de quem tem.
  assert.equal(r.itens.length, 4);
  assert.deepEqual(r.itens.map((c) => c.situacao).sort(), ['COM_PARTIDA', 'ESTORNADO', 'NFSE', 'SEM_PARTIDA']);
  assert.ok(r.itens.find((c) => c.situacao === 'COM_PARTIDA').lancamento_contabil);
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

test('agrupamento manual: sai do card a enviar quando a fatura recebe partida', () => {
  const ref = { status: 'RECEBIDA', ctes_totais: 1, ctes_auditados: 1, agrupamento_manual: true };
  const linhas = [{ fatura: ref }, { fatura: { ...ref, partida: '200123' } }, { fatura: { ...ref, agrupamento_manual: false } }];
  assert.equal(filtrarPorCards(linhas, { protocolo: 'manual_a_agrupar' }).length, 1);
  assert.equal(filtrarPorCards(linhas, { protocolo: 'manual_agrupadas' })[0].fatura.partida, '200123');
  assert.equal(filtrarPorCards(linhas, { protocolo: 'sem_marcacao' }).length, 1);
  assert.equal(proximaAcao(linhas[0]), 'Aguardar agrupamento manual do financeiro');
});

test('ajuste Fênix: a enviar -> aguardando -> retorno -> protocolo', () => {
  const fenix = { total: 1, lancados: 1, nfse: 0, fenix: [{ partida: '5100000001' }] };
  const limpo = { total: 1, lancados: 1, nfse: 0, fenix: [] };
  const fat = (extra = {}) => ({ id: 'f1', status: 'PRONTA_PARA_PAGAMENTO', ctes_totais: 1, ctes_auditados: 1, ...extra });
  const pega = (linha) => GRUPOS_DIAGNOSTICO.find((g) => g.id === 'fenix_ajuste').cards.filter((c) => c.teste(linha)).map((c) => c.id);

  const aEnviar = { fatura: fat(), ctes: fenix };
  assert.equal(etapaFenix(aEnviar), 'A_ENVIAR');
  assert.deepEqual(pega(aEnviar), ['fenix_a_enviar']);
  assert.equal(proximaAcao(aEnviar), 'Pedir estorno da compensação Fênix ao financeiro');

  const enviada = { fatura: fat({ fenix_ajuste_status: 'ENVIADO' }), ctes: fenix };
  assert.equal(etapaFenix(enviada), 'AGUARDANDO');
  assert.equal(proximaAcao(enviada), 'Aguardar retorno do financeiro (Fênix)');
  // Sem o resumo dos CT-es continua aguardando.
  assert.equal(etapaFenix({ fatura: enviada.fatura }), 'AGUARDANDO');

  // Retorno manual (SAP ainda nao reimportado) ou sozinho (Fenix sumiu do SAP).
  assert.equal(etapaFenix({ fatura: fat({ fenix_ajuste_status: 'RETORNADO' }), ctes: fenix }), 'RETORNO');
  const voltou = { fatura: fat({ fenix_ajuste_status: 'ENVIADO' }), ctes: limpo };
  assert.equal(etapaFenix(voltou), 'RETORNO');
  assert.deepEqual(pega(voltou), ['fenix_retorno']);
  assert.equal(proximaAcao(voltou), 'Mandar protocolo (Fênix ajustada)');

  const protocolo = { fatura: fat({ fenix_ajuste_status: 'RETORNADO', agrupamento_manual: true }), ctes: limpo };
  assert.equal(etapaFenix(protocolo), 'PROTOCOLO');
  assert.deepEqual(pega(protocolo), ['fenix_protocolo']);

  // Fora do fluxo: sem Fenix e sem marcacao, ou ja paga.
  assert.equal(etapaFenix({ fatura: fat(), ctes: limpo }), '');
  assert.equal(etapaFenix({ fatura: fat({ status: 'PAGA', fenix_ajuste_status: 'ENVIADO' }), ctes: fenix }), '');
});

test('previsão de pagamento: cards, situação e próxima ação', () => {
  const ref = new Date('2026-11-11T12:00:00');
  const fat = (extra = {}) => ({ id: 'p1', status: 'PRONTA_PARA_PAGAMENTO', partida: '5100000009', agrupamento_manual: true, ctes_totais: 1, ctes_auditados: 1, data_vencimento: '2026-11-01', ...extra });
  assert.equal(situacaoPrevisao(fat(), ref), 'SEM_PREVISAO');
  assert.equal(situacaoPrevisao(fat({ data_previsao_pagamento: '2026-11-12' }), ref), 'PREVISTA');
  assert.equal(situacaoPrevisao(fat({ data_previsao_pagamento: '2026-11-11' }), ref), 'PREVISTA');
  assert.equal(situacaoPrevisao(fat({ data_previsao_pagamento: '2026-11-10' }), ref), 'ATRASADA');
  // Paga: a previsao deixa de valer.
  assert.equal(previsaoPagamento(fat({ status: 'PAGA', data_previsao_pagamento: '2026-11-12' })), '');
  const linha = { fatura: fat({ data_previsao_pagamento: '2026-11-12' }), ctes: { total: 1, lancados: 1, nfse: 0, fenix: [] } };
  assert.equal(proximaAcao(linha), 'Aguardar pagamento (previsto 12/11/2026)');
  const grupo = GRUPOS_DIAGNOSTICO.find((g) => g.id === 'previsao');
  const card = (id) => grupo.cards.find((c) => c.id === id).teste;
  assert.ok(card('protocolo_sem_previsao')({ fatura: fat(), ctes: linha.ctes }));
  assert.ok(!card('protocolo_sem_previsao')(linha));
  assert.ok(card('com_previsao')(linha));
  // Fora do protocolo a previsao nao vale: segue o vencimento.
  const foraProtocolo = fat({ agrupamento_manual: false, data_previsao_pagamento: '2026-11-12' });
  assert.equal(previsaoPagamento(foraProtocolo), '');
  assert.ok(!card('protocolo_sem_previsao')({ fatura: foraProtocolo, ctes: linha.ctes }));
  assert.equal(proximaAcao({ fatura: foraProtocolo, ctes: linha.ctes }), 'Aguardar pagamento');
});

test('filtro por auditor: sozinho mostra as em aberto dele; com transportadora ou lista restringe', () => {
  const faturas = [
    { id: 'a', numero_fatura: '10', transportadora: 'WM', auditor_nome: 'Ana', status: 'PENDENTE' },
    { id: 'b', numero_fatura: '11', transportadora: 'WM', auditor_nome: 'Ana', status: 'PAGA' },
    { id: 'c', numero_fatura: '12', transportadora: 'WM', auditor_nome: 'Bruno', status: 'PENDENTE' },
    { id: 'd', numero_fatura: '13', transportadora: 'XP', auditor_nome: 'Ana', status: 'CANCELADA' },
    { id: 'e', numero_fatura: '14', transportadora: 'XP', auditor_nome: '', status: 'PENDENTE' },
  ];
  const ids = (ls) => ls.map((l) => l.fatura?.id || l.numero);
  // Sozinho: as em aberto e as canceladas (estas so aparecem no card "Canceladas").
  assert.deepEqual(ids(montarLinhasDiagnostico({ faturas, auditor: 'Ana' })), ['a', 'd']);
  assert.deepEqual(ids(montarLinhasDiagnostico({ faturas, auditor: 'Sem auditor' })), ['e']);
  assert.deepEqual(ids(montarLinhasDiagnostico({ faturas, transportadora: 'WM', auditor: 'Ana' })), ['a', 'b']);
  // Visao do gestor: em aberto (e canceladas) de todos os auditores.
  assert.deepEqual(ids(montarLinhasDiagnostico({ faturas, todos: true })), ['a', 'c', 'd', 'e']);
  assert.deepEqual(ids(montarLinhasDiagnostico({ faturas })), []);
  const { itens } = parseListaFaturas('10\n12\n999');
  assert.deepEqual(ids(montarLinhasDiagnostico({ itens, faturas, auditor: 'Ana' })), ['a', '999']);
});

test('duplicadas: mesma fatura em dois CNPJs, a paga fica valendo; mesma transportadora em aberto fica a mais antiga', async () => {
  const { detectarDuplicadas, criarAgrupadorTransportadoras } = await import('../src/utils/diagnosticoFaturas.js');
  const faturas = [
    { id: 'paga', numero_fatura: '498', transportadora: 'FLORESTA', cnpj_transportadora: '48733968000153', valor_fatura: 3190.7, data_emissao: '2026-08-04', status: 'PAGA', created_at: '2026-08-13' },
    { id: 'copia', numero_fatura: '498', transportadora: 'FLORESTA LOGISTICA LTDA', cnpj_transportadora: '22163228000135', valor_fatura: 3190.7, data_emissao: '2026-08-04', status: 'RECEBIDA', created_at: '2026-08-06' },
    { id: 'a1', numero_fatura: '0010', transportadora: 'ALFA', cnpj_transportadora: '11111111000100', valor_fatura: 100, data_emissao: '2026-09-01', status: 'RECEBIDA', created_at: '2026-09-02' },
    { id: 'a2', numero_fatura: '10', transportadora: 'ALFA TRANSPORTES', cnpj_transportadora: '11111111000200', valor_fatura: 100, data_emissao: '2026-09-01', status: 'RECEBIDA', created_at: '2026-09-05' },
    // Mesmo numero/valor/emissao em outra empresa, nenhuma paga: coincidencia, nao marca.
    { id: 'x1', numero_fatura: '7', transportadora: 'BETA', cnpj_transportadora: '33333333000100', valor_fatura: 50, data_emissao: '2026-09-01', status: 'RECEBIDA' },
    { id: 'x2', numero_fatura: '7', transportadora: 'GAMA', cnpj_transportadora: '44444444000100', valor_fatura: 50, data_emissao: '2026-09-01', status: 'RECEBIDA' },
    { id: 'canc', numero_fatura: '10', transportadora: 'ALFA', cnpj_transportadora: '11111111000100', valor_fatura: 100, data_emissao: '2026-09-01', status: 'CANCELADA' },
  ];
  const { chaveDaFatura } = criarAgrupadorTransportadoras(faturas);
  const dup = detectarDuplicadas(faturas, chaveDaFatura);
  assert.deepEqual([...dup.keys()].sort(), ['a2', 'copia']);
  assert.equal(dup.get('copia').principal.id, 'paga');
  assert.equal(dup.get('copia').motivo, 'PAGA_EM_OUTRO_CNPJ');
  assert.equal(dup.get('a2').principal.id, 'a1');
});

test('agrupador: nomes e CNPJs do mesmo cadastro viram uma transportadora so', async () => {
  const { criarAgrupadorTransportadoras } = await import('../src/utils/diagnosticoFaturas.js');
  const faturas = [
    { id: '1', transportadora: 'FLORESTA', cnpj_transportadora: '48733968000153' },
    { id: '2', transportadora: 'FLORESTA LOGISTICA LTDA', cnpj_transportadora: '22163228000135' },
    { id: '3', transportadora: 'FLORESTA LOGISTICA LTDA - PRUDENTE', cnpj_transportadora: '22163228000488' },
    { id: '4', transportadora: 'GENEROSO LTDA', cnpj_transportadora: '29453826000100' },
    { id: '5', transportadora: 'TRANSPORTE GENEROSO', cnpj_transportadora: '29453826000200' },
    { id: '6', transportadora: 'TRANSPORTE GENEROSO', cnpj_transportadora: '29453826000200' },
    { id: '7', transportadora: 'SEM CNPJ', cnpj_transportadora: '' },
  ];
  const cadastro = new Map([['48733968', { id: 't1', nome: 'FLORESTA' }], ['22163228', { id: 't1', nome: 'FLORESTA' }]]);
  const { opcoes, filtro } = criarAgrupadorTransportadoras(faturas, cadastro);
  assert.deepEqual(opcoes.map((o) => o.rotulo), ['FLORESTA', 'SEM CNPJ', 'TRANSPORTE GENEROSO']);
  assert.deepEqual(faturas.filter(filtro('FLORESTA')).map((f) => f.id), ['1', '2', '3']);
  // Nome antigo salvo na sessao continua funcionando.
  assert.deepEqual(faturas.filter(filtro('FLORESTA LOGISTICA LTDA')).map((f) => f.id), ['1', '2', '3']);
  assert.deepEqual(faturas.filter(filtro('TRANSPORTE GENEROSO')).map((f) => f.id), ['4', '5', '6']);
});

test('unifica o mesmo auditor gravado com nomes diferentes', () => {
  const nomes = ['Paulo Ricardo', 'Paulo Ricardo dos Santos', 'Alisson Lucas', 'Alisson Silva', 'Alisson Lucas da Silva', 'Deborah', 'Deborah Winnie Moraes Thomazi', 'Rudieris Rodrigues dos Santos', ''];
  const faturas = nomes.map((n, i) => ({ id: String(i), auditor_nome: n, status: 'RECEBIDA' }));
  const u = criarUnificadorAuditores(faturas);
  assert.deepEqual(u.opcoes, ['Alisson Lucas da Silva', 'Deborah Winnie Moraes Thomazi', 'Paulo Ricardo dos Santos', 'Rudieris Rodrigues dos Santos']);
  assert.equal(u.canonico('paulo ricardo'), 'Paulo Ricardo dos Santos');
  assert.equal(u.nome(faturas[8]), 'Sem auditor');
  const ids = montarLinhasDiagnostico({ faturas, auditor: 'Paulo Ricardo dos Santos', nomeDoAuditor: u.nome }).map((l) => l.fatura.id);
  assert.deepEqual(ids, ['0', '1']);
  // Nome curto que cabe em duas pessoas diferentes nao e juntado.
  assert.deepEqual(criarUnificadorAuditores([{ auditor_nome: 'Ana' }, { auditor_nome: 'Ana Souza' }, { auditor_nome: 'Ana Lima' }]).opcoes, ['Ana', 'Ana Lima', 'Ana Souza']);
  // Mesmo e-mail junta mesmo sem nome contido; usuario logado e achado pelo e-mail.
  const porEmail = criarUnificadorAuditores([{ auditor_nome: 'Bia R', auditor_email: 'b@x.com' }, { auditor_nome: 'Bianca Ruzzante', auditor_email: 'B@X.com' }]);
  assert.deepEqual(porEmail.opcoes, ['Bianca Ruzzante']);
  assert.equal(porEmail.doUsuario({ email: 'b@x.com' }), 'Bianca Ruzzante');
});
