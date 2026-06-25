import * as XLSX from 'xlsx';
import {
  TOMADORES_CTE_PADRAO,
  avaliarCteParaBase,
  getOpcoesImportacaoPadrao,
  particionarCtesPorPolitica,
  isEbazarCte,
} from '../services/cteBasePolicy.js';
import { normalizarCanalOperacional, normalizarTextoCanal } from './canalTransportadora.js';
import canalDeParaEscritorio from '../data/canalDeParaEscritorio.js';

const HEADER_MAP = {
  'transportadora': 'transportadora',
  'transportador': 'transportadora',
  'nome transportadora': 'transportadora',
  'cnpj transportadora': 'cnpjTransportadora',
  'cnpj do transportador': 'cnpjTransportadora',
  'tomador': 'tomadorServico',
  'tomador servico': 'tomadorServico',
  'tomador de servico': 'tomadorServico',
  'tomador do servico': 'tomadorServico',
  'tomador servico cte': 'tomadorServico',
  'tomador de servico cte': 'tomadorServico',
  'nome tomador': 'tomadorServico',
  'nome do tomador': 'tomadorServico',
  'razao social tomador': 'tomadorServico',
  'razao social do tomador': 'tomadorServico',
  'razao social do tomador de servico': 'tomadorServico',
  'tomador do servico do cte': 'tomadorServico',
  'cliente tomador': 'tomadorServico',
  'emissao': 'emissao',
  'data emissao': 'emissao',
  'data de emissao': 'emissao',
  'emissao cte': 'emissao',
  'emissao ct e': 'emissao',
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
  'chave nfe': 'chaveNfe',
  'chave nf e': 'chaveNfe',
  'chave nf': 'chaveNfe',
  'chave da nf': 'chaveNfe',
  'chave nota fiscal': 'chaveNfe',
  'chave da nota fiscal': 'chaveNfe',
  'chave acesso nfe': 'chaveNfe',
  'chave de acesso nfe': 'chaveNfe',
  'chave de acesso nf e': 'chaveNfe',
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
  'estado origem': 'ufOrigem',
  'uf destino': 'ufDestino',
  'estado destino': 'ufDestino',
  'peso declarado': 'pesoDeclarado',
  'peso': 'pesoDeclarado',
  'peso real': 'pesoDeclarado',
  'peso cubado': 'pesoCubado',
  'cubagem': 'pesoCubado',
  'metros cubicos': 'metrosCubicos',
  'volume': 'volume',
  'volumes': 'volume',
  'canais': 'canais',
  'canal': 'canal',
  'valor nf': 'valorNF',
  'valor nota': 'valorNF',
  'valor nota fiscal': 'valorNF',
  'valor da nota': 'valorNF',
  'valor da nf': 'valorNF',
  'nota fiscal': 'notaFiscal',
  'numero nf': 'notaFiscal',
  'numero da nf': 'notaFiscal',
  'numero nota fiscal': 'notaFiscal',
  'numero da nota fiscal': 'notaFiscal',
  'nf': 'notaFiscal',
  'percentual frete': 'percentualFrete',
  'frete nf': 'percentualFrete',
  'canal de vendas': 'canalVendas',
  'escritorio de venda': 'escritorioVenda',
  'escritorio de vendas': 'escritorioVenda',
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
  'remetente': 'remetente',
  'nome remetente': 'remetente',
  'razao social remetente': 'remetente',
  'razao social do remetente': 'remetente',
  'destinatario': 'destinatario',
  'nome destinatario': 'destinatario',
  'razao social destinatario': 'destinatario',
  'razao social do destinatario': 'destinatario',
  'cnpj tomador': 'cnpjTomador',
  'cnpj do tomador': 'cnpjTomador',
  'cnpj tomador servico': 'cnpjTomador',
  'prazo de entrega para o cliente': 'prazoEntregaCliente',
  'entrega de cte': 'entregaCte',
  'entrega de ct e': 'entregaCte',
  'data de criacao do pedido': 'dataCriacaoPedido',
  'data de pagamento do pedido': 'dataPagamentoPedido',
  'data de faturamento do pedido': 'dataFaturamentoPedido',
  'data de expedicao do pedido': 'dataExpedicaoPedido',
};

export const TOMADORES_SERVICO_VALIDOS_REALIZADO = TOMADORES_CTE_PADRAO;

export function normalizarTomadorServicoRealizado(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isTomadorServicoValidoRealizado(value, opcoes) {
  return avaliarCteParaBase(
    { tomador_servico: value },
    opcoes || getOpcoesImportacaoPadrao(),
  ).aceito;
}

export function regraTomadorServicoRealizadoTexto() {
  return TOMADORES_SERVICO_VALIDOS_REALIZADO.join(', ');
}

export function normalizeHeaderRealizado(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizeTextRealizado(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function toNumberRealizado(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  let text = String(value).trim();
  if (!text) return 0;
  text = text.replace(/R\$|%/gi, '').replace(/\s+/g, '');

  const hasComma = text.includes(',');
  const hasDot = text.includes('.');

  if (hasComma && hasDot) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    text = text.replace(',', '.');
  } else if (hasDot) {
    const parts = text.split('.');
    if (parts.length > 2) {
      const decimal = parts.pop();
      text = `${parts.join('')}.${decimal}`;
    }
  }

  const number = Number(text.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function excelSerialToDate(serial) {
  const parsed = Number(serial);
  if (!Number.isFinite(parsed) || parsed <= 0) return '';
  const utcDays = Math.floor(parsed - 25569);
  const utcValue = utcDays * 86400;
  const dateInfo = new Date(utcValue * 1000);
  const fractionalDay = parsed - Math.floor(parsed) + 0.0000001;
  let totalSeconds = Math.floor(86400 * fractionalDay);
  const seconds = totalSeconds % 60;
  totalSeconds -= seconds;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  dateInfo.setUTCHours(hours, minutes, seconds);
  return dateInfo.toISOString();
}

export function parseDateRealizado(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'number') return excelSerialToDate(value);

  const text = String(value).trim();
  if (!text) return '';

  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = excelSerialToDate(text);
    if (serial) return serial;
  }

  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (br) {
    const [, dd, mm, yyyy, hh = '00', min = '00', ss = '00'] = br;
    const date = new Date(
      Number(yyyy),
      Number(mm) - 1,
      Number(dd),
      Number(hh),
      Number(min),
      Number(ss)
    );
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function pick(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return row[key];
    }
  }
  return '';
}

const CANAIS_CANONICOS = ['B2C', 'ATACADO', 'INTERCOMPANY', 'REVERSA'];

// Classificação de canal em cascata (mesma regra do backfill):
// 1) Escritório de venda via DE-PARA  2) Canais/Canal de vendas  3) EBAZAR  4) A DEFINIR.
function normalizeCanal(row = {}) {
  // 1) Escritório de venda -> DE-PARA (Canal Final)
  const esc = canalDeParaEscritorio[normalizarTextoCanal(row.escritorioVenda)];
  if (esc) return esc;

  // 2) Canais / Canal de vendas -> canônico
  const canais = pick(row, ['canais', 'canalVendas', 'canal']);
  const canonico = normalizarCanalOperacional(canais, { permitirInferencia: false });
  if (CANAIS_CANONICOS.includes(canonico)) return canonico;

  // 3) EBAZAR (transportadora/tomador) recebe canal próprio para medição
  if (isEbazarCte(row)) return 'EBAZAR';

  // 4) Sem sinal -> marcador para revisão
  return 'A DEFINIR';
}

function normalizeRowObject(row = {}) {
  const normalized = {};
  Object.entries(row).forEach(([key, value]) => {
    const mapped = HEADER_MAP[normalizeHeaderRealizado(key)] || normalizeHeaderRealizado(key).replace(/\s+([a-z0-9])/g, (_, c) => c.toUpperCase());
    normalized[mapped] = value;
  });
  return normalized;
}

function cleanKeyPart(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
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

function normalizeRegistro(row = {}, arquivoOrigem = '') {
  const item = normalizeRowObject(row);
  const emissao = parseDateRealizado(item.emissao);
  const chaveOficial = String(item.chaveCte || '').replace(/\D/g, '') || String(item.chaveCte || '').trim();
  const chaveCte = chaveOficial || buildFallbackCteKey(item, emissao);

  return {
    id: chaveCte || `${item.numeroCte || ''}-${item.emissao || ''}-${item.valorCte || ''}`,
    arquivoOrigem,
    competencia: getCompetencia(emissao, arquivoOrigem),
    transportadora: normalizeTextRealizado(item.transportadora),
    cnpjTransportadora: String(item.cnpjTransportadora || '').replace(/\D/g, ''),
    tomadorServico: normalizeTextRealizado(item.tomadorServico || item.tomador || ''),
    remetente: normalizeTextRealizado(item.remetente),
    destinatario: normalizeTextRealizado(item.destinatario),
    cnpjTomador: String(item.cnpjTomador || '').replace(/\D/g, ''),
    emissao,
    chaveCte,
    chaveNfe: String(item.chaveNfe || '').replace(/\D/g, '') || String(item.chaveNfe || '').trim(),
    notaFiscal: String(item.notaFiscal || '').trim(),
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
    ibgeOrigem: String(item.ibgeOrigem || '').replace(/\D/g, '').slice(0, 7),
    ibgeDestino: String(item.ibgeDestino || '').replace(/\D/g, '').slice(0, 7),
    pesoDeclarado: toNumberRealizado(item.pesoDeclarado),
    pesoCubado: toNumberRealizado(item.pesoCubado),
    metrosCubicos: toNumberRealizado(item.metrosCubicos),
    volume: toNumberRealizado(item.volume),
    canais: normalizeTextRealizado(item.canais),
    canalVendas: normalizeTextRealizado(item.canalVendas),
    canalOriginal: normalizeTextRealizado(item.canalVendas || item.canal || item.canais),
    canal: normalizeCanal(item),
    valorNF: toNumberRealizado(item.valorNF),
    percentualFrete: toNumberRealizado(item.percentualFrete),
    cepDestino: String(item.cepDestino || '').replace(/\D/g, ''),
    cepOrigem: String(item.cepOrigem || '').replace(/\D/g, ''),
    cidadeOrigem: normalizeTextRealizado(item.cidadeOrigem),
    cidadeDestino: normalizeTextRealizado(item.cidadeDestino),
    transportadoraContratada: normalizeTextRealizado(item.transportadoraContratada),
    prazoEntregaCliente: toNumberRealizado(item.prazoEntregaCliente),
    raw: item,
  };
}

function deduplicateRows(rows = []) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = row.chaveCte || `${row.numeroCte}|${row.emissao}|${row.valorCte}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


function calcularRefRealDaAba(sheet) {
  if (!sheet || typeof sheet !== 'object') return '';
  const refs = Object.keys(sheet).filter((key) => key && key[0] !== '!' && /^[A-Z]+\d+$/i.test(key));
  if (!refs.length) return sheet['!ref'] || '';

  let minR = Infinity;
  let minC = Infinity;
  let maxR = -1;
  let maxC = -1;

  refs.forEach((ref) => {
    const cell = XLSX.utils.decode_cell(ref);
    if (cell.r < minR) minR = cell.r;
    if (cell.c < minC) minC = cell.c;
    if (cell.r > maxR) maxR = cell.r;
    if (cell.c > maxC) maxC = cell.c;
  });

  if (!Number.isFinite(minR) || maxR < 0 || maxC < 0) return sheet['!ref'] || '';
  return XLSX.utils.encode_range({ s: { r: minR, c: minC }, e: { r: maxR, c: maxC } });
}

function corrigirRefDaAba(sheet) {
  if (!sheet) return { sheet, refOriginal: '', refCorrigida: '', corrigida: false };
  const refOriginal = sheet['!ref'] || '';
  const refCorrigida = calcularRefRealDaAba(sheet);
  if (refCorrigida && refCorrigida !== refOriginal) {
    sheet['!ref'] = refCorrigida;
    return { sheet, refOriginal, refCorrigida, corrigida: true };
  }
  return { sheet, refOriginal, refCorrigida: refOriginal, corrigida: false };
}

function contarLinhasPelaRef(ref = '') {
  if (!ref) return 0;
  try {
    const range = XLSX.utils.decode_range(ref);
    return Math.max(0, range.e.r - range.s.r + 1);
  } catch {
    return 0;
  }
}

function montarResumoExclusoes(ignorados = []) {
  const resumo = {};
  ignorados.forEach((row) => {
    const codigo = row.codigoExclusao || 'desconhecido';
    resumo[codigo] = (resumo[codigo] || 0) + 1;
  });
  return resumo;
}

export async function parseRealizadoCtesFile(file, opcoesImportacao) {
  const opcoes = opcoesImportacao || getOpcoesImportacaoPadrao();

  if (!file) {
    return {
      registros: [],
      ignorados: [],
      meta: { arquivo: '', linhasOriginais: 0, resumoExclusoes: {} },
    };
  }

  const buffer = await file.arrayBuffer();
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'array', cellDates: false, raw: false });
  } catch (e) {
    throw new Error(`Não consegui ler "${file.name || 'arquivo'}". Ele pode estar protegido por senha, corrompido ou num formato não suportado. Abra no Excel e salve como "Pasta de Trabalho do Excel (.xlsx)". Detalhe: ${e.message}`);
  }

  const nomesAbas = workbook?.SheetNames || [];
  const sheetName = nomesAbas.find((name) => normalizeHeaderRealizado(name) === 'registros') || nomesAbas[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;

  if (!sheet) {
    const detectadas = nomesAbas.length ? nomesAbas.join(', ') : '(nenhuma)';
    throw new Error(`Não encontrei nenhuma aba de dados em "${file.name || 'arquivo'}". Abas detectadas: ${detectadas}. Se o arquivo abre no Excel, salve novamente como "Pasta de Trabalho do Excel (.xlsx)" (não HTML/CSV renomeado) e tente de novo.`);
  }

  const refInfo = corrigirRefDaAba(sheet);
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false, blankrows: false });

  const normalizados = rows
    .map((row) => normalizeRegistro(row, file.name || ''))
    .filter((row) => row.chaveCte || row.numeroCte)
    .filter((row) => row.valorCte > 0 || row.valorNF > 0);

  // Politica: a base sobe COMPLETA — CP COMERCIAL, EBAZAR, CPS LOG e tomador vazio
  // tambem entram, para ficarem disponiveis em busca/filtro. A exclusao desses
  // passa a ser feita nas simulacoes/analises (com opt-in), nao no import.
  // `ignorados`/`resumoExclusoes` seguem so como informacao no relatorio.
  const { aceitos, ignorados } = particionarCtesPorPolitica(normalizados, opcoes);
  const registros = deduplicateRows(normalizados);
  const duplicados = Math.max(0, normalizados.length - registros.length);
  const resumoExclusoes = montarResumoExclusoes(ignorados);

  return {
    registros,
    ignorados,
    meta: {
      arquivo: file.name || '',
      tamanhoBytes: file.size || 0,
      aba: sheetName,
      refOriginal: refInfo.refOriginal,
      refCorrigida: refInfo.refCorrigida,
      refFoiCorrigida: refInfo.corrigida,
      linhasEstimadas: contarLinhasPelaRef(refInfo.refCorrigida),
      linhasOriginais: rows.length,
      registrosLidos: normalizados.length,
      registrosAntesTomador: normalizados.length,
      // A base sobe completa: nada e ignorado no import. O resumo abaixo e so
      // informativo (quantos de cada categoria especial entraram).
      registrosIgnoradosTomador: 0,
      registrosIgnorados: 0,
      duplicados,
      categoriasEspeciais: resumoExclusoes,
      resumoExclusoes: {},
      regraTomador: regraTomadorServicoRealizadoTexto(),
      registrosValidos: registros.length,
      registrosImportados: registros.length,
      opcoesImportacao: opcoes,
    },
  };
}

export function formatCurrency(value) {
  return (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatNumber(value, digits = 2) {
  return (Number(value) || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatPercent(value) {
  return `${formatNumber(value, 2)}%`;
}

export function formatDateBr(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('pt-BR');
}
