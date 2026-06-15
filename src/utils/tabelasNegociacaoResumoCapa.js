/** Recorte leve de resumo_simulacao para listagem e dashboard (sem CT-es/detalhes pesados). */

export function erroColunaResumoCapaAusente(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  const code = String(error?.code || '').toUpperCase();
  if (!msg.includes('resumo_capa') && code !== 'PGRST204') return false;
  if (code === 'PGRST204' && msg.includes('resumo_capa')) return true;
  if (!msg.includes('resumo_capa')) return false;
  return (
    msg.includes('schema cache')
    || msg.includes('does not exist')
    || msg.includes('column')
  );
}

export function removerResumoCapaDoSelect(selectCols) {
  if (!selectCols || selectCols === '*') return selectCols;
  return String(selectCols)
    .split(',')
    .map((col) => col.trim())
    .filter((col) => col && col !== 'resumo_capa')
    .join(',');
}

function n(valor) {
  const num = Number(valor || 0);
  return Number.isFinite(num) ? num : 0;
}

function podarIndicadores(ind = {}) {
  if (!ind || typeof ind !== 'object') return {};
  return {
    rodada: n(ind.rodada),
    ctes_analisados: n(ind.ctes_analisados),
    ctes_com_tabela: n(ind.ctes_com_tabela),
    ctes_ganhos: n(ind.ctes_capturados || ind.ctes_ganhos),
    ctes_perdidos: n(ind.ctes_perdidos),
    aderencia: n(ind.aderencia),
    saving_mes: n(ind.saving_mes),
    saving_ano: n(ind.saving_ano),
    faturamento_mes: n(ind.faturamento_mes),
    impacto_mensal: n(ind.impacto_mensal || ind.impacto_valor),
    percentual_frete_realizado: n(ind.percentual_frete_realizado),
    percentual_frete_simulado: n(ind.percentual_frete_simulado),
    pedidos_dia: n(ind.pedidos_dia || ind.pedidos_ganhos_dia),
    volumes_dia: n(ind.volumes_dia || ind.volumes_ganhos_dia),
  };
}

function podarResumoRodada(resumo = {}) {
  if (!resumo || typeof resumo !== 'object' || Array.isArray(resumo)) return {};
  return {
    salvo_em: resumo.salvo_em || resumo.geradoEm || null,
    rodada: n(resumo.rodada),
    ctesAnalisados: n(resumo.ctesAnalisados),
    ctesComTabelaSelecionada: n(resumo.ctesComTabelaSelecionada),
    ctesGanhariaSelecionada: n(resumo.ctesGanhariaSelecionada),
    ctesPerdidosSelecionada: n(resumo.ctesPerdidosSelecionada),
    savingSelecionadaVsRealMes: n(resumo.savingSelecionadaVsRealMes || resumo.savingSelecionadaVsReal),
    aderenciaSelecionada: n(resumo.aderenciaSelecionada),
    faturamentoSelecionadaMes: n(resumo.faturamentoSelecionadaMes || resumo.freteSelecionada),
    percentualFreteSelecionada: n(resumo.percentualFreteSelecionada || resumo.percentualFreteTabelaGanharia),
    cargasDia: n(resumo.cargasDia),
    volumesDia: n(resumo.volumesDia),
    qtdRotasComGanhoSelecionada: n(resumo.qtdRotasComGanhoSelecionada),
    rotasGanhasDestaque: Array.isArray(resumo.rotasGanhasDestaque) ? resumo.rotasGanhasDestaque.slice(0, 6) : [],
  };
}

export function podarEntradaHistoricoRodada(entrada = {}) {
  if (!entrada || typeof entrada !== 'object') return entrada;
  const tipo = String(entrada.tipo_registro || '').toUpperCase();
  const base = {
    id: entrada.id,
    tipo_registro: entrada.tipo_registro,
    rodada: n(entrada.rodada),
    criado_em: entrada.criado_em,
    observacao: entrada.observacao,
    origem_importacao: entrada.origem_importacao,
    arquivo: entrada.arquivo,
    itens_importados: entrada.itens_importados,
    itens_salvos_apos_importacao: entrada.itens_salvos_apos_importacao,
    origens_detectadas: entrada.origens_detectadas,
    indicadores: podarIndicadores(entrada.indicadores),
  };

  if (tipo === 'SIMULACAO') {
    return {
      ...base,
      resumo: podarResumoRodada(entrada.resumo),
    };
  }
  return base;
}

export function extrairResumoCapaNegociacao(resumoCompleto = {}) {
  if (!resumoCompleto || typeof resumoCompleto !== 'object' || Array.isArray(resumoCompleto)) {
    return {};
  }

  const historico = Array.isArray(resumoCompleto.historico_rodadas)
    ? resumoCompleto.historico_rodadas.map(podarEntradaHistoricoRodada).slice(-12)
    : [];

  const ultimaSim = resumoCompleto.ultima_simulacao
    ? podarEntradaHistoricoRodada(resumoCompleto.ultima_simulacao)
    : null;

  const laudos = resumoCompleto.laudos && typeof resumoCompleto.laudos === 'object'
    ? {
      executivo: resumoCompleto.laudos.executivo
        ? {
          assunto: resumoCompleto.laudos.executivo.assunto,
          geradoEm: resumoCompleto.laudos.executivo.geradoEm,
        }
        : null,
      transportador: resumoCompleto.laudos.transportador
        ? {
          assunto: resumoCompleto.laudos.transportador.assunto,
          geradoEm: resumoCompleto.laudos.transportador.geradoEm,
        }
        : null,
    }
    : undefined;

  return {
    rodada_atual: n(resumoCompleto.rodada_atual) || 1,
    ultima_simulacao_em: resumoCompleto.ultima_simulacao_em || ultimaSim?.criado_em || null,
    ultima_importacao_em: resumoCompleto.ultima_importacao_em || null,
    totais_itens: resumoCompleto.totais_itens || {},
    origens_detectadas: Array.isArray(resumoCompleto.origens_detectadas)
      ? resumoCompleto.origens_detectadas.slice(0, 12)
      : [],
    ultima_importacao: resumoCompleto.ultima_importacao
      ? podarEntradaHistoricoRodada(resumoCompleto.ultima_importacao)
      : null,
    ctesAnalisados: n(resumoCompleto.ctesAnalisados),
    ctesComTabelaSelecionada: n(resumoCompleto.ctesComTabelaSelecionada),
    ctesGanhariaSelecionada: n(resumoCompleto.ctesGanhariaSelecionada),
    ctesPerdidosSelecionada: n(resumoCompleto.ctesPerdidosSelecionada),
    savingSelecionadaVsRealMes: n(resumoCompleto.savingSelecionadaVsRealMes || resumoCompleto.savingSelecionadaVsReal),
    aderenciaSelecionada: n(resumoCompleto.aderenciaSelecionada),
    faturamentoSelecionadaMes: n(resumoCompleto.faturamentoSelecionadaMes || resumoCompleto.freteSelecionada),
    percentualFreteSelecionada: n(resumoCompleto.percentualFreteSelecionada || resumoCompleto.percentualFreteTabelaGanharia),
    qtdRotas: n(resumoCompleto.qtdRotas || resumoCompleto.rotas_total),
    rotasGanhasDestaque: Array.isArray(resumoCompleto.rotasGanhasDestaque)
      ? resumoCompleto.rotasGanhasDestaque.slice(0, 8)
      : [],
    estadosGanhadoresDestaque: Array.isArray(resumoCompleto.estadosGanhadoresDestaque)
      ? resumoCompleto.estadosGanhadoresDestaque.slice(0, 6)
      : [],
    historico_rodadas: historico,
    ultima_simulacao: ultimaSim,
    laudos,
    laudos_gerados_em: resumoCompleto.laudos_gerados_em || null,
    _capa: true,
  };
}

export function mesclarResumoCapaNaTabela(row = {}) {
  if (!row || typeof row !== 'object') return row;
  const capaDb = row.resumo_capa && typeof row.resumo_capa === 'object' ? row.resumo_capa : null;
  const capaDerivada = capaDb || extrairResumoCapaNegociacao(row.resumo_simulacao);
  const { resumo_simulacao: _full, resumo_capa: _capaCol, ...resto } = row;
  return {
    ...resto,
    resumo_simulacao: capaDerivada,
    resumo_completo_disponivel: Boolean(_full && !_full._capa),
  };
}

export function anexarResumoCapaNoPayload(payload = {}) {
  if (!payload.resumo_simulacao) return payload;
  return {
    ...payload,
    resumo_capa: extrairResumoCapaNegociacao(payload.resumo_simulacao),
  };
}
