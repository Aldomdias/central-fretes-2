import * as XLSX from 'xlsx';

export const CANAL_OPTIONS = ['ATACADO', 'B2C', 'B2B'];
export const METODO_ENVIO_OPTIONS = ['Normal', 'Expresso'];
export const REGRA_CALCULO_OPTIONS = ['Maior valor', 'Menor valor', 'Sem regra'];
export const TIPO_CALCULO_OPTIONS = [
  { value: 'percentual', label: 'Percentual' },
  { value: 'faixa', label: 'Faixa de peso' },
];

export const FAIXAS_PADRAO = {
  ATACADO: [
    { id: 'ata-1', pesoMinimo: 0, pesoLimite: 20 },
    { id: 'ata-2', pesoMinimo: 20, pesoLimite: 30 },
    { id: 'ata-3', pesoMinimo: 30, pesoLimite: 50 },
    { id: 'ata-4', pesoMinimo: 50, pesoLimite: 70 },
    { id: 'ata-5', pesoMinimo: 70, pesoLimite: 100 },
  ],
  B2B: [
    { id: 'b2b-1', pesoMinimo: 0, pesoLimite: 20 },
    { id: 'b2b-2', pesoMinimo: 20, pesoLimite: 35 },
    { id: 'b2b-3', pesoMinimo: 35, pesoLimite: 50 },
    { id: 'b2b-4', pesoMinimo: 50, pesoLimite: 70 },
    { id: 'b2b-5', pesoMinimo: 70, pesoLimite: 100 },
  ],
  B2C: [
    { id: 'b2c-1', pesoMinimo: 0, pesoLimite: 2 },
    { id: 'b2c-2', pesoMinimo: 2, pesoLimite: 5 },
    { id: 'b2c-3', pesoMinimo: 5, pesoLimite: 10 },
    { id: 'b2c-4', pesoMinimo: 10, pesoLimite: 20 },
    { id: 'b2c-5', pesoMinimo: 20, pesoLimite: 30 },
  ],
};

const ROTAS_HEADERS = [
  'Nome da transportadora',
  'Código da unidade',
  'Canal',
  'Cotação',
  'Código IBGE Origem',
  'Código IBGE Destino',
  'CEP inicial',
  'CEP final',
  'Método de envio',
  'Prazo de entrega',
  'Início da vigência',
  'Término da vigência',
];

const FRETES_HEADERS = [
  'Nome da transportadora',
  'Código da unidade',
  'Canal',
  'Regra de cálculo',
  'Tipo de cálculo',
  'Rota do frete',
  'Peso mínimo',
  'Peso limite',
  'Excesso de peso',
  'Taxa aplicada',
  'Frete percentual',
  'Frete mínimo',
  'Início da vigência',
  'Fim da vigência',
];

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function criarRascunhoVazio() {
  return {
    id: makeId('fmt'),
    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
    dadosGerais: {
      nomeFormatacao: '',
      transportadora: '',
      origem: '',
      codigoUnidade: '',
      ibgeOrigem: '',
      canal: 'ATACADO',
      metodoEnvio: 'Normal',
      regraCalculo: 'Maior valor',
      tipoCalculo: 'percentual',
      vigenciaInicial: '',
      vigenciaFinal: '',
      observacoes: '',
    },
    rotas: [],
    fretes: [],
    modeloFaixas: 'padrao-canal',
    faixasCustomizadas: [],
  };
}

export function gerarNomeFormatacao(dadosGerais) {
  const partes = [dadosGerais.transportadora, dadosGerais.origem, dadosGerais.canal].filter(Boolean);
  return partes.join(' | ');
}

function normalizarTexto(valor) {
  return String(valor ?? '').trim();
}

function toIsoDate(valor) {
  if (!valor) return '';
  if (typeof valor === 'number') {
    const date = XLSX.SSF.parse_date_code(valor);
    if (!date) return '';
    const d = new Date(Date.UTC(date.y, date.m - 1, date.d));
    return d.toISOString().slice(0, 10);
  }
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return valor.toISOString().slice(0, 10);
  }
  const texto = String(valor).trim();
  if (!texto) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(texto)) {
    const [dia, mes, ano] = texto.split('/');
    return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  }
  const parsed = new Date(texto);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return texto;
}

function normalizarNumero(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  if (typeof valor === 'number') return valor;
  const texto = String(valor).replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : valor;
}

function criarSheetComLarguras(linhas, headers, larguras = []) {
  const worksheet = XLSX.utils.json_to_sheet(linhas, { header: headers });
  worksheet['!cols'] = larguras.length ? larguras.map((wch) => ({ wch })) : headers.map((header) => ({ wch: Math.max(16, header.length + 2) }));
  return worksheet;
}

function baixarWorkbook(workbook, nome) {
  XLSX.writeFile(workbook, nome);
}

function slug(valor) {
  return String(valor || 'arquivo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function obterValor(normalizado, ...keys) {
  for (const key of keys) {
    const valor = normalizado[key.toLowerCase()];
    if (valor !== undefined && valor !== null && String(valor).trim() !== '') return valor;
  }
  return '';
}

export function mapearLinhaRota(row) {
  const normalizado = Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizarTexto(key).toLowerCase(), value]));
  return {
    cotacao: normalizarTexto(obterValor(normalizado, 'cotação', 'cotacao', 'rota', 'rota do frete')),
    ibgeDestino: normalizarTexto(obterValor(normalizado, 'código ibge destino', 'codigo ibge destino', 'ibge destino')),
    cepInicial: normalizarTexto(obterValor(normalizado, 'cep inicial', 'faixa cep inicial')),
    cepFinal: normalizarTexto(obterValor(normalizado, 'cep final', 'faixa cep final')),
    prazo: normalizarTexto(obterValor(normalizado, 'prazo de entrega', 'prazo')),
  };
}

export function mapearLinhaFrete(row) {
  const normalizado = Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizarTexto(key).toLowerCase(), value]));
  return {
    rotaFrete: normalizarTexto(obterValor(normalizado, 'rota do frete', 'cotação', 'cotacao', 'rota')),
    pesoMinimo: normalizarNumero(obterValor(normalizado, 'peso mínimo', 'peso minimo')),
    pesoLimite: normalizarNumero(obterValor(normalizado, 'peso limite')),
    excessoPeso: normalizarNumero(obterValor(normalizado, 'excesso de peso')),
    taxaAplicada: normalizarNumero(obterValor(normalizado, 'taxa aplicada')),
    fretePercentual: normalizarNumero(obterValor(normalizado, 'frete percentual')),
    freteMinimo: normalizarNumero(obterValor(normalizado, 'frete mínimo', 'frete minimo')),
  };
}

function lerPrimeiraAba(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        resolve(rows);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsArrayBuffer(file);
  });
}

export async function importarRotasDeArquivo(file) {
  const rows = await lerPrimeiraAba(file);
  return rows
    .map((row, index) => ({ id: makeId(`rota-${index}`), ...mapearLinhaRota(row) }))
    .filter((item) => item.cotacao || item.ibgeDestino || item.cepInicial || item.cepFinal || item.prazo);
}

export async function importarFretesDeArquivo(file) {
  const rows = await lerPrimeiraAba(file);
  return rows
    .map((row, index) => ({ id: makeId(`frete-${index}`), rotaId: '', ...mapearLinhaFrete(row) }))
    .filter((item) => item.rotaFrete || item.pesoMinimo !== '' || item.pesoLimite !== '' || item.fretePercentual !== '' || item.freteMinimo !== '');
}

export function obterFaixasAtivas(canal, modeloFaixas, faixasCustomizadas = []) {
  if (modeloFaixas === 'customizado' && faixasCustomizadas.length) return faixasCustomizadas;
  return FAIXAS_PADRAO[canal] || FAIXAS_PADRAO.ATACADO;
}

export function gerarFretesDoRascunho(rascunho) {
  const { dadosGerais, rotas, modeloFaixas, faixasCustomizadas } = rascunho;
  if (dadosGerais.tipoCalculo === 'percentual') {
    return rotas.map((rota) => ({
      id: makeId('frete'),
      rotaId: rota.id,
      rotaFrete: rota.cotacao,
      pesoMinimo: 0,
      pesoLimite: 999999999,
      excessoPeso: '',
      taxaAplicada: '',
      fretePercentual: '',
      freteMinimo: '',
    }));
  }

  const faixas = obterFaixasAtivas(dadosGerais.canal, modeloFaixas, faixasCustomizadas);
  return rotas.flatMap((rota) =>
    faixas.map((faixa) => ({
      id: makeId('frete'),
      rotaId: rota.id,
      rotaFrete: rota.cotacao,
      pesoMinimo: faixa.pesoMinimo,
      pesoLimite: faixa.pesoLimite,
      excessoPeso: '',
      taxaAplicada: '',
      fretePercentual: '',
      freteMinimo: '',
    })),
  );
}

export function validarRascunho(rascunho) {
  const erros = [];
  const alertas = [];
  const { dadosGerais, rotas, fretes } = rascunho;

  if (!dadosGerais.transportadora) erros.push('Informe a transportadora.');
  if (!dadosGerais.origem && !dadosGerais.codigoUnidade) erros.push('Informe a origem ou o código da unidade.');
  if (!dadosGerais.vigenciaInicial) erros.push('Informe a vigência inicial.');
  if (!dadosGerais.vigenciaFinal) erros.push('Informe a vigência final.');
  if (!rotas.length) erros.push('Adicione pelo menos uma rota.');
  if (!fretes.length) erros.push('Gere ou importe os fretes antes de revisar.');

  const rotasSemPrazo = rotas.filter((rota) => !rota.prazo);
  if (rotasSemPrazo.length) alertas.push(`${rotasSemPrazo.length} rota(s) sem prazo de entrega.`);

  const rotasSemIbge = rotas.filter((rota) => !rota.ibgeDestino);
  if (rotasSemIbge.length) alertas.push(`${rotasSemIbge.length} rota(s) sem IBGE de destino.`);

  const rotasSemCep = rotas.filter((rota) => !rota.cepInicial && !rota.cepFinal);
  if (rotasSemCep.length) alertas.push(`${rotasSemCep.length} rota(s) usarão a base de IBGEs por não terem faixa de CEP.`);

  const duplicadas = new Set();
  rotas.forEach((rota) => {
    const chave = [rota.cotacao, rota.ibgeDestino, rota.cepInicial, rota.cepFinal].join('|');
    if (duplicadas.has(chave)) alertas.push(`Rota duplicada detectada para a cotação ${rota.cotacao || '(sem nome)'}.`);
    duplicadas.add(chave);
  });

  const fretesSemRota = fretes.filter((frete) => !frete.rotaFrete);
  if (fretesSemRota.length) erros.push('Existem fretes sem rota do frete.');

  return { erros, alertas };
}

export function montarLinhasRotas(rascunho) {
  const { dadosGerais, rotas } = rascunho;
  return rotas.map((rota) => ({
    'Nome da transportadora': dadosGerais.transportadora,
    'Código da unidade': dadosGerais.codigoUnidade || dadosGerais.origem,
    'Canal': dadosGerais.canal,
    'Cotação': rota.cotacao,
    'Código IBGE Origem': dadosGerais.ibgeOrigem || '',
    'Código IBGE Destino': rota.ibgeDestino || '',
    'CEP inicial': rota.cepInicial || '',
    'CEP final': rota.cepFinal || '',
    'Método de envio': dadosGerais.metodoEnvio,
    'Prazo de entrega': normalizarNumero(rota.prazo),
    'Início da vigência': toIsoDate(dadosGerais.vigenciaInicial),
    'Término da vigência': toIsoDate(dadosGerais.vigenciaFinal),
  }));
}

export function montarLinhasFretes(rascunho) {
  const { dadosGerais, fretes } = rascunho;
  return fretes.map((frete) => ({
    'Nome da transportadora': dadosGerais.transportadora,
    'Código da unidade': dadosGerais.codigoUnidade || dadosGerais.origem,
    'Canal': dadosGerais.canal,
    'Regra de cálculo': dadosGerais.regraCalculo,
    'Tipo de cálculo': dadosGerais.tipoCalculo === 'percentual' ? 'PERCENTUAL' : 'FAIXA DE PESO',
    'Rota do frete': frete.rotaFrete,
    'Peso mínimo': normalizarNumero(frete.pesoMinimo),
    'Peso limite': normalizarNumero(frete.pesoLimite),
    'Excesso de peso': normalizarNumero(frete.excessoPeso),
    'Taxa aplicada': normalizarNumero(frete.taxaAplicada),
    'Frete percentual': normalizarNumero(frete.fretePercentual),
    'Frete mínimo': normalizarNumero(frete.freteMinimo),
    'Início da vigência': toIsoDate(dadosGerais.vigenciaInicial),
    'Fim da vigência': toIsoDate(dadosGerais.vigenciaFinal),
  }));
}

export function exportarModeloRotas(rascunho) {
  const workbook = XLSX.utils.book_new();
  const linhaModelo = {
    'Nome da transportadora': rascunho.dadosGerais.transportadora || '',
    'Código da unidade': rascunho.dadosGerais.codigoUnidade || rascunho.dadosGerais.origem || '',
    'Canal': rascunho.dadosGerais.canal || '',
    'Cotação': '',
    'Código IBGE Origem': rascunho.dadosGerais.ibgeOrigem || '',
    'Código IBGE Destino': '',
    'CEP inicial': '',
    'CEP final': '',
    'Método de envio': rascunho.dadosGerais.metodoEnvio || '',
    'Prazo de entrega': '',
    'Início da vigência': toIsoDate(rascunho.dadosGerais.vigenciaInicial),
    'Término da vigência': toIsoDate(rascunho.dadosGerais.vigenciaFinal),
  };
  const worksheet = criarSheetComLarguras([linhaModelo], ROTAS_HEADERS, [24, 24, 12, 34, 18, 18, 14, 14, 16, 16, 16, 16]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Prazos de frete');
  baixarWorkbook(workbook, `modelo-rotas-${slug(gerarNomeFormatacao(rascunho.dadosGerais) || 'tabela')}.xlsx`);
}

export function exportarModeloFretes(rascunho) {
  const workbook = XLSX.utils.book_new();
  const linhas = montarLinhasFretes({ ...rascunho, fretes: rascunho.fretes.length ? rascunho.fretes : gerarFretesDoRascunho(rascunho) });
  const base = linhas.length
    ? linhas
    : [{
        'Nome da transportadora': rascunho.dadosGerais.transportadora || '',
        'Código da unidade': rascunho.dadosGerais.codigoUnidade || rascunho.dadosGerais.origem || '',
        'Canal': rascunho.dadosGerais.canal || '',
        'Regra de cálculo': rascunho.dadosGerais.regraCalculo || '',
        'Tipo de cálculo': rascunho.dadosGerais.tipoCalculo === 'percentual' ? 'PERCENTUAL' : 'FAIXA DE PESO',
        'Rota do frete': '',
        'Peso mínimo': '',
        'Peso limite': '',
        'Excesso de peso': '',
        'Taxa aplicada': '',
        'Frete percentual': '',
        'Frete mínimo': '',
        'Início da vigência': toIsoDate(rascunho.dadosGerais.vigenciaInicial),
        'Fim da vigência': toIsoDate(rascunho.dadosGerais.vigenciaFinal),
      }];
  const worksheet = criarSheetComLarguras(base, FRETES_HEADERS, [24, 24, 12, 18, 18, 34, 12, 12, 14, 14, 16, 14, 16, 16]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Valores de frete');
  baixarWorkbook(workbook, `modelo-fretes-${slug(gerarNomeFormatacao(rascunho.dadosGerais) || 'tabela')}.xlsx`);
}

export function exportarRotasExcel(rascunho) {
  const workbook = XLSX.utils.book_new();
  const worksheet = criarSheetComLarguras(montarLinhasRotas(rascunho), ROTAS_HEADERS, [24, 24, 12, 34, 18, 18, 14, 14, 16, 16, 16, 16]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Prazos de frete');
  baixarWorkbook(workbook, `rotas-${slug(gerarNomeFormatacao(rascunho.dadosGerais) || 'tabela')}.xlsx`);
}

export function exportarFretesExcel(rascunho) {
  const workbook = XLSX.utils.book_new();
  const worksheet = criarSheetComLarguras(montarLinhasFretes(rascunho), FRETES_HEADERS, [24, 24, 12, 18, 18, 34, 12, 12, 14, 14, 16, 14, 16, 16]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Valores de frete');
  baixarWorkbook(workbook, `cotacoes-${slug(gerarNomeFormatacao(rascunho.dadosGerais) || 'tabela')}.xlsx`);
}

export function exportarPacoteExcel(rascunho) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, criarSheetComLarguras(montarLinhasRotas(rascunho), ROTAS_HEADERS, [24, 24, 12, 34, 18, 18, 14, 14, 16, 16, 16, 16]), 'Prazos de frete');
  XLSX.utils.book_append_sheet(workbook, criarSheetComLarguras(montarLinhasFretes(rascunho), FRETES_HEADERS, [24, 24, 12, 18, 18, 34, 12, 12, 14, 14, 16, 14, 16, 16]), 'Valores de frete');
  baixarWorkbook(workbook, `formatacao-${slug(gerarNomeFormatacao(rascunho.dadosGerais) || 'tabela')}.xlsx`);
}
