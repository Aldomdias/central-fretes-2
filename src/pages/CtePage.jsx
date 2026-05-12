import { useMemo, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const UF_OPTIONS = ['', 'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
const TABELA = 'realizado_local_ctes';
const PAGE_SIZE = 100;
const ANALISE_BATCH_SIZE = 1000;
const ANALISE_MAX_REGISTROS = 20000;

// Tomadores permitidos – apenas esses ficam na base
const TOMADORES_PERMITIDOS = ['CPX', 'ITR', 'GP PNEUS', 'SPEEDMAX'];

// Mapeamento de Canal de Vendas → canal normalizado
const CANAL_VENDAS_MAP = {
  'B2C': 'B2C',
  'B2B': 'ATACADO',
  'MERCADO LIVRE': 'B2C',
  'SHOPEE': 'B2C',
  'MAGAZINE LUIZA': 'B2C',
  'AMAZON': 'B2C',
  'VIA VAREJO': 'B2C',
  'CARREFOUR': 'B2C',
  'LIVELO': 'B2C',
  'CANTU PNEUS': 'B2C',
  'PITSTOP': 'B2C',
  'INTER': 'B2C',
  'ITAU SHOP': 'B2C',
  '99': 'B2C',
  'COOPERA': 'B2C',
  'BRADESCO SHOP': 'B2C',
  'MUSTANG': 'B2C',
};

// Tokens que indicam canal ATACADO nos marcadores
const MARCADORES_ATACADO = ['AT-AG', 'AT-TR', 'ECM-B2B', 'ECC-SALES', 'ECA-SALES'];

function normalizarCanalRow(row) {
  // Prioridade 1 – Canal de Vendas
  const canalVendas = String(row?.canal_vendas || row?.canalVendas || '').trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (canalVendas) {
    const mapped = CANAL_VENDAS_MAP[canalVendas];
    if (mapped) return mapped;
  }

  // Prioridade 2 – Marcadores
  const marcadores = String(row?.marcadores || row?.marcador || '').trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (marcadores) {
    const ehAtacado = MARCADORES_ATACADO.some((tok) => marcadores.includes(tok));
    if (ehAtacado) return 'ATACADO';
    // Se tem marcador mas não é ATACADO → B2C
    if (marcadores.length > 0) return 'B2C';
  }

  // Prioridade 3 – Documento Destinatário (se em branco → B2C)
  const docDest = String(row?.documento_destinatario || row?.documentoDestinatario || '').trim();
  if (!docDest) return 'B2C';

  // Fallback: usa campo canal legado
  const canalLegado = String(row?.canal || '').trim().toUpperCase();
  return canalLegado || 'B2C';
}

function fmt(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtN(v) {
  return Number(v || 0).toLocaleString('pt-BR');
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
    .replace(/[̀-ͯ]/g, '')
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
  if (['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'].includes(u)) return 'Nordeste';
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

function aplicarFiltros(query, filtros = {}) {
  // Sempre filtra pelos tomadores permitidos
  query = query.or(TOMADORES_PERMITIDOS.map((t) => `tomador.ilike.%${t}%`).join(','));

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
  const fim = inicio + PAGE_SIZE;

  let query = supabase
    .from(TABELA)
    .select('*')
    .range(inicio, fim);

  query = aplicarFiltros(query, filtros);

  const { data, error } = await query;
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

    let query = supabase
      .from(TABELA)
      .select('*')
      .range(inicio, fim);

    query = aplicarFiltros(query, filtros);

    const { data, error } = await query;
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
  const totalNf = rows.reduce((a, r) => a + getValorNf(r), 0);
  const totalPeso = rows.reduce((a, r) => a + getPeso(r), 0);
  const totalVolumes = rows.reduce((a, r) => a + getVolumes(r), 0);
  const totalCtes = rows.length;
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
      valorNf: 0,
      peso: 0,
      volumes: 0,
      transportadoras: new Set(),
    };

    atual.ctes += 1;
    atual.valorCte += getValorCte(row);
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
    totalCte,
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

  const set = (nomeCampo, valor) => {
    setFiltros((prev) => ({ ...prev, [nomeCampo]: valor }));
  };

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

      const dadosAnalise = await buscarCtesParaAnalise(filtrosBusca, setProgressoAnalise);
      setRowsAnalise(dadosAnalise);
    } catch (error) {
      setErro(error.message || String(error));
      setRows(null);
      setRowsAnalise([]);
      setTemProximaPagina(false);
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

        {erro && (
          <div style={{ padding: '10px 14px', background: '#fff1f1', border: '1px solid #efc4c4', borderRadius: 10, color: '#9b2323', fontSize: 13 }}>
            {erro}
          </div>
        )}
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
            <SummaryCard title="Valor total CT-e" value={fmt(analise.totalCte)} subtitle={carregandoAnalise ? 'calculando análise...' : 'base filtrada'} />
            <SummaryCard title="Frete sobre NF" value={fmtPct(analise.percentualFrete)} subtitle={`${fmt(analise.totalNf)} em NF`} />
            <SummaryCard title="Transportadoras" value={fmtN(analise.transportadoras.length)} subtitle="distintas" />
            <SummaryCard title="Rotas" value={fmtN(analise.rotasUnicas)} subtitle="origem + destino + tipo" />
            <SummaryCard title="Cargas/dia" value={fmtN(analise.cargasDia)} subtitle={`${fmtN(analise.dias)} dias analisados`} />
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
                      <td colSpan={14} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>
                        Nenhum CT-e encontrado. Ajuste os filtros.
                      </td>
                    </tr>
                  )}

                  {(rowsFiltradas || []).map((row, idx) => {
                    const dataEmissao = getDataEmissao(row);
                    const transp = getTransportadora(row);
                    const tomador = campo(row, 'tomador') || '-';
                    const cidOrig = getOrigem(row);
                    const ufOrig = getUfOrigem(row);
                    const cidDest = getDestino(row);
                    const ufDest = getUfDestino(row);
                    const nroCte = getNumeroCte(row);
                    const valCte = getValorCte(row);
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
