import { useEffect, useMemo, useState } from 'react';
import {
  parseOrderSnapshotCsv,
  importarEcommerceOrderSnapshot,
  diagnosticarEcommerceOrderSnapshot,
  cruzarEcommerceComTrackingECte,
  listarEcommerceOrderSnapshot,
  diagnosticarResimulacaoEcommerce,
  resimularEcommerceEmLotes,
} from '../services/ecommerceAuditoriaService';

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
  { chave: 'tem_cte', label: 'Tem CT-e? (arquivo)', tipo: 'bool' },
  { chave: 'possui_campanha_frete', label: 'Campanha?', tipo: 'bool' },
  { chave: 'divergencia_origem', label: 'Div. Origem?', tipo: 'bool' },
  { chave: 'divergencia_transportadora', label: 'Div. Transp.?', tipo: 'bool' },
  { chave: 'cruzamento_status', label: 'Cruzamento', tipo: 'texto' },
  { chave: 'cte_transportadora', label: 'Transportadora (CT-e real)', tipo: 'texto' },
  { chave: 'cte_valor', label: 'Valor CT-e real', tipo: 'moeda' },
  { chave: 'cte_uf_origem', label: 'UF Origem (CT-e)', tipo: 'texto' },
  { chave: 'cte_uf_destino', label: 'UF Destino (CT-e)', tipo: 'texto' },
  { chave: 'sim_status', label: 'Resimulacao', tipo: 'texto' },
  { chave: 'sim_transportadora_ideal', label: 'Transportadora ideal', tipo: 'texto' },
  { chave: 'sim_origem_ideal', label: 'CD ideal', tipo: 'texto' },
  { chave: 'sim_valor_ideal', label: 'Valor ideal', tipo: 'moeda' },
  { chave: 'sim_prazo_ideal', label: 'Prazo ideal (dias)', tipo: 'numero2' },
  { chave: 'sim_diferenca_vs_cte', label: 'Dif. Ideal x CT-e real', tipo: 'moeda' },
  { chave: 'sim_mesma_transportadora', label: 'Mesma transp.?', tipo: 'bool' },
];

function FiltroColuna({ coluna, valoresUnicos, selecionados, onChange }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const ativo = selecionados && selecionados.size > 0 && selecionados.size < valoresUnicos.length;

  const valoresFiltradosBusca = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return valoresUnicos;
    return valoresUnicos.filter((valor) => valor.toLowerCase().includes(termo));
  }, [valoresUnicos, busca]);

  function alternar(valor) {
    const novo = new Set(selecionados && selecionados.size ? selecionados : valoresUnicos);
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
        type="button"
        onClick={() => setAberto((v) => !v)}
        style={{
          width: '100%', textAlign: 'left', fontSize: '0.75rem', padding: '4px 6px',
          background: ativo ? '#eef2ff' : '#fff', border: `1px solid ${ativo ? '#818cf8' : '#cbd5e1'}`,
          borderRadius: 4, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 4,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {ativo ? `${selecionados.size} selecionado(s)` : 'Todos'}
        </span>
        <span>▾</span>
      </button>
      {aberto ? (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 5 }} onClick={() => setAberto(false)} />
          <div style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 6,
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
                const marcado = !selecionados || selecionados.size === 0 || selecionados.has(valor);
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

function BarraProgresso({ mensagem, pct }) {
  const pctVal = Math.max(0, Math.min(100, Math.round(pct || 0)));
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: '0.8rem', color: '#555', marginBottom: 5 }}>{mensagem}</div>
      <div style={{ background: '#eee', borderRadius: 99, height: 8, overflow: 'hidden' }}>
        <div style={{ background: 'linear-gradient(90deg,#9153F0,#6366f1)', height: '100%', borderRadius: 99, width: `${pctVal}%`, transition: 'width .4s' }} />
      </div>
      {pctVal > 0 ? <div style={{ fontSize: '0.7rem', color: '#888', textAlign: 'right', marginTop: 2 }}>{pctVal}%</div> : null}
    </div>
  );
}

function celula(row, coluna) {
  const valor = row[coluna.chave];
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
  const [progresso, setProgresso] = useState(null);
  const [progressoPct, setProgressoPct] = useState(0);
  const [diagnostico, setDiagnostico] = useState({ total: 0, cruzados: 0 });
  const [diagnosticoSim, setDiagnosticoSim] = useState({ elegiveis: 0, pendentes: 0, ok: 0 });
  const [linhas, setLinhas] = useState([]);
  const [filtros, setFiltros] = useState({});

  async function atualizarDiagnostico() {
    try {
      const [diag, diagSim] = await Promise.all([
        diagnosticarEcommerceOrderSnapshot(),
        diagnosticarResimulacaoEcommerce(),
      ]);
      setDiagnostico(diag);
      setDiagnosticoSim(diagSim);
    } catch (error) {
      setErro(error.message || 'Erro ao consultar base.');
    }
  }

  async function atualizarGrid() {
    try {
      const { rows } = await listarEcommerceOrderSnapshot({ limit: 500 });
      setLinhas(rows);
    } catch (error) {
      setErro(error.message || 'Erro ao listar pedidos.');
    }
  }

  useEffect(() => {
    atualizarDiagnostico();
    atualizarGrid();
  }, []);

  async function importar() {
    if (!arquivo) {
      setErro('Selecione o arquivo OrderSnapshotAnalytics (.csv).');
      return;
    }
    setCarregando(true);
    setErro('');
    setProgresso(null);
    setProgressoPct(0);
    setMensagem('Lendo arquivo...');
    try {
      const texto = await arquivo.text();
      const registros = parseOrderSnapshotCsv(texto);
      if (!registros.length) throw new Error('Nenhuma linha valida encontrada no arquivo.');
      setMensagem(`Enviando ${registros.length} pedido(s) ao Supabase...`);
      const resultado = await importarEcommerceOrderSnapshot(registros, {
        onProgress: (evt) => {
          setProgresso(evt);
          setProgressoPct((evt.lote / Math.max(evt.totalLotes, 1)) * 100);
          setMensagem(`Lote ${evt.lote}/${evt.totalLotes}: ${formatarNumero(evt.enviados)} de ${formatarNumero(evt.total)} pedido(s).`);
        },
      });
      setProgressoPct(100);
      setMensagem(`Importacao concluida: ${formatarNumero(resultado.enviados)} pedido(s) salvos.`);
      setArquivo(null);
      await atualizarDiagnostico();
      await atualizarGrid();
    } catch (error) {
      setErro(error.message || 'Erro ao importar arquivo.');
    } finally {
      setCarregando(false);
      setProgresso(null);
    }
  }

  async function cruzar() {
    setCarregando(true);
    setErro('');
    setProgressoPct(0);
    setMensagem('Cruzando pedidos com Tracking e base de CT-e...');
    const totalAlvo = Math.max((diagnostico.total || 0) - (diagnostico.cruzados || 0), 1);
    try {
      const resultado = await cruzarEcommerceComTrackingECte({
        onProgress: (evt) => {
          setProgressoPct((evt.totalProcessado / totalAlvo) * 100);
          setMensagem(`Processados: ${formatarNumero(evt.totalProcessado)} de ${formatarNumero(totalAlvo)} - OK: ${formatarNumero(evt.totalOk)} - Sem tracking: ${formatarNumero(evt.totalSemTracking)} - Sem CT-e: ${formatarNumero(evt.totalSemCte)}`);
        },
      });
      setProgressoPct(100);
      setMensagem(`Cruzamento concluido. OK: ${formatarNumero(resultado.totalOk)} - Sem tracking: ${formatarNumero(resultado.totalSemTracking)} - Sem CT-e: ${formatarNumero(resultado.totalSemCte)}`);
      await atualizarDiagnostico();
      await atualizarGrid();
    } catch (error) {
      setErro(error.message || 'Erro ao cruzar base.');
    } finally {
      setCarregando(false);
    }
  }

  async function resimular() {
    setCarregando(true);
    setErro('');
    setProgressoPct(0);
    setMensagem('Carregando malha de transportadoras B2C...');
    const totalAlvo = Math.max(diagnosticoSim.pendentes || 0, 1);
    try {
      const resultado = await resimularEcommerceEmLotes({
        criterioB2c: { usarPonderadoB2c: true, pesoPreco: 80, pesoPrazo: 20 },
        onProgress: (evt) => {
          if (evt.totalProcessado !== undefined) setProgressoPct((evt.totalProcessado / totalAlvo) * 100);
          setMensagem(evt.mensagem || '');
        },
      });
      setProgressoPct(100);
      setMensagem(`Resimulacao concluida. Processados: ${formatarNumero(resultado.totalProcessado)} - OK: ${formatarNumero(resultado.totalOk)}`);
      await atualizarDiagnostico();
      await atualizarGrid();
    } catch (error) {
      setErro(error.message || 'Erro ao resimular pedidos.');
    } finally {
      setCarregando(false);
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
      {carregando ? (
        <div className="panel-card" style={{ marginBottom: 16 }}>
          <BarraProgresso mensagem={mensagem} pct={progressoPct} />
        </div>
      ) : null}

      <section className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Importar base de pedidos</div>
            <p>Suba o CSV exportado do marketplace (OrderSnapshotAnalytics). O envio faz upsert por numero de Pedido.</p>
          </div>
          <div className="actions-right gap-row">
            <button className="btn-secondary" type="button" onClick={() => { atualizarDiagnostico(); atualizarGrid(); }} disabled={carregando}>Atualizar</button>
            <button className="btn-primary" type="button" onClick={cruzar} disabled={carregando}>Cruzar Tracking + CT-e</button>
            <button className="btn-primary" type="button" onClick={resimular} disabled={carregando}>Resimular cenario ideal</button>
          </div>
        </div>

        <div className="form-grid two">
          <label className="field">
            Arquivo CSV
            <input type="file" accept=".csv" onChange={(event) => setArquivo(event.target.files?.[0] || null)} />
          </label>
        </div>

        {progresso ? (
          <div className="summary-strip lotacao-summary-mini" style={{ marginTop: 12 }}>
            <div className="summary-card"><span>Lote</span><strong>{progresso.lote}/{progresso.totalLotes}</strong></div>
            <div className="summary-card"><span>Enviados</span><strong>{formatarNumero(progresso.enviados)}</strong></div>
            <div className="summary-card"><span>Total</span><strong>{formatarNumero(progresso.total)}</strong></div>
          </div>
        ) : null}

        <div className="actions-right" style={{ marginTop: 12 }}>
          <button className="btn-primary" type="button" onClick={importar} disabled={carregando || !arquivo}>
            {carregando ? 'Processando...' : 'Importar pedidos'}
          </button>
        </div>
      </section>

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
                    <FiltroColuna
                      coluna={coluna}
                      valoresUnicos={valoresUnicosPorColuna[coluna.chave] || []}
                      selecionados={filtros[coluna.chave]}
                      onChange={onChangeFiltro}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhasFiltradas.map((row) => (
                <tr key={row.id}>
                  {COLUNAS_TABELA.map((coluna) => <td key={coluna.chave} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{celula(row, coluna)}</td>)}
                </tr>
              ))}
              {!linhasFiltradas.length && <tr><td colSpan={COLUNAS_TABELA.length}>Nenhum pedido encontrado.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
