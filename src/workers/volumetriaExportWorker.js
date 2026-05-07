import * as XLSX from 'xlsx';
import { exportarTrackingLocal } from '../utils/trackingLocal';
import { exportarRealizadoLocal } from '../services/realizadoLocalDb';
import { relacionarTrackingComCtes } from '../utils/trackingCteLink';
import { carregarMunicipiosIbgeDb } from '../services/freteDatabaseService';
import { encontrarLinhaGradePorPeso } from '../utils/gradeFreteConfig';

const UF_POR_CODIGO_IBGE = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

const CHUNK_SIZE = 5000;
const DETALHE_SHEET_LIMIT = 100000;

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

async function carregarMunicipiosSeguro() {
  try {
    const municipios = await carregarMunicipiosIbgeDb();
    return Array.isArray(municipios) ? municipios : [];
  } catch {
    return [];
  }
}

async function completarGeografiaVolumetria(rows = []) {
  postProgress({ percentual: 35, mensagem: 'Carregando base de municípios para completar UF/IBGE...' });
  const municipios = await carregarMunicipiosSeguro();

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

async function montarVolumetria(rows = [], config = {}, grade = {}) {
  const mapa = new Map();

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
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

async function montarDetalhes(rows = [], grade = {}) {
  const detalhes = [];
  for (let index = 0; index < rows.length; index += 1) {
    detalhes.push(detalheTrackingRow(rows[index], grade));
    if (index > 0 && index % CHUNK_SIZE === 0) {
      postProgress({ percentual: 84 + Math.round((index / rows.length) * 6), mensagem: `Preparando detalhe por nota: ${index.toLocaleString('pt-BR')} linha(s)...` });
      await waitFrame();
    }
  }
  return detalhes;
}

function buildResumoRows({ config, rowsBase, volumetria, totalCompativel, limit, resumoVinculo }) {
  return [{
    Canal: config.canal || 'Todos',
    Periodo_Inicial: config.inicio || 'Todos',
    Periodo_Final: config.fim || 'Todos',
    Origem: config.origem || 'Todas',
    UF_Origem: config.ufOrigem || 'Todas',
    UF_Destino: config.ufDestino || 'Todas',
    Agrupamento: config.agrupamento,
    Notas_Exportadas: rowsBase.length,
    Linhas_Volumetria: volumetria.length,
    Total_Compativel_Antes_Filtros_Finais: totalCompativel || rowsBase.length,
    Limite_Leitura: limit || '',
    Vinculo_CTE_Ativo: config.vincularCtes ? 'Sim' : 'Não',
    CTEs_Vinculados: resumoVinculo?.vinculadas || 0,
    Detalhe_por_Nota: config.incluirDetalhe ? 'Sim' : 'Não',
  }];
}

async function gerarArquivoVolumetria({ config = {}, grade = {} }) {
  const filtroBase = {
    canal: config.canal,
    inicio: config.inicio,
    fim: config.fim,
    origem: config.origem,
    excluirEbazar: Boolean(config.excluirEbazar),
  };

  postProgress({ percentual: 5, mensagem: 'Lendo Tracking local em segundo plano...' });
  const { rows, totalCompativel, limit } = await exportarTrackingLocal(filtroBase, { limit: Number(config.limiteLeitura || 500000) });

  if (!rows.length) {
    throw new Error('Não existe base de Tracking local com os filtros informados. Importe primeiro no módulo Tracking.');
  }

  let rowsBase = rows;
  let resumoVinculo = null;

  if (config.vincularCtes) {
    postProgress({ percentual: 22, mensagem: 'Buscando CT-es locais para completar UF/IBGE...' });
    const ctes = await exportarRealizadoLocal(filtroBase, { limit: Number(config.limiteLeitura || 500000) });
    postProgress({ percentual: 28, mensagem: 'Relacionando Tracking com CT-es locais...' });
    const relacionamento = relacionarTrackingComCtes(rows, ctes.rows || []);
    rowsBase = relacionamento.rows;
    resumoVinculo = relacionamento.resumo;
  } else {
    postProgress({ percentual: 28, mensagem: 'Vínculo com CT-e desligado. Seguindo somente com Tracking...' });
  }

  rowsBase = await completarGeografiaVolumetria(rowsBase);
  rowsBase = aplicarFiltrosFinais(rowsBase, config);

  if (!rowsBase.length) {
    throw new Error('Após completar UF/IBGE, nenhuma linha ficou dentro dos filtros de origem/UF selecionados.');
  }

  postProgress({ percentual: 72, mensagem: 'Agrupando volumetria...' });
  const volumetria = await montarVolumetria(rowsBase, config, grade);

  postProgress({ percentual: 88, mensagem: 'Montando arquivo Excel...' });
  const wb = XLSX.utils.book_new();
  appendJsonSheet(wb, 'Resumo', buildResumoRows({ config, rowsBase, volumetria, totalCompativel, limit, resumoVinculo }));
  appendJsonSheet(wb, 'Volumetria_Agrupada', volumetria);

  let detalheSheets = 0;
  if (config.incluirDetalhe) {
    const detalhes = await montarDetalhes(rowsBase, grade);
    for (let index = 0; index < detalhes.length; index += DETALHE_SHEET_LIMIT) {
      detalheSheets += 1;
      appendJsonSheet(wb, detalheSheets === 1 ? 'Detalhe_Notas' : `Detalhe_${detalheSheets}`, detalhes.slice(index, index + DETALHE_SHEET_LIMIT));
      await waitFrame();
    }
  }

  postProgress({ percentual: 96, mensagem: 'Gerando download do Excel...' });
  const arrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: false });
  const fileName = `volumetria-transportador-${config.canal || 'todos'}-${Date.now()}.xlsx`;

  return {
    arrayBuffer,
    fileName,
    resumo: {
      notas: rowsBase.length,
      linhasVolumetria: volumetria.length,
      vinculadas: resumoVinculo?.vinculadas || 0,
      detalheSheets,
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
