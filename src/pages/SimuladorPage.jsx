import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { formatCurrency, simularFretes, simularGradePorCanal } from '../utils/calculoFrete';

const CONFIG_STORAGE_KEY = 'amdlog-simulador-config-v1';

const defaultForm = {
  transportadoraId: '',
  origemId: '',
  cepDestino: '',
  pesoKg: '',
  valorNf: '',
  canal: 'TODOS',
};

const defaultConfig = {
  b2c: Array.from({ length: 100 }, (_, index) => ({ peso: index + 1, valorNf: 150 })),
  atacado: Array.from({ length: 10 }, (_, index) => ({ peso: (index + 1) * 50, valorNf: 5000 })),
};

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  return Number(String(value).replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
}

function carregarConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return defaultConfig;
    const parsed = JSON.parse(raw);
    return {
      b2c: Array.isArray(parsed.b2c) && parsed.b2c.length ? parsed.b2c : defaultConfig.b2c,
      atacado: Array.isArray(parsed.atacado) && parsed.atacado.length ? parsed.atacado : defaultConfig.atacado,
    };
  } catch {
    return defaultConfig;
  }
}

function salvarConfig(config) {
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
}

function Breakdown({ item }) {
  const [aberto, setAberto] = useState(false);
  const segundoTotal = item.segundoLugarTotal || 0;
  const diferenca = segundoTotal ? segundoTotal - item.total : 0;
  const reducao = segundoTotal ? ((segundoTotal - item.total) / segundoTotal) * 100 : 0;

  return (
    <div className="result-detail-box">
      <div className="result-detail-actions">
        <button className="btn-link" onClick={() => setAberto((prev) => !prev)}>
          {aberto ? 'Ocultar detalhes' : 'Ver detalhes'}
        </button>
        {item.posicao > 1 && (
          <div className="detail-loss-meta">
            <span>Dif. p/ líder: <strong>{formatCurrency(item.diferencaParaLider)}</strong></span>
            <span>Redução necessária: <strong>{item.reducaoNecessaria.toFixed(2)}%</strong></span>
          </div>
        )}
      </div>

      {aberto && (
        <div className="detail-two-columns">
          <div className="detail-column">
            <h4>Como chegou no frete base</h4>
            <div className="breakdown-grid compact">
              <div><span>Tipo</span><strong>{item.tipoCalculo}</strong></div>
              <div><span>Critério</span><strong>{item.criterio}</strong></div>
              <div><span>Peso</span><strong>{item.peso} kg</strong></div>
              <div><span>Valor da NF</span><strong>{formatCurrency(item.valorNf)}</strong></div>
              <div><span>Base percentual</span><strong>{formatCurrency(item.valorPercentual)}</strong></div>
              <div><span>Base por kg</span><strong>{formatCurrency(item.valorPeso)}</strong></div>
              <div><span>Faixa</span><strong>{formatCurrency(item.valorFaixa)}</strong></div>
              <div><span>Excedente</span><strong>{formatCurrency(item.valorExcedente)}</strong></div>
              <div><span>Mínimo da rota</span><strong>{formatCurrency(item.minimoRota)}</strong></div>
              <div><span>Frete base</span><strong>{formatCurrency(item.valorBase)}</strong></div>
            </div>
          </div>

          <div className="detail-column">
            <h4>Composição final</h4>
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
      )}

      {segundoTotal > 0 && (
        <div className="second-place-bar">
          <span>Saving vs 2º lugar</span>
          <strong>{formatCurrency(diferenca)}</strong>
          <span>{reducao.toFixed(2)}%</span>
        </div>
      )}
    </div>
  );
}

function normalizarLinhaMassa(item) {
  const origem = item.origem || item['origem por cadastro'] || item['cidade origem'] || '';
  const cep = item.cep || item['cep destino'] || item.destino || '';
  const peso = item.peso || item['peso (kg)'] || item['peso kg'] || '';
  const valorNf = item['valor nf'] || item['valor da nf'] || item.valor_nf || item.nf || '';
  const canal = item.canal || 'TODOS';
  return {
    origem: String(origem || '').trim(),
    cepDestino: String(cep || '').trim(),
    pesoKg: String(peso || '').trim(),
    valorNf: String(valorNf || '').trim(),
    canal: String(canal || 'TODOS').trim().toUpperCase(),
  };
}

function exportarCsv(nome, linhas) {
  const header = Object.keys(linhas[0] || {});
  const csv = [header.join(';')]
    .concat(linhas.map((linha) => header.map((coluna) => `"${String(linha[coluna] ?? '').replace(/"/g, '""')}"`).join(';')))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  link.click();
  URL.revokeObjectURL(url);
}

export default function SimuladorPage({ transportadoras, onAbrirTransportadoras }) {
  const [modo, setModo] = useState('destino');
  const [form, setForm] = useState(defaultForm);
  const [simulado, setSimulado] = useState(false);
  const [config, setConfig] = useState(defaultConfig);
  const [gestaoAberta, setGestaoAberta] = useState(false);
  const [listaMassa, setListaMassa] = useState([]);
  const [resultadoMassa, setResultadoMassa] = useState([]);
  const [resultadoGrade, setResultadoGrade] = useState(null);
  const inputListaRef = useRef(null);

  useEffect(() => {
    setConfig(carregarConfig());
  }, []);

  const origensDisponiveis = useMemo(() => {
    const mapa = new Map();
    transportadoras.forEach((t) => {
      (t.origens || []).forEach((origem) => {
        const temTabela = (origem.rotas || []).length && (origem.cotacoes || []).length;
        if (!temTabela) return;
        const chave = String(origem.cidade || '').trim().toUpperCase();
        if (!mapa.has(chave)) {
          mapa.set(chave, { id: origem.id, cidade: origem.cidade, label: origem.cidade });
        }
      });
    });
    return Array.from(mapa.values()).sort((a, b) => a.cidade.localeCompare(b.cidade, 'pt-BR'));
  }, [transportadoras]);

  const resultados = useMemo(() => {
    if (!simulado) return [];
    const base = simularFretes({
      transportadoras,
      modo,
      transportadoraId: form.transportadoraId,
      origemId: form.origemId,
      destino: form.cepDestino,
      pesoKg: form.pesoKg,
      valorNf: form.valorNf,
      canal: form.canal,
    });

    const lider = base[0]?.total || 0;
    const segundoLugarTotal = base[1]?.total || 0;

    return base.map((item, index) => ({
      ...item,
      posicao: index + 1,
      segundoLugarTotal,
      diferencaParaLider: index === 0 ? 0 : item.total - lider,
      reducaoNecessaria: index === 0 || !item.total ? 0 : ((item.total - lider) / item.total) * 100,
    }));
  }, [transportadoras, modo, form, simulado]);

  const resumo = useMemo(() => {
    if (!resultados.length) return null;
    const melhor = resultados[0];
    const segundo = resultados[1] || null;
    return {
      total: resultados.length,
      melhor,
      segundo,
      savingSegundo: segundo ? segundo.total - melhor.total : 0,
    };
  }, [resultados]);

  const onChange = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const atualizarFaixa = (canalKey, index, campo, valor) => {
    setConfig((prev) => {
      const atualizado = {
        ...prev,
        [canalKey]: prev[canalKey].map((item, i) => (i === index ? { ...item, [campo]: toNumber(valor) } : item)),
      };
      salvarConfig(atualizado);
      return atualizado;
    });
  };

  const restaurarFaixas = () => {
    setConfig(defaultConfig);
    salvarConfig(defaultConfig);
  };

  const simularGrade = () => {
    const canal = form.canal === 'TODOS' ? 'B2C' : form.canal;
    const faixas = canal === 'ATACADO' ? config.atacado : config.b2c;
    const grade = simularGradePorCanal({
      transportadoras,
      canal,
      origemId: form.origemId,
      transportadoraId: form.transportadoraId,
      destino: form.cepDestino,
      faixas,
    });
    setResultadoGrade({ canal, ...grade });
  };

  const onAnexarLista = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }).map(normalizarLinhaMassa);
    setListaMassa(rows.filter((item) => item.cepDestino));
    event.target.value = '';
  };

  const simularLista = () => {
    const linhas = listaMassa.map((linha, index) => {
      const origemEncontrada = origensDisponiveis.find((item) => item.cidade.toUpperCase() === linha.origem.toUpperCase());
      const resultadosLinha = simularFretes({
        transportadoras,
        modo: 'destino',
        transportadoraId: form.transportadoraId,
        origemId: origemEncontrada?.id || '',
        destino: linha.cepDestino,
        pesoKg: linha.pesoKg,
        valorNf: linha.valorNf,
        canal: linha.canal || 'TODOS',
      });
      const melhor = resultadosLinha[0] || null;
      const segundo = resultadosLinha[1] || null;
      return {
        linha: index + 1,
        origem: linha.origem,
        cepDestino: linha.cepDestino,
        pesoKg: linha.pesoKg,
        valorNf: linha.valorNf,
        canal: linha.canal,
        vencedor: melhor?.transportadora || '',
        rota: melhor?.rota || '',
        prazo: melhor?.prazo || '',
        frete: melhor ? Number(melhor.total).toFixed(2) : '',
        savingSegundo: melhor && segundo ? Number(segundo.total - melhor.total).toFixed(2) : '',
      };
    });
    setResultadoMassa(linhas);
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>Simulador de Fretes</h1>
        <p>Simule por CEP, avalie tabelas por grade automática e rode listas em massa sem perder o foco no saving versus o 2º lugar.</p>
      </div>

      <div className="panel-card big-panel">
        <div className="panel-title">🧾 Parâmetros de Simulação</div>

        <div className="toggle-row">
          <button className={modo === 'destino' ? 'toggle-btn active' : 'toggle-btn'} onClick={() => setModo('destino')}>Origem x Destino</button>
          <button className={modo === 'transportadora' ? 'toggle-btn active' : 'toggle-btn'} onClick={() => setModo('transportadora')}>Por Transportadora</button>
        </div>

        <div className="form-grid simulator-grid">
          <div className="field">
            <label>Transportadora {modo === 'transportadora' ? '' : '(opcional)'}</label>
            <select value={form.transportadoraId} onChange={(e) => onChange('transportadoraId', e.target.value)}>
              <option value="">Todas</option>
              {transportadoras.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Origem por cadastro</label>
            <select value={form.origemId} onChange={(e) => onChange('origemId', e.target.value)}>
              <option value="">Todas as origens</option>
              {origensDisponiveis.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>CEP de destino</label>
            <input value={form.cepDestino} onChange={(e) => onChange('cepDestino', e.target.value)} placeholder="Ex: 01001-000" />
            <small>Se sua base ainda não tiver faixa de CEP, você pode usar o IBGE de apoio neste campo.</small>
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

        <div className="massa-box top-space">
          <div>
            <strong>Simulação em massa por lista de CEP</strong>
            <p>Importe XLSX/CSV com colunas como origem, cep, peso, valor nf e canal.</p>
          </div>
          <div className="massa-actions">
            <input ref={inputListaRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={onAnexarLista} />
            <button className="btn-secondary" onClick={() => inputListaRef.current?.click()}>Anexar lista</button>
            <button className="btn-secondary" onClick={simularLista} disabled={!listaMassa.length}>Simular lista</button>
            <button className="btn-secondary" onClick={() => resultadoMassa.length && exportarCsv('simulacao-massa-amdlog.csv', resultadoMassa)} disabled={!resultadoMassa.length}>Exportar massa</button>
          </div>
        </div>

        <div className="config-box top-space">
          <div className="config-header">
            <div>
              <strong>Gestão de parâmetros da simulação</strong>
              <p>Defina os pesos e o valor da NF por faixa. Depois você pode alterar só nessa área.</p>
            </div>
            <div className="massa-actions">
              <button className="btn-secondary" onClick={() => setGestaoAberta((prev) => !prev)}>{gestaoAberta ? 'Fechar gestão' : 'Abrir gestão'}</button>
              <button className="btn-secondary" onClick={restaurarFaixas}>Restaurar padrão</button>
              <button className="btn-primary" onClick={simularGrade}>Simular grade</button>
            </div>
          </div>

          {gestaoAberta && (
            <div className="grade-config-grid">
              <div className="grade-config-card">
                <h4>B2C • kg a kg até 100 kg</h4>
                <div className="grade-config-list">
                  {config.b2c.slice(0, 12).map((item, index) => (
                    <div className="grade-row" key={`b2c-${index}`}>
                      <input value={item.peso} onChange={(e) => atualizarFaixa('b2c', index, 'peso', e.target.value)} />
                      <input value={item.valorNf} onChange={(e) => atualizarFaixa('b2c', index, 'valorNf', e.target.value)} />
                    </div>
                  ))}
                </div>
                <small>Mostrando as 12 primeiras faixas para edição rápida. As demais seguem o padrão salvo.</small>
              </div>
              <div className="grade-config-card">
                <h4>ATACADO • 50 em 50 kg até 500 kg</h4>
                <div className="grade-config-list">
                  {config.atacado.map((item, index) => (
                    <div className="grade-row" key={`atacado-${index}`}>
                      <input value={item.peso} onChange={(e) => atualizarFaixa('atacado', index, 'peso', e.target.value)} />
                      <input value={item.valorNf} onChange={(e) => atualizarFaixa('atacado', index, 'valorNf', e.target.value)} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="actions-right gap-row">
          <button className="btn-secondary" onClick={() => { setForm(defaultForm); setSimulado(false); setResultadoGrade(null); }}>Limpar</button>
          <button className="btn-primary" onClick={() => setSimulado(true)}>Simular Fretes</button>
        </div>
      </div>

      {simulado && !resultados.length && (
        <div className="hint-box">
          Nenhuma rota encontrada com os parâmetros informados. Cadastre rotas, cotações ou ajuste o CEP em <button className="btn-link inline-btn" onClick={onAbrirTransportadoras}>Transportadoras</button>.
        </div>
      )}

      {!!resultados.length && resumo && (
        <>
          <div className="summary-strip simulator-summary-strip">
            <div className="summary-card"><span>Cenários</span><strong>{resumo.total}</strong></div>
            <div className="summary-card"><span>Melhor frete</span><strong>{formatCurrency(resumo.melhor.total)}</strong></div>
            <div className="summary-card"><span>Transportadora líder</span><strong>{resumo.melhor.transportadora}</strong></div>
            <div className="summary-card"><span>Saving vs 2º lugar</span><strong>{formatCurrency(resumo.savingSegundo)}</strong></div>
          </div>

          <div className="list-stack">
            {resultados.map((item, index) => (
              <div className="result-card" key={`${item.transportadoraId}-${item.origemId}-${item.rota}-${index}`}>
                <div className="result-top">
                  <div>
                    <div className="result-title">{index === 0 ? '🏆 ' : ''}{item.transportadora} • {item.origem}</div>
                    <div className="list-subtitle">Origem {item.origem} • Destino {item.ibgeDestino} • Prazo {item.prazo} dia(s)</div>
                  </div>
                  <div className="result-price">{formatCurrency(item.total)}</div>
                </div>
                <div className="inline-meta wrap">
                  <span className="status-pill light neutral">{item.canal}</span>
                  <span className="status-pill light neutral">{item.tipoCalculo}</span>
                  <span>Critério: <strong>{item.criterio}</strong></span>
                  <span>Base: <strong>{formatCurrency(item.valorBase)}</strong></span>
                </div>
                <Breakdown item={item} />
              </div>
            ))}
          </div>
        </>
      )}

      {resultadoGrade && (
        <div className="panel-card">
          <div className="panel-title">📊 Grade automática • {resultadoGrade.canal}</div>
          <div className="summary-strip simulator-summary-strip">
            <div className="summary-card"><span>Aderência</span><strong>{(resultadoGrade.aderencia * 100).toFixed(1)}%</strong></div>
            <div className="summary-card"><span>Saving total vs 2º</span><strong>{formatCurrency(resultadoGrade.totalSaving)}</strong></div>
            <div className="summary-card"><span>Faixas simuladas</span><strong>{resultadoGrade.linhas.length}</strong></div>
            <div className="summary-card"><span>Transportadoras vencedoras</span><strong>{Object.keys(resultadoGrade.vitorias).length}</strong></div>
          </div>
          <div className="hint-box top-space">
            {Object.entries(resultadoGrade.vitorias).map(([nome, total]) => `${nome}: ${total} faixa(s)`).join(' • ') || 'Sem vitórias registradas.'}
          </div>
        </div>
      )}

      {!!resultadoMassa.length && (
        <div className="panel-card">
          <div className="panel-title">📦 Resultado da simulação em massa</div>
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>Linha</th>
                  <th>Origem</th>
                  <th>CEP</th>
                  <th>Peso</th>
                  <th>NF</th>
                  <th>Canal</th>
                  <th>Vencedor</th>
                  <th>Rota</th>
                  <th>Prazo</th>
                  <th>Frete</th>
                  <th>Saving vs 2º</th>
                </tr>
              </thead>
              <tbody>
                {resultadoMassa.map((item) => (
                  <tr key={item.linha}>
                    <td>{item.linha}</td>
                    <td>{item.origem}</td>
                    <td>{item.cepDestino}</td>
                    <td>{item.pesoKg}</td>
                    <td>{item.valorNf}</td>
                    <td>{item.canal}</td>
                    <td>{item.vencedor}</td>
                    <td>{item.rota}</td>
                    <td>{item.prazo}</td>
                    <td>{item.frete}</td>
                    <td>{item.savingSegundo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
