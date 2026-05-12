import { useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

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
  vincularCtes: false,
};

const CANAIS = ['', 'ATACADO', 'B2C'];
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

function faixaVolumetria(canal, peso, grade = {}) {
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
    item.Cubagem_m3 += toNumber(row.cubagem);
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
    Cubagem_m3: toNumber(row.cubagem),
    Valor_NF: toNumber(row.valorNF),
    Complementado_CTE: row.enderecoComplementadoPorCte ? 'Sim' : 'Não',
    Complementado_Recorrencia: row.enderecoComplementadoPorRecorrencia ? 'Sim' : 'Não',
    Campos_Complementados: [row.camposComplementadosPorCte, row.camposComplementadosPorRecorrencia].filter(Boolean).join(' | '),
  };
}

function normalizarValorInput(value) {
  return String(value ?? '').replace(',', '.');
}

export default function FerramentasPage({ transportadoras = [] }) {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const [grade, setGrade] = useState(() => carregarGradeFrete());
  const [canalGrade, setCanalGrade] = useState('ATACADO');

  const alterar = (campo, valor) => setConfig((prev) => ({ ...prev, [campo]: valor }));

  const alterarIncluirIbge = (checked) => {
    setConfig((prev) => ({
      ...prev,
      incluirIbge: checked,
      vincularCtes: checked ? prev.vincularCtes : false,
      agrupamento: checked || !['ibge', 'cidade_ibge'].includes(prev.agrupamento) ? prev.agrupamento : 'cidade',
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
      setMensagem(`Volumetria exportada: ${(resumo.notas || 0).toLocaleString('pt-BR')} nota(s)/linha(s), ${(resumo.linhasVolumetria || 0).toLocaleString('pt-BR')} linha(s) agrupadas${resumo.incluirIbge ? ', com colunas IBGE' : ', sem colunas IBGE'}${resumo.vinculadas ? `, ${resumo.vinculadas.toLocaleString('pt-BR')} com CT-e vinculado` : ''}. Cubagem total e Valor_NF líquido do frete aplicados. Modo rápido em segundo plano aplicado.`);
    } catch (error) {
      setErro(error.message || 'Erro ao gerar volumetria.');
    } finally {
      setCarregando(false);
    }
  }

  // Accordion
  const [abaAberta, setAbaAberta] = useState('grade');
  const toggleAba = (aba) => setAbaAberta(prev => prev === aba ? null : aba);

  // Vínculos de transportadoras (localStorage)
  const [vinculos, setVinculos] = useState(() => {
    try { return JSON.parse(localStorage.getItem('vinculos-transportadoras') || '[]'); } catch { return []; }
  });
  const [novoNomeCte, setNovoNomeCte] = useState('');
  const [novoNomeTabela, setNovoNomeTabela] = useState('');
  const [buscaVinculo, setBuscaVinculo] = useState('');

  const salvarVinculos = (lista) => {
    setVinculos(lista);
    localStorage.setItem('vinculos-transportadoras', JSON.stringify(lista));
  };
  const adicionarVinculo = () => {
    if (!novoNomeCte.trim() || !novoNomeTabela.trim()) return;
    salvarVinculos([...vinculos, { id: Date.now(), nomeCte: novoNomeCte.trim(), nomeTabela: novoNomeTabela.trim() }]);
    setNovoNomeCte(''); setNovoNomeTabela('');
  };
  const removerVinculo = (id) => salvarVinculos(vinculos.filter(v => v.id !== id));
  const editarVinculo = (id, campo, valor) => salvarVinculos(vinculos.map(v => v.id === id ? {...v, [campo]: valor} : v));
  const vinclosFiltrados = vinculos.filter(v => !buscaVinculo || v.nomeCte.toLowerCase().includes(buscaVinculo.toLowerCase()) || v.nomeTabela.toLowerCase().includes(buscaVinculo.toLowerCase()));
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
                <button className="btn-secondary" type="button" onClick={restaurarGradePadrao}>Restaurar padrão</button>
                <button className="btn-primary" type="button" onClick={salvarGradeAtual}>Salvar grade</button>
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
                      <td>Usa esta cubagem para pesos até {linha.peso || '...'} kg.</td>
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
            <div className="hint-box compact">A regra usa a primeira faixa com limite maior ou igual ao peso informado.</div>
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
              <label className="checkbox-line"><input type="checkbox" checked={Boolean(config.vincularCtes)} onChange={(e) => alterar('vincularCtes', e.target.checked)} disabled={!config.incluirIbge} />Vincular com CT-es locais</label>
            </div>
            <div className="hint-box compact">Modo rápido: deixe IBGE desligado. A cubagem exportada considera cubagem unitária × volumes.</div>
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
              Os vínculos são salvos localmente e usados na Análise por origem.
            </div>

            <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
              <button className="btn-primary" onClick={gerarSugestoes} disabled={carregandoSugestoes}>
                {carregandoSugestoes ? 'Carregando...' : '📋 Listar transportadoras do CT-e'}
              </button>
              {sugestoes.length > 0 && (
                <button className="btn-secondary" onClick={confirmarTodasSugestoes}>
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
              <button className="btn-primary" onClick={adicionarVinculo} disabled={!novoNomeCte.trim()||!novoNomeTabela.trim()}>Adicionar</button>
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
