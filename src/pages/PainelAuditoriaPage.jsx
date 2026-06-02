import { useEffect, useState, useMemo } from 'react';
import {
  carregarLancamentosAuditoriaSupabase,
  carregarSolicitacoesSupabase,
  carregarPendenciasAuditoriaSupabase,
  carregarSolicitacoesInfoSupabase,
  carregarFaturasSupabase,
  atualizarPendenciaAuditoriaSupabase,
  registrarEventoHistoricoSupabase,
} from '../services/lotacaoSupabaseService';
import { carregarSessao } from '../utils/authLocal';

function fmt(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function fmtData(v) {
  if (!v) return '-';
  const s = String(v).slice(0, 10);
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

function horasDesde(dt) {
  if (!dt) return 0;
  return (Date.now() - new Date(dt).getTime()) / 3600000;
}

function valorOriginalPendencia(pendencia = {}) {
  return Number(pendencia.valor_original ?? pendencia.valor_autorizado ?? 0) || 0;
}

function valorAdicionalPendencia(pendencia = {}) {
  return Number(pendencia.valor_adicional_aprovado ?? pendencia.valor_excedente ?? 0) || 0;
}

function valorFinalPendencia(pendencia = {}) {
  const finalGravado = Number(pendencia.valor_final_autorizado);
  if (Number.isFinite(finalGravado) && finalGravado > 0) return finalGravado;
  return valorOriginalPendencia(pendencia) + valorAdicionalPendencia(pendencia);
}

function Card({ label, valor, sub, cor, destaque }) {
  return (
    <div
      className="summary-card"
      style={{
        borderLeft: `4px solid ${cor || '#9153F0'}`,
        background: destaque ? '#fff5f5' : undefined,
      }}
    >
      <span>{label}</span>
      <strong style={{ color: destaque ? '#9b1111' : undefined }}>{valor}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}

export default function PainelAuditoriaPage() {
  const sessao = carregarSessao();

  const [lancamentos, setLancamentos] = useState([]);
  const [solicitacoes, setSolicitacoes] = useState([]);
  const [pendencias, setPendencias] = useState([]);
  const [solsInfo, setSolsInfo] = useState([]);
  const [faturas, setFaturas] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState('');

  const [filtros, setFiltros] = useState({
    transportadora: '',
    status: '',
    auditor: '',
    apenasMinhaCarteira: false,
  });

  const carregar = async () => {
    setCarregando(true);
    setMensagem('Carregando dados do Supabase...');
    try {
      const [lancs, sols, pends, solInfo, fats] = await Promise.all([
        carregarLancamentosAuditoriaSupabase(),
        carregarSolicitacoesSupabase(),
        carregarPendenciasAuditoriaSupabase(),
        carregarSolicitacoesInfoSupabase(),
        carregarFaturasSupabase({}),
      ]);
      setLancamentos(lancs || []);
      setSolicitacoes(sols || []);
      setPendencias(pends || []);
      setSolsInfo(solInfo || []);
      setFaturas(fats || []);
      setMensagem('');
    } catch (err) {
      setMensagem(`Erro ao carregar: ${err.message}`);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => { carregar(); }, []);

  // ── Cálculos de cards ────────────────────────────────────────────────────
  const excedentes = useMemo(() => pendencias.filter((p) => p.status === 'EXCEDEU_AGUARDANDO_OPERACAO'), [pendencias]);
  const aprovados = useMemo(() => pendencias.filter((p) => p.status === 'APROVADO_OPERACAO'), [pendencias]);
  const recusados = useMemo(() => pendencias.filter((p) => p.status === 'RECUSADO_OPERACAO'), [pendencias]);
  const aguardandoInfo = useMemo(() => solsInfo.filter((s) => s.status === 'AGUARDANDO_INFORMACAO'), [solsInfo]);

  const acima24h = useMemo(() => excedentes.filter((p) => horasDesde(p.created_at) > 24), [excedentes]);
  const acima48h = useMemo(() => excedentes.filter((p) => horasDesde(p.created_at) > 48), [excedentes]);

  const valorTotalAuditado = useMemo(
    () => lancamentos.reduce((s, l) => s + Number(l.valorLancado || l.valor_lancado || 0), 0),
    [lancamentos],
  );
  const valorTotalExcedente = useMemo(
    () => pendencias.reduce((s, p) => s + Number(p.valor_excedente || 0), 0),
    [pendencias],
  );
  const valorBloqueado = useMemo(
    () => excedentes.reduce((s, p) => s + Number(p.valor_excedente || 0), 0),
    [excedentes],
  );

  const faturasAguardando = useMemo(() => faturas.filter((f) => f.status === 'PENDENTE'), [faturas]);
  const hoje = new Date().toISOString().slice(0, 10);
  const faturasVencidas = useMemo(
    () => faturas.filter((f) => f.data_vencimento && f.data_vencimento < hoje && f.status !== 'PAGA'),
    [faturas, hoje],
  );

  // ── Filtragem da lista de pendências ─────────────────────────────────────
  const pendenciasFiltradas = useMemo(() => {
    let lista = pendencias;
    if (filtros.transportadora)
      lista = lista.filter((p) => String(p.transportadora || '').toUpperCase().includes(filtros.transportadora.toUpperCase()));
    if (filtros.status)
      lista = lista.filter((p) => p.status === filtros.status);
    if (filtros.auditor)
      lista = lista.filter((p) => String(p.audited_by_name || '').toUpperCase().includes(filtros.auditor.toUpperCase()));
    if (filtros.apenasMinhaCarteira && sessao?.email)
      lista = lista.filter((p) => (p.audited_by_email || '').toLowerCase() === sessao.email.toLowerCase());
    return lista;
  }, [pendencias, filtros, sessao]);

  const concluirPendencia = async (pendencia, statusNovo) => {
    const comentario = statusNovo === 'FINALIZADO'
      ? 'Auditoria finalizada apos aprovacao da operacao.'
      : 'Pendencia devolvida pela auditoria apos retorno da operacao.';
    setCarregando(true);
    try {
      await atualizarPendenciaAuditoriaSupabase(pendencia.id, statusNovo, {
        resposta_auditoria: comentario,
        auditado_ok_em: statusNovo === 'FINALIZADO' ? new Date().toISOString() : null,
        devolvido_auditoria_em: statusNovo === 'DEVOLVIDO_AUDITORIA' ? new Date().toISOString() : null,
      });
      await registrarEventoHistoricoSupabase({
        pendenciaId: pendencia.id,
        lancamentoId: pendencia.lancamento_id || '',
        userId: sessao?.id || '',
        userName: sessao?.nome || '',
        userEmail: sessao?.email || '',
        acao: statusNovo,
        statusAnterior: pendencia.status || '',
        statusNovo,
        comentario,
        origemTela: 'PAINEL_AUDITORIA',
      });
      await carregar();
    } catch (err) {
      setMensagem(`Erro ao atualizar pendencia: ${err.message}`);
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <span className="amd-mini-brand">Auditoria · Painel</span>
        <h1>Painel da Auditoria</h1>
        <p>Visão centralizada de faturas, excedentes, pendências, informações solicitadas e SLA.</p>
      </div>

      {/* Botão atualizar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
        <button className="btn-primary" onClick={carregar} disabled={carregando}>
          {carregando ? 'Atualizando...' : '↻ Atualizar dados'}
        </button>
      </div>

      {mensagem && <div className="hint-box compact">{mensagem}</div>}

      {/* ── Cards de visão geral ── */}
      <div className="summary-strip" style={{ flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
        <Card label="Faturas aguardando auditoria" valor={faturasAguardando.length} cor="#9153F0" />
        <Card label="Faturas vencidas" valor={faturasVencidas.length} cor="#9b1111" destaque={faturasVencidas.length > 0} />
        <Card label="Excedentes enviados para operação" valor={excedentes.length} cor="#e67e22" />
        <Card label="Excedentes aprovados" valor={aprovados.length} cor="#04C7A4" />
        <Card label="Excedentes recusados" valor={recusados.length} cor="#9b1111" />
        <Card label="Aguardando informação" valor={aguardandoInfo.length} cor="#f0a800" />
        <Card
          label="Casos acima de 24h"
          valor={acima24h.length}
          cor="#e67e22"
          destaque={acima24h.length > 0}
          sub="sem aprovação da operação"
        />
        <Card
          label="Casos acima de 48h"
          valor={acima48h.length}
          cor="#9b1111"
          destaque={acima48h.length > 0}
          sub="escalonamento necessário"
        />
        <Card label="Valor total auditado" valor={fmt(valorTotalAuditado)} cor="#9153F0" />
        <Card label="Valor total excedente" valor={fmt(valorTotalExcedente)} cor="#e67e22" />
        <Card label="Valor bloqueado / em análise" valor={fmt(valorBloqueado)} cor="#9b1111" />
      </div>

      {/* ── Alerta SLA ── */}
      {acima24h.length > 0 && (
        <div
          className="hint-box compact"
          style={{ background: '#fff3cd', borderLeft: '4px solid #f0a800', marginBottom: '1rem' }}
        >
          ⏰ <strong>Atenção:</strong> Existem {acima24h.length} solicitação(ões) aguardando aprovação há mais de 24h.
          {acima48h.length > 0 && ` Delas, ${acima48h.length} ultrapassaram 48h e precisam de escalonamento.`}
        </div>
      )}

      {/* ── Filtros ── */}
      <div className="panel-card">
        <div className="panel-title" style={{ marginBottom: '0.75rem' }}>Filtros</div>
        <div className="form-grid four">
          <label className="field">
            Transportadora
            <input
              value={filtros.transportadora}
              onChange={(e) => setFiltros((p) => ({ ...p, transportadora: e.target.value }))}
              placeholder="Nome ou parte"
            />
          </label>
          <label className="field">
            Status
            <select value={filtros.status} onChange={(e) => setFiltros((p) => ({ ...p, status: e.target.value }))}>
              <option value="">Todos</option>
              <option value="EXCEDEU_AGUARDANDO_OPERACAO">Aguardando operação</option>
              <option value="APROVADO_OPERACAO">Aprovado</option>
              <option value="RECUSADO_OPERACAO">Recusado</option>
              <option value="AGUARDANDO_INFORMACAO">Aguardando info</option>
              <option value="DEVOLVIDO_AUDITORIA">Devolvido</option>
              <option value="FINALIZADO">Finalizado</option>
            </select>
          </label>
          <label className="field">
            Auditor
            <input
              value={filtros.auditor}
              onChange={(e) => setFiltros((p) => ({ ...p, auditor: e.target.value }))}
              placeholder="Nome do auditor"
            />
          </label>
          <label className="field" style={{ justifyContent: 'center', display: 'flex', flexDirection: 'column' }}>
            &nbsp;
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={filtros.apenasMinhaCarteira}
                onChange={(e) => setFiltros((p) => ({ ...p, apenasMinhaCarteira: e.target.checked }))}
              />
              Apenas minha carteira
            </label>
          </label>
        </div>
      </div>

      {/* ── Tabela de pendências ── */}
      <div className="table-card">
        <div className="panel-title" style={{ padding: '0.75rem 1rem 0.25rem' }}>
          Pendências de excedente ({pendenciasFiltradas.length})
        </div>
        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead>
              <tr>
                <th>Data</th>
                <th>Auditor</th>
                <th>Transportadora</th>
                <th>DIST</th>
                <th>CT-e</th>
                <th>Fatura</th>
                <th>Valor lançado</th>
                <th>Excedente</th>
                <th>Final autorizado</th>
                <th>Tempo (h)</th>
                <th>Status</th>
                <th>Justificativa</th>
                <th>Acao</th>
              </tr>
            </thead>
            <tbody>
              {pendenciasFiltradas.map((p) => {
                const horas = horasDesde(p.created_at);
                const atrasado = horas > 24;
                return (
                  <tr key={p.id} style={{ background: horas > 48 ? '#fff5f5' : horas > 24 ? '#fffbf0' : undefined }}>
                    <td>{fmtData(p.created_at)}</td>
                    <td>
                      <span title={p.audited_by_email || ''}>{p.audited_by_name || '-'}</span>
                    </td>
                    <td>{p.transportadora || '-'}</td>
                    <td><strong>{p.dist || '-'}</strong></td>
                    <td>{p.cte || '-'}</td>
                    <td>{p.fatura || '-'}</td>
                    <td>{fmt(p.valor_lancado)}</td>
                    <td className="negativo">{fmt(valorAdicionalPendencia(p))}</td>
                    <td>{p.status === 'APROVADO_OPERACAO' || p.status === 'FINALIZADO' ? fmt(valorFinalPendencia(p)) : '-'}</td>
                    <td style={{ color: atrasado ? '#e67e22' : undefined }}>
                      {horas.toFixed(0)}h {horas > 48 && '🔴'}
                      {horas > 24 && horas <= 48 && '🟡'}
                    </td>
                    <td>
                      <span className="status-pill">{p.status?.replace(/_/g, ' ')}</span>
                    </td>
                    <td style={{ maxWidth: 200, whiteSpace: 'normal', fontSize: '0.82rem' }}>
                      {p.observation || '-'}
                    </td>
                    <td>
                      {p.status === 'APROVADO_OPERACAO' && (
                        <button
                          className="btn-primary"
                          style={{ padding: '2px 10px', fontSize: '0.8rem' }}
                          onClick={() => concluirPendencia(p, 'FINALIZADO')}
                        >
                          Auditado OK
                        </button>
                      )}
                      {p.status === 'RECUSADO_OPERACAO' && (
                        <button
                          className="btn-secondary"
                          style={{ padding: '2px 10px', fontSize: '0.8rem' }}
                          onClick={() => concluirPendencia(p, 'DEVOLVIDO_AUDITORIA')}
                        >
                          Devolver
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!pendenciasFiltradas.length && !carregando && (
                <tr><td colSpan="13">Nenhuma pendência encontrada.</td></tr>
              )}
              {carregando && (
                <tr><td colSpan="13">Carregando...</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Solicitações de informação ── */}
      {aguardandoInfo.length > 0 && (
        <div className="table-card" style={{ marginTop: '1rem' }}>
          <div className="panel-title" style={{ padding: '0.75rem 1rem 0.25rem' }}>
            Solicitações de informação pendentes ({aguardandoInfo.length})
          </div>
          <div className="sim-analise-tabela-wrap">
            <table className="sim-analise-tabela">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Tipo</th>
                  <th>Chave/Número</th>
                  <th>Transportadora</th>
                  <th>Descrição</th>
                  <th>Prioridade</th>
                  <th>Responsável</th>
                  <th>Prazo</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {aguardandoInfo.map((s) => (
                  <tr key={s.id}>
                    <td>{fmtData(s.created_at)}</td>
                    <td>{s.tipo}</td>
                    <td><strong>{s.chave_informada || s.numero_informado || '-'}</strong></td>
                    <td>{s.transportadora || '-'}</td>
                    <td style={{ fontSize: '0.82rem' }}>{s.descricao_problema || '-'}</td>
                    <td>
                      <span style={{ color: s.prioridade === 'URGENTE' ? '#9b1111' : s.prioridade === 'ALTA' ? '#e67e22' : undefined }}>
                        {s.prioridade}
                      </span>
                    </td>
                    <td>{s.responsavel_nome || '-'}</td>
                    <td>{fmtData(s.prazo)}</td>
                    <td><span className="status-pill">{s.status?.replace(/_/g, ' ')}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
