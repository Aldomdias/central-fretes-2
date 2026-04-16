import React, { useEffect, useMemo, useState } from 'react';
import {
  analisarCoberturaTabela,
  analisarTransportadoraPorGrade,
  extrairBaseReal,
  simularPorTransportadora,
  simularSimples,
} from '../utils/calculoFrete';

const GRADE_PADRAO = {
  B2C: Array.from({ length: 12 }, (_, i) => ({ peso: i + 1, valorNF: 150 })),
  ATACADO: Array.from({ length: 10 }, (_, i) => ({ peso: (i + 1) * 50, valorNF: 5000 })),
};

function formatMoney(value) {
  return `R$ ${Number(value || 0).toFixed(2)}`;
}

function ResultadoCard({ item }) {
  return (
    <div className="sim-resultado-card">
      <div className="sim-resultado-topo">
        <strong>{item.transportadora}</strong>
        <span>#{item.posicao || '-'} • {item.prazo} dia(s)</span>
      </div>
      <div className="sim-resultado-linha">Origem {item.origem} • Destino IBGE {item.destinoCodigo}</div>
      <div className="sim-resultado-grade">
        <div>
          <span>Frete final</span>
          <strong>{formatMoney(item.total)}</strong>
        </div>
        <div>
          <span>Saving vs 2º</span>
          <strong>{formatMoney(item.savingSegundo)}</strong>
        </div>
        <div>
          <span>Diferença p/ líder</span>
          <strong>{formatMoney(item.diferencaLider)}</strong>
        </div>
        <div>
          <span>Redução p/ líder</span>
          <strong>{Number(item.reducaoNecessariaPct || 0).toFixed(2)}%</strong>
        </div>
      </div>
    </div>
  );
}

export default function SimuladorPage({ transportadoras = [] }) {
  const [aba, setAba] = useState('simples');
  const [origemSimples, setOrigemSimples] = useState('');
  const [destinoCodigo, setDestinoCodigo] = useState('');
  const [canalSimples, setCanalSimples] = useState('ATACADO');
  const [pesoSimples, setPesoSimples] = useState('150');
  const [nfSimples, setNfSimples] = useState('5000');
  const [resultadoSimples, setResultadoSimples] = useState([]);

  const [transportadora, setTransportadora] = useState('');
  const [canalTransportadora, setCanalTransportadora] = useState('ATACADO');
  const [origemTransportadora, setOrigemTransportadora] = useState('');
  const [destinoTransportadora, setDestinoTransportadora] = useState('');
  const [pesoTransportadora, setPesoTransportadora] = useState('150');
  const [nfTransportadora, setNfTransportadora] = useState('5000');
  const [modoLista, setModoLista] = useState(false);
  const [listaCodigos, setListaCodigos] = useState('');
  const [resultadoTransportadora, setResultadoTransportadora] = useState([]);

  const [transportadoraAnalise, setTransportadoraAnalise] = useState('');
  const [canalAnalise, setCanalAnalise] = useState('ATACADO');
  const [grade, setGrade] = useState(GRADE_PADRAO);
  const [resultadoAnalise, setResultadoAnalise] = useState(null);

  const [canalCobertura, setCanalCobertura] = useState('ATACADO');
  const [origemCobertura, setOrigemCobertura] = useState('');
  const [transportadoraCobertura, setTransportadoraCobertura] = useState('');
  const [resultadoCobertura, setResultadoCobertura] = useState(null);

  const baseReal = useMemo(() => extrairBaseReal(transportadoras), [transportadoras]);

  const nomesTransportadoras = useMemo(
    () => [...new Set((transportadoras || []).map((item) => item.nome).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [transportadoras],
  );

  const canaisDisponiveis = useMemo(
    () => [...new Set(baseReal.map((item) => item.canal).filter(Boolean))],
    [baseReal],
  );

  const origensDisponiveis = useMemo(
    () => [...new Set(baseReal.filter((item) => item.canal === canalSimples).map((item) => item.origemCidade).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [baseReal, canalSimples],
  );

  const transportadoraSelecionada = useMemo(
    () => (transportadoras || []).find((item) => item.nome === transportadora) || null,
    [transportadoras, transportadora],
  );

  const canaisTransportadora = useMemo(
    () => [...new Set((transportadoraSelecionada?.origens || []).map((item) => String(item.canal || 'ATACADO').toUpperCase()))],
    [transportadoraSelecionada],
  );

  const origensTransportadoraDisponiveis = useMemo(() => {
    if (!transportadoraSelecionada) return [];
    return [...new Set(
      (transportadoraSelecionada.origens || [])
        .filter((item) => String(item.canal || 'ATACADO').toUpperCase() === canalTransportadora)
        .map((item) => item.cidade)
        .filter(Boolean),
    )].sort((a, b) => a.localeCompare(b));
  }, [transportadoraSelecionada, canalTransportadora]);

  const transportadoraAnaliseSelecionada = useMemo(
    () => (transportadoras || []).find((item) => item.nome === transportadoraAnalise) || null,
    [transportadoras, transportadoraAnalise],
  );

  const canaisAnalise = useMemo(
    () => [...new Set((transportadoraAnaliseSelecionada?.origens || []).map((item) => String(item.canal || 'ATACADO').toUpperCase()))],
    [transportadoraAnaliseSelecionada],
  );

  const origensCoberturaDisponiveis = useMemo(
    () => [...new Set(baseReal.filter((item) => item.canal === canalCobertura).map((item) => item.origemCidade).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [baseReal, canalCobertura],
  );

  useEffect(() => {
    if (!transportadora && nomesTransportadoras.length) setTransportadora(nomesTransportadoras[0]);
    if (!transportadoraAnalise && nomesTransportadoras.length) setTransportadoraAnalise(nomesTransportadoras[0]);
  }, [nomesTransportadoras, transportadora, transportadoraAnalise]);

  useEffect(() => {
    if (!origemSimples && origensDisponiveis.length) setOrigemSimples(origensDisponiveis[0]);
  }, [origensDisponiveis, origemSimples]);

  useEffect(() => {
    if (canaisTransportadora.length && !canaisTransportadora.includes(canalTransportadora)) {
      setCanalTransportadora(canaisTransportadora[0]);
    }
  }, [canaisTransportadora, canalTransportadora]);

  useEffect(() => {
    if (origemTransportadora && !origensTransportadoraDisponiveis.includes(origemTransportadora)) {
      setOrigemTransportadora('');
    }
  }, [origensTransportadoraDisponiveis, origemTransportadora]);

  useEffect(() => {
    if (canaisAnalise.length && !canaisAnalise.includes(canalAnalise)) {
      setCanalAnalise(canaisAnalise[0]);
    }
  }, [canaisAnalise, canalAnalise]);

  useEffect(() => {
    if (canaisDisponiveis.length && !canaisDisponiveis.includes(canalSimples)) {
      setCanalSimples(canaisDisponiveis[0]);
    }
    if (canaisDisponiveis.length && !canaisDisponiveis.includes(canalCobertura)) {
      setCanalCobertura(canaisDisponiveis[0]);
    }
  }, [canaisDisponiveis, canalSimples, canalCobertura]);

  const onSimularSimples = () => {
    setResultadoSimples(simularSimples({
      transportadoras,
      origem: origemSimples,
      canal: canalSimples,
      peso: Number(pesoSimples),
      valorNF: Number(nfSimples),
      destinoCodigo,
    }));
  };

  const onSimularTransportadora = () => {
    const codigos = modoLista
      ? listaCodigos.split(/\n|,|;/).map((s) => s.trim()).filter(Boolean)
      : destinoTransportadora
        ? [destinoTransportadora]
        : [];

    setResultadoTransportadora(simularPorTransportadora({
      transportadoras,
      nomeTransportadora: transportadora,
      canal: canalTransportadora,
      origem: origemTransportadora,
      destinoCodigos: codigos,
      peso: Number(pesoTransportadora),
      valorNF: Number(nfTransportadora),
    }));
  };

  const onSimularGrade = () => {
    setResultadoAnalise(analisarTransportadoraPorGrade({
      transportadoras,
      nomeTransportadora: transportadoraAnalise,
      canal: canalAnalise,
      grade: grade[canalAnalise] || [],
    }));
  };

  const onAnalisarCobertura = () => {
    setResultadoCobertura(analisarCoberturaTabela({
      transportadoras,
      canal: canalCobertura,
      origem: origemCobertura,
      transportadora: transportadoraCobertura,
    }));
  };

  return (
    <div className="simulador-shell">
      <div className="simulador-header">
        <div className="simulador-subtitulo">AMD Log • Plataforma de Fretes</div>
        <h1>Simulador de fretes</h1>
        <p>Simulação com base nas tabelas reais importadas por transportadora, origem, rota, cotação e taxas especiais.</p>
      </div>

      <div className="sim-tabs">
        {[
          ['simples', 'Simulação simples'],
          ['transportadora', 'Simulação por transportadora'],
          ['analise', 'Análise de transportadora'],
          ['cobertura', 'Cobertura de tabela'],
        ].map(([id, label]) => (
          <button key={id} className={`sim-tab ${aba === id ? 'active' : ''}`} onClick={() => setAba(id)}>
            {label}
          </button>
        ))}
      </div>

      {aba === 'simples' && (
        <section className="sim-card">
          <h2>Simulação simples</h2>
          <div className="sim-form-grid sim-grid-5">
            <label>Origem
              <select value={origemSimples} onChange={(e) => setOrigemSimples(e.target.value)}>
                {origensDisponiveis.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Destino (CEP ou IBGE)
              <input value={destinoCodigo} onChange={(e) => setDestinoCodigo(e.target.value)} placeholder="Ex: 3506003" />
            </label>
            <label>Canal
              <select value={canalSimples} onChange={(e) => setCanalSimples(e.target.value)}>
                {canaisDisponiveis.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Peso
              <input value={pesoSimples} onChange={(e) => setPesoSimples(e.target.value)} />
            </label>
            <label>Valor NF
              <input value={nfSimples} onChange={(e) => setNfSimples(e.target.value)} />
            </label>
          </div>
          <div className="sim-actions"><button className="primary" onClick={onSimularSimples}>Simular</button></div>
          <div className="sim-resultados">{resultadoSimples.map((item, idx) => <ResultadoCard key={`${item.transportadora}-${idx}`} item={item} />)}</div>
        </section>
      )}

      {aba === 'transportadora' && (
        <section className="sim-card">
          <h2>Simulação por transportadora</h2>
          <div className="sim-form-grid sim-grid-6">
            <label>Transportadora
              <select value={transportadora} onChange={(e) => setTransportadora(e.target.value)}>
                {nomesTransportadoras.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Canal
              <select value={canalTransportadora} onChange={(e) => setCanalTransportadora(e.target.value)}>
                {canaisTransportadora.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Origem (opcional)
              <select value={origemTransportadora} onChange={(e) => setOrigemTransportadora(e.target.value)}>
                <option value="">Todas</option>
                {origensTransportadoraDisponiveis.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Destino opcional (CEP ou IBGE)
              <input disabled={modoLista} value={destinoTransportadora} onChange={(e) => setDestinoTransportadora(e.target.value)} placeholder="Ex: 3506003" />
            </label>
            <label>Peso
              <input value={pesoTransportadora} onChange={(e) => setPesoTransportadora(e.target.value)} />
            </label>
            <label>Valor NF
              <input value={nfTransportadora} onChange={(e) => setNfTransportadora(e.target.value)} />
            </label>
          </div>
          <div className="sim-inline-tools">
            <label className="sim-flag">
              <input type="checkbox" checked={modoLista} onChange={(e) => setModoLista(e.target.checked)} />
              Simulação em massa por lista de CEP/IBGE
            </label>
          </div>
          {modoLista && (
            <div className="sim-lista-box">
              <label>Lista de CEPs ou IBGEs
                <textarea value={listaCodigos} onChange={(e) => setListaCodigos(e.target.value)} rows={6} />
              </label>
            </div>
          )}
          <div className="sim-actions"><button className="primary" onClick={onSimularTransportadora}>Simular transportadora</button></div>
          <div className="sim-resultados">{resultadoTransportadora.map((item, idx) => <ResultadoCard key={`${item.origem}-${item.destinoCodigo}-${idx}`} item={item} />)}</div>
        </section>
      )}

      {aba === 'analise' && (
        <section className="sim-card">
          <h2>Análise de transportadora</h2>
          <div className="sim-form-grid sim-grid-2 compact-top">
            <label>Transportadora
              <select value={transportadoraAnalise} onChange={(e) => setTransportadoraAnalise(e.target.value)}>
                {nomesTransportadoras.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Canal
              <select value={canalAnalise} onChange={(e) => setCanalAnalise(e.target.value)}>
                {canaisAnalise.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
          </div>
          <div className="sim-parametros-box">
            <div className="sim-parametros-header">
              <div>
                <strong>Grade de pesos e valores de nota</strong>
                <p>Essa tela simula todas as rotas reais da transportadora no canal selecionado.</p>
              </div>
              <button className="primary small" onClick={onSimularGrade}>Simular grade</button>
            </div>
            <div className="sim-grade-config">
              {(grade[canalAnalise] || []).map((linha, idx) => (
                <div key={idx} className="sim-grade-row">
                  <input
                    value={linha.peso}
                    onChange={(e) => {
                      const next = structuredClone(grade);
                      next[canalAnalise][idx].peso = Number(e.target.value || 0);
                      setGrade(next);
                    }}
                  />
                  <input
                    value={linha.valorNF}
                    onChange={(e) => {
                      const next = structuredClone(grade);
                      next[canalAnalise][idx].valorNF = Number(e.target.value || 0);
                      setGrade(next);
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
          {resultadoAnalise && (
            <div className="sim-cobertura-box">
              <div className="sim-analise-resumo">
                <div><span>Rotas avaliadas</span><strong>{resultadoAnalise.rotasAvaliadas}</strong></div>
                <div><span>Vitórias</span><strong>{resultadoAnalise.vitorias}</strong></div>
                <div><span>Aderência</span><strong>{Number(resultadoAnalise.aderencia || 0).toFixed(2)}%</strong></div>
                <div><span>Saving vs 2º</span><strong>{formatMoney(resultadoAnalise.saving)}</strong></div>
              </div>
              <div className="sim-resultados">
                {resultadoAnalise.linhas.slice(0, 20).map((item, idx) => <ResultadoCard key={`${item.origem}-${item.destinoCodigo}-${idx}`} item={item} />)}
              </div>
            </div>
          )}
        </section>
      )}

      {aba === 'cobertura' && (
        <section className="sim-card">
          <h2>Cobertura de tabela</h2>
          <div className="sim-form-grid sim-grid-3 compact-top">
            <label>Canal
              <select value={canalCobertura} onChange={(e) => setCanalCobertura(e.target.value)}>
                {canaisDisponiveis.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Origem
              <select value={origemCobertura} onChange={(e) => setOrigemCobertura(e.target.value)}>
                <option value="">Todas</option>
                {origensCoberturaDisponiveis.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Transportadora
              <select value={transportadoraCobertura} onChange={(e) => setTransportadoraCobertura(e.target.value)}>
                <option value="">Todas</option>
                {nomesTransportadoras.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
          </div>
          <div className="sim-actions"><button className="primary" onClick={onAnalisarCobertura}>Analisar cobertura</button></div>
          {resultadoCobertura && (
            <div className="sim-cobertura-box">
              <div className="sim-analise-resumo">
                <div><span>Combinações possíveis</span><strong>{resultadoCobertura.total}</strong></div>
                <div><span>Cobertas</span><strong>{resultadoCobertura.cobertas}</strong></div>
                <div><span>Sem tabela</span><strong>{resultadoCobertura.faltantes}</strong></div>
                <div><span>Cobertura</span><strong>{Number(resultadoCobertura.percentual || 0).toFixed(2)}%</strong></div>
              </div>
              <div className="sim-missing-list">
                {resultadoCobertura.listaFaltantes.map((item, idx) => (
                  <div key={`${item.origem}-${item.codigo}-${idx}`} className="sim-missing-item">
                    {item.origem} • {item.cidade} • IBGE {item.codigo}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
