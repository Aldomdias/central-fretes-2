import test from 'node:test';
import assert from 'node:assert/strict';
import { auditarResultadoIa, deduplicarLinhasParaIa, normalizarResultadoIa, validarResultadoIa } from '../src/utils/importacaoIaNegociacao.js';

test('deduplicacao preserva linhas distintas quando nenhum cabecalho foi mapeado', () => {
  const linhas = [
    { __aba: 'TABELA', __EMPTY: 'PR', __EMPTY_1: '1,25' },
    { __aba: 'TABELA', __EMPTY: 'SC', __EMPTY_1: '1,40' },
    { __aba: 'TABELA', __EMPTY: 'PR', __EMPTY_1: '1,25' },
  ];

  const unicas = deduplicarLinhasParaIa(linhas, {});
  assert.equal(unicas.length, 2);
  assert.equal(unicas[0].__EMPTY, 'PR');
  assert.equal(unicas[1].__EMPTY, 'SC');
});

test('converte a saída da IA em itens de rota e cotação da negociação', () => {
  const resultado = normalizarResultadoIa({
    transportadora: 'Teste Log',
    origem: { cidade: 'Itajaí', uf: 'SC', ibge: '4208203' },
    vigencia: { inicio: '2026-09-01', fim: '2027-08-31' },
    rotas: [{ cotacao: 'SP-CAPITAL', cidade_destino: 'São Paulo', uf_destino: 'SP', ibge_destino: '3550308', prazo: 2 }],
    fretes: [{ rota_do_frete: 'SP-CAPITAL', peso_minimo: 0, peso_limite: 10, taxa_aplicada: 30, frete_percentual: 0.5 }],
    generalidades: { gris: 0.2 },
    gaps: [],
  });

  assert.equal(resultado.itens.length, 2);
  assert.equal(resultado.itens[0].tipo_item, 'ROTA');
  assert.equal(resultado.itens[0].ibge_origem, '4208203');
  assert.equal(resultado.itens[1].tipo_item, 'COTACAO');
  assert.equal(resultado.itens[1].faixa_peso, 'SP-CAPITAL');
  const falhas = auditarResultadoIa(resultado, { mapeamento: { origem: 'ORIGEM', rota: 'ROTA', taxa: 'VALOR' } });
  assert.equal(falhas.filter((item) => item.severidade === 'BLOQUEANTE').length, 0);
  assert.deepEqual(validarResultadoIa(resultado, { mapeamento: { origem: 'ORIGEM', rota: 'ROTA', taxa: 'VALOR' } }), []);
});

test('bloqueia disponibilização de resposta incompleta', () => {
  assert.ok(validarResultadoIa({}).length >= 4);
});

test('mapeia frete sem rota, faixa sobreposta, IBGE e prazo ausentes', () => {
  const resultado = {
    transportadora: 'Teste',
    vigencia: { inicio: '2026-09-01', fim: '2027-01-01' },
    rotas: [{ cotacao: 'SP-CAP', ibge_destino: '', prazo: 999 }],
    fretes: [
      { cotacao: 'SP-CAP', peso_inicial: 0, peso_final: 10, taxa_aplicada: 20 },
      { cotacao: 'SP-CAP', peso_inicial: 8, peso_final: 20, taxa_aplicada: 30 },
      { cotacao: 'RJ-CAP', peso_inicial: 0, peso_final: 10, taxa_aplicada: 20 },
    ],
    gaps: [],
  };
  const codigos = auditarResultadoIa(resultado, { mapeamento: { origem: 'ORIGEM', rota: 'ROTA', taxa: 'VALOR' } }).map((item) => item.codigo);
  assert.ok(codigos.includes('FRETE_SEM_ROTA'));
  assert.ok(codigos.includes('IBGE_DESTINO_AUSENTE'));
  assert.ok(codigos.includes('PRAZO_PENDENTE'));
  assert.ok(codigos.includes('SOBREPOSICAO_FAIXA_PESO'));
});
