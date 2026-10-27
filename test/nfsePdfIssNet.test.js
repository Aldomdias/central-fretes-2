import test from 'node:test';
import assert from 'node:assert/strict';
import { extrairDadosNfse } from '../src/utils/robos/nfsePdf.js';

// Linhas da 1a pagina de um PDF ISS.NET / Nota Control (Governo do Distrito Federal), como sai de itensParaLinhas.
const LINHAS_DF = [
  'Série do Documento',
  'Governo do Distrito Federal ¦ Nota Fiscal de Serviço',
  'Secretaria de Estado de Economia do Distrito Federal ¦ Eletrônica - NFS-e',
  'Fone: () - 156 - Opção 3 - www.sefaz.df.gov.br ¦ Número da Nota Fiscal',
  '17681',
  'Dados do Prestador de Serviço',
  'Data de Geração da NFS-e',
  '28/08/2026 12:29:29',
  'FL BRASIL HOLDING, LOGISTICA E TRANSPORTE LTDA.',
  'Data de Competência',
  'TRAGETTA',
  '28/08/2026',
  'Ade Conjunto 2 Lote 02 Lote 03 Lote 13 Lote 14, - Area de Desenvolvimento Economico (nucle',
  'Cód. de Autenticidade',
  'CEP 71735-720 - Brasília/ DF',
  'fiscal@expressojundiai.com.br ¦ 9F7505F90',
  'Inscrição Municipal 0786583000209 - CPF/CNPJ 18.233.211/0036-60 ¦ Responsável pela Retenção',
  'Identificação da Nota Fiscal Eletrônica',
  'Natureza da Operação ¦ Número do RPS ¦ Série do RPS ¦ Data de Emissão do RPS',
  'Exigível ¦ 17455 ¦ 28/08/2026',
  'Dados do Tomador de Serviços',
  'CNPJ/CPF : ¦ 10.158.356/0014-26 ¦ IM : ¦ 0802364800205',
  'Razão Social : CPX DISTRIBUIDORA S A',
  'CEP : ¦ 70000-001 ¦ Cidade/UF : Brasília/ DF',
  'Detalhamento dos Tributos',
  'Vl. Total dos Serviços Desconto Incondicionado Deduções Base Cálculo ¦ Base de Cálculo ¦ Total do ISSQN ¦ ISSQN Retido ¦ Desconto Condicionado',
  'R$ 157,84 ¦ R$ 0,00 ¦ R$ 0,00 ¦ R$ 157,84 ¦ R$ 7,89 Não ¦ R$ 0,00',
  'PIS ¦ COFINS ¦ INSS ¦ IRRF ¦ CSLL ¦ Outras Retenções ¦ Vl. ISSQN Retido Vl. Líquido da NotaFiscal',
  'R$ 0,00 ¦ R$ 0,00 ¦ R$ 0,00 ¦ R$ 0,00 R$ 0,00 ¦ R$ 0,00 ¦ R$ 0,00 ¦ R$ 157,84',
  'Chave de acesso no Ambiente de Dados Nacional: 53001081218233211003660000000001768126081787920163.',
];

test('NFS-e ISS.NET (Distrito Federal): le todos os campos do lancamento', () => {
  const { dados, faltando } = extrairDadosNfse(LINHAS_DF);
  assert.deepEqual(faltando, []);
  assert.equal(dados.nf, '17681-F');
  assert.equal(dados.transportadora, 'FL BRASIL HOLDING, LOGISTICA E TRANSPORTE LTDA.');
  assert.equal(dados.cnpjTransp, '18233211003660');
  assert.equal(dados.cnpjTomador, '10158356001426');
  assert.equal(dados.dataEmissao, '2026-08-28');
  assert.equal(dados.valor, 157.84);
  assert.equal(dados.valorLiquido, 157.84);
  assert.equal(dados.codImp, 'IQ');
  assert.equal(dados.cfop, '1933AA');
});

test('NFS-e ISS.NET: retencao no liquido vira IN e municipio diferente vira 2933AA', () => {
  const linhas = LINHAS_DF.map((l) => l
    .replace('Cidade/UF : Brasília/ DF', 'Cidade/UF : Goiânia/ GO')
    .replace('R$ 0,00 ¦ R$ 0,00 ¦ R$ 157,84', 'R$ 0,00 ¦ R$ 7,89 ¦ R$ 149,95'));
  const { dados } = extrairDadosNfse(linhas);
  assert.equal(dados.valorLiquido, 149.95);
  assert.equal(dados.codImp, 'IN');
  assert.equal(dados.cfop, '2933AA');
});
