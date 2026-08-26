import { useEffect, useMemo, useState } from 'react';
import { assinarUsuariosAtivos, listarHistoricoAcessos, presencaDisponivel } from '../services/presencaService';
import { listarProcessamentosPesados, carregarConfiguracaoFila } from '../services/processamentoFilaService';

function formatarDataHora(valor) {
  if (!valor) return '-';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '-';
  return data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function formatarDuracao(desde) {
  if (!desde) return '-';
  const inicio = new Date(desde).getTime();
  if (!Number.isFinite(inicio)) return '-';
  const minutos = Math.max(0, Math.floor((Date.now() - inicio) / 60000));
  if (minutos < 1) return 'agora mesmo';
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const restoMin = minutos % 60;
  return `${horas}h${restoMin ? ` ${restoMin}min` : ''}`;
}

export default function PainelUsuariosAtivosPage() {
  const [usuarios, setUsuarios] = useState([]);
  const [, forcarAtualizacao] = useState(0);
  const [historico, setHistorico] = useState([]);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);
  const [processamentos, setProcessamentos] = useState([]);
  const [erroFila, setErroFila] = useState('');
  const [configFila, setConfigFila] = useState({ orcamentoItens: null, limiteTarefasGlobais: 2 });

  useEffect(() => {
    const cancelar = assinarUsuariosAtivos(setUsuarios);
    return cancelar;
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => forcarAtualizacao((valor) => valor + 1), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let ativo = true;
    const carregarFila = async () => {
      try {
        const linhas = await listarProcessamentosPesados({ limite: 300 });
        if (ativo) { setProcessamentos(linhas); setErroFila(''); }
      } catch (error) {
        if (ativo) setErroFila(error.message || 'Fila indisponível.');
      }
    };
    carregarFila();
    const timer = window.setInterval(carregarFila, 10000);
    return () => { ativo = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let ativo = true;
    carregarConfiguracaoFila().then((config) => { if (ativo) setConfigFila(config); }).catch(() => {});
    const timer = window.setInterval(() => {
      carregarConfiguracaoFila().then((config) => { if (ativo) setConfigFila(config); }).catch(() => {});
    }, 30000);
    return () => { ativo = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let ativo = true;
    setCarregandoHistorico(true);
    listarHistoricoAcessos({ limite: 200 }).then((linhas) => {
      if (ativo) {
        setHistorico(linhas);
        setCarregandoHistorico(false);
      }
    });
    return () => {
      ativo = false;
    };
  }, []);

  const paginasEmUso = useMemo(() => {
    const contagem = new Map();
    usuarios.forEach((usuario) => {
      const chave = usuario.paginaLabel || usuario.pagina || 'Indefinido';
      contagem.set(chave, (contagem.get(chave) || 0) + 1);
    });
    return [...contagem.entries()].sort((a, b) => b[1] - a[1]);
  }, [usuarios]);

  const filaAtiva = useMemo(() => processamentos.filter((item) => ['AGUARDANDO', 'PROCESSANDO'].includes(item.status)), [processamentos]);
  const consumoPorUsuario = useMemo(() => {
    const desde = Date.now() - (24 * 60 * 60 * 1000);
    const mapa = new Map();
    processamentos
      .filter((item) => new Date(item.criado_em).getTime() >= desde)
      .sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em))
      .forEach((item) => {
        const chave = item.usuario_id || item.usuario_email || 'sem-usuario';
        const atual = mapa.get(chave) || { id: chave, nome: item.usuario_nome || item.usuario_email || 'Usuário', email: item.usuario_email || '', tarefas: 0, itens: 0, concluidas: 0, erros: 0, ativas: 0, ultima: null };
        atual.tarefas += 1;
        atual.itens += Number(item.itens_processados || 0);
        if (item.status === 'CONCLUIDO') atual.concluidas += 1;
        if (['ERRO', 'INTERROMPIDO'].includes(item.status)) atual.erros += 1;
        if (['AGUARDANDO', 'PROCESSANDO'].includes(item.status)) atual.ativas += 1;
        atual.ultima = item;
        mapa.set(chave, atual);
      });
    return [...mapa.values()].sort((a, b) => b.itens - a.itens || b.tarefas - a.tarefas);
  }, [processamentos]);

  const atividadeRecente = useMemo(
    () => [...processamentos].sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em)).slice(0, 30),
    [processamentos],
  );

  const ROTULO_TIPO = { AUDITORIA_CTE: 'Auditoria', SIMULACAO_SUPRIMENTOS: 'Simulação', OUTRO: 'Outro' };
  const COR_STATUS = { CONCLUIDO: '#166534', PROCESSANDO: '#166534', AGUARDANDO: '#92400e', ERRO: '#b91c1c', INTERROMPIDO: '#b91c1c', CANCELADO: '#64748b' };

  if (!presencaDisponivel()) {
    return (
      <div className="panel-card">
        <div className="panel-title">Usuários ativos</div>
        <p>Supabase não configurado neste ambiente. O rastreamento de presença em tempo real depende do Supabase Realtime.</p>
      </div>
    );
  }

  return (
    <div className="panel-card">
      <div className="panel-title">Usuários ativos agora</div>
      <p style={{ color: 'var(--text-muted, #64748b)', marginTop: '-8px' }}>
        Use esta tela para saber se é um bom momento para rodar relatórios pesados. {usuarios.length} usuário(s) online.
      </p>

      {paginasEmUso.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
          {paginasEmUso.map(([pagina, qtd]) => (
            <span
              key={pagina}
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                background: 'rgba(37, 99, 235, 0.1)',
                color: '#2563eb',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {pagina} · {qtd}
            </span>
          ))}
        </div>
      )}

      <table className="tabela-simples" style={{ width: '100%', marginTop: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Usuário</th>
            <th style={{ textAlign: 'left' }}>Tela atual</th>
            <th style={{ textAlign: 'left' }}>Conectado há</th>
          </tr>
        </thead>
        <tbody>
          {usuarios.length === 0 && (
            <tr>
              <td colSpan={3} style={{ padding: '16px 0', color: 'var(--text-muted, #64748b)' }}>
                Nenhum usuário ativo no momento.
              </td>
            </tr>
          )}
          {usuarios.map((usuario) => (
            <tr key={usuario.id || usuario.email}>
              <td>
                <strong>{usuario.nome}</strong>
                <div style={{ fontSize: 12, color: 'var(--text-muted, #64748b)' }}>{usuario.email}</div>
              </td>
              <td>{usuario.paginaLabel || usuario.pagina || '-'}</td>
              <td>{formatarDuracao(usuario.entrouEm)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="panel-title" style={{ marginTop: 24 }}>Fila de tarefas pesadas</div>
      <p style={{ color: 'var(--text-muted, #64748b)', marginTop: '-8px' }}>
        Auditorias e simulações compartilham {configFila.limiteTarefasGlobais} posições
        {configFila.orcamentoItens ? ` (ou até ${configFila.orcamentoItens.toLocaleString('pt-BR')} itens somados)` : ''}.
        Atualização automática a cada 10 segundos. Ajuste em Ferramentas → Fila de processamento pesado.
      </p>
      {erroFila && <div style={{ padding: 10, borderRadius: 8, background: '#fef2f2', color: '#b91c1c' }}>{erroFila}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
        <span style={{ padding: '5px 10px', borderRadius: 999, background: '#dcfce7', color: '#166534', fontWeight: 700 }}>
          {filaAtiva.filter((item) => item.status === 'PROCESSANDO').length}/{configFila.limiteTarefasGlobais} processando
        </span>
        <span style={{ padding: '5px 10px', borderRadius: 999, background: '#fef3c7', color: '#92400e', fontWeight: 700 }}>
          {filaAtiva.filter((item) => item.status === 'AGUARDANDO').length} aguardando
        </span>
      </div>
      <table className="tabela-simples" style={{ width: '100%', marginTop: 12 }}>
        <thead><tr><th>Estado</th><th>Usuário</th><th>Tarefa</th><th>Progresso</th><th>Início</th></tr></thead>
        <tbody>
          {!filaAtiva.length && <tr><td colSpan={5} style={{ padding: '16px 0', color: '#64748b' }}>Nenhuma tarefa pesada ativa.</td></tr>}
          {filaAtiva.map((item) => {
            const total = Number(item.total_itens || 0);
            const feitos = Number(item.itens_processados || 0);
            return <tr key={item.id}>
              <td><strong style={{ color: item.status === 'PROCESSANDO' ? '#166534' : '#92400e' }}>{item.status}</strong></td>
              <td><strong>{item.usuario_nome || '-'}</strong><div style={{ fontSize: 12, color: '#64748b' }}>{item.usuario_email}</div></td>
              <td>{item.titulo}<div style={{ fontSize: 12, color: '#64748b' }}>{item.tipo}</div></td>
              <td>{total ? `${feitos.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')}` : feitos.toLocaleString('pt-BR')}<div style={{ fontSize: 12, color: '#64748b' }}>lote {item.lote_atual || 0}/{item.total_lotes || '?'}</div></td>
              <td>{formatarDataHora(item.iniciado_em || item.criado_em)}</td>
            </tr>;
          })}
        </tbody>
      </table>

      <div className="panel-title" style={{ marginTop: 24 }}>Consumo por usuário · últimas 24 horas</div>
      <table className="tabela-simples" style={{ width: '100%', marginTop: 12 }}>
        <thead><tr><th>Usuário</th><th>Tarefas</th><th>Itens</th><th>Concluídas</th><th>Erros</th><th>Ativas</th><th>Última tarefa</th></tr></thead>
        <tbody>
          {!consumoPorUsuario.length && <tr><td colSpan={7} style={{ padding: '16px 0', color: '#64748b' }}>Sem consumo registrado nas últimas 24 horas.</td></tr>}
          {consumoPorUsuario.map((item) => <tr key={item.id}>
            <td><strong>{item.nome}</strong><div style={{ fontSize: 12, color: '#64748b' }}>{item.email}</div></td>
            <td>{item.tarefas}</td><td>{item.itens.toLocaleString('pt-BR')}</td><td>{item.concluidas}</td>
            <td style={{ color: item.erros ? '#b91c1c' : undefined }}>{item.erros}</td><td>{item.ativas}</td>
            <td>
              {item.ultima ? <>
                <strong style={{ color: COR_STATUS[item.ultima.status] }}>{item.ultima.titulo}</strong>
                <div style={{ fontSize: 12, color: '#64748b' }}>{ROTULO_TIPO[item.ultima.tipo] || item.ultima.tipo} · {item.ultima.status}</div>
              </> : '-'}
            </td>
          </tr>)}
        </tbody>
      </table>

      <div className="panel-title" style={{ marginTop: 24 }}>Atividade recente</div>
      <p style={{ color: 'var(--text-muted, #64748b)', marginTop: '-8px' }}>
        Últimas {atividadeRecente.length} tarefas pesadas (auditoria e simulação), mais recentes primeiro.
      </p>
      <table className="tabela-simples" style={{ width: '100%', marginTop: 12 }}>
        <thead><tr><th>Usuário</th><th>Tarefa</th><th>Status</th><th>Itens</th><th>Quando</th></tr></thead>
        <tbody>
          {!atividadeRecente.length && <tr><td colSpan={5} style={{ padding: '16px 0', color: '#64748b' }}>Nenhuma tarefa registrada ainda.</td></tr>}
          {atividadeRecente.map((item) => {
            const total = Number(item.total_itens || 0);
            const feitos = Number(item.itens_processados || 0);
            return <tr key={item.id}>
              <td><strong>{item.usuario_nome || '-'}</strong><div style={{ fontSize: 12, color: '#64748b' }}>{item.usuario_email}</div></td>
              <td>{item.titulo}<div style={{ fontSize: 12, color: '#64748b' }}>{ROTULO_TIPO[item.tipo] || item.tipo}</div></td>
              <td><strong style={{ color: COR_STATUS[item.status] || '#64748b' }}>{item.status}</strong></td>
              <td>{total ? `${feitos.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')}` : feitos.toLocaleString('pt-BR')}</td>
              <td>{formatarDataHora(item.criado_em)}</td>
            </tr>;
          })}
        </tbody>
      </table>

      <div className="panel-title" style={{ marginTop: 24 }}>Histórico de acessos</div>
      <p style={{ color: 'var(--text-muted, #64748b)', marginTop: '-8px' }}>
        Últimos {historico.length} registros de navegação (quem entrou, quando e em qual tela).
      </p>
      <table className="tabela-simples" style={{ width: '100%', marginTop: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Usuário</th>
            <th style={{ textAlign: 'left' }}>Tela</th>
            <th style={{ textAlign: 'left' }}>Quando</th>
          </tr>
        </thead>
        <tbody>
          {carregandoHistorico && (
            <tr>
              <td colSpan={3} style={{ padding: '16px 0', color: 'var(--text-muted, #64748b)' }}>
                Carregando histórico...
              </td>
            </tr>
          )}
          {!carregandoHistorico && historico.length === 0 && (
            <tr>
              <td colSpan={3} style={{ padding: '16px 0', color: 'var(--text-muted, #64748b)' }}>
                Nenhum acesso registrado ainda.
              </td>
            </tr>
          )}
          {historico.map((registro) => (
            <tr key={registro.id}>
              <td>
                <strong>{registro.usuario_nome}</strong>
                <div style={{ fontSize: 12, color: 'var(--text-muted, #64748b)' }}>{registro.usuario_email}</div>
              </td>
              <td>{registro.pagina_label || registro.pagina || '-'}</td>
              <td>{formatarDataHora(registro.criado_em)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
