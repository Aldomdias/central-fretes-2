import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import modeloHtml from './robos/painelBlackModelo.html?raw';
import logoAmdLog from '../assets/amdlog-logo-faixa.png';

// Painel Black (cargas YVEC): o robo roda no PC do Aldo (C:\robo_black), puxa a ZEWM003 do SAP
// (a processar, processados e carregados), calcula o saldo por origem x transportadora e publica
// em robo_black_snapshot. Aqui so se mostra a ultima foto.
// O robo roda a cada 20 min. A tela confere a cada 2 min se saiu foto nova (consulta leve, so a data)
// e so baixa o painel inteiro quando muda: a atualizacao aparece no maximo ~2 min depois do robo.
const VERIFICA_MS = 2 * 60 * 1000;
const ATRASO_ALERTA_MIN = 60; // robo de 20 em 20 min (rodada pode levar ate ~10): so alerta passando de 1 hora
const dataHora = (v) => (v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-');

function situacao(snapshot, ultimaRodada) {
  if (!snapshot) return { cor: '#b91c1c', texto: 'O robô ainda não publicou nenhuma rodada.' };
  if (ultimaRodada?.status === 'ERRO') return { cor: '#b91c1c', texto: `Última rodada falhou: ${ultimaRodada.erro || 'sem detalhe'}` };
  const agora = new Date();
  const minutos = Math.round((agora - new Date(snapshot.gerado_em)) / 60000);
  const emHorario = agora.getDay() >= 1 && agora.getDay() <= 5 && agora.getHours() >= 7 && agora.getHours() < 19;
  if (emHorario && minutos > ATRASO_ALERTA_MIN) return { cor: '#c2410c', texto: `Sem atualização há ${minutos} min. O PC do robô está ligado e logado?` };
  return { cor: '#14733b', texto: `Atualizado em ${dataHora(snapshot.gerado_em)} (há ${minutos < 60 ? `${minutos} min` : `${Math.floor(minutos / 60)} h`}).` };
}

// Ajustes feitos na tela (limite editado, bloqueio/desbloqueio/inativacao manual) ficam numa linha propria
// (id = 'ajustes') da mesma tabela do snapshot: o robo so mexe na linha 'atual', entao nao conflita.
const AJUSTES_ID = 'ajustes';
function limparAjustes(a) {
  const x = a && typeof a === 'object' ? a : {};
  const limites = {};
  Object.entries(x.limites || {}).forEach(([k, v]) => { const n = Number(v); if (k && Number.isFinite(n) && n > 0) limites[String(k)] = n; });
  const manual = {};
  Object.entries(x.manual || {}).forEach(([k, v]) => { if (k && ['bloq', 'inativ', 'desbloq', ''].includes(v)) manual[String(k)] = v; });
  return { limites, manual, soPlaca: x.soPlaca === true };
}

function montarHtml(payload, ajustes, editavel) {
  const p = payload || {};
  const json = (v) => JSON.stringify(v ?? null).replace(/</g, '\\u003c');
  return modeloHtml
    .replace('__DADOS__', () => json(p.dados || []))
    .replace('__LIMITES__', () => json(p.limites || {}))
    .replace('__DIARIO__', () => json(p.diario || []))
    .replace('__CAPACIDADE__', () => json(p.capacidade || {}))
    .replace('__AJUSTES__', () => json(ajustes || {}))
    .replace('__EDITAVEL__', () => (editavel ? 'true' : 'false'))
    .replaceAll('__HOJE__', () => p.hoje || '')
    .replaceAll('__DIA__', () => p.dia_br || '')
    .replaceAll('__INICIO__', () => p.inicio_br || '')
    .replaceAll('__ATUALIZADO__', () => p.atualizado || '')
    .replaceAll('__TIPOS__', () => p.tipos || 'YVEC');
}

// modoPainel: conta compartilhada so do Painel Black (ex.: TV da equipe). O App nao mostra menu,
// cabecalho nem botoes flutuantes; a tela ocupa a janela toda e so tem Atualizar, Tela cheia e Sair.
export default function PainelBlackPage({ modoPainel = false, onSair } = {}) {
  const [snapshot, setSnapshot] = useState(null);
  const [rodada, setRodada] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [telaCheia, setTelaCheia] = useState(false);
  const [, setRelogio] = useState(0); // re-render periodico para o "ha X min" andar sozinho
  const [versaoAj, setVersaoAj] = useState(0); // sobe quando outra pessoa altera os ajustes: remonta o painel
  const geradoEmRef = useRef(null);
  const quadroRef = useRef(null);
  const iframeRef = useRef(null);
  const ajustesRef = useRef(limparAjustes({}));
  const salvouEmRef = useRef(0);

  // forcar = true baixa tudo; senao confere so a data da ultima foto e baixa o painel se mudou.
  const carregar = useCallback(async (forcar = false) => {
    if (!isSupabaseConfigured()) { setCarregando(false); setErro('Supabase não configurado.'); return; }
    setCarregando(true);
    try {
      const client = getSupabaseClient();
      const [cab, r, aj] = await Promise.all([
        client.from('robo_black_snapshot').select('gerado_em').eq('id', 'atual').maybeSingle(),
        client.from('robo_black_rodadas').select('status,erro,created_at').order('created_at', { ascending: false }).limit(1),
        client.from('robo_black_snapshot').select('payload').eq('id', AJUSTES_ID).maybeSingle(),
      ]);
      // ajustes de outra pessoa: so aplica se mudou e se nao acabamos de salvar (evita voltar a edicao em andamento)
      if (!aj.error && Date.now() - salvouEmRef.current > 15000) {
        const novo = limparAjustes(aj.data?.payload);
        if (JSON.stringify(novo) !== JSON.stringify(ajustesRef.current)) {
          ajustesRef.current = novo;
          setVersaoAj((v) => v + 1);
        }
      }
      let erroMsg = cab.error?.message || r.error?.message || '';
      if (!r.error) setRodada(r.data?.[0] || null);
      const novo = cab.data?.gerado_em || null;
      if (!cab.error && novo && (forcar || novo !== geradoEmRef.current)) {
        const s = await client.from('robo_black_snapshot').select('dia,gerado_em,payload,resumo').eq('id', 'atual').maybeSingle();
        if (s.error) erroMsg = s.error.message;
        else if (s.data) { geradoEmRef.current = s.data.gerado_em; setSnapshot(s.data); }
      }
      setErro(erroMsg);
    } catch (e) {
      setErro(e?.message || 'Falha ao consultar o painel.');
    } finally {
      setCarregando(false);
      setRelogio((n) => n + 1);
    }
  }, []);

  useEffect(() => {
    carregar(true);
    const t = setInterval(() => carregar(false), VERIFICA_MS);
    // ao voltar para a aba/ligar a tela, confere na hora em vez de esperar o proximo ciclo
    const aoVoltar = () => { if (document.visibilityState === 'visible') carregar(false); };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', aoVoltar); };
  }, [carregar]);

  // O painel (iframe) avisa quando alguem edita limite / libera contagem / marca bloqueio manual: salva para todos.
  useEffect(() => {
    if (modoPainel) return undefined;
    const aoMensagem = async (e) => {
      const d = e.data;
      if (!d || d.fonte !== 'painelBlack' || d.tipo !== 'ajustes') return;
      if (e.source !== iframeRef.current?.contentWindow) return;
      const a = limparAjustes(d.ajustes);
      ajustesRef.current = a;
      salvouEmRef.current = Date.now();
      try {
        const client = getSupabaseClient();
        const { error } = await client.from('robo_black_snapshot').upsert({
          id: AJUSTES_ID,
          dia: new Date().toISOString().slice(0, 10),
          payload: a,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });
        if (error) setErro(`Não salvou o ajuste: ${error.message}`);
        else setErro('');
      } catch (err) {
        setErro(`Não salvou o ajuste: ${err?.message || err}`);
      }
    };
    window.addEventListener('message', aoMensagem);
    return () => window.removeEventListener('message', aoMensagem);
  }, [modoPainel]);

  // Tela cheia: usa o modo tela cheia do navegador quando existe; se nao (ex.: iPhone), cobre a janela.
  const entrarTelaCheia = useCallback(async () => {
    setTelaCheia(true);
    try { await quadroRef.current?.requestFullscreen?.(); } catch { /* fica so a cobertura da janela */ }
  }, []);
  const sairTelaCheia = useCallback(async () => {
    setTelaCheia(false);
    if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch { /* ignora */ } }
  }, []);
  useEffect(() => {
    const aoMudar = () => { if (!document.fullscreenElement) setTelaCheia(false); };
    const aoTeclar = (e) => { if (e.key === 'Escape') setTelaCheia(false); };
    document.addEventListener('fullscreenchange', aoMudar);
    window.addEventListener('keydown', aoTeclar);
    return () => { document.removeEventListener('fullscreenchange', aoMudar); window.removeEventListener('keydown', aoTeclar); };
  }, []);
  // Em tela cheia (TV/monitor da equipe), pede para a tela nao apagar.
  useEffect(() => {
    if (!telaCheia || !navigator.wakeLock?.request) return undefined;
    let trava = null;
    let ativo = true;
    const pedir = () => navigator.wakeLock.request('screen').then((t) => { if (ativo) trava = t; else t.release(); }).catch(() => {});
    pedir();
    const aoVoltar = () => { if (document.visibilityState === 'visible') pedir(); };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => { ativo = false; document.removeEventListener('visibilitychange', aoVoltar); trava?.release?.().catch(() => {}); };
  }, [telaCheia]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const html = useMemo(() => (snapshot ? montarHtml(snapshot.payload, ajustesRef.current, !modoPainel) : ''), [snapshot, versaoAj, modoPainel]);
  const st = situacao(snapshot, rodada);

  const cheio = modoPainel || telaCheia;
  const faixa = (
    <div className="table-card" style={{ borderLeft: `4px solid ${st.cor}`, padding: cheio ? '6px 12px' : 12, margin: 0, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, paddingRight: 12, borderRight: '1px solid #e2e8f0' }}>
        <img src={logoAmdLog} alt="AMD LOG" style={{ height: cheio ? 44 : 46, width: 'auto', display: 'block' }} />
        <img src="/logo_cantu.png" alt="Cantu" style={{ height: cheio ? 20 : 22, width: 'auto', display: 'block' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      </span>
      <strong style={{ color: st.cor }}>{carregando && !snapshot ? 'Carregando…' : st.texto}</strong>
      <span style={{ color: '#64748b', fontSize: 12 }}>Atualiza sozinho.</span>
      <span style={{ flex: 1 }} />
      <button type="button" className="btn-secondary audit-small-button" onClick={() => carregar(true)} disabled={carregando}>Atualizar agora</button>
      {telaCheia ? (
        <button type="button" className="btn-secondary audit-small-button" onClick={sairTelaCheia}>Sair da tela cheia</button>
      ) : (
        <button type="button" className="btn-secondary audit-small-button" onClick={entrarTelaCheia} disabled={!snapshot}>Tela cheia</button>
      )}
      {modoPainel && onSair && (
        <button type="button" className="btn-secondary audit-small-button" onClick={onSair} title="Sair desta conta">Sair</button>
      )}
      {erro && <span className="error-text">{erro}</span>}
    </div>
  );

  const quadro = (
    <div
      ref={quadroRef}
      style={cheio
        ? { position: 'fixed', inset: 0, zIndex: 9999, background: '#f4f5f7', display: 'flex', flexDirection: 'column', gap: 6, padding: 6 }
        : { display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      {faixa}
      {snapshot ? (
        <iframe
          ref={iframeRef}
          title="Painel Black"
          srcDoc={html}
          style={cheio
            ? { width: '100%', flex: 1, minHeight: 0, border: 0, borderRadius: 8, background: '#f4f5f7' }
            : { width: '100%', height: 'calc(100vh - 210px)', minHeight: 700, border: '1px solid #e2e8f0', borderRadius: 12, background: '#f4f5f7' }}
        />
      ) : (!carregando && (
        <div className="panel-card"><p>Nenhum dado publicado ainda. Rode o robô no PC (C:\robo_black\Atualizar Robo Black.bat).</p></div>
      ))}
    </div>
  );

  if (modoPainel) return quadro;

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <h1>Painel Black</h1>
          <p>Saldo por origem × transportadora contra o limite do dia, ranking dos piores cenários e saída por unidade. Dados do SAP (ZEWM003) publicados pelo robô.</p>
        </div>
      </div>

      {quadro}
    </div>
  );
}
