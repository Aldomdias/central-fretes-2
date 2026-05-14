/**
 * importadorTemplatesCantu.js
 *
 * Importa templates enviados por transportadoras (formato Cantu):
 *   - B2B Percentual
 *   - B2B Faixa de Peso
 *   - B2C Percentual
 *   - B2C Faixa de Peso
 *
 * E também o modelo de Lotação:
 *   - MODELO TRANSPORTADORA (aba)
 */

import * as XLSX from 'xlsx';

// ─── helpers ──────────────────────────────────────────────────────────────────

function txt(v) {
  return String(v ?? '').trim();
}

function norm(v) {
  return txt(v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v)
    .replace(/R\$/gi, '')
    .replace(/%/g, '')
    .trim();
  const temVirgula = s.includes(',');
  let prep = s.replace(/\s/g, '');
  if (temVirgula) prep = prep.replace(/\./g, '').replace(',', '.');
  const n = Number(prep);
  return Number.isFinite(n) ? n : null;
}

function numOrZero(v) {
  return num(v) ?? 0;
}

const REGIOES_RECONHECIDAS = [
  'CAPITAL',
  'INTERIOR 1',
  'INTERIOR 2',
  'INTERIOR 3',
  'INTERIOR 4',
  'INTERIOR 5',
  'INTERIOR 6',
  'INTERIOR 7',
  'INTERIOR 8',
  'INTERIOR 9',
  'METROPOLITANA',
];

const UF_LISTA = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA',
  'MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN',
  'RO','RR','RS','SC','SE','SP','TO',
];

function isUF(v) {
  return UF_LISTA.includes(norm(v));
}

function detectarRegiao(v) {
  const n = norm(v);
  for (const r of REGIOES_RECONHECIDAS) {
    if (n === norm(r)) return r;
    // aceita variações: "INTERIOR-1", "INTERIOR_1", "INTERIOR1"
    const semEspaco = r.replace(' ', '');
    if (n.replace(/[-_\s]/g, '') === semEspaco) return r;
  }
  return null;
}

function lerArquivo(arquivo) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'binary', cellDates: true });
        resolve(wb);
      } catch (err) {
        reject(new Error('Não foi possível abrir o arquivo: ' + err.message));
      }
    };
    reader.onerror = () => reject(new Error('Erro ao ler o arquivo.'));
    reader.readAsBinaryString(arquivo);
  });
}

function encontrarAba(wb, nomes) {
  for (const nome of nomes) {
    const found = wb.SheetNames.find((s) => norm(s) === norm(nome));
    if (found) return wb.Sheets[found];
  }
  // tentativa flexível: procura substring
  for (const nome of nomes) {
    const found = wb.SheetNames.find((s) => norm(s).includes(norm(nome)));
    if (found) return wb.Sheets[found];
  }
  return null;
}

function sheetParaMatrix(ws) {
  // retorna array de arrays (linhas x colunas)
  const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  return json;
}

function lerFichaCadastro(ws) {
  if (!ws) return {};
  const rows = sheetParaMatrix(ws);
  const ficha = {};
  for (const row of rows) {
    const chave = norm(row[0] || '');
    const valor = txt(row[1] || row[2] || '');
    if (!chave || !valor) continue;
    if (chave.includes('TRANSPORTADORA') || chave.includes('EMPRESA') || chave.includes('RAZAO')) {
      if (!ficha.transportadora) ficha.transportadora = valor;
    }
    if (chave.includes('CNPJ')) ficha.cnpj = valor;
    if (chave.includes('CANAL')) ficha.canal = valor.toUpperCase();
    if (chave.includes('PRAZO')) ficha.prazo = num(valor);
    if (chave.includes('GRIS') || chave.includes('GRISS')) ficha.gris = num(valor);
    if (chave.includes('ADVALOR') || chave.includes('AD VALOR') || chave.includes('ADV')) ficha.advalorem = num(valor);
    if (chave.includes('PEDAGIO') || chave.includes('PEDÁGIO')) ficha.pedagio = num(valor);
    if (chave.includes('TAS')) ficha.tas = num(valor);
    if (chave.includes('TDA')) ficha.tda = num(valor);
  }
  return ficha;
}

// ─── CANTU PERCENTUAL ─────────────────────────────────────────────────────────
/**
 * Estrutura esperada na aba TABELA (percentual):
 *
 *  Linha de cabeçalho com estados (podem ser UFs ou nomes):
 *    [vazio] | SP | SP | RJ | RJ | MG | MG | ...
 *  Sub-cabeçalho:
 *    [vazio] | Frete % | Mín | Frete % | Mín | Frete % | Mín | ...
 *  Linhas de dados:
 *    CAPITAL   | 0.50 | 45.00 | 0.55 | 50.00 | ...
 *    INTERIOR 1| 0.70 | 55.00 | ...
 *    ...
 */
function parseCantUPercentual(matrix, ficha, canal, origem) {
  const itens = [];

  // 1. Encontrar linha de cabeçalho com UFs
  let cabecalhoIdx = -1;
  let ufCols = []; // { colIdx, uf, colFrete, colMinimo }

  for (let i = 0; i < Math.min(matrix.length, 20); i++) {
    const row = matrix[i];
    const ufsNaLinha = row.filter((cell) => cell && (isUF(cell) || norm(cell).length === 2));
    if (ufsNaLinha.length >= 2) {
      cabecalhoIdx = i;
      break;
    }
    // tenta por nome de estado
    const estadosNaLinha = row.filter((cell) => {
      if (!cell) return false;
      const n = norm(cell);
      return n.length > 2 && n.length < 30 && !n.includes('TRANSPORTADORA') && !n.includes('FRETE');
    });
    if (estadosNaLinha.length >= 5) {
      cabecalhoIdx = i;
      break;
    }
  }

  if (cabecalhoIdx < 0) {
    throw new Error('Não foi possível identificar a linha de estados/UF na aba TABELA. Verifique se o modelo está correto.');
  }

  const cabRow = matrix[cabecalhoIdx];

  // Mapear colunas: para cada UF, espera-se par (%, mínimo)
  let currentUF = null;
  let currentCol = null;
  for (let c = 1; c < cabRow.length; c++) {
    const cell = txt(cabRow[c]);
    if (!cell) continue;
    if (isUF(cell) || norm(cell).length === 2) {
      currentUF = norm(cell);
      currentCol = c;
    } else if (currentUF) {
      // primeira coluna após UF: % frete
      // segunda coluna após UF: mínimo
    }
  }

  // Estratégia simplificada: encontrar pares de colunas por posição
  // Detectar sub-cabeçalho (linha logo abaixo do cabeçalho de UFs)
  let subCabIdx = cabecalhoIdx + 1;
  const subCab = matrix[subCabIdx] || [];

  // Mapear cada UF às suas colunas de frete% e mínimo
  const mapeamentoColunas = [];
  let i = 1;
  while (i < cabRow.length) {
    const ufCell = txt(cabRow[i]);
    if (!ufCell) { i++; continue; }

    // Encontrar quantas colunas pertencem a esta UF (até a próxima UF)
    let j = i + 1;
    while (j < cabRow.length && !txt(cabRow[j])) j++;

    // Colunas i até j-1 pertencem à UF
    const colsUF = [];
    for (let k = i; k < j; k++) colsUF.push(k);

    // detectar qual coluna é % e qual é mínimo pelo sub-cabeçalho
    let colPerc = colsUF[0];
    let colMin = colsUF[1] !== undefined ? colsUF[1] : null;

    for (const c of colsUF) {
      const sub = norm(subCab[c] || '');
      if (sub.includes('MIN') || sub.includes('MÍN') || sub.includes('MINIMO')) colMin = c;
      if (sub.includes('%') || sub.includes('PERC') || sub.includes('FRETE')) colPerc = c;
    }

    mapeamentoColunas.push({ uf: norm(ufCell), colPerc, colMin });
    i = j;
  }

  if (!mapeamentoColunas.length) {
    throw new Error('Não foram encontrados estados/UF na tabela. Verifique o formato do arquivo.');
  }

  // 2. Ler linhas de dados (abaixo do sub-cabeçalho)
  const dataStart = subCabIdx + 1;

  for (let row = dataStart; row < matrix.length; row++) {
    const linha = matrix[row];
    if (!linha || !linha[0]) continue;

    const regiao = detectarRegiao(linha[0]);
    if (!regiao) continue; // linha não reconhecida

    for (const { uf, colPerc, colMin } of mapeamentoColunas) {
      const percRaw = colPerc !== null ? linha[colPerc] : null;
      const minRaw = colMin !== null ? linha[colMin] : null;

      const frete_percentual = num(percRaw);
      const frete_minimo = num(minRaw);

      if (frete_percentual === null && frete_minimo === null) continue;

      itens.push({
        cidade_origem: origem || '',
        uf_origem: '',
        ibge_origem: '',
        cidade_destino: '',
        uf_destino: uf,
        ibge_destino: '',
        faixa_peso: regiao,
        peso_inicial: 0,
        peso_final: 999999,
        frete_minimo: frete_minimo ?? 0,
        taxa_aplicada: 0,
        frete_percentual: frete_percentual ?? 0,
        excesso_kg: 0,
        valor_excedente: 0,
        prazo: numOrZero(ficha.prazo),
        gris: numOrZero(ficha.gris),
        advalorem: numOrZero(ficha.advalorem),
        pedagio: numOrZero(ficha.pedagio),
        tas: numOrZero(ficha.tas),
        tda: numOrZero(ficha.tda),
        observacao: `${regiao} → ${uf}`,
        dados_originais: {
          regiao,
          uf_destino: uf,
          frete_percentual: percRaw,
          frete_minimo: minRaw,
          canal,
          tipo: 'PERCENTUAL',
        },
      });
    }
  }

  if (!itens.length) {
    throw new Error('Nenhum item foi extraído da tabela. Verifique se o arquivo está no formato correto.');
  }

  return itens;
}

// ─── CANTU FAIXA DE PESO ──────────────────────────────────────────────────────
/**
 * Estrutura esperada na aba TABELA (faixa de peso):
 *
 *  Linha de cabeçalho com UFs:
 *    [vazio]    | SP  | SP  | SP  | RJ  | RJ  | RJ  | ...
 *  Sub-cabeçalho:
 *    FAIXA PESO | CAPITAL | CAPITAL | INT1 | CAPITAL | CAPITAL | INT1 | ...
 *    (ou)
 *    [vazio]    | Frete | ADV | ADV mín | Frete | ADV | ADV mín | ...
 *  Linhas de dados:
 *    0-10       | 8.50 | 0.20% | 5.00 | 9.00 | 0.25% | 6.00 | ...
 *    10-20      | ...
 *
 * OU (estrutura alternativa com regiões em coluna A):
 *
 *    [vazio]   | UF1 | UF1 | UF2 | UF2 | ...
 *    Faixa     | Cot | Mín | Cot | Mín | ...
 *    CAPITAL   |
 *    0-10      | 8.50 | 45 | ...
 *    10-20     | ...
 *    INTERIOR 1|
 *    0-10      | ...
 */
function parseCantUFaixaPeso(matrix, ficha, canal, origem) {
  const itens = [];

  // Encontrar linha de cabeçalho com UFs
  let cabecalhoIdx = -1;
  for (let i = 0; i < Math.min(matrix.length, 20); i++) {
    const row = matrix[i];
    const ufs = row.filter((c) => c && isUF(c));
    if (ufs.length >= 2) { cabecalhoIdx = i; break; }
  }

  if (cabecalhoIdx < 0) {
    throw new Error('Não foi possível identificar a linha de UFs na aba TABELA (faixa de peso).');
  }

  const cabRow = matrix[cabecalhoIdx];

  // Mapear UFs às colunas
  // Cada UF pode ter múltiplas regiões (CAPITAL, INTERIOR 1...) como sub-colunas
  // Ou cada UF tem pares (frete, mínimo) com regiões em linhas

  // Estratégia: detectar se há linha de regiões logo abaixo
  const sub1 = matrix[cabecalhoIdx + 1] || [];
  const sub2 = matrix[cabecalhoIdx + 2] || [];

  const temRegiaoEmColuna = sub1.some((c) => c && detectarRegiao(c));
  const temFaixaEmColuna = !temRegiaoEmColuna;

  if (temRegiaoEmColuna) {
    // Estrutura: UF no cabeçalho, REGIAO em sub-cabeçalho, FAIXA em coluna A
    return parseFaixaComRegiaoEmColuna(matrix, cabecalhoIdx, ficha, canal, origem);
  } else {
    // Estrutura: UF no cabeçalho, FAIXA em coluna A, REGIAO em coluna A alternada
    return parseFaixaComRegiaoEmLinha(matrix, cabecalhoIdx, ficha, canal, origem);
  }
}

function parseFaixaComRegiaoEmColuna(matrix, cabIdx, ficha, canal, origem) {
  const itens = [];
  const cabRow = matrix[cabIdx];
  const subRow = matrix[cabIdx + 1] || [];

  // Mapear: coluna → { uf, regiao }
  const colMap = [];
  let currentUF = null;
  for (let c = 1; c < cabRow.length; c++) {
    if (cabRow[c]) currentUF = norm(cabRow[c]);
    const regiao = detectarRegiao(subRow[c] || '');
    if (currentUF && regiao) {
      colMap.push({ col: c, uf: currentUF, regiao });
    }
  }

  // Detectar início dos dados
  let dataStart = cabIdx + 2;
  // pular mais sub-cabeçalhos (ex: "Frete | ADV | Mín")
  for (let r = dataStart; r < Math.min(dataStart + 3, matrix.length); r++) {
    const row = matrix[r];
    if (row && row[0] && !detectarFaixaPeso(row[0]) && !isUF(row[0])) dataStart = r + 1;
    else break;
  }

  for (let r = dataStart; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row || !row[0]) continue;
    const faixa = detectarFaixaPeso(row[0]);
    if (!faixa) continue;

    for (const { col, uf, regiao } of colMap) {
      const valor = num(row[col]);
      if (valor === null) continue;

      itens.push({
        cidade_origem: origem || '',
        uf_origem: '',
        ibge_origem: '',
        cidade_destino: '',
        uf_destino: uf,
        ibge_destino: '',
        faixa_peso: `${regiao} | ${faixa.label}`,
        peso_inicial: faixa.min,
        peso_final: faixa.max,
        frete_minimo: 0,
        taxa_aplicada: valor,
        frete_percentual: 0,
        excesso_kg: faixa.max >= 999998 ? faixa.min : 0,
        valor_excedente: 0,
        prazo: numOrZero(ficha.prazo),
        gris: numOrZero(ficha.gris),
        advalorem: numOrZero(ficha.advalorem),
        pedagio: numOrZero(ficha.pedagio),
        tas: numOrZero(ficha.tas),
        tda: numOrZero(ficha.tda),
        observacao: `${regiao} → ${uf} | ${faixa.label}`,
        dados_originais: { regiao, uf_destino: uf, faixa: faixa.label, valor: row[col], canal, tipo: 'FAIXA_DE_PESO' },
      });
    }
  }

  if (!itens.length) throw new Error('Nenhum item extraído (faixa de peso com região em coluna).');
  return itens;
}

function parseFaixaComRegiaoEmLinha(matrix, cabIdx, ficha, canal, origem) {
  const itens = [];
  const cabRow = matrix[cabIdx];

  // Mapear UFs às colunas (podem ter pares de colunas)
  const ufCols = [];
  let currentUF = null;
  let currentCol = null;
  for (let c = 1; c < cabRow.length; c++) {
    const cell = cabRow[c];
    if (cell && (isUF(cell) || norm(cell).length === 2)) {
      currentUF = norm(cell);
      currentCol = c;
      ufCols.push({ uf: currentUF, colFrete: c, colMin: null });
    } else if (currentUF && !cell) {
      // coluna de mínimo/adv logo após
      if (ufCols.length > 0 && ufCols[ufCols.length - 1].colMin === null) {
        ufCols[ufCols.length - 1].colMin = c;
      }
    }
  }

  let regiaoAtual = null;
  let dataStart = cabIdx + 1;

  for (let r = dataStart; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row) continue;

    const primeiraCol = row[0];
    if (!primeiraCol) continue;

    const regiao = detectarRegiao(primeiraCol);
    if (regiao) { regiaoAtual = regiao; continue; }

    const faixa = detectarFaixaPeso(primeiraCol);
    if (!faixa) continue;
    if (!regiaoAtual) continue;

    for (const { uf, colFrete, colMin } of ufCols) {
      const valorFrete = num(row[colFrete]);
      const valorMin = colMin !== null ? num(row[colMin]) : null;
      if (valorFrete === null && valorMin === null) continue;

      itens.push({
        cidade_origem: origem || '',
        uf_origem: '',
        ibge_origem: '',
        cidade_destino: '',
        uf_destino: uf,
        ibge_destino: '',
        faixa_peso: `${regiaoAtual} | ${faixa.label}`,
        peso_inicial: faixa.min,
        peso_final: faixa.max,
        frete_minimo: valorMin ?? 0,
        taxa_aplicada: valorFrete ?? 0,
        frete_percentual: 0,
        excesso_kg: faixa.max >= 999998 ? faixa.min : 0,
        valor_excedente: 0,
        prazo: numOrZero(ficha.prazo),
        gris: numOrZero(ficha.gris),
        advalorem: numOrZero(ficha.advalorem),
        pedagio: numOrZero(ficha.pedagio),
        tas: numOrZero(ficha.tas),
        tda: numOrZero(ficha.tda),
        observacao: `${regiaoAtual} → ${uf} | ${faixa.label}`,
        dados_originais: { regiao: regiaoAtual, uf_destino: uf, faixa: faixa.label, valor: row[colFrete], valorMin: row[colMin], canal, tipo: 'FAIXA_DE_PESO' },
      });
    }
  }

  if (!itens.length) throw new Error('Nenhum item extraído (faixa de peso com região em linha).');
  return itens;
}

function detectarFaixaPeso(v) {
  if (!v) return null;
  const s = String(v).trim();

  // "acima de X" ou ">X"
  const acima = s.match(/(?:acima\s+de|maior\s+que|>\s*)\s*([\d.,]+)/i);
  if (acima) {
    const min = num(acima[1]) ?? 0;
    return { label: s, min, max: 999999 };
  }

  // "X a Y" ou "X-Y" ou "X até Y"
  const faixa = s.match(/([\d.,]+)\s*(?:kg)?\s*(?:a|ate|até|-|\/)\s*([\d.,]+)\s*(?:kg)?/i);
  if (faixa) {
    const min = num(faixa[1]) ?? 0;
    const max = num(faixa[2]) ?? 0;
    return { label: s, min, max };
  }

  // número isolado (pode ser peso máximo da faixa)
  const somenteNum = s.match(/^([\d.,]+)\s*(?:kg)?$/i);
  if (somenteNum) {
    const val = num(somenteNum[1]) ?? 0;
    return { label: s, min: 0, max: val };
  }

  return null;
}

// ─── LOTAÇÃO ──────────────────────────────────────────────────────────────────
/**
 * Aba: MODELO TRANSPORTADORA
 * Colunas: Transportadora | Origem | UF ORIGEM | Destino | UF DESTINO | KM | TIPO | TARGET | ICMS | Pedágio
 */
function parseLotacao(matrix, ficha) {
  const itens = [];

  if (!matrix.length) throw new Error('Planilha de lotação vazia.');

  // Encontrar linha de cabeçalho
  let cabIdx = -1;
  const chavesCab = ['ORIGEM', 'DESTINO', 'KM', 'TARGET', 'TIPO'];
  for (let i = 0; i < Math.min(matrix.length, 10); i++) {
    const row = matrix[i];
    if (!row) continue;
    const normRow = row.map((c) => norm(c || ''));
    const matches = chavesCab.filter((k) => normRow.some((c) => c.includes(k)));
    if (matches.length >= 3) { cabIdx = i; break; }
  }

  if (cabIdx < 0) {
    throw new Error('Cabeçalho não encontrado. Esperado: Origem, Destino, KM, TARGET, TIPO.');
  }

  const cabRow = matrix[cabIdx].map((c) => norm(c || ''));

  function findCol(chaves) {
    for (const chave of chaves) {
      const idx = cabRow.findIndex((c) => c.includes(chave));
      if (idx >= 0) return idx;
    }
    return -1;
  }

  const colTransportadora = findCol(['TRANSPORTADORA', 'EMPRESA']);
  const colOrigem = findCol(['ORIGEM', 'CIDADE ORIGEM']);
  const colUFOrigem = findCol(['UF ORIGEM', 'UF_ORIGEM', 'UFORIGEM']);
  const colDestino = findCol(['DESTINO', 'CIDADE DESTINO']);
  const colUFDestino = findCol(['UF DESTINO', 'UF_DESTINO', 'UFDESTINO']);
  const colKM = findCol(['KM', 'QUILOMETRO', 'QUILÔMETRO', 'DISTANCIA']);
  const colTipo = findCol(['TIPO', 'TIPO_VEICULO', 'VEICULO', 'VEÍCULO']);
  const colTarget = findCol(['TARGET', 'VALOR', 'PRECO', 'PREÇO', 'FRETE']);
  const colICMS = findCol(['ICMS']);
  const colPedagio = findCol(['PEDAGIO', 'PEDÁGIO', 'PEDÁG']);
  const colPrazo = findCol(['PRAZO']);

  for (let r = cabIdx + 1; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row) continue;

    const origem = txt(colOrigem >= 0 ? row[colOrigem] : '');
    const destino = txt(colDestino >= 0 ? row[colDestino] : '');
    if (!origem && !destino) continue;

    const uf_origem = norm(colUFOrigem >= 0 ? (row[colUFOrigem] || '') : '');
    const uf_destino = norm(colUFDestino >= 0 ? (row[colUFDestino] || '') : '');
    const km = num(colKM >= 0 ? row[colKM] : null) ?? 0;
    const tipo_veiculo = txt(colTipo >= 0 ? row[colTipo] : '');
    const valor_lotacao = num(colTarget >= 0 ? row[colTarget] : null) ?? 0;
    const icms = num(colICMS >= 0 ? row[colICMS] : null) ?? numOrZero(ficha.icms);
    const pedagio = num(colPedagio >= 0 ? row[colPedagio] : null) ?? numOrZero(ficha.pedagio);
    const prazo = num(colPrazo >= 0 ? row[colPrazo] : null) ?? numOrZero(ficha.prazo);
    const transportadora = txt(colTransportadora >= 0 ? row[colTransportadora] : (ficha.transportadora || ''));

    itens.push({
      cidade_origem: origem,
      uf_origem,
      ibge_origem: '',
      cidade_destino: destino,
      uf_destino,
      ibge_destino: '',
      faixa_peso: tipo_veiculo || 'LOTACAO',
      peso_inicial: 0,
      peso_final: 0,
      frete_minimo: 0,
      taxa_aplicada: valor_lotacao,
      frete_percentual: 0,
      excesso_kg: 0,
      valor_excedente: 0,
      km,
      icms,
      pedagio,
      prazo: Number.isFinite(prazo) ? Math.round(prazo) : 0,
      tipo_veiculo,
      valor_lotacao,
      gris: 0,
      advalorem: 0,
      tas: 0,
      tda: 0,
      tde: 0,
      outras_taxas: 0,
      observacao: `${origem}/${uf_origem} → ${destino}/${uf_destino} | ${tipo_veiculo}`,
      dados_originais: {
        transportadora,
        origem,
        uf_origem,
        destino,
        uf_destino,
        km,
        tipo_veiculo,
        target: valor_lotacao,
        icms,
        pedagio,
        tipo: 'LOTACAO',
      },
    });
  }

  if (!itens.length) {
    throw new Error('Nenhum item de lotação extraído. Verifique se o arquivo está no formato correto.');
  }

  return itens;
}

// ─── API PÚBLICA ──────────────────────────────────────────────────────────────

/**
 * Importa template Cantu (B2B ou B2C, Percentual ou Faixa de Peso).
 *
 * @param {File} arquivo - arquivo xlsx enviado pelo usuário
 * @param {'B2B_PERCENTUAL'|'B2B_FAIXA_PESO'|'B2C_PERCENTUAL'|'B2C_FAIXA_PESO'} subtipo
 * @param {string} origem - cidade de origem (opcional, vem da tabela de negociação)
 * @returns {{ itens: Array, ficha: Object, meta: Object }}
 */
export async function importarTemplateCantu(arquivo, subtipo, origem = '') {
  if (!arquivo) throw new Error('Selecione o arquivo do template Cantu.');

  const wb = await lerArquivo(arquivo);
  const abas = wb.SheetNames;

  // Ler ficha de cadastro (metadados)
  const wsFicha = encontrarAba(wb, ['FICHA DE CADASTRO', 'FICHA', 'CADASTRO', 'DADOS']);
  const ficha = lerFichaCadastro(wsFicha);

  // Ler aba de tabela
  const wsTabela = encontrarAba(wb, ['TABELA', 'TABLE', 'FRETES', 'FRETE']);
  if (!wsTabela) {
    throw new Error(`Aba "TABELA" não encontrada. Abas disponíveis: ${abas.join(', ')}`);
  }

  const matrix = sheetParaMatrix(wsTabela);
  const isPercentual = subtipo.includes('PERCENTUAL');
  const canal = subtipo.startsWith('B2B') ? 'ATACADO' : 'B2C';

  let itens;
  if (isPercentual) {
    itens = parseCantUPercentual(matrix, ficha, canal, origem);
  } else {
    itens = parseCantUFaixaPeso(matrix, ficha, canal, origem);
  }

  // adicionar canal e tipo a todos os itens
  itens = itens.map((item) => ({
    ...item,
    canal,
    tipo_tabela: 'FRACIONADO',
    origem_importacao: 'CANTU_MODELO_UNICO',
    dados_originais: {
      ...item.dados_originais,
      subtipo,
      canal,
      abas_encontradas: abas,
    },
  }));

  const meta = {
    transportadora: ficha.transportadora || '',
    canal,
    subtipo,
    totalItens: itens.length,
    abasEncontradas: abas,
    fichaLida: Object.keys(ficha).length > 0,
  };

  return { itens, ficha, meta };
}

/**
 * Importa modelo de Lotação (MODELO TRANSPORTADORA).
 *
 * @param {File} arquivo - arquivo xlsx enviado
 * @param {string} origem - cidade de origem (opcional)
 * @returns {{ itens: Array, ficha: Object, meta: Object }}
 */
export async function importarModeloLotacao(arquivo, origem = '') {
  if (!arquivo) throw new Error('Selecione o arquivo do modelo de Lotação.');

  const wb = await lerArquivo(arquivo);
  const abas = wb.SheetNames;

  // Ficha de cadastro (opcional)
  const wsFicha = encontrarAba(wb, ['FICHA DE CADASTRO', 'FICHA', 'CADASTRO']);
  const ficha = lerFichaCadastro(wsFicha);

  // Aba de lotação
  const wsLotacao = encontrarAba(wb, [
    'MODELO TRANSPORTADORA',
    'MODELO',
    'LOTACAO',
    'LOTAÇÃO',
    'TABELA',
  ]);
  if (!wsLotacao) {
    throw new Error(`Aba de lotação não encontrada. Abas disponíveis: ${abas.join(', ')}`);
  }

  const matrix = sheetParaMatrix(wsLotacao);
  let itens = parseLotacao(matrix, ficha);

  itens = itens.map((item) => ({
    ...item,
    tipo_tabela: 'LOTACAO',
    canal: 'LOTACAO',
    origem_importacao: 'LOTACAO_TRANSPORTADORA',
    dados_originais: {
      ...item.dados_originais,
      abas_encontradas: abas,
    },
  }));

  const meta = {
    transportadora: ficha.transportadora || '',
    canal: 'LOTACAO',
    tipo: 'LOTACAO',
    totalItens: itens.length,
    abasEncontradas: abas,
  };

  return { itens, ficha, meta };
}

/**
 * Gera template XLSX para download do modelo de Lotação.
 */
export function baixarModeloLotacao() {
  const cabecalho = [
    'Transportadora', 'Origem', 'UF ORIGEM', 'Destino', 'UF DESTINO',
    'KM', 'TIPO', 'TARGET', 'ICMS', 'Pedágio', 'PRAZO',
  ];
  const exemplo = [
    'TRANSPORTADORA XYZ', 'Itajaí', 'SC', 'São Paulo', 'SP',
    720, 'TRUCK', 1850.00, 12, 0, 3,
  ];

  const ws = XLSX.utils.aoa_to_sheet([cabecalho, exemplo]);

  // Estilo mínimo
  const range = XLSX.utils.decode_range(ws['!ref']);
  ws['!cols'] = cabecalho.map(() => ({ wch: 20 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'MODELO TRANSPORTADORA');
  XLSX.writeFile(wb, 'modelo_lotacao_transportadora.xlsx');
}
