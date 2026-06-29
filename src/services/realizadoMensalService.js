import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { resolverCubagemTracking } from '../utils/trackingCubagem';
import { carregarMunicipiosIbgeDb } from './freteDatabaseService';
import { carregarAliasesCidadeIbge } from './cidadeIbgeAliasService';
import { carregarMunicipiosIbgeOficial } from '../utils/ibgeMunicipiosOficial';
import { compactarCidadeIbge, normalizarCidadeIbge, resolverIbgeComRegras } from '../utils/ibgeCidadeMatch';

const TMP_CHUNK_SIZE = 1000;
const TMP_INSERT_RETRIES = 3;
const TMP_RETRY_DELAY_MS = 900;
const PROCESSAMENTO_LIMITE_LOTE = 1500;
const PROCESSAMENTO_LIMITE_LOTE_ENXUTA = 25;
const PROCESSAMENTO_LIMITE_MIN = 100;
const PROCESSAMENTO_LIMITE_MIN_ENXUTA = 5;
const PROCESSAMENTO_MAX_LOOPS = 6000;
const PROCESSAMENTO_RPC_RETRIES = 8;
const PROCESSAMENTO_RPC_TIMEOUT_MS = 120000;
const PROCESSAMENTO_RPC_TIMEOUT_ENXUTA_MS = 150000;
const PROCESSAMENTO_RETRY_DELAY_MS = 1500;
const PROCESSAMENTO_ENTRE_LOTES_MS = 150;
const PROCESSAMENTO_HEARTBEAT_MS = 3000;

/** A tela CT-e e o Simulador usam realizado_local_ctes. A enxuta no Supabase é opcional e a RPC costuma estourar timeout em meses grandes. */
export const ENXUTA_AUTOMATICA_NO_IMPORT = false;
const RESET_LIMITE_LOTE = 10000;
const RESET_MAX_LOOPS = 80;
const CHAVE_LOOKUP_PAGE = 1000;
const TMP_PARA_LOCAL_PAGE = 800;
const TMP_PARA_LOCAL_INSERT = 100;
const TMP_PARA_LOCAL_CHAVE_CHUNK = 200;

function ehTimeoutDb(msg = '') {
  const t = String(msg || '').toLowerCase();
  return t.includes('statement timeout') || t.includes('canceling statement') || t.includes('timeout');
}

// Grava um lote na base oficial com upsert; se o Postgres cortar por
// statement timeout, divide o lote pela metade e tenta de novo (recursivo),
// até conseguir. Assim a importação não aborta — só fatia mais fino.
async function gravarLocalComRetry(supabase, payload) {
  if (!payload.length) return;

  const { error } = await supabase
    .from('realizado_local_ctes')
    .upsert(payload, { onConflict: 'chave_cte', ignoreDuplicates: false });

  if (!error) return;

  if (ehTimeoutDb(error.message) && payload.length > 1) {
    const meio = Math.ceil(payload.length / 2);
    await gravarLocalComRetry(supabase, payload.slice(0, meio));
    await gravarLocalComRetry(supabase, payload.slice(meio));
    return;
  }

  throw new Error(`Erro ao gravar base oficial. Detalhe: ${error.message}`);
}
const TRACKING_IMPORT_CHUNK = 50;

function ensureSupabase() {
  const client = getSupabaseClient();
  if (!client || !isSupabaseConfigured()) {
    throw new Error('Supabase não configurado. Confira VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no Vercel.');
  }
  return client;
}

function toSafeNumber(value, max = 999999999999) {
  let number = 0;
  if (value !== null && value !== undefined && value !== '') {
    if (typeof value === 'number') {
      number = value;
    } else {
      let text = String(value).trim();
      text = text.replace(/R\$|%/gi, '').replace(/\s+/g, '');
      const hasComma = text.includes(',');
      const hasDot = text.includes('.');
      if (hasComma && hasDot) {
        text = text.replace(/\./g, '').replace(',', '.');
      } else if (hasComma) {
        text = text.replace(',', '.');
      } else if (hasDot) {
        const parts = text.split('.');
        const pareceMilhar = parts.length > 1 && parts.slice(1).every((part) => part.length === 3);
        if (pareceMilhar) text = parts.join('');
      }
      number = Number(text.replace(/[^0-9.-]/g, ''));
    }
  }
  if (!Number.isFinite(number)) return 0;
  if (number > max) return max;
  if (number < -max) return -max;
  return number;
}

function cleanText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function cleanUf(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
}

function cleanDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

let resolvedorIbgeImportacaoPromise = null;

function montarIndiceIbgeImportacao(municipios = []) {
  const porChave = new Map();
  const porCompacto = new Map();

  for (const item of municipios || []) {
    const ibge = cleanDigits(item.ibge || item.codigo_ibge || item.codigo).slice(0, 7);
    const cidade = item.cidade || item.nome || item.municipio || '';
    const uf = cleanUf(item.uf || item.estado || '');
    if (!ibge || !cidade) continue;

    const c = normalizarCidadeIbge(cidade);
    const comp = compactarCidadeIbge(cidade);
    const cUf = uf ? normalizarCidadeIbge(`${cidade}/${uf}`) : '';
    const compUf = uf ? compactarCidadeIbge(`${cidade}/${uf}`) : '';

    if (c && !porChave.has(c)) porChave.set(c, ibge);
    if (cUf && !porChave.has(cUf)) porChave.set(cUf, ibge);
    if (comp && !porCompacto.has(comp)) porCompacto.set(comp, ibge);
    if (compUf && !porCompacto.has(compUf)) porCompacto.set(compUf, ibge);
  }

  return { porChave, porCompacto };
}

async function carregarResolvedorIbgeImportacao() {
  if (!resolvedorIbgeImportacaoPromise) {
    resolvedorIbgeImportacaoPromise = (async () => {
      let municipios = [];
      try {
        const oficial = await carregarMunicipiosIbgeOficial({ usarCache: true });
        municipios = oficial?.municipios || [];
      } catch {
        municipios = [];
      }

      const db = await carregarMunicipiosIbgeDb().catch(() => []);
      if (db.length > municipios.length) municipios = db;

      const indice = montarIndiceIbgeImportacao(municipios);

      try {
        const aliases = await carregarAliasesCidadeIbge();
        for (const alias of aliases || []) {
          const ibge = cleanDigits(alias.ibge).slice(0, 7);
          const cidade = alias.cidade || '';
          const uf = cleanUf(alias.uf);
          if (!ibge || !cidade) continue;

          const c = normalizarCidadeIbge(cidade);
          const comp = compactarCidadeIbge(cidade);
          if (c) indice.porChave.set(c, ibge);
          if (uf) indice.porChave.set(normalizarCidadeIbge(`${cidade}/${uf}`), ibge);
          if (comp) indice.porCompacto.set(comp, ibge);
          if (uf) indice.porCompacto.set(compactarCidadeIbge(`${cidade}/${uf}`), ibge);
        }
      } catch {
        // Aliases sao reforco; a importacao pode seguir com a base oficial/DB.
      }

      return (cidade, uf) => resolverIbgeComRegras(
        cidade,
        uf,
        (chave) => indice.porChave.get(chave) || '',
        (chave) => indice.porCompacto.get(chave) || '',
      );
    })();
  }

  return resolvedorIbgeImportacaoPromise;
}

async function aplicarIbgeImportacao(row = {}, resolverIbge = null) {
  const resolver = resolverIbge || await carregarResolvedorIbgeImportacao();
  const ibgeOrigem = cleanDigits(row.ibge_origem).slice(0, 7)
    || resolver(row.cidade_origem, row.uf_origem);
  const ibgeDestino = cleanDigits(row.ibge_destino).slice(0, 7)
    || resolver(row.cidade_destino, row.uf_destino);

  return {
    ...row,
    ibge_origem: ibgeOrigem,
    ibge_destino: ibgeDestino,
  };
}

function cidadeSemUf(cidade = '', uf = '') {
  let texto = cleanText(cidade);
  const ufLimpa = cleanUf(uf);
  texto = texto.replace(/\s*\/\s*[A-Za-z]{2}\s*$/i, '');
  texto = texto.replace(/\s*-\s*[A-Za-z]{2}\s*$/i, '');
  if (ufLimpa) texto = texto.replace(new RegExp(`\\s+${ufLimpa}$`, 'i'), '');
  return cleanText(texto);
}

function getPesoFinal(row = {}) {
  const declarado = toSafeNumber(row.pesoDeclarado ?? row.peso_declarado);
  const cubado = toSafeNumber(row.pesoCubado ?? row.peso_cubado);
  const peso = toSafeNumber(row.peso);
  return Math.max(declarado, cubado, peso, 0);
}

function getCubagem(row = {}) {
  const metros = toSafeNumber(row.metrosCubicos ?? row.metros_cubicos);
  const cubagem = toSafeNumber(row.cubagem);
  return metros > 0 ? metros : cubagem;
}

function getVolumes(row = {}) {
  return toSafeNumber(row.volume ?? row.qtdVolumes ?? row.qtd_volumes);
}

function getChaveCte(row = {}) {
  const chave = cleanDigits(row.chaveCte ?? row.chave_cte);
  if (chave) return chave;

  const fallback = [row.numeroCte ?? row.numero_cte, row.emissao ?? row.data_emissao, row.transportadora, row.cidadeOrigem ?? row.cidade_origem, row.cidadeDestino ?? row.cidade_destino, row.valorCte ?? row.valor_cte]
    .map((item) => cleanText(item).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-'))
    .filter(Boolean)
    .join('-')
    .slice(0, 180);

  return fallback ? `cte-sem-chave-${fallback}` : '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function insertChunkWithRetry({ supabase, chunk, tentativa = 1 }) {
  const { error } = await supabase.from('realizado_ctes_import_tmp').insert(chunk);
  if (!error) return;

  const mensagem = String(error.message || error.details || '').toLowerCase();
  const podeTentarNovamente = tentativa < TMP_INSERT_RETRIES && (mensagem.includes('timeout') || mensagem.includes('canceling statement') || mensagem.includes('network') || mensagem.includes('fetch') || mensagem.includes('temporarily'));
  if (!podeTentarNovamente) throw error;

  await sleep(TMP_RETRY_DELAY_MS * tentativa);
  return insertChunkWithRetry({ supabase, chunk, tentativa: tentativa + 1 });
}

async function rpcOpcional(supabase, nome, args = {}) {
  const { data, error } = await supabase.rpc(nome, args);
  if (error) {
    const msg = String(error.message || '').toLowerCase();
    const funcaoNaoExiste = msg.includes('could not find') || msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('function');
    if (funcaoNaoExiste) return { data: null, error, disponivel: false };
    throw error;
  }
  return { data, error: null, disponivel: true };
}

async function safeCountByCompetencia(supabase, tabela, coluna, competencia) {
  const { count, error } = await supabase.from(tabela).select(coluna, { count: 'exact', head: true }).eq('competencia', competencia);
  if (error) return 0;
  return count || 0;
}

async function contarTemporariaPorArquivo({ supabase, competencia, arquivoOrigem }) {
  if (!arquivoOrigem) return 0;
  const { count, error } = await supabase.from('realizado_ctes_import_tmp').select('id', { count: 'exact', head: true }).eq('competencia', competencia).eq('arquivo_origem', arquivoOrigem);
  if (error) return 0;
  return count || 0;
}

async function listarChavesCteCompetencia(supabase, competencia, onProgress) {
  const chaves = new Set();
  let offset = 0;
  let totalConsultado = 0;

  while (true) {
    const { data, error } = await supabase
      .from('realizado_local_ctes')
      .select('chave_cte')
      .eq('competencia', competencia)
      .order('chave_cte', { ascending: true })
      .range(offset, offset + CHAVE_LOOKUP_PAGE - 1);

    if (error) throw new Error(`Erro ao consultar chaves existentes. Detalhe: ${error.message}`);

    const rows = data || [];
    rows.forEach((row) => {
      const chave = cleanDigits(row.chave_cte);
      if (chave) chaves.add(chave);
    });

    totalConsultado += rows.length;
    onProgress?.({
      etapa: 'filtro',
      mensagem: `Consultando chaves na base: ${totalConsultado.toLocaleString('pt-BR')} registro(s) lidos...`,
    });

    if (rows.length < CHAVE_LOOKUP_PAGE) break;
    offset += CHAVE_LOOKUP_PAGE;
    await sleep(10);
  }

  return chaves;
}

function filtrarRegistrosPorChaveExistente(registros = [], chavesExistentes = new Set()) {
  const stats = { lidos: registros.length, jaNaBase: 0, novos: 0, semChave: 0, atualizados: 0, erros: 0 };
  const novos = [];

  registros.forEach((row) => {
    const chave = getChaveCte(row);
    if (!chave) {
      stats.semChave += 1;
      novos.push(row);
      stats.novos += 1;
      return;
    }
    if (chavesExistentes.has(chave)) {
      stats.jaNaBase += 1;
      return;
    }
    novos.push(row);
    stats.novos += 1;
  });

  return { novos, stats };
}

export function montarLinhaTemporariaRealizado(row = {}, competencia = '', arquivoOrigem = '') {
  const ufOrigem = cleanUf(row.ufOrigem ?? row.uf_origem);
  const ufDestino = cleanUf(row.ufDestino ?? row.uf_destino);
  const valorCte = toSafeNumber(row.valorCte ?? row.valor_cte);
  const valorCalculado = toSafeNumber(row.valorCalculado ?? row.valor_calculado);
  const diferencaInformada = row.diferenca ?? row.diferenca_calculada;
  const diferenca = diferencaInformada !== undefined && diferencaInformada !== null && String(diferencaInformada).trim() !== '' ? toSafeNumber(diferencaInformada) : (valorCalculado > 0 ? valorCte - valorCalculado : 0);

  return {
    competencia,
    arquivo_origem: cleanText(arquivoOrigem || row.arquivoOrigem || row.arquivo_origem),
    data_emissao: row.emissao || row.dataEmissao || row.data_emissao || null,
    chave_cte: getChaveCte(row),
    numero_cte: cleanText(row.numeroCte ?? row.numero_cte),
    transportadora: cleanText(row.transportadora),
    cnpj_transportadora: cleanDigits(row.cnpjTransportadora ?? row.cnpj_transportadora),
    tomador_servico: cleanText(row.tomadorServico ?? row.tomador_servico),
    cidade_origem: cidadeSemUf(row.cidadeOrigem ?? row.cidade_origem, ufOrigem),
    uf_origem: ufOrigem,
    cidade_destino: cidadeSemUf(row.cidadeDestino ?? row.cidade_destino, ufDestino),
    uf_destino: ufDestino,
    ibge_origem: cleanDigits(row.ibgeOrigem ?? row.ibge_origem).slice(0, 7),
    ibge_destino: cleanDigits(row.ibgeDestino ?? row.ibge_destino).slice(0, 7),
    peso: getPesoFinal(row),
    peso_declarado: toSafeNumber(row.pesoDeclarado ?? row.peso_declarado),
    peso_cubado: toSafeNumber(row.pesoCubado ?? row.peso_cubado),
    cubagem: getCubagem(row),
    valor_nf: toSafeNumber(row.valorNF ?? row.valor_nf),
    valor_cte: valorCte,
    valor_calculado: valorCalculado,
    diferenca,
    situacao: cleanText(row.situacao),
    status: cleanText(row.status),
    status_conciliacao: cleanText(row.statusConciliacao ?? row.status_conciliacao),
    status_erp: cleanText(row.statusErp ?? row.status_erp),
    percentual_frete: toSafeNumber(row.percentualFrete ?? row.percentual_frete),
    qtd_volumes: getVolumes(row),
    canal: cleanText(row.canal || row.canalVendas || row.canais),
    raw: row.raw || row || {},
  };
}

export function validarRegistrosRealizadoMensal(registros = []) {
  const resumo = { total: registros.length, semChave: 0, semTransportadora: 0, semOrigem: 0, semDestino: 0, semUfOrigem: 0, semUfDestino: 0, semPeso: 0, semValorCte: 0, semValorNf: 0, semCanal: 0, semValorCalculado: 0, comValorCalculado: 0 };
  registros.forEach((row) => {
    if (!getChaveCte(row)) resumo.semChave += 1;
    if (!cleanText(row.transportadora)) resumo.semTransportadora += 1;
    if (!cleanText(row.cidadeOrigem ?? row.cidade_origem)) resumo.semOrigem += 1;
    if (!cleanText(row.cidadeDestino ?? row.cidade_destino)) resumo.semDestino += 1;
    if (!cleanUf(row.ufOrigem ?? row.uf_origem)) resumo.semUfOrigem += 1;
    if (!cleanUf(row.ufDestino ?? row.uf_destino)) resumo.semUfDestino += 1;
    if (getPesoFinal(row) <= 0) resumo.semPeso += 1;
    if (toSafeNumber(row.valorCte ?? row.valor_cte) <= 0) resumo.semValorCte += 1;
    if (toSafeNumber(row.valorNF ?? row.valor_nf) <= 0) resumo.semValorNf += 1;
    if (!cleanText(row.canal || row.canalVendas || row.canais)) resumo.semCanal += 1;
    if (toSafeNumber(row.valorCalculado ?? row.valor_calculado) > 0) resumo.comValorCalculado += 1;
    else resumo.semValorCalculado += 1;
  });
  return resumo;
}

export async function verificarCompetenciaRealizadoMensal(competencia) {
  const supabase = ensureSupabase();
  try {
    const resposta = await rpcOpcional(supabase, 'status_realizado_cte_competencia_fast', { p_competencia: competencia });
    if (resposta.disponivel && resposta.data) return resposta.data;
  } catch {
    // fallback abaixo
  }

  const [detalhado, enxuta, consolidado, pendencias, temporaria] = await Promise.all([
    safeCountByCompetencia(supabase, 'realizado_local_ctes', 'id', competencia),
    safeCountByCompetencia(supabase, 'realizado_ctes_enxuta', 'id', competencia),
    safeCountByCompetencia(supabase, 'realizado_ctes_consolidado', 'id', competencia),
    safeCountByCompetencia(supabase, 'realizado_ctes_pendencias_ibge', 'id', competencia),
    safeCountByCompetencia(supabase, 'realizado_ctes_import_tmp', 'id', competencia),
  ]);
  return { competencia, detalhado, enxuta, consolidado, pendencias, temporaria };
}

export async function resetarCompetenciaRealizadoMensal(competencia, limparTemporaria = true) {
  const supabase = ensureSupabase();
  const respostaLote = await rpcOpcional(supabase, 'resetar_realizado_ctes_mes_lote', {
    p_competencia: competencia,
    p_limit: RESET_LIMITE_LOTE,
    p_limpar_temporaria: limparTemporaria,
  });
  if (respostaLote.disponivel) {
    let retorno = respostaLote.data || {};
    let apagadosTotal = Number(retorno.apagados_total || 0);
    for (let tentativa = 2; tentativa <= RESET_MAX_LOOPS && Number(retorno.restante || 0) > 0; tentativa += 1) {
      const proximo = await rpcOpcional(supabase, 'resetar_realizado_ctes_mes_lote', {
        p_competencia: competencia,
        p_limit: RESET_LIMITE_LOTE,
        p_limpar_temporaria: limparTemporaria,
      });
      if (!proximo.disponivel) break;
      retorno = proximo.data || {};
      apagadosTotal += Number(retorno.apagados_total || 0);
      await sleep(40);
    }
    return { ...retorno, apagados_total: apagadosTotal, resetado: Number(retorno.restante || 0) === 0 };
  }

  const resposta = await rpcOpcional(supabase, 'resetar_realizado_ctes_mes', { p_competencia: competencia, p_limpar_temporaria: limparTemporaria });
  if (resposta.disponivel) return resposta.data;

  if (limparTemporaria) await limparTemporariaRealizadoMensal(competencia);
  const tabelas = ['auditoria_cte_resultados', 'auditoria_cte_resumo_mensal', 'realizado_ctes_enxuta', 'realizado_local_ctes', 'realizado_ctes_consolidado', 'realizado_ctes_pendencias_ibge'];
  for (const tabela of tabelas) {
    const { error } = await supabase.from(tabela).delete().eq('competencia', competencia);
    if (error) throw new Error(`Erro ao limpar ${tabela}. Detalhe: ${error.message}`);
  }
  return { competencia, resetado: true };
}

export async function limparTemporariaRealizadoMensal(competencia) {
  const supabase = ensureSupabase();
  const resposta = await rpcOpcional(supabase, 'truncar_realizado_ctes_import_tmp', {});
  if (resposta.disponivel) return Number(resposta.data || 0);
  const { error } = await supabase.from('realizado_ctes_import_tmp').delete().eq('competencia', competencia);
  if (error) throw new Error(`Erro ao limpar temporária. Detalhe: ${error.message}`);
  return 0;
}

export async function subirTemporariaRealizadoMensal({ competencia, arquivoOrigem, registros, onProgress, limparAntes = true }) {
  const supabase = ensureSupabase();
  const payload = (registros || []).map((row) => montarLinhaTemporariaRealizado(row, competencia, arquivoOrigem)).filter((row) => row.chave_cte || row.numero_cte);
  if (!payload.length) throw new Error('Nenhum CT-e válido para subir na temporária. Confira chave/número de CT-e e colunas do arquivo.');
  if (limparAntes) await limparTemporariaRealizadoMensal(competencia);

  let enviados = 0;
  for (let index = 0; index < payload.length; index += TMP_CHUNK_SIZE) {
    const chunk = payload.slice(index, index + TMP_CHUNK_SIZE);
    try {
      await insertChunkWithRetry({ supabase, chunk });
    } catch (error) {
      throw new Error(`Erro ao salvar temporária no Supabase após ${enviados.toLocaleString('pt-BR')} CT-e(s). Detalhe: ${error.message}`);
    }
    enviados += chunk.length;
    onProgress?.({ enviados, total: payload.length });
    await sleep(20);
  }

  if (enviados !== payload.length) throw new Error(`Upload incompleto: ${enviados.toLocaleString('pt-BR')} de ${payload.length.toLocaleString('pt-BR')} CT-e(s). A base não será processada.`);
  return { enviados, total: payload.length };
}

function isTimeoutRpcError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return msg.includes('timeout')
    || msg.includes('upstream')
    || msg.includes('canceling statement')
    || msg.includes('57014')
    || msg.includes('gateway')
    || msg.includes('tempo limite')
    || msg.includes('aborted')
    || msg.includes('network');
}

async function rpcComTimeout(supabase, nomeRpc, args = {}, { onAguardando, timeoutMs = PROCESSAMENTO_RPC_TIMEOUT_MS } = {}) {
  const inicio = Date.now();
  let heartbeat = null;

  const promessaRpc = supabase.rpc(nomeRpc, args);
  const promessaTimeout = new Promise((_, reject) => {
    heartbeat = setInterval(() => {
      const segundos = Math.round((Date.now() - inicio) / 1000);
      onAguardando?.(segundos);
    }, PROCESSAMENTO_HEARTBEAT_MS);

    setTimeout(() => {
      reject(new Error(`Tempo limite de ${Math.round(timeoutMs / 1000)}s na etapa ${nomeRpc}.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promessaRpc, promessaTimeout]);
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
}

async function rpcProcessarLoteComRetry({
  supabase,
  nomeRpc,
  competencia,
  limiteLote,
  limiteMin = PROCESSAMENTO_LIMITE_MIN,
  timeoutMs = PROCESSAMENTO_RPC_TIMEOUT_MS,
  tentativaRpc = 1,
  onAguardando,
}) {
  try {
    const { data, error } = await rpcComTimeout(
      supabase,
      nomeRpc,
      { p_competencia: competencia, p_limit: limiteLote },
      { onAguardando, timeoutMs },
    );

    if (!error) {
      return { data: data || {}, limiteUsado: limiteLote };
    }

    if (isTimeoutRpcError(error) && tentativaRpc < PROCESSAMENTO_RPC_RETRIES) {
      const novoLimite = Math.max(limiteMin, Math.floor(limiteLote / 2));
      await sleep(PROCESSAMENTO_RETRY_DELAY_MS * tentativaRpc);
      return rpcProcessarLoteComRetry({
        supabase,
        nomeRpc,
        competencia,
        limiteLote: novoLimite,
        limiteMin,
        timeoutMs,
        tentativaRpc: tentativaRpc + 1,
        onAguardando,
      });
    }

    throw error;
  } catch (error) {
    if (isTimeoutRpcError(error) && tentativaRpc < PROCESSAMENTO_RPC_RETRIES) {
      const novoLimite = Math.max(limiteMin, Math.floor(limiteLote / 2));
      await sleep(PROCESSAMENTO_RETRY_DELAY_MS * tentativaRpc);
      return rpcProcessarLoteComRetry({
        supabase,
        nomeRpc,
        competencia,
        limiteLote: novoLimite,
        limiteMin,
        timeoutMs,
        tentativaRpc: tentativaRpc + 1,
        onAguardando,
      });
    }
    throw error;
  }
}

async function processarEmLotesRpc({
  competencia,
  nomeRpc,
  mensagemErro,
  etapaProgresso,
  mensagemBase,
  limiteInicial = PROCESSAMENTO_LIMITE_LOTE,
  limiteMin = PROCESSAMENTO_LIMITE_MIN,
  timeoutMs = PROCESSAMENTO_RPC_TIMEOUT_MS,
  falharParcial = false,
  onProgress,
}) {
  const supabase = ensureSupabase();
  let totalInserido = 0;
  let ultimoRetorno = null;
  let limiteAtual = limiteInicial;
  let loopsSemAvanco = 0;

  for (let tentativa = 1; tentativa <= PROCESSAMENTO_MAX_LOOPS; tentativa += 1) {
    let retorno;
    try {
      const resposta = await rpcProcessarLoteComRetry({
        supabase,
        nomeRpc,
        competencia,
        limiteLote: limiteAtual,
        limiteMin,
        timeoutMs,
        onAguardando: (segundos) => {
          onProgress?.({
            etapa: etapaProgresso,
            mensagem: `${mensagemBase}: aguardando Supabase há ${segundos}s (lote ${limiteAtual.toLocaleString('pt-BR')}, acumulado ${totalInserido.toLocaleString('pt-BR')})...`,
            inseridos: totalInserido,
            restante: Number(ultimoRetorno?.restante || 0),
            total: Number(ultimoRetorno?.total_elegivel || 0),
            limiteLote: limiteAtual,
            aguardandoSegundos: segundos,
          });
        },
      });
      retorno = resposta.data;
      limiteAtual = resposta.limiteUsado;
    } catch (error) {
      if (falharParcial && totalInserido > 0) {
        return {
          totalInserido,
          ultimoRetorno,
          parcial: true,
          erro: error.message || String(error),
        };
      }
      throw new Error(`${mensagemErro}. Detalhe: ${error.message}`);
    }

    ultimoRetorno = retorno;
    const inseridos = Number(retorno.inseridos || 0);
    const restante = Number(retorno.restante || 0);
    const totalElegivel = Number(retorno.total_elegivel || 0);
    totalInserido += inseridos;
    loopsSemAvanco = inseridos > 0 ? 0 : loopsSemAvanco + 1;

    onProgress?.({
      etapa: etapaProgresso,
      mensagem: `${mensagemBase}: ${totalInserido.toLocaleString('pt-BR')} inseridos no total. Restante: ${restante.toLocaleString('pt-BR')}.`,
      inseridos: totalInserido,
      restante,
      total: totalElegivel,
      limiteLote: limiteAtual,
      loteAtual: tentativa,
    });

    if (restante <= 0) break;
    if (inseridos === 0) {
      if (loopsSemAvanco >= 3) {
        throw new Error(`${mensagemErro}. O Supabase retornou 0 inseridos por 3 tentativas seguidas com ${restante.toLocaleString('pt-BR')} pendente(s).`);
      }
      limiteAtual = Math.max(limiteMin, Math.floor(limiteAtual / 2));
    }

    await sleep(PROCESSAMENTO_ENTRE_LOTES_MS);
  }

  if (Number(ultimoRetorno?.restante || 0) > 0) {
    const msg = `${mensagemErro}. Ainda restam ${Number(ultimoRetorno.restante).toLocaleString('pt-BR')} registro(s). Use "Continuar processamento" para retomar.`;
    if (falharParcial && totalInserido > 0) {
      return { totalInserido, ultimoRetorno, parcial: true, erro: msg };
    }
    throw new Error(msg);
  }

  return { totalInserido, ultimoRetorno, parcial: false };
}

const COLUNAS_REALIZADO_LOCAL_CTES = [
  'arquivo_origem',
  'competencia',
  'transportadora',
  'cnpj_transportadora',
  'tomador_servico',
  'data_emissao',
  'chave_cte',
  'numero_cte',
  'valor_cte',
  'valor_calculado',
  'diferenca',
  'situacao',
  'status',
  'status_conciliacao',
  'status_erp',
  'percentual_frete',
  'uf_origem',
  'uf_destino',
  'ibge_origem',
  'ibge_destino',
  'chave_rota_ibge',
  'ibge_ok',
  'peso',
  'peso_declarado',
  'peso_cubado',
  'cubagem',
  'qtd_volumes',
  'canal',
  'canal_original',
  'valor_nf',
  'cidade_origem',
  'cidade_destino',
];

function montarLinhaLocalFromTmp(row = {}) {
  const ibgeOrigem = cleanDigits(row.ibge_origem).slice(0, 7);
  const ibgeDestino = cleanDigits(row.ibge_destino).slice(0, 7);
  const chaveRotaIbge = ibgeOrigem && ibgeDestino ? `${ibgeOrigem}-${ibgeDestino}` : '';
  const origem = {
    arquivo_origem: row.arquivo_origem,
    competencia: row.competencia,
    transportadora: row.transportadora,
    cnpj_transportadora: row.cnpj_transportadora,
    tomador_servico: row.tomador_servico,
    data_emissao: row.data_emissao,
    chave_cte: row.chave_cte,
    numero_cte: row.numero_cte,
    valor_cte: row.valor_cte,
    valor_calculado: row.valor_calculado,
    diferenca: row.diferenca,
    situacao: row.situacao,
    status: row.status,
    status_conciliacao: row.status_conciliacao,
    status_erp: row.status_erp,
    percentual_frete: row.percentual_frete,
    uf_origem: row.uf_origem,
    uf_destino: row.uf_destino,
    ibge_origem: ibgeOrigem,
    ibge_destino: ibgeDestino,
    chave_rota_ibge: chaveRotaIbge,
    ibge_ok: Boolean(chaveRotaIbge),
    peso: row.peso,
    peso_declarado: row.peso_declarado,
    peso_cubado: row.peso_cubado,
    cubagem: row.cubagem,
    qtd_volumes: row.qtd_volumes,
    canal: row.canal,
    canal_original: row.canal_original,
    valor_nf: row.valor_nf,
    cidade_origem: row.cidade_origem,
    cidade_destino: row.cidade_destino,
  };

  const payload = {};
  COLUNAS_REALIZADO_LOCAL_CTES.forEach((coluna) => {
    const valor = origem[coluna];
    if (valor === undefined || valor === null) return;
    if (typeof valor === 'string' && valor.trim() === '' && coluna !== 'chave_cte' && coluna !== 'competencia') return;
    payload[coluna] = valor;
  });

  payload.competencia = row.competencia;
  payload.chave_cte = row.chave_cte;
  return payload;
}

function chavesTrackingFromTmp(row = {}) {
  const raw = row.raw || {};
  return {
    chaveCte: row.chave_cte,
    chaveNfe: row.chave_nfe || raw.chaveNfe || raw.chave_nfe,
    notaFiscal: row.nota_fiscal || raw.notaFiscal || raw.nota_fiscal,
    numeroCte: row.numero_cte,
  };
}

function chunksImportacao(lista = [], tamanho = TRACKING_IMPORT_CHUNK) {
  const saida = [];
  for (let i = 0; i < lista.length; i += tamanho) saida.push(lista.slice(i, i + tamanho));
  return saida;
}

function adicionarTrackingImportacao(mapa, chaveValor, item = {}) {
  const chave = cleanDigits(chaveValor);
  if (!chave) return;

  const atual = mapa.get(chave);
  const volumes = toSafeNumber(item.qtd_volumes);
  const cubagemUnitaria = toSafeNumber(item.cubagem_unitaria);
  const cubagemTotalDireta = toSafeNumber(item.cubagem_total);
  const resolvida = resolverCubagemTracking({
    cubagemUnitaria,
    cubagemTotal: cubagemTotalDireta,
    pesoCubadoOriginal: toSafeNumber(item.peso_cubado),
    volumes,
    pesoFisico: toSafeNumber(item.peso),
  });

  if (!atual) {
    mapa.set(chave, {
      ...item,
      qtd_volumes: volumes,
      cubagem_total: resolvida.cubagemAplicada,
      peso_cubado: resolvida.pesoCubado,
      linhas_tracking: 1,
    });
    return;
  }

  mapa.set(chave, {
    ...atual,
    qtd_volumes: toSafeNumber(atual.qtd_volumes) + volumes,
    cubagem_total: toSafeNumber(atual.cubagem_total) + resolvida.cubagemAplicada,
    peso_cubado: toSafeNumber(atual.peso_cubado) + resolvida.pesoCubado,
    peso: toSafeNumber(atual.peso) || toSafeNumber(item.peso),
    peso_declarado: toSafeNumber(atual.peso_declarado) || toSafeNumber(item.peso_declarado),
    valor_nf: toSafeNumber(atual.valor_nf) || toSafeNumber(item.valor_nf),
    linhas_tracking: toSafeNumber(atual.linhas_tracking) + 1,
  });
}

async function buscarTrackingImportacaoPorChave(rows = []) {
  const supabase = ensureSupabase();
  const chavesCte = [...new Set((rows || []).map((row) => cleanDigits(chavesTrackingFromTmp(row).chaveCte)).filter((v) => v.length >= 20))];
  const chavesNfe = [...new Set((rows || []).map((row) => cleanDigits(chavesTrackingFromTmp(row).chaveNfe)).filter((v) => v.length >= 20))];
  const mapaCte = new Map();
  const mapaNfe = new Map();
  let erros = 0;

  async function consultar(coluna, valores, mapa) {
    for (const parte of chunksImportacao(valores)) {
      if (!parte.length) continue;
      const { data, error } = await supabase
        .from('tracking_rows')
        .select('chave_cte,chave_nfe,canal,transportadora,cidade_origem,uf_origem,ibge_origem,cidade_destino,uf_destino,ibge_destino,peso,peso_declarado,peso_cubado,cubagem_unitaria,cubagem_total,valor_nf,qtd_volumes')
        .in(coluna, parte);

      if (error) {
        erros += 1;
        for (const chave of parte) {
          const individual = await supabase
            .from('tracking_rows')
            .select('chave_cte,chave_nfe,canal,transportadora,cidade_origem,uf_origem,ibge_origem,cidade_destino,uf_destino,ibge_destino,peso,peso_declarado,peso_cubado,cubagem_unitaria,cubagem_total,valor_nf,qtd_volumes')
            .eq(coluna, chave);
          if (individual.error) {
            erros += 1;
            continue;
          }
          (individual.data || []).forEach((item) => adicionarTrackingImportacao(mapa, item[coluna], item));
        }
        continue;
      }

      (data || []).forEach((item) => adicionarTrackingImportacao(mapa, item[coluna], item));
    }
  }

  await consultar('chave_cte', chavesCte, mapaCte);

  const chavesNfeSemCte = chavesNfe.filter((chaveNfe) => {
    const row = rows.find((item) => cleanDigits(chavesTrackingFromTmp(item).chaveNfe) === chaveNfe);
    const chaveCte = cleanDigits(chavesTrackingFromTmp(row || {}).chaveCte);
    return !chaveCte || !mapaCte.has(chaveCte);
  });
  await consultar('chave_nfe', chavesNfeSemCte, mapaNfe);

  return { mapaCte, mapaNfe, erros };
}

async function enriquecerTemporariaComTracking(rows = []) {
  const lista = Array.isArray(rows) ? rows : [];
  if (!lista.length) return { rows: lista, vinculados: 0, semTracking: 0, erroTracking: '' };

  const { mapaCte, mapaNfe, erros } = await buscarTrackingImportacaoPorChave(lista);
  const resolverIbge = await carregarResolvedorIbgeImportacao();
  let vinculados = 0;
  let semTracking = 0;

  const enriquecidas = await Promise.all(lista.map(async (row) => {
    const chaves = chavesTrackingFromTmp(row);
    const tracking = mapaCte.get(cleanDigits(chaves.chaveCte))
      || mapaNfe.get(cleanDigits(chaves.chaveNfe));
    if (!tracking) {
      semTracking += 1;
      return aplicarIbgeImportacao({
        ...row,
        cubagem: toSafeNumber(row.metros_cubicos),
        qtd_volumes: 0,
      }, resolverIbge);
    }

    vinculados += 1;
    return aplicarIbgeImportacao({
      ...row,
      cidade_origem: cleanText(row.cidade_origem || tracking.cidade_origem),
      uf_origem: cleanUf(row.uf_origem || tracking.uf_origem),
      cidade_destino: cleanText(row.cidade_destino || tracking.cidade_destino),
      uf_destino: cleanUf(row.uf_destino || tracking.uf_destino),
      ibge_origem: cleanDigits(row.ibge_origem || tracking.ibge_origem).slice(0, 7),
      ibge_destino: cleanDigits(row.ibge_destino || tracking.ibge_destino).slice(0, 7),
      peso: toSafeNumber(row.peso) || toSafeNumber(tracking.peso),
      peso_declarado: toSafeNumber(row.peso_declarado) || toSafeNumber(tracking.peso_declarado),
      peso_cubado: toSafeNumber(tracking.peso_cubado),
      cubagem: toSafeNumber(tracking.cubagem_total),
      qtd_volumes: toSafeNumber(tracking.qtd_volumes),
      canal: cleanText(row.canal || tracking.canal),
      valor_nf: toSafeNumber(row.valor_nf) || toSafeNumber(tracking.valor_nf),
    }, resolverIbge);
  }));

  return {
    rows: enriquecidas,
    vinculados,
    semTracking,
    erroTracking: erros ? `${erros} consulta(s) ao Tracking falharam durante a importacao.` : '',
  };
}

async function contarTemporariaCompetencia(supabase, competencia) {
  const { count, error } = await supabase
    .from('realizado_ctes_import_tmp')
    .select('id', { count: 'exact', head: true })
    .eq('competencia', competencia);
  if (error) throw new Error(`Erro ao contar temporária. Detalhe: ${error.message}`);
  return count || 0;
}

// Contagem estimada (planner) — rápida e sem full scan. Usada só para a barra
// de progresso; nunca lança (se falhar, devolve null e a barra fica sem total).
async function contarTemporariaEstimado(supabase, competencia) {
  try {
    const { count } = await supabase
      .from('realizado_ctes_import_tmp')
      .select('id', { count: 'planned', head: true })
      .eq('competencia', competencia);
    return Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}

async function buscarChavesLocaisExistentes(supabase, competencia, chaves = []) {
  const existentes = new Set();
  const unicas = [...new Set(chaves.filter(Boolean))];
  for (let index = 0; index < unicas.length; index += TMP_PARA_LOCAL_CHAVE_CHUNK) {
    const parte = unicas.slice(index, index + TMP_PARA_LOCAL_CHAVE_CHUNK);
    const { data, error } = await supabase
      .from('realizado_local_ctes')
      .select('chave_cte')
      .eq('competencia', competencia)
      .in('chave_cte', parte);
    if (error) throw new Error(`Erro ao consultar chaves na base oficial. Detalhe: ${error.message}`);
    (data || []).forEach((row) => {
      if (row.chave_cte) existentes.add(row.chave_cte);
    });
  }
  return existentes;
}

async function processarTemporariaParaLocalCliente({ competencia, onProgress }) {
  const supabase = ensureSupabase();
  let totalInserido = 0;
  let totalPulados = 0;
  let totalLido = 0;

  // Contagem só estimada (planner) e uma vez — count exato em temporária grande
  // estoura statement timeout. Serve apenas para o "restante" da barra.
  const pendenteInicial = await contarTemporariaEstimado(supabase, competencia);
  let primeiroIdAnterior = null;

  while (true) {
    const { data: lote, error: erroLeitura } = await supabase
      .from('realizado_ctes_import_tmp')
      .select('*')
      .eq('competencia', competencia)
      .order('id', { ascending: true })
      .limit(TMP_PARA_LOCAL_PAGE);

    if (erroLeitura) throw new Error(`Erro ao ler temporária. Detalhe: ${erroLeitura.message}`);
    if (!lote?.length) break;

    // Detecta travamento sem precisar contar: como lemos por id crescente e
    // apagamos o que lemos, o primeiro id tem que avançar a cada volta. Se
    // repetir, o delete não está removendo (permissão/erro) — aborta.
    const primeiroId = lote[0]?.id ?? null;
    if (primeiroIdAnterior !== null && String(primeiroId) === String(primeiroIdAnterior)) {
      throw new Error('A temporária não avançou neste lote. Verifique permissões ou duplicidade na base oficial.');
    }
    primeiroIdAnterior = primeiroId;

    totalLido += lote.length;
    const existentes = await buscarChavesLocaisExistentes(
      supabase,
      competencia,
      lote.map((row) => row.chave_cte),
    );

    // Dedup por chave dentro do próprio lote: evita o erro "ON CONFLICT cannot
    // affect row a second time" e reduz o tamanho da gravação.
    const vistos = new Set();
    const novos = lote.filter((row) => {
      if (!row.chave_cte || existentes.has(row.chave_cte) || vistos.has(row.chave_cte)) return false;
      vistos.add(row.chave_cte);
      return true;
    });
    totalPulados += lote.length - novos.length;
    const enriquecimento = await enriquecerTemporariaComTracking(novos);
    const novosEnriquecidos = enriquecimento.rows;

    for (let index = 0; index < novosEnriquecidos.length; index += TMP_PARA_LOCAL_INSERT) {
      const parte = novosEnriquecidos.slice(index, index + TMP_PARA_LOCAL_INSERT);
      const payload = parte.map(montarLinhaLocalFromTmp);
      if (!payload.length) continue;

      await gravarLocalComRetry(supabase, payload);
      totalInserido += payload.length;
    }

    const idsRemover = lote.map((row) => row.id).filter(Boolean);
    if (idsRemover.length) {
      for (let index = 0; index < idsRemover.length; index += TMP_PARA_LOCAL_INSERT) {
        const parteIds = idsRemover.slice(index, index + TMP_PARA_LOCAL_INSERT);
        const { error: erroDelete } = await supabase
          .from('realizado_ctes_import_tmp')
          .delete()
          .in('id', parteIds);
        if (erroDelete) throw new Error(`Erro ao limpar temporária processada. Detalhe: ${erroDelete.message}`);
      }
    }

    // Restante aproximado: estimativa inicial menos o que já lemos (tudo que é
    // lido é apagado da temporária). Evita um count exato por volta.
    const restante = pendenteInicial != null ? Math.max(0, pendenteInicial - totalLido) : null;
    const restanteTxt = restante != null ? `~${restante.toLocaleString('pt-BR')}` : 'processando';
    onProgress?.({
      etapa: 'processamento_lote',
      mensagem: `Base oficial: ${totalInserido.toLocaleString('pt-BR')} inseridos, ${totalPulados.toLocaleString('pt-BR')} já existiam. Tracking: ${enriquecimento.vinculados.toLocaleString('pt-BR')} vinculados, ${enriquecimento.semTracking.toLocaleString('pt-BR')} sem vínculo. Restante na temporária: ${restanteTxt}.`,
      inseridos: totalInserido,
      restante: restante ?? 0,
      total: totalInserido + (restante ?? 0),
      modo: 'cliente',
    });

    await sleep(40);
  }

  return {
    totalInserido,
    totalPulados,
    totalLido,
    ultimoRetorno: { inseridos: totalInserido, restante: 0, modo: 'cliente' },
  };
}

async function processarLocalEmLotes({ competencia, onProgress }) {
  onProgress?.({
    etapa: 'processamento_lote',
    mensagem: 'Gravando temporária na base oficial (processamento direto, sem RPC)...',
    inseridos: 0,
    restante: await contarTemporariaCompetencia(ensureSupabase(), competencia),
    modo: 'cliente',
  });
  return processarTemporariaParaLocalCliente({ competencia, onProgress });
}

async function processarEnxutaEmLotes({ competencia, onProgress }) {
  return processarEmLotesRpc({
    competencia,
    nomeRpc: 'processar_realizado_ctes_enxuta_lote',
    mensagemErro: 'Erro ao processar lote da base enxuta',
    etapaProgresso: 'processamento_enxuta_lote',
    mensagemBase: 'Gerando base enxuta em micro-lotes',
    limiteInicial: PROCESSAMENTO_LIMITE_LOTE_ENXUTA,
    limiteMin: PROCESSAMENTO_LIMITE_MIN_ENXUTA,
    timeoutMs: PROCESSAMENTO_RPC_TIMEOUT_ENXUTA_MS,
    falharParcial: true,
    onProgress,
  });
}

export function competenciaPrecisaProcessamento(status = {}) {
  return Number(status?.temporaria || 0) > 0;
}

export function competenciaPrecisaEnxuta(status = {}) {
  const detalhado = Number(status?.detalhado || 0);
  const enxuta = Number(status?.enxuta || 0);
  return detalhado > enxuta;
}

export async function processarEnxutaCompetenciaManual({ competencia, onProgress } = {}) {
  if (!competencia) throw new Error('Informe a competência para gerar a base enxuta.');
  const status = await verificarCompetenciaRealizadoMensal(competencia);
  if (!competenciaPrecisaEnxuta(status)) {
    return { totalInserido: 0, ultimoRetorno: null, statusFinal: status, jaEmDia: true };
  }
  onProgress?.({
    etapa: 'processamento_enxuta_lote',
    mensagem: 'Gerando base enxuta (opcional). Pode demorar; a tela CT-e já usa a base oficial.',
  });
  const enxuta = await processarEnxutaEmLotes({ competencia, onProgress });
  const statusFinal = await verificarCompetenciaRealizadoMensal(competencia);
  return { ...enxuta, statusFinal };
}

export async function processarRealizadoMensalEnxuto({
  competencia,
  substituir = false,
  gerarEnxuta = ENXUTA_AUTOMATICA_NO_IMPORT,
  onProgress,
  statusInicial = null,
} = {}) {
  const supabase = ensureSupabase();
  const testeFuncao = await rpcOpcional(supabase, 'status_realizado_cte_competencia_fast', { p_competencia: competencia });
  if (!testeFuncao.disponivel) throw new Error('Funções de processamento em lote ainda não foram criadas no Supabase. Rode o SQL "supabase_importacao_ctes_lotes.sql" uma vez antes de importar novos meses.');

  const status = statusInicial || await verificarCompetenciaRealizadoMensal(competencia);
  const temporaria = Number(status?.temporaria || 0);
  const detalhado = Number(status?.detalhado || 0);
  const enxuta = Number(status?.enxuta || 0);

  let oficial = { totalInserido: 0, ultimoRetorno: null };
  if (temporaria > 0) {
    onProgress?.({
      etapa: 'processamento',
      mensagem: `Processando temporária em lotes leves (${temporaria.toLocaleString('pt-BR')} CT-e(s), ${PROCESSAMENTO_LIMITE_LOTE.toLocaleString('pt-BR')} por chamada)...`,
    });
    oficial = await processarLocalEmLotes({ competencia, onProgress });
  } else {
    onProgress?.({ etapa: 'processamento', mensagem: 'Temporária vazia. Pulando etapa da base oficial.' });
  }

  const statusPosOficial = temporaria > 0
    ? await verificarCompetenciaRealizadoMensal(competencia)
    : status;
  const precisaEnxuta = Number(statusPosOficial?.detalhado || detalhado) > Number(statusPosOficial?.enxuta || enxuta);

  let enxutaProcessada = { totalInserido: 0, ultimoRetorno: null, parcial: false };
  let avisoEnxuta = '';
  let enxutaPendente = false;

  if (precisaEnxuta && gerarEnxuta) {
    onProgress?.({
      etapa: 'processamento',
      mensagem: `Gerando base enxuta em micro-lotes (${PROCESSAMENTO_LIMITE_LOTE_ENXUTA.toLocaleString('pt-BR')} CT-e(s) por chamada)...`,
    });
    try {
      enxutaProcessada = await processarEnxutaEmLotes({ competencia, onProgress });
      if (enxutaProcessada.parcial) {
        avisoEnxuta = enxutaProcessada.erro || 'Base enxuta ficou parcial.';
        onProgress?.({ etapa: 'processamento', mensagem: avisoEnxuta });
      }
    } catch (error) {
      avisoEnxuta = error.message || String(error);
      enxutaProcessada = { totalInserido: 0, ultimoRetorno: null, parcial: true, erro: avisoEnxuta };
      onProgress?.({ etapa: 'processamento', mensagem: `Base oficial ok. Enxuta pendente: ${avisoEnxuta}` });
    }
    enxutaPendente = Boolean(avisoEnxuta) || competenciaPrecisaEnxuta(await verificarCompetenciaRealizadoMensal(competencia));
  } else if (precisaEnxuta) {
    avisoEnxuta = 'Base enxuta não gerada automaticamente (RPC lenta no servidor). A consulta CT-e já usa a base oficial.';
    enxutaPendente = false;
    onProgress?.({ etapa: 'processamento', mensagem: avisoEnxuta });
  } else {
    onProgress?.({ etapa: 'processamento', mensagem: 'Base enxuta já está em dia.' });
  }

  const statusFinal = await verificarCompetenciaRealizadoMensal(competencia);
  return {
    competencia,
    substituir,
    oficial,
    enxuta: enxutaProcessada,
    avisoEnxuta,
    enxutaPendente,
    enxutaOpcionalPendente: competenciaPrecisaEnxuta(statusFinal),
    statusFinal,
  };
}

export async function continuarProcessamentoRealizadoMensal({ competencia, onProgress } = {}) {
  if (!competencia) throw new Error('Informe a competência para continuar o processamento.');
  const statusInicial = await verificarCompetenciaRealizadoMensal(competencia);
  if (!competenciaPrecisaProcessamento(statusInicial)) {
    throw new Error(`A competência ${competencia} não tem CT-e(s) na temporária. A base oficial já pode ser consultada.`);
  }

  const temporaria = Number(statusInicial?.temporaria || 0);
  const detalhado = Number(statusInicial?.detalhado || 0);
  if (temporaria <= 0) {
    throw new Error(`Não há CT-e(s) na temporária de ${competencia}. A base oficial (${detalhado.toLocaleString('pt-BR')} CT-e(s)) já pode ser consultada na tela CT-e.`);
  }

  onProgress?.({
    etapa: 'processamento',
    mensagem: `Retomando temporária (${temporaria.toLocaleString('pt-BR')} CT-e(s) pendentes)...`,
  });

  const processamento = await processarRealizadoMensalEnxuto({
    competencia,
    substituir: false,
    gerarEnxuta: false,
    onProgress,
    statusInicial,
  });
  return {
    retomado: true,
    statusInicial,
    ...processamento,
    statusFinal: processamento.statusFinal || await verificarCompetenciaRealizadoMensal(competencia),
  };
}

export async function importarRealizadoMensalEnxuto({ competencia, arquivoOrigem, registros, substituir = false, modo, onProgress }) {
  const supabase = ensureSupabase();
  const modoImportacao = modo ?? (substituir ? 'substituir' : 'complementar');
  const substituirCompetencia = modoImportacao === 'substituir';
  const validacao = validarRegistrosRealizadoMensal(registros);
  onProgress?.({ etapa: 'validacao', mensagem: 'Colunas validadas.', validacao });

  let registrosParaImportar = registros || [];
  let statsComplementar = null;

  let statusInicial = null;
  try {
    statusInicial = await verificarCompetenciaRealizadoMensal(competencia);
  } catch (error) {
    if (!substituirCompetencia) throw error;
    onProgress?.({ etapa: 'status', mensagem: `Consulta inicial da competência demorou demais. Seguindo com reimportação/substituição de ${competencia}.` });
  }

  if (modoImportacao === 'complementar') {
    onProgress?.({ etapa: 'filtro', mensagem: 'Consultando chaves CT-e já importadas na competência...' });
    const chavesExistentes = await listarChavesCteCompetencia(supabase, competencia, onProgress);
    const filtrado = filtrarRegistrosPorChaveExistente(registrosParaImportar, chavesExistentes);
    registrosParaImportar = filtrado.novos;
    statsComplementar = filtrado.stats;
    onProgress?.({
      etapa: 'filtro',
      mensagem: `${statsComplementar.novos.toLocaleString('pt-BR')} novo(s) para importar, ${statsComplementar.jaNaBase.toLocaleString('pt-BR')} já na base (pulados).`,
      complementar: statsComplementar,
    });

    if (!registrosParaImportar.length) {
      const statusFinal = statusInicial || await verificarCompetenciaRealizadoMensal(competencia);
      onProgress?.({
        etapa: 'concluido',
        mensagem: 'Nenhum CT-e novo para importar. Todos os registros do arquivo já estão na base.',
        status: statusFinal,
        complementar: statsComplementar,
      });
      return {
        validacao,
        modo: modoImportacao,
        complementar: statsComplementar,
        temporaria: { enviados: 0, total: 0, pulados: statsComplementar.jaNaBase },
        processamento: null,
        statusFinal,
      };
    }
  }

  const payloadEstimado = registrosParaImportar.filter((row) => getChaveCte(row) || cleanText(row.numeroCte ?? row.numero_cte)).length;
  const temporariaMesmoArquivo = await contarTemporariaPorArquivo({ supabase, competencia, arquivoOrigem });
  const podeReaproveitarTemporaria = substituirCompetencia && temporariaMesmoArquivo >= payloadEstimado && payloadEstimado > 0;
  let temporaria;

  if (podeReaproveitarTemporaria) {
    temporaria = { enviados: temporariaMesmoArquivo, total: payloadEstimado, reaproveitada: true };
    onProgress?.({ etapa: 'temporaria', mensagem: `Temporária já está completa para este arquivo: ${temporariaMesmoArquivo.toLocaleString('pt-BR')} CT-e(s). Continuando o processamento sem reupload.`, enviados: temporariaMesmoArquivo, total: payloadEstimado });
  } else {
    if (substituirCompetencia) {
      onProgress?.({ etapa: 'reset', mensagem: 'Resetando competência e limpando temporária...' });
      const reset = await resetarCompetenciaRealizadoMensal(competencia, true);
      if (!reset?.resetado) {
        throw new Error(`A limpeza da competência ${competencia} não terminou. Restante informado: ${Number(reset?.restante || 0).toLocaleString('pt-BR')}. Tente novamente.`);
      }
    } else {
      await limparTemporariaRealizadoMensal(competencia);
    }
    onProgress?.({ etapa: 'temporaria', mensagem: 'Enviando novos CT-e(s) para tabela temporária...' });
    temporaria = await subirTemporariaRealizadoMensal({
      competencia,
      arquivoOrigem,
      registros: registrosParaImportar,
      limparAntes: false,
      onProgress: (progress) => onProgress?.({ etapa: 'temporaria', mensagem: 'Enviando novos CT-e(s) para tabela temporária...', ...progress }),
    });
  }

  if (statsComplementar) {
    temporaria = { ...temporaria, pulados: statsComplementar.jaNaBase, lidos: statsComplementar.lidos };
  }

  if (Number(temporaria.enviados || 0) < Number(temporaria.total || 0)) throw new Error(`Upload incompleto: ${Number(temporaria.enviados || 0).toLocaleString('pt-BR')} de ${Number(temporaria.total || 0).toLocaleString('pt-BR')} CT-e(s). O processamento foi bloqueado para evitar mês incompleto.`);

  onProgress?.({ etapa: 'processamento', mensagem: 'Gerando base oficial e enxuta em lotes...' });
  const processamento = await processarRealizadoMensalEnxuto({
    competencia,
    substituir: substituirCompetencia,
    gerarEnxuta: false,
    onProgress,
  });
  const statusFinal = processamento.statusFinal || await verificarCompetenciaRealizadoMensal(competencia);
  const mensagemConclusao = Number(statusFinal?.temporaria || 0) > 0
    ? `Ainda há ${Number(statusFinal.temporaria).toLocaleString('pt-BR')} CT-e(s) na temporária. Use Continuar processamento.`
    : `Base oficial pronta (${Number(statusFinal?.detalhado || 0).toLocaleString('pt-BR')} CT-e(s)).`;
  onProgress?.({ etapa: 'concluido', mensagem: mensagemConclusao, status: statusFinal, complementar: statsComplementar });
  return {
    validacao,
    modo: modoImportacao,
    complementar: statsComplementar,
    temporaria,
    processamento,
    statusFinal,
    avisoEnxuta: processamento.avisoEnxuta,
    enxutaPendente: processamento.enxutaPendente,
  };
}

export async function listarPendenciasIbgeRealizadoMensal(competencia, limit = 100) {
  const supabase = ensureSupabase();
  const { data, error } = await supabase.from('realizado_ctes_pendencias_ibge').select('*').eq('competencia', competencia).order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error(`Erro ao listar pendências IBGE. Detalhe: ${error.message}`);
  return data || [];
}

export async function resumoBaseEnxutaRealizadoMensal(competencia) {
  const supabase = ensureSupabase();
  const resposta = await rpcOpcional(supabase, 'status_realizado_cte_competencia_fast', { p_competencia: competencia });
  if (resposta.disponivel && resposta.data) return { competencia, detalhado: resposta.data.enxuta || 0, consolidado: resposta.data.consolidado || 0, pendencias: resposta.data.pendencias || 0 };
  const [detalhe, consolidado, pendencias] = await Promise.all([
    supabase.from('realizado_ctes_enxuta').select('chave_cte', { count: 'exact', head: true }).eq('competencia', competencia),
    supabase.from('realizado_ctes_consolidado').select('chave_rota_ibge', { count: 'exact', head: true }).eq('competencia', competencia),
    supabase.from('realizado_ctes_pendencias_ibge').select('chave_cte', { count: 'exact', head: true }).eq('competencia', competencia),
  ]);
  if (detalhe.error) throw detalhe.error;
  if (consolidado.error) throw consolidado.error;
  if (pendencias.error) throw pendencias.error;
  return { competencia, detalhado: detalhe.count || 0, consolidado: consolidado.count || 0, pendencias: pendencias.count || 0 };
}
