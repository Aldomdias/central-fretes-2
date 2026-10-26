import { useEffect, useState } from 'react';
import { PERGUNTAR_PASTA, normalizarPasta } from '../../utils/robos/sapLancamentoVbs';

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

// "C:\Pasta\resultado.csv" ou, se a pasta e escolhida na hora de rodar, o nome do arquivo com o aviso.
export function caminhoArquivo(pasta, nome) {
  return pasta === PERGUNTAR_PASTA ? `${nome} (na pasta que você escolher ao rodar o script)` : `${pasta}\\${nome}`;
}

export default function CampoPasta({ pasta, onChange, padrao }) {
  const perguntar = pasta === PERGUNTAR_PASTA;
  const valida = perguntar || /^[A-Za-z]:\\/.test(pasta) || /^\\\\/.test(pasta);
  return (
    <div className="field" style={{ maxWidth: 520, marginBottom: 10 }}>
      <label>Pasta do computador para o resultado e o log</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          style={{ flex: 1, minWidth: 220 }}
          value={perguntar ? '' : pasta}
          disabled={perguntar}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => onChange(normalizarPasta(pasta, padrao))}
          placeholder={perguntar ? 'O script vai abrir a janela para escolher a pasta' : padrao}
        />
        <button type="button" className="btn-secondary" onClick={() => onChange(perguntar ? padrao : PERGUNTAR_PASTA)}>
          {perguntar ? 'Digitar o caminho' : 'Escolher pasta ao rodar'}
        </button>
      </div>
      <div style={{ fontSize: 12, marginTop: 4, color: valida ? '#64748b' : '#b91c1c' }}>
        {perguntar
          ? 'Ao dar dois cliques no .vbs, abre a janela do Windows para você escolher a pasta (pode criar uma nova).'
          : valida
            ? 'O script cria a pasta se ela não existir. O arquivo .vbs em si vai para a pasta de downloads do navegador.'
            : 'Informe um caminho completo, como C:\\Temp\\LancamentoNFSe.'}
      </div>
    </div>
  );
}
