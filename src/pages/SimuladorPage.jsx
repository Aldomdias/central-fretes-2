import { useMemo, useState } from 'react';
import { formatCurrency, simularFretes, simularGradeTabela } from '../utils/calculoFrete';

const defaultForm = {
  transportadoraId: '',
  origemCidade: '',
  cepDestino: '',
  pesoKg: '',
  valorNf: '',
  canal: 'TODOS',
};

function Breakdown({ item }) {
  return (
    <div className="sim-breakdown-columns">
      <div className="breakdown-block">
        <div className="breakdown-block-title">Como chegou no frete base</div>
        <div className="breakdown-grid compact">
          <div><span>Tipo</span><strong>{item.tipoCalculo}</strong></div>
          <div><span>Critério</span><strong>{item.criterio}</strong></div>
          <div><span>Faixa usada</span><strong>{item.faixaUtilizada}</strong></div>
          <div><span>Base</span><strong>{formatCurrency(item.valorBase)}</strong></div>
          <div><span>Por peso</span><strong>{formatCurrency(item.valorPeso)}</strong></div>
          <div><span>Percentual NF</span><strong>{formatCurrency(item.valorPercentual)}</strong></div>
          <div><span>Faixa</span><strong>{formatCurrency(item.valorFaixa)}</strong></div>
          <div><span>Excedente</span><strong>{formatCurrency(item.valorExcedente)}</strong></div>
        </div>
      </div>
      <div className="breakdown-block">
        <div className="breakdown-block-title">Composição final</div>
        <div className="breakdown-grid compact">
          <div><span>Ad Valorem</span><strong>{formatCurrency(item.adValorem)}</strong></div>
          <div><span>GRIS</span><strong>{formatCurrency(item.gris)}</strong></div>
          <div><span>Pedágio</span><strong>{formatCurrency(item.pedagio)}</strong></div>
          <div><span>TAS</span><strong>{formatCurrency(item.tas)}</strong></div>
          <div><span>CTRC</span><strong>{formatCurrency(item.ctrc)}</strong></div>
          <div><span>TDA</span><strong>{formatCurrency(item.tda)}</strong></div>
          <div><span>TDR</span><strong>{formatCurrency(item.tdr)}</strong></div>
          <div><span>TRT</span><strong>{formatCurrency(item.trt)}</strong></div>
          <div><span>SUFRAMA</span><strong>{formatCurrency(item.suframa)}</strong></div>
          <div><span>Outras</span><strong>{formatCurrency(item.outras)}</strong></div>
          <div><span>ICMS</span><strong>{formatCurrency(item.icms)}</strong></div>
          <div><span>Total</span><strong>{formatCurrency(item.total)}</strong></div>
        </div>
      </div>
    </div>
  );
}

function ResultadoCard({ item, index, melhorTotal }) {
  const [aberto, setAberto] = useState(false);
  const diferenca = item.total - melhorTotal;
  const reducao = item.total > 0 ? (diferenca / item.total) * 100 : 0;

  return (
    <div className="result-card" key={`${item.transportadoraId}-${item.origemId}-${item.rota}-${index}`}>
      <div className="result-top">
        <div>
          <div className="result-title">{index === 0 ? '🏆 ' : ''}{item.transportadora} • {item.origem}</div>
          <div className="list-subtitle">Origem {item.origem} • Destino IBGE {item.ibgeDestino} • Rota {item.rota} • Prazo {item.prazo} dia(s)</div>
        </div>
        <div className="result-price">{formatCurrency(item.total)}</div>
      </div>
      <div className="inline-meta wrap top-space">
        <span className="status-pill light neutral">{item.canal}</span>
        <span>Peso: <strong>{item.pesoSimulado} kg</strong></span>
        <span>NF: <strong>{formatCurrency(item.valorNfSimulado)}</strong></span>
        {index > 0 && (
          <>
            <span>Diferença p/ líder: <strong>{formatCurrency(diferenca)}</strong></span>
            <span>Redução necessária: <strong>{reducao.toFixed(2)}%</strong></span>
          </>
        )}
      </div>
      <div className="actions-right align-left top-space">
        <button className="btn-secondary" onClick={() => setAberto((prev) => !prev)}>{aberto ? 'Ocultar detalhes' : 'Ver detalhes'}</button>
      </div>
      {aberto && <Breakdown item={item} />}
    </div>
  );
}

export default function SimuladorPage({ transportadoras, onAbrirTransportadoras }) {
  const [modo, setModo] = useState('destino');
  const [tipoSimulacao, setTipoSimulacao] = useState('fixa');
  const [form, setForm] = useState(defaultForm);
  const [simulado, setSimulado] = useState(false);

  const origensDisponiveis = useMemo(() => {
    const mapa = new Map();
    transportadoras.forEach((t) => {
      (t.origens || []).forEach((o) => {
        const temTabela = (o.rotas || []).length && (o.cotacoes || []).length;
        const chave = String(o.cidade || '').trim().toUpperCase();
        if (temTabela && chave && !mapa.has(chave)) {
          mapa.set(chave, { value: o.cidade, label: o.cidade });
        }
      });
    });
    return Array.from(mapa.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [transportadoras]);

  const resultados = useMemo(() => {
    if (!simulado || tipoSimulacao !== 'fixa') return [];
    return simularFretes({
      transportadoras,
      modo,
      transportadoraId: form.transportadoraId,
      origemCidade: form.origemCidade,
      destino: form.cepDestino,
      pesoKg: form.pesoKg,
      valorNf: form.valorNf,
      canal: form.canal,
    });
  }, [transportadoras, modo, tipoSimulacao, form, simulado]);

  const grade = useMemo(() => {
    if (!simulado || tipoSimulacao !== 'grade') return null;
    return simularGradeTabela({
      transportadoras,
      transportadoraId: form.transportadoraId,
      origemCidade: form.origemCidade,
      destino: form.cepDestino,
      canal: form.canal,
      valorNf: form.valorNf,
    });
  }, [transportadoras, tipoSimulacao, form, simulado]);

  const resumo = useMemo(() => {
    if (!resultados.length) return null;
    const melhor = resultados[0];
    const segundo = resultados[1] || resultados[0];
    return {
      total: resultados.length,
      melhor,
      segundo,
      saving: Math.max(0, segundo.total - melhor.total),
    };
  }, [resultados]);

  const onChange = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const limpar = () => { setForm(defaultForm); setSimulado(false); };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>Simulador de Fretes</h1>
        <p>
          Selecione a origem disponível em tabela, informe o CEP de destino e compare os cenários.
          Para avaliação de tabela nova, use a grade automática por canal.
        </p>
      </div>

      <div className="panel-card big-panel">
        <div className="panel-title">🧾 Parâmetros de Simulação</div>

        <div className="toggle-row">
          <button className={modo === 'destino' ? 'toggle-btn active' : 'toggle-btn'} onClick={() => setModo('destino')}>Origem x Destino</button>
          <button className={modo === 'transportadora' ? 'toggle-btn active' : 'toggle-btn'} onClick={() => setModo('transportadora')}>Por Transportadora</button>
        </div>

        <div className="toggle-row compact-bottom">
          <button className={tipoSimulacao === 'fixa' ? 'toggle-btn active' : 'toggle-btn'} onClick={() => setTipoSimulacao('fixa')}>Peso fixo</button>
          <button className={tipoSimulacao === 'grade' ? 'toggle-btn active' : 'toggle-btn'} onClick={() => setTipoSimulacao('grade')}>Grade automática</button>
        </div>

        <div className="form-grid four-sim">
          <div className="field">
            <label>Transportadora {modo === 'transportadora' ? '' : '(opcional)'}</label>
            <select value={form.transportadoraId} onChange={(e) => onChange('transportadoraId', e.target.value)}>
              <option value="">Todas</option>
              {transportadoras.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Origem</label>
            <select value={form.origemCidade} onChange={(e) => onChange('origemCidade', e.target.value)}>
              <option value="">Todas as origens com tabela</option>
              {origensDisponiveis.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>CEP de destino</label>
            <input value={form.cepDestino} onChange={(e) => onChange('cepDestino', e.target.value)} placeholder="Ex: 01001-000" />
            <small>Sem base CEP x rota, o campo aceita IBGE com 7 dígitos como apoio.</small>
          </div>
          <div className="field small-width">
            <label>Canal</label>
            <select value={form.canal} onChange={(e) => onChange('canal', e.target.value)}>
              <option value="TODOS">Todos os canais</option>
              <option value="ATACADO">ATACADO</option>
              <option value="B2C">B2C</option>
            </select>
          </div>

          {tipoSimulacao === 'fixa' ? (
            <>
              <div className="field">
                <label>Peso (kg)</label>
                <input value={form.pesoKg} onChange={(e) => onChange('pesoKg', e.target.value)} placeholder="Ex: 150" />
              </div>
              <div className="field">
                <label>Valor da NF (R$)</label>
                <input value={form.valorNf} onChange={(e) => onChange('valorNf', e.target.value)} placeholder="Ex: 5000" />
              </div>
            </>
          ) : (
            <div className="full-span grade-hint-box">
              <strong>Grade automática:</strong>{' '}
              {form.canal === 'B2C'
                ? 'simula de 1 em 1 kg até 100 kg com NF fixa de R$ 150.'
                : 'simula de 50 em 50 kg até 500 kg. Para ATACADO, use o campo Valor da NF como ticket médio.'}
            </div>
          )}

          {tipoSimulacao === 'grade' && form.canal !== 'B2C' && (
            <div className="field">
              <label>Valor da NF (R$)</label>
              <input value={form.valorNf} onChange={(e) => onChange('valorNf', e.target.value)} placeholder="Ex: 5000" />
            </div>
          )}
        </div>

        <div className="actions-right gap-row">
          <button className="btn-secondary" onClick={limpar}>Limpar</button>
          <button className="btn-primary" onClick={() => setSimulado(true)}>Simular Fretes</button>
        </div>
      </div>

      {simulado && tipoSimulacao === 'fixa' && !resultados.length && (
        <div className="hint-box">
          Nenhuma rota encontrada com os parâmetros informados. Cadastre rotas, cotações ou ajuste origem/CEP em <button className="btn-link inline-btn" onClick={onAbrirTransportadoras}>Transportadoras</button>.
        </div>
      )}

      {simulado && tipoSimulacao === 'fixa' && !!resultados.length && (
        <>
          <div className="summary-strip">
            <div className="summary-card"><span>Cenários</span><strong>{resumo.total}</strong></div>
            <div className="summary-card"><span>Melhor frete</span><strong>{formatCurrency(resumo.melhor.total)}</strong></div>
            <div className="summary-card"><span>Ganhadora</span><strong>{resumo.melhor.transportadora}</strong></div>
            <div className="summary-card"><span>Saving vs 2º lugar</span><strong>{formatCurrency(resumo.saving)}</strong></div>
          </div>

          <div className="list-stack">
            {resultados.map((item, index) => (
              <ResultadoCard item={item} index={index} melhorTotal={resultados[0].total} key={`${item.transportadoraId}-${item.origemId}-${item.rota}-${index}`} />
            ))}
          </div>
        </>
      )}

      {simulado && tipoSimulacao === 'grade' && grade && (
        <>
          <div className="summary-strip">
            <div className="summary-card"><span>Rodadas válidas</span><strong>{grade.rodadas.length}</strong></div>
            <div className="summary-card"><span>Canal</span><strong>{grade.canalUsado}</strong></div>
            <div className="summary-card"><span>NF usada</span><strong>{formatCurrency(grade.nfUsada)}</strong></div>
            <div className="summary-card"><span>Saving sempre vs 2º</span><strong>{formatCurrency((grade.rankingTransportadoras[0]?.savingTotal) || 0)}</strong></div>
          </div>

          {!grade.rankingTransportadoras.length ? (
            <div className="hint-box">Nenhuma rodada válida encontrada para a grade automática com os filtros atuais.</div>
          ) : (
            <div className="list-stack">
              {grade.rankingTransportadoras.map((item, index) => (
                <div className="result-card" key={item.chave}>
                  <div className="result-top">
                    <div>
                      <div className="result-title">{index === 0 ? '🏆 ' : ''}{item.transportadora} • {item.origem}</div>
                      <div className="list-subtitle">Aderência calculada pelas vitórias da grade. Saving sempre comparado com o 2º lugar.</div>
                    </div>
                    <div className="result-price">{item.aderencia.toFixed(1)}%</div>
                  </div>
                  <div className="breakdown-grid compact top-space">
                    <div><span>Vitórias</span><strong>{item.vitorias}</strong></div>
                    <div><span>Aderência</span><strong>{item.aderencia.toFixed(1)}%</strong></div>
                    <div><span>Saving total</span><strong>{formatCurrency(item.savingTotal)}</strong></div>
                    <div><span>Frete médio</span><strong>{formatCurrency(item.freteMedio)}</strong></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
