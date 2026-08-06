import { useEffect, useMemo, useState } from 'react';
import { assinarUsuariosAtivos, listarHistoricoAcessos, presencaDisponivel } from '../services/presencaService';

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
