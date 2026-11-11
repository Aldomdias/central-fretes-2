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

test('NFS-e ISS.NET: retencao no liquido vira IN e UF diferente vira 2933AA', () => {
  const linhas = LINHAS_DF.map((l) => l
    .replace('Cidade/UF : Brasília/ DF', 'Cidade/UF : Goiânia/ GO')
    .replace('R$ 0,00 ¦ R$ 0,00 ¦ R$ 157,84', 'R$ 0,00 ¦ R$ 7,89 ¦ R$ 149,95'));
  const { dados } = extrairDadosNfse(linhas);
  assert.equal(dados.valorLiquido, 149.95);
  assert.equal(dados.codImp, 'IN');
  assert.equal(dados.cfop, '2933AA');
});

// Mesmo modelo, PDF com as letras desenhadas (NFS 18089): linhas como saem do OCR (tesseract), sem " ¦ ",
// com "VI." no lugar de "Vl.", "DE" no lugar de "DF" e lixo do QR Code no fim das linhas.
const LINHAS_DF_OCR = [
  ".. Série do Di ft",
  "À Governo do Distrito Federal Pista Fiscal Pa",
  "í Secretaria de Estado de Economia do Distrito Federal Eletrônica, | —Eletrônica- NFS-e",
  "Te\"  Fone:()-156-Opção3-www.sefaz.df.gov.br oo",
  "Dados do Prestador de Serviço",
  "DRA A o",
  "FL BRASIL HOLDING, LOGISTICA E TRANSPORTE LTDA. 10/09/2026 13:29:10 | “x Seat",
  "ata de Competência Fei FS ea, had",
  "TRAGETTA 10/09/2026 é ASAE",
  "Ade Conjunto 2 Lote 02 Lote 03 Lote 13 Lote 14, - Area de Desenvolvimento Economico (nucle Tód. de Autenticidade O Ga TA o:",
  "CEP 71735-720 - Brasília/ DE 4 ET. É\"",
  "fiscalQexpressojundiai.com.br C48B13F39 * ST x",
  "Inscrição Municipal 0786583000209 - CPF/CNPJ 18.233.211/0036-60 Responsável pela Retenção bn fio fo *",
  "Identificação da Nota Fiscal Eletrônica",
  "Natureza da Operação Número do RPS Série do RPS Data de Emissão do RPS",
  "Local dos Serviços Município Incidência",
  "Brasília - Distrito Federal Brasília - Distrito Federal",
  "Dados do Tomador de Serviços",
  "CNPJ/CPF : 10.158.356/0014-26 IM: 0802364800205",
  "Razão Social: CPX DISTRIBUIDORAS A",
  "Endereço : SETOR SCIA QUADRA 14 CONJUNTO 2 LOTE 13 SALA 01. Número: O",
  "Complemento : Bairro : ZONA INDUSTRIAL (GUARA)",
  "CEP: 70000-001 Cidade/UF : Brasília/ DF",
  "Telefone : (47)98815-0761 E-mail : emailQemail.com",
  "Dados do Intermediário de Serviços",
  "Descrição dos Serviços",
  "Detalhamento dos Tributos",
  "Atividade do Município Alíquota  [ltem da LC116/2003 Cód. NBS Cód. CNAE",
  "1602 - 16.02 - Outros serviços de transporte de natureza mun... 1602 105011900 | 4930201",
  "VI. Total dos Serviços | Desconto Incondicionado — |Deduções Base Cálculo Base de Cálculo Total do ISSQN ISSQN Retido Desconto Condicionado",
  "R$ 167,77 R$ 0,00 R$ 0,00 R$ 167,77 R$ 8,39 | Não R$ 0,00",
  "PIS COFINS INSS IRRF CSLL Outras Retenções VI. ISSON Retido — | VI. Líquido da Nota Fiscal",
  "R$ 0,00 R$ 0,00 R$ 0,00 R$ 0,00 | R$ 0,00 R$ 0,00 R$ 0,00 R$ 167,77",
  "Construção Civil CETTE [E",
  "Informações Adicionais",
  "PROCON: TEL 151- SETOR COMERCIAL SUL, QUADRA 8, BLOCO B-60, SALA 240- BRASILIA - DF",
  "Chave de acesso no Ambiente de Dados Nacional: 53001081218233211003660000000001808926091789046952.",
  "Consulte a autenticidade deste documento acessando o site: https://iss.fazenda.df.gov.br/online/Login/Login.aspx",
  "ISS.NET - Sistema Nota ControlO& + www.notacontrol.com.br",
];

test('NFS-e ISS.NET (Distrito Federal) lida por OCR: le todos os campos do lancamento', () => {
  const { dados, faltando } = extrairDadosNfse(LINHAS_DF_OCR, { ocr: true });
  assert.deepEqual(faltando, []);
  assert.equal(dados.nf, '18089-F');
  assert.equal(dados.transportadora, 'FL BRASIL HOLDING, LOGISTICA E TRANSPORTE LTDA.');
  assert.equal(dados.cnpjTransp, '18233211003660');
  assert.equal(dados.cnpjTomador, '10158356001426');
  assert.equal(dados.dataEmissao, '2026-09-10');
  assert.equal(dados.valor, 167.77);
  assert.equal(dados.valorLiquido, 167.77);
  assert.equal(dados.ufPrestador, 'DF');
  assert.equal(dados.ufTomador, 'DF');
  assert.equal(dados.codImp, 'IQ');
  assert.equal(dados.cfop, '1933AA');
});
