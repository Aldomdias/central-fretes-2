/**
 * Robo identificador de faturas (automatico, na nuvem).
 *
 * GET /api/robo-faturas-ausentes — cron da Vercel de toda hora cheia (vercel.json). Quem decide se roda naquela hora
 * e a configuracao da tela (Automacao > Robo identificador de faturas: tabela robo_faturas_config).
 * ?agora=1 ignora horario/dia (botao "Rodar agora"); ?simular=1 nunca envia e-mail (so registra o resultado).
 *
 * Para cada transportadora cadastrada pelos auditores (robo_faturas_transportadoras):
 *  1) conta as faturas recebidas no periodo de faturamento (semanal = 7 dias, quinzenal = 15, mensal = 30);
 *  2) conta os CT-es emitidos nos ultimos 30 dias (ate o inicio do periodo corrente) SEM fatura vinculada;
 *  3) se nao veio fatura no periodo, ou se ha CT-es sem fatura, avisa o transportador por e-mail
 *     (copia: auditor da carteira, copia cadastrada e o grupo padrao da auditoria).
 * Regras de seguranca: destinatarios vem sempre do banco; so envia com "enviar_emails" ligado na configuracao;
 * nao reenvia para a mesma transportadora em menos de 3 dias. Tudo e registrado em robo_faturas_execucoes.
 * Variaveis: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY + ALERTA_EMAIL_FROM (ou ALERTA_EMAIL_TOKEN), CRON_SECRET (opcional).
 */
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

export const config = { maxDuration: 300 };

const DIAS_PERIODO = { SEMANAL: 7, QUINZENAL: 15, MENSAL: 30 };
const ROTULO_PERIODO = { SEMANAL: 'semanal', QUINZENAL: 'quinzenal', MENSAL: 'mensal' };
const DIAS_SEM_REENVIO = 3;
const norm = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const emailsDe = (texto) => [...new Set(String(texto || '').split(/[;,\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
const digitos = (v) => String(v ?? '').replace(/\D+/g, '');
const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-');
const escapar = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const isoDia = (d) => d.toISOString().slice(0, 10);
const somarDias = (iso, dias) => isoDia(new Date(new Date(`${iso}T12:00:00Z`).getTime() + dias * 86400000));

async function paginar(consulta) {
  const todos = [];
  for (let de = 0; de < 200000; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw new Error(error.message);
    todos.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return todos;
}

// Numero de CT-e sem zeros a esquerda ("000373998" = "373998").
const numeroCte = (v) => digitos(v).replace(/^0+/, '');

// CT-es que ja estao em alguma fatura (fatura_detalhes). Para NAO cobrar o transportador por CT-e que ja tem fatura:
// confere pela chave E pelo numero (a fatura pode ter vindo so com o numero, sem a chave); o numero so vale para
// a mesma transportadora (ou detalhe sem transportadora), porque o mesmo numero se repete entre transportadoras.
// Retorna chaves "c:<chave>" e "n:<numero>".
async function idsComFatura(db, ctes, nomesTransportadora) {
  const chaves = [...new Set(ctes.map((c) => digitos(c.chave_cte)).filter(Boolean))];
  const numeros = [...new Set(ctes.map((c) => numeroCte(c.numero_cte)).filter(Boolean))];
  const achados = new Set();
  const consultar = async (coluna, lista, aoAchar, semChave = false) => {
    const lotes = [];
    for (let i = 0; i < lista.length; i += 100) lotes.push(lista.slice(i, i + 100));
    for (let i = 0; i < lotes.length; i += 5) {
      const respostas = await Promise.all(lotes.slice(i, i + 5).map(async (lote) => {
        const consulta = () => { const q = db.from('fatura_detalhes').select('fatura_id,chave_cte,numero_cte,transportadora').in(coluna, lote); return semChave ? q.eq('chave_cte', '') : q; };
        const r = await consulta();
        return r.error ? consulta() : r; // uma nova tentativa antes de desistir
      }));
      respostas.forEach(({ data, error }) => {
        if (error) throw new Error(`fatura_detalhes: ${error.message}`);
        (data || []).forEach(aoAchar);
      });
    }
  };
  await consultar('chave_cte', chaves, (d) => { const c = digitos(d.chave_cte); if (c) achados.add(`c:${c}`); });
  // O numero na fatura pode ter zeros a esquerda: busca as duas formas. Fatura importada so com o numero fica
  // "sem localizar o CT-e" (sem chave), mas o CT-e ja esta nela: conta como vinculado. A transportadora da linha
  // pode vir com outro nome; vale tambem a transportadora da FATURA a que a linha pertence.
  const porNumero = [];
  await consultar('numero_cte', [...new Set([...numeros, ...ctes.map((c) => digitos(c.numero_cte)).filter(Boolean)])], (d) => { porNumero.push(d); }, true);
  const idsFat = [...new Set(porNumero.map((d) => d.fatura_id).filter(Boolean))];
  const transpDaFatura = new Map();
  for (let i = 0; i < idsFat.length; i += 100) {
    const { data, error } = await db.from('faturas').select('id,transportadora').in('id', idsFat.slice(i, i + 100));
    if (error) throw new Error(`faturas: ${error.message}`);
    (data || []).forEach((f) => transpDaFatura.set(String(f.id), norm(f.transportadora)));
  }
  porNumero.forEach((d) => {
    const n = numeroCte(d.numero_cte);
    const nomeDetalhe = norm(d.transportadora);
    const nomeFatura = transpDaFatura.get(String(d.fatura_id)) || '';
    if (n && (!nomeDetalhe || nomesTransportadora.has(nomeDetalhe) || nomesTransportadora.has(nomeFatura))) achados.add(`n:${n}`);
  });
  return achados;
}

function montarEmail({ cfg, periodo, faturasPeriodo, ctes, valor, janelaDias, hoje }) {
  const rotulo = ROTULO_PERIODO[cfg.periodicidade] || 'semanal';
  const semFaturaNoPeriodo = faturasPeriodo.length === 0;
  const assunto = semFaturaNoPeriodo
    ? `[Cantu] Faturas pendentes de envio - ${cfg.transportadora}`
    : `[Cantu] Confirmar faturas - ${ctes.length} CT-e(s) sem fatura vinculada - ${cfg.transportadora}`;
  const linhas = ctes.slice(0, 40).map((c) => `<tr><td>${escapar(c.numero_cte || '-')}</td><td>${dataBr(c.data_emissao)}</td><td style="text-align:right">${dinheiro(c.valor_cte)}</td></tr>`).join('');
  const abertura = semFaturaNoPeriodo
    ? `<p>Seu faturamento está cadastrado conosco como <b>${rotulo}</b> e, no período de <b>${dataBr(periodo.inicio)}</b> a <b>${dataBr(periodo.fim)}</b>, <b>não identificamos nenhuma fatura emitida</b> por vocês.</p>`
    : `<p>Seu faturamento está cadastrado conosco como <b>${rotulo}</b>. No período de <b>${dataBr(periodo.inicio)}</b> a <b>${dataBr(periodo.fim)}</b> recebemos a(s) fatura(s): <b>${escapar(faturasPeriodo.map((f) => f.numero_fatura).filter(Boolean).join(', ') || '-')}</b>.<br>Por favor, <b>confirmem se não falta nenhuma</b>, pois identificamos CT-e(s) ainda sem fatura vinculada.</p>`;
  const bloco = ctes.length
    ? `<p>Levantamos <b>${ctes.length} CT-e(s)</b> emitidos nos últimos ${janelaDias} dias (até ${dataBr(periodo.limiteCte)}) <b>sem fatura vinculada</b>, totalizando <b>${dinheiro(valor)}</b>${ctes.length > 40 ? ` (primeiros 40 abaixo)` : ' (lista abaixo)'}:</p>
<table border="1" cellpadding="5" cellspacing="0" style="border-collapse:collapse;font-size:13px"><thead><tr style="background:#f1f5f9"><th>CT-e</th><th>Emissão</th><th>Valor</th></tr></thead><tbody>${linhas}</tbody></table>`
    : '';
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a">
<p>Prezados,</p>
${abertura}
${bloco}
<p>Segue em anexo a planilha com <b>duas abas</b>: <i>Faturas do período</i> (as faturas que recebemos) e <i>CT-es sem fatura</i> (com a chave completa de cada CT-e), para a conferência.</p>
<p><b>É obrigatório o envio das faturas correspondentes</b> para que possamos seguir com os pagamentos. Caso contrário, teremos problemas de pagamento.</p>
<p>Em caso de dúvida ou se alguma fatura já foi enviada, responda este e-mail informando o número da fatura.</p>
<p style="color:#64748b;font-size:12px">Mensagem automática da Auditoria de Fretes (${dataBr(hoje)}).</p></div>`;
  // Planilha organizada: chave do CT-e como TEXTO (44 digitos; o Excel arredondaria como numero), data real e valor numerico.
  const cabecalho = ['Número do CT-e', 'Chave do CT-e', 'Data de emissão', 'Valor do CT-e (R$)', 'Dias desde a emissão'];
  const dados = ctes.map((c) => [String(c.numero_cte || ''), digitos(c.chave_cte) || String(c.chave_cte || ''), dataBr(c.data_emissao),
    Number(c.valor_cte || 0), Math.floor((new Date(`${hoje}T12:00:00Z`) - new Date(`${String(c.data_emissao).slice(0, 10)}T12:00:00Z`)) / 86400000)]);
  const ws = XLSX.utils.aoa_to_sheet([cabecalho, ...dados]);
  dados.forEach((_, i) => {
    ['A', 'B'].forEach((col) => { const cel = ws[`${col}${i + 2}`]; if (cel) { cel.t = 's'; cel.z = '@'; } });
    const v = ws[`D${i + 2}`]; if (v) v.z = '#,##0.00';
  });
  ws['!cols'] = [{ wch: 16 }, { wch: 48 }, { wch: 16 }, { wch: 20 }, { wch: 20 }];
  ws['!autofilter'] = { ref: `A1:E${dados.length + 1}` };
  const wb = XLSX.utils.book_new();
  // Aba 1: faturas recebidas no periodo (para o transportador conferir se falta alguma). Aba 2: CT-es sem fatura.
  const cabFat = ['Número da fatura', 'Série', 'Data de emissão', 'Recebida em', 'Vencimento', 'Valor da fatura (R$)'];
  const dadosFat = faturasPeriodo.map((f) => [String(f.numero_fatura || ''), String(f.serie_fatura || ''), dataBr(f.data_emissao), dataBr(f.created_at), dataBr(f.data_vencimento), Number(f.valor_fatura || 0)]);
  const wsFat = XLSX.utils.aoa_to_sheet([cabFat, ...(dadosFat.length ? dadosFat : [['Nenhuma fatura recebida no período', '', '', '', '', '']])]);
  dadosFat.forEach((_, i) => { const c = wsFat[`A${i + 2}`]; if (c) { c.t = 's'; c.z = '@'; } const v = wsFat[`F${i + 2}`]; if (v) v.z = '#,##0.00'; });
  wsFat['!cols'] = [{ wch: 22 }, { wch: 8 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, wsFat, 'Faturas do período');
  XLSX.utils.book_append_sheet(wb, ws, 'CT-es sem fatura');
  const xlsx = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  return { assunto, html, xlsx };
}

async function enviarEmail({ para, copia, assunto, html, anexoCsv }) {
  const anexos = anexoCsv ? [{ filename: anexoCsv.nome, content: anexoCsv.conteudo }] : [];
  let resposta;
  if (process.env.RESEND_API_KEY) {
    resposta = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.ALERTA_EMAIL_FROM || 'Central de Fretes <onboarding@resend.dev>',
        to: para, ...(copia.length ? { cc: copia, reply_to: copia[0] } : {}), subject: assunto, html, ...(anexos.length ? { attachments: anexos } : {}),
      }),
    });
  } else if (process.env.ALERTA_EMAIL_TOKEN) {
    const centralUrl = process.env.CENTRAL_SOLICITACOES_SUPABASE_URL || process.env.VITE_CENTRAL_SOLICITACOES_SUPABASE_URL || 'https://zejguyckbnmyxkuagsyj.supabase.co';
    const centralKey = process.env.CENTRAL_SOLICITACOES_SUPABASE_KEY || process.env.VITE_CENTRAL_SOLICITACOES_SUPABASE_KEY || 'sb_publishable_J0i_Olz3JBp_86-Xcd4MPQ_uH5vnHUS';
    resposta = await fetch(`${centralUrl}/functions/v1/alerta-cte-email`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${centralKey}`, apikey: centralKey, 'x-alerta-token': process.env.ALERTA_EMAIL_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: [...para, ...copia], subject: assunto, html, ...(anexos.length ? { attachments: anexos } : {}) }),
    });
  } else {
    throw new Error('Nenhum provedor de e-mail configurado (RESEND_API_KEY ou ALERTA_EMAIL_TOKEN).');
  }
  if (!resposta.ok) throw new Error(`Provedor de e-mail recusou o envio (${resposta.status}). ${(await resposta.text().catch(() => '')).slice(0, 200)}`);
}

export default async function handler(req, res) {
  const segredo = process.env.CRON_SECRET;
  const manual = /[?&]agora=1\b/.test(String(req.url || ''));
  const simular = /[?&]simular=1\b/.test(String(req.url || ''));
  // Chamada manual (botao da tela) nao leva o segredo do cron; ela so roda com a configuracao do banco e respeita a trava de reenvio.
  if (segredo && !manual && req.headers.authorization !== `Bearer ${segredo}`) return res.status(401).json({ error: 'Nao autorizado.' });
  try {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !chave) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY nao configuradas.');
    const db = createClient(url, chave, { auth: { persistSession: false } });

    let cfgRow = null;
    try { ({ data: cfgRow } = await db.from('robo_faturas_config').select('*').eq('id', 1).maybeSingle()); } catch { cfgRow = null; }
    const cfgRobo = { ativo: true, horas: [8], dias_semana: [2], enviar_emails: false, janela_cte_dias: 30, ...(cfgRow || {}) };
    const brasilia = new Date(Date.now() - 3 * 3600000);
    if (!manual) {
      if (!cfgRobo.ativo) return res.status(200).json({ ok: true, pulou: true, motivo: 'Robo desligado na configuracao.' });
      if (!(cfgRobo.horas || []).includes(brasilia.getUTCHours())) return res.status(200).json({ ok: true, pulou: true, motivo: 'Fora do horario configurado.' });
      if (!(cfgRobo.dias_semana || []).includes(brasilia.getUTCDay())) return res.status(200).json({ ok: true, pulou: true, motivo: 'Dia da semana nao configurado.' });
    }
    const enviarDeVerdade = Boolean(cfgRobo.enviar_emails) && !simular;
    const origem = manual ? 'manual' : 'cron';
    const hoje = isoDia(brasilia);
    const janelaDias = Math.min(Math.max(Number(cfgRobo.janela_cte_dias) || 30, 7), 90);
    const copiaPadrao = emailsDe(process.env.LAUDO_EMAIL_COPIA_PADRAO || 'fatura@corpcantuinc.onmicrosoft.com; aldo.dias@cantu.inc');

    const { data: cadastradas, error: eLista } = await db.from('robo_faturas_transportadoras').select('*').eq('ativo', true);
    if (eLista) throw new Error(`Lista do robo: ${eLista.message}`);
    const lista = (cadastradas || []).filter((t) => !t.nao_cadastrada || t.transportadora);
    if (!lista.length) return res.status(200).json({ ok: true, analisadas: 0, motivo: 'Nenhuma transportadora cadastrada.' });

    const [{ data: vinculos }, { data: carteiras }, { data: robo }, { data: recentes }] = await Promise.all([
      db.from('transportadora_vinculos').select('nome_cte,nome_tabela'),
      db.from('auditoria_carteiras').select('transportadora,auditor_nome,auditor_email'),
      db.from('auditor_robo_transportadoras').select('transportadora,emails_transportadora'),
      db.from('robo_faturas_execucoes').select('transportadora_id,executado_em').eq('email_enviado', true).gte('executado_em', new Date(Date.now() - DIAS_SEM_REENVIO * 86400000).toISOString()),
    ]);
    const enviadoRecente = new Set((recentes || []).map((r) => String(r.transportadora_id)));

    const inicioFaturas = somarDias(hoje, -60);
    const faturasRecentes = await paginar((de, ate) => db.from('faturas').select('id,transportadora,numero_fatura,serie_fatura,data_emissao,data_vencimento,valor_fatura,status,created_at')
      .gte('created_at', `${inicioFaturas}T00:00:00Z`).order('created_at', { ascending: false }).order('id').range(de, ate));

    const resultados = [];
    for (const t of lista) {
      const registro = { transportadora_id: t.id, transportadora: t.transportadora, periodicidade: t.periodicidade, origem, email_enviado: false };
      try {
        const diasPeriodo = DIAS_PERIODO[t.periodicidade] || 7;
        const periodo = { inicio: somarDias(hoje, -diasPeriodo), fim: hoje, limiteCte: somarDias(hoje, -diasPeriodo) };
        const nome = norm(t.transportadora);
        // Fatura do periodo = emitida OU recebida (entrada na Central) dentro dele.
        const faturasPeriodo = faturasRecentes.filter((f) => norm(f.transportadora) === nome
          && (String(f.data_emissao || '').slice(0, 10) >= periodo.inicio || String(f.created_at || '').slice(0, 10) >= periodo.inicio));
        const variantes = [...new Set([t.transportadora, ...(vinculos || []).filter((v) => norm(v.nome_tabela) === nome).map((v) => v.nome_cte)].filter(Boolean))];
        const inicioCte = somarDias(hoje, -janelaDias);
        const ctesPeriodo = await paginar((de, ate) => db.from('auditoria_cte_resultados').select('id,chave_cte,numero_cte,data_emissao,valor_cte')
          .in('transportadora', variantes).gte('data_emissao', inicioCte).lte('data_emissao', periodo.limiteCte).order('data_emissao').order('id').range(de, ate));
        const comFatura = await idsComFatura(db, ctesPeriodo, new Set(variantes.map(norm)));
        const ctes = ctesPeriodo.filter((c) => !comFatura.has(`c:${digitos(c.chave_cte)}`) && !comFatura.has(`n:${numeroCte(c.numero_cte)}`));
        const valor = ctes.reduce((s, c) => s + Number(c.valor_cte || 0), 0);
        Object.assign(registro, {
          periodo_inicio: periodo.inicio, periodo_fim: periodo.fim, faturas_no_periodo: faturasPeriodo.length,
          numeros_faturas: faturasPeriodo.map((f) => f.numero_fatura).filter(Boolean).join(', ').slice(0, 500),
          ctes_sem_fatura: ctes.length, valor_sem_fatura: valor, cte_mais_antigo: ctes[0]?.data_emissao || null,
        });
        const jaVinculados = ctesPeriodo.length - ctes.length;
        if (jaVinculados > 0) registro.observacao = `${jaVinculados} CT-e(s) do periodo ja estavam em fatura (conferidos por chave e numero) e ficaram fora do aviso.`;
        const semFatura = faturasPeriodo.length === 0;
        registro.situacao = semFatura ? (ctes.length || ctesPeriodo.length ? 'SEM_FATURA_NO_PERIODO' : 'SEM_CTES') : (ctes.length ? 'CONFERIR_CTES' : 'OK');
        // Sem fatura no periodo e sem nenhum CT-e para faturar: nada a cobrar.
        if (registro.situacao === 'SEM_CTES' || registro.situacao === 'OK') { resultados.push(registro); continue; }

        const auditor = (carteiras || []).find((c) => norm(c.transportadora) === nome);
        const para = emailsDe(t.emails_transportadora || (robo || []).find((r) => norm(r.transportadora) === nome)?.emails_transportadora);
        const copia = [...new Set([...emailsDe(t.auditor_email || auditor?.auditor_email), ...emailsDe(t.emails_copia), ...copiaPadrao])].filter((e) => !para.includes(e));
        registro.destinatarios = para.join('; ');
        registro.copia = copia.join('; ');
        if (!para.length) { registro.observacao = 'Sem e-mail do transportador cadastrado (preencha na tela do robo ou no Robo Auditor).'; resultados.push(registro); continue; }
        if (!enviarDeVerdade) { registro.observacao = simular ? 'Simulacao: e-mail nao enviado.' : 'Envio de e-mails desligado na configuracao (modo sombra).'; resultados.push(registro); continue; }
        if (enviadoRecente.has(String(t.id))) { registro.observacao = `Ja avisado nos ultimos ${DIAS_SEM_REENVIO} dias.`; resultados.push(registro); continue; }
        const { assunto, html, xlsx } = montarEmail({ cfg: t, periodo, faturasPeriodo, ctes, valor, janelaDias, hoje });
        await enviarEmail({ para, copia, assunto, html, anexoCsv: { nome: `conferencia-faturas-${hoje}.xlsx`, conteudo: xlsx } });
        registro.email_enviado = true;
        resultados.push(registro);
      } catch (e) {
        registro.situacao = 'ERRO';
        registro.observacao = String(e.message || e).slice(0, 300);
        resultados.push(registro);
      }
    }
    if (resultados.length) {
      const { error } = await db.from('robo_faturas_execucoes').insert(resultados);
      if (error) console.warn('[robo-faturas-ausentes] historico nao gravado:', error.message);
    }
    return res.status(200).json({
      ok: true, origem, simulado: !enviarDeVerdade, analisadas: resultados.length,
      emailsEnviados: resultados.filter((r) => r.email_enviado).length, erros: resultados.filter((r) => r.situacao === 'ERRO').length,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}
