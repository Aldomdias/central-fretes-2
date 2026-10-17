import { useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../lib/supabaseClient';

const hora = (v) => (v ? new Date(v).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : '-');
const diaHora = (v) => (v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '') : '-');
const EM_ANDAMENTO_MAX_MS = 6 * 60 * 1000; // uma chamada dura no maximo ~5 min; passou disso sem fechar, morreu

// Proxima execucao agendada (horas/dias da configuracao, horario de Brasilia).
function proximaExecucao(config) {
  if (!config?.ativo) return null;
  const horas = (config.horas || []).map(Number).sort((a, b) => a - b);
  const dias = new Set((config.dias_semana || []).map(Number));
  if (!horas.length || !dias.size) return null;
  const agoraBr = new Date(Date.now() - 3 * 3600000);
  for (let d = 0; d < 8; d += 1) {
    const dia = new Date(Date.UTC(agoraBr.getUTCFullYear(), agoraBr.getUTCMonth(), agoraBr.getUTCDate() + d));
    if (!dias.has(dia.getUTCDay())) continue;
    for (const h of horas) {
      const quando = new Date(dia.getTime() + h * 3600000);
      if (quando > agoraBr) return new Date(quando.getTime() + 3 * 3600000); // volta para UTC
    }
  }
  return null;
}

// Aviso do topo: o servidor esta trabalhando agora (rodada em andamento) ou parado, com a ultima e a proxima rodada.
export default function StatusServidorRobo({ config }) {
  const [linhas, setLinhas] = useState(null);
  const [agora, setAgora] = useState(Date.now());

  useEffect(() => {
    let ativo = true;
    const carregar = async () => {
      try {
        const { data } = await getSupabaseClient().from('auditor_robo_rodadas')
          .select('cadeia_id,origem,iniciado_em,finalizado_em,analisadas,reavaliadas,enviadas_gestao,laudos,revisar,restantes,novas_encontradas')
          .neq('origem', 'navegador').order('iniciado_em', { ascending: false }).limit(80);
        if (ativo) { setLinhas(data || []); setAgora(Date.now()); }
      } catch { if (ativo) setLinhas([]); }
    };
    carregar();
    const t = setInterval(carregar, 30000);
    return () => { ativo = false; clearInterval(t); };
  }, []);

  const status = useMemo(() => {
    if (!linhas?.length) return null;
    const cadeiaId = linhas[0].cadeia_id; // rodada mais recente do servidor
    const daCadeia = linhas.filter((l) => l.cadeia_id === cadeiaId).sort((a, b) => String(a.iniciado_em).localeCompare(String(b.iniciado_em)));
    const ultima = daCadeia[daCadeia.length - 1];
    const emAndamento = !ultima.finalizado_em && agora - new Date(ultima.iniciado_em).getTime() < EM_ANDAMENTO_MAX_MS;
    const tratadas = daCadeia.reduce((a, l) => a + (l.analisadas || 0) + (l.reavaliadas || 0), 0);
    return {
      emAndamento,
      inicio: daCadeia[0].iniciado_em,
      fim: ultima.finalizado_em,
      chamadas: daCadeia.length,
      tratadas,
      gestao: daCadeia.reduce((a, l) => a + (l.enviadas_gestao || 0), 0),
      laudos: daCadeia.reduce((a, l) => a + (l.laudos || 0), 0),
      revisar: daCadeia.reduce((a, l) => a + (l.revisar || 0), 0),
      restantes: emAndamento ? Math.max((ultima.novas_encontradas || 0), ultima.restantes || 0) : (ultima.restantes || 0),
      origem: daCadeia[0].origem,
    };
  }, [linhas, agora]);

  const proxima = proximaExecucao(config);
  const verde = status?.emAndamento;

  return (
    <div className="hint-box compact" style={{ borderLeft: `4px solid ${verde ? '#14733b' : '#94a3b8'}`, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 18 }}>{verde ? '🟢' : '⚪'}</span>
      {linhas === null && <span>Consultando o servidor...</span>}
      {linhas !== null && !status && <span><strong>Servidor:</strong> nenhuma rodada registrada ainda.</span>}
      {status && verde && (
        <span>
          <strong>Servidor trabalhando agora</strong> — rodada iniciada as {hora(status.inicio)} · {status.chamadas}ª chamada em andamento ·
          {' '}{status.tratadas} fatura(s) tratada(s) ({status.gestao} para a gestao, {status.laudos} laudos, {status.revisar} para revisar)
          {status.restantes ? ` · faltam ~${status.restantes}` : ''}
        </span>
      )}
      {status && !verde && (
        <span>
          <strong>Servidor parado</strong> — ultima rodada {diaHora(status.inicio)}{status.fim ? ` (terminou ${hora(status.fim)})` : ''}:
          {' '}{status.tratadas} fatura(s) tratada(s) em {status.chamadas} chamada(s){status.restantes ? `, ${status.restantes} ficaram para a proxima` : ''}.
        </span>
      )}
      <span style={{ marginLeft: 'auto', fontSize: 12, color: '#475569' }}>
        {config && !config.ativo ? 'Robo automatico DESLIGADO' : (proxima ? `Proxima rodada automatica: ${diaHora(proxima)}` : '')}
        {' · '}atualiza a cada 30 s
      </span>
    </div>
  );
}
