import { useEffect, useState } from 'react';
import {
  consultarFaixasCepIbgeDb,
  consultarMunicipiosIbge,
  diagnosticarBaseIbgeSupabase,
  sincronizarIbgeOficialSupabase,
} from '../services/ibgeService';

const UFS = ['', 'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

export default function ConsultaIbgePage() {
  const [termo, setTermo] = useState('');
  const [uf, setUf] = useState('');
  const [resultados, setResultados] = useState([]);
  const [diagnostico, setDiagnostico] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [progresso, setProgresso] = useState(null);
  const [faixasCep, setFaixasCep] = useState({});

  async function atualizarDiagnostico() {
    const diag = await diagnosticarBaseIbgeSupabase();
    setDiagnostico(diag);
    return diag;
  }

  useEffect(() => {
    atualizarDiagnostico().catch(() => null);
  }, []);

  async function pesquisar(event) {
    event?.preventDefault?.();
    setCarregando(true);
    setErro('');
    setFeedback('');
    try {
      const rows = await consultarMunicipiosIbge({ termo, uf, limite: 120, usarOficialSeVazio: true });
      setResultados(rows);
      setFeedback(rows.length ? `${rows.length.toLocaleString('pt-BR')} município(s) localizado(s).` : 'Nenhum município encontrado. Tente pesquisar sem acento ou apenas parte do nome.');
      await atualizarDiagnostico();
    } catch (error) {
      setErro(error.message || 'Erro ao consultar base IBGE.');
    } finally {
      setCarregando(false);
    }
  }

  async function sincronizar() {
    setSincronizando(true);
    setErro('');
    setFeedback('');
    setProgresso({ salvos: 0, total: 0 });
    try {
      const result = await sincronizarIbgeOficialSupabase({
        onProgress: ({ salvos, total }) => setProgresso({ salvos, total }),
      });
      setFeedback(`Base IBGE sincronizada no Supabase: ${result.salvos.toLocaleString('pt-BR')} município(s) salvos.`);
      await atualizarDiagnostico();
      if (termo || uf) await pesquisar();
    } catch (error) {
      setErro(error.message || 'Erro ao sincronizar IBGE no Supabase. Rode o SQL da pasta supabase se a tabela ainda não existir.');
    } finally {
      setSincronizando(false);
      setTimeout(() => setProgresso(null), 2500);
    }
  }

  async function carregarFaixas(ibge) {
    const codigo = String(ibge || '');
    if (!codigo) return;
    if (faixasCep[codigo]) {
      setFaixasCep((prev) => ({ ...prev, [codigo]: null }));
      return;
    }
    const rows = await consultarFaixasCepIbgeDb(codigo);
    setFaixasCep((prev) => ({ ...prev, [codigo]: rows.length ? rows : [] }));
  }

  return (
    <div className="page-shell realizado-page">
      <div className="page-top between">
        <div className="page-header">
          <div className="amd-mini-brand">AMD Log • Base IBGE</div>
          <h1>Consulta IBGE</h1>
          <p>
            Base oficial para resolver origem/destino com cidade, UF, código IBGE e faixa de CEP. Essa tela ajuda a validar se o Supabase está com a referência completa.
          </p>
        </div>
        <div className="actions-right wrap">
          <button className="btn-secondary" onClick={atualizarDiagnostico} disabled={carregando || sincronizando}>Atualizar diagnóstico</button>
          <button className="btn-primary" onClick={sincronizar} disabled={sincronizando || carregando}>
            {sincronizando ? 'Sincronizando...' : 'Sincronizar IBGE no Supabase'}
          </button>
        </div>
      </div>

      {erro ? <div className="sim-alert">{erro}</div> : null}
      {feedback ? <div className="sim-alert info">{feedback}</div> : null}
      {diagnostico ? (
        <div className={diagnostico.total >= 5000 ? 'sim-alert success' : 'sim-alert'}>
          <strong>Status Supabase IBGE:</strong> {diagnostico.conectado ? 'conectado' : 'não configurado'} • tabela: {diagnostico.existe ? 'encontrada' : 'não encontrada'} • municípios: {Number(diagnostico.total || 0).toLocaleString('pt-BR')} • faixas CEP: {Number(diagnostico.faixasCep || 0).toLocaleString('pt-BR')}
          {diagnostico.erro ? <span> • {diagnostico.erro}</span> : null}
        </div>
      ) : null}

      {progresso ? (
        <div className="sim-alert info">
          Sincronizando IBGE: {Number(progresso.salvos || 0).toLocaleString('pt-BR')} de {Number(progresso.total || 0).toLocaleString('pt-BR')} município(s).
        </div>
      ) : null}

      <section className="sim-card">
        <form className="form-grid consulta-ibge-form" onSubmit={pesquisar}>
          <div className="field">
            <label>Cidade, código IBGE ou parte do nome</label>
            <input value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Ex.: Itajaí, Itajai, São Paulo, 4208203" />
          </div>
          <div className="field">
            <label>UF</label>
            <select value={uf} onChange={(e) => setUf(e.target.value)}>
              {UFS.map((item) => <option key={item || 'todos'} value={item}>{item || 'Todas'}</option>)}
            </select>
          </div>
          <div className="field consulta-ibge-button-wrap">
            <label>&nbsp;</label>
            <button className="btn-primary" type="submit" disabled={carregando || sincronizando}>{carregando ? 'Pesquisando...' : 'Pesquisar IBGE'}</button>
          </div>
        </form>
      </section>

      <section className="table-card">
        <div className="sim-parametros-header">
          <div>
            <div className="panel-title">Resultado da consulta</div>
            <p>Pesquisa com normalização de acento e fallback oficial quando a tabela do Supabase estiver vazia.</p>
          </div>
          <span className="status-pill">{resultados.length.toLocaleString('pt-BR')} resultado(s)</span>
        </div>
        <div className="sim-table-wrap">
          <table className="sim-table">
            <thead>
              <tr><th>Cidade</th><th>UF</th><th>IBGE</th><th>Fonte</th><th>Faixa CEP</th></tr>
            </thead>
            <tbody>
              {resultados.length ? resultados.map((item) => (
                <tr key={`${item.ibge}-${item.uf}`}>
                  <td>{item.cidade}</td>
                  <td>{item.uf}</td>
                  <td><strong>{item.ibge}</strong></td>
                  <td>{item.fonte || '—'}</td>
                  <td>
                    <button className="btn-link" onClick={() => carregarFaixas(item.ibge)} type="button">{faixasCep[item.ibge] ? 'Recolher' : 'Ver CEP'}</button>
                    {Array.isArray(faixasCep[item.ibge]) ? (
                      <div className="import-meta-box">
                        {faixasCep[item.ibge].length ? faixasCep[item.ibge].map((faixa) => (
                          <div key={`${item.ibge}-${faixa.ordem}-${faixa.cepInicial}`}>{faixa.cepInicial || '—'} até {faixa.cepFinal || '—'}</div>
                        )) : <span>Nenhuma faixa CEP cadastrada para este município.</span>}
                      </div>
                    ) : null}
                  </td>
                </tr>
              )) : <tr><td colSpan="5">Pesquise uma cidade para validar o IBGE.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
