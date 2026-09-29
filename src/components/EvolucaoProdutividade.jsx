import { useEffect, useMemo, useState } from 'react';
import { carregarHistoricoProdutividade } from '../services/auditoriaFretesService';

const FUSO = 'America/Sao_Paulo';
const COR_AUDITADAS = '#2563eb';
const COR_LIBERADAS = '#16a34a';
const LIBERADAS = new Set(['PRONTA_PARA_PAGAMENTO', 'LIBERADA_COM_DESCONTO']);
const NOMES_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const inteiro = (v) => Number(v || 0).toLocaleString('pt-BR');
const diaBrasilia = (iso) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: FUSO });

function somarDias(dia, n) {
  const d = new Date(`${dia}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('sv-SE');
}

// Segunda-feira da semana do dia.
function inicioSemana(dia) {
  const d = new Date(`${dia}T12:00:00`);
  const desloc = (d.getDay() + 6) % 7;
  return somarDias(dia, -desloc);
}

function somarMeses(mes, n) {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function rotulo(visao, chave) {
  if (visao === 'mes') return `${NOMES_MES[Number(chave.slice(5, 7)) - 1]}/${chave.slice(2, 4)}`;
  return `${chave.slice(8, 10)}/${chave.slice(5, 7)}`;
}

function variacao(atual, anterior) {
  if (!anterior) return atual ? null : 0;
  return ((atual - anterior) / anterior) * 100;
}

function Variacao({ atual, anterior }) {
  const v = variacao(atual, anterior);
  if (v === null) return <small>{anterior ? '' : 'sem base anterior'}</small>;
  const cor = v > 0 ? '#15803d' : v < 0 ? '#b91c1c' : '#64748b';
  return <small style={{ color: cor }}>{v > 0 ? '▲' : v < 0 ? '▼' : '='} {Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}% vs anterior ({inteiro(anterior)})</small>;
}

// Evolucao da produtividade: quantas faturas foram auditadas e liberadas para
// pagamento por dia, semana e mes (cada fatura conta uma vez por periodo).
export default function EvolucaoProdutividade() {
  const [visao, setVisao] = useState('dia');
  const [eventos, setEventos] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: FUSO });

  const carregar = async () => {
    setCarregando(true);
    setErro('');
    try {
      const inicio = `${somarMeses(hoje.slice(0, 7), -5)}-01`;
      setEventos(await carregarHistoricoProdutividade(`${inicio}T00:00:00-03:00`, `${somarDias(hoje, 1)}T00:00:00-03:00`));
    } catch (e) {
      setErro(e.message || String(e));
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => { carregar(); }, []);

  // chave do periodo -> { auditadas:Set, liberadas:Set } para cada visao
  const series = useMemo(() => {
    const mapas = { dia: new Map(), semana: new Map(), mes: new Map() };
    const marcar = (mapa, chave, tipo, id) => {
      const cel = mapa.get(chave) || { auditadas: new Set(), liberadas: new Set() };
      cel[tipo].add(id);
      mapa.set(chave, cel);
    };
    for (const e of eventos) {
      const liberada = LIBERADAS.has(e.status_novo);
      const auditada = liberada || e.status_novo === 'AGUARDANDO_APROVACAO_GESTAO' || e.acao === 'REAUDITORIA_CONCLUIDA';
      if (!auditada) continue;
      const dia = diaBrasilia(e.created_at);
      const chaves = { dia, semana: inicioSemana(dia), mes: dia.slice(0, 7) };
      for (const v of ['dia', 'semana', 'mes']) {
        marcar(mapas[v], chaves[v], 'auditadas', e.fatura_id);
        if (liberada) marcar(mapas[v], chaves[v], 'liberadas', e.fatura_id);
      }
    }
    const valor = (v, chave) => {
      const cel = mapas[v].get(chave);
      return { auditadas: cel?.auditadas.size || 0, liberadas: cel?.liberadas.size || 0 };
    };
    return { valor };
  }, [eventos]);

  const pontos = useMemo(() => {
    let chaves;
    if (visao === 'dia') chaves = Array.from({ length: 30 }, (_, i) => somarDias(hoje, i - 29));
    else if (visao === 'semana') chaves = Array.from({ length: 12 }, (_, i) => somarDias(inicioSemana(hoje), (i - 11) * 7));
    else chaves = Array.from({ length: 6 }, (_, i) => somarMeses(hoje.slice(0, 7), i - 5));
    return chaves.map((chave) => ({ chave, ...series.valor(visao, chave) }));
  }, [visao, series, hoje]);

  const resumo = useMemo(() => {
    const dia = (n) => series.valor('dia', somarDias(hoje, n));
    const sem = (n) => series.valor('semana', somarDias(inicioSemana(hoje), n * 7));
    const mes = (n) => series.valor('mes', somarMeses(hoje.slice(0, 7), n));
    return [
      ['Hoje', dia(0), dia(-1), 'ontem'],
      ['Esta semana', sem(0), sem(-1), 'semana anterior'],
      ['Este mes', mes(0), mes(-1), 'mes anterior'],
    ];
  }, [series, hoje]);

  const maximo = Math.max(1, ...pontos.map((p) => Math.max(p.auditadas, p.liberadas)));
  const largura = 760;
  const altura = 260;
  const margem = { esq: 34, dir: 8, topo: 16, base: 30 };
  const areaL = largura - margem.esq - margem.dir;
  const areaA = altura - margem.topo - margem.base;
  const passo = areaL / pontos.length;
  const barra = Math.max(3, Math.min(22, passo * 0.38));
  const y = (v) => margem.topo + areaA - (v / maximo) * areaA;
  const mostrarValores = pontos.length <= 14;
  const passoRotulo = pontos.length > 14 ? 3 : 1;

  return (
    <div className="table-card">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h4 style={{ margin: 0 }}>Evolucao da auditoria de faturas</h4>
          <small>Faturas auditadas e liberadas para pagamento. Cada fatura conta uma vez por periodo.</small>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[['dia', 'Dia a dia'], ['semana', 'Semana'], ['mes', 'Mes']].map(([id, nome]) => (
            <button key={id} type="button" className={visao === id ? 'btn-primary' : 'btn-secondary'} onClick={() => setVisao(id)}>{nome}</button>
          ))}
          <button type="button" className="btn-secondary" disabled={carregando} onClick={carregar}>{carregando ? '...' : '↻'}</button>
        </div>
      </div>
      {erro ? <div className="sim-alert error" style={{ marginTop: 8 }}>{erro}</div> : null}

      <div className="summary-strip" style={{ marginTop: 10 }}>
        {resumo.map(([nome, atual, anterior]) => (
          <div key={nome} className="summary-card">
            <span>{nome}</span>
            <strong>{inteiro(atual.auditadas)} auditadas</strong>
            <Variacao atual={atual.auditadas} anterior={anterior.auditadas} />
            <strong style={{ color: COR_LIBERADAS, marginTop: 4 }}>{inteiro(atual.liberadas)} liberadas</strong>
            <Variacao atual={atual.liberadas} anterior={anterior.liberadas} />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 14, margin: '10px 0 2px', fontSize: 12 }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: COR_AUDITADAS, marginRight: 4 }} />Auditadas</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: COR_LIBERADAS, marginRight: 4 }} />Liberadas p/ pagamento</span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${largura} ${altura}`} style={{ width: '100%', minWidth: 520, height: 'auto', color: '#475569' }} role="img" aria-label="Evolucao de faturas auditadas e liberadas">
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const v = Math.round(maximo * f);
            return (
              <g key={f}>
                <line x1={margem.esq} x2={largura - margem.dir} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity="0.15" />
                <text x={margem.esq - 4} y={y(v) + 3} fontSize="10" textAnchor="end" fill="currentColor">{inteiro(v)}</text>
              </g>
            );
          })}
          {pontos.map((p, i) => {
            const cx = margem.esq + passo * i + passo / 2;
            return (
              <g key={p.chave}>
                <rect x={cx - barra - 1} y={y(p.auditadas)} width={barra} height={margem.topo + areaA - y(p.auditadas)} fill={COR_AUDITADAS} rx="2">
                  <title>{`${rotulo(visao, p.chave)}: ${p.auditadas} auditadas`}</title>
                </rect>
                <rect x={cx + 1} y={y(p.liberadas)} width={barra} height={margem.topo + areaA - y(p.liberadas)} fill={COR_LIBERADAS} rx="2">
                  <title>{`${rotulo(visao, p.chave)}: ${p.liberadas} liberadas`}</title>
                </rect>
                {mostrarValores && p.auditadas ? <text x={cx - barra / 2 - 1} y={y(p.auditadas) - 3} fontSize="9" textAnchor="middle" fill="currentColor">{p.auditadas}</text> : null}
                {mostrarValores && p.liberadas ? <text x={cx + barra / 2 + 1} y={y(p.liberadas) - 3} fontSize="9" textAnchor="middle" fill="currentColor">{p.liberadas}</text> : null}
                {i % passoRotulo === 0 ? <text x={cx} y={altura - 10} fontSize="10" textAnchor="middle" fill="currentColor">{rotulo(visao, p.chave)}</text> : null}
              </g>
            );
          })}
        </svg>
      </div>
      <small>Passe o mouse sobre as barras para ver o valor exato. Periodo atual ainda em andamento.</small>
    </div>
  );
}
