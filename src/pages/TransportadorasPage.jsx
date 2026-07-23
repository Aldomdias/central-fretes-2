import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { analisarCoberturaOrigem, baixarModelo, buildImportPayload, exportarInconsistenciasExcel, exportarSecao, gerarArquivosVerum, parseFileToRows } from '../utils/importacao';
import AmdProcessingOverlay from '../components/AmdProcessingOverlay';
import { carregarVinculosTransportadoras, salvarVinculosTransportadoras, removerVinculoTransportadora, buscarNomesCteSimilares } from '../services/vinculosTransportadorasService';
import { normalizarChave } from '../services/vinculosTransportadorasPuro';
import { listarCarteirasAuditoria, salvarCarteiraAuditoria } from '../services/auditoriaFretesService';

// Carrega vínculos (transportadora_vinculos) e carteiras de auditoria uma vez
// e expõe lookups prontos, pra mostrar/editar isso sem sair da tela de Transportadoras.
function useVinculosEAuditores() {
  const [vinculosRaw, setVinculosRaw] = useState(null);
  const [carteirasRaw, setCarteirasRaw] = useState(null);

  useEffect(() => {
    let ativo = true;
    carregarVinculosTransportadoras()
      .then((lista) => { if (ativo) setVinculosRaw(lista || []); })
      .catch(() => { if (ativo) setVinculosRaw([]); });
    listarCarteirasAuditoria()
      .then((lista) => { if (ativo) setCarteirasRaw(lista || []); })
      .catch(() => { if (ativo) setCarteirasRaw([]); });
    return () => { ativo = false; };
  }, []);

  const vinculosSet = useMemo(() => (
    vinculosRaw ? new Set(vinculosRaw.map((v) => normalizarChave(v.nomeTabela)).filter(Boolean)) : null
  ), [vinculosRaw]);

  const auditoresMap = useMemo(() => {
    if (!carteirasRaw) return null;
    const mapa = new Map();
    carteirasRaw.forEach((c) => {
      const chave = normalizarChave(c.transportadora);
      if (chave && c.auditor_nome) mapa.set(chave, c.auditor_nome);
    });
    return mapa;
  }, [carteirasRaw]);

  const auditorNomes = useMemo(() => (
    [...new Set((carteirasRaw || []).map((c) => c.auditor_nome).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  ), [carteirasRaw]);

  function vinculosDaTransportadora(nome) {
    const chave = normalizarChave(nome);
    return (vinculosRaw || []).filter((v) => normalizarChave(v.nomeTabela) === chave);
  }

  function carteiraDaTransportadora(nome) {
    const chave = normalizarChave(nome);
    return (carteirasRaw || []).find((c) => normalizarChave(c.transportadora) === chave) || null;
  }

  async function recarregarVinculos() {
    const lista = await carregarVinculosTransportadoras();
    setVinculosRaw(lista || []);
    return lista || [];
  }

  async function adicionarVinculo(nomesCte, nomeTabela) {
    const nomeTabelaLimpo = String(nomeTabela || '').trim();
    const lista = Array.isArray(nomesCte) ? nomesCte : [nomesCte];
    const nomesLimpos = [...new Set(lista.map((n) => String(n || '').trim()).filter(Boolean))];
    if (!nomesLimpos.length || !nomeTabelaLimpo) return;
    const novos = nomesLimpos.map((nomeCte) => ({ id: `${Date.now()}-${nomeCte}`, nomeCte, nomeTabela: nomeTabelaLimpo, origem: 'manual' }));
    const proximaLista = [...(vinculosRaw || []), ...novos];
    const resultado = await salvarVinculosTransportadoras(proximaLista);
    setVinculosRaw(resultado.vinculos || proximaLista);
  }

  async function removerVinculo(vinculo) {
    const novaLista = await removerVinculoTransportadora(vinculo.id || vinculo.nomeCte, vinculosRaw || []);
    setVinculosRaw(novaLista);
  }

  async function salvarAuditor(nomeTransportadora, auditorNome) {
    const existente = carteiraDaTransportadora(nomeTransportadora);
    const carteira = {
      id: existente?.id,
      transportadora: nomeTransportadora,
      auditor_nome: auditorNome,
      auditor_email: existente?.auditor_email || '',
    };
    await salvarCarteiraAuditoria({ carteiras: carteirasRaw || [] }, carteira);
    setCarteirasRaw((prev) => {
      const lista = prev || [];
      const idx = lista.findIndex((c) => normalizarChave(c.transportadora) === normalizarChave(nomeTransportadora));
      if (idx === -1) return [...lista, carteira];
      const copia = [...lista];
      copia[idx] = { ...copia[idx], ...carteira };
      return copia;
    });
  }

  return {
    carregando: vinculosRaw === null || carteirasRaw === null,
    vinculosSet,
    auditoresMap,
    auditorNomes,
    vinculosDaTransportadora,
    carteiraDaTransportadora,
    salvarAuditor,
    recarregarVinculos,
    adicionarVinculo,
    removerVinculo,
  };
}

function nextId(list) {
  return (Math.max(0, ...list.map((item) => Number(item.id) || 0)) + 1);
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function uniqueCities(items) {
  return Array.from(new Set(
    items.flatMap((item) => (item.origens || []).map((origem) => origem.cidade).filter(Boolean))
  )).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

const CANAIS_DISPONIVEIS = ['ATACADO', 'B2C'];

function canaisOrigem(origem = {}) {
  const raw = Array.isArray(origem.canal) ? origem.canal.join('+') : String(origem.canal || 'ATACADO');
  if (raw.toUpperCase() === 'AMBOS') return ['ATACADO', 'B2C'];
  return raw.split('+').map((canal) => canal.trim().toUpperCase()).filter(Boolean);
}

function canalOrigemLabel(origem = {}) {
  return canaisOrigem(origem).join(' + ') || 'ATACADO';
}

function canalOrigemValor(canais = []) {
  const lista = [...new Set((canais || []).map((canal) => String(canal || '').trim().toUpperCase()).filter(Boolean))];
  return lista.length ? lista.join('+') : 'ATACADO';
}

function adicionarCanalDisponivel(canal) {
  if (canal && !CANAIS_DISPONIVEIS.includes(canal)) {
    CANAIS_DISPONIVEIS.push(canal);
  }
}

function uniqueCanals(items) {
  return Array.from(new Set(
    items.flatMap((item) => (item.origens || []).flatMap(canaisOrigem))
  )).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function normalizeFiltroStatus(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function pickIbgeFromRecord(record) {
  const value = record?.ibgeDestino ?? record?.ibge_destino ?? record?.Destino ?? record?.destino ?? record?.['IBGE Destino'] ?? record?.ibge;
  return String(value || '').replace(/\D/g, '');
}

function calcularResumoCoberturaDetalhada(transportadora) {
  const origens = transportadora?.origens || [];
  let totalRotas = 0;
  let totalCotacoes = 0;
  let faltandoFrete = 0;
  let faltandoRota = 0;
  let origensPendentes = 0;

  origens.forEach((origem) => {
    const rotas = origem.rotas || [];
    const cotacoes = origem.cotacoes || [];
    totalRotas += rotas.length;
    totalCotacoes += cotacoes.length;

    const rotasSet = new Set(rotas.map(pickIbgeFromRecord).filter(Boolean));
    const cotacoesSet = new Set(cotacoes.map(pickIbgeFromRecord).filter(Boolean));

    const semFreteOrigem = [...rotasSet].filter((ibge) => !cotacoesSet.has(ibge)).length;
    const semRotaOrigem = [...cotacoesSet].filter((ibge) => !rotasSet.has(ibge)).length;

    faltandoFrete += semFreteOrigem;
    faltandoRota += semRotaOrigem;

    if (semFreteOrigem || semRotaOrigem || (!rotas.length && !cotacoes.length)) {
      origensPendentes += 1;
    }
  });

  const inconsistentes = faltandoFrete + faltandoRota;
  const cobertura = inconsistentes ? 'Inconsistente' : origensPendentes ? 'Parcial' : 'Completa';

  return {
    cobertura,
    severidade: cobertura === 'Inconsistente' ? 'error' : cobertura === 'Parcial' ? 'warn' : 'ok',
    inconsistentes,
    pendencias: origensPendentes,
    faltandoFrete,
    faltandoRota,
    totalRotas,
    totalCotacoes,
    resumo: false,
  };
}

function precisaCarregarDetalhes(transportadora) {
  if (!transportadora) return false;
  if (transportadora.detalheCarregado) return false;
  return true;
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

function parseCnpjListaFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const workbook = XLSX.read(event.target?.result, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const linhas = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
        const cnpjs = new Set();
        linhas.forEach((linha) => {
          const chaveCnpj = Object.keys(linha).find((chave) => chave.trim().toLowerCase().replace(/[^a-z]/g, '').includes('cnpj'))
            || Object.keys(linha)[0];
          const digitos = String(linha[chaveCnpj] ?? '').replace(/\D/g, '');
          if (digitos) cnpjs.add(digitos);
        });
        resolve([...cnpjs]);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function baixarModeloCnpjs() {
  const sheet = XLSX.utils.aoa_to_sheet([['CNPJ'], ['12345678000199']]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'CNPJs');
  XLSX.writeFile(workbook, 'modelo-tde-cnpjs.xlsx');
}

function TdeSection({ transportadora, store }) {
  const inputRef = useRef(null);
  const [valor, setValor] = useState(transportadora.tde || 0);
  const [feedback, setFeedback] = useState('');
  const cnpjs = transportadora.tdeCnpjs || [];

  useEffect(() => { setValor(transportadora.tde || 0); }, [transportadora.id, transportadora.tde]);

  function salvarValor() {
    store.atualizarTde(transportadora.id, { tde: Number(valor) || 0 });
    setFeedback('Valor da TDE atualizado. Clique em "Salvar alterações" para enviar ao Supabase.');
  }

  async function importarCnpjs(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const novos = await parseCnpjListaFile(file);
      if (!novos.length) {
        setFeedback('Nenhum CNPJ encontrado no arquivo.');
      } else {
        const combinados = [...new Set([...cnpjs, ...novos])];
        store.atualizarTde(transportadora.id, { tdeCnpjs: combinados });
        setFeedback(`${novos.length} CNPJ(s) lido(s) do arquivo. Lista atual: ${combinados.length} CNPJ(s). Clique em "Salvar alterações" para enviar ao Supabase.`);
      }
    } catch (error) {
      setFeedback(error.message || 'Erro ao importar CNPJs.');
    }
    event.target.value = '';
  }

  function limparCnpjs() {
    if (!window.confirm('Excluir todos os CNPJs cadastrados para a TDE desta transportadora?')) return;
    store.atualizarTde(transportadora.id, { tdeCnpjs: [] });
    setFeedback('Lista de CNPJs limpa. Clique em "Salvar alterações" para enviar ao Supabase.');
  }

  return (
    <div className="form-card" style={{ marginTop: 12, padding: 16, background: '#f8fafc', borderRadius: 8 }}>
      <strong style={{ fontSize: '0.9rem' }}>TDE por CNPJ do destinatário</strong>
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 10px' }}>
        Vale para toda a transportadora (todas as origens). Aplicada no Simulador Realizado e na Auditoria CT-e quando o
        documento (CNPJ) do destinatário do CT-e está na lista abaixo.
      </p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
        <div className="field" style={{ margin: 0 }}>
          <label>TDE (R$)</label>
          <input type="number" step="0.01" style={{ width: 160 }} value={valor} onChange={(e) => setValor(e.target.value)} onBlur={salvarValor} />
        </div>
        <button className="btn-secondary" onClick={() => inputRef.current?.click()}>Importar lista de CNPJs</button>
        <button className="btn-secondary" onClick={baixarModeloCnpjs}>Baixar modelo</button>
        <button className="btn-danger" onClick={limparCnpjs} disabled={!cnpjs.length}>Excluir CNPJs</button>
        <input hidden ref={inputRef} type="file" accept=".xlsx,.xls,.csv" onChange={importarCnpjs} />
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{cnpjs.length} CNPJ(s) cadastrado(s)</span>
      </div>
      {feedback && <div className="mini-feedback info top-space" style={{ marginTop: 8 }}>{feedback}</div>}
    </div>
  );
}

const TAXA_ESP_VAZIA = { ibgeDestino: '', tda: '', trt: '', suframa: '', outras: '', gris: '', grisMinimo: '', adVal: '', adValMinimo: '', taxasExtras: [] };
const CORINGA_VAZIO = { nome: '', valor: '', pct: '', min: '', valorPorPeso: '', pesoBase: '' };

function formatCoringasTaxa(taxasExtras = []) {
  if (!Array.isArray(taxasExtras) || !taxasExtras.length) return '-';
  return taxasExtras.map((te) => {
    const partes = [te.nome || 'coringa'];
    if (Number(te.pct) > 0) partes.push(`${Number(te.pct).toLocaleString('pt-BR')}% NF`);
    if (Number(te.min) > 0) partes.push(`min. ${Number(te.min).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
    if (Number(te.valor) > 0) partes.push(`fixo ${Number(te.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
    if (Number(te.valorPorPeso || te.valor_por_peso) > 0) partes.push(`${Number(te.valorPorPeso || te.valor_por_peso).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/${Number(te.pesoBase || te.peso_base) || '?'} kg`);
    return partes.join(' · ');
  }).join(' | ');
}

function TaxasEspeciaisTab({ origem, transportadora, store }) {
  const [form, setForm] = React.useState(TAXA_ESP_VAZIA);
  const [editando, setEditando] = React.useState(null);
  const [feedback, setFeedback] = React.useState(null);
  const inputRef = React.useRef(null);
  const rows = origem.taxasEspeciais || [];

  function upd(field, val) { setForm((p) => ({ ...p, [field]: val })); }
  function updCoringa(idx, field, val) {
    setForm((p) => {
      const arr = (p.taxasExtras || []).slice();
      arr[idx] = { ...arr[idx], [field]: val };
      return { ...p, taxasExtras: arr };
    });
  }
  function addCoringa() { setForm((p) => ({ ...p, taxasExtras: (p.taxasExtras || []).concat([{ ...CORINGA_VAZIO }]) })); }
  function remCoringa(idx) { setForm((p) => ({ ...p, taxasExtras: (p.taxasExtras || []).filter((_, i) => i !== idx) })); }

  function salvar() {
    if (!form.ibgeDestino) return;
    const taxasExtras = (form.taxasExtras || [])
      .map((te) => ({ nome: String(te.nome || '').trim(), valor: Number(te.valor) || 0, pct: Number(te.pct) || 0, min: Number(te.min) || 0, valorPorPeso: Number(te.valorPorPeso) || 0, pesoBase: Number(te.pesoBase) || 0 }))
      .filter((te) => te.pct > 0 || te.valor > 0 || te.valorPorPeso > 0);
    const row = { ...form, taxasExtras, id: editando?.id ?? ('te-' + Date.now()) };
    store.salvarLinha(transportadora.id, origem.id, 'taxasEspeciais', row);
    setForm(TAXA_ESP_VAZIA); setEditando(null);
  }

  function editar(row) {
    setEditando(row);
    setForm({ ...row, taxasExtras: (row.taxasExtras || []).map((te) => ({ nome: te.nome || '', valor: te.valor || '', pct: te.pct || '', min: te.min || '', valorPorPeso: te.valorPorPeso || te.valor_por_peso || '', pesoBase: te.pesoBase || te.peso_base || '' })) });
  }

  async function importarArquivo(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseFileToRows(file, 'taxas');
      const payload = buildImportPayload(parsed, 'taxas', { transportadora: transportadora.nome, origem: origem.cidade, canal: origem.canal });
      store.importarPayload(payload, 'taxas');
      setFeedback({ type: payload.erros.length ? 'warn' : 'ok', text: `${payload.inseridos} registro(s) importado(s)${payload.erros.length ? ` · ${payload.erros.length} erro(s)` : ''}` });
    } catch (error) {
      setFeedback({ type: 'error', text: error.message || 'Erro ao importar.' });
    }
    event.target.value = '';
  }

  const exportRows = rows.map((row) => ({ ...row, transportadora: transportadora.nome, origem: origem.cidade, codigoUnidade: origem.canal === 'B2C' ? '0001 - B2C' : '0001 - B2B' }));

  const inp = { type: 'number', step: '0.01', style: { width: '100%' } };

  return (
    <div className="tab-panel">
      <div className="hint-box" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span>Por IBGE destino, o sistema prioriza <strong>GRIS</strong> e <strong>Ad Valorem</strong> específicos; se estiverem em branco, usa as generalidades da origem.</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {feedback && <span style={{ fontSize: 12, color: feedback.type === 'ok' ? '#166534' : '#b91c1c' }}>{feedback.text}</span>}
          <button className="btn-secondary" onClick={() => exportarSecao('taxas', exportRows, `${origem.cidade}-taxas.xlsx`)} disabled={!rows.length}>Exportar</button>
          <button className="btn-secondary" onClick={() => baixarModelo('taxas')}>Baixar Modelo</button>
          <button className="btn-secondary" onClick={() => inputRef.current?.click()}>Importar</button>
          <button className="btn-danger" onClick={() => store.limparSecaoOrigem(transportadora.id, origem.id, 'taxasEspeciais')}>Excluir Tudo</button>
          <input hidden ref={inputRef} type="file" accept=".xlsx,.xls,.csv" onChange={importarArquivo} />
        </div>
      </div>
      <div className="table-card" style={{ marginTop: 12 }}>
        <table>
          <thead><tr><th>IBGE</th><th>TDA</th><th>TRT</th><th>SUFRAMA</th><th>Outras</th><th>GRIS%</th><th>GRIS min.</th><th>AdVal%</th><th>AdVal min.</th><th>Coringas</th><th></th></tr></thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={row.id}>
                <td>{row.ibgeDestino || '—'}</td><td>{row.tda || '—'}</td><td>{row.trt || '—'}</td>
                <td>{row.suframa || '—'}</td><td>{row.outras || '—'}</td><td>{row.gris || '—'}</td><td>{row.grisMinimo || '—'}</td><td>{row.adVal || '—'}</td><td>{row.adValMinimo || '—'}</td>
                <td>{formatCoringasTaxa(row.taxasExtras)}</td>
                <td className="row-actions">
                  <ActionIcon onClick={() => editar(row)}>✎</ActionIcon>
                  <ActionIcon danger onClick={() => store.removerLinha(transportadora.id, origem.id, 'taxasEspeciais', row.id)}>🗑</ActionIcon>
                </td>
              </tr>
            )) : <tr><td colSpan={11} className="empty-cell">Nenhuma taxa cadastrada.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="form-card" style={{ marginTop: 16, padding: 16, background: '#f8fafc', borderRadius: 8 }}>
        <strong style={{ fontSize: '0.9rem' }}>{editando ? 'Editando taxa' : 'Nova taxa por destino'}</strong>
        <div className="form-grid three" style={{ marginTop: 10 }}>
          <div className="field"><label>IBGE Destino *</label><input value={form.ibgeDestino} onChange={(e) => upd('ibgeDestino', e.target.value)} placeholder="Ex: 2906907" /></div>
          <div className="field"><label>TDA (R$)</label><input {...inp} value={form.tda} onChange={(e) => upd('tda', e.target.value)} /></div>
          <div className="field"><label>TRT (R$)</label><input {...inp} value={form.trt} onChange={(e) => upd('trt', e.target.value)} /></div>
          <div className="field"><label>SUFRAMA (R$)</label><input {...inp} value={form.suframa} onChange={(e) => upd('suframa', e.target.value)} /></div>
          <div className="field"><label>Outras (R$)</label><input {...inp} value={form.outras} onChange={(e) => upd('outras', e.target.value)} /></div>
          <div className="field"><label>GRIS %</label><input {...inp} step="0.0001" value={form.gris} onChange={(e) => upd('gris', e.target.value)} /></div>
          <div className="field"><label>GRIS Mín (R$)</label><input {...inp} value={form.grisMinimo} onChange={(e) => upd('grisMinimo', e.target.value)} /></div>
          <div className="field"><label>Ad Valorem %</label><input {...inp} step="0.0001" value={form.adVal} onChange={(e) => upd('adVal', e.target.value)} /></div>
          <div className="field"><label>Ad Val Mín (R$)</label><input {...inp} value={form.adValMinimo} onChange={(e) => upd('adValMinimo', e.target.value)} /></div>
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <strong style={{ fontSize: '0.85rem' }}>Taxas coringa</strong>
            <small style={{ color: '#94a3b8' }}>% NF com mínimo, ou valor R$ fixo</small>
            <button type="button" className="btn-secondary" style={{ marginLeft: 'auto', fontSize: '0.78rem', padding: '2px 10px' }} onClick={addCoringa}>+ Adicionar coringa</button>
          </div>
          {(form.taxasExtras || []).map((te, idx) => (
            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr auto', gap: 8, marginBottom: 6, alignItems: 'end' }}>
              <div className="field" style={{ margin: 0 }}><label>Nome</label><input value={te.nome} onChange={(e) => updCoringa(idx, 'nome', e.target.value)} placeholder="Ex: EMEX" /></div>
              <div className="field" style={{ margin: 0 }}><label>% NF</label><input type="number" step="0.0001" value={te.pct} onChange={(e) => updCoringa(idx, 'pct', e.target.value)} /></div>
              <div className="field" style={{ margin: 0 }}><label>Mín (R$)</label><input type="number" step="0.01" value={te.min} onChange={(e) => updCoringa(idx, 'min', e.target.value)} /></div>
              <div className="field" style={{ margin: 0 }}><label>R$ fixo</label><input type="number" step="0.01" value={te.valor} onChange={(e) => updCoringa(idx, 'valor', e.target.value)} /></div>
              <div className="field" style={{ margin: 0 }}><label>R$ por peso</label><input type="number" step="0.01" value={te.valorPorPeso} onChange={(e) => updCoringa(idx, 'valorPorPeso', e.target.value)} placeholder="Ex: 8,50" /></div>
              <div className="field" style={{ margin: 0 }}><label>Base kg</label><input type="number" step="0.001" value={te.pesoBase} onChange={(e) => updCoringa(idx, 'pesoBase', e.target.value)} placeholder="100" /></div>
              <button type="button" style={{ background: 'none', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 4, padding: '0 8px', cursor: 'pointer', height: 30, alignSelf: 'end' }} onClick={() => remCoringa(idx)}>✕</button>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button className="btn-primary" onClick={salvar} disabled={!form.ibgeDestino}>{editando ? 'Atualizar taxa' : 'Adicionar taxa'}</button>
          {!form.ibgeDestino && <small style={{ alignSelf: 'center', color: '#b45309' }}>Informe o IBGE do destino para incluir esta taxa.</small>}
          {editando && <button className="btn-secondary" onClick={() => { setEditando(null); setForm(TAXA_ESP_VAZIA); }}>Cancelar</button>}
        </div>
      </div>
    </div>
  );
}

function OrigemModal({ open, initialValue, onSave, onClose }) {
  const baseGeneralidades = { incideIcms: false, aliquotaIcms: 0, adValorem: 0, adValoremMinimo: 0, pedagio: 0, gris: 0, grisMinimo: 0, tas: 0, ctrc: 0, cubagem: 300, tipoCalculo: 'PERCENTUAL', observacoes: '' };
  const [form, setForm] = useState(initialValue || { cidade: '', canal: 'ATACADO', status: 'Ativa', rotas: [], cotacoes: [], taxasEspeciais: [], generalidades: baseGeneralidades });
  React.useEffect(() => setForm(initialValue || { cidade: '', canal: 'ATACADO', status: 'Ativa', rotas: [], cotacoes: [], taxasEspeciais: [], generalidades: baseGeneralidades }), [initialValue, open]);
  const selecionados = canaisOrigem(form);
  const toggleCanal = (canal) => {
    const next = selecionados.includes(canal)
      ? selecionados.filter((item) => item !== canal)
      : [...selecionados, canal];
    setForm((f) => ({ ...f, canal: canalOrigemValor(next) }));
  };

  return (
    <Modal open={open} title={initialValue?.id ? 'Editar Origem' : 'Nova Origem'} onClose={onClose}>
      <div className="form-grid three">
        <div className="field"><label>Cidade</label><input value={form.cidade} onChange={(e) => setForm((f) => ({ ...f, cidade: e.target.value }))} /></div>
        <div className="field"><label>Canais</label><div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{CANAIS_DISPONIVEIS.map((canal) => <label key={canal} style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}><input type="checkbox" checked={selecionados.includes(canal)} onChange={() => toggleCanal(canal)} />{canal}</label>)}</div></div>
        <div className="field"><label>Status</label><select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}><option>Ativa</option><option>Inativa</option></select></div>
      </div>
      <div className="actions-right gap-row top-space"><button className="btn-secondary" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={() => onSave({ ...form, canal: canalOrigemValor(selecionados) })} disabled={!selecionados.length}>Salvar</button></div>
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

const DEFAULT_GENERALIDADES = { incideIcms: false, aliquotaIcms: 0, adValorem: 0, adValoremMinimo: 0, pedagio: 0, gris: 0, grisMinimo: 0, tas: 0, ctrc: 0, cubagem: 300, tipoCalculo: 'PERCENTUAL', observacoes: '', taxaEmergencial: 0 };

function CoberturaBadge({ cobertura, severidade }) {
  const className = severidade === 'error'
    ? 'coverage-badge error'
    : severidade === 'warn'
      ? 'coverage-badge warn'
      : 'coverage-badge ok';
  return <span className={className}>{cobertura}</span>;
}

function PainelValidacaoModal({ open, items, onClose, onOpenTransportadora, vinculosSet, auditoresMap }) {
  const [busca, setBusca] = useState('');
  const [somentePendentes, setSomentePendentes] = useState(false);
  const [somenteSemVinculo, setSomenteSemVinculo] = useState(false);
  const [somenteSemAuditor, setSomenteSemAuditor] = useState(false);

  const linhas = useMemo(() => {
    return items
      .map((item) => {
        const origens = item.origens || [];
        const total = origens.length;
        const validadas = origens.filter((o) => o.validado).length;
        const pendentes = total - validadas;
        const ultimaValidacao = origens
          .filter((o) => o.validado && o.validado_em)
          .sort((a, b) => new Date(b.validado_em) - new Date(a.validado_em))[0] || null;
        const chave = normalizarChave(item.nome);
        const comVinculo = vinculosSet ? vinculosSet.has(chave) : null;
        const auditor = auditoresMap ? (auditoresMap.get(chave) || null) : null;
        return { id: item.id, nome: item.nome, total, validadas, pendentes, ultimaValidacao, comVinculo, auditor };
      })
      .filter((linha) => !busca || normalizeText(linha.nome).includes(normalizeText(busca)))
      .filter((linha) => !somentePendentes || linha.pendentes > 0)
      .filter((linha) => !somenteSemVinculo || linha.comVinculo === false)
      .filter((linha) => !somenteSemAuditor || !linha.auditor)
      .sort((a, b) => b.pendentes - a.pendentes || a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [items, busca, somentePendentes, somenteSemVinculo, somenteSemAuditor, vinculosSet, auditoresMap]);

  const totalOrigens = linhas.reduce((acc, l) => acc + l.total, 0);
  const totalValidadas = linhas.reduce((acc, l) => acc + l.validadas, 0);

  if (!open) return null;
  return (
    <Modal open={open} title="Painel de validação de tabelas" onClose={onClose}>
      <p style={{ marginTop: -8, color: '#64748b' }}>
        {totalValidadas} de {totalOrigens} origem(ns) validada(s) no total ({linhas.filter((l) => l.pendentes === 0 && l.total > 0).length} transportadora(s) 100% validada(s)).
      </p>
      <div className="form-grid two top-space">
        <div className="field">
          <label>Buscar transportadora</label>
          <input className="search-input" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Digite o nome..." />
        </div>
        <div className="field" style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
            <input type="checkbox" checked={somentePendentes} onChange={(e) => setSomentePendentes(e.target.checked)} />
            Só com pendências
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
            <input type="checkbox" checked={somenteSemVinculo} onChange={(e) => setSomenteSemVinculo(e.target.checked)} />
            Só sem vínculo
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
            <input type="checkbox" checked={somenteSemAuditor} onChange={(e) => setSomenteSemAuditor(e.target.checked)} />
            Só sem auditor
          </label>
        </div>
      </div>
      <div className="table-card top-space" style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table>
          <thead><tr><th>Transportadora</th><th>Validadas</th><th>Pendentes</th><th>Última validação</th><th>Vínculo</th><th>Auditor</th><th>Progresso</th><th></th></tr></thead>
          <tbody>
            {linhas.length ? linhas.map((linha) => (
              <tr key={linha.id}>
                <td>{linha.nome}</td>
                <td>{linha.validadas} / {linha.total}</td>
                <td>{linha.pendentes ? <span style={{ color: '#b45309', fontWeight: 700 }}>{linha.pendentes}</span> : <span style={{ color: '#166534' }}>0</span>}</td>
                <td style={{ fontSize: 12, color: '#64748b' }}>
                  {linha.ultimaValidacao
                    ? <>{linha.ultimaValidacao.validado_por || 'Não identificado'}<br />{new Date(linha.ultimaValidacao.validado_em).toLocaleDateString('pt-BR')}</>
                    : '—'}
                </td>
                <td>
                  {linha.comVinculo === null ? '—' : linha.comVinculo
                    ? <span style={{ color: '#166534', fontWeight: 700 }}>🔗 Sim</span>
                    : <span style={{ color: '#b91c1c', fontWeight: 700 }}>⚠ Não</span>}
                </td>
                <td style={{ fontSize: 12 }}>{linha.auditor || <span style={{ color: '#94a3b8' }}>Sem auditor</span>}</td>
                <td style={{ minWidth: 120 }}>
                  <div style={{ background: '#f1f5f9', borderRadius: 999, height: 8, overflow: 'hidden' }}>
                    <div style={{
                      width: `${linha.total ? Math.round((linha.validadas / linha.total) * 100) : 0}%`,
                      background: linha.pendentes ? '#f59e0b' : '#16a34a',
                      height: '100%',
                    }} />
                  </div>
                </td>
                <td>
                  <button className="btn-link inline-btn" onClick={() => { onOpenTransportadora(linha.id); onClose(); }}>Abrir</button>
                </td>
              </tr>
            )) : <tr><td colSpan={8} className="empty-cell">Nenhuma transportadora encontrada.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="actions-right gap-row top-space"><button className="btn-secondary" onClick={onClose}>Fechar</button></div>
    </Modal>
  );
}

function mapInconsistenciasRotas(transportadora, origem, analise) {
  return (analise.rotasSemCotacao || []).map((rotaNome) => ({
    Transportadora: transportadora.nome,
    Origem: origem.cidade,
    Canal: origem.canal,
    'Rota sem frete': rotaNome,
  }));
}

function mapInconsistenciasFretes(transportadora, origem, analise) {
  return (analise.cotacoesSemRota || []).map((freteNome) => ({
    Transportadora: transportadora.nome,
    Origem: origem.cidade,
    Canal: origem.canal,
    'Frete sem rota': freteNome,
  }));
}

function InconsistenciasModal({ open, title, transportadora, origem = null, onClose }) {
  if (!open) return null;

  const origens = origem ? [origem] : (transportadora?.origens || []);
  const rotasSemFrete = [];
  const fretesSemRota = [];

  origens.forEach((origemItem) => {
    const analise = analisarCoberturaOrigem(origemItem);
    rotasSemFrete.push(...mapInconsistenciasRotas(transportadora, origemItem, analise));
    fretesSemRota.push(...mapInconsistenciasFretes(transportadora, origemItem, analise));
  });

  const exportar = () => {
    const nomeBase = origem
      ? `${transportadora.nome}-${origem.cidade}-inconsistencias`
      : `${transportadora.nome}-inconsistencias`;
    exportarInconsistenciasExcel({ titulo: nomeBase, rotasSemFrete, fretesSemRota });
  };

  return (
    <Modal open={open} title={title} onClose={onClose}>
      <div className="inconsistencias-modal">
        <div className="inconsistencias-toolbar">
          <div className="inline-meta">
            <strong>{rotasSemFrete.length}</strong><span>rota(s) sem frete</span>
            <strong>{fretesSemRota.length}</strong><span>frete(s) sem rota</span>
          </div>
          <button className="btn-secondary" onClick={exportar}>Exportar Excel</button>
        </div>
        <div className="inconsistencias-grid">
          <div className="table-card">
            <div className="inconsistencia-title">Rotas sem frete</div>
            <table>
              <thead><tr><th>Transportadora</th><th>Origem</th><th>Canal</th><th>Rota</th></tr></thead>
              <tbody>
                {rotasSemFrete.length ? rotasSemFrete.map((item, index) => (
                  <tr key={`rsf-${index}`}><td>{item.Transportadora}</td><td>{item.Origem}</td><td>{item.Canal}</td><td>{item['Rota sem frete']}</td></tr>
                )) : <tr><td colSpan={4}>Nenhuma rota sem frete encontrada.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="table-card">
            <div className="inconsistencia-title">Fretes sem rota</div>
            <table>
              <thead><tr><th>Transportadora</th><th>Origem</th><th>Canal</th><th>Frete</th></tr></thead>
              <tbody>
                {fretesSemRota.length ? fretesSemRota.map((item, index) => (
                  <tr key={`fsr-${index}`}><td>{item.Transportadora}</td><td>{item.Origem}</td><td>{item.Canal}</td><td>{item['Frete sem rota']}</td></tr>
                )) : <tr><td colSpan={4}>Nenhum frete sem rota encontrado.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function buildResumoTransportadora(transportadora) {
  if (transportadora?.detalheCarregado) {
    return calcularResumoCoberturaDetalhada(transportadora);
  }

  if (transportadora?.resumoCobertura) {
    return transportadora.resumoCobertura;
  }

  return {
    cobertura: 'Sem validação',
    severidade: 'warn',
    inconsistentes: 0,
    pendencias: 0,
    faltandoFrete: 0,
    faltandoRota: 0,
    totalRotas: 0,
    totalCotacoes: 0,
    resumo: true,
  };
}

function GeneralidadesTab({ transportadoraId, origem, store }) {
  const [form, setForm] = useState({ ...DEFAULT_GENERALIDADES, ...(origem.generalidades || {}) });
  const [feedback, setFeedback] = useState('');
  React.useEffect(() => setForm({ ...DEFAULT_GENERALIDADES, ...(origem.generalidades || {}) }), [origem]);
  const update = (field, value) => { setForm((prev) => ({ ...prev, [field]: value })); setFeedback(''); };

  const salvar = () => {
    try {
      store.salvarGeneralidades(transportadoraId, origem.id, form);
      setFeedback('ok');
    } catch (e) {
      setFeedback(`erro:${e?.message || 'Erro ao salvar generalidades.'}`);
    }
  };

  return (
    <div className="tab-panel">
      <div className="tab-panel-header"><p>Taxas e generalidades aplicadas a todas as rotas desta origem</p></div>
      <div className="form-grid three generalidades-grid">
        <div className="checkbox-field">
          <label>ICMS</label>
          <div className="checkbox-line"><input type="checkbox" checked={!!form.incideIcms} onChange={(e) => update('incideIcms', e.target.checked)} /> Incide ICMS</div>
        </div>
        {[
          ['aliquotaIcms', 'Alíquota ICMS %'], ['adValorem', 'Ad Valorem (%)'], ['adValoremMinimo', 'Ad Valorem Mínimo (R$)'], ['pedagio', 'Pedágio (R$/100kg)'], ['gris', 'GRIS (%)'], ['grisMinimo', 'GRIS Mínimo (R$)'], ['tas', 'TAS (R$)'], ['ctrc', 'CTRC Emitido (R$)'], ['cubagem', 'Cubagem (kg/m³)'], ['taxaEmergencial', 'Taxa Emergencial (%)'],
        ].map(([key, label]) => <div className="field" key={key}><label>{label}</label><input value={form[key]} onChange={(e) => update(key, e.target.value)} /></div>)}
        <div className="field">
          <label>Tipo de cálculo</label>
          <select value={form.tipoCalculo} onChange={(e) => update('tipoCalculo', e.target.value)}><option value="PERCENTUAL">Percentual</option><option value="FAIXA_DE_PESO">Faixa de Peso</option></select>
          <small>Faixa de Peso soma faixa, excedente e percentual. Percentual usa a regra de maior valor.</small>
        </div>
        <div className="field full-span"><label>Observações</label><input value={form.observacoes} onChange={(e) => update('observacoes', e.target.value)} /></div>
      </div>
      <div className="actions-right top-space" style={{ alignItems: 'center', gap: 12 }}>
        {feedback === 'ok' ? <span style={{ color: '#166534', fontWeight: 600, fontSize: 13 }}>✓ Generalidades salvas. Clique em “Salvar alterações” no topo para gravar no Supabase.</span> : null}
        {feedback.startsWith('erro:') ? <span style={{ color: '#b91c1c', fontWeight: 600, fontSize: 13 }}>{feedback.slice(5)}</span> : null}
        <button className="btn-primary" onClick={salvar}>Salvar Generalidades</button>
      </div>
    </div>
  );
}

function CrudTab({ title, secao, tipoImportacao, origem, transportadora, store, columns, fields, hint }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [inconsistenciasOpen, setInconsistenciasOpen] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [feedbackSalvar, setFeedbackSalvar] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [reajustePanelOpen, setReajustePanelOpen] = useState(false);
  const [reajustePercentuais, setReajustePercentuais] = useState({});
  const [aplicandoReajuste, setAplicandoReajuste] = useState(false);
  const rows = origem[secao] || [];
  const inputRef = useRef(null);
  const [filtroTexto, setFiltroTexto] = useState('');

  const rowsFiltradas = useMemo(() => {
    const termo = normalizeText(filtroTexto);
    if (!termo) return rows;
    return rows.filter((row) => columns.some((c) => normalizeText(row[c.key]).includes(termo)));
  }, [rows, filtroTexto, columns]);

  const colunasReajustaveis = columns.filter((c) => c.key !== 'rota');

  const aplicarReajusteEmMassa = () => {
    const ajustes = Object.entries(reajustePercentuais).filter(([, v]) => Number(v));
    if (!ajustes.length) {
      setFeedback({ type: 'warn', text: 'Informe ao menos um percentual para reajustar.' });
      return;
    }
    if (!rows.length) return;

    const resumoAjustes = ajustes.map(([campo, pct]) => {
      const label = colunasReajustaveis.find((c) => c.key === campo)?.label || campo;
      const sinal = Number(pct) > 0 ? '+' : '';
      return `${label}: ${sinal}${pct}%`;
    }).join(', ');
    const ok = window.confirm(`Aplicar reajuste em ${rows.length} registro(s) de ${title.toLowerCase()}?\n\n${resumoAjustes}\n\nEssa ação sobrescreve os valores atuais.`);
    if (!ok) return;

    setAplicandoReajuste(true);
    try {
      store.reajustarSecaoOrigem(transportadora.id, origem.id, secao, Object.fromEntries(ajustes));
      setFeedback({ type: 'ok', text: `Reajuste aplicado em ${rows.length} registro(s).` });
      setReajustePercentuais({});
      setReajustePanelOpen(false);
    } finally {
      setAplicandoReajuste(false);
    }
  };

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
      const payload = buildImportPayload(parsed, tipoImportacao, { transportadora: transportadora.nome, origem: origem.cidade, canal: origem.canal });
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
          <button className="btn-secondary" onClick={() => setReajustePanelOpen((v) => !v)} disabled={!rows.length}>
            {reajustePanelOpen ? 'Fechar reajuste' : 'Reajustar em massa'}
          </button>
          <button className="btn-danger" onClick={() => store.limparSecaoOrigem(transportadora.id, origem.id, secao)}>Excluir Tudo</button>
          <button className="btn-primary" onClick={() => { setEditing(null); setModalOpen(true); }}>＋ Novo</button>
          <input hidden ref={inputRef} type="file" accept=".xlsx,.xls,.csv" onChange={importarArquivo} />
        </div>
      </div>
      {hint ? <div className="hint-box">{hint}</div> : null}
      {feedback ? <div className={`mini-feedback ${feedback.type}`}>{feedback.text}</div> : null}
      <input
        type="text"
        value={filtroTexto}
        onChange={(e) => setFiltroTexto(e.target.value)}
        placeholder={`Filtrar ${title.toLowerCase()} (rota, cidade, IBGE, UF...)`}
        style={{ width: '100%', maxWidth: 420, marginBottom: 10 }}
      />
      {filtroTexto ? <p className="compact">{rowsFiltradas.length} de {rows.length} {title.toLowerCase()} encontrada(s)</p> : null}
      {reajustePanelOpen ? (
        <div className="hint-box" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
          {colunasReajustaveis.map((c) => (
            <label key={c.key} style={{ display: 'flex', flexDirection: 'column', fontSize: 12, fontWeight: 600, gap: 4 }}>
              {c.label} (%)
              <input
                type="number"
                step="0.1"
                placeholder="0"
                value={reajustePercentuais[c.key] ?? ''}
                onChange={(e) => setReajustePercentuais((prev) => ({ ...prev, [c.key]: e.target.value }))}
                style={{ width: 90 }}
              />
            </label>
          ))}
          <button className="btn-primary" onClick={aplicarReajusteEmMassa} disabled={aplicandoReajuste}>
            {aplicandoReajuste ? 'Aplicando...' : `Aplicar em ${rows.length} registro(s)`}
          </button>
          <span style={{ fontSize: 12, color: '#64748b', width: '100%' }}>
            Positivo aumenta, negativo reduz (ex.: 5 = +5%, -3 = -3%). Deixe em branco a coluna que não quer mexer.
          </span>
        </div>
      ) : null}
      <div className="table-card">
        <table>
          <thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}<th></th></tr></thead>
          <tbody>
            {rowsFiltradas.length ? rowsFiltradas.map((row) => (
              <tr key={row.id}>
                {columns.map((c) => <td key={c.key}>{row[c.key] ?? '—'}</td>)}
                <td className="row-actions">
                  <ActionIcon onClick={() => { setEditing(row); setModalOpen(true); }}>✎</ActionIcon>
                  <ActionIcon danger onClick={() => store.removerLinha(transportadora.id, origem.id, secao, row.id)}>🗑</ActionIcon>
                </td>
              </tr>
            )) : <tr><td colSpan={columns.length + 1} className="empty-cell">{filtroTexto ? 'Nenhum registro encontrado para o filtro.' : 'Nenhum registro cadastrado.'}</td></tr>}
          </tbody>
        </table>
      </div>
      <LinhaModal open={modalOpen} title={editing ? `Editar ${title}` : `Novo ${title}`} fields={fields} initialValue={editing || fields.reduce((acc, field) => ({ ...acc, [field.name]: field.defaultValue ?? '' }), {})} onSave={save} onClose={() => { setModalOpen(false); setEditing(null); }} />
    </div>
  );
}

function TransportadorasList({ items, onOpen, store }) {
  const [busca, setBusca] = useState('');
  const [cidadeFiltro, setCidadeFiltro] = useState('');
  const [canalFiltro, setCanalFiltro] = useState('');
  const [coberturaFiltro, setCoberturaFiltro] = useState('');
  const [validacaoFiltro, setValidacaoFiltro] = useState('');
  const [painelValidacaoOpen, setPainelValidacaoOpen] = useState(false);
  const { vinculosSet, auditoresMap } = useVinculosEAuditores();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [pagina, setPagina] = useState(1);
  const [autoAtualizando, setAutoAtualizando] = useState(false);
  const [atualizandoResumo, setAtualizandoResumo] = useState(false);
  const refreshInicialRef = useRef(false);
  const PAGE_SIZE = 20;
  const cidades = useMemo(() => uniqueCities(items), [items]);
  const canais = useMemo(() => uniqueCanals(items), [items]);

  const filtrados = useMemo(() => {
    const termoBusca = normalizeText(busca);
    const cidadeNormalizada = normalizeText(cidadeFiltro);
    const canalNormalizado = normalizeText(canalFiltro);
    const coberturaNormalizada = normalizeFiltroStatus(coberturaFiltro);

    return items.filter((item) => {
      const resumo = buildResumoTransportadora(item);
      const nomeMatch = !termoBusca || normalizeText(item.nome).includes(termoBusca);
      const cidadeMatch = !cidadeNormalizada || (item.origens || []).some((origem) => normalizeText(origem.cidade) === cidadeNormalizada);
      const canalMatch = !canalNormalizado || (item.origens || []).some((origem) => canaisOrigem(origem).some((canal) => normalizeText(canal) === canalNormalizado));
      const coberturaMatch = !coberturaNormalizada || normalizeFiltroStatus(resumo.cobertura) === coberturaNormalizada;
      const validacaoMatch = !validacaoFiltro || (item.origens || []).some((origem) => (
        validacaoFiltro === 'validadas' ? Boolean(origem.validado) : !origem.validado
      ));
      return nomeMatch && cidadeMatch && canalMatch && coberturaMatch && validacaoMatch;
    });
  }, [items, busca, cidadeFiltro, canalFiltro, coberturaFiltro, validacaoFiltro]);

  const totalOrigens = useMemo(() => items.reduce((acc, item) => acc + (item.origens || []).length, 0), [items]);
  const totalOrigensValidadas = useMemo(
    () => items.reduce((acc, item) => acc + (item.origens || []).filter((origem) => origem.validado).length, 0),
    [items]
  );

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const inicioPagina = (paginaAtual - 1) * PAGE_SIZE;
  const visiveis = filtrados.slice(inicioPagina, inicioPagina + PAGE_SIZE);

  useEffect(() => {
    setPagina(1);
  }, [busca, cidadeFiltro, canalFiltro, coberturaFiltro, validacaoFiltro]);

  const atualizarBaseOficial = async () => {
    if (!store?.atualizarResumo || atualizandoResumo) return false;
    setAtualizandoResumo(true);
    const ok = await store.atualizarResumo();
    setAtualizandoResumo(false);
    return ok;
  };

  useEffect(() => {
    if (refreshInicialRef.current) return;
    if (!store?.atualizarResumo || store?.syncStatus?.rascunhoLocal) return;
    refreshInicialRef.current = true;
    atualizarBaseOficial();
  }, [store]);

  useEffect(() => {
    // Não carrega automaticamente para evitar sobrescrever campos enquanto o usuário edita.
    setAutoAtualizando(false);
  }, [visiveis]);

  const saveTransportadora = (form) => {
    store.salvarTransportadora({ ...editing, ...form, id: editing?.id ?? nextId(items), origens: editing?.origens ?? [] });
    setModalOpen(false);
    setEditing(null);
  };

  const limparFiltros = () => {
    setBusca('');
    setCidadeFiltro('');
    setCanalFiltro('');
    setCoberturaFiltro('');
    setValidacaoFiltro('');
  };

  const confirmarRemocaoTransportadora = (item) => {
    const ok = window.confirm(`Tem certeza que deseja excluir a transportadora ${item?.nome || ''}? Essa ação remove o cadastro da base principal.`);
    if (!ok) return;
    store.removerTransportadora(item.id);
  };

  return (
    <div className="page-shell">
      <div className="page-top between start-mobile">
        <div className="page-header slim"><h1>Transportadoras</h1><p>Gerencie as transportadoras e suas configurações de origem</p></div>
        <div className="toolbar-wrap">
          {autoAtualizando ? <span className="status-pill">Atualizando visíveis...</span> : null}
          {atualizandoResumo || store?.syncStatus?.carregando ? <span className="status-pill">Atualizando base oficial...</span> : null}
          <button className="btn-secondary" onClick={atualizarBaseOficial} disabled={atualizandoResumo || store?.syncStatus?.carregando}>
            {atualizandoResumo || store?.syncStatus?.carregando ? 'Atualizando...' : 'Atualizar base oficial'}
          </button>
          <button className="btn-secondary" onClick={() => {
            visiveis.forEach((item) => store?.carregarTransportadoraCompleta?.(item.id));
          }}>Atualizar visíveis</button>
          <button className="btn-secondary" onClick={() => setPainelValidacaoOpen(true)}>📊 Painel de validação</button>
          <button className="btn-secondary" onClick={() => { setEditing(null); setModalOpen(true); }}>＋ Nova Transportadora</button>
        </div>
      </div>

      <div className="table-card filters-card">
        <div className="filters-header">
          <div>
            <strong>Filtros</strong>
            <p>Filtre por transportadora, cidade de origem, canal e status de cobertura.</p>
          </div>
          <div className="inline-meta">
            <span><strong>{filtrados.length}</strong> transportadora(s)</span>
            <span>Mostrando {visiveis.length ? inicioPagina + 1 : 0}-{Math.min(inicioPagina + PAGE_SIZE, filtrados.length)} de {filtrados.length}</span>
            <span><strong>{totalOrigensValidadas}</strong> de <strong>{totalOrigens}</strong> origem(ns) validada(s)</span>
            {(busca || cidadeFiltro || canalFiltro || coberturaFiltro || validacaoFiltro) ? <button className="btn-link inline-btn" onClick={limparFiltros}>Limpar filtros</button> : null}
          </div>
        </div>
        <div className="form-grid four filters-grid">
          <div className="field">
            <label>Buscar transportadora</label>
            <input className="search-input search-input-full" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Digite o nome da transportadora..." />
          </div>
          <div className="field">
            <label>Cidade de origem</label>
            <select value={cidadeFiltro} onChange={(e) => setCidadeFiltro(e.target.value)}>
              <option value="">Todas as cidades</option>
              {cidades.map((cidade) => <option key={cidade} value={cidade}>{cidade}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Canal</label>
            <select value={canalFiltro} onChange={(e) => setCanalFiltro(e.target.value)}>
              <option value="">Todos os canais</option>
              {canais.map((canal) => <option key={canal} value={canal}>{canal}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Status da cobertura</label>
            <select value={coberturaFiltro} onChange={(e) => setCoberturaFiltro(e.target.value)}>
              <option value="">Todos</option>
              <option value="Completa">Completa</option>
              <option value="Parcial">Parcial</option>
              <option value="Inconsistente">Inconsistente</option>
              <option value="Sem validação">Sem validação</option>
            </select>
          </div>
          <div className="field">
            <label>Validação de tabela</label>
            <select value={validacaoFiltro} onChange={(e) => setValidacaoFiltro(e.target.value)}>
              <option value="">Todas</option>
              <option value="validadas">Validadas</option>
              <option value="pendentes">Pendentes</option>
            </select>
          </div>
        </div>
      </div>

      <div className="list-stack">
        {visiveis.length ? visiveis.map((item) => {
          const resumo = buildResumoTransportadora(item);
          const cidadesDaTransportadora = Array.from(new Set((item.origens || []).map((origem) => origem.cidade).filter(Boolean)));
          const cardClass = resumo.severidade === 'error'
            ? 'list-card alert-error'
            : resumo.severidade === 'warn'
              ? 'list-card alert-warn'
              : 'list-card';
          return (
            <div key={item.id} className={cardClass} onClick={() => onOpen(item.id)}>
              <div className="list-card-left"><div className="list-icon">🏢</div><div><div className="list-title" style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>{item.nome}{(() => { const cs = [...new Set((item.origens||[]).flatMap(canaisOrigem))]; const temAtacado = cs.includes('ATACADO'); const temB2c = cs.includes('B2C'); return (<>{temAtacado&&<span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:999,background:'#dcfce7',color:'#166534'}}>ATACADO</span>}{temB2c&&<span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:999,background:'#dbeafe',color:'#1d4ed8'}}>B2C</span>}</>); })()}</div><div className="list-subtitle">{item.origens.length} origem(ns) cadastrada(s)</div>{cidadesDaTransportadora.length ? <div className="list-meta-text">Cidades: {cidadesDaTransportadora.join(', ')}</div> : null}{resumo.totalRotas !== undefined ? <div className="list-meta-text">{resumo.totalRotas} rota(s) · {resumo.totalCotacoes || 0} frete(s)</div> : null}{resumo.severidade !== 'ok' ? <div className="list-warning-text">{resumo.faltandoFrete ? `${resumo.faltandoFrete} rota(s) sem frete` : ''}{resumo.faltandoFrete && resumo.faltandoRota ? ' · ' : ''}{resumo.faltandoRota ? `${resumo.faltandoRota} frete(s) sem rota` : ''}{!resumo.faltandoFrete && !resumo.faltandoRota ? `${resumo.pendencias} origem(ns) com pendência` : ''}</div> : null}</div></div>
              <div className="list-actions" onClick={(e) => e.stopPropagation()}>
                {(() => {
                  const totalOrig = (item.origens || []).length;
                  const validadasOrig = (item.origens || []).filter((o) => o.validado).length;
                  return (
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
                      background: totalOrig && validadasOrig === totalOrig ? '#dcfce7' : '#f1f5f9',
                      color: totalOrig && validadasOrig === totalOrig ? '#166534' : '#64748b',
                    }}>
                      {validadasOrig}/{totalOrig} validado(s)
                    </span>
                  );
                })()}
                {vinculosSet ? (
                  vinculosSet.has(normalizarChave(item.nome)) ? (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: '#dcfce7', color: '#166534' }}>🔗 Com vínculo</span>
                  ) : (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: '#fee2e2', color: '#b91c1c' }}>⚠ Sem vínculo</span>
                  )
                ) : null}
                {auditoresMap ? (
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
                    background: auditoresMap.get(normalizarChave(item.nome)) ? '#dbeafe' : '#f1f5f9',
                    color: auditoresMap.get(normalizarChave(item.nome)) ? '#1d4ed8' : '#64748b',
                  }}>
                    👤 {auditoresMap.get(normalizarChave(item.nome)) || 'Sem auditor'}
                  </span>
                ) : null}
                <CoberturaBadge cobertura={resumo.cobertura} severidade={resumo.severidade} />
                <span className="status-pill dark">{item.status}</span>
                <ActionIcon onClick={() => { setEditing(item); setModalOpen(true); }}>✎</ActionIcon>
                <ActionIcon danger onClick={() => confirmarRemocaoTransportadora(item)}>🗑</ActionIcon>
              </div>
            </div>
          );
        }) : (
          <div className="table-card empty-filter-card">
            <strong>Nenhuma transportadora encontrada</strong>
            <p>Tente ajustar os filtros de cidade, status ou o nome pesquisado.</p>
          </div>
        )}
      </div>

      {filtrados.length > PAGE_SIZE ? (
        <div className="toolbar-wrap top-space" style={{ justifyContent: 'center' }}>
          <button className="btn-secondary" disabled={paginaAtual <= 1} onClick={() => setPagina((prev) => Math.max(1, prev - 1))}>Anterior</button>
          <span className="status-pill">Página {paginaAtual} de {totalPaginas}</span>
          <button className="btn-secondary" disabled={paginaAtual >= totalPaginas} onClick={() => setPagina((prev) => Math.min(totalPaginas, prev + 1))}>Próxima</button>
        </div>
      ) : null}
      <TransportadoraModal open={modalOpen} initialValue={editing} onSave={saveTransportadora} onClose={() => { setModalOpen(false); setEditing(null); }} />
      <PainelValidacaoModal open={painelValidacaoOpen} items={items} onClose={() => setPainelValidacaoOpen(false)} onOpenTransportadora={onOpen} vinculosSet={vinculosSet} auditoresMap={auditoresMap} />
    </div>
  );
}

function OrigensList({ transportadora, onBack, onOpenOrigin, store, sessao }) {
  const [busca, setBusca] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [inconsistenciasOpen, setInconsistenciasOpen] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [feedbackSalvar, setFeedbackSalvar] = useState('');
  const [origemConfirmando, setOrigemConfirmando] = useState(null);
  const { vinculosDaTransportadora, carteiraDaTransportadora, auditorNomes, salvarAuditor, recarregarVinculos, adicionarVinculo, removerVinculo } = useVinculosEAuditores();
  const origensBase = Array.isArray(transportadora?.origens) ? transportadora.origens : [];
  const origens = origensBase.filter((origem) => String(origem?.cidade || '').toLowerCase().includes(busca.toLowerCase()));
  const saveOrigem = (form) => {
    const origem = { ...editing, ...form, id: editing?.id ?? nextId(origensBase) };
    store.salvarOrigem(transportadora.id, origem);
    setModalOpen(false);
    setEditing(null);
  };

  const atualizarDadosTransportadora = async () => {
    setFeedbackSalvar('Atualizando dados da transportadora...');
    const ok = await store.carregarTransportadoraCompleta?.(transportadora.id);
    setFeedbackSalvar(ok ? 'Dados atualizados pelo Supabase.' : 'Não foi possível atualizar os dados.');
  };

  const salvarTransportadoraAtual = async () => {
    setSalvando(true);
    setFeedbackSalvar('Salvando alterações no Supabase...');
    const resultado = await store.salvarTransportadoraCompleta?.(transportadora.id);
    setSalvando(false);
    setFeedbackSalvar(resultado?.ok ? (resultado.mensagem || 'Transportadora salva no Supabase.') : (resultado?.erro?.message || 'Não foi possível salvar a transportadora.'));
  };

  const confirmarRemocaoOrigem = (origem) => {
    const ok = window.confirm(`Tem certeza que deseja excluir a origem ${origem?.cidade || ''}?`);
    if (!ok) return;
    store.removerOrigem(transportadora.id, origem.id);
  };

  return (
    <div className="page-shell">
      <button className="back-link" onClick={onBack}>← Transportadoras</button>
      <div className="page-top between"><div><h1 className="detail-title">{transportadora.nome}</h1><div className="inline-meta"><span className="status-pill dark">{transportadora.status}</span><span>{origensBase.length} origem(ns)</span>{store.syncStatus?.rascunhoLocal ? <span className="status-pill light">Rascunho local</span> : null}</div></div><div className="toolbar-wrap"><button className="btn-secondary" onClick={atualizarDadosTransportadora} disabled={store.syncStatus?.carregandoDetalheId === transportadora.id}>Atualizar dados</button><button className="btn-primary" onClick={salvarTransportadoraAtual} disabled={salvando || store.syncStatus?.carregandoDetalheId === transportadora.id}>{salvando ? 'Salvando...' : 'Salvar alterações'}</button><button className="btn-secondary" onClick={() => setInconsistenciasOpen(true)}>Ver inconsistências</button><button className="btn-secondary" onClick={() => gerarArquivosVerum(transportadora)}>Gerar arquivo Verum</button><button className="btn-primary" onClick={() => { setEditing(null); setModalOpen(true); }}>＋ Nova Origem</button></div></div>
      {store.syncStatus?.carregandoDetalheId === transportadora.id ? (
        <div className="hint-box top-space">
          <strong>Carregando detalhes da transportadora...</strong><br />
          Buscando rotas, cotações, taxas e generalidades direto do Supabase.
        </div>
      ) : !transportadora.detalheCarregado ? (
        <div className="hint-box top-space">
          <strong>Resumo carregado.</strong><br />
          Abrindo os detalhes desta transportadora para buscar fretes e cotações no Supabase.
        </div>
      ) : null}
      {feedbackSalvar ? <div className="mini-feedback info top-space">{feedbackSalvar}</div> : null}
      {store.syncStatus?.mensagemLocal ? <div className="mini-feedback info top-space">{store.syncStatus.mensagemLocal}</div> : null}
      {store.syncStatus?.erro ? (
        <div className="mini-feedback error top-space">
          {store.syncStatus.erro}
          <button className="btn-link inline-btn" onClick={() => store.carregarTransportadoraCompleta?.(transportadora.id)}>
            Tentar carregar novamente
          </button>
        </div>
      ) : null}
      <TdeSection transportadora={transportadora} store={store} />
      <input className="search-input" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cidade de origem..." />
      <div className="section-row"><div className="inline-meta"><span className="tag-yellow">ATACADO</span><span>{origensBase.length} origem(ns)</span></div></div>
      <div className="list-stack">
        {origens.map((origem) => {
          const analise = analisarCoberturaOrigem(origem);
          const cardClass = analise.severidade === 'error'
            ? 'list-card alert-error'
            : analise.severidade === 'warn'
              ? 'list-card alert-warn'
              : 'list-card';
          return (
            <div key={origem.id} className={cardClass} onClick={() => onOpenOrigin(origem.id)}>
              <div className="list-card-left"><div className="list-icon">📍</div><div><div className="list-title" style={{display:'flex',alignItems:'center',gap:8}}>{origem.cidade}<span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:999,background: canaisOrigem(origem).includes('B2C') && canaisOrigem(origem).includes('ATACADO')?'#ede9fe':canaisOrigem(origem).includes('B2C')?'#dbeafe':'#dcfce7',color:canaisOrigem(origem).includes('B2C') && canaisOrigem(origem).includes('ATACADO')?'#6d28d9':canaisOrigem(origem).includes('B2C')?'#1d4ed8':'#166534'}}>{canalOrigemLabel(origem)}</span></div><div className="list-subtitle">{(origem.rotas || []).length} rota(s) · {(origem.cotacoes || []).length} frete(s)</div>{analise.severidade !== 'ok' ? <div className="list-warning-text">{analise.rotasSemCotacao.length ? `${analise.rotasSemCotacao.length} rota(s) sem frete` : ''}{analise.rotasSemCotacao.length && analise.cotacoesSemRota.length ? ' · ' : ''}{analise.cotacoesSemRota.length ? `${analise.cotacoesSemRota.length} frete(s) sem rota` : ''}{!analise.rotasSemCotacao.length && !analise.cotacoesSemRota.length ? analise.cobertura : ''}</div> : null}</div></div>
              <div className="list-actions" onClick={(e) => e.stopPropagation()}>
                <CoberturaBadge cobertura={transportadora.detalheCarregado ? analise.cobertura : 'Resumo'} severidade={transportadora.detalheCarregado ? analise.severidade : 'ok'} />
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                  <button
                    type="button"
                    className="btn-link inline-btn"
                    onClick={() => (origem.validado
                      ? store.marcarOrigemValidada(transportadora.id, origem.id, false, sessao?.nome)
                      : setOrigemConfirmando(origem))}
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '3px 8px',
                      borderRadius: 999,
                      background: origem.validado ? '#dcfce7' : '#f1f5f9',
                      color: origem.validado ? '#166534' : '#64748b',
                      border: 'none',
                    }}
                  >
                    {origem.validado ? '✓ Validado' : 'Pendente'}
                  </button>
                  {origem.validado && origem.validado_em ? (
                    <span style={{ fontSize: 10, color: '#94a3b8' }}>
                      {origem.validado_por ? `${origem.validado_por} · ` : ''}{new Date(origem.validado_em).toLocaleDateString('pt-BR')}
                    </span>
                  ) : null}
                </span>
                <select
                  value={canalOrigemValor(canaisOrigem(origem))}
                  onChange={(e) => store.atualizarCanalOrigem(transportadora.id, origem.id, e.target.value)}
                  disabled={!transportadora.detalheCarregado}
                  title={transportadora.detalheCarregado ? 'Canal desta origem (troca direto, sem abrir)' : 'Abra a transportadora para carregar as rotas antes de trocar o canal'}
                  style={{ fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid #cbd5e1', cursor: transportadora.detalheCarregado ? 'pointer' : 'not-allowed' }}
                >
                  <option value="ATACADO">ATACADO</option>
                  <option value="B2C">B2C</option>
                  <option value="ATACADO+B2C">ATACADO + B2C</option>
                </select>
                <button className="btn-link inline-btn" onClick={() => setInconsistenciasOpen(origem.id)}>Ver inconsistências</button>
                <button className="btn-link inline-btn" onClick={() => gerarArquivosVerum(transportadora, origem)}>Gerar Verum</button>
                <span className="status-pill light">{origem.status}</span>
                <ActionIcon onClick={() => { setEditing(origem); setModalOpen(true); }}>✎</ActionIcon>
                <ActionIcon danger onClick={() => confirmarRemocaoOrigem(origem)}>🗑</ActionIcon>
              </div>
            </div>
          );
        })}
      </div>
      <div className="footer-note">{origensBase.length} origem(ns) no total</div>
      <ConfirmarValidacaoModal
        open={!!origemConfirmando}
        transportadora={transportadora}
        origem={origemConfirmando}
        vinculos={origemConfirmando ? vinculosDaTransportadora(transportadora.nome) : []}
        auditorAtual={origemConfirmando ? carteiraDaTransportadora(transportadora.nome)?.auditor_nome : null}
        auditorNomes={auditorNomes}
        onSalvarAuditor={(nome) => salvarAuditor(transportadora.nome, nome)}
        onRecarregarVinculos={recarregarVinculos}
        onAdicionarVinculo={(nomeCte) => adicionarVinculo(nomeCte, transportadora.nome)}
        onRemoverVinculo={removerVinculo}
        onConfirmar={() => {
          store.marcarOrigemValidada(transportadora.id, origemConfirmando.id, true, sessao?.nome);
          setOrigemConfirmando(null);
        }}
        onClose={() => setOrigemConfirmando(null)}
      />
      <OrigemModal open={modalOpen} initialValue={editing} onSave={saveOrigem} onClose={() => { setModalOpen(false); setEditing(null); }} />
      <InconsistenciasModal open={!!inconsistenciasOpen} title={typeof inconsistenciasOpen === 'number' ? 'Inconsistências da origem' : 'Inconsistências da transportadora'} transportadora={transportadora} origem={typeof inconsistenciasOpen === 'number' ? origensBase.find((item) => item.id === inconsistenciasOpen) : null} onClose={() => setInconsistenciasOpen(false)} />
    </div>
  );
}

function ConfirmarValidacaoModal({ open, transportadora, origem, vinculos, auditorAtual, auditorNomes, onSalvarAuditor, onRecarregarVinculos, onAdicionarVinculo, onRemoverVinculo, onConfirmar, onClose }) {
  const [salvandoAuditor, setSalvandoAuditor] = useState(false);
  const [novoAuditor, setNovoAuditor] = useState('');
  const [atualizandoVinculos, setAtualizandoVinculos] = useState(false);
  const [novoNomeCte, setNovoNomeCte] = useState('');
  const [salvandoVinculo, setSalvandoVinculo] = useState(false);
  const [removendoId, setRemovendoId] = useState(null);
  const [sugestoesCte, setSugestoesCte] = useState([]);
  const [selecionados, setSelecionados] = useState([]);
  const [erroVinculo, setErroVinculo] = useState('');

  if (!open) return null;

  const escolherAuditor = async (nome) => {
    if (!nome) return;
    setSalvandoAuditor(true);
    await onSalvarAuditor(nome);
    setSalvandoAuditor(false);
  };

  const atualizarVinculos = async () => {
    setAtualizandoVinculos(true);
    try {
      await onRecarregarVinculos?.();
    } finally {
      setAtualizandoVinculos(false);
    }
  };

  const buscarSugestoes = async (texto) => {
    setNovoNomeCte(texto);
    if (texto.trim().length < 2) { setSugestoesCte([]); return; }
    const resultado = await buscarNomesCteSimilares(texto);
    setSugestoesCte(resultado);
  };

  const alternarSelecionado = (nome) => {
    setSelecionados((prev) => (prev.includes(nome) ? prev.filter((n) => n !== nome) : [...prev, nome]));
  };

  const vincularCte = async () => {
    // Com sugestões marcadas, o campo de busca é só filtro — usa apenas o que foi selecionado.
    // Sem seleção, o texto digitado vira o vínculo livre (nome que não apareceu na busca).
    const nomes = selecionados.length ? [...new Set(selecionados)] : [novoNomeCte.trim()].filter(Boolean);
    if (!nomes.length) return;
    setSalvandoVinculo(true);
    setErroVinculo('');
    try {
      await onAdicionarVinculo?.(nomes);
      setNovoNomeCte('');
      setSugestoesCte([]);
      setSelecionados([]);
    } catch (err) {
      setErroVinculo(err?.message || 'Erro ao salvar vínculo.');
    } finally {
      setSalvandoVinculo(false);
    }
  };

  const removerVinculo = async (vinculo) => {
    setRemovendoId(vinculo.id || vinculo.nomeCte);
    setErroVinculo('');
    try {
      await onRemoverVinculo?.(vinculo);
    } catch (err) {
      setErroVinculo(err?.message || 'Erro ao remover vínculo.');
    } finally {
      setRemovendoId(null);
    }
  };

  return (
    <Modal open={open} title={`Confirmar validação — ${origem?.cidade || ''}`} onClose={onClose}>
      <div className="hint-box">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <strong>Vínculos com CT-e para {transportadora?.nome}</strong>
          <button type="button" className="btn-link inline-btn" disabled={atualizandoVinculos} onClick={atualizarVinculos}>
            {atualizandoVinculos ? 'Atualizando…' : '🔄 Atualizar vínculos'}
          </button>
        </div>
        {vinculos.length ? (
          <ul style={{ margin: '8px 0 0', paddingLeft: 0, listStyle: 'none' }}>
            {vinculos.map((v) => (
              <li key={v.id || v.nomeCte} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
                <span>{v.nomeCte}</span>
                <button
                  type="button"
                  className="btn-link inline-btn"
                  disabled={removendoId === (v.id || v.nomeCte)}
                  onClick={() => removerVinculo(v)}
                  title="Remover vínculo"
                  style={{ color: '#b45309' }}
                >
                  {removendoId === (v.id || v.nomeCte) ? 'Removendo…' : '🗑 Remover'}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ color: '#b45309', margin: '8px 0 0' }}>⚠ Nenhum vínculo encontrado para esta transportadora.</p>
        )}
        {erroVinculo ? <p style={{ color: '#dc2626', margin: '8px 0 0', fontSize: 13 }}>❌ {erroVinculo}</p> : null}
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              placeholder="Buscar nome como aparece no CT-e..."
              value={novoNomeCte}
              onChange={(e) => buscarSugestoes(e.target.value)}
              disabled={salvandoVinculo}
              style={{ flex: 1, minWidth: 200 }}
            />
            <button
              type="button"
              className="btn-secondary"
              disabled={salvandoVinculo || (!novoNomeCte.trim() && !selecionados.length)}
              onClick={vincularCte}
            >
              {salvandoVinculo ? 'Vinculando…' : `Vincular${selecionados.length ? ` (${selecionados.length})` : ''}`}
            </button>
          </div>
          {sugestoesCte.length ? (
            <div style={{ marginTop: 6, maxHeight: 160, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 6 }}>
              {sugestoesCte.map((nome) => (
                <label key={nome} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }}>
                  <input
                    type="checkbox"
                    checked={selecionados.includes(nome)}
                    onChange={() => alternarSelecionado(nome)}
                  />
                  {nome}
                </label>
              ))}
            </div>
          ) : null}
        </div>
        <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>Marque quantos vínculos precisar antes de clicar em Vincular. Você também pode conferir/editar na tela Ferramentas.</p>
      </div>

      <div className="hint-box top-space">
        <strong>Auditor responsável</strong>
        {auditorAtual ? (
          <p style={{ margin: '8px 0 0' }}>👤 {auditorAtual}</p>
        ) : (
          <div style={{ marginTop: 8 }}>
            <p style={{ color: '#b45309', margin: '0 0 8px' }}>⚠ Nenhum auditor atribuído a esta transportadora.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select disabled={salvandoAuditor} onChange={(e) => escolherAuditor(e.target.value)} defaultValue="">
                <option value="" disabled>Selecionar auditor existente...</option>
                {auditorNomes.map((nome) => <option key={nome} value={nome}>{nome}</option>)}
              </select>
              <input
                placeholder="Ou digite um novo nome..."
                value={novoAuditor}
                onChange={(e) => setNovoAuditor(e.target.value)}
                disabled={salvandoAuditor}
                style={{ flex: 1, minWidth: 160 }}
              />
              <button
                type="button"
                className="btn-secondary"
                disabled={salvandoAuditor || !novoAuditor.trim()}
                onClick={() => escolherAuditor(novoAuditor.trim())}
              >
                Atribuir
              </button>
            </div>
          </div>
        )}
        <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>Você também pode gerenciar carteiras na tela de Gestão de Carteiras de Auditoria.</p>
      </div>

      <div className="actions-right gap-row top-space">
        <button className="btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" onClick={onConfirmar}>Confirmar validação</button>
      </div>
    </Modal>
  );
}

function CanalTab({ transportadoraId, origem, store }) {
  const canaisAtivos = canaisOrigem(origem);
  const [selecionados, setSelecionados] = useState(canaisAtivos);
  const [novoCanal, setNovoCanal] = useState('');

  const toggle = (canal) => {
    setSelecionados(prev =>
      prev.includes(canal) ? prev.filter(c => c !== canal) : [...prev, canal]
    );
  };

  const adicionarNovo = () => {
    const c = novoCanal.trim().toUpperCase();
    if (!c) return;
    adicionarCanalDisponivel(c);
    setSelecionados(prev => prev.includes(c) ? prev : [...prev, c]);
    setNovoCanal('');
  };

  const salvar = () => {
    store.salvarOrigem(transportadoraId, { ...origem, canal: canalOrigemValor(selecionados) });
  };

  return (
    <div className="panel-card">
      <div className="tab-panel-header">
        <p>Defina quais canais esta origem atende. Origens com múltiplos canais participam das simulações de todos eles.</p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {CANAIS_DISPONIVEIS.map(canal => (
          <label key={canal} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: '1px solid var(--border-soft)', borderRadius: 10, cursor: 'pointer', background: selecionados.includes(canal) ? '#edf2ff' : '#fff' }}>
            <input
              type="checkbox"
              checked={selecionados.includes(canal)}
              onChange={() => toggle(canal)}
              style={{ width: 16, height: 16 }}
            />
            <span style={{ fontWeight: 600, fontSize: 14 }}>{canal}</span>
            {selecionados.includes(canal) && <span style={{ marginLeft: 'auto', fontSize: 12, color: '#3b82f6' }}>✓ ativo</span>}
          </label>
        ))}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
          <input
            value={novoCanal}
            onChange={e => setNovoCanal(e.target.value.toUpperCase())}
            placeholder="Novo canal (ex: CROSS)"
            onKeyDown={e => e.key === 'Enter' && adicionarNovo()}
            style={{ flex: 1 }}
          />
          <button className="btn-secondary" onClick={adicionarNovo} disabled={!novoCanal.trim()}>
            Adicionar canal
          </button>
        </div>
      </div>
      <div className="actions-right top-space">
        <div style={{ fontSize: 12, color: 'var(--muted)', marginRight: 'auto' }}>
          Canal atual: <strong>{canalOrigemValor(selecionados).replace('+', ' + ')}</strong>
        </div>
        <button className="btn-primary" onClick={salvar} disabled={!selecionados.length}>
          Salvar Canal
        </button>
      </div>
    </div>
  );
}

function TabButton({ active, children, onClick }) {
  return <button className={active ? 'tab-btn active' : 'tab-btn'} onClick={onClick}>{children}</button>;
}

function OrigemDetail({ transportadora, origem, onBack, store }) {
  const [aba, setAba] = useState('generalidades');
  const [inconsistenciasOpen, setInconsistenciasOpen] = useState(false);
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
    { key: 'ibgeDestino', label: 'IBGE Destino' }, { key: 'tda', label: 'TDA (R$)' }, { key: 'trt', label: 'TRT (R$)' }, { key: 'suframa', label: 'SUFRAMA (R$)' }, { key: 'outras', label: 'Outras (R$)' }, { key: 'gris', label: 'GRIS (%)' }, { key: 'grisMinimo', label: 'GRIS Mín.' }, { key: 'adVal', label: 'Ad Val (%)' }, { key: 'adValMinimo', label: 'Ad Val Mín.' }, { key: 'taxasExtras', label: 'Coringas', render: function(v) { return Array.isArray(v) && v.length ? v.map(function(te) { return te.nome || 'coringa'; }).join(', ') : '-'; } },
  ];
  const taxasFields = [
    { name: 'ibgeDestino', label: 'IBGE Destino' }, { name: 'tda', label: 'TDA (R$)' }, { name: 'trt', label: 'TRT (R$)' }, { name: 'suframa', label: 'SUFRAMA (R$)' }, { name: 'outras', label: 'Outras (R$)' }, { name: 'gris', label: 'GRIS (%)' }, { name: 'grisMinimo', label: 'GRIS Mínimo (R$)' }, { name: 'adVal', label: 'Ad Valorem (%)' }, { name: 'adValMinimo', label: 'Ad Valorem Mínimo (R$)' },
  ];

  return (
    <div className="page-shell">
      <button className="back-link" onClick={onBack}>← {transportadora.nome}</button>
      <div className="page-top between align-start"><div><h1 className="detail-title">{origem.cidade} —</h1><div className="detail-subtitle">{transportadora.nome} · <strong>{canalOrigemLabel(origem)}</strong> · {origem.rotas.length} rota(s)</div></div><div className="toolbar-wrap"><button className="btn-secondary" onClick={() => setInconsistenciasOpen(true)}>Ver inconsistências</button><button className="btn-secondary" onClick={() => gerarArquivosVerum(transportadora, origem)}>Gerar arquivo Verum</button><span className="status-pill dark">{origem.status}</span></div></div>
      <div className="tabs-row"><TabButton active={aba === 'canal'} onClick={() => setAba('canal')}>Canal</TabButton><TabButton active={aba === 'generalidades'} onClick={() => setAba('generalidades')}>Generalidades</TabButton><TabButton active={aba === 'rotas'} onClick={() => setAba('rotas')}>Rotas</TabButton><TabButton active={aba === 'cotacoes'} onClick={() => setAba('cotacoes')}>Cotações</TabButton><TabButton active={aba === 'taxas'} onClick={() => setAba('taxas')}>Taxas Especiais</TabButton></div>
      {aba === 'canal' && <CanalTab transportadoraId={transportadora.id} origem={origem} store={store} />}
      {aba === 'generalidades' && <GeneralidadesTab transportadoraId={transportadora.id} origem={origem} store={store} />}
      {aba === 'rotas' && <CrudTab title="Rota" secao="rotas" tipoImportacao="rotas" origem={origem} transportadora={transportadora} store={store} columns={rotasColumns} fields={rotasFields} hint={<>Use <strong>Baixar Modelo</strong> para subir rotas no padrão do seu arquivo real. Também há <strong>Exportar</strong> e <strong>Excluir Tudo</strong>.</>} />}
      {aba === 'cotacoes' && <CrudTab title="Cotação" secao="cotacoes" tipoImportacao="cotacoes" origem={origem} transportadora={transportadora} store={store} columns={cotacoesColumns} fields={cotacoesFields} hint={<>Fretes/cotações aceitam importação no modelo com <strong>Rota do frete</strong>, pesos, excesso, taxa aplicada e percentual.</>} />}
      {aba === 'taxas' && <TaxasEspeciaisTab origem={origem} transportadora={transportadora} store={store} />}
      <InconsistenciasModal open={inconsistenciasOpen} title="Inconsistências da origem" transportadora={transportadora} origem={origem} onClose={() => setInconsistenciasOpen(false)} />
    </div>
  );
}

export default function TransportadorasPage({ transportadoras, transportadoraSelecionadaId, origemSelecionadaId, onOpenTransportadora, onOpenOrigem, onVoltar, store, sessao }) {
  const transportadora = useMemo(() => transportadoras.find((item) => String(item.id) === String(transportadoraSelecionadaId)), [transportadoras, transportadoraSelecionadaId]);
  const origem = useMemo(() => (transportadora?.origens || []).find((item) => String(item.id) === String(origemSelecionadaId)), [transportadora, origemSelecionadaId]);

  React.useEffect(() => {
    // O carregamento completo agora é manual pelo botão "Atualizar dados".
    // Isso evita que a tela recarregue do Supabase e reverta uma edição em andamento.
  }, [transportadoraSelecionadaId, transportadora, store]);

  return (
    <>
      <AmdProcessingOverlay
        ativo={Boolean(store?.syncStatus?.sincronizando)}
        progresso={null}
        mensagemRodape="Pode levar mais tempo em transportadoras com muitas rotas/cotações."
      />
      {!transportadora
        ? <TransportadorasList items={transportadoras} onOpen={onOpenTransportadora} store={store} />
        : !origem
          ? <OrigensList transportadora={transportadora} onBack={onVoltar} onOpenOrigin={onOpenOrigem} store={store} sessao={sessao} />
          : <OrigemDetail transportadora={transportadora} origem={origem} onBack={onVoltar} store={store} />}
    </>
  );
}
