import { useEffect, useMemo, useRef, useState } from 'react';
import {
  parseOrderSnapshotCsv,
  importarEcommerceOrderSnapshot,
  diagnosticarEcommerceOrderSnapshot,
  cruzarEcommerceComTrackingECte,
  listarEcommerceOrderSnapshot,
  diagnosticarResimulacaoEcommerce,
  resimularEcommerceEmLotes,
  carregarMalhaParaResimulacaoEcommerce,
  assinaturaMalhaResimulacaoEcommerce,
  processarResimulacaoPorOrigemEcommerce,
  processarUmaOrigemEcommerce,
  mapearOrigensParaResimulacaoEcommerce,
  finalizarResimulacaoPorOrigemEcommerce,
  listarOpcoesFiltroEcommerce,
  contarElegiveisResimulacaoEcommerce,
  contarJaResimuladosParaFiltro,
  consultarTabelaOrigemDb,
  carregarMapaCdCentros,
  carregarIndicadoresEcommerce,
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

function rankingBi(itens, campo, limite = 10) {
  const mapa = new Map();
  itens.forEach((item) => {
    const nome = item[campo] || 'Nao identificada';
    const atual = mapa.get(nome) || { nome, quantidade: 0, perda: 0, campanhas: 0 };
    atual.quantidade += 1;
    atual.perda += Number(item.perda || 0);
    if (item.campanha) atual.campanhas += 1;
    mapa.set(nome, atual);
  });
  return [...mapa.values()]
    .map((item) => ({ ...item, perda: Number(item.perda.toFixed(2)) }))
    .sort((a, b) => b.perda - a.perda || b.quantidade - a.quantidade)
    .slice(0, limite);
}

function competenciaBi(data) {
  if (!data) return 'Sem data';
  const valor = new Date(data);
  if (Number.isNaN(valor.getTime())) return 'Sem data';
  return `${valor.getFullYear()}-${String(valor.getMonth() + 1).padStart(2, '0')}`;
}

function semanaBi(data) {
  if (!data) return 'Sem data';
  const valor = new Date(data);
  if (Number.isNaN(valor.getTime())) return 'Sem data';
  const dia = new Date(Date.UTC(valor.getFullYear(), valor.getMonth(), valor.getDate()));
  const numeroDia = dia.getUTCDay() || 7;
  dia.setUTCDate(dia.getUTCDate() + 4 - numeroDia);
  const inicioAno = new Date(Date.UTC(dia.getUTCFullYear(), 0, 1));
  const semana = Math.ceil((((dia - inicioAno) / 86400000) + 1) / 7);
  return `${dia.getUTCFullYear()}-S${String(semana).padStart(2, '0')}`;
}

function consolidarItensBi(itens = []) {
  const desvios = itens.filter((item) => Number(item.perda || 0) > 0);
  const valorPagoAMais = desvios.reduce((soma, item) => soma + Number(item.perda || 0), 0);
  return {
    total: itens.length,
    ressimulados: itens.length,
    mesmaTransportadora: itens.filter((item) => item.mesmaTransportadora === true).length,
    outraTransportadora: itens.filter((item) => item.mesmaTransportadora === false).length,
    casosPagoAMais: desvios.length,
    valorPagoAMais: Number(valorPagoAMais.toFixed(2)),
    economiaMedia: desvios.length ? Number((valorPagoAMais / desvios.length).toFixed(2)) : 0,
    maiorDesvio: desvios.reduce((maior, item) => Math.max(maior, Number(item.perda || 0)), 0),
    pagosAMaisComCampanha: desvios.filter((item) => item.campanha).length,
    pagosAMaisPesoDiferente: desvios.filter((item) => item.diferencaPeso).length,
    pagosAMaisComTaxaMarketplace: desvios.filter((item) => Number(item.taxaMarketplace || 0) > 0).length,
    valorTaxaMarketplace: Number(desvios.reduce((soma, item) => soma + Number(item.taxaMarketplace || 0), 0).toFixed(2)),
    perdaComTaxaMarketplace: Number(desvios.filter((item) => Number(item.taxaMarketplace || 0) > 0).reduce((soma, item) => soma + Number(item.perda || 0), 0).toFixed(2)),
    alternativas: rankingBi(desvios, 'transportadoraIdeal'),
    transportadorasUsadas: rankingBi(desvios, 'transportadoraUsada'),
    origensIdeais: rankingBi(desvios, 'origemIdeal'),
    origensUsadas: rankingBi(desvios, 'origemUsada'),
    competencias: rankingBi(desvios.map((item) => ({ ...item, periodo: competenciaBi(item.dataCriacao) })), 'periodo', 60).sort((a, b) => a.nome.localeCompare(b.nome)),
    semanas: rankingBi(desvios.map((item) => ({ ...item, periodo: semanaBi(item.dataCriacao) })), 'periodo', 104).sort((a, b) => a.nome.localeCompare(b.nome)),
  };
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
  { chave: 'cubagem_cotada', label: 'Cubagem NF (m3)', tipo: 'numero3' },
  { chave: 'sim_fator_cubagem', label: 'Fator cubagem ideal', tipo: 'numero2' },
  { chave: 'sim_peso_cubado', label: 'Peso cubado ideal (kg)', tipo: 'numero2' },
  { chave: 'sim_peso_considerado', label: 'Peso final ideal (kg)', tipo: 'numero2' },
  { chave: 'sim_transportadora_ideal', label: 'Transportadora ideal', tipo: 'texto' },
  { chave: 'sim_origem_ideal', label: 'CD ideal', tipo: 'texto' },
  { chave: 'sim_origem_validada', label: 'Tabela validada?', tipo: 'bool' },
  { chave: 'sim_valor_ideal', label: 'Valor ideal', tipo: 'moeda' },
  { chave: 'sim_prazo_ideal', label: 'Prazo ideal (dias)', tipo: 'numero2' },
  { chave: 'sim_diferenca_vs_cte', label: 'Dif. Ideal x CT-e real', tipo: 'moeda' },
  { chave: 'sim_mesma_transportadora', label: 'Mesma transp.?', tipo: 'bool' },
  { chave: 'cds_com_saldo_venda', label: 'CDs c/ Saldo', tipo: 'texto' },
  { chave: 'sim_candidatos', label: 'Opcoes simuladas', tipo: 'acao' },
];

function renderCdsComSaldo(valor, mapaCdCentros) {
  const codigos = String(valor || '').split(',').map((c) => c.trim()).filter(Boolean);
  if (!codigos.length) return '-';
  return codigos.map((codigo) => `${codigo} (${mapaCdCentros.get(codigo) || '?'})`).join(', ');
}

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
  const detalheVencedor = Array.isArray(row.sim_candidatos) ? row.sim_candidatos[0]?.detalhes : null;
  const valoresCalculados = {
    sim_fator_cubagem: detalheVencedor?.fatorCubagem,
    sim_peso_cubado: detalheVencedor?.pesoCubadoCalculado ?? detalheVencedor?.pesoCubado,
    sim_peso_considerado: detalheVencedor?.pesoConsiderado,
  };
  const valor = row[coluna.chave] ?? valoresCalculados[coluna.chave];
  if (coluna.tipo === 'acao') return '';
  if (coluna.tipo === 'moeda') return formatarMoeda(valor);
  if (coluna.tipo === 'numero2') return formatarNumero(valor, 2);
  if (coluna.tipo === 'numero3') return formatarNumero(valor, 3);
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
    dataInicio: '', dataFim: '', cruzamentoStatus: '', simStatus: '', divergenciaPeso: false, canal: '', uf: '', possuiCampanha: '', cdCidade: '', cteTransportadora: '',
  });
  const [opcoesFiltro, setOpcoesFiltro] = useState({ canais: [], ufs: [], transportadorasCte: [] });
  const [cdCentros, setCdCentros] = useState({ mapa: new Map(), cidades: [] });
  // Processa um peso por rodada para reduzir o volume; cada resultado fica preservado
  // separadamente e pode ser complementado depois pelo segundo peso.
  const [pesoBase, setPesoBase] = useState('cotado');
  const [considerarPrazo, setConsiderarPrazo] = useState(true);
  const [restringirCds, setRestringirCds] = useState(false);
  const [usarSaldoDia, setUsarSaldoDia] = useState(true);
  const [incluirSemCruzamento, setIncluirSemCruzamento] = useState(false);
  const [autoRetry, setAutoRetry] = useState(false);
  const [avisoRetry, setAvisoRetry] = useState('');
  const [malhaPronta, setMalhaPronta] = useState(null);
  const [carregandoMalha, setCarregandoMalha] = useState(false);
  const [origensMapeadas, setOrigensMapeadas] = useState(null);
  const [mapeandoOrigens, setMapeandoOrigens] = useState(false);
  const [origemProcessandoAgora, setOrigemProcessandoAgora] = useState(null);
  const [seguirAutomaticamente, setSeguirAutomaticamente] = useState(true);
  const [forcarFechamentoParcial, setForcarFechamentoParcial] = useState(false);
  const [refazerTudoFaseado, setRefazerTudoFaseado] = useState(false);
  const [painelCandidatos, setPainelCandidatos] = useState(null);
  const [tabelaConsultada, setTabelaConsultada] = useState(null);
  const [abaPrincipal, setAbaPrincipal] = useState('operacao');
  const [indicadores, setIndicadores] = useState(null);
  const [cenarioPainel, setCenarioPainel] = useState('cotado');
  const [carregandoIndicadores, setCarregandoIndicadores] = useState(false);
  const [linhasIndicadoresLidas, setLinhasIndicadoresLidas] = useState(0);
  const [filtrosBi, setFiltrosBi] = useState({ somenteDesvios: false, campanha: null, diferencaPeso: null, pesoInconsistente: null, taxaMarketplace: null, transportadoraIdeal: '', transportadoraUsada: '', origemIdeal: '', origemUsada: '', competencia: '', semana: '' });

  async function atualizarIndicadores() {
    setErro('');
    setCarregandoIndicadores(true);
    setLinhasIndicadoresLidas(0);
    try {
      const resultado = await carregarIndicadoresEcommerce({
        filtros: filtrosParaQuery(filtrosServidor),
        cenarioPeso: cenarioPainel,
        onProgress: ({ carregados }) => setLinhasIndicadoresLidas(carregados),
      });
      setIndicadores(resultado);
      setFiltrosBi({ somenteDesvios: false, campanha: null, diferencaPeso: null, pesoInconsistente: null, taxaMarketplace: null, transportadoraIdeal: '', transportadoraUsada: '', origemIdeal: '', origemUsada: '', competencia: '', semana: '' });
    } catch (error) {
      setErro(error.message || 'Erro ao carregar indicadores.');
    } finally {
      setCarregandoIndicadores(false);
    }
  }

  async function abrirTabelaCadastrada(cand) {
    setTabelaConsultada({ carregando: true, transportadora: cand.transportadora, origemCidade: cand.origem, cand });
    try {
      const resultado = await consultarTabelaOrigemDb({
        transportadora: cand.transportadora,
        origemCidade: cand.origem,
        ibgeDestino: cand.ibgeDestino,
      });
      setTabelaConsultada({ carregando: false, transportadora: cand.transportadora, origemCidade: cand.origem, cand, resultado });
    } catch (error) {
      setTabelaConsultada({ carregando: false, transportadora: cand.transportadora, origemCidade: cand.origem, cand, erro: error.message || 'Erro ao consultar tabela.' });
    }
  }
  const [resumoResimulacao, setResumoResimulacao] = useState(null);
  const [contandoResumo, setContandoResumo] = useState(false);

  function filtrosParaQuery(f) {
    const codigosDaCidade = f.cdCidade
      ? [...cdCentros.mapa.entries()].filter(([, cidade]) => cidade === f.cdCidade).map(([codigo]) => codigo)
      : null;
    return {
      dataInicio: f.dataInicio || null,
      dataFim: f.dataFim || null,
      cruzamentoStatus: f.cruzamentoStatus || null,
      simStatus: f.simStatus || null,
      divergenciaPeso: Boolean(f.divergenciaPeso),
      canal: f.canal || null,
      uf: f.uf || null,
      cteTransportadora: f.cteTransportadora || null,
      possuiCampanha: f.possuiCampanha === '' ? null : f.possuiCampanha === 'true',
      cdCodigos: codigosDaCidade,
    };
  }

  function onChangeFiltroServidor(campo, valor) {
    setFiltrosServidor((atual) => ({ ...atual, [campo]: valor }));
    setResumoResimulacao(null);
  }

  function limparFiltrosServidor() {
    setFiltrosServidor({
      dataInicio: '', dataFim: '', cruzamentoStatus: '', simStatus: '', divergenciaPeso: false,
      canal: '', uf: '', possuiCampanha: '', cdCidade: '', cteTransportadora: '',
    });
    setResumoResimulacao(null);
    setOrigensMapeadas(null);
    setForcarFechamentoParcial(false);
    setFiltros({});
  }

  async function atualizarDiagnostico() {
    try {
      const filtrosAtuais = filtrosParaQuery(filtrosServidor);
      const [diag, diagSim] = await Promise.all([
        diagnosticarEcommerceOrderSnapshot(filtrosAtuais),
        diagnosticarResimulacaoEcommerce(filtrosAtuais, { incluirSemCruzamento }),
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
    carregarMapaCdCentros().then(setCdCentros).catch(() => {});
  }, []);

  useEffect(() => {
    atualizarDiagnostico();
    atualizarGrid();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtrosServidor, incluirSemCruzamento]);

  async function importar() {
    if (!arquivo) {
      setErro('Selecione o arquivo OrderSnapshotAnalytics (.csv).');
      return;
    }
    setCarregando(true);
    setErro('');
    setMensagem('');
    setProgressoAmd({ etapa: 'verificando_existentes', carregados: 0, total: null });
    const totalAntes = diagnostico.total || 0;
    try {
      const texto = await arquivo.text();
      const registros = parseOrderSnapshotCsv(texto);
      if (!registros.length) throw new Error('Nenhuma linha valida encontrada no arquivo.');
      setProgressoAmd({ etapa: 'salvando_pedidos_ecommerce', carregados: 0, total: registros.length });
      const resultado = await importarEcommerceOrderSnapshot(registros, {
        onProgress: (evt) => setProgressoAmd(evt),
      });
      setMensagem(
        `Importacao concluida: ${formatarNumero(resultado.enviados)} pedido(s) processados — `
        + `${formatarNumero(resultado.novos)} novo(s), ${formatarNumero(resultado.atualizados)} atualizado(s). `
        + `Base: ${formatarNumero(totalAntes)} -> ${formatarNumero(totalAntes + resultado.novos)} pedido(s).`
      );
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
    // Busca o diagnostico na hora (nao usa o `diagnostico` do estado, que pode estar
    // desatualizado - ex: pedidos resetados pra 'pendente' via SQL direto no banco,
    // sem passar pela tela) - senao o alvo da barra de progresso fica errado.
    const diagAtual = await diagnosticarEcommerceOrderSnapshot(filtrosParaQuery(filtrosServidor));
    const totalAlvo = Math.max((diagAtual.total || 0) - (diagAtual.cruzados || 0), 1);
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

  function assinaturaMalhaAtual(filtrosAtuais, refazerTudo = false) {
    return assinaturaMalhaResimulacaoEcommerce({
      filtros: filtrosAtuais,
      refazerTudo,
      incluirSemCruzamento,
      usarSaldoDia,
      cdsPermitidos: restringirCds ? CDS_RESTRICAO : [],
    });
  }

  // Passo 1 (separado da simulacao): so baixa rotas/cotacoes/CDs pro recorte atual e guarda
  // em memoria. Pensado pra nao precisar recarregar essa parte (a mais lenta e a que mais
  // falha por timeout em recortes grandes) toda vez que algo der errado no meio do caminho.
  async function carregarMalha() {
    setErro('');
    setMensagem('');
    setAvisoRetry('');
    setCarregandoMalha(true);
    setProgressoAmd({ etapa: 'carregando_tabelas_completas_fallback', carregados: 0, total: null });
    try {
      const filtrosAtuais = filtrosParaQuery(filtrosServidor);
      const malha = await carregarMalhaParaResimulacaoEcommerce({
        filtros: filtrosAtuais,
        refazerTudo: false,
        incluirSemCruzamento,
        usarSaldoDia,
        cdsPermitidos: restringirCds ? CDS_RESTRICAO : [],
        onProgress: (evt) => setProgressoAmd(evt),
      });
      setMalhaPronta(malha);
      setMensagem('Malha carregada e guardada. Agora pode clicar em "Resimular cenario ideal" quantas vezes precisar, sem baixar de novo.');
    } catch (error) {
      setErro(error.message || 'Erro ao carregar malha.');
    } finally {
      setCarregandoMalha(false);
      setProgressoAmd({});
    }
  }

  // Chama fn() de novo automaticamente se der erro (mesma logica do retry da resimulacao
  // em lotes), esperando um pouco mais a cada tentativa. Generico pra reusar no fluxo por
  // origem, que e retomavel por natureza (origens ja concluidas sao puladas de novo).
  async function comRetryGenerico(fn, tentativasMax = 200) {
    let tentativa = 0;
    for (;;) {
      try {
        return await fn();
      } catch (error) {
        tentativa += 1;
        console.error(`[AuditoriaEcommerce] erro (tentativa ${tentativa}):`, error);
        if (tentativa >= tentativasMax) throw error;
        const esperaMs = Math.min(5000 * tentativa, 60000);
        setAvisoRetry(`⚠ Erro (tentativa ${tentativa}): ${error.message || 'erro desconhecido'}. Retomando automaticamente em ${Math.round(esperaMs / 1000)}s...`);
        await new Promise((resolve) => setTimeout(resolve, esperaMs));
        setAvisoRetry('');
      }
    }
  }

  // Fase 1 do fluxo por origem: processa um CD por vez (malha pequena, rapida), acumula
  // os candidatos calculados em staging. Retomavel - origens ja concluidas sao puladas se
  // chamar de novo (mesmos filtros/opcoes).
  async function processarPorOrigem() {
    setErro('');
    setMensagem('');
    setAvisoRetry('');
    setCarregando(true);
    setProgressoAmd({ etapa: 'mapeando_destinos_pedidos', carregados: 0, total: null });
    try {
      const filtrosAtuais = filtrosParaQuery(filtrosServidor);
      const executar = () => processarResimulacaoPorOrigemEcommerce({
        filtros: filtrosAtuais,
        refazerTudo: refazerTudoFaseado,
        incluirSemCruzamento,
        pesoBase,
        onProgress: (evt) => setProgressoAmd(evt),
      });
      const resultado = await (autoRetry ? comRetryGenerico(executar) : executar());
      setMensagem(`Origens processadas: ${formatarNumero(resultado.origensProcessadas)} de ${formatarNumero(resultado.totalOrigens)}. Agora clique em "Fechar resimulacao".`);
    } catch (error) {
      setErro(error.message || 'Erro ao processar origens.');
    } finally {
      setCarregando(false);
      setProgressoAmd({});
      setAvisoRetry('');
    }
  }

  // Levanta a lista de origens (CDs com saldo) do recorte atual, com quantidade de
  // pedidos de cada uma, e mostra na tela antes de comecar - pra dar visibilidade real
  // do que vai ser processado, em vez de uma caixa preta.
  async function mapearOrigens() {
    setErro('');
    setMensagem('');
    setMapeandoOrigens(true);
    setProgressoAmd({ etapa: 'mapeando_destinos_pedidos', carregados: 0, total: null });
    try {
      const filtrosAtuais = filtrosParaQuery(filtrosServidor);
      const { origens } = await mapearOrigensParaResimulacaoEcommerce({
        filtros: filtrosAtuais,
        refazerTudo: refazerTudoFaseado,
        incluirSemCruzamento,
        pesoBase,
        onProgress: (evt) => setProgressoAmd(evt),
      });
      setOrigensMapeadas(origens);
      if (!origens.length) setMensagem('Nenhuma origem com pedido elegivel nesse recorte.');
    } catch (error) {
      setErro(error.message || 'Erro ao mapear origens.');
    } finally {
      setMapeandoOrigens(false);
      setProgressoAmd({});
    }
  }

  // Roda UMA origem da lista mapeada. Se "seguir automaticamente" estiver ligado, ao
  // terminar (e marcar o check) segue sozinho pra proxima origem pendente da lista.
  async function rodarOrigem(cidade, listaBase = origensMapeadas) {
    setErro('');
    setAvisoRetry('');
    setOrigemProcessandoAgora(cidade);
    setCarregando(true);
    setProgressoAmd({ etapa: 'processando_origem', origemAtual: cidade, carregados: 0, total: null });
    try {
      const filtrosAtuais = filtrosParaQuery(filtrosServidor);
      const executar = () => processarUmaOrigemEcommerce({
        origemCidade: cidade,
        filtros: filtrosAtuais,
        refazerTudo: refazerTudoFaseado,
        incluirSemCruzamento,
        pesoBase,
        onProgress: (evt) => setProgressoAmd({ ...evt, origemAtual: cidade }),
      });
      const resultado = await (autoRetry ? comRetryGenerico(executar) : executar());
      // Passa a lista atualizada explicitamente pra recursao (em vez de reler o estado
      // do React) - senao a chamada seguinte enxergaria a lista antiga (closure obsoleta),
      // achando que a origem que acabou de rodar ainda esta pendente.
      const listaAtualizada = (listaBase || []).map((o) => (o.cidade === cidade ? { ...o, concluida: true, totalPedidosProcessados: resultado.totalPedidos } : o));
      setOrigensMapeadas(listaAtualizada);
      setMensagem(`Origem "${cidade}" concluida (${formatarNumero(resultado.totalPedidos)} pedido(s)).`);

      if (seguirAutomaticamente) {
        const proxima = listaAtualizada.find((o) => !o.concluida);
        if (proxima) {
          setCarregando(false);
          await rodarOrigem(proxima.cidade, listaAtualizada);
          return;
        }
      }
    } catch (error) {
      setErro(`Erro na origem "${cidade}": ${error.message || 'erro desconhecido'}`);
    } finally {
      setOrigemProcessandoAgora(null);
      setCarregando(false);
      setProgressoAmd({});
      setAvisoRetry('');
    }
  }

  // Fase 2: junta os candidatos acumulados por pedido e escolhe o vencedor, gravando o
  // resultado final. So faz sentido depois que "Processar por origem" ja rodou.
  async function fecharResimulacao() {
    setErro('');
    setMensagem('');
    setCarregando(true);
    setProgressoAmd({ etapa: 'salvando_resultados', carregados: 0, total: null });
    try {
      const filtrosAtuais = filtrosParaQuery(filtrosServidor);
      const criterioB2c = considerarPrazo
        ? { usarPonderadoB2c: true, pesoPreco: 80, pesoPrazo: 20 }
        : { usarPonderadoB2c: false };
      const resultado = await finalizarResimulacaoPorOrigemEcommerce({
        filtros: filtrosAtuais,
        refazerTudo: refazerTudoFaseado,
        incluirSemCruzamento,
        permitirFechamentoParcial: forcarFechamentoParcial,
        origensEsperadas: (origensMapeadas || []).map((origem) => origem.cidade),
        criterioB2c,
        pesoBase,
        onProgress: (evt) => setProgressoAmd(evt),
      });
      setMensagem(`Resimulacao fechada. Processados: ${formatarNumero(resultado.totalProcessado)} - OK: ${formatarNumero(resultado.totalOk)}`);
      await atualizarDiagnostico();
      await atualizarGrid();
    } catch (error) {
      setErro(error.message || 'Erro ao fechar resimulacao.');
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
      const [pendentes, jaFeitos] = await Promise.all([
        contarElegiveisResimulacaoEcommerce(filtrosAtuais, { incluirSemCruzamento }),
        contarJaResimuladosParaFiltro(filtrosAtuais, { incluirSemCruzamento }),
      ]);
      setResumoResimulacao({
        origem: 'servidor',
        count: pendentes,
        pendentes,
        jaFeitos,
        refazerTudo: false,
        filtros: { ...filtrosServidor },
        pesoBase,
        cdsPermitidos: restringirCds ? CDS_RESTRICAO : [],
        usarSaldoDia,
        incluirSemCruzamento,
        autoRetry,
        assinaturaMalha: assinaturaMalhaAtual(filtrosAtuais, false),
      });
    } catch (error) {
      setErro(error.message || 'Erro ao contar pedidos para resimular.');
    } finally {
      setContandoResumo(false);
    }
  }

  // Cada pedido processado ja fica salvo com sim_status='ok' no banco, entao chamar
  // resimularEcommerceEmLotes de novo depois de um erro naturalmente continua so do que
  // falta (nunca reprocessa o que ja foi feito). Aqui so automatiza esse "chamar de novo",
  // pra poder deixar rodando sem supervisao (ex: durante a noite) sem precisar clicar de novo
  // toda vez que cair um timeout/erro de rede.
  async function resimularEmLotesComRetry(args, tentativasMax = 200) {
    let tentativa = 0;
    for (;;) {
      try {
        return await resimularEcommerceEmLotes(args);
      } catch (error) {
        tentativa += 1;
        console.error(`[AuditoriaEcommerce] erro na resimulacao (tentativa ${tentativa}):`, error);
        if (tentativa >= tentativasMax) throw error;
        const esperaMs = Math.min(5000 * tentativa, 60000);
        setAvisoRetry(`⚠ Erro (tentativa ${tentativa}): ${error.message || 'erro desconhecido'}. Retomando automaticamente em ${Math.round(esperaMs / 1000)}s...`);
        await new Promise((resolve) => setTimeout(resolve, esperaMs));
        setAvisoRetry('');
      }
    }
  }

  async function confirmarResimulacao() {
    if (!resumoResimulacao) return;
    setCarregando(true);
    setErro('');
    setMensagem('');
    setAvisoRetry('');
    const resumo = resumoResimulacao;
    setResumoResimulacao(null);
    setProgressoAmd({ etapa: 'carregando_tabelas_completas_fallback', carregados: 0, total: null });
    try {
      // Por padrao "ideal" e o mais barato; com o toggle "Considerar prazo" liga
      // a mesma ponderacao 80/20 preco x prazo que o marketplace usa na oferta.
      const criterioB2c = considerarPrazo
        ? { usarPonderadoB2c: true, pesoPreco: 80, pesoPrazo: 20 }
        : { usarPonderadoB2c: false };
      // So reaproveita a malha ja baixada (botao "1. Carregar malha") se ela corresponde
      // exatamente ao recorte/opcoes que vai rodar agora - senao deixa a funcao carregar
      // do zero sozinha (fallback seguro, so mais lento).
      const assinaturaNecessaria = assinaturaMalhaAtual(filtrosParaQuery(resumo.filtros), resumo.refazerTudo);
      const malhaParaUsar = malhaPronta && malhaPronta.assinatura === assinaturaNecessaria ? malhaPronta : null;
      const resultado = await (resumo.autoRetry ? resimularEmLotesComRetry : resimularEcommerceEmLotes)({
          criterioB2c,
          incluirSemCruzamento: resumo.incluirSemCruzamento,
          pesoBase: resumo.pesoBase,
          cdsPermitidos: resumo.cdsPermitidos,
          usarSaldoDia: resumo.usarSaldoDia,
          refazerTudo: resumo.refazerTudo,
          malhaPronta: malhaParaUsar,
          totalAlvo: Math.max((resumo.refazerTudo ? resumo.pendentes + resumo.jaFeitos : resumo.pendentes) || 0, 1),
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
      setAvisoRetry('');
    }
  }

  const origensPendentesCount = useMemo(
    () => (origensMapeadas ? origensMapeadas.filter((o) => !o.concluida).length : 0),
    [origensMapeadas]
  );

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

  const itensBiFiltrados = useMemo(() => (indicadores?.itens || []).filter((item) => {
    if (filtrosBi.somenteDesvios && !(item.perda > 0)) return false;
    if (filtrosBi.campanha !== null && item.campanha !== filtrosBi.campanha) return false;
    if (filtrosBi.diferencaPeso !== null && item.diferencaPeso !== filtrosBi.diferencaPeso) return false;
    if (filtrosBi.pesoInconsistente !== null && item.pesoPossivelmenteInconsistente !== filtrosBi.pesoInconsistente) return false;
    if (filtrosBi.taxaMarketplace !== null && (Number(item.taxaMarketplace || 0) > 0) !== filtrosBi.taxaMarketplace) return false;
    if (filtrosBi.transportadoraIdeal && item.transportadoraIdeal !== filtrosBi.transportadoraIdeal) return false;
    if (filtrosBi.transportadoraUsada && item.transportadoraUsada !== filtrosBi.transportadoraUsada) return false;
    if (filtrosBi.origemIdeal && item.origemIdeal !== filtrosBi.origemIdeal) return false;
    if (filtrosBi.origemUsada && item.origemUsada !== filtrosBi.origemUsada) return false;
    if (filtrosBi.competencia && competenciaBi(item.dataCriacao) !== filtrosBi.competencia) return false;
    if (filtrosBi.semana && semanaBi(item.dataCriacao) !== filtrosBi.semana) return false;
    return true;
  }), [indicadores, filtrosBi]);

  const indicadoresBi = useMemo(() => consolidarItensBi(itensBiFiltrados), [itensBiFiltrados]);

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
      <AmdProcessingOverlay ativo={carregando || carregandoMalha} progresso={progressoAmd} mensagemRodape={avisoRetry || 'Pode levar mais tempo em bases grandes.'} />

      <div className="tabs-row audit-main-tabs" style={{ marginBottom: 12 }}>
        <button className={abaPrincipal === 'operacao' ? 'tab-btn active' : 'tab-btn'} type="button" onClick={() => setAbaPrincipal('operacao')}>Operacao e pedidos</button>
        <button className={abaPrincipal === 'indicadores' ? 'tab-btn active' : 'tab-btn'} type="button" onClick={() => setAbaPrincipal('indicadores')}>Painel de indicadores</button>
      </div>

      <div style={{ display: abaPrincipal === 'operacao' ? 'contents' : 'none' }}>

      <section className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Importar base de pedidos</div>
            <p>Suba o CSV exportado do marketplace (OrderSnapshotAnalytics). O envio faz upsert por numero de Pedido.</p>
          </div>
          <div className="actions-right gap-row">
            <button className="btn-secondary" type="button" onClick={() => { atualizarDiagnostico(); atualizarGrid(); }} disabled={carregando || carregandoMalha}>Atualizar</button>
            <button className="btn-primary" type="button" onClick={cruzar} disabled={carregando || carregandoMalha}>Cruzar Tracking + CT-e</button>
          </div>
        </div>
        <div className="section-row compact-top" style={{ marginTop: 10 }}>
          <div>
            <div className="panel-title">Resimular por origem (recomendado)</div>
            <p className="compact">Mapeia os CDs com saldo do recorte e processa um por vez (carga pequena, resistente a timeout). Retomavel: origem ja concluida fica marcada e nao roda de novo.</p>
          </div>
          <div className="actions-right gap-row">
            <button className="btn-secondary" type="button" onClick={mapearOrigens} disabled={carregando || carregandoMalha || mapeandoOrigens}>
              {mapeandoOrigens ? 'Mapeando...' : origensMapeadas ? '1. Mapear origens (atualizar)' : '1. Mapear origens'}
            </button>
            <button
              className="btn-primary"
              type="button"
              onClick={fecharResimulacao}
              disabled={carregando || carregandoMalha || (origensPendentesCount > 0 && !forcarFechamentoParcial)}
              title={origensPendentesCount > 0 && !forcarFechamentoParcial ? `Faltam ${origensPendentesCount} origem(ns) processar` : ''}
            >
              2. Fechar resimulacao
            </button>
          </div>
        </div>

        {origensMapeadas && origensPendentesCount > 0 ? (
          <p className="compact" style={{ color: '#b45309', marginTop: 4 }}>
            ⚠ Faltam {formatarNumero(origensPendentesCount)} origem(ns) processar. Fechar agora pode marcar pedidos como "sem_malha" so porque a origem certa deles ainda nao rodou.{' '}
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 6 }}>
              <input type="checkbox" checked={forcarFechamentoParcial} onChange={(e) => setForcarFechamentoParcial(e.target.checked)} />
              Fechar mesmo assim (parcial)
            </label>
          </p>
        ) : null}

        {origensMapeadas && origensMapeadas.length ? (
          <div style={{ marginTop: 8, border: '1px solid #e2e8f0', borderRadius: 8, padding: 10 }}>
            <div className="section-row compact-top" style={{ marginBottom: 6 }}>
              <p className="compact" style={{ margin: 0 }}>
                <strong>{formatarNumero(origensMapeadas.filter((o) => o.concluida).length)}</strong> de <strong>{formatarNumero(origensMapeadas.length)}</strong> origens concluidas.
              </p>
              <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, margin: 0 }}>
                <input type="checkbox" checked={seguirAutomaticamente} onChange={(e) => setSeguirAutomaticamente(e.target.checked)} />
                Seguir automaticamente pra proxima ao terminar
              </label>
            </div>
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {origensMapeadas.map((o) => (
                <div key={o.cidade} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 6px', borderBottom: '1px solid #f1f5f9', fontSize: '0.85rem' }}>
                  <span>
                    {o.concluida ? '✅' : origemProcessandoAgora === o.cidade ? '⏳' : '⬜'} {o.cidade}
                    <span style={{ color: '#94a3b8', marginLeft: 6 }}>({formatarNumero(o.quantidadePedidos)} pedido(s))</span>
                  </span>
                  <button
                    className="btn-secondary"
                    type="button"
                    style={{ padding: '2px 10px', fontSize: '0.78rem' }}
                    onClick={() => rodarOrigem(o.cidade)}
                    disabled={carregando || carregandoMalha || o.concluida}
                  >
                    {origemProcessandoAgora === o.cidade ? 'Rodando...' : o.concluida ? 'Concluida' : '▶ Rodar'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="section-row compact-top" style={{ marginTop: 10 }}>
          <div>
            <div className="panel-title">Resimular tudo de uma vez (recortes pequenos)</div>
            <p className="compact">Carrega a malha inteira do recorte numa tacada so. Mais rapido pra recortes pequenos (poucas dezenas/centenas de pedidos); pra recortes grandes, prefira "Resimular por origem" acima.</p>
          </div>
          <div className="actions-right gap-row">
            <button className="btn-secondary" type="button" onClick={carregarMalha} disabled={carregando || carregandoMalha}>
              {carregandoMalha ? 'Carregando malha...' : malhaPronta ? '1. Malha carregada ✓ (recarregar)' : '1. Carregar malha'}
            </button>
            <button className="btn-primary" type="button" onClick={prepararResimulacao} disabled={carregando || carregandoMalha || contandoResumo}>
              {contandoResumo ? 'Contando pedidos...' : '2. Resimular cenario ideal'}
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
        <div className="panel-header-row">
          <div className="panel-title">Filtros de analise</div>
          <button className="btn-secondary" type="button" onClick={limparFiltrosServidor}>Limpar todos os filtros</button>
        </div>
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
            Status resimulacao
            <select value={filtrosServidor.simStatus} onChange={(e) => onChangeFiltroServidor('simStatus', e.target.value)}>
              <option value="">Todos</option>
              <option value="ok">ok (resimulado)</option>
              <option value="pendente">pendente</option>
              <option value="sem_ibge_destino">sem_ibge_destino</option>
              <option value="sem_malha">sem_malha</option>
              <option value="sem_cotacao_peso">sem_cotacao_peso</option>
              <option value="sem_cd_saldo_reconhecido">sem_cd_saldo_reconhecido</option>
              <option value="sem_cd_saldo_informado">sem_cd_saldo_informado</option>
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
            Cidade do CD (saldo na venda)
            <select value={filtrosServidor.cdCidade} onChange={(e) => onChangeFiltroServidor('cdCidade', e.target.value)}>
              <option value="">Todas</option>
              {cdCentros.cidades.map((cidade) => <option key={cidade} value={cidade}>{cidade}</option>)}
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
            <select value={pesoBase} onChange={(e) => {
              setPesoBase(e.target.value);
              setOrigensMapeadas(null);
              setForcarFechamentoParcial(false);
            }}>
              <option value="cotado">Peso cotado (venda)</option>
              <option value="faturado">Peso faturado (transportadora)</option>
              <option value="ambos">Cotado + faturado na mesma rodada (mais pesado)</option>
            </select>
          </label>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={usarSaldoDia}
              onChange={(e) => { setUsarSaldoDia(e.target.checked); if (e.target.checked) setRestringirCds(false); }}
            />
            Filtro 1 — Restringir por saldo do pedido: usa a lista de CDs de "CDs com Saldo na Venda" de cada pedido (qualquer CD cadastrado, nao so os fixos abaixo)
          </label>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={restringirCds}
              onChange={(e) => { setRestringirCds(e.target.checked); if (e.target.checked) setUsarSaldoDia(false); }}
            />
            Filtro 2 — Restringir aos CDs fixos: {CDS_RESTRICAO.join(', ')} (senao, busca em todas as origens)
          </label>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={considerarPrazo} onChange={(e) => setConsiderarPrazo(e.target.checked)} />
            Considerar prazo no "ideal" (80% preco + 20% prazo, senao so o mais barato)
          </label>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={incluirSemCruzamento} onChange={(e) => setIncluirSemCruzamento(e.target.checked)} />
            Incluir pedidos sem cruzamento (sem_tracking/sem_cte) na resimulacao — perde a comparacao com o CT-e real
          </label>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={autoRetry} onChange={(e) => setAutoRetry(e.target.checked)} />
            Retomar sozinho se der erro/timeout (deixar rodando a noite, sem clicar de novo) — mantenha o computador ligado e a aba aberta
          </label>
          <label className="field">
            Transportadora do CT-e real
            <input
              type="text"
              list="transportadoras-cte-ecommerce"
              value={filtrosServidor.cteTransportadora}
              placeholder="Ex.: PATRUS"
              onChange={(e) => onChangeFiltroServidor('cteTransportadora', e.target.value)}
            />
            <datalist id="transportadoras-cte-ecommerce">
              {opcoesFiltro.transportadorasCte.map((nome) => <option key={nome} value={nome} />)}
            </datalist>
          </label>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={refazerTudoFaseado}
              onChange={(e) => {
                setRefazerTudoFaseado(e.target.checked);
                setOrigensMapeadas(null);
                setForcarFechamentoParcial(false);
              }}
            />
            Recalcular o recorte inteiro, inclusive os que já estão OK ou sem malha (use para comparar peso cotado x faturado)
          </label>
        </div>
      </section>

      {resumoResimulacao ? (
        <section className="panel-card" style={{ borderColor: '#818cf8' }}>
          <div className="panel-title">Confirmar resimulacao</div>
          <p className="compact">Peso usado no calculo: <strong>{resumoResimulacao.pesoBase === 'ambos' ? 'cotado e faturado' : resumoResimulacao.pesoBase === 'faturado' ? 'peso faturado' : 'peso cotado'}</strong></p>
          <p className="compact">
            Origens consideradas: <strong>{resumoResimulacao.cdsPermitidos?.length ? resumoResimulacao.cdsPermitidos.join(', ') : 'todas'}</strong>
          </p>
          <p>
            Nesse recorte (filtros ativos acima
            {resumoResimulacao.filtros.dataInicio || resumoResimulacao.filtros.dataFim ? (
              <> no periodo de <strong>{resumoResimulacao.filtros.dataInicio || '...'}</strong> ate <strong>{resumoResimulacao.filtros.dataFim || '...'}</strong></>
            ) : null}
            ): <strong>{formatarNumero(resumoResimulacao.jaFeitos)}</strong> ja foram resimulados antes,{' '}
            <strong>{formatarNumero(resumoResimulacao.pendentes)}</strong> ainda estao pendentes.
          </p>
          {resumoResimulacao.jaFeitos > 0 ? (
            <div className="form-grid" style={{ gap: 6, marginBottom: 8 }}>
              <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <input
                  type="radio"
                  name="refazerTudo"
                  checked={!resumoResimulacao.refazerTudo}
                  onChange={() => setResumoResimulacao((atual) => ({ ...atual, refazerTudo: false }))}
                />
                Continuar so com os {formatarNumero(resumoResimulacao.pendentes)} pendentes
              </label>
              <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <input
                  type="radio"
                  name="refazerTudo"
                  checked={resumoResimulacao.refazerTudo}
                  onChange={() => setResumoResimulacao((atual) => ({ ...atual, refazerTudo: true }))}
                />
                Refazer tudo, incluindo os {formatarNumero(resumoResimulacao.jaFeitos)} ja resimulados
              </label>
            </div>
          ) : null}
          <div className="actions-right gap-row">
            <button className="btn-secondary" type="button" onClick={() => setResumoResimulacao(null)}>Cancelar</button>
            <button
              className="btn-primary"
              type="button"
              onClick={confirmarResimulacao}
              disabled={!(resumoResimulacao.refazerTudo ? resumoResimulacao.pendentes + resumoResimulacao.jaFeitos : resumoResimulacao.pendentes)}
            >
              Confirmar resimulacao
            </button>
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
                      ) : coluna.chave === 'cds_com_saldo_venda' ? renderCdsComSaldo(row.cds_com_saldo_venda, cdCentros.mapa) : celula(row, coluna)}
                    </td>
                  ))}
                </tr>
              ))}
              {!linhasFiltradas.length && <tr><td colSpan={COLUNAS_TABELA.length}>Nenhum pedido encontrado.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      </div>

      {abaPrincipal === 'indicadores' ? (
        <section className="panel-card">
          <div className="panel-header-row">
            <div>
              <div className="panel-title">Indicadores da auditoria financeira</div>
              <p className="compact">Usa somente pedidos ja calculados (status OK) que atendem aos filtros principais.</p>
            </div>
            <div className="actions-right wrap">
              <label className="field" style={{ minWidth: 230 }}>Visao do painel
                <select value={cenarioPainel} onChange={(e) => { setCenarioPainel(e.target.value); setIndicadores(null); }}>
                  <option value="cotado">Peso cotado - decisao da venda</option>
                  <option value="faturado">Peso faturado - cenario financeiro</option>
                </select>
              </label>
              <button className="btn-primary" type="button" onClick={atualizarIndicadores} disabled={carregandoIndicadores}>
                {carregandoIndicadores ? `Lendo ${formatarNumero(linhasIndicadoresLidas)} pedidos...` : 'Atualizar indicadores'}
              </button>
            </div>
          </div>

          {!indicadores && !carregandoIndicadores ? <div className="sim-alert info">Clique em Atualizar indicadores depois do fechamento. A mesma rodada alimenta as visoes cotada e faturada.</div> : null}

          {indicadores ? (
            <>
              <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginTop: 14 }}>
                <label className="field">Competencia
                  <select value={filtrosBi.competencia} onChange={(e) => setFiltrosBi((f) => ({ ...f, competencia: e.target.value, semana: '' }))}>
                    <option value="">Todas</option>
                    {[...new Set(indicadores.itens.map((item) => competenciaBi(item.dataCriacao)))].sort().map((valor) => <option key={valor} value={valor}>{valor}</option>)}
                  </select>
                </label>
                <label className="field">Semana
                  <select value={filtrosBi.semana} onChange={(e) => setFiltrosBi((f) => ({ ...f, semana: e.target.value }))}>
                    <option value="">Todas</option>
                    {[...new Set(indicadores.itens.filter((item) => !filtrosBi.competencia || competenciaBi(item.dataCriacao) === filtrosBi.competencia).map((item) => semanaBi(item.dataCriacao)))].sort().map((valor) => <option key={valor} value={valor}>{valor}</option>)}
                  </select>
                </label>
                <label className="field">Campanha
                  <select value={filtrosBi.campanha === null ? '' : String(filtrosBi.campanha)} onChange={(e) => setFiltrosBi((f) => ({ ...f, campanha: e.target.value === '' ? null : e.target.value === 'true' }))}>
                    <option value="">Todas</option><option value="true">Com campanha</option><option value="false">Sem campanha</option>
                  </select>
                </label>
                <label className="field">Diferenca de peso
                  <select value={filtrosBi.diferencaPeso === null ? '' : String(filtrosBi.diferencaPeso)} onChange={(e) => setFiltrosBi((f) => ({ ...f, diferencaPeso: e.target.value === '' ? null : e.target.value === 'true' }))}>
                    <option value="">Todas</option><option value="true">Com diferenca</option><option value="false">Sem diferenca</option>
                  </select>
                </label>
                <label className="field">Consistencia do peso faturado
                  <select value={filtrosBi.pesoInconsistente === null ? '' : String(filtrosBi.pesoInconsistente)} onChange={(e) => setFiltrosBi((f) => ({ ...f, pesoInconsistente: e.target.value === '' ? null : e.target.value === 'true' }))}>
                    <option value="">Todos</option><option value="true">Possivelmente inconsistente</option><option value="false">Sem alerta</option>
                  </select>
                </label>
                <label className="field">Frete a Cobrar Mkt
                  <select value={filtrosBi.taxaMarketplace === null ? '' : String(filtrosBi.taxaMarketplace)} onChange={(e) => setFiltrosBi((f) => ({ ...f, taxaMarketplace: e.target.value === '' ? null : e.target.value === 'true' }))}>
                    <option value="">Todos</option><option value="true">Com valor</option><option value="false">Sem valor</option>
                  </select>
                </label>
                <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={filtrosBi.somenteDesvios} onChange={(e) => setFiltrosBi((f) => ({ ...f, somenteDesvios: e.target.checked }))} /> Somente outra transportadora mais barata
                </label>
                <button className="btn-secondary" type="button" onClick={() => setFiltrosBi({ somenteDesvios: false, campanha: null, diferencaPeso: null, pesoInconsistente: null, taxaMarketplace: null, transportadoraIdeal: '', transportadoraUsada: '', origemIdeal: '', origemUsada: '', competencia: '', semana: '' })}>Limpar exploracao</button>
              </div>

              <div className="summary-strip lotacao-summary-mini" style={{ marginTop: 14 }}>
                <div className="summary-card"><span>Resultados no recorte</span><strong>{formatarNumero(indicadoresBi.ressimulados)}</strong><small>filtros cruzados ativos</small></div>
                <div className="summary-card"><span>Mesma transportadora</span><strong>{formatarNumero(indicadoresBi.mesmaTransportadora)}</strong><small>{formatarNumero(indicadoresBi.ressimulados ? (indicadoresBi.mesmaTransportadora / indicadoresBi.ressimulados) * 100 : 0, 1)}%</small></div>
                <div className="summary-card" style={{ cursor: 'pointer' }} onClick={() => setFiltrosBi((f) => ({ ...f, somenteDesvios: true }))}><span>Outra mais barata</span><strong>{formatarNumero(indicadoresBi.casosPagoAMais)}</strong><small>clique para isolar</small></div>
                <div className="summary-card"><span>Perda no recorte</span><strong>{formatarMoeda(indicadoresBi.valorPagoAMais)}</strong><small>media {formatarMoeda(indicadoresBi.economiaMedia)}</small></div>
                <div className="summary-card"><span>Maior perda</span><strong>{formatarMoeda(indicadoresBi.maiorDesvio)}</strong><small>pedido individual</small></div>
                <div className="summary-card" style={{ cursor: 'pointer' }} onClick={() => setFiltrosBi((f) => ({ ...f, somenteDesvios: true, campanha: true }))}><span>Desvios com campanha</span><strong>{formatarNumero(indicadoresBi.pagosAMaisComCampanha)}</strong><small>perda {formatarMoeda(itensBiFiltrados.filter((i) => i.perda > 0 && i.campanha).reduce((s, i) => s + i.perda, 0))} - clique</small></div>
                <div className="summary-card" style={{ cursor: 'pointer' }} onClick={() => setFiltrosBi((f) => ({ ...f, somenteDesvios: true, diferencaPeso: true }))}><span>Desvios com diferenca de peso</span><strong>{formatarNumero(indicadoresBi.pagosAMaisPesoDiferente)}</strong><small>perda {formatarMoeda(itensBiFiltrados.filter((i) => i.perda > 0 && i.diferencaPeso).reduce((s, i) => s + i.perda, 0))} - clique</small></div>
                <div className="summary-card" style={{ cursor: 'pointer' }} onClick={() => setFiltrosBi((f) => ({ ...f, somenteDesvios: true, taxaMarketplace: true }))}><span>Desvios com Frete a Cobrar Mkt</span><strong>{formatarNumero(indicadoresBi.pagosAMaisComTaxaMarketplace)}</strong><small>perda {formatarMoeda(indicadoresBi.perdaComTaxaMarketplace)} - clique</small></div>
                <div className="summary-card"><span>Frete a Cobrar Mkt nos desvios</span><strong>{formatarMoeda(indicadoresBi.valorTaxaMarketplace)}</strong><small>soma da taxa no recorte</small></div>
                <div className="summary-card"><span>Escolha mudou pelo peso</span><strong>{formatarNumero(itensBiFiltrados.filter((item) => item.mudouTransportadoraPorPeso).length)}</strong><small>cotado x faturado escolheram transportadoras diferentes</small></div>
                <div className="summary-card" style={{ cursor: 'pointer' }} onClick={() => setFiltrosBi((f) => ({ ...f, pesoInconsistente: true }))}><span>Peso possivelmente inconsistente</span><strong>{formatarNumero(itensBiFiltrados.filter((item) => item.pesoPossivelmenteInconsistente).length)}</strong><small>faturado muito acima do cotado e da cubagem de referencia - clique</small></div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(390px, 1fr))', gap: 18, marginTop: 18 }}>
                {[
                  ['Transportadoras usadas com maior perda', indicadoresBi.transportadorasUsadas, 'transportadoraUsada'],
                  ['Transportadoras ideais mais perdidas', indicadoresBi.alternativas, 'transportadoraIdeal'],
                  ['Origens reais com maior perda', indicadoresBi.origensUsadas, 'origemUsada'],
                  ['Origens ideais com maior oportunidade', indicadoresBi.origensIdeais, 'origemIdeal'],
                ].map(([titulo, lista, campo]) => (
                  <div key={titulo} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
                    <div className="panel-title">{titulo}</div>
                    {lista.map((item) => {
                      const maximo = lista[0]?.perda || 1;
                      return <button key={item.nome} type="button" onClick={() => setFiltrosBi((f) => ({ ...f, somenteDesvios: true, [campo]: item.nome }))} style={{ display: 'grid', gridTemplateColumns: 'minmax(130px, 1fr) 2fr 100px', width: '100%', border: 0, background: 'transparent', alignItems: 'center', gap: 8, padding: '5px 0', cursor: 'pointer', textAlign: 'left' }}>
                        <span>{item.nome}</span><span style={{ height: 12, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden' }}><span style={{ display: 'block', width: `${(item.perda / maximo) * 100}%`, height: '100%', background: '#2563eb' }} /></span><strong>{formatarMoeda(item.perda)}</strong>
                      </button>;
                    })}
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 18, border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
                <div className="panel-title">Perda por competencia</div>
                <div style={{ display: 'flex', alignItems: 'end', gap: 8, minHeight: 180, overflowX: 'auto', paddingTop: 12 }}>
                  {indicadoresBi.competencias.map((item) => { const maximo = Math.max(...indicadoresBi.competencias.map((i) => i.perda), 1); return <button key={item.nome} type="button" title={`${item.nome}: ${formatarMoeda(item.perda)} em ${item.quantidade} caso(s)`} onClick={() => setFiltrosBi((f) => ({ ...f, competencia: item.nome, semana: '', somenteDesvios: true }))} style={{ border: 0, background: 'transparent', minWidth: 58, cursor: 'pointer' }}><strong style={{ fontSize: '0.7rem' }}>{formatarMoeda(item.perda)}</strong><span style={{ display: 'block', height: `${Math.max((item.perda / maximo) * 125, 4)}px`, background: '#2563eb', borderRadius: '5px 5px 0 0', margin: '4px auto', width: 28 }} /><small>{item.nome}</small></button>; })}
                </div>
              </div>

              <div style={{ marginTop: 18, overflow: 'auto' }}>
                <div className="panel-title">Pedidos do recorte analitico</div>
                <table className="sim-analise-tabela" style={{ width: '100%', minWidth: 1550 }}><thead><tr><th>Pedido</th><th>Data</th><th>Usada</th><th>Ideal ({cenarioPainel})</th><th>Ideal (outra visao)</th><th>Origem real</th><th>Origem ideal</th><th>Destino</th><th>Peso cotado</th><th>Peso faturado</th><th>Possivel erro peso?</th><th>Campanha</th><th>Frete a Cobrar Mkt</th><th>Pago</th><th>Ideal atual</th><th>Ideal outra visao</th><th>Perda</th></tr></thead><tbody>
                  {itensBiFiltrados.filter((item) => filtrosBi.pesoInconsistente === true ? item.pesoPossivelmenteInconsistente : item.perda > 0).sort((a, b) => b.perda - a.perda).slice(0, 200).map((item) => <tr key={item.id}><td>{item.pedido}</td><td>{formatarData(item.dataCriacao)}</td><td>{item.transportadoraUsada}</td><td>{item.transportadoraIdeal}</td><td>{item.transportadoraIdealOutroCenario || '-'}</td><td>{item.origemUsada}</td><td>{item.origemIdeal}</td><td>{item.destino}</td><td>{formatarNumero(item.pesoCotado, 2)}</td><td>{formatarNumero(item.pesoFaturado, 2)}</td><td>{boolTexto(item.pesoPossivelmenteInconsistente)}</td><td>{boolTexto(item.campanha)}</td><td>{formatarMoeda(item.taxaMarketplace)}</td><td>{formatarMoeda(item.valorPago)}</td><td>{formatarMoeda(item.valorIdeal)}</td><td>{formatarMoeda(item.valorIdealOutroCenario)}</td><td><strong>{formatarMoeda(item.perda)}</strong></td></tr>)}
                </tbody></table>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {painelCandidatos ? (
        <div style={{ position: 'fixed', inset: 0, zIndex: 20, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setPainelCandidatos(null)}>
          <div
            style={{ background: '#fff', borderRadius: 10, width: '96vw', maxWidth: '1400px', maxHeight: '92vh', overflow: 'auto', padding: 20, boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }}
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
                  <th>Tabela</th>
                  <th>Faixa peso</th>
                  <th>Peso base</th>
                  <th>Cubagem</th>
                  <th>Fator</th>
                  <th>Peso cubado</th>
                  <th>Peso final</th>
                  <th>Prazo</th>
                  <th>Valor</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {painelCandidatos.candidatos.map((cand, idx) => (
                  <tr
                    key={idx}
                    style={{
                      cursor: 'pointer',
                      background: painelCandidatos.selecionado === idx ? '#eef2ff' : cand.ehTransportadoraReal ? '#fff7ed' : 'transparent',
                    }}
                    onClick={() => setPainelCandidatos((atual) => ({ ...atual, selecionado: idx }))}
                  >
                    <td>{idx === 0 ? '🏆' : ''}</td>
                    <td>
                      {cand.transportadora}
                      {cand.ehTransportadoraReal ? (
                        <span style={{ marginLeft: 6, background: '#ffedd5', color: '#9a3412', borderRadius: 4, padding: '2px 6px', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                          🚚 Usada no CT-e real{cand.posicaoRanking ? ` (${cand.posicaoRanking}ª de ${cand.totalCandidatos})` : ''}
                        </span>
                      ) : null}
                    </td>
                    <td>{cand.origem}</td>
                    <td>
                      {cand.origemValidada ? (
                        <span style={{ background: '#dcfce7', color: '#166534', borderRadius: 4, padding: '2px 6px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>✓ Validada</span>
                      ) : (
                        <span style={{ background: '#f1f5f9', color: '#64748b', borderRadius: 4, padding: '2px 6px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Pendente</span>
                      )}
                    </td>
                    <td>{cand.faixaPeso || '-'}</td>
                    <td>{formatarNumero(cand.detalhes?.pesoInformado, 2)} kg</td>
                    <td>{formatarNumero(cand.detalhes?.cubagemAplicada, 3)} m3</td>
                    <td>{formatarNumero(cand.detalhes?.fatorCubagem, 2)}</td>
                    <td>{formatarNumero(cand.detalhes?.pesoCubadoCalculado ?? cand.detalhes?.pesoCubado, 2)} kg</td>
                    <td><strong>{formatarNumero(cand.detalhes?.pesoConsiderado, 2)} kg</strong></td>
                    <td>{formatarNumero(cand.prazo, 2)} dia(s)</td>
                    <td>{formatarMoeda(cand.valor)}</td>
                    <td>
                      <button
                        className="btn-secondary"
                        type="button"
                        style={{ padding: '2px 8px', fontSize: '0.72rem' }}
                        onClick={(e) => { e.stopPropagation(); abrirTabelaCadastrada(cand); }}
                      >
                        🔎 Tabela
                      </button>
                    </td>
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

            {tabelaConsultada ? (
              <div style={{ marginTop: 16, borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div className="panel-title">Tabela cadastrada — {tabelaConsultada.transportadora} / {tabelaConsultada.origemCidade}</div>
                  <button className="btn-secondary" type="button" style={{ padding: '2px 8px', fontSize: '0.72rem' }} onClick={() => setTabelaConsultada(null)}>Fechar tabela</button>
                </div>
                {tabelaConsultada.carregando ? (
                  <p className="compact">Consultando cadastro...</p>
                ) : tabelaConsultada.erro ? (
                  <div className="sim-alert error">{tabelaConsultada.erro}</div>
                ) : !tabelaConsultada.resultado?.origemEncontrada ? (
                  <p className="compact">Não achei essa origem cadastrada pra essa transportadora — pode ter sido renomeada ou removida.</p>
                ) : (
                  <>
                    <p className="compact">
                      Origem: <strong>{tabelaConsultada.resultado.origem.cidade}</strong> · Canal: {tabelaConsultada.resultado.origem.canal} · Status: {tabelaConsultada.resultado.origem.status} ·{' '}
                      {tabelaConsultada.resultado.origem.validado ? (
                        <span style={{ background: '#dcfce7', color: '#166534', borderRadius: 4, padding: '2px 6px', fontSize: '0.75rem' }}>
                          ✓ Validado {tabelaConsultada.resultado.origem.validado_por ? `por ${tabelaConsultada.resultado.origem.validado_por}` : ''}
                          {tabelaConsultada.resultado.origem.validado_em ? ` em ${new Date(tabelaConsultada.resultado.origem.validado_em).toLocaleString('pt-BR')}` : ''}
                        </span>
                      ) : (
                        <span style={{ background: '#f1f5f9', color: '#64748b', borderRadius: 4, padding: '2px 6px', fontSize: '0.75rem' }}>Pendente de validação</span>
                      )}
                    </p>
                    <p className="compact">Rota(s) cadastrada(s): {tabelaConsultada.resultado.rotas.map((r) => r.nome_rota).join(', ') || '-'}</p>
                    <div style={{ maxHeight: 260, overflow: 'auto' }}>
                      <table className="sim-analise-tabela" style={{ width: '100%' }}>
                        <thead>
                          <tr>
                            <th>Rota</th>
                            <th>Peso min</th>
                            <th>Peso max</th>
                            <th>Valor fixo</th>
                            <th>Atualizado em</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tabelaConsultada.resultado.cotacoes.map((c, idx) => {
                            const cand = tabelaConsultada.cand;
                            const ehFaixaUsada = cand && cand.rotaNome === c.rota
                              && Number(cand.pesoMinFaixa) === Number(c.peso_min)
                              && Number(cand.pesoMaxFaixa) === Number(c.peso_max);
                            return (
                            <tr key={idx} style={ehFaixaUsada ? { background: '#eef2ff', fontWeight: 600 } : undefined}>
                              <td>{ehFaixaUsada ? '➡️ ' : ''}{c.rota}</td>
                              <td>{formatarNumero(c.peso_min, 3)}</td>
                              <td>{formatarNumero(c.peso_max, 3)}</td>
                              <td>{formatarMoeda(c.valor_fixo)}</td>
                              <td>{c.updated_at ? new Date(c.updated_at).toLocaleString('pt-BR') : '-'}</td>
                            </tr>
                            );
                          })}
                          {!tabelaConsultada.resultado.cotacoes.length && <tr><td colSpan={5}>Nenhuma cotação encontrada pra essa rota.</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
