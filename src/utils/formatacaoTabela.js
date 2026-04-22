import * as XLSX from 'xlsx';

export const FAIXAS_PADRAO = {
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

export const TIPO_CALCULO_OPTIONS = [
  { value: 'percentual', label: 'Percentual' },
  { value: 'faixa', label: 'Faixa de peso' },
];

export const CANAL_OPTIONS = ['ATACADO', 'B2C', 'B2B'];

export function criarRascunhoVazio() {
  return {
    dadosGerais: {
      nomeTabela: '',
      transportadora: '',
      codigoUnidade: '',
      canal: 'ATACADO',
      metodoEnvio: 'Rodoviário',
      regraCalculo: 'Tabela padrão',
      tipoCalculo: 'percentual',
      vigenciaInicial: '',
      vigenciaFinal: '',
      observacoes: '',
    },
    rotas: [],
    fretes: [],
    faixasCustomizadas: [],
    modeloFaixas: 'padrao-canal',
    id: `fmt-${Date.now()}`,
    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
  };
}

function normalizarTexto(valor) {
  return String(valor ?? '').trim();
}

function normalizarNumero(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  const texto = String(valor).replace(/\./g, '').replace(',', '.').trim();
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : valor;
}

export function importarRotasDeArquivo(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        const rotas = rows
          .map((row, index) => {
            const mapped = mapearLinhaRota(row);
            return {
              id: `rota-import-${Date.now()}-${index}`,
              cotacao: normalizarTexto(mapped.cotacao),
              ibgeOrigem: normalizarTexto(mapped.ibgeOrigem),
              ibgeDestino: normalizarTexto(mapped.ibgeDestino),
              cepInicial: normalizarTexto(mapped.cepInicial),
              cepFinal: normalizarTexto(mapped.cepFinal),
              prazo: normalizarTexto(mapped.prazo),
            };
          })
          .filter((item) => item.cotacao || item.ibgeDestino || item.cepInicial || item.cepFinal);
        resolve(rotas);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsArrayBuffer(file);
  });
}

function mapearLinhaRota(row) {
  const normalizado = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [normalizarTexto(key).toLowerCase(), value]),
  );

  const obter = (...keys) => {
    for (const key of keys) {
      const valor = normalizado[key.toLowerCase()];
      if (valor !== undefined && valor !== null && String(valor).trim() !== '') return valor;
    }
    return '';
  };

  return {
    cotacao: obter('cotação', 'cotacao', 'rota', 'rota do frete'),
    ibgeOrigem: obter('código ibge origem', 'codigo ibge origem', 'ibge origem'),
    ibgeDestino: obter('código ibge destino', 'codigo ibge destino', 'ibge destino'),
    cepInicial: obter('cep inicial', 'faixa cep inicial'),
    cepFinal: obter('cep final', 'faixa cep final'),
    prazo: obter('prazo', 'prazo de entrega'),
  };
}

export function gerarFretesDoRascunho(rascunho) {
  const { dadosGerais, rotas, modeloFaixas, faixasCustomizadas } = rascunho;
  if (dadosGerais.tipoCalculo === 'percentual') {
    return rotas.map((rota, index) => ({
      id: `frete-perc-${index}-${rota.id}`,
      rotaId: rota.id,
      rotaFrete: rota.cotacao,
      pesoMinimo: '',
      pesoLimite: '',
      excessoPeso: '',
      taxaAplicada: '',
      fretePercentual: '',
      freteMinimo: '',
    }));
  }

  const faixas = obterFaixasAtivas(dadosGerais.canal, modeloFaixas, faixasCustomizadas);
  const linhas = [];
  rotas.forEach((rota) => {
    faixas.forEach((faixa, faixaIndex) => {
      linhas.push({
        id: `frete-faixa-${rota.id}-${faixa.id || faixaIndex}`,
        rotaId: rota.id,
        rotaFrete: rota.cotacao,
        pesoMinimo: faixa.pesoMinimo,
        pesoLimite: faixa.pesoLimite,
        excessoPeso: '',
        taxaAplicada: '',
        fretePercentual: '',
        freteMinimo: '',
      });
    });
  });
  return linhas;
}

export function obterFaixasAtivas(canal, modeloFaixas, faixasCustomizadas = []) {
  if (modeloFaixas === 'customizado' && faixasCustomizadas.length) {
    return faixasCustomizadas;
  }
  return FAIXAS_PADRAO[canal] || FAIXAS_PADRAO.B2B;
}

export function validarRascunho(rascunho) {
  const erros = [];
  const alertas = [];
  const { dadosGerais, rotas, fretes } = rascunho;

  if (!dadosGerais.transportadora) erros.push('Informe a transportadora.');
  if (!dadosGerais.codigoUnidade) erros.push('Informe o código da unidade/origem.');
  if (!dadosGerais.vigenciaInicial) erros.push('Informe a vigência inicial.');
  if (!rotas.length) erros.push('Adicione pelo menos uma rota.');
  if (!fretes.length) erros.push('Gere a estrutura de fretes antes de revisar.');

  const rotasSemPrazo = rotas.filter((item) => !item.prazo);
  if (rotasSemPrazo.length) alertas.push(`${rotasSemPrazo.length} rota(s) sem prazo preenchido.`);

  const rotasSemIbge = rotas.filter((item) => !item.ibgeDestino);
  if (rotasSemIbge.length) alertas.push(`${rotasSemIbge.length} rota(s) sem IBGE de destino.`);

  const chaves = new Set();
  rotas.forEach((rota) => {
    const chave = `${rota.cotacao}|${rota.ibgeOrigem}|${rota.ibgeDestino}|${rota.cepInicial}|${rota.cepFinal}`;
    if (chaves.has(chave)) {
      alertas.push(`Rota duplicada detectada na cotação ${rota.cotacao || '(sem nome)'}.`);
    }
    chaves.add(chave);
  });

  const fretesSemRota = fretes.filter((item) => !item.rotaFrete);
  if (fretesSemRota.length) erros.push('Existem linhas de frete sem rota vinculada.');

  return { erros, alertas };
}

export function montarLinhasRotas(rascunho) {
  const { dadosGerais, rotas } = rascunho;
  return rotas.map((rota) => ({
    'Nome da transportadora': dadosGerais.transportadora,
    'Código da unidade': dadosGerais.codigoUnidade,
    Canal: dadosGerais.canal,
    Cotação: rota.cotacao,
    'Código IBGE origem': rota.ibgeOrigem,
    'Código IBGE destino': rota.ibgeDestino,
    'CEP inicial': rota.cepInicial,
    'CEP final': rota.cepFinal,
    'Método de envio': dadosGerais.metodoEnvio,
    Prazo: rota.prazo,
    Vigência: montarVigenciaTexto(dadosGerais),
  }));
}

export function montarLinhasFretes(rascunho) {
  const { dadosGerais, fretes } = rascunho;
  return fretes.map((frete) => ({
    'Nome da transportadora': dadosGerais.transportadora,
    'Código da unidade': dadosGerais.codigoUnidade,
    Canal: dadosGerais.canal,
    'Regra de cálculo': dadosGerais.regraCalculo,
    'Tipo de cálculo': dadosGerais.tipoCalculo === 'percentual' ? 'Percentual' : 'Faixa de peso',
    'Rota do frete': frete.rotaFrete,
    'Peso mínimo': normalizarNumero(frete.pesoMinimo),
    'Peso limite': normalizarNumero(frete.pesoLimite),
    'Excesso de peso': normalizarNumero(frete.excessoPeso),
    'Taxa aplicada': normalizarNumero(frete.taxaAplicada),
    'Frete percentual': normalizarNumero(frete.fretePercentual),
    'Frete mínimo': normalizarNumero(frete.freteMinimo),
    Vigência: montarVigenciaTexto(dadosGerais),
  }));
}

function montarVigenciaTexto(dadosGerais) {
  const inicio = dadosGerais.vigenciaInicial || '';
  const fim = dadosGerais.vigenciaFinal || '';
  if (inicio && fim) return `${inicio} até ${fim}`;
  return inicio || fim || '';
}

function baixarWorkbook(workbook, fileName) {
  XLSX.writeFile(workbook, fileName);
}

export function exportarRotasExcel(rascunho) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(montarLinhasRotas(rascunho));
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Rotas');
  baixarWorkbook(workbook, `rotas-${slug(rascunho.dadosGerais.transportadora || 'tabela')}.xlsx`);
}

export function exportarFretesExcel(rascunho) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(montarLinhasFretes(rascunho));
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Fretes');
  baixarWorkbook(workbook, `fretes-${slug(rascunho.dadosGerais.transportadora || 'tabela')}.xlsx`);
}

export function exportarPacoteExcel(rascunho) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(montarLinhasRotas(rascunho)), 'Rotas');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(montarLinhasFretes(rascunho)), 'Fretes');
  baixarWorkbook(workbook, `formatacao-${slug(rascunho.dadosGerais.transportadora || 'tabela')}.xlsx`);
}

function slug(valor) {
  return String(valor || 'arquivo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}
