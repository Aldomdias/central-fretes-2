import { useEffect, useMemo, useState } from 'react';
import { carregarPlataformaAuditoria, reauditarFatura, vincularChavesDetalhesPorNumero } from '../services/auditoriaFretesService';
import { carregarDetalhesFaturaSupabase } from '../services/lotacaoSupabaseService';
import { carregarEnviosOmsPorFatura, liberarFaturaNoOms } from '../services/omsFaturasEnvioService';
import { carregarResumoCtesFaturas, carregarUltimaImportacaoSap, marcarAgrupamentoManual, limparCacheGruposCnpj, marcarAjusteFenix, marcarCanceladas, marcarEncaminhamentoFinanceiro, marcarEnviadaAntecipacao, marcarPrevisaoPagamento, TIPOS_ENCAMINHAMENTO, marcarSubstituidasDuplicadas } from '../services/diagnosticoFaturasService';
import { carregarCadastroPorRaiz } from '../services/transportadoraCnpjsService';
import { diasAte } from '../utils/auditoriaFretesDomain';
import { carregarSessao } from '../utils/authLocal';
import {
  agrupamentoManual,
  montarFilaProtocolo,
  resultadoAuditoria,
  criarAgrupadorTransportadoras,
  criarUnificadorAuditores,
  detectarDuplicadas,
  etapaFenix,
  FAIXAS_A_VENCER,
  faixaDaLinha,
  aptaAntecipacao,
  enviadaErp,
  faturaLancada,
  filtrarPorCards,
  GRUPOS_DIAGNOSTICO,
  montarLinhasDiagnostico,
  faturaSemIdOms,
  situacaoAuditoria,
  aptidaoEnvioSap,
  ROTULO_OMS,
  situacaoOms,
  parseListaFaturas,
  previsaoPagamento,
  proximaAcao,
  situacaoCtes,
  situacaoEnvioErp,
  situacaoPagamento,
  situacaoPagamentoLinha,
  situacaoPrevisao,
  statusAjusteFenix,
  temFenix,
  textoPagamentoLinha,
  valorDaLinha,
} from '../utils/diagnosticoFaturas';
import { exportarExcelFormatado } from '../utils/exportarExcelFormatado';
import { gerarHtmlLaudo } from '../utils/laudoDiagnostico';
import { conciliarProgramacaoSap, previsaoInicialFinanceiro, situacaoFinanceiro } from '../utils/portalFinanceiroDomain';
import { gerarTermoDocx, MOTIVO_FENIX, nomeEmpresaSap, partidasDoTermo, PARTIDAS_FENIX, ROTULO_FENIX } from '../utils/termoCorrecaoFenix';
import modeloTermoUrl from '../assets/modelos/termo-correcao-lancamento.docx?url';

const CHAVE_SESSAO = 'cf_diagnostico_faturas_v1';
const TAM_PAGINA = 100;
const LOTE_VERIFICACAO = 120;
const LOTE_PRIORITARIO = 20;
const PARALELO_LOTES = 3;
const FILTROS_VAZIOS = { busca: '', auditor: '', status: '', canal: '', vencimentoDe: '', vencimentoAte: '', pagamentoDe: '', pagamentoAte: '', grupoTransp: '', grupoAuditor: '' };
const SEM_TRANSP = '__sem_fatura__';
// Auditor "todos": visao geral do gestor (faturas em aberto de todos os auditores).
const TODOS_AUDITORES = '__todos__';
const TOP_RANKING = 15;
const ORDEM_GRUPOS = ['localizacao', 'auditoria', 'erp', 'lancamento', 'financeiro', 'pagamento', 'vencimento', 'protocolo', 'previsao', 'ctes', 'fenix', 'fenix_ajuste', 'antecipacao'];

const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const ehCancelada = (l) => situacaoPagamentoLinha(l) === 'CANCELADA';
// Fora da lista e dos totais: canceladas/substituidas e duplicadas (cada uma so no seu card).
const ehOculta = (l) => ehCancelada(l) || Boolean(l.duplicada);
const CARDS_OCULTAS = ['canceladas', 'duplicadas'];
const inteiro = (v) => Number(v || 0).toLocaleString('pt-BR');
const dataBr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-');
// CT-e no formato de pesquisa do SAP: numero-serie, sem zeros a esquerda (ex.: 1234-1).
const semZeros = (v) => String(v ?? '').trim().replace(/^0+(?=\d)/, '');
const cteSap = (c) => { const n = semZeros(c.numero_cte); const s = semZeros(c.serie_cte); return n && s ? `${n}-${s}` : n; };
const nomeStatus = (s) => String(s || '-').replaceAll('_', ' ');
const carimbo = (f) => f.updated_at || '';
// Partida no SAP muda sem mexer na fatura (importacao do relatorio/robo): o cache vale poucos minutos, nao a sessao toda.
const VALIDADE_CACHE_CTES = 2 * 60 * 1000;
const cteAtual = (entrada, f) => Boolean(entrada) && entrada.carimbo === carimbo(f) && Date.now() - (entrada.em || 0) < VALIDADE_CACHE_CTES;
const COR_PAGAMENTO = { Paga: '#14733b', 'Paga c/ divergência': '#b78700', 'Lançada, não paga': '#315ee7', 'Lançada nos CT-es, não paga': '#b78700', 'Não lançada': '#9b1111' };
const ROTULO_SITUACAO_CTE = { COM_PARTIDA: 'Com partida', SEM_PARTIDA: 'Sem partida', ESTORNADO: 'Estornado no SAP', NFSE: 'NFS-e (fora do SAP CT-e)' };
const ROTULO_ETAPA_FENIX = { A_ENVIAR: 'A enviar ao financeiro', AGUARDANDO: 'Enviada, aguardando retorno', RETORNO: 'Retorno recebido: mandar protocolo', PROTOCOLO: 'Já no protocolo' };
const COR_ETAPA_FENIX = { A_ENVIAR: '#b91c1c', AGUARDANDO: '#b78700', RETORNO: '#315ee7', PROTOCOLO: '#14733b' };
const ROTULO_ENVIO_ERP = { NAO_ENVIADA: 'Não enviada', COM_PARTIDA: 'Enviada com partida', PARTIDA_NOS_CTES: 'Enviada, partida só nos CT-es', SEM_PARTIDA: 'Enviada sem partida', VERIFICANDO: 'Não verificada' };

// Fica fora do componente para sobreviver a troca de aba; a versao da fatura (updated_at) invalida o item.
const cacheCtes = new Map();
// Ultimo envio ao OMS por fatura (null = sem envio). Carregado de uma vez, sem esperar as partidas dos CT-es.
const cacheOms = new Map();

function lerSessao() {
  try { return JSON.parse(sessionStorage.getItem(CHAVE_SESSAO) || '{}'); } catch { return {}; }
}

const situacaoPrazo = (l) => {
  const dias = diasAte(l.fatura ? l.fatura.data_vencimento : l.vencimentoLista);
  if (['ENCERRADA', 'NAO_LOCALIZADA'].includes(faixaDaLinha(l)) || dias == null) return { texto: '-', cor: '#64748b' };
  if (dias < 0) return { texto: `há ${-dias}d`, cor: '#9b1111' };
  if (dias === 0) return { texto: 'hoje', cor: '#cf2f2f' };
  return { texto: `em ${dias}d`, cor: dias <= 7 ? '#c2410c' : '#14733b' };
};

const textoCtes = (l) => {
  if (!l.fatura) return '-';
  const s = situacaoCtes(l.ctes);
  if (s === 'VERIFICANDO') return '...';
  if (s === 'SO_NFSE') return `${l.ctes.nfse} NFS-e`;
  if (s === 'SEM_CTES') return 'Sem CT-e';
  return `${l.ctes.lancados}/${l.ctes.total}`;
};

const COLUNAS = [
  { id: 'numero', titulo: 'Fatura', valor: (l) => Number(String(l.numero).replace(/\D/g, '')) || 0 },
  { id: 'transportadora', titulo: 'Transportadora', valor: (l) => l.fatura?.transportadora || '' },
  { id: 'emissao', titulo: 'Emissão', valor: (l) => l.fatura?.data_emissao || '' },
  { id: 'vencimento', titulo: 'Vencimento', valor: (l) => l.fatura?.data_vencimento || l.vencimentoLista || '' },
  { id: 'previsao', titulo: 'Previsão pgto', valor: (l) => previsaoPagamento(l.fatura) },
  { id: 'valor', titulo: 'Valor', valor: valorDaLinha },
  { id: 'status', titulo: 'Status', valor: (l) => l.fatura?.status || '' },
  { id: 'auditados', titulo: 'Auditados', valor: (l) => Number(l.fatura?.ctes_auditados || 0) },
  { id: 'resultado_auditoria', titulo: 'Resultado da auditoria', valor: (l) => resultadoAuditoria(l.fatura)?.rotulo || '' },
  { id: 'partida', titulo: 'Partida', valor: (l) => l.fatura?.partida || l.fatura?.lancamento_financeiro || '' },
  { id: 'erp', titulo: 'Enviado ERP', valor: (l) => l.fatura?.data_envio_erp || '' },
  { id: 'ctes', titulo: 'CT-es no SAP', valor: (l) => (l.ctes?.total ? l.ctes.lancados / l.ctes.total : -1) },
  { id: 'oms', titulo: 'OMS/SAP', valor: (l) => ROTULO_OMS[situacaoOms(l)] || '' },
  { id: 'pagamento', titulo: 'Pagamento', valor: textoPagamentoLinha },
  { id: 'auditor', titulo: 'Auditor', valor: (l) => l.auditor || '' },
  { id: 'acao', titulo: 'Próxima ação', valor: proximaAcao },
];

function CardFiltro({ card, grupo, linhas, ativo, onClick }) {
  const qtd = linhas.length;
  const porCte = card.detalheCtes || card.detalheFenix;
  const listaCtes = (l) => (card.detalheFenix ? l.ctes?.fenix : l.ctes?.semPartida) || [];
  const totalCtes = porCte ? linhas.reduce((s, l) => s + listaCtes(l).length, 0) : 0;
  const valor = porCte
    ? linhas.reduce((s, l) => s + Number((card.detalheFenix ? l.ctes?.valorFenix : l.ctes?.valorSemPartida) || 0), 0)
    : linhas.reduce((s, l) => s + valorDaLinha(l), 0);
  const zerado = !qtd && !ativo;
  return (
    <button
      type="button"
      className="summary-card audit-kpi"
      aria-pressed={ativo}
      title={`${card.dica}${ativo ? ' Clique para tirar o filtro.' : ' Clique para filtrar.'}`}
      onClick={onClick}
      style={{ textAlign: 'left', font: 'inherit', borderLeft: `4px solid ${zerado ? '#cbd5e1' : card.cor}`, cursor: 'pointer', opacity: zerado ? 0.7 : 1, ...(ativo ? { boxShadow: `0 0 0 2px ${card.cor}`, background: '#f8fafc' } : {}) }}
      data-grupo={grupo}
    >
      <span>{card.rotulo}</span>
      <strong>{inteiro(qtd)}</strong>
      <small>{porCte ? `${inteiro(totalCtes)} CT-e(s) · ${dinheiro(valor)}` : dinheiro(valor)}</small>
    </button>
  );
}

// Mini dinamica do recorte por transportadora: maiores primeiro; clicar filtra a lista (clicar de novo tira).
function RankingTransportadoras({ itens, dimensao, onDimensao, filtrosAtivos, aberto, onAlternar, criterio, onCriterio, onEscolher }) {
  const ativo = filtrosAtivos[dimensao]?.chave || '';
  const [todas, setTodas] = useState(false);
  const total = itens.reduce((s, i) => s + (criterio === 'valor' ? i.valor : i.qtd), 0) || 1;
  const maior = Math.max(1, ...itens.map((i) => (criterio === 'valor' ? i.valor : i.qtd)));
  const visiveis = todas ? itens : itens.slice(0, TOP_RANKING);
  return (
    <div className="panel-card" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn-secondary" onClick={onAlternar} aria-expanded={aberto}>{aberto ? '▾' : '▸'} Por {dimensao === 'auditor' ? 'auditor' : 'transportadora'} ({inteiro(itens.length)})</button>
        {aberto && (
          <span className="compact" style={{ display: 'flex', gap: 4, alignItems: 'center', color: '#475569' }}>Agrupar por
            <button type="button" className={dimensao === 'transp' ? 'btn-primary' : 'btn-secondary'} onClick={() => onDimensao('transp')}>Transportadora</button>
            <button type="button" className={dimensao === 'auditor' ? 'btn-primary' : 'btn-secondary'} onClick={() => onDimensao('auditor')}>Auditor</button>
          </span>
        )}
        {aberto && (
          <span className="compact" style={{ display: 'flex', gap: 4, alignItems: 'center', color: '#475569' }}>Ordenar por
            <button type="button" className={criterio === 'valor' ? 'btn-primary' : 'btn-secondary'} onClick={() => onCriterio('valor')}>Valor</button>
            <button type="button" className={criterio === 'qtd' ? 'btn-primary' : 'btn-secondary'} onClick={() => onCriterio('qtd')}>Quantidade</button>
          </span>
        )}
        {Object.entries(filtrosAtivos).filter(([, v]) => v.chave).map(([d, v]) => (
          <span key={d} className="compact" style={{ color: '#071d49' }}>
            {d === 'auditor' ? 'Auditor' : 'Transportadora'}: <strong>{v.rotulo || '-'}</strong>{' '}
            <button type="button" className="btn-secondary" onClick={() => onEscolher(d, '')}>× Tirar</button>
          </span>
        ))}
      </div>
      {aberto && (
        <div style={{ marginTop: 10, display: 'grid', gap: 4 }}>
          {!itens.length && <span className="compact" style={{ color: '#64748b' }}>Nenhuma fatura no recorte.</span>}
          {visiveis.map((i) => {
            const medida = criterio === 'valor' ? i.valor : i.qtd;
            const selecionada = i.chave === ativo;
            return (
              <button
                key={i.chave}
                type="button"
                onClick={() => onEscolher(dimensao, selecionada ? '' : i.chave)}
                aria-pressed={selecionada}
                title={selecionada ? 'Clique para tirar o filtro' : `Clique para ver só ${i.rotulo}`}
                style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 280px) 1fr 70px 130px 52px', gap: 10, alignItems: 'center', textAlign: 'left', font: 'inherit', fontSize: 13, padding: '4px 8px', border: selecionada ? '1px solid #315ee7' : '1px solid transparent', borderRadius: 6, background: selecionada ? '#eef2ff' : 'transparent', cursor: 'pointer', opacity: ativo && !selecionada ? 0.6 : 1 }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: selecionada ? 700 : 500 }}>{i.rotulo}</span>
                <span style={{ background: '#e2e8f0', borderRadius: 4, height: 10, overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: `${Math.max(1, (medida / maior) * 100)}%`, background: selecionada ? '#315ee7' : '#071d49', borderRadius: 4 }} />
                </span>
                <span style={{ textAlign: 'right' }}>{inteiro(i.qtd)} fat.</span>
                <span style={{ textAlign: 'right' }}>{dinheiro(i.valor)}</span>
                <span style={{ textAlign: 'right', color: '#64748b' }}>{((medida / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>
              </button>
            );
          })}
          {itens.length > TOP_RANKING && (
            <button type="button" className="btn-secondary" style={{ justifySelf: 'start', marginTop: 4 }} onClick={() => setTodas((v) => !v)}>
              {todas ? `Mostrar só as ${TOP_RANKING} maiores` : `Ver todas (${inteiro(itens.length)})`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const ROTULO_FINANCEIRO = { AGUARDA_ENCAMINHAMENTO: null, ENCAMINHADA_SEM_PREVISAO: 'Encaminhada ao financeiro', ENCAMINHADA_COM_PREVISAO: 'Encaminhada · com previsão', PROGRAMADA: 'Programada pelo financeiro', PAGA: null };
const ROTULO_CAMPO_VINCULO = { referencia: 'referência', transportadora: 'transportadora', empresa: 'empresa', valor: 'valor', moeda: 'moeda', vencimento: 'vencimento', pagamentoEfetivo: 'pagamento efetivo' };

// Evidencias do Portal Financeiro numa fatura: encaminhamento/programacao, estorno SAP e campos do vinculo do pagamento.
function EvidenciasFinanceiras({ fatura: f }) {
  const rotulo = ROTULO_FINANCEIRO[situacaoFinanceiro(f)];
  const vinculo = f.pagamento_campos_vinculo && typeof f.pagamento_campos_vinculo === 'object' ? f.pagamento_campos_vinculo : null;
  const estorno = f.sap_estorno_status;
  if (!rotulo && !vinculo && !estorno) return null;
  const dataBrCurta = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '');
  return (
    <>
      {rotulo && (
        <div style={{ fontSize: 11, color: '#315ee7', whiteSpace: 'nowrap' }}
          title={[TIPOS_ENCAMINHAMENTO[f.encaminhamento_tipo], f.encaminhado_financeiro_por && `por ${f.encaminhado_financeiro_por}`, f.encaminhado_financeiro_em && `em ${dataBrCurta(f.encaminhado_financeiro_em)}`].filter(Boolean).join(' · ')}>
          {rotulo}
        </div>
      )}
      {estorno === 'ESTORNADA_SEM_RELANÇAMENTO' && (
        <div style={{ fontSize: 11, fontWeight: 700, color: '#9b1111', whiteSpace: 'nowrap' }} title={`Lançamento ${f.sap_lancamento_original || '-'} anulado pelo documento ${f.sap_documento_estorno || '-'}${f.sap_data_estorno ? ` em ${dataBrCurta(f.sap_data_estorno)}` : ''}${f.sap_motivo_estorno ? ` · ${f.sap_motivo_estorno}` : ''}. Sem relançamento.`}>Estornada no SAP</div>
      )}
      {estorno === 'RELANÇADA' && (
        <div style={{ fontSize: 11, color: '#b45309', whiteSpace: 'nowrap' }} title={`Estorno ${f.sap_documento_estorno || '-'} seguido do relançamento ${f.sap_relancamento || '-'}.`}>Relançada após estorno</div>
      )}
      {vinculo && (
        <div style={{ fontSize: 11, color: '#14733b', whiteSpace: 'nowrap' }}
          title={`Vínculo com o pagamento SAP por: ${Object.entries(vinculo).filter(([, ok]) => ok).map(([k]) => ROTULO_CAMPO_VINCULO[k] || k).join(', ')}${Object.entries(vinculo).some(([, ok]) => !ok) ? ` · não verificado/divergente: ${Object.entries(vinculo).filter(([, ok]) => !ok).map(([k]) => ROTULO_CAMPO_VINCULO[k] || k).join(', ')}` : ''}`}>
          Vínculo SAP ✓
        </div>
      )}
    </>
  );
}

function CardResumo({ rotulo, valor, detalhe, cor, ativo = false, dica, onClick }) {
  return (
    <button
      type="button"
      className="summary-card audit-kpi"
      aria-pressed={ativo}
      title={dica}
      onClick={onClick}
      style={{ textAlign: 'left', font: 'inherit', borderLeft: `4px solid ${cor}`, cursor: 'pointer', ...(ativo ? { boxShadow: `0 0 0 2px ${cor}`, background: '#f8fafc' } : {}) }}
    >
      <span>{rotulo}</span>
      <strong>{valor}</strong>
      {detalhe && <small>{detalhe}</small>}
    </button>
  );
}

// Tela gerencial: cola uma lista de faturas (ou escolhe a transportadora) e ve o raio-x na hora.
// A fatura abre por cima desta tela (onAbrirFatura), entao fechar volta exatamente aqui.
export default function DiagnosticoFaturasPainel({ state, onState, onAbrirFatura, liberarEmLote, conferirCobranca }) {
  const salvo = useMemo(lerSessao, []);
  const [texto, setTexto] = useState(salvo.texto || '');
  const [transportadora, setTransportadora] = useState(salvo.transportadora || '');
  const [auditor, setAuditor] = useState(salvo.auditor || '');
  const [escolhidos, setEscolhidos] = useState(salvo.escolhidos || {});
  const [filtros, setFiltros] = useState({ ...FILTROS_VAZIOS, ...(salvo.filtros || {}) });
  const [ordem, setOrdem] = useState(salvo.ordem || { coluna: 'vencimento', direcao: 1 });
  const [pagina, setPagina] = useState(1);
  const [versaoCtes, setVersaoCtes] = useState(0);
  const [recarga, setRecarga] = useState(0);
  const [progresso, setProgresso] = useState(null);
  const [erroCtes, setErroCtes] = useState('');
  const [ultimaSap, setUltimaSap] = useState(null);
  const [ultimaAberta, setUltimaAberta] = useState(null);
  const [aviso, setAviso] = useState('');
  const [exportando, setExportando] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  const [selecionadas, setSelecionadas] = useState(() => new Set());
  const [marcando, setMarcando] = useState(false);
  const [recalculo, setRecalculo] = useState(null);
  const [dataPrevisao, setDataPrevisao] = useState('');
  const [programacaoConfirmada, setProgramacaoConfirmada] = useState(false);
  const [tipoEncaminhamento, setTipoEncaminhamento] = useState('BOLETO_NA_PASTA');
  const [solicitante, setSolicitante] = useState(() => salvo.solicitante || carregarSessao()?.nome || '');
  const [rankingAberto, setRankingAberto] = useState(salvo.rankingAberto ?? true);
  const [criterioRanking, setCriterioRanking] = useState(salvo.criterioRanking || 'valor');
  const [dimensaoRanking, setDimensaoRanking] = useState(salvo.dimensaoRanking || 'transp');

  useEffect(() => {
    try { sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify({ texto, transportadora, auditor, escolhidos, filtros, ordem, solicitante, rankingAberto, criterioRanking, dimensaoRanking })); } catch { /* sem sessionStorage: so nao lembra */ }
  }, [texto, transportadora, auditor, escolhidos, filtros, ordem, solicitante, rankingAberto, criterioRanking, dimensaoRanking]);
  useEffect(() => { carregarUltimaImportacaoSap().then(setUltimaSap).catch(() => {}); }, [recarga]);
  // Cadastro (CNPJ principal, origens, adicionais): junta nomes/CNPJs diferentes numa transportadora so.
  const [cadastroPorRaiz, setCadastroPorRaiz] = useState(() => new Map());
  useEffect(() => { carregarCadastroPorRaiz().then(setCadastroPorRaiz).catch((e) => console.warn('[Diagnostico] cadastro', e?.message || e)); }, [recarga]);
  useEffect(() => { setPagina(1); }, [texto, transportadora, auditor, escolhidos, filtros, ordem]);

  const agrupador = useMemo(() => criarAgrupadorTransportadoras(state.faturas || [], cadastroPorRaiz), [state.faturas, cadastroPorRaiz]);
  const transportadoras = useMemo(() => agrupador.opcoes.map((o) => o.rotulo), [agrupador]);
  const nomesDoGrupo = useMemo(() => new Map(agrupador.opcoes.map((o) => [o.rotulo, o.nomes])), [agrupador]);
  // Mesma fatura importada mais de uma vez (em toda a base, nao so no recorte).
  const duplicadas = useMemo(() => detectarDuplicadas(state.faturas || [], agrupador.chaveDaFatura), [state.faturas, agrupador]);

  // Mesmo auditor com nomes diferentes ("Paulo Ricardo" x "Paulo Ricardo dos Santos") vira um nome so.
  const unificador = useMemo(() => criarUnificadorAuditores(state.faturas || []), [state.faturas]);
  const auditores = useMemo(() => {
    const semAuditor = (state.faturas || []).some((f) => !String(f.auditor_nome || '').trim());
    return [...unificador.opcoes, ...(semAuditor ? ['Sem auditor'] : [])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [unificador, state.faturas]);
  // Nome salvo na sessao com a grafia antiga ("Paulo Ricardo") passa para o nome unificado.
  const verTodosAuditores = auditor === TODOS_AUDITORES;
  const auditorEscolhido = auditor && !verTodosAuditores ? unificador.canonico(auditor) : '';
  const filtroAuditor = filtros.auditor ? unificador.canonico(filtros.auditor) : '';
  // "Minhas faturas": o auditor logado, pelo e-mail ou pelo nome.
  const meuNome = useMemo(() => {
    const sessao = carregarSessao();
    return unificador.doUsuario({ nome: sessao?.nome, email: sessao?.email });
  }, [unificador]);

  const lista = useMemo(() => parseListaFaturas(texto), [texto]);
  const temLista = lista.itens.length > 0;
  const linhasBase = useMemo(
    () => montarLinhasDiagnostico({ itens: lista.itens, faturas: state.faturas || [], transportadora, auditor: auditorEscolhido, todos: verTodosAuditores, filtroTransportadora: transportadora ? agrupador.filtro(transportadora) : null, nomeDoAuditor: unificador.nome }),
    [lista, state.faturas, transportadora, auditorEscolhido, verTodosAuditores, agrupador, unificador],
  );

  const faturasBase = useMemo(() => linhasBase.filter((l) => l.fatura).map((l) => l.fatura), [linhasBase]);
  useEffect(() => {
    // Primeiro as enviadas ao ERP sem partida na fatura: sao as que definem "Enviadas sem partida" e precisam de tratamento.
    // Tambem as candidatas a "apta a antecipacao": so da para saber se sao so CT-e (ou NFS-e) depois de conhecer os itens.
    const prioridade = (f) => ((enviadaErp(f) && !faturaLancada(f)) || aptaAntecipacao(f) ? 0 : 1);
    const pendentes = faturasBase.filter((f) => !cteAtual(cacheCtes.get(String(f.id)), f))
      .sort((a, b) => prioridade(a) - prioridade(b));
    if (!pendentes.length) { setProgresso(null); return undefined; }
    let ativo = true;
    const timer = setTimeout(async () => {
      try {
        setErroCtes('');
        // As prioritarias vao em lotes pequenos (resultado aparece logo); o resto, em lotes grandes.
        const nPrioritarias = pendentes.filter((f) => prioridade(f) === 0).length;
        const lotes = [];
        for (let i = 0; i < nPrioritarias; i += LOTE_PRIORITARIO) lotes.push(pendentes.slice(i, Math.min(i + LOTE_PRIORITARIO, nPrioritarias)));
        for (let i = nPrioritarias; i < pendentes.length; i += LOTE_VERIFICACAO) lotes.push(pendentes.slice(i, i + LOTE_VERIFICACAO));
        let feitas = 0;
        // Lotes em paralelo (poucos por vez): a espera era quase toda de rede, um lote depois do outro.
        let proximo = 0;
        const trabalhador = async () => {
          while (ativo && proximo < lotes.length) {
            const lote = lotes[proximo];
            proximo += 1;
            // eslint-disable-next-line no-await-in-loop
            const mapa = await carregarResumoCtesFaturas(lote.map((f) => f.id));
            if (!ativo) return;
            lote.forEach((f) => cacheCtes.set(String(f.id), { carimbo: carimbo(f), em: Date.now(), resumo: mapa.get(String(f.id)) }));
            feitas += lote.length;
            setProgresso({ feitas, total: pendentes.length });
            setVersaoCtes((v) => v + 1);
          }
        };
        setProgresso({ feitas: 0, total: pendentes.length });
        await Promise.all(Array.from({ length: Math.min(PARALELO_LOTES, lotes.length) }, trabalhador));
        if (ativo) setProgresso(null);
      } catch (e) {
        if (ativo) { setErroCtes(e.message || String(e)); setProgresso(null); }
      }
    }, 500);
    return () => { ativo = false; clearTimeout(timer); };
  }, [faturasBase, recarga]);

  // Situacao no OMS: vem de uma tabela leve, carregada de uma vez (nao depende da conferencia de partidas, que e lenta).
  const [versaoOms, setVersaoOms] = useState(0);
  useEffect(() => {
    // "Atualizar"/envio ao OMS (recarga) busca de novo: o ultimo envio pode ter mudado.
    if (cacheOms.recarga !== recarga) { cacheOms.clear(); cacheOms.recarga = recarga; }
    const faltam = faturasBase.filter((f) => !cacheOms.has(String(f.id))).map((f) => f.id);
    if (!faltam.length) return undefined;
    let ativo = true;
    carregarEnviosOmsPorFatura(faltam).catch(() => new Map()).then((envios) => {
      faltam.forEach((id) => cacheOms.set(String(id), envios.get(String(id)) || null));
      if (ativo) setVersaoOms((v) => v + 1);
    });
    return () => { ativo = false; };
  }, [faturasBase, recarga]);

  const linhas = useMemo(
    () => linhasBase.map((l) => (l.fatura ? { ...l, ctes: cacheCtes.get(String(l.fatura.id))?.resumo, oms: cacheOms.get(String(l.fatura.id)) || null, duplicada: duplicadas.get(l.fatura.id), auditor: unificador.nome(l.fatura) } : l)),
    [linhasBase, versaoCtes, versaoOms, duplicadas, unificador],
  );

  const opcoes = useMemo(() => {
    const unicos = (fn) => [...new Set(linhas.map(fn).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return {
      auditores: unicos((l) => l.fatura && l.auditor),
      status: unicos((l) => l.fatura?.status),
      canais: unicos((l) => l.fatura?.canal),
    };
  }, [linhas]);

  const filtradas = useMemo(() => {
    const termos = filtros.busca.toLowerCase().split(/\s+/).filter(Boolean);
    return linhas.filter((l) => {
      const f = l.fatura;
      if (termos.length) {
        const alvo = `${l.numero} ${f?.transportadora || ''} ${f?.auditor_nome || ''} ${l.auditor || ''}`.toLowerCase();
        if (!termos.every((t) => alvo.includes(t))) return false;
      }
      if (filtroAuditor && (!f || l.auditor !== filtroAuditor)) return false;
      if (filtros.status && f?.status !== filtros.status) return false;
      if (filtros.canal && f?.canal !== filtros.canal) return false;
      const venc = String(f?.data_vencimento || l.vencimentoLista || '').slice(0, 10);
      if (filtros.vencimentoDe && (!venc || venc < filtros.vencimentoDe)) return false;
      if (filtros.vencimentoAte && (!venc || venc > filtros.vencimentoAte)) return false;
      const pag = String(f?.data_pagamento || '').slice(0, 10);
      if (filtros.pagamentoDe && (!pag || pag < filtros.pagamentoDe)) return false;
      if (filtros.pagamentoAte && (!pag || pag > filtros.pagamentoAte)) return false;
      return true;
    });
  }, [linhas, filtros, filtroAuditor]);

  // Canceladas/substituidas ficam fora da lista, dos cards e dos totais: so aparecem clicando no card
  // "Canceladas" (ou filtrando o status cancelada/substituida).
  const verCanceladas = escolhidos.pagamento === 'canceladas' || ['CANCELADA', 'SUBSTITUIDA'].includes(filtros.status);
  const verDuplicadas = escolhidos.pagamento === 'duplicadas';
  // Um recorte so para a tela inteira: cards, totais e lista sempre mostram os mesmos numeros.
  // Ranking: transportadora (mesmo agrupamento do seletor do topo) ou auditor (nome unificado).
  // Linha sem fatura fica num grupo a parte. Clicar num item filtra so pela dimensao dele.
  const chaveDe = {
    transp: (l) => (l.fatura ? agrupador.chaveDaFatura(l.fatura) : SEM_TRANSP),
    auditor: (l) => (l.fatura ? l.auditor : SEM_TRANSP),
  };
  const campoGrupo = { transp: 'grupoTransp', auditor: 'grupoAuditor' };
  const doGrupo = (ls, exceto = '') => ls.filter((l) => Object.keys(chaveDe).every((d) => d === exceto || !filtros[campoGrupo[d]] || chaveDe[d](l) === filtros[campoGrupo[d]]));
  // Recorte antes do filtro do ranking: base do ranking (senao ele so mostraria o item escolhido).
  const recorteTodas = useMemo(() => {
    const r = filtrarPorCards(filtradas, escolhidos);
    return verCanceladas || verDuplicadas ? r : r.filter((l) => !ehOculta(l));
  }, [filtradas, escolhidos, verCanceladas, verDuplicadas]);
  const recorte = useMemo(() => doGrupo(recorteTodas), [recorteTodas, filtros.grupoTransp, filtros.grupoAuditor, agrupador]); // eslint-disable-line react-hooks/exhaustive-deps
  const ranking = useMemo(() => {
    const rotulos = new Map(agrupador.opcoes.map((o) => [o.chave, o.rotulo]));
    const rotulo = (c, l) => {
      if (c === SEM_TRANSP) return 'Não localizadas na plataforma';
      return dimensaoRanking === 'auditor' ? c : rotulos.get(c) || l.fatura?.transportadora || '-';
    };
    const mapa = new Map();
    // Cruzado: escolhida uma transportadora, o ranking por auditor mostra so os dela (e vice-versa).
    doGrupo(recorteTodas, dimensaoRanking).forEach((l) => {
      const c = chaveDe[dimensaoRanking](l);
      const item = mapa.get(c) || { chave: c, rotulo: rotulo(c, l), qtd: 0, valor: 0 };
      item.qtd += 1;
      item.valor += valorDaLinha(l);
      mapa.set(c, item);
    });
    const medida = (i) => (criterioRanking === 'valor' ? i.valor : i.qtd);
    return [...mapa.values()].sort((a, b) => medida(b) - medida(a) || b.qtd - a.qtd || a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
  }, [recorteTodas, agrupador, criterioRanking, dimensaoRanking, filtros.grupoTransp, filtros.grupoAuditor]); // eslint-disable-line react-hooks/exhaustive-deps
  const rotuloTransp = (chave) => (chave === SEM_TRANSP ? 'Não localizadas' : agrupador.opcoes.find((o) => o.chave === chave)?.rotulo || '');
  // O card das canceladas ignora os outros cards (ex.: "Vencidas"): cancelada nao e mais vencida, nem
  // aberta, nem lancada... e sumiria. Vale so a pesquisa e os filtros de campo.
  const canceladasRecorte = useMemo(() => doGrupo(filtradas.filter(ehCancelada)), [filtradas, filtros.grupoTransp, filtros.grupoAuditor, agrupador]); // eslint-disable-line react-hooks/exhaustive-deps
  const duplicadasRecorte = useMemo(() => doGrupo(filtradas.filter((l) => l.duplicada)), [filtradas, filtros.grupoTransp, filtros.grupoAuditor, agrupador]); // eslint-disable-line react-hooks/exhaustive-deps

  // Card de antecipacao: so com uma transportadora escolhida que tem o flag no cadastro.
  const fazAntecipacao = useMemo(() => {
    if (!transportadora) return false;
    const chave = agrupador.opcoes.find((o) => o.rotulo === transportadora)?.chave || '';
    return [...cadastroPorRaiz.values()].some((t) => t.fazAntecipacao && `T:${t.id}` === chave);
  }, [transportadora, agrupador, cadastroPorRaiz]);
  useEffect(() => { if (!fazAntecipacao && escolhidos.antecipacao) setEscolhidos((e) => ({ ...e, antecipacao: '' })); }, [fazAntecipacao, escolhidos.antecipacao]);

  const grupos = useMemo(() => GRUPOS_DIAGNOSTICO
    .filter((g) => (temLista || !g.soComLista) && (fazAntecipacao || !g.soAntecipa))
    .sort((a, b) => ORDEM_GRUPOS.indexOf(a.id) - ORDEM_GRUPOS.indexOf(b.id))
    .map((g) => ({ ...g, cards: g.cards.filter((c) => !c.oculto).map((c) => ({ ...c, linhas: { canceladas: canceladasRecorte, duplicadas: duplicadasRecorte }[c.id] || recorte.filter(c.teste) })) })), [recorte, canceladasRecorte, duplicadasRecorte, temLista, fazAntecipacao]);

  const resultado = useMemo(() => {
    const coluna = COLUNAS.find((c) => c.id === ordem.coluna) || COLUNAS[3];
    const vazio = (v) => v === '' || v == null;
    return [...recorte].sort((a, b) => {
      const va = coluna.valor(a);
      const vb = coluna.valor(b);
      if (vazio(va) || vazio(vb)) return vazio(va) - vazio(vb);
      const r = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR');
      return r * ordem.direcao;
    });
  }, [recorte, ordem]);

  const totais = useMemo(() => {
    // Os valores do topo sao sempre do recorte atual: com "Em aberto" selecionado, "Pago" fica zerado.
    const parte = (fn) => {
      const selecionadas = resultado.filter(fn);
      const semValor = selecionadas.filter((l) => !valorDaLinha(l)).length;
      return {
        valor: selecionadas.reduce((s, l) => s + valorDaLinha(l), 0),
        detalhe: `${inteiro(selecionadas.length)} fatura(s)${semValor ? ` · ${inteiro(semValor)} sem valor` : ''}`,
      };
    };
    return {
      total: parte(() => true),
      aberto: parte((l) => situacaoPagamentoLinha(l) === 'ABERTA'),
      vencido: parte((l) => faixaDaLinha(l) === 'VENCIDA'),
      aVencer: parte((l) => FAIXAS_A_VENCER.includes(faixaDaLinha(l))),
      pago: parte((l) => situacaoPagamentoLinha(l).startsWith('PAGA')),
    };
  }, [resultado]);

  const totalPaginas = Math.max(1, Math.ceil(resultado.length / TAM_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const visiveis = resultado.slice((paginaAtual - 1) * TAM_PAGINA, paginaAtual * TAM_PAGINA);
  const temFiltro = Object.values(escolhidos).some(Boolean) || Object.values(filtros).some(Boolean);

  // Abrir as canceladas tira os outros cards (com "Vencidas" ativo a lista ficaria vazia).
  const alternarCard = (grupo, card) => setEscolhidos((atual) => {
    if (CARDS_OCULTAS.includes(card)) return atual.pagamento === card ? {} : { pagamento: card };
    return { ...atual, [grupo]: atual[grupo] === card ? '' : card };
  });
  const limparFiltros = () => { setEscolhidos({}); setFiltros(FILTROS_VAZIOS); };
  const limparTudo = () => { limparFiltros(); setTexto(''); setTransportadora(''); setAuditor(''); };
  const mudarFiltro = (campo) => (e) => setFiltros((atual) => ({ ...atual, [campo]: e.target.value }));
  const ordenarPor = (coluna) => setOrdem((atual) => (atual.coluna === coluna ? { coluna, direcao: -atual.direcao } : { coluna, direcao: 1 }));
  const abrir = (l) => { if (!l.fatura) return; setUltimaAberta(l.id); onAbrirFatura(l.fatura); };
  // Busca faturas e partidas de novo no banco: importacoes feitas depois de abrir a tela entram aqui.
  const atualizarDados = async () => {
    setAtualizando(true);
    setAviso('');
    try {
      const { faturas } = await carregarPlataformaAuditoria();
      cacheCtes.clear();
      cacheOms.clear();
      limparCacheGruposCnpj();
      onState((atual) => ({ ...atual, faturas }));
      setVersaoCtes((v) => v + 1);
      setRecarga((v) => v + 1);
    } catch (e) { setAviso(`Erro ao atualizar: ${e.message || e}`); } finally { setAtualizando(false); }
  };

  // Selecao para marcar agrupamento manual: so faturas que existem na plataforma e estao no recorte.
  const idsRecorte = useMemo(() => resultado.filter((l) => l.fatura).map((l) => l.fatura.id), [resultado]);
  const selecaoValida = idsRecorte.filter((id) => selecionadas.has(id));

  // Liberacao para pagamento e envio ao OMS em massa, com as MESMAS regras da lista de faturas
  // (liberarEmLote/conferirCobranca vem da pagina). Ja liberadas, pagas, canceladas ou na gestao ficam de fora.
  const [liberacaoLote, setLiberacaoLote] = useState(null);
  const [processandoLote, setProcessandoLote] = useState('');
  const faturasSelecionadasObj = () => selecaoValida.map((id) => (state.faturas || []).find((f) => f.id === id)).filter(Boolean);
  const aptasLiberar = () => faturasSelecionadasObj().filter((f) => ['NAO_AUDITADA', 'PARCIAL', 'AUDITADA', 'FORNECEDOR'].includes(situacaoAuditoria(f)));
  const abrirLiberacaoLote = async () => {
    const alvo = aptasLiberar();
    const fora = selecaoValida.length - alvo.length;
    if (!alvo.length) { setAviso('Nenhuma das selecionadas pode ser liberada (já liberadas, pagas, canceladas ou aguardando a gestão).'); return; }
    setProcessandoLote('Conferindo os valores exatos antes da liberação...');
    try {
      const { comCobranca } = await conferirCobranca(alvo);
      setLiberacaoLote({ alvo, fora, comCobranca, descontar: '', motivo: '', observacao: '', erro: '' });
    } catch (e) {
      setAviso(`Não foi possível conferir os valores para liberar: ${e.message || e}`);
    } finally { setProcessandoLote(''); }
  };
  const confirmarLiberacaoLote = async () => {
    const { alvo, comCobranca, descontar, motivo, observacao } = liberacaoLote;
    const exige = comCobranca.length > 0;
    if (exige && !descontar) { setLiberacaoLote((p) => ({ ...p, erro: 'Responda se o valor será descontado (Sim ou Não).' })); return; }
    if (exige && descontar === 'NAO' && String(motivo).trim().length < 10) { setLiberacaoLote((p) => ({ ...p, erro: 'Informe o motivo de não descontar (mínimo 10 caracteres).' })); return; }
    const texto = [
      descontar ? `[DESCONTO: ${descontar === 'SIM' ? 'SIM' : 'NAO'}]` : '',
      descontar === 'NAO' ? `Motivo de nao descontar: ${String(motivo).trim()}.` : '',
      String(observacao).trim() ? `Obs.: ${String(observacao).trim()}` : '',
    ].filter(Boolean).join(' ');
    setLiberacaoLote(null);
    setProcessandoLote(`Liberando ${alvo.length} fatura(s)...`);
    try {
      const r = await liberarEmLote(alvo, texto, (p) => setProcessandoLote(`Liberando ${p.carregados}/${p.total}...`));
      onState(r.next);
      setAviso(r.mensagem);
      setRecarga((v) => v + 1);
    } catch (e) {
      setAviso(`Erro ao liberar: ${e.message || e}`);
    } finally { setProcessandoLote(''); }
  };
  const enviarOmsLote = async () => {
    const alvo = linhas.filter((l) => l.fatura && selecionadas.has(l.fatura.id) && ['APTA', 'ERRO', 'BLOQUEADA_PARTIDA'].includes(situacaoOms(l)));
    if (!alvo.length) { setAviso('Nenhuma selecionada está liberada e pendente de envio ao OMS (Apta, Bloqueada por partida ou com Erro).'); return; }
    if (!window.confirm(`Enviar ${alvo.length} fatura(s) ao OMS/SAP? Cada uma é conferida antes (Id, partidas dos CT-es e situação no OMS).`)) return;
    const nome = carregarSessao()?.nome || carregarSessao()?.email || 'Auditor';
    const res = { enviadas: 0, pendentes: [] };
    for (let i = 0; i < alvo.length; i += 1) {
      const f = alvo[i].fatura;
      setProcessandoLote(`Enviando ao OMS ${i + 1}/${alvo.length}: ${f.numero_fatura}`);
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await liberarFaturaNoOms({ fatura: f, nomeAuditor: nome });
        if (['enviado', 'ja_liberada'].includes(r.resultado)) res.enviadas += 1; else res.pendentes.push(`${f.numero_fatura}: ${r.mensagem}`);
      } catch (e) { res.pendentes.push(`${f.numero_fatura}: ${e.message || e}`); }
    }
    setProcessandoLote('');
    setAviso(`OMS/SAP: ${res.enviadas} de ${alvo.length} enviada(s).${res.pendentes.length ? ` Não enviadas: ${res.pendentes.slice(0, 5).join(' | ')}${res.pendentes.length > 5 ? ` (+${res.pendentes.length - 5})` : ''}` : ''}`);
    setRecarga((v) => v + 1);
  };
  const todasSelecionadas = idsRecorte.length > 0 && selecaoValida.length === idsRecorte.length;
  const alternarSelecao = (id) => setSelecionadas((atual) => { const n = new Set(atual); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const alternarTodas = () => setSelecionadas(todasSelecionadas ? new Set() : new Set(idsRecorte));
  // Recalcula os CT-es das faturas selecionadas (mesmo motor do "Recalcular" da fatura: refaz todos os CT-es,
  // grava em auditoria_cte_resultados) e reaudita a fatura para atualizar valores e divergencias.
  const recalcularSelecionadas = async () => {
    const porId = new Map(resultado.filter((l) => l.fatura).map((l) => [l.fatura.id, l.fatura]));
    const alvo = selecaoValida.map((id) => porId.get(id)).filter(Boolean);
    if (!alvo.length) return;
    if (!window.confirm(`Recalcular os CT-es de ${alvo.length} fatura(s)? Pode demorar; mantenha esta tela aberta até terminar.`)) return;
    setRecalculo({ feitas: 0, total: alvo.length, atual: '', fase: '' });
    setAviso('');
    const usuario = carregarSessao()?.nome || carregarSessao()?.email || 'Usuario local';
    const { apurarFaturaRobo } = await import('../utils/auditoriaRoboCore');
    let estadoAtual = state;
    const falhas = [];
    for (let i = 0; i < alvo.length; i += 1) {
      const fatura = alvo[i];
      setRecalculo({ feitas: i, total: alvo.length, atual: `${fatura.numero_fatura} · ${fatura.transportadora}`, fase: 'calculando' });
      try {
        await apurarFaturaRobo(fatura, (p) => setRecalculo((a) => (a ? { ...a, fase: p?.fase === 'calculando' ? `calculando ${p.atual}/${p.total}` : (p?.fase || a.fase) } : a)), {
          recalcularTudo: true,
          pesoMaisProximo: Boolean(fatura.peso_tracking_mais_proximo),
        });
        let detalhes = await carregarDetalhesFaturaSupabase(fatura.id);
        if (detalhes.some((d) => !d.chave_cte)) detalhes = (await vincularChavesDetalhesPorNumero(fatura, detalhes)).detalhes;
        estadoAtual = await reauditarFatura(estadoAtual, fatura, detalhes, usuario);
        onState(estadoAtual);
      } catch (e) {
        falhas.push(`${fatura.numero_fatura}: ${String(e?.message || e).slice(0, 100)}`);
      }
    }
    setRecalculo(null);
    setSelecionadas(new Set());
    setAviso(`${inteiro(alvo.length - falhas.length)} de ${inteiro(alvo.length)} fatura(s) recalculada(s).${falhas.length ? ` Falhas: ${falhas.slice(0, 5).join(' | ')}` : ''}`);
  };
  const aplicarAgrupamento = async (marcar) => {
    const porId = new Map(resultado.filter((l) => l.fatura).map((l) => [l.fatura.id, l.fatura]));
    const alvo = selecaoValida.filter((id) => agrupamentoManual(porId.get(id)) !== marcar);
    if (!alvo.length) { setAviso(marcar ? 'As selecionadas já estão marcadas.' : 'Nenhuma selecionada está marcada.'); return; }
    if (!marcar && !window.confirm(`Tirar a marcação de agrupamento manual de ${alvo.length} fatura(s)?`)) return;
    setMarcando(true);
    setAviso('');
    try {
      const sessao = carregarSessao();
      const gravadas = await marcarAgrupamentoManual(alvo, marcar, sessao?.nome || sessao?.email || '');
      onState((atual) => ({ ...atual, faturas: (atual.faturas || []).map((f) => (gravadas.has(f.id) ? { ...f, ...gravadas.get(f.id) } : f)) }));
      setSelecionadas(new Set());
      setAviso(`${inteiro(gravadas.size)} fatura(s) ${marcar ? 'marcada(s) para agrupamento manual' : 'desmarcada(s)'}.`);
    } catch (e) { setAviso(`Erro ao marcar: ${e.message || e}`); } finally { setMarcando(false); }
  };

  // Antecipacao: marca as selecionadas como enviadas (saem de "Aptas"); desmarcar devolve.
  const aplicarEnvioAntecipacao = async (marcar) => {
    const porId = new Map(resultado.filter((l) => l.fatura).map((l) => [l.fatura.id, l.fatura]));
    const alvo = selecaoValida.filter((id) => Boolean(porId.get(id)?.antecipacao_enviada) !== marcar);
    if (!alvo.length) { setAviso(marcar ? 'As selecionadas já estão marcadas como enviadas.' : 'Nenhuma selecionada está marcada como enviada.'); return; }
    setMarcando(true);
    setAviso('');
    try {
      const sessao = carregarSessao();
      const gravadas = await marcarEnviadaAntecipacao(alvo, marcar, sessao?.nome || sessao?.email || '');
      onState((atual) => ({ ...atual, faturas: (atual.faturas || []).map((f) => (gravadas.has(f.id) ? { ...f, ...gravadas.get(f.id) } : f)) }));
      setSelecionadas(new Set());
      setAviso(`${inteiro(gravadas.size)} fatura(s) ${marcar ? 'marcada(s) como enviadas para antecipação' : 'devolvida(s) para as aptas'}.`);
    } catch (e) { setAviso(`Erro ao marcar: ${e.message || e}`); } finally { setMarcando(false); }
  };

  // Cancelar: faturas que nao serao pagas (ex.: vencidas sem tratativa). Saem da lista e vao para o card
  // "Canceladas". Reativar devolve o status que a fatura tinha antes do cancelamento.
  const aplicarCancelamento = async (cancelar) => {
    const porId = new Map(resultado.filter((l) => l.fatura).map((l) => [l.fatura.id, l.fatura]));
    const alvo = selecaoValida.map((id) => porId.get(id)).filter((f) => f && (cancelar
      ? situacaoPagamento(f) === 'ABERTA'
      : ['CANCELADA', 'SUBSTITUIDA'].includes(f.status)));
    if (!alvo.length) {
      setAviso(cancelar ? 'Nenhuma selecionada pode ser cancelada (só as não pagas e ainda ativas).' : 'Nenhuma selecionada está cancelada ou substituída.');
      return;
    }
    let motivo = '';
    if (cancelar) {
      const resposta = window.prompt(`Cancelar ${alvo.length} fatura(s)? Elas saem da lista e ficam no card "Canceladas".\n\nMotivo (opcional):`, '');
      if (resposta === null) return;
      motivo = resposta;
    } else if (!window.confirm(`Reativar ${alvo.length} fatura(s)? Elas voltam ao status que tinham antes do cancelamento.`)) return;
    setMarcando(true);
    setAviso('');
    try {
      const sessao = carregarSessao();
      const gravadas = await marcarCanceladas(alvo.map((f) => ({ id: f.id, status: f.status })), cancelar, sessao?.nome || sessao?.email || '', motivo);
      onState((atual) => ({ ...atual, faturas: (atual.faturas || []).map((f) => (gravadas.has(f.id) ? { ...f, ...gravadas.get(f.id) } : f)) }));
      setSelecionadas(new Set());
      const ignoradas = selecaoValida.length - gravadas.size;
      setAviso(`${inteiro(gravadas.size)} fatura(s) ${cancelar ? 'cancelada(s): estão no card "Canceladas"' : 'reativada(s)'}.${ignoradas > 0 ? ` ${inteiro(ignoradas)} selecionada(s) não se aplicavam.` : ''}`);
    } catch (e) { setAviso(`Erro ao ${cancelar ? 'cancelar' : 'reativar'}: ${e.message || e}`); } finally { setMarcando(false); }
  };

  // Duplicadas: as copias viram SUBSTITUIDA (a principal fica valendo) e passam para o card "Canceladas".
  const aplicarSubstituicao = async () => {
    const porId = new Map(resultado.filter((l) => l.fatura && l.duplicada).map((l) => [l.fatura.id, l]));
    const alvo = selecaoValida.map((id) => porId.get(id)).filter(Boolean);
    if (!alvo.length) { setAviso('Nenhuma selecionada é duplicada.'); return; }
    if (!window.confirm(`Marcar ${alvo.length} fatura(s) duplicada(s) como substituídas? Fica valendo a outra cópia de cada uma (coluna Próxima ação).`)) return;
    setMarcando(true);
    setAviso('');
    try {
      const sessao = carregarSessao();
      const itens = alvo.map((l) => ({ id: l.fatura.id, status: l.fatura.status, principalId: l.duplicada.principal.id, principalNumero: l.duplicada.principal.numero_fatura, principalTransportadora: l.duplicada.principal.transportadora }));
      const gravadas = await marcarSubstituidasDuplicadas(itens, sessao?.nome || sessao?.email || '');
      onState((atual) => ({ ...atual, faturas: (atual.faturas || []).map((f) => (gravadas.has(f.id) ? { ...f, ...gravadas.get(f.id) } : f)) }));
      setSelecionadas(new Set());
      setAviso(`${inteiro(gravadas.size)} duplicada(s) marcada(s) como substituída(s): estão no card "Canceladas".`);
    } catch (e) { setAviso(`Erro ao marcar duplicadas: ${e.message || e}`); } finally { setMarcando(false); }
  };

  // Previsao de pagamento: grava (ou limpa) a data combinada nas selecionadas que ainda nao foram pagas.
  const aplicarPrevisao = async (limpar = false) => {
    const porId = new Map(resultado.filter((l) => l.fatura).map((l) => [l.fatura.id, l.fatura]));
    const abertas = selecaoValida.filter((id) => (agrupamentoManual(porId.get(id)) || faturaLancada(porId.get(id))) && situacaoPagamento(porId.get(id)) === 'ABERTA');
    const alvo = limpar ? abertas.filter((id) => previsaoPagamento(porId.get(id))) : abertas;
    if (!limpar && !dataPrevisao) { setAviso('Escolha a data prevista de pagamento.'); return; }
    if (!alvo.length) { setAviso(limpar ? 'Nenhuma selecionada tem previsão de pagamento.' : 'Nenhuma selecionada está lançada ou no protocolo em aberto.'); return; }
    if (!limpar && (diasAte(dataPrevisao) ?? 0) < 0 && !window.confirm(`A data ${dataBr(dataPrevisao)} já passou. Gravar assim mesmo?`)) return;
    if (limpar && !window.confirm(`Tirar a previsão de pagamento de ${alvo.length} fatura(s)?`)) return;
    setMarcando(true);
    setAviso('');
    try {
      const sessao = carregarSessao();
      const gravadas = await marcarPrevisaoPagamento(alvo, limpar ? '' : dataPrevisao, sessao?.nome || sessao?.email || '',
        limpar ? {} : { origem: programacaoConfirmada ? 'FINANCEIRO' : 'AUDITOR', confirmada: programacaoConfirmada });
      onState((atual) => ({ ...atual, faturas: (atual.faturas || []).map((f) => (gravadas.has(f.id) ? { ...f, ...gravadas.get(f.id) } : f)) }));
      setSelecionadas(new Set());
      const ignoradas = selecaoValida.length - gravadas.size;
      setAviso(`${inteiro(gravadas.size)} fatura(s) ${limpar ? 'sem previsão de pagamento' : `com pagamento previsto para ${dataBr(dataPrevisao)}`}.${ignoradas > 0 ? ` ${inteiro(ignoradas)} selecionada(s) não se aplicavam.` : ''}`);
    } catch (e) { setAviso(`Erro ao gravar a previsão: ${e.message || e}`); } finally { setMarcando(false); }
  };

  // Encaminhamento ao financeiro: so faturas em aberto ja lancadas ou no protocolo manual.
  const aplicarEncaminhamento = async () => {
    const porId = new Map(resultado.filter((l) => l.fatura).map((l) => [l.fatura.id, l.fatura]));
    const alvo = selecaoValida.filter((id) => situacaoPagamento(porId.get(id)) === 'ABERTA' && (agrupamentoManual(porId.get(id)) || faturaLancada(porId.get(id))));
    if (!alvo.length) { setAviso('Nenhuma selecionada está lançada ou no protocolo em aberto.'); return; }
    setMarcando(true); setAviso('');
    try {
      const sessao = carregarSessao();
      const gravadas = await marcarEncaminhamentoFinanceiro(alvo, tipoEncaminhamento, sessao?.nome || sessao?.email || '', { origem: 'DIAGNOSTICO' });
      onState((atual) => ({ ...atual, faturas: (atual.faturas || []).map((f) => (gravadas.has(f.id) ? { ...f, ...gravadas.get(f.id) } : f)) }));
      setSelecionadas(new Set());
      const ignoradas = selecaoValida.length - gravadas.size;
      setAviso(`${inteiro(gravadas.size)} fatura(s) encaminhada(s) ao financeiro (${TIPOS_ENCAMINHAMENTO[tipoEncaminhamento]}).${ignoradas > 0 ? ` ${inteiro(ignoradas)} selecionada(s) não se aplicavam.` : ''}`);
    } catch (e) { setAviso(`Erro ao encaminhar: ${e.message || e}`); } finally { setMarcando(false); }
  };

  // Programacao confirmada pelo SAP/HANA: planilha com Referencia, CNPJ, Data programada (e Valor, se houver).
  // So atualiza a data vigente (origem SAP_HANA, confirmada); a fatura segue em aberto ate o pagamento efetivo.
  const importarProgramacaoSap = async (ev) => {
    const arquivo = ev.target.files?.[0];
    ev.target.value = '';
    if (!arquivo) return;
    setMarcando(true); setAviso('');
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array', cellDates: true });
      const linhasPlanilha = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
      const todas = (state?.faturas || []);
      const { aplicar, revisao } = conciliarProgramacaoSap(linhasPlanilha, todas, { abertaFn: (f) => situacaoPagamento(f) === 'ABERTA' });
      const grupos = new Map();
      aplicar.forEach((a) => grupos.set(a.data, [...(grupos.get(a.data) || []), a.fatura_id]));
      if (aplicar.length && !window.confirm(`Aplicar a programação confirmada do SAP/HANA a ${aplicar.length} fatura(s)? ${revisao.length} linha(s) vão para revisão e não serão alteradas.`)) { setMarcando(false); return; }
      const sessao = carregarSessao();
      const todasGravadas = new Map();
      for (const [data, ids] of grupos) {
        // eslint-disable-next-line no-await-in-loop
        const gravadas = await marcarPrevisaoPagamento(ids, data, sessao?.nome || sessao?.email || '', { origem: 'SAP_HANA', confirmada: true });
        gravadas.forEach((campos, id) => todasGravadas.set(id, campos));
      }
      if (todasGravadas.size) onState((atual) => ({ ...atual, faturas: (atual.faturas || []).map((f) => (todasGravadas.has(f.id) ? { ...f, ...todasGravadas.get(f.id) } : f)) }));
      setAviso(`Programação SAP/HANA: ${inteiro(todasGravadas.size)} fatura(s) programada(s); ${inteiro(revisao.length)} linha(s) para revisão${revisao.length ? ` (${[...new Set(revisao.map((r) => r.motivo))].join(', ')})` : ''}.`);
    } catch (e) { setAviso(`Erro ao importar a programação: ${e.message || e}`); } finally { setMarcando(false); }
  };

  const usarVencimentosComoPrevisao = async () => {
    const porId = new Map(resultado.filter((l) => l.fatura).map((l) => [l.fatura.id, l.fatura]));
    const grupos = new Map();
    selecaoValida.forEach((id) => {
      const f = porId.get(id);
      if (!f || situacaoPagamento(f) !== 'ABERTA' || (!faturaLancada(f) && !agrupamentoManual(f)) || previsaoPagamento(f)) return;
      const prevista = previsaoInicialFinanceiro(f);
      if (prevista) grupos.set(prevista, [...(grupos.get(prevista) || []), id]);
    });
    const total = [...grupos.values()].reduce((s, ids) => s + ids.length, 0);
    if (!total) { setAviso('Nenhuma selecionada está no prazo e sem previsão. Faturas vencidas devem receber a data alinhada com o Financeiro ou permanecer sem previsão.'); return; }
    setMarcando(true); setAviso('');
    try {
      const sessao = carregarSessao();
      const todas = new Map();
      for (const [prevista, ids] of grupos) {
        // eslint-disable-next-line no-await-in-loop
        const gravadas = await marcarPrevisaoPagamento(ids, prevista, sessao?.nome || sessao?.email || '', { origem: 'VENCIMENTO_INICIAL' });
        gravadas.forEach((campos, id) => todas.set(id, campos));
      }
      onState((atual) => ({ ...atual, faturas: (atual.faturas || []).map((f) => (todas.has(f.id) ? { ...f, ...todas.get(f.id) } : f)) }));
      setSelecionadas(new Set());
      setAviso(`${inteiro(todas.size)} fatura(s) no prazo receberam o próprio vencimento como previsão inicial.`);
    } catch (e) { setAviso(`Erro ao aplicar os vencimentos: ${e.message || e}`); } finally { setMarcando(false); }
  };
  // Texto pronto para mandar a transportadora: faturas do recorte com previsao, agrupadas pela data.
  const comPrevisao = useMemo(() => resultado.filter((l) => previsaoPagamento(l.fatura)), [resultado]);
  const copiarPrevisoes = async () => {
    const porData = new Map();
    [...comPrevisao].sort((a, b) => previsaoPagamento(a.fatura).localeCompare(previsaoPagamento(b.fatura)) || String(a.numero).localeCompare(String(b.numero), 'pt-BR', { numeric: true }))
      .forEach((l) => { const d = previsaoPagamento(l.fatura); porData.set(d, [...(porData.get(d) || []), l]); });
    const transportadoras = [...new Set(comPrevisao.map((l) => l.fatura.transportadora).filter(Boolean))];
    const blocos = [...porData].map(([d, ls]) => [
      `Pagamento previsto para ${dataBr(d)}:`,
      ...ls.map((l) => `- Fatura ${l.numero} · vencimento ${dataBr(l.fatura.data_vencimento)} · ${dinheiro(valorDaLinha(l))}${transportadoras.length > 1 ? ` · ${l.fatura.transportadora}` : ''}`),
      `Total: ${dinheiro(ls.reduce((s, l) => s + valorDaLinha(l), 0))}`,
    ].join('\n'));
    const texto = [`Previsão de pagamento das faturas${transportadoras.length === 1 ? ` - ${transportadoras[0]}` : ''}`, '', blocos.join('\n\n')].join('\n');
    try {
      await navigator.clipboard.writeText(texto);
      setAviso(`Previsão de ${inteiro(comPrevisao.length)} fatura(s) copiada para mandar à transportadora.`);
    } catch { setAviso('O navegador não permitiu copiar.'); }
  };

  // Ajuste Fenix: marca as selecionadas como enviadas ao financeiro, com retorno recebido, ou desfaz.
  const temAjusteFenix = useMemo(() => linhas.some((l) => etapaFenix(l)), [linhas]);
  const aplicarAjusteFenix = async (acao) => {
    const porId = new Map(resultado.filter((l) => l.fatura).map((l) => [l.fatura.id, l]));
    const alvo = selecaoValida.filter((id) => {
      const l = porId.get(id);
      const status = statusAjusteFenix(l.fatura);
      if (acao === 'ENVIADO') return !status && temFenix(l);
      if (acao === 'RETORNADO') return status === 'ENVIADO';
      return Boolean(status);
    });
    if (!alvo.length) {
      setAviso({
        ENVIADO: 'Nenhuma selecionada com CT-e na Fênix ainda sem envio ao financeiro.',
        RETORNADO: 'Nenhuma selecionada está como enviada ao financeiro (aguardando retorno).',
        '': 'Nenhuma selecionada tem marcação de ajuste Fênix.',
      }[acao]);
      return;
    }
    if (!acao && !window.confirm(`Tirar a marcação de ajuste Fênix de ${alvo.length} fatura(s)? Elas voltam para "a enviar" se ainda tiverem CT-e na Fênix.`)) return;
    setMarcando(true);
    setAviso('');
    try {
      const sessao = carregarSessao();
      const gravadas = await marcarAjusteFenix(alvo, acao, sessao?.nome || sessao?.email || '');
      onState((atual) => ({ ...atual, faturas: (atual.faturas || []).map((f) => (gravadas.has(f.id) ? { ...f, ...gravadas.get(f.id) } : f)) }));
      setSelecionadas(new Set());
      const texto = { ENVIADO: 'marcada(s) como enviada(s) para ajustar a Fênix', RETORNADO: 'com retorno do financeiro: agora é mandar protocolo', '': 'sem marcação de ajuste Fênix' }[acao];
      const ignoradas = selecaoValida.length - gravadas.size;
      setAviso(`${inteiro(gravadas.size)} fatura(s) ${texto}.${ignoradas > 0 ? ` ${inteiro(ignoradas)} selecionada(s) não se aplicavam.` : ''}`);
    } catch (e) { setAviso(`Erro ao marcar: ${e.message || e}`); } finally { setMarcando(false); }
  };

  const descricaoFiltros = () => {
    const cards = GRUPOS_DIAGNOSTICO.filter((g) => escolhidos[g.id]).map((g) => [g.titulo, g.cards.find((c) => c.id === escolhidos[g.id])?.rotulo || '']);
    const campos = [['Busca', filtros.busca], ['Auditor', filtroAuditor], ['Status', nomeStatus(filtros.status)], ['Canal', filtros.canal], ['Vencimento de', dataBr(filtros.vencimentoDe)], ['Vencimento até', dataBr(filtros.vencimentoAte)], ['Pagamento (compensação) de', dataBr(filtros.pagamentoDe)], ['Pagamento (compensação) até', dataBr(filtros.pagamentoAte)], ['Transportadora (ranking)', filtros.grupoTransp ? rotuloTransp(filtros.grupoTransp) : ''], ['Auditor (ranking)', filtros.grupoAuditor === SEM_TRANSP ? 'Não localizadas' : filtros.grupoAuditor]]
      .filter(([, v]) => v && v !== '-');
    return [['Transportadora', transportadora || 'Todas'], ['Auditor', auditorEscolhido || 'Todos'], ['Números colados', temLista ? String(lista.itens.length) : 'Nenhum'], ...cards, ...campos];
  };
  const hojeArquivo = new Date().toLocaleDateString('sv-SE');

  const exportarFaturas = async () => {
    setExportando(true);
    try {
      await exportarExcelFormatado({
        nomeArquivo: `diagnostico-faturas-${hojeArquivo}.xlsx`,
        aba: 'Faturas',
        colunas: [
          { titulo: 'Fatura', largura: 14 }, { titulo: 'Na plataforma', largura: 14, tipo: 'centro' }, { titulo: 'Transportadora', largura: 34 }, { titulo: 'CNPJ', largura: 18 },
          { titulo: 'Emissão', largura: 12, tipo: 'data' }, { titulo: 'Vencimento', largura: 12, tipo: 'data' }, { titulo: 'Dias p/ vencer', largura: 10, tipo: 'inteiro' },
          { titulo: 'Previsão de pagamento', largura: 12, tipo: 'data' }, { titulo: 'Previsão por', largura: 22 },
          { titulo: 'Valor plataforma', largura: 16, tipo: 'moeda' }, { titulo: 'Valor da lista', largura: 16, tipo: 'moeda' }, { titulo: 'Vencimento da lista', largura: 12, tipo: 'data' },
          { titulo: 'Status', largura: 24 }, { titulo: 'CT-es auditados', largura: 10, tipo: 'inteiro' }, { titulo: 'CT-es totais', largura: 10, tipo: 'inteiro' },
          { titulo: 'Resultado da auditoria', largura: 24 }, { titulo: 'Diferença apurada', largura: 14, tipo: 'moeda' }, { titulo: 'Motivo principal', largura: 24 },
          { titulo: 'Fatura lançada', largura: 10, tipo: 'centro' }, { titulo: 'Partida', largura: 14 }, { titulo: 'Lançamento financeiro', largura: 14 }, { titulo: 'Enviado ERP', largura: 12, tipo: 'data' }, { titulo: 'Situação envio ERP', largura: 22 },
          { titulo: 'CT-es com partida', largura: 10, tipo: 'inteiro' }, { titulo: 'CT-es sem partida', largura: 10, tipo: 'inteiro' }, { titulo: 'Valor sem partida', largura: 16, tipo: 'moeda' },
          { titulo: 'Id do OMS', largura: 26 }, { titulo: 'Situação OMS/SAP', largura: 26 }, { titulo: 'Pendência para o SAP', largura: 50 },
          { titulo: 'Pagamento', largura: 18 }, { titulo: 'Data pagamento', largura: 12, tipo: 'data' }, { titulo: 'Valor pago', largura: 16, tipo: 'moeda' }, { titulo: 'Auditor', largura: 26 }, { titulo: 'Próxima ação', largura: 28 }, { titulo: 'Agrupamento manual', largura: 20 }, { titulo: 'Marcado por', largura: 22 },
          { titulo: 'Ajuste Fênix', largura: 30 }, { titulo: 'Enviado Fênix em', largura: 12, tipo: 'data' }, { titulo: 'Enviado Fênix por', largura: 22 }, { titulo: 'Retorno Fênix em', largura: 12, tipo: 'data' }, { titulo: 'Observação', largura: 34 },
        ],
        linhas: resultado.map((l) => {
          const f = l.fatura;
          const observacao = !f && l.outrasTransportadoras?.length ? `Existe em: ${l.outrasTransportadoras.join(', ')}` : l.repetida > 1 ? `Número em ${l.repetida} faturas ativas` : '';
          return [
            String(l.numero), f ? 'Sim' : 'Não', f?.transportadora || '', f?.cnpj_transportadora || '', f?.data_emissao || '', f?.data_vencimento || '', (f?.data_vencimento || l.vencimentoLista) ? diasAte(f?.data_vencimento || l.vencimentoLista) ?? '' : '',
            previsaoPagamento(f), previsaoPagamento(f) ? (f.previsao_pagamento_por || '') : '',
            f ? Number(f.valor_fatura || 0) : '', l.valorLista ?? '', l.vencimentoLista || '', f ? nomeStatus(f.status) : '', f ? Number(f.ctes_auditados || 0) : '', f ? Number(f.ctes_totais || 0) : '',
            resultadoAuditoria(f)?.rotulo || '', f ? resultadoAuditoria(f).diferenca : '', resultadoAuditoria(f)?.motivo || '',
            f ? (faturaLancada(f) ? 'Sim' : 'Não') : '', f?.partida || '', f?.lancamento_financeiro || '', f?.data_envio_erp || '', f ? ROTULO_ENVIO_ERP[situacaoEnvioErp(l)] : '', l.ctes ? l.ctes.lancados : '', l.ctes ? l.ctes.semPartida.length : '', l.ctes ? l.ctes.valorSemPartida : '',
            f?.oms_invoice_id || '', ROTULO_OMS[situacaoOms(l)] || '', situacaoOms(l) === 'BLOQUEADA_PARTIDA' ? aptidaoEnvioSap(l.ctes).mensagem : '',
            textoPagamentoLinha(l), f?.data_pagamento || '', f?.valor_pago != null ? Number(f.valor_pago) : '', f ? l.auditor : '', proximaAcao(l),
            agrupamentoManual(f) ? (faturaLancada(f) ? 'Já agrupada' : 'A enviar') : '', agrupamentoManual(f) ? (f.agrupamento_manual_por || '') : '',
            ROTULO_ETAPA_FENIX[etapaFenix(l)] || '', f?.fenix_enviado_em ? String(f.fenix_enviado_em).slice(0, 10) : '', f?.fenix_enviado_por || '', f?.fenix_retorno_em ? String(f.fenix_retorno_em).slice(0, 10) : '',
            observacao,
          ];
        }),
        resumo: descricaoFiltros(),
      });
    } catch (e) { setAviso(`Erro ao exportar: ${e.message || e}`); } finally { setExportando(false); }
  };

  const exportarFilaProtocolo = async () => {
    const { fila, resumoPorAuditor } = montarFilaProtocolo(resultado);
    if (!fila.length) { setAviso('Nenhuma fatura ativa na fila de protocolo deste recorte.'); return; }
    setExportando(true);
    try {
      await exportarExcelFormatado({
        nomeArquivo: `protocolo-financeiro-${hojeArquivo}.xlsx`, aba: 'Protocolo',
        colunas: [
          { titulo: 'Auditor', largura: 26 }, { titulo: 'Fatura', largura: 16 }, { titulo: 'Transportadora', largura: 34 },
          { titulo: 'Valor', largura: 16, tipo: 'moeda' }, { titulo: 'Vencimento', largura: 12, tipo: 'data' },
          { titulo: 'Encaminhamento', largura: 24 }, { titulo: 'Responsável', largura: 24 }, { titulo: 'Encaminhado em', largura: 18 },
          { titulo: 'Previsão vigente', largura: 14, tipo: 'data' }, { titulo: 'Programação confirmada', largura: 14, tipo: 'centro' },
          { titulo: 'Partida da fatura', largura: 18 }, { titulo: 'Partidas dos CT-es (contingência)', largura: 44 }, { titulo: 'Situação', largura: 28 },
        ],
        linhas: fila.map((l) => {
          const f = l.fatura;
          const partidasCtes = [...new Set((l.ctes?.itens || []).map((c) => c.lancamento_contabil).filter(Boolean))].join(', ');
          return [l.auditor, String(f.numero_fatura || ''), f.transportadora || '', Number(f.valor_fatura || 0), f.data_vencimento || '',
            f.encaminhamento_tipo || (f.encaminhado_financeiro_em ? 'ENCAMINHADO' : 'A_ENCAMINHAR'), f.encaminhado_financeiro_por || '', f.encaminhado_financeiro_em || '',
            previsaoPagamento(f), f.programacao_confirmada ? 'Sim' : 'Não', f.partida || f.lancamento_financeiro || '',
            (f.partida || f.lancamento_financeiro) ? '' : partidasCtes, proximaAcao(l)];
        }),
        resumo: [...descricaoFiltros(),
          ['Regra', 'Pagas e estornadas sem relançamento ficam fora; sem partida da fatura exporta as partidas dos CT-es vinculados.'],
          ...resumoPorAuditor.map((a) => [`Auditor: ${a.auditor}`, `${a.quantidade} fatura(s) · R$ ${a.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`])],
      });
    } catch (e) { setAviso(`Erro ao exportar protocolo: ${e.message || e}`); } finally { setExportando(false); }
  };

  const ctesSemPartida = useMemo(() => resultado.flatMap((l) => (l.ctes?.semPartida || []).map((c) => ({ l, c }))), [resultado]);
  const exportarCtes = async () => {
    setExportando(true);
    try {
      await exportarExcelFormatado({
        nomeArquivo: `ctes-sem-partida-${hojeArquivo}.xlsx`,
        aba: 'CT-es sem partida',
        colunas: [
          { titulo: 'Fatura', largura: 14 }, { titulo: 'Transportadora', largura: 34 }, { titulo: 'Vencimento fatura', largura: 12, tipo: 'data' }, { titulo: 'Número CT-e', largura: 14 }, { titulo: 'Série', largura: 8, tipo: 'centro' }, { titulo: 'CT-e SAP', largura: 16 },
          { titulo: 'Chave CT-e', largura: 48 }, { titulo: 'Valor frete', largura: 16, tipo: 'moeda' }, { titulo: 'Situação', largura: 18 },
        ],
        linhas: ctesSemPartida.map(({ l, c }) => [String(l.numero), l.fatura.transportadora || '', l.fatura.data_vencimento || '', String(c.numero_cte || ''), String(c.serie_cte || ''), cteSap(c), String(c.chave_cte || ''), c.valor_frete, c.estornado ? 'Estornado no SAP' : 'Sem partida']),
        resumo: descricaoFiltros(),
      });
    } catch (e) { setAviso(`Erro ao exportar: ${e.message || e}`); } finally { setExportando(false); }
  };
  const todosCtes = useMemo(() => resultado.flatMap((l) => (l.ctes?.itens || []).map((c) => ({ l, c }))), [resultado]);
  const exportarTodosCtes = async () => {
    setExportando(true);
    try {
      await exportarExcelFormatado({
        nomeArquivo: `ctes-faturas-${hojeArquivo}.xlsx`,
        aba: 'CT-es',
        colunas: [
          { titulo: 'Fatura', largura: 14 }, { titulo: 'Transportadora', largura: 34 }, { titulo: 'Status fatura', largura: 22 }, { titulo: 'Vencimento fatura', largura: 12, tipo: 'data' }, { titulo: 'Pagamento fatura', largura: 22 },
          { titulo: 'Número CT-e', largura: 14 }, { titulo: 'Série', largura: 8, tipo: 'centro' }, { titulo: 'CT-e SAP', largura: 16 }, { titulo: 'Chave CT-e', largura: 48 }, { titulo: 'Valor frete', largura: 16, tipo: 'moeda' },
          { titulo: 'Situação SAP', largura: 18 }, { titulo: 'Partida CT-e', largura: 14 }, { titulo: 'Data lançamento', largura: 12, tipo: 'data' }, { titulo: 'Valor lançado', largura: 16, tipo: 'moeda' },
          { titulo: 'Partida Fênix', largura: 12, tipo: 'centro' },
        ],
        linhas: todosCtes.map(({ l, c }) => [
          String(l.numero), l.fatura.transportadora || '', nomeStatus(l.fatura.status), l.fatura.data_vencimento || '', textoPagamentoLinha(l),
          String(c.numero_cte || ''), String(c.serie_cte || ''), cteSap(c), String(c.chave_cte || ''), c.valor_frete,
          ROTULO_SITUACAO_CTE[c.situacao] || '', c.lancamento_contabil || '', c.data_lancamento || '', c.situacao === 'COM_PARTIDA' ? c.valor_lancado : '',
          c.fenix ? 'Sim' : '',
        ]),
        resumo: descricaoFiltros(),
      });
    } catch (e) { setAviso(`Erro ao exportar: ${e.message || e}`); } finally { setExportando(false); }
  };
  // Partida Fenix: CT-es do recorte compensados pela 1501163056, no formato do termo enviado ao financeiro.
  const ctesFenix = useMemo(() => resultado.flatMap((l) => (l.ctes?.fenix || []).map((c) => ({ ...c, numero_fatura: String(l.numero), transportadora: l.fatura.transportadora || '' }))), [resultado]);
  const partidasFenix = useMemo(() => partidasDoTermo(ctesFenix), [ctesFenix]);
  const faturasFenix = useMemo(() => resultado.filter(temFenix).length, [resultado]);
  const exportarFenixExcel = async () => {
    setExportando(true);
    try {
      await exportarExcelFormatado({
        nomeArquivo: `termo-correcao-fenix-${hojeArquivo}.xlsx`,
        aba: 'Partida Fênix',
        colunas: [
          { titulo: 'Empresa', largura: 26 }, { titulo: 'Cód. fornecedor', largura: 14, tipo: 'centro' }, { titulo: 'Fornecedor', largura: 34 }, { titulo: 'Pedido', largura: 22 },
          { titulo: 'Partida', largura: 14, tipo: 'centro' }, { titulo: 'Solicitante', largura: 24 }, { titulo: 'Motivo correção', largura: 30 },
          { titulo: 'Fatura', largura: 14 }, { titulo: 'Número CT-e', largura: 12 }, { titulo: 'Série', largura: 7, tipo: 'centro' }, { titulo: 'CT-e SAP', largura: 16 }, { titulo: 'Chave CT-e', largura: 48 },
          { titulo: 'Valor frete', largura: 15, tipo: 'moeda' }, { titulo: 'Montante SAP', largura: 15, tipo: 'moeda' }, { titulo: 'Data lançamento', largura: 12, tipo: 'data' }, { titulo: 'Data compensação', largura: 12, tipo: 'data' },
        ],
        linhas: ctesFenix.map((c) => [
          nomeEmpresaSap(c.empresa), c.codigo_fornecedor || '', c.fornecedor || c.transportadora, `${c.documento_compensacao || PARTIDAS_FENIX[0]} ${ROTULO_FENIX}`,
          String(c.partida || ''), solicitante, MOTIVO_FENIX,
          c.numero_fatura, String(c.numero_cte || ''), String(c.serie_cte || ''), cteSap(c), String(c.chave_cte || ''), c.valor_frete, c.montante, c.data_lancamento || '', c.data_compensacao || '',
        ]),
        resumo: [...descricaoFiltros(), ['Partida Fênix', PARTIDAS_FENIX.join(', ')], ['CT-es', String(ctesFenix.length)], ['Partidas', String(partidasFenix.length)], ['Solicitante', solicitante || '-']],
      });
    } catch (e) { setAviso(`Erro ao exportar: ${e.message || e}`); } finally { setExportando(false); }
  };
  const gerarTermoWord = async () => {
    setExportando(true);
    try {
      const resposta = await fetch(modeloTermoUrl);
      if (!resposta.ok) throw new Error(`modelo do termo não encontrado (${resposta.status})`);
      const bytes = gerarTermoDocx(new Uint8Array(await resposta.arrayBuffer()), ctesFenix, { solicitante });
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `Termo_Correcao_Lancamento_Fenix_${hojeArquivo}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { setAviso(`Erro ao gerar o termo: ${e.message || e}`); } finally { setExportando(false); }
  };

  // Laudo visual (HTML autonomo) do recorte atual: pago x programado no financeiro x em tratativa.
  const gerarLaudo = () => {
    try {
      const transps = [...new Set(resultado.filter((l) => l.fatura).map((l) => l.fatura.transportadora).filter(Boolean))];
      const titulo = transportadora || (transps.length === 1 ? transps[0] : auditorEscolhido ? `Auditor ${auditorEscolhido}` : verTodosAuditores ? 'Faturas em aberto' : 'Faturas selecionadas');
      const html = gerarHtmlLaudo({ linhas: resultado, titulo, filtros: descricaoFiltros() });
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `laudo-faturas-${titulo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}-${hojeArquivo}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setAviso('Laudo baixado. Abra o arquivo no navegador; para PDF, use Imprimir > Salvar como PDF.');
    } catch (e) { setAviso(`Erro ao gerar o laudo: ${e.message || e}`); }
  };

  const copiarNumeros = async () => {
    try {
      await navigator.clipboard.writeText(resultado.map((l) => l.numero).join('\n'));
      setAviso(`${inteiro(resultado.length)} número(s) copiado(s).`);
    } catch { setAviso('O navegador não permitiu copiar.'); }
  };

  const cabecalhoCel = (c) => (
    <th key={c.id} onClick={() => ordenarPor(c.id)} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }} aria-sort={ordem.coluna === c.id ? (ordem.direcao === 1 ? 'ascending' : 'descending') : undefined}>
      {c.titulo}{ordem.coluna === c.id ? (ordem.direcao === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <>
      <div className="panel-card" style={{ marginBottom: 14 }}>
        <div className="panel-title audit-table-title">Diagnóstico de faturas</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 8, flex: '1 1 220px', maxWidth: 320 }}>
            <label className="field">Transportadora
              <select value={transportadora} onChange={(e) => setTransportadora(e.target.value)}>
                <option value="">Todas</option>
                {transportadoras.map((t) => { const nomes = nomesDoGrupo.get(t) || []; return <option key={t} value={t} title={nomes.length > 1 ? `Inclui: ${nomes.join(' · ')}` : undefined}>{t}{nomes.length > 1 ? ` (${nomes.length} nomes)` : ''}</option>; })}
              </select>
            </label>
            <label className="field">Auditor
              <div style={{ display: 'flex', gap: 6 }}>
                <select value={verTodosAuditores ? TODOS_AUDITORES : auditorEscolhido} onChange={(e) => setAuditor(e.target.value)} style={{ flex: 1, minWidth: 0 }}>
                  <option value="">Nenhum</option>
                  <option value={TODOS_AUDITORES}>Todos os auditores (visão geral)</option>
                  {auditores.map((a) => { const grafias = unificador.grafiasDe(a); return <option key={a} value={a} title={grafias.length > 1 ? `Inclui: ${grafias.join(' · ')}` : undefined}>{a}</option>; })}
                </select>
                {!verTodosAuditores && <button type="button" className="btn-secondary" onClick={() => setAuditor(TODOS_AUDITORES)} title="Visão do gestor: faturas em aberto de todos os auditores, com os cards de vencidas, a vencer etc.">Todos</button>}
                {meuNome && auditorEscolhido !== meuNome && <button type="button" className="btn-secondary" onClick={() => setAuditor(meuNome)} title={`Mostrar as faturas de ${meuNome}`}>Minhas</button>}
              </div>
            </label>
            <button type="button" className="btn-secondary" onClick={limparTudo} disabled={!texto && !transportadora && !auditor && !temFiltro}>Limpar tudo</button>
          </div>
          <label className="field" style={{ flex: '999 1 260px', minWidth: 0 }}>Lista de faturas (cole do Excel ou e-mail; vencimento e valor são opcionais)
            <textarea
              rows={4}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={'Um número por linha, ou a tabela com as colunas Fatura, Vencimento e Valor.\nSem lista, mostra as faturas da transportadora e/ou do auditor escolhido.'}
              spellCheck={false}
            />
          </label>
        </div>
        {(temLista || transportadora || auditor) && (
          <div className="compact" style={{ marginTop: 8, color: '#475569', fontSize: 13 }}>
            {temLista ? `${inteiro(lista.itens.length)} número(s) lido(s)${lista.repetidosNaLista ? ` · ${inteiro(lista.repetidosNaLista)} repetido(s) na lista ignorado(s)` : ''}` : transportadora ? `Todas as faturas de ${transportadora}${auditorEscolhido ? ` do auditor ${auditorEscolhido}` : ''}` : `Faturas em aberto de ${verTodosAuditores ? 'todos os auditores' : auditorEscolhido} (não pagas; as canceladas ficam no card "Canceladas")`}{temLista && auditorEscolhido ? ` · só as do auditor ${auditorEscolhido}` : ''}
            {progresso ? ` · Verificando CT-es no SAP: ${inteiro(progresso.feitas)} de ${inteiro(progresso.total)} faturas...` : ''}
            {ultimaSap ? ` · Partidas de CT-e conforme o relatório SAP importado (último lançamento em ${dataBr(ultimaSap)}).` : ''}
          </div>
        )}
        {erroCtes && <p className="error-text" style={{ marginTop: 8 }}>Não foi possível verificar os CT-es no SAP: {erroCtes}</p>}
      </div>

      {!linhas.length ? (
        <div className="hint-box">Cole uma lista de faturas, escolha uma transportadora ou um auditor, ou clique em "Todos" para a visão geral de todos os auditores.</div>
      ) : (
        <>
          <div className="summary-strip audit-summary-grid" style={{ marginBottom: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <CardResumo rotulo="Faturas no recorte" valor={inteiro(resultado.length)} detalhe={`de ${inteiro(linhas.length)}`} cor="#071d49" dica="Clique para mostrar todas (tira os filtros de card e de pesquisa)." onClick={limparFiltros} />
            <CardResumo rotulo="Valor total" valor={dinheiro(totais.total.valor)} detalhe={totais.total.detalhe} cor="#071d49" dica="Clique para mostrar todas (tira os filtros de card e de pesquisa)." onClick={limparFiltros} />
            <CardResumo rotulo="Em aberto" valor={dinheiro(totais.aberto.valor)} detalhe={totais.aberto.detalhe} cor="#315ee7" ativo={escolhidos.pagamento === 'abertas'} dica="Clique para ver as faturas não pagas." onClick={() => alternarCard('pagamento', 'abertas')} />
            <CardResumo rotulo="Vencido" valor={dinheiro(totais.vencido.valor)} detalhe={totais.vencido.detalhe} cor="#9b1111" ativo={escolhidos.vencimento === 'vencidas'} dica="Clique para ver as faturas vencidas e não pagas." onClick={() => alternarCard('vencimento', 'vencidas')} />
            <CardResumo rotulo="A vencer" valor={dinheiro(totais.aVencer.valor)} detalhe={totais.aVencer.detalhe} cor="#e67e22" ativo={escolhidos.vencimento === 'a_vencer'} dica="Clique para ver as faturas não pagas que ainda vão vencer." onClick={() => alternarCard('vencimento', 'a_vencer')} />
            <CardResumo rotulo="Pago" valor={dinheiro(totais.pago.valor)} detalhe={totais.pago.detalhe} cor="#14733b" ativo={escolhidos.pagamento === 'pagas_todas'} dica="Clique para ver as faturas pagas, com ou sem divergência." onClick={() => alternarCard('pagamento', 'pagas_todas')} />
            <CardResumo rotulo="Canceladas" valor={inteiro(canceladasRecorte.length)} detalhe={`${dinheiro(canceladasRecorte.reduce((s, l) => s + valorDaLinha(l), 0))} · clique para ver`} cor="#64748b" ativo={escolhidos.pagamento === 'canceladas'} dica="Canceladas/substituídas ficam fora da lista e dos totais. Clique para vê-las (e reativar, se preciso)." onClick={() => alternarCard('pagamento', 'canceladas')} />
            {(duplicadasRecorte.length > 0 || verDuplicadas) && <CardResumo rotulo="Duplicadas" valor={inteiro(duplicadasRecorte.length)} detalhe={`${dinheiro(duplicadasRecorte.reduce((s, l) => s + valorDaLinha(l), 0))} · fora dos totais`} cor="#b45309" ativo={verDuplicadas} dica="Mesma fatura (número, valor e emissão) importada mais de uma vez. Não entram nos totais; clique para ver e marcar como substituídas." onClick={() => alternarCard('pagamento', 'duplicadas')} />}

          </div>

          {grupos.map((g) => (
            <section key={g.id} style={{ marginBottom: 12 }}>
              <h3 style={{ fontSize: 13, margin: '0 0 6px', color: '#475569' }}>{g.titulo}</h3>
              <div className="summary-strip audit-summary-grid">
                {g.cards.map((c) => <CardFiltro key={c.id} card={c} grupo={g.id} linhas={c.linhas} ativo={escolhidos[g.id] === c.id} onClick={() => alternarCard(g.id, c.id)} />)}
              </div>
            </section>
          ))}

          <div className="panel-card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              <label className="field">Buscar<input value={filtros.busca} onChange={mudarFiltro('busca')} placeholder="Número, transportadora, auditor" /></label>
              <label className="field">Auditor<select value={filtroAuditor} onChange={mudarFiltro('auditor')}><option value="">Todos</option>{opcoes.auditores.map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
              <label className="field">Status<select value={filtros.status} onChange={mudarFiltro('status')}><option value="">Todos</option>{opcoes.status.map((s) => <option key={s} value={s}>{nomeStatus(s)}</option>)}</select></label>
              <label className="field">Canal<select value={filtros.canal} onChange={mudarFiltro('canal')}><option value="">Todos</option>{opcoes.canais.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
              <label className="field">Vencimento de<input type="date" value={filtros.vencimentoDe} onChange={mudarFiltro('vencimentoDe')} /></label>
              <label className="field">Vencimento até<input type="date" value={filtros.vencimentoAte} onChange={mudarFiltro('vencimentoAte')} /></label>
              <label className="field" title="Data de compensação (pagamento) da fatura no SAP">Pago de<input type="date" value={filtros.pagamentoDe} onChange={mudarFiltro('pagamentoDe')} /></label>
              <label className="field" title="Data de compensação (pagamento) da fatura no SAP">Pago até<input type="date" value={filtros.pagamentoAte} onChange={mudarFiltro('pagamentoAte')} /></label>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
              <button type="button" className="btn-primary" disabled={!resultado.length || exportando} onClick={exportarFaturas}>Exportar faturas ({inteiro(resultado.length)})</button>
              <button type="button" className="btn-primary" style={{ background: '#9153F0', borderColor: '#9153F0' }} disabled={!resultado.length || exportando} onClick={exportarFilaProtocolo}>Exportar fila de protocolo</button>
              <button type="button" className="btn-primary" style={{ background: '#04a484', borderColor: '#04a484' }} disabled={!resultado.some((l) => l.fatura)} onClick={gerarLaudo} title="Laudo visual das faturas do recorte: total, pago, programado no financeiro (protocolo com previsão) e em tratativa. Baixa um HTML que abre no navegador e imprime em PDF.">Gerar laudo</button>
              <button type="button" className="btn-secondary" disabled={!todosCtes.length || exportando || Boolean(progresso)} onClick={exportarTodosCtes} title={progresso ? 'Aguarde a verificação dos CT-es no SAP terminar' : 'Todos os CT-es das faturas do recorte, com a partida de cada um'}>Exportar CT-es ({inteiro(todosCtes.length)})</button>
              <button type="button" className="btn-secondary" disabled={!ctesSemPartida.length || exportando} onClick={exportarCtes}>Exportar CT-es sem partida ({inteiro(ctesSemPartida.length)})</button>
              <button type="button" className="btn-secondary" disabled={!resultado.length} onClick={copiarNumeros}>Copiar números</button>
              <button type="button" className="btn-secondary" disabled={Boolean(progresso) || atualizando} onClick={atualizarDados} title="Busca de novo as faturas, os CT-es e as partidas no banco">{atualizando ? 'Atualizando...' : '↻ Atualizar dados'}</button>
              {temFiltro && <button type="button" className="btn-secondary" onClick={limparFiltros}>Limpar filtros</button>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: '1px dashed #cbd5e1' }}>
              <span className="compact" style={{ color: '#475569' }} title="Contingência até o protocolo funcionar dentro do AMD. A fatura sai do card 'a enviar' quando receber partida.">
                Agrupamento manual (contingência): {inteiro(selecaoValida.length)} selecionada(s)
              </span>
              <button type="button" className="btn-primary" style={{ background: '#9153F0', borderColor: '#9153F0' }} disabled={!selecaoValida.length || marcando} onClick={() => aplicarAgrupamento(true)}>{marcando ? 'Gravando...' : 'Marcar para agrupamento manual'}</button>
              <button type="button" className="btn-secondary" disabled={!selecaoValida.length || marcando} onClick={() => aplicarAgrupamento(false)}>Desmarcar</button>
              {selecaoValida.length > 0 && <button type="button" className="btn-secondary" onClick={() => setSelecionadas(new Set())}>Limpar seleção</button>}
              {aviso && <span className="compact" role="status">{aviso}</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: '1px dashed #cbd5e1' }}>
              <span className="compact" style={{ color: '#475569' }} title="Registra que a fatura foi encaminhada ao financeiro (boleto na pasta ou dados bancários). Não é programação nem pagamento.">
                Encaminhamento ao financeiro: {inteiro(selecaoValida.length)} selecionada(s)
              </span>
              <select value={tipoEncaminhamento} onChange={(e) => setTipoEncaminhamento(e.target.value)} aria-label="Tipo de encaminhamento">
                {Object.entries(TIPOS_ENCAMINHAMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <button type="button" className="btn-primary" style={{ background: '#315ee7', borderColor: '#315ee7' }} disabled={!selecaoValida.length || marcando} onClick={aplicarEncaminhamento}>{marcando ? 'Gravando...' : 'Encaminhar ao financeiro'}</button>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: '1px dashed #cbd5e1' }}>
              <span className="compact" style={{ color: '#475569' }} title="Data alinhada com o financeiro para as faturas marcadas para protocolo. As demais seguem o vencimento. Some quando a fatura é paga.">
                Previsão de pagamento (protocolo): {inteiro(selecaoValida.length)} selecionada(s)
              </span>
              <input type="date" value={dataPrevisao} onChange={(e) => setDataPrevisao(e.target.value)} aria-label="Data prevista de pagamento" />
              <label className="compact" style={{ display: 'flex', gap: 4, alignItems: 'center' }} title="Marque só quando o financeiro confirmou a programação. Sem marcar, a data é apenas previsão.">
                <input type="checkbox" checked={programacaoConfirmada} onChange={(e) => setProgramacaoConfirmada(e.target.checked)} /> Confirmada pelo financeiro
              </label>
              <button type="button" className="btn-primary" style={{ background: '#04a484', borderColor: '#04a484' }} disabled={!selecaoValida.length || !dataPrevisao || marcando} onClick={() => aplicarPrevisao(false)}>{marcando ? 'Gravando...' : 'Gravar previsão'}</button>
              <button type="button" className="btn-secondary" disabled={!selecaoValida.length || marcando} onClick={usarVencimentosComoPrevisao} title="Somente faturas ainda no prazo e sem previsão; vencidas ficam sem previsão até o alinhamento com o Financeiro">Usar vencimentos no prazo</button>
              <button type="button" className="btn-secondary" disabled={!selecaoValida.length || marcando} onClick={() => aplicarPrevisao(true)}>Tirar previsão</button>
              <label className="btn-secondary" style={{ cursor: marcando ? 'not-allowed' : 'pointer' }} title="Planilha do SAP/HANA com Referência, CNPJ, Data programada e (opcional) Valor. Só atualiza a data vigente como programação confirmada; a fatura continua em aberto até o pagamento efetivo. Linhas sem CNPJ, ambíguas ou divergentes não são alteradas.">
                Importar programação SAP/HANA
                <input type="file" accept=".xlsx,.xls,.csv" hidden disabled={marcando} onChange={importarProgramacaoSap} />
              </label>
              <button type="button" className="btn-secondary" disabled={!comPrevisao.length} onClick={copiarPrevisoes} title="Copia um texto com as faturas do recorte que têm previsão, agrupadas pela data, para mandar à transportadora">Copiar previsões p/ transportadora ({inteiro(comPrevisao.length)})</button>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: '1px dashed #cbd5e1' }}>
              <span className="compact" style={{ color: '#475569' }} title="Mesmas regras da lista de faturas: sem cobrança a maior e com a auditoria completa libera para pagamento (e vai ao OMS/SAP); senão vai para a aprovação da gestão.">
                Liberação: {inteiro(selecaoValida.length)} selecionada(s)
              </span>
              <button type="button" className="btn-primary" disabled={!selecaoValida.length || marcando || Boolean(processandoLote) || !liberarEmLote} onClick={abrirLiberacaoLote}>Liberar para pagamento</button>
              <button type="button" className="btn-secondary" disabled={!selecaoValida.length || marcando || Boolean(processandoLote)} onClick={enviarOmsLote} title="Envia ao OMS/SAP as selecionadas já liberadas que ainda não foram (Apta, Bloqueada por partida ou com Erro). Cada uma é conferida antes.">Enviar ao OMS</button>
              {processandoLote && <span className="compact" style={{ color: '#475569' }}>{processandoLote}</span>}
            </div>
            {liberacaoLote && (
              <div className="hint-box compact" style={{ marginTop: 8, borderColor: '#93c5fd', background: '#eff6ff' }}>
                <p style={{ margin: '0 0 6px' }}>
                  <strong>Liberar {inteiro(liberacaoLote.alvo.length)} fatura(s) para pagamento.</strong>
                  {liberacaoLote.fora ? ` ${inteiro(liberacaoLote.fora)} selecionada(s) ficam de fora (já liberadas, pagas, canceladas ou na gestão).` : ''}
                </p>
                {liberacaoLote.comCobranca.length > 0
                  ? <p style={{ margin: '0 0 6px' }}><strong>{inteiro(liberacaoLote.comCobranca.length)}</strong> com cobrança a maior vão para a aprovação da gestão, com a sua resposta. As demais são liberadas direto.</p>
                  : <p style={{ margin: '0 0 6px' }}>Nenhuma com cobrança a maior: serão liberadas para pagamento (auditoria incompleta vai para a gestão).</p>}
                {liberacaoLote.comCobranca.length > 0 && (
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
                    <span>Esse valor de diferença será descontado? *</span>
                    <label><input type="radio" checked={liberacaoLote.descontar === 'SIM'} onChange={() => setLiberacaoLote((p) => ({ ...p, descontar: 'SIM', erro: '' }))} /> Sim</label>
                    <label><input type="radio" checked={liberacaoLote.descontar === 'NAO'} onChange={() => setLiberacaoLote((p) => ({ ...p, descontar: 'NAO', erro: '' }))} /> Não</label>
                    {liberacaoLote.descontar === 'NAO' && <input style={{ flex: '1 1 260px' }} placeholder="Motivo de não descontar (mín. 10 caracteres)" value={liberacaoLote.motivo} onChange={(e) => setLiberacaoLote((p) => ({ ...p, motivo: e.target.value, erro: '' }))} />}
                  </div>
                )}
                <input style={{ width: '100%', marginBottom: 6 }} placeholder="Observação (opcional)" value={liberacaoLote.observacao} onChange={(e) => setLiberacaoLote((p) => ({ ...p, observacao: e.target.value }))} />
                {liberacaoLote.erro && <p className="error-text" style={{ margin: '0 0 6px' }}>{liberacaoLote.erro}</p>}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" className="btn-secondary" onClick={() => setLiberacaoLote(null)}>Cancelar</button>
                  <button type="button" className="btn-primary" onClick={confirmarLiberacaoLote}>Confirmar liberação</button>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: '1px dashed #cbd5e1' }}>
              <span className="compact" style={{ color: '#475569' }} title="Refaz o cálculo AMD de todos os CT-es das faturas selecionadas e atualiza valores e divergências da fatura.">
                Recálculo dos CT-es: {inteiro(selecaoValida.length)} selecionada(s)
              </span>
              <button type="button" className="btn-primary" style={{ background: '#0f766e', borderColor: '#0f766e' }} disabled={!selecaoValida.length || marcando || Boolean(recalculo)} onClick={recalcularSelecionadas}>
                {recalculo ? `Recalculando ${inteiro(recalculo.feitas + 1)}/${inteiro(recalculo.total)}...` : 'Recalcular CT-es selecionadas'}
              </button>
              {recalculo && <span className="compact" style={{ color: '#475569' }}>{recalculo.atual}{recalculo.fase ? ` — ${recalculo.fase}` : ''}</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: '1px dashed #cbd5e1' }}>
              <span className="compact" style={{ color: '#475569' }} title="Faturas que não serão pagas (ex.: vencidas sem tratativa). Saem da lista e dos totais e ficam no card 'Canceladas'.">
                Cancelamento: {inteiro(selecaoValida.length)} selecionada(s)
              </span>
              {verDuplicadas && <button type="button" className="btn-primary" style={{ background: '#b45309', borderColor: '#b45309' }} disabled={!selecaoValida.length || marcando} onClick={aplicarSubstituicao} title="As selecionadas são cópias de outra fatura (mesmo número, valor e emissão): viram 'Substituída' e a outra cópia fica valendo">{marcando ? 'Gravando...' : 'Marcar como substituídas'}</button>}
              {!verDuplicadas && (verCanceladas
                ? <button type="button" className="btn-primary" style={{ background: '#315ee7', borderColor: '#315ee7' }} disabled={!selecaoValida.length || marcando} onClick={() => aplicarCancelamento(false)} title="Volta as selecionadas ao status que tinham antes do cancelamento">{marcando ? 'Gravando...' : 'Reativar selecionadas'}</button>
                : <button type="button" className="btn-primary" style={{ background: '#64748b', borderColor: '#64748b' }} disabled={!selecaoValida.length || marcando} onClick={() => aplicarCancelamento(true)} title="Marca as selecionadas (não pagas) como canceladas: saem da lista e vão para o card 'Canceladas'">{marcando ? 'Gravando...' : 'Cancelar selecionadas'}</button>)}
            </div>
            {fazAntecipacao && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: '1px dashed #cbd5e1' }}>
                <span className="compact" style={{ color: '#475569' }} title="Controle do que você já enviou para antecipação. A fatura sai de 'Aptas', fica em 'Enviadas p/ antecipação' e vai para 'Já antecipadas' sozinha quando a Cessão chegar no SAP.">
                  Antecipação: {inteiro(selecaoValida.length)} selecionada(s)
                </span>
                <button type="button" className="btn-primary" style={{ background: '#0f766e', borderColor: '#0f766e' }} disabled={!selecaoValida.length || marcando} onClick={() => aplicarEnvioAntecipacao(true)}>{marcando ? 'Gravando...' : 'Enviar para antecipação'}</button>
                <button type="button" className="btn-secondary" disabled={!selecaoValida.length || marcando} onClick={() => aplicarEnvioAntecipacao(false)} title="Volta as selecionadas para 'Aptas à antecipação'">Desfazer envio</button>
              </div>
            )}
            {temAjusteFenix && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: '1px dashed #cbd5e1' }}>
                <span className="compact" style={{ color: '#475569' }} title="Controle do pedido de estorno da compensação Fênix ao financeiro. Quando o retorno chegar, marque para protocolo (agrupamento manual) e a fatura vai para 'Já no protocolo'.">
                  Ajuste Fênix no financeiro: {inteiro(selecaoValida.length)} selecionada(s)
                </span>
                <button type="button" className="btn-primary" style={{ background: '#b78700', borderColor: '#b78700' }} disabled={!selecaoValida.length || marcando} onClick={() => aplicarAjusteFenix('ENVIADO')} title="As selecionadas com CT-e na Fênix vão para 'Enviadas, aguardando retorno'">{marcando ? 'Gravando...' : 'Enviado para ajustar Fênix'}</button>
                <button type="button" className="btn-primary" style={{ background: '#315ee7', borderColor: '#315ee7' }} disabled={!selecaoValida.length || marcando} onClick={() => aplicarAjusteFenix('RETORNADO')} title="O financeiro devolveu: as selecionadas vão para 'Retorno recebido: mandar protocolo'. Com o relatório SAP reimportado sem a Fênix isso acontece sozinho.">Retorno recebido</button>
                <button type="button" className="btn-secondary" disabled={!selecaoValida.length || marcando} onClick={() => aplicarAjusteFenix('')}>Desfazer ajuste Fênix</button>
              </div>
            )}
            {ctesFenix.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10, padding: 10, borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca' }}>
                <span className="compact" style={{ color: '#991b1b', fontWeight: 700 }} title={`CT-es compensados pela partida Fênix (${PARTIDAS_FENIX.join(', ')}): a fatura não escritura até o financeiro estornar a compensação.`}>
                  Partida Fênix: {inteiro(ctesFenix.length)} CT-e(s) · {inteiro(partidasFenix.length)} partida(s) em {inteiro(faturasFenix)} fatura(s)
                </span>
                <label className="compact" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>Solicitante
                  <input value={solicitante} onChange={(e) => setSolicitante(e.target.value)} placeholder="Nome no termo" style={{ width: 200 }} />
                </label>
                <button type="button" className="btn-primary" style={{ background: '#b91c1c', borderColor: '#b91c1c' }} disabled={exportando || Boolean(progresso)} onClick={gerarTermoWord} title={progresso ? 'Aguarde a verificação dos CT-es no SAP terminar' : 'Termo de Correção de Lançamento (Word), um bloco por partida, no modelo enviado ao financeiro'}>Termo de correção (Word)</button>
                <button type="button" className="btn-secondary" disabled={exportando || Boolean(progresso)} onClick={exportarFenixExcel} title="Planilha com as mesmas informações do termo, um CT-e por linha (melhor quando são muitos casos)">Planilha Fênix (Excel)</button>
              </div>
            )}
          </div>

          <RankingTransportadoras
            itens={ranking}
            dimensao={dimensaoRanking}
            onDimensao={setDimensaoRanking}
            filtrosAtivos={{
              transp: { chave: filtros.grupoTransp, rotulo: rotuloTransp(filtros.grupoTransp) },
              auditor: { chave: filtros.grupoAuditor, rotulo: filtros.grupoAuditor === SEM_TRANSP ? 'Não localizadas' : filtros.grupoAuditor },
            }}
            aberto={rankingAberto}
            onAlternar={() => setRankingAberto((v) => !v)}
            criterio={criterioRanking}
            onCriterio={setCriterioRanking}
            onEscolher={(d, chave) => setFiltros((atual) => ({ ...atual, [campoGrupo[d]]: chave }))}
          />

          <div className="table-card">
            <div className="sim-analise-tabela-wrap">
              <table className="sim-analise-tabela">
                <thead><tr>
                  <th style={{ width: 28 }}><input type="checkbox" checked={todasSelecionadas} disabled={!idsRecorte.length} onChange={alternarTodas} title={`Selecionar as ${idsRecorte.length} faturas do recorte (todas as páginas)`} /></th>
                  {COLUNAS.map(cabecalhoCel)}
                </tr></thead>
                <tbody>
                  {visiveis.map((l) => {
                    const f = l.fatura;
                    const prazo = situacaoPrazo(l);
                    const situacao = situacaoCtes(l.ctes);
                    const corCtes = situacao === 'TODOS' ? '#14733b' : situacao === 'PARCIAL' ? '#c2410c' : situacao === 'NENHUM' ? '#9b1111' : '#64748b';
                    return (
                      <tr key={l.id} onClick={() => abrir(l)} style={{ cursor: f ? 'pointer' : 'default', ...(ultimaAberta === l.id ? { background: '#eaf1ff' } : {}) }} title={f ? 'Abrir a fatura' : undefined}>
                        <td onClick={(e) => e.stopPropagation()}>
                          {f && <input type="checkbox" checked={selecionadas.has(f.id)} onChange={() => alternarSelecao(f.id)} aria-label={`Selecionar fatura ${l.numero}`} />}
                        </td>
                        <td>
                          {f ? <button type="button" className="link-button" onClick={(e) => { e.stopPropagation(); abrir(l); }}>{l.numero}</button> : <strong>{l.numero}</strong>}
                          {l.repetida > 1 && <div style={{ fontSize: 11, color: '#b78700' }}>{l.repetida} faturas</div>}
                          {f && <EvidenciasFinanceiras fatura={f} />}
                          {faturaSemIdOms(f) && <div title="Fatura sem o Id do OMS: nao consegue ser enviada ao SAP. Use 'Importar so o Id do OMS' na lista de faturas." style={{ display: 'inline-block', marginTop: 2, padding: '1px 6px', borderRadius: 999, background: '#b91c1c', color: '#fff', fontSize: 11, fontWeight: 700 }}>SEM ID OMS</div>}
                          {agrupamentoManual(f) && (
                            <div
                              style={{ fontSize: 11, fontWeight: 700, color: faturaLancada(f) ? '#14733b' : '#9153F0', whiteSpace: 'nowrap' }}
                              title={`Marcada para agrupamento manual${f.agrupamento_manual_por ? ` por ${f.agrupamento_manual_por}` : ''}${f.agrupamento_manual_em ? ` em ${new Date(f.agrupamento_manual_em).toLocaleString('pt-BR')}` : ''}`}
                            >
                              {faturaLancada(f) ? 'Agrupada (manual)' : 'Agrup. manual'}
                            </div>
                          )}
                        </td>
                        <td>{f?.transportadora || (l.outrasTransportadoras?.length ? <span style={{ color: '#b45309' }}>Existe em: {l.outrasTransportadoras.join(', ')}</span> : <span style={{ color: '#9b1111' }}>Não localizada</span>)}</td>
                        <td>{dataBr(f?.data_emissao)}</td>
                        <td>{dataBr(f?.data_vencimento || l.vencimentoLista)}<div style={{ fontSize: 11, fontWeight: 700, color: prazo.cor }}>{prazo.texto}</div></td>
                        <td style={{ whiteSpace: 'nowrap', ...(situacaoPrevisao(f) === 'ATRASADA' ? { color: '#c2410c', fontWeight: 700 } : {}) }} title={previsaoPagamento(f) ? `Previsão gravada${f.previsao_pagamento_por ? ` por ${f.previsao_pagamento_por}` : ''}${f.previsao_pagamento_em ? ` em ${new Date(f.previsao_pagamento_em).toLocaleString('pt-BR')}` : ''}${situacaoPrevisao(f) === 'ATRASADA' ? ' · a data já passou e não foi paga' : ''}` : undefined}>{previsaoPagamento(f) ? dataBr(previsaoPagamento(f)) : '-'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {dinheiro(valorDaLinha(l))}
                          {l.diferencaLista != null && Math.abs(l.diferencaLista) > 0.05 && <div style={{ fontSize: 11, color: '#c2410c' }}>Lista: {dinheiro(l.valorLista)}</div>}
                        </td>
                        <td>{f ? nomeStatus(f.status) : '-'}</td>
                        <td>{f ? `${Number(f.ctes_auditados || 0)}/${Number(f.ctes_totais || 0)}` : '-'}</td>
                        <td>{(() => {
                          const r = resultadoAuditoria(f);
                          if (!r) return '-';
                          const cor = { SEM_DIVERGENCIA: '#14733b', COM_DIVERGENCIA: '#9b1111', DIVERGENCIA_EM_TRATATIVA: '#c2410c', DIVERGENCIA_TRATADA: '#0f766e' }[r.resultado] || '#475569';
                          return (
                            <span title={`Cobrado ${dinheiro(r.cobrado)} · apurado ${dinheiro(r.apurado)} · diferença ${dinheiro(r.diferenca)}${r.pendentes ? ` · ${r.pendentes} CT-e(s) pendente(s)` : ''}`}>
                              <span style={{ color: cor, fontWeight: 700 }}>{r.rotulo}</span>
                              {r.diferenca !== 0 && <div style={{ fontSize: 11, color: '#475569', whiteSpace: 'nowrap' }}>dif. {dinheiro(r.diferenca)}</div>}
                              {r.motivo && <div style={{ fontSize: 11, color: '#64748b' }}>{r.motivo}</div>}
                            </span>
                          );
                        })()}</td>
                        <td>{f ? (f.partida || f.lancamento_financeiro || (situacao === 'TODOS' ? <span style={{ color: '#b78700' }} title="Todos os CT-es têm partida no SAP, mas não há partida pelo número da fatura.">Nos CT-es</span> : '-')) : '-'}</td>
                        <td style={situacaoEnvioErp(l) === 'SEM_PARTIDA' ? { color: '#9b1111', fontWeight: 700 } : undefined}>{dataBr(f?.data_envio_erp)}</td>
                        <td style={{ color: corCtes, fontWeight: 700 }}>
                          {textoCtes(l)}
                          {temFenix(l) && <div style={{ fontSize: 11, color: '#b91c1c', whiteSpace: 'nowrap' }} title={`Partida(s) compensada(s) pela Fênix: ${l.ctes.fenix.map((c) => c.partida).join(', ')}`}>{l.ctes.fenix.length} na Fênix</div>}
                          {etapaFenix(l) && etapaFenix(l) !== 'A_ENVIAR' && (
                            <div style={{ fontSize: 11, color: COR_ETAPA_FENIX[etapaFenix(l)], whiteSpace: 'nowrap' }} title={[f.fenix_enviado_em && `Enviada ao financeiro em ${dataBr(f.fenix_enviado_em)}${f.fenix_enviado_por ? ` por ${f.fenix_enviado_por}` : ''}`, f.fenix_retorno_em && `Retorno em ${dataBr(f.fenix_retorno_em)}${f.fenix_retorno_por ? ` por ${f.fenix_retorno_por}` : ''}`].filter(Boolean).join(' · ')}>
                              Fênix: {{ AGUARDANDO: 'aguardando', RETORNO: 'retornou', PROTOCOLO: 'no protocolo' }[etapaFenix(l)]}
                            </div>
                          )}
                        </td>
                        <td>{(() => {
                          const so = situacaoOms(l);
                          if (!so) return '-';
                          const cor = { ENVIADA: '#14733b', FILA: '#0f766e', AGUARDANDO: '#b78700', APTA: '#315ee7', BLOQUEADA_PARTIDA: '#c2410c', ERRO: '#9b1111', SEM_ID: '#b91c1c' }[so] || '#64748b';
                          const dica = so === 'BLOQUEADA_PARTIDA' ? aptidaoEnvioSap(l.ctes).mensagem
                            : so === 'ERRO' ? [l.oms?.erro?.code, l.oms?.erro?.message, ...(l.oms?.blocking_checks || []).map((c) => c.code)].filter(Boolean).join(' · ')
                              : so === 'FILA' && l.oms?.queued_for_erp_at ? `Na fila desde ${dataBr(l.oms.queued_for_erp_at)}` : undefined;
                          return <span style={{ color: cor, fontWeight: 700, whiteSpace: 'nowrap' }} title={dica}>{ROTULO_OMS[so]}</span>;
                        })()}</td>
                        <td style={{ color: COR_PAGAMENTO[textoPagamentoLinha(l)], fontWeight: 600 }}>{textoPagamentoLinha(l)}</td>
                        <td title={f && f.auditor_nome && f.auditor_nome.trim() !== l.auditor ? `Gravado como: ${f.auditor_nome}` : undefined}>{f ? l.auditor : '-'}</td>
                        <td>{proximaAcao(l)}</td>
                      </tr>
                    );
                  })}
                  {!visiveis.length && <tr><td colSpan={COLUNAS.length + 1}>Nenhuma fatura neste filtro.</td></tr>}
                </tbody>
              </table>
            </div>
            {totalPaginas > 1 && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', padding: 10 }}>
                <button type="button" className="btn-secondary" disabled={paginaAtual <= 1} onClick={() => setPagina(paginaAtual - 1)}>Anterior</button>
                <span className="compact">Página {paginaAtual} de {totalPaginas}</span>
                <button type="button" className="btn-secondary" disabled={paginaAtual >= totalPaginas} onClick={() => setPagina(paginaAtual + 1)}>Próxima</button>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
