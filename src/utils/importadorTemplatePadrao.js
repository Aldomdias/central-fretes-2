import * as XLSX from 'xlsx';

export { importarTemplateCantu, importarModeloLotacao, baixarModeloLotacao } from './importadorTemplatesCantu';

function normalizarTexto(valor) {
  return String(valor ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function limparTexto(valor) {
  return String(valor ?? '').trim();
}

function numero(valor, padrao = '') {
  if (valor === null || valor === undefined || valor === '') return padrao;

  if (typeof valor === 'number') {
    return Number.isFinite(valor) ? valor : padrao;
  }

  let texto = String(valor).trim();
  if (!texto) return padrao;

  texto = texto
    .replace(/\s/g, '')
    .replace(/R\$/gi, '')
    .replace(/%/g, '');

  const temVirgula = texto.includes(',');
  const temPonto = texto.includes('.');

  if (temVirgula && temPonto) {
    texto = texto.replace(/\./g, '').replace(',', '.');
  } else if (temVirgula) {
    texto = texto.replace(',', '.');
  }

  const n = Number(texto);
  return Number.isFinite(n) ? n : padrao;
}

function criarMapaLinha(linha) {
  const mapa = new Map();

  Object.keys(linha || {}).forEach((chave) => {
    mapa.set(normalizarTexto(chave), linha[chave]);
  });

  return mapa;
}

function valorPorAlias(mapa, aliases, padrao = '') {
  for (const alias of aliases) {
    const chaveNormalizada = normalizarTexto(alias);
    if (mapa.has(chaveNormalizada)) {
      const valor = mapa.get(chaveNormalizada);
      if (valor !== null && valor !== undefined && String(valor).trim() !== '') {
        return valor;
      }
    }
  }

  return padrao;
}

async function lerWorkbook(arquivo) {
  if (!arquivo) {
    throw new Error('Arquivo não informado.');
  }

  const buffer = await arquivo.arrayBuffer();
  return XLSX.read(buffer, {
    type: 'array',
    cellDates: true,
    raw: false,
  });
}

function selecionarAba(workbook, termosPreferidos) {
  const nomes = workbook.SheetNames || [];

  if (!nomes.length) {
    throw new Error('Nenhuma aba encontrada no arquivo.');
  }

  const abaPreferida = nomes.find((nome) => {
    const nomeNorm = normalizarTexto(nome);
    return termosPreferidos.some((termo) => nomeNorm.includes(normalizarTexto(termo)));
  });

  return workbook.Sheets[abaPreferida || nomes[0]];
}

function sheetParaLinhas(sheet) {
  return XLSX.utils.sheet_to_json(sheet, {
    defval: '',
    raw: false,
  });
}

function montarChaveRota(valor) {
  return normalizarTexto(valor);
}

function montarNomeRota(rota) {
  const partes = [
    rota.origem || rota.cidadeOrigem || '',
    rota.ufOrigem || '',
    rota.cidadeDestino || rota.destino || '',
    rota.ufDestino || '',
  ].filter(Boolean);

  return partes.join(' - ');
}

function normalizarRota(linha, indice) {
  const mapa = criarMapaLinha(linha);

  const origem = limparTexto(valorPorAlias(mapa, [
    'Origem',
    'Cidade Origem',
    'Cidade de Origem',
    'Cidade_Origem',
    'Cidade Orig',
  ]));

  const ufOrigem = limparTexto(valorPorAlias(mapa, [
    'UF Origem',
    'UF_ORIGEM',
    'UF Orig',
    'Estado Origem',
  ])).toUpperCase();

  const cidadeDestino = limparTexto(valorPorAlias(mapa, [
    'Destino',
    'Cidade Destino',
    'Cidade de Destino',
    'Cidade_Destino',
    'Cidade Dest',
  ]));

  const ufDestino = limparTexto(valorPorAlias(mapa, [
    'UF Destino',
    'UF_DESTINO',
    'UF Dest',
    'Estado Destino',
  ])).toUpperCase();

  const ibgeOrigem = limparTexto(valorPorAlias(mapa, [
    'IBGE Origem',
    'Código IBGE Origem',
    'Codigo IBGE Origem',
    'Cod IBGE Origem',
    'IBGE_ORIGEM',
  ]));

  const ibgeDestino = limparTexto(valorPorAlias(mapa, [
    'IBGE Destino',
    'Código IBGE Destino',
    'Codigo IBGE Destino',
    'Cod IBGE Destino',
    'IBGE_DESTINO',
  ]));

  const cotacaoBase = limparTexto(valorPorAlias(mapa, [
    'Cotação Base',
    'Cotacao Base',
    'Cotação',
    'Cotacao',
    'Rota',
    'Nome Rota',
    'Nome da Rota',
    'Código Rota',
    'Codigo Rota',
    'ID Rota',
  ]));

  const cotacaoFinal = limparTexto(valorPorAlias(mapa, [
    'Cotação Final',
    'Cotacao Final',
    'Cotação Sistema',
    'Cotacao Sistema',
    'Rota Final',
    'Nome Final',
    'Nome Rota',
    'Rota',
  ], cotacaoBase));

  const prazo = numero(valorPorAlias(mapa, [
    'Prazo',
    'Prazo Entrega',
    'Prazo de Entrega',
    'Prazo Dias',
    'Dias',
  ]), '');

  const rota = {
    id: `rota-${indice + 1}`,
    origem,
    cidadeOrigem: origem,
    ufOrigem,
    cidadeDestino,
    destino: cidadeDestino,
    ufDestino,
    ibgeOrigem,
    ibgeDestino,
    prazo,
    cotacaoBase,
    cotacao: cotacaoFinal || cotacaoBase || montarNomeRota({
      origem,
      ufOrigem,
      cidadeDestino,
      ufDestino,
    }),
    cotacaoFinal: cotacaoFinal || cotacaoBase || montarNomeRota({
      origem,
      ufOrigem,
      cidadeDestino,
      ufDestino,
    }),
    dadosOriginais: linha,
  };

  if (!rota.origem && !rota.cidadeDestino && !rota.ufDestino && !rota.cotacaoFinal) {
    return null;
  }

  return rota;
}

function normalizarFrete(linha, indice, rotasPorChave) {
  const mapa = criarMapaLinha(linha);

  const cotacaoInformada = limparTexto(valorPorAlias(mapa, [
    'Cotação Final',
    'Cotacao Final',
    'Cotação',
    'Cotacao',
    'Rota',
    'Nome Rota',
    'Nome da Rota',
    'Código Rota',
    'Codigo Rota',
    'ID Rota',
  ]));

  const rota = rotasPorChave.get(montarChaveRota(cotacaoInformada)) || null;

  const origem = limparTexto(valorPorAlias(mapa, [
    'Origem',
    'Cidade Origem',
    'Cidade de Origem',
    'Cidade_Origem',
  ], rota ? rota.origem : ''));

  const ufOrigem = limparTexto(valorPorAlias(mapa, [
    'UF Origem',
    'UF_ORIGEM',
    'UF Orig',
  ], rota ? rota.ufOrigem : '')).toUpperCase();

  const ufDestino = limparTexto(valorPorAlias(mapa, [
    'UF Destino',
    'UF_DESTINO',
    'UF Dest',
  ], rota ? rota.ufDestino : '')).toUpperCase();

  const cotacaoBase = limparTexto(valorPorAlias(mapa, [
    'Cotação Base',
    'Cotacao Base',
    'Base',
  ], rota ? rota.cotacaoBase : ''));

  const faixaPeso = limparTexto(valorPorAlias(mapa, [
    'Faixa Peso',
    'Faixa de Peso',
    'Faixa',
    'Peso',
    'Descrição Faixa',
    'Descricao Faixa',
  ]));

  const pesoInicial = numero(valorPorAlias(mapa, [
    'Peso Inicial',
    'Peso Min',
    'Peso Mínimo',
    'Peso Minimo',
    'Peso De',
    'De',
    'Kg Inicial',
  ]), '');

  const pesoFinal = numero(valorPorAlias(mapa, [
    'Peso Final',
    'Peso Max',
    'Peso Máximo',
    'Peso Maximo',
    'Peso Até',
    'Peso Ate',
    'Até',
    'Ate',
    'Kg Final',
  ]), '');

  const taxaAplicada = numero(valorPorAlias(mapa, [
    'Taxa Aplicada',
    'Taxa',
    'Valor Faixa',
    'Valor',
    'Frete Valor',
    'Frete',
    'Frete Peso',
  ]), '');

  const excedente = numero(valorPorAlias(mapa, [
    'Excedente',
    'Excesso',
    'Excesso Kg',
    'Valor Excedente',
    'Kg Excedente',
  ]), '');

  const fretePercentual = numero(valorPorAlias(mapa, [
    'Frete Percentual',
    'Percentual',
    '% NF',
    'Percentual NF',
    'Frete %',
    '% Frete',
  ]), '');

  const freteMinimo = numero(valorPorAlias(mapa, [
    'Frete Mínimo',
    'Frete Minimo',
    'Mínimo',
    'Minimo',
    'Valor Mínimo',
    'Valor Minimo',
  ]), '');

  const frete = {
    id: `frete-${indice + 1}`,
    cotacao: cotacaoInformada || (rota ? rota.cotacao : ''),
    cotacaoFinal: cotacaoInformada || (rota ? rota.cotacaoFinal : ''),
    cotacaoBase,
    origem,
    ufOrigem,
    ufDestino,
    faixaPeso,
    pesoInicial,
    pesoFinal,
    taxaAplicada,
    freteValor: taxaAplicada,
    excedente,
    fretePercentual,
    freteMinimo,
    dadosOriginais: linha,
  };

  const temAlgumValor =
    frete.cotacao ||
    frete.origem ||
    frete.ufDestino ||
    frete.faixaPeso ||
    frete.taxaAplicada !== '' ||
    frete.fretePercentual !== '' ||
    frete.freteMinimo !== '';

  return temAlgumValor ? frete : null;
}

function montarQuebrasFaixa(fretes) {
  const mapa = new Map();

  fretes.forEach((frete) => {
    const chave = [
      frete.faixaPeso || '',
      frete.pesoInicial ?? '',
      frete.pesoFinal ?? '',
    ].join('|');

    if (!mapa.has(chave)) {
      mapa.set(chave, {
        faixaPeso: frete.faixaPeso || '',
        pesoInicial: frete.pesoInicial ?? '',
        pesoFinal: frete.pesoFinal ?? '',
      });
    }
  });

  return Array.from(mapa.values());
}

export async function importarTemplatePadraoSeparado({ arquivoRotas, arquivoFretes }) {
  if (!arquivoRotas) {
    throw new Error('Selecione o arquivo de Rotas.');
  }

  if (!arquivoFretes) {
    throw new Error('Selecione o arquivo de Fretes.');
  }

  const workbookRotas = await lerWorkbook(arquivoRotas);
  const workbookFretes = await lerWorkbook(arquivoFretes);

  const sheetRotas = selecionarAba(workbookRotas, ['ROTAS', 'ROTA']);
  const sheetFretes = selecionarAba(workbookFretes, ['FRETES', 'FRETE', 'COTACOES', 'COTAÇÕES', 'TABELA']);

  const linhasRotas = sheetParaLinhas(sheetRotas);
  const linhasFretes = sheetParaLinhas(sheetFretes);

  const rotas = linhasRotas
    .map((linha, indice) => normalizarRota(linha, indice))
    .filter(Boolean);

  const rotasPorChave = new Map();

  rotas.forEach((rota) => {
    [
      rota.cotacao,
      rota.cotacaoFinal,
      rota.cotacaoBase,
      montarNomeRota(rota),
    ].filter(Boolean).forEach((chave) => {
      rotasPorChave.set(montarChaveRota(chave), rota);
    });
  });

  const fretes = linhasFretes
    .map((linha, indice) => normalizarFrete(linha, indice, rotasPorChave))
    .filter(Boolean);

  const quebrasFaixa = montarQuebrasFaixa(fretes);

  return {
    rotas,
    fretes,
    quebrasFaixa,
    meta: {
      totalRotas: rotas.length,
      totalFretes: fretes.length,
      totalQuebrasFaixa: quebrasFaixa.length,
      arquivoRotas: arquivoRotas.name || '',
      arquivoFretes: arquivoFretes.name || '',
    },
  };
}

export async function importarTemplatePadrao(args) {
  return importarTemplatePadraoSeparado(args);
}

export default {
  importarTemplatePadraoSeparado,
  importarTemplatePadrao,
};