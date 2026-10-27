import { useRef, useState } from 'react';

// Mostra o script na tela para copiar e colar no Bloco de Notas: nas maquinas em que o antivirus
// bloqueia o download (.vbs ou .txt), nenhum arquivo e baixado pelo navegador.
export default function ScriptParaCopiar({ script, nomeArquivo, onFechar }) {
  const ref = useRef(null);
  const [copiado, setCopiado] = useState('');

  async function copiar() {
    try {
      await navigator.clipboard.writeText(script);
      setCopiado('Código copiado.');
    } catch {
      // sem permissao de area de transferencia: seleciona o texto para Ctrl+C
      ref.current?.focus();
      ref.current?.select();
      const ok = document.execCommand && document.execCommand('copy');
      setCopiado(ok ? 'Código copiado.' : 'Texto selecionado: aperte Ctrl+C.');
    }
  }

  return (
    <div
      onClick={onFechar}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 9999, display: 'grid', placeItems: 'center', padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 10, padding: 18, width: 'min(900px, 100%)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        <div className="panel-title" style={{ margin: 0 }}>Código do script</div>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6, fontSize: 14 }}>
          <li>Clique em <b>Copiar código</b>.</li>
          <li>Abra o <b>Bloco de Notas</b> e cole (Ctrl+V).</li>
          <li>Arquivo → Salvar como: em “Tipo”, escolha <b>Todos os arquivos</b> e salve com o nome <code>{nomeArquivo}</code>.</li>
          <li>Com o SAP aberto e logado, dê dois cliques no arquivo salvo.</li>
        </ol>
        <textarea
          ref={ref}
          readOnly
          value={script}
          spellCheck={false}
          style={{ flex: 1, minHeight: 260, fontFamily: 'Consolas, monospace', fontSize: 12, whiteSpace: 'pre', overflow: 'auto' }}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn-primary" onClick={copiar}>Copiar código</button>
          <button type="button" className="btn-secondary" onClick={onFechar}>Fechar</button>
          {copiado ? <span style={{ color: '#15803d', fontSize: 13 }}>{copiado}</span> : null}
        </div>
      </div>
    </div>
  );
}
