import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { importarTemplatePadraoSeparado } from '../utils/importadorTemplatePadrao';
import { baixarModeloTemplateFretes, baixarModeloTemplateRotas } from '../utils/modelosTemplateFormatacao';
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
const UF_OPTIONS = ['', 'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

function fimTresAnosISO() {
  const data = new Date();
  data.setFullYear(data.getFullYear() + 3);
  return data.toISOString().slice(0, 10);
}

function gerarId(prefixo) {
  if (globalThis.crypto?.randomUUID) return `${prefixo}-${globalThis.crypto.randomUUID()}`;
  return `${prefixo}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizarTexto(valor) {
  return String(valor ?? '').trim();
}

function numeroOuVazio(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : valor;
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function exportarXlsx(linhas, nomeArquivo, aba = 'Tabela formatada') {
  if (!linhas?.length) return;
  const ws = XLSX.utils.json_to_sheet(linhas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, aba);
  XLSX.writeFile(wb, nomeArquivo);
}

function montarLinhasFormatadas({ resultado, transportadora, canal, inicioVigencia, fimVigencia }) {
  const nomeTransportadora = normalizarTexto(transportadora);
  const canalFinal = normalizarTexto(canal || 'ATACADO').toUpperCase();

  const rotas = (resultado?.rotas || []).map((item) => ({
    id: gerarId('rota'),
    nomeRota: item.cotacaoFinal || item.cotacao || `${item.origem} - ${item.ufDestino} - ${item.cotacaoBase}`,
    ibgeOrigem: item.ibgeOrigem || '',
    cidadeOrigem: item.origem || '',
    ufOrigem: item.ufOrigem || '',
    ibgeDestino: item.ibgeDestino || '',
    cidadeDestino: item.cidadeDestino || '',
    ufDestino: item.ufDestino || '',
    canal: canalFinal,
    prazoEntregaDias: item.prazo || '',
    valorMinimoFrete: '',
    cotacaoBase: item.cotacaoBase || '',
    cotacaoFinal: item.cotacaoFinal || item.cotacao || '',
    inicioVigencia,
    fimVigencia,
  }));

  const cotacoes = (resultado?.fretes || []).map((item) => ({
    id: gerarId('cotacao'),
    rota: item.cotacaoFinal || item.cotacao || `${item.origem} - ${item.ufDestino} - ${item.cotacaoBase}`,
    origem: item.origem || '',
    ufOrigem: item.ufOrigem || '',
    ufDestino: item.ufDestino || '',
    cotacaoBase: item.cotacaoBase || '',
    faixaPeso: item.faixaPeso || '',
    pesoMin: item.pesoInicial ?? '',
    pesoMax: item.pesoFinal ?? '',
    valorFixo: item.taxaAplicada ?? item.freteValor ?? '',
    taxaAplicada: item.taxaAplicada ?? item.freteValor ?? '',
    excesso: item.excedente ?? '',
    percentual: item.fretePercentual ?? '',
    freteMinimo: item.freteMinimo ?? '',
    regraCalculo: 'FAIXA_DE_PESO',
    tipoCalculo: 'FAIXA_DE_PESO',
    canal: canalFinal,
    inicioVigencia,
    fimVigencia,
  }));

  const linhasExportacao = cotacoes.map((item) => ({
    'Nome da transportadora': nomeTransportadora,
    'Código da unidade': item.origem || '',
    'Canal': canalFinal,
    'Regra de cálculo': item.regraCalculo,
    'Tipo de cálculo': item.tipoCalculo,
    'Rota do frete': item.rota,
    'Peso mínimo': numeroOuVazio(item.pesoMin),
    'Peso limite': numeroOuVazio(item.pesoMax),
    'Excesso de peso': numeroOuVazio(item.excesso),
    'Taxa aplicada': numeroOuVazio(item.taxaAplicada),
    'Frete percentual': numeroOuVazio(item.percentual),
    'Frete mínimo': numeroOuVazio(item.freteMinimo),
    'Início da vigência': inicioVigencia,
    'Fim da vigência': fimVigencia,
  }));

  const linhasRotas = rotas.map((item) => ({
    'NOME TRANSPORTADORA': nomeTransportadora,
    'CANAL': canalFinal,
    'NOME ROTA': item.nomeRota,
    'IBGE ORIGEM': item.ibgeOrigem,
    'CIDADE ORIGEM': item.cidadeOrigem,
    'UF ORIGEM': item.ufOrigem,
    'IBGE DESTINO': item.ibgeDestino,
    'CIDADE DESTINO': item.cidadeDestino,
    'UF DESTINO': item.ufDestino,
    'PRAZO': item.prazoEntregaDias,
    'DATA INÍCIO': inicioVigencia,
    'DATA FIM': fimVigencia,
  }));

  return { rotas, cotacoes, linhasExportacao, linhasRotas };
}

function montarItensNegociacao(formatado) {
  if (!formatado) return [];

  const rotasPorNome = new Map();
  (formatado.rotas || []).forEach((rota) => {
    [rota.nomeRota, rota.cotacaoFinal, `${rota.cidadeOrigem} - ${rota.ufDestino} - ${rota.cotacaoBase}`]
      .filter(Boolean)
      .forEach((chave) => rotasPorNome.set(String(chave), rota));
  });

  const itensRotas = (formatado.rotas || []).map((rota) => ({
    item_tipo: 'ROTA',
    cidade_origem: rota.cidadeOrigem || '',
    uf_origem: rota.ufOrigem || '',
    ibge_origem: rota.ibgeOrigem || '',
    cidade_destino: rota.cidadeDestino || '',
    uf_destino: rota.ufDestino || '',
    ibge_destino: rota.ibgeDestino || '',
    faixa_peso: 'ROTA',
    prazo: rota.prazoEntregaDias || 0,
    observacao: rota.nomeRota || '',
    dados_originais: { tipo_item: 'ROTA', ...rota },
  }));

  const itensCotacoes = (formatado.cotacoes || []).map((cotacao) => {
    const rota = rotasPorNome.get(String(cotacao.rota || '')) || null;
    return {
      item_tipo: 'COTACAO',
      cidade_origem: cotacao.origem || rota?.cidadeOrigem || '',
      uf_origem: cotacao.ufOrigem || rota?.ufOrigem || '',
      ibge_origem: rota?.ibgeOrigem || '',
      cidade_destino: rota?.cidadeDestino || '',
      uf_destino: cotacao.ufDestino || rota?.ufDestino || '',
      ibge_destino: rota?.ibgeDestino || '',
      faixa_peso: cotacao.faixaPeso || '',
      peso_inicial: cotacao.pesoMin ?? '',
      peso_final: cotacao.pesoMax ?? '',
      frete_minimo: cotacao.freteMinimo ?? '',
      taxa_aplicada: cotacao.taxaAplicada ?? '',
      frete_percentual: cotacao.percentual ?? '',
      excesso_kg: cotacao.excesso ?? '',
      prazo: rota?.prazoEntregaDias || '',
      observacao: cotacao.rota || '',
      dados_originais: { tipo_item: 'COTACAO', ...cotacao, rotaDetalhe: rota },
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

export default function TabelasNegociacaoPage() {
  const [tabelas, setTabelas] = useState([]);
  const [selecionada, setSelecionada] = useState(null);
  const [itensSelecionada, setItensSelecionada] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [filtros, setFiltros] = useState({ status: '', tipoTabela: '', canal: '', transportadora: '' });

  const [form, setForm] = useState({
    transportadora: '',
    canal: 'ATACADO',
    tipo_tabela: 'FRACIONADO',
    status: 'EM NEGOCIAÇÃO',
    descricao: '',
    regiao: '',
    origem: '',
    uf_origem: '',
    uf_destino: '',
    data_recebimento: hojeISO(),
    data_inicio_prevista: '',
    incluir_simulacao: false,
    observacao: '',
    saving_projetado: '',
    aderencia_projetada: '',
  });

  const [arquivoRotas, setArquivoRotas] = useState(null);
  const [arquivoFretes, setArquivoFretes] = useState(null);
  const [resultadoTemplate, setResultadoTemplate] = useState(null);
  const [formatado, setFormatado] = useState(null);
  const [mostrarPreview, setMostrarPreview] = useState(false);
  const [inicioVigencia, setInicioVigencia] = useState(hojeISO());
  const [fimVigencia, setFimVigencia] = useState(fimTresAnosISO());

  const [modalAprovacao, setModalAprovacao] = useState(null);
  const [aprovacao, setAprovacao] = useState({
    data_inicio_vigencia: hojeISO(),
    substituir_tabela_anterior: false,
    justificativa_aprovacao: '',
  });

  const resumo = useMemo(() => ({
    total: tabelas.length,
    emSimulacao: tabelas.filter((t) => t.incluir_simulacao).length,
    emTeste: tabelas.filter((t) => t.status === 'EM TESTE').length,
    aprovadas: tabelas.filter((t) => t.status === 'APROVADA').length,
    lotacao: tabelas.filter((t) => t.tipo_tabela === 'LOTACAO').length,
    fracionado: tabelas.filter((t) => t.tipo_tabela === 'FRACIONADO').length,
  }), [tabelas]);

  const resumoItens = useMemo(() => {
    const rotas = itensSelecionada.filter((item) => getTipoItem(item) === 'ROTA');
    const cotacoes = itensSelecionada.filter((item) => getTipoItem(item) !== 'ROTA');
    const destinos = new Set(rotas.map((item) => `${item.cidade_destino}/${item.uf_destino}`).filter((item) => item !== '/')).size;
    const ufs = new Set(rotas.map((item) => item.uf_destino).filter(Boolean)).size;
    return { rotas: rotas.length, cotacoes: cotacoes.length, destinos, ufs };
  }, [itensSelecionada]);

  async function carregar() {
    setCarregando(true);
    setErro('');
    try {
      const data = await listarTabelasNegociacao(filtros);
      setTabelas(data);
    } catch (error) {
      setErro(error.message || 'Erro ao carregar tabelas em negociação.');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function abrirTabela(tabela) {
    setSelecionada(tabela);
    setResultadoTemplate(null);
    setFormatado(null);
    setMostrarPreview(false);
    setErro('');
    setSucesso('');
    try {
      const itens = await listarItensTabelaNegociacao(tabela.id);
      setItensSelecionada(itens);
      setInicioVigencia(tabela.data_inicio_prevista || hojeISO());
      setFimVigencia(fimTresAnosISO());
    } catch (error) {
      setErro(error.message || 'Erro ao abrir itens da tabela.');
    }
  }

  function limparForm() {
    setForm({
      transportadora: '',
      canal: 'ATACADO',
      tipo_tabela: 'FRACIONADO',
      status: 'EM NEGOCIAÇÃO',
      descricao: '',
      regiao: '',
      origem: '',
      uf_origem: '',
      uf_destino: '',
      data_recebimento: hojeISO(),
      data_inicio_prevista: '',
      incluir_simulacao: false,
      observacao: '',
      saving_projetado: '',
      aderencia_projetada: '',
    });
  }

  async function salvarNovaTabela() {
    setSalvando(true);
    setErro('');
    setSucesso('');
    try {
      const nova = await criarTabelaNegociacao(form);
      setSucesso('Tabela em negociação criada com sucesso.');
      limparForm();
      await carregar();
      await abrirTabela(nova);
    } catch (error) {
      setErro(error.message || 'Erro ao salvar tabela.');
    } finally {
      setSalvando(false);
    }
  }

  async function alternarSimulacao(tabela) {
    setErro('');
    setSucesso('');
    try {
      const atualizada = await alternarTabelaNegociacaoNaSimulacao(tabela.id, !tabela.incluir_simulacao);
      setTabelas((prev) => prev.map((item) => (item.id === tabela.id ? atualizada : item)));
      if (selecionada?.id === tabela.id) setSelecionada(atualizada);
      setSucesso(atualizada.incluir_simulacao ? 'Tabela marcada para participar das simulações.' : 'Tabela removida das simulações.');
    } catch (error) {
      setErro(error.message || 'Erro ao alterar participação na simulação.');
    }
  }

  async function atualizarStatus(tabela, status) {
    setErro('');
    setSucesso('');
    try {
      const atualizada = await atualizarTabelaNegociacao(tabela.id, { status });
      setTabelas((prev) => prev.map((item) => (item.id === tabela.id ? atualizada : item)));
      if (selecionada?.id === tabela.id) setSelecionada(atualizada);
      setSucesso('Status atualizado.');
    } catch (error) {
      setErro(error.message || 'Erro ao atualizar status.');
    }
  }

  async function processarTemplate() {
    if (!selecionada?.id) return setErro('Crie e abra uma tabela em negociação antes de importar os arquivos.');
    setErro('');
    setSucesso('');
    setResultadoTemplate(null);
    setFormatado(null);
    setMostrarPreview(false);
    try {
      const convertido = await importarTemplatePadraoSeparado({ arquivoRotas, arquivoFretes });
      setResultadoTemplate(convertido);
      setSucesso(`Template lido com sucesso: ${convertido.rotas.length} rota(s), ${convertido.quebrasFaixa.length} quebra(s) e ${convertido.fretes.length} frete(s). Agora clique em Formatar no padrão do sistema.`);
    } catch (error) {
      setErro(error?.message || 'Não foi possível importar o template.');
    }
  }

  function formatarParaSistema() {
    if (!selecionada?.id) return setErro('Selecione uma tabela em negociação.');
    if (!resultadoTemplate) return setErro('Leia o template antes de formatar.');
    const linhas = montarLinhasFormatadas({
      resultado: resultadoTemplate,
      transportadora: selecionada.transportadora,
      canal: selecionada.canal,
      inicioVigencia,
      fimVigencia,
    });
    setFormatado(linhas);
    setMostrarPreview(true);
    setSucesso(`Tabela formatada no padrão oficial: ${linhas.rotas.length} rota(s) e ${linhas.cotacoes.length} cotação(ões). Revise e salve na negociação.`);
  }

  function baixarTabelaFormatada() {
    if (!formatado) return formatarParaSistema();
    return exportarXlsx(formatado.linhasExportacao, `fretes-negociacao-${normalizarTexto(selecionada?.transportadora || 'transportadora')}.xlsx`, 'Fretes');
  }

  function baixarRotasFormatadas() {
    if (!formatado) return formatarParaSistema();
    return exportarXlsx(formatado.linhasRotas, `rotas-negociacao-${normalizarTexto(selecionada?.transportadora || 'transportadora')}.xlsx`, 'Rotas');
  }

  async function salvarTemplateNaNegociacao() {
    if (!selecionada?.id) return setErro('Selecione uma tabela em negociação.');
    if (!formatado) return setErro('Formate o template antes de salvar.');
    const itens = montarItensNegociacao(formatado);
    if (!itens.length) return setErro('Não há itens formatados para salvar.');

    setSalvando(true);
    setErro('');
    setSucesso('');
    try {
      const salvos = await substituirItensTabelaNegociacao(selecionada, itens);
      const atualizada = await atualizarTabelaNegociacao(selecionada.id, {
        data_inicio_prevista: inicioVigencia,
        status: selecionada.status === 'EM NEGOCIAÇÃO' ? 'EM TESTE' : selecionada.status,
      });
      setSelecionada(atualizada);
      setTabelas((prev) => prev.map((item) => (item.id === atualizada.id ? atualizada : item)));
      setItensSelecionada(salvos);
      setSucesso(`${salvos.length} item(ns) salvos na negociação usando o modelo oficial do sistema.`);
    } catch (error) {
      setErro(error.message || 'Erro ao salvar itens da negociação.');
    } finally {
      setSalvando(false);
    }
  }

  async function excluirTabela(tabela) {
    const confirmar = window.confirm(`Excluir a tabela em negociação de ${tabela.transportadora}?`);
    if (!confirmar) return;
    setErro('');
    setSucesso('');
    try {
      await excluirTabelaNegociacao(tabela.id);
      if (selecionada?.id === tabela.id) {
        setSelecionada(null);
        setItensSelecionada([]);
      }
      await carregar();
      setSucesso('Tabela excluída.');
    } catch (error) {
      setErro(error.message || 'Erro ao excluir tabela.');
    }
  }

  function abrirModalAprovacao(tabela) {
    setModalAprovacao(tabela);
    setAprovacao({
      data_inicio_vigencia: hojeISO(),
      substituir_tabela_anterior: false,
      justificativa_aprovacao: '',
    });
  }

  async function confirmarAprovacao() {
    if (!modalAprovacao?.id) return;
    if (!aprovacao.justificativa_aprovacao.trim()) return setErro('Informe uma justificativa para aprovar a tabela.');
    setSalvando(true);
    setErro('');
    setSucesso('');
    try {
      const atualizada = await aprovarTabelaNegociacao(modalAprovacao.id, aprovacao);
      setTabelas((prev) => prev.map((item) => (item.id === atualizada.id ? atualizada : item)));
      if (selecionada?.id === atualizada.id) setSelecionada(atualizada);
      setModalAprovacao(null);
      setSucesso('Tabela aprovada. A promoção para cadastro oficial será feita na próxima etapa.');
    } catch (error) {
      setErro(error.message || 'Erro ao aprovar tabela.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="simulador-shell">
      <div className="simulador-header compact-top">
        <div className="simulador-subtitulo">Central Fretes • Negociações</div>
        <h1>Tabelas em Negociação</h1>
        <p>Cadastre tabelas temporárias usando o mesmo template oficial de Rotas e Fretes, simule aderência e só promova para o cadastro oficial depois da aprovação.</p>
      </div>

      {erro ? <div className="sim-alert error">{erro}</div> : null}
      {sucesso ? <div className="sim-alert success">{sucesso}</div> : null}

      <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <div className="summary-card"><span>Total</span><strong>{resumo.total}</strong><small>tabelas em negociação</small></div>
        <div className="summary-card"><span>Em simulação</span><strong>{resumo.emSimulacao}</strong><small>podem entrar no simulador</small></div>
        <div className="summary-card"><span>Em teste</span><strong>{resumo.emTeste}</strong><small>em análise operacional</small></div>
        <div className="summary-card"><span>Aprovadas</span><strong>{resumo.aprovadas}</strong><small>aguardando promoção oficial</small></div>
        <div className="summary-card"><span>Fracionado</span><strong>{resumo.fracionado}</strong><small>Atacado/B2C</small></div>
        <div className="summary-card"><span>Lotação</span><strong>{resumo.lotacao}</strong><small>tabelas de lotação</small></div>
      </div>

      <section className="sim-card">
        <h2>Nova tabela em negociação</h2>
        <div className="sim-form-grid sim-grid-5">
          <label>Transportadora<input value={form.transportadora} onChange={(e) => setForm((prev) => ({ ...prev, transportadora: e.target.value }))} placeholder="Ex: JADLOG" /></label>
          <label>Canal<select value={form.canal} onChange={(e) => setForm((prev) => ({ ...prev, canal: e.target.value }))}>{CANAIS.map((canal) => <option key={canal} value={canal}>{canal}</option>)}</select></label>
          <label>Tipo de tabela<select value={form.tipo_tabela} onChange={(e) => setForm((prev) => ({ ...prev, tipo_tabela: e.target.value }))}>{TIPOS_TABELA_NEGOCIACAO.map((tipo) => <option key={tipo} value={tipo}>{tipo}</option>)}</select></label>
          <label>Status<select value={form.status} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}>{STATUS_TABELA_NEGOCIACAO.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
          <label>Data recebimento<input type="date" value={form.data_recebimento} onChange={(e) => setForm((prev) => ({ ...prev, data_recebimento: e.target.value }))} /></label>
        </div>

        <div className="sim-form-grid sim-grid-5" style={{ marginTop: 12 }}>
          <label>Origem<input value={form.origem} onChange={(e) => setForm((prev) => ({ ...prev, origem: e.target.value }))} placeholder="Ex: Itajaí" /></label>
          <label>UF origem<select value={form.uf_origem} onChange={(e) => setForm((prev) => ({ ...prev, uf_origem: e.target.value }))}>{UF_OPTIONS.map((uf) => <option key={uf || 'todas'} value={uf}>{uf || 'Todas'}</option>)}</select></label>
          <label>UF destino<select value={form.uf_destino} onChange={(e) => setForm((prev) => ({ ...prev, uf_destino: e.target.value }))}>{UF_OPTIONS.map((uf) => <option key={uf || 'todas'} value={uf}>{uf || 'Todas'}</option>)}</select></label>
          <label>Início previsto<input type="date" value={form.data_inicio_prevista} onChange={(e) => setForm((prev) => ({ ...prev, data_inicio_prevista: e.target.value }))} /></label>
          <label className="sim-flag" style={{ justifyContent: 'end' }}><input type="checkbox" checked={form.incluir_simulacao} onChange={(e) => setForm((prev) => ({ ...prev, incluir_simulacao: e.target.checked }))} />Incluir nas simulações</label>
        </div>

        <div className="sim-form-grid sim-grid-3" style={{ marginTop: 12 }}>
          <label>Descrição<input value={form.descricao} onChange={(e) => setForm((prev) => ({ ...prev, descricao: e.target.value }))} placeholder="Ex: Tabela recebida para Sudeste" /></label>
          <label>Região<input value={form.regiao} onChange={(e) => setForm((prev) => ({ ...prev, regiao: e.target.value }))} placeholder="Ex: SP/MG/ES" /></label>
          <label>Observação<input value={form.observacao} onChange={(e) => setForm((prev) => ({ ...prev, observacao: e.target.value }))} placeholder="Observações da negociação" /></label>
        </div>

        <div className="sim-actions" style={{ marginTop: 14 }}>
          <button className="primary" type="button" onClick={salvarNovaTabela} disabled={salvando}>{salvando ? 'Salvando...' : 'Criar tabela em negociação'}</button>
          <button className="sim-tab" type="button" onClick={limparForm}>Limpar</button>
        </div>
      </section>

      <section className="sim-card">
        <div className="sim-resultado-topo compact-top">
          <div><h2 style={{ margin: 0 }}>Tabelas cadastradas</h2><p>Controle quais tabelas estão em negociação, teste, aprovação e simulação.</p></div>
          <button className="sim-tab" type="button" onClick={carregar} disabled={carregando}>{carregando ? 'Atualizando...' : 'Atualizar'}</button>
        </div>

        <div className="sim-form-grid sim-grid-4">
          <label>Status<select value={filtros.status} onChange={(e) => setFiltros((prev) => ({ ...prev, status: e.target.value }))}><option value="">Todos</option>{STATUS_TABELA_NEGOCIACAO.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
          <label>Tipo<select value={filtros.tipoTabela} onChange={(e) => setFiltros((prev) => ({ ...prev, tipoTabela: e.target.value }))}><option value="">Todos</option>{TIPOS_TABELA_NEGOCIACAO.map((tipo) => <option key={tipo} value={tipo}>{tipo}</option>)}</select></label>
          <label>Canal<select value={filtros.canal} onChange={(e) => setFiltros((prev) => ({ ...prev, canal: e.target.value }))}><option value="">Todos</option>{CANAIS.map((canal) => <option key={canal} value={canal}>{canal}</option>)}</select></label>
          <label>Transportadora<input value={filtros.transportadora} onChange={(e) => setFiltros((prev) => ({ ...prev, transportadora: e.target.value }))} placeholder="Buscar transportadora" /></label>
        </div>

        <div className="sim-actions" style={{ marginTop: 12 }}>
          <button className="primary" type="button" onClick={carregar}>Filtrar</button>
          <button className="sim-tab" type="button" onClick={() => setFiltros({ status: '', tipoTabela: '', canal: '', transportadora: '' })}>Limpar filtros</button>
        </div>

        <div className="sim-analise-tabela-wrap" style={{ marginTop: 14 }}>
          <table className="sim-analise-tabela">
            <thead><tr><th>Transportadora</th><th>Canal</th><th>Tipo</th><th>Status</th><th>Recebimento</th><th>Simulação</th><th>Saving proj.</th><th>Aderência proj.</th><th>Ações</th></tr></thead>
            <tbody>
              {tabelas.map((tabela) => (
                <tr key={tabela.id}>
                  <td><strong>{tabela.transportadora}</strong><div style={{ fontSize: 12, color: '#64748b' }}>{tabela.descricao || tabela.regiao || '-'}</div></td>
                  <td>{tabela.canal}</td>
                  <td>{tabela.tipo_tabela}</td>
                  <td><span style={{ ...statusStyle(tabela.status), borderRadius: 999, padding: '4px 8px', fontSize: 12, fontWeight: 700 }}>{tabela.status}</span></td>
                  <td>{tabela.data_recebimento || '-'}</td>
                  <td><button className="sim-tab" type="button" onClick={() => alternarSimulacao(tabela)}>{tabela.incluir_simulacao ? 'Sim' : 'Não'}</button></td>
                  <td>{formatMoney(tabela.saving_projetado)}</td>
                  <td>{formatPercent(tabela.aderencia_projetada)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="sim-tab" type="button" onClick={() => abrirTabela(tabela)}>Abrir</button>
                      <select value={tabela.status} onChange={(e) => atualizarStatus(tabela, e.target.value)}>{STATUS_TABELA_NEGOCIACAO.map((status) => <option key={status} value={status}>{status}</option>)}</select>
                      <button className="sim-tab" type="button" onClick={() => abrirModalAprovacao(tabela)}>Aprovar</button>
                      <button className="sim-tab" type="button" onClick={() => excluirTabela(tabela)}>Excluir</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!tabelas.length && <tr><td colSpan="9">Nenhuma tabela em negociação encontrada.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {selecionada && (
        <section className="sim-card">
          <div className="sim-resultado-topo compact-top">
            <div>
              <h2 style={{ margin: 0 }}>Importar modelo oficial: {selecionada.transportadora}</h2>
              <p>{selecionada.tipo_tabela} · {selecionada.canal} · {selecionada.status} · {selecionada.incluir_simulacao ? ' participa das simulações' : ' fora das simulações'}</p>
            </div>
            <button className="sim-tab" type="button" onClick={() => abrirTabela(selecionada)}>Recarregar itens</button>
          </div>

          <div className="sim-alert info">Esta importação usa o mesmo motor da tela <strong>Importar Template</strong>: arquivo de Rotas + arquivo de Fretes. A diferença é que os dados ficam salvos em negociação, sem entrar no cadastro oficial.</div>

          <div className="sim-parametros-box">
            <div className="sim-parametros-header"><div><strong>Modelos oficiais</strong><p>Baixe e preencha os modelos já aceitos pelo sistema.</p></div></div>
            <div className="sim-actions" style={{ marginTop: 12 }}>
              <button className="sim-tab" type="button" onClick={baixarModeloTemplateRotas}>Baixar modelo de Rotas</button>
              <button className="sim-tab" type="button" onClick={baixarModeloTemplateFretes}>Baixar modelo de Fretes</button>
            </div>
          </div>

          <div className="sim-form-grid sim-grid-4" style={{ marginTop: 14 }}>
            <label>Início da vigência/teste<input type="date" value={inicioVigencia} onChange={(e) => setInicioVigencia(e.target.value)} /></label>
            <label>Fim da vigência/teste<input type="date" value={fimVigencia} onChange={(e) => setFimVigencia(e.target.value)} /></label>
            <label>Arquivo de Rotas<input type="file" accept=".xlsx,.xls,.xlsb,.csv" onChange={(e) => setArquivoRotas(e.target.files?.[0] || null)} /></label>
            <label>Arquivo de Fretes<input type="file" accept=".xlsx,.xls,.xlsb,.csv" onChange={(e) => setArquivoFretes(e.target.files?.[0] || null)} /></label>
          </div>

          <div className="sim-actions" style={{ marginTop: 12 }}>
            <button className="primary" type="button" onClick={processarTemplate}>Ler template</button>
            <button className="sim-tab" type="button" onClick={formatarParaSistema} disabled={!resultadoTemplate}>Formatar no padrão do sistema</button>
            <button className="sim-tab" type="button" onClick={() => setMostrarPreview((prev) => !prev)} disabled={!formatado}>{mostrarPreview ? 'Recolher revisão' : 'Visualizar tabela formatada'}</button>
            <button className="sim-tab" type="button" onClick={baixarRotasFormatadas} disabled={!formatado}>Baixar rotas formatadas</button>
            <button className="sim-tab" type="button" onClick={baixarTabelaFormatada} disabled={!formatado}>Baixar fretes formatados</button>
            <button className="primary" type="button" onClick={salvarTemplateNaNegociacao} disabled={!formatado || salvando}>{salvando ? 'Salvando...' : 'Salvar na negociação'}</button>
          </div>

          {resultadoTemplate && (
            <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginTop: 14 }}>
              <div className="summary-card"><span>Rotas lidas</span><strong>{resultadoTemplate.rotas.length}</strong><small>do arquivo de rotas</small></div>
              <div className="summary-card"><span>Quebras</span><strong>{resultadoTemplate.quebrasFaixa.length}</strong><small>faixas encontradas</small></div>
              <div className="summary-card"><span>Fretes lidos</span><strong>{resultadoTemplate.fretes.length}</strong><small>do arquivo de fretes</small></div>
              <div className="summary-card"><span>Status</span><strong>{selecionada.status}</strong><small>{selecionada.incluir_simulacao ? 'entra em simulação' : 'fora da simulação'}</small></div>
            </div>
          )}

          {formatado && mostrarPreview && (
            <div className="sim-parametros-box" style={{ marginTop: 14 }}>
              <div className="sim-parametros-header"><div><strong>Revisão da tabela formatada</strong><p>{formatado.rotas.length} rota(s) e {formatado.cotacoes.length} cotação(ões) no padrão oficial.</p></div></div>
              <div className="sim-analise-tabela-wrap" style={{ marginTop: 12 }}>
                <table className="sim-analise-tabela">
                  <thead><tr><th>Rota do frete</th><th>Origem</th><th>UF destino</th><th>Faixa</th><th>Peso mínimo</th><th>Peso limite</th><th>Taxa aplicada</th><th>Frete percentual</th><th>Frete mínimo</th><th>Vigência</th></tr></thead>
                  <tbody>
                    {formatado.cotacoes.slice(0, 100).map((item) => (
                      <tr key={item.id}>
                        <td>{item.rota}</td><td>{item.origem}</td><td>{item.ufDestino}</td><td>{item.faixaPeso}</td><td>{numeroOuVazio(item.pesoMin)}</td><td>{numeroOuVazio(item.pesoMax)}</td><td>{numeroOuVazio(item.taxaAplicada)}</td><td>{numeroOuVazio(item.percentual)}</td><td>{numeroOuVazio(item.freteMinimo)}</td><td>{inicioVigencia} até {fimVigencia}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {formatado.cotacoes.length > 100 && <div className="empty-note">Mostrando as primeiras 100 linhas para não deixar a tela pesada.</div>}
            </div>
          )}

          <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginTop: 14 }}>
            <div className="summary-card"><span>Itens salvos</span><strong>{itensSelecionada.length}</strong><small>rotas + cotações</small></div>
            <div className="summary-card"><span>Rotas salvas</span><strong>{resumoItens.rotas}</strong><small>linhas de rota</small></div>
            <div className="summary-card"><span>Cotações salvas</span><strong>{resumoItens.cotacoes}</strong><small>faixas/fretes</small></div>
            <div className="summary-card"><span>Destinos</span><strong>{resumoItens.destinos}</strong><small>cidades/UF</small></div>
            <div className="summary-card"><span>UF destino</span><strong>{resumoItens.ufs}</strong><small>UFs cobertas</small></div>
          </div>

          <div className="sim-analise-tabela-wrap" style={{ marginTop: 14 }}>
            <table className="sim-analise-tabela">
              <thead><tr><th>Tipo</th><th>Origem</th><th>Destino</th><th>Faixa/Rota</th><th>Frete mínimo</th><th>Taxa aplicada</th><th>% NF</th><th>Prazo</th><th>Observação</th></tr></thead>
              <tbody>
                {itensSelecionada.slice(0, 120).map((item) => (
                  <tr key={item.id}>
                    <td>{getTipoItem(item)}</td><td>{item.cidade_origem}/{item.uf_origem}</td><td>{item.cidade_destino ? `${item.cidade_destino}/${item.uf_destino}` : item.uf_destino}</td><td>{item.faixa_peso || '-'}</td><td>{formatMoney(item.frete_minimo)}</td><td>{formatMoney(item.taxa_aplicada)}</td><td>{Number(item.frete_percentual || 0).toFixed(4)}</td><td>{item.prazo || '-'}</td><td>{item.observacao || '-'}</td>
                  </tr>
                ))}
                {!itensSelecionada.length && <tr><td colSpan="9">Nenhum item salvo para esta negociação.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {modalAprovacao && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', zIndex: 9999, display: 'grid', placeItems: 'center', padding: 20 }}>
          <div className="sim-card" style={{ width: 'min(720px, 100%)', maxHeight: '90vh', overflow: 'auto' }}>
            <h2>Aprovar tabela</h2>
            <p>A tabela de <strong>{modalAprovacao.transportadora}</strong> será marcada como aprovada. A promoção para cadastro oficial será feita na próxima etapa para não misturar bases agora.</p>
            <div className="sim-form-grid sim-grid-2">
              <label>Data início de vigência<input type="date" value={aprovacao.data_inicio_vigencia} onChange={(e) => setAprovacao((prev) => ({ ...prev, data_inicio_vigencia: e.target.value }))} /></label>
              <label className="sim-flag" style={{ justifyContent: 'end' }}><input type="checkbox" checked={aprovacao.substituir_tabela_anterior} onChange={(e) => setAprovacao((prev) => ({ ...prev, substituir_tabela_anterior: e.target.checked }))} />Substitui tabela anterior</label>
            </div>
            <label style={{ marginTop: 12 }}>Justificativa da aprovação<textarea value={aprovacao.justificativa_aprovacao} onChange={(e) => setAprovacao((prev) => ({ ...prev, justificativa_aprovacao: e.target.value }))} placeholder="Explique por que a tabela foi aprovada, região, ganho esperado, condição negociada etc." style={{ minHeight: 120 }} /></label>
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
