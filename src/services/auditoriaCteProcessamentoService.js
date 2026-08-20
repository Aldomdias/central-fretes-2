import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { buscarBaseSimulacaoPorRotasDb, carregarBaseCompletaDb, carregarBaseTransportadorasDb } from './freteDatabaseService';
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
import { resolverAliquotaIcmsUfContexto } from '../utils/icmsUfMatrix';
import { buscarTrackingParaRealizado, enriquecerRealizadoComTracking } from './realizadoTrackingEnrichment';
import { obterRaizCnpj } from '../utils/cnpj.js';
import { carregarMapaEquivalenciasOrigem } from './origemEquivalenciaService';
import { ibgesOrigemEquivalentes, origemAceitaPorExcecao } from '../utils/origemEquivalencia';

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

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
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
// em outra aba e quer resimular sem perder a busca/filtro atual na Auditoria).
// NÃO limpa o cache da base completa (_cacheBaseFrete) — recarregar TODAS as
// transportadoras do sistema é lento (usado só como fallback quando a busca
// direcionada por nome não acha a transportadora). Só o cache direcionado por
// transportadora é limpo, que é rápido e cobre o caso comum (1-5 transportadoras).
export function invalidarCacheBaseFreteAuditoriaCte() {
  _cacheBaseFretePorTransportadora.clear();
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
    .eq('chave_cte', chave);
  if (error) throw new Error(`Erro ao buscar resultado da auditoria: ${error.message}`);
  if (!data || !data.length) return null;
  return data.reduce((maisRecente, atual) => {
    if (!maisRecente) return atual;
    const tAtual = new Date(atual.updated_at || 0).getTime();
    const tRecente = new Date(maisRecente.updated_at || 0).getTime();
    return tAtual >= tRecente ? atual : maisRecente;
  }, null);
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
  if (canal.includes('ATACADO') || canal === 'B2B' || canal.includes(' B2B')) return 'ATACADO';
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
    || (tabela.length >= 5 && cte.includes(tabela))
    || (cte.length >= 5 && tabela.includes(cte));
}

function cidadeCompativel(cidadeTabela, cidadeCte) {
  const tabela = normalizeCompare(cidadeTabela);
  const cte = normalizeCompare(cidadeCte);

  if (!cte) return true;
  if (!tabela) return false;

  return tabela === cte
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

  const cotacoes = (origem?.cotacoes || []).filter((item) => {
    const rotaCotacao = normalizeCompare(item.rota);
    const rotaOk = !rotaCotacao
      || rotaCotacao === rotaNorm
      || rotaCotacao.includes(rotaNorm)
      || rotaNorm.includes(rotaCotacao)
      || (ufDestinoNorm && rotaCotacao === ufDestinoNorm)
      || (ibgePrefixo && rotaCotacao === ibgePrefixo);

    if (!rotaOk) return false;

    const pesoMin = toNumber(item.pesoMin ?? item.peso_min ?? 0);
    const pesoMaxRaw = item.pesoMax ?? item.pesoLimite ?? item.peso_max ?? item.peso_limite;
    const pesoMax = pesoMaxRaw === '' || pesoMaxRaw === null || pesoMaxRaw === undefined
      ? Number.POSITIVE_INFINITY
      : toNumber(pesoMaxRaw);

    return pesoFinal >= pesoMin && pesoFinal <= (pesoMax || Number.POSITIVE_INFINITY);
  });

  if (!cotacoes.length) return null;

  return cotacoes.sort((a, b) => (
    toNumber(a.pesoMax ?? a.pesoLimite ?? a.peso_max ?? a.peso_limite)
    - toNumber(b.pesoMax ?? b.pesoLimite ?? b.peso_max ?? b.peso_limite)
  ))[0];
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

function inferirAliquotaIcmsAuditoria(origem = {}, rota = {}, cte = {}) {
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
    transportadora: nomeTransportadoraCte(cte),
    cidadeOrigem: pick(cte, ['cidade_origem', 'origem']),
    canal: pick(cte, ['canal', 'canal_original']),
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

export function normalizarTransportadoras(transportadoras = []) {
  return (transportadoras || []).map((transportadora) => ({
    ...transportadora,
    __nomeNorm: normalizeTransportadoraCompare(transportadora.nome),
    __cnpjRaiz: obterRaizCnpj(transportadora.cnpjRaiz || transportadora.cnpj),
    origens: (transportadora.origens || []).map((origem) => ({
      ...origem,
      __cidadeNorm: normalizeCompare(origem.cidade),
      rotas: origem.rotas || [],
      cotacoes: origem.cotacoes || [],
      taxasEspeciais: origem.taxasEspeciais || [],
    })),
  }));
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
  const routeKeys = routeKeysRegistros(registros);
  if (routeKeys.length > 0 && routeKeys.length <= 2500 && !(transportadorasAlvo || []).length) {
    onProgress?.({ etapa: 'carregando_tabelas_rotas', carregados: 0, total: routeKeys.length });
    const baseRotas = normalizarTransportadoras(await buscarBaseSimulacaoPorRotasDb({
      routeKeys,
      onProgress: (carregados, total) => onProgress?.({ etapa: 'carregando_tabelas_rotas', carregados, total }),
    }));
    if (baseRotas.length) return baseRotas;
  }

  const nomes = (transportadorasAlvo || []).length
    ? Array.from(new Set((transportadorasAlvo || []).map((nome) => aplicarVinculoTransportadora(nome, mapaVinculos) || nome).map((nome) => String(nome || '').trim()).filter(Boolean)))
    : nomesTransportadorasRegistros(registros, mapaVinculos);

  if (nomes.length > 0 && nomes.length <= 5) {
    const cacheKey = nomes.map((nome) => normalizeTransportadoraCompare(nome)).sort().join('|');
    if (!_cacheBaseFretePorTransportadora.has(cacheKey)) {
      onProgress?.({ etapa: 'carregando_tabelas_transportadora', carregados: 0, total: nomes.length });
      const base = normalizarTransportadoras(await carregarBaseTransportadorasDb(nomes));
      if (base.length) {
        _cacheBaseFretePorTransportadora.set(cacheKey, base);
      } else {
        onProgress?.({ etapa: 'carregando_tabelas_completas_fallback', carregados: 0, total: null });
        if (!_cacheBaseFrete) {
          _cacheBaseFrete = normalizarTransportadoras(await carregarBaseCompletaDb(onProgress));
        }
        return _cacheBaseFrete;
      }
    }
    return _cacheBaseFretePorTransportadora.get(cacheKey);
  }

  onProgress?.({ etapa: 'carregando_tabelas', carregados: 0, total: registros.length });
  if (!_cacheBaseFrete) {
    _cacheBaseFrete = normalizarTransportadoras(await carregarBaseCompletaDb(onProgress));
  }
  return _cacheBaseFrete;
}

function localizarTransportadoras(transportadoras = [], nomeCte = '', cnpjCte = '') {
  const raizCte = obterRaizCnpj(cnpjCte);
  if (raizCte) {
    const porCnpj = transportadoras.filter((item) => item.__cnpjRaiz === raizCte);
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

function localizarTabelaAuditoria(transportadoras = [], cte = {}, mapaVinculos = null, transportadoraAlvo = '') {
  const transportadoraNome = transportadoraAlvo || nomeTransportadoraCte(cte, mapaVinculos);
  const cnpjTransportadora = pick(cte, ['cnpj_transportadora', 'cnpjTransportadora', 'cnpj_transportador']);
  const candidatasTransportadora = localizarTransportadoras(transportadoras, transportadoraNome, cnpjTransportadora);
  if (!candidatasTransportadora.length) return { status: 'SEM_TABELA' };

  const tentativas = [];
  const peso = pesoCte(cte);

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

function processarCteComMotorSimulador(cte, transportadoras = [], mapaVinculos = null, transportadoraAlvo = '', opcoes = {}) {
  const transportadoraTabela = transportadoraAlvo || nomeTransportadoraCte(cte, mapaVinculos);
  if (!transportadoraTabela) return null;

  const { cidadePorIbge } = buildLookupTables(transportadoras);
  const canalOriginal = normalizarCanalResultado(pick(cte, ['canal', 'canal_original']));
  const canaisTentativa = canalOriginal === 'A DEFINIR'
    ? ['ATACADO', 'B2C', '']
    : [pick(cte, ['canal', 'canal_original']) || '', ''];

  let detalhe = null;
  let calculoInvertido = false;
  const tentativasCte = [cte, inverterOrigemDestinoCte(cte)];
  for (let tentativaIndex = 0; tentativaIndex < tentativasCte.length && !detalhe; tentativaIndex += 1) {
    const cteTentativa = tentativasCte[tentativaIndex];
    for (const canal of canaisTentativa) {
      const linha = cteParaLinhaSimulador(cteTentativa, transportadoraTabela, canal);
      const resultado = simularRealizadoPorTransportadora({
        transportadoras,
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

  return {
    ...base,
    valor_calculado: valorCalculado,
    diferenca,
    diferenca_abs: diferencaAbs,
    percentual_diferenca: percentualDiferenca,
    motivo_sem_calculo: '',
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
      const cteComPesoCubado = {
        ...cte,
        peso: pesoCubadoCalculado,
        peso_declarado: pesoCubadoCalculado,
        pesoDeclarado: pesoCubadoCalculado,
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
  const usarMelhor = melhor && melhor.diferenca_abs + 0.0001 < diferencaAtual;
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

export function processarCte(cte, transportadoras = [], mapaVinculos = null, transportadoraAlvo = '', opcoes = {}) {
  const resultadoSimulador = processarCteComMotorSimulador(cte, transportadoras, mapaVinculos, transportadoraAlvo, opcoes);
  if (resultadoSimulador) return anexarComparativoPesos(resultadoSimulador, cte, transportadoras, mapaVinculos, transportadoraAlvo, opcoes);

  const tabelaDireta = localizarTabelaAuditoria(transportadoras, cte, mapaVinculos, transportadoraAlvo);
  const tabelaInvertida = tabelaDireta.status === 'OK'
    ? null
    : localizarTabelaAuditoria(transportadoras, inverterOrigemDestinoCte(cte), mapaVinculos, transportadoraAlvo);
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
  const icmsInfo = inferirAliquotaIcmsAuditoria(origem, rota, cteCalculo);
  const documentoDestinatario = pickDigits(cteCalculo, ['documento_destinatario', 'documentoDestinatario', 'cnpj_destinatario'], 14);
  const generalidades = {
    ...(origem.generalidades || {}),
    aliquotaIcms: icmsInfo.aliquota,
    tde: transportadora?.tde ?? 0,
    tdeCnpjs: Array.isArray(transportadora?.tdeCnpjs) ? transportadora.tdeCnpjs : [],
  };

  try {
    const calculo = tipoCalculo === 'FAIXA_DE_PESO'
      ? calcularFreteFaixaPeso({ rota, cotacao, generalidades, taxaDestino, pesoKg: peso, valorNf, documentoDestinatario })
      : calcularFretePercentual({ rota, cotacao, generalidades, taxaDestino, pesoKg: peso, valorNf, documentoDestinatario });

    const base = montarResultadoBase(cte, 'CALCULADO', '', {
      transportadora_tabela: transportadora.nome,
      tipo_calculo: tipoCalculo,
      detalhes_calculo: {
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

    return {
      ...base,
      valor_calculado: valorCalculado,
      diferenca,
      diferenca_abs: diferencaAbs,
      percentual_diferenca: percentualDiferenca,
      motivo_sem_calculo: '',
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
export async function resimularRegistros({ registros, transportadorasAlvo, onProgress, ignorarCubagem = true, percentualContingenciaPeso = 0, apenasDadosCompletos = true } = {}) {
  if (!Array.isArray(registros) || !registros.length) return [];

  const registrosParaCalcular = apenasDadosCompletos
    ? registros
    : await enriquecerCtesComTrackingAoVivo(registros, onProgress);

  const mapaVinculos = await carregarMapaVinculosAuditoria();
  await precarregarEquivalenciasOrigemAuditoria();
  const transportadoras = await carregarBaseFreteParaRegistros(registrosParaCalcular, onProgress, transportadorasAlvo, mapaVinculos);
  const alvosNormalizados = Array.from(new Set(
    (transportadorasAlvo || [])
      .map((nome) => aplicarVinculoTransportadora(nome, mapaVinculos) || nome)
      .map((nome) => String(nome || '').trim())
      .filter(Boolean)
  ));
  const transportadoraAlvo = alvosNormalizados.length === 1 ? alvosNormalizados[0] : '';

  if (!transportadoras.length) {
    throw new Error('Nenhuma tabela de frete cadastrada foi encontrada para resimular.');
  }

  const out = [];
  for (let index = 0; index < registros.length; index += 1) {
    const original = registros[index] || {};
    const paraCalculo = registrosParaCalcular[index] || original;
    const novo = processarCte(paraCalculo, transportadoras, mapaVinculos, transportadoraAlvo, { ignorarCubagem, percentualContingenciaPeso });

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
      await new Promise((resolve) => setTimeout(resolve, 0));
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
      await new Promise((resolve) => setTimeout(resolve, 350 * (tentativa + 1)));
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

export async function enriquecerCtesComFaturas(registros = []) {
  if (!registros.length) return registros;
  const supabase = ensureSupabase();
  const somenteDigitos = (valor) => String(valor || '').replace(/\D/g, '');
  const chaves = [...new Set(registros.map((r) => somenteDigitos(r.chave_cte)).filter(Boolean))];
  const numeros = [...new Set(registros.filter((r) => !somenteDigitos(r.chave_cte)).map((r) => somenteDigitos(r.numero_cte)).filter(Boolean))];
  const detalhes = [];
  for (let inicio = 0; inicio < chaves.length; inicio += 100) {
    const { data, error } = await supabase.from('fatura_detalhes').select('fatura_id,chave_cte,numero_cte').in('chave_cte', chaves.slice(inicio, inicio + 100));
    if (!error) detalhes.push(...(data || []));
  }
  for (let inicio = 0; inicio < numeros.length; inicio += 100) {
    const { data, error } = await supabase.from('fatura_detalhes').select('fatura_id,chave_cte,numero_cte').in('numero_cte', numeros.slice(inicio, inicio + 100));
    if (!error) detalhes.push(...(data || []));
  }
  const ids = [...new Set(detalhes.map((item) => item.fatura_id).filter(Boolean))];
  const faturas = [];
  for (let inicio = 0; inicio < ids.length; inicio += 100) {
    const { data, error } = await supabase.from('faturas').select('id,numero_fatura,status').in('id', ids.slice(inicio, inicio + 100));
    if (!error) faturas.push(...(data || []));
  }
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
      faturas_vinculadas: lista,
      numeros_fatura: lista.map((fatura) => fatura.numero_fatura).filter(Boolean),
      transportadora_validada_atual: validacaoAtual?.validada,
      validacao_origens_atual: validacaoAtual || null,
      auditor_nome_carteira: carteiraAtual?.auditor_nome || '',
      auditor_email_carteira: carteiraAtual?.auditor_email || '',
    };
  });
}

export async function carregarResultadosAuditoriaMes({ competencia, dataInicio, dataFim, limite, canais, transportadoras, colunas = '*', onProgress } = {}) {
  const temPeriodo = Boolean(dataInicio || dataFim);
  if (!competencia && !temPeriodo) {
    throw new Error('Informe a competência ou um período para carregar o resultado salvo.');
  }

  const supabase = ensureSupabase();
  const acumulado = [];
  let from = 0;
  const teto = Number(limite) > 0 ? Number(limite) : Infinity;

  while (true) {
    let query = supabase
      .from(TABELA_RESULTADOS)
      .select(colunas);

    // Por período (datas), consulta direto por data_emissao e ignora a competência
    // (pode cruzar meses). Sem período, filtra pela competência do mês.
    if (temPeriodo) {
      if (dataInicio) query = query.gte('data_emissao', dataInicio);
      if (dataFim) query = query.lte('data_emissao', dataFim);
    } else {
      query = query.eq('competencia', competencia);
    }

    if (transportadoras?.length) {
      query = query.in('transportadora', transportadoras);
    }

    const { data, error } = await query
      .order('data_emissao', { ascending: true, nullsFirst: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Erro ao carregar auditoria salva: ${error.message}`);

    const lote = data || [];
    acumulado.push(...lote);
    onProgress?.({ etapa: 'carregando_resultado_salvo', carregados: acumulado.length, total: null });

    if (lote.length < PAGE_SIZE || acumulado.length >= teto) break;
    from += PAGE_SIZE;
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
  const resultado = [];
  const tamanhoLote = 20;
  onProgress?.({ etapa: 'cruzando_tracking', carregados: 0, total });

  for (let inicio = 0; inicio < ctes.length; inicio += tamanhoLote) {
    const loteCtes = ctes.slice(inicio, inicio + tamanhoLote);
    const linhas = loteCtes.map(montarLinha);
    let linhasEnriquecidas = linhas;
    try {
      const mapasTracking = await withTimeout(
        buscarTrackingParaRealizado(linhas),
        8000,
        `Tracking lote ${Math.floor(inicio / tamanhoLote) + 1}`,
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

    loteCtes.forEach((cte, index) => {
      const enriquecida = linhasEnriquecidas[index] || {};
      resultado.push({
        ...cte,
        trackingMatch: enriquecida.trackingMatch || cte.trackingMatch,
        peso_declarado: enriquecida.pesoDeclarado || cte.peso_declarado,
        peso_cubado: enriquecida.pesoCubado || cte.peso_cubado,
        cubagem: enriquecida.cubagemTotal || cte.cubagem,
        cubagemTotal: enriquecida.cubagemTotal || cte.cubagemTotal,
        documento_destinatario: enriquecida.documentoDestinatario || cte.documento_destinatario || '',
      });
    });

    onProgress?.({ etapa: 'cruzando_tracking', carregados: Math.min(inicio + tamanhoLote, total), total });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return resultado;
}

export async function processarESalvarAuditoriaMes({ competencia, dataInicio, dataFim, canais, onProgress, ignorarCubagem = true, percentualContingenciaPeso = 0, apenasDadosCompletos = true } = {}) {
  if (!competencia && !(dataInicio || dataFim)) {
    throw new Error('Informe a competência ou um período para processar a auditoria.');
  }

  const supabase = ensureSupabase();
  const mapaVinculos = await carregarMapaVinculosAuditoria();
  await precarregarEquivalenciasOrigemAuditoria();

  if (!ctesUnicos.length) {
    return { registros: [], encontrados: 0, naoEncontrados: normalizadas.length };
  }

  onProgress?.({ etapa: 'carregando_tabelas', carregados: 0, total: null });
  if (!_cacheBaseFrete) {
    // heartbeat enquanto carrega (lookup de CEP→IBGE pode demorar)
    let _tick = 0;
    const _hb = setInterval(() => { _tick += 1; onProgress?.({ etapa: 'carregando_tabelas', carregados: _tick, total: null }); }, 600);
    try {
      _cacheBaseFrete = normalizarTransportadoras(await carregarBaseCompletaDb(onProgress));
    } finally {
      clearInterval(_hb);
    }
  }
  const transportadoras = _cacheBaseFrete;

  if (!transportadoras.length) {
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

  for (let index = 0; index < ctes.length; index += 1) {
    registros.push(processarCte(ctes[index], transportadoras, mapaVinculos, '', { ignorarCubagem, percentualContingenciaPeso }));

    if (index % 500 === 0 || index === ctes.length - 1) {
      onProgress?.({ etapa: 'processando_ctes', carregados: index + 1, total: ctes.length });
      await new Promise((resolve) => setTimeout(resolve, 0));
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
  const normalizadas = [...new Set((chaves || []).map((c) => onlyDigits(c)).filter(Boolean))];
  if (!normalizadas.length) return { registros: [], encontrados: 0, naoEncontrados: 0 };
  const chavesCte = normalizadas.filter((valor) => valor.length >= 20);
  const numerosCte = normalizadas.filter((valor) => valor.length < 20);

  const supabase = ensureSupabase();
  const mapaVinculos = await carregarMapaVinculosAuditoria();
  await precarregarEquivalenciasOrigemAuditoria();

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

  onProgress?.({ etapa: 'carregando_tabelas', carregados: 0, total: null });
  const transportadoras = await carregarBaseFreteParaRegistros(ctesUnicos, onProgress, [], mapaVinculos);
  if (!transportadoras.length) {
    throw new Error('Nenhuma tabela de frete cadastrada foi encontrada para recalcular.');
  }

  const deveConsultarTracking = opcoesCalculo.apenasDadosCompletos === false && opcoesCalculo.consultarTrackingAoVivo !== false;
  const ctesParaCalculo = deveConsultarTracking
    ? await enriquecerCtesComTrackingAoVivo(ctesUnicos, onProgress)
    : ctesUnicos.map((cte) => ({ ...cte, trackingNaoConsultado: opcoesCalculo.apenasDadosCompletos === false }));
  onProgress?.({ etapa: 'calculando_amd', carregados: 0, total: ctesUnicos.length });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const registros = [];
  for (let index = 0; index < ctesUnicos.length; index += 1) {
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
    const registro = processarCte(cteParaMotor, transportadoras, mapaVinculos, '', {
      ...opcoesCalculo,
      ignorarCubagem: pesoOverride > 0 ? true : opcoesCalculo.ignorarCubagem,
      percentualContingenciaPeso: pesoOverride > 0 ? 0 : opcoesCalculo.percentualContingenciaPeso,
    });
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
    if (index % 25 === 0 || index === ctesUnicos.length - 1) {
      onProgress?.({ etapa: 'calculando_amd', carregados: index + 1, total: ctesUnicos.length });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return { registros, encontrados: ctesUnicos.length, naoEncontrados: Math.max(0, normalizadas.length - ctesUnicos.length) };
}
