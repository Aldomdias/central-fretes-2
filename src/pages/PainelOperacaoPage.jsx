import { useEffect, useState, useMemo } from 'react';
import {
  carregarPendenciasAuditoriaSupabase,
  atualizarPendenciaAuditoriaSupabase,
  registrarEventoHistoricoSupabase,
  carregarSlaConfigSupabase,
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
      style={{ borderLeft: `4px solid ${cor || '#9153F0'}`, background: destaque ? '#fff5f5' : undefined }}
    >
      <span>{label}</span>
      <strong style={{ color: destaque ? '#9b1111' : undefined }}>{valor}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}

// Modal simples de aprovaÃ§Ã£o/recusa
function ModalAprovacao({ pendencia, onConfirmar, onCancelar }) {
  const [acao, setAcao] = useState('');
  const [motivo, setMotivo] = useState('');

  if (!pendencia) return null;
  const valorOriginal = valorOriginalPendencia(pendencia);
  const valorAdicional = valorAdicionalPendencia(pendencia);
  const valorFinal = valorOriginal + valorAdicional;

  const textoMotivo = acao === 'APROVADO_OPERACAO'
    ? 'Justificativa da aprovacao'
    : acao === 'RECUSADO_OPERACAO'
      ? 'Motivo da recusa'
      : 'Solicitacao / resposta';
  const placeholderMotivo = acao === 'APROVADO_OPERACAO'
    ? 'Informe por que este excedente esta sendo aprovado...'
    : acao === 'RECUSADO_OPERACAO'
      ? 'Informe o motivo da recusa...'
      : 'Descreva a informacao necessaria para continuar...';

  const confirmar = () => {
    if (!acao) return;
    if (!motivo.trim()) return;
    onConfirmar(pendencia.id, acao, motivo);
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
      }}
    >
      <div className="panel-card" style={{ maxWidth: 520, width: '90%', margin: 0 }}>
        <div className="panel-title">AprovaÃ§Ã£o de excedente</div>
        <div className="sim-analise-resumo" style={{ marginTop: '0.75rem' }}>
          <div><span>Transportadora</span><strong>{pendencia.transportadora || '-'}</strong></div>
          <div><span>DIST</span><strong>{pendencia.dist || '-'}</strong></div>
          <div><span>CT-e</span><strong>{pendencia.cte || '-'}</strong></div>
          <div><span>Valor original</span><strong>{fmt(valorOriginal)}</strong></div>
          <div><span>Adicional solicitado</span><strong style={{ color: '#9b1111' }}>{fmt(valorAdicional)}</strong></div>
          <div><span>Final autorizado</span><strong style={{ color: '#0f7a58' }}>{fmt(valorFinal)}</strong></div>
          <div><span>Auditor</span><strong>{pendencia.audited_by_name || '-'}</strong></div>
        </div>
        {pendencia.observation && (
          <div className="hint-box compact" style={{ marginTop: '0.5rem' }}>
            <strong>Justificativa do auditor:</strong> {pendencia.observation}
          </div>
        )}

        <div className="form-grid" style={{ marginTop: '0.75rem' }}>
          <label className="field">
            AÃ§Ã£o
            <select value={acao} onChange={(e) => setAcao(e.target.value)}>
              <option value="">Selecione...</option>
              <option value="APROVADO_OPERACAO">âœ“ Aprovar â€” liberar saldo adicional</option>
              <option value="RECUSADO_OPERACAO">âœ— Recusar â€” devolver para auditoria</option>
              <option value="AGUARDANDO_INFORMACAO">â³ Solicitar mais informaÃ§Ãµes</option>
            </select>
          </label>
          <label className="field">
            {textoMotivo} <span style={{ color: '#c0392b' }}>*</span>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={placeholderMotivo}
              style={{ minHeight: 70 }}
            />
          </label>
        </div>

        {acao === 'APROVADO_OPERACAO' && (
          <div className="hint-box compact" style={{ marginTop: '0.5rem' }}>
            Ao confirmar, o sistema libera o adicional e registra: {fmt(valorOriginal)} + {fmt(valorAdicional)} = {fmt(valorFinal)}.
          </div>
        )}

        <div className="actions-right" style={{ marginTop: '0.75rem' }}>
          <button className="btn-secondary" onClick={onCancelar}>Cancelar</button>
          <button
            className="btn-primary"
            onClick={confirmar}
            disabled={!acao || !motivo.trim()}
          >
            {acao === 'APROVADO_OPERACAO' ? 'Confirmar aprovacao' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PainelOperacaoPage() {
  const sessao = carregarSessao();

  const [pendencias, setPendencias] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [pendenciaSelecionada, setPendenciaSelecionada] = useState(null);
  const [slaConfig, setSlaConfig] = useState(null);

  const [filtros, setFiltros] = useState({ status: 'EXCEDEU_AGUARDANDO_OPERACAO', transportadora: '' });

  const carregar = async () => {
    setCarregando(true);
    setMensagem('');
    try {
      const [pends, sla] = await Promise.all([
        carregarPendenciasAuditoriaSupabase({}),
        carregarSlaConfigSupabase('LOTACAO').catch(() => null),
      ]);
      setPendencias(pends || []);
      if (sla) setSlaConfig(sla);
    } catch (err) {
      setMensagem(`Erro ao carregar: ${err.message}`);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => { carregar(); }, []);

  // SLA em horas do config ou padrÃ£o 24h
  const slaHoras = slaConfig?.prazo_alerta_operacao_h ?? 24;
  const slaEscalonamento = (slaConfig?.prazo_escalonamento_dias ?? 2) * 24;

  // â”€â”€ CÃ¡lculos de cards â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const aguardando = useMemo(() => pendencias.filter((p) => p.status === 'EXCEDEU_AGUARDANDO_OPERACAO'), [pendencias]);
  const aguardandoInfo = useMemo(() => pendencias.filter((p) => p.status === 'AGUARDANDO_INFORMACAO'), [pendencias]);
  const aprovados = useMemo(() => pendencias.filter((p) => p.status === 'APROVADO_OPERACAO'), [pendencias]);
  const recusados = useMemo(() => pendencias.filter((p) => p.status === 'RECUSADO_OPERACAO'), [pendencias]);

  const acimaSla = useMemo(() => aguardando.filter((p) => horasDesde(p.created_at) > slaHoras), [aguardando, slaHoras]);
  const acimaEscalonamento = useMemo(() => aguardando.filter((p) => horasDesde(p.created_at) > slaEscalonamento), [aguardando, slaEscalonamento]);

  const valorPendente = useMemo(() => aguardando.reduce((s, p) => s + valorAdicionalPendencia(p), 0), [aguardando]);
  const valorAprovado = useMemo(() => aprovados.reduce((s, p) => s + valorAdicionalPendencia(p), 0), [aprovados]);
  const valorRecusado = useMemo(() => recusados.reduce((s, p) => s + valorAdicionalPendencia(p), 0), [recusados]);

  // â”€â”€ Filtragem â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const lista = useMemo(() => {
    let l = pendencias;
    if (filtros.status) l = l.filter((p) => p.status === filtros.status);
    if (filtros.transportadora)
      l = l.filter((p) => String(p.transportadora || '').toUpperCase().includes(filtros.transportadora.toUpperCase()));
    return l;
  }, [pendencias, filtros]);

  // â”€â”€ Aprovar/Recusar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const confirmarAprovacao = async (id, novoStatus, comentario) => {
    try {
      const pend = pendencias.find((p) => p.id === id);
      const valorOriginal = valorOriginalPendencia(pend);
      const valorAdicional = novoStatus === 'APROVADO_OPERACAO' ? valorAdicionalPendencia(pend) : 0;
      const valorFinal = valorOriginal + valorAdicional;
      await atualizarPendenciaAuditoriaSupabase(id, novoStatus, {
        aprovado_por_user_id: sessao?.id || '',
        aprovado_por_name: sessao?.nome || sessao?.email || '',
        aprovado_por_email: sessao?.email || '',
        aprovado_em: new Date().toISOString(),
        valor_original: valorOriginal,
        valor_adicional_aprovado: valorAdicional,
        valor_final_autorizado: valorFinal,
        motivo_recusa: novoStatus === 'RECUSADO_OPERACAO' ? comentario : '',
        resposta_operacao: comentario,
        justificativa_operacao: comentario,
      });
      await registrarEventoHistoricoSupabase({
        pendenciaId: id,
        userId: sessao?.id || '',
        userName: sessao?.nome || '',
        userEmail: sessao?.email || '',
        acao: novoStatus,
        statusAnterior: pend?.status || '',
        statusNovo: novoStatus,
        comentario: novoStatus === 'APROVADO_OPERACAO'
          ? `${comentario} | Autorizado: ${fmt(valorOriginal)} + ${fmt(valorAdicional)} = ${fmt(valorFinal)}`
          : comentario,
        origemTela: 'PAINEL_OPERACAO',
      });
      setMensagem(`âœ“ PendÃªncia ${novoStatus === 'APROVADO_OPERACAO' ? 'aprovada' : novoStatus === 'RECUSADO_OPERACAO' ? 'recusada' : 'atualizada'} com sucesso.`);
      setPendenciaSelecionada(null);
      await carregar();
    } catch (err) {
      setMensagem(`Erro: ${err.message}`);
    }
  };

  return (
    <div className="page-shell">
      {/* Alerta SLA no topo */}
      {acimaSla.length > 0 && (
        <div
          style={{
            background: acimaEscalonamento.length > 0 ? '#fff5f5' : '#fff3cd',
            borderLeft: `4px solid ${acimaEscalonamento.length > 0 ? '#9b1111' : '#f0a800'}`,
            padding: '0.75rem 1rem',
            borderRadius: 6,
            marginBottom: '0.75rem',
            fontWeight: 500,
          }}
        >
          {acimaEscalonamento.length > 0
            ? `ðŸ”´ AtenÃ§Ã£o crÃ­tica: ${acimaEscalonamento.length} solicitaÃ§Ãµes aguardam aprovaÃ§Ã£o hÃ¡ mais de ${slaEscalonamento}h. Escalonamento necessÃ¡rio.`
            : `ðŸŸ¡ Existem ${acimaSla.length} solicitaÃ§Ãµes aguardando aprovaÃ§Ã£o hÃ¡ mais de ${slaHoras}h.`}
        </div>
      )}

      <div className="page-header">
        <span className="amd-mini-brand">OperaÃ§Ã£o Â· Painel</span>
        <h1>Painel da OperaÃ§Ã£o</h1>
        <p>AprovaÃ§Ã£o de excedentes enviados pela auditoria. Resposta a solicitaÃ§Ãµes de informaÃ§Ã£o.</p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
        <button className="btn-primary" onClick={carregar} disabled={carregando}>
          {carregando ? 'Atualizando...' : 'â†» Atualizar dados'}
        </button>
      </div>

      {mensagem && <div className="hint-box compact">{mensagem}</div>}

      {/* Cards */}
      <div className="summary-strip" style={{ flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
        <Card label="Aguardando aprovaÃ§Ã£o" valor={aguardando.length} cor="#e67e22" destaque={aguardando.length > 0} />
        <Card label="Aguardando informaÃ§Ã£o" valor={aguardandoInfo.length} cor="#f0a800" />
        <Card label={`Acima de ${slaHoras}h`} valor={acimaSla.length} cor="#e67e22" destaque={acimaSla.length > 0} />
        <Card label={`Acima de ${slaEscalonamento}h`} valor={acimaEscalonamento.length} cor="#9b1111" destaque={acimaEscalonamento.length > 0} />
        <Card label="Valor pendente" valor={fmt(valorPendente)} cor="#9153F0" />
        <Card label="Valor aprovado" valor={fmt(valorAprovado)} cor="#04C7A4" />
        <Card label="Valor recusado" valor={fmt(valorRecusado)} cor="#9b1111" />
      </div>

      {/* Filtros */}
      <div className="panel-card">
        <div className="panel-title" style={{ marginBottom: '0.75rem' }}>Filtros</div>
        <div className="form-grid three">
          <label className="field">
            Status
            <select value={filtros.status} onChange={(e) => setFiltros((p) => ({ ...p, status: e.target.value }))}>
              <option value="">Todos</option>
              <option value="EXCEDEU_AGUARDANDO_OPERACAO">Aguardando aprovaÃ§Ã£o</option>
              <option value="AGUARDANDO_INFORMACAO">Aguardando informaÃ§Ã£o</option>
              <option value="APROVADO_OPERACAO">Aprovados</option>
              <option value="RECUSADO_OPERACAO">Recusados</option>
              <option value="DEVOLVIDO_AUDITORIA">Devolvidos</option>
              <option value="FINALIZADO">Finalizados</option>
            </select>
          </label>
          <label className="field">
            Transportadora
            <input
              value={filtros.transportadora}
              onChange={(e) => setFiltros((p) => ({ ...p, transportadora: e.target.value }))}
              placeholder="Nome da transportadora"
            />
          </label>
        </div>
      </div>

      {/* Tabela de pendÃªncias */}
      <div className="table-card">
        <div className="panel-title" style={{ padding: '0.75rem 1rem 0.25rem' }}>
          PendÃªncias ({lista.length})
        </div>
        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead>
              <tr>
                <th>Data envio</th>
                <th>Auditor</th>
                <th>Transportadora</th>
                <th>DIST</th>
                <th>CT-e</th>
                <th>Fatura</th>
                <th>Original</th>
                <th>Excedente</th>
                <th>Final autorizado</th>
                <th>Tempo</th>
                <th>Justificativa auditoria</th>
                <th>Status</th>
                <th>AÃ§Ã£o</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => {
                const horas = horasDesde(p.created_at);
                const emAtraso = horas > slaHoras;
                const critico = horas > slaEscalonamento;
                return (
                  <tr
                    key={p.id}
                    style={{ background: critico ? '#fff5f5' : emAtraso ? '#fffbf0' : undefined }}
                  >
                    <td>{fmtData(p.created_at)}</td>
                    <td>
                      <span title={p.audited_by_email || ''}>{p.audited_by_name || '-'}</span>
                    </td>
                    <td>{p.transportadora || '-'}</td>
                    <td><strong>{p.dist || '-'}</strong></td>
                    <td>{p.cte || '-'}</td>
                    <td>{p.fatura || '-'}</td>
                    <td>{fmt(valorOriginalPendencia(p))}</td>
                    <td className="negativo">{fmt(valorAdicionalPendencia(p))}</td>
                    <td>{p.status === 'APROVADO_OPERACAO' ? fmt(valorFinalPendencia(p)) : '-'}</td>
                    <td style={{ color: critico ? '#9b1111' : emAtraso ? '#e67e22' : undefined }}>
                      {horas.toFixed(0)}h
                      {critico && ' ðŸ”´'}
                      {!critico && emAtraso && ' ðŸŸ¡'}
                    </td>
                    <td style={{ maxWidth: 200, whiteSpace: 'normal', fontSize: '0.82rem' }}>
                      {p.observation || '-'}
                    </td>
                    <td>
                      <span className="status-pill">{p.status?.replace(/_/g, ' ')}</span>
                    </td>
                    <td>
                      {p.status === 'EXCEDEU_AGUARDANDO_OPERACAO' && (
                        <button
                          className="btn-primary"
                          style={{ padding: '2px 10px', fontSize: '0.8rem' }}
                          onClick={() => setPendenciaSelecionada(p)}
                        >
                          Analisar
                        </button>
                      )}
                      {p.status === 'AGUARDANDO_INFORMACAO' && (
                        <button
                          className="btn-secondary"
                          style={{ padding: '2px 10px', fontSize: '0.8rem' }}
                          onClick={() => setPendenciaSelecionada(p)}
                        >
                          Responder
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!lista.length && !carregando && (
                <tr><td colSpan="13">Nenhuma pendÃªncia encontrada.</td></tr>
              )}
              {carregando && (
                <tr><td colSpan="13">Carregando...</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal aprovaÃ§Ã£o */}
      {pendenciaSelecionada && (
        <ModalAprovacao
          pendencia={pendenciaSelecionada}
          onConfirmar={confirmarAprovacao}
          onCancelar={() => setPendenciaSelecionada(null)}
        />
      )}
    </div>
  );
}
