import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient.js';
import { carregarBaseCompletaDb, carregarBaseFiltradaPorCidadesOrigemDb, carregarBaseFiltradaPorDestinosDb, carregarMunicipiosIbgeDb } from './freteDatabaseService.js';
import { montarMapasIbge, resolverIbgeLocal } from '../utils/realizadoLocalEngine.js';

// Layout do relatorio "OrderSnapshotAnalytics": CSV ";", BOM UTF-8, primeira linha "sep=;",
// numeros em formato pt-BR (virgula decimal, sem separador de milhar).
const COLUNAS = [
  ['Pedido', 'pedido', 'texto'],
  ['Canal', 'canal', 'texto'],
  ['Loja', 'loja', 'texto'],
  ['Modelo de Negocio (Cluster)', 'modelo_negocio', 'texto'],
  ['UF', 'uf', 'texto'],
  ['Cidade', 'cidade', 'texto'],
  ['Data de Criacao', 'data_criacao', 'data'],
  ['Data de Pagamento', 'data_pagamento', 'data'],
  ['Data de Cancelamento', 'data_cancelamento', 'data'],
  ['Atividade Pos-Cancelamento?', 'atividade_pos_cancelamento', 'bool'],
  ['Faturado Pos-Cancelamento?', 'faturado_pos_cancelamento', 'bool'],
  ['Transportado Pos-Cancelamento?', 'transportado_pos_cancelamento', 'bool'],
  ['Entregue Pos-Cancelamento?', 'entregue_pos_cancelamento', 'bool'],
  ['Prazo de Entrega', 'prazo_entrega', 'data'],
  ['Prazo (dias corridos)', 'prazo_dias_corridos', 'numero'],
  ['Status da Entrega', 'status_entrega', 'texto'],
  ['Data da Entrega', 'data_entrega', 'data'],
  ['Entregue fora do prazo?', 'entregue_fora_prazo', 'bool'],
  ['Status da Devolucao', 'status_devolucao', 'texto'],
  ['Data da Devolucao', 'data_devolucao', 'data'],
  ['Valor Devolvido', 'valor_devolvido', 'numero'],
  ['Tempo de Embarque', 'tempo_embarque', 'numero'],
  ['Tempo de Faturamento', 'tempo_faturamento', 'numero'],
  ['Valor do Pedido', 'valor_pedido', 'numero'],
  ['Frete Cobrado', 'frete_cobrado', 'numero'],
  ['Frete Devido', 'frete_devido', 'numero'],
  ['Frete Tabela (Calculo)', 'frete_tabela', 'numero'],
  ['Desconto Campanha de Frete', 'desconto_campanha_frete', 'numero'],
  ['Adicional Tributario Frete', 'adicional_tributario_frete', 'numero'],
  ['Custo Frete Transportadora (CT-e)', 'custo_frete_transportadora', 'numero'],
  ['Status da Conciliacao do Frete', 'status_conciliacao_frete', 'texto'],
  ['Diferenca Tabela x CT-e (R$)', 'diferenca_tabela_cte', 'numero'],
  ['% Geral de Frete', 'percentual_geral_frete', 'numero'],
  ['Frete a Cobrar pelo Marketplace', 'frete_a_cobrar_marketplace', 'numero'],
  ['Valor Faturado', 'valor_faturado', 'numero'],
  ['Peso Cotado (kg)', 'peso_cotado', 'numero'],
  ['Peso Faturado (kg)', 'peso_faturado', 'numero'],
  ['Diferenca de Peso (kg)', 'diferenca_peso', 'numero'],
  ['Tem CT-e?', 'tem_cte', 'bool'],
  ['Tem CT-e Complementar?', 'tem_cte_complementar', 'bool'],
  ['Logistica pelo Marketplace?', 'logistica_marketplace', 'bool'],
  ['Pedido de Retira?', 'pedido_retira', 'bool'],
  ['Possui campanha de frete?', 'possui_campanha_frete', 'bool'],
  ['Contingencia Aplicada?', 'contingencia_aplicada', 'bool'],
  ['Status de Faturamento', 'status_faturamento', 'texto'],
  ['Itens Faturados Errados?', 'itens_faturados_errados', 'bool'],
  ['Valor Faturado Errado?', 'valor_faturado_errado', 'bool'],
  ['Nota Fiscal Duplicada?', 'nota_fiscal_duplicada', 'bool'],
  ['Divergencia de Origem?', 'divergencia_origem', 'bool'],
  ['Divergencia de Transportadora?', 'divergencia_transportadora', 'bool'],
  ['Anuncio nao Integrado?', 'anuncio_nao_integrado', 'bool'],
  ['Desconto do Anuncio (R$)', 'desconto_anuncio_valor', 'numero'],
  ['Desconto do Anuncio (%)', 'desconto_anuncio_percentual', 'numero'],
  ['Valor Adicional de Markup (R$)', 'valor_adicional_markup', 'numero'],
  ['Valor Frete Embutido no Anuncio (R$)', 'valor_frete_embutido_anuncio', 'numero'],
  ['Desconto acima do Limite?', 'desconto_acima_limite', 'bool'],
  ['Desvio Liberado?', 'desvio_liberado', 'bool'],
  ['Liberado Por', 'liberado_por', 'texto'],
  ['Data da Liberacao', 'data_liberacao', 'data'],
];

function detectarSeparadorCsv(primeiraLinha = '') {
  const candidatos = [';', ',', '\t'];
  return candidatos
    .map((sep) => ({ sep, count: primeiraLinha.split(sep).length }))
    .sort((a, b) => b.count - a.count)[0]?.sep || ';';
}

function parseCsvMatrix(texto = '') {
  const semBom = texto.replace(/^﻿/, '');
  const semDiretiva = semBom.replace(/^sep=.\r?\n/i, '');
  const sep = detectarSeparadorCsv(semDiretiva.split(/\r?\n/, 1)[0] || '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < semDiretiva.length; i += 1) {
    const char = semDiretiva[i];
    const next = semDiretiva[i + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && char === sep) {
      row.push(cell);
      cell = '';
      continue;
    }
    if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }
  row.push(cell);
  if (row.some((value) => String(value ?? '').trim() !== '')) rows.push(row);
  return rows;
}

function numeroBr(valor = '') {
  const texto = String(valor ?? '').trim();
  if (!texto) return null;
  const normalizado = texto.replace(/\./g, '').replace(',', '.');
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

function boolSimNao(valor = '') {
  const texto = String(valor ?? '').trim().toLowerCase();
  if (!texto) return null;
  if (texto === 'sim') return true;
  if (texto === 'nao' || texto === 'não') return false;
  return null;
}

function dataIso(valor = '') {
  const texto = String(valor ?? '').trim();
  if (!texto) return null;
  return texto.replace(' ', 'T');
}

export function parseOrderSnapshotCsv(texto = '') {
  const matriz = parseCsvMatrix(texto);
  if (!matriz.length) return [];
  const header = matriz[0].map((c) => String(c || '').trim());
  const indices = COLUNAS.map(([nomeCsv]) => header.indexOf(nomeCsv));

  const linhas = matriz.slice(1);
  return linhas.map((linha) => {
    const registro = {};
    const raw = {};
    COLUNAS.forEach(([nomeCsv, campo, tipo], idx) => {
      const posicao = indices[idx];
      const valorBruto = posicao >= 0 ? linha[posicao] : '';
      raw[nomeCsv] = valorBruto ?? '';
      if (tipo === 'numero') registro[campo] = numeroBr(valorBruto);
      else if (tipo === 'bool') registro[campo] = boolSimNao(valorBruto);
      else if (tipo === 'data') registro[campo] = dataIso(valorBruto);
      else registro[campo] = String(valorBruto ?? '').trim();
    });
    registro.raw = raw;
    return registro;
  }).filter((registro) => registro.pedido);
}

function chunks(lista = [], tamanho = 300) {
  const saida = [];
  for (let i = 0; i < lista.length; i += tamanho) saida.push(lista.slice(i, i + tamanho));
  return saida;
}

// Descobre quais numeros de Pedido do arquivo ja existem na base, pra poder
// informar no resumo pos-importacao quantos sao novos x atualizacao.
async function buscarPedidosExistentes(supabase, numerosPedido = []) {
  const existentes = new Set();
  for (const grupo of chunks(numerosPedido, 300)) {
    const { data, error } = await supabase
      .from('ecommerce_order_snapshot')
      .select('pedido')
      .in('pedido', grupo);
    if (error) throw error;
    (data || []).forEach((row) => existentes.add(row.pedido));
  }
  return existentes;
}

export async function importarEcommerceOrderSnapshot(registros = [], { onProgress } = {}) {
  if (!isSupabaseConfigured()) throw new Error('Supabase nao configurado.');
  const supabase = getSupabaseClient();

  onProgress?.({ etapa: 'verificando_existentes', carregados: 0, total: registros.length });
  const numerosPedido = registros.map((r) => r.pedido).filter(Boolean);
  const existentes = await buscarPedidosExistentes(supabase, numerosPedido);
  const novos = numerosPedido.filter((p) => !existentes.has(p)).length;
  const atualizados = numerosPedido.length - novos;

  const lotes = chunks(registros, 300);
  let enviados = 0;
  for (let i = 0; i < lotes.length; i += 1) {
    const lote = lotes[i];
    const { error } = await supabase
      .from('ecommerce_order_snapshot')
      .upsert(lote, { onConflict: 'pedido' });
    if (error) throw error;
    enviados += lote.length;
    if (onProgress) onProgress({ etapa: 'salvando_pedidos_ecommerce', carregados: enviados, total: registros.length, lote: i + 1, totalLotes: lotes.length, enviados });
  }
  return { total: registros.length, enviados, novos, atualizados };
}

export async function diagnosticarEcommerceOrderSnapshot(filtros = {}) {
  if (!isSupabaseConfigured()) return { configurado: false, total: 0 };
  const supabase = getSupabaseClient();
  const { count, error } = await aplicarFiltrosEcommerce(
    supabase.from('ecommerce_order_snapshot').select('id', { count: 'exact', head: true }),
    filtros
  );
  if (error) throw error;
  const { count: cruzados } = await aplicarFiltrosEcommerce(
    supabase.from('ecommerce_order_snapshot').select('id', { count: 'exact', head: true }).neq('cruzamento_status', 'pendente'),
    filtros
  );
  return { configurado: true, total: count || 0, cruzados: cruzados || 0 };
}

// Cruza pedidos ainda pendentes: pedido -> tracking_pedido_marketplace_map -> chave_cte -> realizado_local_ctes.chave_cte.
// tracking_rows.pedido e o pedido ERP interno (nao bate com o pedido do marketplace); o numero
// real do marketplace fica em raw->>'Pedido Marketplace', pre-extraido na tabela de mapeamento
// tracking_pedido_marketplace_map (ver migration 20260728_001) pra nao precisar mexer na tabela grande.
export async function cruzarEcommerceComTrackingECte({ limitePorLote = 500, totalAlvo = null, onProgress } = {}) {
  if (!isSupabaseConfigured()) throw new Error('Supabase nao configurado.');
  const supabase = getSupabaseClient();

  let totalProcessado = 0;
  let totalOk = 0;
  let totalSemTracking = 0;
  let totalSemCte = 0;

  for (;;) {
    const { data: pendentes, error: erroPendentes } = await supabase
      .from('ecommerce_order_snapshot')
      .select('id, pedido')
      .eq('cruzamento_status', 'pendente')
      .limit(limitePorLote);
    if (erroPendentes) throw erroPendentes;
    if (!pendentes || !pendentes.length) break;

    const pedidos = pendentes.map((p) => p.pedido);
    const mapaTracking = new Map();
    const pedidosFalhaInfra = new Set();
    for (const grupo of chunks(pedidos, 200)) {
      // pedido_marketplace agora e indexado (ver migration 20260728_001), entao isso deveria
      // ser rapido. Ainda assim, nao deixa um timeout pontual derrubar o lote inteiro: tenta
      // de novo em sub-chunks menores antes de desistir daquele pedaço.
      try {
        const { data: trackingRows, error: erroTracking } = await supabase
          .from('tracking_pedido_marketplace_map')
          .select('pedido_marketplace, chave_cte')
          .in('pedido_marketplace', grupo);
        if (erroTracking) throw erroTracking;
        (trackingRows || []).forEach((row) => {
          if (row.pedido_marketplace && row.chave_cte && !mapaTracking.has(row.pedido_marketplace)) {
            mapaTracking.set(row.pedido_marketplace, row.chave_cte);
          }
        });
      } catch {
        for (const subGrupo of chunks(grupo, 40)) {
          try {
            const { data: trackingRows } = await supabase
              .from('tracking_pedido_marketplace_map')
              .select('pedido_marketplace, chave_cte')
              .in('pedido_marketplace', subGrupo);
            (trackingRows || []).forEach((row) => {
              if (row.pedido_marketplace && row.chave_cte && !mapaTracking.has(row.pedido_marketplace)) {
                mapaTracking.set(row.pedido_marketplace, row.chave_cte);
              }
            });
          } catch {
            // Falha de infra (nao "nao encontrado"): nao marca como sem_tracking, deixa
            // pendente pra tentar de novo numa proxima rodada.
            subGrupo.forEach((pedido) => pedidosFalhaInfra.add(pedido));
          }
        }
      }
    }

    const chavesCte = [...new Set([...mapaTracking.values()].filter(Boolean))];
    const mapaCte = new Map();
    for (const grupo of chunks(chavesCte, 200)) {
      const { data: cteRows, error: erroCte } = await supabase
        .from('realizado_local_ctes')
        .select('chave_cte, numero_cte, transportadora, valor_cte, data_emissao, uf_origem, uf_destino, cidade_origem, cidade_destino, peso, cubagem')
        .in('chave_cte', grupo);
      if (erroCte) throw erroCte;
      (cteRows || []).forEach((row) => {
        if (row.chave_cte && !mapaCte.has(row.chave_cte)) mapaCte.set(row.chave_cte, row);
      });
    }

    const atualizacoes = pendentes.filter((pendente) => !pedidosFalhaInfra.has(pendente.pedido)).map((pendente) => {
      const chaveCte = mapaTracking.get(pendente.pedido) || null;
      const cte = chaveCte ? mapaCte.get(chaveCte) : null;
      let status = 'sem_tracking';
      if (chaveCte && !cte) status = 'sem_cte';
      if (chaveCte && cte) status = 'ok';

      if (status === 'sem_tracking') totalSemTracking += 1;
      else if (status === 'sem_cte') totalSemCte += 1;
      else if (status === 'ok') totalOk += 1;

      return {
        id: pendente.id,
        pedido: pendente.pedido,
        chave_cte: chaveCte,
        cte_encontrado: Boolean(cte),
        cte_transportadora: cte?.transportadora || null,
        cte_numero: cte?.numero_cte || null,
        cte_valor: cte?.valor_cte ?? null,
        cte_data_emissao: cte?.data_emissao || null,
        cte_uf_origem: cte?.uf_origem || null,
        cte_uf_destino: cte?.uf_destino || null,
        cte_cidade_origem: cte?.cidade_origem || null,
        cte_cidade_destino: cte?.cidade_destino || null,
        cte_peso: cte?.peso ?? null,
        cte_cubagem: cte?.cubagem ?? null,
        cruzamento_status: status,
        cruzado_em: new Date().toISOString(),
      };
    });

    for (const grupo of chunks(atualizacoes, 200)) {
      const { error: erroUpdate } = await supabase
        .from('ecommerce_order_snapshot')
        .upsert(grupo, { onConflict: 'id' });
      if (erroUpdate) throw erroUpdate;
    }

    totalProcessado += pendentes.length;
    if (onProgress) onProgress({ etapa: 'cruzando_tracking', carregados: totalProcessado, total: totalAlvo, totalProcessado, totalOk, totalSemTracking, totalSemCte });

    if (pendentes.length < limitePorLote) break;
  }

  return { totalProcessado, totalOk, totalSemTracking, totalSemCte };
}

export async function carregarMalhaB2cParaResimulacao({ onProgress, cdsPermitidos = [], destinosIbge = [] } = {}) {
  // Prioridade de escopo (do mais estreito pro mais amplo):
  // 1) destinosIbge: sabemos exatamente quais destinos os pedidos selecionados
  //    tem, entao buscamos so rotas que atendem esses destinos - o recorte mais
  //    rapido possivel, ideal pra testar poucos pedidos.
  // 2) cdsPermitidos: sem destino conhecido de antemao (ex: resimulacao em
  //    massa via filtros server-side), restringe so as origens desses CDs.
  // 3) sem nenhum dos dois: carrega a base completa (com cache) como antes.
  const [transportadoras, municipios] = await Promise.all([
    destinosIbge.length
      ? carregarBaseFiltradaPorDestinosDb(destinosIbge, cdsPermitidos, (evt) => onProgress?.(evt))
      : cdsPermitidos.length
        ? carregarBaseFiltradaPorCidadesOrigemDb(cdsPermitidos, (evt) => onProgress?.(evt))
        : carregarBaseCompletaDb((evt) => onProgress?.(evt)),
    carregarMunicipiosIbgeDb(),
  ]);
  return { transportadoras: transportadoras || [], municipios: municipios || [] };
}

// Aplica os filtros de analise (periodo, status de cruzamento, divergencia de
// peso, canal, uf, campanha) numa query do Supabase. Usado tanto pra listar a
// grade quanto pra contar/paginar o que sera resimulado, pra manter os dois
// coerentes com o que o usuario esta vendo na tela.
function aplicarFiltrosEcommerce(query, filtros = {}) {
  let q = query;
  if (filtros.dataInicio) q = q.gte('data_criacao', filtros.dataInicio);
  if (filtros.dataFim) q = q.lte('data_criacao', `${filtros.dataFim}T23:59:59`);
  if (filtros.cruzamentoStatus) q = q.eq('cruzamento_status', filtros.cruzamentoStatus);
  if (filtros.simStatus) q = q.eq('sim_status', filtros.simStatus);
  if (filtros.divergenciaPeso) q = q.neq('diferenca_peso', 0);
  if (filtros.canal) q = q.eq('canal', filtros.canal);
  if (filtros.uf) q = q.eq('uf', filtros.uf);
  if (filtros.possuiCampanha !== null && filtros.possuiCampanha !== undefined) {
    q = q.eq('possui_campanha_frete', filtros.possuiCampanha);
  }
  return q;
}

export async function listarOpcoesFiltroEcommerce() {
  if (!isSupabaseConfigured()) return { canais: [], ufs: [] };
  const supabase = getSupabaseClient();
  const [{ data: canaisData }, { data: ufsData }] = await Promise.all([
    supabase.from('ecommerce_order_snapshot').select('canal').not('canal', 'is', null).limit(5000),
    supabase.from('ecommerce_order_snapshot').select('uf').not('uf', 'is', null).limit(5000),
  ]);
  const canais = [...new Set((canaisData || []).map((r) => r.canal).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const ufs = [...new Set((ufsData || []).map((r) => r.uf).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return { canais, ufs };
}

// Conta quantos pedidos elegiveis (cruzamento ok, ainda pendentes de resimular)
// batem com os filtros de analise atuais, pra mostrar o resumo antes de rodar.
// Com refazerTudo, conta todos os elegiveis do filtro, mesmo os ja resimulados.
export async function contarElegiveisResimulacaoEcommerce(filtros = {}, { refazerTudo = false } = {}) {
  if (!isSupabaseConfigured()) return 0;
  const supabase = getSupabaseClient();
  let query = supabase
    .from('ecommerce_order_snapshot')
    .select('id', { count: 'exact', head: true })
    .eq('cruzamento_status', 'ok');
  if (!refazerTudo) query = query.eq('sim_status', 'pendente');
  query = aplicarFiltrosEcommerce(query, filtros);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

// Conta quantos pedidos do recorte ja foram resimulados antes (sim_status='ok'),
// pra mostrar no resumo "X ja feitos, Y pendentes" e o usuario decidir se quer
// continuar so com os que faltam ou refazer tudo de novo.
export async function contarJaResimuladosParaFiltro(filtros = {}) {
  if (!isSupabaseConfigured()) return 0;
  const supabase = getSupabaseClient();
  let query = supabase
    .from('ecommerce_order_snapshot')
    .select('id', { count: 'exact', head: true })
    .eq('cruzamento_status', 'ok')
    .eq('sim_status', 'ok');
  query = aplicarFiltrosEcommerce(query, filtros);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

export async function diagnosticarResimulacaoEcommerce(filtros = {}) {
  if (!isSupabaseConfigured()) return { configurado: false, elegiveis: 0, pendentes: 0, ok: 0 };
  const supabase = getSupabaseClient();
  const { count: elegiveis } = await aplicarFiltrosEcommerce(
    supabase.from('ecommerce_order_snapshot').select('id', { count: 'exact', head: true }).eq('cruzamento_status', 'ok'),
    filtros
  );
  const { count: pendentes } = await aplicarFiltrosEcommerce(
    supabase.from('ecommerce_order_snapshot').select('id', { count: 'exact', head: true }).eq('cruzamento_status', 'ok').eq('sim_status', 'pendente'),
    filtros
  );
  const { count: ok } = await aplicarFiltrosEcommerce(
    supabase.from('ecommerce_order_snapshot').select('id', { count: 'exact', head: true }).eq('sim_status', 'ok'),
    filtros
  );
  return { configurado: true, elegiveis: elegiveis || 0, pendentes: pendentes || 0, ok: ok || 0 };
}

async function buscarPaginaPendentesResimulacao(limit = 800, filtros = {}, refazerTudo = false) {
  const supabase = getSupabaseClient();
  let query = supabase
    .from('ecommerce_order_snapshot')
    .select('id, pedido, canal, uf, cidade, peso_cotado, peso_faturado, valor_pedido, valor_faturado, frete_tabela, custo_frete_transportadora, cte_valor, cte_transportadora, cte_uf_origem')
    .eq('cruzamento_status', 'ok');
  if (!refazerTudo) query = query.eq('sim_status', 'pendente');
  query = aplicarFiltrosEcommerce(query, filtros).limit(limit);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function salvarResultadosResimulacaoEcommerce(resultados = []) {
  if (!resultados.length) return;
  const supabase = getSupabaseClient();
  const agora = new Date().toISOString();
  const linhas = resultados.map((r) => ({ ...r, sim_resimulado_em: agora }));
  for (const grupo of chunks(linhas, 200)) {
    const { error } = await supabase.from('ecommerce_order_snapshot').upsert(grupo, { onConflict: 'id' });
    if (error) throw error;
  }
}

// Coleta as combinacoes distintas de cidade/uf entre os pedidos elegiveis que
// batem com os filtros, pra poder carregar so a malha desses destinos em vez
// da malha inteira - o volume de destinos costuma ser bem menor que o de
// pedidos (varios pedidos pra mesma cidade), entao isso reduz bastante o que
// precisa vir do banco, mesmo pra recortes maiores (ex: uma semana inteira).
async function obterDestinosIbgeParaFiltro(filtros = {}, refazerTudo = false) {
  const supabase = getSupabaseClient();
  const cidadesUf = new Set();
  let from = 0;
  for (;;) {
    let query = supabase
      .from('ecommerce_order_snapshot')
      .select('cidade, uf')
      .eq('cruzamento_status', 'ok');
    if (!refazerTudo) query = query.eq('sim_status', 'pendente');
    query = aplicarFiltrosEcommerce(query, filtros).range(from, from + 999);
    const { data, error } = await query;
    if (error) throw error;
    (data || []).forEach((r) => cidadesUf.add(`${String(r.cidade || '').trim()}|${String(r.uf || '').trim().toUpperCase()}`));
    if (!data || data.length < 1000) break;
    from += 1000;
  }

  if (!cidadesUf.size) return [];
  const municipios = await carregarMunicipiosIbgeDb();
  const mapasIbge = montarMapasIbge(municipios);
  return [...new Set(
    [...cidadesUf].map((par) => {
      const [cidade, uf] = par.split('|');
      return resolverIbgeLocal(cidade, uf, mapasIbge);
    }).filter(Boolean)
  )];
}

// Junta todos os ids do recorte (sem paginar por sim_status, que nao "esvazia"
// sozinho quando refazerTudo esta ligado - sim_status continua 'ok' antes e
// depois de reprocessar). Usado so no modo refazerTudo.
async function coletarIdsParaFiltro(filtros = {}) {
  const supabase = getSupabaseClient();
  const ids = [];
  let from = 0;
  for (;;) {
    let query = supabase
      .from('ecommerce_order_snapshot')
      .select('id')
      .eq('cruzamento_status', 'ok');
    query = aplicarFiltrosEcommerce(query, filtros).range(from, from + 999);
    const { data, error } = await query;
    if (error) throw error;
    ids.push(...(data || []).map((r) => r.id));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return ids;
}

async function buscarPedidosPorIds(ids = []) {
  if (!ids.length) return [];
  const supabase = getSupabaseClient();
  const pedidos = [];
  for (const grupo of chunks(ids, 200)) {
    const { data, error } = await supabase
      .from('ecommerce_order_snapshot')
      .select('id, pedido, canal, uf, cidade, peso_cotado, peso_faturado, valor_pedido, valor_faturado, frete_tabela, custo_frete_transportadora, cte_valor, cte_transportadora, cte_uf_origem')
      .in('id', grupo);
    if (error) throw error;
    pedidos.push(...(data || []));
  }
  return pedidos;
}

// Orquestra a resimulacao em lotes: mantem um worker vivo (malha B2C carregada 1x),
// pagina pedidos pendentes do Supabase e vai salvando resultado lote a lote. Pensado
// para volumes grandes (dezenas de milhares de pedidos) sem travar a aba nem estourar
// timeout de request.
export async function resimularEcommerceEmLotes({ criterioB2c, pesoBase = 'cotado', cdsPermitidos = [], tamanhoLote = 800, totalAlvo = null, filtros = {}, refazerTudo = false, onProgress } = {}) {
  if (!isSupabaseConfigured()) throw new Error('Supabase nao configurado.');

  onProgress?.({ etapa: 'carregando_tabelas_completas_fallback', carregados: 0, total: null });
  const destinosIbge = await obterDestinosIbgeParaFiltro(filtros, refazerTudo);
  const { transportadoras, municipios } = await carregarMalhaB2cParaResimulacao({ onProgress, cdsPermitidos, destinosIbge });

  // Refazendo tudo, a paginacao por sim_status='pendente' nao se auto-esvazia
  // (status ja e/continua 'ok'), entao junta os ids do recorte de uma vez e
  // pagina sobre essa lista fixa em vez de re-consultar por status.
  const idsFixos = refazerTudo ? await coletarIdsParaFiltro(filtros) : null;

  const worker = new Worker(new URL('../workers/ecommerceResimulacaoWorker.js', import.meta.url), { type: 'module' });

  const aguardarMensagem = (tipoEsperado) => new Promise((resolve, reject) => {
    const handler = (event) => {
      const msg = event.data || {};
      if (msg.type === 'error') {
        worker.removeEventListener('message', handler);
        console.error('[resimulacao ecommerce] erro no worker:', msg.message, msg.stack);
        reject(new Error(msg.message || 'Erro desconhecido no worker de resimulacao.'));
      } else if (msg.type === tipoEsperado) {
        worker.removeEventListener('message', handler);
        resolve(msg);
      }
    };
    worker.addEventListener('message', handler);
  });

  try {
    worker.postMessage({ type: 'init-malha-ecommerce', transportadoras, municipios });
    await aguardarMensagem('malha-pronta');

    let totalProcessado = 0;
    let totalOk = 0;

    const idsEmLotes = idsFixos ? chunks(idsFixos, tamanhoLote) : null;
    let indiceLoteFixo = 0;

    for (;;) {
      const pagina = idsEmLotes
        ? await buscarPedidosPorIds(idsEmLotes[indiceLoteFixo++] || [])
        : await buscarPaginaPendentesResimulacao(tamanhoLote, filtros, false);
      const fimDosLotesFixos = idsEmLotes && indiceLoteFixo >= idsEmLotes.length;
      if (!pagina.length) {
        if (fimDosLotesFixos || !idsEmLotes) break;
        continue;
      }

      onProgress?.({ etapa: 'resimulando', carregados: totalProcessado, total: totalAlvo, totalProcessado });

      worker.postMessage({ type: 'resimular-lote-ecommerce', pedidos: pagina, criterioB2c, pesoBase, cdsPermitidos });
      const { resultados } = await aguardarMensagem('done');

      const mapaPedidos = new Map(pagina.map((p) => [p.id, p.pedido]));
      const resultadosComPedido = resultados.map((r) => ({ ...r, pedido: mapaPedidos.get(r.id) }));
      await salvarResultadosResimulacaoEcommerce(resultadosComPedido);

      totalProcessado += pagina.length;
      totalOk += resultados.filter((r) => r.sim_status === 'ok').length;
      onProgress?.({ etapa: 'salvando_resultados', carregados: totalProcessado, total: totalAlvo, totalProcessado, totalOk });

      if (idsEmLotes ? fimDosLotesFixos : pagina.length < tamanhoLote) break;
    }

    return { totalProcessado, totalOk };
  } finally {
    worker.terminate();
  }
}

// Resimula exatamente os pedidos passados por id (ex: o que esta visivel na
// grade depois dos filtros por coluna), em vez de paginar tudo que bate com
// os filtros de analise no banco. Util pra testar um recorte pontual.
export async function resimularEcommercePorIds({ ids = [], criterioB2c, pesoBase = 'cotado', cdsPermitidos = [], onProgress } = {}) {
  if (!isSupabaseConfigured()) throw new Error('Supabase nao configurado.');
  if (!ids.length) return { totalProcessado: 0, totalOk: 0 };

  // Busca os pedidos ANTES da malha pra saber exatamente quais destinos
  // precisamos - com um recorte pequeno (esse botao resimula so o que esta
  // visivel/filtrado), isso reduz drasticamente o que precisa ser carregado
  // do banco em vez de sempre buscar a malha inteira.
  const supabase = getSupabaseClient();
  const pedidos = [];
  for (const grupo of chunks(ids, 200)) {
    const { data, error } = await supabase
      .from('ecommerce_order_snapshot')
      .select('id, pedido, canal, uf, cidade, peso_cotado, peso_faturado, valor_pedido, valor_faturado, frete_tabela, custo_frete_transportadora, cte_valor, cte_transportadora, cte_uf_origem')
      .eq('cruzamento_status', 'ok')
      .in('id', grupo);
    if (error) throw error;
    pedidos.push(...(data || []));
  }
  if (!pedidos.length) return { totalProcessado: 0, totalOk: 0 };

  onProgress?.({ etapa: 'carregando_tabelas_completas_fallback', carregados: 0, total: null });
  const municipiosParaDestino = await carregarMunicipiosIbgeDb();
  const mapasIbgeDestino = montarMapasIbge(municipiosParaDestino);
  const destinosIbge = [...new Set(
    pedidos.map((p) => resolverIbgeLocal(p.cidade, p.uf, mapasIbgeDestino)).filter(Boolean)
  )];

  const { transportadoras, municipios } = await carregarMalhaB2cParaResimulacao({ onProgress, cdsPermitidos, destinosIbge });

  const worker = new Worker(new URL('../workers/ecommerceResimulacaoWorker.js', import.meta.url), { type: 'module' });
  const aguardarMensagem = (tipoEsperado) => new Promise((resolve, reject) => {
    const handler = (event) => {
      const msg = event.data || {};
      if (msg.type === 'error') {
        worker.removeEventListener('message', handler);
        console.error('[resimulacao ecommerce] erro no worker:', msg.message, msg.stack);
        reject(new Error(msg.message || 'Erro desconhecido no worker de resimulacao.'));
      } else if (msg.type === tipoEsperado) {
        worker.removeEventListener('message', handler);
        resolve(msg);
      }
    };
    worker.addEventListener('message', handler);
  });

  try {
    worker.postMessage({ type: 'init-malha-ecommerce', transportadoras, municipios });
    await aguardarMensagem('malha-pronta');

    let totalProcessado = 0;
    let totalOk = 0;
    for (const lote of chunks(pedidos, 800)) {
      onProgress?.({ etapa: 'resimulando', carregados: totalProcessado, total: pedidos.length, totalProcessado });
      worker.postMessage({ type: 'resimular-lote-ecommerce', pedidos: lote, criterioB2c, pesoBase, cdsPermitidos });
      const { resultados } = await aguardarMensagem('done');

      const mapaPedidos = new Map(lote.map((p) => [p.id, p.pedido]));
      const resultadosComPedido = resultados.map((r) => ({ ...r, pedido: mapaPedidos.get(r.id) }));
      await salvarResultadosResimulacaoEcommerce(resultadosComPedido);

      totalProcessado += lote.length;
      totalOk += resultados.filter((r) => r.sim_status === 'ok').length;
      onProgress?.({ etapa: 'salvando_resultados', carregados: totalProcessado, total: pedidos.length, totalProcessado, totalOk });
    }

    return { totalProcessado, totalOk };
  } finally {
    worker.terminate();
  }
}

export async function listarEcommerceOrderSnapshot({ limit = 500, filtros = {} } = {}) {
  if (!isSupabaseConfigured()) return { rows: [] };
  const supabase = getSupabaseClient();
  let query = supabase.from('ecommerce_order_snapshot').select('*');
  query = aplicarFiltrosEcommerce(query, filtros)
    .order('data_criacao', { ascending: false })
    .limit(limit);
  const { data, error } = await query;
  if (error) throw error;
  return { rows: data || [] };
}
