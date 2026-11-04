import test from 'node:test';
import assert from 'node:assert/strict';
import { extrairDadosNfse } from '../src/utils/robos/nfsePdf.js';

// Linhas da 1a pagina do DANFSe V1.0 "EMITENTE DA NFS-e / TOMADOR DA NFS-e" (ex.: Translovato), como sai de itensParaLinhas.
const LINHAS = [
  'DANFSE V1.0',
  'Documento Auxiliar da NFS-e',
  'Chave de Acesso da NFS-e',
  '41255062289823918000578000000000640426095444952459',
  'Número da NFS-e ¦ Competência da NFS-e ¦ Data e Hora da emissão da NFS-e',
  '6404 ¦ 04/09/2026 ¦ 04/09/2026 - 12:19:29',
  'Número da DPS ¦ Série da DPS ¦ Data e Hora da emissão da DPS ¦ A autenticidade desta NFS-e pode ser verificada',
  '6406 ¦ 04/09/2026 - 12:19:29',
  'EMITENTE DA NFS-e ¦ CNPJ / CPF / NIF ¦ Inscrição Municipal ¦ Telefone',
  'Prestador do Serviço ¦ 89.823.918/0005-78 ¦ 35646 ¦ (00)0000-0000',
  'Nome / Nome Empresarial ¦ E-mail',
  'TRANSPORTES TRANSLOVATO LTDA - SAO JOSE DOS PINHAIS ¦ curitiba@translovato.com.br',
  'Endereço ¦ Município ¦ CEP',
  'RUA FRANCISCO MUNOZ MADRID, ROSEIRA N° 1009 ¦ SAO JOSE DOS PINHAIS - PR ¦ 83070152',
  'Simples Nacional na Data de Competência ¦ Regime de Apuração Tributária pelo SN',
  '1 - Sim',
  'TOMADOR DA NFS-e ¦ CNPJ / CPF / NIF ¦ Inscrição Municipal ¦ Telefone',
  '10.158.356/0043-60',
  'Nome / Nome Empresarial ¦ E-mail',
  'CPX DISTRIB SA',
  'Endereço ¦ Município ¦ CEP',
  'ESTRADA BENEDITO DE SOUZA 10950, PRATA N° 10950 ¦ ITUPEVA - SP ¦ 13299700',
  'INTERMEDIÁRIO DO SERVIÇO NÃO IDENTIFICADO NA NFS-e',
  'SERVIÇO PRESTADO',
  'Descrição do Serviço',
  'Remetente 10158356004360 CPX DISTRIB SA',
  'Valor da Mercadoria 1095,14',
  'Valor da Liquido 93,93',
  'TRIBUTAÇÃO MUNICIPAL',
  'Valor do Serviço ¦ Desconto Incondicionado ¦ Total Deduções/Reduções ¦ Cálculo do BM',
  '93.93',
  'BC ISSQN ¦ Alíquota Aplicada ¦ Retenção do ISSQN ¦ ISSQN Apurado',
  '93.93 ¦ 2.00 ¦ 2 - Não ¦ 1.88',
  'VALOR TOTAL DA NFS-E',
  'Valor do Serviço ¦ Desconto Condicionado ¦ Desconto Incondicionado ¦ ISSQN Retido',
  '93.93',
  'IRRF, CP, CSLL - Retidos ¦ PIS/COFINS Retidos ¦ Valor Líquido da NFS-e',
  '93.93',
  'INFORMAÇÕES COMPLEMENTARES',
];

test('DANFSe EMITENTE/TOMADOR: le todos os campos do lancamento', () => {
  const { dados, faltando } = extrairDadosNfse(LINHAS);
  assert.deepEqual(faltando, []);
  assert.equal(dados.nf, '6404-F');
  assert.equal(dados.transportadora, 'TRANSPORTES TRANSLOVATO LTDA - SAO JOSE DOS PINHAIS');
  assert.equal(dados.cnpjTransp, '89823918000578');
  assert.equal(dados.cnpjTomador, '10158356004360');
  assert.equal(dados.dataEmissao, '2026-09-04');
  assert.equal(dados.valor, 93.93);
  assert.equal(dados.valorLiquido, 93.93);
  assert.equal(dados.codImp, 'IQ');
  assert.equal(dados.cfop, '2933AA');
});

test('DANFSe EMITENTE/TOMADOR: mesma UF vira 1933AA e retencao no liquido vira IN', () => {
  const iLiq = LINHAS.indexOf('IRRF, CP, CSLL - Retidos ¦ PIS/COFINS Retidos ¦ Valor Líquido da NFS-e');
  const linhas = LINHAS.map((l, k) => {
    if (k === iLiq + 1) return '0.00 ¦ 1.88 ¦ 92.05';
    return l.replace('ITUPEVA - SP', 'CURITIBA - PR');
  });
  const { dados } = extrairDadosNfse(linhas);
  assert.equal(dados.valorLiquido, 92.05);
  assert.equal(dados.codImp, 'IN');
  assert.equal(dados.cfop, '1933AA');
});

test('DANFSe EMITENTE/TOMADOR: valores com virgula e milhar', () => {
  const linhas = LINHAS.map((l) => (l === '93.93' ? 'R$ 1.093,93' : l));
  const { dados } = extrairDadosNfse(linhas);
  assert.equal(dados.valor, 1093.93);
  assert.equal(dados.valorLiquido, 1093.93);
});
