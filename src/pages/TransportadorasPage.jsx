import React, { useMemo, useRef, useState } from 'react';
import { baixarModelo, buildImportPayload, exportarSecao, parseFileToRows } from '../utils/importacao';

function nextId(list) {
  return (Math.max(0, ...list.map((item) => Number(item.id) || 0)) + 1);
}

function ActionIcon({ children, onClick, danger = false }) {
  return <button className={danger ? 'icon-btn danger' : 'icon-btn'} onClick={onClick}>{children}</button>;
}

function Modal({ open, title, children, onClose }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function TransportadoraModal({ open, initialValue, onSave, onClose }) {
  const [form, setForm] = useState(initialValue || { nome: '', status: 'Ativa', origens: [] });
  React.useEffect(() => setForm(initialValue || { nome: '', status: 'Ativa', origens: [] }), [initialValue, open]);

  return (
    <Modal open={open} title={initialValue?.id ? 'Editar Transportadora' : 'Nova Transportadora'} onClose={onClose}>
      <div className="form-grid">
        <div className="field"><label>Nome</label><input value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} /></div>
        <div className="field"><label>Status</label><select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}><option>Ativa</option><option>Inativa</option></select></div>
      </div>
      <div className="actions-right gap-row top-space"><button className="btn-secondary" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={() => onSave(form)}>Salvar</button></div>
    </Modal>
  );
}

function OrigemModal({ open, initialValue, onSave, onClose }) {
  const baseGeneralidades = { incideIcms: false, aliquotaIcms: 0, adValorem: 0, adValoremMinimo: 0, pedagio: 0, gris: 0, grisMinimo: 0, tas: 0, ctrc: 0, cubagem: 300, tipoCalculo: 'PERCENTUAL', observacoes: '' };
  const [form, setForm] = useState(initialValue || { cidade: '', canal: 'ATACADO', status: 'Ativa', rotas: [], cotacoes: [], taxasEspeciais: [], generalidades: baseGeneralidades });
  React.useEffect(() => setForm(initialValue || { cidade: '', canal: 'ATACADO', status: 'Ativa', rotas: [], cotacoes: [], taxasEspeciais: [], generalidades: baseGeneralidades }), [initialValue, open]);

  return (
    <Modal open={open} title={initialValue?.id ? 'Editar Origem' : 'Nova Origem'} onClose={onClose}>
      <div className="form-grid three">
        <div className="field"><label>Cidade</label><input value={form.cidade} onChange={(e) => setForm((f) => ({ ...f, cidade: e.target.value }))} /></div>
        <div className="field"><label>Canal</label><select value={form.canal} onChange={(e) => setForm((f) => ({ ...f, canal: e.target.value }))}><option>ATACADO</option><option>B2C</option></select></div>
        <div className="field"><label>Status</label><select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}><option>Ativa</option><option>Inativa</option></select></div>
      </div>
      <div className="actions-right gap-row top-space"><button className="btn-secondary" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={() => onSave(form)}>Salvar</button></div>
    </Modal>
  );
}

function LinhaModal({ open, title, fields, initialValue, onSave, onClose }) {
  const [form, setForm] = useState(initialValue || {});
  React.useEffect(() => setForm(initialValue || {}), [initialValue, open]);
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <div className="form-grid three">
        {fields.map((field) => (
          <div className={field.full ? 'field full-span' : 'field'} key={field.name}>
            <label>{field.label}</label>
            {field.type === 'select' ? (
              <select value={form[field.name] ?? ''} onChange={(e) => setForm((prev) => ({ ...prev, [field.name]: e.target.value }))}>
                {(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            ) : (
              <input value={form[field.name] ?? ''} onChange={(e) => setForm((prev) => ({ ...prev, [field.name]: e.target.value }))} />
            )}
          </div>
        ))}
      </div>
      <div className="actions-right gap-row top-space"><button className="btn-secondary" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={() => onSave(form)}>Salvar</button></div>
    </Modal>
  );
}

const DEFAULT_GENERALIDADES = { incideIcms: false, aliquotaIcms: 0, adValorem: 0, adValoremMinimo: 0, pedagio: 0, gris: 0, grisMinimo: 0, tas: 0, ctrc: 0, cubagem: 300, tipoCalculo: 'PERCENTUAL', observacoes: '' };

function GeneralidadesTab({ transportadoraId, origem, store }) {
  const [form, setForm] = useState({ ...DEFAULT_GENERALIDADES, ...(origem.generalidades || {}) });
  React.useEffect(() => setForm({ ...DEFAULT_GENERALIDADES, ...(origem.generalidades || {}) }), [origem]);
  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  return (
    <div className="tab-panel">
      <div className="tab-panel-header"><p>Taxas e generalidades aplicadas a todas as rotas desta origem</p></div>
      <div className="form-grid three generalidades-grid">
        <div className="checkbox-field">
          <label>ICMS</label>
          <div className="checkbox-line"><input type="checkbox" checked={!!form.incideIcms} onChange={(e) => update('incideIcms', e.target.checked)} /> Incide ICMS</div>
        </div>
        {[
          ['aliquotaIcms', 'Alíquota ICMS %'], ['adValorem', 'Ad Valorem (%)'], ['adValoremMinimo', 'Ad Valorem Mínimo (R$)'], ['pedagio', 'Pedágio (R$/100kg)'], ['gris', 'GRIS (%)'], ['grisMinimo', 'GRIS Mínimo (R$)'], ['tas', 'TAS (R$)'], ['ctrc', 'CTRC Emitido (R$)'], ['cubagem', 'Cubagem (kg/m³)'],
        ].map(([key, label]) => <div className="field" key={key}><label>{label}</label><input value={form[key]} onChange={(e) => update(key, e.target.value)} /></div>)}
        <div className="field">
          <label>Tipo de cálculo</label>
          <select value={form.tipoCalculo} onChange={(e) => update('tipoCalculo', e.target.value)}><option value="PERCENTUAL">Percentual</option><option value="FAIXA_DE_PESO">Faixa de Peso</option></select>
          <small>Faixa de Peso soma faixa, excedente e percentual. Percentual usa a regra de maior valor.</small>
        </div>
        <div className="field full-span"><label>Observações</label><input value={form.observacoes} onChange={(e) => update('observacoes', e.target.value)} /></div>
      </div>
      <div className="actions-right top-space"><button className="btn-primary" onClick={() => store.salvarGeneralidades(transportadoraId, origem.id, form)}>Salvar Generalidades</button></div>
    </div>
  );
}

function CrudTab({ title, secao, tipoImportacao, origem, transportadora, store, columns, fields, hint }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const rows = origem[secao] || [];
  const inputRef = useRef(null);

  const save = (form) => {
    const row = { ...editing, ...form, id: editing?.id ?? nextId(rows) };
    store.salvarLinha(transportadora.id, origem.id, secao, row);
    setModalOpen(false);
    setEditing(null);
  };

  const exportRows = rows.map((row) => ({ ...row, transportadora: transportadora.nome, origem: origem.cidade, codigoUnidade: origem.canal === 'B2C' ? '0001 - B2C' : '0001 - B2B' }));

  const importarArquivo = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseFileToRows(file, tipoImportacao);
      const payload = buildImportPayload(parsed, tipoImportacao, { transportadora: transportadora.nome, origem: origem.cidade });
      store.importarPayload(payload, tipoImportacao);
      setFeedback({ type: payload.erros.length ? 'warn' : 'ok', text: `${payload.inseridos} registro(s) importado(s)${payload.erros.length ? ` · ${payload.erros.length} erro(s)` : ''}` });
    } catch (error) {
      setFeedback({ type: 'error', text: error.message || 'Erro ao importar arquivo.' });
    }
    event.target.value = '';
  };

  return (
    <div className="tab-panel">
      <div className="tab-panel-header spaced">
        <p>{rows.length} {title.toLowerCase()} cadastrada(s)</p>
        <div className="toolbar-wrap compact">
          <button className="btn-secondary" onClick={() => exportarSecao(tipoImportacao, exportRows, `${origem.cidade}-${tipoImportacao}.xlsx`)}>Exportar</button>
          <button className="btn-secondary" onClick={() => baixarModelo(tipoImportacao)}>Baixar Modelo</button>
          <button className="btn-secondary" onClick={() => inputRef.current?.click()}>Importar</button>
          <button className="btn-danger" onClick={() => store.limparSecaoOrigem(transportadora.id, origem.id, secao)}>Excluir Tudo</button>
          <button className="btn-primary" onClick={() => { setEditing(null); setModalOpen(true); }}>＋ Novo</button>
          <input hidden ref={inputRef} type="file" accept=".xlsx,.xls,.csv" onChange={importarArquivo} />
        </div>
      </div>
      {hint ? <div className="hint-box">{hint}</div> : null}
      {feedback ? <div className={`mini-feedback ${feedback.type}`}>{feedback.text}</div> : null}
      <div className="table-card">
        <table>
          <thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}<th></th></tr></thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={row.id}>
                {columns.map((c) => <td key={c.key}>{row[c.key] ?? '—'}</td>)}
                <td className="row-actions">
                  <ActionIcon onClick={() => { setEditing(row); setModalOpen(true); }}>✎</ActionIcon>
                  <ActionIcon danger onClick={() => store.removerLinha(transportadora.id, origem.id, secao, row.id)}>🗑</ActionIcon>
                </td>
              </tr>
            )) : <tr><td colSpan={columns.length + 1} className="empty-cell">Nenhum registro cadastrado.</td></tr>}
          </tbody>
        </table>
      </div>
      <LinhaModal open={modalOpen} title={editing ? `Editar ${title}` : `Novo ${title}`} fields={fields} initialValue={editing || fields.reduce((acc, field) => ({ ...acc, [field.name]: field.defaultValue ?? '' }), {})} onSave={save} onClose={() => { setModalOpen(false); setEditing(null); }} />
    </div>
  );
}

function TransportadorasList({ items, onOpen, store }) {
  const [busca, setBusca] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const filtrados = items.filter((item) => item.nome.toLowerCase().includes(busca.toLowerCase()));

  const saveTransportadora = (form) => {
    store.salvarTransportadora({ ...editing, ...form, id: editing?.id ?? nextId(items), origens: editing?.origens ?? [] });
    setModalOpen(false);
    setEditing(null);
  };

  return (
    <div className="page-shell">
      <div className="page-top between start-mobile">
        <div className="page-header slim"><h1>Transportadoras</h1><p>Gerencie as transportadoras e suas configurações de origem</p></div>
        <div className="toolbar-wrap"><button className="btn-secondary" onClick={() => { setEditing(null); setModalOpen(true); }}>＋ Nova Transportadora</button></div>
      </div>
      <input className="search-input" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar transportadora..." />
      <div className="list-stack">
        {filtrados.map((item) => (
          <div key={item.id} className="list-card" onClick={() => onOpen(item.id)}>
            <div className="list-card-left"><div className="list-icon">🏢</div><div><div className="list-title">{item.nome}</div><div className="list-subtitle">{item.origens.length} origem(ns) cadastrada(s)</div></div></div>
            <div className="list-actions" onClick={(e) => e.stopPropagation()}>
              <span className="status-pill dark">{item.status}</span>
              <ActionIcon onClick={() => { setEditing(item); setModalOpen(true); }}>✎</ActionIcon>
              <ActionIcon danger onClick={() => store.removerTransportadora(item.id)}>🗑</ActionIcon>
            </div>
          </div>
        ))}
      </div>
      <TransportadoraModal open={modalOpen} initialValue={editing} onSave={saveTransportadora} onClose={() => { setModalOpen(false); setEditing(null); }} />
    </div>
  );
}

function OrigensList({ transportadora, onBack, onOpenOrigin, store }) {
  const [busca, setBusca] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const origens = transportadora.origens.filter((origem) => origem.cidade.toLowerCase().includes(busca.toLowerCase()));
  const saveOrigem = (form) => {
    const origem = { ...editing, ...form, id: editing?.id ?? nextId(transportadora.origens) };
    store.salvarOrigem(transportadora.id, origem);
    setModalOpen(false);
    setEditing(null);
  };

  return (
    <div className="page-shell">
      <button className="back-link" onClick={onBack}>← Transportadoras</button>
      <div className="page-top between"><div><h1 className="detail-title">{transportadora.nome}</h1><div className="inline-meta"><span className="status-pill dark">{transportadora.status}</span><span>{transportadora.origens.length} origem(ns)</span></div></div><button className="btn-primary" onClick={() => { setEditing(null); setModalOpen(true); }}>＋ Nova Origem</button></div>
      <input className="search-input" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cidade de origem..." />
      <div className="section-row"><div className="inline-meta"><span className="tag-yellow">ATACADO</span><span>{transportadora.origens.length} origem(ns)</span></div></div>
      <div className="list-stack">
        {origens.map((origem) => (
          <div key={origem.id} className="list-card" onClick={() => onOpenOrigin(origem.id)}>
            <div className="list-card-left"><div className="list-icon">📍</div><div><div className="list-title">{origem.cidade} —</div><div className="list-subtitle">{origem.rotas.length} rota(s)</div></div></div>
            <div className="list-actions" onClick={(e) => e.stopPropagation()}>
              <span className="status-pill light">{origem.status}</span>
              <ActionIcon onClick={() => { setEditing(origem); setModalOpen(true); }}>✎</ActionIcon>
              <ActionIcon danger onClick={() => store.removerOrigem(transportadora.id, origem.id)}>🗑</ActionIcon>
            </div>
          </div>
        ))}
      </div>
      <div className="footer-note">{transportadora.origens.length} origem(ns) no total</div>
      <OrigemModal open={modalOpen} initialValue={editing} onSave={saveOrigem} onClose={() => { setModalOpen(false); setEditing(null); }} />
    </div>
  );
}

function TabButton({ active, children, onClick }) {
  return <button className={active ? 'tab-btn active' : 'tab-btn'} onClick={onClick}>{children}</button>;
}

function OrigemDetail({ transportadora, origem, onBack, store }) {
  const [aba, setAba] = useState('generalidades');
  const rotasColumns = [
    { key: 'nomeRota', label: 'Nome da Rota' }, { key: 'ibgeOrigem', label: 'IBGE Origem' }, { key: 'ibgeDestino', label: 'IBGE Destino' }, { key: 'canal', label: 'Canal' }, { key: 'prazoEntregaDias', label: 'Prazo' }, { key: 'valorMinimoFrete', label: 'Mínimo' },
  ];
  const rotasFields = [
    { name: 'nomeRota', label: 'Nome da Rota' }, { name: 'ibgeOrigem', label: 'IBGE Origem' }, { name: 'ibgeDestino', label: 'IBGE Destino' }, { name: 'canal', label: 'Canal', type: 'select', options: ['ATACADO', 'B2C'] }, { name: 'prazoEntregaDias', label: 'Prazo (dias)' }, { name: 'valorMinimoFrete', label: 'Mínimo (R$)' },
  ];
  const cotacoesColumns = [
    { key: 'rota', label: 'Rota' }, { key: 'pesoMin', label: 'Peso Mín (kg)' }, { key: 'pesoMax', label: 'Peso Máx (kg)' }, { key: 'valorFixo', label: 'Taxa Aplicada' }, { key: 'excesso', label: 'Excesso' }, { key: 'percentual', label: '% Frete' }, { key: 'freteMinimo', label: 'Frete Mín.' },
  ];
  const cotacoesFields = [
    { name: 'rota', label: 'Rota' }, { name: 'pesoMin', label: 'Peso Mín (kg)' }, { name: 'pesoMax', label: 'Peso Máx (kg)' }, { name: 'valorFixo', label: 'Taxa Aplicada / Faixa' }, { name: 'excesso', label: 'Excesso por kg' }, { name: 'percentual', label: '% Frete' }, { name: 'freteMinimo', label: 'Frete Mínimo' },
  ];
  const taxasColumns = [
    { key: 'ibgeDestino', label: 'IBGE Destino' }, { key: 'tda', label: 'TDA (R$)' }, { key: 'trt', label: 'TRT (R$)' }, { key: 'suframa', label: 'SUFRAMA (R$)' }, { key: 'outras', label: 'Outras (R$)' }, { key: 'gris', label: 'GRIS (%)' }, { key: 'grisMinimo', label: 'GRIS Mín.' }, { key: 'adVal', label: 'Ad Val (%)' }, { key: 'adValMinimo', label: 'Ad Val Mín.' },
  ];
  const taxasFields = [
    { name: 'ibgeDestino', label: 'IBGE Destino' }, { name: 'tda', label: 'TDA (R$)' }, { name: 'trt', label: 'TRT (R$)' }, { name: 'suframa', label: 'SUFRAMA (R$)' }, { name: 'outras', label: 'Outras (R$)' }, { name: 'gris', label: 'GRIS (%)' }, { name: 'grisMinimo', label: 'GRIS Mínimo (R$)' }, { name: 'adVal', label: 'Ad Valorem (%)' }, { name: 'adValMinimo', label: 'Ad Valorem Mínimo (R$)' },
  ];

  return (
    <div className="page-shell">
      <button className="back-link" onClick={onBack}>← {transportadora.nome}</button>
      <div className="page-top between align-start"><div><h1 className="detail-title">{origem.cidade} —</h1><div className="detail-subtitle">{transportadora.nome} · <strong>{origem.canal}</strong> · {origem.rotas.length} rota(s)</div></div><span className="status-pill dark">{origem.status}</span></div>
      <div className="tabs-row"><TabButton active={aba === 'generalidades'} onClick={() => setAba('generalidades')}>Generalidades</TabButton><TabButton active={aba === 'rotas'} onClick={() => setAba('rotas')}>Rotas</TabButton><TabButton active={aba === 'cotacoes'} onClick={() => setAba('cotacoes')}>Cotações</TabButton><TabButton active={aba === 'taxas'} onClick={() => setAba('taxas')}>Taxas Especiais</TabButton></div>
      {aba === 'generalidades' && <GeneralidadesTab transportadoraId={transportadora.id} origem={origem} store={store} />}
      {aba === 'rotas' && <CrudTab title="Rota" secao="rotas" tipoImportacao="rotas" origem={origem} transportadora={transportadora} store={store} columns={rotasColumns} fields={rotasFields} hint={<>Use <strong>Baixar Modelo</strong> para subir rotas no padrão do seu arquivo real. Também há <strong>Exportar</strong> e <strong>Excluir Tudo</strong>.</>} />}
      {aba === 'cotacoes' && <CrudTab title="Cotação" secao="cotacoes" tipoImportacao="cotacoes" origem={origem} transportadora={transportadora} store={store} columns={cotacoesColumns} fields={cotacoesFields} hint={<>Fretes/cotações aceitam importação no modelo com <strong>Rota do frete</strong>, pesos, excesso, taxa aplicada e percentual.</>} />}
      {aba === 'taxas' && <CrudTab title="Taxa Especial" secao="taxasEspeciais" tipoImportacao="taxas" origem={origem} transportadora={transportadora} store={store} columns={taxasColumns} fields={taxasFields} hint={<>Por IBGE destino, o sistema prioriza <strong>GRIS</strong> e <strong>Ad Valorem</strong> específicos; se estiverem em branco, usa as generalidades da origem.</>} />}
    </div>
  );
}

export default function TransportadorasPage({ transportadoras, transportadoraSelecionadaId, origemSelecionadaId, onOpenTransportadora, onOpenOrigem, onVoltar, store }) {
  const transportadora = useMemo(() => transportadoras.find((item) => item.id === transportadoraSelecionadaId), [transportadoras, transportadoraSelecionadaId]);
  const origem = useMemo(() => transportadora?.origens.find((item) => item.id === origemSelecionadaId), [transportadora, origemSelecionadaId]);

  if (!transportadora) return <TransportadorasList items={transportadoras} onOpen={onOpenTransportadora} store={store} />;
  if (!origem) return <OrigensList transportadora={transportadora} onBack={onVoltar} onOpenOrigin={onOpenOrigem} store={store} />;
  return <OrigemDetail transportadora={transportadora} origem={origem} onBack={onVoltar} store={store} />;
}
