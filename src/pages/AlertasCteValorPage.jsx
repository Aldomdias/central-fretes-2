import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  atualizarStatusAlertaCte,
  carregarConfigAlertaCte,
  enviarEmailAlertasPendentes,
  listarAlertasValorCte,
  salvarConfigAlertaCte,
  varrerBaseAlertasValorCte,
} from '../services/cteAlertasValorService';

const moeda = (n) => (n == null || n === '' ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dataBr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—');
const th = { textAlign: 'left', padding: '6px 8px', fontSize: 12, color: '#475569', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' };
const td = { padding: '5px 8px', fontSize: 12, borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' };
const LIMIARES_RAPIDOS = [10000, 15000, 20000, 30000];
const ROTULO_STATUS = { novo: 'Novo', ok: 'Verificado (ok)', anomalia: 'Anomalia' };
const COR_STATUS = { novo: '#b45309', ok: '#15803d', anomalia: '#b91c1c' };

function CalculoVerum({ alerta }) {
  if (alerta.valor_calculado_verum == null) return <span style={{ color: '#b45309', fontWeight: 600 }}>Sem cálculo na Verum</span>;
  const dif = Number(alerta.diferenca_verum || 0);
  const pct = Number(alerta.valor_calculado_verum) > 0 ? (dif / Number(alerta.valor_calculado_verum)) * 100 : 0;
  const bate = Math.abs(dif) <= 1;
  return (
    <div>
      <div>{moeda(alerta.valor_calculado_verum)}</div>
      <small style={{ color: bate ? '#15803d' : '#b91c1c' }}>
        {bate ? 'bate com o cobrado' : `${dif > 0 ? '+' : ''}${moeda(dif)} (${pct.toFixed(1)}%)`}
      </small>
    </div>
  );
}

export default function AlertasCteValorPage({ sessao }) {
  const usuario = sessao?.nome || sessao?.email || '';
  const [config, setConfig] = useState({ limiar: 10000, ativo: true, enviar_email: true, emails: '' });
  const [limiarEdit, setLimiarEdit] = useState('10000');
  const [alertas, setAlertas] = useState([]);
  const [status, setStatus] = useState('');
  const [visao, setVisao] = useState('0');
  const [busca, setBusca] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [msg, setMsg] = useState('');
  const [varredura, setVarredura] = useState({ inicio: '', fim: '' });
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      setAlertas(await listarAlertasValorCte({ status, limiarMinimo: Number(visao) || 0, busca }));
    } catch (e) {
      setMsg(e.message);
    } finally {
      setCarregando(false);
    }
  }, [status, visao, busca]);

  useEffect(() => {
    carregarConfigAlertaCte().then((c) => { setConfig(c); setLimiarEdit(String(c.limiar)); });
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const resumo = useMemo(() => ({
    qtd: alertas.length,
    total: alertas.reduce((s, a) => s + Number(a.valor_cte || 0), 0),
    novos: alertas.filter((a) => a.status === 'novo').length,
    semVerum: alertas.filter((a) => a.valor_calculado_verum == null).length,
  }), [alertas]);

  async function salvarConfig(parcial = {}) {
    setOcupado(true);
    try {
      const nova = { ...config, ...parcial, limiar: parcial.limiar ?? limiarEdit };
      await salvarConfigAlertaCte(nova, usuario);
      const salva = { ...nova, limiar: Number(nova.limiar) };
      setConfig(salva);
      setLimiarEdit(String(salva.limiar));
      setMsg(`Configuração salva. Próximas importações alertam CT-e a partir de ${moeda(salva.limiar)}.`);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function varrer() {
    setOcupado(true);
    setMsg('Varrendo a base oficial...');
    try {
      const n = await varrerBaseAlertasValorCte({ limiar: Number(limiarEdit), dataInicio: varredura.inicio, dataFim: varredura.fim });
      setMsg(`Varredura concluída: ${n.toLocaleString('pt-BR')} CT-e(s) a partir de ${moeda(limiarEdit)} (novos alertas entram como "Novo"; os já existentes foram mantidos).`);
      await carregar();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function enviarPendentes() {
    setOcupado(true);
    const r = await enviarEmailAlertasPendentes();
    setMsg(r.ok ? (r.enviados ? `E-mail enviado com ${r.enviados} CT-e(s).` : (r.aviso || 'Nenhum alerta pendente de e-mail.')) : (r.erro || 'Falha no envio.'));
    setOcupado(false);
    carregar();
  }

  async function marcar(alerta, novoStatus) {
    let observacao = alerta.observacao || '';
    if (novoStatus === 'anomalia') {
      const texto = window.prompt('Descreva a anomalia (opcional):', observacao);
      if (texto === null) return;
      observacao = texto;
    }
    try {
      await atualizarStatusAlertaCte(alerta.id, { status: novoStatus, observacao }, usuario);
      setAlertas((lista) => lista.map((a) => (a.id === alerta.id ? { ...a, status: novoStatus, observacao, analisado_por: usuario } : a)));
    } catch (e) {
      setMsg(e.message);
    }
  }

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <h1>Alerta de CT-e de valor alto</h1>
          <p>A cada importação, CT-e acima do limite são separados, enviados por e-mail e listados aqui para você identificar anomalias na hora — e não só no mês seguinte.</p>
        </div>
      </div>

      <div className="panel-card" style={{ display: 'grid', gap: 12 }}>
        <div className="panel-title">Configuração</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            Alertar CT-e a partir de (R$)
            <input type="number" min="1" step="500" value={limiarEdit} onChange={(e) => setLimiarEdit(e.target.value)} style={{ width: 140 }} />
          </label>
          {LIMIARES_RAPIDOS.map((v) => (
            <button key={v} type="button" className={Number(limiarEdit) === v ? 'btn-primary' : 'btn-secondary'} onClick={() => setLimiarEdit(String(v))}>{moeda(v).replace(',00', '')}</button>
          ))}
          <button type="button" className="btn-primary" disabled={ocupado} onClick={() => salvarConfig()}>Salvar limite</button>
          <span style={{ fontSize: 12, color: '#475569' }}>Em uso agora: <strong>{moeda(config.limiar)}</strong></span>
        </div>
        <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
          E-mails que recebem o alerta (separe por vírgula ou ponto e vírgula)
          <input type="text" value={config.emails} onChange={(e) => setConfig({ ...config, emails: e.target.value })} placeholder="fulano@empresa.com.br; ciclano@empresa.com.br" />
        </label>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
          <label><input type="checkbox" checked={config.ativo} onChange={(e) => setConfig({ ...config, ativo: e.target.checked })} /> Detectar na importação</label>
          <label><input type="checkbox" checked={config.enviar_email} onChange={(e) => setConfig({ ...config, enviar_email: e.target.checked })} /> Enviar e-mail automático</label>
          <button type="button" className="btn-secondary" disabled={ocupado} onClick={() => salvarConfig({ limiar: config.limiar })}>Salvar e-mails e opções</button>
          <button type="button" className="btn-secondary" disabled={ocupado} onClick={enviarPendentes}>Enviar e-mail dos pendentes agora</button>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end', borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
          <span style={{ fontSize: 12, color: '#475569' }}>Buscar no que já está na base (usa o limite acima):</span>
          <label style={{ fontSize: 12 }}>Emissão de <input type="date" value={varredura.inicio} onChange={(e) => setVarredura({ ...varredura, inicio: e.target.value })} /></label>
          <label style={{ fontSize: 12 }}>até <input type="date" value={varredura.fim} onChange={(e) => setVarredura({ ...varredura, fim: e.target.value })} /></label>
          <button type="button" className="btn-secondary" disabled={ocupado} onClick={varrer}>Varrer base</button>
        </div>
        {msg ? <div className="hint-box compact">{msg}</div> : null}
      </div>

      <div className="panel-card">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end', marginBottom: 10 }}>
          <label style={{ fontSize: 12 }}>Status
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ display: 'block' }}>
              <option value="">Todos</option>
              <option value="novo">Novos</option>
              <option value="anomalia">Anomalia</option>
              <option value="ok">Verificados (ok)</option>
            </select>
          </label>
          <label style={{ fontSize: 12 }}>Ver apenas a partir de
            <select value={visao} onChange={(e) => setVisao(e.target.value)} style={{ display: 'block' }}>
              <option value="0">Todos os alertas</option>
              {LIMIARES_RAPIDOS.map((v) => <option key={v} value={v}>{moeda(v)}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12 }}>Busca
            <input type="text" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="CT-e, transportadora, cidade" style={{ display: 'block' }} />
          </label>
          <span style={{ fontSize: 12, color: '#475569' }}>
            {resumo.qtd} CT-e(s) · {moeda(resumo.total)} · {resumo.novos} novo(s) · {resumo.semVerum} sem cálculo Verum
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                {['CT-e', 'Emissão', 'Transportadora', 'Canal', 'Rota', 'Peso (kg)', 'Valor NF', 'Valor cobrado', 'Cálculo Verum', 'Status', 'Ação'].map((h) => <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {carregando ? <tr><td style={td} colSpan={11}>Carregando...</td></tr> : null}
              {!carregando && !alertas.length ? <tr><td style={td} colSpan={11}>Nenhum alerta encontrado. Eles aparecem após a próxima importação ou ao usar “Varrer base”.</td></tr> : null}
              {alertas.map((a) => (
                <tr key={a.id}>
                  <td style={td}><strong>{a.numero_cte || '—'}</strong>{a.observacao ? <div style={{ color: '#64748b' }}>{a.observacao}</div> : null}</td>
                  <td style={td}>{dataBr(a.data_emissao)}</td>
                  <td style={td}>{a.transportadora || '—'}</td>
                  <td style={td}>{a.canal || '—'}</td>
                  <td style={td}>{[a.cidade_origem, a.uf_origem].filter(Boolean).join('/')} → {[a.cidade_destino, a.uf_destino].filter(Boolean).join('/')}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{a.peso != null ? Number(a.peso).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{moeda(a.valor_nf)}</td>
                  <td style={{ ...td, textAlign: 'right' }}><strong>{moeda(a.valor_cte)}</strong></td>
                  <td style={td}><CalculoVerum alerta={a} /></td>
                  <td style={{ ...td, color: COR_STATUS[a.status], fontWeight: 600 }}>{ROTULO_STATUS[a.status] || a.status}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button type="button" className="btn-secondary" onClick={() => marcar(a, 'ok')}>Ok</button>{' '}
                    <button type="button" className="btn-secondary" onClick={() => marcar(a, 'anomalia')}>Anomalia</button>
                    {a.status !== 'novo' ? <>{' '}<button type="button" className="btn-secondary" onClick={() => marcar(a, 'novo')}>Reabrir</button></> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
