import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { carregarAguardandoNovaFatura } from './baixaEntregaService';
import { carregarRaizesAdicionaisPorId } from './transportadoraCnpjsService';
import { buscarBaseSimulacaoPorRotasDb, carregarBaseCompletaDb, carregarBaseTransportadorasDb, invalidarCacheBaseCompletaDb } from './freteDatabaseService';
import { calcularFreteFaixaPeso, calcularFretePercentual } from './freteCalcEngine';
import { filtrarCpComercialCte } from './cteBasePolicy';
import {
  aplicarVinculoTransportadora,
  carregarVinculosTransportadoras,
  criarMapaVinculosTransportadoras,
} from './vinculosTransportadorasService';
import {
  buildLookupTables,
  simularRealizadoPorTransportadora,
} from '../utils/calculoFrete';
import { carregarMatrizIcmsUfCentralizada, resolverAliquotaIcmsUfContexto } from '../utils/icmsUfMatrix';
import { buscarTrackingParaRealizado, enriquecerRealizadoComTracking } from './realizadoTrackingEnrichment';
import { obterRaizCnpj } from '../utils/cnpj.js';
import { carregarMapaEquivalenciasOrigem } from './origemEquivalenciaService';
import { ibgesOrigemEquivalentes, origemAceitaPorExcecao } from '../utils/origemEquivalencia';
import { cederThread, esperarLeve } from '../utils/cederThread';


const PAGE_SIZE = 1000;
const INSERT_CHUNK = 500;
const TABELA_CTES = 'realizado_local_ctes';
const TABELA_RESULTADOS = 'auditoria_cte_resultados';
const TABELA_RESUMO = 'auditoria_cte_resumo_mensal';
const LIMITE_DIVERGENCIA_ASSERTIVO = 0.05;
const CAMPOS_RESULTADO_OPCIONAIS = ['valor_excessivo', 'valor_insuficiente'];
const UF_POR_CODIGO_IBGE = {
  11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO',
  21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA',
  31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP',
  41: 'PR', 42: 'SC', 43: 'RS',
  50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF',
};

function normalizarCanalResultado(valor) {
  const v = String(valor || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  if (!v) return 'A DEFINIR';
  if (v.includes('A DEFINIR') || v.includes('SEM TABELA') || v.includes('SEM VINCULO')) return 'A DEFINIR';
  if (v.includes('INTERCOMPANY')) return 'INTERCOMPANY';
  if (v.includes('REVERSA')) return 'REVERSA';
  if (v.includes('ATACADO') || v === 'B2B' || v.endsWith(' B2B') || v.startsWith('B2B ')) return 'ATACADO';
  if (v.includes('B2C') || v.includes('MARKETPLACE') || v.includes('ECOMMERCE')) return 'B2C';
  return v;
}

function erroColunaOpcionalResultado(error) {
  const mensagem = String(error?.message || error || '').toLowerCase();
  return CAMPOS_RESULTADO_OPCIONAIS.some((campo) => mensagem.includes(campo))
    || (mensagem.includes('schema cache') && mensagem.includes('column'));
}

function semCamposResultadoOpcionais(row) {
  const limpo = { ...(row || {}) };
  CAMPOS_RESULTADO_OPCIONAIS.forEach((campo) => delete limpo[campo]);
  return limpo;
}

// Alias local para o cache centralizado em freteDatabaseService (carregarBaseCompletaDb já cacheia).
let _cacheBaseFrete = null;
const _cacheBaseFretePorTransportadora = new Map();
let _cacheMapaVinculosTransportadoras = null;
// Exceções de origem (Ferramentas): transportadora emite CT-e numa cidade
// diferente da origem cadastrada na tabela. Fica em cache de módulo porque o
// casamento de origem acontece dentro de funções síncronas do motor.
let _cacheMapaEquivalenciasOrigem = new Map();

function ensureSupabase() {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase não configurado. Verifique VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Cliente Supabase indisponível.');
  }

  return supabase;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  const text = String(value).trim();
  if (!text) return 0;

  const normalized = text.includes(',')
    ? text.replace(/\./g, '').replace(',', '.')
    : text;

  const parsed = Number(normalized.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function getUfByIbge(ibge) {
  return UF_POR_CODIGO_IBGE[onlyDigits(ibge).slice(0, 2)] || '';
}

function toBooleanFlag(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = normalizeCompare(value);
    if (['true', '1', 'sim', 's', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'nao', 'n', 'no'].includes(normalized)) return false;
  }
  return Boolean(value);
}

// Memo: e chamada milhares de vezes por CT-e com os mesmos textos (nomes de rota, cidades). Resultado identico.
const memoNormalizeText = new Map();
function normalizeText(value) {
  const chave = String(value || '');
  const pronto = memoNormalizeText.get(chave);
  if (pronto !== undefined) return pronto;
  const normalizado = chave
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
  if (memoNormalizeText.size > 200000) memoNormalizeText.clear();
  memoNormalizeText.set(chave, normalizado);
  return normalizado;
}

function normalizeCompare(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeTransportadoraCompare(value) {
  return normalizeCompare(value)
    .replace(/\b(s\s*a|sa|s\/a|ltda|eireli|me|epp|eirelli)\b/g, ' ')
    .replace(/\b(logistica|transportes|transporte|cargas|carga)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pick(row = {}, keys = []) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return '';
}

function pickDigits(row = {}, keys = [], maxLength = 7) {
  for (const key of keys) {
    const digits = onlyDigits(row?.[key]);
    if (digits) return maxLength ? digits.slice(0, maxLength) : digits;
  }
  return '';
}

// Chave de acesso da NF-e (44 digitos): cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3)
// nNF(9) tpEmis(1) cNF(8) cDV(1) - o CNPJ do emissor fica nas posicoes 7-20.
function cnpjDaChaveNfe(chaveNfe) {
  const digitos = onlyDigits(chaveNfe);
  if (digitos.length !== 44) return '';
  return digitos.slice(6, 20);
}

// Mesma estrutura de chave (44 digitos), mas aplicada na chave do proprio
// CT-e: a serie fica nas posicoes 23-25. Sem isso o DOCCOB manda o
// "Numero-serie" do CT-e so com o numero, sem a serie - o Verum usa os dois
// pra localizar o CT-e.
function serieDaChaveCte(chaveCte) {
  const digitos = onlyDigits(chaveCte);
  if (digitos.length !== 44) return '';
  return digitos.slice(22, 25);
}

async function carregarMapaVinculosAuditoria() {
  if (_cacheMapaVinculosTransportadoras) return _cacheMapaVinculosTransportadoras;
  try {
    _cacheMapaVinculosTransportadoras = criarMapaVinculosTransportadoras(await carregarVinculosTransportadoras());
  } catch (error) {
    console.warn('[Auditoria CT-e] vínculos de transportadora indisponíveis; usando nome bruto.', error?.message || error);
    _cacheMapaVinculosTransportadoras = new Map();
  }
  return _cacheMapaVinculosTransportadoras;
}

// Carrega as exceções de origem pro cache de módulo. Chamada nos pontos
// assíncronos de entrada, antes de processar os CT-e.
export async function precarregarEquivalenciasOrigemAuditoria() {
  try {
    _cacheMapaEquivalenciasOrigem = await carregarMapaEquivalenciasOrigem();
  } catch (error) {
    console.warn('[Auditoria CT-e] exceções de origem indisponíveis; seguindo sem elas.', error?.message || error);
    _cacheMapaEquivalenciasOrigem = new Map();
  }
  return _cacheMapaEquivalenciasOrigem;
}

export function invalidarCacheEquivalenciasOrigemAuditoria() {
  _cacheMapaEquivalenciasOrigem = new Map();
}

export function invalidarCacheVinculosAuditoriaCte() {
  _cacheMapaVinculosTransportadoras = null;
  _cacheBaseFretePorTransportadora.clear();
}

// Força recarregar as tabelas de frete do zero (ex.: usuário ajustou uma tabela
// ou o TDE por CNPJ em outra aba e quer resimular sem perder a busca/filtro
// atual na Auditoria). Limpa também o cache da base completa (_cacheBaseFrete):
// deixá-lo "congelado" fazia resimulações caírem no fallback de base completa
// com dados desatualizados (ex.: TDE por CNPJ recém-editado não aparecia).
export function invalidarCacheBaseFreteAuditoriaCte() {
  _cacheBaseFretePorTransportadora.clear();
  _cacheBaseFrete = null;
  invalidarCacheBaseCompletaDb();
}

// Busca o resultado ja calculado/salvo de um CT-e (com o detalhamento do
// calculo) pela chave, pra telas fora da Auditoria CT-e (ex.: Faturas)
// poderem mostrar o mesmo painel de detalhes ao clicar num CT-e.
export async function buscarResultadoAuditoriaPorChave(chaveCte) {
  const chave = onlyDigits(chaveCte);
  if (!chave) return null;
  const supabase = ensureSupabase();
  // Nao usar .maybeSingle(): podem existir registros duplicados pra mesma
  // chave (recalculos antigos que inseriram em vez de atualizar), e
  // maybeSingle() falha com erro quando ha mais de uma linha. Busca todas e
  // fica com a mais recente por updated_at.
  const { data, error } = await supabase
    .from(TABELA_RESULTADOS)
    .select('*')
    .eq('chave_cte', chave)
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Erro ao buscar resultado da auditoria: ${error.message}`);
  if (!data || !data.length) return null;
  return data[0];
}

export async function buscarResultadosAuditoriaPorIdentificadores(identificadores = [], onProgress) {
  const normalizadas = [...new Set((identificadores || []).map((c) => onlyDigits(c)).filter(Boolean))];
  if (!normalizadas.length) return [];
  const chavesCte = normalizadas.filter((valor) => valor.length >= 20);
  const numerosCte = normalizadas.filter((valor) => valor.length < 20);
  const supabase = ensureSupabase();
  const resultados = [];

  for (let inicio = 0; inicio < chavesCte.length; inicio += 200) {
    const lote = chavesCte.slice(inicio, inicio + 200);
    const { data, error } = await supabase.from(TABELA_RESULTADOS).select('*').in('chave_cte', lote);
    if (error) throw new Error(`Erro ao buscar auditorias salvas por chave: ${error.message}`);
    resultados.push(...(data || []));
    onProgress?.({ etapa: 'carregando_resultado_salvo', carregados: resultados.length, total: normalizadas.length });
  }

  for (let inicio = 0; inicio < numerosCte.length; inicio += 200) {
    const lote = numerosCte.slice(inicio, inicio + 200);
    const { data, error } = await supabase.from(TABELA_RESULTADOS).select('*').in('numero_cte', lote);
    if (error) throw new Error(`Erro ao buscar auditorias salvas por numero: ${error.message}`);
    resultados.push(...(data || []));
    onProgress?.({ etapa: 'carregando_resultado_salvo', carregados: resultados.length, total: normalizadas.length });
  }

  const vistos = new Set();
  return resultados.filter((row) => {
    const chave = pick(row, ['chave_cte', 'chaveCte', 'chave']) || pick(row, ['numero_cte', 'numeroCte', 'cte', 'nro_cte']) || pick(row, ['id']);
    if (!chave || vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

function nomeTransportadoraCte(cte = {}, mapaVinculos = null) {
  const original = pick(cte, ['transportadora', 'nome_transportadora', 'transportadora_realizada', 'transportador']);
  if (!mapaVinculos) return original;
  return aplicarVinculoTransportadora(original, mapaVinculos) || original;
}

// CNPJ do emitente: campo proprio ou, na falta, as posicoes 7-20 da chave do
// CT-e. O nome no CT-e pode diferir do cadastro ("F S P TRANSPORTADORA" x
// "F P TRANSPORTES"), mas o CNPJ da chave e o mesmo.
function cnpjTransportadoraCte(cte = {}) {
  const direto = pick(cte, ['cnpj_transportadora', 'cnpjTransportadora', 'cnpj_transportador']);
  if (direto) return direto;
  const chave = onlyDigits(pick(cte, ['chave_cte', 'chaveCte', 'chave']));
  return chave.length === 44 ? chave.slice(6, 20) : '';
}

function competenciaParaDatas(competencia = '') {
  if (!competencia || !/^\d{4}-\d{2}$/.test(competencia)) return null;

  const [ano, mes] = competencia.split('-').map(Number);
  const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const fim = `${ano}-${String(mes).padStart(2, '0')}-${ultimoDia}`;

  return { inicio, fim };
}

function canalCategoria(value) {
  const canal = normalizeText(value);
  if (!canal) return '';
  if (canal.includes('A DEFINIR') || canal.includes('SEM TABELA') || canal.includes('SEM VINCULO')) return 'A DEFINIR';
  if (canal.includes('INTERCOMPANY')) return 'INTERCOMPANY';
  if (canal.includes('REVERSA')) return 'REVERSA';
  // DIGITIRE e um canal de venda atacado (tabelas cadastradas como ATACADO).
  if (canal.includes('ATACADO') || canal.includes('DIGITIRE') || canal === 'B2B' || canal.includes(' B2B')) return 'ATACADO';
  if (canal.includes('B2C') || canal.includes('MARKETPLACE') || canal.includes('ECOMMERCE')) return 'B2C';
  return canal;
}

// Origem cadastrada como "AMBOS" (ou "ATACADO+B2C", "ATACADO E B2C") atende
// qualquer canal — mesma regra do canalCompativelDb do cadastro.
function canalAtendeTodos(canalTabela) {
  const c = normalizeText(canalTabela);
  if (!c) return false;
  if (c.includes('AMBOS') || c.includes('TODOS')) return true;
  const temAtacado = c.includes('ATACADO') || c.includes('B2B');
  const temB2c = c.includes('B2C') || c.includes('MARKETPLACE') || c.includes('ECOMMERCE');
  return temAtacado && temB2c;
}

function canalCompativel(canalTabela, canalCte) {
  const cte = canalCategoria(canalCte);
  if (cte === 'A DEFINIR') return false;
  if (canalAtendeTodos(canalTabela)) return true;
  // Simétrico: se o lado do filtro/CT-e for "AMBOS", aceita qualquer tabela.
  if (canalAtendeTodos(canalCte)) return true;

  const tabela = canalCategoria(canalTabela);
  if (!cte) return true;
  if (!tabela) return true;

  return tabela === cte || tabela.includes(cte) || cte.includes(tabela);
}

function nomeCompativel(nomeTabela, nomeCte) {
  const tabela = normalizeTransportadoraCompare(nomeTabela);
  const cte = normalizeTransportadoraCompare(nomeCte);

  if (!tabela || !cte) return false;

  return tabela === cte
    || tabela.replace(/\s+/g, '') === cte.replace(/\s+/g, '')
    || (tabela.length >= 5 && cte.includes(tabela))
    || (cte.length >= 5 && tabela.includes(cte));
}

function cidadeCompativel(cidadeTabela, cidadeCte) {
  const tabela = normalizeCompare(cidadeTabela);
  const cte = normalizeCompare(cidadeCte);

  if (!cte) return true;
  if (!tabela) return false;

  return tabela === cte
    || tabela.replace(/\s+/g, '') === cte.replace(/\s+/g, '')
    || (tabela.length >= 5 && cte.includes(tabela))
    || (cte.length >= 5 && tabela.includes(cte));
}

function getTaxaDestino(origem, ibgeDestino) {
  const destino = onlyDigits(ibgeDestino).slice(0, 7);

  return (origem?.taxasEspeciais || []).find((item) => (
    onlyDigits(item.ibgeDestino).slice(0, 7) === destino
  )) || {};
}

function getCotacaoPorRota(origem, rota, peso, cte = {}) {
  const rotaNorm = normalizeCompare(rota?.nomeRota || rota?.rota || rota);
  const ufDestinoNorm = normalizeCompare(pick(cte, ['uf_destino', 'ufDestino']));
  const ibgeDestino = pickDigits(cte, ['ibge_destino', 'ibgeDestino', 'codigo_ibge_destino', 'ibge_corrigido_destino']) || onlyDigits(rota?.ibgeDestino).slice(0, 7);
  const ibgePrefixo = ibgeDestino.slice(0, 2);
  const pesoFinal = toNumber(peso);
  const dentroDoPeso = (item) => {
    const pesoMin = toNumber(item.pesoMin ?? item.peso_min ?? 0);
    const pesoMaxRaw = item.pesoMax ?? item.pesoLimite ?? item.peso_max ?? item.peso_limite;
    const pesoMax = pesoMaxRaw === '' || pesoMaxRaw === null || pesoMaxRaw === undefined
      ? Number.POSITIVE_INFINITY
      : toNumber(pesoMaxRaw);
    return pesoFinal >= pesoMin && pesoFinal <= (pesoMax || Number.POSITIVE_INFINITY);
  };
  const ordenarPorFaixa = (cotacoes) => [...cotacoes].sort((a, b) => (
    toNumber(a.pesoMax ?? a.pesoLimite ?? a.peso_max ?? a.peso_limite)
    - toNumber(b.pesoMax ?? b.pesoLimite ?? b.peso_max ?? b.peso_limite)
  ))[0] || null;
  const lista = origem?.cotacoes || [];
  const indice = indiceCotacoesPorRota(lista);
  const naOrdem = (chaves) => {
    const posicoes = [...new Set(chaves.flatMap((k) => indice.get(k) || []))].sort((a, b) => a - b);
    return posicoes.map((i) => lista[i]).filter(dentroDoPeso);
  };

  // A rota nominal exata sempre vence. Isso impede SUL II de fornecer o
  // percentual para SUL III e impede uma cotacao generica de passar na frente.
  const exatas = naOrdem([rotaNorm]);
  if (exatas.length) return ordenarPorFaixa(exatas);

  const porCodigoDestino = naOrdem([ufDestinoNorm, ibgePrefixo].filter(Boolean));
  if (porCodigoDestino.length) return ordenarPorFaixa(porCodigoDestino);

  const genericas = naOrdem(['']);
  return ordenarPorFaixa(genericas);
}

// Indice (por lista de cotacoes) rota normalizada -> posicoes na lista. Montado uma vez por lista e reaproveitado
// em todas as buscas; as posicoes preservam a ordem original (o desempate de ordenarPorFaixa depende dela).
const indicesCotacoesPorLista = new WeakMap();
function indiceCotacoesPorRota(lista) {
  let indice = indicesCotacoesPorLista.get(lista);
  if (indice && indice.tamanho === lista.length) return indice.mapa;
  const mapa = new Map();
  lista.forEach((item, posicao) => {
    const chave = normalizeCompare(item.rota);
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push(posicao);
  });
  indice = { mapa, tamanho: lista.length };
  indicesCotacoesPorLista.set(lista, indice);
  return mapa;
}

function getTipoCalculo(origem = {}, cotacao = {}) {
  const tipoOrigem = normalizeText(origem.generalidades?.tipoCalculo || origem.generalidades?.tipo_calculo || '');
  const tipoCotacao = normalizeText(cotacao.tipoCalculo || cotacao.tipo_calculo);
  const temFaixaValorada = toNumber(cotacao.valorFixo || cotacao.taxaAplicada || cotacao.valor_fixo || cotacao.taxa_aplicada) > 0
    || toNumber(cotacao.pesoMax || cotacao.pesoLimite || cotacao.peso_max || cotacao.peso_limite) > 0;

  if (tipoOrigem.includes('FAIXA') && temFaixaValorada) return 'FAIXA_DE_PESO';
  if (tipoCotacao.includes('FAIXA')) return 'FAIXA_DE_PESO';
  if (tipoCotacao.includes('PERCENT')) return 'PERCENTUAL';
  if (tipoOrigem.includes('FAIXA')) return 'FAIXA_DE_PESO';

  return 'PERCENTUAL';
}

function inferirAliquotaIcmsAuditoria(origem = {}, rota = {}, cte = {}, transportadoraTabela = '') {
  const generalidades = origem.generalidades || {};
  const manual = toNumber(
    generalidades.aliquotaIcms ??
    generalidades.aliquota_icms ??
    generalidades.icmsPercentual ??
    generalidades.icms_percentual
  );

  const ufOrigem = String(
    pick(cte, ['uf_origem', 'ufOrigem']) ||
    rota.ufOrigem ||
    getUfByIbge(rota.ibgeOrigem || pickDigits(cte, ['ibge_origem', 'ibgeOrigem', 'ibge_corrigido_origem']) || origem.rotas?.[0]?.ibgeOrigem)
  ).trim().toUpperCase();

  const ufDestino = String(
    pick(cte, ['uf_destino', 'ufDestino']) ||
    rota.ufDestino ||
    getUfByIbge(rota.ibgeDestino || pickDigits(cte, ['ibge_destino', 'ibgeDestino', 'codigo_ibge_destino', 'ibge_corrigido_destino']))
  ).trim().toUpperCase();

  if (manual > 0) return { aliquota: manual, origem: 'manual', ufOrigem, ufDestino };
  const matriz = resolverAliquotaIcmsUfContexto({
    ufOrigem,
    ufDestino,
    // As excecoes de ICMS sao cadastradas pelo nome canonico da tabela.
    // O CT-e pode trazer outra razao social (resolvida pelo vinculo), portanto
    // consultar pelo nome bruto faria a excecao perder para a matriz geral.
    transportadora: transportadoraTabela || nomeTransportadoraCte(cte),
    // Cidade e canal da excecao pertencem ao cadastro da tabela localizada.
    // Os campos brutos do CT-e podem ter outra grafia ou estar vazios.
    cidadeOrigem: origem?.cidade || pick(cte, ['cidade_origem', 'origem']),
    canal: origem?.canal || rota?.canal || pick(cte, ['canal', 'canal_original']),
  });
  if (matriz) return matriz;
  if (!ufOrigem || !ufDestino) return { aliquota: 12, origem: 'legislacao_sem_uf_completa', ufOrigem, ufDestino };
  if (ufOrigem === ufDestino) return { aliquota: 17, origem: 'legislacao_interna', ufOrigem, ufDestino };

  const sulSudesteSemES = new Set(['PR', 'SC', 'RS', 'SP', 'RJ', 'MG']);
  const norteNordesteCentroOesteMaisES = new Set(['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'PA', 'PB', 'PE', 'PI', 'RN', 'RO', 'RR', 'SE', 'TO']);

  if (sulSudesteSemES.has(ufOrigem) && norteNordesteCentroOesteMaisES.has(ufDestino)) {
    return { aliquota: 7, origem: 'legislacao_interestadual_7', ufOrigem, ufDestino };
  }

  return { aliquota: 12, origem: 'legislacao_interestadual_12', ufOrigem, ufDestino };
}

function origemTemIcmsAtivoAuditoria(origem = {}) {
  const generalidades = origem.generalidades || {};
  return toBooleanFlag(
    generalidades.incideIcms ??
    generalidades.incide_icms ??
    generalidades.icms ??
    generalidades.aplicaIcms ??
    generalidades.aplica_icms ??
    origem.incideIcms ??
    origem.incide_icms
  );
}

// Raizes de CNPJ adicionais (Transportadoras > CNPJs adicionais), por id.
// Preenchido por precarregarRaizesAdicionaisAuditoria nos pontos async de entrada.
let _cacheRaizesAdicionaisPorId = new Map();

export async function precarregarRaizesAdicionaisAuditoria() {
  try {
    _cacheRaizesAdicionaisPorId = await carregarRaizesAdicionaisPorId();
  } catch (error) {
    console.warn('[Auditoria CT-e] CNPJs adicionais indisponíveis; seguindo sem eles.', error?.message || error);
    _cacheRaizesAdicionaisPorId = new Map();
  }
  return _cacheRaizesAdicionaisPorId;
}

export function normalizarTransportadoras(transportadoras = []) {
  return (transportadoras || []).map((transportadora) => ({
    ...transportadora,
    raizesAdicionais: _cacheRaizesAdicionaisPorId.get(transportadora.id) || [],
    __nomeNorm: normalizeTransportadoraCompare(transportadora.nome),
    __cnpjRaiz: obterRaizCnpj(transportadora.cnpjRaiz || transportadora.cnpj),
    __cnpjRaizesOrigens: Array.from(new Set((transportadora.origens || [])
      .map((origem) => obterRaizCnpj(origem.cnpjRaiz || origem.cnpj))
      .filter(Boolean))),
    origens: (transportadora.origens || []).map((origem) => ({
      ...origem,
      __cidadeNorm: normalizeCompare(origem.cidade),
      rotas: origem.rotas || [],
      cotacoes: origem.cotacoes || [],
      taxasEspeciais: origem.taxasEspeciais || [],
    })),
  }));
}

// ─── Tabelas alternativas na estrutura OFICIAL (rotas/cotacoes) ───────────
// Uma origem pode ter, dentro dela mesma, rotas/cotações marcadas com
// `grupoTabelaAlternativa` (rótulo livre, ex.: "OTR / Fora de estrada",
// "Rodas") — ver migration 20260909130000_rotas_cotacoes_grupo_alternativo.sql.
// Nulo = rota/cotação da tabela principal (comportamento padrão).
//
// A lógica de comparação (agruparTabelasAlternativasPorTransportadora /
// calcularValorParaTabelaEspecifica / montarComparativoTabelas mais abaixo)
// já sabe operar sobre um array `transportadoras` onde cada tabela alternativa
// é uma ENTRADA separada (nome igual, `tabelaAlternativaDe`/`negociacaoId`
// preenchidos) — convenção usada originalmente por
// converterTabelaNegociacaoParaSimulador (tabelasNegociacaoSimuladorAdapter.js).
// Esta função reaproveita essa mesma convenção, mas a partir da estrutura
// oficial: para cada transportadora com algum grupo alternativo cadastrado,
// gera uma entrada sintética por grupo (mesma transportadora, origens
// filtradas para só aquele grupo) e restringe a entrada original a apenas
// as rotas/cotações SEM grupo (tabela principal) — sem alternativas
// cadastradas, o resultado é idêntico ao array de entrada.
function filtrarOrigemPorGrupoAlternativo(origem = {}, grupo) {
  const pertenceAoGrupo = (item) => {
    const valor = item?.grupoTabelaAlternativa || null;
    return grupo === null ? !valor : valor === grupo;
  };

  // Generalidades: se a tabela alternativa tem generalidade própria
  // cadastrada, usa ela inteira; senão cai de volta na generalidade
  // principal da origem (comportamento anterior a esta extensão).
  const generalidadeAlternativa = grupo === null
    ? null
    : (origem.generalidadesAlternativas || []).find((item) => item.grupoTabelaAlternativa === grupo);

  // Taxas especiais: casam por IBGE destino, não por linha inteira como
  // rotas/cotações. Uma tabela alternativa herda as taxas da principal e
  // só sobrescreve os destinos em que ela mesma tiver uma taxa cadastrada —
  // não precisa recadastrar tudo pra mudar só um destino.
  const taxasPrincipais = (origem.taxasEspeciais || []).filter((item) => !item?.grupoTabelaAlternativa);
  const taxasEspeciaisFiltradas = (() => {
    if (grupo === null) return taxasPrincipais;
    const taxasGrupo = (origem.taxasEspeciais || []).filter(pertenceAoGrupo);
    if (!taxasGrupo.length) return taxasPrincipais;
    const porDestino = new Map(taxasPrincipais.map((item) => [item.ibgeDestino, item]));
    taxasGrupo.forEach((item) => porDestino.set(item.ibgeDestino, item));
    return Array.from(porDestino.values());
  })();

  return {
    ...origem,
    generalidades: generalidadeAlternativa || origem.generalidades,
    rotas: (origem.rotas || []).filter(pertenceAoGrupo),
    cotacoes: (origem.cotacoes || []).filter(pertenceAoGrupo),
    taxasEspeciais: taxasEspeciaisFiltradas,
  };
}

function coletarGruposAlternativosTransportadora(transportadora = {}) {
  const grupos = new Set();
  (transportadora.origens || []).forEach((origem) => {
    [...(origem.rotas || []), ...(origem.cotacoes || [])].forEach((item) => {
      if (item?.grupoTabelaAlternativa) grupos.add(String(item.grupoTabelaAlternativa));
    });
  });
  return Array.from(grupos);
}

// Vigência de um grupo (reajuste com data de início): início mais antigo e fim
// mais tardio entre as origens da transportadora que definiram vigência pro grupo.
// Origens sem vigência cadastrada não entram na conta. Vazio = alternativa comum.
function vigenciaDoGrupoTransportadora(transportadora = {}, grupo) {
  let inicio = '';
  let fim = '';
  (transportadora.origens || []).forEach((origem) => {
    const v = origem?.vigenciasAlternativas?.[grupo];
    if (!v) return;
    if (v.inicio && (!inicio || v.inicio < inicio)) inicio = v.inicio;
    if (v.fim && v.fim > fim) fim = v.fim;
  });
  return { inicio, fim };
}

// Data de emissão do CT-e em YYYY-MM-DD (aceita ISO e dd/mm/aaaa); '' se ausente.
function dataEmissaoIsoCte(cte = {}) {
  const valor = pick(cte, ['data_emissao', 'emissao', 'dataEmissao']);
  if (!valor) return '';
  const texto = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.slice(0, 10);
  const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : '';
}

// Aplica a vigência das tabelas alternativas de um grupo (principal + alternativas)
// à data de emissão do CT-e. Alternativa com vigência é reajuste: só vale dentro da
// janela. Se alguma está em vigor, ela SUBSTITUI a principal (e reajustes mais
// antigos), de forma determinística pela data — sem escolher "a mais próxima do
// valor cobrado", que deixaria uma cobrança indevida passar. Alternativas sem
// vigência (OTR, rodas) continuam concorrendo como sempre. Se o CT-e ainda é
// anterior ao início do reajuste, ele é descartado e a principal segue valendo.
// Sem data de emissão não dá pra decidir: mantém o comportamento anterior.
export function aplicarVigenciaNoGrupo(entradas = [], dataIso = '') {
  const comVigencia = (entradas || []).filter((e) => e?.vigenciaInicio || e?.vigenciaFim);
  if (!comVigencia.length) return { entradas, porVigencia: false };
  if (!dataIso) return { entradas, porVigencia: false };

  const semVigencia = entradas.filter((e) => !(e?.vigenciaInicio || e?.vigenciaFim));
  const emVigor = comVigencia.filter((e) => (
    (!e.vigenciaInicio || dataIso >= e.vigenciaInicio) && (!e.vigenciaFim || dataIso <= e.vigenciaFim)
  ));
  if (!emVigor.length) return { entradas: semVigencia, porVigencia: false };

  const maisRecente = emVigor.reduce((max, e) => ((e.vigenciaInicio || '') > max ? (e.vigenciaInicio || '') : max), '');
  const vigentes = emVigor.filter((e) => (e.vigenciaInicio || '') === maisRecente);
  const alternativasComuns = semVigencia.filter((e) => e.tabelaAlternativaDe);
  return { entradas: [...vigentes, ...alternativasComuns], porVigencia: true };
}

export function expandirTabelasAlternativasOficiais(transportadoras = []) {
  const expandido = [];
  (transportadoras || []).forEach((transportadora) => {
    const grupos = coletarGruposAlternativosTransportadora(transportadora);
    if (!grupos.length) {
      expandido.push(transportadora);
      return;
    }

    const idPrincipal = transportadora.id || transportadora.nome;
    expandido.push({
      ...transportadora,
      negociacaoId: idPrincipal,
      tabelaAlternativaDe: null,
      varianteTabela: null,
      origens: (transportadora.origens || []).map((origem) => filtrarOrigemPorGrupoAlternativo(origem, null)),
    });

    grupos.forEach((grupo) => {
      const vigencia = vigenciaDoGrupoTransportadora(transportadora, grupo);
      expandido.push({
        ...transportadora,
        id: `${idPrincipal}::alt::${grupo}`,
        negociacaoId: `${idPrincipal}::alt::${grupo}`,
        tabelaAlternativaDe: idPrincipal,
        varianteTabela: grupo,
        vigenciaInicio: vigencia.inicio,
        vigenciaFim: vigencia.fim,
        origens: (transportadora.origens || []).map((origem) => filtrarOrigemPorGrupoAlternativo(origem, grupo)),
      });
    });
  });
  return expandido;
}

function nomesTransportadorasRegistros(registros = [], mapaVinculos = null) {
  return Array.from(new Set(
    (registros || [])
      .map((row) => nomeTransportadoraCte(row, mapaVinculos))
      .map((nome) => String(nome || '').trim())
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b));
}

function routeKeysRegistros(registros = []) {
  const keys = new Set();
  (registros || []).forEach((cte) => {
    const origem = pickDigits(cte, ['ibge_origem', 'ibgeOrigem', 'ibge_corrigido_origem']);
    const destino = pickDigits(cte, ['ibge_destino', 'ibgeDestino', 'codigo_ibge_destino', 'ibge_corrigido_destino']);
    const canal = canalCategoria(pick(cte, ['canal', 'canal_original']));
    if (!origem || !destino) return;
    // Exceções de origem (Ferramentas): o CT-e sai de Vitória, mas a tabela da
    // TAM está cadastrada em Serra. Sem incluir a origem da tabela aqui, a busca
    // direcionada por rota não acha nada e o sistema cai no plano B — carregar a
    // tabela inteira da transportadora, que é lento pra valer.
    const origensBusca = new Set([origem]);
    ibgesOrigemEquivalentes(
      _cacheMapaEquivalenciasOrigem,
      pick(cte, ['cidade_origem', 'cidadeOrigem', 'origem']),
      origem,
    ).forEach((valor) => origensBusca.add(valor));

    origensBusca.forEach((ibgeOrigemBusca) => {
      keys.add(`${ibgeOrigemBusca}-${destino}`);
      keys.add(`${destino}-${ibgeOrigemBusca}`);
      if (canal) {
        keys.add(`${canal}|${ibgeOrigemBusca}-${destino}`);
        keys.add(`${canal}|${destino}-${ibgeOrigemBusca}`);
      }
    });
  });
  return Array.from(keys);
}

async function carregarBaseFreteParaRegistros(registros = [], onProgress, transportadorasAlvo = [], mapaVinculos = null) {
  await precarregarRaizesAdicionaisAuditoria();
  const routeKeys = routeKeysRegistros(registros);
  if (routeKeys.length > 0 && routeKeys.length <= 2500 && !(transportadorasAlvo || []).length) {
    onProgress?.({ etapa: 'carregando_tabelas_rotas', carregados: 0, total: routeKeys.length });
    const baseRotas = expandirTabelasAlternativasOficiais(normalizarTransportadoras(await buscarBaseSimulacaoPorRotasDb({
      routeKeys,
      onProgress: (carregados, total) => onProgress?.({ etapa: 'carregando_tabelas_rotas', carregados, total }),
    })));
    // Encontrar alguma tabela para as rotas nao basta: a consulta enxuta pode
    // trazer concorrentes e deixar de fora justamente a transportadora do CT-e
    // (especialmente quando a origem real e liberada por equivalencia). Nesse
    // caso seguimos para a busca por transportadora/base completa.
    // Achar a transportadora tambem nao basta: se outro CT-e do lote trouxe rota
    // da mesma transportadora, os CT-es cuja rota NAO veio na consulta enxuta
    // caiam em SEM_ROTA — e o resultado passava a depender de quais CT-es foram
    // recalculados juntos (fatura inteira x so os "sem calculo"). Exige que cada
    // CT-e (em alguma de suas variantes, ex.: endereco corrigido) tenha tabela e
    // rota na base carregada; senao usa a busca completa por transportadora.
    const chaveCobertura = (cte) => onlyDigits(pick(cte, ['chave_cte', 'chaveCte', 'chave'])) || onlyDigits(pick(cte, ['numero_cte', 'numeroCte', 'cte', 'nro_cte'])) || String(pick(cte, ['id']) || '');
    const porCte = new Map();
    (registros || []).forEach((cte) => {
      const chave = chaveCobertura(cte);
      const variantes = porCte.get(chave) || [];
      variantes.push(cte);
      porCte.set(chave, variantes);
    });
    const cobreTransportadorasDosCtes = baseRotas.length > 0 && [...porCte.values()].every((variantes) => variantes.some((cte) => {
      const nome = nomeTransportadoraCte(cte, mapaVinculos);
      const cnpj = cnpjTransportadoraCte(cte);
      if (!localizarTransportadoras(baseRotas, nome, cnpj).length) return false;
      const achou = localizarTabelaAuditoria(baseRotas, cte, mapaVinculos, '', { ignorarCubagem: true });
      return !['SEM_TABELA', 'SEM_ORIGEM', 'SEM_ROTA'].includes(achou.status);
    }));
    if (cobreTransportadorasDosCtes) return baseRotas;
  }

  const nomes = (transportadorasAlvo || []).length
    ? Array.from(new Set((transportadorasAlvo || []).map((nome) => aplicarVinculoTransportadora(nome, mapaVinculos) || nome).map((nome) => String(nome || '').trim()).filter(Boolean)))
    : nomesTransportadorasRegistros(registros, mapaVinculos);

  // O limite era 5, mas carregarBaseTransportadorasDb ja busca por
  // transportadoraIds em consultas batched (nao faz uma query por nome), entao
  // nao ha custo real em cobrir mais nomes aqui. Um limite baixo forcava faturas
  // com CT-es de varias transportadoras (comum em faturas consolidadas) a cair
  // no fallback de baixar a base inteira (~1,8 milhao de rotas) mesmo quando so
  // precisavam de um punhado de transportadoras especificas.
  if (nomes.length > 0 && nomes.length <= 40) {
    const cacheKey = nomes.map((nome) => normalizeTransportadoraCompare(nome)).sort().join('|');
    if (!_cacheBaseFretePorTransportadora.has(cacheKey)) {
      onProgress?.({ etapa: 'carregando_tabelas_transportadora', carregados: 0, total: nomes.length });
      const cnpjs = (registros || []).map(cnpjTransportadoraCte).filter(Boolean);
      const base = expandirTabelasAlternativasOficiais(normalizarTransportadoras(await carregarBaseTransportadorasDb(nomes, { cnpjs })));
      // Sem tabela para a transportadora (nem por nome nem por CNPJ): nao adianta
      // baixar a base inteira (~1M linhas) para uma fatura de poucos CT-es — o
      // resultado seria o mesmo "sem tabela", so que minutos depois.
      _cacheBaseFretePorTransportadora.set(cacheKey, base);
    }
    return _cacheBaseFretePorTransportadora.get(cacheKey);
  }

  onProgress?.({ etapa: 'carregando_tabelas', carregados: 0, total: registros.length });
  if (!_cacheBaseFrete) {
    _cacheBaseFrete = expandirTabelasAlternativasOficiais(normalizarTransportadoras(await carregarBaseCompletaDb(onProgress)));
  }
  return _cacheBaseFrete;
}

function localizarTransportadoras(transportadoras = [], nomeCte = '', cnpjCte = '') {
  const raizCte = obterRaizCnpj(cnpjCte);
  if (raizCte) {
    const porCnpj = transportadoras.filter((item) => item.__cnpjRaiz === raizCte
      || (item.__cnpjRaizesOrigens || []).includes(raizCte)
      || (item.raizesAdicionais || []).includes(raizCte));
    if (porCnpj.length) return porCnpj;
  }

  const nomeNorm = normalizeTransportadoraCompare(nomeCte);
  if (!nomeNorm) return [];

  const exatas = transportadoras.filter((item) => item.__nomeNorm === nomeNorm);
  const compativeis = transportadoras.filter((item) => nomeCompativel(item.nome, nomeCte));
  if (exatas.length) {
    const idsExatos = new Set(exatas.map((item) => item.id || item.__nomeNorm || item.nome));
    return [
      ...exatas,
      ...compativeis.filter((item) => !idsExatos.has(item.id || item.__nomeNorm || item.nome)),
    ];
  }

  return compativeis;
}

function listarOrigensCompativeis(transportadora, cte = {}) {
  const ibgeOrigem = pickDigits(cte, ['ibge_origem', 'ibgeOrigem', 'ibge_corrigido_origem']);
  const cidadeOrigem = pick(cte, ['cidade_origem', 'origem']);
  const canal = pick(cte, ['canal', 'canal_original']);

  const candidatas = (transportadora?.origens || []).filter((origem) => canalCompativel(origem.canal, canal));
  if (!candidatas.length) return [];

  // Exceção cadastrada em Ferramentas (ex.: TAM, origem Serra, considera
  // Vitória): vale antes do IBGE, senão a origem certa nunca entra na disputa.
  const porExcecao = candidatas.filter((origem) => origemAceitaPorExcecao(
    _cacheMapaEquivalenciasOrigem,
    transportadora?.nome,
    origem.cidade,
    cidadeOrigem,
    ibgeOrigem,
  ));
  if (porExcecao.length) return porExcecao;

  if (ibgeOrigem) {
    const porIbge = candidatas.filter((origem) => (
      (origem.rotas || []).some((rota) => onlyDigits(rota.ibgeOrigem).slice(0, 7) === ibgeOrigem)
    ));
    if (porIbge.length) return porIbge;
  }

  const porCidade = candidatas.filter((origem) => cidadeCompativel(origem.cidade, cidadeOrigem));
  if (porCidade.length) return porCidade;

  return cidadeOrigem || ibgeOrigem ? [] : candidatas;
}

export function localizarRotaAuditoria(origem, cte = {}) {
  const ibgeDestino = pickDigits(cte, ['ibge_destino', 'ibgeDestino', 'codigo_ibge_destino', 'ibge_corrigido_destino']);
  const ibgeOrigem = pickDigits(cte, ['ibge_origem', 'ibgeOrigem', 'ibge_corrigido_origem']);
  const cidadeDestino = pick(cte, ['cidade_destino', 'cidadeDestino', 'destino']);
  const cidadeDestinoNorm = normalizeCompare(cidadeDestino);
  const rotas = origem?.rotas || [];

  let rotasDestino = ibgeDestino
    ? rotas.filter((rota) => onlyDigits(rota.ibgeDestino).slice(0, 7) === ibgeDestino)
    : [];

  if (!rotasDestino.length && cidadeDestinoNorm) {
    rotasDestino = rotas.filter((rota) => {
      const rotaNorm = normalizeCompare(rota.nomeRota || rota.rota || rota.destino || '');
      return rotaNorm === cidadeDestinoNorm
        || rotaNorm.includes(cidadeDestinoNorm)
        || cidadeDestinoNorm.includes(rotaNorm);
    });
  }

  if (!rotasDestino.length) return null;

  if (ibgeOrigem) {
    return rotasDestino.find((rota) => (
      !rota.ibgeOrigem || onlyDigits(rota.ibgeOrigem).slice(0, 7) === ibgeOrigem
    )) || rotasDestino[0];
  }

  return rotasDestino[0];
}

function pesoCte(cte = {}, opcoes = {}) {
  const pesoDeclarado = toNumber(pick(cte, ['peso_declarado', 'pesoDeclarado', 'peso']));
  // Modo "usar peso do CT-e": ignora peso cubado e aplica só o percentual de
  // contingência sobre o peso declarado, quando houver.
  if (opcoes.ignorarCubagem) {
    const percentual = toNumber(opcoes.percentualContingenciaPeso);
    return pesoDeclarado * (1 + percentual / 100);
  }
  const pesoCubado = toNumber(pick(cte, ['peso_cubado', 'pesoCubado']));
  return Math.max(pesoDeclarado, pesoCubado, toNumber(pick(cte, ['peso'])));
}

function localizarTabelaAuditoria(transportadoras = [], cte = {}, mapaVinculos = null, transportadoraAlvo = '', opcoes = {}) {
  const transportadoraNome = transportadoraAlvo || nomeTransportadoraCte(cte, mapaVinculos);
  const cnpjTransportadora = cnpjTransportadoraCte(cte);
  const candidatasTransportadora = localizarTransportadoras(transportadoras, transportadoraNome, cnpjTransportadora);
  if (!candidatasTransportadora.length) return { status: 'SEM_TABELA' };

  const tentativas = [];
  const peso = pesoCte(cte, opcoes);

  for (const transportadora of candidatasTransportadora) {
    const origens = listarOrigensCompativeis(transportadora, cte);
    for (const origem of origens) {
      const rota = localizarRotaAuditoria(origem, cte);
      const cotacao = rota ? getCotacaoPorRota(origem, rota, peso, cte) : null;
      const tentativa = { transportadora, origem, rota, cotacao };
      tentativas.push(tentativa);
      if (rota && cotacao) return { status: 'OK', ...tentativa };
    }
  }

  if (!tentativas.length) return { status: 'SEM_ORIGEM', transportadora: candidatasTransportadora[0] };

  const comRota = tentativas.find((item) => item.rota);
  if (!comRota) return { status: 'SEM_ROTA', transportadora: tentativas[0].transportadora };

  return { status: 'SEM_FAIXA', ...comRota };
}

function montarResultadoBase(cte, status, motivo, extras = {}) {
  const valorCte = toNumber(pick(cte, ['valor_cte', 'valorCte', 'valor_frete', 'frete']));
  const valorNf = toNumber(pick(cte, ['valor_nf', 'valorNF', 'nf_venda', 'valor_nota']));
  // Calculo original da Verum (vem na importacao -> realizado_local_ctes).
  // Preservado em coluna separada para nunca ser perdido pelo recalculo.
  const valorCalculadoVerum = toNumber(pick(cte, [
    'valor_calculado', 'valorCalculado',
    'frete_calculado', 'freteCalculado',
    'valor_tabela', 'valorTabela',
    'valor_simulado', 'valorSimulado',
  ]));
  const diferencaVerum = valorCalculadoVerum > 0 ? valorCte - valorCalculadoVerum : 0;

  return {
    competencia: String(pick(cte, ['competencia', 'mes_competencia']) || '').slice(0, 7),
    data_emissao: pick(cte, ['data_emissao', 'emissao', 'dataEmissao']) || null,
    chave_cte: pick(cte, ['chave_cte', 'chaveCte', 'chave']) || null,
    numero_cte: pick(cte, ['numero_cte', 'numeroCte', 'cte', 'nro_cte']) || null,
    serie_cte: serieDaChaveCte(pick(cte, ['chave_cte', 'chaveCte', 'chave'])) || null,
    transportadora: pick(cte, ['transportadora', 'nome_transportadora', 'transportadora_realizada', 'transportador']) || null,
    cnpj_transportadora: pick(cte, ['cnpj_transportadora', 'cnpjTransportadora']) || null,
    tomador_servico: pick(cte, ['tomador_servico', 'tomadorServico', 'tomador']) || null,
    cidade_origem: pick(cte, ['cidade_origem', 'cidadeOrigem', 'origem']) || null,
    uf_origem: String(pick(cte, ['uf_origem', 'ufOrigem']) || '').toUpperCase() || null,
    ibge_origem: pickDigits(cte, ['ibge_origem', 'ibgeOrigem', 'ibge_corrigido_origem']) || null,
    cidade_destino: pick(cte, ['cidade_destino', 'cidadeDestino', 'destino']) || null,
    uf_destino: String(pick(cte, ['uf_destino', 'ufDestino']) || '').toUpperCase() || null,
    ibge_destino: pickDigits(cte, ['ibge_destino', 'ibgeDestino', 'codigo_ibge_destino', 'ibge_corrigido_destino']) || null,
    canal: pick(cte, ['canal', 'canal_original']) || null,
    peso: toNumber(pick(cte, ['peso', 'peso_final', 'pesoFinal'])),
    peso_declarado: toNumber(pick(cte, ['peso_declarado', 'pesoDeclarado', 'peso'])),
    peso_cubado: toNumber(pick(cte, ['peso_cubado', 'pesoCubado'])),
    cubagem: toNumber(pick(cte, ['cubagem', 'cubagem_total', 'cubagemTotal'])),
    qtd_volumes: toNumber(pick(cte, ['qtd_volumes', 'qtdVolumes', 'volumes'])),
    valor_nf: valorNf,
    numero_nf: pick(cte, ['nota_fiscal', 'notaFiscal', 'numero_nf', 'numeroNf']) || null,
    chave_nfe: pick(cte, ['chave_nfe', 'chaveNfe']) || null,
    cnpj_tomador: pickDigits(cte, ['cnpj_tomador', 'cnpjTomador'], 14) || null,
    // CNPJ do emissor da NF (Remetente): prioriza o campo "Documento
    // remetente"/aba "Notas Fiscais" da propria importacao (o dado real),
    // depois tenta extrair da chave de acesso da NF (posicoes 7-20) e por
    // ultimo usa o CNPJ tomador como reserva.
    cnpj_emissor_nf: pickDigits(cte, ['documento_remetente', 'documentoRemetente'], 14)
      || cnpjDaChaveNfe(pick(cte, ['chave_nfe', 'chaveNfe']))
      || pickDigits(cte, ['cnpj_tomador', 'cnpjTomador'], 14)
      || null,
    valor_cte: valorCte,
    valor_calculado: 0,
    valor_calculado_verum: valorCalculadoVerum,
    diferenca_verum: diferencaVerum,
    diferenca: 0,
    diferenca_abs: 0,
    percentual_diferenca: 0,
    status_calculo: status,
    motivo_sem_calculo: motivo,
    tracking_match: Boolean(cte.trackingMatch),
    tracking_status: cte.trackingNaoConsultado ? 'NAO_CONSULTADO' : (cte.trackingMatch ? 'VINCULADO' : 'SEM_VINCULO'),
    transportadora_tabela: extras.transportadora_tabela || null,
    tipo_calculo: extras.tipo_calculo || null,
    detalhes_calculo: extras.detalhes_calculo || null,
  };
}

function inverterOrigemDestinoCte(cte = {}) {
  return {
    ...cte,
    cidade_origem: pick(cte, ['cidade_destino', 'cidadeDestino', 'destino']) || '',
    cidadeOrigem: pick(cte, ['cidade_destino', 'cidadeDestino', 'destino']) || '',
    origem: pick(cte, ['cidade_destino', 'cidadeDestino', 'destino']) || '',
    uf_origem: String(pick(cte, ['uf_destino', 'ufDestino']) || '').toUpperCase(),
    ufOrigem: String(pick(cte, ['uf_destino', 'ufDestino']) || '').toUpperCase(),
    ibge_origem: pickDigits(cte, ['ibge_destino', 'ibgeDestino', 'codigo_ibge_destino', 'ibge_corrigido_destino']),
    ibgeOrigem: pickDigits(cte, ['ibge_destino', 'ibgeDestino', 'codigo_ibge_destino', 'ibge_corrigido_destino']),
    cidade_destino: pick(cte, ['cidade_origem', 'cidadeOrigem', 'origem']) || '',
    cidadeDestino: pick(cte, ['cidade_origem', 'cidadeOrigem', 'origem']) || '',
    destino: pick(cte, ['cidade_origem', 'cidadeOrigem', 'origem']) || '',
    uf_destino: String(pick(cte, ['uf_origem', 'ufOrigem']) || '').toUpperCase(),
    ufDestino: String(pick(cte, ['uf_origem', 'ufOrigem']) || '').toUpperCase(),
    ibge_destino: pickDigits(cte, ['ibge_origem', 'ibgeOrigem', 'ibge_corrigido_origem']),
    ibgeDestino: pickDigits(cte, ['ibge_origem', 'ibgeOrigem', 'ibge_corrigido_origem']),
    __auditoriaDevolucaoInvertida: true,
  };
}

async function carregarContextoLotacaoAuditoria(supabase, mapaVinculos = null) {
  const { data: tabelasDb, error: tabelasError } = await supabase
    .from('lotacao_tabelas')
    .select('id,nome,nome_normalizado,fontes_valor')
    .eq('tipo', 'TRANSPORTADORA');
  if (tabelasError) return { tabelas: [], origensFracionadoPorNome: new Map() };

  const tabelasValidas = (tabelasDb || []).filter((tabela) => tabela.fontes_valor?.__governanca?.validado === true);
  const ids = tabelasValidas.map((tabela) => tabela.id);
  const rotas = [];
  for (let inicio = 0; inicio < ids.length; inicio += 100) {
    const loteIds = ids.slice(inicio, inicio + 100);
    let pagina = 0;
    while (loteIds.length) {
      const { data, error } = await supabase
        .from('lotacao_rotas')
        .select('id,tabela_id,origem,uf_origem,destino,uf_destino,tipo_veiculo,valor,pedagio,prazo')
        .in('tabela_id', loteIds)
        .range(pagina * PAGE_SIZE, (pagina + 1) * PAGE_SIZE - 1);
      if (error || !data?.length) break;
      rotas.push(...data);
      if (data.length < PAGE_SIZE) break;
      pagina += 1;
    }
  }

  const [{ data: transportadorasDb }, { data: origensDb }] = await Promise.all([
    supabase.from('transportadoras').select('id,nome'),
    supabase.from('origens').select('transportadora_id'),
  ]);
  const contagemPorId = new Map();
  (origensDb || []).forEach((origem) => contagemPorId.set(origem.transportadora_id, (contagemPorId.get(origem.transportadora_id) || 0) + 1));
  const origensFracionadoPorNome = new Map((transportadorasDb || []).map((transportadora) => [
    normalizeTransportadoraCompare(transportadora.nome),
    contagemPorId.get(transportadora.id) || 0,
  ]));
  const rotasPorTabela = new Map();
  rotas.forEach((rota) => {
    const lista = rotasPorTabela.get(rota.tabela_id) || [];
    lista.push(rota);
    rotasPorTabela.set(rota.tabela_id, lista);
  });

  return {
    tabelas: tabelasValidas.map((tabela) => ({ ...tabela, rotas: rotasPorTabela.get(tabela.id) || [] })),
    origensFracionadoPorNome,
    mapaVinculos,
    fluxo: await carregarFluxoLotacaoAuditoria(supabase),
  };
}

// ─── Fluxo de lotação (lotacao_cargas) ─────────────────────────────────────
// Viagens da operação (planilha "FLUXO CARGA LOTAÇÃO" / Lotação nativa) com os
// CT-es emitidos e o frete combinado com a transportadora. Quando a rota não
// está na tabela de lotação (ou a transportadora nem tem tabela — transferência
// spot), o valor combinado da viagem é o que audita o CT-e. Uma viagem (DIST) pode
// ter vários CT-es (às vezes em faturas diferentes): funciona como saldo — na ordem
// de emissão, cada CT-e consome o que cobrou até o saldo acabar; o que passar vira
// excedente daquele CT-e (vai para aprovação). Excedente aprovado pela operação
// (lotacao_solicitacoes) aumenta o saldo da viagem.
let _cacheFluxoLotacao = { em: 0, dados: null };
// Mesmo criterio da Auditoria de Lotacao (totalAdicionalAutorizadoCarga em lotacaoFluxoCargas.js).
const STATUS_ADICIONAL_APROVADO = ['APROVADO', 'APROVADO_OPERACAO'];

async function carregarFluxoLotacaoAuditoria(supabase) {
  if (_cacheFluxoLotacao.dados && Date.now() - _cacheFluxoLotacao.em < 5 * 60 * 1000) return _cacheFluxoLotacao.dados;
  const cargas = [];
  for (let pagina = 0; ; pagina += 1) {
    const { data, error } = await supabase
      .from('lotacao_cargas')
      .select('id,dist,cte,transportadora,origem,uf_origem,destino,uf_destino,tipo_veiculo,frete_transp,pedagio,status,coleta_planejada,coleta_realizada,emissao_nf')
      .range(pagina * PAGE_SIZE, (pagina + 1) * PAGE_SIZE - 1);
    if (error) return { porNumeroCte: new Map(), adicionaisPorDist: new Map() };
    cargas.push(...(data || []));
    if ((data || []).length < PAGE_SIZE) break;
  }
  const adicionaisPorDist = new Map();
  const { data: solicitacoes } = await supabase
    .from('lotacao_solicitacoes')
    .select('tipo,dist_key,dist,status,valor_adicional,valor_lancado,excedente')
    .in('status', STATUS_ADICIONAL_APROVADO);
  (solicitacoes || []).forEach((s) => {
    const dist = normalizeText(s.dist_key || s.dist);
    const valor = s.tipo === 'CUSTO_ADICIONAL'
      ? (toNumber(s.valor_adicional) || toNumber(s.valor_lancado))
      : toNumber(s.valor_adicional ?? s.excedente);
    if (dist && valor > 0) adicionaisPorDist.set(dist, (adicionaisPorDist.get(dist) || 0) + valor);
  });
  const porNumeroCte = new Map();
  const porId = new Map();
  cargas.forEach((carga) => {
    if (/CANCEL/i.test(String(carga.status || ''))) return;
    const numeros = [...new Set(String(carga.cte || '').split(/[^0-9]+/).filter(Boolean).map((n) => String(Number(n))))];
    const item = { ...carga, numerosCte: numeros };
    porId.set(String(carga.id), item);
    // Viagem sem frete no fluxo só vale pelo vínculo da Operação (que valida o valor na resposta).
    if (toNumber(carga.frete_transp) > 0) numeros.forEach((numero) => porNumeroCte.set(numero, [...(porNumeroCte.get(numero) || []), item]));
  });
  // Questionamento respondido pela Operação (ela escolhe a DIST/viagem do CT-e): vale como vínculo do CT-e à viagem.
  // O fluxo é reimportado e a viagem ganha outro id: sem o id, casa pela DIST (única no fluxo).
  const porDist = new Map();
  porId.forEach((carga) => {
    const dist = normalizeText(carga.dist);
    if (dist) porDist.set(dist, porDist.has(dist) ? null : carga);
  });
  const cargaPorChaveCte = new Map();
  const { data: respostas } = await supabase
    .from('audit_solicitacoes_informacao')
    .select('chave_informada,carga_id,dist,status,resposta,resposta_operacao,justificativa_operacao,respondido_por_nome')
    .in('status', ['RESPONDIDO_OPERACAO', 'FINALIZADO', 'TRATADO'])
    .neq('carga_id', '');
  (respostas || []).forEach((r) => {
    const chave = onlyDigits(r.chave_informada);
    const carga = porId.get(String(r.carga_id)) || porDist.get(normalizeText(r.dist));
    if (chave.length === 44 && carga) {
      cargaPorChaveCte.set(chave, {
        ...carga,
        respostaOperacao: [r.resposta_operacao || r.resposta, r.justificativa_operacao].filter(Boolean).join(' | '),
        respondidoPor: r.respondido_por_nome || '',
      });
    }
  });
  const nomesTransportadoras = [...new Set(cargas.map((c) => String(c.transportadora || '').trim()).filter(Boolean))];
  const dados = { porNumeroCte, adicionaisPorDist, cargaPorChaveCte, nomesTransportadoras };
  _cacheFluxoLotacao = { em: Date.now(), dados };
  return dados;
}

// Nome curto do fluxo ("TRANSGP", "1500", "CLC", "TRANSGP/SCAPINI") contra o nome do CT-e
// (bruto e pelo vínculo de Ferramentas): igualdade/contém como nas tabelas ou palavra inteira.
function transportadoraDoFluxoCompativel(nomeFluxo, nomesCte = []) {
  const partes = String(nomeFluxo || '').split(/[/()]/).map((p) => normalizeTransportadoraCompare(p)).filter((p) => p.length >= 3);
  return partes.some((parte) => nomesCte.some((nome) => {
    const cte = normalizeTransportadoraCompare(nome);
    if (!cte) return false;
    return nomeCompativel(parte, nome) || ` ${cte} `.includes(` ${parte} `) || cte.replace(/\s+/g, '').startsWith(parte.replace(/\s+/g, ''));
  }));
}

const raizDaChaveCte = (cte = {}) => {
  const chave = pickDigits(cte, ['chave_cte', 'chaveCte', 'chave'], 0);
  return chave.length === 44 ? chave.slice(6, 14) : '';
};
const numeroDoCte = (cte = {}) => {
  const numero = pickDigits(cte, ['numero_cte', 'numeroCte', 'cte', 'nro_cte'], 0);
  if (numero) return String(Number(numero));
  const chave = pickDigits(cte, ['chave_cte', 'chaveCte', 'chave'], 0);
  return chave.length === 44 ? String(Number(chave.slice(25, 34))) : '';
};

// Viagem do fluxo deste CT-e: mesmo numero de CT-e, transportadora compativel, data
// proxima da emissao (numero de CT-e repete entre transportadoras/series). Mais de
// uma viagem possivel e nenhuma bate origem/destino: nao chuta.
function localizarViagemFluxoLotacao(cte = {}, contexto = null, mapaVinculos = null) {
  const fluxo = contexto?.fluxo;
  const numero = numeroDoCte(cte);
  if (!fluxo?.porNumeroCte?.size || !numero) return null;
  const vinculadaPelaOperacao = fluxo.cargaPorChaveCte?.get(pickDigits(cte, ['chave_cte', 'chaveCte', 'chave'], 0));
  if (vinculadaPelaOperacao) {
    return vinculadaPelaOperacao.numerosCte.includes(numero)
      ? vinculadaPelaOperacao
      : { ...vinculadaPelaOperacao, numerosCte: [...vinculadaPelaOperacao.numerosCte, numero] };
  }
  const nomeBruto = pick(cte, ['transportadora', 'nome_transportadora', 'transportadora_realizada', 'transportador']);
  const nomes = [nomeBruto, aplicarVinculoTransportadora(nomeBruto, mapaVinculos)].filter(Boolean);
  const emissao = dataEmissaoIsoCte(cte);
  const dias = (a, b) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000;
  let candidatas = (fluxo.porNumeroCte.get(numero) || []).filter((carga) => transportadoraDoFluxoCompativel(carga.transportadora, nomes));
  candidatas = candidatas.filter((carga) => {
    const dataCarga = String(carga.emissao_nf || carga.coleta_realizada || carga.coleta_planejada || '').slice(0, 10);
    return !emissao || !dataCarga || dias(emissao, dataCarga) <= 20;
  });
  const distintas = [...new Map(candidatas.map((c) => [c.id, c])).values()];
  if (distintas.length <= 1) return distintas[0] || null;
  const origem = normalizeCompare(pick(cte, ['cidade_origem', 'cidadeOrigem', 'origem']));
  const destino = normalizeCompare(pick(cte, ['cidade_destino', 'cidadeDestino', 'destino']));
  const porRota = distintas.filter((c) => normalizeCompare(c.destino) === destino || normalizeCompare(c.origem) === origem);
  return porRota.length === 1 ? porRota[0] : null;
}

// Antes do calculo: carrega valor cobrado e emissao dos outros CT-es de cada viagem (para o saldo).
async function prepararFluxoLotacaoParaCtes(supabase, contexto = null, ctes = [], mapaVinculos = null) {
  if (!contexto?.fluxo?.porNumeroCte?.size) return;
  const valores = contexto.valoresCteFluxo || new Map();
  const pendentes = new Map();
  (ctes || []).forEach((cte) => {
    const raiz = raizDaChaveCte(cte);
    const numero = numeroDoCte(cte);
    if (raiz && numero) valores.set(`${raiz}|${numero}`, { valor: toNumber(pick(cte, ['valor_cte', 'valorCte', 'valor_frete', 'frete'])), emissao: dataEmissaoIsoCte(cte) });
  });
  (ctes || []).forEach((cte) => {
    const raiz = raizDaChaveCte(cte);
    const viagem = raiz ? localizarViagemFluxoLotacao(cte, contexto, mapaVinculos) : null;
    (viagem?.numerosCte || []).forEach((numero) => {
      if (!valores.has(`${raiz}|${numero}`)) pendentes.set(`${raiz}|${numero}`, { raiz, numero });
    });
  });
  const numeros = [...new Set([...pendentes.values()].map((p) => p.numero))];
  for (let inicio = 0; inicio < numeros.length; inicio += 200) {
    const { data, error } = await supabase.from(TABELA_CTES).select('chave_cte,numero_cte,valor_cte,data_emissao').in('numero_cte', numeros.slice(inicio, inicio + 200));
    if (error) break;
    (data || []).forEach((row) => {
      const chave = onlyDigits(row.chave_cte);
      if (chave.length !== 44) return;
      const chaveMapa = `${chave.slice(6, 14)}|${String(Number(onlyDigits(row.numero_cte)))}`;
      if (pendentes.has(chaveMapa)) valores.set(chaveMapa, { valor: toNumber(row.valor_cte), emissao: dataEmissaoIsoCte(row) });
    });
  }
  contexto.valoresCteFluxo = valores;
}

export function calcularCtePeloFluxoLotacao(cte = {}, contexto = null, mapaVinculos = null) {
  const viagem = localizarViagemFluxoLotacao(cte, contexto, mapaVinculos);
  if (!viagem) return null;
  if (!(toNumber(viagem.frete_transp) > 0)) return calcularCteValidadoPelaOperacao(cte, viagem);
  const raiz = raizDaChaveCte(cte);
  const numero = numeroDoCte(cte);
  const valorCte = toNumber(pick(cte, ['valor_cte', 'valorCte', 'valor_frete', 'frete']));
  const emissaoCte = dataEmissaoIsoCte(cte);
  // CT-es da viagem ja emitidos (os que ainda nao estao na base nao consumiram saldo).
  const ctesViagem = viagem.numerosCte
    .map((n) => (n === numero ? { numero: n, valor: valorCte, emissao: emissaoCte } : { numero: n, ...(contexto.valoresCteFluxo?.get(`${raiz}|${n}`) || {}) }))
    .filter((item) => item.valor !== undefined);
  const adicionais = toNumber(contexto.fluxo.adicionaisPorDist.get(normalizeText(viagem.dist)));
  const pedagio = toNumber(viagem.pedagio);
  let autorizado = toNumber(viagem.frete_transp) + adicionais;
  const cobradoViagem = ctesViagem.reduce((acc, item) => acc + toNumber(item.valor), 0);
  // O frete do fluxo vem sem pedágio; viagem que cobrou o pedágio junto não é cobrança a maior.
  const pedagioIncluido = pedagio > 0 && cobradoViagem > autorizado + 0.01 && cobradoViagem <= autorizado + pedagio + 0.5;
  if (pedagioIncluido) autorizado += pedagio;
  // Saldo: na ordem de emissao (empate pelo numero), cada CT-e anterior consome o que cobrou.
  const ordenados = ctesViagem.slice().sort((a, b) => String(a.emissao || '').localeCompare(String(b.emissao || '')) || Number(a.numero) - Number(b.numero));
  let saldo = autorizado;
  for (const item of ordenados) {
    if (item.numero === numero) break;
    saldo -= Math.min(toNumber(item.valor), Math.max(saldo, 0));
  }
  const saldoAntes = Math.max(Number(saldo.toFixed(2)), 0);
  const valorCalculado = Number(Math.min(valorCte, saldoAntes).toFixed(2));
  const excedente = Number((valorCte - valorCalculado).toFixed(2));
  if (!(valorCalculado > 0) && !(excedente > 0)) return null;
  const base = montarResultadoBase(cte, 'CALCULADO', '', {
    transportadora_tabela: viagem.transportadora,
    tipo_calculo: 'LOTACAO',
    detalhes_calculo: {
      modalidade: 'LOTACAO',
      motor: 'fluxo_lotacao',
      dist: viagem.dist,
      carga_id: viagem.id,
      origem_cidade: viagem.origem,
      destino_cidade: viagem.destino,
      tipo_veiculo: viagem.tipo_veiculo,
      frete_viagem: toNumber(viagem.frete_transp),
      adicionais_aprovados: adicionais,
      pedagio,
      pedagio_incluido: pedagioIncluido,
      valor_autorizado_viagem: autorizado,
      ctes_viagem: viagem.numerosCte,
      ctes_viagem_emitidos: ordenados.map((item) => ({ numero: item.numero, valor: item.valor, emissao: item.emissao || null })),
      valor_cobrado_viagem: Number(cobradoViagem.toFixed(2)),
      saldo_antes_deste_cte: saldoAntes,
      excedente_viagem: excedente,
      observacao_lotacao: excedente > 0
        ? `CT-e passa ${excedente.toFixed(2)} do saldo da viagem ${viagem.dist}: enviar o excedente para aprovacao.`
        : '',
    },
  });
  // Saldo zerado (viagem ja consumida por outros CT-es): calculado 0 ficaria "sem calculo";
  // o valor auditado e 0,01 para o CT-e aparecer como divergente (excedente integral).
  const valorFinal = valorCalculado > 0 ? valorCalculado : 0.01;
  const diferenca = base.valor_cte - valorFinal;
  return {
    ...base,
    valor_calculado: valorFinal,
    diferenca,
    diferenca_abs: Math.abs(diferenca),
    percentual_diferenca: (diferenca / valorFinal) * 100,
  };
}

// A Operação respondeu o questionamento escolhendo a DIST e justificando o valor, mas a viagem está sem
// frete no fluxo: a resposta é a aprovação — o CT-e vale o que cobrou (resposta registrada no detalhe).
function calcularCteValidadoPelaOperacao(cte = {}, viagem = {}) {
  if (!viagem.respostaOperacao) return null;
  const valorCte = toNumber(pick(cte, ['valor_cte', 'valorCte', 'valor_frete', 'frete']));
  if (!(valorCte > 0)) return null;
  const base = montarResultadoBase(cte, 'CALCULADO', '', {
    transportadora_tabela: viagem.transportadora,
    tipo_calculo: 'LOTACAO',
    detalhes_calculo: {
      modalidade: 'LOTACAO',
      motor: 'resposta_operacao_lotacao',
      dist: viagem.dist,
      carga_id: viagem.id,
      origem_cidade: viagem.origem,
      destino_cidade: viagem.destino,
      tipo_veiculo: viagem.tipo_veiculo,
      resposta_operacao: viagem.respostaOperacao,
      respondido_por: viagem.respondidoPor,
      observacao_lotacao: `Valor validado pela Operação na resposta do questionamento (viagem ${viagem.dist} sem frete no fluxo).`,
    },
  });
  return { ...base, valor_calculado: valorCte, diferenca: 0, diferenca_abs: 0, percentual_diferenca: 0 };
}

// Tabela de lotação primeiro; depois o fracionado. Se nenhum dos dois calculou
// (rota fora da tabela de lotação, transportadora sem tabela, origem/rota fora do
// fracionado), usa o valor combinado da viagem no fluxo de lotação.
function calcularLotacaoOuFracionado(cte, contexto, mapaVinculos, calcularFracionado) {
  const porTabela = calcularCtePelaTabelaLotacao(cte, contexto, mapaVinculos);
  if (porTabela && toNumber(porTabela.valor_calculado) > 0) return porTabela;
  const resultado = porTabela || calcularFracionado();
  if (toNumber(resultado?.valor_calculado) > 0) return resultado;
  const peloFluxo = calcularCtePeloFluxoLotacao(cte, contexto, mapaVinculos);
  if (peloFluxo) return peloFluxo;
  return cteDeLotacao(cte, contexto, mapaVinculos, porTabela) ? marcarSemDistLotacao(resultado) : resultado;
}

// CT-e de lotação (não fracionado): transportadora com tabela de lotação, que aparece no fluxo, ou canal
// de transferência/lotação. Sem DIST na tabela nem no fluxo, quem informa a viagem é a Operação.
function cteDeLotacao(cte, contexto, mapaVinculos, porTabela) {
  if (porTabela) return true;
  const canal = canalCategoria(pick(cte, ['canal', 'canal_original']));
  if (['INTERCOMPANY', 'LOTACAO', 'LOTAÇÃO'].includes(canal)) return true;
  const nomeBruto = pick(cte, ['transportadora', 'nome_transportadora', 'transportadora_realizada', 'transportador']);
  const nomes = [nomeBruto, aplicarVinculoTransportadora(nomeBruto, mapaVinculos)].filter(Boolean);
  return (contexto?.fluxo?.nomesTransportadoras || []).some((nome) => transportadoraDoFluxoCompativel(nome, nomes));
}

function marcarSemDistLotacao(resultado = {}) {
  return {
    ...resultado,
    status_calculo: 'SEM_DIST_LOTACAO',
    motivo_sem_calculo: 'Lotacao: DIST nao localizada na tabela nem no fluxo de lotacao (pedir a viagem para a Operacao).',
    detalhes_calculo: { ...(resultado.detalhes_calculo || {}), modalidade: 'LOTACAO', motivo_original: resultado.motivo_sem_calculo || '' },
  };
}

function localizarTabelaLotacaoContexto(cte = {}, contexto = null, mapaVinculos = null) {
  if (!contexto?.tabelas?.length) return null;
  const nomeBruto = pick(cte, ['transportadora', 'nome_transportadora', 'transportadora_realizada', 'transportador']);
  const nomeCanonico = aplicarVinculoTransportadora(nomeBruto, mapaVinculos) || nomeBruto;
  const nomeNorm = normalizeTransportadoraCompare(nomeCanonico);
  const tabela = contexto.tabelas.find((item) => nomeCompativel(item.nome, nomeCanonico));
  if (!tabela) return null;

  const totalOrigensFracionado = contexto.origensFracionadoPorNome.get(nomeNorm)
    ?? contexto.origensFracionadoPorNome.get(normalizeTransportadoraCompare(tabela.nome))
    ?? 0;
  const canal = canalCategoria(pick(cte, ['canal', 'canal_original']));
  const somenteLotacao = totalOrigensFracionado === 0;
  const canalLotacao = canal === 'INTERCOMPANY' || canal === 'LOTACAO' || canal === 'LOTAÇÃO';
  if (!somenteLotacao && !canalLotacao) return null;
  return { tabela, somenteLotacao, totalOrigensFracionado };
}

export function calcularCtePelaTabelaLotacao(cte = {}, contexto = null, mapaVinculos = null) {
  const localizada = localizarTabelaLotacaoContexto(cte, contexto, mapaVinculos);
  if (!localizada) return null;
  const { tabela, somenteLotacao } = localizada;
  const origem = normalizeCompare(pick(cte, ['cidade_origem', 'cidadeOrigem', 'origem']));
  const destino = normalizeCompare(pick(cte, ['cidade_destino', 'cidadeDestino', 'destino']));
  const ufOrigem = normalizeText(pick(cte, ['uf_origem', 'ufOrigem']));
  const ufDestino = normalizeText(pick(cte, ['uf_destino', 'ufDestino']));
  const candidatas = (tabela.rotas || []).filter((rota) => (
    normalizeCompare(rota.origem) === origem
    && normalizeCompare(rota.destino) === destino
    && (!ufOrigem || !rota.uf_origem || normalizeText(rota.uf_origem) === ufOrigem)
    && (!ufDestino || !rota.uf_destino || normalizeText(rota.uf_destino) === ufDestino)
  ));

  if (!candidatas.length) {
    return montarResultadoBase(cte, 'SEM_ROTA_LOTACAO', 'Rota não cadastrada na tabela de Lotação.', {
      transportadora_tabela: tabela.nome,
      tipo_calculo: 'LOTACAO',
      detalhes_calculo: { tabela_id_aplicada: tabela.id, modalidade: 'LOTACAO', somente_lotacao: somenteLotacao },
    });
  }

  const valores = candidatas.filter((rota) => toNumber(rota.valor) > 0);
  if (!valores.length) {
    return montarResultadoBase(cte, 'SEM_VALOR_LOTACAO', 'Rota encontrada, mas sem valor válido na tabela de Lotação.', {
      transportadora_tabela: tabela.nome,
      tipo_calculo: 'LOTACAO',
    });
  }
  const tiposValores = new Set(valores.map((rota) => `${normalizeText(rota.tipo_veiculo)}|${toNumber(rota.valor).toFixed(2)}`));
  if (tiposValores.size > 1) {
    return montarResultadoBase(cte, 'SELECIONAR_VEICULO_LOTACAO', 'A rota possui mais de um tipo de veículo na tabela de Lotação; selecione a DIST/viagem para definir o valor.', {
      transportadora_tabela: tabela.nome,
      tipo_calculo: 'LOTACAO',
    });
  }

  const rota = valores[0];
  const base = montarResultadoBase(cte, 'CALCULADO', '', {
    transportadora_tabela: tabela.nome,
    tipo_calculo: 'LOTACAO',
    detalhes_calculo: {
      tabela_id_aplicada: tabela.id,
      tabela_nome_aplicada: tabela.nome,
      modalidade: 'LOTACAO',
      somente_lotacao: somenteLotacao,
      origem_cidade: rota.origem,
      destino_cidade: rota.destino,
      tipo_veiculo: rota.tipo_veiculo,
      pedagio: rota.pedagio,
      prazo: rota.prazo,
      motor: 'tabela_lotacao',
    },
  });
  const valorCalculado = toNumber(rota.valor);
  const diferenca = base.valor_cte - valorCalculado;
  return {
    ...base,
    valor_calculado: valorCalculado,
    diferenca,
    diferenca_abs: Math.abs(diferenca),
    percentual_diferenca: valorCalculado > 0 ? (diferenca / valorCalculado) * 100 : 0,
  };
}

function cteParaLinhaSimulador(cte = {}, transportadoraSimulada = '', canalOverride = '') {
  const cubagemTotal = toNumber(pick(cte, ['cubagem', 'cubagem_total', 'cubagemTotal']));
  return {
    id: pick(cte, ['id']) || pick(cte, ['chave_cte', 'chaveCte', 'chave']) || pick(cte, ['numero_cte', 'numeroCte', 'cte', 'nro_cte']),
    chaveCte: pick(cte, ['chave_cte', 'chaveCte', 'chave']) || '',
    numeroCte: pick(cte, ['numero_cte', 'numeroCte', 'cte', 'nro_cte']) || '',
    emissao: pick(cte, ['data_emissao', 'emissao', 'dataEmissao']) || '',
    transportadora: transportadoraSimulada || nomeTransportadoraCte(cte),
    cidadeOrigem: pick(cte, ['cidade_origem', 'cidadeOrigem', 'origem']) || '',
    ufOrigem: String(pick(cte, ['uf_origem', 'ufOrigem']) || '').toUpperCase(),
    cidadeDestino: pick(cte, ['cidade_destino', 'cidadeDestino', 'destino']) || '',
    ufDestino: String(pick(cte, ['uf_destino', 'ufDestino']) || '').toUpperCase(),
    ibgeDestino: pickDigits(cte, ['ibge_destino', 'ibgeDestino', 'codigo_ibge_destino', 'ibge_corrigido_destino']),
    peso: toNumber(pick(cte, ['peso', 'peso_final', 'pesoFinal'])),
    pesoDeclarado: toNumber(pick(cte, ['peso_declarado', 'pesoDeclarado', 'peso'])),
    pesoCubado: toNumber(pick(cte, ['peso_cubado', 'pesoCubado'])),
    cubagem: cubagemTotal,
    cubagemTotal,
    trackingMatch: cubagemTotal > 0 || Boolean(cte.trackingMatch),
    valorNF: toNumber(pick(cte, ['valor_nf', 'valorNF', 'nf_venda', 'valor_nota'])),
    valorCte: toNumber(pick(cte, ['valor_cte', 'valorCte', 'valor_frete', 'frete'])),
    canal: canalOverride || pick(cte, ['canal', 'canal_original']) || '',
    documentoDestinatario: pickDigits(cte, ['documento_destinatario', 'documentoDestinatario', 'cnpj_destinatario'], 14),
  };
}

// ─── Tabelas alternativas (mesma transportadora, tabela_alternativa_de) ────
// Uma transportadora+origem pode ter mais de uma tabela vigente: a
// "principal" (uso geral) e uma ou mais "alternativas" (ex.: OTR/fora de
// estrada, rodas). Cada tabela vira uma entrada separada no array
// `transportadoras` (uma por negociação — ver converterTabelaNegociacaoParaSimulador),
// então aqui só precisamos agrupá-las pela mesma transportadora e, dentro do
// grupo, escolher a que mais se aproxima do valor pago no CT-e.

// Pura e testável: dado um conjunto de candidatos já calculados
// ({ valorCalculado, ... }) e o valor pago no CT-e, devolve o candidato com
// menor divergência absoluta (ou null se nenhum candidato for calculável).
export function escolherMelhorTabela(candidatos = [], valorReferencia = 0) {
  const validos = (candidatos || []).filter((c) => c && Number.isFinite(Number(c.valorCalculado)) && Number(c.valorCalculado) > 0);
  if (!validos.length) return null;
  const valorRef = toNumber(valorReferencia);
  return validos
    .map((c) => ({ ...c, divergencia: Math.abs(valorRef - toNumber(c.valorCalculado)) }))
    .sort((a, b) => a.divergencia - b.divergencia)[0];
}

// Agrupa SOMENTE tabelas explicitamente vinculadas como principal/alternativa.
// Ter o mesmo nome de transportadora não cria vínculo: cadastros independentes
// não podem participar do mesmo cálculo nem do seletor de alternativas.
function agruparTabelasAlternativasPorTransportadora(transportadoras = [], transportadoraNome = '') {
  const doGrupo = (transportadoras || []).filter((t) => nomeCompativel(t.nome, transportadoraNome) || t.nome === transportadoraNome);
  if (doGrupo.length <= 1) return [];

  const porNegociacaoId = new Map();
  doGrupo.forEach((t) => { if (t.negociacaoId) porNegociacaoId.set(String(t.negociacaoId), t); });

  const grupos = new Map();
  doGrupo.forEach((t) => {
    let raizId = String(t.negociacaoId || t.id);
    if (t.tabelaAlternativaDe && porNegociacaoId.has(String(t.tabelaAlternativaDe))) {
      raizId = String(t.tabelaAlternativaDe);
    }
    if (!grupos.has(raizId)) grupos.set(raizId, []);
    grupos.get(raizId).push(t);
  });

  return Array.from(grupos.values()).filter((lista) => lista.length > 1);
}

// Roda o motor simulador isolando UMA única tabela (transportadora-entrada),
// pra medir o valor que ela daria pro mesmo CT-e — usado pra comparar tabela
// principal x alternativas.
function calcularValorParaTabelaEspecifica(cte, tabelaEntry, canaisTentativa, cidadePorIbge, opcoes, usarRotaInvertida = false) {
  // Uma alternativa sem a rota direta não pode virar candidata usando a rota
  // contrária. A inversão só é válida quando o cálculo principal já confirmou
  // que este CT-e está sendo tratado pelo fluxo de devolução.
  const tentativasCte = [usarRotaInvertida ? inverterOrigemDestinoCte(cte) : cte];
  for (let tentativaIndex = 0; tentativaIndex < tentativasCte.length; tentativaIndex += 1) {
    const cteTentativa = tentativasCte[tentativaIndex];
    for (const canal of canaisTentativa) {
      const linha = cteParaLinhaSimulador(cteTentativa, tabelaEntry.nome, canal);
      const resultado = simularRealizadoPorTransportadora({
        transportadoras: [tabelaEntry],
        realizados: [linha],
        nomeTransportadora: tabelaEntry.nome,
        filtros: {
          canal: linha.canal,
          ignorarCubagem: opcoes.ignorarCubagem,
          percentualContingenciaPeso: opcoes.percentualContingenciaPeso,
        },
        cidadePorIbge,
      });
      const detalhe = resultado?.detalhes?.[0] || null;
      if (detalhe) return detalhe;
    }
  }
  return null;
}

// ─── Transferência entre unidades (ex.: CPX → CPX) ────────────────────────
// CT-e em que remetente e destinatário são a MESMA empresa (mesma raiz de CNPJ)
// é transferência e tem negociação própria (ex.: % sobre a NF). A transportadora
// cadastra uma tabela alternativa cujo rótulo contém "TRANSFERENCIA"; o CT-e de
// transferência é calculado SÓ por ela (não procura rota na tabela principal) e
// os demais CT-es nunca a usam como candidata.
function ctePareceTransferencia(cte = {}) {
  const remetente = obterRaizCnpj(pickDigits(cte, ['documento_remetente', 'documentoRemetente', 'cnpj_remetente'], 14));
  const destinatario = obterRaizCnpj(pickDigits(cte, ['documento_destinatario', 'documentoDestinatario', 'cnpj_destinatario'], 14));
  return Boolean(remetente) && remetente.length === 8 && remetente === destinatario;
}

function ehTabelaTransferencia(entrada = {}) {
  if (!entrada?.tabelaAlternativaDe) return false;
  // normalizeCompare devolve minúsculo: comparar com 'transferencia'.
  return normalizeCompare(entrada.varianteTabela || '').includes('transferencia');
}

// Calcula o comparativo entre a tabela vencedora (que já gerou `detalheVencedor`)
// e suas tabelas alternativas (se houver), pra Auditoria sugerir a mais próxima
// do valor pago no CT-e sem perder a possibilidade de escolha manual na UI.
function montarComparativoTabelas(cte, transportadoras, transportadoraTabela, detalheVencedor, canaisTentativa, cidadePorIbge, opcoes, usarRotaInvertida = false) {
  const grupos = agruparTabelasAlternativasPorTransportadora(transportadoras, transportadoraTabela);
  if (!grupos.length) return null;

  // Pode haver mais de uma família vinculada para o mesmo nome. Compara apenas
  // a família da tabela que realmente venceu o cálculo principal.
  const tabelaVencedoraId = String(
    detalheVencedor?.tabelaId
      || detalheVencedor?.detalhes?.tabelaId
      || detalheVencedor?.detalhes?.frete?.tabelaId
      || '',
  );
  const grupoAlvo = grupos.find((grupo) => grupo.some((entrada) => (
    String(entrada.negociacaoId || entrada.id || '') === tabelaVencedoraId
  ))) || (grupos.length === 1 ? grupos[0] : null);
  if (!grupoAlvo || grupoAlvo.length <= 1) return null;

  // Reajuste com vigência: pela data de emissão decide quais tabelas concorrem
  // (a tabela em vigor substitui a principal).
  const grupoSemTransferencia = grupoAlvo.filter((entrada) => !ehTabelaTransferencia(entrada));
  if (grupoSemTransferencia.length <= 1 && grupoSemTransferencia.length !== grupoAlvo.length) return null;
  const { entradas: entradasGrupo, porVigencia } = aplicarVigenciaNoGrupo(grupoSemTransferencia, dataEmissaoIsoCte(cte));
  const valorCtePago = toNumber(pick(cte, ['valor_cte', 'valorCte', 'valor_frete', 'frete']));
  const candidatos = entradasGrupo.map((entrada) => {
    const detalhe = calcularValorParaTabelaEspecifica(cte, entrada, canaisTentativa, cidadePorIbge, opcoes, usarRotaInvertida);
    if (!detalhe) return null;
    const valorCalculado = toNumber(detalhe.valorSimulado);
    return {
      tabelaId: entrada.negociacaoId || entrada.id,
      variante: entrada.varianteTabela
        || entrada.tabelaNome
        || entrada.nomeTabela
        || entrada.descricaoTabela
        || (entrada.tabelaAlternativaDe ? 'Alternativa' : 'Principal'),
      principal: !entrada.tabelaAlternativaDe,
      vigenciaInicio: entrada.vigenciaInicio || '',
      vigenciaFim: entrada.vigenciaFim || '',
      transportadoraNome: entrada.nome,
      valorCalculado,
      divergencia: Math.abs(valorCtePago - valorCalculado),
      detalhe,
    };
  }).filter(Boolean);

  // Reajuste em vigor mas sem cálculo possível nele (ex.: rota ausente na tabela
  // nova): não escolhe outra "por proximidade"; o chamador mantém o cálculo pela
  // principal e sinaliza o aviso.
  const vigenteCalculou = candidatos.some((c) => c.vigenciaInicio || c.vigenciaFim);
  if (porVigencia && !vigenteCalculou) {
    return { candidatos: [], melhor: null, porVigencia: true, semCalculoVigente: true };
  }
  if (!candidatos.length) return null;
  if (candidatos.length <= 1 && !porVigencia) return null;

  const melhor = escolherMelhorTabela(candidatos, valorCtePago);
  return { candidatos, melhor, porVigencia };
}

// processarCteComMotorSimulador roda uma vez por CT-e do lote. transportadorasPrincipais
// e buildLookupTables (que varre TODA a malha de rotas de TODAS as transportadoras
// carregadas) não dependem do CT-e em si, só do array `transportadoras` — então ficam
// em cache por referência do array pra não repetir a varredura completa a cada CT-e
// (numa fatura com 91 CT-es isso rodava a malha inteira 91 vezes à toa).
const _cacheLookupPorTransportadoras = new WeakMap();
function obterLookupCacheado(transportadoras) {
  let cache = _cacheLookupPorTransportadoras.get(transportadoras);
  if (!cache) {
    const transportadorasPrincipais = (transportadoras || []).filter((t) => !t?.tabelaAlternativaDe);
    const { cidadePorIbge } = buildLookupTables(transportadorasPrincipais);
    cache = { transportadorasPrincipais, cidadePorIbge };
    _cacheLookupPorTransportadoras.set(transportadoras, cache);
  }
  return cache;
}

function processarCteComMotorSimulador(cte, transportadoras = [], mapaVinculos = null, transportadoraAlvo = '', opcoes = {}) {
  const transportadoraTabela = transportadoraAlvo || nomeTransportadoraCte(cte, mapaVinculos);
  if (!transportadoraTabela) return null;

  // O cálculo principal só deve considerar as entradas "de verdade" — as
  // sintéticas de tabela alternativa (expandirTabelasAlternativasOficiais)
  // têm o MESMO nome de transportadora e, se entrassem aqui, criariam
  // ambiguidade na busca por origem/rota (duas cenários pra transportadora
  // "alvo" na mesma origem). As alternativas só são usadas mais abaixo, em
  // montarComparativoTabelas, isoladas uma a uma.
  const { transportadorasPrincipais, cidadePorIbge } = obterLookupCacheado(transportadoras);
  const canalOriginal = normalizarCanalResultado(pick(cte, ['canal', 'canal_original']));
  const canaisTentativa = canalOriginal === 'A DEFINIR'
    ? ['ATACADO', 'B2C', '']
    : [pick(cte, ['canal', 'canal_original']) || '', ''];

  let detalhe = null;
  let calculoInvertido = false;
  let transferenciaAplicada = false;

  if (ctePareceTransferencia(cte)) {
    const tabelasTransferencia = (transportadoras || []).filter((t) => (
      ehTabelaTransferencia(t) && (t.nome === transportadoraTabela || nomeCompativel(t.nome, transportadoraTabela))
    ));
    if (tabelasTransferencia.length) {
      for (const entrada of tabelasTransferencia) {
        detalhe = calcularValorParaTabelaEspecifica(cte, entrada, canaisTentativa, cidadePorIbge, opcoes, false);
        if (detalhe) break;
      }
      if (!detalhe) {
        return montarResultadoBase(cte, 'SEM_ROTA', 'CT-e de transferência (remetente e destinatário do mesmo grupo): rota não encontrada na tabela alternativa de transferência.', {
          transportadora_tabela: transportadoraTabela,
        });
      }
      transferenciaAplicada = true;
    }
  }

  const tentativasCte = [cte, inverterOrigemDestinoCte(cte)];
  for (let tentativaIndex = 0; tentativaIndex < tentativasCte.length && !detalhe; tentativaIndex += 1) {
    const cteTentativa = tentativasCte[tentativaIndex];
    for (const canal of canaisTentativa) {
      const linha = cteParaLinhaSimulador(cteTentativa, transportadoraTabela, canal);
      const resultado = simularRealizadoPorTransportadora({
        transportadoras: transportadorasPrincipais,
        realizados: [linha],
        nomeTransportadora: transportadoraTabela,
        filtros: {
          canal: linha.canal,
          ignorarCubagem: opcoes.ignorarCubagem,
          percentualContingenciaPeso: opcoes.percentualContingenciaPeso,
        },
        cidadePorIbge,
      });
      detalhe = resultado?.detalhes?.[0] || null;
      if (detalhe) {
        calculoInvertido = tentativaIndex === 1;
        break;
      }
    }
  }

  if (!detalhe) return null;

  const base = montarResultadoBase(cte, 'CALCULADO', '', {
    transportadora_tabela: detalhe.transportadoraSimulada || transportadoraTabela,
    tipo_calculo: detalhe.detalhes?.frete?.tipoCalculo || null,
    detalhes_calculo: {
      tabela_id_aplicada: detalhe.tabelaId || null,
      tabela_nome_aplicada: detalhe.tabelaNome || 'Principal',
      tabela_principal_aplicada: detalhe.tabelaPrincipal !== false,
      origem_cidade: detalhe.origem || null,
      rota_nome: detalhe.detalhes?.frete?.rotaNome || detalhe.detalhes?.rotaNome || null,
      rota_prazo: detalhe.detalhes?.prazo ?? null,
      peso_considerado: detalhe.detalhes?.frete?.pesoConsiderado ?? detalhe.peso,
      valor_base: detalhe.detalhes?.frete?.valorBase,
      subtotal: detalhe.detalhes?.frete?.subtotal,
      icms: detalhe.detalhes?.frete?.icms,
      aliquota_icms: detalhe.detalhes?.frete?.aliquotaIcms,
      origem_aliquota_icms: detalhe.detalhes?.frete?.origemAliquotaIcms,
      uf_origem_icms: detalhe.detalhes?.frete?.ufOrigem,
      uf_destino_icms: detalhe.detalhes?.frete?.ufDestino,
      taxas: detalhe.detalhes?.taxas,
      componentes_base: detalhe.detalhes?.frete,
      componente_base: detalhe.detalhes?.frete?.componenteBase,
      origem_validada: Boolean(detalhe.origemValidada),
      motor: 'simulador_realizado',
      calculo_devolucao_invertida: calculoInvertido,
      observacao_devolucao: calculoInvertido ? 'CT-e de devolucao calculado pela rota de ida equivalente.' : '',
    },
  });

  const valorCalculado = toNumber(detalhe.valorSimulado);
  const diferenca = base.valor_cte - valorCalculado;
  const diferencaAbs = Math.abs(diferenca);
  const percentualDiferenca = valorCalculado > 0 ? (diferenca / valorCalculado) * 100 : 0;

  const resultado = {
    ...base,
    valor_calculado: valorCalculado,
    diferenca,
    diferenca_abs: diferencaAbs,
    percentual_diferenca: percentualDiferenca,
    motivo_sem_calculo: '',
  };

  // Tabela principal + alternativa(s) vigentes pra mesma transportadora: calcula
  // com todas e sugere (sem forçar) a mais próxima do valor pago no CT-e. Só
  // roda quando existe de fato mais de uma tabela pra transportadora — CT-e sem
  // alternativas cadastradas sai byte-a-byte igual a antes desta mudança.
  if (transferenciaAplicada) {
    return {
      ...resultado,
      detalhes_calculo: {
        ...resultado.detalhes_calculo,
        transferencia_entre_unidades: true,
        observacao_transferencia: 'CT-e de transferência (remetente e destinatário do mesmo grupo) calculado pela tabela alternativa de transferência.',
      },
    };
  }
  const comparativoTabelas = montarComparativoTabelas(cte, transportadoras, transportadoraTabela, detalhe, canaisTentativa, cidadePorIbge, opcoes, calculoInvertido);
  if (!comparativoTabelas) return resultado;

  if (comparativoTabelas.semCalculoVigente) {
    return {
      ...resultado,
      detalhes_calculo: {
        ...resultado.detalhes_calculo,
        aviso_vigencia: 'Há tabela de reajuste em vigor na data do CT-e, mas ela não calculou este CT-e (rota/cotação ausente); calculado pela tabela principal.',
      },
    };
  }

  const { candidatos, melhor, porVigencia } = comparativoTabelas;
  const candidatosResumo = candidatos.map((c) => ({
    tabela_id: c.tabelaId,
    variante: c.variante,
    principal: c.principal,
    vigencia_inicio: c.vigenciaInicio || null,
    vigencia_fim: c.vigenciaFim || null,
    transportadora_tabela: c.detalhe?.transportadoraSimulada || c.transportadoraNome,
    tabela_nome: c.detalhe?.tabelaNome || c.variante,
    tipo_calculo: c.detalhe?.detalhes?.frete?.tipoCalculo || null,
    valor_calculado: c.valorCalculado,
    divergencia: c.divergencia,
    origem_cidade: c.detalhe?.origem || null,
    rota_nome: c.detalhe?.detalhes?.frete?.rotaNome || c.detalhe?.detalhes?.rotaNome || null,
    peso_considerado: c.detalhe?.detalhes?.frete?.pesoConsiderado ?? c.detalhe?.peso,
    valor_base: c.detalhe?.detalhes?.frete?.valorBase,
    subtotal: c.detalhe?.detalhes?.frete?.subtotal,
    icms: c.detalhe?.detalhes?.frete?.icms,
    aliquota_icms: c.detalhe?.detalhes?.frete?.aliquotaIcms,
    origem_aliquota_icms: c.detalhe?.detalhes?.frete?.origemAliquotaIcms,
    uf_origem_icms: c.detalhe?.detalhes?.frete?.ufOrigem,
    uf_destino_icms: c.detalhe?.detalhes?.frete?.ufDestino,
    taxas: c.detalhe?.detalhes?.taxas,
    componentes_base: c.detalhe?.detalhes?.frete,
    componente_base: c.detalhe?.detalhes?.frete?.componenteBase,
  }));

  const diferencaAtual = diferencaAbs;
  // Com reajuste em vigor a escolha é pela data, não pela proximidade do valor
  // cobrado: usa a tabela vigente mesmo que a principal "fechasse" melhor.
  const usarMelhor = melhor && melhor.detalhe
    && (porVigencia || melhor.divergencia + 0.0001 < diferencaAtual);
  if (!usarMelhor) {
    return {
      ...resultado,
      detalhes_calculo: {
        ...resultado.detalhes_calculo,
        comparativo_tabelas: candidatosResumo,
        melhor_comparativo_tabela: melhor?.variante || '',
        tabela_alternativa_aplicada: '',
      },
    };
  }

  const detalheMelhor = melhor.detalhe;
  const valorCalculadoMelhor = toNumber(detalheMelhor.valorSimulado);
  const diferencaMelhor = base.valor_cte - valorCalculadoMelhor;

  return {
    ...resultado,
    transportadora_tabela: detalheMelhor.transportadoraSimulada || transportadoraTabela,
    tipo_calculo: detalheMelhor.detalhes?.frete?.tipoCalculo || resultado.tipo_calculo,
    valor_calculado: valorCalculadoMelhor,
    diferenca: diferencaMelhor,
    diferenca_abs: Math.abs(diferencaMelhor),
    percentual_diferenca: valorCalculadoMelhor > 0 ? (diferencaMelhor / valorCalculadoMelhor) * 100 : 0,
    detalhes_calculo: {
      ...resultado.detalhes_calculo,
      origem_cidade: detalheMelhor.origem || resultado.detalhes_calculo.origem_cidade,
      rota_nome: detalheMelhor.detalhes?.frete?.rotaNome || detalheMelhor.detalhes?.rotaNome || resultado.detalhes_calculo.rota_nome,
      peso_considerado: detalheMelhor.detalhes?.frete?.pesoConsiderado ?? detalheMelhor.peso ?? resultado.detalhes_calculo.peso_considerado,
      valor_base: detalheMelhor.detalhes?.frete?.valorBase,
      subtotal: detalheMelhor.detalhes?.frete?.subtotal,
      icms: detalheMelhor.detalhes?.frete?.icms,
      aliquota_icms: detalheMelhor.detalhes?.frete?.aliquotaIcms,
      taxas: detalheMelhor.detalhes?.taxas,
      componentes_base: detalheMelhor.detalhes?.frete,
      componente_base: detalheMelhor.detalhes?.frete?.componenteBase,
      tabela_id_aplicada: melhor.tabelaId || detalheMelhor.tabelaId || null,
      tabela_nome_aplicada: melhor.variante || detalheMelhor.tabelaNome || 'Principal',
      tabela_principal_aplicada: melhor.principal,
      comparativo_tabelas: candidatosResumo,
      melhor_comparativo_tabela: melhor.variante || '',
      tabela_alternativa_aplicada: melhor.variante || '',
      tabela_por_vigencia: Boolean(porVigencia),
      vigencia_inicio_aplicada: melhor.vigenciaInicio || null,
    },
  };
}

function resumirAlternativaPeso(nome, resultado, valorPago, fallbackCubagem = 0) {
  if (!resultado || resultado.status_calculo !== 'CALCULADO') return null;
  const det = resultado.detalhes_calculo || {};
  const frete = det.componentes_base || {};
  const valor = toNumber(resultado.valor_calculado);
  const diferenca = toNumber(valorPago) - valor;
  const cubagemAplicada = toNumber(frete.cubagemAplicada) || toNumber(fallbackCubagem);
  const fatorCubagem = toNumber(frete.fatorCubagem);
  const pesoCubadoPeloFator = cubagemAplicada > 0 && fatorCubagem > 0 ? cubagemAplicada * fatorCubagem : 0;
  const pesoCubadoMotor = toNumber(frete.pesoCubado);
  const pesoCubadoCalculado = pesoCubadoPeloFator > 0 ? pesoCubadoPeloFator : pesoCubadoMotor;
  return {
    nome,
    valor_calculado: valor,
    diferenca,
    diferenca_abs: Math.abs(diferenca),
    peso_considerado: toNumber(det.peso_considerado),
    valor_base: toNumber(det.valor_base),
    subtotal: toNumber(det.subtotal),
    icms: toNumber(det.icms),
    aliquota_icms: toNumber(det.aliquota_icms),
    origem_aliquota_icms: det.origem_aliquota_icms || '',
    uf_origem_icms: det.uf_origem_icms || '',
    uf_destino_icms: det.uf_destino_icms || '',
    taxas: det.taxas || {},
    componentes_base: frete,
    componente_base: det.componente_base || det.componentes_base?.componenteBase || '',
    cubagem_aplicada: cubagemAplicada,
    fator_cubagem: fatorCubagem,
    peso_cubado_calculado: pesoCubadoCalculado,
    origem_cidade: det.origem_cidade || '',
    rota_nome: det.rota_nome || '',
  };
}

function anexarComparativoPesos(resultado, cte, transportadoras, mapaVinculos, transportadoraAlvo, opcoes) {
  if (!resultado || resultado.status_calculo !== 'CALCULADO') return resultado;

  const pesoDeclarado = toNumber(pick(cte, ['peso_declarado', 'pesoDeclarado', 'peso']));
  const pesoCubadoOriginal = toNumber(pick(cte, ['peso_cubado', 'pesoCubado']));
  const cubagem = toNumber(pick(cte, ['cubagem', 'cubagem_total', 'cubagemTotal']));
  if (pesoDeclarado <= 0 && pesoCubadoOriginal <= 0 && cubagem <= 0) return resultado;

  const valorPago = toNumber(resultado.valor_cte);
  const alternativas = [];
  const declarado = processarCteComMotorSimulador(cte, transportadoras, mapaVinculos, transportadoraAlvo, {
    ...opcoes,
    ignorarCubagem: true,
    percentualContingenciaPeso: 0,
  });
  const altDeclarado = resumirAlternativaPeso('Peso declarado CT-e', declarado, valorPago);
  if (altDeclarado) alternativas.push(altDeclarado);

  let altCubado = null;
  if (cubagem > 0 || (pesoCubadoOriginal > 0 && Math.abs(pesoCubadoOriginal - pesoDeclarado) > 0.001)) {
    const cubado = processarCteComMotorSimulador(cte, transportadoras, mapaVinculos, transportadoraAlvo, {
      ...opcoes,
      ignorarCubagem: false,
      percentualContingenciaPeso: 0,
    });
    altCubado = resumirAlternativaPeso('Cubagem Tracking x fator tabela', cubado, valorPago, cubagem);
    if (altCubado?.peso_cubado_calculado > 0) {
      const pesoCubadoCalculado = altCubado.peso_cubado_calculado;
      // Peso taxavel = maior entre fisico e cubado. Cubado menor que o peso do
      // CT-e (ex.: cubagem unitaria gravada no lugar do total) nunca pode
      // rebaixar o peso cobrado.
      const pesoTaxavel = Math.max(pesoCubadoCalculado, pesoDeclarado);
      const cteComPesoCubado = {
        ...cte,
        peso: pesoTaxavel,
        peso_declarado: pesoTaxavel,
        pesoDeclarado: pesoTaxavel,
        peso_cubado: 0,
        pesoCubado: 0,
        cubagem: 0,
        cubagemTotal: 0,
        trackingMatch: false,
      };
      const recalculoPesoCubado = processarCteComMotorSimulador(cteComPesoCubado, transportadoras, mapaVinculos, transportadoraAlvo, {
        ...opcoes,
        ignorarCubagem: true,
        percentualContingenciaPeso: 0,
      });
      const altSubstituida = resumirAlternativaPeso('Aplicar peso cubado calculado', recalculoPesoCubado, valorPago);
      if (altSubstituida) {
        altCubado = {
          ...altSubstituida,
          cubagem_aplicada: altCubado.cubagem_aplicada,
          fator_cubagem: altCubado.fator_cubagem,
          peso_cubado_calculado: pesoCubadoCalculado,
        };
      }
    }
    if (altCubado) alternativas.push(altCubado);
  }

  if (alternativas.length < 2) return resultado;
  const melhor = alternativas.slice().sort((a, b) => a.diferenca_abs - b.diferenca_abs)[0];
  const diferencaAtual = Math.abs(toNumber(valorPago) - toNumber(resultado.valor_calculado));
  // Com o modo de peso escolhido na fatura (Tracking), nao troca sozinho pela
  // alternativa mais proxima do valor pago: respeita a escolha do usuario.
  const usarMelhor = !opcoes.pesoForcado && melhor && melhor.diferenca_abs + 0.0001 < diferencaAtual;
  const resultadoBase = usarMelhor
    ? {
      ...resultado,
      peso: melhor.peso_considerado || resultado.peso,
      valor_calculado: melhor.valor_calculado,
      diferenca: melhor.diferenca,
      diferenca_abs: melhor.diferenca_abs,
      percentual_diferenca: melhor.valor_calculado > 0 ? (melhor.diferenca / melhor.valor_calculado) * 100 : 0,
      detalhes_calculo: {
        ...(resultado.detalhes_calculo || {}),
        peso_considerado: melhor.peso_considerado,
        valor_base: melhor.valor_base,
        subtotal: melhor.subtotal,
        icms: melhor.icms,
        aliquota_icms: melhor.aliquota_icms,
        origem_aliquota_icms: melhor.origem_aliquota_icms,
        uf_origem_icms: melhor.uf_origem_icms,
        uf_destino_icms: melhor.uf_destino_icms,
        taxas: melhor.taxas,
        componentes_base: melhor.componentes_base,
        componente_base: melhor.componente_base || resultado.detalhes_calculo?.componente_base,
        ajuste_peso_aplicado: melhor.nome,
      },
    }
    : resultado;

  return {
    ...resultadoBase,
    detalhes_calculo: {
      ...(resultadoBase.detalhes_calculo || {}),
      comparativo_pesos: alternativas,
      melhor_comparativo_peso: melhor?.nome || '',
      peso_alternativo_aplicado: usarMelhor ? melhor?.nome || '' : '',
      peso_declarado_cte: pesoDeclarado,
      peso_cubado_tracking: altCubado?.peso_cubado_calculado || pesoCubadoOriginal,
      peso_cubado_original_tracking: pesoCubadoOriginal,
      cubagem_tracking: cubagem,
    },
  };
}

// ─── Canal cobrado divergente (ex.: WM Itajaí) ───────────────────────────
// Algumas transportadoras faturam CT-e de um canal pela tabela do OUTRO canal
// (ex.: pedido leve de ATACADO cobrado pela faixa de peso do B2C). Uma tabela
// alternativa não serve aqui: o comparativo de alternativas escolhe a mais
// próxima do valor pago e aprovaria a cobrança a maior. Então o CT-e continua
// auditado pela tabela do canal DELE (valor_calculado/diferença não mudam e a
// regra de sinalizar a maior/a menor segue valendo); quando não bate, recalcula
// pelo outro canal e, se o valor pago fecha com ele, só anota pro auditor qual
// tabela foi cobrada e se ficou a maior ou a menor que a correta.
const TOLERANCIA_CANAL_COBRADO = 0.1;

function anexarCanalCobradoDivergente(resultado, cte, transportadoras, mapaVinculos, transportadoraAlvo, opcoes = {}) {
  if (!resultado || resultado.status_calculo !== 'CALCULADO' || opcoes.semCanalCruzado) return resultado;
  const valorPago = toNumber(resultado.valor_cte);
  const valorCorreto = toNumber(resultado.valor_calculado);
  if (!(valorPago > 0) || !(valorCorreto > 0)) return resultado;
  if (Math.abs(valorPago - valorCorreto) <= TOLERANCIA_CANAL_COBRADO) return resultado;

  const canalCte = normalizarCanalResultado(pick(cte, ['canal', 'canal_original']));
  const outroCanal = canalCte === 'ATACADO' ? 'B2C' : canalCte === 'B2C' ? 'ATACADO' : '';
  if (!outroCanal) return resultado;

  const outro = processarCte({ ...cte, canal: outroCanal, canal_original: outroCanal }, transportadoras, mapaVinculos, transportadoraAlvo, {
    ...opcoes,
    semCanalCruzado: true,
  });
  if (outro?.status_calculo !== 'CALCULADO') return resultado;
  const valorOutro = toNumber(outro.valor_calculado);
  // Mesmo valor = mesma tabela (origem AMBOS): não há canal trocado a apontar.
  if (!(valorOutro > 0) || Math.abs(valorOutro - valorCorreto) <= TOLERANCIA_CANAL_COBRADO) return resultado;
  if (Math.abs(valorPago - valorOutro) > TOLERANCIA_CANAL_COBRADO) return resultado;

  const aMaior = valorPago > valorCorreto;
  const detOutro = outro.detalhes_calculo || {};
  return {
    ...resultado,
    detalhes_calculo: {
      ...(resultado.detalhes_calculo || {}),
      canal_cobrado_divergente: {
        canal_cte: canalCte,
        canal_tabela_cobrada: outroCanal,
        valor_tabela_canal_cobrado: valorOutro,
        valor_tabela_canal_correto: valorCorreto,
        diferenca: Number((valorPago - valorCorreto).toFixed(2)),
        situacao: aMaior ? 'COBRADO_A_MAIOR' : 'COBRADO_A_MENOR',
        origem_cidade: detOutro.origem_cidade || null,
        rota_nome: detOutro.rota_nome || null,
        observacao: `Canal incorreto: CT-e ${canalCte} cobrado pela tabela ${outroCanal} (R$ ${valorOutro.toFixed(2)}). `
          + `Tabela ${canalCte} = R$ ${valorCorreto.toFixed(2)} — cobrado a ${aMaior ? 'maior' : 'menor'}.`,
      },
    },
  };
}

export function processarCte(cte, transportadoras = [], mapaVinculos = null, transportadoraAlvo = '', opcoes = {}) {
  const resultadoSimulador = processarCteComMotorSimulador(cte, transportadoras, mapaVinculos, transportadoraAlvo, opcoes);
  if (resultadoSimulador && opcoes?.semComparativoPesos) return anexarCanalCobradoDivergente(resultadoSimulador, cte, transportadoras, mapaVinculos, transportadoraAlvo, opcoes);
  if (resultadoSimulador) {
    const comPesos = anexarComparativoPesos(resultadoSimulador, cte, transportadoras, mapaVinculos, transportadoraAlvo, opcoes);
    return anexarCanalCobradoDivergente(comPesos, cte, transportadoras, mapaVinculos, transportadoraAlvo, opcoes);
  }

  // Contingência (ex.: CT-e sem peso): a tabela TRANSFERENCIA só vale pra CT-e
  // de transferência — sem este filtro ela entrava como candidata comum.
  const transportadorasContingencia = ctePareceTransferencia(cte)
    ? transportadoras
    : (transportadoras || []).filter((entrada) => !ehTabelaTransferencia(entrada));
  const tabelaDireta = localizarTabelaAuditoria(transportadorasContingencia, cte, mapaVinculos, transportadoraAlvo, opcoes);
  const tabelaInvertida = tabelaDireta.status === 'OK'
    ? null
    : localizarTabelaAuditoria(transportadorasContingencia, inverterOrigemDestinoCte(cte), mapaVinculos, transportadoraAlvo, opcoes);
  const calculoInvertido = tabelaDireta.status !== 'OK' && tabelaInvertida?.status === 'OK';
  const cteCalculo = calculoInvertido ? inverterOrigemDestinoCte(cte) : cte;
  const tabela = calculoInvertido ? tabelaInvertida : tabelaDireta;
  const { transportadora, origem, rota, cotacao } = tabela;

  if (tabela.status === 'SEM_TABELA') {
    return montarResultadoBase(cte, 'SEM_TABELA', 'Transportadora não encontrada no cadastro de tabelas.');
  }

  if (tabela.status === 'SEM_ORIGEM') {
    return montarResultadoBase(cte, 'SEM_ORIGEM', 'Origem/canal não encontrados para a transportadora.', {
      transportadora_tabela: transportadora.nome,
    });
  }

  if (tabela.status === 'SEM_ROTA') {
    return montarResultadoBase(cte, 'SEM_ROTA', 'Rota de destino não encontrada para a origem da transportadora.', {
      transportadora_tabela: transportadora.nome,
    });
  }

  const peso = pesoCte(cteCalculo, opcoes);
  const valorNf = toNumber(pick(cteCalculo, ['valor_nf', 'valorNF', 'nf_venda', 'valor_nota']));

  if (tabela.status === 'SEM_FAIXA' || !cotacao) {
    return montarResultadoBase(cte, 'SEM_FAIXA', 'Faixa/cotação não encontrada para a rota e peso do CT-e.', {
      transportadora_tabela: transportadora.nome,
    });
  }

  const tipoCalculo = getTipoCalculo(origem, cotacao);
  const taxaDestino = getTaxaDestino(origem, rota.ibgeDestino);
  const icmsInfo = inferirAliquotaIcmsAuditoria(origem, rota, cteCalculo, transportadora?.nome);
  const documentoDestinatario = pickDigits(cteCalculo, ['documento_destinatario', 'documentoDestinatario', 'cnpj_destinatario'], 14);
  const generalidades = {
    ...(origem.generalidades || {}),
    incideIcms: origemTemIcmsAtivoAuditoria(origem),
    aliquotaIcms: icmsInfo.aliquota,
    tde: transportadora?.tde ?? 0,
    tdeCnpjs: Array.isArray(transportadora?.tdeCnpjs) ? transportadora.tdeCnpjs : [],
  };

  try {
    const calculo = tipoCalculo === 'FAIXA_DE_PESO'
      ? calcularFreteFaixaPeso({ rota, cotacao, generalidades, taxaDestino, pesoKg: peso, valorNf, documentoDestinatario })
      : calcularFretePercentual({ rota, cotacao, generalidades, taxaDestino, pesoKg: peso, valorNf, documentoDestinatario });

    const tabelaIdAplicada = transportadora.negociacaoId || transportadora.id || null;
    const tabelaNomeAplicada = transportadora.varianteTabela
      || transportadora.tabelaNome
      || transportadora.nomeTabela
      || transportadora.descricaoTabela
      || (transportadora.tabelaAlternativaDe ? 'Alternativa' : 'Principal');
    const percentualCotacao = toNumber(cotacao.percentual || cotacao.fretePercentual);
    const valorPercentualCalculado = toNumber(calculo.componentesBase?.valorPercentual);
    const percentualAplicado = percentualCotacao > 0
      ? percentualCotacao
      : (valorNf > 0 && valorPercentualCalculado > 0 ? (valorPercentualCalculado / valorNf) * 100 : 0);
    const base = montarResultadoBase(cte, 'CALCULADO', '', {
      transportadora_tabela: transportadora.nome,
      tipo_calculo: tipoCalculo,
      detalhes_calculo: {
        tabela_id_aplicada: tabelaIdAplicada,
        tabela_nome_aplicada: tabelaNomeAplicada,
        tabela_principal_aplicada: !transportadora.tabelaAlternativaDe,
        origem_id: origem.id || null,
        origem_cidade: origem.cidade || null,
        rota_id: rota.id || null,
        rota_nome: rota.nomeRota || null,
        rota_prazo: rota.prazoEntregaDias ?? rota.prazo_entrega_dias ?? null,
        cotacao_id: cotacao.id || null,
        peso_considerado: peso,
        valor_base: calculo.valorBase,
        subtotal: calculo.subtotal,
        icms: calculo.icms,
        aliquota_icms: icmsInfo.aliquota,
        origem_aliquota_icms: icmsInfo.origem,
        uf_origem_icms: icmsInfo.ufOrigem,
        uf_destino_icms: icmsInfo.ufDestino,
        taxas: calculo.taxas,
        // subtotalSemEmergencial/taxaEmergencialPct/valorEmergencial vem em
        // campos separados no retorno do freteCalcEngine (nao dentro de
        // componentesBase) — sem isso o motor "Auditoria" nunca salvava a
        // taxa emergencial, so o motor simulador salvava.
        componentes_base: {
          ...calculo.componentesBase,
          tipoCalculo,
          percentualAplicado,
          valorPercentualCalculado,
          rsKgAplicado: toNumber(cotacao.rsKg || cotacao.excesso || cotacao.excessoPeso),
          valorFixoAplicado: toNumber(cotacao.valorFixo || cotacao.taxaAplicada),
          valorNFInformado: valorNf,
          pesoConsiderado: peso,
          rotaNome: rota.nomeRota || null,
          subtotalSemEmergencial: calculo.subtotalSemEmergencial,
          taxaEmergencialPct: calculo.taxaEmergencialPct,
          valorEmergencial: calculo.valorEmergencial,
        },
        componente_base: calculo.componenteBase,
        origem_validada: Boolean(origem.validado),
        origem_validado_em: origem.validado_em || null,
        origem_validado_por: origem.validado_por || null,
        calculo_devolucao_invertida: calculoInvertido,
        observacao_devolucao: calculoInvertido ? 'CT-e de devolucao calculado pela rota de ida equivalente.' : '',
      },
    });

    const valorCalculado = toNumber(calculo.total);
    const diferenca = base.valor_cte - valorCalculado;
    const diferencaAbs = Math.abs(diferenca);
    const percentualDiferenca = valorCalculado > 0 ? (diferenca / valorCalculado) * 100 : 0;

    const resultadoDireto = {
      ...base,
      valor_calculado: valorCalculado,
      diferenca,
      diferenca_abs: diferencaAbs,
      percentual_diferenca: percentualDiferenca,
      motivo_sem_calculo: '',
    };

    // O motor de contingencia (usado inclusive quando o CT-e vem sem peso)
    // tambem precisa comparar cada tabela da mesma transportadora isoladamente.
    // Chamar processarCte com uma unica entrada nao recursa: nao ha comparativo
    // quando o array possui apenas uma tabela.
    const nomeAlvo = transportadoraAlvo || nomeTransportadoraCte(cte, mapaVinculos);
    const gruposVinculados = agruparTabelasAlternativasPorTransportadora(transportadorasContingencia, nomeAlvo);
    const tabelaAtualId = String(transportadora.negociacaoId || transportadora.id || '');
    const entradasVinculadas = gruposVinculados.find((grupo) => grupo.some((entrada) => (
      String(entrada.negociacaoId || entrada.id || '') === tabelaAtualId
    )));
    if (!entradasVinculadas?.length) return resultadoDireto;

    // Reajuste com vigência: a data de emissão decide quais tabelas concorrem.
    const { entradas: entradasVigentes, porVigencia } = aplicarVigenciaNoGrupo(entradasVinculadas, dataEmissaoIsoCte(cte));
    const candidatos = entradasVigentes.map((entrada) => {
      const calculadoTabela = processarCte(cteCalculo, [entrada], mapaVinculos, entrada.nome, opcoes);
      if (calculadoTabela?.status_calculo !== 'CALCULADO' || !(Number(calculadoTabela.valor_calculado) > 0)) return null;
      if (calculadoTabela.detalhes_calculo?.calculo_devolucao_invertida) return null;
      const detalhesTabela = calculadoTabela.detalhes_calculo || {};
      const nomeTabela = detalhesTabela.tabela_nome_aplicada
        || entrada.varianteTabela
        || entrada.tabelaNome
        || entrada.nomeTabela
        || entrada.descricaoTabela
        || (entrada.tabelaAlternativaDe ? 'Alternativa' : 'Principal');
      return {
        tabela_id: detalhesTabela.tabela_id_aplicada || entrada.negociacaoId || entrada.id,
        tabela_nome: nomeTabela,
        variante: nomeTabela,
        principal: !entrada.tabelaAlternativaDe,
        vigencia_inicio: entrada.vigenciaInicio || null,
        vigencia_fim: entrada.vigenciaFim || null,
        valor_calculado: Number(calculadoTabela.valor_calculado),
        divergencia: Math.abs(Number(cte.valor_cte ?? cte.valorCte ?? cte.valor_frete ?? 0) - Number(calculadoTabela.valor_calculado)),
        origem_cidade: detalhesTabela.origem_cidade,
        rota_nome: detalhesTabela.rota_nome,
        peso_considerado: detalhesTabela.peso_considerado,
        valor_base: detalhesTabela.valor_base,
        subtotal: detalhesTabela.subtotal,
        icms: detalhesTabela.icms,
        aliquota_icms: detalhesTabela.aliquota_icms,
        origem_aliquota_icms: detalhesTabela.origem_aliquota_icms,
        uf_origem_icms: detalhesTabela.uf_origem_icms,
        uf_destino_icms: detalhesTabela.uf_destino_icms,
        taxas: detalhesTabela.taxas,
        componentes_base: detalhesTabela.componentes_base,
        componente_base: detalhesTabela.componente_base,
        resultado: calculadoTabela,
      };
    }).filter(Boolean);
    const vigenteCalculou = candidatos.some((c) => c.vigencia_inicio || c.vigencia_fim);
    if (porVigencia && !vigenteCalculou) return resultadoDireto;
    if (candidatos.length <= 1 && !porVigencia) return resultadoDireto;

    const melhor = candidatos.toSorted((a, b) => a.divergencia - b.divergencia)[0];
    const escolhido = melhor?.resultado || resultadoDireto;
    return {
      ...escolhido,
      detalhes_calculo: {
        ...(escolhido.detalhes_calculo || {}),
        comparativo_tabelas: candidatos.map(({ resultado: _resultado, ...resumo }) => resumo),
        melhor_comparativo_tabela: melhor?.tabela_nome || '',
        tabela_alternativa_aplicada: escolhido.detalhes_calculo?.tabela_nome_aplicada || '',
        tabela_por_vigencia: Boolean(porVigencia),
      },
    };
  } catch (error) {
    return montarResultadoBase(cte, 'ERRO_CALCULO', error.message || 'Erro ao calcular frete.', {
      transportadora_tabela: transportadora.nome,
      tipo_calculo: tipoCalculo,
    });
  }
}

async function buscarCtesMesBruto({ supabase, competencia, dataInicio, dataFim, onProgress }) {
  const temPeriodo = Boolean(dataInicio || dataFim);
  const datas = temPeriodo
    ? { inicio: dataInicio || '0001-01-01', fim: dataFim || '9999-12-31' }
    : competenciaParaDatas(competencia);
  if (!datas) throw new Error('Informe a competência (YYYY-MM) ou um período (datas).');

  const carregarPorFiltro = async (modo) => {
    const acumulado = [];
    let from = 0;

    while (true) {
      let query = supabase
        .from(TABELA_CTES)
        .select('*')
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (modo === 'data') {
        query = query.gte('data_emissao', datas.inicio).lte('data_emissao', datas.fim);
      } else {
        query = query.eq('competencia', competencia);
      }

      const { data, error } = await query;
      if (error) throw new Error(`Erro ao buscar CT-es por ${modo}: ${error.message}`);

      const lote = data || [];
      acumulado.push(...lote);
      onProgress?.({ etapa: `carregando_ctes_${modo}`, carregados: acumulado.length, total: null });

      if (lote.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    return filtrarCpComercialCte(acumulado);
  };

  const porData = await carregarPorFiltro('data');
  if (porData.length > 0 || temPeriodo) return porData;

  return carregarPorFiltro('competencia');
}

function calcularResumo(registros = [], competencia = '') {
  const total = registros.length;
  const calculados = registros.filter((row) => toNumber(row.valor_calculado) > 0).length;
  const semCalculo = total - calculados;
  const divergentes = registros.filter((row) => (
    toNumber(row.valor_calculado) > 0 && Math.abs(toNumber(row.diferenca)) > LIMITE_DIVERGENCIA_ASSERTIVO
  )).length;
  const assertivos = calculados - divergentes;
  const valorTotalCte = registros.reduce((acc, row) => acc + toNumber(row.valor_cte), 0);
  const valorTotalCalculado = registros.reduce((acc, row) => acc + toNumber(row.valor_calculado), 0);
  const valorTotalDivergencia = registros.reduce((acc, row) => acc + Math.abs(toNumber(row.diferenca)), 0);
  const valorExcessivo = registros.reduce((acc, row) => acc + Math.max(toNumber(row.diferenca), 0), 0);
  const valorInsuficiente = registros.reduce((acc, row) => acc + Math.abs(Math.min(toNumber(row.diferenca), 0)), 0);

  return {
    competencia,
    total_ctes: total,
    calculados,
    sem_calculo: semCalculo,
    assertivos,
    divergentes,
    valor_total_cte: valorTotalCte,
    valor_total_calculado: valorTotalCalculado,
    valor_total_divergencia: valorTotalDivergencia,
    valor_excessivo: valorExcessivo,
    valor_insuficiente: valorInsuficiente,
    taxa_calculo: total > 0 ? (calculados / total) * 100 : 0,
    taxa_assertividade: calculados > 0 ? (assertivos / calculados) * 100 : 0,
    taxa_divergencia: calculados > 0 ? (divergentes / calculados) * 100 : 0,
    processado_em: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function salvarResultadosMes({ supabase, competencia, registros, resumo, onProgress }) {
  const { error: deleteError } = await supabase
    .from(TABELA_RESULTADOS)
    .delete()
    .eq('competencia', competencia);

  if (deleteError) {
    throw new Error(`Erro ao limpar resultado anterior: ${deleteError.message}`);
  }

  for (let index = 0; index < registros.length; index += INSERT_CHUNK) {
    const chunk = registros.slice(index, index + INSERT_CHUNK);
    let { error } = await supabase.from(TABELA_RESULTADOS).insert(chunk);
    if (error && erroColunaOpcionalResultado(error)) {
      ({ error } = await supabase.from(TABELA_RESULTADOS).insert(chunk.map(semCamposResultadoOpcionais)));
    }

    if (error) {
      throw new Error(`Erro ao salvar resultados da auditoria: ${error.message}`);
    }

    onProgress?.({
      etapa: 'salvando_resultados',
      carregados: Math.min(index + INSERT_CHUNK, registros.length),
      total: registros.length,
    });
  }

  const { error: resumoError } = await supabase
    .from(TABELA_RESUMO)
    .upsert(resumo, { onConflict: 'competencia' });

  if (resumoError) {
    throw new Error(`Erro ao salvar resumo mensal: ${resumoError.message}`);
  }
}

// Resimula um subconjunto de registros JÁ carregados (em memória), sem gravar
// nada no banco. Reaproveita o motor processarCte com as tabelas cadastradas e
// preserva o cálculo Verum original de cada registro (processarCte o recomputaria
// a partir de valor_calculado, que num resultado salvo é o recálculo anterior).
export async function resimularRegistros({ registros, transportadorasAlvo, onProgress, onCheckpoint, ignorarCubagem = true, percentualContingenciaPeso = 0, apenasDadosCompletos = true } = {}) {
  if (!Array.isArray(registros) || !registros.length) return [];

  const registrosParaCalcular = apenasDadosCompletos
    ? registros
    : await enriquecerCtesComTrackingAoVivo(registros, onProgress);
  await onCheckpoint?.({ etapa: 'cruzado', registros: registrosParaCalcular });

  const mapaVinculos = await carregarMapaVinculosAuditoria();
  const contextoLotacao = await carregarContextoLotacaoAuditoria(ensureSupabase(), mapaVinculos);
  await precarregarEquivalenciasOrigemAuditoria();
  const transportadoras = await carregarBaseFreteParaRegistros(registrosParaCalcular, onProgress, transportadorasAlvo, mapaVinculos);
  const alvosNormalizados = Array.from(new Set(
    (transportadorasAlvo || [])
      .map((nome) => aplicarVinculoTransportadora(nome, mapaVinculos) || nome)
      .map((nome) => String(nome || '').trim())
      .filter(Boolean)
  ));
  const transportadoraAlvo = alvosNormalizados.length === 1 ? alvosNormalizados[0] : '';

  if (!transportadoras.length && !contextoLotacao.tabelas.length && !contextoLotacao.fluxo?.porNumeroCte?.size) {
    throw new Error('Nenhuma tabela de frete cadastrada foi encontrada para resimular.');
  }

  await prepararFluxoLotacaoParaCtes(ensureSupabase(), contextoLotacao, registrosParaCalcular, mapaVinculos);
  const out = [];
  for (let index = 0; index < registros.length; index += 1) {
    const original = registros[index] || {};
    const paraCalculo = registrosParaCalcular[index] || original;
    const novo = calcularLotacaoOuFracionado(paraCalculo, contextoLotacao, mapaVinculos,
      () => processarCte(paraCalculo, transportadoras, mapaVinculos, transportadoraAlvo, { ignorarCubagem, percentualContingenciaPeso }));

    const temVerum = original.valor_calculado_verum !== undefined && original.valor_calculado_verum !== null;
    const verum = temVerum ? toNumber(original.valor_calculado_verum) : novo.valor_calculado_verum;
    const difVerum = temVerum
      ? (original.diferenca_verum !== undefined && original.diferenca_verum !== null
        ? toNumber(original.diferenca_verum)
        : (verum > 0 ? toNumber(original.valor_cte) - verum : 0))
      : novo.diferenca_verum;

    out.push({
      ...original,
      ...novo,
      valor_calculado_verum: verum,
      diferenca_verum: difVerum,
    });

    if (index % 200 === 0 || index === registros.length - 1) {
      onProgress?.({ etapa: 'resimulando', carregados: index + 1, total: registros.length });
      await cederThread();
    }
  }

  return out;
}

export async function carregarOpcoesPreFiltroAuditoria() {
  const supabase = ensureSupabase();
  const consultarComRetry = async (consulta) => {
    let resposta;
    for (let tentativa = 0; tentativa < 3; tentativa += 1) {
      resposta = await consulta();
      if (!resposta.error || !/PGRST002|schema cache|503/i.test(`${resposta.error.code || ''} ${resposta.error.message || ''}`)) return resposta;
      await esperarLeve(350 * (tentativa + 1));
    }
    return resposta;
  };
  const [{ data, error }, { data: vinculos, error: erroVinculos }] = await Promise.all([
    consultarComRetry(() => supabase.from('auditoria_carteiras').select('transportadora,auditor_nome,auditor_email').order('transportadora', { ascending: true })),
    consultarComRetry(() => supabase.from('transportadora_vinculos').select('nome_cte,nome_tabela')),
  ]);
  if (error) throw new Error(`Erro ao carregar transportadoras e auditores: ${error.message}`);
  const carteiras = data || [];
  return {
    carteiras,
    vinculos: erroVinculos ? [] : (vinculos || []),
    transportadoras: [...new Set(carteiras.map((item) => String(item.transportadora || '').trim()).filter(Boolean))],
    auditores: [...new Set(carteiras.map((item) => String(item.auditor_nome || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
  };
}

async function consultarLotesComConcorrencia(itens, tamanhoLote, concorrencia, consultar) {
  const lotes = [];
  for (let inicio = 0; inicio < itens.length; inicio += tamanhoLote) {
    lotes.push(itens.slice(inicio, inicio + tamanhoLote));
  }
  const resultados = [];
  for (let inicio = 0; inicio < lotes.length; inicio += concorrencia) {
    const grupo = lotes.slice(inicio, inicio + concorrencia);
    resultados.push(...await Promise.all(grupo.map(consultar)));
  }
  return resultados;
}

export async function enriquecerCtesComFaturas(registros = []) {
  if (!registros.length) return registros;
  const supabase = ensureSupabase();
  const somenteDigitos = (valor) => String(valor || '').replace(/\D/g, '');
  const chaves = [...new Set(registros.map((r) => somenteDigitos(r.chave_cte)).filter(Boolean))];
  const numeros = [...new Set(registros.filter((r) => !somenteDigitos(r.chave_cte)).map((r) => somenteDigitos(r.numero_cte)).filter(Boolean))];
  const detalhes = [];
  const paginasChaves = await consultarLotesComConcorrencia(chaves, 100, 20, (lote) => (
    supabase.from('fatura_detalhes').select('fatura_id,chave_cte,numero_cte').in('chave_cte', lote)
  ));
  paginasChaves.forEach(({ data, error }) => { if (!error) detalhes.push(...(data || [])); });

  const paginasNumeros = await consultarLotesComConcorrencia(numeros, 100, 20, (lote) => (
    supabase.from('fatura_detalhes').select('fatura_id,chave_cte,numero_cte').in('numero_cte', lote)
  ));
  paginasNumeros.forEach(({ data, error }) => { if (!error) detalhes.push(...(data || [])); });
  const ids = [...new Set(detalhes.map((item) => item.fatura_id).filter(Boolean))];
  const faturas = [];
  const paginasFaturas = await consultarLotesComConcorrencia(ids, 100, 20, (lote) => (
    supabase.from('faturas').select('id,numero_fatura,status').in('id', lote)
  ));
  paginasFaturas.forEach(({ data, error }) => { if (!error) faturas.push(...(data || [])); });
  const porId = new Map(faturas.map((fatura) => [fatura.id, fatura]));
  const normalizarNome = (valor) => String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const [{ data: transportadoras }, { data: origens }, { data: vinculos }, { data: carteiras }] = await Promise.all([
    supabase.from('transportadoras').select('id,nome'),
    supabase.from('origens').select('transportadora_id,validado'),
    supabase.from('transportadora_vinculos').select('nome_cte,nome_tabela'),
    supabase.from('auditoria_carteiras').select('transportadora,auditor_nome,auditor_email'),
  ]);
  const vinculoPorNome = new Map((vinculos || []).map((item) => [normalizarNome(item.nome_cte), item.nome_tabela]));
  const validacaoPorId = new Map();
  (origens || []).forEach((origem) => {
    const atual = validacaoPorId.get(origem.transportadora_id) || { total: 0, validadas: 0 };
    atual.total += 1;
    if (origem.validado) atual.validadas += 1;
    validacaoPorId.set(origem.transportadora_id, atual);
  });
  const validacaoPorNome = new Map((transportadoras || []).map((transportadora) => {
    const resumo = validacaoPorId.get(transportadora.id) || { total: 0, validadas: 0 };
    return [normalizarNome(transportadora.nome), { ...resumo, validada: resumo.total > 0 && resumo.validadas === resumo.total }];
  }));
  const carteiraPorNome = new Map((carteiras || []).map((carteira) => [normalizarNome(carteira.transportadora), carteira]));
  const porIdentificador = new Map();
  detalhes.forEach((item) => {
    const fatura = porId.get(item.fatura_id);
    if (!fatura) return;
    [somenteDigitos(item.chave_cte), somenteDigitos(item.numero_cte)].filter(Boolean).forEach((id) => {
      if (!porIdentificador.has(id)) porIdentificador.set(id, new Map());
      porIdentificador.get(id).set(fatura.id, fatura);
    });
  });
  // CT-es retirados de uma fatura por falta de entrega e ainda sem nova fatura.
  const chavesSemFatura = registros
    .map((row) => somenteDigitos(row.chave_cte) || somenteDigitos(row.numero_cte))
    .filter((id) => id && !porIdentificador.has(id));
  const aguardandoPorChave = await carregarAguardandoNovaFatura(chavesSemFatura);
  return registros.map((row) => {
    const vinculadas = new Map();
    const chave = somenteDigitos(row.chave_cte);
    const idsLinha = chave ? [chave] : [somenteDigitos(row.numero_cte)].filter(Boolean);
    idsLinha.forEach((id) => {
      porIdentificador.get(id)?.forEach((fatura, faturaId) => vinculadas.set(faturaId, fatura));
    });
    const lista = [...vinculadas.values()];
    const nomeBruto = String(row.transportadora || '');
    const nomeTabela = vinculoPorNome.get(normalizarNome(nomeBruto)) || nomeBruto;
    const validacaoAtual = validacaoPorNome.get(normalizarNome(nomeTabela));
    const carteiraAtual = carteiraPorNome.get(normalizarNome(nomeTabela)) || carteiraPorNome.get(normalizarNome(nomeBruto));
    return {
      ...row,
      tem_fatura: lista.length > 0,
      aguardando_nova_fatura: lista.length === 0 && aguardandoPorChave.has(idsLinha[0]),
      aguardando_nova_fatura_info: lista.length === 0 ? (aguardandoPorChave.get(idsLinha[0]) || null) : null,
      faturas_vinculadas: lista,
      numeros_fatura: lista.map((fatura) => fatura.numero_fatura).filter(Boolean),
      transportadora_validada_atual: validacaoAtual?.validada,
      validacao_origens_atual: validacaoAtual || null,
      auditor_nome_carteira: carteiraAtual?.auditor_nome || '',
      auditor_email_carteira: carteiraAtual?.auditor_email || '',
    };
  });
}

export async function enriquecerCtesComFaturasEmLotes(registros = [], { tamanhoLote = 200, onProgress } = {}) {
  const resultado = [];
  const tamanho = Math.max(1, Math.min(Number(tamanhoLote) || 200, 500));
  for (let inicio = 0; inicio < registros.length; inicio += tamanho) {
    const lote = registros.slice(inicio, inicio + tamanho);
    resultado.push(...await enriquecerCtesComFaturas(lote));
    const carregados = Math.min(inicio + lote.length, registros.length);
    onProgress?.({ etapa: 'enriquecendo_faturas', carregados, total: registros.length });
    await cederThread();
  }
  return resultado;
}

export async function carregarResultadosAuditoriaMes({ competencia, dataInicio, dataFim, limite, canais, transportadoras, colunas = '*', onProgress, tamanhoPagina = PAGE_SIZE } = {}) {
  const temPeriodo = Boolean(dataInicio || dataFim);
  if (!competencia && !temPeriodo) {
    throw new Error('Informe a competência ou um período para carregar o resultado salvo.');
  }

  const supabase = ensureSupabase();
  const acumulado = [];
  let from = 0;
  const teto = Number(limite) > 0 ? Number(limite) : Infinity;
  const pagina = Math.max(1, Math.min(Number(tamanhoPagina) || PAGE_SIZE, PAGE_SIZE));
  const concorrenciaPaginas = teto === Infinity ? 8 : Math.max(1, Math.min(8, Math.ceil(teto / pagina)));

  while (true) {
    const inicios = Array.from({ length: concorrenciaPaginas }, (_, indice) => from + indice * pagina);
    const paginas = await Promise.all(inicios.map((inicioPagina) => {
      let query = supabase.from(TABELA_RESULTADOS).select(colunas);
      if (temPeriodo) {
        if (dataInicio) query = query.gte('data_emissao', dataInicio);
        if (dataFim) query = query.lte('data_emissao', dataFim);
      } else {
        query = query.eq('competencia', competencia);
      }
      if (transportadoras?.length) query = query.in('transportadora', transportadoras);
      return query
        .order('data_emissao', { ascending: true, nullsFirst: false })
        .order('id', { ascending: true })
        .range(inicioPagina, inicioPagina + pagina - 1);
    }));

    const paginaComErro = paginas.find((item) => item.error);
    if (paginaComErro) throw new Error(`Erro ao carregar auditoria salva: ${paginaComErro.error.message}`);

    paginas.forEach((item) => acumulado.push(...(item.data || [])));
    onProgress?.({ etapa: 'carregando_resultado_salvo', carregados: acumulado.length, total: null });

    if (paginas.some((item) => (item.data || []).length < pagina) || acumulado.length >= teto) break;
    from += pagina * concorrenciaPaginas;
  }

  let resultado = teto !== Infinity ? acumulado.slice(0, teto) : acumulado;
  if (canais?.length) {
    const cSet = new Set(canais);
    resultado = resultado.filter((r) => cSet.has(normalizarCanalResultado(r.canal || r.canal_original)));
  }
  return resultado;
}

export async function carregarPreListaAuditoriaMes(params = {}) {
  return carregarResultadosAuditoriaMes({
    ...params,
    colunas: [
      'competencia',
      'data_emissao',
      'chave_cte',
      'numero_cte',
      'transportadora',
      'tomador_servico',
      'cidade_origem',
      'uf_origem',
      'cidade_destino',
      'uf_destino',
      'canal',
      'peso',
      'valor_cte',
      'valor_calculado',
      'valor_calculado_verum',
      'diferenca',
      'diferenca_verum',
      'status_calculo',
      'motivo_sem_calculo',
    ].join(','),
  });
}

export async function carregarResumoAuditoriaMensal() {
  const supabase = ensureSupabase();

  const { data, error } = await supabase
    .from(TABELA_RESUMO)
    .select('*')
    .order('competencia', { ascending: true });

  if (error) throw new Error(`Erro ao carregar resumo mensal: ${error.message}`);

  return data || [];
}

// Mesmo cruzamento com o Tracking que o Simulador Realizado faz (motor
// compartilhado em realizadoTrackingEnrichment.js). A base de CT-es não tem
// chave_nfe/nota_fiscal, então o casamento aqui é só por chave_cte/numero_cte.
async function enriquecerCtesComTrackingAoVivo(ctes = [], onProgress) {
  const withTimeout = (promise, ms, label) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} excedeu ${Math.round(ms / 1000)}s`)), ms)),
  ]);
  const montarLinha = (cte) => ({
    chaveCte: pick(cte, ['chave_cte', 'chaveCte', 'chave']) || '',
    numeroCte: pick(cte, ['numero_cte', 'numeroCte', 'cte', 'nro_cte']) || '',
    peso: toNumber(pick(cte, ['peso'])),
    pesoDeclarado: toNumber(pick(cte, ['peso_declarado', 'pesoDeclarado', 'peso'])),
    documentoDestinatario: pickDigits(cte, ['documento_destinatario', 'documentoDestinatario', 'cnpj_destinatario'], 14),
  });

  const total = ctes.length;
  // Lote maior (a consulta em si já pagina por 300 chaves por vez lá dentro)
  // e concorrência limitada: em vez de esperar um lote de cada vez, dispara
  // vários em paralelo, o que reduz bastante o tempo total em faturas grandes
  // sem sobrecarregar o Supabase (é leitura simples, não API externa limitada).
  const tamanhoLote = 200;
  const concorrenciaMaxima = 4;
  const lotes = [];
  for (let inicio = 0; inicio < ctes.length; inicio += tamanhoLote) {
    lotes.push(ctes.slice(inicio, inicio + tamanhoLote));
  }
  const resultadoPorLote = new Array(lotes.length);
  let carregados = 0;
  onProgress?.({ etapa: 'cruzando_tracking', carregados: 0, total });

  const processarLote = async (loteCtes, indiceLote) => {
    const linhas = loteCtes.map(montarLinha);
    let linhasEnriquecidas = linhas;
    try {
      const mapasTracking = await withTimeout(
        buscarTrackingParaRealizado(linhas),
        45000,
        `Tracking lote ${indiceLote + 1}`,
      );
      linhasEnriquecidas = enriquecerRealizadoComTracking(linhas, mapasTracking).linhas || linhas;
    } catch (error) {
      console.warn('[Auditoria CT-e] Tracking ignorado para lote lento:', error?.message || error);
      linhasEnriquecidas = linhas.map((linha) => ({
        ...linha,
        trackingMatch: false,
        trackingPendente: true,
        pesoCubado: 0,
        cubagemTotal: 0,
      }));
    }

    resultadoPorLote[indiceLote] = loteCtes.map((cte, index) => {
      const enriquecida = linhasEnriquecidas[index] || {};
      return {
        ...cte,
        trackingMatch: enriquecida.trackingMatch || cte.trackingMatch,
        peso_declarado: enriquecida.pesoDeclarado || cte.peso_declarado,
        peso_cubado: enriquecida.pesoCubado || cte.peso_cubado,
        cubagem: enriquecida.cubagemTotal || cte.cubagem,
        cubagemTotal: enriquecida.cubagemTotal || cte.cubagemTotal,
        peso_tracking: enriquecida.pesoTracking || 0,
        peso_cubado_tracking_300: enriquecida.pesoCubadoTracking300 || 0,
        documento_destinatario: enriquecida.documentoDestinatario || cte.documento_destinatario || '',
      };
    });

    carregados = Math.min(carregados + loteCtes.length, total);
    onProgress?.({ etapa: 'cruzando_tracking', carregados, total });
  };

  for (let inicio = 0; inicio < lotes.length; inicio += concorrenciaMaxima) {
    const grupo = lotes.slice(inicio, inicio + concorrenciaMaxima);
    await Promise.all(grupo.map((loteCtes, offset) => processarLote(loteCtes, inicio + offset)));
    await cederThread();
  }

  return resultadoPorLote.flat();
}

export async function processarESalvarAuditoriaMes({ competencia, dataInicio, dataFim, canais, onProgress, ignorarCubagem = true, percentualContingenciaPeso = 0, apenasDadosCompletos = true } = {}) {
  if (!competencia && !(dataInicio || dataFim)) {
    throw new Error('Informe a competência ou um período para processar a auditoria.');
  }

  const supabase = ensureSupabase();
  const mapaVinculos = await carregarMapaVinculosAuditoria();
  const contextoLotacao = await carregarContextoLotacaoAuditoria(supabase, mapaVinculos);
  await precarregarEquivalenciasOrigemAuditoria();
  await precarregarRaizesAdicionaisAuditoria();

  onProgress?.({ etapa: 'carregando_tabelas', carregados: 0, total: null });
  if (!_cacheBaseFrete) {
    // heartbeat enquanto carrega (lookup de CEP→IBGE pode demorar)
    let _tick = 0;
    const _hb = setInterval(() => { _tick += 1; onProgress?.({ etapa: 'carregando_tabelas', carregados: _tick, total: null }); }, 600);
    try {
      _cacheBaseFrete = expandirTabelasAlternativasOficiais(normalizarTransportadoras(await carregarBaseCompletaDb(onProgress)));
    } finally {
      clearInterval(_hb);
    }
  }
  const transportadoras = _cacheBaseFrete;

  if (!transportadoras.length && !contextoLotacao.tabelas.length && !contextoLotacao.fluxo?.porNumeroCte?.size) {
    throw new Error('Nenhuma tabela de frete cadastrada foi encontrada para processar a auditoria.');
  }

  let ctes = await buscarCtesMesBruto({ supabase, competencia, dataInicio, dataFim, onProgress });
  if (canais?.length) {
    const cSet = new Set(canais);
    ctes = ctes.filter((r) => cSet.has(normalizarCanalResultado(r.canal || r.canal_original)));
  }

  if (!ctes.length) {
    const alvo = competencia || `período ${dataInicio || '...'} a ${dataFim || '...'}`;
    throw new Error(`Nenhum CT-e encontrado para ${alvo}${canais?.length ? ` (canais: ${canais.join(', ')})` : ''}.`);
  }

  if (!apenasDadosCompletos) {
    ctes = await enriquecerCtesComTrackingAoVivo(ctes, onProgress);
  }

  const registros = [];
  await prepararFluxoLotacaoParaCtes(supabase, contextoLotacao, ctes, mapaVinculos);

  for (let index = 0; index < ctes.length; index += 1) {
    registros.push(calcularLotacaoOuFracionado(ctes[index], contextoLotacao, mapaVinculos,
      () => processarCte(ctes[index], transportadoras, mapaVinculos, '', { ignorarCubagem, percentualContingenciaPeso })));

    if (index % 500 === 0 || index === ctes.length - 1) {
      onProgress?.({ etapa: 'processando_ctes', carregados: index + 1, total: ctes.length });
      await cederThread();
    }
  }

  const resumo = calcularResumo(registros, competencia);

  // Salvar é destrutivo (deleta o mês inteiro e reinsere). Só grava quando a carga
  // é do mês inteiro (apenas competência). Com período, devolve como preview para
  // não apagar o restante do mês salvo.
  const temPeriodo = Boolean(dataInicio || dataFim);
  if (!temPeriodo) {
    await salvarResultadosMes({ supabase, competencia, registros, resumo, onProgress });
  }

  onProgress?.({ etapa: 'concluido', carregados: registros.length, total: registros.length });

  return {
    registros,
    resumo,
    gravado: !temPeriodo,
    fonte: {
      id: TABELA_RESULTADOS,
      tabela: TABELA_RESULTADOS,
      label: temPeriodo
        ? 'Recálculo do período (preview, não gravado)'
        : 'Auditoria processada / auditoria_cte_resultados',
    },
  };
}

// Recalcula um conjunto específico de CT-es (por chave_cte), independente de
// competência — usado pela tela de Faturas, pra recalcular só os CT-es de uma
// fatura sem precisar processar o mês inteiro. Não salva sozinho: devolve os
// registros calculados pra quem chamou decidir onde/como persistir.
export async function buscarCtesPorIdentificadores(chaves = [], onProgress) {
  const normalizadas = [...new Set((chaves || []).map((c) => onlyDigits(c)).filter(Boolean))];
  if (!normalizadas.length) return { ctes: [], encontrados: 0, naoEncontrados: 0 };
  const chavesCte = normalizadas.filter((valor) => valor.length >= 20);
  const numerosCte = normalizadas.filter((valor) => valor.length < 20);

  const supabase = ensureSupabase();
  const ctes = [];
  for (let inicio = 0; inicio < chavesCte.length; inicio += 200) {
    const lote = chavesCte.slice(inicio, inicio + 200);
    const { data, error } = await supabase.from(TABELA_CTES).select('*').in('chave_cte', lote);
    if (error) throw new Error(`Erro ao buscar CT-es por chave: ${error.message}`);
    ctes.push(...(data || []));
    onProgress?.({ etapa: 'buscando_ctes', carregados: ctes.length, total: normalizadas.length });
  }

  for (let inicio = 0; inicio < numerosCte.length; inicio += 200) {
    const lote = numerosCte.slice(inicio, inicio + 200);
    const { data, error } = await supabase.from(TABELA_CTES).select('*').in('numero_cte', lote);
    if (error) throw new Error(`Erro ao buscar CT-es por numero: ${error.message}`);
    ctes.push(...(data || []));
    onProgress?.({ etapa: 'buscando_ctes', carregados: ctes.length, total: normalizadas.length });
  }

  const vistos = new Set();
  const ctesUnicos = ctes.filter((cte) => {
    const chave = pick(cte, ['chave_cte', 'chaveCte', 'chave']) || pick(cte, ['numero_cte', 'numeroCte', 'cte', 'nro_cte']) || pick(cte, ['id']);
    if (!chave || vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });

  return {
    ctes: ctesUnicos,
    encontrados: ctesUnicos.length,
    naoEncontrados: Math.max(0, normalizadas.length - ctesUnicos.length),
  };
}

export async function processarCtesPorChave(chaves = [], onProgress, opcoes = {}) {
  const opcoesCalculo = { ignorarCubagem: true, ...opcoes };
  const verificarCancelamento = () => {
    if (opcoesCalculo.deveCancelar?.()) {
      const erro = new Error('Processamento cancelado pelo usuário. Nenhum resultado parcial foi salvo.');
      erro.codigo = 'PROCESSAMENTO_CANCELADO';
      throw erro;
    }
  };
  verificarCancelamento();
  const normalizadas = [...new Set((chaves || []).map((c) => onlyDigits(c)).filter(Boolean))];
  if (!normalizadas.length) return { registros: [], encontrados: 0, naoEncontrados: 0 };
  const chavesCte = normalizadas.filter((valor) => valor.length >= 20);
  const numerosCte = normalizadas.filter((valor) => valor.length < 20);

  const supabase = ensureSupabase();
  // A auditoria pode ser aberta diretamente, sem passar pela tela da matriz.
  // Sincroniza antes do calculo para nao usar uma copia antiga do localStorage
  // e deixar de aplicar excecoes cadastradas no Supabase.
  await carregarMatrizIcmsUfCentralizada();
  verificarCancelamento();
  const mapaVinculos = await carregarMapaVinculosAuditoria();
  const contextoLotacao = await carregarContextoLotacaoAuditoria(supabase, mapaVinculos);
  verificarCancelamento();
  await precarregarEquivalenciasOrigemAuditoria();
  verificarCancelamento();

  const ctes = [];
  for (let inicio = 0; inicio < chavesCte.length; inicio += 200) {
    verificarCancelamento();
    const lote = chavesCte.slice(inicio, inicio + 200);
    const { data, error } = await supabase.from(TABELA_CTES).select('*').in('chave_cte', lote);
    if (error) throw new Error(`Erro ao buscar CT-es por chave: ${error.message}`);
    verificarCancelamento();
    ctes.push(...(data || []));
    onProgress?.({ etapa: 'buscando_ctes', carregados: ctes.length, total: normalizadas.length });
  }

  for (let inicio = 0; inicio < numerosCte.length; inicio += 200) {
    verificarCancelamento();
    const lote = numerosCte.slice(inicio, inicio + 200);
    const { data, error } = await supabase.from(TABELA_CTES).select('*').in('numero_cte', lote);
    if (error) throw new Error(`Erro ao buscar CT-es por numero: ${error.message}`);
    verificarCancelamento();
    ctes.push(...(data || []));
    onProgress?.({ etapa: 'buscando_ctes', carregados: ctes.length, total: normalizadas.length });
  }

  const vistos = new Set();
  const ctesUnicos = ctes.filter((cte) => {
    const chave = pick(cte, ['chave_cte', 'chaveCte', 'chave']) || pick(cte, ['numero_cte', 'numeroCte', 'cte', 'nro_cte']) || pick(cte, ['id']);
    if (!chave || vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });

  onProgress?.({ etapa: 'carregando_tabelas', carregados: 0, total: null });
  // Endereco/canal corrigidos manualmente mudam a rota calculada: a busca
  // direcionada de tabelas precisa incluir a rota corrigida, senao a rota nova
  // nunca e carregada e o CT-e cai em SEM_ROTA.
  const ctesParaBuscaBase = ctesUnicos.flatMap((cte) => {
    const ov = opcoesCalculo.trackingOverridePorChave?.[onlyDigits(pick(cte, ['chave_cte', 'chaveCte', 'chave']))]
      ?? opcoesCalculo.trackingOverridePorChave?.[onlyDigits(pick(cte, ['numero_cte', 'numeroCte', 'cte', 'nro_cte']))];
    if (!ov || !(ov.ibgeOrigem || ov.ibgeDestino || ov.canal)) return [cte];
    return [cte, {
      ...cte,
      ibge_origem: ov.ibgeOrigem || cte.ibge_origem,
      ibge_destino: ov.ibgeDestino || cte.ibge_destino,
      cidade_origem: ov.cidadeOrigem || cte.cidade_origem,
      canal: ov.canal || cte.canal,
      canal_original: ov.canal || cte.canal_original,
    }];
  });
  const transportadoras = await carregarBaseFreteParaRegistros(ctesParaBuscaBase, onProgress, [], mapaVinculos);
  verificarCancelamento();
  if (!transportadoras.length && !contextoLotacao.tabelas.length && !contextoLotacao.fluxo?.porNumeroCte?.size) {
    throw new Error('Nenhuma tabela de frete cadastrada foi encontrada para recalcular.');
  }

  // Mesmo no recálculo "completo" da tela de Faturas, a base de CT-es antiga
  // pode não ter documento_destinatario. Nesse caso o Tracking precisa ser
  // consultado para que regras por CNPJ (como TDE) entrem no cálculo.
  const faltaDocumentoDestinatario = ctesUnicos.some((cte) => (
    !pickDigits(cte, ['documento_destinatario', 'documentoDestinatario', 'cnpj_destinatario'], 14)
  ));
  // Decisao por CT-e (nao pelo lote): antes, bastava UM CT-e sem documento do
  // destinatario para o tracking reescrever peso/cubagem de TODOS do lote, e o
  // mesmo CT-e calculava diferente conforme os outros recalculados junto.
  const semDocumentoDestinatario = (cte) => !pickDigits(cte, ['documento_destinatario', 'documentoDestinatario', 'cnpj_destinatario'], 14);
  // modoPeso: 'cte' (padrao) | 'tracking' (peso do Tracking x cubagem, maior
  // vale) | 'tracking_original' (so o peso fisico que veio no Tracking).
  // Pode vir por CT-e (modoPesoPorChave, escolhido na linha da fatura) ou geral.
  const modoValido = (valor) => (['tracking', 'tracking_original'].includes(valor) ? valor : 'cte');
  const modoPesoDoCte = (cte) => {
    const chave = onlyDigits(pick(cte, ['chave_cte', 'chaveCte', 'chave']));
    const numero = onlyDigits(pick(cte, ['numero_cte', 'numeroCte', 'cte', 'nro_cte']));
    return modoValido(opcoesCalculo.modoPesoPorChave?.[chave] ?? opcoesCalculo.modoPesoPorChave?.[numero] ?? opcoesCalculo.modoPeso);
  };
  const indicesTracking = opcoesCalculo.consultarTrackingAoVivo === false
    ? []
    : ctesUnicos.map((cte, indice) => indice).filter((indice) => (
      modoPesoDoCte(ctesUnicos[indice]) !== 'cte' || opcoesCalculo.apenasDadosCompletos === false || semDocumentoDestinatario(ctesUnicos[indice])
    ));
  const deveConsultarTracking = indicesTracking.length > 0;
  const enriquecidos = deveConsultarTracking
    ? await enriquecerCtesComTrackingAoVivo(indicesTracking.map((indice) => ctesUnicos[indice]), onProgress)
    : [];
  const enriquecidoPorIndice = new Map(indicesTracking.map((indice, posicao) => [indice, enriquecidos[posicao]]));
  const ctesParaCalculo = ctesUnicos.map((cte, indice) => (
    enriquecidoPorIndice.get(indice) || { ...cte, trackingNaoConsultado: opcoesCalculo.apenasDadosCompletos === false }
  ));
  verificarCancelamento();
  if (typeof window !== 'undefined') {
    ctesParaCalculo.forEach((cte) => {
      const numero = onlyDigits(pick(cte, ['numero_cte', 'numeroCte', 'cte', 'nro_cte']));
      if (numero === '1600282') {
        console.log('[DEBUG TDE] cte 1600282', {
          lote: normalizadas.length,
          deveConsultarTracking,
          faltaDocumentoDestinatario,
          documento_destinatario: pickDigits(cte, ['documento_destinatario', 'documentoDestinatario', 'cnpj_destinatario'], 14),
          trackingMatch: cte.trackingMatch,
          trackingPendente: cte.trackingPendente,
        });
      }
    });
  }
  onProgress?.({ etapa: 'calculando_amd', carregados: 0, total: ctesUnicos.length });
  await cederThread();

  await prepararFluxoLotacaoParaCtes(supabase, contextoLotacao, ctesParaCalculo, mapaVinculos);
  const registros = [];
  for (let index = 0; index < ctesUnicos.length; index += 1) {
    verificarCancelamento();
    const cteBase = ctesParaCalculo[index] || ctesUnicos[index];
    const chaveCte = onlyDigits(pick(cteBase, ['chave_cte', 'chaveCte', 'chave']));
    const numeroCte = onlyDigits(pick(cteBase, ['numero_cte', 'numeroCte', 'cte', 'nro_cte']));
    const pesoOverride = Number(
      opcoesCalculo.pesosOverridePorChave?.[chaveCte]
      ?? opcoesCalculo.pesosOverridePorChave?.[numeroCte]
      ?? 0
    );
    const nfOverride = Number(
      opcoesCalculo.valorNfOverridePorChave?.[chaveCte]
      ?? opcoesCalculo.valorNfOverridePorChave?.[numeroCte]
      ?? 0
    );
    const trackingOverride = (
      opcoesCalculo.trackingOverridePorChave?.[chaveCte]
      ?? opcoesCalculo.trackingOverridePorChave?.[numeroCte]
      ?? null
    );
    const reentrega = Boolean(
      opcoesCalculo.reentregaPorChave?.[chaveCte]
      ?? opcoesCalculo.reentregaPorChave?.[numeroCte]
    );
    const cteComTrackingManual = trackingOverride
      ? {
        ...cteBase,
        chave_nfe: trackingOverride.chaveNfe || trackingOverride.chave_nfe || cteBase.chave_nfe,
        chaveNfe: trackingOverride.chaveNfe || trackingOverride.chave_nfe || cteBase.chaveNfe,
        nota_fiscal: trackingOverride.notaFiscal || trackingOverride.nota_fiscal || cteBase.nota_fiscal,
        notaFiscal: trackingOverride.notaFiscal || trackingOverride.nota_fiscal || cteBase.notaFiscal,
        valor_nf: Number(trackingOverride.valorNF || trackingOverride.valor_nf || cteBase.valor_nf || 0),
        valorNF: Number(trackingOverride.valorNF || trackingOverride.valor_nf || cteBase.valorNF || 0),
        peso: Number(trackingOverride.peso || trackingOverride.peso_declarado || cteBase.peso || 0),
        peso_declarado: Number(trackingOverride.pesoDeclarado || trackingOverride.peso_declarado || trackingOverride.peso || cteBase.peso_declarado || 0),
        pesoDeclarado: Number(trackingOverride.pesoDeclarado || trackingOverride.peso_declarado || trackingOverride.peso || cteBase.pesoDeclarado || 0),
        peso_cubado: Number(trackingOverride.pesoCubadoOriginal || trackingOverride.peso_cubado || cteBase.peso_cubado || 0),
        pesoCubado: Number(trackingOverride.pesoCubadoOriginal || trackingOverride.peso_cubado || cteBase.pesoCubado || 0),
        cubagem: Number(trackingOverride.cubagemFinal || trackingOverride.cubagem_total || trackingOverride.cubagemTotal || trackingOverride.cubagem || cteBase.cubagem || 0),
        cubagem_total: Number(trackingOverride.cubagemFinal || trackingOverride.cubagem_total || trackingOverride.cubagemTotal || cteBase.cubagem_total || 0),
        cubagemTotal: Number(trackingOverride.cubagemFinal || trackingOverride.cubagem_total || trackingOverride.cubagemTotal || cteBase.cubagemTotal || 0),
        qtd_volumes: Number(trackingOverride.qtdVolumes || trackingOverride.qtd_volumes || cteBase.qtd_volumes || 0),
        qtdVolumes: Number(trackingOverride.qtdVolumes || trackingOverride.qtd_volumes || cteBase.qtdVolumes || 0),
        canal: trackingOverride.canal || cteBase.canal,
        canal_original: trackingOverride.canal || cteBase.canal_original,
        cidade_origem: trackingOverride.cidadeOrigem || cteBase.cidade_origem,
        cidadeOrigem: trackingOverride.cidadeOrigem || cteBase.cidadeOrigem,
        uf_origem: trackingOverride.ufOrigem || cteBase.uf_origem,
        ufOrigem: trackingOverride.ufOrigem || cteBase.ufOrigem,
        ibge_origem: trackingOverride.ibgeOrigem || cteBase.ibge_origem,
        ibgeOrigem: trackingOverride.ibgeOrigem || cteBase.ibgeOrigem,
        cidade_destino: trackingOverride.cidadeDestino || cteBase.cidade_destino,
        cidadeDestino: trackingOverride.cidadeDestino || cteBase.cidadeDestino,
        uf_destino: trackingOverride.ufDestino || cteBase.uf_destino,
        ufDestino: trackingOverride.ufDestino || cteBase.ufDestino,
        ibge_destino: trackingOverride.ibgeDestino || cteBase.ibge_destino,
        ibgeDestino: trackingOverride.ibgeDestino || cteBase.ibgeDestino,
        codigo_ibge_destino: trackingOverride.ibgeDestino || cteBase.codigo_ibge_destino,
        trackingMatch: true,
        tracking_manual_nf: true,
      }
      : cteBase;
    const cteComNfManual = nfOverride > 0
      ? {
        ...cteComTrackingManual,
        valor_nf: nfOverride,
        valorNF: nfOverride,
      }
      : cteComTrackingManual;
    const cteParaMotor = pesoOverride > 0
      ? {
        ...cteComNfManual,
        peso: pesoOverride,
        peso_declarado: pesoOverride,
        pesoDeclarado: pesoOverride,
        peso_cubado: 0,
        pesoCubado: 0,
        cubagem: 0,
        cubagem_total: 0,
        cubagemTotal: 0,
      }
      : cteComNfManual;
    // Modo de peso do CT-e. Peso manual (pesoOverride) sempre tem prioridade.
    const modoPeso = modoPesoDoCte(cteBase);
    const pesoTracking = toNumber(cteParaMotor.peso_tracking);
    const aplicaModoTracking = modoPeso !== 'cte' && pesoOverride <= 0 && pesoTracking > 0 && cteParaMotor.trackingMatch;
    let cteFinal = cteParaMotor;
    let ignorarCubagemFinal = pesoOverride > 0 ? true : opcoesCalculo.ignorarCubagem;
    if (aplicaModoTracking) {
      // Peso cubado do proprio Tracking (cubagem final x 300), igual ao que a
      // tela de Tracking mostra; nao depende do fator cadastrado na tabela.
      // Cubagem total do Tracking x 300 (ex.: 1,008 -> 302,4). Nao usa a cubagem
      // enriquecida (pode vir multiplicada de novo pelos volumes) nem o
      // peso_cubado agregado (pode vir como a cubagem unitaria, 0,252).
      // Modo "Tracking com cubagem": maior entre o peso fisico do Tracking e a cubagem total do Tracking x FATOR DE
      // CUBAGEM DA TABELA da transportadora (ex.: TRANSLOVATO Serra = 200: 0,188 m3 -> 37,6 kg). Antes usava 300 fixo
      // (0,188 -> 56,4 kg), que nao bate com a tabela. O fator vem do proprio calculo da tabela (sonda com o peso fisico);
      // sem fator cadastrado, mantem 300. "Tracking, peso original" continua sem cubagem.
      const cubagemTracking = (toNumber(cteParaMotor.peso_cubado_tracking_300) / 300)
        || toNumber(cteParaMotor.cubagemTotal || cteParaMotor.cubagem_total || cteParaMotor.cubagem);
      let pesoModo = pesoTracking;
      if (modoPeso === 'tracking' && cubagemTracking > 0) {
        const sonda = processarCteComMotorSimulador(
          { ...cteParaMotor, peso: pesoTracking, peso_declarado: pesoTracking, pesoDeclarado: pesoTracking, peso_cubado: 0, pesoCubado: 0 },
          transportadoras, mapaVinculos, '', { ...opcoesCalculo, ignorarCubagem: true, percentualContingenciaPeso: 0 },
        );
        const fatorTabela = toNumber(sonda?.detalhes_calculo?.componentes_base?.fatorCubagem) || 300;
        pesoModo = Math.max(pesoTracking, Number((cubagemTracking * fatorTabela).toFixed(3)));
      }
      cteFinal = {
        ...cteParaMotor,
        peso: pesoModo,
        peso_declarado: pesoModo,
        pesoDeclarado: pesoModo,
        peso_cubado: 0,
        pesoCubado: 0,
        cubagem: 0,
        cubagem_total: 0,
        cubagemTotal: 0,
      };
      ignorarCubagemFinal = true;
    }
    const registroBase = calcularLotacaoOuFracionado(cteFinal, contextoLotacao, mapaVinculos, () => processarCte(cteFinal, transportadoras, mapaVinculos, '', {
      ...opcoesCalculo,
      ignorarCubagem: ignorarCubagemFinal,
      percentualContingenciaPeso: (pesoOverride > 0 || aplicaModoTracking) ? 0 : opcoesCalculo.percentualContingenciaPeso,
      pesoForcado: aplicaModoTracking,
    }));
    // A grade da fatura le `peso`; no modo Tracking ele precisa refletir o peso
    // realmente usado no calculo (cubado), nao so o peso fisico do Tracking.
    const pesoUsadoModo = toNumber(registroBase.detalhes_calculo?.peso_considerado);
    const registro = modoPeso === 'cte' ? registroBase : {
      ...registroBase,
      ...(aplicaModoTracking && pesoUsadoModo > 0 ? { peso: pesoUsadoModo } : {}),
      detalhes_calculo: {
        ...(registroBase.detalhes_calculo || {}),
        modo_peso_fatura: aplicaModoTracking ? modoPeso : 'cte_sem_tracking',
        peso_tracking_original: pesoTracking,
      },
    };
    if (reentrega && Number(registro.valor_calculado || 0) > 0) {
      const valorOriginal = Number(registro.valor_calculado || 0);
      const valorReentrega = Number((valorOriginal * 0.5).toFixed(2));
      registros.push({
        ...registro,
        valor_calculado: valorReentrega,
        diferenca: Number((Number(registro.valor_cte || 0) - valorReentrega).toFixed(2)),
        diferenca_abs: Math.abs(Number(registro.valor_cte || 0) - valorReentrega),
        percentual_diferenca: valorReentrega > 0 ? ((Number(registro.valor_cte || 0) - valorReentrega) / valorReentrega) * 100 : 0,
        motivo_sem_calculo: '',
        detalhes_calculo: {
          ...(registro.detalhes_calculo || {}),
          reentrega_manual: true,
          fator_reentrega: 0.5,
          valor_calculado_ida: valorOriginal,
          observacao_reentrega: 'CT-e marcado manualmente como reentrega: calculo AMD considerado em 50% do valor da ida.',
        },
      });
    } else {
      registros.push(registro);
    }
    // Comparar varias tabelas para um mesmo transportador aumenta bastante o
    // trabalho por CT-e. Devolver o controle ao navegador a cada registro
    // mantém a interface e o botao Cancelar responsivos durante lotes grandes.
    onProgress?.({ etapa: 'calculando_amd', carregados: index + 1, total: ctesUnicos.length });
    await cederThread();
    verificarCancelamento();
  }
  return { registros, encontrados: ctesUnicos.length, naoEncontrados: Math.max(0, normalizadas.length - ctesUnicos.length) };
}
