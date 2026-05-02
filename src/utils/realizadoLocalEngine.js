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

function faixaLabel(cotacao = {}, peso = 0) {
  const min = toNumber(cotacao.pesoMin);
  const maxRaw = cotacao.pesoMax ?? cotacao.pesoLimite;
  const max = maxRaw === '' || maxRaw === null || maxRaw === undefined ? 0 : toNumber(maxRaw);
  if (min || max) {
    if (!max || max >= 999999) return `${min.toLocaleString('pt-BR')}+ kg`;
    return `${min.toLocaleString('pt-BR')} a ${max.toLocaleString('pt-BR')} kg`;
  }
  const p = toNumber(peso);
  if (p <= 2) return '0 a 2 kg';
  if (p <= 5) return '2 a 5 kg';
  if (p <= 10) return '5 a 10 kg';
  if (p <= 20) return '10 a 20 kg';
  if (p <= 30) return '20 a 30 kg';
  if (p <= 50) return '30 a 50 kg';
  if (p <= 70) return '50 a 70 kg';
  if (p <= 100) return '70 a 100 kg';
  return '100+ kg';
}

function percentualReducaoNecessaria(valorSimulado, referencia) {
  const simulado = toNumber(valorSimulado);
  const ref = toNumber(referencia);
  if (simulado <= 0 || ref <= 0 || simulado <= ref) return 0;
  return ((simulado - ref) / simulado) * 100;
}

function getReferenciaCompetitiva({ valorRealizado, lider, rankingCalculado }) {
  const realizado = toNumber(valorRealizado);
  const liderTotal = rankingCalculado ? toNumber(lider?.total) : 0;
  if (liderTotal > 0 && realizado > 0) return Math.min(realizado, liderTotal);
  if (liderTotal > 0) return liderTotal;
  return realizado;
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
    faixaPeso: faixaLabel(cotacao, peso),
    pesoMinFaixa: toNumber(cotacao.pesoMin),
    pesoMaxFaixa: toNumber(cotacao.pesoMax ?? cotacao.pesoLimite),
    tipoCalculo,
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
        faixaPeso: faixaLabel(cotacao, peso),
        pesoMin: toNumber(cotacao.pesoMin),
        pesoMax: toNumber(cotacao.pesoMax ?? cotacao.pesoLimite),
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

function montarDetalhe({ cte, escolhido, lider, ranking, rankingCalculado }) {
  const valorRealizado = toNumber(cte.valorCte);
  const valorSimulado = toNumber(escolhido.total);
  const valorNF = toNumber(cte.valorNF);
  const impacto = valorRealizado - valorSimulado;
  const economizaria = impacto > 0.009;
  const aumento = impacto < -0.009;
  const ganhaRanking = rankingCalculado ? ranking === 1 : true;
  const referenciaCompetitiva = getReferenciaCompetitiva({ valorRealizado, lider, rankingCalculado });
  const desvioCompetitivo = valorSimulado - referenciaCompetitiva;
  const precisaReduzirValor = desvioCompetitivo > 0.009 ? desvioCompetitivo : 0;
  const precisaReduzirPercentual = percentualReducaoNecessaria(valorSimulado, referenciaCompetitiva);

  // Regra de negócio do realizado local:
  // o sistema só aloca a carga para a transportadora simulada quando ela reduz custo.
  // No modo completo, além de reduzir custo, ela também precisa ser o menor preço entre as tabelas.
  const ganharia = Boolean(economizaria && ganhaRanking);
  const savingPotencial = ganharia ? impacto : 0;
  const valorRealizadoAlocado = ganharia ? valorRealizado : 0;
  const valorSimuladoAlocado = ganharia ? valorSimulado : 0;
  const valorNfAlocado = ganharia ? valorNF : 0;

  let motivoAlocacao = 'Sairia pela transportadora: gera saving vs realizado';
  if (!economizaria && aumento) motivoAlocacao = 'Não sairia: valor simulado fica acima do realizado';
  else if (!economizaria) motivoAlocacao = 'Não sairia: valor simulado empata com o realizado';
  else if (rankingCalculado && !ganhaRanking) motivoAlocacao = 'Não sairia: existe concorrente com menor preço na tabela';

  return {
    id: cte.chaveCte,
    chaveCte: cte.chaveCte,
    numeroCte: cte.numeroCte,
    competencia: cte.competencia || getCompetencia(cte.dataEmissao, ''),
    emissao: cte.dataEmissao,
    transportadoraRealizada: cte.transportadora,
    transportadoraSimulada: escolhido.transportadora,
    origem: cte.cidadeOrigem,
    ufOrigem: cte.ufOrigem,
    cidadeDestino: cte.cidadeDestino,
    ufDestino: cte.ufDestino,
    rota: `${cte.cidadeOrigem}/${cte.ufOrigem || ''} → ${cte.cidadeDestino}/${cte.ufDestino || ''}`,
    rotaNome: escolhido.rotaNome || cte.cidadeDestino,
    chaveRotaIbge: cte.chaveRotaIbge,
    canal: cte.canal,
    peso: cte.peso,
    faixaPeso: escolhido.faixaPeso || escolhido.detalhes?.frete?.faixaPeso || faixaLabel({}, cte.peso),
    pesoMinFaixa: escolhido.pesoMinFaixa || escolhido.detalhes?.frete?.pesoMin || 0,
    pesoMaxFaixa: escolhido.pesoMaxFaixa || escolhido.detalhes?.frete?.pesoMax || 0,
    tipoCalculo: escolhido.tipoCalculo || escolhido.detalhes?.frete?.tipoCalculo || '',
    prazo: escolhido.prazo || 0,
    valorNF,
    valorRealizado,
    valorSimulado,
    referenciaCompetitiva,
    desvioCompetitivo,
    precisaReduzirValor,
    precisaReduzirPercentual,
    impacto,
    economiaVsRealizado: economizaria ? impacto : 0,
    aumentoVsRealizado: aumento ? Math.abs(impacto) : 0,
    savingPotencial,
    valorRealizadoAlocado,
    valorSimuladoAlocado,
    valorNfAlocado,
    resultadoImpacto: economizaria ? 'Reduz custo vs realizado' : (aumento ? 'Fica acima do realizado' : 'Empata com realizado'),
    motivoAlocacao,
    economizaria,
    ranking,
    rankingCalculado,
    ganhaRanking,
    ganharia,
    liderTransportadora: lider?.transportadora || '',
    freteSubstituta: rankingCalculado && ranking === 1 ? 0 : (lider?.total || 0),
    percentualRealizado: valorNF > 0 ? (valorRealizado / valorNF) * 100 : 0,
    percentualSimulado: valorNF > 0 ? (valorSimulado / valorNF) * 100 : 0,
    detalhes: escolhido.detalhes,
  };
}

function novoGrupoSimulacao(key, extras = {}) {
  return {
    chave: key || 'Não informado',
    ctes: 0,
    ctesGanharia: 0,
    ctesNaoAlocados: 0,
    valorRealizado: 0,
    valorSimulado: 0,
    valorNF: 0,
    valorRealizadoGanhador: 0,
    valorSimuladoGanhador: 0,
    valorNfGanhador: 0,
    savingPotencial: 0,
    aumentoIgnorado: 0,
    precisaReduzirValor: 0,
    referenciaCompetitiva: 0,
    valorSimuladoNaoAlocado: 0,
    ...extras,
  };
}

function acumularGrupo(grupo, detalhe) {
  grupo.ctes += 1;
  grupo.valorRealizado += toNumber(detalhe.valorRealizado);
  grupo.valorSimulado += toNumber(detalhe.valorSimulado);
  grupo.valorNF += toNumber(detalhe.valorNF);

  if (detalhe.ganharia) {
    grupo.ctesGanharia += 1;
    grupo.valorRealizadoGanhador += toNumber(detalhe.valorRealizadoAlocado);
    grupo.valorSimuladoGanhador += toNumber(detalhe.valorSimuladoAlocado);
    grupo.valorNfGanhador += toNumber(detalhe.valorNfAlocado);
    grupo.savingPotencial += toNumber(detalhe.savingPotencial);
  } else {
    grupo.ctesNaoAlocados += 1;
    grupo.aumentoIgnorado += toNumber(detalhe.aumentoVsRealizado);
    grupo.precisaReduzirValor += toNumber(detalhe.precisaReduzirValor);
    grupo.referenciaCompetitiva += toNumber(detalhe.referenciaCompetitiva);
    grupo.valorSimuladoNaoAlocado += toNumber(detalhe.valorSimulado);
  }
}

function finalizarGrupo(grupo) {
  const reducaoSugeridaPercentual = grupo.valorSimuladoNaoAlocado > 0
    ? (grupo.precisaReduzirValor / grupo.valorSimuladoNaoAlocado) * 100
    : 0;
  return {
    ...grupo,
    percentualAlocacao: grupo.ctes ? (grupo.ctesGanharia / grupo.ctes) * 100 : 0,
    percentualFreteRealizado: grupo.valorNF > 0 ? (grupo.valorRealizado / grupo.valorNF) * 100 : 0,
    percentualFreteSimulado: grupo.valorNF > 0 ? (grupo.valorSimulado / grupo.valorNF) * 100 : 0,
    percentualFreteGanhador: grupo.valorNfGanhador > 0 ? (grupo.valorSimuladoGanhador / grupo.valorNfGanhador) * 100 : 0,
    reducaoSugeridaPercentual,
    ticketMedioRealizado: grupo.ctes ? grupo.valorRealizado / grupo.ctes : 0,
    ticketMedioSimulado: grupo.ctes ? grupo.valorSimulado / grupo.ctes : 0,
  };
}

function gerarAnalisesGerenciais(detalhes = []) {
  const porMesMap = new Map();
  const porRotaMap = new Map();
  const porFaixaMap = new Map();
  const porRotaFaixaMap = new Map();

  detalhes.forEach((detalhe) => {
    const mes = detalhe.competencia || String(detalhe.emissao || '').slice(0, 7) || 'Sem mês';
    const rota = detalhe.rota || `${detalhe.origem} → ${detalhe.cidadeDestino}/${detalhe.ufDestino}`;
    const faixa = detalhe.faixaPeso || faixaLabel({}, detalhe.peso);
    const rotaFaixaKey = `${rota} | ${faixa}`;

    if (!porMesMap.has(mes)) porMesMap.set(mes, novoGrupoSimulacao(mes, { mes }));
    if (!porRotaMap.has(rota)) porRotaMap.set(rota, novoGrupoSimulacao(rota, { rota, origem: detalhe.origem, ufOrigem: detalhe.ufOrigem, destino: detalhe.cidadeDestino, ufDestino: detalhe.ufDestino }));
    if (!porFaixaMap.has(faixa)) porFaixaMap.set(faixa, novoGrupoSimulacao(faixa, { faixaPeso: faixa }));
    if (!porRotaFaixaMap.has(rotaFaixaKey)) porRotaFaixaMap.set(rotaFaixaKey, novoGrupoSimulacao(rotaFaixaKey, { rota, faixaPeso: faixa, origem: detalhe.origem, ufOrigem: detalhe.ufOrigem, destino: detalhe.cidadeDestino, ufDestino: detalhe.ufDestino }));

    acumularGrupo(porMesMap.get(mes), detalhe);
    acumularGrupo(porRotaMap.get(rota), detalhe);
    acumularGrupo(porFaixaMap.get(faixa), detalhe);
    acumularGrupo(porRotaFaixaMap.get(rotaFaixaKey), detalhe);
  });

  const porMes = [...porMesMap.values()].map(finalizarGrupo).sort((a, b) => String(a.mes).localeCompare(String(b.mes)));
  const porRota = [...porRotaMap.values()].map(finalizarGrupo).sort((a, b) => b.savingPotencial - a.savingPotencial || b.ctes - a.ctes);
  const porFaixaPeso = [...porFaixaMap.values()].map(finalizarGrupo).sort((a, b) => b.savingPotencial - a.savingPotencial || b.ctes - a.ctes);
  const porRotaFaixa = [...porRotaFaixaMap.values()].map(finalizarGrupo).sort((a, b) => b.savingPotencial - a.savingPotencial || b.precisaReduzirValor - a.precisaReduzirValor);

  const oportunidadesAjuste = porRotaFaixa
    .filter((item) => item.ctesNaoAlocados > 0 && item.precisaReduzirValor > 0)
    .sort((a, b) => b.precisaReduzirValor - a.precisaReduzirValor || b.ctesNaoAlocados - a.ctesNaoAlocados)
    .slice(0, 200);

  const rotasCompetitivas = porRotaFaixa
    .filter((item) => item.ctesGanharia > 0 && item.savingPotencial > 0)
    .sort((a, b) => b.savingPotencial - a.savingPotencial || b.ctesGanharia - a.ctesGanharia)
    .slice(0, 200);

  return { porMes, porRota, porFaixaPeso, porRotaFaixa, oportunidadesAjuste, rotasCompetitivas };
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
  let ctesEconomizaria = 0;
  let economiaBruta = 0;
  let aumentoBruto = 0;
  let ctesComSimulacao = 0;
  let valorSimuladoTotal = 0;
  let valorNfSimulado = 0;
  let valorRealizadoGanhador = 0;
  let valorNfGanhador = 0;

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
          const detalhe = montarDetalhe({ cte, escolhido, lider, ranking, rankingCalculado });
          const ganharia = detalhe.ganharia;

          ctesComSimulacao += 1;
          valorSimuladoTotal += escolhido.total;
          valorNfSimulado += toNumber(cte.valorNF);
          impactoLiquido += detalhe.impacto;

          if (detalhe.economizaria) {
            ctesEconomizaria += 1;
            economiaBruta += detalhe.economiaVsRealizado;
          } else {
            aumentoBruto += detalhe.aumentoVsRealizado;
          }

          if (ganharia) {
            ctesGanharia += 1;
            faturamentoGanhador += detalhe.valorSimuladoAlocado;
            valorRealizadoGanhador += detalhe.valorRealizadoAlocado;
            valorNfGanhador += detalhe.valorNfAlocado;
            economiaGanhador += detalhe.savingPotencial;
          }

          detalhes.push(detalhe);

          const ufKey = cte.ufDestino || 'SEM UF';
          const uf = porUfMap.get(ufKey) || {
            uf: ufKey,
            ctes: 0,
            ganharia: 0,
            economizaria: 0,
            valorRealizado: 0,
            valorSimulado: 0,
            economia: 0,
            economiaBruta: 0,
            aumentoBruto: 0,
            valorRealizadoGanhador: 0,
            valorSimuladoGanhador: 0,
            valorNfGanhador: 0,
            savingPotencial: 0,
          };
          uf.ctes += 1;
          if (ganharia) {
            uf.ganharia += 1;
            uf.valorRealizadoGanhador += detalhe.valorRealizadoAlocado;
            uf.valorSimuladoGanhador += detalhe.valorSimuladoAlocado;
            uf.valorNfGanhador += detalhe.valorNfAlocado;
            uf.savingPotencial += detalhe.savingPotencial;
          }
          if (detalhe.economizaria) {
            uf.economizaria += 1;
            uf.economiaBruta += detalhe.economiaVsRealizado;
          } else {
            uf.aumentoBruto += detalhe.aumentoVsRealizado;
          }
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
    percentualEconomizaria: item.ctes ? (item.economizaria / item.ctes) * 100 : 0,
    percentualFreteGanhador: item.valorNfGanhador > 0 ? (item.valorSimuladoGanhador / item.valorNfGanhador) * 100 : 0,
  })).sort((a, b) => b.ctes - a.ctes || a.uf.localeCompare(b.uf));

  const detalhesOrdenados = detalhes.sort((a, b) => {
    if (a.ganharia !== b.ganharia) return a.ganharia ? -1 : 1;
    if (rankingCalculado) return (a.ranking || 9999) - (b.ranking || 9999) || (b.savingPotencial || 0) - (a.savingPotencial || 0) || b.impacto - a.impacto;
    return (b.savingPotencial || 0) - (a.savingPotencial || 0) || b.impacto - a.impacto;
  });

  const analises = gerarAnalisesGerenciais(detalhesOrdenados);

  return {
    resumo: {
      modo,
      rankingCalculado,
      ctesComSimulacao,
      ctesGanharia,
      ctesEconomizaria,
      percentualEconomizaria: ctesComSimulacao ? (ctesEconomizaria / ctesComSimulacao) * 100 : 0,
      economiaBruta,
      aumentoBruto,
      aumentoIgnorado: aumentoBruto,
      aderencia: ctesComSimulacao ? (ctesGanharia / ctesComSimulacao) * 100 : 0,
      faturamentoGanhador,
      valorRealizadoGanhador,
      valorNfGanhador,
      economiaGanhador,
      savingPotencial: economiaGanhador,
      ctesNaoAlocados: Math.max(0, ctesComSimulacao - ctesGanharia),
      impactoLiquido,
      impactoSeCarregasseTudo: impactoLiquido,
      percentualSimulado: valorNfSimulado > 0 ? (valorSimuladoTotal / valorNfSimulado) * 100 : 0,
      percentualFreteGanhador: valorNfGanhador > 0 ? (faturamentoGanhador / valorNfGanhador) * 100 : 0,
      ctesForaMalha: foraMalha.length,
      porUf,
      indexStats: stats,
    },
    detalhes: detalhesOrdenados,
    analises,
    foraMalha,
  };
}
