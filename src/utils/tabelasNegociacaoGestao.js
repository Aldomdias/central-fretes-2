const DIAS_SEM_ATUALIZACAO_ALERTA = 14;

export const STATUS_GESTAO = [
  { value: 'RASCUNHO', label: 'Rascunho', cor: '#94a3b8' },
  { value: 'EM_NEGOCIACAO', label: 'Em negociação', cor: '#3b82f6' },
  { value: 'EM_ANALISE', label: 'Em análise', cor: '#8b5cf6' },
  { value: 'AGUARDANDO_TRANSPORTADORA', label: 'Aguardando retorno da transportadora', cor: '#f59e0b' },
  { value: 'AGUARDANDO_APROVACAO_GESTOR', label: 'Aguardando aprovação do gestor', cor: '#ea580c' },
  { value: 'APROVADA_NEGOCIADOR', label: 'Aprovada pelo negociador', cor: '#0ea5e9' },
  { value: 'APROVADA_GESTOR', label: 'Aprovada pelo gestor', cor: '#16a34a' },
  { value: 'RECUSADA', label: 'Recusada', cor: '#dc2626' },
  { value: 'PUBLICADA_OFICIAL', label: 'Publicada na base oficial', cor: '#059669' },
  { value: 'CANCELADA', label: 'Cancelada', cor: '#6b7280' },
  { value: 'SUBSTITUIDA', label: 'Substituída', cor: '#78716c' },
  { value: 'DEVOLVIDA_AJUSTE', label: 'Devolvida para ajuste', cor: '#d97706' },
];

export const STATUS_GESTAO_VALUES = STATUS_GESTAO.map((s) => s.value);

export const FILTROS_RAPIDOS = [
  { key: 'minhas', label: 'Minhas negociações' },
  { key: 'minha_acao', label: 'Aguardando minha ação' },
  { key: 'aguardando_gestor', label: 'Aguardando aprovação do gestor' },
  { key: 'em_negociacao', label: 'Em negociação' },
  { key: 'reajustes', label: 'Reajustes' },
  { key: 'saving_positivo', label: 'Saving positivo' },
  { key: 'sem_atualizacao', label: 'Sem atualização' },
  { key: 'publicadas', label: 'Publicadas' },
];

export const REGIOES_BRASIL = {
  NORTE: ['AC', 'AP', 'AM', 'PA', 'RO', 'RR', 'TO'],
  NORDESTE: ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'],
  'CENTRO-OESTE': ['DF', 'GO', 'MS', 'MT'],
  SUDESTE: ['ES', 'MG', 'RJ', 'SP'],
  SUL: ['PR', 'RS', 'SC'],
};

const MAPA_STATUS_LEGADO = {
  'EM NEGOCIAÇÃO': 'EM_NEGOCIACAO',
  'EM TESTE': 'EM_ANALISE',
  APROVADA: 'APROVADA_GESTOR',
  REPROVADA: 'RECUSADA',
  'PROMOVIDA PARA OFICIAL': 'PUBLICADA_OFICIAL',
  CANCELADA: 'CANCELADA',
};

function texto(v) { return String(v ?? '').trim(); }
function upper(v) { return texto(v).toUpperCase(); }
function numero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function obterRegiaoPorUf(uf) {
  const alvo = upper(uf);
  if (!alvo) return '';
  return Object.entries(REGIOES_BRASIL).find(([, ufs]) => ufs.includes(alvo))?.[0] || '';
}

export function labelStatusGestao(status) {
  const norm = normalizarStatusGestao(status);
  return STATUS_GESTAO.find((s) => s.value === norm)?.label || norm.replace(/_/g, ' ');
}

export function corStatusGestao(status) {
  const norm = normalizarStatusGestao(status);
  return STATUS_GESTAO.find((s) => s.value === norm)?.cor || '#64748b';
}

export function normalizarStatusGestao(tabela = {}) {
  if (typeof tabela === 'string') {
    const raw = upper(tabela);
    if (STATUS_GESTAO_VALUES.includes(raw)) return raw;
    return MAPA_STATUS_LEGADO[raw] || raw;
  }
  const gestao = upper(tabela.status_gestao);
  if (gestao && STATUS_GESTAO_VALUES.includes(gestao)) return gestao;
  const legado = upper(tabela.status);
  return MAPA_STATUS_LEGADO[legado] || gestao || 'EM_NEGOCIACAO';
}

export function statusLegadoPorGestao(statusGestao) {
  const mapa = {
    RASCUNHO: 'EM NEGOCIAÇÃO',
    EM_NEGOCIACAO: 'EM NEGOCIAÇÃO',
    EM_ANALISE: 'EM TESTE',
    AGUARDANDO_TRANSPORTADORA: 'EM NEGOCIAÇÃO',
    AGUARDANDO_APROVACAO_GESTOR: 'EM TESTE',
    APROVADA_NEGOCIADOR: 'EM TESTE',
    APROVADA_GESTOR: 'APROVADA',
    RECUSADA: 'REPROVADA',
    PUBLICADA_OFICIAL: 'PROMOVIDA PARA OFICIAL',
    CANCELADA: 'CANCELADA',
    SUBSTITUIDA: 'CANCELADA',
    DEVOLVIDA_AJUSTE: 'EM NEGOCIAÇÃO',
  };
  return mapa[normalizarStatusGestao(statusGestao)] || 'EM NEGOCIAÇÃO';
}

export function nomeUsuarioGestao(valor, fallback = 'Não informado') {
  const nome = texto(valor);
  if (!nome) return fallback;
  if (/^(usr-|uuid-)/i.test(nome) || /^[0-9a-f-]{20,}$/i.test(nome)) return fallback;
  return nome;
}

function historicoRodadasTabela(tabela = {}) {
  const resumo = tabela.resumo_simulacao && typeof tabela.resumo_simulacao === 'object' && !Array.isArray(tabela.resumo_simulacao)
    ? tabela.resumo_simulacao
    : {};
  if (Array.isArray(resumo.historico_rodadas)) return resumo.historico_rodadas;
  if (Array.isArray(resumo.rodadas)) return resumo.rodadas;
  return [];
}

export function getRodadaAtualGestao(tabela = {}) {
  const resumo = tabela.resumo_simulacao && typeof tabela.resumo_simulacao === 'object' && !Array.isArray(tabela.resumo_simulacao)
    ? tabela.resumo_simulacao
    : {};
  const hist = historicoRodadasTabela(tabela);
  return numero(resumo.rodada_atual || (hist.length ? hist[hist.length - 1]?.rodada : 1) || 1) || 1;
}

export function negociacaoTemSimulacaoSalva(tabela = {}) {
  const resumo = tabela.resumo_simulacao && typeof tabela.resumo_simulacao === 'object' && !Array.isArray(tabela.resumo_simulacao)
    ? tabela.resumo_simulacao
    : {};
  return Boolean(
    resumo.ultima_simulacao
    || resumo.salvo_em
    || tabela.aderencia_projetada
    || tabela.saving_projetado
    || tabela.faturamento_projetado
    || tabela.impacto_valor
    || tabela.valor_simulado_nova_tabela,
  );
}

/** Fluxo: disponível no Simulador → salva → some do Simulador → simular novamente (mesma rodada) ou nova rodada. */
export function getEstadoSimulacaoNegociacao(tabela = {}) {
  const disponivel = Boolean(tabela.incluir_simulacao);
  const temSimulacao = negociacaoTemSimulacaoSalva(tabela);
  const rodada = getRodadaAtualGestao(tabela);

  if (disponivel) {
    return {
      disponivel: true,
      temSimulacao,
      rodada,
      rotuloAcao: 'Remover da simulação',
      rotuloStatus: 'Disponível no Simulador Realizado',
      statusCor: '#15803d',
    };
  }
  if (temSimulacao) {
    return {
      disponivel: false,
      temSimulacao: true,
      rodada,
      rotuloAcao: 'Simular novamente',
      rotuloStatus: `${rodada}ª rodada com análise salva — não está no Simulador`,
      statusCor: '#b45309',
    };
  }
  return {
    disponivel: false,
    temSimulacao: false,
    rodada,
    rotuloAcao: 'Disponibilizar p/ simulação',
    rotuloStatus: `${rodada}ª rodada aguardando simulação`,
    statusCor: '#64748b',
  };
}

export function resolverUsuariosNegociacao(tabela = {}) {
  const historicoGestao = Array.isArray(tabela.historico_gestao) ? tabela.historico_gestao : [];
  const historicoRodadas = historicoRodadasTabela(tabela);
  const resumo = tabela.resumo_simulacao && typeof tabela.resumo_simulacao === 'object' && !Array.isArray(tabela.resumo_simulacao)
    ? tabela.resumo_simulacao
    : {};

  const eventoCriacao = historicoGestao.find((e) => e.tipo === 'CRIACAO');
  const usuariosRodadas = historicoRodadas
    .map((e) => e.usuario_aprovacao || e.usuario_nome || e.usuario)
    .filter(Boolean);
  const ultimaAprovacao = resumo.ultima_aprovacao?.usuario_aprovacao || '';

  const criadoPor = nomeUsuarioGestao(
    tabela.criado_por_nome
    || eventoCriacao?.usuario_nome
    || tabela.criado_por,
    '',
  ) || 'Não informado';

  const negociador = nomeUsuarioGestao(
    tabela.negociador_nome
    || tabela.negociador_id,
    '',
  ) || nomeUsuarioGestao(
    tabela.criado_por_nome
    || eventoCriacao?.usuario_nome,
    '',
  ) || nomeUsuarioGestao(usuariosRodadas[0], '') || 'Não informado';

  const aprovador = nomeUsuarioGestao(
    tabela.aprovador_nome
    || tabela.usuario_aprovacao
    || ultimaAprovacao,
    '—',
  );

  const legado = !texto(tabela.criado_por_nome)
    && !texto(tabela.criado_por)
    && !eventoCriacao?.usuario_nome;

  return { criadoPor, negociador, aprovador, legado };
}

export function enriquecerTabelaGestao(tabela = {}, sessao = null) {
  const statusGestao = normalizarStatusGestao(tabela);
  const resumo = tabela.resumo_simulacao && typeof tabela.resumo_simulacao === 'object' && !Array.isArray(tabela.resumo_simulacao)
    ? tabela.resumo_simulacao
    : {};
  const ultimaSim = resumo.ultima_simulacao?.indicadores || {};
  const tipoNegociacao = upper(tabela.tipo_negociacao) || (upper(tabela.tipo_tabela) === 'LOTACAO' ? 'TABELA_LOTACAO' : 'NOVA_TABELA');
  const isReajuste = tipoNegociacao === 'REAJUSTE_TABELA_EXISTENTE';
  const saving = numero(tabela.saving_projetado || ultimaSim.saving_mes || resumo.savingSelecionadaVsRealMes || 0);
  const impacto = numero(tabela.impacto_valor || ultimaSim.impacto_valor || resumo.impacto_valor || 0);
  const rotas = numero(resumo.qtdRotas || resumo.rotas_total || tabela.qtd_rotas || 0);
  const origensDetectadas = Array.isArray(resumo.origens_detectadas) ? resumo.origens_detectadas : [];
  const origemLabel = texto(tabela.origem)
    ? `${texto(tabela.origem)}${tabela.uf_origem ? `/${tabela.uf_origem}` : ''}`
    : (origensDetectadas[0] ? `${texto(origensDetectadas[0].cidade)}/${texto(origensDetectadas[0].uf)}` : 'Não informada');

  const usuarios = resolverUsuariosNegociacao(tabela);
  const criadoPorNome = usuarios.legado ? `${usuarios.criadoPor} (antes da 4.37)` : usuarios.criadoPor;
  const negociadorNome = usuarios.negociador;
  const aprovadorNome = usuarios.aprovador;

  const atualizadoEm = tabela.atualizado_em || tabela.criado_em;
  const diasSemAtualizacao = atualizadoEm
    ? Math.floor((Date.now() - new Date(atualizadoEm).getTime()) / (1000 * 60 * 60 * 24))
    : 999;

  const minha = sessao?.id && (
    tabela.negociador_id === sessao.id
    || tabela.criado_por === sessao.id
    || upper(tabela.negociador_nome) === upper(sessao.nome)
    || upper(tabela.criado_por_nome) === upper(sessao.nome)
  );

  return {
    ...tabela,
    status_gestao: statusGestao,
    status_gestao_label: labelStatusGestao(statusGestao),
    status_gestao_cor: corStatusGestao(statusGestao),
    tipo_negociacao_norm: tipoNegociacao,
    is_reajuste: isReajuste,
    saving_estimado: saving,
    impacto_reajuste: isReajuste ? impacto : 0,
    qtd_rotas: rotas,
    origem_label: origemLabel,
    criado_por_display: criadoPorNome,
    negociador_display: negociadorNome,
    aprovador_display: aprovadorNome,
    dias_sem_atualizacao: diasSemAtualizacao,
    sem_atualizacao_alerta: diasSemAtualizacao >= DIAS_SEM_ATUALIZACAO_ALERTA
      && !['PUBLICADA_OFICIAL', 'CANCELADA', 'RECUSADA', 'SUBSTITUIDA'].includes(statusGestao),
    minha_negociacao: Boolean(minha),
    regiao_origem: obterRegiaoPorUf(tabela.uf_origem),
    nome_negociacao: texto(tabela.descricao) || `${tabela.transportadora} · ${origemLabel}`,
  };
}

export function calcularDashboardGestao(tabelas = []) {
  const lista = tabelas.map((t) => enriquecerTabelaGestao(t));
  const transportadoras = new Set(lista.map((t) => upper(t.transportadora)).filter(Boolean));
  const origens = new Set(lista.map((t) => upper(t.origem_label)).filter(Boolean));

  const porStatus = (status) => lista.filter((t) => t.status_gestao === status).length;

  const savingAcumulado = lista
    .filter((t) => ['APROVADA_GESTOR', 'PUBLICADA_OFICIAL'].includes(t.status_gestao))
    .reduce((acc, t) => acc + t.saving_estimado, 0);

  const savingPotencial = lista
    .filter((t) => !['PUBLICADA_OFICIAL', 'CANCELADA', 'RECUSADA', 'SUBSTITUIDA'].includes(t.status_gestao))
    .reduce((acc, t) => acc + Math.max(0, t.saving_estimado), 0);

  const impactoReajustes = lista
    .filter((t) => t.is_reajuste)
    .reduce((acc, t) => acc + t.impacto_reajuste, 0);

  const reajustesAguardando = lista.filter((t) => t.is_reajuste && t.status_gestao === 'AGUARDANDO_APROVACAO_GESTOR').length;
  const reajustesAprovados = lista.filter((t) => t.is_reajuste && t.status_gestao === 'APROVADA_GESTOR').length;
  const reajustesRecusados = lista.filter((t) => t.is_reajuste && t.status_gestao === 'RECUSADA').length;

  return {
    total: lista.length,
    emAndamento: lista.filter((t) => ['EM_NEGOCIACAO', 'EM_ANALISE', 'AGUARDANDO_TRANSPORTADORA', 'APROVADA_NEGOCIADOR', 'DEVOLVIDA_AJUSTE'].includes(t.status_gestao)).length,
    aguardandoAprovacao: porStatus('AGUARDANDO_APROVACAO_GESTOR'),
    aprovadas: porStatus('APROVADA_GESTOR'),
    recusadas: porStatus('RECUSADA'),
    publicadas: porStatus('PUBLICADA_OFICIAL'),
    savingAcumulado,
    savingPotencial,
    impactoReajustes,
    transportadoras: transportadoras.size,
    origensRotas: origens.size,
    semAtualizacao: lista.filter((t) => t.sem_atualizacao_alerta).length,
    novas: lista.filter((t) => t.tipo_negociacao_norm === 'NOVA_TABELA').length,
    reajustes: lista.filter((t) => t.is_reajuste).length,
    lotacao: lista.filter((t) => t.tipo_negociacao_norm === 'TABELA_LOTACAO').length,
    reajustesAguardando,
    reajustesAprovados,
    reajustesRecusados,
    savingPorNegociador: agruparSavingPorCampo(lista, 'negociador_display'),
    savingPorTransportadora: agruparSavingPorCampo(lista, 'transportadora'),
    savingPorCanal: agruparSavingPorCampo(lista, 'canal'),
  };
}

function agruparSavingPorCampo(lista, campo) {
  const mapa = new Map();
  lista.forEach((t) => {
    const chave = texto(t[campo]) || 'Não informado';
    if (!mapa.has(chave)) mapa.set(chave, { nome: chave, saving: 0, qtd: 0 });
    const reg = mapa.get(chave);
    reg.saving += t.saving_estimado;
    reg.qtd += 1;
  });
  return [...mapa.values()].sort((a, b) => b.saving - a.saving).slice(0, 12);
}

export function filtrarTabelasGestao(tabelas = [], filtros = {}, sessao = null) {
  let lista = tabelas.map((t) => enriquecerTabelaGestao(t, sessao));

  if (filtros.transportadora) {
    const termo = upper(filtros.transportadora);
    lista = lista.filter((t) => upper(t.transportadora).includes(termo));
  }
  if (filtros.negociador) {
    const termo = upper(filtros.negociador);
    lista = lista.filter((t) => upper(t.negociador_display).includes(termo));
  }
  if (filtros.criadoPor) {
    const termo = upper(filtros.criadoPor);
    lista = lista.filter((t) => upper(t.criado_por_display).includes(termo));
  }
  if (filtros.statusGestao) {
    lista = lista.filter((t) => t.status_gestao === filtros.statusGestao);
  }
  if (filtros.tipoNegociacao) {
    lista = lista.filter((t) => t.tipo_negociacao_norm === upper(filtros.tipoNegociacao));
  }
  if (filtros.canal) {
    lista = lista.filter((t) => upper(t.canal) === upper(filtros.canal));
  }
  if (filtros.origem) {
    const termo = upper(filtros.origem);
    lista = lista.filter((t) => upper(t.origem).includes(termo) || upper(t.origem_label).includes(termo));
  }
  if (filtros.regiaoOrigem) {
    lista = lista.filter((t) => t.regiao_origem === upper(filtros.regiaoOrigem));
  }
  if (filtros.ufOrigem) {
    lista = lista.filter((t) => upper(t.uf_origem) === upper(filtros.ufOrigem));
  }
  if (filtros.ufDestino) {
    lista = lista.filter((t) => upper(t.uf_destino) === upper(filtros.ufDestino));
  }
  if (filtros.comSavingPositivo) {
    lista = lista.filter((t) => t.saving_estimado > 0);
  }
  if (filtros.comReajuste) {
    lista = lista.filter((t) => t.is_reajuste);
  }
  if (filtros.aguardandoAprovacao) {
    lista = lista.filter((t) => t.status_gestao === 'AGUARDANDO_APROVACAO_GESTOR');
  }
  if (filtros.minhasNegociacoes && sessao) {
    lista = lista.filter((t) => t.minha_negociacao);
  }
  if (filtros.semAtualizacao) {
    lista = lista.filter((t) => t.sem_atualizacao_alerta);
  }
  if (filtros.publicadas) {
    lista = lista.filter((t) => t.status_gestao === 'PUBLICADA_OFICIAL');
  }
  if (filtros.recusadas) {
    lista = lista.filter((t) => t.status_gestao === 'RECUSADA');
  }
  if (filtros.busca) {
    const termo = upper(filtros.busca);
    lista = lista.filter((t) => [
      t.transportadora, t.descricao, t.origem, t.negociador_display, t.criado_por_display,
      t.status_gestao_label, t.canal, t.tipo_negociacao_norm,
    ].some((v) => upper(v).includes(termo)));
  }

  if (filtros.filtroRapido) {
    const mapaRapido = {
      minhas: () => sessao && lista.filter((t) => t.minha_negociacao),
      minha_acao: () => lista.filter((t) => (
        (sessao?.perfil === 'GESTAO' && t.status_gestao === 'AGUARDANDO_APROVACAO_GESTOR')
        || (t.minha_negociacao && ['DEVOLVIDA_AJUSTE', 'AGUARDANDO_TRANSPORTADORA'].includes(t.status_gestao))
      )),
      aguardando_gestor: () => lista.filter((t) => t.status_gestao === 'AGUARDANDO_APROVACAO_GESTOR'),
      em_negociacao: () => lista.filter((t) => ['EM_NEGOCIACAO', 'AGUARDANDO_TRANSPORTADORA'].includes(t.status_gestao)),
      reajustes: () => lista.filter((t) => t.is_reajuste),
      saving_positivo: () => lista.filter((t) => t.saving_estimado > 0),
      sem_atualizacao: () => lista.filter((t) => t.sem_atualizacao_alerta),
      publicadas: () => lista.filter((t) => t.status_gestao === 'PUBLICADA_OFICIAL'),
    };
    const fn = mapaRapido[filtros.filtroRapido];
    if (fn) lista = fn() || lista;
  }

  return lista;
}

export function agruparPorTransportadora(tabelas = [], sessao = null) {
  const mapa = new Map();
  tabelas.forEach((raw) => {
    const t = enriquecerTabelaGestao(raw, sessao);
    const chave = upper(t.transportadora) || 'SEM TRANSPORTADORA';
    if (!mapa.has(chave)) {
      mapa.set(chave, {
        transportadora: t.transportadora || 'Sem transportadora',
        negociador: t.negociador_display,
        savingTotal: 0,
        impactoTotal: 0,
        qtdNegociacoes: 0,
        origens: [],
      });
    }
    const grupo = mapa.get(chave);
    grupo.savingTotal += t.saving_estimado;
    grupo.impactoTotal += t.impacto_reajuste;
    grupo.qtdNegociacoes += 1;

    const origemChave = upper(t.origem_label);
    if (!origemChave || origemChave === 'NÃO INFORMADA') return;
    let origem = grupo.origens.find((o) => upper(o.label) === origemChave);
    if (!origem) {
      origem = {
        label: t.origem_label,
        cidade: t.origem,
        uf: t.uf_origem,
        canal: t.canal,
        status: t.status_gestao_label,
        statusCor: t.status_gestao_cor,
        rotas: t.qtd_rotas,
        saving: t.saving_estimado,
        impacto: t.impacto_reajuste,
        aprovada: ['APROVADA_GESTOR', 'PUBLICADA_OFICIAL'].includes(t.status_gestao),
        publicada: t.status_gestao === 'PUBLICADA_OFICIAL',
        negociacaoId: t.id,
      };
      grupo.origens.push(origem);
    } else {
      origem.rotas += t.qtd_rotas;
      origem.saving += t.saving_estimado;
      origem.impacto += t.impacto_reajuste;
    }
  });

  return [...mapa.values()]
    .map((g) => ({ ...g, origens: g.origens.sort((a, b) => b.saving - a.saving) }))
    .sort((a, b) => b.savingTotal - a.savingTotal);
}

export function listarHistoricoGestao(tabelas = []) {
  const eventos = [];
  tabelas.forEach((tabela) => {
    const historico = Array.isArray(tabela.historico_gestao) ? tabela.historico_gestao : [];
    historico.forEach((ev) => {
      eventos.push({
        ...ev,
        negociacao_id: tabela.id,
        transportadora: tabela.transportadora,
        negociador: nomeUsuarioGestao(tabela.negociador_nome || tabela.negociador_id),
      });
    });
    if (!historico.length && tabela.criado_em) {
      eventos.push({
        id: `LEGADO-${tabela.id}`,
        tipo: 'CRIACAO',
        criado_em: tabela.criado_em,
        usuario_nome: nomeUsuarioGestao(tabela.criado_por_nome, 'Legado'),
        observacao: 'Registro legado sem histórico detalhado',
        status_anterior: null,
        status_novo: normalizarStatusGestao(tabela),
        negociacao_id: tabela.id,
        transportadora: tabela.transportadora,
        negociador: nomeUsuarioGestao(tabela.negociador_nome),
      });
    }
  });
  return eventos.sort((a, b) => new Date(b.criado_em || 0) - new Date(a.criado_em || 0));
}

export function usuarioEhGestor(sessao) {
  return sessao?.perfil === 'GESTAO';
}

export function podePublicarOficial(tabela) {
  return normalizarStatusGestao(tabela) === 'APROVADA_GESTOR';
}

export function formatarMoeda(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatarData(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString('pt-BR');
}
