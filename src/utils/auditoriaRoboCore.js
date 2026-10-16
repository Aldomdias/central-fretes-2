// Nucleo do Robo Auditor: apura uma fatura (calculo dos CT-es, valor a descontar, entrega) e
// decide o que fazer. Roda no navegador E na nuvem (api/robo-auditor.js, via bundle
// api/_robo-core.mjs gerado por scripts/build-robo-core.cjs).
//
// ATENCAO: a apuracao espelha resumirFaturasExato da tela de Auditoria
// (CentralAuditoriaFretesPage.jsx). Nao toca naquela tela; se a regra de la mudar, ajustar aqui.
import { carregarDetalhesFaturaSupabase } from '../services/lotacaoSupabaseService';
import { buscarReferenciaCtes, vincularChavesDetalhesPorNumero } from '../services/auditoriaFretesService';
import { carregarSaldosAutorizadosPorChave } from '../services/transporteAutorizacoesService';
import { buscarStatusEntregaCtes, chaveEntregaRegistro, STATUS_ENTREGA } from '../services/auditoriaEntregaCteService';
import { processarCtesPorChave } from '../services/auditoriaCteProcessamentoService';
import { salvarRecorteCarregadoAuditoria } from '../services/auditoriaService';
import { normalizarChaveCte } from './auditoriaFretesDomain';
import { classificarFatura, DECISAO, STATUS_ROBO_AUDITA, ROBO_DATA_INICIO, dataInicioRobo, dataEntradaFatura } from '../services/auditorRoboService';

export { classificarFatura, DECISAO, STATUS_ROBO_AUDITA, ROBO_DATA_INICIO, dataInicioRobo, dataEntradaFatura };

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

// So o que importa para valor/calculo (a tela tambem mescla peso, NF, rota etc.).
function mesclar(item, referencia) {
  const base = referencia.get(normalizarChaveCte(item.chave_cte)) || referencia.get(normalizarChaveCte(item.numero_cte));
  if (!base) return item;
  const valor = Number(item.valor_frete || base.valor_cte || 0);
  const amd = Number(base.valor_calculado || 0);
  const diferenca = amd > 0 ? Number((valor - amd).toFixed(2)) : Number(item.diferenca || 0);
  return { ...item, valor_frete: valor, calculado_frete: amd, diferenca, motivo_sem_calculo: base.motivo_sem_calculo || '', status: amd > 0 ? (Math.abs(diferenca) <= 0.01 ? 'OK' : 'DIVERGENTE') : (item.status || 'SEM_CALCULO') };
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
      || (normalizarChaveCte(i.chave_cte).length !== 44 ? 'CT-e sem chave: nao localizado na base por numero/CNPJ' : 'sem resultado de calculo na base');
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

// Calcula (se faltar) e resume a fatura. Retorna o resumo no formato esperado por classificarFatura.
// prazoFinal (timestamp ms, opcional): na nuvem a funcao tem limite de tempo. Calcula os CT-es em
// blocos pequenos, gravando cada bloco; se o prazo acabar, lanca '__parcial__' e a proxima
// execucao continua do que ainda falta (o que ja foi calculado fica salvo).
// calcular=false (nuvem): nao dispara o calculo dos CT-es, que carrega a base de rotas inteira e estoura o
// limite da funcao; so apura o que ja esta calculado (navegador, auditor abrindo a fatura, importacao).
// recalcularTudo (reavaliacao manual): refaz o calculo de TODOS os CT-es da fatura, e nao so dos que estavam sem
// resultado; so fica "sem calculo" o que realmente der erro no calculo.
export async function apurarFaturaRobo(fatura, aoProgredir = () => {}, { prazoFinal = 0, calcular = true, recalcularTudo = false, bloco = 25, limiteBlocoMs = 0 } = {}) {
  // Blocos pequenos: cada bloco e calculado E GRAVADO, o andamento aparece na tela e, se a pagina
  // for fechada no meio, o que ja foi calculado fica salvo. Na nuvem (limiteBlocoMs) um bloco que demora
  // demais e abandonado: os CT-es dele ficam "sem calculo (demorou demais)" e o robo segue.
  const BLOCO = bloco;
  aoProgredir({ fase: 'lendo' });
  let lista = await detalhesExatos(fatura);
  let calculou = false;
  let erroCalculo = '';
  let falhasCalculo = 0;
  const precisaCalcular = (i) => recalcularTudo || !(Number(i.calculado_frete || 0) > 0);
  if (calcular && lista.length && lista.some(precisaCalcular)) {
    const chaves = [...new Set(lista.filter(precisaCalcular).map((i) => normalizarChaveCte(i.chave_cte)).filter((c) => c.length === 44))];
    for (let i = 0; i < chaves.length; i += BLOCO) {
      if (prazoFinal && Date.now() > prazoFinal) throw new Error('__parcial__');
      aoProgredir({ fase: 'calculando', atual: Math.min(i + BLOCO, chaves.length), total: chaves.length });
      try {
        const calculo = processarCtesPorChave(chaves.slice(i, i + BLOCO), () => {}, { ignorarCubagem: true });
        const { registros } = limiteBlocoMs
          ? await Promise.race([calculo, new Promise((_, rej) => { setTimeout(() => rej(new Error(`demorou demais (>${Math.round(limiteBlocoMs / 1000)}s)`)), limiteBlocoMs); })])
          : await calculo;
        if (registros.length) {
          const competencia = registros.find((r) => r.competencia)?.competencia || new Date().toISOString().slice(0, 7);
          await salvarRecorteCarregadoAuditoria({ competencia, registros });
          calculou = true;
        }
      } catch (e) {
        // Um bloco com erro nao derruba a fatura: os CT-es dele ficam "sem calculo" e os demais seguem.
        falhasCalculo += Math.min(BLOCO, chaves.length - i);
        erroCalculo = erroCalculo || String(e?.message || e).slice(0, 140);
      }
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
  } catch { /* entrega nao verificada: classificarFatura manda para o auditor */ }
  return { ...r, entregues, pendentes, erroCalculo, falhasCalculo };
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
export async function analisarFaturaRobo(db, f, { cfg = {}, emailsAuditores = new Map(), usuario = 'Robo (automatico)', origem = 'automatico', anterior = null, aoProgredir = () => {}, prazoFinal = 0, calcular = true, recalcularTudo = false, bloco = 25, limiteBlocoMs = 0 } = {}) {
  const resumo = await apurarFaturaRobo(f, aoProgredir, { prazoFinal, calcular, recalcularTudo, bloco, limiteBlocoMs });
  const c = classificarFatura(resumo, Boolean(f.auditoria_considerar_menor));
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
