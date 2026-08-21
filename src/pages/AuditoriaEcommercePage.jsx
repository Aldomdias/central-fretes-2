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
  listarSessoesResimulacaoEcommerce,
  assinaturaFaseamentoEcommerce,
  excluirProgressoOrigensEcommerce,
  carregarCoberturaEcommerce,
  carregarCoberturaDiariaEcommerce,
  limitesBaseEcommerce,
} from '../services/ecommerceAuditoriaService';
import AmdProcessingOverlay from '../components/AmdProcessingOverlay';
import { abrirLaudoAuditoriaEcommerce } from '../utils/laudoAuditoriaEcommerce';
import {
  competenciasDoIntervalo,
  intervaloDaCompetencia,
  listarCompetenciasIndicadores,
  lerCompetenciaIndicadores,
  salvarCompetenciaIndicadores,
  excluirCompetenciaIndicadores,
  mesclarResumosIndicadores,
} from '../services/ecommerceIndicadoresCache';

const CHAVE_HISTORICO_RESIMULACAO = 'amd-auditoria-ecommerce-resimulacoes-v1';
const CHAVE_HISTORICO_RESIMULACAO_EXCLUIDAS = 'amd-auditoria-ecommerce-resimulacoes-excluidas-v1';
const CHAVE_TRANSPORTADORAS_EXCLUIDAS_PAINEL = 'amd-auditoria-ecommerce-painel-transportadoras-excluidas-v1';
const CHAVE_CRITERIO_PAINEL = 'amd-auditoria-ecommerce-painel-criterio-80-20-v1';

function lerCriterioPainel() {
  try {
    const salvo = localStorage.getItem(CHAVE_CRITERIO_PAINEL);
    return salvo === null ? true : salvo === 'true';
  } catch {
    return true;
  }
}

// Mantem compatibilidade com os snapshots antigos, que eram gerados com 80/20
// e usavam apenas "cotado" ou "faturado" como chave.
function cenarioCacheIndicadores(cenarioPeso, usarPrazo) {
  return usarPrazo ? cenarioPeso : `${cenarioPeso}-somente-preco`;
}

function lerTransportadorasExcluidasPainel() {
  try {
    const valor = JSON.parse(localStorage.getItem(CHAVE_TRANSPORTADORAS_EXCLUIDAS_PAINEL) || '[]');
    return Array.isArray(valor) ? valor.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function SeletorTransportadorasExcluidas({ opcoes, selecionadas, onChange }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const buscaNormalizada = busca.trim().toLocaleLowerCase('pt-BR');
  const filtradas = buscaNormalizada
    ? opcoes.filter((nome) => nome.toLocaleLowerCase('pt-BR').includes(buscaNormalizada))
    : opcoes;

  function alternar(nome) {
    onChange(selecionadas.includes(nome)
      ? selecionadas.filter((item) => item !== nome)
      : [...selecionadas, nome].sort((a, b) => a.localeCompare(b, 'pt-BR')));
  }

  return (
    <div className="field" style={{ position: 'relative' }}>
      <span>Retirar transportadoras (sujeira)</span>
      <button
        className="btn-secondary"
        type="button"
        onClick={() => setAberto((valor) => !valor)}
        style={{ width: '100%', textAlign: 'left', minHeight: 34 }}
      >
        {selecionadas.length ? `${selecionadas.length} retirada(s)` : 'Nenhuma retirada'} {aberto ? '▲' : '▼'}
      </button>
      {aberto ? (
        <div style={{ position: 'absolute', zIndex: 40, top: '100%', left: 0, right: 0, marginTop: 4, padding: 8, background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, boxShadow: '0 8px 24px rgba(15, 23, 42, 0.16)' }}>
          <input type="text" autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar transportadora..." style={{ width: '100%', boxSizing: 'border-box', marginBottom: 6 }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <small>{filtradas.length} encontrada(s)</small>
            {selecionadas.length ? <button type="button" onClick={() => onChange([])} style={{ border: 0, background: 'none', color: '#b91c1c', cursor: 'pointer' }}>Limpar retiradas</button> : null}
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            {filtradas.map((nome) => (
              <label key={nome} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, padding: '4px 2px', cursor: 'pointer' }}>
                <input type="checkbox" checked={selecionadas.includes(nome)} onChange={() => alternar(nome)} />
                <span title={nome} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nome}</span>
              </label>
            ))}
            {!filtradas.length ? <small>Nenhuma transportadora encontrada.</small> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function lerHistoricoResimulacao() {
  try {
    const valor = JSON.parse(localStorage.getItem(CHAVE_HISTORICO_RESIMULACAO) || '[]');
    return Array.isArray(valor) ? valor : [];
  } catch {
    return [];
  }
}

function lerSessoesExcluidas() {
  try {
    const valor = JSON.parse(localStorage.getItem(CHAVE_HISTORICO_RESIMULACAO_EXCLUIDAS) || '[]');
    return Array.isArray(valor) ? valor : [];
  } catch {
    return [];
  }
}

const CDS_RESTRICAO = ['Itupeva', 'Jaboatão', 'Serra', 'Duque de Caxias', 'Itajaí'];

const CHAVE_SNAPSHOT_COBERTURA = 'amd-auditoria-ecommerce-cobertura-snapshot-v1';

// Celula "x de y (z%)" com barrinha, usada na tabela de cobertura. Verde quando o
// periodo esta fechado, ambar quando falta pedaco, cinza quando nao ha elegivel.
function renderBarraCobertura(feitos = 0, elegiveis = 0) {
  if (!elegiveis) return <span style={{ color: '#94a3b8' }}>sem elegiveis</span>;
  const pct = (feitos / elegiveis) * 100;
  const cor = pct >= 99 ? '#16a34a' : pct > 0 ? '#f59e0b' : '#cbd5e1';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 8, alignItems: 'center' }}>
      <span style={{ height: 10, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden' }}>
        <span style={{ display: 'block', width: `${Math.min(100, pct)}%`, height: '100%', background: cor }} />
      </span>
      <span style={{ whiteSpace: 'nowrap' }}>{feitos.toLocaleString('pt-BR')} ({pct.toFixed(pct >= 99.95 || pct === 0 ? 0 : 1)}%)</span>
    </div>
  );
}

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

// 'YYYY-MM-DD' puro nao pode passar por new Date(): vira meia-noite UTC e volta
// um dia atras no fuso de Brasilia.
function formatarDiaIso(iso) {
  if (!iso) return '-';
  const [ano, mes, dia] = String(iso).slice(0, 10).split('-');
  return dia ? `${dia}/${mes}/${ano}` : '-';
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
    pedidosComAdicionalTributario: itens.filter((item) => Number(item.adicionalTributario || 0) > 0).length,
    valorAdicionalTributario: Number(itens.reduce((soma, item) => soma + Number(item.adicionalTributario || 0), 0).toFixed(2)),
    pagosAMaisComAdicionalTributario: desvios.filter((item) => Number(item.adicionalTributario || 0) > 0).length,
    valorAdicionalTributarioNosDesvios: Number(desvios.reduce((soma, item) => soma + Number(item.adicionalTributario || 0), 0).toFixed(2)),
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
  const [considerarPrazo, setConsiderarPrazo] = useState(lerCriterioPainel);
  const [transportadorasExcluidas, setTransportadorasExcluidas] = useState([]);
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
  const [tamanhoLoteOrigem, setTamanhoLoteOrigem] = useState(200);
  const [historicoResimulacoes, setHistoricoResimulacoes] = useState(() => lerHistoricoResimulacao());
  const [painelCandidatos, setPainelCandidatos] = useState(null);
  const [tabelaConsultada, setTabelaConsultada] = useState(null);
  const [abaPrincipal, setAbaPrincipal] = useState('operacao');
  const [cobertura, setCobertura] = useState(null);
  const [carregandoCobertura, setCarregandoCobertura] = useState(false);
  const [progressoCobertura, setProgressoCobertura] = useState(null);
  const [mesExpandido, setMesExpandido] = useState(null);
  const [diasCobertura, setDiasCobertura] = useState({});
  const [indicadores, setIndicadores] = useState(null);
  const [indicadoresAtualizadoEm, setIndicadoresAtualizadoEm] = useState(null);
  const [cenarioPainel, setCenarioPainel] = useState('cotado');
  const [carregandoIndicadores, setCarregandoIndicadores] = useState(false);
  const [competenciasCache, setCompetenciasCache] = useState([]);
  const [competenciasSelecionadas, setCompetenciasSelecionadas] = useState([]);
  const [competenciaEmCurso, setCompetenciaEmCurso] = useState(null);
  const [mesesDaBase, setMesesDaBase] = useState([]);
  const [linhasIndicadoresLidas, setLinhasIndicadoresLidas] = useState(0);
  const filtrosBiVazio = { somenteDesvios: false, campanha: null, diferencaPeso: null, pesoInconsistente: null, taxaMarketplace: null, adicionalTributario: null, transportadoraIdeal: '', transportadoraUsada: '', origemIdeal: '', origemUsada: '', competencia: '', semana: '', canal: '', uf: '' };
  const [filtrosBi, setFiltrosBi] = useState(filtrosBiVazio);
  const [transportadorasBiExcluidas, setTransportadorasBiExcluidas] = useState(lerTransportadorasExcluidasPainel);

  useEffect(() => {
    try { localStorage.setItem(CHAVE_CRITERIO_PAINEL, String(considerarPrazo)); } catch { /* segue sem persistir */ }
  }, [considerarPrazo]);

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_TRANSPORTADORAS_EXCLUIDAS_PAINEL, JSON.stringify(transportadorasBiExcluidas));
    } catch {
      // A persistencia e apenas uma conveniencia; o filtro continua funcionando na sessao.
    }
  }, [transportadorasBiExcluidas]);

  // Cobertura da base: contagens rapidas (nao le linhas) de quanto de cada mes
  // ja esta cruzado e recalculado. Fica guardada no navegador pra abrir na hora.
  useEffect(() => {
    try {
      const salvo = JSON.parse(localStorage.getItem(CHAVE_SNAPSHOT_COBERTURA) || 'null');
      if (salvo && Array.isArray(salvo.meses)) setCobertura(salvo);
    } catch {
      // snapshot corrompido/indisponivel - a tela abre vazia e o usuario atualiza.
    }
  }, []);

  async function atualizarCobertura() {
    setErro('');
    setCarregandoCobertura(true);
    setProgressoCobertura(null);
    try {
      const resultado = await carregarCoberturaEcommerce({ onProgress: setProgressoCobertura });
      setCobertura(resultado);
      setDiasCobertura({});
      setMesExpandido(null);
      try {
        localStorage.setItem(CHAVE_SNAPSHOT_COBERTURA, JSON.stringify(resultado));
      } catch {
        // snapshot e so conveniencia - segue sem ele se o localStorage estiver cheio.
      }
    } catch (error) {
      setErro(error.message || 'Erro ao carregar a cobertura da base.');
    } finally {
      setCarregandoCobertura(false);
      setProgressoCobertura(null);
    }
  }

  async function alternarDetalheMes(mesIso) {
    if (mesExpandido === mesIso) {
      setMesExpandido(null);
      return;
    }
    setMesExpandido(mesIso);
    if (diasCobertura[mesIso]) return;
    try {
      const dias = await carregarCoberturaDiariaEcommerce(mesIso, { onProgress: setProgressoCobertura });
      setDiasCobertura((atual) => ({ ...atual, [mesIso]: dias }));
    } catch (error) {
      setErro(error.message || 'Erro ao detalhar o mes.');
    } finally {
      setProgressoCobertura(null);
    }
  }

  const competenciasDoPeriodo = useMemo(
    () => competenciasDoIntervalo(filtrosServidor.dataInicio, filtrosServidor.dataFim),
    [filtrosServidor.dataInicio, filtrosServidor.dataFim]
  );

  const competenciasDoCenario = useMemo(
    () => competenciasCache.filter((registro) => registro.cenarioPeso === cenarioCacheIndicadores(cenarioPainel, considerarPrazo)),
    [competenciasCache, cenarioPainel, considerarPrazo]
  );

  const competenciasDaLista = useMemo(() => {
    const salvas = new Map(competenciasDoCenario.map((registro) => [registro.competencia, registro]));
    // A lista nao pode depender do filtro de datas: ele fica na aba "Operacao e
    // pedidos", entao quem abre direto o painel via os meses da propria base.
    const nomes = [...new Set([...mesesDaBase, ...competenciasDoPeriodo, ...salvas.keys()])].sort((a, b) => b.localeCompare(a));
    return nomes.map((competencia) => ({
      competencia,
      salva: salvas.has(competencia) && !salvas.get(competencia).desatualizada,
      desatualizada: Boolean(salvas.get(competencia)?.desatualizada),
      total: salvas.get(competencia)?.total || 0,
      atualizadoEm: salvas.get(competencia)?.atualizadoEm || null,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesesDaBase, competenciasDoPeriodo, competenciasDoCenario]);

  // Meses que existem na base de pedidos, pra listar tudo que da pra analisar
  // mesmo antes de qualquer competencia ter sido carregada.
  useEffect(() => {
    let cancelado = false;
    limitesBaseEcommerce()
      .then((limites) => {
        if (cancelado || !limites?.primeiro || !limites?.ultimo) return;
        setMesesDaBase(competenciasDoIntervalo(limites.primeiro.slice(0, 7) + '-01', limites.ultimo));
      })
      .catch(() => setMesesDaBase([]));
    return () => { cancelado = true; };
  }, []);

  async function recarregarListaCompetencias() {
    const lista = await listarCompetenciasIndicadores();
    setCompetenciasCache(lista);
    return lista;
  }

  // Le do banco UMA competencia e guarda no cache local. Cada mes vira um registro
  // proprio, entao carregar agosto nao apaga julho nem obriga a varrer os dois.
  async function carregarCompetencia(competencia, cenario = cenarioPainel, usarPrazo = considerarPrazo) {
    const { dataInicio, dataFim } = intervaloDaCompetencia(competencia);
    setCompetenciaEmCurso(competencia);
    setLinhasIndicadoresLidas(0);
    try {
      // So restringe por data no servidor; canal, UF, campanha, transportadora e
      // divergencia de peso ficam disponiveis para filtro dinamico no navegador
      // (filtrosBi), sem precisar buscar de novo no banco a cada troca de filtro.
      const resultado = await carregarIndicadoresEcommerce({
        filtros: { dataInicio, dataFim },
        cenarioPeso: cenario,
        onProgress: ({ carregados }) => setLinhasIndicadoresLidas(carregados),
      });
      await salvarCompetenciaIndicadores(cenarioCacheIndicadores(cenario, usarPrazo), competencia, resultado);
      return resultado;
    } finally {
      setCompetenciaEmCurso(null);
    }
  }

  // Mostra na tela a soma das competencias marcadas, lendo tudo do cache local.
  async function montarPainelDasCompetencias(competencias, cenario = cenarioPainel, usarPrazo = considerarPrazo) {
    const resumos = [];
    let maisRecente = null;
    for (const competencia of competencias) {
      const registro = await lerCompetenciaIndicadores(cenarioCacheIndicadores(cenario, usarPrazo), competencia);
      if (!registro) continue;
      resumos.push(registro.resumo);
      if (!maisRecente || registro.atualizadoEm > maisRecente) maisRecente = registro.atualizadoEm;
    }
    if (!resumos.length) {
      setIndicadores(null);
      setIndicadoresAtualizadoEm(null);
      return;
    }
    setIndicadores(mesclarResumosIndicadores(resumos));
    setIndicadoresAtualizadoEm(maisRecente);
    setFiltrosBi(filtrosBiVazio);
  }

  // Botao principal: carrega o que falta das competencias do periodo filtrado
  // (as ja salvas sao reaproveitadas) e mostra a soma delas.
  async function atualizarIndicadores({ refazer = false } = {}) {
    setErro('');
    setCarregandoIndicadores(true);
    setLinhasIndicadoresLidas(0);
    try {
      // Sem filtro de data, "carregar tudo" vale para os meses listados da base.
      const competencias = competenciasDoPeriodo.length ? competenciasDoPeriodo : competenciasDaLista.map((linha) => linha.competencia);
      if (!competencias.length) {
        setErro('Nenhuma competencia encontrada na base.');
        return;
      }
      const chaveCenario = cenarioCacheIndicadores(cenarioPainel, considerarPrazo);
      const jaSalvas = new Set((await recarregarListaCompetencias()).filter((r) => r.cenarioPeso === chaveCenario).map((r) => r.competencia));
      for (const competencia of competencias) {
        if (!refazer && jaSalvas.has(competencia)) continue;
        await carregarCompetencia(competencia, cenarioPainel, considerarPrazo);
      }
      await recarregarListaCompetencias();
      setCompetenciasSelecionadas(competencias);
      await montarPainelDasCompetencias(competencias);
    } catch (error) {
      setErro(error.message || 'Erro ao carregar indicadores.');
    } finally {
      setCarregandoIndicadores(false);
    }
  }

  async function alternarCompetenciaSelecionada(competencia) {
    const novas = competenciasSelecionadas.includes(competencia)
      ? competenciasSelecionadas.filter((c) => c !== competencia)
      : [...competenciasSelecionadas, competencia].sort();
    setCompetenciasSelecionadas(novas);
    await montarPainelDasCompetencias(novas);
  }

  async function recarregarUmaCompetencia(competencia) {
    setErro('');
    setCarregandoIndicadores(true);
    try {
      await carregarCompetencia(competencia);
      await recarregarListaCompetencias();
      await montarPainelDasCompetencias(competenciasSelecionadas.includes(competencia) ? competenciasSelecionadas : [...competenciasSelecionadas, competencia].sort());
    } catch (error) {
      setErro(error.message || 'Erro ao recarregar a competencia.');
    } finally {
      setCarregandoIndicadores(false);
    }
  }

  async function removerCompetenciaDoCache(competencia) {
    await excluirCompetenciaIndicadores(cenarioCacheIndicadores(cenarioPainel, considerarPrazo), competencia);
    await recarregarListaCompetencias();
    const novas = competenciasSelecionadas.filter((c) => c !== competencia);
    setCompetenciasSelecionadas(novas);
    await montarPainelDasCompetencias(novas);
  }

  // Regra 80/20 (80% preco + 20% prazo) so muda o resultado se a resimulacao for
  // refeita com o criterio novo - nao da pra "trocar e ver" sem reprocessar, porque
  // a escolha da transportadora ideal ja fica gravada no banco. Refaz para os dois
  // pesos (cotado/faturado) no recorte de data do filtro principal e recarrega o painel.
  async function recalcularIndicadoresComCriterio(novoConsiderarPrazo) {
    setErro('');
    setMensagem('');
    setCarregandoIndicadores(true);
    setLinhasIndicadoresLidas(0);
    try {
      const criterioB2c = novoConsiderarPrazo
        ? { usarPonderadoB2c: true, pesoPreco: 80, pesoPrazo: 20 }
        : { usarPonderadoB2c: false };
      const filtrosData = { dataInicio: filtrosServidor.dataInicio || null, dataFim: filtrosServidor.dataFim || null };
      for (const peso of ['cotado', 'faturado']) {
        await resimularEcommerceEmLotes({
          criterioB2c,
          pesoBase: peso,
          cdsPermitidos: restringirCds ? CDS_RESTRICAO : [],
          usarSaldoDia,
          incluirSemCruzamento,
          refazerTudo: true,
          filtros: filtrosData,
          transportadorasExcluidas,
          onProgress: ({ carregados }) => setLinhasIndicadoresLidas(carregados),
        });
      }
      setConsiderarPrazo(novoConsiderarPrazo);
      // Guarda os dois pesos sob o criterio escolhido. Assim trocar entre cotado
      // e faturado tambem e apenas navegacao local, sem nova varredura da base.
      for (const cenario of ['cotado', 'faturado']) {
        for (const competencia of competenciasDoPeriodo) {
          await carregarCompetencia(competencia, cenario, novoConsiderarPrazo);
        }
      }
      await recarregarListaCompetencias();
      setCompetenciasSelecionadas(competenciasDoPeriodo);
      await montarPainelDasCompetencias(competenciasDoPeriodo, cenarioPainel, novoConsiderarPrazo);
      setMensagem(`Indicadores recalculados com ${novoConsiderarPrazo ? 'preco 80% + prazo 20%' : 'somente preco'}.`);
    } catch (error) {
      setErro(error.message || 'Erro ao recalcular indicadores com o novo criterio.');
    } finally {
      setCarregandoIndicadores(false);
    }
  }

  async function alternarCriterioPainel(novoConsiderarPrazo) {
    const chaveDestino = cenarioCacheIndicadores(cenarioPainel, novoConsiderarPrazo);
    const lista = await recarregarListaCompetencias();
    const possuiSnapshot = lista.some((registro) => registro.cenarioPeso === chaveDestino && !registro.desatualizada);
    if (possuiSnapshot) {
      setConsiderarPrazo(novoConsiderarPrazo);
      setMensagem(`Snapshot de ${novoConsiderarPrazo ? '80% preço + 20% prazo' : 'somente preço'} aberto sem nova carga.`);
      return;
    }
    await recalcularIndicadoresComCriterio(novoConsiderarPrazo);
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

  function salvarSessaoResimulacao(origens = origensMapeadas) {
    const configuracao = {
      filtrosServidor, pesoBase, considerarPrazo, restringirCds, usarSaldoDia,
      incluirSemCruzamento, autoRetry, seguirAutomaticamente, refazerTudoFaseado,
      transportadorasExcluidas,
      assinatura: assinaturaFaseamentoEcommerce({
        filtros: filtrosParaQuery(filtrosServidor), refazerTudo: refazerTudoFaseado, incluirSemCruzamento, pesoBase,
      }),
      origens: origens || null,
    };
    // transportadorasExcluidas fica de fora da chave de proposito - e um filtro
    // dinamico (tipo BI) que nao muda qual recorte foi processado no banco, so como
    // ele e exibido depois. Ver assinaturaFaseamentoEcommerce.
    const chave = JSON.stringify({
      filtrosServidor, pesoBase, considerarPrazo, restringirCds, usarSaldoDia,
      incluirSemCruzamento, refazerTudoFaseado,
    });
    const anteriores = lerHistoricoResimulacao().filter((item) => item.chave !== chave);
    const excluidas = lerSessoesExcluidas().filter((assinatura) => assinatura !== chave);
    localStorage.setItem(CHAVE_HISTORICO_RESIMULACAO_EXCLUIDAS, JSON.stringify(excluidas));
    const proximo = [{ chave, atualizadoEm: new Date().toISOString(), ...configuracao }, ...anteriores].slice(0, 10);
    localStorage.setItem(CHAVE_HISTORICO_RESIMULACAO, JSON.stringify(proximo));
    setHistoricoResimulacoes(proximo);
  }

  function restaurarSessaoResimulacao(item) {
    if (!item) return;
    setFiltrosServidor({
      dataInicio: '', dataFim: '', cruzamentoStatus: '', simStatus: '', divergenciaPeso: false,
      canal: '', uf: '', possuiCampanha: '', cdCidade: '', cteTransportadora: '',
      ...(item.filtrosServidor || {}),
    });
    setPesoBase(item.pesoBase || 'cotado');
    setConsiderarPrazo(item.considerarPrazo !== false);
    setRestringirCds(Boolean(item.restringirCds));
    setUsarSaldoDia(item.usarSaldoDia !== false);
    setIncluirSemCruzamento(Boolean(item.incluirSemCruzamento));
    setAutoRetry(Boolean(item.autoRetry));
    setSeguirAutomaticamente(item.seguirAutomaticamente !== false);
    setRefazerTudoFaseado(Boolean(item.refazerTudoFaseado));
    setTransportadorasExcluidas(item.transportadorasExcluidas || []);
    setOrigensMapeadas(item.recuperadaDoBanco ? null : (item.origens || null));
    setForcarFechamentoParcial(false);
    setErro('');
    setMensagem(item.recuperadaDoBanco
      ? 'Sessao antiga restaurada. Clique em "Mapear origens (atualizar)" para reconstruir a lista completa e manter marcadas as ja concluidas.'
      : 'Sessao restaurada. Filtros e origens recuperados; continue pelas origens pendentes.');
  }

  async function limparHistoricoResimulacoes() {
    const excluidas = [...new Set([
      ...lerSessoesExcluidas(),
      ...historicoResimulacoes.map((item) => item.chave),
    ])];
    localStorage.setItem(CHAVE_HISTORICO_RESIMULACAO_EXCLUIDAS, JSON.stringify(excluidas));
    localStorage.removeItem(CHAVE_HISTORICO_RESIMULACAO);
    const listaAnterior = historicoResimulacoes;
    setHistoricoResimulacoes([]);
    limparFiltrosServidor();
    setMensagem('Historico limpo. Apagando progresso no banco...');
    try {
      await Promise.all(listaAnterior.map((item) => {
        const assinatura = item.assinatura || assinaturaFaseamentoEcommerce({
          filtros: filtrosParaQuery(item.filtrosServidor || {}), refazerTudo: Boolean(item.refazerTudoFaseado),
          incluirSemCruzamento: Boolean(item.incluirSemCruzamento), pesoBase: item.pesoBase || 'cotado',
        });
        return excluirProgressoOrigensEcommerce(assinatura);
      }));
      setMensagem('Historico e progresso no banco limpos. Configure uma nova resimulacao.');
    } catch (error) {
      setMensagem('Historico limpo, mas houve erro ao limpar progresso no banco: ' + (error.message || 'erro desconhecido'));
    }
  }

  async function excluirSessaoResimulacao(item) {
    const proximo = lerHistoricoResimulacao().filter((sessao) => sessao.chave !== item.chave);
    const excluidas = [...new Set([...lerSessoesExcluidas(), item.chave])];
    localStorage.setItem(CHAVE_HISTORICO_RESIMULACAO, JSON.stringify(proximo));
    localStorage.setItem(CHAVE_HISTORICO_RESIMULACAO_EXCLUIDAS, JSON.stringify(excluidas));
    setHistoricoResimulacoes(proximo);
    try {
      const assinatura = item.assinatura || assinaturaFaseamentoEcommerce({
        filtros: filtrosParaQuery(item.filtrosServidor || {}), refazerTudo: Boolean(item.refazerTudoFaseado),
        incluirSemCruzamento: Boolean(item.incluirSemCruzamento), pesoBase: item.pesoBase || 'cotado',
      });
      await excluirProgressoOrigensEcommerce(assinatura);
      setMensagem('Sessao excluida (historico e progresso no banco). Os resultados ja resimulados nos pedidos foram preservados.');
    } catch (error) {
      setMensagem('Sessao removida do historico, mas houve erro ao limpar o progresso no banco: ' + (error.message || 'erro desconhecido'));
    }
  }

  async function atualizarDiagnostico() {
    try {
      const filtrosAtuais = filtrosParaQuery(filtrosServidor);
      const [diag, diagSim] = await Promise.all([
        diagnosticarEcommerceOrderSnapshot(filtrosAtuais),
        diagnosticarResimulacaoEcommerce(filtrosAtuais, { incluirSemCruzamento, pesoBase }),
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

  // Mostra o ultimo snapshot salvo na hora (sem bater no banco) ao trocar de
  // cenario ou de periodo - a consulta completa (sem filtro de data chega a
  // escanear a base inteira, ~100s) so roda de verdade quando o usuario clica
  // em "Atualizar indicadores".
  // Ao trocar de cenario ou de periodo, monta o painel na hora com o que ja esta
  // no cache local (sem tocar no banco). O que faltar aparece na lista de
  // competencias como "nao carregada", pra buscar so aquele mes.
  useEffect(() => {
    let cancelado = false;
    (async () => {
      const lista = await listarCompetenciasIndicadores();
      if (cancelado) return;
      setCompetenciasCache(lista);
      const chaveCenario = cenarioCacheIndicadores(cenarioPainel, considerarPrazo);
      const salvasDoCenario = new Set(lista.filter((r) => r.cenarioPeso === chaveCenario && !r.desatualizada).map((r) => r.competencia));
      const alvo = (competenciasDoPeriodo.length ? competenciasDoPeriodo : [...salvasDoCenario].sort()).filter((c) => salvasDoCenario.has(c));
      setCompetenciasSelecionadas(alvo);
      await montarPainelDasCompetencias(alvo, cenarioPainel, considerarPrazo);
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cenarioPainel, considerarPrazo, filtrosServidor.dataInicio, filtrosServidor.dataFim]);

  useEffect(() => {
    if (!cdCentros.mapa.size) return;
    listarSessoesResimulacaoEcommerce().then((sessoes) => {
      const excluidas = new Set(lerSessoesExcluidas());
      const recuperadas = (sessoes || []).map((sessao) => {
        const cfg = sessao.configuracao || {};
        const f = cfg.filtros || {};
        const cidadesCd = [...new Set((f.cdCodigos || []).map((codigo) => cdCentros.mapa.get(codigo)).filter(Boolean))];
        const filtrosServidorReconstruido = {
          dataInicio: f.dataInicio || '', dataFim: f.dataFim || '',
          cruzamentoStatus: f.cruzamentoStatus || '', simStatus: f.simStatus || '',
          divergenciaPeso: Boolean(f.divergenciaPeso), canal: f.canal || '', uf: f.uf || '',
          possuiCampanha: f.possuiCampanha === null || f.possuiCampanha === undefined ? '' : String(Boolean(f.possuiCampanha)),
          cdCidade: cidadesCd.length === 1 ? cidadesCd[0] : '', cteTransportadora: f.cteTransportadora || '',
        };
        const pesoBaseReconstruido = cfg.pesoBase || 'cotado';
        const restringirCdsReconstruido = false;
        const usarSaldoDiaReconstruido = true;
        const incluirSemCruzamentoReconstruido = Boolean(cfg.incluirSemCruzamento);
        const refazerTudoFaseadoReconstruido = Boolean(cfg.refazerTudo);
        // Mesmo formato de chave usado em salvarSessaoResimulacao - senao a sessao
        // recuperada do banco (chave = assinatura crua) e a salva localmente pelo
        // fluxo normal (chave = JSON dos campos da tela) nunca batem, e a mesma
        // sessao aparece duplicada na lista (uma "com checkpoint", outra com o
        // progresso real).
        const chave = JSON.stringify({
          filtrosServidor: filtrosServidorReconstruido, pesoBase: pesoBaseReconstruido,
          considerarPrazo: true, restringirCds: restringirCdsReconstruido, usarSaldoDia: usarSaldoDiaReconstruido,
          incluirSemCruzamento: incluirSemCruzamentoReconstruido, refazerTudoFaseado: refazerTudoFaseadoReconstruido,
        });
        return {
          chave,
          atualizadoEm: sessao.atualizadoEm,
          filtrosServidor: filtrosServidorReconstruido,
          pesoBase: pesoBaseReconstruido, considerarPrazo: true,
          restringirCds: restringirCdsReconstruido, usarSaldoDia: usarSaldoDiaReconstruido,
          incluirSemCruzamento: incluirSemCruzamentoReconstruido,
          autoRetry: false, seguirAutomaticamente: true,
          refazerTudoFaseado: refazerTudoFaseadoReconstruido,
          origens: sessao.origens || [], recuperadaDoBanco: true,
          assinatura: sessao.assinatura,
        };
      }).filter((item) => !excluidas.has(item.chave));
      const locais = lerHistoricoResimulacao();
      const chavesRemotas = new Set(recuperadas.map((item) => item.chave));
      const combinado = [...recuperadas, ...locais.filter((item) => !chavesRemotas.has(item.chave))]
        .sort((a, b) => String(b.atualizadoEm || '').localeCompare(String(a.atualizadoEm || '')))
        .slice(0, 10);
      localStorage.setItem(CHAVE_HISTORICO_RESIMULACAO, JSON.stringify(combinado));
      setHistoricoResimulacoes(combinado);
    }).catch(() => {});
  }, [cdCentros]);

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

  function assinaturaMalhaAtual(filtrosAtuais, refazerTudo = false, pesoBaseAtual = pesoBase) {
    return assinaturaMalhaResimulacaoEcommerce({
      filtros: filtrosAtuais,
      refazerTudo,
      incluirSemCruzamento,
      usarSaldoDia,
      cdsPermitidos: restringirCds ? CDS_RESTRICAO : [],
      pesoBase: pesoBaseAtual,
      transportadorasExcluidas,
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
        pesoBase,
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
        transportadorasExcluidas,
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
        transportadorasExcluidas,
        onProgress: (evt) => setProgressoAmd(evt),
      });
      setOrigensMapeadas(origens);
      salvarSessaoResimulacao(origens);
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
      const totalPedidosOrigem = (listaBase || []).find((o) => o.cidade === cidade)?.quantidadePedidos || null;
      const executar = () => processarUmaOrigemEcommerce({
        origemCidade: cidade,
        filtros: filtrosAtuais,
        refazerTudo: refazerTudoFaseado,
        incluirSemCruzamento,
        pesoBase,
        totalPedidosOrigem,
        tamanhoLotePedidos: tamanhoLoteOrigem,
        transportadorasExcluidas,
        onProgress: (evt) => setProgressoAmd({ ...evt, origemAtual: cidade }),
      });
      const resultado = await (autoRetry ? comRetryGenerico(executar) : executar());
      // Passa a lista atualizada explicitamente pra recursao (em vez de reler o estado
      // do React) - senao a chamada seguinte enxergaria a lista antiga (closure obsoleta),
      // achando que a origem que acabou de rodar ainda esta pendente.
      const listaAtualizada = (listaBase || []).map((o) => (o.cidade === cidade ? { ...o, concluida: true, totalPedidosProcessados: resultado.totalPedidos } : o));
      setOrigensMapeadas(listaAtualizada);
      salvarSessaoResimulacao(listaAtualizada);
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
        transportadorasExcluidas,
        onProgress: (evt) => setProgressoAmd(evt),
      });
      // Fechado com sucesso: o resultado final ja esta gravado no pedido, entao o
      // bookkeeping de "quais origens ja rodaram" (checkpoint/progresso) e o card
      // no historico da tela nao servem mais pra nada - só ficariam como sujeira,
      // reaparecendo em toda visita a tela.
      const assinatura = assinaturaFaseamentoEcommerce({ filtros: filtrosAtuais, refazerTudo: refazerTudoFaseado, incluirSemCruzamento, pesoBase });
      await excluirProgressoOrigensEcommerce(assinatura).catch(() => {});
      const chaveAtual = JSON.stringify({
        filtrosServidor, pesoBase, considerarPrazo, restringirCds, usarSaldoDia,
        incluirSemCruzamento, refazerTudoFaseado,
      });
      const restante = lerHistoricoResimulacao().filter((item) => item.chave !== chaveAtual);
      localStorage.setItem(CHAVE_HISTORICO_RESIMULACAO, JSON.stringify(restante));
      setHistoricoResimulacoes(restante);
      setOrigensMapeadas(null);
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
        contarElegiveisResimulacaoEcommerce(filtrosAtuais, { incluirSemCruzamento, pesoBase }),
        contarJaResimuladosParaFiltro(filtrosAtuais, { incluirSemCruzamento, pesoBase }),
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
        transportadorasExcluidas,
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
      const assinaturaNecessaria = assinaturaMalhaAtual(filtrosParaQuery(resumo.filtros), resumo.refazerTudo, resumo.pesoBase);
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
          transportadorasExcluidas: resumo.transportadorasExcluidas || [],
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

  const opcoesTransportadorasBi = useMemo(() => [...new Set((indicadores?.itens || [])
    .flatMap((item) => [item.transportadoraUsada, item.transportadoraIdeal])
    .filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [indicadores]);

  const itensBiFiltrados = useMemo(() => (indicadores?.itens || []).filter((item) => {
    if (transportadorasBiExcluidas.includes(item.transportadoraUsada) || transportadorasBiExcluidas.includes(item.transportadoraIdeal)) return false;
    if (filtrosBi.somenteDesvios && !(item.perda > 0)) return false;
    if (filtrosBi.campanha !== null && item.campanha !== filtrosBi.campanha) return false;
    if (filtrosBi.diferencaPeso !== null && item.diferencaPeso !== filtrosBi.diferencaPeso) return false;
    if (filtrosBi.pesoInconsistente !== null && item.pesoPossivelmenteInconsistente !== filtrosBi.pesoInconsistente) return false;
    if (filtrosBi.taxaMarketplace !== null && (Number(item.taxaMarketplace || 0) > 0) !== filtrosBi.taxaMarketplace) return false;
    if (filtrosBi.adicionalTributario !== null && (Number(item.adicionalTributario || 0) > 0) !== filtrosBi.adicionalTributario) return false;
    if (filtrosBi.transportadoraIdeal && item.transportadoraIdeal !== filtrosBi.transportadoraIdeal) return false;
    if (filtrosBi.transportadoraUsada && item.transportadoraUsada !== filtrosBi.transportadoraUsada) return false;
    if (filtrosBi.origemIdeal && item.origemIdeal !== filtrosBi.origemIdeal) return false;
    if (filtrosBi.origemUsada && item.origemUsada !== filtrosBi.origemUsada) return false;
    if (filtrosBi.competencia && competenciaBi(item.dataCriacao) !== filtrosBi.competencia) return false;
    if (filtrosBi.semana && semanaBi(item.dataCriacao) !== filtrosBi.semana) return false;
    if (filtrosBi.canal && item.canal !== filtrosBi.canal) return false;
    if (filtrosBi.uf && item.uf !== filtrosBi.uf) return false;
    return true;
  }), [indicadores, filtrosBi, transportadorasBiExcluidas]);

  const indicadoresBi = useMemo(() => consolidarItensBi(itensBiFiltrados), [itensBiFiltrados]);

  const analiseDivergenciaPeso = useMemo(() => {
    const casos = itensBiFiltrados.filter((item) => item.diferencaPeso && item.pesoCotado > 0 && item.pesoFaturado > 0);
    const comparaveisFinanceiros = casos.filter((item) => item.transportadoraIdealOutroCenario);
    const valorCotado = comparaveisFinanceiros.reduce((soma, item) => soma + Number(cenarioPainel === 'cotado' ? item.valorIdeal : item.valorIdealOutroCenario || 0), 0);
    const valorFaturado = comparaveisFinanceiros.reduce((soma, item) => soma + Number(cenarioPainel === 'faturado' ? item.valorIdeal : item.valorIdealOutroCenario || 0), 0);
    const pesoCotado = casos.reduce((soma, item) => soma + Number(item.pesoCotado || 0), 0);
    const pesoFaturado = casos.reduce((soma, item) => soma + Number(item.pesoFaturado || 0), 0);
    const faturadoMaior = casos.filter((item) => item.pesoFaturado > item.pesoCotado);
    const cotadoMaior = casos.filter((item) => item.pesoCotado > item.pesoFaturado);
    const resumirDirecao = (lista) => ({
      quantidade: lista.length,
      diferencaKg: lista.reduce((soma, item) => soma + Math.abs(Number(item.pesoFaturado || 0) - Number(item.pesoCotado || 0)), 0),
      perda: lista.reduce((soma, item) => soma + Number(item.perda || 0), 0),
    });
    return {
      quantidade: casos.length,
      percentual: itensBiFiltrados.length ? (casos.length / itensBiFiltrados.length) * 100 : 0,
      pesoCotado,
      pesoFaturado,
      diferencaKg: pesoFaturado - pesoCotado,
      diferencaPercentual: pesoCotado ? ((pesoFaturado - pesoCotado) / pesoCotado) * 100 : 0,
      mediaCotada: casos.length ? pesoCotado / casos.length : 0,
      mediaFaturada: casos.length ? pesoFaturado / casos.length : 0,
      comparaveisFinanceiros: comparaveisFinanceiros.length,
      valorCotado,
      valorFaturado,
      impactoFinanceiro: valorFaturado - valorCotado,
      faturadoMaior: resumirDirecao(faturadoMaior),
      cotadoMaior: resumirDirecao(cotadoMaior),
    };
  }, [itensBiFiltrados, cenarioPainel]);

  const analiseCampanhas = useMemo(() => {
    const com = itensBiFiltrados.filter((item) => item.campanha);
    const sem = itensBiFiltrados.filter((item) => !item.campanha);
    const resumir = (lista) => ({
      quantidade: lista.length,
      desvios: lista.filter((item) => item.perda > 0).length,
      valorPago: lista.reduce((soma, item) => soma + Number(item.valorPago || 0), 0),
      valorIdeal: lista.reduce((soma, item) => soma + Number(item.valorIdeal || 0), 0),
      perda: lista.reduce((soma, item) => soma + Number(item.perda || 0), 0),
    });
    const totalDesconto = com.reduce((soma, item) => soma + Number(item.descontoCampanha || 0), 0);
    return {
      percentual: itensBiFiltrados.length ? (com.length / itensBiFiltrados.length) * 100 : 0,
      totalDesconto,
      mediaDesconto: com.length ? totalDesconto / com.length : 0,
      com: resumir(com),
      sem: resumir(sem),
    };
  }, [itensBiFiltrados]);

  const analiseAdicionalTributario = useMemo(() => {
    const com = itensBiFiltrados.filter((item) => Number(item.adicionalTributario || 0) > 0);
    const sem = itensBiFiltrados.filter((item) => !(Number(item.adicionalTributario || 0) > 0));
    const resumir = (lista) => ({
      quantidade: lista.length,
      desvios: lista.filter((item) => item.perda > 0).length,
      valorPago: lista.reduce((soma, item) => soma + Number(item.valorPago || 0), 0),
      valorIdeal: lista.reduce((soma, item) => soma + Number(item.valorIdeal || 0), 0),
      perda: lista.reduce((soma, item) => soma + Number(item.perda || 0), 0),
    });
    const totalAdicional = com.reduce((soma, item) => soma + Number(item.adicionalTributario || 0), 0);
    return {
      percentual: itensBiFiltrados.length ? (com.length / itensBiFiltrados.length) * 100 : 0,
      totalAdicional,
      mediaAdicional: com.length ? totalAdicional / com.length : 0,
      com: resumir(com),
      sem: resumir(sem),
    };
  }, [itensBiFiltrados]);

  function gerarLaudoExecutivo() {
    try {
      abrirLaudoAuditoriaEcommerce(itensBiFiltrados, {
        cenario: cenarioPainel,
        periodo: filtrosBi.competencia || (competenciasSelecionadas.length ? [...competenciasSelecionadas].sort().join(', ') : undefined),
      });
    } catch (error) {
      setErro(error?.message || 'Não foi possível abrir o laudo.');
    }
  }

  // Ultimo mes "fechado" em cada cenario e quanto ainda falta recalcular na base toda.
  const resumoCobertura = useMemo(() => {
    const meses = cobertura?.meses || [];
    const completo = (campo) => {
      let ultimo = null;
      for (const mes of meses) {
        if (mes.cruzados > 0 && mes[campo] / mes.cruzados >= 0.99) ultimo = mes.dataInicio.slice(0, 7);
        else if (mes.cruzados > 0) break;
      }
      return ultimo;
    };
    return {
      primeiroDiaBase: cobertura?.limites?.primeiro ? formatarDiaIso(cobertura.limites.primeiro) : null,
      ultimoDiaBase: cobertura?.limites?.ultimo ? formatarDiaIso(cobertura.limites.ultimo) : null,
      completoCotado: completo('cotado'),
      completoFaturado: completo('faturado'),
      faltaCotado: meses.reduce((soma, mes) => soma + Math.max(0, mes.cruzados - mes.cotado), 0),
      faltaFaturado: meses.reduce((soma, mes) => soma + Math.max(0, mes.cruzados - mes.faturado), 0),
    };
  }, [cobertura]);

  // Cada item do painel ja carrega os dois lados (visao atual + "outro cenario"), gravados
  // na mesma rodada de resimulacao - entao a comparacao cotado x faturado nao precisa de
  // nenhuma consulta nova, so reorganiza o que ja esta em itensBiFiltrados.
  const outroCenarioLabel = cenarioPainel === 'cotado' ? 'faturado' : 'cotado';
  const comparativoBi = useMemo(() => {
    const comOutraVisao = itensBiFiltrados.filter((item) => item.transportadoraIdealOutroCenario);
    const mudaram = comOutraVisao.filter((item) => item.mudouTransportadoraPorPeso);
    const valorAtual = comOutraVisao.reduce((soma, item) => soma + Number(item.valorIdeal || 0), 0);
    const valorOutro = comOutraVisao.reduce((soma, item) => soma + Number(item.valorIdealOutroCenario || 0), 0);
    return {
      totalComparavel: comOutraVisao.length,
      mudaram: mudaram.length,
      valorAtual: Number(valorAtual.toFixed(2)),
      valorOutro: Number(valorOutro.toFixed(2)),
      diferenca: Number((valorOutro - valorAtual).toFixed(2)),
      ganhamNoOutro: rankingBi(mudaram.map((item) => ({ ...item, perda: Math.abs(Number(item.valorIdealOutroCenario || 0) - Number(item.valorIdeal || 0)), transportadoraGanha: item.transportadoraIdealOutroCenario })), 'transportadoraGanha'),
      perdemNoOutro: rankingBi(mudaram.map((item) => ({ ...item, perda: Math.abs(Number(item.valorIdealOutroCenario || 0) - Number(item.valorIdeal || 0)) })), 'transportadoraIdeal'),
    };
  }, [itensBiFiltrados]);

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
        <button className={abaPrincipal === 'comparativo' ? 'tab-btn active' : 'tab-btn'} type="button" onClick={() => setAbaPrincipal('comparativo')}>Comparativo cotado x faturado</button>
        <button className={abaPrincipal === 'cobertura' ? 'tab-btn active' : 'tab-btn'} type="button" onClick={() => setAbaPrincipal('cobertura')}>Cobertura da base</button>
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
            <div className="section-row compact-top" style={{ marginBottom: 6 }}>
              <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, margin: 0 }}>
                Pedidos por lote (dentro da origem)
                <input
                  type="number"
                  min={20}
                  max={5000}
                  step={20}
                  value={tamanhoLoteOrigem}
                  onChange={(e) => setTamanhoLoteOrigem(Math.max(20, Math.min(5000, Number(e.target.value) || 200)))}
                  style={{ width: 80 }}
                />
                <span className="compact" style={{ color: '#94a3b8' }}>
                  maior = menos idas ao banco (mais rapido se nao der erro), mas baixa mais malha de uma vez e perde mais se cair no meio; padrao 200
                </span>
              </label>
            </div>
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {origensMapeadas.map((o) => (
                <div key={o.cidade} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 6px', borderBottom: '1px solid #f1f5f9', fontSize: '0.85rem' }}>
                  <span>
                    {o.concluida ? '✅' : origemProcessandoAgora === o.cidade ? '⏳' : '⬜'} {o.cidade}
                    <span style={{ color: '#94a3b8', marginLeft: 6 }}>
                      ({!o.concluida && o.pedidosSalvos > 0 ? `${formatarNumero(o.pedidosSalvos)} de ` : ''}{formatarNumero(o.quantidadePedidos)} pedido(s))
                    </span>
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
        <div style={{ marginBottom: 12, padding: 10, border: '1px solid #c7d2fe', borderRadius: 8, background: '#eef2ff' }}>
            <div className="section-row compact-top" style={{ marginBottom: 6 }}>
              <strong>Historico de resimulacoes</strong>
              <button className="btn-secondary" type="button" onClick={limparHistoricoResimulacoes}>Limpar historico e iniciar nova</button>
            </div>
            {!historicoResimulacoes.length ? (
              <p className="compact" style={{ margin: 0 }}>
                Nenhuma resimulacao salva ainda. Ao clicar em "Mapear origens", esta configuracao aparecera aqui para ser retomada depois.
              </p>
            ) : null}
            {historicoResimulacoes.slice(0, 5).map((item) => {
              const concluidas = (item.origens || []).filter((origem) => origem.concluida).length;
              const totalOrigens = (item.origens || []).length;
              const inicio = item.filtrosServidor?.dataInicio || 'inicio livre';
              const fim = item.filtrosServidor?.dataFim || 'fim livre';
              return (
                <div key={item.chave} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', padding: '5px 0', borderTop: '1px solid #dbeafe' }}>
                  <span className="compact">
                    <strong>{inicio} ate {fim}</strong> · peso {item.pesoBase || 'cotado'} · {item.recuperadaDoBanco
                      ? `${totalOrigens} origem(ns) com checkpoint — remapear ao retomar`
                      : totalOrigens ? `${concluidas} de ${totalOrigens} origens` : 'aguardando mapeamento'} · salvo em {new Date(item.atualizadoEm).toLocaleString('pt-BR')}
                  </span>
                  <span style={{ display: 'inline-flex', gap: 6 }}>
                    <button className="btn-secondary" type="button" onClick={() => restaurarSessaoResimulacao(item)}>Retomar</button>
                    <button className="btn-secondary" type="button" onClick={() => excluirSessaoResimulacao(item)}>Excluir</button>
                  </span>
                </div>
              );
            })}
        </div>
        <p className="compact" style={{ fontWeight: 600, marginTop: 4, marginBottom: 4 }}>Filtrar / exibir</p>
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
        </div>

        <p className="compact" style={{ fontWeight: 600, marginTop: 16, marginBottom: 4 }}>Como resimular</p>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
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
            <small>
              {pesoBase === 'ambos'
                ? 'Calcula e atualiza os dois cenarios.'
                : `Atualiza somente o cenario ${pesoBase}, sem apagar o outro cenario ja calculado.`}
            </small>
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
              <p className="compact">Usa somente pedidos ja calculados (status OK) que atendem aos filtros principais. Cada competencia (mes) fica guardada separada neste navegador — carrega uma vez e depois abre na hora, sozinha ou somada com as outras.</p>
              {indicadoresAtualizadoEm ? (
                <p className="compact" style={{ color: '#94a3b8' }}>
                  Exibindo {competenciasSelecionadas.length ? competenciasSelecionadas.join(', ') : 'nada'} · dado mais recente de {new Date(indicadoresAtualizadoEm).toLocaleString('pt-BR')}.
                </p>
              ) : null}
            </div>
            <div className="actions-right wrap">
              <label className="field" style={{ minWidth: 230 }}>Visao do painel
                <select value={cenarioPainel} onChange={(e) => setCenarioPainel(e.target.value)}>
                  <option value="cotado">Peso cotado - decisao da venda</option>
                  <option value="faturado">Peso faturado - cenario financeiro</option>
                </select>
              </label>
              <button className="btn-secondary" type="button" onClick={gerarLaudoExecutivo} disabled={!itensBiFiltrados.length || carregandoIndicadores}>
                Gerar laudo executivo / PDF
              </button>
              <button className="btn-primary" type="button" onClick={() => atualizarIndicadores()} disabled={carregandoIndicadores}>
                {carregandoIndicadores ? `${competenciaEmCurso || ''} — lendo ${formatarNumero(linhasIndicadoresLidas)} pedidos...` : 'Carregar as que faltam'}
              </button>
            </div>
          </div>

          <div className="actions-right wrap" style={{ marginTop: 8 }}>
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 'auto' }}>
              <input
                type="checkbox"
                checked={considerarPrazo}
                onChange={(e) => alternarCriterioPainel(e.target.checked)}
                disabled={carregandoIndicadores}
              />
              Regra 80/20 (80% preco + 20% prazo) na transportadora ideal
            </label>
            <small className="compact">Cada combinação de critério e peso fica salva separadamente. Se já existir, abre na hora; se for a primeira vez, calcula e cria o snapshot.</small>
            <button className="btn-secondary" type="button" onClick={() => recalcularIndicadoresComCriterio(considerarPrazo)} disabled={carregandoIndicadores}>Recalcular este critério</button>
          </div>

          <div style={{ marginTop: 14, border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
            <div className="panel-header-row" style={{ marginBottom: 8 }}>
            <div className="panel-title">Competencias salvas ({cenarioPainel} · {considerarPrazo ? '80/20' : 'somente preço'})</div>
              <button className="btn-secondary" type="button" style={{ padding: '2px 8px', fontSize: '0.72rem' }} onClick={() => atualizarIndicadores({ refazer: true })} disabled={carregandoIndicadores}>
                Refazer as competencias listadas
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {competenciasDaLista.length ? competenciasDaLista.map((linha) => (
                <div
                  key={linha.competencia}
                  style={{
                    border: `1px solid ${competenciasSelecionadas.includes(linha.competencia) ? '#2563eb' : '#e2e8f0'}`,
                    background: linha.salva ? (competenciasSelecionadas.includes(linha.competencia) ? '#eff6ff' : '#fff') : '#f8fafc',
                    borderRadius: 8, padding: '8px 10px', minWidth: 190,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={competenciasSelecionadas.includes(linha.competencia)}
                      disabled={!linha.salva || carregandoIndicadores}
                      onChange={() => alternarCompetenciaSelecionada(linha.competencia)}
                    />
                    <strong>{linha.competencia}</strong>
                  </div>
                  {linha.salva ? (
                    <>
                      <div className="compact">{formatarNumero(linha.total)} pedidos</div>
                      <div className="compact" style={{ color: '#94a3b8' }}>{new Date(linha.atualizadoEm).toLocaleString('pt-BR')}</div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        <button className="btn-secondary" type="button" style={{ padding: '1px 6px', fontSize: '0.68rem' }} onClick={() => recarregarUmaCompetencia(linha.competencia)} disabled={carregandoIndicadores}>Recarregar</button>
                        <button className="btn-secondary" type="button" style={{ padding: '1px 6px', fontSize: '0.68rem' }} onClick={() => removerCompetenciaDoCache(linha.competencia)} disabled={carregandoIndicadores}>Apagar</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="compact" style={{ color: '#b45309' }}>{linha.desatualizada ? 'desatualizada (formato antigo)' : 'nao carregada'}</div>
                      <button className="btn-secondary" type="button" style={{ padding: '1px 6px', fontSize: '0.68rem', marginTop: 4 }} onClick={() => recarregarUmaCompetencia(linha.competencia)} disabled={carregandoIndicadores}>Carregar so este mes</button>
                    </>
                  )}
                </div>
              )) : <p className="compact">Nenhuma competencia encontrada. Importe pedidos na aba "Operacao e pedidos" primeiro.</p>}
            </div>
          </div>

          {!indicadores && !carregandoIndicadores ? <div className="sim-alert info">Marque uma competencia salva acima, ou carregue as do periodo filtrado. A mesma rodada alimenta as visoes cotada e faturada.</div> : null}

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
              <label className="field">Tem adicional tributario?<select value={filtrosBi.adicionalTributario === null ? '' : String(filtrosBi.adicionalTributario)} onChange={(e) => setFiltrosBi((f) => ({ ...f, adicionalTributario: e.target.value === '' ? null : e.target.value === 'true' }))}>
                    <option value="">Todos</option><option value="true">Com valor</option><option value="false">Sem valor</option>
                  </select>
                </label>
                <label className="field">Canal
                  <select value={filtrosBi.canal} onChange={(e) => setFiltrosBi((f) => ({ ...f, canal: e.target.value }))}>
                    <option value="">Todos</option>
                    {[...new Set(indicadores.itens.map((item) => item.canal).filter(Boolean))].sort().map((valor) => <option key={valor} value={valor}>{valor}</option>)}
                  </select>
                </label>
                <label className="field">UF
                  <select value={filtrosBi.uf} onChange={(e) => setFiltrosBi((f) => ({ ...f, uf: e.target.value }))}>
                    <option value="">Todas</option>
                    {[...new Set(indicadores.itens.map((item) => item.uf).filter(Boolean))].sort().map((valor) => <option key={valor} value={valor}>{valor}</option>)}
                  </select>
                </label>
                <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={filtrosBi.somenteDesvios} onChange={(e) => setFiltrosBi((f) => ({ ...f, somenteDesvios: e.target.checked }))} /> Somente outra transportadora mais barata
                </label>
                <SeletorTransportadorasExcluidas
                  opcoes={opcoesTransportadorasBi}
                  selecionadas={transportadorasBiExcluidas}
                  onChange={setTransportadorasBiExcluidas}
                />
                <button className="btn-secondary" type="button" onClick={() => setFiltrosBi(filtrosBiVazio)}>Limpar exploracao</button>
              </div>

              {transportadorasBiExcluidas.length ? (
                <div className="sim-alert info" style={{ marginTop: 10 }}>
                  <strong>{transportadorasBiExcluidas.length} transportadora(s) retirada(s) do painel:</strong>{' '}
                  {transportadorasBiExcluidas.join(', ')}. Pedidos em que elas aparecem como usada ou ideal não entram nos indicadores, rankings, tabela ou PDF.
                </div>
              ) : null}

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
                <div className="summary-card" style={{ cursor: 'pointer' }} onClick={() => setFiltrosBi((f) => ({ ...f, adicionalTributario: true }))}><span>Adicional tributario</span><strong>{formatarMoeda(indicadoresBi.valorAdicionalTributario)}</strong><small>{formatarNumero(indicadoresBi.pedidosComAdicionalTributario)} pedidos com adicional - clique</small></div>
                <div className="summary-card"><span>Adicional tributario nos desvios</span><strong>{formatarMoeda(indicadoresBi.valorAdicionalTributarioNosDesvios)}</strong><small>{formatarNumero(indicadoresBi.pagosAMaisComAdicionalTributario)} desvios com adicional</small></div>
                <div className="summary-card"><span>Escolha mudou pelo peso</span><strong>{formatarNumero(itensBiFiltrados.filter((item) => item.mudouTransportadoraPorPeso).length)}</strong><small>cotado x faturado escolheram transportadoras diferentes</small></div>
                <div className="summary-card" style={{ cursor: 'pointer' }} onClick={() => setFiltrosBi((f) => ({ ...f, pesoInconsistente: true }))}><span>Peso possivelmente inconsistente</span><strong>{formatarNumero(itensBiFiltrados.filter((item) => item.pesoPossivelmenteInconsistente).length)}</strong><small>faturado muito acima do cotado e da cubagem de referencia - clique</small></div>
              </div>

              <div style={{ marginTop: 18, border: '2px solid #93c5fd', background: '#eff6ff', borderRadius: 12, padding: 14 }}>
                <div className="panel-title">Análise detalhada — divergência de peso</div>
                <p className="compact" style={{ marginTop: 4 }}>
                  Compara exatamente os mesmos pedidos que possuem peso cotado e faturado diferentes, respeitando todos os filtros ativos e as transportadoras retiradas.
                </p>
                <div className="summary-strip lotacao-summary-mini" style={{ marginTop: 12 }}>
                  <div className="summary-card"><span>Pedidos com divergência</span><strong>{formatarNumero(analiseDivergenciaPeso.quantidade)}</strong><small>{formatarNumero(analiseDivergenciaPeso.percentual, 1)}% do recorte</small></div>
                  <div className="summary-card"><span>Peso total cotado</span><strong>{formatarNumero(analiseDivergenciaPeso.pesoCotado, 2)} kg</strong><small>média {formatarNumero(analiseDivergenciaPeso.mediaCotada, 2)} kg/pedido</small></div>
                  <div className="summary-card"><span>Peso total faturado</span><strong>{formatarNumero(analiseDivergenciaPeso.pesoFaturado, 2)} kg</strong><small>média {formatarNumero(analiseDivergenciaPeso.mediaFaturada, 2)} kg/pedido</small></div>
                  <div className="summary-card"><span>Diferença de peso</span><strong>{analiseDivergenciaPeso.diferencaKg >= 0 ? '+' : ''}{formatarNumero(analiseDivergenciaPeso.diferencaKg, 2)} kg</strong><small>{analiseDivergenciaPeso.diferencaPercentual >= 0 ? '+' : ''}{formatarNumero(analiseDivergenciaPeso.diferencaPercentual, 1)}% sobre o cotado</small></div>
                  <div className="summary-card"><span>Frete ideal pelo cotado</span><strong>{formatarMoeda(analiseDivergenciaPeso.valorCotado)}</strong><small>{formatarNumero(analiseDivergenciaPeso.comparaveisFinanceiros)} pedidos comparáveis</small></div>
                  <div className="summary-card"><span>Frete ideal pelo faturado</span><strong>{formatarMoeda(analiseDivergenciaPeso.valorFaturado)}</strong><small>mesmos pedidos comparáveis</small></div>
                  <div className="summary-card"><span>Impacto financeiro do peso</span><strong>{analiseDivergenciaPeso.impactoFinanceiro >= 0 ? '+' : ''}{formatarMoeda(analiseDivergenciaPeso.impactoFinanceiro)}</strong><small>faturado menos cotado</small></div>
                </div>
                <div style={{ overflowX: 'auto', marginTop: 12 }}>
                  <table className="sim-analise-tabela" style={{ width: '100%' }}>
                    <thead><tr><th>Direção da divergência</th><th>Pedidos</th><th>Diferença absoluta</th><th>Perda identificada</th></tr></thead>
                    <tbody>
                      <tr><td>Faturado maior que o cotado</td><td>{formatarNumero(analiseDivergenciaPeso.faturadoMaior.quantidade)}</td><td>+{formatarNumero(analiseDivergenciaPeso.faturadoMaior.diferencaKg, 2)} kg</td><td>{formatarMoeda(analiseDivergenciaPeso.faturadoMaior.perda)}</td></tr>
                      <tr><td>Cotado maior que o faturado</td><td>{formatarNumero(analiseDivergenciaPeso.cotadoMaior.quantidade)}</td><td>{formatarNumero(analiseDivergenciaPeso.cotadoMaior.diferencaKg, 2)} kg</td><td>{formatarMoeda(analiseDivergenciaPeso.cotadoMaior.perda)}</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: 18, marginTop: 18 }}>
                <div style={{ border: '2px solid #c4b5fd', background: '#f5f3ff', borderRadius: 12, padding: 14 }}>
                  <div className="panel-title">Análise detalhada — campanhas de frete</div>
                  <p className="compact" style={{ marginTop: 4 }}>Mede a presença da campanha e compara o comportamento financeiro dos pedidos com e sem campanha.</p>
                  <div className="summary-strip lotacao-summary-mini" style={{ marginTop: 12 }}>
                    <div className="summary-card"><span>Pedidos com campanha</span><strong>{formatarNumero(analiseCampanhas.com.quantidade)}</strong><small>{formatarNumero(analiseCampanhas.percentual, 1)}% do recorte</small></div>
                    <div className="summary-card"><span>Desconto de campanha</span><strong>{formatarMoeda(analiseCampanhas.totalDesconto)}</strong><small>média {formatarMoeda(analiseCampanhas.mediaDesconto)}/pedido</small></div>
                    <div className="summary-card"><span>Desvios com campanha</span><strong>{formatarNumero(analiseCampanhas.com.desvios)}</strong><small>perda {formatarMoeda(analiseCampanhas.com.perda)}</small></div>
                    <div className="summary-card"><span>Frete pago com campanha</span><strong>{formatarMoeda(analiseCampanhas.com.valorPago)}</strong><small>ideal {formatarMoeda(analiseCampanhas.com.valorIdeal)}</small></div>
                  </div>
                  <div style={{ overflowX: 'auto', marginTop: 12 }}>
                    <table className="sim-analise-tabela" style={{ width: '100%' }}>
                      <thead><tr><th>Grupo</th><th>Pedidos</th><th>Desvios</th><th>Frete pago</th><th>Frete ideal</th><th>Perda</th></tr></thead>
                      <tbody>
                        <tr><td>Com campanha</td><td>{formatarNumero(analiseCampanhas.com.quantidade)}</td><td>{formatarNumero(analiseCampanhas.com.desvios)}</td><td>{formatarMoeda(analiseCampanhas.com.valorPago)}</td><td>{formatarMoeda(analiseCampanhas.com.valorIdeal)}</td><td>{formatarMoeda(analiseCampanhas.com.perda)}</td></tr>
                        <tr><td>Sem campanha</td><td>{formatarNumero(analiseCampanhas.sem.quantidade)}</td><td>{formatarNumero(analiseCampanhas.sem.desvios)}</td><td>{formatarMoeda(analiseCampanhas.sem.valorPago)}</td><td>{formatarMoeda(analiseCampanhas.sem.valorIdeal)}</td><td>{formatarMoeda(analiseCampanhas.sem.perda)}</td></tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div style={{ border: '2px solid #fdba74', background: '#fff7ed', borderRadius: 12, padding: 14 }}>
                  <div className="panel-title">Análise detalhada — adicional tributário</div>
                  <p className="compact" style={{ marginTop: 4 }}>Mostra quanto do recorte recebeu adicional tributário e como esses pedidos se comportam frente aos demais.</p>
                  <div className="summary-strip lotacao-summary-mini" style={{ marginTop: 12 }}>
                    <div className="summary-card"><span>Pedidos com adicional</span><strong>{formatarNumero(analiseAdicionalTributario.com.quantidade)}</strong><small>{formatarNumero(analiseAdicionalTributario.percentual, 1)}% do recorte</small></div>
                    <div className="summary-card"><span>Total do adicional</span><strong>{formatarMoeda(analiseAdicionalTributario.totalAdicional)}</strong><small>média {formatarMoeda(analiseAdicionalTributario.mediaAdicional)}/pedido</small></div>
                    <div className="summary-card"><span>Desvios com adicional</span><strong>{formatarNumero(analiseAdicionalTributario.com.desvios)}</strong><small>perda {formatarMoeda(analiseAdicionalTributario.com.perda)}</small></div>
                    <div className="summary-card"><span>Frete pago com adicional</span><strong>{formatarMoeda(analiseAdicionalTributario.com.valorPago)}</strong><small>ideal {formatarMoeda(analiseAdicionalTributario.com.valorIdeal)}</small></div>
                  </div>
                  <div style={{ overflowX: 'auto', marginTop: 12 }}>
                    <table className="sim-analise-tabela" style={{ width: '100%' }}>
                      <thead><tr><th>Grupo</th><th>Pedidos</th><th>Desvios</th><th>Frete pago</th><th>Frete ideal</th><th>Perda</th></tr></thead>
                      <tbody>
                        <tr><td>Com adicional</td><td>{formatarNumero(analiseAdicionalTributario.com.quantidade)}</td><td>{formatarNumero(analiseAdicionalTributario.com.desvios)}</td><td>{formatarMoeda(analiseAdicionalTributario.com.valorPago)}</td><td>{formatarMoeda(analiseAdicionalTributario.com.valorIdeal)}</td><td>{formatarMoeda(analiseAdicionalTributario.com.perda)}</td></tr>
                        <tr><td>Sem adicional</td><td>{formatarNumero(analiseAdicionalTributario.sem.quantidade)}</td><td>{formatarNumero(analiseAdicionalTributario.sem.desvios)}</td><td>{formatarMoeda(analiseAdicionalTributario.sem.valorPago)}</td><td>{formatarMoeda(analiseAdicionalTributario.sem.valorIdeal)}</td><td>{formatarMoeda(analiseAdicionalTributario.sem.perda)}</td></tr>
                      </tbody>
                    </table>
                  </div>
                </div>
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

      {abaPrincipal === 'comparativo' ? (
        <section className="panel-card">
          <div className="panel-header-row">
            <div>
              <div className="panel-title">Comparativo cotado x faturado</div>
              <p className="compact">
                Usa as mesmas competencias carregadas no Painel de indicadores (visao atual: <strong>{cenarioPainel}</strong>){competenciasSelecionadas.length ? <> — {competenciasSelecionadas.join(', ')}</> : null}.
                {indicadoresAtualizadoEm ? <> Dados de {new Date(indicadoresAtualizadoEm).toLocaleString('pt-BR')}.</> : null} Se nao aparecer nada, va no "Painel de indicadores" e carregue a competencia primeiro.
              </p>
            </div>
            <div className="actions-right wrap">
              {/* Mesmo filtrosBi do painel: o recorte escolhido aqui vale nas duas telas. */}
              <label className="field" style={{ minWidth: 170 }}>Competencia
                <select value={filtrosBi.competencia} onChange={(e) => setFiltrosBi((f) => ({ ...f, competencia: e.target.value, semana: '' }))}>
                  <option value="">Todas carregadas</option>
                  {[...new Set((indicadores?.itens || []).map((item) => competenciaBi(item.dataCriacao)))].sort().map((valor) => <option key={valor} value={valor}>{valor}</option>)}
                </select>
              </label>
              <label className="field" style={{ minWidth: 170 }}>Semana
                <select value={filtrosBi.semana} onChange={(e) => setFiltrosBi((f) => ({ ...f, semana: e.target.value }))}>
                  <option value="">Todas</option>
                  {[...new Set((indicadores?.itens || []).filter((item) => !filtrosBi.competencia || competenciaBi(item.dataCriacao) === filtrosBi.competencia).map((item) => semanaBi(item.dataCriacao)))].sort().map((valor) => <option key={valor} value={valor}>{valor}</option>)}
                </select>
              </label>
              <label className="field" style={{ minWidth: 150 }}>Canal
                <select value={filtrosBi.canal} onChange={(e) => setFiltrosBi((f) => ({ ...f, canal: e.target.value }))}>
                  <option value="">Todos</option>
                  {[...new Set((indicadores?.itens || []).map((item) => item.canal).filter(Boolean))].sort().map((valor) => <option key={valor} value={valor}>{valor}</option>)}
                </select>
              </label>
              <label className="field" style={{ minWidth: 110 }}>UF
                <select value={filtrosBi.uf} onChange={(e) => setFiltrosBi((f) => ({ ...f, uf: e.target.value }))}>
                  <option value="">Todas</option>
                  {[...new Set((indicadores?.itens || []).map((item) => item.uf).filter(Boolean))].sort().map((valor) => <option key={valor} value={valor}>{valor}</option>)}
                </select>
              </label>
            </div>
          </div>

          {!indicadores ? <div className="sim-alert info">Nenhuma competencia carregada nesse cenario. Va em "Painel de indicadores" e carregue o mes que quer analisar.</div> : (
            <>
              <div className="summary-strip lotacao-summary-mini" style={{ marginTop: 14 }}>
                <div className="summary-card"><span>Pedidos comparaveis</span><strong>{formatarNumero(comparativoBi.totalComparavel)}</strong><small>tem os dois cenarios calculados</small></div>
                <div className="summary-card"><span>Mudam de transportadora ideal</span><strong>{formatarNumero(comparativoBi.mudaram)}</strong><small>{formatarNumero(comparativoBi.totalComparavel ? (comparativoBi.mudaram / comparativoBi.totalComparavel) * 100 : 0, 1)}% do comparavel</small></div>
                <div className="summary-card"><span>Ideal no cenario {cenarioPainel}</span><strong>{formatarMoeda(comparativoBi.valorAtual)}</strong><small>soma do valor ideal</small></div>
                <div className="summary-card"><span>Ideal no cenario {outroCenarioLabel}</span><strong>{formatarMoeda(comparativoBi.valorOutro)}</strong><small>soma do valor ideal</small></div>
                <div className="summary-card"><span>Diferenca ({outroCenarioLabel} - {cenarioPainel})</span><strong>{formatarMoeda(comparativoBi.diferenca)}</strong><small>{comparativoBi.diferenca >= 0 ? `${outroCenarioLabel} sairia mais caro` : `${outroCenarioLabel} sairia mais barato`}</small></div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(390px, 1fr))', gap: 18, marginTop: 18 }}>
                {[
                  [`Ganham pedidos no cenario ${outroCenarioLabel}`, comparativoBi.ganhamNoOutro],
                  [`Perdem pedidos do cenario ${cenarioPainel}`, comparativoBi.perdemNoOutro],
                ].map(([titulo, lista]) => (
                  <div key={titulo} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
                    <div className="panel-title">{titulo}</div>
                    {lista.length ? lista.map((item) => {
                      const maximo = lista[0]?.perda || 1;
                      return <div key={item.nome} style={{ display: 'grid', gridTemplateColumns: 'minmax(130px, 1fr) 2fr 100px', width: '100%', alignItems: 'center', gap: 8, padding: '5px 0' }}>
                        <span>{item.nome}</span><span style={{ height: 12, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden' }}><span style={{ display: 'block', width: `${(item.perda / maximo) * 100}%`, height: '100%', background: '#2563eb' }} /></span><strong>{formatarMoeda(item.perda)}</strong>
                      </div>;
                    }) : <p className="compact">Sem pedidos nesse recorte.</p>}
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 18, overflow: 'auto' }}>
                <div className="panel-title">Pedidos com escolha diferente entre cotado e faturado</div>
                <table className="sim-analise-tabela" style={{ width: '100%', minWidth: 1200 }}><thead><tr><th>Pedido</th><th>Data</th><th>Ideal {cenarioPainel}</th><th>Ideal {outroCenarioLabel}</th><th>Valor ideal {cenarioPainel}</th><th>Valor ideal {outroCenarioLabel}</th><th>Diferenca</th></tr></thead><tbody>
                  {itensBiFiltrados.filter((item) => item.mudouTransportadoraPorPeso).sort((a, b) => Math.abs(b.valorIdealOutroCenario - b.valorIdeal) - Math.abs(a.valorIdealOutroCenario - a.valorIdeal)).slice(0, 200).map((item) => <tr key={item.id}><td>{item.pedido}</td><td>{formatarData(item.dataCriacao)}</td><td>{item.transportadoraIdeal}</td><td>{item.transportadoraIdealOutroCenario}</td><td>{formatarMoeda(item.valorIdeal)}</td><td>{formatarMoeda(item.valorIdealOutroCenario)}</td><td><strong>{formatarMoeda(item.valorIdealOutroCenario - item.valorIdeal)}</strong></td></tr>)}
                </tbody></table>
              </div>
            </>
          )}
        </section>
      ) : null}

      {abaPrincipal === 'cobertura' ? (
        <section className="panel-card">
          <div className="panel-header-row">
            <div>
              <div className="panel-title">Cobertura da base</div>
              <p className="compact">Quanto de cada mes ja esta importado, cruzado com CT-e e recalculado em cada cenario de peso. Ignora os filtros da tela — mostra a base inteira. So faz contagens, entao responde em segundos.</p>
              {cobertura?.atualizadoEm ? (
                <p className="compact" style={{ color: '#94a3b8' }}>Contagem de {new Date(cobertura.atualizadoEm).toLocaleString('pt-BR')} (salva neste navegador).</p>
              ) : null}
            </div>
            <div className="actions-right wrap">
              <button className="btn-primary" type="button" onClick={atualizarCobertura} disabled={carregandoCobertura}>
                {carregandoCobertura ? `Contando ${progressoCobertura ? `${progressoCobertura.prontos}/${progressoCobertura.total}` : ''}...` : 'Atualizar cobertura'}
              </button>
            </div>
          </div>

          {!cobertura ? (
            <div className="sim-alert info">Clique em "Atualizar cobertura" pra ver ate onde a base vai e o que ja esta recalculado.</div>
          ) : (
            <>
              <div className="summary-strip lotacao-summary-mini" style={{ marginTop: 14 }}>
                <div className="summary-card"><span>Base importada ate</span><strong>{resumoCobertura.ultimoDiaBase || '-'}</strong><small>primeiro pedido em {resumoCobertura.primeiroDiaBase || '-'}</small></div>
                <div className="summary-card"><span>Pedidos na base</span><strong>{formatarNumero(cobertura.limites?.total || 0)}</strong><small>todos os canais e periodos</small></div>
                <div className="summary-card"><span>Cotado completo ate</span><strong>{resumoCobertura.completoCotado || 'nenhum mes'}</strong><small>ultimo mes com 99%+ recalculado</small></div>
                <div className="summary-card"><span>Faturado completo ate</span><strong>{resumoCobertura.completoFaturado || 'nenhum mes'}</strong><small>ultimo mes com 99%+ recalculado</small></div>
                <div className="summary-card"><span>Falta recalcular</span><strong>{formatarNumero(resumoCobertura.faltaCotado + resumoCobertura.faltaFaturado)}</strong><small>{formatarNumero(resumoCobertura.faltaCotado)} cotado · {formatarNumero(resumoCobertura.faltaFaturado)} faturado</small></div>
              </div>

              <div style={{ marginTop: 18, overflow: 'auto' }}>
                <table className="sim-analise-tabela" style={{ width: '100%', minWidth: 980 }}>
                  <thead><tr><th>Periodo</th><th>Pedidos</th><th>Com CT-e</th><th>Sem CT-e</th><th>Recalculado cotado</th><th>Recalculado faturado</th><th>Detalhe</th></tr></thead>
                  <tbody>
                    {cobertura.meses.map((mes) => {
                      const chaveMes = mes.dataInicio.slice(0, 7);
                      const dias = diasCobertura[chaveMes];
                      return [
                        <tr key={chaveMes}>
                          <td><strong>{chaveMes}</strong></td>
                          <td>{formatarNumero(mes.total)}</td>
                          <td>{formatarNumero(mes.cruzados)}</td>
                          <td>{mes.semCte ? <span style={{ color: '#b45309' }}>{formatarNumero(mes.semCte)}</span> : '0'}</td>
                          <td>{renderBarraCobertura(mes.cotado, mes.cruzados)}</td>
                          <td>{renderBarraCobertura(mes.faturado, mes.cruzados)}</td>
                          <td><button className="btn-secondary" type="button" style={{ padding: '2px 8px', fontSize: '0.72rem' }} onClick={() => alternarDetalheMes(chaveMes)}>{mesExpandido === chaveMes ? 'Fechar' : 'Por dia'}</button></td>
                        </tr>,
                        mesExpandido === chaveMes ? (
                          !dias ? (
                            <tr key={`${chaveMes}-load`}><td colSpan={7} className="compact">Contando dia a dia{progressoCobertura ? ` (${progressoCobertura.prontos}/${progressoCobertura.total})` : ''}...</td></tr>
                          ) : dias.filter((dia) => dia.total > 0).map((dia) => (
                            <tr key={dia.dataInicio} style={{ background: '#f8fafc' }}>
                              <td style={{ paddingLeft: 24 }}>{formatarDiaIso(dia.dataInicio)}</td>
                              <td>{formatarNumero(dia.total)}</td>
                              <td>{formatarNumero(dia.cruzados)}</td>
                              <td>{dia.semCte ? formatarNumero(dia.semCte) : '0'}</td>
                              <td>{renderBarraCobertura(dia.cotado, dia.cruzados)}</td>
                              <td>{renderBarraCobertura(dia.faturado, dia.cruzados)}</td>
                              <td />
                            </tr>
                          ))
                        ) : null,
                      ];
                    })}
                  </tbody>
                </table>
              </div>
              <p className="compact" style={{ marginTop: 10 }}>
                O percentual e sobre os pedidos <strong>com CT-e</strong> do periodo, que sao os unicos elegiveis pra recalculo. Pedidos "Sem CT-e" nao entram no painel de indicadores — se o numero estiver alto num mes recente, provavelmente falta rodar o cruzamento com Tracking/CT-e.
              </p>
            </>
          )}
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
