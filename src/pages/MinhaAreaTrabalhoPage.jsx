import { useEffect, useMemo, useState } from 'react';
import { usuarioTemAcesso } from '../utils/authLocal';
import { salvarPreferenciasInterface } from '../utils/preferenciasInterface';
import MonitorAtualizacoes from '../components/MonitorAtualizacoes';

const BLOCOS = {
  lancarCte: { titulo: 'Lançar CT-e', descricao: 'Abra diretamente o fluxo atual de CT-e.', pagina: 'cte', tom: 'operacao' },
  tracking: { titulo: 'Tracking', descricao: 'Consulte entregas e acompanhe ocorrências.', pagina: 'tracking', tom: 'operacao' },
  operacao: { titulo: 'Painel da operação', descricao: 'Acompanhe cargas, pendências e execução.', pagina: 'painel-operacao', tom: 'operacao' },
  faturas: { titulo: 'Faturas para auditar', descricao: 'Entre na carteira de auditoria de fretes.', pagina: 'faturas', tom: 'auditoria' },
  diagnostico: { titulo: 'Diagnóstico de CT-e', descricao: 'Investigue cálculos e divergências de frete.', pagina: 'auditoria-cte', tom: 'auditoria' },
  sap: { titulo: 'Acompanhamento SAP e OMS', descricao: 'Veja protocolos, financeiro e integrações.', pagina: 'financeiro-auditoria', tom: 'auditoria' },
  propostas: { titulo: 'Propostas e negociações', descricao: 'Compare rodadas, tabelas e aprovações.', pagina: 'tabelas-negociacao', tom: 'suprimentos' },
  realizado: { titulo: 'Simulador do Realizado', descricao: 'Meça oportunidades na operação realizada.', pagina: 'perda-realizado', tom: 'suprimentos' },
  laudos: { titulo: 'Laudos e reajustes', descricao: 'Analise impactos e evidências da negociação.', pagina: 'reajustes', tom: 'suprimentos' },
  contratos: { titulo: 'Contratos', descricao: 'Acompanhe vigências e documentos negociados.', pagina: 'gestao-contratos', tom: 'suprimentos' },
  transportadoras: { titulo: 'Transportadoras', descricao: 'Mantenha origens, rotas, cotações e taxas.', pagina: 'transportadoras', tom: 'base' },
  simulador: { titulo: 'Simulador de fretes', descricao: 'Compare tabelas e impactos por rota.', pagina: 'simulador', tom: 'base' },
};

const MODELOS = {
  operacao: { nome: 'Operação', blocos: ['lancarCte', 'tracking', 'operacao', 'transportadoras'] },
  auditoria: { nome: 'Auditoria', blocos: ['faturas', 'diagnostico', 'sap', 'lancarCte'] },
  suprimentos: { nome: 'Suprimentos e Negociação', blocos: ['propostas', 'realizado', 'laudos', 'contratos', 'simulador'] },
};

function modeloParaPerfil(perfil) {
  if (['AUDITORIA_FRETES', 'AUDITORIA_LOTACAO', 'GESTOR_AUDITORIA_FRETES', 'FINANCEIRO'].includes(perfil)) return 'auditoria';
  if (perfil === 'NEGOCIACAO_FRETES') return 'suprimentos';
  return 'operacao';
}

function permitidos(usuario) {
  return Object.entries(BLOCOS).filter(([, bloco]) => usuarioTemAcesso(usuario, bloco.pagina)).map(([id]) => id);
}

export default function MinhaAreaTrabalhoPage({ usuario, preferencias, onPreferencias, onMudarPagina }) {
  const disponiveis = useMemo(() => permitidos(usuario), [usuario]);
  const modeloInicial = preferencias.modeloArea || modeloParaPerfil(usuario?.perfil);
  const idsIniciais = (preferencias.blocos.length ? preferencias.blocos : MODELOS[modeloInicial].blocos)
    .filter((id) => disponiveis.includes(id));
  const [editando, setEditando] = useState(false);
  const [blocos, setBlocos] = useState(idsIniciais);
  const [fixados, setFixados] = useState(() => preferencias.fixados || []);

  useEffect(() => {
    const nova = { ...preferencias, blocos, fixados, modeloArea: preferencias.modeloArea || modeloInicial };
    salvarPreferenciasInterface(usuario, nova);
    onPreferencias(nova);
  // O pai mantem a identidade do objeto sincronizada; persistimos apenas quando a composicao muda.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocos, fixados]);

  const aplicarModelo = (id) => {
    const lista = MODELOS[id].blocos.filter((item) => disponiveis.includes(item));
    const nova = { ...preferencias, modeloArea: id, blocos: lista, fixados: [] };
    setBlocos(lista);
    setFixados([]);
    salvarPreferenciasInterface(usuario, nova);
    onPreferencias(nova);
  };

  const mover = (id, direcao) => {
    setBlocos((atual) => {
      const origem = atual.indexOf(id);
      const destino = origem + direcao;
      if (origem < 0 || destino < 0 || destino >= atual.length) return atual;
      const proximo = [...atual];
      [proximo[origem], proximo[destino]] = [proximo[destino], proximo[origem]];
      return proximo;
    });
  };

  const ordenados = [...blocos].sort((a, b) => Number(fixados.includes(b)) - Number(fixados.includes(a)));
  const ausentes = disponiveis.filter((id) => !blocos.includes(id));

  return (
    <div className="workspace-page page-shell">
      <header className="workspace-hero">
        <div>
          <span className="workspace-eyebrow">Minha Área de Trabalho</span>
          <h1>Olá, {usuario?.nome?.split(' ')[0] || 'usuário'}.</h1>
          <p>Seus fluxos mais importantes, organizados conforme seu acesso.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => setEditando((valor) => !valor)} aria-pressed={editando}>
          {editando ? 'Concluir personalização' : 'Personalizar área'}
        </button>
      </header>

      <MonitorAtualizacoes usuario={usuario} onMudarPagina={onMudarPagina} />

      {editando && (
        <section className="workspace-editor" aria-label="Personalização da área de trabalho">
          <div className="workspace-models">
            <strong>Modelos iniciais</strong>
            {Object.entries(MODELOS).map(([id, modelo]) => (
              <button type="button" key={id} onClick={() => aplicarModelo(id)}>{modelo.nome}</button>
            ))}
            <button type="button" onClick={() => aplicarModelo(modeloParaPerfil(usuario?.perfil))}>Restaurar padrão do perfil</button>
          </div>
          {ausentes.length > 0 && (
            <div className="workspace-add">
              <strong>Adicionar bloco</strong>
              {ausentes.map((id) => <button type="button" key={id} onClick={() => setBlocos((lista) => [...lista, id])}>+ {BLOCOS[id].titulo}</button>)}
            </div>
          )}
          <p className="workspace-help">Use as setas para reordenar por toque ou teclado. Blocos fixados aparecem primeiro.</p>
        </section>
      )}

      <section className="workspace-grid" aria-label="Blocos da área de trabalho">
        {ordenados.map((id) => {
          const bloco = BLOCOS[id];
          const indice = blocos.indexOf(id);
          return (
            <article
              className={`workspace-card tone-${bloco.tom} ${editando ? '' : 'is-clickable'}`}
              key={id}
              role={editando ? undefined : 'button'}
              tabIndex={editando ? undefined : 0}
              onClick={editando ? undefined : () => onMudarPagina(bloco.pagina)}
              onKeyDown={editando ? undefined : (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onMudarPagina(bloco.pagina);
                }
              }}
              aria-label={editando ? undefined : `Abrir ${bloco.titulo}`}
            >
              <div className="workspace-card-mark" aria-hidden="true" />
              <div className="workspace-card-copy">
                <span>{bloco.tom}</span>
                <h2>{bloco.titulo}</h2>
                <p>{bloco.descricao}</p>
              </div>
              {editando ? (
                <div className="workspace-card-controls" aria-label={`Organizar ${bloco.titulo}`}>
                  <button type="button" onClick={() => setFixados((lista) => lista.includes(id) ? lista.filter((item) => item !== id) : [...lista, id])} aria-pressed={fixados.includes(id)} title="Fixar bloco">{fixados.includes(id) ? 'Desafixar' : 'Fixar'}</button>
                  <button type="button" onClick={() => mover(id, -1)} disabled={indice === 0} aria-label={`Mover ${bloco.titulo} para cima`}>↑</button>
                  <button type="button" onClick={() => mover(id, 1)} disabled={indice === blocos.length - 1} aria-label={`Mover ${bloco.titulo} para baixo`}>↓</button>
                  <button type="button" className="danger" onClick={() => setBlocos((lista) => lista.filter((item) => item !== id))}>Remover</button>
                </div>
              ) : (
                <span className="workspace-open">Abrir <span aria-hidden="true">→</span></span>
              )}
            </article>
          );
        })}
      </section>

      {blocos.length === 0 && <div className="workspace-empty"><strong>Sua área está vazia.</strong><p>Use “Personalizar área” para adicionar um bloco ou restaurar um modelo.</p></div>}
    </div>
  );
}
