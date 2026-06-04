import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const TMP_CHUNK_SIZE = 500;
const TMP_INSERT_RETRIES = 3;
const TMP_RETRY_DELAY_MS = 900;
const PROCESSAMENTO_LIMITE_LOTE = 35000;
const PROCESSAMENTO_MAX_LOOPS = 20;
const RESET_LIMITE_LOTE = 10000;
const RESET_MAX_LOOPS = 80;

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
  const cubado = toSafeNumber(row.pesoCubado ?? row.peso_cubado);
  return metros > 0 ? metros : (cubagem > 0 ? cubagem : cubado);
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

async function processarLocalEmLotes({ competencia, onProgress }) {
  const supabase = ensureSupabase();
  let totalInserido = 0;
  let ultimoRetorno = null;
  for (let tentativa = 1; tentativa <= PROCESSAMENTO_MAX_LOOPS; tentativa += 1) {
    const { data, error } = await supabase.rpc('processar_realizado_ctes_lote', { p_competencia: competencia, p_limit: PROCESSAMENTO_LIMITE_LOTE });
    if (error) throw new Error(`Erro ao processar lote da base oficial. Detalhe: ${error.message}`);
    const retorno = data || {};
    ultimoRetorno = retorno;
    const inseridos = Number(retorno.inseridos || 0);
    const restante = Number(retorno.restante || 0);
    const totalElegivel = Number(retorno.total_elegivel || 0);
    totalInserido += inseridos;
    onProgress?.({ etapa: 'processamento_lote', mensagem: `Processando base oficial em lotes: ${totalInserido.toLocaleString('pt-BR')} inseridos nesta execução. Restante elegível: ${restante.toLocaleString('pt-BR')}.`, inseridos: totalInserido, restante, total: totalElegivel });
    if (inseridos === 0 || restante <= 0) break;
  }
  return { totalInserido, ultimoRetorno };
}

async function processarEnxutaEmLotes({ competencia, onProgress }) {
  const supabase = ensureSupabase();
  let totalInserido = 0;
  let ultimoRetorno = null;
  for (let tentativa = 1; tentativa <= PROCESSAMENTO_MAX_LOOPS; tentativa += 1) {
    const { data, error } = await supabase.rpc('processar_realizado_ctes_enxuta_lote', { p_competencia: competencia, p_limit: PROCESSAMENTO_LIMITE_LOTE });
    if (error) throw new Error(`Erro ao processar lote da base enxuta. Detalhe: ${error.message}`);
    const retorno = data || {};
    ultimoRetorno = retorno;
    const inseridos = Number(retorno.inseridos || 0);
    const restante = Number(retorno.restante || 0);
    const totalElegivel = Number(retorno.total_elegivel || 0);
    totalInserido += inseridos;
    onProgress?.({ etapa: 'processamento_enxuta_lote', mensagem: `Gerando base enxuta em lotes: ${totalInserido.toLocaleString('pt-BR')} inseridos nesta execução. Restante: ${restante.toLocaleString('pt-BR')}.`, inseridos: totalInserido, restante, total: totalElegivel });
    if (inseridos === 0 || restante <= 0) break;
  }
  return { totalInserido, ultimoRetorno };
}

export async function processarRealizadoMensalEnxuto({ competencia, substituir = false, onProgress }) {
  const supabase = ensureSupabase();
  const testeFuncao = await rpcOpcional(supabase, 'status_realizado_cte_competencia_fast', { p_competencia: competencia });
  if (!testeFuncao.disponivel) throw new Error('Funções de processamento em lote ainda não foram criadas no Supabase. Rode o SQL "supabase_importacao_ctes_lotes.sql" uma vez antes de importar novos meses.');
  onProgress?.({ etapa: 'processamento', mensagem: 'Processando temporária em lotes leves...' });
  const oficial = await processarLocalEmLotes({ competencia, onProgress });
  onProgress?.({ etapa: 'processamento', mensagem: 'Gerando base enxuta em lotes leves...' });
  const enxuta = await processarEnxutaEmLotes({ competencia, onProgress });
  const statusFinal = await verificarCompetenciaRealizadoMensal(competencia);
  return { competencia, substituir, oficial, enxuta, statusFinal };
}

export async function importarRealizadoMensalEnxuto({ competencia, arquivoOrigem, registros, substituir = false, onProgress }) {
  const supabase = ensureSupabase();
  const validacao = validarRegistrosRealizadoMensal(registros);
  onProgress?.({ etapa: 'validacao', mensagem: 'Colunas validadas.', validacao });

  const payloadEstimado = (registros || []).filter((row) => getChaveCte(row) || cleanText(row.numeroCte ?? row.numero_cte)).length;
  let statusInicial = null;
  try {
    statusInicial = await verificarCompetenciaRealizadoMensal(competencia);
  } catch (error) {
    if (!substituir) throw error;
    onProgress?.({ etapa: 'status', mensagem: `Consulta inicial da competência demorou demais. Seguindo com reimportação/substituição de ${competencia}.` });
  }

  if (!substituir && Number(statusInicial?.detalhado || 0) > 0) {
    const erro = new Error(`A competência ${competencia} já possui ${Number(statusInicial.detalhado).toLocaleString('pt-BR')} CT-e(s) na base enxuta.`);
    erro.statusCompetencia = statusInicial;
    throw erro;
  }

  const temporariaMesmoArquivo = await contarTemporariaPorArquivo({ supabase, competencia, arquivoOrigem });
  const podeReaproveitarTemporaria = substituir && temporariaMesmoArquivo >= payloadEstimado && payloadEstimado > 0;
  let temporaria;

  if (podeReaproveitarTemporaria) {
    temporaria = { enviados: temporariaMesmoArquivo, total: payloadEstimado, reaproveitada: true };
    onProgress?.({ etapa: 'temporaria', mensagem: `Temporária já está completa para este arquivo: ${temporariaMesmoArquivo.toLocaleString('pt-BR')} CT-e(s). Continuando o processamento sem reupload.`, enviados: temporariaMesmoArquivo, total: payloadEstimado });
  } else {
    if (substituir) {
      onProgress?.({ etapa: 'reset', mensagem: 'Resetando competência e limpando temporária...' });
      const reset = await resetarCompetenciaRealizadoMensal(competencia, true);
      if (!reset?.resetado) {
        throw new Error(`A limpeza da competência ${competencia} não terminou. Restante informado: ${Number(reset?.restante || 0).toLocaleString('pt-BR')}. Tente novamente.`);
      }
    } else {
      await limparTemporariaRealizadoMensal(competencia);
    }
    onProgress?.({ etapa: 'temporaria', mensagem: 'Enviando arquivo para tabela temporária...' });
    temporaria = await subirTemporariaRealizadoMensal({ competencia, arquivoOrigem, registros, limparAntes: false, onProgress: (progress) => onProgress?.({ etapa: 'temporaria', mensagem: 'Enviando arquivo para tabela temporária...', ...progress }) });
  }

  if (Number(temporaria.enviados || 0) < Number(temporaria.total || 0)) throw new Error(`Upload incompleto: ${Number(temporaria.enviados || 0).toLocaleString('pt-BR')} de ${Number(temporaria.total || 0).toLocaleString('pt-BR')} CT-e(s). O processamento foi bloqueado para evitar mês incompleto.`);

  onProgress?.({ etapa: 'processamento', mensagem: 'Gerando base oficial e enxuta em lotes...' });
  const processamento = await processarRealizadoMensalEnxuto({ competencia, substituir, onProgress });
  const statusFinal = processamento.statusFinal || await verificarCompetenciaRealizadoMensal(competencia);
  onProgress?.({ etapa: 'concluido', mensagem: 'Processamento concluído.', status: statusFinal });
  return { validacao, temporaria, processamento, statusFinal };
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
