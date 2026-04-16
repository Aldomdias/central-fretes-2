import React, { useEffect, useMemo, useState } from 'react';
import {
  analisarCoberturaTabela,
  analisarTransportadoraPorGrade,
  simularPorTransportadora,
  simularSimples,
} from '../utils/calculoFrete';

const IBGE_BASE_PADRAO = [
  { codigo: '3106200', cidade: 'Belo Horizonte', uf: 'MG' },
  { codigo: '3506003', cidade: 'Bauru', uf: 'SP' },
  { codigo: '3549805', cidade: 'São José do Rio Preto', uf: 'SP' },
  { codigo: '3550308', cidade: 'São Paulo', uf: 'SP' },
  { codigo: '4200606', cidade: 'Águas Mornas', uf: 'SC' },
  { codigo: '4205407', cidade: 'Florianópolis', uf: 'SC' },
  { codigo: '4211306', cidade: 'Navegantes', uf: 'SC' },
  { codigo: '5208707', cidade: 'Goiânia', uf: 'GO' },
  { codigo: '5300108', cidade: 'Brasília', uf: 'DF' },
];

const GRADE_PADRAO = {
  B2C: [
    { peso: 1, valorNF: 150 },
    { peso: 5, valorNF: 300 },
    { peso: 10, valorNF: 500 },
    { peso: 20, valorNF: 700 },
    { peso: 30, valorNF: 900 },
    { peso: 50, valorNF: 1200 },
  ],
  ATACADO: [
    { peso: 50, valorNF: 5000 },
    { peso: 100, valorNF: 8000 },
    { peso: 200, valorNF: 12000 },
    { peso: 300, valorNF: 15000 },
    { peso: 500, valorNF: 20000 },
  ],
};

function moeda(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function numero(value, digits = 2) {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value || 0));
}

function percent(value) {
  return `${numero(value, 2)}%`;
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[";\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function exportarCsv(nomeArquivo, linhas) {
  if (!linhas?.length) return;
  const headers = Object.keys(linhas[0]);
  const csv = [headers.join(';'), ...linhas.map((linha) => headers.map((header) => csvEscape(linha[header])).join(';'))].join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = nomeArquivo;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ResultadoDetalhes({ item }) {
  const detalhes = item?.detalhes || {};
  const taxas = detalhes.taxas || {};

  return (
    <div className="sim-detalhes-box">
      <div className="sim-detalhes-grid">
        <div><span>Tipo de cálculo</span><strong>{detalhes.tipoCalculo || '-'}</strong></div>
        <div><span>Faixa usada</span><strong>{detalhes.faixaPeso || '-'}</strong></div>
        <div><span>Rota</span><strong>{detalhes.nomeRota || '-'}</strong></div>
        <div><span>Frete base</span><strong>{moeda(detalhes.freteBase)}</strong></div>
        <div><span>Subtotal</span><strong>{moeda(detalhes.subtotal)}</strong></div>
        <div><span>ICMS</span><strong>{moeda(detalhes.icms)}</strong></div>
        <div><span>Valor/Kg</span><strong>{moeda(detalhes.valorKg)}</strong></div>
        <div><span>% sobre NF</span><strong>{percent(detalhes.percentual)}</strong></div>
        <div><span>Valor fixo/faixa</span><strong>{moeda(detalhes.valorFixo)}</strong></div>
        <div><span>Excesso KG</span><strong>{numero(detalhes.excessoKg)}</strong></div>
        <div><span>Valor excedente</span><strong>{moeda(detalhes.valorExcedente)}</strong></div>
        <div><span>Mínimo da rota</span><strong>{moeda(detalhes.minimoFrete)}</strong></div>
      </div>

      <div className="sim-taxas-lista">
        {[
          ['GRIS', taxas.gris],
          ['ADV', taxas.adValorem],
          ['Pedágio', taxas.pedagio],
          ['TAS', taxas.tas],
          ['CTRC', taxas.ctrc],
          ['TDA', taxas.tda],
          ['TDR', taxas.tdr],
          ['TRT', taxas.trt],
          ['Suframa', taxas.suframa],
          ['Outras', taxas.outras],
        ].map(([label, value]) => (
          <div key={label} className="sim-taxas-card">
            <span>{label}</span>
            <strong>{moeda(value)}</strong>
          </div>
        ))}
      </div>

      {detalhes.observacoes && <div className="sim-detalhes-observacao">Observação da tabela: {detalhes.observacoes}</div>}
    </div>
  );
}

function ResultadoCard({ item, aberto, onToggle }) {
  return (
    <div className="sim-resultado-card">
      <div className="sim-resultado-topo">
        <div>
          <strong>{item.transportadora}</strong>
          <div className="sim-resultado-linha">{item.origem} • {item.destinoCidade || item.destinoCodigo}</div>
        </div>
        <div className="sim-resultado-acoes">
          <span className={`sim-ranking-badge ${item.posicao === 1 ? 'winner' : ''}`}>#{item.posicao} • {item.prazo} dia(s)</span>
          <button className="sim-link-btn" onClick={onToggle}>{aberto ? 'Fechar detalhes' : 'Ver detalhes'}</button>
        </div>
      </div>

      <div className="sim-resultado-grade">
        <div>
          <span>Frete final</span>
          <strong>{moeda(item.total)}</strong>
        </div>
        <div>
          <span>Saving vs 2º</span>
          <strong>{moeda(item.savingSegundo)}</strong>
        </div>
        <div>
          <span>Diferença p/ líder</span>
          <strong>{moeda(item.diferencaLider)}</strong>
        </div>
        <div>
          <span>Redução p/ líder</span>
          <strong>{percent(item.reducaoNecessariaPct)}</strong>
        </div>
      </div>

      {aberto && <ResultadoDetalhes item={item} />}
    </div>
  );
}

export default function SimuladorPage({ transportadoras = [] }) {
  const [aba, setAba] = useState('simples');
  const [detalhesAbertos, setDetalhesAbertos] = useState({});

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
  const [resultadoTransportadora, setResultadoTransportadora] = useState({ erro: '', resultados: [] });

  const [transportadoraAnalise, setTransportadoraAnalise] = useState('');
  const [canalAnalise, setCanalAnalise] = useState('ATACADO');
  const [grade, setGrade] = useState(GRADE_PADRAO);
  const [resultadoAnalise, setResultadoAnalise] = useState(null);
  const [detalheAnaliseKey, setDetalheAnaliseKey] = useState('');

  const [canalCobertura, setCanalCobertura] = useState('ATACADO');
  const [origemCobertura, setOrigemCobertura] = useState('');
  const [transportadoraCobertura, setTransportadoraCobertura] = useState('');
  const [resultadoCobertura, setResultadoCobertura] = useState(null);

  const baseTransportadoras = useMemo(() => transportadoras || [], [transportadoras]);

  const ibgeBase = useMemo(() => {
    const map = new Map(IBGE_BASE_PADRAO.map((item) => [String(item.codigo), item]));
    baseTransportadoras.forEach((t) => {
      (t.origens || []).forEach((origem) => {
        (origem.rotas || []).forEach((rota) => {
          if (!map.has(String(rota.ibgeDestino))) {
            map.set(String(rota.ibgeDestino), {
              codigo: String(rota.ibgeDestino),
              cidade: rota.nomeDestino || rota.cidadeDestino || `IBGE ${rota.ibgeDestino}`,
              uf: rota.ufDestino || '',
            });
          }
        });
      });
    });
    return Array.from(map.values()).sort((a, b) => String(a.cidade).localeCompare(String(b.cidade)));
  }, [baseTransportadoras]);

  const origensDisponiveis = useMemo(() => {
    const set = new Set();
    baseTransportadoras.forEach((t) => (t.origens || []).forEach((o) => set.add(o.cidade)));
    return Array.from(set).sort();
  }, [baseTransportadoras]);

  const nomesTransportadoras = useMemo(() => baseTransportadoras.map((item) => item.nome).sort(), [baseTransportadoras]);

  useEffect(() => {
    if (!origemSimples && origensDisponiveis[0]) setOrigemSimples(origensDisponiveis[0]);
    if (!transportadora && nomesTransportadoras[0]) setTransportadora(nomesTransportadoras[0]);
    if (!transportadoraAnalise && nomesTransportadoras[0]) setTransportadoraAnalise(nomesTransportadoras[0]);
    if (!destinoCodigo && ibgeBase[0]) setDestinoCodigo(String(ibgeBase[0].codigo));
  }, [origensDisponiveis, nomesTransportadoras, ibgeBase, origemSimples, transportadora, transportadoraAnalise, destinoCodigo]);

  const alternarDetalhe = (key) => {
    setDetalhesAbertos((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const onSimularSimples = () => {
    setResultadoSimples(simularSimples({
      transportadoras: baseTransportadoras,
      origem: origemSimples,
      canal: canalSimples,
      peso: Number(pesoSimples),
      valorNF: Number(nfSimples),
      destinoCodigo,
      destinosBase: ibgeBase,
    }));
  };

  const onSimularTransportadora = () => {
    const codigos = modoLista
      ? listaCodigos.split(/\n|,|;/).map((s) => s.trim()).filter(Boolean)
      : destinoTransportadora
        ? [destinoTransportadora]
        : [];

    setResultadoTransportadora(simularPorTransportadora({
      transportadoras: baseTransportadoras,
      nomeTransportadora: transportadora,
      canal: canalTransportadora,
      origem: origemTransportadora,
      destinoCodigos: codigos,
      peso: Number(pesoTransportadora),
      valorNF: Number(nfTransportadora),
      destinosBase: ibgeBase,
    }));
  };

  const onSimularGrade = () => {
    setResultadoAnalise(analisarTransportadoraPorGrade({
      transportadoras: baseTransportadoras,
      nomeTransportadora: transportadoraAnalise,
      canal: canalAnalise,
      grade: grade[canalAnalise],
      destinosBase: ibgeBase,
    }));
  };

  const onAnalisarCobertura = () => {
    setResultadoCobertura(analisarCoberturaTabela({
      transportadoras: baseTransportadoras,
      ibges: ibgeBase,
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
        <p>Comparação por cenário real: mesma origem, mesmo destino, mesmo canal, mesmo peso/faixa e mesmo valor de NF.</p>
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
              <input value={destinoCodigo} onChange={(e) => setDestinoCodigo(e.target.value)} placeholder="Ex: 3106200" />
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
          <div className="sim-resultados">
            {resultadoSimples.map((item) => {
              const key = `${item.transportadora}-${item.origem}-${item.destinoCodigo}-${item.posicao}`;
              return <ResultadoCard key={key} item={item} aberto={!!detalhesAbertos[key]} onToggle={() => alternarDetalhe(key)} />;
            })}
          </div>
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
              <input disabled={modoLista} value={destinoTransportadora} onChange={(e) => setDestinoTransportadora(e.target.value)} placeholder="Ex: 3106200" />
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
          {resultadoTransportadora.erro && <div className="sim-alert-box">{resultadoTransportadora.erro}</div>}
          <div className="sim-resultados">
            {resultadoTransportadora.resultados.map((item) => {
              const key = `${item.transportadora}-${item.origem}-${item.destinoCodigo}-${item.posicao}`;
              return <ResultadoCard key={key} item={item} aberto={!!detalhesAbertos[key]} onToggle={() => alternarDetalhe(key)} />;
            })}
          </div>
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
                <option>ATACADO</option>
                <option>B2C</option>
              </select>
            </label>
          </div>
          <div className="sim-parametros-box">
            <div className="sim-parametros-header">
              <div>
                <strong>Grade de pesos e valores de nota</strong>
                <p>Essa tela avalia cada rota da transportadora na mesma chave de comparação do mercado.</p>
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
          {resultadoAnalise?.erro && <div className="sim-alert-box">{resultadoAnalise.erro}</div>}
          {resultadoAnalise && (
            <>
              <div className="sim-analise-resumo sim-analise-resumo-top">
                <div><span>Rotas avaliadas</span><strong>{resultadoAnalise.resumo.rotasAvaliadas}</strong></div>
                <div><span>Vitórias</span><strong>{resultadoAnalise.resumo.vitorias}</strong></div>
                <div><span>Perdas</span><strong>{resultadoAnalise.resumo.perdas}</strong></div>
                <div><span>Aderência</span><strong>{percent(resultadoAnalise.resumo.aderencia)}</strong></div>
                <div><span>Saving vs 2º</span><strong>{moeda(resultadoAnalise.resumo.saving)}</strong></div>
                <div><span>Frete médio</span><strong>{moeda(resultadoAnalise.resumo.freteMedio)}</strong></div>
              </div>
              <div className="sim-actions sim-actions-left">
                <button
                  className="primary small"
                  onClick={() => exportarCsv('analise-transportadora.csv', resultadoAnalise.itens.map((item) => ({
                    transportadora: item.transportadora,
                    origem: item.origem,
                    destino: item.destinoCidade,
                    ibge: item.destinoCodigo,
                    peso: item.peso,
                    valor_nf: item.valorNF,
                    posicao: item.posicao,
                    prazo: item.prazo,
                    total: numero(item.total),
                    melhor_concorrente: item.melhorConcorrente?.transportadora || '',
                    valor_lider: numero(item.melhorConcorrente?.total || 0),
                    segundo_colocado: item.segundoColocado?.transportadora || '',
                    valor_segundo: numero(item.segundoColocado?.total || 0),
                    diferenca_lider: numero(item.diferencaLider),
                    reducao_necessaria_pct: numero(item.reducaoNecessariaPct),
                  })))}
                >
                  Exportar CSV
                </button>
              </div>
              <div className="sim-table-wrap">
                <table className="sim-table">
                  <thead>
                    <tr>
                      <th>Origem</th>
                      <th>Destino</th>
                      <th>IBGE</th>
                      <th>Peso</th>
                      <th>NF</th>
                      <th>Posição</th>
                      <th>Valor</th>
                      <th>Líder</th>
                      <th>2º lugar</th>
                      <th>Redução</th>
                      <th>Prazo</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultadoAnalise.itens.map((item) => {
                      const rowKey = `${item.origem}-${item.destinoCodigo}-${item.peso}-${item.valorNF}`;
                      const aberto = detalheAnaliseKey === rowKey;
                      return (
                        <React.Fragment key={rowKey}>
                          <tr>
                            <td>{item.origem}</td>
                            <td>{item.destinoCidade}</td>
                            <td>{item.destinoCodigo}</td>
                            <td>{numero(item.peso, 0)}</td>
                            <td>{moeda(item.valorNF)}</td>
                            <td>#{item.posicao}</td>
                            <td>{moeda(item.total)}</td>
                            <td>{item.melhorConcorrente?.transportadora || '-'}</td>
                            <td>{item.segundoColocado?.transportadora || '-'}</td>
                            <td>{percent(item.reducaoNecessariaPct)}</td>
                            <td>{item.prazo} dia(s)</td>
                            <td><button className="sim-link-btn" onClick={() => setDetalheAnaliseKey(aberto ? '' : rowKey)}>{aberto ? 'Fechar' : 'Detalhes'}</button></td>
                          </tr>
                          {aberto && (
                            <tr className="sim-detalhe-row">
                              <td colSpan="12"><ResultadoDetalhes item={item} /></td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
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
                <div><span>Cobertura</span><strong>{percent(resultadoCobertura.percentual)}</strong></div>
              </div>
              <div className="sim-table-wrap">
                <table className="sim-table">
                  <thead>
                    <tr>
                      <th>Origem</th>
                      <th>Total</th>
                      <th>Cobertas</th>
                      <th>Sem tabela</th>
                      <th>% cobertura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultadoCobertura.resumoPorOrigem.map((item) => (
                      <tr key={item.origem}>
                        <td>{item.origem}</td>
                        <td>{item.total}</td>
                        <td>{item.cobertas}</td>
                        <td>{item.faltantes}</td>
                        <td>{percent(item.percentual)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="sim-missing-list">
                {resultadoCobertura.listaFaltantes.map((item, idx) => (
                  <div key={`${item.origem}-${item.codigo}-${idx}`} className="sim-missing-item warning">
                    <strong>{item.origem}</strong>
                    <span>{item.cidade} / {item.uf || '-'}</span>
                    <span>IBGE {item.codigo}</span>
                    <span>{item.status}</span>
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
