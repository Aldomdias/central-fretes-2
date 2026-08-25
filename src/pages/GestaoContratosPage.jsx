import { useEffect, useMemo, useState } from 'react';
import { carregarGestaoContratos, carregarSemVinculoContratos, decidirNomePendente, listarCompetenciasContratos, listarTabelasTransportadorasContrato, salvarContrato, vincularNomePendente } from '../services/gestaoContratosService';
import { abrirLaudoGestaoContratos } from '../utils/laudoGestaoContratos';

const STATUS = [['sem_contrato', 'Sem contrato'], ['em_providencia', 'Em providência'], ['vigente', 'Contrato vigente'], ['vencido', 'Vencido'], ['dispensado', 'Dispensado']];
const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const pct = (n) => `${Number(n || 0).toFixed(1).replace('.', ',')}%`;
const mesLabel = (m) => m?.includes('-S') ? `${m.endsWith('S1') ? '1º' : '2º'} semestre de ${m.slice(0, 4)}` : m ? new Date(`${m}-02T00:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '';

export default function GestaoContratosPage({ sessao }) {
  const [competencias, setCompetencias] = useState([]);
  const [competencia, setCompetencia] = useState('');
  const [competenciaCarregada, setCompetenciaCarregada] = useState('');
  const [tipoPeriodo, setTipoPeriodo] = useState('mes');
  const [linhas, setLinhas] = useState([]);
  const [semVinculoDetalhes, setSemVinculoDetalhes] = useState([]);
  const [mostrarSemVinculo, setMostrarSemVinculo] = useState(false);
  const [tabelas, setTabelas] = useState([]);
  const [tabelaEscolhida, setTabelaEscolhida] = useState({});
  const [busca, setBusca] = useState('');
  const [soPareto, setSoPareto] = useState(true);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState('');

  useEffect(() => {
    Promise.all([listarCompetenciasContratos(), listarTabelasTransportadorasContrato()])
      .then(([lista, nomes]) => { setCompetencias(lista); setTabelas(nomes); })
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false));
  }, []);

  const visiveis = useMemo(() => linhas.filter((l) => (!soPareto || l.no_pareto) && (!busca || l.transportadora.toLowerCase().includes(busca.toLowerCase()))), [linhas, busca, soPareto]);
  const competenciasVisiveis = useMemo(() => competencias.filter((item) => tipoPeriodo === 'semestre' ? item.includes('-S') : !item.includes('-S')), [competencias, tipoPeriodo]);
  const pareto = linhas.filter((l) => l.no_pareto);
  const comContrato = pareto.filter((l) => l.status_contrato === 'vigente').length;
  const ctesPareto = pareto.reduce((s, l) => s + Number(l.ctes || 0), 0);
  const ctesComContrato = pareto.filter((l) => l.status_contrato === 'vigente').reduce((s, l) => s + Number(l.ctes || 0), 0);
  const coberturaContratada = ctesPareto ? (ctesComContrato / ctesPareto) * 100 : 0;
  const entradas = linhas.filter((l) => l.movimento === 'entrou').length;
  const semVinculo = Number(linhas[0]?.ctes_sem_vinculo || 0);

  function selecionarCompetencia(valor) {
    setCompetencia(valor);
    setCompetenciaCarregada('');
    setLinhas([]);
    setSemVinculoDetalhes([]);
    setMostrarSemVinculo(false);
  }

  async function buscarTransportadores() {
    if (!competencia) return;
    setCarregando(true); setErro('');
    try {
      const [ranking, pendentes] = await Promise.all([carregarGestaoContratos(competencia), carregarSemVinculoContratos(competencia)]);
      setLinhas(ranking); setSemVinculoDetalhes(pendentes); setCompetenciaCarregada(competencia);
    } catch (e) { setErro(e.message); } finally { setCarregando(false); }
  }

  async function atualizar(linha, campo, valor) {
    setSalvando(linha.transportadora); setErro('');
    try {
      const salvo = await salvarContrato(linha.transportadora, {
        status: linha.status_contrato || 'sem_contrato',
        inicio_vigencia: linha.inicio_vigencia || null,
        fim_vigencia: linha.fim_vigencia || null,
        observacoes: linha.observacoes || null,
        [campo]: valor || null,
      }, sessao);
      setLinhas((atuais) => atuais.map((item) => item.transportadora === linha.transportadora ? { ...item, status_contrato: salvo.status, inicio_vigencia: salvo.inicio_vigencia, fim_vigencia: salvo.fim_vigencia, observacoes: salvo.observacoes } : item));
    } catch (e) { setErro(e.message); } finally { setSalvando(''); }
  }

  async function recarregar() {
    const [ranking, pendentes] = await Promise.all([carregarGestaoContratos(competencia), carregarSemVinculoContratos(competencia)]);
    setLinhas(ranking); setSemVinculoDetalhes(pendentes);
  }

  async function decidir(item, valor) {
    setSalvando(item.nome_cte); setErro('');
    try { await decidirNomePendente(item.nome_cte, valor === '' ? null : valor === 'incluir', sessao); await recarregar(); } catch (e) { setErro(e.message); } finally { setSalvando(''); }
  }

  async function vincular(item) {
    const nomeTabela = tabelaEscolhida[item.nome_cte] || '';
    if (!tabelas.includes(nomeTabela)) { setErro('Selecione uma transportadora existente na lista de tabelas.'); return; }
    setSalvando(item.nome_cte); setErro('');
    try { await vincularNomePendente(item.nome_cte, nomeTabela); await recarregar(); } catch (e) { setErro(e.message); } finally { setSalvando(''); }
  }

  return <div className="contratos-page">
    <header className="contratos-header"><div><span className="contratos-kicker">SUPRIMENTOS · GOVERNANÇA</span><h1>Gestão de contratos</h1><p>Transportadores que concentram 80% dos CT-es, usando o nome padrão das tabelas.</p></div><div className="contratos-periodo"><span>Selecione o período antes de buscar os transportadores</span><div className="contratos-periodo-toggle"><button type="button" className={tipoPeriodo === 'mes' ? 'active' : ''} onClick={() => { setTipoPeriodo('mes'); selecionarCompetencia(''); }}>Mês</button><button type="button" className={tipoPeriodo === 'semestre' ? 'active' : ''} onClick={() => { setTipoPeriodo('semestre'); selecionarCompetencia(''); }}>Semestre</button></div><select aria-label="Competência" value={competencia} onChange={(e) => selecionarCompetencia(e.target.value)}><option value="">Escolha um período</option>{competenciasVisiveis.map((m) => <option key={m} value={m}>{mesLabel(m)}</option>)}</select><button type="button" className="contratos-buscar-btn" disabled={carregando || !competencia} onClick={buscarTransportadores}>{carregando ? 'Buscando...' : 'Buscar transportadores'}</button><button type="button" className="contratos-laudo-btn" disabled={carregando || !competenciaCarregada || !linhas.length} onClick={() => { try { abrirLaudoGestaoContratos({ periodo: mesLabel(competenciaCarregada), linhas, pendentes: semVinculoDetalhes, geradoPor: sessao?.nome || sessao?.email }); } catch (e) { setErro(e.message); } }}>Gerar laudo</button></div></header>
    {erro && <div className="contratos-alerta">{erro}</div>}
    {!competenciaCarregada && !carregando && <div className="contratos-estado-inicial"><strong>Escolha o mês ou semestre que deseja analisar.</strong><span>A carteira será carregada somente depois que você clicar em “Buscar transportadores”.</span></div>}
    {competenciaCarregada && <>
    <section className="contratos-cards"><article><span>Cobertura selecionada</span><strong>{pct(pareto.at(-1)?.percentual_acumulado)}</strong><small>{fmt(ctesPareto)} CT-es</small></article><article><span>Transportadores no 80%</span><strong>{fmt(pareto.length)}</strong><small>nomes canônicos vinculados</small></article><article><span>CT-es com contrato vigente</span><strong>{pct(coberturaContratada)}</strong><small>{fmt(ctesComContrato)} de {fmt(ctesPareto)} CT-es · {comContrato}/{pareto.length} transportadores</small></article><article className={entradas ? 'attention' : ''}><span>Entraram no período</span><strong>{entradas}</strong><small>exigem conferência</small></article></section>
    {semVinculoDetalhes.length > 0 && <><div className="contratos-aviso"><div><strong>{fmt(semVinculo)} CT-es ainda fora do cálculo.</strong> Decida se inclui o nome provisoriamente ou vincule à tabela correta.</div><button type="button" onClick={() => setMostrarSemVinculo((v) => !v)}>{mostrarSemVinculo ? 'Ocultar nomes' : `Tratar ${semVinculoDetalhes.length} nomes`}</button></div>{mostrarSemVinculo && <section className="contratos-pendentes"><div className="contratos-pendentes-head"><div><h2>Nomes do CT-e sem vínculo</h2><p>O vínculo com uma tabela é a opção definitiva e recomendada.</p></div></div><datalist id="contratos-tabelas-lista">{tabelas.map((nome) => <option key={nome} value={nome} />)}</datalist><div className="contratos-table-wrap"><table className="contratos-table contratos-table-pendentes"><thead><tr><th>Nome original no CT-e</th><th>CT-es</th><th>Canais</th><th>Incluir?</th><th>Encontrar tabela e vincular</th></tr></thead><tbody>{semVinculoDetalhes.map((item) => <tr key={item.nome_cte}><td><strong>{item.nome_cte}</strong></td><td>{fmt(item.ctes)}</td><td>{(item.canais || []).join(', ')}</td><td><select disabled={salvando === item.nome_cte} value={item.incluir === true ? 'incluir' : item.incluir === false ? 'excluir' : ''} onChange={(e) => decidir(item, e.target.value)}><option value="">A decidir</option><option value="incluir">Incluir</option><option value="excluir">Não incluir</option></select></td><td><div className="contratos-vincular"><input list="contratos-tabelas-lista" placeholder="Buscar nome da tabela" value={tabelaEscolhida[item.nome_cte] || ''} onChange={(e) => setTabelaEscolhida((atual) => ({ ...atual, [item.nome_cte]: e.target.value }))} /><button type="button" disabled={salvando === item.nome_cte} onClick={() => vincular(item)}>Vincular</button></div></td></tr>)}</tbody></table></div></section>}</>}
    <section className="contratos-panel"><div className="contratos-toolbar"><div><h2>Carteira de {mesLabel(competenciaCarregada)}</h2><p>A última transportadora pode fazer a cobertura ultrapassar 80%.</p></div><input placeholder="Buscar transportador" value={busca} onChange={(e) => setBusca(e.target.value)} /><label className="contratos-check"><input type="checkbox" checked={soPareto} onChange={(e) => setSoPareto(e.target.checked)} /> Somente 80%</label></div><div className="contratos-explicacao"><div><strong>Participação na carteira</strong><span>CT-es da transportadora ÷ total de CT-es que formam a carteira dos 80%.</span></div><div><strong>Acumulado do ranking</strong><span>Soma sobre o universo total, usada para identificar quando o ranking alcança 80%.</span></div><small>Os CT-es pendentes mostrados no alerta acima ainda estão fora do cálculo.</small></div>
      <div className="contratos-table-wrap"><table className="contratos-table"><thead><tr><th>#</th><th>Transportador (nome da tabela)</th><th>Movimento</th><th>CT-es</th><th title="Percentual individual dentro da carteira selecionada de 80%">Participação na carteira</th><th title="Soma sobre o universo total até esta linha">Acumulado até aqui</th><th>Status do contrato</th><th>Início</th><th>Fim</th><th>Observações</th></tr></thead><tbody>{carregando ? <tr><td colSpan="10" className="empty">Calculando a curva de 80%...</td></tr> : visiveis.map((l) => <tr key={l.transportadora} className={l.no_pareto ? 'pareto' : ''}><td>{l.posicao || '—'}</td><td><strong>{l.transportadora}</strong></td><td><span className={`movimento ${l.movimento}`}>{l.movimento === 'entrou' ? '↑ Entrou' : l.movimento === 'saiu' ? '↓ Saiu' : l.movimento === 'permaneceu' ? '• Permaneceu' : 'Fora'}</span></td><td>{fmt(l.ctes)}</td><td>{l.no_pareto && ctesPareto ? pct(Number(l.ctes || 0) / ctesPareto * 100) : '—'}</td><td><b>{pct(l.percentual_acumulado)}</b></td><td><select disabled={salvando === l.transportadora} value={l.status_contrato || 'sem_contrato'} onChange={(e) => atualizar(l, 'status', e.target.value)}>{STATUS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></td><td><input type="date" value={l.inicio_vigencia || ''} onChange={(e) => atualizar(l, 'inicio_vigencia', e.target.value)} /></td><td><input type="date" value={l.fim_vigencia || ''} onChange={(e) => atualizar(l, 'fim_vigencia', e.target.value)} /></td><td><input placeholder="Adicionar nota" defaultValue={l.observacoes || ''} onBlur={(e) => { if (e.target.value !== (l.observacoes || '')) atualizar(l, 'observacoes', e.target.value); }} /></td></tr>)}</tbody></table></div>
    </section></>}
  </div>;
}
