import { useEffect, useMemo, useRef, useState } from 'react';
import { buscarBaseSimulacaoPorRotasDb } from '../services/freteDatabaseService';
import { carregarMunicipiosIbgeComFallback } from '../services/ibgeService';
import { carregarVinculosTransportadoras } from '../services/vinculosTransportadorasService';
import { buscarRealizadoRemotoParaPerda } from '../services/perdaRealizadoDb';
import { categoriaCanalRealizado } from '../utils/realizadoLocalEngine';

const REGIOES = [
  { label: 'Sul', ufs: ['RS', 'SC', 'PR'] },
  { label: 'Sudeste', ufs: ['SP', 'RJ', 'MG', 'ES'] },
  { label: 'Centro-Oeste', ufs: ['MT', 'MS', 'GO', 'DF'] },
  { label: 'Nordeste', ufs: ['BA', 'SE', 'AL', 'PE', 'PB', 'RN', 'CE', 'PI', 'MA'] },
  { label: 'Norte', ufs: ['AM', 'PA', 'RO', 'AC', 'RR', 'AP', 'TO'] },
];
const TODAS_UFS = REGIOES.flatMap((r) => r.ufs);
const CANAIS = ['ATACADO', 'B2C', 'REVERSA', 'INTERCOMPANY', 'A DEFINIR'];
const LIMITE_DB = 50000;
const PAGE_SIZE = 50;
const ROUTE_CHUNK_SIZE = 90;

const ETAPAS = [
  { id: 'municipios', label: 'Municípios' },
  { id: 'realizado', label: 'CT-es' },
  { id: 'tabelas', label: 'Tabelas' },
  { id: 'analise', label: 'Análise' },
];

function fmt(v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function num(v, casas = 2) { return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas }); }
function pct(v) { return `${Number(v || 0).toFixed(1)}%`; }
function fmtData(s) { if (!s) return '-'; const [y, m, d] = String(s).slice(0, 10).split('-'); return y && m && d ? `${d}/${m}/${y}` : String(s).slice(0, 10); }
function normUf(s) { return String(s || '').trim().toUpperCase(); }
function safeNumber(v) { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; }
function chunkArray(arr, size) { const out = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out; }
function normText(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase(); }
function incluiTexto(valor, filtro) { const f = normText(filtro); return !f || normText(valor).includes(f); }
function selecionadosLista(value) { return Array.isArray(value) ? value : (value ? [value] : []); }
function passaLista(valor, selecionados = []) {
  const lista = selecionadosLista(selecionados).map(normText).filter(Boolean);
  return !lista.length || lista.includes(normText(valor));
}

const FILTROS_BI_PADRAO = {
  emissaoInicio: '',
  emissaoFim: '',
  canais: [],
  ufsOrigem: [],
  ufsDestino: [],
  cidadesOrigem: [],
  cidadesDestino: [],
  transportadorasRealizadas: [],
  transportadorasGanhadoras: [],
  soPerda: false,
};

function chavesCte(cte, canalFiltro = '') {
  const rota = String(cte.chaveRotaIbge || '').trim();
  if (!rota) return [];
  const canalCte = categoriaCanalRealizado(cte.canal);
  const keys = [];
  if (canalCte) keys.push(`${canalCte}|${rota}`);
  if (canalFiltro) keys.push(`${canalFiltro}|${rota}`);
  return [...new Set(keys)];
}

function extrairRouteKeys(ctes, canal = '') {
  const set = new Set();
  for (const cte of ctes || []) chavesCte(cte, canal).forEach((key) => set.add(key));
  return Array.from(set);
}

function recalcularAgregados(resultado = {}) {
  const detalhes = resultado.detalhes || [];
  const ctesComPerda = detalhes.filter((d) => d.temPerda).length;
  const perdaTotal = Math.round(detalhes.reduce((s, d) => s + (d.temPerda ? safeNumber(d.perda) : 0), 0) * 100) / 100;
  const perdaMedia = ctesComPerda ? Math.round((perdaTotal / ctesComPerda) * 100) / 100 : 0;

  const mapaOrigem = new Map();
  const mapaTransp = new Map();
  for (const d of detalhes) {
    if (!d.temPerda) continue;
    const ok = `${d.cidadeOrigem}/${d.ufOrigem}`;
    const og = mapaOrigem.get(ok) || { origem: ok, ufOrigem: d.ufOrigem, cidadeOrigem: d.cidadeOrigem, ctes: 0, perdaTotal: 0, valorPagoTotal: 0 };
    og.ctes += 1; og.perdaTotal += safeNumber(d.perda); og.valorPagoTotal += safeNumber(d.valorPago); mapaOrigem.set(ok, og);
    const tk = d.transportadoraRealizada || 'Não informado';
    const tg = mapaTransp.get(tk) || { transportadora: tk, ctes: 0, perdaTotal: 0 };
    tg.ctes += 1; tg.perdaTotal += safeNumber(d.perda); mapaTransp.set(tk, tg);
  }

  const top10Origens = Array.from(mapaOrigem.values())
    .map((g) => ({ ...g, perdaTotal: Math.round(g.perdaTotal * 100) / 100, valorPagoTotal: Math.round(g.valorPagoTotal * 100) / 100, perdaPercentual: g.valorPagoTotal > 0 ? (g.perdaTotal / g.valorPagoTotal) * 100 : 0 }))
    .sort((a, b) => b.perdaTotal - a.perdaTotal).slice(0, 10);
  const porTransportadora = Array.from(mapaTransp.values())
    .map((g) => ({ ...g, perdaTotal: Math.round(g.perdaTotal * 100) / 100 }))
    .sort((a, b) => b.perdaTotal - a.perdaTotal).slice(0, 15);

  return { ...resultado, totalCtes: detalhes.length, ctesComPerda, perdaTotal, perdaMedia, top10Origens, porTransportadora };
}

function passaFiltrosBiDetalhe(d = {}, filtros = {}) {
  const emissao = String(d.emissao || '').slice(0, 10);
  if (filtros.emissaoInicio && (!emissao || emissao < filtros.emissaoInicio)) return false;
  if (filtros.emissaoFim && (!emissao || emissao > filtros.emissaoFim)) return false;
  if (!passaLista(d.canal, filtros.canais)) return false;
  if (!passaLista(d.ufOrigem, filtros.ufsOrigem)) return false;
  if (!passaLista(d.ufDestino, filtros.ufsDestino)) return false;
  if (filtros.soPerda && !d.temPerda) return false;
  if (!passaLista(d.cidadeOrigem, filtros.cidadesOrigem)) return false;
  if (!passaLista(d.cidadeDestino, filtros.cidadesDestino)) return false;
  if (!passaLista(d.transportadoraRealizada, filtros.transportadorasRealizadas)) return false;
  if (!passaLista(d.transportadoraGanhadora, filtros.transportadorasGanhadoras)) return false;
  return true;
}

function passaFiltrosBiInativa(d = {}, filtros = {}) {
  const emissao = String(d.emissao || '').slice(0, 10);
  const [cidadeOrigem = '', ufOrigem = ''] = String(d.origem || '').split('/');
  const [cidadeDestino = '', ufDestino = ''] = String(d.destino || '').split('/');
  if (filtros.emissaoInicio && (!emissao || emissao < filtros.emissaoInicio)) return false;
  if (filtros.emissaoFim && (!emissao || emissao > filtros.emissaoFim)) return false;
  if (!passaLista(d.canal, filtros.canais)) return false;
  if (!passaLista(ufOrigem, filtros.ufsOrigem)) return false;
  if (!passaLista(ufDestino, filtros.ufsDestino)) return false;
  if (!passaLista(cidadeOrigem, filtros.cidadesOrigem)) return false;
  if (!passaLista(cidadeDestino, filtros.cidadesDestino)) return false;
  if (!passaLista(d.transportadoraRealizada, filtros.transportadorasRealizadas)) return false;
  if (!passaLista(d.transportadoraAtivaMaisBarata, filtros.transportadorasGanhadoras)) return false;
  return true;
}

function recalcularResultadoBi(resultado = {}, filtros = {}) {
  const detalhes = (resultado.detalhes || []).filter((d) => passaFiltrosBiDetalhe(d, filtros));
  const inativasDetalhes = (resultado.inativasDetalhes || []).filter((d) => passaFiltrosBiInativa(d, filtros));
  const economiaInativaTotal = Math.round(inativasDetalhes.reduce((acc, item) => acc + Math.max(0, safeNumber(item.economiaVsAtiva)), 0) * 100) / 100;
  const economiaInativaVsPagoTotal = Math.round(inativasDetalhes.reduce((acc, item) => acc + Math.max(0, safeNumber(item.economiaVsPago)), 0) * 100) / 100;
  return recalcularAgregados({
    ...resultado,
    detalhes,
    inativasDetalhes,
    inativas: inativasDetalhes.length,
    economiaInativaTotal,
    economiaInativaVsPagoTotal,
  });
}

function filtrosBiAtivos(filtros = {}) {
  return Object.entries(filtros).some(([k, v]) => {
    if (k === 'soPerda') return Boolean(v);
    if (Array.isArray(v)) return v.length > 0;
    return Boolean(String(v || '').trim());
  });
}

function opcoesUnicas(lista = [], seletor) {
  return [...new Set((lista || []).map(seletor).filter(Boolean).map((v) => String(v).trim()))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function juntarResultados(partes = []) {
  const base = {
    detalhes: [], inativasDetalhes: [], semMalha: 0, semPrazo: 0, semComparacao: 0,
    inativas: 0, economiaInativaTotal: 0, economiaInativaVsPagoTotal: 0,
  };
  for (const p of partes) {
    base.detalhes.push(...(p.detalhes || []));
    base.inativasDetalhes.push(...(p.inativasDetalhes || []));
    base.semMalha += safeNumber(p.semMalha);
    base.semPrazo += safeNumber(p.semPrazo);
    base.semComparacao += safeNumber(p.semComparacao);
    base.economiaInativaTotal += safeNumber(p.economiaInativaTotal);
    base.economiaInativaVsPagoTotal += safeNumber(p.economiaInativaVsPagoTotal);
  }
  base.inativas = base.inativasDetalhes.length;
  base.economiaInativaTotal = Math.round(base.economiaInativaTotal * 100) / 100;
  base.economiaInativaVsPagoTotal = Math.round(base.economiaInativaVsPagoTotal * 100) / 100;
  return recalcularAgregados(base);
}

function calcularResumoPrazo(resultado) {
  const comPerda = (resultado?.detalhes || []).filter((d) => d.temPerda);
  const comPrazo = comPerda.filter((d) => d.difPrazo !== null && d.difPrazo !== undefined && Number.isFinite(Number(d.difPrazo)));
  const prazoMaior = comPrazo.filter((d) => Number(d.difPrazo) > 0);
  const prazoMenor = comPrazo.filter((d) => Number(d.difPrazo) < 0);
  const prazoIgual = comPrazo.filter((d) => Number(d.difPrazo) === 0);
  const soma = (lista) => lista.reduce((acc, item) => acc + safeNumber(item.perda), 0);
  const base = comPrazo.length || 0;
  return { comPrazo: base, prazoMaior: prazoMaior.length, prazoMenor: prazoMenor.length, prazoIgual: prazoIgual.length, pctMaior: base ? (prazoMaior.length / base) * 100 : 0, pctMenor: base ? (prazoMenor.length / base) * 100 : 0, pctIgual: base ? (prazoIgual.length / base) * 100 : 0, perdaPrazoMaior: soma(prazoMaior), perdaPrazoMenor: soma(prazoMenor), perdaPrazoIgual: soma(prazoIgual) };
}

function Card({ label, valor, sub, cor, destaque }) {
  return <div className="summary-card" style={{ borderLeft: `4px solid ${cor || '#9153F0'}`, background: destaque ? '#fff5f5' : undefined }}><span>{label}</span><strong style={{ color: destaque ? '#9b1111' : undefined }}>{valor}</strong>{sub && <small>{sub}</small>}</div>;
}
function Barra({ valor, maximo, cor }) { const w = maximo > 0 ? Math.min(100, (valor / maximo) * 100) : 0; return <div style={{ background: '#eee', borderRadius: 4, height: 8, minWidth: 80, overflow: 'hidden' }}><div style={{ background: cor || '#9153F0', width: `${w}%`, height: '100%', borderRadius: 4 }} /></div>; }
function Info({ label, value }) { return <tr><td style={{ color: '#667085', padding: '2px 8px 2px 0', whiteSpace: 'nowrap' }}>{label}</td><td style={{ fontWeight: 600, padding: '2px 0' }}>{value ?? '-'}</td></tr>; }

function CalculoBox({ titulo, calc, cor = '#9153F0' }) {
  if (!calc) return null;
  const taxas = Array.isArray(calc.taxas) ? calc.taxas : [];
  return <div style={{ border: `1px solid ${cor}33`, borderRadius: 8, padding: 10, background: '#fff', minWidth: 310 }}>
    <div style={{ fontWeight: 800, color: cor, marginBottom: 6 }}>{titulo}</div>
    <table style={{ fontSize: '0.76rem', width: '100%' }}><tbody>
      <Info label="Transportadora" value={calc.transportadora} />
      <Info label="Status" value={calc.ativa === false ? `Inativa (${calc.statusTransportadora || 'sem status'})` : (calc.statusTransportadora || 'Ativa')} />
      <Info label="Tem tabela/faixa" value={calc.temTabelaCalculo ? 'Sim' : 'Não'} />
      <Info label="Origem do prazo" value={calc.fontePrazo || 'Tabela de Frete > Rota > prazoEntregaDias'} />
      <Info label="Prazo usado" value={calc.prazo ? `${calc.prazo} dias` : '-'} />
      <Info label="Total calculado" value={fmt(calc.total)} />
      <Info label="Tipo cálculo" value={calc.tipoCalculo} />
      <Info label="Faixa" value={calc.faixaPeso} />
      <Info label="Peso informado" value={`${num(calc.pesoInformado)} kg`} />
      <Info label="Peso considerado" value={`${num(calc.pesoConsiderado)} kg`} />
      <Info label="Cubagem aplicada" value={`${num(calc.cubagemAplicada)} m³ (${calc.origemCubagem || '-'})`} />
      <Info label="Peso cubado" value={`${num(calc.pesoCubadoCalculado)} kg`} />
      <Info label="Valor NF" value={fmt(calc.valorNFInformado)} />
      <Info label="% aplicado" value={calc.percentualAplicado ? `${num(calc.percentualAplicado)}%` : '-'} />
      <Info label="Valor fixo/faixa" value={fmt(calc.valorFixoAplicado || calc.valorBase)} />
      <Info label="Frete mínimo" value={fmt(calc.freteMinimoCotacao || calc.minimoAplicavel || calc.minimoRota)} />
      <Info label="Subtotal" value={fmt(calc.subtotal)} />
      <Info label="ICMS" value={`${fmt(calc.icms)}${calc.aliquotaIcms ? ` (${num(calc.aliquotaIcms)}%)` : ''}`} />
      <Info label="Taxas" value={fmt(calc.taxasTotal)} />
      <Info label="Excedente" value={fmt(calc.valorExcedente)} />
    </tbody></table>
    {taxas.length > 0 && <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #eee' }}><div style={{ fontWeight: 700, fontSize: '0.74rem', marginBottom: 4 }}>Taxas aplicadas</div>{taxas.map((t, i) => <div key={`${t.nome}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', gap: 12 }}><span>{t.nome}</span><strong>{fmt(t.valor)}</strong></div>)}</div>}
  </div>;
}
function DetalheCalculo({ item }) { return <details style={{ minWidth: 170 }}><summary style={{ cursor: 'pointer', color: '#9153F0', fontWeight: 700 }}>Ver cálculo</summary><div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '0.75rem', background: '#f8f6ff', borderRadius: 8, marginTop: 6, maxWidth: 1050 }}><CalculoBox titulo="Realizada/tabela" calc={item.calculoRealizada} cor="#4E008F" /><CalculoBox titulo="Mais barata ativa" calc={item.calculoGanhadora} cor="#04C7A4" />{item.menorInativa && <CalculoBox titulo="Menor inativa" calc={item.menorInativa} cor="#f59e0b" />}</div></details>; }

function MultiSelectBusca({ label, options = [], value = [], onChange, placeholder = 'Buscar...' }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const selecionados = selecionadosLista(value);
  const selecionadosNorm = new Set(selecionados.map(normText));
  const opcoes = options.filter((op) => incluiTexto(op, busca));
  const toggle = (opcao) => {
    const jaSelecionado = selecionadosNorm.has(normText(opcao));
    onChange(jaSelecionado ? selecionados.filter((item) => normText(item) !== normText(opcao)) : [...selecionados, opcao]);
  };
  const marcarVisiveis = () => {
    const mapa = new Map(selecionados.map((item) => [normText(item), item]));
    opcoes.forEach((opcao) => mapa.set(normText(opcao), opcao));
    onChange(Array.from(mapa.values()));
  };
  const textoResumo = selecionados.length ? `${selecionados.length} selecionada${selecionados.length > 1 ? 's' : ''}` : 'Todas';

  return <div className="field" style={{ position: 'relative' }}><span>{label}</span><button type="button" className="btn-secondary" onClick={() => setAberto((v) => !v)} style={{ width: '100%', justifyContent: 'space-between', textAlign: 'left', padding: '7px 10px', fontWeight: 700 }}>{textoResumo}<span>{aberto ? '▲' : '▼'}</span></button>{aberto && <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: '#fff', border: '1px solid #cfd8ea', borderRadius: 8, boxShadow: '0 12px 28px rgba(15, 23, 42, 0.18)', padding: 10, marginTop: 4 }}><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={placeholder} style={{ width: '100%', marginBottom: 8 }} /><div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}><button type="button" className="btn-secondary" style={{ padding: '3px 8px', fontSize: '0.76rem' }} onClick={marcarVisiveis}>Todas</button><button type="button" className="btn-secondary" style={{ padding: '3px 8px', fontSize: '0.76rem' }} onClick={() => onChange([])}>Nenhuma</button><button type="button" className="btn-primary" style={{ padding: '3px 10px', fontSize: '0.76rem' }} onClick={() => setAberto(false)}>Aplicar</button></div><div style={{ maxHeight: 230, overflow: 'auto', display: 'grid', gap: 4 }}>{!opcoes.length && <div style={{ color: '#667085', fontSize: '0.82rem', padding: '6px 2px' }}>Nenhuma opção encontrada.</div>}{opcoes.map((opcao) => { const marcado = selecionadosNorm.has(normText(opcao)); return <label key={opcao} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', cursor: 'pointer', padding: '4px 2px' }}><input type="checkbox" checked={marcado} onChange={() => toggle(opcao)} /><span>{opcao}</span></label>; })}</div></div>}</div>;
}

function PainelUfs({ titulo, cor, ufs, onChange }) {
  const toggleUf = (uf) => onChange(ufs.includes(uf) ? ufs.filter((u) => u !== uf) : [...ufs, uf]);
  const toggleRegiao = (regUfs) => { const todas = regUfs.every((u) => ufs.includes(u)); onChange(todas ? ufs.filter((u) => !regUfs.includes(u)) : [...new Set([...ufs, ...regUfs])]); };
  const c = cor || '#9153F0';
  return <div><div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#444', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: 6 }}>{titulo}<span style={{ fontWeight: 400, color: '#888' }}>({ufs.length === 0 ? 'todos' : `${ufs.length} selecionados`})</span>{ufs.length > 0 && <button className="btn-secondary" style={{ padding: '1px 7px', fontSize: '0.72rem' }} onClick={() => onChange([])}>Limpar</button>}<button className="btn-secondary" style={{ padding: '1px 7px', fontSize: '0.72rem' }} onClick={() => onChange([...TODAS_UFS])}>Todos</button></div><div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: '0.3rem' }}>{REGIOES.map((reg) => { const ativas = reg.ufs.every((u) => ufs.includes(u)); return <button key={reg.label} style={{ fontSize: '0.73rem', padding: '2px 9px', borderRadius: 4, cursor: 'pointer', border: `1px solid ${ativas ? c : '#ccc'}`, background: ativas ? c : '#f5f5f5', color: ativas ? '#fff' : '#555', fontWeight: ativas ? 700 : 400 }} onClick={() => toggleRegiao(reg.ufs)}>{reg.label}</button>; })}</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>{TODAS_UFS.map((uf) => { const sel = ufs.includes(uf); return <button key={uf} onClick={() => toggleUf(uf)} style={{ padding: '2px 7px', fontSize: '0.73rem', borderRadius: 4, cursor: 'pointer', border: `1px solid ${sel ? c : '#ccc'}`, background: sel ? c : '#fff', color: sel ? '#fff' : '#555', fontWeight: sel ? 700 : 400 }}>{uf}</button>; })}</div></div>;
}

function Progresso({ etapaId, msg, pctVal }) {
  const idx = ETAPAS.findIndex((e) => e.id === etapaId);
  return <div style={{ marginTop: '0.75rem' }}><div style={{ display: 'flex', marginBottom: '0.5rem' }}>{ETAPAS.map((e, i) => { const feito = i < idx; const atual = i === idx; return <div key={e.id} style={{ flex: 1, textAlign: 'center', position: 'relative' }}>{i > 0 && <div style={{ position: 'absolute', left: 0, top: 10, width: '50%', height: 2, background: feito || atual ? '#9153F0' : '#ddd' }} />}{i < ETAPAS.length - 1 && <div style={{ position: 'absolute', right: 0, top: 10, width: '50%', height: 2, background: feito ? '#9153F0' : '#ddd' }} />}<div style={{ width: 20, height: 20, borderRadius: '50%', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.68rem', fontWeight: 700, position: 'relative', zIndex: 1, background: feito ? '#9153F0' : atual ? '#fff' : '#eee', border: `2px solid ${feito || atual ? '#9153F0' : '#ddd'}`, color: feito ? '#fff' : atual ? '#9153F0' : '#aaa' }}>{feito ? '✓' : i + 1}</div><div style={{ fontSize: '0.63rem', marginTop: 3, color: atual ? '#9153F0' : feito ? '#555' : '#bbb', fontWeight: atual ? 700 : 400 }}>{e.label}</div></div>; })}</div><div style={{ fontSize: '0.8rem', color: '#555', marginBottom: 5 }}>{msg}</div><div style={{ background: '#eee', borderRadius: 99, height: 8, overflow: 'hidden' }}><div style={{ background: 'linear-gradient(90deg,#9153F0,#6366f1)', height: '100%', borderRadius: 99, width: `${pctVal}%`, transition: 'width .4s' }} /></div>{pctVal > 0 && <div style={{ fontSize: '0.7rem', color: '#888', textAlign: 'right', marginTop: 2 }}>{pctVal}%</div>}</div>;
}

export default function PerdaRealizadoPage() {
  const workerRef = useRef(null);
  const [filtros, setFiltros] = useState({ inicio: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().slice(0, 10), fim: new Date().toISOString().slice(0, 10), canal: '', transportadoraRealizada: '', cidadeOrigem: '', ufsOrigem: [], ufsDestino: [] });
  const set = (k, v) => setFiltros((p) => ({ ...p, [k]: v }));
  const [status, setStatus] = useState('idle');
  const [etapaId, setEtapaId] = useState('');
  const [msg, setMsg] = useState('');
  const [pctVal, setPctVal] = useState(0);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [info, setInfo] = useState('');
  const [resultado, setResultado] = useState(null);
  const [filtrosBi, setFiltrosBi] = useState(FILTROS_BI_PADRAO);
  const [pagina, setPagina] = useState(0);
  const [aba, setAba] = useState('origens');
  const [ordem, setOrdem] = useState({ campo: 'perda', dir: 'desc' });

  useEffect(() => () => workerRef.current?.terminate(), []);
  const step = (id, m, p = 0) => { setEtapaId(id); setMsg(m); setPctVal(p); };
  const setBi = (k, v) => { setFiltrosBi((p) => ({ ...p, [k]: v })); setPagina(0); };
  const limparFiltrosBi = () => { setFiltrosBi(FILTROS_BI_PADRAO); setPagina(0); };

  const analisarLote = (payload) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/perdaRealizadoWorker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') setMsg(m.etapa);
      if (m.type === 'done') { worker.terminate(); resolve(m.result); }
      if (m.type === 'error') { worker.terminate(); reject(new Error(m.message)); }
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'Erro no worker.')); };
    worker.postMessage({ type: 'analisar-perda', ...payload });
  });

  const processar = async () => {
    workerRef.current?.terminate();
    setStatus('carregando'); setErro(''); setAviso(''); setInfo(''); setResultado(null);
    setFiltrosBi(FILTROS_BI_PADRAO);
    try {
      step('municipios', 'Carregando municípios IBGE...', 5);
      let municipios = [];
      try { ({ municipios } = await carregarMunicipiosIbgeComFallback({ permitirOficial: true })); } catch (e) { throw new Error(`Falha ao carregar municípios: ${e.message}`); }
      let vinculos = [];
      try { vinculos = await carregarVinculosTransportadoras(); } catch { }

      step('realizado', 'Buscando CT-es no Realizado oficial...', 15);
      const filtrosBase = { inicio: filtros.inicio, fim: filtros.fim, canal: filtros.canal, transportadoraRealizada: filtros.transportadoraRealizada || undefined, origem: filtros.cidadeOrigem || undefined };
      let { rows: realizados, totalCompativel, origem, totalBruto, diagnostico } = await buscarRealizadoRemotoParaPerda(filtrosBase, { limit: LIMITE_DB, totalMax: LIMITE_DB, municipios });
      realizados = realizados || [];
      if (filtros.ufsOrigem.length > 0) { const setUfs = new Set(filtros.ufsOrigem.map(normUf)); realizados = realizados.filter((c) => setUfs.has(normUf(c.ufOrigem))); }
      if (filtros.ufsDestino.length > 0) { const setUfs = new Set(filtros.ufsDestino.map(normUf)); realizados = realizados.filter((c) => setUfs.has(normUf(c.ufDestino))); }
      if (totalCompativel > LIMITE_DB) setAviso(`A base tem ${totalCompativel.toLocaleString('pt-BR')} CT-es compatíveis. Foram carregados ${LIMITE_DB.toLocaleString('pt-BR')}. Refine os filtros para analisar tudo.`);
      if (!realizados.length) { const detalhe = diagnostico ? ` Diagnóstico: ${diagnostico}` : totalBruto !== undefined ? ` Registros brutos consultados: ${totalBruto}.` : ''; setErro(`Nenhum CT-e encontrado no Realizado oficial para os filtros informados.${detalhe}`); setStatus('erro'); return; }

      const routeKeys = extrairRouteKeys(realizados, filtros.canal);
      const lotes = chunkArray(routeKeys, ROUTE_CHUNK_SIZE);
      const resultados = [];
      setStatus('processando');
      setInfo(`${realizados.length.toLocaleString('pt-BR')} CT-es · ${routeKeys.length.toLocaleString('pt-BR')} rotas. Processando em ${lotes.length} lotes para evitar timeout.`);

      for (let i = 0; i < lotes.length; i += 1) {
        const loteKeys = lotes[i];
        const loteSet = new Set(loteKeys);
        const ctesLote = realizados.filter((cte) => chavesCte(cte, filtros.canal).some((key) => loteSet.has(key)));
        const pctBase = 20 + Math.round((i / Math.max(lotes.length, 1)) * 70);
        step('tabelas', `Lote ${i + 1}/${lotes.length}: carregando tabelas de ${loteKeys.length} rotas...`, pctBase);
        const transportadoras = await buscarBaseSimulacaoPorRotasDb({ routeKeys: loteKeys, canal: filtros.canal || '' });
        if (!transportadoras.length) continue;
        step('analise', `Lote ${i + 1}/${lotes.length}: analisando ${ctesLote.length.toLocaleString('pt-BR')} CT-es...`, Math.min(95, pctBase + 5));
        const parcial = await analisarLote({ realizados: ctesLote, transportadoras, municipios, vinculos });
        resultados.push(parcial);
      }

      const consolidado = juntarResultados(resultados);
      if (!consolidado.detalhes.length && !consolidado.inativasDetalhes.length) {
        setErro('CT-es encontrados, mas nenhuma comparação válida foi gerada. Verifique se existem tabelas ativas, faixas/cotações e prazos válidos para as rotas.');
        setStatus('erro'); return;
      }
      setResultado({ ...consolidado, filtros: { ...filtros, origemDados: origem, totalBruto } });
      setStatus('pronto'); setPagina(0); setAba('origens'); step('analise', 'Concluído.', 100);
    } catch (e) { setErro(e.message || 'Erro inesperado.'); setStatus('erro'); }
  };

  const resultadoBi = useMemo(() => resultado ? recalcularResultadoBi(resultado, filtrosBi) : null, [resultado, filtrosBi]);
  const biAtivo = filtrosBiAtivos(filtrosBi);
  const opcoesBi = useMemo(() => {
    const detalhes = resultado?.detalhes || [];
    const inativasDetalhes = resultado?.inativasDetalhes || [];
    const origemInativas = inativasDetalhes.map((d) => {
      const [cidadeOrigem = '', ufOrigem = ''] = String(d.origem || '').split('/');
      const [cidadeDestino = '', ufDestino = ''] = String(d.destino || '').split('/');
      return { ...d, cidadeOrigem, ufOrigem, cidadeDestino, ufDestino, transportadoraGanhadora: d.transportadoraAtivaMaisBarata };
    });
    const base = [...detalhes, ...origemInativas];
    return {
      canais: opcoesUnicas(base, (d) => d.canal),
      ufsOrigem: opcoesUnicas(base, (d) => d.ufOrigem),
      ufsDestino: opcoesUnicas(base, (d) => d.ufDestino),
      cidadesOrigem: opcoesUnicas(base, (d) => d.cidadeOrigem),
      cidadesDestino: opcoesUnicas(base, (d) => d.cidadeDestino),
      transportadorasRealizadas: opcoesUnicas(base, (d) => d.transportadoraRealizada),
      transportadorasGanhadoras: opcoesUnicas(base, (d) => d.transportadoraGanhadora),
    };
  }, [resultado]);

  const detalhesVisiveis = useMemo(() => {
    if (!resultadoBi?.detalhes) return [];
    const lista = resultadoBi.detalhes;
    const { campo, dir } = ordem;
    return [...lista].sort((a, b) => { const va = a[campo] ?? 0; const vb = b[campo] ?? 0; return dir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1); });
  }, [resultadoBi, ordem]);

  const inativas = resultadoBi?.inativasDetalhes || [];
  const totalPags = Math.ceil(detalhesVisiveis.length / PAGE_SIZE);
  const pagAtual = detalhesVisiveis.slice(pagina * PAGE_SIZE, (pagina + 1) * PAGE_SIZE);
  const maxTop10 = resultadoBi?.top10Origens?.[0]?.perdaTotal || 1;
  const prazoResumo = useMemo(() => calcularResumoPrazo(resultadoBi), [resultadoBi]);
  const processando = status === 'carregando' || status === 'processando';
  const ordenarPor = (campo) => { setOrdem((p) => ({ campo, dir: p.campo === campo && p.dir === 'desc' ? 'asc' : 'desc' })); setPagina(0); };
  const Th = ({ campo, label }) => <th style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} onClick={() => ordenarPor(campo)}>{label} {ordem.campo === campo ? (ordem.dir === 'desc' ? '▼' : '▲') : ''}</th>;

  return <div className="page-shell">
    <div className="page-header"><span className="amd-mini-brand">Realizado · Análise</span><h1>Perda por Transportadora Mais Cara</h1><p>Compara o frete pago com a opção mais barata ativa disponível nas tabelas. O processamento é feito por lotes de rotas para evitar timeout.</p></div>
    <div className="panel-card" style={{ marginBottom: '1rem' }}><div className="panel-title" style={{ marginBottom: '0.75rem' }}>Filtros</div><div className="form-grid three" style={{ marginBottom: '1rem' }}><label className="field">Data início<input type="date" value={filtros.inicio} onChange={(e) => set('inicio', e.target.value)} /></label><label className="field">Data fim<input type="date" value={filtros.fim} onChange={(e) => set('fim', e.target.value)} /></label><label className="field">Canal<select value={filtros.canal} onChange={(e) => set('canal', e.target.value)}><option value="">Todos os canais</option>{CANAIS.map((c) => <option key={c} value={c}>{c}</option>)}</select></label><label className="field">Transportadora realizada<input placeholder="Nome da transportadora que carregou" value={filtros.transportadoraRealizada} onChange={(e) => set('transportadoraRealizada', e.target.value)} /></label><label className="field">Cidade de origem<input placeholder="Ex: São Paulo, Campinas..." value={filtros.cidadeOrigem} onChange={(e) => set('cidadeOrigem', e.target.value)} /></label></div><div style={{ marginBottom: '0.75rem', padding: '0.65rem', background: '#f8f6ff', borderRadius: 8, border: '1px solid #e0d8ff' }}><PainelUfs titulo="Estados de origem" cor="#9153F0" ufs={filtros.ufsOrigem} onChange={(v) => set('ufsOrigem', v)} /></div><div style={{ padding: '0.65rem', background: '#f0f7ff', borderRadius: 8, border: '1px solid #c8deff' }}><PainelUfs titulo="Estados de destino" cor="#2563eb" ufs={filtros.ufsDestino} onChange={(v) => set('ufsDestino', v)} /></div><div style={{ marginTop: '1rem' }}><button className="btn-primary" onClick={processar} disabled={processando} style={{ minWidth: 160 }}>{processando ? '⟳ Processando...' : '▶ Processar'}</button>{processando && <Progresso etapaId={etapaId} msg={msg} pctVal={pctVal} />}</div></div>
    {info && !processando && <div className="hint-box compact" style={{ marginBottom: '0.75rem', background: '#f0f7ff', border: '1px solid #c8deff' }}>ℹ️ {info}</div>}{aviso && <div className="hint-box compact" style={{ background: '#fffbf0', border: '1px solid #f0d080', marginBottom: '0.75rem' }}>⚠️ {aviso}</div>}{erro && <div className="hint-box compact" style={{ background: '#fff5f5', border: '1px solid #f5c6cb', marginBottom: '0.75rem' }}>⚠️ {erro}</div>}
    {resultadoBi && <><div className="panel-card" style={{ marginBottom: '1rem' }}><div className="panel-title" style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><span>Filtros da análise carregada</span><span style={{ fontSize: '0.78rem', color: '#667085', fontWeight: 500 }}>{biAtivo ? `${resultadoBi.totalCtes.toLocaleString('pt-BR')} de ${resultado.totalCtes.toLocaleString('pt-BR')} CT-es comparáveis` : 'Base completa carregada'}</span></div><div className="form-grid three" style={{ marginBottom: '0.75rem' }}><label className="field">Emissão início<input type="date" value={filtrosBi.emissaoInicio} onChange={(e) => setBi('emissaoInicio', e.target.value)} /></label><label className="field">Emissão fim<input type="date" value={filtrosBi.emissaoFim} onChange={(e) => setBi('emissaoFim', e.target.value)} /></label><MultiSelectBusca label="Canal" options={opcoesBi.canais} value={filtrosBi.canais} onChange={(v) => setBi('canais', v)} placeholder="Buscar canal..." /><MultiSelectBusca label="Transportadora realizada" options={opcoesBi.transportadorasRealizadas} value={filtrosBi.transportadorasRealizadas} onChange={(v) => setBi('transportadorasRealizadas', v)} placeholder="Buscar transportadora..." /><MultiSelectBusca label="Mais barata ativa" options={opcoesBi.transportadorasGanhadoras} value={filtrosBi.transportadorasGanhadoras} onChange={(v) => setBi('transportadorasGanhadoras', v)} placeholder="Buscar transportadora..." /><label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 22 }}><input type="checkbox" checked={filtrosBi.soPerda} onChange={(e) => setBi('soPerda', e.target.checked)} />Apenas CT-es com perda</label><MultiSelectBusca label="Cidade origem" options={opcoesBi.cidadesOrigem} value={filtrosBi.cidadesOrigem} onChange={(v) => setBi('cidadesOrigem', v)} placeholder="Buscar origem..." /><MultiSelectBusca label="Cidade destino" options={opcoesBi.cidadesDestino} value={filtrosBi.cidadesDestino} onChange={(v) => setBi('cidadesDestino', v)} placeholder="Buscar destino..." /><MultiSelectBusca label="UF origem" options={opcoesBi.ufsOrigem} value={filtrosBi.ufsOrigem} onChange={(v) => setBi('ufsOrigem', v)} placeholder="Buscar UF..." /><MultiSelectBusca label="UF destino" options={opcoesBi.ufsDestino} value={filtrosBi.ufsDestino} onChange={(v) => setBi('ufsDestino', v)} placeholder="Buscar UF..." /></div><button className="btn-secondary" onClick={limparFiltrosBi} disabled={!biAtivo}>Limpar filtros da análise</button></div><div className="summary-strip" style={{ flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}><Card label="CT-es comparáveis" valor={resultadoBi.totalCtes.toLocaleString('pt-BR')} cor="#9153F0" sub={biAtivo ? 'recorte filtrado' : 'com tabela ativa e prazo'} /><Card label="CT-es com perda" valor={resultadoBi.ctesComPerda.toLocaleString('pt-BR')} sub={pct(resultadoBi.totalCtes > 0 ? (resultadoBi.ctesComPerda / resultadoBi.totalCtes) * 100 : 0)} cor="#e67e22" /><Card label="Perda total" valor={fmt(resultadoBi.perdaTotal)} cor="#9b1111" destaque={resultadoBi.perdaTotal > 0} /><Card label="Mais barata com prazo menor" valor={pct(prazoResumo.pctMenor)} sub={`${prazoResumo.prazoMenor} CT-es · ${fmt(prazoResumo.perdaPrazoMenor)}`} cor="#04C7A4" /><Card label="Mais barata com prazo maior" valor={pct(prazoResumo.pctMaior)} sub={`${prazoResumo.prazoMaior} CT-es · ${fmt(prazoResumo.perdaPrazoMaior)}`} cor="#f59e0b" /><Card label="Inativas bloqueadas" valor={(resultadoBi.inativas || 0).toLocaleString('pt-BR')} sub={`potencial vs ativa: ${fmt(resultadoBi.economiaInativaTotal)}`} cor="#f59e0b" /><Card label="Sem comparação" valor={(resultado.semComparacao || resultado.semMalha || 0).toLocaleString('pt-BR')} sub={biAtivo ? 'total da carga inicial' : 'sem tabela, prazo ou realizada ativa'} cor="#888" /></div>
    <div style={{ display: 'flex', gap: 4, marginBottom: '0.5rem', borderBottom: '2px solid #eee', paddingBottom: '0.25rem', flexWrap: 'wrap' }}>{[{ id: 'origens', label: `Top 10 Origens (${resultadoBi.top10Origens.length})` }, { id: 'transportadoras', label: `Por Transportadora (${resultadoBi.porTransportadora.length})` }, { id: 'detalhes', label: `Detalhes (${detalhesVisiveis.length.toLocaleString('pt-BR')})` }, { id: 'inativas', label: `Inativas (${inativas.length.toLocaleString('pt-BR')})` }, { id: 'sem-malha', label: `Sem comparação (${resultado.semComparacao || resultado.semMalha || 0})` }].map((a) => <button key={a.id} onClick={() => { setAba(a.id); setPagina(0); }} style={{ padding: '4px 14px', border: 'none', borderRadius: '4px 4px 0 0', cursor: 'pointer', background: aba === a.id ? '#9153F0' : '#f0f0f0', color: aba === a.id ? '#fff' : '#555', fontWeight: aba === a.id ? 700 : 400, fontSize: '0.85rem' }}>{a.label}</button>)}</div>
    {aba === 'origens' && <div className="panel-card"><div className="panel-title" style={{ marginBottom: '0.75rem' }}>Top 10 origens por valor de perda</div>{resultadoBi.top10Origens.length === 0 ? <p style={{ color: '#888' }}>Nenhuma origem com perda encontrada.</p> : <div className="sim-analise-tabela-wrap"><table className="sim-analise-tabela"><thead><tr><th>#</th><th>Origem</th><th>CT-es</th><th>Perda total</th><th>% sobre pago</th><th style={{ minWidth: 120 }}>Visual</th></tr></thead><tbody>{resultadoBi.top10Origens.map((o, i) => <tr key={o.origem}><td style={{ fontWeight: 700, color: '#9153F0' }}>#{i + 1}</td><td><strong>{o.origem}</strong></td><td>{o.ctes.toLocaleString('pt-BR')}</td><td className="negativo" style={{ fontWeight: 700 }}>{fmt(o.perdaTotal)}</td><td>{pct(o.perdaPercentual)}</td><td><Barra valor={o.perdaTotal} maximo={maxTop10} cor="#9b1111" /></td></tr>)}</tbody></table></div>}</div>}
    {aba === 'transportadoras' && <div className="panel-card"><div className="panel-title" style={{ marginBottom: '0.75rem' }}>Perda por transportadora realizada</div><div className="sim-analise-tabela-wrap"><table className="sim-analise-tabela"><thead><tr><th>#</th><th>Transportadora realizada</th><th>CT-es</th><th>Perda total</th><th style={{ minWidth: 120 }}>Visual</th></tr></thead><tbody>{resultadoBi.porTransportadora.map((t, i) => <tr key={t.transportadora}><td style={{ fontWeight: 700, color: '#9153F0' }}>#{i + 1}</td><td><strong>{t.transportadora}</strong></td><td>{t.ctes.toLocaleString('pt-BR')}</td><td className="negativo" style={{ fontWeight: 700 }}>{fmt(t.perdaTotal)}</td><td><Barra valor={t.perdaTotal} maximo={resultadoBi.porTransportadora[0]?.perdaTotal || 1} cor="#e67e22" /></td></tr>)}</tbody></table></div></div>}
    {aba === 'detalhes' && <div className="panel-card"><div className="panel-title" style={{ marginBottom: '0.75rem' }}>Detalhamento por CT-e</div><div className="sim-analise-tabela-wrap"><table className="sim-analise-tabela"><thead><tr><th>CT-e</th><th>Emissão</th><th>Canal</th><th>Origem</th><th>Destino</th><th>Peso</th><Th campo="transportadoraRealizada" label="Transp. realizada" /><Th campo="transportadoraGanhadora" label="Mais barata ativa" /><Th campo="valorPago" label="Pago" /><Th campo="valorGanhadora" label="Mais barato" /><Th campo="perda" label="Perda" /><th>Prazo</th><th>Fonte prazo</th><th>Cálculo</th></tr></thead><tbody>{pagAtual.map((d) => <tr key={d.chaveCte} style={{ background: d.temPerda ? undefined : '#f8fff8' }}><td style={{ fontSize: '0.78rem', color: '#666' }}>{d.numeroCte || d.chaveCte?.slice(-8) || '-'}</td><td>{fmtData(d.emissao)}</td><td>{d.canal || '-'}</td><td>{d.cidadeOrigem}/{d.ufOrigem}</td><td>{d.cidadeDestino}/{d.ufDestino}</td><td>{Number(d.peso || 0).toLocaleString('pt-BR')} kg</td><td>{d.transportadoraRealizada}</td><td style={{ color: '#04C7A4', fontWeight: 600 }}>{d.transportadoraGanhadora}</td><td>{fmt(d.valorPago)}</td><td>{fmt(d.valorGanhadora)}</td><td className={d.temPerda ? 'negativo' : ''} style={{ fontWeight: d.temPerda ? 700 : 400 }}>{d.temPerda ? `${fmt(d.perda)} · ${pct(d.perdaPercentual)}` : '—'}</td><td>{d.prazoRealizada}d → {d.prazoGanhadora}d<br /><span style={{ color: d.difPrazo > 0 ? '#e67e22' : d.difPrazo < 0 ? '#04C7A4' : '#555' }}>{d.difPrazo > 0 ? `+${d.difPrazo}d` : d.difPrazo < 0 ? `${d.difPrazo}d` : 'Igual'}</span></td><td style={{ fontSize: '0.72rem', color: '#667085' }}>{d.fontePrazo || 'Tabela > Rota'}</td><td><DetalheCalculo item={d} /></td></tr>)}{!pagAtual.length && <tr><td colSpan={14}>Nenhum CT-e com esses filtros.</td></tr>}</tbody></table></div>{totalPags > 1 && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: '0.75rem' }}><button className="btn-secondary" onClick={() => setPagina(0)} disabled={pagina === 0}>«</button><button className="btn-secondary" onClick={() => setPagina((p) => p - 1)} disabled={pagina === 0}>‹</button><span style={{ fontSize: '0.85rem', color: '#555' }}>Página {pagina + 1} de {totalPags} · {detalhesVisiveis.length.toLocaleString('pt-BR')} registros</span><button className="btn-secondary" onClick={() => setPagina((p) => p + 1)} disabled={pagina >= totalPags - 1}>›</button><button className="btn-secondary" onClick={() => setPagina(totalPags - 1)} disabled={pagina >= totalPags - 1}>»</button></div>}</div>}
    {aba === 'inativas' && <div className="panel-card"><div className="panel-title" style={{ marginBottom: '0.75rem' }}>Transportadoras inativadas — potencial bloqueado</div><div className="summary-strip" style={{ marginBottom: '0.75rem' }}><Card label="Casos com inativa menor" valor={inativas.length.toLocaleString('pt-BR')} cor="#f59e0b" /><Card label="Potencial vs ativa" valor={fmt(resultadoBi.economiaInativaTotal)} cor="#f59e0b" /><Card label="Potencial vs pago" valor={fmt(resultadoBi.economiaInativaVsPagoTotal)} cor="#9b1111" /></div><p style={{ fontSize: '0.84rem', color: '#667085' }}>Essas transportadoras não entram no cálculo geral. A aba serve apenas para enxergar quanto poderia reduzir se alguma inativa voltasse a operar.</p><div className="sim-analise-tabela-wrap"><table className="sim-analise-tabela"><thead><tr><th>CT-e</th><th>Origem</th><th>Destino</th><th>Realizada</th><th>Inativa menor</th><th>Ativa mais barata</th><th>Valor inativa</th><th>Valor ativa</th><th>Potencial</th><th>Prazo</th><th>Fonte prazo</th><th>Cálculo</th></tr></thead><tbody>{inativas.slice(0, 500).map((d, i) => <tr key={`${d.chaveCte}-${i}`}><td>{d.numeroCte || d.chaveCte?.slice(-8) || '-'}</td><td>{d.origem}</td><td>{d.destino}</td><td>{d.transportadoraRealizada}</td><td><strong>{d.transportadoraInativa}</strong><br /><small>{d.statusInativa}</small></td><td>{d.transportadoraAtivaMaisBarata || '-'}</td><td>{fmt(d.valorInativa)}</td><td>{d.valorAtivaMaisBarata != null ? fmt(d.valorAtivaMaisBarata) : '-'}</td><td className="negativo" style={{ fontWeight: 700 }}>{fmt(d.economiaVsAtiva)}</td><td>{d.prazoInativa || '-'}d → {d.prazoAtivaMaisBarata || '-'}d</td><td style={{ fontSize: '0.72rem', color: '#667085' }}>{d.fontePrazo || 'Tabela > Rota'}</td><td><details><summary style={{ cursor: 'pointer', color: '#9153F0', fontWeight: 700 }}>Ver</summary><div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '0.75rem', background: '#fff8e8', borderRadius: 8, marginTop: 6 }}><CalculoBox titulo="Inativa" calc={d.detalheInativa} cor="#f59e0b" /><CalculoBox titulo="Ativa mais barata" calc={d.detalheAtiva} cor="#04C7A4" /></div></details></td></tr>)}{!inativas.length && <tr><td colSpan={12}>Nenhuma inativa menor que a ativa mais barata encontrada.</td></tr>}</tbody></table></div>{inativas.length > 500 && <p style={{ color: '#888', fontSize: '0.8rem' }}>Mostrando 500 primeiros registros. Refine os filtros para analisar menos itens.</p>}</div>}
    {aba === 'sem-malha' && <div className="panel-card"><div className="panel-title" style={{ marginBottom: '0.75rem' }}>CT-es sem comparação ({(resultado.semComparacao || resultado.semMalha || 0).toLocaleString('pt-BR')})</div><p style={{ fontSize: '0.85rem', color: '#888' }}>Esses CT-es não entraram na conta principal por falta de tabela ativa, faixa/cotação válida, prazo válido ou transportadora realizada encontrada nas tabelas ativas. Assim o relatório fica limpo apenas com casos realmente comparáveis.</p></div>}
    </>}
  </div>;
}
