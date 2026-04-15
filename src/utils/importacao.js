import * as XLSX from 'xlsx';

function normalizeHeader(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  return Number(String(value).replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
}

function isBlankRow(row) {
  return !row.some((cell) => String(cell ?? '').trim());
}

function inferFromFilename(filename = '') {
  const clean = String(filename).replace(/\.[^.]+$/, '');
  const parts = clean.split(' - ').map((item) => item.trim()).filter(Boolean);
  return {
    origem: parts[0] || '',
    transportadora: parts[1] || '',
  };
}

function canalFromUnit(value) {
  const text = String(value || '').toUpperCase();
  if (text.includes('B2C')) return 'B2C';
  if (text.includes('B2B') || text.includes('ATACADO')) return 'ATACADO';
  return 'ATACADO';
}

function buildRowsFromSheet(ws, tipo) {
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const markers = {
    rotas: ['codigo ibge destino', 'cotacao'],
    cotacoes: ['rota do frete', 'peso limite'],
    taxas: ['ibge destino'],
    generalidades: ['transportadora', 'origem'],
  };
  const expected = markers[tipo] || [];
  let headerIndex = 0;

  for (let i = 0; i < Math.min(aoa.length, 20); i += 1) {
    const normalized = (aoa[i] || []).map(normalizeHeader);
    if (expected.every((marker) => normalized.includes(marker))) {
      headerIndex = i;
      break;
    }
  }

  const headers = (aoa[headerIndex] || []).map((cell, idx) => normalizeHeader(cell) || `coluna_${idx + 1}`);
  const rows = [];
  for (let i = headerIndex + 1; i < aoa.length; i += 1) {
    const raw = aoa[i] || [];
    if (isBlankRow(raw)) continue;
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = raw[idx] ?? '';
    });
    row.__rowNum = i + 1;
    rows.push(row);
  }
  return { rows, headerIndex: headerIndex + 1 };
}

function firstFilled(row, keys) {
  for (const key of keys) {
    const normalized = normalizeHeader(key);
    if (row[normalized] !== undefined && row[normalized] !== null && row[normalized] !== '') return row[normalized];
  }
  return '';
}

function mapCommon(row, meta, overrides = {}) {
  const transportadora = overrides.transportadora || String(firstFilled(row, ['nome da transportadora', 'transportadora', 'nome transportadora'])).trim() || meta.transportadora;
  const origem = overrides.origem || String(firstFilled(row, ['origem', 'cidade origem'])).trim() || meta.origem;
  const unidade = String(firstFilled(row, ['codigo da unidade', 'unidade', 'codigo unidade'])).trim();
  const canalPlanilha = String(firstFilled(row, ['canal'])).trim().toUpperCase();
  const canalInferido = canalFromUnit(unidade);
  const canalFinal = canalPlanilha || (canalInferido !== 'ATACADO' ? canalInferido : '') || String(overrides.canal || '').trim().toUpperCase() || 'ATACADO';
  return {
    transportadora,
    origem,
    canal: canalFinal,
    status: 'Ativa',
    unidade,
  };
}

export function parseFileToRows(file, tipo) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = event.target?.result;
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const { rows, headerIndex } = buildRowsFromSheet(sheet, tipo);
        resolve({
          rows,
          meta: {
            fileName: file.name,
            sheetName,
            headerIndex,
            ...inferFromFilename(file.name),
          },
        });
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export function buildImportPayload(parsed, tipo, overrides = {}) {
  const transportadoras = new Map();
  const erros = [];
  let inseridos = 0;
  const { rows, meta } = parsed;

  function ensureTransportadora(common) {
    const key = `${common.transportadora}__${common.origem}`;
    if (!common.transportadora) throw new Error('Transportadora não identificada. Use o nome no arquivo ou no nome do arquivo.');
    if (!common.origem) throw new Error('Origem não identificada. Use a coluna de origem ou o nome do arquivo no padrão "Origem - Transportadora - Tipo".');
    if (!transportadoras.has(key)) {
      transportadoras.set(key, {
        nome: common.transportadora,
        status: common.status,
        origem: {
          cidade: common.origem,
          canal: common.canal,
          status: common.status,
          generalidades: null,
          rotas: [],
          cotacoes: [],
          taxasEspeciais: [],
        },
      });
    }
    return transportadoras.get(key);
  }

  rows.forEach((row) => {
    try {
      const common = mapCommon(row, meta, overrides);
      const container = ensureTransportadora(common);

      if (tipo === 'rotas') {
        const ibgeDestino = String(firstFilled(row, ['codigo ibge destino', 'ibge destino'])).trim();
        const cotacao = String(firstFilled(row, ['cotacao', 'rota', 'nome rota'])).trim();
        if (!ibgeDestino) throw new Error('Código IBGE Destino inválido ou vazio.');
        if (!cotacao) throw new Error('Cotação/rota não informada.');
        const rota = {
          nomeRota: cotacao,
          cotacao,
          ibgeOrigem: String(firstFilled(row, ['codigo ibge origem', 'ibge origem'])).trim(),
          ibgeDestino,
          cepInicial: String(firstFilled(row, ['cep inicial'])).trim(),
          cepFinal: String(firstFilled(row, ['cep final'])).trim(),
          metodoEnvio: String(firstFilled(row, ['metodo de envio'])).trim(),
          canal: common.canal,
          prazoEntregaDias: toNumber(firstFilled(row, ['prazo de entrega', 'prazo'])),
          valorMinimoFrete: toNumber(firstFilled(row, ['frete minimo', 'valor minimo frete', 'minimo'])),
          inicioVigencia: String(firstFilled(row, ['inicio da vigencia'])).trim(),
          fimVigencia: String(firstFilled(row, ['termino da vigencia', 'fim da vigencia'])).trim(),
        };
        container.origem.rotas.push(rota);
        inseridos += 1;
      }

      if (tipo === 'cotacoes') {
        const rota = String(firstFilled(row, ['rota do frete', 'rota', 'nome rota'])).trim();
        if (!rota) throw new Error('Rota do frete não informada.');
        const cotacao = {
          rota,
          regraCalculo: String(firstFilled(row, ['regra de calculo'])).trim(),
          pesoMin: toNumber(firstFilled(row, ['peso minimo', 'peso min'])),
          pesoMax: toNumber(firstFilled(row, ['peso limite', 'peso maximo', 'peso max'])),
          excesso: toNumber(firstFilled(row, ['excesso de peso', 'excesso'])),
          rsKg: 0,
          valorFixo: toNumber(firstFilled(row, ['taxa aplicada', 'valor faixa', 'valor fixo'])),
          percentual: toNumber(firstFilled(row, ['frete percentual', 'percentual'])),
          freteMinimo: toNumber(firstFilled(row, ['frete minimo', 'minimo'])),
          canal: common.canal,
          inicioVigencia: String(firstFilled(row, ['inicio da vigencia'])).trim(),
          fimVigencia: String(firstFilled(row, ['fim da vigencia', 'termino da vigencia'])).trim(),
        };
        container.origem.cotacoes.push(cotacao);
        inseridos += 1;
      }

      if (tipo === 'taxas') {
        const ibgeDestino = String(firstFilled(row, ['ibge destino'])).trim();
        if (!ibgeDestino) throw new Error('IBGE destino é obrigatório.');
        container.origem.taxasEspeciais.push({
          ibgeDestino,
          tda: toNumber(firstFilled(row, ['tda r$', 'tda'])),
          trt: toNumber(firstFilled(row, ['trt r$', 'trt'])),
          suframa: toNumber(firstFilled(row, ['suframa r$', 'suframa'])),
          outras: toNumber(firstFilled(row, ['outras r$', 'outras'])),
          gris: firstFilled(row, ['gris %', 'gris']) === '' ? null : toNumber(firstFilled(row, ['gris %', 'gris'])),
          grisMinimo: firstFilled(row, ['gris minimo r$', 'gris minimo']) === '' ? null : toNumber(firstFilled(row, ['gris minimo r$', 'gris minimo'])),
          adVal: firstFilled(row, ['ad valorem %', 'ad val %', 'ad valorem']) === '' ? null : toNumber(firstFilled(row, ['ad valorem %', 'ad val %', 'ad valorem'])),
          adValMinimo: firstFilled(row, ['ad valorem minimo r$', 'ad val minimo r$', 'ad valorem minimo']) === '' ? null : toNumber(firstFilled(row, ['ad valorem minimo r$', 'ad val minimo r$', 'ad valorem minimo'])),
        });
        inseridos += 1;
      }

      if (tipo === 'generalidades') {
        container.origem.generalidades = {
          incideIcms: ['sim', 's', 'true', '1'].includes(String(firstFilled(row, ['incide icms', 'icms'])).trim().toLowerCase()),
          aliquotaIcms: toNumber(firstFilled(row, ['aliquota icms', 'icms %'])),
          adValorem: toNumber(firstFilled(row, ['ad valorem %', 'ad valorem'])),
          adValoremMinimo: toNumber(firstFilled(row, ['ad valorem minimo r$', 'ad valorem minimo'])),
          pedagio: toNumber(firstFilled(row, ['pedagio r$ 100kg', 'pedagio'])),
          gris: toNumber(firstFilled(row, ['gris %', 'gris'])),
          grisMinimo: toNumber(firstFilled(row, ['gris minimo r$', 'gris minimo'])),
          tas: toNumber(firstFilled(row, ['tas r$', 'tas'])),
          ctrc: toNumber(firstFilled(row, ['ctrc emitido r$', 'ctrc'])),
          cubagem: toNumber(firstFilled(row, ['cubagem kg m3', 'cubagem'])),
          tipoCalculo: String(firstFilled(row, ['tipo de calculo', 'tipo calculo'])).trim().toUpperCase() || 'PERCENTUAL',
          observacoes: String(firstFilled(row, ['observacoes'])).trim(),
        };
        inseridos += 1;
      }
    } catch (error) {
      erros.push({
        linha: row.__rowNum || '-',
        coluna: tipo === 'rotas' ? 'layout de rotas' : tipo === 'cotacoes' ? 'layout de fretes' : 'layout',
        valor: '',
        mensagem: error.message || 'Erro ao interpretar linha.',
      });
    }
  });

  return { transportadoras: Array.from(transportadoras.values()), erros, inseridos, meta };
}

function sheetRowsForTipo(tipo, rows = []) {
  if (tipo === 'rotas') {
    return rows.map((item) => ({
      'Nome da transportadora': item.transportadora || '',
      'Código da unidade': item.codigoUnidade || (String(item.canal || '').toUpperCase() === 'B2C' ? '0001 - B2C' : '0001 - B2B'),
      'Canal': item.canal || '',
      'Cotação': item.nomeRota || item.cotacao || '',
      'Código IBGE Origem': item.ibgeOrigem || '',
      'Código IBGE Destino': item.ibgeDestino || '',
      'CEP inicial': item.cepInicial || '',
      'CEP final': item.cepFinal || '',
      'Método de envio': item.metodoEnvio || 'Normal',
      'Prazo de entrega': item.prazoEntregaDias || '',
      'Início da vigência': item.inicioVigencia || '',
      'Término da vigência': item.fimVigencia || '',
    }));
  }
  if (tipo === 'cotacoes') {
    return rows.map((item) => ({
      'Nome da transportadora': item.transportadora || '',
      'Código da unidade': item.codigoUnidade || (String(item.canal || '').toUpperCase() === 'B2C' ? '0001 - B2C' : '0001 - B2B'),
      'Canal': item.canal || '',
      'Regra de cálculo': item.regraCalculo || 'Sem regra',
      'Rota do frete': item.rota || '',
      'Peso mínimo': item.pesoMin ?? '',
      'Peso limite': item.pesoMax ?? '',
      'Excesso de peso': item.excesso ?? '',
      'Taxa aplicada': item.valorFixo ?? '',
      'Frete percentual': item.percentual ?? '',
      'Frete mínimo': item.freteMinimo ?? '',
      'Início da vigência': item.inicioVigencia || '',
      'Fim da vigência': item.fimVigencia || '',
    }));
  }
  if (tipo === 'taxas') {
    return rows.map((item) => ({
      'IBGE Destino': item.ibgeDestino || '',
      'TDA (R$)': item.tda ?? '',
      'TRT (R$)': item.trt ?? '',
      'SUFRAMA (R$)': item.suframa ?? '',
      'Outras (R$)': item.outras ?? '',
      'GRIS (%)': item.gris ?? '',
      'GRIS Mínimo (R$)': item.grisMinimo ?? '',
      'Ad Valorem (%)': item.adVal ?? '',
      'Ad Valorem Mínimo (R$)': item.adValMinimo ?? '',
    }));
  }
  return rows.map((item) => ({
    'Transportadora': item.transportadora || '',
    'Origem': item.origem || '',
    'Canal': item.canal || '',
    'Incide ICMS': item.incideIcms ? 'Sim' : 'Não',
    'Alíquota ICMS %': item.aliquotaIcms ?? '',
    'Ad Valorem %': item.adValorem ?? '',
    'Ad Valorem Mínimo R$': item.adValoremMinimo ?? '',
    'Pedágio R$ 100kg': item.pedagio ?? '',
    'GRIS %': item.gris ?? '',
    'GRIS Mínimo R$': item.grisMinimo ?? '',
    'TAS R$': item.tas ?? '',
    'CTRC Emitido R$': item.ctrc ?? '',
    'Cubagem kg m3': item.cubagem ?? '',
    'Tipo de cálculo': item.tipoCalculo ?? '',
    'Observações': item.observacoes ?? '',
  }));
}

function prepModelRows(tipo) {
  if (tipo === 'rotas') {
    return sheetRowsForTipo(tipo, [{
      transportadora: 'ALFA', canal: 'ATACADO', codigoUnidade: '0001 - B2B', nomeRota: 'CAPITAL - SP', ibgeOrigem: '3505708', ibgeDestino: '3550308', cepInicial: '01000000', cepFinal: '05999999', metodoEnvio: 'Normal', prazoEntregaDias: 2, inicioVigencia: '2025-01-01', fimVigencia: '2025-12-31',
    }]);
  }
  if (tipo === 'cotacoes') {
    return sheetRowsForTipo(tipo, [{
      transportadora: 'ALFA', canal: 'ATACADO', codigoUnidade: '0001 - B2B', regraCalculo: 'Sem regra', rota: 'CAPITAL - SP', pesoMin: 0, pesoMax: 999999999, excesso: 0.62, valorFixo: 120, percentual: 1.95, freteMinimo: 38, inicioVigencia: '2025-01-01', fimVigencia: '2025-12-31',
    }]);
  }
  if (tipo === 'taxas') {
    return sheetRowsForTipo(tipo, [{ ibgeDestino: '3106200', tda: 10, trt: 5, suframa: 0, outras: 0, gris: 0.35, grisMinimo: 2.5, adVal: 0.2, adValMinimo: 3 }]);
  }
  return sheetRowsForTipo(tipo, [{ transportadora: 'ALFA', origem: 'Barueri', canal: 'ATACADO', incideIcms: false, aliquotaIcms: 0, adValorem: 0.25, adValoremMinimo: 3, pedagio: 12, gris: 0.3, grisMinimo: 2, tas: 2.5, ctrc: 1.8, cubagem: 300, tipoCalculo: 'PERCENTUAL', observacoes: 'Modelo de generalidades' }]);
}

export function downloadWorkbook({ tipo, rows, fileName }) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, tipo === 'cotacoes' ? 'Valores de frete' : tipo === 'rotas' ? 'Prazos de frete' : 'Dados');
  XLSX.writeFile(wb, fileName);
}

export function baixarModelo(tipo) {
  downloadWorkbook({ tipo, rows: prepModelRows(tipo), fileName: `modelo-${tipo}.xlsx` });
}

export function exportarSecao(tipo, rows, fileName) {
  downloadWorkbook({ tipo, rows: sheetRowsForTipo(tipo, rows), fileName });
}

export function buildCoberturaReport(transportadoras) {
  const detalhes = [];
  transportadoras.forEach((transportadora) => {
    (transportadora.origens || []).forEach((origem) => {
      const totalRotas = (origem.rotas || []).length;
      const totalCotacoes = (origem.cotacoes || []).length;
      const totalTaxas = (origem.taxasEspeciais || []).length;
      const possuiGeneralidades = !!origem.generalidades;
      const destinos = new Set((origem.rotas || []).map((rota) => String(rota.ibgeDestino || '').trim()).filter(Boolean));
      const cobertura = totalRotas === 0
        ? 'Sem rotas'
        : totalCotacoes === 0
          ? 'Sem cotações'
          : !possuiGeneralidades
            ? 'Sem generalidades'
            : 'Completa';
      detalhes.push({
        transportadora: transportadora.nome,
        origem: origem.cidade,
        canal: origem.canal,
        cobertura,
        totalRotas,
        totalCotacoes,
        totalTaxas,
        destinos: destinos.size,
        status: origem.status,
      });
    });
  });

  const resumoTransportadora = Array.from(
    detalhes.reduce((acc, item) => {
      const current = acc.get(item.transportadora) || { transportadora: item.transportadora, origens: 0, destinos: 0, rotas: 0, cotacoes: 0, pendencias: 0 };
      current.origens += 1;
      current.destinos += item.destinos;
      current.rotas += item.totalRotas;
      current.cotacoes += item.totalCotacoes;
      current.pendencias += item.cobertura === 'Completa' ? 0 : 1;
      acc.set(item.transportadora, current);
      return acc;
    }, new Map()).values(),
  ).sort((a, b) => b.pendencias - a.pendencias || a.transportadora.localeCompare(b.transportadora));

  return {
    detalhes,
    resumoTransportadora,
    totais: {
      origens: detalhes.length,
      completas: detalhes.filter((item) => item.cobertura === 'Completa').length,
      pendentes: detalhes.filter((item) => item.cobertura !== 'Completa').length,
      destinos: detalhes.reduce((acc, item) => acc + item.destinos, 0),
    },
  };
}
