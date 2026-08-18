import React, { useCallback, useEffect, useState } from 'react';
import {
  listarRespostasPortalPendentes,
  validarRespostaPortal,
  RESULTADOS_RETORNO_TRANSPORTADORA,
} from '../services/auditoriaCteJornadaService';
import { carregarSessao } from '../utils/authLocal';

function formatarDataHora(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('pt-BR');
}

/**
 * Fase 15 — respostas que a transportadora enviou pelo portal e ainda
 * dependem do aval do auditor. Nada é aplicado na jornada sem passar por aqui.
 */
export default function RespostasPortalPendentes({ competencia, onAplicado }) {
  const [respostas, setRespostas] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [salvandoId, setSalvandoId] = useState(null);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      setRespostas(await listarRespostasPortalPendentes({ competencia }));
      setErro('');
    } catch (error) {
      // Painel aditivo: se a migration do portal ainda não rodou, some da tela.
      setErro(error.message || 'Não foi possível carregar as respostas do portal.');
    } finally {
      setCarregando(false);
    }
  }, [competencia]);

  useEffect(() => { carregar(); }, [carregar]);

  async function decidir(resposta, aplicar) {
    setSalvandoId(resposta.id);
    try {
      await validarRespostaPortal({ resposta, aplicar, usuario: carregarSessao() });
      setRespostas((atuais) => atuais.filter((r) => r.id !== resposta.id));
      if (aplicar && onAplicado) onAplicado();
    } catch (error) {
      setErro(error.message || 'Não foi possível registrar a decisão.');
    } finally {
      setSalvandoId(null);
    }
  }

  if (erro && !respostas.length) return null;
  if (!carregando && !respostas.length) return null;

  return (
    <div className="panel-card" style={{ marginBottom: 16, borderColor: '#6366f1', borderWidth: 2 }}>
      <div className="panel-title">
        📥 Respostas do portal aguardando sua validação
        {carregando ? <span style={{ fontWeight: 400, color: 'var(--muted)' }}> (carregando...)</span> : null}
      </div>
      <p style={{ marginTop: -4, color: 'var(--muted)', fontSize: 13 }}>
        A transportadora respondeu pelo link do laudo. Nada foi alterado na jornada ainda — confira e decida.
      </p>

      {erro ? <div className="sim-alert error" style={{ marginBottom: 10 }}>{erro}</div> : null}

      <div style={{ maxHeight: 340, overflow: 'auto', border: '1px solid var(--border-soft)', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--panel-soft)', position: 'sticky', top: 0 }}>
              <th style={{ textAlign: 'left', padding: '6px 10px' }}>CT-e</th>
              <th style={{ textAlign: 'left', padding: '6px 10px' }}>Transportadora</th>
              <th style={{ textAlign: 'left', padding: '6px 10px' }}>Resposta</th>
              <th style={{ textAlign: 'left', padding: '6px 10px' }}>Justificativa</th>
              <th style={{ textAlign: 'left', padding: '6px 10px' }}>Quem / quando</th>
              <th style={{ textAlign: 'right', padding: '6px 10px' }}>Decisão</th>
            </tr>
          </thead>
          <tbody>
            {respostas.map((r) => {
              const config = RESULTADOS_RETORNO_TRANSPORTADORA[r.resultado];
              return (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border-soft)' }}>
                  <td style={{ padding: '6px 10px' }}>
                    <strong>{r.numero_cte || '-'}</strong>
                    <div style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace' }}>{r.chave_cte}</div>
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    {r.transportadora || r.processo?.transportadora || '-'}
                    {r.processo?.codigo ? <div style={{ fontSize: 10, color: '#94a3b8' }}>{r.processo.codigo}</div> : null}
                  </td>
                  <td style={{ padding: '6px 10px', fontWeight: 700 }}>{config?.label || r.resultado}</td>
                  <td style={{ padding: '6px 10px', color: '#475569' }}>{r.justificativa || '—'}</td>
                  <td style={{ padding: '6px 10px', color: '#475569' }}>
                    {r.respondido_por || '—'}
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>{formatarDataHora(r.respondido_em)}</div>
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      type="button"
                      className="primary"
                      disabled={salvandoId === r.id}
                      onClick={() => decidir(r, true)}
                      style={{ padding: '4px 10px', fontSize: 11, marginRight: 6 }}
                    >
                      {salvandoId === r.id ? '...' : 'Aplicar'}
                    </button>
                    <button
                      type="button"
                      className="sim-tab"
                      disabled={salvandoId === r.id}
                      onClick={() => decidir(r, false)}
                      style={{ padding: '4px 10px', fontSize: 11 }}
                    >
                      Rejeitar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
