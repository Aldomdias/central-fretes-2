import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient.js';
import { carregarBaseCompletaDb, carregarBaseFiltradaPorCidadesOrigemDb, carregarBaseFiltradaPorDestinosDb, carregarBaseFiltradaPorOrigemEDestinosDb, carregarMunicipiosIbgeDb } from './freteDatabaseService.js';
import { montarMapasIbge, resolverIbgeLocal, categoriaCanalRealizado } from '../utils/realizadoLocalEngine.js';
import { carregarVinculosTransportadoras, criarMapaVinculosTransportadoras } from './vinculosTransportadorasService.js';
import { construirIndiceResimulacaoEcommerce, calcularCandidatosOrigemEcommerce, calcularResultadoFinalEcommerce } from '../utils/ecommerceResimulacaoEngine.js';
import { calcularImpactoCampanhaNaEscolha, deduplicarCandidatosEcommerce, isTransportadoraEbazarEcommerce, normalizarNomeCidade } from '../utils/ecommerceAuditoriaPuro.js';

export { deduplicarCandidatosEcommerce, isTransportadoraEbazarEcommerce, normalizarNomeCidade } from '../utils/ecommerceAuditoriaPuro.js';

// Normaliza nome de cidade (maiusculo, sem acento) - o cadastro cd_centros tem a mesma
// cidade grafada de jeitos diferentes em codigos diferentes (ex: "SERRA" e "Serra",
// "ITAJAÍ" e "Itajaí"). Sem normalizar, cada grafia virava uma "origem" separada na
// resimulacao por origem, processando a mesma cidade mais de uma vez e duplicando
// candidatos pro mesmo pedido (mesma transportadora/CD/faixa de peso repetida).
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
  ['Peso Cubado Cotado (kg)', 'peso_cubado_cotado', 'numero'],
  ['Peso Cubado Faturado (kg)', 'peso_cubado_faturado', 'numero'],
  ['Diferenca de Peso Cubado (kg)', 'diferenca_peso_cubado', 'numero'],
  ['Peso Real Cotado (kg)', 'peso_real_cotado', 'numero'],
  ['Peso Real Faturado (kg)', 'peso_real_faturado', 'numero'],
  ['Diferenca de Peso Real (kg)', 'diferenca_peso_real', 'numero'],
  ['Cubagem Cotada (m3)', 'cubagem_cotada', 'numero'],
  ['Tem CT-e?', 'tem_cte', 'bool'],
  ['Tem CT-e Complementar?', 'tem_cte_complementar', 'bool'],
  ['CDs com Saldo na Venda', 'cds_com_saldo_venda', 'texto'],
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
    // O layout novo (ago/2026) desmembrou o peso antigo em cubado e real.
    // Os campos legados continuam preenchidos apenas para compatibilidade de
    // leitura; o motor novo usa peso_real_* e calcula a cubagem por candidato.
    if (registro.peso_cotado == null) registro.peso_cotado = registro.peso_cubado_cotado;
    if (registro.peso_faturado == null) registro.peso_faturado = registro.peso_cubado_faturado;
    if (registro.diferenca_peso == null) registro.diferenca_peso = registro.diferenca_peso_cubado;
    // Uma nova importacao pode alterar os pesos que dirigem o calculo. Invalida
    // os dois cenarios para impedir que um resultado antigo seja reaproveitado.
    registro.sim_resultado_cotado = null;
    registro.sim_resultado_faturado = null;
    registro.sim_status = 'pendente';
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

export async function carregarMalhaB2cParaResimulacao({ onProgress, cdsPermitidos = [], destinosIbge = [], transportadorasExcluidas = [] } = {}) {
  // Prioridade de escopo (do mais estreito pro mais amplo):
  // 1) destinosIbge: sabemos exatamente quais destinos os pedidos selecionados
  //    tem, entao buscamos so rotas que atendem esses destinos - o recorte mais
  //    rapido possivel, ideal pra testar poucos pedidos.
  // 2) cdsPermitidos: sem destino conhecido de antemao (ex: resimulacao em
  //    massa via filtros server-side), restringe so as origens desses CDs.
  // 3) sem nenhum dos dois: carrega a base completa (com cache) como antes.
  const [transportadoras, municipios, vinculos] = await Promise.all([
    destinosIbge.length
      ? carregarBaseFiltradaPorDestinosDb(destinosIbge, cdsPermitidos, (evt) => onProgress?.(evt))
      : cdsPermitidos.length
        ? carregarBaseFiltradaPorCidadesOrigemDb(cdsPermitidos, (evt) => onProgress?.(evt))
        : carregarBaseCompletaDb((evt) => onProgress?.(evt)),
    carregarMunicipiosIbgeDb(),
    carregarVinculosTransportadoras(),
  ]);
  const mapaVinculos = criarMapaVinculosTransportadoras(vinculos || []);
  const excluidas = new Set((transportadorasExcluidas || []).map((nome) => String(nome || '').trim().toUpperCase()));
  return {
    transportadoras: (transportadoras || [])
      .filter((item) => !isTransportadoraEbazarEcommerce(item?.nome))
      .filter((item) => !excluidas.has(String(item?.nome || '').trim().toUpperCase())),
    municipios: municipios || [],
    vinculosTransportadoras: [...mapaVinculos.entries()],
  };
}

// Aplica os filtros de analise (periodo, status de cruzamento, divergencia de
// peso, canal, uf, campanha) numa query do Supabase. Usado tanto pra listar a
// grade quanto pra contar/paginar o que sera resimulado, pra manter os dois
// coerentes com o que o usuario esta vendo na tela.
function aplicarFiltrosEcommerce(query, filtros = {}) {
  let q = query.or('cte_transportadora.is.null,cte_transportadora.not.ilike.%EBAZAR%');
  if (filtros.dataInicio) q = q.gte('data_criacao', filtros.dataInicio);
  if (filtros.dataFim) q = q.lte('data_criacao', `${filtros.dataFim}T23:59:59`);
  if (filtros.cruzamentoStatus) q = q.eq('cruzamento_status', filtros.cruzamentoStatus);
  if (filtros.simStatus) q = q.eq('sim_status', filtros.simStatus);
  if (filtros.divergenciaPeso) q = q.neq('diferenca_peso', 0);
  if (filtros.canal) q = q.eq('canal', filtros.canal);
  if (filtros.uf) q = q.eq('uf', filtros.uf);
  if (filtros.cteTransportadora) q = q.ilike('cte_transportadora', `%${filtros.cteTransportadora}%`);
  if (filtros.possuiCampanha !== null && filtros.possuiCampanha !== undefined) {
    q = q.eq('possui_campanha_frete', filtros.possuiCampanha);
  }
  // cds_com_saldo_venda guarda uma lista de codigos de CD separados por virgula (texto livre,
  // ver cd_centros); filtrar por cidade do CD vira um "contem algum desses codigos" via OR de ilike.
  if (filtros.cdCodigos && filtros.cdCodigos.length) {
    q = q.or(filtros.cdCodigos.map((codigo) => `cds_com_saldo_venda.ilike.%${codigo}%`).join(','));
  }
  return q;
}

// sim_status e um campo unico compartilhado entre os dois cenarios de peso - roda
// cotado, ele vira 'ok', e a rodada de faturado (que checa sim_status='pendente')
// nao encontra mais nenhum pedido pra processar, mesmo sem ter calculado faturado
// ainda. Os resultados de cada cenario, porem, ja ficam guardados em colunas
// separadas (sim_resultado_cotado/sim_resultado_faturado) - entao "pendente pra
// esse cenario" e simplesmente essa coluna especifica ainda estar vazia.
function aplicarFiltroPendenteCenario(query, pesoBase = 'cotado') {
  if (pesoBase === 'ambos') {
    return query.or('sim_resultado_cotado.is.null,sim_resultado_faturado.is.null');
  }
  const coluna = pesoBase === 'faturado' ? 'sim_resultado_faturado' : 'sim_resultado_cotado';
  return query.is(coluna, null);
}

function aplicarFiltroJaFeitoCenario(query, pesoBase = 'cotado') {
  if (pesoBase === 'ambos') {
    return query.not('sim_resultado_cotado', 'is', null).not('sim_resultado_faturado', 'is', null);
  }
  const coluna = pesoBase === 'faturado' ? 'sim_resultado_faturado' : 'sim_resultado_cotado';
  return query.not(coluna, 'is', null);
}

// Cadastro de referencia codigo do Centro/CD -> cidade (tabela cd_centros), usado para
// exibir e filtrar a coluna 'CDs com Saldo na Venda' por cidade em vez de codigo cru.
export async function carregarMapaCdCentros() {
  if (!isSupabaseConfigured()) return { mapa: new Map(), cidades: [] };
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('cd_centros').select('codigo, cidade').limit(5000);
  if (error) throw error;
  const mapa = new Map((data || []).map((row) => [row.codigo, row.cidade]));
  const cidades = [...new Set((data || []).map((row) => row.cidade).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return { mapa, cidades };
}

export async function listarOpcoesFiltroEcommerce() {
  if (!isSupabaseConfigured()) return { canais: [], ufs: [], transportadorasCte: [] };
  const supabase = getSupabaseClient();
  const [{ data: canaisData }, { data: ufsData }, { data: transportadorasData }] = await Promise.all([
    supabase.from('ecommerce_order_snapshot').select('canal').not('canal', 'is', null).limit(5000),
    supabase.from('ecommerce_order_snapshot').select('uf').not('uf', 'is', null).limit(5000),
    supabase.from('ecommerce_order_snapshot').select('cte_transportadora').not('cte_transportadora', 'is', null).limit(5000),
  ]);
  const canais = [...new Set((canaisData || []).map((r) => r.canal).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const ufs = [...new Set((ufsData || []).map((r) => r.uf).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const transportadorasCte = [...new Set((transportadorasData || []).map((r) => r.cte_transportadora).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return { canais, ufs, transportadorasCte };
}

// Conta quantos pedidos elegiveis (cruzamento ok, ainda pendentes de resimular)
// batem com os filtros de analise atuais, pra mostrar o resumo antes de rodar.
// Com refazerTudo, conta todos os elegiveis do filtro, mesmo os ja resimulados.
export async function contarElegiveisResimulacaoEcommerce(filtros = {}, { refazerTudo = false, incluirSemCruzamento = false, pesoBase = 'cotado' } = {}) {
  if (!isSupabaseConfigured()) return 0;
  const supabase = getSupabaseClient();
  let query = supabase
    .from('ecommerce_order_snapshot')
    .select('id', { count: 'exact', head: true });
  if (!incluirSemCruzamento) query = query.eq('cruzamento_status', 'ok');
  if (!refazerTudo) query = aplicarFiltroPendenteCenario(query, pesoBase);
  query = aplicarFiltrosEcommerce(query, filtros);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

// Conta quantos pedidos do recorte ja foram resimulados antes NESSE cenario de peso,
// pra mostrar no resumo "X ja feitos, Y pendentes" e o usuario decidir se quer
// continuar so com os que faltam ou refazer tudo de novo.
export async function contarJaResimuladosParaFiltro(filtros = {}, { incluirSemCruzamento = false, pesoBase = 'cotado' } = {}) {
  if (!isSupabaseConfigured()) return 0;
  const supabase = getSupabaseClient();
  let query = supabase
    .from('ecommerce_order_snapshot')
    .select('id', { count: 'exact', head: true });
  query = aplicarFiltroJaFeitoCenario(query, pesoBase);
  if (!incluirSemCruzamento) query = query.eq('cruzamento_status', 'ok');
  query = aplicarFiltrosEcommerce(query, filtros);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

export async function diagnosticarResimulacaoEcommerce(filtros = {}, { incluirSemCruzamento = false, pesoBase = 'cotado' } = {}) {
  if (!isSupabaseConfigured()) return { configurado: false, elegiveis: 0, pendentes: 0, ok: 0 };
  const supabase = getSupabaseClient();
  let queryElegiveis = supabase.from('ecommerce_order_snapshot').select('id', { count: 'exact', head: true });
  let queryPendentes = aplicarFiltroPendenteCenario(supabase.from('ecommerce_order_snapshot').select('id', { count: 'exact', head: true }), pesoBase);
  if (!incluirSemCruzamento) {
    queryElegiveis = queryElegiveis.eq('cruzamento_status', 'ok');
    queryPendentes = queryPendentes.eq('cruzamento_status', 'ok');
  }
  const { count: elegiveis } = await aplicarFiltrosEcommerce(queryElegiveis, filtros);
  const { count: pendentes } = await aplicarFiltrosEcommerce(queryPendentes, filtros);
  const { count: ok } = await aplicarFiltrosEcommerce(
    aplicarFiltroJaFeitoCenario(supabase.from('ecommerce_order_snapshot').select('id', { count: 'exact', head: true }), pesoBase),
    filtros
  );
  return { configurado: true, elegiveis: elegiveis || 0, pendentes: pendentes || 0, ok: ok || 0 };
}

const CAMPOS_PEDIDO_RESIMULACAO = 'id, pedido, canal, uf, cidade, peso_cubado_cotado, peso_cubado_faturado, peso_real_cotado, peso_real_faturado, valor_pedido, valor_faturado, frete_tabela, custo_frete_transportadora, cte_valor, cte_transportadora, cte_uf_origem, cte_cidade_origem, prazo_dias_corridos, cds_com_saldo_venda, cubagem_cotada';

// Resolve os codigos de CD do pedido (campo texto, separado por virgula) para as
// cidades correspondentes via cd_centros, pra restringir a resimulacao so aos CDs
// que tinham saldo naquele pedido especifico.
function resolverCidadesSaldoPedido(pedido, mapaCdCentros) {
  const codigos = String(pedido.cds_com_saldo_venda || '').split(',').map((c) => c.trim()).filter(Boolean);
  if (!codigos.length) return pedido;
  const cidades = [...new Set(codigos.map((codigo) => mapaCdCentros.get(codigo)).filter(Boolean))];
  return { ...pedido, cdsSaldoCidades: cidades };
}

async function buscarPaginaPendentesResimulacao(limit = 800, filtros = {}, refazerTudo = false, incluirSemCruzamento = false, aposId = null, pesoBase = 'cotado') {
  const supabase = getSupabaseClient();
  let query = supabase
    .from('ecommerce_order_snapshot')
    .select(CAMPOS_PEDIDO_RESIMULACAO);
  if (!incluirSemCruzamento) query = query.eq('cruzamento_status', 'ok');
  if (!refazerTudo) query = aplicarFiltroPendenteCenario(query, pesoBase);
  if (refazerTudo && aposId) query = query.gt('id', aposId);
  query = aplicarFiltrosEcommerce(query, filtros)
    .order('id', { ascending: true })
    .limit(limit);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function carregarCandidatosStagingPorPedidos(supabase, pedidoIds = []) {
  const linhas = [];
  const tamanhoPagina = 500;
  for (const grupo of chunks(pedidoIds, 10)) {
    let from = 0;
    for (;;) {
      // Deduplica no PostgreSQL antes de transferir. O staging pode ter milhoes
      // de rotas repetidas; baixar tudo para deduplicar no browser causava timeout.
      // A funcao e somente leitura e nao remove nenhum candidato armazenado.
      const { data, error } = await supabase
        .rpc('ecommerce_candidatos_dedup', { p_pedido_ids: grupo })
        .range(from, from + tamanhoPagina - 1);
      if (error) throw error;
      const pagina = data || [];
      linhas.push(...pagina);
      if (pagina.length < tamanhoPagina) break;
      from += tamanhoPagina;
    }
  }
  return linhas;
}

export async function salvarResultadosResimulacaoEcommerce(resultados = []) {
  if (!resultados.length) return;
  const supabase = getSupabaseClient();
  const agora = new Date().toISOString();
  const linhas = resultados.map((r) => {
    const cenario = r.sim_peso_base;
    return {
      ...r,
      ...(cenario === 'cotado' ? { sim_resultado_cotado: r } : {}),
      ...(cenario === 'faturado' ? { sim_resultado_faturado: r } : {}),
      sim_resimulado_em: agora,
    };
  });
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
// Alem dos destinos, coleta tambem (quando usarSaldoDia esta ligado) as cidades de
// origem que aparecem em "CDs com Saldo na Venda" dos pedidos do recorte - permite
// restringir a malha carregada so aos CDs que algum pedido realmente pode usar, em vez
// de carregar todo CD que atende aqueles destinos (mesmo os sem saldo em nenhum pedido).
async function obterDestinosIbgeParaFiltro(filtros = {}, refazerTudo = false, incluirSemCruzamento = false, onProgress = null, mapaCdCentros = null, pesoBase = 'cotado') {
  const supabase = getSupabaseClient();
  const cidadesUf = new Set();
  const cidadesOrigemSaldo = new Set();
  let from = 0;
  let linhasLidas = 0;
  for (;;) {
    let query = supabase
      .from('ecommerce_order_snapshot')
      .select(mapaCdCentros ? 'cidade, uf, cds_com_saldo_venda' : 'cidade, uf');
    if (!incluirSemCruzamento) query = query.eq('cruzamento_status', 'ok');
    if (!refazerTudo) query = aplicarFiltroPendenteCenario(query, pesoBase);
    query = aplicarFiltrosEcommerce(query, filtros).range(from, from + 999);
    const { data, error } = await query;
    if (error) throw error;
    (data || []).forEach((r) => {
      cidadesUf.add(`${String(r.cidade || '').trim()}|${String(r.uf || '').trim().toUpperCase()}`);
      if (mapaCdCentros) {
        String(r.cds_com_saldo_venda || '').split(',').map((c) => c.trim()).filter(Boolean).forEach((codigo) => {
          const cidade = mapaCdCentros.get(codigo);
          if (cidade) cidadesOrigemSaldo.add(normalizarNomeCidade(cidade));
        });
      }
    });
    linhasLidas += (data || []).length;
    onProgress?.({ etapa: 'mapeando_destinos_pedidos', carregados: linhasLidas, total: null });
    if (!data || data.length < 1000) break;
    from += 1000;
  }

  let destinos = [];
  if (cidadesUf.size) {
    const municipios = await carregarMunicipiosIbgeDb();
    const mapasIbge = montarMapasIbge(municipios);
    destinos = [...new Set(
      [...cidadesUf].map((par) => {
        const [cidade, uf] = par.split('|');
        return resolverIbgeLocal(cidade, uf, mapasIbge);
      }).filter(Boolean)
    )];
  }
  return { destinosIbge: destinos, cidadesOrigemSaldo: [...cidadesOrigemSaldo] };
}

// Junta todos os ids do recorte (sem paginar por sim_status, que nao "esvazia"
// sozinho quando refazerTudo esta ligado - sim_status continua 'ok' antes e
// depois de reprocessar). Usado so no modo refazerTudo.
async function coletarIdsParaFiltro(filtros = {}, incluirSemCruzamento = false, onProgress = null) {
  const supabase = getSupabaseClient();
  const ids = [];
  let from = 0;
  for (;;) {
    let query = supabase
      .from('ecommerce_order_snapshot')
      .select('id');
    if (!incluirSemCruzamento) query = query.eq('cruzamento_status', 'ok');
    query = aplicarFiltrosEcommerce(query, filtros).range(from, from + 999);
    const { data, error } = await query;
    if (error) throw error;
    ids.push(...(data || []).map((r) => r.id));
    onProgress?.({ etapa: 'coletando_pedidos_do_recorte', carregados: ids.length, total: null });
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
      .select(CAMPOS_PEDIDO_RESIMULACAO)
      .in('id', grupo);
    if (error) throw error;
    pedidos.push(...(data || []));
  }
  return pedidos;
}

// Assinatura dos parametros que definem qual malha foi carregada - usada pra
// invalidar uma malha ja baixada quando os filtros/opcoes mudam (senao rodaria
// a simulacao com uma malha que nao corresponde mais ao recorte pedido).
export function assinaturaMalhaResimulacaoEcommerce({ filtros = {}, refazerTudo = false, incluirSemCruzamento = false, usarSaldoDia = true, cdsPermitidos = [], pesoBase = 'cotado', transportadorasExcluidas = [] } = {}) {
  return JSON.stringify({ filtros, refazerTudo, incluirSemCruzamento, usarSaldoDia, cdsPermitidos: [...cdsPermitidos].sort(), pesoBase, transportadorasExcluidas: [...transportadorasExcluidas].sort() });
}

// So a etapa de carregamento (a mais lenta e a que mais falha por timeout) - separada
// da simulacao propriamente dita, pra poder baixar uma vez e rodar (ou re-rodar depois
// de um erro) sem precisar recarregar rotas/cotacoes toda vez.
export async function carregarMalhaParaResimulacaoEcommerce({ filtros = {}, refazerTudo = false, incluirSemCruzamento = false, usarSaldoDia = true, cdsPermitidos = [], pesoBase = 'cotado', transportadorasExcluidas = [], onProgress } = {}) {
  if (!isSupabaseConfigured()) throw new Error('Supabase nao configurado.');
  onProgress?.({ etapa: 'carregando_tabelas_completas_fallback', carregados: 0, total: null });
  const mapaCdCentros = usarSaldoDia ? (await carregarMapaCdCentros()).mapa : null;
  const { destinosIbge, cidadesOrigemSaldo } = await obterDestinosIbgeParaFiltro(filtros, refazerTudo, incluirSemCruzamento, onProgress, mapaCdCentros, pesoBase);
  // Com saldo por pedido ligado, restringe a malha carregada so aos CDs que aparecem em
  // "CDs com Saldo na Venda" de algum pedido do recorte - em vez de carregar todo CD que
  // atende aqueles destinos (a maioria nunca vai ser usada, pois nenhum pedido tem saldo la).
  const cdsPermitidosMalha = cidadesOrigemSaldo.length ? cidadesOrigemSaldo : cdsPermitidos;
  const { transportadoras, municipios, vinculosTransportadoras } = await carregarMalhaB2cParaResimulacao({ onProgress, cdsPermitidos: cdsPermitidosMalha, destinosIbge, transportadorasExcluidas });
  return {
    transportadoras,
    municipios,
    vinculosTransportadoras,
    mapaCdCentros,
    assinatura: assinaturaMalhaResimulacaoEcommerce({ filtros, refazerTudo, incluirSemCruzamento, usarSaldoDia, cdsPermitidos, pesoBase, transportadorasExcluidas }),
  };
}

// Orquestra a resimulacao em lotes: mantem um worker vivo (malha B2C carregada 1x),
// pagina pedidos pendentes do Supabase e vai salvando resultado lote a lote. Pensado
// para volumes grandes (dezenas de milhares de pedidos) sem travar a aba nem estourar
// timeout de request. Aceita uma malhaPronta (de carregarMalhaParaResimulacaoEcommerce)
// pra pular a etapa de carregamento quando ja foi baixada antes.
export async function resimularEcommerceEmLotes({ criterioB2c, pesoBase = 'cotado', cdsPermitidos = [], usarSaldoDia = true, incluirSemCruzamento = false, tamanhoLote = 800, totalAlvo = null, filtros = {}, refazerTudo = false, malhaPronta = null, transportadorasExcluidas = [], onProgress } = {}) {
  if (!isSupabaseConfigured()) throw new Error('Supabase nao configurado.');

  const malha = malhaPronta || await carregarMalhaParaResimulacaoEcommerce({ filtros, refazerTudo, incluirSemCruzamento, usarSaldoDia, cdsPermitidos, pesoBase, transportadorasExcluidas, onProgress });
  const { transportadoras, municipios, vinculosTransportadoras, mapaCdCentros } = malha;

  // Refazendo tudo, a paginacao por sim_status='pendente' nao se auto-esvazia
  // (status ja e/continua 'ok'), entao junta os ids do recorte de uma vez e
  // pagina sobre essa lista fixa em vez de re-consultar por status.
  const idsFixos = refazerTudo ? await coletarIdsParaFiltro(filtros, incluirSemCruzamento, onProgress) : null;

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
    worker.postMessage({ type: 'init-malha-ecommerce', transportadoras, municipios, vinculosTransportadoras });
    await aguardarMensagem('malha-pronta');

    let totalProcessado = 0;
    let totalOk = 0;

    const idsEmLotes = idsFixos ? chunks(idsFixos, tamanhoLote) : null;
    let indiceLoteFixo = 0;

    for (;;) {
      const pagina = idsEmLotes
        ? await buscarPedidosPorIds(idsEmLotes[indiceLoteFixo++] || [])
        : await buscarPaginaPendentesResimulacao(tamanhoLote, filtros, false, incluirSemCruzamento, null, pesoBase);
      const fimDosLotesFixos = idsEmLotes && indiceLoteFixo >= idsEmLotes.length;
      if (!pagina.length) {
        if (fimDosLotesFixos || !idsEmLotes) break;
        continue;
      }

      onProgress?.({ etapa: 'resimulando', carregados: totalProcessado, total: totalAlvo, totalProcessado });

      const paginaComSaldo = mapaCdCentros ? pagina.map((p) => resolverCidadesSaldoPedido(p, mapaCdCentros)) : pagina;
      worker.postMessage({ type: 'resimular-lote-ecommerce', pedidos: paginaComSaldo, criterioB2c, pesoBase, cdsPermitidos });
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
export async function resimularEcommercePorIds({ ids = [], criterioB2c, pesoBase = 'cotado', cdsPermitidos = [], usarSaldoDia = true, incluirSemCruzamento = false, transportadorasExcluidas = [], onProgress } = {}) {
  if (!isSupabaseConfigured()) throw new Error('Supabase nao configurado.');
  if (!ids.length) return { totalProcessado: 0, totalOk: 0 };

  // Busca os pedidos ANTES da malha pra saber exatamente quais destinos
  // precisamos - com um recorte pequeno (esse botao resimula so o que esta
  // visivel/filtrado), isso reduz drasticamente o que precisa ser carregado
  // do banco em vez de sempre buscar a malha inteira.
  const supabase = getSupabaseClient();
  const pedidos = [];
  for (const grupo of chunks(ids, 200)) {
    let query = supabase
      .from('ecommerce_order_snapshot')
      .select(CAMPOS_PEDIDO_RESIMULACAO)
      .in('id', grupo);
    if (!incluirSemCruzamento) query = query.eq('cruzamento_status', 'ok');
    const { data, error } = await query;
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

  const mapaCdCentros = usarSaldoDia ? (await carregarMapaCdCentros()).mapa : null;
  // Mesma otimizacao do modo em lotes: restringe a malha carregada so aos CDs que
  // aparecem em "CDs com Saldo na Venda" desses pedidos especificos.
  const cidadesOrigemSaldo = mapaCdCentros
    ? [...new Set(pedidos.flatMap((p) => String(p.cds_com_saldo_venda || '').split(',').map((c) => c.trim()).filter(Boolean).map((codigo) => mapaCdCentros.get(codigo)).filter(Boolean)))]
    : [];
  const cdsPermitidosMalha = cidadesOrigemSaldo.length ? cidadesOrigemSaldo : cdsPermitidos;
  const { transportadoras, municipios, vinculosTransportadoras } = await carregarMalhaB2cParaResimulacao({ onProgress, cdsPermitidos: cdsPermitidosMalha, destinosIbge, transportadorasExcluidas });

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
    worker.postMessage({ type: 'init-malha-ecommerce', transportadoras, municipios, vinculosTransportadoras });
    await aguardarMensagem('malha-pronta');

    let totalProcessado = 0;
    let totalOk = 0;
    for (const lote of chunks(pedidos, 800)) {
      onProgress?.({ etapa: 'resimulando', carregados: totalProcessado, total: pedidos.length, totalProcessado });
      const loteComSaldo = mapaCdCentros ? lote.map((p) => resolverCidadesSaldoPedido(p, mapaCdCentros)) : lote;
      worker.postMessage({ type: 'resimular-lote-ecommerce', pedidos: loteComSaldo, criterioB2c, pesoBase, cdsPermitidos });
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

// ============================================================================
// Resimulacao por ORIGEM (faseada): em vez de carregar a malha de todos os CDs
// com saldo de uma vez (uma unica carga gigante, propensa a timeout), processa
// um CD por vez. Fase 1 (acumular) roda por origem: carrega so a malha daquele
// CD, calcula os candidatos dos pedidos que tem aquele CD no saldo e guarda em
// staging (ecommerce_sim_candidatos_origem). Fase 2 (fechar) le, pra cada
// pedido, todos os candidatos ja acumulados (de todas as origens processadas) e
// escolhe o vencedor - so ai grava o resultado final em ecommerce_order_snapshot.
// ============================================================================

// transportadorasExcluidas NAO entra aqui de proposito (apesar de ainda ser aceito
// no parametro, por compatibilidade com quem chama) - e um filtro dinamico tipo BI,
// pra testar cenarios "e se essa transportadora nao existisse" DEPOIS de fechado,
// sem precisar reprocessar a origem inteira. Se entrasse na assinatura, cada troca
// de selecao criava um checkpoint/progresso novo do zero, perdendo o que ja tinha
// sido processado (foi exatamente isso que aconteceu e travou o fechamento).
export function assinaturaFaseamentoEcommerce({ filtros = {}, refazerTudo = false, incluirSemCruzamento = false, pesoBase = 'cotado' } = {}) {
  return JSON.stringify({ versao: 7, filtros, refazerTudo, incluirSemCruzamento, pesoBase });
}

// Recupera sessoes antigas ainda retomaveis. Antes da tela ter historico proprio,
// os filtros/opcoes ja ficavam serializados na assinatura dos checkpoints e do
// progresso por origem; portanto conseguimos reconstruir execucoes em andamento.
export async function listarSessoesResimulacaoEcommerce() {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabaseClient();
  const [{ data: checkpoints, error: erroCheckpoints }, { data: progressos, error: erroProgressos }] = await Promise.all([
    supabase
      .from('ecommerce_sim_origem_checkpoint')
      .select('assinatura,origem_cidade,total_pedidos,atualizado_em')
      .order('atualizado_em', { ascending: false })
      .limit(5000),
    supabase
      .from('ecommerce_sim_origem_progresso')
      .select('assinatura,origem_cidade,concluido_em')
      .order('concluido_em', { ascending: false })
      .limit(5000),
  ]);
  if (erroCheckpoints) throw erroCheckpoints;
  if (erroProgressos) throw erroProgressos;

  const sessoes = new Map();
  const obter = (assinatura) => {
    if (!sessoes.has(assinatura)) {
      let configuracao;
      try { configuracao = JSON.parse(assinatura); } catch { configuracao = null; }
      if (!configuracao) return null;
      sessoes.set(assinatura, { assinatura, configuracao, atualizadoEm: null, origens: new Map() });
    }
    return sessoes.get(assinatura);
  };
  (progressos || []).forEach((row) => {
    const sessao = obter(row.assinatura);
    if (!sessao) return;
    sessao.origens.set(row.origem_cidade, { cidade: row.origem_cidade, concluida: true });
    if (!sessao.atualizadoEm || row.concluido_em > sessao.atualizadoEm) sessao.atualizadoEm = row.concluido_em;
  });
  (checkpoints || []).forEach((row) => {
    const sessao = obter(row.assinatura);
    if (!sessao) return;
    sessao.origens.set(row.origem_cidade, {
      cidade: row.origem_cidade,
      concluida: false,
      totalPedidosProcessados: Number(row.total_pedidos || 0),
    });
    if (!sessao.atualizadoEm || row.atualizado_em > sessao.atualizadoEm) sessao.atualizadoEm = row.atualizado_em;
  });
  return [...sessoes.values()]
    .map((sessao) => ({ ...sessao, origens: [...sessao.origens.values()] }))
    .sort((a, b) => String(b.atualizadoEm || '').localeCompare(String(a.atualizadoEm || '')));
}

// Apaga de vez o progresso/checkpoint de uma sessao de resimulacao (identificada pela
// assinatura). NAO mexe em ecommerce_order_snapshot nem em ecommerce_sim_candidatos_origem -
// so a marcacao de "quais origens ja rodaram" pra essa combinacao de filtros/peso, que e
// so bookkeeping intermediario. Usado tanto pelo botao "Excluir" (sessoes velhas/erradas)
// quanto automaticamente apos "Fechar resimulacao" (o bookkeeping deixa de servir pra
// algo depois que o resultado final ja foi gravado).
export async function excluirProgressoOrigensEcommerce(assinatura) {
  if (!isSupabaseConfigured() || !assinatura) return;
  const supabase = getSupabaseClient();
  const [{ error: erroProgresso }, { error: erroCheckpoint }] = await Promise.all([
    supabase.from('ecommerce_sim_origem_progresso').delete().eq('assinatura', assinatura),
    supabase.from('ecommerce_sim_origem_checkpoint').delete().eq('assinatura', assinatura),
  ]);
  if (erroProgresso) throw erroProgresso;
  if (erroCheckpoint) throw erroCheckpoint;
}

function cenariosPesoEcommerce(pesoBase = 'cotado') {
  return pesoBase === 'ambos' ? ['cotado', 'faturado'] : [pesoBase];
}

// Dentro da mesma transportadora/CD, uma opcao que custa mais e tambem demora
// mais nunca pode vencer o criterio preco/prazo. Remover essas linhas antes do
// staging preserva o resultado e evita gravar milhares de rotas redundantes por
// pedido (o principal gargalo das origens com muitas tabelas, como ITUPEVA).
function reduzirCandidatosStagingEcommerce(candidatos = []) {
  const unicos = deduplicarCandidatosEcommerce(candidatos);
  const grupos = new Map();
  unicos.forEach((candidato) => {
    const chave = `${normalizarNomeCidade(candidato.transportadora)}|${normalizarNomeCidade(candidato.origem)}`;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(candidato);
  });
  return [...grupos.values()].flatMap((grupo) => grupo.filter((candidato, indice) => {
    const valor = Number(candidato.total ?? candidato.valor ?? Infinity);
    const prazo = Number(candidato.prazo ?? Infinity);
    return !grupo.some((outro, outroIndice) => {
      if (outroIndice === indice) return false;
      const outroValor = Number(outro.total ?? outro.valor ?? Infinity);
      const outroPrazo = Number(outro.prazo ?? Infinity);
      return outroValor <= valor && outroPrazo <= prazo && (outroValor < valor || outroPrazo < prazo);
    });
  }));
}

async function salvarResultadosDuploCenarioEcommerce(resultadosCotado = [], resultadosFaturado = []) {
  const supabase = getSupabaseClient();
  const agora = new Date().toISOString();
  const cotadoPorId = new Map(resultadosCotado.map((resultado) => [resultado.id, resultado]));
  const faturadoPorId = new Map(resultadosFaturado.map((resultado) => [resultado.id, resultado]));
  const ids = [...new Set([...cotadoPorId.keys(), ...faturadoPorId.keys()])];
  const linhas = ids.map((id) => {
    const cotado = cotadoPorId.get(id) || null;
    const faturado = faturadoPorId.get(id) || null;
    const legado = cotado || faturado || { id };
    return {
      ...legado,
      id,
      sim_peso_base: 'ambos',
      sim_resultado_cotado: cotado,
      sim_resultado_faturado: faturado,
      sim_resimulado_em: agora,
    };
  });
  for (const grupo of chunks(linhas, 100)) {
    const { error } = await supabase.from('ecommerce_order_snapshot').upsert(grupo, { onConflict: 'id' });
    if (error) throw error;
  }
}

// Mapeia as origens (CDs com saldo) do recorte, com a quantidade de pedidos de cada
// uma e se ja foram processadas antes (mesma assinatura) - pra mostrar a lista na tela
// antes de comecar, e o usuario poder rodar origem a origem com controle visual.
export async function mapearOrigensParaResimulacaoEcommerce({ filtros = {}, refazerTudo = false, incluirSemCruzamento = false, pesoBase = 'cotado', transportadorasExcluidas = [], onProgress } = {}) {
  if (!isSupabaseConfigured()) return { origens: [] };
  const supabase = getSupabaseClient();

  const { mapa: mapaCdCentros } = await carregarMapaCdCentros();
  const assinatura = assinaturaFaseamentoEcommerce({ filtros, refazerTudo, incluirSemCruzamento, pesoBase, transportadorasExcluidas });

  onProgress?.({ etapa: 'mapeando_destinos_pedidos', carregados: 0, total: null });
  const { cidadesOrigemSaldo } = await obterDestinosIbgeParaFiltro(filtros, refazerTudo, incluirSemCruzamento, onProgress, mapaCdCentros, pesoBase);
  if (!cidadesOrigemSaldo.length) return { origens: [], assinatura };

  const { data: progressoData, error: erroProgresso } = await supabase
    .from('ecommerce_sim_origem_progresso')
    .select('origem_cidade')
    .eq('assinatura', assinatura);
  if (erroProgresso) throw erroProgresso;
  const jaProcessadas = new Set((progressoData || []).map((r) => r.origem_cidade));

  // Checkpoint intermediario (origem cancelada/caida no meio) - pra mostrar na lista
  // quanto ja foi salvo daquela origem antes, em vez do usuario achar que voltou a zero.
  const { data: checkpointData, error: erroCheckpointLista } = await supabase
    .from('ecommerce_sim_origem_checkpoint')
    .select('origem_cidade, total_pedidos')
    .eq('assinatura', assinatura);
  if (erroCheckpointLista) throw erroCheckpointLista;
  const pedidosSalvosPorOrigem = new Map((checkpointData || []).map((r) => [r.origem_cidade, r.total_pedidos]));

  const origens = [];
  for (const origemCidade of cidadesOrigemSaldo) {
    const codigosDaOrigem = [...mapaCdCentros.entries()].filter(([, cidade]) => normalizarNomeCidade(cidade) === origemCidade).map(([codigo]) => codigo);
    let quantidadePedidos = 0;
    if (codigosDaOrigem.length) {
      let query = supabase.from('ecommerce_order_snapshot').select('id', { count: 'exact', head: true });
      if (!incluirSemCruzamento) query = query.eq('cruzamento_status', 'ok');
      if (!refazerTudo) query = aplicarFiltroPendenteCenario(query, pesoBase);
      query = aplicarFiltrosEcommerce(query, { ...filtros, cdCodigos: codigosDaOrigem });
      const { count, error } = await query;
      if (error) throw error;
      quantidadePedidos = count || 0;
    }
    origens.push({
      cidade: origemCidade,
      quantidadePedidos,
      concluida: jaProcessadas.has(origemCidade),
      pedidosSalvos: pedidosSalvosPorOrigem.get(origemCidade) || 0,
    });
  }

  return { origens: origens.sort((a, b) => b.quantidadePedidos - a.quantidadePedidos), assinatura };
}

// Processa UMA origem so: carrega a malha (so dos destinos que os pedidos dessa origem
// precisam, ver carregarBaseFiltradaPorOrigemEDestinosDb), calcula os candidatos e
// acumula em staging. Retorna quantos pedidos foram cobertos. Usado tanto pelo modo
// automatico (processarResimulacaoPorOrigemEcommerce, que chama isso em loop) quanto
// pelo controle manual da tela (1 clique = 1 origem, com feedback visual por origem).
export async function processarUmaOrigemEcommerce({ origemCidade, filtros = {}, refazerTudo = false, incluirSemCruzamento = false, pesoBase = 'cotado', tamanhoLotePedidos = 200, totalPedidosOrigem = null, transportadorasExcluidas = [], onProgress } = {}) {
  if (!isSupabaseConfigured()) throw new Error('Supabase nao configurado.');
  const supabase = getSupabaseClient();

  const { mapa: mapaCdCentros } = await carregarMapaCdCentros();
  const municipios = await carregarMunicipiosIbgeDb();
  const mapasIbge = montarMapasIbge(municipios);
  const assinatura = assinaturaFaseamentoEcommerce({ filtros, refazerTudo, incluirSemCruzamento, pesoBase, transportadorasExcluidas });

  const origemNormalizada = normalizarNomeCidade(origemCidade);
  const codigosDaOrigem = [...mapaCdCentros.entries()]
    .filter(([, cidade]) => normalizarNomeCidade(cidade) === origemNormalizada)
    .map(([codigo]) => codigo);
  if (!codigosDaOrigem.length) {
    throw new Error(`Origem "${origemCidade}" nao possui codigo correspondente em cd_centros.`);
  }
  const { data: checkpointData, error: erroCheckpoint } = await supabase
    .from('ecommerce_sim_origem_checkpoint')
    .select('ultimo_pedido_id, total_pedidos')
    .eq('assinatura', assinatura)
    .eq('origem_cidade', origemCidade)
    .maybeSingle();
  if (erroCheckpoint) throw erroCheckpoint;
  let totalPedidos = Number(checkpointData?.total_pedidos || 0);
  let ultimoPedidoId = checkpointData?.ultimo_pedido_id || null;
  // Reaproveita a malha durante toda a origem. Antes, cada pagina de 200 pedidos
  // recarregava inclusive destinos ja vistos, fazendo ITAJAI repetir a mesma etapa
  // dezenas de vezes. O indice cresce apenas quando aparece um destino novo.
  const destinosJaCarregados = new Set();
  const indiceAcumulado = new Map();

  if (codigosDaOrigem.length) {
    for (;;) {
      let query = supabase.from('ecommerce_order_snapshot').select(CAMPOS_PEDIDO_RESIMULACAO);
      if (!incluirSemCruzamento) query = query.eq('cruzamento_status', 'ok');
      if (!refazerTudo) query = aplicarFiltroPendenteCenario(query, pesoBase);
      query = aplicarFiltrosEcommerce(query, { ...filtros, cdCodigos: codigosDaOrigem })
        .order('id', { ascending: true })
        .limit(tamanhoLotePedidos);
      if (ultimoPedidoId) query = query.gt('id', ultimoPedidoId);
      const { data: pagina, error: erroPagina } = await query;
      if (erroPagina) throw erroPagina;
      if (!pagina || !pagina.length) break;

      // Busca a malha so dos destinos que essa leva de pedidos realmente precisa (nao a
      // rede inteira do CD) - mesmo principio da ferramenta "Simular Saida de
      // Transportadora": par origem+destino exato, nao "toda rota que sai desse CD".
      const destinosDaPagina = [...new Set(
        pagina.map((p) => resolverIbgeLocal(p.cidade, p.uf, mapasIbge)).filter(Boolean)
      )];
      const destinosNovos = destinosDaPagina.filter((ibge) => !destinosJaCarregados.has(ibge));
      const idsPagina = pagina.map((p) => p.id);
      let itensCalculados = [];
      if (destinosNovos.length) {
        const excluidas = new Set((transportadorasExcluidas || []).map((nome) => String(nome || '').trim().toUpperCase()));
        const transportadorasDaPagina = (await carregarBaseFiltradaPorOrigemEDestinosDb(
          [origemCidade],
          destinosNovos,
          (evt) => onProgress?.({
            ...evt,
            origemAtual: origemCidade,
            pedidosProcessadosOrigem: totalPedidos,
            totalPedidosOrigem,
          })
        )).filter((item) => !excluidas.has(String(item?.nome || '').trim().toUpperCase()));
        if (transportadorasDaPagina.length) {
          const { index: indiceNovo } = construirIndiceResimulacaoEcommerce(transportadorasDaPagina, municipios);
          indiceNovo.forEach((candidatos, chave) => indiceAcumulado.set(chave, candidatos));
        }
        destinosNovos.forEach((ibge) => destinosJaCarregados.add(ibge));
      }
      if (destinosDaPagina.length) {
        itensCalculados = cenariosPesoEcommerce(pesoBase).flatMap((cenario) =>
          calcularCandidatosOrigemEcommerce({ pedidos: pagina, mapasIbge, index: indiceAcumulado, pesoBase: cenario })
            .map((item) => ({
              ...item,
              candidatos: reduzirCandidatosStagingEcommerce(item.candidatos),
              pesoBase: cenario,
            }))
        );
      }

      onProgress?.({
        etapa: 'salvando_candidatos_origem',
        origemAtual: origemCidade,
        pedidosProcessadosOrigem: totalPedidos,
        totalPedidosOrigem,
      });

      // Apaga staging anterior desses pedidos pra essa origem antes de inserir de novo -
      // idempotente: se essa origem for reprocessada (retomada apos erro), nao duplica.
      for (const grupo of chunks(idsPagina, 200)) {
        const { error: erroDelete } = await supabase
          .from('ecommerce_sim_candidatos_origem')
          .delete()
          .eq('origem_cidade', origemCidade)
          .in('pedido_id', grupo);
        if (erroDelete) throw erroDelete;
      }
      const linhasStaging = [];
      itensCalculados.forEach(({ pedidoId, canal, candidatos, pesoBase: cenario }) => {
        candidatos.forEach((candidato) => linhasStaging.push({ pedido_id: pedidoId, origem_cidade: origemCidade, canal, peso_base: cenario, candidato }));
      });
      for (const grupo of chunks(linhasStaging, 300)) {
        const { error: erroInsert } = await supabase.from('ecommerce_sim_candidatos_origem').insert(grupo);
        if (erroInsert) throw erroInsert;
      }

      totalPedidos += pagina.length;
      ultimoPedidoId = pagina[pagina.length - 1].id;
      const { error: erroSalvarCheckpoint } = await supabase
        .from('ecommerce_sim_origem_checkpoint')
        .upsert({
          assinatura,
          origem_cidade: origemCidade,
          ultimo_pedido_id: ultimoPedidoId,
          total_pedidos: totalPedidos,
          atualizado_em: new Date().toISOString(),
        }, { onConflict: 'assinatura,origem_cidade' });
      if (erroSalvarCheckpoint) throw erroSalvarCheckpoint;
      onProgress?.({
        etapa: 'processando_origem',
        origemAtual: origemCidade,
        pedidosNaOrigem: totalPedidos,
        pedidosProcessadosOrigem: totalPedidos,
        totalPedidosOrigem,
      });

      if (pagina.length < tamanhoLotePedidos) break;
    }
  }

  const { error: erroMarcar } = await supabase
    .from('ecommerce_sim_origem_progresso')
    .upsert({ assinatura, origem_cidade: origemCidade }, { onConflict: 'assinatura,origem_cidade' });
  if (erroMarcar) throw erroMarcar;

  // Origem concluida: o registro definitivo fica em origem_progresso e o checkpoint
  // intermediario deixa de ser necessario.
  const { error: erroLimparCheckpoint } = await supabase
    .from('ecommerce_sim_origem_checkpoint')
    .delete()
    .eq('assinatura', assinatura)
    .eq('origem_cidade', origemCidade);
  if (erroLimparCheckpoint) throw erroLimparCheckpoint;

  return { origemCidade, totalPedidos };
}

// Fase 1 (modo automatico): processa TODAS as origens (CDs com saldo) do recorte, uma a
// uma, em sequencia. Retomavel - origens ja concluidas (marcadas em
// ecommerce_sim_origem_progresso) sao puladas se chamado de novo com a mesma assinatura.
export async function processarResimulacaoPorOrigemEcommerce({ filtros = {}, refazerTudo = false, incluirSemCruzamento = false, pesoBase = 'cotado', tamanhoLotePedidos = 200, transportadorasExcluidas = [], onProgress } = {}) {
  if (!isSupabaseConfigured()) throw new Error('Supabase nao configurado.');
  const supabase = getSupabaseClient();

  const { mapa: mapaCdCentros } = await carregarMapaCdCentros();
  const assinatura = assinaturaFaseamentoEcommerce({ filtros, refazerTudo, incluirSemCruzamento, pesoBase, transportadorasExcluidas });

  onProgress?.({ etapa: 'mapeando_destinos_pedidos', carregados: 0, total: null });
  const { cidadesOrigemSaldo } = await obterDestinosIbgeParaFiltro(filtros, refazerTudo, incluirSemCruzamento, onProgress, mapaCdCentros, pesoBase);
  if (!cidadesOrigemSaldo.length) return { totalOrigens: 0, origensProcessadas: 0 };

  const { data: progressoData, error: erroProgresso } = await supabase
    .from('ecommerce_sim_origem_progresso')
    .select('origem_cidade')
    .eq('assinatura', assinatura);
  if (erroProgresso) throw erroProgresso;
  const jaProcessadas = new Set((progressoData || []).map((r) => r.origem_cidade));

  let origensFeitas = jaProcessadas.size;
  for (const origemCidade of cidadesOrigemSaldo) {
    if (jaProcessadas.has(origemCidade)) continue;

    onProgress?.({ etapa: 'processando_origem', origemAtual: origemCidade, carregados: origensFeitas, total: cidadesOrigemSaldo.length });
    await processarUmaOrigemEcommerce({ origemCidade, filtros, refazerTudo, incluirSemCruzamento, pesoBase, tamanhoLotePedidos, transportadorasExcluidas, onProgress: (evt) => onProgress?.({ ...evt, carregados: origensFeitas, total: cidadesOrigemSaldo.length }) });

    origensFeitas += 1;
    onProgress?.({ etapa: 'processando_origem', origemAtual: origemCidade, carregados: origensFeitas, total: cidadesOrigemSaldo.length });
  }

  return { totalOrigens: cidadesOrigemSaldo.length, origensProcessadas: origensFeitas };
}

// Fase 2: pra cada pedido pendente do recorte, junta todos os candidatos ja
// acumulados (de todas as origens processadas na fase 1) e escolhe o vencedor -
// so ai grava sim_status='ok' e os campos sim_* definitivos.
export async function finalizarResimulacaoPorOrigemEcommerce({ filtros = {}, refazerTudo = false, incluirSemCruzamento = false, permitirFechamentoParcial = false, origensEsperadas = [], criterioB2c, pesoBase = 'cotado', tamanhoLote = 50, transportadorasExcluidas = [], onProgress } = {}) {
  if (!isSupabaseConfigured()) throw new Error('Supabase nao configurado.');
  const supabase = getSupabaseClient();

  const [{ mapa: mapaCdCentros }, municipios, vinculos] = await Promise.all([
    carregarMapaCdCentros(),
    carregarMunicipiosIbgeDb(),
    carregarVinculosTransportadoras(),
  ]);
  const mapasIbge = montarMapasIbge(municipios);
  const mapaVinculos = criarMapaVinculosTransportadoras(vinculos || []);
  const assinatura = assinaturaFaseamentoEcommerce({ filtros, refazerTudo, incluirSemCruzamento, pesoBase, transportadorasExcluidas });

  if (!permitirFechamentoParcial) {
    const { data: progresso, error: erroProgresso } = await supabase
      .from('ecommerce_sim_origem_progresso')
      .select('origem_cidade')
      .eq('assinatura', assinatura);
    if (erroProgresso) throw erroProgresso;
    const concluidas = new Set((progresso || []).map((item) => normalizarNomeCidade(item.origem_cidade)));
    // A tela ja fez o mapeamento completo e conhece exatamente as origens esperadas.
    // Nao repete aqui a varredura de toda ecommerce_order_snapshot, que podia levar
    // horas e estourar statement_timeout antes mesmo de ler o staging pronto.
    const faltantes = (origensEsperadas || []).filter((cidade) => !concluidas.has(normalizarNomeCidade(cidade)));
    if (faltantes.length) {
      throw new Error(`Fechamento bloqueado: faltam ${faltantes.length} origem(ns) processar (${faltantes.slice(0, 5).join(', ')}${faltantes.length > 5 ? ', ...' : ''}).`);
    }
  }

  let totalProcessado = 0;
  let totalOk = 0;
  let ultimoIdProcessado = null;

  for (;;) {
    const pagina = await buscarPaginaPendentesResimulacao(
      tamanhoLote,
      filtros,
      refazerTudo,
      incluirSemCruzamento,
      ultimoIdProcessado,
      pesoBase
    );
    if (!pagina.length) break;

    const ids = pagina.map((p) => p.id);
    const candidatosPorPedido = new Map();
    const linhasStaging = await carregarCandidatosStagingPorPedidos(supabase, ids);
    linhasStaging.forEach((row) => {
      if (!candidatosPorPedido.has(row.pedido_id)) candidatosPorPedido.set(row.pedido_id, new Map());
      const cenario = row.peso_base || 'cotado';
      const porCenario = candidatosPorPedido.get(row.pedido_id);
      if (!porCenario.has(cenario)) porCenario.set(cenario, { canal: row.canal, calculados: [] });
      porCenario.get(cenario).calculados.push(row.candidato);
    });
    candidatosPorPedido.forEach((porCenario) => {
      porCenario.forEach((staged) => {
        staged.calculados = deduplicarCandidatosEcommerce(staged.calculados);
      });
    });

    const mapaPedidos = new Map(pagina.map((p) => [p.id, p.pedido]));
    const resultadosPorCenario = new Map();
    for (const cenario of cenariosPesoEcommerce(pesoBase)) {
      const itensParaFinalizar = [];
      const resultadosDiretos = [];
      pagina.forEach((pedido) => {
        const ibgeDestino = resolverIbgeLocal(pedido.cidade, pedido.uf, mapasIbge) || '';
        if (!ibgeDestino) {
          resultadosDiretos.push({ id: pedido.id, sim_status: 'sem_ibge_destino', sim_peso_base: cenario });
          return;
        }
        const staged = candidatosPorPedido.get(pedido.id)?.get(cenario);
        if (!staged || !staged.calculados.length) {
          const codigos = String(pedido.cds_com_saldo_venda || '').split(',').map((c) => c.trim()).filter(Boolean);
          const algumReconhecido = codigos.some((codigo) => mapaCdCentros.has(codigo));
          let statusSemCandidato = 'sem_malha';
          if (!codigos.length) statusSemCandidato = 'sem_cd_saldo_informado';
          else if (!algumReconhecido) statusSemCandidato = 'sem_cd_saldo_reconhecido';
          resultadosDiretos.push({ id: pedido.id, sim_status: statusSemCandidato, sim_peso_base: cenario });
          return;
        }
        const pedidoComSaldo = resolverCidadesSaldoPedido(pedido, mapaCdCentros);
        itensParaFinalizar.push({ pedido: pedidoComSaldo, canal: staged.canal || categoriaCanalRealizado(pedido.canal || 'B2C'), calculados: staged.calculados });
      });
      const calculados = calcularResultadoFinalEcommerce({ itens: itensParaFinalizar, criterioB2c, pesoBase: cenario, mapaVinculos });
      resultadosPorCenario.set(cenario, [...resultadosDiretos, ...calculados].map((r) => ({ ...r, pedido: mapaPedidos.get(r.id) })));
    }

    if (pesoBase === 'ambos') {
      await salvarResultadosDuploCenarioEcommerce(resultadosPorCenario.get('cotado'), resultadosPorCenario.get('faturado'));
    } else {
      await salvarResultadosResimulacaoEcommerce(resultadosPorCenario.get(pesoBase));
    }

    // Depois que os resultados completos (incluindo top de candidatos) foram
    // preservados no pedido, o staging desse lote nao tem mais utilidade.
    for (const grupo of chunks(ids, 200)) {
      const { error: erroLimpeza } = await supabase
        .from('ecommerce_sim_candidatos_origem')
        .delete()
        .in('pedido_id', grupo);
      if (erroLimpeza) throw erroLimpeza;
    }

    const resultados = resultadosPorCenario.get(pesoBase === 'ambos' ? 'cotado' : pesoBase) || [];

    totalProcessado += pagina.length;
    totalOk += resultados.filter((r) => r.sim_status === 'ok').length;
    onProgress?.({ etapa: 'salvando_resultados', carregados: totalProcessado, total: null, totalProcessado, totalOk });

    if (refazerTudo) ultimoIdProcessado = pagina[pagina.length - 1]?.id || ultimoIdProcessado;
    if (pagina.length < tamanhoLote) break;
  }

  // Checkpoints/progresso servem apenas para retomada antes do fechamento.
  await supabase.from('ecommerce_sim_origem_checkpoint').delete().eq('assinatura', assinatura);
  await supabase.from('ecommerce_sim_origem_progresso').delete().eq('assinatura', assinatura);

  return { totalProcessado, totalOk };
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

// Consolida a base inteira do recorte para o painel. Usa cursor em vez de OFFSET,
// mantendo o custo previsivel mesmo quando a auditoria passa de 100 mil pedidos.
export async function carregarIndicadoresEcommerce({ filtros = {}, cenarioPeso = 'cotado', onProgress } = {}) {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabaseClient();
  const resumo = {
    total: 0, ressimulados: 0, mesmaTransportadora: 0, outraTransportadora: 0,
    comparacaoIndefinida: 0, casosPagoAMais: 0, valorPagoAMais: 0,
    maiorDesvio: 0, pagosAMaisComCampanha: 0, pagosAMaisPesoDiferente: 0,
    alternativas: {}, itens: [],
  };
  let aposId = null;
  const limite = 1000;
  while (true) {
    let query = supabase
      .from('ecommerce_order_snapshot')
      .select('id,pedido,data_criacao,sim_status,sim_peso_base,sim_mesma_transportadora,sim_transportadora_ideal,sim_origem_ideal,sim_diferenca_vs_cte,sim_valor_ideal,sim_candidatos,cotado_status:sim_resultado_cotado->>sim_status,cotado_mesma:sim_resultado_cotado->>sim_mesma_transportadora,cotado_transportadora:sim_resultado_cotado->>sim_transportadora_ideal,cotado_origem:sim_resultado_cotado->>sim_origem_ideal,cotado_diferenca:sim_resultado_cotado->>sim_diferenca_vs_cte,cotado_valor:sim_resultado_cotado->>sim_valor_ideal,cotado_candidatos:sim_resultado_cotado->sim_candidatos,faturado_status:sim_resultado_faturado->>sim_status,faturado_mesma:sim_resultado_faturado->>sim_mesma_transportadora,faturado_transportadora:sim_resultado_faturado->>sim_transportadora_ideal,faturado_origem:sim_resultado_faturado->>sim_origem_ideal,faturado_diferenca:sim_resultado_faturado->>sim_diferenca_vs_cte,faturado_valor:sim_resultado_faturado->>sim_valor_ideal,faturado_candidatos:sim_resultado_faturado->sim_candidatos,cte_transportadora,cte_cidade_origem,cte_valor,custo_frete_transportadora,frete_tabela,possui_campanha_frete,frete_a_cobrar_marketplace,adicional_tributario_frete,desconto_campanha_frete,peso_cubado_cotado,peso_cubado_faturado,diferenca_peso_cubado,peso_real_cotado,peso_real_faturado,diferenca_peso_real,cubagem_cotada,cidade,uf,canal')
      .order('id', { ascending: true })
      .limit(limite);
    // O painel financeiro analisa somente resultados concluidos. Ignora o filtro
    // de status da tela para nunca varrer pendentes/sem_malha por engano.
    query = aplicarFiltrosEcommerce(query, { ...filtros, simStatus: null });
    if (aposId !== null) query = query.gt('id', aposId);
    const { data, error } = await query;
    if (error) throw error;
    const pagina = data || [];
    for (const row of pagina) {
      const resultadoPorPrefixo = (prefixo) => row[`${prefixo}_status`] ? {
        sim_status: row[`${prefixo}_status`],
        sim_mesma_transportadora: row[`${prefixo}_mesma`] === 'true' ? true : row[`${prefixo}_mesma`] === 'false' ? false : null,
        sim_transportadora_ideal: row[`${prefixo}_transportadora`],
        sim_origem_ideal: row[`${prefixo}_origem`],
        sim_diferenca_vs_cte: Number(row[`${prefixo}_diferenca`] || 0),
        sim_valor_ideal: Number(row[`${prefixo}_valor`] || 0),
        sim_candidatos: Array.isArray(row[`${prefixo}_candidatos`]) ? row[`${prefixo}_candidatos`] : [],
      } : null;
      const resultado = resultadoPorPrefixo(cenarioPeso);
      const resultadoLegado = row.sim_status === 'ok' && row.sim_peso_base === cenarioPeso
        ? {
            sim_status: row.sim_status,
            sim_mesma_transportadora: row.sim_mesma_transportadora,
            sim_transportadora_ideal: row.sim_transportadora_ideal,
            sim_origem_ideal: row.sim_origem_ideal,
            sim_diferenca_vs_cte: row.sim_diferenca_vs_cte,
            sim_valor_ideal: row.sim_valor_ideal,
            sim_candidatos: Array.isArray(row.sim_candidatos) ? row.sim_candidatos : [],
          }
        : null;
      const sim = resultado || resultadoLegado;
      if (!sim || sim.sim_status !== 'ok') continue;
      const outroResultado = resultadoPorPrefixo(cenarioPeso === 'faturado' ? 'cotado' : 'faturado');
      resumo.total += 1;
      resumo.ressimulados += 1;
      const desvio = Number(sim.sim_diferenca_vs_cte || 0);
      const pesoCotado = Number(row.peso_real_cotado || 0);
      const pesoFaturado = Number(row.peso_real_faturado || 0);
      const diferencaPeso = Number(row.diferenca_peso_real || 0);
      const cubagem = Number(row.cubagem_cotada || 0);
      const pesoCubadoReferencia = cubagem * 300;
      const referenciaPeso = Math.max(pesoCotado, pesoCubadoReferencia, 0);
      const pesoPossivelmenteInconsistente = pesoFaturado > 0 && referenciaPeso > 0
        && pesoFaturado > referenciaPeso * 1.5 && pesoFaturado - referenciaPeso > 10;
      const valorPago = Number(row.custo_frete_transportadora || row.cte_valor || 0);
      const impactoCampanhaEscolha = calcularImpactoCampanhaNaEscolha({
        possuiCampanha: Boolean(row.possui_campanha_frete),
        mesmaTransportadora: sim.sim_mesma_transportadora,
        freteTabela: Number(row.frete_tabela || 0),
        descontoCampanha: Number(row.desconto_campanha_frete || 0),
        valorIdeal: Number(sim.sim_valor_ideal || 0),
        candidatos: sim.sim_candidatos || [],
        valorPago,
      });
      resumo.itens.push({
        id: row.id,
        pedido: row.pedido,
        dataCriacao: row.data_criacao || null,
        transportadoraUsada: row.cte_transportadora || 'Nao identificada',
        transportadoraIdeal: sim.sim_transportadora_ideal || 'Nao identificada',
        origemUsada: row.cte_cidade_origem || 'Nao identificada',
        origemIdeal: sim.sim_origem_ideal || 'Nao identificada',
        destino: [row.cidade, row.uf].filter(Boolean).join('/'),
        canal: row.canal || '',
        uf: row.uf || '',
        mesmaTransportadora: sim.sim_mesma_transportadora,
        perda: sim.sim_mesma_transportadora === false && desvio > 0.009 ? desvio : 0,
        campanha: Boolean(row.possui_campanha_frete),
        taxaMarketplace: Number(row.frete_a_cobrar_marketplace || 0),
        adicionalTributario: Number(row.adicional_tributario_frete || 0),
        descontoCampanha: Number(row.desconto_campanha_frete || 0),
        freteCotado: Number(row.frete_tabela || 0),
        diferencaPeso: Math.abs(diferencaPeso) > 0.01 || (pesoCotado > 0 && pesoFaturado > 0 && Math.abs(pesoCotado - pesoFaturado) > 0.01),
        pesoCotado,
        pesoFaturado,
        pesoCubadoReferencia,
        pesoPossivelmenteInconsistente,
        mudouTransportadoraPorPeso: Boolean(outroResultado?.sim_status === 'ok' && outroResultado.sim_transportadora_ideal !== sim.sim_transportadora_ideal),
        transportadoraIdealOutroCenario: outroResultado?.sim_transportadora_ideal || '',
        valorIdealOutroCenario: Number(outroResultado?.sim_valor_ideal || 0),
        valorIdeal: Number(sim.sim_valor_ideal || 0),
        valorPago,
        impactoCampanhaEscolha,
      });
      if (sim.sim_mesma_transportadora === true) resumo.mesmaTransportadora += 1;
      else if (sim.sim_mesma_transportadora === false) resumo.outraTransportadora += 1;
      else resumo.comparacaoIndefinida += 1;
      // "Pago a mais" exige outra transportadora E uma alternativa mais barata.
      // Uma diferenca positiva na mesma transportadora nao representa desvio de
      // roteirizacao e fica fora deste indicador.
      if (sim.sim_mesma_transportadora !== false || desvio <= 0.009) continue;
      resumo.casosPagoAMais += 1;
      resumo.valorPagoAMais += desvio;
      resumo.maiorDesvio = Math.max(resumo.maiorDesvio, desvio);
      if (row.possui_campanha_frete) resumo.pagosAMaisComCampanha += 1;
      if (Math.abs(diferencaPeso) > 0.01 || (pesoCotado > 0 && pesoFaturado > 0 && Math.abs(pesoCotado - pesoFaturado) > 0.01)) {
        resumo.pagosAMaisPesoDiferente += 1;
      }
      const alternativa = sim.sim_transportadora_ideal || 'Nao identificada';
      resumo.alternativas[alternativa] = (resumo.alternativas[alternativa] || 0) + 1;
    }
    onProgress?.({ carregados: resumo.total });
    if (pagina.length < limite) break;
    aposId = pagina[pagina.length - 1].id;
  }
  resumo.valorPagoAMais = Number(resumo.valorPagoAMais.toFixed(2));
  resumo.economiaMedia = resumo.casosPagoAMais ? Number((resumo.valorPagoAMais / resumo.casosPagoAMais).toFixed(2)) : 0;
  resumo.alternativas = Object.entries(resumo.alternativas)
    .map(([nome, quantidade]) => ({ nome, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade)
    .slice(0, 10);
  return resumo;
}

function normalizarTextoConsultaDb(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase();
}

// Consulta a tabela cadastrada de uma origem especifica (rota + faixas de
// peso + generalidades), pra o usuario conferir na fonte se o valor que a
// resimulacao calculou bate com o que esta cadastrado, sem precisar sair da
// tela nem eu ficar rodando query manual toda vez que aparecer duvida.
export async function consultarTabelaOrigemDb({ transportadora, origemCidade, ibgeDestino } = {}) {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabaseClient();

  const { data: transportadoras, error: erroTransp } = await supabase
    .from('transportadoras')
    .select('id, nome')
    .ilike('nome', `%${String(transportadora || '').trim()}%`);
  if (erroTransp) throw erroTransp;
  const transportadoraEncontrada = (transportadoras || [])[0];
  if (!transportadoraEncontrada) return null;

  const { data: origensDaTransportadora, error: erroOrigens } = await supabase
    .from('origens')
    .select('id, cidade, canal, status, validado, validado_em, validado_por')
    .eq('transportadora_id', transportadoraEncontrada.id);
  if (erroOrigens) throw erroOrigens;
  const cidadeNorm = normalizarTextoConsultaDb(origemCidade);
  const origem = (origensDaTransportadora || []).find((o) => {
    const oNorm = normalizarTextoConsultaDb(o.cidade);
    return oNorm === cidadeNorm || oNorm.includes(cidadeNorm) || cidadeNorm.includes(oNorm);
  });
  if (!origem) return { transportadora: transportadoraEncontrada.nome, origemEncontrada: false };

  let rotasQuery = supabase.from('rotas').select('*').eq('origem_id', origem.id);
  if (ibgeDestino) rotasQuery = rotasQuery.eq('ibge_destino', ibgeDestino);
  const { data: rotas, error: erroRotas } = await rotasQuery.limit(20);
  if (erroRotas) throw erroRotas;

  const nomesRota = [...new Set((rotas || []).map((r) => r.nome_rota).filter(Boolean))];
  let cotacoes = [];
  if (nomesRota.length) {
    const { data: cotacoesData, error: erroCotacoes } = await supabase
      .from('cotacoes')
      .select('rota, peso_min, peso_max, valor_fixo, rs_kg, excesso, percentual, updated_at')
      .eq('origem_id', origem.id)
      .in('rota', nomesRota)
      .order('peso_min', { ascending: true });
    if (erroCotacoes) throw erroCotacoes;
    cotacoes = cotacoesData || [];
  }

  const { data: generalidades } = await supabase
    .from('generalidades')
    .select('*')
    .eq('origem_id', origem.id)
    .maybeSingle();

  return {
    transportadora: transportadoraEncontrada.nome,
    origemEncontrada: true,
    origem,
    rotas: rotas || [],
    cotacoes,
    generalidades: generalidades || null,
  };
}

// ---------------------------------------------------------------------------
// Cobertura da base: ate onde a base de pedidos vai e, dentro dela, quanto ja
// esta cruzado com CT-e e recalculado em cada cenario de peso. Usa somente
// contagens (head:true), entao nao le linha nenhuma - responde em segundos mesmo
// com a base inteira, ao contrario do painel de indicadores.
// ---------------------------------------------------------------------------

function primeiroDiaMes(iso) {
  return `${iso.slice(0, 7)}-01`;
}

function proximoMes(iso) {
  const [ano, mes] = iso.slice(0, 7).split('-').map(Number);
  return mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, '0')}-01`;
}

function ultimoDiaDoMes(iso) {
  const proximo = proximoMes(iso);
  const d = new Date(`${proximo}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function listarDiasDoIntervalo(inicio, fim) {
  const dias = [];
  const d = new Date(`${inicio}T00:00:00Z`);
  const limite = new Date(`${fim}T00:00:00Z`);
  while (d <= limite && dias.length < 400) {
    dias.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dias;
}

// Extremos da base (sem filtro de data): ate que dia ja foi importado.
export async function limitesBaseEcommerce() {
  if (!isSupabaseConfigured()) return { configurado: false, primeiro: null, ultimo: null, total: 0 };
  const supabase = getSupabaseClient();
  const [primeiraResp, ultimaResp, totalResp] = await Promise.all([
    supabase.from('ecommerce_order_snapshot').select('data_criacao').not('data_criacao', 'is', null).order('data_criacao', { ascending: true }).limit(1),
    supabase.from('ecommerce_order_snapshot').select('data_criacao').not('data_criacao', 'is', null).order('data_criacao', { ascending: false }).limit(1),
    supabase.from('ecommerce_order_snapshot').select('id', { count: 'exact', head: true }),
  ]);
  if (primeiraResp.error) throw primeiraResp.error;
  if (ultimaResp.error) throw ultimaResp.error;
  return {
    configurado: true,
    primeiro: primeiraResp.data?.[0]?.data_criacao ? String(primeiraResp.data[0].data_criacao).slice(0, 10) : null,
    ultimo: ultimaResp.data?.[0]?.data_criacao ? String(ultimaResp.data[0].data_criacao).slice(0, 10) : null,
    total: totalResp.count || 0,
  };
}

// Contagens de um recorte de datas: total na base, cruzado com CT-e e recalculado
// em cada cenario. Os "recalculados" so contam pedidos com cruzamento ok, que sao
// os unicos elegiveis - assim a barra de cobertura nunca passa de 100%.
async function contarFatiaCobertura(supabase, dataInicio, dataFim) {
  const base = () => aplicarFiltrosEcommerce(
    supabase.from('ecommerce_order_snapshot').select('id', { count: 'exact', head: true }),
    { dataInicio, dataFim }
  );
  const [total, cruzados, cotado, faturado, semCte] = await Promise.all([
    base(),
    base().eq('cruzamento_status', 'ok'),
    base().eq('cruzamento_status', 'ok').not('sim_resultado_cotado', 'is', null),
    base().eq('cruzamento_status', 'ok').not('sim_resultado_faturado', 'is', null),
    base().neq('cruzamento_status', 'ok'),
  ]);
  for (const resp of [total, cruzados, cotado, faturado, semCte]) {
    if (resp.error) throw resp.error;
  }
  return {
    dataInicio,
    dataFim,
    total: total.count || 0,
    cruzados: cruzados.count || 0,
    semCte: semCte.count || 0,
    cotado: cotado.count || 0,
    faturado: faturado.count || 0,
  };
}

// Executa as fatias em ondas pequenas pra nao estourar o limite de conexoes do
// PostgREST quando o usuario abre o detalhe diario de um mes inteiro.
async function contarFatiasEmOndas(supabase, intervalos, onProgress, tamanhoOnda = 4) {
  const linhas = [];
  for (let i = 0; i < intervalos.length; i += tamanhoOnda) {
    const onda = intervalos.slice(i, i + tamanhoOnda);
    const resultados = await Promise.all(onda.map(({ inicio, fim }) => contarFatiaCobertura(supabase, inicio, fim)));
    linhas.push(...resultados);
    if (onProgress) onProgress({ prontos: linhas.length, total: intervalos.length });
  }
  return linhas;
}

// Cobertura mes a mes de toda a base importada.
export async function carregarCoberturaEcommerce({ onProgress } = {}) {
  if (!isSupabaseConfigured()) return { configurado: false, meses: [], limites: null };
  const supabase = getSupabaseClient();
  const limites = await limitesBaseEcommerce();
  if (!limites.primeiro || !limites.ultimo) return { configurado: true, meses: [], limites };

  const intervalos = [];
  let cursor = primeiroDiaMes(limites.primeiro);
  const fimBase = primeiroDiaMes(limites.ultimo);
  while (cursor <= fimBase && intervalos.length < 60) {
    intervalos.push({ inicio: cursor, fim: ultimoDiaDoMes(cursor) });
    cursor = proximoMes(cursor);
  }
  const meses = await contarFatiasEmOndas(supabase, intervalos, onProgress);
  return { configurado: true, limites, meses, atualizadoEm: new Date().toISOString() };
}

// Detalhe dia a dia de um mes (usado ao expandir uma linha da cobertura).
export async function carregarCoberturaDiariaEcommerce(mesIso, { onProgress } = {}) {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabaseClient();
  const inicio = primeiroDiaMes(`${mesIso}-01`);
  const fim = ultimoDiaDoMes(inicio);
  const intervalos = listarDiasDoIntervalo(inicio, fim).map((dia) => ({ inicio: dia, fim: dia }));
  return contarFatiasEmOndas(supabase, intervalos, onProgress, 6);
}
