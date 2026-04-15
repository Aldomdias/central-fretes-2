import { useMemo, useState } from 'react';
import { formatCurrency, simularFretes } from '../utils/calculoFrete';

const defaultForm = {
  transportadoraId: '',
  origemId: '',
  destino: '',
  pesoKg: '',
  valorNf: '',
  canal: 'TODOS',
};

function Breakdown({ item }) {
  return (
    <div className="breakdown-grid">
      <div><span>Base</span><strong>{formatCurrency(item.valorBase)}</strong></div>
      <div><span>Ad Valorem</span><strong>{formatCurrency(item.adValorem)}</strong></div>
      <div><span>GRIS</span><strong>{formatCurrency(item.gris)}</strong></div>
      <div><span>Pedágio</span><strong>{formatCurrency(item.pedagio)}</strong></div>
      <div><span>TAS</span><strong>{formatCurrency(item.tas)}</strong></div>
      <div><span>CTRC</span><strong>{formatCurrency(item.ctrc)}</strong></div>
      <div><span>TDA</span><strong>{formatCurrency(item.tda)}</strong></div>
      <div><span>TRT</span><strong>{formatCurrency(item.trt)}</strong></div>
      <div><span>SUFRAMA</span><strong>{formatCurrency(item.suframa)}</strong></div>
      <div><span>Outras</span><strong>{formatCurrency(item.outras)}</strong></div>
      <div><span>ICMS</span><strong>{formatCurrency(item.icms)}</strong></div>
      <div><span>Total</span><strong>{formatCurrency(item.total)}</strong></div>
    </div>
  );
}

export default function SimuladorPage({ transportadoras, onAbrirTransportadoras }) {
  const [modo, setModo] = useState('destino');
  const [form, setForm] = useState(defaultForm);
  const [simulado, setSimulado] = useState(false);

  const origensDisponiveis = useMemo(() => {
    return transportadoras.flatMap((t) =>
      (t.origens || []).map((o) => ({ id: o.id, label: `${t.nome} • ${o.cidade}`, transportadoraId: t.id })),
    );
  }, [transportadoras]);

  const resultados = useMemo(() => {
    if (!simulado) return [];
    return simularFretes({
      transportadoras,
      modo,
      transportadoraId: form.transportadoraId,
      origemId: form.origemId,
      destino: form.destino,
      pesoKg: form.pesoKg,
      valorNf: form.valorNf,
      canal: form.canal,
    });
  }, [transportadoras, modo, form, simulado]);

  const resumo = useMemo(() => {
    if (!resultados.length) return null;
    const melhor = resultados[0];
    const pior = resultados[resultados.length - 1];
    return {
      total: resultados.length,
      melhor,
      economia: pior.total - melhor.total,
    };
  }, [resultados]);

  const onChange = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>Simulador de Fretes</h1>
        <p>
          Simule fretes por destino com a mesma lógica do projeto anexo:
          cálculo por percentual ou faixa, taxa mínima, taxas especiais e ICMS.
        </p>
      </div>

      <div className="panel-card big-panel">
        <div className="panel-title">🧾 Parâmetros de Simulação</div>

        <div className="toggle-row">
          <button className={modo === 'destino' ? 'toggle-btn active' : 'toggle-btn'} onClick={() => setModo('destino')}>Origem x Destino</button>
          <button className={modo === 'transportadora' ? 'toggle-btn active' : 'toggle-btn'} onClick={() => setModo('transportadora')}>Por Transportadora</button>
        </div>

        <div className="form-grid three">
          <div className="field">
            <label>Transportadora {modo === 'transportadora' ? '' : '(opcional)'}</label>
            <select value={form.transportadoraId} onChange={(e) => onChange('transportadoraId', e.target.value)}>
              <option value="">Todas</option>
              {transportadoras.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Origem (opcional)</label>
            <select value={form.origemId} onChange={(e) => onChange('origemId', e.target.value)}>
              <option value="">Todas as origens</option>
              {origensDisponiveis
                .filter((item) => !form.transportadoraId || String(item.transportadoraId) === String(form.transportadoraId))
                .map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Destino</label>
            <input value={form.destino} onChange={(e) => onChange('destino', e.target.value)} placeholder="IBGE ou nome da rota" />
            <small>Exemplos: 3550308, 3106200, CAPITAL - SP, GOIAS</small>
          </div>
          <div className="field">
            <label>Peso (kg)</label>
            <input value={form.pesoKg} onChange={(e) => onChange('pesoKg', e.target.value)} placeholder="Ex: 150" />
          </div>
          <div className="field">
            <label>Valor da NF (R$)</label>
            <input value={form.valorNf} onChange={(e) => onChange('valorNf', e.target.value)} placeholder="Ex: 5000" />
          </div>
          <div className="field small-width">
            <label>Canal</label>
            <select value={form.canal} onChange={(e) => onChange('canal', e.target.value)}>
              <option value="TODOS">Todos os canais</option>
              <option value="ATACADO">ATACADO</option>
              <option value="B2C">B2C</option>
            </select>
          </div>
        </div>

        <div className="actions-right gap-row">
          <button className="btn-secondary" onClick={() => { setForm(defaultForm); setSimulado(false); }}>Limpar</button>
          <button className="btn-primary" onClick={() => setSimulado(true)}>Simular Fretes</button>
        </div>
      </div>

      {simulado && !resultados.length && (
        <div className="hint-box">
          Nenhuma rota encontrada com os parâmetros informados. Cadastre rotas, cotações ou ajuste o destino em <button className="btn-link inline-btn" onClick={onAbrirTransportadoras}>Transportadoras</button>.
        </div>
      )}

      {!!resultados.length && (
        <>
          <div className="summary-strip">
            <div className="summary-card"><span>Cenários</span><strong>{resumo.total}</strong></div>
            <div className="summary-card"><span>Melhor frete</span><strong>{formatCurrency(resumo.melhor.total)}</strong></div>
            <div className="summary-card"><span>Transportadora líder</span><strong>{resumo.melhor.transportadora}</strong></div>
            <div className="summary-card"><span>Economia vs pior cenário</span><strong>{formatCurrency(resumo.economia)}</strong></div>
          </div>

          <div className="list-stack">
            {resultados.map((item, index) => (
              <div className="result-card" key={`${item.transportadoraId}-${item.origemId}-${item.rota}-${index}`}>
                <div className="result-top">
                  <div>
                    <div className="result-title">{index === 0 ? '🏆 ' : ''}{item.transportadora} • {item.origem}</div>
                    <div className="list-subtitle">Rota {item.rota} • Destino {item.ibgeDestino} • Prazo {item.prazo} dia(s)</div>
                  </div>
                  <div className="result-price">{formatCurrency(item.total)}</div>
                </div>
                <div className="inline-meta wrap">
                  <span className="status-pill light neutral">{item.canal}</span>
                  <span className="status-pill light neutral">{item.tipoCalculo}</span>
                  <span>Critério vencedor: <strong>{item.criterio}</strong></span>
                  <span>Base: <strong>{formatCurrency(item.valorBase)}</strong></span>
                </div>
                <Breakdown item={item} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
