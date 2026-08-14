export default function ManutencaoOverlay({ mensagem }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: 24,
        textAlign: 'center',
        background: 'var(--bg, #0f172a)',
        color: 'var(--text, #f1f5f9)',
        zIndex: 9999,
      }}
    >
      <div style={{ fontSize: 48 }}>🛠️</div>
      <h1 style={{ margin: 0, fontSize: 24 }}>Sistema em manutenção</h1>
      <p style={{ margin: 0, maxWidth: 420, color: 'var(--muted, #94a3b8)' }}>
        {mensagem || 'Estamos em manutenção rápida. Volte em alguns minutos.'}
      </p>
    </div>
  );
}
