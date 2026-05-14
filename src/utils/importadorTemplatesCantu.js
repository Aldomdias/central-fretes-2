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
/**
 * parseCantUPercentual — Estrutura real do template B2B/B2C Percentual:
 *
 * Linha 1: [vazio, 'CAPITAL', vazio, 'INTERIOR 1', vazio, 'INTERIOR 2', ...]
 *           → regiões nas colunas 1, 3, 5... (cells mescladas, a próxima é vazia)
 * Linha 2: ['ESTADO DESTINO', 'FRETE (%)', 'MÍNIMO (R$)', 'FRETE (%)', 'MÍNIMO (R$)', ...]
 *           → sub-cabeçalho: cada região tem par (%, mínimo)
 * Linha 3: vazia (separador)
 * Linha 4+: [UF, %_capital, min_capital, %_int1, min_int1, %_int2, min_int2, ...]
 *            → LINHA = UF destino, COLUNAS = regiões
 */
function parseCantUPercentual(matrix, ficha, canal, origem) {
  const itens = [];

  // ── 1. Localizar a linha de regiões (CAPITAL, INTERIOR 1...) ──────────────
  // Procuramos a linha que contém pelo menos "CAPITAL"
  let regiaoRowIdx = -1;
  let subCabRowIdx = -1;

  for (let i = 0; i < Math.min(matrix.length, 15); i++) {
    const row = matrix[i] || [];
    const temCapital = row.some((c) => c && norm(c).includes('CAPITAL'));
    const temInterior = row.some((c) => c && norm(c).includes('INTERIOR'));

    if (temCapital || temInterior) {
      regiaoRowIdx = i;
      // Sub-cabeçalho é a linha seguinte
      subCabRowIdx = i + 1;
      break;
    }
  }

  if (regiaoRowIdx < 0) {
    throw new Error(
      'Linha de regiões (CAPITAL, INTERIOR 1...) não encontrada na aba TABELA. ' +
      'Verifique se o arquivo é o template B2B/B2C Percentual correto.',
    );
  }

  const regiaoRow = matrix[regiaoRowIdx] || [];
  const subCabRow = matrix[subCabRowIdx] || [];

  // ── 2. Mapear colunas: { regiao, colPerc, colMin } ────────────────────────
  // Cada região ocupa 2 colunas: (FRETE %, MÍNIMO).
  // A linha de regiões tem o nome na primeira coluna do par e null/vazio na segunda
  // (células mescladas no Excel viram: [nome, null]).
  const colMap = []; // [{ regiao, colPerc, colMin }]

  for (let c = 1; c < regiaoRow.length; c++) {
    const cell = regiaoRow[c];
    if (!cell) continue;

    const regiao = detectarRegiao(cell);
    if (!regiao) continue;

    // A coluna c é a primeira do par (FRETE %)
    // A coluna c+1 é a segunda (MÍNIMO)
    // Confirmamos pelo sub-cabeçalho se existir
    let colPerc = c;
    let colMin = c + 1;

    const subC = norm(subCabRow[c] || '');
    const subC1 = norm(subCabRow[c + 1] || '');

    if (subC.includes('MIN') || subC.includes('MÍN')) {
      // invertido: mín vem antes de %
      colMin = c;
      colPerc = c + 1;
    }
    // Se sub-cabeçalho confirma normalmente (% na col c, mín na col c+1), mantém

    colMap.push({ regiao, colPerc, colMin });
  }

  if (!colMap.length) {
    throw new Error(
      'Nenhuma região (CAPITAL, INTERIOR 1...) encontrada no cabeçalho. ' +
      'Verifique se a aba TABELA está no formato correto.',
    );
  }

  // ── 3. Encontrar início dos dados ─────────────────────────────────────────
  // Dados começam na primeira linha após o sub-cabeçalho onde col[0] é uma UF
  let dataStart = subCabRowIdx + 1;

  // ── 4. Ler dados (linha = UF destino) ─────────────────────────────────────
  for (let r = dataStart; r < matrix.length; r++) {
    const row = matrix[r] || [];
    if (!row[0]) continue;

    const uf = norm(row[0]);
    if (!isUF(uf)) continue; // ignora linhas que não são UF

    for (const { regiao, colPerc, colMin } of colMap) {
      const percRaw = colPerc < row.length ? row[colPerc] : null;
      const minRaw  = colMin < row.length  ? row[colMin]  : null;

      // Pular se ambos null ou string '-'
      const percStr = txt(percRaw);
      const minStr  = txt(minRaw);
      if ((!percStr || percStr === '-') && (!minStr || minStr === '-')) continue;

      const frete_percentual = num(percRaw) ?? 0;
      const frete_minimo     = num(minRaw)  ?? 0;

      itens.push({
        cidade_origem:    origem || '',
        uf_origem:        '',
        ibge_origem:      '',
        cidade_destino:   '',
        uf_destino:       uf,
        ibge_destino:     '',
        faixa_peso:       regiao,          // 'CAPITAL', 'INTERIOR 1', etc.
        peso_inicial:     0,
        peso_final:       999999,
        frete_minimo,
        taxa_aplicada:    0,
        frete_percentual,
        excesso_kg:       0,
        valor_excedente:  0,
        prazo:            numOrZero(ficha.prazo),
        gris:             numOrZero(ficha.gris),
        advalorem:        numOrZero(ficha.advalorem),
        pedagio:          numOrZero(ficha.pedagio),
        tas:              numOrZero(ficha.tas),
        tda:              numOrZero(ficha.tda),
        observacao:       `${uf} → ${regiao}`,
        dados_originais: {
          uf_destino:       uf,
          regiao,
          frete_percentual: percRaw,
          frete_minimo:     minRaw,
          canal,
          tipo:             'PERCENTUAL',
        },
      });
    }
  }

  if (!itens.length) {
    throw new Error(
      `Nenhum item extraído. Colunas mapeadas: ${colMap.map((c) => c.regiao).join(', ')}. ` +
      'Verifique se a planilha foi preenchida (valores diferentes de null e "-").',
    );
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

// ─── ATENDIMENTO (roteamento por cidade) ─────────────────────────────────────

/**
 * Lê a aba ATENDIMENTO e retorna mapa de rotas por cidade.
 * Estrutura esperada:
 *   IBGE DESTINO | UF DESTINO | CIDADE DE DESTINO | CEP INICIAL | CEP FINAL
 *   | PRAZO (NÚMERO) | REGIÃO (IGUAL ABA TABELA) | TDA (R$) | TRT (R$)
 *   | SUFRAMA (R$) | OUTRAS TAXAS
 *
 * Retorna array de objetos com os dados por cidade.
 * Inclui linhas COM e SEM região preenchida (a tarifa é buscada depois).
 */
function parseAtendimento(ws) {
  if (!ws) return [];

  const matrix = sheetParaMatrix(ws);
  if (!matrix.length) return [];

  // Encontrar linha de cabeçalho
  let cabIdx = -1;
  for (let i = 0; i < Math.min(matrix.length, 5); i++) {
    const row = matrix[i] || [];
    const temIBGE = row.some((c) => c && norm(c).includes('IBGE'));
    const temUF = row.some((c) => c && norm(c).includes('UF'));
    if (temIBGE && temUF) { cabIdx = i; break; }
  }

  if (cabIdx < 0) return []; // aba sem cabeçalho reconhecível

  const cab = (matrix[cabIdx] || []).map((c) => norm(c || ''));

  function col(chaves) {
    for (const chave of chaves) {
      const idx = cab.findIndex((c) => c.includes(chave));
      if (idx >= 0) return idx;
    }
    return -1;
  }

  const cIBGE    = col(['IBGE']);
  const cUF      = col(['UF DESTINO', 'UF']);
  const cCidade  = col(['CIDADE DE DESTINO', 'CIDADE']);
  const cCepIni  = col(['CEP INICIAL', 'CEP_INI']);
  const cCepFim  = col(['CEP FINAL', 'CEP_FIM']);
  const cPrazo   = col(['PRAZO']);
  const cRegiao  = col(['REGIAO', 'REGIÃO']);
  const cTDA     = col(['TDA']);
  const cTRT     = col(['TRT']);
  const cSuframa = col(['SUFRAMA']);
  const cOutras  = col(['OUTRAS']);

  const cidades = [];

  for (let r = cabIdx + 1; r < matrix.length; r++) {
    const row = matrix[r] || [];

    const ibge   = cIBGE >= 0 ? row[cIBGE] : null;
    const uf     = cUF >= 0 ? norm(row[cUF] || '') : '';
    const cidade = cCidade >= 0 ? txt(row[cCidade] || '') : '';

    // Linha válida deve ter pelo menos IBGE ou cidade
    if (!ibge && !cidade) continue;
    // Ignorar linha de rodapé com hífens
    if (txt(uf) === '-' || txt(ibge) === '-') continue;
    if (!UF_LISTA.includes(uf)) continue;

    const regiaoRaw = cRegiao >= 0 ? txt(row[cRegiao] || '') : '';
    const regiao    = detectarRegiao(regiaoRaw) || null;

    cidades.push({
      ibge_destino:   ibge ? String(ibge).trim() : '',
      uf_destino:     uf,
      cidade_destino: cidade,
      cep_inicial:    cCepIni >= 0 ? (row[cCepIni] ?? '') : '',
      cep_final:      cCepFim >= 0 ? (row[cCepFim] ?? '') : '',
      prazo:          cPrazo >= 0 ? (num(row[cPrazo]) ?? 0) : 0,
      regiao,          // null se não preenchida
      tda:            cTDA >= 0 ? (num(row[cTDA]) ?? 0) : 0,
      trt:            cTRT >= 0 ? (num(row[cTRT]) ?? 0) : 0,
      suframa:        cSuframa >= 0 ? (num(row[cSuframa]) ?? 0) : 0,
      outras_taxas:   cOutras >= 0 ? (num(row[cOutras]) ?? 0) : 0,
    });
  }

  return cidades;
}

// ─── Cruzamento TABELA + ATENDIMENTO (Percentual) ────────────────────────────

/**
 * Cruza as tarifas da TABELA com as cidades da ATENDIMENTO.
 *
 * Resultado: um item por cidade com IBGE, CEP, prazo e tarifa buscada pelo
 * par (UF destino, Região) na TABELA.
 *
 * Cidades sem região preenchida são importadas sem tarifa (frete% = 0).
 * Cidades com região mas sem tarifa correspondente na TABELA também entram.
 */
function cruzarTabelaAtendimentoPercentual(itensTarifa, cidades, ficha, canal, origem) {
  // Mapa de tarifas: uf → regiao → { frete_percentual, frete_minimo }
  const mapaUF = new Map(); // key: `${uf}||${regiao}`
  for (const item of itensTarifa) {
    const key = `${item.uf_destino}||${item.faixa_peso}`;
    mapaUF.set(key, { frete_percentual: item.frete_percentual, frete_minimo: item.frete_minimo });
  }

  const itens = [];

  for (const cidade of cidades) {
    const tarifa = cidade.regiao
      ? (mapaUF.get(`${cidade.uf_destino}||${cidade.regiao}`) || null)
      : null;

    itens.push({
      cidade_origem:    origem || '',
      uf_origem:        '',
      ibge_origem:      '',
      cidade_destino:   cidade.cidade_destino,
      uf_destino:       cidade.uf_destino,
      ibge_destino:     cidade.ibge_destino,
      faixa_peso:       cidade.regiao || 'SEM REGIÃO',
      peso_inicial:     0,
      peso_final:       999999,
      frete_minimo:     tarifa?.frete_minimo ?? 0,
      taxa_aplicada:    0,
      frete_percentual: tarifa?.frete_percentual ?? 0,
      excesso_kg:       0,
      valor_excedente:  0,
      prazo:            cidade.prazo || numOrZero(ficha.prazo),
      gris:             numOrZero(ficha.gris),
      advalorem:        numOrZero(ficha.advalorem),
      pedagio:          numOrZero(ficha.pedagio),
      tas:              numOrZero(ficha.tas),
      tda:              cidade.tda || 0,
      tde:              cidade.trt || 0,   // TRT mapeado como TDE
      outras_taxas:     cidade.outras_taxas || 0,
      observacao:       `${cidade.uf_destino} - ${cidade.cidade_destino}${cidade.regiao ? ' (' + cidade.regiao + ')' : ''}`,
      dados_originais: {
        ibge_destino:     cidade.ibge_destino,
        cidade_destino:   cidade.cidade_destino,
        uf_destino:       cidade.uf_destino,
        cep_inicial:      cidade.cep_inicial,
        cep_final:        cidade.cep_final,
        regiao:           cidade.regiao,
        tda:              cidade.tda,
        trt:              cidade.trt,
        suframa:          cidade.suframa,
        tarifa_aplicada:  tarifa,
        canal,
        tipo:             'PERCENTUAL_CIDADE',
      },
    });
  }

  return itens;
}

// ─── API PÚBLICA ──────────────────────────────────────────────────────────────

/**
 * Importa template Cantu (B2B ou B2C, Percentual ou Faixa de Peso).
 *
 * Para modelos Percentual: cruza aba TABELA (tarifas por UF+Região) com aba
 * ATENDIMENTO (roteamento por cidade com IBGE, CEP, prazo e região).
 * Resultado: um item por cidade com tarifa completa.
 *
 * Para modelos Faixa de Peso: usa apenas a aba TABELA.
 *
 * @param {File} arquivo - arquivo xlsx enviado pelo usuário
 * @param {'B2B_PERCENTUAL'|'B2B_FAIXA_PESO'|'B2C_PERCENTUAL'|'B2C_FAIXA_PESO'} subtipo
 * @param {string} origem - cidade de origem (opcional)
 * @returns {{ itens: Array, ficha: Object, meta: Object }}
 */
export async function importarTemplateCantu(arquivo, subtipo, origem = '') {
  if (!arquivo) throw new Error('Selecione o arquivo do template Cantu.');

  const wb = await lerArquivo(arquivo);
  const abas = wb.SheetNames;

  // Ficha de cadastro (metadados da transportadora)
  const wsFicha = encontrarAba(wb, ['FICHA DE CADASTRO', 'FICHA', 'CADASTRO', 'DADOS']);
  const ficha = lerFichaCadastro(wsFicha);

  // Aba de tarifas (obrigatória)
  const wsTabela = encontrarAba(wb, ['TABELA', 'TABLE', 'FRETES', 'FRETE']);
  if (!wsTabela) {
    throw new Error(`Aba "TABELA" não encontrada. Abas disponíveis: ${abas.join(', ')}`);
  }

  const matrixTabela = sheetParaMatrix(wsTabela);
  const isPercentual = subtipo.includes('PERCENTUAL');
  const canal = subtipo.startsWith('B2B') ? 'ATACADO' : 'B2C';

  // ── Parsear tarifas da TABELA ──────────────────────────────────────────────
  let itensTarifa;
  if (isPercentual) {
    itensTarifa = parseCantUPercentual(matrixTabela, ficha, canal, origem);
  } else {
    itensTarifa = parseCantUFaixaPeso(matrixTabela, ficha, canal, origem);
  }

  // ── Para modelos PERCENTUAL: cruzar com aba ATENDIMENTO ───────────────────
  let itens;
  let totalCidades = 0;
  let cidadesSemRegiao = 0;
  let cidadesComTarifa = 0;

  if (isPercentual) {
    const wsAtendimento = encontrarAba(wb, ['ATENDIMENTO', 'ROTAS', 'CIDADES', 'COVERAGE']);
    const cidades = parseAtendimento(wsAtendimento);
    totalCidades = cidades.length;
    cidadesSemRegiao = cidades.filter((c) => !c.regiao).length;

    if (cidades.length > 0) {
      // Temos cidade-a-cidade: gerar itens cruzados
      itens = cruzarTabelaAtendimentoPercentual(itensTarifa, cidades, ficha, canal, origem);
      cidadesComTarifa = itens.filter((i) => i.frete_percentual > 0 || i.frete_minimo > 0).length;
    } else {
      // Sem ATENDIMENTO: usar itens de UF (comportamento anterior)
      itens = itensTarifa;
    }
  } else {
    // Faixa de peso: usa apenas TABELA
    itens = itensTarifa;
  }

  // Adicionar canal, tipo e origem_importacao a todos os itens
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
    transportadora:    ficha.transportadora || '',
    canal,
    subtipo,
    totalItens:        itens.length,
    totalCidades,
    cidadesSemRegiao,
    cidadesComTarifa,
    abasEncontradas:   abas,
    fichaLida:         Object.keys(ficha).length > 0,
    temAtendimento:    totalCidades > 0,
    itensTarifaUF:     itensTarifa.length,
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
