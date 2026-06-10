import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { buildTrackingId, getChaveNfeLookup, parseTrackingArquivo } from '../utils/trackingLocal';

const TABELA_TRACKING = 'tracking_rows';
const CHUNK_SIZE = 500;
const CHAVE_NFE_LOOKUP_CHUNK = 300;

function toNumber(value) {
  if (typeof value === 'string') {
    const normalizado = value.includes(',') ? value.replace(/\./g, '').replace(',', '.') : value;
    const n = Number(normalizado.replace(/[^0-9.-]/g, '') || 0);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function somaRows(rows = []) {
  return (rows || []).reduce((acc, row) => {
    acc.notas += 1;
    acc.valorNF += toNumber(row.valor_nf);
    acc.peso += toNumber(row.peso);
    acc.cubagem += toNumber(row.cubagem_total);
    acc.volumes += toNumber(row.qtd_volumes);
    if (row.ibge_ok) acc.comIbge += 1;
    else acc.semIbge += 1;
    if (row.data) {
      if (!acc.periodoInicio || row.data < acc.periodoInicio) acc.periodoInicio = row.data;
      if (!acc.periodoFim || row.data > acc.periodoFim) acc.periodoFim = row.data;
    }
    return acc;
  }, { notas: 0, valorNF: 0, peso: 0, cubagem: 0, volumes: 0, periodoInicio: '', periodoFim: '', comIbge: 0, semIbge: 0 });
}

function cubagemTotal(row = {}) {
  const totalInformado = toNumber(row.cubagemTotal || row.cubagem_total);
  if (totalInformado > 0) return totalInformado;

  // Nos arquivos de Tracking, CUBAGEM/M3 já representa o total do CT-e.
  return toNumber(row.cubagem);
}

function onlyDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function extrairChaveNfeRegistro(row = {}) {
  const chave = getChaveNfeLookup(row) || onlyDigits(row.chave_nfe);
  if (chave.length >= 20) return chave.slice(0, 44);
  const id = String(row.id || '');
  const match = id.match(/^nf-(\d{20,44})/);
  if (match) return match[1].slice(0, 44);
  return '';
}

function toDbRow(row = {}) {
  const data = row.data || row.dataFaturamento || '';
  const chaveNfe = getChaveNfeLookup(row);
  const id = String(
    row.id
    || buildTrackingId(row, row.arquivoOrigem || '', row.linhaExcel || '')
    || (chaveNfe ? `nf-${chaveNfe}` : '')
    || row.notaFiscal
    || `${Date.now()}-${Math.random()}`
  ).slice(0, 240);
  return {
    id,
    data,
    competencia: row.competencia || (data ? String(data).slice(0, 7) : ''),
    nota_fiscal: row.notaFiscal || row.numeroNf || row.nfNumero || '',
    chave_nfe: chaveNfe || row.chaveNfe || '',
    chave_cte: row.chaveCte || '',
    cte_numero: row.cteNumero || '',
    pedido: row.pedido || '',
    pedido_erp: row.pedidoErp || '',
    canal: row.canal || '',
    canal_original: row.canalOriginal || '',
    transportadora: row.transportadora || '',
    cidade_origem: row.cidadeOrigem || '',
    uf_origem: row.ufOrigem || '',
    ibge_origem: row.ibgeOrigem || '',
    cidade_destino: row.cidadeDestino || '',
    uf_destino: row.ufDestino || '',
    ibge_destino: row.ibgeDestino || '',
    chave_rota_ibge: row.chaveRotaIbge || (row.ibgeOrigem && row.ibgeDestino ? `${row.ibgeOrigem}-${row.ibgeDestino}` : ''),
    peso: toNumber(row.peso),
    peso_declarado: toNumber(row.pesoDeclarado),
    peso_cubado: toNumber(row.pesoCubado || row.pesoCubadoOriginal),
    cubagem_unitaria: toNumber(row.cubagem),
    cubagem_total: cubagemTotal(row),
    valor_nf: toNumber(row.valorNF),
    qtd_volumes: toNumber(row.qtdVolumes),
    previsao_cliente: row.previsaoCliente || null,
    previsao_transportadora: row.prevTransportadora || null,
    data_transporte: row.dataTransporte || null,
    data_entrega: row.entrega || null,
    arquivo_origem: row.arquivoOrigem || '',
    aba_origem: row.abaOrigem || '',
    linha_excel: toNumber(row.linhaExcel),
    ibge_ok: Boolean(row.ibgeOk),
    raw: row.raw || null,
    updated_at: new Date().toISOString(),
  };
}

function deduplicarLinhasTracking(rows = []) {
  const vistos = new Set();
  const unicos = [];
  let duplicadosArquivo = 0;

  (rows || []).forEach((row) => {
    const chave = getChaveNfeLookup(row);
    const chaveDedup = chave || String(row.id || buildTrackingId(row, row.arquivoOrigem || '', row.linhaExcel || ''));
    if (!chaveDedup) return;
    if (vistos.has(chaveDedup)) {
      duplicadosArquivo += 1;
      return;
    }
    vistos.add(chaveDedup);
    unicos.push(row);
  });

  return { unicos, duplicadosArquivo };
}

async function consultarChavesNfeExistentes(supabase, chavesArquivo = [], onProgress) {
  const existentes = new Set();
  const unicas = [...new Set((chavesArquivo || []).map((chave) => onlyDigits(chave)).filter((chave) => chave.length >= 20))];
  if (!unicas.length) return existentes;

  for (let i = 0; i < unicas.length; i += CHAVE_NFE_LOOKUP_CHUNK) {
    const parte = unicas.slice(i, i + CHAVE_NFE_LOOKUP_CHUNK);
    const idsNf = parte.map((chave) => `nf-${chave}`.slice(0, 240));

    const [{ data: porChave, error: erroChave }, { data: porId, error: erroId }] = await Promise.all([
      supabase.from(TABELA_TRACKING).select('chave_nfe').in('chave_nfe', parte),
      supabase.from(TABELA_TRACKING).select('id,chave_nfe').in('id', idsNf),
    ]);

    if (erroChave && erroId) {
      throw new Error(`Erro ao consultar chaves NF existentes: ${erroChave.message || erroId.message}`);
    }

    (porChave || []).forEach((row) => {
      const chave = extrairChaveNfeRegistro(row);
      if (chave) existentes.add(chave);
    });
    (porId || []).forEach((row) => {
      const chave = extrairChaveNfeRegistro(row);
      if (chave) existentes.add(chave);
    });

    onProgress?.({
      etapa: 'filtro',
      mensagem: `Consultando chaves NF na base: ${Math.min(i + parte.length, unicas.length).toLocaleString('pt-BR')} de ${unicas.length.toLocaleString('pt-BR')}...`,
      complementar: { consultadas: Math.min(i + parte.length, unicas.length), totalChaves: unicas.length },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return existentes;
}

function filtrarTrackingPorChaveExistente(rows = [], chavesExistentes = new Set()) {
  const stats = { lidos: rows.length, jaNaBase: 0, novos: 0, semChave: 0 };
  const novos = [];

  rows.forEach((row) => {
    const chave = getChaveNfeLookup(row);
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

export async function importarTrackingSupabase({
  arquivos = [],
  rows: rowsInformados = null,
  modo = 'complementar',
  municipios = [],
  onProgress,
} = {}) {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');

  const supabase = getSupabaseClient();
  let rows = Array.isArray(rowsInformados) ? rowsInformados : [];

  if (!rows.length && arquivos?.length) {
    const detalhes = [];
    for (const file of arquivos) {
      onProgress?.({ etapa: 'leitura', mensagem: `Lendo ${file.name}...` });
      const parsed = await parseTrackingArquivo(file, { municipios });
      rows = rows.concat(parsed.rows || []);
      detalhes.push({ arquivo: file.name, linhas: parsed.rows?.length || 0, abas: parsed.abas });
    }
    onProgress?.({ etapa: 'validacao', mensagem: `${rows.length.toLocaleString('pt-BR')} linha(s) lida(s) do arquivo.` });
  }

  if (!rows.length) throw new Error('Nenhuma linha válida de Tracking encontrada no arquivo.');

  const { unicos, duplicadosArquivo } = deduplicarLinhasTracking(rows);
  let registros = unicos;
  let statsComplementar = {
    lidos: rows.length,
    unicosArquivo: unicos.length,
    duplicadosArquivo,
    jaNaBase: 0,
    novos: unicos.length,
    semChave: 0,
  };

  if (modo === 'complementar') {
    onProgress?.({ etapa: 'filtro', mensagem: 'Consultando chaves NF já gravadas no Supabase...' });
    const chavesArquivo = unicos.map((row) => getChaveNfeLookup(row)).filter(Boolean);
    const existentes = await consultarChavesNfeExistentes(supabase, chavesArquivo, onProgress);
    const filtrado = filtrarTrackingPorChaveExistente(unicos, existentes);
    registros = filtrado.novos;
    statsComplementar = {
      ...statsComplementar,
      ...filtrado.stats,
      unicosArquivo: unicos.length,
      duplicadosArquivo,
    };
    onProgress?.({
      etapa: 'filtro',
      mensagem: `${statsComplementar.novos.toLocaleString('pt-BR')} novo(s), ${statsComplementar.jaNaBase.toLocaleString('pt-BR')} já na base (pulados).`,
      complementar: statsComplementar,
    });

    if (!registros.length) {
      return {
        enviados: 0,
        total: 0,
        duplicadosIgnorados: duplicadosArquivo,
        modo,
        complementar: statsComplementar,
        mensagem: 'Nenhuma linha nova para enviar. Todas as chaves NF do arquivo já estão no Supabase.',
      };
    }
  }

  const resultado = await subirTrackingSupabase(registros, (event) => {
    onProgress?.({
      ...event,
      etapa: 'envio',
      complementar: statsComplementar,
    });
  });

  return {
    ...resultado,
    modo,
    complementar: statsComplementar,
    mensagem: modo === 'complementar'
      ? `${resultado.enviados.toLocaleString('pt-BR')} linha(s) nova(s) gravada(s) no Supabase.`
      : `${resultado.enviados.toLocaleString('pt-BR')} linha(s) gravada(s)/atualizada(s) no Supabase.`,
  };
}

export async function subirTrackingSupabase(rows = [], onProgress) {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  const supabase = getSupabaseClient();
  const payload = [];
  const ids = new Set();
  let duplicadosIgnorados = 0;
  (rows || []).forEach((row) => {
    const item = toDbRow(row);
    if (ids.has(item.id)) {
      duplicadosIgnorados += 1;
      return;
    }
    ids.add(item.id);
    payload.push(item);
  });
  let enviados = 0;

  for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
    const chunk = payload.slice(i, i + CHUNK_SIZE);
    const lote = Math.floor(i / CHUNK_SIZE) + 1;
    const totalLotes = Math.ceil(payload.length / CHUNK_SIZE) || 1;
    const { error } = await supabase
      .from(TABELA_TRACKING)
      .upsert(chunk, { onConflict: 'id' });
    if (error) throw new Error(`Erro ao gravar no Supabase no lote ${lote}/${totalLotes}: ${error.message}`);
    enviados += chunk.length;
    onProgress?.({
      enviados,
      total: payload.length,
      percentual: Math.round((enviados / Math.max(payload.length, 1)) * 100),
      lote,
      totalLotes,
      duplicadosIgnorados,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return { enviados, total: payload.length, duplicadosIgnorados };
}

export async function diagnosticarTrackingSupabase() {
  if (!isSupabaseConfigured()) {
    return { configurado: false, total: 0, periodoInicio: '', periodoFim: '', ultimaAtualizacao: '', erro: 'Supabase nao configurado.' };
  }

  const supabase = getSupabaseClient();
  const { count, error: countError } = await supabase
    .from(TABELA_TRACKING)
    .select('id', { count: 'exact', head: true });
  if (countError) throw new Error(`Erro ao consultar Tracking no Supabase: ${countError.message}`);

  if (!count) {
    return { configurado: true, total: 0, periodoInicio: '', periodoFim: '', ultimaAtualizacao: '' };
  }

  const [{ data: primeira, error: primeiraError }, { data: ultima, error: ultimaError }, { data: atualizada, error: atualizadaError }] = await Promise.all([
    supabase.from(TABELA_TRACKING).select('data').not('data', 'is', null).order('data', { ascending: true }).limit(1),
    supabase.from(TABELA_TRACKING).select('data').not('data', 'is', null).order('data', { ascending: false }).limit(1),
    supabase.from(TABELA_TRACKING).select('updated_at').not('updated_at', 'is', null).order('updated_at', { ascending: false }).limit(1),
  ]);

  const erro = primeiraError || ultimaError || atualizadaError;
  if (erro) throw new Error(`Erro ao consultar periodo do Tracking no Supabase: ${erro.message}`);

  return {
    configurado: true,
    total: count || 0,
    periodoInicio: primeira?.[0]?.data || '',
    periodoFim: ultima?.[0]?.data || '',
    ultimaAtualizacao: atualizada?.[0]?.updated_at || '',
  };
}

export async function resumirTrackingSupabase(options = {}) {
  if (!isSupabaseConfigured()) return { configurado: false, total: 0, erro: 'Supabase nao configurado.' };

  const supabase = getSupabaseClient();
  const pageSize = Number(options.pageSize || 1000);
  const maxRows = Number(options.maxRows || 200000);
  const { count, error: countError } = await supabase
    .from(TABELA_TRACKING)
    .select('id', { count: 'exact', head: true });
  if (countError) throw new Error(`Erro ao contar Tracking no Supabase: ${countError.message}`);

  const total = Number(count || 0);
  let acumulado = { notas: 0, valorNF: 0, peso: 0, cubagem: 0, volumes: 0, periodoInicio: '', periodoFim: '', comIbge: 0, semIbge: 0 };
  const limiteLeitura = Math.min(total, maxRows);

  for (let from = 0; from < limiteLeitura; from += pageSize) {
    const to = Math.min(from + pageSize - 1, limiteLeitura - 1);
    const { data, error } = await supabase
      .from(TABELA_TRACKING)
      .select('data,valor_nf,peso,cubagem_total,qtd_volumes,ibge_ok')
      .range(from, to);
    if (error) throw new Error(`Erro ao resumir Tracking no Supabase: ${error.message}`);

    const parcial = somaRows(data || []);
    acumulado = {
      notas: acumulado.notas + parcial.notas,
      valorNF: acumulado.valorNF + parcial.valorNF,
      peso: acumulado.peso + parcial.peso,
      cubagem: acumulado.cubagem + parcial.cubagem,
      volumes: acumulado.volumes + parcial.volumes,
      periodoInicio: !acumulado.periodoInicio || (parcial.periodoInicio && parcial.periodoInicio < acumulado.periodoInicio) ? parcial.periodoInicio : acumulado.periodoInicio,
      periodoFim: !acumulado.periodoFim || (parcial.periodoFim && parcial.periodoFim > acumulado.periodoFim) ? parcial.periodoFim : acumulado.periodoFim,
      comIbge: acumulado.comIbge + parcial.comIbge,
      semIbge: acumulado.semIbge + parcial.semIbge,
    };
  }

  return {
    configurado: true,
    total,
    totalLido: limiteLeitura,
    parcial: total > limiteLeitura,
    ...acumulado,
  };
}

function fromDbRow(row = {}) {
  return {
    id: row.id,
    data: row.data || '',
    notaFiscal: row.nota_fiscal || '',
    chaveNfe: row.chave_nfe || '',
    chaveCte: row.chave_cte || '',
    cteNumero: row.cte_numero || '',
    pedido: row.pedido || '',
    pedidoErp: row.pedido_erp || '',
    canal: row.canal || '',
    canalOriginal: row.canal_original || '',
    transportadora: row.transportadora || '',
    cidadeOrigem: row.cidade_origem || '',
    ufOrigem: row.uf_origem || '',
    ibgeOrigem: row.ibge_origem || '',
    cidadeDestino: row.cidade_destino || '',
    ufDestino: row.uf_destino || '',
    ibgeDestino: row.ibge_destino || '',
    chaveRotaIbge: row.chave_rota_ibge || '',
    peso: toNumber(row.peso),
    pesoDeclarado: toNumber(row.peso_declarado),
    pesoCubadoOriginal: toNumber(row.peso_cubado),
    cubagem: toNumber(row.cubagem_unitaria),
    cubagemTotal: toNumber(row.cubagem_total),
    valorNF: toNumber(row.valor_nf),
    qtdVolumes: toNumber(row.qtd_volumes),
    previsaoCliente: row.previsao_cliente || '',
    prevTransportadora: row.previsao_transportadora || '',
    dataTransporte: row.data_transporte || '',
    entrega: row.data_entrega || '',
    arquivoOrigem: row.arquivo_origem || '',
    abaOrigem: row.aba_origem || '',
    linhaExcel: row.linha_excel || '',
    ibgeOk: Boolean(row.ibge_ok),
  };
}

export async function listarTrackingSupabase(options = {}) {
  if (!isSupabaseConfigured()) return { rows: [], erro: 'Supabase nao configurado.' };

  const supabase = getSupabaseClient();
  const limit = Number(options.limit || 50);
  const { data, error } = await supabase
    .from(TABELA_TRACKING)
    .select(`
      id,data,nota_fiscal,chave_nfe,chave_cte,cte_numero,pedido,pedido_erp,canal,canal_original,
      transportadora,cidade_origem,uf_origem,ibge_origem,cidade_destino,uf_destino,ibge_destino,
      chave_rota_ibge,peso,peso_declarado,peso_cubado,cubagem_unitaria,cubagem_total,valor_nf,
      qtd_volumes,previsao_cliente,previsao_transportadora,data_transporte,data_entrega,
      arquivo_origem,aba_origem,linha_excel,ibge_ok,updated_at
    `)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Erro ao listar Tracking no Supabase: ${error.message}`);
  return { rows: (data || []).map(fromDbRow), fonte: 'supabase' };
}
