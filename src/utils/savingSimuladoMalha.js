// Simulacao "saving por malha": pega os CT-es efetivamente carregados por uma
// transportadora negociada (ou so os de uma rota+faixa especifica) e roda cada
// um contra a malha oficial de tabelas, pra confirmar (ou nao) o saving
// apurado pelo metodo historico — usado sobretudo nas rotas que deram
// negativas, onde o motivo pode ser um concorrente mais barato que ja saiu.
//
// Por padrao entra toda a malha oficial (igual o simulador normal). So fica de
// fora quem tem prova de ter entrado depois do periodo simulado: uma
// negociacao propria (aprovada/publicada) na mesma origem+canal cuja aprovacao
// aconteceu depois do inicio da janela — aí sim ela ainda nao disputava aquela
// rota naquele periodo. Quem nao tem negociacao registrada continua valendo
// como concorrente (é a maioria da malha). E um proxy (usa a data da
// negociacao, nao uma vigencia por tabela) ate existir campo de vigencia
// dedicado nas tabelas.
import { buscarBaseSimulacaoDb, carregarMunicipiosIbgeDb, listarRealizadoLocalCtesParaSimulacao } from '../services/freteDatabaseService';
import { carregarVinculosTransportadoras, criarMapaVinculosTransportadoras, aplicarVinculoTransportadora, normalizarNomeVinculo } from '../services/vinculosTransportadorasService';
import { simularRealizadoPorTransportadoraAsync } from './calculoFrete';
import { calcularJanelasSaving, classificarRotaFaixaCte } from './savingsPosAprovacaoNegociacao';

const ELEGIVEIS = ['APROVADA_GESTOR', 'PUBLICADA_OFICIAL'];

const buildCidadePorIbge = (municipios = []) => new Map((municipios || []).map((item) => [String(item.ibge || ''), item.cidade || '']));

function canaisDaNegociacao(canal = '') {
  const norm = String(canal || '').toUpperCase();
  if (norm.includes('AMBOS') || norm.includes('TODOS') || norm.includes('+')) return ['ATACADO', 'B2C'];
  return [norm];
}

// Nomes (já no padrão de cadastro, via vínculo) de transportadora com
// negociação própria na mesma origem+canal que só foi aprovada DEPOIS do
// início do período simulado — essas ficam de fora da malha nessa rodada.
// Quem não tem negociação registrada não entra aqui e continua concorrendo
// normalmente.
function transportadorasEntrantesTardiasNaData(tabelas = [], { origem = '', canal = '', dataReferencia = '', mapaVinculos, transportadoraAlvo = '' } = {}) {
  const origemAlvo = normalizarNomeVinculo(origem);
  const alvoNormalizado = normalizarNomeVinculo(aplicarVinculoTransportadora(transportadoraAlvo, mapaVinculos));
  const nomes = new Set();
  (tabelas || []).forEach((t) => {
    if (!ELEGIVEIS.includes(t.status_gestao) || !t.transportadora || !t.aprovado_em) return;
    // A própria transportadora sendo confirmada nunca pode ficar de fora da
    // malha por causa de uma data de referência customizada anterior à sua
    // própria aprovação — senão ela desaparece até de si mesma na simulação.
    if (normalizarNomeVinculo(aplicarVinculoTransportadora(t.transportadora, mapaVinculos)) === alvoNormalizado) return;
    if (normalizarNomeVinculo(t.origem || '') !== origemAlvo) return;
    if (!canaisDaNegociacao(t.canal).includes(String(canal || '').toUpperCase())) return;
    if (String(t.aprovado_em).slice(0, 10) <= String(dataReferencia).slice(0, 10)) return;
    nomes.add(normalizarNomeVinculo(aplicarVinculoTransportadora(t.transportadora, mapaVinculos)));
  });
  return nomes;
}

function consolidar(simulacao, totalCtes) {
  const detalhes = simulacao?.detalhes || [];
  const vencedores = detalhes.filter((x) => Number(x.ranking) === 1 && Number(x.freteSubstituta) > 0);
  const naoVencedores = detalhes.filter((x) => Number(x.ranking) > 1);
  const savingVitorias = vencedores.reduce((s, x) => s + Math.max(Number(x.freteSubstituta) - Number(x.valorSimulado), 0), 0);
  const oportunidadePerdida = naoVencedores.reduce((s, x) => s + Math.max(Number(x.valorRealizado || 0) - Number(x.liderValor || 0), 0), 0);
  return {
    totalCtes, simulados: detalhes.length, semCobertura: Math.max(totalCtes - detalhes.length, 0),
    vencedores: vencedores.length,
    naoVencedores: naoVencedores.length,
    semAlternativa: detalhes.filter((x) => Number(x.ranking) === 1 && !(Number(x.freteSubstituta) > 0)).length,
    // Líquido: o que a RPA economizou nas rotas que venceu, menos o que pagou
    // a mais nas que não venceu. Transparente — pode dar negativo.
    saving: savingVitorias - oportunidadePerdida,
    savingVitorias,
    valorVencedor: vencedores.reduce((s, x) => s + Number(x.valorSimulado || 0), 0),
    valorAlternativa: vencedores.reduce((s, x) => s + Number(x.freteSubstituta || 0), 0),
    divergenciaCobrada: detalhes.reduce((s, x) => s + Number(x.valorRealizado || 0) - Number(x.valorSimulado || 0), 0),
    oportunidadePerdida,
    vencedoresDetalhe: vencedores.map((x) => ({
      cte: x.numeroCte || x.chaveCte || '—', destino: `${x.cidadeDestino || '—'}${x.ufDestino ? `/${x.ufDestino}` : ''}`,
      rpa: Number(x.valorSimulado || 0),
      segundoNome: x.proximaSeBloquear || '', segundoValor: Number(x.freteSubstituta || 0),
      saving: Math.max(Number(x.freteSubstituta) - Number(x.valorSimulado), 0),
    })).sort((a, b) => b.saving - a.saving),
    naoVencedoresDetalhe: naoVencedores.map((x) => ({
      cte: x.numeroCte || x.chaveCte || '—', destino: `${x.cidadeDestino || '—'}${x.ufDestino ? `/${x.ufDestino}` : ''}`,
      ranking: Number(x.ranking || 0), rpa: Number(x.valorSimulado || 0),
      vencedorNome: x.liderTransportadora || '', vencedorValor: Number(x.liderValor || 0),
      pago: Number(x.valorRealizado || 0),
      oportunidade: Math.max(Number(x.valorRealizado || 0) - Number(x.liderValor || 0), 0),
    })).sort((a, b) => b.oportunidade - a.oportunidade),
  };
}

// Busca janela, vínculo e os CT-es realizados (todos, sem filtrar rota) de uma
// negociação — base compartilhada pela confirmação da tabela inteira e da rota.
async function buscarContextoRealizado(tabela) {
  const janela = calcularJanelasSaving(tabela.data_referencia_saving || tabela.aprovado_em, 3);
  if (!janela) throw new Error('Data de referência inválida.');
  const origem = String(tabela.origem_realizado_saving || tabela.origem || '').trim();
  const vinculos = Array.isArray(tabela.vinculo_transportadoras_saving) && tabela.vinculo_transportadoras_saving.length
    ? tabela.vinculo_transportadoras_saving : [tabela.transportadora];

  const realizados = await listarRealizadoLocalCtesParaSimulacao({
    transportadorasExatas: vinculos, origem: origem || undefined, canal: tabela.canal || undefined,
    inicio: janela.inicioAtual, fim: janela.fimAtual, limit: 50000,
  });
  if (!realizados.length) throw new Error('Nenhum CT-e carregado encontrado para vínculo, origem e período.');
  return { janela, origem, vinculos, realizados };
}

// Roda a simulação CT-e a CT-e contra a malha oficial, já com o recorte de
// concorrentes elegíveis (quem estava em negociação na data). `realizados` já
// deve vir filtrado (tabela inteira ou só uma rota+faixa).
async function simularContraMalha({ tabela, tabelas, realizados, origem, janela, onProgress }) {
  const progresso = (pct, etapa) => onProgress?.({ pct, etapa });
  progresso(25, 'Carregando tabelas concorrentes');
  const [vinculosCadastro, municipios] = await Promise.all([
    carregarVinculosTransportadoras().catch(() => []), carregarMunicipiosIbgeDb(),
  ]);
  const mapaVinculos = criarMapaVinculosTransportadoras(vinculosCadastro);
  const vinculos = Array.isArray(tabela.vinculo_transportadoras_saving) && tabela.vinculo_transportadoras_saving.length
    ? tabela.vinculo_transportadoras_saving : [tabela.transportadora];
  const candidatosNome = [...new Set([tabela.transportadora, ...vinculos]
    .filter(Boolean)
    .map((nome) => aplicarVinculoTransportadora(nome, mapaVinculos))
    .concat([tabela.transportadora, ...vinculos].filter(Boolean)))];

  let base = [];
  let nomeResolvido = tabela.transportadora;
  for (const candidato of candidatosNome) {
    base = await buscarBaseSimulacaoDb({ origem, canal: tabela.canal || '', nomeTransportadora: candidato });
    if (base.length) { nomeResolvido = candidato; break; }
  }
  if (!base.length) throw new Error('Tabela da transportadora ou concorrentes não encontrados na malha oficial. Verifique o vínculo em Ferramentas > Transportadoras.');
  // O nome que encontrou a malha (após vínculo) pode não ser o nome bruto da
  // negociação — usar o bruto pra achar a própria transportadora no ranking
  // faria todo CT-e cair fora da malha (0 simulados) sem erro nenhum.
  const nomeParaRanking = base.some((item) => normalizarNomeVinculo(item?.nome || '') === normalizarNomeVinculo(nomeResolvido))
    ? nomeResolvido
    : (base[0]?.nome || nomeResolvido);

  const entrantesTardios = transportadorasEntrantesTardiasNaData(tabelas, {
    origem, canal: tabela.canal, dataReferencia: janela.inicioAtual, mapaVinculos, transportadoraAlvo: tabela.transportadora,
  });
  const baseElegivel = entrantesTardios.size
    ? base.filter((item) => !entrantesTardios.has(normalizarNomeVinculo(item?.nome || item?.transportadora || '')))
    : base;
  if (!baseElegivel.length) throw new Error('Todos os concorrentes da malha entraram em negociação depois do início do período simulado.');

  const simulacao = await simularRealizadoPorTransportadoraAsync({
    transportadoras: baseElegivel, realizados, nomeTransportadora: nomeParaRanking,
    filtros: { canal: tabela.canal || '', origem, inicio: janela.inicioAtual, fim: janela.fimAtual }, chunkSize: 50,
    cidadePorIbge: buildCidadePorIbge(municipios),
    onProgress: ({ atual = 0, total = realizados.length, etapa = 'Simulando CT-es' }) => progresso(30 + Math.round(atual / Math.max(total, 1) * 65), etapa),
  });

  return { ...consolidar(simulacao, realizados.length), janela, concorrentesConsiderados: baseElegivel.length, concorrentesNaMalha: base.length };
}

function filtrarPorCompetencia(realizados = [], competencia = '') {
  if (!competencia || competencia === 'TODAS') return realizados;
  return realizados.filter((row) => String(row.emissao || '').slice(0, 7) === competencia);
}

// tabela: item de tabelas_negociacao (a que esta sendo confirmada).
// tabelas: lista completa (pra achar quem mais competia na origem+canal e quando entrou).
// competencia: opcional, "AAAA-MM" — recorta os CT-es só daquele mês.
export async function calcularSavingSimuladoPorTabela(tabela, tabelas = [], { onProgress, competencia } = {}) {
  onProgress?.({ pct: 5, etapa: 'Buscando CT-es carregados' });
  const { janela, origem, realizados } = await buscarContextoRealizado(tabela);
  const realizadosNoRecorte = filtrarPorCompetencia(realizados, competencia);
  if (!realizadosNoRecorte.length) throw new Error(`Nenhum CT-e encontrado em ${competencia}.`);
  return simularContraMalha({ tabela, tabelas, realizados: realizadosNoRecorte, origem, janela, onProgress });
}

// Mesma simulação, mas só com os CT-es de uma rota+faixa específica (as que
// vieram negativas no método histórico) — pra confirmar se o negativo é real
// ou fruto de um concorrente mais barato que já não está mais na malha.
// competencia: opcional, "AAAA-MM" — recorta a rota+faixa só daquele mês.
export async function calcularSavingSimuladoPorRota(tabela, tabelas = [], { rota, faixa, competencia }, { onProgress } = {}) {
  onProgress?.({ pct: 5, etapa: 'Buscando CT-es carregados' });
  const { janela, origem, realizados } = await buscarContextoRealizado(tabela);
  const canalPadrao = tabela.canal || '';
  const realizadosDaRota = filtrarPorCompetencia(realizados, competencia).filter((row) => {
    const classificado = classificarRotaFaixaCte(row, { canalPadrao });
    return classificado.rota === rota && classificado.faixa === faixa;
  });
  if (!realizadosDaRota.length) throw new Error(`Nenhum CT-e encontrado para essa rota/faixa${competencia && competencia !== 'TODAS' ? ` em ${competencia}` : ''}.`);
  return simularContraMalha({ tabela, tabelas, realizados: realizadosDaRota, origem, janela, onProgress });
}
