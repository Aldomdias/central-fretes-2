import { useEffect, useState } from 'react';
import { normalizarPasta } from '../../utils/robos/sapLancamentoVbs';

// Pasta do computador onde o script grava o resultado (.csv) e o log. Cada pessoa escolhe a sua;
// fica lembrada neste navegador.
export function usePastaTrabalho(chave, padrao) {
  const [pasta, setPasta] = useState(() => {
    try { return normalizarPasta(window.localStorage.getItem(chave), padrao); } catch { return padrao; }
  });
  useEffect(() => {
    try { window.localStorage.setItem(chave, pasta); } catch { /* sem localStorage */ }
  }, [chave, pasta]);
  return [pasta, setPasta];
}

export default function CampoPasta({ pasta, onChange, padrao }) {
  const valida = /^[A-Za-z]:\\/.test(pasta) || /^\\\\/.test(pasta);
  return (
    <div className="field" style={{ maxWidth: 460, marginBottom: 10 }}>
      <label>Pasta do computador para o resultado e o log</label>
      <input value={pasta} onChange={(e) => onChange(e.target.value)} onBlur={() => onChange(normalizarPasta(pasta, padrao))} placeholder={padrao} />
      <div style={{ fontSize: 12, marginTop: 4, color: valida ? '#64748b' : '#b91c1c' }}>
        {valida
          ? 'O script cria a pasta se ela não existir. O arquivo .vbs em si vai para a pasta de downloads do navegador.'
          : 'Informe um caminho completo, como C:\\Temp\\LancamentoNFSe.'}
      </div>
    </div>
  );
}
