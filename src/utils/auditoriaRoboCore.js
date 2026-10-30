// Nucleo do Robo Auditor: apura uma fatura (calculo dos CT-es, valor a descontar, entrega) e
// decide o que fazer. Roda no navegador E na nuvem (api/robo-auditor.js, via bundle
// api/_robo-core.mjs gerado por scripts/build-robo-core.cjs).
//
// ATENCAO: a apuracao espelha resumirFaturasExato da tela de Auditoria
// (CentralAuditoriaFretesPage.jsx). Nao toca naquela tela; se a regra de la mudar, ajustar aqui.
import { getSupabaseClient } from '../lib/supabaseClient';
import { carregarDetalhesFaturaSupabase } from '../services/lotacaoSupabaseService';
import { buscarReferenciaCtes, vincularChavesDetalhesPorNumero, corrigirBaseCtesPeloTracking } from '../services/auditoriaFretesService';
import { carregarSaldosAutorizadosPorChave } from '../services/transporteAutorizacoesService';
import { buscarStatusEntregaCtes, chaveEntregaRegistro, STATUS_ENTREGA } from '../services/auditoriaEntregaCteService';
import { processarCtesPorChave } from '../services/auditoriaCteProcessamentoService';
import { entrarCacheCalculo, sairCacheCalculo } from '../services/freteDatabaseService';
import { salvarRecorteCarregadoAuditoria } from '../services/auditoriaService';
import { normalizarChaveCte } from './auditoriaFretesDomain';
import { montarCorrecoesCalculoFatura, numeroValorNfAuditoria, numeroPesoAuditoria, escolherMaiorPeso } from './correcoesCalculoFatura';
import { classificarFatura, DECISAO, STATUS_ROBO_AUDITA, ROBO_DATA_INICIO, dataInicioRobo, dataEntradaFatura, buscarTodasPaginas, laudoResolvidoFora, faturaPaga, faturaLancadaErp } from '../services/auditorRoboService';

// Escopo do cache das tabelas de frete (ver freteDatabaseService): abrir antes de um lote e fechar no finally.
export { entrarCacheCalculo as iniciarCacheCalculoRobo, sairCacheCalculo as encerrarCacheCalculoRobo };
export { classificarFatura, DECISAO, STATUS_ROBO_AUDITA, ROBO_DATA_INICIO, dataInicioRobo, dataEntradaFatura, buscarTodasPaginas, laudoResolvidoFora };

// Mesma tolerancia padrao da tela (a tela deixa ajustar por navegador; na nuvem vale o padrao).
const TOLERANCIA = { acima: 1, abaixo: 5 };
const dentroDaTolerancia = (dif) => Number.isFinite(Number(dif)) && Number(dif) <= TOLERANCIA.acima && Number(dif) >= -TOLERANCIA.abaixo;

function deduplicar(lista = []) {
  const mapa = new Map();
  for (const item of lista || []) {
    const chave = normalizarChaveCte(item.chave_cte) || normalizarChaveCte(item.numero_cte) || String(item.id || '');
    if (!chave) continue;
    const anterior = mapa.get(chave);
    if (!anterior) { mapa.set(chave, item); continue; }
    const valorAtual = Number(item.valor_frete || 0);
    const valorAnterior = Number(anterior.valor_frete || 0);
    const calcAtual = Number(item.calculado_frete || item.calculado_frete_verum || 0) > 0;
    const calcAnterior = Number(anterior.calculado_frete || anterior.calculado_frete_verum || 0) > 0;
    if ((valorAtual > 0 && valorAnterior <= 0) || (calcAtual && !calcAnterior)) mapa.set(chave, { ...anterior, ...item });
  }
  return [...mapa.values()];
}

// Valor/calculo e, como a tela, peso, NF, rota e detalhes do calculo (usados nas correcoes manuais do recalculo).
function mesclar(item, referencia) {
  const base = referencia.get(normalizarChaveCte(item.chave_cte)) || referencia.get(normalizarChaveCte(item.numero_cte));
  if (!base) return item;
  const valor = Number(item.valor_frete || base.valor_cte || 0);
  const amd = Number(base.valor_calculado || 0);
  const diferenca = amd > 0 ? Number((valor - amd).toFixed(2)) : Number(item.diferenca || 0);
  return { ...item,
    canal: item.canal || base.canal || '',
    cidade_origem: item.cidade_origem || item.origem || base.cidade_origem || base.origem || '',
    uf_origem: item.uf_origem || base.uf_origem || '',
    cidade_destino: item.cidade_destino || item.destino || base.cidade_destino || base.destino || '',
    uf_destino: item.uf_destino || base.uf_destino || '',
    ibge_origem: item.ibge_origem || base.ibge_origem || '',
    ibge_destino: item.ibge_destino || base.ibge_destino || '',
    peso: numeroPesoAuditoria(item, base),
    valor_nf: numeroValorNfAuditoria(item, base) || item.valor_nf || base.valor_nf || base.valorNF || 0,
    detalhes_calculo: base.detalhes_calculo || item.detalhes_calculo || null,
    valor_frete: valor, calculado_frete: amd, diferenca, motivo_sem_calculo: base.motivo_sem_calculo || '', status: amd > 0 ? (Math.abs(diferenca) <= 0.01 ? 'OK' : 'DIVERGENTE') : (item.status || 'SEM_CALCULO') };
}

function aplicarSaldo(item, saldos, referencia) {
  if (!saldos?.size) return item;
  const nfe = item.chave_nfe || referencia?.get(normalizarChaveCte(item.chave_cte))?.chave_nfe;
  const saldo = Number(saldos.get(normalizarChaveCte(item.chave_cte)) || saldos.get(normalizarChaveCte(nfe)) || 0);
  if (!(saldo > 0)) return item;
  const calculado = Number((Number(item.calculado_frete) + saldo).toFixed(2));
  const diferenca = Number((Number(item.valor_frete || 0) - calculado).toFixed(2));
  return { ...item, calculado_frete: calculado, diferenca };
}

// Linha da fatura sem chave que nao casou por numero/CNPJ. Serie de NFS-e municipal (SPN, CWN, RJN, OS...) nao e
// CT-e e nunca vai estar na base de CT-es; o resto e CT-e que ainda nao foi carregado na base. Mantem "nao localizado"
// no texto: o painel do robo classifica por ele.
function motivoSemChave(item = {}) {
  const serie = String(item.serie_cte || '').trim().toUpperCase();
  if (/^[A-Z]{2}N$/.test(serie) || serie === 'OS') return `NFS-e (serie ${serie}) nao localizado na base de CT-e: conferir manualmente`;
  return 'CT-e nao localizado na base (sem chave, nao achado por numero/CNPJ): importar o XML ou atualizar a base de CT-es';
}

function resumir(lista) {
  const total = lista.length;
  const calculados = lista.filter((i) => Number(i.calculado_frete || 0) > 0).length;
  const divergentes = lista.filter((i) => Number(i.calculado_frete || 0) > 0 && !dentroDaTolerancia(i.diferenca)).length;
  const maior = lista.reduce((acc, i) => {
    const dif = Number(i.diferenca || 0);
    if (i.desconto_sem_tabela) return acc + Math.max(dif, 0);
    if (Number(i.calculado_frete || 0) <= 0 || dentroDaTolerancia(dif)) return acc;
    return acc + Math.max(dif, 0);
  }, 0);
  const menor = lista.reduce((acc, i) => {
    const dif = Number(i.diferenca || 0);
    if (Number(i.calculado_frete || 0) <= 0 || dentroDaTolerancia(dif)) return acc;
    return acc + Math.abs(Math.min(dif, 0));
  }, 0);
  const calculoAmd = lista.reduce((acc, i) => acc + Number(i.calculado_frete || 0), 0);
  const motivos = new Map();
  lista.filter((i) => !(Number(i.calculado_frete || 0) > 0)).forEach((i) => {
    const m = String(i.motivo_sem_calculo || '').trim()
      || (normalizarChaveCte(i.chave_cte).length !== 44 ? motivoSemChave(i) : 'sem resultado de calculo na base');
    if (m) motivos.set(m, (motivos.get(m) || 0) + 1);
  });
  const motivoSemCalculo = [...motivos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  return { motivoSemCalculo, total, calculados, calculoAmd: Number(calculoAmd.toFixed(2)), semCalculo: total - calculados, divergentes, maior: Number(maior.toFixed(2)), menor: Number(menor.toFixed(2)) };
}

async function detalhesExatos(fatura) {
  let detalhes = await carregarDetalhesFaturaSupabase(fatura.id);
  if (detalhes.some((i) => !i.chave_cte)) detalhes = (await vincularChavesDetalhesPorNumero(fatura, detalhes)).detalhes;
  const unicos = deduplicar(detalhes);
  const referencia = await buscarReferenciaCtes(unicos.flatMap((i) => [i.chave_cte, i.numero_cte]), { lancarErro: true });
  const chaves = unicos.flatMap((i) => [i.chave_cte, i.chave_nfe, referencia.get(normalizarChaveCte(i.chave_cte))?.chave_nfe]).filter(Boolean);
  const saldos = chaves.length ? await carregarSaldosAutorizadosPorChave(chaves) : new Map();
  return unicos.map((i) => aplicarSaldo(mesclar(i, referencia), saldos, referencia));
}

// Flag de contingencia (auditor_robo_config.liberar_entrega_contingencia): enquanto ligada, o robo nao trava a
// fatura por falta de entrega; grava baixa de entrega APROVADA ("Liberado em contingencia") nos CT-es pendentes,
// para a entrega valer tambem na Auditoria/pagamento. Desligada, volta a exigir a entrega. Falha = desligada.
const JUSTIFICATIVA_CONTINGENCIA = 'Liberado em contingencia';
async function contingenciaEntregaLigada() {
  try {
    const { data } = await getSupabaseClient().from('auditor_robo_config').select('liberar_entrega_contingencia').eq('id', 1).maybeSingle();
    return data?.liberar_entrega_contingencia === true;
  } catch { return false; }
}

async function baixarEntregaContingencia(fatura, pendentes = []) {
  const soDig = (v) => String(v || '').replace(/\D/g, '');
  const agora = new Date().toISOString();
  const loteId = `lote_${Date.now().toString(36)}`;
  const linhas = pendentes.map((i) => ({
    lote_id: loteId, fatura_id: String(fatura.id), numero_fatura: fatura.numero_fatura || null, transportadora: fatura.transportadora || null,
    chave: chaveEntregaRegistro(i), chave_cte: soDig(i.chave_cte) || null, numero_cte: i.numero_cte || null, data_entrega: agora.slice(0, 10),
    status: 'APROVADO', solicitado_por: 'Robo Auditor', solicitado_em: agora, decidido_por: 'Robo Auditor (contingencia)', decidido_em: agora,
    justificativa: JUSTIFICATIVA_CONTINGENCIA, observacao: JUSTIFICATIVA_CONTINGENCIA,
  })).filter((l) => l.chave);
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await getSupabaseClient().from('entrega_baixas_manuais').insert(linhas.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
}

const brl = (v) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;
const dataBr = (v) => { const t = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t.split('-').reverse().join('/') : ''; };

// Excedente de lotacao (CT-e auditado pela DIST do fluxo e acima do saldo da viagem): vai para a fila
// "Autorizacoes Lotacao" (transporte_autorizacoes, canal LOTACAO), igual ao B2C/Atacado. A Operacao autoriza e o
// valor autorizado soma ao calculado do CT-e na fatura (aplicarSaldo), liberando o custo; recusado, segue o laudo.
// Um por CT-e: autorizado ou recusado nao volta para a fila.
async function abrirAutorizacoesExcedenteLotacao(fatura, registros = []) {
  const excedentes = registros.filter((r) => r?.detalhes_calculo?.motor === 'fluxo_lotacao'
    && Number(r.detalhes_calculo.excedente_viagem || 0) > TOLERANCIA.acima && normalizarChaveCte(r.chave_cte).length === 44);
  if (!excedentes.length) return 0;
  const db = getSupabaseClient();
  const chaves = [...new Set(excedentes.map((r) => normalizarChaveCte(r.chave_cte)))];
  const { data: existentes, error } = await db.from('transporte_autorizacoes').select('chave_cte').eq('ativo', true).eq('canal', 'LOTACAO').in('chave_cte', chaves);
  if (error) throw new Error(`Autorizacoes de lotacao: ${error.message}`);
  const jaNaFila = new Set((existentes || []).map((a) => normalizarChaveCte(a.chave_cte)));
  const novas = chaves.filter((c) => !jaNaFila.has(c)).map((chave) => {
    const r = excedentes.find((x) => normalizarChaveCte(x.chave_cte) === chave);
    const d = r.detalhes_calculo;
    const saldo = Number(d.saldo_antes_deste_cte || 0);
    const excedente = Number(d.excedente_viagem || 0);
    return {
      canal: 'LOTACAO', origem: 'AUDITORIA', status: 'PENDENTE', chave_cte: chave, chave_nfe: normalizarChaveCte(r.chave_nfe) || null,
      transportadora: r.transportadora_tabela || r.transportadora || fatura.transportadora || null,
      cidade_origem: r.cidade_origem || d.origem_cidade || null, cidade_destino: r.cidade_destino || d.destino_cidade || null,
      valor_nf: Number(r.valor_nf || 0), valor_cte: Number(r.valor_cte || 0), valor_calculado: Number(r.valor_calculado || 0), valor_divergente: excedente,
      observacao_auditoria: `[ROBO] Viagem ${d.dist} (${d.origem_cidade || ''} -> ${d.destino_cidade || ''}, ${d.tipo_veiculo || ''}): valor da viagem ${brl(d.valor_autorizado_viagem)}, saldo antes deste CT-e ${brl(saldo)}, CT-e cobrou ${brl(r.valor_cte)}; excedente ${brl(excedente)}.`,
      enviado_por: 'Robo Auditor', fatura_id: fatura.id || null,
    };
  });
  if (novas.length) {
    const { error: erroInsert } = await db.from('transporte_autorizacoes').insert(novas);
    if (erroInsert) throw new Error(`Enviar excedente para autorizacao: ${erroInsert.message}`);
  }
  return novas.length;
}

// CT-e de lotacao sem DIST (nem na tabela nem no fluxo): abre o mesmo "Questionamento para Operacao" da
// Auditoria de Lotacao pedindo a viagem. Quando a Operacao responde escolhendo a DIST, o motor passa a usar
// esse vinculo e o CT-e calcula na proxima reavaliacao. Um por CT-e (inclusive se o auditor ja abriu a mao).

async function abrirQuestionamentosSemDistLotacao(fatura, registros = []) {
  const semDist = registros.filter((r) => r?.status_calculo === 'SEM_DIST_LOTACAO' && normalizarChaveCte(r.chave_cte).length === 44);
  if (!semDist.length) return 0;
  const db = getSupabaseClient();
  const chaves = [...new Set(semDist.map((r) => normalizarChaveCte(r.chave_cte)))];
  const { data: existentes, error } = await db.from('audit_solicitacoes_informacao').select('chave_informada').in('chave_informada', chaves);
  if (error) throw new Error(`Questionamentos de lotacao: ${error.message}`);
  const jaAbertos = new Set((existentes || []).map((q) => normalizarChaveCte(q.chave_informada)));
  const agora = new Date().toISOString();
  const novos = chaves.filter((c) => !jaAbertos.has(c)).map((chave) => {
    const r = semDist.find((x) => normalizarChaveCte(x.chave_cte) === chave);
    const descricao = [
      'Questionamento para Operação — Auditoria Lotação',
      '',
      `Motivo principal: CT-e de lotação sem DIST/viagem na tabela de lotação nem no fluxo de cargas${r.detalhes_calculo?.motivo_original ? ` (${r.detalhes_calculo.motivo_original})` : ''}.`,
      'Observação do auditor: INFORMAR DIST OU PEDIDO (aberto automaticamente pelo Robô Auditor)',
      '',
      'Dados do CT-e encontrado na base:',
      `- Chave CT-e: ${chave}`,
      `- Número CT-e: ${r.numero_cte || ''}`,
      `- Transportadora CT-e: ${r.transportadora || ''}`,
      `- Fatura: ${fatura.numero_fatura || ''}`,
      `- Origem: ${r.cidade_origem || ''}/${r.uf_origem || ''}`,
      `- Destino: ${r.cidade_destino || ''}/${r.uf_destino || ''}`,
      `- Emissão: ${dataBr(r.data_emissao)}`,
      `- Valor CT-e: ${brl(r.valor_cte)}`,
      `- Peso: ${Number(r.peso || 0).toLocaleString('pt-BR')} kg`,
      `- Canal/Operação: ${r.canal || ''}`,
    ].join('\n');
    return {
      id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `quest-robo-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      tipo: 'CTE', chave_informada: chave, numero_informado: String(r.numero_cte || ''), transportadora: String(r.transportadora || ''),
      fatura: String(fatura.numero_fatura || ''), descricao_problema: descricao, prioridade: 'ALTA', status: 'AGUARDANDO_INFORMACAO',
      aberto_por_nome: 'Robo Auditor', created_at: agora, updated_at: agora,
    };
  });
  if (novos.length) {
    const { error: erroInsert } = await db.from('audit_solicitacoes_informacao').insert(novos);
    if (erroInsert) throw new Error(`Abrir questionamento para a operacao: ${erroInsert.message}`);
  }
  return novos.length;
}

// Excedentes de lotacao desta fatura ainda sem decisao da operacao.
async function excedentesLotacaoPendentes(fatura, lista = []) {
  const chaves = [...new Set(lista.map((i) => normalizarChaveCte(i.chave_cte)).filter((c) => c.length === 44))];
  if (!chaves.length) return 0;
  const { data, error } = await getSupabaseClient().from('transporte_autorizacoes').select('chave_cte')
    .eq('ativo', true).eq('canal', 'LOTACAO').eq('status', 'PENDENTE').in('chave_cte', chaves);
  if (error) return 0;
  return new Set((data || []).map((a) => a.chave_cte)).size;
}

// Calcula (se faltar) e resume a fatura. Retorna o resumo no formato esperado por classificarFatura.
// prazoFinal (timestamp ms, opcional): na nuvem a funcao tem limite de tempo. Calcula os CT-es em
// blocos pequenos, gravando cada bloco; se o prazo acabar, lanca '__parcial__' e a proxima
// execucao continua do que ainda falta (o que ja foi calculado fica salvo).
// calcular=false (nuvem): nao dispara o calculo dos CT-es, que carrega a base de rotas inteira e estoura o
// limite da funcao; so apura o que ja esta calculado (navegador, auditor abrindo a fatura, importacao).
// recalcularTudo (reavaliacao manual): refaz o calculo de TODOS os CT-es da fatura, e nao so dos que estavam sem
// resultado; so fica "sem calculo" o que realmente der erro no calculo.
export async function apurarFaturaRobo(fatura, aoProgredir = () => {}, { prazoFinal = 0, calcular = true, recalcularTudo = false, bloco = 100, limiteBlocoMs = 0, pesoMaisProximo = true } = {}) {
  // Blocos de 100 no navegador (cada bloco recarrega as tabelas das rotas dele: blocos maiores repetem menos esse
  // carregamento, que e o grosso do tempo) e pequenos na nuvem (parametro `bloco`). Blocos pequenos: cada bloco e calculado E GRAVADO, o andamento aparece na tela e, se a pagina
  // for fechada no meio, o que ja foi calculado fica salvo. Na nuvem (limiteBlocoMs) um bloco que demora
  // demais e abandonado: os CT-es dele ficam "sem calculo (demorou demais)" e o robo segue.
  const BLOCO = bloco;
  aoProgredir({ fase: 'lendo' });
  let lista = await detalhesExatos(fatura);
  let calculou = false;
  let erroCalculo = '';
  let falhasCalculo = 0;
  let falhaFilaLotacao = '';
  const precisaCalcular = (i) => recalcularTudo || !(Number(i.calculado_frete || 0) > 0);
  if (calcular && lista.length && lista.some(precisaCalcular)) {
    entrarCacheCalculo(prazoFinal ? 540000 : 180000);
    try {
    const chaves = [...new Set(lista.filter(precisaCalcular).map((i) => normalizarChaveCte(i.chave_cte)).filter((c) => c.length === 44))];
    // Como o botao "corrigir pelo tracking" da fatura: origem/destino errados na base (distrito no lugar do municipio,
    // UF trocada, "Humildes" em vez de Feira de Santana) davam "rota/origem nao encontrada". O tracking manda; so
    // nos CT-es ainda sem calculo. Falha aqui nao impede o calculo.
    const semCalculo = [...new Set(lista.filter((i) => !(Number(i.calculado_frete || 0) > 0)).map((i) => normalizarChaveCte(i.chave_cte)).filter((c) => c.length === 44))];
    if (semCalculo.length) {
      aoProgredir({ fase: 'corrigindo_tracking', atual: 0, total: semCalculo.length });
      try { await corrigirBaseCtesPeloTracking(semCalculo); } catch (e) { console.warn('[robo] correcao pelo tracking falhou:', e?.message || e); }
    }
    // Mesmas correcoes manuais do Recalcular da fatura (endereco, canal, NF/peso, reentrega, forma de peso da linha).
    const correcoes = montarCorrecoesCalculoFatura(lista.filter(precisaCalcular), { pesoTrackingMaisProximo: pesoMaisProximo });
    const opcoesBase = {
      ignorarCubagem: true,
      valorNfOverridePorChave: correcoes.valorNfOverridePorChave,
      trackingOverridePorChave: correcoes.trackingOverridePorChave,
      reentregaPorChave: correcoes.reentregaPorChave,
    };
    const modoDoLote = (lote, forcar) => Object.fromEntries(lote
      .map((c) => [c, forcar || (pesoMaisProximo ? null : correcoes.modoPesoPorChave[c])])
      .filter(([, modo]) => modo));
    for (let i = 0; i < chaves.length; i += BLOCO) {
      if (prazoFinal && Date.now() > prazoFinal) throw new Error('__parcial__');
      aoProgredir({ fase: 'calculando', atual: Math.min(i + BLOCO, chaves.length), total: chaves.length });
      try {
        const lote = chaves.slice(i, i + BLOCO);
        // pesoMaisProximo (Reavaliar manual com a opcao marcada): calcula com o peso do CT-e e com o peso do Tracking
        // (com cubagem x fator da tabela) e fica, CT-e a CT-e, com o resultado mais proximo do valor cobrado.
        const calculo = pesoMaisProximo
          ? Promise.all([
            processarCtesPorChave(lote, () => {}, opcoesBase),
            processarCtesPorChave(lote, () => {}, { ...opcoesBase, modoPesoPorChave: modoDoLote(lote, 'tracking') }),
          ]).then(([cte, tracking]) => ({ registros: escolherPesoMaisProximo(cte.registros || [], tracking.registros || []) }))
          : processarCtesPorChave(lote, () => {}, { ...opcoesBase, modoPesoPorChave: modoDoLote(lote) });
        const { registros } = limiteBlocoMs
          ? await Promise.race([calculo, new Promise((_, rej) => { setTimeout(() => rej(new Error(`demorou demais (>${Math.round(limiteBlocoMs / 1000)}s)`)), limiteBlocoMs); })])
          : await calculo;
        if (registros.length) {
          const competencia = registros.find((r) => r.competencia)?.competencia || new Date().toISOString().slice(0, 7);
          // Grava so os resultados detalhados dos CT-es. NAO reler o mes inteiro para refazer o resumo mensal
          // (centenas de milhares de CT-es): isso estourava o tempo do banco ("Erro ao recarregar o mes completo")
          // e era repetido a cada bloco. O resumo mensal e atualizado pelo fluxo mensal da Auditoria CT-e.
          await salvarRecorteCarregadoAuditoria({ competencia, registros, atualizarResumoMensal: false });
          calculou = true;
          try { await abrirAutorizacoesExcedenteLotacao(fatura, registros); } catch (e) { falhaFilaLotacao = String(e?.message || e).slice(0, 140); }
          try { await abrirQuestionamentosSemDistLotacao(fatura, registros); } catch (e) { console.warn('[robo] questionamento para a operacao:', e?.message || e); }
        }
      } catch (e) {
        // Um bloco com erro nao derruba a fatura: os CT-es dele ficam "sem calculo" e os demais seguem.
        falhasCalculo += Math.min(BLOCO, chaves.length - i);
        erroCalculo = erroCalculo || String(e?.message || e).slice(0, 140);
      }
    }
    } finally {
      sairCacheCalculo();
    }
    if (calculou) lista = await detalhesExatos(fatura);
  }
  aoProgredir({ fase: 'apurando' });
  const r = resumir(lista);
  let entregues = 0;
  let pendentes = null;
  try {
    const entrega = await buscarStatusEntregaCtes(lista);
    lista.forEach((i) => { if (entrega.get(chaveEntregaRegistro(i))?.status === STATUS_ENTREGA.ENTREGUE) entregues += 1; });
    pendentes = lista.length - entregues;
    if (pendentes > 0 && await contingenciaEntregaLigada()) {
      await baixarEntregaContingencia(fatura, lista.filter((i) => entrega.get(chaveEntregaRegistro(i))?.status !== STATUS_ENTREGA.ENTREGUE));
      entregues = lista.length;
      pendentes = 0;
    }
  } catch { /* entrega nao verificada: classificarFatura manda para o auditor */ }
  const excedentesLotacao = await excedentesLotacaoPendentes(fatura, lista);
  return { ...r, entregues, pendentes, erroCalculo, falhasCalculo, excedentesLotacao, falhaFilaLotacao };
}

// Excedente de lotacao aguardando a operacao: nao manda laudo nem gestao antes da decisao.
function aguardarOperacaoLotacao(c, resumo) {
  if (c.decisao === DECISAO.REVISAO_AUDITOR) return c;
  // Excedente que nao entrou na fila (ex.: migration do canal LOTACAO ainda nao aplicada): segura do mesmo jeito.
  if (resumo?.falhaFilaLotacao) return { decisao: DECISAO.REVISAO_AUDITOR, motivo: `Excedente de lotacao nao entrou em Autorizacoes Lotacao (${resumo.falhaFilaLotacao}).`, descontar: c.descontar };
  if (!(resumo?.excedentesLotacao > 0)) return c;
  return { decisao: DECISAO.REVISAO_AUDITOR, motivo: `Aguardando a Operacao Lotacao autorizar ${resumo.excedentesLotacao} excedente(s) acima do saldo da DIST (Autorizacoes Lotacao).`, descontar: c.descontar };
}

// Envia a fatura (auditoria completa, sem desconto, tudo entregue) para a APROVACAO DA GESTAO,
// identificada como "via robo" no historico. Mesmos campos que a tela grava ao enviar para a
// gestao (so colunas que existem em `faturas`). So age se a fatura ainda estiver em auditoria.
// db = cliente supabase (navegador: getSupabaseClient(); nuvem: cliente service role).
export async function enviarFaturaParaGestaoRobo(db, fatura, resumo, { usuario = 'Robo Auditor', origem = 'automatico' } = {}) {
  const { data: atual, error: erroLeitura } = await db.from('faturas').select('id,status').eq('id', fatura.id).maybeSingle();
  if (erroLeitura) throw new Error(`Leitura da fatura: ${erroLeitura.message}`);
  if (!atual || !STATUS_ROBO_AUDITA.includes(atual.status)) return { enviada: false, motivo: `Fatura nao esta mais em auditoria (${atual?.status || 'inexistente'}).` };
  const agora = new Date().toISOString();
  const saldo = Number((Number(fatura.valor_fatura || 0) - Number(resumo.calculoAmd || 0)).toFixed(2));
  const { error } = await db.from('faturas').update({
    status: 'AGUARDANDO_APROVACAO_GESTAO',
    valor_calculado: Number(resumo.calculoAmd || 0),
    diferenca: saldo,
    valor_recuperado: 0,
    ctes_totais: resumo.total,
    ctes_auditados: resumo.calculados,
    ctes_divergentes: resumo.divergentes,
    ctes_sem_calculo: resumo.semCalculo,
    updated_at: agora,
  }).eq('id', fatura.id).in('status', STATUS_ROBO_AUDITA);
  if (error) throw new Error(`Envio para a gestao: ${error.message}`);
  const { error: erroHist } = await db.from('auditoria_fatura_historico').insert({
    id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `robo-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    fatura_id: fatura.id,
    created_at: agora,
    acao: 'STATUS_ALTERADO',
    status_anterior: atual.status,
    status_novo: 'AGUARDANDO_APROVACAO_GESTAO',
    descricao: `[VIA ROBO] Enviada para aprovacao da gestao pelo Robo Auditor (${origem}): ${resumo.calculados} de ${resumo.total} CT-e(s) calculados, sem cobranca a maior e ${resumo.entregues} de ${resumo.total} entregues. Auditor responsavel em copia.`,
    usuario_nome: usuario,
    usuario_email: '',
  });
  if (erroHist) console.warn('[robo] historico nao registrado:', erroHist.message);
  return { enviada: true };
}

// E-mail dos auditores: a fatura/carteira muitas vezes guarda so o NOME. Monta nome -> e-mail
// pelo e-mail mais frequente entre faturas, carteiras e historico (onde o usuario assinou).
export const normalizarNomeAuditor = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

export async function carregarEmailsAuditores(db) {
  const contagem = new Map();
  const somar = (nome, email) => {
    const n = normalizarNomeAuditor(nome);
    const e = String(email || '').trim().toLowerCase();
    if (!n || !e.includes('@')) return;
    const porEmail = contagem.get(n) || new Map();
    porEmail.set(e, (porEmail.get(e) || 0) + 1);
    contagem.set(n, porEmail);
  };
  const ler = async (tabela, colunas, nomeCol, emailCol) => {
    try {
      const { data } = await db.from(tabela).select(colunas).neq(emailCol, '').not(emailCol, 'is', null).limit(5000);
      (data || []).forEach((r) => somar(r[nomeCol], r[emailCol]));
    } catch { /* sem essa fonte */ }
  };
  await Promise.all([
    ler('faturas', 'auditor_nome,auditor_email', 'auditor_nome', 'auditor_email'),
    ler('auditoria_carteiras', 'auditor_nome,auditor_email', 'auditor_nome', 'auditor_email'),
    ler('auditoria_fatura_historico', 'usuario_nome,usuario_email', 'usuario_nome', 'usuario_email'),
  ]);
  const mapa = new Map();
  contagem.forEach((porEmail, nome) => {
    mapa.set(nome, [...porEmail.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  });
  return mapa;
}

export function emailDoAuditor(fatura, mapa) {
  return String(fatura?.auditor_email || '').trim() || mapa?.get(normalizarNomeAuditor(fatura?.auditor_nome)) || '';
}

// Analisa UMA fatura do inicio ao fim: apura, decide, envia para a gestao se correta e devolve o
// registro pronto para gravar em auditor_robo_execucoes. Usado pelo robo na nuvem e pelo botao.
// anterior = registro anterior da fatura (reavaliacao), para manter/zerar a aprovacao do auditor.
export async function analisarFaturaRobo(db, f, { cfg = {}, emailsAuditores = new Map(), usuario = 'Robo (automatico)', origem = 'automatico', anterior = null, aoProgredir = () => {}, prazoFinal = 0, calcular = true, recalcularTudo = false, bloco = 100, limiteBlocoMs = 0, pesoMaisProximo = true } = {}) {
  // Ja tem partida/lancamento (ou ja foi paga): o financeiro ja tratou por fora. O robo nao envia nada (gestao/laudo):
  // sai das listas direto ("Tratadas fora do robo", ou concluida se paga). Guarda o que o robo teria encontrado
  // (desconto, sem calculo, entrega) para medir o que esta passando por fora: fatura nova e apurada so para
  // registro; com analise anterior, mantem a decisao/motivo/desconto anteriores.
  if (faturaPaga(f) || faturaLancadaErp(f)) {
    const agora = new Date().toISOString();
    const doc = [f.partida ? `partida ${f.partida}` : '', f.lancamento_financeiro ? `lancamento ${f.lancamento_financeiro}` : ''].filter(Boolean).join(', ');
    const aviso = `Ja ${faturaPaga(f) ? 'paga' : 'lancada no financeiro'} ao analisar${doc ? ` (${doc})` : ''}: tratada por fora do robo.`;
    let decisao = anterior?.decisao;
    let motivoRobo = anterior?.motivo || '';
    let descontar = Number(anterior?.valor_descontar || 0);
    if (!anterior) {
      const resumo = await apurarFaturaRobo(f, aoProgredir, { prazoFinal, calcular, recalcularTudo, bloco, limiteBlocoMs, pesoMaisProximo });
      const c = classificarFatura(resumo, Boolean(f.auditoria_considerar_menor));
      decisao = c.decisao; motivoRobo = c.motivo; descontar = c.descontar;
    }
    const registro = {
      fatura_id: String(f.id), numero_fatura: f.numero_fatura, transportadora: f.transportadora,
      modo: 'TRATADA_FORA', decisao: decisao || DECISAO.REVISAO_AUDITOR,
      motivo: `${aviso}${motivoRobo ? ` Robo: ${String(motivoRobo).replace(/^Ja (paga|lancada no financeiro)[^:]*: tratada por fora do robo\.\s*(Robo:\s*)?/, '')}` : ''}`,
      valor_fatura: Number(f.valor_fatura || 0), valor_descontar: descontar,
      auditor_nome: f.auditor_nome || '', auditor_email: emailDoAuditor(f, emailsAuditores),
      destinatarios: '', copia: '', acao_executada: true, executado_por: usuario, executado_em: agora,
    };
    if (anterior) { registro.reavaliado_em = agora; registro.tentativas = Number(anterior.tentativas || 1) + 1; }
    return registro;
  }
  const resumo = await apurarFaturaRobo(f, aoProgredir, { prazoFinal, calcular, recalcularTudo, bloco, limiteBlocoMs, pesoMaisProximo });
  const c = aguardarOperacaoLotacao(classificarFatura(resumo, Boolean(f.auditoria_considerar_menor)), resumo);
  let enviada = false;
  let motivo = c.motivo;
  if (!calcular && c.decisao === DECISAO.REVISAO_AUDITOR && resumo.semCalculo > 0) {
    motivo += ' Calculo pendente: o robo online nao calcula CT-es; rode "Executar agora" na tela do robo ou abra a fatura.';
  }
  if (c.decisao === DECISAO.ENVIAR_APROVACAO) {
    const r = await enviarFaturaParaGestaoRobo(db, f, resumo, { origem });
    enviada = r.enviada;
    motivo = r.enviada ? `${c.motivo} Enviada para aprovacao da gestao (via robo).` : `${c.motivo} ${r.motivo}`;
  }
  const auditorEmail = emailDoAuditor(f, emailsAuditores);
  const para = c.decisao === DECISAO.ENVIAR_LAUDO ? cfg.emails_transportadora
    : c.decisao === DECISAO.ENVIAR_APROVACAO ? cfg.email_aprovacao : auditorEmail;
  const agora = new Date().toISOString();
  const registro = {
    fatura_id: String(f.id), numero_fatura: f.numero_fatura, transportadora: f.transportadora,
    modo: enviada ? 'GESTAO' : 'SOMBRA', decisao: c.decisao, motivo,
    valor_fatura: Number(f.valor_fatura || 0), valor_descontar: c.descontar,
    auditor_nome: f.auditor_nome || '', auditor_email: auditorEmail,
    destinatarios: para || '', copia: c.decisao === DECISAO.REVISAO_AUDITOR ? '' : auditorEmail,
    acao_executada: enviada, executado_por: usuario, executado_em: agora,
  };
  if (anterior) {
    registro.reavaliado_em = agora;
    registro.tentativas = Number(anterior.tentativas || 1) + 1;
    // Laudo aprovado so vale para o mesmo valor: se mudou (ou deixou de ter desconto), volta a pedir OK.
    const mesmoValor = c.decisao === DECISAO.ENVIAR_LAUDO && Math.abs(Number(anterior.valor_descontar || 0) - c.descontar) < 0.01;
    if (!mesmoValor) { registro.aprovado_auditor_em = null; registro.aprovado_auditor_por = null; }
  }
  return registro;
}

// Primeira auditoria e reavaliacao com "usar o maior peso" (padrao): CT-e a CT-e, fica o calculo de maior peso
// (CT-e x Tracking cubado), ignorando o Tracking quando o peso e suspeito (muito acima do CT-e).
// Registra os dois valores no detalhe do calculo para conferencia.
function escolherPesoMaisProximo(registrosCte = [], registrosTracking = []) {
  const porChave = new Map(registrosTracking.map((r) => [normalizarChaveCte(r.chave_cte), r]));
  return registrosCte.map((r) => escolherMaiorPeso(r, porChave.get(normalizarChaveCte(r.chave_cte))).registro);
}
