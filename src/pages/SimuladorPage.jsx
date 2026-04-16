import React, { useEffect, useMemo, useState } from 'react';
import {
  analisarCoberturaTabela,
  analisarTransportadoraPorGrade,
  buildKnownCitiesMap,
  extrairCanais,
  extrairOrigens,
  simularPorTransportadora,
  simularSimples,
} from '../utils/calculoFrete';

const GRADE_PADRAO = {
  B2C: Array.from({ length: 10 }, (_, i) => ({ peso: i + 1, valorNF: 150 })),
  ATACADO: Array.from({ length: 8 }, (_, i) => ({ peso: (i + 1) * 50, valorNF: 5000 })),
};

function moeda(valor) {
  return `R$ ${Number(valor || 0).toFixed(2)}`;
}

function percentual(valor) {
  return `${Number(valor || 0).toFixed(2)}%`;
}

function LinhaDetalhe({ label, value, destaque = false }) {
  return (
    <div className={`sim-detail-line ${destaque ? 'is-highlight' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ResultadoCard({ item, indice }) {
  const [aberto, setAberto] = useState(false);
  const detalhes = item.detalhes || {};
  const taxas = detalhes.taxas || {};

  return (
    <div className="sim-resultado-card">
      <div className="sim-resultado-topo">
        <div>
          <strong>{item.transportadora}</strong>
          <div className="sim-resultado-linha">{item.descricao}</div>
        </div>
        <div className="sim-resultado-topo-right">
          <span>#{item.posicao || indice + 1} • {item.prazo} dia(s)</span>
          <button type="button" className="sim-detail-toggle" onClick={() => setAberto((v) => !v)}>
            {aberto ? 'Fechar detalhes' : 'Ver detalhes'}
          </button>
        </div>
      </div>

      <div className="sim-resultado-grade sim-resultado-grade--four">
        <div>
          <span>Frete final</span>
          <strong>{moeda(item.total)}</strong>
        </div>
        <div>
          <span>Saving vs 2º</span>
          <strong>{moeda(item.savingSegundo || 0)}</strong>
        </div>
        <div>
          <span>Diferença p/ líder</span>
          <strong>{moeda(item.diferencaLider || 0)}</strong>
        </div>
        <div>
          <span>Redução p/ líder</span>
          <strong>{percentual(item.reducaoNecessariaPct || 0)}</strong>
        </div>
      </div>

      {aberto && (
        <div className="sim-detalhes-grid">
          <div className="sim-detail-panel">
            <div className="sim-detail-panel-title">Cálculo do frete / prazo</div>
            <LinhaDetalhe label="Origem" value={item.origem || '-'} />
            <LinhaDetalhe label="Destino" value={`${item.destino || '-'} • IBGE ${item.ibge || '-'}`} />
            <LinhaDetalhe label="Prazo" value={`${item.prazo || 0} dia(s)`} />
            <LinhaDetalhe label="Peso considerado" value={`${item.peso || 0} kg`} />
            <LinhaDetalhe label="Valor NF" value={moeda(item.valorNF || 0)} />
            <LinhaDetalhe label="Tipo de cálculo" value={detalhes.tipoCalculo || '-'} destaque />
            <LinhaDetalhe label="Faixa aplicada" value={detalhes.faixa || '-'} />
            <LinhaDetalhe label="Percentual aplicado" value={detalhes.tipoCalculo === 'PERCENTUAL' ? percentual(detalhes.percentualAplicado || 0) : '-'} />
            <LinhaDetalhe label="Valor por kg" value={detalhes.tipoCalculo === 'PERCENTUAL' ? moeda(detalhes.valorKg || 0) : '-'} />
            <LinhaDetalhe label="Frete tabela" value={moeda(detalhes.freteTabela || 0)} />
            <LinhaDetalhe label="Frete por peso" value={moeda(detalhes.fretePeso || 0)} />
            <LinhaDetalhe label="Frete percentual" value={moeda(detalhes.fretePercentual || 0)} />
            <LinhaDetalhe label="Valor excedente" value={moeda(detalhes.valorExcedente || 0)} />
            <LinhaDetalhe label="Mínimo da rota" value={moeda(detalhes.minimoRota || 0)} />
            <LinhaDetalhe label="Subtotal do frete" value={moeda(detalhes.freteBase || 0)} destaque />
          </div>

          <div className="sim-detail-panel">
            <div className="sim-detail-panel-title">Taxas adicionais vinculadas</div>
            <LinhaDetalhe label={`GRIS (${(taxas.grisPct || 0).toFixed(2)}% | mín. ${moeda(taxas.grisMinimo || 0)})`} value={moeda(taxas.gris || 0)} />
            <LinhaDetalhe label={`ADV (${(taxas.advPct || 0).toFixed(2)}%)`} value={moeda(taxas.adv || 0)} />
            <LinhaDetalhe label="Pedágio" value={moeda(taxas.pedagio || 0)} />
            <LinhaDetalhe label="TAS" value={moeda(taxas.tas || 0)} />
            <LinhaDetalhe label="CTRC" value={moeda(taxas.ctrc || 0)} />
            <LinhaDetalhe label="TDA / STDA" value={moeda(taxas.tda || 0)} />
            <LinhaDetalhe label="TDE" value={moeda(taxas.tde || 0)} />
            <LinhaDetalhe label="TRT" value={moeda(taxas.trt || 0)} />
            <LinhaDetalhe label="Suframa" value={moeda(taxas.suframa || 0)} />
            <LinhaDetalhe label="Outras" value={moeda(taxas.outras || 0)} />
            <LinhaDetalhe label="Total de taxas" value={moeda(taxas.totalTaxas || 0)} destaque />
            <LinhaDetalhe label="Frete final com taxas" value={moeda(item.total || 0)} destaque />
          </div>
        </div>
      )}
    </div>
  );
}

export default function SimuladorPage({ transportadoras = [] }) {
  const [aba, setAba] = useState('simples');
  const canaisDisponiveis = useMemo(() => extrairCanais(transportadoras), [transportadoras]);
  const canalInicial = canaisDisponiveis[0] || 'ATACADO';
  const citiesMap = useMemo(() => buildKnownCitiesMap(transportadoras), [transportadoras]);
  const origensDisponiveis = useMemo(() => extrairOrigens(transportadoras), [transportadoras]);

  const [origemSimples, setOrigemSimples] = useState('');
  const [destinoCodigo, setDestinoCodigo] = useState('');
  const [canalSimples, setCanalSimples] = useState(canalInicial);
  const [pesoSimples, setPesoSimples] = useState('150');
  const [nfSimples, setNfSimples] = useState('5000');
  const [resultadoSimples, setResultadoSimples] = useState([]);

  const [transportadora, setTransportadora] = useState('');
  const [canalTransportadora, setCanalTransportadora] = useState(canalInicial);
  const [origemTransportadora, setOrigemTransportadora] = useState('');
  const [destinoTransportadora, setDestinoTransportadora] = useState('');
  const [pesoTransportadora, setPesoTransportadora] = useState('150');
  const [nfTransportadora, setNfTransportadora] = useState('5000');
  const [modoLista, setModoLista] = useState(false);
  const [listaCodigos, setListaCodigos] = useState('');
  const [resultadoTransportadora, setResultadoTransportadora] = useState([]);

  const [transportadoraAnalise, setTransportadoraAnalise] = useState('');
  const [canalAnalise, setCanalAnalise] = useState(canalInicial);
  const [grade, setGrade] = useState(GRADE_PADRAO);
  const [resultadoAnalise, setResultadoAnalise] = useState(null);

  const [canalCobertura, setCanalCobertura] = useState(canalInicial);
  const [origemCobertura, setOrigemCobertura] = useState('');
  const [transportadoraCobertura, setTransportadoraCobertura] = useState('');
  const [resultadoCobertura, setResultadoCobertura] = useState(null);

  useEffect(() => {
    if (!origemSimples && origensDisponiveis.length) setOrigemSimples(origensDisponiveis[0]);
  }, [origensDisponiveis, origemSimples]);

  useEffect(() => {
    if (!transportadora && transportadoras.length) setTransportadora(transportadoras[0].nome);
    if (!transportadoraAnalise && transportadoras.length) setTransportadoraAnalise(transportadoras[0].nome);
  }, [transportadoras, transportadora, transportadoraAnalise]);

  useEffect(() => {
    setCanalSimples(canalInicial);
    setCanalTransportadora(canalInicial);
    setCanalAnalise(canalInicial);
    setCanalCobertura(canalInicial);
  }, [canalInicial]);

  const origensFiltradasTransportadora = useMemo(() => {
    const t = transportadoras.find((item) => item.nome === transportadora);
    if (!t) return [];
    return (t.origens || [])
      .filter((item) => String(item.canal || 'ATACADO').toUpperCase() === canalTransportadora)
      .map((item) => item.cidade)
      .sort((a, b) => a.localeCompare(b));
  }, [transportadoras, transportadora, canalTransportadora]);

  const onSimularSimples = () => {
    setResultadoSimples(
      simularSimples({
        transportadoras,
        origem: origemSimples,
        canal: canalSimples,
        peso: Number(pesoSimples),
        valorNF: Number(nfSimples),
        destinoCodigo: destinoCodigo.trim(),
        citiesMap,
      }),
    );
  };

  const onSimularTransportadora = () => {
    const codigos = modoLista
      ? listaCodigos.split(/\n|,|;/).map((s) => s.trim()).filter(Boolean)
      : destinoTransportadora
        ? [destinoTransportadora.trim()]
        : [];

    setResultadoTransportadora(
      simularPorTransportadora({
        transportadoras,
        nomeTransportadora: transportadora,
        canal: canalTransportadora,
        origem: origemTransportadora,
        destinoCodigos: codigos,
        peso: Number(pesoTransportadora),
        valorNF: Number(nfTransportadora),
        citiesMap,
      }),
    );
  };

  const onSimularGrade = () => {
    setResultadoAnalise(
      analisarTransportadoraPorGrade({
        transportadoras,
        nomeTransportadora: transportadoraAnalise,
        canal: canalAnalise,
        grade: grade[canalAnalise] || [],
        citiesMap,
      }),
    );
  };

  const onAnalisarCobertura = () => {
    setResultadoCobertura(
      analisarCoberturaTabela({
        transportadoras,
        canal: canalCobertura,
        origem: origemCobertura,
        transportadora: transportadoraCobertura,
        citiesMap,
      }),
    );
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
          <div className="sim-resultados">{resultadoSimples.map((item, idx) => <ResultadoCard key={`${item.transportadora}-${item.ibge}-${idx}`} item={item} indice={idx} />)}</div>
        </section>
      )}

      {aba === 'transportadora' && (
        <section className="sim-card">
          <h2>Simulação por transportadora</h2>
          <div className="sim-form-grid sim-grid-6">
            <label>Transportadora
              <select value={transportadora} onChange={(e) => setTransportadora(e.target.value)}>
                {transportadoras.map((item) => <option key={item.id}>{item.nome}</option>)}
              </select>
            </label>
            <label>Canal
              <select value={canalTransportadora} onChange={(e) => setCanalTransportadora(e.target.value)}>
                {canaisDisponiveis.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Origem (opcional)
              <select value={origemTransportadora} onChange={(e) => setOrigemTransportadora(e.target.value)}>
                <option value="">Todas</option>
                {origensFiltradasTransportadora.map((item) => <option key={item}>{item}</option>)}
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
          <div className="sim-resultados">{resultadoTransportadora.map((item, idx) => <ResultadoCard key={`${item.origem}-${item.ibge}-${idx}`} item={item} indice={idx} />)}</div>
        </section>
      )}

      {aba === 'analise' && (
        <section className="sim-card">
          <h2>Análise de transportadora</h2>
          <div className="sim-form-grid sim-grid-2 compact-top">
            <label>Transportadora
              <select value={transportadoraAnalise} onChange={(e) => setTransportadoraAnalise(e.target.value)}>
                {transportadoras.map((item) => <option key={item.id}>{item.nome}</option>)}
              </select>
            </label>
            <label>Canal
              <select value={canalAnalise} onChange={(e) => setCanalAnalise(e.target.value)}>
                {canaisDisponiveis.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
          </div>
          <div className="sim-parametros-box">
            <div className="sim-parametros-header">
              <div>
                <strong>Grade de pesos e valores de nota</strong>
                <p>Essa tela avalia a tabela da transportadora em toda a grade informada, sempre comparando com o mesmo cenário.</p>
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
            <>
              <div className="sim-analise-resumo">
                <div><span>Rotas avaliadas</span><strong>{resultadoAnalise.rotasAvaliadas}</strong></div>
                <div><span>Vitórias</span><strong>{resultadoAnalise.vitorias}</strong></div>
                <div><span>Aderência</span><strong>{percentual(resultadoAnalise.aderencia)}</strong></div>
                <div><span>Saving vs 2º</span><strong>{moeda(resultadoAnalise.saving)}</strong></div>
              </div>
              <div className="sim-analise-tabela-wrap">
                <table className="sim-analise-tabela">
                  <thead>
                    <tr>
                      <th>Origem</th>
                      <th>Destino</th>
                      <th>Peso</th>
                      <th>NF</th>
                      <th>Valor</th>
                      <th>Líder</th>
                      <th>Posição</th>
                      <th>Prazo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultadoAnalise.detalhes.slice(0, 80).map((item, idx) => (
                      <tr key={`${item.origem}-${item.ibge}-${idx}`}>
                        <td>{item.origem}</td>
                        <td>{item.destino}</td>
                        <td>{item.peso}</td>
                        <td>{moeda(item.valorNF)}</td>
                        <td>{moeda(item.total)}</td>
                        <td>{item.lider}</td>
                        <td>#{item.posicao}</td>
                        <td>{item.prazo} dia(s)</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {aba === 'cobertura' && (
        <section className="sim-card">
          <h2>Cobertura de tabela</h2>
          <p className="sim-help-text">Aqui o sistema cruza todas as origens filtradas com todos os destinos únicos encontrados na malha filtrada. Assim você enxerga o que já tem rota cadastrada e onde ainda falta tabela.</p>
          <div className="sim-form-grid sim-grid-3 compact-top">
            <label>Canal
              <select value={canalCobertura} onChange={(e) => setCanalCobertura(e.target.value)}>
                {canaisDisponiveis.map((item) => <option key={item}>{item}</option>)}
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
                {transportadoras.map((item) => <option key={item.id}>{item.nome}</option>)}
              </select>
            </label>
          </div>
          <div className="sim-actions"><button className="primary" onClick={onAnalisarCobertura}>Analisar cobertura</button></div>
          {resultadoCobertura && (
            <div className="sim-cobertura-box">
              <div className="sim-analise-resumo">
                <div><span>Origens analisadas</span><strong>{resultadoCobertura.totalOrigens}</strong></div>
                <div><span>Destinos únicos</span><strong>{resultadoCobertura.totalDestinos}</strong></div>
                <div><span>Combinações possíveis</span><strong>{resultadoCobertura.totalPossivel}</strong></div>
                <div><span>Cobertas</span><strong>{resultadoCobertura.cobertas}</strong></div>
                <div><span>Sem tabela</span><strong>{resultadoCobertura.semTabela}</strong></div>
                <div><span>Cobertura</span><strong>{percentual(resultadoCobertura.percentual)}</strong></div>
              </div>

              <div className="sim-cobertura-split">
                <div>
                  <div className="sim-detail-panel-title">Exemplos com tabela</div>
                  <div className="sim-missing-list">
                    {resultadoCobertura.exemplosCobertos.map((item, idx) => (
                      <div className="sim-missing-item" key={`cob-${idx}`}>
                        <strong>{item.transportadora}</strong>
                        <div>{item.origem} → {item.destino}</div>
                        <small>IBGE {item.ibge}</small>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="sim-detail-panel-title">Sem tabela</div>
                  <div className="sim-missing-list">
                    {resultadoCobertura.faltantes.map((item, idx) => (
                      <div className="sim-missing-item" key={`fat-${idx}`}>
                        <strong>{item.transportadora}</strong>
                        <div>{item.origem} → {item.destino}</div>
                        <small>IBGE {item.ibge}</small>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
