import test from 'node:test';
import assert from 'node:assert/strict';
import { lerPaginas } from '../src/utils/robos/nfsePdf.js';

// RPS (recibo provisorio) que vem junto da NFS-e: a coluna "NUMERO NFS-E" fica vazia.
const rps = [
  'J. SEDA NETO TRANSPORTES - ME',
  'RECIBO PROVISÓRIO DE SERVIÇOS - RPS ¦ NOTA FISCAL ELETRÔNICA DE SERVIÇOS - NFS-e',
  'www.novovaletransportes.com.br ¦ NÚMERO RPS ¦ DATA/HORA EMISSÃO ¦ NÚMERO NFS-E ¦ DATA/HORA EMISSÃO',
  'CNPJ 06.349.754/0002-19 IM 74743 ¦ RNTRC 09909644 ¦ NPN-000000459 08/04/2026 18:47:36',
  'CNPJ 10.158.356/0075-48 ¦ IE 0018440141416 ¦ FONE (80)06022013 ¦ FRETE TOTAL (R$) ¦ 192,73 VALOR A RECEBER (R$) ¦ 192,73',
];

// NFS-e municipal (Pouso Alegre) lida por OCR: valores abaixo dos titulos.
const nfse = [
  'J. SEDA NETO TRANSPORTES LTDA - NOVO VALE TRANSPORTES',
  'CNPJ: 06.349.754/0002-19 Número da NFS-e Situação',
  'Nota Fiscal de Serviço Eletrônica - Série NFS-e',
  'Data Fato Gerador Data/Hora Emissão',
  '20/04/2026 20/04/2026, 16:04',
  'TOMADOR DO SERVIÇO',
  'Nome/Razão Social CPF/CNPJ',
  'CPX DISTRIBUIDORA SA 10.158.356/0075-48',
  'Bairro CEP Cidade',
  'AEROPORTO JATOBA II 37.557-500 Pouso Alegre - MG',
  'Valor Total Desc. Incondicional Dedução Base de Cálculo ISSQN',
  '192,73 0,00 0,00 192,73 3,85',
  'PIS Outras Retenções Total Trib. Federais Desc. Condicional Valor Líquido',
  '0,00 0,00 0,00 0,00 192,73',
  'Chave de Acesso NFS-e Nacional',
  '31525011206349754000219000000000004826040000000001',
];

test('RPS e ignorado e a NFS-e do mesmo arquivo e lida', () => {
  const notas = lerPaginas([rps, nfse], { ocrPaginas: [false, true] });
  assert.equal(notas.length, 1);
  const { dados, faltando } = notas[0];
  assert.deepEqual(faltando, []);
  assert.equal(dados.nf, '48-F');
  assert.equal(dados.valor, 192.73);
  assert.equal(dados.dataEmissao, '2026-04-20');
  assert.equal(dados.cnpjTransp, '06349754000219');
  assert.equal(dados.cnpjTomador, '10158356007548');
  assert.equal(dados.codImp, 'IQ');
  assert.equal(dados.cfop, '1933AA');
});

test('arquivo so com RPS avisa que nao ha NFS-e', () => {
  const notas = lerPaginas([rps]);
  assert.equal(notas.length, 1);
  assert.match(notas[0].faltando[0], /so tem RPS/);
});
