import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  buildSimuladorOptions,
  formatCurrency,
  simularFretes,
} from '../utils/calculoFrete';

const defaultForm = {
  transportadoraId: '',
  origemId: '',
  origemBusca: '',
  origemIbge: '',
  destinoBusca: '',
  destinoIbge: '',
  cepDestino: '',
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

function parseMassRows(rows) {
  return rows
    .map((row, index) => {
      const obj = {};
      Object.keys(row || {}).forEach((key) => {
        obj[String(key || '').trim().toLowerCase()] = row[key];
      });

      const origem = obj.origem || obj['cidade origem'] || obj.cidade_origem || '';
      const ibgeOrigem = obj['ibge origem'] || obj.ibge_origem || obj.ibgeorigem || '';
      const destino = obj.destino || obj['cidade destino'] || obj.cidade_destino || obj.rota || '';
      const ibgeDestino = obj['ibge destino'] || obj.ibge_destino || obj.ibgedestino || '';
      const cep = obj.cep || obj['cep destino'] || obj.cep_destino || '';
      const pesoKg = obj.peso || obj['peso kg'] || obj.pesokg || '';
      const valorNf = obj['valor nf'] || obj.valornf || obj.nf || obj['valor nota'] || '';
      const canal = obj.canal || 'TODOS';
      const transportadoraId = obj.transportadoraid || obj['transportadora id'] || '';

      return {
        id: index + 1,
        origemBusca: String(origem || ''),
        origemIbge: String(ibgeOrigem || ''),
        destinoBusca: String(destino || ''),
        destinoIbge: String(ibgeDestino || ''),
        cepDestino: String(cep || ''),
        pesoKg: String(pesoKg || ''),
        valorNf: String(valorNf || ''),
        canal: String(canal || 'TODOS').toUpperCase(),
        transportadoraId: String(transportadoraId || ''),
      };
    })
    .filter((item) => item.destinoBusca || item.destinoIbge || item.cepDestino);
}

function exportMassResults(rows) {
  const payload = rows.flatMap((grupo) =>
    (grupo.resultados || []).map((item, idx) => ({
      lote: grupo.id,
      origem: item.origem,
      ibgeOrigem: item.ibgeOrigem,
      destino: item.rota,
      ibgeDestino: item.ibgeDestino,
      cepDestino: grupo.cepDestino,
      transportadora: item.transportadora,
      prazo: item.prazo,
      canal: item.canal,
      tipoCalculo: item.tipoCalculo,
      total: item.total,
      melhorDoLote: idx === 0 ? 'SIM' : 'NAO',
    })),
  );

  const ws = XLSX.utils.json_to_sheet(payload);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Simulacao');
  XLSX.writeFile(wb, 'simulacao-massa.xlsx');
}

export default function SimuladorPage({ transportadoras, onAbrirTransportadoras }) {
  const [modo, setModo] = useState('destino');
  const [form, setForm] = useState(defaultForm);
  const [simulado, setSimulado] = useState(false);
  const [massa, setMassa] = useState([]);
  const [massaRodada, setMassaRodada] = useState(false);
  const massaInputRef = useRef(null);

  const { origens, destinos } = useMemo(() => buildSimuladorOptions(transportadoras), [transportadoras]);

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
      origemFiltro: { texto: form.origemBusca, ibge: form.origemIbge },
      destino: form.destinoBusca || form.destinoIbge || form.cepDestino,
      destinoFiltro: { texto: form.destinoBusca || form.cepDestino, ibge: form.destinoIbge },
      pesoKg: form.pesoKg,
      valorNf: form.valorNf,
      canal: form.canal,
    });
  }, [transportadoras, modo, form, simulado]);

  const resultadosMassa = useMemo(() => {
    if (!massaRodada) return [];
    return massa.map((item) => ({
      ...item,
      resultados: simularFretes({
        transportadoras,
        modo: 'destino',
        transportadoraId: item.transportadoraId,
        origemFiltro: { texto: item.origemBusca, ibge: item.origemIbge },
        destino: item.destinoBusca || item.destinoIbge || item.cepDestino,
        destinoFiltro: { texto: item.destinoBusca || item.cepDestino, ibge: item.destinoIbge },
        pesoKg: item.pesoKg || form.pesoKg,
        valorNf: item.valorNf || form.valorNf,
        canal: item.canal || form.canal,
      }),
    }));
  }, [massa, massaRodada, transportadoras, form.pesoKg, form.valorNf, form.canal]);

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

  const preencherOrigem = (value) => {
    const option = origens.find((item) => item.label === value || item.cidade === value || item.ibge === value.replace(/\D/g, ''));
    setForm((prev) => ({
      ...prev,
      origemBusca: option?.cidade || value,
      origemIbge: option?.ibge || (value.replace(/\D/g, '').length >= 7 ? value.replace(/\D/g, '') : prev.origemIbge),
      origemId: '',
    }));
  };

  const preencherDestino = (value) => {
    const digits = value.replace(/\D/g, '');
    const option = destinos.find((item) => item.label === value || item.nome === value || item.ibge === digits);
    setForm((prev) => ({
      ...prev,
      destinoBusca: option?.nome || value,
      destinoIbge: option?.ibge || (digits.length >= 7 ? digits : prev.destinoIbge),
    }));
  };

  const importarListaCep = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    setMassa(parseMassRows(rows));
    setMassaRodada(false);
    event.target.value = '';
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>Simulador de Fretes</h1>
        <p>
          Busque por cidade, IBGE ou CEP. Você também pode anexar uma lista para simulação em massa.
        </p>
      </div>

      <div className="panel-card big-panel">
        <div className="panel-title">🧾 Parâmetros de Simulação</div>

        <div className="toggle-row">
          <button className={modo === 'destino' ? 'toggle-btn active' : 'toggle-btn'} onClick={() => setModo('destino')}>Origem x Destino</button>
          <button className={modo === 'transportadora' ? 'toggle-btn active' : 'toggle-btn'} onClick={() => setModo('transportadora')}>Por Transportadora</button>
        </div>

        <div className="form-grid four">
          <div className="field">
            <label>Transportadora {modo === 'transportadora' ? '' : '(opcional)'}</label>
            <select value={form.transportadoraId} onChange={(e) => onChange('transportadoraId', e.target.value)}>
              <option value="">Todas</option>
              {transportadoras.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Origem por cadastro (opcional)</label>
            <select value={form.origemId} onChange={(e) => onChange('origemId', e.target.value)}>
              <option value="">Todas as origens</option>
              {origensDisponiveis
                .filter((item) => !form.transportadoraId || String(item.transportadoraId) === String(form.transportadoraId))
                .map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Origem por cidade</label>
            <input
              list="origens-list"
              value={form.origemBusca}
              onChange={(e) => preencherOrigem(e.target.value)}
              placeholder="Digite a cidade de origem"
            />
            <datalist id="origens-list">
              {origens.map((item) => <option key={item.key} value={item.label} />)}
            </datalist>
          </div>
          <div className="field">
            <label>IBGE de origem</label>
            <input value={form.origemIbge} onChange={(e) => onChange('origemIbge', e.target.value.replace(/\D/g, ''))} placeholder="Ex: 4216602" />
          </div>
          <div className="field">
            <label>Destino por cidade/rota</label>
            <input
              list="destinos-list"
              value={form.destinoBusca}
              onChange={(e) => preencherDestino(e.target.value)}
              placeholder="Digite o destino"
            />
            <datalist id="destinos-list">
              {destinos.map((item) => <option key={item.key} value={item.label} />)}
            </datalist>
          </div>
          <div className="field">
            <label>IBGE de destino</label>
            <input value={form.destinoIbge} onChange={(e) => onChange('destinoIbge', e.target.value.replace(/\D/g, ''))} placeholder="Ex: 3550308" />
          </div>
          <div className="field">
            <label>CEP de destino</label>
            <input value={form.cepDestino} onChange={(e) => onChange('cepDestino', e.target.value)} placeholder="Ex: 01001-000" />
            <small>CEP puro só funciona quando a sua base já tiver o vínculo com IBGE/rota.</small>
          </div>
          <div className="field">
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

        <div className="sim-massa-box">
          <div>
            <strong>Simulação em massa por lista</strong>
            <p>Importe XLSX/CSV com colunas como origem, ibge origem, destino, ibge destino, cep, peso, valor nf e canal.</p>
          </div>
          <div className="gap-row wrap">
            <input hidden ref={massaInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={importarListaCep} />
            <button className="btn-secondary" onClick={() => massaInputRef.current?.click()}>Anexar lista</button>
            <button className="btn-secondary" disabled={!massa.length} onClick={() => setMassaRodada(true)}>Simular lista</button>
            <button className="btn-secondary" disabled={!resultadosMassa.length} onClick={() => exportMassResults(resultadosMassa)}>Exportar massa</button>
          </div>
        </div>

        {!!massa.length && (
          <div className="hint-box compact">
            Lista carregada com <strong>{massa.length}</strong> linha(s). Para CEP puro, o ideal é que a planilha traga também <strong>IBGE destino</strong> ou <strong>destino</strong>.
          </div>
        )}

        <div className="actions-right gap-row">
          <button className="btn-secondary" onClick={() => { setForm(defaultForm); setSimulado(false); setMassa([]); setMassaRodada(false); }}>Limpar</button>
          <button className="btn-primary" onClick={() => setSimulado(true)}>Simular Fretes</button>
        </div>
      </div>

      {simulado && !resultados.length && (
        <div className="hint-box">
          Nenhuma rota encontrada com os parâmetros informados. Cadastre rotas, cotações ou ajuste os campos em <button className="btn-link inline-btn" onClick={onAbrirTransportadoras}>Transportadoras</button>.
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
                    <div className="list-subtitle">Origem {item.ibgeOrigem} • Destino {item.rota} / {item.ibgeDestino} • Prazo {item.prazo} dia(s)</div>
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

      {!!resultadosMassa.length && (
        <div className="panel-card top-gap">
          <div className="panel-title">📦 Resultado da simulação em massa</div>
          <div className="list-stack compact-list">
            {resultadosMassa.map((lote) => {
              const melhor = lote.resultados?.[0];
              return (
                <div className="result-card" key={lote.id}>
                  <div className="result-top">
                    <div>
                      <div className="result-title">Lote {lote.id}</div>
                      <div className="list-subtitle">
                        Origem {lote.origemBusca || lote.origemIbge || '-'} • Destino {lote.destinoBusca || lote.destinoIbge || lote.cepDestino || '-'}
                      </div>
                    </div>
                    <div className="result-price">{melhor ? formatCurrency(melhor.total) : 'Sem rota'}</div>
                  </div>
                  <div className="inline-meta wrap">
                    <span>Melhor opção: <strong>{melhor?.transportadora || 'Não encontrada'}</strong></span>
                    <span>Prazo: <strong>{melhor?.prazo ?? '-'}</strong></span>
                    <span>Resultados: <strong>{lote.resultados.length}</strong></span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
