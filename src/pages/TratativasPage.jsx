import { useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  carregarTratativasSupabase,
  salvarTratativaSupabase,
  registrarHistoricoTratativaSupabase,
} from '../services/lotacaoSupabaseService';
import { carregarSessao } from '../utils/authLocal';

const TIPOS = ['FATURA', 'CTE', 'DIST', 'LOTACAO', 'CUSTO_ADICIONAL', 'TRANSPORTADORA', 'SISTEMA', 'OUTRO'];
const PRIORIDADES = ['BAIXA', 'NORMAL', 'ALTA', 'URGENTE'];
const STATUS_LIST = [
  'ABERTO', 'EM_ANALISE', 'AGUARDANDO_OPERACAO', 'AGUARDANDO_TRANSPORTADORA',
  'AGUARDANDO_AUDITORIA', 'CORRIGIDO', 'CANCELADO', 'FINALIZADO',
];

const COR_STATUS = {
  ABERTO: '#f0a800',
  EM_ANALISE: '#9153F0',
  AGUARDANDO_OPERACAO: '#e67e22',
  AGUARDANDO_TRANSPORTADORA: '#e67e22',
  AGUARDANDO_AUDITORIA: '#e67e22',
  CORRIGIDO: '#04C7A4',
  CANCELADO: '#9b1111',
  FINALIZADO: '#2ecc71',
};

function fmtData(v) {
  if (!v) return '-';
  const s = String(v).slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return v;
  return `${d}/${m}/${y}`;
}

function fmt(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n) || n === 0) return '-';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function FormTratativa({ inicial, onSalvar, onCancelar, salvando }) {
  const [form, setForm] = useState(inicial || {
    tipo: 'OUTRO',
    transportadora: '',
    cte: '',
    dist: '',
    fatura: '',
    nf_op: '',
    causa_raiz: '',
    descricao: '',
    impacto_financeiro: '',
    prioridade: 'NORMAL',
    responsavel_nome: '',
    area_responsavel: '',
    prazo: '',
    observacoes: '',
    status: 'ABERTO',
  });

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="panel-card" style={{ marginBottom: '1rem' }}>
      <div className="panel-title">{inicial?.id ? 'Editar tratativa' : 'Nova tratativa'}</div>

      <div className="form-grid three" style={{ marginTop: '0.75rem' }}>
        <label className="field">
          Tipo
          <select value={form.tipo} onChange={(e) => set('tipo', e.target.value)}>
            {TIPOS.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="field">
          Prioridade
          <select value={form.prioridade} onChange={(e) => set('prioridade', e.target.value)}>
            {PRIORIDADES.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
        <label className="field">
          Status
          <select value={form.status} onChange={(e) => set('status', e.target.value)}>
            {STATUS_LIST.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>

        <label className="field">
          Transportadora
          <input value={form.transportadora} onChange={(e) => set('transportadora', e.target.value)} placeholder="Nome da transportadora" />
        </label>
        <label className="field">
          CT-e
          <input value={form.cte} onChange={(e) => set('cte', e.target.value)} placeholder="Chave ou número CT-e" />
        </label>
        <label className="field">
          DIST
          <input value={form.dist} onChange={(e) => set('dist', e.target.value)} placeholder="Código DIST" />
        </label>

        <label className="field">
          Fatura
          <input value={form.fatura} onChange={(e) => set('fatura', e.target.value)} placeholder="Número da fatura" />
        </label>
        <label className="field">
          NF / OP
          <input value={form.nf_op} onChange={(e) => set('nf_op', e.target.value)} placeholder="NF ou número da OP" />
        </label>
        <label className="field">
          Prazo
          <input type="date" value={form.prazo || ''} onChange={(e) => set('prazo', e.target.value)} />
        </label>

        <label className="field">
          Responsável
          <input value={form.responsavel_nome} onChange={(e) => set('responsavel_nome', e.target.value)} placeholder="Nome do responsável" />
        </label>
        <label className="field">
          Área responsável
          <input value={form.area_responsavel} onChange={(e) => set('area_responsavel', e.target.value)} placeholder="Auditoria / Operação / TI..." />
        </label>
        <label className="field">
          Impacto financeiro (R$)
          <input
            type="number"
            step="0.01"
            value={form.impacto_financeiro}
            onChange={(e) => set('impacto_financeiro', e.target.value)}
            placeholder="0,00"
          />
        </label>
      </div>

      <label className="field" style={{ marginTop: '0.5rem' }}>
        Causa raiz
        <textarea
          value={form.causa_raiz}
          onChange={(e) => set('causa_raiz', e.target.value)}
          placeholder="Qual é a causa raiz do problema?"
          style={{ minHeight: 60 }}
        />
      </label>

      <label className="field" style={{ marginTop: '0.5rem' }}>
        Descrição detalhada
        <textarea
          value={form.descricao}
          onChange={(e) => set('descricao', e.target.value)}
          placeholder="Descreva o caso crítico em detalhes..."
          style={{ minHeight: 80 }}
        />
      </label>

      <label className="field" style={{ marginTop: '0.5rem' }}>
        Observações / ações tomadas
        <textarea
          value={form.observacoes}
          onChange={(e) => set('observacoes', e.target.value)}
          placeholder="Registre ações realizadas, contatos feitos, encaminhamentos..."
          style={{ minHeight: 60 }}
        />
      </label>

      <div className="actions-right" style={{ marginTop: '0.75rem' }}>
        <button className="btn-secondary" onClick={onCancelar} disabled={salvando}>Cancelar</button>
        <button
          className="btn-primary"
          disabled={salvando || !form.descricao?.trim()}
          onClick={() => onSalvar(form)}
        >
          {salvando ? 'Salvando...' : 'Salvar tratativa'}
        </button>
      </div>
    </div>
  );
}

export default function TratativasPage() {
  const sessao = carregarSessao();

  const [tratativas, setTratativas] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editando, setEditando] = useState(null);

  const [filtros, setFiltros] = useState({ status: '', tipo: '', responsavel: '' });

  const carregar = async () => {
    setCarregando(true);
    try {
      const result = await carregarTratativasSupabase({
        status: filtros.status || undefined,
        tipo: filtros.tipo || undefined,
      });
      setTratativas(result || []);
    } catch (err) {
      setMensagem(`Erro: ${err.message}`);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => { carregar(); }, []);

  const salvar = async (form) => {
    setSalvando(true);
    setMensagem('');
    try {
      const statusAnterior = editando?.status || '';
      const isNova = !editando?.id;
      const payload = {
        ...form,
        id: editando?.id || uuidv4(),
        impacto_financeiro: Number(form.impacto_financeiro || 0),
        prazo: form.prazo || null,
        data_abertura: editando?.data_abertura || new Date().toISOString(),
        data_conclusao: ['CORRIGIDO', 'FINALIZADO', 'CANCELADO'].includes(form.status)
          ? new Date().toISOString()
          : editando?.data_conclusao || null,
        aberto_por_id: sessao?.id || '',
        aberto_por_nome: sessao?.nome || sessao?.email || '',
        aberto_por_email: sessao?.email || '',
        updated_at: new Date().toISOString(),
      };

      await salvarTratativaSupabase(payload);

      // Histórico
      await registrarHistoricoTratativaSupabase({
        tratativa_id: payload.id,
        data_hora: new Date().toISOString(),
        user_id: sessao?.id || '',
        user_name: sessao?.nome || sessao?.email || '',
        acao: isNova ? 'ABERTO' : 'ATUALIZADO',
        status_anterior: statusAnterior,
        status_novo: form.status,
        comentario: form.observacoes || '',
      });

      setMensagem('✓ Tratativa salva com sucesso.');
      setMostrarForm(false);
      setEditando(null);
      await carregar();
    } catch (err) {
      setMensagem(`Erro ao salvar: ${err.message}`);
    } finally {
      setSalvando(false);
    }
  };

  // Resumos
  const porStatus = STATUS_LIST.map((s) => ({
    status: s,
    total: tratativas.filter((t) => t.status === s).length,
  }));
  const abertos = tratativas.filter((t) => !['CANCELADO', 'FINALIZADO'].includes(t.status)).length;
  const impactoTotal = tratativas
    .filter((t) => !['CANCELADO'].includes(t.status))
    .reduce((s, t) => s + Number(t.impacto_financeiro || 0), 0);

  const lista = tratativas.filter((t) => {
    if (filtros.responsavel && !String(t.responsavel_nome || '').toUpperCase().includes(filtros.responsavel.toUpperCase())) return false;
    return true;
  });

  return (
    <div className="page-shell">
      <div className="page-header">
        <span className="amd-mini-brand">Auditoria · Tratativas</span>
        <h1>Tratativas — Casos Críticos</h1>
        <p>Registro e acompanhamento de casos críticos com causa raiz, responsável, prazo e histórico completo.</p>
      </div>

      {/* Cards resumo */}
      <div className="summary-strip">
        <div className="summary-card">
          <span>Em aberto</span>
          <strong>{abertos}</strong>
          <small>casos ativos</small>
        </div>
        <div className="summary-card">
          <span>Impacto financeiro</span>
          <strong>{impactoTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong>
          <small>casos ativos</small>
        </div>
        {porStatus.filter((s) => s.total > 0).map((s) => (
          <div key={s.status} className="summary-card" style={{ borderLeft: `3px solid ${COR_STATUS[s.status] || '#ccc'}` }}>
            <span>{s.status.replace(/_/g, ' ')}</span>
            <strong>{s.total}</strong>
          </div>
        ))}
      </div>

      {/* Filtros e ação */}
      <div className="panel-card">
        <div className="section-row compact-top">
          <div className="panel-title">Filtros</div>
          <button
            className="btn-primary"
            onClick={() => { setMostrarForm(true); setEditando(null); }}
            disabled={mostrarForm}
          >
            + Nova tratativa
          </button>
        </div>
        <div className="form-grid three" style={{ marginTop: '0.75rem' }}>
          <label className="field">
            Status
            <select value={filtros.status} onChange={(e) => setFiltros((p) => ({ ...p, status: e.target.value }))}>
              <option value="">Todos</option>
              {STATUS_LIST.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label className="field">
            Tipo
            <select value={filtros.tipo} onChange={(e) => setFiltros((p) => ({ ...p, tipo: e.target.value }))}>
              <option value="">Todos</option>
              {TIPOS.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className="field">
            Responsável
            <input
              value={filtros.responsavel}
              onChange={(e) => setFiltros((p) => ({ ...p, responsavel: e.target.value }))}
              placeholder="Nome do responsável"
            />
          </label>
        </div>
        <div className="actions-right" style={{ marginTop: '0.5rem' }}>
          <button className="btn-primary" onClick={carregar} disabled={carregando}>
            {carregando ? 'Carregando...' : 'Atualizar'}
          </button>
        </div>
        {mensagem && <div className="hint-box compact" style={{ marginTop: '0.5rem' }}>{mensagem}</div>}
      </div>

      {/* Formulário */}
      {mostrarForm && (
        <FormTratativa
          inicial={editando}
          salvando={salvando}
          onSalvar={salvar}
          onCancelar={() => { setMostrarForm(false); setEditando(null); }}
        />
      )}

      {/* Tabela */}
      <div className="table-card">
        <div className="panel-title" style={{ padding: '0.75rem 1rem 0.25rem' }}>
          Tratativas ({lista.length})
        </div>
        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead>
              <tr>
                <th>Protocolo</th>
                <th>Tipo</th>
                <th>Transportadora</th>
                <th>Descrição</th>
                <th>Causa raiz</th>
                <th>Impacto</th>
                <th>Prioridade</th>
                <th>Responsável</th>
                <th>Prazo</th>
                <th>Status</th>
                <th>Abertura</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((t) => (
                <tr key={t.id}>
                  <td><strong>{t.protocolo || '-'}</strong></td>
                  <td>{t.tipo}</td>
                  <td>{t.transportadora || '-'}</td>
                  <td style={{ maxWidth: 200, whiteSpace: 'normal', fontSize: '0.82rem' }}>
                    {t.descricao || '-'}
                  </td>
                  <td style={{ maxWidth: 160, whiteSpace: 'normal', fontSize: '0.82rem' }}>
                    {t.causa_raiz || '-'}
                  </td>
                  <td>{fmt(t.impacto_financeiro)}</td>
                  <td>
                    <span style={{ color: t.prioridade === 'URGENTE' ? '#9b1111' : t.prioridade === 'ALTA' ? '#e67e22' : undefined }}>
                      {t.prioridade}
                    </span>
                  </td>
                  <td>{t.responsavel_nome || '-'}</td>
                  <td style={{ color: t.prazo && t.prazo < new Date().toISOString().slice(0, 10) && !['FINALIZADO', 'CANCELADO', 'CORRIGIDO'].includes(t.status) ? '#9b1111' : undefined }}>
                    {fmtData(t.prazo)}
                  </td>
                  <td>
                    <span className="status-pill" style={{ background: COR_STATUS[t.status] || '#ccc', color: '#fff' }}>
                      {t.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td>{fmtData(t.data_abertura)}</td>
                  <td>
                    <button
                      className="btn-secondary"
                      style={{ padding: '2px 8px', fontSize: '0.8rem' }}
                      onClick={() => { setEditando(t); setMostrarForm(true); }}
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
              {!lista.length && !carregando && (
                <tr><td colSpan="12">Nenhuma tratativa encontrada.</td></tr>
              )}
              {carregando && (
                <tr><td colSpan="12">Carregando...</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
