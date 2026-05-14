import React, { useEffect, useMemo, useState } from 'react';
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

function hoje() {
  return new Date().toISOString().slice(0, 10);
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function splitCsvLine(line = '') {
  const parts = [];
  let current = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if ((char === ';' || char === ',') && !insideQuotes) {
      parts.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  parts.push(current.trim());
  return parts;
}

function normalizarHeader(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function parseTabelaColada(texto = '') {
  const linhas = String(texto || '')
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean);

  if (linhas.length < 2) return [];

  const headers = splitCsvLine(linhas[0]).map(normalizarHeader);

  return linhas.slice(1).map((linha) => {
    const cols = splitCsvLine(linha);
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = cols[index] || '';
    });

    return {
      cidade_origem: obj.cidade_origem || obj.origem || '',
      uf_origem: obj.uf_origem || '',
      ibge_origem: obj.ibge_origem || '',

      cidade_destino: obj.cidade_destino || obj.destino || '',
      uf_destino: obj.uf_destino || '',
      ibge_destino: obj.ibge_destino || '',

      faixa_peso: obj.faixa_peso || obj.faixa || '',
      peso_inicial: obj.peso_inicial || '',
      peso_final: obj.peso_final || obj.peso || '',

      frete_minimo: obj.frete_minimo || obj.minimo || '',
      taxa_aplicada: obj.taxa_aplicada || obj.valor_faixa || obj.valor || '',
      frete_percentual: obj.frete_percentual || obj.percentual || '',
      excesso_kg: obj.excesso_kg || '',
      valor_excedente: obj.valor_excedente || obj.excedente || '',

      prazo: obj.prazo || '',
      tipo_veiculo: obj.tipo_veiculo || obj.veiculo || '',
      valor_lotacao: obj.valor_lotacao || obj.valor_rota || '',

      gris: obj.gris || '',
      advalorem: obj.advalorem || obj.adv || '',
      pedagio: obj.pedagio || '',
      tas: obj.tas || '',
      tda: obj.tda || '',
      tde: obj.tde || '',
      outras_taxas: obj.outras_taxas || '',
      observacao: obj.observacao || '',
    };
  });
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

  const [filtros, setFiltros] = useState({
    status: '',
    tipoTabela: '',
    canal: '',
    transportadora: '',
  });

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
    data_recebimento: hoje(),
    data_inicio_prevista: '',
    incluir_simulacao: false,
    observacao: '',
    saving_projetado: '',
    aderencia_projetada: '',
  });

  const [csvColado, setCsvColado] = useState('');
  const [modalAprovacao, setModalAprovacao] = useState(null);
  const [aprovacao, setAprovacao] = useState({
    data_inicio_vigencia: hoje(),
    substituir_tabela_anterior: false,
    justificativa_aprovacao: '',
  });

  const resumo = useMemo(() => {
    const total = tabelas.length;
    const emSimulacao = tabelas.filter((t) => t.incluir_simulacao).length;
    const emTeste = tabelas.filter((t) => t.status === 'EM TESTE').length;
    const aprovadas = tabelas.filter((t) => t.status === 'APROVADA').length;
    const lotacao = tabelas.filter((t) => t.tipo_tabela === 'LOTACAO').length;
    const fracionado = tabelas.filter((t) => t.tipo_tabela === 'FRACIONADO').length;

    return { total, emSimulacao, emTeste, aprovadas, lotacao, fracionado };
  }, [tabelas]);

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
    setErro('');
    setSucesso('');
    try {
      const itens = await listarItensTabelaNegociacao(tabela.id);
      setItensSelecionada(itens);
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
      data_recebimento: hoje(),
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

  async function importarItens() {
    if (!selecionada?.id) {
      setErro('Selecione uma tabela antes de importar itens.');
      return;
    }

    const itens = parseTabelaColada(csvColado);
    if (!itens.length) {
      setErro('Cole uma tabela com cabeçalho e pelo menos uma linha.');
      return;
    }

    setSalvando(true);
    setErro('');
    setSucesso('');

    try {
      const salvos = await substituirItensTabelaNegociacao(selecionada, itens);
      setItensSelecionada(salvos);
      setCsvColado('');
      setSucesso(`${salvos.length} item(ns) importado(s) para a tabela em negociação.`);
    } catch (error) {
      setErro(error.message || 'Erro ao importar itens.');
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
      data_inicio_vigencia: hoje(),
      substituir_tabela_anterior: false,
      justificativa_aprovacao: '',
    });
  }

  async function confirmarAprovacao() {
    if (!modalAprovacao?.id) return;

    if (!aprovacao.justificativa_aprovacao.trim()) {
      setErro('Informe uma justificativa para aprovar a tabela.');
      return;
    }

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
        <p>
          Cadastre tabelas temporárias para simular aderência, comparar cenários e aprovar somente depois,
          sem misturar com o cadastro oficial.
        </p>
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
          <label>
            Transportadora
            <input
              value={form.transportadora}
              onChange={(e) => setForm((prev) => ({ ...prev, transportadora: e.target.value }))}
              placeholder="Ex: JADLOG"
            />
          </label>

          <label>
            Canal
            <select value={form.canal} onChange={(e) => setForm((prev) => ({ ...prev, canal: e.target.value }))}>
              {CANAIS.map((canal) => <option key={canal} value={canal}>{canal}</option>)}
            </select>
          </label>

          <label>
            Tipo de tabela
            <select value={form.tipo_tabela} onChange={(e) => setForm((prev) => ({ ...prev, tipo_tabela: e.target.value }))}>
              {TIPOS_TABELA_NEGOCIACAO.map((tipo) => <option key={tipo} value={tipo}>{tipo}</option>)}
            </select>
          </label>

          <label>
            Status
            <select value={form.status} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}>
              {STATUS_TABELA_NEGOCIACAO.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>

          <label>
            Data recebimento
            <input
              type="date"
              value={form.data_recebimento}
              onChange={(e) => setForm((prev) => ({ ...prev, data_recebimento: e.target.value }))}
            />
          </label>
        </div>

        <div className="sim-form-grid sim-grid-5" style={{ marginTop: 12 }}>
          <label>
            Origem
            <input
              value={form.origem}
              onChange={(e) => setForm((prev) => ({ ...prev, origem: e.target.value }))}
              placeholder="Ex: Itajaí"
            />
          </label>

          <label>
            UF origem
            <select value={form.uf_origem} onChange={(e) => setForm((prev) => ({ ...prev, uf_origem: e.target.value }))}>
              {UF_OPTIONS.map((uf) => <option key={uf || 'todas'} value={uf}>{uf || 'Todas'}</option>)}
            </select>
          </label>

          <label>
            UF destino
            <select value={form.uf_destino} onChange={(e) => setForm((prev) => ({ ...prev, uf_destino: e.target.value }))}>
              {UF_OPTIONS.map((uf) => <option key={uf || 'todas'} value={uf}>{uf || 'Todas'}</option>)}
            </select>
          </label>

          <label>
            Início previsto
            <input
              type="date"
              value={form.data_inicio_prevista}
              onChange={(e) => setForm((prev) => ({ ...prev, data_inicio_prevista: e.target.value }))}
            />
          </label>

          <label className="sim-flag" style={{ justifyContent: 'end' }}>
            <input
              type="checkbox"
              checked={form.incluir_simulacao}
              onChange={(e) => setForm((prev) => ({ ...prev, incluir_simulacao: e.target.checked }))}
            />
            Incluir nas simulações
          </label>
        </div>

        <div className="sim-form-grid sim-grid-3" style={{ marginTop: 12 }}>
          <label>
            Descrição
            <input
              value={form.descricao}
              onChange={(e) => setForm((prev) => ({ ...prev, descricao: e.target.value }))}
              placeholder="Ex: Tabela recebida para Sudeste"
            />
          </label>

          <label>
            Região
            <input
              value={form.regiao}
              onChange={(e) => setForm((prev) => ({ ...prev, regiao: e.target.value }))}
              placeholder="Ex: SP/MG/ES"
            />
          </label>

          <label>
            Observação
            <input
              value={form.observacao}
              onChange={(e) => setForm((prev) => ({ ...prev, observacao: e.target.value }))}
              placeholder="Observações da negociação"
            />
          </label>
        </div>

        <div className="sim-actions" style={{ marginTop: 14 }}>
          <button className="primary" type="button" onClick={salvarNovaTabela} disabled={salvando}>
            {salvando ? 'Salvando...' : 'Criar tabela em negociação'}
          </button>
          <button className="sim-tab" type="button" onClick={limparForm}>
            Limpar
          </button>
        </div>
      </section>

      <section className="sim-card">
        <div className="sim-resultado-topo compact-top">
          <div>
            <h2 style={{ margin: 0 }}>Tabelas cadastradas</h2>
            <p>Controle quais tabelas estão em negociação, teste, aprovação e simulação.</p>
          </div>
          <button className="sim-tab" type="button" onClick={carregar} disabled={carregando}>
            {carregando ? 'Atualizando...' : 'Atualizar'}
          </button>
        </div>

        <div className="sim-form-grid sim-grid-4">
          <label>
            Status
            <select value={filtros.status} onChange={(e) => setFiltros((prev) => ({ ...prev, status: e.target.value }))}>
              <option value="">Todos</option>
              {STATUS_TABELA_NEGOCIACAO.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>

          <label>
            Tipo
            <select value={filtros.tipoTabela} onChange={(e) => setFiltros((prev) => ({ ...prev, tipoTabela: e.target.value }))}>
              <option value="">Todos</option>
              {TIPOS_TABELA_NEGOCIACAO.map((tipo) => <option key={tipo} value={tipo}>{tipo}</option>)}
            </select>
          </label>

          <label>
            Canal
            <select value={filtros.canal} onChange={(e) => setFiltros((prev) => ({ ...prev, canal: e.target.value }))}>
              <option value="">Todos</option>
              {CANAIS.map((canal) => <option key={canal} value={canal}>{canal}</option>)}
            </select>
          </label>

          <label>
            Transportadora
            <input
              value={filtros.transportadora}
              onChange={(e) => setFiltros((prev) => ({ ...prev, transportadora: e.target.value }))}
              placeholder="Buscar transportadora"
            />
          </label>
        </div>

        <div className="sim-actions" style={{ marginTop: 12 }}>
          <button className="primary" type="button" onClick={carregar}>Filtrar</button>
          <button className="sim-tab" type="button" onClick={() => setFiltros({ status: '', tipoTabela: '', canal: '', transportadora: '' })}>Limpar filtros</button>
        </div>

        <div className="sim-analise-tabela-wrap" style={{ marginTop: 14 }}>
          <table className="sim-analise-tabela">
            <thead>
              <tr>
                <th>Transportadora</th>
                <th>Canal</th>
                <th>Tipo</th>
                <th>Status</th>
                <th>Recebimento</th>
                <th>Simulação</th>
                <th>Saving proj.</th>
                <th>Aderência proj.</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {tabelas.map((tabela) => (
                <tr key={tabela.id}>
                  <td>
                    <strong>{tabela.transportadora}</strong>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{tabela.descricao || tabela.regiao || '-'}</div>
                  </td>
                  <td>{tabela.canal}</td>
                  <td>{tabela.tipo_tabela}</td>
                  <td>
                    <span style={{ ...statusStyle(tabela.status), borderRadius: 999, padding: '4px 8px', fontSize: 12, fontWeight: 700 }}>
                      {tabela.status}
                    </span>
                  </td>
                  <td>{tabela.data_recebimento || '-'}</td>
                  <td>
                    <button className="sim-tab" type="button" onClick={() => alternarSimulacao(tabela)}>
                      {tabela.incluir_simulacao ? 'Sim' : 'Não'}
                    </button>
                  </td>
                  <td>{formatMoney(tabela.saving_projetado)}</td>
                  <td>{formatPercent(tabela.aderencia_projetada)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="sim-tab" type="button" onClick={() => abrirTabela(tabela)}>Abrir</button>
                      <select value={tabela.status} onChange={(e) => atualizarStatus(tabela, e.target.value)}>
                        {STATUS_TABELA_NEGOCIACAO.map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                      <button className="sim-tab" type="button" onClick={() => abrirModalAprovacao(tabela)}>Aprovar</button>
                      <button className="sim-tab" type="button" onClick={() => excluirTabela(tabela)}>Excluir</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!tabelas.length && (
                <tr>
                  <td colSpan="9">Nenhuma tabela em negociação encontrada.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selecionada && (
        <section className="sim-card">
          <div className="sim-resultado-topo compact-top">
            <div>
              <h2 style={{ margin: 0 }}>Itens da tabela: {selecionada.transportadora}</h2>
              <p>
                {selecionada.tipo_tabela} · {selecionada.canal} · {selecionada.status} ·
                {selecionada.incluir_simulacao ? ' participa das simulações' : ' fora das simulações'}
              </p>
            </div>
            <button className="sim-tab" type="button" onClick={() => abrirTabela(selecionada)}>
              Recarregar itens
            </button>
          </div>

          <div className="sim-alert info">
            Cole uma tabela em CSV com separador <strong>;</strong> ou <strong>,</strong>. Cabeçalhos aceitos:
            origem, cidade_origem, uf_origem, destino, cidade_destino, uf_destino, ibge_destino,
            faixa_peso, peso_final, frete_minimo, taxa_aplicada, frete_percentual, excesso_kg, prazo,
            tipo_veiculo, valor_lotacao, gris, advalorem, pedagio, tda, tde.
          </div>

          <label>
            Colar tabela
            <textarea
              value={csvColado}
              onChange={(e) => setCsvColado(e.target.value)}
              placeholder={'cidade_origem;uf_origem;cidade_destino;uf_destino;faixa_peso;peso_final;taxa_aplicada;prazo\nItajaí;SC;São Paulo;SP;Até 50kg;50;120,00;3'}
              style={{ minHeight: 160 }}
            />
          </label>

          <div className="sim-actions" style={{ marginTop: 12 }}>
            <button className="primary" type="button" onClick={importarItens} disabled={salvando}>
              {salvando ? 'Importando...' : 'Importar/substituir itens'}
            </button>
          </div>

          <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginTop: 14 }}>
            <div className="summary-card"><span>Itens</span><strong>{itensSelecionada.length}</strong><small>linhas cadastradas</small></div>
            <div className="summary-card"><span>Destinos</span><strong>{new Set(itensSelecionada.map((i) => `${i.cidade_destino}/${i.uf_destino}`)).size}</strong><small>cidades/UF</small></div>
            <div className="summary-card"><span>UF destino</span><strong>{new Set(itensSelecionada.map((i) => i.uf_destino).filter(Boolean)).size}</strong><small>UFs cobertas</small></div>
            <div className="summary-card"><span>Tipo</span><strong>{selecionada.tipo_tabela}</strong><small>{selecionada.canal}</small></div>
          </div>

          <div className="sim-analise-tabela-wrap" style={{ marginTop: 14 }}>
            <table className="sim-analise-tabela">
              <thead>
                <tr>
                  <th>Origem</th>
                  <th>Destino</th>
                  <th>Faixa/Veículo</th>
                  <th>Frete mínimo</th>
                  <th>Taxa aplicada</th>
                  <th>% NF</th>
                  <th>Lotação</th>
                  <th>Prazo</th>
                  <th>Taxas</th>
                </tr>
              </thead>
              <tbody>
                {itensSelecionada.slice(0, 100).map((item) => (
                  <tr key={item.id}>
                    <td>{item.cidade_origem}/{item.uf_origem}</td>
                    <td>{item.cidade_destino}/{item.uf_destino}</td>
                    <td>{item.faixa_peso || item.tipo_veiculo || '-'}</td>
                    <td>{formatMoney(item.frete_minimo)}</td>
                    <td>{formatMoney(item.taxa_aplicada)}</td>
                    <td>{Number(item.frete_percentual || 0).toFixed(4)}</td>
                    <td>{formatMoney(item.valor_lotacao)}</td>
                    <td>{item.prazo || '-'}</td>
                    <td>{formatMoney(Number(item.pedagio || 0) + Number(item.tas || 0) + Number(item.tda || 0) + Number(item.tde || 0) + Number(item.outras_taxas || 0))}</td>
                  </tr>
                ))}
                {!itensSelecionada.length && (
                  <tr>
                    <td colSpan="9">Nenhum item importado para esta tabela.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {modalAprovacao && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            zIndex: 9999,
            display: 'grid',
            placeItems: 'center',
            padding: 20,
          }}
        >
          <div className="sim-card" style={{ width: 'min(720px, 100%)', maxHeight: '90vh', overflow: 'auto' }}>
            <h2>Aprovar tabela</h2>
            <p>
              A tabela de <strong>{modalAprovacao.transportadora}</strong> será marcada como aprovada.
              A promoção para cadastro oficial será feita na próxima etapa para não misturar bases agora.
            </p>

            <div className="sim-form-grid sim-grid-2">
              <label>
                Data início de vigência
                <input
                  type="date"
                  value={aprovacao.data_inicio_vigencia}
                  onChange={(e) => setAprovacao((prev) => ({ ...prev, data_inicio_vigencia: e.target.value }))}
                />
              </label>

              <label className="sim-flag" style={{ justifyContent: 'end' }}>
                <input
                  type="checkbox"
                  checked={aprovacao.substituir_tabela_anterior}
                  onChange={(e) => setAprovacao((prev) => ({ ...prev, substituir_tabela_anterior: e.target.checked }))}
                />
                Substitui tabela anterior
              </label>
            </div>

            <label style={{ marginTop: 12 }}>
              Justificativa da aprovação
              <textarea
                value={aprovacao.justificativa_aprovacao}
                onChange={(e) => setAprovacao((prev) => ({ ...prev, justificativa_aprovacao: e.target.value }))}
                placeholder="Explique por que a tabela foi aprovada, região, ganho esperado, condição negociada etc."
                style={{ minHeight: 120 }}
              />
            </label>

            <div className="sim-actions" style={{ marginTop: 14 }}>
              <button className="primary" type="button" onClick={confirmarAprovacao} disabled={salvando}>
                {salvando ? 'Aprovando...' : 'Confirmar aprovação'}
              </button>
              <button className="sim-tab" type="button" onClick={() => setModalAprovacao(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}