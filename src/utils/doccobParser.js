// Parser do arquivo DOCCOB (EDI Proceda COBRA, posicional, 170 colunas).
// Registros: 000 interchange | 350 cabecalho | 351 transportadora (emissora da
// fatura) | 352 fatura | 353 CT-e da fatura | 354 NF do CT-e | 355 total.
// Um arquivo pode ter varias faturas (cada 350..355 e um bloco).

const num = (s) => Number(String(s || '').replace(/\D/g, '') || 0);
const dinheiro = (s) => num(s) / 100;
const so14 = (s) => String(s || '').replace(/\D/g, '');

function dataDdmmaaaa(s) {
  const t = String(s || '').replace(/\D/g, '');
  if (t.length !== 8 || t === '00000000') return null;
  const iso = `${t.slice(4, 8)}-${t.slice(2, 4)}-${t.slice(0, 2)}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function semZeros(s) {
  const t = String(s || '').trim().replace(/^0+(?=.)/, '');
  return t;
}

export function parseDoccobTexto(texto, nomeArquivo = '') {
  const linhas = String(texto || '').split(/\r?\n/);
  const faturas = [];
  let remetente = '';
  let tomadorNome = '';
  let transp = null;
  let atual = null;
  let ultimoCte = null;

  for (const linha of linhas) {
    const tipo = linha.slice(0, 3);
    if (tipo === '000') {
      remetente = linha.slice(3, 38).trim();
      tomadorNome = linha.slice(38, 73).trim();
    } else if (tipo === '351') {
      transp = { cnpj: so14(linha.slice(3, 17)), nome: linha.slice(17, 57).trim() };
    } else if (tipo === '352') {
      atual = {
        transportadora: transp?.nome || remetente,
        cnpj_transportadora: transp?.cnpj || '',
        serie_fatura: linha.slice(13, 17).trim(),
        numero_fatura: semZeros(linha.slice(17, 27)),
        data_emissao: dataDdmmaaaa(linha.slice(27, 35)),
        data_vencimento: dataDdmmaaaa(linha.slice(35, 43)),
        valor_fatura: dinheiro(linha.slice(43, 58)),
        tipo_cobranca: linha.slice(58, 61).trim(),
        valor_icms: dinheiro(linha.slice(61, 76)),
        banco: (linha.match(/BANCO[^0-9]*?(?=\s{2,}|\d)/) || [''])[0].trim(),
        nome_tomador: tomadorNome,
        arquivo: nomeArquivo,
        ctes: [],
      };
      faturas.push(atual);
      ultimoCte = null;
    } else if (tipo === '353' && atual) {
      ultimoCte = {
        serie_cte: linha.slice(13, 18).trim(),
        numero_cte: semZeros(linha.slice(18, 30)),
        valor_frete: dinheiro(linha.slice(30, 45)),
        data_emissao: dataDdmmaaaa(linha.slice(45, 53)),
        cnpj_tomador: so14(linha.slice(53, 67)),
        cnpj_emissor: so14(linha.slice(81, 95)) || atual.cnpj_transportadora,
        notas: [],
      };
      atual.ctes.push(ultimoCte);
    } else if (tipo === '354' && ultimoCte) {
      ultimoCte.notas.push({
        serie: linha.slice(3, 6).trim(),
        numero: semZeros(linha.slice(6, 14)),
        data: dataDdmmaaaa(linha.slice(14, 22)),
        peso: dinheiro(linha.slice(22, 29)),
        valor: dinheiro(linha.slice(29, 44)),
      });
    }
  }

  for (const f of faturas) {
    f.cnpj_tomador = f.ctes.find((c) => /[1-9]/.test(c.cnpj_tomador))?.cnpj_tomador || '';
    f.soma_ctes = Math.round(f.ctes.reduce((s, c) => s + c.valor_frete, 0) * 100) / 100;
  }
  return faturas;
}

// Junta varias faturas (varios arquivos/zip) e elimina repeticoes: o mesmo
// arquivo costuma vir duplicado ("arquivo[1].txt"). Mantem a ocorrencia com mais CT-es.
export function consolidarFaturasDoccob(listas = []) {
  const mapa = new Map();
  let repetidas = 0;
  for (const f of listas.flat()) {
    if (!f.numero_fatura || !f.cnpj_transportadora) continue;
    const chave = `${f.cnpj_transportadora}::${f.numero_fatura}::${f.serie_fatura}`;
    const existente = mapa.get(chave);
    if (existente) {
      repetidas += 1;
      if (f.ctes.length > existente.ctes.length) mapa.set(chave, f);
    } else {
      mapa.set(chave, f);
    }
  }
  return { faturas: [...mapa.values()], repetidas };
}

export function decodificarTextoDoccob(bytes) {
  try {
    return new TextDecoder('windows-1252').decode(bytes);
  } catch {
    return new TextDecoder('latin1').decode(bytes);
  }
}
