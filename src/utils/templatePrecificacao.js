
import { montarCotacaoPadrao, normalizarChave } from './formatacaoTabela';

function limpar(valor) {
  return String(valor ?? '').trim();
}

function paraNumero(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  const texto = String(valor)
    .replace(/R\\$/gi, '')
    .replace(/%/g, '')
    .trim()
    .replace(/\\./g, '')
    .replace(',', '.');
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : null;
}

function extrairFaixa(textoFaixa) {
  const texto = limpar(textoFaixa);
  const match = texto.match(/(\\d+[.,]?\\d*)\\s*(?:a|até|-).*?(\\d+[.,]?\\d*)/i);
  if (!match) return { pesoInicial: null, pesoFinal: null, faixaLabel: texto };
  return {
    pesoInicial: paraNumero(match[1]),
    pesoFinal: paraNumero(match[2]),
    faixaLabel: texto,
  };
}

function normalizarCotacaoBase(valor = '') {
  const chave = normalizarChave(valor);
  const mapa = {
    CAPITAL: 'Capital',
    'INTERIOR 1': 'Interior 1',
    'INTERIOR 2': 'Interior 2',
    'INTERIOR 3': 'Interior 3',
    'INTERIOR 4': 'Interior 4',
    'INTERIOR 5': 'Interior 5',
    'INTERIOR 6': 'Interior 6',
    'INTERIOR 7': 'Interior 7',
    'INTERIOR 8': 'Interior 8',
    'INTERIOR 9': 'Interior 9',
    METROPOLITANA: 'Metropolitana',
  };
  return mapa[chave] || limpar(valor);
}

function detectarBlocos(linha1 = [], linha2 = []) {
  const blocos = [];
  for (let i = 4; i < Math.max(linha1.length, linha2.length); i += 2) {
    const cotacaoBase = normalizarCotacaoBase(linha1[i]);
    const tipoFrete = limpar(linha2[i]);
    const tipoAdValorem = limpar(linha2[i + 1]);
    if (!cotacaoBase) continue;
    if (/frete\\s*kg/i.test(tipoFrete) && /ad\\s*valorem/i.test(tipoAdValorem)) {
      blocos.push({ cotacaoBase, colunaFrete: i, colunaAdValorem: i + 1 });
    }
  }
  return blocos;
}

export function converterTemplatePrecificacaoParaFretes({ linhas = [], dadosGerais = {} }) {
  if (!Array.isArray(linhas) || linhas.length < 3) return [];

  const linha1 = linhas[0] || [];
  const linha2 = linhas[1] || [];
  const blocos = detectarBlocos(linha1, linha2);
  const origemPadrao = limpar(dadosGerais.origemNome || dadosGerais.origem || '');

  const resultado = [];
  for (let i = 2; i < linhas.length; i += 1) {
    const linha = linhas[i] || [];
    const origem = limpar(linha[0]) || origemPadrao;
    const ufOrigem = limpar(linha[1]);
    const ufDestino = limpar(linha[2]);
    const { pesoInicial, pesoFinal, faixaLabel } = extrairFaixa(linha[3]);

    blocos.forEach((bloco) => {
      const freteValor = paraNumero(linha[bloco.colunaFrete]);
      const fretePercentual = paraNumero(linha[bloco.colunaAdValorem]);
      if (freteValor === null && fretePercentual === null) return;

      resultado.push({
        cotacaoBase: bloco.cotacaoBase,
        cotacao: montarCotacaoPadrao({ origem, ufDestino, cotacaoBase: bloco.cotacaoBase }),
        origem,
        ufOrigem,
        ufDestino,
        faixaNome: faixaLabel,
        pesoInicial,
        pesoFinal,
        freteValor: freteValor ?? '',
        fretePercentual: fretePercentual ?? '',
        freteMinimo: '',
        taxaAplicada: '',
        excedente: '',
        origemImportacao: 'template_precificacao',
      });
    });
  }

  return resultado;
}

function pegarCampo(row = {}, aliases = []) {
  for (const alias of aliases) {
    const valor = row[alias];
    if (valor !== undefined && valor !== null && String(valor).trim() !== '') return valor;
  }
  return '';
}

export function converterAbaRotasParaEstrutura({ rows = [] }) {
  const rotasMap = new Map();
  const quebras = [];

  rows.forEach((row) => {
    const ibgeOrigem = pegarCampo(row, ['IBGE ORIGEM', 'ibge_origem']);
    const origemNome = pegarCampo(row, ['CIDADE DE ORIGEM', 'cidade_de_origem']);
    const ufOrigem = pegarCampo(row, ['UF ORIGEM', 'uf_origem']);
    const ibgeDestino = pegarCampo(row, ['IBGE DESTINO', 'ibge_destino']);
    const ufDestino = pegarCampo(row, ['UF DESTINO', 'uf_destino']);
    const prazo = pegarCampo(row, ['PRAZO       (Somente nº)', 'PRAZO', 'prazo']);
    const cotacaoBase = normalizarCotacaoBase(
      pegarCampo(row, ['REGIÃO                     (Conforme TABELA B2B)', 'REGIÃO', 'REGIAO', 'COTAÇÃO', 'REGIÃO BASE'])
    );
    const cepInicial = pegarCampo(row, ['CEP INICIAL', 'cep_inicial']);
    const cepFinal = pegarCampo(row, ['CEP FINAL', 'cep_final']);

    if (!ibgeDestino || !cotacaoBase) return;

    const chave = `${String(ibgeDestino).trim()}|${String(prazo).trim()}|${normalizarChave(cotacaoBase)}|${String(ufDestino).trim()}`;
    if (!rotasMap.has(chave)) {
      rotasMap.set(chave, {
        id: `rota-import-${rotasMap.size + 1}`,
        ibgeDestino: String(ibgeDestino).trim(),
        prazo: String(prazo).trim(),
        cotacaoBase,
        ufDestino: String(ufDestino).trim(),
      });
    }

    if (String(cepInicial).trim() || String(cepFinal).trim()) {
      quebras.push({
        id: `qf-import-${quebras.length + 1}`,
        ibgeDestino: String(ibgeDestino).trim(),
        prazo: String(prazo).trim(),
        cotacaoBase,
        ufDestino: String(ufDestino).trim(),
        cepInicial: String(cepInicial).trim(),
        cepFinal: String(cepFinal).trim(),
      });
    }

    // Dados de origem da primeira linha útil podem alimentar o formulário
    if (!converterAbaRotasParaEstrutura.dadosOrigem && origemNome) {
      converterAbaRotasParaEstrutura.dadosOrigem = {
        origemNome: String(origemNome).trim(),
        origemIbge: String(ibgeOrigem).trim(),
        ufOrigem: String(ufOrigem).trim(),
      };
    }
  });

  const dadosOrigem = converterAbaRotasParaEstrutura.dadosOrigem || {};
  converterAbaRotasParaEstrutura.dadosOrigem = null;

  return {
    rotas: Array.from(rotasMap.values()),
    quebras,
    dadosOrigem,
  };
}

export function converterWorkbookTemplateParaEstrutura({ XLSX, workbook, dadosGerais = {} }) {
  const nomes = workbook?.SheetNames || [];
  const abaRotas = nomes.find((nome) => normalizarChave(nome) === 'ROTAS');
  const abaFretes = nomes.find((nome) => normalizarChave(nome) === 'FRETES');

  const resultado = {
    rotas: [],
    quebras: [],
    fretes: [],
    dadosGeraisPatch: {},
  };

  if (abaRotas) {
    const rowsRotas = XLSX.utils.sheet_to_json(workbook.Sheets[abaRotas], { defval: '' });
    const convertidoRotas = converterAbaRotasParaEstrutura({ rows: rowsRotas });
    resultado.rotas = convertidoRotas.rotas;
    resultado.quebras = convertidoRotas.quebras;
    resultado.dadosGeraisPatch = {
      origemNome: convertidoRotas.dadosOrigem?.origemNome || dadosGerais.origemNome || '',
      origemIbge: convertidoRotas.dadosOrigem?.origemIbge || dadosGerais.origemIbge || '',
    };
  }

  if (abaFretes) {
    const linhasFretes = XLSX.utils.sheet_to_json(workbook.Sheets[abaFretes], { header: 1, defval: '' });
    resultado.fretes = converterTemplatePrecificacaoParaFretes({
      linhas: linhasFretes,
      dadosGerais: {
        ...dadosGerais,
        ...resultado.dadosGeraisPatch,
      },
    });
  }

  return resultado;
}
