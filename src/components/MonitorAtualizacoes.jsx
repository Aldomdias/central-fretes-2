import { useCallback, useEffect, useMemo, useState } from 'react';
import { usuarioTemAcesso } from '../utils/authLocal';
import { carregarMonitorAtualizacoes } from '../services/monitorAtualizacoesService';

const DIA = 24 * 60 * 60 * 1000;

const FONTES = [
  { tipo: 'faturas-verum', titulo: 'Faturas Verum', pagina: 'faturas', diasOk: 1, diasAtencao: 3 },
  { tipo: 'sap-pagamentos', titulo: 'SAP e partidas', pagina: 'financeiro-auditoria', diasOk: 1, diasAtencao: 3 },
  { tipo: 'doccob', titulo: 'DOCCOB', pagina: 'ferramentas', diasOk: 1, diasAtencao: 3 },
  { tipo: 'ctes', titulo: 'CT-es', pagina: 'cte', diasOk: 3, diasAtencao: 7 },
  { tipo: 'tracking', titulo: 'Tracking', pagina: 'tracking', diasOk: 3, diasAtencao: 7 },
];

function estado(fonte, registro) {
  if (!registro?.criado_em) return { classe: 'sem-registro', texto: 'Sem registro' };
  const idade = Date.now() - new Date(registro.criado_em).getTime();
  const dias = Math.max(0, Math.floor(idade / DIA));
  const tempo = dias > 0 ? `há ${dias} dia${dias === 1 ? '' : 's'}` : 'hoje';
  if (idade <= fonte.diasOk * DIA) return { classe: 'em-dia', texto: `Em dia · ${tempo}` };
  if (idade <= fonte.diasAtencao * DIA) return { classe: 'atencao', texto: `Atenção · ${tempo}` };
  return { classe: 'atrasada', texto: `Desatualizada · ${tempo}` };
}

function dataHora(valor) {
  if (!valor) return 'Nenhuma atualização registrada';
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? String(valor) : data.toLocaleString('pt-BR');
}

export default function MonitorAtualizacoes({ usuario, onMudarPagina }) {
  const [registros, setRegistros] = useState({});
  const [carregando, setCarregando] = useState(true);

  const atualizar = useCallback(async () => {
    setCarregando(true);
    try { setRegistros(await carregarMonitorAtualizacoes()); } finally { setCarregando(false); }
  }, []);

  useEffect(() => { void atualizar(); }, [atualizar]);
  useEffect(() => {
    const ouvir = () => void atualizar();
    window.addEventListener('importacoes-registro-atualizado', ouvir);
    return () => window.removeEventListener('importacoes-registro-atualizado', ouvir);
  }, [atualizar]);

  const fontes = useMemo(() => FONTES.map((fonte) => ({
    ...fonte,
    registro: registros[fonte.tipo],
    estado: estado(fonte, registros[fonte.tipo]),
    podeAbrir: usuarioTemAcesso(usuario, fonte.pagina),
  })), [registros, usuario]);
  const emDia = fontes.filter((fonte) => fonte.estado.classe === 'em-dia').length;

  return (
    <section className="updates-monitor" aria-labelledby="updates-monitor-title">
      <div className="updates-monitor-head">
        <div>
          <span>Visível para todos os perfis</span>
          <h2 id="updates-monitor-title">Monitor de atualizações</h2>
        </div>
        <div className="updates-monitor-summary">
          <strong>{carregando ? 'Atualizando…' : `${emDia} de ${fontes.length} em dia`}</strong>
          <button type="button" onClick={atualizar} disabled={carregando}>Atualizar</button>
        </div>
      </div>
      <div className="updates-monitor-grid">
        {fontes.map((fonte) => (
          <article className="updates-monitor-card" key={fonte.tipo}>
            <div className="updates-monitor-card-head">
              <strong>{fonte.titulo}</strong>
              <span className={`updates-status ${fonte.estado.classe}`}>{fonte.estado.texto}</span>
            </div>
            <small>Última atualização</small>
            <p>{dataHora(fonte.registro?.criado_em)}</p>
            {fonte.registro?.usuario && <em>Por {fonte.registro.usuario}</em>}
            {fonte.podeAbrir && <button type="button" className="updates-open" onClick={() => onMudarPagina(fonte.pagina)}>Abrir tela →</button>}
          </article>
        ))}
      </div>
    </section>
  );
}
