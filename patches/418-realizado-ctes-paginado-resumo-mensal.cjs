const fs = require('fs');
const path = require('path');

let changed = false;

function save(file, src, old, label) {
  if (src !== old) {
    fs.writeFileSync(file, src, 'utf8');
    changed = true;
    console.log('OK ' + label);
  } else {
    console.log('SKIP ' + label);
  }
}

function replaceExact(src, oldText, newText, label) {
  if (!src.includes(oldText)) {
    if (src.includes(newText)) return src;
    console.warn('WARN ' + label);
    return src;
  }
  changed = true;
  console.log('OK ' + label);
  return src.replace(oldText, newText);
}

function insertBefore(src, marker, block, label) {
  if (src.includes(block.trim().split('\n')[0])) return src;
  const idx = src.indexOf(marker);
  if (idx < 0) {
    console.warn('WARN ' + label);
    return src;
  }
  changed = true;
  console.log('OK ' + label);
  return src.slice(0, idx) + block + '\n' + src.slice(idx);
}

function insertAfter(src, marker, block, label) {
  if (src.includes(block.trim().split('\n')[0])) return src;
  const idx = src.indexOf(marker);
  if (idx < 0) {
    console.warn('WARN ' + label);
    return src;
  }
  changed = true;
  console.log('OK ' + label);
  return src.slice(0, idx + marker.length) + '\n' + block + src.slice(idx + marker.length);
}

function replaceBetween(src, startMarker, endMarker, newBlock, label) {
  const start = src.indexOf(startMarker);
  if (start < 0) {
    console.warn('WARN ' + label + ' start');
    return src;
  }
  const end = src.indexOf(endMarker, start);
  if (end < 0) {
    console.warn('WARN ' + label + ' end');
    return src;
  }
  const atual = src.slice(start, end);
  if (atual.includes('consultaCompleta = temFiltro && filtrosEfetivos.amostra !== true')) return src;
  changed = true;
  console.log('OK ' + label);
  return src.slice(0, start) + newBlock + '\n\n' + src.slice(end);
}

function insertAfterUnique(src, marker, block, unique, label) {
  if (src.includes(unique)) return src;
  const idx = src.indexOf(marker);
  if (idx < 0) {
    console.warn('WARN ' + label);
    return src;
  }
  changed = true;
  console.log('OK ' + label);
  return src.slice(0, idx + marker.length) + '\n' + block + src.slice(idx + marker.length);
}

function dedupeLiteralBlock(src, block, label) {
  let first = src.indexOf(block);
  if (first < 0) return src;
  let next = src.indexOf(block, first + block.length);
  let out = src;
  let removed = false;
  while (next >= 0) {
    out = out.slice(0, next) + out.slice(next + block.length);
    removed = true;
    first = out.indexOf(block);
    next = out.indexOf(block, first + block.length);
  }
  if (removed) {
    changed = true;
    console.log('OK dedupe ' + label);
  }
  return out;
}

const servicePath = path.join(process.cwd(), 'src/services/freteDatabaseService.js');
let service = fs.readFileSync(servicePath, 'utf8');
const serviceOld = service;

service = replaceExact(
  service,
  "  return Boolean(filtros.inicio || filtros.fim || filtros.canal || filtros.transportadoraRealizada || filtros.ufOrigem || filtros.ufDestino || filtros.origem || filtros.destino || filtros.somenteSemCanal);",
  "  return Boolean(filtros.competencia || filtros.inicio || filtros.fim || filtros.canal || filtros.transportadoraRealizada || filtros.ufOrigem || filtros.ufDestino || filtros.origem || filtros.destino || filtros.somenteSemCanal);",
  'competencia como filtro realizado'
);

const serviceHelpers = `const REALIZADO_PAGINADO_PAGE_SIZE = 1000;
const REALIZADO_PAGINADO_MAX_ROWS = 300000;

function aplicarFiltrosRealizadoSelectQueryDb(query, filtros = {}) {
  const origem = limparOrigemParaConsultaDb(filtros.origem || '');
  const destino = limparOrigemParaConsultaDb(filtros.destino || '');
  const transportadoraRealizada = String(filtros.transportadoraRealizada || '').trim();
  const canalVariantes = canalVariantesConsultaDb(filtros.canal || '');
  const competencia = String(filtros.competencia || '').trim().slice(0, 7);

  if (competencia) query = query.eq('competencia', competencia);
  if (filtros.inicio) query = query.gte('emissao', filtros.inicio + 'T00:00:00');
  if (filtros.fim) query = query.lte('emissao', filtros.fim + 'T23:59:59');
  if (filtros.ufOrigem) query = query.eq('uf_origem', String(filtros.ufOrigem).trim().toUpperCase());
  if (filtros.ufDestino) query = query.eq('uf_destino', String(filtros.ufDestino).trim().toUpperCase());
  if (transportadoraRealizada) query = query.ilike('transportadora', '%' + transportadoraRealizada + '%');
  if (origem) query = query.ilike('cidade_origem', origem + '%');
  if (destino) query = query.ilike('cidade_destino', destino + '%');
  if (canalVariantes.length) query = query.in('canal', canalVariantes);
  if (filtros.incluirSemCanal === false) query = query.not('canal', 'is', null).neq('canal', '');
  if (filtros.somenteSemCanal) query = query.or('canal.is.null,canal.eq.');
  return query;
}

async function listarRealizadoCtesViaSelectPaginado(supabase, filtros = {}) {
  const pageSize = Math.max(100, Math.min(Number(filtros.pageSize || REALIZADO_PAGINADO_PAGE_SIZE) || REALIZADO_PAGINADO_PAGE_SIZE, 1000));
  const totalMax = Math.max(pageSize, Math.min(Number(filtros.limit || filtros.totalMax || REALIZADO_PAGINADO_MAX_ROWS) || REALIZADO_PAGINADO_MAX_ROWS, REALIZADO_PAGINADO_MAX_ROWS));
  const onProgress = typeof filtros.onProgress === 'function' ? filtros.onProgress : null;
  let totalEncontrado = null;

  try {
    let countQuery = supabase.from('realizado_ctes').select('id', { count: 'exact', head: true });
    countQuery = aplicarFiltrosRealizadoSelectQueryDb(countQuery, filtros);
    const { count, error } = await countQuery;
    if (!error) totalEncontrado = count || 0;
  } catch {
    totalEncontrado = null;
  }

  const rows = [];
  let from = 0;
  let pagina = 1;
  onProgress?.({ etapa: 'inicio', pagina: 0, lote: 0, loteBruto: 0, carregados: 0, total: totalEncontrado, pageSize, concluido: false });

  while (from < totalMax) {
    const to = Math.min(from + pageSize - 1, totalMax - 1);
    let query = supabase
      .from('realizado_ctes')
      .select(REALIZADO_SELECT_COLUMNS)
      .order('emissao', { ascending: false, nullsFirst: false })
      .range(from, to);

    query = aplicarFiltrosRealizadoSelectQueryDb(query, filtros);
    const { data, error } = await query;
    if (error) throw error;

    const loteBruto = data || [];
    const lote = aplicarFiltroSemCanal(filtrarRealizadoLocal(loteBruto.map(normalizeRealizadoDbRow), filtros), filtros);
    rows.push(...lote);

    const concluiu = loteBruto.length < pageSize || rows.length >= totalMax || (totalEncontrado !== null && from + loteBruto.length >= totalEncontrado);
    onProgress?.({ etapa: concluiu ? 'concluido' : 'lote', pagina, lote: lote.length, loteBruto: loteBruto.length, carregados: rows.length, total: totalEncontrado, pageSize, concluido: concluiu });

    if (!loteBruto.length || loteBruto.length < pageSize) break;
    from += pageSize;
    pagina += 1;
    await aguardar(0);
  }

  return rows.slice(0, totalMax);
}

async function usuarioResponsavelResumoRealizadoDb(supabase) {
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user?.email || data?.user?.id || '';
  } catch {
    return '';
  }
}

export async function salvarResumoMensalRealizadoCtes(payload = {}) {
  if (!isSupabaseConfigured()) throw new Error('Supabase nao configurado. Nao foi possivel salvar o resumo mensal.');
  const supabase = ensureClient();
  const usuario = payload.usuario_responsavel || payload.usuarioResponsavel || await usuarioResponsavelResumoRealizadoDb(supabase);
  const row = {
    competencia: payload.competencia || '',
    periodo_inicio: payload.periodo_inicio || payload.periodoInicio || null,
    periodo_fim: payload.periodo_fim || payload.periodoFim || null,
    total_ctes: Number(payload.total_ctes ?? payload.totalCtes ?? 0) || 0,
    total_transportadoras: Number(payload.total_transportadoras ?? payload.totalTransportadoras ?? 0) || 0,
    total_origens: Number(payload.total_origens ?? payload.totalOrigens ?? 0) || 0,
    total_destinos: Number(payload.total_destinos ?? payload.totalDestinos ?? 0) || 0,
    valor_total_cte: Number(payload.valor_total_cte ?? payload.valorTotalCte ?? 0) || 0,
    valor_total_nf: Number(payload.valor_total_nf ?? payload.valorTotalNf ?? 0) || 0,
    peso_total: Number(payload.peso_total ?? payload.pesoTotal ?? 0) || 0,
    cubagem_total: Number(payload.cubagem_total ?? payload.cubagemTotal ?? 0) || 0,
    volumes_totais: Number(payload.volumes_totais ?? payload.volumesTotais ?? 0) || 0,
    frete_sobre_nf: Number(payload.frete_sobre_nf ?? payload.freteSobreNf ?? 0) || 0,
    resumo_transportadora: payload.resumo_transportadora || payload.resumoTransportadora || [],
    resumo_origem: payload.resumo_origem || payload.resumoOrigem || [],
    resumo_uf_destino: payload.resumo_uf_destino || payload.resumoUfDestino || [],
    resumo_canal: payload.resumo_canal || payload.resumoCanal || [],
    filtros: payload.filtros || {},
    usuario_responsavel: usuario || '',
  };

  const { data, error } = await supabase
    .from('realizado_ctes_resumos_mensais')
    .insert(row)
    .select('*')
    .single();

  if (error) {
    throw new Error('Erro ao salvar resumo mensal. Rode a migration 20260528_001_realizado_ctes_resumos_mensais.sql no Supabase. Detalhe: ' + error.message);
  }

  return data;
}

export async function listarResumosMensaisRealizadoCtes(limit = 5) {
  if (!isSupabaseConfigured()) return [];
  const supabase = ensureClient();
  const { data, error } = await supabase
    .from('realizado_ctes_resumos_mensais')
    .select('*')
    .order('criado_em', { ascending: false })
    .limit(Math.max(1, Math.min(Number(limit) || 5, 20)));
  if (error) return [];
  return data || [];
}

`;
service = insertBefore(service, 'function normalizeResumoRealizadoDb(raw = {}) {', serviceHelpers, 'helpers paginacao/resumo realizado');

service = replaceExact(
  service,
  `export async function carregarPainelRealizadoCtes(filtros = {}) {
  const temFiltro = temFiltroRealizadoDb(filtros);
  const limit = Math.max(1, Math.min(Number(filtros.limit || (temFiltro ? 15000 : 50)) || 50, temFiltro ? 50000 : 200));
  const filtrosBusca = { ...filtros, limit, amostra: !temFiltro };
`,
  `export async function carregarPainelRealizadoCtes(filtros = {}) {
  const temFiltro = temFiltroRealizadoDb(filtros);
  const consultaCompleta = filtros.consultaCompleta === true || filtros.paginado === true;
  const limit = consultaCompleta
    ? Math.max(1, Math.min(Number(filtros.limit || REALIZADO_PAGINADO_MAX_ROWS) || REALIZADO_PAGINADO_MAX_ROWS, REALIZADO_PAGINADO_MAX_ROWS))
    : Math.max(1, Math.min(Number(filtros.limit || (temFiltro ? 15000 : 50)) || 50, temFiltro ? 50000 : 200));
  const filtrosBusca = { ...filtros, limit, consultaCompleta, amostra: !temFiltro && !consultaCompleta };
`,
  'painel realizado consulta completa'
);

service = replaceExact(
  service,
  `export async function listarRealizadoCtes(filtros = {}) {
  const temFiltro = temFiltroRealizadoDb(filtros);
  const consultaAmpla = filtros.consultaAmpla === true;
  const filtrosSeguros = {
    ...filtros,
    limit: Math.max(1, Math.min(Number(filtros.limit || (temFiltro || consultaAmpla ? 10000 : 50)) || 50, temFiltro || consultaAmpla ? 50000 : 200)),
    amostra: filtros.amostra === true || (!temFiltro && !consultaAmpla),
  };
`,
  `export async function listarRealizadoCtes(filtros = {}) {
  const temFiltro = temFiltroRealizadoDb(filtros);
  const consultaAmpla = filtros.consultaAmpla === true;
  const consultaCompleta = filtros.consultaCompleta === true || filtros.paginado === true;
  const filtrosSeguros = {
    ...filtros,
    limit: consultaCompleta
      ? Math.max(1, Math.min(Number(filtros.limit || REALIZADO_PAGINADO_MAX_ROWS) || REALIZADO_PAGINADO_MAX_ROWS, REALIZADO_PAGINADO_MAX_ROWS))
      : Math.max(1, Math.min(Number(filtros.limit || (temFiltro || consultaAmpla ? 10000 : 50)) || 50, temFiltro || consultaAmpla ? 50000 : 200)),
    consultaCompleta,
    amostra: filtros.amostra === true || (!temFiltro && !consultaAmpla && !consultaCompleta),
  };
`,
  'listar realizado flags paginacao'
);

service = replaceExact(
  service,
  `  const timeoutConsulta = temFiltro || consultaAmpla ? 25000 : 8000;
  let amostraError = null;
`,
  `  const timeoutConsulta = consultaCompleta ? Number(filtrosSeguros.timeoutMs || 180000) : (temFiltro || consultaAmpla ? 25000 : 8000);
  let amostraError = null;

  if (consultaCompleta) {
    return await executarComTimeout(
      listarRealizadoCtesViaSelectPaginado(supabase, filtrosSeguros),
      timeoutConsulta,
      'A busca completa paginada do realizado demorou demais. Tente filtrar por competencia, periodo, canal ou origem.'
    );
  }
`,
  'listar realizado usa select paginado'
);

save(servicePath, service, serviceOld, 'freteDatabaseService 4.18');

const pagePath = path.join(process.cwd(), 'src/pages/RealizadoPage.jsx');
let page = fs.readFileSync(pagePath, 'utf8');
const pageOld = page;

page = replaceExact(
  page,
  `  excluirRealizadoCtes,
  listarRealizadoCtes,
  resolverDestinoIbgeDb,
  salvarRealizadoCtes,
} from '../services/freteDatabaseService';`,
  `  excluirRealizadoCtes,
  listarRealizadoCtes,
  listarResumosMensaisRealizadoCtes,
  resolverDestinoIbgeDb,
  salvarRealizadoCtes,
  salvarResumoMensalRealizadoCtes,
} from '../services/freteDatabaseService';`,
  'imports resumo mensal realizado'
);

page = replaceExact(
  page,
  `  inicio: '',
  fim: '',
  canal: '',`,
  `  inicio: '',
  fim: '',
  competencia: '',
  canal: '',`,
  'filtro competencia default'
);

page = replaceExact(
  page,
  `  const canal = String(filtros.canal || '').trim();
  const transportadoraRealizada = normalizarBusca(filtros.transportadoraRealizada);`,
  `  const canal = String(filtros.canal || '').trim();
  const competencia = String(filtros.competencia || '').trim().slice(0, 7);
  const transportadoraRealizada = normalizarBusca(filtros.transportadoraRealizada);`,
  'filtrarRows competencia const'
);

page = replaceExact(
  page,
  `    if (inicio && (!data || data < inicio)) return false;
    if (fim && (!data || data > fim)) return false;
    if (!canalCompativelTela(row.canal || row.canalVendas || row.canais, canal)) return false;`,
  `    if (inicio && (!data || data < inicio)) return false;
    if (fim && (!data || data > fim)) return false;
    if (competencia && getCompetencia(row) !== competencia) return false;
    if (!canalCompativelTela(row.canal || row.canalVendas || row.canais, canal)) return false;`,
  'filtrarRows aplica competencia'
);

page = replaceExact(
  page,
  `    filtros.inicio ||
    filtros.fim ||
    filtros.canal ||`,
  `    filtros.inicio ||
    filtros.fim ||
    filtros.competencia ||
    filtros.canal ||`,
  'tem filtro minimo competencia'
);

const pageHelpers = `function getCubagemResumoMensal(row = {}) {
  return safeNumber(campo(row, 'metrosCubicos', 'metros_cubicos', 'cubagem', 'cubagemTotal', 'cubagem_total'));
}

function chaveResumoMensal(value) {
  const texto = String(value || '').trim();
  return texto || 'Nao informado';
}

function agruparResumoMensal(rows = [], keyGetter) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const key = chaveResumoMensal(keyGetter(row));
    const atual = map.get(key) || { chave: key, label: key, ctes: 0, valorCte: 0, valorNF: 0, peso: 0, cubagem: 0, volumes: 0 };
    atual.ctes += 1;
    atual.valorCte += getValorCte(row);
    atual.valorNF += getValorNf(row);
    atual.peso += getPeso(row);
    atual.cubagem += getCubagemResumoMensal(row);
    atual.volumes += getVolumes(row);
    map.set(key, atual);
  });
  return [...map.values()]
    .map((item) => ({ ...item, freteSobreNf: item.valorNF > 0 ? (item.valorCte / item.valorNF) * 100 : 0 }))
    .sort((a, b) => b.valorCte - a.valorCte || b.ctes - a.ctes || a.label.localeCompare(b.label, 'pt-BR'))
    .slice(0, 80);
}

function inferirCompetenciaResumoMensal(filtros = {}, rows = []) {
  const filtroCompetencia = String(filtros.competencia || '').trim().slice(0, 7);
  if (filtroCompetencia) return filtroCompetencia;
  const inicio = String(filtros.inicio || '').slice(0, 7);
  const fim = String(filtros.fim || '').slice(0, 7);
  if (inicio && inicio === fim) return inicio;
  const competencias = [...new Set((rows || []).map(getCompetencia).filter(Boolean))];
  return competencias.length === 1 ? competencias[0] : inicio || fim || '';
}

function montarResumoMensalRealizado(rows = [], filtros = {}) {
  const base = Array.isArray(rows) ? rows : [];
  const datas = base.map((row) => String(getDataEmissao(row) || '').slice(0, 10)).filter(Boolean).sort();
  const valorTotalCte = base.reduce((acc, row) => acc + getValorCte(row), 0);
  const valorTotalNf = base.reduce((acc, row) => acc + getValorNf(row), 0);
  const pesoTotal = base.reduce((acc, row) => acc + getPeso(row), 0);
  const cubagemTotal = base.reduce((acc, row) => acc + getCubagemResumoMensal(row), 0);
  const volumesTotais = base.reduce((acc, row) => acc + getVolumes(row), 0);
  const transportadoras = new Set(base.map(getTransportadora).map(chaveResumoMensal));
  const origens = new Set(base.map((row) => [getOrigem(row), getUfOrigem(row)].filter(Boolean).join('/')).map(chaveResumoMensal));
  const destinos = new Set(base.map((row) => [getDestino(row), getUfDestino(row)].filter(Boolean).join('/')).map(chaveResumoMensal));

  return {
    competencia: inferirCompetenciaResumoMensal(filtros, base),
    periodo_inicio: filtros.inicio || datas[0] || null,
    periodo_fim: filtros.fim || datas[datas.length - 1] || null,
    total_ctes: base.length,
    total_transportadoras: transportadoras.size,
    total_origens: origens.size,
    total_destinos: destinos.size,
    valor_total_cte: valorTotalCte,
    valor_total_nf: valorTotalNf,
    peso_total: pesoTotal,
    cubagem_total: cubagemTotal,
    volumes_totais: volumesTotais,
    frete_sobre_nf: valorTotalNf > 0 ? (valorTotalCte / valorTotalNf) * 100 : 0,
    resumo_transportadora: agruparResumoMensal(base, getTransportadora),
    resumo_origem: agruparResumoMensal(base, (row) => [getOrigem(row), getUfOrigem(row)].filter(Boolean).join('/')),
    resumo_uf_destino: agruparResumoMensal(base, getUfDestino),
    resumo_canal: agruparResumoMensal(base, (row) => categoriaCanalTela(getCanal(row))),
    filtros,
  };
}

function normalizarResumoMensalCard(row = {}) {
  return {
    competencia: row.competencia || '',
    totalCtes: Number(row.total_ctes ?? row.totalCtes ?? 0) || 0,
    valorTotalCte: Number(row.valor_total_cte ?? row.valorTotalCte ?? 0) || 0,
    valorTotalNf: Number(row.valor_total_nf ?? row.valorTotalNf ?? 0) || 0,
    freteSobreNf: Number(row.frete_sobre_nf ?? row.freteSobreNf ?? 0) || 0,
    periodoInicio: row.periodo_inicio ?? row.periodoInicio ?? '',
    periodoFim: row.periodo_fim ?? row.periodoFim ?? '',
    criadoEm: row.criado_em ?? row.criadoEm ?? '',
    usuario: row.usuario_responsavel ?? row.usuarioResponsavel ?? '',
  };
}

`;
page = insertBefore(page, 'function formatDiagCount(value, sufixo = \'\') {', pageHelpers, 'helpers resumo mensal page');

if (!page.includes('const [progressoCarga, setProgressoCarga]')) {
  page = replaceExact(
    page,
    `  const [rows, setRows] = useState([]);
  const [resumoRealizado, setResumoRealizado] = useState(null);`,
    `  const [rows, setRows] = useState([]);
  const [resumoRealizado, setResumoRealizado] = useState(null);
  const [progressoCarga, setProgressoCarga] = useState(null);
  const [salvandoResumoMensal, setSalvandoResumoMensal] = useState(false);
  const [ultimoResumoMensal, setUltimoResumoMensal] = useState(null);`,
    'states resumo mensal'
  );
}

page = replaceBetween(
  page,
  '  async function carregarBase(filtrosCarga = filtros) {',
  '  useEffect(() => {',
  `  async function carregarBase(filtrosCarga = filtros) {
    setCarregando(true);
    setErro('');
    setProgressoCarga(null);
    try {
      const filtrosEfetivos = { ...DEFAULT_FILTROS, ...filtrosCarga };
      const temFiltro = temFiltroMinimoRealizado(filtrosEfetivos);
      const consultaCompleta = temFiltro && filtrosEfetivos.amostra !== true;
      const onProgress = consultaCompleta
        ? (progress) => {
            const total = Number(progress.total || 0);
            const carregados = Number(progress.carregados || 0);
            const percentual = total > 0 ? Math.min(99, Math.round((carregados / total) * 100)) : Math.min(95, Number(progress.pagina || 0) * 4);
            setProgressoCarga({ ...progress, percentual, ativo: true });
            setFeedback(\`Buscando CT-es em lotes: \${carregados.toLocaleString('pt-BR')}\${total ? ' de ' + total.toLocaleString('pt-BR') : ''} carregados. Lote \${Number(progress.pagina || 0).toLocaleString('pt-BR')}.\`);
          }
        : null;

      const painel = await carregarPainelRealizadoCtes({
        inicio: filtrosEfetivos.inicio,
        fim: filtrosEfetivos.fim,
        competencia: filtrosEfetivos.competencia,
        canal: filtrosEfetivos.canal,
        transportadoraRealizada: filtrosEfetivos.transportadoraRealizada,
        ufOrigem: filtrosEfetivos.ufOrigem,
        ufDestino: filtrosEfetivos.ufDestino,
        origem: filtrosEfetivos.origem,
        destino: filtrosEfetivos.destino,
        limit: consultaCompleta ? 300000 : 50,
        pageSize: 1000,
        consultaCompleta,
        incluirSemCanal: temFiltro,
        amostra: !temFiltro,
        onProgress,
      });

      const data = painel.rows || [];
      const resumo = painel.resumo || null;
      setRows(data);
      setResumoRealizado(resumo);
      setFiltrosAplicados({ ...DEFAULT_FILTROS, ...filtrosEfetivos });

      const totalResumo = Number(resumo?.total || data.length || 0);
      const comCanalResumo = Number(resumo?.comCanal || data.filter(hasCanalRealizado).length || 0);
      const semCanalResumo = Number(resumo?.semCanal || Math.max(data.length - comCanalResumo, 0) || 0);

      if (consultaCompleta) {
        setProgressoCarga((prev) => prev ? { ...prev, carregados: data.length, percentual: 100, concluido: true } : null);
      }

      if (!temFiltro) {
        setFeedback(
          \`Base realizada conectada: \${totalResumo.toLocaleString('pt-BR')} CT-e(s) no Supabase, \${comCanalResumo.toLocaleString('pt-BR')} com canal e \${semCanalResumo.toLocaleString('pt-BR')} sem canal. Mostrando amostra de \${data.length.toLocaleString('pt-BR')} linha(s).\`
        );
      } else {
        setFeedback(
          data.length
            ? \`Filtro carregado em base completa: \${data.length.toLocaleString('pt-BR')} CT-e(s) carregados em lote(s), \${comCanalResumo.toLocaleString('pt-BR')} com canal e \${semCanalResumo.toLocaleString('pt-BR')} pendencia(s).\`
            : 'Nenhum CT-e encontrado para os filtros atuais.'
        );
      }

      if (painel.erroAmostra) {
        setErro(\`Resumo carregado, mas a amostra da tabela falhou: \${painel.erroAmostra}\`);
      }
    } catch (error) {
      setErro(error.message || 'Erro ao carregar base realizada.');
    } finally {
      setCarregando(false);
    }
  }

`,
  'carregarBase paginada'
);

if (!page.includes('const resumos = await listarResumosMensaisRealizadoCtes(1).catch(() => []);')) {
  page = replaceExact(
    page,
    `        await carregarBase({ ...DEFAULT_FILTROS, amostra: true });`,
    `        await carregarBase({ ...DEFAULT_FILTROS, amostra: true });
        const resumos = await listarResumosMensaisRealizadoCtes(1).catch(() => []);
        if (ativo && resumos[0]) setUltimoResumoMensal(resumos[0]);`,
    'carrega ultimo resumo mensal'
  );
}

page = replaceExact(
  page,
  `  const rowsValidas = useMemo(() => rows.filter(hasCanalRealizado), [rows]);
  const rowsSemCanal = useMemo(() => rows.filter((row) => !hasCanalRealizado(row)), [rows]);
  const rowsFiltradas = useMemo(() => filtrarRows(rowsValidas, filtrosAplicados), [rowsValidas, filtrosAplicados]);
  const pendenciasFiltradas = useMemo(() => filtrarRows(rowsSemCanal, { ...filtrosAplicados, canal: '' }), [rowsSemCanal, filtrosAplicados]);`,
  `  const rowsValidas = useMemo(() => rows.filter(hasCanalRealizado), [rows]);
  const rowsSemCanal = useMemo(() => rows.filter((row) => !hasCanalRealizado(row)), [rows]);
  const rowsResumoMensal = useMemo(() => filtrarRows(rows, filtrosAplicados), [rows, filtrosAplicados]);
  const rowsFiltradas = useMemo(() => filtrarRows(rowsValidas, filtrosAplicados), [rowsValidas, filtrosAplicados]);
  const pendenciasFiltradas = useMemo(() => filtrarRows(rowsSemCanal, { ...filtrosAplicados, canal: '' }), [rowsSemCanal, filtrosAplicados]);
  const resumoMensalAtual = useMemo(() => montarResumoMensalRealizado(rowsResumoMensal, filtrosAplicados), [rowsResumoMensal, filtrosAplicados]);
  const ultimoResumoCard = useMemo(() => normalizarResumoMensalCard(ultimoResumoMensal), [ultimoResumoMensal]);`,
  'memos resumo mensal'
);

const salvarResumoFunction = `  async function salvarResumoMensal() {
    if (!rowsResumoMensal.length) {
      setErro('Pesquise uma base mensal antes de salvar o resumo.');
      return;
    }

    setSalvandoResumoMensal(true);
    setErro('');
    try {
      const payload = montarResumoMensalRealizado(rowsResumoMensal, filtrosAplicados);
      const salvo = await salvarResumoMensalRealizadoCtes(payload);
      setUltimoResumoMensal(salvo);
      setFeedback(\`Resumo mensal salvo: \${payload.competencia || 'periodo filtrado'} com \${Number(payload.total_ctes || 0).toLocaleString('pt-BR')} CT-e(s).\`);
    } catch (error) {
      setErro(error.message || 'Erro ao salvar resumo mensal.');
    } finally {
      setSalvandoResumoMensal(false);
    }
  }

`;
page = insertBefore(page, '  async function onSimular() {', salvarResumoFunction, 'func salvar resumo mensal');

page = replaceExact(
  page,
  `    const limite = rowsFiltradas.slice(0, 6000);
    const totalSimular = limite.length;`,
  `    const limite = rowsFiltradas;
    const totalSimular = limite.length;`,
  'simular usa base completa'
);

page = replaceExact(
  page,
  `      if (rowsFiltradas.length > limite.length) {
        setFeedback(\`Simulando os primeiros \${limite.length.toLocaleString('pt-BR')} CT-e(s) dos filtros para manter a tela leve.\`);
      }

      setSimProgress({`,
  `      setSimProgress({`,
  'remove corte 6000 feedback'
);

page = replaceExact(
  page,
  `      if (rowsFiltradas.length > limite.length) {
        setFeedback(\`Simulando os primeiros \${limite.length.toLocaleString('pt-BR')} CT-e(s) dos filtros para manter a tela leve.\`);
      }

      setSimProgress({`,
  `      setSimProgress({`,
  'remove corte 6000 feedback pós-base'
);

const progressUi = `
      {progressoCarga ? (
        <div className="sim-alert info">
          <div className="sim-parametros-header">
            <div>
              <strong>Busca paginada de CT-es</strong>
              <p>
                {Number(progressoCarga.carregados || 0).toLocaleString('pt-BR')}
                {progressoCarga.total ? ' de ' + Number(progressoCarga.total || 0).toLocaleString('pt-BR') : ''} CT-e(s) carregados
                {progressoCarga.pagina ? ' • lote ' + Number(progressoCarga.pagina || 0).toLocaleString('pt-BR') : ''}.
              </p>
            </div>
            <span>{Number(progressoCarga.percentual || 0).toLocaleString('pt-BR')}%</span>
          </div>
          <div style={{ height: 10, borderRadius: 999, background: 'rgba(0,0,0,0.08)', overflow: 'hidden', marginTop: 10 }}>
            <div style={{ height: '100%', width: \`\${Math.min(100, Math.max(0, Number(progressoCarga.percentual || 0)))}%\`, borderRadius: 999, background: '#2563eb', transition: 'width 180ms ease' }} />
          </div>
        </div>
      ) : null}
`;
page = insertAfter(page, `      {feedback ? <div className="sim-alert info">{feedback}</div> : null}
`, progressUi, 'ui progresso carga');

const resumoMensalUi = `
      <section className="sim-card top-space">
        <div className="sim-parametros-header">
          <div>
            <h2>Resumo mensal dos CT-es realizados</h2>
            <p>Salve um snapshot consolidado da ultima base pesquisada, incluindo totais e agrupamentos principais para consulta posterior.</p>
          </div>
          <button className="btn-primary" onClick={salvarResumoMensal} disabled={salvandoResumoMensal || carregando || importando || simulando || !rowsResumoMensal.length}>
            {salvandoResumoMensal ? 'Salvando resumo...' : 'Salvar resumo mensal'}
          </button>
        </div>
        <div className="sim-analise-resumo top-space">
          <div><span>Competencia</span><strong>{resumoMensalAtual.competencia || 'Periodo'}</strong></div>
          <div><span>CT-e(s) carregados</span><strong>{Number(resumoMensalAtual.total_ctes || 0).toLocaleString('pt-BR')}</strong></div>
          <div><span>Transportadoras</span><strong>{Number(resumoMensalAtual.total_transportadoras || 0).toLocaleString('pt-BR')}</strong></div>
          <div><span>Origens</span><strong>{Number(resumoMensalAtual.total_origens || 0).toLocaleString('pt-BR')}</strong></div>
          <div><span>Destinos</span><strong>{Number(resumoMensalAtual.total_destinos || 0).toLocaleString('pt-BR')}</strong></div>
          <div><span>Valor CT-e</span><strong>{formatCurrency(resumoMensalAtual.valor_total_cte)}</strong></div>
          <div><span>Valor NF</span><strong>{formatCurrency(resumoMensalAtual.valor_total_nf)}</strong></div>
          <div><span>Frete/NF</span><strong>{formatPercent(resumoMensalAtual.frete_sobre_nf)}</strong></div>
        </div>
        {ultimoResumoCard.totalCtes ? (
          <div className="import-meta-box success top-space">
            <strong>Ultimo resumo salvo:</strong> {ultimoResumoCard.competencia || 'periodo'} • {ultimoResumoCard.totalCtes.toLocaleString('pt-BR')} CT-e(s) • {formatCurrency(ultimoResumoCard.valorTotalCte)} • {formatPercent(ultimoResumoCard.freteSobreNf)}
            {ultimoResumoCard.criadoEm ? <span> • salvo em {formatDateBr(ultimoResumoCard.criadoEm)}</span> : null}
            {ultimoResumoCard.usuario ? <span> • {ultimoResumoCard.usuario}</span> : null}
          </div>
        ) : null}
      </section>
`;
if (!page.includes('Resumo mensal dos CT-es realizados')) {
  const tituloPainel = page.indexOf('<h2>Painel de gest');
  const inicioSecaoPainel = tituloPainel >= 0 ? page.lastIndexOf('      <section', tituloPainel) : -1;
  if (inicioSecaoPainel >= 0) {
    changed = true;
    console.log('OK ui resumo mensal');
    page = page.slice(0, inicioSecaoPainel) + resumoMensalUi + '\n' + page.slice(inicioSecaoPainel);
  } else {
    console.warn('WARN ui resumo mensal');
  }
}

page = dedupeLiteralBlock(
  page,
  `  const [progressoCarga, setProgressoCarga] = useState(null);
  const [salvandoResumoMensal, setSalvandoResumoMensal] = useState(false);
  const [ultimoResumoMensal, setUltimoResumoMensal] = useState(null);
`,
  'states resumo mensal'
);
page = dedupeLiteralBlock(
  page,
  `        const resumos = await listarResumosMensaisRealizadoCtes(1).catch(() => []);
        if (ativo && resumos[0]) setUltimoResumoMensal(resumos[0]);
`,
  'ultimo resumo mensal'
);

page = replaceExact(
  page,
  `            <div className="field"><label>Data inicial</label><input type="date" value={filtros.inicio} onChange={(e) => alterarFiltro('inicio', e.target.value)} /></div>
            <div className="field"><label>Data final</label><input type="date" value={filtros.fim} onChange={(e) => alterarFiltro('fim', e.target.value)} /></div>
            <div className="field"><label>Transportadora realizada</label><input list="transportadoras-realizadas-list" value={filtros.transportadoraRealizada} onChange={(e) => alterarFiltro('transportadoraRealizada', e.target.value)} placeholder="Todas" /></div>`,
  `            <div className="field"><label>Data inicial</label><input type="date" value={filtros.inicio} onChange={(e) => alterarFiltro('inicio', e.target.value)} /></div>
            <div className="field"><label>Data final</label><input type="date" value={filtros.fim} onChange={(e) => alterarFiltro('fim', e.target.value)} /></div>
            <div className="field"><label>Competencia</label><input type="month" value={filtros.competencia} onChange={(e) => alterarFiltro('competencia', e.target.value)} /></div>
            <div className="field"><label>Transportadora realizada</label><input list="transportadoras-realizadas-list" value={filtros.transportadoraRealizada} onChange={(e) => alterarFiltro('transportadoraRealizada', e.target.value)} placeholder="Todas" /></div>`,
  'campo competencia ui'
);

save(pagePath, page, pageOld, 'RealizadoPage 4.18');

console.log(changed ? '4.18 aplicado.' : '4.18 sem alteracoes.');
