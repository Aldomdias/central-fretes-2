import React, { useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { carregarMunicipiosIbgeDb } from '../services/freteDatabaseService';
import { carregarMunicipiosIbgeOficial } from '../utils/ibgeMunicipiosOficial';
import { buscarTrackingParaRealizado, obterTrackingDaLinha } from '../services/realizadoTrackingEnrichment';
import { carregarAliasesCidadeIbge } from '../services/cidadeIbgeAliasService';
import { normalizarCidadeIbge, compactarCidadeIbge, resolverIbgeComRegras } from '../utils/ibgeCidadeMatch';

const TABELA = 'realizado_local_ctes';
const PAGE = 1000;
const UPSERT_CHUNK = 200;

function ehTimeoutDb(msg = '') {
  const t = String(msg || '').toLowerCase();
  return t.includes('statement timeout') || t.includes('canceling statement') || t.includes('timeout');
}

// Grava um lote por upsert; se o Postgres cortar por statement timeout (base
// grande), divide o lote pela metade e tenta de novo (recursivo) até passar.
async function gravarComRetry(supabase, parte) {
  if (!parte.length) return;
  const { error } = await supabase.from(TABELA).upsert(parte, { onConflict: 'chave_cte', ignoreDuplicates: false });
  if (!error) return;
  if (ehTimeoutDb(error.message) && parte.length > 1) {
    const meio = Math.ceil(parte.length / 2);
    await gravarComRetry(supabase, parte.slice(0, meio));
    await gravarComRetry(supabase, parte.slice(meio));
    return;
  }
  throw new Error(`Erro ao gravar IBGE/chave de rota/volumetria: ${error.message}`);
}
const COLUNAS_BASE = 'chave_cte,numero_cte,competencia,arquivo_origem,canal,canal_original,cidade_origem,uf_origem,ibge_origem,cidade_destino,uf_destino,ibge_destino,chave_rota_ibge,ibge_ok,qtd_volumes,cubagem,peso_cubado';
const COLUNAS_COM_NFE = `${COLUNAS_BASE},chave_nfe,nota_fiscal`;
const COLUNAS_COM_CHAVE_NFE = `${COLUNAS_BASE},chave_nfe`;
const COLUNAS_BASE_SEM_VOLUMETRIA = 'chave_cte,numero_cte,competencia,arquivo_origem,canal,canal_original,cidade_origem,uf_origem,ibge_origem,cidade_destino,uf_destino,ibge_destino,chave_rota_ibge,ibge_ok';
const SELECTS_CTES = [COLUNAS_COM_NFE, COLUNAS_COM_CHAVE_NFE, COLUNAS_BASE, COLUNAS_BASE_SEM_VOLUMETRIA];

function safeNum(v) { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; }
function temValor(v) { return safeNum(v) > 0; }
function mudouNumero(atual, tracking, tolerancia = 0.000001) {
  return temValor(tracking) && Math.abs(safeNum(atual) - safeNum(tracking)) > tolerancia;
}
function fmtN(v) { return safeNum(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }
function pct(v) { return `${safeNum(v).toFixed(1).replace('.', ',')}%`; }
function dig7(v) { return String(v || '').replace(/\D/g, '').slice(0, 7); }
// Mesma normalizaÃ§Ã£o de cidade do Simulador (planilha de IBGE).
function normalizeBuscaIbge(t) {
  return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
// Índice em duas chaves: normal ("cidade" e "cidade/uf") e compacta (sem espaços,
// resolve apóstrofo). O resolvedor usa as regras de ibgeCidadeMatch.
function montarMunicipioPorCidade(municipios = []) {
  const porChave = new Map();
  const porCompacto = new Map();
  for (const item of (municipios || [])) {
    const ibge = dig7(item.ibge || item.codigo_ibge || item.codigo);
    const cidade = item.cidade || item.nome || item.municipio || '';
    const uf = String(item.uf || item.estado || '').toLowerCase();
    if (!ibge || !cidade) continue;
    const c = normalizarCidadeIbge(cidade);
    const comp = compactarCidadeIbge(cidade);
    const cUf = uf ? normalizarCidadeIbge(`${cidade}/${uf}`) : '';
    const compUf = uf ? compactarCidadeIbge(`${cidade}/${uf}`) : '';
    if (c) {
      if (!porChave.has(c)) porChave.set(c, ibge);
      if (cUf && !porChave.has(cUf)) porChave.set(cUf, ibge);
    }
    if (comp) {
      if (!porCompacto.has(comp)) porCompacto.set(comp, ibge);
      if (compUf && !porCompacto.has(compUf)) porCompacto.set(compUf, ibge);
    }
  }
  return { porChave, porCompacto };
}
function resolverPlanilha(cidade, uf, indice) {
  if (!cidade || !indice) return '';
  return resolverIbgeComRegras(
    cidade,
    uf,
    (k) => indice.porChave.get(k) || '',
    (k) => indice.porCompacto.get(k) || '',
  );
}
// Chaves da base no formato que o match do tracking espera.
// A prioridade no serviÃ§o Ã©: chave CT-e -> chave NF-e -> nota -> nÃºmero CT-e.
function chavesTrackingDaLinha(row) {
  return {
    chaveCte: row.chave_cte,
    chaveNfe: row.chave_nfe,
    notaFiscal: row.nota_fiscal,
    numeroCte: row.numero_cte,
  };
}
function deduplicarUpdatesPorChaveCte(updates = []) {
  const map = new Map();
  for (const item of updates || []) {
    const chave = String(item?.chave_cte || '').trim();
    if (!chave) continue;
    map.set(chave, { ...(map.get(chave) || {}), ...item, chave_cte: chave });
  }
  return Array.from(map.values());
}

function Card({ label, valor, sub, cor, destaque }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${destaque ? cor : '#e2e8f0'}`, borderLeft: `4px solid ${cor}`, borderRadius: 10, padding: '12px 18px', minWidth: 150 }}>
      <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: '1.45rem', fontWeight: 800, color: destaque ? cor : '#1e293b' }}>{valor}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function GestaoBaseCtePage() {
  const [competencia, setCompetencia] = useState('');
  const [canal, setCanal] = useState('');
  const [status, setStatus] = useState('idle'); // idle | analisando | completando
  const [progresso, setProgresso] = useState('');
  const [erro, setErro] = useState('');
  const [diag, setDiag] = useState(null); // resultado da anÃ¡lise
  const [resultado, setResultado] = useState('');
  // Visao geral (leve) do que falta por competencia.
  const [visao, setVisao] = useState(null);
  const [visaoStatus, setVisaoStatus] = useState('idle'); // idle | carregando
  const [visaoErro, setVisaoErro] = useState('');
  const [visaoProgresso, setVisaoProgresso] = useState('');

  // Contagem leve via head/count (nao baixa linhas).
  async function contar(supabase, build) {
    let q = supabase.from(TABELA).select('chave_cte', { count: 'exact', head: true });
    q = build(q);
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return count || 0;
  }

  // Visao geral: percorre todas as competencias e conta as lacunas por mes.
  async function carregarVisaoGeral() {
    setVisaoStatus('carregando'); setVisaoErro(''); setVisao(null);
    try {
      if (!isSupabaseConfigured()) throw new Error('Supabase nÃ£o configurado.');
      const supabase = getSupabaseClient();
      // Descobre o intervalo de competencias (2 leituras leves).
      const { data: minRow } = await supabase.from(TABELA).select('competencia').not('competencia', 'is', null).neq('competencia', '').order('competencia', { ascending: true }).limit(1);
      const { data: maxRow } = await supabase.from(TABELA).select('competencia').not('competencia', 'is', null).neq('competencia', '').order('competencia', { ascending: false }).limit(1);
      const ini = minRow?.[0]?.competencia;
      const fim = maxRow?.[0]?.competencia;
      if (!ini || !fim) throw new Error('Nenhuma competÃªncia encontrada na base.');
      const meses = [];
      let [ay, am] = ini.split('-').map(Number);
      const [by, bm] = fim.split('-').map(Number);
      while (ay < by || (ay === by && am <= bm)) {
        meses.push(`${ay}-${String(am).padStart(2, '0')}`);
        am += 1; if (am > 12) { am = 1; ay += 1; }
      }
      const linhas = [];
      for (const m of meses) {
        setVisaoProgresso(`Analisando ${m}... (${meses.indexOf(m) + 1}/${meses.length})`);
        const base = (q) => q.eq('competencia', m);
        const total = await contar(supabase, base);
        if (!total) continue;
        const semOrigem = await contar(supabase, (q) => base(q).or('ibge_origem.is.null,ibge_origem.eq.'));
        const semDestino = await contar(supabase, (q) => base(q).or('ibge_destino.is.null,ibge_destino.eq.'));
        const semRota = await contar(supabase, (q) => base(q).or('chave_rota_ibge.is.null,chave_rota_ibge.eq.'));
        const semCubagem = await contar(supabase, (q) => base(q).or('cubagem.is.null,cubagem.lte.0'));
        const semVolumes = await contar(supabase, (q) => base(q).or('qtd_volumes.is.null,qtd_volumes.lte.0'));
        const semCanal = await contar(supabase, (q) => base(q).or('canal.is.null,canal.eq.'));
        const semTomador = await contar(supabase, (q) => base(q).or('tomador_servico.is.null,tomador_servico.eq.'));
        const pronto = await contar(supabase, (q) => base(q)
          .not('ibge_origem', 'is', null).neq('ibge_origem', '')
          .not('ibge_destino', 'is', null).neq('ibge_destino', '')
          .not('chave_rota_ibge', 'is', null).neq('chave_rota_ibge', '')
          .gt('cubagem', 0).gt('qtd_volumes', 0));
        linhas.push({ mes: m, total, pronto, semOrigem, semDestino, semRota, semCubagem, semVolumes, semCanal, semTomador });
      }
      const totalGeral = linhas.reduce((s, l) => s + l.total, 0);
      const prontoGeral = linhas.reduce((s, l) => s + l.pronto, 0);
      setVisao({ linhas, totalGeral, prontoGeral });
      setVisaoStatus('idle'); setVisaoProgresso('');
    } catch (e) {
      console.error('[GestaoBaseCte][visao]', e);
      setVisaoErro(`${e.message || e}`); setVisaoStatus('idle'); setVisaoProgresso('');
    }
  }

  async function carregarLinhas(onProgress) {
    if (!isSupabaseConfigured()) throw new Error('Supabase nÃ£o configurado.');
    if (!competencia) throw new Error('Selecione a competÃªncia (mÃªs).');
    const supabase = getSupabaseClient();
    const linhas = [];
    let from = 0;
    let selectIndex = 0;
    while (true) {
      let q = supabase.from(TABELA).select(SELECTS_CTES[selectIndex]).eq('competencia', competencia).order('chave_cte', { ascending: true }).range(from, from + PAGE - 1);
      if (canal) q = q.or(`canal_original.ilike.%${canal}%,canal.ilike.%${canal}%`);
      let { data, error } = await q;
      while (error && selectIndex < SELECTS_CTES.length - 1 && /chave_nfe|nota_fiscal|column|schema cache/i.test(error.message || '')) {
        selectIndex += 1;
        q = supabase.from(TABELA).select(SELECTS_CTES[selectIndex]).eq('competencia', competencia).order('chave_cte', { ascending: true }).range(from, from + PAGE - 1);
        if (canal) q = q.or(`canal_original.ilike.%${canal}%,canal.ilike.%${canal}%`);
        ({ data, error } = await q);
      }
      if (error) throw new Error(`Erro ao ler base: ${error.message}`);
      const lote = data || [];
      linhas.push(...lote);
      onProgress?.(linhas.length);
      if (lote.length < PAGE) break;
      from += PAGE;
    }
    return linhas;
  }

  // Analisa o status de IBGE e monta a lista do que dÃ¡ pra preencher.
  // Fonte: tracking primeiro (origem do CT-e vem do tracking), planilha como reforÃ§o.
  async function analisar() {
    setStatus('analisando'); setErro(''); setDiag(null); setResultado('');
    try {
      setProgresso('Carregando base de IBGE (oficial)...');
      let municipios = [];
      let ibgeFonte = '';
      try {
        const r = await carregarMunicipiosIbgeOficial();
        municipios = r.municipios || []; ibgeFonte = r.fonte || 'IBGE oficial';
      } catch { /* tenta o Supabase abaixo */ }
      if (municipios.length < 5000) {
        const sb = await carregarMunicipiosIbgeDb().catch(() => []);
        if (sb.length > municipios.length) { municipios = sb; ibgeFonte = 'ibge_municipios (Supabase)'; }
      }
      const municipioPorCidade = montarMunicipioPorCidade(municipios);
      if (!municipioPorCidade.porChave.size) throw new Error('Base de IBGE indisponÃ­vel (nem IBGE oficial nem ibge_municipios). Verifique a conexÃ£o e tente de novo.');

      // Vinculos manuais cidade->IBGE (geridos em Ferramentas). Sobrepoem a lista
      // oficial para resolver nomes que nao casam (ex.: "BRASILIA (DF)").
      try {
        const aliases = await carregarAliasesCidadeIbge();
        for (const a of aliases) {
          const c = normalizarCidadeIbge(a.cidade);
          const comp = compactarCidadeIbge(a.cidade);
          if (c) { municipioPorCidade.porChave.set(c, a.ibge); if (a.uf) municipioPorCidade.porChave.set(normalizarCidadeIbge(`${a.cidade}/${a.uf}`), a.ibge); }
          if (comp) { municipioPorCidade.porCompacto.set(comp, a.ibge); if (a.uf) municipioPorCidade.porCompacto.set(compactarCidadeIbge(`${a.cidade}/${a.uf}`), a.ibge); }
        }
      } catch (e) {
        console.warn('[GestaoBaseCte] aliases cidade->IBGE indisponiveis', e);
      }

      setProgresso('Lendo CT-es da base...');
      const linhas = await carregarLinhas((n) => setProgresso(`Lendo CT-es da base... ${fmtN(n)}`));
      if (!linhas.length) throw new Error('Nenhum CT-e nessa competÃªncia.');

      // So consulta o tracking dos CT-es que ainda tem lacuna. Os ja completos
      // (mesma regra do `continue` la embaixo) sao pulados na gravacao de
      // qualquer forma, entao busca-los no tracking seria trabalho jogado fora.
      const linhaCompleta = (row) => Boolean(
        dig7(row.ibge_origem) && dig7(row.ibge_destino)
        && String(row.chave_rota_ibge || '').trim() && row.ibge_ok === true
        && temValor(row.qtd_volumes) && temValor(row.cubagem),
      );
      const faltam = linhas.filter((row) => !linhaCompleta(row));
      let mapas = { mapaChaveCte: new Map(), mapaChaveNfe: new Map(), mapaNota: new Map(), mapaNumeroCte: new Map() };
      let trackingErro = '';
      if (faltam.length) {
        setProgresso(`Buscando ${fmtN(faltam.length)} CT-es no tracking... (pode levar 1â€“2 min)`);
        const resp = await buscarTrackingParaRealizado(faltam.map(chavesTrackingDaLinha));
        mapas = resp; trackingErro = resp.erro || '';
      }

      let comCompleto = 0, semOrigem = 0, semDestino = 0, semChaveRota = 0, ibgeOkFalse = 0;
      let semVolumes = 0, semCubagem = 0, comVolumetria = 0;
      let viaTracking = 0, viaPlanilha = 0, semMatchTracking = 0;
      let vaiPreencherIbge = 0, vaiPreencherRota = 0, vaiPreencherVolumetria = 0;
      const updates = [];
      const cidadesNaoResolvidas = new Map();
      const porArquivo = new Map();

      for (const row of linhas) {
        const origAtual = dig7(row.ibge_origem);
        const destAtual = dig7(row.ibge_destino);
        const chaveRotaAtual = String(row.chave_rota_ibge || '').trim();
        const ibgeOkAtual = row.ibge_ok === true;
        if (!origAtual) semOrigem += 1;
        if (!destAtual) semDestino += 1;
        if (!chaveRotaAtual) semChaveRota += 1;
        if (!ibgeOkAtual) ibgeOkFalse += 1;
        if (origAtual && destAtual && chaveRotaAtual && ibgeOkAtual) comCompleto += 1;
        const volAtual = safeNum(row.qtd_volumes);
        const cubAtual = safeNum(row.cubagem);
        const pesoCubadoAtual = safeNum(row.peso_cubado);
        if (!temValor(volAtual)) semVolumes += 1;
        if (!temValor(cubAtual)) semCubagem += 1;
        if (temValor(volAtual) && temValor(cubAtual)) comVolumetria += 1;

        const arq = row.arquivo_origem || '(sem arquivo)';
        const a = porArquivo.get(arq) || { arquivo: arq, total: 0, sem: 0 };
        a.total += 1;
        if (origAtual && destAtual && chaveRotaAtual && ibgeOkAtual && temValor(volAtual) && temValor(cubAtual)) { porArquivo.set(arq, a); continue; }
        a.sem += 1;

        const tracking = obterTrackingDaLinha(chavesTrackingDaLinha(row), mapas);
        if (!tracking) semMatchTracking += 1;
        let usouTracking = false, usouPlanilha = false;

        const resolver = (ibgeAtual, tipo) => {
          if (ibgeAtual) return ibgeAtual;
          // cidade/UF "certinha" vem do tracking; base do CT-e Ã© o fallback.
          const cid = (tipo === 'origem' ? (tracking?.cidade_origem || row.cidade_origem) : (tracking?.cidade_destino || row.cidade_destino)) || '';
          const uf = (tipo === 'origem' ? (tracking?.uf_origem || row.uf_origem) : (tracking?.uf_destino || row.uf_destino)) || '';
          // 1) resolve cidade/UF na base de IBGE
          const p = resolverPlanilha(cid, uf, municipioPorCidade);
          if (p) { if (tracking) usouTracking = true; else usouPlanilha = true; return p; }
          // 2) Ãºltimo recurso: IBGE que por acaso veio no prÃ³prio tracking
          const tIbge = dig7(tipo === 'origem' ? tracking?.ibge_origem : tracking?.ibge_destino);
          if (tIbge) { usouTracking = true; return tIbge; }
          cidadesNaoResolvidas.set(`${cid || '(sem cidade)'}/${uf || '?'}`, (cidadesNaoResolvidas.get(`${cid || '(sem cidade)'}/${uf || '?'}`) || 0) + 1);
          return '';
        };

        const novoOrig = resolver(origAtual, 'origem');
        const novoDest = resolver(destAtual, 'destino');
        const novaChaveRota = novoOrig && novoDest ? `${novoOrig}-${novoDest}` : '';
        const novoVolumes = mudouNumero(volAtual, tracking?.qtd_volumes) ? safeNum(tracking.qtd_volumes) : volAtual;
        const novoCubagem = mudouNumero(cubAtual, tracking?.cubagem_total) ? safeNum(tracking.cubagem_total) : cubAtual;
        const novoPesoCubado = mudouNumero(pesoCubadoAtual, tracking?.peso_cubado) ? safeNum(tracking.peso_cubado) : pesoCubadoAtual;
        const preencherIbgeLinha = (novoOrig && !origAtual) || (novoDest && !destAtual);
        const preencherRotaLinha = Boolean(novaChaveRota && (chaveRotaAtual !== novaChaveRota || !ibgeOkAtual));
        const preencherVolLinha = mudouNumero(volAtual, tracking?.qtd_volumes)
          || mudouNumero(cubAtual, tracking?.cubagem_total)
          || mudouNumero(pesoCubadoAtual, tracking?.peso_cubado);

        if ((preencherIbgeLinha || preencherRotaLinha || preencherVolLinha) && row.chave_cte) {
          updates.push({
            chave_cte: row.chave_cte,
            ibge_origem: novoOrig || '',
            ibge_destino: novoDest || '',
            chave_rota_ibge: novaChaveRota || '',
            ibge_ok: Boolean(novaChaveRota),
            qtd_volumes: novoVolumes || 0,
            cubagem: novoCubagem || 0,
            peso_cubado: novoPesoCubado || 0,
            updated_at: new Date().toISOString(),
          });
          if (preencherIbgeLinha) vaiPreencherIbge += 1;
          if (preencherRotaLinha) vaiPreencherRota += 1;
          if (preencherVolLinha) vaiPreencherVolumetria += 1;
          if (preencherVolLinha && tracking) usouTracking = true;
          if (usouTracking) viaTracking += 1; else if (usouPlanilha) viaPlanilha += 1;
        }
        porArquivo.set(arq, a);
      }

      const updatesDeduplicados = deduplicarUpdatesPorChaveCte(updates);
      const topNaoResolvidas = Array.from(cidadesNaoResolvidas.entries())
        .map(([cidade, qtd]) => ({ cidade, qtd })).sort((x, y) => y.qtd - x.qtd).slice(0, 25);
      const arquivos = Array.from(porArquivo.values()).sort((x, y) => y.sem - x.sem);

      setDiag({
        total: linhas.length, comCompleto, semOrigem, semDestino, semChaveRota, ibgeOkFalse,
        semVolumes, semCubagem, comVolumetria,
        vouPreencher: updatesDeduplicados.length, vaiPreencherIbge, vaiPreencherRota, vaiPreencherVolumetria, viaTracking, viaPlanilha, semMatchTracking, trackingErro,
        updatesDuplicados: Math.max(0, updates.length - updatesDeduplicados.length),
        ibgeFonte, ibgeQtd: municipioPorCidade.porChave.size,
        updates: updatesDeduplicados, topNaoResolvidas, arquivos,
      });
      setStatus('idle'); setProgresso('');
    } catch (e) {
      console.error('[GestaoBaseCte]', e);
      setErro(`${e.message || e}`); setStatus('idle'); setProgresso('');
    }
  }

  // Grava sÃ³ as colunas de IBGE, sÃ³ onde faltava (upsert por chave_cte).
  async function completar() {
    if (!diag?.updates?.length) return;
    setStatus('completando'); setErro(''); setResultado('');
    try {
      const supabase = getSupabaseClient();
      let gravados = 0;
      for (let i = 0; i < diag.updates.length; i += UPSERT_CHUNK) {
        const parte = diag.updates.slice(i, i + UPSERT_CHUNK);
        await gravarComRetry(supabase, parte);
        gravados += parte.length;
        setProgresso(`Gravando IBGE/chave de rota/volumetria... ${fmtN(gravados)}/${fmtN(diag.updates.length)}`);
        await new Promise((r) => setTimeout(r, 0));
      }
      setResultado(`Base atualizada em ${fmtN(gravados)} CT-e(s). Reanalisando...`);
      setProgresso('');
      await analisar();
    } catch (e) {
      console.error('[GestaoBaseCte]', e);
      setErro(`${e.message || e}`); setStatus('idle'); setProgresso('');
    }
  }

  const ocupado = status !== 'idle';

  return (
    <div className="simulador-shell">
      <div className="simulador-header compact-top">
        <div className="simulador-subtitulo">Central Fretes â€¢ Base</div>
        <h1>GestÃ£o da Base CT-e</h1>
        <p>Completa a base de CT-es uma vez (IBGE, volumes e cubagem), pra todas as ferramentas lerem pronto. IBGE sÃ³ entra onde falta; volumes, cubagem e peso cubado seguem o tracking quando houver divergÃªncia.</p>
      </div>

      {erro && <div className="sim-alert error">{erro}</div>}

      <section className="sim-card">
        <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end' }}>
          <label>CompetÃªncia (mÃªs)<input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} /></label>
          <label>Canal (opcional)
            <select value={canal} onChange={(e) => setCanal(e.target.value)} style={{ width: '100%' }}>
              <option value="">Todos</option>
              <option value="B2C">B2C</option>
              <option value="ATACADO">ATACADO</option>
              <option value="INTERCOMPANY">INTERCOMPANY</option>
              <option value="REVERSA">REVERSA</option>
            </select>
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <button className="primary" type="button" onClick={analisar} disabled={ocupado || !competencia}>
              {status === 'analisando' ? 'Analisando...' : 'Analisar base'}
            </button>
          </div>
        </div>

        {progresso && (
          <div style={{ marginTop: 12, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 14px', fontSize: '0.85rem', color: '#1d4ed8', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #93c5fd', borderTop: '2px solid #1d4ed8', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            {progresso}
          </div>
        )}
        {resultado && <div style={{ marginTop: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', fontSize: '0.85rem', color: '#166534' }}>{resultado}</div>}
      </section>

      <section className="sim-card" style={{ marginTop: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b' }}>VisÃ£o geral da base â€” o que falta por mÃªs</div>
            <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Contagem rÃ¡pida (nÃ£o consulta tracking). Use para ver onde a base estÃ¡ incompleta e qual mÃªs analisar/completar.</div>
          </div>
          <button className="primary" type="button" onClick={carregarVisaoGeral} disabled={visaoStatus !== 'idle'}>
            {visaoStatus === 'carregando' ? 'Analisando...' : (visao ? 'Atualizar visÃ£o geral' : 'Carregar visÃ£o geral')}
          </button>
        </div>
        {visaoErro && <div className="sim-alert error" style={{ marginTop: 10 }}>{visaoErro}</div>}
        {visaoProgresso && (
          <div style={{ marginTop: 12, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 14px', fontSize: '0.85rem', color: '#1d4ed8', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #93c5fd', borderTop: '2px solid #1d4ed8', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            {visaoProgresso}
          </div>
        )}
        {visao && (
          <div className="sim-analise-tabela-wrap" style={{ marginTop: 12 }}>
            <table className="sim-analise-tabela">
              <thead>
                <tr>
                  <th>MÃªs</th><th>CT-es</th><th>Pronto p/ simular</th>
                  <th>Sem IBGE orig.</th><th>Sem IBGE dest.</th><th>Sem rota</th>
                  <th>Sem cubagem</th><th>Sem volume</th><th>Sem canal</th><th>Sem tomador</th>
                </tr>
              </thead>
              <tbody>
                {visao.linhas.map((l) => {
                  const cel = (v) => ({ color: v > 0 ? '#e67e22' : '#04C7A4', fontWeight: v > 0 ? 600 : 400 });
                  const pctPronto = l.total > 0 ? (l.pronto / l.total) * 100 : 0;
                  return (
                    <tr key={l.mes}>
                      <td style={{ fontWeight: 600 }}>{l.mes}</td>
                      <td>{fmtN(l.total)}</td>
                      <td style={{ color: pctPronto >= 99 ? '#04C7A4' : pctPronto >= 80 ? '#0ea5e9' : '#9b1111', fontWeight: 700 }}>{fmtN(l.pronto)} <small style={{ color: '#94a3b8', fontWeight: 400 }}>({pct(pctPronto)})</small></td>
                      <td style={cel(l.semOrigem)}>{fmtN(l.semOrigem)}</td>
                      <td style={cel(l.semDestino)}>{fmtN(l.semDestino)}</td>
                      <td style={cel(l.semRota)}>{fmtN(l.semRota)}</td>
                      <td style={cel(l.semCubagem)}>{fmtN(l.semCubagem)}</td>
                      <td style={cel(l.semVolumes)}>{fmtN(l.semVolumes)}</td>
                      <td style={cel(l.semCanal)}>{fmtN(l.semCanal)}</td>
                      <td style={cel(l.semTomador)}>{fmtN(l.semTomador)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid #e2e8f0', fontWeight: 700 }}>
                  <td>Total</td>
                  <td>{fmtN(visao.totalGeral)}</td>
                  <td colSpan={8} style={{ color: '#334155' }}>Pronto p/ simular: {fmtN(visao.prontoGeral)} ({pct(visao.totalGeral > 0 ? (visao.prontoGeral / visao.totalGeral) * 100 : 0)})</td>
                </tr>
              </tfoot>
            </table>
            <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: 6 }}>
              "Pronto p/ simular" = tem IBGE origem e destino, chave de rota, cubagem &gt; 0 e volume &gt; 0. Para fechar um mÃªs, selecione-o acima e use <strong>Analisar base</strong> + <strong>Completar base</strong>.
            </div>
          </div>
        )}
      </section>

      {diag && (
        <>
          <div className="summary-strip" style={{ flexWrap: 'wrap', gap: '0.75rem', margin: '1rem 0' }}>
            <Card label="CT-es na competÃªncia" valor={fmtN(diag.total)} cor="#9153F0" />
            <Card label="Com IBGE completo" valor={fmtN(diag.comCompleto)} sub={pct(diag.total > 0 ? (diag.comCompleto / diag.total) * 100 : 0)} cor="#04C7A4" />
            <Card label="Sem IBGE origem" valor={fmtN(diag.semOrigem)} cor="#e67e22" />
            <Card label="Sem IBGE destino" valor={fmtN(diag.semDestino)} cor="#e67e22" />
            <Card label="Sem chave rota" valor={fmtN(diag.semChaveRota)} cor="#e67e22" />
            <Card label="IBGE ok falso" valor={fmtN(diag.ibgeOkFalse)} cor="#e67e22" />
            <Card label="Com volumetria" valor={fmtN(diag.comVolumetria)} sub={pct(diag.total > 0 ? (diag.comVolumetria / diag.total) * 100 : 0)} cor="#0ea5e9" />
            <Card label="Sem volumes" valor={fmtN(diag.semVolumes)} cor="#e67e22" />
            <Card label="Sem cubagem" valor={fmtN(diag.semCubagem)} cor="#e67e22" />
            <Card label="Vou preencher" valor={fmtN(diag.vouPreencher)} sub={`${fmtN(diag.vaiPreencherIbge)} IBGE Â· ${fmtN(diag.vaiPreencherRota)} rota Â· ${fmtN(diag.vaiPreencherVolumetria)} vol/cubagem`} cor="#9b1111" destaque={diag.vouPreencher > 0} />
          </div>
          <div style={{ fontSize: '0.74rem', color: '#94a3b8', margin: '-0.5rem 0 0.75rem' }}>
            Base de IBGE: {diag.ibgeFonte || 'â€”'} Â· {fmtN(diag.ibgeQtd)} municÃ­pios carregados.
          </div>

          {(diag.semMatchTracking > 0 || diag.trackingErro) && (
            <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '10px 16px', marginBottom: '1rem', fontSize: '0.84rem', color: '#9a3412' }}>
              {diag.trackingErro
                ? <><strong>Tracking indisponÃ­vel:</strong> {diag.trackingErro}. Sem o tracking, origem, volumes e cubagem nÃ£o tÃªm como ser enriquecidos â€” resolva o acesso e analise de novo.</>
                : <><strong>{fmtN(diag.semMatchTracking)}</strong> CT-e(s) com alguma pendÃªncia nÃ£o tiveram correspondÃªncia no tracking (por chave CT-e / NF-e / nota). Esses sÃ³ completam quando o tracking deles entrar.</>}
            </div>
          )}

          <section className="sim-card" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ fontSize: '0.88rem', color: '#334155' }}>
                {diag.vouPreencher > 0
                  ? <><strong>{fmtN(diag.vouPreencher)}</strong> CT-e(s) com dados resolvÃ­veis. Clique para gravar IBGE faltante, recalcular <code>chave_rota_ibge/ibge_ok</code> e sincronizar <code>qtd_volumes/cubagem/peso_cubado</code> com o tracking.</>
                  : <>Nada a preencher â€” tudo que dava pra resolver automaticamente jÃ¡ estÃ¡ na base.</>}
              </div>
              <button className="primary" type="button" onClick={completar} disabled={ocupado || !diag.vouPreencher}>
                {status === 'completando' ? 'Gravando...' : `Completar base (${fmtN(diag.vouPreencher)})`}
              </button>
            </div>
          </section>

          {diag.topNaoResolvidas.length > 0 && (
            <div className="panel-card" style={{ marginBottom: '1rem' }}>
              <div className="panel-title" style={{ marginBottom: '0.5rem' }}>Cidades que ficaram sem IBGE <span style={{ fontWeight: 400, fontSize: '0.8rem', color: '#94a3b8' }}>â€” nÃ£o encontradas na planilha (revisar nome/UF ou cadastrar em ibge_municipios)</span></div>
              <div className="sim-analise-tabela-wrap">
                <table className="sim-analise-tabela">
                  <thead><tr><th>Cidade/UF</th><th>CT-es</th></tr></thead>
                  <tbody>
                    {diag.topNaoResolvidas.map((r) => (
                      <tr key={r.cidade}><td>{r.cidade}</td><td>{fmtN(r.qtd)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="panel-card">
            <div className="panel-title" style={{ marginBottom: '0.5rem' }}>Arquivos da competÃªncia</div>
            <div className="sim-analise-tabela-wrap">
              <table className="sim-analise-tabela">
                <thead><tr><th>Arquivo de origem</th><th>CT-es</th><th>Com pendÃªncia</th><th>% completo</th></tr></thead>
                <tbody>
                  {diag.arquivos.map((a) => (
                    <tr key={a.arquivo}>
                      <td>{a.arquivo}</td>
                      <td>{fmtN(a.total)}</td>
                      <td style={{ color: a.sem ? '#e67e22' : '#04C7A4', fontWeight: a.sem ? 600 : 400 }}>{fmtN(a.sem)}</td>
                      <td>{pct(a.total > 0 ? ((a.total - a.sem) / a.total) * 100 : 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
