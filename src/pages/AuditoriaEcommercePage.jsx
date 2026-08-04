import { useEffect, useMemo, useRef, useState } from 'react';
import {
  parseOrderSnapshotCsv,
  importarEcommerceOrderSnapshot,
  diagnosticarEcommerceOrderSnapshot,
  cruzarEcommerceComTrackingECte,
  listarEcommerceOrderSnapshot,
  diagnosticarResimulacaoEcommerce,
  resimularEcommerceEmLotes,
  resimularEcommercePorIds,
  listarOpcoesFiltroEcommerce,
  contarElegiveisResimulacaoEcommerce,
} from '../services/ecommerceAuditoriaService';
import AmdProcessingOverlay from '../components/AmdProcessingOverlay';

const CDS_RESTRICAO = ['Itupeva', 'Jaboatão', 'Serra', 'Duque de Caxias', 'Itajaí'];

function formatarNumero(value, casas = 0) {
  if (value === null || value === undefined || value === '') return '-';
  return Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

function formatarMoeda(value) {
  if (value === null || value === undefined || value === '') return '-';
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarData(value) {
  if (!value) return '-';
  const data = new Date(value);
  if (Number.isNaN(data.getTime())) return '-';
  return data.toLocaleDateString('pt-BR');
}

function boolTexto(value) {
  if (value === true) return 'Sim';
  if (value === false) return 'Nao';
  return '-';
}

const COLUNAS_TABELA = [
  { chave: 'pedido', label: 'Pedido', tipo: 'texto' },
  { chave: 'canal', label: 'Canal', tipo: 'texto' },
  { chave: 'uf', label: 'UF', tipo: 'texto' },
  { chave: 'cidade', label: 'Cidade', tipo: 'texto' },
  { chave: 'data_criacao', label: 'Data Criacao', tipo: 'data' },
  { chave: 'status_entrega', label: 'Status Entrega', tipo: 'texto' },
  { chave: 'frete_cobrado', label: 'Frete Cobrado', tipo: 'moeda' },
  { chave: 'frete_tabela', label: 'Frete Tabela', tipo: 'moeda' },
  { chave: 'desconto_campanha_frete', label: 'Desc. Campanha', tipo: 'moeda' },
  { chave: 'adicional_tributario_frete', label: 'Adic. Tributario', tipo: 'moeda' },
  { chave: 'custo_frete_transportadora', label: 'Custo CT-e (arquivo)', tipo: 'moeda' },
  { chave: 'diferenca_tabela_cte', label: 'Dif. Tabela x CT-e', tipo: 'moeda' },
  { chave: 'frete_a_cobrar_marketplace', label: 'Frete a Cobrar Mkt', tipo: 'moeda' },
  { chave: 'peso_cotado', label: 'Peso Cotado', tipo: 'numero2' },
  { chave: 'peso_faturado', label: 'Peso Faturado', tipo: 'numero2' },
  { chave: 'diferenca_peso', label: 'Dif. Peso', tipo: 'numero2' },
  { chave: 'tem_cte', label: 'Tem CT-e? (relatorio mkt)', tipo: 'bool' },
  { chave: 'possui_campanha_frete', label: 'Campanha?', tipo: 'bool' },
  { chave: 'divergencia_origem', label: 'Div. Origem?', tipo: 'bool' },
  { chave: 'divergencia_transportadora', label: 'Div. Transp.?', tipo: 'bool' },
  { chave: 'cruzamento_status', label: 'Cruzamento', tipo: 'texto' },
  { chave: 'cte_transportadora', label: 'Transportadora (CT-e real)', tipo: 'texto' },
  { chave: 'cte_valor', label: 'Valor CT-e real', tipo: 'moeda' },
  { chave: 'cte_uf_origem', label: 'UF Origem (CT-e)', tipo: 'texto' },
  { chave: 'cte_uf_destino', label: 'UF Destino (CT-e)', tipo: 'texto' },
  { chave: 'sim_status', label: 'Resimulacao', tipo: 'texto' },
  { chave: 'sim_peso_base', label: 'Peso usado', tipo: 'texto' },
  { chave: 'sim_transportadora_ideal', label: 'Transportadora ideal', tipo: 'texto' },
  { chave: 'sim_origem_ideal', label: 'CD ideal', tipo: 'texto' },
  { chave: 'sim_valor_ideal', label: 'Valor ideal', tipo: 'moeda' },
  { chave: 'sim_prazo_ideal', label: 'Prazo ideal (dias)', tipo: 'numero2' },
  { chave: 'sim_diferenca_vs_cte', label: 'Dif. Ideal x CT-e real', tipo: 'moeda' },
  { chave: 'sim_mesma_transportadora', label: 'Mesma transp.?', tipo: 'bool' },
  { chave: 'sim_candidatos', label: 'Opcoes simuladas', tipo: 'acao' },
];

function FiltroColuna({ coluna, valoresUnicos, selecionados, onChange }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [posicao, setPosicao] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const ativo = selecionados instanceof Set;

  function alternarAberto() {
    if (!aberto && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      // position:fixed calculado a partir do botao, pra escapar do overflow:auto
      // da tabela (com absolute o painel ficava cortado pelo scroll da grade).
      setPosicao({ top: rect.bottom + 4, left: Math.min(rect.left, window.innerWidth - 236) });
    }
    setAberto((v) => !v);
  }

  const valoresFiltradosBusca = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return valoresUnicos;
    return valoresUnicos.filter((valor) => valor.toLowerCase().includes(termo));
  }, [valoresUnicos, busca]);

  function alternar(valor) {
    // Parte da selecao explicita atual (mesmo vazia, ex: depois de "Limpar"), nao
    // reseta pra "todos" so porque esta vazia - senao marcar 1 item depois de
    // limpar volta a selecionar tudo em vez de so aquele item.
    const base = selecionados instanceof Set ? selecionados : new Set(valoresUnicos);
    const novo = new Set(base);
    if (novo.has(valor)) novo.delete(valor); else novo.add(valor);
    onChange(coluna.chave, novo.size === valoresUnicos.length ? null : novo);
  }

  function marcarTodos() {
    onChange(coluna.chave, null);
  }

  function limparTodos() {
    onChange(coluna.chave, new Set());
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        type="button"
        onClick={alternarAberto}
        style={{
          width: '100%', textAlign: 'left', fontSize: '0.75rem', padding: '4px 6px',
          background: ativo ? '#eef2ff' : '#fff', border: `1px solid ${ativo ? '#818cf8' : '#cbd5e1'}`,
          borderRadius: 4, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 4,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {ativo ? `${selecionados.size} selecionado(s)` : `Todos (${valoresUnicos.length})`}
        </span>
        <span>▾</span>
      </button>
      {aberto ? (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 5 }} onClick={() => setAberto(false)} />
          <div style={{
            position: 'fixed', top: posicao.top, left: posicao.left, zIndex: 6,
            background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            width: 220, maxHeight: 300, display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ padding: 8, borderBottom: '1px solid #e2e8f0' }}>
              <input
                type="text"
                autoFocus
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
                placeholder="Buscar valor..."
                style={{ width: '100%', boxSizing: 'border-box', fontSize: '0.8rem', padding: '4px 6px' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 6, padding: '6px 8px', borderBottom: '1px solid #e2e8f0', fontSize: '0.7rem' }}>
              <button type="button" className="btn-secondary" style={{ padding: '2px 6px', fontSize: '0.7rem' }} onClick={marcarTodos}>Marcar todos</button>
              <button type="button" className="btn-secondary" style={{ padding: '2px 6px', fontSize: '0.7rem' }} onClick={limparTodos}>Limpar</button>
            </div>
            <div style={{ overflowY: 'auto', padding: 6 }}>
              {valoresFiltradosBusca.map((valor) => {
                const marcado = selecionados instanceof Set ? selecionados.has(valor) : true;
                return (
                  <label key={valor} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', padding: '2px 4px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={marcado} onChange={() => alternar(valor)} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{valor || '(vazio)'}</span>
                  </label>
                );
              })}
              {!valoresFiltradosBusca.length ? <div style={{ fontSize: '0.75rem', color: '#94a3b8', padding: 4 }}>Nenhum valor.</div> : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function celula(row, coluna) {
  const valor = row[coluna.chave];
  if (coluna.tipo === 'acao') return '';
  if (coluna.tipo === 'moeda') return formatarMoeda(valor);
  if (coluna.tipo === 'numero2') return formatarNumero(valor, 2);
  if (coluna.tipo === 'data') return formatarData(valor);
  if (coluna.tipo === 'bool') return boolTexto(valor);
  return valor || '-';
}

export default function AuditoriaEcommercePage() {
  const [arquivo, setArquivo] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const [progressoAmd, setProgressoAmd] = useState({});
  const [diagnostico, setDiagnostico] = useState({ total: 0, cruzados: 0 });
  const [diagnosticoSim, setDiagnosticoSim] = useState({ elegiveis: 0, pendentes: 0, ok: 0 });
  const [linhas, setLinhas] = useState([]);
  const [filtros, setFiltros] = useState({});
  const [filtrosServidor, setFiltrosServidor] = useState({
    dataInicio: '', dataFim: '', cruzamentoStatus: '', divergenciaPeso: false, canal: '', uf: '', possuiCampanha: '',
  });
  const [opcoesFiltro, setOpcoesFiltro] = useState({ canais: [], ufs: [] });
  const [pesoBase, setPesoBase] = useState('cotado');
  const [restringirCds, setRestringirCds] = useState(false);
  const [painelCandidatos, setPainelCandidatos] = useState(null);
  const [resumoResimulacao, setResumoResimulacao] = useState(null);
  const [contandoResumo, setContandoResumo] = useState(false);

  function filtrosParaQuery(f) {
    return {
      dataInicio: f.dataInicio || null,
      dataFim: f.dataFim || null,
      cruzamentoStatus: f.cruzamentoStatus || null,
      divergenciaPeso: Boolean(f.divergenciaPeso),
      canal: f.canal || null,
      uf: f.uf || null,
      possuiCampanha: f.possuiCampanha === '' ? null : f.possuiCampanha === 'true',
    };
  }

  function onChangeFiltroServidor(campo, valor) {
    setFiltrosServidor((atual) => ({ ...atual, [campo]: valor }));
    setResumoResimulacao(null);
  }

  async function atualizarDiagnostico() {
    try {
      const filtrosAtuais = filtrosParaQuery(filtrosServidor);
      const [diag, diagSim] = await Promise.all([
        diagnosticarEcommerceOrderSnapshot(filtrosAtuais),
        diagnosticarResimulacaoEcommerce(filtrosAtuais),
      ]);
      setDiagnostico(diag);
      setDiagnosticoSim(diagSim);
    } catch (error) {
      setErro(error.message || 'Erro ao consultar base.');
    }
  }

  async function atualizarGrid() {
    try {
      const { rows } = await listarEcommerceOrderSnapshot({ limit: 500, filtros: filtrosParaQuery(filtrosServidor) });
      setLinhas(rows);
    } catch (error) {
      setErro(error.message || 'Erro ao listar pedidos.');
    }
  }

  useEffect(() => {
    listarOpcoesFiltroEcommerce().then(setOpcoesFiltro).catch(() => {});
  }, []);

  useEffect(() => {
    atualizarDiagnostico();
    atualizarGrid();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtrosServidor]);

  async function importar() {
    if (!arquivo) {
      setErro('Selecione o arquivo OrderSnapshotAnalytics (.csv).');
      return;
    }
    setCarregando(true);
    setErro('');
    setMensagem('');
    setProgressoAmd({ etapa: 'salvando_pedidos_ecommerce', carregados: 0, total: null });
    try {
      const texto = await arquivo.text();
      const registros = parseOrderSnapshotCsv(texto);
      if (!registros.length) throw new Error('Nenhuma linha valida encontrada no arquivo.');
      setProgressoAmd({ etapa: 'salvando_pedidos_ecommerce', carregados: 0, total: registros.length });
      const resultado = await importarEcommerceOrderSnapshot(registros, {
        onProgress: (evt) => setProgressoAmd(evt),
      });
      setMensagem(`Importacao concluida: ${formatarNumero(resultado.enviados)} pedido(s) salvos.`);
      setArquivo(null);
      await atualizarDiagnostico();
      await atualizarGrid();
    } catch (error) {
      setErro(error.message || 'Erro ao importar arquivo.');
    } finally {
      setCarregando(false);
      setProgressoAmd({});
    }
  }

  async function cruzar() {
    setCarregando(true);
    setErro('');
    setMensagem('');
    const totalAlvo = Math.max((diagnostico.total || 0) - (diagnostico.cruzados || 0), 1);
    setProgressoAmd({ etapa: 'cruzando_tracking', carregados: 0, total: totalAlvo });
    try {
      const resultado = await cruzarEcommerceComTrackingECte({
        totalAlvo,
        onProgress: (evt) => setProgressoAmd(evt),
      });
      setMensagem(`Cruzamento concluido. OK: ${formatarNumero(resultado.totalOk)} - Sem tracking: ${formatarNumero(resultado.totalSemTracking)} - Sem CT-e: ${formatarNumero(resultado.totalSemCte)}`);
      await atualizarDiagnostico();
      await atualizarGrid();
    } catch (error) {
      setErro(error.message || 'Erro ao cruzar base.');
    } finally {
      setCarregando(false);
      setProgressoAmd({});
    }
  }

  async function prepararResimulacao() {
    setErro('');
    setMensagem('');
    setContandoResumo(true);
    try {
      const filtrosAtuais = filtrosParaQuery(filtrosServidor);
      const count = await contarElegiveisResimulacaoEcommerce(filtrosAtuais);
      setResumoResimulacao({ origem: 'servidor', count, filtros: { ...filtrosServidor }, pesoBase, cdsPermitidos: restringirCds ? CDS_RESTRICAO : [] });
    } catch (error) {
      setErro(error.message || 'Erro ao contar pedidos para resimular.');
    } finally {
      setContandoResumo(false);
    }
  }

  function prepararResimulacaoColuna() {
    setErro('');
    setMensagem('');
    const idsElegiveis = linhasFiltradas.filter((row) => row.cruzamento_status === 'ok').map((row) => row.id);
    setResumoResimulacao({ origem: 'coluna', count: idsElegiveis.length, ids: idsElegiveis, pesoBase, cdsPermitidos: restringirCds ? CDS_RESTRICAO : [] });
  }

  async function confirmarResimulacao() {
    if (!resumoResimulacao) return;
    setCarregando(true);
    setErro('');
    setMensagem('');
    const resumo = resumoResimulacao;
    setResumoResimulacao(null);
    setProgressoAmd({ etapa: 'carregando_tabelas_completas_fallback', carregados: 0, total: null });
    try {
      // "Ideal" aqui e sempre o mais barato entre os candidatos (nao pondera prazo) -
      // e uma auditoria de custo, nao uma oferta de checkout pro cliente.
      const criterioB2c = { usarPonderadoB2c: false };
      const resultado = resumo.origem === 'coluna'
        ? await resimularEcommercePorIds({
          ids: resumo.ids,
          criterioB2c,
          pesoBase: resumo.pesoBase,
          cdsPermitidos: resumo.cdsPermitidos,
          onProgress: (evt) => setProgressoAmd(evt),
        })
        : await resimularEcommerceEmLotes({
          criterioB2c,
          pesoBase: resumo.pesoBase,
          cdsPermitidos: resumo.cdsPermitidos,
          totalAlvo: Math.max(resumo.count || 0, 1),
          filtros: filtrosParaQuery(resumo.filtros),
          onProgress: (evt) => setProgressoAmd(evt),
        });
      setMensagem(`Resimulacao concluida. Processados: ${formatarNumero(resultado.totalProcessado)} - OK: ${formatarNumero(resultado.totalOk)}`);
      await atualizarDiagnostico();
      await atualizarGrid();
    } catch (error) {
      console.error('[AuditoriaEcommerce] erro ao resimular:', error);
      setErro(error.message || 'Erro ao resimular pedidos.');
    } finally {
      setCarregando(false);
      setProgressoAmd({});
    }
  }

  const valoresUnicosPorColuna = useMemo(() => {
    const mapa = {};
    COLUNAS_TABELA.forEach((coluna) => {
      const valores = new Set(linhas.map((row) => celula(row, coluna)));
      mapa[coluna.chave] = [...valores].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
    });
    return mapa;
  }, [linhas]);

  function onChangeFiltro(chave, novoSet) {
    setFiltros((atual) => ({ ...atual, [chave]: novoSet }));
  }

  const linhasFiltradas = useMemo(() => {
    const chavesAtivas = Object.entries(filtros).filter(([, set]) => set instanceof Set);
    if (!chavesAtivas.length) return linhas;
    return linhas.filter((row) => chavesAtivas.every(([chave, set]) => {
      const coluna = COLUNAS_TABELA.find((c) => c.chave === chave);
      return set.has(celula(row, coluna));
    }));
  }, [linhas, filtros]);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="amd-mini-brand">AMD Log • Auditoria E-commerce</div>
        <h1>Auditoria E-commerce</h1>
        <p>
          Cruza a base de pedidos do marketplace (OrderSnapshotAnalytics) com o Tracking (pelo numero do <strong>Pedido</strong>) para achar a <strong>chave de CT-e</strong> e trazer o CT-e real da base de CT-e. Mostra onde o frete simulado, tabela, campanha e tributario divergem do que foi de fato cobrado e pago.
        </p>
      </div>

      {erro ? <div className="sim-alert error">{erro}</div> : null}
      {mensagem && !carregando ? <div className="sim-alert info">{mensagem}</div> : null}
      <AmdProcessingOverlay ativo={carregando} progresso={progressoAmd} mensagemRodape="Pode levar mais tempo em bases grandes." />

      <section className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Importar base de pedidos</div>
            <p>Suba o CSV exportado do marketplace (OrderSnapshotAnalytics). O envio faz upsert por numero de Pedido.</p>
          </div>
          <div className="actions-right gap-row">
            <button className="btn-secondary" type="button" onClick={() => { atualizarDiagnostico(); atualizarGrid(); }} disabled={carregando}>Atualizar</button>
            <button className="btn-primary" type="button" onClick={cruzar} disabled={carregando}>Cruzar Tracking + CT-e</button>
            <button className="btn-primary" type="button" onClick={prepararResimulacao} disabled={carregando || contandoResumo}>
              {contandoResumo ? 'Contando pedidos...' : 'Resimular cenario ideal'}
            </button>
          </div>
        </div>

        <div className="form-grid two">
          <label className="field">
            Arquivo CSV
            <input type="file" accept=".csv" onChange={(event) => setArquivo(event.target.files?.[0] || null)} />
          </label>
        </div>

        <div className="actions-right" style={{ marginTop: 12 }}>
          <button className="btn-primary" type="button" onClick={importar} disabled={carregando || !arquivo}>
            {carregando ? 'Processando...' : 'Importar pedidos'}
          </button>
        </div>
      </section>

      <section className="panel-card">
        <div className="panel-title">Filtros de analise</div>
        <p className="compact">Esses filtros valem para a base inteira (nao so a amostra abaixo) e para a resimulacao.</p>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <label className="field">
            Data criacao (de)
            <input type="date" value={filtrosServidor.dataInicio} onChange={(e) => onChangeFiltroServidor('dataInicio', e.target.value)} />
          </label>
          <label className="field">
            Data criacao (ate)
            <input type="date" value={filtrosServidor.dataFim} onChange={(e) => onChangeFiltroServidor('dataFim', e.target.value)} />
          </label>
          <label className="field">
            Status cruzamento
            <select value={filtrosServidor.cruzamentoStatus} onChange={(e) => onChangeFiltroServidor('cruzamentoStatus', e.target.value)}>
              <option value="">Todos</option>
              <option value="ok">ok (casou)</option>
              <option value="sem_tracking">sem_tracking</option>
              <option value="sem_cte">sem_cte</option>
              <option value="pendente">pendente</option>
            </select>
          </label>
          <label className="field">
            Canal
            <select value={filtrosServidor.canal} onChange={(e) => onChangeFiltroServidor('canal', e.target.value)}>
              <option value="">Todos</option>
              {opcoesFiltro.canais.map((canal) => <option key={canal} value={canal}>{canal}</option>)}
            </select>
          </label>
          <label className="field">
            UF
            <select value={filtrosServidor.uf} onChange={(e) => onChangeFiltroServidor('uf', e.target.value)}>
              <option value="">Todas</option>
              {opcoesFiltro.ufs.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
            </select>
          </label>
          <label className="field">
            Campanha de frete
            <select value={filtrosServidor.possuiCampanha} onChange={(e) => onChangeFiltroServidor('possuiCampanha', e.target.value)}>
              <option value="">Todos</option>
              <option value="true">Com campanha</option>
              <option value="false">Sem campanha</option>
            </select>
          </label>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={filtrosServidor.divergenciaPeso} onChange={(e) => onChangeFiltroServidor('divergenciaPeso', e.target.checked)} />
            Só com divergencia de peso (cotado x faturado)
          </label>
          <label className="field">
            Peso usado na resimulacao
            <select value={pesoBase} onChange={(e) => setPesoBase(e.target.value)}>
              <option value="cotado">Peso cotado (venda)</option>
              <option value="faturado">Peso faturado (transportadora)</option>
            </select>
          </label>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={restringirCds} onChange={(e) => setRestringirCds(e.target.checked)} />
            Restringir aos CDs: {CDS_RESTRICAO.join(', ')} (senao, busca em todas as origens)
          </label>
        </div>
      </section>

      {resumoResimulacao ? (
        <section className="panel-card" style={{ borderColor: '#818cf8' }}>
          <div className="panel-title">Confirmar resimulacao</div>
          <p className="compact">Peso usado no calculo: <strong>{resumoResimulacao.pesoBase === 'faturado' ? 'peso faturado' : 'peso cotado'}</strong></p>
          <p className="compact">
            Origens consideradas: <strong>{resumoResimulacao.cdsPermitidos?.length ? resumoResimulacao.cdsPermitidos.join(', ') : 'todas'}</strong>
          </p>
          {resumoResimulacao.origem === 'coluna' ? (
            <p>
              <strong>{formatarNumero(resumoResimulacao.count)}</strong> pedido(s) elegivel(is) (cruzamento ok) estao visiveis
              na tabela agora, considerando os filtros por coluna aplicados no cabecalho abaixo. Confirma a resimulacao
              so desse recorte visivel?
            </p>
          ) : (
            <p>
              <strong>{formatarNumero(resumoResimulacao.count)}</strong> pedido(s) elegivel(is) e pendente(s) batem com os filtros ativos acima
              {resumoResimulacao.filtros.dataInicio || resumoResimulacao.filtros.dataFim ? (
                <> no periodo de <strong>{resumoResimulacao.filtros.dataInicio || '...'}</strong> ate <strong>{resumoResimulacao.filtros.dataFim || '...'}</strong></>
              ) : null}
              . Confirma a resimulacao desse recorte?
            </p>
          )}
          <div className="actions-right gap-row">
            <button className="btn-secondary" type="button" onClick={() => setResumoResimulacao(null)}>Cancelar</button>
            <button className="btn-primary" type="button" onClick={confirmarResimulacao} disabled={!resumoResimulacao.count}>Confirmar resimulacao</button>
          </div>
        </section>
      ) : null}

      <div className="summary-strip lotacao-summary-mini">
        <div className="summary-card"><span>Pedidos na base</span><strong>{formatarNumero(diagnostico.total)}</strong></div>
        <div className="summary-card"><span>Ja cruzados</span><strong>{formatarNumero(diagnostico.cruzados)}</strong><small>Pendentes: {formatarNumero((diagnostico.total || 0) - (diagnostico.cruzados || 0))}</small></div>
        <div className="summary-card"><span>Elegiveis p/ resimular</span><strong>{formatarNumero(diagnosticoSim.elegiveis)}</strong><small>Com CT-e casado</small></div>
        <div className="summary-card"><span>Resimulados</span><strong>{formatarNumero(diagnosticoSim.ok)}</strong><small>Pendentes: {formatarNumero(diagnosticoSim.pendentes)}</small></div>
      </div>

      <section className="table-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Pedidos cruzados</div>
            <p className="compact">Amostra de ate 500 pedidos mais recentes. Use os filtros por coluna abaixo do cabecalho.</p>
          </div>
          <div className="actions-right gap-row">
            <button className="btn-secondary" type="button" onClick={() => setFiltros({})} disabled={!Object.keys(filtros).length}>Limpar filtros</button>
            <button className="btn-primary" type="button" onClick={prepararResimulacaoColuna} disabled={carregando}>
              Resimular apenas o filtrado abaixo ({formatarNumero(linhasFiltradas.filter((row) => row.cruzamento_status === 'ok').length)})
            </button>
          </div>
        </div>
        <div className="sim-analise-tabela-wrap" style={{ maxHeight: '70vh', overflow: 'auto' }}>
          <table className="sim-analise-tabela" style={{ minWidth: `${COLUNAS_TABELA.length * 140}px`, tableLayout: 'fixed' }}>
            <thead>
              <tr>
                {COLUNAS_TABELA.map((coluna) => <th key={coluna.chave} style={{ whiteSpace: 'nowrap', position: 'sticky', top: 0, background: 'var(--panel-soft)', zIndex: 2 }}>{coluna.label}</th>)}
              </tr>
              <tr>
                {COLUNAS_TABELA.map((coluna) => (
                  <th key={`filtro-${coluna.chave}`} style={{ position: 'sticky', top: 32, background: 'var(--panel-soft)', zIndex: 2 }}>
                    {coluna.tipo === 'acao' ? null : (
                      <FiltroColuna
                        coluna={coluna}
                        valoresUnicos={valoresUnicosPorColuna[coluna.chave] || []}
                        selecionados={filtros[coluna.chave]}
                        onChange={onChangeFiltro}
                      />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhasFiltradas.map((row) => (
                <tr key={row.id}>
                  {COLUNAS_TABELA.map((coluna) => (
                    <td key={coluna.chave} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {coluna.tipo === 'acao' ? (
                        Array.isArray(row.sim_candidatos) && row.sim_candidatos.length ? (
                          <button
                            className="btn-secondary"
                            type="button"
                            style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                            onClick={() => setPainelCandidatos({ pedido: row.pedido, candidatos: row.sim_candidatos, selecionado: 0 })}
                          >
                            Ver opções ({row.sim_candidatos.length})
                          </button>
                        ) : '-'
                      ) : celula(row, coluna)}
                    </td>
                  ))}
                </tr>
              ))}
              {!linhasFiltradas.length && <tr><td colSpan={COLUNAS_TABELA.length}>Nenhum pedido encontrado.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {painelCandidatos ? (
        <div style={{ position: 'fixed', inset: 0, zIndex: 20, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setPainelCandidatos(null)}>
          <div
            style={{ background: '#fff', borderRadius: 10, width: 'min(900px, 92vw)', maxHeight: '85vh', overflow: 'auto', padding: 20, boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong>Opções simuladas — Pedido {painelCandidatos.pedido}</strong>
              <button className="btn-secondary" type="button" onClick={() => setPainelCandidatos(null)}>Fechar</button>
            </div>
            <table className="sim-analise-tabela" style={{ width: '100%', marginBottom: 16 }}>
              <thead>
                <tr>
                  <th></th>
                  <th>Transportadora</th>
                  <th>CD</th>
                  <th>Faixa peso</th>
                  <th>Prazo</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {painelCandidatos.candidatos.map((cand, idx) => (
                  <tr
                    key={idx}
                    style={{ cursor: 'pointer', background: painelCandidatos.selecionado === idx ? '#eef2ff' : 'transparent' }}
                    onClick={() => setPainelCandidatos((atual) => ({ ...atual, selecionado: idx }))}
                  >
                    <td>{idx === 0 ? '🏆' : ''}</td>
                    <td>{cand.transportadora}</td>
                    <td>{cand.origem}</td>
                    <td>{cand.faixaPeso || '-'}</td>
                    <td>{formatarNumero(cand.prazo, 2)} dia(s)</td>
                    <td>{formatarMoeda(cand.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {painelCandidatos.candidatos[painelCandidatos.selecionado]?.detalhes ? (
              <div>
                <div className="panel-title" style={{ marginBottom: 8 }}>Detalhe do cálculo</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '4px 16px', fontSize: '0.82rem' }}>
                  {Object.entries(painelCandidatos.candidatos[painelCandidatos.selecionado].detalhes).map(([chave, valor]) => (
                    <div key={chave} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #eee', padding: '2px 0' }}>
                      <span style={{ color: '#666' }}>{chave}</span>
                      <strong>{typeof valor === 'number' ? formatarNumero(valor, 2) : String(valor ?? '-')}</strong>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
