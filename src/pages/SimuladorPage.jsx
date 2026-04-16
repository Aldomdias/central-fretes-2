import React, { useMemo, useState } from 'react';
import {
  analisarCoberturaTabela,
  analisarTransportadoraPorGrade,
  simularPorTransportadora,
  simularSimples,
} from '../utils/calculoFrete';

const IBGE_BASE = [
  { codigo: '1100015', cidade: "Alta Floresta D'Oeste", uf: 'RO' },
  { codigo: '3106200', cidade: 'Belo Horizonte', uf: 'MG' },
  { codigo: '3506003', cidade: 'Bauru', uf: 'SP' },
  { codigo: '4200606', cidade: 'Águas Mornas', uf: 'SC' },
  { codigo: '4205407', cidade: 'Florianópolis', uf: 'SC' },
  { codigo: '4208203', cidade: 'Itajaí', uf: 'SC' },
  { codigo: '4211306', cidade: 'Navegantes', uf: 'SC' },
  { codigo: '3205002', cidade: 'Serra', uf: 'ES' },
];

const GRADE_PADRAO = {
  B2C: Array.from({ length: 100 }, (_, i) => ({ peso: i + 1, valorNF: 150 })),
  ATACADO: Array.from({ length: 10 }, (_, i) => ({ peso: (i + 1) * 50, valorNF: 5000 })),
};

const MOCK_TRANSPORTADORAS = [
  {
    id: 't1',
    nome: 'ATUAL CARGAS',
    canais: ['ATACADO', 'B2C'],
    origens: ['Itajaí', 'Serra'],
    destinos: [
      { ibge: '3506003', cidade: 'Bauru', prazo: 2, preco: 540, origem: 'Itajaí' },
      { ibge: '4205407', cidade: 'Florianópolis', prazo: 1, preco: 390, origem: 'Itajaí' },
      { ibge: '3106200', cidade: 'Belo Horizonte', prazo: 4, preco: 680, origem: 'Serra' },
      { ibge: '4200606', cidade: 'Águas Mornas', prazo: 1, preco: 320, origem: 'Itajaí' },
    ],
  },
  {
    id: 't2',
    nome: 'BRASIL WEB',
    canais: ['ATACADO'],
    origens: ['Itajaí'],
    destinos: [
      { ibge: '3506003', cidade: 'Bauru', prazo: 3, preco: 570, origem: 'Itajaí' },
      { ibge: '3106200', cidade: 'Belo Horizonte', prazo: 3, preco: 640, origem: 'Itajaí' },
      { ibge: '4200606', cidade: 'Águas Mornas', prazo: 2, preco: 360, origem: 'Itajaí' },
    ],
  },
  {
    id: 't3',
    nome: 'TOTAL EXPRESS',
    canais: ['B2C'],
    origens: ['Itajaí'],
    destinos: [
      { ibge: '3506003', cidade: 'Bauru', prazo: 4, preco: 230, origem: 'Itajaí' },
      { ibge: '4205407', cidade: 'Florianópolis', prazo: 2, preco: 180, origem: 'Itajaí' },
      { ibge: '4211306', cidade: 'Navegantes', prazo: 1, preco: 150, origem: 'Itajaí' },
    ],
  },
];

function ResultadoCard({ item }) {
  return (
    <div className="sim-resultado-card">
      <div className="sim-resultado-topo">
        <strong>{item.transportadora}</strong>
        <span>{item.prazo} dia(s)</span>
      </div>
      <div className="sim-resultado-linha">{item.descricao}</div>
      <div className="sim-resultado-grade">
        <div>
          <span>Frete final</span>
          <strong>R$ {item.total.toFixed(2)}</strong>
        </div>
        <div>
          <span>Saving vs 2º</span>
          <strong>R$ {(item.savingSegundo ?? 0).toFixed(2)}</strong>
        </div>
        <div>
          <span>Redução p/ líder</span>
          <strong>{(item.reducaoNecessariaPct ?? 0).toFixed(2)}%</strong>
        </div>
      </div>
    </div>
  );
}

export default function SimuladorPage() {
  const [aba, setAba] = useState('simples');

  const [origemSimples, setOrigemSimples] = useState('Itajaí');
  const [destinoCodigo, setDestinoCodigo] = useState('3506003');
  const [canalSimples, setCanalSimples] = useState('ATACADO');
  const [pesoSimples, setPesoSimples] = useState('150');
  const [nfSimples, setNfSimples] = useState('5000');
  const [resultadoSimples, setResultadoSimples] = useState([]);

  const [transportadora, setTransportadora] = useState('ATUAL CARGAS');
  const [canalTransportadora, setCanalTransportadora] = useState('ATACADO');
  const [origemTransportadora, setOrigemTransportadora] = useState('');
  const [destinoTransportadora, setDestinoTransportadora] = useState('');
  const [pesoTransportadora, setPesoTransportadora] = useState('150');
  const [nfTransportadora, setNfTransportadora] = useState('5000');
  const [modoLista, setModoLista] = useState(false);
  const [listaCodigos, setListaCodigos] = useState('3506003\n4200606');
  const [resultadoTransportadora, setResultadoTransportadora] = useState([]);

  const [transportadoraAnalise, setTransportadoraAnalise] = useState('ATUAL CARGAS');
  const [canalAnalise, setCanalAnalise] = useState('ATACADO');
  const [grade, setGrade] = useState(GRADE_PADRAO);
  const [resultadoAnalise, setResultadoAnalise] = useState(null);

  const [canalCobertura, setCanalCobertura] = useState('ATACADO');
  const [origemCobertura, setOrigemCobertura] = useState('');
  const [transportadoraCobertura, setTransportadoraCobertura] = useState('');
  const [resultadoCobertura, setResultadoCobertura] = useState(null);

  const origensDisponiveis = useMemo(() => {
    const set = new Set();
    MOCK_TRANSPORTADORAS.forEach((t) => t.origens.forEach((o) => set.add(o)));
    return [...set].sort();
  }, []);

  const onSimularSimples = () => {
    if (!origemSimples || !canalSimples || !pesoSimples || !nfSimples || !destinoCodigo) return;
    setResultadoSimples(
      simularSimples({
        transportadoras: MOCK_TRANSPORTADORAS,
        origem: origemSimples,
        canal: canalSimples,
        peso: Number(pesoSimples),
        valorNF: Number(nfSimples),
        destinoCodigo,
        destinosBase: IBGE_BASE,
      }),
    );
  };

  const onSimularTransportadora = () => {
    const codigos = modoLista
      ? listaCodigos.split(/\n|,|;/).map((s) => s.trim()).filter(Boolean)
      : destinoTransportadora
        ? [destinoTransportadora]
        : [];

    setResultadoTransportadora(
      simularPorTransportadora({
        transportadoras: MOCK_TRANSPORTADORAS,
        nomeTransportadora: transportadora,
        canal: canalTransportadora,
        origem: origemTransportadora,
        destinoCodigos: codigos,
        peso: Number(pesoTransportadora),
        valorNF: Number(nfTransportadora),
      }),
    );
  };

  const onSimularGrade = () => {
    setResultadoAnalise(
      analisarTransportadoraPorGrade({
        transportadoras: MOCK_TRANSPORTADORAS,
        nomeTransportadora: transportadoraAnalise,
        canal: canalAnalise,
        grade: grade[canalAnalise],
      }),
    );
  };

  const onAnalisarCobertura = () => {
    setResultadoCobertura(
      analisarCoberturaTabela({
        transportadoras: MOCK_TRANSPORTADORAS,
        ibges: IBGE_BASE,
        canal: canalCobertura,
        origem: origemCobertura,
        transportadora: transportadoraCobertura,
      }),
    );
  };

  return (
    <div className="simulador-shell">
      <div className="simulador-header">
        <div className="simulador-subtitulo">AMD Log • Plataforma de Fretes</div>
        <h1>Simulador de fretes</h1>
        <p>Nova estrutura em 4 telas para separar consulta simples, simulação por transportadora, análise de tabela e cobertura nacional.</p>
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
            <label>CEP ou IBGE de destino
              <input value={destinoCodigo} onChange={(e) => setDestinoCodigo(e.target.value)} placeholder="Ex: 3506003" />
            </label>
            <label>Canal
              <select value={canalSimples} onChange={(e) => setCanalSimples(e.target.value)}>
                <option>ATACADO</option>
                <option>B2C</option>
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
          <div className="sim-resultados">{resultadoSimples.map((item, idx) => <ResultadoCard key={idx} item={item} />)}</div>
        </section>
      )}

      {aba === 'transportadora' && (
        <section className="sim-card">
          <h2>Simulação por transportadora</h2>
          <div className="sim-form-grid sim-grid-6">
            <label>Transportadora
              <select value={transportadora} onChange={(e) => setTransportadora(e.target.value)}>
                {MOCK_TRANSPORTADORAS.map((item) => <option key={item.id}>{item.nome}</option>)}
              </select>
            </label>
            <label>Canal
              <select value={canalTransportadora} onChange={(e) => setCanalTransportadora(e.target.value)}>
                <option>ATACADO</option>
                <option>B2C</option>
              </select>
            </label>
            <label>Origem (opcional)
              <select value={origemTransportadora} onChange={(e) => setOrigemTransportadora(e.target.value)}>
                <option value="">Todas</option>
                {origensDisponiveis.map((item) => <option key={item}>{item}</option>)}
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
          <div className="sim-resultados">{resultadoTransportadora.map((item, idx) => <ResultadoCard key={idx} item={item} />)}</div>
        </section>
      )}

      {aba === 'analise' && (
        <section className="sim-card">
          <h2>Análise de transportadora</h2>
          <div className="sim-form-grid sim-grid-2 compact-top">
            <label>Transportadora
              <select value={transportadoraAnalise} onChange={(e) => setTransportadoraAnalise(e.target.value)}>
                {MOCK_TRANSPORTADORAS.map((item) => <option key={item.id}>{item.nome}</option>)}
              </select>
            </label>
            <label>Canal
              <select value={canalAnalise} onChange={(e) => setCanalAnalise(e.target.value)}>
                <option>ATACADO</option>
                <option>B2C</option>
              </select>
            </label>
          </div>
          <div className="sim-parametros-box">
            <div className="sim-parametros-header">
              <div>
                <strong>Grade de pesos e valores de nota</strong>
                <p>Essa tela simula tudo que a transportadora possui em tabela, obedecendo a grade cadastrada.</p>
              </div>
              <button className="primary small" onClick={onSimularGrade}>Simular grade</button>
            </div>
            <div className="sim-grade-config">
              {(grade[canalAnalise] || []).slice(0, canalAnalise === 'B2C' ? 12 : 10).map((linha, idx) => (
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
            <div className="sim-analise-resumo">
              <div><span>Rotas avaliadas</span><strong>{resultadoAnalise.rotasAvaliadas}</strong></div>
              <div><span>Vitórias</span><strong>{resultadoAnalise.vitorias}</strong></div>
              <div><span>Aderência</span><strong>{resultadoAnalise.aderencia.toFixed(2)}%</strong></div>
              <div><span>Saving vs 2º</span><strong>R$ {resultadoAnalise.saving.toFixed(2)}</strong></div>
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
                <option>ATACADO</option>
                <option>B2C</option>
              </select>
            </label>
            <label>Origem
              <select value={origemCobertura} onChange={(e) => setOrigemCobertura(e.target.value)}>
                <option value="">Todas</option>
                {origensDisponiveis.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Transportadora
              <select value={transportadoraCobertura} onChange={(e) => setTransportadoraCobertura(e.target.value)}>
                <option value="">Todas</option>
                {MOCK_TRANSPORTADORAS.map((item) => <option key={item.id}>{item.nome}</option>)}
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
                <div><span>Cobertura</span><strong>{resultadoCobertura.percentual.toFixed(2)}%</strong></div>
              </div>
              <div className="sim-missing-list">
                {resultadoCobertura.listaFaltantes.map((item, idx) => (
                  <div key={idx} className="sim-missing-item">
                    {item.origem} • {item.cidade} / {item.uf} • IBGE {item.codigo}
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
