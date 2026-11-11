import test from 'node:test';
import assert from 'node:assert/strict';
import { extrairDadosNfse } from '../src/utils/robos/nfsePdf.js';

// DANFSe v2.0 (padrao nacional) impresso pelo "Microsoft Print to PDF", sem texto: linhas como saem do OCR
// (RB Translog, Luis Eduardo Magalhaes/BA, NFS-e 74). Sem " ¦ " entre as colunas.
const LINHAS_RB_OCR = [
  "Município: Luís Eduardo Magalhães -",
  "| DANFSe v2.0 EA 9",
  "Nota Fiscal de ”",
  "Serviço eletrônica Documento Auxiliar da NFS-e Ambiente Gerador: 2",
  "Tipo de Ambiente: 1",
  "CHAVE DE ACESSO DA NFS-e Elsie E]",
  "29195532239485760000171000000000007426111723591343 ERA EA",
  "a z a ora",
  "NUMERO DA NFS-e COMPETÊNCIA DA NFS-e DATA E HORA DA EMISSÃO DA NFS-e ga Aã",
  "74 09/11/2026 09/11/2026 15:00:46 Teo ER",
  "NÚMERO DA DPS SÉRIE DA DPS DATA E HORA DA EMISSÃO DA DPS Elie",
  "64 70000 09/11/2026 15:00:46 A autenticidade desta NFS-e pode ser verificada",
  ". pela leitura deste código QR ou pela consulta da",
  "EMITENTE DA NFS-e SITUAÇÃO DA NFS-e FINALIDADE chave de acesso no portal nacional da NFS-e",
  "Prestador NFS-e Gerada -",
  "PRESTADOR / FORNECEDOR CNPJ / CPF / NIF Indicador Municipal (Inscrição) Telefone",
  "39.485.760/0001-71 99021643 (77) 99914-9555",
  "Nome / Nome Empresarial Município / Sigla UF Código IBGE / CEP",
  "RB TRANSLOG LTDA Luís Eduardo Magalhães / BA 29.19553 / 47.862-094",
  "Endereço E-mail",
  "AV PADRE ANCHIETA, 639, JARDIM DAS ACACIAS rbtranslog.ltdaQgmail.com",
  "Simples Nacional na Data de Competência Regime de Apuração Tributária pelo SN",
  "Optante - Microempresa ou Empresa de .. —. Regime de apuração dos tributos federais e municipal pelo Simples Nacional",
  "TOMADOR / ADQUIRENTE CNPJ / CPF / NIF Indicador Municipal (Inscrição) Telefone",
  "10.158.356/0036-31 - -",
  "Nome / Nome Empresarial Município / Sigla UF Código IBGE / CEP",
  "CPX DISTRIBUIDORA S.A. Luís Eduardo Magalhães / BA 29.19553 / 47.853-062",
  "Endereço E-mail",
  "RIO GRANDE, 332, QUADRAO3 LOTE 11, BOA VISTA -",
  "DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e",
  "INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e",
  "SERVIÇO PRESTADO Código de Tributação Nacional/Municipal Código da NBS Local da Prestação / Sigla UF / País",
  "16.02.01 /- - Luís Eduardo Magalhães / BA / -",
  "Outros serviços de transporte de natureza municipal.",
  "Descrição do Serviço",
  "REFERENTE A SERVIÇO DE TRANSPORTE DAS NFs 18523-18524-18529-18532-18533-18535-18536-18538-18540-18542-18544-18547-18553-18556-18557- 18566-18567-18582-",
  "18596-18597-18598-18602-18610-18613-18617-18629-18635-18638-18641-18649-18651-18652-18653-18655-18656-18657-18659-18667- 18672-18678-18679-18680-18683-18691-",
  "18700-18704-18707-18712-18717-18722-18726-18730-18737-18741-18744-18745-18748-18751-18768-18777-18778-18815-18843-18845-18846-18854-18855-18856-18859-18860-",
  "18862-18867-18872-18873-18881-18882-18883-18884-18886-18891-18892-18895-18904-18905-18915-18916-18918-18919-18923-18924-18936-18946-18951-18961-18963-18966-",
  "18968-18969-18970-18974-18975-18977-18978-18984-18987-18988-18990-18994-19001-19003-19005-19008-19009-19018-19023-19024-19033-19039-19040-19041-19043-19047.",
  "DENTRO DO MUNICIPIO DE LUIS EDUARDO MAGALHÃES-BA.",
  "TRIBUTAÇÃO MUNICIPAL (ISSQN) Tipo de Tributação do ISSQN Município / Sigla UF / País de Incidência do ISSQN",
  "Operação Tributável Luís Eduardo Magalhães / BA / -",
  "BC ISSQN Alíquota Aplicada Retenção do ISSQN ISSQN Apurado",
  "- - Não Retido -",
  "TRIBUTAÇÃO FEDERAL (EXCETO CBS) | IRRF Contribuição Previdenciária - Retida Contribuições Sociais - Retidas",
  "PIS - Débito Apuração Própria COFINS - Débito Apuração Própria Descrição Contrib. Sociais - Retidas",
  "- - 0 - PIS/COFINS/CSLL Não Retidos",
  "TRIBUTAÇÃO I|BS/CBS CST /cClassTrib Indicador de Operação / Código IBGE Incidência / Município Incidência / Sigla UF",
  "-/- -/-/-/-",
  "Exclusões e Reduções da Base de Cálculo Base de Cálculo Após Exclusões e Reduções Red. Alíquota IBS / Red. Alíquota CBS Alíquota - IBS UF / IBS Mun",
  "R$ 0,00 - -/-/- -/-",
  "Alíq. Efetiva Municipal - IBS Valor Apurado Municipal - IBS Alíq. Efetiva Estadual - IBS Valor Apurado Estadual - IBS",
  "Valor Total Apurado - IBS Alíquota - CBS Alíquota Efetiva - CBS Valor Total Apurado - CBS",
  "VALOR TOTAL DA NFS-e VALOR DA OPERAÇÃO / SERVIÇO Desconto Incondicionado Desconto Condicionado",
  "R$ 24.371,06 - -",
  "Total das Retenções (ISSQN / Federais) VALOR LÍQUIDO DA NFS-e Total do IBS/CBS VALOR LÍQUIDO DA NFS-e + IBS/CBS",
  "- R$ 24.371,06 R$ 0,00 R$ 0,00",
  "INFORMAÇÕES COMPLEMENTARES",
  "Totais aproximados dos Tributos cfe. Lei nº 12.741/2012: Federais: -; Estaduais: -; Municipais: -;",
  "DATA CIENTIFICAÇÃO: IDENTIFICAÇÃO E ASSINATURA Nº NFS-e / CHAVE NFS-e",
  "74 /29195532239485760000171000000000007426111723591343",
];

test('DANFSe v2.0 lido por OCR: municipio pelo IBGE e nome sem o municipio grudado', () => {
  const { dados, faltando } = extrairDadosNfse(LINHAS_RB_OCR, { ocr: true });
  assert.deepEqual(faltando, []);
  assert.equal(dados.nf, '74-F');
  assert.equal(dados.transportadora, 'RB TRANSLOG LTDA');
  assert.equal(dados.cnpjTransp, '39485760000171');
  assert.equal(dados.cnpjTomador, '10158356003631');
  assert.equal(dados.dataEmissao, '2026-11-09');
  assert.equal(dados.valor, 24371.06);
  assert.equal(dados.valorLiquido, 24371.06);
  assert.equal(dados.municipioPrestador, 'IBGE2919553');
  assert.equal(dados.municipioTomador, 'IBGE2919553');
  assert.equal(dados.codImp, 'IQ');
  assert.equal(dados.cfop, '1933AA');
});
