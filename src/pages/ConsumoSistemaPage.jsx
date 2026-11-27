import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  carregarArmazenamentoTelemetria,
  carregarPainelTelemetria,
  limparTelemetriaAntiga,
} from '../services/telemetriaService';
import { formatarBytes, formatarMs, formatarSegundos, gerarRecomendacoes, rotuloTipo } from '../utils/consumoRecomendacoes';

const PERIODOS = [
  { chave: 'hoje', label: 'Hoje' },
  { chave: '24h', label: '24 horas' },
  { chave: '7d', label: '7 dias' },
  { chave: '30d', label: '30 dias' },
  { chave: '90d', label: '90 dias' },
];

const ABAS = [
  { chave: 'geral', label: 'Visão geral' },
  { chave: 'usuarios', label: 'Por usuário' },
  { chave: 'telas', label: 'Por tela' },
  { chave: 'banco', label: 'Tabelas consultadas' },
  { chave: 'processos', label: 'Processos' },
  { chave: 'armazenamento', label: 'Armazenamento' },
  { chave: 'online', label: 'Online agora' },
];

const COR = {
  barra: '#2563eb',
  trilho: 'rgba(100,116,139,.15)',
  muted: 'var(--text-muted, #64748b)',
  borda: 'var(--border-color, #e2e8f0)',
};
const NIVEL = {
  critico: { label: 'Crítico', icone: '⛔', fundo: '#fef2f2', cor: '#991b1b', borda: '#fecaca' },
  atencao: { label: 'Atenção', icone: '⚠️', fundo: '#fffbeb', cor: '#92400e', borda: '#fde68a' },
  info: { label: 'Info', icone: 'ℹ️', fundo: '#eff6ff', cor: '#1e40af', borda: '#bfdbfe' },
};

const n = (v) => Number(v) || 0;
const fmtNum = (v) => n(v).toLocaleString('pt-BR');
const fmtMb = (v) => (v == null || v === '' ? '-' : `${Math.round(n(v)).toLocaleString('pt-BR')} MB`);

function inicioPeriodo(chave) {
  const agora = new Date();
  if (chave === 'hoje') { const d = new Date(agora); d.setHours(0, 0, 0, 0); return d.toISOString(); }
  const horas = { '24h': 24, '7d': 168, '30d': 720, '90d': 2160 }[chave] || 24;
  return new Date(agora.getTime() - horas * 3600000).toISOString();
}

function formatarDataHora(valor) {
  if (!valor) return '-';
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

// Barra de proporcao (uma cor so: magnitude). O numero fica ao lado, em texto normal.
function Medidor({ valor, maximo, texto, titulo }) {
  const pct = maximo > 0 ? Math.max(2, Math.min(100, (n(valor) / maximo) * 100)) : 0;
  return (
    <div title={titulo || texto} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 140 }}>
      <div style={{ flex: 1, height: 8, borderRadius: 4, background: COR.trilho, overflow: 'hidden' }}>
        {n(valor) > 0 && <div style={{ width: `${pct}%`, height: '100%', background: COR.barra, borderRadius: 4 }} />}
      </div>
      <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', minWidth: 70, textAlign: 'right' }}>{texto}</span>
    </div>
  );
}

function Cartao({ titulo, valor, sub }) {
  return (
    <div style={{ border: `1px solid ${COR.borda}`, borderRadius: 12, padding: '12px 14px', minWidth: 150, flex: '1 1 150px' }}>
      <div style={{ fontSize: 12, color: COR.muted, fontWeight: 600 }}>{titulo}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
      {sub && <div style={{ fontSize: 12, color: COR.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Th({ children, onClick, ativo, dir, alinhar = 'left' }) {
  return (
    <th onClick={onClick} style={{ textAlign: alinhar, cursor: onClick ? 'pointer' : 'default', whiteSpace: 'nowrap', userSelect: 'none' }}>
      {children}{ativo ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );
}

function useOrdenacao(linhas, inicial) {
  const [ord, setOrd] = useState({ campo: inicial, dir: 'desc' });
  const ordenadas = useMemo(() => {
    const copia = [...(linhas || [])];
    copia.sort((a, b) => {
      const va = a[ord.campo]; const vb = b[ord.campo];
      const r = typeof va === 'string' || typeof vb === 'string' ? String(va || '').localeCompare(String(vb || '')) : n(va) - n(vb);
      return ord.dir === 'asc' ? r : -r;
    });
    return copia;
  }, [linhas, ord]);
  const th = (campo, label, alinhar = 'right') => (
    <Th alinhar={alinhar} ativo={ord.campo === campo} dir={ord.dir}
      onClick={() => setOrd((o) => ({ campo, dir: o.campo === campo && o.dir === 'desc' ? 'asc' : 'desc' }))}>{label}</Th>
  );
  return [ordenadas, th];
}

function exportarCsv(nome, linhas, colunas) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [colunas.map((c) => esc(c.label)).join(';'), ...linhas.map((l) => colunas.map((c) => esc(c.valor(l))).join(';'))].join('\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${nome}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export default function ConsumoSistemaPage() {
  const [periodo, setPeriodo] = useState('7d');
  const [usuarioFiltro, setUsuarioFiltro] = useState('');
  const [aba, setAba] = useState('geral');
  const [painel, setPainel] = useState(null);
  const [armazenamento, setArmazenamento] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [erroArmazenamento, setErroArmazenamento] = useState('');
  const [processoAberto, setProcessoAberto] = useState(null);
  const [tipoProcesso, setTipoProcesso] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      // 'ate' com folga: os horarios vem do relogio de cada computador, que pode estar a frente do servidor.
      const dados = await carregarPainelTelemetria({ desde: inicioPeriodo(periodo), ate: new Date(Date.now() + 3600000).toISOString(), usuarioId: usuarioFiltro || null });
      setPainel(dados);
    } catch (e) {
      const msg = String(e?.message || e);
      setErro(/telemetria_painel|does not exist|schema cache|function/i.test(msg)
        ? 'As tabelas de telemetria ainda não existem no banco. Aplique a migration supabase/migrations/20261126_005_telemetria_consumo.sql no Supabase (SQL Editor) e recarregue.'
        : msg);
    } finally {
      setCarregando(false);
    }
  }, [periodo, usuarioFiltro]);

  const carregarArmazenamento = useCallback(async () => {
    setErroArmazenamento('');
    try { setArmazenamento(await carregarArmazenamentoTelemetria()); } catch (e) { setErroArmazenamento(String(e?.message || e)); }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { carregarArmazenamento(); }, [carregarArmazenamento]);
  useEffect(() => {
    if (aba !== 'online') return undefined;
    const t = window.setInterval(carregar, 30000);
    return () => window.clearInterval(t);
  }, [aba, carregar]);

  const totais = painel?.totais || {};
  const usuarios = painel?.usuarios || [];
  const recomendacoes = useMemo(() => (painel ? gerarRecomendacoes(painel, armazenamento) : []), [painel, armazenamento]);
  const opcoesUsuario = useMemo(() => {
    const mapa = new Map();
    (painel?.usuarios || []).forEach((u) => mapa.set(u.usuario_id, u.usuario_nome || u.usuario_id));
    return [...mapa.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  }, [painel]);
  const [opcoesFixas, setOpcoesFixas] = useState([]);
  useEffect(() => { if (!usuarioFiltro && opcoesUsuario.length) setOpcoesFixas(opcoesUsuario); }, [opcoesUsuario, usuarioFiltro]);

  const limpar = async () => {
    if (!window.confirm('Apagar a telemetria com mais de 90 dias? Isso não pode ser desfeito.')) return;
    try {
      const qtd = await limparTelemetriaAntiga(90);
      window.alert(`${fmtNum(qtd)} registro(s) antigos apagados.`);
      carregar();
    } catch (e) { window.alert(`Não foi possível limpar: ${e.message}`); }
  };

  return (
    <div className="panel-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div className="panel-title">Consumo do Sistema</div>
          <p style={{ color: COR.muted, marginTop: -8, maxWidth: 760 }}>
            Quem está usando, por quanto tempo, e onde vai o processamento: dados baixados do banco, tempo de rede,
            CPU travada no navegador (tarefas longas), memória RAM e processos pesados. Cada navegador mede o próprio
            consumo e envia a cada 5 minutos.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} aria-label="Período">
            {PERIODOS.map((p) => <option key={p.chave} value={p.chave}>{p.label}</option>)}
          </select>
          <select value={usuarioFiltro} onChange={(e) => setUsuarioFiltro(e.target.value)} aria-label="Usuário">
            <option value="">Todos os usuários</option>
            {opcoesFixas.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
          </select>
          <button type="button" className="btn-secondary" onClick={() => { carregar(); carregarArmazenamento(); }} disabled={carregando}>
            {carregando ? 'Atualizando...' : 'Atualizar'}
          </button>
        </div>
      </div>

      {erro && <div style={{ padding: 12, borderRadius: 8, background: '#fef2f2', color: '#b91c1c', margin: '12px 0' }}>{erro}</div>}

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: `1px solid ${COR.borda}`, margin: '12px 0 16px' }}>
        {ABAS.map((a) => (
          <button key={a.chave} type="button" onClick={() => setAba(a.chave)}
            style={{ padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 700,
              color: aba === a.chave ? COR.barra : COR.muted, borderBottom: `2px solid ${aba === a.chave ? COR.barra : 'transparent'}`, marginBottom: -1 }}>
            {a.label}
            {a.chave === 'online' && painel?.online_agora ? ` (${painel.online_agora.length})` : ''}
            {a.chave === 'geral' && recomendacoes.filter((r) => r.nivel !== 'info').length ? ` · ${recomendacoes.filter((r) => r.nivel !== 'info').length} alerta(s)` : ''}
          </button>
        ))}
      </div>

      {painel && aba === 'geral' && <VisaoGeral totais={totais} painel={painel} recomendacoes={recomendacoes} armazenamento={armazenamento} />}
      {painel && aba === 'usuarios' && <AbaUsuarios usuarios={usuarios} onFiltrar={(id) => { setUsuarioFiltro(id); setAba('telas'); }} />}
      {painel && aba === 'telas' && <AbaTelas paginas={painel.paginas || []} />}
      {painel && aba === 'banco' && <AbaTabelas tabelas={painel.tabelas || []} totalBytes={n(totais.bytes_recebidos)} />}
      {painel && aba === 'processos' && (
        <AbaProcessos tipos={painel.processos_tipo || []} processos={painel.processos || []} tipo={tipoProcesso} onTipo={setTipoProcesso}
          aberto={processoAberto} onAbrir={setProcessoAberto} />
      )}
      {aba === 'armazenamento' && <AbaArmazenamento dados={armazenamento} erro={erroArmazenamento} onLimpar={limpar} />}
      {painel && aba === 'online' && <AbaOnline sessoes={painel.online_agora || []} />}

      {!painel && !erro && carregando && <p style={{ color: COR.muted }}>Carregando consumo...</p>}
    </div>
  );
}

function VisaoGeral({ totais, painel, recomendacoes }) {
  const online = n(totais.segundos_online);
  const ativo = n(totais.segundos_ativo);
  const porHora = painel.por_hora || [];
  const maxHora = Math.max(1, ...porHora.map((h) => n(h.bytes_recebidos)));
  const maxCpuHora = Math.max(1, ...porHora.map((h) => n(h.ms_cpu_travada)));
  return (
    <>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Cartao titulo="Usuários" valor={fmtNum(totais.usuarios)} sub={`${fmtNum(totais.sessoes)} sessão(ões) · ${(painel.online_agora || []).length} online agora`} />
        <Cartao titulo="Tempo conectado" valor={formatarSegundos(online)} sub={`${formatarSegundos(ativo)} em uso ativo${online ? ` (${Math.round((ativo / online) * 100)}%)` : ''}`} />
        <Cartao titulo="Dados baixados do banco" valor={formatarBytes(totais.bytes_recebidos)} sub={`${formatarBytes(totais.bytes_enviados)} enviados`} />
        <Cartao titulo="Requisições" valor={fmtNum(totais.requisicoes)} sub={`${formatarMs(totais.ms_rede)} esperando rede`} />
        <Cartao titulo="CPU travada (navegador)" valor={formatarMs(totais.ms_cpu_travada)} sub="tarefas > 50 ms (Chrome/Edge)" />
        <Cartao titulo="Pico de RAM" valor={fmtMb(Math.max(n(totais.heap_mb_max), ...(painel.usuarios || []).map((u) => n(u.heap_mb_max))) || null)} sub="memória JS de uma aba" />
        <Cartao titulo="Erros / timeouts" valor={`${fmtNum(totais.erros)} / ${fmtNum(totais.timeouts)}`} sub={`${fmtNum(totais.processos)} processo(s) medidos`} />
      </div>

      <div className="panel-title" style={{ marginTop: 22, fontSize: 16 }}>Onde agir</div>
      {!recomendacoes.length && <p style={{ color: COR.muted }}>Nada fora da curva no período. Conforme os dados forem chegando, os alertas aparecem aqui.</p>}
      <div style={{ display: 'grid', gap: 8 }}>
        {recomendacoes.map((r, i) => {
          const s = NIVEL[r.nivel];
          return (
            <div key={i} style={{ border: `1px solid ${s.borda}`, background: s.fundo, borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span aria-hidden>{s.icone}</span>
                <strong style={{ color: s.cor }}>{s.label}</strong>
                <span style={{ fontSize: 12, color: COR.muted }}>{r.area}</span>
                <strong>{r.titulo}</strong>
              </div>
              <div style={{ fontSize: 13, marginTop: 4 }}>{r.detalhe}</div>
              <div style={{ fontSize: 13, marginTop: 4 }}><strong>O que fazer:</strong> {r.acao}</div>
            </div>
          );
        })}
      </div>

      {porHora.length > 0 && (
        <>
          <div className="panel-title" style={{ marginTop: 22, fontSize: 16 }}>Carga por hora</div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tabela-simples" style={{ width: '100%' }}>
              <thead><tr><th style={{ textAlign: 'left' }}>Hora</th><th>Usuários</th><th style={{ textAlign: 'left' }}>Dados baixados</th><th style={{ textAlign: 'left' }}>CPU travada</th><th>Requisições</th></tr></thead>
              <tbody>
                {[...porHora].reverse().slice(0, 72).map((h) => (
                  <tr key={h.hora}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatarDataHora(h.hora)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtNum(h.usuarios)}</td>
                    <td><Medidor valor={h.bytes_recebidos} maximo={maxHora} texto={formatarBytes(h.bytes_recebidos)} /></td>
                    <td><Medidor valor={h.ms_cpu_travada} maximo={maxCpuHora} texto={formatarMs(h.ms_cpu_travada)} /></td>
                    <td style={{ textAlign: 'right' }}>{fmtNum(h.requisicoes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function AbaUsuarios({ usuarios, onFiltrar }) {
  const [linhas, th] = useOrdenacao(usuarios, 'bytes_recebidos');
  const maxBytes = Math.max(1, ...usuarios.map((u) => n(u.bytes_recebidos)));
  const maxOnline = Math.max(1, ...usuarios.map((u) => n(u.segundos_online)));
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button type="button" className="btn-secondary" onClick={() => exportarCsv('consumo-usuarios', linhas, [
          { label: 'Usuário', valor: (u) => u.usuario_nome }, { label: 'E-mail', valor: (u) => u.usuario_email },
          { label: 'Perfil', valor: (u) => u.perfil }, { label: 'Sessões', valor: (u) => u.sessoes },
          { label: 'Online (min)', valor: (u) => Math.round(n(u.segundos_online) / 60) }, { label: 'Ativo (min)', valor: (u) => Math.round(n(u.segundos_ativo) / 60) },
          { label: 'Ocioso (min)', valor: (u) => Math.round(n(u.segundos_ocioso) / 60) }, { label: 'Aba escondida (min)', valor: (u) => Math.round(n(u.segundos_oculto) / 60) },
          { label: 'Requisições', valor: (u) => u.requisicoes }, { label: 'MB baixados', valor: (u) => (n(u.bytes_recebidos) / 1048576).toFixed(1) },
          { label: 'CPU travada (s)', valor: (u) => Math.round(n(u.ms_cpu_travada) / 1000) }, { label: 'Pico RAM (MB)', valor: (u) => u.heap_mb_max },
          { label: 'Processos', valor: (u) => u.processos }, { label: 'Itens processados', valor: (u) => u.itens_processos },
          { label: 'Erros', valor: (u) => u.erros }, { label: 'Timeouts', valor: (u) => u.timeouts }, { label: 'Tela mais pesada', valor: (u) => u.pagina_top },
        ])}>Exportar CSV</button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tabela-simples" style={{ width: '100%' }}>
          <thead><tr>
            {th('usuario_nome', 'Usuário', 'left')}
            {th('segundos_online', 'Tempo online', 'left')}
            {th('segundos_ativo', 'Ativo')}
            {th('bytes_recebidos', 'Dados baixados', 'left')}
            {th('requisicoes', 'Requisições')}
            {th('ms_cpu_travada', 'CPU travada')}
            {th('heap_mb_max', 'Pico RAM')}
            {th('processos', 'Processos')}
            {th('timeouts', 'Erros/TO')}
            <th style={{ textAlign: 'left' }}>Tela mais pesada</th>
          </tr></thead>
          <tbody>
            {!linhas.length && <tr><td colSpan={10} style={{ color: COR.muted, padding: 14 }}>Sem dados no período.</td></tr>}
            {linhas.map((u) => {
              const online = n(u.segundos_online);
              return (
                <tr key={u.usuario_id}>
                  <td>
                    <button type="button" onClick={() => onFiltrar(u.usuario_id)} title="Ver só este usuário"
                      style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', color: 'inherit' }}>
                      <strong>{u.usuario_nome || u.usuario_id}</strong>
                    </button>
                    <div style={{ fontSize: 12, color: COR.muted }}>{u.perfil || ''}{u.memoria_aparelho_gb ? ` · máquina ${u.memoria_aparelho_gb} GB` : ''} · {fmtNum(u.sessoes)} sessão(ões)</div>
                  </td>
                  <td><Medidor valor={online} maximo={maxOnline} texto={formatarSegundos(online)}
                    titulo={`Ativo ${formatarSegundos(u.segundos_ativo)} · ocioso ${formatarSegundos(u.segundos_ocioso)} · aba escondida ${formatarSegundos(u.segundos_oculto)}`} /></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatarSegundos(u.segundos_ativo)}{online ? <div style={{ fontSize: 12, color: COR.muted }}>{Math.round((n(u.segundos_ativo) / online) * 100)}%</div> : null}</td>
                  <td><Medidor valor={u.bytes_recebidos} maximo={maxBytes} texto={formatarBytes(u.bytes_recebidos)} /></td>
                  <td style={{ textAlign: 'right' }}>{fmtNum(u.requisicoes)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatarMs(u.ms_cpu_travada)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtMb(u.heap_mb_max)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtNum(u.processos)}{n(u.itens_processos) ? <div style={{ fontSize: 12, color: COR.muted }}>{fmtNum(u.itens_processos)} itens</div> : null}</td>
                  <td style={{ textAlign: 'right' }}>{fmtNum(u.erros)} / {fmtNum(u.timeouts)}</td>
                  <td>{u.pagina_top || '-'}<div style={{ fontSize: 12, color: COR.muted }}>último sinal {formatarDataHora(u.ultimo_sinal_em)}</div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AbaTelas({ paginas }) {
  const [linhas, th] = useOrdenacao(paginas, 'bytes_recebidos');
  const maxBytes = Math.max(1, ...paginas.map((p) => n(p.bytes_recebidos)));
  const maxCpu = Math.max(1, ...paginas.map((p) => n(p.ms_cpu_travada)));
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="tabela-simples" style={{ width: '100%' }}>
        <thead><tr>
          {th('pagina_label', 'Tela', 'left')}
          {th('usuarios', 'Usuários')}
          {th('segundos_ativo', 'Tempo ativo')}
          {th('bytes_recebidos', 'Dados baixados', 'left')}
          {th('ms_cpu_travada', 'CPU travada', 'left')}
          {th('requisicoes', 'Requisições')}
          {th('escritas', 'Gravações')}
          {th('heap_mb_max', 'Pico RAM')}
          {th('timeouts', 'Erros/TO')}
        </tr></thead>
        <tbody>
          {!linhas.length && <tr><td colSpan={9} style={{ color: COR.muted, padding: 14 }}>Sem dados no período.</td></tr>}
          {linhas.map((p) => (
            <tr key={p.pagina}>
              <td><strong>{p.pagina_label || p.pagina || '(sem tela)'}</strong></td>
              <td style={{ textAlign: 'right' }}>{fmtNum(p.usuarios)}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatarSegundos(p.segundos_ativo)}</td>
              <td><Medidor valor={p.bytes_recebidos} maximo={maxBytes} texto={formatarBytes(p.bytes_recebidos)} /></td>
              <td><Medidor valor={p.ms_cpu_travada} maximo={maxCpu} texto={formatarMs(p.ms_cpu_travada)} /></td>
              <td style={{ textAlign: 'right' }}>{fmtNum(p.requisicoes)}<div style={{ fontSize: 12, color: COR.muted }}>{formatarMs(n(p.ms_rede) / Math.max(1, n(p.requisicoes)))} média</div></td>
              <td style={{ textAlign: 'right' }}>{fmtNum(p.escritas)}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtMb(p.heap_mb_max)}<div style={{ fontSize: 12, color: COR.muted }}>média {fmtMb(p.heap_mb_medio)}</div></td>
              <td style={{ textAlign: 'right' }}>{fmtNum(p.erros)} / {fmtNum(p.timeouts)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AbaTabelas({ tabelas, totalBytes }) {
  const [linhas, th] = useOrdenacao(tabelas, 'bytes_recebidos');
  const maxBytes = Math.max(1, ...tabelas.map((t) => n(t.bytes_recebidos)));
  return (
    <>
      <p style={{ color: COR.muted, marginTop: 0 }}>
        Cada consulta ao banco, agrupada pela tabela (ou função <code>rpc:</code>, arquivo <code>storage:</code>). Mostra o que mais
        pesa para o Supabase (dados trafegados e tempo de resposta) e quem/qual tela mais puxa.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table className="tabela-simples" style={{ width: '100%' }}>
          <thead><tr>
            {th('tabela', 'Tabela / função', 'left')}
            {th('bytes_recebidos', 'Dados baixados', 'left')}
            {th('requisicoes', 'Consultas')}
            {th('escritas', 'Gravações')}
            {th('ms_rede', 'Tempo médio')}
            {th('timeouts', 'Erros/TO')}
            {th('usuarios', 'Usuários')}
            <th style={{ textAlign: 'left' }}>Quem mais puxa</th>
          </tr></thead>
          <tbody>
            {!linhas.length && <tr><td colSpan={8} style={{ color: COR.muted, padding: 14 }}>Sem dados no período.</td></tr>}
            {linhas.map((t) => (
              <tr key={t.tabela}>
                <td><code>{t.tabela}</code></td>
                <td><Medidor valor={t.bytes_recebidos} maximo={maxBytes}
                  texto={`${formatarBytes(t.bytes_recebidos)}${totalBytes ? ` · ${Math.round((n(t.bytes_recebidos) / totalBytes) * 100)}%` : ''}`} /></td>
                <td style={{ textAlign: 'right' }}>{fmtNum(t.requisicoes)}</td>
                <td style={{ textAlign: 'right' }}>{fmtNum(t.escritas)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatarMs(n(t.ms_rede) / Math.max(1, n(t.requisicoes)))}</td>
                <td style={{ textAlign: 'right', color: n(t.timeouts) ? '#b91c1c' : undefined }}>{fmtNum(t.erros)} / {fmtNum(t.timeouts)}</td>
                <td style={{ textAlign: 'right' }}>{fmtNum(t.usuarios)}</td>
                <td>{t.usuario_top || '-'}<div style={{ fontSize: 12, color: COR.muted }}>{t.pagina_top || ''}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AbaProcessos({ tipos, processos, tipo, onTipo, aberto, onAbrir }) {
  const filtrados = tipo ? processos.filter((p) => p.tipo === tipo) : processos;
  const maxMs = Math.max(1, ...tipos.map((t) => n(t.ms_total)));
  return (
    <>
      <p style={{ color: COR.muted, marginTop: 0 }}>
        Processos nomeados (auditoria, simulação, importação Verum) e "ações pesadas de tela" detectadas automaticamente
        (qualquer ação que trave a CPU ou baixe muitos dados sem pausa). Rede, CPU e RAM contam só enquanto o processo roda.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table className="tabela-simples" style={{ width: '100%' }}>
          <thead><tr>
            <th style={{ textAlign: 'left' }}>Tipo</th><th>Execuções</th><th>Usuários</th><th style={{ textAlign: 'left' }}>Tempo total</th>
            <th>Média</th><th>Pior</th><th>Itens (maior)</th><th>Por item</th><th>Dados</th><th>CPU travada</th><th>Pico RAM</th><th>Falhas</th>
          </tr></thead>
          <tbody>
            {!tipos.length && <tr><td colSpan={12} style={{ color: COR.muted, padding: 14 }}>Nenhum processo medido no período.</td></tr>}
            {tipos.map((t) => (
              <tr key={t.tipo} onClick={() => onTipo(tipo === t.tipo ? '' : t.tipo)} style={{ cursor: 'pointer', background: tipo === t.tipo ? 'rgba(37,99,235,.08)' : undefined }}>
                <td><strong>{rotuloTipo(t.tipo)}</strong></td>
                <td style={{ textAlign: 'right' }}>{fmtNum(t.execucoes)}</td>
                <td style={{ textAlign: 'right' }}>{fmtNum(t.usuarios)}</td>
                <td><Medidor valor={t.ms_total} maximo={maxMs} texto={formatarMs(t.ms_total)} /></td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatarMs(t.ms_medio)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatarMs(t.ms_max)}</td>
                <td style={{ textAlign: 'right' }}>{fmtNum(t.itens)}<div style={{ fontSize: 12, color: COR.muted }}>maior {fmtNum(t.itens_max)}</div></td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{n(t.itens) ? formatarMs(n(t.ms_total) / n(t.itens)) : '-'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatarBytes(t.bytes_recebidos)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatarMs(t.ms_cpu_travada)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtMb(t.heap_mb_pico)}</td>
                <td style={{ textAlign: 'right', color: n(t.falhas) ? '#b91c1c' : undefined }}>{fmtNum(t.falhas)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel-title" style={{ marginTop: 22, fontSize: 16 }}>
        Execuções mais demoradas{tipo ? ` · ${rotuloTipo(tipo)}` : ''} {tipo && <button type="button" className="btn-secondary" onClick={() => onTipo('')} style={{ marginLeft: 8 }}>Ver todos</button>}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tabela-simples" style={{ width: '100%' }}>
          <thead><tr>
            <th style={{ textAlign: 'left' }}>Início</th><th style={{ textAlign: 'left' }}>Usuário</th><th style={{ textAlign: 'left' }}>Processo</th>
            <th>Duração</th><th>Itens</th><th>Dados</th><th>CPU travada</th><th>RAM início → pico</th><th>Status</th>
          </tr></thead>
          <tbody>
            {!filtrados.length && <tr><td colSpan={9} style={{ color: COR.muted, padding: 14 }}>Nenhuma execução.</td></tr>}
            {filtrados.slice(0, 200).map((p) => (
              <Fragment key={p.id}>
                <tr onClick={() => onAbrir(aberto === p.id ? null : p.id)} style={{ cursor: 'pointer' }}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatarDataHora(p.iniciado_em)}</td>
                  <td>{p.usuario_nome || p.usuario_id}</td>
                  <td>{p.titulo || rotuloTipo(p.tipo)}<div style={{ fontSize: 12, color: COR.muted }}>{rotuloTipo(p.tipo)} · {p.pagina || ''}</div></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatarMs(p.duracao_ms)}</td>
                  <td style={{ textAlign: 'right' }}>{n(p.itens) ? fmtNum(p.itens) : '-'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatarBytes(p.bytes_recebidos)}<div style={{ fontSize: 12, color: COR.muted }}>{fmtNum(p.requisicoes)} req</div></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatarMs(p.ms_cpu_travada)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtMb(p.heap_mb_inicio)} → {fmtMb(p.heap_mb_pico)}</td>
                  <td style={{ color: p.status === 'CONCLUIDO' ? '#166534' : '#b91c1c', fontWeight: 700 }}>{p.status}</td>
                </tr>
                {aberto === p.id && (
                  <tr><td colSpan={9} style={{ background: 'rgba(100,116,139,.06)', fontSize: 13 }}>
                    {p.erro && <div style={{ color: '#b91c1c', marginBottom: 6 }}><strong>Erro:</strong> {p.erro}</div>}
                    <div><strong>Tempo de rede:</strong> {formatarMs(p.ms_rede)} · <strong>Enviado:</strong> {formatarBytes(p.bytes_enviados)} · <strong>RAM no fim:</strong> {fmtMb(p.heap_mb_fim)} · <strong>Fim:</strong> {formatarDataHora(p.finalizado_em)}</div>
                    {Array.isArray(p.metadados?.tabelas) && p.metadados.tabelas.length > 0 && (
                      <div style={{ marginTop: 4 }}><strong>Tabelas que mais pesaram:</strong> {p.metadados.tabelas.map((t) => `${t.tabela} (${formatarBytes(t.bytes)})`).join(' · ')}</div>
                    )}
                    {p.metadados && Object.keys(p.metadados).filter((k) => !['tabelas', 'automatico'].includes(k)).length > 0 && (
                      <div style={{ marginTop: 4, color: COR.muted }}>
                        {Object.entries(p.metadados).filter(([k, v]) => !['tabelas', 'automatico'].includes(k) && v != null && v !== '').map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')}
                      </div>
                    )}
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AbaArmazenamento({ dados, erro, onLimpar }) {
  if (erro) return <div style={{ padding: 12, borderRadius: 8, background: '#fef2f2', color: '#b91c1c' }}>{erro}</div>;
  if (!dados) return <p style={{ color: COR.muted }}>Carregando tamanhos...</p>;
  const tabelas = dados.tabelas || [];
  const buckets = dados.buckets || [];
  const total = n(dados.banco_total_bytes);
  const totalArquivos = buckets.reduce((s, b) => s + n(b.bytes), 0);
  const maxT = Math.max(1, ...tabelas.map((t) => n(t.total_bytes)));
  const maxB = Math.max(1, ...buckets.map((b) => n(b.bytes)));
  return (
    <>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Cartao titulo="Banco de dados" valor={formatarBytes(total)} sub={`${tabelas.length} maiores tabelas abaixo`} />
        <Cartao titulo="Arquivos (Storage)" valor={formatarBytes(totalArquivos)} sub={`${fmtNum(buckets.reduce((s, b) => s + n(b.arquivos), 0))} arquivo(s) em ${buckets.length} bucket(s)`} />
      </div>
      <div className="panel-title" style={{ marginTop: 20, fontSize: 16 }}>Tabelas que mais ocupam</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tabela-simples" style={{ width: '100%' }}>
          <thead><tr><th style={{ textAlign: 'left' }}>Tabela</th><th style={{ textAlign: 'left' }}>Total (dados + índices)</th><th>Dados</th><th>Índices</th><th>Linhas (aprox.)</th></tr></thead>
          <tbody>
            {tabelas.map((t) => (
              <tr key={t.tabela}>
                <td><code>{t.tabela}</code></td>
                <td><Medidor valor={t.total_bytes} maximo={maxT} texto={`${formatarBytes(t.total_bytes)}${total ? ` · ${Math.round((n(t.total_bytes) / total) * 100)}%` : ''}`} /></td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatarBytes(t.dados_bytes)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatarBytes(t.indices_bytes)}</td>
                <td style={{ textAlign: 'right' }}>{fmtNum(t.linhas_estimadas)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {buckets.length > 0 && (
        <>
          <div className="panel-title" style={{ marginTop: 20, fontSize: 16 }}>Arquivos por bucket</div>
          <table className="tabela-simples" style={{ width: '100%' }}>
            <thead><tr><th style={{ textAlign: 'left' }}>Bucket</th><th style={{ textAlign: 'left' }}>Tamanho</th><th>Arquivos</th></tr></thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.bucket}>
                  <td><code>{b.bucket}</code></td>
                  <td><Medidor valor={b.bytes} maximo={maxB} texto={formatarBytes(b.bytes)} /></td>
                  <td style={{ textAlign: 'right' }}>{fmtNum(b.arquivos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <div style={{ marginTop: 20, fontSize: 13, color: COR.muted }}>
        A própria telemetria guarda 90 dias.{' '}
        <button type="button" className="btn-secondary" onClick={onLimpar}>Apagar telemetria com mais de 90 dias</button>
      </div>
    </>
  );
}

function AbaOnline({ sessoes }) {
  return (
    <>
      <p style={{ color: COR.muted, marginTop: 0 }}>Abas com sinal nos últimos 3 minutos (atualiza a cada 30 s). Uma pessoa com várias abas aparece várias vezes.</p>
      <div style={{ overflowX: 'auto' }}>
        <table className="tabela-simples" style={{ width: '100%' }}>
          <thead><tr><th style={{ textAlign: 'left' }}>Usuário</th><th style={{ textAlign: 'left' }}>Tela atual</th><th>Conectado há</th><th>Ativo</th><th>Ocioso</th><th>Pico RAM</th><th style={{ textAlign: 'left' }}>Aparelho</th></tr></thead>
          <tbody>
            {!sessoes.length && <tr><td colSpan={7} style={{ color: COR.muted, padding: 14 }}>Ninguém online.</td></tr>}
            {sessoes.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.usuario_nome}</strong><div style={{ fontSize: 12, color: COR.muted }}>{s.perfil}</div></td>
                <td>{s.pagina_atual || '-'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatarSegundos((Date.now() - new Date(s.iniciado_em).getTime()) / 1000)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatarSegundos(s.segundos_ativo)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatarSegundos(s.segundos_ocioso)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtMb(s.pico_heap_mb)}</td>
                <td style={{ fontSize: 12 }}>{s.navegador || '-'}{s.memoria_aparelho_gb ? ` · ${s.memoria_aparelho_gb} GB RAM` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
