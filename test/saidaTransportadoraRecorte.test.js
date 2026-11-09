import test from 'node:test';
import assert from 'node:assert/strict';
import { intervaloEmissao, janelasEmissao, pesoComoSimuladorRealizado } from '../src/utils/saidaTransportadoraRecorte.js';

test('competência vira o mês inteiro por data de emissão (fim exclusivo)', () => {
  assert.deepEqual(intervaloEmissao({ competencia: '2026-10' }), { inicio: '2026-10-01', fimExclusivo: '2026-11-01' });
  assert.deepEqual(intervaloEmissao({ competencia: '2026-12' }), { inicio: '2026-12-01', fimExclusivo: '2027-01-01' });
});

test('período tem prioridade e inclui o último dia inteiro', () => {
  assert.deepEqual(intervaloEmissao({ competencia: '2026-10', dataInicio: '2026-09-05', dataFim: '2026-09-30' }), { inicio: '2026-09-05', fimExclusivo: '2026-10-01' });
  assert.deepEqual(intervaloEmissao({ dataFim: '2026-06-31' }), { inicio: '', fimExclusivo: '2026-07-01' });
});

test('janelas diárias cobrem o intervalo sem buracos', () => {
  const j = janelasEmissao({ inicio: '2026-10-01', fimExclusivo: '2026-11-01' }, 1);
  assert.equal(j.length, 31);
  assert.equal(j[0].inicio, '2026-10-01');
  assert.equal(j.at(-1).fimExclusivo, '2026-11-01');
});

test('peso igual ao simulador: peso do CT-e, declarado só como fallback, sem cubado', () => {
  assert.equal(pesoComoSimuladorRealizado({ peso: 12, peso_declarado: 30, peso_cubado: 80 }), 12);
  assert.equal(pesoComoSimuladorRealizado({ peso: 0, peso_declarado: 30 }), 30);
});

import { unificarTransportadorasCtes } from '../src/utils/unificarTransportadorasCte.js';
import { aplicarPoliticaBaseCte } from '../src/services/cteBasePolicy.js';

test('resumo agregado: política de base e unificação contam CT-es pelo __qtdCtes', () => {
  const resumo = [
    { transportadora: 'LTSL BAHIA ENCOMENDAS', cnpj_transportadora: '11222333', tomador_servico: 'CPX', __qtdCtes: 40, __valorCte: 4000 },
    { transportadora: 'LTSL ENCOMENDAS ', cnpj_transportadora: '11222333', tomador_servico: 'CPX', __qtdCtes: 10, __valorCte: 900 },
    { transportadora: 'LTSL ENCOMENDAS ', cnpj_transportadora: '11222333', tomador_servico: 'EBAZAR', __qtdCtes: 99, __valorCte: 1 },
    { transportadora: 'OUTRA', cnpj_transportadora: '99888777', tomador_servico: 'FORA DA LISTA', __qtdCtes: 5, __valorCte: 50 },
  ];
  const filtrado = aplicarPoliticaBaseCte(resumo, { ocultarEbazar: true, incluirCpsLog: false, incluirCpComercial: false });
  assert.equal(filtrado.length, 2);
  const u = unificarTransportadorasCtes(filtrado, {});
  assert.equal(u.grupos.length, 1);
  assert.equal(u.grupos[0].ctes, 50);
  assert.equal(u.grupos[0].nome, 'LTSL BAHIA ENCOMENDAS');
  // nomes como estão no banco (com espaço) seguem acessíveis pela linha
  assert.equal(u.nomeDoCte(filtrado[1]), 'LTSL BAHIA ENCOMENDAS');
});

import { localPadronizado, montarMunicipioPorIbge, rotuloLocal } from '../src/utils/saidaTransportadoraRecorte.js';

test('padroniza cidade/UF pelo IBGE (sem UF, com acento, UF errada)', () => {
  const mapa = montarMunicipioPorIbge([
    { ibge: '2910800', cidade: 'Feira de Santana', uf: 'BA' },
    { ibge: '3205002', cidade: 'Serra', uf: 'ES' },
  ]);
  assert.deepEqual(localPadronizado({ cidade: 'FEIRA DE SANTANA/', uf: '', ibge: '2910800' }, mapa), { cidade: 'FEIRA DE SANTANA', uf: 'BA' });
  assert.deepEqual(localPadronizado({ cidade: 'Serra', uf: 'BA', ibge: '3205002' }, mapa), { cidade: 'SERRA', uf: 'ES' });
  // IBGE fora do cadastro: UF vem do código; sem IBGE: texto limpo
  assert.deepEqual(localPadronizado({ cidade: 'Simões Filho', uf: '', ibge: '2930709' }, mapa), { cidade: 'SIMOES FILHO', uf: 'BA' });
  assert.deepEqual(localPadronizado({ cidade: 'Simoes Filho/', uf: '' }, mapa), { cidade: 'SIMOES FILHO', uf: '' });
  assert.equal(rotuloLocal('SIMOES FILHO', ''), 'SIMOES FILHO');
});
