import test from 'node:test';
import assert from 'node:assert/strict';
import { extrairDadosNfse } from '../src/utils/robos/nfsePdf.js';

// DANFSe v2.0 (padrao nacional) da J. Seda Neto Transportes (Pouso Alegre/MG), PDF sem texto (letras
// desenhadas): linhas como saem do OCR. Na NF 130 o OCR gruda o titulo "VALORDAOPERAÇÃO/SERVIÇO".
const LINHAS_NF130 = [
  "DANFSe v2.0 Município: Pouso Alegre - MG",
  "Nota Fiscal de ” Ambiente Gerador: 1",
  "Serviço eletrônica Documento Auxiliar da NFS-e Tipo de Ambiente: 1",
  "CHAVE DE ACESSO DA NFS-e EIEAE E]",
  "31525011206349754000219000000000013026100000000017 Aa FERA",
  "é Rn \" Pr A",
  "NUMERO DA NFS-e COMPETÊNCIA DA NFS-e DATA E HORA DA EMISSÃO DA NFS-e E RE",
  "130 16/10/2026 16/10/2026 19:16:08 1 SEA:",
  ", R \" ar. Raio",
  "NUMERO DA DPS SÉRIE DA DPS DATA E HORA DA EMISSÃO DA DPS ERAS",
  "130 1 16/10/2026 19:16:08 A autenticidade desta NFS-e pode ser verificada",
  ". pela leitura deste código QR ou pela consulta da",
  "EMITENTE DA NFS-e SITUAÇÃO DA NFS-e FINALIDADE chave de acesso no portal nacional da NFS-e",
  "Prestador NFS-e Gerada NFS-e regular",
  "PRESTADOR / FORNECEDOR CNPJ / CPF / NIF Indicador Municipal (Inscrição) Telefone",
  "06.349.754/0002-19 74743 (35) 3471-7170",
  "Nome / Nome Empresarial Município / Sigla UF Código IBGE / CEP",
  "J. SEDA NETO TRANSPORTES LTDA Pouso Alegre / MG 31.52501 / 37.556-140",
  "Endereço E-mail",
  "JK (BR 459), SN, KM 105, IPIRANGA contador(&novovaletransportes.com.br",
  "Simples Nacional na Data de Competência Regime de Apuração Tributária pelo SN",
  "Não optante -",
  "TOMADOR / ADQUIRENTE CNPJ / CPF / NIF Indicador Municipal (Inscrição) Telefone",
  "10.158.356/0075-48 106835 -",
  "Nome / Nome Empresarial Município / Sigla UF Código IBGE / CEP",
  "CPX DISTRIBUIDORA S.A. 4275 CENTRO CPX 4275 Pouso Alegre / MG 31.52501 / 37.557-500",
  "Endereço E-mail",
  "AV PREFEITO OLAVO GOMES DE OLIVEIRA, 6860, AEROPORTO JATOBA |l FISCALOCANTUSTORE.COM.BR",
  "DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e",
  "INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e",
  "SERVIÇO PRESTADO Código de Tributação Nacional/Municipal Código da NBS Local da Prestação / Sigla UF / País",
  "16.02.01 /- 1.0501.12.10 Pouso Alegre / MG /-",
  "Outros serviços de transporte de natureza municipal.",
  "Descrição do Serviço",
  "SERVICOS DE TRANSPORTE DE NATUREZA MUNICIPAL. NPNOO0553-3.",
  "TRIBUTAÇÃO MUNICIPAL (ISSQN) Tipo de Tributação do ISSQN Município / Sigla UF / País de Incidência do ISSQN",
  "Operação Tributável Pouso Alegre / MG / -",
  "Benefício Municipal Cálculo do BM Total Deduções/Reduções Desconto Incondicionado",
  "BC ISSQN Alíquota Aplicada Retenção do ISSQN ISSQN Apurado",
  "R$315,99 2,00 % Não Retido R$ 6,32",
  "PIS - Débito Apuração Própria COFINS - Débito Apuração Própria Descrição Contrib. Sociais - Retidas",
  "000 / 000001 070101 / 3152501 / Pouso Alegre / MG",
  "Exclusões e Reduções da Base de Cálculo Base de Cálculo Após Exclusões e Reduções Red. Alíquota IBS / Red. Alíquota CBS Alíquota - IBS UF / IBS Mun",
  "R$ 6,32 R$ 309,67 -/-/- 0,10 % / 0,00 %",
  "Alíq. Efetiva Municipal - IBS Valor Apurado Municipal - IBS Alíq. Efetiva Estadual - IBS Valor Apurado Estadual - IBS",
  "0,00 % R$ 0,00 0,10% R$ 0,31",
  "Valor Total Apurado - IBS Alíquota - CBS Alíquota Efetiva - CBS Valor Total Apurado - CBS",
  "R$ 0,31 0,90 % 0,90 % R$ 2,79",
  "(VALORTOTALDANFSe — —  . VALORDAOPERAÇÃO/SERVIÇO .. .. Descontolncondiionado — — DescontoCondicionado.",
  "R$ 315,99 - -",
  "Total das Retenções (ISSQN / Federais) VALOR LÍQUIDO DA NFS-e Total do IBS/CBS VALOR LÍQUIDO DA NFS-e + IBS/CBS",
  "R$0,00 R$315,99 R$3,10 R$315,99",
  "INFORMAÇÕES COMPLEMENTARES",
  "Inf. Cont.: RPS Número: 539 Série: 1.",
  "Totais aproximados dos Tributos cfe. Lei nº 12.741/2012: Federais: R$ 0,00; Estaduais: R$ 0,00; Municipais: R$ 0,00;",
  "DATA CIENTIFICAÇÃO: IDENTIFICAÇÃO E ASSINATURA Nº NFS-e / CHAVE NFS-e",
  "130 /31525011206349754000219000000000013026100000000017",
];

const LINHAS_NF134 = [
  "DANFSe v2.0 Município: Pouso Alegre - MG",
  "Nota Fiscal de ” Ambiente Gerador: 1",
  "Serviço eletrônica Documento Auxiliar da NFS-e Tipo de Ambiente: 1",
  "CHAVE DE ACESSO DA NFS-e [OE SO)",
  "Eae",
  "3152501120634975400021900000000001342610000000001 1 hº ERDE",
  "é R x Meo e",
  "NUMERO DA NFS-e COMPETÊNCIA DA NFS-e DATA E HORA DA EMISSÃO DA NFS-e - ELA NE",
  "134 28/10/2026 28/10/2026 19:02:15 E EnSaA",
  "NÚMERO DA DPS SÉRIE DA DPS DATA E HORA DA EMISSÃO DA DPS EL ASSES",
  "134 1 28/10/2026 19:02:15 A autenticidade desta NFS-e pode ser verificada",
  ". pela leitura deste código QR ou pela consulta da",
  "EMITENTE DA NFS-e SITUAÇÃO DA NFS-e FINALIDADE chave de acesso no portal nacional da NFS-e",
  "Prestador NFS-e Gerada NFS-e regular",
  "PRESTADOR / FORNECEDOR CNPJ / CPF / NIF Indicador Municipal (Inscrição) Telefone",
  "06.349.754/0002-19 74743 (35) 3471-7170",
  "Nome / Nome Empresarial Município / Sigla UF Código IBGE / CEP",
  "J. SEDA NETO TRANSPORTES LTDA Pouso Alegre / MG 31.52501 / 37.556-140",
  "Endereço E-mail",
  "JK (BR 459), SN, KM 105, IPIRANGA contador(&novovaletransportes.com.br",
  "Simples Nacional na Data de Competência Regime de Apuração Tributária pelo SN",
  "Não optante -",
  "TOMADOR / ADQUIRENTE CNPJ / CPF / NIF Indicador Municipal (Inscrição) Telefone",
  "10.158.356/0075-48 106835 -",
  "Nome / Nome Empresarial Município / Sigla UF Código IBGE / CEP",
  "CPX DISTRIBUIDORA S.A. 4275 CENTRO CPX 4275 Pouso Alegre / MG 31.52501 / 37.557-500",
  "Endereço E-mail",
  "AV PREFEITO OLAVO GOMES DE OLIVEIRA, 6860, AEROPORTO JATOBA |l FISCALOCANTUSTORE.COM.BR",
  "DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e",
  "INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e",
  "SERVIÇO PRESTADO Código de Tributação Nacional/Municipal Código da NBS Local da Prestação / Sigla UF / País",
  "16.02.01 /- 1.0501.12.10 Pouso Alegre / MG /-",
  "Outros serviços de transporte de natureza municipal.",
  "Descrição do Serviço",
  "SERVICOS DE TRANSPORTE DE NATUREZA MUNICIPAL. NPNO00557-6.",
  "MRIBUTAÇÃO MUNICIPAL(ISSQN) — Vw É TipodeTmbutação do ISSQN —————Municipio/SiglaUF/Palsdemeldêneia do ISSQN |||",
  "Operação Tributável Pouso Alegre / MG / -",
  "Benefício Municipal Cálculo do BM Total Deduções/Reduções Desconto Incondicionado",
  "BC ISSQN Alíquota Aplicada Retenção do ISSQN ISSQN Apurado",
  "R$87,10 2,00 % Não Retido R$ 1,74",
  "PIS - Débito Apuração Própria COFINS - Débito Apuração Própria Descrição Contrib. Sociais - Retidas",
  "000 / 000001 070101 / 3152501 / Pouso Alegre / MG",
  "Exclusões e Reduções da Base de Cálculo Base de Cálculo Após Exclusões e Reduções Red. Alíquota IBS / Red. Alíquota CBS Alíquota - IBS UF / IBS Mun",
  "R$ 1,74 R$ 85,36 -/-/- 0,10 % / 0,00 %",
  "Alíq. Efetiva Municipal - IBS Valor Apurado Municipal - IBS Alíq. Efetiva Estadual - IBS Valor Apurado Estadual - IBS",
  "0,00 % R$ 0,00 0,10% R$ 0,09",
  "Valor Total Apurado - IBS Alíquota - CBS Alíquota Efetiva - CBS Valor Total Apurado - CBS",
  "R$ 0,09 0,90 % 0,90 % R$ 0,77",
  "VALOR TOTAL DA NFS-e VALOR DA OPERAÇÃO / SERVIÇO Desconto Incondicionado Desconto Condicionado",
  "R$ 87,10 - -",
  "Total das Retenções (ISSQN / Federais) VALOR LÍQUIDO DA NFS-e Total do IBS/CBS VALOR LÍQUIDO DA NFS-e + IBS/CBS",
  "R$ 0,00 R$87,10 R$ 0,86 R$87,10",
  "INFORMAÇÕES COMPLEMENTARES",
  "Inf. Cont.: RPS Número: 543 Série: 1.",
  "Totais aproximados dos Tributos cfe. Lei nº 12.741/2012: Federais: R$ 0,00; Estaduais: R$ 0,00; Municipais: R$ 0,00;",
  "DATA CIENTIFICAÇÃO: IDENTIFICAÇÃO E ASSINATURA Nº NFS-e / CHAVE NFS-e",
  "134 / 31525011206349754000219000000000013426100000000011",
];

const comum = (dados) => {
  assert.equal(dados.transportadora, 'J. SEDA NETO TRANSPORTES LTDA');
  assert.equal(dados.cnpjTransp, '06349754000219');
  assert.equal(dados.cnpjTomador, '10158356007548');
  assert.equal(dados.municipioPrestador, 'IBGE3152501');
  assert.equal(dados.municipioTomador, 'IBGE3152501');
  assert.equal(dados.codImp, 'IQ');
  assert.equal(dados.cfop, '1933AA');
};

test('DANFSe v2.0 J. Seda Neto (OCR): NF 130 com o titulo do valor grudado', () => {
  const { dados, faltando } = extrairDadosNfse(LINHAS_NF130, { ocr: true });
  assert.deepEqual(faltando, []);
  assert.equal(dados.nf, '130-F');
  assert.equal(dados.dataEmissao, '2026-10-16');
  assert.equal(dados.valor, 315.99);
  assert.equal(dados.valorLiquido, 315.99);
  comum(dados);
});

test('DANFSe v2.0 J. Seda Neto (OCR): NF 134 com a chave quebrada no topo e inteira no rodape', () => {
  const { dados, faltando } = extrairDadosNfse(LINHAS_NF134, { ocr: true });
  assert.deepEqual(faltando, []);
  assert.equal(dados.nf, '134-F');
  assert.equal(dados.chave, '31525011206349754000219000000000013426100000000011');
  assert.equal(dados.dataEmissao, '2026-10-28');
  assert.equal(dados.valor, 87.1);
  assert.equal(dados.valorLiquido, 87.1);
  comum(dados);
});

// Variacoes do OCR vistas de uma maquina para outra: o mesmo PDF pode sair com o titulo do valor ilegivel,
// "R$" lido como "RS" ou a linha do valor perdida. O valor tem que sair mesmo assim.
const trocar = (linhas, de, para) => linhas.map((l) => (l === de ? para : l));
const TIT_134 = 'VALOR TOTAL DA NFS-e VALOR DA OPERAÇÃO / SERVIÇO Desconto Incondicionado Desconto Condicionado';

test('DANFSe v2.0 (OCR): "R$" lido como "RS" e titulo com O trocado por zero', () => {
  let l = trocar(LINHAS_NF134, TIT_134, 'VALOR TOTAL DA NFS-e VAL0R DA OPERAGAO / SERVIÇO Desconto Incondicionado');
  l = trocar(l, 'R$ 87,10 - -', 'RS 87,10 - -');
  const { dados, faltando } = extrairDadosNfse(l, { ocr: true });
  assert.deepEqual(faltando, []);
  assert.equal(dados.valor, 87.1);
});

test('DANFSe v2.0 (OCR): titulo ilegivel e linha do valor perdida -> valor = retencoes + liquido', () => {
  const l = LINHAS_NF130
    .filter((x) => !x.includes('VALORDAOPERA') && x !== 'R$ 315,99 - -')
    .map((x) => (x === 'R$0,00 R$315,99 R$3,10 R$315,99' ? 'R$ 1,50 RS 314,49 R$ 3,10 R$315,99' : x));
  const { dados, faltando } = extrairDadosNfse(l, { ocr: true });
  assert.deepEqual(faltando, []);
  assert.equal(dados.valor, 315.99);
  assert.equal(dados.valorLiquido, 314.49);
  assert.equal(dados.codImp, 'IN');
});

test('DANFSe v2.0 (OCR): retencoes "-" na linha do liquido', () => {
  const l = LINHAS_NF134
    .filter((x) => x !== TIT_134 && x !== 'R$ 87,10 - -')
    .map((x) => (x === 'R$ 0,00 R$87,10 R$ 0,86 R$87,10' ? '- R$87,10 R$ 0,86 R$87,10' : x));
  const { dados, faltando } = extrairDadosNfse(l, { ocr: true });
  assert.deepEqual(faltando, []);
  assert.equal(dados.valor, 87.1);
});
