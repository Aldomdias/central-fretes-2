import React, { useMemo, useState } from 'react';
import {
  analisarCoberturaTabela,
  analisarTransportadoraPorGrade,
  buildLookupTables,
  exportarLinhasCsv,
  getCidadeByIbge,
  getUfByIbge,
  simularPorTransportadora,
  simularSimples,
} from '../utils/calculoFrete';

const GRADE_PADRAO = {
  B2C: [
    { peso: 1, valorNF: 150 },
    { peso: 5, valorNF: 250 },
    { peso: 10, valorNF: 400 },
    { peso: 20, valorNF: 800 },
  ],
  ATACADO: [
    { peso: 50, valorNF: 2000 },
    { peso: 100, valorNF: 3000 },
    { peso: 150, valorNF: 5000 },
    { peso: 250, valorNF: 8000 },
  ],
};

const UF_OPTIONS = ['', 'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

function formatMoney(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function downloadCsv(nomeArquivo, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', nomeArquivo);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

function buildDestinoLabel(item) {
  if (item.cidadeDestino) return `${item.cidadeDestino}${item.ufDestino ? `/${item.ufDestino}` : ''}`;
  return `IBGE ${item.ibgeDestino}`;
}

function normalizarDestinoDigitado(valor, transportadoras, cidadePorIbge, canal = '', origem = '') {
  const raw = String(valor || '').trim();
  const numero = raw.replace(/\D/g, '');
  if (!raw) return null;

  const porIbge = getCidadeByIbge(numero, cidadePorIbge);
  if (numero.length === 7 && porIbge) {
    return { ibge: numero, cidade: porIbge, uf: getUfByIbge(numero), tipo: 'IBGE' };
  }

  const nomeNormalizado = raw.toLowerCase();
  for (const transportadora of transportadoras || []) {
    for (const origemItem of transportadora.origens || []) {
      if (canal && origemItem.canal !== canal) continue;
      if (origem && origemItem.cidade !== origem) continue;
      for (const rota of origemItem.rotas || []) {
        const ibge = String(rota.ibgeDestino || '').trim();
        const cidade = getCidadeByIbge(ibge, cidadePorIbge);
        if (cidade && cidade.toLowerCase() === nomeNormalizado) {
          return { ibge, cidade, uf: getUfByIbge(ibge), tipo: 'Cidade' };
        }
        const cep = numero;
        const ini = String(rota?.cepInicial || '').replace(/\D/g, '');
        const fim = String(rota?.cepFinal || '').replace(/\D/g, '');
        if (cep.length >= 8 && ini && fim && cep >= ini && cep <= fim) {
          return { ibge, cidade, uf: getUfByIbge(ibge), tipo: 'CEP' };
        }
      }
    }
  }

  return numero.length === 7 ? { ibge: numero, cidade: '', uf: getUfByIbge(numero), tipo: 'IBGE' } : null;
}

function ResultadoCard({ item }) {
  const [aberto, setAberto] = useState(false);

  return (
    <div className="sim-resultado-card">
      <div className="sim-resultado-topo compact-top">
        <div>
          <strong>{item.transportadora}</strong>
          <div className="sim-resultado-linha">Origem {item.origem} • Destino {buildDestinoLabel(item)}</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>#{item.ranking || 1} • {item.prazo} dia(s)</span>
          <button className="sim-tab" type="button" onClick={() => setAberto((v) => !v)}>
            {aberto ? 'Fechar detalhes' : 'Ver detalhes'}
          </button>
        </div>
      </div>

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
          <strong>{formatPercent(item.reducaoNecessariaPct)}</strong>
        </div>
      </div>

      {aberto && (
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
          <div className="sim-parametros-box">
            <div className="sim-parametros-header">
              <div>
                <strong>Formação do frete e prazo</strong>
                <p>Como o valor base foi encontrado.</p>
              </div>
            </div>
            <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
              <div>Tipo de cálculo: <strong>{item.detalhes.frete.tipoCalculo}</strong></div>
              <div>Prazo: <strong>{item.detalhes.prazo} dia(s)</strong></div>
              <div>Faixa aplicada: <strong>{item.detalhes.frete.faixaPeso}</strong></div>
              <div>R$/kg: <strong>{item.detalhes.frete.rsKgAplicado.toFixed(4)}</strong></div>
              <div>% aplicado: <strong>{formatPercent(item.detalhes.frete.percentualAplicado)}</strong></div>
              <div>Valor fixo/faixa: <strong>{formatMoney(item.detalhes.frete.valorFixoAplicado)}</strong></div>
              <div>Mínimo da rota: <strong>{formatMoney(item.detalhes.frete.minimoRota)}</strong></div>
              <div>Valor base: <strong>{formatMoney(item.detalhes.frete.valorBase)}</strong></div>
              <div>Subtotal antes do ICMS: <strong>{formatMoney(item.detalhes.frete.subtotal)}</strong></div>
              <div>ICMS: <strong>{formatMoney(item.detalhes.frete.icms)}</strong></div>
            </div>
          </div>

          <div className="sim-parametros-box">
            <div className="sim-parametros-header">
              <div>
                <strong>Taxas adicionais vinculadas</strong>
                <p>Taxas gerais e específicas do destino.</p>
              </div>
            </div>
            <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
              <div>Ad Valorem: <strong>{formatMoney(item.detalhes.taxas.adValorem)}</strong> ({formatPercent(item.detalhes.taxas.adValPct)} • mín. {formatMoney(item.detalhes.taxas.adValMin)})</div>
              <div>GRIS: <strong>{formatMoney(item.detalhes.taxas.gris)}</strong> ({formatPercent(item.detalhes.taxas.grisPct)} • mín. {formatMoney(item.detalhes.taxas.grisMin)})</div>
              <div>Pedágio: <strong>{formatMoney(item.detalhes.taxas.pedagio)}</strong></div>
              <div>TAS: <strong>{formatMoney(item.detalhes.taxas.tas)}</strong></div>
              <div>CTRC: <strong>{formatMoney(item.detalhes.taxas.ctrc)}</strong></div>
              <div>TDA/STDA: <strong>{formatMoney(item.detalhes.taxas.tda)}</strong></div>
              <div>TDE: <strong>{formatMoney(item.detalhes.taxas.tde)}</strong></div>
              <div>TDR: <strong>{formatMoney(item.detalhes.taxas.tdr)}</strong></div>
              <div>TRT: <strong>{formatMoney(item.detalhes.taxas.trt)}</strong></div>
              <div>Suframa: <strong>{formatMoney(item.detalhes.taxas.suframa)}</strong></div>
              <div>Outras: <strong>{formatMoney(item.detalhes.taxas.outras)}</strong></div>
              <div>Total de taxas: <strong>{formatMoney(item.detalhes.taxas.totalTaxas)}</strong></div>
              <div>Frete final: <strong>{formatMoney(item.detalhes.frete.total)}</strong></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GraficoUf({ itens }) {
  if (!itens?.length) return null;
  const max = Math.max(...itens.map((item) => item.total || item.faltantes || 1), 1);
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {itens.slice(0, 8).map((item) => {
        const valor = item.total || item.faltantes || 0;
        const largura = `${(valor / max) * 100}%`;
        return (
          <div key={item.uf}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <strong>{item.uf}</strong>
              <span>{item.aderencia !== undefined ? `${item.total} rotas • ${formatPercent(item.aderencia)}` : `${item.faltantes} faltantes`}</span>
            </div>
            <div style={{ background: '#e7eefb', borderRadius: 999, height: 10, overflow: 'hidden' }}>
              <div style={{ width: largura, height: '100%', background: '#071b49' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function SimuladorPage({ transportadoras = [] }) {
  const [aba, setAba] = useState('simples');

  const lookup = useMemo(() => buildLookupTables(transportadoras), [transportadoras]);
  const { cidadePorIbge, destinosDisponiveis } = lookup;

  const canais = useMemo(() => [...new Set(transportadoras.flatMap((item) => (item.origens || []).map((origem) => origem.canal)).filter(Boolean))], [transportadoras]);
  const todasOrigens = useMemo(() => [...new Set(transportadoras.flatMap((item) => (item.origens || []).map((origem) => origem.cidade)).filter(Boolean))].sort(), [transportadoras]);
  const todosDestinosComCidade = useMemo(() => destinosDisponiveis.map((ibge) => ({ ibge, cidade: getCidadeByIbge(ibge, cidadePorIbge), uf: getUfByIbge(ibge) })), [destinosDisponiveis, cidadePorIbge]);

  const [origemSimples, setOrigemSimples] = useState(todasOrigens[0] || '');
  const [destinoCodigo, setDestinoCodigo] = useState(destinosDisponiveis[0] || '');
  const [canalSimples, setCanalSimples] = useState(canais[0] || 'ATACADO');
  const [pesoSimples, setPesoSimples] = useState('150');
  const [nfSimples, setNfSimples] = useState('5000');
  const [resultadoSimples, setResultadoSimples] = useState([]);

  const [transportadora, setTransportadora] = useState(transportadoras[0]?.nome || '');
  const [canalTransportadora, setCanalTransportadora] = useState(canais[0] || 'ATACADO');
  const [origemTransportadora, setOrigemTransportadora] = useState('');
  const [destinoTransportadora, setDestinoTransportadora] = useState('');
  const [pesoTransportadora, setPesoTransportadora] = useState('150');
  const [nfTransportadora, setNfTransportadora] = useState('5000');
  const [modoLista, setModoLista] = useState(false);
  const [listaCodigos, setListaCodigos] = useState('4206405\n4202156\n4205001\n4200804');
  const [resultadoTransportadora, setResultadoTransportadora] = useState([]);

  const [transportadoraAnalise, setTransportadoraAnalise] = useState(transportadoras[0]?.nome || '');
  const [canalAnalise, setCanalAnalise] = useState(canais[0] || 'ATACADO');
  const [grade] = useState(GRADE_PADRAO);
  const [resultadoAnalise, setResultadoAnalise] = useState(null);

  const [canalCobertura, setCanalCobertura] = useState(canais[0] || 'ATACADO');
  const [origemCobertura, setOrigemCobertura] = useState('');
  const [transportadoraCobertura, setTransportadoraCobertura] = useState('');
  const [ufCobertura, setUfCobertura] = useState('');
  const [resultadoCobertura, setResultadoCobertura] = useState(null);

  const transportadorasDisponiveis = useMemo(() => transportadoras.map((item) => item.nome).sort(), [transportadoras]);

  const destinoSimplesResolvido = useMemo(() => normalizarDestinoDigitado(destinoCodigo, transportadoras, cidadePorIbge, canalSimples, origemSimples), [destinoCodigo, transportadoras, cidadePorIbge, canalSimples, origemSimples]);
  const destinoTransportadoraResolvido = useMemo(() => normalizarDestinoDigitado(destinoTransportadora, transportadoras, cidadePorIbge, canalTransportadora, origemTransportadora), [destinoTransportadora, transportadoras, cidadePorIbge, canalTransportadora, origemTransportadora]);

  const origensTransportadora = useMemo(() => {
    const selecionada = transportadoras.find((item) => item.nome === transportadora);
    if (!selecionada) return [];
    return [...new Set((selecionada.origens || []).filter((item) => !canalTransportadora || item.canal === canalTransportadora).map((item) => item.cidade))].sort();
  }, [transportadoras, transportadora, canalTransportadora]);

  const canaisTransportadora = useMemo(() => {
    const selecionada = transportadoras.find((item) => item.nome === transportadora);
    if (!selecionada) return canais;
    return [...new Set((selecionada.origens || []).map((item) => item.canal).filter(Boolean))];
  }, [transportadoras, transportadora, canais]);

  const onSimularSimples = () => {
    setResultadoSimples(simularSimples({
      transportadoras,
      origem: origemSimples,
      canal: canalSimples,
      peso: Number(pesoSimples),
      valorNF: Number(nfSimples),
      destinoCodigo,
      cidadePorIbge,
    }));
  };

  const onSimularTransportadora = () => {
    const codigos = modoLista
      ? listaCodigos.split(/\n|,|;/).map((item) => item.trim()).filter(Boolean)
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
      cidadePorIbge,
    }));
  };

  const exportarSimulacaoTransportadora = () => {
    if (!resultadoTransportadora.length) return;
    const { nomeArquivo, csv } = exportarLinhasCsv(`simulacao-${transportadora.toLowerCase().replace(/\s+/g, '-')}.csv`, [
      ['Transportadora', 'Origem', 'Destino', 'UF', 'IBGE', 'Prazo', 'Frete Final', 'Saving vs 2º', 'Diferença Líder', 'Redução % Líder'],
      ...resultadoTransportadora.map((item) => [
        item.transportadora,
        item.origem,
        item.cidadeDestino || `IBGE ${item.ibgeDestino}`,
        item.ufDestino,
        item.ibgeDestino,
        item.prazo,
        item.total.toFixed(2),
        item.savingSegundo.toFixed(2),
        item.diferencaLider.toFixed(2),
        item.reducaoNecessariaPct.toFixed(2),
      ]),
    ]);
    downloadCsv(nomeArquivo, csv);
  };

  const onSimularGrade = () => {
    setResultadoAnalise(analisarTransportadoraPorGrade({
      transportadoras,
      nomeTransportadora: transportadoraAnalise,
      canal: canalAnalise,
      grade: grade[canalAnalise] || grade.ATACADO,
      cidadePorIbge,
    }));
  };

  const exportarAnalise = () => {
    if (!resultadoAnalise?.detalhes?.length) return;
    const { nomeArquivo, csv } = exportarLinhasCsv(`analise-${transportadoraAnalise.toLowerCase().replace(/\s+/g, '-')}.csv`, [
      ['Transportadora', 'Origem', 'Destino', 'UF', 'IBGE', 'Peso', 'Valor NF', 'Prazo', 'Ranking', 'Frete Final', 'Saving 2º'],
      ...resultadoAnalise.detalhes.map((item) => [
        item.transportadora,
        item.origem,
        item.cidadeDestino || `IBGE ${item.ibgeDestino}`,
        item.ufDestino,
        item.ibgeDestino,
        item.gradePeso,
        item.gradeValorNF,
        item.prazo,
        item.ranking,
        item.total.toFixed(2),
        item.savingSegundo.toFixed(2),
      ]),
    ]);
    downloadCsv(nomeArquivo, csv);
  };

  const onAnalisarCobertura = () => {
    setResultadoCobertura(analisarCoberturaTabela({
      transportadoras,
      canal: canalCobertura,
      origem: origemCobertura,
      transportadora: transportadoraCobertura,
      ufDestino: ufCobertura,
      cidadePorIbge,
    }));
  };

  const exportarCobertura = () => {
    if (!resultadoCobertura?.faltantes?.length) return;
    const { nomeArquivo, csv } = exportarLinhasCsv('cobertura-faltantes.csv', [
      ['Origem', 'UF Destino', 'Cidade Destino', 'IBGE Destino', 'Status'],
      ...resultadoCobertura.faltantes.map((item) => [item.origem, item.uf, item.cidade || '', item.ibge, 'Sem tabela']),
    ]);
    downloadCsv(nomeArquivo, csv);
  };

  return (
    <div className="simulador-shell">
      <div className="simulador-header compact-top">
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
                {todasOrigens.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Destino (CEP ou IBGE)
              <input list="destinos-lista" value={destinoCodigo} onChange={(e) => setDestinoCodigo(e.target.value)} placeholder="Ex: 3506003 ou 88345000" />
              <datalist id="destinos-lista">
                {todosDestinosComCidade.map((item) => <option key={item.ibge} value={item.ibge}>{item.cidade ? `${item.cidade}/${item.uf}` : item.ibge}</option>)}
              </datalist>
              {destinoSimplesResolvido ? <small className="sim-destino-preview">{destinoSimplesResolvido.tipo}: {destinoSimplesResolvido.cidade || 'Cidade não mapeada'}{destinoSimplesResolvido.uf ? `/${destinoSimplesResolvido.uf}` : ''} • IBGE {destinoSimplesResolvido.ibge}</small> : <small className="sim-destino-preview">Digite IBGE, CEP ou nome da cidade.</small>}
            </label>
            <label>Canal
              <select value={canalSimples} onChange={(e) => setCanalSimples(e.target.value)}>
                {canais.map((item) => <option key={item}>{item}</option>)}
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
          <div className="sim-resultado-topo compact-top">
            <h2 style={{ margin: 0 }}>Simulação por transportadora</h2>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="sim-tab" type="button" onClick={exportarSimulacaoTransportadora}>Exportar relatório</button>
            </div>
          </div>
          <div className="sim-form-grid sim-grid-6">
            <label>Transportadora
              <select value={transportadora} onChange={(e) => {
                setTransportadora(e.target.value);
                setOrigemTransportadora('');
                const nova = transportadoras.find((item) => item.nome === e.target.value);
                const primeiroCanal = [...new Set((nova?.origens || []).map((item) => item.canal).filter(Boolean))][0] || canais[0] || 'ATACADO';
                setCanalTransportadora(primeiroCanal);
              }}>
                {transportadorasDisponiveis.map((item) => <option key={item}>{item}</option>)}
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
                {origensTransportadora.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Destino opcional (CEP ou IBGE)
              <input disabled={modoLista} value={destinoTransportadora} onChange={(e) => setDestinoTransportadora(e.target.value)} placeholder="Ex: 3506003 ou 88345000" />
              {!modoLista ? (destinoTransportadoraResolvido ? <small className="sim-destino-preview">{destinoTransportadoraResolvido.tipo}: {destinoTransportadoraResolvido.cidade || 'Cidade não mapeada'}{destinoTransportadoraResolvido.uf ? `/${destinoTransportadoraResolvido.uf}` : ''} • IBGE {destinoTransportadoraResolvido.ibge}</small> : <small className="sim-destino-preview">Digite um CEP, IBGE ou nome da cidade.</small>) : null}
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
            {modoLista && (
              <div className="sim-lista-box" style={{ marginTop: 12 }}>
                <label>Lista de CEPs ou IBGEs
                  <textarea value={listaCodigos} onChange={(e) => setListaCodigos(e.target.value)} />
                </label>
              </div>
            )}
          </div>
          <div className="sim-actions"><button className="primary" onClick={onSimularTransportadora}>Simular transportadora</button></div>
          <div className="sim-resultados">{resultadoTransportadora.map((item, idx) => <ResultadoCard key={`${item.transportadora}-${item.ibgeDestino}-${idx}`} item={item} />)}</div>
        </section>
      )}

      {aba === 'analise' && (
        <section className="sim-card">
          <div className="sim-resultado-topo compact-top">
            <h2 style={{ margin: 0 }}>Análise de transportadora</h2>
            <button className="sim-tab" type="button" onClick={exportarAnalise}>Exportar relatório</button>
          </div>
          <div className="sim-form-grid sim-grid-3">
            <label>Transportadora
              <select value={transportadoraAnalise} onChange={(e) => setTransportadoraAnalise(e.target.value)}>
                {transportadorasDisponiveis.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Canal
              <select value={canalAnalise} onChange={(e) => setCanalAnalise(e.target.value)}>
                {canais.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <div className="sim-actions" style={{ alignItems: 'flex-end' }}>
              <button className="primary" onClick={onSimularGrade}>Gerar relatório</button>
            </div>
          </div>

          {resultadoAnalise && (
            <div className="sim-cobertura-box">
              <div className="sim-analise-resumo">
                <div><span>Rotas avaliadas</span><strong>{resultadoAnalise.rotasAvaliadas}</strong></div>
                <div><span>Vitórias</span><strong>{resultadoAnalise.vitorias}</strong></div>
                <div><span>Aderência</span><strong>{formatPercent(resultadoAnalise.aderencia)}</strong></div>
                <div><span>Saving potencial</span><strong>{formatMoney(resultadoAnalise.saving)}</strong></div>
                <div><span>Prazo médio</span><strong>{resultadoAnalise.prazoMedio.toFixed(1)} dia(s)</strong></div>
                <div><span>Frete médio</span><strong>{formatMoney(resultadoAnalise.freteMedio)}</strong></div>
              </div>

              <div className="sim-grid-2" style={{ display: 'grid', gap: 16 }}>
                <div className="sim-parametros-box">
                  <div className="sim-parametros-header"><div><strong>Desempenho por UF</strong><p>Onde a transportadora fica mais competitiva.</p></div></div>
                  <div style={{ marginTop: 12 }}><GraficoUf itens={resultadoAnalise.porUf} /></div>
                </div>
                <div className="sim-parametros-box">
                  <div className="sim-parametros-header"><div><strong>Leitura do relatório</strong><p>Base para devolutiva, reunião ou negociação.</p></div></div>
                  <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                    <div>Total de linhas geradas: <strong>{resultadoAnalise.detalhes.length}</strong></div>
                    <div>Vitórias na grade: <strong>{resultadoAnalise.vitorias}</strong></div>
                    <div>Rotas fora do 1º lugar: <strong>{resultadoAnalise.rotasAvaliadas - resultadoAnalise.vitorias}</strong></div>
                    <div>Melhor uso: <strong>comparar aderência, prazo e necessidade de redução.</strong></div>
                    <div>Critério: <strong>mesma origem, destino, canal, peso e NF.</strong></div>
                  </div>
                </div>
              </div>

              <div className="sim-resultados">
                {resultadoAnalise.detalhes.slice(0, 30).map((item, idx) => <ResultadoCard key={`${item.transportadora}-${idx}`} item={item} />)}
              </div>
            </div>
          )}
        </section>
      )}

      {aba === 'cobertura' && (
        <section className="sim-card">
          <div className="sim-resultado-topo compact-top">
            <h2 style={{ margin: 0 }}>Cobertura de tabela</h2>
            <button className="sim-tab" type="button" onClick={exportarCobertura}>Exportar faltantes</button>
          </div>
          <div className="sim-form-grid sim-grid-4" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
            <label>Canal
              <select value={canalCobertura} onChange={(e) => setCanalCobertura(e.target.value)}>
                {canais.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Origem
              <select value={origemCobertura} onChange={(e) => setOrigemCobertura(e.target.value)}>
                <option value="">Todas</option>
                {todasOrigens.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Transportadora
              <select value={transportadoraCobertura} onChange={(e) => setTransportadoraCobertura(e.target.value)}>
                <option value="">Todas</option>
                {transportadorasDisponiveis.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>UF destino
              <select value={ufCobertura} onChange={(e) => setUfCobertura(e.target.value)}>
                {UF_OPTIONS.map((item) => <option key={item} value={item}>{item || 'Todas'}</option>)}
              </select>
            </label>
          </div>
          <div className="sim-actions"><button className="primary" onClick={onAnalisarCobertura}>Analisar cobertura</button></div>

          {resultadoCobertura && (
            <div className="sim-cobertura-box">
              <div className="sim-parametros-box">
                <div className="sim-parametros-header">
                  <div>
                    <strong>O que esta tela mostra</strong>
                    <p>{resultadoCobertura.explicacao}</p>
                  </div>
                </div>
              </div>

              <div className="sim-analise-resumo">
                <div><span>Origens analisadas</span><strong>{resultadoCobertura.origensSelecionadas.join(', ') || 'Nenhuma'}</strong></div>
                <div><span>Destinos únicos na malha</span><strong>{resultadoCobertura.destinosUniverso.length}</strong></div>
                <div><span>Combinações possíveis</span><strong>{resultadoCobertura.totalCombinacoes}</strong></div>
                <div><span>Cobertas</span><strong>{resultadoCobertura.totalCobertas}</strong></div>
                <div><span>Sem tabela</span><strong>{resultadoCobertura.totalFaltantes}</strong></div>
                <div><span>Cobertura</span><strong>{formatPercent(resultadoCobertura.percentualCobertura)}</strong></div>
              </div>

              <div className="sim-grid-2" style={{ display: 'grid', gap: 16 }}>
                <div className="sim-parametros-box">
                  <div className="sim-parametros-header"><div><strong>Faltantes por UF</strong><p>Onde estão os maiores buracos de malha.</p></div></div>
                  <div style={{ marginTop: 12 }}><GraficoUf itens={resultadoCobertura.resumoPorUf} /></div>
                </div>
                <div className="sim-parametros-box">
                  <div className="sim-parametros-header"><div><strong>Como ler</strong><p>Exemplo: Itajaí → SP mostra quantas cidades de SP ainda estão sem tabela.</p></div></div>
                  <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                    <div>Use o filtro de <strong>origem</strong> para analisar um polo específico.</div>
                    <div>Use <strong>UF destino</strong> para focar em um estado.</div>
                    <div>Combinações possíveis = origem selecionada × todos os destinos já existentes na malha filtrada.</div>
                    <div>Sem tabela = destinos que ainda não têm rota cadastrada para a origem filtrada.</div>
                  </div>
                </div>
              </div>

              <div className="sim-grid-2" style={{ display: 'grid', gap: 16 }}>
                <div>
                  <h3 style={{ marginBottom: 10, color: '#071b49' }}>Sem tabela</h3>
                  <div className="sim-missing-list">
                    {resultadoCobertura.faltantes.slice(0, 60).map((item) => (
                      <div className="sim-missing-item" key={`${item.origem}-${item.ibge}`}>
                        <strong>{item.origem}</strong> • Destino {item.cidade || `IBGE ${item.ibge}`} {item.uf ? `- ${item.uf}` : ''} • IBGE {item.ibge}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 style={{ marginBottom: 10, color: '#071b49' }}>Exemplos com tabela</h3>
                  <div className="sim-missing-list">
                    {resultadoCobertura.cobertas.slice(0, 60).map((item) => (
                      <div className="sim-missing-item" key={`${item.origem}-${item.ibge}`}>
                        <strong>{item.origem}</strong> • Destino {item.cidade || `IBGE ${item.ibge}`} {item.uf ? `- ${item.uf}` : ''} • {item.rota}
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
