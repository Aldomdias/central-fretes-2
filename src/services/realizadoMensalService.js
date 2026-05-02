import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const TMP_CHUNK_SIZE = 1000;

function ensureSupabase() {
  const client = getSupabaseClient();
  if (!client || !isSupabaseConfigured()) {
    throw new Error('Supabase não configurado. Confira VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no Vercel.');
  }
  return client;
}

function toSafeNumber(value, max = 999999999999) {
  const number = Number(value || 0);
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
  if (ufLimpa) {
    texto = texto.replace(new RegExp(`\\s+${ufLimpa}$`, 'i'), '');
  }
  return cleanText(texto);
}

function getPesoFinal(row = {}) {
  const declarado = toSafeNumber(row.pesoDeclarado ?? row.peso_declarado);
  const cubado = toSafeNumber(row.pesoCubado ?? row.peso_cubado);
  return Math.max(declarado, cubado, 0);
}

function getCubagem(row = {}) {
  const metros = toSafeNumber(row.metrosCubicos ?? row.metros_cubicos);
  const cubado = toSafeNumber(row.pesoCubado ?? row.peso_cubado);
  return metros > 0 ? metros : cubado;
}

function getVolumes(row = {}) {
  return toSafeNumber(row.volume ?? row.qtdVolumes ?? row.qtd_volumes);
}

function getChaveCte(row = {}) {
  const chave = cleanDigits(row.chaveCte ?? row.chave_cte);
  if (chave) return chave;
  const fallback = [
    row.numeroCte ?? row.numero_cte,
    row.emissao,
    row.transportadora,
    row.cidadeOrigem ?? row.cidade_origem,
    row.cidadeDestino ?? row.cidade_destino,
    row.valorCte ?? row.valor_cte,
  ]
    .map((item) => cleanText(item).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-'))
    .filter(Boolean)
    .join('-')
    .slice(0, 180);
  return fallback ? `cte-sem-chave-${fallback}` : '';
}

export function montarLinhaTemporariaRealizado(row = {}, competencia = '', arquivoOrigem = '') {
  const ufOrigem = cleanUf(row.ufOrigem ?? row.uf_origem);
  const ufDestino = cleanUf(row.ufDestino ?? row.uf_destino);

  return {
    competencia,
    arquivo_origem: cleanText(arquivoOrigem || row.arquivoOrigem || row.arquivo_origem),
    data_emissao: row.emissao || row.dataEmissao || row.data_emissao || null,
    chave_cte: getChaveCte(row),
    numero_cte: cleanText(row.numeroCte ?? row.numero_cte),
    transportadora: cleanText(row.transportadora),
    cnpj_transportadora: cleanDigits(row.cnpjTransportadora ?? row.cnpj_transportadora),
    cidade_origem: cidadeSemUf(row.cidadeOrigem ?? row.cidade_origem, ufOrigem),
    uf_origem: ufOrigem,
    cidade_destino: cidadeSemUf(row.cidadeDestino ?? row.cidade_destino, ufDestino),
    uf_destino: ufDestino,
    peso: getPesoFinal(row),
    cubagem: getCubagem(row),
    valor_nf: toSafeNumber(row.valorNF ?? row.valor_nf),
    valor_cte: toSafeNumber(row.valorCte ?? row.valor_cte),
    qtd_volumes: getVolumes(row),
    canal: cleanText(row.canal || row.canalVendas || row.canais),
    raw: row.raw || {},
  };
}

export function validarRegistrosRealizadoMensal(registros = []) {
  const resumo = {
    total: registros.length,
    semChave: 0,
    semTransportadora: 0,
    semOrigem: 0,
    semDestino: 0,
    semUfOrigem: 0,
    semUfDestino: 0,
    semPeso: 0,
    semValorCte: 0,
    semValorNf: 0,
    semCanal: 0,
  };

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
  });

  return resumo;
}

export async function verificarCompetenciaRealizadoMensal(competencia) {
  const supabase = ensureSupabase();
  const { data, error } = await supabase.rpc('status_realizado_cte_competencia', {
    p_competencia: competencia,
  });
  if (error) throw new Error(`Erro ao consultar competência ${competencia}. Detalhe: ${error.message}`);
  return data || { competencia, detalhado: 0, consolidado: 0, pendencias: 0, temporaria: 0 };
}

export async function limparTemporariaRealizadoMensal(competencia) {
  const supabase = ensureSupabase();
  const { data, error } = await supabase.rpc('limpar_realizado_ctes_import_tmp', {
    p_competencia: competencia,
  });
  if (error) throw new Error(`Erro ao limpar temporária. Detalhe: ${error.message}`);
  return Number(data || 0);
}

export async function subirTemporariaRealizadoMensal({ competencia, arquivoOrigem, registros, onProgress }) {
  const supabase = ensureSupabase();
  const payload = (registros || [])
    .map((row) => montarLinhaTemporariaRealizado(row, competencia, arquivoOrigem))
    .filter((row) => row.chave_cte || row.numero_cte);

  if (!payload.length) {
    throw new Error('Nenhum CT-e válido para subir na temporária. Confira chave/número de CT-e e colunas do arquivo.');
  }

  await limparTemporariaRealizadoMensal(competencia);

  let enviados = 0;
  for (let index = 0; index < payload.length; index += TMP_CHUNK_SIZE) {
    const chunk = payload.slice(index, index + TMP_CHUNK_SIZE);
    const { error } = await supabase.from('realizado_ctes_import_tmp').insert(chunk);
    if (error) {
      throw new Error(`Erro ao salvar temporária no Supabase. Detalhe: ${error.message}`);
    }
    enviados += chunk.length;
    onProgress?.({ enviados, total: payload.length });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return { enviados, total: payload.length };
}

export async function processarRealizadoMensalEnxuto({ competencia, substituir = false }) {
  const supabase = ensureSupabase();
  const { data, error } = await supabase.rpc('processar_realizado_ctes_mensal', {
    p_competencia: competencia,
    p_substituir: Boolean(substituir),
  });
  if (error) {
    throw new Error(`Erro ao processar base enxuta. Detalhe: ${error.message}`);
  }
  return data || {};
}

export async function importarRealizadoMensalEnxuto({ competencia, arquivoOrigem, registros, substituir = false, onProgress }) {
  const validacao = validarRegistrosRealizadoMensal(registros);
  onProgress?.({ etapa: 'validacao', mensagem: 'Colunas validadas.', validacao });

  const status = await verificarCompetenciaRealizadoMensal(competencia);
  if (!substituir && Number(status?.detalhado || 0) > 0) {
    const erro = new Error(`A competência ${competencia} já possui ${Number(status.detalhado).toLocaleString('pt-BR')} CT-e(s) na base enxuta.`);
    erro.statusCompetencia = status;
    throw erro;
  }

  onProgress?.({ etapa: 'temporaria', mensagem: 'Enviando arquivo para tabela temporária...' });
  const temporaria = await subirTemporariaRealizadoMensal({
    competencia,
    arquivoOrigem,
    registros,
    onProgress: (progress) => onProgress?.({ etapa: 'temporaria', mensagem: 'Enviando arquivo para tabela temporária...', ...progress }),
  });

  onProgress?.({ etapa: 'processamento', mensagem: 'Gerando base enxuta, pendências e consolidado...' });
  const processamento = await processarRealizadoMensalEnxuto({ competencia, substituir });

  const statusFinal = await verificarCompetenciaRealizadoMensal(competencia);
  onProgress?.({ etapa: 'concluido', mensagem: 'Processamento concluído.', status: statusFinal });

  return { validacao, temporaria, processamento, statusFinal };
}

export async function listarPendenciasIbgeRealizadoMensal(competencia, limit = 100) {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('realizado_ctes_pendencias_ibge')
    .select('*')
    .eq('competencia', competencia)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Erro ao listar pendências IBGE. Detalhe: ${error.message}`);
  return data || [];
}

export async function resumoBaseEnxutaRealizadoMensal(competencia) {
  const supabase = ensureSupabase();
  const [detalhe, consolidado, pendencias] = await Promise.all([
    supabase.from('realizado_ctes_enxuta').select('chave_cte', { count: 'exact', head: true }).eq('competencia', competencia),
    supabase.from('realizado_ctes_consolidado').select('chave_rota_ibge', { count: 'exact', head: true }).eq('competencia', competencia),
    supabase.from('realizado_ctes_pendencias_ibge').select('chave_cte', { count: 'exact', head: true }).eq('competencia', competencia),
  ]);

  if (detalhe.error) throw detalhe.error;
  if (consolidado.error) throw consolidado.error;
  if (pendencias.error) throw pendencias.error;

  return {
    competencia,
    detalhado: detalhe.count || 0,
    consolidado: consolidado.count || 0,
    pendencias: pendencias.count || 0,
  };
}
