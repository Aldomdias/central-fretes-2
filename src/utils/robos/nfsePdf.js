// Leitura do PDF da NFS-e (DANFSe, padrao nacional) para pre-preencher a grade do robo de
// lancamento: NF, prestador, CNPJ, data de emissao, valor e CNPJ do tomador.
// Codigo de imposto, CFOP, escritorio de vendas e fatura nao vem na nota (ficam para o usuario).

const SEP = ' ¦ ';

// "3773" -> "3773-F": a NF do SAP sempre leva o sufixo -F.
export function nfComSufixoF(numero) {
  const base = String(numero ?? '').trim().replace(/\s+/g, '');
  if (!base) return '';
  return /-F$/i.test(base) ? base.slice(0, -2) + '-F' : `${base}-F`;
}

// Junta os trechos de texto do PDF em linhas (agrupa pela posicao vertical, ordena pela horizontal).
// Trechos de colunas diferentes ficam separados por " ¦ ".
export function itensParaLinhas(itens = []) {
  const validos = itens.filter((i) => i && typeof i.str === 'string' && i.str.trim() !== '' && Array.isArray(i.transform));
  const porY = [];
  validos.forEach((i) => {
    const y = i.transform[5];
    const linha = porY.find((l) => Math.abs(l.y - y) < 3);
    if (linha) linha.itens.push(i); else porY.push({ y, itens: [i] });
  });
  porY.sort((a, b) => b.y - a.y);
  return porY.map((l) => {
    const ordenados = l.itens.sort((a, b) => a.transform[4] - b.transform[4]);
    let texto = '';
    let fim = null;
    ordenados.forEach((i) => {
      const x = i.transform[4];
      if (fim !== null) texto += x - fim > 12 ? SEP : ' ';
      texto += i.str.trim();
      fim = x + (i.width || 0);
    });
    return texto;
  });
}

const RE_CNPJ = /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/;
const RE_VALOR = /R\$\s*([\d.]+,\d{2})/;
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');

function paraNumero(txt) {
  const n = Number(String(txt).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const chaveMunicipio = (txt) => semAcento(txt).toUpperCase().replace(/[^A-Z0-9]/g, '');
const RE_NUM = /\d{1,3}(?:\.\d{3})*,\d{2}/g;
const numeros = (txt) => (String(txt).match(RE_NUM) || []).map(paraNumero);

// Numero da nota dentro da chave (13 digitos). Algumas prefeituras (ex.: Palmas) colocam o ano na
// frente (2026000000100 = nota 100 de 2026).
function numeroDaChave(treze) {
  const n = String(Number(treze));
  const comAno = n.length === 13 && /^20\d{2}/.test(n);
  return comAno ? String(Number(n.slice(4))) : n;
}

// O OCR junta o nome com o e-mail na mesma linha: corta no primeiro trecho que parece e-mail.
function semEmail(texto) {
  const partes = String(texto).split(/\s+/);
  const i = partes.findIndex((t) => /@/.test(t) || (t.length > 8 && /[A-Za-z0-9&]\.[A-Za-z0-9]/.test(t) && !/\.$/.test(t)));
  return (i > 0 ? partes.slice(0, i) : partes).join(' ').trim();
}

// Sem separacao de colunas (OCR): o municipio e o fim do endereco, antes do CEP. Prestador e tomador
// no mesmo municipio terminam com o mesmo "CIDADE - UF"; senao a parte final difere.
function municipiosPorEndereco(L, U) {
  const fins = [];
  U.forEach((l, k) => {
    if (l.includes('ENDERECO') && l.includes('MUNICIPIO') && l.includes('CEP') && L[k + 1]) {
      const m = L[k + 1].replace(/\s+/g, ' ').trim().match(/^(.*?)\s*\d{5}-?\d{3}\s*$/);
      fins.push((m ? m[1] : L[k + 1]).trim().split(' '));
    }
  });
  if (fins.length < 2) return {};
  const [p, t] = fins;
  let iguais = 0;
  while (iguais < p.length && iguais < t.length && chaveMunicipio(p[p.length - 1 - iguais]) === chaveMunicipio(t[t.length - 1 - iguais])) iguais += 1;
  const cauda = (arr) => chaveMunicipio(arr.slice(-3).join(''));
  return iguais >= 3
    ? { municipioPrestador: cauda(p), municipioTomador: cauda(p) }
    : { municipioPrestador: `P${cauda(p)}`, municipioTomador: `T${cauda(t)}` };
}

// Valor liquido -> codigo de imposto; municipios -> CFOP (regras do lancamento de NFS-e).
// Primeiro digito do CFOP: o SAP compara a UF (1 = mesma UF, 2 = outra UF), nao o municipio.
// Com as duas UFs conhecidas manda a UF; sem elas, cai na comparacao de municipio.
const UF_IBGE = { 11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO', 21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF' };
const UF_POR_NOME = { ACRE: 'AC', ALAGOAS: 'AL', AMAPA: 'AP', AMAZONAS: 'AM', BAHIA: 'BA', CEARA: 'CE', DISTRITOFEDERAL: 'DF', ESPIRITOSANTO: 'ES', GOIAS: 'GO', MARANHAO: 'MA', MATOGROSSO: 'MT', MATOGROSSODOSUL: 'MS', MINASGERAIS: 'MG', PARA: 'PA', PARAIBA: 'PB', PARANA: 'PR', PERNAMBUCO: 'PE', PIAUI: 'PI', RIODEJANEIRO: 'RJ', RIOGRANDEDONORTE: 'RN', RIOGRANDEDOSUL: 'RS', RONDONIA: 'RO', RORAIMA: 'RR', SANTACATARINA: 'SC', SAOPAULO: 'SP', SERGIPE: 'SE', TOCANTINS: 'TO' };
const ufDeChave = (chave) => { const m = String(chave || '').match(/^IBGE(\d{2})/); return m ? UF_IBGE[m[1]] || '' : ''; };
function aplicarRegrasLancamento(dados) {
  if (!(dados.valorLiquido > 0)) dados.valorLiquido = dados.valor;
  dados.codImp = dados.valor > 0 && dados.valorLiquido < dados.valor - 0.005 ? 'IN' : 'IQ';
  const ufP = dados.ufPrestador || ufDeChave(dados.municipioPrestador);
  const ufT = dados.ufTomador || ufDeChave(dados.municipioTomador);
  if (ufP && ufT) dados.cfop = ufP === ufT ? '1933AA' : '2933AA';
  else dados.cfop = dados.municipioPrestador && dados.municipioTomador
    ? (dados.municipioPrestador === dados.municipioTomador ? '1933AA' : '2933AA')
    : '';
}

function resultado(dados) {
  const faltando = [];
  if (!dados.numeroNfse) faltando.push('numero da NFS-e');
  if (dados.cnpjTransp.length !== 14) faltando.push('CNPJ do prestador');
  if (dados.cnpjTomador.length !== 14) faltando.push('CNPJ do tomador');
  if (!dados.dataEmissao) faltando.push('data de emissao');
  if (!(dados.valor > 0)) faltando.push('valor');
  return { dados, faltando };
}

// Modelo "Recibo provisorio de servicos - RPS / NFS-e" (sistema SSW: Rocha e Miura, Carvalima...).
function extrairModeloRps(L, U) {
  const dados = { nf: '', numeroNfse: '', transportadora: '', cnpjTransp: '', cnpjTomador: '', dataEmissao: '', valor: null, chave: '', valorLiquido: null, municipioPrestador: '', municipioTomador: '' };
  dados.transportadora = (L[0] || '').split(SEP)[0].trim();
  const mun = (L[3] || '').match(/^\s*([^¦]+?)\s*-\s*([A-Z]{2})\s*-\s*CEP/i);
  if (mun) { dados.municipioPrestador = chaveMunicipio(`${mun[1]}${mun[2]}`); dados.ufPrestador = mun[2].toUpperCase(); }

  const iCab = U.findIndex((l) => l.includes('NUMERO NFS-E'));
  const linhaCab = iCab >= 0 ? L[iCab + 1] || '' : '';
  const cnpj = linhaCab.match(RE_CNPJ);
  if (cnpj) dados.cnpjTransp = cnpj[1].replace(/\D/g, '');
  const num = linhaCab.match(/\b(\d{15})\b/);
  if (num) dados.numeroNfse = String(Number(num[1]));
  const datas = [...linhaCab.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)];
  if (datas.length) { const d = datas[datas.length - 1]; dados.dataEmissao = `${d[3]}-${d[2]}-${d[1]}`; }
  dados.nf = nfComSufixoF(dados.numeroNfse);

  const iTom = U.findIndex((l) => /^TOMADOR\s+(?!SERVICO)/.test(l.trim()));
  if (iTom >= 0) {
    for (let k = iTom; k < Math.min(iTom + 4, L.length); k += 1) {
      if (!dados.cnpjTomador) { const m = L[k].match(RE_CNPJ); if (m) dados.cnpjTomador = m[1].replace(/\D/g, ''); }
      const m2 = L[k].match(/^MUN\s+([^¦]+?)\s*-\s*([A-Z]{2})\b/i);
      if (m2 && !dados.municipioTomador) { dados.municipioTomador = chaveMunicipio(`${m2[1]}${m2[2]}`); dados.ufTomador = m2[2].toUpperCase(); }
    }
  }
  const todo = L.join('\n');
  const bruto = todo.match(/FRETE TOTAL \(R\$\)\s*(?:¦\s*)?([\d.]+,\d{2})/i);
  const liquido = todo.match(/VALOR A RECEBER \(R\$\)\s*(?:¦\s*)?([\d.]+,\d{2})/i);
  if (bruto) dados.valor = paraNumero(bruto[1]);
  if (liquido) dados.valorLiquido = paraNumero(liquido[1]);
  // RPS sozinho (a coluna "NUMERO NFS-E" vazia): e so o recibo; a nota fiscal vem em outra pagina e e ela que vale
  if (!dados.numeroNfse) return { dados, faltando: [], rps: true };
  aplicarRegrasLancamento(dados);
  return resultado(dados);
}

// Modelo ISS.NET / Nota Control (ex.: Governo do Distrito Federal): blocos "Dados do Prestador de
// Servico" e "Dados do Tomador de Servicos", valores na linha abaixo dos titulos do "Detalhamento dos Tributos".
// O PDF do DF as vezes vem com as letras desenhadas (sem texto) e passa pelo OCR, que le "Vl." como "VI."
// e "DF" como "DE", junta o nome do prestador com a data de geracao e mistura lixo do QR Code nas linhas.
const RE_VL_TOTAL = /\bV[LI1|]\.?\s*TOTAL DOS SERVICOS/;
const RE_VL_LIQUIDO = /\bV[LI1|]\.?\s*LIQUIDO DA NOTA/;
const UF_VALIDAS = new Set(Object.values(UF_IBGE));
function extrairModeloIssNet(linhas, U) {
  // OCR troca o zero do dia por letra ("D4/09/2026 20:45:09" = 04/09/2026)
  const L = linhas.map((l) => l.replace(/(^|\s)[ODoQ](\d\/\d{2}\/20\d{2})/g, '$10$2'));
  const dados = { nf: '', numeroNfse: '', transportadora: '', cnpjTransp: '', cnpjTomador: '', dataEmissao: '', valor: null, chave: '', valorLiquido: null, municipioPrestador: '', municipioTomador: '' };
  const todo = L.join('\n');
  const chave = (todo.match(/\b(\d{50})\b/) || [])[1];
  if (chave) {
    dados.chave = chave;
    dados.cnpjTransp = chave.slice(9, 23);
    dados.numeroNfse = numeroDaChave(chave.slice(23, 36));
  }
  if (!dados.numeroNfse) {
    const i = U.findIndex((l) => l.includes('NUMERO DA NOTA FISCAL'));
    const m = i >= 0 ? (L[i + 1] || '').match(/^\s*(\d+)\s*$/) : null;
    if (m) dados.numeroNfse = String(Number(m[1]));
  }
  dados.nf = nfComSufixoF(dados.numeroNfse);
  const d = todo.match(/(\d{2})\/(\d{2})\/(\d{4})\s+\d{2}:\d{2}(?::\d{2})?/);
  if (d) dados.dataEmissao = `${d[3]}-${d[2]}-${d[1]}`;

  const iPrest = U.findIndex((l) => l.includes('DADOS DO PRESTADOR DE SERVICO'));
  const iTom = U.findIndex((l) => l.includes('DADOS DO TOMADOR DE SERVICO'));
  const fimPrest = iTom > iPrest ? iTom : L.length;
  if (iPrest >= 0) {
    // nome: primeira linha do bloco que nao e titulo nem data (as datas da coluna da direita se intercalam)
    for (let k = iPrest + 1; k < fimPrest; k += 1) {
      const t = L[k].split(SEP)[0].trim();
      if (!t || /^(DATA|COD\.|RESPONSAVEL|IDENTIFICACAO)/.test(semAcento(t).toUpperCase()) || /^[\d/: ]+$/.test(t)) continue;
      // OCR: "NOME LTDA. 10/09/2026 13:29:10 | lixo" -> corta na data; linhas de lixo tem poucas letras
      const nome = t.replace(/\s*\d{2}\/\d{2}\/\d{4}.*$/, '').replace(/\s*\|.*$/, '').trim();
      if ((nome.match(/[A-Za-zÀ-ÿ]/g) || []).length < 8) continue;
      dados.transportadora = nome;
      break;
    }
    for (let k = iPrest + 1; k < fimPrest; k += 1) {
      const cnpj = L[k].match(RE_CNPJ);
      if (cnpj && !dados.cnpjTransp) dados.cnpjTransp = cnpj[1].replace(/\D/g, '');
      const mun = L[k].match(/CEP\s*[\d.-]+\s*-\s*([^/¦]+?)\s*\/\s*([A-Za-z]{2})\b/);
      if (mun && !dados.municipioPrestador) { dados.municipioPrestador = chaveMunicipio(`${mun[1]}${mun[2]}`); dados.ufPrestador = mun[2].toUpperCase(); }
    }
  }
  // a chave (IBGE do municipio emissor) vale mais que a UF lida (o OCR troca "DF" por "DE")
  const ufChave = dados.chave ? UF_IBGE[dados.chave.slice(0, 2)] || '' : '';
  if (ufChave && dados.ufPrestador !== ufChave) {
    dados.municipioPrestador = `IBGE${dados.chave.slice(0, 7)}`;
    dados.ufPrestador = ufChave;
  } else if (dados.ufPrestador && !UF_VALIDAS.has(dados.ufPrestador)) {
    dados.municipioPrestador = '';
    dados.ufPrestador = '';
  }
  if (iTom >= 0) {
    for (let k = iTom + 1; k < Math.min(iTom + 8, L.length); k += 1) {
      const cnpj = L[k].match(RE_CNPJ);
      if (cnpj && !dados.cnpjTomador) dados.cnpjTomador = cnpj[1].replace(/\D/g, '');
      const mun = L[k].match(/Cidade\s*\/\s*UF\s*:\s*(?:¦\s*)?([^/¦]+?)\s*\/\s*([A-Za-z]{2})\b/i);
      if (mun && !dados.municipioTomador && UF_VALIDAS.has(mun[2].toUpperCase())) { dados.municipioTomador = chaveMunicipio(`${mun[1]}${mun[2]}`); dados.ufTomador = mun[2].toUpperCase(); }
    }
  }

  // "Vl. Total dos Servicos" e a 1a coluna; "Vl. Liquido da NotaFiscal" e a ultima
  const iTot = U.findIndex((l) => RE_VL_TOTAL.test(l));
  if (iTot >= 0) { const v = (L[iTot + 1] || '').match(RE_VALOR); if (v) dados.valor = paraNumero(v[1]); }
  const iLiq = U.findIndex((l) => RE_VL_LIQUIDO.test(l));
  if (iLiq >= 0) { const v = numeros(L[iLiq + 1] || ''); if (v.length) dados.valorLiquido = v[v.length - 1]; }
  aplicarRegrasLancamento(dados);
  return resultado(dados);
}

// Modelo municipal "Nota Fiscal de Servico Eletronica - Serie NFS-e" (ex.: Pouso Alegre): titulos numa linha e
// valores na de baixo ("Valor Total ... Base de Calculo ISSQN"); prestador no cabecalho, tomador em "Cidade".
// Variante sem chave nacional (ex.: Brusque/SC): "Identificador" NFS + IBGE 7 + ... + CNPJ 14 + numero 13; o numero
// tambem vem na celula abaixo de "Numero da NFS-e" e o CNPJ do prestador no cabecalho, antes do TOMADOR.
function completarModeloSerieNfse(L, U, dados) {
  const ident = L.join('\n').match(/NFS(\d{7})\d{2}(\d{14})(\d{13})\d*/);
  if (ident && !dados.chave) {
    if (dados.cnpjTransp.length !== 14) dados.cnpjTransp = ident[2];
    if (!dados.numeroNfse) dados.numeroNfse = String(Number(ident[3]));
    if (!dados.municipioPrestador) dados.municipioPrestador = `IBGE${ident[1]}`;
  }
  if (!dados.numeroNfse) {
    const i = U.findIndex((l) => l.includes('NUMERO DA NFS-E'));
    if (i >= 0 && L[i + 1]) {
      const rot = U[i].split(SEP);
      const val = L[i + 1].split(SEP);
      const idx = rot.findIndex((c) => c.includes('NUMERO DA NFS-E'));
      const cel = val.length === rot.length ? val[idx] : val.find((c) => /^\s*\d{1,9}\s*$/.test(c));
      const m = String(cel || '').trim().match(/^(\d{1,9})$/);
      if (m) dados.numeroNfse = String(Number(m[1]));
    }
  }
  dados.nf = nfComSufixoF(dados.numeroNfse);
  const iTom = U.findIndex((l) => /^TOMADOR D[EO] SERVICO/.test(l.trim()));
  // CNPJ com ou sem pontuacao ("CNPJ: 89823918002007", como sai na Translovato de Pouso Alegre)
  const cnpjDe = (txt) => {
    const m = String(txt || '').match(RE_CNPJ) || String(txt || '').match(/(?:^|[^\d])(\d{14})(?!\d)/);
    return m ? m[1].replace(/\D/g, '') : '';
  };
  if (dados.cnpjTransp.length !== 14) {
    const cab = L.slice(0, iTom >= 0 ? iTom : 10).map((l) => (/CNPJ/i.test(l) ? cnpjDe(l) : '')).find(Boolean);
    if (cab) dados.cnpjTransp = cab;
  }
  if (dados.cnpjTomador.length !== 14 && iTom >= 0) {
    const i = U.findIndex((l, k) => k > iTom && k < iTom + 6 && l.includes('CPF/CNPJ'));
    if (i >= 0) {
      const rot = U[i].split(SEP);
      const cel = (L[i + 1] || '').split(SEP);
      const idx = rot.findIndex((c) => c.includes('CPF/CNPJ'));
      const c = (cel.length === rot.length ? cnpjDe(cel[idx]) : '') || cnpjDe(L[i + 1]);
      if (c) dados.cnpjTomador = c;
    }
  }
  if (!dados.dataEmissao) {
    const d = L.join('\n').match(/(\d{2})\/(\d{2})\/(\d{4})\s*[-,]?\s*\d{2}:\d{2}/);
    if (d) dados.dataEmissao = `${d[3]}-${d[2]}-${d[1]}`;
  }
  // valores com virgula ("192,73") ou ponto decimal ("58.99"); "Valor Total" e a 1a coluna, "Valor Liquido" a ultima
  const iTot = U.findIndex((l) => l.includes('VALOR TOTAL') && l.includes('BASE DE CALCULO'));
  if (iTot >= 0 && !(dados.valor > 0)) {
    const v = numerosFlex(L[iTot + 1] || '');
    if (v.length) dados.valor = v[0];
  }
  const iLiq = U.findIndex((l, k) => k > iTot && iTot >= 0 && l.includes('VALOR LIQUIDO'));
  if (iLiq >= 0) {
    const v = numerosFlex(L[iLiq + 1] || '');
    if (v.length) dados.valorLiquido = v[v.length - 1];
  }
  // "Municipio: Pouso Alegre - Minas Gerais" (UF por extenso) no cabecalho do prestador
  if (!dados.ufPrestador) {
    const m = L.slice(0, iTom >= 0 ? iTom : 10).map((l) => l.match(/Munic[ií]pio:\s*(?:¦\s*)?([^¦]+?)\s*-\s*([A-Za-zÀ-ÿ ]+?)\s*(?:¦|$)/i)).find(Boolean);
    const uf = m ? (m[2].trim().length === 2 ? m[2].trim().toUpperCase() : UF_POR_NOME[chaveMunicipio(m[2])]) : '';
    if (uf) { dados.municipioPrestador = chaveMunicipio(`${m[1]}${uf}`); dados.ufPrestador = uf; }
  }
  if (!dados.transportadora && L[0]) dados.transportadora = semEmail(L[0].split(SEP)[0].split(' - ')[0].trim());
  if (!dados.municipioPrestador && dados.chave) dados.municipioPrestador = `IBGE${dados.chave.slice(0, 7)}`;
  if (!dados.ufTomador) {
    const i = U.findIndex((l) => l.includes('BAIRRO') && l.includes('CEP') && l.includes('CIDADE'));
    const m = i >= 0 ? String(L[i + 1] || '').match(/([A-Za-zÀ-ÿ' ]+?)\s*-\s*([A-Z]{2})\s*$/) : null;
    if (m) { dados.municipioTomador = chaveMunicipio(`${m[1]}${m[2]}`); dados.ufTomador = m[2].toUpperCase(); }
  }
}

// Valores com virgula ("1.095,14") ou com ponto decimal ("93.93", como sai em alguns DANFSe).
const RE_NUM_FLEX = /\d+(?:\.\d{3})*,\d{2}(?!\d)|\d+\.\d{2}(?![\d.])/g;
const numerosFlex = (txt) => (String(txt).match(RE_NUM_FLEX) || []).map((t) => (t.includes(',') ? paraNumero(t) : Number(t)));

// "SAO JOSE DOS PINHAIS - PR" -> { municipio, uf }
function municipioUf(txt) {
  const m = String(txt || '').match(/([A-Za-zÀ-ÿ' .]+?)\s*-\s*([A-Za-z]{2})\s*$/);
  return m ? { municipio: chaveMunicipio(`${m[1]}${m[2]}`), uf: m[2].toUpperCase() } : null;
}

// Modelo DANFSe V1.0 com blocos "EMITENTE DA NFS-e" / "TOMADOR DA NFS-e" e "VALOR TOTAL DA NFS-E"
// (ex.: Translovato): data "04/09/2026 - 12:19:29", valores com ponto decimal na linha abaixo dos
// titulos e o CNPJ do tomador sozinho na linha (sem o rotulo "Tomador do Servico"). So completa o que faltou.
function completarModeloDanfseEmitente(L, U, dados) {
  const iEmit = U.findIndex((l) => l.includes('EMITENTE DA NFS-E'));
  const iTom = U.findIndex((l) => /^TOMADOR DA NFS-E/.test(l.trim()));
  const iFimTom = U.findIndex((l, k) => k > iTom && (l.includes('INTERMEDIARIO') || l.includes('SERVICO PRESTADO')));
  const fimTom = iFimTom > iTom ? iFimTom : Math.min(iTom + 8, L.length);

  if (!dados.numeroNfse) {
    const i = U.findIndex((l) => l.includes('NUMERO DA NFS-E') && !l.includes('DPS'));
    const m = i >= 0 ? (L[i + 1] || '').match(/^\s*(\d+)\b/) : null;
    if (m) { dados.numeroNfse = String(Number(m[1])); dados.nf = nfComSufixoF(dados.numeroNfse); }
  }
  if (!dados.dataEmissao) {
    const d = L.join('\n').match(/(\d{2})\/(\d{2})\/(\d{4})\s*-?\s*\d{2}:\d{2}/);
    if (d) dados.dataEmissao = `${d[3]}-${d[2]}-${d[1]}`;
  }

  // bloco: CNPJ, nome e "Endereco ¦ Municipio ¦ CEP" com os valores na linha de baixo
  const lerBloco = (ini, fim) => {
    const r = { cnpj: '', nome: '', mun: null };
    for (let k = ini; k < fim; k += 1) {
      const c = L[k].match(RE_CNPJ);
      if (c && !r.cnpj) r.cnpj = c[1].replace(/\D/g, '');
      if (U[k].includes('NOME / NOME EMPRESARIAL') && L[k + 1] && !r.nome) r.nome = semEmail(L[k + 1].split(SEP)[0].trim());
      if (U[k].includes('MUNICIPIO') && U[k].includes('CEP') && L[k + 1] && !r.mun) {
        const rot = U[k].split(SEP.toUpperCase());
        const cel = L[k + 1].split(SEP);
        const idx = rot.findIndex((x) => x.includes('MUNICIPIO'));
        r.mun = (cel.length === rot.length ? municipioUf(cel[idx]) : null)
          || cel.map(municipioUf).find(Boolean)
          || municipioUf(L[k + 1].replace(/\s*¦?\s*\d{5}-?\d{3}\s*$/, ''));
      }
    }
    return r;
  };
  if (iEmit >= 0) {
    const p = lerBloco(iEmit, iTom > iEmit ? iTom : L.length);
    if (!dados.cnpjTransp && p.cnpj) dados.cnpjTransp = p.cnpj;
    if (!dados.transportadora && p.nome) dados.transportadora = p.nome;
    if (p.mun && !dados.ufPrestador) { dados.municipioPrestador = p.mun.municipio; dados.ufPrestador = p.mun.uf; }
  }
  if (iTom >= 0) {
    const t = lerBloco(iTom, fimTom);
    if (dados.cnpjTomador.length !== 14 && t.cnpj) dados.cnpjTomador = t.cnpj;
    if (t.mun && !dados.ufTomador) { dados.municipioTomador = t.mun.municipio; dados.ufTomador = t.mun.uf; }
  }

  // "VALOR TOTAL DA NFS-E": "Valor do Servico" e a 1a coluna; "Valor Liquido da NFS-e" e a ultima
  const iTot = U.findIndex((l) => l.includes('VALOR TOTAL DA NFS-E'));
  if (iTot >= 0) {
    const iServ = U.findIndex((l, k) => k > iTot && l.includes('VALOR DO SERVICO'));
    const iLiq = U.findIndex((l, k) => k > iTot && l.includes('VALOR LIQUIDO DA NFS-E'));
    if (!(dados.valor > 0) && iServ >= 0) { const v = numerosFlex(L[iServ + 1] || ''); if (v.length) dados.valor = v[0]; }
    if (!(dados.valorLiquido > 0) && iLiq >= 0) {
      const v = numerosFlex(L[iLiq + 1] || '');
      if (v.length) dados.valorLiquido = v[v.length - 1];
    }
  }
}

// Modelo municipal "NFSe - Prestador" (ex.: Prefeitura de Campo Grande/MS): blocos "EMITENTE PRESTADOR DO SERVICO"
// e "TOMADOR DO SERVICO" com "Nome / Nome Empresarial ¦ E-mail" e "Endereco ¦ Municipio ¦ CEP" (municipio
// "CAMPO GRANDE / MS BRASIL"); valores em "CALCULO DO ISSQN" ("Valor total da NFSe") e "VALOR TOTAL"
// ("Valor Liquido da NFSe"), sempre na linha abaixo dos titulos. So completa/corrige o que o leitor geral nao pegou.
function completarModeloEmitentePrestador(L, U, dados) {
  const iEmit = U.findIndex((l) => l.includes('EMITENTE PRESTADOR DO SERVICO'));
  const iTom = U.findIndex((l, k) => k > iEmit && /^TOMADOR DO SERVICO/.test(l.trim()));
  const iFimTom = U.findIndex((l, k) => k > iTom && (l.includes('SERVICO PRESTADO') || l.includes('INTERMEDIARIO')));
  const munUf = (txt) => {
    const m = String(txt || '').match(/([A-Za-zÀ-ÿ' .]+?)\s*\/\s*([A-Za-z]{2})\b/);
    return m ? { municipio: chaveMunicipio(`${m[1]}${m[2]}`), uf: m[2].toUpperCase() } : null;
  };
  const lerBloco = (ini, fim) => {
    const r = { cnpj: '', nome: '', mun: null };
    for (let k = ini; k < fim; k += 1) {
      const c = L[k].match(RE_CNPJ);
      if (c && !r.cnpj) r.cnpj = c[1].replace(/\D/g, '');
      if (U[k].includes('NOME / NOME EMPRESARIAL') && L[k + 1] && !r.nome) r.nome = semEmail(L[k + 1].split(SEP)[0].trim());
      if (U[k].includes('MUNICIPIO') && U[k].includes('CEP') && L[k + 1] && !r.mun) {
        const rot = U[k].split(SEP);
        const cel = L[k + 1].split(SEP);
        const idx = rot.findIndex((x) => x.includes('MUNICIPIO'));
        r.mun = (cel.length === rot.length ? munUf(cel[idx]) : null) || cel.slice(1).map(munUf).find(Boolean) || null;
      }
    }
    return r;
  };
  if (iEmit >= 0) {
    const p = lerBloco(iEmit, iTom > iEmit ? iTom : L.length);
    if (dados.cnpjTransp.length !== 14 && p.cnpj) dados.cnpjTransp = p.cnpj;
    if (!dados.transportadora && p.nome) dados.transportadora = p.nome;
    if (p.mun) { dados.municipioPrestador = p.mun.municipio; dados.ufPrestador = p.mun.uf; }
  }
  if (iTom >= 0) {
    const t = lerBloco(iTom, iFimTom > iTom ? iFimTom : Math.min(iTom + 8, L.length));
    if (dados.cnpjTomador.length !== 14 && t.cnpj) dados.cnpjTomador = t.cnpj;
    if (t.mun) { dados.municipioTomador = t.mun.municipio; dados.ufTomador = t.mun.uf; }
  }
  // celula da linha de baixo alinhada ao titulo (mesmo numero de colunas); senao a 1a/ultima
  const celulaAbaixo = (i, re, ultima) => {
    if (i < 0 || !L[i + 1]) return null;
    const rot = U[i].split(SEP);
    const cel = L[i + 1].split(SEP);
    const idx = rot.findIndex((x) => re.test(x));
    const alvo = cel.length === rot.length && idx >= 0 ? numerosFlex(cel[idx]) : [];
    if (alvo.length) return alvo[0];
    const todos = numerosFlex(L[i + 1]);
    return todos.length ? todos[ultima ? todos.length - 1 : 0] : null;
  };
  const iTot = U.findIndex((l) => l.includes('VALOR TOTAL DA NFSE'));
  const vTot = celulaAbaixo(iTot, /VALOR TOTAL DA NFSE/, false);
  if (!(dados.valor > 0) && vTot > 0) dados.valor = vTot;
  const iLiq = U.findIndex((l) => l.includes('VALOR LIQUIDO DA NFSE'));
  const vLiq = celulaAbaixo(iLiq, /VALOR LIQUIDO DA NFSE/, true);
  if (vLiq !== null) dados.valorLiquido = vLiq;
}

// Modelo municipal com blocos "PRESTADOR" / "TOMADOR" sozinhos na linha (ex.: Vitoria da Conquista/BA):
// "Razao Social: X", "Cidade - UF - CEP: ..." na linha abaixo do endereco, "... - CPF/CNPJ: 00.000.000/0000-00" no fim
// do bloco; "No da Nota Fiscal" com ano na frente (202600000000004 = nota 4); "VALOR SERVICO (R$)" na 1a coluna da
// linha de baixo e o "VALOR LIQUIDO (R$)" como ultimo numero da linha dos tributos federais. So completa/corrige.
function completarModeloPrestadorTomador(L, U, dados) {
  const iPrest = U.findIndex((l) => l.trim() === 'PRESTADOR');
  const iTom = U.findIndex((l, k) => k > iPrest && l.trim() === 'TOMADOR');
  const iFimTom = U.findIndex((l, k) => k > iTom && /^SERVICO|^DISCRIMINACAO/.test(l.trim()));
  const lerBloco = (ini, fim) => {
    const r = { cnpj: '', nome: '', mun: null };
    for (let k = ini + 1; k < fim; k += 1) {
      const c = L[k].match(/CNPJ:\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i) || L[k].match(RE_CNPJ);
      if (c && !r.cnpj) r.cnpj = c[1].replace(/\D/g, '');
      const n = L[k].match(/Raz[ãa]o Social:\s*(.+)$/i);
      if (n && !r.nome) r.nome = n[1].split(SEP).join(' ').trim();
      const m = L[k].match(/^\s*([A-Za-zÀ-ÿ' .]+?)\s*-\s*([A-Za-z]{2})\s*-\s*CEP/i);
      if (m && !r.mun) r.mun = { municipio: chaveMunicipio(`${m[1]}${m[2]}`), uf: m[2].toUpperCase() };
    }
    return r;
  };
  if (iPrest >= 0) {
    const p = lerBloco(iPrest, iTom > iPrest ? iTom : Math.min(iPrest + 8, L.length));
    if (dados.cnpjTransp.length !== 14 && p.cnpj) dados.cnpjTransp = p.cnpj;
    if (p.nome) dados.transportadora = p.nome;
    if (p.mun) { dados.municipioPrestador = p.mun.municipio; dados.ufPrestador = p.mun.uf; }
  }
  if (iTom >= 0) {
    const t = lerBloco(iTom, iFimTom > iTom ? iFimTom : Math.min(iTom + 8, L.length));
    if (t.cnpj) dados.cnpjTomador = t.cnpj;
    if (t.mun) { dados.municipioTomador = t.mun.municipio; dados.ufTomador = t.mun.uf; }
  }
  // numero da nota: "No da Nota Fiscal" (15 digitos com o ano na frente); a chave aqui leva so 2 digitos do ano
  const iNum = U.findIndex((l) => /N[º°O.]?\s*DA NOTA FISCAL/.test(l));
  if (iNum >= 0) {
    for (let k = iNum; k < Math.min(iNum + 3, L.length); k += 1) {
      const m = L[k].match(/\b(20\d{2})(\d{11})\b/);
      if (m) { dados.numeroNfse = String(Number(m[2])); dados.nf = nfComSufixoF(dados.numeroNfse); break; }
    }
  }
  const e = L.join('\n').match(/Emitido em\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  if (e) dados.dataEmissao = `${e[3]}-${e[2]}-${e[1]}`;
  const iServ = U.findIndex((l) => l.includes('VALOR SERVICO (R$)'));
  if (iServ >= 0) { const v = numerosFlex((L[iServ + 1] || '').split(SEP)[0]); if (v.length) dados.valor = v[0]; }
  const iLiq = U.findIndex((l, k) => k > iServ && l.includes('VALOR LIQUIDO (R$)'));
  if (iLiq >= 0) {
    for (let k = iLiq + 1; k < Math.min(iLiq + 5, L.length); k += 1) {
      const v = numeros(L[k]);
      if (v.length >= 3) { dados.valorLiquido = v[v.length - 1]; break; }
    }
  }
}

// linhas: saida de itensParaLinhas (ou o texto do PDF dividido por linha).
export function extrairDadosNfse(linhas = [], { ocr = false } = {}) {
  const L = linhas.map((l) => String(l ?? ''));
  const U = L.map((l) => semAcento(l).toUpperCase());
  if (U.some((l) => l.includes('RECIBO PROVISORIO DE SERVICOS'))) return extrairModeloRps(L, U);
  if (U.some((l) => l.includes('DADOS DO TOMADOR DE SERVICO')) && U.some((l) => RE_VL_TOTAL.test(l))) return extrairModeloIssNet(L, U);
  const todo = L.join('\n');
  const dados = { nf: '', numeroNfse: '', transportadora: '', cnpjTransp: '', cnpjTomador: '', dataEmissao: '', valor: null, chave: '' };
  const faltando = [];

  // chave de acesso: 50 digitos. Dela saem, sem ambiguidade, o CNPJ do prestador e o numero da nota
  // (IBGE 7 + ambiente 1 + tipo de inscricao 1 + CNPJ 14 + numero 13 + ...).
  const chave = (todo.match(/\b(\d{50})\b/) || [])[1];
  if (chave) {
    dados.chave = chave;
    dados.cnpjTransp = chave.slice(9, 23);
    dados.numeroNfse = numeroDaChave(chave.slice(23, 36));
  }
  if (!dados.numeroNfse) {
    const i = U.findIndex((l) => l.includes('NUMERO DA NFS-E') && !l.includes('DPS'));
    const m = i >= 0 ? (L[i + 1] || '').match(/^\s*(\d+)\b/) : null;
    if (m) dados.numeroNfse = String(Number(m[1]));
  }
  if (!dados.numeroNfse) {
    // modelo das prefeituras (ex.: Ginfes): o numero vem sozinho numa das primeiras linhas
    const m = L.slice(0, 8).map((l) => l.trim().match(/^(\d{1,9})$/)).find(Boolean);
    if (m) dados.numeroNfse = String(Number(m[1]));
  }
  dados.nf =nfComSufixoF(dados.numeroNfse);

  // data da emissao da NFS-e: primeira data seguida de hora (a competencia vem sem hora)
  const d = todo.match(/(\d{2})\/(\d{2})\/(\d{4})\s*,?\s+\d{2}:\d{2}(?::\d{2})?/);
  if (d) dados.dataEmissao = `${d[3]}-${d[2]}-${d[1]}`;

  // prestador (nome e, se faltar a chave, o CNPJ) e tomador (CNPJ)
  const iPrest = U.findIndex((l) => l.includes('PRESTADOR / FORNECEDOR') || /^PRESTADOR D[EO] SERVICO/.test(l.trim()));
  const iTom = U.findIndex((l) => l.includes('TOMADOR / ADQUIRENTE') || /^TOMADOR D[EO] SERVICO/.test(l.trim()));
  const cnpjApos = (inicio) => {
    if (inicio < 0) return '';
    for (let k = inicio; k < Math.min(inicio + 6, L.length); k += 1) {
      const m = L[k].match(RE_CNPJ);
      if (m) return m[1].replace(/\D/g, '');
    }
    return '';
  };
  if (!dados.cnpjTransp) dados.cnpjTransp = cnpjApos(iPrest);
  dados.cnpjTomador = cnpjApos(iTom);

  const iNomePrest = U.findIndex((l, k) => k > iPrest && iPrest >= 0 && l.includes('NOME / NOME EMPRESARIAL'));
  if (iNomePrest >= 0 && L[iNomePrest + 1]) dados.transportadora = semEmail(L[iNomePrest + 1].split(SEP)[0].trim());

  if (!dados.transportadora && iPrest >= 0) {
    const k = U.findIndex((l, n) => n > iPrest && n < iPrest + 6 && l.includes('RAZAO'));
    if (k >= 0) {
      // "Nome/Razao Social: X", "Nome/Razao ¦ X" ou o titulo sozinho com o nome na linha de baixo
      const mesma = L[k].replace(/^Nome\s*\/\s*Raz[ãa]o(\s+Social)?\s*:?\s*/i, '').replace(/^Raz[ãa]o Social\s*:?\s*/i, '').replace(/^¦\s*/, '').split(SEP).join(' ').replace(/\s+/g, ' ').trim();
      dados.transportadora = mesma || String(L[k + 1] || '').trim();
    }
  }

  // valor da operacao/servico (= valor bruto da nota): primeiro R$ da linha abaixo do titulo
  const iVal = U.findIndex((l) => l.includes('VALOR DA OPERACAO'));
  if (iVal >= 0) {
    for (let k = iVal + 1; k < Math.min(iVal + 3, L.length); k += 1) {
      const m = L[k].match(RE_VALOR);
      if (m) { dados.valor = paraNumero(m[1]); break; }
    }
  }

  if (!(dados.valor > 0)) {
    // modelo das prefeituras: "Valor do Servico ¦ 23,68"
    const k = U.findIndex((l) => /VALOR DOS? SERVICOS?\b/.test(l));
    const re = /\d{1,3}(?:\.\d{3})*,\d{2}/g;
    const todos = k >= 0 ? L[k].match(re) : null;
    if (todos) dados.valor = paraNumero(todos[todos.length - 1]);
    else if (k >= 0) {
      // titulos numa linha e valores na de baixo (mesma ordem das colunas): "Valor do Servico" e a 1a coluna
      const celulas = L[k].split(SEP);
      const abaixo = (L[k + 1] || '').split(SEP);
      const idx = Math.max(0, celulas.findIndex((c) => /VALOR DOS? SERVICOS?\b/.test(semAcento(c).toUpperCase())));
      const alvo = abaixo.length === celulas.length ? abaixo[idx] : abaixo[0];
      const m = String(alvo || '').match(re);
      if (m) dados.valor = paraNumero(m[0]);
    }
  }

  // valor liquido (bruto menos retencoes): dele sai o codigo de imposto
  const nums = (txt) => (String(txt).match(/\d{1,3}(?:\.\d{3})*,\d{2}/g) || []).map(paraNumero);
  const iLiq = U.findIndex((l) => l.includes('VALOR LIQUIDO'));
  if (iLiq >= 0) {
    const celulasRot = U[iLiq].split(SEP.toUpperCase());
    const idx = celulasRot.findIndex((c) => c.includes('VALOR LIQUIDO'));
    const naLinha = nums(L[iLiq]);
    if (naLinha.length) dados.valorLiquido = naLinha[naLinha.length - 1];
    else if (L[iLiq + 1]) {
      const celulasVal = L[iLiq + 1].split(SEP);
      const alinhado = celulasVal.length === celulasRot.length ? nums(celulasVal[idx]).slice(-1) : [];
      const todos = nums(L[iLiq + 1]);
      dados.valorLiquido = alinhado.length ? alinhado[0] : (todos.length ? todos[todos.length - 1] : null);
    }
  }

  // municipio do prestador e do tomador: mesmo municipio -> CFOP 1933AA, senao 2933AA
  const chaveMun = chaveMunicipio;
  const municipioApos = (inicio) => {
    if (inicio < 0) return '';
    for (let k = inicio; k < Math.min(inicio + 10, L.length); k += 1) {
      if (k > inicio && /^(PRESTADOR|TOMADOR)/.test(U[k].trim())) break;
      const g = L[k].match(/Munic[ií]pio:\s*(?:¦\s*)?(.+?)\s*(?:¦|$)/i); // modelo das prefeituras
      if (g) return chaveMun(g[1]);
      if (U[k].includes('NOME / NOME EMPRESARIAL') && L[k + 1]) { // modelo nacional: Nome ¦ Municipio / UF ¦ IBGE / CEP
        const cel = L[k + 1].split(SEP);
        const ibge = (cel[2] || '').split('/')[0].replace(/\D/g, '');
        return ibge.length >= 6 ? `IBGE${ibge}` : chaveMun(cel[1] || '');
      }
      if (U[k].trim() === 'ENDERECO' && L[k + 1]) { // modelo de Palmas: ... - CEP: 77023-122 - Palmas - TO
        const a = L[k + 1].match(/-\s*([^-¦]+?)\s*-\s*([A-Za-z]{2})\s*$/);
        if (a) return chaveMun(`${a[1]}${a[2]}`);
      }
    }
    return '';
  };
  dados.municipioPrestador = municipioApos(iPrest);
  dados.municipioTomador = municipioApos(iTom);
  if (!dados.municipioPrestador || !dados.municipioTomador) Object.assign(dados, municipiosPorEndereco(L, U));
  if (U.some((l) => l.includes('SERIE NFS-E')) && U.some((l) => l.includes('BASE DE CALCULO') && l.includes('ISSQN'))) completarModeloSerieNfse(L, U, dados);
  if (U.some((l) => l.includes('EMITENTE DA NFS-E')) && U.some((l) => /^TOMADOR DA NFS-E/.test(l.trim())) && U.some((l) => l.includes('VALOR TOTAL DA NFS-E'))) completarModeloDanfseEmitente(L, U, dados);
  if (U.some((l) => l.includes('EMITENTE PRESTADOR DO SERVICO')) && U.some((l) => l.includes('VALOR TOTAL DA NFSE'))) completarModeloEmitentePrestador(L, U, dados);
  if (U.some((l) => l.trim() === 'PRESTADOR') && U.some((l) => l.trim() === 'TOMADOR') && U.some((l) => l.includes('VALOR SERVICO (R$)'))) completarModeloPrestadorTomador(L, U, dados);
  aplicarRegrasLancamento(dados);
  return resultado(dados);
}

// Abre o PDF no navegador (pdfjs).
export async function abrirPdf(arquivo) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  const dados = new Uint8Array(await arquivo.arrayBuffer());
  return pdfjs.getDocument({ data: dados }).promise;
}

async function linhasDaPagina(pdf, n) {
  const pagina = await pdf.getPage(n);
  const conteudo = await pagina.getTextContent();
  return itensParaLinhas(conteudo.items);
}

// Um PDF pode ter varias notas, uma por pagina. Devolve uma leitura por pagina; paginas de
// continuacao (sem numero, CNPJ nem valor, depois de uma pagina lida) ficam de fora.
// opcoes.ocr: leitura de texto vindo de OCR; opcoes.ocrPaginas[i]: so a pagina i veio de OCR.
// opcoes.ignoradas: recebe as paginas puladas (continuacao ou RPS), para a tela avisar e nada sumir calado.
export function lerPaginas(paginas = [], opcoes = {}) {
  const ignoradas = Array.isArray(opcoes.ignoradas) ? opcoes.ignoradas : [];
  const notas = [];
  let rps = 0;
  paginas.forEach((linhas, i) => {
    const ocr = Boolean(opcoes.ocr || (opcoes.ocrPaginas || [])[i]);
    const r = { pagina: i + 1, ocr, ...extrairDadosNfse(linhas, { ocr }), semTexto: linhas.length === 0 };
    if (r.rps) { rps += 1; ignoradas.push({ pagina: i + 1, motivo: 'rps' }); return; } // RPS (recibo provisorio): ignora, vale so a nota fiscal
    const vazia = !r.dados.numeroNfse && r.dados.cnpjTransp.length !== 14 && !(r.dados.valor > 0);
    const anteriorOk = notas.some((n) => !n.faltando.length);
    if (i > 0 && anteriorOk && (r.semTexto || vazia)) { ignoradas.push({ pagina: i + 1, motivo: 'continuacao', ocr }); return; }
    notas.push(r);
  });
  if (!notas.length && rps) notas.push({ pagina: 1, ocr: false, dados: { nf: '', numeroNfse: '', transportadora: '', cnpjTransp: '', cnpjTomador: '', dataEmissao: '', valor: null }, faltando: ['NFS-e (o arquivo so tem RPS)'], semTexto: false });
  return notas;
}

// opcoes.ocr(pdf, n) -> linhas: usado nas paginas sem texto (PDF escaneado ou com letras desenhadas).
export async function lerNfsePdf(arquivo, { ocr } = {}) {
  const pdf = await abrirPdf(arquivo);
  const paginas = [];
  const ocrPaginas = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    let linhas = await linhasDaPagina(pdf, n);
    if (!linhas.length && ocr) {
      linhas = await ocr(pdf, n);
      ocrPaginas[n - 1] = true;
    }
    paginas.push(linhas);
  }
  const ignoradas = [];
  const notas = lerPaginas(paginas, { ocrPaginas, ignoradas });
  return { totalPaginas: pdf.numPages, notas, ignoradas };
}
