
import React, { useEffect, useMemo, useState } from 'react';
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
import { buscarBaseSimulacaoDb, carregarMunicipiosIbgeDb, carregarOpcoesSimuladorDb, resolverDestinoIbgeDb } from '../services/freteDatabaseService';

const GRADE_STORAGE_KEY = 'amd-grade-peso-v2';
const GRADE_PADRAO = {
  B2C: [
    { peso: 1, valorNF: 150, cubagem: 0 },
    { peso: 5, valorNF: 250, cubagem: 0 },
    { peso: 10, valorNF: 400, cubagem: 0 },
    { peso: 20, valorNF: 800, cubagem: 0 },
    { peso: 50, valorNF: 1800, cubagem: 0 },
    { peso: 100, valorNF: 3000, cubagem: 0 },
    { peso: 150, valorNF: 4500, cubagem: 0 },
  ],
  ATACADO: [
    { peso: 50, valorNF: 2000, cubagem: 0 },
    { peso: 100, valorNF: 3000, cubagem: 0 },
    { peso: 150, valorNF: 5000, cubagem: 0 },
    { peso: 250, valorNF: 8000, cubagem: 0 },
    { peso: 500, valorNF: 12000, cubagem: 0 },
  ],
};

function canaisDaTransportadora(nome, opcoesOnline, transportadoras) {
  const online = opcoesOnline.canaisPorTransportadora?.[nome];
  if (online?.length) return online;

  const local = transportadoras.find((item) => item.nome === nome);
  return [...new Set((local?.origens || []).map((origem) => origem.canal || 'ATACADO').filter(Boolean))].sort();
}

function filtrarTransportadorasPorCanal(nomes = [], canal, opcoesOnline, transportadoras) {
  if (!canal) return nomes;
  return (nomes || []).filter((nome) => canaisDaTransportadora(nome, opcoesOnline, transportadoras).includes(canal));
}

function normalizeBuscaIbge(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function limparCidadeDigitada(texto) {
  return String(texto || '').replace(/\s*\/\s*[A-Z]{2}$/i, '').trim();
}

function montarLabelMunicipio(item) {
  if (!item) return '';
  return `${item.cidade || 'IBGE'}${item.uf ? `/${item.uf}` : ''} · ${item.ibge}`;
}

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
function getGradeInicial() {
  try {
    const raw = localStorage.getItem(GRADE_STORAGE_KEY);
    if (!raw) return GRADE_PADRAO;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}
  return GRADE_PADRAO;
}
function getRankingBadge(ranking) {
  if (ranking === 1) return '🏆 1º lugar';
  if (ranking === 2) return '🥈 2º lugar';
  if (ranking === 3) return '🥉 3º lugar';
  return `#${ranking || '-'} lugar`;
}

function ResultadoCard({ item }) {
  const [aberto, setAberto] = useState(false);
  const destaque = item.ranking === 1
    ? { borderColor: '#92d6a5', boxShadow: '0 0 0 1px rgba(74, 222, 128, 0.20) inset' }
    : {};

  return (
    <div className="sim-resultado-card" style={destaque}>
      <div className="sim-resultado-topo compact-top">
        <div>
          <strong>{item.transportadora}</strong>
          <div className="sim-resultado-linha">Origem {item.origem} • Destino {buildDestinoLabel(item)}</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{getRankingBadge(item.ranking)} • {item.prazo} dia(s)</span>
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
          <span>% sobre NF</span>
          <strong>{formatPercent(item.percentualSobreNF)}</strong>
        </div>
        <div>
          <span>{item.ranking === 1 ? 'Próxima se bloquear' : 'Perdeu para'}</span>
          <strong>{item.ranking === 1 ? (item.proximaSeBloquear || 'Sem substituta') : (item.perdeuPara || '-')}</strong>
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
              <div>Tipo de cálculo: <strong>{item.detalhes?.frete?.tipoCalculo}</strong></div>
              <div>Prazo: <strong>{item.detalhes?.prazo} dia(s)</strong></div>
              <div>Faixa aplicada: <strong>{item.detalhes?.frete?.faixaPeso}</strong></div>
              <div>Peso informado: <strong>{item.detalhes?.frete?.pesoInformado} kg</strong></div>
              <div>Peso da grade: <strong>{item.detalhes?.frete?.pesoGrade} kg</strong></div>
              <div>Cubagem da grade: <strong>{Number(item.detalhes?.frete?.cubagemGrade || 0).toFixed(6)} m³</strong></div>
              <div>Fator cubagem: <strong>{item.detalhes?.frete?.fatorCubagem} kg/m³</strong></div>
              <div>Peso cubado: <strong>{Number(item.detalhes?.frete?.pesoCubado || 0).toFixed(2)} kg</strong></div>
              <div>Peso considerado: <strong>{Number(item.detalhes?.frete?.pesoConsiderado || 0).toFixed(2)} kg</strong></div>
              <div>R$/kg: <strong>{Number(item.detalhes?.frete?.rsKgAplicado || 0).toFixed(4)}</strong></div>
              <div>% aplicado: <strong>{formatPercent(item.detalhes?.frete?.percentualAplicado)}</strong></div>
              <div>Valor fixo/faixa: <strong>{formatMoney(item.detalhes?.frete?.valorFixoAplicado)}</strong></div>
              <div>Valor NF utilizado: <strong>{formatMoney(item.detalhes?.frete?.valorNFInformado)}</strong> <span style={{ color: '#64748b' }}>({item.detalhes?.frete?.valorNFOrigem === 'manual' ? 'informado' : 'grade padrão'})</span></div>
              <div>Limite para excedente: <strong>{Number(item.detalhes?.frete?.pesoLimiteExcedente || 0).toFixed(0)} kg</strong></div>
              <div>Peso excedente: <strong>{Number(item.detalhes?.frete?.pesoExcedente || 0).toFixed(2)} kg</strong></div>
              <div>Valor do excedente: <strong>{formatMoney(item.detalhes?.frete?.valorExcedente)}</strong></div>
              <div>Mínimo da rota: <strong>{formatMoney(item.detalhes?.frete?.minimoRota)}</strong></div>
              <div>Valor base: <strong>{formatMoney(item.detalhes?.frete?.valorBase)}</strong></div>
              <div>Subtotal antes do ICMS: <strong>{formatMoney(item.detalhes?.frete?.subtotal)}</strong></div>
              <div>ICMS ({formatPercent(item.detalhes?.frete?.aliquotaIcms)}): <strong>{formatMoney(item.detalhes?.frete?.icms)}</strong> <span style={{ color: '#64748b' }}>({item.detalhes?.frete?.origemAliquotaIcms})</span></div>
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
              <div>Ad Valorem: <strong>{formatMoney(item.detalhes?.taxas?.adValorem)}</strong> ({formatPercent(item.detalhes?.taxas?.adValPct)} • mín. {formatMoney(item.detalhes?.taxas?.adValMin)})</div>
              <div>GRIS: <strong>{formatMoney(item.detalhes?.taxas?.gris)}</strong> ({formatPercent(item.detalhes?.taxas?.grisPct)} • mín. {formatMoney(item.detalhes?.taxas?.grisMin)})</div>
              <div>Pedágio: <strong>{formatMoney(item.detalhes?.taxas?.pedagio)}</strong></div>
              <div>TAS: <strong>{formatMoney(item.detalhes?.taxas?.tas)}</strong></div>
              <div>CTRC: <strong>{formatMoney(item.detalhes?.taxas?.ctrc)}</strong></div>
              <div>TDA/STDA: <strong>{formatMoney(item.detalhes?.taxas?.tda)}</strong></div>
              <div>TDE: <strong>{formatMoney(item.detalhes?.taxas?.tde)}</strong></div>
              <div>TDR: <strong>{formatMoney(item.detalhes?.taxas?.tdr)}</strong></div>
              <div>TRT: <strong>{formatMoney(item.detalhes?.taxas?.trt)}</strong></div>
              <div>Suframa: <strong>{formatMoney(item.detalhes?.taxas?.suframa)}</strong></div>
              <div>Outras: <strong>{formatMoney(item.detalhes?.taxas?.outras)}</strong></div>
              <div>Total de taxas: <strong>{formatMoney(item.detalhes?.taxas?.totalTaxas)}</strong></div>
              <div>Frete substituta: <strong>{item.freteSubstituta ? formatMoney(item.freteSubstituta) : '-'}</strong></div>
              <div>Frete final: <strong>{formatMoney(item.detalhes?.frete?.total)}</strong></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GraficoUf({ itens }) {
  if (!itens?.length) return null;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {itens.slice(0, 8).map((item) => {
        const largura = `${Math.max(Math.min(Number(item.aderencia || 0), 100), 0)}%`;
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
  const [grade] = useState(getGradeInicial());
  const [opcoesOnline, setOpcoesOnline] = useState({
    transportadoras: [],
    origens: [],
    canais: [],
    origensPorTransportadora: {},
    canaisPorTransportadora: {},
    municipiosIbge: [],
    fonte: '',
    atualizadoEm: '',
  });
  const [carregandoOpcoes, setCarregandoOpcoes] = useState(false);
  const [erroOpcoes, setErroOpcoes] = useState('');
  const [municipiosIbge, setMunicipiosIbge] = useState([]);

  const lookup = useMemo(() => buildLookupTables(transportadoras), [transportadoras]);
  const { cidadePorIbge, destinosDisponiveis } = lookup;

  const municipiosDisponiveis = useMemo(() => {
    const fonte = municipiosIbge.length ? municipiosIbge : opcoesOnline.municipiosIbge || [];
    const porIbge = new Map();
    (fonte || []).forEach((item) => {
      if (item?.ibge && item?.cidade) porIbge.set(String(item.ibge), item);
    });
    return [...porIbge.values()].sort((a, b) => `${a.cidade}/${a.uf}`.localeCompare(`${b.cidade}/${b.uf}`, 'pt-BR'));
  }, [municipiosIbge, opcoesOnline.municipiosIbge]);

  const cidadePorIbgeCompleto = useMemo(() => {
    const mapa = new Map(cidadePorIbge || []);
    municipiosDisponiveis.forEach((item) => {
      if (item.ibge && item.cidade) mapa.set(String(item.ibge), item.uf ? `${item.cidade}/${item.uf}` : item.cidade);
    });
    return mapa;
  }, [cidadePorIbge, municipiosDisponiveis]);

  const municipioPorIbge = useMemo(() => {
    const mapa = new Map();
    municipiosDisponiveis.forEach((item) => mapa.set(String(item.ibge), item));
    return mapa;
  }, [municipiosDisponiveis]);

  const municipioPorCidade = useMemo(() => {
    const mapa = new Map();
    municipiosDisponiveis.forEach((item) => {
      const cidade = normalizeBuscaIbge(item.cidade);
      const cidadeUf = normalizeBuscaIbge(`${item.cidade}/${item.uf}`);
      if (cidade && !mapa.has(cidade)) mapa.set(cidade, item);
      if (cidadeUf && !mapa.has(cidadeUf)) mapa.set(cidadeUf, item);
    });
    return mapa;
  }, [municipiosDisponiveis]);

  const canaisLocal = useMemo(() => [...new Set(transportadoras.flatMap((item) => (item.origens || []).map((origem) => origem.canal)).filter(Boolean))], [transportadoras]);
  const origensLocal = useMemo(() => [...new Set(transportadoras.flatMap((item) => (item.origens || []).map((origem) => origem.cidade)).filter(Boolean))].sort(), [transportadoras]);
  const canais = useMemo(() => (opcoesOnline.canais?.length ? opcoesOnline.canais : canaisLocal.length ? canaisLocal : ['ATACADO']), [opcoesOnline.canais, canaisLocal]);
  const todasOrigens = useMemo(() => (opcoesOnline.origens?.length ? opcoesOnline.origens : origensLocal), [opcoesOnline.origens, origensLocal]);
  const todosDestinosComCidade = useMemo(() => {
    const porIbge = new Map();

    destinosDisponiveis.forEach((ibge) => {
      porIbge.set(String(ibge), {
        ibge: String(ibge),
        cidade: getCidadeByIbge(ibge, cidadePorIbgeCompleto),
        uf: getUfByIbge(ibge),
      });
    });

    municipiosDisponiveis.forEach((item) => {
      if (!porIbge.has(String(item.ibge))) porIbge.set(String(item.ibge), item);
    });

    return [...porIbge.values()].sort((a, b) => `${a.cidade}/${a.uf}`.localeCompare(`${b.cidade}/${b.uf}`, 'pt-BR'));
  }, [destinosDisponiveis, cidadePorIbgeCompleto, municipiosDisponiveis]);

  const [origemSimples, setOrigemSimples] = useState(todasOrigens[0] || '');
  const [destinoCodigo, setDestinoCodigo] = useState('');
  const [canalSimples, setCanalSimples] = useState(canais[0] || 'ATACADO');
  const [pesoSimples, setPesoSimples] = useState('');
  const [nfSimples, setNfSimples] = useState('');
  const [resultadoSimples, setResultadoSimples] = useState([]);

  const [transportadora, setTransportadora] = useState(transportadoras[0]?.nome || '');
  const [canalTransportadora, setCanalTransportadora] = useState(canais[0] || 'ATACADO');
  const [origemTransportadora, setOrigemTransportadora] = useState('');
  const [destinoTransportadora, setDestinoTransportadora] = useState('');
  const [pesoTransportadora, setPesoTransportadora] = useState('');
  const [nfTransportadora, setNfTransportadora] = useState('');
  const [modoLista, setModoLista] = useState(false);
  const [listaCodigos, setListaCodigos] = useState('');
  const [resultadoTransportadora, setResultadoTransportadora] = useState([]);

  const [transportadoraAnalise, setTransportadoraAnalise] = useState(transportadoras[0]?.nome || '');
  const [canalAnalise, setCanalAnalise] = useState(canais[0] || 'ATACADO');
  const [resultadoAnalise, setResultadoAnalise] = useState(null);

  const [canalCobertura, setCanalCobertura] = useState(canais[0] || 'ATACADO');
  const [origemCobertura, setOrigemCobertura] = useState('');
  const [transportadoraCobertura, setTransportadoraCobertura] = useState('');
  const [ufCobertura, setUfCobertura] = useState('');
  const [resultadoCobertura, setResultadoCobertura] = useState(null);

  const [carregandoSimulacao, setCarregandoSimulacao] = useState(false);
  const [erroSimulacao, setErroSimulacao] = useState('');
  const atualizarOpcoesSimulador = async () => {
    setCarregandoOpcoes(true);
    setErroOpcoes('');
    try {
      const opcoes = await carregarOpcoesSimuladorDb();
      setOpcoesOnline(opcoes || {});
      if (opcoes?.municipiosIbge?.length) {
        setMunicipiosIbge(opcoes.municipiosIbge);
      } else {
        const municipios = await carregarMunicipiosIbgeDb();
        setMunicipiosIbge(municipios || []);
      }
      return opcoes;
    } catch (error) {
      setErroOpcoes(error.message || 'Erro ao carregar opções do simulador no Supabase.');
      return null;
    } finally {
      setCarregandoOpcoes(false);
    }
  };

  useEffect(() => {
    atualizarOpcoesSimulador();
  }, []);


  const carregarBaseOnline = async (filtros) => {
    setCarregandoSimulacao(true);
    setErroSimulacao('');
    try {
      const base = await buscarBaseSimulacaoDb(filtros);
      return Array.isArray(base) ? base : [];
    } catch (error) {
      setErroSimulacao(error.message || 'Erro ao buscar base online do Supabase.');
      return [];
    } finally {
      setCarregandoSimulacao(false);
    }
  };

  useEffect(() => {
    if (!origemSimples && todasOrigens[0]) setOrigemSimples(todasOrigens[0]);
  }, [origemSimples, todasOrigens]);

  useEffect(() => {
    const primeiraTransportadora = (opcoesOnline.transportadoras || [])[0] || transportadoras[0]?.nome || '';
    if (!transportadora && primeiraTransportadora) setTransportadora(primeiraTransportadora);
    if (!transportadoraAnalise && primeiraTransportadora) setTransportadoraAnalise(primeiraTransportadora);
  }, [transportadora, transportadoraAnalise, transportadoras, opcoesOnline.transportadoras]);

  useEffect(() => {
    if (!canalSimples && canais[0]) setCanalSimples(canais[0]);
    if (!canalTransportadora && canais[0]) setCanalTransportadora(canais[0]);
    if (!canalAnalise && canais[0]) setCanalAnalise(canais[0]);
    if (!canalCobertura && canais[0]) setCanalCobertura(canais[0]);
  }, [canalSimples, canalTransportadora, canalAnalise, canalCobertura, canais]);

  const todasTransportadorasDisponiveis = useMemo(() => (
    opcoesOnline.transportadoras?.length ? opcoesOnline.transportadoras : transportadoras.map((item) => item.nome).sort()
  ), [opcoesOnline.transportadoras, transportadoras]);

  const transportadorasDisponiveis = todasTransportadorasDisponiveis;

  const transportadorasPorCanalTransportadora = useMemo(
    () => filtrarTransportadorasPorCanal(todasTransportadorasDisponiveis, canalTransportadora, opcoesOnline, transportadoras),
    [todasTransportadorasDisponiveis, canalTransportadora, opcoesOnline, transportadoras]
  );

  const transportadorasPorCanalAnalise = useMemo(
    () => filtrarTransportadorasPorCanal(todasTransportadorasDisponiveis, canalAnalise, opcoesOnline, transportadoras),
    [todasTransportadorasDisponiveis, canalAnalise, opcoesOnline, transportadoras]
  );

  const transportadorasPorCanalCobertura = useMemo(
    () => filtrarTransportadorasPorCanal(todasTransportadorasDisponiveis, canalCobertura, opcoesOnline, transportadoras),
    [todasTransportadorasDisponiveis, canalCobertura, opcoesOnline, transportadoras]
  );

  useEffect(() => {
    if (transportadorasPorCanalTransportadora.length && !transportadorasPorCanalTransportadora.includes(transportadora)) {
      setTransportadora(transportadorasPorCanalTransportadora[0]);
      setOrigemTransportadora('');
    }
  }, [transportadorasPorCanalTransportadora, transportadora]);

  useEffect(() => {
    if (transportadorasPorCanalAnalise.length && !transportadorasPorCanalAnalise.includes(transportadoraAnalise)) {
      setTransportadoraAnalise(transportadorasPorCanalAnalise[0]);
    }
  }, [transportadorasPorCanalAnalise, transportadoraAnalise]);

  useEffect(() => {
    if (transportadoraCobertura && !transportadorasPorCanalCobertura.includes(transportadoraCobertura)) {
      setTransportadoraCobertura('');
    }
  }, [transportadorasPorCanalCobertura, transportadoraCobertura]);


  const origensTransportadora = useMemo(() => {
    const online = opcoesOnline.origensPorTransportadora?.[transportadora];
    if (online?.length) return online;
    const selecionada = transportadoras.find((item) => item.nome === transportadora);
    if (!selecionada) return [];
    return [...new Set((selecionada.origens || []).filter((item) => !canalTransportadora || item.canal === canalTransportadora).map((item) => item.cidade))].sort();
  }, [transportadoras, transportadora, canalTransportadora, opcoesOnline.origensPorTransportadora]);

  const canaisTransportadora = useMemo(() => {
    const online = opcoesOnline.canaisPorTransportadora?.[transportadora];
    if (online?.length) return online;
    const selecionada = transportadoras.find((item) => item.nome === transportadora);
    if (!selecionada) return canais;
    return [...new Set((selecionada.origens || []).map((item) => item.canal).filter(Boolean))];
  }, [transportadoras, transportadora, canais, opcoesOnline.canaisPorTransportadora]);

  const identificarDestinoLocal = (valor) => {
    const raw = String(valor || '').trim();
    if (!raw) return null;

    const digitos = raw.replace(/\D/g, '');
    if (digitos.length === 7 && municipioPorIbge.has(digitos)) return municipioPorIbge.get(digitos);

    const cidadeLimpa = limparCidadeDigitada(raw);
    const chaveCidade = normalizeBuscaIbge(cidadeLimpa);
    if (municipioPorCidade.has(chaveCidade)) return municipioPorCidade.get(chaveCidade);

    if (digitos.length === 7) {
      const cidade = getCidadeByIbge(digitos, cidadePorIbgeCompleto);
      return cidade ? { ibge: digitos, cidade, uf: getUfByIbge(digitos) } : { ibge: digitos, cidade: '', uf: getUfByIbge(digitos) };
    }

    return null;
  };

  const resolverDestinoInput = async (valor) => {
    const local = identificarDestinoLocal(valor);
    if (local?.ibge) return local;

    const remoto = await resolverDestinoIbgeDb(valor);
    if (remoto?.ibge) return remoto;

    return null;
  };

  const destinoIdentificado = useMemo(() => {
    const destino = identificarDestinoLocal(destinoCodigo);
    return destino ? montarLabelMunicipio(destino) : '';
  }, [destinoCodigo, municipioPorIbge, municipioPorCidade, cidadePorIbgeCompleto]);

  const destinoTransportadoraIdentificado = useMemo(() => {
    const destino = identificarDestinoLocal(destinoTransportadora);
    return destino ? montarLabelMunicipio(destino) : '';
  }, [destinoTransportadora, municipioPorIbge, municipioPorCidade, cidadePorIbgeCompleto]);

  const onSimularSimples = async () => {
    const destinoResolvido = await resolverDestinoInput(destinoCodigo);
    const destinoFinal = destinoResolvido?.ibge || destinoCodigo;

    if (destinoCodigo && !destinoResolvido?.ibge) {
      setErroSimulacao('Não foi possível identificar o destino informado na base IBGE/CEP. Use cidade, IBGE ou CEP válido.');
      return;
    }

    const baseOnline = await carregarBaseOnline({
      origem: origemSimples,
      canal: canalSimples,
      destinoCodigo: destinoFinal,
    });

    const lookupOnline = buildLookupTables(baseOnline);
    const mapaCidades = new Map(cidadePorIbgeCompleto);
    (lookupOnline.cidadePorIbge || new Map()).forEach((cidade, ibge) => mapaCidades.set(ibge, cidade));
    if (destinoResolvido?.ibge && destinoResolvido?.cidade) {
      mapaCidades.set(destinoResolvido.ibge, destinoResolvido.uf ? `${destinoResolvido.cidade}/${destinoResolvido.uf}` : destinoResolvido.cidade);
    }

    setResultadoSimples(simularSimples({
      transportadoras: baseOnline,
      origem: origemSimples,
      canal: canalSimples,
      peso: Number(pesoSimples || 0),
      valorNF: Number(nfSimples || 0),
      destinoCodigo: destinoFinal,
      cidadePorIbge: mapaCidades,
      gradeCanal: grade[canalSimples] || grade.ATACADO || [],
    }));
  };
  const onSimularTransportadora = async () => {
    const entradas = modoLista
      ? listaCodigos.split(/\n|,|;/).map((item) => item.trim()).filter(Boolean)
      : destinoTransportadora ? [destinoTransportadora.trim()] : [];

    const resolvidos = await Promise.all(entradas.map(async (entrada) => {
      const destino = await resolverDestinoInput(entrada);
      return destino?.ibge ? destino : { ibge: entrada, cidade: '', uf: '' };
    }));

    const codigos = resolvidos.map((item) => item.ibge).filter(Boolean);

    if (entradas.length && !codigos.length) {
      setErroSimulacao('Não foi possível identificar os destinos informados na base IBGE/CEP.');
      return;
    }

    const baseOnline = await carregarBaseOnline({
      origem: origemTransportadora,
      canal: canalTransportadora,
      destinoCodigos: codigos,
      nomeTransportadora: transportadora,
    });

    const lookupOnline = buildLookupTables(baseOnline);
    const mapaCidades = new Map(cidadePorIbgeCompleto);
    (lookupOnline.cidadePorIbge || new Map()).forEach((cidade, ibge) => mapaCidades.set(ibge, cidade));
    resolvidos.forEach((destino) => {
      if (destino?.ibge && destino?.cidade) {
        mapaCidades.set(destino.ibge, destino.uf ? `${destino.cidade}/${destino.uf}` : destino.cidade);
      }
    });

    setResultadoTransportadora(simularPorTransportadora({
      transportadoras: baseOnline,
      nomeTransportadora: transportadora,
      canal: canalTransportadora,
      origem: origemTransportadora,
      destinoCodigos: codigos,
      peso: Number(pesoTransportadora || 0),
      valorNF: Number(nfTransportadora || 0),
      cidadePorIbge: mapaCidades,
      gradeCanal: grade[canalTransportadora] || grade.ATACADO || [],
    }));
  };
  const exportarSimulacaoTransportadora = () => {
    if (!resultadoTransportadora.length) return;
    const { nomeArquivo, csv } = exportarLinhasCsv(`simulacao-${transportadora.toLowerCase().replace(/\s+/g, '-')}.csv`, [
      ['Transportadora', 'Origem', 'Destino', 'UF', 'IBGE', 'Prazo', 'Frete Final', '% sobre NF', 'Perdeu para', 'Substituta se bloquear', 'Frete substituta', 'Saving vs 2º', 'Diferença Líder', 'Redução % Líder'],
      ...resultadoTransportadora.map((item) => [
        item.transportadora,
        item.origem,
        item.cidadeDestino || `IBGE ${item.ibgeDestino}`,
        item.ufDestino,
        item.ibgeDestino,
        item.prazo,
        item.total.toFixed(2),
        item.percentualSobreNF.toFixed(2),
        item.perdeuPara || '',
        item.proximaSeBloquear || '',
        item.freteSubstituta?.toFixed?.(2) || '0.00',
        item.savingSegundo.toFixed(2),
        item.diferencaLider.toFixed(2),
        item.reducaoNecessariaPct.toFixed(2),
      ]),
    ]);
    downloadCsv(nomeArquivo, csv);
  };
  const onSimularGrade = async () => {
    const baseOnline = await carregarBaseOnline({
      canal: canalAnalise,
      nomeTransportadora: transportadoraAnalise,
    });

    const lookupOnline = buildLookupTables(baseOnline);
    setResultadoAnalise(analisarTransportadoraPorGrade({
      transportadoras: baseOnline,
      nomeTransportadora: transportadoraAnalise,
      canal: canalAnalise,
      grade: grade[canalAnalise] || grade.ATACADO || [],
      cidadePorIbge: (() => { const mapa = new Map(cidadePorIbgeCompleto); (lookupOnline.cidadePorIbge || new Map()).forEach((cidade, ibge) => mapa.set(ibge, cidade)); return mapa; })(),
    }));
  };
  const exportarAnalise = () => {
    if (!resultadoAnalise?.detalhes?.length) return;
    const { nomeArquivo, csv } = exportarLinhasCsv(`analise-${transportadoraAnalise.toLowerCase().replace(/\s+/g, '-')}.csv`, [
      ['Transportadora', 'Origem', 'Destino', 'UF', 'IBGE', 'Peso', 'Valor NF', 'Prazo', 'Ranking', 'Frete Final', '% sobre NF', 'Perdeu para', 'Substituta', 'Saving 2º'],
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
        item.percentualSobreNF.toFixed(2),
        item.perdeuPara || '',
        item.proximaSeBloquear || '',
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
      cidadePorIbge: cidadePorIbgeCompleto,
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

      <div className="sim-alert info" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span>
          Base do simulador: <strong>{opcoesOnline.fonte === 'supabase' ? 'Supabase online' : 'carregando opções'}</strong>
          {opcoesOnline.transportadoras?.length ? ` · ${opcoesOnline.transportadoras.length} transportadoras` : ''}
          {opcoesOnline.origens?.length ? ` · ${opcoesOnline.origens.length} origens` : ''}{municipiosDisponiveis.length ? ` · ${municipiosDisponiveis.length} municípios IBGE` : ''}
        </span>
        <button className="sim-tab" type="button" onClick={atualizarOpcoesSimulador} disabled={carregandoOpcoes}>
          {carregandoOpcoes ? 'Atualizando opções...' : 'Atualizar opções'}
        </button>
      </div>
      {erroOpcoes ? <div className="sim-alert error">{erroOpcoes}</div> : null}

      {carregandoSimulacao ? (
        <div className="sim-alert info">Buscando concorrentes no Supabase para esta simulação...</div>
      ) : null}
      {erroSimulacao ? (
        <div className="sim-alert error">{erroSimulacao}</div>
      ) : null}

      {aba === 'simples' && (
        <section className="sim-card">
          <h2>Simulação simples</h2>
          <div className="sim-form-grid sim-grid-5">
            <label>Origem
              <select value={origemSimples} onChange={(e) => setOrigemSimples(e.target.value)}>{todasOrigens.map((item) => <option key={item}>{item}</option>)}</select>
            </label>
            <label>Destino (CEP ou IBGE)
              <input list="destinos-lista" value={destinoCodigo} onChange={(e) => setDestinoCodigo(e.target.value)} placeholder="Digite cidade, IBGE ou CEP" />
              <datalist id="destinos-lista">
                {todosDestinosComCidade.map((item) => (
                  <option key={item.ibge} value={item.cidade && item.uf ? `${item.cidade}/${item.uf}` : item.ibge}>
                    {item.ibge}
                  </option>
                ))}
              </datalist>
              {destinoIdentificado && <small style={{ color: '#64748b' }}>Destino identificado: {destinoIdentificado}</small>}
            </label>
            <label>Canal
              <select value={canalSimples} onChange={(e) => setCanalSimples(e.target.value)}>{canais.map((item) => <option key={item}>{item}</option>)}</select>
            </label>
            <label>Peso
              <input value={pesoSimples} onChange={(e) => setPesoSimples(e.target.value)} placeholder="Ex: 150" />
            </label>
            <label>Valor NF (opcional)
              <input value={nfSimples} onChange={(e) => setNfSimples(e.target.value)} placeholder="Se vazio, usa a grade" />
              <small style={{ color: '#64748b' }}>Se não informar, o simulador usa o Valor NF da grade.</small>
            </label>
          </div>
          <div className="sim-actions"><button className="primary" onClick={onSimularSimples} disabled={carregandoSimulacao}>{carregandoSimulacao ? "Simulando..." : "Simular"}</button></div>
          <div className="sim-resultados">{resultadoSimples.map((item, idx) => <ResultadoCard key={`${item.transportadora}-${idx}`} item={item} />)}</div>
        </section>
      )}

      {aba === 'transportadora' && (
        <section className="sim-card">
          <div className="sim-resultado-topo compact-top">
            <h2 style={{ margin: 0 }}>Simulação por transportadora</h2>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><button className="sim-tab" type="button" onClick={exportarSimulacaoTransportadora}>Exportar relatório</button></div>
          </div>
          <div className="sim-form-grid sim-grid-6">
            <label>Transportadora
              <select value={transportadora} onChange={(e) => {
                const nome = e.target.value;
                setTransportadora(nome);
                setOrigemTransportadora('');
                const primeiroCanal = opcoesOnline.canaisPorTransportadora?.[nome]?.[0] || canais[0] || 'ATACADO';
                setCanalTransportadora(primeiroCanal);
              }}>{transportadorasPorCanalTransportadora.map((item) => <option key={item}>{item}</option>)}</select>
            </label>
            <label>Canal
              <select value={canalTransportadora} onChange={(e) => { setCanalTransportadora(e.target.value); setOrigemTransportadora(''); }}>{canais.map((item) => <option key={item}>{item}</option>)}</select>
            </label>
            <label>Origem (opcional)
              <select value={origemTransportadora} onChange={(e) => setOrigemTransportadora(e.target.value)}><option value="">Todas</option>{origensTransportadora.map((item) => <option key={item}>{item}</option>)}</select>
            </label>
            <label>Destino opcional (cidade, CEP ou IBGE)
              <input disabled={modoLista} list="destinos-lista-transportadora" value={destinoTransportadora} onChange={(e) => setDestinoTransportadora(e.target.value)} placeholder="Digite cidade, IBGE ou CEP" />
              <datalist id="destinos-lista-transportadora">
                {todosDestinosComCidade.map((item) => (
                  <option key={item.ibge} value={item.cidade && item.uf ? `${item.cidade}/${item.uf}` : item.ibge}>
                    {item.ibge}
                  </option>
                ))}
              </datalist>
              {destinoTransportadoraIdentificado && <small style={{ color: '#64748b' }}>Destino identificado: {destinoTransportadoraIdentificado}</small>}
            </label>
            <label>Peso
              <input value={pesoTransportadora} onChange={(e) => setPesoTransportadora(e.target.value)} placeholder="Ex: 150" />
            </label>
            <label>Valor NF (opcional)
              <input value={nfTransportadora} onChange={(e) => setNfTransportadora(e.target.value)} placeholder="Se vazio, usa a grade" />
            </label>
          </div>
          <div className="sim-inline-tools">
            <label className="sim-flag">
              <input type="checkbox" checked={modoLista} onChange={(e) => setModoLista(e.target.checked)} />
              Simulação em massa por lista de CEP/IBGE
            </label>
            {modoLista && (
              <div className="sim-lista-box" style={{ marginTop: 12 }}>
                <label>Lista de cidades, CEPs ou IBGEs
                  <textarea value={listaCodigos} onChange={(e) => setListaCodigos(e.target.value)} placeholder={"São Paulo/SP\n3506003\n88300000"} />
                </label>
              </div>
            )}
          </div>
          <div className="sim-actions"><button className="primary" onClick={onSimularTransportadora} disabled={carregandoSimulacao}>{carregandoSimulacao ? "Simulando..." : "Simular transportadora"}</button></div>
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
                {transportadorasPorCanalAnalise.map((item) => <option key={item}>{item}</option>)}
              </select>
              {!transportadorasPorCanalAnalise.length ? <small>Nenhuma transportadora cadastrada neste canal.</small> : null}
            </label>
            <label>Canal
              <select value={canalAnalise} onChange={(e) => setCanalAnalise(e.target.value)}>{canais.map((item) => <option key={item}>{item}</option>)}</select>
            </label>
            <div className="sim-actions" style={{ alignItems: 'flex-end' }}><button className="primary" onClick={onSimularGrade}>Gerar relatório</button></div>
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
                <div className="sim-parametros-box"><div className="sim-parametros-header"><div><strong>Desempenho por UF</strong><p>Onde a transportadora fica mais competitiva.</p></div></div><div style={{ marginTop: 12 }}><GraficoUf itens={resultadoAnalise.porUf} /></div></div>
                <div className="sim-parametros-box"><div className="sim-parametros-header"><div><strong>Leitura do relatório</strong><p>Base para devolutiva, reunião ou negociação.</p></div></div><div style={{ display: 'grid', gap: 8, marginTop: 12 }}><div>Total de linhas geradas: <strong>{resultadoAnalise.detalhes.length}</strong></div><div>Vitórias na grade: <strong>{resultadoAnalise.vitorias}</strong></div><div>Rotas fora do 1º lugar: <strong>{resultadoAnalise.rotasAvaliadas - resultadoAnalise.vitorias}</strong></div><div>Melhor uso: <strong>comparar aderência, prazo e necessidade de redução.</strong></div></div></div>
              </div>
              <div className="sim-resultados">{resultadoAnalise.detalhes.slice(0, 30).map((item, idx) => <ResultadoCard key={`${item.transportadora}-${idx}`} item={item} />)}</div>
            </div>
          )}
        </section>
      )}

      {aba === 'cobertura' && (
        <section className="sim-card">
          <div className="sim-resultado-topo compact-top"><h2 style={{ margin: 0 }}>Cobertura de tabela</h2><button className="sim-tab" type="button" onClick={exportarCobertura}>Exportar faltantes</button></div>
          <div className="sim-form-grid sim-grid-4" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
            <label>Canal<select value={canalCobertura} onChange={(e) => setCanalCobertura(e.target.value)}>{canais.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Origem<select value={origemCobertura} onChange={(e) => setOrigemCobertura(e.target.value)}><option value="">Todas</option>{todasOrigens.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Transportadora<select value={transportadoraCobertura} onChange={(e) => setTransportadoraCobertura(e.target.value)}><option value="">Todas</option>{transportadorasPorCanalCobertura.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>UF destino<select value={ufCobertura} onChange={(e) => setUfCobertura(e.target.value)}>{UF_OPTIONS.map((item) => <option key={item} value={item}>{item || 'Todas'}</option>)}</select></label>
          </div>
          <div className="sim-actions"><button className="primary" onClick={onAnalisarCobertura}>Analisar cobertura</button></div>
          {resultadoCobertura && (
            <div className="sim-cobertura-box">
              <p>{resultadoCobertura.explicacao}</p>
              <div className="sim-resultado-grade" style={{ marginTop: 12 }}>
                <div><span>Combinações possíveis</span><strong>{resultadoCobertura.totalCombinacoes}</strong></div>
                <div><span>Cobertas</span><strong>{resultadoCobertura.totalCobertas}</strong></div>
                <div><span>Sem tabela</span><strong>{resultadoCobertura.totalFaltantes}</strong></div>
                <div><span>Cobertura</span><strong>{formatPercent(resultadoCobertura.percentualCobertura)}</strong></div>
              </div>
              <div className="sim-grid-2" style={{ display: 'grid', gap: 16, marginTop: 12 }}>
                <div><strong>Faltantes</strong><div className="sim-cobertura-lista">{resultadoCobertura.faltantes.slice(0, 40).map((item, idx) => <div key={`${item.ibge}-${idx}`}>{item.origem} • {item.cidade || `IBGE ${item.ibge}`} • {item.uf}</div>)}</div></div>
                <div><strong>Exemplos com tabela</strong><div className="sim-cobertura-lista">{resultadoCobertura.cobertas.slice(0, 40).map((item, idx) => <div key={`${item.ibge}-${idx}`}>{item.origem} • {item.cidade || `IBGE ${item.ibge}`} • {item.uf} • {item.transportadora}</div>)}</div></div>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
