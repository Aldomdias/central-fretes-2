import test from 'node:test';
import assert from 'node:assert/strict';
import { extrairDadosNfse } from '../src/utils/robos/nfsePdf.js';

// NFS-e de Pouso Alegre/MG emitida pela Translovato (modelo "Serie NFS-e"): CNPJs sem pontuacao,
// data "11/09/2026 - 15:32:59", valores com ponto decimal ("58.99") e UF do prestador por extenso.
const LINHAS = [
  'TRANSPORTES TRANSLOVATO LTDA - POUSO ALEGRE',
  'Número da NFS-e ¦ Situação',
  'CNPJ: 89823918002007',
  '2903',
  'FERNAO DIAS (BR 381) N° SN ¦ Emitida',
  'CEP: 37556338 - IPIRANGA / SETOR INSDUSTRIAL',
  'Município: Pouso Alegre - Minas Gerais',
  'Número RPS: 27701 ¦ Tipo',
  'Insc. Mun: 76541 Insc. Est: 76541',
  'RPS Série:',
  'Telefone: (35)3425-6821Celular: (35)3425-6821 ¦ Importado',
  'Nota Fiscal de Serviço Eletrônica - Série NFS-e',
  'Identificador',
  'ESTADO DE MINAS GERAIS',
  'PREFEITURA MUNICIPAL DE POUSO ALEGRE ¦ Chave de Acesso NFS-e Nacional',
  'SECRETARIA MUNICIPAL DE FINANÇAS ¦ Data Fato Gerador ¦ Data/Hora Emissão',
  '11/09/2026 ¦ 11/09/2026 - 15:32:59',
  'TOMADOR DO SERVIÇO',
  'Nome Fantasia:',
  'Nome/Razão Social ¦ CPF/CNPJ',
  'CPX DISTRIB SA ¦ 10158356005251',
  'Endereço ¦ Número ¦ Complemento',
  'ROD. ANTONIO HEIL 800 ¦ 800',
  'Bairro ¦ CEP ¦ Cidade',
  'ITAIPAVA ¦ 88316-001 ¦ ITAJAI - SC',
  'País ¦ Telefone ¦ Email',
  'DESCRIÇÃO DOS SERVIÇOS PRESTADOS',
  'Serviço ¦ Local Prestação ¦ Alíquota(%) ¦ Valor Serviço ¦ Desc. Incondic. ¦ Valor Dedução ¦ Valor ISS',
  '16.02 ¦ 5049 ¦ 2.00 ¦ 58.99 ¦ 0,00 ¦ 0,00 ¦ 1.18',
  'Natureza da Operação:',
  'Descrição do Serviço:',
  'Remetente 10158356005251 CPX DISTRIB SA',
  'Destinatario 00006802020645 VITOR HUGO COUTINHO SANDOVAL',
  'Endereco Dest RUA RONAN JOSE BERALDO DO AMARAL, 65 Bairro FATIMA III Cidade POUSO ALEGRE MG',
  'Notas Fiscais 975003',
  'Volume 4,00',
  'Peso Real 55,24',
  'Peso Cubado 79,20',
  'Valor da Mercadoria 2391,42',
  'Valor da Liquido 58,99',
  'Observacao Reentrega ref ao Conhec 065975119',
  'Local de Prestacao do Servico POUSO ALEGRE',
  'Valor Total ¦ Desc. Incondicional ¦ Dedução ¦ Base de Cálculo ¦ ISSQN',
  '58.99 ¦ 0,00 ¦ 0,00 ¦ 58.99 ¦ 1.18',
  'ISSRF ¦ IR ¦ INSS ¦ CSLL ¦ COFINS',
  '0,00 ¦ 0,00 ¦ 0,00 ¦ 0,00 ¦ 0,00',
  'PIS ¦ Outras Retenções ¦ Total Trib. Federais ¦ Desc. Condicional ¦ Valor Líquido',
  '0,00 ¦ 0,00 ¦ 0.0000 ¦ 0,00 ¦ 58.99',
  'Descrição dos subitens da Lista de Serviço em acordo com a Lei Complementar 116/03',
  '16.02 / 16.02 - Outros serviços de transporte de natureza municipal.',
  '4930201 - Transporte rodoviário de carga, exceto produtos perigosos e mudanças, municipal',
  'Legenda do Local de Prestação do Serviço',
  '5049 - Pouso Alegre',
  'Outras Informações',
];

test('NFS-e Pouso Alegre (Translovato): le todos os campos do lancamento', () => {
  const { dados, faltando } = extrairDadosNfse(LINHAS);
  assert.deepEqual(faltando, []);
  assert.equal(dados.nf, '2903-F');
  assert.equal(dados.transportadora, 'TRANSPORTES TRANSLOVATO LTDA');
  assert.equal(dados.cnpjTransp, '89823918002007');
  assert.equal(dados.cnpjTomador, '10158356005251');
  assert.equal(dados.dataEmissao, '2026-09-11');
  assert.equal(dados.valor, 58.99);
  assert.equal(dados.valorLiquido, 58.99);
  assert.equal(dados.ufPrestador, 'MG');
  assert.equal(dados.ufTomador, 'SC');
  assert.equal(dados.codImp, 'IQ');
  assert.equal(dados.cfop, '2933AA');
});
