import { useEffect, useState } from 'react';
import { listarPendentesFila } from '../../services/robosFilaService';
import { aguardandoResultado } from '../../utils/robos/filaRobo';
import { isoParaBr } from '../../utils/robos/lancamentoComum';

const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const hora = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };

// Quem mandou notas para o robo e ainda nao trouxe nada de volta (nem pedido, nem MIRO, nem falha).
export function TextoAguardando({ grupos }) {
  if (!grupos.length) return null;
  return (
    <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
      {grupos.slice(0, 5).map((g) => (
        <li key={`${g.tipo}${g.por}${g.quando}`}>
          <b>{g.por || 'Alguém'}</b> mandou {fmt(g.total)} {g.tipo === 'CTE' ? 'CT-e' : 'nota(s)'} para o robô em {isoParaBr(g.quando.slice(0, 10))} {hora(g.quando)} e o resultado ainda não voltou.
        </li>
      ))}
    </ul>
  );
}

export default function AvisoFila({ tipo }) {
  const [grupos, setGrupos] = useState([]);
  useEffect(() => {
    let vivo = true;
    listarPendentesFila().then((r) => { if (vivo) setGrupos(aguardandoResultado((r.itens || []).filter((i) => i.tipo === tipo))); });
    return () => { vivo = false; };
  }, [tipo]);
  if (!grupos.length) return null;
  return (
    <div style={{ padding: 12, borderRadius: 8, background: '#fef3c7', color: '#92400e', fontSize: 13 }}>
      Resultado do robô pendente. Se o robô já rodou, importe o arquivo de resultado (a planilha do robô nova manda sozinha):
      <TextoAguardando grupos={grupos} />
    </div>
  );
}
