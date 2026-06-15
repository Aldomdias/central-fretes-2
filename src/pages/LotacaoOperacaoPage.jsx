import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  carregarFluxoCargasLotacao,
  carregarFluxoCargasLotacaoCompleto,
  buscarCargaPorDistOuCte,
  buscarViagensUnicasPorDistOuCte,
  buscarHistoricoLotacao,
  formatarDataCurta,
  formatarMoeda,
  carregarSolicitacoesPagamento,
  criarLancamentoAuditoria,
  criarCustoAdicionalLotacao,
  cteJaLancado,
  atualizarStatusSolicitacao,
  importarMultiplosFluxos,
  limparFluxoCargasLotacao,
  limparFluxoCargasLotacaoCompleto,
  mesclarFluxoCargas,
  rankingHistoricoPorTransportadora,
  resumirFluxoCargas,
  salvarFluxoCargasLotacaoCompleto,
  salvarLancamentosAuditoria,
  salvarSolicitacoesPagamento,
  textoSolicitacaoPagamento,
  carregarLancamentosAuditoria,
  totalLancadoCarga,
  totalAdicionalAutorizadoCarga,
  saldoDisponivelCarga,
  lancamentosDaCarga,
  solicitacoesDaCarga,
  normalizarTexto,
  paraNumero,
} from '../utils/lotacaoFluxoCargas';
import {
  carregarTabelasLotacao,
  pesquisarRotaLotacao,
} from '../utils/lotacaoTables';
import {
  salvarCargasLotacaoSupabase,
  carregarTabelasLotacaoSupabase,
  carregarCargasLotacaoSupabase,
  carregarPendenciasAuditoriaSupabase,
  carregarSolicitacoesSupabase,
  carregarLancamentosAuditoriaSupabase,
  carregarSolicitacoesInfoSupabase,
  registrarEventoHistoricoSupabase,
  atualizarPendenciaAuditoriaSupabase,
  salvarLancamentoAuditoriaSupabase,
  salvarSolicitacaoSupabase,
  atualizarSolicitacaoSupabase,
  atualizarSolicitacaoInfoSupabase,
} from '../services/lotacaoSupabaseService';
import {
  STATUS_AGUARDANDO_COMPLEMENTO_OPERACAO,
  isStatusAguardandoOperacao,
  isSolicitacaoExcecaoSemCte,
} from '../services/lotacaoPendenciaFlow';
import { carregarSessao } from '../utils/authLocal';

const ABAS_OPERACAO = [
  { id: 'visao', label: 'Visão geral' },
  { id: 'consulta', label: 'Viagens / Tabelas' },
  { id: 'aprovacoes', label: 'Aprovações' },
  { id: 'custos', label: 'Custos extras' },
  { id: 'importacao', label: 'Importação' },
];

const STATUS_PENDENTES = [
  'PENDENTE',
  'PENDENTE_OPERACAO',
  'EXCEDEU_AGUARDANDO_OPERACAO',
  'AGUARDANDO_OPERACAO',
  'AGUARDANDO_INFORMACAO',
  'AGUARDANDO_RESPOSTA',
  'AGUARDANDO_COMPLEMENTO_OPERACAO',
  'EM_ANALISE',
  'ABERTO',
];
const STATUS_APROVADOS = ['APROVADO', 'APROVADO_OPERACAO', 'LIBERADO', 'TRATADO', 'RESPONDIDO', 'RESPONDIDO_OPERACAO'];
const STATUS_RECUSADOS = ['RECUSADO', 'RECUSADO_OPERACAO', 'NEGADO', 'REJEITADO', 'DEVOLVIDO_AUDITORIA'];

function adicionarHorasIso(dataBase, horas) {
  const base = dataBase ? new Date(dataBase) : new Date();
  if (Number.isNaN(base.getTime())) return new Date().toISOString();
  return new Date(base.getTime() + (Number(horas || 0) * 3600000)).toISOString();
}

function chaveSolicitacaoLotacao(item = {}) {
  return [item.distKey || item.dist_key || item.dist, item.cte || '', item.fatura || ''].join('|').toUpperCase();
}

function escaparRegex(texto = '') {
  return String(texto || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extrairCampoDescricao(texto = '', nomes = []) {
  const origem = String(texto || '');
  for (const nome of nomes) {
    const regex = new RegExp(`^\\s*(?:[-–]\\s*)?${escaparRegex(nome)}\\s*:\\s*([^\\n\\r]+)`, 'im');
    const match = origem.match(regex);
    if (match?.[1]) return match[1].replace(/^[-–]\s*/, '').trim();
  }
  return '';
}

function extrairMoedaDescricao(texto = '', nomes = []) {
  const valor = extrairCampoDescricao(texto, nomes);
  if (!valor) return 0;
  const numero = paraNumero(valor);
  return numero === null ? 0 : numero;
}

function solicitacaoInfoParaOperacao(info = {}) {
  const descricao = info.descricao_problema || info.descricaoProblema || info.observacao || '';
  const chave = info.chave_informada || info.chaveInformada || extrairCampoDescricao(descricao, ['Chave CT-e', 'Chave CTe', 'Chave']);
  const numero = info.numero_informado || info.numeroInformado || extrairCampoDescricao(descricao, ['Número CT-e', 'Numero CT-e', 'Número CTe', 'Numero CTe']);
  const transportadora = info.transportadora || extrairCampoDescricao(descricao, ['Transportadora CT-e', 'Transportadora CTe', 'Transportadora']);
  const origem = extrairCampoDescricao(descricao, ['Origem']);
  const destino = extrairCampoDescricao(descricao, ['Destino']);
  const valorCte = extrairMoedaDescricao(descricao, ['Valor CT-e', 'Valor CTe', 'Valor estimado/informado', 'Valor']);
  const valorNf = extrairMoedaDescricao(descricao, ['Valor NF']);
  const dist = info.dist || extrairCampoDescricao(descricao, ['DIST/viagem', 'DIST', 'Viagem']) || '';

  return {
    id: info.id,
    fonteFluxo: 'AUDIT_INFO',
    tipo: 'QUESTIONAMENTO_OPERACAO',
    tipoOriginal: info.tipo || info.tipoOriginal || 'CTE',
    excecaoSemCte: isSolicitacaoExcecaoSemCte(info),
    origemSolicitacao: 'AUDITORIA',
    cargaId: info.carga_id || '',
    dist: dist || '-',
    distKey: dist ? normalizarDistKey(dist) : '',
    cte: chave || numero || '',
    fatura: info.fatura || extrairCampoDescricao(descricao, ['Fatura']) || '',
    transportadora,
    origem,
    destino,
    valorAutorizadoCarga: valorNf || 0,
    valorLancado: valorCte || 0,
    excedente: 0,
    valorAdicional: 0,
    status: info.status || 'AGUARDANDO_INFORMACAO',
    observacao: descricao,
    resposta: info.resposta_operacao || info.resposta || info.observacao_tratamento || '',
    justificativaOperacao: info.justificativa_operacao || '',
    complementoAuditoria: info.complemento_auditoria || (String(info.status || '').toUpperCase() === STATUS_AGUARDANDO_COMPLEMENTO_OPERACAO ? (info.observacao_tratamento || '') : ''),
    complementoSolicitadoEm: info.complemento_solicitado_em || info.updated_at || '',
    criadoEm: info.created_at || info.criadoEm || '',
    atualizadoEm: info.updated_at || info.atualizadoEm || '',
  };
}

function pendenciaParaSolicitacaoOperacao(pendencia = {}) {
  return {
    id: pendencia.id,
    fonteFluxo: 'AUDIT_PENDENCIA',
    tipo: 'EXCEDENTE_AUDITORIA',
    origemSolicitacao: 'AUDITORIA',
    cargaId: pendencia.carga_id || '',
    dist: pendencia.dist || '',
    distKey: pendencia.dist_key || '',
    cte: pendencia.cte || '',
    fatura: pendencia.fatura || '',
    transportadora: pendencia.transportadora || '',
    origem: pendencia.origem || '',
    destino: pendencia.destino || '',
    valorAutorizadoCarga: pendencia.valor_original ?? pendencia.valor_autorizado,
    valorLancado: pendencia.valor_lancado,
    excedente: pendencia.valor_excedente,
    valorAdicional: pendencia.valor_adicional_aprovado ?? pendencia.valor_excedente,
    status: pendencia.status || '',
    observacao: pendencia.observation || pendencia.observacao || '',
    resposta: pendencia.resposta_operacao || pendencia.motivo_recusa || '',
    justificativaOperacao: pendencia.justificativa_operacao || '',
    complementoAuditoria: pendencia.complemento_auditoria || (String(pendencia.status || '').toUpperCase() === STATUS_AGUARDANDO_COMPLEMENTO_OPERACAO ? (pendencia.resposta_auditoria || '') : ''),
    complementoSolicitadoEm: pendencia.complemento_solicitado_em || pendencia.updated_at || '',
    criadoEm: pendencia.created_at || '',
    atualizadoEm: pendencia.updated_at || '',
  };
}

function arquivosValidos(files = []) {
  return Array.from(files || []).filter((file) => /\.xls[xm]?$/i.test(file.name || ''));
}

function StatusMensagem({ mensagem }) {
  if (!mensagem) return null;
  return <div className={`hint-box compact ${mensagem.tipo === 'erro' ? 'error-text' : ''}`}>{mensagem.texto}</div>;
}

function statusKey(status = '') {
  return normalizarTexto(status || 'PENDENTE');
}

function isPendente(status) {
  return isStatusAguardandoOperacao(status) || STATUS_PENDENTES.includes(statusKey(status));
}

function isAprovado(status) {
  return STATUS_APROVADOS.includes(statusKey(status));
}

function isRecusado(status) {
  return STATUS_RECUSADOS.includes(statusKey(status));
}

function dataOrdenacaoItem(item = {}) {
  return new Date(item.atualizadoEm || item.atualizado_em || item.criadoEm || item.criado_em || item.created_at || 0).getTime() || 0;
}

function valorPrincipalSolicitacao(item = {}) {
  return Number(item.valorAdicional ?? item.valor_adicional ?? item.excedente ?? item.valor_excedente ?? item.valorLancado ?? item.valor_lancado ?? 0) || 0;
}

function valorOrcadoSolicitacao(item = {}) {
  const valor = Number(item.valorAutorizadoCarga ?? item.valor_autorizado_carga ?? item.valor_original ?? item.valor_autorizado ?? item.valorBase ?? item.valor_base ?? 0) || 0;
  return Number.isFinite(valor) ? valor : 0;
}

function valorSolicitadoSolicitacao(item = {}) {
  const valorLancado = Number(item.valorLancado ?? item.valor_lancado ?? 0) || 0;
  if (valorLancado > 0) return valorLancado;

  const valorOrcado = valorOrcadoSolicitacao(item);
  const valorSolicitado = Number(item.valorSolicitado ?? item.valor_solicitado ?? 0) || 0;
  if (valorSolicitado > 0) return valorSolicitado;

  return valorOrcado + valorPrincipalSolicitacao(item);
}

function valorDiferencaSolicitacao(item = {}) {
  const diferencaInformada = Number(item.excedente ?? item.valor_excedente ?? item.valorAdicional ?? item.valor_adicional ?? 0) || 0;
  if (diferencaInformada > 0) return diferencaInformada;
  return Math.max(0, valorSolicitadoSolicitacao(item) - valorOrcadoSolicitacao(item));
}

function dataCriacaoSolicitacao(item = {}) {
  return item.criadoEm || item.criado_em || item.created_at || item.dataSolicitacao || item.data_solicitacao || item.atualizadoEm || item.updated_at || '';
}

function tempoAguardandoMs(item = {}) {
  const data = new Date(dataCriacaoSolicitacao(item) || 0);
  const timestamp = data.getTime();
  if (!timestamp || Number.isNaN(timestamp)) return 0;
  return Math.max(0, Date.now() - timestamp);
}

function calcularTempoAguardando(item = {}) {
  const ms = tempoAguardandoMs(item);
  if (!ms) return { texto: '-', dataTexto: '', atrasado: false, dias: 0, horas: 0 };

  const dias = Math.floor(ms / 86400000);
  const horas = Math.floor(ms / 3600000);
  const data = new Date(dataCriacaoSolicitacao(item));
  const dataTexto = Number.isNaN(data.getTime()) ? '' : formatarDataCurta(data);

  return {
    texto: dias >= 1 ? `há ${dias} dia${dias > 1 ? 's' : ''}` : `há ${Math.max(1, horas)}h`,
    dataTexto,
    atrasado: ms > 86400000,
    dias,
    horas,
  };
}

function classificarStatus(status = '') {
  if (isAprovado(status)) return 'Aprovado/liberado';
  if (isRecusado(status)) return 'Recusado';
  if (isPendente(status)) return 'Pendente';
  return status || 'Pendente';
}

function normalizarDistKey(valor = '') {
  return normalizarTexto(valor || 'SEM_DIST');
}

function separarCtesTexto(valor = '') {
  return String(valor || '')
    .split(/[;,/|\s]+/)
    .map((cte) => cte.trim())
    .filter(Boolean);
}

function consolidarViagensLotacao(cargas = []) {
  const mapa = new Map();

  (cargas || []).forEach((carga) => {
    const distKey = carga.distKey || normalizarDistKey(carga.dist);
    if (!distKey) return;

    const atual = mapa.get(distKey) || {
      distKey,
      dist: carga.dist || '',
      registros: [],
      transportadoras: new Map(),
      origens: new Map(),
      destinos: new Map(),
      tipos: new Map(),
      ctes: new Map(),
      valores: [],
      dataReferencia: '',
      cargaPrincipal: null,
    };

    atual.registros.push(carga);
    if (carga.transportadora) atual.transportadoras.set(normalizarTexto(carga.transportadora), carga.transportadora);
    if (carga.origem) atual.origens.set(normalizarTexto(carga.origem), carga.origem);
    if (carga.destino) atual.destinos.set(normalizarTexto(carga.destino), carga.destino);
    if (carga.tipoVeiculo) atual.tipos.set(normalizarTexto(carga.tipoVeiculo), carga.tipoVeiculo);

    const ctes = Array.isArray(carga.ctes) && carga.ctes.length ? carga.ctes : separarCtesTexto(carga.cteRaw || carga.cte || '');
    ctes.forEach((cte) => atual.ctes.set(normalizarTexto(cte), cte));

    const valor = Number(carga.valorComparacao);
    if (Number.isFinite(valor) && valor > 0) atual.valores.push(valor);

    const dataAtual = new Date(atual.dataReferencia || 0).getTime() || 0;
    const dataCarga = new Date(carga.coletaRealizada || carga.coletaPlanejada || carga.liberado || carga.importadoEm || 0).getTime() || 0;
    if (!atual.cargaPrincipal || dataCarga >= dataAtual) {
      atual.cargaPrincipal = carga;
      atual.dataReferencia = carga.coletaRealizada || carga.coletaPlanejada || carga.liberado || carga.importadoEm || atual.dataReferencia;
    }

    mapa.set(distKey, atual);
  });

  return [...mapa.values()].map((item) => {
    const valoresUnicos = [...new Set(item.valores.map((valor) => Number(valor.toFixed(2))))].sort((a, b) => b - a);
    const valorBase = valoresUnicos.length ? valoresUnicos[0] : Number(item.cargaPrincipal?.valorComparacao || 0);
    const valorAlternativo = valoresUnicos.find((valor) => valor !== valorBase) || null;
    const cargaPrincipal = {
      ...(item.cargaPrincipal || {}),
      dist: item.dist || item.cargaPrincipal?.dist || '',
      distKey: item.distKey,
      valorComparacao: valorBase,
    };

    return {
      ...item,
      cargaPrincipal,
      valorBase,
      valorAlternativo,
      quantidadeRegistros: item.registros.length,
      transportadora: [...item.transportadoras.values()].join(' / ') || item.cargaPrincipal?.transportadora || '',
      origem: [...item.origens.values()].join(' / ') || item.cargaPrincipal?.origem || '',
      destino: [...item.destinos.values()].join(' / ') || item.cargaPrincipal?.destino || '',
      tipoVeiculo: [...item.tipos.values()].join(' / ') || item.cargaPrincipal?.tipoVeiculo || '',
      ctesLista: [...item.ctes.values()],
      temDivergenciaValores: valoresUnicos.length > 1,
      valoresUnicos,
    };
  }).sort((a, b) => {
    const dataA = new Date(a.dataReferencia || 0).getTime() || 0;
    const dataB = new Date(b.dataReferencia || 0).getTime() || 0;
    return dataB - dataA;
  });
}

function calcularIndicadoresAprovacoes(solicitacoes = []) {
  return (solicitacoes || []).reduce((acc, item) => {
    const valor = valorPrincipalSolicitacao(item);
    acc.total += 1;
    if (isPendente(item.status)) {
      acc.pendentes += 1;
      acc.valorPendente += valor;
    } else if (isAprovado(item.status)) {
      acc.aprovadas += 1;
      acc.valorAprovado += valor;
    } else if (isRecusado(item.status)) {
      acc.recusadas += 1;
    } else {
      acc.outros += 1;
    }
    if (item.tipo === 'CUSTO_ADICIONAL') acc.custosExtras += 1;
    return acc;
  }, { total: 0, pendentes: 0, aprovadas: 0, recusadas: 0, outros: 0, custosExtras: 0, valorPendente: 0, valorAprovado: 0 });
}

function resumoViagemOperacao(viagem, lancamentos = [], solicitacoes = []) {
  if (!viagem?.cargaPrincipal) {
    return { auditado: 0, adicional: 0, saldo: 0, lancamentos: [], solicitacoes: [] };
  }
  const carga = viagem.cargaPrincipal;
  const adicional = totalAdicionalAutorizadoCarga(solicitacoes, carga);
  const auditado = totalLancadoCarga(lancamentos, carga);
  const autorizado = (Number(viagem.valorBase) || Number(carga.valorComparacao) || 0) + adicional;
  return {
    auditado,
    adicional,
    autorizado,
    saldo: autorizado - auditado,
    lancamentos: lancamentosDaCarga(lancamentos, carga),
    solicitacoes: solicitacoesDaCarga(solicitacoes, carga),
  };
}

function AbasOperacao({ abaAtiva, onChange, pendencias = 0 }) {
  return (
    <div className="gap-row top-space-sm" style={{ flexWrap: 'wrap' }}>
      {ABAS_OPERACAO.map((aba) => (
        <button
          key={aba.id}
          type="button"
          className={abaAtiva === aba.id ? 'btn-primary' : 'btn-secondary'}
          onClick={() => onChange(aba.id)}
        >
          {aba.label}{aba.id === 'aprovacoes' && pendencias > 0 ? ` (${pendencias})` : ''}
        </button>
      ))}
    </div>
  );
}

export function ImportarFluxoCard({ onImportado, resumo }) {
  const [arquivos, setArquivos] = useState([]);
  const [aliquota, setAliquota] = useState(12);
  const [modo, setModo] = useState('atualizar');
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState(null);

  const importar = async () => {
    const lista = arquivosValidos(arquivos);
    if (!lista.length) {
      setMensagem({ tipo: 'erro', texto: 'Selecione ao menos um arquivo Excel do fluxo de carga.' });
      return;
    }

    setCarregando(true);
    setMensagem(null);
    try {
      const baseAtual = carregarFluxoCargasLotacao();
      const resultado = await importarMultiplosFluxos(lista, { aliquotaIcmsPadrao: aliquota });
      if (!resultado.resultados.length) {
        throw new Error(resultado.erros[0]?.erro || 'Nenhuma carga válida encontrada nos arquivos selecionados.');
      }
      const novaBase = mesclarFluxoCargas(baseAtual, resultado.resultados, { modo, aliquotaIcmsPadrao: aliquota });
      setMensagem({ tipo: 'ok', texto: 'Cargas lidas. Salvando histórico da operação...' });
      const salvamento = await salvarFluxoCargasLotacaoCompleto(novaBase);

      const todasCargas = resultado.resultados.flatMap((r) => r.cargas || []);
      const nomeArquivo = lista.map((f) => f.name).join(', ');
      try {
        await salvarCargasLotacaoSupabase(todasCargas, nomeArquivo);
      } catch (erroSupabase) {
        console.warn('[Lotação] Erro Supabase:', erroSupabase.message, erroSupabase);
      }

      onImportado(novaBase);
      setArquivos([]);
      const total = resultado.resultados.reduce((acc, item) => acc + (item.cargas?.length || 0), 0);
      const erroTexto = resultado.erros.length ? ` ${resultado.erros.length} arquivo(s) tiveram erro.` : '';
      const armazenamentoTexto = salvamento.armazenamento === 'indexedDB'
        ? ' Base grande salva no armazenamento local ampliado do navegador.'
        : '';
      setMensagem({ tipo: 'ok', texto: `${total} carga(s) importada(s) e salva(s).${erroTexto}${armazenamentoTexto}` });
    } catch (error) {
      setMensagem({ tipo: 'erro', texto: error.message || String(error) });
    } finally {
      setCarregando(false);
    }
  };

  const limpar = async () => {
    if (!window.confirm('Deseja limpar todo o histórico local de cargas de lotação?')) return;
    setCarregando(true);
    try {
      await limparFluxoCargasLotacaoCompleto();
      onImportado(carregarFluxoCargasLotacao());
      setMensagem({ tipo: 'ok', texto: 'Histórico local de cargas apagado.' });
    } catch (error) {
      limparFluxoCargasLotacao();
      onImportado(carregarFluxoCargasLotacao());
      setMensagem({ tipo: 'erro', texto: error.message || String(error) });
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="panel-card lotacao-fluxo-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Atualizar histórico de cargas</div>
          <p>Suba o fluxo de carga da Lotação para alimentar a consulta do realizado e apoiar a Auditoria Lotação.</p>
        </div>
        <span className="status-pill dark">{resumo.totalCargas} cargas</span>
      </div>

      <div className="form-grid three">
        <label className="field">
          Arquivo(s) Excel
          <input type="file" accept=".xlsx,.xls,.xlsm" multiple onChange={(event) => setArquivos(Array.from(event.target.files || []))} />
        </label>
        <label className="field">
          Pasta de arquivos
          <input type="file" accept=".xlsx,.xls,.xlsm" multiple webkitdirectory="true" directory="true" onChange={(event) => setArquivos(Array.from(event.target.files || []))} />
        </label>
        <label className="field">
          ICMS padrão para V = W
          <input type="number" min="0" max="30" step="0.01" value={aliquota} onChange={(event) => setAliquota(event.target.value)} />
        </label>
      </div>

      <div className="form-grid three">
        <label className="field">
          Modo da carga
          <select value={modo} onChange={(event) => setModo(event.target.value)}>
            <option value="atualizar">Atualizar histórico mantendo cargas antigas</option>
            <option value="substituir">Substituir histórico local por esta carga</option>
          </select>
        </label>
        <div className="hint-box compact full-span">
          Regra do valor comparável: quando V e W são diferentes, usa o menor valor sem ICMS informado. Quando V = W, remove o ICMS padrão acima. Pedágio fica separado e não entra no valor comparável.
        </div>
      </div>

      {arquivos.length > 0 && (
        <div className="hint-box compact">
          {arquivosValidos(arquivos).length} arquivo(s) Excel selecionado(s). Arquivos de outros formatos serão ignorados.
        </div>
      )}

      <div className="actions-right gap-row">
        <button type="button" className="btn-secondary" disabled={carregando || resumo.totalCargas === 0} onClick={limpar}>Limpar histórico</button>
        <button type="button" className="btn-primary" disabled={carregando || !arquivosValidos(arquivos).length} onClick={importar}>{carregando ? 'Importando...' : 'Importar fluxo'}</button>
      </div>

      <StatusMensagem mensagem={mensagem} />
    </div>
  );
}

function KpisFluxo({ resumo, indicadores, lancamentos }) {
  return (
    <div className="summary-strip lotacao-summary-mini">
      <div className="summary-card">
        <span>Cargas no realizado</span>
        <strong>{resumo.totalCargas}</strong>
        <small>{resumo.rotas} rotas únicas</small>
      </div>
      <div className="summary-card">
        <span>Aprovações pendentes</span>
        <strong>{indicadores.pendentes}</strong>
        <small>{formatarMoeda(indicadores.valorPendente)} aguardando</small>
      </div>
      <div className="summary-card">
        <span>Custos aprovados</span>
        <strong>{formatarMoeda(indicadores.valorAprovado)}</strong>
        <small>{indicadores.aprovadas} aprovação(ões)</small>
      </div>
      <div className="summary-card">
        <span>CT-es auditados</span>
        <strong>{lancamentos.length}</strong>
        <small>vindos da Auditoria Lotação</small>
      </div>
    </div>
  );
}

function ResultadoTabelas({ resultados }) {
  if (!resultados.length) {
    return <div className="hint-box compact">Nenhuma tabela cadastrada encontrada para os filtros informados.</div>;
  }

  return (
    <div className="sim-analise-tabela-wrap">
      <table className="sim-analise-tabela">
        <thead>
          <tr>
            <th>Posição</th>
            <th>Transportadora</th>
            <th>Origem</th>
            <th>Destino</th>
            <th>Tipo</th>
            <th>KM</th>
            <th>Valor tabela</th>
          </tr>
        </thead>
        <tbody>
          {resultados.slice(0, 120).map((item, index) => (
            <tr key={`${item.tabelaId}-${item.id}-${index}`}>
              <td>{index + 1}</td>
              <td><strong>{item.tabelaNome}</strong></td>
              <td>{item.origem}/{item.ufOrigem}</td>
              <td>{item.destino}/{item.ufDestino}</td>
              <td>{item.tipo}</td>
              <td>{item.km || '-'}</td>
              <td><strong>{formatarMoeda(item.valor)}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultadoViagensConsolidadas({ viagens, selecionadaKey, onSelecionar, lancamentos, solicitacoes }) {
  if (!viagens.length) {
    return <div className="hint-box compact">Nenhuma viagem/DIST encontrada para os filtros informados.</div>;
  }

  return (
    <div className="sim-analise-tabela-wrap">
      <table className="sim-analise-tabela">
        <thead>
          <tr>
            <th>DIST</th>
            <th>Data</th>
            <th>Transportadora</th>
            <th>Rota</th>
            <th>Tipo</th>
            <th>Valor autorizado</th>
            <th>Auditado</th>
            <th>Saldo</th>
            <th>CT-es</th>
            <th>Ação</th>
          </tr>
        </thead>
        <tbody>
          {viagens.slice(0, 160).map((viagem) => {
            const resumo = resumoViagemOperacao(viagem, lancamentos, solicitacoes);
            return (
              <tr key={viagem.distKey} className={selecionadaKey === viagem.distKey ? 'selected-row' : ''}>
                <td>
                  <strong>{viagem.dist}</strong>
                  {viagem.quantidadeRegistros > 1 && <div className="muted small">{viagem.quantidadeRegistros} registros consolidados</div>}
                </td>
                <td>{formatarDataCurta(viagem.dataReferencia)}</td>
                <td>{viagem.transportadora}</td>
                <td>{viagem.origem} x {viagem.destino}</td>
                <td>{viagem.tipoVeiculo || '-'}</td>
                <td>
                  <strong>{formatarMoeda(resumo.autorizado)}</strong>
                  <div className="muted small">
                    Base {formatarMoeda(viagem.valorBase)}
                    {resumo.adicional > 0 ? ` + ${formatarMoeda(resumo.adicional)}` : ''}
                  </div>
                </td>
                <td>{formatarMoeda(resumo.auditado)}</td>
                <td className={resumo.saldo < 0 ? 'negativo' : ''}><strong>{formatarMoeda(resumo.saldo)}</strong></td>
                <td>{viagem.ctesLista.length || '-'}</td>
                <td><button type="button" className="btn-secondary" onClick={() => onSelecionar(viagem.distKey)}>Ver</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RankingHistorico({ ranking }) {
  if (!ranking.length) return null;
  return (
    <div className="table-card lotacao-table-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Quem mais carregou no histórico filtrado</div>
          <p className="compact">Resumo da operação com base nos carregamentos importados.</p>
        </div>
      </div>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>Transportadora</th>
              <th>Cargas</th>
              <th>Média</th>
              <th>Menor</th>
              <th>Maior</th>
              <th>Última carga</th>
            </tr>
          </thead>
          <tbody>
            {ranking.slice(0, 20).map((item) => (
              <tr key={item.nome}>
                <td><strong>{item.nome}</strong></td>
                <td>{item.cargas}</td>
                <td>{formatarMoeda(item.media)}</td>
                <td>{formatarMoeda(item.menor)}</td>
                <td>{formatarMoeda(item.maior)}</td>
                <td>{item.ultimo?.dist || '-'} · {formatarDataCurta(item.ultimo?.coletaRealizada || item.ultimo?.coletaPlanejada)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DetalheViagemOperacao({ viagem, tabelas, lancamentos, solicitacoes, onAbrirCustos, onAbrirAprovacoes }) {
  const resumo = useMemo(() => resumoViagemOperacao(viagem, lancamentos, solicitacoes), [viagem, lancamentos, solicitacoes]);
  const resultadosTabela = useMemo(() => {
    if (!viagem) return [];
    return pesquisarRotaLotacao(tabelas, {
      origem: viagem.origem?.split(' / ')[0] || '',
      destino: viagem.destino?.split(' / ')[0] || '',
      tipo: viagem.tipoVeiculo?.split(' / ')[0] || '',
      transportadora: viagem.transportadora?.split(' / ')[0] || '',
    });
  }, [tabelas, viagem]);

  if (!viagem) {
    return <div className="hint-box compact">Nenhuma DIST selecionada. Pesquise ou clique em Ver em uma viagem para abrir saldo, CT-es, tabela e aprovações relacionadas.</div>;
  }

  return (
    <div className="panel-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">DIST consolidada: {viagem.dist}</div>
          <p className="compact">{viagem.transportadora} · {viagem.origem} x {viagem.destino}</p>
        </div>
        <div className="gap-row">
          <button type="button" className="btn-secondary" onClick={onAbrirCustos}>Incluir custo</button>
          <button type="button" className="btn-secondary" onClick={onAbrirAprovacoes}>Ver aprovações</button>
        </div>
      </div>

      <div className="summary-strip lotacao-summary-mini">
        <div className="summary-card">
          <span>Valor autorizado</span>
          <strong>{formatarMoeda(resumo.autorizado)}</strong>
          <small>Base {formatarMoeda(viagem.valorBase)} + adicionais {formatarMoeda(resumo.adicional)}</small>
        </div>
        <div className="summary-card">
          <span>Já auditado</span>
          <strong>{formatarMoeda(resumo.auditado)}</strong>
          <small>{resumo.lancamentos.length} lançamento(s)</small>
        </div>
        <div className="summary-card">
          <span>Adicional aprovado</span>
          <strong>{formatarMoeda(resumo.adicional)}</strong>
          <small>entra no saldo autorizado</small>
        </div>
        <div className="summary-card">
          <span>Saldo pendente</span>
          <strong>{formatarMoeda(resumo.saldo)}</strong>
          <small>base + adicionais - auditado</small>
        </div>
      </div>

      {viagem.temDivergenciaValores && (
        <div className="hint-box compact">
          Esta DIST possui mais de um valor no realizado. A tela mostra o maior como base principal e mantém os demais como referência alternativa: {viagem.valoresUnicos.map(formatarMoeda).join(' / ')}.
        </div>
      )}

      <div className="form-grid three top-space-sm">
        <div className="hint-box compact">
          <strong>CT-es no realizado</strong><br />
          {viagem.ctesLista.length ? viagem.ctesLista.slice(0, 12).join(', ') : 'Nenhum CT-e informado no fluxo.'}
          {viagem.ctesLista.length > 12 ? ` +${viagem.ctesLista.length - 12}` : ''}
        </div>
        <div className="hint-box compact">
          <strong>Tabela de lotação</strong><br />
          {resultadosTabela.length ? `${resultadosTabela.length} rota(s) encontrada(s). Menor valor ${formatarMoeda(resultadosTabela[0]?.valor)}.` : 'Sem tabela encontrada para a rota/transportadora selecionada.'}
        </div>
        <div className="hint-box compact">
          <strong>Aprovações da DIST</strong><br />
          {resumo.solicitacoes.length ? `${resumo.solicitacoes.length} registro(s), ${resumo.solicitacoes.filter((item) => isPendente(item.status)).length} pendente(s).` : 'Nenhuma aprovação vinculada.'}
        </div>
      </div>

      {!!resultadosTabela.length && (
        <div className="top-space-sm">
          <ResultadoTabelas resultados={resultadosTabela.slice(0, 6)} />
        </div>
      )}
    </div>
  );
}

function FiltrosConsulta({ fonte, setFonte, filtros, atualizarFiltro, limpar, totalViagens = 0, totalTabelas = 0 }) {
  return (
    <div className="panel-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Pesquisar lotação</div>
          <p>Use origem, destino, tipo de veículo e transportadora para pesquisar realizado, tabela ou ambos.</p>
          <p className="compact muted">Resultado atual: {totalViagens} viagem(ns) / DIST(s) e {totalTabelas} rota(s) de tabela.</p>
        </div>
      </div>

      <div className="form-grid three">
        <label className="field">
          Fonte da consulta
          <select value={fonte} onChange={(event) => setFonte(event.target.value)}>
            <option value="historico">Histórico de carregamentos</option>
            <option value="tabela">Tabelas cadastradas</option>
            <option value="ambos">Tabela + histórico</option>
          </select>
        </label>
        <label className="field">
          Origem
          <input value={filtros.origem} onChange={(event) => atualizarFiltro('origem', event.target.value)} placeholder="Ex.: Itajaí" />
        </label>
        <label className="field">
          Destino
          <input value={filtros.destino} onChange={(event) => atualizarFiltro('destino', event.target.value)} placeholder="Ex.: Maceió" />
        </label>
      </div>

      <div className="form-grid three">
        <label className="field">
          Tipo de veículo
          <input value={filtros.tipo} onChange={(event) => atualizarFiltro('tipo', event.target.value)} placeholder="Ex.: Carreta baú" />
        </label>
        <label className="field">
          Transportadora
          <input value={filtros.transportadora} onChange={(event) => atualizarFiltro('transportadora', event.target.value)} placeholder="Opcional" />
        </label>
        <div className="actions-right lotacao-fluxo-search-actions">
          <button type="button" className="btn-secondary" onClick={limpar}>Limpar filtros</button>
        </div>
      </div>
    </div>
  );
}

function VisaoGeralOperacao({ viagemSelecionada, tabelas, lancamentos, solicitacoes, onAbrirCustos, onAbrirAprovacoes, indicadores }) {
  const pendentes = [...(solicitacoes || [])]
    .filter((item) => isPendente(item.status))
    .sort((a, b) => tempoAguardandoMs(b) - tempoAguardandoMs(a))
    .slice(0, 12);
  return (
    <>
      <div className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Central operacional da Lotação</div>
            <p>
              Controle em uma tela: realizado, tabela, saldo auditado, custos extras e aprovações pendentes da operação.
            </p>
          </div>
          <span className="status-pill dark">4.34C</span>
        </div>
        <div className="form-grid three">
          <div className="hint-box compact"><strong>Fluxo recomendado</strong><br />Pesquisar a DIST, comparar tabela/realizado, revisar saldo e aprovar ou incluir custo quando necessário.</div>
          <div className="hint-box compact"><strong>Dependência com Auditoria</strong><br />Os CT-es auditados reduzem o saldo da DIST e aparecem no detalhe da viagem.</div>
          <div className="hint-box compact"><strong>Aprovações</strong><br />{indicadores.pendentes} pendente(s), {indicadores.aprovadas} aprovada(s) e {indicadores.recusadas} recusada(s).</div>
        </div>
      </div>

      <DetalheViagemOperacao
        viagem={viagemSelecionada}
        tabelas={tabelas}
        lancamentos={lancamentos}
        solicitacoes={solicitacoes}
        onAbrirCustos={onAbrirCustos}
        onAbrirAprovacoes={onAbrirAprovacoes}
      />

      <div className="table-card lotacao-table-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Casos aguardando aprovação</div>
            <p className="compact">Mais antigos primeiro. Acima de 1 dia fica em vermelho para priorizar cobrança/tratativa.</p>
          </div>
          <span className="status-pill dark">{pendentes.length} exibida(s)</span>
        </div>
        {!pendentes.length ? (
          <div className="hint-box compact">Nenhuma aprovação pendente no momento.</div>
        ) : (
          <div className="sim-analise-tabela-wrap">
            <table className="sim-analise-tabela">
              <thead>
                <tr><th>Status</th><th>Aguardando</th><th>Tipo</th><th>DIST</th><th>Transportadora</th><th>Valor orçado</th><th>Valor solicitado</th><th>Diferença</th></tr>
              </thead>
              <tbody>
                {pendentes.map((item) => {
                  const tempo = calcularTempoAguardando(item);
                  const diferenca = valorDiferencaSolicitacao(item);
                  return (
                    <tr key={item.id}>
                      <td><span className={`status-pill ${tempo.atrasado ? 'error' : ''}`}>{item.status}</span></td>
                      <td className={tempo.atrasado ? 'negativo' : ''}>
                        <strong>{tempo.texto}</strong>
                        {tempo.dataTexto && <div className="muted small">desde {tempo.dataTexto}</div>}
                      </td>
                      <td>{item.tipo === 'CUSTO_ADICIONAL' ? item.tipoCusto || 'Custo extra' : item.tipo === 'QUESTIONAMENTO_OPERACAO' ? 'Questionamento operação' : 'Excedente auditoria'}</td>
                      <td><strong>{item.dist}</strong></td>
                      <td>{item.transportadora}</td>
                      <td>{formatarMoeda(valorOrcadoSolicitacao(item))}</td>
                      <td><strong>{formatarMoeda(valorSolicitadoSolicitacao(item))}</strong></td>
                      <td className={diferenca > 0 ? 'negativo' : ''}><strong>{formatarMoeda(diferenca)}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}


function rotuloTipoSolicitacao(item = {}) {
  if (item.tipo === 'CUSTO_ADICIONAL') return item.tipoCusto || 'Custo adicional';
  if (isSolicitacaoExcecaoSemCte(item)) return 'Exceção sem CT-e/CTU';
  if (item.tipo === 'QUESTIONAMENTO_OPERACAO') return 'Questionamento operação';
  return 'Excedente auditoria';
}

function isQuestionamentoAuditoria(item = {}) {
  return item?.fonteFluxo === 'AUDIT_INFO'
    || item?.tipo === 'QUESTIONAMENTO_OPERACAO'
    || item?.categoria === 'QUESTIONAMENTO_OPERACAO'
    || item?.origemSolicitacao === 'AUDITORIA_LOTACAO';
}

function statusAprovarSolicitacao(item = {}) {
  if (isQuestionamentoAuditoria(item)) return 'RESPONDIDO_OPERACAO';
  if (item.fonteFluxo === 'AUDIT_PENDENCIA') return 'APROVADO_OPERACAO';
  return 'APROVADO';
}

function statusRecusarSolicitacao(item = {}) {
  if (isQuestionamentoAuditoria(item)) return 'DEVOLVIDO_AUDITORIA';
  if (item.fonteFluxo === 'AUDIT_PENDENCIA') return 'RECUSADO_OPERACAO';
  return 'RECUSADO';
}

function statusExigeVinculoDistOperacao(item = {}, status = '') {
  return isQuestionamentoAuditoria(item)
    && statusKey(status) === 'RESPONDIDO_OPERACAO';
}

function isQuestionamentoExcecaoSemCte(item = {}) {
  return isQuestionamentoAuditoria(item) && isSolicitacaoExcecaoSemCte(item);
}

function resumoSolicitacaoCurto(item = {}) {
  const texto = String(item.observacao || item.resposta || '').replace(/\s+/g, ' ').trim();
  if (!texto) return 'Sem descrição detalhada.';
  return texto.length > 95 ? `${texto.slice(0, 95)}...` : texto;
}

function localidadeCompativelOperacao(alvo = '', candidato = '') {
  const normalizarLocalidade = (valor) => normalizarTexto(valor || '')
    .replace(/\s*\/\s*[A-Z]{2}$/, '')
    .replace(/\s+-\s+[A-Z]{2}$/, '')
    .trim();
  const a = normalizarLocalidade(alvo);
  const b = normalizarLocalidade(candidato);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function sugestoesDistOperacao(cargas = [], item = {}, busca = '') {
  const termo = String(busca || '').trim();
  if (termo && termo !== '-') return buscarViagensUnicasPorDistOuCte(cargas, termo);

  const transportadora = normalizarTexto(item.transportadora || '');
  const valorCte = Number(item.valorLancado) || 0;
  return (cargas || [])
    .map((carga) => {
      const transportadoraCarga = normalizarTexto(carga.transportadora || '');
      const transportadoraOk = Boolean(
        transportadora
        && transportadoraCarga
        && (transportadora === transportadoraCarga
          || transportadora.includes(transportadoraCarga)
          || transportadoraCarga.includes(transportadora))
      );
      const origemOk = localidadeCompativelOperacao(item.origem, carga.origem);
      const destinoOk = localidadeCompativelOperacao(item.destino, carga.destino);
      if (!transportadoraOk || !origemOk || !destinoOk) return null;

      const valorDist = Number(carga.valorComparacao) || 0;
      const diferencaValor = valorCte > 0 && valorDist > 0 ? Math.abs(valorDist - valorCte) : Number.MAX_SAFE_INTEGER;
      const contemCte = normalizarTexto(carga.cteRaw || '').includes(normalizarTexto(item.cte || ''));
      return {
        carga,
        score: 100 + (contemCte ? 50 : 0) - Math.min(diferencaValor, 999999) / 1000,
        diferencaValor,
        motivos: [
          'mesma transportadora',
          'mesma origem',
          'mesmo destino',
          ...(contemCte ? ['CT-e encontrado na viagem'] : []),
        ],
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .filter((resultado, index, lista) => (
      lista.findIndex((outro) => normalizarDistKey(outro.carga.dist) === normalizarDistKey(resultado.carga.dist)) === index
    ))
    .map((resultado) => ({ ...resultado.carga, sugestaoOperacao: resultado }))
    .slice(0, 8);
}

function compararQuestionamentoComViagem(item = {}, viagem = null, lancamentos = [], solicitacoes = []) {
  const valorCte = Number(item.valorLancado) || 0;
  const saldoDist = viagem ? Math.max(0, saldoDisponivelCarga(lancamentos, solicitacoes, viagem)) : 0;
  const aumentoNecessario = viagem && valorCte > 0
    ? Number(Math.max(0, valorCte - saldoDist).toFixed(2))
    : 0;
  return {
    valorCte,
    saldoDist,
    aumentoNecessario,
    cabeNoSaldo: Boolean(viagem && valorCte > 0 && aumentoNecessario <= 0.01),
  };
}

function SolicitacaoDetalhesModal({
  item,
  tratamento,
  cargas,
  lancamentos,
  solicitacoes,
  onFechar,
  onTratamento,
  onResponder,
  onCopiar,
  emailHref,
}) {
  const isQuestionamento = isQuestionamentoAuditoria(item);
  const excecaoSemCte = isQuestionamentoExcecaoSemCte(item);
  const resultadosDist = useMemo(() => {
    if (!isQuestionamento) return [];
    return sugestoesDistOperacao(cargas || [], item || {}, tratamento?.buscaDist);
  }, [cargas, isQuestionamento, item, tratamento?.buscaDist]);

  if (!item) return null;

  const tempo = calcularTempoAguardando(item);
  const pendente = isPendente(item.status);
  const diferenca = valorDiferencaSolicitacao(item);
  const rota = [item.origem, item.destino].filter(Boolean).join(' x ') || '-';
  const tituloAcao = isQuestionamento ? 'Responder questionamento' : 'Tratar aprovação';
  const statusResposta = statusAprovarSolicitacao(item);
  const viagemSelecionada = (cargas || []).find((carga) => String(carga.id) === String(tratamento?.cargaId));
  const comparacao = compararQuestionamentoComViagem(item, viagemSelecionada, lancamentos, solicitacoes);
  const podeConcluirQuestionamento = !isQuestionamento || (
    Boolean(viagemSelecionada?.dist)
    && Boolean(String(tratamento?.justificativa || '').trim())
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="lotacao-modal-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(2, 18, 54, 0.48)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 18,
      }}
    >
      <div
        className="lotacao-modal-card"
        style={{
          width: 'min(1120px, 96vw)',
          maxHeight: '92vh',
          overflow: 'auto',
          background: '#fff',
          borderRadius: 18,
          boxShadow: '0 20px 70px rgba(2, 18, 54, 0.25)',
          border: '1px solid #d8e1f0',
          padding: 18,
        }}
      >
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Detalhes da pendência</div>
            <p className="compact">{tituloAcao} com visão completa, sem poluir a listagem principal.</p>
          </div>
          <button type="button" className="btn-secondary" onClick={onFechar}>Fechar</button>
        </div>

        <div className="form-grid four top-space-sm">
          <div className="summary-card">
            <span>Status</span>
            <strong>{classificarStatus(item.status)}</strong>
            <small>{item.status || '-'}</small>
          </div>
          <div className="summary-card">
            <span>Aguardando</span>
            <strong className={tempo.atrasado ? 'negativo' : ''}>{tempo.texto}</strong>
            <small>{tempo.dataTexto ? `desde ${tempo.dataTexto}` : '-'}</small>
          </div>
          <div className="summary-card">
            <span>Valor solicitado</span>
            <strong>{formatarMoeda(valorSolicitadoSolicitacao(item))}</strong>
            <small>{excecaoSemCte ? 'referência manual' : 'valor do CT-e/custo'}</small>
          </div>
          <div className="summary-card">
            <span>Diferença</span>
            <strong className={diferenca > 0 ? 'negativo' : ''}>{formatarMoeda(diferenca)}</strong>
            <small>solicitado x orçado</small>
          </div>
        </div>

        <div className="form-grid three top-space-sm">
          <div className="hint-box compact"><strong>Tipo</strong><br />{rotuloTipoSolicitacao(item)}</div>
          <div className="hint-box compact"><strong>DIST/viagem</strong><br />{item.dist || '-'}</div>
          <div className="hint-box compact">
            <strong>{excecaoSemCte ? 'Referência / Fatura' : 'CT-e / Fatura'}</strong><br />
            {item.cte || (excecaoSemCte ? 'Sem chave CT-e/CTU' : '-')}
            {item.fatura ? <><br /><span className="muted">Fatura: {item.fatura}</span></> : null}
          </div>
          <div className="hint-box compact"><strong>Transportadora</strong><br />{item.transportadora || '-'}</div>
          <div className="hint-box compact"><strong>Rota</strong><br />{rota}</div>
          <div className="hint-box compact"><strong>Valor orçado</strong><br />{formatarMoeda(valorOrcadoSolicitacao(item))}</div>
        </div>

        <div className="panel-card top-space-sm" style={{ padding: 14 }}>
          <div className="panel-title">Motivo / descrição enviada</div>
          <div
            className="hint-box compact top-space-sm"
            style={{
              whiteSpace: 'pre-wrap',
              lineHeight: 1.45,
              maxHeight: 260,
              overflow: 'auto',
            }}
          >
            {item.observacao || '-'}
          </div>
        </div>

        {item.complementoAuditoria && (
          <div className="panel-card top-space-sm" style={{ padding: 14, borderColor: '#fdba74', background: '#fff7ed' }}>
            <div className="panel-title">Complemento solicitado pela Auditoria</div>
            <div className="hint-box compact top-space-sm" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>
              {item.complementoAuditoria}
            </div>
            <div className="muted small top-space-sm">
              Solicitado em {formatarDataCurta(item.complementoSolicitadoEm)}
            </div>
            {(item.resposta || item.justificativaOperacao) && (
              <div className="hint-box compact top-space-sm" style={{ whiteSpace: 'pre-wrap' }}>
                <strong>Resposta anterior preservada</strong><br />
                {item.resposta || '-'}
                {item.justificativaOperacao ? <><br /><br /><strong>Justificativa anterior</strong><br />{item.justificativaOperacao}</> : null}
              </div>
            )}
          </div>
        )}

        {isQuestionamento && pendente && (
          <div className="panel-card top-space-sm" style={{ padding: 14 }}>
            <div className="panel-title">DIST/viagem correta <span className="error-text">*</span></div>
            <div className="hint-box compact top-space-sm">
              {excecaoSemCte
                ? 'Esta exceção não possui chave para busca automática. Selecione manualmente uma DIST/viagem existente antes de responder.'
                : 'A resposta só poderá ser concluída depois que uma viagem existente for selecionada. Todo custo operacional deve permanecer dentro de uma DIST.'}
            </div>
            <label className="field top-space-sm">
              Buscar na lista de DIST/viagens
              <input
                value={tratamento?.buscaDist || ''}
                onChange={(event) => onTratamento(item.id, 'buscaDist', event.target.value)}
                placeholder="Digite a DIST, HUB ou CT-e para localizar a viagem existente"
              />
            </label>
            <label className="field top-space-sm">
              Vincular resposta a
              <select
                value={tratamento?.cargaId || ''}
                onChange={(event) => onTratamento(item.id, 'cargaId', event.target.value)}
              >
                <option value="">Selecione uma DIST/viagem existente</option>
                {resultadosDist.map((carga) => (
                  <option key={carga.id} value={carga.id}>
                    {carga.dist} · {carga.transportadora || '-'} · {carga.origem || '-'} x {carga.destino || '-'} · {formatarMoeda(carga.valorComparacao)}
                  </option>
                ))}
              </select>
            </label>
            <div className="muted small top-space-sm">
              {excecaoSemCte
                ? `${resultadosDist.length} sugestão(ões). Use a busca se a rota manual não localizar a DIST correta.`
                : `${resultadosDist.length} sugestão(ões) com a mesma transportadora, origem e destino. O valor mais próximo do CT-e aparece primeiro.`}
            </div>
            {viagemSelecionada && (
              <>
                <div className="hint-box compact top-space-sm">
                  <strong>DIST vinculada:</strong> {viagemSelecionada.dist}<br />
                  <span className="muted">
                    Carga: {viagemSelecionada.id} · {viagemSelecionada.transportadora || '-'} ·
                    {' '}{viagemSelecionada.origem || '-'} x {viagemSelecionada.destino || '-'}
                  </span>
                </div>
                {excecaoSemCte ? (
                  <div className="hint-box compact top-space-sm">
                    Ao responder, a Operação validará a exceção e vinculará este pedido à DIST selecionada, sem lançamento automático de CT-e.
                  </div>
                ) : (
                  <div className="summary-strip lotacao-summary-mini top-space-sm">
                    <div className="summary-card">
                      <span>Valor do CT-e</span>
                      <strong>{formatarMoeda(comparacao.valorCte)}</strong>
                      <small>valor que será auditado</small>
                    </div>
                    <div className="summary-card">
                      <span>Saldo disponível na DIST</span>
                      <strong>{formatarMoeda(comparacao.saldoDist)}</strong>
                      <small>já considera lançamentos e adicionais</small>
                    </div>
                    <div className="summary-card">
                      <span>Resultado</span>
                      <strong className={comparacao.aumentoNecessario > 0 ? 'negativo' : 'positivo'}>
                        {comparacao.aumentoNecessario > 0
                          ? `Aumento de ${formatarMoeda(comparacao.aumentoNecessario)}`
                          : 'Dentro do saldo'}
                      </strong>
                      <small>
                        {comparacao.aumentoNecessario > 0
                          ? 'exigirá confirmação da Operação'
                          : 'será registrado como auditado'}
                      </small>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="panel-card top-space-sm" style={{ padding: 14 }}>
          <div className="panel-title">{isQuestionamento ? 'Resposta formal da Operação' : 'Resposta / tratamento da Operação'}</div>
          {pendente ? (
            <>
              <textarea
                value={tratamento?.resposta || ''}
                onChange={(event) => onTratamento(item.id, 'resposta', event.target.value)}
                placeholder={isQuestionamento
                  ? excecaoSemCte
                    ? 'Valide a exceção manualmente e informe a DIST/viagem correta.'
                    : 'Responda objetivamente ao questionamento original da Auditoria.'
                  : 'Informe a resposta, tratativa ou justificativa da Operação antes de aprovar/recusar.'}
                style={{ minHeight: 110 }}
              />
              {isQuestionamento && (
                <label className="field top-space-sm">
                  Justificativa da Operação
                  <textarea
                    value={tratamento?.justificativa || ''}
                    onChange={(event) => onTratamento(item.id, 'justificativa', event.target.value)}
                    placeholder={excecaoSemCte
                      ? 'Explique por que a exceção foi validada e qual DIST/viagem foi usada.'
                      : 'Explique a correção da DIST/viagem e o motivo da resposta.'}
                    style={{ minHeight: 90 }}
                  />
                </label>
              )}
            </>
          ) : (
            <>
              <div className="hint-box compact top-space-sm">{item.resposta || 'Sem resposta registrada.'}</div>
              {isQuestionamento && item.justificativaOperacao && (
                <div className="hint-box compact top-space-sm"><strong>Justificativa:</strong><br />{item.justificativaOperacao}</div>
              )}
            </>
          )}
        </div>

        <div className="row-actions lotacao-auditoria-actions top-space-sm" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn-secondary" onClick={() => onCopiar(item)}>Copiar</button>
          <a className="btn-secondary link-button" href={emailHref(item)}>E-mail</a>
          {pendente && (
            <>
              <button
                type="button"
                className="btn-primary"
                onClick={() => onResponder(item, statusResposta)}
                disabled={!podeConcluirQuestionamento}
                title={!podeConcluirQuestionamento ? 'Selecione a DIST e informe a justificativa para concluir' : ''}
              >
                Aprovar
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => {
                  if (isQuestionamento) {
                    const confirmado = window.confirm(
                      'Tem certeza que precisa devolver?\n\nPara aprovar, é necessário vincular a viagem (DIST) e informar a justificativa.',
                    );
                    if (!confirmado) return;
                  }
                  onResponder(item, statusRecusarSolicitacao(item));
                }}
              >
                {isQuestionamento ? 'Devolver' : 'Recusar'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AutorizacoesOperacao({ solicitacoes, cargas, lancamentos, onAtualizar, onRespostaConcluida }) {
  const [tratamentos, setTratamentos] = useState({});
  const [feedback, setFeedback] = useState(null);
  const [filtros, setFiltros] = useState({ status: 'pendentes', tipo: 'todos', termo: '' });
  const [detalheAberto, setDetalheAberto] = useState(null);

  const listaFiltrada = useMemo(() => {
    const termo = normalizarTexto(filtros.termo || '');
    return [...(solicitacoes || [])]
      .filter(Boolean)
      .filter((item) => {
        if (filtros.status === 'pendentes') return isPendente(item.status);
        if (filtros.status === 'aprovadas') return isAprovado(item.status);
        if (filtros.status === 'recusadas') return isRecusado(item.status);
        return true;
      })
      .filter((item) => {
        if (filtros.tipo === 'custos') return item.tipo === 'CUSTO_ADICIONAL';
        if (filtros.tipo === 'auditoria') return item.tipo !== 'CUSTO_ADICIONAL';
        return true;
      })
      .filter((item) => {
        if (!termo) return true;
        return normalizarTexto([item.dist, item.cte, item.fatura, item.transportadora, item.origem, item.destino, item.status, item.tipoCusto, item.observacao].join(' ')).includes(termo);
      })
      .sort((a, b) => {
        if (filtros.status === 'pendentes') return tempoAguardandoMs(b) - tempoAguardandoMs(a);
        return dataOrdenacaoItem(b) - dataOrdenacaoItem(a);
      });
  }, [solicitacoes, filtros]);

  const copiar = async (item) => {
    const texto = textoSolicitacaoPagamento(item);
    try {
      await navigator.clipboard.writeText(texto);
      window.alert('Solicitação copiada para a área de transferência.');
    } catch {
      window.prompt('Copie a solicitação abaixo:', texto);
    }
  };

  const emailHref = (item) => {
    const subject = encodeURIComponent(`Autorização de pagamento - ${item.dist}`);
    const body = encodeURIComponent(textoSolicitacaoPagamento(item));
    return `mailto:?subject=${subject}&body=${body}`;
  };

  const atualizarTratamento = (id, campo, valor) => {
    setTratamentos((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), [campo]: valor },
    }));
  };

  const abrirDetalhe = (item) => {
    const cargaExistente = (cargas || []).find((carga) => String(carga.id) === String(item.cargaId))
      || null;
    setTratamentos((prev) => ({
      ...prev,
      [item.id]: {
        resposta: prev[item.id]?.resposta || (item.status === STATUS_AGUARDANDO_COMPLEMENTO_OPERACAO ? '' : (item.resposta || '')),
        justificativa: prev[item.id]?.justificativa || (item.status === STATUS_AGUARDANDO_COMPLEMENTO_OPERACAO ? '' : (item.justificativaOperacao || '')),
        buscaDist: prev[item.id]?.buscaDist ?? '',
        cargaId: prev[item.id]?.cargaId || cargaExistente?.id || '',
      },
    }));
    setDetalheAberto(item);
  };

  const responder = async (item, status) => {
    const tratamento = tratamentos[item.id] || {};
    const resposta = String(tratamento.resposta || '').trim();
    const justificativa = String(tratamento.justificativa || resposta).trim();
    const isQuestionamento = isQuestionamentoAuditoria(item);
    const excecaoSemCte = isQuestionamentoExcecaoSemCte(item);
    const viagem = isQuestionamento
      ? (cargas || []).find((carga) => String(carga.id) === String(tratamento.cargaId))
      : null;
    const justificativaPreenchida = Boolean(String(tratamento.justificativa || '').trim());
    if (isQuestionamento && !justificativaPreenchida) {
      window.alert('Informe a justificativa da Operação.');
      return;
    }
    if (!isQuestionamento && !resposta) {
      window.alert('Informe a resposta ou tratamento da Operação.');
      return;
    }
    if (statusExigeVinculoDistOperacao(item, status) && !viagem?.dist) {
      window.alert('Selecione a DIST/viagem existente relacionada ao questionamento.');
      return;
    }

    const concluirQuestionamento = statusExigeVinculoDistOperacao(item, status);
    const comparacao = compararQuestionamentoComViagem(item, viagem, lancamentos, solicitacoes);
    if (concluirQuestionamento && !excecaoSemCte && comparacao.valorCte <= 0) {
      window.alert('O valor do CT-e não foi identificado no questionamento. A Auditoria deve reenviar a solicitação com o valor para permitir a comparação.');
      return;
    }

    const valor = formatarMoeda(valorPrincipalSolicitacao(item));
    const acao = isAprovado(status) ? 'aprovar' : statusKey(status) === 'RESPONDIDO_OPERACAO' ? 'responder' : 'recusar/devolver';
    const mensagemFinanceira = concluirQuestionamento
      ? excecaoSemCte
        ? '\n\nEsta exceção não possui chave/valor de CT-e para lançamento automático. A resposta apenas vinculará a solicitação à DIST selecionada.'
        : comparacao.aumentoNecessario > 0
        ? `\n\nATENÇÃO: o CT-e é ${formatarMoeda(comparacao.valorCte)}, o saldo da DIST é ${formatarMoeda(comparacao.saldoDist)} e será autorizado um aumento de ${formatarMoeda(comparacao.aumentoNecessario)}.`
        : `\n\nO CT-e de ${formatarMoeda(comparacao.valorCte)} cabe no saldo de ${formatarMoeda(comparacao.saldoDist)} e será registrado como auditado.`
      : '';
    const confirmado = window.confirm(`Confirmar ${acao} a solicitação da DIST ${viagem?.dist || item.dist || '-'} no valor de ${valor}?${mensagemFinanceira}\n\nJustificativa: ${justificativa}`);
    if (!confirmado) return;

    setFeedback(null);
    try {
      await onAtualizar(item, status, {
        resposta,
        justificativa,
        viagem,
        aumentoConfirmado: concluirQuestionamento && !excecaoSemCte && comparacao.aumentoNecessario > 0,
      });
      setTratamentos((prev) => ({ ...prev, [item.id]: {} }));
      setDetalheAberto(null);
      setFeedback({ tipo: 'ok', texto: `Solicitação atualizada com sucesso.` });
    } catch (error) {
      setFeedback({ tipo: 'erro', texto: error.message || String(error) });
    }
  };

  return (
    <div className="table-card lotacao-table-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Aprovações e pendências da operação</div>
          <p className="compact">Centraliza custos extras, excedentes da Auditoria Lotação e liberações aguardando decisão. A listagem fica resumida; os dados completos ficam em Detalhes.</p>
        </div>
        <span className="status-pill dark">{listaFiltrada.filter((item) => isPendente(item.status)).length} pendente(s)</span>
      </div>

      <div className="form-grid three">
        <label className="field">
          Status
          <select value={filtros.status} onChange={(event) => setFiltros((prev) => ({ ...prev, status: event.target.value }))}>
            <option value="pendentes">Somente pendentes</option>
            <option value="todos">Todos</option>
            <option value="aprovadas">Aprovadas/liberadas</option>
            <option value="recusadas">Recusadas</option>
          </select>
        </label>
        <label className="field">
          Tipo
          <select value={filtros.tipo} onChange={(event) => setFiltros((prev) => ({ ...prev, tipo: event.target.value }))}>
            <option value="todos">Todos</option>
            <option value="custos">Custos extras</option>
            <option value="auditoria">Excedentes/questionamentos da auditoria</option>
          </select>
        </label>
        <label className="field">
          Buscar
          <input value={filtros.termo} onChange={(event) => setFiltros((prev) => ({ ...prev, termo: event.target.value }))} placeholder="DIST, CT-e, fatura, transportadora..." />
        </label>
      </div>

      <StatusMensagem mensagem={feedback} />

      {!listaFiltrada.length ? (
        <div className="hint-box compact top-space-sm">Nenhuma solicitação encontrada para os filtros informados.</div>
      ) : (
        <div className="sim-analise-tabela-wrap top-space-sm">
          <table className="sim-analise-tabela">
            <thead>
              <tr>
                <th>Status</th>
                <th>Aguardando</th>
                <th>Tipo</th>
                <th>DIST</th>
                <th>CT-e/Fatura</th>
                <th>Transportadora</th>
                <th>Rota</th>
                <th>Valores</th>
                <th>Resumo</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {listaFiltrada.slice(0, 160).map((item) => {
                const pendente = isPendente(item.status);
                const tempo = calcularTempoAguardando(item);
                const diferenca = valorDiferencaSolicitacao(item);
                const rota = [item.origem, item.destino].filter(Boolean).join(' x ') || '-';
                return (
                  <tr key={item.id}>
                    <td style={{ minWidth: 150 }}>
                      <span className={`status-pill ${tempo.atrasado ? 'error' : ''}`}>{classificarStatus(item.status)}</span>
                      <div className="muted small">{item.status}</div>
                    </td>
                    <td className={tempo.atrasado ? 'negativo' : ''} style={{ minWidth: 110 }}>
                      <strong>{tempo.texto}</strong>
                      {tempo.dataTexto && <div className="muted small">desde {tempo.dataTexto}</div>}
                    </td>
                    <td style={{ minWidth: 150 }}>{rotuloTipoSolicitacao(item)}</td>
                    <td style={{ minWidth: 120 }}><strong>{item.dist || '-'}</strong></td>
                    <td style={{ minWidth: 190 }}>{item.cte || '-'}<div className="muted small">{item.fatura || ''}</div></td>
                    <td style={{ minWidth: 180 }}>{item.transportadora || '-'}</td>
                    <td style={{ minWidth: 190 }}>{rota}</td>
                    <td style={{ minWidth: 170 }}>
                      <div className="muted small">Orçado: {formatarMoeda(valorOrcadoSolicitacao(item))}</div>
                      <div><strong>Solicitado: {formatarMoeda(valorSolicitadoSolicitacao(item))}</strong></div>
                      <div className={isRecusado(item.status) ? 'muted small' : diferenca > 0 ? 'negativo small' : 'muted small'}>Dif.: {formatarMoeda(diferenca)}</div>
                    </td>
                    <td style={{ minWidth: 260, maxWidth: 340 }}>
                      <div className="muted small">{resumoSolicitacaoCurto(item)}</div>
                    </td>
                    <td style={{ minWidth: 180 }}>
                      <div className="row-actions lotacao-auditoria-actions">
                        <button type="button" className="btn-primary" onClick={() => abrirDetalhe(item)}>Detalhes</button>
                        {pendente && (
                          <button type="button" className="btn-secondary" onClick={() => abrirDetalhe(item)}>
                            {isQuestionamentoAuditoria(item) ? 'Responder' : 'Tratar'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <SolicitacaoDetalhesModal
        item={detalheAberto}
        tratamento={detalheAberto ? tratamentos[detalheAberto.id] : null}
        cargas={cargas}
        lancamentos={lancamentos}
        solicitacoes={solicitacoes}
        onFechar={() => setDetalheAberto(null)}
        onTratamento={atualizarTratamento}
        onResponder={responder}
        onCopiar={copiar}
        emailHref={emailHref}
      />
    </div>
  );
}

function CustoAdicionalOperacao({ baseFluxo, onCriado, distSugerida }) {
  const [busca, setBusca] = useState(distSugerida || '');
  const [selecionadaId, setSelecionadaId] = useState('');
  const [form, setForm] = useState({ tipoCusto: 'Diária', valorAdicional: '', cte: '', fatura: '', observacao: '', statusAprovacao: 'PENDENTE' });
  const [mensagem, setMensagem] = useState('');

  useEffect(() => {
    if (distSugerida) setBusca(distSugerida);
  }, [distSugerida]);

  const resultados = useMemo(() => buscarViagensUnicasPorDistOuCte(baseFluxo.cargas, busca, 20), [baseFluxo.cargas, busca]);
  const selecionada = resultados.find((item) => item.id === selecionadaId) || resultados[0] || null;

  const atualizar = (campo, valor) => setForm((prev) => ({ ...prev, [campo]: valor }));

  const criar = () => {
    if (!selecionada) {
      setMensagem('Pesquise uma DIST ou CT-e válido antes de incluir custo.');
      return;
    }
    try {
      const base = criarCustoAdicionalLotacao(selecionada, form);
      const status = form.statusAprovacao || 'PENDENTE';
      const custo = {
        ...base,
        status,
        resposta: status === 'APROVADO' ? 'Aprovado na criação pela Operação.' : '',
        atualizadoEm: new Date().toISOString(),
      };
      onCriado(custo);
      setForm({ tipoCusto: 'Diária', valorAdicional: '', cte: '', fatura: '', observacao: '', statusAprovacao: 'PENDENTE' });
      setMensagem(status === 'APROVADO' ? 'Custo adicional aprovado e liberado como saldo para auditoria.' : 'Custo adicional criado como pendente de aprovação.');
    } catch (error) {
      setMensagem(error.message || String(error));
    }
  };

  return (
    <div className="panel-card lotacao-custo-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Incluir custo extra na DIST</div>
          <p>Use para diária, descarga, reentrega, pedágio extra, complemento de frete ou outra autorização operacional.</p>
        </div>
      </div>

      <div className="form-grid three">
        <label className="field">
          Buscar DIST ou CT-e
          <input value={busca} onChange={(event) => setBusca(event.target.value)} placeholder="Ex.: 14676" />
        </label>
        <label className="field">
          Carga encontrada
          <select value={selecionadaId} onChange={(event) => setSelecionadaId(event.target.value)} disabled={!resultados.length}>
            {resultados.length === 0 && <option value="">Nenhuma carga encontrada</option>}
            {resultados.map((item) => (
              <option key={item.id} value={item.id}>{item.dist} · {item.transportadora} · {item.origem} x {item.destino}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Tipo do custo
          <input value={form.tipoCusto} onChange={(event) => atualizar('tipoCusto', event.target.value)} placeholder="Diária, descarga, taxa extra..." />
        </label>
      </div>

      <div className="form-grid three">
        <label className="field">
          Valor adicional
          <input type="number" min="0" step="0.01" value={form.valorAdicional} onChange={(event) => atualizar('valorAdicional', event.target.value)} placeholder="Ex.: 500" />
        </label>
        <label className="field">
          Status inicial
          <select value={form.statusAprovacao} onChange={(event) => atualizar('statusAprovacao', event.target.value)}>
            <option value="PENDENTE">Criar como pendente de aprovação</option>
            <option value="APROVADO">Aprovar e liberar agora</option>
          </select>
        </label>
        <label className="field">
          CT-e vinculado
          <input value={form.cte} onChange={(event) => atualizar('cte', event.target.value)} placeholder="Opcional" />
        </label>
      </div>

      <div className="form-grid three">
        <label className="field">
          Fatura
          <input value={form.fatura} onChange={(event) => atualizar('fatura', event.target.value)} placeholder="Opcional" />
        </label>
        <label className="field full-span">
          Justificativa da operação
          <textarea value={form.observacao} onChange={(event) => atualizar('observacao', event.target.value)} placeholder="Explique o motivo do custo adicional" />
        </label>
      </div>

      {selecionada && (
        <div className="hint-box compact">
          DIST selecionada: <strong>{selecionada.dist}</strong> · {selecionada.transportadora} · {selecionada.origem} x {selecionada.destino} · Valor base {formatarMoeda(selecionada.valorComparacao)}
        </div>
      )}
      {mensagem && <div className="hint-box compact">{mensagem}</div>}

      <div className="actions-right">
        <button type="button" className="btn-primary" disabled={!selecionada || !form.valorAdicional} onClick={criar}>Salvar custo extra</button>
      </div>
    </div>
  );
}

export default function LotacaoOperacaoPage({ onRespostaConcluida }) {
  const sessao = carregarSessao();
  const [baseFluxo, setBaseFluxo] = useState(() => carregarFluxoCargasLotacao());
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);
  const [tabelas, setTabelas] = useState([]);
  const [fonte, setFonte] = useState('ambos');
  const [filtros, setFiltros] = useState({ origem: '', destino: '', tipo: '', transportadora: '' });
  const [solicitacoes, setSolicitacoes] = useState(() => carregarSolicitacoesPagamento());
  const [lancamentos, setLancamentos] = useState(() => carregarLancamentosAuditoria());
  const [abaAtiva, setAbaAtiva] = useState('visao');
  const [distSelecionadaKey, setDistSelecionadaKey] = useState('');

  useEffect(() => {
    setTabelas(carregarTabelasLotacao());
    let cancelado = false;
    (async () => {
      try {
        const resultado = await carregarTabelasLotacaoSupabase();
        if (!cancelado && Array.isArray(resultado?.tabelas) && resultado.tabelas.length > 0) {
          setTabelas(resultado.tabelas);
        }
      } catch (erroTabelaSupabase) {
        console.warn('[Operação] Tabelas de lotação via Supabase indisponíveis, usando localStorage:', erroTabelaSupabase.message);
      }
    })();
    setCarregandoHistorico(true);
    (async () => {
      try {
        const cargasSupabase = await carregarCargasLotacaoSupabase({});
        if (!cancelado && cargasSupabase.length > 0) {
          setBaseFluxo({ cargas: cargasSupabase, armazenamento: 'supabase' });
          setCarregandoHistorico(false);
          return;
        }
      } catch (erroSupabase) {
        console.warn('Supabase indisponível para cargas, usando local:', erroSupabase.message);
      }
      carregarFluxoCargasLotacaoCompleto()
        .then((base) => { if (!cancelado) setBaseFluxo(base); })
        .catch((error) => { console.error('Erro ao carregar histórico de lotação:', error); })
        .finally(() => { if (!cancelado) setCarregandoHistorico(false); });
    })();
    return () => { cancelado = true; };
  }, []);

  const recarregarSolicitacoes = useCallback(async () => {
    try {
      const [sols, pends, infos] = await Promise.all([
        carregarSolicitacoesSupabase(),
        carregarPendenciasAuditoriaSupabase({}).catch(() => null),
        carregarSolicitacoesInfoSupabase({}).catch(() => null),
      ]);
      if (sols !== null || pends !== null || infos !== null) {
        const pendencias = Array.isArray(pends) ? pends.map(pendenciaParaSolicitacaoOperacao) : [];
        const questionamentos = Array.isArray(infos) ? infos.map(solicitacaoInfoParaOperacao) : [];
        const chavesPendencias = new Set(pendencias.map(chaveSolicitacaoLotacao));
        const legadasSemDuplicar = (sols || []).filter((sol) => !chavesPendencias.has(chaveSolicitacaoLotacao(sol)));
        const lista = [...pendencias, ...questionamentos, ...legadasSemDuplicar].sort((a, b) => dataOrdenacaoItem(b) - dataOrdenacaoItem(a));
        setSolicitacoes(lista);
        salvarSolicitacoesPagamento(lista);
      }
    } catch (err) {
      console.warn('[Operação] Usando localStorage para solicitações:', err.message);
    }
  }, []);

  useEffect(() => {
    recarregarSolicitacoes();
  }, [recarregarSolicitacoes]);

  useEffect(() => {
    if (abaAtiva === 'aprovacoes') recarregarSolicitacoes();
  }, [abaAtiva, recarregarSolicitacoes]);

  useEffect(() => {
    const sincronizar = () => recarregarSolicitacoes();
    globalThis.addEventListener?.('lotacao-solicitacoes-atualizadas', sincronizar);
    globalThis.addEventListener?.('focus', sincronizar);
    return () => {
      globalThis.removeEventListener?.('lotacao-solicitacoes-atualizadas', sincronizar);
      globalThis.removeEventListener?.('focus', sincronizar);
    };
  }, [recarregarSolicitacoes]);

  useEffect(() => {
    (async () => {
      try {
        const dados = await carregarLancamentosAuditoriaSupabase();
        if (Array.isArray(dados)) setLancamentos(dados);
      } catch (err) {
        console.warn('[Operação] Usando localStorage para lançamentos da auditoria:', err.message);
      }
    })();
  }, []);

  const resumo = useMemo(() => resumirFluxoCargas(baseFluxo), [baseFluxo]);
  const resultadosHistorico = useMemo(() => buscarHistoricoLotacao(baseFluxo.cargas, filtros), [baseFluxo.cargas, filtros]);
  const resultadosTabela = useMemo(() => pesquisarRotaLotacao(tabelas, filtros), [tabelas, filtros]);
  const viagensConsolidadas = useMemo(() => consolidarViagensLotacao(resultadosHistorico), [resultadosHistorico]);
  const rankingHistorico = useMemo(() => rankingHistoricoPorTransportadora(resultadosHistorico), [resultadosHistorico]);
  const indicadoresAprovacoes = useMemo(() => calcularIndicadoresAprovacoes(solicitacoes), [solicitacoes]);

  useEffect(() => {
    if (!distSelecionadaKey) return;
    if (!viagensConsolidadas.some((item) => item.distKey === distSelecionadaKey)) {
      setDistSelecionadaKey('');
    }
  }, [viagensConsolidadas, distSelecionadaKey]);

  const viagemSelecionada = useMemo(() => (
    viagensConsolidadas.find((item) => item.distKey === distSelecionadaKey) || null
  ), [viagensConsolidadas, distSelecionadaKey]);

  const atualizarFiltro = (campo, valor) => setFiltros((prev) => ({ ...prev, [campo]: valor }));
  const limparFiltros = () => setFiltros({ origem: '', destino: '', tipo: '', transportadora: '' });

  const atualizarSolicitacao = async (item, status, tratamento = {}) => {
    const id = item?.id;
    if (!id) throw new Error('Solicitação sem identificador.');
    const justificativa = String(tratamento.justificativa || tratamento.resposta || '').trim();
    const resposta = String(tratamento.resposta || justificativa).trim();
    const viagem = tratamento.viagem || null;
    const isPendencia = item.fonteFluxo === 'AUDIT_PENDENCIA';
    const excecaoSemCte = isQuestionamentoExcecaoSemCte(item);
    let custoAumento = null;
    let lancamentoAuditado = null;
    if (isQuestionamentoAuditoria(item)) {
      if (!justificativa) throw new Error('A justificativa da Operação é obrigatória.');
      if (statusExigeVinculoDistOperacao(item, status) && (!viagem?.id || !viagem?.dist)) {
        throw new Error('Selecione uma DIST/viagem existente antes de responder.');
      }
      const comparacao = compararQuestionamentoComViagem(item, viagem, lancamentos, solicitacoes);
      if (statusExigeVinculoDistOperacao(item, status) && !excecaoSemCte && comparacao.valorCte <= 0) {
        throw new Error('O valor do CT-e não foi identificado no questionamento e não pode ser auditado.');
      }
      if (statusExigeVinculoDistOperacao(item, status) && !excecaoSemCte && comparacao.aumentoNecessario > 0 && !tratamento.aumentoConfirmado) {
        throw new Error(`Confirme o aumento de ${formatarMoeda(comparacao.aumentoNecessario)} antes de concluir.`);
      }

      const cteJaAuditado = cteJaLancado(lancamentos, viagem, item.cte);
      if (!excecaoSemCte && !cteJaAuditado && statusExigeVinculoDistOperacao(item, status)) {
        if (comparacao.aumentoNecessario > 0) {
          custoAumento = {
            ...criarCustoAdicionalLotacao(viagem, {
              tipoCusto: 'Aumento confirmado na resposta da Operação',
              valorAdicional: comparacao.aumentoNecessario,
              cte: item.cte,
              fatura: item.fatura,
              observacao: justificativa,
            }),
            status: 'APROVADO_OPERACAO',
            resposta,
            atualizadoEm: new Date().toISOString(),
          };
          await salvarSolicitacaoSupabase(custoAumento);
        }

        const solicitacoesComAumento = custoAumento ? [custoAumento, ...solicitacoes] : solicitacoes;
        lancamentoAuditado = criarLancamentoAuditoria(viagem, {
          cte: item.cte,
          fatura: item.fatura,
          valorLancado: comparacao.valorCte,
          observacao: `Auditado após resposta da Operação. ${justificativa}`,
        }, lancamentos, solicitacoesComAumento);
        lancamentoAuditado = {
          ...lancamentoAuditado,
          auditedByUserId: sessao?.id || '',
          auditedByName: sessao?.nome || sessao?.email || '',
          auditedByEmail: sessao?.email || '',
          auditedAt: new Date().toISOString(),
          auditStatus: 'AUDITADO_OK',
          auditExceededAmount: 0,
          auditAllowedAmount: comparacao.aumentoNecessario,
          auditEnteredAmount: comparacao.valorCte,
          origemTela: 'LOTACAO_OPERACAO',
        };
        await salvarLancamentoAuditoriaSupabase(lancamentoAuditado);
      }

      const agora = new Date().toISOString();
      await atualizarSolicitacaoInfoSupabase(id, status, {
        resposta,
        resposta_operacao: resposta,
        justificativa_operacao: justificativa,
        observacao_tratamento: justificativa,
        ...(viagem ? {
          dist: viagem.dist,
          dist_key: viagem.distKey || normalizarDistKey(viagem.dist),
          carga_id: String(viagem.id),
        } : {}),
        respondido_por_id: sessao?.id || '',
        respondido_por_nome: sessao?.nome || sessao?.email || '',
        respondido_por_email: sessao?.email || '',
        respondido_em: agora,
      });
      await registrarEventoHistoricoSupabase({
        solicitacaoInfoId: id,
        userId: sessao?.id || '',
        userName: sessao?.nome || '',
        userEmail: sessao?.email || '',
        acao: status,
        statusAnterior: item.status || '',
        statusNovo: status,
        comentario: `${resposta}\n\nJustificativa: ${justificativa}${viagem?.dist ? `\nDIST/viagem: ${viagem.dist}` : ''}`,
        origemTela: 'LOTACAO_OPERACAO',
      });
    } else if (isPendencia) {
      const valorOriginal = Number(item.valorAutorizadoCarga || 0);
      const valorAdicional = status === 'APROVADO_OPERACAO' ? Number(item.valorAdicional || item.excedente || 0) : 0;
      const valorFinal = valorOriginal + valorAdicional;
      const agora = new Date().toISOString();
      await atualizarPendenciaAuditoriaSupabase(id, status, {
        aprovado_por_user_id: sessao?.id || '',
        aprovado_por_name: sessao?.nome || sessao?.email || '',
        aprovado_por_email: sessao?.email || '',
        aprovado_em: agora,
        valor_original: valorOriginal,
        valor_adicional_aprovado: valorAdicional,
        valor_final_autorizado: valorFinal,
        prazo_auditoria_em: status === 'APROVADO_OPERACAO' ? adicionarHorasIso(agora, 24) : null,
        motivo_recusa: status === 'RECUSADO_OPERACAO' ? justificativa : '',
        resposta_operacao: resposta,
        justificativa_operacao: justificativa,
      });
      await registrarEventoHistoricoSupabase({
        pendenciaId: id,
        userId: sessao?.id || '',
        userName: sessao?.nome || '',
        userEmail: sessao?.email || '',
        acao: status,
        statusAnterior: item.status || '',
        statusNovo: status,
        comentario: justificativa,
        origemTela: 'LOTACAO_OPERACAO',
      });
    } else {
      await atualizarSolicitacaoSupabase(id, status, resposta);
    }
    if (lancamentoAuditado) {
      const novosLancamentos = [lancamentoAuditado, ...lancamentos];
      salvarLancamentosAuditoria(novosLancamentos);
      setLancamentos(novosLancamentos);
    }

    const baseOriginal = solicitacoes.length ? solicitacoes : carregarSolicitacoesPagamento();
    const base = custoAumento ? [custoAumento, ...baseOriginal] : baseOriginal;
    const atualizadas = atualizarStatusSolicitacao(base, id, status, resposta)
      .map((solicitacao) => solicitacao.id === id ? {
        ...solicitacao,
        resposta,
        justificativaOperacao: justificativa,
        dist: viagem?.dist || solicitacao.dist,
        distKey: viagem?.distKey || (viagem?.dist ? normalizarDistKey(viagem.dist) : solicitacao.distKey),
        cargaId: viagem?.id || solicitacao.cargaId,
      } : solicitacao)
      .sort((a, b) => dataOrdenacaoItem(b) - dataOrdenacaoItem(a));
    salvarSolicitacoesPagamento(atualizadas);
    setSolicitacoes(atualizadas);
  };

  const criarCustoAdicional = async (custo) => {
    try {
      await salvarSolicitacaoSupabase(custo);
    } catch (err) {
      console.warn('[Operação] Falha ao salvar custo no Supabase:', err.message);
    }
    const base = carregarSolicitacoesPagamento();
    const novas = [custo, ...base].sort((a, b) => dataOrdenacaoItem(b) - dataOrdenacaoItem(a));
    salvarSolicitacoesPagamento(novas);
    setSolicitacoes(novas);
  };

  const mostrarTabela = fonte === 'tabela' || fonte === 'ambos';
  const mostrarHistorico = fonte === 'historico' || fonte === 'ambos';

  return (
    <div className="page-shell lotacao-page lotacao-fluxo-page">
      <header className="page-top between">
        <div className="page-header">
          <span className="amd-mini-brand">Lotação · Operação</span>
          <h1>Central operacional de lotação</h1>
          <p>
            Consulta do realizado, tabelas, saldo da Auditoria Lotação, custos extras e aprovações pendentes em uma tela única.
          </p>
          <AbasOperacao abaAtiva={abaAtiva} onChange={setAbaAtiva} pendencias={indicadoresAprovacoes.pendentes} />
        </div>
      </header>

      {carregandoHistorico && <div className="hint-box compact">Carregando histórico de cargas da Lotação...</div>}

      <KpisFluxo resumo={resumo} indicadores={indicadoresAprovacoes} lancamentos={lancamentos} />

      {abaAtiva === 'visao' && (
        <VisaoGeralOperacao
          viagemSelecionada={viagemSelecionada}
          tabelas={tabelas}
          lancamentos={lancamentos}
          solicitacoes={solicitacoes}
          indicadores={indicadoresAprovacoes}
          onAbrirCustos={() => setAbaAtiva('custos')}
          onAbrirAprovacoes={() => setAbaAtiva('aprovacoes')}
        />
      )}

      {abaAtiva === 'consulta' && (
        <>
          <FiltrosConsulta
            fonte={fonte}
            setFonte={setFonte}
            filtros={filtros}
            atualizarFiltro={atualizarFiltro}
            limpar={limparFiltros}
            totalViagens={viagensConsolidadas.length}
            totalTabelas={resultadosTabela.length}
          />

          {mostrarTabela && (
            <div className="table-card lotacao-table-card">
              <div className="section-row compact-top">
                <div>
                  <div className="panel-title">Resultado pelas tabelas cadastradas</div>
                  <p className="compact">Ordenado do menor para o maior valor cadastrado. Usa Supabase quando disponível e localStorage como fallback.</p>
                </div>
                <span className="status-pill dark">{resultadosTabela.length} opções</span>
              </div>
              <ResultadoTabelas resultados={resultadosTabela} />
            </div>
          )}

          {mostrarHistorico && (
            <>
              <div className="table-card lotacao-table-card">
                <div className="section-row compact-top">
                  <div>
                    <div className="panel-title">Viagens / DISTs consolidadas</div>
                    <p className="compact">Agrupa a mesma DIST/HUB e mostra saldo integrado com a Auditoria Lotação.</p>
                  </div>
                  <span className="status-pill dark">{viagensConsolidadas.length} DIST(s)</span>
                </div>
                <ResultadoViagensConsolidadas
                  viagens={viagensConsolidadas}
                  selecionadaKey={distSelecionadaKey}
                  onSelecionar={setDistSelecionadaKey}
                  lancamentos={lancamentos}
                  solicitacoes={solicitacoes}
                />
              </div>
              <DetalheViagemOperacao
                viagem={viagemSelecionada}
                tabelas={tabelas}
                lancamentos={lancamentos}
                solicitacoes={solicitacoes}
                onAbrirCustos={() => setAbaAtiva('custos')}
                onAbrirAprovacoes={() => setAbaAtiva('aprovacoes')}
              />
              <RankingHistorico ranking={rankingHistorico} />
            </>
          )}
        </>
      )}

      {abaAtiva === 'aprovacoes' && (
        <AutorizacoesOperacao
          solicitacoes={solicitacoes}
          cargas={baseFluxo.cargas}
          lancamentos={lancamentos}
          onAtualizar={atualizarSolicitacao}
          onRespostaConcluida={onRespostaConcluida}
        />
      )}

      {abaAtiva === 'custos' && (
        <CustoAdicionalOperacao
          baseFluxo={baseFluxo}
          onCriado={criarCustoAdicional}
          distSugerida={viagemSelecionada?.dist || ''}
        />
      )}

      {abaAtiva === 'importacao' && (
        <ImportarFluxoCard onImportado={setBaseFluxo} resumo={resumo} />
      )}
    </div>
  );
}

