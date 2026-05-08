import { useEffect, useMemo, useState } from 'react';
import {
  cancelarRealizadoOnlineImport,
  clearRealizadoOnlineImportStatus,
  getRealizadoOnlineImportState,
  subscribeRealizadoOnlineImport,
} from '../services/realizadoOnlineImportManager';

function formatElapsed(startedAt, finishedAt) {
  if (!startedAt) return '';
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '';
  const totalSeconds = Math.max(0, Math.floor((end - start) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}min ${String(seconds).padStart(2, '0')}s`;
}

export default function GlobalImportStatus({ onAbrirRealizado }) {
  const [state, setState] = useState(() => getRealizadoOnlineImportState());
  const [, setTick] = useState(0);

  useEffect(() => subscribeRealizadoOnlineImport(setState), []);

  useEffect(() => {
    if (state.status !== 'running') return undefined;
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [state.status]);

  const progress = state.progress || {};
  const percentual = Math.max(0, Math.min(100, Number(progress.percentual || 0)));
  const elapsed = useMemo(() => formatElapsed(state.startedAt, state.finishedAt), [state.startedAt, state.finishedAt, state.status, progress.updatedAt]);

  if (!state || state.status === 'idle') return null;

  const isRunning = state.status === 'running';
  const isError = state.status === 'error';
  const isDone = state.status === 'done';
  const fileLabel = (state.files || []).length
    ? (state.files || []).map((file) => file.name).slice(0, 2).join(', ') + ((state.files || []).length > 2 ? ` +${(state.files || []).length - 2}` : '')
    : '';

  const wrapperStyle = {
    position: 'sticky',
    top: 0,
    zIndex: 30,
    marginBottom: 16,
    border: `1px solid ${isError ? '#fecaca' : isDone ? '#bbf7d0' : '#d8b4fe'}`,
    background: isError ? '#fff1f2' : isDone ? '#f0fdf4' : '#faf5ff',
    borderRadius: 16,
    padding: '12px 14px',
    boxShadow: '0 10px 25px rgba(15, 23, 42, 0.08)',
  };

  const barStyle = {
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
    background: 'rgba(15, 23, 42, 0.10)',
    marginTop: 8,
  };

  const fillStyle = {
    width: `${percentual}%`,
    height: '100%',
    borderRadius: 999,
    background: isError ? '#dc2626' : isDone ? '#16a34a' : '#7c3aed',
    transition: 'width 250ms ease',
  };

  const buttonStyle = {
    border: '1px solid rgba(15, 23, 42, 0.18)',
    background: '#fff',
    borderRadius: 999,
    padding: '7px 12px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    color: '#071f55',
  };

  return (
    <div style={wrapperStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ color: '#071f55' }}>{state.titulo || 'Importação em andamento'}</strong>
            <span style={{ fontSize: 12, fontWeight: 700, color: isError ? '#b91c1c' : isDone ? '#15803d' : '#6d28d9' }}>
              {isRunning ? 'EM ANDAMENTO' : isDone ? 'CONCLUÍDA' : 'ERRO'}
            </span>
            <span style={{ fontSize: 12, color: '#475569' }}>{percentual.toFixed(0)}%</span>
            {elapsed ? <span style={{ fontSize: 12, color: '#475569' }}>tempo: {elapsed}</span> : null}
          </div>
          <div style={{ marginTop: 4, fontSize: 13, color: '#334155', lineHeight: 1.35 }}>
            <b>{progress.etapa || 'Processando'}</b>
            {fileLabel ? ` • ${fileLabel}` : ''}
            {progress.mensagem ? ` — ${progress.mensagem}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {onAbrirRealizado ? (
            <button type="button" style={buttonStyle} onClick={onAbrirRealizado}>
              Abrir Realizado
            </button>
          ) : null}
          {isRunning ? (
            <button type="button" style={buttonStyle} onClick={cancelarRealizadoOnlineImport}>
              Cancelar
            </button>
          ) : null}
          {!isRunning ? (
            <button type="button" style={buttonStyle} onClick={clearRealizadoOnlineImportStatus}>
              Limpar aviso
            </button>
          ) : null}
        </div>
      </div>
      <div style={barStyle}>
        <div style={fillStyle} />
      </div>
    </div>
  );
}
