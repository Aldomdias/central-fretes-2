import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const SNAPSHOT_CHAVE = 'cadastro-fretes-principal';
const FALLBACK_KEY = 'simulador-fretes-local-v6';

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

  const [transportadorasRes, origensRes, generalidadesRes, rotasRes, cotacoesRes, taxasRes] =
    await Promise.all([
      supabase.from('transportadoras').select('*').order('nome', { ascending: true }),
      supabase.from('origens').select('*').order('cidade', { ascending: true }),
      supabase.from('generalidades').select('*'),
      supabase.from('rotas').select('*'),
      supabase.from('cotacoes').select('*'),
      supabase.from('taxas_especiais').select('*'),
    ]);

  const responses = [transportadorasRes, origensRes, generalidadesRes, rotasRes, cotacoesRes, taxasRes];
  const firstError = responses.find((item) => item.error)?.error;
  if (firstError) throw firstError;

  const transportadoras = transportadorasRes.data || [];
  const origens = origensRes.data || [];
  const generalidades = generalidadesRes.data || [];
  const rotas = rotasRes.data || [];
  const cotacoes = cotacoesRes.data || [];
  const taxas = taxasRes.data || [];

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

async function replaceTable(supabase, table, rows) {
  const { error: deleteError } = await supabase.from(table).delete().neq('id', '__nunca__');
  if (deleteError) throw deleteError;

  if (!rows.length) return;

  const chunkSize = 500;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw error;
  }
}

function mapBaseToTables(transportadoras) {
  const transportadorasRows = [];
  const origensRows = [];
  const generalidadesRows = [];
  const rotasRows = [];
  const cotacoesRows = [];
  const taxasRows = [];

  (transportadoras || []).forEach((transportadora) => {
    const transportadoraId = String(transportadora.id);
    transportadorasRows.push({
      id: transportadoraId,
      nome: transportadora.nome || '',
      status: transportadora.status || 'Ativa',
    });

    (transportadora.origens || []).forEach((origem) => {
      const origemId = String(origem.id);
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
          id,
          nomeRota,
          ibgeOrigem,
          ibgeDestino,
          canal,
          prazoEntregaDias,
          valorMinimoFrete,
          codigoUnidade,
          cepInicial,
          cepFinal,
          metodoEnvio,
          inicioVigencia,
          fimVigencia,
          ...extra
        } = item || {};

        rotasRows.push({
          id: String(id),
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
          id: String(id),
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
        const {
          id,
          ibgeDestino,
          tda,
          tdr,
          trt,
          suframa,
          outras,
          gris,
          grisMinimo,
          adVal,
          adValMinimo,
          ...extra
        } = item || {};

        taxasRows.push({
          id: String(id),
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

export async function salvarBaseCompletaDb(transportadoras, chave = SNAPSHOT_CHAVE) {
  const payload = buildSnapshotPayload(transportadoras, chave);

  if (!isSupabaseConfigured()) {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(payload));
    return {
      modo: 'local',
      updated_at: payload.payload.updatedAt,
      contagens: {
        transportadoras: transportadoras?.length || 0,
      },
    };
  }

  const supabase = ensureClient();
  const {
    transportadorasRows,
    origensRows,
    generalidadesRows,
    rotasRows,
    cotacoesRows,
    taxasRows,
  } = mapBaseToTables(transportadoras);

  await replaceTable(supabase, 'taxas_especiais', taxasRows);
  await replaceTable(supabase, 'cotacoes', cotacoesRows);
  await replaceTable(supabase, 'rotas', rotasRows);
  await replaceTable(supabase, 'generalidades', generalidadesRows);
  await replaceTable(supabase, 'origens', origensRows);
  await replaceTable(supabase, 'transportadoras', transportadorasRows);

  const { data, error } = await supabase
    .from('cadastros_snapshot')
    .upsert(payload, { onConflict: 'chave' })
    .select('id, updated_at')
    .single();

  if (error) throw error;

  return {
    ...data,
    modo: 'supabase',
    contagens: {
      transportadoras: transportadorasRows.length,
      origens: origensRows.length,
      generalidades: generalidadesRows.length,
      rotas: rotasRows.length,
      cotacoes: cotacoesRows.length,
      taxasEspeciais: taxasRows.length,
    },
  };
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

export async function registrarImportacao(payload) {
  if (!isSupabaseConfigured()) {
    return { ok: true, mode: 'local', payload };
  }

  const supabase = ensureClient();
  const { data, error } = await supabase
    .from('frete_importacoes')
    .insert(payload)
    .select('id, tipo, criado_em')
    .single();

  if (error) throw error;
  return { ok: true, mode: 'remote', data };
}
