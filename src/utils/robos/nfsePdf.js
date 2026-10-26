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

// Valor liquido -> codigo de imposto; municipios -> CFOP (regras do lancamento de NFS-e).
function aplicarRegrasLancamento(dados) {
  if (!(dados.valorLiquido > 0)) dados.valorLiquido = dados.valor;
  dados.codImp = dados.valor > 0 && dados.valorLiquido < dados.valor - 0.005 ? 'IN' : 'IQ';
  dados.cfop = dados.municipioPrestador && dados.municipioTomador
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
  if (mun) dados.municipioPrestador = chaveMunicipio(`${mun[1]}${mun[2]}`);

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
      if (m2 && !dados.municipioTomador) dados.municipioTomador = chaveMunicipio(`${m2[1]}${m2[2]}`);
    }
  }
  const todo = L.join('\n');
  const bruto = todo.match(/FRETE TOTAL \(R\$\)\s*(?:¦\s*)?([\d.]+,\d{2})/i);
  const liquido = todo.match(/VALOR A RECEBER \(R\$\)\s*(?:¦\s*)?([\d.]+,\d{2})/i);
  if (bruto) dados.valor = paraNumero(bruto[1]);
  if (liquido) dados.valorLiquido = paraNumero(liquido[1]);
  aplicarRegrasLancamento(dados);
  return resultado(dados);
}

// linhas: saida de itensParaLinhas (ou o texto do PDF dividido por linha).
export function extrairDadosNfse(linhas = []) {
  const L = linhas.map((l) => String(l ?? ''));
  const U = L.map((l) => semAcento(l).toUpperCase());
  if (U.some((l) => l.includes('RECIBO PROVISORIO DE SERVICOS'))) return extrairModeloRps(L, U);
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
  const d = todo.match(/(\d{2})\/(\d{2})\/(\d{4})\s+\d{2}:\d{2}(?::\d{2})?/);
  if (d) dados.dataEmissao = `${d[3]}-${d[2]}-${d[1]}`;

  // prestador (nome e, se faltar a chave, o CNPJ) e tomador (CNPJ)
  const iPrest = U.findIndex((l) => l.includes('PRESTADOR / FORNECEDOR') || /^PRESTADOR DE SERVICO/.test(l.trim()));
  const iTom = U.findIndex((l) => l.includes('TOMADOR / ADQUIRENTE') || /^TOMADOR DE SERVICO/.test(l.trim()));
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
  if (iNomePrest >= 0 && L[iNomePrest + 1]) dados.transportadora = L[iNomePrest + 1].split(SEP)[0].trim();

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
      const alinhado = celulasVal.length === celulasRot.length ? nums(celulasVal[idx]) : [];
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
  aplicarRegrasLancamento(dados);
  return resultado(dados);
}

// Le o PDF no navegador (pdfjs) e devolve as linhas de texto da primeira pagina.
export async function linhasDoPdf(arquivo) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  const dados = new Uint8Array(await arquivo.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: dados }).promise;
  const pagina = await pdf.getPage(1);
  const conteudo = await pagina.getTextContent();
  return itensParaLinhas(conteudo.items);
}

export async function lerNfsePdf(arquivo) {
  const linhas = await linhasDoPdf(arquivo);
  return extrairDadosNfse(linhas);
}
