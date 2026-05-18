import { useMemo, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { parseRealizadoCtesFile } from '../utils/realizadoCtes';
import {
  importarRealizadoMensalEnxuto,
  listarPendenciasIbgeRealizadoMensal,
  verificarCompetenciaRealizadoMensal,
} from '../services/realizadoMensalService';

const UF_OPTIONS = ['', 'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
const TABELA = 'realizado_local_ctes';
const PAGE_SIZE = 50;
const ANALISE_BATCH_SIZE = 300;
const ANALISE_MAX_REGISTROS = 5000;

const TOMADORES_PERMITIDOS = ['CPX', 'ITR', 'GRIP', 'GP PNEUS', 'SPEEDMAX'];

const CANAL_VENDAS_MAP = {
  B2C: 'B2C',
  B2B: 'ATACADO',
  'MERCADO LIVRE': 'B2C',
  SHOPEE: 'B2C',
  'MAGAZINE LUIZA': 'B2C',
  AMAZON: 'B2C',
  'VIA VAREJO': 'B2C',
  CARREFOUR: 'B2C',
  LIVELO: 'B2C',
  'CANTU PNEUS': 'B2C',
  PITSTOP: 'B2C',
  INTER: 'B2C',
  ITAU: 'B2C',
  'ITAU SHOP': 'B2C',
  '99': 'B2C',
  COOPERA: 'B2C',
  'BRADESCO SHOP': 'B2C',
  MUSTANG: 'B2C',
};

const MARCADORES_ATACADO = ['AT-AG', 'AT-TR', 'ECM-B2B', 'ECC-SALES', 'ECA-SALES'];

function monthNow() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function normalizarCanalRow(row) {
  const canalVendas = String(row?.canal_vendas || row?.canalVendas || '').trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (canalVendas) {
    const mapped = CANAL_VENDAS_MAP[canalVendas];
    if (mapped) return mapped;
  }

  const marcadores = String(row?.marcadores || row?.marcador || '').trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (marcadores) {
    const ehAtacado = MARCADORES_ATACADO.some((tok) => marcadores.includes(tok));
    if (ehAtacado) return 'ATACADO';
    if (marcadores.length > 0) return 'B2C';
  }

  const docDest = String(row?.documento_destinatario || row?.documentoDestinatario || '').trim();
  if (!docDest) return 'B2C';

  const canalLegado = String(row?.canal || '').trim().toUpperCase();
  return canalLegado || 'B2C';
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
  return normalizarCanalRow(row) || campo(row, 'canal', 'canal_vendas', 'canais') || '';
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
  return [getOrigem(row), getUfOrigem(row), getDestino(row), getUfDestino(row), getTipoVeiculo(row)]
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

function getRegiaoPorUf(uf) {
  const u = String(uf || '').toUpperCase();
  if (['AC', 'AP', 'AM', 'PA', 'RO', 'RR', 'TO'].includes(u)) return 'Norte';
  if (['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'PR', 'RN', 'SE'].includes(u)) return 'Nordeste';
  if (['DF', 'GO', 'MT', 'MS'].includes(u)) return 'Centro-Oeste';
  if (['ES', 'MG', 'RJ', 'SP'].includes(u)) return 'Sudeste';
  if (['PR', 'RS', 'SC'].includes(u)) return 'Sul';
  return 'Não informado';
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
  if (filtros.canal) query = query.eq('canal', filtros.canal);
  if (filtros.transportadoraRealizada) query = query.ilike('transportadora', `%${filtros.transportadoraRealizada}%`);
  if (filtros.origem) query = query.ilike('cidade_origem', `${filtros.origem}%`);
  if (filtros.destino) query = query.ilike('cidade_destino', `${filtros.destino}%`);
  if (filtros.inicio) query = query.gte('data_emissao', filtros.inicio);
  if (filtros.fim) query = query.lte('data_emissao', filtros.fim);
  return query;
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

  const linhas = data || [];

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

  for (let inicio = 0; inicio < ANALISE_MAX_REGISTROS; inicio += ANALISE_BATCH_SIZE) {
    const fim = Math.min(inicio + ANALISE_BATCH_SIZE - 1, ANALISE_MAX_REGISTROS - 1);

    const resposta = await executarQuerySupabaseComRetry(async () => {
      let query = supabase
        .from(TABELA)
        .select('*')
        .order('data_emissao', { ascending: false, nullsFirst: false })
        .range(inicio, fim);

      query = aplicarFiltros(query, filtros);
      return query;
    }, `Erro Supabase (${TABELA}) ao montar análise de CT-es`);

    const { data, error } = resposta || {};
    if (error) throw new Error(`Erro Supabase (${TABELA}): ${error.message}`);

    const lote = data || [];
    acumulado.push(...lote);
    onProgress?.({ carregados: acumulado.length, limite: ANALISE_MAX_REGISTROS });

    if (lote.length < ANALISE_BATCH_SIZE) break;
  }

  return acumulado;
}

function SummaryCard({ title, value, subtitle, tone }) {
  return (
    <div className="summary-card">
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

function RankingTabela({ titulo, linhas, tipo = 'valor', maxLinhas = 10 }) {
  const ordenadas = [...(linhas || [])].sort((a, b) => b.valorCte - a.valorCte).slice(0, maxLinhas);
  const maximo = ordenadas[0]?.valorCte || 1;

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
              <tr key={item.key}>
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

function PainelGestaoTransportador({ analise, filtros }) {
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
        <RankingTabela titulo="Transportadoras no filtro" linhas={analise.transportadoras} />
        <RankingTabela titulo="Regiões de destino" linhas={analise.regioesDestino} />
      </div>

      <div className="feature-grid import-grid" style={{ marginBottom: 14 }}>
        <RankingTabela titulo="Origens mais relevantes" linhas={analise.origens} />
        <RankingTabela titulo="Destinos mais relevantes" linhas={analise.destinos} />
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
                  <tr key={rota.key}>
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
    rotas,
    rotasUnicas: rotas.length,
  };
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
  const [rows, setRows] = useState(null);
  const [rowsAnalise, setRowsAnalise] = useState([]);
  const [pagina, setPagina] = useState(1);
  const [temProximaPagina, setTemProximaPagina] = useState(false);
  const [ultimaBuscaTemFiltro, setUltimaBuscaTemFiltro] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [carregandoAnalise, setCarregandoAnalise] = useState(false);
  const [progressoAnalise, setProgressoAnalise] = useState(null);
  const [erro, setErro] = useState('');
  const [feedback, setFeedback] = useState('');

  const podeImportar = Boolean(competenciaUpload && arquivoUpload && !importando);

  const set = (nomeCampo, valor) => {
    setFiltros((prev) => ({ ...prev, [nomeCampo]: valor }));
  };

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
    setCarregando(true);
    setErro('');

    try {
      const paginaResposta = await buscarCtesPagina(filtros, paginaSegura);
      setRows(paginaResposta.data);
      setTemProximaPagina(paginaResposta.hasNext);
      setPagina(paginaResposta.pagina);
    } catch (error) {
      setErro(error.message || String(error));
    } finally {
      setCarregando(false);
    }
  };

  const analise = useMemo(
    () => {
      const base = ocultarEbazar
        ? (rowsAnalise || []).filter((r) => !normalizarTexto(getTransportadora(r)).includes('EBAZAR'))
        : rowsAnalise;
      return montarAnalise(base, filtros);
    },
    [rowsAnalise, filtros, ocultarEbazar]
  );

  const rowsFiltradas = useMemo(() => {
    if (!rows) return null;
    return ocultarEbazar
      ? rows.filter((r) => !normalizarTexto(getTransportadora(r)).includes('EBAZAR'))
      : rows;
  }, [rows, ocultarEbazar]);

  const avisoAnaliseLimitada = rowsAnalise.length >= ANALISE_MAX_REGISTROS;
  const inicioExibicao = rowsFiltradas ? (pagina - 1) * PAGE_SIZE + 1 : 0;
  const fimExibicao = rowsFiltradas ? inicioExibicao + rowsFiltradas.length - 1 : 0;

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
              <option value="ATACADO">ATACADO</option>
              <option value="B2C">B2C</option>
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
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>
            Base filtrada por tomadores: {TOMADORES_PERMITIDOS.join(', ')}. A busca só roda com pelo menos um filtro.
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
          <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
            <SummaryCard title="CT-es analisados" value={fmtN(analise.totalCtes)} subtitle={avisoAnaliseLimitada ? `limitado a ${fmtN(ANALISE_MAX_REGISTROS)}` : 'conforme filtros'} />
            <SummaryCard title="Com cálculo" value={fmtN(analise.comCalculo)} subtitle={`${fmtPct(analise.totalCtes > 0 ? (analise.comCalculo / analise.totalCtes) * 100 : 0)} da base`} />
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
              {progressoAnalise ? ` ${fmtN(progressoAnalise.carregados)} de até ${fmtN(progressoAnalise.limite)} carregados para análise.` : ''}
            </div>
          )}

          {avisoAnaliseLimitada && (
            <div className="sim-alert info">
              O dossiê foi limitado aos primeiros {fmtN(ANALISE_MAX_REGISTROS)} registros filtrados para manter a tela rápida. Refine por mês, origem, transportadora ou canal para uma análise mais exata.
            </div>
          )}

          <PainelGestaoTransportador analise={analise} filtros={filtros} />

          <div className="table-card">
            <div className="section-row compact-top" style={{ padding: '16px 18px 0' }}>
              <div>
                <div className="panel-title">CT-es filtrados</div>
                <p className="compact">
                  Exibindo {fmtN(inicioExibicao)} a {fmtN(fimExibicao)}. Página {fmtN(pagina)}{temProximaPagina ? ' · há mais registros' : ''}.
                  {ocultarEbazar && <span style={{ marginLeft: 8, color: 'var(--muted)' }}>EBAZAR ocultado.</span>}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn-secondary" disabled={pagina <= 1 || carregando} onClick={() => trocarPagina(1)}>
                  Primeira
                </button>
                <button type="button" className="btn-secondary" disabled={pagina <= 1 || carregando} onClick={() => trocarPagina(pagina - 1)}>
                  Anterior
                </button>
                <button type="button" className="btn-secondary" disabled={!temProximaPagina || carregando} onClick={() => trocarPagina(pagina + 1)}>
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
                        <td><strong>{transp || '-'}</strong></td>
                        <td style={{ fontSize: 12 }}>{tomador}</td>
                        <td>{cidOrig ? `${cidOrig}${ufOrig ? `/${ufOrig}` : ''}` : ufOrig || '-'}</td>
                        <td>{cidDest ? `${cidDest}${ufDest ? `/${ufDest}` : ''}` : ufDest || '-'}</td>
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
                        <td>
                          <span className={`coverage-badge ${canal === 'ATACADO' ? '' : 'ok'}`}>
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
