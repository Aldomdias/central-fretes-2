import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { carregarBaseCompletaDb } from './freteDatabaseService';
import { calcularFreteFaixaPeso, calcularFretePercentual } from './freteCalcEngine';

const PAGE_SIZE = 1000;
const INSERT_CHUNK = 500;
const TABELA_CTES = 'realizado_local_ctes';
const TABELA_RESULTADOS = 'auditoria_cte_resultados';
const TABELA_RESUMO = 'auditoria_cte_resumo_mensal';
const LIMITE_DIVERGENCIA_ASSERTIVO = 0.05;

function ensureSupabase() {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase não configurado. Verifique VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Cliente Supabase indisponível.');
  }

  return supabase;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  const text = String(value).trim();
  if (!text) return 0;

  const normalized = text.includes(',')
    ? text.replace(/\./g, '').replace(',', '.')
    : text;

  const parsed = Number(normalized.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function normalizeCompare(value) {
  return normalizeText(value).toLowerCase();
}

function pick(row = {}, keys = []) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return '';
}

function competenciaParaDatas(competencia = '') {
  if (!competencia || !/^\d{4}-\d{2}$/.test(competencia)) return null;

  const [ano, mes] = competencia.split('-').map(Number);
  const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const fim = `${ano}-${String(mes).padStart(2, '0')}-${ultimoDia}`;

  return { inicio, fim };
}

function canalCategoria(value) {
  const canal = normalizeText(value);
  if (!canal) return '';
  if (canal.includes('A DEFINIR') || canal.includes('SEM TABELA') || canal.includes('SEM VINCULO')) return 'A DEFINIR';
  if (canal.includes('INTERCOMPANY')) return 'INTERCOMPANY';
  if (canal.includes('REVERSA')) return 'REVERSA';
  if (canal.includes('ATACADO') || canal === 'B2B' || canal.includes(' B2B')) return 'ATACADO';
  if (canal.includes('B2C') || canal.includes('MARKETPLACE') || canal.includes('ECOMMERCE')) return 'B2C';
  return canal;
}

function canalCompativel(canalTabela, canalCte) {
  const tabela = canalCategoria(canalTabela);
  const cte = canalCategoria(canalCte);

  if (cte === 'A DEFINIR') return false;
  if (!cte) return true;
  if (!tabela) return true;

  return tabela === cte || tabela.includes(cte) || cte.includes(tabela);
}

function nomeCompativel(nomeTabela, nomeCte) {
  const tabela = normalizeCompare(nomeTabela);
  const cte = normalizeCompare(nomeCte);

  if (!tabela || !cte) return false;

  return tabela === cte
    || (tabela.length >= 5 && cte.includes(tabela))
    || (cte.length >= 5 && tabela.includes(cte));
}

function cidadeCompativel(cidadeTabela, cidadeCte) {
  const tabela = normalizeCompare(cidadeTabela);
  const cte = normalizeCompare(cidadeCte);

  if (!cte) return true;
  if (!tabela) return false;

  return tabela === cte
    || (tabela.length >= 5 && cte.includes(tabela))
    || (cte.length >= 5 && tabela.includes(cte));
}

function getTaxaDestino(origem, ibgeDestino) {
  const destino = onlyDigits(ibgeDestino).slice(0, 7);

  return (origem?.taxasEspeciais || []).find((item) => (
    onlyDigits(item.ibgeDestino).slice(0, 7) === destino
  )) || {};
}

function getCotacaoPorRota(origem, nomeRota, peso) {
  const rotaNorm = normalizeCompare(nomeRota);
  const pesoFinal = toNumber(peso);

  const cotacoes = (origem?.cotacoes || []).filter((item) => {
    const rotaCotacao = normalizeCompare(item.rota);
    const rotaOk = !rotaCotacao
      || rotaCotacao === rotaNorm
      || rotaCotacao.includes(rotaNorm)
      || rotaNorm.includes(rotaCotacao);

    if (!rotaOk) return false;

    const pesoMin = toNumber(item.pesoMin ?? item.peso_min ?? 0);
    const pesoMaxRaw = item.pesoMax ?? item.pesoLimite ?? item.peso_max ?? item.peso_limite;
    const pesoMax = pesoMaxRaw === '' || pesoMaxRaw === null || pesoMaxRaw === undefined
      ? Number.POSITIVE_INFINITY
      : toNumber(pesoMaxRaw);

    return pesoFinal >= pesoMin && pesoFinal <= (pesoMax || Number.POSITIVE_INFINITY);
  });

  if (!cotacoes.length) return null;

  return cotacoes.sort((a, b) => (
    toNumber(a.pesoMax ?? a.pesoLimite ?? a.peso_max ?? a.peso_limite)
    - toNumber(b.pesoMax ?? b.pesoLimite ?? b.peso_max ?? b.peso_limite)
  ))[0];
}

function getTipoCalculo(origem = {}, cotacao = {}) {
  const tipoCotacao = normalizeText(cotacao.tipoCalculo || cotacao.tipo_calculo);
  if (tipoCotacao.includes('FAIXA')) return 'FAIXA_DE_PESO';
  if (tipoCotacao.includes('PERCENT')) return 'PERCENTUAL';

  const tipoOrigem = normalizeText(origem.generalidades?.tipoCalculo || origem.generalidades?.tipo_calculo || 'PERCENTUAL');
  if (tipoOrigem.includes('FAIXA')) return 'FAIXA_DE_PESO';

  return 'PERCENTUAL';
}

function normalizarTransportadoras(transportadoras = []) {
  return (transportadoras || []).map((transportadora) => ({
    ...transportadora,
    __nomeNorm: normalizeCompare(transportadora.nome),
    origens: (transportadora.origens || []).map((origem) => ({
      ...origem,
      __cidadeNorm: normalizeCompare(origem.cidade),
      rotas: origem.rotas || [],
      cotacoes: origem.cotacoes || [],
      taxasEspeciais: origem.taxasEspeciais || [],
    })),
  }));
}

function localizarTransportadora(transportadoras = [], nomeCte = '') {
  const nomeNorm = normalizeCompare(nomeCte);
  if (!nomeNorm) return null;

  return transportadoras.find((item) => item.__nomeNorm === nomeNorm)
    || transportadoras.find((item) => nomeCompativel(item.nome, nomeCte))
    || null;
}

function localizarOrigem(transportadora, cte = {}) {
  const ibgeOrigem = onlyDigits(pick(cte, ['ibge_corrigido_origem', 'ibge_origem'])).slice(0, 7);
  const cidadeOrigem = pick(cte, ['cidade_origem', 'origem']);
  const canal = pick(cte, ['canal', 'canal_original']);

  const candidatas = (transportadora?.origens || []).filter((origem) => canalCompativel(origem.canal, canal));

  if (ibgeOrigem) {
    const porIbge = candidatas.find((origem) => (
      (origem.rotas || []).some((rota) => onlyDigits(rota.ibgeOrigem).slice(0, 7) === ibgeOrigem)
    ));
    if (porIbge) return porIbge;
  }

  return candidatas.find((origem) => cidadeCompativel(origem.cidade, cidadeOrigem))
    || candidatas[0]
    || null;
}

function localizarRota(origem, cte = {}) {
  const ibgeDestino = onlyDigits(pick(cte, ['ibge_corrigido_destino', 'ibge_destino'])).slice(0, 7);
  const ibgeOrigem = onlyDigits(pick(cte, ['ibge_corrigido_origem', 'ibge_origem'])).slice(0, 7);

  if (!ibgeDestino) return null;

  const rotasDestino = (origem?.rotas || []).filter((rota) => (
    onlyDigits(rota.ibgeDestino).slice(0, 7) === ibgeDestino
  ));

  if (!rotasDestino.length) return null;

  if (ibgeOrigem) {
    return rotasDestino.find((rota) => (
      !rota.ibgeOrigem || onlyDigits(rota.ibgeOrigem).slice(0, 7) === ibgeOrigem
    )) || rotasDestino[0];
  }

  return rotasDestino[0];
}

function montarResultadoBase(cte, status, motivo, extras = {}) {
  const valorCte = toNumber(pick(cte, ['valor_cte', 'valorCte', 'valor_frete', 'frete']));
  const valorNf = toNumber(pick(cte, ['valor_nf', 'valorNF', 'nf_venda', 'valor_nota']));

  return {
    competencia: String(pick(cte, ['competencia', 'mes_competencia']) || '').slice(0, 7),
    data_emissao: pick(cte, ['data_emissao', 'emissao', 'dataEmissao']) || null,
    chave_cte: pick(cte, ['chave_cte', 'chaveCte', 'chave']) || null,
    numero_cte: pick(cte, ['numero_cte', 'numeroCte', 'cte', 'nro_cte']) || null,
    transportadora: pick(cte, ['transportadora', 'nome_transportadora', 'transportadora_realizada', 'transportador']) || null,
    cnpj_transportadora: pick(cte, ['cnpj_transportadora', 'cnpjTransportadora']) || null,
    tomador_servico: pick(cte, ['tomador_servico', 'tomadorServico', 'tomador']) || null,
    cidade_origem: pick(cte, ['cidade_origem', 'cidadeOrigem', 'origem']) || null,
    uf_origem: String(pick(cte, ['uf_origem', 'ufOrigem']) || '').toUpperCase() || null,
    ibge_origem: onlyDigits(pick(cte, ['ibge_corrigido_origem', 'ibge_origem'])).slice(0, 7) || null,
    cidade_destino: pick(cte, ['cidade_destino', 'cidadeDestino', 'destino']) || null,
    uf_destino: String(pick(cte, ['uf_destino', 'ufDestino']) || '').toUpperCase() || null,
    ibge_destino: onlyDigits(pick(cte, ['ibge_corrigido_destino', 'ibge_destino'])).slice(0, 7) || null,
    canal: pick(cte, ['canal', 'canal_original']) || null,
    peso: toNumber(pick(cte, ['peso', 'peso_final', 'pesoFinal'])),
    peso_declarado: toNumber(pick(cte, ['peso_declarado', 'pesoDeclarado', 'peso'])),
    peso_cubado: toNumber(pick(cte, ['peso_cubado', 'pesoCubado'])),
    cubagem: toNumber(pick(cte, ['cubagem', 'cubagem_total', 'cubagemTotal'])),
    qtd_volumes: toNumber(pick(cte, ['qtd_volumes', 'qtdVolumes', 'volumes'])),
    valor_nf: valorNf,
    valor_cte: valorCte,
    valor_calculado: 0,
    diferenca: 0,
    diferenca_abs: 0,
    percentual_diferenca: 0,
    status_calculo: status,
    motivo_sem_calculo: motivo,
    transportadora_tabela: extras.transportadora_tabela || null,
    tipo_calculo: extras.tipo_calculo || null,
    detalhes_calculo: extras.detalhes_calculo || null,
  };
}

function processarCte(cte, transportadoras = []) {
  const transportadoraNome = pick(cte, ['transportadora', 'nome_transportadora', 'transportadora_realizada', 'transportador']);
  const transportadora = localizarTransportadora(transportadoras, transportadoraNome);

  if (!transportadora) {
    return montarResultadoBase(cte, 'SEM_TABELA', 'Transportadora não encontrada no cadastro de tabelas.');
  }

  const origem = localizarOrigem(transportadora, cte);
  if (!origem) {
    return montarResultadoBase(cte, 'SEM_ORIGEM', 'Origem/canal não encontrados para a transportadora.', {
      transportadora_tabela: transportadora.nome,
    });
  }

  const rota = localizarRota(origem, cte);
  if (!rota) {
    return montarResultadoBase(cte, 'SEM_ROTA', 'Rota de destino não encontrada para a origem da transportadora.', {
      transportadora_tabela: transportadora.nome,
    });
  }

  const pesoDeclarado = toNumber(pick(cte, ['peso_declarado', 'pesoDeclarado', 'peso']));
  const pesoCubado = toNumber(pick(cte, ['peso_cubado', 'pesoCubado']));
  const peso = Math.max(pesoDeclarado, pesoCubado, toNumber(pick(cte, ['peso'])));
  const valorNf = toNumber(pick(cte, ['valor_nf', 'valorNF', 'nf_venda', 'valor_nota']));
  const cotacao = getCotacaoPorRota(origem, rota.nomeRota, peso);

  if (!cotacao) {
    return montarResultadoBase(cte, 'SEM_FAIXA', 'Faixa/cotação não encontrada para a rota e peso do CT-e.', {
      transportadora_tabela: transportadora.nome,
    });
  }

  const tipoCalculo = getTipoCalculo(origem, cotacao);
  const taxaDestino = getTaxaDestino(origem, rota.ibgeDestino);
  const generalidades = origem.generalidades || {};

  try {
    const calculo = tipoCalculo === 'FAIXA_DE_PESO'
      ? calcularFreteFaixaPeso({ rota, cotacao, generalidades, taxaDestino, pesoKg: peso, valorNf })
      : calcularFretePercentual({ rota, cotacao, generalidades, taxaDestino, pesoKg: peso, valorNf });

    const base = montarResultadoBase(cte, 'CALCULADO', '', {
      transportadora_tabela: transportadora.nome,
      tipo_calculo: tipoCalculo,
      detalhes_calculo: {
        origem_id: origem.id || null,
        origem_cidade: origem.cidade || null,
        rota_id: rota.id || null,
        rota_nome: rota.nomeRota || null,
        cotacao_id: cotacao.id || null,
        peso_considerado: peso,
        valor_base: calculo.valorBase,
        subtotal: calculo.subtotal,
        icms: calculo.icms,
        taxas: calculo.taxas,
        componentes_base: calculo.componentesBase,
        componente_base: calculo.componenteBase,
      },
    });

    const valorCalculado = toNumber(calculo.total);
    const diferenca = base.valor_cte - valorCalculado;
    const diferencaAbs = Math.abs(diferenca);
    const percentualDiferenca = valorCalculado > 0 ? (diferenca / valorCalculado) * 100 : 0;

    return {
      ...base,
      valor_calculado: valorCalculado,
      diferenca,
      diferenca_abs: diferencaAbs,
      percentual_diferenca: percentualDiferenca,
      motivo_sem_calculo: '',
    };
  } catch (error) {
    return montarResultadoBase(cte, 'ERRO_CALCULO', error.message || 'Erro ao calcular frete.', {
      transportadora_tabela: transportadora.nome,
      tipo_calculo: tipoCalculo,
    });
  }
}

async function buscarCtesMesBruto({ supabase, competencia, onProgress }) {
  const datas = competenciaParaDatas(competencia);
  if (!datas) throw new Error('Competência inválida. Use o formato YYYY-MM.');

  const carregarPorFiltro = async (modo) => {
    const acumulado = [];
    let from = 0;

    while (true) {
      let query = supabase
        .from(TABELA_CTES)
        .select('*')
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (modo === 'data') {
        query = query.gte('data_emissao', datas.inicio).lte('data_emissao', datas.fim);
      } else {
        query = query.eq('competencia', competencia);
      }

      const { data, error } = await query;
      if (error) throw new Error(`Erro ao buscar CT-es por ${modo}: ${error.message}`);

      const lote = data || [];
      acumulado.push(...lote);
      onProgress?.({ etapa: `carregando_ctes_${modo}`, carregados: acumulado.length, total: null });

      if (lote.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    return acumulado;
  };

  const porData = await carregarPorFiltro('data');
  if (porData.length > 0) return porData;

  return carregarPorFiltro('competencia');
}

function calcularResumo(registros = [], competencia = '') {
  const total = registros.length;
  const calculados = registros.filter((row) => toNumber(row.valor_calculado) > 0).length;
  const semCalculo = total - calculados;
  const divergentes = registros.filter((row) => (
    toNumber(row.valor_calculado) > 0 && Math.abs(toNumber(row.diferenca)) > LIMITE_DIVERGENCIA_ASSERTIVO
  )).length;
  const assertivos = calculados - divergentes;
  const valorTotalCte = registros.reduce((acc, row) => acc + toNumber(row.valor_cte), 0);
  const valorTotalCalculado = registros.reduce((acc, row) => acc + toNumber(row.valor_calculado), 0);
  const valorTotalDivergencia = registros.reduce((acc, row) => acc + Math.abs(toNumber(row.diferenca)), 0);
  const valorExcessivo = registros.reduce((acc, row) => acc + Math.max(toNumber(row.diferenca), 0), 0);
  const valorInsuficiente = registros.reduce((acc, row) => acc + Math.abs(Math.min(toNumber(row.diferenca), 0)), 0);

  return {
    competencia,
    total_ctes: total,
    calculados,
    sem_calculo: semCalculo,
    assertivos,
    divergentes,
    valor_total_cte: valorTotalCte,
    valor_total_calculado: valorTotalCalculado,
    valor_total_divergencia: valorTotalDivergencia,
    valor_excessivo: valorExcessivo,
    valor_insuficiente: valorInsuficiente,
    taxa_calculo: total > 0 ? (calculados / total) * 100 : 0,
    taxa_assertividade: calculados > 0 ? (assertivos / calculados) * 100 : 0,
    taxa_divergencia: calculados > 0 ? (divergentes / calculados) * 100 : 0,
    processado_em: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function salvarResultadosMes({ supabase, competencia, registros, resumo, onProgress }) {
  const { error: deleteError } = await supabase
    .from(TABELA_RESULTADOS)
    .delete()
    .eq('competencia', competencia);

  if (deleteError) {
    throw new Error(`Erro ao limpar resultado anterior: ${deleteError.message}`);
  }

  for (let index = 0; index < registros.length; index += INSERT_CHUNK) {
    const chunk = registros.slice(index, index + INSERT_CHUNK);
    const { error } = await supabase.from(TABELA_RESULTADOS).insert(chunk);

    if (error) {
      throw new Error(`Erro ao salvar resultados da auditoria: ${error.message}`);
    }

    onProgress?.({
      etapa: 'salvando_resultados',
      carregados: Math.min(index + INSERT_CHUNK, registros.length),
      total: registros.length,
    });
  }

  const { error: resumoError } = await supabase
    .from(TABELA_RESUMO)
    .upsert(resumo, { onConflict: 'competencia' });

  if (resumoError) {
    throw new Error(`Erro ao salvar resumo mensal: ${resumoError.message}`);
  }
}

export async function carregarResultadosAuditoriaMes({ competencia, onProgress } = {}) {
  if (!competencia) throw new Error('Informe a competência para carregar o resultado salvo.');

  const supabase = ensureSupabase();
  const acumulado = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from(TABELA_RESULTADOS)
      .select('*')
      .eq('competencia', competencia)
      .order('data_emissao', { ascending: true, nullsFirst: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Erro ao carregar auditoria salva: ${error.message}`);

    const lote = data || [];
    acumulado.push(...lote);
    onProgress?.({ etapa: 'carregando_resultado_salvo', carregados: acumulado.length, total: null });

    if (lote.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return acumulado;
}

export async function carregarResumoAuditoriaMensal() {
  const supabase = ensureSupabase();

  const { data, error } = await supabase
    .from(TABELA_RESUMO)
    .select('*')
    .order('competencia', { ascending: true });

  if (error) throw new Error(`Erro ao carregar resumo mensal: ${error.message}`);

  return data || [];
}

export async function processarESalvarAuditoriaMes({ competencia, onProgress } = {}) {
  if (!competencia) throw new Error('Informe a competência para processar a auditoria.');

  const supabase = ensureSupabase();

  onProgress?.({ etapa: 'carregando_tabelas', carregados: 0, total: null });
  const transportadoras = normalizarTransportadoras(await carregarBaseCompletaDb());

  if (!transportadoras.length) {
    throw new Error('Nenhuma tabela de frete cadastrada foi encontrada para processar a auditoria.');
  }

  const ctes = await buscarCtesMesBruto({ supabase, competencia, onProgress });

  if (!ctes.length) {
    throw new Error(`Nenhum CT-e encontrado para a competência ${competencia}.`);
  }

  const registros = [];

  for (let index = 0; index < ctes.length; index += 1) {
    registros.push(processarCte(ctes[index], transportadoras));

    if (index % 500 === 0 || index === ctes.length - 1) {
      onProgress?.({ etapa: 'processando_ctes', carregados: index + 1, total: ctes.length });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const resumo = calcularResumo(registros, competencia);
  await salvarResultadosMes({ supabase, competencia, registros, resumo, onProgress });

  onProgress?.({ etapa: 'concluido', carregados: registros.length, total: registros.length });

  return {
    registros,
    resumo,
    fonte: {
      id: TABELA_RESULTADOS,
      tabela: TABELA_RESULTADOS,
      label: 'Auditoria processada / auditoria_cte_resultados',
    },
  };
}
