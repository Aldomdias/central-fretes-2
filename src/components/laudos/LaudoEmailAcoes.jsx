import React, { useState } from 'react';

async function copiarTextoClipboard(texto) {
  const conteudo = String(texto || '').trim();
  if (!conteudo) return false;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(conteudo);
    return true;
  }
  const area = document.createElement('textarea');
  area.value = conteudo;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.focus();
  area.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(area);
  return ok;
}

export default function LaudoEmailAcoes({ laudo = null, onFeedback = null, compact = false }) {
  const [modalAberto, setModalAberto] = useState(false);
  const [copiado, setCopiado] = useState('');

  if (!laudo) return null;

  const assunto = String(laudo.assunto || '').trim();
  const corpo = String(laudo.corpoEmail || laudo.relatorioTexto || laudo.relatorio || '').trim();
  const temConteudo = Boolean(assunto || corpo);

  if (!temConteudo) return null;

  async function notificar(ok, label) {
    if (onFeedback) {
      onFeedback(ok ? `${label} copiado para a área de transferência.` : 'Não foi possível copiar o texto.', !ok);
      return;
    }
    setCopiado(ok ? label : '');
    if (ok) setTimeout(() => setCopiado(''), 2500);
  }

  async function copiar(label, texto) {
    const ok = await copiarTextoClipboard(texto);
    await notificar(ok, label);
  }

  return (
    <>
      <div className="laudo-email-acoes" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {!compact ? (
          <small style={{ color: '#64748b', marginRight: 4 }}>E-mail (anexar laudo separadamente):</small>
        ) : null}
        {assunto ? (
          <button type="button" className="sim-tab" onClick={() => copiar('Assunto', assunto)}>
            Copiar assunto
          </button>
        ) : null}
        {corpo ? (
          <>
            <button type="button" className="sim-tab" onClick={() => copiar('Texto do e-mail', corpo)}>
              Copiar texto do e-mail
            </button>
            <button type="button" className="sim-tab" onClick={() => setModalAberto(true)}>
              Ver texto do e-mail
            </button>
          </>
        ) : null}
        {copiado ? <small style={{ color: '#15803d', fontWeight: 700 }}>{copiado} copiado</small> : null}
      </div>

      {modalAberto ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.45)',
            zIndex: 100001,
            display: 'grid',
            placeItems: 'center',
            padding: 20,
          }}
          onClick={() => setModalAberto(false)}
        >
          <div
            className="sim-card"
            style={{ width: 'min(640px, 100%)', maxHeight: '80vh', overflow: 'auto' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0 }}>Texto do e-mail</h3>
                <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: 13 }}>
                  Cole no corpo do e-mail e anexe o laudo (PDF/HTML) separadamente.
                </p>
              </div>
              <button type="button" className="sim-tab" onClick={() => setModalAberto(false)}>Fechar</button>
            </div>
            {assunto ? (
              <div style={{ marginBottom: 12 }}>
                <strong style={{ fontSize: 12, color: '#64748b' }}>Assunto</strong>
                <pre className="laudo-pre" style={{ marginTop: 6 }}>{assunto}</pre>
              </div>
            ) : null}
            {corpo ? (
              <div>
                <strong style={{ fontSize: 12, color: '#64748b' }}>Corpo</strong>
                <pre className="laudo-pre" style={{ marginTop: 6, maxHeight: '50vh', overflow: 'auto' }}>{corpo}</pre>
              </div>
            ) : null}
            <div className="sim-actions" style={{ marginTop: 14 }}>
              {assunto ? (
                <button type="button" className="sim-tab" onClick={() => copiar('Assunto', assunto)}>Copiar assunto</button>
              ) : null}
              {corpo ? (
                <button type="button" className="primary" onClick={() => copiar('Texto do e-mail', corpo)}>Copiar texto do e-mail</button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
