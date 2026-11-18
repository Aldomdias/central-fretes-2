import test from 'node:test';
import assert from 'node:assert/strict';
import {
  avaliarEstornoSap, compararReferenciasFatura, conciliarPagamentosPortal,
  previsaoInicialFinanceiro, situacaoFinanceiro,
  vincularBoletosLidos,
} from '../src/utils/portalFinanceiroDomain.js';
import { conciliarPagamentosSap } from '../src/utils/auditoriaFretesDomain.js';

const fatura = (extra = {}) => ({ id: 'f1', numero_fatura: '3240', cnpj_transportadora: '11222333000144', codigo_fornecedor: 'ATUAL', empresa: '1000', valor_fatura: 105, moeda: 'BRL', data_vencimento: '2026-11-30', status: 'PRONTA_PARA_PAGAMENTO', ...extra });
const pagamento = (extra = {}) => ({ id: 'p1', referencia_fatura: '00032402026', cnpj: '11222333000144', codigo_fornecedor: 'ATUAL', empresa: '1000', valor_pago: 105, moeda: 'BRL', vencimento: '2026-11-30', partida: '2000001', compensado: true, disponivel_para_vinculo: true, data_pagamento: '2026-11-18', ...extra });

test('referencia SAP casa nos dois sentidos, com zeros e sufixo de ano', () => {
  assert.equal(compararReferenciasFatura('3240', '00032402026').corresponde, true);
  assert.equal(compararReferenciasFatura('32402026', '3240').corresponde, true);
  assert.equal(compararReferenciasFatura('3240', '3440').corresponde, false);
});

test('boletos: vinculo inequivoco, repetido, versao, ilegivel e ambiguidade', () => {
  const arquivo = { hash_conteudo: 'h1', referencia_fatura: '00032402026', cnpj: '11222333000144', valor: 105, vencimento: '2026-11-30', legivel: true };
  assert.equal(vincularBoletosLidos([arquivo], [fatura()])[0].status, 'LOCALIZADO_NA_PASTA');
  assert.equal(vincularBoletosLidos([arquivo], [fatura()], [{ hash_conteudo: 'h1', fatura_id: 'f1' }])[0].status, 'REPETIDO');
  assert.equal(vincularBoletosLidos([{ ...arquivo, hash_conteudo: 'h2' }], [fatura()])[0].status, 'LOCALIZADO_NA_PASTA');
  assert.equal(vincularBoletosLidos([{ ...arquivo, legivel: false }], [fatura()])[0].motivo, 'ILEGIVEL');
  assert.equal(vincularBoletosLidos([arquivo], [fatura(), fatura({ id: 'f2' })])[0].status, 'VINCULO_A_CONFIRMAR');
  assert.notEqual(vincularBoletosLidos([{ hash_conteudo: 'h3', valor: 105, vencimento: '2026-11-30' }], [fatura()])[0].status, 'LOCALIZADO_NA_PASTA');
});

test('3240 Atual Cargas vincula automaticamente quando todos os campos coincidem', () => {
  const r = conciliarPagamentosPortal([fatura()], [pagamento()]);
  assert.equal(r.vinculados.length, 1);
  assert.equal(r.revisao.length, 0);
  assert.equal(r.vinculados[0].criterio_referencia, 'EXATA_OU_FORMATO');
});

test('importador SAP usa a correspondência formatada somente com todos os campos coincidentes', () => {
  const linha = {
    Referência: '00032402026', 'Nome do fornecedor': 'Atual Cargas', 'Nº ID fiscal 1': '11222333000144',
    'Montante (ME)': 105, 'Status comp.': '1', 'Lançto.compensação': '2000001',
    'Lançamento contábil': '1900001', 'Data de compensação': '18/11/2026',
    Empresa: '1000', Moeda: 'BRL', Vencimento: '30/11/2026',
  };
  assert.equal(conciliarPagamentosSap([fatura()], [linha])[0].fatura_id, 'f1');
  assert.equal(conciliarPagamentosSap([fatura()], [{ ...linha, Vencimento: '01/12/2026' }])[0].resultado, 'DADOS_DIVERGENTES');
});

test('divergencias, ambiguidade, partida usada, fornecedor e estorno nunca vinculam automaticamente', () => {
  for (const alteracao of [
    { vencimento: '2026-12-01' }, { cnpj: '99999999000100', codigo_fornecedor: 'OUTRO' },
    { fatura_id: 'ja-usada' }, { estornado: true }, { partida: '1900001' },
  ]) {
    const r = conciliarPagamentosPortal([fatura()], [pagamento(alteracao)]);
    assert.equal(r.vinculados.length, 0);
    assert.ok(r.revisao.length > 0);
  }
  const ambiguo = conciliarPagamentosPortal([fatura(), fatura({ id: 'f2' })], [pagamento()]);
  assert.equal(ambiguo.vinculados.length, 0);
  assert.ok(ambiguo.revisao.every((x) => x.motivo === 'MULTIPLOS_CANDIDATOS'));
});

test('3440 vai para revisao quando os demais indícios coincidem', () => {
  const r = conciliarPagamentosPortal([fatura()], [pagamento({ referencia_fatura: '3440' })]);
  assert.equal(r.vinculados.length, 0);
  assert.equal(r.revisao.length, 1);
  assert.match(r.revisao[0].motivo, /referencia/);
});

test('estorno 1700013712 anula 1900880705 e relancamento posterior restaura o fluxo', () => {
  const base = [
    { tipo: 'LANCAMENTO', documento: '1900880705', data: '2026-10-01' },
    { tipo: 'ESTORNO', documento: '1700013712', documento_original: '1900880705', anulacao_confirmada: true, data: '2026-10-03', motivo: 'anulação' },
  ];
  assert.equal(avaliarEstornoSap(base).status, 'ESTORNADA_SEM_RELANÇAMENTO');
  assert.equal(avaliarEstornoSap([...base, { tipo: 'LANCAMENTO', documento: '1900999999', data: '2026-10-04' }]).status, 'RELANÇADA');
  assert.equal(avaliarEstornoSap([{ documento: '1700013712', data: '2026-10-03' }]).status, 'REVISAR_INDICIO');
});

test('previsao inicial usa vencimento apenas dentro do prazo e pagamento exige confirmação', () => {
  const ref = new Date('2026-11-18T12:00:00');
  assert.equal(previsaoInicialFinanceiro(fatura(), ref), '2026-11-30');
  assert.equal(previsaoInicialFinanceiro(fatura({ data_vencimento: '2026-11-17' }), ref), '');
  assert.equal(situacaoFinanceiro(fatura({ status: 'PAGA', data_pagamento: '2026-11-18' })), 'AGUARDA_ENCAMINHAMENTO');
  assert.equal(situacaoFinanceiro(fatura({ status: 'PAGA', pagamento_confirmado: true })), 'PAGA');
  assert.equal(situacaoFinanceiro(fatura({ encaminhado_financeiro_em: '2026-11-18', data_previsao_pagamento: '2026-11-30', programacao_confirmada: true })), 'PROGRAMADA');
});



import { conciliarProgramacaoSap as _prog, avaliarEstornoSap as _est, compararReferenciasFatura as _ref } from '../src/utils/portalFinanceiroDomain.js';
import { resultadoAuditoria as _res, pagaComDesconto as _pcd } from '../src/utils/diagnosticoFaturas.js';

test('referência curta (menos de 4 dígitos) não casa por sequência contínua', () => {
  assert.equal(_ref('120045', '12').corresponde, false);
  assert.equal(_ref('3440', '32402026').corresponde, false);
  assert.equal(_ref('3240', '00032402026').corresponde, true);
});

test('estorno: substituta com outro número é relançamento; 200 e 17 isolado não são', () => {
  const l19 = { documento: '1900880705', tipo: 'LANCAMENTO', data: '2026-10-01' };
  const e17 = { documento: '1700013712', tipo: 'ESTORNO', documento_original: '1900880705', data: '2026-10-05' };
  assert.equal(_est([l19, e17]).status, 'ESTORNADA_SEM_RELANÇAMENTO');
  assert.equal(_est([l19, e17, { documento: '2000555111', tipo: 'OUTRO', data: '2026-10-09' }]).status, 'ESTORNADA_SEM_RELANÇAMENTO');
  const nova = { documento: '1900991234', tipo: 'LANCAMENTO', data: '2026-10-08' };
  const r = _est([l19, e17, nova]);
  assert.equal(r.status, 'RELANÇADA');
  assert.equal(r.relancamento.documento, '1900991234');
  assert.equal(_est([l19, { documento: '1700013712', tipo: 'ESTORNO', data: '2026-10-05' }]).status, 'REVISAR_INDICIO');
});

test('programação SAP/HANA: casa por referência + CNPJ (+valor); ambíguo, sem CNPJ e divergente vão para revisão', () => {
  const f = (id, num, extra = {}) => ({ id, numero_fatura: num, cnpj_transportadora: '11222333000144', valor_fatura: 105, status: 'ENVIADA_AO_FINANCEIRO', ...extra });
  const linhas = [
    { 'Referência': '00032402026', CNPJ: '11.222.333/0001-44', 'Data programada': '25/11/2026', Valor: '105,00' },
    { 'Referência': '3440', CNPJ: '11222333000144', 'Data programada': '2026-11-25' },
    { 'Referência': '3240', 'Data programada': '2026-11-25' },
    { 'Referência': '3240', CNPJ: '11222333000144', 'Data programada': '2026-11-25', Valor: '999,00' },
  ];
  const { aplicar, revisao } = _prog(linhas, [f('a', '3240'), f('b', '3441')]);
  assert.equal(aplicar.length, 1);
  assert.deepEqual([aplicar[0].fatura_id, aplicar[0].data, aplicar[0].origem, aplicar[0].confirmada], ['a', '2026-11-25', 'SAP_HANA', true]);
  assert.deepEqual(revisao.map((r) => r.motivo), ['FATURA_NAO_LOCALIZADA_OU_DADOS_DIVERGENTES', 'SEM_CNPJ', 'FATURA_NAO_LOCALIZADA_OU_DADOS_DIVERGENTES']);
  const dupla = _prog([linhas[0]], [f('a', '3240'), f('c', '3240')]);
  assert.equal(dupla.aplicar.length, 0);
  assert.equal(dupla.revisao[0].motivo, 'MULTIPLOS_CANDIDATOS');
  assert.equal(_prog([linhas[0]], [f('a', '3240', { status: 'PAGA' })], { abertaFn: (x) => x.status !== 'PAGA' }).aplicar.length, 0);
});

test('resultado da auditoria separa progresso, resultado e valores', () => {
  const base = { valor_fatura: 1000, ctes_totais: 10, ctes_auditados: 10, ctes_divergentes: 0, diferenca: 0, status: 'PRONTA_PARA_PAGAMENTO' };
  assert.equal(_res({ ...base }).resultado, 'SEM_DIVERGENCIA');
  assert.equal(_res({ ...base, ctes_auditados: 4 }).resultado, 'EM_CONFERENCIA');
  assert.equal(_res({ ...base, ctes_auditados: 4 }).pendentes, 6);
  assert.equal(_res({ ...base, ctes_auditados: 0 }).resultado, 'NAO_INICIADA');
  const div = _res({ ...base, ctes_divergentes: 2, diferenca: 30, status: 'AGUARDANDO_TRANSPORTADORA' });
  assert.equal(div.resultado, 'DIVERGENCIA_EM_TRATATIVA');
  assert.equal(div.apurado, 970);
  assert.equal(_res({ ...base, ctes_divergentes: 2, diferenca: 30, status: 'AUDITADA' }).resultado, 'COM_DIVERGENCIA');
  assert.equal(_res({ ...base, ctes_divergentes: 2, diferenca: 30, status: 'PAGA_COM_DESCONTO' }).resultado, 'DIVERGENCIA_TRATADA');
  assert.equal(_pcd({ status: 'PAGA_COM_DESCONTO', partida: '2000' }), true);
  assert.equal(_pcd({ status: 'PAGA_COM_DESCONTO' }), false);
});

test('resultado da auditoria: diferença só aparece com a conferência concluída', () => {
  const f = { valor_fatura: 1000, ctes_totais: 3, ctes_auditados: 0, diferenca: -500, status: 'RECEBIDA' };
  assert.equal(_res(f).diferenca, 0);
  assert.equal(_res({ ...f, ctes_auditados: 2 }).diferenca, 0);
  assert.equal(_res({ ...f, ctes_auditados: 3 }).diferenca, -500);
});
