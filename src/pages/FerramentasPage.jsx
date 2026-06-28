import { useEffect, useMemo, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { ImportarFluxoCard } from './LotacaoOperacaoPage';
import { carregarVinculosTransportadoras, salvarVinculosTransportadoras, removerVinculoTransportadora } from '../services/vinculosTransportadorasService';
import SlaAuditoriaConfig from '../components/SlaAuditoriaConfig';
import { carregarSessao } from '../utils/authLocal';

function normalizarNomeTransp(nome = '') {
  return String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

function similaridade(a, b) {
  const na = normalizarNomeTransp(a);
  const nb = normalizarNomeTransp(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const wordsA = na.split(' ').filter(w => w.length > 2);
  const wordsB = nb.split(' ').filter(w => w.length > 2);
  if (!wordsA.length || !wordsB.length) return 0;
  const matches = wordsA.filter(w => wordsB.some(wb => wb.startsWith(w) || w.startsWith(wb)));
  return matches.length / Math.max(wordsA.length, wordsB.length);
}
import * as XLSX from 'xlsx';
import { exportarTrackingLocal } from '../utils/trackingLocal';
import { exportarRealizadoLocal } from '../services/realizadoLocalDb';
import { relacionarTrackingComCtes } from '../utils/trackingCteLink';
import { carregarMunicipiosIbgeDb } from '../services/freteDatabaseService';
import { carregarAliasesCidadeIbge, salvarAliasCidadeIbge, removerAliasCidadeIbge } from '../services/cidadeIbgeAliasService';
import {
  CANAIS_PARAMETRIZAVEIS,
  definirCanalTransportadora,
  listarPendenciasCanalTransportadora,
} from '../services/canalTransportadoraService';
import {
  carregarFluxoCargasLotacao,
  resumirFluxoCargas,
} from '../utils/lotacaoFluxoCargas';
import {
  carregarGradeFrete,
  salvarGradeFrete,
  restaurarGradeFretePadrao,
  encontrarLinhaGradePorPeso,
} from '../utils/gradeFreteConfig';

const DEFAULT_CONFIG = {
  canal: '',
  inicio: '',
  fim: '',
  origem: '',
  ufOrigem: '',
  ufDestino: '',
  agrupamento: 'cidade',
  excluirEbazar: true,
  incluirIbge: false,
  incluirDetalhe: false,
  vincularCtes: true,
  somenteComCteVinculado: true,
  usarBaseCte: true,
};

const CANAIS = ['', 'ATACADO', 'B2C', 'INTERCOMPANY', 'REVERSA', 'A DEFINIR'];
const CANAIS_GRADE = ['ATACADO', 'B2C'];
const UF_OPTIONS = ['', 'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

const UF_POR_CODIGO_IBGE = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

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

function cleanUf(value = '') {
  const uf = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 2);
  return uf.length === 2 ? uf : '';
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

function normalizeBusca(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function safeSheetName(nome) {
  return String(nome || 'Planilha').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Planilha';
}

function isMoneyColumn(header = '') {
  const h = String(header).toUpperCase();
  return h.includes('VALOR') || h.includes('FRETE') || h.includes('NF');
}

function isPercentColumn(header = '') {
  return String(header).toUpperCase().includes('PERCENTUAL') || String(header).includes('%');
}

function isNumericColumn(header = '') {
  const h = String(header).toUpperCase();
  return [
    'NOTAS', 'VOLUMES', 'PESO', 'CUBAGEM', 'M3', 'CTES', 'MEDIA', 'MÉDIA',
    'QTD', 'TOTAL', 'PERCENTUAL', 'FRETE', 'VALOR', 'NF',
  ].some((termo) => h.includes(termo));
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

function aplicarFormatoPlanilha(ws, rows = []) {
  if (!rows?.length) return;

  const headers = Object.keys(rows[0] || {});
  if (!headers.length) return;

  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  ws['!autofilter'] = { ref: XLSX.utils.encode_range(range) };
  ws['!views'] = [{ state: 'frozen', ySplit: 1 }];
  ws['!cols'] = headers.map(columnWidth);

  headers.forEach((header, colIndex) => {
    for (let rowIndex = 1; rowIndex <= rows.length; rowIndex += 1) {
      const ref = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
      const cell = ws[ref];
      if (!cell || typeof cell.v !== 'number') continue;

      if (isPercentColumn(header)) {
        cell.z = '0.00"%"';
      } else if (isMoneyColumn(header)) {
        cell.z = 'R$ #,##0.00';
      } else if (String(header).toUpperCase().includes('CUBAGEM')) {
        cell.z = '#,##0.000000';
      } else if (isNumericColumn(header)) {
        cell.z = '#,##0.00';
      }
    }
  });
}

function baixarXlsx(nomeArquivo, abas) {
  const wb = XLSX.utils.book_new();

  Object.entries(abas).forEach(([nome, rows]) => {
    const safeRows = rows || [];
    const ws = XLSX.utils.json_to_sheet(safeRows);
    aplicarFormatoPlanilha(ws, safeRows);
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(nome));
  });

  XLSX.writeFile(wb, nomeArquivo);
}


function baixarArrayBuffer(nomeArquivo, arrayBuffer) {
  const blob = new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportarVolumetriaEmWorker(payload, onProgress) {
  return new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined') {
      reject(new Error('Seu navegador não suportou processamento em segundo plano para exportar a volumetria.'));
      return;
    }

    const worker = new Worker(new URL('../workers/volumetriaExportWorker.js', import.meta.url), { type: 'module' });
    let finalizado = false;

    const encerrar = () => {
      if (!finalizado) {
        finalizado = true;
        worker.terminate();
      }
    };

    worker.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === 'progress') {
        onProgress?.(msg);
        return;
      }
      if (msg.type === 'done') {
        encerrar();
        resolve(msg);
        return;
      }
      if (msg.type === 'error') {
        encerrar();
        reject(new Error(msg.message || 'Erro ao exportar volumetria.'));
      }
    };

    worker.onerror = (event) => {
      encerrar();
      reject(new Error(event.message || 'Erro no processamento em segundo plano da volumetria.'));
    };

    worker.postMessage({ type: 'exportar-volumetria', ...payload });
  });
}

function pesoConsiderado(row = {}) {
  return Math.max(toNumber(row.peso), toNumber(row.pesoDeclarado), toNumber(row.pesoCubado));
}

function cubagemTotalTracking(row = {}) {
  const cubagemUnitaria = toNumber(row.cubagem);
  const volumes = toNumber(row.qtdVolumes || row.volume || row.volumes);
  return cubagemUnitaria * Math.max(volumes || 1, 1);
}

function faixaVolumetria(canal, peso, grade = {}) {
  if (String(canal || '').toUpperCase() === 'A DEFINIR') return '';
  const canalNorm = String(canal || '').toUpperCase() === 'B2C' ? 'B2C' : 'ATACADO';
  const linha = encontrarLinhaGradePorPeso(grade[canalNorm] || [], peso);
  if (!linha) return '';

  const limite = Number(linha.peso || 0);
  if (!limite) return '';
  if (limite >= 999999) return '100+ kg';

  return `Até ${limite.toLocaleString('pt-BR')} kg`;
}

function chaveVolumetria(row = {}, agrupamento, faixa) {
  if (agrupamento === 'estado') return [row.canal, row.ufOrigem, row.ufDestino, faixa].join('|');
  if (agrupamento === 'ibge') return [row.canal, row.ibgeOrigem, row.ibgeDestino, faixa].join('|');

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

function linhaInicial(row = {}, agrupamento, faixa) {
  const base = {
    Canal: row.canal || '',
    Faixa_Peso: faixa,
    Notas: 0,
    Volumes: 0,
    Peso_Real: 0,
    Peso_Declarado: 0,
    Peso_Cubado: 0,
    Peso_Considerado: 0,
    Cubagem_m3: 0,
    Valor_NF: 0,
  };

  if (agrupamento === 'estado') {
    return {
      ...base,
      UF_Origem: row.ufOrigem || '',
      UF_Destino: row.ufDestino || '',
    };
  }

  if (agrupamento === 'ibge') {
    return {
      ...base,
      IBGE_Origem: row.ibgeOrigem || '',
      IBGE_Destino: row.ibgeDestino || '',
    };
  }

  return {
    ...base,
    Origem: row.cidadeOrigem || '',
    UF_Origem: row.ufOrigem || '',
    IBGE_Origem: row.ibgeOrigem || '',
    Destino: row.cidadeDestino || '',
    UF_Destino: row.ufDestino || '',
    IBGE_Destino: row.ibgeDestino || '',
  };
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

function criarMapasLocalidades(rows = [], municipios = []) {
  const maps = {
    porCidade: new Map(),
    porCidadeUf: new Map(),
    porIbge: new Map(),
  };

  (municipios || []).forEach((item) => {
    const ibge = onlyDigits(item.ibge || item.codigo_ibge || item.codigo || item.codigoMunicipio || '').slice(0, 7);
    const cidade = item.cidade || item.nome || item.municipio || item.nomeMunicipio || '';
    const uf = item.uf || item.estado || getUfByIbge(ibge);
    addLocalidade(cidade, uf, ibge, maps, 'municipios');
  });

  (rows || []).forEach((row) => {
    addLocalidade(row.cidadeOrigem, row.ufOrigem, row.ibgeOrigem, maps, 'tracking/cte');
    addLocalidade(row.cidadeDestino, row.ufDestino, row.ibgeDestino, maps, 'tracking/cte');
  });

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

async function carregarMunicipiosSeguro() {
  try {
    const municipios = await carregarMunicipiosIbgeDb();
    return Array.isArray(municipios) ? municipios : [];
  } catch {
    return [];
  }
}

async function completarGeografiaVolumetria(rows = []) {
  const municipios = await carregarMunicipiosSeguro();
  let maps = criarMapasLocalidades(rows, municipios);

  let preenchidas = (rows || []).map((row) => {
    const origem = completarLocalidade(row, 'Origem', maps);
    return completarLocalidade(origem, 'Destino', maps);
  });

  maps = criarMapasLocalidades(preenchidas, municipios);

  preenchidas = preenchidas.map((row) => {
    const origem = completarLocalidade(row, 'Origem', maps);
    const destino = completarLocalidade(origem, 'Destino', maps);
    const chaveRotaIbge = destino.ibgeOrigem && destino.ibgeDestino
      ? `${destino.ibgeOrigem}-${destino.ibgeDestino}`
      : '';
    return { ...destino, chaveRotaIbge };
  });

  return preenchidas;
}

function aplicarFiltrosFinais(rows = [], config = {}) {
  const origemFiltro = normalizarCidade(config.origem);
  const ufOrigemFiltro = cleanUf(config.ufOrigem);
  const ufDestinoFiltro = cleanUf(config.ufDestino);

  return (rows || []).filter((row) => {
    if (origemFiltro && !normalizarCidade(row.cidadeOrigem).includes(origemFiltro)) return false;
    if (ufOrigemFiltro && cleanUf(row.ufOrigem) !== ufOrigemFiltro) return false;
    if (ufDestinoFiltro && cleanUf(row.ufDestino) !== ufDestinoFiltro) return false;
    return true;
  });
}

function montarVolumetria(rows = [], config = {}, grade = {}) {
  const mapa = new Map();

  rows.forEach((row) => {
    const canal = String(row.canal || '').toUpperCase();
    const peso = pesoConsiderado(row);
    const faixa = canal === 'B2C' || canal === 'ATACADO' ? faixaVolumetria(canal, peso, grade) : '';
    const chave = chaveVolumetria(row, config.agrupamento, faixa);

    if (!mapa.has(chave)) mapa.set(chave, linhaInicial(row, config.agrupamento, faixa));

    const item = mapa.get(chave);
    item.Notas += 1;
    item.Volumes += toNumber(row.qtdVolumes);
    item.Peso_Real += toNumber(row.peso);
    item.Peso_Declarado += toNumber(row.pesoDeclarado);
    item.Peso_Cubado += toNumber(row.pesoCubado);
    item.Peso_Considerado += peso;
    item.Cubagem_m3 += cubagemTotalTracking(row);
    item.Valor_NF += toNumber(row.valorNF);
  });

  return [...mapa.values()]
    .map((item) => ({
      ...item,
      Media_Peso_Nota: item.Notas ? item.Peso_Considerado / item.Notas : 0,
      Media_Volumes_Nota: item.Notas ? item.Volumes / item.Notas : 0,
      Media_Cubagem_Nota: item.Notas ? item.Cubagem_m3 / item.Notas : 0,
      Media_Valor_NF_Nota: item.Notas ? item.Valor_NF / item.Notas : 0,
    }))
    .sort((a, b) => String(a.UF_Destino || a.IBGE_Destino || '').localeCompare(String(b.UF_Destino || b.IBGE_Destino || '')));
}

function detalheTrackingRow(row = {}, grade = {}) {
  const canal = String(row.canal || '').toUpperCase();
  const peso = pesoConsiderado(row);

  return {
    Nota_Fiscal: row.notaFiscal || row.numeroNf || row.nfNumero || '',
    Pedido: row.pedido || '',
    Data: row.data || row.dataFaturamento || '',
    Canal: row.canal || '',
    Canal_Original: row.canalOriginal || '',
    Origem: row.cidadeOrigem || '',
    UF_Origem: row.ufOrigem || '',
    IBGE_Origem: row.ibgeOrigem || '',
    Destino: row.cidadeDestino || '',
    UF_Destino: row.ufDestino || '',
    IBGE_Destino: row.ibgeDestino || '',
    Faixa_Peso: canal === 'B2C' || canal === 'ATACADO' ? faixaVolumetria(canal, peso, grade) : '',
    Volumes: toNumber(row.qtdVolumes),
    Peso_Real: toNumber(row.peso),
    Peso_Declarado: toNumber(row.pesoDeclarado),
    Peso_Cubado: toNumber(row.pesoCubado),
    Peso_Considerado: peso,
    Cubagem_Unitaria_m3: toNumber(row.cubagem),
    Cubagem_Total_m3: cubagemTotalTracking(row),
    Valor_NF: toNumber(row.valorNF),
    Complementado_CTE: row.enderecoComplementadoPorCte ? 'Sim' : 'Não',
    Complementado_Recorrencia: row.enderecoComplementadoPorRecorrencia ? 'Sim' : 'Não',
    Campos_Complementados: [row.camposComplementadosPorCte, row.camposComplementadosPorRecorrencia].filter(Boolean).join(' | '),
  };
}

function normalizarValorInput(value) {
  return String(value ?? '').replace(',', '.');
}

function fmtNumero(value, casas = 0) {
  return Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function fmtMoeda(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtData(value) {
  if (!value) return '-';
  const s = String(value).slice(0, 10);
  const [y, m, d] = s.split('-');
  return y && m && d ? `${d}/${m}/${y}` : s;
}

function normalizarCidadeBuscaFerr(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function VinculosCidadeIbgeCard() {
  const [aliases, setAliases] = useState([]);
  const [municipios, setMunicipios] = useState([]);
  const [cidade, setCidade] = useState('');
  const [uf, setUf] = useState('');
  const [ibge, setIbge] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    (async () => {
      try { setAliases(await carregarAliasesCidadeIbge()); } catch (e) { setErr(e.message || String(e)); }
      try { setMunicipios(await carregarMunicipiosIbgeDb()); } catch { /* validação fica opcional */ }
    })();
  }, []);

  const sugerirIbge = () => {
    setErr(''); setMsg('');
    const alvoCidade = normalizarCidadeBuscaFerr(cidade);
    const alvoUf = String(uf || '').trim().toUpperCase();
    if (!alvoCidade) { setErr('Informe a cidade.'); return; }
    const achou = (municipios || []).find((m) => {
      const c = normalizarCidadeBuscaFerr(m.cidade || m.nome || m.municipio);
      const u = String(m.uf || m.estado || '').trim().toUpperCase();
      return c === alvoCidade && (!alvoUf || u === alvoUf);
    });
    if (achou) {
      setIbge(String(achou.ibge || achou.codigo_ibge || achou.codigo || '').replace(/\D/g, '').slice(0, 7));
      setMsg('IBGE sugerido pela lista oficial. Confira e salve.');
    } else {
      setMsg('Não encontrei na lista oficial — informe o código IBGE manualmente (7 dígitos).');
    }
  };

  const salvar = async () => {
    setErr(''); setMsg(''); setSalvando(true);
    try {
      const r = await salvarAliasCidadeIbge({ cidade, uf, ibge }, aliases);
      setAliases(r.aliases);
      setMsg(`Vínculo salvo (${r.modo === 'supabase' ? 'Supabase' : 'local'}).`);
      setCidade(''); setUf(''); setIbge('');
    } catch (e) { setErr(e.message || String(e)); }
    setSalvando(false);
  };

  const remover = async (id) => {
    setErr(''); setMsg('');
    try { setAliases(await removerAliasCidadeIbge(id, aliases)); }
    catch (e) { setErr(e.message || String(e)); }
  };

  return (
    <div style={{ padding: '16px 20px', display: 'grid', gap: 14 }}>
      <div className="hint-box compact">
        Use quando o nome da cidade no CT-e não casar com a lista oficial de IBGE (ex.: "BRASILIA (DF)"). O vínculo é consultado pela <strong>Gestão Base CT-e</strong> ao resolver o IBGE — depois de salvar aqui, rode a Gestão Base no mês para gravar o código na base. Escreva a cidade <strong>exatamente como aparece no CT-e</strong>.
      </div>
      {err ? <div className="sim-alert error">{err}</div> : null}
      {msg ? <div className="sim-alert info">{msg}</div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 0.6fr 1fr auto auto', gap: 10, alignItems: 'end' }}>
        <label>Cidade (como no CT-e)
          <input type="text" value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="BRASILIA (DF)" />
        </label>
        <label>UF
          <input type="text" value={uf} onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))} placeholder="DF" maxLength={2} />
        </label>
        <label>Código IBGE
          <input type="text" value={ibge} onChange={(e) => setIbge(e.target.value.replace(/\D/g, '').slice(0, 7))} placeholder="5300108" inputMode="numeric" />
        </label>
        <button className="btn-secondary" type="button" onClick={sugerirIbge}>Sugerir IBGE</button>
        <button className="primary" type="button" onClick={salvar} disabled={salvando || !cidade || ibge.length !== 7}>
          {salvando ? 'Salvando...' : 'Salvar vínculo'}
        </button>
      </div>

      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead><tr><th>Cidade</th><th>UF</th><th>IBGE</th><th>Ação</th></tr></thead>
          <tbody>
            {aliases.length === 0 ? (
              <tr><td colSpan={4} style={{ color: 'var(--muted)' }}>Nenhum vínculo cadastrado ainda.</td></tr>
            ) : aliases.map((a) => (
              <tr key={a.id || `${a.cidadeNorm}-${a.uf}`}>
                <td>{a.cidade}</td>
                <td>{a.uf || '-'}</td>
                <td>{a.ibge}</td>
                <td><button className="btn-secondary" type="button" onClick={() => remover(a.id)}>Remover</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function FerramentasPage({ transportadoras = [] }) {
  const sessao = carregarSessao();
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const [grade, setGrade] = useState(() => carregarGradeFrete());
  const [canalGrade, setCanalGrade] = useState('ATACADO');
  const [atualizandoCubagemGrade, setAtualizandoCubagemGrade] = useState(false);
  const [pendenciasCanal, setPendenciasCanal] = useState([]);
  const [carregandoPendenciasCanal, setCarregandoPendenciasCanal] = useState(false);
  const [salvandoCanalPendencia, setSalvandoCanalPendencia] = useState('');
  const [baseFluxoLotacao, setBaseFluxoLotacao] = useState(() => carregarFluxoCargasLotacao());
  const resumoLotacao = useMemo(() => resumirFluxoCargas(baseFluxoLotacao), [baseFluxoLotacao]);

  const resumoPendenciasCanal = pendenciasCanal.reduce((acc, item) => {
    acc.transportadoras += 1;
    acc.ctes += Number(item.quantidadeCtes || 0);
    acc.tracking += Number(item.quantidadeTracking || 0);
    acc.valorCte += Number(item.valorTotalCte || 0);
    return acc;
  }, { transportadoras: 0, ctes: 0, tracking: 0, valorCte: 0 });

  async function carregarPendenciasCanal() {
    setCarregandoPendenciasCanal(true);
    setErro('');
    try {
      const lista = await listarPendenciasCanalTransportadora();
      setPendenciasCanal(lista);
      setMensagem(`${fmtNumero(lista.length)} transportadora(s) com pendencia de canal carregada(s).`);
    } catch (error) {
      setErro(error.message || 'Erro ao carregar pendencias de canal.');
    } finally {
      setCarregandoPendenciasCanal(false);
    }
  }

  async function definirCanalPendencia(item, canal) {
    const ok = window.confirm(`Definir canal ${canal} para ${item.transportadora}? Isso atualizara CT-es e Tracking atuais com canal A DEFINIR.`);
    if (!ok) return;
    setSalvandoCanalPendencia(`${item.transportadora}|${canal}`);
    setErro('');
    try {
      const resultado = await definirCanalTransportadora({
        transportadora: item.transportadora,
        canal,
        usuario: sessao?.email || sessao?.nome || '',
      });
      setMensagem(`Canal ${canal} salvo para ${item.transportadora}. CT-es atualizados: ${fmtNumero(resultado?.ctes_atualizados || 0)}. Tracking atualizado: ${fmtNumero(resultado?.tracking_atualizados || 0)}.`);
      await carregarPendenciasCanal();
    } catch (error) {
      setErro(error.message || 'Erro ao definir canal da transportadora.');
    } finally {
      setSalvandoCanalPendencia('');
    }
  }

  const alterar = (campo, valor) => setConfig((prev) => ({ ...prev, [campo]: valor }));

  const alterarIncluirIbge = (checked) => {
    setConfig((prev) => ({
      ...prev,
      incluirIbge: checked,
      agrupamento: checked || !['ibge', 'cidade_ibge'].includes(prev.agrupamento) ? prev.agrupamento : 'cidade',
    }));
  };

  const alterarSomenteVinculados = (checked) => {
    setConfig((prev) => ({
      ...prev,
      somenteComCteVinculado: checked,
      vincularCtes: checked ? true : prev.vincularCtes,
    }));
  };

  const alterarGrade = (index, campo, valor) => {
    setGrade((prev) => {
      const linhas = [...(prev[canalGrade] || [])];
      linhas[index] = { ...linhas[index], [campo]: normalizarValorInput(valor) };
      return { ...prev, [canalGrade]: linhas };
    });
  };

  const adicionarFaixaGrade = () => {
    setGrade((prev) => ({
      ...prev,
      [canalGrade]: [...(prev[canalGrade] || []), { peso: '', valorNF: '', cubagem: '' }],
    }));
  };

  const removerFaixaGrade = (index) => {
    setGrade((prev) => ({
      ...prev,
      [canalGrade]: (prev[canalGrade] || []).filter((_, i) => i !== index),
    }));
  };

  const atualizarCubagemGradePeloTracking = async () => {
    if (!isSupabaseConfigured()) {
      setErro('Supabase não configurado. Não foi possível calcular médias do Tracking.');
      setMensagem('');
      return;
    }

    const normalizarCanalMedia = (value = '') => {
      const texto = String(value || '').toUpperCase();
      return texto.includes('B2C') || texto.includes('ECOM') || texto.includes('MARKET') ? 'B2C' : 'ATACADO';
    };

    const chaveMedia = (canal, limite) => `${normalizarCanalMedia(canal)}|${Number(toNumber(limite)).toFixed(3)}`;

    const encontrarMediaFaixa = (lista = [], canal, limitePeso) => {
      const canalNormalizado = normalizarCanalMedia(canal);
      const limite = toNumber(limitePeso);
      if (!limite) return null;

      const mesmaChave = lista.find((item) => item.chave === chaveMedia(canalNormalizado, limite));
      if (mesmaChave) return mesmaChave;

      const mesmoCanal = lista.filter((item) => item.canal === canalNormalizado);
      const aproximada = mesmoCanal.find((item) => Math.abs(toNumber(item.limite_kg) - limite) <= 0.001);
      if (aproximada) return aproximada;

      const porIntervalo = mesmoCanal.find((item) => {
        const inicial = toNumber(item.peso_inicial);
        const final = toNumber(item.limite_kg);
        return limite > inicial && limite <= final;
      });
      if (porIntervalo) return porIntervalo;

      return null;
    };

    setAtualizandoCubagemGrade(true);
    setErro('');
    setMensagem('Calculando médias de cubagem por faixa com base no Tracking...');

    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('vw_tracking_grade_cubagem_media')
        .select('canal,peso_inicial,limite_kg,qtd_registros,cubagem_media_m3,cubagem_mediana_m3,volumes_medios,cubagem_min_m3,cubagem_max_m3,origem_media')
        .order('canal', { ascending: true })
        .order('limite_kg', { ascending: true });

      if (error) throw error;

      const linhasMedia = Array.isArray(data) ? data : [];
      if (!linhasMedia.length) {
        throw new Error('A view vw_tracking_grade_cubagem_media não retornou dados para o aplicativo. Rode o SQL de GRANT/RLS da view ou confirme se a view existe no Supabase.');
      }

      const mediasNormalizadas = linhasMedia
        .map((linha) => {
          const canal = normalizarCanalMedia(linha.canal);
          const limite = toNumber(linha.limite_kg);
          const cubagemMediana = toNumber(linha.cubagem_mediana_m3);
          const cubagemMedia = toNumber(linha.cubagem_media_m3);
          const cubagem = cubagemMediana > 0 ? cubagemMediana : cubagemMedia;
          return {
            ...linha,
            canal,
            limite_kg: limite,
            peso_inicial: toNumber(linha.peso_inicial),
            cubagem,
            qtd: Number(linha.qtd_registros || 0),
            volumesMedios: toNumber(linha.volumes_medios),
            chave: chaveMedia(canal, limite),
          };
        })
        .filter((linha) => linha.canal && linha.limite_kg > 0 && linha.cubagem > 0);

      if (!mediasNormalizadas.length) {
        throw new Error('A view retornou linhas, mas nenhuma possui cubagem média/mediana maior que zero. Verifique cubagem_total no Tracking.');
      }

      let faixasAtualizadas = 0;
      const detalheAtualizacao = [];
      const proximaGrade = { ...grade };

      CANAIS_GRADE.forEach((canal) => {
        proximaGrade[canal] = (grade[canal] || []).map((linha) => {
          const limite = toNumber(linha.peso);
          const media = encontrarMediaFaixa(mediasNormalizadas, canal, limite);
          if (!media || media.cubagem <= 0) return linha;

          faixasAtualizadas += 1;
          detalheAtualizacao.push(`${canal} até ${limite}kg = ${media.cubagem.toFixed(6)}m³`);

          return {
            ...linha,
            cubagem: media.cubagem.toFixed(6),
            cubagemFonte: 'tracking_media',
            cubagemAmostra: media.qtd,
            volumesMediosTracking: media.volumesMedios,
          };
        });
      });

      if (!faixasAtualizadas) {
        const amostra = mediasNormalizadas.slice(0, 6).map((m) => `${m.canal}|${m.limite_kg}`).join(', ');
        throw new Error(`A view retornou ${linhasMedia.length} linha(s), mas nenhuma faixa da grade atual casou com as médias. Amostra da view: ${amostra}`);
      }

      setGrade(proximaGrade);
      setMensagem(`Cubagem padrão atualizada pelo Tracking em ${faixasAtualizadas} faixa(s), usando ${linhasMedia.length} linha(s) da view. Revise os valores e clique em Salvar grade. ${detalheAtualizacao.slice(0, 3).join(' · ')}`);
      setErro('');
    } catch (error) {
      setErro(error.message || 'Erro ao atualizar cubagens pela média do Tracking.');
      setMensagem('');
    } finally {
      setAtualizandoCubagemGrade(false);
    }
  };

  const salvarGradeAtual = () => {
    const normalizada = salvarGradeFrete(grade);
    setGrade(normalizada);
    setMensagem('Grade salva. O simulador e o Realizado Local passam a usar estes pesos, valores de NF e cubagens.');
    setErro('');
  };

  const restaurarGradePadrao = () => {
    const normalizada = restaurarGradeFretePadrao();
    setGrade(normalizada);
    setMensagem('Grade padrão restaurada. Revise as cubagens antes de simular.');
    setErro('');
  };

  async function exportarVolumetria() {
    setCarregando(true);
    setErro('');
    setMensagem('Gerando volumetria em segundo plano. Você pode continuar usando a tela enquanto o Excel é preparado...');

    try {
      const resultado = await exportarVolumetriaEmWorker(
        { config, grade },
        (progress) => {
          const percentual = Number(progress.percentual || 0);
          const prefixo = percentual ? `${percentual}% - ` : '';
          setMensagem(`${prefixo}${progress.mensagem || 'Processando volumetria...'}`);
        }
      );

      baixarArrayBuffer(resultado.fileName, resultado.arrayBuffer);

      const resumo = resultado.resumo || {};
      setMensagem(`Volumetria exportada: ${(resumo.notas || 0).toLocaleString('pt-BR')} nota(s)/linha(s), ${(resumo.linhasVolumetria || 0).toLocaleString('pt-BR')} linha(s) agrupadas${resumo.incluirIbge ? ', com colunas IBGE' : ', sem colunas IBGE'}${resumo.vinculadas ? `, ${resumo.vinculadas.toLocaleString('pt-BR')} com CT-e vinculado` : ''}${resumo.somenteComCteVinculado ? ', somente vínculos CT-e × Tracking' : ''}. Fonte: ${resumo.fonteBase || 'Supabase Tracking'}. Cubagem final do Tracking aplicada.`);
    } catch (error) {
      setErro(error.message || 'Erro ao gerar volumetria.');
    } finally {
      setCarregando(false);
    }
  }

  // Accordion
  const [abaAberta, setAbaAberta] = useState(null);
  const toggleAba = (aba) => setAbaAberta(prev => prev === aba ? null : aba);

  // Vínculos de transportadoras (Supabase + fallback local)
  const [vinculos, setVinculos] = useState(() => {
    try { return JSON.parse(localStorage.getItem('vinculos-transportadoras') || '[]'); } catch { return []; }
  });
  const [novoNomeCte, setNovoNomeCte] = useState('');
  const [novoNomeTabela, setNovoNomeTabela] = useState('');
  const [buscaVinculo, setBuscaVinculo] = useState('');
  const [salvandoVinculos, setSalvandoVinculos] = useState(false);
  const [fonteVinculos, setFonteVinculos] = useState('local');

  const carregarVinculosOnline = async () => {
    setErroSugestoes('');
    try {
      const lista = await carregarVinculosTransportadoras();
      setVinculos(lista);
      setFonteVinculos(isSupabaseConfigured() ? 'supabase' : 'local');
    } catch (err) {
      setErroSugestoes(err.message || 'Erro ao carregar vínculos.');
    }
  };

  useEffect(() => {
    carregarVinculosOnline();
  }, []);

  const salvarVinculos = async (lista) => {
    const proximaLista = (lista || []).filter(v => String(v.nomeCte || '').trim() && String(v.nomeTabela || '').trim());
    setVinculos(proximaLista);
    setSalvandoVinculos(true);
    setErroSugestoes('');
    try {
      const resultado = await salvarVinculosTransportadoras(proximaLista);
      setFonteVinculos(resultado.modo || (isSupabaseConfigured() ? 'supabase' : 'local'));
      setMensagem(`Vínculos salvos em ${resultado.modo === 'supabase' ? 'Supabase' : 'localStorage'}: ${resultado.total || proximaLista.length}.`);
    } catch (err) {
      setErroSugestoes(err.message || 'Erro ao salvar vínculos no Supabase.');
    } finally {
      setSalvandoVinculos(false);
    }
  };

  const adicionarVinculo = () => {
    if (!novoNomeCte.trim() || !novoNomeTabela.trim()) return;
    salvarVinculos([...vinculos, { id: Date.now(), nomeCte: novoNomeCte.trim(), nomeTabela: novoNomeTabela.trim(), origem: 'manual' }]);
    setNovoNomeCte(''); setNovoNomeTabela('');
  };
  const removerVinculo = async (id) => {
    try {
      setSalvandoVinculos(true);
      const novaLista = await removerVinculoTransportadora(id, vinculos);
      setVinculos(novaLista);
      setMensagem('Vínculo removido.');
    } catch (err) {
      setErroSugestoes(err.message || 'Erro ao remover vínculo.');
    } finally {
      setSalvandoVinculos(false);
    }
  };
  const editarVinculo = (id, campo, valor) => {
    const novaLista = vinculos.map(v => v.id === id ? {...v, [campo]: valor} : v);
    setVinculos(novaLista);
  };
  const salvarEdicaoVinculos = () => salvarVinculos(vinculos);
  const vinclosFiltrados = vinculos.filter(v => !buscaVinculo || String(v.nomeCte || '').toLowerCase().includes(buscaVinculo.toLowerCase()) || String(v.nomeTabela || '').toLowerCase().includes(buscaVinculo.toLowerCase()));
  const exportarVinculosJson = () => {
    const blob = new Blob([JSON.stringify(vinculos, null, 2)], {type: 'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'vinculos-transportadoras.json'; a.click();
  };
  const [sugestoes, setSugestoes] = useState([]);
  const [semVinculo, setSemVinculo] = useState([]);
  const [carregandoSugestoes, setCarregandoSugestoes] = useState(false);
  const [erroSugestoes, setErroSugestoes] = useState('');

  const gerarSugestoes = async () => {
    setCarregandoSugestoes(true);
    setErroSugestoes('');
    setSugestoes([]);
    try {
      if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');
      const supabase = getSupabaseClient();
      // Busca paginada com order para consistência (Supabase limita 1000 por chamada)
      const PAGE_SIZE = 1000;
      let page = 0;
      let todosNomes = new Set();
      let continuar = true;
      while (continuar) {
        const { data: pagina, error } = await supabase
          .from('realizado_local_ctes')
          .select('transportadora')
          .order('transportadora', { ascending: true })
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
        if (error) throw new Error(error.message);
        const nesta = pagina || [];
        nesta.forEach(r => { if (r.transportadora?.trim()) todosNomes.add(r.transportadora.trim()); });
        continuar = nesta.length === PAGE_SIZE;
        page++;
        if (page > 50) break; // segurança: no máximo 50.000 registros
      }
      const nomesCte = [...todosNomes].sort();
      const nomesTabela = transportadoras.map(t => t.nome).filter(Boolean);
      if (!nomesTabela.length) throw new Error('Nenhuma transportadora na tabela de fretes. Carregue a base primeiro.');
      const jaVinculados = new Set(vinculos.map(v => normalizarNomeTransp(v.nomeCte)));
      const sugs = [];
      for (const nomeCte of nomesCte) {
        if (jaVinculados.has(normalizarNomeTransp(nomeCte))) continue;
        let melhorScore = 0;
        let melhorTabela = '';
        for (const nomeTab of nomesTabela) {
          const score = similaridade(nomeCte, nomeTab);
          if (score > melhorScore) { melhorScore = score; melhorTabela = nomeTab; }
        }
        sugs.push({
          id: Date.now() + Math.random(),
          nomeCte,
          nomeTabela: melhorScore >= 0.4 ? melhorTabela : '',
          score: melhorScore,
        });
      }
      const comSugestao = sugs.filter(s => s.nomeTabela).sort((a, b) => b.score - a.score);
      const semSugestao = sugs.filter(s => !s.nomeTabela).sort((a, b) => a.nomeCte.localeCompare(b.nomeCte));
      setSugestoes(comSugestao);
      setSemVinculo(semSugestao);
      if (!sugs.length) setErroSugestoes('Todas as transportadoras do CT-e já estão vinculadas.');
    } catch (err) {
      setErroSugestoes(err.message || 'Erro ao gerar sugestões.');
    } finally {
      setCarregandoSugestoes(false);
    }
  };

  const confirmarSugestao = (id) => {
    const sug = sugestoes.find(s => s.id === id);
    if (!sug) return;
    salvarVinculos([...vinculos, { id: Date.now(), nomeCte: sug.nomeCte, nomeTabela: sug.nomeTabela }]);
    setSugestoes(prev => prev.filter(s => s.id !== id));
  };

  const descartarSugestao = (id) => setSugestoes(prev => prev.filter(s => s.id !== id));

  const editarSugestao = (id, campo, valor) => setSugestoes(prev => prev.map(s => s.id === id ? {...s, [campo]: valor} : s));

  const confirmarTodasSugestoes = () => {
    const novas = sugestoes
      .filter(s => s.nomeTabela.trim())
      .map(s => ({ id: Date.now() + Math.random(), nomeCte: s.nomeCte, nomeTabela: s.nomeTabela }));
    salvarVinculos([...vinculos, ...novas]);
    setSugestoes([]);
  };
  const editarSemVinculo = (id, valor) => setSemVinculo(prev => prev.map(s => s.id === id ? {...s, nomeTabela: valor} : s));
  const confirmarSemVinculo = (id) => {
    const item = semVinculo.find(s => s.id === id);
    if (!item || !item.nomeTabela.trim()) return;
    salvarVinculos([...vinculos, { id: Date.now(), nomeCte: item.nomeCte, nomeTabela: item.nomeTabela }]);
    setSemVinculo(prev => prev.filter(s => s.id !== id));
  };
  const descartarSemVinculo = (id) => setSemVinculo(prev => prev.filter(s => s.id !== id));

  const importarVinculosJson = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { try { const d = JSON.parse(ev.target.result); if (Array.isArray(d)) salvarVinculos(d); } catch {} };
    reader.readAsText(file); e.target.value = '';
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="amd-mini-brand">AMD Log • Ferramentas</div>
        <h1>Ferramentas</h1>
        <p>Clique em uma ferramenta para expandir.</p>
      </div>

      {erro ? <div className="sim-alert error">{erro}</div> : null}
      {mensagem ? <div className="sim-alert info">{mensagem}</div> : null}

      {sessao?.perfil === 'GESTAO' && (
        <div className="panel-card" style={{padding:0,overflow:'hidden'}}>
          <button type="button" onClick={() => toggleAba('sla')} style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'14px 20px',border:'none',background:'none',textAlign:'left',cursor:'pointer',borderBottom:abaAberta==='sla'?'1px solid var(--border-soft)':'none'}}>
            <div>
              <div className="panel-title" style={{margin:0}}>🔔 Configurações de SLA e Alertas da Auditoria</div>
              <div style={{fontSize:12,color:'var(--muted)',marginTop:2}}>Prazos de alerta e e-mails de escalonamento da Auditoria Lotação</div>
            </div>
            <span style={{fontSize:18,color:'var(--muted)'}}>{abaAberta==='sla'?'△':'▽'}</span>
          </button>
          {abaAberta === 'sla' && (
            <div style={{padding:'0 0 4px'}}>
              <SlaAuditoriaConfig canal="LOTACAO" />
            </div>
          )}
        </div>
      )}

      <div className="panel-card" style={{padding:0,overflow:'hidden'}}>
        <button type="button" onClick={() => toggleAba('historico')} style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'14px 20px',border:'none',background:'none',textAlign:'left',cursor:'pointer',borderBottom:abaAberta==='historico'?'1px solid var(--border-soft)':'none'}}>
          <div>
            <div className="panel-title" style={{margin:0}}>📦 Atualizar histórico de cargas</div>
            <div style={{fontSize:12,color:'var(--muted)',marginTop:2}}>Alimenta a Lotação e a Auditoria Lotação — {resumoLotacao?.totalCargas || 0} cargas na base atual</div>
          </div>
          <span style={{fontSize:18,color:'var(--muted)'}}>{abaAberta==='historico'?'△':'▽'}</span>
        </button>
        {abaAberta === 'historico' && (
          <div style={{padding:'0 0 4px'}}>
            <ImportarFluxoCard onImportado={setBaseFluxoLotacao} resumo={resumoLotacao} />
          </div>
        )}
      </div>

      {/* Vinculos cidade -> IBGE */}
      <div className="panel-card" style={{padding:0,overflow:'hidden'}}>
        <button type="button" onClick={() => toggleAba('cidade-ibge')} style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'14px 20px',border:'none',background:'none',textAlign:'left',cursor:'pointer',borderBottom:abaAberta==='cidade-ibge'?'1px solid var(--border-soft)':'none'}}>
          <div>
            <div className="panel-title" style={{margin:0}}>🗺️ Vínculos cidade → IBGE</div>
            <div style={{fontSize:12,color:'var(--muted)',marginTop:2}}>Resolve cidades que não casam na lista oficial (ex.: Brasília)</div>
          </div>
          <span style={{fontSize:18,color:'var(--muted)'}}>{abaAberta==='cidade-ibge'?'△':'▽'}</span>
        </button>
        {abaAberta === 'cidade-ibge' && <VinculosCidadeIbgeCard />}
      </div>

      {/* Pendencias de canal */}
      <div className="panel-card" style={{padding:0,overflow:'hidden'}}>
        <button type="button" onClick={() => { toggleAba('pendencias-canal'); if (abaAberta !== 'pendencias-canal' && !pendenciasCanal.length) carregarPendenciasCanal(); }} style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'14px 20px',border:'none',background:'none',textAlign:'left',cursor:'pointer',borderBottom:abaAberta==='pendencias-canal'?'1px solid var(--border-soft)':'none'}}>
          <div>
            <div className="panel-title" style={{margin:0}}>Pendencias de Canal</div>
            <div style={{fontSize:12,color:'var(--muted)',marginTop:2}}>Transportadoras com CT-es ou Tracking em A DEFINIR</div>
          </div>
          <span style={{fontSize:18,color:'var(--muted)'}}>{abaAberta==='pendencias-canal'?'△':'▽'}</span>
        </button>
        {abaAberta === 'pendencias-canal' && (
          <div style={{padding:'16px 20px',display:'grid',gap:14}}>
            <div className="summary-strip" style={{flexWrap:'wrap',gap:10}}>
              <div className="summary-card"><span>Transportadoras pendentes</span><strong>{fmtNumero(resumoPendenciasCanal.transportadoras)}</strong><small>A DEFINIR</small></div>
              <div className="summary-card"><span>CT-es pendentes</span><strong>{fmtNumero(resumoPendenciasCanal.ctes)}</strong><small>realizado_local_ctes</small></div>
              <div className="summary-card"><span>Tracking pendente</span><strong>{fmtNumero(resumoPendenciasCanal.tracking)}</strong><small>tracking_rows</small></div>
              <div className="summary-card"><span>Valor CT-e afetado</span><strong>{fmtMoeda(resumoPendenciasCanal.valorCte)}</strong><small>canal a definir</small></div>
            </div>
            <div className="actions-right">
              <button className="btn-secondary" type="button" onClick={carregarPendenciasCanal} disabled={carregandoPendenciasCanal}>
                {carregandoPendenciasCanal ? 'Carregando...' : 'Recarregar pendencias'}
              </button>
            </div>
            <div className="hint-box compact">
              Esta lista vem da view <code>pendencias_canal_transportadora</code>. Ao definir o canal, a parametrizacao fica salva e os registros atuais em A DEFINIR sao atualizados.
            </div>
            <div className="sim-analise-tabela-wrap">
              <table className="sim-analise-tabela">
                <thead>
                  <tr>
                    <th>Transportadora</th>
                    <th>Motivo</th>
                    <th>Canal original</th>
                    <th>Registros</th>
                    <th>CT-es</th>
                    <th>Tracking</th>
                    <th>Valor CT-e</th>
                    <th>Peso</th>
                    <th>Ultima ocorrencia</th>
                    <th>Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {pendenciasCanal.map((item) => (
                    <tr key={item.transportadoraNormalizada || item.transportadora}>
                      <td><strong>{item.transportadora}</strong><div style={{fontSize:11,color:'var(--muted)'}}>{item.basesAfetadas}</div></td>
                      <td>{item.motivo}</td>
                      <td>{item.canalOriginal || '-'}</td>
                      <td>{fmtNumero(item.quantidadeTotal)}</td>
                      <td>{fmtNumero(item.quantidadeCtes)}</td>
                      <td>{fmtNumero(item.quantidadeTracking)}</td>
                      <td>{fmtMoeda(item.valorTotalCte)}</td>
                      <td>{fmtNumero(item.pesoTotal, 2)} kg</td>
                      <td>{fmtData(item.ultimaOcorrencia)}</td>
                      <td>
                        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                          {CANAIS_PARAMETRIZAVEIS.map((canal) => {
                            const key = `${item.transportadora}|${canal}`;
                            return (
                              <button
                                key={canal}
                                className="btn-secondary"
                                type="button"
                                style={{minHeight:28,padding:'0 8px',fontSize:11}}
                                disabled={salvandoCanalPendencia === key}
                                onClick={() => definirCanalPendencia(item, canal)}
                              >
                                {salvandoCanalPendencia === key ? 'Salvando...' : canal}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!pendenciasCanal.length && (
                    <tr><td colSpan="10">{carregandoPendenciasCanal ? 'Carregando pendencias...' : 'Nenhuma pendencia de canal encontrada.'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Grade de peso */}
      <div className="panel-card" style={{padding:0,overflow:'hidden'}}>
        <button type="button" onClick={() => toggleAba('grade')} style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'14px 20px',border:'none',background:'none',textAlign:'left',cursor:'pointer',borderBottom:abaAberta==='grade'?'1px solid var(--border-soft)':'none'}}>
          <div>
            <div className="panel-title" style={{margin:0}}>⚖️ Grade de peso, NF e cubagem</div>
            <div style={{fontSize:12,color:'var(--muted)',marginTop:2}}>Faixas usadas pelo simulador e pelo realizado local</div>
          </div>
          <span style={{fontSize:18,color:'var(--muted)'}}>{abaAberta==='grade'?'▴':'▾'}</span>
        </button>
        {abaAberta === 'grade' && (
          <div style={{padding:'16px 20px',display:'grid',gap:14}}>
            <div className="section-row compact-top">
              <div className="toggle-row">
                {CANAIS_GRADE.map((item) => (
                  <button key={item} type="button" className={canalGrade === item ? 'toggle-btn active' : 'toggle-btn'} onClick={() => setCanalGrade(item)}>{item}</button>
                ))}
              </div>
              <div className="actions-right gap-row">
                <button className="btn-secondary" type="button" onClick={atualizarCubagemGradePeloTracking} disabled={atualizandoCubagemGrade}>
                  {atualizandoCubagemGrade ? 'Calculando médias...' : 'Atualizar médias pelo Tracking'}
                </button>
                <button className="btn-secondary" type="button" onClick={restaurarGradePadrao} disabled={atualizandoCubagemGrade}>Restaurar padrão</button>
                <button className="btn-primary" type="button" onClick={salvarGradeAtual} disabled={atualizandoCubagemGrade}>Salvar grade</button>
              </div>
            </div>
            <div className="sim-analise-tabela-wrap">
              <table className="sim-analise-tabela">
                <thead><tr><th>Limite até kg</th><th>Valor NF padrão</th><th>Cubagem padrão m³</th><th>Observação</th><th>Ação</th></tr></thead>
                <tbody>
                  {(grade[canalGrade] || []).map((linha, index) => (
                    <tr key={`${canalGrade}-${index}`}>
                      <td><input value={linha.peso ?? ''} onChange={(e) => alterarGrade(index, 'peso', e.target.value)} placeholder="Ex.: 50" /></td>
                      <td><input value={linha.valorNF ?? ''} onChange={(e) => alterarGrade(index, 'valorNF', e.target.value)} placeholder="Ex.: 2000" /></td>
                      <td><input value={linha.cubagem ?? ''} onChange={(e) => alterarGrade(index, 'cubagem', e.target.value)} placeholder="Ex.: 0,320" /></td>
                      <td>
                        Usa esta cubagem para pesos até {linha.peso || '...'} kg.
                        {linha.cubagemFonte === 'tracking_media' && (
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                            Média Tracking: {Number(linha.cubagemAmostra || 0).toLocaleString('pt-BR')} registro(s)
                            {Number(linha.volumesMediosTracking || 0) > 0 ? ` · ${Number(linha.volumesMediosTracking || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} vol. médios` : ''}
                          </div>
                        )}
                      </td>
                      <td><button className="btn-secondary" type="button" onClick={() => removerFaixaGrade(index)}>Remover</button></td>
                    </tr>
                  ))}
                  {!(grade[canalGrade] || []).length && <tr><td colSpan="5">Nenhuma faixa cadastrada.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="actions-right">
              <button className="btn-secondary" type="button" onClick={adicionarFaixaGrade}>Adicionar faixa</button>
            </div>
            <div className="hint-box compact">
              A regra usa a primeira faixa com limite maior ou igual ao peso informado.
              Se o CT-e não encontrar cubagem no Tracking, o simulador usa esta cubagem padrão como estimativa para calcular peso cubado.
              O botão de médias usa a mediana do Tracking por canal/faixa para reduzir distorções por outliers.
            </div>
          </div>
        )}
      </div>

      {/* Exportar volumetria */}
      <div className="panel-card" style={{padding:0,overflow:'hidden'}}>
        <button type="button" onClick={() => toggleAba('volumetria')} style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'14px 20px',border:'none',background:'none',textAlign:'left',cursor:'pointer',borderBottom:abaAberta==='volumetria'?'1px solid var(--border-soft)':'none'}}>
          <div>
            <div className="panel-title" style={{margin:0}}>📊 Exportar volumetria</div>
            <div style={{fontSize:12,color:'var(--muted)',marginTop:2}}>Gera Excel agrupado a partir da base de Tracking para precificação</div>
          </div>
          <span style={{fontSize:18,color:'var(--muted)'}}>{abaAberta==='volumetria'?'▴':'▾'}</span>
        </button>
        {abaAberta === 'volumetria' && (
          <div style={{padding:'16px 20px',display:'grid',gap:14}}>
            <div className="form-grid three">
              <label className="field">Canal<select value={config.canal} onChange={(e) => alterar('canal', e.target.value)}>{CANAIS.map((item) => <option key={item} value={item}>{item || 'Todos'}</option>)}</select></label>
              <label className="field">Período inicial<input type="date" value={config.inicio} onChange={(e) => alterar('inicio', e.target.value)} /></label>
              <label className="field">Período final<input type="date" value={config.fim} onChange={(e) => alterar('fim', e.target.value)} /></label>
            </div>
            <div className="form-grid three">
              <label className="field">Origem<input value={config.origem} onChange={(e) => alterar('origem', e.target.value)} placeholder="Ex.: Sinop, Itajaí" /></label>
              <label className="field">UF origem<select value={config.ufOrigem} onChange={(e) => alterar('ufOrigem', e.target.value)}>{UF_OPTIONS.map((uf) => <option key={`o-${uf||'t'}`} value={uf}>{uf || 'Todas'}</option>)}</select></label>
              <label className="field">UF destino<select value={config.ufDestino} onChange={(e) => alterar('ufDestino', e.target.value)}>{UF_OPTIONS.map((uf) => <option key={`d-${uf||'t'}`} value={uf}>{uf || 'Todas'}</option>)}</select></label>
            </div>
            <div className="form-grid three">
              <label className="field">Agrupamento
                <select value={config.agrupamento} onChange={(e) => alterar('agrupamento', e.target.value)}>
                  <option value="cidade">Cidade/UF origem x destino</option>
                  {config.incluirIbge ? <option value="cidade_ibge">Cidade/UF + IBGE</option> : null}
                  {config.incluirIbge ? <option value="ibge">IBGE x IBGE</option> : null}
                  <option value="estado">Estado x estado</option>
                </select>
              </label>
              <label className="checkbox-line"><input type="checkbox" checked={Boolean(config.excluirEbazar)} onChange={(e) => alterar('excluirEbazar', e.target.checked)} />Retirar EBAZAR</label>
              <label className="checkbox-line"><input type="checkbox" checked={Boolean(config.incluirIbge)} onChange={(e) => alterarIncluirIbge(e.target.checked)} />Incluir colunas IBGE (mais lento)</label>
              <label className="checkbox-line"><input type="checkbox" checked={Boolean(config.incluirDetalhe)} onChange={(e) => alterar('incluirDetalhe', e.target.checked)} />Incluir aba sem agrupamento</label>
              <label className="checkbox-line"><input type="checkbox" checked={Boolean(config.usarBaseCte)} onChange={(e) => alterar('usarBaseCte', e.target.checked)} />Gerar direto da base de CT-es (sem Tracking)</label>
              <label className="checkbox-line"><input type="checkbox" checked={Boolean(config.vincularCtes)} onChange={(e) => alterar('vincularCtes', e.target.checked)} disabled={Boolean(config.somenteComCteVinculado) || Boolean(config.usarBaseCte)} />Vincular com CT-es do Supabase</label>
              <label className="checkbox-line"><input type="checkbox" checked={Boolean(config.somenteComCteVinculado)} onChange={(e) => alterarSomenteVinculados(e.target.checked)} disabled={Boolean(config.usarBaseCte)} />Somente CT-es com Tracking vinculado</label>
            </div>
            <div className="hint-box compact">{config.usarBaseCte
              ? 'Modo base CT-es (recomendado): lê a volumetria/cubagem direto da base de CT-es (realizado_local_ctes), sem buscar o Tracking nem cruzar chaves. Mais rápido e sem timeout, já que a base de CT-es foi enriquecida com volumes e cubagem.'
              : 'Modo Tracking: lê o Tracking do Supabase com paginação. A cubagem usa a cubagem final do Tracking; quando marcado "somente vinculado", exporta só registros CT-e × Tracking.'}</div>
            <div className="actions-right">
              <button className="btn-primary" type="button" onClick={exportarVolumetria} disabled={carregando}>
                {carregando ? 'Gerando...' : 'Gerar Excel de volumetria'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Vínculos de transportadoras */}
      <div className="panel-card" style={{padding:0,overflow:'hidden'}}>
        <button type="button" onClick={() => toggleAba('vinculos')} style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'14px 20px',border:'none',background:'none',textAlign:'left',cursor:'pointer',borderBottom:abaAberta==='vinculos'?'1px solid var(--border-soft)':'none'}}>
          <div>
            <div className="panel-title" style={{margin:0}}>🔗 Vínculos de transportadoras</div>
            <div style={{fontSize:12,color:'var(--muted)',marginTop:2}}>{vinculos.length} vínculo(s) · Nome no CT-e → Nome na tabela de fretes</div>
          </div>
          <span style={{fontSize:18,color:'var(--muted)'}}>{abaAberta==='vinculos'?'▴':'▾'}</span>
        </button>
        {abaAberta === 'vinculos' && (
          <div style={{padding:'16px 20px',display:'grid',gap:14}}>
            <div className="hint-box compact">
              Use quando o nome da transportadora no CT-e for diferente do nome na tabela de fretes.<br/>
              Ex: <strong>"3G TRANSPORTE LTDA"</strong> no CT-e → <strong>"3G TRANSPORTE"</strong> na tabela.<br/>
              Os vínculos agora são salvos no Supabase e também ficam em cache local. Eles são usados no Simulador do realizado e na Análise por origem.
            </div>

            <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
              <button className="btn-primary" onClick={gerarSugestoes} disabled={carregandoSugestoes || salvandoVinculos}>
                {carregandoSugestoes ? 'Atualizando...' : '🔄 Atualizar transportadoras sem vínculo'}
              </button>
              <button className="btn-secondary" type="button" onClick={carregarVinculosOnline} disabled={salvandoVinculos}>
                Recarregar vínculos do Supabase
              </button>
              <button className="btn-secondary" type="button" onClick={salvarEdicaoVinculos} disabled={salvandoVinculos}>
                {salvandoVinculos ? 'Salvando...' : 'Salvar vínculos'}
              </button>
              <span style={{fontSize:12,color:'var(--muted)'}}>Fonte: {fonteVinculos === 'supabase' ? 'Supabase' : 'local/cache'}</span>
              {sugestoes.length > 0 && (
                <button className="btn-secondary" onClick={confirmarTodasSugestoes} disabled={salvandoVinculos}>
                  Vincular todas com sugestão ({sugestoes.filter(s=>s.nomeTabela).length})
                </button>
              )}
            </div>

            {erroSugestoes && <div style={{color:'#9b2323',fontSize:13,padding:'8px 12px',background:'#fff1f1',borderRadius:8}}>{erroSugestoes}</div>}

            {semVinculo.length > 0 && (
              <div style={{display:'grid',gap:8}}>
                <div style={{fontSize:13,fontWeight:600,color:'#87640d',padding:'8px 12px',background:'#fff7df',borderRadius:8,border:'1px solid #ead28c'}}>
                  ⚠ {semVinculo.length} transportadora(s) sem sugestão — preencha o nome da tabela:
                </div>
                {semVinculo.map(s => (
                  <div key={s.id} style={{display:'grid',gridTemplateColumns:'1fr 1fr auto auto',gap:8,alignItems:'center',padding:'8px 12px',border:'1px solid #ead28c',borderRadius:10,background:'#fffbf0'}}>
                    <div style={{fontSize:13,color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={s.nomeCte}>{s.nomeCte}</div>
                    <div>
                      <input
                        value={s.nomeTabela||''}
                        onChange={e=>editarSemVinculo(s.id,e.target.value)}
                        style={{fontSize:13,width:'100%'}}
                        placeholder="Digite ou selecione..."
                        list={`sv-list-${s.id}`}
                      />
                      <datalist id={`sv-list-${s.id}`}>
                        {transportadoras.map(t=><option key={t.id||t.nome} value={t.nome}/>)}
                      </datalist>
                    </div>
                    <button className="btn-primary" style={{minHeight:32,padding:'0 12px',fontSize:12}} disabled={!s.nomeTabela} onClick={()=>confirmarSemVinculo(s.id)}>✓</button>
                    <button className="btn-secondary" style={{minHeight:32,padding:'0 12px',fontSize:12}} onClick={()=>descartarSemVinculo(s.id)}>✕</button>
                  </div>
                ))}
              </div>
            )}

            {sugestoes.length > 0 && (
              <div style={{display:'grid',gap:8}}>
                <div style={{fontSize:13,fontWeight:600,color:'var(--muted)'}}>
                  {sugestoes.length} transportadora(s) do CT-e sem vínculo · Verde = match automático · Amarelo = preencher manualmente
                </div>
                {sugestoes.map(s => (
                  <div key={s.id} style={{display:'grid',gridTemplateColumns:'1fr 1fr auto auto',gap:8,alignItems:'center',padding:'8px 12px',border:'1px solid var(--border-soft)',borderRadius:10,background: s.score >= 0.8 ? '#f0fff4' : s.score >= 0.4 ? '#f8faff' : '#fffbf0'}}>
                    <div style={{display:'flex',flexDirection:'column',gap:3}}>
                      <span style={{fontSize:10,color:'var(--muted)'}}>{s.score >= 0.8 ? '✓ Alta similaridade' : s.score >= 0.4 ? '~ Sugestão' : '⚠ Preencher manualmente'}</span>
                      <input value={s.nomeCte} onChange={e=>editarSugestao(s.id,'nomeCte',e.target.value)} style={{fontSize:13}} readOnly title={s.nomeCte} />
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:3}}>
                      <span style={{fontSize:10,color:'var(--muted)'}}>Nome na tabela de fretes</span>
                      <input value={s.nomeTabela} onChange={e=>editarSugestao(s.id,'nomeTabela',e.target.value)} style={{fontSize:13}} placeholder="Selecione ou digite..." list={`tabela-list-${s.id}`} />
                      <datalist id={`tabela-list-${s.id}`}>
                        {transportadoras.map(t => <option key={t.id||t.nome} value={t.nome} />)}
                      </datalist>
                    </div>
                    <button className="btn-primary" style={{minHeight:32,padding:'0 12px',fontSize:12}} disabled={!s.nomeTabela} onClick={()=>confirmarSugestao(s.id)}>✓</button>
                    <button className="btn-secondary" style={{minHeight:32,padding:'0 12px',fontSize:12}} onClick={()=>descartarSugestao(s.id)}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr auto',gap:10,alignItems:'end'}}>
              <div className="field">
                <label>Nome no CT-e</label>
                <input value={novoNomeCte} onChange={e=>setNovoNomeCte(e.target.value)} placeholder="Ex.: 3G TRANSPORTE LTDA" />
              </div>
              <div className="field">
                <label>Nome na tabela de fretes</label>
                <input value={novoNomeTabela} onChange={e=>setNovoNomeTabela(e.target.value)} placeholder="Ex.: 3G TRANSPORTE" onKeyDown={e=>e.key==='Enter'&&adicionarVinculo()} />
              </div>
              <button className="btn-primary" onClick={adicionarVinculo} disabled={!novoNomeCte.trim()||!novoNomeTabela.trim()||salvandoVinculos}>Adicionar</button>
            </div>
            {vinculos.length > 0 && (
              <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
                <input value={buscaVinculo} onChange={e=>setBuscaVinculo(e.target.value)} placeholder="Buscar vínculo..." style={{flex:1,minWidth:200}} />
                <button className="btn-secondary" onClick={exportarVinculosJson}>Exportar JSON</button>
                <label className="btn-secondary" style={{cursor:'pointer',display:'inline-flex',alignItems:'center'}}>
                  Importar JSON<input type="file" accept=".json" onChange={importarVinculosJson} hidden />
                </label>
              </div>
            )}
            {vinclosFiltrados.length > 0 ? (
              <div className="sim-analise-tabela-wrap">
                <table className="sim-analise-tabela">
                  <thead><tr><th>Nome no CT-e</th><th>Nome na tabela de fretes</th><th style={{width:80}}>Ação</th></tr></thead>
                  <tbody>
                    {vinclosFiltrados.map(v => (
                      <tr key={v.id}>
                        <td><input value={v.nomeCte} onChange={e=>editarVinculo(v.id,'nomeCte',e.target.value)} style={{width:'100%'}} /></td>
                        <td><input value={v.nomeTabela} onChange={e=>editarVinculo(v.id,'nomeTabela',e.target.value)} style={{width:'100%'}} /></td>
                        <td><button className="btn-danger" style={{minHeight:30,padding:'0 10px',fontSize:12}} onClick={()=>removerVinculo(v.id)}>Remover</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="hint-box compact" style={{textAlign:'center'}}>{vinculos.length === 0 ? 'Nenhum vínculo cadastrado ainda.' : 'Nenhum resultado para esse filtro.'}</div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
