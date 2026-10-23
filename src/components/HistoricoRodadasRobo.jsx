import { useEffect, useMemo, useState } from 'react';
import { listarRodadasRobo } from '../services/auditorRoboService';

const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataHora = (v) => (v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '') : '-');
const duracao = (ms) => {
  const s = Math.round(Number(ms || 0) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60}s` : `${s}s`;
};
const ORIGEM = { cron: 'Automatica (agenda)', manual: 'Manual (link)', encadeada: 'Continuacao', continuacao_hora: 'Continuacao (hora seguinte)', navegador: 'Navegador (Executar agora)' };
const DECISAO = {
  ENVIAR_APROVACAO: { texto: 'Enviada para a gestao', cor: '#7c3aed' },
  ENVIAR_LAUDO: { texto: 'Laudo com desconto', cor: '#b45309' },
  REVISAO_AUDITOR: { texto: 'Para revisar', cor: '#b91c1c' },
};

// Historico de execucoes do robo: cada RODADA (ex.: a das 19h) junta a chamada inicial e as continuacoes
// encadeadas (mesmo cadeia_id). Mostra o que entrou e o que foi feito, com a lista de faturas.
export default function HistoricoRodadasRobo() {
  const [linhas, setLinhas] = useState(null);
  const [semTabela, setSemTabela] = useState(false);
  const [erro, setErro] = useState('');
  const [aberta, setAberta] = useState(null);
  const [aberto, setAberto] = useState(true);

  const carregar = () => listarRodadasRobo().then(({ lista, semTabela: s }) => { setLinhas(lista); setSemTabela(s); setErro(''); })
    .catch((e) => { setErro(e.message); setLinhas([]); });
  useEffect(() => { carregar(); }, []);

  const rodadas = useMemo(() => {
    const mapa = new Map();
    (linhas || []).forEach((l) => {
      const r = mapa.get(l.cadeia_id) || {
        id: l.cadeia_id, chamadas: [], inicio: l.iniciado_em, fim: l.finalizado_em, origem: l.origem, duracaoMs: 0,
        novas: 0, analisadas: 0, reavaliadas: 0, enviadas: 0, laudos: 0, revisar: 0, restantes: 0, erros: [], faturas: [], calcular: l.calcular_nuvem,
      };
      r.chamadas.push(l);
      if (String(l.iniciado_em) < String(r.inicio)) r.inicio = l.iniciado_em;
      if (String(l.finalizado_em) > String(r.fim)) r.fim = l.finalizado_em;
      if (l.origem !== 'encadeada') r.origem = l.origem;
      r.duracaoMs += Number(l.duracao_ms || 0);
      r.analisadas += l.analisadas || 0;
      r.reavaliadas += l.reavaliadas || 0;
      r.enviadas += l.enviadas_gestao || 0;
      r.laudos += l.laudos || 0;
      r.revisar += l.revisar || 0;
      r.erros.push(...(l.erros || []));
      r.faturas.push(...(l.faturas || []));
      mapa.set(l.cadeia_id, r);
    });
    return [...mapa.values()].map((r) => {
      const ordenadas = [...r.chamadas].sort((a, b) => String(a.iniciado_em).localeCompare(String(b.iniciado_em)));
      const ultima = ordenadas[ordenadas.length - 1] || {};
      // "Ficou para depois" separa faturas NOVAS (a proxima rodada pega primeiro) das reavaliacoes de revisao/laudo.
      const novasRestantes = Math.max(Number(ultima.novas_encontradas || 0) - Number(ultima.analisadas || 0), 0);
      const restantes = Number(ultima.restantes || 0);
      return { ...r, novas: ordenadas[0]?.novas_encontradas || 0, restantes, novasRestantes, reavRestantes: Math.max(restantes - novasRestantes, 0) };
    }).sort((a, b) => String(b.inicio).localeCompare(String(a.inicio)));
  }, [linhas]);

  const rodadaAberta = rodadas.find((r) => r.id === aberta);

  return (
    <div className="table-card">
      <div className="panel-title audit-table-title" style={{ cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }} onClick={() => setAberto((v) => !v)}>
        <span>{aberto ? '▾' : '▸'} Historico de execucoes</span>
        <span style={{ fontWeight: 400, fontSize: 12, color: '#475569' }}>cada linha e uma rodada (ex.: a das 19h, com as continuacoes); clique para ver as faturas</span>
        <button type="button" className="btn-secondary audit-small-button" style={{ marginLeft: 'auto' }} onClick={(ev) => { ev.stopPropagation(); carregar(); }}>Atualizar</button>
      </div>
      {aberto && (
        <div style={{ padding: '0 12px 12px' }}>
          {semTabela && (
            <div className="hint-box compact" style={{ borderLeft: '4px solid #b91c1c', marginBottom: 8 }}>
              Aplique a migration <code>supabase/migrations/20261017_001_auditor_robo_rodadas.sql</code> para o historico comecar a ser gravado.
            </div>
          )}
          {erro && <div className="hint-box compact" style={{ borderLeft: '4px solid #b91c1c', marginBottom: 8 }}>{erro}</div>}
          {linhas === null && <div>Carregando...</div>}
          {linhas !== null && !rodadas.length && !semTabela && <div style={{ color: '#64748b' }}>Nenhuma execucao registrada ainda (o historico comeca a partir desta versao).</div>}
          {rodadas.length > 0 && (
            <div className="sim-analise-tabela-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
              <table className="sim-analise-tabela">
                <thead>
                  <tr>
                    <th>Inicio</th><th>Origem</th><th>Calculo</th><th>Novas encontradas</th><th>Analisadas</th><th>Reavaliadas</th>
                    <th>Para a gestao</th><th>Laudos</th><th>Para revisar</th><th>Ficou para depois</th><th>Tempo</th><th>Chamadas</th>
                  </tr>
                </thead>
                <tbody>
                  {rodadas.map((r) => (
                    <tr key={r.id} onClick={() => setAberta(aberta === r.id ? null : r.id)} style={{ cursor: 'pointer', background: aberta === r.id ? '#eef2ff' : undefined }}>
                      <td>{dataHora(r.inicio)}</td>
                      <td>{ORIGEM[r.origem] || r.origem}</td>
                      <td>{r.calcular === false ? 'Sem' : 'Com'}</td>
                      <td>{r.novas}</td>
                      <td>{r.analisadas}</td>
                      <td>{r.reavaliadas}</td>
                      <td style={{ color: '#7c3aed', fontWeight: 700 }}>{r.enviadas}</td>
                      <td style={{ color: '#b45309', fontWeight: 700 }}>{r.laudos}</td>
                      <td style={{ color: '#b91c1c', fontWeight: 700 }}>{r.revisar}</td>
                      <td title="Novas: faturas ainda nao analisadas (a proxima rodada pega primeiro). Reav.: casos em revisao/laudo que ficaram para a proxima reavaliacao.">{r.restantes ? `${r.novasRestantes} novas · ${r.reavRestantes} reav.` : 0}{r.erros.length ? ` · ${r.erros.length} erro(s)` : ''}</td>
                      <td>{duracao(r.duracaoMs)}</td>
                      <td>{r.chamadas.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rodadaAberta && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                Rodada de {dataHora(rodadaAberta.inicio)} — {rodadaAberta.faturas.length} fatura(s) tratada(s)
              </div>
              {rodadaAberta.erros.length > 0 && (
                <div className="hint-box compact" style={{ borderLeft: '4px solid #b91c1c', marginBottom: 6, fontSize: 12 }}>{rodadaAberta.erros.slice(0, 10).join(' | ')}</div>
              )}
              <div className="sim-analise-tabela-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
                <table className="sim-analise-tabela">
                  <thead><tr><th>Fatura</th><th>Transportadora</th><th>Tipo</th><th>Resultado</th><th>A descontar</th><th>Detalhe</th></tr></thead>
                  <tbody>
                    {rodadaAberta.faturas.map((f, i) => (
                      <tr key={`${f.numero}-${i}`}>
                        <td>{f.numero}</td>
                        <td>{f.transportadora}</td>
                        <td>{f.tipo === 'reavaliada' ? 'Reavaliada' : 'Nova'}</td>
                        <td style={{ color: DECISAO[f.decisao]?.cor, fontWeight: 700 }}>{f.enviada && f.decisao === 'ENVIAR_APROVACAO' ? 'Enviada para a gestao' : (DECISAO[f.decisao]?.texto || f.decisao)}</td>
                        <td>{Number(f.valor_descontar) > 0 ? dinheiro(f.valor_descontar) : '-'}</td>
                        <td style={{ fontSize: 12, maxWidth: 420 }}>{f.motivo}</td>
                      </tr>
                    ))}
                    {!rodadaAberta.faturas.length && <tr><td colSpan={6} style={{ color: '#64748b' }}>Nenhuma fatura tratada nesta rodada (nada novo, ou o tempo acabou antes de fechar a primeira).</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
