import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import BaseCtesStatus from '../components/BaseCtesStatus';
import AmdProcessingOverlay from '../components/AmdProcessingOverlay';
import { carregarSessao } from '../utils/authLocal';
import {
  agruparDetalhesVerum,
  analisarLayoutVerum,
  chaveFatura,
  detalhesDaFatura,
  parseDetalheFaturaVerum,
  parseFaturaVerum,
} from '../utils/auditoriaFretesImport';
import {
  carregarDetalhesFaturaSupabase,
  limparDetalhesFaturaSupabase,
  salvarDetalhesFaturaSupabase,
  salvarFaturaSupabase,
} from '../services/lotacaoSupabaseService';
import {
  BOLETO_STATUS,
  FATURA_STATUS,
  SOLICITACAO_FINANCEIRA_TIPOS,
  calcularDashboard,
  conciliarPagamentos,
  diasAte,
  faixaVencimento,
  montarArquivoDoccobEdi,
  montarLinhasDoccob,
  montarNomeDoccob,
  normalizarChaveCte,
  statusSla,
} from '../utils/auditoriaFretesDomain';
import {
  atualizarFaturaAuditoria,
  atenderSolicitacaoFinanceira,
  buscarReferenciaCtes,
  carregarPlataformaAuditoria,
  criarProtocoloFinanceiro,
  criarSolicitacaoFinanceira,
  buscarFaturasExistentesPorNumero,
  detectarCanaisFaturas,
  reauditarFatura,
  registrarDoccob,
  restaurarDemonstracaoAuditoria,
  salvarBoletoFinanceiro,
  salvarCarteiraAuditoria,
  salvarPagamentosFinanceiros,
  vincularNovaFatura,
} from '../services/auditoriaFretesService';
import { processarCtesPorChave, invalidarCacheBaseFreteAuditoriaCte, buscarResultadoAuditoriaPorChave } from '../services/auditoriaCteProcessamentoService';
import { salvarRecorteCarregadoAuditoria } from '../services/auditoriaService';

const TABS = [
  ['dashboard', 'Dashboard'],
  ['faturas', 'Faturas'],
  ['gestao', 'Centro de Gestores'],
  ['financeiro', 'Central Financeira'],
];

function dinheiro(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dinheiroMaybe(v) {
  const n = Number(v);
  return Number.isFinite(n) ? dinheiro(n) : '—';
}

function numeroFmt(v, d = 0) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function pctFmt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toFixed(2).replace('.', ',')}%` : '—';
}

function extrairIdentificadoresCte(texto = '') {
  return [...new Set(String(texto || '').match(/\d{5,}/g) || [])];
}

function somaValoresObjeto(obj = {}) {
  return Object.entries(obj || {}).reduce((acc, [, valor]) => {
    if (Array.isArray(valor)) return acc;
    const n = Number(valor || 0);
    return Number.isFinite(n) ? acc + n : acc;
  }, 0);
}

function linhaDetalhe(label, value, destaque = false) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', borderBottom: '1px solid #e2e8f0' }}>
      <span style={{ color: '#64748b' }}>{label}</span>
      <strong style={{ color: destaque ? '#0f172a' : '#334155', textAlign: 'right' }}>{value}</strong>
    </div>
  );
}

// Painel de detalhe do calculo (mesmo layout da Auditoria CT-e), reaproveitado
// aqui pra permitir ver o detalhamento de um CT-e direto na tela de Faturas.
function PainelDetalheCalculo({ resultado }) {
  if (!resultado) return <span>Sem detalhe de calculo para este CT-e.</span>;
  const det = (() => {
    const d = resultado.detalhes_calculo;
    if (!d) return null;
    if (typeof d === 'object') return d;
    try { return JSON.parse(d); } catch { return null; }
  })();
  if (!det) return <span>Sem detalhe de calculo para este CT-e.</span>;

  const frete = det.componentes_base || {};
  const taxas = det.taxas || {};
  const totalTaxas = Number.isFinite(Number(frete.totalTaxas)) ? Number(frete.totalTaxas) : somaValoresObjeto(taxas);
  const taxaExtraDetalhes = Array.isArray(taxas.taxasExtrasDetalhes) ? taxas.taxasExtrasDetalhes : [];

  return (
    <>
      {resultado.motivo_sem_calculo ? <div style={{ color: '#b45309', marginBottom: 6 }}><strong>Motivo:</strong> {resultado.motivo_sem_calculo}</div> : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginTop: 12 }}>
        <div style={{ border: '1px solid #dbe3ef', borderRadius: 8, background: '#fff', padding: 12 }}>
          <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>Resumo do calculo</div>
          {linhaDetalhe('Motor', det.motor === 'simulador_realizado' ? 'Simulador realizado' : 'Auditoria')}
          {linhaDetalhe('Tipo', resultado.tipo_calculo || det.tipo_calculo || frete.tipoCalculo || '-')}
          {linhaDetalhe('Tabela usada', resultado.transportadora_tabela || det.transportadora_tabela || '-')}
          {linhaDetalhe('Origem tabela', det.origem_cidade || '-')}
          {det.calculo_devolucao_invertida ? linhaDetalhe('Regra devolucao', det.observacao_devolucao || 'Calculado pela rota de ida equivalente.', true) : null}
          {linhaDetalhe('Rota/cotacao', det.rota_nome || '-')}
          {linhaDetalhe('Peso considerado', `${numeroFmt(det.peso_considerado ?? frete.pesoConsiderado ?? resultado.peso, 3)} kg`)}
          {linhaDetalhe('Valor NF', dinheiroMaybe(resultado.valor_nf), true)}
          {linhaDetalhe('Frete pago', dinheiroMaybe(resultado.valor_cte), true)}
          {linhaDetalhe('Calculo AMD/local', dinheiroMaybe(resultado.valor_calculado), true)}
        </div>
        <div style={{ border: '1px solid #dbe3ef', borderRadius: 8, background: '#fff', padding: 12 }}>
          <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>Base do frete</div>
          {linhaDetalhe('Percentual aplicado', pctFmt(frete.percentualAplicado))}
          {linhaDetalhe('Valor percentual', dinheiroMaybe(frete.valorPercentualCalculado ?? frete.valorPercentual))}
          {linhaDetalhe('R$/kg aplicado', dinheiroMaybe(frete.rsKgAplicado))}
          {linhaDetalhe('Valor kg garantia', dinheiroMaybe(frete.valorKgGarantia ?? frete.valorKg))}
          {linhaDetalhe('Frete minimo rota', dinheiroMaybe(frete.minimoRota))}
          {linhaDetalhe('Frete minimo cotacao', dinheiroMaybe(frete.freteMinimoCotacao ?? frete.minimoCotacao))}
          {linhaDetalhe('Frete minimo geral', dinheiroMaybe(frete.freteMinimoGeneralidade ?? frete.minimoGeneralidade))}
          {linhaDetalhe('Minimo aplicavel', dinheiroMaybe(frete.minimoAplicavel))}
          {linhaDetalhe('Componente vencedor', frete.componenteBase || det.componente_base || '-', true)}
          {linhaDetalhe('Valor base', dinheiroMaybe(det.valor_base ?? frete.valorBase), true)}
        </div>
        <div style={{ border: '1px solid #dbe3ef', borderRadius: 8, background: '#fff', padding: 12 }}>
          <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>ICMS e totalizacao</div>
          {linhaDetalhe('Subtotal antes da emergencial', dinheiroMaybe(frete.subtotalSemEmergencial))}
          {Number(frete.taxaEmergencialPct) > 0 ? linhaDetalhe('Taxa emergencial', `${pctFmt(frete.taxaEmergencialPct)} = ${dinheiroMaybe(frete.valorEmergencial)}`, true) : null}
          {linhaDetalhe('Subtotal sem ICMS', dinheiroMaybe(det.subtotal ?? frete.subtotal), true)}
          {linhaDetalhe('Aliquota ICMS', pctFmt(det.aliquota_icms ?? frete.aliquotaIcms))}
          {linhaDetalhe('Origem aliquota', det.origem_aliquota_icms || frete.origemAliquotaIcms || '-')}
          {linhaDetalhe('UF origem/destino', `${det.uf_origem_icms || frete.ufOrigem || '-'} -> ${det.uf_destino_icms || frete.ufDestino || '-'}`)}
          {linhaDetalhe('ICMS', dinheiroMaybe(det.icms ?? frete.icms), true)}
          {linhaDetalhe('Total calculado', dinheiroMaybe(resultado.valor_calculado), true)}
          {linhaDetalhe('Diferenca vs pago', dinheiroMaybe(resultado.diferenca), true)}
        </div>
        <div style={{ border: '1px solid #dbe3ef', borderRadius: 8, background: '#fff', padding: 12 }}>
          <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>Taxas</div>
          {linhaDetalhe('Ad Valorem', dinheiroMaybe(taxas.adValorem))}
          {linhaDetalhe('GRIS', dinheiroMaybe(taxas.gris))}
          {linhaDetalhe('Pedagio', dinheiroMaybe(taxas.pedagio))}
          {linhaDetalhe('TAS', dinheiroMaybe(taxas.tas))}
          {linhaDetalhe('CTRC', dinheiroMaybe(taxas.ctrc))}
          {linhaDetalhe('TDA', dinheiroMaybe(taxas.tda))}
          {linhaDetalhe('TDE', dinheiroMaybe(taxas.tde))}
          {linhaDetalhe('TDR', dinheiroMaybe(taxas.tdr))}
          {linhaDetalhe('TRT', dinheiroMaybe(taxas.trt))}
          {linhaDetalhe('Suframa', dinheiroMaybe(taxas.suframa))}
          {linhaDetalhe('Outras', dinheiroMaybe(taxas.outras))}
          {linhaDetalhe('Taxa extra', dinheiroMaybe(taxas.taxaExtra))}
          {taxaExtraDetalhes.map((taxa, i) => linhaDetalhe(taxa.nome || `Extra ${i + 1}`, dinheiroMaybe(taxa.valor)))}
          {linhaDetalhe('Total taxas', dinheiroMaybe(totalTaxas), true)}
        </div>
      </div>
    </>
  );
}

function dataBr(valor) {
  if (!valor) return '-';
  const [ano, mes, dia] = String(valor).slice(0, 10).split('-');
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : valor;
}

function nomeStatus(status = '') {
  return String(status).replaceAll('_', ' ');
}

// Fatura 100% auditada: todos os CT-es vinculados já passaram pelo cálculo
// (auditados >= totais, com pelo menos 1 CT-e). Não exige "sem divergência" —
// só que o resultado já é definitivo, não tem mais nada pendente de cálculo.
function faturaTotalmenteAuditada(fatura) {
  const totais = Number(fatura.ctes_totais || 0);
  const auditados = Number(fatura.ctes_auditados || 0);
  return totais > 0 && auditados >= totais;
}

function corAlerta(fatura) {
  const faixa = faixaVencimento(fatura);
  if (faixa === 'VENCIDA') return '#9b1111';
  if (faixa === 'CRITICO') return '#cf2f2f';
  if (faixa === 'LARANJA') return '#e67e22';
  if (faixa === 'AMARELO' || faixa === 'VENCENDO_7_DIAS') return '#b78700';
  return '#04a484';
}

function Card({ label, value, detail, color = '#9153F0' }) {
  return (
    <div className="summary-card audit-kpi" style={{ borderLeft: `4px solid ${color}` }}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function Status({ value }) {
  return <span className={`status-pill audit-status audit-status-${String(value || '').toLowerCase()}`}>{nomeStatus(value || '-')}</span>;
}

function Dashboard({ state }) {
  const resumo = useMemo(() => calcularDashboard(state.faturas), [state.faturas]);
  const boletosSemArquivo = state.boletos.filter((item) => ['PENDENTE', 'SEM_BOLETO'].includes(item.status)).length;
  const solicitacoesForaSla = state.solicitacoes.filter((item) => statusSla(item) === 'FORA_SLA').length;

  return (
    <>
      <div className="audit-section-title">Faturas</div>
      <div className="summary-strip audit-summary-grid">
        <Card label="Recebidas" value={resumo.recebidas} />
        <Card label="Em auditoria" value={resumo.emAuditoria} color="#315ee7" />
        <Card label="Aguardando transportadora" value={resumo.aguardandoTransportadora} color="#e67e22" />
        <Card label="Aguardando nova fatura" value={resumo.aguardandoNovaFatura} color="#b78700" />
        <Card label="Prontas para pagamento" value={resumo.prontas} color="#04a484" />
        <Card label="Enviadas ao financeiro" value={resumo.enviadas} color="#315ee7" />
        <Card label="Pagas" value={resumo.pagas} color="#14733b" />
        <Card label="Vencidas" value={resumo.vencidas} color="#9b1111" />
        <Card label="Vencendo em 3 dias" value={resumo.vencendo3} color="#e67e22" />
        <Card label="Vencendo em 7 dias" value={resumo.vencendo7} color="#b78700" />
      </div>

      <div className="audit-section-title">Financeiro</div>
      <div className="summary-strip audit-summary-grid">
        <Card label="Valor auditado" value={dinheiro(resumo.valorAuditado)} />
        <Card label="Valor divergente" value={dinheiro(resumo.valorDivergente)} color="#9b1111" />
        <Card label="Valor recuperado" value={dinheiro(resumo.valorRecuperado)} color="#04a484" />
        <Card label="Aguardando retorno" value={dinheiro(resumo.valorAguardando)} color="#e67e22" />
        <Card label="Pronto para pagamento" value={dinheiro(resumo.valorPronto)} color="#04a484" />
        <Card label="Enviado ao financeiro" value={dinheiro(resumo.valorEnviado)} color="#315ee7" />
        <Card label="Valor pago" value={dinheiro(resumo.valorPago)} color="#14733b" />
        <Card label="Sem boleto" value={boletosSemArquivo} color="#9b1111" />
        <Card label="Solicitacoes fora SLA" value={solicitacoesForaSla} color="#9b1111" />
      </div>

      <div className="audit-section-title">Operacao da auditoria</div>
      <div className="summary-strip audit-summary-grid">
        <Card label="CT-es auditados" value={resumo.ctesAuditados} />
        <Card label="CT-es divergentes" value={resumo.ctesDivergentes} color="#9b1111" />
        <Card label="CT-es sem calculo" value={resumo.ctesSemCalculo} color="#e67e22" />
        <Card label="CT-es sem tabela" value={resumo.ctesSemTabela} color="#b78700" />
      </div>
    </>
  );
}

function FaturaDetalhe({ state, fatura, onClose, onState }) {
  const sessao = carregarSessao();
  const detalheRef = useRef(null);
  const [tab, setTab] = useState('resumo');
  const [selecionados, setSelecionados] = useState([]);
  const [carregandoDetalhes, setCarregandoDetalhes] = useState(false);
  const [erroDetalhes, setErroDetalhes] = useState('');
  const [novaFaturaId, setNovaFaturaId] = useState('');
  const [reauditando, setReauditando] = useState(false);
  const [recalculando, setRecalculando] = useState(false);
  const [infoRecalculo, setInfoRecalculo] = useState('');
  const [progressoRecalculo, setProgressoRecalculo] = useState(null);
  const [referenciaCtes, setReferenciaCtes] = useState(new Map());
  const [cteExpandido, setCteExpandido] = useState(null);
  const [resultadosDetalhe, setResultadosDetalhe] = useState(new Map());
  const [carregandoDetalheCte, setCarregandoDetalheCte] = useState(null);
  const detalhes = state.detalhes[fatura.id] || [];
  const divergencias = detalhes.filter((item) => Number(item.diferenca || 0) !== 0 || item.status === 'DIVERGENTE');
  const semCalculo = detalhes.filter((item) => !Number(item.calculado_frete || 0));
  const tratativas = state.tratativas.filter((item) => item.fatura_id === fatura.id || item.fatura === fatura.numero_fatura);
  const historico = state.historico.filter((item) => item.fatura_id === fatura.id);
  const faturaSubstituta = fatura.substituida_por_id
    ? state.faturas.find((item) => item.id === fatura.substituida_por_id)
    : null;
  const faturaOriginal = state.faturas.find((item) => item.substituida_por_id === fatura.id);
  const candidatasSubstituta = state.faturas.filter((item) =>
    item.id !== fatura.id
    && item.transportadora === fatura.transportadora
    && !['SUBSTITUIDA', 'CANCELADA'].includes(item.status));

  useEffect(() => {
    // O detalhe substitui a lista como uma tela propria; garante que abre no topo.
    detalheRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }, [fatura.id]);

  useEffect(() => {
    let ativo = true;
    setCarregandoDetalhes(true);
    setErroDetalhes('');
    carregarDetalhesFaturaSupabase(fatura.id)
      .then(async (lista) => {
        if (!ativo) return;
        onState((atual) => ({ ...atual, detalhes: { ...atual.detalhes, [fatura.id]: lista || [] } }));
        // Cruza com a base auditada para exibir rota, peso, canal e valores de referencia.
        const referencia = await buscarReferenciaCtes((lista || []).map((item) => item.chave_cte));
        if (ativo) setReferenciaCtes(referencia);
      })
      .catch((error) => {
        if (ativo) setErroDetalhes(error.message || String(error));
      })
      .finally(() => {
        if (ativo) setCarregandoDetalhes(false);
      });
    return () => {
      ativo = false;
    };
  }, [fatura.id]);

  const mudarStatus = async (status) => {
    const next = await atualizarFaturaAuditoria(state, { ...fatura, status }, {
      acao: 'STATUS_ALTERADO',
      status_anterior: fatura.status,
      status_novo: status,
      descricao: `Status alterado para ${nomeStatus(status)}.`,
      usuario_nome: sessao?.nome || sessao?.email || 'Usuario local',
      usuario_email: sessao?.email || '',
    });
    onState(next);
  };

  const baixarArquivo = (blob, nomeArquivo) => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = nomeArquivo;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const exportarDoccob = async (formato) => {
    const linhas = montarLinhasDoccob(fatura, detalhes, selecionados);
    if (!linhas.length) return;
    const nome = montarNomeDoccob(fatura);
    if (formato === 'EDI') {
      // Layout PROCEDA 3.0A (registros fixos de 170 posicoes) para importacao no Verum.
      const conteudo = montarArquivoDoccobEdi(fatura, detalhes, selecionados);
      baixarArquivo(new Blob([conteudo], { type: 'text/plain;charset=utf-8' }), `${nome}.txt`);
      const next = await registrarDoccob(state, {
        fatura_id: fatura.id,
        nome_arquivo: `${nome}.txt`,
        formato: 'EDI',
        cte_ids: selecionados,
        quantidade_ctes: linhas.length,
        valor_total: linhas.reduce((total, item) => total + Number(item.Valor || 0), 0),
        gerado_por_nome: sessao?.nome || sessao?.email || 'Usuario local',
      });
      onState(next);
      return;
    }
    const ws = XLSX.utils.json_to_sheet(linhas);
    if (formato === 'CSV') {
      const csv = XLSX.utils.sheet_to_csv(ws, { FS: ';' });
      const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${nome}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } else {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'DOCCOB');
      XLSX.writeFile(wb, `${nome}.xlsx`);
    }
    const next = await registrarDoccob(state, {
      fatura_id: fatura.id,
      nome_arquivo: `${nome}.${formato.toLowerCase()}`,
      formato,
      cte_ids: selecionados,
      quantidade_ctes: linhas.length,
      valor_total: linhas.reduce((total, item) => total + Number(item.Valor || 0), 0),
      gerado_por_nome: sessao?.nome || sessao?.email || 'Usuario local',
    });
    onState(next);
  };

  const reauditar = async () => {
    setReauditando(true);
    setErroDetalhes('');
    try {
      const next = await reauditarFatura(state, fatura, detalhes, sessao?.nome || sessao?.email || 'Usuario local');
      onState(next);
    } catch (error) {
      setErroDetalhes(error.message || String(error));
    } finally {
      setReauditando(false);
    }
  };

  // Recalcula de verdade os CT-es que ainda não foram processados (motor de
  // auditoria + tabelas cadastradas), salva o resultado em
  // auditoria_cte_resultados e, na sequência, reauditar a fatura pra puxar os
  // valores recém-calculados pros detalhes e agregados da fatura.
  const recalcular = async () => {
    setRecalculando(true);
    setErroDetalhes('');
    setInfoRecalculo('');
    try {
      // Se tiver CT-e marcado no checkbox, recalcula só esses; sem marcação,
      // recalcula a fatura inteira.
      const alvo = selecionados.length
        ? detalhes.filter((item) => selecionados.includes(item.id))
        : detalhes;
      const chaves = alvo.map((item) => item.chave_cte).filter(Boolean);
      if (!chaves.length) throw new Error('Esta fatura não possui CT-es com chave para recalcular.');

      // Garante que tabelas de frete editadas/importadas ha pouco (na mesma
      // sessao do navegador) entrem no recalculo, em vez de usar cache antigo.
      invalidarCacheBaseFreteAuditoriaCte();
      const { registros, encontrados, naoEncontrados } = await processarCtesPorChave(chaves, setProgressoRecalculo);
      if (registros.length) {
        const competenciaRef = registros.find((r) => r.competencia)?.competencia || new Date().toISOString().slice(0, 7);
        await salvarRecorteCarregadoAuditoria({ competencia: competenciaRef, registros });
      }

      const next = await reauditarFatura(state, fatura, detalhes, sessao?.nome || sessao?.email || 'Usuario local');
      onState(next);
      // Refaz a referência com TODOS os CT-es da fatura (não só os recalculados
      // agora), senão perde a referência de quem ficou fora da seleção.
      const referencia = await buscarReferenciaCtes(detalhes.map((item) => item.chave_cte));
      setReferenciaCtes(referencia);
      const escopo = selecionados.length ? `${selecionados.length} CT-e(s) selecionado(s)` : 'todos os CT-es da fatura';
      setInfoRecalculo(`Recalculado ${escopo}: ${encontrados} encontrado(s) e salvo(s)${naoEncontrados ? `, ${naoEncontrados} não encontrado(s) na base de CT-es.` : '.'}`);
    } catch (error) {
      setErroDetalhes(error.message || String(error));
    } finally {
      setRecalculando(false);
      setProgressoRecalculo(null);
    }
  };

  const vincularSubstituta = async () => {
    const nova = state.faturas.find((item) => item.id === novaFaturaId);
    if (!nova) return;
    try {
      const next = await vincularNovaFatura(state, fatura, nova, sessao?.nome || sessao?.email || 'Usuario local');
      onState(next);
      setNovaFaturaId('');
      setErroDetalhes('');
    } catch (error) {
      setErroDetalhes(error.message || String(error));
    }
  };

  const selecionar = (id) => setSelecionados((lista) =>
    lista.includes(id) ? lista.filter((item) => item !== id) : [...lista, id]);

  // Busca (uma vez, com cache local) e alterna o painel de detalhe do calculo
  // de um CT-e — mesmo painel usado na Auditoria CT-e.
  const alternarDetalheCte = async (item) => {
    if (cteExpandido === item.id) {
      setCteExpandido(null);
      return;
    }
    setCteExpandido(item.id);
    if (!item.chave_cte || resultadosDetalhe.has(item.chave_cte)) return;
    setCarregandoDetalheCte(item.chave_cte);
    try {
      const resultado = await buscarResultadoAuditoriaPorChave(item.chave_cte);
      setResultadosDetalhe((atual) => new Map(atual).set(item.chave_cte, resultado));
    } catch (error) {
      setResultadosDetalhe((atual) => new Map(atual).set(item.chave_cte, null));
    } finally {
      setCarregandoDetalheCte(null);
    }
  };

  const ctesNaBase = detalhes.filter((item) => referenciaCtes.has(normalizarChaveCte(item.chave_cte))).length;

  const tabelaCtes = (lista) => (
    <div className="sim-analise-tabela-wrap">
      {detalhes.length > 0 && (
        <p className="compact">
          {ctesNaBase} de {detalhes.length} CT-e(s) encontrados na base auditada
          {ctesNaBase < detalhes.length ? ' — os demais ainda nao foram processados na Auditoria CT-e.' : '.'}
        </p>
      )}
      <table className="sim-analise-tabela">
        <thead><tr><th></th><th>CT-e</th><th>Chave</th><th>Rota (base)</th><th>Canal</th><th>Peso</th><th>Valor</th><th>Verum</th><th>Dif. Verum</th><th>AMD</th><th>Dif. AMD</th><th>Motivo</th><th>Status</th></tr></thead>
        <tbody>
          {lista.map((item) => {
            const base = referenciaCtes.get(normalizarChaveCte(item.chave_cte));
            const expandido = cteExpandido === item.id;
            return (
              <Fragment key={item.id}>
                <tr style={expandido ? { background: '#eff6ff' } : undefined}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selecionados.includes(item.id)} onChange={() => selecionar(item.id)} /></td>
                  <td style={{ cursor: 'pointer' }} onClick={() => alternarDetalheCte(item)}>{item.numero_cte || '-'}</td>
                  <td style={{ cursor: 'pointer' }} onClick={() => alternarDetalheCte(item)}><small>{item.chave_cte || '-'}</small></td>
                  <td style={{ cursor: 'pointer' }} onClick={() => alternarDetalheCte(item)}>{base ? <small>{base.cidade_origem || '?'}/{base.uf_origem || '?'} → {base.cidade_destino || '?'}/{base.uf_destino || '?'}</small> : <small className="error-text">Fora da base</small>}</td>
                  <td style={{ cursor: 'pointer' }} onClick={() => alternarDetalheCte(item)}>{base?.canal || '-'}</td>
                  <td style={{ cursor: 'pointer' }} onClick={() => alternarDetalheCte(item)}>{base?.peso ? Number(base.peso).toLocaleString('pt-BR') : '-'}</td>
                  <td style={{ cursor: 'pointer' }} onClick={() => alternarDetalheCte(item)}>{dinheiro(item.valor_frete)}</td>
                  <td style={{ cursor: 'pointer' }} onClick={() => alternarDetalheCte(item)}>{Number(item.calculado_frete_verum || 0) ? dinheiro(item.calculado_frete_verum) : 'Sem calculo'}</td>
                  <td style={{ cursor: 'pointer' }} className={Number(item.diferenca_verum || 0) ? 'negativo' : ''} onClick={() => alternarDetalheCte(item)}>{Number(item.calculado_frete_verum || 0) ? dinheiro(item.diferenca_verum) : '-'}</td>
                  <td style={{ cursor: 'pointer' }} onClick={() => alternarDetalheCte(item)}>{Number(item.calculado_frete || 0) ? dinheiro(item.calculado_frete) : 'Sem calculo'}</td>
                  <td style={{ cursor: 'pointer' }} className={Number(item.diferenca || 0) ? 'negativo' : ''} onClick={() => alternarDetalheCte(item)}>{dinheiro(item.diferenca)}</td>
                  <td style={{ cursor: 'pointer' }} onClick={() => alternarDetalheCte(item)}>{nomeStatus(item.motivo_divergencia || '-')}</td>
                  <td style={{ cursor: 'pointer' }} onClick={() => alternarDetalheCte(item)}><Status value={item.status} /></td>
                </tr>
                {expandido && (
                  <tr>
                    <td colSpan="13" style={{ background: '#f8fafc', fontSize: 12, color: '#475569' }}>
                      {carregandoDetalheCte === item.chave_cte
                        ? <span>Carregando detalhe do calculo...</span>
                        : <PainelDetalheCalculo resultado={resultadosDetalhe.get(item.chave_cte)} />}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {!lista.length && <tr><td colSpan="13">Nenhum CT-e nesta visao.</td></tr>}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="panel-card audit-detail" ref={detalheRef}>
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Fatura {fatura.numero_fatura} - {fatura.transportadora}</div>
          <p>{dataBr(fatura.data_vencimento)} | {dinheiro(fatura.valor_fatura)} | Auditor: {fatura.auditor_nome || 'SEM AUDITOR DEFINIDO'}</p>
        </div>
        <button className="btn-secondary" onClick={onClose}>Fechar</button>
      </div>

      <div className="audit-flow">
        {['Recebimento', 'Reauditoria', 'Tratativas', 'DOCCOB', 'Nova fatura', 'Liberacao', 'Financeiro', 'Pagamento'].map((item) => <span key={item}>{item}</span>)}
      </div>

      <div className="tabs-row">
        {[
          ['resumo', 'Resumo'], ['ctes', `CT-es (${detalhes.length})`], ['divergencias', `Divergencias (${divergencias.length})`],
          ['sem-calculo', `Sem calculo (${semCalculo.length})`], ['tratativas', `Tratativas (${tratativas.length})`], ['historico', 'Historico'],
        ].map(([id, label]) => <button key={id} className={`toggle-btn ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{label}</button>)}
      </div>

      {carregandoDetalhes && <div className="hint-box compact">Carregando CT-es da fatura...</div>}
      {erroDetalhes && <div className="hint-box compact error-text">Erro ao carregar CT-es: {erroDetalhes}</div>}
      {tab === 'resumo' && (
        <>
          <div className="summary-strip">
            <Card label="Valor fatura" value={dinheiro(fatura.valor_fatura)} />
            <Card label="Valor calculado" value={dinheiro(fatura.valor_calculado)} color="#04a484" />
            <Card label="Diferenca" value={dinheiro(fatura.diferenca)} color={Number(fatura.diferenca) ? '#9b1111' : '#04a484'} />
            <Card label="Quantidade CT-es" value={fatura.ctes_totais || detalhes.length} />
          </div>
          <div className="form-grid three">
            <label className="field">Status
              <select value={fatura.status} onChange={(event) => mudarStatus(event.target.value)}>
                {FATURA_STATUS.map((status) => <option key={status}>{status}</option>)}
              </select>
            </label>
            <label className="field">Vencimento<input value={dataBr(fatura.data_vencimento)} readOnly /></label>
            <label className="field">Boleto<input value={nomeStatus(fatura.boleto_status || 'PENDENTE')} readOnly /></label>
          </div>
          {faturaSubstituta && (
            <div className="hint-box compact">
              Fatura substituida pela nova fatura <strong>{faturaSubstituta.numero_fatura}</strong> ({dinheiro(faturaSubstituta.valor_fatura)}, vencimento {dataBr(faturaSubstituta.data_vencimento)}).
            </div>
          )}
          {faturaOriginal && (
            <div className="hint-box compact">
              Esta e a nova fatura que substitui a fatura original <strong>{faturaOriginal.numero_fatura}</strong> ({dinheiro(faturaOriginal.valor_fatura)}).
            </div>
          )}
          {!faturaSubstituta && (
            <div className="form-grid three">
              <label className="field">Nova fatura (substituta)
                <select value={novaFaturaId} onChange={(event) => setNovaFaturaId(event.target.value)}>
                  <option value="">Selecione a fatura ja importada</option>
                  {candidatasSubstituta.map((item) => (
                    <option key={item.id} value={item.id}>{item.numero_fatura} - {dinheiro(item.valor_fatura)} - venc. {dataBr(item.data_vencimento)}</option>
                  ))}
                </select>
              </label>
              <div className="audit-form-actions">
                <button className="btn-secondary" disabled={!novaFaturaId} onClick={vincularSubstituta}>Vincular nova fatura</button>
              </div>
              <p className="compact">Importe a nova fatura pela aba Faturas e vincule aqui: a original passa a SUBSTITUIDA e as duas guardam o vinculo no historico.</p>
            </div>
          )}
        </>
      )}
      {tab === 'ctes' && tabelaCtes(detalhes)}
      {tab === 'divergencias' && tabelaCtes(divergencias)}
      {tab === 'sem-calculo' && tabelaCtes(semCalculo)}
      {tab === 'tratativas' && (
        <div className="audit-timeline">
          {tratativas.map((item) => <div key={item.id}><strong>{item.protocolo || 'Tratativa'}</strong><span>{item.descricao}</span><Status value={item.status} /></div>)}
          {!tratativas.length && <div>Nenhuma tratativa vinculada.</div>}
        </div>
      )}
      {tab === 'historico' && (
        <div className="audit-timeline">
          {historico.map((item) => <div key={item.id}><strong>{nomeStatus(item.acao)}</strong><span>{item.descricao}</span><small>{item.usuario_nome || 'Sistema'} | {new Date(item.created_at).toLocaleString('pt-BR')}</small></div>)}
          {!historico.length && <div>Nenhum evento registrado.</div>}
        </div>
      )}

      <AmdProcessingOverlay ativo={recalculando} progresso={progressoRecalculo} mensagemRodape="Pode levar mais tempo em faturas com muitos CT-es." />
      {infoRecalculo && <div className="hint-box compact">{infoRecalculo}</div>}
      <div className="audit-action-bar">
        <span>{selecionados.length} CT-e(s) selecionado(s)</span>
        <button className="btn-primary" disabled={recalculando || reauditando || carregandoDetalhes || !detalhes.length} onClick={recalcular} title={selecionados.length ? 'Recalcula só os CT-es selecionados' : 'Recalcula todos os CT-es da fatura'}>
          {recalculando ? 'Recalculando...' : selecionados.length ? `Recalcular selecionados (${selecionados.length})` : 'Recalcular CT-es'}
        </button>
        <button className="btn-secondary" disabled={reauditando || recalculando || carregandoDetalhes || !detalhes.length} onClick={reauditar} title="Só cruza com o que já está calculado em auditoria_cte_resultados, sem recalcular">
          {reauditando ? 'Reauditando...' : 'Reauditar CT-es'}
        </button>
        <button
          className="btn-secondary"
          onClick={() => { invalidarCacheBaseFreteAuditoriaCte(); setInfoRecalculo('Tabelas de frete atualizadas — o próximo recálculo já usa a versão mais recente.'); }}
          title="Se você ajustou uma tabela de frete agora, clique aqui antes de recalcular para garantir que a mudança seja usada"
        >
          ↻ Atualizar tabela
        </button>
        <button className="btn-secondary" disabled={!selecionados.length} onClick={() => exportarDoccob('EDI')}>Gerar DOCCOB EDI (Verum)</button>
        <button className="btn-secondary" disabled={!selecionados.length} onClick={() => exportarDoccob('CSV')}>Gerar DOCCOB CSV</button>
        <button className="btn-secondary" disabled={!selecionados.length} onClick={() => exportarDoccob('XLSX')}>Gerar DOCCOB XLSX</button>
        <button className="btn-secondary" onClick={() => mudarStatus('AGUARDANDO_NOVA_FATURA')}>Solicitar nova fatura</button>
        <button className="btn-primary" onClick={() => mudarStatus('PRONTA_PARA_PAGAMENTO')}>Liberar para pagamento</button>
      </div>
    </div>
  );
}

function Faturas({ state, onState }) {
  const sessao = carregarSessao();
  const arquivoRef = useRef(null);
  const [filtro, setFiltro] = useState('');
  const [status, setStatus] = useState('');
  const [canalFiltro, setCanalFiltro] = useState('');
  const [somenteAuditadas, setSomenteAuditadas] = useState(false);
  const [detectandoCanais, setDetectandoCanais] = useState(false);
  const [progressoCanais, setProgressoCanais] = useState(null);
  const [progressoImportacao, setProgressoImportacao] = useState(null);
  const [aberta, setAberta] = useState(null);
  const [importando, setImportando] = useState(false);
  const [mensagemImportacao, setMensagemImportacao] = useState('');
  const [selecionadasIds, setSelecionadasIds] = useState([]);
  const [recalculandoLote, setRecalculandoLote] = useState(false);
  const [progressoLote, setProgressoLote] = useState(null);
  const [competenciaFiltro, setCompetenciaFiltro] = useState('');
  const [periodoInicio, setPeriodoInicio] = useState('');
  const [periodoFim, setPeriodoFim] = useState('');
  const [vencimentoInicio, setVencimentoInicio] = useState('');
  const [vencimentoFim, setVencimentoFim] = useState('');
  const [buscaCtesAvulsa, setBuscaCtesAvulsa] = useState('');
  const [auditandoCtesAvulsos, setAuditandoCtesAvulsos] = useState(false);
  const [progressoCtesAvulsos, setProgressoCtesAvulsos] = useState(null);
  const [resultadoCtesAvulsos, setResultadoCtesAvulsos] = useState([]);
  const [cteAvulsoExpandido, setCteAvulsoExpandido] = useState(null);
  const [resultadoCtesAvulsosSalvos, setResultadoCtesAvulsosSalvos] = useState(false);
  const canaisDisponiveis = [...new Set(state.faturas.map((item) => item.canal).filter(Boolean))].sort();
  // Competencia = mes/ano da emissao (nao existe campo proprio na fatura).
  const competenciasDisponiveis = [...new Set(
    state.faturas.map((item) => (item.data_emissao || '').slice(0, 7)).filter(Boolean)
  )].sort().reverse();
  const resumoDatas = useMemo(() => {
    const maisRecente = (campo) => state.faturas.reduce((max, item) => {
      const valor = item[campo];
      if (!valor) return max;
      const data = new Date(valor);
      if (Number.isNaN(data.getTime())) return max;
      return !max || data > max ? data : max;
    }, null);
    return {
      ultimaAtualizacao: maisRecente('updated_at'),
      ultimaImportacao: maisRecente('importado_em'),
      ultimaEmissao: maisRecente('data_emissao'),
      ultimoVencimento: maisRecente('data_vencimento'),
    };
  }, [state.faturas]);
  const dataHora = (data) => data ? data.toLocaleString('pt-BR') : '—';
  const lista = state.faturas
    .filter((fatura) => {
      const texto = `${fatura.numero_fatura} ${fatura.transportadora} ${fatura.auditor_nome}`.toLowerCase();
      const emissao = fatura.data_emissao || '';
      const vencimento = fatura.data_vencimento || '';
      return (!filtro || texto.includes(filtro.toLowerCase()))
        && (!status || fatura.status === status)
        && (!canalFiltro || fatura.canal === canalFiltro)
        && (!somenteAuditadas || faturaTotalmenteAuditada(fatura))
        && (!competenciaFiltro || emissao.slice(0, 7) === competenciaFiltro)
        && (!periodoInicio || (emissao && emissao.slice(0, 10) >= periodoInicio))
        && (!periodoFim || (emissao && emissao.slice(0, 10) <= periodoFim))
        && (!vencimentoInicio || (vencimento && vencimento.slice(0, 10) >= vencimentoInicio))
        && (!vencimentoFim || (vencimento && vencimento.slice(0, 10) <= vencimentoFim));
    })
    // Faturas 100% auditadas ficam em evidência, no topo da lista.
    .sort((a, b) => Number(faturaTotalmenteAuditada(b)) - Number(faturaTotalmenteAuditada(a)));

  const localizarFaturasPorChaves = async (chaves = [], numeros = []) => {
    const alvo = new Set(chaves.map(normalizarChaveCte).filter(Boolean));
    const numerosAlvo = new Set(numeros.map((item) => String(item || '').replace(/\D/g, '')).filter(Boolean));
    if (!alvo.size && !numerosAlvo.size) return [];
    const faturasAfetadas = [];
    for (const fatura of state.faturas || []) {
      let detalhes = state.detalhes?.[fatura.id] || [];
      if (!detalhes.length) {
        try {
          detalhes = await carregarDetalhesFaturaSupabase(fatura.id);
        } catch {
          detalhes = [];
        }
      }
      if (detalhes.some((item) => (
        alvo.has(normalizarChaveCte(item.chave_cte))
        || numerosAlvo.has(String(item.numero_cte || '').replace(/\D/g, ''))
      ))) {
        faturasAfetadas.push({ fatura, detalhes });
      }
    }
    return faturasAfetadas;
  };

  const salvarAuditoriaAvulsa = async (registrosParam = resultadoCtesAvulsos) => {
    const registros = (registrosParam || []).filter((row) => row?.chave_cte || row?.numero_cte);
    if (!registros.length) {
      setMensagemImportacao('Nenhum CT-e calculado para salvar.');
      return;
    }
    setAuditandoCtesAvulsos(true);
    setProgressoCtesAvulsos(null);
    try {
      const competenciaRef = registros.find((r) => r.competencia)?.competencia || new Date().toISOString().slice(0, 7);
      await salvarRecorteCarregadoAuditoria({ competencia: competenciaRef, registros, onProgress: setProgressoCtesAvulsos });

      const faturasAfetadas = await localizarFaturasPorChaves(registros.map((row) => row.chave_cte), registros.map((row) => row.numero_cte));
      let atualizado = state;
      for (let i = 0; i < faturasAfetadas.length; i += 1) {
        const { fatura, detalhes } = faturasAfetadas[i];
        setProgressoCtesAvulsos({ etapa: 'atualizando_faturas', carregados: i + 1, total: faturasAfetadas.length });
        const faturaAtual = atualizado.faturas.find((item) => item.id === fatura.id) || fatura;
        atualizado = await reauditarFatura(atualizado, faturaAtual, detalhes, sessao?.nome || sessao?.email || 'Usuario local');
      }
      if (faturasAfetadas.length) onState(atualizado);
      setResultadoCtesAvulsosSalvos(true);
      setMensagemImportacao(`Auditoria salva: ${registros.length} CT-e(s) gravado(s)${faturasAfetadas.length ? ` e ${faturasAfetadas.length} fatura(s) atualizada(s).` : '.'}`);
    } catch (error) {
      setMensagemImportacao(`Erro ao salvar auditoria avulsa: ${error.message}`);
    } finally {
      setAuditandoCtesAvulsos(false);
      setProgressoCtesAvulsos(null);
    }
  };

  const detectarCanais = async () => {
    setDetectandoCanais(true);
    setProgressoCanais(null);
    try {
      const { state: next, atualizadas } = await detectarCanaisFaturas(state, setProgressoCanais);
      onState(next);
      setMensagemImportacao(`Canal detectado para ${atualizadas.toLocaleString('pt-BR')} fatura(s).`);
    } catch (error) {
      setMensagemImportacao(`Erro ao detectar canais: ${error.message}`);
    } finally {
      setDetectandoCanais(false);
      setProgressoCanais(null);
    }
  };
  const auditarCtesAvulsos = async () => {
    const ids = extrairIdentificadoresCte(buscaCtesAvulsa);
    if (!ids.length) {
      setMensagemImportacao('Cole uma chave de CT-e ou uma lista de CT-es para auditar.');
      return;
    }
    setAuditandoCtesAvulsos(true);
    setProgressoCtesAvulsos(null);
    setResultadoCtesAvulsos([]);
    setResultadoCtesAvulsosSalvos(false);
    setCteAvulsoExpandido(null);
    setMensagemImportacao('');
    try {
      invalidarCacheBaseFreteAuditoriaCte();
      const { registros, encontrados, naoEncontrados } = await processarCtesPorChave(ids, setProgressoCtesAvulsos);
      setResultadoCtesAvulsos(registros);
      setMensagemImportacao(`Auditoria avulsa concluida: ${encontrados} CT-e(s) encontrado(s)${naoEncontrados ? `, ${naoEncontrados} nao encontrado(s)` : ''}.`);
    } catch (error) {
      setMensagemImportacao(`Erro na auditoria avulsa: ${error.message}`);
    } finally {
      setAuditandoCtesAvulsos(false);
      setProgressoCtesAvulsos(null);
    }
  };

  // Recalcula o status AMD de varias faturas selecionadas de uma vez (uso
  // tipico: selecionar todas as faturas de uma mesma transportadora que
  // acabaram de ser importadas, em vez de abrir uma por uma).
  const recalcularLote = async () => {
    const faturasSelecionadas = state.faturas.filter((item) => selecionadasIds.includes(item.id));
    if (!faturasSelecionadas.length) return;
    setRecalculandoLote(true);
    setProgressoLote(null);
    setMensagemImportacao('');
    try {
      const detalhesPorFatura = new Map();
      for (let i = 0; i < faturasSelecionadas.length; i += 1) {
        const fatura = faturasSelecionadas[i];
        setProgressoLote({ etapa: 'buscando_ctes', carregados: i + 1, total: faturasSelecionadas.length });
        const detalhes = await carregarDetalhesFaturaSupabase(fatura.id);
        if (detalhes.length) detalhesPorFatura.set(fatura.id, detalhes);
      }

      const todasChaves = [...detalhesPorFatura.values()].flat().map((item) => item.chave_cte).filter(Boolean);
      if (!todasChaves.length) {
        setMensagemImportacao('Nenhum CT-e encontrado nas faturas selecionadas.');
        return;
      }

      // Garante que tabelas de frete editadas/importadas ha pouco (na mesma
      // sessao do navegador) entrem no recalculo, em vez de usar cache antigo.
      invalidarCacheBaseFreteAuditoriaCte();
      const { registros } = await processarCtesPorChave(todasChaves, setProgressoLote);
      let amdCalculados = 0;
      if (registros.length) {
        const competenciaRef = registros.find((r) => r.competencia)?.competencia || new Date().toISOString().slice(0, 7);
        await salvarRecorteCarregadoAuditoria({ competencia: competenciaRef, registros });
        amdCalculados = registros.length;
      }

      let atualizado = state;
      let faturasAtualizadas = 0;
      for (const [faturaId, detalhesFat] of detalhesPorFatura.entries()) {
        faturasAtualizadas += 1;
        setProgressoLote({ etapa: 'atualizando_faturas', carregados: faturasAtualizadas, total: detalhesPorFatura.size });
        const faturaObj = atualizado.faturas.find((item) => item.id === faturaId);
        if (!faturaObj) continue;
        atualizado = await reauditarFatura(atualizado, faturaObj, detalhesFat, sessao?.nome || sessao?.email || 'Usuario local');
      }
      onState(atualizado);
      setMensagemImportacao(`Recalculo concluido: ${amdCalculados} CT-e(s) com status AMD calculado em ${faturasAtualizadas} fatura(s).`);
      setSelecionadasIds([]);
    } catch (error) {
      setMensagemImportacao(`Erro ao recalcular em lote: ${error.message}`);
    } finally {
      setRecalculandoLote(false);
      setProgressoLote(null);
    }
  };

  const alternarSelecao = (id) => {
    setSelecionadasIds((atual) => (atual.includes(id) ? atual.filter((item) => item !== id) : [...atual, id]));
  };

  const faturaAtual = aberta ? state.faturas.find((item) => item.id === aberta.id) : null;

  // Detalhe abre como tela propria no lugar da lista; ao fechar, a lista volta
  // com busca e filtros preservados (o componente continua montado).
  if (faturaAtual) {
    return <FaturaDetalhe state={state} fatura={faturaAtual} onClose={() => setAberta(null)} onState={onState} />;
  }

  const importarFaturas = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    setImportando(true);
    setMensagemImportacao('Lendo arquivo Verum...');
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
      const nomeFaturas = workbook.SheetNames.find((nome) => nome.toLowerCase().includes('fatura')) || workbook.SheetNames[0];
      const nomeDetalhes = workbook.SheetNames.find((nome) => nome.toLowerCase().includes('detalhe')) || workbook.SheetNames[1];
      if (!nomeFaturas) throw new Error('Aba de faturas nao encontrada.');
      const rowsFaturas = XLSX.utils.sheet_to_json(workbook.Sheets[nomeFaturas], { defval: '' });
      const rowsDetalhes = nomeDetalhes
        ? XLSX.utils.sheet_to_json(workbook.Sheets[nomeDetalhes], { defval: '' })
        : [];
      const analise = analisarLayoutVerum(rowsFaturas, rowsDetalhes);
      if (!analise.faturasValidas) {
        throw new Error('Nenhuma fatura valida. Verifique Transportadora e Numero Fatura.');
      }
      setMensagemImportacao(
        `Arquivo lido: ${analise.faturasValidas} fatura(s) e ${analise.detalhesReconhecidos} CT-e(s) reconhecido(s). Gravando...`,
      );

      const grupos = agruparDetalhesVerum(rowsDetalhes);

      // Busca direto no banco (não no state.faturas, que só carrega as 1000
      // mais recentes) quem já existe entre os números deste arquivo, pra
      // reimportação atualizar em vez de duplicar.
      setMensagemImportacao('Verificando faturas já existentes no banco...');
      setProgressoImportacao({ etapa: 'verificando_existentes', carregados: 0, total: null });
      const existentesPorChave = await buscarFaturasExistentesPorNumero(
        rowsFaturas.map((row) => parseFaturaVerum(row).numero_fatura),
      );

      let faturasSalvas = 0;
      let detalhesSalvos = 0;
      let processadas = 0;
      const detalhesPorFaturaImportada = new Map();

      // Grava varias faturas em paralelo (pool com limite) em vez de uma por
      // vez: cada fatura eh uma ida ao banco (gravar + limpar + gravar CT-es),
      // sequencial era muito lento em arquivos grandes. Duplicatas da MESMA
      // fatura dentro do arquivo sao serializadas por chave pra nao criar
      // duas linhas em paralelo pra ela.
      const emAndamentoPorChave = new Map();
      async function processarFaturaRow(row) {
        const fatura = parseFaturaVerum(row);
        if (!fatura.numero_fatura || !fatura.transportadora) return;
        // Reimportacao atualiza a fatura existente em vez de duplicar:
        // reaproveita o id quando numero+serie+transportadora ja existem.
        const chaveExistente = `${chaveFatura(fatura.numero_fatura, fatura.serie_fatura)}::${String(fatura.transportadora || '').trim().toUpperCase()}`;
        const anterior = emAndamentoPorChave.get(chaveExistente);
        const execucao = (async () => {
          if (anterior) await anterior.catch(() => {});
          const existenteId = existentesPorChave.get(chaveExistente);
          const resultado = await salvarFaturaSupabase({
            ...(existenteId ? { id: existenteId } : {}),
            ...fatura,
            importado_por: sessao?.nome || sessao?.email || '',
            importado_em: new Date().toISOString(),
          });
          if (!resultado?.ok || !resultado.id) return;
          faturasSalvas += 1;
          existentesPorChave.set(chaveExistente, resultado.id);
          const detalhes = detalhesDaFatura(grupos, fatura.numero_fatura, fatura.serie_fatura)
            .map((item) => parseDetalheFaturaVerum(item, resultado.id, fatura));
          if (detalhes.length) {
            // Reimportacao: limpa os CT-es antigos da fatura para nao duplicar.
            if (existenteId) await limparDetalhesFaturaSupabase(existenteId);
            await salvarDetalhesFaturaSupabase(detalhes);
            detalhesSalvos += detalhes.length;
            detalhesPorFaturaImportada.set(resultado.id, detalhes);
          }
        })();
        emAndamentoPorChave.set(chaveExistente, execucao);
        await execucao;
        processadas += 1;
        setProgressoImportacao({ etapa: 'salvando_faturas', carregados: processadas, total: rowsFaturas.length });
        if (processadas % 5 === 0 || processadas === rowsFaturas.length) {
          setMensagemImportacao(
            `Processando ${processadas} de ${rowsFaturas.length} fatura(s)... `
            + `${faturasSalvas} gravada(s), ${detalhesSalvos} CT-e(s) vinculado(s).`,
          );
        }
      }

      const CONCORRENCIA_IMPORTACAO = 8;
      const fila = [...rowsFaturas];
      async function worker() {
        while (fila.length) {
          const row = fila.shift();
          await processarFaturaRow(row);
        }
      }
      await Promise.all(Array.from({ length: CONCORRENCIA_IMPORTACAO }, worker));

      const atualizado = await carregarPlataformaAuditoria();
      onState(atualizado);

      // O calculo de status AMD NAO roda mais aqui: em arquivos grandes deixava
      // a importacao muito longa. Fica pra ser feito depois, fatura por fatura
      // (ou selecao de CT-es) usando o botao "Recalcular CT-es" dentro da fatura.
      const alertaVinculo = analise.detalhesNaoVinculados > 0
        ? ` ATENCAO: ${analise.detalhesNaoVinculados} CT-e(s) da aba Detalhes nao casaram com nenhuma fatura (confira Numero/Serie Fatura nas duas abas).`
        : '';
      setMensagemImportacao(
        `Importacao concluida: ${faturasSalvas} fatura(s), ${detalhesSalvos} CT-e(s) vinculado(s), `
        + `${analise.faturasIgnoradas} fatura(s) ignorada(s). `
        + `Use "Recalcular CT-es" em cada fatura para calcular o status AMD.${alertaVinculo}`,
      );
    } catch (error) {
      setMensagemImportacao(`Erro na importacao: ${error.message}`);
    } finally {
      setImportando(false);
      setProgressoImportacao(null);
    }
  };

  return (
    <>
      <div className="panel-card audit-quick-card">
        <div className="section-row compact-top audit-quick-header">
          <div>
            <div className="panel-title">Auditoria rapida de CT-e</div>
            <p>Cole uma chave ou lista de CT-es para calcular com a tabela AMD atual e salvar na auditoria.</p>
          </div>
          <div className="actions-right">
            <button className="btn-secondary audit-small-button" type="button" onClick={() => { setBuscaCtesAvulsa(''); setResultadoCtesAvulsos([]); setResultadoCtesAvulsosSalvos(false); setCteAvulsoExpandido(null); }} disabled={auditandoCtesAvulsos}>Limpar</button>
            <button className="btn-primary audit-small-button" type="button" onClick={auditarCtesAvulsos} disabled={auditandoCtesAvulsos || !extrairIdentificadoresCte(buscaCtesAvulsa).length}>
              {auditandoCtesAvulsos ? 'Auditando...' : 'Auditar CT-es'}
            </button>
            <button className="btn-secondary audit-small-button" type="button" onClick={() => salvarAuditoriaAvulsa()} disabled={auditandoCtesAvulsos || !resultadoCtesAvulsos.length || resultadoCtesAvulsosSalvos}>
              {resultadoCtesAvulsosSalvos ? 'Auditoria salva' : 'Salvar auditoria'}
            </button>
          </div>
        </div>

        <div className="audit-quick-input-row">
          <label className="field audit-quick-field">Chave ou lista de CT-es
            <textarea value={buscaCtesAvulsa} onChange={(e) => setBuscaCtesAvulsa(e.target.value)} rows={4} placeholder="Cole uma chave de 44 digitos ou varios CT-es, um por linha" />
          </label>
          <div className="audit-quick-counter">
            <strong>{extrairIdentificadoresCte(buscaCtesAvulsa).length}</strong>
            <span>identificador(es) reconhecido(s)</span>
          </div>
        </div>

        <AmdProcessingOverlay ativo={auditandoCtesAvulsos} progresso={progressoCtesAvulsos} mensagemRodape="Calculando CT-es avulsos com a tabela AMD atual." />

        {resultadoCtesAvulsos.length > 0 && (
          <div className="audit-quick-results">
            <div className="audit-quick-results-head">
              <strong>{resultadoCtesAvulsos.length} CT-e(s) processado(s)</strong>
              <span>{resultadoCtesAvulsosSalvos ? 'Auditoria salva e faturas relacionadas atualizadas.' : 'Revise e clique em Salvar auditoria para gravar/atualizar faturas.'}</span>
            </div>
            <div className="audit-quick-table-wrap">
              <table className="sim-analise-tabela audit-quick-table">
                <thead><tr><th>CT-e</th><th>Chave</th><th>Transportadora</th><th>Rota</th><th>Peso NF</th><th>Pago</th><th>AMD</th><th>Dif.</th><th>Status</th></tr></thead>
                <tbody>
                  {resultadoCtesAvulsos.map((row, index) => {
                    const key = row.chave_cte || row.numero_cte || index;
                    const aberto = cteAvulsoExpandido === key;
                    const linhaOk = Number(row.valor_calculado || 0) > 0 && Math.abs(Number(row.diferenca || 0)) <= 0.01;
                    const statusClass = `audit-status audit-status-${linhaOk ? 'ok' : String(row.status_calculo || row.status_auditoria || '').toLowerCase()}`;
                    return (
                      <Fragment key={key}>
                        <tr className={`${aberto ? 'selected' : ''} ${linhaOk ? 'audit-row-ok' : ''}`.trim()} role="button" tabIndex={0} onClick={() => setCteAvulsoExpandido(aberto ? null : key)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setCteAvulsoExpandido(aberto ? null : key); }}>
                          <td><strong>{row.numero_cte || '-'}</strong></td>
                          <td><span className="audit-key-cell">{row.chave_cte || '-'}</span></td>
                          <td>{row.transportadora || row.transportadora_realizada || '-'}</td>
                          <td>{row.origem || row.cidade_origem || '-'} -&gt; {row.destino || row.cidade_destino || '-'}</td>
                          <td>{numeroFmt(row.peso ?? row.peso_declarado ?? row.detalhes_calculo?.peso_considerado, 3)} kg</td>
                          <td>{dinheiroMaybe(row.valor_cte)}</td>
                          <td>{dinheiroMaybe(row.valor_calculado)}</td>
                          <td>{dinheiroMaybe(row.diferenca)}</td>
                          <td><span className={statusClass}>{row.detalhes_calculo?.calculo_devolucao_invertida ? 'Devolucao invertida' : (row.status_auditoria || row.motivo_sem_calculo || '-')}</span></td>
                        </tr>
                        {aberto && (
                          <tr className="audit-quick-detail-row"><td colSpan="9"><PainelDetalheCalculo resultado={row} /></td></tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>


      <div className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Carteira operacional de faturas</div>
            <span>{lista.length} fatura(s)</span>
            <span style={{ marginLeft: 12, color: '#64748b', fontSize: 12 }}>
              Última atualização: {dataHora(resumoDatas.ultimaAtualizacao)} · Última fatura importada: {dataHora(resumoDatas.ultimaImportacao)}
              {' · '}Emissão mais recente: {dataBr(resumoDatas.ultimaEmissao?.toISOString())} · Vencimento mais recente: {dataBr(resumoDatas.ultimoVencimento?.toISOString())}
            </span>
          </div>
          <div className="actions-right">
            <button className="btn-secondary" disabled={detectandoCanais} onClick={detectarCanais} title="Varre os CT-es já auditados e grava o canal predominante de cada fatura">
              {detectandoCanais ? `Detectando canais... ${progressoCanais?.carregados ?? ''}` : 'Detectar canais'}
            </button>
            <button className="btn-primary" disabled={importando} onClick={() => arquivoRef.current?.click()}>
              {importando ? 'Importando...' : 'Importar fatura Verum'}
            </button>
            <input ref={arquivoRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={importarFaturas} />
          </div>
        </div>
        <div className="form-grid three">
          <label className="field">Busca<input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Fatura, transportadora ou auditor" /></label>
          <label className="field">Status<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todos</option>{FATURA_STATUS.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="field">Canal<select value={canalFiltro} onChange={(e) => setCanalFiltro(e.target.value)}><option value="">Todos</option>{canaisDisponiveis.map((item) => <option key={item}>{item}</option>)}</select></label>
        </div>
        <div className="form-grid three">
          <label className="field">
            Competência (emissão)
            <select value={competenciaFiltro} onChange={(e) => setCompetenciaFiltro(e.target.value)}>
              <option value="">Todas</option>
              {competenciasDisponiveis.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="field">Emissão de<input type="date" value={periodoInicio} onChange={(e) => setPeriodoInicio(e.target.value)} /></label>
          <label className="field">Emissão até<input type="date" value={periodoFim} onChange={(e) => setPeriodoFim(e.target.value)} /></label>
        </div>
        <div className="form-grid three">
          <label className="field">Vencimento de<input type="date" value={vencimentoInicio} onChange={(e) => setVencimentoInicio(e.target.value)} /></label>
          <label className="field">Vencimento até<input type="date" value={vencimentoFim} onChange={(e) => setVencimentoFim(e.target.value)} /></label>
        </div>
        <div className="form-grid three">
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={somenteAuditadas} onChange={(e) => setSomenteAuditadas(e.target.checked)} />
            Só faturas com todos os CT-es na base (100% auditadas)
          </label>
          <label className="field">Visao<select><option>Minhas faturas</option><option>Todas as faturas</option><option>Sem auditor definido</option></select></label>
        </div>
        {!canaisDisponiveis.length && <p className="compact">Nenhuma fatura tem canal detectado ainda — clique em "Detectar canais" pra habilitar o filtro de canal.</p>}
        <AmdProcessingOverlay ativo={importando} progresso={progressoImportacao} mensagemRodape="Pode levar mais tempo em arquivos com muitas faturas/CT-es e várias transportadoras." />
        <AmdProcessingOverlay ativo={recalculandoLote} progresso={progressoLote} mensagemRodape="Pode levar mais tempo com muitas faturas/CT-es selecionados." />
        {mensagemImportacao && <div className="hint-box compact">{mensagemImportacao}</div>}
        <p className="compact">Layout esperado: abas Faturas e Detalhes, com Transportadora, Numero Fatura, Data Vencimento, Valor Fatura e Chave CTe.</p>
      </div>
      {selecionadasIds.length > 0 && (
        <div className="audit-action-bar">
          <span>{selecionadasIds.length} fatura(s) selecionada(s)</span>
          <button className="btn-primary" disabled={recalculandoLote} onClick={recalcularLote}>
            {recalculandoLote ? 'Recalculando...' : `Recalcular CT-es (${selecionadasIds.length} fatura(s))`}
          </button>
          <button className="btn-secondary" disabled={recalculandoLote} onClick={() => setSelecionadasIds([])}>Limpar selecao</button>
        </div>
      )}
      <div className="table-card">
        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead><tr><th></th><th>Fatura</th><th>Transportadora</th><th>Vencimento</th><th>Valor</th><th>CT-es</th><th>Divergencia</th><th>Auditor</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {lista.map((fatura) => {
                const auditadaCompleta = faturaTotalmenteAuditada(fatura);
                return (
                  <tr key={fatura.id} style={auditadaCompleta ? { background: '#f0fdf4', borderLeft: '3px solid #16a34a' } : undefined}>
                    <td><input type="checkbox" checked={selecionadasIds.includes(fatura.id)} onChange={() => alternarSelecao(fatura.id)} /></td>
                    <td><strong>{fatura.numero_fatura}</strong></td>
                    <td>{fatura.transportadora}</td>
                    <td style={{ color: corAlerta(fatura), fontWeight: 700 }}>{dataBr(fatura.data_vencimento)}<small className="audit-days">{diasAte(fatura.data_vencimento)} dia(s)</small></td>
                    <td>{dinheiro(fatura.valor_fatura)}</td>
                    <td>
                      {fatura.ctes_auditados || fatura.ctes_vinculados || 0}/{fatura.ctes_totais || 0}
                      {auditadaCompleta && <small style={{ display: 'block', color: '#16a34a', fontWeight: 700 }}>100% auditada</small>}
                    </td>
                    <td className={Number(fatura.diferenca) ? 'negativo' : ''}>{dinheiro(fatura.diferenca)}</td>
                    <td>{fatura.auditor_nome || <strong className="error-text">SEM AUDITOR DEFINIDO</strong>}</td>
                    <td><Status value={fatura.status} /></td>
                    <td><button className="btn-secondary audit-small-button" onClick={() => setAberta(fatura)}>Abrir</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Gestao({ state, onState }) {
  const [editando, setEditando] = useState(null);
  const [auditor, setAuditor] = useState('');
  const [email, setEmail] = useState('');
  const carteiras = state.carteiras.map((carteira) => {
    const faturas = state.faturas.filter((item) => item.transportadora === carteira.transportadora);
    return {
      ...carteira,
      quantidade: faturas.length,
      valor: faturas.reduce((total, item) => total + Number(item.valor_fatura || 0), 0),
      vencidas: faturas.filter((item) => faixaVencimento(item) === 'VENCIDA').length,
      vencendo: faturas.filter((item) => ['CRITICO', 'LARANJA', 'AMARELO', 'VENCENDO_7_DIAS'].includes(faixaVencimento(item))).length,
      aguardando: faturas.filter((item) => ['AGUARDANDO_TRANSPORTADORA', 'AGUARDANDO_NOVA_FATURA'].includes(item.status)).length,
    };
  });

  const atribuir = async () => {
    if (!editando || !auditor.trim()) return;
    let next = await salvarCarteiraAuditoria(state, { ...editando, auditor_nome: auditor.trim(), auditor_email: email.trim() });
    const relacionadas = next.faturas.filter((item) => item.transportadora === editando.transportadora);
    for (const fatura of relacionadas) {
      next = await atualizarFaturaAuditoria(next, { ...fatura, auditor_nome: auditor.trim(), auditor_email: email.trim() }, {
        acao: 'AUDITOR_ATRIBUIDO', descricao: `Carteira atribuida a ${auditor.trim()}.`, usuario_nome: carregarSessao()?.nome || 'Gestao',
      });
    }
    onState(next);
    setEditando(null);
    setAuditor('');
    setEmail('');
  };

  return (
    <>
      <div className="summary-strip">
        <Card label="Auditores ativos" value={new Set(carteiras.filter((item) => item.auditor_nome).map((item) => item.auditor_nome)).size} />
        <Card label="Transportadoras" value={carteiras.length} />
        <Card label="Sem responsavel" value={carteiras.filter((item) => !item.auditor_nome).length} color="#9b1111" />
        <Card label="Faturas vencidas" value={carteiras.reduce((total, item) => total + item.vencidas, 0)} color="#9b1111" />
      </div>
      <div className="table-card">
        <div className="panel-title audit-table-title">Distribuicao de carteiras</div>
        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead><tr><th>Auditor</th><th>Transportadora</th><th>Faturas</th><th>Valor em aberto</th><th>Vencidas</th><th>Vencendo</th><th>Aguardando retorno</th><th></th></tr></thead>
            <tbody>
              {carteiras.map((item) => (
                <tr key={item.id}>
                  <td>{item.auditor_nome || <strong className="error-text">SEM AUDITOR DEFINIDO</strong>}</td>
                  <td><strong>{item.transportadora}</strong></td><td>{item.quantidade}</td><td>{dinheiro(item.valor)}</td>
                  <td>{item.vencidas}</td><td>{item.vencendo}</td><td>{item.aguardando}</td>
                  <td><button className="btn-secondary audit-small-button" onClick={() => { setEditando(item); setAuditor(item.auditor_nome || ''); setEmail(item.auditor_email || ''); }}>Atribuir auditor</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {editando && (
        <div className="panel-card">
          <div className="panel-title">Atribuir {editando.transportadora}</div>
          <div className="form-grid three">
            <label className="field">Auditor<input value={auditor} onChange={(e) => setAuditor(e.target.value)} placeholder="Nome" /></label>
            <label className="field">E-mail<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@empresa.com" /></label>
            <div className="audit-form-actions"><button className="btn-secondary" onClick={() => setEditando(null)}>Cancelar</button><button className="btn-primary" onClick={atribuir}>Salvar distribuicao</button></div>
          </div>
        </div>
      )}
    </>
  );
}

function Financeiro({ state, onState }) {
  const sessao = carregarSessao();
  const pagamentoRef = useRef(null);
  const [subtab, setSubtab] = useState('protocolos');
  const [faturaId, setFaturaId] = useState('');
  const [canal, setCanal] = useState('VERUM_SAP');
  const [tipo, setTipo] = useState(SOLICITACAO_FINANCEIRA_TIPOS[0]);
  const [descricao, setDescricao] = useState('');
  const [buscaFinanceiro, setBuscaFinanceiro] = useState('');
  const [solicitacaoAberta, setSolicitacaoAberta] = useState(null);
  const [respostaFinanceiro, setRespostaFinanceiro] = useState('');
  const [referenciaAnexo, setReferenciaAnexo] = useState('');
  const [erroFinanceiro, setErroFinanceiro] = useState('');
  const fatura = state.faturas.find((item) => item.id === faturaId);

  const enviar = async () => {
    if (!fatura) return;
    let next = await criarProtocoloFinanceiro(state, {
      fatura_ids: [fatura.id],
      valor: Number(fatura.valor_fatura || 0),
      canal,
      lote: `${new Date().toLocaleDateString('pt-BR')} 16:00`,
      responsavel_nome: sessao?.nome || sessao?.email || 'Usuario local',
    });
    next = await atualizarFaturaAuditoria(next, { ...fatura, status: 'ENVIADA_AO_FINANCEIRO', canal_envio_financeiro: canal }, {
      acao: 'ENVIADA_AO_FINANCEIRO', status_anterior: fatura.status, status_novo: 'ENVIADA_AO_FINANCEIRO',
      descricao: `Envio realizado pelo canal ${nomeStatus(canal)}.`, usuario_nome: sessao?.nome || 'Usuario local',
    });
    onState(next);
    setFaturaId('');
  };

  const abrirSolicitacao = async () => {
    if (!descricao.trim()) return;
    const prazo = new Date();
    prazo.setDate(prazo.getDate() + 2);
    const next = await criarSolicitacaoFinanceira(state, {
      tipo,
      descricao: descricao.trim(),
      fatura_id: faturaId || null,
      prazo_sla: prazo.toISOString().slice(0, 10),
      responsavel_nome: 'Financeiro',
      aberto_por_nome: sessao?.nome || sessao?.email || 'Usuario local',
    });
    onState(next);
    setDescricao('');
  };

  const atualizarBoleto = async (boleto, status) => {
    const next = await salvarBoletoFinanceiro(state, { ...boleto, status });
    onState(next);
  };

  const atenderSolicitacao = async (status) => {
    if (!solicitacaoAberta || !respostaFinanceiro.trim()) return;
    try {
      const next = await atenderSolicitacaoFinanceira(state, solicitacaoAberta, {
        status,
        comentario: respostaFinanceiro.trim(),
        anexo_nome: referenciaAnexo.trim(),
        responsavel_id: sessao?.id || '',
        responsavel_nome: sessao?.nome || sessao?.email || 'Financeiro',
        usuario_id: sessao?.id || '',
        usuario_nome: sessao?.nome || sessao?.email || 'Financeiro',
      });
      onState(next);
      setSolicitacaoAberta(next.solicitacoes.find((item) => item.id === solicitacaoAberta.id) || null);
      setRespostaFinanceiro('');
      setReferenciaAnexo('');
      setErroFinanceiro('');
    } catch (error) {
      setErroFinanceiro(error.message || String(error));
    }
  };

  const copiarProtocolo = async (protocolo) => {
    try {
      await navigator.clipboard.writeText(protocolo);
    } catch {
      // O protocolo continua visivel para copia manual.
    }
  };

  const solicitacoesFiltradas = state.solicitacoes.filter((item) => {
    const texto = `${item.protocolo} ${item.tipo} ${item.descricao} ${item.status}`.toLowerCase();
    return !buscaFinanceiro || texto.includes(buscaFinanceiro.toLowerCase());
  });

  const importarPagamentos = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
      const normalizados = rows.map((row) => ({
        numero_fatura: String(row['Numero Fatura'] || row['Fatura'] || row['numero_fatura'] || ''),
        transportadora: String(row['Transportadora'] || row['transportadora'] || ''),
        valor_pago: Number(row['Valor Pago'] || row['Valor'] || row['valor_pago'] || 0),
        data_pagamento: row['Data Pagamento'] || row['data_pagamento'] || new Date().toISOString().slice(0, 10),
        documento_compensacao: String(row['Documento Compensacao'] || row['Documento'] || ''),
        arquivo_origem: file.name,
      }));
      const conciliados = conciliarPagamentos(state.faturas, normalizados);
      // transportadora orienta a conciliacao, mas nao é coluna de financeiro_pagamentos.
      const registros = conciliados.map(({ transportadora, ...pagamento }) => pagamento);
      let next = await salvarPagamentosFinanceiros(state, registros);
      for (const pagamento of registros.filter((item) => item.fatura_id)) {
        const fat = next.faturas.find((item) => item.id === pagamento.fatura_id);
        next = await atualizarFaturaAuditoria(next, {
          ...fat,
          status: pagamento.resultado === 'PAGO' ? 'PAGA' : 'PAGA_COM_DIVERGENCIA',
          valor_pago: pagamento.valor_pago,
          data_pagamento: pagamento.data_pagamento,
        }, {
          acao: 'PAGAMENTO_CONCILIADO', status_anterior: fat.status,
          status_novo: pagamento.resultado === 'PAGO' ? 'PAGA' : 'PAGA_COM_DIVERGENCIA',
          descricao: `Pagamento importado: ${pagamento.resultado}.`, usuario_nome: sessao?.nome || 'Usuario local',
        });
      }
      const ambiguos = registros.filter((item) => item.resultado === 'AMBIGUO').length;
      setErroFinanceiro(ambiguos
        ? `${ambiguos} pagamento(s) com numero de fatura repetido em mais de uma transportadora. Inclua a coluna Transportadora no relatorio para conciliar.`
        : '');
      onState(next);
    } catch (error) {
      setErroFinanceiro(error.message || String(error));
    }
  };

  return (
    <>
      <div className="tabs-row">
        {[
          ['protocolos', 'Protocolos'], ['solicitacoes', 'Solicitacoes e SLA'], ['boletos', 'Boletos'], ['pagamentos', 'Pagamentos'],
        ].map(([id, label]) => <button key={id} className={`toggle-btn ${subtab === id ? 'active' : ''}`} onClick={() => setSubtab(id)}>{label}</button>)}
      </div>
      {erroFinanceiro && <div className="hint-box compact error-text">{erroFinanceiro}</div>}

      {subtab === 'protocolos' && (
        <>
          <div className="panel-card">
            <div className="panel-title">Enviar para Financeiro</div>
            <div className="form-grid three">
              <label className="field">Fatura<select value={faturaId} onChange={(e) => setFaturaId(e.target.value)}><option value="">Selecione</option>{state.faturas.filter((item) => item.status === 'PRONTA_PARA_PAGAMENTO').map((item) => <option key={item.id} value={item.id}>{item.numero_fatura} - {item.transportadora} - {dinheiro(item.valor_fatura)}</option>)}</select></label>
              <label className="field">Canal<select value={canal} onChange={(e) => setCanal(e.target.value)}><option value="VERUM_SAP">Verum / SAP</option><option value="PROTOCOLO_FINANCEIRO">Protocolo Financeiro</option></select></label>
              <div className="audit-form-actions"><button className="btn-primary" disabled={!faturaId} onClick={enviar}>Gerar protocolo e enviar</button></div>
            </div>
          </div>
          <SimpleTable headers={['Protocolo', 'Canal', 'Valor', 'Lote', 'Responsavel', 'Status']} rows={state.protocolos.map((item) => [item.protocolo, nomeStatus(item.canal), dinheiro(item.valor), item.lote || '-', item.responsavel_nome || '-', <Status key="s" value={item.status} />])} />
        </>
      )}
      {subtab === 'solicitacoes' && (
        <>
          <div className="panel-card">
            <div className="panel-title">Nova solicitacao financeira</div>
            <div className="form-grid three">
              <label className="field">Tipo<select value={tipo} onChange={(e) => setTipo(e.target.value)}>{SOLICITACAO_FINANCEIRA_TIPOS.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label className="field">Fatura (opcional)<select value={faturaId} onChange={(e) => setFaturaId(e.target.value)}><option value="">Sem vinculo</option>{state.faturas.map((item) => <option key={item.id} value={item.id}>{item.numero_fatura} - {item.transportadora}</option>)}</select></label>
              <label className="field">Descricao<input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Descreva a solicitacao" /></label>
            </div>
            <div className="actions-right"><button className="btn-primary" disabled={!descricao.trim()} onClick={abrirSolicitacao}>Abrir solicitacao</button></div>
          </div>
          <div className="panel-card">
            <div className="section-row compact-top">
              <div>
                <div className="panel-title">Fila de atendimento do Financeiro</div>
                <p>Localize pelo protocolo, assuma, responda e conclua a solicitacao.</p>
              </div>
              <label className="field audit-finance-search">Buscar protocolo
                <input value={buscaFinanceiro} onChange={(e) => setBuscaFinanceiro(e.target.value)} placeholder="FIN-SLA-..." />
              </label>
            </div>
          </div>
          <div className="table-card">
            <div className="sim-analise-tabela-wrap">
              <table className="sim-analise-tabela">
                <thead><tr><th>Protocolo</th><th>Tipo</th><th>Descricao</th><th>Responsavel</th><th>Prazo</th><th>SLA</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {solicitacoesFiltradas.map((item) => (
                    <tr key={item.id}>
                      <td><button className="btn-link" onClick={() => copiarProtocolo(item.protocolo)} title="Copiar protocolo"><strong>{item.protocolo}</strong></button></td>
                      <td>{nomeStatus(item.tipo)}</td><td>{item.descricao}</td><td>{item.responsavel_nome || '-'}</td>
                      <td>{dataBr(item.prazo_sla)}</td><td><Status value={statusSla(item)} /></td><td><Status value={item.status} /></td>
                      <td><button className="btn-primary audit-small-button" onClick={() => setSolicitacaoAberta(item)}>Atender</button></td>
                    </tr>
                  ))}
                  {!solicitacoesFiltradas.length && <tr><td colSpan="8">Nenhuma solicitacao encontrada.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          {solicitacaoAberta && (
            <div className="panel-card audit-finance-attendance">
              <div className="section-row compact-top">
                <div>
                  <div className="panel-title">Atendimento {solicitacaoAberta.protocolo}</div>
                  <p>{nomeStatus(solicitacaoAberta.tipo)} | Aberta por {solicitacaoAberta.aberto_por_nome || '-'}</p>
                </div>
                <button className="btn-secondary audit-small-button" onClick={() => setSolicitacaoAberta(null)}>Fechar</button>
              </div>
              <div className="audit-finance-request">{solicitacaoAberta.descricao}</div>
              <div className="form-grid two">
                <label className="field">Resposta / providencia
                  <textarea value={respostaFinanceiro} onChange={(e) => setRespostaFinanceiro(e.target.value)} placeholder="Registre a resposta, comprovante, reversao ou ajuste realizado." />
                </label>
                <label className="field">Referencia do anexo
                  <input value={referenciaAnexo} onChange={(e) => setReferenciaAnexo(e.target.value)} placeholder="Nome do comprovante ou documento" />
                </label>
              </div>
              <div className="actions-right">
                <button className="btn-secondary" disabled={!respostaFinanceiro.trim()} onClick={() => atenderSolicitacao('EM_ATENDIMENTO')}>Salvar atendimento</button>
                <button className="btn-primary" disabled={!respostaFinanceiro.trim()} onClick={() => atenderSolicitacao('CONCLUIDA')}>Concluir solicitacao</button>
              </div>
              <div className="audit-timeline">
                {(state.solicitacaoHistorico || []).filter((item) => item.solicitacao_id === solicitacaoAberta.id).map((item) => (
                  <div key={item.id}><strong>{nomeStatus(item.acao)}</strong><span>{item.comentario || '-'}</span><small>{item.usuario_nome || 'Sistema'} | {new Date(item.created_at).toLocaleString('pt-BR')}</small></div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {subtab === 'boletos' && (
        <div className="table-card">
          <div className="sim-analise-tabela-wrap">
            <table className="sim-analise-tabela">
              <thead><tr><th>Fatura</th><th>Transportadora</th><th>Vencimento</th><th>Alerta</th><th>Status boleto</th><th>Atualizar</th></tr></thead>
              <tbody>
                {state.boletos.map((boleto) => {
                  const fat = state.faturas.find((item) => item.id === boleto.fatura_id);
                  return <tr key={boleto.id}><td>{fat?.numero_fatura || '-'}</td><td>{fat?.transportadora || '-'}</td><td>{dataBr(boleto.vencimento)}</td><td><Status value={faixaVencimento({ ...fat, data_vencimento: boleto.vencimento })} /></td><td><Status value={boleto.status} /></td><td><select value={boleto.status} onChange={(e) => atualizarBoleto(boleto, e.target.value)}>{BOLETO_STATUS.map((item) => <option key={item}>{item}</option>)}</select></td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {subtab === 'pagamentos' && (
        <>
          <div className="panel-card">
            <div className="section-row compact-top"><div><div className="panel-title">Importacao diaria de pagamentos</div><p>Layout: Numero Fatura, Valor Pago, Data Pagamento e Documento Compensacao.</p></div><button className="btn-primary" onClick={() => pagamentoRef.current?.click()}>Importar XLSX/CSV</button></div>
            <input ref={pagamentoRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={importarPagamentos} />
          </div>
          <SimpleTable headers={['Fatura', 'Valor pago', 'Data', 'Documento', 'Resultado', 'Diferenca']} rows={state.pagamentos.map((item) => [item.numero_fatura || '-', dinheiro(item.valor_pago), dataBr(item.data_pagamento), item.documento_compensacao || '-', <Status key="r" value={item.resultado} />, dinheiro(item.diferenca)])} empty="Nenhum relatorio financeiro importado." />
        </>
      )}
    </>
  );
}

function SimpleTable({ headers, rows, empty = 'Nenhum registro encontrado.' }) {
  return (
    <div className="table-card">
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead><tr>{headers.map((item) => <th key={item}>{item}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, index) => <tr key={index}>{row.map((item, cell) => <td key={cell}>{item}</td>)}</tr>)}
            {!rows.length && <tr><td colSpan={headers.length}>{empty}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CentralAuditoriaFretesPage({ initialTab = 'dashboard' }) {
  const [tab, setTab] = useState(initialTab);
  const [state, setState] = useState(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    carregarPlataformaAuditoria().then(setState).catch((error) => setErro(error.message));
  }, []);

  useEffect(() => setTab(initialTab), [initialTab]);

  const restaurar = () => setState({ ...restaurarDemonstracaoAuditoria(), modo: 'DEMONSTRACAO_LOCAL' });

  if (!state) return <div className="panel-card">{erro ? `Erro: ${erro}` : 'Carregando Plataforma de Auditoria de Fretes...'}</div>;

  return (
    <div className="page-shell audit-platform-page">
      <div className="page-header">
        <span className="amd-mini-brand">Demanda 4.40 | Unidade de trabalho: FATURA</span>
        <h1>Plataforma de Auditoria de Fretes</h1>
        <p>Auditoria, vencimentos, tratativas, DOCCOB, protocolos, SLA, boletos, pagamentos e gestao de carteiras em um unico fluxo.</p>
        <BaseCtesStatus />
      </div>
      <div className="audit-mode-banner">
        <span>Modo: <strong>{nomeStatus(state.modo)}</strong></span>
        {state.modo === 'DEMONSTRACAO_LOCAL' && <button className="btn-secondary audit-small-button" onClick={restaurar}>Restaurar dados de demonstracao</button>}
      </div>
      <div className="tabs-row audit-main-tabs">
        {TABS.map(([id, label]) => <button key={id} className={`toggle-btn ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {tab === 'dashboard' && <Dashboard state={state} />}
      {tab === 'faturas' && <Faturas state={state} onState={setState} />}
      {tab === 'gestao' && <Gestao state={state} onState={setState} />}
      {tab === 'financeiro' && <Financeiro state={state} onState={setState} />}
    </div>
  );
}
