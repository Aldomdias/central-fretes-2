import test from 'node:test';
import assert from 'node:assert/strict';
import { extrairDadosNfse } from '../src/utils/robos/nfsePdf.js';

// Linhas de uma NFSe da Prefeitura de Campo Grande/MS (modelo "NFSe - Prestador"), como sai de itensParaLinhas.
const LINHAS = [
  'Prefeitura Municipal de Campo Grande',
  'Secretaria Municipal da Fazenda - SEFAZ',
  'Nota Fiscal de Serviços Eletrônica',
  'NFSe - Prestador',
  'A autenticidade desta NFSe pode ser',
  'DADOS DA NFSe ¦ verificada pela leitura deste código QR.',
  'Data e hora de emissão ¦ Competência ¦ Número / Série ¦ Data do RPS ¦ Número / Série do RPS',
  '22/09/2026 11:55:10 ¦ 09/2026 ¦ 3772 / U ¦ 22/09/2026 ¦ 3063 / 1',
  'Código de Verificação ¦ Chave de Acesso da NFSe Nacional',
  'b8VgGRRdX ¦ 50027041218233211003740000000000377226090716686418',
  'EMITENTE PRESTADOR DO SERVIÇO',
  'CPF / CNPJ / NIF ¦ Inscrição Municipal ¦ Telefone',
  '18.233.211/0037-40 ¦ 00251223009 ¦ (00) 00000-00',
  'Nome / Nome Empresarial ¦ E-mail',
  'FL BRASIL HOLDING, LOGISTICA E TRANSPORTE LTDA. ¦ FISCAL@EXPRESSOJUNDIAI.COM.BR',
  'Endereço ¦ Município ¦ CEP',
  'AVENIDA MINISTRO JOAO ARINOS 6225 UNIDADE 04 NOROESTE ¦ CAMPO GRANDE / MS BRASIL ¦ 79045-005',
  'TOMADOR DO SERVIÇO',
  'CPF / CNPJ / NIF ¦ Inscrição Municipal ¦ Telefone',
  '10.158.356/0017-79 ¦ 00319512004 ¦ (47) 3046-2550',
  'Nome / Nome Empresarial ¦ E-mail',
  'CPX DISTRIBUIDORA S/A ¦ fiscal@cantustore.com.br',
  'Endereço ¦ Município ¦ CEP',
  'RUA UCY NAGAMINE 676 UNIVERSITARIO ¦ CAMPO GRANDE / MS BRASIL ¦ 79063-480',
  'SERVIÇO PRESTADO',
  'TRIBUTAÇÃO MUNICIPAL',
  'Exigibilidade do ISSQN ¦ Município da Incidência do ISSQN ¦ Responsável pelo recolhimento do ISSQN',
  'Exigível ¦ CAMPO GRANDE - MS ¦ PRESTADOR DO SERVIÇO',
  'CÁLCULO DO ISSQN',
  'Valor total da NFSe (R$) ¦ Total das deduções (R$) ¦ Desc. incondicionado (R$) ¦ Base de cálculo do ISSQN (R$) ¦ Alíq. (%) ¦ Valor do ISSQN (R$)',
  'R$ 132,58 ¦ R$ 0,00 ¦ R$ 0,00 ¦ R$ 132,58 ¦ 5,000000 ¦ R$ 6,62',
  'RETENÇÕES',
  'ISSQN (R$) ¦ IRRF (R$) ¦ PIS (R$) ¦ COFINS (R$) ¦ INSS (R$) ¦ CSLL (R$) ¦ Outras retenções (R$)',
  'R$ 0,00 ¦ R$ 0,00 ¦ R$ 0,00 ¦ R$ 0,00 ¦ R$ 0,00 ¦ R$ 0,00 ¦ R$ 0,00',
  'VALOR TOTAL',
  'Base de cálculo do ISSQN (R$) ¦ Retenções (R$) ¦ Desc. incondicionado (R$) ¦ Desc. condicionado (R$) ¦ Valor Líquido da NFSe (R$)',
  'R$ 132,58 ¦ R$ 0,00 ¦ R$ 0,00 ¦ R$ 0,00 ¦ R$ 132,58',
  'INFORMAÇÕES COMPLEMENTARES',
];

test('NFSe Campo Grande/MS: le todos os campos do lancamento', () => {
  const { dados, faltando } = extrairDadosNfse(LINHAS);
  assert.deepEqual(faltando, []);
  assert.equal(dados.nf, '3772-F');
  assert.equal(dados.transportadora, 'FL BRASIL HOLDING, LOGISTICA E TRANSPORTE LTDA.');
  assert.equal(dados.cnpjTransp, '18233211003740');
  assert.equal(dados.cnpjTomador, '10158356001779');
  assert.equal(dados.dataEmissao, '2026-09-22');
  assert.equal(dados.valor, 132.58);
  assert.equal(dados.valorLiquido, 132.58);
  assert.equal(dados.ufPrestador, 'MS');
  assert.equal(dados.ufTomador, 'MS');
  assert.equal(dados.codImp, 'IQ');
  assert.equal(dados.cfop, '1933AA');
});

test('NFSe Campo Grande/MS: retencao vira IN e tomador de outra UF vira 2933AA', () => {
  const linhas = LINHAS.map((l) => {
    if (l.startsWith('R$ 132,58 ¦ R$ 0,00 ¦ R$ 0,00 ¦ R$ 0,00')) return 'R$ 1.132,58 ¦ R$ 6,62 ¦ R$ 0,00 ¦ R$ 0,00 ¦ R$ 1.125,96';
    if (l.startsWith('R$ 132,58 ¦')) return l.replace('R$ 132,58', 'R$ 1.132,58');
    if (l.startsWith('RUA UCY')) return 'RUA X 10 ¦ ITUPEVA / SP BRASIL ¦ 13295-000';
    return l;
  });
  const { dados } = extrairDadosNfse(linhas);
  assert.equal(dados.valor, 1132.58);
  assert.equal(dados.valorLiquido, 1125.96);
  assert.equal(dados.codImp, 'IN');
  assert.equal(dados.cfop, '2933AA');
});
