import * as XLSX from 'xlsx';
import { parseNumeroPlanilha } from './parseNumeroPlanilha';

export { importarTemplateCantu, importarModeloLotacao, baixarModeloLotacao } from './importadorTemplatesCantu';

function normalizarTexto(valor) {
  return String(valor ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function ufPorIbge(ibge) {
  const codigo = String(ibge || '').replace(/\D/g, '').slice(0, 2);
  const mapa = {
    '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
    '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL',
    '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
    '41': 'PR', '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
  };
  return mapa[codigo] || '';
}

function normalizarComparacao(valor) {
  return String(valor || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

const UFS_VALIDAS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

// Quando o frete/rota nao tem coluna de UF propria (so o codigo da rota, ex.:
// "AC-INT1"), a UF fica "escondida" no prefixo do codigo. Sem extrair ela daqui,
// o fallback de comparacao abaixo (removerUfDaCotacao) tira o prefixo de QUALQUER
// codigo XX-SUFIXO e compara so o miolo (ex.: "INT1"), fazendo "AC-INT1" (orfao,
// sem match direto no arquivo de Rotas) colidir com "SP-INT1" de outro estado —
// bug real encontrado num caso de producao (JADLOG R2: AC-INT1 pegou o IBGE/valor
// de SP-INT1). Extrair a UF do proprio codigo fecha essa brecha.
function ufEmbutidaNoCodigo(valor) {
  const texto = String(valor || '').trim().toUpperCase();
  const match = texto.match(/^([A-Z]{2})\s*[-–]/);
  return match && UFS_VALIDAS.has(match[1]) ? match[1] : '';
}

function removerUfDaCotacao(valor, ufDestino) {
  let texto = String(valor || '').trim();
  const uf = String(ufDestino || '').trim().toUpperCase();

  if (uf && texto.toUpperCase().startsWith(uf + ' - ')) {
    texto = texto.slice(uf.length + 3).trim();
  } else {
    texto = texto.replace(/^[A-Z]{2}\s*[-–]\s*/i, '').trim();
  }

  return texto;
}

function cotacaoCompativel(frete, rota) {
  const ufFrete = String(frete.ufDestino || '').trim().toUpperCase()
    || ufEmbutidaNoCodigo(frete.cotacao || frete.cotacaoFinal);
  const ufRota = String(rota.ufDestino || '').trim().toUpperCase()
    || ufEmbutidaNoCodigo(rota.cotacaoBase || rota.cotacao || rota.cotacaoFinal);

  if (ufFrete && ufRota && ufFrete !== ufRota) return false;

  const cotacaoFrete = normalizarComparacao(removerUfDaCotacao(frete.cotacao || frete.cotacaoFinal, ufFrete));
  const candidatosRota = [
    rota.cotacaoBase,
    rota.cotacao,
    rota.cotacaoFinal,
  ].flatMap((valor) => [
    normalizarComparacao(valor),
    normalizarComparacao(removerUfDaCotacao(valor, ufRota)),
  ]).filter(Boolean);

  return candidatosRota.includes(cotacaoFrete);
}

function limparTexto(valor) {
  return String(valor ?? '').trim();
}

// Parser movido para ./parseNumeroPlanilha.js (modulo proprio testavel).
const numero = parseNumeroPlanilha;

// Detecta se uma faixa de peso é do tipo "excedente" (acima de X kg).
// Usada para separar corretamente excesso_kg (limiar) de valor_excedente (R$/kg).
function ehFaixaExcedente(faixaTexto, pesoFinal, pesoInicial = 0) {
  const t = normalizarTexto(String(faixaTexto || ''));
  if (t.includes('EXCEDENTE') || t.includes('ACIMA')) return true;
  if (Number(pesoFinal || 0) >= 999998 && Number(pesoInicial || 0) > 0) return true;
  return false;
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

function linhaTemCabecalhoVerum(cells = []) {
  const normalizados = cells.map(normalizarTexto);
  const grupos = [
    ['NOME DA TRANSPORTADORA', 'CODIGO DA UNIDADE'],
    ['COTACAO', 'CODIGO IBGE DESTINO'],
    ['ROTA DO FRETE', 'PESO LIMITE'],
    ['REGRA DE CALCULO', 'TAXA APLICADA'],
  ];

  return grupos.some((grupo) => grupo.every((header) => normalizados.includes(header)));
}

function sheetParaLinhas(sheet) {
  const aoa = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });

  let headerIndex = 0;
  for (let i = 0; i < Math.min(aoa.length, 30); i += 1) {
    if (linhaTemCabecalhoVerum(aoa[i] || [])) {
      headerIndex = i;
      break;
    }
  }

  const headers = (aoa[headerIndex] || []).map((cell, index) => {
    const header = limparTexto(cell);
    return header || `__coluna_${index + 1}`;
  });

  return aoa.slice(headerIndex + 1)
    .filter((row) => !row.every((cell) => limparTexto(cell) === ''))
    .map((row) => {
      const item = {};
      headers.forEach((header, index) => {
        item[header] = row[index] ?? '';
      });
      return item;
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
    'IBGE',
    'Código IBGE',
    'Codigo IBGE',
    'Cod IBGE',
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
    ufDestino: ufDestino || ufPorIbge(ibgeDestino),
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
    'COTAÇÃO',
    'Rota',
    'Rota do Frete',
    'ROTA DO FRETE',
    'Nome Rota',
    'Nome da Rota',
    'Código Rota',
    'Codigo Rota',
    'ID Rota',
  ]));

  const rota = rotasPorChave.get(montarChaveRota(cotacaoInformada)) || null;
  const _rotaNaoEncontrada = !rota && cotacaoInformada ? cotacaoInformada : null;

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

  const cidadeDestino = limparTexto(valorPorAlias(mapa, [
    'Destino',
    'Cidade Destino',
    'Cidade de Destino',
    'Cidade_Destino',
    'Cidade Dest',
  ], rota ? rota.cidadeDestino : ''));

  const ufDestino = limparTexto(valorPorAlias(mapa, [
    'UF Destino',
    'UF_DESTINO',
    'UF Dest',
  ], rota ? rota.ufDestino : '')).toUpperCase();

  const ibgeDestino = limparTexto(valorPorAlias(mapa, [
    'IBGE',
    'Código IBGE',
    'Codigo IBGE',
    'Cod IBGE',
    'IBGE Destino',
    'Código IBGE Destino',
    'Codigo IBGE Destino',
    'Cod IBGE Destino',
    'IBGE_DESTINO',
  ], rota ? rota.ibgeDestino : ''));

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
    'Peso Limite',
    'PESO LIMITE',
    'Peso Até',
    'Peso Ate',
    'Até',
    'Ate',
    'Kg Final',
  ]), '');

  const taxaAplicada = numero(valorPorAlias(mapa, [
    'Taxa Aplicada',
    'TAXA APLICADA',
    'Taxa',
    'Valor Faixa',
    'Valor',
    'Frete Valor',
    'Frete',
    'Frete Peso',
    'Frete R$',
    'FRETE (R$)',
  ]), '');

  const excedente = numero(valorPorAlias(mapa, [
    'Excedente',
    'EXCEDENTE',
    'Excesso',
    'Excesso Kg',
    // Coluna da Verum no modelo "Maior valor": o R$/kg base vem em "Excesso de peso".
    'Excesso de peso',
    'Excesso de Peso',
    'Excesso Peso',
    'Valor Excedente',
    'Kg Excedente',
    'R$ Kg Excedente',
    'Valor Kg Excedente',
  ]), '');

  const fretePercentual = numero(valorPorAlias(mapa, [
    'Frete Percentual',
    'Percentual',
    '%',
    '% ',
    '% NF',
    'Percentual NF',
    'Frete %',
    '% Frete',
    'Frete (%)',
  ]), '');

  const freteMinimo = numero(valorPorAlias(mapa, [
    'Frete Mínimo',
    'Frete Minimo',
    'Mínimo',
    'Minimo',
    'Valor Mínimo',
    'Valor Minimo',
    'FRETE MINIMO',
    'FRETE MÍNIMO',
  ]), '');

  const advalorem = numero(valorPorAlias(mapa, [
    'AD Valorem',
    'AD Valorem %',
    'AD VALOREM %',
    'Advalorem',
    'ADV',
    'ADV %',
  ]), '');

  // ── Excedente: separar limiar kg do valor R$/kg ───────────────────────────
  // isExcedente = true quando a faixa representa cobrança por kg acima de um limiar.
  // excessoKg   = o peso inicial (limiar) onde começa a cobrar por excedente.
  // valorExcedente = o R$/kg cobrado acima do limiar.
  // pesoFinalNorm  = sempre 999999 para faixas excedentes (para o simulador).
  const isExcedente = ehFaixaExcedente(faixaPeso, pesoFinal, pesoInicial);
  const excessoKg       = isExcedente ? Number(pesoInicial || 0) : 0;
  const valorExcedente  = isExcedente ? Number(excedente  || 0) : 0;
  const pesoFinalNorm   = isExcedente ? 999999 : pesoFinal;

  const frete = {
    id: `frete-${indice + 1}`,
    cotacao: cotacaoInformada || (rota ? rota.cotacao : ''),
    cotacaoFinal: cotacaoInformada || (rota ? rota.cotacaoFinal : ''),
    cotacaoBase,
    origem,
    ufOrigem,
    cidadeDestino,
    ufDestino,
    ibgeDestino,
    faixaPeso,
    pesoInicial,
    pesoFinal: pesoFinalNorm,
    taxaAplicada,
    freteValor: taxaAplicada,
    excedente,        // valor bruto lido da coluna EXCEDENTE
    excessoKg,        // limiar kg (onde começa o excedente)
    valorExcedente,   // R$/kg cobrado acima do limiar
    isExcedente,
    fretePercentual,
    freteMinimo,
    advalorem,
    dadosOriginais: linha,
    _rotaNaoEncontrada,
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

function chavesBuscaRota(rota = {}) {
  return [
    rota.cotacaoBase,
    rota.cotacao,
    rota.cotacaoFinal,
  ].flatMap((valor) => [
    normalizarComparacao(valor),
    normalizarComparacao(removerUfDaCotacao(valor, rota.ufDestino)),
  ]).filter(Boolean);
}

function chaveBuscaFrete(frete = {}) {
  return normalizarComparacao(removerUfDaCotacao(frete.cotacao || frete.cotacaoFinal, frete.ufDestino));
}

function indexarRotasPorCotacao(rotas = []) {
  const mapa = new Map();

  (rotas || []).forEach((rota) => {
    chavesBuscaRota(rota).forEach((chave) => {
      if (!mapa.has(chave)) mapa.set(chave, []);
      mapa.get(chave).push(rota);
    });
  });

  return mapa;
}

// Quando uma cotação (ex.: "MG") cobre várias rotas/destinos, escolhe a rota
// do UF mais frequente entre as compatíveis para representar a cotação na
// tela — em vez da primeira encontrada, que pode ser uma exceção isolada
// (ex.: 1 rota "MG" com IBGE de destino em GO, cadastrada errada na origem)
// e dava a impressão de que a cotação regional "achou o destino errado".
function rotaRepresentativa(candidatas) {
  if (!candidatas.length) return null;
  const contagemPorUf = new Map();
  candidatas.forEach((r) => {
    const uf = r.ufDestino || '';
    contagemPorUf.set(uf, (contagemPorUf.get(uf) || 0) + 1);
  });
  const ufMaisComum = [...contagemPorUf.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  return candidatas.find((r) => r.ufDestino === ufMaisComum) || candidatas[0];
}

function expandirFretesPorRotas(fretes, rotas) {
  const rotasPorCotacao = indexarRotasPorCotacao(rotas);

  return (fretes || []).map((frete) => {
    const candidatas = (rotasPorCotacao.get(chaveBuscaFrete(frete)) || []).filter((r) => cotacaoCompativel(frete, r));
    const rota = rotaRepresentativa(candidatas);

    if (!rota) return frete;

    return {
      ...frete,
      cotacao: rota.cotacaoFinal || rota.cotacao || frete.cotacao,
      cotacaoFinal: rota.cotacaoFinal || rota.cotacao || frete.cotacaoFinal,
      cotacaoBase: rota.cotacaoBase || frete.cotacaoBase,
      origem: frete.origem || rota.origem || rota.cidadeOrigem || '',
      ufOrigem: frete.ufOrigem || rota.ufOrigem || '',
      cidadeDestino: rota.cidadeDestino || frete.cidadeDestino || '',
      ufDestino: rota.ufDestino || frete.ufDestino || '',
      ibgeDestino: rota.ibgeDestino || frete.ibgeDestino || '',
      prazo: rota.prazo || frete.prazo || '',
    };
  });
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

async function reportarProgresso(onProgress, mensagem) {
  if (typeof onProgress === 'function') {
    await onProgress(mensagem);
  }
}

export async function importarTemplatePadraoSeparado({ arquivoRotas, arquivoFretes, onProgress }) {
  if (!arquivoRotas) {
    throw new Error('Selecione o arquivo de Rotas.');
  }

  if (!arquivoFretes) {
    throw new Error('Selecione o arquivo de Fretes.');
  }

  await reportarProgresso(onProgress, 'Lendo arquivo de rotas...');
  const workbookRotas = await lerWorkbook(arquivoRotas);
  await reportarProgresso(onProgress, 'Lendo arquivo de fretes...');
  const workbookFretes = await lerWorkbook(arquivoFretes);

  const sheetRotas = selecionarAba(workbookRotas, ['ROTAS', 'ROTA']);
  const sheetFretes = selecionarAba(workbookFretes, ['FRETES', 'FRETE', 'COTACOES', 'COTAÇÕES', 'TABELA']);

  await reportarProgresso(onProgress, 'Localizando cabecalhos Verum...');
  const linhasRotas = sheetParaLinhas(sheetRotas);
  const linhasFretes = sheetParaLinhas(sheetFretes);

  await reportarProgresso(onProgress, 'Normalizando rotas...');
  const rotas = linhasRotas
    .map((linha, indice) => normalizarRota(linha, indice))
    .filter(Boolean);

  // Uma cotação (ex.: "Rota MG") pode casar com dezenas de rotas de destinos
  // diferentes. Guardar TODAS por chave (não só a última lida) e escolher a
  // representativa pela UF mais frequente evita que 1 rota cadastrada errada
  // no meio do arquivo (ex.: "Rota MG" com IBGE de destino em GO) vire o
  // destino "adivinhado" pra cotação inteira.
  const rotasPorChaveMulti = new Map();

  rotas.forEach((rota) => {
    [
      rota.cotacao,
      rota.cotacaoFinal,
      rota.cotacaoBase,
      montarNomeRota(rota),
    ].filter(Boolean).forEach((chave) => {
      const chaveNorm = montarChaveRota(chave);
      if (!rotasPorChaveMulti.has(chaveNorm)) rotasPorChaveMulti.set(chaveNorm, []);
      rotasPorChaveMulti.get(chaveNorm).push(rota);
    });
  });

  const rotasPorChave = new Map();
  rotasPorChaveMulti.forEach((lista, chave) => {
    rotasPorChave.set(chave, rotaRepresentativa(lista));
  });

  await reportarProgresso(onProgress, `Normalizando fretes (${rotas.length} rotas lidas)...`);
  const fretesLidos = linhasFretes
    .map((linha, indice) => normalizarFrete(linha, indice, rotasPorChave))
    .filter(Boolean);

  const rotasNaoEncontradas = [...new Set(
    fretesLidos.filter((f) => f._rotaNaoEncontrada).map((f) => f._rotaNaoEncontrada),
  )].sort();

  await reportarProgresso(onProgress, `Cruzando ${fretesLidos.length} fretes com ${rotas.length} rotas...`);
  const fretes = expandirFretesPorRotas(fretesLidos, rotas);

  await reportarProgresso(onProgress, `Montando quebras de faixa (${fretes.length} cotacoes)...`);
  const quebrasFaixa = montarQuebrasFaixa(fretes);

  return {
    rotas,
    fretes,
    quebrasFaixa,
    rotasNaoEncontradas,
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
