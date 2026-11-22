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
  montarFilaProtocolo,
  aptaAntecipacao,
  tipoDocumentoFatura,
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
  // O teste nao pode depender do dia em que a suite roda.
  assert.ok(card('com_previsao')({ ...linha, fatura: fat({ data_previsao_pagamento: '2099-11-12' }) }));
  // A previsão do Financeiro também vale fora da contingência manual.
  const foraProtocolo = fat({ agrupamento_manual: false, data_previsao_pagamento: '2026-11-12' });
  assert.equal(previsaoPagamento(foraProtocolo), '2026-11-12');
  assert.ok(!card('protocolo_sem_previsao')({ fatura: foraProtocolo, ctes: linha.ctes }));
  assert.equal(proximaAcao({ fatura: foraProtocolo, ctes: linha.ctes }), 'Aguardar pagamento (previsto 12/11/2026)');
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

test('fila de protocolo: por auditor e vencimento, sem pagas, estornadas e duplicadas', () => {
  const l = (id, auditor, extra = {}) => ({ auditor, fatura: { id, numero_fatura: id, valor_fatura: 100, data_vencimento: '2026-12-01', status: 'ENVIADA_AO_FINANCEIRO', partida: '1900', ...extra } });
  const { fila, resumoPorAuditor } = montarFilaProtocolo([
    l('b', 'Zeca', { data_vencimento: '2026-11-30' }), l('a', 'Ana'), l('a', 'Ana'),
    l('p', 'Ana', { status: 'PAGA' }), l('e', 'Ana', { sap_estorno_status: 'ESTORNADA_SEM_RELANÇAMENTO' }),
    l('n', 'Ana', { partida: null }), l('m', 'Ana', { partida: null, agrupamento_manual: true }),
  ]);
  assert.deepEqual(fila.map((x) => x.fatura.id), ['a', 'm', 'b']);
  assert.deepEqual(resumoPorAuditor, [{ auditor: 'Ana', quantidade: 2, valor: 200 }, { auditor: 'Zeca', quantidade: 1, valor: 100 }]);
});

test('cards do Financeiro: só contam fatura ativa em aberto; pagas antigas e canceladas ficam fora do acompanhamento', () => {
  const grupo = GRUPOS_DIAGNOSTICO.find((g) => g.id === 'financeiro');
  const teste = (id) => grupo.cards.find((c) => c.id === id).teste;
  const l = (extra) => ({ fatura: { id: 'x', numero_fatura: '1', valor_fatura: 10, status: 'ENVIADA_AO_FINANCEIRO', partida: '1900', ...extra } });
  assert.equal(teste('aguarda_encaminhamento')(l({})), true);
  assert.equal(teste('aguarda_encaminhamento')(l({ status: 'PAGA' })), false, 'paga antiga sem pagamento_confirmado');
  assert.equal(teste('aguarda_encaminhamento')(l({ status: 'CANCELADA' })), false);
  assert.equal(teste('aguarda_encaminhamento')(l({ partida: null })), false, 'não lançada');
  assert.equal(teste('aguarda_encaminhamento')(l({ sap_estorno_status: 'ESTORNADA_SEM_RELANÇAMENTO' })), false);
  assert.equal(teste('encaminhadas_sem_previsao')(l({ encaminhado_financeiro_em: '2026-11-01', status: 'CANCELADA' })), false);
  assert.equal(teste('encaminhadas_sem_previsao')(l({ encaminhado_financeiro_em: '2026-11-01' })), true);
  assert.equal(teste('pagas_financeiro')(l({ status: 'PAGA' })), true, 'paga antiga com partida');
});

test('cards do ERP: enviada sem partida ainda sem resumo de CT-es cai em "Verificando", e a soma fecha', () => {
  const grupo = GRUPOS_DIAGNOSTICO.find((g) => g.id === 'erp');
  const card = (id) => grupo.cards.find((c) => c.id === id).teste;
  const fatura = { id: 'e1', numero_fatura: '9', valor_fatura: 10, status: 'ENVIADA_AO_FINANCEIRO', data_envio_erp: '2026-11-01' };
  const semResumo = { fatura };
  const semCtes = { fatura, ctes: { total: 2, lancados: 0, semPartida: [{}, {}] } };
  const todosCtes = { fatura, ctes: { total: 2, lancados: 2, semPartida: [] } };
  const comPartida = { fatura: { ...fatura, partida: '1900' } };
  const ids = ['enviadas_sem_partida', 'enviadas_partida_ctes', 'enviadas_com_partida', 'enviadas_verificando'];
  const onde = (l) => ids.filter((id) => card(id)(l));
  assert.deepEqual(onde(semResumo), ['enviadas_verificando']);
  assert.deepEqual(onde(semCtes), ['enviadas_sem_partida']);
  assert.deepEqual(onde(todosCtes), ['enviadas_partida_ctes']);
  assert.deepEqual(onde(comPartida), ['enviadas_com_partida']);
  [semResumo, semCtes, todosCtes, comPartida].forEach((l) => assert.equal(card('enviadas')(l), true));
});

test('antecipação: valor mínimo R$ 100, 7+ dias da emissão e 6+ dias até o vencimento', () => {
  const hoje = new Date('2026-11-18T12:00:00');
  const f = (extra) => ({ id: 'a', numero_fatura: '1', valor_fatura: 100, status: 'ENVIADA_AO_FINANCEIRO', data_emissao: '2026-11-11', data_vencimento: '2026-11-24', ...extra });
  assert.equal(aptaAntecipacao(f({}), hoje), true, 'exatamente 100, 7 dias da emissão e 6 até o vencimento');
  assert.equal(aptaAntecipacao(f({ valor_fatura: 99.99 }), hoje), false, 'abaixo de R$ 100');
  assert.equal(aptaAntecipacao(f({ data_emissao: '2026-11-12' }), hoje), false, '6 dias da emissão');
  assert.equal(aptaAntecipacao(f({ data_vencimento: '2026-11-23' }), hoje), false, '5 dias até o vencimento');
  assert.equal(aptaAntecipacao(f({ data_vencimento: '2026-11-28' }), hoje), true, '10 dias até o vencimento também vale');
  assert.equal(aptaAntecipacao(f({ atribuicao_sap: 'Cessão' }), hoje), false, 'já antecipada');
  assert.equal(aptaAntecipacao(f({ antecipacao_enviada: true }), hoje), false, 'já enviada');
  assert.equal(aptaAntecipacao(f({ status: 'PAGA' }), hoje), false, 'paga');
});

test('antecipação: "Aptas" só para fatura só de CT-e; NFS-e tem card próprio; mista não entra em nenhum', () => {
  const grupo = GRUPOS_DIAGNOSTICO.find((g) => g.cards.some((c) => c.id === 'aptas_antecipacao'));
  const aptasCte = grupo.cards.find((c) => c.id === 'aptas_antecipacao').teste;
  const aptasNfse = grupo.cards.find((c) => c.id === 'aptas_antecipacao_nfse').teste;
  const fatura = { id: 'n', numero_fatura: '1', valor_fatura: 500, status: 'ENVIADA_AO_FINANCEIRO', data_emissao: '2020-01-01', data_vencimento: '2099-01-01' };
  const linha = (ctes) => ({ fatura, ctes });
  assert.equal(tipoDocumentoFatura({ total: 3, nfse: 0 }), 'CTE');
  assert.equal(tipoDocumentoFatura({ total: 0, nfse: 2 }), 'NFSE');
  assert.equal(tipoDocumentoFatura({ total: 3, nfse: 1 }), 'MISTA');
  assert.equal(tipoDocumentoFatura({ total: 0, nfse: 0 }), 'SEM_ITENS');
  assert.equal(tipoDocumentoFatura(undefined), 'VERIFICANDO');
  assert.deepEqual([aptasCte(linha({ total: 3, nfse: 0 })), aptasNfse(linha({ total: 3, nfse: 0 }))], [true, false]);
  assert.deepEqual([aptasCte(linha({ total: 0, nfse: 2 })), aptasNfse(linha({ total: 0, nfse: 2 }))], [false, true]);
  assert.deepEqual([aptasCte(linha({ total: 3, nfse: 1 })), aptasNfse(linha({ total: 3, nfse: 1 }))], [false, false]);
  assert.deepEqual([aptasCte(linha(undefined)), aptasNfse(linha(undefined))], [false, false]);
  const pequena = { fatura: { ...fatura, valor_fatura: 50 }, ctes: { total: 1, nfse: 0 } };
  assert.deepEqual([aptasCte(pequena), aptasNfse(pequena)], [false, false]);
});

test('antecipação: apta ainda sem resumo de itens fica em "verificando tipo" (nunca some dos cards)', () => {
  const grupo = GRUPOS_DIAGNOSTICO.find((g) => g.cards.some((c) => c.id === 'aptas_antecipacao'));
  const ids = ['aptas_antecipacao', 'aptas_antecipacao_nfse', 'aptas_antecipacao_verificando'];
  const onde = (l) => ids.filter((id) => grupo.cards.find((c) => c.id === id).teste(l));
  const fatura = { id: 'v', numero_fatura: '1', valor_fatura: 500, status: 'ENVIADA_AO_FINANCEIRO', data_emissao: '2020-01-01', data_vencimento: '2099-01-01' };
  assert.deepEqual(onde({ fatura }), ['aptas_antecipacao_verificando']);
  assert.deepEqual(onde({ fatura, ctes: { total: 2, nfse: 0 } }), ['aptas_antecipacao']);
  assert.deepEqual(onde({ fatura, ctes: { total: 0, nfse: 1 } }), ['aptas_antecipacao_nfse']);
  assert.deepEqual(onde({ fatura: { ...fatura, valor_fatura: 10 } }), []);
});

test('envio ao SAP pelo OMS: so com todas as partidas e sem compensacao', async () => {
  const { aptidaoEnvioSap, situacaoOms } = await import('../src/utils/diagnosticoFaturas.js');
  const resumo = (extra) => ({ total: 2, lancados: 2, nfse: 0, semPartida: [], compensados: [], ...extra });
  assert.equal(aptidaoEnvioSap(resumo()).apta, true);
  assert.equal(aptidaoEnvioSap(null).apta, false);
  assert.equal(aptidaoEnvioSap({ total: 0, nfse: 0 }).apta, false);
  assert.equal(aptidaoEnvioSap({ total: 0, nfse: 2, semPartida: [], compensados: [] }).apta, true);
  const sem = aptidaoEnvioSap(resumo({ semPartida: [{ numero_cte: '11' }, { numero_cte: '12', estornado: true }] }));
  assert.equal(sem.apta, false);
  assert.match(sem.mensagem, /sem partida: 11/);
  assert.match(sem.mensagem, /partida estornada: 12/);
  const comp = aptidaoEnvioSap(resumo({ compensados: [{ numero_cte: '13', fenix: true }, { numero_cte: '14', documento_compensacao: '999' }] }));
  assert.match(comp.mensagem, /Fênix: 13/);
  assert.match(comp.mensagem, /partida compensada: 14/);

  const f = (extra) => ({ id: 'f', status: 'PRONTA_PARA_PAGAMENTO', oms_invoice_id: '6566f0a1b2c3d4e5f6a7b8c9', ...extra });
  assert.equal(situacaoOms({ fatura: f(), ctes: resumo() }), 'APTA');
  assert.equal(situacaoOms({ fatura: f(), ctes: resumo({ semPartida: [{ numero_cte: '1' }] }) }), 'BLOQUEADA_PARTIDA');
  assert.equal(situacaoOms({ fatura: f({ oms_invoice_id: null }), ctes: resumo() }), 'SEM_ID');
  assert.equal(situacaoOms({ fatura: f({ status: 'RECEBIDA' }), ctes: resumo() }), 'NAO_LIBERADA');
  assert.equal(situacaoOms({ fatura: f(), ctes: resumo(), oms: { status: 'enviado', outcome: 'queuedForErp' } }), 'FILA');
  assert.equal(situacaoOms({ fatura: f(), oms: { status: 'enviado', sent_to_erp: true } }), 'ENVIADA');
  assert.equal(situacaoOms({ fatura: f(), oms: { status: 'recusado' } }), 'ERRO');
  assert.equal(situacaoOms({ fatura: f(), oms: { status: 'enviando' } }), 'AGUARDANDO');
  // Ja lancada na fatura: nao e apta nem bloqueada (nem com Fenix).
  assert.equal(situacaoOms({ fatura: f({ partida: '1900000001' }), ctes: resumo() }), 'LANCADA');
  assert.equal(situacaoOms({ fatura: f({ lancamento_financeiro: true }), ctes: resumo({ semPartida: [{ numero_cte: '1' }] }) }), 'LANCADA');
  assert.equal(situacaoOms({ fatura: f({ partida: '1900000001' }), oms: { status: 'enviado', sent_to_erp: true } }), 'ENVIADA');
});

test('CNPJ do emissor invalido (lixo da importacao) cai para o CNPJ da transportadora', async () => {
  const { identificacaoSapDoCte, cnpjValido } = await import('../src/utils/diagnosticoFaturas.js');
  assert.equal(cnpjValido('00000000013713'), false);
  assert.equal(cnpjValido('03011765000115'), true);
  const id = identificacaoSapDoCte({ chave_cte: '', numero_cte: '4705872', serie_cte: '2', cnpj_emissor: '00000000013713', cnpj_transportadora: '03011765000115' });
  assert.equal(id.cnpj, '03011765000115');
  assert.equal(id.numero, '4705872');
});

test('auditoria exata: 100% gravado na fatura nao vale sem a contagem exata dos CT-es', async () => {
  const { situacaoAuditoria, sobreporAuditoriaExata } = await import('../src/utils/diagnosticoFaturas.js');
  const f = { id: 'x', status: 'COM_DIVERGENCIA', ctes_totais: 10, ctes_auditados: 10 };
  assert.equal(situacaoAuditoria(f), 'AUDITADA'); // sem conferencia (outros usos): como antes
  assert.equal(situacaoAuditoria({ ...f, ctes_conferidos: false }), 'VERIFICANDO');
  // a tela da fatura conta 0 de 10 calculados: a capa tem que dizer isso
  assert.equal(situacaoAuditoria(sobreporAuditoriaExata(f, { total: 10, calculados: 0 })), 'NAO_AUDITADA');
  assert.equal(situacaoAuditoria(sobreporAuditoriaExata(f, { total: 10, calculados: 4 })), 'PARCIAL');
  assert.equal(situacaoAuditoria(sobreporAuditoriaExata(f, { total: 10, calculados: 10 })), 'AUDITADA');
});
