// Robo "Lancamento CT-e" — substitui a planilha "Lancamento CT-e 2.0.xlsm".
//
// A planilha: (1) importava os XMLs dos CT-e (Power Query "Power (2)", "Tomador Correto" e
// "Danfes"), (2) consultava no SAP a chave da nota fiscal (SE16N J_1BNFE_ACTIVE) e as partidas
// (ZSD0004) para achar o centro de custo, (3) criava o pedido de servico (ME21N) e (4) a MIRO.
// Aqui ficam a leitura dos XMLs, as regras de calculo e a leitura dos arquivos exportados do SAP.

import {
  apenasDigitos,
  dataParaIso,
  gerarIds,
  hojeIso,
  isoParaBr,
  isoParaDdmmaaaa,
  mapearColunas,
  normalizarCnpj,
  valorParaSap,
} from './lancamentoComum';

// ---------------------------------------------------------------- XML (parser minimo, sem DOMParser)
// Os XMLs de CT-e sao regulares; este parser cobre tags, atributos, texto, CDATA e comentarios
// e ignora prefixos de namespace. Funciona igual no navegador e no Node (testes).
export function parseXml(texto = '') {
  const s = String(texto).replace(/^﻿/, '');
  const raiz = { nome: '#raiz', attrs: {}, filhos: [], texto: '' };
  const pilha = [raiz];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const topo = pilha[pilha.length - 1];
    if (m[1] !== undefined) topo.texto += m[1];
    else if (m[2] !== undefined) { if (pilha.length > 1) pilha.pop(); }
    else if (m[3] !== undefined) {
      const attrs = {};
      String(m[4] || '').replace(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (_, k, a, b) => { attrs[k.replace(/^.*:/, '')] = a ?? b; return ''; });
      const no = { nome: m[3].replace(/^.*:/, ''), attrs, filhos: [], texto: '' };
      topo.filhos.push(no);
      if (!m[5]) pilha.push(no);
    } else if (m[6] !== undefined) {
      topo.texto += m[6].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    }
  }
  return raiz;
}

function achar(no, nome) { return no?.filhos?.find((f) => f.nome === nome) || null; }
function caminho(no, ...nomes) { return nomes.reduce((atual, n) => (atual ? achar(atual, n) : null), no); }
function txt(no, ...nomes) { const n = nomes.length ? caminho(no, ...nomes) : no; return n ? String(n.texto || '').trim() : ''; }
function todos(no, nome) { return (no?.filhos || []).filter((f) => f.nome === nome); }
function procurar(no, nome) {
  if (!no) return null;
  if (no.nome === nome) return no;
  for (const f of no.filhos) { const r = procurar(f, nome); if (r) return r; }
  return null;
}

// Raizes de CNPJ do grupo (operacoes entre empresas do grupo => tipo Z044).
export const RAIZES_INTERCOMPANY = ['08265644', '08888040', '10158356', '15426874', '43362585', '46378127'];

function docPessoa(no) { return normalizarCnpjOuCpf(txt(no, 'CNPJ') || txt(no, 'CPF')); }
function normalizarCnpjOuCpf(v) { const d = apenasDigitos(v); return d.length === 11 ? d : normalizarCnpj(d); }

// Le um XML de CT-e (cteProc ou CTe) e devolve os campos usados nas queries do Power Query.
export function extrairCte(xml, arquivo = '') {
  const raiz = parseXml(xml);
  const inf = procurar(raiz, 'infCte');
  if (!inf) throw new Error('nao e um XML de CT-e (sem infCte)');
  const ide = achar(inf, 'ide');
  const prot = procurar(raiz, 'infProt');
  const toma3 = txt(ide, 'toma3', 'toma');
  const partes = { 0: achar(inf, 'rem'), 1: achar(inf, 'exped'), 2: achar(inf, 'receb'), 3: achar(inf, 'dest') };
  // "Tomador Correto": toma3 aponta o papel (0 rem, 1 exped, 2 receb, 3 dest); senao toma4.
  let tomador = '';
  if (toma3 !== '' && partes[toma3]) tomador = docPessoa(partes[toma3]);
  if (!tomador) tomador = docPessoa(achar(ide, 'toma4'));
  const rem = partes[0];
  const dest = partes[3];
  const raiz8 = (v) => apenasDigitos(v).slice(0, 8);
  const intercompany = RAIZES_INTERCOMPANY.includes(raiz8(docPessoa(rem))) && RAIZES_INTERCOMPANY.includes(raiz8(docPessoa(dest)));
  const icms00 = caminho(inf, 'imp', 'ICMS', 'ICMS00');
  const icmsNo = caminho(inf, 'imp', 'ICMS');
  const outroIcms = !icms00 && icmsNo && icmsNo.filhos[0] ? icmsNo.filhos[0].nome : '';
  const pIcms = icms00 ? Number(txt(icms00, 'pICMS')) : null;
  const nfes = todos(caminho(inf, 'infCTeNorm', 'infDoc'), 'infNFe').map((n) => apenasDigitos(txt(n, 'chave'))).filter(Boolean);
  const idAttr = String(inf.attrs.Id || '').replace(/^CTe/i, '');
  return {
    arquivo,
    serie: txt(ide, 'serie'),
    nCT: txt(ide, 'nCT'),
    valorBruto: Number(txt(inf, 'vPrest', 'vTPrest')) || 0,
    protocolo: txt(prot, 'nProt'),
    chaveCte: apenasDigitos(txt(prot, 'chCTe')) || apenasDigitos(idAttr),
    emitente: txt(inf, 'emit', 'xNome'),
    cnpjEmitente: normalizarCnpj(txt(inf, 'emit', 'CNPJ')),
    cnpjTomador: tomador,
    dataEmissao: dataParaIso(txt(ide, 'dhEmi')),
    pIcms: Number.isFinite(pIcms) ? pIcms : null,
    outroIcms,
    danfe: nfes[0] || '',
    remetente: txt(rem, 'xNome'),
    destinatario: txt(dest, 'xNome'),
    tipo: intercompany ? 'Z044' : '',
  };
}

// ---------------------------------------------------------------- regras de calculo
const PIS_COFINS = 0.0165 + 0.076;

export function icmsDecimal(pIcms) {
  return pIcms === null || pIcms === undefined || Number.isNaN(pIcms) ? 0 : pIcms / 100;
}

export function valorLiquido(bruto, icms) {
  return Math.round(bruto * (1 - (icms + PIS_COFINS)) * 100) / 100;
}

export function codigoImposto(icms) {
  if (icms === 0) return 'F2';
  if (icms > 0 && icms < 1) return 'F1';
  return '';
}

// Partes da chave de 44 digitos usadas na MIRO (aba "Dados da NF-e"):
// tipo de emissao (pos. 35), numero aleatorio (36-43) e digito verificador (44).
export function partesChaveMiro(chave = '') {
  return { tpEmis: chave.slice(34, 35), cNF: chave.slice(35, 43), dv: chave.slice(43, 44) };
}

// Chave da NF de venda "picada" como na aba Consulta (SE16N J_1BNFE_ACTIVE):
// regiao(2) ano(2) mes(2) cnpj(14) modelo(2) serie(3) nNF(9) aleatorio(9) dv(1).
export function partesChaveConsulta(chave = '') {
  const c = apenasDigitos(chave);
  if (c.length !== 44) return null;
  return {
    regiao: c.slice(0, 2), ano: c.slice(2, 4), mes: c.slice(4, 6), cnpj: c.slice(6, 20), modelo: c.slice(20, 22),
    serie: c.slice(22, 25), nnf: c.slice(25, 34), aleatorio: c.slice(34, 43), dv: c.slice(43, 44),
  };
}

// partidas: Map(chaveNF -> { escritorioVendas, empresa }) vindo do export do ZSD0004.
export function montarLancamentoCte(cts = [], indices, partidas = new Map(), { vencimento = hojeIso() } = {}) {
  // distinct por (CNPJ transportadora + CT-e) e depois por chave do CT-e (como as queries)
  const vistosCte = new Set();
  const vistosChave = new Set();
  const unicos = cts.filter((c) => {
    const k1 = `${c.cnpjEmitente}${c.nCT}-${c.serie}`;
    if (vistosCte.has(k1) || (c.chaveCte && vistosChave.has(c.chaveCte))) return false;
    vistosCte.add(k1);
    if (c.chaveCte) vistosChave.add(c.chaveCte);
    return true;
  });
  const ids = gerarIds(unicos, (c) => `${c.nCT}-${c.serie}/${c.cnpjEmitente}`);
  return unicos.map((c, i) => {
    const filial = indices.filiais.get(c.cnpjTomador);
    const emp = filial?.emp || '';
    const centro = filial?.centro || '';
    const icms = icmsDecimal(c.pIcms);
    const partida = c.danfe ? partidas.get(c.danfe) : null;
    const ccBi = partida ? indices.escritorios.get(`${partida.empresa}${partida.escritorioVendas}`) || '' : '';
    const ccInter = emp && c.tipo ? indices.escritorios.get(`${emp}${c.tipo}`) || '' : '';
    const cc = ccBi || ccInter;
    const chave = partesChaveMiro(c.chaveCte);
    const avisos = [];
    const erros = [];
    if (!c.chaveCte || c.chaveCte.length !== 44) erros.push('chave do CT-e invalida');
    if (!c.protocolo) erros.push('XML sem protocolo de autorizacao');
    if (!emp) erros.push('CNPJ do tomador nao esta em Filiais');
    if (!(c.valorBruto > 0)) erros.push('valor invalido');
    if (!c.dataEmissao) erros.push('data de emissao invalida');
    if (emp && !cc) erros.push(c.danfe ? 'sem centro de custo (consulte no SAP ou digite)' : 'CT-e sem NF de venda: digite o centro de custo');
    if (c.outroIcms) avisos.push(`ICMS ${c.outroIcms}: aliquota nao lida, tratado como isento (F2)`);
    return {
      id: ids[i],
      cte: `${c.nCT}-${c.serie}`,
      emp,
      centro,
      centro1: centro ? `CEN${centro}` : '',
      bruto: c.valorBruto,
      liquido: valorLiquido(c.valorBruto, icms),
      icms,
      codImp: codigoImposto(icms),
      protocolo: c.protocolo,
      chaveCte: c.chaveCte,
      transportadora: String(c.emitente || '').slice(0, 15),
      cnpjTransp: c.cnpjEmitente,
      dataEmissao: c.dataEmissao,
      vencimento,
      cnpjTomador: c.cnpjTomador,
      danfe: c.danfe,
      remetente: c.remetente,
      destinatario: c.destinatario,
      tipo: c.tipo,
      cc,
      fatura: '',
      tpEmis: chave.tpEmis,
      cNF: chave.cNF,
      dv: chave.dv,
      pedido: '',
      miro: '',
      erros,
      avisos,
    };
  });
}

// ---------------------------------------------------------------- arquivos exportados do SAP
// EXPORT1 (SE16N J_1BNFE_ACTIVE): a 1a coluna traz o numero do documento (DOCNUM).
export function docnumsDoExport1(matriz = []) {
  const dados = matriz.slice(1);
  const nums = dados.map((r) => apenasDigitos(r[0])).filter(Boolean);
  return [...new Set(nums)];
}

// EXPORT2 (ZSD0004): colunas N documento, N da NF-e, Ref.doc.origem, Data de lancamento,
// Centro de lucro, Chave NF, Partida Individual, Centro custo, Escritorio de vendas, Empresa.
export function partidasDoExport2(matriz = []) {
  if (matriz.length < 2) return new Map();
  const m = mapearColunas(matriz[0], { chave: ['Chave NF'], escV: ['Escritório de vendas', 'Escritorio de vendas'], empresa: ['Empresa'] });
  const col = { chave: m.chave ?? 5, escV: m.escV ?? 8, empresa: m.empresa ?? 9 };
  const mapa = new Map();
  matriz.slice(1).forEach((r) => {
    const chave = apenasDigitos(r[col.chave]);
    if (chave.length !== 44) return;
    if (!mapa.has(chave)) mapa.set(chave, { escritorioVendas: String(r[col.escV] ?? '').trim(), empresa: String(r[col.empresa] ?? '').trim() });
  });
  return mapa;
}

// ---------------------------------------------------------------- scripts
export function linhasParaScriptCte(linhas = []) {
  return linhas.map((l) => ({
    id: l.id,
    emp: l.emp,
    cte: l.cte,
    bruto: valorParaSap(l.bruto),
    prot: l.protocolo,
    cnpj: apenasDigitos(l.cnpjTransp),
    centro: l.centro,
    liquido: valorParaSap(l.liquido),
    aliquota: String(Math.round(l.icms * 10000) / 100), // ponto decimal: o script usa Val()
    cc: l.cc,
    codImp: l.codImp,
    dtEmissao: isoParaDdmmaaaa(l.dataEmissao),
    dtVenc: isoParaDdmmaaaa(l.vencimento),
    tpEmis: l.tpEmis,
    cNF: l.cNF,
    dv: l.dv,
    centro1: l.centro1,
    pedido: l.pedido || '',
    miro: l.miro || '',
  }));
}

export function linhasConsultaSe16n(linhas = []) {
  return [...new Set(linhas.map((l) => l.danfe).filter(Boolean))].map(partesChaveConsulta).filter(Boolean);
}

export const CABECALHO_ENVIAR_CTE = ['Transportadora', 'Fatura', 'CT-e', 'NrPedido', 'NrMIRO'];

export function linhasEnviarCte(linhas = []) {
  return linhas.filter((l) => l.pedido || l.miro).map((l) => ({ Transportadora: l.transportadora, Fatura: l.fatura, 'CT-e': l.cte, NrPedido: l.pedido, NrMIRO: l.miro }));
}

export const CABECALHO_LANCAMENTO_CTE = ['Empresa', 'Cte', 'Valor Bruto', 'Protocolo', 'Chave CT-e', 'Transportadora', 'CNPJ Transp', 'Centro', 'Valor Liquido', 'ICMS', 'C. Custo', 'Cod Imp', 'Data Emissão', 'Vencimento', 'Pedido Criado', 'Miro Criada', 'Fatura', 'CNPJ Tomador', 'Chave Danfe', 'Remetente', 'Destinatario'];

export function linhasLancamentoCte(linhas = []) {
  return linhas.map((l) => ({
    Empresa: l.emp, Cte: l.cte, 'Valor Bruto': l.bruto, Protocolo: l.protocolo, 'Chave CT-e': l.chaveCte, Transportadora: l.transportadora,
    'CNPJ Transp': l.cnpjTransp, Centro: l.centro, 'Valor Liquido': l.liquido, ICMS: l.icms, 'C. Custo': l.cc, 'Cod Imp': l.codImp,
    'Data Emissão': isoParaBr(l.dataEmissao), Vencimento: isoParaBr(l.vencimento), 'Pedido Criado': l.pedido, 'Miro Criada': l.miro, Fatura: l.fatura,
    'CNPJ Tomador': l.cnpjTomador, 'Chave Danfe': l.danfe, Remetente: l.remetente, Destinatario: l.destinatario,
  }));
}
