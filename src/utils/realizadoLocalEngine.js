import { calcularFreteFaixaPeso, calcularFretePercentual } from '../services/freteCalcEngine';
import { toNumberRealizado, normalizeTextRealizado } from './realizadoCtes';

const CANAIS_B2C = [
  'B2C', 'VIA VAREJO', 'MERCADO LIVRE', 'MERCADOR LIVRE', 'B2W', 'MAGAZINE LUIZA',
  'CARREFOUR', 'GPA', 'COLOMBO', 'AMAZON', 'INTER', 'ANYMARKET', 'ANY MARKET',
  'BRADESCO SHOP', 'ITAU SHOP', 'ITAÚ SHOP', 'SHOPEE', 'LIVELO', 'MARKETPLACE',
  'MARKET PLACE', 'ECOMMERCE', 'E-COMMERCE',
];

const CANAIS_ATACADO = ['ATACADO', 'B2B', 'CANTU', 'CANTU PNEUS'];

const UF_POR_CODIGO = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function normalizeKey(value) {
  return normalize(value).replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function sleepFrame() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function categoriaCanalRealizado(value) {
  const canal = normalize(value);
  if (!canal) return '';
  if (canal.includes('INTERCOMPANY')) return 'INTERCOMPANY';
  if (canal.includes('REVERSA')) return 'REVERSA';
  if (CANAIS_ATACADO.some((item) => canal === item || canal.includes(item))) return 'ATACADO';
  if (CANAIS_B2C.some((item) => canal === item || canal.includes(item))) return 'B2C';
  return canal;
}

export function splitCidadeUf(value, ufRaw = '') {
  let cidade = normalizeTextRealizado(value);
  let uf = String(ufRaw || '').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
  const match = cidade.match(/^(.*?)(?:\s*\/\s*|\s*-\s*)([A-Za-z]{2})$/);
  if (match) {
    cidade = normalizeTextRealizado(match[1]);
    if (!uf) uf = match[2].toUpperCase();
  }
  return { cidade, uf };
}

export function montarMapasIbge(municipios = []) {
  const porCidadeUf = new Map();
  const porIbge = new Map();

  (municipios || []).forEach((item) => {
    const ibge = onlyDigits(item.ibge || item.codigo_ibge || item.codigo || '');
    const cidade = normalizeTextRealizado(item.cidade || item.nome || item.municipio || '');
    const uf = String(item.uf || item.estado || '').trim().toUpperCase();
    if (!ibge || !cidade) return;
    porIbge.set(ibge, { ibge, cidade, uf });
    porCidadeUf.set(`${normalizeKey(cidade)}|${uf}`, ibge);
    if (!porCidadeUf.has(`${normalizeKey(cidade)}|`)) porCidadeUf.set(`${normalizeKey(cidade)}|`, ibge);
  });

  return { porCidadeUf, porIbge };
}

function limparNomeCidadeTabela(value) {
  let texto = normalizeTextRealizado(value);
  if (!texto) return '';
  texto = texto.replace(/^\d+\s*[-–—]\s*/g, '');
  texto = texto.replace(/\s*\([^)]*\)\s*/g, ' ');
  texto = texto.replace(/\bROTA\b|\bINTERIOR\b|\bCAPITAL\b|\bREGIAO\b|\bREGIÃO\b/gi, ' ');
  texto = texto.replace(/\s+/g, ' ').trim();
  return texto;
}

function adicionarMunicipioMap(map, item = {}) {
  const ibge = onlyDigits(item.ibge || item.codigo_ibge || item.codigo || item.codigoMunicipio || '');
  const cidade = limparNomeCidadeTabela(item.cidade || item.nome || item.municipio || item.nomeMunicipio || item.nome_rota || '');
  const uf = String(item.uf || item.estado || getUfByIbge(ibge) || '').trim().toUpperCase();
  if (!ibge || ibge.length < 7 || !cidade) return;
  const key = `${ibge}|${normalizeKey(cidade)}|${uf}`;
  if (!map.has(key)) map.set(key, { ibge, cidade, uf });
}

export function enriquecerMunicipiosComTabelas(municipios = [], transportadoras = []) {
  const map = new Map();

  (municipios || []).forEach((item) => adicionarMunicipioMap(map, item));

  (transportadoras || []).forEach((transportadora) => {
    (transportadora?.origens || []).forEach((origem) => {
      const rotas = origem?.rotas || [];
      const primeiraRota = rotas.find((rota) => rota?.ibgeOrigem);
      const ibgeOrigem = onlyDigits(primeiraRota?.ibgeOrigem || origem?.ibgeOrigem || '');
      if (ibgeOrigem && origem?.cidade) {
        adicionarMunicipioMap(map, {
          ibge: ibgeOrigem,
          cidade: origem.cidade,
          uf: getUfByIbge(ibgeOrigem),
        });
      }

      rotas.forEach((rota) => {
        const destinoIbge = onlyDigits(rota?.ibgeDestino || '');
        if (destinoIbge) {
          adicionarMunicipioMap(map, {
            ibge: destinoIbge,
            cidade: rota?.cidadeDestino || rota?.destino || rota?.nomeRota,
            uf: getUfByIbge(destinoIbge),
          });
        }

        const rotaIbgeOrigem = onlyDigits(rota?.ibgeOrigem || '');
        if (rotaIbgeOrigem && origem?.cidade) {
          adicionarMunicipioMap(map, {
            ibge: rotaIbgeOrigem,
            cidade: origem.cidade,
            uf: getUfByIbge(rotaIbgeOrigem),
          });
        }
      });
    });
  });

  return [...map.values()].sort((a, b) => `${a.cidade}/${a.uf}`.localeCompare(`${b.cidade}/${b.uf}`, 'pt-BR'));
}

function gerarVariantesCidade(cidade = '') {
  const base = normalizeKey(cidade);
  const variantes = new Set([base]);
  if (base.startsWith('SAO ')) variantes.add(base.replace(/^SAO /, 'S '));
  if (base.startsWith('S ')) variantes.add(base.replace(/^S /, 'SAO '));
  if (base.startsWith('SANTO ')) variantes.add(base.replace(/^SANTO /, 'STO '));
  if (base.startsWith('SANTA ')) variantes.add(base.replace(/^SANTA /, 'STA '));
  return [...variantes].filter(Boolean);
}

export function resolverIbgeLocal(cidadeRaw, ufRaw, mapasIbge) {
  return resolverMunicipioLocal(cidadeRaw, ufRaw, '', mapasIbge).ibge;
}

function municipiosCompatíveis(cidadeA = '', cidadeB = '') {
  const a = normalizeKey(cidadeA);
  const b = normalizeKey(cidadeB);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 5 && b.includes(a)) return true;
  if (b.length >= 5 && a.includes(b)) return true;
  return gerarVariantesCidade(a).some((variante) => variante === b || gerarVariantesCidade(b).includes(variante));
}

function resolverPorCidadeUf(cidadeRaw, ufRaw, mapasIbge) {
  const parsed = splitCidadeUf(cidadeRaw, ufRaw);
  const cidadeKey = normalizeKey(parsed.cidade);
  const uf = parsed.uf || String(ufRaw || '').trim().toUpperCase();
  if (!cidadeKey) return '';

  for (const variante of gerarVariantesCidade(cidadeKey)) {
    const exatoUf = mapasIbge?.porCidadeUf?.get(`${variante}|${uf}`);
    if (exatoUf) return exatoUf;
  }

  for (const variante of gerarVariantesCidade(cidadeKey)) {
    const semUf = mapasIbge?.porCidadeUf?.get(`${variante}|`);
    if (semUf) return semUf;
  }

  return '';
}

function resolverMunicipioLocal(cidadeRaw, ufRaw, ibgeRaw, mapasIbge) {
  const parsed = splitCidadeUf(cidadeRaw, ufRaw);
  const ibgeInformado = onlyDigits(ibgeRaw).slice(0, 7);
  const ibgePorCidade = resolverPorCidadeUf(parsed.cidade, parsed.uf, mapasIbge);
  const municipioInformado = ibgeInformado ? mapasIbge?.porIbge?.get(ibgeInformado) : null;

  // A base realizada às vezes vem com UF trocada ou com a coluna IBGE deslocada.
  // Por isso, quando o nome da cidade não bate com o IBGE informado, a cidade/UF normalizada
  // vira a fonte principal. Isso evita exemplos como ITAJAI/DF recebendo IBGE de FORTALEZA.
  let ibge = '';
  if (ibgePorCidade && ibgeInformado && municipioInformado && !municipiosCompatíveis(parsed.cidade, municipioInformado.cidade)) {
    ibge = ibgePorCidade;
  } else {
    ibge = ibgeInformado || ibgePorCidade;
  }

  const municipioFinal = ibge ? mapasIbge?.porIbge?.get(ibge) : null;
  return {
    ibge,
    cidade: parsed.cidade || municipioFinal?.cidade || '',
    uf: municipioFinal?.uf || parsed.uf || getUfByIbge(ibge),
    corrigidoPorCidade: Boolean(ibgePorCidade && ibgeInformado && ibgePorCidade !== ibgeInformado),
  };
}

function getCompetencia(dataEmissao = '', fallback = '') {
  if (dataEmissao) return String(dataEmissao).slice(0, 7);
  const match = String(fallback || '').match(/(20\d{2})[-_\s]?(\d{1,2})/);
  if (match) return `${match[1]}-${String(match[2]).padStart(2, '0')}`;
  return '';
}

function buildChaveFallback(row = {}) {
  const parts = [
    row.numeroCte,
    row.dataEmissao?.slice?.(0, 10),
    row.transportadora,
    row.cidadeOrigem,
    row.cidadeDestino,
    row.valorCte,
  ].map((item) => normalizeKey(item)).filter(Boolean);
  return `local-${parts.join('-')}`.slice(0, 240);
}

export function prepararRegistrosRealizadoLocal(registros = [], municipios = [], options = {}) {
  const mapasIbge = montarMapasIbge(municipios);
  const pendencias = [];
  const seen = new Set();
  const competenciaSelecionada = String(options.competencia || '').trim();

  const rows = (registros || []).map((row) => {
    const origem = resolverMunicipioLocal(row.cidadeOrigem, row.ufOrigem, row.ibgeOrigem, mapasIbge);
    const destino = resolverMunicipioLocal(row.cidadeDestino, row.ufDestino, row.ibgeDestino, mapasIbge);
    const ibgeOrigem = origem.ibge;
    const ibgeDestino = destino.ibge;
    const pesoDeclarado = toNumberRealizado(row.pesoDeclarado);
    const pesoCubado = toNumberRealizado(row.pesoCubado);
    const metrosCubicos = toNumberRealizado(row.metrosCubicos);
    const peso = Math.max(pesoDeclarado, pesoCubado, 0);
    const cubagem = metrosCubicos || pesoCubado || 0;
    const chaveCte = String(row.chaveCte || '').trim() || buildChaveFallback({ ...row, dataEmissao: row.emissao });
    const canal = categoriaCanalRealizado(row.canal || row.canalVendas || row.canais);
    const dataEmissao = row.emissao || '';
    const competencia = competenciaSelecionada || row.competencia || getCompetencia(dataEmissao, row.arquivoOrigem);
    const chaveRotaIbge = ibgeOrigem && ibgeDestino ? `${ibgeOrigem}-${ibgeDestino}` : '';

    return {
      chaveCte,
      competencia,
      dataEmissao,
      numeroCte: String(row.numeroCte || '').trim(),
      transportadora: normalizeTextRealizado(row.transportadora),
      cnpjTransportadora: String(row.cnpjTransportadora || '').replace(/\D/g, ''),
      cidadeOrigem: origem.cidade,
      ufOrigem: origem.uf,
      ibgeOrigem,
      cidadeDestino: destino.cidade,
      ufDestino: destino.uf,
      ibgeDestino,
      chaveRotaIbge,
      peso,
      pesoDeclarado,
      pesoCubado,
      cubagem,
      valorNF: toNumberRealizado(row.valorNF),
      valorCte: toNumberRealizado(row.valorCte),
      qtdVolumes: toNumberRealizado(row.volume),
      canal,
      canalOriginal: row.canal || row.canalVendas || row.canais || '',
      arquivoOrigem: row.arquivoOrigem || '',
      ibgeOk: Boolean(ibgeOrigem && ibgeDestino),
      ibgeCorrigidoOrigem: Boolean(origem.corrigidoPorCidade),
      ibgeCorrigidoDestino: Boolean(destino.corrigidoPorCidade),
      createdAt: new Date().toISOString(),
    };
  }).filter((row) => {
    if (!row.chaveCte || seen.has(row.chaveCte)) return false;
    seen.add(row.chaveCte);
    return row.valorCte > 0 || row.valorNF > 0;
  });

  rows.forEach((row) => {
    if (!row.ibgeOk) {
      pendencias.push({
        chaveCte: row.chaveCte,
        numeroCte: row.numeroCte,
        origem: `${row.cidadeOrigem}/${row.ufOrigem}`,
        destino: `${row.cidadeDestino}/${row.ufDestino}`,
        motivo: !row.ibgeOrigem && !row.ibgeDestino ? 'IBGE origem e destino não encontrados' : !row.ibgeOrigem ? 'IBGE origem não encontrado' : 'IBGE destino não encontrado',
      });
    }
  });

  return { rows, pendencias };
}

function getUfByIbge(ibge) {
  return UF_POR_CODIGO[onlyDigits(ibge).slice(0, 2)] || '';
}

const taxasIndexCache = new WeakMap();
const cotacoesIndexCache = new WeakMap();

function getTaxaDestino(origem, ibgeDestino) {
  if (!origem) return {};
  let index = taxasIndexCache.get(origem);
  if (!index) {
    index = new Map();
    (origem.taxasEspeciais || []).forEach((item) => {
      const key = String(item.ibgeDestino || '').replace(/\D/g, '');
      if (key && !index.has(key)) index.set(key, item);
    });
    taxasIndexCache.set(origem, index);
  }
  return index.get(String(ibgeDestino || '').replace(/\D/g, '')) || {};
}

function normalizarCotacaoParaIndice(cotacao = {}) {
  const pesoMin = toNumber(cotacao.pesoMin);
  const pesoMaxRaw = cotacao.pesoMax ?? cotacao.pesoLimite;
  const pesoMax = pesoMaxRaw === '' || pesoMaxRaw === null || pesoMaxRaw === undefined ? Number.POSITIVE_INFINITY : toNumber(pesoMaxRaw);
  return { ...cotacao, pesoMinIndex: pesoMin, pesoMaxIndex: pesoMax };
}

function getCotacoesPorRota(origem) {
  if (!origem) return new Map();
  let index = cotacoesIndexCache.get(origem);
  if (index) return index;

  index = new Map();
  (origem.cotacoes || []).forEach((cotacao) => {
    const rotaKey = normalizeKey(cotacao.rota || cotacao.nomeRota || cotacao.destino || '');
    if (!rotaKey) return;
    const list = index.get(rotaKey) || [];
    list.push(normalizarCotacaoParaIndice(cotacao));
    index.set(rotaKey, list);
  });

  index.forEach((list) => list.sort((a, b) => a.pesoMinIndex - b.pesoMinIndex || a.pesoMaxIndex - b.pesoMaxIndex));
  cotacoesIndexCache.set(origem, index);
  return index;
}

function getCotacao(origem, rotaNome, peso) {
  const rotaKey = normalizeKey(rotaNome);
  const index = getCotacoesPorRota(origem);
  const candidatos = index.get(rotaKey) || [];

  for (const cotacao of candidatos) {
    if (peso >= cotacao.pesoMinIndex && peso <= cotacao.pesoMaxIndex) return cotacao;
  }

  // Fallback seguro para bases antigas em que a cotação foi gravada com variação no nome da rota.
  // Só percorre listas já indexadas por rota, bem menor do que varrer todas as cotações a cada CT-e.
  for (const [key, list] of index.entries()) {
    if (!key || !(key === rotaKey || key.includes(rotaKey) || rotaKey.includes(key))) continue;
    for (const cotacao of list) {
      if (peso >= cotacao.pesoMinIndex && peso <= cotacao.pesoMaxIndex) return cotacao;
    }
  }

  return null;
}

function calcularItemTabela({ transportadora, origem, rota, cte }) {
  const peso = Math.max(toNumber(cte.peso), toNumber(cte.pesoCubado), toNumber(cte.pesoDeclarado));
  const valorNF = toNumber(cte.valorNF);
  const cotacao = getCotacao(origem, rota.nomeRota, peso);
  if (!cotacao) return null;

  const taxaDestino = getTaxaDestino(origem, rota.ibgeDestino);
  const tipoCalculo = String(origem.generalidades?.tipoCalculo || 'PERCENTUAL').toUpperCase();
  const engineInput = {
    rota,
    cotacao,
    generalidades: origem.generalidades || {},
    taxaDestino,
    pesoKg: peso,
    valorNf: valorNF,
  };
  const calculo = tipoCalculo === 'FAIXA_DE_PESO'
    ? calcularFreteFaixaPeso(engineInput)
    : calcularFretePercentual(engineInput);

  return {
    transportadora: transportadora.nome,
    transportadoraId: transportadora.id,
    origem: origem.cidade,
    canal: categoriaCanalRealizado(origem.canal),
    ibgeOrigem: String(rota.ibgeOrigem || ''),
    ibgeDestino: String(rota.ibgeDestino || ''),
    chaveRotaIbge: `${rota.ibgeOrigem}-${rota.ibgeDestino}`,
    rotaNome: rota.nomeRota,
    prazo: toNumber(rota.prazoEntregaDias),
    total: calculo.total,
    percentualSobreNF: valorNF > 0 ? (calculo.total / valorNF) * 100 : 0,
    detalhes: {
      frete: {
        tipoCalculo: calculo.tipoCalculo,
        pesoInformado: peso,
        valorNFInformado: valorNF,
        valorBase: calculo.valorBase,
        subtotal: calculo.subtotal,
        icms: calculo.icms,
        total: calculo.total,
        percentualAplicado: toNumber(cotacao.percentual || cotacao.fretePercentual),
        valorFixoAplicado: toNumber(cotacao.valorFixo || cotacao.taxaAplicada),
        rsKgAplicado: toNumber(cotacao.rsKg),
        pesoLimite: toNumber(cotacao.pesoMax || cotacao.pesoLimite),
        excessoKg: toNumber(cotacao.excesso || cotacao.excessoPeso),
      },
      taxas: calculo.taxas,
    },
  };
}

export function construirIndiceFretesPorRota(transportadoras = [], municipios = []) {
  const mapasIbge = montarMapasIbge(municipios);
  const index = new Map();
  const stats = { transportadoras: 0, origens: 0, rotas: 0, rotasComIbge: 0 };

  (transportadoras || []).forEach((transportadora) => {
    if (!transportadora?.nome) return;
    stats.transportadoras += 1;
    (transportadora.origens || []).forEach((origem) => {
      stats.origens += 1;
      const canal = categoriaCanalRealizado(origem.canal || '');
      const origemCidade = splitCidadeUf(origem.cidade || '', '').cidade;
      const origemUfPelaRota = getUfByIbge(origem.rotas?.[0]?.ibgeOrigem || '');
      const ibgeOrigemFallback = resolverIbgeLocal(origemCidade, origemUfPelaRota, mapasIbge);

      (origem.rotas || []).forEach((rota) => {
        stats.rotas += 1;
        const ibgeOrigem = onlyDigits(rota.ibgeOrigem) || ibgeOrigemFallback;
        const ibgeDestino = onlyDigits(rota.ibgeDestino);
        if (!ibgeOrigem || !ibgeDestino) return;
        stats.rotasComIbge += 1;
        const key = `${canal}|${ibgeOrigem}-${ibgeDestino}`;
        const list = index.get(key) || [];
        list.push({ transportadora, origem, rota: { ...rota, ibgeOrigem, ibgeDestino } });
        index.set(key, list);
      });
    });
  });

  return { index, stats };
}

function transportadoraMatch(nomeTabela, nomeFiltro, options = {}) {
  const tabela = normalizeKey(nomeTabela);
  const filtro = normalizeKey(nomeFiltro);
  if (!filtro) return false;

  // Quando o usuário escolhe uma opção da lista de transportadoras,
  // a simulação precisa usar exatamente aquela tabela cadastrada.
  // Isso evita misturar nomes parecidos, exemplo:
  // TOTAL EXPRESS x TOTAL EXPRESS SIMULAR x TOTAL EXPRESSHUB SIMULAR.
  if (options.exato) return tabela === filtro;

  return tabela === filtro || tabela.includes(filtro) || filtro.includes(tabela);
}

export function construirEscopoTransportadoraSimulada({ transportadoras = [], nomeTransportadora = '', municipios = [], canalFiltro = '' }) {
  const mapasIbge = montarMapasIbge(municipios);
  const routeKeys = new Set();
  const rotaIbgeKeys = new Set();
  const canais = new Set();
  const origens = new Set();
  const destinos = new Set();
  let transportadoraEncontrada = '';
  let rotasSemIbge = 0;

  (transportadoras || []).forEach((transportadora) => {
    if (!transportadoraMatch(transportadora?.nome, nomeTransportadora, { exato: true })) return;
    transportadoraEncontrada = transportadora?.nome || transportadoraEncontrada;

    (transportadora.origens || []).forEach((origem) => {
      const canal = categoriaCanalRealizado(origem.canal || '');
      const canalFiltroNormalizado = categoriaCanalRealizado(canalFiltro || '');
      if (canalFiltroNormalizado && canal !== canalFiltroNormalizado) return;

      const origemCidade = splitCidadeUf(origem.cidade || '', '').cidade;
      const origemUfPelaRota = getUfByIbge(origem.rotas?.[0]?.ibgeOrigem || '');
      const ibgeOrigemFallback = resolverIbgeLocal(origemCidade, origemUfPelaRota, mapasIbge);

      (origem.rotas || []).forEach((rota) => {
        const ibgeOrigem = onlyDigits(rota.ibgeOrigem) || ibgeOrigemFallback;
        const ibgeDestino = onlyDigits(rota.ibgeDestino);
        if (!ibgeOrigem || !ibgeDestino) {
          rotasSemIbge += 1;
          return;
        }
        const chaveRota = `${ibgeOrigem}-${ibgeDestino}`;
        const chaveCompleta = `${canal}|${chaveRota}`;
        routeKeys.add(chaveCompleta);
        rotaIbgeKeys.add(chaveRota);
        canais.add(canal);
        origens.add(`${origem.cidade || ''}`.trim() || ibgeOrigem);
        destinos.add(String(rota.nomeRota || rota.cidadeDestino || ibgeDestino).trim() || ibgeDestino);
      });
    });
  });

  return {
    transportadora: transportadoraEncontrada,
    routeKeys,
    rotaIbgeKeys,
    canais: [...canais].filter(Boolean).sort(),
    origens: [...origens].filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    destinos: [...destinos].filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    totalRotas: routeKeys.size,
    rotasSemIbge,
  };
}

function montarDetalhe({ cte, escolhido, lider, ranking, ganharia, rankingCalculado }) {
  const impacto = toNumber(cte.valorCte) - escolhido.total;
  return {
    id: cte.chaveCte,
    chaveCte: cte.chaveCte,
    numeroCte: cte.numeroCte,
    emissao: cte.dataEmissao,
    transportadoraRealizada: cte.transportadora,
    transportadoraSimulada: escolhido.transportadora,
    origem: cte.cidadeOrigem,
    cidadeDestino: cte.cidadeDestino,
    ufDestino: cte.ufDestino,
    canal: cte.canal,
    peso: cte.peso,
    valorNF: cte.valorNF,
    valorRealizado: cte.valorCte,
    valorSimulado: escolhido.total,
    impacto,
    ranking,
    rankingCalculado,
    ganharia,
    liderTransportadora: lider?.transportadora || '',
    freteSubstituta: rankingCalculado && ranking === 1 ? 0 : (lider?.total || 0),
    percentualRealizado: cte.valorNF > 0 ? (cte.valorCte / cte.valorNF) * 100 : 0,
    percentualSimulado: cte.valorNF > 0 ? (escolhido.total / cte.valorNF) * 100 : 0,
    detalhes: escolhido.detalhes,
  };
}

export async function simularRealizadoLocalRapido({
  realizados = [],
  transportadoras = [],
  municipios = [],
  nomeTransportadora,
  modoSimulacao = 'rapido',
  onProgress,
}) {
  const modo = modoSimulacao === 'completo' ? 'completo' : 'rapido';
  const rankingCalculado = modo === 'completo';
  const { index, stats } = construirIndiceFretesPorRota(transportadoras, municipios);
  const detalhes = [];
  const foraMalha = [];
  const porUfMap = new Map();
  let impactoLiquido = 0;
  let faturamentoGanhador = 0;
  let economiaGanhador = 0;
  let ctesGanharia = 0;
  let ctesComSimulacao = 0;
  let valorSimuladoTotal = 0;
  let valorNfSimulado = 0;

  for (let i = 0; i < realizados.length; i += 1) {
    const cte = realizados[i];
    const key = `${categoriaCanalRealizado(cte.canal)}|${cte.chaveRotaIbge}`;
    const candidatos = index.get(key) || [];

    if (!cte.chaveRotaIbge || !candidatos.length) {
      foraMalha.push({ ...cte, motivo: cte.chaveRotaIbge ? 'Rota não encontrada nas tabelas cadastradas' : 'CT-e sem chave IBGE origem-destino' });
    } else {
      const candidatosDaSimulada = candidatos.filter((item) => transportadoraMatch(item.transportadora?.nome, nomeTransportadora, { exato: true }));

      if (!candidatosDaSimulada.length) {
        foraMalha.push({ ...cte, motivo: 'Transportadora simulada não possui tabela nessa rota/canal' });
      } else {
        let escolhido = null;
        let lider = null;
        let ranking = null;

        if (rankingCalculado) {
          const calculados = candidatos
            .map((item) => calcularItemTabela({ ...item, cte }))
            .filter(Boolean)
            .sort((a, b) => a.total - b.total || a.prazo - b.prazo || a.transportadora.localeCompare(b.transportadora));

          const escolhidoIndex = calculados.findIndex((item) => transportadoraMatch(item.transportadora, nomeTransportadora, { exato: true }));
          escolhido = escolhidoIndex >= 0 ? calculados[escolhidoIndex] : null;
          lider = calculados[0] || null;
          ranking = escolhidoIndex >= 0 ? escolhidoIndex + 1 : null;
        } else {
          const calculadosSimulada = candidatosDaSimulada
            .map((item) => calcularItemTabela({ ...item, cte }))
            .filter(Boolean)
            .sort((a, b) => a.total - b.total || a.prazo - b.prazo || a.transportadora.localeCompare(b.transportadora));

          escolhido = calculadosSimulada[0] || null;
          lider = null;
          ranking = null;
        }

        if (!escolhido) {
          foraMalha.push({ ...cte, motivo: 'Sem cotação/faixa de peso válida para a transportadora simulada' });
        } else {
          const ganharia = rankingCalculado ? ranking === 1 : false;
          const detalhe = montarDetalhe({ cte, escolhido, lider, ranking, ganharia, rankingCalculado });

          ctesComSimulacao += 1;
          valorSimuladoTotal += escolhido.total;
          valorNfSimulado += toNumber(cte.valorNF);
          impactoLiquido += detalhe.impacto;

          if (ganharia) {
            ctesGanharia += 1;
            faturamentoGanhador += escolhido.total;
            economiaGanhador += detalhe.impacto;
          }

          detalhes.push(detalhe);

          const ufKey = cte.ufDestino || 'SEM UF';
          const uf = porUfMap.get(ufKey) || { uf: ufKey, ctes: 0, ganharia: 0, valorRealizado: 0, valorSimulado: 0, economia: 0 };
          uf.ctes += 1;
          if (ganharia) uf.ganharia += 1;
          uf.valorRealizado += toNumber(cte.valorCte);
          uf.valorSimulado += escolhido.total;
          uf.economia += detalhe.impacto;
          porUfMap.set(ufKey, uf);
        }
      }
    }

    const step = modo === 'rapido' ? 500 : 100;
    if (i % step === 0) {
      onProgress?.({ atual: i + 1, total: realizados.length, etapa: modo === 'rapido' ? 'Calculando impacto rápido' : 'Calculando ranking completo' });
      await sleepFrame();
    }
  }

  onProgress?.({ atual: realizados.length, total: realizados.length, etapa: 'Finalizando simulação local' });

  const porUf = [...porUfMap.values()].map((item) => ({
    ...item,
    aderencia: item.ctes ? (item.ganharia / item.ctes) * 100 : 0,
  })).sort((a, b) => b.ctes - a.ctes || a.uf.localeCompare(b.uf));

  return {
    resumo: {
      modo,
      rankingCalculado,
      ctesComSimulacao,
      ctesGanharia,
      aderencia: rankingCalculado && ctesComSimulacao ? (ctesGanharia / ctesComSimulacao) * 100 : 0,
      faturamentoGanhador,
      economiaGanhador,
      impactoLiquido,
      percentualSimulado: valorNfSimulado > 0 ? (valorSimuladoTotal / valorNfSimulado) * 100 : 0,
      ctesForaMalha: foraMalha.length,
      porUf,
      indexStats: stats,
    },
    detalhes: detalhes.sort((a, b) => {
      if (rankingCalculado) return (a.ranking || 9999) - (b.ranking || 9999) || b.impacto - a.impacto;
      return b.impacto - a.impacto;
    }),
    foraMalha,
  };
}
