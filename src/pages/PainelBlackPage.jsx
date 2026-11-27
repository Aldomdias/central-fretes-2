import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import modeloHtml from './robos/painelBlackModelo.html?raw';

// Painel Black (cargas YVEC): o robo roda no PC do Aldo (C:\robo_black), puxa a ZEWM003 do SAP
// (a processar, processados e carregados), calcula o saldo por origem x transportadora e publica
// em robo_black_snapshot. Aqui so se mostra a ultima foto, recarregando a cada 5 minutos.
const ATUALIZA_MS = 5 * 60 * 1000;
const dataHora = (v) => (v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-');

function situacao(snapshot, ultimaRodada) {
  if (!snapshot) return { cor: '#b91c1c', texto: 'O robô ainda não publicou nenhuma rodada.' };
  if (ultimaRodada?.status === 'ERRO') return { cor: '#b91c1c', texto: `Última rodada falhou: ${ultimaRodada.erro || 'sem detalhe'}` };
  const agora = new Date();
  const minutos = Math.round((agora - new Date(snapshot.gerado_em)) / 60000);
  const emHorario = agora.getDay() >= 1 && agora.getDay() <= 5 && agora.getHours() >= 7 && agora.getHours() < 19;
  if (emHorario && minutos > 75) return { cor: '#c2410c', texto: `Sem atualização há ${minutos} min. O PC do robô está ligado e logado?` };
  return { cor: '#14733b', texto: `Atualizado em ${dataHora(snapshot.gerado_em)} (há ${minutos < 60 ? `${minutos} min` : `${Math.floor(minutos / 60)} h`}).` };
}

function montarHtml(payload) {
  const p = payload || {};
  const json = (v) => JSON.stringify(v ?? null).replace(/</g, '\\u003c');
  return modeloHtml
    .replace('__DADOS__', () => json(p.dados || []))
    .replace('__LIMITES__', () => json(p.limites || {}))
    .replace('__DIARIO__', () => json(p.diario || []))
    .replace('__CAPACIDADE__', () => json(p.capacidade || {}))
    .replaceAll('__HOJE__', () => p.hoje || '')
    .replaceAll('__DIA__', () => p.dia_br || '')
    .replaceAll('__INICIO__', () => p.inicio_br || '')
    .replaceAll('__ATUALIZADO__', () => p.atualizado || '')
    .replaceAll('__TIPOS__', () => p.tipos || 'YVEC');
}

export default function PainelBlackPage() {
  const [snapshot, setSnapshot] = useState(null);
  const [rodada, setRodada] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    if (!isSupabaseConfigured()) { setCarregando(false); setErro('Supabase não configurado.'); return; }
    setCarregando(true);
    const client = getSupabaseClient();
    const [s, r] = await Promise.all([
      client.from('robo_black_snapshot').select('dia,gerado_em,payload,resumo').eq('id', 'atual').maybeSingle(),
      client.from('robo_black_rodadas').select('status,erro,created_at').order('created_at', { ascending: false }).limit(1),
    ]);
    setErro(s.error?.message || r.error?.message || '');
    if (s.data) setSnapshot(s.data);
    setRodada(r.data?.[0] || null);
    setCarregando(false);
  }, []);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, ATUALIZA_MS);
    return () => clearInterval(t);
  }, [carregar]);

  const html = useMemo(() => (snapshot ? montarHtml(snapshot.payload) : ''), [snapshot]);
  const st = situacao(snapshot, rodada);

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <h1>Painel Black · Cargas YVEC</h1>
          <p>Saldo por origem × transportadora contra o limite do dia, ranking dos piores cenários e saída por unidade. Dados do SAP (ZEWM003) publicados pelo robô.</p>
        </div>
      </div>

      <div className="table-card" style={{ borderLeft: `4px solid ${st.cor}`, padding: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong style={{ color: st.cor }}>{carregando && !snapshot ? 'Carregando…' : st.texto}</strong>
        <button type="button" className="btn-secondary audit-small-button" onClick={carregar} disabled={carregando}>Atualizar agora</button>
        {erro && <span className="error-text">{erro}</span>}
      </div>

      {snapshot ? (
        <iframe
          title="Painel Black"
          srcDoc={html}
          style={{ width: '100%', height: 'calc(100vh - 210px)', minHeight: 700, border: '1px solid #e2e8f0', borderRadius: 12, background: '#f4f5f7' }}
        />
      ) : (!carregando && (
        <div className="panel-card"><p>Nenhum dado publicado ainda. Rode o robô no PC (C:\robo_black\Atualizar Robo Black.bat).</p></div>
      ))}
    </div>
  );
}
