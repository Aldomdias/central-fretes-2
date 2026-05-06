
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  analisarCoberturaTabela,
  analisarOrigemPorGrade,
  analisarTransportadoraPorGrade,
  buildLookupTables,
  exportarLinhasCsv,
  getCidadeByIbge,
  getUfByIbge,
  simularPorTransportadora,
  simularSimples,
} from '../utils/calculoFrete';
import { carregarGradeFrete, salvarGradeFrete, restaurarGradeFretePadrao } from '../utils/gradeFreteConfig';
import { buscarBaseSimulacaoDb, carregarMunicipiosIbgeDb, carregarOpcoesSimuladorDb, resolverDestinoIbgeDb } from '../services/freteDatabaseService';
import { exportarRealizadoLocal } from '../services/realizadoLocalDb';

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
  return String(texto || '').replace(/\s*·\s*\d+$/i, '').replace(/\s*\/\s*[A-Z]{2}$/i, '').trim();
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
  return carregarGradeFrete();
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
              <div>Cubagem usada: <strong>{Number(item.detalhes?.frete?.cubagemAplicada || 0).toFixed(6)} m³</strong></div>
              <div>Origem da cubagem: <strong>{item.detalhes?.frete?.origemCubagem || 'sem cubagem'}</strong></div>
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


function numeroRealizado(value) {
  const numero = Number(value || 0);
  return Number.isFinite(numero) ? numero : 0;
}

function pesoRealizado(row = {}) {
  return Math.max(numeroRealizado(row.peso), numeroRealizado(row.pesoDeclarado), numeroRealizado(row.pesoCubado));
}

function cubagemRealizado(row = {}) {
  return Math.max(
    numeroRealizado(row.cubagem),
    numeroRealizado(row.metrosCubicos),
    numeroRealizado(row.m3),
    numeroRealizado(row.volumeCubico)
  );
}

function normalizarTransportadoraSimulador(nome = '') {
  return String(nome || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function criarMetricaRealizadoTransportadora(nome) {
  return {
    transportadora: nome || 'Sem transportadora',
    ctesConcorreu: 0,
    ctesGanharia: 0,
    ctesCarregou: 0,
    ctesCarregadosComTabela: 0,
    ctesCarregouGanhando: 0,
    ctesCarregouPerdendo: 0,
    freteRealizado: 0,
    freteTabelaPropria: 0,
    freteMelhorParaCargasCarregadas: 0,
    valorNF: 0,
    peso: 0,
    volumes: 0,
  };
}

function obterMetricaRealizado(mapa, nome) {
  const nomeLimpo = String(nome || 'Sem transportadora').trim() || 'Sem transportadora';
  const chave = normalizarTransportadoraSimulador(nomeLimpo);
  if (!mapa.has(chave)) mapa.set(chave, criarMetricaRealizadoTransportadora(nomeLimpo));
  return mapa.get(chave);
}

function resumirRealizadoPorOrigem(rows = [], baseOnline = [], filtros = {}, cidadePorIbge, gradeCanal = []) {
  const porTransportadoraMap = new Map();
  const simulacaoTransportadoraMap = new Map();
  const porDestinoMap = new Map();
  const simulacoes = [];
  let freteRealizado = 0;
  let freteRealizadoComTabela = 0;
  let freteGanhadorTotal = 0;
  let valorNF = 0;
  let peso = 0;
  let volumes = 0;
  let semTabela = 0;
  let savingPotencial = 0;
  let diferencaPotencialTotal = 0;
  let ganhoRealizado = 0;
  let ctesSimulados = 0;

  (rows || []).slice(0, 5000).forEach((row) => {
    const transportadora = String(row.transportadora || 'Sem transportadora').trim() || 'Sem transportadora';
    const transportadoraKey = normalizarTransportadoraSimulador(transportadora);
    const valorCte = numeroRealizado(row.valorCte);
    const nf = numeroRealizado(row.valorNF);
    const pesoLinha = pesoRealizado(row);
    const cubagemLinha = cubagemRealizado(row);
    const vol = numeroRealizado(row.qtdVolumes);
    const destino = String(row.ibgeDestino || '').trim();
    freteRealizado += valorCte;
    valorNF += nf;
    peso += pesoLinha;
    volumes += vol;

    const t = porTransportadoraMap.get(transportadora) || { transportadora, ctes: 0, frete: 0, valorNF: 0, peso: 0, volumes: 0 };
    t.ctes += 1;
    t.frete += valorCte;
    t.valorNF += nf;
    t.peso += pesoLinha;
    t.volumes += vol;
    porTransportadoraMap.set(transportadora, t);

    const metricaReal = obterMetricaRealizado(simulacaoTransportadoraMap, transportadora);
    metricaReal.ctesCarregou += 1;
    metricaReal.freteRealizado += valorCte;
    metricaReal.valorNF += nf;
    metricaReal.peso += pesoLinha;
    metricaReal.volumes += vol;

    const chaveDestino = `${row.cidadeDestino || ''}/${row.ufDestino || ''}|${destino}`;
    const d = porDestinoMap.get(chaveDestino) || {
      destino: row.cidadeDestino || '',
      uf: row.ufDestino || '',
      ibge: destino,
      ctes: 0,
      transportadoras: new Set(),
      concorrentesTabela: new Set(),
      frete: 0,
    };
    d.ctes += 1;
    d.frete += valorCte;
    d.transportadoras.add(transportadora);
    porDestinoMap.set(chaveDestino, d);

    if (!destino) {
      semTabela += 1;
      return;
    }

    const resultado = simularSimples({
      transportadoras: baseOnline,
      origem: filtros.origem,
      canal: filtros.canal,
      peso: pesoLinha,
      valorNF: nf,
      cubagem: cubagemLinha,
      destinoCodigo: destino,
      cidadePorIbge,
      gradeCanal,
    }) || [];

    resultado.forEach((item) => {
      const nomeTabela = item.transportadora || 'Sem transportadora';
      const metrica = obterMetricaRealizado(simulacaoTransportadoraMap, nomeTabela);
      metrica.ctesConcorreu += 1;
      d.concorrentesTabela.add(nomeTabela);
      if (Number(item.ranking) === 1) metrica.ctesGanharia += 1;
    });

    const vencedor = resultado[0];
    if (!vencedor) {
      semTabela += 1;
      return;
    }

    ctesSimulados += 1;
    freteRealizadoComTabela += valorCte;
    freteGanhadorTotal += numeroRealizado(vencedor.total);

    const resultadoReal = resultado.find((item) => normalizarTransportadoraSimulador(item.transportadora) === transportadoraKey);
    if (resultadoReal) {
      metricaReal.ctesCarregadosComTabela += 1;
      metricaReal.freteTabelaPropria += numeroRealizado(resultadoReal.total);
    }

    metricaReal.freteMelhorParaCargasCarregadas += numeroRealizado(vencedor.total);

    const economia = valorCte - numeroRealizado(vencedor.total);
    diferencaPotencialTotal += economia;
    savingPotencial += Math.max(economia, 0);

    const realFoiGanhador = normalizarTransportadoraSimulador(vencedor.transportadora) === transportadoraKey;
    if (realFoiGanhador) {
      ganhoRealizado += 1;
      metricaReal.ctesCarregouGanhando += 1;
    } else {
      metricaReal.ctesCarregouPerdendo += 1;
    }

    simulacoes.push({
      cte: row.numeroCte || row.chaveCte || '',
      destino: row.cidadeDestino || vencedor.cidadeDestino || '',
      uf: row.ufDestino || vencedor.ufDestino || '',
      ibge: destino,
      transportadoraReal: transportadora,
      freteRealizado: valorCte,
      vencedor: vencedor.transportadora,
      freteVencedor: vencedor.total,
      saving: Math.max(economia, 0),
      diferenca: economia,
      realEraGanhador: realFoiGanhador,
      concorrentes: resultado.length,
      cubagemAplicada: numeroRealizado(vencedor?.detalhes?.frete?.cubagemAplicada),
      origemCubagem: vencedor?.detalhes?.frete?.origemCubagem || '',
      pesoCubado: numeroRealizado(vencedor?.detalhes?.frete?.pesoCubado),
      pesoConsiderado: numeroRealizado(vencedor?.detalhes?.frete?.pesoConsiderado),
    });
  });

  const porTransportadora = [...porTransportadoraMap.values()].map((item) => ({
    ...item,
    pctCtes: rows.length ? (item.ctes / rows.length) * 100 : 0,
    pctFrete: freteRealizado ? (item.frete / freteRealizado) * 100 : 0,
    percentualFrete: item.valorNF ? (item.frete / item.valorNF) * 100 : 0,
  })).sort((a, b) => b.ctes - a.ctes || b.frete - a.frete);

  const simulacaoPorTransportadora = [...simulacaoTransportadoraMap.values()].map((item) => {
    const diferencaPotencial = item.freteRealizado - item.freteMelhorParaCargasCarregadas;
    return {
      ...item,
      pctGanharia: item.ctesConcorreu ? (item.ctesGanharia / item.ctesConcorreu) * 100 : 0,
      pctCarregou: rows.length ? (item.ctesCarregou / rows.length) * 100 : 0,
      acertoOperacional: item.ctesCarregadosComTabela ? (item.ctesCarregouGanhando / item.ctesCarregadosComTabela) * 100 : 0,
      diferencaPotencial,
      economiaPotencial: Math.max(diferencaPotencial, 0),
      percentualEconomiaPotencial: item.freteRealizado ? (Math.max(diferencaPotencial, 0) / item.freteRealizado) * 100 : 0,
    };
  }).sort((a, b) => b.economiaPotencial - a.economiaPotencial || b.ctesCarregou - a.ctesCarregou || b.ctesGanharia - a.ctesGanharia);

  const porDestino = [...porDestinoMap.values()].map((item) => ({
    ...item,
    qtdTransportadoras: item.transportadoras.size,
    qtdConcorrentesTabela: item.concorrentesTabela.size,
    transportadoras: [...item.transportadoras].sort(),
    concorrentesTabela: [...item.concorrentesTabela].sort(),
    statusCobertura: item.concorrentesTabela.size === 0
      ? 'Sem cobertura'
      : item.concorrentesTabela.size === 1
        ? 'Baixa concorrência'
        : item.concorrentesTabela.size === 2
          ? 'Concorrência limitada'
          : 'Concorrência saudável',
  })).sort((a, b) => a.qtdConcorrentesTabela - b.qtdConcorrentesTabela || b.ctes - a.ctes || a.uf.localeCompare(b.uf));

  const destinosSemTabela = porDestino.filter((item) => item.qtdConcorrentesTabela === 0);
  const destinosUmaOpcao = porDestino.filter((item) => item.qtdConcorrentesTabela === 1);
  const destinosDuasOpcoes = porDestino.filter((item) => item.qtdConcorrentesTabela === 2);

  return {
    ctes: rows.length,
    ctesSimulados,
    freteRealizado,
    freteRealizadoComTabela,
    freteGanhadorTotal,
    diferencaPotencialTotal,
    valorNF,
    peso,
    volumes,
    percentualFreteRealizado: valorNF ? (freteRealizado / valorNF) * 100 : 0,
    savingPotencial,
    percentualSavingPotencial: freteRealizadoComTabela ? (savingPotencial / freteRealizadoComTabela) * 100 : 0,
    semTabela,
    ganhoRealizado,
    aderenciaRealizada: ctesSimulados ? (ganhoRealizado / ctesSimulados) * 100 : 0,
    destinosSemTabela: destinosSemTabela.length,
    destinosUmaOpcao: destinosUmaOpcao.length,
    destinosDuasOpcoes: destinosDuasOpcoes.length,
    porTransportadora,
    simulacaoPorTransportadora,
    porDestino,
    destinosCriticos: porDestino.filter((item) => item.qtdConcorrentesTabela <= 2).slice(0, 150),
    simulacoes: simulacoes.sort((a, b) => b.saving - a.saving).slice(0, 150),
  };
}

export default function SimuladorPage({ transportadoras = [] }) {
  const [aba, setAba] = useState('simples');
  const [grade, setGrade] = useState(getGradeInicial());
  const [opcoesOnline, setOpcoesOnline] = useState({
    transportadoras: [],
    origens: [],
    canais: [],
    origensPorTransportadora: {},
    canaisPorTransportadora: {},
    origensPorCanal: {},
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

  const [origemSimples, setOrigemSimples] = useState('');
  const [destinoCodigo, setDestinoCodigo] = useState('');
  const [canalSimples, setCanalSimples] = useState(canais[0] || 'ATACADO');
  const [pesoSimples, setPesoSimples] = useState('');
  const [nfSimples, setNfSimples] = useState('');
  const [resultadoSimples, setResultadoSimples] = useState([]);

  const [transportadora, setTransportadora] = useState('');
  const [canalTransportadora, setCanalTransportadora] = useState(canais[0] || 'ATACADO');
  const [origemTransportadora, setOrigemTransportadora] = useState('');
  const [destinoTransportadora, setDestinoTransportadora] = useState('');
  const [pesoTransportadora, setPesoTransportadora] = useState('');
  const [nfTransportadora, setNfTransportadora] = useState('');
  const [modoLista, setModoLista] = useState(false);
  const [listaCodigos, setListaCodigos] = useState('');
  const [resultadoTransportadora, setResultadoTransportadora] = useState([]);

  const [transportadoraAnalise, setTransportadoraAnalise] = useState('');
  const [canalAnalise, setCanalAnalise] = useState(canais[0] || 'ATACADO');
  const [origemAnalise, setOrigemAnalise] = useState('');
  const [ufAnalise, setUfAnalise] = useState('');
  const [resultadoAnalise, setResultadoAnalise] = useState(null);

  const [canalCobertura, setCanalCobertura] = useState(canais[0] || 'ATACADO');
  const [origemCobertura, setOrigemCobertura] = useState('');
  const [transportadoraCobertura, setTransportadoraCobertura] = useState('');
  const [ufCobertura, setUfCobertura] = useState('');
  const [resultadoCobertura, setResultadoCobertura] = useState(null);

  const [canalOrigem, setCanalOrigem] = useState(canais[0] || 'ATACADO');
  const [origemOrigem, setOrigemOrigem] = useState('');
  const [ufDestinoOrigem, setUfDestinoOrigem] = useState('');
  const [inicioOrigem, setInicioOrigem] = useState('');
  const [fimOrigem, setFimOrigem] = useState('');
  const [usarRealizadoOrigem, setUsarRealizadoOrigem] = useState(true);
  const [resultadoOrigem, setResultadoOrigem] = useState(null);

  const [carregandoSimulacao, setCarregandoSimulacao] = useState(false);
  const [erroSimulacao, setErroSimulacao] = useState('');
  const timerProcessamentoRef = useRef(null);
  const hideProcessamentoRef = useRef(null);
  const [processamentoUi, setProcessamentoUi] = useState({
    ativo: false,
    titulo: '',
    mensagem: '',
    percentual: 0,
  });

  const limparTimersProcessamento = () => {
    if (timerProcessamentoRef.current) {
      clearInterval(timerProcessamentoRef.current);
      timerProcessamentoRef.current = null;
    }
    if (hideProcessamentoRef.current) {
      clearTimeout(hideProcessamentoRef.current);
      hideProcessamentoRef.current = null;
    }
  };

  const iniciarProcessamentoUi = (titulo, mensagem, percentualInicial = 8) => {
    limparTimersProcessamento();
    setProcessamentoUi({
      ativo: true,
      titulo,
      mensagem,
      percentual: percentualInicial,
    });

    timerProcessamentoRef.current = setInterval(() => {
      setProcessamentoUi((prev) => {
        if (!prev.ativo) return prev;
        const incremento = prev.percentual < 45 ? 6 : prev.percentual < 75 ? 3 : 1;
        return {
          ...prev,
          percentual: Math.min(prev.percentual + incremento, 92),
        };
      });
    }, 400);
  };

  const atualizarProcessamentoUi = (mensagem, percentual = null) => {
    setProcessamentoUi((prev) => ({
      ...prev,
      ativo: true,
      mensagem: mensagem || prev.mensagem,
      percentual: percentual === null ? prev.percentual : percentual,
    }));
  };

  const finalizarProcessamentoUi = (tituloFinal = 'Processamento concluído', mensagemFinal = 'Resultado carregado.', percentualFinal = 100) => {
    limparTimersProcessamento();
    setProcessamentoUi((prev) => ({
      ...prev,
      ativo: true,
      titulo: tituloFinal,
      mensagem: mensagemFinal,
      percentual: percentualFinal,
    }));

    hideProcessamentoRef.current = setTimeout(() => {
      setProcessamentoUi({
        ativo: false,
        titulo: '',
        mensagem: '',
        percentual: 0,
      });
      hideProcessamentoRef.current = null;
    }, 900);
  };

  const limparProcessamentoUi = () => {
    limparTimersProcessamento();
    setProcessamentoUi({
      ativo: false,
      titulo: '',
      mensagem: '',
      percentual: 0,
    });
  };

  const origensPorCanalSimples = useMemo(() => {
    const online = opcoesOnline.origensPorCanal?.[canalSimples];
    if (online?.length) return online;

    const locais = transportadoras.flatMap((item) =>
      (item.origens || [])
        .filter((origem) => !canalSimples || (origem.canal || 'ATACADO') === canalSimples)
        .map((origem) => origem.cidade)
        .filter(Boolean)
    );

    return [...new Set(locais.length ? locais : todasOrigens)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [opcoesOnline.origensPorCanal, canalSimples, transportadoras, todasOrigens]);
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


  const executarComTimeout = (promise, ms = 120000) => Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Tempo limite atingido ao buscar a base. Tente filtrar por origem para reduzir a análise.')), ms);
    }),
  ]);

  const carregarBaseOnline = async (filtros) => {
    setCarregandoSimulacao(true);
    setErroSimulacao('');
    try {
      const base = await executarComTimeout(buscarBaseSimulacaoDb(filtros), 120000);
      return Array.isArray(base) ? base : [];
    } catch (error) {
      setErroSimulacao(error.message || 'Erro ao buscar base online do Supabase.');
      return [];
    } finally {
      setCarregandoSimulacao(false);
    }
  };

  useEffect(() => () => {
    limparTimersProcessamento();
  }, []);

  useEffect(() => {
    if (!canalSimples && canais[0]) setCanalSimples(canais[0]);
    if (!canalTransportadora && canais[0]) setCanalTransportadora(canais[0]);
    if (!canalAnalise && canais[0]) setCanalAnalise(canais[0]);
    if (!canalCobertura && canais[0]) setCanalCobertura(canais[0]);
    if (!canalOrigem && canais[0]) setCanalOrigem(canais[0]);
  }, [canalSimples, canalTransportadora, canalAnalise, canalCobertura, canalOrigem, canais]);

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

  const origensAnaliseDisponiveis = useMemo(() => {
    const porTransportadora = opcoesOnline.origensPorTransportadora?.[transportadoraAnalise];
    if (porTransportadora?.length) return porTransportadora;

    const porCanal = opcoesOnline.origensPorCanal?.[canalAnalise];
    if (porCanal?.length) return porCanal;

    const selecionada = transportadoras.find((item) => item.nome === transportadoraAnalise);
    if (selecionada) {
      return [...new Set((selecionada.origens || [])
        .filter((origem) => !canalAnalise || (origem.canal || 'ATACADO') === canalAnalise)
        .map((origem) => origem.cidade)
        .filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    }

    return todasOrigens;
  }, [opcoesOnline.origensPorTransportadora, opcoesOnline.origensPorCanal, transportadoraAnalise, canalAnalise, transportadoras, todasOrigens]);


  const origensOrigemDisponiveis = useMemo(() => {
    const online = opcoesOnline.origensPorCanal?.[canalOrigem];
    if (online?.length) return online;
    return todasOrigens;
  }, [opcoesOnline.origensPorCanal, canalOrigem, todasOrigens]);

  useEffect(() => {
    if (transportadora && transportadorasPorCanalTransportadora.length && !transportadorasPorCanalTransportadora.includes(transportadora)) {
      setTransportadora('');
      setOrigemTransportadora('');
    }
  }, [transportadorasPorCanalTransportadora, transportadora]);

  useEffect(() => {
    if (transportadoraAnalise && transportadorasPorCanalAnalise.length && !transportadorasPorCanalAnalise.includes(transportadoraAnalise)) {
      setTransportadoraAnalise('');
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

    iniciarProcessamentoUi('Simulação por transportadora', 'Validando destinos e preparando consulta...', 12);

    atualizarProcessamentoUi('Buscando concorrentes no Supabase...', 36);

    const baseOnline = await carregarBaseOnline({
      origem: origemTransportadora,
      canal: canalTransportadora,
      destinoCodigos: codigos,
      nomeTransportadora: transportadora,
    });

    atualizarProcessamentoUi('Montando base da análise...', 72);

    const lookupOnline = buildLookupTables(baseOnline);
    const mapaCidades = new Map(cidadePorIbgeCompleto);
    (lookupOnline.cidadePorIbge || new Map()).forEach((cidade, ibge) => mapaCidades.set(ibge, cidade));
    resolvidos.forEach((destino) => {
      if (destino?.ibge && destino?.cidade) {
        mapaCidades.set(destino.ibge, destino.uf ? `${destino.cidade}/${destino.uf}` : destino.cidade);
      }
    });

    atualizarProcessamentoUi('Calculando cenário competitivo...', 88);

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

    finalizarProcessamentoUi('Simulação concluída', 'A comparação entre transportadoras foi carregada.', 100);
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
    if (!transportadoraAnalise) {
      setErroSimulacao('Informe a transportadora para gerar a análise.');
      return;
    }

    if (!origemAnalise) {
      setErroSimulacao('Para evitar travamento em bases B2C grandes, selecione uma Origem para quebrar a análise. Depois você pode repetir para Itajaí, Itupeva, Campo Grande etc.');
      return;
    }

    iniciarProcessamentoUi('Análise de transportadora', `Preparando análise de ${transportadoraAnalise} em ${origemAnalise}...`, 8);

    try {
      atualizarProcessamentoUi('Buscando apenas destinos da transportadora nesta origem/UF...', 28);

      const baseOnline = await carregarBaseOnline({
        canal: canalAnalise,
        origem: origemAnalise,
        nomeTransportadora: transportadoraAnalise,
        ufDestino: ufAnalise,
      });

      if (!baseOnline.length) {
        setResultadoAnalise(null);
        finalizarProcessamentoUi('Sem dados para analisar', 'Não foram encontradas rotas/cotações para essa transportadora, origem e canal.', 100);
        return;
      }

      atualizarProcessamentoUi('Organizando rotas, destinos e faixas...', 62);

      const lookupOnline = buildLookupTables(baseOnline);
      const mapaCidades = new Map(cidadePorIbgeCompleto);
      (lookupOnline.cidadePorIbge || new Map()).forEach((cidade, ibge) => mapaCidades.set(ibge, cidade));

      atualizarProcessamentoUi('Calculando aderência, saving e ranking da origem...', 84);
      await new Promise((resolve) => setTimeout(resolve, 80));

      const resultado = analisarTransportadoraPorGrade({
        transportadoras: baseOnline,
        nomeTransportadora: transportadoraAnalise,
        canal: canalAnalise,
        origem: origemAnalise,
        ufDestino: ufAnalise,
        grade: grade[canalAnalise] || grade.ATACADO || [],
        cidadePorIbge: mapaCidades,
      });

      const detalhes = ufAnalise
        ? (resultado.detalhes || []).filter((item) => String(item.ufDestino || '').toUpperCase() === ufAnalise)
        : resultado.detalhes || [];

      const resultadoFinal = ufAnalise ? {
        ...resultado,
        detalhes,
        rotasAvaliadas: detalhes.length,
        vitorias: detalhes.filter((item) => Number(item.ranking) === 1).length,
        aderencia: detalhes.length ? (detalhes.filter((item) => Number(item.ranking) === 1).length / detalhes.length) * 100 : 0,
        saving: detalhes.reduce((acc, item) => acc + Number(item.savingSegundo || 0), 0),
        freteMedio: detalhes.length ? detalhes.reduce((acc, item) => acc + Number(item.total || 0), 0) / detalhes.length : 0,
        prazoMedio: detalhes.length ? detalhes.reduce((acc, item) => acc + Number(item.prazo || 0), 0) / detalhes.length : 0,
      } : resultado;

      setResultadoAnalise(resultadoFinal);

      finalizarProcessamentoUi('Análise concluída', `Relatório gerado para ${transportadoraAnalise} em ${origemAnalise}.`, 100);
    } catch (error) {
      setErroSimulacao(error.message || 'Erro ao gerar análise. Tente uma origem menor ou atualize as opções.');
      finalizarProcessamentoUi('Erro na análise', 'A análise foi interrompida. Tente filtrar outra origem.', 100);
    }
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


  const atualizarGradePadrao = () => {
    const novaGrade = restaurarGradeFretePadrao();
    setGrade(novaGrade);
  };

  const salvarGradeAtual = () => {
    const gradeSalva = salvarGradeFrete(grade);
    setGrade(gradeSalva);
  };

  const onAnalisarOrigem = async () => {
    if (!origemOrigem) {
      setErroSimulacao('Informe a origem para gerar a análise por origem.');
      return;
    }

    iniciarProcessamentoUi('Análise por origem', `Buscando tabelas e volumetria de ${origemOrigem}...`, 8);

    try {
      atualizarProcessamentoUi('Buscando tabelas do simulador no Supabase...', 28);
      const baseOnline = await carregarBaseOnline({
        canal: canalOrigem,
        origem: origemOrigem,
        ufDestino: ufDestinoOrigem,
      });

      const lookupOnline = buildLookupTables(baseOnline);
      const mapaCidades = new Map(cidadePorIbgeCompleto);
      (lookupOnline.cidadePorIbge || new Map()).forEach((cidade, ibge) => mapaCidades.set(ibge, cidade));

      atualizarProcessamentoUi('Calculando ranking, cobertura e rotas críticas...', 62);
      const resultadoTabela = analisarOrigemPorGrade({
        transportadoras: baseOnline,
        canal: canalOrigem,
        origem: origemOrigem,
        ufDestino: ufDestinoOrigem,
        grade: grade[canalOrigem] || grade.ATACADO || [],
        cidadePorIbge: mapaCidades,
      });

      let realizado = null;
      if (usarRealizadoOrigem) {
        atualizarProcessamentoUi('Lendo volumetria do Realizado Local...', 78);
        const { rows, totalCompativel, limit } = await exportarRealizadoLocal({
          canal: canalOrigem,
          origem: origemOrigem,
          ufDestino: ufDestinoOrigem,
          inicio: inicioOrigem,
          fim: fimOrigem,
        }, { limit: 5000 });
        realizado = {
          totalCompativel,
          limit,
          ...resumirRealizadoPorOrigem(rows, baseOnline, { canal: canalOrigem, origem: origemOrigem }, mapaCidades, grade[canalOrigem] || grade.ATACADO || []),
        };
      }

      setResultadoOrigem({
        tabela: resultadoTabela,
        realizado,
        filtros: {
          canal: canalOrigem,
          origem: origemOrigem,
          ufDestino: ufDestinoOrigem,
          inicio: inicioOrigem,
          fim: fimOrigem,
        },
      });
      finalizarProcessamentoUi('Análise concluída', 'Laudo da origem gerado com ranking, volumetria e rotas críticas.', 100);
    } catch (error) {
      setErroSimulacao(error.message || 'Erro ao gerar análise por origem.');
      finalizarProcessamentoUi('Erro na análise', 'Não foi possível gerar o laudo da origem.', 100);
    }
  };

  const exportarAnaliseOrigem = () => {
    if (!resultadoOrigem?.tabela) return;
    const linhas = [
      ['Tipo', 'Transportadora', 'Participações', 'Vitórias', '% Aderência', 'Frete médio', 'Prazo médio', 'Diferença média líder'],
      ...(resultadoOrigem.tabela.porTransportadora || []).map((item) => [
        'Tabela', item.transportadora, item.participacoes, item.vitorias, item.aderencia.toFixed(2), item.freteMedio.toFixed(2), item.prazoMedio.toFixed(2), item.diferencaMediaLider.toFixed(2),
      ]),
      [],
      ['Realizado', 'Transportadora', 'CT-es', '% CT-es', 'Frete realizado', '% Frete', 'Valor NF', '% Frete/NF'],
      ...((resultadoOrigem.realizado?.porTransportadora || []).map((item) => [
        'Realizado', item.transportadora, item.ctes, item.pctCtes.toFixed(2), item.frete.toFixed(2), item.pctFrete.toFixed(2), item.valorNF.toFixed(2), item.percentualFrete.toFixed(2),
      ])),
      [],
      ['Simulação sobre realizado', 'Transportadora', 'CT-es concorreu', 'CT-es ganharia', '% ganharia', 'CT-es carregou', '% carregou', 'Acerto operacional', 'Frete realizado', 'Frete melhor nas cargas', 'Diferença potencial'],
      ...((resultadoOrigem.realizado?.simulacaoPorTransportadora || []).map((item) => [
        'Simulação sobre realizado', item.transportadora, item.ctesConcorreu, item.ctesGanharia, item.pctGanharia.toFixed(2), item.ctesCarregou, item.pctCarregou.toFixed(2), item.acertoOperacional.toFixed(2), item.freteRealizado.toFixed(2), item.freteMelhorParaCargasCarregadas.toFixed(2), item.diferencaPotencial.toFixed(2),
      ])),
    ];
    const { nomeArquivo, csv } = exportarLinhasCsv(`analise-origem-${origemOrigem.toLowerCase().replace(/\s+/g, '-')}.csv`, linhas);
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
          ['origem', 'Análise por origem'],
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
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="sim-tab" type="button" onClick={atualizarOpcoesSimulador} disabled={carregandoOpcoes}>
            {carregandoOpcoes ? 'Atualizando opções...' : 'Atualizar opções'}
          </button>
          <button className="sim-tab" type="button" onClick={salvarGradeAtual}>
            Salvar grade atual
          </button>
          <button className="sim-tab" type="button" onClick={atualizarGradePadrao}>
            Restaurar grade padrão
          </button>
        </div>
      </div>
      {erroOpcoes ? <div className="sim-alert error">{erroOpcoes}</div> : null}


      <div className="sim-alert info" style={{ display: 'grid', gap: 8 }}>
        <strong>Grade em uso no simulador</strong>
        <span>
          ATACADO: {(grade.ATACADO || []).map((item) => `${item.peso}kg`).join(' · ') || '-'}
        </span>
        <span>
          B2C: {(grade.B2C || []).map((item) => `${item.peso}kg`).join(' · ') || '-'}
        </span>
      </div>

      {carregandoSimulacao ? (
        <div className="sim-alert info">Buscando concorrentes no Supabase para esta simulação...</div>
      ) : null}
      {processamentoUi.ativo ? (
        <div className="sim-alert info" style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 22, lineHeight: 1 }}>⏳</div>
            <div style={{ flex: 1 }}>
              <strong>{processamentoUi.titulo}</strong>
              <div style={{ fontSize: 13, opacity: 0.9 }}>{processamentoUi.mensagem}</div>
            </div>
            <strong>{processamentoUi.percentual}%</strong>
          </div>
          <div style={{ background: '#e7eefb', borderRadius: 999, height: 12, overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.max(6, Math.min(processamentoUi.percentual, 100))}%`,
                height: '100%',
                borderRadius: 999,
                background: 'linear-gradient(90deg, #04C7A4, #9153F0)',
                transition: 'width 0.35s ease',
              }}
            />
          </div>
          <small>
            Essa análise pode levar mais tempo quando houver muitas rotas, destinos e concorrentes no canal selecionado.
          </small>
        </div>
      ) : null}
      {erroSimulacao ? (
        <div className="sim-alert error">{erroSimulacao}</div>
      ) : null}

      {aba === 'simples' && (
        <section className="sim-card">
          <h2>Simulação simples</h2>
          <div className="sim-form-grid sim-grid-5">
            <label>Origem
              <input list="origens-simples-lista" value={origemSimples} onChange={(e) => setOrigemSimples(e.target.value)} placeholder="Clique ou digite a origem" />
              <datalist id="origens-simples-lista">
                {origensPorCanalSimples.map((item) => <option key={item} value={item} />)}
              </datalist>
            </label>
            <label>Destino (CEP ou IBGE)
              <input list="destinos-lista" value={destinoCodigo} onChange={(e) => setDestinoCodigo(e.target.value)} placeholder="Digite cidade, IBGE ou CEP" />
              <datalist id="destinos-lista">
                {todosDestinosComCidade.map((item) => (
                  <option key={item.ibge} value={item.cidade && item.uf ? `${item.cidade}/${item.uf} · ${item.ibge}` : item.ibge}>
                    {item.ibge}
                  </option>
                ))}
              </datalist>
              {destinoIdentificado && <small style={{ color: '#64748b' }}>Destino identificado: {destinoIdentificado}</small>}
            </label>
            <label>Canal
              <select value={canalSimples} onChange={(e) => { setCanalSimples(e.target.value); setOrigemSimples(''); }}>{canais.map((item) => <option key={item}>{item}</option>)}</select>
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
              <input
                list="transportadoras-canal-lista"
                value={transportadora}
                onChange={(e) => {
                  const nome = e.target.value;
                  setTransportadora(nome);
                  setOrigemTransportadora('');
                  const primeiroCanal = opcoesOnline.canaisPorTransportadora?.[nome]?.[0] || canalTransportadora || canais[0] || 'ATACADO';
                  if (opcoesOnline.canaisPorTransportadora?.[nome]?.length && !opcoesOnline.canaisPorTransportadora[nome].includes(canalTransportadora)) {
                    setCanalTransportadora(primeiroCanal);
                  }
                }}
                placeholder="Digite a transportadora"
              />
              <datalist id="transportadoras-canal-lista">
                {transportadorasPorCanalTransportadora.map((item) => <option key={item} value={item} />)}
              </datalist>
            </label>
            <label>Canal
              <select value={canalTransportadora} onChange={(e) => { setCanalTransportadora(e.target.value); setOrigemTransportadora(''); }}>{canais.map((item) => <option key={item}>{item}</option>)}</select>
            </label>
            <label>Origem (opcional)
              <input list="origens-transportadora-lista" value={origemTransportadora} onChange={(e) => setOrigemTransportadora(e.target.value)} placeholder="Todas ou digite a origem" />
              <datalist id="origens-transportadora-lista">
                {origensTransportadora.map((item) => <option key={item} value={item} />)}
              </datalist>
            </label>
            <label>Destino opcional (cidade, CEP ou IBGE)
              <input disabled={modoLista} list="destinos-lista-transportadora" value={destinoTransportadora} onChange={(e) => setDestinoTransportadora(e.target.value)} placeholder="Digite cidade, IBGE ou CEP" />
              <datalist id="destinos-lista-transportadora">
                {todosDestinosComCidade.map((item) => (
                  <option key={item.ibge} value={item.cidade && item.uf ? `${item.cidade}/${item.uf} · ${item.ibge}` : item.ibge}>
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
          <div className="sim-form-grid sim-grid-5">
            <label>Transportadora
              <input list="transportadoras-analise-lista" value={transportadoraAnalise} onChange={(e) => { setTransportadoraAnalise(e.target.value); setOrigemAnalise(''); }} placeholder="Digite a transportadora" />
              <datalist id="transportadoras-analise-lista">
                {transportadorasPorCanalAnalise.map((item) => <option key={item} value={item} />)}
              </datalist>
              {!transportadorasPorCanalAnalise.length ? <small>Nenhuma transportadora cadastrada neste canal.</small> : null}
            </label>
            <label>Canal
              <select value={canalAnalise} onChange={(e) => { setCanalAnalise(e.target.value); setOrigemAnalise(''); }}>{canais.map((item) => <option key={item}>{item}</option>)}</select>
            </label>
            <label>Origem
              <input list="origens-analise-lista" value={origemAnalise} onChange={(e) => setOrigemAnalise(e.target.value)} placeholder="Obrigatório para B2C grande" />
              <datalist id="origens-analise-lista">
                {origensAnaliseDisponiveis.map((item) => <option key={item} value={item} />)}
              </datalist>
              <small style={{ color: '#64748b' }}>Quebre por origem: Itajaí, Itupeva, Campo Grande...</small>
            </label>
            <label>UF destino
              <select value={ufAnalise} onChange={(e) => setUfAnalise(e.target.value)}>
                {UF_OPTIONS.map((item) => <option key={item} value={item}>{item || 'Todas'}</option>)}
              </select>
            </label>
            <div className="sim-actions" style={{ alignItems: 'flex-end' }}><button className="primary" onClick={onSimularGrade} disabled={carregandoSimulacao || processamentoUi.ativo}>{carregandoSimulacao || processamentoUi.ativo ? "Processando..." : "Gerar relatório"}</button></div>
          </div>
          {resultadoAnalise && (
            <div className="sim-cobertura-box">
              <div className="sim-alert info">
                Filtros aplicados: <strong>{transportadoraAnalise}</strong> · Canal: <strong>{canalAnalise}</strong> · Origem: <strong>{origemAnalise}</strong>{ufAnalise ? ` · UF destino: ${ufAnalise}` : ''}
              </div>
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


      {aba === 'origem' && (
        <section className="sim-card">
          <div className="sim-resultado-topo compact-top">
            <h2 style={{ margin: 0 }}>Análise por origem</h2>
            <button className="sim-tab" type="button" onClick={exportarAnaliseOrigem} disabled={!resultadoOrigem?.tabela}>Exportar laudo</button>
          </div>

          <div className="sim-form-grid sim-grid-6">
            <label>Canal
              <select value={canalOrigem} onChange={(e) => { setCanalOrigem(e.target.value); setOrigemOrigem(''); }}>
                {canais.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Origem
              <input list="origens-origem-lista" value={origemOrigem} onChange={(e) => setOrigemOrigem(e.target.value)} placeholder="Ex.: Itajaí" />
              <datalist id="origens-origem-lista">
                {origensOrigemDisponiveis.map((item) => <option key={item} value={item} />)}
              </datalist>
            </label>
            <label>UF destino
              <select value={ufDestinoOrigem} onChange={(e) => setUfDestinoOrigem(e.target.value)}>
                {UF_OPTIONS.map((item) => <option key={item} value={item}>{item || 'Todas'}</option>)}
              </select>
            </label>
            <label>Início realizado
              <input type="date" value={inicioOrigem} onChange={(e) => setInicioOrigem(e.target.value)} />
            </label>
            <label>Fim realizado
              <input type="date" value={fimOrigem} onChange={(e) => setFimOrigem(e.target.value)} />
            </label>
            <label className="sim-flag" style={{ justifyContent: 'end' }}>
              <input type="checkbox" checked={usarRealizadoOrigem} onChange={(e) => setUsarRealizadoOrigem(e.target.checked)} />
              Usar Realizado Local
            </label>
          </div>

          <div className="sim-actions"><button className="primary" onClick={onAnalisarOrigem} disabled={carregandoSimulacao || processamentoUi.ativo}>{carregandoSimulacao || processamentoUi.ativo ? 'Processando...' : 'Gerar laudo da origem'}</button></div>

          {resultadoOrigem?.tabela && (
            <div className="sim-cobertura-box">
              <div className="sim-alert info">
                Origem: <strong>{resultadoOrigem.filtros.origem}</strong> · Canal: <strong>{resultadoOrigem.filtros.canal}</strong>{resultadoOrigem.filtros.ufDestino ? ` · UF destino: ${resultadoOrigem.filtros.ufDestino}` : ''}
              </div>

              <div className="sim-analise-resumo">
                <div><span>Cenários tabela</span><strong>{resultadoOrigem.tabela.cenariosAvaliados}</strong></div>
                <div><span>Destinos cobertos</span><strong>{resultadoOrigem.tabela.destinosCobertos}</strong></div>
                <div><span>Rotas com 1 transp.</span><strong>{resultadoOrigem.tabela.rotasComUmaTransportadora}</strong></div>
                <div><span>Saving vs 2º menor</span><strong>{formatMoney(resultadoOrigem.tabela.savingVsSegundo)}</strong></div>
                <div><span>Frete médio ganhador</span><strong>{formatMoney(resultadoOrigem.tabela.freteMedioVencedor)}</strong></div>
                <div><span>Realizado local</span><strong>{resultadoOrigem.realizado ? `${resultadoOrigem.realizado.ctes} CT-es` : 'Não usado'}</strong></div>
              </div>

              {resultadoOrigem.realizado && (
                <div className="sim-analise-resumo">
                  <div><span>Frete realizado</span><strong>{formatMoney(resultadoOrigem.realizado.freteRealizado)}</strong></div>
                  <div><span>Frete se fosse ganhador</span><strong>{formatMoney(resultadoOrigem.realizado.freteGanhadorTotal)}</strong></div>
                  <div><span>Diferença potencial</span><strong>{formatMoney(resultadoOrigem.realizado.diferencaPotencialTotal)}</strong></div>
                  <div><span>% economia potencial</span><strong>{formatPercent(resultadoOrigem.realizado.percentualSavingPotencial)}</strong></div>
                  <div><span>Acerto operacional</span><strong>{formatPercent(resultadoOrigem.realizado.aderenciaRealizada)}</strong></div>
                  <div><span>Sem tabela no realizado</span><strong>{resultadoOrigem.realizado.semTabela}</strong></div>
                  <div><span>Destinos sem cobertura</span><strong>{resultadoOrigem.realizado.destinosSemTabela}</strong></div>
                  <div><span>Destinos com 1 opção</span><strong>{resultadoOrigem.realizado.destinosUmaOpcao}</strong></div>
                </div>
              )}

              <div className="sim-grid-2" style={{ display: 'grid', gap: 16 }}>
                <div className="sim-parametros-box">
                  <div className="sim-parametros-header"><div><strong>Potencial por grade</strong><p>Quem ganha mais rotas/faixas simuladas da origem. Esta visão não representa volume real carregado.</p></div></div>
                  <div className="sim-analise-tabela-wrap" style={{ marginTop: 12 }}>
                    <table className="sim-analise-tabela">
                      <thead><tr><th>Transportadora</th><th>Rotas/faixas ganhas</th><th>Aderência</th><th>Frete médio</th><th>Prazo</th></tr></thead>
                      <tbody>
                        {(resultadoOrigem.tabela.porTransportadora || []).slice(0, 20).map((item) => (
                          <tr key={item.transportadora}>
                            <td><strong>{item.transportadora}</strong></td>
                            <td>{item.vitorias}</td>
                            <td>{formatPercent(item.aderencia)}</td>
                            <td>{formatMoney(item.freteMedio)}</td>
                            <td>{item.prazoMedio.toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="sim-parametros-box">
                  <div className="sim-parametros-header"><div><strong>Quem carrega no realizado</strong><p>Participação real da origem, vindo da base local.</p></div></div>
                  <div className="sim-analise-tabela-wrap" style={{ marginTop: 12 }}>
                    <table className="sim-analise-tabela">
                      <thead><tr><th>Transportadora</th><th>CT-es</th><th>% CT-es</th><th>Frete</th><th>% Frete</th></tr></thead>
                      <tbody>
                        {((resultadoOrigem.realizado?.porTransportadora || []).slice(0, 20)).map((item) => (
                          <tr key={item.transportadora}>
                            <td><strong>{item.transportadora}</strong></td>
                            <td>{item.ctes}</td>
                            <td>{formatPercent(item.pctCtes)}</td>
                            <td>{formatMoney(item.frete)}</td>
                            <td>{formatPercent(item.pctFrete)}</td>
                          </tr>
                        ))}
                        {!resultadoOrigem.realizado && <tr><td colSpan="5">Ative “Usar Realizado Local” para ver a volumetria carregada.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {resultadoOrigem.realizado && (
                <div className="sim-parametros-box">
                  <div className="sim-parametros-header">
                    <div>
                      <strong>Simulação sobre realizado local</strong>
                      <p>Usa peso, valor NF e volumes reais. A cubagem vem da linha realizada quando existir; se não existir, usa a cubagem da faixa da grade do canal.</p>
                    </div>
                  </div>
                  <div className="sim-analise-tabela-wrap" style={{ marginTop: 12 }}>
                    <table className="sim-analise-tabela">
                      <thead>
                        <tr>
                          <th>Transportadora</th>
                          <th>CT-es concorreu</th>
                          <th>CT-es ganharia</th>
                          <th>% ganharia</th>
                          <th>CT-es carregou</th>
                          <th>% carregou</th>
                          <th>Acerto operacional</th>
                          <th>Frete realizado</th>
                          <th>Frete melhor</th>
                          <th>Dif. potencial</th>
                        </tr>
                      </thead>
                      <tbody>
                        {((resultadoOrigem.realizado?.simulacaoPorTransportadora || []).slice(0, 30)).map((item) => (
                          <tr key={item.transportadora}>
                            <td><strong>{item.transportadora}</strong></td>
                            <td>{item.ctesConcorreu}</td>
                            <td>{item.ctesGanharia}</td>
                            <td>{formatPercent(item.pctGanharia)}</td>
                            <td>{item.ctesCarregou}</td>
                            <td>{formatPercent(item.pctCarregou)}</td>
                            <td>{formatPercent(item.acertoOperacional)}</td>
                            <td>{formatMoney(item.freteRealizado)}</td>
                            <td>{formatMoney(item.freteMelhorParaCargasCarregadas)}</td>
                            <td>{formatMoney(item.diferencaPotencial)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="sim-grid-2" style={{ display: 'grid', gap: 16 }}>
                <div className="sim-parametros-box">
                  <div className="sim-parametros-header"><div><strong>Buracos e rotas sensíveis</strong><p>Sem cobertura = 0 transportadoras com tabela. Baixa concorrência = 1 transportadora. Concorrência limitada = 2 transportadoras.</p></div></div>
                  <div className="sim-cobertura-lista">
                    {((resultadoOrigem.realizado?.destinosCriticos || resultadoOrigem.tabela.rotasCriticas || []).slice(0, 60)).map((item, idx) => (
                      <div key={`${item.ibgeDestino || item.ibge}-${idx}`}>
                        {(item.origem || resultadoOrigem.filtros.origem)} → {item.cidadeDestino || item.destino || `IBGE ${item.ibgeDestino || item.ibge}`}/{item.ufDestino || item.uf} · {item.statusCobertura || 'Baixa concorrência'} · {(item.concorrentesTabela || item.transportadoras || []).join(', ') || 'Sem tabela'}
                      </div>
                    ))}
                    {resultadoOrigem.realizado && !resultadoOrigem.realizado.destinosCriticos?.length && <div>Nenhum destino crítico no realizado filtrado.</div>}
                    {!resultadoOrigem.realizado && !resultadoOrigem.tabela.rotasCriticas?.length && <div>Nenhuma rota com apenas uma transportadora encontrada nos filtros.</div>}
                  </div>
                </div>
                <div className="sim-parametros-box">
                  <div className="sim-parametros-header"><div><strong>Maiores oportunidades no realizado</strong><p>CT-es onde a tabela simulada indica menor preço que o frete realizado. A simulação considera cubagem real ou cubagem da faixa da grade.</p></div></div>
                  <div className="sim-cobertura-lista">
                    {(resultadoOrigem.realizado?.simulacoes || []).slice(0, 60).map((item, idx) => (
                      <div key={`${item.cte}-${idx}`}>{item.destino}/{item.uf} · Real: {item.transportadoraReal} {formatMoney(item.freteRealizado)} · Melhor: {item.vencedor} {formatMoney(item.freteVencedor)} · Dif.: {formatMoney(item.saving)}</div>
                    ))}
                    {resultadoOrigem.realizado && !resultadoOrigem.realizado.simulacoes?.length && <div>Não houve oportunidade simulada com a base realizada filtrada.</div>}
                    {!resultadoOrigem.realizado && <div>Ative a base realizada para listar oportunidades por CT-e.</div>}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {aba === 'cobertura' && (
        <section className="sim-card">
          <div className="sim-resultado-topo compact-top"><h2 style={{ margin: 0 }}>Cobertura de tabela</h2><button className="sim-tab" type="button" onClick={exportarCobertura}>Exportar faltantes</button></div>
          <div className="sim-form-grid sim-grid-4" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
            <label>Canal<select value={canalCobertura} onChange={(e) => setCanalCobertura(e.target.value)}>{canais.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Origem<input list="origens-cobertura-lista" value={origemCobertura} onChange={(e) => setOrigemCobertura(e.target.value)} placeholder="Todas ou digite a origem" /><datalist id="origens-cobertura-lista">{todasOrigens.map((item) => <option key={item} value={item} />)}</datalist></label>
            <label>Transportadora<input list="transportadoras-cobertura-lista" value={transportadoraCobertura} onChange={(e) => setTransportadoraCobertura(e.target.value)} placeholder="Todas ou digite a transportadora" /><datalist id="transportadoras-cobertura-lista">{transportadorasPorCanalCobertura.map((item) => <option key={item} value={item} />)}</datalist></label>
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
