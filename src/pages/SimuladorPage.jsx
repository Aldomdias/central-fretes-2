import { useMemo, useState } from 'react';
import { formatCurrency, formatPercent, simularFretes } from '../utils/calculoFrete';

const defaultForm = {
  transportadoraId: '',
  origemBusca: '',
  origemIbge: '',
  destinoBusca: '',
  destinoIbge: '',
  pesoKg: '',
  valorNf: '',
  canal: 'TODOS',
};

function ExportButton({ resultados }) {
  const exportarCsv = () => {
    const cabecalho = [
      'Transportadora', 'Origem', 'IBGE Origem', 'Destino/Rota', 'IBGE Destino', 'Prazo', 'Canal',
      'Tipo de cálculo', 'Critério', 'Faixa aplicada', 'Base', 'Ad Valorem', 'GRIS', 'Pedágio', 'TAS',
      'CTRC', 'TDA', 'TDR', 'TRT', 'SUFRAMA', 'Outras', 'ICMS', 'Total',
      'Melhor trecho', 'Valor melhor trecho', 'Diferença para melhor', '% redução necessária',
    ];

    const linhas = resultados.map((item) => [
      item.transportadora,
      item.origem,
      item.ibgeOrigem,
      item.rota,
      item.ibgeDestino,
      item.prazo,
      item.canal,
      item.tipoCalculo,
      item.criterio,
      item.faixaAplicada,
      item.valorBase,
      item.adValorem,
      item.gris,
      item.pedagio,
      item.tas,
      item.ctrc,
      item.tda,
      item.tdr,
      item.trt,
      item.suframa,
      item.outras,
      item.icms,
      item.total,
      item.melhorTrecho,
      item.melhorTrechoValor,
      item.diferencaParaMelhor,
      item.percentualReducaoNecessaria,
    ]);

    const csv = [cabecalho, ...linhas]
      .map((linha) => linha.map((valor) => `"${String(valor ?? '').replace(/"/g, '""')}"`).join(';'))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'relatorio-simulacao-fretes.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return <button className="btn-secondary" onClick={exportarCsv}>Exportar relatório</button>;
}

function DetailBreakdown({ item }) {
  return (
    <div className="sim-detail-grid">
      <div className="detail-box">
        <div className="detail-box-title">Como chegou no frete base</div>
        <div className="detail-line"><span>Tipo de cálculo</span><strong>{item.tipoCalculo}</strong></div>
        <div className="detail-line"><span>Critério aplicado</span><strong>{item.criterio}</strong></div>
        <div className="detail-line"><span>Faixa aplicada</span><strong>{item.faixaAplicada}</strong></div>
        <div className="detail-line"><span>Mínimo da rota</span><strong>{formatCurrency(item.minimoRota)}</strong></div>
        <div className="detail-line"><span>Valor por peso</span><strong>{formatCurrency(item.valorPeso)}</strong></div>
        <div className="detail-line"><span>Valor percentual</span><strong>{formatCurrency(item.valorPercentual)}</strong></div>
        <div className="detail-line"><span>Valor da faixa</span><strong>{formatCurrency(item.valorFaixa)}</strong></div>
        <div className="detail-line"><span>Excedente</span><strong>{formatCurrency(item.valorExcedente)}</strong></div>
        <div className="detail-line total"><span>Frete base</span><strong>{formatCurrency(item.valorBase)}</strong></div>
      </div>

      <div className="detail-box">
        <div className="detail-box-title">Composição final do frete</div>
        <div className="detail-line"><span>Ad Valorem</span><strong>{formatCurrency(item.adValorem)}</strong></div>
        <div className="detail-line"><span>GRIS</span><strong>{formatCurrency(item.gris)}</strong></div>
        <div className="detail-line"><span>Pedágio</span><strong>{formatCurrency(item.pedagio)}</strong></div>
        <div className="detail-line"><span>TAS</span><strong>{formatCurrency(item.tas)}</strong></div>
        <div className="detail-line"><span>CTRC</span><strong>{formatCurrency(item.ctrc)}</strong></div>
        <div className="detail-line"><span>TDA</span><strong>{formatCurrency(item.tda)}</strong></div>
        <div className="detail-line"><span>TDR</span><strong>{formatCurrency(item.tdr)}</strong></div>
        <div className="detail-line"><span>TRT</span><strong>{formatCurrency(item.trt)}</strong></div>
        <div className="detail-line"><span>SUFRAMA</span><strong>{formatCurrency(item.suframa)}</strong></div>
        <div className="detail-line"><span>Outras</span><strong>{formatCurrency(item.outras)}</strong></div>
        <div className="detail-line"><span>ICMS</span><strong>{formatCurrency(item.icms)} {item.aliquotaIcmsAplicada ? `(${formatPercent(item.aliquotaIcmsAplicada)})` : ''}</strong></div>
        <div className="detail-line total"><span>Total final</span><strong>{formatCurrency(item.total)}</strong></div>
      </div>
    </div>
  );
}

export default function SimuladorPage({ transportadoras, onAbrirTransportadoras }) {
  const [modo, setModo] = useState('destino');
  const [form, setForm] = useState(defaultForm);
  const [simulado, setSimulado] = useState(false);
  const [detalhesAbertos, setDetalhesAbertos] = useState({});

  const resultados = useMemo(() => {
    if (!simulado) return [];
    return simularFretes({
      transportadoras,
      modo,
      transportadoraId: form.transportadoraId,
      origemBusca: form.origemBusca,
      origemIbge: form.origemIbge,
      destinoBusca: form.destinoBusca,
      destinoIbge: form.destinoIbge,
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
      pior,
      economia: Math.max(0, pior.total - melhor.total),
      savingPercentual: pior.total > 0 ? ((pior.total - melhor.total) / pior.total) * 100 : 0,
    };
  }, [resultados]);

  const onChange = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const toggleDetalhes = (key) => {
    setDetalhesAbertos((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const limpar = () => {
    setForm(defaultForm);
    setSimulado(false);
    setDetalhesAbertos({});
  };

  const ajudaDestino = modo === 'transportadora'
    ? 'Deixe o destino em branco para simular todos os destinos da transportadora, ou preencha para restringir.'
    : 'Informe pelo menos o destino por nome/rota ou pelo IBGE do destino.';

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>Simulador de Fretes</h1>
        <p>
          Agora a simulação aceita origem por cidade ou IBGE, destino por rota ou IBGE,
          simulação completa por transportadora e detalhamento recolhido para não poluir a leitura.
        </p>
      </div>

      <div className="panel-card big-panel">
        <div className="panel-title">🧾 Parâmetros de Simulação</div>

        <div className="toggle-row">
          <button className={modo === 'destino' ? 'toggle-btn active' : 'toggle-btn'} onClick={() => setModo('destino')}>Origem x Destino</button>
          <button className={modo === 'transportadora' ? 'toggle-btn active' : 'toggle-btn'} onClick={() => setModo('transportadora')}>Por transportadora</button>
        </div>

        <div className="form-grid three">
          <div className="field">
            <label>Transportadora</label>
            <select value={form.transportadoraId} onChange={(e) => onChange('transportadoraId', e.target.value)}>
              <option value="">Todas</option>
              {transportadoras.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
            </select>
          </div>

          <div className="field">
            <label>Origem por cidade</label>
            <input value={form.origemBusca} onChange={(e) => onChange('origemBusca', e.target.value)} placeholder="Ex: Itajaí, Bauru, Barueri" />
            <small>Busca a origem só pela cidade, sem depender da transportadora.</small>
          </div>

          <div className="field">
            <label>Origem por IBGE</label>
            <input value={form.origemIbge} onChange={(e) => onChange('origemIbge', e.target.value)} placeholder="Ex: 4218203" />
          </div>

          <div className="field">
            <label>Destino / nome da rota</label>
            <input value={form.destinoBusca} onChange={(e) => onChange('destinoBusca', e.target.value)} placeholder="Ex: Bauru, CAPITAL - SP, GOIAS" />
            <small>{ajudaDestino}</small>
          </div>

          <div className="field">
            <label>Destino por IBGE</label>
            <input value={form.destinoIbge} onChange={(e) => onChange('destinoIbge', e.target.value)} placeholder="Ex: 3550308" />
            <small>Essa busca agora é tratada separadamente para não falhar no IBGE.</small>
          </div>

          <div className="field small-width">
            <label>Canal</label>
            <select value={form.canal} onChange={(e) => onChange('canal', e.target.value)}>
              <option value="TODOS">Todos os canais</option>
              <option value="ATACADO">ATACADO</option>
              <option value="B2C">B2C</option>
            </select>
          </div>

          <div className="field">
            <label>Peso (kg)</label>
            <input value={form.pesoKg} onChange={(e) => onChange('pesoKg', e.target.value)} placeholder="Ex: 150" />
          </div>

          <div className="field">
            <label>Valor da NF (R$)</label>
            <input value={form.valorNf} onChange={(e) => onChange('valorNf', e.target.value)} placeholder="Ex: 5000" />
          </div>
        </div>

        <div className="actions-right gap-row">
          <button className="btn-secondary" onClick={limpar}>Limpar</button>
          <button className="btn-primary" onClick={() => setSimulado(true)}>Simular fretes</button>
        </div>
      </div>

      {simulado && !resultados.length && (
        <div className="hint-box">
          Nenhuma rota encontrada com os parâmetros informados. Confira origem, destino, IBGE e faixas cadastradas em{' '}
          <button className="btn-link inline-btn" onClick={onAbrirTransportadoras}>Transportadoras</button>.
        </div>
      )}

      {!!resultados.length && (
        <>
          <div className="summary-strip five-cols">
            <div className="summary-card"><span>Cenários</span><strong>{resumo.total}</strong></div>
            <div className="summary-card"><span>Melhor frete</span><strong>{formatCurrency(resumo.melhor.total)}</strong></div>
            <div className="summary-card"><span>Líder</span><strong>{resumo.melhor.transportadora}</strong></div>
            <div className="summary-card"><span>Saving vs pior</span><strong>{formatCurrency(resumo.economia)}</strong></div>
            <div className="summary-card"><span>Saving %</span><strong>{formatPercent(resumo.savingPercentual)}</strong></div>
          </div>

          <div className="actions-right gap-row no-top-margin">
            <ExportButton resultados={resultados} />
          </div>

          <div className="list-stack">
            {resultados.map((item, index) => {
              const key = `${item.transportadoraId}-${item.origemId}-${item.ibgeDestino}-${index}`;
              const aberto = !!detalhesAbertos[key];
              return (
                <div className="result-card" key={key}>
                  <div className="result-top">
                    <div>
                      <div className="result-title">{index === 0 ? '🏆 ' : ''}{item.transportadora}</div>
                      <div className="list-subtitle">Origem {item.origem} ({item.ibgeOrigem}) • Destino {item.rota} ({item.ibgeDestino}) • Prazo {item.prazo} dia(s)</div>
                    </div>
                    <div className="result-price">{formatCurrency(item.total)}</div>
                  </div>

                  <div className="inline-meta wrap sim-meta-grid">
                    <span className="status-pill light neutral">{item.canal}</span>
                    <span className="status-pill light neutral">{item.tipoCalculo}</span>
                    <span>Frete base: <strong>{formatCurrency(item.valorBase)}</strong></span>
                    <span>ICMS aplicado: <strong>{item.aliquotaIcmsAplicada ? formatPercent(item.aliquotaIcmsAplicada) : 'Não'}</strong></span>
                    {item.perdeuTrecho ? (
                      <>
                        <span>Diferença para o líder: <strong>{formatCurrency(item.diferencaParaMelhor)}</strong></span>
                        <span>Redução necessária: <strong>{formatPercent(item.percentualReducaoNecessaria)}</strong></span>
                      </>
                    ) : (
                      <span>Melhor cenário deste trecho</span>
                    )}
                  </div>

                  <div className="result-actions-row">
                    <button className="btn-secondary btn-small" onClick={() => toggleDetalhes(key)}>
                      {aberto ? 'Ocultar detalhes' : 'Ver detalhes'}
                    </button>
                  </div>

                  {aberto && <DetailBreakdown item={item} />}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
