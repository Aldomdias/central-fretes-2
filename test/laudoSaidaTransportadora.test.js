import test from 'node:test';
import assert from 'node:assert/strict';
import { consolidarLaudoSaida, gerarHtmlLaudoSaida, montarAbasExcelLaudoSaida, NIVEL, DECISAO } from '../src/utils/laudoSaidaTransportadora.js';
import { unificarTransportadorasCtes, raizCnpjDoCte } from '../src/utils/unificarTransportadorasCte.js';

const viagem = (valorPago, substituta, valorSub, prazoAtual = 3, prazoSub = 3) => ({ chave: 'x', data: '2026-10-01', nf: 1000, peso: 10, valorPago, valorTabelaAtual: null, prazoAtual, substituta, valorSub, prazoSub });

const resultado = {
  pctReajuste: 20, semIbge: 0, prazoAtualMedioGeral: 3, prazoSubMedioGeral: 4,
  linhas: [
    // migra: substituta 90 < 120 (reajuste)
    { rotaKey: 'A', cidadeOrigem: 'ITAJAI', ufOrigem: 'SC', cidadeDestino: 'CURITIBA', ufDestino: 'PR', ctes: 1, valorPagoTotal: 100, melhorTotal: 90, semSubstituto: 0,
      prazoAtualMedio: 2, prazoSubMedio: 4, substitutoPrincipal: 'SUB1',
      substitutos: [{ transportadora: 'SUB1', ctesCobertos: 1, custoMedio: 90, prazoMedio: 4 }, { transportadora: 'SUB2', ctesCobertos: 1, custoMedio: 95, prazoMedio: 2 }],
      viagens: [viagem(100, 'SUB1', 90, 2, 4)] },
    // sem substituto
    { rotaKey: 'B', cidadeOrigem: 'ITAJAI', ufOrigem: 'SC', cidadeDestino: 'MANAUS', ufDestino: 'AM', ctes: 1, valorPagoTotal: 200, melhorTotal: 200, semSubstituto: 1,
      prazoAtualMedio: 10, prazoSubMedio: null, substitutoPrincipal: null, substitutos: [], viagens: [viagem(200, null, null, 10, null)] },
    // única e mais cara que reajuste
    { rotaKey: 'C', cidadeOrigem: 'ITAJAI', ufOrigem: 'SC', cidadeDestino: 'RECIFE', ufDestino: 'PE', ctes: 1, valorPagoTotal: 100, melhorTotal: 150, semSubstituto: 0,
      prazoAtualMedio: 5, prazoSubMedio: 5, substitutoPrincipal: 'SUB1',
      substitutos: [{ transportadora: 'SUB1', ctesCobertos: 1, custoMedio: 150, prazoMedio: 5 }], viagens: [viagem(100, 'SUB1', 150, 5, 5)] },
  ],
};

test('classifica rotas e monta cenários do laudo de saída', () => {
  const L = consolidarLaudoSaida(resultado, { transportadora: 'LTSL ENCOMENDAS' });
  const [a, b, c] = L.rotas;
  assert.equal(a.decisao, DECISAO.MIGRAR); assert.equal(a.nivel, NIVEL.ATENCAO); assert.equal(a.alternativaSemPiora.transportadora, 'SUB2');
  assert.equal(b.decisao, DECISAO.MANTER_SEM_OPCAO); assert.equal(b.nivel, NIVEL.CRITICA);
  assert.equal(c.decisao, DECISAO.MANTER_REAJUSTE); assert.ok(c.alertas.some((x) => /única/.test(x)));
  assert.equal(L.totais.custoAtual, 400); assert.equal(L.totais.custoReajuste, 480);
  assert.equal(L.totais.custoSaidaTotal, 440); assert.equal(L.totais.custoHibrido, 90 + 240 + 120);
  assert.equal(L.totais.valorDescoberto, 200); assert.equal(L.tom, 'parcial');
  assert.equal(L.substitutas[0].transportadora, 'SUB1'); assert.equal(L.substitutas[0].ctesAssumidos, 2); assert.equal(L.substitutas[0].rotasUnica, 1);
  assert.equal(L.impactoPrazo.length, 1);
});

test('gera HTML e abas do Excel', () => {
  const html = gerarHtmlLaudoSaida(resultado, { transportadora: 'LTSL ENCOMENDAS', variantes: ['LTSL BAHIA', 'LTSL ENCOMENDAS'], reajustePct: 20 });
  assert.match(html, /Laudo de Saída de Transportadora — LTSL ENCOMENDAS/); assert.match(html, /SAÍDA PARCIAL/);
  assert.match(html, /MANAUS\/AM/); assert.match(html, /Impacto de prazo|impacto de prazo/); assert.match(html, /window\.print/);
  const abas = montarAbasExcelLaudoSaida(resultado, { transportadora: 'X' });
  assert.deepEqual(abas.map((a) => a.nome), ['Resumo', 'Por origem', 'Rotas', 'Rotas críticas', 'Impacto de prazo', 'Substitutas', 'Opções por rota', 'CT-es']);
  abas.forEach((a) => a.linhas.forEach((l) => assert.equal(l.length, a.colunas.length, a.nome)));
});

test('unifica nomes do CT-e pela raiz do CNPJ e pelo cadastro', () => {
  const chave = (cnpj) => `422610${cnpj}5700100000001100000001000`.slice(0, 44);
  const ctes = [
    { transportadora: 'LTSL BAHIA ENCOMENDAS URGENTES LTDA', chave_cte: chave('11222333000144') },
    { transportadora: 'LTSL ENCOMENDAS', chave_cte: chave('11222333000225') },
    { transportadora: 'LC', cnpj_transportadora: '99888777000100' },
    { transportadora: 'LC ENCOMENDAS', cnpj_transportadora: '99888777000290' },
    { transportadora: 'OUTRA', cnpj_transportadora: '55555555000100' },
  ];
  assert.equal(raizCnpjDoCte(ctes[0]), '11222333');
  const u = unificarTransportadorasCtes(ctes, { cadastro: [{ nome: 'LTSL ENCOMENDAS', raizes: ['11222333'] }] });
  assert.equal(u.grupos.length, 3);
  assert.equal(u.nomeDoCte(ctes[0]), 'LTSL ENCOMENDAS');
  const lc = u.grupos.find((g) => g.variantes.includes('LC'));
  assert.deepEqual(lc.variantes, ['LC', 'LC ENCOMENDAS']);
  // vínculo sem CNPJ também une
  const v = unificarTransportadorasCtes([{ transportadora: 'A1' }, { transportadora: 'A2' }], { aplicarVinculo: (n) => (n === 'A1' ? 'A2' : n) });
  assert.equal(v.grupos.length, 1); assert.equal(v.grupos[0].nome, 'A2');
});

test('laudo enxuto mostra filtro de origem/destino e não traz mais o detalhamento completo', () => {
  const html = gerarHtmlLaudoSaida(resultado, { transportadora: 'LTSL ENCOMENDAS', reajustePct: 20, filtroRotas: 'Origem UF SC' });
  assert.match(html, /Filtro: Origem UF SC/);
  assert.match(html, /Resumo por situação/); assert.match(html, /Sem substituta/); assert.match(html, /Substituta mais cara que hoje/);
  assert.match(html, /Quem assumiria o volume/);
  assert.doesNotMatch(html, /Detalhamento completo por rota/);
  const abas = montarAbasExcelLaudoSaida(resultado, { transportadora: 'X', filtroRotas: 'Origem UF SC' });
  assert.ok(abas[0].linhas.some((l) => l.includes('Origem UF SC')));
});

test('resumo por origem separa recomendação de cada origem', async () => {
  const { resumirPorOrigem, analisarRota, RECOMENDACAO_ORIGEM } = await import('../src/utils/laudoSaidaTransportadora.js');
  const rota = (origem, pago, sub, qtd = 1) => analisarRota({
    rotaKey: `${origem}-x`, cidadeOrigem: origem, ufOrigem: 'SC', cidadeDestino: 'X', ufDestino: 'SP', ctes: 1, valorPagoTotal: pago, melhorTotal: sub,
    semSubstituto: 0, substitutos: Array.from({ length: qtd }, (_, i) => ({ transportadora: `S${i}`, ctesCobertos: 1, custoMedio: sub, prazoMedio: 2 })),
    viagens: [{ valorPago: pago, substituta: 'S0', valorSub: sub }], prazoAtualMedio: 2, prazoSubMedio: 2, substitutoPrincipal: 'S0',
  }, 20);
  const res = resumirPorOrigem([rota('ITAJAI', 100, 90, 2), rota('JOINVILLE', 100, 150, 2)]);
  const porNome = Object.fromEntries(res.map((o) => [o.origem, o]));
  assert.equal(porNome['ITAJAI/SC'].recomendacao, RECOMENDACAO_ORIGEM.TROCAR);
  assert.equal(porNome['JOINVILLE/SC'].recomendacao, RECOMENDACAO_ORIGEM.MANTER);
  const html = gerarHtmlLaudoSaida(resultado, { transportadora: 'X', reajustePct: 20 });
  assert.match(html, /Por origem/);
});

test('reajuste por CT-e (tabela nova) substitui o percentual no laudo', async () => {
  const { analisarRota, consolidarLaudoSaida } = await import('../src/utils/laudoSaidaTransportadora.js');
  const linha = {
    rotaKey: 'a', cidadeOrigem: 'ITAJAI', ufOrigem: 'SC', cidadeDestino: 'X', ufDestino: 'SP', ctes: 2, valorPagoTotal: 200, melhorTotal: 230,
    valorReajustadoTotal: 216, semSubstituto: 1, substitutos: [{ transportadora: 'S', ctesCobertos: 1, custoMedio: 120, prazoMedio: 2 }],
    viagens: [{ valorPago: 100, valorReajustado: 108, substituta: 'S', valorSub: 130 }, { valorPago: 100, valorReajustado: 108, substituta: null }],
    prazoAtualMedio: 2, prazoSubMedio: 2, substitutoPrincipal: 'S',
  };
  const r = analisarRota(linha, 50); // percentual ignorado: vem pronto por CT-e
  assert.equal(r.custoReajuste, 216);
  assert.equal(r.custoMigrar, 130 + 108);
  const L = consolidarLaudoSaida({ linhas: [linha], pctReajuste: 50 }, { reajusteRotulo: 'tabela nova X' });
  assert.equal(Math.round(L.contexto.pctReajuste * 10) / 10, 8);
  assert.match(gerarHtmlLaudoSaida({ linhas: [linha], pctReajuste: 50 }, { transportadora: 'T', reajusteRotulo: 'tabela nova X' }), /Com a tabela nova \(\+8,0%\)/);
});
