import test from 'node:test';
import assert from 'node:assert/strict';
import { criarIndices } from '../src/utils/robos/lancamentoComum.js';
import {
  extrairCte, parseXml, montarLancamentoCte, valorLiquido, codigoImposto, partesChaveMiro, partesChaveConsulta,
  docnumsDoExport1, partidasDoExport2, linhasParaScriptCte, linhasConsultaSe16n,
} from '../src/utils/robos/lancamentoCte.js';
import { gerarScriptCte } from '../src/utils/robos/sapLancamentoVbs.js';
import { gerarScriptConsultaNotasCte, gerarScriptPartidasCte } from '../src/utils/robos/sapConsultasCte.js';

const CHAVE_CTE = '31260610158356020218570010000012341123456785'; // 44 digitos
const DANFE = '31260610158356020218550010000000391224215149';

function xml({ toma = '<toma3><toma>3</toma></toma3>', icms = '<ICMS00><CST>00</CST><vBC>100.00</vBC><pICMS>12.00</pICMS><vICMS>12.00</vICMS></ICMS00>', prot = true } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<cteProc xmlns="http://www.portalfiscal.inf.br/cte" versao="3.00"><CTe xmlns="http://www.portalfiscal.inf.br/cte">
<infCte Id="CTe${CHAVE_CTE}" versao="3.00">
<ide><serie>1</serie><nCT>1234</nCT><dhEmi>2026-06-22T10:15:00-03:00</dhEmi>${toma}</ide>
<emit><CNPJ>16615755000130</CNPJ><xNome>ROCHA E MIURA TRANSPORTES LTDA</xNome></emit>
<rem><CNPJ>10158356020218</CNPJ><xNome>CANTU LOG REMETENTE &amp; CIA</xNome></rem>
<dest><CNPJ>10158356013866</CNPJ><xNome>DESTINO</xNome></dest>
<vPrest><vTPrest>100.00</vTPrest></vPrest>
<imp><ICMS>${icms}</ICMS></imp>
<infCTeNorm><infDoc><infNFe><chave>${DANFE}</chave></infNFe><infNFe><chave>99999999999999999999999999999999999999999999</chave></infNFe></infDoc></infCTeNorm>
</infCte></CTe>
${prot ? `<protCTe versao="3.00"><infProt><chCTe>${CHAVE_CTE}</chCTe><nProt>135260000000001</nProt></infProt></protCTe>` : ''}
</cteProc>`;
}

const indices = criarIndices({
  filiais: [{ cnpj: '10158356013866', emp: '1420', centro: '4201' }],
  escritorios: [{ conc: '1420P005', titulo: 'C420110001' }, { conc: '1420Z044', titulo: 'C420130045' }],
});

test('parser de XML: namespaces, entidades e estrutura', () => {
  const r = parseXml('<a:x xmlns:a="u"><a:y k="1">oi &amp; tchau</a:y><z/></a:x>');
  assert.equal(r.filhos[0].nome, 'x');
  assert.equal(r.filhos[0].filhos[0].texto, 'oi & tchau');
  assert.equal(r.filhos[0].filhos[0].attrs.k, '1');
});

test('extrai os campos do CT-e (tomador pelo toma3, ICMS00, primeira NF)', () => {
  const c = extrairCte(xml());
  assert.equal(c.nCT, '1234'); assert.equal(c.serie, '1');
  assert.equal(c.valorBruto, 100);
  assert.equal(c.protocolo, '135260000000001');
  assert.equal(c.chaveCte, CHAVE_CTE);
  assert.equal(c.cnpjEmitente, '16615755000130');
  assert.equal(c.cnpjTomador, '10158356013866'); // toma=3 => destinatario
  assert.equal(c.dataEmissao, '2026-06-22');
  assert.equal(c.pIcms, 12);
  assert.equal(c.danfe, DANFE);
  assert.equal(c.remetente, 'CANTU LOG REMETENTE & CIA');
  assert.equal(c.tipo, 'Z044'); // remetente e destinatario do grupo (raiz 10158356)
});

test('tomador toma4 e CT-e sem protocolo', () => {
  const c = extrairCte(xml({ toma: '<toma4><toma>4</toma><CNPJ>08888040000123</CNPJ><xNome>X</xNome></toma4>', prot: false }));
  assert.equal(c.cnpjTomador, '08888040000123');
  assert.equal(c.protocolo, '');
  assert.equal(c.chaveCte, CHAVE_CTE); // vem do Id do infCte
});

test('regras de calculo: liquido, codigo de imposto e partes da chave', () => {
  assert.equal(valorLiquido(100, 0.12), 100 * (1 - (0.12 + 0.0165 + 0.076)));
  assert.equal(valorLiquido(100, 0), 90.75);
  assert.equal(codigoImposto(0), 'F2');
  assert.equal(codigoImposto(0.07), 'F1');
  assert.deepEqual(partesChaveMiro(CHAVE_CTE), { tpEmis: '1', cNF: '12345678', dv: '5' });
  assert.deepEqual(partesChaveConsulta(DANFE), { regiao: '31', ano: '26', mes: '06', cnpj: '10158356020218', modelo: '55', serie: '001', nnf: '000000039', aleatorio: '122421514', dv: '9' });
});

test('monta a linha: empresa, centro, C.Custo pela partida e fallback intercompany', () => {
  const c = extrairCte(xml());
  const semPartida = montarLancamentoCte([c], indices, new Map(), { vencimento: '2026-08-19' })[0];
  assert.equal(semPartida.emp, '1420'); assert.equal(semPartida.centro1, 'CEN4201');
  assert.equal(semPartida.codImp, 'F1'); assert.equal(semPartida.icms, 0.12);
  assert.equal(semPartida.cc, 'C420130045'); // intercompany (Z044)
  const comPartida = montarLancamentoCte([c], indices, new Map([[DANFE, { escritorioVendas: 'P005', empresa: '1420' }]]))[0];
  assert.equal(comPartida.cc, 'C420110001'); // partida tem prioridade
  assert.equal(comPartida.erros.length, 0);
  const isento = montarLancamentoCte([extrairCte(xml({ icms: '<ICMS45><CST>40</CST></ICMS45>' }))], indices)[0];
  assert.equal(isento.codImp, 'F2'); assert.ok(isento.avisos[0].includes('ICMS45'));
  // duplicados (mesmo CT-e) saem uma vez so
  assert.equal(montarLancamentoCte([c, c], indices).length, 1);
});

test('arquivos exportados do SAP', () => {
  assert.deepEqual(docnumsDoExport1([['Docnum'], ['17590561'], [17590561], ['17619070'], ['']]), ['17590561', '17619070']);
  const m = partidasDoExport2([
    ['N° documento', 'N° da NF-e', 'Ref.doc.origem', 'Data de lançamento', 'Centro de lucro', 'Chave NF', 'Partida Individual', 'Centro custo', 'Escritório de vendas', 'Empresa'],
    ['1', '39', '97633299', '', 'L', DANFE, '9', '', 'P005', 1420],
  ]);
  assert.deepEqual(m.get(DANFE), { escritorioVendas: 'P005', empresa: '1420' });
});

test('scripts do CT-e: lancamento e consultas', () => {
  const l = montarLancamentoCte([extrairCte(xml())], indices, new Map(), { vencimento: '2026-08-19' })[0];
  const vbs = gerarScriptCte({ linhas: linhasParaScriptCte([l]) });
  assert.ok(vbs.includes('"90,75"') === false); // liquido do F1 12% e outro valor
  assert.ok(vbs.includes('"100,00"') && vbs.includes('"19082026"') && vbs.includes('"22062026"') && vbs.includes('"12"'));
  const consultas = linhasConsultaSe16n([l]);
  const a = gerarScriptConsultaNotasCte({ consultas });
  assert.ok(a.includes('J_1BNFE_ACTIVE') && a.includes('EXPORT1') && a.includes('31|26|06|10158356020218|55|001|000000039|122421514|9'));
  const c = gerarScriptPartidasCte({ docnums: ['17590561'] });
  assert.ok(c.includes('/nzsd0004') && c.includes('EXPORT2') && c.includes('"17590561"'));
  [vbs, a, c].forEach((t) => { assert.ok(!/[^\x00-\x7f]/.test(t)); assert.ok(Math.max(...t.split('\r\n').map((x) => x.length)) < 900); });
});
