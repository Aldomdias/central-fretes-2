import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buscarCargaPorDistOuCte,
  carregarFluxoCargasLotacao,
  carregarFluxoCargasLotacaoCompleto,
  carregarLancamentosAuditoria,
  carregarSolicitacoesPagamento,
  criarLancamentoAuditoria,
  criarSolicitacaoPagamento,
  cteJaLancado,
  formatarDataCurta,
  formatarMoeda,
  normalizarTexto,
  salvarLancamentosAuditoria,
  salvarSolicitacoesPagamento,
  separarCtes,
} from '../utils/lotacaoFluxoCargas';
import {
  buscarCteLotacaoAuditoriaPorChaveSupabase,
  buscarCtesLotacaoAuditoriaPorChavesSupabase,
  buscarCtesLotacaoAuditoriaPorNumeroSupabase,
  carregarCargasLotacaoSupabase,
  carregarLancamentosAuditoriaSupabase,
  carregarPendenciasAuditoriaSupabase,
  carregarSolicitacoesInfoSupabase,
  carregarSolicitacoesSupabase,
  carregarTabelasLotacaoSupabase,
  registrarEventoHistoricoSupabase,
  atualizarPendenciaAuditoriaSupabase,
  atualizarSolicitacaoInfoSupabase,
  salvarLancamentoAuditoriaSupabase,
  salvarPendenciaAuditoriaSupabase,
  salvarSolicitacaoInfoSupabase,
  salvarSolicitacaoSupabase,
} from '../services/lotacaoSupabaseService';
import {
  carregarTabelasLotacao,
  pesquisarRotaLotacao,
} from '../utils/lotacaoTables';
import {
  carregarVinculosTransportadoras,
  salvarVinculosTransportadoras,
  removerVinculoTransportadora,
} from '../services/vinculosTransportadorasService';
import { carregarSessao } from '../utils/authLocal';

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ 4.34A — Auditoria Lotação como central única de auditoria operacional      ║
// ║                                                                            ║
// ║ Toda a lógica nova (consolidação DIST/HUB, saldo por viagem consolidada e  ║
// ║ vínculos de transportadora) vive NESTE arquivo, para não tocar no motor de ║
// ║ cálculo, services, simulador, tabelas de negociação ou laudos.             ║
// ╚══════════════════════════════════════════════════════════════════════════╝

const TOLERANCIA_SALDO = 1.0; // R$ — saldo <= isso (em módulo) => viagem fechada
const VINCULOS_STORAGE_KEY = 'central_fretes_lotacao_vinculos_transportadora_v1';

function classeSaldo(valor) {
  if (valor < -0.01) return 'negativo';
  if (valor > 0.01) return 'positivo';
  return '';
}

function pendenciaParaMovimentoAutorizacao(pendencia = {}) {
  return {
    id: pendencia.id,
    tipo: 'EXCEDENTE_AUDITORIA',
    origemSolicitacao: 'AUDITORIA',
    cargaId: pendencia.carga_id || '',
    dist: pendencia.dist || '',
    distKey: pendencia.dist_key || '',
    cte: pendencia.cte || '',
    fatura: pendencia.fatura || '',
    transportadora: pendencia.transportadora || '',
    valorAutorizadoCarga: pendencia.valor_original ?? pendencia.valor_autorizado,
    valorLancado: pendencia.valor_lancado,
    excedente: pendencia.valor_excedente,
    valorAdicional: pendencia.valor_adicional_aprovado ?? pendencia.valor_excedente,
    valorAdicionalAprovado: pendencia.valor_adicional_aprovado,
    valorFinalAutorizado: pendencia.valor_final_autorizado,
    status: pendencia.status || '',
    observacao: pendencia.observation || '',
    resposta: pendencia.resposta_operacao || pendencia.motivo_recusa || '',
    criadoEm: pendencia.created_at || '',
    atualizadoEm: pendencia.updated_at || '',
  };
}


function solicitacaoInfoParaMovimentoOperacao(sol = {}) {
  const chaveCte = sol.chaveCte || sol.chave_informada || sol.chaveInformada || '';
  const numeroCte = sol.cte || sol.numero_informado || sol.numeroInformado || '';
  const criadoEm = sol.created_at || sol.criadoEm || sol.criado_em || new Date().toISOString();
  return {
    ...sol,
    id: sol.id || `quest-${Date.now()}`,
    tipo: 'QUESTIONAMENTO_OPERACAO',
    tipoOriginal: sol.tipo || sol.tipoOriginal || 'CTE',
    origemSolicitacao: 'AUDITORIA_LOTACAO',
    categoria: 'QUESTIONAMENTO_OPERACAO',
    chaveCte,
    chave_informada: chaveCte,
    cte: numeroCte,
    numeroInformado: numeroCte,
    numero_informado: numeroCte,
    fatura: sol.fatura || '',
    transportadora: sol.transportadora || '',
    dist: sol.dist || sol.distKey || sol.dist_key || '',
    distKey: sol.distKey || sol.dist_key || sol.dist || '',
    status: sol.status || 'AGUARDANDO_INFORMACAO',
    prioridade: sol.prioridade || 'ALTA',
    motivoQuestionamento: sol.motivoQuestionamento || sol.motivo_questionamento || '',
    observacao: sol.observacao || sol.descricaoProblema || sol.descricao_problema || '',
    descricaoProblema: sol.descricaoProblema || sol.descricao_problema || sol.observacao || '',
    resposta: sol.resposta || sol.resposta_operacao || sol.observacao_tratamento || '',
    resposta_operacao: sol.resposta_operacao || sol.resposta || '',
    observacaoTratamento: sol.observacaoTratamento || sol.observacao_tratamento || '',
    respondidoPorNome: sol.respondido_por_nome || sol.respondidoPorNome || '',
    respondidoEm: sol.respondido_em || sol.respondidoEm || '',
    criadoEm,
    created_at: criadoEm,
    atualizadoEm: sol.updated_at || sol.atualizadoEm || '',
    valorAdicional: 0,
    excedente: 0,
  };
}

function statusGestaoAuditoria(status = '') {
  const raw = String(status || '').trim().toUpperCase();
  if (!raw) return 'SEM_STATUS';

  const aguardando = [
    'PENDENTE',
    'PENDENTE_OPERACAO',
    'AGUARDANDO_OPERACAO',
    'AGUARDANDO_INFORMACAO',
    'AGUARDANDO_INFORMAÇÃO',
    'EXCEDEU_AGUARDANDO_OPERACAO',
    'EM_ANALISE',
    'EM_ANÁLISE',
    'EM_TRATATIVA',
    'ABERTO',
  ];
  const aprovados = ['APROVADO', 'APROVADO_OPERACAO', 'AUTORIZADO', 'LIBERADO_PAGAMENTO'];
  const recusados = ['RECUSADO', 'RECUSADO_OPERACAO', 'REPROVADO', 'NEGADO'];
  const tratados = ['TRATADO', 'CONCLUIDO', 'CONCLUÍDO', 'FINALIZADO', 'AUDITADO_OK', 'BAIXADO', 'ENCERRADO'];
  const devolvidos = ['DEVOLVIDO_AUDITORIA', 'DEVOLVIDO', 'RETORNADO_AUDITORIA'];

  if (aguardando.includes(raw)) return 'AGUARDANDO';
  if (aprovados.includes(raw)) return 'APROVADO';
  if (recusados.includes(raw)) return 'RECUSADO';
  if (tratados.includes(raw)) return 'TRATADO';
  if (devolvidos.includes(raw)) return 'DEVOLVIDO';
  return raw;
}

function statusQuestionamentoAberto(status = '') {
  return statusGestaoAuditoria(status) === 'AGUARDANDO';
}

function statusAbertoGestaoAuditoria(status = '') {
  return statusGestaoAuditoria(status) === 'AGUARDANDO' || statusGestaoAuditoria(status) === 'DEVOLVIDO';
}

function statusTratadoGestaoAuditoria(status = '') {
  return ['APROVADO', 'RECUSADO', 'TRATADO'].includes(statusGestaoAuditoria(status));
}

function dataMovimentoAuditoria(item = {}) {
  return item.criadoEm || item.created_at || item.auditedAt || item.audited_at || item.atualizadoEm || item.updated_at || '';
}

function estaAtrasadoGestaoAuditoria(item = {}, horasLimite = 24) {
  if (!statusAbertoGestaoAuditoria(item.status)) return false;
  const prazo = item.prazoOperacaoEm || item.prazo_operacao_em || item.prazo || '';
  const dataPrazo = prazo ? new Date(prazo) : null;
  if (dataPrazo && !Number.isNaN(dataPrazo.getTime())) return dataPrazo.getTime() < Date.now();
  const dataBase = new Date(dataMovimentoAuditoria(item));
  if (Number.isNaN(dataBase.getTime())) return false;
  return (Date.now() - dataBase.getTime()) > (Number(horasLimite || 24) * 3600000);
}

function chaveSolicitacaoAuditoria(item = {}) {
  const tipoBase = item.tipo === 'QUESTIONAMENTO_OPERACAO' || item.categoria === 'QUESTIONAMENTO_OPERACAO'
    ? 'QUESTIONAMENTO'
    : 'EXCEDENTE';
  const cte = normalizarTexto(item.cte || item.numeroInformado || item.numero_informado || item.chaveCte || item.chave_informada || '');
  const fatura = normalizarTexto(item.fatura || '');
  const dist = consolidarChaveViagem(item.dist || item.distKey || item.dist_key || '');
  const motivo = tipoBase === 'QUESTIONAMENTO'
    ? normalizarTexto(item.motivoQuestionamento || item.motivo_questionamento || item.descricaoProblema || item.descricao_problema || '')
    : '';
  return [tipoBase, dist, cte, fatura, motivo].join('|');
}

function deduplicarSolicitacoesAuditoria(lista = []) {
  const prioridadeFonte = (item = {}) => {
    if (item.tipo === 'QUESTIONAMENTO_OPERACAO' || item.categoria === 'QUESTIONAMENTO_OPERACAO') return 3;
    if (item.tipo === 'EXCEDENTE_AUDITORIA' || item.origemSolicitacao === 'AUDITORIA') return 2;
    return 1;
  };

  const grupos = new Map();
  (lista || []).filter(Boolean).forEach((item, index) => {
    const chaveOperacional = chaveSolicitacaoAuditoria(item) || `SEM_CHAVE|${item.id || index}`;
    const grupo = grupos.get(chaveOperacional) || [];
    grupo.push(item);
    grupos.set(chaveOperacional, grupo);
  });

  const resultado = [];
  grupos.forEach((grupo) => {
    const maiorPrioridade = Math.max(...grupo.map(prioridadeFonte));
    const idsVistos = new Set();
    grupo
      .filter((item) => prioridadeFonte(item) === maiorPrioridade)
      .forEach((item) => {
        const chaveId = item.id ? `${maiorPrioridade}|${item.id}` : null;
        if (chaveId && idsVistos.has(chaveId)) return;
        if (chaveId) idsVistos.add(chaveId);
        resultado.push(item);
      });
  });

  return resultado
    .sort((a, b) => new Date(dataMovimentoAuditoria(b) || 0).getTime() - new Date(dataMovimentoAuditoria(a) || 0).getTime());
}

function mesclarSolicitacoesAuditoria({ solicitacoesLegadas = [], pendencias = [], questionamentos = [] } = {}) {
  const movimentosPendencias = Array.isArray(pendencias) ? pendencias.map(pendenciaParaMovimentoAutorizacao) : [];
  const questionamentosOperacao = Array.isArray(questionamentos)
    ? questionamentos
        .filter(ehQuestionamentoAuditoriaLotacao)
        .map(solicitacaoInfoParaMovimentoOperacao)
    : [];

  const chavesPrioritarias = new Set([
    ...movimentosPendencias.map(chaveSolicitacaoAuditoria),
    ...questionamentosOperacao.map(chaveSolicitacaoAuditoria),
  ]);

  const legadasSemDuplicar = (solicitacoesLegadas || []).filter((sol) => !chavesPrioritarias.has(chaveSolicitacaoAuditoria(sol)));
  return deduplicarSolicitacoesAuditoria([...questionamentosOperacao, ...movimentosPendencias, ...legadasSemDuplicar]);
}

function ehQuestionamentoAuditoriaLotacao(sol = {}) {
  return String(sol.descricaoProblema || sol.descricao_problema || '')
    .startsWith('Questionamento para Operação — Auditoria Lotação');
}

function cteContidoNaViagemAuditoria(viagem = {}, cte = {}) {
  if (!viagem || !cte) return false;
  const idsCte = identificadoresCteAuditoria(cte, cte.chave_cte || '')
    .map((item) => normalizarTexto(item))
    .filter(Boolean);
  if (!idsCte.length) return false;
  const ctesViagem = [
    ...(viagem.ctes || []),
    ...separarCtes(viagem.cteRaw || ''),
    ...((viagem.registrosOriginais || []).flatMap((reg) => [
      ...(reg.ctes || []),
      ...separarCtes(reg.cteRaw || ''),
    ])),
  ].map((item) => normalizarTexto(item)).filter(Boolean);
  if (!ctesViagem.length) return false;
  return idsCte.some((id) => ctesViagem.includes(id));
}

function dadosResumoCteQuestionamento(cte = {}) {
  return {
    chave: cte.chave_cte || '',
    numero: cte.numero_cte || '',
    transportadora: cte.transportadora || cte.transportadora_contratada || '',
    cnpjTransportadora: cte.cnpj_transportadora || '',
    origem: `${cte.cidade_origem || '-'}${cte.uf_origem ? `/${cte.uf_origem}` : ''}`,
    destino: `${cte.cidade_destino || '-'}${cte.uf_destino ? `/${cte.uf_destino}` : ''}`,
    emissao: cte.emissao || cte.data_emissao || '',
    valorCte: numeroAuditoria(cte.valor_cte),
    valorNf: numeroAuditoria(cte.valor_nf),
    peso: numeroAuditoria(cte.peso_declarado || cte.peso_cubado),
    tomador: cte.tomador || cte.raw?.tomador || cte.raw?.nomeTomador || '',
    canal: cte.canal || '',
  };
}

function diagnosticarQuestionamentoOperacao({ cte, viagem, tabelasCompativeis = [], tabelaSelecionada = null, sugestoesViagens = [], sugestoesVinculoTransportadora = [], sugestoesConsultadas = false, vinculos = [] }) {
  if (!cte) return [];
  const motivos = [];

  if (!tabelasCompativeis?.length) {
    motivos.push('Tabela de lotação não encontrada com a mesma transportadora, origem e destino do CT-e.');
  } else if (tabelaSelecionada?.statusComparacao === 'DIVERGENTE') {
    motivos.push('Tabela de lotação encontrada, porém o valor diverge da DIST/base da auditoria.');
  }

  if (sugestoesConsultadas && !sugestoesViagens.length) {
    motivos.push('Nenhuma DIST/viagem foi encontrada com a mesma transportadora, origem e destino do CT-e.');
  }

  if (sugestoesConsultadas && !sugestoesViagens.length && sugestoesVinculoTransportadora.length) {
    motivos.push('Há viagens na mesma rota, mas pertencem a transportadora diferente da transportadora do CT-e.');
  }

  if (viagem) {
    const transpCte = cte.transportadora || cte.transportadora_contratada || '';
    const transpViagem = viagem.transportadora || '';
    if (transpCte && transpViagem && !transportadorasEquivalentesAuditoria(transpCte, transpViagem, vinculos)) {
      motivos.push('A viagem/DIST selecionada pertence a transportadora diferente da transportadora do CT-e.');
    }
    if (!cteContidoNaViagemAuditoria(viagem, cte)) {
      motivos.push('A viagem/DIST selecionada não possui este CT-e na relação de CT-es do realizado.');
    }
  }

  motivos.push('Necessidade de validação manual pela Operação.');
  return [...new Set(motivos)];
}

function montarDescricaoQuestionamentoOperacao({ cte, viagem, tabelaAuditoria = [], motivo, observacao, sugestoesViagens = [], sugestoesVinculoTransportadora = [] }) {
  const cteInfo = dadosResumoCteQuestionamento(cte);
  const tabela = tabelaAuditoria?.[0] || null;
  const linhas = [
    'Questionamento para Operação — Auditoria Lotação',
    '',
    `Motivo principal: ${motivo || '-'}`,
    `Observação do auditor: ${observacao || '-'}`,
    '',
    'Dados do CT-e encontrado na base:',
    `- Chave CT-e: ${cteInfo.chave || '-'}`,
    `- Número CT-e: ${cteInfo.numero || '-'}`,
    `- Transportadora CT-e: ${cteInfo.transportadora || '-'}`,
    `- CNPJ transportadora: ${cteInfo.cnpjTransportadora || '-'}`,
    `- Origem: ${cteInfo.origem || '-'}`,
    `- Destino: ${cteInfo.destino || '-'}`,
    `- Emissão: ${cteInfo.emissao ? formatarDataCurta(cteInfo.emissao) : '-'}`,
    `- Valor CT-e: ${formatarMoeda(cteInfo.valorCte)}`,
    `- Valor NF: ${formatarMoeda(cteInfo.valorNf)}`,
    `- Peso: ${cteInfo.peso ? `${cteInfo.peso.toLocaleString('pt-BR')} kg` : '-'}`,
    `- Tomador: ${cteInfo.tomador || '-'}`,
    `- Canal/Operação: ${cteInfo.canal || '-'}`,
  ];

  if (viagem) {
    const referencia = viagem.valorReferenciaAuditoria || calcularReferenciaAuditoria(viagem, cte);
    linhas.push(
      '',
      'DIST/viagem analisada:',
      `- DIST/viagem: ${viagem.dist || '-'}`,
      `- Transportadora viagem: ${viagem.transportadora || '-'}`,
      `- Rota viagem: ${viagem.origem || '-'} x ${viagem.destino || '-'}${viagem.ufDestino ? `/${viagem.ufDestino}` : ''}`,
      `- Data coleta: ${formatarDataCurta(viagem.coletaRealizada || viagem.coletaPlanejada)}`,
      `- Valor base auditoria: ${formatarMoeda(referencia.valorBaseAuditoria || viagem.valorComparacao || 0)}`,
      `- Valor alternativo: ${referencia.valorAlternativo ? formatarMoeda(referencia.valorAlternativo) : '-'}`,
      `- CT-es da viagem: ${(viagem.ctes || separarCtes(viagem.cteRaw || '')).join('; ') || '-'}`,
    );
  }

  linhas.push('', 'Tabela de lotação:');
  if (tabela) {
    linhas.push(
      `- Tabela/transportadora: ${tabela.tabelaNome || tabela.transportadora || '-'}`,
      `- Valor tabela: ${tabela.valorTabela ? formatarMoeda(tabela.valorTabela) : '-'}`,
      `- Status: ${tabela.statusLabel || tabela.statusComparacao || '-'}`,
      `- Diferença tabela x base: ${tabela.valorTabela ? formatarMoeda(tabela.diferencaBase) : '-'}`,
      `- Critérios: ${(tabela.motivosTabela || []).join(', ') || '-'}`,
    );
  } else {
    linhas.push('- Não encontrada para a rota/transportadora pesquisada.');
  }

  if (sugestoesViagens.length) {
    linhas.push('', 'Sugestões válidas de casamento encontradas:');
    sugestoesViagens.slice(0, 5).forEach(({ viagem: item, motivos }, index) => {
      linhas.push(`${index + 1}. ${item.dist || '-'} · ${item.transportadora || '-'} · ${item.origem || '-'} x ${item.destino || '-'} · ${motivos?.join(', ') || '-'}`);
    });
  }

  if (sugestoesVinculoTransportadora.length) {
    linhas.push('', 'Sugestões apenas para vínculo de transportadora:');
    sugestoesVinculoTransportadora.slice(0, 5).forEach(({ viagem: item, motivos }, index) => {
      linhas.push(`${index + 1}. ${item.dist || '-'} · ${item.transportadora || '-'} · ${item.origem || '-'} x ${item.destino || '-'} · ${motivos?.join(', ') || '-'}`);
    });
  }

  return linhas.join('\n');
}

function adicionarHorasIso(dataBase, horas) {
  const base = dataBase ? new Date(dataBase) : new Date();
  if (Number.isNaN(base.getTime())) return new Date().toISOString();
  return new Date(base.getTime() + (Number(horas || 0) * 3600000)).toISOString();
}

function cteParaFiltrosRota(cte = {}) {
  return {
    origem: cte.cidade_origem || '',
    destino: cte.cidade_destino || '',
    transportadora: cte.transportadora || cte.transportadora_contratada || '',
    tipo: '',
  };
}


// ─── VALOR DE REFERÊNCIA DA AUDITORIA (4.34A.3) ─────────────────────────────
// A lotação pode trazer Valor da viagem, Frete Cantu e Frete Transportadora.
// Como alguns fretes vêm com ICMS e outros sem ICMS, a auditoria deve usar o
// valor disponível que estiver MAIS PRÓXIMO do valor do CT-e encontrado.
function numeroAuditoria(valor) {
  if (valor === null || valor === undefined || valor === '') return 0;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  const texto = String(valor)
    .replace(/R\$/gi, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^0-9.-]/g, '');
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : 0;
}

function analisarChavesCteLote(texto = '') {
  const tokens = String(texto || '')
    .split(/[\s,;]+/g)
    .map((item) => item.replace(/\D/g, ''))
    .filter(Boolean);
  const vistas = new Set();
  const validas = [];
  const duplicadas = [];
  const invalidas = [];

  tokens.forEach((token) => {
    if (token.length !== 44) {
      invalidas.push(token);
      return;
    }
    if (vistas.has(token)) {
      duplicadas.push(token);
      return;
    }
    vistas.add(token);
    validas.push(token);
  });

  return {
    lidas: tokens.length,
    validas,
    invalidas,
    duplicadas,
  };
}

function identificadoresCteAuditoria(cte = {}, chaveFallback = '') {
  const registro = cte || {};
  return [
    registro.chave_cte,
    registro.numero_cte,
    registro.cte,
    chaveFallback,
  ].map((item) => normalizarTexto(item || '')).filter(Boolean);
}

function cteJaLancadoEmOutraViagem(lancamentos = [], viagem, identificadores = []) {
  const ids = new Set((identificadores || []).map((item) => normalizarTexto(item)).filter(Boolean));
  if (!ids.size) return false;
  const chaveViagemAtual = viagem ? (viagem.chaveViagem || consolidarChaveViagem(viagem.dist)) : '';

  return (lancamentos || []).some((item) => {
    const chaveLancamento = consolidarChaveViagem(item.dist || item.distKey || '');
    if (chaveViagemAtual && chaveLancamento === chaveViagemAtual) return false;
    return ids.has(normalizarTexto(item.cte || item.cteKey || ''));
  });
}

function adicionarCandidatoValor(lista, fonte, valor, detalhe = '') {
  const numero = numeroAuditoria(valor);
  if (!numero || numero <= 0) return;
  const chave = `${fonte}|${numero.toFixed(2)}|${detalhe}`;
  if (lista.some((item) => item.chave === chave)) return;
  lista.push({ chave, fonte, valor: Number(numero.toFixed(2)), detalhe });
}

function candidatosValorAuditoria(viagem = {}) {
  const candidatos = [];
  adicionarCandidatoValor(candidatos, 'Valor informado da viagem', viagem.valorComparacao);
  adicionarCandidatoValor(candidatos, 'Frete Cantu', viagem.freteCantu);
  adicionarCandidatoValor(candidatos, 'Frete Transportadora', viagem.freteTransp);

  for (const [idx, reg] of (viagem.registrosOriginais || []).entries()) {
    const detalhe = reg.dist ? `registro ${reg.dist}` : `registro ${idx + 1}`;
    adicionarCandidatoValor(candidatos, 'Valor informado da viagem', reg.valorComparacao, detalhe);
    adicionarCandidatoValor(candidatos, 'Frete Cantu', reg.freteCantu, detalhe);
    adicionarCandidatoValor(candidatos, 'Frete Transportadora', reg.freteTransp, detalhe);
  }

  // Remove duplicidades por valor+fonte, mantendo a primeira ocorrência para a tela ficar limpa.
  const vistos = new Set();
  return candidatos.filter((item) => {
    const chave = `${item.fonte}|${item.valor.toFixed(2)}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

function calcularReferenciaAuditoria(viagem = {}, cte = {}) {
  const candidatos = candidatosValorAuditoria(viagem);
  const fallback = numeroAuditoria(viagem.valorComparacao) || candidatos[0]?.valor || 0;
  const valorCte = numeroAuditoria(cte?.valor_cte ?? cte?.valorCte ?? cte?.valor_total);

  const candidatosBase = candidatos.length
    ? candidatos
    : fallback > 0
      ? [{
          chave: `fallback|${Number(fallback).toFixed(2)}`,
          fonte: 'Valor informado da viagem',
          valor: Number(fallback.toFixed(2)),
          detalhe: 'fallback',
        }]
      : [];

  if (!candidatosBase.length) {
    return {
      valorReferencia: 0,
      valorBaseAuditoria: 0,
      valorAlternativo: 0,
      fonte: 'Valor informado da viagem',
      fonteBaseAuditoria: 'Valor informado da viagem',
      fonteAlternativa: '',
      detalhe: '',
      detalheAlternativo: '',
      valorCte: 0,
      diferenca: 0,
      candidatos: [],
      casamentoValor: null,
      criterio: 'Sem valor disponível para definir base de auditoria.',
    };
  }

  const maiorValor = Math.max(...candidatosBase.map((item) => Number(item.valor) || 0));
  const menorValor = Math.min(...candidatosBase.map((item) => Number(item.valor) || 0));

  const baseAuditoria = candidatosBase.find(
    (item) => Math.abs((Number(item.valor) || 0) - maiorValor) <= 0.009,
  ) || candidatosBase[0];

  const alternativoMenor = candidatosBase
    .filter((item) => Math.abs((Number(item.valor) || 0) - maiorValor) > 0.009)
    .sort((a, b) => (Number(a.valor) || 0) - (Number(b.valor) || 0))[0] || null;

  const candidatosComparados = candidatosBase
    .map((item) => {
      const valorItem = Number(item.valor) || 0;
      const diferenca = valorCte ? Number(Math.abs(valorItem - valorCte).toFixed(2)) : 0;
      const percentual = valorCte && valorItem
        ? diferenca / Math.max(valorCte, valorItem)
        : 0;
      const tipo = Math.abs(valorItem - maiorValor) <= 0.009
        ? 'BASE_MAIOR'
        : 'ALTERNATIVO_MENOR';

      return {
        ...item,
        valor: Number(valorItem.toFixed(2)),
        tipo,
        diferenca,
        percentual,
        compativel: Boolean(valorCte && valorItem && percentual <= 0.12),
      };
    })
    .sort((a, b) => {
      if (!valorCte) return b.valor - a.valor;
      if (a.diferenca !== b.diferenca) return a.diferenca - b.diferenca;
      if (a.tipo !== b.tipo) return a.tipo === 'BASE_MAIOR' ? -1 : 1;
      return b.valor - a.valor;
    });

  const casamentoValor = valorCte ? candidatosComparados[0] || null : null;

  let criterio = 'Maior valor disponível usado como saldo base da auditoria.';
  if (valorCte && casamentoValor?.compativel) {
    criterio = casamentoValor.tipo === 'BASE_MAIOR'
      ? 'Maior valor mantido como saldo base; CT-e/lote compatível com o valor base de auditoria.'
      : 'Maior valor mantido como saldo base; CT-e/lote compatível com o valor alternativo menor.';
  } else if (valorCte) {
    criterio = 'Maior valor mantido como saldo base; CT-e/lote comparado também contra valores alternativos.';
  }

  return {
    valorReferencia: Number(maiorValor.toFixed(2)),
    valorBaseAuditoria: Number(maiorValor.toFixed(2)),
    valorAlternativo: alternativoMenor ? Number(alternativoMenor.valor.toFixed(2)) : 0,
    menorValorDisponivel: Number(menorValor.toFixed(2)),
    fonte: baseAuditoria.fonte || 'Valor informado da viagem',
    fonteBaseAuditoria: baseAuditoria.fonte || 'Valor informado da viagem',
    fonteAlternativa: alternativoMenor?.fonte || '',
    detalhe: baseAuditoria.detalhe || '',
    detalheAlternativo: alternativoMenor?.detalhe || '',
    valorCte,
    diferenca: casamentoValor?.diferenca || 0,
    candidatos: candidatosComparados,
    casamentoValor,
    criterio,
  };
}

function aplicarReferenciaAuditoria(viagem, cte) {
  if (!viagem) return null;
  const referencia = calcularReferenciaAuditoria(viagem, cte);
  const valorBaseAuditoria = referencia.valorBaseAuditoria || referencia.valorReferencia || viagem.valorComparacao || 0;

  return {
    ...viagem,
    valorComparacaoOriginal: viagem.valorComparacaoOriginal ?? viagem.valorComparacao,
    valorComparacao: valorBaseAuditoria,
    valorBaseAuditoria,
    valorAlternativoAuditoria: referencia.valorAlternativo || 0,
    valorReferenciaAuditoria: referencia,
  };
}

// ─── CONSOLIDAÇÃO DE DIST / HUB ───────────────────────────────────────────────
// Remove sufixos de parte/ocorrência (" 1", "-2", "/3") tratando-os como
// pedaços da MESMA viagem, não como viagens independentes.
//   DIST-12651 1 => DIST-12651   |  12651-2 => 12651  |  HUB-12651 2 => HUB-12651
function distExibicao(distRaw = '') {
  const bruto = String(distRaw || '').trim();
  if (!bruto) return '';
  const base = bruto.replace(/[\s\-_/]+\d{1,2}\s*$/, '').trim();
  return base || bruto;
}

function consolidarChaveViagem(distRaw = '') {
  const base = distExibicao(distRaw);
  return normalizarTexto(base || distRaw);
}

// Recarrega lançamentos re-chaveados pela viagem consolidada, para que os
// utilitários de saldo (que filtram por distKey) enxerguem lançamentos antigos
// gravados com sufixo (ex.: "DIST-12651 1") junto com os novos consolidados.
function reKeyLancamentosPorViagem(lancamentos = []) {
  return (lancamentos || []).map((item) => ({
    ...item,
    distKey: consolidarChaveViagem(item.dist || item.distKey || ''),
  }));
}

function lancamentosDaViagem(lancamentos = [], chaveViagem = '') {
  if (!chaveViagem) return [];
  return (lancamentos || []).filter(
    (item) => consolidarChaveViagem(item.dist || item.distKey || '') === chaveViagem,
  );
}

function chaveRegistroOriginalAuditoria(registro = {}) {
  return [
    normalizarTexto(registro.dist || ''),
    numeroAuditoria(registro.valorComparacao).toFixed(2),
    numeroAuditoria(registro.freteCantu).toFixed(2),
    numeroAuditoria(registro.freteTransp).toFixed(2),
    numeroAuditoria(registro.pedagio).toFixed(2),
    numeroAuditoria(registro.icmsRemovido).toFixed(2),
  ].join('|');
}

function dataImportacaoRegistro(registro = {}) {
  const valor = new Date(registro.importadoEm || registro.created_at || 0).getTime();
  return Number.isNaN(valor) ? 0 : valor;
}

function deduplicarRegistrosOriginais(registros = []) {
  const unicos = new Map();

  for (const registro of registros || []) {
    const chave = chaveRegistroOriginalAuditoria(registro);
    const existente = unicos.get(chave);
    if (!existente || dataImportacaoRegistro(registro) > dataImportacaoRegistro(existente)) {
      unicos.set(chave, registro);
    }
  }

  return [...unicos.values()].sort(
    (a, b) => dataImportacaoRegistro(b) - dataImportacaoRegistro(a),
  );
}

function alteracoesRegistroAuditoria(atual = {}, anterior = {}) {
  const alteracoes = [];
  const compararValor = (label, campo) => {
    if (Math.abs(numeroAuditoria(atual[campo]) - numeroAuditoria(anterior[campo])) > 0.009) {
      alteracoes.push(label);
    }
  };

  compararValor('valor informado', 'valorComparacao');
  compararValor('Frete Cantu', 'freteCantu');
  compararValor('frete transportadora', 'freteTransp');
  compararValor('pedágio', 'pedagio');
  compararValor('ICMS removido', 'icmsRemovido');

  return alteracoes;
}

// Agrupa cargas que pertencem à mesma viagem em um único objeto "viagem
// consolidada" que se comporta como uma carga para os utilitários existentes.
function consolidarViagens(cargas = []) {
  const mapa = new Map();
  for (const carga of cargas || []) {
    const chave = consolidarChaveViagem(carga.dist) || normalizarTexto(carga.dist || '');
    if (!chave) continue;
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push(carga);
  }

  const viagens = [];
  for (const [chave, registrosBrutos] of mapa.entries()) {
    const registros = deduplicarRegistrosOriginais(registrosBrutos);
    const base = registros[0] || {};
    const distLabel = distExibicao(base.dist) || base.dist || chave;

    // Valor total da viagem: as linhas duplicadas trazem o MESMO total.
    // Usamos o maior valor informado como total da viagem (= valor único
    // quando todas as linhas coincidem). Nunca somamos as duplicatas.
    const valoresInformados = [
      ...new Set(
        registros
          .map((r) => Number(r.valorComparacao) || 0)
          .filter((v) => v > 0)
          .map((v) => Number(v.toFixed(2))),
      ),
    ].sort((a, b) => b - a);
    const valorTotalViagem = valoresInformados[0] || 0;

    const ctesConsolidados = [
      ...new Set(
        registros.flatMap((r) => (r.ctes?.length ? r.ctes : separarCtes(r.cteRaw || ''))),
      ),
    ].filter(Boolean);

    viagens.push({
      // herda campos de exibição/rota do primeiro registro
      ...base,
      id: `viagem:${chave}`,
      chaveViagem: chave,
      dist: distLabel,         // chaveDist(dist) => chave consolidada
      distKey: chave,
      valorComparacao: valorTotalViagem,
      valoresInformados,
      ctes: ctesConsolidados,
      cteRaw: registros.map((r) => r.cteRaw).filter(Boolean).join('; '),
      registrosOriginais: registros,
      qtdRegistros: registros.length,
    });
  }

  return viagens;
}

// Resumo de saldo de uma viagem consolidada (regra 4.34A).
function resumoViagem(viagem, lancamentos = []) {
  if (!viagem) return null;
  const valorTotal = Number(viagem.valorComparacao) || 0;
  const lancs = lancamentosDaViagem(lancamentos, viagem.chaveViagem || consolidarChaveViagem(viagem.dist));
  const valorAuditado = lancs.reduce((acc, l) => acc + (Number(l.valorLancado) || 0), 0);
  const saldoPendente = Number((valorTotal - valorAuditado).toFixed(2));
  const ctesVinculados = lancs.map((l) => l.cte).filter(Boolean);

  let status = 'PENDENTE';
  if (valorAuditado > 0.009) {
    status = Math.abs(saldoPendente) <= TOLERANCIA_SALDO ? 'AUDITADA' : 'PARCIAL';
  }

  return { valorTotal, valorAuditado, saldoPendente, ctesVinculados, lancamentos: lancs, status };
}

// ─── SUGESTÕES DE CASAMENTO COM O REALIZADO ───────────────────────────────────
// 4.34A.5.1 — Transportadora é critério obrigatório para casamento.
// Viagem de transportadora diferente NÃO entra na lista principal.
// 4.34A.5.1.1 — Se não houver casamento válido, mostrar seção separada para avaliar vínculo.

function normalizarTransportadoraAuditoria(nome = '') {
  return normalizarTexto(nome || '')
    .replace(/\bS\s*A\b/g, ' ')
    .replace(/\b(LTDA|EIRELI|ME|EPP|SA|S\/A|LOGISTICA|TRANSPORTES|TRANSPORTE|TRANSPORTADORA|TRANS|EXPRESSO|EXPRESS)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function transportadorasEquivalentesAuditoria(nomeCte = '', nomeViagem = '', vinculos = []) {
  const brutoCte = normalizarTexto(nomeCte || '');
  const brutoViagem = normalizarTexto(nomeViagem || '');
  if (!brutoCte || !brutoViagem) return false;

  if (brutoCte === brutoViagem) return true;

  const simplesCte = normalizarTransportadoraAuditoria(nomeCte);
  const simplesViagem = normalizarTransportadoraAuditoria(nomeViagem);
  if (!simplesCte || !simplesViagem) return false;
  return simplesCte === simplesViagem
    || simplesCte.startsWith(`${simplesViagem} `)
    || simplesViagem.startsWith(`${simplesCte} `);
}

function scoreSugestaoHistorico(carga = {}, cte = {}, vinculos = []) {
  const origem = normalizarTexto(cte.cidade_origem || '');
  const destino = normalizarTexto(cte.cidade_destino || '');
  const ufOrigem = normalizarTexto(cte.uf_origem || '');
  const ufDestino = normalizarTexto(cte.uf_destino || '');
  const nomeCte = cte.transportadora || cte.transportadora_contratada || '';
  const nomeCarga = carga.transportadora || '';
  const cteNumero = normalizarTexto(cte.numero_cte || '');

  const transportadoraOk = transportadorasEquivalentesAuditoria(nomeCte, nomeCarga, vinculos);
  const origemCarga = normalizarTexto(carga.origem || '');
  const destinoCarga = normalizarTexto(carga.destino || '');
  const ufOrigemCarga = normalizarTexto(carga.ufOrigem || '');
  const ufDestinoCarga = normalizarTexto(carga.ufDestino || '');
  const origemOk = Boolean(origem && origemCarga && origem === origemCarga)
    && (!ufOrigem || !ufOrigemCarga || ufOrigem === ufOrigemCarga);
  const destinoOk = Boolean(destino && destinoCarga && destino === destinoCarga)
    && (!ufDestino || !ufDestinoCarga || ufDestino === ufDestinoCarga);

  // Auditoria não oferece aproximações: transportadora, origem e destino são obrigatórios.
  if (!transportadoraOk || !origemOk || !destinoOk) {
    return { score: 0, motivos: [], transportadoraOk: false };
  }

  let score = 69;
  const motivos = ['mesma transportadora', 'mesma origem', 'mesmo destino'];

  if (cteNumero && normalizarTexto(carga.cteRaw || '').includes(cteNumero)) {
    score += 45;
    motivos.push('CT-e encontrado na viagem');
  }

  const emissao = cte.emissao ? new Date(cte.emissao).getTime() : 0;
  const dataCarga = new Date(carga.coletaRealizada || carga.coletaPlanejada || carga.importadoEm || 0).getTime();
  if (emissao && dataCarga) {
    const dias = Math.abs(emissao - dataCarga) / 86400000;
    if (dias <= 7) {
      score += 10;
      motivos.push('data próxima');
    } else if (dias <= 30) {
      score += 4;
      motivos.push('mesmo período aproximado');
    }
  }

  const valorCte = numeroAuditoria(cte.valor_cte || 0);
  const referenciaValor = calcularReferenciaAuditoria(carga, cte);
  const casamentoValor = referenciaValor.casamentoValor;

  if (valorCte && casamentoValor?.valor) {
    const dif = casamentoValor.percentual ?? (
      Math.abs(valorCte - casamentoValor.valor) / Math.max(valorCte, casamentoValor.valor)
    );

    if (dif <= 0.12) {
      score += 8;

      if (casamentoValor.tipo === 'BASE_MAIOR') {
        motivos.push(`valor compatível com valor base de auditoria (${casamentoValor.fonte})`);
      } else {
        motivos.push(`valor compatível pelo valor alternativo menor (${casamentoValor.fonte})`);
      }
    }
  }

  return { score, motivos, transportadoraOk: true, referenciaValor };
}

function scoreSugestaoVinculoTransportadora(carga = {}, cte = {}, vinculos = []) {
  const nomeCte = cte.transportadora || cte.transportadora_contratada || '';
  const nomeCarga = carga.transportadora || '';

  if (!nomeCte || !nomeCarga) return { score: 0, motivos: [] };
  if (transportadorasEquivalentesAuditoria(nomeCte, nomeCarga, vinculos)) return { score: 0, motivos: [] };

  const origem = normalizarTexto(cte.cidade_origem || '');
  const destino = normalizarTexto(cte.cidade_destino || '');
  const ufOrigem = normalizarTexto(cte.uf_origem || '');
  const ufDestino = normalizarTexto(cte.uf_destino || '');
  const cteNumero = normalizarTexto(cte.numero_cte || '');
  const origemCarga = normalizarTexto(carga.origem || '');
  const destinoCarga = normalizarTexto(carga.destino || '');
  const ufOrigemCarga = normalizarTexto(carga.ufOrigem || '');
  const ufDestinoCarga = normalizarTexto(carga.ufDestino || '');
  const rotaExata = Boolean(origem && origemCarga && origem === origemCarga)
    && Boolean(destino && destinoCarga && destino === destinoCarga)
    && (!ufOrigem || !ufOrigemCarga || ufOrigem === ufOrigemCarga)
    && (!ufDestino || !ufDestinoCarga || ufDestino === ufDestinoCarga);

  if (!rotaExata) return { score: 0, motivos: [] };

  let score = 34;
  const motivos = ['transportadora diferente', 'mesma origem', 'mesmo destino'];

  if (cteNumero && normalizarTexto(carga.cteRaw || '').includes(cteNumero)) {
    score += 25;
    motivos.push('CT-e encontrado na viagem');
  }

  const emissao = cte.emissao ? new Date(cte.emissao).getTime() : 0;
  const dataCarga = new Date(carga.coletaRealizada || carga.coletaPlanejada || carga.importadoEm || 0).getTime();
  if (emissao && dataCarga) {
    const dias = Math.abs(emissao - dataCarga) / 86400000;
    if (dias <= 7) {
      score += 10;
      motivos.push('data próxima');
    } else if (dias <= 30) {
      score += 4;
      motivos.push('mesmo período aproximado');
    }
  }

  return { score, motivos };
}

function gerarSugestoesViagemAuditoria(cargas = [], cte = {}, vinculos = []) {
  const viagens = consolidarViagens(cargas);

  const analisadas = viagens.map((viagem) => {
    let melhorCasamento = { score: 0, motivos: [], transportadoraOk: false };
    let melhorVinculo = { score: 0, motivos: [] };

    for (const reg of viagem.registrosOriginais || [viagem]) {
      const casamento = scoreSugestaoHistorico(reg, cte, vinculos);
      if (casamento.score > melhorCasamento.score) melhorCasamento = casamento;

      const vinculo = scoreSugestaoVinculoTransportadora(reg, cte, vinculos);
      if (vinculo.score > melhorVinculo.score) melhorVinculo = vinculo;
    }

    return { viagem, casamento: melhorCasamento, vinculo: melhorVinculo };
  });

  const casamento = analisadas
    .filter((item) => item.casamento.transportadoraOk && item.casamento.score >= 40)
    .map((item) => ({
      viagem: aplicarReferenciaAuditoria(item.viagem, cte),
      score: item.casamento.score,
      motivos: item.casamento.motivos,
      referenciaValor: item.casamento.referenciaValor,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const vinculosPossiveis = casamento.length
    ? []
    : analisadas
      .filter((item) => item.vinculo.score >= 18)
      .map((item) => ({ viagem: item.viagem, score: item.vinculo.score, motivos: item.vinculo.motivos }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

  return { casamento, vinculosPossiveis };
}

// Mantém compatibilidade com trechos antigos: retorna somente sugestões válidas de casamento.
function sugerirViagensPorCte(cargas = [], cte = {}, vinculos = []) {
  return gerarSugestoesViagemAuditoria(cargas, cte, vinculos).casamento;
}

// ─── VÍNCULOS DE TRANSPORTADORA ────────────────────────────────────────────────
// Usa a tabela central transportadora_vinculos via service e mantém fallback local.
function carregarVinculos() {
  try {
    const parsed = JSON.parse(localStorage.getItem(VINCULOS_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function salvarVinculos(vinculos = []) {
  try {
    localStorage.setItem(VINCULOS_STORAGE_KEY, JSON.stringify(vinculos));
  } catch (e) {
    console.warn('[Auditoria] Não foi possível salvar vínculos localmente:', e.message);
  }
}

function vinculoGlobalParaAuditoria(item = {}) {
  return {
    id: item.id || `${normalizarTexto(item.nomeCte || item.nome_cte)}__${normalizarTexto(item.nomeTabela || item.nome_tabela)}`,
    nomeRealizado: item.nomeTabela || item.nome_tabela || item.nomeRealizado || '',
    nomeCteTabela: item.nomeCte || item.nome_cte || item.nomeCteTabela || '',
    cnpj: item.cnpj || item.cnpj_transportadora || '',
    atualizadoEm: item.updatedAt || item.updated_at || item.atualizadoEm || '',
    origem: item.origem || 'manual',
  };
}

function vinculoAuditoriaParaGlobal(item = {}) {
  return {
    id: item.id,
    nomeCte: item.nomeCteTabela || item.nomeCte || item.nome_cte || '',
    nomeTabela: item.nomeRealizado || item.nomeTabela || item.nome_tabela || '',
    origem: item.origem || 'auditoria_lotacao',
  };
}

function nomeCanonicoTransportadora(nome, vinculos = []) {
  const alvo = normalizarTexto(nome || '');
  if (!alvo) return nome || '';
  const achado = (vinculos || []).find(
    (v) => normalizarTexto(v.nomeRealizado || v.nomeTabela || v.nome_tabela) === alvo
      || normalizarTexto(v.nomeCteTabela || v.nomeCte || v.nome_cte) === alvo
      || normalizarTexto(v.cnpj) === alvo,
  );
  return achado ? (achado.nomeRealizado || achado.nomeTabela || nome || '') : (nome || '');
}


// ─── TABELA DE LOTAÇÃO APLICÁVEL À AUDITORIA (4.34A.5.3) ────────────────────
// A comparação deve partir da DIST/viagem consolidada selecionada. O CT-e entra
// como apoio/fallback para transportadora e rota quando a viagem ainda não foi
// selecionada manualmente.
function normalizarCidadeAuditoria(valor = '') {
  return normalizarTexto(valor || '')
    .replace(/\bCIDADE\b/g, ' ')
    .replace(/\bMUNICIPIO\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rotaCompativelAuditoria(alvo = '', candidato = '') {
  const a = normalizarCidadeAuditoria(alvo);
  const b = normalizarCidadeAuditoria(candidato);
  if (!a || !b) return false;
  return a === b;
}

function ufCompativelAuditoria(alvo = '', candidato = '') {
  const a = normalizarTexto(alvo || '');
  const b = normalizarTexto(candidato || '');
  if (!a || !b) return false;
  return a === b;
}

function tipoVeiculoCompativelAuditoria(alvo = '', candidato = '') {
  const a = normalizarTexto(alvo || '');
  const b = normalizarTexto(candidato || '');
  if (!a || !b) return true;
  return a === b || a.includes(b) || b.includes(a);
}

function montarFiltrosTabelaLotacaoAuditoria(viagem = {}, cte = {}) {
  return {
    origem: viagem?.origem || cte?.cidade_origem || '',
    ufOrigem: viagem?.ufOrigem || cte?.uf_origem || '',
    destino: viagem?.destino || cte?.cidade_destino || '',
    ufDestino: viagem?.ufDestino || cte?.uf_destino || '',
    tipo: viagem?.tipoVeiculo || '',
    transportadora: viagem?.transportadora || cte?.transportadora || cte?.transportadora_contratada || '',
    transportadoraCte: cte?.transportadora || cte?.transportadora_contratada || '',
  };
}

function linhaTabelaParaAuditoria(linha = {}, tabela = {}, idx = 0, origemResultado = 'busca-auditoria') {
  return {
    ...linha,
    id: linha.id || linha.chave || `${tabela.id || tabela.nome || 'tabela'}-${idx}`,
    tabelaId: linha.tabelaId || tabela.id || '',
    tabelaNome: linha.tabelaNome || tabela.nome || linha.transportadora || '',
    transportadora: linha.transportadora || tabela.nome || linha.tabelaNome || '',
    origem: linha.origem || '',
    ufOrigem: linha.ufOrigem || linha.uf_origem || '',
    destino: linha.destino || '',
    ufDestino: linha.ufDestino || linha.uf_destino || '',
    tipo: linha.tipo || linha.tipoVeiculo || linha.tipo_veiculo || '',
    valor: numeroAuditoria(linha.valor ?? linha.frete ?? linha.valorTabela ?? linha.freteTabela),
    valorFonte: linha.valorFonte || linha.valor_fonte || '',
    origemResultado,
  };
}

function chaveTabelaAuditoria(item = {}) {
  return [
    item.tabelaId || item.tabelaNome || item.transportadora || '',
    item.id || item.chave || '',
    normalizarTexto(item.transportadora || item.tabelaNome || ''),
    normalizarTexto(item.origem || ''),
    normalizarTexto(item.destino || ''),
    normalizarTexto(item.tipo || ''),
    numeroAuditoria(item.valor).toFixed(2),
  ].join('|');
}

function scoreTabelaLotacaoAuditoria(item = {}, filtros = {}, vinculos = []) {
  const nomesTransportadora = [
    item.transportadora,
    item.tabelaNome,
  ].filter(Boolean);

  const nomesBusca = [
    filtros.transportadora,
    filtros.transportadoraCte,
  ].filter(Boolean);

  const transportadoraOk = !nomesBusca.length || nomesTransportadora.some((nomeTabela) => (
    nomesBusca.some((nomeBusca) => transportadorasEquivalentesAuditoria(nomeBusca, nomeTabela, vinculos))
  ));

  if (!transportadoraOk) return { ok: false, score: 0, motivos: [] };

  const origemOk = rotaCompativelAuditoria(filtros.origem, item.origem)
    && ufCompativelAuditoria(filtros.ufOrigem, item.ufOrigem);
  if (!origemOk) return { ok: false, score: 0, motivos: [] };

  const destinoOk = rotaCompativelAuditoria(filtros.destino, item.destino)
    && ufCompativelAuditoria(filtros.ufDestino, item.ufDestino);
  if (!destinoOk) return { ok: false, score: 0, motivos: [] };

  const motivos = ['mesma transportadora', 'mesma rota'];
  let score = 80;

  if (filtros.ufDestino && item.ufDestino) {
    score += 5;
    motivos.push('mesma UF destino');
  }

  if (filtros.tipo && item.tipo) {
    score += 5;
    motivos.push('mesmo tipo de veículo');
  }

  if (item.valor) score += 5;

  return { ok: true, score, motivos };
}

function compararTabelaComViagem(item = {}, viagem = {}, cte = {}) {
  const referencia = viagem?.valorReferenciaAuditoria || calcularReferenciaAuditoria(viagem || {}, cte || {});
  const registroAtual = viagem?.registrosOriginais?.[0] || viagem || {};
  const valorTabela = numeroAuditoria(item.valor);
  const valorDist = numeroAuditoria(
    viagem?.valorComparacaoOriginal
      ?? registroAtual.valorComparacao
      ?? viagem?.valorComparacao,
  );
  const valorBaseAuditoria = numeroAuditoria(
    referencia?.valorBaseAuditoria
      ?? viagem?.valorBaseAuditoria
      ?? viagem?.valorComparacao,
  );
  const valorAlternativo = numeroAuditoria(
    referencia?.valorAlternativo
      ?? viagem?.valorAlternativoAuditoria,
  );
  const valorFreteCantu = numeroAuditoria(viagem?.freteCantu ?? registroAtual.freteCantu);
  const valorFreteTransp = numeroAuditoria(viagem?.freteTransp ?? registroAtual.freteTransp);

  const diferencaBase = valorTabela && valorBaseAuditoria
    ? Number((valorBaseAuditoria - valorTabela).toFixed(2))
    : 0;
  const diferencaDist = valorTabela && valorDist
    ? Number((valorDist - valorTabela).toFixed(2))
    : 0;
  const percentualBase = valorTabela && valorBaseAuditoria
    ? Math.abs(diferencaBase) / Math.max(valorTabela, valorBaseAuditoria)
    : 0;

  const toleranciaMoeda = 1;
  const toleranciaPercentual = 0.005;
  const bateBase = valorTabela && valorBaseAuditoria
    && (Math.abs(diferencaBase) <= toleranciaMoeda || percentualBase <= toleranciaPercentual);
  const bateAlternativo = valorTabela && valorAlternativo
    && Math.abs(valorAlternativo - valorTabela) <= toleranciaMoeda;
  const bateDist = valorTabela && valorDist
    && Math.abs(valorDist - valorTabela) <= toleranciaMoeda;

  let statusComparacao = 'SEM_VALOR';
  let statusLabel = 'Tabela sem valor';
  let detalheComparacao = 'Tabela encontrada, mas sem valor de frete para comparar.';

  if (valorTabela) {
    if (bateBase) {
      statusComparacao = 'ADERENTE';
      statusLabel = 'Aderente à base';
      detalheComparacao = 'Valor da tabela está aderente ao maior valor usado como base da auditoria.';
    } else if (bateAlternativo) {
      statusComparacao = 'ADERENTE_ALTERNATIVO';
      statusLabel = 'Aderente ao alternativo';
      detalheComparacao = 'Valor da tabela bate com o valor alternativo aceito para casamento.';
    } else if (bateDist) {
      statusComparacao = 'ADERENTE_DIST';
      statusLabel = 'Aderente à DIST';
      detalheComparacao = 'Valor da tabela bate com o valor original/listado da DIST.';
    } else {
      statusComparacao = 'DIVERGENTE';
      statusLabel = 'Divergente';
      detalheComparacao = 'Valor da tabela difere do valor DIST/base. Sinalizar para análise, sem bloquear auditoria.';
    }
  }

  return {
    ...item,
    valorTabela,
    valorDist,
    valorBaseAuditoria,
    valorAlternativo,
    valorFreteCantu,
    valorFreteTransp,
    diferencaBase,
    diferencaDist,
    percentualBase,
    statusComparacao,
    statusLabel,
    detalheComparacao,
  };
}

function buscarTabelaLotacaoAuditoria({ tabelas = [], filtros = {}, viagem = {}, cte = {}, vinculos = [], resultadosBase = [] }) {
  const candidatos = [];

  for (const [idx, item] of (resultadosBase || []).entries()) {
    const candidato = linhaTabelaParaAuditoria(item, { id: item.tabelaId, nome: item.tabelaNome }, idx, 'pesquisa-existente');
    const avaliacao = scoreTabelaLotacaoAuditoria(candidato, filtros, vinculos);
    if (!avaliacao.ok) continue;
    candidatos.push({ ...candidato, scoreTabela: avaliacao.score, motivosTabela: avaliacao.motivos });
  }

  for (const tabela of tabelas || []) {
    const linhas = Array.isArray(tabela.linhas) ? tabela.linhas : [];
    for (const [idx, linha] of linhas.entries()) {
      const item = linhaTabelaParaAuditoria(linha, tabela, idx, 'auditoria-4.34A.5.3');
      const avaliacao = scoreTabelaLotacaoAuditoria(item, filtros, vinculos);
      if (!avaliacao.ok) continue;
      candidatos.push({ ...item, scoreTabela: avaliacao.score, motivosTabela: avaliacao.motivos });
    }
  }

  const unicos = new Map();
  for (const item of candidatos) {
    const chave = chaveTabelaAuditoria(item);
    const atual = unicos.get(chave);
    if (!atual || (item.scoreTabela || 0) > (atual.scoreTabela || 0)) {
      unicos.set(chave, item);
    }
  }

  return [...unicos.values()]
    .map((item) => compararTabelaComViagem(item, viagem, cte))
    .sort((a, b) => {
      if ((b.scoreTabela || 0) !== (a.scoreTabela || 0)) return (b.scoreTabela || 0) - (a.scoreTabela || 0);
      const da = Math.abs(a.diferencaBase || 0);
      const db = Math.abs(b.diferencaBase || 0);
      return da - db;
    })
    .slice(0, 10);
}

// ════════════════════════════ COMPONENTES ════════════════════════════════════

function CardCteEncontrado({ cte, onUsar }) {
  if (!cte) return null;
  const tomador = cte.tomador || cte.raw?.tomador || cte.raw?.nomeTomador || '-';
  return (
    <div className="panel-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Dados oficiais do CT-e</div>
          <p>
            {cte.numero_cte || '-'} · {cte.transportadora || cte.transportadora_contratada || '-'} ·{' '}
            {cte.cidade_origem || '-'} x {cte.cidade_destino || '-'}/{cte.uf_destino || '-'}
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => onUsar(cte)}>Usar dados do CT-e</button>
      </div>
      <div className="sim-analise-resumo">
        <div><span>Chave CT-e</span><strong style={{ fontSize: '0.74rem' }}>{cte.chave_cte || '-'}</strong></div>
        <div><span>Número CT-e</span><strong>{cte.numero_cte || '-'}</strong></div>
        <div><span>Transportadora</span><strong>{cte.transportadora || cte.transportadora_contratada || '-'}</strong></div>
        <div><span>CNPJ transp.</span><strong>{cte.cnpj_transportadora || '-'}</strong></div>
        <div><span>Origem</span><strong>{cte.cidade_origem || '-'}/{cte.uf_origem || '-'}</strong></div>
        <div><span>Destino</span><strong>{cte.cidade_destino || '-'}/{cte.uf_destino || '-'}</strong></div>
        <div><span>Emissão</span><strong>{formatarDataCurta(cte.emissao)}</strong></div>
        <div><span>Canal/Operação</span><strong>{cte.canal || '-'}</strong></div>
        <div><span>Tomador</span><strong>{tomador}</strong></div>
        <div><span>Valor CT-e</span><strong>{formatarMoeda(cte.valor_cte)}</strong></div>
        <div><span>Valor NF</span><strong>{formatarMoeda(cte.valor_nf)}</strong></div>
        <div><span>Peso</span><strong>{Number(cte.peso_declarado || cte.peso_cubado || 0).toLocaleString('pt-BR')} kg</strong></div>
      </div>
    </div>
  );
}

function ValidacaoTabelaLotacao({ resultados, viagem, tabelaSelecionada, onSelecionar }) {
  if (!resultados?.length) {
    return (
      <div className="hint-box compact">
        Tabela de lotação não encontrada com a mesma transportadora, origem e destino do CT-e.
      </div>
    );
  }

  if (!tabelaSelecionada) {
    return (
      <div className="table-card lotacao-table-card">
        <div className="section-row compact-top" style={{ padding: '0.75rem 1rem 0.25rem' }}>
          <div>
            <div className="panel-title">Tabela de lotação encontrada</div>
            <p>Selecione explicitamente a tabela que será usada. Somente aparecem resultados com transportadora, origem e destino iguais aos do CT-e.</p>
          </div>
          <span className="status-pill dark">Aguardando seleção</span>
        </div>
        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead>
              <tr><th>Transportadora/tabela</th><th>Origem</th><th>Destino</th><th>Tipo</th><th>Valor tabela</th><th>Ação</th></tr>
            </thead>
            <tbody>
              {resultados.slice(0, 5).map((item, idx) => (
                <tr key={`${item.tabelaId || item.id}-${idx}`}>
                  <td><strong>{item.tabelaNome || item.transportadora || '-'}</strong></td>
                  <td>{item.origem}/{item.ufOrigem || ''}</td>
                  <td>{item.destino}/{item.ufDestino || ''}</td>
                  <td>{item.tipo || '-'}</td>
                  <td><strong>{item.valorTabela ? formatarMoeda(item.valorTabela) : '-'}</strong></td>
                  <td><button type="button" className="btn-secondary" onClick={() => onSelecionar(item)}>Usar esta tabela</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (!viagem) {
    return <div className="hint-box compact">Tabela selecionada. Agora selecione uma DIST/viagem para iniciar a comparação.</div>;
  }

  const principal = tabelaSelecionada;
  const statusClass = principal.statusComparacao === 'DIVERGENTE'
    ? 'error'
    : principal.statusComparacao === 'SEM_VALOR'
      ? ''
      : 'dark';

  return (
    <div className="table-card lotacao-table-card">
      <div className="section-row compact-top" style={{ padding: '0.75rem 1rem 0.25rem' }}>
        <div>
          <div className="panel-title">Tabela de lotação aplicável</div>
          <p>Comparação da tabela com a DIST/viagem consolidada selecionada. Divergência sinaliza análise, sem bloquear auditoria.</p>
        </div>
        <span className={`status-pill ${statusClass}`}>{principal.statusLabel}</span>
      </div>

      <div className="sim-analise-resumo" style={{ padding: '0 1rem 0.75rem' }}>
        <div><span>Valor tabela</span><strong>{principal.valorTabela ? formatarMoeda(principal.valorTabela) : '-'}</strong></div>
        <div><span>Valor DIST/listado</span><strong>{principal.valorDist ? formatarMoeda(principal.valorDist) : '-'}</strong></div>
        <div><span>Valor base auditoria</span><strong>{principal.valorBaseAuditoria ? formatarMoeda(principal.valorBaseAuditoria) : '-'}</strong></div>
        <div><span>Valor alternativo</span><strong>{principal.valorAlternativo ? formatarMoeda(principal.valorAlternativo) : '-'}</strong></div>
        <div><span>Diferença tabela x base</span><strong className={classeSaldo(principal.diferencaBase)}>{principal.valorTabela ? formatarMoeda(principal.diferencaBase) : '-'}</strong></div>
      </div>

      <div className="hint-box compact" style={{ margin: '0 1rem 0.75rem' }}>{principal.detalheComparacao}</div>

      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>Transportadora/tabela</th>
              <th>Origem</th>
              <th>Destino</th>
              <th>Tipo</th>
              <th>Valor tabela</th>
              <th>Status</th>
              <th>Critério</th>
            </tr>
          </thead>
          <tbody>
            {resultados.slice(0, 5).map((item, idx) => {
              const rowClass = item.statusComparacao === 'DIVERGENTE'
                ? 'error'
                : item.statusComparacao === 'SEM_VALOR'
                  ? ''
                  : 'dark';
              return (
                <tr key={`${item.tabelaId || item.id}-${idx}`}>
                  <td>
                    <strong>{item.tabelaNome || item.transportadora || '-'}</strong>
                    <small style={{ display: 'block' }}>{item.valorFonte || item.origemResultado || '-'}</small>
                  </td>
                  <td>{item.origem}/{item.ufOrigem || ''}</td>
                  <td>{item.destino}/{item.ufDestino || ''}</td>
                  <td>{item.tipo || '-'}</td>
                  <td><strong>{item.valorTabela ? formatarMoeda(item.valorTabela) : '-'}</strong></td>
                  <td><span className={`status-pill ${rowClass}`}>{item.statusLabel}</span></td>
                  <td>{(item.motivosTabela || ['rota compatível']).join(', ')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SugestoesViagens({ sugestoes, onUsar }) {
  if (!sugestoes?.length) {
    return <div className="hint-box compact">Nenhuma DIST/viagem encontrada com a mesma transportadora, origem e destino do CT-e.</div>;
  }
  return (
    <div className="table-card lotacao-table-card">
      <div className="panel-title" style={{ padding: '0.75rem 1rem 0.25rem' }}>Sugestões de casamento com o realizado</div>
      <div className="hint-box compact" style={{ margin: '0 1rem 0.75rem' }}>
        Correspondência exata: só aparecem viagens com a mesma transportadora, origem e destino do CT-e. A seleção é manual.
      </div>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead><tr><th>Viagem</th><th>Transportadora</th><th>Rota</th><th>Data</th><th>Total viagem</th><th>Confiança</th><th>Motivo</th><th>Ação</th></tr></thead>
          <tbody>
            {sugestoes.map(({ viagem, score, motivos, referenciaValor }) => (
              <tr key={viagem.id}>
                <td><strong>{viagem.dist}</strong>{viagem.qtdRegistros > 1 ? ` · ${viagem.qtdRegistros} reg.` : ''}</td>
                <td>{viagem.transportadora}</td>
                <td>{viagem.origem} x {viagem.destino}</td>
                <td>{formatarDataCurta(viagem.coletaRealizada || viagem.coletaPlanejada)}</td>
                <td>
                  <strong>{formatarMoeda(referenciaValor?.valorBaseAuditoria || viagem.valorComparacao)}</strong>
                  <small style={{ display: 'block' }}>
                    Alternativo: {referenciaValor?.valorAlternativo
                      ? formatarMoeda(referenciaValor.valorAlternativo)
                      : '-'}
                  </small>
                </td>
                <td>{score >= 70 ? 'Alta' : score >= 40 ? 'Média' : 'Baixa'}</td>
                <td>{motivos.join(', ') || '-'}</td>
                <td><button type="button" className="btn-secondary" onClick={() => onUsar(viagem)}>Usar esta viagem</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SugestoesVinculoTransportadora({ sugestoes, onAnalisar }) {
  if (!sugestoes?.length) return null;

  return (
    <div className="table-card lotacao-table-card">
      <div className="panel-title" style={{ padding: '0.75rem 1rem 0.25rem' }}>Sugestões para vínculo de transportadora</div>
      <div className="hint-box compact" style={{ margin: '0 1rem 0.75rem' }}>
        Nenhuma sugestão válida de casamento foi encontrada com a mesma transportadora. As viagens abaixo são apenas para análise de possível vínculo. Não liberam auditoria direta antes da confirmação do vínculo.
      </div>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead><tr><th>Viagem</th><th>Transportadora da viagem</th><th>Rota</th><th>Data</th><th>Total viagem</th><th>Motivo</th><th>Ação</th></tr></thead>
          <tbody>
            {sugestoes.map(({ viagem, motivos }) => (
              <tr key={`vinculo-${viagem.id}`}>
                <td><strong>{viagem.dist}</strong>{viagem.qtdRegistros > 1 ? ` · ${viagem.qtdRegistros} reg.` : ''}</td>
                <td>{viagem.transportadora}</td>
                <td>{viagem.origem} x {viagem.destino}</td>
                <td>{formatarDataCurta(viagem.coletaRealizada || viagem.coletaPlanejada)}</td>
                <td>{formatarMoeda(viagem.valorComparacao)}</td>
                <td>{motivos.join(', ') || 'avaliar vínculo'}</td>
                <td><button type="button" className="btn-secondary" onClick={() => onAnalisar(viagem)}>Analisar vínculo</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ListaViagens({ viagens, selecionada, onSelecionar }) {
  if (!viagens.length) return null;
  return (
    <div className="mini-list top-space-sm">
      {viagens.map((item) => (
        <button
          key={item.id}
          type="button"
          className={selecionada?.id === item.id ? 'mini-list-row clickable active' : 'mini-list-row clickable'}
          onClick={() => onSelecionar(item)}
        >
          <span>
            <strong>{item.dist}</strong>{item.qtdRegistros > 1 ? ` · ${item.qtdRegistros} registros` : ''} · {item.transportadora} · {item.origem} x {item.destino}
          </span>
          <strong>{formatarMoeda(item.valorComparacao)}</strong>
        </button>
      ))}
    </div>
  );
}

function ResumoViagemCard({ viagem, lancamentos, cte, tabelaAuditoria = [] }) {
  if (!viagem) return null;
  const resumo = resumoViagem(viagem, lancamentos);
  const referencia = viagem.valorReferenciaAuditoria || calcularReferenciaAuditoria(viagem, cte);
  const ctes = viagem.ctes?.length ? viagem.ctes : separarCtes(viagem.cteRaw);
  const statusLabel = resumo.status === 'AUDITADA'
    ? 'Auditada / fechada'
    : resumo.status === 'PARCIAL'
    ? 'Parcialmente auditada'
    : 'Pendente';
  const registroAtual = viagem.registrosOriginais?.[0] || null;
  const tabelaPrincipal = tabelaAuditoria?.[0] || null;

  return (
    <div className="panel-card lotacao-auditoria-carga-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Viagem consolidada</div>
          <p>{viagem.dist} · {viagem.transportadora} · {viagem.origem} x {viagem.destino}/{viagem.ufDestino || '-'}</p>
        </div>
        <span className={`status-pill ${resumo.status === 'PARCIAL' ? '' : resumo.status === 'PENDENTE' ? 'error' : 'dark'}`}>
          {statusLabel}
        </span>
      </div>

      <div className="summary-strip lotacao-summary-mini">
        <div className="summary-card">
          <span>Valor base auditoria</span>
          <strong>{formatarMoeda(resumo.valorTotal)}</strong>
          <small>maior valor: {referencia.fonteBaseAuditoria || referencia.fonte}</small>
        </div>
        <div className="summary-card">
          <span>Valor alternativo / casamento</span>
          <strong>{referencia.valorAlternativo ? formatarMoeda(referencia.valorAlternativo) : '-'}</strong>
          <small>
            {referencia.valorAlternativo
              ? `${referencia.fonteAlternativa || 'menor valor'} · aceita sugestão se bater`
              : 'sem valor menor diferente'}
          </small>
        </div>
        <div className="summary-card">
          <span>Tabela lotação</span>
          <strong>{tabelaPrincipal?.valorTabela ? formatarMoeda(tabelaPrincipal.valorTabela) : '-'}</strong>
          <small>{tabelaPrincipal ? tabelaPrincipal.statusLabel : 'não encontrada'}</small>
        </div>
        <div className="summary-card">
          <span>Já auditado / vinculado</span>
          <strong>{formatarMoeda(resumo.valorAuditado)}</strong>
          <small>{resumo.ctesVinculados.length} CT-e(s) vinculado(s)</small>
        </div>
        <div className="summary-card">
          <span>Saldo pendente</span>
          <strong className={classeSaldo(resumo.saldoPendente)}>{formatarMoeda(resumo.saldoPendente)}</strong>
          <small>total − auditado</small>
        </div>
        <div className="summary-card">
          <span>Registros originais</span>
          <strong>{viagem.qtdRegistros}</strong>
          <small>consolidados em 1 viagem</small>
        </div>
      </div>

      {viagem.qtdRegistros > 1 && (
        <div className="sim-analise-tabela-wrap top-space-sm">
          <table className="sim-analise-tabela">
            <thead><tr><th>Registro original (DIST/HUB)</th><th>Origem</th><th>Destino</th><th>CT-e(s)</th><th>Valor informado</th></tr></thead>
            <tbody>
              {viagem.registrosOriginais.map((reg, idx) => {
                const alteracoes = idx > 0 && registroAtual
                  ? alteracoesRegistroAuditoria(registroAtual, reg)
                  : [];
                return (
                <tr key={`${reg.id || reg.dist}-${idx}`}>
                  <td>
                    <strong>{reg.dist}</strong>
                    <small style={{ display: 'block' }}>
                      {idx === 0
                        ? 'Versão atual'
                        : `Versão anterior${alteracoes.length ? ` · alterado: ${alteracoes.join(', ')}` : ''}`}
                    </small>
                  </td>
                  <td>{reg.origem}</td>
                  <td>{reg.destino}</td>
                  <td>{reg.cteRaw || (reg.ctes || []).join('; ') || '-'}</td>
                  <td>{formatarMoeda(reg.valorComparacao)}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="sim-analise-resumo top-space-sm">
        <div><span>Frete Cantu</span><strong>{formatarMoeda(viagem.freteCantu)}</strong></div>
        <div><span>Frete Transportadora</span><strong>{formatarMoeda(viagem.freteTransp)}</strong></div>
        <div><span>ICMS removido</span><strong>{formatarMoeda(viagem.icmsRemovido)}</strong></div>
        <div><span>Pedágio separado</span><strong>{formatarMoeda(viagem.pedagio)}</strong></div>
        <div><span>Tipo de veículo</span><strong>{viagem.tipoVeiculo || '-'}</strong></div>
        <div><span>CT-e(s) da viagem</span><strong>{ctes.join('; ') || '-'}</strong></div>
        <div><span>Valor DIST/listado</span><strong>{formatarMoeda(referencia.candidatos?.find((item) => item.fonte === 'Valor informado da viagem')?.valor || viagem.valorComparacaoOriginal || viagem.valorComparacao)}</strong></div>
        <div><span>Valor tabela lotação</span><strong>{tabelaPrincipal?.valorTabela ? formatarMoeda(tabelaPrincipal.valorTabela) : '-'}</strong></div>
        <div><span>Dif. tabela x base</span><strong className={tabelaPrincipal ? classeSaldo(tabelaPrincipal.diferencaBase) : ''}>{tabelaPrincipal?.valorTabela ? formatarMoeda(tabelaPrincipal.diferencaBase) : '-'}</strong></div>
        <div><span>Critério auditoria</span><strong>{referencia.valorCte ? 'maior base + alternativo' : 'maior valor disponível'}</strong></div>
        <div><span>Valor CT-e comparado</span><strong>{referencia.valorCte ? formatarMoeda(referencia.valorCte) : '-'}</strong></div>
      </div>

      {referencia.candidatos?.length > 1 && (
        <div className="hint-box compact top-space-sm">
          Base de auditoria escolhida: <strong>{referencia.fonteBaseAuditoria || referencia.fonte}</strong> {referencia.detalhe ? `(${referencia.detalhe}) ` : ''}
          pelo maior valor disponível. Candidatos: {referencia.candidatos.map((item) => `${item.fonte}: ${formatarMoeda(item.valor)}${item.diferenca !== undefined && referencia.valorCte ? ` (dif. CT-e ${formatarMoeda(item.diferenca)})` : ''}`).join(' · ')}
        </div>
      )}

      {viagem.regraCalculo && (
        <div className="hint-box compact top-space-sm">Regra aplicada na base: {viagem.regraCalculo}.</div>
      )}
    </div>
  );
}

// ─── FORMULÁRIO DE LANÇAMENTO ─────────────────────────────────────────────────
function FormLancamento({ viagem, lancamentos, solicitacoes, onRegistrar, salvando, usuarioAtual, valorSugerido, cteSugerido }) {
  const ctes = viagem?.ctes?.length ? viagem.ctes : separarCtes(viagem?.cteRaw || '');
  const lancConsolidados = useMemo(() => reKeyLancamentosPorViagem(lancamentos), [lancamentos]);

  const [form, setForm] = useState({
    cte: cteSugerido && ctes.includes(cteSugerido) ? cteSugerido : (ctes[0] || (cteSugerido ? 'OUTRO' : '')),
    cteOutro: cteSugerido && !ctes.includes(cteSugerido) ? cteSugerido : '',
    valorLancado: valorSugerido ? String(valorSugerido) : '',
    fatura: '',
    observacao: '',
  });

  if (!viagem) return null;

  const resumo = resumoViagem(viagem, lancamentos);
  const totalLancado = resumo.valorAuditado;
  const saldo = resumo.saldoPendente;
  const valorDigitado = Number(String(form.valorLancado || '').replace(',', '.')) || 0;
  const excedentePrevisto = Math.max(0, valorDigitado - Math.max(0, saldo));
  const cteEfetivo = form.cte === 'OUTRO' ? form.cteOutro : form.cte;
  const duplicado = cteJaLancado(lancConsolidados, viagem, cteEfetivo);
  const ctesLancados = resumo.ctesVinculados;

  const observacaoObrigatoria = excedentePrevisto > 0;
  const observacaoVazia = !form.observacao || !form.observacao.trim();
  const bloqueadoPorObservacao = observacaoObrigatoria && observacaoVazia;

  const registrar = () => {
    if (!valorDigitado || valorDigitado <= 0 || duplicado || bloqueadoPorObservacao) return;
    onRegistrar({
      ...form,
      cte: cteEfetivo,
      auditedByUserId: usuarioAtual?.id || '',
      auditedByName: usuarioAtual?.nome || '',
      auditedByEmail: usuarioAtual?.email || '',
      auditedAt: new Date().toISOString(),
      auditStatus: excedentePrevisto > 0 ? 'EXCEDEU_AGUARDANDO_OPERACAO' : 'AUDITADO_OK',
      auditExceededAmount: excedentePrevisto,
      auditAllowedAmount: Math.max(0, saldo),
      auditEnteredAmount: valorDigitado,
    });

    // 4.34A.4 — após salvar, não manter o CT-e recém-vinculado selecionado.
    // Como o pai atualiza os lançamentos em seguida, deixar o mesmo CT-e no select
    // fazia a tela exibir imediatamente o aviso de duplicidade, apesar do registro
    // ter sido salvo corretamente. O aviso deve aparecer apenas quando o usuário
    // consultar/tentar selecionar novamente um CT-e já vinculado.
    const cteSalvo = normalizarTexto(cteEfetivo || '');
    const proximoCteDisponivel = ctes.find((c) => (
      !cteJaLancado(lancConsolidados, viagem, c) && normalizarTexto(c) !== cteSalvo
    ));

    setForm({
      cte: proximoCteDisponivel || 'OUTRO',
      cteOutro: '',
      valorLancado: '',
      fatura: '',
      observacao: '',
    });
  };

  const atualizar = (campo, valor) => setForm((prev) => ({ ...prev, [campo]: valor }));

  return (
    <div className="panel-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Vincular CT-e à viagem</div>
          <p>Informe o CT-e, o valor e a fatura. O saldo é controlado pela viagem consolidada; CT-e já usado na viagem fica bloqueado.</p>
        </div>
        {usuarioAtual && <span className="status-pill">Auditor: {usuarioAtual.nome || usuarioAtual.email}</span>}
      </div>

      <div className="form-grid three">
        <label className="field">
          CT-e auditado
          {ctes.length ? (
            <select value={form.cte} onChange={(e) => atualizar('cte', e.target.value)}>
              {ctes.map((cte) => {
                const usado = cteJaLancado(lancConsolidados, viagem, cte);
                return (
                  <option key={cte} value={cte} disabled={usado}>
                    {cte}{usado ? ' · já vinculado' : ''}
                  </option>
                );
              })}
              <option value="DIST">Lançamento pela viagem</option>
              <option value="OUTRO">Outro CT-e</option>
            </select>
          ) : (
            <input value={form.cte} onChange={(e) => atualizar('cte', e.target.value)} placeholder="CT-e ou viagem" />
          )}
        </label>

        {form.cte === 'OUTRO' && (
          <label className="field">
            Informar outro CT-e
            <input value={form.cteOutro} onChange={(e) => atualizar('cteOutro', e.target.value)} placeholder="Número do CT-e" />
          </label>
        )}

        <label className="field">
          Valor lançado
          <input type="number" min="0" step="0.01" value={form.valorLancado}
            onChange={(e) => atualizar('valorLancado', e.target.value)} placeholder="Ex.: 10000" />
        </label>

        <label className="field">
          Fatura
          <input value={form.fatura} onChange={(e) => atualizar('fatura', e.target.value)} placeholder="Número da fatura" />
        </label>
      </div>

      <label className="field" style={{ marginTop: '0.75rem' }}>
        Observação{observacaoObrigatoria ? <span style={{ color: '#c0392b', marginLeft: 4 }}>*</span> : ''}
        <textarea
          value={form.observacao}
          onChange={(e) => atualizar('observacao', e.target.value)}
          placeholder={observacaoObrigatoria
            ? 'Justificativa obrigatória — informe o motivo do excedente para a operação.'
            : 'Observação da auditoria ou justificativa'}
          style={{
            borderColor: observacaoObrigatoria && observacaoVazia ? '#c0392b' : undefined,
            minHeight: observacaoObrigatoria ? 80 : 60,
          }}
        />
      </label>

      {observacaoObrigatoria && observacaoVazia && (
        <div className="hint-box compact error-text" style={{ marginTop: '0.5rem' }}>
          ⚠ Informe uma justificativa. O campo Observação é obrigatório quando o valor lançado ultrapassa o saldo da viagem.
        </div>
      )}

      <div className="sim-analise-resumo">
        <div><span>Saldo antes do lançamento</span><strong>{formatarMoeda(saldo)}</strong></div>
        <div><span>Valor digitado</span><strong>{formatarMoeda(valorDigitado)}</strong></div>
        <div><span>Excedente previsto</span><strong className={excedentePrevisto > 0 ? 'negativo' : ''}>{formatarMoeda(excedentePrevisto)}</strong></div>
        <div><span>Já auditado na viagem</span><strong>{formatarMoeda(totalLancado)}</strong></div>
      </div>

      {ctesLancados.length > 0 && (
        <div className="hint-box compact">CT-e(s) já vinculados nesta viagem: <strong>{ctesLancados.join(', ')}</strong>.</div>
      )}
      {duplicado && (
        <div className="hint-box compact error-text">Este CT-e já foi vinculado nesta viagem. Não é permitido vincular o mesmo CT-e duas vezes.</div>
      )}
      {excedentePrevisto > 0 && !duplicado && (
        <div className="hint-box compact error-text">
          Este lançamento passa do saldo da viagem. Ao registrar, o sistema cria uma pendência para aprovação na tela Lotação Operação.
        </div>
      )}

      <div className="actions-right">
        <button type="button" className="btn-primary"
          disabled={salvando || !valorDigitado || valorDigitado <= 0 || duplicado || (form.cte === 'OUTRO' && !form.cteOutro.trim()) || bloqueadoPorObservacao}
          title={bloqueadoPorObservacao ? 'Preencha a justificativa antes de registrar' : ''}
          onClick={registrar}>
          {salvando ? 'Salvando...' : excedentePrevisto > 0 ? 'Vincular e abrir pendência' : 'Vincular CT-e à viagem'}
        </button>
      </div>
    </div>
  );
}

function AuditoriaLoteCtes({
  viagem,
  lancamentos,
  texto,
  onTextoChange,
  analise,
  resultados,
  selecionados,
  buscando,
  salvando,
  onBuscar,
  onToggle,
  onToggleTodos,
  onVincular,
  onUsarCte,
  sugestoesViagens = [],
  onUsarViagem,
  mostrarEntrada = true,
}) {
  const resumo = viagem ? resumoViagem(viagem, lancamentos) : null;
  const selecionadosSet = new Set(selecionados || []);
  const validos = (resultados || []).filter((item) => item.selecionavel);
  const encontrados = (resultados || []).filter((item) => item.cte).length;
  const naoEncontrados = (resultados || []).filter((item) => item.status === 'NAO_ENCONTRADO').length;
  const vinculados = (resultados || []).filter((item) => item.status === 'JA_VINCULADO' || item.status === 'JA_VINCULADO_OUTRA').length;
  const valorSelecionado = (resultados || [])
    .filter((item) => selecionadosSet.has(item.chave))
    .reduce((acc, item) => acc + numeroAuditoria(item.cte?.valor_cte), 0);
  const saldoAtual = resumo?.saldoPendente || 0;
  const saldoApos = Number((saldoAtual - valorSelecionado).toFixed(2));
  const todosValidosSelecionados = validos.length > 0 && validos.every((item) => selecionadosSet.has(item.chave));

  return (
    <div className="panel-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Auditoria em lote por chaves CT-e</div>
          <p>Cole várias chaves para buscar, selecionar e vincular à mesma viagem consolidada.</p>
        </div>
        {viagem ? <span className="status-pill dark">Viagem: {viagem.dist}</span> : <span className="status-pill error">Selecione uma viagem</span>}
      </div>

      {mostrarEntrada && (
        <>
          <label className="field">
            Cole uma ou várias chaves CT-e
            <textarea
              value={texto}
              onChange={(e) => onTextoChange(e.target.value)}
              placeholder="Cole chaves por linha, vírgula, ponto e vírgula, espaço ou tab"
              style={{ minHeight: 90 }}
            />
          </label>

          <div className="actions-right top-space-sm">
            <button type="button" className="btn-secondary" onClick={onBuscar} disabled={buscando || salvando || !texto.trim()}>
              {buscando ? 'Buscando...' : 'Buscar CT-es'}
            </button>
          </div>
        </>
      )}

      <div className="summary-strip lotacao-summary-mini top-space-sm">
        <div className="summary-card"><span>Chaves lidas</span><strong>{analise.lidas}</strong></div>
        <div className="summary-card"><span>Válidas</span><strong>{analise.validas.length}</strong></div>
        <div className="summary-card"><span>Duplicadas ignoradas</span><strong>{analise.duplicadas.length}</strong></div>
        <div className="summary-card"><span>Encontradas</span><strong>{encontrados}</strong></div>
        <div className="summary-card"><span>Não encontradas</span><strong>{naoEncontrados}</strong></div>
        <div className="summary-card"><span>Já vinculadas</span><strong>{vinculados}</strong></div>
      </div>

      {analise.invalidas.length > 0 && (
        <div className="hint-box compact error-text">
          Chave(s) inválida(s) ignorada(s): {analise.invalidas.slice(0, 8).join(', ')}
          {analise.invalidas.length > 8 ? ` e mais ${analise.invalidas.length - 8}` : ''}.
        </div>
      )}

      {resultados.length > 0 && (
        <>
          <div className="sim-analise-resumo top-space-sm">
            <div><span>Valor total da viagem</span><strong>{formatarMoeda(resumo?.valorTotal || 0)}</strong></div>
            <div><span>Já auditado/vinculado</span><strong>{formatarMoeda(resumo?.valorAuditado || 0)}</strong></div>
            <div><span>Saldo pendente atual</span><strong>{formatarMoeda(saldoAtual)}</strong></div>
            <div><span>Valor selecionado</span><strong>{formatarMoeda(valorSelecionado)}</strong></div>
            <div><span>Saldo após lote</span><strong className={classeSaldo(saldoApos)}>{formatarMoeda(saldoApos)}</strong></div>
          </div>

          {saldoApos < -0.01 && (
            <div className="hint-box compact error-text">
              O lote selecionado ultrapassa o saldo pendente. Ao vincular, a regra atual abrirá pendência para aprovação quando houver excedente.
            </div>
          )}

          <div className="actions-right top-space-sm">
            <button type="button" className="btn-secondary" onClick={onToggleTodos} disabled={!validos.length || salvando}>
              {todosValidosSelecionados ? 'Limpar seleção' : 'Selecionar todos válidos'}
            </button>
            <button type="button" className="btn-primary" onClick={onVincular} disabled={!viagem || salvando || !selecionados.length}>
              {salvando ? 'Salvando...' : 'Vincular selecionados à viagem'}
            </button>
          </div>

          {!viagem && sugestoesViagens.length > 0 && (
            <div className="table-card lotacao-table-card top-space-sm">
              <div className="panel-title" style={{ padding: '0.75rem 1rem 0.25rem' }}>Escolha a viagem/DIST para liberar seleção</div>
              <div className="mini-list" style={{ padding: '0 1rem 1rem' }}>
                {sugestoesViagens.slice(0, 5).map(({ viagem: item, score, motivos }) => (
                  <button
                    key={item.id}
                    type="button"
                    className="mini-list-row clickable"
                    onClick={() => onUsarViagem?.(item)}
                  >
                    <span>
                      <strong>{item.dist}</strong>{item.qtdRegistros > 1 ? ` · ${item.qtdRegistros} registros` : ''} · {item.transportadora} · {item.origem} x {item.destino}
                      <small style={{ display: 'block', color: 'var(--muted)' }}>{motivos?.join(', ') || 'Sugestão por proximidade'} · {score >= 70 ? 'Alta' : score >= 40 ? 'Média' : 'Baixa'}</small>
                    </span>
                    <strong>{formatarMoeda(item.valorComparacao)}</strong>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="sim-analise-tabela-wrap top-space-sm">
            <table className="sim-analise-tabela">
              <thead>
                <tr><th>Selecionar</th><th>Ação</th><th>Chave CT-e</th><th>Número</th><th>Transportadora</th><th>Origem</th><th>Destino</th><th>Valor CT-e</th><th>Status</th><th>Observação</th></tr>
              </thead>
              <tbody>
                {resultados.map((item) => (
                  <tr key={item.chave}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selecionadosSet.has(item.chave)}
                        disabled={!item.selecionavel || salvando}
                        onChange={() => onToggle(item.chave)}
                      />
                    </td>
                    <td>
                      {item.cte ? (
                        <button type="button" className="btn-secondary" onClick={() => onUsarCte(item.cte)}>
                          Ver DIST
                        </button>
                      ) : '-'}
                    </td>
                    <td style={{ fontSize: 11 }}>{item.chave}</td>
                    <td>{item.cte?.numero_cte || '-'}</td>
                    <td>{item.cte?.transportadora || item.cte?.transportadora_contratada || '-'}</td>
                    <td>{item.cte?.cidade_origem || '-'}/{item.cte?.uf_origem || '-'}</td>
                    <td>{item.cte?.cidade_destino || '-'}/{item.cte?.uf_destino || '-'}</td>
                    <td>{formatarMoeda(item.cte?.valor_cte || 0)}</td>
                    <td><span className={`status-pill ${item.selecionavel ? '' : 'error'}`}>{item.statusLabel}</span></td>
                    <td>{item.observacao || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}


function QuestionamentoOperacaoCard({ cte, viagem, tabelasCompativeis = [], tabelaSelecionada, motivos = [], sugestoesConsultadas, onEnviar, salvando }) {
  const [motivoSelecionado, setMotivoSelecionado] = useState(motivos[0] || '');
  const [observacao, setObservacao] = useState('');
  const [prioridade, setPrioridade] = useState('ALTA');

  useEffect(() => {
    setMotivoSelecionado((atual) => (motivos.includes(atual) ? atual : (motivos[0] || '')));
  }, [motivos]);

  if (!cte) return null;
  if (!motivos.length) {
    return (
      <div className="hint-box compact">
        CT-e encontrado na base. Nenhum motivo automático de questionamento foi identificado neste momento. Se necessário, busque sugestões no realizado ou selecione uma DIST para comparar.
      </div>
    );
  }

  const enviar = () => {
    if (!motivoSelecionado) return;
    onEnviar?.({ motivo: motivoSelecionado, observacao, prioridade });
    setObservacao('');
  };

  return (
    <div className="panel-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Questionar Operação</div>
          <p>
            A solicitação só é aberta para CT-e encontrado na base. Ela seguirá com os dados oficiais do CT-e e o motivo operacional para validação.
          </p>
        </div>
        <span className="status-pill error">4.34A.5.4</span>
      </div>

      {!sugestoesConsultadas && (
        <div className="hint-box compact">
          Para questionar ausência de DIST/viagem, use primeiro <strong>Buscar sugestões no realizado</strong>. Para ausência de tabela, a solicitação já pode ser enviada.
        </div>
      )}

      <div className="sim-analise-resumo">
        <div><span>CT-e</span><strong>{cte.numero_cte || '-'}</strong></div>
        <div><span>Transportadora CT-e</span><strong>{cte.transportadora || cte.transportadora_contratada || '-'}</strong></div>
        <div><span>Rota CT-e</span><strong>{cte.cidade_origem || '-'}/{cte.uf_origem || '-'} x {cte.cidade_destino || '-'}/{cte.uf_destino || '-'}</strong></div>
        <div><span>Valor CT-e</span><strong>{formatarMoeda(cte.valor_cte || 0)}</strong></div>
        <div><span>DIST analisada</span><strong>{viagem?.dist || 'não selecionada'}</strong></div>
        <div>
          <span>Tabela lotação</span>
          <strong>
            {tabelaSelecionada?.valorTabela
              ? formatarMoeda(tabelaSelecionada.valorTabela)
              : tabelasCompativeis.length
                ? 'encontrada, não selecionada'
                : 'não encontrada'}
          </strong>
        </div>
      </div>

      <div className="form-grid three top-space-sm">
        <label className="field full-span">
          Motivo do questionamento
          <select value={motivoSelecionado} onChange={(e) => setMotivoSelecionado(e.target.value)}>
            {motivos.map((motivo) => <option key={motivo} value={motivo}>{motivo}</option>)}
          </select>
        </label>
        <label className="field">
          Prioridade
          <select value={prioridade} onChange={(e) => setPrioridade(e.target.value)}>
            <option value="NORMAL">Normal</option>
            <option value="ALTA">Alta</option>
            <option value="URGENTE">Urgente</option>
          </select>
        </label>
      </div>

      <label className="field top-space-sm">
        Observação do auditor
        <textarea
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          placeholder="Ex.: Validar se a DIST correta é outra, confirmar vínculo da transportadora ou informar por que a tabela não foi localizada."
          style={{ minHeight: 80 }}
        />
      </label>

      <div className="actions-right">
        <button type="button" className="btn-primary" onClick={enviar} disabled={salvando || !motivoSelecionado}>
          {salvando ? 'Enviando...' : 'Enviar questionamento para Operação'}
        </button>
      </div>
    </div>
  );
}

function HistoricoLancamentos({ viagem, lancamentos }) {
  if (!viagem) return null;
  const lista = lancamentosDaViagem(lancamentos, viagem.chaveViagem || consolidarChaveViagem(viagem.dist))
    .sort((a, b) => new Date(b.auditedAt || b.criadoEm).getTime() - new Date(a.auditedAt || a.criadoEm).getTime());
  if (!lista.length) return <div className="hint-box compact">Nenhum CT-e vinculado a esta viagem.</div>;

  return (
    <div className="table-card lotacao-table-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">CT-es vinculados à viagem</div>
          <p className="compact">Controle de saldo por CT-e/fatura.</p>
        </div>
      </div>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead>
            <tr><th>Data/Hora</th><th>Auditor</th><th>CT-e</th><th>Fatura</th><th>Valor lançado</th><th>Saldo anterior</th><th>Excedente</th><th>Status</th><th>Observação</th></tr>
          </thead>
          <tbody>
            {lista.map((item) => (
              <tr key={item.id}>
                <td>{formatarDataCurta(item.auditedAt || item.criadoEm)}</td>
                <td><span title={item.auditedByEmail || item.audited_by_email || ''}>{item.auditedByName || item.audited_by_name || '-'}</span></td>
                <td>{item.cte || '-'}</td>
                <td>{item.fatura || '-'}</td>
                <td>{formatarMoeda(item.valorLancado)}</td>
                <td>{formatarMoeda(item.saldoAnterior ?? item.totalAnterior)}</td>
                <td className={item.excedente > 0 ? 'negativo' : ''}>{formatarMoeda(item.excedente)}</td>
                <td><span className={`status-pill ${item.excedente > 0 ? 'error' : ''}`}>{item.auditStatus || item.audit_status || item.status}</span></td>
                <td>{item.observacao || item.audit_observation || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MovimentosAutorizacao({ viagem, solicitacoes }) {
  if (!viagem) return null;
  const chave = viagem.chaveViagem || consolidarChaveViagem(viagem.dist);
  const lista = (solicitacoes || [])
    .filter((item) => consolidarChaveViagem(item.dist || item.distKey || item.dist_key || '') === chave)
    .sort((a, b) => new Date(b.criadoEm || 0).getTime() - new Date(a.criadoEm || 0).getTime());
  if (!lista.length) return null;

  return (
    <div className="table-card lotacao-table-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Autorizações e custos da operação</div>
          <p className="compact">Aprovações ficam em Lotação Operação e, quando aprovadas, liberam saldo adicional para auditoria.</p>
        </div>
      </div>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead>
            <tr><th>Data</th><th>Tipo</th><th>Status</th><th>Valor</th><th>CT-e</th><th>Observação</th><th>Resposta</th></tr>
          </thead>
          <tbody>
            {lista.map((item) => (
              <tr key={item.id}>
                <td>{formatarDataCurta(item.criadoEm)}</td>
                <td>{item.tipo === 'CUSTO_ADICIONAL' ? item.tipoCusto || 'Custo adicional' : 'Excedente auditoria'}</td>
                <td><span className="status-pill">{item.status}</span></td>
                <td>{formatarMoeda(item.valorAdicional || item.excedente)}</td>
                <td>{item.cte || '-'}</td>
                <td>{item.observacao || '-'}</td>
                <td>{item.resposta || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Painel-resumo (topo) ─────────────────────────────────────────────────────
function PainelAuditoriaGeral({ lancamentos, solicitacoes, totalCargas, fonteCargas }) {
  const questionamentos = (solicitacoes || []).filter((item) => item.tipo === 'QUESTIONAMENTO_OPERACAO' || item.categoria === 'QUESTIONAMENTO_OPERACAO');
  const pendentes = (solicitacoes || []).filter((item) => statusAbertoGestaoAuditoria(item.status));
  const aprovados = (solicitacoes || []).filter((item) => ['APROVADO', 'TRATADO'].includes(statusGestaoAuditoria(item.status)));

  return (
    <div className="panel-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Resumo da auditoria de lotação</div>
          <p className="compact">Central única: base CT-e como fonte, casamento com o realizado e controle de saldo por viagem.</p>
        </div>
        <span className="status-pill dark" style={{ background: fonteCargas === 'supabase' ? undefined : '#b9770e' }}>
          {totalCargas.toLocaleString('pt-BR')} cargas {fonteCargas === 'supabase' ? '(Supabase)' : '(local)'}
        </span>
      </div>
      <div className="summary-strip lotacao-summary-mini">
        <div className="summary-card"><span>CT-es vinculados</span><strong>{(lancamentos || []).length.toLocaleString('pt-BR')}</strong><small>lançamentos auditados</small></div>
        <div className="summary-card"><span>Pendências abertas</span><strong>{pendentes.length.toLocaleString('pt-BR')}</strong><small>excedentes + questionamentos</small></div>
        <div className="summary-card"><span>Aprovados</span><strong>{aprovados.length.toLocaleString('pt-BR')}</strong><small>liberam saldo</small></div>
        <div className="summary-card"><span>Questionamentos</span><strong>{questionamentos.length.toLocaleString('pt-BR')}</strong><small>enviados à operação</small></div>
      </div>
    </div>
  );
}

// ─── Aba Histórico / Pendências ───────────────────────────────────────────────
function HistoricoPendencias({ lancamentos, solicitacoes, onAtualizarStatus, salvando = false }) {
  const [filtros, setFiltros] = useState({
    status: '',
    tipo: '',
    transportadora: '',
    cte: '',
    fatura: '',
    dist: '',
    motivo: '',
    dataInicio: '',
    dataFim: '',
    somenteAguardando: false,
    somenteAtrasadas: false,
    somenteTratadas: false,
  });
  const [detalhe, setDetalhe] = useState(null);
  const [statusNovo, setStatusNovo] = useState('');
  const [respostaTratamento, setRespostaTratamento] = useState('');

  const movimentos = useMemo(() => {
    const lista = deduplicarSolicitacoesAuditoria(solicitacoes || []).map((item) => {
      const categoria = statusGestaoAuditoria(item.status);
      const questionamento = item.tipo === 'QUESTIONAMENTO_OPERACAO' || item.categoria === 'QUESTIONAMENTO_OPERACAO';
      const cte = item.cte || item.numeroInformado || item.numero_informado || item.chaveCte || item.chave_informada || '';
      const jaAuditado = (lancamentos || []).some((lanc) => (
        normalizarTexto(lanc.cte || lanc.cteKey || '')
        && normalizarTexto(lanc.cte || lanc.cteKey || '') === normalizarTexto(cte)
      ));

      return {
        ...item,
        tipoGestao: questionamento ? 'QUESTIONAMENTO' : 'EXCEDENTE',
        categoriaStatus: categoria,
        dataBase: dataMovimentoAuditoria(item),
        atrasado: estaAtrasadoGestaoAuditoria(item),
        jaAuditado,
        respostaTratamento: item.resposta_auditoria || item.respostaAuditoria || item.resposta_operacao || item.respostaOperacao || item.resposta || item.observacaoTratamento || item.observacao_tratamento || '',
      };
    });
    return lista.sort((a, b) => new Date(b.dataBase || 0).getTime() - new Date(a.dataBase || 0).getTime());
  }, [lancamentos, solicitacoes]);

  const indicadores = useMemo(() => {
    const aguardando = movimentos.filter((item) => statusAbertoGestaoAuditoria(item.status));
    const atrasadas = movimentos.filter((item) => item.atrasado);
    const tratadas = movimentos.filter((item) => statusTratadoGestaoAuditoria(item.status));
    const liberadasPagamento = movimentos.filter((item) => ['APROVADO_OPERACAO', 'LIBERADO_PAGAMENTO', 'FINALIZADO'].includes(String(item.status || '').toUpperCase()));
    const questionamentos = movimentos.filter((item) => item.tipoGestao === 'QUESTIONAMENTO');
    return {
      total: movimentos.length,
      aguardando: aguardando.length,
      atrasadas: atrasadas.length,
      tratadas: tratadas.length,
      liberadasPagamento: liberadasPagamento.length,
      questionamentos: questionamentos.length,
      auditados: (lancamentos || []).length,
    };
  }, [lancamentos, movimentos]);

  const movimentosFiltrados = useMemo(() => {
    const inicio = filtros.dataInicio ? new Date(`${filtros.dataInicio}T00:00:00`) : null;
    const fim = filtros.dataFim ? new Date(`${filtros.dataFim}T23:59:59`) : null;
    return movimentos.filter((item) => {
      const statusItem = String(item.status || '').toUpperCase();
      const data = item.dataBase ? new Date(item.dataBase) : null;
      const textoLivre = normalizarTexto([
        item.cte,
        item.numeroInformado,
        item.numero_informado,
        item.chaveCte,
        item.chave_informada,
        item.fatura,
        item.transportadora,
        item.dist,
        item.distKey,
        item.motivoQuestionamento,
        item.motivo_questionamento,
        item.observacao,
        item.descricaoProblema,
        item.descricao_problema,
      ].filter(Boolean).join(' '));

      if (filtros.status && statusItem !== filtros.status) return false;
      if (filtros.tipo && item.tipoGestao !== filtros.tipo) return false;
      if (filtros.transportadora && !normalizarTexto(item.transportadora || '').includes(normalizarTexto(filtros.transportadora))) return false;
      if (filtros.cte && !textoLivre.includes(normalizarTexto(filtros.cte))) return false;
      if (filtros.fatura && !normalizarTexto(item.fatura || '').includes(normalizarTexto(filtros.fatura))) return false;
      if (filtros.dist && !normalizarTexto(`${item.dist || ''} ${item.distKey || item.dist_key || ''}`).includes(normalizarTexto(filtros.dist))) return false;
      if (filtros.motivo && !textoLivre.includes(normalizarTexto(filtros.motivo))) return false;
      if (inicio && data && data < inicio) return false;
      if (fim && data && data > fim) return false;
      if (filtros.somenteAguardando && !statusAbertoGestaoAuditoria(item.status)) return false;
      if (filtros.somenteAtrasadas && !item.atrasado) return false;
      if (filtros.somenteTratadas && !statusTratadoGestaoAuditoria(item.status)) return false;
      return true;
    });
  }, [filtros, movimentos]);

  const atualizarFiltro = (campo, valor) => setFiltros((prev) => ({ ...prev, [campo]: valor }));

  const abrirDetalhe = (item) => {
    setDetalhe(item);
    setStatusNovo(item.status || '');
    setRespostaTratamento(item.respostaTratamento || '');
  };

  const statusDisponiveis = detalhe?.tipoGestao === 'QUESTIONAMENTO'
    ? [
        ['AGUARDANDO_INFORMACAO', 'Aguardando informação'],
        ['EM_ANALISE', 'Em análise'],
        ['DEVOLVIDO_AUDITORIA', 'Devolvido para auditoria'],
        ['TRATADO', 'Tratado'],
        ['FINALIZADO', 'Finalizado'],
      ]
    : [
        ['EXCEDEU_AGUARDANDO_OPERACAO', 'Aguardando operação'],
        ['APROVADO_OPERACAO', 'Aprovado pela operação'],
        ['RECUSADO_OPERACAO', 'Recusado pela operação'],
        ['DEVOLVIDO_AUDITORIA', 'Devolvido para auditoria'],
        ['LIBERADO_PAGAMENTO', 'Liberado para pagamento'],
        ['FINALIZADO', 'Finalizado'],
      ];

  const salvarTratamento = async () => {
    if (!detalhe || !statusNovo || typeof onAtualizarStatus !== 'function') return;
    try {
      await onAtualizarStatus(detalhe, statusNovo, respostaTratamento);
      setDetalhe(null);
      setStatusNovo('');
      setRespostaTratamento('');
    } catch {
      // A mensagem de erro é exibida pela tela principal; mantém o painel aberto para correção.
    }
  };

  const classeStatus = (item) => {
    const categoria = statusGestaoAuditoria(item.status);
    if (item.atrasado || categoria === 'RECUSADO') return 'error';
    if (categoria === 'APROVADO' || categoria === 'TRATADO') return 'dark';
    return '';
  };

  return (
    <div className="table-card lotacao-table-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Histórico / Pendências da Auditoria Lotação</div>
          <p className="compact">Tela de gestão operacional para excedentes, questionamentos, retornos da Operação e liberações de pagamento.</p>
        </div>
        <span className="status-pill dark">{indicadores.aguardando} aberta(s)</span>
      </div>

      <div className="summary-strip lotacao-summary-mini top-space-sm">
        <div className="summary-card"><span>Total em gestão</span><strong>{indicadores.total.toLocaleString('pt-BR')}</strong><small>sem duplicar excedente legado</small></div>
        <div className="summary-card"><span>Aguardando operação</span><strong>{indicadores.aguardando.toLocaleString('pt-BR')}</strong><small>pendências/questionamentos abertos</small></div>
        <div className="summary-card"><span>Atrasadas</span><strong>{indicadores.atrasadas.toLocaleString('pt-BR')}</strong><small>prazo vencido ou +24h</small></div>
        <div className="summary-card"><span>Tratadas</span><strong>{indicadores.tratadas.toLocaleString('pt-BR')}</strong><small>aprovadas, recusadas ou finalizadas</small></div>
        <div className="summary-card"><span>Liberadas pagamento</span><strong>{indicadores.liberadasPagamento.toLocaleString('pt-BR')}</strong><small>operação/auditoria concluída</small></div>
        <div className="summary-card"><span>CT-es auditados</span><strong>{indicadores.auditados.toLocaleString('pt-BR')}</strong><small>lançamentos registrados</small></div>
      </div>

      <div className="form-grid three top-space-sm">
        <label className="field">
          Status
          <select value={filtros.status} onChange={(e) => atualizarFiltro('status', e.target.value)}>
            <option value="">Todos</option>
            <option value="EXCEDEU_AGUARDANDO_OPERACAO">Aguardando operação</option>
            <option value="AGUARDANDO_INFORMACAO">Aguardando informação</option>
            <option value="APROVADO_OPERACAO">Aprovado operação</option>
            <option value="RECUSADO_OPERACAO">Recusado operação</option>
            <option value="DEVOLVIDO_AUDITORIA">Devolvido auditoria</option>
            <option value="LIBERADO_PAGAMENTO">Liberado pagamento</option>
            <option value="FINALIZADO">Finalizado</option>
            <option value="TRATADO">Tratado</option>
          </select>
        </label>
        <label className="field">
          Tipo
          <select value={filtros.tipo} onChange={(e) => atualizarFiltro('tipo', e.target.value)}>
            <option value="">Todos</option>
            <option value="EXCEDENTE">Excedente</option>
            <option value="QUESTIONAMENTO">Questionamento</option>
          </select>
        </label>
        <label className="field">
          Transportadora
          <input value={filtros.transportadora} onChange={(e) => atualizarFiltro('transportadora', e.target.value)} placeholder="Ex.: LIBARDO" />
        </label>
        <label className="field">
          CT-e / chave
          <input value={filtros.cte} onChange={(e) => atualizarFiltro('cte', e.target.value)} placeholder="Número ou chave" />
        </label>
        <label className="field">
          Fatura
          <input value={filtros.fatura} onChange={(e) => atualizarFiltro('fatura', e.target.value)} placeholder="Fatura" />
        </label>
        <label className="field">
          DIST / viagem
          <input value={filtros.dist} onChange={(e) => atualizarFiltro('dist', e.target.value)} placeholder="DIST ou HUB" />
        </label>
        <label className="field">
          Motivo / texto
          <input value={filtros.motivo} onChange={(e) => atualizarFiltro('motivo', e.target.value)} placeholder="Tabela, transportadora, divergência..." />
        </label>
        <label className="field">
          De
          <input type="date" value={filtros.dataInicio} onChange={(e) => atualizarFiltro('dataInicio', e.target.value)} />
        </label>
        <label className="field">
          Até
          <input type="date" value={filtros.dataFim} onChange={(e) => atualizarFiltro('dataFim', e.target.value)} />
        </label>
      </div>

      <div className="actions-right top-space-sm" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label><input type="checkbox" checked={filtros.somenteAguardando} onChange={(e) => atualizarFiltro('somenteAguardando', e.target.checked)} /> Aguardando operação</label>
          <label><input type="checkbox" checked={filtros.somenteAtrasadas} onChange={(e) => atualizarFiltro('somenteAtrasadas', e.target.checked)} /> Atrasadas</label>
          <label><input type="checkbox" checked={filtros.somenteTratadas} onChange={(e) => atualizarFiltro('somenteTratadas', e.target.checked)} /> Tratadas</label>
        </div>
        <button type="button" className="btn-secondary" onClick={() => setFiltros({ status: '', tipo: '', transportadora: '', cte: '', fatura: '', dist: '', motivo: '', dataInicio: '', dataFim: '', somenteAguardando: false, somenteAtrasadas: false, somenteTratadas: false })}>
          Limpar filtros
        </button>
      </div>

      <div className="hint-box compact top-space-sm">
        Exibindo {movimentosFiltrados.length.toLocaleString('pt-BR')} registro(s). Excedentes vindos de <code>audit_pendencias</code> prevalecem sobre solicitações legadas para evitar duplicidade após recarregar.
      </div>

      {detalhe && (
        <div className="panel-card top-space-sm">
          <div className="section-row compact-top">
            <div>
              <div className="panel-title">Tratar pendência</div>
              <p className="compact">A resposta/tratamento será salvo em campo próprio, sem alterar a descrição original da solicitação.</p>
            </div>
            <button type="button" className="btn-secondary" onClick={() => setDetalhe(null)} disabled={salvando}>Fechar</button>
          </div>
          <div className="summary-strip lotacao-summary-mini">
            <div className="summary-card"><span>Tipo</span><strong>{detalhe.tipoGestao === 'QUESTIONAMENTO' ? 'Questionamento' : 'Excedente'}</strong><small>{detalhe.prioridade || '-'}</small></div>
            <div className="summary-card"><span>CT-e</span><strong>{detalhe.cte || detalhe.numeroInformado || detalhe.numero_informado || '-'}</strong><small>{detalhe.chaveCte || detalhe.chave_informada || '-'}</small></div>
            <div className="summary-card"><span>Transportadora</span><strong>{detalhe.transportadora || '-'}</strong><small>{detalhe.dist || detalhe.distKey || '-'}</small></div>
            <div className="summary-card"><span>Valor</span><strong>{formatarMoeda(detalhe.valorAdicional || detalhe.excedente || detalhe.valorLancado || 0)}</strong><small>excedente/lançado</small></div>
          </div>

          <div className="form-grid three top-space-sm">
            <label className="field">
              Novo status
              <select value={statusNovo} onChange={(e) => setStatusNovo(e.target.value)}>
                {statusDisponiveis.map(([valor, label]) => <option key={valor} value={valor}>{label}</option>)}
              </select>
            </label>
            <label className="field full-span">
              Resposta / observação de tratamento
              <textarea
                value={respostaTratamento}
                onChange={(e) => setRespostaTratamento(e.target.value)}
                placeholder="Informe o retorno da Operação ou a conclusão da Auditoria. Não será gravado junto da descrição original."
                style={{ minHeight: 90 }}
              />
            </label>
          </div>
          <div className="actions-right">
            <button type="button" className="btn-primary" onClick={salvarTratamento} disabled={salvando || !statusNovo}>
              {salvando ? 'Salvando...' : 'Salvar tratamento'}
            </button>
          </div>
        </div>
      )}

      <div className="sim-analise-tabela-wrap top-space-sm">
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>Data</th><th>Tipo</th><th>Status</th><th>CT-e / Fatura</th><th>Transportadora</th><th>DIST/viagem</th><th>Valor</th><th>Motivo/descrição</th><th>Resposta</th><th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {movimentosFiltrados.slice(0, 250).map((item, idx) => (
              <tr key={item.id || `${chaveSolicitacaoAuditoria(item)}-${idx}`}>
                <td>{formatarDataCurta(item.dataBase)}</td>
                <td>{item.tipoGestao === 'QUESTIONAMENTO' ? 'Questionamento' : 'Excedente'}</td>
                <td>
                  <span className={`status-pill ${classeStatus(item)}`}>{item.status || '-'}</span>
                  {item.atrasado && <small style={{ display: 'block' }}>atrasada</small>}
                </td>
                <td>
                  <strong>{item.cte || item.numeroInformado || item.numero_informado || '-'}</strong>
                  <small style={{ display: 'block' }}>{item.fatura || item.chaveCte || item.chave_informada || '-'}</small>
                </td>
                <td>{item.transportadora || '-'}</td>
                <td>{distExibicao(item.dist || item.distKey || item.dist_key || '') || '-'}</td>
                <td>{formatarMoeda(item.valorAdicional || item.excedente || item.valorLancado || 0)}</td>
                <td style={{ maxWidth: 360, whiteSpace: 'pre-wrap' }}>
                  {item.motivoQuestionamento || item.motivo_questionamento || item.observacao || item.descricaoProblema || item.descricao_problema || '-'}
                </td>
                <td style={{ maxWidth: 260, whiteSpace: 'pre-wrap' }}>{item.respostaTratamento || '-'}</td>
                <td><button type="button" className="btn-secondary" onClick={() => abrirDetalhe(item)}>Tratar</button></td>
              </tr>
            ))}
            {!movimentosFiltrados.length && <tr><td colSpan="10">Nenhuma pendência/questionamento encontrado para os filtros selecionados.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="table-card lotacao-table-card top-space-sm">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Últimos CT-es auditados</div>
            <p className="compact">Lista de apoio para confirmar se o CT-e/fatura já foi auditado.</p>
          </div>
        </div>
        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead>
              <tr><th>Data</th><th>Auditor</th><th>Viagem</th><th>CT-e</th><th>Fatura</th><th>Valor lançado</th><th>Excedente</th><th>Status</th><th>Observação</th></tr>
            </thead>
            <tbody>
              {[...(lancamentos || [])]
                .sort((a, b) => new Date(b.auditedAt || b.criadoEm || 0).getTime() - new Date(a.auditedAt || a.criadoEm || 0).getTime())
                .slice(0, 100)
                .map((item) => (
                  <tr key={item.id}>
                    <td>{formatarDataCurta(item.auditedAt || item.criadoEm)}</td>
                    <td><span title={item.auditedByEmail || ''}>{item.auditedByName || '-'}</span></td>
                    <td><strong>{distExibicao(item.dist) || item.dist}</strong></td>
                    <td>{item.cte || '-'}</td>
                    <td>{item.fatura || '-'}</td>
                    <td>{formatarMoeda(item.valorLancado)}</td>
                    <td className={item.excedente > 0 ? 'negativo' : ''}>{formatarMoeda(item.excedente)}</td>
                    <td><span className={`status-pill ${item.excedente > 0 ? 'error' : ''}`}>{item.auditStatus || item.status}</span></td>
                    <td>{item.observacao || '-'}</td>
                  </tr>
                ))}
              {!(lancamentos || []).length && <tr><td colSpan="9">Nenhum lançamento registrado até agora.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Aba Vínculos de Transportadora ───────────────────────────────────────────
function PainelVinculos({ vinculos, onSalvar, onRemover, sugestaoRealizado, sugestaoCte, fonte = 'local', salvando = false }) {
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState({ nomeRealizado: sugestaoRealizado || '', nomeCteTabela: sugestaoCte || '', cnpj: '' });

  const atualizar = (campo, valor) => setForm((prev) => ({ ...prev, [campo]: valor }));

  const salvar = () => {
    const nomeRealizado = (form.nomeRealizado || '').trim();
    const nomeCteTabela = (form.nomeCteTabela || '').trim();
    if (!nomeRealizado || !nomeCteTabela) return;
    let novos;
    if (editando) {
      novos = vinculos.map((v) => (v.id === editando ? { ...v, nomeRealizado, nomeCteTabela, cnpj: (form.cnpj || '').trim(), atualizadoEm: new Date().toISOString() } : v));
    } else {
      novos = [
        { id: globalThis.crypto?.randomUUID?.() || `vinc-${Date.now()}`, nomeRealizado, nomeCteTabela, cnpj: (form.cnpj || '').trim(), criadoEm: new Date().toISOString() },
        ...vinculos,
      ];
    }
    onSalvar(novos);
    setEditando(null);
    setForm({ nomeRealizado: '', nomeCteTabela: '', cnpj: '' });
  };

  const editar = (v) => {
    setEditando(v.id);
    setForm({ nomeRealizado: v.nomeRealizado || '', nomeCteTabela: v.nomeCteTabela || '', cnpj: v.cnpj || '' });
  };

  const remover = (id) => {
    if (typeof onRemover === 'function') onRemover(id);
    else onSalvar(vinculos.filter((v) => v.id !== id));
  };

  return (
    <div className="panel-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Vínculos de transportadora</div>
          <p>Liga o nome da transportadora no realizado/lotação ao nome oficial na base CT-e / tabela de frete. Ex.: <strong>LIBARDO</strong> → <strong>LIBARDO TRANSPORTES LTDA</strong>.</p>
        </div>
        <span className="status-pill dark">{vinculos.length} vínculo(s) · {fonte === 'supabase' ? 'Supabase' : 'local'}</span>
      </div>

      <div className="hint-box compact">
        Os vínculos são compartilhados via Supabase e também ficam em cache local como segurança.
      </div>

      <div className="form-grid three top-space-sm">
        <label className="field">
          Nome no realizado / lotação
          <input value={form.nomeRealizado} onChange={(e) => atualizar('nomeRealizado', e.target.value)} placeholder="Ex.: LIBARDO" />
        </label>
        <label className="field">
          Nome no CT-e / tabela
          <input value={form.nomeCteTabela} onChange={(e) => atualizar('nomeCteTabela', e.target.value)} placeholder="Ex.: LIBARDO TRANSPORTES LTDA" />
        </label>
        <label className="field">
          CNPJ (opcional)
          <input value={form.cnpj} onChange={(e) => atualizar('cnpj', e.target.value)} placeholder="00.000.000/0000-00" />
        </label>
      </div>
      <div className="actions-right">
        {editando && (
          <button type="button" className="btn-secondary" onClick={() => { setEditando(null); setForm({ nomeRealizado: '', nomeCteTabela: '', cnpj: '' }); }}>
            Cancelar edição
          </button>
        )}
        <button type="button" className="btn-primary" disabled={salvando || !form.nomeRealizado.trim() || !form.nomeCteTabela.trim()} onClick={salvar}>
          {salvando ? 'Salvando...' : editando ? 'Salvar alteração' : 'Adicionar vínculo'}
        </button>
      </div>

      <div className="sim-analise-tabela-wrap top-space-sm">
        <table className="sim-analise-tabela">
          <thead><tr><th>Nome no realizado</th><th>Nome no CT-e / tabela</th><th>CNPJ</th><th>Ações</th></tr></thead>
          <tbody>
            {vinculos.map((v) => (
              <tr key={v.id}>
                <td><strong>{v.nomeRealizado}</strong></td>
                <td>{v.nomeCteTabela}</td>
                <td>{v.cnpj || '-'}</td>
                <td>
                  <button type="button" className="btn-secondary" style={{ marginRight: 6 }} disabled={salvando} onClick={() => editar(v)}>Editar</button>
                  <button type="button" className="btn-secondary" disabled={salvando} onClick={() => remover(v.id)}>Remover</button>
                </td>
              </tr>
            ))}
            {!vinculos.length && <tr><td colSpan="4">Nenhum vínculo cadastrado ainda.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Barra de abas ────────────────────────────────────────────────────────────
function AbasAuditoria({ ativa, onMudar, pendencias }) {
  const abas = [
    { id: 'auditar', label: 'Auditar' },
    { id: 'vinculos', label: 'Vínculos de Transportadora' },
    { id: 'historico', label: `Histórico / Pendências${pendencias ? ` (${pendencias})` : ''}` },
  ];
  return (
    <div className="mini-list" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', background: 'transparent', padding: 0 }}>
      {abas.map((aba) => (
        <button
          key={aba.id}
          type="button"
          className={ativa === aba.id ? 'btn-primary' : 'btn-secondary'}
          onClick={() => onMudar(aba.id)}
        >
          {aba.label}
        </button>
      ))}
    </div>
  );
}

// ════════════════════════════ PÁGINA PRINCIPAL ═══════════════════════════════
export default function LotacaoAuditoriaPage() {
  const mounted = useRef(true);
  const [usuarioAtual] = useState(() => carregarSessao());

  const [baseFluxo, setBaseFluxo] = useState(() => carregarFluxoCargasLotacao());
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);
  const [fonteCargas, setFonteCargas] = useState('local');

  const [abaAtiva, setAbaAtiva] = useState('auditar');

  // buscas separadas (4.34A)
  const [buscaChave, setBuscaChave] = useState('');
  const [buscaNumeroCte, setBuscaNumeroCte] = useState('');
  const [buscaDist, setBuscaDist] = useState('');

  const [viagensResultado, setViagensResultado] = useState([]);
  const [viagemSelecionada, setViagemSelecionada] = useState(null);
  const [ctesEncontrados, setCtesEncontrados] = useState([]);
  const [cteSelecionado, setCteSelecionado] = useState(null);
  const [sugestoesViagens, setSugestoesViagens] = useState([]);
  const [sugestoesVinculoTransportadora, setSugestoesVinculoTransportadora] = useState([]);
  const [buscandoSugestoes, setBuscandoSugestoes] = useState(false);
  const [sugestoesConsultadas, setSugestoesConsultadas] = useState(false);
  const [loteChavesTexto, setLoteChavesTexto] = useState('');
  const [loteResultados, setLoteResultados] = useState([]);
  const [loteSelecionados, setLoteSelecionados] = useState([]);
  const [buscandoLote, setBuscandoLote] = useState(false);

  const [tabelasLotacao, setTabelasLotacao] = useState([]);
  const [tabelaSelecionadaChave, setTabelaSelecionadaChave] = useState('');
  const [lancamentos, setLancamentos] = useState(() => carregarLancamentosAuditoria());
  const [solicitacoes, setSolicitacoes] = useState(() => carregarSolicitacoesPagamento());
  const [carregandoAuditoria, setCarregandoAuditoria] = useState(false);

  const [vinculos, setVinculos] = useState(() => carregarVinculos());
  const [fonteVinculos, setFonteVinculos] = useState('local');
  const [salvandoVinculos, setSalvandoVinculos] = useState(false);

  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState('');

  // ── cargas (Supabase > local) ──
  useEffect(() => {
    mounted.current = true;
    setCarregandoHistorico(true);
    (async () => {
      try {
        const cargasSupabase = await carregarCargasLotacaoSupabase({});
        if (mounted.current && cargasSupabase.length > 0) {
          setBaseFluxo({ cargas: cargasSupabase, armazenamento: 'supabase' });
          setFonteCargas('supabase');
          return;
        }
      } catch (err) {
        console.warn('[Auditoria] Supabase indisponível para cargas, usando local:', err.message);
      }
      try {
        const base = await carregarFluxoCargasLotacaoCompleto();
        if (mounted.current) { setBaseFluxo(base); setFonteCargas('local'); }
      } catch (err) {
        console.error('[Auditoria] Erro ao carregar histórico local:', err);
      }
    })().finally(() => { if (mounted.current) setCarregandoHistorico(false); });
    return () => { mounted.current = false; };
  }, []);

  // ── lançamentos e solicitações (Supabase > local) ──
  useEffect(() => {
    setCarregandoAuditoria(true);
    (async () => {
      try {
        const [lancs, sols, pends, infos] = await Promise.all([
          carregarLancamentosAuditoriaSupabase(),
          carregarSolicitacoesSupabase(),
          carregarPendenciasAuditoriaSupabase({}).catch(() => null),
          carregarSolicitacoesInfoSupabase({}).catch(() => null),
        ]);
        if (lancs !== null) { setLancamentos(lancs); salvarLancamentosAuditoria(lancs); }
        if (sols !== null || Array.isArray(pends) || Array.isArray(infos)) {
          const solicitacoesComPendencias = mesclarSolicitacoesAuditoria({
            solicitacoesLegadas: sols || [],
            pendencias: pends || [],
            questionamentos: infos || [],
          });
          setSolicitacoes(solicitacoesComPendencias);
          salvarSolicitacoesPagamento(solicitacoesComPendencias);
        }
      } catch (err) {
        console.warn('[Auditoria] Usando localStorage para lançamentos/solicitações:', err.message);
      } finally {
        setCarregandoAuditoria(false);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const resp = await carregarTabelasLotacaoSupabase();
        setTabelasLotacao(resp?.tabelas || []);
      } catch {
        setTabelasLotacao(carregarTabelasLotacao());
      }
    })();
  }, []);

  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const lista = await carregarVinculosTransportadoras();
        if (!ativo) return;
        const adaptados = (lista || []).map(vinculoGlobalParaAuditoria).filter((item) => item.nomeRealizado && item.nomeCteTabela);
        if (adaptados.length) {
          setVinculos(adaptados);
          salvarVinculos(adaptados);
        }
        setFonteVinculos('supabase');
      } catch (error) {
        console.warn('[Auditoria] Vínculos no Supabase indisponíveis; usando fallback local:', error.message || error);
        if (ativo) setFonteVinculos('local');
      }
    })();
    return () => { ativo = false; };
  }, []);

  const viagemParaAuditoria = useMemo(
    () => aplicarReferenciaAuditoria(viagemSelecionada, cteSelecionado),
    [viagemSelecionada, cteSelecionado],
  );

  const tabelasCompativeis = useMemo(() => {
    const viagemBase = viagemParaAuditoria || viagemSelecionada;
    if (!cteSelecionado) return [];

    const filtros = montarFiltrosTabelaLotacaoAuditoria(viagemBase, cteSelecionado);
    let resultadosBase = [];
    try {
      resultadosBase = pesquisarRotaLotacao(tabelasLotacao, filtros) || [];
    } catch (error) {
      console.warn('[Auditoria Lotação] Falha na busca padrão de tabela de lotação:', error.message || error);
    }

    return buscarTabelaLotacaoAuditoria({
      tabelas: tabelasLotacao,
      filtros,
      viagem: viagemBase,
      cte: cteSelecionado,
      vinculos,
      resultadosBase,
    });
  }, [tabelasLotacao, cteSelecionado, viagemSelecionada, viagemParaAuditoria, vinculos]);

  const tabelaSelecionada = useMemo(
    () => tabelasCompativeis.find((item) => chaveTabelaAuditoria(item) === tabelaSelecionadaChave) || null,
    [tabelasCompativeis, tabelaSelecionadaChave],
  );

  const tabelaAplicavel = tabelaSelecionada ? [tabelaSelecionada] : [];

  const motivosQuestionamentoOperacao = useMemo(() => diagnosticarQuestionamentoOperacao({
    cte: cteSelecionado,
    viagem: viagemParaAuditoria || viagemSelecionada,
    tabelasCompativeis,
    tabelaSelecionada,
    sugestoesViagens,
    sugestoesVinculoTransportadora,
    sugestoesConsultadas,
    vinculos,
  }), [cteSelecionado, viagemParaAuditoria, viagemSelecionada, tabelasCompativeis, tabelaSelecionada, sugestoesViagens, sugestoesVinculoTransportadora, sugestoesConsultadas, vinculos]);

  const analiseLoteChaves = useMemo(
    () => analisarChavesCteLote(loteChavesTexto),
    [loteChavesTexto],
  );

  // ── Busca por chave CT-e (somente chave de 44 dígitos na base CT-e) ──
  const pesquisarPorChave = useCallback(async () => {
    setMensagem('');
    const chave = String(buscaChave || '').replace(/\D/g, '');
    if (!chave) { setMensagem('Informe a chave CT-e para buscar na base de CT-es.'); return; }
    if (chave.length !== 44) { setMensagem('Informe uma chave CT-e válida com 44 dígitos.'); return; }
    try {
      const ctes = await buscarCteLotacaoAuditoriaPorChaveSupabase(chave);
      setCtesEncontrados(ctes);
      setCteSelecionado(ctes[0] || null);
      setViagemSelecionada(null);
      setViagensResultado([]);
      setTabelaSelecionadaChave('');
      setSugestoesViagens([]);
      setSugestoesVinculoTransportadora([]);
      setSugestoesConsultadas(false);
      if (!ctes.length) setMensagem('Nenhum CT-e encontrado na base de CT-es para essa chave.');
    } catch (error) {
      setCtesEncontrados([]); setCteSelecionado(null);
      setMensagem(`Falha ao buscar chave CT-e: ${error.message || String(error)}`);
    }
  }, [buscaChave]);

  // ── Busca por número CT-e (somente número na base CT-e) ──
  const pesquisarPorNumeroCte = useCallback(async () => {
    setMensagem('');
    const numero = String(buscaNumeroCte || '').replace(/\D/g, '');
    if (!numero) { setMensagem('Informe o número do CT-e para buscar na base de CT-es.'); return; }
    try {
      const ctes = await buscarCtesLotacaoAuditoriaPorNumeroSupabase(numero);
      setCtesEncontrados(ctes);
      setCteSelecionado(ctes[0] || null);
      setViagemSelecionada(null);
      setViagensResultado([]);
      setTabelaSelecionadaChave('');
      setSugestoesViagens([]);
      setSugestoesVinculoTransportadora([]);
      setSugestoesConsultadas(false);
      if (!ctes.length) setMensagem('Nenhum CT-e encontrado na base de CT-es para esse número.');
    } catch (error) {
      setCtesEncontrados([]); setCteSelecionado(null);
      setMensagem(`Falha ao buscar número CT-e: ${error.message || String(error)}`);
    }
  }, [buscaNumeroCte]);

  // ── Busca por DIST / viagem (somente no realizado, já consolidado) ──
  const pesquisarPorDist = useCallback(() => {
    setMensagem('');
    const termo = buscaDist.trim();
    if (!termo) { setMensagem('Informe DIST, HUB ou número da viagem.'); return; }
    const cargas = buscarCargaPorDistOuCte(baseFluxo.cargas, termo);
    const viagens = consolidarViagens(cargas);
    setViagensResultado(viagens);
    setViagemSelecionada(null);
    setTabelaSelecionadaChave('');
    if (!viagens.length) setMensagem('Nenhuma viagem encontrada no realizado para esse DIST/viagem.');
  }, [buscaDist, baseFluxo.cargas]);

  // ── Sugestões no realizado a partir do CT-e ──
  const buscarSugestoesNoRealizado = useCallback(() => {
    if (!cteSelecionado) return;
    setBuscandoSugestoes(true);

    const resultado = gerarSugestoesViagemAuditoria(baseFluxo.cargas, cteSelecionado, vinculos);
    setSugestoesConsultadas(true);
    setSugestoesViagens(resultado.casamento);
    setSugestoesVinculoTransportadora(resultado.vinculosPossiveis);

    if (resultado.casamento.length) {
      setMensagem('Correspondências exatas encontradas. Selecione manualmente a DIST/viagem que será auditada.');
    } else if (resultado.vinculosPossiveis.length) {
      setMensagem('Nenhuma DIST/viagem encontrada com transportadora, origem e destino iguais aos do CT-e.');
    } else {
      setMensagem('Nenhuma DIST/viagem encontrada com transportadora, origem e destino iguais aos do CT-e.');
    }

    setBuscandoSugestoes(false);
  }, [cteSelecionado, baseFluxo.cargas, vinculos]);

  const montarResultadoLote = useCallback((chave, respostaPorChave, lancamentosBase) => {
    const resposta = respostaPorChave.get(chave);
    const cte = resposta?.ctes?.[0] || null;
    const erro = resposta?.erro || '';
    const lancConsolidados = reKeyLancamentosPorViagem(lancamentosBase);
    const ids = identificadoresCteAuditoria(cte, chave);
    const vinculadoNaViagem = viagemParaAuditoria && ids.some((id) => cteJaLancado(lancConsolidados, viagemParaAuditoria, id));
    const vinculadoOutraViagem = cteJaLancadoEmOutraViagem(lancConsolidados, viagemParaAuditoria, ids);

    if (erro) {
      return { chave, cte, status: 'ERRO', statusLabel: 'erro', selecionavel: false, observacao: erro };
    }
    if (!cte) {
      return { chave, cte: null, status: 'NAO_ENCONTRADO', statusLabel: 'não encontrado', selecionavel: false, observacao: 'Chave não localizada na base de CT-es.' };
    }
    if (vinculadoNaViagem) {
      return { chave, cte, status: 'JA_VINCULADO', statusLabel: 'já vinculado', selecionavel: false, observacao: 'CT-e já vinculado nesta viagem.' };
    }
    if (vinculadoOutraViagem) {
      return { chave, cte, status: 'JA_VINCULADO_OUTRA', statusLabel: 'já vinculado', selecionavel: false, observacao: 'CT-e já vinculado em outra viagem.' };
    }
    if (!viagemParaAuditoria) {
      return { chave, cte, status: 'SEM_VIAGEM', statusLabel: 'encontrado', selecionavel: false, observacao: 'Selecione uma viagem consolidada para permitir vínculo.' };
    }
    return { chave, cte, status: 'VALIDO', statusLabel: 'válido para seleção', selecionavel: true, observacao: 'Pronto para vincular.' };
  }, [viagemParaAuditoria]);

  useEffect(() => {
    if (!loteResultados.length) return;
    const lancConsolidados = reKeyLancamentosPorViagem(lancamentos);
    setLoteResultados((atuais) => atuais.map((item) => {
      const cte = item.cte || null;
      if (!cte) return item;
      const ids = identificadoresCteAuditoria(cte, item.chave);
      const vinculadoNaViagem = viagemParaAuditoria && ids.some((id) => cteJaLancado(lancConsolidados, viagemParaAuditoria, id));
      const vinculadoOutraViagem = cteJaLancadoEmOutraViagem(lancConsolidados, viagemParaAuditoria, ids);

      if (vinculadoNaViagem) {
        return { ...item, status: 'JA_VINCULADO', statusLabel: 'já vinculado', selecionavel: false, observacao: 'CT-e já vinculado nesta viagem.' };
      }
      if (vinculadoOutraViagem) {
        return { ...item, status: 'JA_VINCULADO_OUTRA', statusLabel: 'já vinculado', selecionavel: false, observacao: 'CT-e já vinculado em outra viagem.' };
      }
      if (!viagemParaAuditoria) {
        return { ...item, status: 'SEM_VIAGEM', statusLabel: 'encontrado', selecionavel: false, observacao: 'Selecione uma viagem consolidada para permitir vínculo.' };
      }
      return { ...item, status: 'VALIDO', statusLabel: 'válido para seleção', selecionavel: true, observacao: 'Pronto para vincular.' };
    }));
    setLoteSelecionados((atuais) => atuais.filter((chave) => (
      loteResultados.some((item) => item.chave === chave && item.selecionavel)
    )));
  }, [viagemParaAuditoria, lancamentos]);

  const pesquisarLoteChaves = useCallback(async () => {
    setMensagem('');
    setLoteSelecionados([]);
    const textoPesquisa = loteChavesTexto || buscaChave;
    const analise = analisarChavesCteLote(textoPesquisa);
    if (!analise.validas.length) {
      setLoteResultados([]);
      setMensagem('Cole ao menos uma chave CT-e válida com 44 dígitos.');
      return;
    }

    setBuscandoLote(true);
    try {
      const respostas = await buscarCtesLotacaoAuditoriaPorChavesSupabase(analise.validas);
      const respostaPorChave = new Map((respostas || []).map((item) => [item.chave, item]));
      const resultados = analise.validas.map((chave) => montarResultadoLote(chave, respostaPorChave, lancamentos));
      setLoteResultados(resultados);
      const encontrados = resultados.filter((item) => item.cte).length;
      const primeiroEncontrado = resultados.find((item) => item.cte)?.cte || null;
      if (primeiroEncontrado && resultados.length === 1) {
        setCtesEncontrados([primeiroEncontrado]);
        setCteSelecionado(primeiroEncontrado);
        setViagemSelecionada(null);
        setTabelaSelecionadaChave('');
        setSugestoesViagens([]);
      setSugestoesVinculoTransportadora([]);
      setSugestoesConsultadas(false);
      } else {
        setCtesEncontrados([]);
        setCteSelecionado(null);
        setViagemSelecionada(null);
        setTabelaSelecionadaChave('');
        setSugestoesViagens([]);
      setSugestoesVinculoTransportadora([]);
      setSugestoesConsultadas(false);
      }
      setMensagem(`Lote analisado: ${resultados.length} chave(s), ${encontrados} encontrada(s).`);
    } catch (error) {
      setLoteResultados([]);
      setMensagem(`Falha ao buscar CT-es em lote: ${error.message || String(error)}`);
    } finally {
      setBuscandoLote(false);
    }
  }, [loteChavesTexto, buscaChave, lancamentos, montarResultadoLote]);

  const alternarSelecaoLote = useCallback((chave) => {
    setLoteSelecionados((atuais) => (
      atuais.includes(chave) ? atuais.filter((item) => item !== chave) : atuais.concat(chave)
    ));
  }, []);

  const alternarTodosLote = useCallback(() => {
    const validos = loteResultados.filter((item) => item.selecionavel).map((item) => item.chave);
    setLoteSelecionados((atuais) => (
      validos.length && validos.every((chave) => atuais.includes(chave)) ? [] : validos
    ));
  }, [loteResultados]);

  const usarCteDoLote = useCallback((cte) => {
    if (!cte) return;
    setCteSelecionado(cte);
    setCtesEncontrados([cte]);
    setViagemSelecionada(null);
    setTabelaSelecionadaChave('');

    const resultado = gerarSugestoesViagemAuditoria(baseFluxo.cargas, cte, vinculos);
    setSugestoesConsultadas(true);
    setSugestoesViagens(resultado.casamento);
    setSugestoesVinculoTransportadora(resultado.vinculosPossiveis);

    if (resultado.casamento.length) {
      setMensagem('CT-e selecionado no lote. Selecione manualmente uma DIST/viagem com correspondência exata.');
    } else if (resultado.vinculosPossiveis.length) {
      setMensagem('CT-e selecionado no lote. Nenhuma DIST/viagem possui transportadora, origem e destino iguais.');
    } else {
      setMensagem('CT-e selecionado no lote. Nenhuma viagem provável encontrada com a mesma transportadora no realizado.');
    }
  }, [baseFluxo.cargas, vinculos]);

  const salvarVinculosState = useCallback(async (novos) => {
    const adaptados = (novos || []).filter((item) => item.nomeRealizado && item.nomeCteTabela);
    setVinculos(adaptados);
    salvarVinculos(adaptados);
    setSalvandoVinculos(true);
    try {
      const resultado = await salvarVinculosTransportadoras(adaptados.map(vinculoAuditoriaParaGlobal));
      const salvos = (resultado.vinculos || []).map(vinculoGlobalParaAuditoria).filter((item) => item.nomeRealizado && item.nomeCteTabela);
      if (salvos.length) {
        setVinculos(salvos);
        salvarVinculos(salvos);
      }
      setFonteVinculos(resultado.modo || 'supabase');
      setMensagem(`Vínculos de transportadora salvos em ${resultado.modo === 'supabase' ? 'Supabase' : 'localStorage'}.`);
    } catch (error) {
      setFonteVinculos('local');
      setMensagem(`Vínculos salvos localmente, mas não no Supabase: ${error.message || String(error)}`);
    } finally {
      setSalvandoVinculos(false);
    }
  }, []);

  const removerVinculoState = useCallback(async (id) => {
    const alvo = (vinculos || []).find((item) => String(item.id) === String(id));
    const restantes = (vinculos || []).filter((item) => String(item.id) !== String(id));
    setVinculos(restantes);
    salvarVinculos(restantes);
    setSalvandoVinculos(true);
    try {
      await removerVinculoTransportadora(alvo?.nomeCteTabela || id, (vinculos || []).map(vinculoAuditoriaParaGlobal));
      setFonteVinculos('supabase');
      setMensagem('Vínculo removido do Supabase.');
    } catch (error) {
      setFonteVinculos('local');
      setMensagem(`Vínculo removido localmente, mas não no Supabase: ${error.message || String(error)}`);
    } finally {
      setSalvandoVinculos(false);
    }
  }, [vinculos]);

  // ── Registrar lançamento (vincular CT-e à viagem consolidada) ──
  const registrarLancamento = useCallback(async (form) => {
    if (!viagemParaAuditoria) return;
    setSalvando(true);
    setMensagem('');
    try {
      const lancConsolidados = reKeyLancamentosPorViagem(lancamentos);
      const lancamento = criarLancamentoAuditoria(viagemParaAuditoria, form, lancConsolidados, solicitacoes);

      const lancamentoComAuditor = {
        ...lancamento,
        auditedByUserId: form.auditedByUserId || usuarioAtual?.id || '',
        auditedByName: form.auditedByName || usuarioAtual?.nome || '',
        auditedByEmail: form.auditedByEmail || usuarioAtual?.email || '',
        auditedAt: form.auditedAt || new Date().toISOString(),
        auditStatus: form.auditStatus || (lancamento.excedente > 0 ? 'EXCEDEU_AGUARDANDO_OPERACAO' : 'AUDITADO_OK'),
        auditExceededAmount: form.auditExceededAmount ?? lancamento.excedente,
        auditAllowedAmount: form.auditAllowedAmount ?? 0,
        auditEnteredAmount: form.auditEnteredAmount ?? lancamento.valorLancado,
        observacao: form.observacao || '',
        origemTela: 'AUDITORIA_LOTACAO',
      };

      const novosLancamentos = [lancamentoComAuditor, ...lancamentos];
      salvarLancamentosAuditoria(novosLancamentos);
      setLancamentos(novosLancamentos);

      try {
        await salvarLancamentoAuditoriaSupabase(lancamentoComAuditor);
      } catch (error) {
        console.warn('[Auditoria] Lançamento salvo localmente; falha no Supabase:', error.message);
      }

      if (lancamentoComAuditor.excedente > 0) {
        const solicitacao = criarSolicitacaoPagamento(viagemParaAuditoria, lancamentoComAuditor);
        const pendenciaId = globalThis.crypto?.randomUUID?.();
        const solicitacaoComAuditor = {
          ...solicitacao,
          auditedByName: lancamentoComAuditor.auditedByName,
          auditedByEmail: lancamentoComAuditor.auditedByEmail,
          auditedAt: lancamentoComAuditor.auditedAt,
          observation: lancamentoComAuditor.observacao,
          status: 'EXCEDEU_AGUARDANDO_OPERACAO',
        };
        const novasSolicitacoes = [solicitacaoComAuditor, ...solicitacoes];
        salvarSolicitacoesPagamento(novasSolicitacoes);
        setSolicitacoes(novasSolicitacoes);

        try { await salvarSolicitacaoSupabase(solicitacaoComAuditor); }
        catch (error) { console.warn('[Auditoria] Solicitação salva localmente; falha no Supabase:', error.message); }

        try {
          await salvarPendenciaAuditoriaSupabase({
            id: pendenciaId,
            lancamentoId: lancamentoComAuditor.id,
            dist: viagemParaAuditoria.dist,
            distKey: viagemParaAuditoria.distKey,
            cte: lancamentoComAuditor.cte,
            fatura: lancamentoComAuditor.fatura,
            transportadora: viagemParaAuditoria.transportadora,
            cargaId: viagemParaAuditoria.id,
            valorLancado: lancamentoComAuditor.valorLancado,
            valorAutorizado: lancamentoComAuditor.saldoAnterior,
            valorExcedente: lancamentoComAuditor.excedente,
            valorOriginal: Number(viagemParaAuditoria.valorComparacao) || 0,
            valorAdicionalAprovado: 0,
            valorFinalAutorizado: Number(viagemParaAuditoria.valorComparacao) || 0,
            prazoOperacaoEm: adicionarHorasIso(lancamentoComAuditor.auditedAt, 24),
            status: 'EXCEDEU_AGUARDANDO_OPERACAO',
            auditedByUserId: lancamentoComAuditor.auditedByUserId,
            auditedByName: lancamentoComAuditor.auditedByName,
            auditedByEmail: lancamentoComAuditor.auditedByEmail,
            auditedAt: lancamentoComAuditor.auditedAt,
            observation: lancamentoComAuditor.observacao,
          });
          if (pendenciaId) {
            await registrarEventoHistoricoSupabase({
              pendenciaId,
              lancamentoId: lancamentoComAuditor.id,
              userId: lancamentoComAuditor.auditedByUserId,
              userName: lancamentoComAuditor.auditedByName,
              userEmail: lancamentoComAuditor.auditedByEmail,
              acao: 'ENVIADO_OPERACAO',
              statusAnterior: 'AUDITORIA',
              statusNovo: 'EXCEDEU_AGUARDANDO_OPERACAO',
              comentario: lancamentoComAuditor.observacao,
              origemTela: 'AUDITORIA_LOTACAO',
            });
          }
        } catch (error) {
          console.warn('[Auditoria] Pendência não registrada no painel novo:', error.message);
        }

        setMensagem('✓ CT-e vinculado e pendência criada para aprovação em Lotação Operação.');
      } else {
        setMensagem('✓ CT-e vinculado à viagem com sucesso.');
      }
    } catch (error) {
      setMensagem(`Erro ao registrar: ${error.message || String(error)}`);
    } finally {
      setSalvando(false);
    }
  }, [viagemParaAuditoria, lancamentos, solicitacoes, usuarioAtual]);

  const enviarQuestionamentoOperacao = useCallback(async ({ motivo, observacao, prioridade }) => {
    if (!cteSelecionado) {
      setMensagem('Busque e selecione um CT-e encontrado na base antes de questionar a Operação.');
      return;
    }

    const agora = new Date().toISOString();
    const id = globalThis.crypto?.randomUUID?.() || `quest-${Date.now()}`;
    const descricao = montarDescricaoQuestionamentoOperacao({
      cte: cteSelecionado,
      viagem: viagemParaAuditoria || viagemSelecionada,
      tabelaAuditoria: tabelaAplicavel,
      motivo,
      observacao,
      sugestoesViagens,
      sugestoesVinculoTransportadora,
    });

    const questionamento = solicitacaoInfoParaMovimentoOperacao({
      id,
      tipo: 'CTE',
      chaveInformada: cteSelecionado.chave_cte || '',
      numeroInformado: cteSelecionado.numero_cte || '',
      chaveCte: cteSelecionado.chave_cte || '',
      cte: cteSelecionado.numero_cte || '',
      fatura: cteSelecionado.fatura || cteSelecionado.numero_fatura || '',
      transportadora: cteSelecionado.transportadora || cteSelecionado.transportadora_contratada || '',
      dist: viagemParaAuditoria?.dist || viagemSelecionada?.dist || '',
      distKey: viagemParaAuditoria?.distKey || viagemSelecionada?.distKey || '',
      motivoQuestionamento: motivo,
      descricaoProblema: descricao,
      observacao: descricao,
      prioridade: prioridade || 'ALTA',
      status: 'AGUARDANDO_INFORMACAO',
      abertoPorId: usuarioAtual?.id || '',
      abertoPorNome: usuarioAtual?.nome || '',
      abertoPorEmail: usuarioAtual?.email || '',
      criadoEm: agora,
      created_at: agora,
      dadosCte: dadosResumoCteQuestionamento(cteSelecionado),
    });

    setSalvando(true);
    setMensagem('');
    try {
      const novasSolicitacoes = [questionamento, ...solicitacoes];
      setSolicitacoes(novasSolicitacoes);
      salvarSolicitacoesPagamento(novasSolicitacoes);

      try {
        await salvarSolicitacaoInfoSupabase({
          id,
          tipo: 'CTE',
          chaveInformada: cteSelecionado.chave_cte || '',
          numeroInformado: cteSelecionado.numero_cte || '',
          transportadora: cteSelecionado.transportadora || cteSelecionado.transportadora_contratada || '',
          fatura: cteSelecionado.fatura || cteSelecionado.numero_fatura || '',
          descricaoProblema: descricao,
          prioridade: prioridade || 'ALTA',
          status: 'AGUARDANDO_INFORMACAO',
          abertoPorId: usuarioAtual?.id || '',
          abertoPorNome: usuarioAtual?.nome || '',
          abertoPorEmail: usuarioAtual?.email || '',
        });
      } catch (error) {
        console.warn('[Auditoria] Questionamento salvo localmente; falha no Supabase:', error.message || error);
      }

      try {
        await registrarEventoHistoricoSupabase({
          pendenciaId: null,
          lancamentoId: id,
          userId: usuarioAtual?.id || '',
          userName: usuarioAtual?.nome || '',
          userEmail: usuarioAtual?.email || '',
          acao: 'QUESTIONAMENTO_OPERACAO',
          statusAnterior: 'AUDITORIA_LOTACAO',
          statusNovo: 'AGUARDANDO_INFORMACAO',
          comentario: descricao,
          origemTela: 'AUDITORIA_LOTACAO',
        });
      } catch (error) {
        console.warn('[Auditoria] Histórico do questionamento não registrado:', error.message || error);
      }

      setMensagem('✓ Questionamento enviado para a Operação com os dados do CT-e encontrado.');
      setAbaAtiva('historico');
    } catch (error) {
      setMensagem(`Erro ao enviar questionamento: ${error.message || String(error)}`);
    } finally {
      setSalvando(false);
    }
  }, [cteSelecionado, viagemParaAuditoria, viagemSelecionada, tabelaAplicavel, sugestoesViagens, sugestoesVinculoTransportadora, solicitacoes, usuarioAtual]);

  const vincularLoteSelecionado = useCallback(async () => {
    if (!viagemParaAuditoria) {
      setMensagem('Selecione uma viagem consolidada antes de vincular o lote.');
      return;
    }
    const selecionadosSet = new Set(loteSelecionados);
    const itens = loteResultados.filter((item) => item.selecionavel && selecionadosSet.has(item.chave));
    if (!itens.length) {
      setMensagem('Selecione ao menos um CT-e válido para vincular.');
      return;
    }

    setSalvando(true);
    setMensagem('');

    const salvos = [];
    const falhas = [];
    let novosLancamentos = [...lancamentos];
    let novasSolicitacoes = [...solicitacoes];

    for (const item of itens) {
      try {
        const valorCte = numeroAuditoria(item.cte?.valor_cte);
        const numeroCte = item.cte?.numero_cte || item.chave;
        const lancConsolidados = reKeyLancamentosPorViagem(novosLancamentos);
        const lancamento = criarLancamentoAuditoria(viagemParaAuditoria, {
          cte: numeroCte,
          valorLancado: valorCte,
          fatura: '',
          observacao: 'Auditoria em lote por chaves CT-e',
        }, lancConsolidados, novasSolicitacoes);

        const lancamentoComAuditor = {
          ...lancamento,
          auditedByUserId: usuarioAtual?.id || '',
          auditedByName: usuarioAtual?.nome || '',
          auditedByEmail: usuarioAtual?.email || '',
          auditedAt: new Date().toISOString(),
          auditStatus: lancamento.excedente > 0 ? 'EXCEDEU_AGUARDANDO_OPERACAO' : 'AUDITADO_OK',
          auditExceededAmount: lancamento.excedente,
          auditAllowedAmount: lancamento.saldoAnterior,
          auditEnteredAmount: lancamento.valorLancado,
          observacao: 'Auditoria em lote por chaves CT-e',
          origemTela: 'AUDITORIA_LOTACAO',
        };

        novosLancamentos = [lancamentoComAuditor, ...novosLancamentos];
        try {
          await salvarLancamentoAuditoriaSupabase(lancamentoComAuditor);
        } catch (error) {
          console.warn('[Auditoria em lote] Lançamento salvo localmente; falha no Supabase:', error.message);
        }

        if (lancamentoComAuditor.excedente > 0) {
          const solicitacao = criarSolicitacaoPagamento(viagemParaAuditoria, lancamentoComAuditor);
          const pendenciaId = globalThis.crypto?.randomUUID?.();
          const solicitacaoComAuditor = {
            ...solicitacao,
            auditedByName: lancamentoComAuditor.auditedByName,
            auditedByEmail: lancamentoComAuditor.auditedByEmail,
            auditedAt: lancamentoComAuditor.auditedAt,
            observation: lancamentoComAuditor.observacao,
            status: 'EXCEDEU_AGUARDANDO_OPERACAO',
          };
          novasSolicitacoes = [solicitacaoComAuditor, ...novasSolicitacoes];

          try { await salvarSolicitacaoSupabase(solicitacaoComAuditor); }
          catch (error) { console.warn('[Auditoria em lote] Solicitação salva localmente; falha no Supabase:', error.message); }

          try {
            await salvarPendenciaAuditoriaSupabase({
              id: pendenciaId,
              lancamentoId: lancamentoComAuditor.id,
              dist: viagemParaAuditoria.dist,
              distKey: viagemParaAuditoria.distKey,
              cte: lancamentoComAuditor.cte,
              fatura: lancamentoComAuditor.fatura,
              transportadora: viagemParaAuditoria.transportadora,
              cargaId: viagemParaAuditoria.id,
              valorLancado: lancamentoComAuditor.valorLancado,
              valorAutorizado: lancamentoComAuditor.saldoAnterior,
              valorExcedente: lancamentoComAuditor.excedente,
              valorOriginal: Number(viagemParaAuditoria.valorComparacao) || 0,
              valorAdicionalAprovado: 0,
              valorFinalAutorizado: Number(viagemParaAuditoria.valorComparacao) || 0,
              prazoOperacaoEm: adicionarHorasIso(lancamentoComAuditor.auditedAt, 24),
              status: 'EXCEDEU_AGUARDANDO_OPERACAO',
              auditedByUserId: lancamentoComAuditor.auditedByUserId,
              auditedByName: lancamentoComAuditor.auditedByName,
              auditedByEmail: lancamentoComAuditor.auditedByEmail,
              auditedAt: lancamentoComAuditor.auditedAt,
              observation: lancamentoComAuditor.observacao,
            });
            if (pendenciaId) {
              await registrarEventoHistoricoSupabase({
                pendenciaId,
                lancamentoId: lancamentoComAuditor.id,
                userId: lancamentoComAuditor.auditedByUserId,
                userName: lancamentoComAuditor.auditedByName,
                userEmail: lancamentoComAuditor.auditedByEmail,
                acao: 'ENVIADO_OPERACAO',
                statusAnterior: 'AUDITORIA',
                statusNovo: 'EXCEDEU_AGUARDANDO_OPERACAO',
                comentario: lancamentoComAuditor.observacao,
                origemTela: 'AUDITORIA_LOTACAO',
              });
            }
          } catch (error) {
            console.warn('[Auditoria em lote] Pendência não registrada no painel novo:', error.message);
          }
        }

        salvos.push(item.chave);
      } catch (error) {
        falhas.push(`${item.cte?.numero_cte || item.chave}: ${error.message || String(error)}`);
      }
    }

    salvarLancamentosAuditoria(novosLancamentos);
    salvarSolicitacoesPagamento(novasSolicitacoes);
    setLancamentos(novosLancamentos);
    setSolicitacoes(novasSolicitacoes);
    setLoteSelecionados([]);
    setLoteResultados((atuais) => atuais.map((item) => (
      salvos.includes(item.chave)
        ? { ...item, status: 'JA_VINCULADO', statusLabel: 'já vinculado', selecionavel: false, observacao: 'Vinculado neste lote.' }
        : item
    )));
    setMensagem(
      falhas.length
        ? `Lote processado com ${salvos.length} vínculo(s) salvo(s) e ${falhas.length} falha(s): ${falhas.slice(0, 3).join(' | ')}`
        : `✓ ${salvos.length} CT-e(s) vinculado(s) à viagem com sucesso.`,
    );
    setSalvando(false);
  }, [viagemParaAuditoria, loteSelecionados, loteResultados, lancamentos, solicitacoes, usuarioAtual]);

  const atualizarStatusHistorico = useCallback(async (item, statusNovoItem, respostaTratamento = '') => {
    if (!item?.id) {
      setMensagem('Não foi possível atualizar: registro sem identificador.');
      throw new Error('Registro sem identificador.');
    }

    const respostaLimpa = String(respostaTratamento || '').trim();
    const agora = new Date().toISOString();
    const isQuestionamento = item.tipo === 'QUESTIONAMENTO_OPERACAO' || item.categoria === 'QUESTIONAMENTO_OPERACAO' || item.tipoGestao === 'QUESTIONAMENTO';

    setSalvando(true);
    setMensagem('');
    try {
      if (isQuestionamento) {
        await atualizarSolicitacaoInfoSupabase(item.id, statusNovoItem, {
          resposta: respostaLimpa,
          resposta_operacao: respostaLimpa,
          observacao_tratamento: respostaLimpa,
          respondido_por_id: usuarioAtual?.id || '',
          respondido_por_nome: usuarioAtual?.nome || usuarioAtual?.email || '',
          respondido_por_email: usuarioAtual?.email || '',
          respondido_em: agora,
        });
      } else {
        const statusUpper = String(statusNovoItem || '').toUpperCase();
        const valorOriginal = Number(item.valorAutorizadoCarga ?? item.valor_original ?? item.valor_autorizado ?? 0) || 0;
        const valorAdicional = statusUpper === 'APROVADO_OPERACAO'
          ? Number(item.valorAdicional ?? item.excedente ?? item.valor_excedente ?? 0) || 0
          : Number(item.valorAdicionalAprovado ?? item.valor_adicional_aprovado ?? 0) || 0;
        const valorFinal = valorOriginal + valorAdicional;
        const respostaOperacao = ['APROVADO_OPERACAO', 'RECUSADO_OPERACAO', 'DEVOLVIDO_AUDITORIA'].includes(statusUpper) ? respostaLimpa : (item.resposta_operacao || item.resposta || '');
        const respostaAuditoria = ['FINALIZADO', 'TRATADO', 'LIBERADO_PAGAMENTO'].includes(statusUpper) ? respostaLimpa : (item.resposta_auditoria || '');

        await atualizarPendenciaAuditoriaSupabase(item.id, statusNovoItem, {
          aprovado_por_user_id: usuarioAtual?.id || '',
          aprovado_por_name: usuarioAtual?.nome || usuarioAtual?.email || '',
          aprovado_por_email: usuarioAtual?.email || '',
          aprovado_em: agora,
          valor_original: valorOriginal,
          valor_adicional_aprovado: valorAdicional,
          valor_final_autorizado: valorFinal,
          prazo_auditoria_em: statusUpper === 'APROVADO_OPERACAO' ? adicionarHorasIso(agora, 24) : (item.prazoAuditoriaEm || item.prazo_auditoria_em || null),
          motivo_recusa: statusUpper === 'RECUSADO_OPERACAO' ? respostaLimpa : (item.motivo_recusa || ''),
          resposta_operacao: respostaOperacao,
          justificativa_operacao: respostaOperacao,
          resposta_auditoria: respostaAuditoria,
          auditado_ok_em: ['FINALIZADO', 'TRATADO', 'LIBERADO_PAGAMENTO'].includes(statusUpper) ? agora : (item.auditado_ok_em || null),
          devolvido_auditoria_em: statusUpper === 'DEVOLVIDO_AUDITORIA' ? agora : (item.devolvido_auditoria_em || null),
        });
      }

      try {
        await registrarEventoHistoricoSupabase({
          pendenciaId: isQuestionamento ? null : item.id,
          lancamentoId: isQuestionamento ? item.id : (item.lancamentoId || item.lancamento_id || ''),
          userId: usuarioAtual?.id || '',
          userName: usuarioAtual?.nome || '',
          userEmail: usuarioAtual?.email || '',
          acao: statusNovoItem,
          statusAnterior: item.status || '',
          statusNovo: statusNovoItem,
          comentario: respostaLimpa,
          origemTela: 'AUDITORIA_LOTACAO_HISTORICO',
        });
      } catch (error) {
        console.warn('[Auditoria] Status atualizado, mas histórico não registrado:', error.message || error);
      }

      const atualizadas = deduplicarSolicitacoesAuditoria((solicitacoes || []).map((sol) => (
        sol.id === item.id
          ? {
              ...sol,
              status: statusNovoItem,
              resposta: respostaLimpa || sol.resposta || '',
              resposta_operacao: isQuestionamento || ['APROVADO_OPERACAO', 'RECUSADO_OPERACAO', 'DEVOLVIDO_AUDITORIA'].includes(String(statusNovoItem || '').toUpperCase())
                ? (respostaLimpa || sol.resposta_operacao || '')
                : sol.resposta_operacao,
              resposta_auditoria: !isQuestionamento && ['FINALIZADO', 'TRATADO', 'LIBERADO_PAGAMENTO'].includes(String(statusNovoItem || '').toUpperCase())
                ? (respostaLimpa || sol.resposta_auditoria || '')
                : sol.resposta_auditoria,
              observacaoTratamento: respostaLimpa || sol.observacaoTratamento || '',
              atualizadoEm: agora,
              updated_at: agora,
            }
          : sol
      )));
      setSolicitacoes(atualizadas);
      salvarSolicitacoesPagamento(atualizadas);
      setMensagem('✓ Histórico/Pendências atualizado com sucesso.');
    } catch (error) {
      setMensagem(`Erro ao atualizar Histórico/Pendências: ${error.message || String(error)}`);
      throw error;
    } finally {
      setSalvando(false);
    }
  }, [solicitacoes, usuarioAtual]);

  const totalCargas = baseFluxo.cargas?.length || 0;
  const pendenciasAbertas = (solicitacoes || []).filter((i) => statusAbertoGestaoAuditoria(i.status)).length;

  return (
    <div className="page-shell lotacao-page lotacao-auditoria-page">
      <header className="page-top between">
        <div className="page-header">
          <span className="amd-mini-brand">Lotação · Auditoria</span>
          <h1>Auditoria Lotação</h1>
          <p>Central única de auditoria operacional: parta do CT-e ou do DIST, case com o realizado, consolide a viagem e controle o saldo.</p>
        </div>
        {usuarioAtual && (
          <div style={{ textAlign: 'right', fontSize: '0.85rem', opacity: 0.75 }}>
            <div><strong>{usuarioAtual.nome}</strong></div>
            <div>{usuarioAtual.email}</div>
          </div>
        )}
      </header>

      {(carregandoHistorico || carregandoAuditoria) && (
        <div className="hint-box compact">
          {carregandoHistorico ? 'Carregando histórico de cargas do Supabase...' : 'Carregando lançamentos e solicitações...'}
        </div>
      )}

      <PainelAuditoriaGeral lancamentos={lancamentos} solicitacoes={solicitacoes} totalCargas={totalCargas} fonteCargas={fonteCargas} />

      <AbasAuditoria ativa={abaAtiva} onMudar={setAbaAtiva} pendencias={pendenciasAbertas} />

      {abaAtiva === 'auditar' && (
        <>
          <div className="panel-card">
            <div className="section-row compact-top">
              <div>
                <div className="panel-title">Auditar</div>
                <p>Use buscas separadas: chave CT-e e número CT-e consultam a base de CT-es; DIST/HUB consulta somente o realizado.</p>
              </div>
            </div>

            <div className="form-grid three">
              <label className="field full-span">
                Buscar por chave CT-e
                <textarea
                  value={buscaChave}
                  onChange={(e) => {
                    setBuscaChave(e.target.value);
                    setLoteChavesTexto(e.target.value);
                    setLoteResultados([]);
                    setLoteSelecionados([]);
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); pesquisarLoteChaves(); } }}
                  placeholder="Cole uma ou várias chaves CT-e"
                  style={{ minHeight: 74 }}
                />
              </label>
            </div>
            <div className="actions-right">
              <button type="button" className="btn-primary" onClick={pesquisarLoteChaves} disabled={buscandoLote}>
                {buscandoLote ? 'Buscando...' : 'Buscar CT-e(s)'}
              </button>
            </div>

            <div className="form-grid three top-space-sm">
              <label className="field full-span">
                Buscar por número CT-e
                <input
                  value={buscaNumeroCte}
                  onChange={(e) => setBuscaNumeroCte(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') pesquisarPorNumeroCte(); }}
                  placeholder="Ex.: 69704"
                />
              </label>
            </div>
            <div className="actions-right">
              <button type="button" className="btn-secondary" onClick={pesquisarPorNumeroCte}>Buscar número CT-e</button>
            </div>

            <div className="form-grid three top-space-sm">
              <label className="field full-span">
                Buscar por DIST / viagem
                <input
                  value={buscaDist}
                  onChange={(e) => setBuscaDist(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') pesquisarPorDist(); }}
                  placeholder="Ex.: 12651, DIST-12651 ou HUB-12651"
                />
              </label>
            </div>
            <div className="actions-right">
              <button type="button" className="btn-secondary" onClick={pesquisarPorDist}>Buscar DIST / viagem</button>
            </div>

            {mensagem && <div className="hint-box compact">{mensagem}</div>}

            {(loteResultados.length > 0 || analiseLoteChaves.lidas > 0) && (
              <AuditoriaLoteCtes
                viagem={viagemParaAuditoria}
                lancamentos={lancamentos}
                texto={buscaChave}
                onTextoChange={(valor) => {
                  setBuscaChave(valor);
                  setLoteChavesTexto(valor);
                  setLoteResultados([]);
                  setLoteSelecionados([]);
                }}
                analise={analiseLoteChaves}
                resultados={loteResultados}
                selecionados={loteSelecionados}
                buscando={buscandoLote}
                salvando={salvando}
                onBuscar={pesquisarLoteChaves}
                onToggle={alternarSelecaoLote}
                onToggleTodos={alternarTodosLote}
                onVincular={vincularLoteSelecionado}
                onUsarCte={usarCteDoLote}
                sugestoesViagens={sugestoesViagens}
                onUsarViagem={setViagemSelecionada}
                mostrarEntrada={false}
              />
            )}

            {ctesEncontrados.length > 1 && (
              <div className="mini-list top-space-sm">
                {ctesEncontrados.map((cte) => (
                  <button
                    key={cte.id || cte.chave_cte || cte.numero_cte}
                    type="button"
                    className={cteSelecionado?.id === cte.id ? 'mini-list-row clickable active' : 'mini-list-row clickable'}
                    onClick={() => {
                      setCteSelecionado(cte);
                      setViagemSelecionada(null);
                      setTabelaSelecionadaChave('');
                      setSugestoesViagens([]);
                      setSugestoesVinculoTransportadora([]);
                      setSugestoesConsultadas(false);
                    }}
                  >
                    <span><strong>{cte.numero_cte || '-'}</strong> · {cte.transportadora || '-'} · {cte.cidade_origem || '-'} x {cte.cidade_destino || '-'}</span>
                    <strong>{formatarMoeda(cte.valor_cte)}</strong>
                  </button>
                ))}
              </div>
            )}

            <ListaViagens viagens={viagensResultado} selecionada={viagemSelecionada} onSelecionar={setViagemSelecionada} />
          </div>

          {cteSelecionado && <CardCteEncontrado cte={cteSelecionado} onUsar={setCteSelecionado} />}

          {cteSelecionado && (
            <div className="actions-right">
              <button type="button" className="btn-primary" onClick={buscarSugestoesNoRealizado} disabled={buscandoSugestoes}>
                {buscandoSugestoes ? 'Buscando...' : 'Buscar sugestões no realizado'}
              </button>
            </div>
          )}
          {cteSelecionado && sugestoesConsultadas && (
            <SugestoesViagens
              sugestoes={sugestoesViagens}
              onUsar={(viagem) => {
                setViagemSelecionada(viagem);
                setMensagem(`DIST/viagem ${viagem.dist || ''} selecionada para auditoria.`);
              }}
            />
          )}

          {cteSelecionado && (
            <ValidacaoTabelaLotacao
              resultados={tabelasCompativeis}
              viagem={viagemParaAuditoria || viagemSelecionada}
              tabelaSelecionada={tabelaSelecionada}
              onSelecionar={(tabela) => {
                setTabelaSelecionadaChave(chaveTabelaAuditoria(tabela));
                setMensagem('Tabela de lotação selecionada para a auditoria.');
              }}
            />
          )}

          {cteSelecionado && (
            <QuestionamentoOperacaoCard
              cte={cteSelecionado}
              viagem={viagemParaAuditoria || viagemSelecionada}
              tabelasCompativeis={tabelasCompativeis}
              tabelaSelecionada={tabelaSelecionada}
              motivos={motivosQuestionamentoOperacao}
              sugestoesConsultadas={sugestoesConsultadas}
              onEnviar={enviarQuestionamentoOperacao}
              salvando={salvando}
            />
          )}

          <ResumoViagemCard viagem={viagemParaAuditoria} lancamentos={lancamentos} cte={cteSelecionado} tabelaAuditoria={tabelaAplicavel} />
          <FormLancamento
            key={`${viagemParaAuditoria?.id || 'sem-viagem'}-${viagemParaAuditoria?.valorComparacao || 0}`}
            viagem={viagemParaAuditoria}
            lancamentos={lancamentos}
            solicitacoes={solicitacoes}
            onRegistrar={registrarLancamento}
            salvando={salvando}
            usuarioAtual={usuarioAtual}
            valorSugerido={cteSelecionado?.valor_cte}
            cteSugerido={cteSelecionado?.numero_cte}
          />
          <HistoricoLancamentos viagem={viagemParaAuditoria} lancamentos={lancamentos} />
          <MovimentosAutorizacao viagem={viagemParaAuditoria} solicitacoes={solicitacoes} />
        </>
      )}

      {abaAtiva === 'vinculos' && (
        <PainelVinculos
          vinculos={vinculos}
          onSalvar={salvarVinculosState}
          onRemover={removerVinculoState}
          sugestaoRealizado={viagemSelecionada?.transportadora || ''}
          sugestaoCte={cteSelecionado?.transportadora || cteSelecionado?.transportadora_contratada || ''}
          fonte={fonteVinculos}
          salvando={salvandoVinculos}
        />
      )}

      {abaAtiva === 'historico' && (
        <HistoricoPendencias
          lancamentos={lancamentos}
          solicitacoes={solicitacoes}
          onAtualizarStatus={atualizarStatusHistorico}
          salvando={salvando}
        />
      )}
    </div>
  );
}
