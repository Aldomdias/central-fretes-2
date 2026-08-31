import { useEffect, useMemo, useRef, useState } from 'react';
import {
  listarAnosDisponiveis,
  listarCarteirasAtuais,
  listarHistoricoCarteirasTodas,
  listarLancamentosDescontosObtidos,
  listarResumoDescontosObtidos,
  obterUltimaAtualizacaoDescontosObtidos,
} from '../services/descontosObtidosService';
import { baixarLaudoDescontosObtidosHtml } from '../utils/laudoDescontosObtidosHtml';
import {
  aplicarVinculoTransportadora,
  carregarVinculosTransportadoras,
  criarMapaVinculosTransportadoras,
  salvarVinculosTransportadoras,
} from '../services/vinculosTransportadorasService';
import {
  baixarEmlOutlookDescontosObtidos,
  baixarHtmlEmailDescontosObtidos,
  copiarHtmlEmailDescontosObtidos,
  gerarDadosEmailDescontosObtidos,
  gerarHtmlEmailDescontosObtidos,
  gerarTextoSimplesEmailDescontosObtidos,
  nomeArquivoEmailDescontosObtidos,
} from '../services/descontosObtidosEmailService';

const NOMES_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// Paleta categórica validada (contraste + separação para daltonismo em todos
// os pares adjacentes) — usada só na aba "Ano a ano", onde várias séries
// aparecem lado a lado. Ordem fixa, nunca ciclada arbitrariamente.
const PALETA = {
  azul: '#2a78d6',
  laranja: '#eb6834',
  agua: '#1baf7a',
  amarelo: '#eda100',
  magenta: '#e87ba4',
  verde: '#008300',
  violeta: '#4a3aa7',
  vermelho: '#e34948',
};
const ORDEM_SERIE_ANO = [PALETA.azul, PALETA.laranja, PALETA.agua, PALETA.amarelo, PALETA.magenta, PALETA.verde, PALETA.violeta, PALETA.vermelho];
const TINTA_PRIMARIA = '#0b0b0b';
const TINTA_SECUNDARIA = '#52514e';
const TINTA_MUTED = '#898781';
const GRADE = '#e1e0d9';
const EIXO = '#c3c2b7';
const COR_BOA = '#006300';
const COR_RUIM = '#b45309';

function formatMoeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatMoedaCompacta(valor) {
  const abs = Math.abs(Number(valor || 0));
  if (abs >= 1_000_000) return `R$ ${(valor / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}M`;
  if (abs >= 1_000) return `R$ ${(valor / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}k`;
  return formatMoeda(valor);
}

function formatInt(valor) {
  return Number(valor || 0).toLocaleString('pt-BR');
}

function formatDataBr(iso) {
  if (!iso) return '—';
  const [ano, mes, dia] = String(iso).split('-');
  return `${dia}/${mes}/${ano}`;
}

function formatDataHoraBr(data) {
  if (!data) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(data));
}

function anoAtual() {
  return new Date().getFullYear();
}

function BarraHorizontal({ valor, maximo, cor = '#9153F0' }) {
  const largura = maximo ? Math.max(2, Math.round((valor / maximo) * 100)) : 0;
  return (
    <div style={{ height: 10, borderRadius: 999, background: 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${largura}%`, borderRadius: 999, background: cor, transition: 'width 180ms ease' }} />
    </div>
  );
}

function StatTile({ label, value, delta, deltaBom, sub }) {
  return (
    <div className="table-card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 13, color: TINTA_SECUNDARIA }}>{label}</span>
      <strong style={{ fontSize: 26, fontWeight: 600, color: TINTA_PRIMARIA, lineHeight: 1.15 }}>{value}</strong>
      {delta ? (
        <span style={{ fontSize: 13, fontWeight: 600, color: deltaBom ? COR_BOA : COR_RUIM }}>{delta}</span>
      ) : null}
      {sub ? <span style={{ fontSize: 12, color: TINTA_MUTED }}>{sub}</span> : null}
    </div>
  );
}

// Barra de anos: eixo com grade horizontal, barras com topo arredondado e
// largura travada em 64px (nunca esticam pra preencher o espaço), rótulo de
// valor no topo, tooltip on hover.
function GraficoBarraAnos({ dados }) {
  const largura = 720;
  const altura = 260;
  const margem = { top: 24, right: 16, bottom: 32, left: 16 };
  const areaLargura = largura - margem.left - margem.right;
  const areaAltura = altura - margem.top - margem.bottom;
  const maximo = Math.max(1, ...dados.map((d) => d.valor));
  const larguraBarra = Math.min(64, dados.length ? (areaLargura / dados.length) * 0.5 : 0);
  const [hover, setHover] = useState(null);

  const passosGrade = 4;
  const linhasGrade = Array.from({ length: passosGrade + 1 }, (_, i) => i / passosGrade);

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${largura} ${altura}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        {linhasGrade.map((fracao) => {
          const y = margem.top + areaAltura * (1 - fracao);
          return (
            <line key={fracao} x1={margem.left} x2={largura - margem.right} y1={y} y2={y} stroke={GRADE} strokeWidth={1} />
          );
        })}
        <line x1={margem.left} x2={largura - margem.right} y1={margem.top + areaAltura} y2={margem.top + areaAltura} stroke={EIXO} strokeWidth={1} />
        {dados.map((d, i) => {
          const alturaBarra = maximo ? (d.valor / maximo) * areaAltura : 0;
          const passo = areaLargura / dados.length;
          const x = margem.left + i * passo + (passo - larguraBarra) / 2;
          const y = margem.top + areaAltura - alturaBarra;
          const cor = ORDEM_SERIE_ANO[i % ORDEM_SERIE_ANO.length];
          const emHover = hover === i;
          return (
            <g
              key={d.ano}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: 'default' }}
            >
              <rect x={x - 6} y={margem.top} width={larguraBarra + 12} height={areaAltura} fill="transparent" />
              <rect x={x} y={y} width={larguraBarra} height={Math.max(1, alturaBarra)} rx={4} fill={cor} opacity={emHover ? 0.85 : 1} />
              <text x={x + larguraBarra / 2} y={y - 8} textAnchor="middle" fontSize="13" fontWeight="600" fill={TINTA_PRIMARIA}>
                {formatMoedaCompacta(d.valor)}
              </text>
              <text x={x + larguraBarra / 2} y={margem.top + areaAltura + 20} textAnchor="middle" fontSize="12" fill={TINTA_SECUNDARIA}>
                {d.ano}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null ? (
        <div
          style={{
            position: 'absolute',
            top: 4,
            left: `${((hover + 0.5) / dados.length) * 100}%`,
            transform: 'translateX(-50%)',
            background: '#fff',
            border: '1px solid rgba(11,11,11,0.10)',
            borderRadius: 8,
            padding: '6px 10px',
            fontSize: 12,
            boxShadow: '0 4px 14px rgba(0,0,0,0.10)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          <strong style={{ color: TINTA_PRIMARIA }}>{formatMoeda(dados[hover].valor)}</strong>
          <span style={{ color: TINTA_SECUNDARIA }}> — {dados[hover].ano}</span>
        </div>
      ) : null}
    </div>
  );
}

// Linhas mês a mês: grade horizontal, marcadores com anel na cor da
// superfície, legenda com "line-key" (traço colorido + texto neutro, nunca
// texto colorido), crosshair com tooltip listando todas as séries no mês.
function GraficoLinhaMeses({ series }) {
  const largura = 720;
  const altura = 280;
  const margem = { top: 16, right: 16, bottom: 28, left: 16 };
  const areaLargura = largura - margem.left - margem.right;
  const areaAltura = altura - margem.top - margem.bottom;
  const maximo = Math.max(1, ...series.flatMap((s) => s.valores.map((v) => v.valor)));
  const passoX = areaLargura / 11;
  const [hoverMes, setHoverMes] = useState(null);
  const cores = useMemo(() => series.map((_, i) => ORDEM_SERIE_ANO[i % ORDEM_SERIE_ANO.length]), [series]);

  function pontoParaXY(indiceMes, valor) {
    const x = margem.left + indiceMes * passoX;
    const y = margem.top + areaAltura - (valor / maximo) * areaAltura;
    return [x, y];
  }

  // Meses sem nenhum lançamento importado ainda (não é "desconto zero", é
  // "não sabemos"). Conectar a 0 mostraria uma queda abrupta enganosa assim
  // que a importação parasse naquele ano — em vez disso a linha quebra em
  // segmentos, um por trecho contínuo de meses com dado.
  function segmentos(valores) {
    const grupos = [];
    let atual = [];
    valores.forEach((v) => {
      if (v.presente) atual.push(v);
      else if (atual.length) { grupos.push(atual); atual = []; }
    });
    if (atual.length) grupos.push(atual);
    return grupos.map((grupo) => grupo.map((v) => pontoParaXY(v.mes - 1, v.valor).join(',')).join(' '));
  }

  const passosGrade = 4;
  const linhasGrade = Array.from({ length: passosGrade + 1 }, (_, i) => i / passosGrade);

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
        {series.map((s, i) => (
          <span key={s.ano} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: TINTA_SECUNDARIA }}>
            <svg width="14" height="6"><line x1="0" y1="3" x2="14" y2="3" stroke={cores[i]} strokeWidth="2.5" /></svg>
            {s.ano}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${largura} ${altura}`}
        style={{ width: '100%', height: 'auto', overflow: 'visible' }}
        onMouseMove={(event) => {
          const svgEl = event.currentTarget;
          const pt = svgEl.createSVGPoint();
          pt.x = event.clientX;
          const ctm = svgEl.getScreenCTM();
          if (!ctm) return;
          const local = pt.matrixTransform(ctm.inverse());
          const indice = Math.round((local.x - margem.left) / passoX);
          setHoverMes(Math.max(0, Math.min(11, indice)));
        }}
        onMouseLeave={() => setHoverMes(null)}
      >
        {linhasGrade.map((fracao) => {
          const y = margem.top + areaAltura * (1 - fracao);
          return <line key={fracao} x1={margem.left} x2={largura - margem.right} y1={y} y2={y} stroke={GRADE} strokeWidth={1} />;
        })}
        <line x1={margem.left} x2={largura - margem.right} y1={margem.top + areaAltura} y2={margem.top + areaAltura} stroke={EIXO} strokeWidth={1} />
        {NOMES_MES.map((nome, i) => {
          const [x] = pontoParaXY(i, 0);
          return (
            <text key={nome} x={x} y={margem.top + areaAltura + 18} textAnchor="middle" fontSize="11" fill={TINTA_SECUNDARIA}>
              {nome}
            </text>
          );
        })}
        {hoverMes !== null ? (
          <line x1={pontoParaXY(hoverMes, 0)[0]} x2={pontoParaXY(hoverMes, 0)[0]} y1={margem.top} y2={margem.top + areaAltura} stroke={EIXO} strokeWidth={1} strokeDasharray="3,3" />
        ) : null}
        {series.map((s, si) => {
          const cor = cores[si];
          const presentesMes = s.valores.filter((v) => v.presente);
          const ultimo = presentesMes[presentesMes.length - 1];
          return (
            <g key={s.ano}>
              {segmentos(s.valores).map((pontos, gi) => (
                <polyline key={gi} points={pontos} fill="none" stroke={cor} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {presentesMes.map((v) => {
                const [x, y] = pontoParaXY(v.mes - 1, v.valor);
                return <circle key={v.mes} cx={x} cy={y} r={4} fill={cor} stroke="#fcfcfb" strokeWidth={2} />;
              })}
              {ultimo ? (
                <text
                  x={pontoParaXY(ultimo.mes - 1, ultimo.valor)[0] + 8}
                  y={pontoParaXY(ultimo.mes - 1, ultimo.valor)[1] + 4}
                  fontSize="11"
                  fontWeight="600"
                  fill={TINTA_PRIMARIA}
                >
                  {formatMoedaCompacta(ultimo.valor)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {hoverMes !== null ? (
        <div
          style={{
            position: 'absolute',
            top: 4,
            left: `${((hoverMes + 0.5) / 12) * 100}%`,
            transform: hoverMes > 8 ? 'translateX(-100%)' : 'translateX(0)',
            background: '#fff',
            border: '1px solid rgba(11,11,11,0.10)',
            borderRadius: 8,
            padding: '8px 10px',
            fontSize: 12,
            boxShadow: '0 4px 14px rgba(0,0,0,0.10)',
            pointerEvents: 'none',
            minWidth: 140,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4, color: TINTA_PRIMARIA }}>{NOMES_MES[hoverMes]}</div>
          {series.map((s, si) => {
            const v = s.valores[hoverMes];
            if (!v?.presente) return null;
            return (
              <div key={s.ano} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: TINTA_SECUNDARIA }}>
                  <svg width="10" height="4"><line x1="0" y1="2" x2="10" y2="2" stroke={cores[si]} strokeWidth="2.5" /></svg>
                  {s.ano}
                </span>
                <strong style={{ color: TINTA_PRIMARIA }}>{formatMoeda(v.valor)}</strong>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// Barra empilhada horizontal única mostrando a proveniência dos lançamentos
// (qual regra contábil originou cada real de desconto) — dá contexto de
// auditoria sem precisar abrir os lançamentos individuais.
function CardDistribuicaoRegra({ linhas }) {
  const totais = useMemo(() => {
    const mapa = { desc_fin_obtidos: 0, fretes_carretos: 0 };
    linhas.forEach((l) => { mapa[l.regra_aplicada] = (mapa[l.regra_aplicada] || 0) + Number(l.valor || 0); });
    return mapa;
  }, [linhas]);

  const total = totais.desc_fin_obtidos + totais.fretes_carretos;
  const pctDesc = total ? (totais.desc_fin_obtidos / total) * 100 : 0;
  const pctFretes = total ? (totais.fretes_carretos / total) * 100 : 0;

  return (
    <section className="table-card">
      <div className="sim-parametros-header">
        <div>
          <div className="panel-title">De onde vêm os lançamentos</div>
          <p>Proveniência contábil dos descontos, conforme a regra do SAP aplicada em cada linha.</p>
        </div>
      </div>
      <div style={{ display: 'flex', height: 14, borderRadius: 999, overflow: 'hidden', gap: 2, marginTop: 8 }}>
        <div style={{ width: `${pctDesc}%`, background: PALETA.violeta, minWidth: pctDesc ? 4 : 0 }} title="Desc. Fin. Obtidos" />
        <div style={{ width: `${pctFretes}%`, background: PALETA.agua, minWidth: pctFretes ? 4 : 0 }} title="Fretes e Carretos" />
      </div>
      <div style={{ display: 'flex', gap: 24, marginTop: 12, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: TINTA_SECUNDARIA }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: PALETA.violeta, display: 'inline-block' }} />
          Desc. Fin. Obtidos (41301002) — <strong style={{ color: TINTA_PRIMARIA }}>{formatMoeda(totais.desc_fin_obtidos)}</strong>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: TINTA_SECUNDARIA }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: PALETA.agua, display: 'inline-block' }} />
          Fretes e Carretos (32208005) — <strong style={{ color: TINTA_PRIMARIA }}>{formatMoeda(totais.fretes_carretos)}</strong>
        </span>
      </div>
    </section>
  );
}

function AbaAnoAno() {
  const [linhas, setLinhas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState(null);

  useEffect(() => {
    let cancelado = false;
    async function carregar() {
      setCarregando(true);
      setErro('');
      try {
        const dados = await listarResumoDescontosObtidos({});
        if (!cancelado) setLinhas(dados);
      } catch (error) {
        if (!cancelado) setErro(error.message || 'Erro ao carregar descontos obtidos.');
      } finally {
        if (!cancelado) setCarregando(false);
      }
    }
    carregar();
    return () => { cancelado = true; };
  }, []);

  const anos = useMemo(
    () => Array.from(new Set(linhas.map((l) => l.ano))).sort((a, b) => a - b),
    [linhas]
  );

  const totalPorAno = useMemo(() => {
    const mapa = new Map();
    anos.forEach((a) => mapa.set(a, 0));
    linhas.forEach((l) => mapa.set(l.ano, (mapa.get(l.ano) || 0) + Number(l.valor || 0)));
    return anos.map((ano) => ({ ano, valor: mapa.get(ano) || 0 }));
  }, [linhas, anos]);

  const seriesPorMes = useMemo(() => {
    return anos.map((ano) => {
      const mapa = new Map();
      for (let m = 1; m <= 12; m += 1) mapa.set(m, 0);
      const presentes = new Set();
      linhas.filter((l) => l.ano === ano).forEach((l) => {
        mapa.set(l.mes, (mapa.get(l.mes) || 0) + Number(l.valor || 0));
        presentes.add(l.mes);
      });
      return {
        ano,
        valores: Array.from(mapa.entries()).map(([mes, valor]) => ({ mes, valor, presente: presentes.has(mes) })),
      };
    });
  }, [linhas, anos]);

  const pivotTransportadora = useMemo(() => {
    const mapa = new Map();
    linhas.forEach((l) => {
      const chave = l.transportadora_nome || 'Não identificado';
      if (!mapa.has(chave)) mapa.set(chave, { nome: chave, total: 0, porAno: {} });
      const entrada = mapa.get(chave);
      entrada.total += Number(l.valor || 0);
      entrada.porAno[l.ano] = (entrada.porAno[l.ano] || 0) + Number(l.valor || 0);
    });
    return Array.from(mapa.values()).sort((a, b) => b.total - a.total).slice(0, 20);
  }, [linhas]);

  const anoRecente = anos[anos.length - 1];
  const anoAnterior = anos[anos.length - 2];
  const totalAnoRecente = totalPorAno.find((d) => d.ano === anoRecente)?.valor || 0;
  const totalAnoAnterior = totalPorAno.find((d) => d.ano === anoAnterior)?.valor || 0;

  const serieAnoRecente = seriesPorMes.find((s) => s.ano === anoRecente);
  const mesesComDadoRecente = serieAnoRecente?.valores.filter((v) => v.presente) || [];
  const melhorMes = mesesComDadoRecente.length
    ? mesesComDadoRecente.reduce((a, b) => (b.valor > a.valor ? b : a))
    : null;

  const linhasAnoRecente = useMemo(() => linhas.filter((l) => l.ano === anoRecente), [linhas, anoRecente]);
  const transportadoraLider = useMemo(() => {
    const mapa = new Map();
    linhasAnoRecente.forEach((l) => {
      const chave = l.transportadora_nome || 'Não identificado';
      mapa.set(chave, (mapa.get(chave) || 0) + Number(l.valor || 0));
    });
    const arr = Array.from(mapa.entries()).sort((a, b) => b[1] - a[1]);
    return arr[0] || null;
  }, [linhasAnoRecente]);

  const variacaoPct = totalAnoAnterior ? ((totalAnoRecente - totalAnoAnterior) / totalAnoAnterior) * 100 : null;
  const mesesComparaveis = mesesComDadoRecente.length || 12;
  const totalAnoAnteriorAteMesmoMes = anoAnterior
    ? (seriesPorMes.find((s) => s.ano === anoAnterior)?.valores.slice(0, mesesComparaveis).reduce((acc, v) => acc + v.valor, 0) ?? null)
    : null;

  if (carregando) return <div className="sim-alert info">Carregando dados de todos os anos...</div>;
  if (erro) return <div className="sim-alert">{erro}</div>;
  if (!anos.length) return <div className="sim-alert info">Nenhum dado importado ainda.</div>;

  return (
    <>
      <div className="summary-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <StatTile label={`Total ${anoRecente}`} value={formatMoeda(totalAnoRecente)} sub={`${formatInt(linhasAnoRecente.length)} lançamento(s)`} />
        <StatTile
          label={anoAnterior ? `Vs. ${anoAnterior} (mesmos meses)` : 'Variação anual'}
          value={variacaoPct === null ? '—' : `${variacaoPct >= 0 ? '+' : ''}${variacaoPct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}
          delta={totalAnoAnteriorAteMesmoMes != null ? `vs ${formatMoeda(totalAnoAnteriorAteMesmoMes)}` : undefined}
          deltaBom={variacaoPct !== null && variacaoPct >= 0}
        />
        <StatTile
          label={`Melhor mês em ${anoRecente}`}
          value={melhorMes ? NOMES_MES[melhorMes.mes - 1] : '—'}
          sub={melhorMes ? formatMoeda(melhorMes.valor) : undefined}
        />
        <StatTile
          label={`Líder em ${anoRecente}`}
          value={transportadoraLider ? transportadoraLider[0] : '—'}
          sub={transportadoraLider ? formatMoeda(transportadoraLider[1]) : undefined}
        />
      </div>

      <div className="feature-grid two">
        <section className="table-card">
          <div className="sim-parametros-header">
            <div>
              <div className="panel-title">Total de desconto obtido por ano</div>
              <p>Soma de todos os meses de cada ano importado.</p>
            </div>
          </div>
          <GraficoBarraAnos dados={totalPorAno} />
        </section>

        <section className="table-card">
          <div className="sim-parametros-header">
            <div>
              <div className="panel-title">Comparação mês a mês entre anos</div>
              <p>Passe o mouse para ver o valor de cada ano num mês.</p>
            </div>
          </div>
          <GraficoLinhaMeses series={seriesPorMes} />
        </section>
      </div>

      <CardDistribuicaoRegra linhas={linhas} />

      <section className="table-card">
        <div className="sim-parametros-header">
          <div>
            <div className="panel-title">Top transportadoras — total por ano</div>
            <p>As 20 transportadoras com maior desconto acumulado, abertas por ano.</p>
          </div>
        </div>
        <div className="sim-table-wrap">
          <table className="sim-table" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <thead>
              <tr>
                <th>Transportadora</th>
                {anos.map((a) => <th key={a}>{a}</th>)}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {pivotTransportadora.map((item, i) => (
                <tr key={item.nome} style={{ background: i % 2 === 1 ? 'rgba(0,0,0,0.02)' : undefined }}>
                  <td>{item.nome}</td>
                  {anos.map((a) => <td key={a}>{item.porAno[a] ? formatMoeda(item.porAno[a]) : '—'}</td>)}
                  <td><strong>{formatMoeda(item.total)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// A partir de quando existe carteira de auditor nomeada por transportadora
// (com data de atribuição registrada) — antes disso não dá pra atribuir o
// desconto a ninguém com confiança, então a aba nem tenta.
const INICIO_AUDITORIA_POR_TRANSPORTADORA = '2026-07-01';

// O nome da transportadora no SAP quase nunca bate exatamente com o nome no
// cadastro de carteiras (ex.: "TAM LINHAS AEREAS S/A." vs "TAM LINHAS
// AEREAS"). Normaliza removendo acentos/pontuação e sufixos societários pra
// casar os dois lados pelo "miolo" do nome.
const REGEX_DIACRITICOS = new RegExp('[̀-ͯ]', 'g');

export function normalizarNomeTransportadora(nome) {
  let texto = String(nome || '').toUpperCase().normalize('NFD').replace(REGEX_DIACRITICOS, '');
  texto = texto.replace(/[^A-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const sufixo = /\s+(S\s?A|LTDA|LTD|ME|EPP|EIRELI|CIA|EM RECUPERACAO( JUDICIAL)?)$/;
  let anterior;
  do {
    anterior = texto;
    texto = texto.replace(sufixo, '').trim();
  } while (texto !== anterior);
  return texto;
}

// Dropdown customizado que filtra de verdade conforme digita (o <datalist>
// nativo do navegador não filtra de forma confiável com centenas de opções —
// alguns browsers mostram a lista inteira independente do texto digitado).
function SeletorVinculoTransportadora({ nomeSap, opcoes, salvando, onVincular }) {
  const [valor, setValor] = useState('');
  const [aberto, setAberto] = useState(false);
  const containerRef = useRef(null);

  const filtradas = useMemo(() => {
    const busca = valor.trim().toUpperCase();
    if (!busca) return opcoes.slice(0, 30);
    return opcoes.filter((o) => o.toUpperCase().includes(busca)).slice(0, 30);
  }, [valor, opcoes]);

  const valido = opcoes.includes(valor);

  useEffect(() => {
    function fecharFora(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) setAberto(false);
    }
    document.addEventListener('mousedown', fecharFora);
    return () => document.removeEventListener('mousedown', fecharFora);
  }, []);

  function selecionar(opcao) {
    setValor(opcao);
    setAberto(false);
  }

  return (
    <div ref={containerRef} style={{ display: 'flex', gap: 6, position: 'relative' }}>
      <input
        type="text"
        value={valor}
        onChange={(event) => { setValor(event.target.value); setAberto(true); }}
        onFocus={() => setAberto(true)}
        placeholder="Digite pra filtrar..."
        autoComplete="off"
        disabled={salvando}
        style={{ flex: 1, minWidth: 0 }}
      />
      {aberto && filtradas.length ? (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 40,
            zIndex: 50,
            background: '#fff',
            border: '1px solid rgba(11,11,11,0.15)',
            borderRadius: 8,
            marginTop: 4,
            maxHeight: 220,
            overflowY: 'auto',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          }}
        >
          {filtradas.map((opcao) => (
            <div
              key={opcao}
              onMouseDown={(event) => { event.preventDefault(); selecionar(opcao); }}
              style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer' }}
              onMouseEnter={(event) => { event.currentTarget.style.background = 'rgba(74,58,167,0.08)'; }}
              onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent'; }}
            >
              {opcao}
            </div>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="btn-secondary"
        disabled={!valido || salvando}
        onClick={() => onVincular(valor)}
      >
        {salvando ? '...' : 'Vincular'}
      </button>
    </div>
  );
}

function AbaPorAuditor() {
  const [linhas, setLinhas] = useState([]);
  const [historico, setHistorico] = useState([]);
  const [carteirasAtuais, setCarteirasAtuais] = useState([]);
  const [vinculosRaw, setVinculosRaw] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [auditorSelecionado, setAuditorSelecionado] = useState(null);
  const [vinculando, setVinculando] = useState('');

  useEffect(() => {
    let cancelado = false;
    async function carregar() {
      setCarregando(true);
      setErro('');
      try {
        const [dadosLinhas, dadosHistorico, dadosCarteiras, dadosVinculos] = await Promise.all([
          listarResumoDescontosObtidos({}),
          listarHistoricoCarteirasTodas(),
          listarCarteirasAtuais(),
          carregarVinculosTransportadoras(),
        ]);
        if (!cancelado) {
          setLinhas(dadosLinhas);
          setHistorico(dadosHistorico);
          setCarteirasAtuais(dadosCarteiras);
          setVinculosRaw(dadosVinculos);
        }
      } catch (error) {
        if (!cancelado) setErro(error.message || 'Erro ao carregar dados por auditor.');
      } finally {
        if (!cancelado) setCarregando(false);
      }
    }
    carregar();
    return () => { cancelado = true; };
  }, []);

  const mapaVinculos = useMemo(() => criarMapaVinculosTransportadoras(vinculosRaw), [vinculosRaw]);

  // Nomes canônicos que já têm carteira de auditor — são as opções pra
  // vincular manualmente uma transportadora do SAP que não casou sozinha.
  const nomesComCarteira = useMemo(
    () => Array.from(new Set(carteirasAtuais.map((c) => c.transportadora))).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [carteirasAtuais]
  );

  async function vincularTransportadora(nomeSap, nomeTabela) {
    if (!nomeTabela) return;
    setVinculando(nomeSap);
    setErro('');
    try {
      const proximaLista = [...vinculosRaw, { nomeCte: nomeSap, nomeTabela, origem: 'descontos-obtidos' }];
      const resultado = await salvarVinculosTransportadoras(proximaLista);
      setVinculosRaw(resultado.vinculos || proximaLista);
    } catch (error) {
      setErro(error.message || 'Não foi possível salvar o vínculo.');
    } finally {
      setVinculando('');
    }
  }

  // Junta as duas fontes por transportadora (chave normalizada): o histórico
  // real de trocas (quando existe) e, sempre, a atribuição atual — porque o
  // histórico às vezes não grava (falha silenciosa conhecida) e fica
  // incompleto para várias transportadoras que têm carteira. Com data
  // efetiva calculada: a 1ª atribuição de cada transportadora vale
  // retroativo a partir de INICIO_AUDITORIA_POR_TRANSPORTADORA (01/07/2026,
  // já que as carteiras só foram cadastradas em ago/2026); trocas de
  // carteira reais que vierem depois respeitam a própria data.
  const historicoPorTransportadora = useMemo(() => {
    const mapa = new Map();
    function adicionar(transportadora, entrada) {
      const chave = normalizarNomeTransportadora(transportadora);
      if (!chave) return;
      if (!mapa.has(chave)) mapa.set(chave, []);
      mapa.get(chave).push(entrada);
    }
    historico.forEach((h) => adicionar(h.transportadora, { auditor_nome: h.auditor_nome, atribuido_em: h.atribuido_em }));
    carteirasAtuais.forEach((c) => adicionar(c.transportadora, { auditor_nome: c.auditor_nome, atribuido_em: c.atribuido_em }));

    const inicio = new Date(INICIO_AUDITORIA_POR_TRANSPORTADORA).getTime();
    mapa.forEach((lista) => {
      lista.sort((a, b) => new Date(a.atribuido_em) - new Date(b.atribuido_em));
      lista.forEach((h, idx) => {
        const real = new Date(h.atribuido_em).getTime();
        h.efetivoDesde = idx === 0 ? Math.min(real, inicio) : real;
      });
      lista.sort((a, b) => b.efetivoDesde - a.efetivoDesde);
    });
    return mapa;
  }, [historico, carteirasAtuais]);

  // 1ª tentativa: vínculo cadastrado (Ferramentas > Transportadoras) que
  // traduz o nome bruto do SAP/CT-e pro nome canônico do cadastro — fonte
  // mais confiável que existe pra isso. 2ª tentativa: nome normalizado
  // (acentos/pontuação/sufixo societário removidos), pro que ainda não tem
  // vínculo cadastrado.
  function auditorNaData(transportadora, dataIso) {
    const nomeCanonico = mapaVinculos ? aplicarVinculoTransportadora(transportadora, mapaVinculos) : transportadora;
    let lista = historicoPorTransportadora.get(normalizarNomeTransportadora(nomeCanonico));
    if (!lista) lista = historicoPorTransportadora.get(normalizarNomeTransportadora(transportadora));
    if (!lista) return null;
    const data = new Date(dataIso).getTime();
    const encontrado = lista.find((h) => h.efetivoDesde <= data);
    return encontrado?.auditor_nome || null;
  }

  const linhasElegiveis = useMemo(
    () => linhas.filter((l) => l.data_lancamento >= INICIO_AUDITORIA_POR_TRANSPORTADORA),
    [linhas]
  );

  const linhasComAuditor = useMemo(
    () => linhasElegiveis.map((l) => ({ ...l, auditor: auditorNaData(l.transportadora_nome, l.data_lancamento) || 'Sem auditor definido' })),
    [linhasElegiveis, historicoPorTransportadora, mapaVinculos]
  );

  const porAuditor = useMemo(() => {
    const mapa = new Map();
    linhasComAuditor.forEach((l) => {
      if (!mapa.has(l.auditor)) mapa.set(l.auditor, { nome: l.auditor, total: 0, qtd: 0, transportadoras: new Map() });
      const entrada = mapa.get(l.auditor);
      entrada.total += Number(l.valor || 0);
      entrada.qtd += 1;
      entrada.transportadoras.set(l.transportadora_nome, (entrada.transportadoras.get(l.transportadora_nome) || 0) + Number(l.valor || 0));
    });
    return Array.from(mapa.values()).sort((a, b) => b.total - a.total);
  }, [linhasComAuditor]);

  const totalGeral = useMemo(() => linhasComAuditor.reduce((s, l) => s + Number(l.valor || 0), 0), [linhasComAuditor]);
  const totalSemAuditor = porAuditor.find((a) => a.nome === 'Sem auditor definido')?.total || 0;
  const auditoresAtivos = porAuditor.filter((a) => a.nome !== 'Sem auditor definido');

  const detalheAuditor = auditorSelecionado ? porAuditor.find((a) => a.nome === auditorSelecionado) : null;

  if (carregando) return <div className="sim-alert info">Carregando descontos por auditor...</div>;
  if (erro) return <div className="sim-alert">{erro}</div>;

  return (
    <>
      <div className="sim-alert info">
        Considera só lançamentos a partir de <strong>julho/2026</strong>. A primeira atribuição de cada
        transportadora vale retroativa desde 01/07/2026 (as carteiras foram cadastradas agora, então usar a data
        real do cadastro não puxaria nada); trocas de carteira futuras respeitam a própria data da troca. O nome da
        transportadora do SAP é casado com o cadastro por vínculo já existente (Ferramentas) ou por nome aproximado;
        quando nenhum dos dois resolve, clique em "Sem auditor definido" e selecione manualmente a transportadora
        correspondente do cadastro — o vínculo fica salvo pra sempre.
      </div>

      <div className="summary-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <StatTile label="Total atribuído (jul/2026+)" value={formatMoeda(totalGeral - totalSemAuditor)} sub={`${formatInt(auditoresAtivos.length)} auditor(es)`} />
        <StatTile label="Sem auditor definido" value={formatMoeda(totalSemAuditor)} sub="transportadora sem carteira registrada na data" />
      </div>

      <div className="feature-grid two">
        <section className="table-card">
          <div className="sim-parametros-header">
            <div>
              <div className="panel-title">Desconto obtido por auditor</div>
              <p>Clique num auditor para ver as transportadoras dele.</p>
            </div>
          </div>
          <div className="sim-table-wrap" style={{ maxHeight: 440, overflowY: 'auto' }}>
            <table className="sim-table">
              <thead>
                <tr>
                  <th>Auditor</th>
                  <th>Desconto obtido</th>
                  <th>Transportadoras</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {porAuditor.map((a) => (
                  <tr
                    key={a.nome}
                    onClick={() => setAuditorSelecionado((atual) => (atual === a.nome ? null : a.nome))}
                    style={{ cursor: 'pointer', background: auditorSelecionado === a.nome ? 'rgba(145,83,240,0.12)' : undefined }}
                  >
                    <td>{a.nome}</td>
                    <td>{formatMoeda(a.total)}</td>
                    <td>{formatInt(a.transportadoras.size)}</td>
                    <td style={{ width: '25%' }}><BarraHorizontal valor={a.total} maximo={Math.max(1, porAuditor[0]?.total || 1)} cor="#4a3aa7" /></td>
                  </tr>
                ))}
                {!porAuditor.length ? (
                  <tr><td colSpan={4}>Nenhum lançamento a partir de julho/2026 ainda.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="table-card">
          <div className="sim-parametros-header">
            <div>
              <div className="panel-title">Transportadoras{detalheAuditor ? ` — ${detalheAuditor.nome}` : ''}</div>
              <p>
                {detalheAuditor?.nome === 'Sem auditor definido'
                  ? 'Selecione a transportadora do cadastro correspondente pra vincular — o auditor do período é aplicado automaticamente daí em diante.'
                  : detalheAuditor ? 'Desconto obtido por transportadora deste auditor.' : 'Selecione um auditor à esquerda.'}
              </p>
            </div>
          </div>
          <div className="sim-table-wrap" style={{ maxHeight: 440, overflowY: 'auto' }}>
            <table className="sim-table">
              <thead>
                <tr>
                  <th>Transportadora (SAP)</th>
                  <th>Desconto obtido</th>
                  {detalheAuditor?.nome === 'Sem auditor definido' ? <th>Vincular à transportadora do cadastro</th> : null}
                </tr>
              </thead>
              <tbody>
                {detalheAuditor ? (
                  Array.from(detalheAuditor.transportadoras.entries())
                    .sort((a, b) => b[1] - a[1])
                    .map(([nome, valor]) => (
                      <tr key={nome}>
                        <td>{nome}</td>
                        <td>{formatMoeda(valor)}</td>
                        {detalheAuditor.nome === 'Sem auditor definido' ? (
                          <td>
                            <SeletorVinculoTransportadora
                              nomeSap={nome}
                              opcoes={nomesComCarteira}
                              salvando={vinculando === nome}
                              onVincular={(nomeTabela) => vincularTransportadora(nome, nomeTabela)}
                            />
                          </td>
                        ) : null}
                      </tr>
                    ))
                ) : (
                  <tr><td colSpan={2}>—</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

export default function PainelDescontosObtidosPage() {
  const [aba, setAba] = useState('mensal');
  const [ano, setAno] = useState(anoAtual());
  const [anosDisponiveis, setAnosDisponiveis] = useState([]);
  const [linhas, setLinhas] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  const [mesSelecionado, setMesSelecionado] = useState(null);
  const [transportadoraSelecionada, setTransportadoraSelecionada] = useState(null);

  const [lancamentos, setLancamentos] = useState([]);
  const [carregandoLancamentos, setCarregandoLancamentos] = useState(false);

  const [gerandoLaudo, setGerandoLaudo] = useState(false);
  const [dadosEmail, setDadosEmail] = useState(null);

  const htmlEmail = useMemo(() => (dadosEmail ? gerarHtmlEmailDescontosObtidos(dadosEmail) : ''), [dadosEmail]);

  async function prepararLaudoEEmail() {
    setGerandoLaudo(true);
    setErro('');
    try {
      const [todasLinhas, historico] = await Promise.all([
        listarResumoDescontosObtidos({}),
        listarHistoricoCarteirasTodas(),
      ]);
      baixarLaudoDescontosObtidosHtml(todasLinhas, historico);
      setDadosEmail(gerarDadosEmailDescontosObtidos(todasLinhas));
    } catch (error) {
      setErro(error.message || 'Erro ao gerar laudo.');
    } finally {
      setGerandoLaudo(false);
    }
  }

  async function copiarEmail() {
    try {
      await copiarHtmlEmailDescontosObtidos(htmlEmail, gerarTextoSimplesEmailDescontosObtidos(dadosEmail));
      setErro('');
    } catch (error) {
      setErro(error.message || 'Não foi possível copiar o corpo do e-mail.');
    }
  }

  function baixarEmailHtml() {
    baixarHtmlEmailDescontosObtidos(htmlEmail, nomeArquivoEmailDescontosObtidos(dadosEmail));
  }

  function prepararEmailOutlook() {
    baixarEmlOutlookDescontosObtidos(dadosEmail, htmlEmail);
  }

  useEffect(() => {
    Promise.all([listarAnosDisponiveis(), obterUltimaAtualizacaoDescontosObtidos()])
      .then(([anos, atualizadoEm]) => {
        setAnosDisponiveis(anos.length ? anos : [anoAtual()]);
        setUltimaAtualizacao(atualizadoEm);
      })
      .catch(() => setAnosDisponiveis([anoAtual()]));
  }, []);

  useEffect(() => {
    let cancelado = false;
    async function carregar() {
      setCarregando(true);
      setErro('');
      try {
        const dados = await listarResumoDescontosObtidos({ ano });
        if (!cancelado) setLinhas(dados);
      } catch (error) {
        if (!cancelado) setErro(error.message || 'Erro ao carregar descontos obtidos.');
      } finally {
        if (!cancelado) setCarregando(false);
      }
    }
    carregar();
    return () => { cancelado = true; };
  }, [ano]);

  useEffect(() => {
    setMesSelecionado(null);
    setTransportadoraSelecionada(null);
  }, [ano]);

  useEffect(() => {
    if (!mesSelecionado && !transportadoraSelecionada) {
      setLancamentos([]);
      return undefined;
    }
    let cancelado = false;
    async function carregar() {
      setCarregandoLancamentos(true);
      try {
        const dados = await listarLancamentosDescontosObtidos({
          ano,
          mes: mesSelecionado || undefined,
          transportadoraNome: transportadoraSelecionada || undefined,
        });
        if (!cancelado) setLancamentos(dados);
      } catch (error) {
        if (!cancelado) setErro(error.message || 'Erro ao carregar lançamentos.');
      } finally {
        if (!cancelado) setCarregandoLancamentos(false);
      }
    }
    carregar();
    return () => { cancelado = true; };
  }, [ano, mesSelecionado, transportadoraSelecionada]);

  const totalAno = useMemo(() => linhas.reduce((soma, l) => soma + Number(l.valor || 0), 0), [linhas]);

  const linhasFiltradasPorTransportadora = useMemo(() => {
    if (!transportadoraSelecionada) return linhas;
    return linhas.filter((l) => l.transportadora_nome === transportadoraSelecionada);
  }, [linhas, transportadoraSelecionada]);

  const porMes = useMemo(() => {
    const mapa = new Map();
    for (let m = 1; m <= 12; m += 1) mapa.set(m, 0);
    linhasFiltradasPorTransportadora.forEach((l) => mapa.set(l.mes, (mapa.get(l.mes) || 0) + Number(l.valor || 0)));
    return Array.from(mapa.entries()).map(([mes, valor]) => ({ mes, valor }));
  }, [linhasFiltradasPorTransportadora]);

  const maiorMes = useMemo(() => Math.max(1, ...porMes.map((m) => m.valor)), [porMes]);

  const linhasFiltradasPorMes = useMemo(() => {
    if (!mesSelecionado) return linhas;
    return linhas.filter((l) => l.mes === mesSelecionado);
  }, [linhas, mesSelecionado]);

  const porTransportadora = useMemo(() => {
    const mapa = new Map();
    linhasFiltradasPorMes.forEach((l) => {
      const chave = l.transportadora_nome || 'Não identificado';
      mapa.set(chave, (mapa.get(chave) || 0) + Number(l.valor || 0));
    });
    return Array.from(mapa.entries())
      .map(([nome, valor]) => ({ nome, valor }))
      .sort((a, b) => b.valor - a.valor);
  }, [linhasFiltradasPorMes]);

  const maiorTransportadora = useMemo(() => Math.max(1, ...porTransportadora.map((t) => t.valor)), [porTransportadora]);

  function clicarMes(mes) {
    setMesSelecionado((atual) => (atual === mes ? null : mes));
  }

  function clicarTransportadora(nome) {
    setTransportadoraSelecionada((atual) => (atual === nome ? null : nome));
  }

  function limparFiltros() {
    setMesSelecionado(null);
    setTransportadoraSelecionada(null);
  }

  const totalFiltrado = useMemo(() => {
    let base = linhas;
    if (mesSelecionado) base = base.filter((l) => l.mes === mesSelecionado);
    if (transportadoraSelecionada) base = base.filter((l) => l.transportadora_nome === transportadoraSelecionada);
    return base.reduce((soma, l) => soma + Number(l.valor || 0), 0);
  }, [linhas, mesSelecionado, transportadoraSelecionada]);

  return (
    <div className="page-shell realizado-page">
      <div className="page-top between">
        <div className="page-header">
          <div className="amd-mini-brand">AMD Log • Descontos Obtidos (SAP)</div>
          <h1>Painel de Descontos Obtidos</h1>
          {ultimaAtualizacao ? (
            <div
              role="status"
              style={{ marginTop: 6, fontSize: 12, color: TINTA_SECUNDARIA }}
            >
              Última atualização da base: <strong>{formatDataHoraBr(ultimaAtualizacao)}</strong>
            </div>
          ) : null}
          <p>Clique num mês para ver as transportadoras daquele mês, ou numa transportadora para ver a evolução dela mês a mês.</p>
        </div>
        <div className="actions-right wrap">
          {aba === 'mensal' ? (
            <div className="field">
              <label>Ano</label>
              <select value={ano} onChange={(event) => setAno(Number(event.target.value))} style={{ minWidth: 110 }}>
                {(anosDisponiveis.includes(ano) ? anosDisponiveis : [...anosDisponiveis, ano]).sort((a, b) => b - a).map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          ) : null}
          <button className="btn-secondary" type="button" onClick={prepararLaudoEEmail} disabled={gerandoLaudo}>
            {gerandoLaudo ? 'Gerando...' : 'Gerar laudo + e-mail'}
          </button>
        </div>
      </div>

      {dadosEmail ? (
        <section className="table-card">
          <div className="sim-parametros-header">
            <div>
              <div className="panel-title">E-mail — visão ano a ano e detalhamento de {dadosEmail.anoRecente}</div>
              <p>Laudo navegável (HTML tipo BI) já baixado. Abaixo, o corpo do e-mail formatado — mesmo modelo usado em reajustes e savings.</p>
            </div>
          </div>
          <div className="actions-right gap-row" style={{ margin: '14px 0' }}>
            <button type="button" className="btn-secondary" onClick={copiarEmail}>Copiar corpo para Outlook</button>
            <button type="button" className="btn-secondary" onClick={baixarEmailHtml}>Baixar HTML</button>
            <button
              type="button"
              className="btn-primary"
              onClick={prepararEmailOutlook}
              title="Gera um arquivo .eml com o HTML completo no corpo. Abra o arquivo baixado no Outlook."
            >
              Preparar e-mail no Outlook
            </button>
          </div>
          <iframe
            title="Prévia do e-mail de descontos obtidos"
            srcDoc={htmlEmail}
            style={{ width: '100%', height: 480, border: '1px solid rgba(11,11,11,0.10)', borderRadius: 12 }}
          />
        </section>
      ) : null}

      <div className="tabs-bar" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          className={aba === 'mensal' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setAba('mensal')}
        >
          Mensal
        </button>
        <button
          type="button"
          className={aba === 'anual' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setAba('anual')}
        >
          Ano a ano
        </button>
        <button
          type="button"
          className={aba === 'auditor' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setAba('auditor')}
        >
          Por auditor
        </button>
      </div>

      {aba === 'anual' ? <AbaAnoAno /> : null}
      {aba === 'auditor' ? <AbaPorAuditor /> : null}

      {aba === 'mensal' ? (
        <>
          {erro ? <div className="sim-alert">{erro}</div> : null}
          {carregando ? <div className="sim-alert info">Carregando...</div> : null}

          {(mesSelecionado || transportadoraSelecionada) ? (
            <div className="sim-alert info" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <span>
                Filtro ativo:{' '}
                {mesSelecionado ? <strong>{NOMES_MES[mesSelecionado - 1]}/{ano}</strong> : null}
                {mesSelecionado && transportadoraSelecionada ? ' + ' : ''}
                {transportadoraSelecionada ? <strong>{transportadoraSelecionada}</strong> : null}
                {' '}• {formatMoeda(totalFiltrado)}
              </span>
              <button className="btn-secondary" type="button" onClick={limparFiltros}>Limpar filtro</button>
            </div>
          ) : null}

          <div className="summary-strip">
            <div className="summary-card">
              <span>Total {transportadoraSelecionada ? `(${transportadoraSelecionada})` : 'no ano'}</span>
              <strong>{formatMoeda(transportadoraSelecionada ? porMes.reduce((s, m) => s + m.valor, 0) : totalAno)}</strong>
              <span>{formatInt(linhasFiltradasPorTransportadora.length)} lançamento(s)</span>
            </div>
            <div className="summary-card">
              <span>Transportadoras{mesSelecionado ? ` em ${NOMES_MES[mesSelecionado - 1]}` : ''}</span>
              <strong>{formatInt(porTransportadora.length)}</strong>
              <span>com desconto</span>
            </div>
          </div>

          <div className="feature-grid two">
            <section className="table-card">
              <div className="sim-parametros-header">
                <div>
                  <div className="panel-title">Desconto por mês{transportadoraSelecionada ? ` — ${transportadoraSelecionada}` : ''}</div>
                  <p>Ano {ano}. Clique num mês para filtrar as transportadoras ao lado.</p>
                </div>
              </div>
              <div className="sim-table-wrap">
                <table className="sim-table">
                  <thead>
                    <tr>
                      <th>Mês</th>
                      <th>Valor</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {porMes.map(({ mes, valor }) => (
                      <tr
                        key={mes}
                        onClick={() => (valor ? clicarMes(mes) : null)}
                        style={{ cursor: valor ? 'pointer' : 'default', background: mesSelecionado === mes ? 'rgba(145,83,240,0.12)' : undefined }}
                      >
                        <td>{NOMES_MES[mes - 1]}</td>
                        <td>{formatMoeda(valor)}</td>
                        <td style={{ width: '40%' }}><BarraHorizontal valor={valor} maximo={maiorMes} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="table-card">
              <div className="sim-parametros-header">
                <div>
                  <div className="panel-title">Desconto por transportadora{mesSelecionado ? ` — ${NOMES_MES[mesSelecionado - 1]}/${ano}` : ''}</div>
                  <p>Clique numa transportadora para ver a evolução dela mês a mês.</p>
                </div>
                <span className="status-pill">{formatInt(porTransportadora.length)} transportadora(s)</span>
              </div>
              <div className="sim-table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
                <table className="sim-table">
                  <thead>
                    <tr>
                      <th>Transportadora</th>
                      <th>Desconto obtido</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {porTransportadora.map((item) => (
                      <tr
                        key={item.nome}
                        onClick={() => clicarTransportadora(item.nome)}
                        style={{ cursor: 'pointer', background: transportadoraSelecionada === item.nome ? 'rgba(145,83,240,0.12)' : undefined }}
                      >
                        <td>{item.nome}</td>
                        <td>{formatMoeda(item.valor)}</td>
                        <td style={{ width: '30%' }}><BarraHorizontal valor={item.valor} maximo={maiorTransportadora} cor="#22a06b" /></td>
                      </tr>
                    ))}
                    {!porTransportadora.length ? (
                      <tr><td colSpan={3}>Nenhum dado importado para {ano} ainda.</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {(mesSelecionado || transportadoraSelecionada) ? (
            <section className="table-card">
              <div className="sim-parametros-header">
                <div>
                  <div className="panel-title">Lançamentos</div>
                  <p>
                    {mesSelecionado ? `${NOMES_MES[mesSelecionado - 1]}/${ano}` : `Ano ${ano}`}
                    {transportadoraSelecionada ? ` • ${transportadoraSelecionada}` : ''}
                  </p>
                </div>
                <span className="status-pill">{formatInt(lancamentos.length)} lançamento(s)</span>
              </div>
              {carregandoLancamentos ? <div className="sim-alert info">Carregando lançamentos...</div> : null}
              <div className="sim-table-wrap" style={{ maxHeight: 480, overflowY: 'auto' }}>
                <table className="sim-table">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Transportadora</th>
                      <th>Valor</th>
                      <th>Empresa</th>
                      <th>Centro de lucro</th>
                      <th>Texto</th>
                      <th>Arquivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lancamentos.map((l, i) => (
                      <tr key={`${l.lancamento_contabil}-${i}`}>
                        <td>{formatDataBr(l.data_lancamento)}</td>
                        <td>{l.transportadora_nome}</td>
                        <td>{formatMoeda(l.valor)}</td>
                        <td>{l.empresa}</td>
                        <td>{l.centro_lucro}</td>
                        <td>{l.texto_partida}</td>
                        <td>{l.arquivo_origem}</td>
                      </tr>
                    ))}
                    {!lancamentos.length && !carregandoLancamentos ? (
                      <tr><td colSpan={7}>Nenhum lançamento encontrado.</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
