import React, { useEffect, useMemo, useState } from 'react';
import { baixarCsvRotasB2c, exportarRotasB2cDb, listarOrigensB2cDb } from '../services/rotasB2cExportService';

// Tela de download da malha B2C (transportadora x origem x destino x prazo).
// Pensada para ser liberada isoladamente a quem baixa a malha periodicamente.
export default function RotasB2cExportPage() {
  const [origens, setOrigens] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [transportadora, setTransportadora] = useState('');
  const [origemFiltro, setOrigemFiltro] = useState('');
  const [somenteVigentes, setSomenteVigentes] = useState(true);
  const [agrupar, setAgrupar] = useState(true);
  const [progresso, setProgresso] = useState(null);
  const [exportando, setExportando] = useState(false);
  const [resultado, setResultado] = useState(null);

  async function carregar() {
    setCarregando(true);
    setErro('');
    try {
      setOrigens(await listarOrigensB2cDb());
    } catch (e) {
      setErro(`Falha ao carregar origens B2C: ${e.message || e}`);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { carregar(); }, []);

  const transportadoras = useMemo(() => Array.from(new Set(origens.map((o) => o.transportadora))).sort(), [origens]);
  const cidadesOrigem = useMemo(() => Array.from(new Set(origens
    .filter((o) => !transportadora || o.transportadora === transportadora)
    .map((o) => o.origem))).sort(), [origens, transportadora]);

  const selecionadas = useMemo(() => origens.filter((o) => (!transportadora || o.transportadora === transportadora)
    && (!origemFiltro || o.origem === origemFiltro)), [origens, transportadora, origemFiltro]);

  async function baixar() {
    if (!selecionadas.length) return;
    setExportando(true);
    setErro('');
    setResultado(null);
    setProgresso({ etapa: 'Iniciando…', feitas: 0, total: selecionadas.length, linhas: 0 });
    try {
      const { linhas, semIbge } = await exportarRotasB2cDb({ origens: selecionadas, somenteVigentes, agrupar, onProgress: setProgresso });
      const data = new Date().toISOString().slice(0, 10);
      const sufixo = [transportadora, origemFiltro].filter(Boolean).join('-').replace(/[^\w-]+/g, '_');
      baixarCsvRotasB2c(linhas, agrupar, `rotas-b2c${sufixo ? `-${sufixo}` : ''}-${data}`);
      const porTransp = new Map();
      linhas.forEach((l) => porTransp.set(l.transportadora, (porTransp.get(l.transportadora) || 0) + 1));
      setResultado({ total: linhas.length, semIbge, porTransp: [...porTransp.entries()].sort((a, b) => b[1] - a[1]) });
    } catch (e) {
      setErro(`Falha na exportação: ${e.message || e}`);
    } finally {
      setExportando(false);
      setProgresso(null);
    }
  }

  const pct = progresso?.total ? Math.round((progresso.feitas / progresso.total) * 100) : 0;

  return (
    <div className="page-shell realizado-page">
      <div className="page-top between">
        <div className="page-header">
          <div className="amd-mini-brand">AMD Log • Malha B2C</div>
          <h1>Rotas B2C</h1>
          <p>Baixa todas as rotas B2C cadastradas: transportadora × origem × destino × prazo. Considera origens e transportadoras ativas com canal B2C, marketplace ou AMBOS.</p>
        </div>
        <div className="actions-right wrap">
          <button className="btn-secondary" onClick={carregar} disabled={carregando || exportando}>Atualizar</button>
        </div>
      </div>

      {erro ? <div className="sim-alert">{erro}</div> : null}

      <section className="sim-card">
        <div className="form-grid">
          <div className="field">
            <label>Transportadora</label>
            <select value={transportadora} onChange={(e) => { setTransportadora(e.target.value); setOrigemFiltro(''); }} disabled={carregando || exportando}>
              <option value="">Todas ({transportadoras.length})</option>
              {transportadoras.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Origem</label>
            <select value={origemFiltro} onChange={(e) => setOrigemFiltro(e.target.value)} disabled={carregando || exportando}>
              <option value="">Todas ({cidadesOrigem.length})</option>
              {cidadesOrigem.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Formato</label>
            <select value={agrupar ? 'municipio' : 'cep'} onChange={(e) => setAgrupar(e.target.value === 'municipio')} disabled={exportando}>
              <option value="municipio">1 linha por município de destino</option>
              <option value="cep">Detalhado por faixa de CEP</option>
            </select>
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
              <input type="checkbox" checked={somenteVigentes} onChange={(e) => setSomenteVigentes(e.target.checked)} disabled={exportando} />
              Somente rotas vigentes hoje
            </label>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
          <button className="btn-primary" onClick={baixar} disabled={carregando || exportando || !selecionadas.length}>
            {exportando ? 'Gerando arquivo…' : 'Baixar rotas (CSV)'}
          </button>
          <span className="status-pill">{carregando ? 'Carregando origens…' : `${selecionadas.length.toLocaleString('pt-BR')} origem(ns) selecionada(s)`}</span>
        </div>
        <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 8 }}>
          O arquivo sai em CSV separado por ponto e vírgula e abre direto no Excel. No formato por município, o prazo é o menor entre as faixas de CEP da cidade e a coluna “Prazo máximo” mostra o maior.
          A base toda pode levar alguns minutos — mantenha a tela aberta até o download.
        </p>
      </section>

      {progresso ? (
        <div className="sim-alert info">
          {progresso.feitas.toLocaleString('pt-BR')} de {progresso.total.toLocaleString('pt-BR')} origens ({pct}%) • {progresso.linhas.toLocaleString('pt-BR')} linhas • {progresso.etapa}
        </div>
      ) : null}

      {resultado ? (
        <section className="table-card">
          <div className="sim-parametros-header">
            <div className="panel-title">Arquivo gerado</div>
            <span className="status-pill">{resultado.total.toLocaleString('pt-BR')} linha(s)</span>
          </div>
          {resultado.total > 1048576 ? <div className="sim-alert">Passou de 1.048.576 linhas: o Excel não abre tudo numa aba. Filtre por transportadora ou use o formato por município.</div> : null}
          {resultado.semIbge ? <div className="sim-alert">{resultado.semIbge.toLocaleString('pt-BR')} rota(s) sem IBGE de destino (saem com o nome da rota).</div> : null}
          <table className="data-table">
            <thead><tr><th>Transportadora</th><th style={{ textAlign: 'right' }}>Linhas</th></tr></thead>
            <tbody>
              {resultado.porTransp.map(([t, n]) => (
                <tr key={t}><td>{t}</td><td style={{ textAlign: 'right' }}>{n.toLocaleString('pt-BR')}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
