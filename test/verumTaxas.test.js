import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { gerarArquivosVerum } from '../src/utils/importacao.js';
import { gerarDadosVerum, opcoesTaxasVerum, excessoVerum } from '../src/utils/verumTaxas.js';

function base(taxas) {
  return { nome: 'Teste', origens: [{ cidade: 'Itajaí', canal: 'ATACADO',
    rotas: taxas.map((t) => ({ ibgeDestino: t.ibgeDestino, cotacao: 'SC' })),
    cotacoes: [{ rota: 'SC', pesoMin: 0, pesoMax: 10 }, { rota: 'SC', pesoMin: 10, pesoMax: 20 }],
    taxasEspeciais: taxas,
  }] };
}

test('Verum exporta garantia por kg do maior valor e preserva excedente de faixas', () => {
  assert.equal(excessoVerum({ tipoCalculo: 'PERCENTUAL', rsKg: '0.930000', excesso: 0 }), 0.93);
  assert.equal(excessoVerum({ tipoCalculo: 'FAIXA_DE_PESO', rsKg: 0.93, excesso: 2 }), 2);
  assert.equal(excessoVerum({ tipoCalculo: 'PERCENTUAL', rsKg: 0, excesso: 0.62 }), 0.62);
});

test('XLSX Verum contém R$ 0,93/kg em Excesso de peso e mínimo R$ 68,37', () => {
  const cwdAnterior = process.cwd();
  const pasta = mkdtempSync(join(tmpdir(), 'verum-export-test-'));
  try {
    process.chdir(pasta);
    const transportadora = base([{ ibgeDestino: '1' }]);
    transportadora.origens[0].cotacoes = [{ rota: 'SC', pesoMin: 0, pesoMax: 999999999, tipoCalculo: 'PERCENTUAL', rsKg: '0.930000', excesso: '0.000000', percentual: '0.000000', freteMinimo: 68.37 }];
    gerarArquivosVerum(transportadora);
    const arquivo = XLSX.read(readFileSync(join(pasta, 'Teste-verum-fretes.xlsx')), { type: 'buffer' });
    const linhas = XLSX.utils.sheet_to_json(arquivo.Sheets[arquivo.SheetNames[0]], { range: 3 });
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0]['Excesso de peso'], 0.93);
    assert.equal(linhas[0]['Frete mínimo'], 68.37);
  } finally {
    process.chdir(cwdAnterior);
    rmSync(pasta, { recursive: true, force: true });
  }
});

test('GRIS, ADV e pedágio geram apenas as combinações utilizadas, compartilhando faixas', () => {
  const taxa = { gris: 0.17, grisMinimo: 3.79, adVal: 0.2, taxasExtras: [{ nome: 'Pedágio', valorPorPeso: 3.79, pesoBase: 100 }] };
  const resultado = gerarDadosVerum(base([{ ...taxa, ibgeDestino: '1' }, { ...taxa, ibgeDestino: '2' }, { ...taxa, gris: 0.22, ibgeDestino: '3' }]));
  assert.equal(resultado.rotas.length, 3);
  assert.equal(resultado.cotacoes.length, 4);
  assert.equal(resultado.rotas[0].cotacao, resultado.rotas[1].cotacao);
  assert.notEqual(resultado.rotas[0].cotacao, resultado.rotas[2].cotacao);
  assert.match(resultado.rotas[0].cotacao, /Pedágio R\$ 3,79\/100 kg/);
  assert.ok(resultado.cotacoes.every((c) => c.rota !== 'SC'));
  assert.ok(resultado.rotas.every((r) => resultado.cotacoes.some((c) => c.rota === r.cotacao)));
});

test('TDA gera versão sem TDA mantendo GRIS e pedágio', () => {
  const resultado = gerarDadosVerum(base([{ ibgeDestino: '1', tda: 25, gris: 0.17, taxasExtras: [{ nome: 'Pedágio', valor: 5 }] }]));
  assert.equal(resultado.cotacoes.length, 4);
  assert.equal(resultado.cotacoes.filter((c) => c.rota.includes('TDA')).length, 2);
  assert.ok(resultado.cotacoes.every((c) => c.rota.includes('GRIS') && c.rota.includes('Pedágio')));
});

test('configuração desativa versão sem TDA e permite combinações sem coringa', () => {
  const resultado = gerarDadosVerum(base([{ ibgeDestino: '1', tda: 25, gris: 0.17, taxasExtras: [{ nome: 'Pedágio', valor: 5 }], verumVersaoSemTaxa: { tda: false, 'coringa:pedagio': true } }]));
  assert.equal(resultado.cotacoes.length, 4);
  assert.ok(resultado.cotacoes.every((c) => c.rota.includes('TDA') && c.rota.includes('GRIS')));
  assert.equal(resultado.cotacoes.filter((c) => c.rota.includes('Pedágio')).length, 2);
});

test('duas taxas marcadas geram todas as quatro combinações sem duplicar faixas', () => {
  const resultado = gerarDadosVerum(base([{ ibgeDestino: '1', tda: 25, trt: 10 }, { ibgeDestino: '2', trt: 10, tda: 25 }]));
  assert.equal(resultado.cotacoes.length, 8);
  assert.equal(new Set(resultado.cotacoes.map((c) => c.rota)).size, 4);
});

test('lista agrupa percentuais e mínimos e reconhece coringas cadastrados', () => {
  assert.deepEqual(opcoesTaxasVerum([{ gris: 0.17, grisMinimo: 3, taxasExtras: [{ nome: 'Pedágio', valor: 5 }] }, { gris: 0.22 }]).map((t) => t.id), ['coringa:pedagio', 'gris']);
});

test('destino sem taxas mantém cotação base e destino com taxa aponta para a combinação', () => {
  const resultado = gerarDadosVerum(base([{ ibgeDestino: '1' }, { ibgeDestino: '2', gris: 0.17 }]));
  assert.equal(resultado.rotas[0].cotacao, 'SC');
  assert.match(resultado.rotas[1].cotacao, /GRIS/);
  assert.equal(resultado.cotacoes.length, 4);
});
