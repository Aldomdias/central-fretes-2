import test from 'node:test';
import assert from 'node:assert/strict';
import { lerBoletoIncremental } from '../src/utils/boletosPasta.js';

test('leitura incremental: hash conhecido reaproveita a leitura sem reabrir o PDF', async () => {
  let chamadas = 0;
  const leitor = async () => { chamadas += 1; return { valor: 1, vencimento: '2026-12-01', linhaDigitavel: 'X' }; };
  const versoes = new Map([['h1', { valor: '1500.00', vencimento: '2026-11-20', linha_digitavel: 'L1', origem_leitura: 'OCR' }]]);
  const r = await lerBoletoIncremental({ name: 'a.pdf' }, 'h1', versoes, leitor);
  assert.equal(chamadas, 0);
  assert.equal(r.valor, 1500);
  assert.equal(r.vencimento, '2026-11-20');
  assert.equal(r.linhaDigitavel, 'L1');
  assert.equal(r.reaproveitada, true);
  assert.equal(r.hash, 'h1');
});

test('leitura incremental: arquivo novo ou alterado é lido e carrega o hash', async () => {
  const leitor = async () => ({ valor: 10, vencimento: '2026-12-01', linhaDigitavel: 'N' });
  const r = await lerBoletoIncremental({ name: 'b.pdf' }, 'h2', new Map([['h1', {}]]), leitor);
  assert.equal(r.valor, 10);
  assert.equal(r.hash, 'h2');
  assert.equal(r.reaproveitada, undefined);
});

test('leitura incremental: ilegível não vira cache e é relido', async () => {
  let chamadas = 0;
  const leitor = async () => { chamadas += 1; return { erro: 'ilegível' }; };
  await lerBoletoIncremental({ name: 'c.pdf' }, 'h3', new Map([['h3', { valor: null, linha_digitavel: null }]]), leitor);
  assert.equal(chamadas, 1);
});

import { decodificarBoleto, textoTrazValorEVencimento, nomeDoArquivoCombina } from '../src/utils/boletosPasta.js';

test('decodificar: OCR com digito estragado no inicio usa o fim da linha se o vencimento esta escrito', () => {
  const texto = '23790.497?04 96307.000008 080D00.803604 6 16470000012217\nVencimento 01/12/2026';
  const r = decodificarBoleto(texto);
  assert.equal(r.parcial, true);
  assert.equal(r.linhaDigitavel, null);
  assert.equal(r.valor, 122.17);
  assert.equal(r.vencimento, '2026-12-01');
  assert.equal(decodificarBoleto('23790.497?04 96307.000008 080D00.803604 6 16470000012217'), null);
});

test('texto sem linha digitavel (PIX): exige valor e vencimento da fatura escritos', () => {
  const t = 'CONEXAO LOG 26/11/2026   0005041-5   412,32  Valor 1.234,56';
  assert.equal(textoTrazValorEVencimento(t, { valor_fatura: 412.32, data_vencimento: '2026-11-26' }), true);
  assert.equal(textoTrazValorEVencimento(t, { valor_fatura: 1234.56, data_vencimento: '2026-11-26' }), true);
  assert.equal(textoTrazValorEVencimento(t, { valor_fatura: 12.32, data_vencimento: '2026-11-26' }), false);
  assert.equal(textoTrazValorEVencimento(t, { valor_fatura: 412.32, data_vencimento: '2026-11-27' }), false);
});

test('nome do arquivo x transportadora da fatura', () => {
  assert.equal(nomeDoArquivoCombina('6 - R O C EXPRESSO RENATA.pdf', 'GRAMADO TRANSPORTES DE CARGAS LTDA'), false);
  assert.equal(nomeDoArquivoCombina('5041 - CONEXAO LOG.pdf', 'CONEXAO LOG TRANSPORTE'), true);
});
