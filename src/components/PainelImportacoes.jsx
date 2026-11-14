import { useCallback, useEffect, useMemo, useState } from 'react';
import ImportarDoccobCard from './ImportarDoccobCard';
import XmlMassaCard from './XmlMassaCard';
import CentralAuditoriaFretesPage from '../pages/CentralAuditoriaFretesPage';
import CtePage from '../pages/CtePage';
import TrackingPage from '../pages/TrackingPage';
import { carregarStatusImportacoes } from '../services/importacoesStatusService';
import { carregarSessao, usuarioTemAcesso } from '../utils/authLocal';

// Central de importacoes do Dashboard: status de cada carga e a importacao numa janela
// aqui mesmo, sem trocar de tela. A janela usa o importador da propria tela (modo
// "so importacao"), com as mesmas opcoes de la (complementar, atualizar, substituir,
// competencia...). As telas originais continuam iguais.
const IMPORTACOES = [
  {
    tipo: 'faturas-verum', titulo: 'Faturas Verum', pagina: 'faturas',
    descricao: 'Planilha do Verum (abas Faturas e Detalhes).', diasOk: 1, diasAtencao: 3,
    opcoes: [{ rotulo: 'Importar', render: ({ onMudarPagina }) => <CentralAuditoriaFretesPage somenteImportacao="faturas" onMudarPagina={onMudarPagina} /> }],
  },
  {
    tipo: 'sap-pagamentos', titulo: 'SAP — pagamentos e partidas', pagina: 'financeiro-auditoria',
    descricao: 'Exportação SAP (contas a pagar): compensação, partida de fatura e partida de CT-e. Aceita vários arquivos ou pasta.', diasOk: 1, diasAtencao: 3,
    opcoes: [{ rotulo: 'Importar', render: ({ onMudarPagina }) => <CentralAuditoriaFretesPage somenteImportacao="sap" onMudarPagina={onMudarPagina} /> }],
  },
  {
    tipo: 'doccob', titulo: 'DOCCOB', pagina: 'ferramentas',
    descricao: 'Arquivo DocCob (.zip/.txt) do Verum: faturas com CT-es, vencimento e valor.', diasOk: 1, diasAtencao: 3,
    opcoes: [{ rotulo: 'Importar', render: () => <ImportarDoccobCard /> }],
  },
  {
    tipo: 'ctes', titulo: 'CT-es', pagina: 'cte',
    descricao: 'Planilha de CT-es (competência, complementar / atualizar / substituir) ou XMLs / pasta inteira.', diasOk: 3, diasAtencao: 7,
    opcoes: [
      { rotulo: 'Planilha', titulo: 'CT-es por planilha', render: ({ transportadoras }) => <CtePage transportadoras={transportadoras} somenteImportacao /> },
      { rotulo: 'XML', titulo: 'XML de CT-e em massa', render: () => <XmlMassaCard /> },
    ],
  },
  {
    tipo: 'tracking', titulo: 'Tracking', pagina: 'tracking',
    descricao: 'Planilhas de tracking (arquivo ou pasta): complementar só novos ou atualizar existentes.', diasOk: 3, diasAtencao: 7,
    opcoes: [{ rotulo: 'Importar', render: () => <TrackingPage somenteImportacao /> }],
  },
];

const DIA = 24 * 60 * 60 * 1000;

function dataHora(v) {
  if (!v) return '-';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function dataSo(v) {
  if (!v) return '-';
  const [a, m, d] = String(v).slice(0, 10).split('-');
  return d ? `${d}/${m}/${a}` : String(v);
}

function tempoDesde(ms) {
  if (ms < 60 * 60 * 1000) return `há ${Math.max(1, Math.round(ms / 60000))} min`;
  if (ms < DIA) return `há ${Math.round(ms / (60 * 60 * 1000))} h`;
  const dias = Math.floor(ms / DIA);
  return `há ${dias} dia${dias > 1 ? 's' : ''}`;
}

// Data de referencia: ultimo registro OK; sem registro, o indicador de data/hora da propria base.
function situacao(item, status) {
  const ref = status?.ultimoOk?.criado_em || status?.indicadores?.find((i) => i.tipo === 'datahora' && i.valor)?.valor || null;
  if (!ref) return { classe: 'cinza', texto: 'Sem registro', ref: null };
  const idade = Date.now() - new Date(ref).getTime();
  const quando = tempoDesde(idade);
  if (idade <= item.diasOk * DIA) return { classe: 'ok', texto: `Em dia · ${quando}`, ref };
  if (idade <= item.diasAtencao * DIA) return { classe: 'atencao', texto: `Atenção · ${quando}`, ref };
  return { classe: 'atrasada', texto: `Desatualizada · ${quando}`, ref };
}

const CORES = {
  ok: { fundo: '#ecfdf3', borda: '#bbf7d0', texto: '#166534', ponto: '#16a34a' },
  atencao: { fundo: '#fffbeb', borda: '#fde68a', texto: '#92400e', ponto: '#f59e0b' },
  atrasada: { fundo: '#fef2f2', borda: '#fecaca', texto: '#991b1b', ponto: '#dc2626' },
  cinza: { fundo: '#f8fafc', borda: '#e2e8f0', texto: '#475569', ponto: '#94a3b8' },
};

export default function PainelImportacoes({ onMudarPagina, transportadoras = [] }) {
  const sessao = carregarSessao();
  const visiveis = useMemo(() => IMPORTACOES.filter((item) => {
    if (!usuarioTemAcesso(sessao, item.pagina)) return false;
    // Perfil Financeiro ve so os protocolos na Central Financeira (sem a aba Pagamentos).
    if (item.tipo === 'sap-pagamentos' && sessao?.perfil === 'FINANCEIRO') return false;
    return true;
  }), [sessao?.perfil, sessao?.id]);
  const [status, setStatus] = useState({ porTipo: {}, origem: '' });
  const [carregando, setCarregando] = useState(true);
  const [modalAberto, setModalAberto] = useState(null);

  const atualizar = useCallback(async () => {
    setCarregando(true);
    try {
      setStatus(await carregarStatusImportacoes(visiveis.map((i) => i.tipo)));
    } finally {
      setCarregando(false);
    }
  }, [visiveis]);

  useEffect(() => { atualizar(); }, [atualizar]);
  useEffect(() => {
    const ouvir = () => atualizar();
    window.addEventListener('importacoes-registro-atualizado', ouvir);
    return () => window.removeEventListener('importacoes-registro-atualizado', ouvir);
  }, [atualizar]);

  if (!visiveis.length) return null;

  const fecharModal = () => {
    setModalAberto(null);
    atualizar();
  };

  const situacoes = visiveis.map((item) => situacao(item, status.porTipo[item.tipo]));
  const emDia = situacoes.filter((s) => s.classe === 'ok').length;

  return (
    <section className="dashboard-workbench">
      <div className="dashboard-section-title">
        <strong>Central de importações</strong>
        <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span>{carregando ? 'Atualizando status...' : `${emDia} de ${visiveis.length} em dia`}</span>
          <button type="button" className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={atualizar} disabled={carregando}>Atualizar</button>
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 12, marginTop: 12 }}>
        {visiveis.map((item, idx) => {
          const st = status.porTipo[item.tipo] || {};
          const sit = situacoes[idx];
          const cor = CORES[sit.classe];
          const ultimo = st.ultimo;
          const ultimoComErro = ultimo && ultimo.status !== 'OK';
          return (
            <div key={item.tipo} style={{ border: `1px solid ${cor.borda}`, borderRadius: 14, padding: 14, background: '#fff', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                <strong style={{ fontSize: 15 }}>{item.titulo}</strong>
                <span style={{ background: cor.fundo, color: cor.texto, border: `1px solid ${cor.borda}`, borderRadius: 99, padding: '2px 8px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: cor.ponto }} />
                  {sit.texto}
                </span>
              </div>
              <small style={{ color: 'var(--muted, #64748b)', lineHeight: 1.35 }}>{item.descricao}</small>
              <div style={{ fontSize: 12, display: 'grid', gap: 3, color: '#334155' }}>
                {st.ultimoOk ? (
                  <div>
                    Última importação: <b>{dataHora(st.ultimoOk.criado_em)}</b>{st.ultimoOk.usuario ? ` · ${st.ultimoOk.usuario}` : ''}
                    {st.ultimoOk.resumo && <div style={{ color: '#64748b' }} title={st.ultimoOk.arquivos || ''}>{st.ultimoOk.resumo}</div>}
                  </div>
                ) : (
                  <div style={{ color: '#64748b' }}>Nenhuma importação registrada por aqui ainda.</div>
                )}
                {ultimoComErro && (
                  <div style={{ color: '#b91c1c' }} title={ultimo.resumo || ''}>Última tentativa com erro em {dataHora(ultimo.criado_em)}{ultimo.resumo ? `: ${ultimo.resumo.slice(0, 120)}` : ''}</div>
                )}
                {(st.indicadores || []).filter((i) => i.valor).map((ind) => (
                  <div key={ind.rotulo}>{ind.rotulo}: <b>{ind.tipo === 'data' ? dataSo(ind.valor) : dataHora(ind.valor)}</b></div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
                {item.opcoes.map((op, i) => (
                  <button key={op.rotulo} type="button" className={i === 0 ? 'btn-primary' : 'btn-secondary'}
                    onClick={() => setModalAberto({ ...op, titulo: op.titulo || item.titulo })}>{op.rotulo}</button>
                ))}
                <button type="button" className="btn-secondary" onClick={() => onMudarPagina?.(item.pagina)}>Abrir tela</button>
              </div>
            </div>
          );
        })}
      </div>
      {status.origem === 'navegador' && !carregando && (
        <small style={{ display: 'block', marginTop: 10, color: '#92400e' }}>
          Histórico só deste navegador: o registro central no banco ainda não está disponível (migration 20261113_001_importacoes_registro.sql).
        </small>
      )}

      {modalAberto && (
        <div role="dialog" aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 10000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 16px', overflowY: 'auto' }}>
          <div style={{ background: 'var(--bg, #f8fafc)', borderRadius: 16, width: 'min(1180px, 100%)', boxShadow: '0 24px 60px rgba(0,0,0,.25)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 20px', borderBottom: '1px solid #e2e8f0', background: '#fff' }}>
              <strong>Importar — {modalAberto.titulo}</strong>
              <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <small style={{ color: '#64748b' }}>Não feche enquanto estiver importando.</small>
                <button type="button" className="btn-secondary" onClick={fecharModal}>Fechar</button>
              </span>
            </div>
            <div style={{ padding: 16 }}>
              {modalAberto.render({ onMudarPagina, transportadoras })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
