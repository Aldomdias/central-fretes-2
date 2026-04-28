import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

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

  const { data: origensBase, error: origensError } = await origensQuery;
  if (origensError) throw origensError;

  const origemIdsBase = (origensBase || []).map((item) => item.id);
  if (!origemIdsBase.length) return [];

  let rotasQuery = supabase
    .from('rotas')
    .select('*')
    .in('origem_id', origemIdsBase);

  if (destinosNormalizados.length) {
    rotasQuery = rotasQuery.in('ibge_destino', destinosNormalizados);
  }

  const { data: rotas, error: rotasError } = await rotasQuery;
  if (rotasError) throw rotasError;

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

export async function buscarBaseSimulacaoDb({ origem = '', canal = '', destinoCodigo = '', destinoCodigos = [], nomeTransportadora = '' } = {}) {
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
    for (const par of pares.slice(0, 25)) {
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
