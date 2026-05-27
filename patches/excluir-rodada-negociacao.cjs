#!/usr/bin/env node
/**
 * Prompt 4.15 — Excluir registro de rodada/simulação da negociação
 *
 * Permite remover uma simulação antiga do histórico para recalcular depois.
 * Também garante feedback visual no botão: primeiro clique pede confirmação,
 * segundo clique executa e mostra status de processamento.
 */

const fs = require('fs');
const path = require('path');

const servicePath = path.join(process.cwd(), 'src/services/tabelasNegociacaoService.js');
const pagePath = path.join(process.cwd(), 'src/pages/TabelasNegociacaoPage.jsx');

let service = fs.readFileSync(servicePath, 'utf8');
let page = fs.readFileSync(pagePath, 'utf8');
let alterou = false;

function substituirEmService(trecho, novo, descricao) {
  if (service.includes(trecho)) {
    service = service.replace(trecho, novo);
    alterou = true;
    console.log(`OK service ${descricao}`);
    return true;
  }
  if (service.includes(novo)) {
    console.log(`SKIP service ${descricao} já aplicado`);
    return true;
  }
  console.warn(`WARN service ${descricao} não encontrado`);
  return false;
}

function substituirEmPage(trecho, novo, descricao) {
  if (page.includes(trecho)) {
    page = page.replace(trecho, novo);
    alterou = true;
    console.log(`OK page ${descricao}`);
    return true;
  }
  if (page.includes(novo)) {
    console.log(`SKIP page ${descricao} já aplicado`);
    return true;
  }
  console.warn(`WARN page ${descricao} não encontrado`);
  return false;
}

const funcService = `
export async function excluirRegistroRodadaNegociacao(id, registroId) {
  const supabase = supabaseOrThrow();

  if (!id) throw new Error('Negociação inválida para excluir registro.');
  if (!registroId) throw new Error('Registro da rodada inválido para exclusão.');

  const { data: tabelaAtual, error: tabelaError } = await supabase
    .from('tabelas_negociacao')
    .select('*')
    .eq('id', id)
    .single();

  if (tabelaError) {
    throw new Error(tabelaError.message || 'Erro ao buscar negociação atual.');
  }

  const resumoAnterior = getResumoSimulacaoSeguro(tabelaAtual);
  const historicoAnterior = getHistoricoRodadas(tabelaAtual);
  const historicoAtualizado = historicoAnterior.filter((item) => String(item.id || item.criado_em || '') !== String(registroId));

  if (historicoAtualizado.length === historicoAnterior.length) {
    throw new Error('Registro não encontrado no histórico da negociação.');
  }

  const simulacoesRestantes = historicoAtualizado.filter((item) => item.tipo_registro === 'SIMULACAO');
  const ultimaSimulacao = simulacoesRestantes.length ? simulacoesRestantes[simulacoesRestantes.length - 1] : null;
  const resumoUltima = ultimaSimulacao && ultimaSimulacao.resumo ? ultimaSimulacao.resumo : {};
  const indUltima = ultimaSimulacao && ultimaSimulacao.indicadores ? ultimaSimulacao.indicadores : {};
  const maiorRodada = historicoAtualizado.reduce((acc, item) => Math.max(acc, inteiro(item.rodada || 0)), 1);

  const resumoSimulacaoAtualizado = ultimaSimulacao
    ? {
        ...resumoAnterior,
        ...resumoUltima,
        rodada_atual: maiorRodada,
        ultima_simulacao: ultimaSimulacao,
        ultima_simulacao_em: ultimaSimulacao.criado_em || null,
        historico_rodadas: historicoAtualizado,
      }
    : {
        ...resumoAnterior,
        rodada_atual: maiorRodada,
        ultima_simulacao: null,
        ultima_simulacao_em: null,
        historico_rodadas: historicoAtualizado,
        ctesAnalisados: 0,
        ctesSimulados: 0,
        ctesComTabelaSelecionada: 0,
        ctesGanhariaSelecionada: 0,
        ctesPerdidosSelecionada: 0,
        ctesSemTabelaSelecionada: 0,
        freteRealizado: 0,
        freteSelecionada: 0,
        faturamentoSelecionadaMes: 0,
        faturamentoSelecionadaAno: 0,
        faturamentoSelecionadaGanhadoraMes: 0,
        faturamentoSelecionadaGanhadoraAno: 0,
        savingSelecionadaVsReal: 0,
        savingSelecionadaVsRealMes: 0,
        savingSelecionadaVsRealAno: 0,
        aderenciaSelecionada: 0,
        cargasDia: 0,
        volumesDia: 0,
        volumes: 0,
        peso: 0,
        valorNF: 0,
        rotasGanhasDestaque: [],
        estadosGanhadoresDestaque: [],
        transportadorasPerdaDestaque: [],
      };

  const payload = {
    resumo_simulacao: resumoSimulacaoAtualizado,
    saving_projetado: numero(indUltima.saving_mes || resumoUltima.savingSelecionadaVsRealMes || 0),
    aderencia_projetada: numero(indUltima.aderencia || resumoUltima.aderenciaSelecionada || 0),
    faturamento_projetado: numero(indUltima.faturamento_mes || resumoUltima.faturamentoSelecionadaGanhadoraMes || resumoUltima.faturamentoSelecionadaMes || 0),
    impacto_projetado: numero(resumoUltima.diferencaSelecionadaVsVencedor || 0),
    percentual_frete_projetado: numero(indUltima.percentual_frete_simulado || resumoUltima.percentualFreteTabelaGanharia || resumoUltima.percentualFreteSelecionada || 0),
    volumetria_dia: numero(indUltima.pedidos_ganhos_dia || indUltima.pedidos_dia || resumoUltima.cargasDia || 0),
    ctes_analisados: inteiro(resumoUltima.ctesAnalisados || 0),
    ctes_atendidos: inteiro(resumoUltima.ctesComTabelaSelecionada || 0),
    rotas_sem_cobertura: inteiro(resumoUltima.ctesSemTabelaSelecionada || 0),
  };

  const { data, error } = await supabase
    .from('tabelas_negociacao')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(error.message || 'Erro ao excluir registro da rodada.');
  }

  return data;
}
`;

if (!service.includes('export async function excluirRegistroRodadaNegociacao')) {
  substituirEmService(
`export async function salvarResultadoSimulacaoNegociacao(id, resultado = {}) {`,
`${funcService}
export async function salvarResultadoSimulacaoNegociacao(id, resultado = {}) {`,
    'adiciona função excluirRegistroRodadaNegociacao'
  );
} else {
  console.log('SKIP service função excluirRegistroRodadaNegociacao já existe');
}

substituirEmPage(
`  salvarGeneralidades,
} from '../services/tabelasNegociacaoService';`,
`  salvarGeneralidades,
  excluirRegistroRodadaNegociacao,
} from '../services/tabelasNegociacaoService';`,
  'importa excluirRegistroRodadaNegociacao'
);

substituirEmPage(
`  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');`,
`  const [salvando, setSalvando] = useState(false);
  const [registroExclusaoPendente, setRegistroExclusaoPendente] = useState('');
  const [excluindoRegistroRodada, setExcluindoRegistroRodada] = useState('');
  const [erro, setErro] = useState('');`,
  'adiciona estados de exclusão visual'
);

const handlerPage = `
  async function handleExcluirRegistroRodada(rodada) {
    if (!selecionada || !rodada) return;
    var registroId = String(rodada.id || rodada.criado_em || '');
    var tipo = rodada.tipo_registro === 'SIMULACAO' ? 'simulação' : 'importação';

    if (!registroId) {
      setErro('Não foi possível identificar o registro da rodada para exclusão.');
      return;
    }

    if (registroExclusaoPendente !== registroId) {
      setRegistroExclusaoPendente(registroId);
      setErro('');
      setSucesso('Confirmação necessária: clique novamente em Confirmar apagar para excluir esta ' + tipo + ' da ' + (rodada.rodada || '-') + 'ª rodada.');
      return;
    }

    setExcluindoRegistroRodada(registroId);
    setSalvando(true); setErro(''); setSucesso('Excluindo registro da rodada...');
    try {
      var at = await excluirRegistroRodadaNegociacao(selecionada.id, registroId);
      setSelecionada(at);
      setTabelas(function(p) { return p.map(function(i) { return i.id === at.id ? at : i; }); });
      setRegistroExclusaoPendente('');
      setSucesso('Registro da rodada excluído. Os indicadores foram recalculados com a última simulação restante.');
    } catch (e) {
      setErro(e.message || 'Erro ao excluir registro da rodada.');
    } finally {
      setExcluindoRegistroRodada('');
      setSalvando(false);
    }
  }
`;

if (!page.includes('async function handleExcluirRegistroRodada(rodada)')) {
  if (page.includes(`  async function excluirTabela(tabela) {`)) {
    page = page.replace(`  async function excluirTabela(tabela) {`, `${handlerPage}
  async function excluirTabela(tabela) {`);
    alterou = true;
    console.log('OK page adiciona handler antes de excluirTabela');
  } else if (page.includes(`  async function salvarNovaTabela() {`)) {
    page = page.replace(`  async function salvarNovaTabela() {`, `${handlerPage}
  async function salvarNovaTabela() {`);
    alterou = true;
    console.log('OK page adiciona handler antes de salvarNovaTabela');
  } else {
    console.warn('WARN page ponto para handler de exclusão não encontrado');
  }
} else {
  console.log('SKIP page handler de exclusão já existe');
}

substituirEmPage(
`                        <th>Observação</th>
                      </tr>`,
`                        <th>Observação</th>
                        <th>Ações</th>
                      </tr>`,
  'adiciona coluna ações no histórico'
);

substituirEmPage(
`                        var isSim = rodada.tipo_registro === 'SIMULACAO';
                        return (`,
`                        var isSim = rodada.tipo_registro === 'SIMULACAO';
                        var registroIdExclusao = String(rodada.id || rodada.criado_em || idx);
                        var aguardandoConfirmacaoExclusao = registroExclusaoPendente === registroIdExclusao;
                        var apagandoRegistroAtual = excluindoRegistroRodada === registroIdExclusao;
                        return (`,
  'cria variáveis por linha para confirmação visual'
);

substituirEmPage(
`                            <td style={{ fontSize: 12, color: '#475569' }}>{rodada.observacao || rodada.origem_importacao || rodada.modo_substituicao || '-'}</td>
                          </tr>`,
`                            <td style={{ fontSize: 12, color: '#475569' }}>{rodada.observacao || rodada.origem_importacao || rodada.modo_substituicao || '-'}</td>
                            <td>
                              <button
                                className="sim-tab"
                                type="button"
                                disabled={salvando && !apagandoRegistroAtual}
                                onClick={function(event) { event.preventDefault(); event.stopPropagation(); handleExcluirRegistroRodada(rodada); }}
                                style={aguardandoConfirmacaoExclusao
                                  ? { color: '#fff', background: '#dc2626', borderColor: '#dc2626' }
                                  : { color: '#dc2626', borderColor: '#fecaca' }}
                              >
                                {apagandoRegistroAtual ? 'Apagando...' : aguardandoConfirmacaoExclusao ? 'Confirmar apagar' : 'Apagar'}
                              </button>
                            </td>
                          </tr>`,
  'adiciona botão apagar por linha do histórico'
);

substituirEmPage(
`                      {!historico.length ? <tr><td colSpan="9">Nenhuma rodada registrada ainda.</td></tr> : null}`,
`                      {!historico.length ? <tr><td colSpan="12">Nenhuma rodada registrada ainda.</td></tr> : null}`,
  'ajusta colspan do histórico vazio'
);

if (alterou) {
  fs.writeFileSync(servicePath, service, 'utf8');
  fs.writeFileSync(pagePath, page, 'utf8');
  console.log('\nPrompt 4.15 aplicado: exclusão de registro de rodada.');
} else {
  console.log('\nPrompt 4.15 já estava aplicado ou não encontrou trechos-alvo.');
}
