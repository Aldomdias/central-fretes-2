
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
import { carregarGradeFrete, salvarGradeFrete } from '../utils/gradeFreteConfig';
import { carregarGradeFreteCentralizada, salvarGradeFreteCentralizada, restaurarGradeFreteCentralizadaPadrao } from '../services/gradeFreteSupabaseService';
import { buscarBaseSimulacaoDb, buscarBaseSimulacaoPorRotasDb, carregarMunicipiosIbgeDb, carregarOpcoesSimuladorDb, resolverDestinoIbgeDb } from '../services/freteDatabaseService';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { carregarVinculosTransportadoras, criarMapaVinculosTransportadoras } from '../services/vinculosTransportadorasService';
import {
  buscarTabelasNegociacaoParaSimulacao,
  salvarResultadoSimulacaoNegociacao,
} from '../services/tabelasNegociacaoService';
import {
  converterTabelasNegociacaoParaSimulador,
  labelTabelaNegociacaoSimulador,
} from '../utils/tabelasNegociacaoSimuladorAdapter';

const CANAL_VENDAS_MAP_SIM = {
  'B2C': 'B2C', 'B2B': 'ATACADO', 'MERCADO LIVRE': 'B2C', 'SHOPEE': 'B2C',
  'MAGAZINE LUIZA': 'B2C', 'AMAZON': 'B2C', 'VIA VAREJO': 'B2C', 'CARREFOUR': 'B2C',
  'LIVELO': 'B2C', 'CANTU PNEUS': 'B2C', 'PITSTOP': 'B2C', 'INTER': 'B2C',
  'ITAU SHOP': 'B2C', '99': 'B2C', 'COOPERA': 'B2C', 'BRADESCO SHOP': 'B2C', 'MUSTANG': 'B2C',
};
const MARCADORES_ATACADO_SIM = ['AT-AG', 'AT-TR', 'ECM-B2B', 'ECC-SALES', 'ECA-SALES'];
const TOMADORES_REALIZADO_PADRAO_SIM = ['CPX', 'ITR', 'GP PNEUS'];


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFetchNetworkError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('fetch failed') || msg.includes('timeout') || msg.includes('aborted');
}

async function executarQueryRealizadoComRetry(montarQuery, contexto = 'consulta realizado_local_ctes', tentativas = 3) {
  let ultimoErro = null;

  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    try {
      return await montarQuery();
    } catch (error) {
      ultimoErro = error;
      if (!isFetchNetworkError(error) || tentativa >= tentativas) break;
      await sleep(600 * tentativa);
    }
  }

  const detalhe = ultimoErro?.message || String(ultimoErro || 'erro desconhecido');
  throw new Error(`${contexto}: ${detalhe}`);
}

function normalizarCanalSim(r) {
  const norm = (s) => String(s || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const cv = norm(r.canal_vendas);
  if (cv && CANAL_VENDAS_MAP_SIM[cv]) return CANAL_VENDAS_MAP_SIM[cv];
  const marc = norm(r.marcadores);
  if (marc) {
    if (MARCADORES_ATACADO_SIM.some((t) => marc.includes(t))) return 'ATACADO';
    if (marc.length > 0) return 'B2C';
  }
  if (!String(r.documento_destinatario || '').trim()) return 'B2C';
  const cl = norm(r.canal);
  return cl || 'B2C';
}

function pickRealizadoField(row = {}, keys = []) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function onlyDigitsRealizado(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function aplicarFiltrosRealizadoQuery(query, filtros) {
  if (filtros.transportadora) query = query.ilike('transportadora', `%${filtros.transportadora}%`);
  if (filtros.origem) query = query.ilike('cidade_origem', filtros.origem + '%');
  if (filtros.destino) query = query.ilike('cidade_destino', filtros.destino + '%');
  if (filtros.ufOrigem) query = query.eq('uf_origem', filtros.ufOrigem);
  if (filtros.canal) {
    const canalNorm = String(filtros.canal || '').toUpperCase();
    if (canalNorm === 'ATACADO' || canalNorm === 'B2B') query = query.in('canal', ['ATACADO', 'B2B', 'Atacado', 'b2b']);
    else query = query.eq('canal', filtros.canal);
  }
  if (filtros.ufDestino) query = query.eq('uf_destino', filtros.ufDestino);
  if (filtros.inicio) query = query.gte('data_emissao', filtros.inicio);
  if (filtros.fim) query = query.lte('data_emissao', filtros.fim);
  return query;
}

async function buscarRealizadoLocalCtes(filtros = {}, onProgresso = null) {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabaseClient();
  const totalMax = Math.min(Number(filtros.limit) || 100000, 200000);
  const PAGE_SIZE = 500; // menor para evitar Failed to fetch em bases grandes
  let allRows = [];
  let from = 0;

  while (allRows.length < totalMax) {
    const to = from + PAGE_SIZE - 1;
    let query = supabase
      .from('realizado_local_ctes')
      .select('*')
      .order('data_emissao', { ascending: false })
      .range(from, to);
    query = aplicarFiltrosRealizadoQuery(query, filtros);

    const resposta = await executarQueryRealizadoComRetry(async () => query, `Erro ao buscar realizado_local_ctes (${from + 1}-${to + 1})`);
    const { data, error } = resposta || {};
    if (error) throw new Error('Erro ao buscar realizado_local_ctes: ' + error.message);
    if (!data || data.length === 0) break;

    allRows = allRows.concat(data);
    if (onProgresso) onProgresso(allRows.length);
    if (data.length < PAGE_SIZE) break; // última página
    from += PAGE_SIZE;
  }

  const rows = allRows.slice(0, totalMax);
  return rows.map(r => ({
    transportadora: pickRealizadoField(r, ['transportadora', 'nome_transportadora', 'transportador']) || '',
    tomador: pickRealizadoField(r, ['tomador_servico', 'tomadorServico', 'tomador', 'nome_tomador', 'razao_social_tomador']) || '',
    valorCte: Number(pickRealizadoField(r, ['valor_cte', 'valorCte', 'frete_realizado', 'freteRealizado', 'valor_frete'])) || 0,
    valorNF: Number(pickRealizadoField(r, ['valor_nf', 'valorNF', 'nf_venda', 'valor_nota', 'valor_mercadoria'])) || 0,
    cidadeDestino: pickRealizadoField(r, ['cidade_destino', 'cidadeDestino', 'destino', 'municipio_destino']) || '',
    ufDestino: String(pickRealizadoField(r, ['uf_destino', 'ufDestino', 'estado_destino']) || '').toUpperCase(),
    cidadeOrigem: pickRealizadoField(r, ['cidade_origem', 'cidadeOrigem', 'origem', 'municipio_origem']) || '',
    ufOrigem: String(pickRealizadoField(r, ['uf_origem', 'ufOrigem', 'estado_origem']) || '').toUpperCase(),
    canal: normalizarCanalSim(r),
    numeroCte: pickRealizadoField(r, ['numero_cte', 'numeroCte', 'cte', 'n_cte']) || '',
    chaveCte: pickRealizadoField(r, ['chave_cte', 'chaveCte', 'chave']) || '',
    chaveNfe: pickRealizadoField(r, ['chave_nfe', 'chaveNfe', 'chave_nf', 'chaveNf', 'chave_nota', 'chaveNota']) || '',
    notaFiscal: pickRealizadoField(r, ['nota_fiscal', 'notaFiscal', 'nf', 'numero_nf', 'numeroNf', 'nfe_numero']) || '',
    pesoDeclarado: Number(pickRealizadoField(r, ['peso_declarado', 'pesoDeclarado', 'peso', 'peso_real', 'pesoReal'])) || 0,
    qtdVolumes: Number(pickRealizadoField(r, ['qtd_volumes', 'qtdVolumes', 'volume', 'volumes', 'quantidade_volumes'])) || 0,
    cubagemUnitaria: Number(pickRealizadoField(r, ['cubagem_unitaria', 'cubagemUnitaria', 'cubagem'])) || 0,
    cubagemTotal: Number(pickRealizadoField(r, ['cubagem_total', 'cubagemTotal'])) || 0,
    pesoCubado: Number(pickRealizadoField(r, ['peso_cubado', 'pesoCubado'])) || 0,
    ibgeOrigem: onlyDigitsRealizado(pickRealizadoField(r, ['ibge_origem', 'ibgeOrigem', 'codigo_ibge_origem', 'codigoMunicipioOrigem', 'cod_mun_origem'])).slice(0, 7),
    ibgeDestino: onlyDigitsRealizado(pickRealizadoField(r, ['ibge_destino', 'ibgeDestino', 'codigo_ibge_destino', 'codigoMunicipioDestino', 'cod_mun_destino'])).slice(0, 7),
    competencia: pickRealizadoField(r, ['competencia', 'mes_competencia']) || '',
    dataEmissao: pickRealizadoField(r, ['data_emissao', 'dataEmissao', 'emissao']) || '',
    tipo_veiculo: pickRealizadoField(r, ['tipo_veiculo', 'tipoVeiculo', 'veiculo', 'tipo']) || '',
  }));
}

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
              <div>Cubagem usada no cálculo: <strong>{Number(item.detalhes?.frete?.cubagemAplicada || 0).toFixed(6)} m³</strong></div>
              <div>Regra da cubagem: <strong>{item.detalhes?.frete?.origemCubagem === 'grade' ? 'somente grade' : 'sem cubagem na grade'}</strong></div>
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
  const declarado = numeroRealizado(row.pesoDeclarado);
  return declarado > 0 ? declarado : numeroRealizado(row.peso);
}

function cubagemRealizado(row = {}) {
  // Regra do realizado:
  // cubagem só é confiável quando veio do Tracking.
  // O CT-e pode trazer cubagem divergente, então não usamos cubagem do CT-e como fallback.
  if (!row.trackingMatch) return 0;

  const total = numeroRealizado(row.cubagemTotal || row.cubagem_total);
  if (total > 0) return total;

  const unitaria = numeroRealizado(row.cubagemUnitaria || row.cubagem_unitaria);
  const volumes = numeroRealizado(row.qtdVolumes || row.volumes || row.volume);

  if (unitaria > 0 && volumes > 0) return unitaria * volumes;
  return 0;
}


function normalizarChaveTracking(value = '') {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function apenasDigitosTracking(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function normalizarChaveLongaTracking(value = '') {
  // Para CT-e/NF-e, a comparação precisa ser pela chave limpa, apenas dígitos.
  // Isso evita perder vínculo quando uma base traz máscara/espaços e a outra não.
  return apenasDigitosTracking(value);
}

function chunksTracking(lista = [], tamanho = 300) {
  const saida = [];
  for (let i = 0; i < lista.length; i += tamanho) saida.push(lista.slice(i, i + tamanho));
  return saida;
}

function numeroTracking(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function criarTrackingAgregado(item = {}, origem = 'raw') {
  const qtdVolumes = numeroTracking(item.qtd_volumes ?? item.volumes ?? item.volume ?? 0);
  const cubagemUnitaria = numeroTracking(item.cubagem_unitaria ?? 0);
  const cubagemTotalDireta = numeroTracking(item.cubagem_total ?? item.cubagem ?? 0);
  const cubagemTotal = cubagemTotalDireta > 0
    ? cubagemTotalDireta
    : cubagemUnitaria > 0 && qtdVolumes > 0
      ? cubagemUnitaria * qtdVolumes
      : 0;

  return {
    ...item,
    origem_vinculo_tracking: origem,
    linhas_tracking: Number(item.linhas_tracking || 1),
    qtd_volumes: qtdVolumes,
    cubagem_unitaria: cubagemUnitaria,
    cubagem_total: cubagemTotal,
    peso: numeroTracking(item.peso ?? item.peso_tracking ?? 0),
    peso_declarado: numeroTracking(item.peso_declarado ?? 0),
    peso_cubado: numeroTracking(item.peso_cubado ?? 0),
    valor_nf: numeroTracking(item.valor_nf ?? 0),
  };
}

function somarTrackingAgregado(atual, proximo) {
  if (!atual) return criarTrackingAgregado(proximo);
  const item = criarTrackingAgregado(proximo);
  return {
    ...atual,
    ...Object.fromEntries(
      Object.entries(atual).filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
    ),
    linhas_tracking: numeroTracking(atual.linhas_tracking) + numeroTracking(item.linhas_tracking || 1),
    qtd_volumes: numeroTracking(atual.qtd_volumes) + numeroTracking(item.qtd_volumes),
    cubagem_unitaria: numeroTracking(atual.cubagem_unitaria) || numeroTracking(item.cubagem_unitaria),
    cubagem_total: numeroTracking(atual.cubagem_total) + numeroTracking(item.cubagem_total),
    peso: numeroTracking(atual.peso) + numeroTracking(item.peso),
    peso_declarado: numeroTracking(atual.peso_declarado) || numeroTracking(item.peso_declarado),
    peso_cubado: numeroTracking(atual.peso_cubado) || numeroTracking(item.peso_cubado),
    valor_nf: numeroTracking(atual.valor_nf) || numeroTracking(item.valor_nf),
    origem_vinculo_tracking: atual.origem_vinculo_tracking || item.origem_vinculo_tracking || 'raw',
  };
}

function adicionarTrackingNoMapa(mapa, chave, item) {
  if (!chave) return;
  const atual = mapa.get(chave);
  mapa.set(chave, somarTrackingAgregado(atual, item));
}

async function buscarTrackingParaRealizado(rows = []) {
  const vazio = { mapaChaveCte: new Map(), mapaChaveNfe: new Map(), mapaNota: new Map(), mapaNumeroCte: new Map(), total: 0, erro: '' };
  if (!isSupabaseConfigured() || !rows?.length) return vazio;

  const chavesCte = [...new Set(rows.map((r) => normalizarChaveLongaTracking(r.chaveCte)).filter((v) => v.length >= 20))];
  const chavesNfe = [...new Set(rows.map((r) => normalizarChaveLongaTracking(r.chaveNfe)).filter((v) => v.length >= 20))];
  const notas = [...new Set(rows.map((r) => apenasDigitosTracking(r.notaFiscal)).filter(Boolean))];

  // Número de CT-e fica como último recurso. Não deve ser usado quando a linha possui chave.
  const numerosCteFallback = [...new Set(
    rows
      .filter((r) => !normalizarChaveLongaTracking(r.chaveCte) && !normalizarChaveLongaTracking(r.chaveNfe) && !apenasDigitosTracking(r.notaFiscal))
      .map((r) => apenasDigitosTracking(r.numeroCte))
      .filter(Boolean)
  )];

  if (!chavesCte.length && !chavesNfe.length && !notas.length && !numerosCteFallback.length) return vazio;

  const supabase = getSupabaseClient();
  const mapaChaveCte = new Map();
  const mapaChaveNfe = new Map();
  const mapaNota = new Map();
  const mapaNumeroCte = new Map();
  let totalEncontrado = 0;
  let erroView = '';

  async function consultarViewAgregadaPorChaveCte() {
    if (!chavesCte.length) return false;
    let consultou = false;
    for (const parte of chunksTracking(chavesCte, 300)) {
      if (!parte.length) continue;
      const { data, error } = await supabase
        .from('vw_tracking_cte_agregado')
        .select('chave_cte_limpa,chave_cte,chave_nfe,cte_numero,nota_fiscal,canal,transportadora,cidade_origem,uf_origem,ibge_origem,cidade_destino,uf_destino,ibge_destino,peso,peso_declarado,peso_cubado,cubagem_unitaria,cubagem_total,valor_nf,qtd_volumes,linhas_tracking,data_transporte,data_entrega,previsao_transportadora')
        .in('chave_cte_limpa', parte);

      if (error) {
        erroView = error.message || String(error);
        return false;
      }

      consultou = true;
      (data || []).forEach((item) => {
        const chave = normalizarChaveLongaTracking(item.chave_cte_limpa || item.chave_cte);
        adicionarTrackingNoMapa(mapaChaveCte, chave, criarTrackingAgregado(item, 'VIEW_CHAVE_CTE'));
        totalEncontrado += Number(item.linhas_tracking || 1);
      });
    }
    return consultou;
  }

  async function consultarRawPorColuna(coluna, valores, tipo) {
    for (const parte of chunksTracking(valores, 300)) {
      if (!parte.length) continue;
      const { data, error } = await supabase
        .from('tracking_rows')
        .select('chave_nfe,chave_cte,cte_numero,nota_fiscal,canal,transportadora,cidade_origem,uf_origem,ibge_origem,cidade_destino,uf_destino,ibge_destino,peso,peso_declarado,peso_cubado,cubagem_unitaria,cubagem_total,valor_nf,qtd_volumes,data_transporte,data_entrega,previsao_transportadora')
        .in(coluna, parte);
      if (error) throw error;

      (data || []).forEach((item) => {
        totalEncontrado += 1;
        if (tipo === 'CHAVE_CTE') adicionarTrackingNoMapa(mapaChaveCte, normalizarChaveLongaTracking(item.chave_cte), criarTrackingAgregado(item, 'RAW_CHAVE_CTE'));
        if (tipo === 'CHAVE_NFE') adicionarTrackingNoMapa(mapaChaveNfe, normalizarChaveLongaTracking(item.chave_nfe), criarTrackingAgregado(item, 'RAW_CHAVE_NFE'));
        if (tipo === 'NOTA') adicionarTrackingNoMapa(mapaNota, apenasDigitosTracking(item.nota_fiscal), criarTrackingAgregado(item, 'RAW_NOTA_FISCAL'));
        if (tipo === 'NUMERO_CTE') adicionarTrackingNoMapa(mapaNumeroCte, apenasDigitosTracking(item.cte_numero), criarTrackingAgregado(item, 'RAW_NUMERO_CTE'));
      });
    }
  }

  try {
    const viewOk = await consultarViewAgregadaPorChaveCte();

    // Fallback: mantém compatibilidade se a view ainda não existir ou se alguma chave vier exatamente igual na tabela raw.
    // Mesmo quando a view existe, as demais buscas complementam NF/nota em casos sem chave CT-e.
    if (!viewOk && chavesCte.length) {
      await consultarRawPorColuna('chave_cte', chavesCte, 'CHAVE_CTE');
    }

    if (chavesNfe.length) await consultarRawPorColuna('chave_nfe', chavesNfe, 'CHAVE_NFE');
    if (notas.length) await consultarRawPorColuna('nota_fiscal', notas, 'NOTA');
    if (numerosCteFallback.length) await consultarRawPorColuna('cte_numero', numerosCteFallback, 'NUMERO_CTE');
  } catch (error) {
    console.warn('Tracking no Supabase indisponível para enriquecer realizado.', error?.message || error);
    return { ...vazio, erro: error?.message || String(error || '') };
  }

  return {
    mapaChaveCte,
    mapaChaveNfe,
    mapaNota,
    mapaNumeroCte,
    total: totalEncontrado,
    erro: '',
    aviso: erroView ? `View agregada indisponível, usado fallback raw: ${erroView}` : '',
  };
}

function obterTrackingDaLinha(row = {}, mapas) {
  if (!mapas) return null;
  const chaveCte = normalizarChaveLongaTracking(row.chaveCte);
  const chaveNfe = normalizarChaveLongaTracking(row.chaveNfe);
  const nota = apenasDigitosTracking(row.notaFiscal);
  const numeroCte = apenasDigitosTracking(row.numeroCte);

  const porChaveCte = chaveCte ? mapas.mapaChaveCte?.get(chaveCte) : null;
  if (porChaveCte) return porChaveCte;

  const porChaveNfe = chaveNfe ? mapas.mapaChaveNfe?.get(chaveNfe) : null;
  if (porChaveNfe) return porChaveNfe;

  const porNota = nota ? mapas.mapaNota?.get(nota) : null;
  if (porNota) return porNota;

  // Número CT-e é fallback de segurança somente quando não há chaves/NF na linha do realizado.
  // Isso evita falso vínculo quando o número aparece dentro de outra chave CT-e.
  if (!chaveCte && !chaveNfe && !nota && numeroCte) {
    return mapas.mapaNumeroCte?.get(numeroCte) || null;
  }

  return null;
}

function enriquecerRealizadoComTracking(rows = [], mapasTracking) {
  let vinculados = 0;
  let semTracking = 0;
  let volumesTracking = 0;
  let cubagemTracking = 0;

  const linhas = (rows || []).map((row) => {
    const tracking = obterTrackingDaLinha(row, mapasTracking);

    // Regra do realizado:
    // cubagem e volumes devem vir obrigatoriamente do Tracking.
    // Se não houver vínculo, zera esses campos para não contaminar cálculo e capacidade.
    if (!tracking) {
      semTracking += 1;
      return {
        ...row,
        trackingMatch: false,
        trackingPendente: true,
        qtdVolumes: 0,
        cubagemUnitaria: 0,
        cubagemTotal: 0,
        pesoCubado: 0,
      };
    }

    vinculados += 1;

    const qtdVolumesTracking = numeroRealizado(tracking.qtd_volumes);
    const cubagemUnitariaTracking = numeroRealizado(tracking.cubagem_unitaria);
    const cubagemTotalDiretaTracking = numeroRealizado(tracking.cubagem_total);
    const cubagemTotalTracking = cubagemTotalDiretaTracking > 0
      ? cubagemTotalDiretaTracking
      : cubagemUnitariaTracking > 0 && qtdVolumesTracking > 0
        ? cubagemUnitariaTracking * qtdVolumesTracking
        : 0;

    const pesoCubadoTracking = numeroRealizado(tracking.peso_cubado);

    if (qtdVolumesTracking > 0) volumesTracking += qtdVolumesTracking;
    if (cubagemTotalTracking > 0) cubagemTracking += cubagemTotalTracking;

    return {
      ...row,
      trackingMatch: true,
      trackingPendente: false,
      trackingTransportadora: tracking.transportadora || '',
      trackingLinhas: Number(tracking.linhas_tracking || 1),
      trackingOrigemVinculo: tracking.origem_vinculo_tracking || '',

      chaveCte: row.chaveCte || tracking.chave_cte || '',
      chaveNfe: row.chaveNfe || tracking.chave_nfe || '',
      notaFiscal: row.notaFiscal || tracking.nota_fiscal || '',
      numeroCte: row.numeroCte || tracking.cte_numero || '',

      // Campos de capacidade e cubagem: sempre do Tracking.
      qtdVolumes: qtdVolumesTracking,
      cubagemUnitaria: cubagemUnitariaTracking,
      cubagemTotal: cubagemTotalTracking,
      pesoCubado: pesoCubadoTracking,

      // Peso pode ser complementado pelo Tracking, mas mantém CT-e se o Tracking não trouxer peso.
      pesoDeclarado: numeroRealizado(tracking.peso_declarado) || numeroRealizado(tracking.peso) || row.pesoDeclarado,

      // Valor NF continua priorizando o CT-e por enquanto para não misturar regras nesta entrega.
      valorNF: numeroRealizado(row.valorNF) || numeroRealizado(tracking.valor_nf),

      canal: row.canal || tracking.canal || '',
      ibgeOrigem: row.ibgeOrigem || String(tracking.ibge_origem || '').replace(/\D/g, '').slice(0, 7),
      ibgeDestino: row.ibgeDestino || String(tracking.ibge_destino || '').replace(/\D/g, '').slice(0, 7),
      cidadeOrigem: row.cidadeOrigem || tracking.cidade_origem || '',
      ufOrigem: row.ufOrigem || String(tracking.uf_origem || '').toUpperCase(),
      cidadeDestino: row.cidadeDestino || tracking.cidade_destino || '',
      ufDestino: row.ufDestino || String(tracking.uf_destino || '').toUpperCase(),
    };
  });

  return {
    linhas,
    vinculados,
    semTracking,
    volumesTracking,
    cubagemTracking,
    erroTracking: mapasTracking?.erro || '',
    avisoTracking: mapasTracking?.aviso || '',
  };
}


function normalizarTransportadoraSimulador(nome = '') {
  return String(nome || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function isCpsLogSimulador(nome = '') {
  const texto = normalizarTransportadoraSimulador(nome);
  return texto.includes('CPS LOG') || texto.includes('CPSLOG');
}

function isEbazarSimulador(nome = '') {
  return normalizarTransportadoraSimulador(nome).includes('EBAZAR');
}

function isTomadorPermitidoRealizadoSim(row = {}) {
  const tomador = normalizarTransportadoraSimulador(row.tomador || row.tomadorServico || row.tomador_servico || row.nomeTomador || '');
  if (!tomador) return true;
  return TOMADORES_REALIZADO_PADRAO_SIM.some((permitido) => tomador.includes(normalizarTransportadoraSimulador(permitido)));
}

function aplicarFiltrosPadraoRealizadoSim(rows = [], { incluirCpsLog = false } = {}) {
  return (rows || []).filter((row) => {
    const transportadora = row.transportadora || '';
    const tomador = row.tomador || '';
    if (!isTomadorPermitidoRealizadoSim(row)) return false;
    if (isEbazarSimulador(transportadora) || isEbazarSimulador(tomador)) return false;
    if (!incluirCpsLog && (isCpsLogSimulador(transportadora) || isCpsLogSimulador(tomador))) return false;
    return true;
  });
}

function transportadoraCompativelSimulador(nomeTabela = '', nomeFiltro = '') {
  const tabela = normalizarTransportadoraSimulador(nomeTabela);
  const filtro = normalizarTransportadoraSimulador(nomeFiltro);
  if (!tabela || !filtro) return false;
  if (tabela === filtro) return true;
  // Nomes vindos do CT-e e da tabela raramente são idênticos.
  // Ex.: CPS LOG x CPS LOG TRANSPORTES LTDA.
  // Para o simulador do realizado, aceita correspondência parcial segura.
  return (tabela.length >= 5 && filtro.includes(tabela)) || (filtro.length >= 5 && tabela.includes(filtro));
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
    exemplosCarregadas: [],
    exemplosGanharia: [],
  };
}

function obterMetricaRealizado(mapa, nome) {
  const nomeLimpo = String(nome || 'Sem transportadora').trim() || 'Sem transportadora';
  const chave = normalizarTransportadoraSimulador(nomeLimpo);
  if (!mapa.has(chave)) mapa.set(chave, criarMetricaRealizadoTransportadora(nomeLimpo));
  return mapa.get(chave);
}

function montarExemploSimulacaoOrigem({ row, transportadoraReal, valorCte, vencedor, resultado, itemTabela, tipo = 'carregada' }) {
  const freteMelhor = numeroRealizado(vencedor?.total);
  const freteTabela = numeroRealizado(itemTabela?.total);
  const economiaMelhor = valorCte - freteMelhor;
  return {
    tipo,
    cte: row.numeroCte || row.chaveCte || '',
    data: row.dataEmissao || '',
    origem: row.cidadeOrigem || '',
    ufOrigem: row.ufOrigem || '',
    destino: row.cidadeDestino || vencedor?.cidadeDestino || '',
    ufDestino: row.ufDestino || vencedor?.ufDestino || '',
    transportadoraReal,
    freteRealizado: valorCte,
    vencedor: vencedor?.transportadora || '',
    freteMelhor,
    transportadoraTabela: itemTabela?.transportadora || '',
    freteTabela,
    diferencaPotencial: economiaMelhor,
    savingPositivo: Math.max(economiaMelhor, 0),
    rankingTabela: itemTabela?.ranking || '',
    concorrentes: resultado.length,
    topConcorrentes: resultado.slice(0, 3).map((concorrente) => ({
      transportadora: concorrente.transportadora,
      frete: numeroRealizado(concorrente.total),
      ranking: concorrente.ranking,
    })),
  };
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

  (rows || []).forEach((row) => {
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
      if (Number(item.ranking) === 1) {
        metrica.ctesGanharia += 1;
      }
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

    const exemploCarregada = montarExemploSimulacaoOrigem({
      row,
      transportadoraReal: transportadora,
      valorCte,
      vencedor,
      resultado,
      itemTabela: resultadoReal,
      tipo: 'carregada',
    });
    metricaReal.exemplosCarregadas.push(exemploCarregada);

    const metricaVencedor = obterMetricaRealizado(simulacaoTransportadoraMap, vencedor.transportadora || 'Sem transportadora');
    metricaVencedor.exemplosGanharia.push(montarExemploSimulacaoOrigem({
      row,
      transportadoraReal: transportadora,
      valorCte,
      vencedor,
      resultado,
      itemTabela: vencedor,
      tipo: 'ganharia',
    }));

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
      exemplosCarregadas: [...(item.exemplosCarregadas || [])]
        .sort((a, b) => Math.abs(b.diferencaPotencial) - Math.abs(a.diferencaPotencial))
        .slice(0, 10),
      exemplosGanharia: [...(item.exemplosGanharia || [])]
        .sort((a, b) => Math.abs(b.diferencaPotencial) - Math.abs(a.diferencaPotencial))
        .slice(0, 10),
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

function normalizarChaveSimulador(valor = '') {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s*[/\-]\s*[A-Z]{2}\s*$/i, '')
    .replace(/[^A-Z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function getTipoVeiculo(row) {
  return (
    row?.tipo_veiculo ||
    row?.tipoVeiculo ||
    row?.tipo ||
    row?.veiculo ||
    ''
  ).trim() || 'Não informado';
}

function periodoRealizadoDias(rows = [], inicio = '', fim = '') {
  const datas = rows
    .map((row) => String(row.dataEmissao || '').slice(0, 10))
    .filter(Boolean)
    .sort();
  const dataInicio = inicio || datas[0];
  const dataFim = fim || datas[datas.length - 1];
  if (!dataInicio || !dataFim) return 1;
  const ini = new Date(`${dataInicio}T00:00:00`);
  const end = new Date(`${dataFim}T00:00:00`);
  const dias = Math.round((end - ini) / 86400000) + 1;
  return Math.max(Number.isFinite(dias) ? dias : 1, 1);
}

function periodoRealizadoMeses(rows = [], inicio = '', fim = '') {
  const datas = rows
    .map((row) => String(row.dataEmissao || '').slice(0, 10))
    .filter(Boolean)
    .sort();
  const dataInicio = inicio || datas[0];
  const dataFim = fim || datas[datas.length - 1];
  if (!dataInicio || !dataFim) return 1;
  const ini = new Date(`${dataInicio}T00:00:00`);
  const end = new Date(`${dataFim}T00:00:00`);
  const meses = (end.getFullYear() - ini.getFullYear()) * 12 + (end.getMonth() - ini.getMonth()) + 1;
  return Math.max(Number.isFinite(meses) ? meses : 1, 1);
}

function resolverIbgeRealizadoPorCidade(row = {}, tipo = 'destino', municipioPorCidade) {
  const campoIbge = tipo === 'origem' ? 'ibgeOrigem' : 'ibgeDestino';
  const atual = String(row?.[campoIbge] || '').replace(/\D/g, '').slice(0, 7);
  if (atual) return atual;

  const cidade = tipo === 'origem' ? row.cidadeOrigem : row.cidadeDestino;
  const uf = tipo === 'origem' ? row.ufOrigem : row.ufDestino;
  const cidadeNorm = normalizeBuscaIbge(cidade || '');
  const cidadeUfNorm = normalizeBuscaIbge(`${cidade || ''}/${uf || ''}`);
  const municipio = municipioPorCidade?.get(cidadeUfNorm) || municipioPorCidade?.get(cidadeNorm);
  return municipio?.ibge || '';
}

function criarRouteKeysRealizado(rows = [], canalPadrao = '') {
  const keys = new Set();
  (rows || []).forEach((row) => {
    const origem = String(row.ibgeOrigem || '').replace(/\D/g, '').slice(0, 7);
    const destino = String(row.ibgeDestino || '').replace(/\D/g, '').slice(0, 7);
    if (!origem || !destino) return;
    keys.add(`${row.canal || canalPadrao || ''}|${origem}-${destino}`);
  });
  return [...keys];
}

function mesclarBasesTransportadorasSimulador(bases = []) {
  const mapa = new Map();

  (bases || []).flat().filter(Boolean).forEach((transportadora) => {
    const nome = String(transportadora?.nome || '').trim();
    if (!nome) return;
    const chave = normalizarTransportadoraSimulador(nome);
    const atual = mapa.get(chave) || {
      ...transportadora,
      nome,
      origens: [],
    };

    const origemKeys = new Set((atual.origens || []).map((origem) => {
      const ibge = String(origem?.rotas?.[0]?.ibgeOrigem || origem?.ibgeOrigem || '').replace(/\D/g, '').slice(0, 7);
      return [normalizarChaveSimulador(origem?.cidade), String(origem?.canal || '').toUpperCase(), ibge].join('|');
    }));

    (transportadora.origens || []).forEach((origem) => {
      const ibge = String(origem?.rotas?.[0]?.ibgeOrigem || origem?.ibgeOrigem || '').replace(/\D/g, '').slice(0, 7);
      const chaveOrigem = [normalizarChaveSimulador(origem?.cidade), String(origem?.canal || '').toUpperCase(), ibge].join('|');
      if (!origemKeys.has(chaveOrigem)) {
        atual.origens.push(origem);
        origemKeys.add(chaveOrigem);
      }
    });

    mapa.set(chave, atual);
  });

  return [...mapa.values()].filter((item) => (item.origens || []).length);
}

function valoresUnicosValidos(lista = []) {
  const vistos = new Set();
  const saida = [];
  (lista || []).forEach((item) => {
    const texto = String(item || '').trim();
    const chave = normalizarChaveSimulador(texto);
    if (!texto || !chave || vistos.has(chave)) return;
    vistos.add(chave);
    saida.push(texto);
  });
  return saida;
}

function simularLinhaRealizadoComFallback({ baseOnline = [], row = {}, canal = '', pesoLinha = 0, nf = 0, destino = '', cidadePorIbge, gradeCanal = [], filtros = {} }) {
  const origemLinha = String(row.cidadeOrigem || '').trim();
  const ufOrigem = String(row.ufOrigem || '').trim().toUpperCase();
  const canalLinha = canal || filtros.canal || row.canal || 'ATACADO';

  const origensTentativa = valoresUnicosValidos([
    origemLinha,
    origemLinha && ufOrigem ? `${origemLinha}/${ufOrigem}` : '',
    filtros.origem,
  ]);

  for (const origemTentativa of origensTentativa) {
    const resultado = simularSimples({
      transportadoras: baseOnline,
      origem: origemTentativa,
      canal: canalLinha,
      peso: pesoLinha,
      valorNF: nf,
      cubagem: cubagemRealizado(row),
      destinoCodigo: destino,
      cidadePorIbge,
      gradeCanal,
    }) || [];
    if (resultado.length) return { resultado, origemUsada: origemTentativa, fallback: false };
  }

  // Fallback controlado: quando o CT-e vem com origem escrita diferente da tabela
  // ou sem IBGE de origem, simula pelo destino e depois tenta manter apenas a mesma origem textual.
  const resultadoDestino = simularSimples({
    transportadoras: baseOnline,
    origem: '',
    canal: canalLinha,
    peso: pesoLinha,
    valorNF: nf,
    cubagem: cubagemRealizado(row),
    destinoCodigo: destino,
    cidadePorIbge,
    gradeCanal,
  }) || [];

  if (!resultadoDestino.length) return { resultado: [], origemUsada: origemLinha || filtros.origem || '', fallback: true };

  const origemNorm = normalizarChaveSimulador(origemLinha || filtros.origem || '');
  const resultadoMesmaOrigem = origemNorm
    ? resultadoDestino.filter((item) => normalizarChaveSimulador(item.origem) === origemNorm || normalizarChaveSimulador(item.origem).includes(origemNorm) || origemNorm.includes(normalizarChaveSimulador(item.origem)))
    : resultadoDestino;

  return {
    resultado: resultadoMesmaOrigem.length ? resultadoMesmaOrigem : resultadoDestino,
    origemUsada: origemLinha || filtros.origem || '',
    fallback: true,
  };
}

function criarResumoRotaRealizado(row, itemSelecionada, vencedor, resultado, economiaSelecionadaVsReal, reducaoNecessaria, diferencaVencedor) {
  return {
    origem: row.cidadeOrigem || '',
    ufOrigem: row.ufOrigem || '',
    destino: row.cidadeDestino || '',
    ufDestino: row.ufDestino || '',
    ibgeDestino: row.ibgeDestino || '',
    tipo: getTipoVeiculo(row),
    ctes: 0,
    volumes: 0,
    peso: 0,
    valorNF: 0,
    freteRealizado: 0,
    freteSelecionada: 0,
    freteVencedor: 0,
    savingSelecionada: 0,
    savingTabelaSelecionadaBruto: 0,
    savingVencedor: 0,
    diferencaParaVencedor: 0,
    reducaoNecessariaSoma: 0,
    qtdComSelecionada: 0,
    qtdPerdidasSelecionada: 0,
    qtdGanhasSelecionada: 0,
    qtdSemTabelaSelecionada: 0,
    qtdSemTabelaGeral: 0,
    concorrentesSoma: 0,
    vencedores: new Map(),
    exemploVencedor: vencedor?.transportadora || '',
    exemploRankingSelecionada: itemSelecionada?.ranking || '',
    exemploReducao: reducaoNecessaria,
    exemploDiferenca: diferencaVencedor,
  };
}

function finalizarResumoRotaRealizado(item) {
  const vencedores = [...item.vencedores.entries()]
    .map(([transportadora, qtd]) => ({ transportadora, qtd }))
    .sort((a, b) => b.qtd - a.qtd);

  const mediaReducao = item.qtdPerdidasSelecionada
    ? item.reducaoNecessariaSoma / item.qtdPerdidasSelecionada
    : 0;

  return {
    ...item,
    rota: `${item.origem}${item.ufOrigem ? `/${item.ufOrigem}` : ''} → ${item.destino}${item.ufDestino ? `/${item.ufDestino}` : ''}`,
    percentualFreteRealizado: item.valorNF ? (item.freteRealizado / item.valorNF) * 100 : 0,
    ticketMedioRealizado: item.ctes ? item.freteRealizado / item.ctes : 0,
    ticketMedioSelecionada: item.qtdComSelecionada ? item.freteSelecionada / item.qtdComSelecionada : 0,
    ticketMedioVencedor: item.ctes ? item.freteVencedor / item.ctes : 0,
    percentualFreteSelecionada: item.valorNF ? (item.freteSelecionada / item.valorNF) * 100 : 0,
    percentualFreteVencedor: item.valorNF ? (item.freteVencedor / item.valorNF) * 100 : 0,
    savingTabelaSelecionadaBruto: item.savingTabelaSelecionadaBruto || 0,
    reducaoMediaNecessaria: mediaReducao,
    concorrentesMedio: item.ctes ? item.concorrentesSoma / item.ctes : 0,
    principalVencedor: vencedores[0]?.transportadora || item.exemploVencedor || '-',
    oportunidade: Math.max(item.savingSelecionada, 0) + Math.max(item.diferencaParaVencedor, 0),
    vencedores,
  };
}


function calcularPareto80Volume(rotas = []) {
  const ordenadas = [...(rotas || [])]
    .map((item) => ({ ...item, volumePareto: numeroRealizado(item.volumes) || numeroRealizado(item.ctes) }))
    .filter((item) => item.volumePareto > 0)
    .sort((a, b) => b.volumePareto - a.volumePareto || b.ctes - a.ctes || b.freteRealizado - a.freteRealizado);

  const totalVolume = ordenadas.reduce((acc, item) => acc + item.volumePareto, 0);
  let acumulado = 0;
  const selecionadas = [];
  for (const item of ordenadas) {
    if (acumulado >= totalVolume * 0.8 && selecionadas.length) break;
    acumulado += item.volumePareto;
    selecionadas.push({
      ...item,
      pctVolume: totalVolume ? (item.volumePareto / totalVolume) * 100 : 0,
      pctAcumulado: totalVolume ? (acumulado / totalVolume) * 100 : 0,
    });
  }

  const total = selecionadas.reduce((acc, item) => {
    acc.ctes += numeroRealizado(item.ctes);
    acc.volumes += numeroRealizado(item.volumes);
    acc.peso += numeroRealizado(item.peso);
    acc.valorNF += numeroRealizado(item.valorNF);
    acc.freteRealizado += numeroRealizado(item.freteRealizado);
    acc.freteSelecionada += numeroRealizado(item.freteSelecionada);
    acc.freteVencedor += numeroRealizado(item.freteVencedor);
    acc.savingSelecionada += numeroRealizado(item.savingSelecionada);
    acc.savingTabelaSelecionadaBruto += numeroRealizado(item.savingTabelaSelecionadaBruto);
    acc.savingVencedor += numeroRealizado(item.savingVencedor);
    acc.diferencaParaVencedor += numeroRealizado(item.diferencaParaVencedor);
    acc.perdidas += numeroRealizado(item.qtdPerdidasSelecionada);
    acc.reducaoSoma += numeroRealizado(item.reducaoMediaNecessaria) * numeroRealizado(item.qtdPerdidasSelecionada);
    return acc;
  }, { ctes: 0, volumes: 0, peso: 0, valorNF: 0, freteRealizado: 0, freteSelecionada: 0, freteVencedor: 0, savingSelecionada: 0, savingTabelaSelecionadaBruto: 0, savingVencedor: 0, diferencaParaVencedor: 0, perdidas: 0, reducaoSoma: 0 });

  return {
    rotas: selecionadas,
    totalVolume,
    volumeCoberto: acumulado,
    pctCoberto: totalVolume ? (acumulado / totalVolume) * 100 : 0,
    qtdRotas: selecionadas.length,
    reducaoMediaNecessaria: total.perdidas ? total.reducaoSoma / total.perdidas : 0,
    ...total,
  };
}

function gerarLaudoTextoRealizado(resumo, transportadora) {
  if (!resumo) return [];
  const linhas = [];
  linhas.push(`A transportadora ${transportadora || 'selecionada'} participou da simulação em ${resumo.ctesComTabelaSelecionada} CT-es de ${resumo.ctesAnalisados} analisados.`);
  linhas.push(`Ela ganharia ${resumo.ctesGanhariaSelecionada} CT-es (${formatPercent(resumo.aderenciaSelecionada)}) e perderia ${resumo.ctesPerdidosSelecionada} CT-es para concorrentes mais baratos.`);
  linhas.push(`A projeção de faturamento pela tabela selecionada é ${formatMoney(resumo.faturamentoSelecionadaMes)} por mês e ${formatMoney(resumo.faturamentoSelecionadaAno)} em 12 meses.`);
  linhas.push(`O saving da tabela ganhadora contra o frete realizado é ${formatMoney(resumo.savingSelecionadaVsReal)} no período, considerando somente os CT-es em que a tabela selecionada ficaria em 1º lugar.`);
  linhas.push(`Como referência de mercado, o melhor preço entre todas as tabelas geraria ${formatMoney(resumo.savingVencedorVsReal)} de saving potencial no mesmo recorte.`);
  linhas.push(`Nas rotas perdidas, a redução média necessária para virar ganhadora é de ${formatPercent(resumo.reducaoMediaNecessaria)}.`);
  return linhas;
}

function simularRealizadoComTabela({ rows = [], baseOnline = [], transportadoraSelecionada = '', filtros = {}, cidadePorIbge, gradePorCanal = {}, municipioPorCidade }) {
  const nomeSelecionadoNorm = normalizarTransportadoraSimulador(transportadoraSelecionada);
  const rotasMap = new Map();
  const transportadorasMap = new Map();
  const ctesDetalhes = [];
  const dias = periodoRealizadoDias(rows, filtros.inicio, filtros.fim);
  const meses = periodoRealizadoMeses(rows, filtros.inicio, filtros.fim);

  let ctesAnalisados = 0;
  let ctesSimulados = 0;
  let ctesComTabelaSelecionada = 0;
  let ctesGanhariaSelecionada = 0;
  let ctesPerdidosSelecionada = 0;
  let ctesSemTabelaSelecionada = 0;
  let ctesSemTabelaGeral = 0;
  let freteRealizado = 0;
  let freteRealizadoComTabelaSelecionada = 0;
  let freteSelecionada = 0;
  let freteVencedor = 0;
  let valorNF = 0;
  let peso = 0;
  let volumes = 0;
  let cubagemTotal = 0;
  let linhasComTracking = 0;
  let savingSelecionadaVsReal = 0;
  let savingTabelaSelecionadaVsRealBruto = 0;
  let savingVencedorVsReal = 0;
  let freteRealizadoGanhariaSelecionada = 0;
  let freteSelecionadaGanhadora = 0;
  let valorNFGanhariaSelecionada = 0;
  let diferencaSelecionadaVsVencedor = 0;
  let reducaoNecessariaSoma = 0;
  const diagnostico = {
    linhasSemIbgeDestino: 0,
    linhasSemResultado: 0,
    canaisUsados: new Map(),
    origensUsadas: new Map(),
    destinosSemResultado: new Map(),
  };

  (rows || []).forEach((row) => {
    ctesAnalisados += 1;
    const valorCte = numeroRealizado(row.valorCte);
    const nf = numeroRealizado(row.valorNF);
    const pesoLinha = pesoRealizado(row);
    const vol = numeroRealizado(row.qtdVolumes);
    const cubagemLinha = cubagemRealizado(row);
    if (row.trackingMatch) linhasComTracking += 1;
    cubagemTotal += cubagemLinha;
    const origem = row.cidadeOrigem || filtros.origem || '';
    const canal = filtros.canal || row.canal || 'ATACADO';
    const canalDiag = String(canal || 'SEM CANAL').toUpperCase();
    diagnostico.canaisUsados.set(canalDiag, (diagnostico.canaisUsados.get(canalDiag) || 0) + 1);
    const origemDiag = String(origem || 'SEM ORIGEM').trim();
    diagnostico.origensUsadas.set(origemDiag, (diagnostico.origensUsadas.get(origemDiag) || 0) + 1);
    let destino = String(row.ibgeDestino || '').trim();

    if (!destino && municipioPorCidade) {
      const cidadeNorm = normalizeBuscaIbge(row.cidadeDestino || '');
      const cidadeUfNorm = normalizeBuscaIbge(`${row.cidadeDestino || ''}/${row.ufDestino || ''}`);
      const municipio = municipioPorCidade.get(cidadeUfNorm) || municipioPorCidade.get(cidadeNorm);
      destino = municipio?.ibge || '';
    }

    freteRealizado += valorCte;
    valorNF += nf;
    peso += pesoLinha;
    volumes += vol;

    const chaveTransportadoraReal = normalizarChaveSimulador(row.transportadora || 'Sem transportadora');
    if (!transportadorasMap.has(chaveTransportadoraReal)) {
      transportadorasMap.set(chaveTransportadoraReal, {
        transportadora: row.transportadora || 'Sem transportadora',
        ctes: 0,
        frete: 0,
        valorNF: 0,
        peso: 0,
        volumes: 0,
      });
    }
    const metricaReal = transportadorasMap.get(chaveTransportadoraReal);
    metricaReal.ctes += 1;
    metricaReal.frete += valorCte;
    metricaReal.valorNF += nf;
    metricaReal.peso += pesoLinha;
    metricaReal.volumes += vol;

    if (!destino) {
      diagnostico.linhasSemIbgeDestino += 1;
      ctesSemTabelaGeral += 1;
      return;
    }

    const gradeCanal = gradePorCanal[canal] || gradePorCanal.ATACADO || [];
    const { resultado, origemUsada, fallback } = simularLinhaRealizadoComFallback({
      baseOnline,
      row,
      canal,
      pesoLinha,
      nf,
      destino,
      cidadePorIbge,
      gradeCanal,
      filtros,
    });

    const vencedor = resultado[0] || null;
    if (!vencedor) {
      diagnostico.linhasSemResultado += 1;
      const destinoLabelDiag = `${row.cidadeDestino || ''}/${row.ufDestino || ''} ${destino}`.trim();
      diagnostico.destinosSemResultado.set(destinoLabelDiag, (diagnostico.destinosSemResultado.get(destinoLabelDiag) || 0) + 1);
      ctesSemTabelaGeral += 1;
      return;
    }

    ctesSimulados += 1;
    const itemSelecionada = resultado.find((item) => transportadoraCompativelSimulador(item.transportadora, transportadoraSelecionada) || normalizarTransportadoraSimulador(item.transportadora) === nomeSelecionadoNorm) || null;
    const freteVenc = numeroRealizado(vencedor.total);
    freteVencedor += freteVenc;
    savingVencedorVsReal += Math.max(valorCte - freteVenc, 0);

    let freteSel = 0;
    let economiaSelecionadaVsReal = 0;
    let economiaTabelaSelecionadaVsRealBruto = 0;
    let diferencaVencedor = 0;
    let reducaoNecessaria = 0;
    let statusSelecionada = 'Sem tabela';

    if (itemSelecionada) {
      ctesComTabelaSelecionada += 1;
      freteSel = numeroRealizado(itemSelecionada.total);
      freteSelecionada += freteSel;
      freteRealizadoComTabelaSelecionada += valorCte;
      economiaTabelaSelecionadaVsRealBruto = Math.max(valorCte - freteSel, 0);
      savingTabelaSelecionadaVsRealBruto += economiaTabelaSelecionadaVsRealBruto;

      if (Number(itemSelecionada.ranking) === 1) {
        ctesGanhariaSelecionada += 1;
        statusSelecionada = 'Ganharia';
        economiaSelecionadaVsReal = economiaTabelaSelecionadaVsRealBruto;
        savingSelecionadaVsReal += economiaSelecionadaVsReal;
        freteRealizadoGanhariaSelecionada += valorCte;
        freteSelecionadaGanhadora += freteSel;
        valorNFGanhariaSelecionada += nf;
      } else {
        ctesPerdidosSelecionada += 1;
        statusSelecionada = 'Perderia';
        diferencaVencedor = Math.max(freteSel - freteVenc, 0);
        diferencaSelecionadaVsVencedor += diferencaVencedor;
        reducaoNecessaria = freteSel ? (diferencaVencedor / freteSel) * 100 : 0;
        reducaoNecessariaSoma += reducaoNecessaria;
      }
    } else {
      ctesSemTabelaSelecionada += 1;
    }

    const origemResumo = origemUsada || origem;
    const chaveRota = [origemResumo, row.ufOrigem, row.cidadeDestino, row.ufDestino, getTipoVeiculo(row)].map(normalizarChaveSimulador).join('|');
    const rota = rotasMap.get(chaveRota) || criarResumoRotaRealizado(row, itemSelecionada, vencedor, resultado, economiaSelecionadaVsReal, reducaoNecessaria, diferencaVencedor);
    rota.ctes += 1;
    rota.volumes += vol;
    rota.peso += pesoLinha;
    rota.valorNF += nf;
    rota.freteRealizado += valorCte;
    rota.freteSelecionada += freteSel;
    rota.freteVencedor += freteVenc;
    rota.savingSelecionada += economiaSelecionadaVsReal;
    rota.savingTabelaSelecionadaBruto += economiaTabelaSelecionadaVsRealBruto;
    rota.savingVencedor += Math.max(valorCte - freteVenc, 0);
    rota.diferencaParaVencedor += diferencaVencedor;
    rota.concorrentesSoma += resultado.length;

    if (itemSelecionada) {
      rota.qtdComSelecionada += 1;
      if (Number(itemSelecionada.ranking) === 1) rota.qtdGanhasSelecionada += 1;
      else rota.qtdPerdidasSelecionada += 1;
    } else {
      rota.qtdSemTabelaSelecionada += 1;
    }

    if (!resultado.length) rota.qtdSemTabelaGeral += 1;
    if (reducaoNecessaria) rota.reducaoNecessariaSoma += reducaoNecessaria;
    const vencedorNome = vencedor?.transportadora || 'Sem vencedor';
    rota.vencedores.set(vencedorNome, (rota.vencedores.get(vencedorNome) || 0) + 1);
    rotasMap.set(chaveRota, rota);

    ctesDetalhes.push({
      cte: row.numeroCte || row.chaveCte || '',
      data: row.dataEmissao || '',
      origem: origemResumo,
      ufOrigem: row.ufOrigem || '',
      destino: row.cidadeDestino || vencedor?.cidadeDestino || '',
      ufDestino: row.ufDestino || vencedor?.ufDestino || '',
      canal,
      transportadoraReal: row.transportadora || '',
      freteRealizado: valorCte,
      freteSelecionada: freteSel,
      vencedor: vencedor?.transportadora || '',
      freteVencedor: freteVenc,
      volumes: vol,
      peso: pesoLinha,
      cubagem: cubagemLinha,
      valorNF: nf,
      percentualFreteRealizado: nf ? (valorCte / nf) * 100 : 0,
      percentualFreteSelecionada: nf && freteSel ? (freteSel / nf) * 100 : 0,
      percentualFreteVencedor: nf && freteVenc ? (freteVenc / nf) * 100 : 0,
      variacaoPctFreteSelecionada: nf && valorCte && freteSel ? (((freteSel / nf) / (valorCte / nf)) - 1) * 100 : 0,
      savingTabelaSelecionadaBruto: economiaTabelaSelecionadaVsRealBruto,
      savingVencedor: Math.max(valorCte - freteVenc, 0),
      trackingMatch: Boolean(row.trackingMatch),
      chaveNfe: row.chaveNfe || '',
      statusSelecionada,
      rankingSelecionada: itemSelecionada?.ranking || '',
      reducaoNecessaria,
      savingSelecionada: economiaSelecionadaVsReal,
      diferencaParaVencedor: diferencaVencedor,
      concorrentes: resultado.length,
      origemUsada,
      fallbackOrigem: fallback,
      // Detalhes completos do cálculo para auditoria
      vencedorDetalhes: vencedor?.detalhes || null,
      selecionadaDetalhes: itemSelecionada?.detalhes || null,
      ganhouRealizado: freteSel > 0 && valorCte > 0 && freteSel < valorCte,
      todosResultados: resultado.slice(0, 8).map((r) => ({
        transportadora: r.transportadora,
        total: r.total,
        ranking: r.ranking,
        origem: r.origem,
        detalhes: r.detalhes || null,
      })),
    });
  });

  const rotas = [...rotasMap.values()]
    .map(finalizarResumoRotaRealizado)
    .sort((a, b) => b.oportunidade - a.oportunidade || b.ctes - a.ctes || b.freteRealizado - a.freteRealizado);

  const porTransportadoraReal = [...transportadorasMap.values()]
    .map((item) => ({
      ...item,
      pctCtes: ctesAnalisados ? (item.ctes / ctesAnalisados) * 100 : 0,
      pctFrete: freteRealizado ? (item.frete / freteRealizado) * 100 : 0,
      percentualFrete: item.valorNF ? (item.frete / item.valorNF) * 100 : 0,
    }))
    .sort((a, b) => b.frete - a.frete || b.ctes - a.ctes);

  const reducaoMediaNecessaria = ctesPerdidosSelecionada ? reducaoNecessariaSoma / ctesPerdidosSelecionada : 0;
  const aderenciaSelecionada = ctesComTabelaSelecionada ? (ctesGanhariaSelecionada / ctesComTabelaSelecionada) * 100 : 0;
  const faturamentoSelecionadaMes = meses ? freteSelecionada / meses : freteSelecionada;
  const faturamentoSelecionadaAno = faturamentoSelecionadaMes * 12;
  const savingSelecionadaVsRealMes = meses ? savingSelecionadaVsReal / meses : savingSelecionadaVsReal;
  const savingSelecionadaVsRealAno = savingSelecionadaVsRealMes * 12;
  const pareto80Volume = calcularPareto80Volume(rotas);
  const freteRealizadoMes = meses ? freteRealizado / meses : freteRealizado;
  const freteRealizadoAno = freteRealizadoMes * 12;

  const resumo = {
    ctesAnalisados,
    ctesSimulados,
    ctesComTabelaSelecionada,
    ctesGanhariaSelecionada,
    ctesPerdidosSelecionada,
    ctesSemTabelaSelecionada,
    ctesSemTabelaGeral,
    freteRealizado,
    freteRealizadoComTabelaSelecionada,
    freteSelecionada,
    freteVencedor,
    valorNF,
    peso,
    volumes,
    cubagemTotal,
    linhasComTracking,
    dias,
    meses,
    cargasDia: ctesAnalisados / dias,
    volumesDia: volumes / dias,
    freteRealizadoMes,
    freteRealizadoAno,
    faturamentoSelecionadaMes,
    faturamentoSelecionadaAno,
    savingSelecionadaVsReal,
    savingSelecionadaVsRealMes,
    savingSelecionadaVsRealAno,
    savingTabelaSelecionadaVsRealBruto,
    savingVencedorVsReal,
    freteRealizadoGanhariaSelecionada,
    freteSelecionadaGanhadora,
    valorNFGanhariaSelecionada,
    diferencaSelecionadaVsVencedor,
    reducaoMediaNecessaria,
    aderenciaSelecionada,
    percentualFreteRealizado: valorNF ? (freteRealizado / valorNF) * 100 : 0,
    percentualFreteRealizadoGanharia: valorNFGanhariaSelecionada ? (freteRealizadoGanhariaSelecionada / valorNFGanhariaSelecionada) * 100 : 0,
    percentualFreteTabelaGanharia: valorNFGanhariaSelecionada ? (freteSelecionadaGanhadora / valorNFGanhariaSelecionada) * 100 : 0,
    variacaoPercentualFreteGanharia: freteRealizadoGanhariaSelecionada && valorNFGanhariaSelecionada ? (((freteSelecionadaGanhadora / valorNFGanhariaSelecionada) / (freteRealizadoGanhariaSelecionada / valorNFGanhariaSelecionada)) - 1) * 100 : 0,
    percentualSavingSelecionada: freteRealizadoGanhariaSelecionada ? (savingSelecionadaVsReal / freteRealizadoGanhariaSelecionada) * 100 : 0,
    percentualSavingSelecionadaBruto: freteRealizadoComTabelaSelecionada ? (savingTabelaSelecionadaVsRealBruto / freteRealizadoComTabelaSelecionada) * 100 : 0,
    percentualSavingVencedor: freteRealizado ? (savingVencedorVsReal / freteRealizado) * 100 : 0,
    rotas,
    porTransportadoraReal,
    pareto80Volume,
    ctesDetalhes: ctesDetalhes.sort((a, b) => b.savingSelecionada - a.savingSelecionada || b.diferencaParaVencedor - a.diferencaParaVencedor).slice(0, 1000),
    diagnostico: {
      linhasSemIbgeDestino: diagnostico.linhasSemIbgeDestino,
      linhasSemResultado: diagnostico.linhasSemResultado,
      canaisUsados: [...diagnostico.canaisUsados.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      origensUsadas: [...diagnostico.origensUsadas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
      destinosSemResultado: [...diagnostico.destinosSemResultado.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
    },
  };

  return {
    ...resumo,
    laudo: gerarLaudoTextoRealizado(resumo, transportadoraSelecionada),
  };
}

function statusCombinadoCte(item) {
  const ganhaTabelas = item.statusSelecionada === 'Ganharia';
  const ganhaRealizado = item.ganhouRealizado === true || (item.freteSelecionada > 0 && item.freteRealizado > 0 && item.freteSelecionada < item.freteRealizado);
  const semTabela = !item.freteSelecionada || item.statusSelecionada === 'Sem tabela';
  if (semTabela) return { label: 'Sem tabela', bg: '#f1f5f9', color: '#64748b', icon: '—' };
  if (ganhaTabelas && ganhaRealizado) return { label: 'Ganha tudo', bg: '#dcfce7', color: '#15803d', icon: '✅' };
  if (ganhaTabelas && !ganhaRealizado) return { label: 'Ganha concorrência', bg: '#dbeafe', color: '#1d4ed8', icon: '🏆' };
  if (!ganhaTabelas && ganhaRealizado) return { label: 'Ganha realizado', bg: '#fef3c7', color: '#b45309', icon: '💰' };
  return { label: 'Perde tudo', bg: '#fee2e2', color: '#dc2626', icon: '❌' };
}

export default function SimuladorPage({ transportadoras = [] }) {
  const [aba, setAba] = useState('simples');
  const [grade, setGrade] = useState(getGradeInicial());
  const [gradeFonte, setGradeFonte] = useState('local');
  const [gradeStatus, setGradeStatus] = useState('Grade carregada do navegador.');
  const [salvandoGrade, setSalvandoGrade] = useState(false);
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
  const [negociacoesSimulador, setNegociacoesSimulador] = useState([]);
  const [carregandoNegociacoesSimulador, setCarregandoNegociacoesSimulador] = useState(false);
  const [erroNegociacoesSimulador, setErroNegociacoesSimulador] = useState('');
  const [incluirNegociacoesRealizado, setIncluirNegociacoesRealizado] = useState(false);
  const [compararConcorrentesRealizado, setCompararConcorrentesRealizado] = useState(false);
  const [incluirCpsLogRealizado, setIncluirCpsLogRealizado] = useState(false);
  const [baseRealizadoTracking, setBaseRealizadoTracking] = useState('com_tracking'); // 'com_tracking' | 'todos'
  const [salvandoResultadoNegociacao, setSalvandoResultadoNegociacao] = useState(false);
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
  const [buscarOrigemOrigem, setBuscarOrigemOrigem] = useState('');
  const [ufDestinoOrigem, setUfDestinoOrigem] = useState('');
  const [inicioOrigem, setInicioOrigem] = useState('');
  const [fimOrigem, setFimOrigem] = useState('');
  const [usarRealizadoOrigem, setUsarRealizadoOrigem] = useState(true);
  const [resultadoOrigem, setResultadoOrigem] = useState(null);
  const [detalheOrigemAberto, setDetalheOrigemAberto] = useState('');

  const [transportadoraRealizado, setTransportadoraRealizado] = useState('');
  const [canalRealizado, setCanalRealizado] = useState(canais[0] || 'ATACADO');
  const [modoRealizado, setModoRealizado] = useState('malha');
  const [origemRealizado, setOrigemRealizado] = useState('');
  const [destinoRealizado, setDestinoRealizado] = useState('');
  const [ufOrigemRealizado, setUfOrigemRealizado] = useState('');
  const [ufDestinoRealizado, setUfDestinoRealizado] = useState('');
  const [inicioRealizado, setInicioRealizado] = useState('');
  const [fimRealizado, setFimRealizado] = useState('');
  const [limiteRealizado, setLimiteRealizado] = useState(10000);
  const [resultadoRealizado, setResultadoRealizado] = useState(null);
  const [filtroDetalhe, setFiltroDetalhe] = useState('');
  const [paginaDetalhe, setPaginaDetalhe] = useState(0);
  const DETALHE_POR_PAGINA = 50;
  const [linhasExpandidas, setLinhasExpandidas] = useState(new Set());
  const [abaDetalheRealizado, setAbaDetalheRealizado] = useState('ctes'); // 'ctes' | 'uf'
  const [secoesFechadas, setSecoesFechadas] = useState(new Set(['laudo', 'transp-realizado', 'rotas-perda-box']));
  const toggleSecao = (id) => setSecoesFechadas((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const secaoAberta = (id) => !secoesFechadas.has(id);

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


  const carregarNegociacoesSimulador = async () => {
    setCarregandoNegociacoesSimulador(true);
    setErroNegociacoesSimulador('');

    try {
      const dados = await buscarTabelasNegociacaoParaSimulacao({ tipoTabela: 'FRACIONADO' });
      setNegociacoesSimulador(dados || []);
      return dados || [];
    } catch (error) {
      setErroNegociacoesSimulador(error.message || 'Erro ao carregar tabelas em negociação para simulação.');
      setNegociacoesSimulador([]);
      return [];
    } finally {
      setCarregandoNegociacoesSimulador(false);
    }
  };

  useEffect(() => {
    atualizarOpcoesSimulador();
  }, []);

  // Não carregue negociações automaticamente ao abrir o simulador.
  // Algumas negociações possuem milhares de itens e isso deixava a tela pesada
  // mesmo quando o usuário queria simular apenas a tabela selecionada vs realizado.
  // Use o botão "Atualizar negociações" ou marque a opção de incluir negociações.

  useEffect(() => {
    if (aba === 'realizado' && incluirNegociacoesRealizado && !negociacoesSimulador.length && !carregandoNegociacoesSimulador) {
      carregarNegociacoesSimulador();
    }
  }, [aba, incluirNegociacoesRealizado]);

  useEffect(() => {
    let ativo = true;
    async function carregarGradeCentral() {
      const resultado = await carregarGradeFreteCentralizada();
      if (!ativo) return;
      setGrade(resultado.grade);
      setGradeFonte(resultado.fonte || 'local');
      setGradeStatus(resultado.mensagem || 'Grade carregada.');
    }
    carregarGradeCentral();
    return () => { ativo = false; };
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
      if (Array.isArray(base) && base.length) return base;

      // Fallback para evitar cenário zero por divergência de canal/origem digitada
      // Ex.: origem digitada sem acento ou canal salvo como B2B em vez de ATACADO.
      if (filtros?.origem || filtros?.canal) {
        const fallbackSemCanal = await executarComTimeout(buscarBaseSimulacaoDb({ ...filtros, canal: '' }), 120000);
        if (Array.isArray(fallbackSemCanal) && fallbackSemCanal.length) return fallbackSemCanal;
      }

      return [];
    } catch (error) {
      setErroSimulacao(error.message || 'Erro ao buscar base online do Supabase.');
      return [];
    } finally {
      setCarregandoSimulacao(false);
    }
  };

  const carregarMapaVinculosSimulador = async () => {
    try {
      const vinculos = await carregarVinculosTransportadoras();
      return criarMapaVinculosTransportadoras(vinculos);
    } catch (err) {
      try {
        const locais = JSON.parse(localStorage.getItem('vinculos-transportadoras') || '[]');
        return criarMapaVinculosTransportadoras(Array.isArray(locais) ? locais : []);
      } catch {
        return new Map();
      }
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
    if (!canalRealizado && canais[0]) setCanalRealizado(canais[0]);
  }, [canalSimples, canalTransportadora, canalAnalise, canalCobertura, canalOrigem, canalRealizado, canais]);

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

  const transportadorasNegociacaoRealizado = useMemo(
    () => converterTabelasNegociacaoParaSimulador(negociacoesSimulador, { canal: canalRealizado }),
    [negociacoesSimulador, canalRealizado]
  );

  const nomesNegociacaoRealizado = useMemo(
    () => transportadorasNegociacaoRealizado.map((item) => item.nome).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [transportadorasNegociacaoRealizado]
  );

  const transportadorasPorCanalRealizado = useMemo(() => {
    const oficiais = filtrarTransportadorasPorCanal(todasTransportadorasDisponiveis, canalRealizado, opcoesOnline, transportadoras);

    return [...new Set([...(oficiais || []), ...nomesNegociacaoRealizado])]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [todasTransportadorasDisponiveis, canalRealizado, opcoesOnline, transportadoras, nomesNegociacaoRealizado]);

  const negociacaoSelecionadaRealizado = useMemo(
    () => negociacoesSimulador.find((tabela) => labelTabelaNegociacaoSimulador(tabela) === transportadoraRealizado) || null,
    [negociacoesSimulador, transportadoraRealizado]
  );

  const salvarResultadoNegociacaoRealizado = async () => {
    if (!negociacaoSelecionadaRealizado?.id || !resultadoRealizado) return;

    setSalvandoResultadoNegociacao(true);
    setErroSimulacao('');

    try {
      await salvarResultadoSimulacaoNegociacao(negociacaoSelecionadaRealizado.id, resultadoRealizado);
      alert('Resultado projetado salvo na negociação.');
    } catch (error) {
      setErroSimulacao(error.message || 'Erro ao salvar resultado na negociação.');
    } finally {
      setSalvandoResultadoNegociacao(false);
    }
  };

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

  const origensRealizadoDisponiveis = useMemo(() => {
    const porTransportadora = opcoesOnline.origensPorTransportadora?.[transportadoraRealizado];
    if (porTransportadora?.length) return porTransportadora;

    const porCanal = opcoesOnline.origensPorCanal?.[canalRealizado];
    if (porCanal?.length) return porCanal;

    const selecionada = transportadoras.find((item) => item.nome === transportadoraRealizado);
    if (selecionada) {
      return [...new Set((selecionada.origens || [])
        .filter((origem) => !canalRealizado || (origem.canal || 'ATACADO') === canalRealizado)
        .map((origem) => origem.cidade)
        .filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    }

    return todasOrigens;
  }, [opcoesOnline.origensPorTransportadora, opcoesOnline.origensPorCanal, transportadoraRealizado, canalRealizado, transportadoras, todasOrigens]);

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

  useEffect(() => {
    if (transportadoraRealizado && transportadorasPorCanalRealizado.length && !transportadorasPorCanalRealizado.includes(transportadoraRealizado)) {
      setTransportadoraRealizado('');
      setOrigemRealizado('');
    }
  }, [transportadorasPorCanalRealizado, transportadoraRealizado]);


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
  const onAnalisarCobertura = async () => {
    iniciarProcessamentoUi('Cobertura de tabela', 'Buscando base online no Supabase...', 15);
    try {
      const baseOnline = await carregarBaseOnline({
        canal: canalCobertura,
        origem: origemCobertura,
      });
      const base = baseOnline.length ? baseOnline : transportadoras;
      setResultadoCobertura(analisarCoberturaTabela({
        transportadoras: base,
        canal: canalCobertura,
        origem: origemCobertura,
        transportadora: transportadoraCobertura,
        ufDestino: ufCobertura,
        cidadePorIbge: cidadePorIbgeCompleto,
      }));
      finalizarProcessamentoUi('Cobertura analisada', 'Resultado carregado.', 100);
    } catch (error) {
      setErroSimulacao(error.message || 'Erro ao analisar cobertura.');
      finalizarProcessamentoUi('Erro', 'Não foi possível analisar a cobertura.', 100);
    }
  };
  const exportarCobertura = () => {
    if (!resultadoCobertura?.faltantes?.length) return;
    const { nomeArquivo, csv } = exportarLinhasCsv('cobertura-faltantes.csv', [
      ['Origem', 'UF Destino', 'Cidade Destino', 'IBGE Destino', 'Status'],
      ...resultadoCobertura.faltantes.map((item) => [item.origem, item.uf, item.cidade || '', item.ibge, 'Sem tabela']),
    ]);
    downloadCsv(nomeArquivo, csv);
  };

  const onSimularRealizado = async () => {
    if (!transportadoraRealizado) {
      setErroSimulacao('Selecione a transportadora/tabela que será simulada no realizado.');
      return;
    }

    if (!inicioRealizado && !fimRealizado && !origemRealizado && !ufDestinoRealizado && modoRealizado !== 'malha') {
      setErroSimulacao('Informe pelo menos período, origem ou UF destino para evitar uma busca muito ampla no realizado.');
      return;
    }

    setFiltroDetalhe('');
    setPaginaDetalhe(0);
    setLinhasExpandidas(new Set());
    iniciarProcessamentoUi('Simulador do realizado', 'Carregando vínculos, CT-es e tabelas...', 8);

    try {
      atualizarProcessamentoUi('Carregando vínculos de transportadoras...', 14);
      const mapaVinculos = await carregarMapaVinculosSimulador();
      const ehNegociacaoSelecionada = nomesNegociacaoRealizado.includes(transportadoraRealizado);
      const nomeTabelaSelecionada = ehNegociacaoSelecionada
        ? transportadoraRealizado
        : mapaVinculos.get(normalizarChaveSimulador(transportadoraRealizado))
          || mapaVinculos.get(String(transportadoraRealizado || '').toUpperCase())
          || transportadoraRealizado;

      atualizarProcessamentoUi('Buscando CT-es realizados — página 1...', 24);
      const rowsBrutos = await buscarRealizadoLocalCtes({
        canal: canalRealizado,
        origem: origemRealizado,
        destino: destinoRealizado,
        ufOrigem: ufOrigemRealizado,
        ufDestino: ufDestinoRealizado,
        inicio: inicioRealizado,
        fim: fimRealizado,
        limit: limiteRealizado,
      }, (qtd) => {
        atualizarProcessamentoUi(`Buscando CT-es realizados... ${qtd.toLocaleString('pt-BR')} carregados`, Math.min(38, 24 + Math.floor(qtd / 500)));
      });

      const rowsBrutosFiltrados = aplicarFiltrosPadraoRealizadoSim(rowsBrutos, {
        // Quando a base é somente CT-es com Tracking, CPS LOG não deve ser excluído por nome.
        // Se CPS LOG tiver vínculo real no Tracking, significa que faz parte da operação analisada.
        incluirCpsLog: baseRealizadoTracking === 'com_tracking' ? true : incluirCpsLogRealizado,
      });

      atualizarProcessamentoUi('Resolvendo IBGE dos CT-es e aplicando vínculos...', 36);
      const rowsComIbgeBase = rowsBrutosFiltrados.map((row) => {
        const ibgeDestino = resolverIbgeRealizadoPorCidade(row, 'destino', municipioPorCidade);
        const ibgeOrigem = resolverIbgeRealizadoPorCidade(row, 'origem', municipioPorCidade);
        const nomeOriginal = String(row.transportadora || '').trim();
        const nomeVinculado = mapaVinculos.get(normalizarChaveSimulador(nomeOriginal)) || mapaVinculos.get(nomeOriginal.toUpperCase()) || nomeOriginal;
        return { ...row, ibgeOrigem, ibgeDestino, transportadora: nomeVinculado };
      });

      atualizarProcessamentoUi('Cruzando CT-es com Tracking no Supabase para volumes e cubagem...', 42);
      const mapasTracking = await buscarTrackingParaRealizado(rowsComIbgeBase);
      const trackingEnriquecido = enriquecerRealizadoComTracking(rowsComIbgeBase, mapasTracking);

      const rowsComTracking = (trackingEnriquecido.linhas || []).filter((row) => row.trackingMatch);
      const rowsComIbge = baseRealizadoTracking === 'com_tracking'
        ? rowsComTracking
        : trackingEnriquecido.linhas;

      if (baseRealizadoTracking === 'com_tracking' && !rowsComIbge.length) {
        setErroSimulacao('Nenhum CT-e encontrou vínculo com o Tracking nos filtros informados. Revise período, origem, UF ou a carga do Tracking.');
        setResultadoRealizado(null);
        finalizarProcessamentoUi('Sem CT-es com Tracking', 'A base foi carregada, mas nenhum CT-e teve vínculo com Tracking.', 100);
        return;
      }

      atualizarProcessamentoUi('Buscando malha da transportadora/tabela selecionada...', 46);
      const baseSelecionada = ehNegociacaoSelecionada
        ? transportadorasNegociacaoRealizado.filter((item) =>
            normalizarTransportadoraSimulador(item.nome) === normalizarTransportadoraSimulador(nomeTabelaSelecionada)
            || transportadoraCompativelSimulador(item.nome, nomeTabelaSelecionada)
          )
        : await carregarBaseOnline({
            nomeTransportadora: nomeTabelaSelecionada,
            canal: canalRealizado,
            origem: modoRealizado === 'filtros' ? origemRealizado : '',
            ufDestino: ufDestinoRealizado,
          });

      const origensMalha = new Set(
        baseSelecionada
          .flatMap((t) => (t.origens || []).map((o) => normalizarChaveSimulador(o.cidade)))
          .filter(Boolean)
      );

      // Diagnóstico de normalização da malha
      const origemMalhaNaoReconhecida = new Set();
      const rowsFiltrados = modoRealizado === 'malha' && origensMalha.size
        ? rowsComIbge.filter((row) => {
            const origemNorm = normalizarChaveSimulador(row.cidadeOrigem);
            const ok = origensMalha.has(origemNorm);
            if (!ok && row.cidadeOrigem) origemMalhaNaoReconhecida.add(row.cidadeOrigem);
            return ok;
          })
        : rowsComIbge;

      const routeKeysRealizado = criarRouteKeysRealizado(rowsFiltrados, canalRealizado);
      const deveCompararConcorrentes = Boolean(compararConcorrentesRealizado);
      const basesParaMesclar = [baseSelecionada].filter((base) => Array.isArray(base) ? base.length : Boolean(base));

      // Só adiciona negociações como concorrentes quando os dois flags estiverem marcados.
      // Com "Comparar com tabelas oficiais/concorrentes" desmarcado, a simulação fica leve:
      // tabela selecionada x CT-es realizados.
      if (deveCompararConcorrentes && incluirNegociacoesRealizado && transportadorasNegociacaoRealizado.length) {
        basesParaMesclar.push(transportadorasNegociacaoRealizado);
      }
      let baseRotas = [];

      if (deveCompararConcorrentes && routeKeysRealizado.length) {
        atualizarProcessamentoUi(`Buscando concorrentes por ${routeKeysRealizado.length.toLocaleString('pt-BR')} rota(s) reais...`, 58);
        baseRotas = await buscarBaseSimulacaoPorRotasDb({
          routeKeys: routeKeysRealizado.slice(0, 5000),
          canal: canalRealizado,
        });
        if (Array.isArray(baseRotas) && baseRotas.length) basesParaMesclar.push(baseRotas);
      }

      // Fallback principal: usa o mesmo caminho que já funcionou na Análise por Origem.
      // Isso evita zerar quando o CT-e não possui IBGE de origem ou quando a busca por rota exata não acha concorrentes.
      const origensParaBuscar = valoresUnicosValidos([
        origemRealizado,
        ...rowsFiltrados.map((row) => row.cidadeOrigem),
        ...baseSelecionada.flatMap((t) => (t.origens || []).map((o) => o.cidade)),
      ]).slice(0, 20);

      let basesOrigemCarregadas = 0;
      if (deveCompararConcorrentes) {
        for (let idx = 0; idx < origensParaBuscar.length; idx += 1) {
          const origemBusca = origensParaBuscar[idx];
          atualizarProcessamentoUi(`Buscando tabelas concorrentes da origem ${origemBusca}...`, Math.min(72, 60 + idx));
          const baseOrigem = await carregarBaseOnline({
            canal: canalRealizado,
            origem: origemBusca,
            ufDestino: ufDestinoRealizado,
          });
          if (Array.isArray(baseOrigem) && baseOrigem.length) {
            basesOrigemCarregadas += baseOrigem.length;
            basesParaMesclar.push(baseOrigem);
          }
        }
      } else {
        atualizarProcessamentoUi('Simulando somente a negociação selecionada contra o realizado...', 72);
      }

      let baseParaSimulacao = mesclarBasesTransportadorasSimulador(basesParaMesclar);

      if (!baseParaSimulacao.length) {
        setErroSimulacao('Não encontrei nenhuma tabela compatível para simular. Confira se as tabelas estão no Supabase e se a origem/canal existem no cadastro.');
        setResultadoRealizado(simularRealizadoComTabela({
          rows: rowsFiltrados,
          baseOnline: [],
          transportadoraSelecionada: nomeTabelaSelecionada,
          filtros: {
            canal: canalRealizado,
            origem: origemRealizado,
            destino: destinoRealizado,
            ufOrigem: ufOrigemRealizado,
            ufDestino: ufDestinoRealizado,
            inicio: inicioRealizado,
            fim: fimRealizado,
            modo: modoRealizado,
          },
          cidadePorIbge: cidadePorIbgeCompleto,
          gradePorCanal: grade,
          municipioPorCidade,
        }));
        finalizarProcessamentoUi('Sem tabelas para simular', 'O realizado foi carregado, mas não há tabela concorrente disponível.', 100);
        return;
      }

      const lookupOnline = buildLookupTables(baseParaSimulacao);
      const mapaCidades = new Map(cidadePorIbgeCompleto);
      (lookupOnline.cidadePorIbge || new Map()).forEach((cidade, ibge) => mapaCidades.set(ibge, cidade));

      atualizarProcessamentoUi(deveCompararConcorrentes ? 'Simulando CT-e a CT-e contra a tabela selecionada e concorrentes...' : 'Simulando CT-e a CT-e contra a tabela selecionada e o realizado...', 82);
      const resultado = simularRealizadoComTabela({
        rows: rowsFiltrados,
        baseOnline: baseParaSimulacao,
        transportadoraSelecionada: nomeTabelaSelecionada,
        filtros: {
          canal: canalRealizado,
          origem: origemRealizado,
          destino: destinoRealizado,
          ufOrigem: ufOrigemRealizado,
          ufDestino: ufDestinoRealizado,
          inicio: inicioRealizado,
          fim: fimRealizado,
          modo: modoRealizado,
        },
        cidadePorIbge: mapaCidades,
        gradePorCanal: grade,
        municipioPorCidade,
      });

      setResultadoRealizado({
        ...resultado,
        filtros: {
          transportadora: transportadoraRealizado,
          transportadoraTabelaUsada: nomeTabelaSelecionada,
          canal: canalRealizado,
          modo: modoRealizado,
          origem: origemRealizado,
          destino: destinoRealizado,
          ufOrigem: ufOrigemRealizado,
          ufDestino: ufDestinoRealizado,
          inicio: inicioRealizado,
          fim: fimRealizado,
          limite: limiteRealizado,
          ctesBrutos: rowsBrutos.length,
          ctesAposFiltroPadrao: rowsBrutosFiltrados.length,
          ctesRemovidosFiltroPadrao: Math.max(0, rowsBrutos.length - rowsBrutosFiltrados.length),
          incluirCpsLog: incluirCpsLogRealizado,
          baseRealizadoTracking,
          ctesComTracking: trackingEnriquecido.vinculados,
          ctesSemTracking: trackingEnriquecido.semTracking,
          ctesBaseSimulada: rowsComIbge.length,
          ctesNaMalha: rowsFiltrados.length,
          origemMalhaNaoReconhecida: [...origemMalhaNaoReconhecida].slice(0, 20),
          trackingVinculados: trackingEnriquecido.vinculados,
          trackingSemVinculo: trackingEnriquecido.semTracking,
          trackingTotalEncontrado: mapasTracking.total,
          trackingErro: trackingEnriquecido.erroTracking,
          volumesTracking: trackingEnriquecido.volumesTracking,
          cubagemTracking: trackingEnriquecido.cubagemTracking,
          rotasReaisComIbge: routeKeysRealizado.length,
          tabelasCarregadas: baseParaSimulacao.length,
          tabelasBaseSelecionada: baseSelecionada.length,
          tabelasBaseRotas: Array.isArray(baseRotas) ? baseRotas.length : 0,
          tabelasBaseOrigem: basesOrigemCarregadas,
          origensBuscadas: origensParaBuscar.join(', '),
          fonteTabela: 'selecionada_rotas_origens',
        },
      });

      finalizarProcessamentoUi('Simulação do realizado concluída', 'Dossiê gerado com projeção, saving e rotas prioritárias.', 100);
    } catch (error) {
      setErroSimulacao(error.message || 'Erro ao simular realizado.');
      finalizarProcessamentoUi('Erro na simulação do realizado', 'Não foi possível gerar o dossiê.', 100);
    }
  };

  const exportarSimuladorRealizado = () => {
    if (!resultadoRealizado?.rotas?.length) return;
    const linhas = [
      ['Resumo', 'Valor'],
      ['Transportadora simulada', resultadoRealizado.filtros?.transportadora || ''],
      ['CT-es analisados', resultadoRealizado.ctesAnalisados],
      ['CT-es simulados', resultadoRealizado.ctesSimulados],
      ['CT-es com tabela selecionada', resultadoRealizado.ctesComTabelaSelecionada],
      ['CT-es que ganharia', resultadoRealizado.ctesGanhariaSelecionada],
      ['CT-es perdidos', resultadoRealizado.ctesPerdidosSelecionada],
      ['Aderência %', resultadoRealizado.aderenciaSelecionada.toFixed(2)],
      ['Frete realizado', resultadoRealizado.freteRealizado.toFixed(2)],
      ['Faturamento tabela selecionada', resultadoRealizado.freteSelecionada.toFixed(2)],
      ['Faturamento mensal projetado', resultadoRealizado.faturamentoSelecionadaMes.toFixed(2)],
      ['Faturamento 12 meses projetado', resultadoRealizado.faturamentoSelecionadaAno.toFixed(2)],
      ['Saving ganhadora vs realizado', resultadoRealizado.savingSelecionadaVsReal.toFixed(2)],
      ['Saving tabela amplo', Number(resultadoRealizado.savingTabelaSelecionadaVsRealBruto || 0).toFixed(2)],
      ['Saving mercado', Number(resultadoRealizado.savingVencedorVsReal || 0).toFixed(2)],
      ['Saving 12 meses ganhadora', resultadoRealizado.savingSelecionadaVsRealAno.toFixed(2)],
      ['Tracking vinculados', Number(resultadoRealizado.linhasComTracking || 0).toFixed(0)],
      [],
      ['Rotas', 'Origem', 'Destino', 'Tipo', 'CT-es', 'Volumes', 'Peso', 'Valor NF', 'Frete realizado', 'Frete tabela selecionada', 'Frete vencedor', 'Saving selecionada', 'Diferença para vencedor', 'Redução média necessária %', 'Principal vencedor', 'Concorrentes médio'],
      ...resultadoRealizado.rotas.map((item) => [
        'Rota', item.origem, item.destino, item.tipo, item.ctes, item.volumes, item.peso.toFixed(2), item.valorNF.toFixed(2), item.freteRealizado.toFixed(2), item.freteSelecionada.toFixed(2), item.freteVencedor.toFixed(2), item.savingSelecionada.toFixed(2), item.diferencaParaVencedor.toFixed(2), item.reducaoMediaNecessaria.toFixed(2), item.principalVencedor, item.concorrentesMedio.toFixed(2),
      ]),
    ];

    const nomeBase = (resultadoRealizado.filtros?.transportadora || 'realizado').toLowerCase().replace(/[^a-z0-9]+/gi, '-');
    const { nomeArquivo, csv } = exportarLinhasCsv(`simulador-realizado-${nomeBase}.csv`, linhas);
    downloadCsv(nomeArquivo, csv);
  };

  // ── Relatório Fornecedor: Tabela Selecionada × Realizado (SEM concorrentes) ──
  const exportarRelatorioFornecedorVsRealizado = () => {
    if (!resultadoRealizado?.ctesAnalisados) return;
    const r = resultadoRealizado;
    const transp = r.filtros?.transportadora || 'Transportadora';
    const periodo = `${r.filtros?.inicio || ''} a ${r.filtros?.fim || ''}`;

    // Métricas globais tabela vs realizado
    const cteComTabela = (r.ctesDetalhes || []).filter((i) => i.freteSelecionada > 0);
    const totalRealizado = cteComTabela.reduce((acc, i) => acc + (i.freteRealizado || 0), 0);
    const totalTabela = cteComTabela.reduce((acc, i) => acc + (i.freteSelecionada || 0), 0);
    const totalDiferenca = totalRealizado - totalTabela;
    const qtdMaisBarata = cteComTabela.filter((i) => i.ganhouRealizado).length;
    const qtdMaisCara = cteComTabela.filter((i) => !i.ganhouRealizado).length;

    // Rotas: agrupa por rota usando ctesDetalhes
    const rotaMap = new Map();
    cteComTabela.forEach((item) => {
      const chave = `${item.origem}/${item.ufOrigem} → ${item.destino}/${item.ufDestino}`;
      const d = rotaMap.get(chave) || { rota: chave, ctes: 0, realizado: 0, tabela: 0, maisBarata: 0, maisCara: 0, volumesTotais: 0, pesoTotal: 0 };
      d.ctes += 1;
      d.realizado += item.freteRealizado || 0;
      d.tabela += item.freteSelecionada || 0;
      d.volumesTotais += item.volumes || 0;
      d.pesoTotal += item.peso || 0;
      if (item.ganhouRealizado) d.maisBarata += 1; else d.maisCara += 1;
      rotaMap.set(chave, d);
    });
    const rotasFornecedor = [...rotaMap.values()]
      .map((d) => ({ ...d, diferenca: d.realizado - d.tabela, pctDiferenca: d.realizado > 0 ? ((d.realizado - d.tabela) / d.realizado) * 100 : 0 }))
      .sort((a, b) => b.tabela - a.tabela);

    const linhas = [
      ['ANÁLISE DE TABELA DE FRETE — COMPARATIVO COM REALIZADO'],
      ['Empresa:', 'Central Fretes'],
      ['Transportadora:', transp],
      ['Tabela usada:', r.filtros?.transportadoraTabelaUsada || transp],
      ['Canal:', r.filtros?.canal || ''],
      ['Período:', periodo],
      ['Data do relatório:', new Date().toLocaleDateString('pt-BR')],
      [],
      ['VISÃO GERAL'],
      ['CT-es com tabela para comparação', cteComTabela.length],
      ['CT-es em que a tabela é mais competitiva que o praticado', qtdMaisBarata],
      ['CT-es em que a tabela é menos competitiva que o praticado', qtdMaisCara],
      ['Percentual de rotas competitivas (%)', cteComTabela.length ? ((qtdMaisBarata / cteComTabela.length) * 100).toFixed(2) : 0],
      [],
      ['VALORES TOTAIS'],
      ['Frete total praticado no período (realizado)', totalRealizado.toFixed(2)],
      ['Frete total pela tabela simulada', totalTabela.toFixed(2)],
      ['Diferença total (positivo = tabela mais barata)', totalDiferenca.toFixed(2)],
      ['Diferença % sobre realizado', totalRealizado > 0 ? ((totalDiferenca / totalRealizado) * 100).toFixed(2) + '%' : ''],
      ['Faturamento mensal projetado (tabela)', r.meses ? (totalTabela / r.meses).toFixed(2) : totalTabela.toFixed(2)],
      ['Faturamento 12 meses projetado (tabela)', r.meses ? ((totalTabela / r.meses) * 12).toFixed(2) : ''],
      [],
      ['RESUMO POR ROTA'],
      ['Rota', 'CT-es', 'Volumes', 'Peso (kg)', 'Frete realizado', 'Frete tabela', 'Diferença', 'Diferença %', 'CT-es tabela mais competitiva', 'CT-es tabela menos competitiva'],
      ...rotasFornecedor.map((d) => [
        d.rota, d.ctes,
        Number(d.volumesTotais).toLocaleString('pt-BR'),
        d.pesoTotal.toFixed(2),
        d.realizado.toFixed(2),
        d.tabela.toFixed(2),
        d.diferenca.toFixed(2),
        d.pctDiferenca.toFixed(2) + '%',
        d.maisBarata,
        d.maisCara,
      ]),
      [],
      ['DETALHE CT-E A CT-E'],
      ['CT-e', 'Data', 'Origem', 'Destino', 'Transp. atual', 'Peso (kg)', 'Cubagem (m³)', 'Valor NF', 'Volumes', 'Frete realizado', '% NF realizado', 'Frete tabela', '% NF tabela', 'Diferença', 'Diferença %', 'Resultado'],
      ...cteComTabela.map((item) => {
        const diferenca = (item.freteRealizado || 0) - (item.freteSelecionada || 0);
        const pctDif = item.freteRealizado > 0 ? (diferenca / item.freteRealizado) * 100 : 0;
        return [
          item.cte || '',
          item.data ? String(item.data).slice(0, 10) : '',
          `${item.origemUsada || item.origem}/${item.ufOrigem}`,
          `${item.destino}/${item.ufDestino}`,
          item.transportadoraReal || '',
          (item.peso || 0).toFixed(2),
          (item.cubagem || 0).toFixed(4),
          (item.valorNF || 0).toFixed(2),
          Number(item.volumes || 0).toLocaleString('pt-BR'),
          (item.freteRealizado || 0).toFixed(2),
          item.percentualFreteRealizado ? item.percentualFreteRealizado.toFixed(2) + '%' : '',
          (item.freteSelecionada || 0).toFixed(2),
          item.percentualFreteSelecionada ? item.percentualFreteSelecionada.toFixed(2) + '%' : '',
          diferenca.toFixed(2),
          pctDif.toFixed(2) + '%',
          item.ganhouRealizado ? 'Tabela mais competitiva' : 'Tabela menos competitiva',
        ];
      }),
    ];

    const nomeBase = transp.toLowerCase().replace(/[^a-z0-9]+/gi, '-');
    const { nomeArquivo, csv } = exportarLinhasCsv(`fornecedor-vs-realizado-${nomeBase}.csv`, linhas);
    downloadCsv(nomeArquivo, csv);
  };
  const exportarRelatorioTransportadora = () => {
    if (!resultadoRealizado?.ctesAnalisados) return;
    const r = resultadoRealizado;
    const transp = r.filtros?.transportadora || 'Transportadora';
    const linhas = [
      ['DEVOLUTIVA DE ANÁLISE DE TABELA DE FRETE'],
      ['Preparado por:', 'Central Fretes'],
      ['Transportadora analisada:', transp],
      ['Tabela usada na simulação:', r.filtros?.transportadoraTabelaUsada || transp],
      ['Canal:', r.filtros?.canal || ''],
      ['Período analisado:', `${r.filtros?.inicio || 'início'} a ${r.filtros?.fim || 'fim'}`],
      ['Data do relatório:', new Date().toLocaleDateString('pt-BR')],
      [],
      ['RESUMO EXECUTIVO'],
      ['CT-es analisados', r.ctesAnalisados],
      ['CT-es com sua tabela coberta', r.ctesComTabelaSelecionada],
      ['CT-es que você ganharia (melhor preço)', r.ctesGanhariaSelecionada],
      ['CT-es que você perderia para concorrentes', r.ctesPerdidosSelecionada],
      ['Aderência da tabela (%)', r.aderenciaSelecionada?.toFixed(2)],
      ['Período base (meses)', r.meses],
      [],
      ['PROJEÇÃO DE FATURAMENTO'],
      ['Faturamento projetado mensal (tabela)', r.faturamentoSelecionadaMes?.toFixed(2)],
      ['Faturamento projetado 12 meses (tabela)', r.faturamentoSelecionadaAno?.toFixed(2)],
      ['Faturamento nas rotas ganhas (período)', r.freteSelecionadaGanhadora?.toFixed(2)],
      ['Faturamento nas rotas perdidas (período)', (r.freteSelecionada - r.freteSelecionadaGanhadora)?.toFixed(2)],
      ['Redução média necessária para virar ganhadora (%)', r.reducaoMediaNecessaria?.toFixed(2)],
      [],
      ['ROTAS ONDE VOCÊ GANHA (oportunidade de crescimento)'],
      ['Rota', 'CT-es', 'Volumes', 'Faturamento tabela (período)', '% sobre NF', 'Faturamento mensal projetado'],
      ...(r.rotas || [])
        .filter((item) => item.savingSelecionada > 0 || item.qtdGanhasSelecionada > 0)
        .sort((a, b) => b.freteSelecionada - a.freteSelecionada)
        .map((item) => [
          item.rota, item.ctes, Number(item.volumes || 0).toLocaleString('pt-BR'),
          item.freteSelecionada?.toFixed(2),
          item.percentualFreteSelecionada?.toFixed(2) + '%',
          r.meses ? (item.freteSelecionada / r.meses)?.toFixed(2) : '',
        ]),
      [],
      ['ROTAS ONDE VOCÊ PERDE (oportunidade de ajuste)'],
      ['Rota', 'CT-es', 'Volumes', 'Faturamento tabela', 'Faturamento vencedor', 'Redução necessária (%)', 'Principal concorrente vencedor'],
      ...(r.rotas || [])
        .filter((item) => item.diferencaParaVencedor > 0)
        .sort((a, b) => b.diferencaParaVencedor - a.diferencaParaVencedor)
        .map((item) => [
          item.rota, item.ctes, Number(item.volumes || 0).toLocaleString('pt-BR'),
          item.freteSelecionada?.toFixed(2),
          item.freteVencedor?.toFixed(2),
          item.reducaoMediaNecessaria?.toFixed(2) + '%',
          item.principalVencedor || '-',
        ]),
      [],
      ['PARETO 80% — ROTAS PRIORITÁRIAS'],
      ['Rota', 'CT-es', 'Volumes', '% do volume total', '% acumulado', 'Faturamento tabela', 'Redução necessária (%)', 'Principal vencedor'],
      ...(r.pareto80Volume?.rotas || []).map((item) => [
        item.rota, item.ctes, Number(item.volumes || item.ctes || 0).toLocaleString('pt-BR'),
        item.pctVolume?.toFixed(2) + '%', item.pctAcumulado?.toFixed(2) + '%',
        item.freteSelecionada?.toFixed(2),
        item.reducaoMediaNecessaria?.toFixed(2) + '%',
        item.principalVencedor || '-',
      ]),
    ];
    const nomeBase = transp.toLowerCase().replace(/[^a-z0-9]+/gi, '-');
    const { nomeArquivo, csv } = exportarLinhasCsv(`devolutiva-transportadora-${nomeBase}.csv`, linhas);
    downloadCsv(nomeArquivo, csv);
  };

  // ── Relatório para Diretoria (COM saving, linguagem estratégica) ──────────────
  const exportarRelatorioDiretoria = () => {
    if (!resultadoRealizado?.ctesAnalisados) return;
    const r = resultadoRealizado;
    const transp = r.filtros?.transportadora || 'Transportadora';
    const linhas = [
      ['ANÁLISE DE OPORTUNIDADE DE FRETE — USO INTERNO'],
      ['Transportadora analisada:', transp],
      ['Canal:', r.filtros?.canal || ''],
      ['Período:', `${r.filtros?.inicio || ''} a ${r.filtros?.fim || ''}`],
      ['Data:', new Date().toLocaleDateString('pt-BR')],
      [],
      ['VISÃO GERAL'],
      ['CT-es analisados', r.ctesAnalisados],
      ['Frete realizado total (período)', r.freteRealizado?.toFixed(2)],
      ['Frete realizado mensal', r.freteRealizadoMes?.toFixed(2)],
      ['% frete sobre NF', r.percentualFreteRealizado?.toFixed(2) + '%'],
      [],
      ['RESULTADO DA SIMULAÇÃO'],
      ['CT-es com tabela selecionada', r.ctesComTabelaSelecionada],
      ['CT-es que ganharia (melhor preço)', r.ctesGanhariaSelecionada],
      ['CT-es que perderia para concorrentes', r.ctesPerdidosSelecionada],
      ['Aderência (%)', r.aderenciaSelecionada?.toFixed(2) + '%'],
      [],
      ['IMPACTO FINANCEIRO'],
      ['Saving se ficarmos só nas rotas ganhas (período)', r.savingSelecionadaVsReal?.toFixed(2)],
      ['Saving mensal projetado (rotas ganhas)', r.savingSelecionadaVsRealMes?.toFixed(2)],
      ['Saving 12 meses projetado (rotas ganhas)', r.savingSelecionadaVsRealAno?.toFixed(2)],
      ['Saving tabela geral (todos CT-es com tabela)', r.savingTabelaSelecionadaVsRealBruto?.toFixed(2)],
      ['Saving mercado (melhor tabela disponível)', r.savingVencedorVsReal?.toFixed(2)],
      ['Perda para concorrentes (diferença)', r.diferencaSelecionadaVsVencedor?.toFixed(2)],
      ['Redução média necessária para virar ganhador (%)', r.reducaoMediaNecessaria?.toFixed(2) + '%'],
      [],
      ['PARETO 80% — PRIORIZAÇÃO DE NEGOCIAÇÃO'],
      ['Rota', 'CT-es', 'Volumes', '% vol.', '% acum.', 'Frete realizado', 'Frete tabela', 'Frete vencedor', 'Saving ganhadora', 'Saving mercado', 'Redução necessária (%)', 'Principal vencedor'],
      ...(r.pareto80Volume?.rotas || []).map((item) => [
        item.rota, item.ctes, Number(item.volumes || item.ctes || 0).toLocaleString('pt-BR'),
        item.pctVolume?.toFixed(2) + '%', item.pctAcumulado?.toFixed(2) + '%',
        item.freteRealizado?.toFixed(2), item.freteSelecionada?.toFixed(2),
        item.freteVencedor?.toFixed(2), item.savingSelecionada?.toFixed(2),
        item.savingVencedor?.toFixed(2), item.reducaoMediaNecessaria?.toFixed(2) + '%',
        item.principalVencedor || '-',
      ]),
      [],
      ['TODAS AS ROTAS — DETALHE COMPLETO'],
      ['Rota', 'Tipo', 'CT-es', 'Volumes', 'Frete realizado', 'Frete tabela', 'Frete vencedor', '% NF real', '% NF tabela', '% NF vencedor', 'Saving ganhadora', 'Saving tabela amplo', 'Saving mercado', 'Dif. vencedor', 'Redução média (%)', 'Principal vencedor', 'Concorrentes médio'],
      ...(r.rotas || []).map((item) => [
        item.rota, item.tipo, item.ctes, Number(item.volumes || 0).toLocaleString('pt-BR'),
        item.freteRealizado?.toFixed(2), item.freteSelecionada?.toFixed(2),
        item.freteVencedor?.toFixed(2),
        item.percentualFreteRealizado?.toFixed(2) + '%',
        item.percentualFreteSelecionada?.toFixed(2) + '%',
        item.percentualFreteVencedor?.toFixed(2) + '%',
        item.savingSelecionada?.toFixed(2), (item.savingTabelaSelecionadaBruto || 0)?.toFixed(2),
        item.savingVencedor?.toFixed(2), item.diferencaParaVencedor?.toFixed(2),
        item.reducaoMediaNecessaria?.toFixed(2) + '%', item.principalVencedor || '-',
        item.concorrentesMedio?.toFixed(2),
      ]),
      [],
      ['CT-E A CT-E — AMOSTRA COMPLETA'],
      ['CT-e', 'Data', 'Canal', 'Origem', 'Destino', 'Transp. real', 'Peso', 'Cubagem', 'Valor NF', 'Volumes', 'Frete realizado', '% NF real', 'Frete tabela', '% NF tabela', 'Vencedor', 'Frete vencedor', 'Status', 'Ranking', 'Redução (%)', 'Saving ganhadora', 'Saving mercado', 'Concorrentes', 'Fallback origem'],
      ...(r.ctesDetalhes || []).map((item) => [
        item.cte, item.data?.slice(0, 10) || '', item.canal,
        `${item.origemUsada || item.origem}/${item.ufOrigem}`,
        `${item.destino}/${item.ufDestino}`,
        item.transportadoraReal, item.peso?.toFixed(2), item.cubagem?.toFixed(4),
        item.valorNF?.toFixed(2), Number(item.volumes || 0).toLocaleString('pt-BR'),
        item.freteRealizado?.toFixed(2), item.percentualFreteRealizado?.toFixed(2) + '%',
        item.freteSelecionada ? item.freteSelecionada?.toFixed(2) : '',
        item.freteSelecionada ? item.percentualFreteSelecionada?.toFixed(2) + '%' : '',
        item.vencedor, item.freteVencedor?.toFixed(2),
        item.statusSelecionada, item.rankingSelecionada || '',
        item.reducaoNecessaria > 0 ? item.reducaoNecessaria?.toFixed(2) + '%' : '',
        item.savingSelecionada?.toFixed(2), item.savingVencedor?.toFixed(2),
        item.concorrentes, item.fallbackOrigem ? 'Sim' : 'Não',
      ]),
    ];
    const nomeBase = transp.toLowerCase().replace(/[^a-z0-9]+/gi, '-');
    const { nomeArquivo, csv } = exportarLinhasCsv(`relatorio-diretoria-${nomeBase}.csv`, linhas);
    downloadCsv(nomeArquivo, csv);
  };

  const atualizarGradePadrao = async () => {
    setSalvandoGrade(true);
    setGradeStatus('Restaurando grade padrão...');
    try {
      const resultado = await restaurarGradeFreteCentralizadaPadrao();
      setGrade(resultado.grade);
      setGradeFonte(resultado.fonte || 'local');
      setGradeStatus(resultado.mensagem || 'Grade padrão restaurada.');
    } catch (error) {
      const gradeLocal = salvarGradeFrete(grade);
      setGrade(gradeLocal);
      setGradeFonte('local');
      setGradeStatus(`Não foi possível salvar no Supabase. Grade mantida localmente. ${error.message || ''}`);
    } finally {
      setSalvandoGrade(false);
    }
  };

  const salvarGradeAtual = async () => {
    setSalvandoGrade(true);
    setGradeStatus('Salvando grade no Supabase...');
    try {
      const resultado = await salvarGradeFreteCentralizada(grade);
      setGrade(resultado.grade);
      setGradeFonte(resultado.fonte || 'local');
      setGradeStatus(resultado.mensagem || 'Grade salva.');
    } catch (error) {
      const gradeLocal = salvarGradeFrete(grade);
      setGrade(gradeLocal);
      setGradeFonte('local');
      setGradeStatus(`Erro ao salvar no Supabase. Grade salva apenas localmente. ${error.message || ''}`);
    } finally {
      setSalvandoGrade(false);
    }
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
        const rowsBrutos = await buscarRealizadoLocalCtes({
          canal: canalOrigem,
          origem: origemOrigem,
          ufDestino: ufDestinoOrigem,
          inicio: inicioOrigem,
          fim: fimOrigem,
          limit: 5000,
        });
        // Carrega vínculos de transportadoras do Supabase com fallback local
        const mapaVinculos = await carregarMapaVinculosSimulador();

        // Resolve ibgeDestino e aplica vínculos de nome de transportadora
        const rowsComIbge = rowsBrutos.map((row) => {
          // Resolve IBGE
          let ibgeDestino = row.ibgeDestino || '';
          if (!ibgeDestino) {
            const cidadeNorm = normalizeBuscaIbge(row.cidadeDestino || '');
            const cidadeUfNorm = normalizeBuscaIbge((row.cidadeDestino || '') + '/' + (row.ufDestino || ''));
            const municipio = municipioPorCidade.get(cidadeUfNorm) || municipioPorCidade.get(cidadeNorm);
            ibgeDestino = municipio?.ibge || '';
          }
          // Aplica vínculo de transportadora
          const nomeOriginal = String(row.transportadora || '').trim();
          const nomeVinculado = mapaVinculos.get(normalizarChaveSimulador(nomeOriginal)) || mapaVinculos.get(nomeOriginal.toUpperCase()) || nomeOriginal;
          return { ...row, ibgeDestino, transportadora: nomeVinculado };
        });

        realizado = {
          totalCompativel: rowsComIbge.length,
          limit: 5000,
          ...resumirRealizadoPorOrigem(rowsComIbge, baseOnline, { canal: canalOrigem, origem: origemOrigem }, mapaCidades, grade[canalOrigem] || grade.ATACADO || []),
        };
      }

      setDetalheOrigemAberto('');
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
          ['realizado', 'Simulador do realizado'],
          ['cobertura', 'Cobertura de tabela'],
        ].map(([id, label]) => (
          <button key={id} className={`sim-tab ${aba === id ? 'active' : ''}`} onClick={() => setAba(id)}>
            {label}
          </button>
        ))}
      </div>

      <div className="sim-alert info" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span>
          Base do simulador: <strong>{carregandoOpcoes ? 'carregando opções' : (opcoesOnline.fonte === 'supabase' ? 'Supabase online' : 'sem conexão/fallback local')}</strong>
          {opcoesOnline.transportadoras?.length ? ` · ${opcoesOnline.transportadoras.length} transportadoras` : ''}
          {opcoesOnline.origens?.length ? ` · ${opcoesOnline.origens.length} origens` : ''}{municipiosDisponiveis.length ? ` · ${municipiosDisponiveis.length} municípios IBGE` : ''}
        </span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="sim-tab" type="button" onClick={atualizarOpcoesSimulador} disabled={carregandoOpcoes}>
            {carregandoOpcoes ? 'Atualizando opções...' : 'Atualizar opções'}
          </button>
          <button className="sim-tab" type="button" onClick={salvarGradeAtual} disabled={salvandoGrade}>
            {salvandoGrade ? 'Salvando grade...' : 'Salvar grade atual'}
          </button>
          <button className="sim-tab" type="button" onClick={atualizarGradePadrao} disabled={salvandoGrade}>
            Restaurar grade padrão
          </button>
        </div>
      </div>
      {erroOpcoes ? <div className="sim-alert error">{erroOpcoes}</div> : null}


      <div className="sim-alert info" style={{ display: 'grid', gap: 8 }}>
        <strong>Grade em uso no simulador <small style={{ fontWeight: 600, color: '#64748b' }}>({gradeFonte === 'supabase' ? 'Supabase' : 'local'})</small></strong>
        <small style={{ color: gradeFonte === 'supabase' ? '#047857' : '#92400e' }}>{gradeStatus}</small>
        <span>
          ATACADO: {(grade.ATACADO || []).map((item) => `${item.peso}kg`).join(' · ') || '-'}
        </span>
        <span>
          B2C: {(grade.B2C || []).map((item) => `${item.peso}kg`).join(' · ') || '-'}
        </span>
      </div>

      {carregandoSimulacao ? (
        <div className="sim-alert info">Consultando o Supabase para esta simulação...</div>
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
              <input
                value={origemOrigem}
                onChange={(e) => setOrigemOrigem(e.target.value)}
                placeholder="Digite a origem"
                list="origens-origem-lista"
              />
              <datalist id="origens-origem-lista">
                {origensOrigemDisponiveis.map((item) => <option key={item} value={item} />)}
              </datalist>
              {origemOrigem && <small style={{ color: '#64748b' }}>Busca por: {origemOrigem}</small>}
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
              Usar CT-e Online (Supabase)
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
                        {!resultadoOrigem.realizado && <tr><td colSpan="5">Ative “Usar CT-e Online (Supabase)” para ver a volumetria carregada.</td></tr>}
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
                      <p>Usa peso e valor NF do realizado, mas volumes e cubagem vêm obrigatoriamente do Tracking. CT-es sem vínculo com Tracking ficam com volume/cubagem zerados para não contaminar capacidade e cálculo.</p>
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
                          <th>Detalhes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {((resultadoOrigem.realizado?.simulacaoPorTransportadora || []).slice(0, 30)).map((item) => {
                          const aberto = detalheOrigemAberto === item.transportadora;
                          const exemplos = aberto
                            ? ((item.exemplosCarregadas || []).length ? item.exemplosCarregadas : item.exemplosGanharia || [])
                            : [];
                          return (
                            <React.Fragment key={item.transportadora}>
                              <tr>
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
                                <td>
                                  <button
                                    className="sim-tab"
                                    type="button"
                                    onClick={() => setDetalheOrigemAberto(aberto ? '' : item.transportadora)}
                                    disabled={!(item.exemplosCarregadas?.length || item.exemplosGanharia?.length)}
                                  >
                                    {aberto ? 'Fechar' : 'Ver 10 casos'}
                                  </button>
                                </td>
                              </tr>
                              {aberto && (
                                <tr>
                                  <td colSpan="11" style={{ background: '#f8fafc' }}>
                                    <div style={{ display: 'grid', gap: 10 }}>
                                      <div style={{ fontSize: 13 }}>
                                        <strong>Como ler a Dif. potencial:</strong> soma do frete realizado nos CT-es carregados pela transportadora menos o melhor frete simulado para esses mesmos CT-es. Se ficar positivo, existia saving potencial; se ficar negativo, o realizado estava abaixo da melhor tabela encontrada.
                                      </div>
                                      <div className="sim-analise-tabela-wrap">
                                        <table className="sim-analise-tabela">
                                          <thead>
                                            <tr>
                                              <th>CT-e</th>
                                              <th>Destino</th>
                                              <th>Real</th>
                                              <th>Frete realizado</th>
                                              <th>Melhor tabela</th>
                                              <th>Frete melhor</th>
                                              <th>Diferença</th>
                                              <th>Tabela da transp.</th>
                                              <th>Concorrentes</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {exemplos.slice(0, 10).map((exemplo, idx) => (
                                              <tr key={`${exemplo.cte}-${idx}`}>
                                                <td>{exemplo.cte || '-'}</td>
                                                <td>{exemplo.destino}/{exemplo.ufDestino}</td>
                                                <td>{exemplo.transportadoraReal}</td>
                                                <td>{formatMoney(exemplo.freteRealizado)}</td>
                                                <td>{exemplo.vencedor || '-'}</td>
                                                <td>{formatMoney(exemplo.freteMelhor)}</td>
                                                <td className={exemplo.diferencaPotencial > 0 ? 'positivo' : exemplo.diferencaPotencial < 0 ? 'negativo' : ''}>{formatMoney(exemplo.diferencaPotencial)}</td>
                                                <td>{exemplo.freteTabela ? formatMoney(exemplo.freteTabela) : '-'}</td>
                                                <td>{exemplo.concorrentes}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
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

      {aba === 'realizado' && (
        <div className="sim-card">
          <div className="sim-resultado-topo compact-top">
            <div>
              <h2 style={{ margin: 0 }}>Simulador do realizado</h2>
              <p>
                Simule uma tabela sobre os CT-es realizados para medir projeção de faturamento, saving, rotas perdidas e redução necessária por rota.
              </p>
            </div>
            <button className="sim-tab" type="button" onClick={exportarSimuladorRealizado} disabled={!resultadoRealizado?.rotas?.length}>
              Exportar laudo
            </button>
            <button className="sim-tab" type="button"
              onClick={exportarRelatorioTransportadora}
              disabled={!resultadoRealizado?.ctesAnalisados}
              title="Relatório sem saving — para enviar à transportadora"
              style={{ background: '#dbeafe', color: '#1d4ed8', border: '1px solid #93c5fd' }}>
              📄 Relatório Transportadora
            </button>
            <button className="sim-tab" type="button"
              onClick={exportarRelatorioFornecedorVsRealizado}
              disabled={!resultadoRealizado?.ctesDetalhes?.length}
              title="Comparativo tabela × realizado — sem concorrentes, foco no que foi pago vs tabela"
              style={{ background: '#f3e8ff', color: '#7c3aed', border: '1px solid #c4b5fd' }}>
              📋 Fornecedor × Realizado
            </button>
            <button className="sim-tab" type="button"
              onClick={exportarRelatorioDiretoria}
              disabled={!resultadoRealizado?.ctesAnalisados}
              title="Relatório completo com saving — uso interno/diretoria"
              style={{ background: '#dcfce7', color: '#15803d', border: '1px solid #86efac' }}>
              📊 Relatório Diretoria
            </button>
            <button className="sim-tab" type="button"
              onClick={salvarResultadoNegociacaoRealizado}
              disabled={!resultadoRealizado?.ctesAnalisados || !negociacaoSelecionadaRealizado || salvandoResultadoNegociacao}
              title="Salva saving, aderência, faturamento e volumetria na tabela em negociação"
              style={{ background: '#fef3c7', color: '#b45309', border: '1px solid #fcd34d' }}>
              {salvandoResultadoNegociacao ? 'Salvando...' : '💾 Salvar resultado na negociação'}
            </button>
          </div>

          <div className="sim-form-grid sim-grid-5">
            <label>
              Transportadora / tabela
              <select value={transportadoraRealizado} onChange={(event) => setTransportadoraRealizado(event.target.value)}>
                <option value="">Selecione</option>
                {transportadorasPorCanalRealizado.map((nome) => <option key={nome} value={nome}>{nome}</option>)}
              </select>
            </label>
            <label>
              Canal
              <select value={canalRealizado} onChange={(event) => setCanalRealizado(event.target.value)}>
                {canais.map((canal) => <option key={canal} value={canal}>{canal}</option>)}
              </select>
            </label>
            <label>
              Modo
              <select value={modoRealizado} onChange={(event) => setModoRealizado(event.target.value)}>
                <option value="malha">Usar malha da transportadora</option>
                <option value="filtros">Usar apenas filtros informados</option>
              </select>
            </label>
            <label>
              Emissão início
              <input type="date" value={inicioRealizado} onChange={(event) => setInicioRealizado(event.target.value)} />
            </label>
            <label>
              Emissão fim
              <input type="date" value={fimRealizado} onChange={(event) => setFimRealizado(event.target.value)} />
            </label>
          </div>

          <div className="sim-form-grid sim-grid-5" style={{ marginTop: 12 }}>
            <label>
              Origem
              <input list="origens-realizado-list" value={origemRealizado} onChange={(event) => setOrigemRealizado(event.target.value)} placeholder="Opcional" />
              <datalist id="origens-realizado-list">
                {origensRealizadoDisponiveis.map((origem) => <option key={origem} value={origem} />)}
              </datalist>
            </label>
            <label>
              Destino
              <input value={destinoRealizado} onChange={(event) => setDestinoRealizado(event.target.value)} placeholder="Cidade opcional" />
            </label>
            <label>
              UF origem
              <select value={ufOrigemRealizado} onChange={(event) => setUfOrigemRealizado(event.target.value)}>
                {UF_OPTIONS.map((uf) => <option key={uf || 'todas'} value={uf}>{uf || 'Todas'}</option>)}
              </select>
            </label>
            <label>
              UF destino
              <select value={ufDestinoRealizado} onChange={(event) => setUfDestinoRealizado(event.target.value)}>
                {UF_OPTIONS.map((uf) => <option key={uf || 'todas'} value={uf}>{uf || 'Todas'}</option>)}
              </select>
            </label>
            <label>
              Limite CT-es
              <select value={limiteRealizado} onChange={(event) => setLimiteRealizado(Number(event.target.value))}>
                <option value={3000}>3.000</option>
                <option value={5000}>5.000</option>
                <option value={10000}>10.000</option>
                <option value={20000}>20.000</option>
                <option value={50000}>50.000</option>
              </select>
            </label>
          </div>

          <div className="sim-alert info" style={{ marginTop: 14, display: 'grid', gap: 8 }}>
            <label className="sim-flag">
              <input
                type="checkbox"
                checked={incluirNegociacoesRealizado}
                onChange={(event) => {
                  const marcado = event.target.checked;
                  setIncluirNegociacoesRealizado(marcado);
                  if (marcado && !negociacoesSimulador.length && !carregandoNegociacoesSimulador) {
                    carregarNegociacoesSimulador();
                  }
                }}
              />
              Incluir tabelas em negociação marcadas como “Simulação = Sim”
            </label>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <span>
                Negociações disponíveis no canal atual: <strong>{nomesNegociacaoRealizado.length}</strong>
                {carregandoNegociacoesSimulador ? ' · carregando...' : ''}
              </span>

              <button
                className="sim-tab"
                type="button"
                onClick={carregarNegociacoesSimulador}
                disabled={carregandoNegociacoesSimulador}
              >
                Atualizar negociações
              </button>
            </div>

            <div style={{ display: 'grid', gap: 6 }}>
              <strong>Base da simulação</strong>
              <label className="sim-flag">
                <input
                  type="radio"
                  name="base-realizado-tracking"
                  checked={baseRealizadoTracking === 'com_tracking'}
                  onChange={() => setBaseRealizadoTracking('com_tracking')}
                />
                Somente CT-es com Tracking vinculado
              </label>
              <label className="sim-flag">
                <input
                  type="radio"
                  name="base-realizado-tracking"
                  checked={baseRealizadoTracking === 'todos'}
                  onChange={() => setBaseRealizadoTracking('todos')}
                />
                Todos os CT-es encontrados
              </label>
              <small style={{ color: '#64748b' }}>
                Recomendado: usar somente CT-es com Tracking para garantir NF, volume e cubagem reais na simulação.
              </small>
            </div>

            {baseRealizadoTracking === 'todos' && (
              <label className="sim-flag">
                <input
                  type="checkbox"
                  checked={incluirCpsLogRealizado}
                  onChange={(event) => setIncluirCpsLogRealizado(event.target.checked)}
                />
                Incluir CPS LOG nesta análise ampla
              </label>
            )}

            <label className="sim-flag">
              <input
                type="checkbox"
                checked={compararConcorrentesRealizado}
                onChange={(event) => setCompararConcorrentesRealizado(event.target.checked)}
              />
              Comparar com tabelas oficiais/concorrentes
            </label>

            <small style={{ color: '#64748b' }}>
              Padrão recomendado: simular somente CT-es com Tracking vinculado, mantendo NF, volumes e cubagem rastreáveis. Na análise ampla, o sistema mantém tomadores CPX, ITR e GP PNEUS, exclui EBAZAR e permite incluir CPS LOG manualmente.
            </small>

            {erroNegociacoesSimulador ? <span style={{ color: '#dc2626' }}>{erroNegociacoesSimulador}</span> : null}
          </div>

          <div className="sim-actions" style={{ marginTop: 14 }}>
            <button className="primary" type="button" onClick={onSimularRealizado} disabled={carregandoSimulacao || !transportadoraRealizado}>
              {carregandoSimulacao ? 'Simulando...' : 'Simular realizado'}
            </button>
            <button className="sim-tab" type="button" onClick={() => setResultadoRealizado(null)}>
              Limpar resultado
            </button>
          </div>

          <div className="sim-alert info" style={{ marginTop: 14 }}>
            <strong>Regra:</strong> por padrão, o sistema simula somente CT-es vinculados ao Tracking, garantindo NF, volumes e cubagem rastreáveis. Se CPS LOG aparecer com Tracking, ele é considerado parte válida da operação. No modo “Todos os CT-es”, a simulação considera também CT-es sem Tracking. Concorrentes só são buscados quando a opção "Comparar com tabelas oficiais/concorrentes" estiver marcada.
          </div>

          {resultadoRealizado && (
            <div style={{ marginTop: 18, display: 'grid', gap: 16 }}>
              <div className="sim-analise-resumo">
                <div><span>Buscados do banco</span><strong>{resultadoRealizado.filtros?.ctesBrutos ?? resultadoRealizado.ctesAnalisados}</strong></div>
                <div><span>{resultadoRealizado.filtros?.modo === 'malha' ? 'Na malha (filtro)' : 'Após filtros'}</span><strong>{resultadoRealizado.filtros?.ctesNaMalha ?? resultadoRealizado.ctesAnalisados}</strong></div>
                <div><span>CT-es analisados</span><strong>{resultadoRealizado.ctesAnalisados}</strong></div>
                <div><span>Com Tracking</span><strong>{resultadoRealizado.filtros?.ctesComTracking ?? resultadoRealizado.linhasComTracking ?? 0}</strong></div>
                <div><span>Sem Tracking</span><strong>{resultadoRealizado.filtros?.ctesSemTracking ?? 0}</strong></div>
                <div><span>Base simulada</span><strong>{resultadoRealizado.filtros?.ctesBaseSimulada ?? resultadoRealizado.ctesAnalisados}</strong></div>
                <div><span>CT-es simulados</span><strong>{resultadoRealizado.ctesSimulados}</strong><small style={{fontSize:'0.7em',color:'#64748b'}}>{compararConcorrentesRealizado ? 'com tabela concorrente' : 'vs realizado'}</small></div>
                <div><span>Sem tabela geral</span><strong style={{color: resultadoRealizado.ctesSemTabelaGeral > 0 ? '#b45309' : undefined}}>{resultadoRealizado.ctesSemTabelaGeral}</strong></div>
                <div><span>Com tabela selecionada</span><strong>{resultadoRealizado.ctesComTabelaSelecionada}</strong></div>
                <div><span>Sem tabela selecionada</span><strong>{resultadoRealizado.ctesSemTabelaSelecionada}</strong></div>
                <div><span>Aderência da tabela</span><strong>{formatPercent(resultadoRealizado.aderenciaSelecionada)}</strong></div>
                <div><span>Ganharia</span><strong style={{color:'#15803d'}}>{resultadoRealizado.ctesGanhariaSelecionada}</strong></div>
                <div><span>Perderia</span><strong style={{color:'#dc2626'}}>{resultadoRealizado.ctesPerdidosSelecionada}</strong></div>
              </div>

              {/* 4 estados */}
              {(resultadoRealizado.ctesDetalhes || []).length > 0 && (() => {
                const ganhaTabGanhaReal = (resultadoRealizado.ctesDetalhes || []).filter((i) => i.statusSelecionada === 'Ganharia' && i.ganhouRealizado).length;
                const ganhaTabPerdeReal = (resultadoRealizado.ctesDetalhes || []).filter((i) => i.statusSelecionada === 'Ganharia' && !i.ganhouRealizado && i.freteSelecionada > 0).length;
                const perdeTabGanhaReal = (resultadoRealizado.ctesDetalhes || []).filter((i) => i.statusSelecionada === 'Perderia' && i.ganhouRealizado).length;
                const perdeTabPerdeReal = (resultadoRealizado.ctesDetalhes || []).filter((i) => i.statusSelecionada === 'Perderia' && !i.ganhouRealizado && i.freteSelecionada > 0).length;
                const totalComTabela = ganhaTabGanhaReal + ganhaTabPerdeReal + perdeTabGanhaReal + perdeTabPerdeReal;
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    <div style={{ background: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                      <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#15803d' }}>{ganhaTabGanhaReal}</div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#15803d' }}>✅ Ganha tudo</div>
                      <div style={{ fontSize: '0.7rem', color: '#166534' }}>1º + mais barato que realizado</div>
                    </div>
                    <div style={{ background: '#dbeafe', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                      <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#1d4ed8' }}>{ganhaTabPerdeReal}</div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#1d4ed8' }}>🏆 Ganha concorrência</div>
                      <div style={{ fontSize: '0.7rem', color: '#1e40af' }}>1º mas mais caro que realizado</div>
                    </div>
                    <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                      <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#b45309' }}>{perdeTabGanhaReal}</div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#b45309' }}>💰 Ganha realizado</div>
                      <div style={{ fontSize: '0.7rem', color: '#92400e' }}>Mais barato que real, perde concorrência</div>
                    </div>
                    <div style={{ background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                      <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#dc2626' }}>{perdeTabPerdeReal}</div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#dc2626' }}>❌ Perde tudo</div>
                      <div style={{ fontSize: '0.7rem', color: '#b91c1c' }}>Mais caro que real + perde concorrência</div>
                    </div>
                  </div>
                );
              })()}

              {(() => {
                const brutos = resultadoRealizado.filtros?.ctesBrutos ?? 0;
                const naMalha = resultadoRealizado.filtros?.ctesNaMalha ?? resultadoRealizado.ctesAnalisados;
                const descartados = brutos - naMalha;
                const pctDescartados = brutos > 0 ? (descartados / brutos) * 100 : 0;
                const origemNaoRec = resultadoRealizado.filtros?.origemMalhaNaoReconhecida || [];
                if (descartados > 0 && pctDescartados > 5) {
                  return (
                    <div className="sim-alert warning">
                      <strong>⚠ Atenção ao filtro de malha:</strong> {brutos.toLocaleString('pt-BR')} CT-es foram buscados do banco, mas apenas {naMalha.toLocaleString('pt-BR')} ({(100 - pctDescartados).toFixed(1)}%) têm a cidade de origem cadastrada na malha da transportadora selecionada. Os outros {descartados.toLocaleString('pt-BR')} CT-es foram excluídos da simulação por não terem origem reconhecida na malha. Para ver todos os CT-es do período, mude para o modo <strong>"Usar apenas filtros informados"</strong>.
                      {origemNaoRec.length > 0 && (
                        <div style={{ marginTop: 6, fontSize: '0.82rem' }}>
                          Origens do realizado não encontradas na malha: <strong>{origemNaoRec.join(', ')}</strong>
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              })()}

              <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
                <div className="summary-card"><span>Fonte tabela</span><strong>{resultadoRealizado.filtros?.fonteTabela === 'rotas_realizadas' ? 'Rotas realizadas' : 'Malha selecionada'}</strong><small>{Number(resultadoRealizado.filtros?.tabelasCarregadas || 0).toLocaleString('pt-BR')} tabela(s) carregada(s) • {Number(resultadoRealizado.filtros?.rotasReaisComIbge || 0).toLocaleString('pt-BR')} rota(s) reais</small></div>
                <div className="summary-card"><span>Frete realizado</span><strong>{formatMoney(resultadoRealizado.freteRealizado)}</strong><small>{formatPercent(resultadoRealizado.percentualFreteRealizado)} sobre NF</small></div>
                <div className="summary-card"><span>Faturamento tabela</span><strong>{formatMoney(resultadoRealizado.freteSelecionada)}</strong><small>nos CT-es com tabela</small></div>
                <div className="summary-card"><span>Projeção mensal</span><strong>{formatMoney(resultadoRealizado.faturamentoSelecionadaMes)}</strong><small>{resultadoRealizado.meses} mês(es) base</small></div>
                <div className="summary-card"><span>Projeção 12 meses</span><strong>{formatMoney(resultadoRealizado.faturamentoSelecionadaAno)}</strong><small>faturamento potencial</small></div>
                <div className="summary-card"><span>Saving ganhadora vs realizado</span><strong>{formatMoney(resultadoRealizado.savingSelecionadaVsReal)}</strong><small>{formatPercent(resultadoRealizado.percentualSavingSelecionada)} só CT-es que ganharia</small></div>
                <div className="summary-card"><span>Saving mercado</span><strong>{formatMoney(resultadoRealizado.savingVencedorVsReal)}</strong><small>{formatPercent(resultadoRealizado.percentualSavingVencedor)} melhor tabela geral</small></div>
                <div className="summary-card"><span>Saving tabela amplo</span><strong>{formatMoney(resultadoRealizado.savingTabelaSelecionadaVsRealBruto)}</strong><small>{formatPercent(resultadoRealizado.percentualSavingSelecionadaBruto)} todos CT-es com tabela</small></div>
                <div className="summary-card"><span>Saving 12 meses</span><strong>{formatMoney(resultadoRealizado.savingSelecionadaVsRealAno)}</strong><small>projeção só nas ganhas</small></div>
                <div className="summary-card"><span>% NF realizado nas ganhas</span><strong>{formatPercent(resultadoRealizado.percentualFreteRealizadoGanharia)}</strong><small>antes, nas cargas que ganharia</small></div>
                <div className="summary-card"><span>% NF tabela ganhadora</span><strong>{formatPercent(resultadoRealizado.percentualFreteTabelaGanharia)}</strong><small>{formatPercent(resultadoRealizado.variacaoPercentualFreteGanharia)} vs realizado</small></div>
                <div className="summary-card"><span>Cargas/dia</span><strong>{Number(resultadoRealizado.cargasDia || 0).toFixed(1)}</strong><small>{resultadoRealizado.dias} dia(s)</small></div>
                <div className="summary-card"><span>Volumes/dia</span><strong>{Number(resultadoRealizado.volumesDia || 0).toFixed(1)}</strong><small>{Number(resultadoRealizado.volumes || 0).toLocaleString('pt-BR')} volumes via Tracking • {Number(resultadoRealizado.linhasComTracking || 0).toLocaleString('pt-BR')} CT-es vinculados</small></div>
                <div className="summary-card"><span>Cubagem tracking</span><strong>{Number(resultadoRealizado.cubagemTotal || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</strong><small>m³ cruzado por NF/CT-e</small></div>
                <div className="summary-card"><span>Redução média p/ ganhar</span><strong>{formatPercent(resultadoRealizado.reducaoMediaNecessaria)}</strong><small>rotas perdidas</small></div>
                <div className="summary-card"><span>Perda para concorrentes</span><strong>{formatMoney(resultadoRealizado.diferencaSelecionadaVsVencedor)}</strong><small>diferença nas perdidas</small></div>
              </div>

              {/* Botões colapso + alerta de discrepância */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button className="sim-tab" onClick={() => setSecoesFechadas(new Set())} style={{ fontSize: '0.8rem' }}>📂 Abrir tudo</button>
                <button className="sim-tab" onClick={() => setSecoesFechadas(new Set(['laudo', 'ganho-perdido', 'pareto', 'transp-realizado', 'rotas-perda-box', 'rotas-prioritarias', 'detalhes']))} style={{ fontSize: '0.8rem' }}>📁 Fechar tudo</button>
              </div>

              {/* Alerta de discrepância extrema de valores */}
              {(() => {
                const rotasDiscrepantes = (resultadoRealizado.rotas || []).filter((r) => r.freteSelecionada > 0 && r.freteVencedor > 0 && r.freteSelecionada / r.freteVencedor > 5);
                if (!rotasDiscrepantes.length) return null;
                const maxRatio = Math.max(...rotasDiscrepantes.map((r) => r.freteSelecionada / r.freteVencedor));
                return (
                  <div className="sim-alert warning" style={{ borderColor: '#dc2626', background: '#fff1f2' }}>
                    <strong>🚨 Atenção: discrepância suspeita nos valores calculados</strong>
                    <p style={{ margin: '6px 0 0', fontSize: '0.85rem' }}>
                      {rotasDiscrepantes.length} rota(s) têm o faturamento da tabela selecionada {maxRatio.toFixed(0)}× maior que o vencedor do mercado — o que não faz sentido competitivo.
                      <strong> Causa mais provável: o campo "valor_nf" nos CT-es importados está com valor incorreto (talvez o valor total da fatura do cliente em vez do valor da mercadoria por entrega).</strong>
                      Rotas afetadas: {rotasDiscrepantes.slice(0, 3).map((r) => `${r.rota} (${(r.freteSelecionada / r.freteVencedor).toFixed(0)}×)`).join(', ')}.
                      Clique em um CT-e na aba de detalhes para ver o "Valor NF utilizado" e confirmar.
                    </p>
                  </div>
                );
              })()}

              {resultadoRealizado.filtros?.trackingErro && (
                <div className="sim-alert warning">
                  <strong>Tracking não foi cruzado.</strong> {resultadoRealizado.filtros.trackingErro}. Volumes e cubagem do CT-e foram desconsiderados; CT-es sem Tracking ficam com volume/cubagem zerados.
                </div>
              )}

              {Number(resultadoRealizado.filtros?.trackingSemVinculo || 0) > 0 && (
                <div className="sim-alert warning">
                  <strong>Tracking incompleto:</strong> {Number(resultadoRealizado.filtros.trackingSemVinculo || 0).toLocaleString('pt-BR')} CT-e(s) não encontraram vínculo no Tracking por chave do CT-e, chave da NF, número da NF ou número do CT-e. Para esses casos, volumes e cubagem foram zerados no cálculo.
                </div>
              )}

              {resultadoRealizado.ctesSimulados === 0 && (
                <div className="sim-alert warning">
                  <strong>Nenhum CT-e foi simulado.</strong> O sistema encontrou o realizado, mas não achou tabela compatível por origem/destino/canal. Confira abaixo o diagnóstico para saber onde travou.
                  <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                    <div>Sem IBGE destino: <strong>{resultadoRealizado.diagnostico?.linhasSemIbgeDestino || 0}</strong></div>
                    <div>Com IBGE, mas sem tabela encontrada: <strong>{resultadoRealizado.diagnostico?.linhasSemResultado || 0}</strong></div>
                    <div>Canais usados na simulação: <strong>{(resultadoRealizado.diagnostico?.canaisUsados || []).map(([c, q]) => `${c}: ${q}`).join(' | ') || '-'}</strong></div>
                    <div>Origens mais usadas: <strong>{(resultadoRealizado.diagnostico?.origensUsadas || []).map(([o, q]) => `${o}: ${q}`).join(' | ') || '-'}</strong></div>
                    <div>Destinos sem tabela: <strong>{(resultadoRealizado.diagnostico?.destinosSemResultado || []).map(([d, q]) => `${d}: ${q}`).join(' | ') || '-'}</strong></div>
                  </div>
                </div>
              )}
              {resultadoRealizado.ctesSimulados > 0 && resultadoRealizado.ctesComTabelaSelecionada === 0 && (
                <div className="sim-alert warning">
                  <strong>Concorrentes foram simulados, mas a tabela selecionada não apareceu nas rotas.</strong> Isso indica que a transportadora escolhida não tem tabela para esses CT-es ou o nome da tabela/vínculo está diferente.
                </div>
              )}

              <div className="sim-parametros-box">
                <div className="sim-parametros-header" onClick={() => toggleSecao('laudo')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  <div>
                    <strong>Laudo executivo</strong>
                    <p>Resumo pronto para diretoria ou devolutiva estratégica.</p>
                  </div>
                  <span style={{ fontSize: '1.2rem', color: '#64748b' }}>{secaoAberta('laudo') ? '▲' : '▼'}</span>
                </div>
                {secaoAberta('laudo') && (
                <ul style={{ marginTop: 12 }}>
                  {(resultadoRealizado.laudo || []).map((linha, index) => <li key={index}>{linha}</li>)}
                </ul>
                )}
              </div>

              <div className="feature-grid import-grid">
                <div className="sim-parametros-box">
                  <div className="sim-parametros-header" onClick={() => toggleSecao('transp-realizado')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                    <div><strong>Transportadoras atuais no realizado</strong><p>Quem está carregando nos CT-es filtrados.</p></div>
                    <span style={{ fontSize: '1.1rem', color: '#64748b' }}>{secaoAberta('transp-realizado') ? '▲' : '▼'}</span>
                  </div>
                  {secaoAberta('transp-realizado') && (
                  <div className="sim-analise-tabela-wrap" style={{ marginTop: 12 }}>
                    <table className="sim-analise-tabela">
                      <thead><tr><th>Transportadora</th><th>CT-es</th><th>Frete</th><th>% frete</th><th>% NF</th></tr></thead>
                      <tbody>
                        {(resultadoRealizado.porTransportadoraReal || []).slice(0, 20).map((item) => (
                          <tr key={item.transportadora}>
                            <td><strong>{item.transportadora}</strong></td>
                            <td>{item.ctes}</td>
                            <td>{formatMoney(item.frete)}</td>
                            <td>{formatPercent(item.pctFrete)}</td>
                            <td>{formatPercent(item.percentualFrete)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  )}
                </div>

                <div className="sim-parametros-box">
                  <div className="sim-parametros-header" onClick={() => toggleSecao('rotas-perda-box')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                    <div><strong>Rotas onde perde faturamento</strong><p>Maiores diferenças contra o vencedor da simulação.</p></div>
                    <span style={{ fontSize: '1.1rem', color: '#64748b' }}>{secaoAberta('rotas-perda-box') ? '▲' : '▼'}</span>
                  </div>
                  {secaoAberta('rotas-perda-box') && (
                  <div className="sim-cobertura-lista" style={{ marginTop: 12 }}>
                    {(resultadoRealizado.rotas || []).filter((item) => item.diferencaParaVencedor > 0).slice(0, 12).map((item) => (
                      <div key={`${item.rota}-${item.tipo}`}>
                        <strong>{item.rota}</strong> · {item.ctes} CT-es · perde para {item.principalVencedor} · reduzir média {formatPercent(item.reducaoMediaNecessaria)}
                      </div>
                    ))}
                    {!(resultadoRealizado.rotas || []).some((item) => item.diferencaParaVencedor > 0) && <div>Nenhuma rota perdida encontrada com os filtros atuais.</div>}
                  </div>
                  )}
                </div>
              </div>

              <div className="sim-parametros-box">
                <div className="sim-parametros-header" onClick={() => toggleSecao('ganho-perdido')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  <div>
                    <strong>💰 Faturamento Ganho × Perdido</strong>
                    <p>Visão consolidada do que a tabela ganha e perde no período analisado.</p>
                  </div>
                  <span style={{ fontSize: '1.1rem', color: '#64748b' }}>{secaoAberta('ganho-perdido') ? '▲' : '▼'}</span>
                </div>
                {secaoAberta('ganho-perdido') && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 16 }}>
                    <div style={{ fontWeight: 700, color: '#15803d', marginBottom: 8 }}>✅ Rotas GANHAS</div>
                    <div style={{ display: 'grid', gap: 6, fontSize: '0.88rem' }}>
                      <div>CT-es ganharia: <strong>{resultadoRealizado.ctesGanhariaSelecionada}</strong></div>
                      <div>Faturamento tabela (período): <strong>{formatMoney(resultadoRealizado.freteSelecionadaGanhadora)}</strong></div>
                      <div>Faturamento mensal projetado: <strong style={{ fontSize: '1.05em' }}>{formatMoney(resultadoRealizado.meses ? resultadoRealizado.freteSelecionadaGanhadora / resultadoRealizado.meses : 0)}</strong></div>
                      <div>Faturamento 12 meses projetado: <strong style={{ fontSize: '1.05em' }}>{formatMoney(resultadoRealizado.meses ? (resultadoRealizado.freteSelecionadaGanhadora / resultadoRealizado.meses) * 12 : 0)}</strong></div>
                      <div>% NF nas rotas ganhas: <strong>{formatPercent(resultadoRealizado.percentualFreteTabelaGanharia)}</strong></div>
                    </div>
                  </div>
                  <div style={{ background: '#fff7f0', border: '1px solid #fed7aa', borderRadius: 8, padding: 16 }}>
                    <div style={{ fontWeight: 700, color: '#c2410c', marginBottom: 8 }}>❌ Rotas PERDIDAS</div>
                    <div style={{ display: 'grid', gap: 6, fontSize: '0.88rem' }}>
                      <div>CT-es perderia: <strong>{resultadoRealizado.ctesPerdidosSelecionada}</strong></div>
                      <div>Faturamento tabela (perdidas): <strong>{formatMoney((resultadoRealizado.freteSelecionada || 0) - (resultadoRealizado.freteSelecionadaGanhadora || 0))}</strong></div>
                      <div>Faturamento mensal nas perdidas: <strong style={{ fontSize: '1.05em' }}>{formatMoney(resultadoRealizado.meses ? ((resultadoRealizado.freteSelecionada || 0) - (resultadoRealizado.freteSelecionadaGanhadora || 0)) / resultadoRealizado.meses : 0)}</strong></div>
                      <div>Diferença para o vencedor: <strong style={{ color: '#dc2626' }}>{formatMoney(resultadoRealizado.diferencaSelecionadaVsVencedor)}</strong></div>
                      <div>Redução média necessária: <strong style={{ color: '#dc2626' }}>{formatPercent(resultadoRealizado.reducaoMediaNecessaria)}</strong></div>
                    </div>
                  </div>
                </div>
                )}
              </div>

              <div className="sim-parametros-box">
                <div className="sim-parametros-header" onClick={() => toggleSecao('pareto')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  <div>
                    <strong>🎯 Pareto 80% — Rotas Prioritárias com Redução Necessária</strong>
                    <p>Rotas que concentram ~80% do volume. Linha a linha com quanto precisa reduzir para virar ganhadora. <strong>Use para negociação e devolutiva ao transportador.</strong></p>
                  </div>
                  <span style={{ fontSize: '1.1rem', color: '#64748b' }}>{secaoAberta('pareto') ? '▲' : '▼'}</span>
                </div>
                {secaoAberta('pareto') && (<>
                <div className="sim-analise-resumo" style={{ marginTop: 12 }}>
                  <div><span>Rotas no 80%</span><strong>{resultadoRealizado.pareto80Volume?.qtdRotas || 0}</strong></div>
                  <div><span>Volume coberto</span><strong>{formatPercent(resultadoRealizado.pareto80Volume?.pctCoberto || 0)}</strong></div>
                  <div><span>Faturamento tabela (80%)</span><strong>{formatMoney(resultadoRealizado.pareto80Volume?.freteSelecionada || 0)}</strong></div>
                  <div><span>Faturamento perdido (80%)</span><strong style={{color:'#dc2626'}}>{formatMoney(resultadoRealizado.pareto80Volume?.diferencaParaVencedor || 0)}</strong></div>
                  <div><span>Redução média (80%)</span><strong style={{color:'#c2410c'}}>{formatPercent(resultadoRealizado.pareto80Volume?.reducaoMediaNecessaria || 0)}</strong></div>
                </div>
                <div className="sim-analise-tabela-wrap" style={{ marginTop: 12 }}>
                  <table className="sim-analise-tabela" style={{ fontSize: '0.8rem' }}>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Rota</th>
                        <th>CT-es</th>
                        <th>Volumes</th>
                        <th>% vol.</th>
                        <th>% acum.</th>
                        <th>Frete realizado</th>
                        <th>Faturamento tabela</th>
                        <th>Frete vencedor</th>
                        <th>% NF tabela</th>
                        <th>% NF vencedor</th>
                        <th>Status predominante</th>
                        <th style={{color:'#dc2626'}}>⬇ Redução necessária</th>
                        <th>Principal vencedor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(resultadoRealizado.pareto80Volume?.rotas || []).map((item, idx) => {
                        const statusPred = item.qtdGanhasSelecionada >= item.qtdPerdidasSelecionada ? 'Ganharia' : 'Perderia';
                        return (
                          <tr key={`pareto-${item.rota}-${item.tipo}`}
                            style={{ background: statusPred === 'Ganharia' ? '#f0fdf4' : item.reducaoMediaNecessaria > 0 ? '#fff7f0' : undefined }}>
                            <td style={{ color: '#94a3b8' }}>{idx + 1}</td>
                            <td><strong>{item.rota}</strong></td>
                            <td>{item.ctes}</td>
                            <td>{Number(item.volumes || item.ctes || 0).toLocaleString('pt-BR')}</td>
                            <td>{formatPercent(item.pctVolume)}</td>
                            <td>{formatPercent(item.pctAcumulado)}</td>
                            <td>{formatMoney(item.freteRealizado)}</td>
                            <td>{formatMoney(item.freteSelecionada)}</td>
                            <td>{formatMoney(item.freteVencedor)}</td>
                            <td>{formatPercent(item.percentualFreteSelecionada)}</td>
                            <td>{formatPercent(item.percentualFreteVencedor)}</td>
                            <td>
                              <span style={{
                                padding: '2px 7px', borderRadius: 10, fontSize: '0.75rem', fontWeight: 600,
                                background: statusPred === 'Ganharia' ? '#dcfce7' : '#fee2e2',
                                color: statusPred === 'Ganharia' ? '#15803d' : '#dc2626',
                              }}>{statusPred}</span>
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 700, color: item.reducaoMediaNecessaria > 0 ? '#dc2626' : '#15803d' }}>
                              {item.reducaoMediaNecessaria > 0 ? `↓ ${formatPercent(item.reducaoMediaNecessaria)}` : '✓ Ganhador'}
                            </td>
                            <td style={{ color: '#64748b' }}>{item.principalVencedor || '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                </>)}
              </div>

              <div className="sim-parametros-box">
                <div className="sim-parametros-header" onClick={() => toggleSecao('rotas-prioritarias')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  <div>
                    <strong>Rotas prioritárias para ajuste</strong>
                    <p>Ordenado por oportunidade: saving contra realizado + diferença para o vencedor + volume.</p>
                  </div>
                  <span style={{ fontSize: '1.1rem', color: '#64748b' }}>{secaoAberta('rotas-prioritarias') ? '▲' : '▼'}</span>
                </div>
                {secaoAberta('rotas-prioritarias') && (
                <div className="sim-analise-tabela-wrap" style={{ marginTop: 12 }}>
                  <table className="sim-analise-tabela">
                    <thead>
                      <tr>
                        <th>Rota</th>
                        <th>Tipo</th>
                        <th>CT-es</th>
                        <th>Volumes</th>
                        <th>Realizado</th>
                        <th>Tabela selecionada</th>
                        <th>Vencedor</th>
                        <th>% NF real</th>
                        <th>% NF tabela</th>
                        <th>% NF vencedor</th>
                        <th>Saving ganhadora</th>
                        <th>Saving tabela amplo</th>
                        <th>Dif. vencedor</th>
                        <th>Redução média</th>
                        <th>Principal vencedor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(resultadoRealizado.rotas || []).slice(0, 80).map((item) => (
                        <tr key={`${item.rota}-${item.tipo}`}>
                          <td><strong>{item.rota}</strong></td>
                          <td>{item.tipo}</td>
                          <td>{item.ctes}</td>
                          <td>{Number(item.volumes || 0).toLocaleString('pt-BR')}</td>
                          <td>{formatMoney(item.freteRealizado)}</td>
                          <td>{formatMoney(item.freteSelecionada)}</td>
                          <td>{formatMoney(item.freteVencedor)}</td>
                          <td>{formatPercent(item.percentualFreteRealizado)}</td>
                          <td>{formatPercent(item.percentualFreteSelecionada)}</td>
                          <td>{formatPercent(item.percentualFreteVencedor)}</td>
                          <td className={item.savingSelecionada > 0 ? 'positivo' : ''}>{formatMoney(item.savingSelecionada)}</td>
                          <td>{formatMoney(item.savingTabelaSelecionadaBruto || 0)}</td>
                          <td className={item.diferencaParaVencedor > 0 ? 'negativo' : ''}>{formatMoney(item.diferencaParaVencedor)}</td>
                          <td>{formatPercent(item.reducaoMediaNecessaria)}</td>
                          <td>{item.principalVencedor}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                )}
              </div>

              <div className="sim-parametros-box">
                <div className="sim-parametros-header" onClick={() => toggleSecao('detalhes')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  <div>
                    <strong>Análise Detalhada</strong>
                    <p>
                      {(resultadoRealizado.ctesDetalhes || []).length} CT-es com detalhes de cálculo disponíveis.
                      Clique em qualquer linha para ver o cálculo completo.
                    </p>
                  </div>
                  <span style={{ fontSize: '1.1rem', color: '#64748b' }}>{secaoAberta('detalhes') ? '▲' : '▼'}</span>
                </div>
                {secaoAberta('detalhes') && (<>
                {/* Mini-abas */}
                <div style={{ display: 'flex', gap: 8, margin: '12px 0 0', borderBottom: '2px solid #e2e8f0', paddingBottom: 0 }}>
                  {[['ctes', '📋 CT-e a CT-e'], ['uf', '🗺 Por Estado (UF)']].map(([id, label]) => (
                    <button key={id}
                      onClick={() => setAbaDetalheRealizado(id)}
                      style={{
                        padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
                        background: 'none', borderBottom: abaDetalheRealizado === id ? '2px solid #3b82f6' : '2px solid transparent',
                        color: abaDetalheRealizado === id ? '#2563eb' : '#64748b', marginBottom: -2,
                      }}>{label}</button>
                  ))}
                </div>

                {/* ── ABA: POR UF ── */}
                {abaDetalheRealizado === 'uf' && (() => {
                  const porUf = new Map();
                  (resultadoRealizado.ctesDetalhes || []).forEach((item) => {
                    const uf = item.ufDestino || 'N/A';
                    const d = porUf.get(uf) || { uf, ctes: 0, ganhou: 0, perdeu: 0, semTabela: 0, freteRealizado: 0, freteSelecionada: 0, freteVencedor: 0, valorNF: 0, diferencaTotal: 0, reducaoSoma: 0, reducaoQtd: 0 };
                    d.ctes += 1;
                    d.freteRealizado += item.freteRealizado || 0;
                    d.freteSelecionada += item.freteSelecionada || 0;
                    d.freteVencedor += item.freteVencedor || 0;
                    d.valorNF += item.valorNF || 0;
                    if (item.statusSelecionada === 'Ganharia') d.ganhou += 1;
                    else if (item.statusSelecionada === 'Perderia') { d.perdeu += 1; d.diferencaTotal += item.diferencaParaVencedor || 0; if (item.reducaoNecessaria > 0) { d.reducaoSoma += item.reducaoNecessaria; d.reducaoQtd += 1; } }
                    else d.semTabela += 1;
                    porUf.set(uf, d);
                  });
                  const lista = [...porUf.values()].sort((a, b) => b.ctes - a.ctes);
                  return (
                    <div className="sim-analise-tabela-wrap" style={{ marginTop: 12 }}>
                      <table className="sim-analise-tabela" style={{ fontSize: '0.8rem' }}>
                        <thead>
                          <tr>
                            <th>UF Destino</th><th>CT-es</th><th>Ganharia</th><th>Perderia</th><th>Aderência</th>
                            <th>Frete realizado</th><th>Faturamento tabela</th><th>Frete vencedor</th>
                            <th>% NF tabela</th><th>% NF vencedor</th>
                            <th style={{color:'#dc2626'}}>Dif. total vencedor</th>
                            <th style={{color:'#dc2626'}}>Redução média</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lista.map((d) => {
                            const aderencia = (d.ganhou + d.perdeu) > 0 ? (d.ganhou / (d.ganhou + d.perdeu)) * 100 : 0;
                            const pctNFTabela = d.valorNF > 0 ? (d.freteSelecionada / d.valorNF) * 100 : 0;
                            const pctNFVencedor = d.valorNF > 0 ? (d.freteVencedor / d.valorNF) * 100 : 0;
                            const reducaoMedia = d.reducaoQtd > 0 ? d.reducaoSoma / d.reducaoQtd : 0;
                            return (
                              <tr key={d.uf} style={{ background: aderencia > 60 ? '#f0fdf4' : aderencia > 0 ? '#fff7f0' : undefined }}>
                                <td><strong>{d.uf}</strong></td>
                                <td>{d.ctes}</td>
                                <td style={{ color: '#15803d', fontWeight: 600 }}>{d.ganhou}</td>
                                <td style={{ color: '#dc2626', fontWeight: 600 }}>{d.perdeu}</td>
                                <td style={{ fontWeight: 700, color: aderencia > 60 ? '#15803d' : aderencia > 30 ? '#c2410c' : '#dc2626' }}>{aderencia > 0 ? formatPercent(aderencia) : '-'}</td>
                                <td>{formatMoney(d.freteRealizado)}</td>
                                <td>{d.freteSelecionada > 0 ? formatMoney(d.freteSelecionada) : '-'}</td>
                                <td>{formatMoney(d.freteVencedor)}</td>
                                <td>{pctNFTabela > 0 ? formatPercent(pctNFTabela) : '-'}</td>
                                <td>{formatPercent(pctNFVencedor)}</td>
                                <td style={{ color: '#dc2626', fontWeight: d.diferencaTotal > 0 ? 600 : undefined }}>{d.diferencaTotal > 0 ? formatMoney(d.diferencaTotal) : '-'}</td>
                                <td style={{ color: '#dc2626' }}>{reducaoMedia > 0 ? `↓ ${formatPercent(reducaoMedia)}` : <span style={{ color: '#15803d' }}>✓</span>}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}

                {/* ── ABA: CT-E A CT-E ── */}
                {abaDetalheRealizado === 'ctes' && (
                  <>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <input
                        value={filtroDetalhe}
                        onChange={(e) => { setFiltroDetalhe(e.target.value); setPaginaDetalhe(0); }}
                        placeholder="Filtrar por CT-e, transportadora, origem, destino, status..."
                        style={{ flex: 1, minWidth: 220, padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '0.85rem' }}
                      />
                      <button className="sim-tab" onClick={() => setLinhasExpandidas(new Set())} style={{ fontSize: '0.8rem' }}>Fechar todos</button>
                      <span style={{ fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                        {(() => {
                          const q = filtroDetalhe.toLowerCase();
                          return `${(resultadoRealizado.ctesDetalhes || []).filter((item) => !q || [item.cte, item.transportadoraReal, item.origem, item.destino, item.vencedor, item.statusSelecionada, item.canal, item.ufDestino].some((v) => String(v || '').toLowerCase().includes(q))).length} CT-e(s)`;
                        })()}
                      </span>
                    </div>
                    <div className="sim-analise-tabela-wrap" style={{ marginTop: 4 }}>
                      <table className="sim-analise-tabela" style={{ fontSize: '0.78rem' }}>
                        <thead>
                          <tr>
                            <th></th><th>#</th><th>CT-e</th><th>Data</th><th>Origem</th><th>Destino/UF</th>
                            <th>Transp. real</th><th>Peso</th><th>Cubagem</th><th>Valor NF</th><th>Vol.</th>
                            <th>Frete realizado</th><th>% NF real</th>
                            <th>Tabela selecionada</th><th>% NF tabela</th>
                            <th>Vencedor</th><th>Frete vencedor</th><th>% NF venc.</th>
                            <th>Status</th><th>Rank</th><th>Redução</th><th>Conc.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            const todos = resultadoRealizado.ctesDetalhes || [];
                            const q = filtroDetalhe.toLowerCase();
                            const filtrados = q ? todos.filter((item) => [item.cte, item.transportadoraReal, item.origem, item.destino, item.vencedor, item.statusSelecionada, item.canal, item.ufDestino, item.ufOrigem].some((v) => String(v || '').toLowerCase().includes(q))) : todos;
                            const totalPaginas = Math.ceil(filtrados.length / DETALHE_POR_PAGINA);
                            const pagina = Math.min(paginaDetalhe, Math.max(0, totalPaginas - 1));
                            const slice = filtrados.slice(pagina * DETALHE_POR_PAGINA, (pagina + 1) * DETALHE_POR_PAGINA);
                            return slice.map((item, index) => {
                              const key = `${item.cte}-${pagina * DETALHE_POR_PAGINA + index}`;
                              const expandido = linhasExpandidas.has(key);
                              const statusC = statusCombinadoCte(item);
                              const bgRow = statusC.label === 'Ganha tudo' ? '#f0fdf4' : statusC.label === 'Ganha realizado' ? '#fffbeb' : statusC.label === 'Ganha concorrência' ? '#eff6ff' : statusC.label === 'Perde tudo' ? '#fff7f0' : undefined;
                              return (
                                <>
                                  <tr key={key}
                                    onClick={() => setLinhasExpandidas((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; })}
                                    style={{ background: bgRow, cursor: 'pointer' }}
                                    title="Clique para ver detalhes do cálculo">
                                    <td style={{ textAlign: 'center', color: '#3b82f6', fontSize: '1em' }}>{expandido ? '▼' : '▶'}</td>
                                    <td style={{ color: '#94a3b8' }}>{pagina * DETALHE_POR_PAGINA + index + 1}</td>
                                    <td style={{ fontFamily: 'monospace', fontSize: '0.73rem' }}>{item.cte || '-'}{item.fallbackOrigem ? ' ⚡' : ''}</td>
                                    <td>{item.data ? String(item.data).slice(0, 10) : '-'}</td>
                                    <td>{item.origemUsada || item.origem}/{item.ufOrigem}</td>
                                    <td><strong>{item.destino}</strong>/{item.ufDestino}</td>
                                    <td>{item.transportadoraReal}</td>
                                    <td style={{ textAlign: 'right' }}>{Number(item.peso || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td>
                                    <td style={{ textAlign: 'right' }}>{Number(item.cubagem || 0).toFixed(4)}</td>
                                    <td style={{ textAlign: 'right' }}>{formatMoney(item.valorNF)}</td>
                                    <td style={{ textAlign: 'right' }}>{Number(item.volumes || 0).toLocaleString('pt-BR')}{item.trackingMatch ? ' ✓' : ''}</td>
                                    <td style={{ textAlign: 'right' }}><strong>{formatMoney(item.freteRealizado)}</strong></td>
                                    <td style={{ textAlign: 'right', color: item.percentualFreteRealizado < 1 ? '#dc2626' : undefined }}>{formatPercent(item.percentualFreteRealizado)}</td>
                                    <td style={{ textAlign: 'right' }}>{item.freteSelecionada ? formatMoney(item.freteSelecionada) : <span style={{ color: '#94a3b8' }}>—</span>}</td>
                                    <td style={{ textAlign: 'right' }}>{item.freteSelecionada ? formatPercent(item.percentualFreteSelecionada) : '—'}</td>
                                    <td style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.vencedor || '-'}</td>
                                    <td style={{ textAlign: 'right' }}>{formatMoney(item.freteVencedor)}</td>
                                    <td style={{ textAlign: 'right' }}>{formatPercent(item.percentualFreteVencedor)}</td>
                                    <td><span style={{ padding: '2px 6px', borderRadius: 10, fontSize: '0.72rem', fontWeight: 700, background: statusC.bg, color: statusC.color, whiteSpace: 'nowrap' }}>{statusC.icon} {statusC.label}</span></td>
                                    <td style={{ textAlign: 'center' }}>{item.rankingSelecionada || '—'}</td>
                                    <td style={{ textAlign: 'right', color: '#dc2626', fontWeight: 600 }}>{item.reducaoNecessaria > 0 ? `↓${formatPercent(item.reducaoNecessaria)}` : ''}</td>
                                    <td style={{ textAlign: 'center' }}>{item.concorrentes}</td>
                                  </tr>
                                  {expandido && (
                                    <tr key={`${key}-detail`} style={{ background: '#f8fafc' }}>
                                      <td colSpan={22} style={{ padding: '12px 16px', borderTop: '2px solid #3b82f6' }}>
                                        {/* Painel de cálculo detalhado */}
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>

                                          {/* Bloco: Vencedor da simulação */}
                                          {item.vencedorDetalhes && (
                                            <div style={{ background: '#fff', border: '1px solid #bbf7d0', borderRadius: 8, padding: 12 }}>
                                              <div style={{ fontWeight: 700, color: '#15803d', marginBottom: 8, fontSize: '0.85rem' }}>
                                                🏆 Vencedor: {item.vencedor} — {formatMoney(item.freteVencedor)}
                                              </div>
                                              {/* Status combinado em destaque */}
                                              {item.freteSelecionada > 0 && (() => { const s = statusCombinadoCte(item); return (
                                                <div style={{ marginBottom: 8, padding: '4px 8px', borderRadius: 6, background: s.bg, color: s.color, fontSize: '0.78rem', fontWeight: 700 }}>
                                                  {s.icon} {s.label}
                                                  {item.ganhouRealizado && <span style={{ fontWeight: 400, marginLeft: 6 }}>— economia de {formatMoney(item.freteRealizado - item.freteSelecionada)} vs realizado</span>}
                                                  {!item.ganhouRealizado && item.freteSelecionada > 0 && <span style={{ fontWeight: 400, marginLeft: 6 }}>— tabela {formatPercent(((item.freteSelecionada - item.freteRealizado) / item.freteRealizado) * 100)} acima do realizado</span>}
                                                </div>
                                              ); })()}
                                              <div style={{ display: 'grid', gap: 3, fontSize: '0.78rem', color: '#334155' }}>
                                                <div>Tipo de cálculo: <strong>{item.vencedorDetalhes?.frete?.tipoCalculo || '—'}</strong></div>
                                                <div>Prazo: <strong>{item.vencedorDetalhes?.prazo} dia(s)</strong></div>
                                                <div>Faixa aplicada: <strong>{item.vencedorDetalhes?.frete?.faixaPeso || '—'}</strong></div>
                                                <div>Peso considerado: <strong>{Number(item.vencedorDetalhes?.frete?.pesoConsiderado || 0).toFixed(2)} kg</strong></div>
                                                <div>Peso cubado: <strong>{Number(item.vencedorDetalhes?.frete?.pesoCubado || 0).toFixed(2)} kg</strong> (fator {item.vencedorDetalhes?.frete?.fatorCubagem})</div>
                                                <div>Cubagem usada: <strong>{Number(item.vencedorDetalhes?.frete?.cubagemAplicada || 0).toFixed(6)} m³</strong></div>
                                                <div>R$/kg: <strong>{Number(item.vencedorDetalhes?.frete?.rsKgAplicado || 0).toFixed(4)}</strong></div>
                                                <div>% aplicado: <strong style={{ color: Number(item.vencedorDetalhes?.frete?.percentualAplicado || 0) < 1 ? '#dc2626' : undefined }}>{formatPercent(item.vencedorDetalhes?.frete?.percentualAplicado)}</strong></div>
                                                <div>Valor NF usado: <strong>{formatMoney(item.vencedorDetalhes?.frete?.valorNFInformado)}</strong></div>
                                                <div>Valor fixo/faixa: <strong>{formatMoney(item.vencedorDetalhes?.frete?.valorFixoAplicado)}</strong></div>
                                                {(() => {
                                                  const frete = item.vencedorDetalhes?.frete || {};
                                                  const limiteExcedente = Number(frete.pesoLimiteExcedente || 0);
                                                  const pesoExcedente = Number(frete.pesoExcedente || 0);
                                                  const valorExcedente = Number(frete.valorExcedente || 0);
                                                  const valorExcedenteUnitario = Number(frete.valorExcedenteUnitario || (pesoExcedente > 0 ? valorExcedente / pesoExcedente : 0));
                                                  const valorFaixaSemExcedente = Number(frete.valorFaixaSemExcedente ?? frete.valorFixoAplicado ?? 0);
                                                  const valorFaixaComExcedente = Number(frete.valorFaixaComExcedente ?? (valorFaixaSemExcedente + valorExcedente));
                                                  return (
                                                    <>
                                                      <div>Limite para excedente: <strong>{limiteExcedente > 0 ? `${limiteExcedente.toFixed(0)} kg` : '—'}</strong></div>
                                                      <div>Peso excedente: <strong>{pesoExcedente.toFixed(2)} kg</strong></div>
                                                      <div>R$/kg excedente: <strong>{valorExcedenteUnitario > 0 ? formatMoney(valorExcedenteUnitario) : '—'}</strong></div>
                                                      <div>Valor excedente: <strong>{formatMoney(valorExcedente)}</strong></div>
                                                      <div>Base faixa + excedente: <strong>{formatMoney(valorFaixaSemExcedente)}</strong> + <strong>{formatMoney(valorExcedente)}</strong> = <strong>{formatMoney(valorFaixaComExcedente)}</strong></div>
                                                    </>
                                                  );
                                                })()}
                                                <div>Mínimo rota: <strong>{formatMoney(item.vencedorDetalhes?.frete?.minimoRota)}</strong></div>
                                                <div>Valor base: <strong>{formatMoney(item.vencedorDetalhes?.frete?.valorBase)}</strong></div>
                                                <div>Ad Valorem: <strong>{formatMoney(item.vencedorDetalhes?.taxas?.adValorem)}</strong> ({formatPercent(item.vencedorDetalhes?.taxas?.adValPct)})</div>
                                                <div>GRIS: <strong>{formatMoney(item.vencedorDetalhes?.taxas?.gris)}</strong> ({formatPercent(item.vencedorDetalhes?.taxas?.grisPct)})</div>
                                                <div>Pedágio: <strong>{formatMoney(item.vencedorDetalhes?.taxas?.pedagio)}</strong></div>
                                                <div>Subtotal: <strong>{formatMoney(item.vencedorDetalhes?.frete?.subtotal)}</strong></div>
                                                <div>ICMS ({formatPercent(item.vencedorDetalhes?.frete?.aliquotaIcms)}): <strong>{formatMoney(item.vencedorDetalhes?.frete?.icms)}</strong> <span style={{ color: '#64748b' }}>({item.vencedorDetalhes?.frete?.origemAliquotaIcms})</span></div>
                                                <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 4, marginTop: 4 }}>Total: <strong style={{ fontSize: '1.05em', color: '#15803d' }}>{formatMoney(item.freteVencedor)}</strong></div>
                                              </div>
                                            </div>
                                          )}

                                          {/* Bloco: Tabela Selecionada (se diferente do vencedor) */}
                                          {item.selecionadaDetalhes && item.vencedor !== (item.rankingSelecionada === 1 ? item.vencedor : 'outro') && (
                                            <div style={{ background: '#fff', border: '1px solid #bfdbfe', borderRadius: 8, padding: 12 }}>
                                              <div style={{ fontWeight: 700, color: '#1d4ed8', marginBottom: 8, fontSize: '0.85rem' }}>
                                                📋 Tabela selecionada — {formatMoney(item.freteSelecionada)} (rank {item.rankingSelecionada})
                                              </div>
                                              <div style={{ display: 'grid', gap: 3, fontSize: '0.78rem', color: '#334155' }}>
                                                <div>Tipo de cálculo: <strong>{item.selecionadaDetalhes?.frete?.tipoCalculo || '—'}</strong></div>
                                                <div>Prazo: <strong>{item.selecionadaDetalhes?.prazo} dia(s)</strong></div>
                                                <div>Faixa: <strong>{item.selecionadaDetalhes?.frete?.faixaPeso || '—'}</strong></div>
                                                <div>Peso considerado: <strong>{Number(item.selecionadaDetalhes?.frete?.pesoConsiderado || 0).toFixed(2)} kg</strong></div>
                                                <div>% aplicado: <strong style={{ color: Number(item.selecionadaDetalhes?.frete?.percentualAplicado || 0) < 1 ? '#dc2626' : undefined }}>{formatPercent(item.selecionadaDetalhes?.frete?.percentualAplicado)}</strong></div>
                                                <div>Valor NF usado: <strong>{formatMoney(item.selecionadaDetalhes?.frete?.valorNFInformado)}</strong></div>
                                                {(() => {
                                                  const frete = item.selecionadaDetalhes?.frete || {};
                                                  const limiteExcedente = Number(frete.pesoLimiteExcedente || 0);
                                                  const pesoExcedente = Number(frete.pesoExcedente || 0);
                                                  const valorExcedente = Number(frete.valorExcedente || 0);
                                                  const valorExcedenteUnitario = Number(frete.valorExcedenteUnitario || (pesoExcedente > 0 ? valorExcedente / pesoExcedente : 0));
                                                  const valorFaixaSemExcedente = Number(frete.valorFaixaSemExcedente ?? frete.valorFixoAplicado ?? 0);
                                                  const valorFaixaComExcedente = Number(frete.valorFaixaComExcedente ?? (valorFaixaSemExcedente + valorExcedente));
                                                  return (
                                                    <>
                                                      <div>Valor fixo/faixa: <strong>{formatMoney(frete.valorFixoAplicado)}</strong></div>
                                                      <div>Limite para excedente: <strong>{limiteExcedente > 0 ? `${limiteExcedente.toFixed(0)} kg` : '—'}</strong></div>
                                                      <div>Peso excedente: <strong>{pesoExcedente.toFixed(2)} kg</strong></div>
                                                      <div>R$/kg excedente: <strong>{valorExcedenteUnitario > 0 ? formatMoney(valorExcedenteUnitario) : '—'}</strong></div>
                                                      <div>Valor excedente: <strong>{formatMoney(valorExcedente)}</strong></div>
                                                      <div>Base faixa + excedente: <strong>{formatMoney(valorFaixaSemExcedente)}</strong> + <strong>{formatMoney(valorExcedente)}</strong> = <strong>{formatMoney(valorFaixaComExcedente)}</strong></div>
                                                    </>
                                                  );
                                                })()}
                                                <div>Valor base: <strong>{formatMoney(item.selecionadaDetalhes?.frete?.valorBase)}</strong></div>
                                                <div>Ad Valorem: <strong>{formatMoney(item.selecionadaDetalhes?.taxas?.adValorem)}</strong></div>
                                                <div>GRIS: <strong>{formatMoney(item.selecionadaDetalhes?.taxas?.gris)}</strong></div>
                                                <div>Subtotal: <strong>{formatMoney(item.selecionadaDetalhes?.frete?.subtotal)}</strong></div>
                                                <div>ICMS ({formatPercent(item.selecionadaDetalhes?.frete?.aliquotaIcms)}): <strong>{formatMoney(item.selecionadaDetalhes?.frete?.icms)}</strong></div>
                                                <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 4, marginTop: 4 }}>Total: <strong style={{ fontSize: '1.05em', color: '#1d4ed8' }}>{formatMoney(item.freteSelecionada)}</strong></div>
                                                {item.reducaoNecessaria > 0 && <div style={{ color: '#dc2626', fontWeight: 700 }}>⬇ Precisa reduzir {formatPercent(item.reducaoNecessaria)} para ganhar</div>}
                                              </div>
                                            </div>
                                          )}

                                          {/* Bloco: Ranking de todos concorrentes */}
                                          {(item.todosResultados || []).length > 0 && (
                                            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
                                              <div style={{ fontWeight: 700, color: '#475569', marginBottom: 8, fontSize: '0.85rem' }}>
                                                🏁 Ranking completo ({item.concorrentes} tabelas)
                                              </div>
                                              <table style={{ width: '100%', fontSize: '0.76rem', borderCollapse: 'collapse' }}>
                                                <thead><tr style={{ color: '#64748b' }}><th style={{ textAlign: 'left', paddingBottom: 4 }}>Pos.</th><th style={{ textAlign: 'left' }}>Transportadora</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>% NF</th></tr></thead>
                                                <tbody>
                                                  {(item.todosResultados || []).map((r, ri) => (
                                                    <tr key={ri} style={{ background: ri === 0 ? '#f0fdf4' : undefined }}>
                                                      <td style={{ padding: '2px 4px', color: ri === 0 ? '#15803d' : '#64748b', fontWeight: ri === 0 ? 700 : undefined }}>{ri + 1}º</td>
                                                      <td style={{ padding: '2px 4px', fontWeight: ri === 0 ? 700 : undefined }}>{r.transportadora}</td>
                                                      <td style={{ textAlign: 'right', padding: '2px 4px' }}>{formatMoney(r.total)}</td>
                                                      <td style={{ textAlign: 'right', padding: '2px 4px', color: item.valorNF > 0 && (r.total / item.valorNF) * 100 < 1 ? '#dc2626' : undefined }}>{item.valorNF > 0 ? formatPercent((r.total / item.valorNF) * 100) : '—'}</td>
                                                    </tr>
                                                  ))}
                                                </tbody>
                                              </table>
                                              {/* Alerta de % muito baixo */}
                                              {item.vencedorDetalhes?.frete?.percentualAplicado > 0 && item.vencedorDetalhes.frete.percentualAplicado < 1 && (
                                                <div style={{ marginTop: 8, padding: '6px 8px', background: '#fef3c7', borderRadius: 6, fontSize: '0.75rem', color: '#78350f' }}>
                                                  ⚠ % aplicado ({formatPercent(item.vencedorDetalhes.frete.percentualAplicado)}) abaixo de 1% — verifique se o valor da NF ({formatMoney(item.vencedorDetalhes.frete.valorNFInformado)}) está correto na tabela.
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </>
                              );
                            });
                          })()}
                        </tbody>
                      </table>
                    </div>

                    {/* Paginação */}
                    {(() => {
                      const q = filtroDetalhe.toLowerCase();
                      const filtrados = q ? (resultadoRealizado.ctesDetalhes || []).filter((item) => [item.cte, item.transportadoraReal, item.origem, item.destino, item.vencedor, item.statusSelecionada].some((v) => String(v || '').toLowerCase().includes(q))) : (resultadoRealizado.ctesDetalhes || []);
                      const totalPaginas = Math.ceil(filtrados.length / DETALHE_POR_PAGINA);
                      if (totalPaginas <= 1) return null;
                      const pagina = Math.min(paginaDetalhe, Math.max(0, totalPaginas - 1));
                      return (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
                          <button className="sim-tab" disabled={pagina === 0} onClick={() => { setPaginaDetalhe(0); setLinhasExpandidas(new Set()); }}>« Início</button>
                          <button className="sim-tab" disabled={pagina === 0} onClick={() => { setPaginaDetalhe((p) => Math.max(0, p - 1)); setLinhasExpandidas(new Set()); }}>‹ Anterior</button>
                          <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Página {pagina + 1} de {totalPaginas} ({filtrados.length} CT-es)</span>
                          <button className="sim-tab" disabled={pagina >= totalPaginas - 1} onClick={() => { setPaginaDetalhe((p) => Math.min(totalPaginas - 1, p + 1)); setLinhasExpandidas(new Set()); }}>Próxima ›</button>
                          <button className="sim-tab" disabled={pagina >= totalPaginas - 1} onClick={() => { setPaginaDetalhe(totalPaginas - 1); setLinhasExpandidas(new Set()); }}>Final »</button>
                        </div>
                      );
                    })()}
                  </>
                )}

                {/* CT-es sem tabela concorrente */}
                {resultadoRealizado.ctesSemTabelaGeral > 0 && (
                  <div style={{ marginTop: 16, padding: 12, background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8 }}>
                    <strong>⚠ {resultadoRealizado.ctesSemTabelaGeral} CT-e(s) sem tabela concorrente</strong>
                    <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#78350f' }}>
                      Esses CT-es foram analisados mas não encontraram nenhuma tabela de frete compatível (sem IBGE destino ou sem cobertura nas transportadoras carregadas).
                      Detalhes: {resultadoRealizado.diagnostico?.linhasSemIbgeDestino || 0} sem IBGE destino,
                      {' '}{resultadoRealizado.diagnostico?.linhasSemResultado || 0} com IBGE mas sem tabela cobrindo o destino.
                      {(resultadoRealizado.diagnostico?.destinosSemResultado || []).length > 0 && (
                        <> Destinos sem cobertura: {(resultadoRealizado.diagnostico.destinosSemResultado || []).slice(0, 5).map(([d, q]) => `${d} (${q}x)`).join(', ')}.</>
                      )}
                    </p>
                  </div>
                )}
                </>)}
              </div>

            </div>
          )}
        </div>
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
          <div className="sim-actions"><button className="primary" onClick={onAnalisarCobertura} disabled={carregandoSimulacao || processamentoUi.ativo}>{carregandoSimulacao || processamentoUi.ativo ? "Analisando..." : "Analisar cobertura"}</button></div>
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
