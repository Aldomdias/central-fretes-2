import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { importarTemplatePadraoSeparado } from '../utils/importadorTemplatePadrao';
import { baixarModeloTemplateFretes, baixarModeloTemplateRotas } from '../utils/modelosTemplateFormatacao';
import {
  importarTemplateCantu,
  importarModeloLotacao,
  baixarModeloLotacao,
} from '../utils/importadorTemplatesCantu';
import {
  STATUS_TABELA_NEGOCIACAO,
  TIPOS_TABELA_NEGOCIACAO,
  alternarTabelaNegociacaoNaSimulacao,
  aprovarTabelaNegociacao,
  atualizarTabelaNegociacao,
  criarTabelaNegociacao,
  excluirTabelaNegociacao,
  listarItensTabelaNegociacao,
  listarTabelasNegociacao,
  substituirItensTabelaNegociacao,
} from '../services/tabelasNegociacaoService';

const CANAIS = ['ATACADO', 'B2C', 'INTERCOMPANY', 'REVERSA'];
const UF_OPTIONS = ['','AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];
const TIPOS_IMPORTACAO = [
  { value: 'VERUM_ROTAS_FRETES', label: '1. Verum/Sistema — Rotas + Fretes' },
  { value: 'CANTU_MODELO_UNICO', label: '2. Cantu Fracionado — Arquivo único' },
  { value: 'LOTACAO_TRANSPORTADORA', label: '3. Lotação — Modelo Transportadora' },
];
const SUBTIPOS_CANTU = [
  { value: 'B2B_FAIXA_PESO', label: 'B2B — Faixa de Peso' },
  { value: 'B2B_PERCENTUAL', label: 'B2B — Percentual' },
  { value: 'B2C_FAIXA_PESO', label: 'B2C — Faixa de Peso' },
  { value: 'B2C_PERCENTUAL', label: 'B2C — Percentual' },
];

function hojeISO() { return new Date().toISOString().slice(0, 10); }
function fimTresAnosISO() { const d = new Date(); d.setFullYear(d.getFullYear() + 3); return d.toISOString().slice(0, 10); }
function gerarId(p) { return globalThis.crypto?.randomUUID ? `${p}-${globalThis.crypto.randomUUID()}` : `${p}-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function normalizarTexto(v) { return String(v ?? '').trim(); }
function numeroOuVazio(v) { if (v === null || v === undefined || v === '') return ''; const n = Number(v); return Number.isFinite(n) ? n : v; }
function formatMoney(v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function formatPercent(v) { return `${Number(v || 0).toFixed(2)}%`; }

function exportarXlsx(linhas, nomeArquivo, aba = 'Dados') {
  if (!linhas?.length) return;
  const ws = XLSX.utils.json_to_sheet(linhas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, aba);
  XLSX.writeFile(wb, nomeArquivo);
}

function montarLinhasFormatadas({ resultado, transportadora, canal, inicioVigencia, fimVigencia }) {
  const nomeT = normalizarTexto(transportadora);
  const c = normalizarTexto(canal || 'ATACADO').toUpperCase();
  const rotas = (resultado?.rotas || []).map((item) => ({
    id: gerarId('rota'),
    nomeRota: item.cotacaoFinal || item.cotacao || `${item.origem} - ${item.ufDestino} - ${item.cotacaoBase}`,
    ibgeOrigem: item.ibgeOrigem || '', cidadeOrigem: item.origem || '', ufOrigem: item.ufOrigem || '',
    ibgeDestino: item.ibgeDestino || '', cidadeDestino: item.cidadeDestino || '', ufDestino: item.ufDestino || '',
    canal: c, prazoEntregaDias: item.prazo || '', cotacaoBase: item.cotacaoBase || '',
    cotacaoFinal: item.cotacaoFinal || item.cotacao || '', inicioVigencia, fimVigencia,
  }));
  const cotacoes = (resultado?.fretes || []).map((item) => ({
    id: gerarId('cotacao'),
    rota: item.cotacaoFinal || item.cotacao || `${item.origem} - ${item.ufDestino} - ${item.cotacaoBase}`,
    origem: item.origem || '', ufOrigem: item.ufOrigem || '', ufDestino: item.ufDestino || '',
    cotacaoBase: item.cotacaoBase || '', faixaPeso: item.faixaPeso || '',
    pesoMin: item.pesoInicial ?? '', pesoMax: item.pesoFinal ?? '',
    taxaAplicada: item.taxaAplicada ?? item.freteValor ?? '', excesso: item.excedente ?? '',
    percentual: item.fretePercentual ?? '', freteMinimo: item.freteMinimo ?? '',
    regraCalculo: 'FAIXA_DE_PESO', tipoCalculo: 'FAIXA_DE_PESO', canal: c, inicioVigencia, fimVigencia,
  }));
  const linhasExportacao = cotacoes.map((item) => ({
    'Nome da transportadora': nomeT, 'Código da unidade': item.origem || '', 'Canal': c,
    'Regra de cálculo': item.regraCalculo, 'Tipo de cálculo': item.tipoCalculo,
    'Rota do frete': item.rota, 'Peso mínimo': numeroOuVazio(item.pesoMin),
    'Peso limite': numeroOuVazio(item.pesoMax), 'Excesso de peso': numeroOuVazio(item.excesso),
    'Taxa aplicada': numeroOuVazio(item.taxaAplicada), 'Frete percentual': numeroOuVazio(item.percentual),
    'Frete mínimo': numeroOuVazio(item.freteMinimo), 'Início da vigência': inicioVigencia, 'Fim da vigência': fimVigencia,
  }));
  const linhasRotas = rotas.map((item) => ({
    'NOME TRANSPORTADORA': nomeT, 'CANAL': c, 'NOME ROTA': item.nomeRota,
    'IBGE ORIGEM': item.ibgeOrigem, 'CIDADE ORIGEM': item.cidadeOrigem, 'UF ORIGEM': item.ufOrigem,
    'IBGE DESTINO': item.ibgeDestino, 'CIDADE DESTINO': item.cidadeDestino, 'UF DESTINO': item.ufDestino,
    'PRAZO': item.prazoEntregaDias, 'DATA INÍCIO': inicioVigencia, 'DATA FIM': fimVigencia,
  }));
  return { rotas, cotacoes, linhasExportacao, linhasRotas };
}

function montarItensVerum(formatado) {
  if (!formatado) return [];
  const rotasPorNome = new Map();
  (formatado.rotas || []).forEach((rota) => {
    [rota.nomeRota, rota.cotacaoFinal, `${rota.cidadeOrigem} - ${rota.ufDestino} - ${rota.cotacaoBase}`]
      .filter(Boolean).forEach((chave) => rotasPorNome.set(String(chave), rota));
  });
  const itensRotas = (formatado.rotas || []).map((rota) => ({
    item_tipo: 'ROTA', cidade_origem: rota.cidadeOrigem || '', uf_origem: rota.ufOrigem || '',
    ibge_origem: rota.ibgeOrigem || '', cidade_destino: rota.cidadeDestino || '',
    uf_destino: rota.ufDestino || '', ibge_destino: rota.ibgeDestino || '',
    faixa_peso: 'ROTA', prazo: rota.prazoEntregaDias || 0, observacao: rota.nomeRota || '',
    origem_importacao: 'VERUM_ROTAS_FRETES', dados_originais: { tipo_item: 'ROTA', ...rota },
  }));
  const itensCotacoes = (formatado.cotacoes || []).map((cotacao) => {
    const rota = rotasPorNome.get(String(cotacao.rota || '')) || null;
    return {
      item_tipo: 'COTACAO', cidade_origem: cotacao.origem || rota?.cidadeOrigem || '',
      uf_origem: cotacao.ufOrigem || rota?.ufOrigem || '', ibge_origem: rota?.ibgeOrigem || '',
      cidade_destino: rota?.cidadeDestino || '', uf_destino: cotacao.ufDestino || rota?.ufDestino || '',
      ibge_destino: rota?.ibgeDestino || '', faixa_peso: cotacao.faixaPeso || '',
      peso_inicial: cotacao.pesoMin ?? '', peso_final: cotacao.pesoMax ?? '',
      frete_minimo: cotacao.freteMinimo ?? '', taxa_aplicada: cotacao.taxaAplicada ?? '',
      frete_percentual: cotacao.percentual ?? '', excesso_kg: cotacao.excesso ?? '',
      prazo: rota?.prazoEntregaDias || '', observacao: cotacao.rota || '',
      origem_importacao: 'VERUM_ROTAS_FRETES', dados_originais: { tipo_item: 'COTACAO', ...cotacao, rotaDetalhe: rota },
    };
  });
  return [...itensRotas, ...itensCotacoes];
}

function getTipoItem(item) {
  return item?.dados_originais?.tipo_item || item?.dados_originais?.item_tipo || item?.item_tipo || (item?.faixa_peso === 'ROTA' ? 'ROTA' : 'COTACAO');
}

function statusStyle(status) {
  if (status === 'APROVADA') return { background: '#dcfce7', color: '#15803d', border: '1px solid #86efac' };
  if (status === 'EM TESTE') return { background: '#dbeafe', color: '#1d4ed8', border: '1px solid #93c5fd' };
  if (status === 'REPROVADA' || status === 'CANCELADA') return { background: '#fee2e2', color: '#dc2626', border: '1px solid #fecaca' };
  if (status === 'PROMOVIDA PARA OFICIAL') return { background: '#f3e8ff', color: '#7c3aed', border: '1px solid #c4b5fd' };
  return { background: '#fef3c7', color: '#b45309', border: '1px solid #fcd34d' };
}

function BadgeImportacao({ tipo }) {
  if (!tipo) return null;
  const map = {
    VERUM_ROTAS_FRETES: { label: 'Verum', bg: '#e0f2fe', color: '#0369a1' },
    CANTU_MODELO_UNICO: { label: 'Cantu', bg: '#fef3c7', color: '#b45309' },
    LOTACAO_TRANSPORTADORA: { label: 'Lotação', bg: '#f3e8ff', color: '#7c3aed' },
  };
  const s = map[tipo];
  if (!s) return null;
  return <span style={{ background: s.bg, color: s.color, borderRadius: 999, padding: '2px 7px', fontSize: 11, fontWeight: 700, marginLeft: 6 }}>{s.label}</span>;
}

const FORM_VAZIO = { transportadora: '', canal: 'ATACADO', tipo_tabela: 'FRACIONADO', status: 'EM NEGOCIAÇÃO', descricao: '', regiao: '', origem: '', uf_origem: '', uf_destino: '', data_recebimento: hojeISO(), data_inicio_prevista: '', incluir_simulacao: false, observacao: '', saving_projetado: '', aderencia_projetada: '' };

export default function TabelasNegociacaoPage() {
  const [tabelas, setTabelas] = useState([]);
  const [selecionada, setSelecionada] = useState(null);
  const [itensSelecionada, setItensSelecionada] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [filtros, setFiltros] = useState({ status: '', tipoTabela: '', canal: '', transportadora: '' });
  const [form, setForm] = useState(FORM_VAZIO);

  const [tipoImportacao, setTipoImportacao] = useState('VERUM_ROTAS_FRETES');
  const [subtipoCantu, setSubtipoCantu] = useState('B2B_FAIXA_PESO');

  const [arquivoRotas, setArquivoRotas] = useState(null);
  const [arquivoFretes, setArquivoFretes] = useState(null);
  const [resultadoTemplate, setResultadoTemplate] = useState(null);
  const [formatado, setFormatado] = useState(null);
  const [mostrarPreview, setMostrarPreview] = useState(false);

  const [arquivoCantu, setArquivoCantu] = useState(null);
  const [resultadoCantu, setResultadoCantu] = useState(null);

  const [arquivoLotacao, setArquivoLotacao] = useState(null);
  const [resultadoLotacao, setResultadoLotacao] = useState(null);

  const [inicioVigencia, setInicioVigencia] = useState(hojeISO());
  const [fimVigencia, setFimVigencia] = useState(fimTresAnosISO());

  const [modalAprovacao, setModalAprovacao] = useState(null);
  const [aprovacao, setAprovacao] = useState({ data_inicio_vigencia: hojeISO(), substituir_tabela_anterior: false, justificativa_aprovacao: '' });

  const resumo = useMemo(() => ({
    total: tabelas.length,
    emSimulacao: tabelas.filter((t) => t.incluir_simulacao).length,
    emTeste: tabelas.filter((t) => t.status === 'EM TESTE').length,
    aprovadas: tabelas.filter((t) => t.status === 'APROVADA').length,
    lotacao: tabelas.filter((t) => t.tipo_tabela === 'LOTACAO').length,
    fracionado: tabelas.filter((t) => t.tipo_tabela === 'FRACIONADO').length,
  }), [tabelas]);

  const resumoItens = useMemo(() => {
    const rotas = itensSelecionada.filter((i) => getTipoItem(i) === 'ROTA');
    const cotacoes = itensSelecionada.filter((i) => getTipoItem(i) !== 'ROTA');
    const ufsSet = new Set([...rotas.map((i) => i.uf_destino), ...itensSelecionada.map((i) => i.uf_destino)].filter(Boolean));
    return { rotas: rotas.length, cotacoes: cotacoes.length, ufs: ufsSet.size };
  }, [itensSelecionada]);

  function limparImport() {
    setResultadoTemplate(null); setFormatado(null); setMostrarPreview(false);
    setResultadoCantu(null); setResultadoLotacao(null);
    setArquivoRotas(null); setArquivoFretes(null); setArquivoCantu(null); setArquivoLotacao(null);
  }

  async function carregar() {
    setCarregando(true); setErro('');
    try { setTabelas(await listarTabelasNegociacao(filtros)); }
    catch (e) { setErro(e.message || 'Erro ao carregar.'); }
    finally { setCarregando(false); }
  }

  useEffect(() => { carregar(); }, []); // eslint-disable-line

  async function abrirTabela(tabela) {
    setSelecionada(tabela); limparImport(); setErro(''); setSucesso('');
    try {
      const itens = await listarItensTabelaNegociacao(tabela.id);
      setItensSelecionada(itens);
      setInicioVigencia(tabela.data_inicio_prevista || hojeISO());
      setFimVigencia(fimTresAnosISO());
      if (itens.length > 0 && itens[0].origem_importacao) setTipoImportacao(itens[0].origem_importacao);
    } catch (e) { setErro(e.message || 'Erro ao abrir itens.'); }
  }

  async function salvarNovaTabela() {
    setSalvando(true); setErro(''); setSucesso('');
    try {
      const nova = await criarTabelaNegociacao(form);
      setSucesso('Tabela criada com sucesso.');
      setForm(FORM_VAZIO);
      await carregar();
      await abrirTabela(nova);
    } catch (e) { setErro(e.message || 'Erro ao salvar.'); }
    finally { setSalvando(false); }
  }

  async function alternarSimulacao(tabela) {
    setErro(''); setSucesso('');
    try {
      const at = await alternarTabelaNegociacaoNaSimulacao(tabela.id, !tabela.incluir_simulacao);
      setTabelas((p) => p.map((i) => (i.id === tabela.id ? at : i)));
      if (selecionada?.id === tabela.id) setSelecionada(at);
      setSucesso(at.incluir_simulacao ? 'Marcada para simulação.' : 'Removida da simulação.');
    } catch (e) { setErro(e.message || 'Erro.'); }
  }

  async function atualizarStatus(tabela, status) {
    setErro(''); setSucesso('');
    try {
      const at = await atualizarTabelaNegociacao(tabela.id, { status });
      setTabelas((p) => p.map((i) => (i.id === tabela.id ? at : i)));
      if (selecionada?.id === tabela.id) setSelecionada(at);
      setSucesso('Status atualizado.');
    } catch (e) { setErro(e.message || 'Erro.'); }
  }

  async function excluirTabela(tabela) {
    if (!window.confirm(`Excluir tabela de ${tabela.transportadora}?`)) return;
    setErro(''); setSucesso('');
    try {
      await excluirTabelaNegociacao(tabela.id);
      if (selecionada?.id === tabela.id) { setSelecionada(null); setItensSelecionada([]); }
      await carregar();
      setSucesso('Tabela excluída.');
    } catch (e) { setErro(e.message || 'Erro.'); }
  }

  async function salvarItens(itens, origemImportacao, extraUpdate = {}) {
    setSalvando(true); setErro(''); setSucesso('');
    try {
      const salvos = await substituirItensTabelaNegociacao(selecionada, itens);
      const at = await atualizarTabelaNegociacao(selecionada.id, {
        data_inicio_prevista: inicioVigencia,
        status: selecionada.status === 'EM NEGOCIAÇÃO' ? 'EM TESTE' : selecionada.status,
        origem_importacao: origemImportacao,
        ...extraUpdate,
      });
      setSelecionada(at);
      setTabelas((p) => p.map((i) => (i.id === at.id ? at : i)));
      setItensSelecionada(salvos);
      setSucesso(`${salvos.length} item(ns) salvos (${origemImportacao}).`);
    } catch (e) { setErro(e.message || 'Erro ao salvar itens.'); }
    finally { setSalvando(false); }
  }

  // ── Verum ──
  async function processarVerum() {
    if (!selecionada?.id) return setErro('Crie e abra uma tabela antes de importar.');
    setErro(''); setSucesso(''); setResultadoTemplate(null); setFormatado(null); setMostrarPreview(false);
    try {
      const r = await importarTemplatePadraoSeparado({ arquivoRotas, arquivoFretes });
      setResultadoTemplate(r);
      setSucesso(`Lido: ${r.rotas.length} rota(s), ${r.quebrasFaixa.length} quebra(s), ${r.fretes.length} frete(s). Clique em "Formatar".`);
    } catch (e) { setErro(e?.message || 'Erro ao importar template.'); }
  }

  function formatarVerum() {
    if (!resultadoTemplate) return setErro('Leia o template primeiro.');
    const f = montarLinhasFormatadas({ resultado: resultadoTemplate, transportadora: selecionada.transportadora, canal: selecionada.canal, inicioVigencia, fimVigencia });
    setFormatado(f); setMostrarPreview(true);
    setSucesso(`Formatado: ${f.rotas.length} rota(s) e ${f.cotacoes.length} cotação(ões).`);
  }

  // ── Cantu ──
  async function processarCantu() {
    if (!selecionada?.id) return setErro('Crie e abra uma tabela antes de importar.');
    if (!arquivoCantu) return setErro('Selecione o arquivo Cantu.');
    setErro(''); setSucesso(''); setResultadoCantu(null);
    try {
      const r = await importarTemplateCantu(arquivoCantu, subtipoCantu, selecionada.origem || '');
      setResultadoCantu(r);
      setSucesso(`Cantu lido: ${r.meta.totalItens} item(ns). Canal: ${r.meta.canal}. Transportadora: ${r.ficha?.transportadora || '-'}. Revise e salve.`);
    } catch (e) { setErro(e?.message || 'Erro ao importar Cantu.'); }
  }

  // ── Lotação ──
  async function processarLotacao() {
    if (!selecionada?.id) return setErro('Crie e abra uma tabela antes de importar.');
    if (!arquivoLotacao) return setErro('Selecione o arquivo de Lotação.');
    setErro(''); setSucesso(''); setResultadoLotacao(null);
    try {
      const r = await importarModeloLotacao(arquivoLotacao, selecionada.origem || '');
      setResultadoLotacao(r);
      setSucesso(`Lotação lida: ${r.meta.totalItens} rota(s). Abas: ${r.meta.abasEncontradas?.join(', ')}. Revise e salve.`);
    } catch (e) { setErro(e?.message || 'Erro ao importar Lotação.'); }
  }

  // ── aprovação ──
  function abrirModalAprovacao(tabela) {
    setModalAprovacao(tabela);
    setAprovacao({ data_inicio_vigencia: hojeISO(), substituir_tabela_anterior: false, justificativa_aprovacao: '' });
  }

  async function confirmarAprovacao() {
    if (!modalAprovacao?.id) return;
    if (!aprovacao.justificativa_aprovacao.trim()) return setErro('Informe uma justificativa.');
    setSalvando(true); setErro(''); setSucesso('');
    try {
      const at = await aprovarTabelaNegociacao(modalAprovacao.id, aprovacao);
      setTabelas((p) => p.map((i) => (i.id === at.id ? at : i)));
      if (selecionada?.id === at.id) setSelecionada(at);
      setModalAprovacao(null);
      setSucesso('Tabela aprovada. Promoção para oficial será feita na próxima etapa.');
    } catch (e) { setErro(e.message || 'Erro ao aprovar.'); }
    finally { setSalvando(false); }
  }

  const styBtn = (active) => ({
    padding: '8px 16px', borderRadius: 8, border: '2px solid',
    borderColor: active ? '#3b82f6' : '#e2e8f0',
    background: active ? '#eff6ff' : '#fff',
    color: active ? '#1d4ed8' : '#374151',
    fontWeight: active ? 700 : 400, cursor: 'pointer', transition: 'all 0.15s',
  });

  return (
    <div className="simulador-shell">
      <div className="simulador-header compact-top">
        <div className="simulador-subtitulo">Central Fretes • Negociações</div>
        <h1>Tabelas em Negociação</h1>
        <p>Cadastre tabelas temporárias, simule aderência e promova para o cadastro oficial após aprovação.</p>
      </div>

      {erro ? <div className="sim-alert error">{erro}</div> : null}
      {sucesso ? <div className="sim-alert success">{sucesso}</div> : null}

      <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <div className="summary-card"><span>Total</span><strong>{resumo.total}</strong><small>em negociação</small></div>
        <div className="summary-card"><span>Em simulação</span><strong>{resumo.emSimulacao}</strong><small>entram no simulador</small></div>
        <div className="summary-card"><span>Em teste</span><strong>{resumo.emTeste}</strong><small>em análise</small></div>
        <div className="summary-card"><span>Aprovadas</span><strong>{resumo.aprovadas}</strong><small>aguardando promoção</small></div>
        <div className="summary-card"><span>Fracionado</span><strong>{resumo.fracionado}</strong><small>Atacado/B2C</small></div>
        <div className="summary-card"><span>Lotação</span><strong>{resumo.lotacao}</strong><small>lotação</small></div>
      </div>

      <section className="sim-card">
        <h2>Nova tabela em negociação</h2>
        <div className="sim-form-grid sim-grid-5">
          <label>Transportadora<input value={form.transportadora} onChange={(e) => setForm((p) => ({ ...p, transportadora: e.target.value }))} placeholder="Ex: JADLOG" /></label>
          <label>Canal<select value={form.canal} onChange={(e) => setForm((p) => ({ ...p, canal: e.target.value }))}>{CANAIS.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label>Tipo<select value={form.tipo_tabela} onChange={(e) => setForm((p) => ({ ...p, tipo_tabela: e.target.value }))}>{TIPOS_TABELA_NEGOCIACAO.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label>Status<select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}>{STATUS_TABELA_NEGOCIACAO.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label>Data recebimento<input type="date" value={form.data_recebimento} onChange={(e) => setForm((p) => ({ ...p, data_recebimento: e.target.value }))} /></label>
        </div>
        <div className="sim-form-grid sim-grid-5" style={{ marginTop: 12 }}>
          <label>Origem<input value={form.origem} onChange={(e) => setForm((p) => ({ ...p, origem: e.target.value }))} placeholder="Ex: Itajaí" /></label>
          <label>UF origem<select value={form.uf_origem} onChange={(e) => setForm((p) => ({ ...p, uf_origem: e.target.value }))}>{UF_OPTIONS.map((uf) => <option key={uf||'t'} value={uf}>{uf||'Todas'}</option>)}</select></label>
          <label>UF destino<select value={form.uf_destino} onChange={(e) => setForm((p) => ({ ...p, uf_destino: e.target.value }))}>{UF_OPTIONS.map((uf) => <option key={uf||'t'} value={uf}>{uf||'Todas'}</option>)}</select></label>
          <label>Início previsto<input type="date" value={form.data_inicio_prevista} onChange={(e) => setForm((p) => ({ ...p, data_inicio_prevista: e.target.value }))} /></label>
          <label className="sim-flag" style={{ justifyContent: 'end' }}><input type="checkbox" checked={form.incluir_simulacao} onChange={(e) => setForm((p) => ({ ...p, incluir_simulacao: e.target.checked }))} />Incluir nas simulações</label>
        </div>
        <div className="sim-form-grid sim-grid-3" style={{ marginTop: 12 }}>
          <label>Descrição<input value={form.descricao} onChange={(e) => setForm((p) => ({ ...p, descricao: e.target.value }))} /></label>
          <label>Região<input value={form.regiao} onChange={(e) => setForm((p) => ({ ...p, regiao: e.target.value }))} placeholder="Ex: SP/MG/ES" /></label>
          <label>Observação<input value={form.observacao} onChange={(e) => setForm((p) => ({ ...p, observacao: e.target.value }))} /></label>
        </div>
        <div className="sim-actions" style={{ marginTop: 14 }}>
          <button className="primary" type="button" onClick={salvarNovaTabela} disabled={salvando}>{salvando ? 'Salvando...' : 'Criar tabela em negociação'}</button>
          <button className="sim-tab" type="button" onClick={() => setForm(FORM_VAZIO)}>Limpar</button>
        </div>
      </section>

      <section className="sim-card">
        <div className="sim-resultado-topo compact-top">
          <div><h2 style={{ margin: 0 }}>Tabelas cadastradas</h2></div>
          <button className="sim-tab" type="button" onClick={carregar} disabled={carregando}>{carregando ? 'Atualizando...' : 'Atualizar'}</button>
        </div>
        <div className="sim-form-grid sim-grid-4">
          <label>Status<select value={filtros.status} onChange={(e) => setFiltros((p) => ({ ...p, status: e.target.value }))}><option value="">Todos</option>{STATUS_TABELA_NEGOCIACAO.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label>Tipo<select value={filtros.tipoTabela} onChange={(e) => setFiltros((p) => ({ ...p, tipoTabela: e.target.value }))}><option value="">Todos</option>{TIPOS_TABELA_NEGOCIACAO.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label>Canal<select value={filtros.canal} onChange={(e) => setFiltros((p) => ({ ...p, canal: e.target.value }))}><option value="">Todos</option>{CANAIS.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label>Transportadora<input value={filtros.transportadora} onChange={(e) => setFiltros((p) => ({ ...p, transportadora: e.target.value }))} placeholder="Buscar" /></label>
        </div>
        <div className="sim-actions" style={{ marginTop: 12 }}>
          <button className="primary" type="button" onClick={carregar}>Filtrar</button>
          <button className="sim-tab" type="button" onClick={() => setFiltros({ status: '', tipoTabela: '', canal: '', transportadora: '' })}>Limpar filtros</button>
        </div>
        <div className="sim-analise-tabela-wrap" style={{ marginTop: 14 }}>
          <table className="sim-analise-tabela">
            <thead><tr><th>Transportadora</th><th>Canal</th><th>Tipo</th><th>Status</th><th>Recebimento</th><th>Simulação</th><th>Saving proj.</th><th>Aderência</th><th>Ações</th></tr></thead>
            <tbody>
              {tabelas.map((tabela) => (
                <tr key={tabela.id}>
                  <td>
                    <strong>{tabela.transportadora}</strong>
                    <BadgeImportacao tipo={tabela.origem_importacao} />
                    <div style={{ fontSize: 12, color: '#64748b' }}>{tabela.descricao || tabela.regiao || '-'}</div>
                  </td>
                  <td>{tabela.canal}</td><td>{tabela.tipo_tabela}</td>
                  <td><span style={{ ...statusStyle(tabela.status), borderRadius: 999, padding: '4px 8px', fontSize: 12, fontWeight: 700 }}>{tabela.status}</span></td>
                  <td>{tabela.data_recebimento || '-'}</td>
                  <td><button className="sim-tab" type="button" onClick={() => alternarSimulacao(tabela)}>{tabela.incluir_simulacao ? 'Sim' : 'Não'}</button></td>
                  <td>{formatMoney(tabela.saving_projetado)}</td>
                  <td>{formatPercent(tabela.aderencia_projetada)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="sim-tab" type="button" onClick={() => abrirTabela(tabela)}>Abrir</button>
                      <select value={tabela.status} onChange={(e) => atualizarStatus(tabela, e.target.value)}>{STATUS_TABELA_NEGOCIACAO.map((s) => <option key={s}>{s}</option>)}</select>
                      <button className="sim-tab" type="button" onClick={() => abrirModalAprovacao(tabela)}>Aprovar</button>
                      <button className="sim-tab" type="button" onClick={() => excluirTabela(tabela)}>Excluir</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!tabelas.length && <tr><td colSpan="9">Nenhuma tabela encontrada.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {selecionada && (
        <section className="sim-card">
          <div className="sim-resultado-topo compact-top">
            <div>
              <h2 style={{ margin: 0 }}>
                Importar: {selecionada.transportadora}
                <BadgeImportacao tipo={selecionada.origem_importacao} />
              </h2>
              <p>{selecionada.tipo_tabela} · {selecionada.canal} · {selecionada.status}</p>
            </div>
            <button className="sim-tab" type="button" onClick={() => abrirTabela(selecionada)}>Recarregar itens</button>
          </div>

          {/* seletor de tipo */}
          <div className="sim-parametros-box" style={{ marginBottom: 20 }}>
            <div className="sim-parametros-header"><div><strong>Tipo de importação</strong><p>Escolha o modelo de acordo com o arquivo recebido da transportadora.</p></div></div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
              {TIPOS_IMPORTACAO.map((tipo) => (
                <button key={tipo.value} type="button" style={styBtn(tipoImportacao === tipo.value)}
                  onClick={() => { setTipoImportacao(tipo.value); setErro(''); setSucesso(''); limparImport(); }}>
                  {tipo.label}
                </button>
              ))}
            </div>
          </div>

          {/* ═══ VERUM ═══ */}
          {tipoImportacao === 'VERUM_ROTAS_FRETES' && (
            <>
              <div className="sim-alert info">Usa o motor da tela <strong>Importar Template</strong>: dois arquivos separados (Rotas e Fretes).</div>
              <div className="sim-parametros-box">
                <div className="sim-parametros-header"><div><strong>Modelos oficiais</strong></div></div>
                <div className="sim-actions" style={{ marginTop: 12 }}>
                  <button className="sim-tab" type="button" onClick={baixarModeloTemplateRotas}>Baixar modelo de Rotas</button>
                  <button className="sim-tab" type="button" onClick={baixarModeloTemplateFretes}>Baixar modelo de Fretes</button>
                </div>
              </div>
              <div className="sim-form-grid sim-grid-4" style={{ marginTop: 14 }}>
                <label>Início vigência<input type="date" value={inicioVigencia} onChange={(e) => setInicioVigencia(e.target.value)} /></label>
                <label>Fim vigência<input type="date" value={fimVigencia} onChange={(e) => setFimVigencia(e.target.value)} /></label>
                <label>Arquivo de Rotas<input type="file" accept=".xlsx,.xls,.xlsb,.csv" onChange={(e) => setArquivoRotas(e.target.files?.[0] || null)} /></label>
                <label>Arquivo de Fretes<input type="file" accept=".xlsx,.xls,.xlsb,.csv" onChange={(e) => setArquivoFretes(e.target.files?.[0] || null)} /></label>
              </div>
              <div className="sim-actions" style={{ marginTop: 12 }}>
                <button className="primary" type="button" onClick={processarVerum}>Ler template</button>
                <button className="sim-tab" type="button" onClick={formatarVerum} disabled={!resultadoTemplate}>Formatar no padrão do sistema</button>
                <button className="sim-tab" type="button" onClick={() => setMostrarPreview((p) => !p)} disabled={!formatado}>{mostrarPreview ? 'Recolher' : 'Visualizar tabela'}</button>
                <button className="sim-tab" type="button" onClick={() => exportarXlsx(formatado?.linhasExportacao, `fretes-negoc-${normalizarTexto(selecionada?.transportadora || 'transp')}.xlsx`, 'Fretes')} disabled={!formatado}>Baixar fretes</button>
                <button className="primary" type="button" onClick={() => salvarItens(montarItensVerum(formatado), 'VERUM_ROTAS_FRETES')} disabled={!formatado || salvando}>{salvando ? 'Salvando...' : 'Salvar na negociação'}</button>
              </div>
              {resultadoTemplate && (
                <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginTop: 14 }}>
                  <div className="summary-card"><span>Rotas lidas</span><strong>{resultadoTemplate.rotas.length}</strong></div>
                  <div className="summary-card"><span>Quebras</span><strong>{resultadoTemplate.quebrasFaixa.length}</strong></div>
                  <div className="summary-card"><span>Fretes lidos</span><strong>{resultadoTemplate.fretes.length}</strong></div>
                </div>
              )}
              {formatado && mostrarPreview && (
                <div className="sim-parametros-box" style={{ marginTop: 14 }}>
                  <div className="sim-parametros-header"><div><strong>Revisão</strong><p>{formatado.rotas.length} rota(s) e {formatado.cotacoes.length} cotação(ões).</p></div></div>
                  <div className="sim-analise-tabela-wrap" style={{ marginTop: 12 }}>
                    <table className="sim-analise-tabela">
                      <thead><tr><th>Rota</th><th>Origem</th><th>UF dest</th><th>Faixa</th><th>Taxa</th><th>% NF</th><th>Mín</th></tr></thead>
                      <tbody>
                        {formatado.cotacoes.slice(0, 100).map((item) => (
                          <tr key={item.id}><td>{item.rota}</td><td>{item.origem}</td><td>{item.ufDestino}</td><td>{item.faixaPeso}</td><td>{numeroOuVazio(item.taxaAplicada)}</td><td>{numeroOuVazio(item.percentual)}</td><td>{numeroOuVazio(item.freteMinimo)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {formatado.cotacoes.length > 100 && <div className="empty-note">Primeiras 100 linhas.</div>}
                </div>
              )}
            </>
          )}

          {/* ═══ CANTU ═══ */}
          {tipoImportacao === 'CANTU_MODELO_UNICO' && (
            <>
              <div className="sim-alert info">
                Importa o template da transportadora formato Cantu. O sistema lê automaticamente as abas <strong>FICHA DE CADASTRO</strong> e <strong>TABELA</strong>.
              </div>
              <div className="sim-form-grid sim-grid-4" style={{ marginTop: 14 }}>
                <label>
                  Subtipo do modelo
                  <select value={subtipoCantu} onChange={(e) => { setSubtipoCantu(e.target.value); setResultadoCantu(null); }}>
                    {SUBTIPOS_CANTU.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </label>
                <label>Início vigência<input type="date" value={inicioVigencia} onChange={(e) => setInicioVigencia(e.target.value)} /></label>
                <label>Fim vigência<input type="date" value={fimVigencia} onChange={(e) => setFimVigencia(e.target.value)} /></label>
                <label>Arquivo Cantu (arquivo único)<input type="file" accept=".xlsx,.xls,.xlsb" onChange={(e) => { setArquivoCantu(e.target.files?.[0] || null); setResultadoCantu(null); }} /></label>
              </div>
              <div className="sim-actions" style={{ marginTop: 12 }}>
                <button className="primary" type="button" onClick={processarCantu} disabled={!arquivoCantu}>Ler modelo Cantu</button>
                <button className="sim-tab" type="button" onClick={() => exportarXlsx(resultadoCantu?.itens?.map((i) => ({ 'UF Destino': i.uf_destino, 'Faixa/Região': i.faixa_peso, 'Peso Ini': i.peso_inicial, 'Peso Fim': i.peso_final, 'Taxa': i.taxa_aplicada, '% NF': i.frete_percentual, 'Mín': i.frete_minimo, 'Prazo': i.prazo })), `cantu-prev-${normalizarTexto(selecionada?.transportadora || 'transp')}.xlsx`, 'Prévia')} disabled={!resultadoCantu}>Exportar prévia</button>
                <button className="primary" type="button" onClick={() => salvarItens(resultadoCantu?.itens || [], 'CANTU_MODELO_UNICO', { canal: resultadoCantu?.meta?.canal })} disabled={!resultadoCantu || salvando}>{salvando ? 'Salvando...' : 'Salvar na negociação'}</button>
              </div>
              {resultadoCantu && (
                <>
                  <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginTop: 14 }}>
                    <div className="summary-card"><span>Itens extraídos</span><strong>{resultadoCantu.meta.totalItens}</strong></div>
                    <div className="summary-card"><span>Canal</span><strong>{resultadoCantu.meta.canal}</strong></div>
                    <div className="summary-card"><span>Subtipo</span><strong>{subtipoCantu.replace('_', ' ')}</strong></div>
                    <div className="summary-card"><span>Ficha lida</span><strong>{resultadoCantu.meta.fichaLida ? 'Sim' : 'Não'}</strong></div>
                    {resultadoCantu.ficha?.transportadora && <div className="summary-card"><span>Transportadora</span><strong>{resultadoCantu.ficha.transportadora}</strong></div>}
                  </div>
                  <div className="sim-parametros-box" style={{ marginTop: 14 }}>
                    <div className="sim-parametros-header"><div><strong>Prévia dos itens</strong></div></div>
                    <div className="sim-analise-tabela-wrap" style={{ marginTop: 12 }}>
                      <table className="sim-analise-tabela">
                        <thead><tr><th>UF Dest</th><th>Faixa / Região</th><th>Peso Ini</th><th>Peso Fim</th><th>Taxa/Frete</th><th>% NF</th><th>Frete Mín</th><th>GRIS</th><th>ADV</th><th>Prazo</th></tr></thead>
                        <tbody>
                          {resultadoCantu.itens.slice(0, 150).map((item, i) => (
                            <tr key={i}>
                              <td><strong>{item.uf_destino}</strong></td><td>{item.faixa_peso}</td>
                              <td>{item.peso_inicial}</td><td>{item.peso_final >= 999990 ? '∞' : item.peso_final}</td>
                              <td>{formatMoney(item.taxa_aplicada)}</td><td>{Number(item.frete_percentual || 0).toFixed(4)}%</td>
                              <td>{formatMoney(item.frete_minimo)}</td><td>{Number(item.gris || 0).toFixed(4)}%</td>
                              <td>{Number(item.advalorem || 0).toFixed(4)}%</td><td>{item.prazo || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {resultadoCantu.itens.length > 150 && <div className="empty-note">Mostrando 150 de {resultadoCantu.itens.length} itens.</div>}
                  </div>
                </>
              )}
            </>
          )}

          {/* ═══ LOTAÇÃO ═══ */}
          {tipoImportacao === 'LOTACAO_TRANSPORTADORA' && (
            <>
              <div className="sim-alert info">
                Importa modelo de Lotação. Aba esperada: <strong>MODELO TRANSPORTADORA</strong>. Colunas: Transportadora · Origem · UF ORIGEM · Destino · UF DESTINO · KM · TIPO · TARGET · ICMS · Pedágio.
              </div>
              <div className="sim-parametros-box">
                <div className="sim-parametros-header"><div><strong>Modelo oficial de Lotação</strong></div></div>
                <div className="sim-actions" style={{ marginTop: 12 }}>
                  <button className="sim-tab" type="button" onClick={baixarModeloLotacao}>Baixar modelo de Lotação (.xlsx)</button>
                </div>
              </div>
              <div className="sim-form-grid sim-grid-3" style={{ marginTop: 14 }}>
                <label>Início vigência<input type="date" value={inicioVigencia} onChange={(e) => setInicioVigencia(e.target.value)} /></label>
                <label>Fim vigência<input type="date" value={fimVigencia} onChange={(e) => setFimVigencia(e.target.value)} /></label>
                <label>Arquivo de Lotação<input type="file" accept=".xlsx,.xls,.xlsb" onChange={(e) => { setArquivoLotacao(e.target.files?.[0] || null); setResultadoLotacao(null); }} /></label>
              </div>
              <div className="sim-actions" style={{ marginTop: 12 }}>
                <button className="primary" type="button" onClick={processarLotacao} disabled={!arquivoLotacao}>Ler modelo de Lotação</button>
                <button className="sim-tab" type="button" onClick={() => exportarXlsx(resultadoLotacao?.itens?.map((i) => ({ 'Origem': i.cidade_origem, 'UF Orig': i.uf_origem, 'Destino': i.cidade_destino, 'UF Dest': i.uf_destino, 'KM': i.km, 'Tipo': i.tipo_veiculo, 'Target': i.valor_lotacao, 'ICMS': i.icms, 'Pedágio': i.pedagio, 'Prazo': i.prazo })), `lotacao-prev-${normalizarTexto(selecionada?.transportadora || 'transp')}.xlsx`, 'Lotação')} disabled={!resultadoLotacao}>Exportar prévia</button>
                <button className="primary" type="button" onClick={() => salvarItens(resultadoLotacao?.itens || [], 'LOTACAO_TRANSPORTADORA', { tipo_tabela: 'LOTACAO', canal: 'LOTACAO' })} disabled={!resultadoLotacao || salvando}>{salvando ? 'Salvando...' : 'Salvar na negociação'}</button>
              </div>
              {resultadoLotacao && (
                <>
                  <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginTop: 14 }}>
                    <div className="summary-card"><span>Rotas extraídas</span><strong>{resultadoLotacao.meta.totalItens}</strong></div>
                    <div className="summary-card"><span>Tipo</span><strong>LOTAÇÃO</strong></div>
                    <div className="summary-card"><span>Abas</span><strong>{resultadoLotacao.meta.abasEncontradas?.length}</strong></div>
                  </div>
                  <div className="sim-parametros-box" style={{ marginTop: 14 }}>
                    <div className="sim-parametros-header"><div><strong>Prévia das rotas de lotação</strong></div></div>
                    <div className="sim-analise-tabela-wrap" style={{ marginTop: 12 }}>
                      <table className="sim-analise-tabela">
                        <thead><tr><th>Origem</th><th>UF Orig</th><th>Destino</th><th>UF Dest</th><th>KM</th><th>Tipo Veículo</th><th>Target</th><th>ICMS</th><th>Pedágio</th><th>Prazo</th></tr></thead>
                        <tbody>
                          {resultadoLotacao.itens.slice(0, 200).map((item, i) => (
                            <tr key={i}>
                              <td>{item.cidade_origem}</td><td>{item.uf_origem}</td>
                              <td>{item.cidade_destino}</td><td>{item.uf_destino}</td>
                              <td>{item.km}</td><td>{item.tipo_veiculo || '-'}</td>
                              <td>{formatMoney(item.valor_lotacao)}</td>
                              <td>{Number(item.icms || 0).toFixed(2)}%</td>
                              <td>{formatMoney(item.pedagio)}</td><td>{item.prazo || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {resultadoLotacao.itens.length > 200 && <div className="empty-note">Mostrando 200 de {resultadoLotacao.itens.length} rotas.</div>}
                  </div>
                </>
              )}
            </>
          )}

          {/* itens salvos */}
          <div style={{ marginTop: 24, borderTop: '1px solid #e2e8f0', paddingTop: 20 }}>
            <h3 style={{ margin: '0 0 12px' }}>Itens salvos nesta negociação</h3>
            <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginBottom: 14 }}>
              <div className="summary-card"><span>Total</span><strong>{itensSelecionada.length}</strong></div>
              <div className="summary-card"><span>Rotas</span><strong>{resumoItens.rotas}</strong></div>
              <div className="summary-card"><span>Cotações/Faixas</span><strong>{resumoItens.cotacoes}</strong></div>
              <div className="summary-card"><span>UF destino</span><strong>{resumoItens.ufs}</strong></div>
            </div>
            <div className="sim-analise-tabela-wrap">
              <table className="sim-analise-tabela">
                <thead><tr><th>Tipo</th><th>Origem</th><th>Destino</th><th>Faixa/Rota</th><th>Frete Mín</th><th>Taxa</th><th>% NF</th><th>KM</th><th>Prazo</th></tr></thead>
                <tbody>
                  {itensSelecionada.slice(0, 120).map((item) => (
                    <tr key={item.id}>
                      <td>{getTipoItem(item)}</td>
                      <td>{item.cidade_origem}/{item.uf_origem}</td>
                      <td>{item.cidade_destino ? `${item.cidade_destino}/${item.uf_destino}` : item.uf_destino}</td>
                      <td>{item.faixa_peso || '-'}</td>
                      <td>{formatMoney(item.frete_minimo)}</td>
                      <td>{formatMoney(item.taxa_aplicada)}</td>
                      <td>{Number(item.frete_percentual || 0).toFixed(4)}</td>
                      <td>{item.km || '-'}</td>
                      <td>{item.prazo || '-'}</td>
                    </tr>
                  ))}
                  {!itensSelecionada.length && <tr><td colSpan="9">Nenhum item salvo ainda.</td></tr>}
                </tbody>
              </table>
            </div>
            {itensSelecionada.length > 120 && <div className="empty-note">Mostrando 120 de {itensSelecionada.length} itens.</div>}
          </div>
        </section>
      )}

      {modalAprovacao && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 9999, display: 'grid', placeItems: 'center', padding: 20 }}>
          <div className="sim-card" style={{ width: 'min(720px,100%)', maxHeight: '90vh', overflow: 'auto' }}>
            <h2>Aprovar tabela</h2>
            <p>A tabela de <strong>{modalAprovacao.transportadora}</strong> será marcada como aprovada.</p>
            <div className="sim-form-grid sim-grid-2">
              <label>Data início de vigência<input type="date" value={aprovacao.data_inicio_vigencia} onChange={(e) => setAprovacao((p) => ({ ...p, data_inicio_vigencia: e.target.value }))} /></label>
              <label className="sim-flag" style={{ justifyContent: 'end' }}><input type="checkbox" checked={aprovacao.substituir_tabela_anterior} onChange={(e) => setAprovacao((p) => ({ ...p, substituir_tabela_anterior: e.target.checked }))} />Substitui tabela anterior</label>
            </div>
            <label style={{ marginTop: 12 }}>Justificativa<textarea value={aprovacao.justificativa_aprovacao} onChange={(e) => setAprovacao((p) => ({ ...p, justificativa_aprovacao: e.target.value }))} placeholder="Explique o motivo da aprovação..." style={{ minHeight: 100 }} /></label>
            <div className="sim-actions" style={{ marginTop: 14 }}>
              <button className="primary" type="button" onClick={confirmarAprovacao} disabled={salvando}>{salvando ? 'Aprovando...' : 'Confirmar aprovação'}</button>
              <button className="sim-tab" type="button" onClick={() => setModalAprovacao(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
