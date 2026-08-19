import React, { useCallback, useEffect, useState } from 'react';
import {
  listarRespostasPortalPendentes,
  validarRespostasPortalEmLote,
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
export default function RespostasPortalPendentes({ competencia, onAplicado, recarregarChave = 0 }) {
  const [respostas, setRespostas] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [progresso, setProgresso] = useState(null);
  const [erro, setErro] = useState('');
  const [selecionadas, setSelecionadas] = useState([]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const lista = await listarRespostasPortalPendentes({ competencia });
      setRespostas(lista);
      setSelecionadas([]);
      setErro('');
    } catch (error) {
      // Painel aditivo: se a migration do portal ainda não rodou, some da tela.
      setErro(error.message || 'Não foi possível carregar as respostas do portal.');
    } finally {
      setCarregando(false);
    }
    // recarregarChave permite a página forçar uma atualização (ex.: depois de
    // gerar laudo ou validar uma resposta em outro ponto da tela).
  }, [competencia, recarregarChave]);

  useEffect(() => { carregar(); }, [carregar]);

  function alternar(id) {
    setSelecionadas((atuais) => (atuais.includes(id) ? atuais.filter((i) => i !== id) : [...atuais, id]));
  }

  function alternarTodas() {
    setSelecionadas((atuais) => (atuais.length === respostas.length ? [] : respostas.map((r) => r.id)));
  }

  function selecionarConcordancias() {
    // Atalho do dia a dia: quem concordou normalmente é aprovação direta;
    // "não concordo" e "em análise" merecem leitura caso a caso.
    const ids = respostas
      .filter((r) => r.resultado === 'concordou_desconto' || r.resultado === 'concordou_cancelamento')
      .map((r) => r.id);
    setSelecionadas(ids);
  }

  async function decidir(aplicar) {
    const alvo = respostas.filter((r) => selecionadas.includes(r.id));
    if (!alvo.length) return;
    if (!aplicar && !window.confirm(`Rejeitar ${alvo.length} resposta(s) da transportadora?`)) return;

    setSalvando(true);
    setProgresso({ etapa: 'salvando_jornada', carregados: 0, total: alvo.length });
    try {
      await validarRespostasPortalEmLote({
        respostas: alvo,
        aplicar,
        usuario: carregarSessao(),
        onProgress: setProgresso,
      });
      setRespostas((atuais) => atuais.filter((r) => !selecionadas.includes(r.id)));
      setSelecionadas([]);
      if (aplicar && onAplicado) onAplicado();
    } catch (error) {
      setErro(error.message || 'Não foi possível registrar a decisão.');
    } finally {
      setSalvando(false);
      setProgresso(null);
    }
  }

  if (erro && !respostas.length) return null;
  if (!carregando && !respostas.length) return null;

  const totalSelecionadas = selecionadas.length;

  return (
    <div id="painel-respostas-portal" className="panel-card" style={{ marginBottom: 16, borderColor: '#6366f1', borderWidth: 2 }}>
      <div className="panel-title">
        📥 Respostas do portal aguardando sua validação
        {carregando ? <span style={{ fontWeight: 400, color: 'var(--muted)' }}> (carregando...)</span> : null}
      </div>
      <p style={{ marginTop: -4, color: 'var(--muted)', fontSize: 13 }}>
        A transportadora respondeu pelo link do laudo. Nada foi alterado na jornada ainda — confira e decida.
      </p>

      {erro ? <div className="sim-alert error" style={{ marginBottom: 10 }}>{erro}</div> : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <button className="sim-tab" type="button" onClick={alternarTodas} disabled={salvando}>
          {totalSelecionadas === respostas.length && respostas.length ? 'Desmarcar todas' : `Selecionar todas (${respostas.length})`}
        </button>
        <button
          className="sim-tab"
          type="button"
          onClick={selecionarConcordancias}
          disabled={salvando}
          title="Marca só as respostas em que a transportadora concordou (desconto ou cancelamento)"
        >
          Selecionar concordâncias
        </button>
        <button
          type="button"
          disabled={!totalSelecionadas || salvando}
          onClick={() => decidir(true)}
          style={{
            background: '#dcfce7', color: '#166534', border: '1px solid #86efac',
            borderRadius: 8, padding: '6px 14px', fontWeight: 700,
            cursor: totalSelecionadas && !salvando ? 'pointer' : 'not-allowed',
            opacity: totalSelecionadas && !salvando ? 1 : 0.55,
          }}
        >
          {salvando
            ? `Aplicando... ${progresso?.carregados || 0}/${progresso?.total || 0}`
            : `✅ Aplicar selecionadas (${totalSelecionadas})`}
        </button>
        <button
          type="button"
          disabled={!totalSelecionadas || salvando}
          onClick={() => decidir(false)}
          style={{
            background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5',
            borderRadius: 8, padding: '6px 14px', fontWeight: 700,
            cursor: totalSelecionadas && !salvando ? 'pointer' : 'not-allowed',
            opacity: totalSelecionadas && !salvando ? 1 : 0.55,
          }}
        >
          Rejeitar selecionadas ({totalSelecionadas})
        </button>
      </div>

      <div style={{ maxHeight: 340, overflow: 'auto', border: '1px solid var(--border-soft)', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--panel-soft)', position: 'sticky', top: 0 }}>
              <th style={{ width: 34, padding: '6px 10px' }}>
                <input
                  type="checkbox"
                  checked={Boolean(respostas.length) && totalSelecionadas === respostas.length}
                  onChange={alternarTodas}
                  aria-label="Selecionar todas as respostas"
                />
              </th>
              <th style={{ textAlign: 'left', padding: '6px 10px' }}>CT-e</th>
              <th style={{ textAlign: 'left', padding: '6px 10px' }}>Transportadora</th>
              <th style={{ textAlign: 'left', padding: '6px 10px' }}>Resposta</th>
              <th style={{ textAlign: 'left', padding: '6px 10px' }}>Justificativa</th>
              <th style={{ textAlign: 'left', padding: '6px 10px' }}>Quem / quando</th>
            </tr>
          </thead>
          <tbody>
            {respostas.map((r) => {
              const config = RESULTADOS_RETORNO_TRANSPORTADORA[r.resultado];
              const marcada = selecionadas.includes(r.id);
              return (
                <tr
                  key={r.id}
                  style={{ borderTop: '1px solid var(--border-soft)', background: marcada ? '#eef2ff' : undefined }}
                >
                  <td style={{ padding: '6px 10px' }}>
                    <input type="checkbox" checked={marcada} onChange={() => alternar(r.id)} disabled={salvando} />
                  </td>
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
