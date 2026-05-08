import * as XLSX from 'xlsx';
import {
  isTomadorServicoValidoRealizado,
  normalizeHeaderRealizado,
  normalizeTextRealizado,
  parseDateRealizado,
  regraTomadorServicoRealizadoTexto,
  toNumberRealizado,
} from './realizadoCtes';

const HEADER_MAP_FAST = {
  'transportadora': 'transportadora',
  'transportador': 'transportadora',
  'nome transportadora': 'transportadora',
  'razao social transportadora': 'transportadora',
  'cnpj transportadora': 'cnpjTransportadora',
  'cnpj do transportador': 'cnpjTransportadora',
  'tomador': 'tomadorServico',
  'tomador servico': 'tomadorServico',
  'tomador de servico': 'tomadorServico',
  'tomador do servico': 'tomadorServico',
  'tomador servico cte': 'tomadorServico',
  'tomador de servico cte': 'tomadorServico',
  'nome tomador': 'tomadorServico',
  'razao social tomador': 'tomadorServico',
  'razao social do tomador': 'tomadorServico',
  'cliente tomador': 'tomadorServico',
  'emissao': 'emissao',
  'data emissao': 'emissao',
  'data de emissao': 'emissao',
  'emissao cte': 'emissao',
  'data emissao cte': 'emissao',
  'data emissao ct e': 'emissao',
  'chave cte': 'chaveCte',
  'chave ct e': 'chaveCte',
  'chave do cte': 'chaveCte',
  'chave do ct e': 'chaveCte',
  'chave acesso cte': 'chaveCte',
  'chave acesso ct e': 'chaveCte',
  'chave de acesso cte': 'chaveCte',
  'chave de acesso ct e': 'chaveCte',
  'numero cte': 'numeroCte',
  'numero ct e': 'numeroCte',
  'n cte': 'numeroCte',
  'n ct e': 'numeroCte',
  'cte': 'numeroCte',
  'ct e': 'numeroCte',
  'serie cte': 'serieCte',
  'serie ct e': 'serieCte',
  'valor cte': 'valorCte',
  'valor ct e': 'valorCte',
  'valor do cte': 'valorCte',
  'valor do ct e': 'valorCte',
  'frete': 'valorCte',
  'valor frete': 'valorCte',
  'valor calculado': 'valorCalculado',
  'diferenca': 'diferenca',
  'situacao': 'situacao',
  'status': 'status',
  'status conciliacao': 'statusConciliacao',
  'status erp': 'statusErp',
  'uf origem': 'ufOrigem',
  'estado origem': 'ufOrigem',
  'uf destino': 'ufDestino',
  'estado destino': 'ufDestino',
  'ibge origem': 'ibgeOrigem',
  'codigo ibge origem': 'ibgeOrigem',
  'cod ibge origem': 'ibgeOrigem',
  'codigo municipio origem': 'ibgeOrigem',
  'codigo municipio completo origem': 'ibgeOrigem',
  'ibge destino': 'ibgeDestino',
  'codigo ibge destino': 'ibgeDestino',
  'cod ibge destino': 'ibgeDestino',
  'codigo municipio destino': 'ibgeDestino',
  'codigo municipio completo destino': 'ibgeDestino',
  'peso declarado': 'pesoDeclarado',
  'peso': 'pesoDeclarado',
  'peso real': 'pesoDeclarado',
  'peso cubado': 'pesoCubado',
  'cubagem': 'pesoCubado',
  'metros cubicos': 'metrosCubicos',
  'metros cubicos m3': 'metrosCubicos',
  'm3': 'metrosCubicos',
  'volume': 'volume',
  'volumes': 'volume',
  'qtd volumes': 'volume',
  'quantidade volumes': 'volume',
  'canais': 'canais',
  'canal': 'canal',
  'valor nf': 'valorNF',
  'valor nota': 'valorNF',
  'valor nota fiscal': 'valorNF',
  'valor da nota': 'valorNF',
  'valor da nf': 'valorNF',
  'percentual frete': 'percentualFrete',
  'frete nf': 'percentualFrete',
  'canal de vendas': 'canalVendas',
  'cep destino': 'cepDestino',
  'cep origem': 'cepOrigem',
  'cidade origem': 'cidadeOrigem',
  'cidade de origem': 'cidadeOrigem',
  'municipio origem': 'cidadeOrigem',
  'municipio de origem': 'cidadeOrigem',
  'origem': 'cidadeOrigem',
  'cidade destino': 'cidadeDestino',
  'cidade de destino': 'cidadeDestino',
  'municipio destino': 'cidadeDestino',
  'municipio de destino': 'cidadeDestino',
  'destino': 'cidadeDestino',
  'transportadora contratada': 'transportadoraContratada',
  'prazo de entrega para o cliente': 'prazoEntregaCliente',
  'entrega de cte': 'entregaCte',
  'entrega de ct e': 'entregaCte',
  'data de criacao do pedido': 'dataCriacaoPedido',
  'data de pagamento do pedido': 'dataPagamentoPedido',
  'data de faturamento do pedido': 'dataFaturamentoPedido',
  'data de expedicao do pedido': 'dataExpedicaoPedido',
};

const B2C_CANAIS = [
  'B2C', 'MERCADO LIVRE', 'MERCADOR LIVRE', 'SHOPEE', 'MAGAZINE LUIZA',
  'AMAZON', 'INTER', 'VIA VAREJO', 'CARREFOUR', 'CANTU PNEUS', 'ITAU SHOP',
  'ITAÚ SHOP', 'ITAÃº SHOP', '99', 'MUSTANG', 'LIVELO', 'BRADESCO SHOP',
  'COOPERA', 'B2W', 'MARKETPLACE', 'MARKET PLACE', 'ECOMMERCE', 'E-COMMERCE',
];

const ATACADO_CANAIS = ['B2B', 'ATACADO'];

const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function onlyDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function cleanKeyPart(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function normalizeLoose(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCellValue(sheet, rowIndex, colIndex) {
  const denseRow = Array.isArray(sheet) ? sheet[rowIndex] : null;
  const cell = denseRow ? denseRow[colIndex] : sheet[XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })];
  if (!cell) return '';
  if (cell.w !== undefined && cell.w !== null && String(cell.w).trim() !== '') return cell.w;
  return cell.v ?? '';
}

function getRange(sheet) {
  const ref = sheet?.['!ref'] || 'A1:A1';
  try {
    return XLSX.utils.decode_range(ref);
  } catch {
    return { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  }
}

function mapHeader(value) {
  const normalized = normalizeHeaderRealizado(value);
  return HEADER_MAP_FAST[normalized] || normalized.replace(/\s+([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function locateHeader(sheet, range) {
  let best = { row: range.s.r, score: -1, mapped: [] };
  const maxHeaderScan = Math.min(range.e.r, range.s.r + 30);

  for (let r = range.s.r; r <= maxHeaderScan; r += 1) {
    const mapped = [];
    let score = 0;
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const original = getCellValue(sheet, r, c);
      const field = mapHeader(original);
      mapped.push({ index: c, original, field });
      if (['transportadora', 'tomadorServico', 'emissao', 'chaveCte', 'numeroCte', 'valorCte', 'cidadeOrigem', 'cidadeDestino', 'ufOrigem', 'ufDestino'].includes(field)) {
        score += 1;
      }
    }
    if (score > best.score) best = { row: r, score, mapped };
    if (score >= 5) break;
  }

  return best;
}

function normalizeCanal(row = {}) {
  const canal = row.canalVendas || row.canal || row.canais || '';
  const text = normalizeLoose(canal);
  if (!text) return '';
  if (text.includes('INTERCOMPANY')) return 'INTERCOMPANY';
  if (text.includes('REVERSA')) return 'REVERSA';
  if (ATACADO_CANAIS.some((item) => text === item || text.includes(item))) return 'ATACADO';
  if (B2C_CANAIS.some((item) => text === normalizeLoose(item) || text.includes(normalizeLoose(item)))) return 'B2C';
  return text;
}

function buildFallbackCteKey(item = {}, emissao = '') {
  const numero = cleanKeyPart(item.numeroCte || item.cte || item.ctE);
  const transportadora = cleanKeyPart(item.transportadora);
  const origem = cleanKeyPart(item.cidadeOrigem || item.ufOrigem);
  const destino = cleanKeyPart(item.cidadeDestino || item.ufDestino);
  const valor = cleanKeyPart(toNumberRealizado(item.valorCte || item.valorNF).toFixed(2));
  const data = cleanKeyPart(emissao ? emissao.slice(0, 10) : item.emissao);
  const parts = [numero, data, transportadora, origem, destino, valor].filter(Boolean);
  return parts.length >= 2 ? `cte-sem-chave-${parts.join('-')}` : '';
}

function getCompetencia(emissaoIso, fallbackFileName = '') {
  if (emissaoIso) {
    const data = new Date(emissaoIso);
    if (!Number.isNaN(data.getTime())) {
      return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
    }
  }
  const match = String(fallbackFileName || '').match(/(20\d{2})[-_\s]?(\d{1,2})/);
  if (match) return `${match[1]}-${String(match[2]).padStart(2, '0')}`;
  return '';
}

function normalizeRegistroFast(item = {}, arquivoOrigem = '') {
  const emissao = parseDateRealizado(item.emissao);
  const chaveOficial = onlyDigits(item.chaveCte) || String(item.chaveCte || '').trim();
  const chaveCte = chaveOficial || buildFallbackCteKey(item, emissao);

  return {
    id: chaveCte || `${item.numeroCte || ''}-${item.emissao || ''}-${item.valorCte || ''}`,
    arquivoOrigem,
    competencia: getCompetencia(emissao, arquivoOrigem),
    transportadora: normalizeTextRealizado(item.transportadora),
    cnpjTransportadora: onlyDigits(item.cnpjTransportadora),
    tomadorServico: normalizeTextRealizado(item.tomadorServico || item.tomador || ''),
    emissao,
    chaveCte,
    numeroCte: String(item.numeroCte || '').trim(),
    serieCte: String(item.serieCte || '').trim(),
    valorCte: toNumberRealizado(item.valorCte),
    valorCalculado: toNumberRealizado(item.valorCalculado),
    diferenca: toNumberRealizado(item.diferenca),
    situacao: normalizeTextRealizado(item.situacao),
    status: normalizeTextRealizado(item.status),
    statusConciliacao: normalizeTextRealizado(item.statusConciliacao),
    statusErp: normalizeTextRealizado(item.statusErp),
    ufOrigem: String(item.ufOrigem || '').trim().toUpperCase(),
    ufDestino: String(item.ufDestino || '').trim().toUpperCase(),
    ibgeOrigem: onlyDigits(item.ibgeOrigem).slice(0, 7),
    ibgeDestino: onlyDigits(item.ibgeDestino).slice(0, 7),
    pesoDeclarado: toNumberRealizado(item.pesoDeclarado),
    pesoCubado: toNumberRealizado(item.pesoCubado),
    metrosCubicos: toNumberRealizado(item.metrosCubicos),
    volume: toNumberRealizado(item.volume),
    canais: normalizeTextRealizado(item.canais),
    canalVendas: normalizeTextRealizado(item.canalVendas),
    canal: normalizeCanal(item),
    valorNF: toNumberRealizado(item.valorNF),
    percentualFrete: toNumberRealizado(item.percentualFrete),
    cepDestino: onlyDigits(item.cepDestino),
    cepOrigem: onlyDigits(item.cepOrigem),
    cidadeOrigem: normalizeTextRealizado(item.cidadeOrigem),
    cidadeDestino: normalizeTextRealizado(item.cidadeDestino),
    transportadoraContratada: normalizeTextRealizado(item.transportadoraContratada),
    prazoEntregaCliente: toNumberRealizado(item.prazoEntregaCliente),
    raw: item,
  };
}

function deduplicateRows(rows = []) {
  const seen = new Set();
  let duplicados = 0;
  const unique = [];
  rows.forEach((row) => {
    const key = row.chaveCte || `${row.numeroCte}|${row.emissao}|${row.valorCte}`;
    if (!key || seen.has(key)) {
      duplicados += 1;
      return;
    }
    seen.add(key);
    unique.push(row);
  });
  return { rows: unique, duplicados };
}

function valueHasContent(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function estimateRows(range, headerRow) {
  return Math.max(0, range.e.r - headerRow);
}

export async function parseRealizadoCtesFileFast(file, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  if (!file) return { registros: [], meta: { arquivo: '', linhasOriginais: 0 } };

  onProgress({ etapa: 'Lendo arquivo', percentualInterno: 8, mensagem: `Abrindo ${file.name || 'arquivo'} no navegador...` });
  const buffer = await file.arrayBuffer();
  await sleep(0);

  onProgress({ etapa: 'Abrindo planilha', percentualInterno: 15, mensagem: `Interpretando a planilha ${file.name || ''}. Arquivos grandes podem levar alguns segundos nesta etapa.` });
  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellDates: false,
    raw: true,
    dense: true,
    cellNF: false,
    cellHTML: false,
    cellStyles: false,
    WTF: false,
  });

  const sheetName = workbook.SheetNames.find((name) => normalizeHeaderRealizado(name) === 'registros') || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error('Não encontrei nenhuma aba válida no arquivo enviado.');

  const range = getRange(sheet);
  const header = locateHeader(sheet, range);
  if (header.score < 2) {
    throw new Error(`Não consegui identificar o cabeçalho do arquivo ${file.name || ''}. Confira se existem colunas como CTE, Emissão, Tomador, Transportadora e Valor CTE.`);
  }

  const totalRows = estimateRows(range, header.row);
  const registrosNormalizados = [];
  let linhasComAlgumValor = 0;
  let registrosAntesTomador = 0;
  let registrosIgnoradosTomador = 0;

  onProgress({
    etapa: 'Lendo linhas',
    percentualInterno: 20,
    mensagem: `Cabeçalho localizado na linha ${header.row + 1}. Lendo aproximadamente ${totalRows.toLocaleString('pt-BR')} linha(s)...`,
  });

  const chunk = Number(options.chunkRows || 2000);
  for (let r = header.row + 1; r <= range.e.r; r += 1) {
    const item = {};
    let hasAny = false;

    for (const col of header.mapped) {
      if (!col.field) continue;
      const value = getCellValue(sheet, r, col.index);
      if (valueHasContent(value)) hasAny = true;
      if (valueHasContent(value) || item[col.field] === undefined) item[col.field] = value;
    }

    if (hasAny) {
      linhasComAlgumValor += 1;
      const normalizado = normalizeRegistroFast(item, file.name || '');
      if ((normalizado.chaveCte || normalizado.numeroCte) && (normalizado.valorCte > 0 || normalizado.valorNF > 0)) {
        registrosAntesTomador += 1;
        if (isTomadorServicoValidoRealizado(normalizado.tomadorServico)) {
          registrosNormalizados.push(normalizado);
        } else {
          registrosIgnoradosTomador += 1;
        }
      }
    }

    if ((r - header.row) % chunk === 0) {
      const perc = 20 + Math.round(((r - header.row) / Math.max(totalRows, 1)) * 25);
      onProgress({
        etapa: 'Lendo linhas',
        percentualInterno: Math.min(45, perc),
        mensagem: `${Math.min(r - header.row, totalRows).toLocaleString('pt-BR')} de ${totalRows.toLocaleString('pt-BR')} linha(s) lidas de ${file.name || 'arquivo'}...`,
      });
      await sleep(0);
    }
  }

  const dedupe = deduplicateRows(registrosNormalizados);
  onProgress({
    etapa: 'Arquivo lido',
    percentualInterno: 45,
    mensagem: `${dedupe.rows.length.toLocaleString('pt-BR')} CT-e(s) válidos após tomador e deduplicação.`,
  });

  return {
    registros: dedupe.rows,
    meta: {
      arquivo: file.name || '',
      tamanhoBytes: file.size || 0,
      aba: sheetName,
      refOriginal: sheet['!ref'] || '',
      refCorrigida: sheet['!ref'] || '',
      refFoiCorrigida: false,
      linhasEstimadas: totalRows,
      linhasOriginais: linhasComAlgumValor,
      registrosAntesTomador,
      registrosIgnoradosTomador,
      regraTomador: regraTomadorServicoRealizadoTexto(),
      registrosValidos: dedupe.rows.length,
      duplicadosNoArquivo: dedupe.duplicados,
      parser: 'fast-dense-worker',
    },
  };
}
