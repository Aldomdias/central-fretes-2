import * as XLSX from 'xlsx';
import { exportarTrackingLocal } from '../utils/trackingLocal';
import { exportarRealizadoLocal } from '../services/realizadoLocalDb';
import { relacionarTrackingComCtes } from '../utils/trackingCteLink';
import { carregarMunicipiosIbgeDb } from '../services/freteDatabaseService';
import { carregarMunicipiosIbgeOficial } from '../utils/ibgeMunicipiosOficial';
import { encontrarLinhaGradePorPeso } from '../utils/gradeFreteConfig';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const UF_POR_CODIGO_IBGE = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

const UF_POR_NOME = {
  ACRE: 'AC', ALAGOAS: 'AL', AMAPA: 'AP', AMAZONAS: 'AM', BAHIA: 'BA', CEARA: 'CE',
  DISTRITO_FEDERAL: 'DF', ESPIRITO_SANTO: 'ES', GOIAS: 'GO', MARANHAO: 'MA',
  MATO_GROSSO: 'MT', MATO_GROSSO_DO_SUL: 'MS', MINAS_GERAIS: 'MG', PARA: 'PA',
  PARAIBA: 'PB', PARANA: 'PR', PERNAMBUCO: 'PE', PIAUI: 'PI', RIO_DE_JANEIRO: 'RJ',
  RIO_GRANDE_DO_NORTE: 'RN', RIO_GRANDE_DO_SUL: 'RS', RONDONIA: 'RO', RORAIMA: 'RR',
  SANTA_CATARINA: 'SC', SAO_PAULO: 'SP', SERGIPE: 'SE', TOCANTINS: 'TO',
};

const UF_POR_CIDADE_ORIGEM = {
  ITAJAI: 'SC', ITAJAÍ: 'SC', ITUPEVA: 'SP', JABOATAO: 'PE', JABOATÃO: 'PE',
  JABOATAO_DOS_GUARARAPES: 'PE', JABOATÃO_DOS_GUARARAPES: 'PE', SERRA: 'ES',
  CONTAGEM: 'MG', GOIANIA: 'GO', GOIÂNIA: 'GO', RIBEIRAO: 'PE', RIBEIRÃO: 'PE',
};

const UF_POR_CENTRO_EXPEDICAO = {
  '4210': 'ES',
  '4200': 'SC',
  '4208': 'SC',
  '3500': 'SP',
  '2600': 'PE',
};

const CHUNK_SIZE = 5000;
const DETALHE_SHEET_LIMIT = 100000;
const SUPABASE_PAGE_SIZE = 300;
const SUPABASE_EXPORT_LIMIT_DEFAULT = 1000000;
const TABELA_TRACKING_SUPABASE = 'tracking_rows';
const TABELA_CTES_SUPABASE = 'realizado_local_ctes';

const TRACKING_SUPABASE_COLUMNS = [
  'id', 'data', 'competencia', 'nota_fiscal', 'chave_nfe', 'chave_cte', 'cte_numero',
  'pedido', 'pedido_erp', 'canal', 'canal_original', 'transportadora',
  'cidade_origem', 'uf_origem', 'ibge_origem', 'cidade_destino', 'uf_destino', 'ibge_destino',
  'chave_rota_ibge', 'peso', 'peso_declarado', 'peso_cubado', 'cubagem_unitaria', 'cubagem_total',
  'valor_nf', 'qtd_volumes', 'previsao_cliente', 'previsao_transportadora', 'data_transporte', 'data_entrega',
  'arquivo_origem', 'aba_origem', 'linha_excel', 'ibge_ok', 'raw', 'updated_at'
].join(',');

const CTE_SUPABASE_COLUMNS = [
  'id', 'competencia', 'data_emissao', 'chave_cte', 'numero_cte', 'transportadora',
  'cidade_origem', 'uf_origem', 'ibge_origem', 'cidade_destino', 'uf_destino', 'ibge_destino',
  'peso', 'peso_declarado', 'peso_cubado', 'cubagem', 'valor_nf', 'valor_cte',
  'qtd_volumes', 'canal', 'chave_rota_ibge', 'raw'
].join(',');

function postProgress(payload = {}) {
  self.postMessage({ type: 'progress', ...payload });
}

function waitFrame() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value).trim();
  if (!text) return 0;
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  const parsed = Number(normalized.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function onlyDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function normalizeToken(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function cleanUf(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const upper = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

  const siglaIsolada = upper.match(/(^|[^A-Z])([A-Z]{2})(?=$|[^A-Z])/);
  if (siglaIsolada && Object.values(UF_POR_NOME).includes(siglaIsolada[2])) return siglaIsolada[2];

  const token = normalizeToken(raw);
  if (UF_POR_NOME[token]) return UF_POR_NOME[token];

  const apenasLetras = upper.replace(/[^A-Z]/g, '');
  if (UF_POR_NOME[normalizeToken(apenasLetras)]) return UF_POR_NOME[normalizeToken(apenasLetras)];
  if (Object.values(UF_POR_NOME).includes(apenasLetras.slice(0, 2))) return apenasLetras.slice(0, 2);

  return '';
}

function getUfByIbge(ibge = '') {
  return UF_POR_CODIGO_IBGE[onlyDigits(ibge).slice(0, 2)] || '';
}

function normalizarCidade(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTransportadoraEbazarVolumetria(value = '') {
  return normalizarCidade(value).includes('EBAZAR');
}

function fallbackRaw(row = {}, key = '') {
  const raw = row.raw || {};
  return raw[key] ?? raw[key.toLowerCase()] ?? raw[key.toUpperCase()] ?? '';
}

function mapTrackingSupabaseRow(row = {}) {
  const raw = row.raw || {};
  const cubagemTotalFinal = toNumber(row.cubagem_total ?? raw.cubagemTotal ?? raw.Cubagem_Total_m3);
  const cubagemUnitaria = toNumber(row.cubagem_unitaria ?? raw.cubagem ?? raw.Cubagem_Unitaria_m3);
  const volumes = toNumber(row.qtd_volumes ?? raw.qtdVolumes ?? raw.Volumes);
  const data = row.data || raw.data || raw.Data || '';

  return {
    id: row.id || '',
    data,
    dataFaturamento: data,
    competencia: row.competencia || (data ? String(data).slice(0, 7) : ''),
    notaFiscal: row.nota_fiscal || raw.notaFiscal || raw['NF Numero'] || '',
    numeroNf: row.nota_fiscal || raw.numeroNf || raw['NF Numero'] || '',
    nfNumero: row.nota_fiscal || raw.nfNumero || raw['NF Numero'] || '',
    chaveNfe: row.chave_nfe || raw.chaveNfe || raw['NF Chave'] || '',
    chaveNf: row.chave_nfe || raw.chaveNf || raw['NF Chave'] || '',
    chaveCte: row.chave_cte || raw.chaveCte || '',
    cteNumero: row.cte_numero || raw.cteNumero || raw.cte || '',
    pedido: row.pedido || raw.pedido || '',
    pedidoErp: row.pedido_erp || raw.pedidoErp || raw['Pedido ERP'] || '',
    canal: row.canal || raw.canal || raw.Canal || '',
    canalOriginal: row.canal_original || raw.canalOriginal || raw.Canal || row.canal || '',
    loja: raw.loja || raw.Loja || '',
    transportadora: row.transportadora || raw.transportadora || raw.Transportadora || '',
    cidadeOrigem: row.cidade_origem || raw.cidadeOrigem || raw['Cidade de Origem'] || '',
    ufOrigem: row.uf_origem || raw.ufOrigem || '',
    ibgeOrigem: row.ibge_origem || raw.ibgeOrigem || '',
    cidadeDestino: row.cidade_destino || raw.cidadeDestino || raw['Cidade Destino'] || '',
    ufDestino: row.uf_destino || raw.ufDestino || raw['UF Destino'] || '',
    ibgeDestino: row.ibge_destino || raw.ibgeDestino || '',
    chaveRotaIbge: row.chave_rota_ibge || (row.ibge_origem && row.ibge_destino ? `${row.ibge_origem}-${row.ibge_destino}` : ''),
    peso: toNumber(row.peso ?? raw.peso),
    pesoDeclarado: toNumber(row.peso_declarado ?? raw.pesoDeclarado),
    pesoCubado: toNumber(row.peso_cubado ?? raw.pesoCubado),
    cubagem: cubagemUnitaria,
    cubagemUnitariaM3: cubagemUnitaria,
    cubagemTotalFinalM3: cubagemTotalFinal,
    cubagemTotalNfM3: cubagemTotalFinal || (cubagemUnitaria * Math.max(volumes || 1, 1)),
    valorNF: toNumber(row.valor_nf ?? raw.valorNF ?? raw['Valor da NF']),
    qtdVolumes: volumes,
    previsaoCliente: row.previsao_cliente || raw.previsaoCliente || '',
    prevTransportadora: row.previsao_transportadora || raw.prevTransportadora || '',
    dataTransporte: row.data_transporte || raw.dataTransporte || '',
    entrega: row.data_entrega || raw.entrega || '',
    arquivoOrigem: row.arquivo_origem || raw.arquivoOrigem || '',
    abaOrigem: row.aba_origem || raw.abaOrigem || '',
    linhaExcel: toNumber(row.linha_excel ?? raw.linhaExcel),
    ibgeOk: Boolean(row.ibge_ok || (row.ibge_origem && row.ibge_destino)),
    raw,
    fonteVolumetria: 'supabase_tracking',
  };
}

function mapCteSupabaseRow(row = {}) {
  const raw = row.raw || {};
  const data = row.data_emissao || raw.dataEmissao || raw.emissao || '';
  return {
    id: row.id || '',
    competencia: row.competencia || (data ? String(data).slice(0, 7) : ''),
    dataEmissao: data,
    chaveCte: row.chave_cte || raw.chaveCte || '',
    numeroCte: row.numero_cte || raw.numeroCte || '',
    cteNumero: row.numero_cte || raw.cteNumero || raw.cte || '',
    transportadora: row.transportadora || raw.transportadora || '',
    cidadeOrigem: row.cidade_origem || raw.cidadeOrigem || '',
    ufOrigem: row.uf_origem || raw.ufOrigem || '',
    ibgeOrigem: row.ibge_origem || raw.ibgeOrigem || '',
    cidadeDestino: row.cidade_destino || raw.cidadeDestino || '',
    ufDestino: row.uf_destino || raw.ufDestino || '',
    ibgeDestino: row.ibge_destino || raw.ibgeDestino || '',
    peso: toNumber(row.peso ?? raw.peso),
    pesoDeclarado: toNumber(row.peso_declarado ?? raw.pesoDeclarado),
    pesoCubado: toNumber(row.peso_cubado ?? raw.pesoCubado),
    cubagem: toNumber(row.cubagem ?? raw.cubagem),
    valorNF: toNumber(row.valor_nf ?? raw.valorNF),
    valorCte: toNumber(row.valor_cte ?? raw.valorCte),
    qtdVolumes: toNumber(row.qtd_volumes ?? raw.qtdVolumes),
    canal: row.canal || raw.canal || '',
    chaveRotaIbge: row.chave_rota_ibge || (row.ibge_origem && row.ibge_destino ? `${row.ibge_origem}-${row.ibge_destino}` : ''),
    raw,
  };
}

function safeSheetName(nome) {
  return String(nome || 'Planilha').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Planilha';
}

function columnWidth(header = '') {
  const h = String(header || '');
  if (h.includes('Chave') || h.includes('CHAVE')) return { wch: 44 };
  if (h.includes('Observacao') || h.includes('Observação')) return { wch: 42 };
  if (h.includes('Transportadora')) return { wch: 34 };
  if (h.includes('Origem') || h.includes('Destino')) return { wch: 28 };
  if (h.includes('IBGE')) return { wch: 14 };
  if (h.includes('Faixa')) return { wch: 18 };
  if (h.includes('Data')) return { wch: 14 };
  if (h.includes('Valor') || h.includes('Frete')) return { wch: 18 };
  return { wch: Math.min(Math.max(h.length + 4, 12), 28) };
}

function aplicarFormatoPlanilhaBasico(ws, rows = []) {
  if (!rows?.length) return;
  const headers = Object.keys(rows[0] || {});
  if (!headers.length) return;
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  ws['!autofilter'] = { ref: XLSX.utils.encode_range(range) };
  ws['!views'] = [{ state: 'frozen', ySplit: 1 }];
  ws['!cols'] = headers.map(columnWidth);
}

function appendJsonSheet(wb, nome, rows = []) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const ws = XLSX.utils.json_to_sheet(safeRows);
  aplicarFormatoPlanilhaBasico(ws, safeRows);
  XLSX.utils.book_append_sheet(wb, ws, safeSheetName(nome));
}

function pesoConsiderado(row = {}) {
  return Math.max(toNumber(row.peso), toNumber(row.pesoDeclarado), toNumber(row.pesoCubado));
}

function qtdVolumes(row = {}) {
  return toNumber(row.qtdVolumes || row.totalUnidades || row.quantidadeItens);
}

function cubagemUnitaria(row = {}) {
  return toNumber(row.cubagem ?? row.cubagemUnitaria ?? row.m3);
}

function cubagemTotalNf(row = {}) {
  const cubagemFinal = toNumber(row.cubagemTotalFinalM3 ?? row.cubagemTotalNfM3 ?? row.cubagem_total ?? row.cubagemTotal);
  if (cubagemFinal > 0) return cubagemFinal;
  const cubagem = cubagemUnitaria(row);
  const volumes = qtdVolumes(row);
  return cubagem * (volumes > 0 ? volumes : 1);
}

function valorFreteTracking(row = {}) {
  return toNumber(row.valorCalculadoFrete ?? row.valorFrete ?? row.valorCte);
}

function valorNfBruto(row = {}) {
  return toNumber(row.valorNF ?? row.valorNf ?? row.valorNota);
}

function valorNfMercadoria(row = {}) {
  const bruto = valorNfBruto(row);
  const frete = valorFreteTracking(row);
  if (bruto > 0 && frete > 0 && bruto >= frete) return bruto - frete;
  return bruto;
}

function corrigirMojibakeCanal(value = '') {
  return String(value || '')
    .replace(/ItaÃº/gi, 'Itaú')
    .replace(/ItaÃš/gi, 'Itaú')
    .replace(/ItaÃº Shop/gi, 'Itaú Shop');
}

function normalizarCanalTexto(value = '') {
  return corrigirMojibakeCanal(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CANAIS_B2C_VOLUMETRIA = [
  'B2C',
  'MERCADO LIVRE',
  'MERCADOR LIVRE',
  'SHOPEE',
  'MAGAZINE LUIZA',
  'MAGAZINE',
  'MAGALU',
  'AMAZON',
  'INTER',
  'VIA VAREJO',
  'CARREFOUR',
  'CANTU PNEUS',
  'ITAU SHOP',
  'ITAÚ SHOP',
  '99',
  'MUSTANG',
  'LIVELO',
  'BRADESCO SHOP',
  'COOPERA',
  'ECOMMERCE',
  'E COMMERCE',
  'E-COMMERCE',
  'MARKETPLACE',
  'MARKET PLACE',
  'ANYMARKET',
  'ANY MARKET',
  'ME2',
];

const CANAIS_ATACADO_VOLUMETRIA = [
  'ATACADO',
  'B2B',
  'B 2 B',
  'WHOLESALE',
  'REVENDA',
];

function contemCanalVolumetria(canal = '', lista = []) {
  return lista.some((item) => canal === item || canal.includes(item));
}

function normalizarCanalVolumetria(row = {}) {
  const fontesFortes = [
    row.canalOriginal,
    row.loja,
    row.segmento,
    row.tipoMovimentacao,
    row.tipoOrdem,
    row.modelo,
    row.modoEnvio,
    row.regiao,
    row.transportadoraOriginal,
    row.transportadoraContratada,
  ].map(normalizarCanalTexto).filter(Boolean);

  // Primeiro respeita a lista oficial B2C enviada. Isso evita Cantu Pneus cair como Atacado.
  if (fontesFortes.some((canal) => contemCanalVolumetria(canal, CANAIS_B2C_VOLUMETRIA))) return 'B2C';
  if (fontesFortes.some((canal) => contemCanalVolumetria(canal, CANAIS_ATACADO_VOLUMETRIA))) return 'ATACADO';

  const canalAtual = normalizarCanalTexto(row.canal);
  if (contemCanalVolumetria(canalAtual, CANAIS_B2C_VOLUMETRIA)) return 'B2C';
  if (contemCanalVolumetria(canalAtual, CANAIS_ATACADO_VOLUMETRIA)) return 'ATACADO';
  return row.canal || '';
}

function inferirUfOrigemRapida(row = {}) {
  const uf = cleanUf(row.ufOrigem) || getUfByIbge(row.ibgeOrigem);
  if (uf) return uf;
  const cidadeKey = normalizeToken(row.cidadeOrigem).replace(/_/g, '_');
  if (UF_POR_CIDADE_ORIGEM[cidadeKey]) return UF_POR_CIDADE_ORIGEM[cidadeKey];
  const centro = onlyDigits(row.centroExpedicao || row.cdOrigem).slice(0, 4);
  return UF_POR_CENTRO_EXPEDICAO[centro] || '';
}

function inferirUfDestinoRapida(row = {}) {
  return cleanUf(row.ufDestino)
    || getUfByIbge(row.ibgeDestino)
    || cleanUf(row.regiaoDestino)
    || cleanUf(row.cidadeDestino);
}

function normalizarLinhaVolumetria(row = {}) {
  return {
    ...row,
    canal: normalizarCanalVolumetria(row),
    ufOrigem: inferirUfOrigemRapida(row),
    ufDestino: inferirUfDestinoRapida(row),
    qtdVolumes: qtdVolumes(row),
    cubagemUnitariaM3: cubagemUnitaria(row),
    cubagemTotalNfM3: cubagemTotalNf(row),
    valorNfBrutoTracking: valorNfBruto(row),
    valorFreteTracking: valorFreteTracking(row),
    valorNfMercadoria: valorNfMercadoria(row),
  };
}

function formatarPesoFaixa(value = 0) {
  const numero = Number(value || 0);
  return numero.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

function faixaVolumetria(canal, peso, grade = {}) {
  const canalNorm = String(canal || '').toUpperCase() === 'B2C' ? 'B2C' : 'ATACADO';
  const gradeCanal = (Array.isArray(grade[canalNorm]) ? grade[canalNorm] : [])
    .map((item) => ({ ...item, peso: toNumber(item?.peso) }))
    .filter((item) => item.peso > 0)
    .sort((a, b) => a.peso - b.peso);

  const linha = encontrarLinhaGradePorPeso(gradeCanal, peso);
  if (!linha) return '';

  const limite = Number(linha.peso || 0);
  if (!limite) return '';

  if (limite >= 999999) {
    const anterior = [...gradeCanal].reverse().find((item) => item.peso > 0 && item.peso < 999999)?.peso;
    return `${formatarPesoFaixa(anterior || 100)}+ kg`;
  }

  return `Até ${formatarPesoFaixa(limite)} kg`;
}

function chaveVolumetria(row = {}, agrupamento, faixa, incluirIbge = false) {
  if (agrupamento === 'estado') return [row.canal, row.ufOrigem, row.ufDestino, faixa].join('|');
  if (incluirIbge && agrupamento === 'ibge') return [row.canal, row.ibgeOrigem, row.ibgeDestino, faixa].join('|');
  if (incluirIbge && agrupamento === 'cidade_ibge') {
    return [
      row.canal,
      row.cidadeOrigem,
      row.ufOrigem,
      row.ibgeOrigem,
      row.cidadeDestino,
      row.ufDestino,
      row.ibgeDestino,
      faixa,
    ].join('|');
  }

  return [
    row.canal,
    row.cidadeOrigem,
    row.ufOrigem,
    row.cidadeDestino,
    row.ufDestino,
    faixa,
  ].join('|');
}

function linhaInicial(row = {}, agrupamento, faixa, incluirIbge = false) {
  const base = {
    Canal: row.canal || '',
    Faixa_Peso: faixa,
    Notas: 0,
    Volumes: 0,
    Peso_Real: 0,
    Peso_Declarado: 0,
    Peso_Cubado: 0,
    Peso_Considerado: 0,
    Cubagem_Total_m3: 0,
    Valor_NF: 0,
  };

  if (agrupamento === 'estado') {
    return {
      ...base,
      UF_Origem: row.ufOrigem || '',
      UF_Destino: row.ufDestino || '',
    };
  }

  if (incluirIbge && agrupamento === 'ibge') {
    return {
      ...base,
      IBGE_Origem: row.ibgeOrigem || '',
      IBGE_Destino: row.ibgeDestino || '',
    };
  }

  const linha = {
    ...base,
    Origem: row.cidadeOrigem || '',
    UF_Origem: row.ufOrigem || '',
    Destino: row.cidadeDestino || '',
    UF_Destino: row.ufDestino || '',
  };

  if (incluirIbge && agrupamento === 'cidade_ibge') {
    linha.IBGE_Origem = row.ibgeOrigem || '';
    linha.IBGE_Destino = row.ibgeDestino || '';
  }

  return linha;
}

function addLocalidade(cidadeRaw, ufRaw, ibgeRaw, maps, fonte = 'base') {
  const cidade = String(cidadeRaw || '').trim();
  const cidadeKey = normalizarCidade(cidade);
  if (!cidadeKey) return;

  const ibge = onlyDigits(ibgeRaw).slice(0, 7);
  const uf = cleanUf(ufRaw) || getUfByIbge(ibge);
  if (!uf && !ibge) return;

  const localidade = {
    cidade,
    uf,
    ibge,
    fonte,
    score: (uf ? 1 : 0) + (ibge ? 2 : 0),
  };

  const listaCidade = maps.porCidade.get(cidadeKey) || [];
  listaCidade.push(localidade);
  maps.porCidade.set(cidadeKey, listaCidade);

  if (uf) {
    const chaveCidadeUf = `${cidadeKey}|${uf}`;
    const listaCidadeUf = maps.porCidadeUf.get(chaveCidadeUf) || [];
    listaCidadeUf.push(localidade);
    maps.porCidadeUf.set(chaveCidadeUf, listaCidadeUf);
  }

  if (ibge && !maps.porIbge.has(ibge)) maps.porIbge.set(ibge, localidade);
}

async function criarMapasLocalidades(rows = [], municipios = [], progressBase = 0, progressRange = 1) {
  const maps = {
    porCidade: new Map(),
    porCidadeUf: new Map(),
    porIbge: new Map(),
  };

  for (let index = 0; index < (municipios || []).length; index += 1) {
    const item = municipios[index];
    const ibge = onlyDigits(item.ibge || item.codigo_ibge || item.codigo || item.codigoMunicipio || '').slice(0, 7);
    const cidade = item.cidade || item.nome || item.municipio || item.nomeMunicipio || '';
    const uf = item.uf || item.estado || getUfByIbge(ibge);
    addLocalidade(cidade, uf, ibge, maps, 'municipios');
    if (index > 0 && index % CHUNK_SIZE === 0) await waitFrame();
  }

  for (let index = 0; index < (rows || []).length; index += 1) {
    const row = rows[index];
    addLocalidade(row.cidadeOrigem, row.ufOrigem, row.ibgeOrigem, maps, 'tracking/cte');
    addLocalidade(row.cidadeDestino, row.ufDestino, row.ibgeDestino, maps, 'tracking/cte');
    if (index > 0 && index % CHUNK_SIZE === 0) {
      postProgress({ percentual: progressBase + Math.round((index / rows.length) * progressRange), mensagem: `Preparando mapa de cidades/IBGE: ${index.toLocaleString('pt-BR')} linha(s)...` });
      await waitFrame();
    }
  }

  return maps;
}

function escolherMelhorLocalidade(candidatos = []) {
  const validos = (candidatos || [])
    .filter((item) => item && (item.uf || item.ibge))
    .map((item) => ({
      ...item,
      uf: cleanUf(item.uf) || getUfByIbge(item.ibge),
      ibge: onlyDigits(item.ibge).slice(0, 7),
    }))
    .filter((item) => item.uf || item.ibge);

  if (!validos.length) return null;

  const porAssinatura = new Map();
  validos.forEach((item) => {
    const assinatura = `${item.uf || ''}|${item.ibge || ''}`;
    const atual = porAssinatura.get(assinatura) || { ...item, count: 0, scoreTotal: 0 };
    atual.count += 1;
    atual.scoreTotal += Number(item.score || 0);
    porAssinatura.set(assinatura, atual);
  });

  const opcoes = [...porAssinatura.values()]
    .sort((a, b) => b.scoreTotal - a.scoreTotal || b.count - a.count);

  if (opcoes.length === 1) return opcoes[0];

  const completas = opcoes.filter((item) => item.uf && item.ibge);
  const assinaturasCompletas = new Set(completas.map((item) => `${item.uf}|${item.ibge}`));
  if (assinaturasCompletas.size === 1) return completas[0];

  return null;
}

function completarLocalidade(row = {}, prefixo, maps) {
  const cidadeCampo = prefixo === 'Origem' ? 'cidadeOrigem' : 'cidadeDestino';
  const ufCampo = prefixo === 'Origem' ? 'ufOrigem' : 'ufDestino';
  const ibgeCampo = prefixo === 'Origem' ? 'ibgeOrigem' : 'ibgeDestino';

  const cidade = String(row[cidadeCampo] || '').trim();
  const cidadeKey = normalizarCidade(cidade);
  let uf = cleanUf(row[ufCampo]);
  let ibge = onlyDigits(row[ibgeCampo]).slice(0, 7);

  const campos = [];

  if (ibge && !uf) {
    uf = getUfByIbge(ibge);
    if (uf) campos.push(`${ufCampo}=IBGE`);
  }

  if (cidadeKey) {
    let escolhido = null;
    if (uf) escolhido = escolherMelhorLocalidade(maps.porCidadeUf.get(`${cidadeKey}|${uf}`) || []);
    if (!escolhido) escolhido = escolherMelhorLocalidade(maps.porCidade.get(cidadeKey) || []);

    if (escolhido) {
      if (!uf && escolhido.uf) {
        uf = escolhido.uf;
        campos.push(`${ufCampo}=recorrencia`);
      }
      if (!ibge && escolhido.ibge) {
        ibge = escolhido.ibge;
        campos.push(`${ibgeCampo}=recorrencia`);
      }
    }
  }

  const complementosAnteriores = String(row.camposComplementadosPorRecorrencia || '').trim();
  const complementos = [...new Set([
    ...complementosAnteriores.split(' | ').filter(Boolean),
    ...campos,
  ])].join(' | ');

  return {
    ...row,
    [ufCampo]: uf,
    [ibgeCampo]: ibge,
    camposComplementadosPorRecorrencia: complementos,
    enderecoComplementadoPorRecorrencia: Boolean(complementos),
  };
}

async function carregarMunicipiosSeguro({ permitirOnline = false } = {}) {
  let municipiosDb = [];
  try {
    const municipios = await carregarMunicipiosIbgeDb();
    municipiosDb = Array.isArray(municipios) ? municipios : [];
    if (municipiosDb.length >= 5000 || !permitirOnline) return municipiosDb;
  } catch {
    municipiosDb = [];
  }

  if (!permitirOnline) return municipiosDb;

  try {
    const resultado = await carregarMunicipiosIbgeOficial({ usarCache: true });
    if (Array.isArray(resultado?.municipios) && resultado.municipios.length >= municipiosDb.length) {
      return resultado.municipios;
    }
  } catch {
    // Se não conseguir buscar a base oficial, segue com a base local/Supabase que estiver disponível.
  }

  return municipiosDb;
}

function criarMapaCidadeUf(municipios = []) {
  const mapa = new Map();

  (municipios || []).forEach((item) => {
    const cidade = item.cidade || item.nome || item.municipio || item.nomeMunicipio || '';
    const cidadeKey = normalizarCidade(cidade);
    const ibge = onlyDigits(item.ibge || item.codigo_ibge || item.codigo || item.codigoMunicipio || '').slice(0, 7);
    const uf = cleanUf(item.uf || item.estado) || getUfByIbge(ibge);
    if (!cidadeKey || !uf) return;

    if (!mapa.has(cidadeKey)) mapa.set(cidadeKey, new Set());
    mapa.get(cidadeKey).add(uf);
  });

  return mapa;
}

function inferirUfComMapaCidade({ cidade, ufAtual, ibge, mapaCidadeUf, ufPreferida }) {
  const ufExistente = cleanUf(ufAtual) || getUfByIbge(ibge);
  if (ufExistente) return ufExistente;

  const cidadeKey = normalizarCidade(cidade);
  const opcoes = mapaCidadeUf?.get(cidadeKey);
  if (!opcoes || !opcoes.size) return '';

  const preferida = cleanUf(ufPreferida);
  if (preferida && opcoes.has(preferida)) return preferida;

  if (opcoes.size === 1) return [...opcoes][0];
  return '';
}

async function completarUfVolumetriaSemIbge(rows = [], config = {}) {
  const precisaMelhorarUf = Boolean(config.ufOrigem || config.ufDestino)
    || (rows || []).some((row) => !cleanUf(row.ufOrigem) || !cleanUf(row.ufDestino));

  if (!precisaMelhorarUf) return rows;

  postProgress({ percentual: 36, mensagem: 'Modo rápido: normalizando UF por cidade, sem exportar colunas IBGE...' });
  const municipios = await carregarMunicipiosSeguro({ permitirOnline: true });
  const mapaCidadeUf = criarMapaCidadeUf(municipios);

  if (!mapaCidadeUf.size) return rows;

  const ufOrigemFiltro = cleanUf(config.ufOrigem);
  const ufDestinoFiltro = cleanUf(config.ufDestino);

  const resultado = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const ufOrigem = inferirUfComMapaCidade({
      cidade: row.cidadeOrigem,
      ufAtual: row.ufOrigem,
      ibge: row.ibgeOrigem,
      mapaCidadeUf,
      ufPreferida: ufOrigemFiltro,
    });
    const ufDestino = inferirUfComMapaCidade({
      cidade: row.cidadeDestino,
      ufAtual: row.ufDestino,
      ibge: row.ibgeDestino,
      mapaCidadeUf,
      ufPreferida: ufDestinoFiltro,
    });

    resultado.push({
      ...row,
      ufOrigem: ufOrigem || row.ufOrigem || '',
      ufDestino: ufDestino || row.ufDestino || '',
      ufOrigemInferidaSemIbge: !cleanUf(row.ufOrigem) && Boolean(ufOrigem),
      ufDestinoInferidaSemIbge: !cleanUf(row.ufDestino) && Boolean(ufDestino),
    });

    if (index > 0 && index % CHUNK_SIZE === 0) {
      postProgress({ percentual: 36 + Math.round((index / rows.length) * 8), mensagem: `Normalizando UF sem IBGE: ${index.toLocaleString('pt-BR')} linha(s)...` });
      await waitFrame();
    }
  }

  return resultado;
}

async function completarGeografiaVolumetria(rows = []) {
  postProgress({ percentual: 35, mensagem: 'Carregando base de municípios para completar UF/IBGE...' });
  const municipios = await carregarMunicipiosSeguro({ permitirOnline: true });

  postProgress({ percentual: 38, mensagem: 'Preparando mapa de cidades e IBGE...' });
  let maps = await criarMapasLocalidades(rows, municipios, 38, 8);

  const preenchidas = [];
  for (let index = 0; index < (rows || []).length; index += 1) {
    const origem = completarLocalidade(rows[index], 'Origem', maps);
    preenchidas.push(completarLocalidade(origem, 'Destino', maps));
    if (index > 0 && index % CHUNK_SIZE === 0) {
      postProgress({ percentual: 46 + Math.round((index / rows.length) * 10), mensagem: `Completando UF/IBGE: ${index.toLocaleString('pt-BR')} linha(s)...` });
      await waitFrame();
    }
  }

  postProgress({ percentual: 58, mensagem: 'Refinando recorrência de cidades e IBGE...' });
  maps = await criarMapasLocalidades(preenchidas, municipios, 58, 5);

  const resultado = [];
  for (let index = 0; index < preenchidas.length; index += 1) {
    const origem = completarLocalidade(preenchidas[index], 'Origem', maps);
    const destino = completarLocalidade(origem, 'Destino', maps);
    const chaveRotaIbge = destino.ibgeOrigem && destino.ibgeDestino
      ? `${destino.ibgeOrigem}-${destino.ibgeDestino}`
      : '';
    resultado.push({ ...destino, chaveRotaIbge });
    if (index > 0 && index % CHUNK_SIZE === 0) {
      postProgress({ percentual: 63 + Math.round((index / preenchidas.length) * 7), mensagem: `Refinando UF/IBGE: ${index.toLocaleString('pt-BR')} linha(s)...` });
      await waitFrame();
    }
  }

  return resultado;
}

function aplicarFiltrosFinais(rows = [], config = {}) {
  const canalFiltro = String(config.canal || '').toUpperCase();
  const origemFiltro = normalizarCidade(config.origem);
  const ufOrigemFiltro = cleanUf(config.ufOrigem);
  const ufDestinoFiltro = cleanUf(config.ufDestino);

  return (rows || []).map(normalizarLinhaVolumetria).filter((row) => {
    if (canalFiltro && String(row.canal || '').toUpperCase() !== canalFiltro) return false;
    if (origemFiltro && !normalizarCidade(row.cidadeOrigem).includes(origemFiltro)) return false;
    if (ufOrigemFiltro && cleanUf(row.ufOrigem) !== ufOrigemFiltro) return false;
    if (ufDestinoFiltro && cleanUf(row.ufDestino) !== ufDestinoFiltro) return false;
    return true;
  });
}

async function montarVolumetria(rows = [], config = {}, grade = {}) {
  const mapa = new Map();

  for (let index = 0; index < rows.length; index += 1) {
    const row = normalizarLinhaVolumetria(rows[index]);
    const canal = String(row.canal || '').toUpperCase();
    const peso = pesoConsiderado(row);
    const faixa = canal === 'B2C' || canal === 'ATACADO' ? faixaVolumetria(canal, peso, grade) : '';
    const chave = chaveVolumetria(row, config.agrupamento, faixa, Boolean(config.incluirIbge));

    if (!mapa.has(chave)) mapa.set(chave, linhaInicial(row, config.agrupamento, faixa, Boolean(config.incluirIbge))); 

    const item = mapa.get(chave);
    item.Notas += 1;
    item.Volumes += toNumber(row.qtdVolumes);
    item.Peso_Real += toNumber(row.peso);
    item.Peso_Declarado += toNumber(row.pesoDeclarado);
    item.Peso_Cubado += toNumber(row.pesoCubado);
    item.Peso_Considerado += peso;
    item.Cubagem_Total_m3 += cubagemTotalNf(row);
    item.Valor_NF += valorNfMercadoria(row);

    if (index > 0 && index % CHUNK_SIZE === 0) {
      postProgress({ percentual: 72 + Math.round((index / rows.length) * 12), mensagem: `Agrupando volumetria: ${index.toLocaleString('pt-BR')} linha(s)...` });
      await waitFrame();
    }
  }

  return [...mapa.values()]
    .map((item) => ({
      ...item,
      Media_Peso_Nota: item.Notas ? item.Peso_Considerado / item.Notas : 0,
      Media_Volumes_Nota: item.Notas ? item.Volumes / item.Notas : 0,
      Media_Cubagem_Nota: item.Notas ? item.Cubagem_Total_m3 / item.Notas : 0,
      Media_Valor_NF_Nota: item.Notas ? item.Valor_NF / item.Notas : 0,
    }))
    .sort((a, b) => String(a.UF_Destino || a.IBGE_Destino || '').localeCompare(String(b.UF_Destino || b.IBGE_Destino || '')) || String(a.Destino || '').localeCompare(String(b.Destino || '')));
}

function detalheTrackingRow(row = {}, grade = {}, incluirIbge = false) {
  row = normalizarLinhaVolumetria(row);
  const canal = String(row.canal || '').toUpperCase();
  const peso = pesoConsiderado(row);

  const detalhe = {
    Nota_Fiscal: row.notaFiscal || row.numeroNf || row.nfNumero || '',
    Pedido: row.pedido || '',
    Data: row.data || row.dataFaturamento || '',
    Canal: row.canal || '',
    Canal_Original: row.canalOriginal || '',
    Origem: row.cidadeOrigem || '',
    UF_Origem: row.ufOrigem || '',
    Destino: row.cidadeDestino || '',
    UF_Destino: row.ufDestino || '',
    Faixa_Peso: canal === 'B2C' || canal === 'ATACADO' ? faixaVolumetria(canal, peso, grade) : '',
    Volumes: toNumber(row.qtdVolumes),
    Peso_Real: toNumber(row.peso),
    Peso_Declarado: toNumber(row.pesoDeclarado),
    Peso_Cubado: toNumber(row.pesoCubado),
    Peso_Considerado: peso,
    Cubagem_Unitaria_m3: cubagemUnitaria(row),
    Cubagem_Total_m3: cubagemTotalNf(row),
    Valor_NF: valorNfMercadoria(row),
  };

  if (incluirIbge) {
    detalhe.IBGE_Origem = row.ibgeOrigem || '';
    detalhe.IBGE_Destino = row.ibgeDestino || '';
    detalhe.Complementado_CTE = row.enderecoComplementadoPorCte ? 'Sim' : 'Não';
    detalhe.Complementado_Recorrencia = row.enderecoComplementadoPorRecorrencia ? 'Sim' : 'Não';
    detalhe.Campos_Complementados = [row.camposComplementadosPorCte, row.camposComplementadosPorRecorrencia].filter(Boolean).join(' | ');
  }

  return detalhe;
}

async function montarDetalhes(rows = [], grade = {}, incluirIbge = false) {
  const detalhes = [];
  for (let index = 0; index < rows.length; index += 1) {
    detalhes.push(detalheTrackingRow(rows[index], grade, incluirIbge));
    if (index > 0 && index % CHUNK_SIZE === 0) {
      postProgress({ percentual: 84 + Math.round((index / rows.length) * 6), mensagem: `Preparando detalhe por nota: ${index.toLocaleString('pt-BR')} linha(s)...` });
      await waitFrame();
    }
  }
  return detalhes;
}

function normalizarConfigVolumetria(config = {}) {
  const incluirIbge = Boolean(config.incluirIbge);
  let agrupamento = config.agrupamento || 'cidade';

  if (!incluirIbge && ['ibge', 'cidade_ibge'].includes(agrupamento)) {
    agrupamento = 'cidade';
  }

  const somenteComCteVinculado = Boolean(config.somenteComCteVinculado);

  return {
    ...config,
    incluirIbge,
    agrupamento,
    vincularCtes: Boolean(config.vincularCtes || somenteComCteVinculado),
    somenteComCteVinculado,
  };
}

function buildResumoRows({ config, rowsBase, volumetria, totalCompativel, limit, resumoVinculo, diagnostico, fonteBase }) {
  return [{
    Canal: config.canal || 'Todos',
    Periodo_Inicial: config.inicio || 'Todos',
    Periodo_Final: config.fim || 'Todos',
    Origem: config.origem || 'Todas',
    UF_Origem: config.ufOrigem || 'Todas',
    UF_Destino: config.ufDestino || 'Todas',
    Agrupamento: config.agrupamento,
    Modo_IBGE: config.incluirIbge ? 'Com IBGE' : 'Sem IBGE',
    Fonte_Base: fonteBase || 'Supabase Tracking',
    Notas_Exportadas: rowsBase.length,
    Linhas_Volumetria: volumetria.length,
    Linhas_Antes_Filtros_Finais: diagnostico?.linhasAntesFiltrosFinais ?? '',
    Sem_UF_Origem_Antes_Filtro: diagnostico?.semUfOrigemAntes ?? '',
    Sem_UF_Destino_Antes_Filtro: diagnostico?.semUfDestinoAntes ?? '',
    Total_Compativel_Antes_Filtros_Finais: totalCompativel || rowsBase.length,
    Limite_Leitura: limit || '',
    Vinculo_CTE_Ativo: config.vincularCtes ? 'Sim' : 'Não',
    Somente_Com_CTE_Vinculado: config.somenteComCteVinculado ? 'Sim' : 'Não',
    CTEs_Vinculados: resumoVinculo?.vinculadas || 0,
    CTEs_Sem_Vinculo: resumoVinculo?.semVinculo || 0,
    Detalhe_por_Nota: config.incluirDetalhe ? 'Sim' : 'Não',
    Regra_Cubagem: 'Cubagem final do Tracking: usa cubagem_total do Supabase quando existir; senão cubagem unitária × volumes',
    Regra_Valor_NF: 'Valor_NF = Valor NF bruto - Valor do frete/calculado, quando houver',
    Regra_UF_Modo_Rapido: 'Sem IBGE: usa UF do Tracking; se faltar, tenta inferir pela cidade e pela UF filtrada, sem exportar IBGE',
  }];
}

function contarSemUf(rows = []) {
  return (rows || []).reduce((acc, row) => {
    if (!cleanUf(row.ufOrigem)) acc.semUfOrigem += 1;
    if (!cleanUf(row.ufDestino)) acc.semUfDestino += 1;
    if (row.ufOrigemInferidaSemIbge) acc.ufOrigemInferida += 1;
    if (row.ufDestinoInferidaSemIbge) acc.ufDestinoInferida += 1;
    return acc;
  }, { semUfOrigem: 0, semUfDestino: 0, ufOrigemInferida: 0, ufDestinoInferida: 0 });
}


function aplicarFiltrosBaseVolumetria(rows = [], filtros = {}) {
  const origemFiltro = normalizarCidade(filtros.origem);
  return (rows || []).filter((row) => {
    if (filtros.inicio && (!row.data || String(row.data).slice(0, 10) < filtros.inicio)) return false;
    if (filtros.fim && (!row.data || String(row.data).slice(0, 10) > filtros.fim)) return false;
    if (filtros.excluirEbazar && isTransportadoraEbazarVolumetria(row.transportadora)) return false;
    if (origemFiltro && !normalizarCidade(row.cidadeOrigem).includes(origemFiltro)) return false;
    return true;
  });
}

function toIsoDateOnly(value) {
  const texto = String(value || '').slice(0, 10);
  return /^20\d{2}-\d{2}-\d{2}$/.test(texto) ? texto : '';
}

function addDaysIso(dateIso, days) {
  const data = new Date(`${dateIso}T00:00:00`);
  data.setDate(data.getDate() + days);
  return data.toISOString().slice(0, 10);
}

function criarJanelasPeriodo(inicio, fim, diasPorJanela = 15) {
  const start = toIsoDateOnly(inicio);
  const end = toIsoDateOnly(fim);
  if (!start || !end || start > end) return [{ inicio: start || '', fim: end || '' }];

  const janelas = [];
  let atual = start;
  while (atual <= end) {
    const proximoFim = addDaysIso(atual, diasPorJanela - 1);
    const fimJanela = proximoFim > end ? end : proximoFim;
    janelas.push({ inicio: atual, fim: fimJanela });
    atual = addDaysIso(fimJanela, 1);
  }
  return janelas;
}

function aplicarFiltrosSqlBasicos(query, filtros = {}, colunaData = 'data') {
  if (filtros.inicio) query = query.gte(colunaData, filtros.inicio);
  if (filtros.fim) query = query.lte(colunaData, filtros.fim);
  if (filtros.canal) query = query.eq('canal', String(filtros.canal || '').toUpperCase());
  if (filtros.ufOrigem) query = query.eq('uf_origem', cleanUf(filtros.ufOrigem));
  if (filtros.ufDestino) query = query.eq('uf_destino', cleanUf(filtros.ufDestino));
  // Não filtramos cidade_origem com ILIKE no SQL porque isso causou timeout em períodos grandes.
  // A origem continua sendo filtrada em memória após páginas menores por data/UF/canal.
  return query;
}

function criarQueryTrackingSupabase(supabase, filtros = {}) {
  return aplicarFiltrosSqlBasicos(
    supabase.from(TABELA_TRACKING_SUPABASE).select(TRACKING_SUPABASE_COLUMNS),
    filtros,
    'data'
  );
}

async function buscarPaginasSupabase({ supabase, tabelaDescricao, criarQuery, mapRow, filtros = {}, options = {}, percentualInicio = 5, percentualFim = 20 }) {
  const limit = Number(options.limit || SUPABASE_EXPORT_LIMIT_DEFAULT);
  const pageSize = Number(options.pageSize || SUPABASE_PAGE_SIZE);
  const rows = [];
  let totalAvaliado = 0;
  const janelas = criarJanelasPeriodo(filtros.inicio, filtros.fim, Number(options.diasPorJanela || 7));

  for (let janelaIndex = 0; janelaIndex < janelas.length && rows.length < limit; janelaIndex += 1) {
    const janela = janelas[janelaIndex];
    const filtrosJanela = { ...filtros, inicio: janela.inicio || filtros.inicio, fim: janela.fim || filtros.fim };
    let pagina = 0;

    while (rows.length < limit) {
      const from = pagina * pageSize;
      const to = from + pageSize - 1;
      const { data, error } = await criarQuery(supabase, filtrosJanela).range(from, to);
      if (error) throw new Error(`Erro ao ler ${tabelaDescricao} do Supabase: ${error.message}`);

      const paginaRows = (data || []).map(mapRow);
      totalAvaliado += paginaRows.length;
      const filtradas = tabelaDescricao === 'Tracking'
        ? aplicarFiltrosBaseVolumetria(paginaRows, filtros)
        : paginaRows.filter((row) => !(filtros.excluirEbazar && isTransportadoraEbazarVolumetria(row.transportadora)));

      rows.push(...filtradas.slice(0, Math.max(0, limit - rows.length)));

      const progressoJanela = janelas.length ? (janelaIndex / janelas.length) : 0;
      const progressoPagina = data?.length ? Math.min(1, (pagina + 1) / 8) / Math.max(janelas.length, 1) : 0;
      const percentual = Math.min(percentualFim, percentualInicio + Math.round((progressoJanela + progressoPagina) * (percentualFim - percentualInicio)));
      postProgress({
        percentual,
        mensagem: `Lendo ${tabelaDescricao} do Supabase em lotes leves: ${totalAvaliado.toLocaleString('pt-BR')} registro(s) avaliados${janela.inicio && janela.fim ? ` (${janela.inicio} a ${janela.fim})` : ''}...`,
      });

      if (!data || data.length < pageSize) break;
      pagina += 1;
      await waitFrame();
    }
  }

  return { rows, totalCompativel: rows.length, totalBanco: totalAvaliado, limit };
}

async function exportarTrackingSupabase(filtros = {}, options = {}) {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const resultado = await buscarPaginasSupabase({
    supabase,
    tabelaDescricao: 'Tracking',
    criarQuery: criarQueryTrackingSupabase,
    mapRow: mapTrackingSupabaseRow,
    filtros,
    options,
    percentualInicio: 5,
    percentualFim: 20,
  });

  return { ...resultado, fonte: 'Supabase Tracking' };
}

function criarQueryCtesSupabase(supabase, filtros = {}) {
  return aplicarFiltrosSqlBasicos(
    supabase.from(TABELA_CTES_SUPABASE).select(CTE_SUPABASE_COLUMNS),
    filtros,
    'data_emissao'
  );
}

async function exportarRealizadoSupabaseParaVolumetria(filtros = {}, options = {}) {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const resultado = await buscarPaginasSupabase({
    supabase,
    tabelaDescricao: 'CT-es',
    criarQuery: criarQueryCtesSupabase,
    mapRow: mapCteSupabaseRow,
    filtros,
    options,
    percentualInicio: 20,
    percentualFim: 28,
  });

  return { ...resultado, fonte: 'Supabase CT-es' };
}

async function carregarTrackingVolumetria(filtroBase = {}, config = {}) {
  const limit = Number(config.limiteLeitura || SUPABASE_EXPORT_LIMIT_DEFAULT);
  postProgress({ percentual: 5, mensagem: 'Lendo Tracking do Supabase em segundo plano...' });

  const online = await exportarTrackingSupabase(filtroBase, { limit });
  if (online?.rows?.length) return online;

  postProgress({ percentual: 5, mensagem: 'Tracking do Supabase indisponível/vazio. Tentando base local como contingência...' });
  const local = await exportarTrackingLocal(filtroBase, { limit });
  return { ...local, fonte: 'Base local de Tracking' };
}

async function carregarCtesVolumetria(filtroBase = {}, config = {}) {
  const limit = Number(config.limiteLeitura || SUPABASE_EXPORT_LIMIT_DEFAULT);
  const online = await exportarRealizadoSupabaseParaVolumetria(filtroBase, { limit });
  if (online?.rows?.length) return online;
  const local = await exportarRealizadoLocal(filtroBase, { limit });
  return { ...local, fonte: 'CT-es locais' };
}

async function gerarArquivoVolumetria({ config = {}, grade = {} }) {
  config = normalizarConfigVolumetria(config);

  const filtroBase = {
    // Canal e UF são filtrados depois da normalização rápida, para evitar perder volume
    // quando o Tracking antigo veio com canal/estado incompleto ou como nome do estado.
    inicio: config.inicio,
    fim: config.fim,
    canal: config.canal,
    origem: config.origem,
    ufOrigem: config.ufOrigem,
    ufDestino: config.ufDestino,
    excluirEbazar: Boolean(config.excluirEbazar),
  };

  const tracking = await carregarTrackingVolumetria(filtroBase, config);
  const rows = tracking.rows || [];
  const totalCompativel = tracking.totalCompativel || rows.length;
  const limit = tracking.limit || Number(config.limiteLeitura || SUPABASE_EXPORT_LIMIT_DEFAULT);
  const fonteBase = tracking.fonte || 'Supabase Tracking';

  if (!rows.length) {
    throw new Error('Não existe base de Tracking no Supabase com os filtros informados. Confira se o Tracking foi enviado ao Supabase e se o período/origem estão corretos.');
  }

  let rowsBase = rows.map(normalizarLinhaVolumetria);
  let resumoVinculo = null;

  if (config.vincularCtes || config.somenteComCteVinculado) {
    postProgress({ percentual: 22, mensagem: 'Buscando CT-es no Supabase para vincular com o Tracking...' });
    const ctes = await carregarCtesVolumetria(filtroBase, config);
    postProgress({ percentual: 28, mensagem: 'Relacionando Tracking com CT-es para usar somente volumetria vinculada...' });
    const relacionamento = relacionarTrackingComCtes(rowsBase, ctes.rows || []);
    rowsBase = (relacionamento.rows || []).map(normalizarLinhaVolumetria);
    resumoVinculo = relacionamento.resumo;

    if (config.somenteComCteVinculado) {
      rowsBase = rowsBase.filter((row) => Number(row.qtdCtesVinculados || 0) > 0);
      if (!rowsBase.length) {
        throw new Error('Nenhuma linha do Tracking encontrou vínculo com CT-e no período filtrado. Revise chaves de NF/CT-e, período e bases carregadas.');
      }
    }
  } else {
    postProgress({ percentual: 28, mensagem: 'Vínculo com CT-e desligado. Seguindo somente com Tracking do Supabase...' });
  }

  if (config.incluirIbge) {
    rowsBase = await completarGeografiaVolumetria(rowsBase);
  } else {
    rowsBase = await completarUfVolumetriaSemIbge(rowsBase, config);
    postProgress({ percentual: 45, mensagem: 'Modo rápido sem IBGE: UF normalizada. Pulando exportação de colunas IBGE...' });
  }

  const linhasAntesFiltrosFinais = rowsBase.length;
  const diagnosticoAntesFiltro = contarSemUf(rowsBase);

  rowsBase = aplicarFiltrosFinais(rowsBase, config);
  const diagnosticoDepoisFiltro = contarSemUf(rowsBase);

  if (!rowsBase.length) {
    throw new Error(config.incluirIbge
      ? 'Após completar UF/IBGE, nenhuma linha ficou dentro dos filtros de origem/UF selecionados.'
      : 'Nenhuma linha ficou dentro dos filtros selecionados. No modo sem IBGE, os filtros de UF usam apenas a UF que já veio no Tracking.');
  }

  postProgress({ percentual: 72, mensagem: 'Agrupando volumetria...' });
  const volumetria = await montarVolumetria(rowsBase, config, grade);

  postProgress({ percentual: 88, mensagem: 'Montando arquivo Excel...' });
  const wb = XLSX.utils.book_new();
  const diagnostico = {
    linhasAntesFiltrosFinais,
    semUfOrigemAntes: diagnosticoAntesFiltro.semUfOrigem,
    semUfDestinoAntes: diagnosticoAntesFiltro.semUfDestino,
    semUfOrigemDepois: diagnosticoDepoisFiltro.semUfOrigem,
    semUfDestinoDepois: diagnosticoDepoisFiltro.semUfDestino,
    ufOrigemInferidaSemIbge: diagnosticoAntesFiltro.ufOrigemInferida,
    ufDestinoInferidaSemIbge: diagnosticoAntesFiltro.ufDestinoInferida,
  };

  appendJsonSheet(wb, 'Resumo', buildResumoRows({ config, rowsBase, volumetria, totalCompativel, limit, resumoVinculo, diagnostico, fonteBase }));
  appendJsonSheet(wb, 'Volumetria_Agrupada', volumetria);
  appendJsonSheet(wb, 'Diagnostico_UF', [{
    Linhas_Antes_Filtros_Finais: diagnostico.linhasAntesFiltrosFinais,
    Linhas_Depois_Filtros_Finais: rowsBase.length,
    Sem_UF_Origem_Antes_Filtro: diagnostico.semUfOrigemAntes,
    Sem_UF_Destino_Antes_Filtro: diagnostico.semUfDestinoAntes,
    Sem_UF_Origem_Depois_Filtro: diagnostico.semUfOrigemDepois,
    Sem_UF_Destino_Depois_Filtro: diagnostico.semUfDestinoDepois,
    UF_Origem_Inferida_Sem_IBGE: diagnostico.ufOrigemInferidaSemIbge,
    UF_Destino_Inferida_Sem_IBGE: diagnostico.ufDestinoInferidaSemIbge,
    Filtro_UF_Origem: config.ufOrigem || 'Todas',
    Filtro_UF_Destino: config.ufDestino || 'Todas',
    Observacao: 'Esta aba ajuda a conferir se o filtro de UF está perdendo linhas por falta de UF no Tracking.',
  }]);

  let detalheSheets = 0;
  if (config.incluirDetalhe) {
    const detalhes = await montarDetalhes(rowsBase, grade, Boolean(config.incluirIbge));
    for (let index = 0; index < detalhes.length; index += DETALHE_SHEET_LIMIT) {
      detalheSheets += 1;
      appendJsonSheet(wb, detalheSheets === 1 ? 'Detalhe_Notas' : `Detalhe_${detalheSheets}`, detalhes.slice(index, index + DETALHE_SHEET_LIMIT));
      await waitFrame();
    }
  }

  postProgress({ percentual: 96, mensagem: 'Gerando download do Excel...' });
  const arrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: false });
  const sufixoIbge = config.incluirIbge ? 'com-ibge' : 'sem-ibge';
  const fileName = `volumetria-transportador-${config.canal || 'todos'}-${sufixoIbge}-${Date.now()}.xlsx`;

  return {
    arrayBuffer,
    fileName,
    resumo: {
      notas: rowsBase.length,
      linhasVolumetria: volumetria.length,
      vinculadas: resumoVinculo?.vinculadas || 0,
      detalheSheets,
      incluirIbge: Boolean(config.incluirIbge),
      fonteBase,
      somenteComCteVinculado: Boolean(config.somenteComCteVinculado),
    },
  };
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  if (msg.type !== 'exportar-volumetria') return;

  try {
    const result = await gerarArquivoVolumetria({ config: msg.config || {}, grade: msg.grade || {} });
    self.postMessage({
      type: 'done',
      fileName: result.fileName,
      resumo: result.resumo,
      arrayBuffer: result.arrayBuffer,
    }, [result.arrayBuffer]);
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || 'Erro ao exportar volumetria.' });
  }
};
