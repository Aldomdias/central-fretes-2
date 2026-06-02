import { useEffect, useMemo, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { parseRealizadoCtesFile } from '../utils/realizadoCtes';
import {
  importarRealizadoMensalEnxuto,
  listarPendenciasIbgeRealizadoMensal,
  verificarCompetenciaRealizadoMensal,
} from '../services/realizadoMensalService';
import {
  buscarCompetenciaCtesResumoExistente,
  listarCompetenciasCtesResumo,
  salvarCompetenciaCtesResumo,
} from '../services/ctesCompetenciasResumoService';
import {
  aplicarVinculoTransportadora,
  carregarVinculosTransportadoras,
  criarMapaVinculosTransportadoras,
} from '../services/vinculosTransportadorasService';
import { CANAIS_OPERACIONAIS, CANAL_A_DEFINIR, normalizarCanalOperacional } from '../utils/canalTransportadora';

const UF_OPTIONS = ['', 'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
const TABELA = 'realizado_local_ctes';
const PAGE_SIZE = 50;
const ANALISE_BATCH_SIZE = 1000;

const TOMADORES_PERMITIDOS = ['CPX', 'ITR', 'GP PNEUS'];

function monthNow() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function normalizarCanalRow(row) {
  const canalBanco = campo(row, 'canal');
  if (canalBanco) return normalizarCanalOperacional(canalBanco, { permitirInferencia: false });
  const original = campo(row, 'canal_original', 'canalOriginal', 'canal_vendas', 'canalVendas', 'canais');
  return original ? normalizarCanalOperacional(original, { permitirInferencia: false }) : '';
}

function fmt(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtN(v, casas = 0) {
  return Number(v || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

function fmtPct(v, casas = 1) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return '-';
  return `${n.toFixed(casas).replace('.', ',')}%`;
}

function fmtDate(v) {
  if (!v) return '-';
  const s = String(v).slice(0, 10);
  const [y, m, d] = s.split('-');
  return d && m && y ? `${d}/${m}/${y}` : s;
}

function fmtMes(v) {
  if (!v) return '-';
  const data = String(v).slice(0, 7);
  const [ano, mes] = data.split('-');
  return ano && mes ? `${mes}/${ano}` : data;
}

function safeNumber(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function transportadoraOuTomadorContem(row, termo) {
  const alvo = `${getTransportadora(row)} ${getTomador(row)}`;
  return normalizarTexto(alvo).includes(normalizarTexto(termo));
}

function isEbazarCte(row) {
  return transportadoraOuTomadorContem(row, 'EBAZAR');
}

function isCpsLogCte(row) {
  const texto = normalizarTexto(`${getTransportadora(row)} ${getTomador(row)}`);
  return texto.includes('CPS LOG') || texto.includes('CPSLOG');
}

function isTomadorPermitidoCte(row) {
  const tomador = normalizarTexto(getTomador(row));
  if (!tomador || tomador === '-') return true;
  return TOMADORES_PERMITIDOS.some((permitido) => tomador.includes(normalizarTexto(permitido)));
}

function aplicarFiltrosPadraoCte(rows = [], { ocultarEbazar = true, incluirCpsLog = false } = {}) {
  return (rows || []).filter((row) => {
    if (!isTomadorPermitidoCte(row)) return false;
    if (ocultarEbazar && isEbazarCte(row)) return false;
    if (!incluirCpsLog && isCpsLogCte(row)) return false;
    return true;
  });
}

function temFiltroAtivo(filtros = {}) {
  return Object.values(filtros).some((valor) => String(valor || '').trim() !== '');
}

function campo(row, ...chaves) {
  for (const k of chaves) {
    if (row?.[k] !== undefined && row?.[k] !== null && row?.[k] !== '') return row[k];
  }
  return '';
}

function getDataEmissao(row) {
  return campo(row, 'data_emissao', 'emissao', 'dataEmissao');
}

function getTransportadora(row) {
  return campo(row, 'transportadora', 'nome_transportadora', 'transportadora_realizada');
}

function getTransportadoraOriginal(row) {
  return campo(row, 'transportadora_cte_original', 'transportadora_original_cte', 'transportadora_original') || getTransportadora(row);
}

function aplicarVinculosTransportadorasRows(rows = [], mapaVinculos) {
  if (!mapaVinculos || !mapaVinculos.size) return rows || [];

  return (rows || []).map((row) => {
    const nomeOriginal = getTransportadora(row);
    const nomeVinculado = aplicarVinculoTransportadora(nomeOriginal, mapaVinculos);
    if (!nomeOriginal || nomeVinculado === nomeOriginal) return row;

    return {
      ...row,
      transportadora_cte_original: nomeOriginal,
      transportadora_vinculada: nomeVinculado,
      transportadora: nomeVinculado,
    };
  });
}

function aplicarVinculosResumoTransportadoras(lista = [], mapaVinculos) {
  if (!mapaVinculos || !mapaVinculos.size) return lista || [];

  const mapa = new Map();
  (lista || []).forEach((item) => {
    const nomeOriginal = item.key || item.label || '';
    const nomeVinculado = aplicarVinculoTransportadora(nomeOriginal, mapaVinculos) || nomeOriginal;
    const atual = mapa.get(nomeVinculado) || {
      ...item,
      key: nomeVinculado,
      label: nomeVinculado,
      nomesOriginais: new Set(),
      ctes: 0,
      valorCte: 0,
      valorNf: 0,
      peso: 0,
      volumes: 0,
      rotas: 0,
      transportadoras: 0,
    };

    if (nomeOriginal && nomeOriginal !== nomeVinculado) atual.nomesOriginais.add(nomeOriginal);
    atual.ctes += Number(item.ctes || 0);
    atual.valorCte += Number(item.valorCte || 0);
    atual.valorNf += Number(item.valorNf || 0);
    atual.peso += Number(item.peso || 0);
    atual.volumes += Number(item.volumes || 0);
    atual.rotas += Number(item.rotas || 0);
    atual.transportadoras += Number(item.transportadoras || 1);
    mapa.set(nomeVinculado, atual);
  });

  return [...mapa.values()].map((item) => ({
    ...item,
    nomesOriginais: [...(item.nomesOriginais || [])],
    percentualFrete: item.valorNf > 0 ? (item.valorCte / item.valorNf) * 100 : 0,
    ticketMedio: item.ctes > 0 ? item.valorCte / item.ctes : 0,
  }));
}

function aplicarVinculosCompetenciasResumo(rows = [], mapaVinculos) {
  if (!mapaVinculos || !mapaVinculos.size) return rows || [];

  return (rows || []).map((row) => ({
    ...row,
    resumo_transportadoras_json: aplicarVinculosResumoTransportadoras(row.resumo_transportadoras_json || [], mapaVinculos),
  }));
}

function getOrigem(row) {
  return campo(row, 'cidade_origem', 'cidadeOrigem', 'origem');
}

function getUfOrigem(row) {
  return campo(row, 'uf_origem', 'ufOrigem');
}

function getDestino(row) {
  return campo(row, 'cidade_destino', 'cidadeDestino', 'destino');
}

function getUfDestino(row) {
  return campo(row, 'uf_destino', 'ufDestino');
}

function getCanal(row) {
  return normalizarCanalRow(row) || '';
}

function getValorCte(row) {
  return safeNumber(campo(row, 'valor_cte', 'valorCte', 'valor_frete', 'frete'));
}

function getValorCalculado(row) {
  return safeNumber(campo(row, 'valor_calculado', 'valorCalculado', 'frete_calculado', 'freteCalculado'));
}

function getDiferenca(row) {
  const informada = campo(row, 'diferenca', 'diferenca_calculada', 'diferencaCalculada');
  if (informada !== '') return safeNumber(informada);
  const calculado = getValorCalculado(row);
  return calculado > 0 ? getValorCte(row) - calculado : 0;
}

function getValorNf(row) {
  return safeNumber(campo(row, 'valor_nf', 'valorNF', 'nf_venda', 'valor_nota'));
}

function getPeso(row) {
  return safeNumber(campo(row, 'peso', 'peso_final', 'pesoFinal', 'peso_declarado', 'pesoDeclarado'));
}

function getVolumes(row) {
  return safeNumber(campo(row, 'qtd_volumes', 'qtdVolumes', 'volume', 'volumes'));
}

function getNumeroCte(row) {
  return campo(row, 'numero_cte', 'numeroCte', 'cte', 'nro_cte');
}

function getSituacao(row) {
  return campo(row, 'situacao', 'status', 'status_cte');
}

function getTomador(row) {
  return campo(row, 'tomador_servico', 'tomadorServico', 'tomador', 'nome_tomador', 'razao_social_tomador') || '-';
}

function getCompetencia(row) {
  const competencia = campo(row, 'competencia', 'mes_competencia');
  if (competencia) return competencia;
  const data = getDataEmissao(row);
  return data ? String(data).slice(0, 7) : '';
}

function getTipoVeiculo(row) {
  return campo(row, 'tipo_veiculo', 'tipoVeiculo', 'tipo', 'veiculo') || 'Não informado';
}

function getRotaKey(row) {
  return [getOrigem(row), getUfOrigem(row), getDestino(row), getUfDestino(row), getTipoVeiculo(row), getCanal(row)]
    .map(normalizarTexto)
    .join('|');
}

function getRotaLabel(row) {
  const origem = getOrigem(row) || '-';
  const ufOrigem = getUfOrigem(row);
  const destino = getDestino(row) || '-';
  const ufDestino = getUfDestino(row);
  const origemFmt = ufOrigem ? `${origem}/${ufOrigem}` : origem;
  const destinoFmt = ufDestino ? `${destino}/${ufDestino}` : destino;
  return `${origemFmt} → ${destinoFmt}`;
}

function getOrigemLabel(row) {
  const origem = getOrigem(row) || 'Não informado';
  const uf = getUfOrigem(row);
  return uf ? `${origem}/${uf}` : origem;
}

function getDestinoLabel(row) {
  const destino = getDestino(row) || 'Não informado';
  const uf = getUfDestino(row);
  return uf ? `${destino}/${uf}` : destino;
}

function getTipoOperacao(row) {
  return getTipoVeiculo(row) || 'Não informado';
}

function getStatusCalculo(row) {
  return getValorCalculado(row) > 0 ? 'com_calculo' : 'sem_calculo';
}

function labelStatusCalculo(valor) {
  if (valor === 'com_calculo') return 'Com cálculo';
  if (valor === 'sem_calculo') return 'Sem cálculo';
  return valor || 'Não informado';
}

function getRegiaoPorUf(uf) {
  const u = String(uf || '').toUpperCase();
  if (['AC', 'AP', 'AM', 'PA', 'RO', 'RR', 'TO'].includes(u)) return 'Norte';
  if (['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'PR', 'RN', 'SE'].includes(u)) return 'Nordeste';
  if (['DF', 'GO', 'MT', 'MS'].includes(u)) return 'Centro-Oeste';
  if (['ES', 'MG', 'RJ', 'SP'].includes(u)) return 'Sudeste';
  if (['PR', 'RS', 'SC'].includes(u)) return 'Sul';
  return 'Não informado';
}

const FILTROS_INTERATIVOS_INICIAIS = {
  transportadora: null,
  regiaoDestino: null,
  ufDestino: null,
  ufOrigem: null,
  origem: null,
  destino: null,
  canal: null,
  rota: null,
  tipoOperacao: null,
  statusCalculo: null,
};

const LABEL_FILTROS_INTERATIVOS = {
  transportadora: 'Transportadora',
  regiaoDestino: 'Região destino',
  ufDestino: 'UF destino',
  ufOrigem: 'UF origem',
  origem: 'Origem',
  destino: 'Destino',
  canal: 'Canal',
  rota: 'Rota',
  tipoOperacao: 'Tipo operação',
  statusCalculo: 'Status cálculo',
};

function filtrosInterativosAtivos(filtros = {}) {
  return Object.entries(filtros).filter(([, valor]) => valor !== null && valor !== undefined && valor !== '');
}

function labelValorFiltroInterativo(tipo, valor) {
  if (tipo === 'statusCalculo') return labelStatusCalculo(valor);
  return valor || 'Não informado';
}

function aplicarFiltrosInterativos(rows = [], filtros = {}) {
  const ativos = filtrosInterativosAtivos(filtros);
  if (!ativos.length) return rows;

  return (rows || []).filter((row) => {
    if (filtros.transportadora && (getTransportadora(row) || 'Não informado') !== filtros.transportadora) return false;
    if (filtros.regiaoDestino && getRegiaoPorUf(getUfDestino(row)) !== filtros.regiaoDestino) return false;
    if (filtros.ufDestino && (getUfDestino(row) || 'Não informado') !== filtros.ufDestino) return false;
    if (filtros.ufOrigem && (getUfOrigem(row) || 'Não informado') !== filtros.ufOrigem) return false;
    if (filtros.origem && getOrigemLabel(row) !== filtros.origem) return false;
    if (filtros.destino && getDestinoLabel(row) !== filtros.destino) return false;
    if (filtros.canal && (getCanal(row) || 'Não informado') !== filtros.canal) return false;
    if (filtros.rota && getRotaKey(row) !== filtros.rota) return false;
    if (filtros.tipoOperacao && getTipoOperacao(row) !== filtros.tipoOperacao) return false;
    if (filtros.statusCalculo && getStatusCalculo(row) !== filtros.statusCalculo) return false;
    return true;
  });
}

function diasEntre(inicio, fim, fallbackRows = []) {
  const datas = fallbackRows
    .map((row) => String(getDataEmissao(row) || '').slice(0, 10))
    .filter(Boolean)
    .sort();

  const dataInicio = inicio || datas[0];
  const dataFim = fim || datas[datas.length - 1];

  if (!dataInicio || !dataFim) return 1;

  const ini = new Date(`${dataInicio}T00:00:00`);
  const end = new Date(`${dataFim}T00:00:00`);
  const diff = Math.round((end - ini) / 86400000) + 1;
  return Math.max(diff || 1, 1);
}

function mesesEntre(inicio, fim, fallbackRows = []) {
  const datas = fallbackRows
    .map((row) => String(getDataEmissao(row) || '').slice(0, 10))
    .filter(Boolean)
    .sort();

  const dataInicio = inicio || datas[0];
  const dataFim = fim || datas[datas.length - 1];

  if (!dataInicio || !dataFim) return 1;

  const ini = new Date(`${dataInicio}T00:00:00`);
  const end = new Date(`${dataFim}T00:00:00`);
  const meses = (end.getFullYear() - ini.getFullYear()) * 12 + (end.getMonth() - ini.getMonth()) + 1;
  return Math.max(meses || 1, 1);
}

function agrupar(rows, keyGetter, extra = {}) {
  const mapa = new Map();

  rows.forEach((row) => {
    const key = keyGetter(row) || 'Não informado';
    const atual = mapa.get(key) || {
      key,
      label: key,
      ctes: 0,
      valorCte: 0,
      valorCalculado: 0,
      diferenca: 0,
      valorNf: 0,
      peso: 0,
      volumes: 0,
      rotas: new Set(),
      transportadoras: new Set(),
      canais: new Set(),
      ...extra,
    };

    atual.ctes += 1;
    atual.valorCte += getValorCte(row);
    atual.valorCalculado += getValorCalculado(row);
    atual.diferenca += getDiferenca(row);
    atual.valorNf += getValorNf(row);
    atual.peso += getPeso(row);
    atual.volumes += getVolumes(row);
    atual.rotas.add(getRotaKey(row));
    atual.transportadoras.add(getTransportadora(row));
    atual.canais.add(getCanal(row));

    mapa.set(key, atual);
  });

  return [...mapa.values()].map((item) => ({
    ...item,
    rotas: item.rotas.size,
    transportadoras: item.transportadoras.size,
    canais: item.canais.size,
    percentualFrete: item.valorNf > 0 ? (item.valorCte / item.valorNf) * 100 : 0,
    ticketMedio: item.ctes > 0 ? item.valorCte / item.ctes : 0,
  }));
}


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFetchNetworkError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('fetch failed') || msg.includes('timeout') || msg.includes('aborted');
}

async function executarQuerySupabaseComRetry(montarQuery, contexto = 'consulta Supabase', tentativas = 3) {
  let ultimoErro = null;

  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    try {
      return await montarQuery();
    } catch (error) {
      ultimoErro = error;
      if (!isFetchNetworkError(error) || tentativa >= tentativas) break;
      await sleep(500 * tentativa);
    }
  }

  const detalhe = ultimoErro?.message || String(ultimoErro || 'erro desconhecido');
  throw new Error(`${contexto}: ${detalhe}`);
}

function aplicarFiltros(query, filtros = {}) {
  if (filtros.ufOrigem) query = query.eq('uf_origem', filtros.ufOrigem);
  if (filtros.ufDestino) query = query.eq('uf_destino', filtros.ufDestino);
  if (filtros.transportadoraRealizada) query = query.ilike('transportadora', `%${filtros.transportadoraRealizada}%`);
  if (filtros.origem) query = query.ilike('cidade_origem', `${filtros.origem}%`);
  if (filtros.destino) query = query.ilike('cidade_destino', `${filtros.destino}%`);
  if (filtros.inicio) query = query.gte('data_emissao', filtros.inicio);
  if (filtros.fim) query = query.lte('data_emissao', filtros.fim);
  return query;
}

function aplicarFiltroCanalNormalizado(rows = [], filtros = {}) {
  if (!filtros.canal) return rows || [];
  return (rows || []).filter((row) => getCanal(row) === filtros.canal);
}

async function buscarCtesPagina(filtros = {}, pagina = 1) {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado. Verifique o .env.');
  if (!temFiltroAtivo(filtros)) {
    throw new Error('Informe pelo menos um filtro antes de buscar. Isso evita timeout ao carregar a base inteira de CT-es.');
  }

  const supabase = getSupabaseClient();
  const inicio = (Number(pagina || 1) - 1) * PAGE_SIZE;
  const fim = inicio + PAGE_SIZE - 1;

  const resposta = await executarQuerySupabaseComRetry(async () => {
    let query = supabase
      .from(TABELA)
      .select('*')
      .order('data_emissao', { ascending: false, nullsFirst: false })
      .range(inicio, fim + 1);

    query = aplicarFiltros(query, filtros);
    return query;
  }, `Erro Supabase (${TABELA}) ao buscar página de CT-es`);

  const { data, error } = resposta || {};
  if (error) throw new Error(`Erro Supabase (${TABELA}): ${error.message}`);

  const linhas = aplicarFiltroCanalNormalizado(data || [], filtros);

  return {
    data: linhas.slice(0, PAGE_SIZE),
    hasNext: linhas.length > PAGE_SIZE,
    pagina: Number(pagina || 1),
    pageSize: PAGE_SIZE,
  };
}

async function buscarCtesParaAnalise(filtros = {}, onProgress) {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado. Verifique o .env.');
  if (!temFiltroAtivo(filtros)) return [];

  const supabase = getSupabaseClient();
  const acumulado = [];
  let total = null;

  for (let inicio = 0; ; inicio += ANALISE_BATCH_SIZE) {
    const fim = inicio + ANALISE_BATCH_SIZE - 1;

    const resposta = await executarQuerySupabaseComRetry(async () => {
      let query = supabase
        .from(TABELA)
        .select('*', inicio === 0 ? { count: 'exact' } : undefined)
        .order('data_emissao', { ascending: false, nullsFirst: false })
        .range(inicio, fim);

      query = aplicarFiltros(query, filtros);
      return query;
    }, `Erro Supabase (${TABELA}) ao montar análise de CT-es`);

    const { data, error, count } = resposta || {};
    if (error) throw new Error(`Erro Supabase (${TABELA}): ${error.message}`);
    if (Number.isFinite(count)) total = count;

    const loteBruto = data || [];
    const lote = aplicarFiltroCanalNormalizado(loteBruto, filtros);
    acumulado.push(...lote);
    onProgress?.({ carregados: acumulado.length, total });

    if (loteBruto.length < ANALISE_BATCH_SIZE) break;
  }

  return acumulado;
}

function SummaryCard({ title, value, subtitle, tone, onClick, active = false, titleAttr }) {
  const clicavel = typeof onClick === 'function';
  return (
    <div
      className="summary-card"
      onClick={onClick}
      title={titleAttr || (clicavel ? `Clique para filtrar por ${title}` : undefined)}
      style={clicavel ? {
        cursor: 'pointer',
        border: active ? '2px solid #185FA5' : undefined,
        background: active ? '#eff6ff' : undefined,
      } : undefined}
    >
      <span>{title}</span>
      <strong className={tone || ''}>{value}</strong>
      <small>{subtitle}</small>
    </div>
  );
}

function ExpandCard({ title, subtitle, badge, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="table-card" style={{ overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          width: '100%',
          border: 'none',
          background: 'var(--panel-soft)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '16px 18px',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div>
          <div className="panel-title">{title}</div>
          {subtitle && <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 12 }}>{subtitle}</p>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {badge && <span className="status-pill dark">{badge}</span>}
          <span style={{ color: 'var(--muted)', fontWeight: 800 }}>{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && <div style={{ padding: 18 }}>{children}</div>}
    </div>
  );
}

function Barra({ valor, maximo, tone = 'ok' }) {
  const largura = maximo > 0 ? Math.min((valor / maximo) * 100, 100) : 0;
  const cor = tone === 'warn' ? '#D85A30' : tone === 'info' ? '#185FA5' : '#1D9E75';

  return (
    <div style={{ width: 120, maxWidth: '100%', height: 8, borderRadius: 999, background: '#ebe7df', overflow: 'hidden' }}>
      <div style={{ width: `${largura}%`, height: '100%', borderRadius: 999, background: cor }} />
    </div>
  );
}

function GraficoBarrasMensal({ titulo, linhas = [], campo, tipo = 'numero', cor = '#185FA5', style }) {
  const valores = (linhas || []).map((row) => Number(row[campo] || 0));
  const maximo = Math.max(...valores, 0);

  return (
    <div className="panel-card" style={{ alignContent: 'start', ...style }}>
      <div className="panel-title">{titulo}</div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'end', minHeight: 210, overflowX: 'auto', padding: '12px 2px 4px' }}>
        {!linhas.length && <p>Sem dados para exibir.</p>}
        {linhas.map((row) => {
          const valor = Number(row[campo] || 0);
          const altura = maximo > 0 ? Math.max((valor / maximo) * 150, 4) : 0;
          return (
            <div key={`${row.id || row.competencia}-${campo}`} style={{ minWidth: 86, display: 'grid', gridTemplateRows: '44px 160px 22px', gap: 6, alignItems: 'end', justifyItems: 'center', fontSize: 12 }}>
              <span style={{ textAlign: 'center', fontWeight: 700, alignSelf: 'end' }}>
                {tipo === 'moeda' ? fmt(valor) : tipo === 'pct' ? fmtPct(valor) : tipo === 'kg' ? `${fmtN(valor)} kg` : fmtN(valor)}
              </span>
              <div style={{ width: 34, height: 150, borderRadius: 8, background: '#e8edf5', display: 'flex', alignItems: 'end', overflow: 'hidden' }}>
                <div title={`${row.competencia}: ${valor}`} style={{ width: '100%', height: `${altura}px`, borderRadius: 8, background: cor }} />
              </div>
              <strong>{row.competencia}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RankingTabela({ titulo, linhas, tipo = 'valor', maxLinhas = 10, filtroTipo, filtroAtivo, onToggleFiltro }) {
  const ordenadas = [...(linhas || [])].sort((a, b) => b.valorCte - a.valorCte).slice(0, maxLinhas);
  const maximo = ordenadas[0]?.valorCte || 1;
  const clicavel = Boolean(filtroTipo && onToggleFiltro);

  if (!ordenadas.length) {
    return (
      <div className="panel-card">
        <div className="panel-title">{titulo}</div>
        <p>Sem dados para exibir com os filtros atuais.</p>
      </div>
    );
  }

  return (
    <div className="panel-card" style={{ alignContent: 'start' }}>
      <div className="panel-title">{titulo}</div>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>Item</th>
              <th>CT-es</th>
              <th>Valor CT-e</th>
              <th>% Frete</th>
              <th>Volume</th>
            </tr>
          </thead>
          <tbody>
            {ordenadas.map((item) => (
              <tr
                key={item.key}
                onClick={clicavel ? () => onToggleFiltro(filtroTipo, item.filtroValor ?? item.key) : undefined}
                title={clicavel ? `Clique para filtrar por ${item.label || item.key}` : undefined}
                style={clicavel ? {
                  cursor: 'pointer',
                  background: filtroAtivo === (item.filtroValor ?? item.key) ? '#eff6ff' : undefined,
                  boxShadow: filtroAtivo === (item.filtroValor ?? item.key) ? 'inset 3px 0 0 #185FA5' : undefined,
                } : undefined}
              >
                <td><strong>{item.label || item.key}</strong></td>
                <td>{fmtN(item.ctes)}</td>
                <td>{fmt(item.valorCte)}</td>
                <td>{item.valorNf > 0 ? fmtPct(item.percentualFrete) : '-'}</td>
                <td><Barra valor={tipo === 'ctes' ? item.ctes : item.valorCte} maximo={tipo === 'ctes' ? ordenadas[0]?.ctes || 1 : maximo} tone="info" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PainelGestaoTransportador({ analise, filtros, interactiveFilters, onToggleFiltro }) {
  const [modoRota, setModoRota] = useState('valor');

  const topRotas = useMemo(() => {
    const rotas = [...(analise?.rotas || [])];
    const chave = modoRota === 'ctes' ? 'ctes' : modoRota === 'percentual' ? 'percentualFrete' : 'valorCte';
    return rotas.sort((a, b) => Number(b[chave] || 0) - Number(a[chave] || 0)).slice(0, 20);
  }, [analise, modoRota]);

  const maxValor = topRotas[0]?.valorCte || 1;
  const maxCtes = topRotas[0]?.ctes || 1;

  if (!analise) return null;

  return (
    <ExpandCard
      title="Painel de gestão do transportador"
      subtitle="Dossiê do filtro aplicado: volumetria, concentração, rotas, regiões e oportunidades para negociação."
      badge={`${fmtN(analise.totalCtes)} CT-es analisados`}
      defaultOpen={false}
    >
      <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 14 }}>
        <SummaryCard title="Cargas/dia" value={fmtN(analise.cargasDia)} subtitle="média no período" />
        <SummaryCard title="Volumes/dia" value={fmtN(analise.volumesDia)} subtitle={`${fmtN(analise.totalVolumes)} volumes`} />
        <SummaryCard title="Faturamento médio/mês" value={fmt(analise.faturamentoMedioMes)} subtitle="valor CT-e" />
        <SummaryCard title="Peso médio/CT-e" value={`${fmtN(analise.pesoMedio)} kg`} subtitle={`${fmtN(analise.totalPeso)} kg total`} />
        <SummaryCard title="Frete sobre NF" value={fmtPct(analise.percentualFrete)} subtitle={`${fmt(analise.totalNf)} em NF`} />
        <SummaryCard title="Ticket médio CT-e" value={fmt(analise.ticketMedio)} subtitle="valor médio por carga" />
      </div>

      <div className="feature-grid import-grid" style={{ marginBottom: 14 }}>
        <RankingTabela titulo="Transportadoras no filtro" linhas={analise.transportadoras} filtroTipo="transportadora" filtroAtivo={interactiveFilters.transportadora} onToggleFiltro={onToggleFiltro} />
        <RankingTabela titulo="Regiões de destino" linhas={analise.regioesDestino} filtroTipo="regiaoDestino" filtroAtivo={interactiveFilters.regiaoDestino} onToggleFiltro={onToggleFiltro} />
      </div>

      <div className="feature-grid import-grid" style={{ marginBottom: 14 }}>
        <RankingTabela titulo="Origens mais relevantes" linhas={analise.origens} filtroTipo="origem" filtroAtivo={interactiveFilters.origem} onToggleFiltro={onToggleFiltro} />
        <RankingTabela titulo="Destinos mais relevantes" linhas={analise.destinos} filtroTipo="destino" filtroAtivo={interactiveFilters.destino} onToggleFiltro={onToggleFiltro} />
      </div>

      <div className="feature-grid import-grid" style={{ marginBottom: 14 }}>
        <RankingTabela titulo="UFs destino" linhas={analise.ufsDestino} tipo="ctes" filtroTipo="ufDestino" filtroAtivo={interactiveFilters.ufDestino} onToggleFiltro={onToggleFiltro} />
        <RankingTabela titulo="Canais" linhas={analise.canais} tipo="ctes" filtroTipo="canal" filtroAtivo={interactiveFilters.canal} onToggleFiltro={onToggleFiltro} />
      </div>

      <div className="feature-grid import-grid" style={{ marginBottom: 14 }}>
        <RankingTabela titulo="UFs origem" linhas={analise.ufsOrigem} tipo="ctes" filtroTipo="ufOrigem" filtroAtivo={interactiveFilters.ufOrigem} onToggleFiltro={onToggleFiltro} />
        <RankingTabela titulo="Tipos de operação" linhas={analise.tiposOperacao} tipo="ctes" filtroTipo="tipoOperacao" filtroAtivo={interactiveFilters.tipoOperacao} onToggleFiltro={onToggleFiltro} />
      </div>

      <div className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Rotas prioritárias para negociação</div>
            <p className="compact">
              Use esta lista para direcionar ajuste de tabela. A prioridade combina volume, valor de frete e percentual de frete sobre NF.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className={modoRota === 'valor' ? 'btn-primary' : 'btn-secondary'} onClick={() => setModoRota('valor')}>Valor</button>
            <button type="button" className={modoRota === 'ctes' ? 'btn-primary' : 'btn-secondary'} onClick={() => setModoRota('ctes')}>Volume</button>
            <button type="button" className={modoRota === 'percentual' ? 'btn-primary' : 'btn-secondary'} onClick={() => setModoRota('percentual')}>% frete</button>
          </div>
        </div>

        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead>
              <tr>
                <th>Rota</th>
                <th>Tipo</th>
                <th>CT-es</th>
                <th>Valor CT-e</th>
                <th>Valor NF</th>
                <th>% Frete</th>
                <th>Ticket médio</th>
                <th>Prioridade</th>
                <th>Volume</th>
              </tr>
            </thead>
            <tbody>
              {topRotas.map((rota) => {
                const prioridade = rota.ctes >= 50 || rota.valorCte >= analise.totalCte * 0.08 ? 'Alta' : rota.ctes >= 15 ? 'Média' : 'Baixa';
                return (
                  <tr
                    key={rota.key}
                    onClick={() => onToggleFiltro('rota', rota.key)}
                    title="Clique para filtrar por esta rota"
                    style={{
                      cursor: 'pointer',
                      background: interactiveFilters.rota === rota.key ? '#eff6ff' : undefined,
                      boxShadow: interactiveFilters.rota === rota.key ? 'inset 3px 0 0 #185FA5' : undefined,
                    }}
                  >
                    <td><strong>{rota.label}</strong></td>
                    <td>{rota.tipo || '-'}</td>
                    <td>{fmtN(rota.ctes)}</td>
                    <td>{fmt(rota.valorCte)}</td>
                    <td>{fmt(rota.valorNf)}</td>
                    <td>{rota.valorNf > 0 ? fmtPct(rota.percentualFrete) : '-'}</td>
                    <td>{fmt(rota.ticketMedio)}</td>
                    <td>
                      <span className={`coverage-badge ${prioridade === 'Alta' ? 'warn' : prioridade === 'Média' ? '' : 'ok'}`}>
                        {prioridade}
                      </span>
                    </td>
                    <td>
                      <Barra valor={modoRota === 'ctes' ? rota.ctes : rota.valorCte} maximo={modoRota === 'ctes' ? maxCtes : maxValor} tone={prioridade === 'Alta' ? 'warn' : 'info'} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="hint-box" style={{ marginTop: 14 }}>
        Filtros considerados no dossiê: transportadora <strong>{filtros.transportadoraRealizada || 'todas'}</strong>, origem <strong>{filtros.origem || 'todas'}</strong>, destino <strong>{filtros.destino || 'todos'}</strong>, canal <strong>{filtros.canal || 'todos'}</strong>, período <strong>{filtros.inicio || 'início da base'} até {filtros.fim || 'fim da base'}</strong>.
      </div>
    </ExpandCard>
  );
}

function montarAnalise(rows = [], filtros = {}) {
  const totalCte = rows.reduce((a, r) => a + getValorCte(r), 0);
  const totalCalculado = rows.reduce((a, r) => a + getValorCalculado(r), 0);
  const totalDiferenca = rows.reduce((a, r) => a + getDiferenca(r), 0);
  const totalNf = rows.reduce((a, r) => a + getValorNf(r), 0);
  const totalPeso = rows.reduce((a, r) => a + getPeso(r), 0);
  const totalVolumes = rows.reduce((a, r) => a + getVolumes(r), 0);
  const totalCtes = rows.length;
  const comCalculo = rows.filter((r) => getValorCalculado(r) > 0).length;
  const dias = diasEntre(filtros.inicio, filtros.fim, rows);
  const meses = mesesEntre(filtros.inicio, filtros.fim, rows);

  const transportadoras = agrupar(rows, (row) => getTransportadora(row) || 'Não informado');
  const origens = agrupar(rows, (row) => {
    const origem = getOrigem(row) || 'Não informado';
    const uf = getUfOrigem(row);
    return uf ? `${origem}/${uf}` : origem;
  });
  const destinos = agrupar(rows, (row) => {
    const destino = getDestino(row) || 'Não informado';
    const uf = getUfDestino(row);
    return uf ? `${destino}/${uf}` : destino;
  });
  const regioesDestino = agrupar(rows, (row) => getRegiaoPorUf(getUfDestino(row)));
  const canais = agrupar(rows, (row) => getCanal(row) || 'Não informado');
  const ufsDestino = agrupar(rows, (row) => getUfDestino(row) || 'Não informado');
  const ufsOrigem = agrupar(rows, (row) => getUfOrigem(row) || 'Não informado');
  const tiposOperacao = agrupar(rows, (row) => getTipoOperacao(row));
  const statusCalculo = agrupar(rows, (row) => labelStatusCalculo(getStatusCalculo(row)));

  const rotasMapa = new Map();
  rows.forEach((row) => {
    const key = getRotaKey(row);
    const atual = rotasMapa.get(key) || {
      key,
      label: getRotaLabel(row),
      tipo: getTipoVeiculo(row),
      origem: getOrigem(row),
      ufOrigem: getUfOrigem(row),
      destino: getDestino(row),
      ufDestino: getUfDestino(row),
      canal: getCanal(row) || 'NÃ£o informado',
      ctes: 0,
      valorCte: 0,
      valorCalculado: 0,
      diferenca: 0,
      valorNf: 0,
      peso: 0,
      volumes: 0,
      transportadoras: new Set(),
    };

    atual.ctes += 1;
    atual.valorCte += getValorCte(row);
    atual.valorCalculado += getValorCalculado(row);
    atual.diferenca += getDiferenca(row);
    atual.valorNf += getValorNf(row);
    atual.peso += getPeso(row);
    atual.volumes += getVolumes(row);
    atual.transportadoras.add(getTransportadora(row));
    rotasMapa.set(key, atual);
  });

  const rotas = [...rotasMapa.values()].map((rota) => ({
    ...rota,
    transportadoras: rota.transportadoras.size,
    percentualFrete: rota.valorNf > 0 ? (rota.valorCte / rota.valorNf) * 100 : 0,
    ticketMedio: rota.ctes > 0 ? rota.valorCte / rota.ctes : 0,
  }));

  return {
    totalCtes,
    comCalculo,
    totalCte,
    totalCalculado,
    totalDiferenca,
    totalNf,
    totalPeso,
    totalVolumes,
    dias,
    meses,
    cargasDia: rows.length / dias,
    volumesDia: totalVolumes / dias,
    faturamentoMedioMes: totalCte / meses,
    pesoMedio: rows.length > 0 ? totalPeso / rows.length : 0,
    ticketMedio: rows.length > 0 ? totalCte / rows.length : 0,
    percentualFrete: totalNf > 0 ? (totalCte / totalNf) * 100 : 0,
    transportadoras,
    origens,
    destinos,
    regioesDestino,
    canais,
    ufsDestino,
    ufsOrigem,
    tiposOperacao,
    statusCalculo,
    rotas,
    rotasUnicas: rotas.length,
  };
}

function competenciaDePeriodo(inicio, fim) {
  const base = String(inicio || fim || '').slice(0, 7);
  return /^\d{4}-\d{2}$/.test(base) ? base : monthNow();
}

function nomeCompetencia(competencia) {
  const [ano, mes] = String(competencia || '').split('-');
  if (!ano || !mes) return competencia || '';
  const data = new Date(Number(ano), Number(mes) - 1, 1);
  return data.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^\w/, (letra) => letra.toUpperCase());
}

function ordenarResumo(lista = []) {
  return [...lista].sort((a, b) => Number(b.valorCte || 0) - Number(a.valorCte || 0));
}

function hashFiltrosCte(filtros = {}) {
  const normalizados = Object.keys(filtros)
    .sort()
    .reduce((acc, key) => ({ ...acc, [key]: filtros[key] || '' }), {});
  return btoa(unescape(encodeURIComponent(JSON.stringify(normalizados)))).slice(0, 180);
}

function montarPayloadCompetenciaCte({ competencia, nome, inicio, fim, observacao, filtros, analise }) {
  return {
    competencia,
    nome_competencia: nome || nomeCompetencia(competencia),
    data_inicio: inicio || null,
    data_fim: fim || null,
    total_ctes: analise.totalCtes,
    valor_total_cte: analise.totalCte,
    valor_total_nf: analise.totalNf,
    percentual_frete_nf: analise.percentualFrete,
    peso_total: analise.totalPeso,
    peso_medio_cte: analise.pesoMedio,
    volumes_total: analise.totalVolumes,
    volumes_dia: analise.volumesDia,
    cargas_dia: analise.cargasDia,
    ticket_medio_cte: analise.ticketMedio,
    total_transportadoras: analise.transportadoras.length,
    total_rotas: analise.rotasUnicas,
    total_com_calculo: analise.comCalculo,
    total_sem_calculo: Math.max(analise.totalCtes - analise.comCalculo, 0),
    filtros_hash: hashFiltrosCte(filtros),
    filtros_json: filtros || {},
    resumo_transportadoras_json: ordenarResumo(analise.transportadoras),
    resumo_regioes_json: ordenarResumo(analise.regioesDestino),
    resumo_ufs_destino_json: ordenarResumo(analise.ufsDestino),
    resumo_ufs_origem_json: ordenarResumo(analise.ufsOrigem),
    resumo_origens_json: ordenarResumo(analise.origens),
    resumo_destinos_json: ordenarResumo(analise.destinos),
    resumo_rotas_json: ordenarResumo(analise.rotas),
    resumo_canais_json: ordenarResumo(analise.canais),
    observacao: observacao || '',
    usuario: '',
  };
}

function aplicarFiltrosComparativo(rows = [], filtros = {}) {
  return (rows || []).filter((row) => {
    if (filtros.inicio && row.competencia < filtros.inicio) return false;
    if (filtros.fim && row.competencia > filtros.fim) return false;
    if (filtros.transportadora && !(row.resumo_transportadoras_json || []).some((item) => item.key === filtros.transportadora)) return false;
    if (filtros.origem && !(row.resumo_origens_json || []).some((item) => item.key === filtros.origem)) return false;
    if (filtros.regiaoDestino && !(row.resumo_regioes_json || []).some((item) => item.key === filtros.regiaoDestino)) return false;
    if (filtros.ufDestino && !(row.resumo_ufs_destino_json || []).some((item) => item.key === filtros.ufDestino)) return false;
    if (filtros.canal && !(row.resumo_canais_json || []).some((item) => item.key === filtros.canal)) return false;
    return true;
  });
}

const TIPOS_ANALISE_VARIACAO = {
  transportadora: { label: 'Transportadora', campo: 'resumo_transportadoras_json' },
  rota: { label: 'Rota', campo: 'resumo_rotas_json' },
  origem: { label: 'Origem', campo: 'resumo_origens_json' },
  destino: { label: 'Destino', campo: 'resumo_destinos_json' },
  ufDestino: { label: 'UF destino', campo: 'resumo_ufs_destino_json' },
  ufOrigem: { label: 'UF origem', campo: 'resumo_ufs_origem_json' },
  regiaoDestino: { label: 'Região destino', campo: 'resumo_regioes_json' },
  canal: { label: 'Canal', campo: 'resumo_canais_json' },
};

function numeroResumo(item = {}, campo, fallback = 0) {
  const valor = Number(item[campo] ?? fallback);
  return Number.isFinite(valor) ? valor : 0;
}

function normalizarResumoComparativo(item = {}) {
  const ctes = numeroResumo(item, 'ctes');
  const valorCte = numeroResumo(item, 'valorCte');
  const valorNf = numeroResumo(item, 'valorNf');
  const peso = numeroResumo(item, 'peso');
  return {
    key: item.key || item.label || '',
    label: item.label || item.key || 'Não informado',
    ctes,
    valorCte,
    valorNf,
    percentualFrete: numeroResumo(item, 'percentualFrete', valorNf > 0 ? (valorCte / valorNf) * 100 : 0),
    ticketMedio: numeroResumo(item, 'ticketMedio', ctes > 0 ? valorCte / ctes : 0),
    peso,
    volumes: numeroResumo(item, 'volumes'),
    rotas: numeroResumo(item, 'rotas'),
    transportadoras: numeroResumo(item, 'transportadoras'),
    canais: numeroResumo(item, 'canais'),
    tipo: item.tipo || '',
    origem: item.origem || '',
    ufOrigem: item.ufOrigem || '',
    destino: item.destino || '',
    ufDestino: item.ufDestino || '',
    canal: item.canal || '',
  };
}

function mapaResumo(lista = []) {
  return new Map((lista || []).map((item) => {
    const normalizado = normalizarResumoComparativo(item);
    return [normalizado.key, normalizado];
  }).filter(([key]) => key));
}

function causaVariacao(atual = {}, anterior = {}) {
  const deltaCtes = atual.ctes - anterior.ctes;
  const deltaValor = atual.valorCte - anterior.valorCte;
  const deltaNf = atual.valorNf - anterior.valorNf;
  const deltaTicket = atual.ticketMedio - anterior.ticketMedio;
  const pesoMedioAtual = atual.ctes > 0 ? atual.peso / atual.ctes : 0;
  const pesoMedioAnterior = anterior.ctes > 0 ? anterior.peso / anterior.ctes : 0;
  const deltaPesoMedio = pesoMedioAtual - pesoMedioAnterior;
  const deltaPp = atual.percentualFrete - anterior.percentualFrete;

  if (deltaCtes < 0 && deltaTicket > 0) return 'Ticket subiu com volume menor';
  if (deltaCtes > 0 && deltaValor > 0 && Math.abs(deltaPp) < 1) return 'Aumento de volume';
  if (deltaPp >= 2 && Math.abs(deltaCtes) <= Math.max(5, anterior.ctes * 0.08)) return 'Possível aumento de custo';
  if (deltaNf < 0 && deltaPp > 0) return 'Mix da carteira';
  if (deltaPesoMedio > 10) return 'Perfil de carga mais pesada';
  if (deltaValor > deltaNf && deltaPp > 0) return 'Valor CT-e subiu mais que NF';
  return 'Analisar composição';
}

function criticidadeVariacao(item = {}) {
  const impactoAbs = Math.abs(Number(item.deltaValorCte || 0));
  const volume = Math.max(Number(item.ctesDepois || 0), Number(item.ctesAntes || 0));
  if (item.deltaPp >= 3 || impactoAbs >= 250000 || (volume >= 1000 && item.deltaPp >= 1.5)) return 'Crítico';
  if (item.deltaPp >= 1 || impactoAbs >= 75000) return 'Atenção';
  return 'Normal';
}

function temVolumeComparavel(anterior = {}, atual = {}) {
  return Number(anterior.ctes || 0) > 0 && Number(atual.ctes || 0) > 0;
}

function montarVariacoesDimensao(rows = [], tipo = 'transportadora') {
  const config = TIPOS_ANALISE_VARIACAO[tipo] || TIPOS_ANALISE_VARIACAO.transportadora;
  const ordenadas = [...(rows || [])].sort((a, b) => String(a.competencia || '').localeCompare(String(b.competencia || '')));
  const variacoes = [];

  for (let i = 1; i < ordenadas.length; i += 1) {
    const anteriorRow = ordenadas[i - 1];
    const atualRow = ordenadas[i];
    const anteriorMapa = mapaResumo(anteriorRow[config.campo] || []);
    const atualMapa = mapaResumo(atualRow[config.campo] || []);
    const keys = new Set([...anteriorMapa.keys(), ...atualMapa.keys()]);

    keys.forEach((key) => {
      const anterior = anteriorMapa.get(key) || normalizarResumoComparativo({ key, label: key });
      const atual = atualMapa.get(key) || normalizarResumoComparativo({ key, label: key });
      if (!temVolumeComparavel(anterior, atual)) return;
      const deltaPp = atual.percentualFrete - anterior.percentualFrete;
      const deltaValorCte = atual.valorCte - anterior.valorCte;
      const deltaCtes = atual.ctes - anterior.ctes;
      const aumentoRelativoPct = anterior.percentualFrete ? (deltaPp / anterior.percentualFrete) * 100 : (atual.percentualFrete > 0 ? 100 : 0);
      const variacao = {
        key: `${tipo}-${key}-${anteriorRow.competencia}-${atualRow.competencia}`,
        itemKey: key,
        item: atual.label || anterior.label || key,
        tipo: config.label,
        competenciaAnterior: anteriorRow.competencia,
        competenciaAtual: atualRow.competencia,
        ctesAntes: anterior.ctes,
        ctesDepois: atual.ctes,
        deltaCtes,
        valorCteAntes: anterior.valorCte,
        valorCteDepois: atual.valorCte,
        deltaValorCte,
        valorNfAntes: anterior.valorNf,
        valorNfDepois: atual.valorNf,
        percentualAntes: anterior.percentualFrete,
        percentualDepois: atual.percentualFrete,
        deltaPp,
        aumentoRelativoPct,
        ticketAntes: anterior.ticketMedio,
        ticketDepois: atual.ticketMedio,
        pesoAntes: anterior.peso,
        pesoDepois: atual.peso,
        impactoFinanceiro: deltaValorCte,
        causa: causaVariacao(atual, anterior),
        origem: atual.origem || anterior.origem,
        ufOrigem: atual.ufOrigem || anterior.ufOrigem,
        destino: atual.destino || anterior.destino,
        ufDestino: atual.ufDestino || anterior.ufDestino,
        tipoOperacao: atual.tipo || anterior.tipo,
      };
      variacao.criticidade = criticidadeVariacao(variacao);
      variacoes.push(variacao);
    });
  }

  return variacoes;
}

function filtrarOrdenarVariacoes(variacoes = [], { mostrar = 'todos', ordenar = 'maior_aumento', busca = '' } = {}) {
  const termo = normalizarTexto(busca);
  let lista = (variacoes || []).filter((item) => {
    if (termo && !normalizarTexto(`${item.item} ${item.tipo} ${item.origem} ${item.destino} ${item.ufOrigem} ${item.ufDestino}`).includes(termo)) return false;
    if (mostrar === 'aumentos') return item.deltaPp > 0;
    if (mostrar === 'reducoes') return item.deltaPp < 0;
    if (mostrar === 'criticos') return item.criticidade === 'Crítico';
    return true;
  });

  const ordenadores = {
    maior_aumento: (a, b) => b.deltaPp - a.deltaPp,
    maior_reducao: (a, b) => a.deltaPp - b.deltaPp,
    impacto: (a, b) => Math.abs(b.impactoFinanceiro) - Math.abs(a.impactoFinanceiro),
    variacao_ctes: (a, b) => Math.abs(b.deltaCtes) - Math.abs(a.deltaCtes),
    variacao_valor: (a, b) => Math.abs(b.deltaValorCte) - Math.abs(a.deltaValorCte),
    percentual: (a, b) => b.percentualDepois - a.percentualDepois,
    ticket: (a, b) => b.ticketDepois - a.ticketDepois,
    volume: (a, b) => b.ctesDepois - a.ctesDepois,
  };
  return lista.sort(ordenadores[ordenar] || ordenadores.maior_aumento);
}

function resumoComparativoSelecionado(row = {}, filtros = {}) {
  const dimensoes = [
    ['transportadora', 'resumo_transportadoras_json'],
    ['origem', 'resumo_origens_json'],
    ['canal', 'resumo_canais_json'],
    ['ufDestino', 'resumo_ufs_destino_json'],
    ['regiaoDestino', 'resumo_regioes_json'],
  ];

  for (const [tipo, campo] of dimensoes) {
    if (!filtros[tipo]) continue;
    const item = (row[campo] || []).find((resumo) => resumo.key === filtros[tipo]);
    if (item) return { tipo, item };
  }

  return null;
}

function linhaComparativoComFiltros(row = {}, filtros = {}) {
  const selecionado = resumoComparativoSelecionado(row, filtros);
  if (!selecionado) return row;

  const item = selecionado.item || {};
  const totalCtes = Number(item.ctes || 0);
  const totalOriginal = Number(row.total_ctes || 0);
  const proporcao = totalOriginal > 0 ? totalCtes / totalOriginal : 0;
  const comCalculo = Math.round(Number(row.total_com_calculo || 0) * proporcao);
  const semCalculo = Math.max(totalCtes - comCalculo, 0);

  return {
    ...row,
    nome_competencia: `${row.nome_competencia || row.competencia} · ${item.label || item.key}`,
    total_ctes: totalCtes,
    valor_total_cte: Number(item.valorCte || 0),
    valor_total_nf: Number(item.valorNf || 0),
    percentual_frete_nf: Number(item.percentualFrete || 0),
    peso_total: Number(item.peso || 0),
    ticket_medio_cte: Number(item.ticketMedio || 0),
    total_transportadoras: Number(item.transportadoras || (selecionado.tipo === 'transportadora' ? 1 : 0)),
    total_rotas: Number(item.rotas || 0),
    total_com_calculo: comCalculo,
    total_sem_calculo: semCalculo,
  };
}

function diagnosticarCausaAumento(atual = {}, anterior = {}) {
  const deltaTicket = Number(atual.ticketMedio || 0) - Number(anterior.ticketMedio || 0);
  const deltaValor = Number(atual.valorCte || 0) - Number(anterior.valorCte || 0);
  const deltaNf = Number(atual.valorNf || 0) - Number(anterior.valorNf || 0);
  const deltaCtes = Number(atual.ctes || 0) - Number(anterior.ctes || 0);

  if (deltaTicket > 0 && deltaCtes <= 0) return 'Ticket subiu com volume menor';
  if (deltaValor > 0 && deltaNf <= 0) return 'Frete subiu com NF menor/estável';
  if (deltaTicket > 0) return 'Ticket médio subiu';
  if (deltaCtes > 0) return 'Mix/volume maior';
  return 'Mix da carteira';
}

function temFiltroTransversalComparativo(filtros = {}) {
  return Boolean(filtros.origem || filtros.regiaoDestino || filtros.ufDestino || filtros.canal);
}

function labelRecorteComparativo(filtros = {}) {
  const partes = [];
  if (filtros.transportadora) partes.push(`Transportadora: ${filtros.transportadora}`);
  if (filtros.origem) partes.push(`Origem: ${filtros.origem}`);
  if (filtros.regiaoDestino) partes.push(`Região: ${filtros.regiaoDestino}`);
  if (filtros.ufDestino) partes.push(`UF destino: ${filtros.ufDestino}`);
  if (filtros.canal) partes.push(`Canal: ${filtros.canal}`);
  return partes.length ? partes.join(' · ') : 'Recorte filtrado';
}

function montarPainelRecorteComparativo(rows = [], filtros = {}) {
  const label = labelRecorteComparativo(filtros);
  const meses = [...(rows || [])]
    .sort((a, b) => String(a.competencia || '').localeCompare(String(b.competencia || '')))
    .map((row) => {
      const ctes = Number(row.total_ctes || 0);
      const valorCte = Number(row.valor_total_cte || 0);
      const valorNf = Number(row.valor_total_nf || 0);
      return {
        competencia: row.competencia,
        ctes,
        valorCte,
        valorNf,
        peso: Number(row.peso_total || 0),
        percentualFrete: Number(row.percentual_frete_nf || (valorNf > 0 ? (valorCte / valorNf) * 100 : 0)),
        ticketMedio: Number(row.ticket_medio_cte || (ctes > 0 ? valorCte / ctes : 0)),
      };
    });

  const consolidado = meses.reduce((acc, mes) => {
    acc.ctes += mes.ctes;
    acc.valorCte += mes.valorCte;
    acc.valorNf += mes.valorNf;
    acc.peso += mes.peso;
    return acc;
  }, { key: 'recorte-filtrado', label, ctes: 0, valorCte: 0, valorNf: 0, peso: 0 });

  const variacoes = [];
  for (let i = 1; i < meses.length; i += 1) {
    const anterior = meses[i - 1];
    const atual = meses[i];
    if (!temVolumeComparavel(anterior, atual)) continue;
    const deltaPct = Number(atual.percentualFrete || 0) - Number(anterior.percentualFrete || 0);
    if (deltaPct > 0) {
      variacoes.push({
        transportadora: label,
        de: anterior.competencia,
        para: atual.competencia,
        anterior: anterior.percentualFrete,
        atual: atual.percentualFrete,
        deltaPct,
        deltaValor: atual.valorCte - anterior.valorCte,
        deltaTicket: atual.ticketMedio - anterior.ticketMedio,
        ctesAtual: atual.ctes,
        causa: diagnosticarCausaAumento(atual, anterior),
      });
    }
  }

  const item = {
    ...consolidado,
    meses,
    percentualFrete: consolidado.valorNf > 0 ? (consolidado.valorCte / consolidado.valorNf) * 100 : 0,
    ticketMedio: consolidado.ctes > 0 ? consolidado.valorCte / consolidado.ctes : 0,
  };

  return {
    recorteConsolidado: true,
    maisCaras: consolidado.ctes ? [item] : [],
    maioresAumentos: variacoes.sort((a, b) => b.deltaPct - a.deltaPct).slice(0, 12),
  };
}

function montarPainelTransportadorasComparativo(rows = [], filtros = {}, linhasFiltradas = []) {
  if (temFiltroTransversalComparativo(filtros)) {
    return montarPainelRecorteComparativo(linhasFiltradas, filtros);
  }

  const porTransportadora = new Map();

  (rows || []).forEach((row) => {
    const competencia = row.competencia;
    const lista = row.resumo_transportadoras_json || [];
    lista.forEach((item) => {
      if (filtros.transportadora && item.key !== filtros.transportadora) return;
      const atual = porTransportadora.get(item.key) || {
        key: item.key,
        label: item.label || item.key,
        ctes: 0,
        valorCte: 0,
        valorNf: 0,
        peso: 0,
        meses: [],
      };

      const mes = {
        competencia,
        ctes: Number(item.ctes || 0),
        valorCte: Number(item.valorCte || 0),
        valorNf: Number(item.valorNf || 0),
        peso: Number(item.peso || 0),
        percentualFrete: Number(item.percentualFrete || 0),
        ticketMedio: Number(item.ticketMedio || 0),
      };

      atual.ctes += mes.ctes;
      atual.valorCte += mes.valorCte;
      atual.valorNf += mes.valorNf;
      atual.peso += mes.peso;
      atual.meses.push(mes);
      porTransportadora.set(item.key, atual);
    });
  });

  const transportadoras = [...porTransportadora.values()].map((item) => {
    const meses = item.meses.sort((a, b) => a.competencia.localeCompare(b.competencia));
    const variacoes = [];

    for (let i = 1; i < meses.length; i += 1) {
      const anterior = meses[i - 1];
      const atual = meses[i];
      if (!temVolumeComparavel(anterior, atual)) continue;
      const deltaPct = Number(atual.percentualFrete || 0) - Number(anterior.percentualFrete || 0);
      variacoes.push({
        transportadora: item.label,
        de: anterior.competencia,
        para: atual.competencia,
        anterior: anterior.percentualFrete,
        atual: atual.percentualFrete,
        deltaPct,
        deltaValor: atual.valorCte - anterior.valorCte,
        deltaTicket: atual.ticketMedio - anterior.ticketMedio,
        ctesAtual: atual.ctes,
        causa: diagnosticarCausaAumento(atual, anterior),
      });
    }

    return {
      ...item,
      meses,
      variacoes,
      percentualFrete: item.valorNf > 0 ? (item.valorCte / item.valorNf) * 100 : 0,
      ticketMedio: item.ctes > 0 ? item.valorCte / item.ctes : 0,
    };
  });

  return {
    recorteConsolidado: false,
    maisCaras: [...transportadoras].sort((a, b) => b.percentualFrete - a.percentualFrete).slice(0, 12),
    maioresAumentos: transportadoras
      .flatMap((item) => item.variacoes)
      .filter((item) => item.deltaPct > 0)
      .sort((a, b) => b.deltaPct - a.deltaPct)
      .slice(0, 12),
  };
}

function montarParticipacaoTransportadoras(rows = []) {
  const ordenadas = [...(rows || [])].sort((a, b) => String(a.competencia || '').localeCompare(String(b.competencia || '')));
  const variacoes = [];

  for (let i = 1; i < ordenadas.length; i += 1) {
    const anteriorRow = ordenadas[i - 1];
    const atualRow = ordenadas[i];
    const totalCtesAnterior = Number(anteriorRow.total_ctes || 0);
    const totalCtesAtual = Number(atualRow.total_ctes || 0);
    const totalValorAnterior = Number(anteriorRow.valor_total_cte || 0);
    const totalValorAtual = Number(atualRow.valor_total_cte || 0);
    const anteriorMapa = mapaResumo(anteriorRow.resumo_transportadoras_json || []);
    const atualMapa = mapaResumo(atualRow.resumo_transportadoras_json || []);
    const keys = new Set([...anteriorMapa.keys(), ...atualMapa.keys()]);

    keys.forEach((key) => {
      const anterior = anteriorMapa.get(key) || normalizarResumoComparativo({ key, label: key });
      const atual = atualMapa.get(key) || normalizarResumoComparativo({ key, label: key });
      const partCtesAntes = totalCtesAnterior > 0 ? (anterior.ctes / totalCtesAnterior) * 100 : 0;
      const partCtesDepois = totalCtesAtual > 0 ? (atual.ctes / totalCtesAtual) * 100 : 0;
      const partCustoAntes = totalValorAnterior > 0 ? (anterior.valorCte / totalValorAnterior) * 100 : 0;
      const partCustoDepois = totalValorAtual > 0 ? (atual.valorCte / totalValorAtual) * 100 : 0;
      variacoes.push({
        key: `${key}-${anteriorRow.competencia}-${atualRow.competencia}`,
        transportadora: atual.label || anterior.label || key,
        partCtesAntes,
        partCtesDepois,
        deltaPartCtes: partCtesDepois - partCtesAntes,
        partCustoAntes,
        partCustoDepois,
        deltaPartCusto: partCustoDepois - partCustoAntes,
        ctesAntes: anterior.ctes,
        ctesDepois: atual.ctes,
        valorAntes: anterior.valorCte,
        valorDepois: atual.valorCte,
      });
    });
  }

  return variacoes;
}

function fluxoUfFromRota(item = {}) {
  const rota = normalizarResumoComparativo(item);
  const ufOrigem = String(rota.ufOrigem || '').trim().toUpperCase() || 'NI';
  const ufDestino = String(rota.ufDestino || '').trim().toUpperCase() || 'NI';
  const origem = rota.origem || ufOrigem || 'Nao informado';
  const destino = rota.destino || ufDestino || 'Nao informado';
  return {
    ...rota,
    fluxoKey: `${ufOrigem}->${ufDestino}`,
    fluxoLabel: `${ufOrigem} -> ${ufDestino}`,
    ufOrigem,
    ufDestino,
    origem,
    destino,
    canal: rota.canal || '',
  };
}

function filtroRotaComparativo(rota = {}, filtros = {}) {
  if (filtros.origem && rota.origem && `${rota.origem}/${rota.ufOrigem}` !== filtros.origem && rota.origem !== filtros.origem) return false;
  if (filtros.ufDestino && rota.ufDestino !== filtros.ufDestino) return false;
  if (filtros.regiaoDestino && getRegiaoPorUf(rota.ufDestino) !== filtros.regiaoDestino) return false;
  if (filtros.canal && rota.canal !== filtros.canal) return false;
  return true;
}

function variacaoPct(depois = 0, antes = 0) {
  if (!antes) return depois > 0 ? 100 : 0;
  return ((depois - antes) / antes) * 100;
}

function valorFiltroOriginalCompetencia(row = {}, campo = '') {
  const filtros = row.filtros_json || row.filtros || {};
  return filtros?.[campo] || '';
}

function canalUnicoResumoCompetencia(row = {}) {
  const canais = (row.resumo_canais_json || []).filter((item) => Number(item.ctes || 0) > 0);
  if (canais.length !== 1) return '';
  return canais[0].key || canais[0].label || '';
}

function canalDaRotaComparativo(item = {}, row = {}) {
  if (item.canal) return item.canal;
  const canalOriginal = valorFiltroOriginalCompetencia(row, 'canal');
  if (canalOriginal) return canalOriginal;
  return canalUnicoResumoCompetencia(row);
}

function filtroSemDetalheRotaOrigemDestino(rows = [], filtros = {}) {
  const exigeTransportadora = Boolean(filtros.transportadora);
  if (!exigeTransportadora) return null;

  const linhasComRotas = (rows || []).filter((row) => (row.resumo_rotas_json || []).length);
  const transportadoraJaFechadaNaCompetencia = !exigeTransportadora || linhasComRotas.every((row) => valorFiltroOriginalCompetencia(row, 'transportadoraRealizada') === filtros.transportadora);

  if (transportadoraJaFechadaNaCompetencia) return null;

  return 'transportadora';
}

function montarAnaliseEstrategicaOrigemDestino(rows = [], filtros = {}) {
  const filtroBloqueado = filtroSemDetalheRotaOrigemDestino(rows, filtros);
  if (filtroBloqueado) {
    return {
      bloqueado: true,
      aviso: `A analise Origem x Destino usa o resumo salvo de rotas. Esse resumo nao guarda ${filtroBloqueado} em cada rota; por isso o painel fica bloqueado para nao exibir indicador misturado. Para esse recorte aparecer, salve a competencia ja processada com esse filtro.`,
      fluxos: [],
      piores: [],
      oportunidades: [],
      comparativoFluxos: [],
      aumentos: [],
      reducoes: [],
      heatmap: new Map(),
      heatmapOrigens: [],
      heatmapDestinos: [],
    };
  }

  const ordenadas = [...(rows || [])].sort((a, b) => String(a.competencia || '').localeCompare(String(b.competencia || '')));
  const fluxosMapa = new Map();
  const heatmap = new Map();
  const competenciasIgnoradasCanal = new Set();

  ordenadas.forEach((row) => {
    (row.resumo_rotas_json || []).forEach((item) => {
      const canalRota = canalDaRotaComparativo(item, row);
      if (filtros.canal && canalRota !== filtros.canal) {
        if (!canalRota) competenciasIgnoradasCanal.add(row.competencia || row.nome_competencia || 'sem competencia');
        return;
      }
      const rota = fluxoUfFromRota({ ...item, canal: canalRota });
      if (!filtroRotaComparativo(rota, filtros)) return;

      const atual = fluxosMapa.get(rota.fluxoKey) || {
        key: rota.fluxoKey,
        label: rota.fluxoLabel,
        origem: rota.ufOrigem,
        destino: rota.ufDestino,
        ctes: 0,
        valorNf: 0,
        valorCte: 0,
        peso: 0,
        cidadesOrigem: new Set(),
        cidadesDestino: new Set(),
        meses: new Map(),
      };

      const ctes = Number(rota.ctes || 0);
      const valorNf = Number(rota.valorNf || 0);
      const valorCte = Number(rota.valorCte || 0);
      const peso = Number(rota.peso || 0);

      atual.ctes += ctes;
      atual.valorNf += valorNf;
      atual.valorCte += valorCte;
      atual.peso += peso;
      if (rota.origem) atual.cidadesOrigem.add(rota.origem);
      if (rota.destino) atual.cidadesDestino.add(rota.destino);

      const mes = atual.meses.get(row.competencia) || { competencia: row.competencia, ctes: 0, valorNf: 0, valorCte: 0, peso: 0 };
      mes.ctes += ctes;
      mes.valorNf += valorNf;
      mes.valorCte += valorCte;
      mes.peso += peso;
      atual.meses.set(row.competencia, mes);
      fluxosMapa.set(rota.fluxoKey, atual);
    });
  });

  const fluxos = [...fluxosMapa.values()].map((item) => {
    const meses = [...item.meses.values()]
      .sort((a, b) => String(a.competencia || '').localeCompare(String(b.competencia || '')))
      .map((mes) => ({
        ...mes,
        percentualFrete: mes.valorNf > 0 ? (mes.valorCte / mes.valorNf) * 100 : 0,
      }));

    const fluxo = {
      ...item,
      cidadesOrigem: [...item.cidadesOrigem].slice(0, 4),
      cidadesDestino: [...item.cidadesDestino].slice(0, 4),
      meses,
      percentualFrete: item.valorNf > 0 ? (item.valorCte / item.valorNf) * 100 : 0,
    };

    const heat = heatmap.get(fluxo.origem) || new Map();
    const celula = heat.get(fluxo.destino) || { valorCte: 0, valorNf: 0, ctes: 0 };
    celula.valorCte += fluxo.valorCte;
    celula.valorNf += fluxo.valorNf;
    celula.ctes += fluxo.ctes;
    heat.set(fluxo.destino, celula);
    heatmap.set(fluxo.origem, heat);

    return fluxo;
  });

  const piores = [...fluxos]
    .filter((item) => item.valorNf > 0 && item.ctes > 0)
    .sort((a, b) => b.percentualFrete - a.percentualFrete)
    .slice(0, 20);

  const oportunidades = [...fluxos]
    .filter((item) => item.origem !== item.destino && item.ctes >= 10)
    .map((item) => {
      const regiaoOrigem = getRegiaoPorUf(item.origem);
      const regiaoDestino = getRegiaoPorUf(item.destino);
      const longo = item.origem !== item.destino && regiaoOrigem !== regiaoDestino;
      return {
        ...item,
        score: (item.ctes || 0) * Math.max(item.percentualFrete || 0, 1),
        fluxoLongo: longo,
        operacaoLocal: item.origem === item.destino ? 'Sim' : 'Checar',
        cdProximo: longo ? 'Avaliar' : 'Possivel',
        abastecimentoAlternativo: item.percentualFrete >= 8 ? 'Priorizar' : 'Avaliar',
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  const variacoes = [];
  fluxos.forEach((fluxo) => {
    for (let i = 1; i < fluxo.meses.length; i += 1) {
      const anterior = fluxo.meses[i - 1];
      const atual = fluxo.meses[i];
      if (!temVolumeComparavel(anterior, atual)) continue;
      variacoes.push({
        key: `${fluxo.key}-${anterior.competencia}-${atual.competencia}`,
        fluxo: fluxo.label,
        competenciaAnterior: anterior.competencia,
        competenciaAtual: atual.competencia,
        ctesAntes: anterior.ctes,
        ctesDepois: atual.ctes,
        deltaCtes: atual.ctes - anterior.ctes,
        deltaCtesPct: variacaoPct(atual.ctes, anterior.ctes),
        pesoAntes: anterior.peso,
        pesoDepois: atual.peso,
        deltaPesoPct: variacaoPct(atual.peso, anterior.peso),
        valorNfAntes: anterior.valorNf,
        valorNfDepois: atual.valorNf,
        deltaNfPct: variacaoPct(atual.valorNf, anterior.valorNf),
        valorCteAntes: anterior.valorCte,
        valorCteDepois: atual.valorCte,
        deltaCtePct: variacaoPct(atual.valorCte, anterior.valorCte),
      });
    }
  });

  const heatmapOrigens = [...heatmap.keys()].sort((a, b) => {
    const soma = (uf) => [...(heatmap.get(uf)?.values() || [])].reduce((acc, item) => acc + Number(item.ctes || 0), 0);
    return soma(b) - soma(a);
  }).slice(0, 10);
  const heatmapDestinos = [...new Set([...heatmap.values()].flatMap((mapa) => [...mapa.keys()]))]
    .sort((a, b) => {
      const soma = (uf) => [...heatmap.values()].reduce((acc, mapa) => acc + Number(mapa.get(uf)?.ctes || 0), 0);
      return soma(b) - soma(a);
    })
    .slice(0, 10);

  return {
    bloqueado: false,
    aviso: competenciasIgnoradasCanal.size
      ? `Algumas competencias antigas sem canal no resumo de rotas foram ignoradas neste recorte: ${[...competenciasIgnoradasCanal].slice(0, 5).join(', ')}. Reprocesse/salve essas competencias para comparar por canal.`
      : '',
    fluxos,
    piores,
    oportunidades,
    comparativoFluxos: piores.slice(0, 6),
    aumentos: [...variacoes].filter((item) => item.deltaCtes > 0).sort((a, b) => b.deltaCtesPct - a.deltaCtesPct).slice(0, 20),
    reducoes: [...variacoes].filter((item) => item.deltaCtes < 0).sort((a, b) => a.deltaCtesPct - b.deltaCtesPct).slice(0, 20),
    heatmap,
    heatmapOrigens,
    heatmapDestinos,
  };
}

function montarAlertasComparativo({ variacoes = [], linhas = [], participacao = [] } = {}) {
  const alertas = [];
  variacoes.forEach((item) => {
    if (item.tipo === 'Transportadora' && item.deltaPp >= 2) alertas.push({ tipo: 'Transportadora', texto: `${item.item} subiu ${fmtPct(item.deltaPp)} em ${item.competenciaAtual}.`, criticidade: item.criticidade });
    if (item.tipo === 'Rota' && item.deltaPp >= 3) alertas.push({ tipo: 'Rota', texto: `${item.item} subiu ${fmtPct(item.deltaPp)} no % frete/NF.`, criticidade: item.criticidade });
    if (item.tipo === 'Origem' && item.deltaPp >= 2) alertas.push({ tipo: 'Origem', texto: `${item.item} teve aumento relevante de ${fmtPct(item.deltaPp)}.`, criticidade: item.criticidade });
    if (item.deltaPp > 0 && item.deltaCtes < 0 && item.ticketDepois > item.ticketAntes) alertas.push({ tipo: 'Mix', texto: `${item.item}: ticket médio subiu com volume menor.`, criticidade: item.criticidade });
    if (item.deltaValorCte > 0 && (item.valorNfDepois - item.valorNfAntes) <= 0) alertas.push({ tipo: 'Custo', texto: `${item.item}: valor CT-e subiu mais que valor NF.`, criticidade: item.criticidade });
  });

  participacao.forEach((item) => {
    if (item.deltaPartCtes > 2 && item.deltaPartCusto > item.deltaPartCtes) {
      alertas.push({ tipo: 'Participação', texto: `${item.transportadora} ganhou participação e aumentou participação de custo.`, criticidade: 'Atenção' });
    }
  });

  linhas.forEach((row) => {
    const semCalculo = Number(row.total_sem_calculo || 0);
    const total = Number(row.total_ctes || 0);
    const pct = total > 0 ? (semCalculo / total) * 100 : 0;
    if (pct >= 10) alertas.push({ tipo: 'Base sem cálculo', texto: `${row.competencia}: ${fmtPct(pct)} da base está sem cálculo.`, criticidade: pct >= 20 ? 'Crítico' : 'Atenção' });
  });

  return alertas.slice(0, 20);
}

function ValidacaoUpload({ validacao }) {
  if (!validacao) return null;

  const linhas = [
    ['Registros lidos', validacao.total],
    ['Com valor calculado', validacao.comValorCalculado],
    ['Sem valor calculado', validacao.semValorCalculado],
    ['Sem chave CT-e', validacao.semChave],
    ['Sem transportadora', validacao.semTransportadora],
    ['Sem origem', validacao.semOrigem],
    ['Sem destino', validacao.semDestino],
    ['Sem valor CT-e', validacao.semValorCte],
    ['Sem valor NF', validacao.semValorNf],
  ];

  return (
    <div className="sim-analise-tabela-wrap" style={{ marginTop: 12 }}>
      <table className="sim-analise-tabela">
        <thead>
          <tr>
            <th>Validação</th>
            <th>Qtd.</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map(([label, value]) => (
            <tr key={label}>
              <td>{label}</td>
              <td>{fmtN(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CtePage() {
  const [filtros, setFiltros] = useState({
    transportadoraRealizada: '',
    origem: '',
    destino: '',
    ufOrigem: '',
    ufDestino: '',
    inicio: '',
    fim: '',
    canal: '',
  });

  const [competenciaUpload, setCompetenciaUpload] = useState(monthNow());
  const [arquivoUpload, setArquivoUpload] = useState(null);
  const [statusCompetencia, setStatusCompetencia] = useState(null);
  const [validacaoUpload, setValidacaoUpload] = useState(null);
  const [metaUpload, setMetaUpload] = useState(null);
  const [progressoUpload, setProgressoUpload] = useState(null);
  const [resultadoUpload, setResultadoUpload] = useState(null);
  const [substituirCompetencia, setSubstituirCompetencia] = useState(false);
  const [importando, setImportando] = useState(false);
  const [pendencias, setPendencias] = useState([]);

  const [ocultarEbazar, setOcultarEbazar] = useState(true);
  const [incluirCpsLog, setIncluirCpsLog] = useState(false);
  const [rows, setRows] = useState(null);
  const [rowsAnalise, setRowsAnalise] = useState([]);
  const [mapaVinculosTransportadoras, setMapaVinculosTransportadoras] = useState(() => new Map());
  const [pagina, setPagina] = useState(1);
  const [temProximaPagina, setTemProximaPagina] = useState(false);
  const [ultimaBuscaTemFiltro, setUltimaBuscaTemFiltro] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [carregandoAnalise, setCarregandoAnalise] = useState(false);
  const [progressoAnalise, setProgressoAnalise] = useState(null);
  const [erro, setErro] = useState('');
  const [feedback, setFeedback] = useState('');
  const [interactiveFilters, setInteractiveFilters] = useState(FILTROS_INTERATIVOS_INICIAIS);
  const [modalCompetenciaAberto, setModalCompetenciaAberto] = useState(false);
  const [salvandoCompetencia, setSalvandoCompetencia] = useState(false);
  const [erroSalvarCompetencia, setErroSalvarCompetencia] = useState('');
  const [formCompetencia, setFormCompetencia] = useState({
    competencia: monthNow(),
    nome: nomeCompetencia(monthNow()),
    inicio: '',
    fim: '',
    observacao: '',
  });
  const [competenciasSalvas, setCompetenciasSalvas] = useState([]);
  const [carregandoComparativo, setCarregandoComparativo] = useState(false);
  const [erroComparativo, setErroComparativo] = useState('');
  const [filtrosComparativo, setFiltrosComparativo] = useState({
    inicio: '',
    fim: '',
    transportadora: '',
    regiaoDestino: '',
    ufDestino: '',
    origem: '',
    canal: '',
  });
  const [analiseVariacao, setAnaliseVariacao] = useState({
    tipo: 'transportadora',
    mostrar: 'todos',
    ordenar: 'maior_aumento',
    busca: '',
    verTodos: '',
  });

  const podeImportar = Boolean(competenciaUpload && arquivoUpload && !importando);

  useEffect(() => {
    carregarComparativoMensal();
  }, []);

  useEffect(() => {
    let ativo = true;

    async function carregarVinculosCte() {
      try {
        const vinculos = await carregarVinculosTransportadoras();
        if (ativo) setMapaVinculosTransportadoras(criarMapaVinculosTransportadoras(vinculos));
      } catch {
        if (ativo) setMapaVinculosTransportadoras(new Map());
      }
    }

    carregarVinculosCte();
    return () => {
      ativo = false;
    };
  }, []);

  const set = (nomeCampo, valor) => {
    setFiltros((prev) => ({ ...prev, [nomeCampo]: valor }));
  };

  function toggleInteractiveFilter(tipo, valor) {
    setInteractiveFilters((prev) => ({
      ...prev,
      [tipo]: prev[tipo] === valor ? null : valor,
    }));
    setPagina(1);
  }

  function limparFiltrosInterativos() {
    setInteractiveFilters(FILTROS_INTERATIVOS_INICIAIS);
    setPagina(1);
  }

  function removerFiltroInterativo(tipo) {
    setInteractiveFilters((prev) => ({ ...prev, [tipo]: null }));
    setPagina(1);
  }

  async function carregarComparativoMensal() {
    setCarregandoComparativo(true);
    setErroComparativo('');

    try {
      const lista = await listarCompetenciasCtesResumo();
      setCompetenciasSalvas(lista);
      if (lista.length) setFeedback(`${fmtN(lista.length)} competência(s) salva(s) carregada(s) no comparativo mensal.`);
    } catch (error) {
      setErroComparativo(error.message || 'Erro ao carregar comparativo mensal.');
    } finally {
      setCarregandoComparativo(false);
    }
  }

  function abrirSalvarCompetencia() {
    const competencia = competenciaDePeriodo(filtros.inicio, filtros.fim);
    setErroSalvarCompetencia('');
    setFormCompetencia({
      competencia,
      nome: nomeCompetencia(competencia),
      inicio: filtros.inicio || '',
      fim: filtros.fim || '',
      observacao: '',
    });
    setModalCompetenciaAberto(true);
  }

  async function confirmarSalvarCompetencia({ substituir = false } = {}) {
    if (!analiseSnapshot?.totalCtes) {
      setErro('Busque CT-es antes de salvar uma competência.');
      return;
    }

    setSalvandoCompetencia(true);
    setErro('');
    setErroSalvarCompetencia('');

    try {
      const payload = montarPayloadCompetenciaCte({
        competencia: formCompetencia.competencia,
        nome: formCompetencia.nome,
        inicio: formCompetencia.inicio,
        fim: formCompetencia.fim,
        observacao: formCompetencia.observacao,
        filtros,
        analise: analiseSnapshot,
      });

      const existente = await buscarCompetenciaCtesResumoExistente({
        competencia: payload.competencia,
        filtrosHash: payload.filtros_hash,
      });

      if (existente && !substituir) {
        const confirma = window.confirm(`A competência ${payload.competencia} já existe com os mesmos filtros principais. Deseja substituir o resumo salvo?`);
        if (!confirma) {
          setFeedback('Salvamento da competência cancelado. Nada foi alterado.');
          return;
        }
      }

      await salvarCompetenciaCtesResumo(payload, { substituir: Boolean(existente || substituir) });
      setFeedback(`Competência ${payload.competencia} salva com ${fmtN(payload.total_ctes)} CT-e(s), sem recarregar CT-es brutos.`);
      setModalCompetenciaAberto(false);
      await carregarComparativoMensal();
    } catch (error) {
      const mensagem = error.message || 'Erro ao salvar competência.';
      setErro(mensagem);
      setErroSalvarCompetencia(mensagem);
    } finally {
      setSalvandoCompetencia(false);
    }
  }

  async function consultarCompetenciaUpload() {
    if (!competenciaUpload) {
      setErro('Selecione uma competência para consultar.');
      return null;
    }

    setErro('');
    setFeedback(`Consultando competência ${competenciaUpload}...`);

    try {
      const status = await verificarCompetenciaRealizadoMensal(competenciaUpload);
      setStatusCompetencia(status);
      setFeedback(
        `Competência ${competenciaUpload}: ${fmtN(status.detalhado)} CT-e(s) na base, ${fmtN(status.consolidado)} rota(s) consolidadas e ${fmtN(status.pendencias)} pendência(s).`
      );
      return status;
    } catch (error) {
      setErro(error.message || 'Erro ao consultar competência.');
      return null;
    }
  }

  async function carregarPendenciasUpload() {
    if (!competenciaUpload) return;
    setErro('');

    try {
      const data = await listarPendenciasIbgeRealizadoMensal(competenciaUpload, 100);
      setPendencias(data);
      setFeedback(`${fmtN(data.length)} pendência(s) de IBGE carregada(s) para conferência.`);
    } catch (error) {
      setErro(error.message || 'Erro ao carregar pendências.');
    }
  }

  async function importarArquivoCte({ forcarSubstituir = false } = {}) {
    if (!competenciaUpload || !arquivoUpload) {
      setErro('Selecione a competência e o arquivo CT-e para subir.');
      return;
    }

    setImportando(true);
    setErro('');
    setFeedback('Lendo arquivo e validando colunas...');
    setResultadoUpload(null);
    setValidacaoUpload(null);
    setMetaUpload(null);
    setPendencias([]);
    setProgressoUpload({ etapa: 'leitura', mensagem: 'Lendo arquivo...', percentual: 5 });

    try {
      const statusAtual = await verificarCompetenciaRealizadoMensal(competenciaUpload);
      setStatusCompetencia(statusAtual);

      const jaTemBase = Number(statusAtual?.detalhado || 0) > 0;
      const substituir = Boolean(forcarSubstituir || substituirCompetencia);

      if (jaTemBase && !substituir) {
        setErro(
          `A competência ${competenciaUpload} já possui ${fmtN(statusAtual.detalhado)} CT-e(s). Para subir novamente, marque "Substituir competência existente" ou clique em "Reimportar e substituir".`
        );
        setFeedback('Upload bloqueado para evitar duplicidade.');
        return;
      }

      if (jaTemBase && substituir) {
        const confirmou = window.confirm(
          `A competência ${competenciaUpload} já tem ${fmtN(statusAtual.detalhado)} CT-e(s). Deseja apagar essa competência e subir novamente?`
        );
        if (!confirmou) {
          setFeedback('Reimportação cancelada. Nenhum dado foi alterado.');
          return;
        }
      }

      const { registros, meta } = await parseRealizadoCtesFile(arquivoUpload);
      setMetaUpload(meta);
      setProgressoUpload({ etapa: 'validacao', mensagem: `${fmtN(registros.length)} CT-e(s) lidos. Validando campos...`, percentual: 15 });

      const resposta = await importarRealizadoMensalEnxuto({
        competencia: competenciaUpload,
        arquivoOrigem: arquivoUpload.name,
        registros,
        substituir,
        onProgress: (event) => {
          if (event.etapa === 'validacao') {
            setValidacaoUpload(event.validacao);
            setProgressoUpload({ etapa: 'validacao', mensagem: event.mensagem, percentual: 20 });
          }

          if (event.etapa === 'temporaria') {
            const total = Number(event.total || registros.length || 1);
            const enviados = Number(event.enviados || 0);
            const pct = total ? 20 + Math.round((enviados / total) * 45) : 25;
            setProgressoUpload({
              etapa: 'temporaria',
              mensagem: `${fmtN(enviados)} de ${fmtN(total)} CT-e(s) enviados para a temporária...`,
              percentual: Math.min(65, pct),
            });
          }

          if (event.etapa === 'processamento') {
            setProgressoUpload({ etapa: 'processamento', mensagem: event.mensagem, percentual: 75 });
          }

          if (event.etapa === 'concluido') {
            setProgressoUpload({ etapa: 'concluido', mensagem: event.mensagem, percentual: 100 });
          }
        },
      });

      setResultadoUpload(resposta);
      setStatusCompetencia(resposta.statusFinal);

      if (Number(resposta.statusFinal?.pendencias || 0) > 0) {
        const lista = await listarPendenciasIbgeRealizadoMensal(competenciaUpload, 100);
        setPendencias(lista);
      }

      setFeedback(
        `${substituir ? 'Reimportação' : 'Importação'} concluída: ${fmtN(resposta.statusFinal?.detalhado)} CT-e(s) na base, ${fmtN(resposta.statusFinal?.consolidado)} rota(s) consolidadas e ${fmtN(resposta.statusFinal?.pendencias)} pendência(s).`
      );

      if (filtros.inicio || filtros.fim || filtros.canal || filtros.transportadoraRealizada || filtros.origem || filtros.destino || filtros.ufOrigem || filtros.ufDestino) {
        await buscar(1, filtros);
      }
    } catch (error) {
      setErro(error.message || 'Erro ao importar CT-e.');
    } finally {
      setImportando(false);
    }
  }

  function limparUpload() {
    setArquivoUpload(null);
    setValidacaoUpload(null);
    setMetaUpload(null);
    setResultadoUpload(null);
    setProgressoUpload(null);
    setPendencias([]);
    setErro('');
    setFeedback('Seleção de arquivo limpa.');
    const input = document.getElementById('cte-upload-file-input');
    if (input) input.value = '';
  }

  const buscar = async (paginaSolicitada = 1, filtrosBusca = filtros) => {
    setCarregando(true);
    setCarregandoAnalise(true);
    setProgressoAnalise(null);
    setErro('');
    limparFiltrosInterativos();
    setUltimaBuscaTemFiltro(temFiltroAtivo(filtrosBusca));

    try {
      const paginaResposta = await buscarCtesPagina(filtrosBusca, paginaSolicitada);
      setRows(paginaResposta.data);
      setTemProximaPagina(paginaResposta.hasNext);
      setPagina(paginaResposta.pagina);
    } catch (error) {
      setErro(error.message || String(error));
      setRows(null);
      setRowsAnalise([]);
      setTemProximaPagina(false);
      setCarregando(false);
      setCarregandoAnalise(false);
      return;
    }

    try {
      const dadosAnalise = await buscarCtesParaAnalise(filtrosBusca, setProgressoAnalise);
      setRowsAnalise(dadosAnalise);
    } catch (error) {
      setRowsAnalise([]);
      setErro(`Lista carregada, mas a análise resumida falhou. Tente filtros menores ou buscar novamente. Detalhe: ${error.message || String(error)}`);
    } finally {
      setCarregando(false);
      setCarregandoAnalise(false);
    }
  };

  const trocarPagina = async (novaPagina) => {
    const paginaSegura = Math.max(Number(novaPagina || 1), 1);
    setPagina(paginaSegura);
  };

  const rowsAnaliseComVinculos = useMemo(
    () => aplicarVinculosTransportadorasRows(rowsAnalise || [], mapaVinculosTransportadoras),
    [rowsAnalise, mapaVinculosTransportadoras]
  );

  const totalVinculosAplicados = useMemo(
    () => rowsAnaliseComVinculos.filter((row) => getTransportadora(row) !== getTransportadoraOriginal(row)).length,
    [rowsAnaliseComVinculos]
  );

  const baseAnalisePadrao = useMemo(
    () => aplicarFiltrosPadraoCte(rowsAnaliseComVinculos || [], { ocultarEbazar, incluirCpsLog }),
    [rowsAnaliseComVinculos, ocultarEbazar, incluirCpsLog]
  );

  const analiseSnapshot = useMemo(
    () => montarAnalise(baseAnalisePadrao, filtros),
    [baseAnalisePadrao, filtros]
  );

  const rowsAnaliseInterativas = useMemo(
    () => aplicarFiltrosInterativos(baseAnalisePadrao, interactiveFilters),
    [baseAnalisePadrao, interactiveFilters]
  );

  const analise = useMemo(
    () => montarAnalise(rowsAnaliseInterativas, filtros),
    [rowsAnaliseInterativas, filtros]
  );

  const rowsFiltradas = useMemo(() => {
    if (!rows) return null;
    const inicio = (pagina - 1) * PAGE_SIZE;
    return rowsAnaliseInterativas.slice(inicio, inicio + PAGE_SIZE);
  }, [rows, rowsAnaliseInterativas, pagina]);

  const filtrosAtivos = filtrosInterativosAtivos(interactiveFilters);
  const totalPaginasTabela = Math.max(Math.ceil((rowsAnaliseInterativas.length || 0) / PAGE_SIZE), 1);
  const temProximaTabela = pagina < totalPaginasTabela;
  const competenciasSalvasComVinculos = useMemo(
    () => aplicarVinculosCompetenciasResumo(competenciasSalvas, mapaVinculosTransportadoras),
    [competenciasSalvas, mapaVinculosTransportadoras]
  );
  const competenciasComparativo = useMemo(
    () => aplicarFiltrosComparativo(competenciasSalvasComVinculos, filtrosComparativo),
    [competenciasSalvasComVinculos, filtrosComparativo]
  );
  const linhasComparativo = useMemo(
    () => competenciasComparativo.map((row) => linhaComparativoComFiltros(row, filtrosComparativo)),
    [competenciasComparativo, filtrosComparativo]
  );
  const variacoesBase = useMemo(
    () => montarVariacoesDimensao(competenciasComparativo, analiseVariacao.tipo),
    [competenciasComparativo, analiseVariacao.tipo]
  );
  const variacoesFiltradas = useMemo(
    () => filtrarOrdenarVariacoes(variacoesBase, analiseVariacao),
    [variacoesBase, analiseVariacao]
  );
  const maioresAumentosCompletos = useMemo(
    () => filtrarOrdenarVariacoes(variacoesBase, { mostrar: 'aumentos', ordenar: 'maior_aumento' }),
    [variacoesBase]
  );
  const maioresReducoes = useMemo(
    () => filtrarOrdenarVariacoes(variacoesBase, { mostrar: 'reducoes', ordenar: 'maior_reducao' }),
    [variacoesBase]
  );
  const maioresImpactos = useMemo(
    () => filtrarOrdenarVariacoes(variacoesBase, { mostrar: 'todos', ordenar: 'impacto' }),
    [variacoesBase]
  );
  const totaisComparativo = useMemo(
    () => linhasComparativo.reduce((acc, row) => {
      acc.totalCtes += Number(row.total_ctes || 0);
      acc.valorCte += Number(row.valor_total_cte || 0);
      acc.valorNf += Number(row.valor_total_nf || 0);
      acc.pesoTotal += Number(row.peso_total || 0);
      acc.transportadoras += Number(row.total_transportadoras || 0);
      acc.rotas += Number(row.total_rotas || 0);
      return acc;
    }, { totalCtes: 0, valorCte: 0, valorNf: 0, pesoTotal: 0, transportadoras: 0, rotas: 0 }),
    [linhasComparativo]
  );
  const painelTransportadoras = useMemo(
    () => montarPainelTransportadorasComparativo(competenciasComparativo, filtrosComparativo, linhasComparativo),
    [competenciasComparativo, filtrosComparativo, linhasComparativo]
  );
  const participacaoTransportadoras = useMemo(
    () => montarParticipacaoTransportadoras(competenciasComparativo),
    [competenciasComparativo]
  );
  const analiseOrigemDestino = useMemo(
    () => montarAnaliseEstrategicaOrigemDestino(competenciasComparativo, filtrosComparativo),
    [competenciasComparativo, filtrosComparativo]
  );
  const alertasComparativo = useMemo(
    () => montarAlertasComparativo({ variacoes: variacoesBase, linhas: linhasComparativo, participacao: participacaoTransportadoras }),
    [variacoesBase, linhasComparativo, participacaoTransportadoras]
  );
  const topParticipacaoGanha = useMemo(
    () => [...participacaoTransportadoras].sort((a, b) => b.deltaPartCtes - a.deltaPartCtes).slice(0, 10),
    [participacaoTransportadoras]
  );
  const topParticipacaoPerde = useMemo(
    () => [...participacaoTransportadoras].sort((a, b) => a.deltaPartCtes - b.deltaPartCtes).slice(0, 10),
    [participacaoTransportadoras]
  );
  const rotasCriticas = useMemo(
    () => filtrarOrdenarVariacoes(montarVariacoesDimensao(competenciasComparativo, 'rota'), { mostrar: 'criticos', ordenar: 'impacto' }).slice(0, 10),
    [competenciasComparativo]
  );
  const origensCriticas = useMemo(
    () => filtrarOrdenarVariacoes(montarVariacoesDimensao(competenciasComparativo, 'origem'), { mostrar: 'criticos', ordenar: 'impacto' }).slice(0, 10),
    [competenciasComparativo]
  );
  const destinosCriticos = useMemo(
    () => filtrarOrdenarVariacoes(montarVariacoesDimensao(competenciasComparativo, 'destino'), { mostrar: 'criticos', ordenar: 'impacto' }).slice(0, 10),
    [competenciasComparativo]
  );
  const ufsMaisCaras = useMemo(
    () => filtrarOrdenarVariacoes(montarVariacoesDimensao(competenciasComparativo, 'ufDestino'), { mostrar: 'todos', ordenar: 'percentual' }).slice(0, 10),
    [competenciasComparativo]
  );
  const canaisMaisCaros = useMemo(
    () => filtrarOrdenarVariacoes(montarVariacoesDimensao(competenciasComparativo, 'canal'), { mostrar: 'todos', ordenar: 'percentual' }).slice(0, 10),
    [competenciasComparativo]
  );
  const opcoesComparativo = useMemo(() => {
    const coletar = (campo) => [...new Set(competenciasSalvasComVinculos.flatMap((row) => (row[campo] || []).map((item) => item.key).filter(Boolean)))].sort();
    return {
      transportadoras: coletar('resumo_transportadoras_json'),
      origens: coletar('resumo_origens_json'),
      regioes: coletar('resumo_regioes_json'),
      ufsDestino: coletar('resumo_ufs_destino_json'),
      canais: coletar('resumo_canais_json'),
    };
  }, [competenciasSalvasComVinculos]);

  const totalProgressoAnalise = Number.isFinite(progressoAnalise?.total) ? progressoAnalise.total : null;
  const inicioExibicao = rowsFiltradas ? (pagina - 1) * PAGE_SIZE + 1 : 0;
  const fimExibicao = rowsFiltradas ? Math.min(inicioExibicao + rowsFiltradas.length - 1, rowsAnaliseInterativas.length) : 0;

  return (
    <div className="page-shell cte-page">
      <div className="page-top between">
        <div className="page-header">
          <h1>CT-e</h1>
          <p>Base online · Supabase ({TABELA})</p>
        </div>
      </div>

      {erro && (
        <div style={{ padding: '10px 14px', background: '#fff1f1', border: '1px solid #efc4c4', borderRadius: 10, color: '#9b2323', fontSize: 13, marginBottom: 12 }}>
          {erro}
        </div>
      )}

      {feedback && (
        <div className="sim-alert info" style={{ marginBottom: 12 }}>
          {feedback}
        </div>
      )}

      {modalCompetenciaAberto && (
        <div className="panel-card" style={{ border: '2px solid #185FA5', marginBottom: 12 }}>
          <div className="section-row compact-top">
            <div>
              <div className="panel-title">Salvar competência</div>
              <p className="compact">O resumo será salvo a partir da análise já carregada, sem buscar CT-es novamente.</p>
            </div>
            <button type="button" className="btn-secondary" onClick={() => setModalCompetenciaAberto(false)} disabled={salvandoCompetencia}>
              Fechar
            </button>
          </div>
          {erroSalvarCompetencia && (
            <div className="sim-alert warn" style={{ marginBottom: 12 }}>
              {erroSalvarCompetencia}
            </div>
          )}
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10 }}>
            <div className="field">
              <label>Competência</label>
              <input value={formCompetencia.competencia} onChange={(e) => setFormCompetencia((prev) => ({ ...prev, competencia: e.target.value, nome: nomeCompetencia(e.target.value) }))} placeholder="2026-01" />
            </div>
            <div className="field">
              <label>Nome amigável</label>
              <input value={formCompetencia.nome} onChange={(e) => setFormCompetencia((prev) => ({ ...prev, nome: e.target.value }))} />
            </div>
            <div className="field">
              <label>Data inicial</label>
              <input type="date" value={formCompetencia.inicio} onChange={(e) => setFormCompetencia((prev) => ({ ...prev, inicio: e.target.value }))} />
            </div>
            <div className="field">
              <label>Data final</label>
              <input type="date" value={formCompetencia.fim} onChange={(e) => setFormCompetencia((prev) => ({ ...prev, fim: e.target.value }))} />
            </div>
            <div className="field">
              <label>Observação</label>
              <input value={formCompetencia.observacao} onChange={(e) => setFormCompetencia((prev) => ({ ...prev, observacao: e.target.value }))} placeholder="Opcional" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
            <button type="button" className="btn-primary" onClick={() => confirmarSalvarCompetencia()} disabled={salvandoCompetencia || !formCompetencia.competencia}>
              {salvandoCompetencia ? 'Salvando...' : 'Confirmar salvar'}
            </button>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>
              Snapshot: {fmtN(analiseSnapshot.totalCtes)} CT-es · {fmt(analiseSnapshot.totalCte)} · {fmtPct(analiseSnapshot.percentualFrete)} frete/NF.
            </span>
          </div>
        </div>
      )}

      <ExpandCard
        title="Subir / reimportar CT-es"
        subtitle="Use aqui para subir novamente uma competência e preservar valor calculado, diferença, status e dados de conciliação."
        badge={statusCompetencia ? `${fmtN(statusCompetencia.detalhado)} CT-es na competência` : 'Upload CTS'}
        defaultOpen
      >
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
          <div className="field">
            <label>Competência</label>
            <input
              type="month"
              value={competenciaUpload}
              onChange={(event) => setCompetenciaUpload(event.target.value)}
              disabled={importando}
            />
          </div>

          <div className="field">
            <label>Arquivo CT-e completo</label>
            <input
              id="cte-upload-file-input"
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(event) => setArquivoUpload(event.target.files?.[0] || null)}
              disabled={importando}
            />
          </div>

          <div className="field">
            <label>Ação</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn-secondary" type="button" onClick={consultarCompetenciaUpload} disabled={importando || !competenciaUpload}>
                Consultar
              </button>
              <button className="btn-secondary" type="button" onClick={carregarPendenciasUpload} disabled={importando || !competenciaUpload}>
                Pendências
              </button>
              <button className="btn-secondary" type="button" onClick={limparUpload} disabled={importando}>
                Limpar
              </button>
            </div>
          </div>
        </div>

        <label
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            padding: 12,
            borderRadius: 12,
            background: substituirCompetencia ? '#fff7ed' : '#f8fafc',
            border: `1px solid ${substituirCompetencia ? '#fdba74' : '#e2e8f0'}`,
            margin: '12px 0',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={substituirCompetencia}
            onChange={(event) => setSubstituirCompetencia(event.target.checked)}
            disabled={importando}
            style={{ marginTop: 3 }}
          />
          <span>
            <strong>Substituir competência existente</strong>
            <br />
            <small>Use para subir novamente janeiro/fevereiro etc. O sistema apaga a competência atual e grava o novo arquivo, evitando duplicidade.</small>
          </span>
        </label>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn-primary" type="button" onClick={() => importarArquivoCte({ forcarSubstituir: false })} disabled={!podeImportar || substituirCompetencia}>
            {importando ? 'Importando...' : 'Importar mês novo'}
          </button>
          <button className="btn-primary" type="button" onClick={() => importarArquivoCte({ forcarSubstituir: true })} disabled={!podeImportar}>
            {importando ? 'Reimportando...' : 'Reimportar e substituir'}
          </button>
          {arquivoUpload ? <span style={{ fontSize: 13, color: 'var(--muted)' }}>Arquivo: <strong>{arquivoUpload.name}</strong></span> : null}
        </div>

        {progressoUpload ? (
          <div className="sim-alert info" style={{ marginTop: 12 }}>
            <div className="sim-parametros-header">
              <div>
                <strong>Upload: {progressoUpload.etapa}</strong>
                <p>{progressoUpload.mensagem}</p>
              </div>
              <span>{Number(progressoUpload.percentual || 0).toLocaleString('pt-BR')}%</span>
            </div>
            <div style={{ height: 10, borderRadius: 999, background: 'rgba(0,0,0,0.08)', overflow: 'hidden', marginTop: 10 }}>
              <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, Number(progressoUpload.percentual || 0)))}%`, borderRadius: 999, background: '#9153F0', transition: 'width 180ms ease' }} />
            </div>
          </div>
        ) : null}

        {metaUpload ? (
          <div className="hint-box" style={{ marginTop: 12 }}>
            Leitura: aba <strong>{metaUpload.aba || '—'}</strong> · {fmtN(metaUpload.registrosValidos)} CT-e(s) válido(s) · {fmtN(metaUpload.linhasOriginais)} linha(s).
          </div>
        ) : null}

        <ValidacaoUpload validacao={validacaoUpload} />

        {resultadoUpload ? (
          <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginTop: 12 }}>
            <SummaryCard title="Temporária enviada" value={fmtN(resultadoUpload.temporaria?.enviados)} subtitle="linhas processadas" />
            <SummaryCard title="Base oficial" value={fmtN(resultadoUpload.statusFinal?.detalhado)} subtitle="CT-e(s) na competência" />
            <SummaryCard title="Consolidado" value={fmtN(resultadoUpload.statusFinal?.consolidado)} subtitle="rotas geradas" />
            <SummaryCard title="Pendências" value={fmtN(resultadoUpload.statusFinal?.pendencias)} subtitle="sem IBGE" />
          </div>
        ) : null}

        {pendencias.length ? (
          <div className="sim-analise-tabela-wrap" style={{ marginTop: 12 }}>
            <table className="sim-analise-tabela">
              <thead>
                <tr>
                  <th>CT-e</th>
                  <th>Emissão</th>
                  <th>Transportadora</th>
                  <th>Origem</th>
                  <th>Destino</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {pendencias.map((item) => (
                  <tr key={item.id || `${item.chave_cte}-${item.motivo}`}>
                    <td>{item.numero_cte || item.chave_cte}</td>
                    <td>{fmtDate(item.data_emissao)}</td>
                    <td>{item.transportadora}</td>
                    <td>{item.cidade_origem}/{item.uf_origem}</td>
                    <td>{item.cidade_destino}/{item.uf_destino}</td>
                    <td>{item.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </ExpandCard>

      <ExpandCard
        title="Comparativo mensal"
        subtitle="Evolução mês a mês usando apenas competências salvas, sem recarregar CT-es brutos."
        badge={`${fmtN(competenciasComparativo.length)} competência(s)`}
        defaultOpen={false}
      >
        {erroComparativo && (
          <div className="sim-alert warn" style={{ marginBottom: 12 }}>{erroComparativo}</div>
        )}

        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 10, marginBottom: 12 }}>
          <div className="field">
            <label>Competência inicial</label>
            <input type="month" value={filtrosComparativo.inicio} onChange={(e) => setFiltrosComparativo((prev) => ({ ...prev, inicio: e.target.value }))} />
          </div>
          <div className="field">
            <label>Competência final</label>
            <input type="month" value={filtrosComparativo.fim} onChange={(e) => setFiltrosComparativo((prev) => ({ ...prev, fim: e.target.value }))} />
          </div>
          <div className="field">
            <label>Transportadora</label>
            <select value={filtrosComparativo.transportadora} onChange={(e) => setFiltrosComparativo((prev) => ({ ...prev, transportadora: e.target.value }))}>
              <option value="">Todas</option>
              {opcoesComparativo.transportadoras.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Região destino</label>
            <select value={filtrosComparativo.regiaoDestino} onChange={(e) => setFiltrosComparativo((prev) => ({ ...prev, regiaoDestino: e.target.value }))}>
              <option value="">Todas</option>
              {opcoesComparativo.regioes.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Origem</label>
            <select value={filtrosComparativo.origem} onChange={(e) => setFiltrosComparativo((prev) => ({ ...prev, origem: e.target.value }))}>
              <option value="">Todas</option>
              {opcoesComparativo.origens.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div className="field">
            <label>UF destino</label>
            <select value={filtrosComparativo.ufDestino} onChange={(e) => setFiltrosComparativo((prev) => ({ ...prev, ufDestino: e.target.value }))}>
              <option value="">Todas</option>
              {opcoesComparativo.ufsDestino.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Canal</label>
            <select value={filtrosComparativo.canal} onChange={(e) => setFiltrosComparativo((prev) => ({ ...prev, canal: e.target.value }))}>
              <option value="">Todos</option>
              {opcoesComparativo.canais.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <button type="button" className="btn-secondary" onClick={carregarComparativoMensal} disabled={carregandoComparativo}>
            {carregandoComparativo ? 'Carregando...' : 'Atualizar comparativo'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => setFiltrosComparativo({ inicio: '', fim: '', transportadora: '', regiaoDestino: '', ufDestino: '', origem: '', canal: '' })}>
            Limpar filtros do comparativo
          </button>
        </div>

        <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 12 }}>
          <SummaryCard title="CT-es acumulados" value={fmtN(totaisComparativo.totalCtes)} subtitle="competências filtradas" />
          <SummaryCard title="Valor CT-e" value={fmt(totaisComparativo.valorCte)} subtitle="recorte filtrado" />
          <SummaryCard title="Valor NF" value={fmt(totaisComparativo.valorNf)} subtitle="recorte filtrado" />
          <SummaryCard title="Frete sobre NF" value={fmtPct(totaisComparativo.valorNf ? (totaisComparativo.valorCte / totaisComparativo.valorNf) * 100 : 0)} subtitle="média ponderada" />
          <SummaryCard title="Peso total" value={`${fmtN(totaisComparativo.pesoTotal)} kg`} subtitle="competências salvas" />
          <SummaryCard title="Rotas somadas" value={fmtN(totaisComparativo.rotas)} subtitle="soma mês a mês" />
        </div>

        <div className="feature-grid import-grid" style={{ marginBottom: 12 }}>
          <GraficoBarrasMensal titulo="CT-es por mês" linhas={linhasComparativo} campo="total_ctes" />
          <GraficoBarrasMensal titulo="Valor CT-e por mês" linhas={linhasComparativo} campo="valor_total_cte" tipo="moeda" cor="#1D9E75" />
        </div>

        <div className="feature-grid import-grid" style={{ marginBottom: 12 }}>
          <GraficoBarrasMensal titulo="Faturamento mensal" linhas={linhasComparativo} campo="valor_total_nf" tipo="moeda" cor="#7A5CCF" style={{ gridColumn: '1 / -1' }} />
          <GraficoBarrasMensal titulo="Frete sobre NF por mês" linhas={linhasComparativo} campo="percentual_frete_nf" tipo="pct" cor="#D85A30" />
          <GraficoBarrasMensal titulo="Peso total por mês" linhas={linhasComparativo} campo="peso_total" tipo="kg" cor="#6D5BD0" />
        </div>

        <div className="feature-grid import-grid" style={{ marginBottom: 12 }}>
          <div className="panel-card" style={{ marginBottom: 12, gridColumn: '1 / -1' }}>
            <div className="section-row compact-top">
              <div>
                <div className="panel-title">Analise estrategica Origem x Destino</div>
                <p className="compact">Ranking, oportunidades, variacao mensal e mapa de calor por fluxo UF origem - UF destino, usando apenas as competencias salvas.</p>
              </div>
              <span className="coverage-badge ok">{fmtN(analiseOrigemDestino.fluxos.length)} fluxo(s)</span>
            </div>

            {(analiseOrigemDestino.bloqueado || analiseOrigemDestino.aviso) && (
              <div className="sim-alert warn" style={{ marginTop: 10, marginBottom: 10 }}>
                {analiseOrigemDestino.aviso}
              </div>
            )}

            <div className="sim-analise-tabela-wrap" style={{ marginTop: 10 }}>
              <table className="sim-analise-tabela">
                <thead>
                  <tr>
                    <th>Origem - Destino</th>
                    <th>% Frete</th>
                    <th>Valor NF</th>
                    <th>Valor CT-e</th>
                    <th>CT-es</th>
                    <th>Peso</th>
                  </tr>
                </thead>
                <tbody>
                  {!analiseOrigemDestino.piores.length && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: 16 }}>Sem fluxos origem/destino no recorte.</td></tr>
                  )}
                  {analiseOrigemDestino.piores.slice(0, 12).map((item) => (
                    <tr key={item.key}>
                      <td><strong>{item.label}</strong></td>
                      <td style={{ color: item.percentualFrete >= 8 ? '#D85A30' : undefined, fontWeight: 800 }}>{fmtPct(item.percentualFrete)}</td>
                      <td>{fmt(item.valorNf)}</td>
                      <td>{fmt(item.valorCte)}</td>
                      <td>{fmtN(item.ctes)}</td>
                      <td>{fmtN(item.peso)} kg</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="feature-grid import-grid" style={{ marginTop: 12, marginBottom: 12 }}>
              <div>
                <div className="panel-title">Oportunidades logisticas</div>
                <div className="sim-analise-tabela-wrap" style={{ marginTop: 10 }}>
                  <table className="sim-analise-tabela">
                    <thead><tr><th>Fluxo</th><th>CT-es</th><th>Valor NF</th><th>% Frete</th><th>Operacao local</th><th>CD proximo</th><th>Abastecimento alternativo</th></tr></thead>
                    <tbody>
                      {!analiseOrigemDestino.oportunidades.length && (
                        <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)', padding: 16 }}>Sem oportunidade logistica sinalizada no recorte.</td></tr>
                      )}
                      {analiseOrigemDestino.oportunidades.map((item) => (
                        <tr key={`${item.key}-opp`}>
                          <td><strong>{item.label}</strong></td>
                          <td>{fmtN(item.ctes)}</td>
                          <td>{fmt(item.valorNf)}</td>
                          <td>{fmtPct(item.percentualFrete)}</td>
                          <td>{item.operacaoLocal}</td>
                          <td>{item.cdProximo}</td>
                          <td>{item.abastecimentoAlternativo}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <div className="panel-title">Comparativo mes a mes por fluxo</div>
                <div className="sim-analise-tabela-wrap" style={{ marginTop: 10 }}>
                  <table className="sim-analise-tabela">
                    <thead><tr><th>Fluxo</th><th>Mes</th><th>CT-es</th><th>Peso</th><th>Valor NF</th><th>Valor CT-e</th><th>% Frete</th></tr></thead>
                    <tbody>
                      {!analiseOrigemDestino.comparativoFluxos.length && (
                        <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)', padding: 16 }}>Sem historico mensal por fluxo.</td></tr>
                      )}
                      {analiseOrigemDestino.comparativoFluxos.flatMap((fluxo) => fluxo.meses.map((mes) => (
                        <tr key={`${fluxo.key}-${mes.competencia}`}>
                          <td><strong>{fluxo.label}</strong></td>
                          <td>{mes.competencia}</td>
                          <td>{fmtN(mes.ctes)}</td>
                          <td>{fmtN(mes.peso)} kg</td>
                          <td>{fmt(mes.valorNf)}</td>
                          <td>{fmt(mes.valorCte)}</td>
                          <td>{fmtPct(mes.percentualFrete)}</td>
                        </tr>
                      )))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="feature-grid import-grid" style={{ marginBottom: 12 }}>
              <div>
                <div className="panel-title">Top 20 aumentos de fluxo</div>
                <div className="sim-analise-tabela-wrap" style={{ marginTop: 10 }}>
                  <table className="sim-analise-tabela">
                    <thead><tr><th>Fluxo</th><th>Periodo</th><th>Antes</th><th>Depois</th><th>Variacao</th><th>Peso transportado</th><th>Soma NF</th><th>Soma CT-e</th><th>% medio rota</th></tr></thead>
                    <tbody>
                      {!analiseOrigemDestino.aumentos.length && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--muted)', padding: 16 }}>Sem aumento de fluxo.</td></tr>}
                      {analiseOrigemDestino.aumentos.map((item) => (
                        <tr key={item.key}>
                          <td><strong>{item.fluxo}</strong></td>
                          <td>{item.competenciaAnterior} - {item.competenciaAtual}</td>
                          <td>{fmtN(item.ctesAntes)}</td>
                          <td>{fmtN(item.ctesDepois)}</td>
                          <td style={{ color: '#D85A30', fontWeight: 800 }}>+{fmtPct(item.deltaCtesPct, 0)}</td>
                          <td>{fmtN(item.pesoDepois)} kg</td>
                          <td>{fmt(item.valorNfDepois)}</td>
                          <td>{fmt(item.valorCteDepois)}</td>
                          <td>{fmtPct(item.valorNfDepois > 0 ? (item.valorCteDepois / item.valorNfDepois) * 100 : 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <div className="panel-title">Maiores reducoes de fluxo</div>
                <div className="sim-analise-tabela-wrap" style={{ marginTop: 10 }}>
                  <table className="sim-analise-tabela">
                    <thead><tr><th>Fluxo</th><th>Periodo</th><th>Antes</th><th>Depois</th><th>Variacao</th><th>Peso transportado</th><th>Soma NF</th><th>Soma CT-e</th><th>% medio rota</th></tr></thead>
                    <tbody>
                      {!analiseOrigemDestino.reducoes.length && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--muted)', padding: 16 }}>Sem reducao de fluxo.</td></tr>}
                      {analiseOrigemDestino.reducoes.map((item) => (
                        <tr key={item.key}>
                          <td><strong>{item.fluxo}</strong></td>
                          <td>{item.competenciaAnterior} - {item.competenciaAtual}</td>
                          <td>{fmtN(item.ctesAntes)}</td>
                          <td>{fmtN(item.ctesDepois)}</td>
                          <td style={{ color: '#1D9E75', fontWeight: 800 }}>{fmtPct(item.deltaCtesPct, 0)}</td>
                          <td>{fmtN(item.pesoDepois)} kg</td>
                          <td>{fmt(item.valorNfDepois)}</td>
                          <td>{fmt(item.valorCteDepois)}</td>
                          <td>{fmtPct(item.valorNfDepois > 0 ? (item.valorCteDepois / item.valorNfDepois) * 100 : 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div>
              <div className="panel-title">Mapa de calor Origem x Destino (% Frete)</div>
              <div className="sim-analise-tabela-wrap" style={{ marginTop: 10 }}>
                <table className="sim-analise-tabela">
                  <thead>
                    <tr>
                      <th>Origem / Destino</th>
                      {analiseOrigemDestino.heatmapDestinos.map((uf) => <th key={`heat-dest-${uf}`}>{uf}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {!analiseOrigemDestino.heatmapOrigens.length && (
                      <tr><td colSpan={Math.max(analiseOrigemDestino.heatmapDestinos.length + 1, 2)} style={{ textAlign: 'center', color: 'var(--muted)', padding: 16 }}>Sem mapa de calor no recorte.</td></tr>
                    )}
                    {analiseOrigemDestino.heatmapOrigens.map((origemUf) => (
                      <tr key={`heat-origem-${origemUf}`}>
                        <td><strong>{origemUf}</strong></td>
                        {analiseOrigemDestino.heatmapDestinos.map((destinoUf) => {
                          const celula = analiseOrigemDestino.heatmap.get(origemUf)?.get(destinoUf);
                          const pct = celula?.valorNf > 0 ? (celula.valorCte / celula.valorNf) * 100 : 0;
                          const cor = pct >= 12 ? '#fee2e2' : pct >= 8 ? '#ffedd5' : pct >= 5 ? '#fef3c7' : pct > 0 ? '#dcfce7' : undefined;
                          return (
                            <td key={`heat-${origemUf}-${destinoUf}`} style={{ background: cor, fontWeight: pct >= 8 ? 800 : 600 }}>
                              {pct > 0 ? fmtPct(pct) : '-'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="panel-card">
            <div className="panel-title">{painelTransportadoras.recorteConsolidado ? 'Recorte filtrado' : 'Transportadoras mais caras'}</div>
            {painelTransportadoras.recorteConsolidado && (
              <p className="compact">Indicadores consolidados conforme os filtros do comparativo.</p>
            )}
            <div className="sim-analise-tabela-wrap" style={{ marginTop: 10 }}>
              <table className="sim-analise-tabela">
                <thead>
                  <tr>
                    <th>{painelTransportadoras.recorteConsolidado ? 'Recorte' : 'Transportadora'}</th>
                    <th>% frete NF</th>
                    <th>Ticket médio</th>
                    <th>Valor CT-e</th>
                    <th>CT-es</th>
                  </tr>
                </thead>
                <tbody>
                  {!painelTransportadoras.maisCaras.length && (
                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)', padding: 16 }}>Sem transportadoras no recorte.</td></tr>
                  )}
                  {painelTransportadoras.maisCaras.map((item) => (
                    <tr key={item.key}>
                      <td><strong>{item.label}</strong></td>
                      <td>{fmtPct(item.percentualFrete)}</td>
                      <td>{fmt(item.ticketMedio)}</td>
                      <td>{fmt(item.valorCte)}</td>
                      <td>{fmtN(item.ctes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel-card">
            <div className="panel-title">{painelTransportadoras.recorteConsolidado ? 'Aumentos do recorte mês a mês' : 'Maiores aumentos mês a mês'}</div>
            {painelTransportadoras.recorteConsolidado && (
              <p className="compact">Comparando o mesmo recorte filtrado entre as competências.</p>
            )}
            <div className="sim-analise-tabela-wrap" style={{ marginTop: 10 }}>
              <table className="sim-analise-tabela">
                <thead>
                  <tr>
                    <th>{painelTransportadoras.recorteConsolidado ? 'Recorte' : 'Transportadora'}</th>
                    <th>Período</th>
                    <th>Antes</th>
                    <th>Depois</th>
                    <th>Aumento</th>
                    <th>Causa provável</th>
                  </tr>
                </thead>
                <tbody>
                  {!painelTransportadoras.maioresAumentos.length && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: 16 }}>Sem aumento no recorte.</td></tr>
                  )}
                  {painelTransportadoras.maioresAumentos.map((item) => (
                    <tr key={`${item.transportadora}-${item.de}-${item.para}`}>
                      <td><strong>{item.transportadora}</strong></td>
                      <td>{item.de} → {item.para}</td>
                      <td>{fmtPct(item.anterior)}</td>
                      <td>{fmtPct(item.atual)}</td>
                      <td style={{ color: '#D85A30', fontWeight: 800 }}>+{fmtPct(item.deltaPct)}</td>
                      <td>{item.causa}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="panel-card" style={{ marginBottom: 12 }}>
          <div className="section-row compact-top">
            <div>
              <div className="panel-title">Análise completa de variações mês a mês</div>
              <p className="compact">Compara competências salvas por dimensão, sem consultar CT-es brutos.</p>
            </div>
            <button type="button" className="btn-secondary" onClick={() => setAnaliseVariacao((prev) => ({ ...prev, verTodos: prev.verTodos === 'variacoes' ? '' : 'variacoes' }))}>
              {analiseVariacao.verTodos === 'variacoes' ? 'Ver menos' : 'Ver todos'}
            </button>
          </div>

          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginBottom: 12 }}>
            <div className="field">
              <label>Tipo de análise</label>
              <select value={analiseVariacao.tipo} onChange={(e) => setAnaliseVariacao((prev) => ({ ...prev, tipo: e.target.value }))}>
                {Object.entries(TIPOS_ANALISE_VARIACAO).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Mostrar</label>
              <select value={analiseVariacao.mostrar} onChange={(e) => setAnaliseVariacao((prev) => ({ ...prev, mostrar: e.target.value }))}>
                <option value="todos">Todos</option>
                <option value="aumentos">Só aumentos</option>
                <option value="reducoes">Só reduções</option>
                <option value="criticos">Só críticos</option>
              </select>
            </div>
            <div className="field">
              <label>Ordenar por</label>
              <select value={analiseVariacao.ordenar} onChange={(e) => setAnaliseVariacao((prev) => ({ ...prev, ordenar: e.target.value }))}>
                <option value="maior_aumento">Maior aumento em p.p.</option>
                <option value="maior_reducao">Maior redução em p.p.</option>
                <option value="impacto">Maior impacto R$</option>
                <option value="variacao_ctes">Maior variação de CT-es</option>
                <option value="variacao_valor">Maior variação de valor CT-e</option>
                <option value="percentual">Maior % frete/NF</option>
                <option value="ticket">Maior ticket médio</option>
                <option value="volume">Maior volume</option>
              </select>
            </div>
            <div className="field">
              <label>Buscar</label>
              <input value={analiseVariacao.busca} onChange={(e) => setAnaliseVariacao((prev) => ({ ...prev, busca: e.target.value }))} placeholder="Item, origem, destino..." />
            </div>
          </div>

          <div className="sim-analise-tabela-wrap">
            <table className="sim-analise-tabela">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Tipo</th>
                  <th>Anterior</th>
                  <th>Atual</th>
                  <th>CT-es antes</th>
                  <th>CT-es depois</th>
                  <th>Var. CT-es</th>
                  <th>Valor antes</th>
                  <th>Valor depois</th>
                  <th>Var. R$</th>
                  <th>NF antes</th>
                  <th>NF depois</th>
                  <th>% antes</th>
                  <th>% depois</th>
                  <th>Var. p.p.</th>
                  <th>Aumento rel.</th>
                  <th>Ticket antes</th>
                  <th>Ticket depois</th>
                  <th>Peso antes</th>
                  <th>Peso depois</th>
                  <th>Causa provável</th>
                  <th>Criticidade</th>
                </tr>
              </thead>
              <tbody>
                {(analiseVariacao.verTodos === 'variacoes' ? variacoesFiltradas : variacoesFiltradas.slice(0, 25)).map((item) => (
                  <tr key={item.key}>
                    <td
                      onClick={() => ['transportadora', 'origem', 'regiaoDestino', 'ufDestino', 'canal'].includes(analiseVariacao.tipo) && setFiltrosComparativo((prev) => ({ ...prev, [analiseVariacao.tipo]: item.itemKey }))}
                      title="Clique para filtrar o comparativo por este item"
                      style={{ cursor: ['transportadora', 'origem', 'regiaoDestino', 'ufDestino', 'canal'].includes(analiseVariacao.tipo) ? 'pointer' : undefined }}
                    ><strong>{item.item}</strong></td>
                    <td>{item.tipo}</td>
                    <td>{item.competenciaAnterior}</td>
                    <td>{item.competenciaAtual}</td>
                    <td>{fmtN(item.ctesAntes)}</td>
                    <td>{fmtN(item.ctesDepois)}</td>
                    <td style={{ color: item.deltaCtes >= 0 ? '#1D9E75' : '#D85A30', fontWeight: 700 }}>{fmtN(item.deltaCtes)}</td>
                    <td>{fmt(item.valorCteAntes)}</td>
                    <td>{fmt(item.valorCteDepois)}</td>
                    <td style={{ color: item.deltaValorCte >= 0 ? '#D85A30' : '#1D9E75', fontWeight: 700 }}>{fmt(item.deltaValorCte)}</td>
                    <td>{fmt(item.valorNfAntes)}</td>
                    <td>{fmt(item.valorNfDepois)}</td>
                    <td>{fmtPct(item.percentualAntes)}</td>
                    <td>{fmtPct(item.percentualDepois)}</td>
                    <td style={{ color: item.deltaPp >= 0 ? '#D85A30' : '#1D9E75', fontWeight: 800 }}>{item.deltaPp >= 0 ? '+' : ''}{fmtPct(item.deltaPp)}</td>
                    <td>{item.aumentoRelativoPct >= 0 ? '+' : ''}{fmtPct(item.aumentoRelativoPct, 0)}</td>
                    <td>{fmt(item.ticketAntes)}</td>
                    <td>{fmt(item.ticketDepois)}</td>
                    <td>{fmtN(item.pesoAntes)} kg</td>
                    <td>{fmtN(item.pesoDepois)} kg</td>
                    <td>{item.causa}</td>
                    <td><span className={`coverage-badge ${item.criticidade === 'Crítico' ? 'warn' : item.criticidade === 'Atenção' ? '' : 'ok'}`}>{item.criticidade}</span></td>
                  </tr>
                ))}
                {!variacoesFiltradas.length && <tr><td colSpan={22} style={{ textAlign: 'center', color: 'var(--muted)', padding: 16 }}>Sem variações no recorte.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="feature-grid import-grid" style={{ marginBottom: 12 }}>
          <div className="panel-card">
            <div className="section-row compact-top">
              <div className="panel-title">Maiores reduções mês a mês</div>
              <button type="button" className="btn-secondary" onClick={() => setAnaliseVariacao((prev) => ({ ...prev, mostrar: 'reducoes', ordenar: 'maior_reducao', verTodos: 'variacoes' }))}>Ver todos</button>
            </div>
            <div className="sim-analise-tabela-wrap">
              <table className="sim-analise-tabela">
                <thead><tr><th>Item</th><th>Período</th><th>Antes</th><th>Depois</th><th>Redução p.p.</th><th>Redução R$</th><th>Causa provável</th></tr></thead>
                <tbody>{maioresReducoes.slice(0, 8).map((item) => (<tr key={item.key}><td><strong>{item.item}</strong></td><td>{item.competenciaAnterior} → {item.competenciaAtual}</td><td>{fmtPct(item.percentualAntes)}</td><td>{fmtPct(item.percentualDepois)}</td><td style={{ color: '#1D9E75', fontWeight: 800 }}>{fmtPct(item.deltaPp)}</td><td>{fmt(item.deltaValorCte)}</td><td>{item.causa}</td></tr>))}</tbody>
              </table>
            </div>
          </div>

          <div className="panel-card">
            <div className="section-row compact-top">
              <div className="panel-title">Maiores impactos financeiros R$</div>
              <button type="button" className="btn-secondary" onClick={() => setAnaliseVariacao((prev) => ({ ...prev, ordenar: 'impacto', verTodos: 'variacoes' }))}>Ver todos</button>
            </div>
            <div className="sim-analise-tabela-wrap">
              <table className="sim-analise-tabela">
                <thead><tr><th>Item</th><th>Tipo</th><th>Valor antes</th><th>Valor depois</th><th>Diferença R$</th><th>CT-es antes/depois</th><th>% antes/depois</th></tr></thead>
                <tbody>{maioresImpactos.slice(0, 8).map((item) => (<tr key={item.key}><td><strong>{item.item}</strong></td><td>{item.tipo}</td><td>{fmt(item.valorCteAntes)}</td><td>{fmt(item.valorCteDepois)}</td><td style={{ fontWeight: 800 }}>{fmt(item.deltaValorCte)}</td><td>{fmtN(item.ctesAntes)} → {fmtN(item.ctesDepois)}</td><td>{fmtPct(item.percentualAntes)} → {fmtPct(item.percentualDepois)}</td></tr>))}</tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="feature-grid import-grid" style={{ marginBottom: 12 }}>
          <div className="panel-card">
            <div className="panel-title">Transportadoras que ganharam participação</div>
            <div className="sim-analise-tabela-wrap"><table className="sim-analise-tabela"><thead><tr><th>Transportadora</th><th>Part. CT-es antes</th><th>Part. CT-es depois</th><th>Var. p.p.</th><th>Part. custo antes</th><th>Part. custo depois</th><th>CT-es</th><th>Valor CT-e</th></tr></thead><tbody>{topParticipacaoGanha.map((item) => (<tr key={item.key}><td><strong>{item.transportadora}</strong></td><td>{fmtPct(item.partCtesAntes)}</td><td>{fmtPct(item.partCtesDepois)}</td><td>{fmtPct(item.deltaPartCtes)}</td><td>{fmtPct(item.partCustoAntes)}</td><td>{fmtPct(item.partCustoDepois)}</td><td>{fmtN(item.ctesAntes)} → {fmtN(item.ctesDepois)}</td><td>{fmt(item.valorAntes)} → {fmt(item.valorDepois)}</td></tr>))}</tbody></table></div>
          </div>
          <div className="panel-card">
            <div className="panel-title">Transportadoras que perderam participação</div>
            <div className="sim-analise-tabela-wrap"><table className="sim-analise-tabela"><thead><tr><th>Transportadora</th><th>Part. CT-es antes</th><th>Part. CT-es depois</th><th>Var. p.p.</th><th>Part. custo antes</th><th>Part. custo depois</th><th>CT-es</th><th>Valor CT-e</th></tr></thead><tbody>{topParticipacaoPerde.map((item) => (<tr key={item.key}><td><strong>{item.transportadora}</strong></td><td>{fmtPct(item.partCtesAntes)}</td><td>{fmtPct(item.partCtesDepois)}</td><td>{fmtPct(item.deltaPartCtes)}</td><td>{fmtPct(item.partCustoAntes)}</td><td>{fmtPct(item.partCustoDepois)}</td><td>{fmtN(item.ctesAntes)} → {fmtN(item.ctesDepois)}</td><td>{fmt(item.valorAntes)} → {fmt(item.valorDepois)}</td></tr>))}</tbody></table></div>
          </div>
        </div>

        <div className="panel-card" style={{ marginBottom: 12 }}>
          <div className="panel-title">Alertas do comparativo</div>
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            {!alertasComparativo.length && <p>Sem alertas relevantes no recorte.</p>}
            {alertasComparativo.map((alerta, idx) => (
              <div key={`${alerta.tipo}-${idx}`} className={`sim-alert ${alerta.criticidade === 'Crítico' ? 'warn' : 'info'}`} style={{ margin: 0 }}>
                <strong>{alerta.tipo} · {alerta.criticidade}</strong> {alerta.texto}
              </div>
            ))}
          </div>
        </div>

        <div className="feature-grid import-grid" style={{ marginBottom: 12 }}>
          <RankingTabela titulo="Rotas críticas" linhas={rotasCriticas.map((item) => ({ key: item.key, label: item.item, ctes: item.ctesDepois, valorCte: item.valorCteDepois, valorNf: item.valorNfDepois, percentualFrete: item.percentualDepois, ticketMedio: item.ticketDepois }))} maxLinhas={10} />
          <RankingTabela titulo="Origens críticas" linhas={origensCriticas.map((item) => ({ key: item.key, label: item.item, ctes: item.ctesDepois, valorCte: item.valorCteDepois, valorNf: item.valorNfDepois, percentualFrete: item.percentualDepois, ticketMedio: item.ticketDepois }))} maxLinhas={10} />
        </div>

        <div className="feature-grid import-grid" style={{ marginBottom: 12 }}>
          <RankingTabela titulo="Destinos críticos" linhas={destinosCriticos.map((item) => ({ key: item.key, label: item.item, ctes: item.ctesDepois, valorCte: item.valorCteDepois, valorNf: item.valorNfDepois, percentualFrete: item.percentualDepois, ticketMedio: item.ticketDepois }))} maxLinhas={10} />
          <RankingTabela titulo="UFs destino mais caras" linhas={ufsMaisCaras.map((item) => ({ key: item.key, label: item.item, ctes: item.ctesDepois, valorCte: item.valorCteDepois, valorNf: item.valorNfDepois, percentualFrete: item.percentualDepois, ticketMedio: item.ticketDepois }))} maxLinhas={10} />
        </div>

        <div className="feature-grid import-grid" style={{ marginBottom: 12 }}>
          <RankingTabela titulo="Canais mais caros" linhas={canaisMaisCaros.map((item) => ({ key: item.key, label: item.item, ctes: item.ctesDepois, valorCte: item.valorCteDepois, valorNf: item.valorNfDepois, percentualFrete: item.percentualDepois, ticketMedio: item.ticketDepois }))} maxLinhas={10} />
          <div className="panel-card">
            <div className="panel-title">Base com cálculo x sem cálculo</div>
            <div className="sim-analise-tabela-wrap"><table className="sim-analise-tabela"><thead><tr><th>Competência</th><th>Total</th><th>Com cálculo</th><th>% com cálculo</th><th>Sem cálculo</th><th>% sem cálculo</th></tr></thead><tbody>{linhasComparativo.map((row) => { const total = Number(row.total_ctes || 0); const com = Number(row.total_com_calculo || 0); const sem = Number(row.total_sem_calculo || 0); const pctSem = total ? (sem / total) * 100 : 0; return (<tr key={`${row.id}-calc`} style={{ background: pctSem >= 10 ? '#fff7ed' : undefined }}><td><strong>{row.competencia}</strong></td><td>{fmtN(total)}</td><td>{fmtN(com)}</td><td>{fmtPct(total ? (com / total) * 100 : 0)}</td><td>{fmtN(sem)}</td><td>{fmtPct(pctSem)}</td></tr>); })}</tbody></table></div>
          </div>
        </div>

        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead>
              <tr>
                <th>Competência</th>
                <th>CT-es</th>
                <th>Valor CT-e</th>
                <th>Valor NF</th>
                <th>% frete NF</th>
                <th>Peso total</th>
                <th>Ticket médio</th>
                <th>Transportadoras</th>
                <th>Rotas</th>
                <th>Com cálculo</th>
                <th>Sem cálculo</th>
              </tr>
            </thead>
            <tbody>
              {!linhasComparativo.length && (
                <tr><td colSpan={11} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>Nenhuma competência salva encontrada.</td></tr>
              )}
              {linhasComparativo.map((row) => (
                <tr key={row.id || `${row.competencia}-${row.filtros_hash}`}>
                  <td><strong>{row.nome_competencia || row.competencia}</strong></td>
                  <td>{fmtN(row.total_ctes)}</td>
                  <td>{fmt(row.valor_total_cte)}</td>
                  <td>{fmt(row.valor_total_nf)}</td>
                  <td>{fmtPct(row.percentual_frete_nf)}</td>
                  <td>{fmtN(row.peso_total)} kg</td>
                  <td>{fmt(row.ticket_medio_cte)}</td>
                  <td>{fmtN(row.total_transportadoras)}</td>
                  <td>{fmtN(row.total_rotas)}</td>
                  <td>{fmtN(row.total_com_calculo)}</td>
                  <td>{fmtN(row.total_sem_calculo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ExpandCard>

      <div className="panel-card">
        <div className="panel-title">Filtros</div>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
          <div className="field">
            <label>Transportadora</label>
            <input
              value={filtros.transportadoraRealizada}
              onChange={(e) => set('transportadoraRealizada', e.target.value)}
              placeholder="Nome parcial"
            />
          </div>

          <div className="field">
            <label>Origem (cidade)</label>
            <input value={filtros.origem} onChange={(e) => set('origem', e.target.value)} placeholder="Ex.: Itajaí" />
          </div>

          <div className="field">
            <label>Destino (cidade)</label>
            <input value={filtros.destino} onChange={(e) => set('destino', e.target.value)} placeholder="Ex.: São Paulo" />
          </div>

          <div className="field">
            <label>Canal</label>
            <select value={filtros.canal} onChange={(e) => set('canal', e.target.value)}>
              <option value="">Todos</option>
              {CANAIS_OPERACIONAIS.map((canal) => <option key={canal} value={canal}>{canal}</option>)}
            </select>
          </div>

          <div className="field">
            <label>UF Origem</label>
            <select value={filtros.ufOrigem} onChange={(e) => set('ufOrigem', e.target.value)}>
              {UF_OPTIONS.map((uf) => (
                <option key={uf} value={uf}>{uf || 'Todas'}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>UF Destino</label>
            <select value={filtros.ufDestino} onChange={(e) => set('ufDestino', e.target.value)}>
              {UF_OPTIONS.map((uf) => (
                <option key={uf} value={uf}>{uf || 'Todas'}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Emissão início</label>
            <input type="date" value={filtros.inicio} onChange={(e) => set('inicio', e.target.value)} />
          </div>

          <div className="field">
            <label>Emissão fim</label>
            <input type="date" value={filtros.fim} onChange={(e) => set('fim', e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn-primary" type="button" onClick={() => buscar(1, filtros)} disabled={carregando || carregandoAnalise}>
            {carregando || carregandoAnalise ? 'Buscando...' : 'Buscar CT-es'}
          </button>
          <button
            className="btn-secondary"
            type="button"
            onClick={() => {
              const limpo = {
                transportadoraRealizada: '',
                origem: '',
                destino: '',
                ufOrigem: '',
                ufDestino: '',
                inicio: '',
                fim: '',
                canal: '',
              };
              setFiltros(limpo);
              setRows(null);
              setRowsAnalise([]);
              setErro('');
              setFeedback('');
              setPagina(1);
              setTemProximaPagina(false);
              setUltimaBuscaTemFiltro(false);
              limparFiltrosInterativos();
            }}
            disabled={carregando || carregandoAnalise}
          >
            Limpar filtros
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={ocultarEbazar}
              onChange={(e) => setOcultarEbazar(e.target.checked)}
              style={{ width: 15, height: 15 }}
            />
            Ocultar EBAZAR
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={incluirCpsLog}
              onChange={(e) => setIncluirCpsLog(e.target.checked)}
              style={{ width: 15, height: 15 }}
            />
            Incluir CPS LOG
          </label>
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>
            Base padrão: tomadores {TOMADORES_PERMITIDOS.join(', ')}, sem EBAZAR e sem CPS LOG. Marque CPS LOG somente quando quiser analisar esse operador.
          </span>
        </div>
      </div>

      {!rows && !erro && (
        <div className="hint-box">
          Informe um filtro para começar. Exemplo: transportadora TEX, mês de abril, origem Itajaí ou canal B2C. Isso evita carregar toda a base de CT-es de uma vez e travar o Supabase.
        </div>
      )}

      {(carregando || carregandoAnalise) && !rows && (
        <div className="panel-card" style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>
          Buscando no Supabase...
        </div>
      )}

      {rows && ultimaBuscaTemFiltro && (
        <>
          <div className="panel-card" style={{ marginBottom: 12 }}>
            <div className="section-row compact-top">
              <div>
                <div className="panel-title">Filtros interativos</div>
                <p className="compact">Clique nos rankings, rotas, canais ou status para recalcular o painel em memória.</p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn-primary" onClick={abrirSalvarCompetencia} disabled={carregandoAnalise || !analiseSnapshot.totalCtes}>
                  Salvar competência
                </button>
                <button type="button" className="btn-secondary" onClick={limparFiltrosInterativos} disabled={!filtrosAtivos.length}>
                  Limpar filtros interativos
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>Filtros aplicados:</span>
              {!filtrosAtivos.length && <span className="status-pill">Nenhum</span>}
              {filtrosAtivos.map(([tipo, valor]) => (
                <button
                  key={tipo}
                  type="button"
                  className="status-pill dark"
                  onClick={() => removerFiltroInterativo(tipo)}
                  title={`Remover filtro ${LABEL_FILTROS_INTERATIVOS[tipo] || tipo}`}
                  style={{ cursor: 'pointer', border: 'none' }}
                >
                  {LABEL_FILTROS_INTERATIVOS[tipo] || tipo}: {labelValorFiltroInterativo(tipo, valor)} ×
                </button>
              ))}
            </div>
          </div>

          <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
            <SummaryCard title="CT-es analisados" value={fmtN(analise.totalCtes)} subtitle="base completa conforme filtros" />
            <SummaryCard title="Com cálculo" value={fmtN(analise.comCalculo)} subtitle={`${fmtPct(analise.totalCtes > 0 ? (analise.comCalculo / analise.totalCtes) * 100 : 0)} da base`} onClick={() => toggleInteractiveFilter('statusCalculo', 'com_calculo')} active={interactiveFilters.statusCalculo === 'com_calculo'} />
            <SummaryCard title="Sem cálculo" value={fmtN(Math.max(analise.totalCtes - analise.comCalculo, 0))} subtitle="CT-es sem valor calculado" onClick={() => toggleInteractiveFilter('statusCalculo', 'sem_calculo')} active={interactiveFilters.statusCalculo === 'sem_calculo'} />
            <SummaryCard title="Valor total CT-e" value={fmt(analise.totalCte)} subtitle={carregandoAnalise ? 'calculando análise...' : 'base filtrada'} />
            <SummaryCard title="Valor calculado" value={fmt(analise.totalCalculado)} subtitle="campo valor_calculado" />
            <SummaryCard title="Diferença" value={fmt(analise.totalDiferenca)} subtitle="CT-e - calculado" />
            <SummaryCard title="Frete sobre NF" value={fmtPct(analise.percentualFrete)} subtitle={`${fmt(analise.totalNf)} em NF`} />
            <SummaryCard title="Transportadoras" value={fmtN(analise.transportadoras.length)} subtitle="distintas" />
            <SummaryCard title="Rotas" value={fmtN(analise.rotasUnicas)} subtitle="origem + destino + tipo" />
          </div>

          {carregandoAnalise && (
            <div className="sim-alert info">
              Montando painel de gestão com os CT-es filtrados...
              {progressoAnalise ? ` ${fmtN(progressoAnalise.carregados)}${totalProgressoAnalise !== null ? ` de ${fmtN(totalProgressoAnalise)}` : ''} carregados para análise.` : ''}
            </div>
          )}

          <PainelGestaoTransportador analise={analise} filtros={filtros} interactiveFilters={interactiveFilters} onToggleFiltro={toggleInteractiveFilter} />

          <div className="table-card">
            <div className="section-row compact-top" style={{ padding: '16px 18px 0' }}>
              <div>
                <div className="panel-title">CT-es filtrados</div>
                <p className="compact">
                  Exibindo {fmtN(inicioExibicao)} a {fmtN(fimExibicao)} de {fmtN(rowsAnaliseInterativas.length)}. Página {fmtN(pagina)} de {fmtN(totalPaginasTabela)}.
                  {ocultarEbazar && <span style={{ marginLeft: 8, color: 'var(--muted)' }}>EBAZAR ocultado.</span>}
                    {!incluirCpsLog && <span style={{ marginLeft: 8, color: 'var(--muted)' }}>CPS LOG ocultado.</span>}
                    {totalVinculosAplicados > 0 && <span style={{ marginLeft: 8, color: 'var(--muted)' }}>{fmtN(totalVinculosAplicados)} nome(s) padronizado(s) por vínculo.</span>}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn-secondary" disabled={pagina <= 1 || carregando} onClick={() => trocarPagina(1)}>
                  Primeira
                </button>
                <button type="button" className="btn-secondary" disabled={pagina <= 1 || carregando} onClick={() => trocarPagina(pagina - 1)}>
                  Anterior
                </button>
                <button type="button" className="btn-secondary" disabled={!temProximaTabela || carregando} onClick={() => trocarPagina(pagina + 1)}>
                  Próxima
                </button>
              </div>
            </div>

            <div style={{ overflowX: 'auto', padding: '12px 18px 18px' }}>
              <table className="sim-analise-tabela">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Competência</th>
                    <th>Transportadora</th>
                    <th>Tomador</th>
                    <th>Origem</th>
                    <th>Destino</th>
                    <th>Nº CT-e</th>
                    <th>Valor CT-e</th>
                    <th>Valor calculado</th>
                    <th>Diferença</th>
                    <th>Valor NF</th>
                    <th>% Frete</th>
                    <th>Peso</th>
                    <th>Volumes</th>
                    <th>Canal</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {(!rowsFiltradas || rowsFiltradas.length === 0) && (
                    <tr>
                      <td colSpan={16} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>
                        Nenhum CT-e encontrado. Ajuste os filtros.
                      </td>
                    </tr>
                  )}

                  {(rowsFiltradas || []).map((row, idx) => {
                    const dataEmissao = getDataEmissao(row);
                    const transp = getTransportadora(row);
                    const transpOriginal = getTransportadoraOriginal(row);
                    const transpVinculada = transp && transpOriginal && transp !== transpOriginal;
                    const tomador = getTomador(row);
                    const cidOrig = getOrigem(row);
                    const ufOrig = getUfOrigem(row);
                    const cidDest = getDestino(row);
                    const ufDest = getUfDestino(row);
                    const nroCte = getNumeroCte(row);
                    const valCte = getValorCte(row);
                    const valCalc = getValorCalculado(row);
                    const diferenca = getDiferenca(row);
                    const valNf = getValorNf(row);
                    const percentual = valNf > 0 ? (valCte / valNf) * 100 : 0;
                    const canal = getCanal(row);
                    const situacao = getSituacao(row);
                    const competencia = getCompetencia(row);
                    const peso = getPeso(row);
                    const volumes = getVolumes(row);

                    return (
                      <tr key={row.id || row.chave_cte || `${nroCte}-${idx}`}>
                        <td>{fmtDate(dataEmissao)}</td>
                        <td>{competencia ? fmtMes(competencia) : '-'}</td>
                        <td
                          onClick={() => transp && toggleInteractiveFilter('transportadora', transp || 'Não informado')}
                          title="Clique para filtrar por esta transportadora"
                          style={{ cursor: transp ? 'pointer' : undefined, color: interactiveFilters.transportadora === transp ? '#185FA5' : undefined, fontWeight: interactiveFilters.transportadora === transp ? 800 : undefined }}
                        >
                          <strong>{transp || '-'}</strong>
                          {transpVinculada && (
                            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }} title={`Nome original no CT-e: ${transpOriginal}`}>
                              CT-e: {transpOriginal}
                            </div>
                          )}
                        </td>
                        <td style={{ fontSize: 12 }}>{tomador}</td>
                        <td
                          onClick={() => toggleInteractiveFilter('origem', getOrigemLabel(row))}
                          title="Clique para filtrar por esta origem"
                          style={{ cursor: 'pointer', color: interactiveFilters.origem === getOrigemLabel(row) ? '#185FA5' : undefined, fontWeight: interactiveFilters.origem === getOrigemLabel(row) ? 800 : undefined }}
                        >{cidOrig ? `${cidOrig}${ufOrig ? `/${ufOrig}` : ''}` : ufOrig || '-'}</td>
                        <td
                          onClick={() => toggleInteractiveFilter('destino', getDestinoLabel(row))}
                          title="Clique para filtrar por este destino"
                          style={{ cursor: 'pointer', color: interactiveFilters.destino === getDestinoLabel(row) ? '#185FA5' : undefined, fontWeight: interactiveFilters.destino === getDestinoLabel(row) ? 800 : undefined }}
                        >{cidDest ? `${cidDest}${ufDest ? `/${ufDest}` : ''}` : ufDest || '-'}</td>
                        <td>{nroCte || '-'}</td>
                        <td>{fmt(valCte)}</td>
                        <td>{valCalc > 0 ? fmt(valCalc) : '-'}</td>
                        <td style={{ color: Math.abs(diferenca) > 0.05 ? '#D85A30' : 'inherit', fontWeight: Math.abs(diferenca) > 0.05 ? 700 : 400 }}>
                          {valCalc > 0 ? fmt(diferenca) : '-'}
                        </td>
                        <td>{fmt(valNf)}</td>
                        <td>{valNf > 0 ? fmtPct(percentual) : '-'}</td>
                        <td>{peso ? `${fmtN(peso)} kg` : '-'}</td>
                        <td>{volumes ? fmtN(volumes) : '-'}</td>
                        <td onClick={() => toggleInteractiveFilter('canal', canal || 'Não informado')} title="Clique para filtrar por este canal" style={{ cursor: 'pointer' }}>
                          <span
                            className={`coverage-badge ${canal === CANAL_A_DEFINIR ? 'warn' : canal === 'ATACADO' ? '' : 'ok'}`}
                            title={canal === CANAL_A_DEFINIR ? `Canal original: ${campo(row, 'canal_original', 'canalOriginal', 'canal_vendas', 'canalVendas') || '-'}` : ''}
                          >
                            {canal || '-'}
                          </span>
                        </td>
                        <td>
                          <span className={`coverage-badge ${normalizarTexto(situacao).includes('AUTORIZ') ? 'ok' : 'warn'}`}>
                            {situacao || '-'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="hint-box">
            Próximo passo do simulador: usar esses mesmos filtros do CT-e para alimentar a simulação do realizado, comparar contra a tabela selecionada e gerar relatório rota a rota com sugestão de redução por maior volumetria.
          </div>
        </>
      )}
    </div>
  );
}
