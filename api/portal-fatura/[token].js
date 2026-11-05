/**
 * Portal de confirmacao de fatura pelo fornecedor/transportador.
 *
 * Mesma razao de ser do api/portal/[token].js (CT-es): funcao serverless com
 * a service_role no servidor, pra transportadora nao ter acesso ao app nem
 * a dados de outras transportadoras — so ve o resumo desta fatura.
 *
 * GET  /api/portal-fatura/<token>  -> pagina de confirmacao
 * POST /api/portal-fatura/<token>  -> transportador clicou "OK" -> aplica
 *                                      direto na fatura (sem validacao manual
 *                                      do auditor, diferente do portal de CT-es).
 */
import { createClient } from '@supabase/supabase-js';

function getClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error('Portal indisponível: variáveis SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configuradas.');
  }
  return createClient(url, serviceRole, { auth: { persistSession: false } });
}

function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function dinheiro(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dataBr(valor) {
  if (!valor) return '-';
  const [ano, mes, dia] = String(valor).slice(0, 10).split('-');
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : String(valor);
}

async function carregarDivergencias(supabase, faturaId) {
  try {
    const { data } = await supabase.from('fatura_cte_divergencias').select('*').eq('fatura_id', faturaId).order('numero_cte');
    return data || [];
  } catch { return []; }
}

const soDigitos = (v) => String(v || '').replace(/\D/g, '');

const FORMAS_COBRANCA = {
  BOLETO: 'Boleto — vou emitir um NOVO BOLETO com o valor atualizado da fatura',
  PIX: 'Pix ou depósito (sem boleto) — a cobrança segue pelo valor atualizado da fatura',
};

// CT-es sem vinculo de NF apontados pelo Robo Auditor (auditor_robo_execucoes.ctes_sem_nf) + respostas ja dadas.
async function carregarSemNf(supabase, faturaId) {
  let lista = [];
  let respostas = [];
  let retiradas = [];
  try {
    const { data } = await supabase.from('auditor_robo_execucoes').select('ctes_sem_nf').eq('fatura_id', String(faturaId)).maybeSingle();
    lista = Array.isArray(data?.ctes_sem_nf) ? data.ctes_sem_nf : [];
  } catch { lista = []; }
  try {
    const { data } = await supabase.from('fatura_cte_sem_nf_respostas').select('*').eq('fatura_id', String(faturaId));
    respostas = data || [];
  } catch { respostas = []; }
  try {
    const { data } = await supabase.from('fatura_cte_retiradas').select('chave, chave_cte, numero_cte, valor_cte, motivo, justificativa, retirado_por, retirado_em')
      .eq('fatura_id', String(faturaId)).is('restaurado_em', null).order('retirado_em', { ascending: false });
    retiradas = data || [];
  } catch { retiradas = []; }
  const porChave = new Map(respostas.map((r) => [soDigitos(r.chave_cte), r]));
  const itens = lista
    .map((c) => ({ ...c, chave_cte: soDigitos(c.chave_cte), resposta: porChave.get(soDigitos(c.chave_cte)) || null }))
    .filter((c) => c.chave_cte);
  // Justificativas ja resolvidas (sairam da lista do robo) continuam aparecendo como "resposta registrada".
  const naLista = new Set(itens.map((c) => c.chave_cte));
  respostas.filter((r) => r.resposta !== 'RETIRAR' && !naLista.has(soDigitos(r.chave_cte))).forEach((r) => {
    itens.push({ chave_cte: soDigitos(r.chave_cte), numero_cte: r.numero_cte, valor_frete: r.valor_cte, resposta: r });
  });
  // Sem resposta ou com resposta rejeitada pela auditoria: a transportadora ainda precisa responder.
  const pendentes = itens.filter((c) => !c.resposta || c.resposta.status_validacao === 'REJEITADO');
  return { itens, pendentes, respostas, retiradas };
}

function blocoRetiradas(retiradas, fatura) {
  if (!retiradas.length) return '';
  const total = retiradas.reduce((a, r) => a + Number(r.valor_cte || 0), 0);
  return `<div class="inativos" id="ctes-inativados"><strong>🚫 ${retiradas.length} CT-e(s) INATIVADO(S) — retirado(s) desta fatura</strong>
    <p>A fatura passou a valer <b>${dinheiro(fatura.valor_fatura)}</b> (retirado ${dinheiro(total)}). Os CT-es abaixo não serão pagos nesta fatura: emita um CT-e novo com a nota fiscal vinculada e cobre em outra fatura.</p>
    <div class="tw"><table class="ctes"><thead><tr><th>CT-e</th><th>Valor</th><th>Motivo</th><th>Quem / quando</th></tr></thead><tbody>${retiradas.map((r) => `<tr>
      <td><s>${esc(r.numero_cte || String(r.chave || '').slice(-9))}</s> <span class="tag-inativo">INATIVADO</span><div class="ch">${esc(r.chave_cte || r.chave || '')}</div></td>
      <td><s>${dinheiro(r.valor_cte)}</s></td>
      <td>${esc(r.motivo || '-')}<div class="ch">${esc(r.justificativa || '')}</div></td>
      <td>${esc(r.retirado_por || '-')}<div class="ch">${esc(dataBr(r.retirado_em))}</div></td></tr>`).join('')}</tbody></table></div></div>`;
}

function rotuloRespostaSemNf(r) {
  if (!r) return '';
  const st = { APLICADO: 'retirado da fatura', ACEITO: 'justificativa aceita', PENDENTE: 'em análise pela auditoria', REJEITADO: 'justificativa rejeitada pela auditoria' }[r.status_validacao] || r.status_validacao;
  const tipo = { RETIRAR: 'Autorizou retirar', COMPLEMENTAR: `CT-e complementar (original ${r.chave_cte_original || '-'})`, OUTRO: 'Outra justificativa' }[r.resposta] || r.resposta;
  return `${tipo} — ${st}${r.observacao_validacao ? `: ${r.observacao_validacao}` : ''}`;
}

function formSemNf(fatura, semNf) {
  const { itens, pendentes } = semNf;
  if (!itens.length) return '';
  const respondidos = itens.filter((c) => c.resposta && c.resposta.status_validacao !== 'REJEITADO');
  const linhasRespondidas = respondidos.map((c) => `<tr><td><strong>${esc(c.numero_cte || c.chave_cte.slice(-9))}</strong><div class="ch">${esc(c.chave_cte)}</div></td><td>${dinheiro(c.valor_frete)}</td><td>${esc(rotuloRespostaSemNf(c.resposta))}</td></tr>`).join('');
  const linhas = pendentes.map((c, i) => `<tr>
      <td><strong>${esc(c.numero_cte || c.chave_cte.slice(-9))}</strong><div class="ch">${esc(c.chave_cte)}</div>
        <input type="hidden" name="snf_chave_${i}" value="${esc(c.chave_cte)}">
        ${c.resposta?.status_validacao === 'REJEITADO' ? `<div class="rej">Justificativa anterior rejeitada pela auditoria${c.resposta.observacao_validacao ? ': ' + esc(c.resposta.observacao_validacao) : ''}. Responda novamente.</div>` : ''}</td>
      <td>${dinheiro(c.valor_frete)}</td>
      <td>
        <label class="op"><input type="radio" name="snf_resp_${i}" value="RETIRAR" data-valor="${Number(c.valor_frete || 0).toFixed(2)}" onchange="atualizarSnf()"> <b>Retirar da fatura</b> — autorizo inativar este CT-e e vou reemitir com a NF vinculada</label>
        <label class="op"><input type="radio" name="snf_resp_${i}" value="COMPLEMENTAR" onchange="atualizarSnf()"> <b>É CT-e complementar</b> — não tem NF própria; informo a chave do CT-e original:</label>
        <input type="text" class="campo" name="snf_orig_${i}" id="snf_orig_${i}" maxlength="60" inputmode="numeric" placeholder="Chave (44 dígitos) do CT-e original/normal que este CT-e complementa">
        <label class="op"><input type="radio" name="snf_resp_${i}" value="OUTRO" onchange="atualizarSnf()"> <b>Outro motivo</b> — justifico abaixo (ex.: chave da NF-e que consta no CT-e)</label>
        <input type="text" class="campo" name="snf_nfe_${i}" maxlength="60" inputmode="numeric" placeholder="Chave da NF-e vinculada (se houver)">
        <input type="text" class="campo" name="snf_just_${i}" id="snf_just_${i}" maxlength="1000" placeholder="Justificativa (obrigatória em “Outro motivo”)">
      </td></tr>`).join('');
  const valorAtual = Number(fatura.valor_fatura || 0);
  return `<section class="semnf" id="sem-nf">
    <h2>⛔ CT-e(s) sem vínculo com a nota fiscal</h2>
    <p>O CT-e precisa trazer a chave da NF-e dentro dele. Sem isso não podemos pagá-lo. Para cada CT-e abaixo escolha: <b>retirar da fatura</b> ou, se for um <b>CT-e complementar</b>, informe a chave do CT-e original.</p>
    ${linhasRespondidas ? `<div class="tw"><table class="ctes"><thead><tr><th>CT-e</th><th>Valor</th><th>Resposta registrada</th></tr></thead><tbody>${linhasRespondidas}</tbody></table></div>` : ''}
    ${pendentes.length ? `<form method="POST" id="frmSemNf" action="#sem-nf">
      <div class="quem">
        <label for="snf_respondido_por">Quem está respondendo (nome e e-mail)</label>
        <input type="text" id="snf_respondido_por" name="respondido_por" placeholder="Nome — email@transportadora.com.br">
      </div>
      <div class="tw"><table class="ctes"><thead><tr><th>CT-e</th><th>Valor</th><th>Sua resposta</th></tr></thead><tbody>${linhas}</tbody></table></div>
      <div class="cobranca" id="snf_cobranca">
        <strong>Se você autorizar retirar algum CT-e, a fatura muda de valor.</strong>
        <p>Valor atual da fatura: <b>${dinheiro(valorAtual)}</b> · Valor após retirar: <b id="snf_valor_novo" data-atual="${valorAtual.toFixed(2)}">${dinheiro(valorAtual)}</b></p>
        <p>Como esta fatura é cobrada?</p>
        <label class="op"><input type="radio" name="forma_cobranca" value="BOLETO"> ${esc(FORMAS_COBRANCA.BOLETO)}</label>
        <label class="op"><input type="radio" name="forma_cobranca" value="PIX"> ${esc(FORMAS_COBRANCA.PIX)}</label>
        <label class="op ciente"><input type="checkbox" name="ciente" value="1"> Estou ciente de que o(s) CT-e(s) retirado(s) ficam <b>inativados</b> e não serão pagos nesta fatura, que a fatura passa a valer o valor atualizado acima e que, se a cobrança for por boleto, <b>devo emitir um novo boleto</b> (o boleto anterior não será pago).</label>
      </div>
      <input type="hidden" name="acao" value="responder_sem_nf">
      <input type="hidden" name="snf_total" value="${pendentes.length}">
      <button type="submit" onclick="return validarSnf()">Enviar respostas dos CT-es sem NF</button>
    </form>
    <script>
    function fmtBrl(v){return v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
    function atualizarSnf(){var el=document.getElementById('snf_valor_novo');var atual=Number(el.getAttribute('data-atual'));var sai=0;
      document.querySelectorAll('#frmSemNf input[value=RETIRAR]:checked').forEach(function(r){sai+=Number(r.getAttribute('data-valor'))});
      el.textContent=fmtBrl(Math.max(atual-sai,0));document.getElementById('snf_cobranca').className='cobranca'+(sai>0?' ativa':'');}
    function validarSnf(){var q=document.getElementById('snf_respondido_por');if(!q.value.trim()){q.focus();alert('Informe quem está respondendo.');return false}
      var n=Number(document.querySelector('input[name=snf_total]').value);var retirar=false;
      for(var i=0;i<n;i++){var r=document.querySelector('input[name=snf_resp_'+i+']:checked');
        if(!r){alert('Responda todos os CT-es sem NF (falta a linha '+(i+1)+').');return false}
        if(r.value==='RETIRAR')retirar=true;
        if(r.value==='COMPLEMENTAR'&&String(document.getElementById('snf_orig_'+i).value).replace(/\\D/g,'').length!==44){document.getElementById('snf_orig_'+i).focus();alert('Informe a chave (44 dígitos) do CT-e original da linha '+(i+1)+'.');return false}
        if(r.value==='OUTRO'&&!document.getElementById('snf_just_'+i).value.trim()){document.getElementById('snf_just_'+i).focus();alert('Informe a justificativa da linha '+(i+1)+'.');return false}}
      if(retirar){if(!document.querySelector('input[name=forma_cobranca]:checked')){alert('Informe como a fatura é cobrada (boleto ou Pix/depósito).');return false}
        if(!document.querySelector('input[name=ciente]:checked')){alert('Marque a ciência sobre a retirada e o novo boleto.');return false}
        if(!confirm('Confirma a retirada do(s) CT-e(s) marcado(s)? Eles serão inativados nesta fatura.'))return false}
      return true}
    </script>` : '<p class="dica">Todos os CT-es sem NF já foram respondidos.</p>'}
  </section>`;
}

// Retira (inativa) da fatura os CT-es que a transportadora autorizou. Mesma logica da tela da auditoria
// (fatura_cte_retiradas guarda a linha completa para restaurar; fatura_detalhes perde as linhas do CT-e).
async function retirarCtesSemNf(supabase, fatura, itens, { respondidoPor, formaCobranca }) {
  const chaves = new Set(itens.map((c) => c.chave_cte));
  const { data: linhas, error } = await supabase.from('fatura_detalhes').select('*').eq('fatura_id', fatura.id);
  if (error) throw error;
  const saem = (linhas || []).filter((l) => chaves.has(soDigitos(l.chave_cte)));
  const agora = new Date().toISOString();
  const justificativa = `Retirada autorizada pela transportadora no portal da fatura${respondidoPor ? ` (${respondidoPor})` : ''}. Cobrança: ${formaCobranca === 'BOLETO' ? 'novo boleto com o valor atualizado' : 'Pix/depósito pelo valor atualizado'}.`;
  const registros = itens.map((c) => {
    const snap = saem.find((l) => soDigitos(l.chave_cte) === c.chave_cte) || null;
    return {
      fatura_id: String(fatura.id), numero_fatura: fatura.numero_fatura || null, transportadora: fatura.transportadora || null,
      chave: c.chave_cte, chave_cte: c.chave_cte, numero_cte: c.numero_cte || snap?.numero_cte || null,
      valor_cte: Number(c.valor_frete || snap?.valor_frete || 0), motivo: 'CT-e sem vinculo com a NF (retirado pela transportadora)',
      justificativa, snapshot: snap, retirado_por: respondidoPor || 'Portal do transportador', retirado_em: agora,
    };
  });
  // 1) registro primeiro: se falhar, a fatura nao e alterada.
  const { error: eReg } = await supabase.from('fatura_cte_retiradas').insert(registros);
  if (eReg) throw new Error(`Nao foi possivel registrar a retirada: ${eReg.message}`);
  const ids = saem.map((l) => l.id);
  for (let i = 0; i < ids.length; i += 100) {
    const { error: eDel } = await supabase.from('fatura_detalhes').delete().in('id', ids.slice(i, i + 100));
    if (eDel) throw new Error(`Erro ao retirar CT-es da fatura: ${eDel.message}`);
  }
  // 2) numeros da fatura sem os CT-es retirados (calculado = maior calculo das linhas do CT-e, que pode vir duplicado).
  const valorSaida = registros.reduce((a, r) => a + Number(r.valor_cte || 0), 0);
  const calcSaida = [...chaves].reduce((a, ch) => a + Math.max(0, ...saem.filter((l) => soDigitos(l.chave_cte) === ch).map((l) => Number(l.calculado_frete || 0))), 0);
  const descontoSaida = itens.reduce((a, c) => a + Number(c.valor_frete || 0) - Math.max(Number(c.diferenca_incluida || 0), 0), 0);
  const { data: atual } = await supabase.from('faturas').select('*').eq('id', fatura.id).maybeSingle();
  const r2 = (v) => Number(Number(v || 0).toFixed(2));
  const valorNovo = r2(Math.max(Number(atual?.valor_fatura ?? fatura.valor_fatura ?? 0) - valorSaida, 0));
  const calcNovo = r2(Math.max(Number(atual?.valor_calculado || 0) - calcSaida, 0));
  const upd = { valor_fatura: valorNovo, valor_calculado: calcNovo, diferenca: r2(valorNovo - calcNovo), updated_at: agora };
  if (atual && 'ctes_totais' in atual && atual.ctes_totais != null) upd.ctes_totais = Math.max(Number(atual.ctes_totais) - chaves.size, 0);
  if (atual && 'ctes_vinculados' in atual && atual.ctes_vinculados != null) upd.ctes_vinculados = Math.max(Number(atual.ctes_vinculados) - chaves.size, 0);
  if (atual && atual.confirmacao_laudo_calculado != null) upd.confirmacao_laudo_calculado = r2(Math.max(Number(atual.confirmacao_laudo_calculado) - calcSaida, 0));
  if (atual && atual.confirmacao_laudo_desconto != null) upd.confirmacao_laudo_desconto = r2(Math.max(Number(atual.confirmacao_laudo_desconto) - descontoSaida, 0));
  const { error: eFat } = await supabase.from('faturas').update(upd).eq('id', fatura.id);
  if (eFat) throw eFat;
  // 3) divergencias de valor do CT-e retirado nao precisam mais de resposta.
  try {
    const { data: divs } = await supabase.from('fatura_cte_divergencias').select('id, chave').eq('fatura_id', fatura.id);
    const idsDiv = (divs || []).filter((d) => chaves.has(soDigitos(d.chave))).map((d) => d.id);
    if (idsDiv.length) await supabase.from('fatura_cte_divergencias').delete().in('id', idsDiv);
  } catch { /* sem a tabela */ }
  await supabase.from('auditoria_fatura_historico').insert({
    fatura_id: fatura.id, created_at: agora, acao: 'CTE_RETIRADO_DA_FATURA',
    descricao: `${registros.length} CT-e(s) sem vinculo com a NF retirado(s) da fatura pela transportadora no portal${respondidoPor ? ` (${respondidoPor})` : ''}: ${registros.map((r) => `${r.numero_cte || r.chave_cte} (${dinheiro(r.valor_cte)})`).join(', ')}. Valor da fatura: ${dinheiro(atual?.valor_fatura ?? fatura.valor_fatura)} -> ${dinheiro(valorNovo)}. Cobrança: ${formaCobranca === 'BOLETO' ? 'transportadora vai emitir NOVO BOLETO' : 'Pix/depósito pelo valor atualizado'} (ciente).`,
    metadata: { valor_fatura_original: Number(atual?.valor_fatura ?? fatura.valor_fatura ?? 0), valor_fatura_novo: valorNovo, forma_cobranca: formaCobranca, retirados: registros.map((r) => r.numero_cte || r.chave_cte), origem: 'portal_transportador' },
    usuario_nome: respondidoPor || 'Portal do transportador',
  });
  return valorNovo;
}

// Tira da lista do robo os CT-es ja resolvidos (retirados ou com justificativa aceita): o laudo e o desconto
// deixam de cobrar a retirada deles.
async function tirarDaListaSemNf(supabase, faturaId, chaves) {
  if (!chaves.length) return;
  const { data } = await supabase.from('auditor_robo_execucoes').select('ctes_sem_nf').eq('fatura_id', String(faturaId)).maybeSingle();
  const lista = Array.isArray(data?.ctes_sem_nf) ? data.ctes_sem_nf : [];
  const fora = new Set(chaves);
  const resto = lista.filter((c) => !fora.has(soDigitos(c.chave_cte)));
  if (resto.length !== lista.length) await supabase.from('auditor_robo_execucoes').update({ ctes_sem_nf: resto }).eq('fatura_id', String(faturaId));
}

// CT-e complementar: aceito sozinho quando o CT-e original esta na base de CT-es com a chave da NF e foi emitido
// pela mesma transportadora (mesma raiz de CNPJ na chave). Senao fica para o auditor validar.
async function validarComplementarAuto(supabase, chaveComplementar, chaveOriginal) {
  if (chaveOriginal.length !== 44 || chaveOriginal === chaveComplementar) return false;
  if (chaveOriginal.slice(6, 14) !== chaveComplementar.slice(6, 14)) return false;
  try {
    const { data } = await supabase.from('realizado_local_ctes').select('chave_cte, chave_nfe').eq('chave_cte', chaveOriginal).limit(1);
    return Boolean((data || []).find((r) => soDigitos(r.chave_nfe).length === 44));
  } catch { return false; }
}

async function responderSemNf(supabase, fatura, corpo, respondidoPor) {
  const semNf = await carregarSemNf(supabase, fatura.id);
  const porChave = new Map(semNf.pendentes.map((c) => [c.chave_cte, c]));
  const total = Math.min(Number(corpo.snf_total) || 0, semNf.pendentes.length);
  const respostas = [];
  for (let i = 0; i < total; i += 1) {
    const c = porChave.get(soDigitos(corpo[`snf_chave_${i}`]));
    const resposta = corpo[`snf_resp_${i}`];
    if (!c || !['RETIRAR', 'COMPLEMENTAR', 'OUTRO'].includes(resposta)) continue;
    const original = soDigitos(corpo[`snf_orig_${i}`]);
    const nfe = soDigitos(corpo[`snf_nfe_${i}`]);
    const justificativa = String(corpo[`snf_just_${i}`] || '').trim().slice(0, 1000);
    if (resposta === 'COMPLEMENTAR' && original.length !== 44) return { erro: `Informe a chave (44 dígitos) do CT-e original do CT-e ${c.numero_cte || c.chave_cte}.` };
    if (resposta === 'OUTRO' && !justificativa) return { erro: `Informe a justificativa do CT-e ${c.numero_cte || c.chave_cte}.` };
    respostas.push({ c, resposta, original, nfe, justificativa });
  }
  if (!respostas.length || respostas.length < semNf.pendentes.length) return { erro: 'Responda todos os CT-es sem NF e volte para tentar novamente.' };
  const retirar = respostas.filter((r) => r.resposta === 'RETIRAR');
  const formaCobranca = ['BOLETO', 'PIX'].includes(corpo.forma_cobranca) ? corpo.forma_cobranca : null;
  if (retirar.length && (!formaCobranca || !corpo.ciente)) return { erro: 'Para retirar CT-e da fatura, informe como a fatura é cobrada (boleto ou Pix/depósito) e marque a ciência do novo boleto.' };
  if (fatura.confirmacao_transportador_status === 'APROVADO' && retirar.length) return { erro: 'Esta fatura já foi confirmada. Fale com o time de auditoria para retirar CT-e.' };

  const agora = new Date().toISOString();
  let valorNovo = null;
  if (retirar.length) valorNovo = await retirarCtesSemNf(supabase, fatura, retirar.map((r) => r.c), { respondidoPor, formaCobranca });
  const resolvidos = retirar.map((r) => r.c.chave_cte);
  const linhas = [];
  for (const r of respostas) {
    let status = r.resposta === 'RETIRAR' ? 'APLICADO' : 'PENDENTE';
    let validadoPor = null;
    if (r.resposta === 'COMPLEMENTAR' && await validarComplementarAuto(supabase, r.c.chave_cte, r.original)) {
      status = 'ACEITO';
      validadoPor = 'Automatico (CT-e original com NF na base)';
      resolvidos.push(r.c.chave_cte);
    }
    linhas.push({
      fatura_id: String(fatura.id), numero_fatura: fatura.numero_fatura || null, transportadora: fatura.transportadora || null,
      chave_cte: r.c.chave_cte, numero_cte: r.c.numero_cte || null, valor_cte: Number(r.c.valor_frete || 0),
      resposta: r.resposta, chave_cte_original: r.original || null, chave_nfe: r.nfe || null, justificativa: r.justificativa || null,
      forma_cobranca: r.resposta === 'RETIRAR' ? formaCobranca : null, ciente_nova_cobranca: r.resposta === 'RETIRAR',
      valor_fatura_atualizado: r.resposta === 'RETIRAR' ? valorNovo : null,
      respondido_por: respondidoPor, respondido_em: agora, status_validacao: status,
      validado_por: validadoPor, validado_em: validadoPor ? agora : null, observacao_validacao: null,
    });
  }
  const { error } = await supabase.from('fatura_cte_sem_nf_respostas').upsert(linhas, { onConflict: 'fatura_id,chave_cte' });
  if (error) throw new Error(`Nao foi possivel gravar as respostas (migration 20261105_002 aplicada?): ${error.message}`);
  await tirarDaListaSemNf(supabase, fatura.id, resolvidos);
  const justificados = linhas.filter((l) => l.resposta !== 'RETIRAR');
  if (justificados.length) {
    await supabase.from('auditoria_fatura_historico').insert({
      fatura_id: fatura.id, created_at: agora, acao: 'JUSTIFICATIVA_CTE_SEM_NF_PORTAL',
      descricao: `Transportador justificou ${justificados.length} CT-e(s) sem vinculo com a NF pelo portal${respondidoPor ? ` (${respondidoPor})` : ''}: ${justificados.map((l) => `${l.numero_cte || l.chave_cte} — ${l.resposta === 'COMPLEMENTAR' ? `CT-e complementar do CT-e ${l.chave_cte_original}` : l.justificativa}${l.status_validacao === 'ACEITO' ? ' (aceito automaticamente: CT-e original com NF na base)' : ' (aguardando validacao do auditor)'}`).join(' | ')}.`,
      usuario_nome: respondidoPor || 'Portal do transportador',
    });
  }
  return { ok: true };
}

function paginaErro(titulo, detalhe) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)}</title>
<style>body{margin:0;background:#eef3f9;color:#0f172a;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.box{max-width:520px;background:#fff;border:1px solid #dbe3ef;border-radius:14px;padding:32px;text-align:center}
h1{margin:0 0 10px;font-size:20px}p{color:#475569;line-height:1.5}</style></head>
<body><div class="box"><h1>${esc(titulo)}</h1><p>${esc(detalhe)}</p></div></body></html>`;
}

async function carregarFatura(supabase, token) {
  const base = 'id, numero_fatura, transportadora, valor_fatura, valor_calculado, diferenca, data_vencimento, status, confirmacao_transportador_status, confirmacao_transportador_em, confirmacao_transportador_por, confirmacao_transportador_token, confirmacao_transportador_observacao, confirmacao_transportador_evidencias';
  // confirmacao_laudo_* (numeros mostrados no laudo) so existem apos a migration:
  // sem elas, cai na consulta antiga em vez de quebrar o link.
  let { data: fatura, error } = await supabase
    .from('faturas').select(base + ', confirmacao_laudo_calculado, confirmacao_laudo_desconto')
    .eq('confirmacao_transportador_token', token).maybeSingle();
  if (error) {
    ({ data: fatura, error } = await supabase.from('faturas').select(base).eq('confirmacao_transportador_token', token).maybeSingle());
  }
  if (error) throw error;
  if (!fatura) return { erro: { titulo: 'Link inválido', detalhe: 'Este link de confirmação não foi encontrado. Solicite um novo link ao time de auditoria.' } };
  return { fatura };
}

function formCtes(divergencias) {
  const linhas = divergencias.map((d, i) => {
    const respondido = d.resposta;
    return `<tr>
      <td><strong>${esc(d.numero_cte || String(d.chave).slice(-9))}</strong><div class="ch">${esc(d.chave)}</div>
        <input type="hidden" name="id_${i}" value="${esc(d.id)}"></td>
      <td>${dinheiro(d.valor_cobrado)}</td>
      <td>${dinheiro(d.valor_calculado)}</td>
      <td class="destaque">${dinheiro(d.diferenca)}</td>
      <td>
        <label class="op"><input type="radio" name="resp_${i}" value="CONCORDO"${respondido === 'CONCORDO' ? ' checked' : ''} onclick="marcar(${i})"> Concordo</label>
        <label class="op"><input type="radio" name="resp_${i}" value="NAO_CONCORDO"${respondido === 'NAO_CONCORDO' ? ' checked' : ''} onclick="marcar(${i})"> Não concordo</label>
        ${d.status_validacao === 'REJEITADO' ? `<div class="rej">Rejeitado pela auditoria${d.observacao_validacao ? ': ' + esc(d.observacao_validacao) : ''}. Responda novamente.</div>` : ''}
        <div id="desc_box_${i}" class="cx">Desconto devido (R$): <input type="text" name="desc_${i}" id="desc_${i}" value="${esc(respondido === 'CONCORDO' && d.valor_desconto != null ? Number(d.valor_desconto).toFixed(2) : Number(d.diferenca).toFixed(2))}" data-max="${Number(d.diferenca).toFixed(2)}" inputmode="decimal"></div>
        <div id="just_box_${i}" class="cx"><input type="text" name="just_${i}" id="just_${i}" placeholder="Motivo (obrigatório se não concorda)" value="${esc(d.justificativa || '')}"></div>
      </td></tr>`;
  }).join('');
  return `<form method="POST" id="frmCtes">
    <div class="quem">
      <label for="respondido_por">Quem está respondendo (nome e e-mail)</label>
      <input type="text" id="respondido_por" name="respondido_por" placeholder="Nome — email@transportadora.com.br">
    </div>
    <p class="dica"><b>${divergencias.length} CT-e(s) com cobrança acima do calculado.</b> Para cada um, informe se concorda (e o desconto devido) ou não concorda (e o motivo).</p>
    <p><button type="button" class="sec" onclick="todos()">Concordo com todos (desconto = diferença)</button></p>
    <div class="tw"><table class="ctes"><thead><tr><th>CT-e</th><th>Cobrado</th><th>Calculado</th><th>Diferença</th><th>Sua resposta</th></tr></thead><tbody>${linhas}</tbody></table></div>
    <input type="hidden" name="acao" value="responder_ctes">
    <input type="hidden" name="total" value="${divergencias.length}">
    <button type="submit" onclick="return validarCtes()">Enviar respostas</button>
  </form>
  <script>
  function marcar(i){var r=document.querySelector('input[name=resp_'+i+']:checked');var c=r&&r.value==='CONCORDO';document.getElementById('desc_box_'+i).style.display=c?'block':'none';document.getElementById('just_box_'+i).style.display=r?'block':'none';}
  function todos(){var n=Number(document.querySelector('input[name=total]').value);for(var i=0;i<n;i++){var c=document.querySelector('input[name=resp_'+i+'][value=CONCORDO]');c.checked=true;var d=document.getElementById('desc_'+i);d.value=d.getAttribute('data-max');marcar(i);}}
  function validarCtes(){var q=document.getElementById('respondido_por');if(!q.value.trim()){q.focus();alert('Informe quem está respondendo.');return false}
    var n=Number(document.querySelector('input[name=total]').value);
    for(var i=0;i<n;i++){var r=document.querySelector('input[name=resp_'+i+']:checked');if(!r){alert('Responda todos os CT-es (falta o CT-e da linha '+(i+1)+').');return false}
      if(r.value==='NAO_CONCORDO'&&!document.getElementById('just_'+i).value.trim()){document.getElementById('just_'+i).focus();alert('Informe o motivo do CT-e da linha '+(i+1)+'.');return false}}
    return true}
  for(var k=0;k<${divergencias.length};k++)marcar(k);
  </script>`;
}

function paginaPortalFatura({ fatura, enviado, acaoEnviada, divergencias = [], semNf = { itens: [], pendentes: [], retiradas: [] } }) {
  // Com CT-es divergentes listados, o desconto e a soma deles (o que a
  // transportadora vai responder); a diferenca da fatura inteira inclui CT-es
  // sem calculo/abaixo e nao bate com a lista.
  // Sem lista de CT-es, segue o que o laudo mostrou (ja com as opcoes do
  // laudo aplicadas); so cai no calculo cheio da fatura se o laudo nunca
  // registrou os numeros.
  const temNumerosLaudo = fatura.confirmacao_laudo_calculado != null && fatura.confirmacao_laudo_desconto != null;
  const saldo = divergencias.length
    ? divergencias.reduce((soma, d) => soma + Math.max(Number(d.diferenca || 0), 0), 0)
    : temNumerosLaudo
      ? Math.max(Number(fatura.confirmacao_laudo_desconto || 0), 0)
      : Math.max(Number(fatura.diferenca || 0), 0);
  const calculadoExibido = temNumerosLaudo ? fatura.confirmacao_laudo_calculado : fatura.valor_calculado;
  const jaAprovada = fatura.confirmacao_transportador_status === 'APROVADO';
  // CT-e sem NF sem resposta: a fatura so pode ser confirmada depois de retirar ou justificar cada um.
  const semNfPendente = !jaAprovada && semNf.pendentes.length > 0;
  const contestada = fatura.confirmacao_transportador_status === 'CONTESTADO';
  const avisoContestacao = contestada
    ? `<div class="contest">⚠ ${enviado && acaoEnviada === 'contestar' ? 'Contestação recebida. O time de auditoria vai analisar sua observação e as evidências e retornar.' : `Esta fatura foi contestada em ${esc(dataBr(fatura.confirmacao_transportador_em))}${fatura.confirmacao_transportador_por ? ` por ${esc(fatura.confirmacao_transportador_por)}` : ''}. Você pode enviar uma nova contestação ou confirmar a fatura abaixo.`}<small><b>Observação:</b> ${esc(fatura.confirmacao_transportador_observacao || '-')}${fatura.confirmacao_transportador_evidencias ? `\n<b>Evidências:</b> ${esc(fatura.confirmacao_transportador_evidencias)}` : ''}</small></div>`
    : '';
  const aviso = acaoEnviada === 'responder_sem_nf'
    ? `<div class="ok">✅ Respostas dos CT-es sem NF recebidas.${semNf.retiradas.length ? ` A fatura foi atualizada: agora vale ${esc(dinheiro(fatura.valor_fatura))}.` : ''}${semNfPendente ? '' : ' Agora você já pode confirmar a fatura abaixo.'}</div>`
    : contestada ? avisoContestacao : enviado
    ?`<div class="ok">✅ Confirmação recebida. Obrigado! O time de auditoria já foi notificado e vai seguir com o pagamento.</div>`
    : (jaAprovada
      ? `<div class="ok">✅ Esta fatura já foi confirmada em ${esc(dataBr(fatura.confirmacao_transportador_em))}${fatura.confirmacao_transportador_por ? ` por ${esc(fatura.confirmacao_transportador_por)}` : ''}. Não é necessário confirmar de novo.</div>`
      : '');

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Confirmação de fatura — ${esc(fatura.transportadora || 'Transportadora')}</title>
<style>
body{margin:0;background:#eef3f9;color:#0f172a;font-family:Arial,Helvetica,sans-serif}
.page{max-width:900px;margin:24px auto;background:#fff;border:1px solid #dbe3ef;border-radius:14px;overflow:hidden}
header{padding:26px 30px;background:#06183d;color:#fff}
header h1{margin:0 0 6px;font-size:22px}header p{margin:3px 0;color:#cbd5e1;font-size:14px}
.resumo{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding:18px 30px;background:#f8fafc}
.card{padding:12px;border:1px solid #dbe3ef;border-radius:9px;background:#fff}
.card small{display:block;color:#64748b;margin-bottom:4px}.card strong{font-size:18px}
.destaque{color:#b91c1c}
.intro{padding:18px 30px;line-height:1.55}
.contest{margin:0 30px 16px;padding:14px;background:#fef3c7;border:1px solid #fcd34d;border-radius:9px;color:#78350f;font-weight:700}.contest small{font-weight:400;display:block;margin-top:6px;white-space:pre-wrap}
textarea{box-sizing:border-box;width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;font-family:inherit}
button.recusar{background:#b45309}button.recusar:hover{background:#92400e}.ou{text-align:center;color:#64748b;font-size:12px;margin:16px 0 10px}.contestar-box{padding:14px;border:1px solid #fcd34d;border-radius:10px;background:#fffbeb}
.ok{margin:0 30px 16px;padding:14px;background:#dcfce7;border:1px solid #86efac;border-radius:9px;color:#065f46;font-weight:700}
form{padding:0 30px 26px}
.tw{overflow-x:auto;margin:10px 0 16px}.ctes{width:100%;border-collapse:collapse;font-size:13px}.ctes th,.ctes td{border-bottom:1px solid #e2e8f0;padding:8px;text-align:left;vertical-align:top}.ctes th{background:#f1f5f9}.ch{font-size:10px;color:#94a3b8;word-break:break-all}.op{display:block;margin:2px 0;font-size:13px}.cx{display:none;margin-top:6px;font-size:12px}.cx input{padding:6px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;width:100%;box-sizing:border-box}.rej{margin:6px 0;padding:6px 8px;background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;color:#991b1b;font-size:12px}.dica{font-size:13px;color:#334155}button.sec{background:#475569;width:auto;padding:9px 14px;font-size:13px}
.quem{margin-bottom:14px}
.quem label{display:block;font-size:12px;color:#64748b;margin-bottom:4px}
.quem input{box-sizing:border-box;width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px}
button{border:0;border-radius:9px;background:#0f6b3e;color:#fff;font-weight:700;padding:14px 22px;cursor:pointer;font-size:15px;width:100%}
button:hover{background:#0c5732}
button:disabled{background:#94a3b8;cursor:not-allowed}
.semnf{margin:0 30px 18px;padding:16px;border:2px solid #dc2626;border-radius:10px;background:#fef2f2}.semnf h2{margin:0 0 6px;font-size:17px;color:#7f1d1d}.semnf>p{font-size:13px;color:#7f1d1d;line-height:1.5}.semnf form{padding:0}.semnf .ctes{background:#fff}
.campo{box-sizing:border-box;width:100%;padding:7px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;margin:2px 0 8px}
.cobranca{margin:12px 0;padding:12px;border:1px solid #fcd34d;border-radius:9px;background:#fffbeb;font-size:13px;color:#78350f}.cobranca.ativa{border:2px solid #d97706}.cobranca p{margin:6px 0}.ciente{margin-top:10px!important;font-size:13px}
.inativos{margin:0 30px 16px;padding:14px;background:#f8fafc;border:1px solid #94a3b8;border-radius:9px;color:#334155;font-size:13px}.inativos .ctes{background:#fff}.tag-inativo{display:inline-block;padding:1px 6px;border-radius:5px;background:#e2e8f0;color:#475569;font-size:10px;font-weight:700}
.bloqueio{margin:0 30px 20px;padding:12px 14px;background:#fff7ed;border:1px solid #fdba74;border-radius:9px;color:#9a3412;font-weight:700;font-size:13px}
footer{padding:16px 30px;color:#64748b;font-size:12px;border-top:1px solid #e2e8f0}
</style></head><body>
<main class="page">
  <header>
    <h1>Confirmação de fatura</h1>
    <p>Fatura ${esc(fatura.numero_fatura)} — ${esc(fatura.transportadora || 'Transportadora')}</p>
    <p>Vencimento ${esc(dataBr(fatura.data_vencimento))}</p>
  </header>
  <div class="resumo">
    <div class="card"><small>Valor cobrado</small><strong>${dinheiro(fatura.valor_fatura)}</strong></div>
    <div class="card"><small>Calculado pela auditoria</small><strong>${dinheiro(calculadoExibido)}</strong></div>
    <div class="card"><small>Desconto identificado</small><strong class="${saldo > 0 ? 'destaque' : ''}">${dinheiro(saldo)}</strong></div>
    <div class="card"><small>Status atual</small><strong>${esc((fatura.status || '').replaceAll('_', ' '))}</strong></div>
  </div>
  ${aviso}
  ${blocoRetiradas(semNf.retiradas, fatura)}
  ${formSemNf(fatura, semNf)}
  <div class="intro">
    <p>${saldo > 0
      ? `Identificamos cobrança a maior de <b>${dinheiro(saldo)}</b> nesta fatura em relação ao valor calculado pela auditoria. Ao confirmar, você concorda que esse desconto seja aplicado no pagamento.`
      : 'Esta fatura já foi auditada e o valor calculado bate com o valor cobrado. Ao confirmar, você reconhece a fatura para seguirmos com o pagamento.'}</p>
  </div>
  ${semNfPendente ? '<div class="bloqueio">Responda primeiro os CT-es sem vínculo com a NF (acima). Depois disso a confirmação da fatura fica disponível aqui.</div>' : ''}
  ${!jaAprovada && !semNfPendente && divergencias.length ? formCtes(divergencias) : ''}
  ${!jaAprovada && !semNfPendente && !divergencias.length ? `<form method="POST">
    <div class="quem">
      <label for="respondido_por">Quem está respondendo (nome e e-mail)</label>
      <input type="text" id="respondido_por" name="respondido_por" placeholder="Nome — email@transportadora.com.br">
    </div>
    <button type="submit" name="acao" value="confirmar" onclick="return validarQuem()">OK, confirmo esta fatura</button>
    <div class="ou">— ou, se não concorda —</div>
    <div class="contestar-box">
      <div class="quem">
        <label for="observacao">Observação (motivo da recusa / contestação)</label>
        <textarea id="observacao" name="observacao" rows="4" placeholder="Explique o que está incorreto (ex.: peso, tabela, CT-es com os quais discorda)"></textarea>
      </div>
      <div class="quem">
        <label for="evidencias">Evidências / provas (links de arquivos, um por linha)</label>
        <textarea id="evidencias" name="evidencias" rows="3" placeholder="Cole links (Drive, OneDrive etc.) de comprovantes, CT-es, NFs, canhotos"></textarea>
      </div>
      <button type="submit" name="acao" value="contestar" class="recusar" onclick="return validarContestacao()">Não concordo — enviar contestação</button>
    </div>
  </form>
  <script>
  function validarQuem(){var q=document.getElementById('respondido_por');if(!q.value.trim()){q.focus();alert('Informe quem está respondendo.');return false}return true}
  function validarContestacao(){if(!validarQuem())return false;var o=document.getElementById('observacao');if(!o.value.trim()){o.focus();alert('Descreva o motivo da contestação.');return false}return true}
  </script>` : ''}
  <footer>Central Fretes · Este link é exclusivo desta fatura e não dá acesso a nenhum outro dado.</footer>
</main></body></html>`;
}

function lerCorpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return Object.fromEntries(new URLSearchParams(req.body));
  return {};
}

export default async function handler(req, res) {
  const { token } = req.query;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (!token) {
    res.status(400).setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(paginaErro('Link inválido', 'Token não informado.'));
  }

  let supabase;
  try {
    supabase = getClient();
  } catch (error) {
    res.status(500).setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(paginaErro('Portal indisponível', error.message));
  }

  try {
    const contexto = await carregarFatura(supabase, token);
    if (contexto.erro) {
      res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(paginaErro(contexto.erro.titulo, contexto.erro.detalhe));
    }

    if (req.method === 'GET') {
      res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(paginaPortalFatura({ fatura: contexto.fatura, enviado: false, divergencias: await carregarDivergencias(supabase, contexto.fatura.id), semNf: await carregarSemNf(supabase, contexto.fatura.id) }));
    }

    if (req.method === 'POST') {
      const { fatura } = contexto;
      const corpo = lerCorpo(req);
      const acao = ['contestar', 'responder_ctes', 'responder_sem_nf'].includes(corpo.acao) ? corpo.acao : 'confirmar';
      const respondidoPor = String(corpo.respondido_por || '').slice(0, 200) || null;
      const agora = new Date().toISOString();
      if (acao === 'responder_sem_nf') {
        const r = await responderSemNf(supabase, fatura, corpo, respondidoPor);
        if (r.erro) {
          res.status(400).setHeader('Content-Type', 'text/html; charset=utf-8');
          return res.send(paginaErro('Respostas incompletas', r.erro));
        }
      } else if (fatura.confirmacao_transportador_status !== 'APROVADO' && (await carregarSemNf(supabase, fatura.id)).pendentes.length) {
        res.status(400).setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(paginaErro('CT-e sem NF pendente', 'Responda primeiro os CT-es sem vínculo com a NF (retirar da fatura ou justificar) e volte para confirmar a fatura.'));
      } else if (fatura.confirmacao_transportador_status !== 'APROVADO') {
        if (acao === 'responder_ctes') {
          const divergencias = await carregarDivergencias(supabase, fatura.id);
          const porId = new Map(divergencias.map((d) => [String(d.id), d]));
          const total = Math.min(Number(corpo.total) || 0, divergencias.length);
          const respostas = [];
          for (let i = 0; i < total; i += 1) {
            const d = porId.get(String(corpo[`id_${i}`] || ''));
            const resposta = corpo[`resp_${i}`];
            if (!d || !['CONCORDO', 'NAO_CONCORDO'].includes(resposta)) continue;
            const justificativa = String(corpo[`just_${i}`] || '').trim().slice(0, 1000);
            const bruto = Number(String(corpo[`desc_${i}`] || '0').replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, '')) || 0;
            const valorDesconto = resposta === 'CONCORDO' ? Math.min(Math.max(bruto, 0), Number(d.diferenca || 0)) : null;
            if (resposta === 'NAO_CONCORDO' && !justificativa) continue;
            respostas.push({ d, resposta, justificativa: justificativa || null, valorDesconto });
          }
          if (!respostas.length || respostas.length < divergencias.length) {
            res.status(400).setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.send(paginaErro('Respostas incompletas', 'Responda todos os CT-es (e o motivo dos que não concorda) e volte para tentar novamente.'));
          }
          for (const r of respostas) {
            const { error: erroResp } = await supabase.from('fatura_cte_divergencias').update({
              resposta: r.resposta, valor_desconto: r.valorDesconto, justificativa: r.justificativa, respondido_por: respondidoPor, respondido_em: agora,
              status_validacao: 'PENDENTE', validado_por: null, validado_em: null, observacao_validacao: null,
            }).eq('id', r.d.id);
            if (erroResp) throw erroResp;
          }
          const concordam = respostas.filter((r) => r.resposta === 'CONCORDO');
          const discordam = respostas.filter((r) => r.resposta === 'NAO_CONCORDO');
          const totalDesconto = concordam.reduce((acc, r) => acc + Number(r.valorDesconto || 0), 0);
          const resumoTxt = `${concordam.length} CT-e(s) com desconto reconhecido de ${dinheiro(totalDesconto)}; ${discordam.length} CT-e(s) contestado(s)${discordam.length ? ': ' + discordam.map((r) => `${r.d.numero_cte || r.d.chave} (${r.justificativa})`).join(' | ') : ''}.`;
          const { error: erroFat } = await supabase.from('faturas').update({
            confirmacao_transportador_status: discordam.length ? 'CONTESTADO' : 'APROVADO',
            confirmacao_transportador_em: agora,
            confirmacao_transportador_por: respondidoPor,
            confirmacao_transportador_observacao: resumoTxt,
            updated_at: agora,
          }).eq('id', fatura.id);
          if (erroFat) throw erroFat;
          await supabase.from('auditoria_fatura_historico').insert({
            fatura_id: fatura.id,
            created_at: agora,
            acao: discordam.length ? 'CONTESTACAO_TRANSPORTADOR_PORTAL' : 'CONFIRMACAO_TRANSPORTADOR_PORTAL',
            descricao: `Transportador respondeu CT-e a CT-e pelo link de conferência${respondidoPor ? ` (${respondidoPor})` : ''}. ${resumoTxt}`,
            usuario_nome: respondidoPor || 'Portal do transportador',
          });
        } else if (acao === 'contestar') {
          const observacao = String(corpo.observacao || '').trim().slice(0, 4000);
          const evidencias = String(corpo.evidencias || '').trim().slice(0, 4000);
          if (!observacao) {
            res.status(400).setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.send(paginaErro('Observação obrigatória', 'Descreva o motivo da contestação e volte para tentar novamente.'));
          }
          const { error: erroContestacao } = await supabase
            .from('faturas')
            .update({
              confirmacao_transportador_status: 'CONTESTADO',
              confirmacao_transportador_em: agora,
              confirmacao_transportador_por: respondidoPor,
              confirmacao_transportador_observacao: observacao,
              confirmacao_transportador_evidencias: evidencias || null,
              updated_at: agora,
            })
            .eq('id', fatura.id);
          if (erroContestacao) throw erroContestacao;

          await supabase.from('auditoria_fatura_historico').insert({
            fatura_id: fatura.id,
            created_at: agora,
            acao: 'CONTESTACAO_TRANSPORTADOR_PORTAL',
            descricao: `Transportador contestou a fatura pelo link de conferência${respondidoPor ? ` (${respondidoPor})` : ''}. Observação: ${observacao}${evidencias ? ` | Evidências: ${evidencias}` : ''}`,
            usuario_nome: respondidoPor || 'Portal do transportador',
          });
        } else {
          await supabase
            .from('faturas')
            .update({
              confirmacao_transportador_status: 'APROVADO',
              confirmacao_transportador_em: agora,
              confirmacao_transportador_por: respondidoPor,
              updated_at: agora,
            })
            .eq('id', fatura.id);

          await supabase.from('auditoria_fatura_historico').insert({
            fatura_id: fatura.id,
            created_at: agora,
            acao: 'CONFIRMACAO_TRANSPORTADOR_PORTAL',
            descricao: `Transportador confirmou a fatura pelo link de conferência${respondidoPor ? ` (${respondidoPor})` : ''}.`,
            usuario_nome: respondidoPor || 'Portal do transportador',
          });
        }
      }

      const atualizado = await carregarFatura(supabase, token);
      res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(paginaPortalFatura({ fatura: atualizado.fatura, enviado: true, acaoEnviada: acao === 'responder_ctes' && atualizado.fatura.confirmacao_transportador_status === 'CONTESTADO' ? 'contestar' : acao, divergencias: await carregarDivergencias(supabase, fatura.id), semNf: await carregarSemNf(supabase, fatura.id) }));
    }

    res.status(405).setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(paginaErro('Método não permitido', 'Use o link enviado por e-mail.'));
  } catch (error) {
    res.status(500).setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(paginaErro('Erro ao processar', error.message || String(error)));
  }
}
