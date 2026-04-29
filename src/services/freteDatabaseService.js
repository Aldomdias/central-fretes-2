import { getSupabaseClient, getSupabaseInfo, isSupabaseConfigured } from '../lib/supabaseClient';

const SNAPSHOT_CHAVE = 'cadastro-fretes-principal';
const FALLBACK_KEY = 'simulador-fretes-local-v6';
const PAGE_SIZE = 1000;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ensureClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error(
      'Supabase não configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.'
    );
  }
  return client;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function generateUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const hex = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

function safeUuid(value, usedIds) {
  const raw = String(value || '').trim();
  if (UUID_REGEX.test(raw) && !usedIds.has(raw)) {
    usedIds.add(raw);
    return raw;
  }
  let generated = generateUuid();
  while (usedIds.has(generated)) generated = generateUuid();
  usedIds.add(generated);
  return generated;
}

function toNumberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const normalized = Number(String(value).replace(',', '.'));
  return Number.isFinite(normalized) ? normalized : null;
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['true', '1', 'sim', 'yes'].includes(normalized);
  }
  return Boolean(value);
}

function buildSnapshotPayload(transportadoras, chave = SNAPSHOT_CHAVE) {
  return {
    chave,
    payload: {
      transportadoras: clone(transportadoras),
      updatedAt: new Date().toISOString(),
    },
  };
}

async function fetchAllRows(supabase, table, orderBy = null, ascending = true) {
  const allRows = [];
  let from = 0;

  while (true) {
    let query = supabase.from(table).select('*').range(from, from + PAGE_SIZE - 1);
    if (orderBy) query = query.order(orderBy, { ascending });

    const { data, error } = await query;
    if (error) throw error;

    const rows = data || [];
    allRows.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return allRows;
}

function normalizeOrigemFromDb(origem, generalidade, rotas, cotacoes, taxasEspeciais) {
  return {
    id: origem.id,
    cidade: origem.cidade || '',
    canal: origem.canal || 'ATACADO',
    status: origem.status || 'Ativa',
    generalidades: {
      incideIcms: Boolean(generalidade?.incide_icms),
      aliquotaIcms: generalidade?.aliquota_icms ?? 0,
      adValorem: generalidade?.ad_valorem ?? 0,
      adValoremMinimo: generalidade?.ad_valorem_minimo ?? 0,
      pedagio: generalidade?.pedagio ?? 0,
      gris: generalidade?.gris ?? 0,
      grisMinimo: generalidade?.gris_minimo ?? 0,
      tas: generalidade?.tas ?? 0,
      ctrc: generalidade?.ctrc ?? 0,
      cubagem: generalidade?.cubagem ?? 300,
      tipoCalculo: generalidade?.tipo_calculo || 'PERCENTUAL',
      observacoes: generalidade?.observacoes || '',
      freteMinimo: generalidade?.frete_minimo ?? 0,
      regraCalculo: generalidade?.regra_calculo || '',
    },
    rotas: rotas.map((item) => ({
      id: item.id,
      nomeRota: item.nome_rota || '',
      ibgeOrigem: item.ibge_origem || '',
      ibgeDestino: item.ibge_destino || '',
      canal: item.canal || origem.canal || 'ATACADO',
      prazoEntregaDias: item.prazo_entrega_dias ?? 0,
      valorMinimoFrete: item.valor_minimo_frete ?? 0,
      codigoUnidade: item.codigo_unidade || '',
      cepInicial: item.cep_inicial || '',
      cepFinal: item.cep_final || '',
      metodoEnvio: item.metodo_envio || '',
      inicioVigencia: item.inicio_vigencia || '',
      fimVigencia: item.fim_vigencia || '',
      ...(item.extra || {}),
    })),
    cotacoes: cotacoes.map((item) => ({
      id: item.id,
      rota: item.rota || '',
      pesoMin: item.peso_min ?? 0,
      pesoMax: item.peso_max ?? 0,
      rsKg: item.rs_kg ?? 0,
      excesso: item.excesso ?? 0,
      percentual: item.percentual ?? 0,
      valorFixo: item.valor_fixo ?? 0,
      ...(item.extra || {}),
    })),
    taxasEspeciais: taxasEspeciais.map((item) => ({
      id: item.id,
      ibgeDestino: item.ibge_destino || '',
      tda: item.tda ?? 0,
      tdr: item.tdr ?? 0,
      trt: item.trt ?? 0,
      suframa: item.suframa ?? 0,
      outras: item.outras ?? 0,
      gris: item.gris,
      grisMinimo: item.gris_minimo,
      adVal: item.ad_val,
      adValMinimo: item.ad_val_minimo,
      ...(item.extra || {}),
    })),
  };
}

function mapBaseToTables(transportadoras) {
  const transportadorasRows = [];
  const origensRows = [];
  const generalidadesRows = [];
  const rotasRows = [];
  const cotacoesRows = [];
  const taxasRows = [];

  const usedTransportadoras = new Set();
  const usedOrigens = new Set();
  const usedRotas = new Set();
  const usedCotacoes = new Set();
  const usedTaxas = new Set();

  (transportadoras || []).forEach((transportadora) => {
    const transportadoraId = safeUuid(transportadora.id, usedTransportadoras);

    transportadorasRows.push({
      id: transportadoraId,
      nome: transportadora.nome || '',
      status: transportadora.status || 'Ativa',
    });

    (transportadora.origens || []).forEach((origem) => {
      const origemId = safeUuid(origem.id, usedOrigens);
      const generalidades = origem.generalidades || {};

      origensRows.push({
        id: origemId,
        transportadora_id: transportadoraId,
        cidade: origem.cidade || '',
        canal: origem.canal || 'ATACADO',
        status: origem.status || 'Ativa',
      });

      generalidadesRows.push({
        origem_id: origemId,
        incide_icms: toBoolean(generalidades.incideIcms),
        aliquota_icms: toNumberOrNull(generalidades.aliquotaIcms),
        ad_valorem: toNumberOrNull(generalidades.adValorem),
        ad_valorem_minimo: toNumberOrNull(generalidades.adValoremMinimo),
        pedagio: toNumberOrNull(generalidades.pedagio),
        gris: toNumberOrNull(generalidades.gris),
        gris_minimo: toNumberOrNull(generalidades.grisMinimo),
        tas: toNumberOrNull(generalidades.tas),
        ctrc: toNumberOrNull(generalidades.ctrc),
        cubagem: toNumberOrNull(generalidades.cubagem),
        tipo_calculo: generalidades.tipoCalculo || 'PERCENTUAL',
        observacoes: generalidades.observacoes || '',
        frete_minimo: toNumberOrNull(generalidades.freteMinimo),
        regra_calculo: generalidades.regraCalculo || '',
      });

      (origem.rotas || []).forEach((item) => {
        const {
          id, nomeRota, ibgeOrigem, ibgeDestino, canal, prazoEntregaDias,
          valorMinimoFrete, codigoUnidade, cepInicial, cepFinal, metodoEnvio,
          inicioVigencia, fimVigencia, ...extra
        } = item || {};

        rotasRows.push({
          id: safeUuid(id, usedRotas),
          origem_id: origemId,
          nome_rota: nomeRota || '',
          ibge_origem: ibgeOrigem || '',
          ibge_destino: ibgeDestino || '',
          canal: canal || origem.canal || 'ATACADO',
          prazo_entrega_dias: toNumberOrNull(prazoEntregaDias),
          valor_minimo_frete: toNumberOrNull(valorMinimoFrete),
          codigo_unidade: codigoUnidade || '',
          cep_inicial: cepInicial || '',
          cep_final: cepFinal || '',
          metodo_envio: metodoEnvio || '',
          inicio_vigencia: inicioVigencia || '',
          fim_vigencia: fimVigencia || '',
          extra,
        });
      });

      (origem.cotacoes || []).forEach((item) => {
        const { id, rota, pesoMin, pesoMax, rsKg, excesso, percentual, valorFixo, ...extra } =
          item || {};

        cotacoesRows.push({
          id: safeUuid(id, usedCotacoes),
          origem_id: origemId,
          rota: rota || '',
          peso_min: toNumberOrNull(pesoMin),
          peso_max: toNumberOrNull(pesoMax),
          rs_kg: toNumberOrNull(rsKg),
          excesso: toNumberOrNull(excesso),
          percentual: toNumberOrNull(percentual),
          valor_fixo: toNumberOrNull(valorFixo),
          extra,
        });
      });

      (origem.taxasEspeciais || []).forEach((item) => {
        const { id, ibgeDestino, tda, tdr, trt, suframa, outras, gris, grisMinimo, adVal, adValMinimo, ...extra } = item || {};

        taxasRows.push({
          id: safeUuid(id, usedTaxas),
          origem_id: origemId,
          ibge_destino: ibgeDestino || '',
          tda: toNumberOrNull(tda),
          tdr: toNumberOrNull(tdr),
          trt: toNumberOrNull(trt),
          suframa: toNumberOrNull(suframa),
          outras: toNumberOrNull(outras),
          gris: toNumberOrNull(gris),
          gris_minimo: toNumberOrNull(grisMinimo),
          ad_val: toNumberOrNull(adVal),
          ad_val_minimo: toNumberOrNull(adValMinimo),
          extra,
        });
      });
    });
  });

  return {
    transportadorasRows,
    origensRows,
    generalidadesRows,
    rotasRows,
    cotacoesRows,
    taxasRows,
  };
}


async function fetchTransportadorasByNome(supabase, nomes = []) {
  const normalized = Array.from(
    new Set(
      (nomes || [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )
  );

  if (!normalized.length) return [];

  const rows = [];
  const chunkSize = 200;
  for (let index = 0; index < normalized.length; index += chunkSize) {
    const chunk = normalized.slice(index, index + chunkSize);
    const { data, error } = await supabase
      .from('transportadoras')
      .select('id, nome')
      .in('nome', chunk);

    if (error) throw error;
    rows.push(...(data || []));
  }

  return rows;
}

function applyExistingTransportadoraIds(mapped, existentes = []) {
  const byNome = new Map(
    (existentes || []).map((item) => [String(item.nome || '').trim().toLowerCase(), item.id])
  );

  if (!byNome.size) return mapped;

  const transportadoraIdMap = new Map();
  const transportadorasRows = (mapped.transportadorasRows || []).map((row) => {
    const nomeKey = String(row.nome || '').trim().toLowerCase();
    const existingId = byNome.get(nomeKey);
    if (existingId && row.id !== existingId) {
      transportadoraIdMap.set(row.id, existingId);
      return { ...row, id: existingId };
    }
    return row;
  });

  if (!transportadoraIdMap.size) {
    return { ...mapped, transportadorasRows };
  }

  const remapOrigem = (row) => ({
    ...row,
    transportadora_id: transportadoraIdMap.get(row.transportadora_id) || row.transportadora_id,
  });

  return {
    ...mapped,
    transportadorasRows,
    origensRows: (mapped.origensRows || []).map(remapOrigem),
  };
}

function origemKey(row = {}) {
  return [
    String(row.transportadora_id || '').trim(),
    String(row.cidade || '').trim().toLowerCase(),
    String(row.canal || 'ATACADO').trim().toUpperCase(),
  ].join('__');
}

async function fetchOrigensExistentes(supabase, origensRows = []) {
  const transportadoraIds = Array.from(
    new Set((origensRows || []).map((row) => row.transportadora_id).filter(Boolean))
  );

  if (!transportadoraIds.length) return [];

  const rows = [];
  const chunkSize = 200;

  for (let index = 0; index < transportadoraIds.length; index += chunkSize) {
    const chunk = transportadoraIds.slice(index, index + chunkSize);
    const { data, error } = await supabase
      .from('origens')
      .select('id, transportadora_id, cidade, canal')
      .in('transportadora_id', chunk);

    if (error) throw error;
    rows.push(...(data || []));
  }

  const wanted = new Set((origensRows || []).map(origemKey));
  return rows.filter((row) => wanted.has(origemKey(row)));
}

function applyExistingOrigemIds(mapped, existentes = []) {
  const byKey = new Map((existentes || []).map((item) => [origemKey(item), item.id]));
  if (!byKey.size) return mapped;

  const origemIdMap = new Map();
  const origensRows = (mapped.origensRows || []).map((row) => {
    const existingId = byKey.get(origemKey(row));
    if (existingId && row.id !== existingId) {
      origemIdMap.set(row.id, existingId);
      return { ...row, id: existingId };
    }
    return row;
  });

  if (!origemIdMap.size) return { ...mapped, origensRows };

  const remapOrigemId = (row) => ({
    ...row,
    origem_id: origemIdMap.get(row.origem_id) || row.origem_id,
  });

  return {
    ...mapped,
    origensRows,
    generalidadesRows: (mapped.generalidadesRows || []).map(remapOrigemId),
    rotasRows: (mapped.rotasRows || []).map(remapOrigemId),
    cotacoesRows: (mapped.cotacoesRows || []).map(remapOrigemId),
    taxasRows: (mapped.taxasRows || []).map(remapOrigemId),
  };
}

function sanitizeImportacaoPayload(payload = {}) {
  const tipo = String(payload.tipo || '').trim();
  const canal = String(payload.canal || '').trim();
  const arquivo = String(payload.arquivo || '').trim();
  const inseridos = Number(payload.inseridos || 0) || 0;
  const erros = Array.isArray(payload.erros) ? payload.erros : [];
  const meta = payload.meta && typeof payload.meta === 'object' ? payload.meta : null;
  const duracaoMs = Number(payload.duracaoMs || payload.duracao_ms || 0) || 0;
  const status = erros.length ? (inseridos > 0 ? 'parcial' : 'erro') : 'sucesso';

  return {
    arquivo,
    tipo,
    canal,
    inseridos,
    erros,
    meta,
    duracao_ms: duracaoMs || null,
    status,
  };
}

async function upsertRows(supabase, table, rows, conflictField) {
  if (!rows.length) return;
  const chunkSize = 500;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: conflictField });
    if (error) {
      throw new Error(`Erro ao gravar ${table}: ${error.message || error.details || 'erro desconhecido'}`);
    }
  }
}

export function bancoConfigurado() {
  return isSupabaseConfigured();
}

export async function carregarSnapshotFretesDb(chave = SNAPSHOT_CHAVE) {
  if (!isSupabaseConfigured()) {
    const raw = localStorage.getItem(FALLBACK_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  const supabase = ensureClient();
  const { data, error } = await supabase
    .from('cadastros_snapshot')
    .select('id, chave, payload, updated_at, created_at')
    .eq('chave', chave)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

export async function carregarBaseCompletaDb() {
  if (!isSupabaseConfigured()) {
    const raw = localStorage.getItem(FALLBACK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : parsed?.payload?.transportadoras || [];
  }

  const supabase = ensureClient();

  const [transportadoras, origens, generalidades, rotas, cotacoes, taxas] =
    await Promise.all([
      fetchAllRows(supabase, 'transportadoras', 'nome', true),
      fetchAllRows(supabase, 'origens', 'cidade', true),
      fetchAllRows(supabase, 'generalidades'),
      fetchAllRows(supabase, 'rotas'),
      fetchAllRows(supabase, 'cotacoes'),
      fetchAllRows(supabase, 'taxas_especiais'),
    ]);

  const generalidadeByOrigem = new Map(generalidades.map((item) => [String(item.origem_id), item]));
  const rotasByOrigem = new Map();
  const cotacoesByOrigem = new Map();
  const taxasByOrigem = new Map();

  rotas.forEach((item) => {
    const key = String(item.origem_id);
    const list = rotasByOrigem.get(key) || [];
    list.push(item);
    rotasByOrigem.set(key, list);
  });

  cotacoes.forEach((item) => {
    const key = String(item.origem_id);
    const list = cotacoesByOrigem.get(key) || [];
    list.push(item);
    cotacoesByOrigem.set(key, list);
  });

  taxas.forEach((item) => {
    const key = String(item.origem_id);
    const list = taxasByOrigem.get(key) || [];
    list.push(item);
    taxasByOrigem.set(key, list);
  });

  const origensByTransportadora = new Map();

  origens.forEach((origem) => {
    const key = String(origem.transportadora_id);
    const list = origensByTransportadora.get(key) || [];
    list.push(
      normalizeOrigemFromDb(
        origem,
        generalidadeByOrigem.get(String(origem.id)),
        rotasByOrigem.get(String(origem.id)) || [],
        cotacoesByOrigem.get(String(origem.id)) || [],
        taxasByOrigem.get(String(origem.id)) || []
      )
    );
    origensByTransportadora.set(key, list);
  });

  return transportadoras.map((transportadora) => ({
    id: transportadora.id,
    nome: transportadora.nome || '',
    status: transportadora.status || 'Ativa',
    origens: origensByTransportadora.get(String(transportadora.id)) || [],
  }));
}

export async function carregarResumoBaseDb() {
  if (!isSupabaseConfigured()) {
    const raw = localStorage.getItem(FALLBACK_KEY);
    if (!raw) return { transportadoras: [], resumo: { transportadoras: 0, origens: 0, rotas: 0, cotacoes: 0 } };
    const parsed = JSON.parse(raw);
    const transportadoras = Array.isArray(parsed) ? parsed : parsed?.payload?.transportadoras || [];
    const origens = transportadoras.flatMap((item) => item.origens || []);
    return {
      transportadoras,
      resumo: {
        transportadoras: transportadoras.length,
        origens: origens.length,
        rotas: origens.reduce((acc, origem) => acc + (origem.rotas?.length || 0), 0),
        cotacoes: origens.reduce((acc, origem) => acc + (origem.cotacoes?.length || 0), 0),
      },
    };
  }

  const supabase = ensureClient();

  const [
    transportadorasResponse,
    origensResponse,
    rotasCountResponse,
    cotacoesCountResponse,
  ] = await Promise.all([
    supabase.from('transportadoras').select('id, nome, status').order('nome', { ascending: true }),
    supabase.from('origens').select('id, transportadora_id, cidade, canal, status').order('cidade', { ascending: true }),
    supabase.from('rotas').select('id', { count: 'exact', head: true }),
    supabase.from('cotacoes').select('id', { count: 'exact', head: true }),
  ]);

  if (transportadorasResponse.error) throw transportadorasResponse.error;
  if (origensResponse.error) throw origensResponse.error;
  if (rotasCountResponse.error) throw rotasCountResponse.error;
  if (cotacoesCountResponse.error) throw cotacoesCountResponse.error;

  const origensByTransportadora = new Map();
  (origensResponse.data || []).forEach((origem) => {
    const key = String(origem.transportadora_id);
    const lista = origensByTransportadora.get(key) || [];
    lista.push({
      id: origem.id,
      cidade: origem.cidade || '',
      canal: origem.canal || 'ATACADO',
      status: origem.status || 'Ativa',
      generalidades: {},
      rotas: [],
      cotacoes: [],
      taxasEspeciais: [],
    });
    origensByTransportadora.set(key, lista);
  });

  let coberturaPorTransportadora = new Map();

  try {
    const { data: coberturaRows, error: coberturaError } = await supabase
      .from('vw_cobertura_transportadoras')
      .select('*');

    if (!coberturaError) {
      coberturaPorTransportadora = new Map(
        (coberturaRows || []).map((row) => [
          String(row.transportadora_id),
          {
            cobertura: row.status_cobertura || 'Resumo',
            severidade:
              row.status_cobertura === 'Inconsistente'
                ? 'error'
                : row.status_cobertura === 'Parcial'
                  ? 'warn'
                  : 'ok',
            inconsistentes: Number(row.origens_inconsistentes || 0),
            pendencias: Number(row.origens_pendentes || 0),
            faltandoFrete: Number(row.rotas_sem_frete || 0),
            faltandoRota: Number(row.fretes_sem_rota || 0),
            totalRotas: Number(row.total_rotas || 0),
            totalCotacoes: Number(row.total_cotacoes || 0),
            resumo: false,
          },
        ])
      );
    }
  } catch {
    coberturaPorTransportadora = new Map();
  }

  const transportadoras = (transportadorasResponse.data || []).map((transportadora) => ({
    id: transportadora.id,
    nome: transportadora.nome || '',
    status: transportadora.status || 'Ativa',
    resumoCobertura: coberturaPorTransportadora.get(String(transportadora.id)) || {
      cobertura: 'Sem validação',
      severidade: 'warn',
      inconsistentes: 0,
      pendencias: 0,
      faltandoFrete: 0,
      faltandoRota: 0,
      totalRotas: 0,
      totalCotacoes: 0,
      resumo: true,
    },
    origens: origensByTransportadora.get(String(transportadora.id)) || [],
  }));

  return {
    transportadoras,
    resumo: {
      transportadoras: transportadoras.length,
      origens: (origensResponse.data || []).length,
      rotas: rotasCountResponse.count || 0,
      cotacoes: cotacoesCountResponse.count || 0,
    },
  };
}

export async function salvarSecaoDb(transportadoras, secao, chave = SNAPSHOT_CHAVE, options = {}) {
  if (!isSupabaseConfigured()) {
    const payload = buildSnapshotPayload(transportadoras, chave);
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(payload));
    return { modo: 'local', secao, updated_at: payload.payload.updatedAt };
  }

  const supabase = ensureClient();
  let {
    transportadorasRows,
    origensRows,
    generalidadesRows,
    rotasRows,
    cotacoesRows,
    taxasRows,
  } = mapBaseToTables(transportadoras);

  const transportadorasExistentes = await fetchTransportadorasByNome(
    supabase,
    transportadorasRows.map((item) => item.nome)
  );

  ({
    transportadorasRows,
    origensRows,
    generalidadesRows,
    rotasRows,
    cotacoesRows,
    taxasRows,
  } = applyExistingTransportadoraIds(
    { transportadorasRows, origensRows, generalidadesRows, rotasRows, cotacoesRows, taxasRows },
    transportadorasExistentes
  ));

  const origensExistentes = await fetchOrigensExistentes(supabase, origensRows);

  ({
    transportadorasRows,
    origensRows,
    generalidadesRows,
    rotasRows,
    cotacoesRows,
    taxasRows,
  } = applyExistingOrigemIds(
    { transportadorasRows, origensRows, generalidadesRows, rotasRows, cotacoesRows, taxasRows },
    origensExistentes
  ));

  await upsertRows(supabase, 'transportadoras', transportadorasRows, 'id');
  await upsertRows(supabase, 'origens', origensRows, 'id');

  if (secao === 'generalidades') {
    await upsertRows(supabase, 'generalidades', generalidadesRows, 'origem_id');
  }
  if (secao === 'rotas') {
    await upsertRows(supabase, 'rotas', rotasRows, 'id');
  }
  if (secao === 'cotacoes') {
    await upsertRows(supabase, 'cotacoes', cotacoesRows, 'id');
  }
  if (secao === 'taxas') {
    await upsertRows(supabase, 'taxas_especiais', taxasRows, 'id');
  }

  if (options.atualizarSnapshot !== true) {
    return { modo: 'supabase', secao, updated_at: new Date().toISOString(), snapshot: 'ignorado' };
  }

  const payload = buildSnapshotPayload(transportadoras, chave);
  const { data, error } = await supabase
    .from('cadastros_snapshot')
    .upsert(payload, { onConflict: 'chave' })
    .select('id, updated_at')
    .single();

  if (error) throw error;
  return { modo: 'supabase', secao, updated_at: data?.updated_at };
}

export async function salvarBaseCompletaDb(transportadoras, chave = SNAPSHOT_CHAVE) {
  if (!isSupabaseConfigured()) {
    const payload = buildSnapshotPayload(transportadoras, chave);
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(payload));
    return { modo: 'local', updated_at: payload.payload.updatedAt };
  }

  const supabase = ensureClient();
  const payload = buildSnapshotPayload(transportadoras, chave);
  const { data, error } = await supabase
    .from('cadastros_snapshot')
    .upsert(payload, { onConflict: 'chave' })
    .select('id, updated_at')
    .single();

  if (error) throw error;
  return { modo: 'supabase', updated_at: data?.updated_at };
}

export async function salvarSnapshotFretesDb(transportadoras, chave = SNAPSHOT_CHAVE) {
  return salvarBaseCompletaDb(transportadoras, chave);
}

export async function testarConexaoFretesDb() {
  if (!isSupabaseConfigured()) {
    return { ok: false, mensagem: 'Supabase não configurado.' };
  }

  const supabase = ensureClient();
  const { error } = await supabase.from('transportadoras').select('id').limit(1);
  if (error) throw error;
  return { ok: true, mensagem: 'Conexão com Supabase validada.' };
}

export async function salvarSnapshotBase(payload, metadata = {}) {
  const transportadoras = Array.isArray(payload) ? payload : payload?.transportadoras || [];
  return salvarBaseCompletaDb(transportadoras, metadata.chave || SNAPSHOT_CHAVE);
}

export async function buscarUltimoSnapshot() {
  return carregarSnapshotFretesDb();
}




async function fetchRowsByOrigemIds(supabase, table, origemIds = []) {
  const ids = Array.from(new Set((origemIds || []).filter(Boolean)));
  if (!ids.length) return [];

  const rows = [];
  const chunkSize = 100;

  for (let index = 0; index < ids.length; index += chunkSize) {
    const chunk = ids.slice(index, index + chunkSize);
    let from = 0;

    while (true) {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .in('origem_id', chunk)
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;

      const page = data || [];
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }

  return rows;
}

async function fetchRotasByOrigemIds(supabase, origemIds = [], destinos = []) {
  const ids = Array.from(new Set((origemIds || []).filter(Boolean)));
  const destinosNormalizados = Array.from(new Set((destinos || []).map((item) => String(item || '').trim()).filter(Boolean)));

  if (!ids.length) return [];

  const rows = [];
  const chunkSize = 100;

  for (let index = 0; index < ids.length; index += chunkSize) {
    const chunk = ids.slice(index, index + chunkSize);
    let from = 0;

    while (true) {
      let query = supabase
        .from('rotas')
        .select('*')
        .in('origem_id', chunk);

      if (destinosNormalizados.length) {
        query = query.in('ibge_destino', destinosNormalizados);
      }

      const { data, error } = await query.range(from, from + PAGE_SIZE - 1);

      if (error) throw error;

      const page = data || [];
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }

  return rows;
}

function ufFromIbgeLike(value) {
  const ibge = String(value || '').replace(/\D/g, '');
  if (!ibge) return '';
  const prefix = ibge.slice(0, 2);
  const map = {
    '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
    '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
    '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
    '41': 'PR', '42': 'SC', '43': 'RS',
    '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
  };
  return map[prefix] || '';
}

async function buscarDestinosTransportadoraOrigem({ supabase, nomeTransportadora, origem, canal, ufDestino = '' }) {
  const { data: transportadorasAlvo, error: transportadoraError } = await supabase
    .from('transportadoras')
    .select('id, nome, status')
    .ilike('nome', nomeTransportadora);

  if (transportadoraError) throw transportadoraError;
  const alvoIds = (transportadorasAlvo || []).map((item) => item.id);
  if (!alvoIds.length) return [];

  let origensQuery = supabase
    .from('origens')
    .select('id, cidade, canal, transportadora_id')
    .in('transportadora_id', alvoIds);

  if (canal) origensQuery = origensQuery.eq('canal', canal);
  if (origem) origensQuery = origensQuery.ilike('cidade', origem);

  let { data: origensAlvo, error: origensAlvoError } = await origensQuery;
  if (origensAlvoError) throw origensAlvoError;

  if (origem && !(origensAlvo || []).length) {
    let fallbackQuery = supabase
      .from('origens')
      .select('id, cidade, canal, transportadora_id')
      .in('transportadora_id', alvoIds)
      .ilike('cidade', `%${origem}%`);

    if (canal) fallbackQuery = fallbackQuery.eq('canal', canal);

    const fallback = await fallbackQuery;
    if (fallback.error) throw fallback.error;
    origensAlvo = fallback.data || [];
  }

  const origemIds = (origensAlvo || []).map((item) => item.id);
  if (!origemIds.length) return [];

  const rotasAlvo = await fetchRotasByOrigemIds(supabase, origemIds, []);
  const uf = String(ufDestino || '').trim().toUpperCase();

  return Array.from(new Set(
    (rotasAlvo || [])
      .map((rota) => String(rota.ibge_destino || rota.ibgeDestino || '').replace(/\D/g, ''))
      .filter(Boolean)
      .filter((ibge) => !uf || ufFromIbgeLike(ibge) === uf)
  ));
}

function groupByOrigemId(rows = []) {
  const map = new Map();
  rows.forEach((row) => {
    const key = String(row.origem_id);
    const list = map.get(key) || [];
    list.push(row);
    map.set(key, list);
  });
  return map;
}

function transportadorasFromDbRows({ transportadoras = [], origens = [], generalidades = [], rotas = [], cotacoes = [], taxas = [] }) {
  const generalidadeByOrigem = new Map((generalidades || []).map((item) => [String(item.origem_id), item]));
  const rotasByOrigem = groupByOrigemId(rotas);
  const cotacoesByOrigem = groupByOrigemId(cotacoes);
  const taxasByOrigem = groupByOrigemId(taxas);

  const origensByTransportadora = new Map();
  (origens || []).forEach((origem) => {
    const key = String(origem.transportadora_id);
    const list = origensByTransportadora.get(key) || [];
    list.push(normalizeOrigemFromDb(
      origem,
      generalidadeByOrigem.get(String(origem.id)),
      rotasByOrigem.get(String(origem.id)) || [],
      cotacoesByOrigem.get(String(origem.id)) || [],
      taxasByOrigem.get(String(origem.id)) || []
    ));
    origensByTransportadora.set(key, list);
  });

  return (transportadoras || []).map((transportadora) => ({
    id: transportadora.id,
    nome: transportadora.nome || '',
    status: transportadora.status || 'Ativa',
    detalheCarregado: true,
    origens: origensByTransportadora.get(String(transportadora.id)) || [],
  })).filter((item) => item.origens.length);
}

async function buscarBasePorOrigemDestino({ supabase, origem, canal, destinos = [] }) {
  const destinosNormalizados = Array.from(new Set((destinos || []).map((item) => String(item || '').trim()).filter(Boolean)));

  let origensQuery = supabase
    .from('origens')
    .select('id, transportadora_id, cidade, canal, status');

  if (origem) origensQuery = origensQuery.ilike('cidade', origem);
  if (canal) origensQuery = origensQuery.eq('canal', canal);

  let { data: origensBase, error: origensError } = await origensQuery;
  if (origensError) throw origensError;

  if (origem && !(origensBase || []).length) {
    let fallbackQuery = supabase
      .from('origens')
      .select('id, transportadora_id, cidade, canal, status')
      .ilike('cidade', `%${origem}%`);

    if (canal) fallbackQuery = fallbackQuery.eq('canal', canal);

    const fallback = await fallbackQuery;
    if (fallback.error) throw fallback.error;
    origensBase = fallback.data || [];
  }

  const origemIdsBase = (origensBase || []).map((item) => item.id);
  if (!origemIdsBase.length) return [];

  const rotas = await fetchRotasByOrigemIds(supabase, origemIdsBase, destinosNormalizados);

  const origemIdsComRota = Array.from(new Set((rotas || []).map((item) => item.origem_id)));
  if (!origemIdsComRota.length) return [];

  const origens = (origensBase || []).filter((item) => origemIdsComRota.includes(item.id));
  const transportadoraIds = Array.from(new Set(origens.map((item) => item.transportadora_id).filter(Boolean)));

  const [
    transportadorasResponse,
    generalidades,
    cotacoes,
    taxas,
  ] = await Promise.all([
    supabase.from('transportadoras').select('id, nome, status').in('id', transportadoraIds),
    fetchRowsByOrigemIds(supabase, 'generalidades', origemIdsComRota),
    fetchRowsByOrigemIds(supabase, 'cotacoes', origemIdsComRota),
    fetchRowsByOrigemIds(supabase, 'taxas_especiais', origemIdsComRota),
  ]);

  if (transportadorasResponse.error) throw transportadorasResponse.error;

  return transportadorasFromDbRows({
    transportadoras: transportadorasResponse.data || [],
    origens,
    generalidades,
    rotas: rotas || [],
    cotacoes,
    taxas,
  });
}


export async function carregarTransportadoraCompletaDb(transportadoraId, transportadoraNome = '') {
  if (!isSupabaseConfigured()) {
    const raw = localStorage.getItem(FALLBACK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const transportadoras = Array.isArray(parsed) ? parsed : parsed?.payload?.transportadoras || [];
    return transportadoras.find((item) =>
      String(item.id) === String(transportadoraId) ||
      String(item.nome || '').trim().toLowerCase() === String(transportadoraNome || '').trim().toLowerCase()
    ) || null;
  }

  const supabase = ensureClient();

  let transportadora = null;
  let transportadoraError = null;

  if (transportadoraId) {
    const response = await supabase
      .from('transportadoras')
      .select('id, nome, status')
      .eq('id', transportadoraId)
      .maybeSingle();

    transportadora = response.data;
    transportadoraError = response.error;
  }

  if (!transportadora && transportadoraNome) {
    const response = await supabase
      .from('transportadoras')
      .select('id, nome, status')
      .ilike('nome', transportadoraNome)
      .maybeSingle();

    transportadora = response.data;
    transportadoraError = response.error;
  }

  if (transportadoraError) throw transportadoraError;
  if (!transportadora) {
    throw new Error(`Transportadora não encontrada no Supabase: ${transportadoraNome || transportadoraId}`);
  }

  const { data: origens, error: origensError } = await supabase
    .from('origens')
    .select('*')
    .eq('transportadora_id', transportadora.id)
    .order('cidade', { ascending: true });

  if (origensError) throw origensError;

  const origemIds = (origens || []).map((item) => item.id);

  const [generalidades, rotas, cotacoes, taxas] = await Promise.all([
    fetchRowsByOrigemIds(supabase, 'generalidades', origemIds),
    fetchRowsByOrigemIds(supabase, 'rotas', origemIds),
    fetchRowsByOrigemIds(supabase, 'cotacoes', origemIds),
    fetchRowsByOrigemIds(supabase, 'taxas_especiais', origemIds),
  ]);

  return transportadorasFromDbRows({
    transportadoras: [transportadora],
    origens: origens || [],
    generalidades,
    rotas,
    cotacoes,
    taxas,
  })[0] || {
    id: transportadora.id,
    nome: transportadora.nome || '',
    status: transportadora.status || 'Ativa',
    detalheCarregado: true,
    origens: [],
  };
}



function pickIbgeValue(row, keys = []) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function normalizeBuscaDb(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalizeMunicipioIbgeRow(row = {}) {
  let ibge = pickIbgeValue(row, [
    'ibge',
    'codigo_ibge',
    'cod_ibge',
    'codigo',
    'codigo_municipio',
    'cod_municipio',
    'cod_mun',
    'id_municipio',
    'codigo_municipio_completo',
  ]).replace(/\D/g, '');

  let cidade = pickIbgeValue(row, [
    'cidade',
    'municipio',
    'nome_municipio',
    'nome',
    'descricao',
    'nome_mun',
    'nm_municipio',
  ]);

  let uf = pickIbgeValue(row, [
    'uf',
    'sigla_uf',
    'estado',
    'uf_sigla',
    'sg_uf',
  ]).toUpperCase().slice(0, 2);

  // Fallback para bases IBGE com nomes de colunas diferentes.
  Object.entries(row || {}).forEach(([key, value]) => {
    const chave = String(key || '').toLowerCase();
    const texto = String(value ?? '').trim();

    if (!ibge && /ibge|cod|codigo/.test(chave)) {
      const digitos = texto.replace(/\D/g, '');
      if (digitos.length >= 7) ibge = digitos.slice(0, 7);
    }

    if (!cidade && /cidade|municip|munic|nome/.test(chave) && texto && !/^\d+$/.test(texto)) {
      cidade = texto;
    }

    if (!uf && /uf|sigla|estado/.test(chave) && /^[A-Za-z]{2}$/.test(texto)) {
      uf = texto.toUpperCase();
    }
  });

  if (!ibge || !cidade) return null;
  return { ibge, cidade, uf };
}

export async function carregarMunicipiosIbgeDb() {
  if (!isSupabaseConfigured()) return [];

  const supabase = ensureClient();

  try {
    const { data, error } = await supabase
      .from('ibge_municipios')
      .select('*')
      .limit(7000);

    if (error) return [];

    return (data || [])
      .map(normalizeMunicipioIbgeRow)
      .filter(Boolean)
      .sort((a, b) => `${a.cidade}/${a.uf}`.localeCompare(`${b.cidade}/${b.uf}`, 'pt-BR'));
  } catch {
    return [];
  }
}

async function resolverCepEmFaixasDb(cepLimpo) {
  if (!isSupabaseConfigured() || !cepLimpo) return null;

  const supabase = ensureClient();
  const colunas = [
    { inicio: 'cep_inicial', fim: 'cep_final' },
    { inicio: 'cep_inicio', fim: 'cep_fim' },
    { inicio: 'cep_ini', fim: 'cep_fim' },
    { inicio: 'faixa_inicial', fim: 'faixa_final' },
  ];

  for (const col of colunas) {
    try {
      const { data, error } = await supabase
        .from('ibge_faixas_cep')
        .select('*')
        .lte(col.inicio, cepLimpo)
        .gte(col.fim, cepLimpo)
        .limit(1);

      if (!error && data?.[0]) {
        const municipio = normalizeMunicipioIbgeRow(data[0]);
        if (municipio) return municipio;

        const ibge = pickIbgeValue(data[0], ['ibge', 'codigo_ibge', 'cod_ibge', 'codigo_municipio']).replace(/\D/g, '');
        if (ibge) return { ibge, cidade: '', uf: '' };
      }
    } catch {
      // tenta próxima combinação
    }
  }

  return null;
}

export async function resolverDestinoIbgeDb(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return null;

  const somenteDigitos = texto.replace(/\D/g, '');

  if (somenteDigitos.length === 7) {
    const municipios = await carregarMunicipiosIbgeDb();
    return municipios.find((item) => item.ibge === somenteDigitos) || { ibge: somenteDigitos, cidade: '', uf: '' };
  }

  if (somenteDigitos.length === 8) {
    const porCep = await resolverCepEmFaixasDb(somenteDigitos);
    if (porCep?.ibge) return porCep;
  }

  const termoCidade = texto
    .replace(/\s*·\s*\d+$/i, '')
    .replace(/\s*\/\s*[A-Z]{2}$/i, '')
    .trim();

  if (!termoCidade || !isSupabaseConfigured()) return null;

  const municipios = await carregarMunicipiosIbgeDb();
  const termoNormalizado = normalizeBuscaDb(termoCidade);

  const exatoLocal = municipios.find((item) =>
    normalizeBuscaDb(item.cidade) === termoNormalizado ||
    normalizeBuscaDb(`${item.cidade}/${item.uf}`) === termoNormalizado
  );
  if (exatoLocal) return exatoLocal;

  const parcialLocal = municipios.find((item) => normalizeBuscaDb(item.cidade).includes(termoNormalizado));
  if (parcialLocal) return parcialLocal;

  const supabase = ensureClient();
  const colunas = ['cidade', 'municipio', 'nome_municipio', 'nome'];

  for (const coluna of colunas) {
    try {
      const { data, error } = await supabase
        .from('ibge_municipios')
        .select('*')
        .ilike(coluna, termoCidade)
        .limit(1);

      if (!error && data?.[0]) {
        const municipio = normalizeMunicipioIbgeRow(data[0]);
        if (municipio) return municipio;
      }
    } catch {
      // tenta próxima coluna
    }
  }

  for (const coluna of colunas) {
    try {
      const { data, error } = await supabase
        .from('ibge_municipios')
        .select('*')
        .ilike(coluna, `%${termoCidade}%`)
        .limit(1);

      if (!error && data?.[0]) {
        const municipio = normalizeMunicipioIbgeRow(data[0]);
        if (municipio) return municipio;
      }
    } catch {
      // tenta próxima coluna
    }
  }

  // Último fallback: tenta encontrar uma rota já cadastrada cujo nome contenha a cidade digitada.
  try {
    const { data, error } = await supabase
      .from('rotas')
      .select('ibge_destino, nome_rota')
      .ilike('nome_rota', `%${termoCidade}%`)
      .limit(1);

    if (!error && data?.[0]?.ibge_destino) {
      return {
        ibge: String(data[0].ibge_destino).replace(/\D/g, ''),
        cidade: data[0].nome_rota || termoCidade,
        uf: '',
      };
    }
  } catch {
    // sem fallback
  }

  return null;
}


export async function carregarOpcoesSimuladorDb() {
  if (!isSupabaseConfigured()) {
    const raw = localStorage.getItem(FALLBACK_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const transportadoras = Array.isArray(parsed) ? parsed : parsed?.payload?.transportadoras || [];

    const nomes = [...new Set(transportadoras.map((item) => item.nome).filter(Boolean))].sort();
    const origens = [...new Set(transportadoras.flatMap((item) => (item.origens || []).map((origem) => origem.cidade).filter(Boolean)))].sort();
    const canais = [...new Set(transportadoras.flatMap((item) => (item.origens || []).map((origem) => origem.canal || 'ATACADO').filter(Boolean)))].sort();

    const origensPorTransportadora = {};
    const canaisPorTransportadora = {};
    const origensPorCanal = {};
    transportadoras.forEach((transportadora) => {
      const nome = transportadora.nome || '';
      if (!nome) return;
      origensPorTransportadora[nome] = [...new Set((transportadora.origens || []).map((origem) => origem.cidade).filter(Boolean))].sort();
      canaisPorTransportadora[nome] = [...new Set((transportadora.origens || []).map((origem) => origem.canal || 'ATACADO').filter(Boolean))].sort();
      (transportadora.origens || []).forEach((origem) => {
        const canalOrigem = origem.canal || 'ATACADO';
        if (!origensPorCanal[canalOrigem]) origensPorCanal[canalOrigem] = [];
        if (origem.cidade && !origensPorCanal[canalOrigem].includes(origem.cidade)) {
          origensPorCanal[canalOrigem].push(origem.cidade);
        }
      });
    });

    Object.keys(origensPorCanal).forEach((canal) => {
      origensPorCanal[canal].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    });

    return { transportadoras: nomes, origens, canais, origensPorTransportadora, canaisPorTransportadora, origensPorCanal, municipiosIbge: [], fonte: 'local' };
  }

  const supabase = ensureClient();

  const [transportadorasResponse, origensResponse] = await Promise.all([
    supabase.from('transportadoras').select('id, nome, status').order('nome', { ascending: true }),
    supabase.from('origens').select('id, transportadora_id, cidade, canal').order('cidade', { ascending: true }),
  ]);

  if (transportadorasResponse.error) throw transportadorasResponse.error;
  if (origensResponse.error) throw origensResponse.error;

  const nomePorId = new Map((transportadorasResponse.data || []).map((item) => [String(item.id), item.nome || '']));
  const transportadoras = [...new Set((transportadorasResponse.data || []).map((item) => item.nome).filter(Boolean))].sort();
  const origens = [...new Set((origensResponse.data || []).map((item) => item.cidade).filter(Boolean))].sort();
  const canais = [...new Set((origensResponse.data || []).map((item) => item.canal || 'ATACADO').filter(Boolean))].sort();

  const origensPorTransportadora = {};
  const canaisPorTransportadora = {};
  const origensPorCanal = {};

  (origensResponse.data || []).forEach((origem) => {
    const nome = nomePorId.get(String(origem.transportadora_id));
    if (!nome) return;

    if (!origensPorTransportadora[nome]) origensPorTransportadora[nome] = [];
    if (!canaisPorTransportadora[nome]) canaisPorTransportadora[nome] = [];

    if (origem.cidade && !origensPorTransportadora[nome].includes(origem.cidade)) {
      origensPorTransportadora[nome].push(origem.cidade);
    }

    const canal = origem.canal || 'ATACADO';
    if (!canaisPorTransportadora[nome].includes(canal)) {
      canaisPorTransportadora[nome].push(canal);
    }

    if (!origensPorCanal[canal]) origensPorCanal[canal] = [];
    if (origem.cidade && !origensPorCanal[canal].includes(origem.cidade)) {
      origensPorCanal[canal].push(origem.cidade);
    }
  });

  Object.keys(origensPorCanal).forEach((canal) => {
    origensPorCanal[canal].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  });

  Object.keys(origensPorTransportadora).forEach((nome) => {
    origensPorTransportadora[nome].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  });

  Object.keys(canaisPorTransportadora).forEach((nome) => {
    canaisPorTransportadora[nome].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  });

  const municipiosIbge = await carregarMunicipiosIbgeDb();

  return {
    transportadoras,
    origens,
    canais: canais.length ? canais : ['ATACADO'],
    origensPorTransportadora,
    canaisPorTransportadora,
    origensPorCanal,
    municipiosIbge,
    fonte: 'supabase',
    atualizadoEm: new Date().toISOString(),
  };
}

export async function buscarBaseSimulacaoDb({ origem = '', canal = '', destinoCodigo = '', destinoCodigos = [], nomeTransportadora = '', ufDestino = '' } = {}) {
  // Fonte da verdade do simulador: Supabase.
  // Não depende da tela Transportadoras estar aberta ou atualizada.

  if (!isSupabaseConfigured()) {
    const raw = localStorage.getItem(FALLBACK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : parsed?.payload?.transportadoras || [];
  }

  const supabase = ensureClient();
  const destinos = Array.from(new Set([
    ...(Array.isArray(destinoCodigos) ? destinoCodigos : []),
    destinoCodigo,
  ].map((item) => String(item || '').trim()).filter(Boolean)));

  // Caso análise de transportadora por origem:
  // Primeiro busca somente os destinos atendidos pela transportadora analisada.
  // Depois busca concorrentes apenas nesses destinos. Isso evita carregar a origem inteira.
  if (nomeTransportadora && origem) {
    const destinosAlvo = destinos.length
      ? destinos
      : await buscarDestinosTransportadoraOrigem({ supabase, nomeTransportadora, origem, canal, ufDestino });

    if (!destinosAlvo.length) return [];

    return buscarBasePorOrigemDestino({ supabase, origem, canal, destinos: destinosAlvo });
  }

  // Caso principal: simulação simples ou lista com destino informado.
  // Busca todos os concorrentes da mesma origem/canal/destino.
  if (origem || destinos.length) {
    return buscarBasePorOrigemDestino({ supabase, origem, canal, destinos });
  }

  // Caso análise de transportadora sem destino/origem: busca as rotas da transportadora
  // selecionada e depois monta a base concorrente para os mesmos destinos/origens.
  if (nomeTransportadora) {
    const { data: transportadorasAlvo, error: transportadoraError } = await supabase
      .from('transportadoras')
      .select('id, nome, status')
      .ilike('nome', nomeTransportadora);

    if (transportadoraError) throw transportadoraError;
    const alvoIds = (transportadorasAlvo || []).map((item) => item.id);
    if (!alvoIds.length) return [];

    const { data: origensAlvo, error: origensAlvoError } = await supabase
      .from('origens')
      .select('id, cidade, canal')
      .in('transportadora_id', alvoIds);

    if (origensAlvoError) throw origensAlvoError;

    const pares = (origensAlvo || [])
      .filter((item) => !canal || item.canal === canal)
      .map((item) => ({ origem: item.cidade, canal: item.canal }));

    const bases = [];
    const paresUnicos = Array.from(
      new Map(pares.map((par) => [`${par.origem}||${par.canal}`, par])).values()
    );

    for (const par of paresUnicos) {
      const parcial = await buscarBasePorOrigemDestino({ supabase, origem: par.origem, canal: par.canal, destinos: [] });
      bases.push(...parcial);
    }

    const byId = new Map();
    bases.forEach((item) => byId.set(String(item.id), item));
    return [...byId.values()];
  }

  return [];
}


export async function carregarConferenciaBaseDb() {
  if (!isSupabaseConfigured()) {
    return {
      conectado: false,
      transportadoras: 0,
      origens: 0,
      rotas: 0,
      cotacoes: 0,
      validadas: 0,
      completas: 0,
      parciais: 0,
      inconsistentes: 0,
      semValidacao: true,
    };
  }

  const supabase = ensureClient();

  const [transportadoras, origens, rotas, cotacoes] = await Promise.all([
    supabase.from('transportadoras').select('id', { count: 'exact', head: true }),
    supabase.from('origens').select('id', { count: 'exact', head: true }),
    supabase.from('rotas').select('id', { count: 'exact', head: true }),
    supabase.from('cotacoes').select('id', { count: 'exact', head: true }),
  ]);

  if (transportadoras.error) throw transportadoras.error;
  if (origens.error) throw origens.error;
  if (rotas.error) throw rotas.error;
  if (cotacoes.error) throw cotacoes.error;

  let cobertura = [];
  let semValidacao = false;

  try {
    const { data, error } = await supabase
      .from('vw_cobertura_transportadoras')
      .select('status_cobertura');

    if (error) {
      semValidacao = true;
    } else {
      cobertura = data || [];
    }
  } catch {
    semValidacao = true;
  }

  return {
    conectado: true,
    transportadoras: transportadoras.count || 0,
    origens: origens.count || 0,
    rotas: rotas.count || 0,
    cotacoes: cotacoes.count || 0,
    validadas: cobertura.length,
    completas: cobertura.filter((item) => item.status_cobertura === 'Completa').length,
    parciais: cobertura.filter((item) => item.status_cobertura === 'Parcial').length,
    inconsistentes: cobertura.filter((item) => item.status_cobertura === 'Inconsistente').length,
    semValidacao,
  };
}


export async function listarImportacoes(limit = 15) {
  if (!isSupabaseConfigured()) return [];

  const supabase = ensureClient();

  let query = supabase
    .from('frete_importacoes')
    .select('*')
    .limit(limit);

  // Tenta primeiro pela coluna mais comum do schema atual.
  let response = await query.order('criado_em', { ascending: false });

  // Fallback para bases antigas que possam estar usando camelCase.
  if (response.error) {
    response = await supabase
      .from('frete_importacoes')
      .select('*')
      .order('criadoEm', { ascending: false })
      .limit(limit);
  }

  if (response.error) {
    throw response.error;
  }

  return response.data || [];
}


function tabelaPorSecao(secao) {
  if (secao === 'rotas') return 'rotas';
  if (secao === 'cotacoes') return 'cotacoes';
  if (secao === 'taxas' || secao === 'taxasEspeciais') return 'taxas_especiais';
  if (secao === 'generalidades') return 'generalidades';
  return '';
}

export async function excluirLinhaSecaoDb(secao, linhaId) {
  if (!isSupabaseConfigured()) return { ok: true, modo: 'local' };

  const table = tabelaPorSecao(secao);
  if (!table || !linhaId) return { ok: true, ignorado: true };

  const supabase = ensureClient();
  const campo = table === 'generalidades' ? 'origem_id' : 'id';

  const { error } = await supabase.from(table).delete().eq(campo, linhaId);
  if (error) throw error;

  return { ok: true };
}

export async function limparSecaoOrigemDb(origemId, secao) {
  if (!isSupabaseConfigured()) return { ok: true, modo: 'local' };

  const table = tabelaPorSecao(secao);
  if (!table || !origemId) return { ok: true, ignorado: true };

  const supabase = ensureClient();

  const { error } = await supabase.from(table).delete().eq('origem_id', origemId);
  if (error) throw error;

  return { ok: true };
}

export async function excluirOrigemDb(origemId) {
  if (!isSupabaseConfigured()) return { ok: true, modo: 'local' };
  if (!origemId) return { ok: true, ignorado: true };

  const supabase = ensureClient();

  for (const table of ['taxas_especiais', 'cotacoes', 'rotas', 'generalidades']) {
    const { error } = await supabase.from(table).delete().eq('origem_id', origemId);
    if (error) throw error;
  }

  const { error } = await supabase.from('origens').delete().eq('id', origemId);
  if (error) throw error;

  return { ok: true };
}

export async function excluirTransportadoraDb(transportadoraId) {
  if (!isSupabaseConfigured()) return { ok: true, modo: 'local' };
  if (!transportadoraId) return { ok: true, ignorado: true };

  const supabase = ensureClient();

  const { data: origens, error: origensError } = await supabase
    .from('origens')
    .select('id')
    .eq('transportadora_id', transportadoraId);

  if (origensError) throw origensError;

  const origemIds = (origens || []).map((item) => item.id);

  if (origemIds.length) {
    for (const table of ['taxas_especiais', 'cotacoes', 'rotas', 'generalidades']) {
      const { error } = await supabase.from(table).delete().in('origem_id', origemIds);
      if (error) throw error;
    }

    const { error: origemDeleteError } = await supabase.from('origens').delete().in('id', origemIds);
    if (origemDeleteError) throw origemDeleteError;
  }

  const { error } = await supabase.from('transportadoras').delete().eq('id', transportadoraId);
  if (error) throw error;

  return { ok: true };
}


function removerCampo(payload, campo) {
  const { [campo]: _removido, ...restante } = payload;
  return restante;
}

function extrairColunaInexistente(error) {
  const mensagem = String(error?.message || '');
  const match = mensagem.match(/Could not find the '([^']+)' column/i);
  return match?.[1] || '';
}

export async function registrarImportacao(payload) {
  let sanitized = sanitizeImportacaoPayload(payload);

  if (!isSupabaseConfigured()) {
    return { ok: true, mode: 'local', payload: sanitized };
  }

  const supabase = ensureClient();

  for (let tentativa = 0; tentativa < 8; tentativa += 1) {
    const { error } = await supabase
      .from('frete_importacoes')
      .insert(sanitized);

    if (!error) return { ok: true, mode: 'remote' };

    const colunaInexistente = extrairColunaInexistente(error);
    if (colunaInexistente && Object.prototype.hasOwnProperty.call(sanitized, colunaInexistente)) {
      sanitized = removerCampo(sanitized, colunaInexistente);
      continue;
    }

    throw error;
  }

  throw new Error('Não foi possível registrar histórico de importação por incompatibilidade de colunas.');
}

const REALIZADO_LOCAL_KEY = 'amd-realizado-ctes-v1';
const REALIZADO_LOCAL_LIMIT = 3000;

function readRealizadoLocal() {
  try {
    const raw = localStorage.getItem(REALIZADO_LOCAL_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRealizadoLocal(rows = []) {
  try {
    localStorage.setItem(REALIZADO_LOCAL_KEY, JSON.stringify((rows || []).slice(0, REALIZADO_LOCAL_LIMIT)));
  } catch {
    // localStorage pode não suportar bases grandes; Supabase é a fonte recomendada.
  }
}

function normalizeRealizadoDbRow(row = {}) {
  return {
    id: row.id || row.chave_cte || row.chaveCte || '',
    arquivoOrigem: row.arquivo_origem || row.arquivoOrigem || '',
    competencia: row.competencia || '',
    transportadora: row.transportadora || '',
    cnpjTransportadora: row.cnpj_transportadora || row.cnpjTransportadora || '',
    emissao: row.emissao || '',
    chaveCte: row.chave_cte || row.chaveCte || '',
    numeroCte: row.numero_cte || row.numeroCte || '',
    serieCte: row.serie_cte || row.serieCte || '',
    valorCte: row.valor_cte ?? row.valorCte ?? 0,
    valorCalculado: row.valor_calculado ?? row.valorCalculado ?? 0,
    diferenca: row.diferenca ?? 0,
    situacao: row.situacao || '',
    status: row.status || '',
    statusConciliacao: row.status_conciliacao || row.statusConciliacao || '',
    statusErp: row.status_erp || row.statusErp || '',
    ufOrigem: row.uf_origem || row.ufOrigem || '',
    ufDestino: row.uf_destino || row.ufDestino || '',
    pesoDeclarado: row.peso_declarado ?? row.pesoDeclarado ?? 0,
    pesoCubado: row.peso_cubado ?? row.pesoCubado ?? 0,
    metrosCubicos: row.metros_cubicos ?? row.metrosCubicos ?? 0,
    volume: row.volume ?? 0,
    canais: row.canais || '',
    canal: row.canal || '',
    canalVendas: row.canal_vendas || row.canalVendas || '',
    valorNF: row.valor_nf ?? row.valorNF ?? 0,
    percentualFrete: row.percentual_frete ?? row.percentualFrete ?? 0,
    cepDestino: row.cep_destino || row.cepDestino || '',
    cepOrigem: row.cep_origem || row.cepOrigem || '',
    cidadeOrigem: row.cidade_origem || row.cidadeOrigem || '',
    cidadeDestino: row.cidade_destino || row.cidadeDestino || '',
    transportadoraContratada: row.transportadora_contratada || row.transportadoraContratada || '',
    prazoEntregaCliente: row.prazo_entrega_cliente ?? row.prazoEntregaCliente ?? 0,
    raw: row.raw || {},
    criadoEm: row.criado_em || row.criadoEm || '',
  };
}

function buildRealizadoFallbackKey(row = {}) {
  const parts = [
    row.numeroCte || row.numero_cte,
    row.emissao,
    row.transportadora,
    row.cidadeOrigem || row.cidade_origem,
    row.cidadeDestino || row.cidade_destino,
    row.valorCte ?? row.valor_cte ?? row.valorNF ?? row.valor_nf,
  ]
    .map((part) => String(part ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80))
    .filter(Boolean);

  return parts.length >= 2 ? `cte-sem-chave-${parts.join('-')}` : '';
}

function sanitizeRealizadoDbRow(row = {}) {
  const chave = String(row.chaveCte || row.chave_cte || buildRealizadoFallbackKey(row)).trim();
  return {
    arquivo_origem: row.arquivoOrigem || row.arquivo_origem || '',
    competencia: row.competencia || '',
    transportadora: row.transportadora || '',
    cnpj_transportadora: row.cnpjTransportadora || row.cnpj_transportadora || '',
    emissao: row.emissao || null,
    chave_cte: chave || null,
    numero_cte: row.numeroCte || row.numero_cte || '',
    serie_cte: row.serieCte || row.serie_cte || '',
    valor_cte: toNumberOrNull(row.valorCte ?? row.valor_cte),
    valor_calculado: toNumberOrNull(row.valorCalculado ?? row.valor_calculado),
    diferenca: toNumberOrNull(row.diferenca),
    situacao: row.situacao || '',
    status: row.status || '',
    status_conciliacao: row.statusConciliacao || row.status_conciliacao || '',
    status_erp: row.statusErp || row.status_erp || '',
    uf_origem: row.ufOrigem || row.uf_origem || '',
    uf_destino: row.ufDestino || row.uf_destino || '',
    peso_declarado: toNumberOrNull(row.pesoDeclarado ?? row.peso_declarado),
    peso_cubado: toNumberOrNull(row.pesoCubado ?? row.peso_cubado),
    metros_cubicos: toNumberOrNull(row.metrosCubicos ?? row.metros_cubicos),
    volume: toNumberOrNull(row.volume),
    canais: row.canais || '',
    canal: row.canal || '',
    canal_vendas: row.canalVendas || row.canal_vendas || '',
    valor_nf: toNumberOrNull(row.valorNF ?? row.valor_nf),
    percentual_frete: toNumberOrNull(row.percentualFrete ?? row.percentual_frete),
    cep_destino: row.cepDestino || row.cep_destino || '',
    cep_origem: row.cepOrigem || row.cep_origem || '',
    cidade_origem: row.cidadeOrigem || row.cidade_origem || '',
    cidade_destino: row.cidadeDestino || row.cidade_destino || '',
    transportadora_contratada: row.transportadoraContratada || row.transportadora_contratada || '',
    prazo_entrega_cliente: toNumberOrNull(row.prazoEntregaCliente ?? row.prazo_entrega_cliente),
    raw: {},
  };
}

function filtrarRealizadoLocal(rows = [], filtros = {}) {
  const inicio = filtros.inicio ? new Date(`${filtros.inicio}T00:00:00`) : null;
  const fim = filtros.fim ? new Date(`${filtros.fim}T23:59:59`) : null;
  const canal = String(filtros.canal || '').toUpperCase();
  const origem = String(filtros.origem || '').trim().toLowerCase();
  const ufDestino = String(filtros.ufDestino || '').trim().toUpperCase();

  return (rows || []).filter((row) => {
    const emissao = row.emissao ? new Date(row.emissao) : null;
    if (inicio && (!emissao || emissao < inicio)) return false;
    if (fim && (!emissao || emissao > fim)) return false;
    if (canal && String(row.canal || '').toUpperCase() !== canal) return false;
    if (origem && String(row.cidadeOrigem || '').trim().toLowerCase() !== origem) return false;
    if (ufDestino && String(row.ufDestino || '').trim().toUpperCase() !== ufDestino) return false;
    return true;
  });
}

function isCanalRealizadoPreenchido(value) {
  return String(value ?? '').trim().length > 0;
}

function aplicarFiltroSemCanal(rows = [], filtros = {}) {
  const incluirSemCanal = filtros.incluirSemCanal !== false;
  if (incluirSemCanal) return rows;
  return rows.filter((row) => isCanalRealizadoPreenchido(row.canal));
}

async function listarRealizadoCtesViaSelect(supabase, filtros = {}) {
  const limit = Number(filtros.limit || 10000) || 10000;
  let query = supabase
    .from('realizado_ctes')
    .select('*')
    .order('criado_em', { ascending: false })
    .limit(limit);

  if (filtros.inicio) query = query.gte('emissao', `${filtros.inicio}T00:00:00`);
  if (filtros.fim) query = query.lte('emissao', `${filtros.fim}T23:59:59`);
  if (filtros.canal) query = query.eq('canal', filtros.canal);
  if (filtros.origem) query = query.ilike('cidade_origem', filtros.origem);
  if (filtros.ufDestino) query = query.eq('uf_destino', filtros.ufDestino);
  if (filtros.incluirSemCanal === false) query = query.not('canal', 'is', null).neq('canal', '');
  if (filtros.somenteSemCanal) query = query.or('canal.is.null,canal.eq.');

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(normalizeRealizadoDbRow);
}

async function listarRealizadoCtesViaRpc(supabase, filtros = {}) {
  const resposta = await supabase.rpc('listar_realizado_ctes', {
    p_limit: Number(filtros.limit || 10000) || 10000,
    p_inicio: filtros.inicio || null,
    p_fim: filtros.fim || null,
    p_canal: filtros.canal || null,
    p_origem: filtros.origem || null,
    p_uf_destino: filtros.ufDestino || null,
    p_incluir_sem_canal: filtros.incluirSemCanal !== false,
    p_somente_sem_canal: filtros.somenteSemCanal === true,
  });

  if (resposta?.error) throw resposta.error;
  return (resposta?.data || []).map(normalizeRealizadoDbRow);
}

export async function listarRealizadoCtes(filtros = {}) {
  if (!isSupabaseConfigured()) {
    const locais = filtrarRealizadoLocal(readRealizadoLocal(), filtros);
    return aplicarFiltroSemCanal(locais, filtros).slice(0, filtros.limit || REALIZADO_LOCAL_LIMIT);
  }

  const supabase = ensureClient();

  try {
    return await listarRealizadoCtesViaRpc(supabase, filtros);
  } catch (rpcError) {
    if (!isRpcMissingError(rpcError)) {
      throw new Error(`Erro ao carregar realizado_ctes via Supabase. Detalhe: ${rpcError.message || rpcError}`);
    }

    try {
      return await listarRealizadoCtesViaSelect(supabase, filtros);
    } catch (selectError) {
      throw new Error(`Erro ao carregar realizado_ctes. Rode o script supabase/realizado_ctes_schema.sql atualizado. Detalhe: ${selectError.message || selectError}`);
    }
  }
}

function aguardar(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executarComTimeout(promise, ms, mensagem) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(mensagem)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}


async function validarTabelaRealizadoCtes(supabase) {
  const { error } = await supabase
    .from('realizado_ctes')
    .select('chave_cte', { count: 'exact', head: true })
    .limit(1);

  if (error) {
    throw new Error(
      `Não consegui acessar a tabela realizado_ctes no Supabase. Rode novamente o script supabase/realizado_ctes_schema.sql e confira as permissões/RLS. Detalhe: ${error.message}`
    );
  }
}

async function contarChavesRealizadoNoSupabase(supabase, chaves = []) {
  const unicas = [...new Set((chaves || []).filter(Boolean))];
  if (!unicas.length) return 0;

  let confirmados = 0;
  const chunkSize = 500;
  for (let index = 0; index < unicas.length; index += chunkSize) {
    const chunk = unicas.slice(index, index + chunkSize);
    const { count, error } = await supabase
      .from('realizado_ctes')
      .select('chave_cte', { count: 'exact', head: true })
      .in('chave_cte', chunk);

    if (error) {
      throw new Error(`O Supabase gravou/recebeu a importação, mas não deixou confirmar a leitura. Confira permissões/RLS da tabela realizado_ctes. Detalhe: ${error.message}`);
    }

    confirmados += Number(count || 0);
  }

  return confirmados;
}

function isRpcMissingError(error) {
  const message = String(error?.message || error?.details || error?.hint || '').toLowerCase();
  const code = String(error?.code || '');
  return code === 'PGRST202' || message.includes('function') || message.includes('rpc') || message.includes('not found') || message.includes('could not find');
}

async function salvarRealizadoCtesViaRpc(supabase, payload = [], options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const chunkSize = Number(options.chunkSize || 250) || 250;
  let confirmados = 0;

  for (let index = 0; index < payload.length; index += chunkSize) {
    const chunk = payload.slice(index, index + chunkSize);
    const resposta = await executarComTimeout(
      supabase.rpc('importar_realizado_ctes', { p_rows: chunk }),
      90000,
      'A gravação via função do Supabase demorou demais e foi interrompida. Tente novamente com um período menor.'
    );

    if (resposta?.error) throw resposta.error;

    const qtd = Number(resposta?.data || 0);
    confirmados += Number.isFinite(qtd) ? qtd : 0;
    onProgress?.({
      salvos: Math.min(index + chunk.length, payload.length),
      confirmados,
      total: payload.length,
      modo: 'supabase',
      metodo: 'rpc',
    });
    await aguardar(0);
  }

  return confirmados;
}

async function salvarRealizadoCtesViaUpsert(supabase, payload = [], options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const chunkSize = Number(options.chunkSize || 250) || 250;
  let retornadosSupabase = 0;

  for (let index = 0; index < payload.length; index += chunkSize) {
    const chunk = payload.slice(index, index + chunkSize);
    const resposta = await executarComTimeout(
      supabase
        .from('realizado_ctes')
        .upsert(chunk, { onConflict: 'chave_cte' })
        .select('chave_cte'),
      90000,
      'A gravação no Supabase demorou demais e foi interrompida. Verifique a conexão e tente novamente com um período menor.'
    );

    if (resposta?.error) {
      throw new Error(`Erro ao salvar realizado_ctes no Supabase. Rode o script supabase/realizado_ctes_schema.sql e confira permissões/RLS. Detalhe: ${resposta.error.message}`);
    }

    retornadosSupabase += Array.isArray(resposta?.data) ? resposta.data.length : 0;
    onProgress?.({
      salvos: Math.min(index + chunk.length, payload.length),
      confirmados: retornadosSupabase,
      total: payload.length,
      modo: 'supabase',
      metodo: 'upsert',
    });
    await aguardar(0);
  }

  return retornadosSupabase;
}

export async function diagnosticarRealizadoSupabaseDb() {
  const info = getSupabaseInfo();
  if (!info.configured) {
    return {
      ok: false,
      configured: false,
      host: info.host,
      total: 0,
      erro: 'Supabase não configurado no front. Confira VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no Vercel.',
    };
  }

  const supabase = ensureClient();
  const status = {
    ok: false,
    configured: true,
    host: info.host,
    total: 0,
    comCanal: 0,
    semCanal: 0,
    tabelaOk: false,
    rpcOk: false,
    listagemRpcOk: false,
    erro: '',
  };

  const tabela = await supabase
    .from('realizado_ctes')
    .select('id', { count: 'exact', head: true });

  if (tabela.error) {
    status.erro = `Tabela realizado_ctes não respondeu: ${tabela.error.message}`;
    return status;
  }

  status.tabelaOk = true;
  status.total = Number(tabela.count || 0);

  const rpc = await supabase.rpc('diagnosticar_realizado_ctes');
  if (!rpc.error) {
    status.rpcOk = true;
    status.total = Number(rpc.data?.total ?? status.total ?? 0);
    status.comCanal = Number(rpc.data?.com_canal ?? status.comCanal ?? 0);
    status.semCanal = Number(rpc.data?.sem_canal ?? status.semCanal ?? 0);
  }

  const listagem = await supabase.rpc('listar_realizado_ctes', {
    p_limit: 1,
    p_inicio: null,
    p_fim: null,
    p_canal: null,
    p_origem: null,
    p_uf_destino: null,
    p_incluir_sem_canal: true,
    p_somente_sem_canal: false,
  });
  if (!listagem.error) status.listagemRpcOk = true;

  status.ok = true;
  return status;
}

export async function salvarRealizadoCtes(rows = [], options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const requireSupabase = options.requireSupabase === true;
  const normalized = (rows || []).map(normalizeRealizadoDbRow).filter((row) => row.chaveCte || row.numeroCte);
  if (!normalized.length) return { ok: true, inseridos: 0, confirmados: 0 };

  if (!isSupabaseConfigured()) {
    if (requireSupabase) {
      throw new Error(
        'Supabase não configurado no front. A importação não será salva na base online. Confira as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no Vercel/GitHub e publique novamente.'
      );
    }

    const atual = readRealizadoLocal();
    const byKey = new Map(atual.map((row) => [row.chaveCte || `${row.numeroCte}|${row.emissao}`, row]));
    normalized.forEach((row) => byKey.set(row.chaveCte || `${row.numeroCte}|${row.emissao}`, row));
    writeRealizadoLocal([...byKey.values()].sort((a, b) => String(b.emissao).localeCompare(String(a.emissao))));
    onProgress?.({ salvos: normalized.length, confirmados: normalized.length, total: normalized.length, modo: 'local', metodo: 'local' });
    return { ok: true, inseridos: normalized.length, confirmados: normalized.length, modo: 'local', metodo: 'local' };
  }

  const supabase = ensureClient();
  await validarTabelaRealizadoCtes(supabase);

  const payload = normalized.map(sanitizeRealizadoDbRow).filter((row) => row.chave_cte);
  if (!payload.length) {
    throw new Error('A planilha foi lida, mas nenhum CT-e ficou com chave para salvar. Confira se existe coluna Chave CT-e ou Número CT-e.');
  }

  let retornadosSupabase = 0;
  let metodo = 'rpc';

  try {
    retornadosSupabase = await salvarRealizadoCtesViaRpc(supabase, payload, options);
  } catch (rpcError) {
    if (!isRpcMissingError(rpcError)) {
      throw new Error(`Erro ao salvar via função importar_realizado_ctes. Rode novamente o script supabase/realizado_ctes_schema.sql. Detalhe: ${rpcError.message || rpcError}`);
    }

    metodo = 'upsert';
    retornadosSupabase = await salvarRealizadoCtesViaUpsert(supabase, payload, options);
  }

  const confirmados = await contarChavesRealizadoNoSupabase(
    supabase,
    payload.map((row) => row.chave_cte)
  );

  if (!confirmados) {
    const info = getSupabaseInfo();
    throw new Error(
      `A chamada de gravação terminou, mas nenhuma linha foi confirmada na tabela realizado_ctes. Projeto do front: ${info.host || 'não identificado'}. Isso normalmente é RLS/permissão, script SQL não rodado ou Vercel apontando para outro Supabase.`
    );
  }

  return {
    ok: true,
    inseridos: payload.length,
    confirmados,
    retornadosSupabase,
    lidos: normalized.length,
    modo: 'supabase',
    metodo,
    projeto: getSupabaseInfo().host,
  };
}

export async function excluirRealizadoCtes(filtros = {}) {
  if (!isSupabaseConfigured()) {
    const atual = readRealizadoLocal();
    if (filtros.somenteSemCanal) {
      const restantes = atual.filter((row) => isCanalRealizadoPreenchido(row.canal));
      writeRealizadoLocal(restantes);
      return { ok: true, removidos: atual.length - restantes.length, modo: 'local' };
    }

    if (!filtros.inicio && !filtros.fim && !filtros.arquivoOrigem) {
      writeRealizadoLocal([]);
      return { ok: true, removidos: atual.length, modo: 'local' };
    }

    const remover = new Set(filtrarRealizadoLocal(atual, filtros).map((row) => row.chaveCte || `${row.numeroCte}|${row.emissao}`));
    const restantes = atual.filter((row) => !remover.has(row.chaveCte || `${row.numeroCte}|${row.emissao}`));
    writeRealizadoLocal(restantes);
    return { ok: true, removidos: atual.length - restantes.length, modo: 'local' };
  }

  const supabase = ensureClient();

  if (filtros.somenteSemCanal) {
    const rpc = await supabase.rpc('excluir_realizado_ctes_sem_canal');
    if (!rpc.error) {
      return { ok: true, removidos: Number(rpc.data || 0), modo: 'supabase', metodo: 'rpc' };
    }

    if (!isRpcMissingError(rpc.error)) {
      throw new Error(`Erro ao excluir pendências sem canal. Detalhe: ${rpc.error.message}`);
    }
  }

  let query = supabase.from('realizado_ctes').delete();

  if (filtros.inicio) query = query.gte('emissao', `${filtros.inicio}T00:00:00`);
  if (filtros.fim) query = query.lte('emissao', `${filtros.fim}T23:59:59`);
  if (filtros.arquivoOrigem) query = query.eq('arquivo_origem', filtros.arquivoOrigem);
  if (filtros.somenteSemCanal) query = query.or('canal.is.null,canal.eq.');

  if (!filtros.inicio && !filtros.fim && !filtros.arquivoOrigem && !filtros.somenteSemCanal) {
    query = query.neq('chave_cte', '__nunca__');
  }

  const { error } = await query;
  if (error) throw error;
  return { ok: true, modo: 'supabase' };
}
