import * as XLSX from 'xlsx';

const DB_NAME = 'amd-tracking-local-db';
const DB_VERSION = 2;
const STORE_TRACKING = 'tracking_rows';
const STORE_META = 'meta';

const UF_POR_CODIGO = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

const UF_POR_CIDADE_ORIGEM = {
  ITAJAI: 'SC',
  ITAJAÍ: 'SC',
  ITUPEVA: 'SP',
  JABOATAO: 'PE',
  'JABOATAO DOS GUARARAPES': 'PE',
  'JABOATÃO': 'PE',
  'JABOATÃO DOS GUARARAPES': 'PE',
  SERRA: 'ES',
  CONTAGEM: 'MG',
  GOIANIA: 'GO',
  GOIÂNIA: 'GO',
  RIBEIRAO: 'PE',
  RIBEIRÃO: 'PE',
};

const UF_POR_CENTRO_EXPEDICAO = {
  '4210': 'ES', // Serra/ES
  '4200': 'SC',
  '4208': 'SC',
  '3500': 'SP',
  '2600': 'PE',
};


const CANAL_DEPARA_TRACKING = {
  'MERCADO LIVRE': 'B2C',
  SHOPEE: 'B2C',
  'MAGAZINE LUIZA': 'B2C',
  B2C: 'B2C',
  AMAZON: 'B2C',
  INTER: 'B2C',
  'VIA VAREJO': 'B2C',
  CARREFOUR: 'B2C',
  'CANTU PNEUS': 'B2C',
  'ITAU SHOP': 'B2C',
  'ITAÚ SHOP': 'B2C',
  'ITAÃº SHOP': 'B2C',
  '99': 'B2C',
  MUSTANG: 'B2C',
  LIVELO: 'B2C',
  'BRADESCO SHOP': 'B2C',
  COOPERA: 'B2C',
  B2B: 'ATACADO',
  ATACADO: 'ATACADO',
};

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      let store;
      if (!db.objectStoreNames.contains(STORE_TRACKING)) {
        store = db.createObjectStore(STORE_TRACKING, { keyPath: 'id' });
      } else {
        store = req.transaction.objectStore(STORE_TRACKING);
      }
      [
        ['data', 'data'],
        ['canal', 'canal'],
        ['canalOriginal', 'canalOriginal'],
        ['transportadora', 'transportadora'],
        ['ufOrigem', 'ufOrigem'],
        ['ufDestino', 'ufDestino'],
        ['chaveRotaIbge', 'chaveRotaIbge'],
        ['notaFiscal', 'notaFiscal'],
        ['chaveNfe', 'chaveNfe'],
        ['chaveCte', 'chaveCte'],
        ['cteNumero', 'cteNumero'],
      ].forEach(([nome, campo]) => {
        if (!store.indexNames.contains(nome)) store.createIndex(nome, campo, { unique: false });
      });
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Erro ao abrir base local de Tracking.'));
  });
}

function txComplete(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Erro na transação local de Tracking.'));
    tx.onabort = () => reject(tx.error || new Error('Transação local de Tracking cancelada.'));
  });
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Erro na leitura local de Tracking.'));
  });
}

function normalize(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function normalizeLoose(value = '') {
  return normalize(value).replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function onlyDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value).trim();
  if (!text) return 0;
  if (/nao|não|encontrado|data/i.test(text)) return 0;
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  return Number(normalized.replace(/[^0-9.-]/g, '')) || 0;
}

function text(value) {
  return String(value ?? '').trim();
}

function parseDate(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed?.y) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const raw = String(value).trim();
  const iso = raw.match(/^(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`;
  const br = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](20\d{2})/);
  if (br) return `${br[3]}-${String(br[2]).padStart(2, '0')}-${String(br[1]).padStart(2, '0')}`;
  return '';
}

function corrigirMojibakeCanal(value = '') {
  return String(value || '')
    .replace(/ItaÃº/gi, 'Itaú')
    .replace(/ItaÃš/gi, 'Itaú')
    .replace(/ItaÃº Shop/gi, 'Itaú Shop');
}

function categoriaCanal(value) {
  const canalOriginal = corrigirMojibakeCanal(value);
  const canal = normalizeLoose(canalOriginal);
  if (!canal) return '';

  const depara = CANAL_DEPARA_TRACKING[canal] || CANAL_DEPARA_TRACKING[normalize(canalOriginal)];
  if (depara) return depara;

  const atacadoContem = ['ATACADO', 'B2B', 'B 2 B'];
  if (atacadoContem.some((item) => canal === item || canal.includes(item))) return 'ATACADO';

  const b2cContem = [
    'B2C', 'MERCADO LIVRE', 'MERCADOR LIVRE', 'SHOPEE', 'MAGAZINE', 'MAGALU',
    'AMAZON', 'INTER', 'VIA VAREJO', 'VAREJO', 'CARREFOUR', 'CANTU PNEUS',
    'ITAU', 'ITAÚ', '99', 'MUSTANG', 'LIVELO', 'BRADESCO', 'BRASIL SHOP',
    'BRAZIL SHOP', 'COOPERA', 'ECOMMERCE', 'E COMMERCE', 'E-COMMERCE',
    'MARKETPLACE', 'MARKET PLACE', 'ANYMARKET', 'ANY MARKET', 'ME2'
  ];
  if (b2cContem.some((item) => canal === item || canal.includes(item))) return 'B2C';

  // Tracking é base de venda. Para não perder volumetria no filtro B2C,
  // canais não mapeados entram como B2C e ficam com o canal original preservado.
  return 'B2C';
}

function headerKey(value) {
  return normalize(value).replace(/[^A-Z0-9]+/g, ' ').trim();
}

function findCol(headers, terms = []) {
  const normalized = headers.map(headerKey);
  const normalizedTerms = terms.map(headerKey);
  for (const term of normalizedTerms) {
    const exact = normalized.findIndex((h) => h === term);
    if (exact >= 0) return exact;
  }
  for (const term of normalizedTerms) {
    const contains = normalized.findIndex((h) => term && h.includes(term));
    if (contains >= 0) return contains;
  }
  return -1;
}

function pickFirstCol(headers, candidates = []) {
  for (const group of candidates) {
    const idx = findCol(headers, Array.isArray(group) ? group : [group]);
    if (idx >= 0) return idx;
  }
  return -1;
}

function detectHeader(rows = []) {
  let best = { index: -1, score: -1 };
  rows.slice(0, 30).forEach((row, index) => {
    const h = row.map(headerKey).join(' | ');
    let score = 0;
    if (h.includes('NF CHAVE') || h.includes('NF NUMERO')) score += 6;
    if (h.includes('PEDIDO ERP') || h.includes('PEDIDO LOJISTA')) score += 4;
    if (h.includes('CIDADE DE ORIGEM') || h.includes('CIDADE ORIGEM')) score += 4;
    if (h.includes('CIDADE DESTINO')) score += 4;
    if (h.includes('PESO DECLARADO')) score += 3;
    if (h.includes('PESO CUBADO')) score += 3;
    if (h.includes('VALOR DA NF')) score += 3;
    if (score > best.score) best = { index, score };
  });
  return best.score >= 5 ? best.index : 0;
}

function get(row, col) {
  if (col === null || col === undefined || col < 0) return '';
  return row[col] ?? '';
}

function mapColumns(headers = []) {
  return {
    pedidoLojista: findCol(headers, ['PEDIDO LOJISTA']),
    pedidoMarketplace: findCol(headers, ['PEDIDO MARKETPLACE']),
    pedidoErp: findCol(headers, ['PEDIDO ERP']),
    pedido: pickFirstCol(headers, ['PEDIDO ERP', 'PEDIDO LOJISTA', 'PEDIDO MARKETPLACE', 'PEDIDO', 'ORDER', 'ORDEM']),
    canal: findCol(headers, ['CANAL']),
    loja: findCol(headers, ['LOJA']),
    statusPedido: findCol(headers, ['STATUS PEDIDO']),
    dataCriacao: findCol(headers, ['DATA CRIACAO', 'DATA CRIAÇÃO']),
    dataExpedicao: findCol(headers, ['DATA EXPEDICAO', 'DATA EXPEDIÇÃO']),
    cdOrigem: findCol(headers, ['CD DE ORIGEM']),
    centroExpedicao: findCol(headers, ['CENTRO DE EXPEDICAO', 'CENTRO DE EXPEDIÇÃO']),
    origem: pickFirstCol(headers, ['CIDADE DE ORIGEM', 'CIDADE ORIGEM', 'ORIGEM', 'MUNICIPIO ORIGEM']),
    ufOrigem: pickFirstCol(headers, ['UF ORIGEM', 'UF ORIG', 'ESTADO ORIGEM']),
    ibgeOrigem: pickFirstCol(headers, ['IBGE ORIGEM', 'CODIGO IBGE ORIGEM', 'COD MUNICIPIO ORIGEM']),
    destino: pickFirstCol(headers, ['CIDADE DESTINO', 'DESTINO', 'MUNICIPIO DESTINO', 'CIDADE ENTREGA']),
    regiaoDestino: findCol(headers, ['REGIAO DESTINO', 'REGIÃO DESTINO']),
    ufDestino: pickFirstCol(headers, ['UF DESTINO', 'UF DEST', 'ESTADO DESTINO', 'UF ENTREGA', 'REGIAO DESTINO', 'REGIÃO DESTINO']),
    ibgeDestino: pickFirstCol(headers, ['IBGE DESTINO', 'CODIGO IBGE DESTINO', 'COD MUNICIPIO DESTINO']),
    transportadora: pickFirstCol(headers, ['TRANSPORTADORA CONTRATADA CANTU', 'TRANSPORTADORA', 'FORNECEDOR', 'OPERADOR', 'CARRIER']),
    transportadoraOriginal: findCol(headers, ['TRANSPORTADORA']),
    transportadoraContratada: findCol(headers, ['TRANSPORTADORA CONTRATADA CANTU']),
    segmento: findCol(headers, ['SEGMENTO']),
    regiao: findCol(headers, ['REGIAO', 'REGIÃO']),
    tipoMovimentacao: findCol(headers, ['TIPO DE MOVIMENTACAO', 'TIPO DE MOVIMENTAÇÃO']),
    chaveNfe: pickFirstCol(headers, ['NF CHAVE', 'CHAVE NFE', 'CHAVE NF', 'CHAVE NOTA', 'CHAVE ACESSO']),
    notaFiscal: pickFirstCol(headers, ['NF NUMERO', 'NF NÚMERO', 'NUMERO NF', 'NÚMERO NF', 'NOTA FISCAL', 'NFE NUMERO', 'DOCUMENTO']),
    dataFaturamento: findCol(headers, ['DATA FATURAMENTO']),
    cteNumero: pickFirstCol(headers, ['CTE NUMERO SERIE', 'CTE NÚMERO SÉRIE', 'CTE NUMERO', 'CTE']),
    cteAdicional: findCol(headers, ['CTE NUMERO SERIE ADICIONAL', 'CTE NÚMERO SÉRIE ADICIONAL']),
    dataEmissaoCte: findCol(headers, ['DATA EMISSAO CTE', 'DATA EMISSÃO CTE']),
    chaveCte: findCol(headers, ['CHAVE CTE']),
    entregaCte: findCol(headers, ['ENTREGA DE CTE']),
    situacao: findCol(headers, ['SITUACAO', 'SITUAÇÃO']),
    previsaoCliente: findCol(headers, ['PREVISAO P CLIENTE', 'PREVISÃO P CLIENTE']),
    prevTransportadora: findCol(headers, ['PREV TRANSPORTADORA']),
    valorCalculadoFrete: findCol(headers, ['VLR CALCULADO FRETE', 'VALOR CALCULADO FRETE']),
    descricaoCalculo: findCol(headers, ['DESCRICAO CALCULO', 'DESCRIÇÃO CALCULO']),
    dataTransporte: findCol(headers, ['DATA TRANSPORTE']),
    dataEntrega: pickFirstCol(headers, ['DATA ENTREGA', 'ENTREGA', 'DT ENTREGA']),
    tipoOrdem: findCol(headers, ['TIPO DE ORDEM']),
    modelo: findCol(headers, ['MODELO']),
    valorCte: findCol(headers, ['VALOR CT E', 'VALOR CTE', 'VALOR CT-E']),
    valorNF: pickFirstCol(headers, ['VALOR DA NF', 'VALOR NF', 'VALOR NOTA', 'VALOR DA NOTA', 'VALOR MERCADORIA', 'VLR NF']),
    percentualFrete: findCol(headers, ['PERCENTUAL DE FRETE']),
    pesoDeclarado: findCol(headers, ['PESO DECLARADO', 'PESO REAL', 'PESO TOTAL', 'PESO BRUTO', 'PESO KG']),
    pesoCubado: findCol(headers, ['PESO CUBADO']),
    cubagem: pickFirstCol(headers, ['CUBAGEM', 'M3', 'METROS CUBICOS', 'METRAGEM CUBICA', 'PESO CUBADO']),
    quantidadeItens: findCol(headers, ['QUANTIDADE DE ITENS', 'QTD ITENS']),
    totalUnidades: findCol(headers, ['TOTAL DE UNIDADES', 'VOLUMES', 'VOLUME', 'QTD VOLUMES', 'QTDE VOLUMES', 'QUANTIDADE VOLUMES']),
    numeroRomaneio: findCol(headers, ['NUMERO DO ROMANEIO', 'NÚMERO DO ROMANEIO']),
    modoEnvio: findCol(headers, ['MODO DE ENVIO DO PEDIDO']),
    deposito: findCol(headers, ['DEPOSITO', 'DEPÓSITO']),
    emailCompra: findCol(headers, ['EMAIL DE COMPRA']),
  };
}

function rowHasValue(row = []) {
  return row.some((value) => String(value ?? '').trim() !== '');
}

function detectarSeparadorCsv(texto = '') {
  const primeiraLinha = texto.split(/\r?\n/).find((line) => line.trim()) || '';
  const candidatos = [';', ',', '\t'];
  return candidatos
    .map((sep) => ({ sep, count: primeiraLinha.split(sep).length }))
    .sort((a, b) => b.count - a.count)[0]?.sep || ';';
}

function parseCsvMatrix(texto = '') {
  const sep = detectarSeparadorCsv(texto);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < texto.length; i += 1) {
    const char = texto[i];
    const next = texto[i + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && char === sep) {
      row.push(cell);
      cell = '';
      continue;
    }
    if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }
  row.push(cell);
  if (row.some((value) => String(value ?? '').trim() !== '')) rows.push(row);
  return rows;
}

function isCsvFile(file) {
  return /\.csv$/i.test(file?.name || '') || /csv/i.test(file?.type || '');
}

function parseUfFromRegiaoDestino(value = '') {
  const raw = String(value || '').trim().toUpperCase();
  const first = raw.match(/^([A-Z]{2})\b/);
  if (first) return first[1];
  const slash = raw.match(/\/\s*([A-Z]{2})$/);
  return slash ? slash[1] : '';
}

function getUfByIbge(ibge = '') {
  return UF_POR_CODIGO[onlyDigits(ibge).slice(0, 2)] || '';
}

function montarMapasMunicipios(municipios = []) {
  const porCidadeUf = new Map();
  const porIbge = new Map();
  (municipios || []).forEach((item) => {
    const ibge = onlyDigits(item.ibge || item.codigo_ibge || item.codigo || item.codigoMunicipio || '').slice(0, 7);
    const cidade = text(item.cidade || item.nome || item.municipio || item.nomeMunicipio || '');
    const uf = text(item.uf || item.estado || getUfByIbge(ibge)).toUpperCase().slice(0, 2);
    if (!ibge || !cidade) return;
    const cidadeKey = normalizeLoose(cidade);
    porIbge.set(ibge, { ibge, cidade, uf });
    porCidadeUf.set(`${cidadeKey}|${uf}`, ibge);
    if (!porCidadeUf.has(`${cidadeKey}|`)) porCidadeUf.set(`${cidadeKey}|`, ibge);
  });
  return { porCidadeUf, porIbge };
}

function resolverIbgeCidade(cidadeRaw = '', ufRaw = '', mapas = {}) {
  const cidadeKey = normalizeLoose(cidadeRaw);
  const uf = String(ufRaw || '').trim().toUpperCase().slice(0, 2);
  if (!cidadeKey) return '';
  return mapas.porCidadeUf?.get(`${cidadeKey}|${uf}`) || mapas.porCidadeUf?.get(`${cidadeKey}|`) || '';
}

function inferirUfOrigem(cidade = '', cdOrigem = '', centroExpedicao = '', ibgeOrigem = '') {
  const ufIbge = getUfByIbge(ibgeOrigem);
  if (ufIbge) return ufIbge;
  const cd = onlyDigits(centroExpedicao || cdOrigem).slice(0, 4);
  if (UF_POR_CENTRO_EXPEDICAO[cd]) return UF_POR_CENTRO_EXPEDICAO[cd];
  return UF_POR_CIDADE_ORIGEM[normalizeLoose(cidade)] || '';
}

function buildRowsFromMatrix(matriz = [], file, options = {}) {
  const headerIndex = detectHeader(matriz);
  const headers = matriz[headerIndex] || [];
  const col = mapColumns(headers);
  const mapas = montarMapasMunicipios(options.municipios || []);
  const rows = [];

  matriz.slice(headerIndex + 1).forEach((linha, index) => {
    if (!rowHasValue(linha)) return;

    const notaFiscal = text(get(linha, col.notaFiscal));
    const chaveNfe = onlyDigits(get(linha, col.chaveNfe));
    const pedido = text(get(linha, col.pedido));
    const origem = text(get(linha, col.origem));
    const destino = text(get(linha, col.destino));
    if (!notaFiscal && !chaveNfe && !pedido && !origem && !destino) return;

    const data = parseDate(
      get(linha, col.dataFaturamento) ||
      get(linha, col.dataExpedicao) ||
      get(linha, col.dataCriacao) ||
      get(linha, col.dataEmissaoCte)
    );

    const ibgeOrigemInformado = onlyDigits(get(linha, col.ibgeOrigem)).slice(0, 7);
    const ufOrigem = text(get(linha, col.ufOrigem)).toUpperCase().slice(0, 2) || inferirUfOrigem(origem, get(linha, col.cdOrigem), get(linha, col.centroExpedicao), ibgeOrigemInformado);
    const ibgeOrigem = ibgeOrigemInformado || resolverIbgeCidade(origem, ufOrigem, mapas);

    const ibgeDestinoInformado = onlyDigits(get(linha, col.ibgeDestino)).slice(0, 7);
    const ufDestino = text(get(linha, col.ufDestino)).toUpperCase().slice(0, 2) || parseUfFromRegiaoDestino(get(linha, col.regiaoDestino));
    const ibgeDestino = ibgeDestinoInformado || resolverIbgeCidade(destino, ufDestino, mapas);

    const pesoDeclarado = toNumber(get(linha, col.pesoDeclarado));
    const cubagemTracking = toNumber(get(linha, col.cubagem)) || toNumber(get(linha, col.pesoCubado));
    const volumes = toNumber(get(linha, col.totalUnidades)) || toNumber(get(linha, col.quantidadeItens));
    const canalOriginal = text(get(linha, col.canal));
    const regiao = text(get(linha, col.regiao));
    const modoEnvio = text(get(linha, col.modoEnvio));

    const row = {
      id: chaveNfe || `${normalizeLoose(notaFiscal || pedido || file.name)}-${headerIndex + index + 2}`.slice(0, 240),
      notaFiscal,
      chaveNfe,
      pedido,
      pedidoLojista: text(get(linha, col.pedidoLojista)),
      pedidoMarketplace: text(get(linha, col.pedidoMarketplace)),
      pedidoErp: text(get(linha, col.pedidoErp)),
      data,
      competencia: data ? data.slice(0, 7) : '',
      canal: categoriaCanal(canalOriginal || text(get(linha, col.loja)) || regiao || modoEnvio),
      canalOriginal: corrigirMojibakeCanal(canalOriginal),
      loja: text(get(linha, col.loja)),
      statusPedido: text(get(linha, col.statusPedido)),
      transportadora: text(get(linha, col.transportadora)),
      transportadoraOriginal: text(get(linha, col.transportadoraOriginal)),
      transportadoraContratada: text(get(linha, col.transportadoraContratada)),
      cidadeOrigem: origem,
      ufOrigem,
      ibgeOrigem,
      cdOrigem: text(get(linha, col.cdOrigem)),
      centroExpedicao: text(get(linha, col.centroExpedicao)),
      cidadeDestino: destino,
      ufDestino,
      ibgeDestino,
      regiaoDestino: text(get(linha, col.regiaoDestino)),
      chaveRotaIbge: ibgeOrigem && ibgeDestino ? `${ibgeOrigem}-${ibgeDestino}` : '',
      peso: pesoDeclarado,
      pesoDeclarado,
      pesoCubadoOriginal: toNumber(get(linha, col.pesoCubado)),
      cubagem: cubagemTracking,
      valorNF: toNumber(get(linha, col.valorNF)),
      qtdVolumes: volumes,
      quantidadeItens: toNumber(get(linha, col.quantidadeItens)),
      totalUnidades: toNumber(get(linha, col.totalUnidades)),
      cteNumero: text(get(linha, col.cteNumero)),
      cteAdicional: text(get(linha, col.cteAdicional)),
      dataEmissaoCte: parseDate(get(linha, col.dataEmissaoCte)),
      chaveCte: onlyDigits(get(linha, col.chaveCte)),
      entregaCte: text(get(linha, col.entregaCte)),
      valorCalculadoFrete: toNumber(get(linha, col.valorCalculadoFrete)),
      valorCte: toNumber(get(linha, col.valorCte)),
      percentualFrete: toNumber(get(linha, col.percentualFrete)),
      descricaoCalculo: text(get(linha, col.descricaoCalculo)),
      situacao: text(get(linha, col.situacao)) || text(get(linha, col.statusPedido)),
      status: text(get(linha, col.situacao)) || text(get(linha, col.statusPedido)),
      previsaoCliente: parseDate(get(linha, col.previsaoCliente)),
      prevTransportadora: parseDate(get(linha, col.prevTransportadora)),
      dataTransporte: parseDate(get(linha, col.dataTransporte)),
      entrega: parseDate(get(linha, col.dataEntrega)),
      tipoOrdem: text(get(linha, col.tipoOrdem)),
      modelo: text(get(linha, col.modelo)),
      segmento: text(get(linha, col.segmento)),
      regiao,
      tipoMovimentacao: text(get(linha, col.tipoMovimentacao)),
      modoEnvio,
      numeroRomaneio: text(get(linha, col.numeroRomaneio)),
      deposito: text(get(linha, col.deposito)),
      emailCompra: text(get(linha, col.emailCompra)),
      arquivoOrigem: file.name || '',
      abaOrigem: isCsvFile(file) ? 'CSV' : 'Planilha',
      linhaExcel: headerIndex + index + 2,
      ibgeOk: Boolean(ibgeOrigem && ibgeDestino),
      criadoEm: new Date().toISOString(),
    };
    rows.push(row);
  });

  return rows;
}

async function parseFile(file, options = {}) {
  if (isCsvFile(file)) {
    const matriz = parseCsvMatrix(await file.text());
    const rows = buildRowsFromMatrix(matriz, file, options);
    return { rows, abas: [{ nome: 'CSV', linhas: rows.length }] };
  }

  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true, dense: false });
  const rows = [];
  const abas = [];

  wb.SheetNames.forEach((sheetName) => {
    const sheet = wb.Sheets[sheetName];
    const matriz = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    const abaRows = buildRowsFromMatrix(matriz, file, options).map((row) => ({ ...row, abaOrigem: sheetName }));
    rows.push(...abaRows);
    abas.push({ nome: sheetName, linhas: abaRows.length });
  });

  return { rows, abas };
}

export async function importarTrackingLocal(files = [], options = {}) {
  const lista = Array.from(files || []);
  const db = await openDb();
  let total = 0;
  const detalhes = [];

  for (const file of lista) {
    const { rows, abas } = await parseFile(file, options);
    detalhes.push({ arquivo: file.name, linhas: rows.length, abas });
    for (let index = 0; index < rows.length; index += 1000) {
      const chunk = rows.slice(index, index + 1000);
      const tx = db.transaction([STORE_TRACKING, STORE_META], 'readwrite');
      const store = tx.objectStore(STORE_TRACKING);
      chunk.forEach((row) => store.put(row));
      tx.objectStore(STORE_META).put({ key: 'ultimaAtualizacao', value: new Date().toISOString() });
      await txComplete(tx);
      total += chunk.length;
      options.onProgress?.({ total, arquivo: file.name });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  db.close();
  return { total, detalhes };
}

function normalizarCanalTrackingRow(row = {}) {
  const canalOriginal = row.canalOriginal || row.raw?.Canal || row.raw?.canal || row.canal || row.loja || row.regiao || row.modoEnvio || '';
  const canalClassificado = categoriaCanal(canalOriginal);
  return {
    ...row,
    canalOriginal,
    canal: canalClassificado || row.canal || '',
    canalNaoClassificado: !CANAL_DEPARA_TRACKING[normalizeLoose(canalOriginal)] && !CANAL_DEPARA_TRACKING[normalize(canalOriginal)] && canalClassificado === 'B2C',
  };
}

function isEbazar(value) {
  return normalizeLoose(value).includes('EBAZAR');
}

export function filtrarTrackingLocal(row = {}, filtros = {}) {
  row = normalizarCanalTrackingRow(row);
  if (filtros.inicio && (!row.data || row.data < filtros.inicio)) return false;
  if (filtros.fim && (!row.data || row.data > filtros.fim)) return false;
  if (filtros.canal && normalize(row.canal) !== normalize(filtros.canal)) return false;
  if (filtros.excluirEbazar && isEbazar(row.transportadora)) return false;
  if (filtros.ufOrigem && normalize(row.ufOrigem) !== normalize(filtros.ufOrigem)) return false;
  if (filtros.ufDestino && normalize(row.ufDestino) !== normalize(filtros.ufDestino)) return false;
  if (filtros.origem && !normalizeLoose(row.cidadeOrigem).includes(normalizeLoose(filtros.origem))) return false;
  if (filtros.destino && !normalizeLoose(row.cidadeDestino).includes(normalizeLoose(filtros.destino))) return false;
  if (filtros.transportadora && !normalizeLoose(row.transportadora).includes(normalizeLoose(filtros.transportadora))) return false;
  return true;
}

export async function exportarTrackingLocal(filtros = {}, options = {}) {
  const db = await openDb();
  const limit = Number(options.limit || 500000);
  const rows = [];
  let totalCompativel = 0;

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TRACKING, 'readonly');
    const store = tx.objectStore(STORE_TRACKING);
    const req = store.openCursor(null, 'prev');
    req.onerror = () => reject(req.error || new Error('Erro ao exportar Tracking local.'));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve();
      const row = normalizarCanalTrackingRow(cursor.value);
      if (filtrarTrackingLocal(row, filtros)) {
        totalCompativel += 1;
        if (rows.length < limit) rows.push(row);
      }
      cursor.continue();
    };
  });

  db.close();
  return { rows, totalCompativel, limit };
}

export async function listarTrackingLocal(filtros = {}, options = {}) {
  const { rows } = await exportarTrackingLocal(filtros, { limit: options.limit || 200 });
  return { rows };
}

export async function diagnosticarTrackingLocal() {
  const db = await openDb();
  const tx = db.transaction([STORE_TRACKING, STORE_META], 'readonly');
  const count = await requestToPromise(tx.objectStore(STORE_TRACKING).count());
  const meta = await requestToPromise(tx.objectStore(STORE_META).get('ultimaAtualizacao')).catch(() => null);
  db.close();
  return { total: count || 0, ultimaAtualizacao: meta?.value || '' };
}

export async function resumirTrackingLocal(filtros = {}) {
  const { rows, totalCompativel } = await exportarTrackingLocal(filtros, { limit: 500000 });
  const resumo = rows.reduce((acc, row) => {
    acc.notas += 1;
    acc.valorNF += toNumber(row.valorNF);
    acc.peso += toNumber(row.peso);
    acc.cubagem += toNumber(row.cubagem);
    acc.volumes += toNumber(row.qtdVolumes);
    if (row.ibgeOk) acc.comIbge += 1;
    else acc.semIbge += 1;
    if (row.data) {
      if (!acc.periodoInicio || row.data < acc.periodoInicio) acc.periodoInicio = row.data;
      if (!acc.periodoFim || row.data > acc.periodoFim) acc.periodoFim = row.data;
    }
    return acc;
  }, { notas: 0, valorNF: 0, peso: 0, cubagem: 0, volumes: 0, periodoInicio: '', periodoFim: '', totalCompativel, comIbge: 0, semIbge: 0 });
  return resumo;
}

export async function limparTrackingLocal() {
  const db = await openDb();
  const tx = db.transaction([STORE_TRACKING, STORE_META], 'readwrite');
  tx.objectStore(STORE_TRACKING).clear();
  tx.objectStore(STORE_META).put({ key: 'ultimaAtualizacao', value: '' });
  await txComplete(tx);
  db.close();
  return { ok: true };
}
