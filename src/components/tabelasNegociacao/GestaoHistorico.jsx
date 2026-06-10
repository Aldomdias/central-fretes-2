import React, { useMemo } from 'react';
import { listarHistoricoGestao, formatarData } from '../../utils/tabelasNegociacaoGestao';

const TIPO_LABEL = {
  CRIACAO: 'Criação',
  ENVIO_APROVACAO: 'Enviada para aprovação',
  APROVACAO_GESTOR: 'Aprovada pelo gestor',
  APROVACAO_NEGOCIADOR: 'Aprovada pelo negociador',
  RECUSA_GESTOR: 'Recusada',
  DEVOLUCAO_AJUSTE: 'Devolvida para ajuste',
  SOLICITAR_COMPLEMENTO: 'Complemento solicitado',
  PUBLICACAO_OFICIAL: 'Publicada na base oficial',
  ALTERACAO_NEGOCIADOR: 'Negociador alterado',
  ALTERACAO_STATUS: 'Alteração de status',
};

export default function GestaoHistorico({ tabelas = [], filtroTransportadora = '', modo = 'tabela' }) {
  const eventos = useMemo(() => {
    let lista = listarHistoricoGestao(tabelas);
    if (filtroTransportadora) {
      const termo = filtroTransportadora.toUpperCase();
      lista = lista.filter((e) => String(e.transportadora || '').toUpperCase().includes(termo));
    }
    return lista.slice(0, 200);
  }, [tabelas, filtroTransportadora]);

  if (modo === 'painel') {
    return (
      <section className="sim-card">
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Histórico</h2>
        <p style={{ color: '#64748b', fontSize: 13, marginBottom: 12 }}>
          {filtroTransportadora
            ? `Eventos de ${filtroTransportadora}`
            : 'Últimos eventos de negociação'}
        </p>
        <div style={{ display: 'grid', gap: 10 }}>
          {eventos.map((ev) => (
            <div
              key={ev.id || `${ev.negociacao_id}-${ev.criado_em}`}
              style={{ padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 10, background: '#f8fafc' }}
            >
              <div style={{ fontSize: 11, color: '#64748b' }}>{formatarData(ev.criado_em)}</div>
              <strong style={{ display: 'block', marginTop: 4, fontSize: 13 }}>{TIPO_LABEL[ev.tipo] || ev.tipo}</strong>
              <div style={{ fontSize: 12, marginTop: 4 }}>{ev.transportadora}</div>
              <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>{ev.usuario_nome || '—'}</div>
              {ev.observacao ? (
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 6, lineHeight: 1.4 }}>{ev.observacao}</div>
              ) : null}
            </div>
          ))}
          {!eventos.length ? <div className="sim-alert info">Nenhum evento registrado.</div> : null}
        </div>
      </section>
    );
  }

  return (
    <section className="sim-card">
      <h2 style={{ marginTop: 0 }}>Histórico de negociações</h2>
      <p style={{ color: '#64748b' }}>Trilha de criação, aprovações, devoluções e publicações.</p>

      <div className="sim-analise-tabela-wrap" style={{ marginTop: 14 }}>
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>Data</th>
              <th>Transportadora</th>
              <th>Evento</th>
              <th>Usuário</th>
              <th>Status</th>
              <th>Observação</th>
            </tr>
          </thead>
          <tbody>
            {eventos.map((ev) => (
              <tr key={ev.id || `${ev.negociacao_id}-${ev.criado_em}`}>
                <td style={{ fontSize: 12 }}>{formatarData(ev.criado_em)}</td>
                <td>{ev.transportadora}</td>
                <td><strong>{TIPO_LABEL[ev.tipo] || ev.tipo}</strong></td>
                <td>{ev.usuario_nome || '—'}</td>
                <td style={{ fontSize: 11 }}>
                  {ev.status_anterior ? `${ev.status_anterior} → ` : ''}{ev.status_novo || '—'}
                </td>
                <td style={{ fontSize: 12, maxWidth: 280 }}>{ev.observacao || '—'}</td>
              </tr>
            ))}
            {!eventos.length ? <tr><td colSpan="6">Nenhum evento registrado.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
