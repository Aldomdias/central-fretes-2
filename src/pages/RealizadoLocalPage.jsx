import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { buscarBaseSimulacaoDb, buscarBaseSimulacaoPorRotasDb, carregarBaseCompletaDb, carregarTransportadoraCompletaDb } from '../services/freteDatabaseService';
import {
  buscarTabelaTransportadoraLocal,
  buscarTodasTabelasTransportadoraLocal,
  excluirTabelaTransportadoraLocal,
  extrairTransportadorasDeArquivoLocal,
  listarTabelasTransportadoraLocal,
  limparTodasTabelasTransportadoraLocal,
  montarArquivoTabelaLocal,
  montarArquivoTabelasLocais,
  salvarTabelaTransportadoraLocal,
  salvarTabelasTransportadoraLocal,
  contarEstruturaTransportadoraLocal,
  transportadoraTemTabelaUtilLocal,
} from '../services/tabelaTransportadoraLocalDb';
import { carregarMunicipiosIbgeComFallback } from '../services/ibgeService';
import {
  buscarRealizadoLocalParaSimulacao,
  buscarRealizadoLocalPorMalha,
  diagnosticarRealizadoLocal,
  exportarRealizadoLocal,
  limparRealizadoLocal,
  limparNaoTomadoresRealizadoLocal,
  salvarRealizadoLocal,
  listarRealizadoLocal,
  resumirRealizadoLocal,
} from '../services/realizadoLocalDb';
import {
  categoriaCanalRealizado,
  construirEscopoTransportadoraSimulada,
  enriquecerMunicipiosComTabelas,
  prepararRegistrosRealizadoLocal,
  simularRealizadoLocalRapido,
} from '../utils/realizadoLocalEngine';
import {
  formatCurrency,
  formatDateBr,
  formatNumber,
  formatPercent,
  regraTomadorServicoRealizadoTexto,
} from '../utils/realizadoCtes';

const DEFAULT_FILTROS = {
  competencia: '',
  inicio: '',
  fim: '',
  canal: '',
  transportadoraRealizada: '',
  excluirEbazar: true,
  ufOrigem: '',
  ufDestino: '',
  origem: '',
  destino: '',
  pesoMin: '',
  pesoMax: '',
  transportadora: '',
};

const ECONOMIA_SUPABASE_LOCAL_KEY = 'amd-realizado-local-economia-supabase';

function readPreferenciaEconomiaSupabase() {
  try {
    const raw = localStorage.getItem(ECONOMIA_SUPABASE_LOCAL_KEY);
    if (raw === null) return true;
    return raw !== 'false';
  } catch {
    return true;
  }
}

function writePreferenciaEconomiaSupabase(value) {
  try {
    localStorage.setItem(ECONOMIA_SUPABASE_LOCAL_KEY, value ? 'true' : 'false');
  } catch {
    // ignore storage errors
  }
}

function SummaryCard({ title, value, subtitle }) {
  return (
    <div className="summary-card">
      <span>{title}</span>
      <strong>{value}</strong>
      <span>{subtitle}</span>
    </div>
  );
}

function MiniTable({ title, rows = [], tipo, onSelect, activeKey }) {
  return (
    <div className="sim-parametros-box">
      <strong>{title}</strong>
      <div className="mini-list top-space-sm">
        {rows.length ? rows.map((item) => (
          <button
            type="button"
            key={`${tipo || title}-${item.chave}`}
            className={activeKey === `${tipo}:${item.chave}` ? 'mini-list-row clickable active' : 'mini-list-row clickable'}
            onClick={() => onSelect?.(tipo, item)}
          >
            <span>{item.chave}</span>
            <strong>{formatCurrency(item.frete)} • {formatPercent(item.percentual)} • {item.ctes.toLocaleString('pt-BR')} CT-e(s)</strong>
          </button>
        )) : <span>Sem dados para o filtro.</span>}
      </div>
    </div>
  );
}

function DetailMetric({ label, value, tone = '' }) {
  return (
    <div className="summary-card compact">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function DetalheSimulacao({ item, rankingCalculado }) {
  const frete = item.detalhes?.frete || {};
  const taxas = item.detalhes?.taxas || {};
  const taxasRows = Object.entries(taxas).filter(([, value]) => Number(value || 0) !== 0);

  return (
    <div className="realizado-detail-panel" style={{ alignItems: 'stretch', display: 'block' }}>
      <div className="sim-parametros-header">
        <div>
          <span>Detalhe do cálculo</span>
          <strong>CT-e {item.numeroCte || item.chaveCte?.slice(-8)} • {item.rota}</strong>
          <small>{item.motivoAlocacao}</small>
        </div>
        <span className={item.ganharia ? 'status-pill success' : 'status-pill'}>{rankingLabel(item, rankingCalculado)}</span>
      </div>

      <div className="sim-analise-resumo top-space-sm">
        <DetailMetric label="Realizado" value={formatCurrency(item.valorRealizado)} />
        <DetailMetric label="Simulado" value={formatCurrency(item.valorSimulado)} />
        <DetailMetric label="Saving considerado" value={formatCurrency(item.savingPotencial || 0)} tone={item.ganharia ? 'positivo' : ''} />
        <DetailMetric label="Faixa de peso" value={item.faixaPeso || '—'} />
        <DetailMetric label="Peso do CT-e" value={`${formatNumber(item.peso, 3)} kg`} />
        <DetailMetric label="% redução necessária" value={formatPercent(item.precisaReduzirPercentual || 0)} />
      </div>

      <div className="feature-grid three top-space-sm">
        <div className="sim-parametros-box">
          <strong>Dados do CT-e</strong>
          <div className="mini-list top-space-sm">
            <div className="mini-list-row"><span>Realizada</span><strong>{item.transportadoraRealizada || '—'}</strong></div>
            <div className="mini-list-row"><span>Canal</span><strong>{item.canal || '—'}</strong></div>
            <div className="mini-list-row"><span>Valor NF</span><strong>{formatCurrency(item.valorNF)}</strong></div>
            <div className="mini-list-row"><span>Emissão</span><strong>{formatDateBr(item.emissao)}</strong></div>
          </div>
        </div>
        <div className="sim-parametros-box">
          <strong>Memória do frete</strong>
          <div className="mini-list top-space-sm">
            <div className="mini-list-row"><span>Tipo</span><strong>{frete.tipoCalculo || item.tipoCalculo || '—'}</strong></div>
            <div className="mini-list-row"><span>Base</span><strong>{formatCurrency(frete.valorBase || 0)}</strong></div>
            <div className="mini-list-row"><span>Subtotal</span><strong>{formatCurrency(frete.subtotal || 0)}</strong></div>
            <div className="mini-list-row"><span>ICMS</span><strong>{formatCurrency(frete.icms || 0)}</strong></div>
            <div className="mini-list-row"><span>Total</span><strong>{formatCurrency(frete.total || item.valorSimulado || 0)}</strong></div>
          </div>
        </div>
        <div className="sim-parametros-box">
          <strong>Faixa / taxa aplicada</strong>
          <div className="mini-list top-space-sm">
            <div className="mini-list-row"><span>Percentual</span><strong>{formatPercent(frete.percentualAplicado || 0)}</strong></div>
            <div className="mini-list-row"><span>Valor fixo</span><strong>{formatCurrency(frete.valorFixoAplicado || 0)}</strong></div>
            <div className="mini-list-row"><span>R$/kg</span><strong>{formatCurrency(frete.rsKgAplicado || 0)}</strong></div>
            <div className="mini-list-row"><span>Peso limite</span><strong>{formatNumber(frete.pesoLimite || 0, 3)} kg</strong></div>
            <div className="mini-list-row"><span>Excesso kg</span><strong>{formatNumber(frete.excessoKg || 0, 3)} kg</strong></div>
          </div>
        </div>
      </div>

      <div className="sim-parametros-box top-space-sm">
        <strong>Taxas consideradas</strong>
        <div className="mini-list top-space-sm">
          {taxasRows.length ? taxasRows.map(([nome, valor]) => (
            <div className="mini-list-row" key={nome}><span>{nome}</span><strong>{formatCurrency(valor)}</strong></div>
          )) : <span>Nenhuma taxa adicional aplicada neste CT-e.</span>}
        </div>
      </div>
    </div>
  );
}

function AnaliseGerencialTable({ title, subtitle, rows = [], tipo = 'rota-faixa', limit = 12 }) {
  const linhas = (rows || []).slice(0, limit);
  return (
    <div className="sim-parametros-box top-space">
      <div className="sim-parametros-header">
        <div>
          <strong>{title}</strong>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        <span>{(rows || []).length.toLocaleString('pt-BR')} linha(s)</span>
      </div>
      <div className="sim-table-wrap">
        <table className="sim-table">
          <thead>
            <tr>
              <th>{tipo === 'mes' ? 'Mês' : tipo === 'faixa' ? 'Faixa de peso' : 'Rota / faixa'}</th>
              <th>CT-e(s)</th>
              <th>Sairia</th>
              <th>% aloc.</th>
              <th>Realizado ganho</th>
              <th>Simulado ganho</th>
              <th>Saving</th>
              <th>Redução necessária</th>
              <th>% sugerido</th>
            </tr>
          </thead>
          <tbody>
            {linhas.length ? linhas.map((item) => (
              <tr key={item.chave}>
                <td>{tipo === 'mes' ? item.mes : tipo === 'faixa' ? item.faixaPeso : `${item.rota || item.chave}${item.faixaPeso ? ` • ${item.faixaPeso}` : ''}`}</td>
                <td>{Number(item.ctes || 0).toLocaleString('pt-BR')}</td>
                <td>{Number(item.ctesGanharia || 0).toLocaleString('pt-BR')}</td>
                <td>{formatPercent(item.percentualAlocacao || 0)}</td>
                <td>{formatCurrency(item.valorRealizadoGanhador || 0)}</td>
                <td>{formatCurrency(item.valorSimuladoGanhador || 0)}</td>
                <td className="positivo">{formatCurrency(item.savingPotencial || 0)}</td>
                <td>{formatCurrency(item.precisaReduzirValor || 0)}</td>
                <td>{formatPercent(item.reducaoSugeridaPercentual || 0)}</td>
              </tr>
            )) : <tr><td colSpan="9">Sem dados para esta visão.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}


function FornecedorInsightPanel({ resultado, transportadora }) {
  const analises = resultado?.analises || {};
  const melhorCompetitiva = analises.rotasCompetitivas?.[0];
  const maiorAjuste = analises.oportunidadesAjuste?.[0];
  const faixaCritica = analises.ajustePorFaixa?.[0];
  const linhasFornecedor = analises.visaoFornecedor || [];
  const ajusteFaixa = analises.ajustePorFaixa || [];

  return (
    <div className="sim-parametros-box top-space">
      <div className="sim-parametros-header">
        <div>
          <strong>Visão para devolutiva ao transportador</strong>
          <p>Resumo comercial para mostrar onde a tabela já é competitiva e onde precisa reduzir por rota e faixa de peso.</p>
        </div>
        <span>{transportadora || 'Transportadora simulada'}</span>
      </div>

      <div className="feature-grid three top-space-sm">
        <div className="sim-parametros-box subtle">
          <strong>Melhor argumento de volume</strong>
          <p>{melhorCompetitiva ? `${melhorCompetitiva.rota} • ${melhorCompetitiva.faixaPeso || 'faixa não informada'}` : 'Ainda não há rota/faixa competitiva no filtro.'}</p>
          <small>{melhorCompetitiva ? `${Number(melhorCompetitiva.ctesGanharia || 0).toLocaleString('pt-BR')} CT-e(s) ganhos • saving ${formatCurrency(melhorCompetitiva.savingPotencial || 0)}` : 'Use uma base maior ou confira malha/tabela.'}</small>
        </div>
        <div className="sim-parametros-box subtle">
          <strong>Maior ponto de ajuste</strong>
          <p>{maiorAjuste ? `${maiorAjuste.rota} • ${maiorAjuste.faixaPeso || 'faixa não informada'}` : 'Sem ajuste necessário nas linhas simuladas.'}</p>
          <small>{maiorAjuste ? `redução média sugerida ${formatPercent(maiorAjuste.reducaoSugeridaPercentual || 0)} • ${Number(maiorAjuste.ctesComAjuste || maiorAjuste.ctesNaoAlocados || 0).toLocaleString('pt-BR')} CT-e(s) com oportunidade` : 'A transportadora está abaixo ou sem referência nesta visão.'}</small>
        </div>
        <div className="sim-parametros-box subtle">
          <strong>Faixa de peso crítica</strong>
          <p>{faixaCritica ? faixaCritica.faixaPeso : 'Sem faixa crítica identificada.'}</p>
          <small>{faixaCritica ? `${Number(faixaCritica.ctesComAjuste || 0).toLocaleString('pt-BR')} CT-e(s) pedem ajuste • redução ${formatPercent(faixaCritica.reducaoSugeridaPercentual || 0)}` : 'Boa visão para B2C quando a tabela é por faixa.'}</small>
        </div>
      </div>

      <div className="sim-alert info top-space-sm">
        <strong>Como ler:</strong> nas linhas competitivas, a transportadora já pode receber volume. Nas linhas com ajuste, o sistema mostra a redução média necessária sobre o frete simulado para ela ficar dentro da referência e capturar mais CT-e(s).
      </div>

      <div className="sim-table-wrap top-space">
        <table className="sim-table">
          <thead>
            <tr>
              <th>Rota</th>
              <th>Faixa</th>
              <th>CT-e(s)</th>
              <th>Sairia</th>
              <th>Precisa ajuste</th>
              <th>% aloc.</th>
              <th>Saving atual</th>
              <th>Redução média sugerida</th>
              <th>Status fornecedor</th>
            </tr>
          </thead>
          <tbody>
            {linhasFornecedor.slice(0, 25).map((item) => (
              <tr key={item.chave}>
                <td>{item.rota || item.chave}</td>
                <td>{item.faixaPeso || '—'}</td>
                <td>{Number(item.ctes || 0).toLocaleString('pt-BR')}</td>
                <td>{Number(item.ctesGanharia || 0).toLocaleString('pt-BR')}</td>
                <td>{Number(item.ctesComAjuste || 0).toLocaleString('pt-BR')}</td>
                <td>{formatPercent(item.percentualAlocacao || 0)}</td>
                <td className={item.savingPotencial > 0 ? 'positivo' : ''}>{formatCurrency(item.savingPotencial || 0)}</td>
                <td>{formatPercent(item.reducaoSugeridaPercentual || 0)}</td>
                <td>{item.statusFornecedor || '—'}</td>
              </tr>
            ))}
            {!linhasFornecedor.length ? <tr><td colSpan="9">Sem visão de fornecedor para o filtro atual.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <div className="sim-table-wrap top-space">
        <table className="sim-table">
          <thead>
            <tr>
              <th>Faixa de peso</th>
              <th>CT-e(s)</th>
              <th>Sairia</th>
              <th>Precisa ajuste</th>
              <th>% aloc.</th>
              <th>Saving atual</th>
              <th>Redução necessária total</th>
              <th>% redução média</th>
            </tr>
          </thead>
          <tbody>
            {ajusteFaixa.slice(0, 12).map((item) => (
              <tr key={item.chave}>
                <td>{item.faixaPeso || item.chave}</td>
                <td>{Number(item.ctes || 0).toLocaleString('pt-BR')}</td>
                <td>{Number(item.ctesGanharia || 0).toLocaleString('pt-BR')}</td>
                <td>{Number(item.ctesComAjuste || 0).toLocaleString('pt-BR')}</td>
                <td>{formatPercent(item.percentualAlocacao || 0)}</td>
                <td className={item.savingPotencial > 0 ? 'positivo' : ''}>{formatCurrency(item.savingPotencial || 0)}</td>
                <td>{formatCurrency(item.precisaReduzirValor || 0)}</td>
                <td>{formatPercent(item.reducaoSugeridaPercentual || 0)}</td>
              </tr>
            ))}
            {!ajusteFaixa.length ? <tr><td colSpan="8">Nenhuma faixa com ajuste necessário no filtro atual.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function nextFrame() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function simularRealizadoLocalWorker(payload, onProgress) {
  if (typeof Worker === 'undefined') {
    return simularRealizadoLocalRapido({ ...payload, onProgress });
  }

  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('../workers/realizadoLocalSimulationWorker.js', import.meta.url), { type: 'module' });
    } catch (error) {
      simularRealizadoLocalRapido({ ...payload, onProgress }).then(resolve).catch(reject);
      return;
    }

    worker.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === 'progress') {
        onProgress?.(msg);
      }
      if (msg.type === 'done') {
        worker.terminate();
        resolve(msg.result);
      }
      if (msg.type === 'error') {
        worker.terminate();
        reject(new Error(msg.message || 'Erro ao simular realizado local.'));
      }
    };

    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event?.message || 'Erro no processamento em segundo plano da simulação local.'));
    };

    worker.postMessage({ type: 'simular-realizado-local', ...payload });
  });
}

function pct(atual, total) {
  const safeTotal = Math.max(Number(total) || 0, 1);
  return Math.min(100, Math.max(0, Math.round((Number(atual || 0) / safeTotal) * 100)));
}

function makeFileKey() {
  return `realizado-local-${Date.now()}`;
}

function rankingLabel(item, rankingCalculado) {
  if (item.ganharia) return rankingCalculado ? `${item.ranking || 1}º • sairia / saving` : 'Sairia • gera saving';
  if (rankingCalculado && item.ranking) return `${item.ranking}º • não sai`;
  return item.economizaria ? 'Reduz, mas não alocada' : 'Não sai • acima realizado';
}

function sheetSafeName(value = 'Planilha') {
  return String(value || 'Planilha').replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31) || 'Planilha';
}

function baixarXlsx(nomeArquivo, abas = {}) {
  const workbook = XLSX.utils.book_new();
  Object.entries(abas).forEach(([nome, rows]) => {
    const sheet = XLSX.utils.json_to_sheet(rows || []);
    XLSX.utils.book_append_sheet(workbook, sheet, sheetSafeName(nome));
  });
  XLSX.writeFile(workbook, nomeArquivo);
}

function baixarJson(nomeArquivo, payload = {}) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function formatBytes(bytes = 0) {
  const n = Number(bytes || 0);
  if (!n) return '—';
  if (n < 1024) return `${n.toLocaleString('pt-BR')} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`;
  return `${(n / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

function cteToExportRow(item = {}) {
  return {
    Competencia: item.competencia || '',
    Emissao: item.dataEmissao || '',
    CTE: item.numeroCte || '',
    Chave_CTE: item.chaveCte || '',
    Transportadora_Realizada: item.transportadora || '',
    Tomador_Servico: item.tomadorServico || '',
    Canal: item.canal || '',
    Origem: item.cidadeOrigem || '',
    UF_Origem: item.ufOrigem || '',
    IBGE_Origem: item.ibgeOrigem || '',
    Destino: item.cidadeDestino || '',
    UF_Destino: item.ufDestino || '',
    IBGE_Destino: item.ibgeDestino || '',
    Chave_Rota_IBGE: item.chaveRotaIbge || '',
    Peso: item.peso || 0,
    Peso_Declarado: item.pesoDeclarado || 0,
    Peso_Cubado: item.pesoCubado || 0,
    Cubagem: item.cubagem || 0,
    Volumes: item.qtdVolumes || 0,
    Valor_CTE: item.valorCte || 0,
    Valor_NF: item.valorNF || 0,
    IBGE_OK: item.ibgeOk ? 'Sim' : 'Não',
    Arquivo_Origem: item.arquivoOrigem || '',
  };
}

function simToExportRow(item = {}) {
  const rankingCalculado = item.rankingCalculado !== false;
  const economizaria = item.economizaria || Number(item.impacto || 0) > 0.009;
  return {
    CTE: item.numeroCte || '',
    Chave_CTE: item.chaveCte || '',
    Emissao: item.emissao || '',
    Transportadora_Realizada: item.transportadoraRealizada || '',
    Transportadora_Simulada: item.transportadoraSimulada || '',
    Origem: item.origem || '',
    UF_Origem: item.ufOrigem || '',
    Destino: item.cidadeDestino || '',
    UF_Destino: item.ufDestino || '',
    Rota: item.rota || '',
    Canal: item.canal || '',
    Peso: item.peso || 0,
    Faixa_Peso: item.faixaPeso || '',
    Valor_NF: item.valorNF || 0,
    Valor_Realizado: item.valorRealizado || 0,
    Valor_Simulado: item.valorSimulado || 0,
    Impacto_Unitario: item.impacto || 0,
    Referencia_Competitiva: item.referenciaCompetitiva || 0,
    Reducao_Necessaria_Valor: item.precisaReduzirValor || 0,
    Reducao_Necessaria_Percentual: item.precisaReduzirPercentual || 0,
    Resultado_Impacto: item.resultadoImpacto || (economizaria ? 'Reduz custo vs realizado' : 'Fica acima do realizado'),
    Motivo_Alocacao: item.motivoAlocacao || '',
    Sairia_Pela_Transportadora: item.ganharia ? 'Sim' : 'Não',
    Saving_Potencial: item.savingPotencial || 0,
    Valor_Realizado_Considerado: item.valorRealizadoAlocado || 0,
    Valor_Simulado_Considerado: item.valorSimuladoAlocado || 0,
    Economia_vs_Realizado: item.economiaVsRealizado || (economizaria ? item.impacto || 0 : 0),
    Aumento_Ignorado_Nao_Aloca: item.aumentoVsRealizado || (!economizaria ? Math.abs(Number(item.impacto || 0)) : 0),
    Percentual_Realizado: item.percentualRealizado || 0,
    Percentual_Simulado: item.percentualSimulado || 0,
    Ranking: rankingCalculado ? (item.ranking || '') : 'Não calculado no modo rápido',
    Menor_Preco_Entre_Tabelas: rankingCalculado ? (item.ganhaRanking ? 'Sim' : 'Não') : 'Não calculado no modo rápido',
    Ganharia: item.ganharia ? 'Sim' : 'Não',
    Metrica_Ganharia: rankingCalculado
      ? 'Modo completo: Sim quando é 1º menor preço entre tabelas e reduz custo vs realizado'
      : 'Modo rápido: Sim quando Valor_Simulado é menor que Valor_Realizado. Cargas acima do realizado não são alocadas.',
    Lider_Transportadora: item.liderTransportadora || '',
    Frete_Substituta: rankingCalculado ? (item.freteSubstituta || 0) : '',
  };
}

function analiseToExportRow(item = {}) {
  return {
    Chave: item.chave || '',
    Mes: item.mes || '',
    Rota: item.rota || '',
    Origem: item.origem || '',
    UF_Origem: item.ufOrigem || '',
    Destino: item.destino || '',
    UF_Destino: item.ufDestino || '',
    Faixa_Peso: item.faixaPeso || '',
    CTes: item.ctes || 0,
    CTes_Sairia: item.ctesGanharia || 0,
    CTes_Nao_Alocados: item.ctesNaoAlocados || 0,
    Percentual_Alocacao: item.percentualAlocacao || 0,
    Valor_Realizado_Total: item.valorRealizado || 0,
    Valor_Simulado_Total: item.valorSimulado || 0,
    Valor_NF_Total: item.valorNF || 0,
    Valor_Realizado_Cargas_Ganhas: item.valorRealizadoGanhador || 0,
    Valor_Simulado_Cargas_Ganhas: item.valorSimuladoGanhador || 0,
    Valor_NF_Cargas_Ganhas: item.valorNfGanhador || 0,
    Saving_Potencial: item.savingPotencial || 0,
    Aumento_Ignorado: item.aumentoIgnorado || 0,
    Reducao_Necessaria_Valor: item.precisaReduzirValor || 0,
    Reducao_Sugerida_Percentual: item.reducaoSugeridaPercentual || 0,
    Percentual_Frete_Realizado: item.percentualFreteRealizado || 0,
    Percentual_Frete_Simulado: item.percentualFreteSimulado || 0,
    Percentual_Frete_Ganhador: item.percentualFreteGanhador || 0,
    CTes_Com_Ajuste: item.ctesComAjuste || 0,
    Potencial_CTEs_Ajuste: item.potencialCtesAjuste || 0,
    Valor_Simulado_Nao_Alocado: item.valorSimuladoNaoAlocado || 0,
    Referencia_Competitiva_Nao_Alocado: item.referenciaCompetitiva || 0,
    Referencia_Media_Nao_Alocada: item.referenciaMediaNaoAlocada || 0,
    Simulado_Medio_Nao_Alocado: item.simuladoMedioNaoAlocado || 0,
    Reducao_Media_Por_CTE: item.reducaoMediaPorCte || 0,
    Ganho_Medio_Por_CTE: item.ganhoMedioPorCte || 0,
    Status_Fornecedor: item.statusFornecedor || '',
    Tipo_Acao: item.tipoAcao || '',
    Acao_Recomendada: item.acaoRecomendada || '',
  };
}

export default function RealizadoLocalPage({ transportadoras = [] }) {
  const [filtros, setFiltros] = useState(DEFAULT_FILTROS);
  const [filtrosAplicados, setFiltrosAplicados] = useState(DEFAULT_FILTROS);
  const [municipios, setMunicipios] = useState([]);
  const [ibgeInfo, setIbgeInfo] = useState({ total: 0, fonte: 'não carregado' });
  const [resumo, setResumo] = useState(null);
  const [amostra, setAmostra] = useState([]);
  const [diagnostico, setDiagnostico] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [simulando, setSimulando] = useState(false);
  const [progress, setProgress] = useState(null);
  const [fileKey, setFileKey] = useState(makeFileKey());
  const [detalheAberto, setDetalheAberto] = useState(null);
  const [transportadorasTabela, setTransportadorasTabela] = useState(null);
  const [transportadoraSimuladaCache, setTransportadoraSimuladaCache] = useState({});
  const [tabelasLocais, setTabelasLocais] = useState([]);
  const [usarTabelaSalvaLocal, setUsarTabelaSalvaLocal] = useState(true);
  const [economizarSupabase, setEconomizarSupabase] = useState(readPreferenciaEconomiaSupabase);
  const [salvandoTabelaLocal, setSalvandoTabelaLocal] = useState(false);
  const [usarMalhaAutomatica, setUsarMalhaAutomatica] = useState(true);
  const [modoSimulacao, setModoSimulacao] = useState('rapido');
  const [escopoSimulacao, setEscopoSimulacao] = useState(null);
  const [grupoDetalhe, setGrupoDetalhe] = useState(null);
  const [exportando, setExportando] = useState(false);
  const fileInputRef = useRef(null);
  const tabelaLocalInputRef = useRef(null);

  const stats = useMemo(() => ({
    total: Number(resumo?.total || 0),
    comIbge: Number(resumo?.comIbge || 0),
    pendenciasIbge: Number(resumo?.pendenciasIbge || 0),
    valorCte: Number(resumo?.valorCte || 0),
    valorNF: Number(resumo?.valorNF || 0),
    percentualFrete: Number(resumo?.percentualFrete || 0),
    periodoInicio: resumo?.periodoInicio || '',
    periodoFim: resumo?.periodoFim || '',
  }), [resumo]);

  useEffect(() => {
    let ativo = true;
    async function init() {
      setCarregando(true);
      try {
        const [diag, ibgeRef] = await Promise.all([
          diagnosticarRealizadoLocal().catch(() => ({ total: 0 })),
          carregarMunicipiosIbgeComFallback({ permitirOficial: true }).catch(() => ({ municipios: [], fonte: 'pendente', totalSupabase: 0 })),
        ]);
        if (!ativo) return;
        setDiagnostico(diag);
        setMunicipios(ibgeRef.municipios || []);
        setIbgeInfo({
          total: (ibgeRef.municipios || []).length,
          fonte: `${ibgeRef.fonte || 'pendente'}${ibgeRef.totalSupabase && ibgeRef.totalSupabase < 5000 ? ` • Supabase: ${ibgeRef.totalSupabase.toLocaleString('pt-BR')}` : ''}`,
        });
        await pesquisar(DEFAULT_FILTROS, false);
      } catch (error) {
        if (ativo) setErro(error.message || 'Erro ao iniciar realizado local.');
      } finally {
        if (ativo) setCarregando(false);
      }
    }
    init();
    return () => { ativo = false; };
  }, []);

  async function atualizarTabelasLocais() {
    const lista = await listarTabelasTransportadoraLocal().catch(() => []);
    setTabelasLocais(lista || []);
    return lista || [];
  }

  useEffect(() => {
    atualizarTabelasLocais();
  }, []);

  useEffect(() => {
    writePreferenciaEconomiaSupabase(economizarSupabase);
    if (economizarSupabase) setUsarTabelaSalvaLocal(true);
  }, [economizarSupabase]);

  function alterarFiltro(campo, valor) {
    setFiltros((prev) => ({ ...prev, [campo]: valor }));
    if (resultado) setResultado(null);
  }

  async function pesquisar(filtrosBusca = filtros, mostrarMensagem = true) {
    setCarregando(true);
    setErro('');
    try {
      if (mostrarMensagem) setFeedback('Pesquisando base local...');
      const [resumoLocal, lista] = await Promise.all([
        resumirRealizadoLocal(filtrosBusca, { top: 10 }),
        listarRealizadoLocal(filtrosBusca, { limit: 50 }),
      ]);
      const diag = await diagnosticarRealizadoLocal().catch(() => null);
      setResumo(resumoLocal);
      setAmostra(lista.rows || []);
      setDiagnostico(diag);
      setFiltrosAplicados({ ...DEFAULT_FILTROS, ...filtrosBusca });
      setFeedback(
        resumoLocal.total
          ? `Filtro carregado da base local: ${resumoLocal.total.toLocaleString('pt-BR')} CT-e(s), ${resumoLocal.comIbge.toLocaleString('pt-BR')} com IBGE e ${resumoLocal.pendenciasIbge.toLocaleString('pt-BR')} pendência(s).`
          : 'Nenhum CT-e encontrado na base local para os filtros atuais.'
      );
    } catch (error) {
      setErro(error.message || 'Erro ao pesquisar base local.');
    } finally {
      setCarregando(false);
    }
  }

  async function prepararMunicipiosParaImportacao() {
    let baseMunicipios = Array.isArray(municipios) ? municipios : [];
    let tabelas = transportadorasTabela;
    let fonte = baseMunicipios.length ? ibgeInfo.fonte : 'pendente';

    if (!baseMunicipios.length || baseMunicipios.length < 5000) {
      setProgress((prev) => ({
        ...(prev || {}),
        etapa: 'Carregando referência IBGE',
        percentual: 3,
        mensagem: 'Carregando base oficial IBGE com normalização por cidade/UF. Se o Supabase estiver vazio, uso fallback oficial em cache.',
      }));
      await nextFrame();
      const ibgeRef = await carregarMunicipiosIbgeComFallback({ permitirOficial: true }).catch(() => ({ municipios: baseMunicipios, fonte }));
      if ((ibgeRef.municipios || []).length > baseMunicipios.length) {
        baseMunicipios = ibgeRef.municipios || [];
        fonte = ibgeRef.fonte || fonte;
      }

      if (!tabelas?.length && baseMunicipios.length < 5000) {
        const base = await carregarBaseCompletaDb().catch(() => []);
        tabelas = base?.length ? base : transportadoras;
        if (base?.length) setTransportadorasTabela(base);
        fonte = baseMunicipios.length ? `${fonte} + tabelas` : 'Tabelas de frete';
      }
    }

    const enriquecidos = enriquecerMunicipiosComTabelas(baseMunicipios, tabelas || transportadoras || []);
    if (!enriquecidos.length) {
      throw new Error('Não foi possível carregar nenhuma referência de IBGE. Sem IBGE, a base local não consegue simular. Confira a tela Consulta IBGE ou as rotas/tabelas cadastradas.');
    }

    setMunicipios(enriquecidos);
    setIbgeInfo({ total: enriquecidos.length, fonte });
    return enriquecidos;
  }

  function importarArquivosComWorker(files = [], municipiosResolucao = municipios) {
    return new Promise((resolve, reject) => {
      if (typeof Worker === 'undefined') {
        reject(new Error('Este navegador não suporta processamento em segundo plano com Worker.'));
        return;
      }

      const worker = new Worker(new URL('../workers/realizadoLocalImportWorker.js', import.meta.url), { type: 'module' });

      worker.onmessage = (event) => {
        const msg = event.data || {};

        if (msg.type === 'progress') {
          setProgress({
            etapa: msg.etapa || 'Importando base local',
            atual: msg.atual || 0,
            total: msg.total || files.length,
            percentual: msg.percentual || 0,
            mensagem: msg.mensagem || 'Processando arquivo local...',
          });
          if (msg.feedback) setFeedback(msg.feedback);
        }

        if (msg.type === 'done') {
          worker.terminate();
          resolve(msg.result || {});
        }

        if (msg.type === 'error') {
          worker.terminate();
          reject(new Error(msg.message || 'Erro ao processar arquivo local.'));
        }
      };

      worker.onerror = (event) => {
        worker.terminate();
        reject(new Error(event.message || 'Erro no processador local de arquivos.'));
      };

      worker.postMessage({
        type: 'importar-realizado-local',
        files,
        municipios: municipiosResolucao,
        competencia: filtros.competencia,
      });
    });
  }

  async function importarArquivos(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    setImportando(true);
    setErro('');
    setResultado(null);
    setProgress({
      etapa: 'Preparando leitura local',
      atual: 0,
      total: files.length,
      percentual: 1,
      mensagem: 'Enviando arquivo para processamento em segundo plano. A tela pode continuar aberta durante a leitura.',
    });

    try {
      const municipiosResolucao = await prepararMunicipiosParaImportacao();
      setFeedback(`Referência IBGE pronta: ${municipiosResolucao.length.toLocaleString('pt-BR')} município(s). Iniciando leitura do arquivo...`);
      const result = await importarArquivosComWorker(files, municipiosResolucao);
      if (!result.totalPreparados && result.erros?.length) {
        throw new Error(`Nenhum CT-e foi importado. Primeiro erro: ${result.erros[0]?.arquivo || result.erros[0]?.nome || 'arquivo'} - ${result.erros[0]?.erro || 'erro desconhecido'}`);
      }
      setProgress({
        etapa: 'Atualizando painel',
        atual: result.totalPreparados || 0,
        total: result.totalPreparados || 0,
        percentual: 100,
        mensagem: 'Atualizando resumo local...',
      });
      setFeedback(
        `Importação local concluída: ${Number(result.totalPreparados || 0).toLocaleString('pt-BR')} CT-e(s) considerados de ${Number(result.totalLidos || 0).toLocaleString('pt-BR')} lidos. Ignorados por tomador: ${Number(result.totalIgnoradosTomador || 0).toLocaleString('pt-BR')}. Pendências IBGE: ${Number(result.totalPendencias || 0).toLocaleString('pt-BR')}.`
      );
      setFileKey(makeFileKey());
      await pesquisar(filtros, false);
    } catch (error) {
      setErro(error.message || 'Erro ao importar arquivos locais.');
    } finally {
      setImportando(false);
      setTimeout(() => setProgress(null), 2500);
      if (event.target) event.target.value = '';
    }
  }

  async function reprocessarIbgeLocal() {
    const texto = window.prompt('Para reprocessar cidade/UF/IBGE da base local, digite REPROCESSAR IBGE');
    if (texto !== 'REPROCESSAR IBGE') return;

    setCarregando(true);
    setErro('');
    setFeedback('Reprocessando IBGE da base local com a referência atual...');
    setProgress({ etapa: 'Reprocessando IBGE', atual: 0, total: stats.total || 0, percentual: 5, mensagem: 'Lendo base local já importada...' });

    try {
      const baseAtual = await exportarRealizadoLocal({}, { limit: 500000 });
      const rowsAtuais = baseAtual.rows || [];
      if (!rowsAtuais.length) {
        setFeedback('Não há base local para reprocessar.');
        return;
      }

      setProgress({ etapa: 'Reprocessando IBGE', atual: rowsAtuais.length, total: rowsAtuais.length, percentual: 35, mensagem: 'Corrigindo IBGE, UF e chave origem-destino...' });
      await nextFrame();

      const registros = rowsAtuais.map((row) => ({
        ...row,
        emissao: row.dataEmissao || row.emissao || '',
        volume: row.qtdVolumes || row.volume || 0,
        arquivoOrigem: row.arquivoOrigem || 'base-local-reprocessada',
      }));

      const { rows, pendencias } = prepararRegistrosRealizadoLocal(registros, municipios, {});
      await limparRealizadoLocal();
      await salvarRealizadoLocal(rows, {
        chunkSize: 1000,
        onProgress: ({ salvos, total }) => {
          setProgress({
            etapa: 'Gravando base corrigida',
            atual: salvos,
            total,
            percentual: 40 + Math.round(pct(salvos, total) * 0.55),
            mensagem: `${salvos.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')} CT-e(s) regravados com IBGE corrigido...`,
          });
        },
      });

      await pesquisar(filtros, false);
      setProgress({ etapa: 'Concluído', atual: rows.length, total: rows.length, percentual: 100, mensagem: 'Base local reprocessada.' });
      setFeedback(`IBGE local reprocessado: ${rows.length.toLocaleString('pt-BR')} CT-e(s). Pendências atuais: ${pendencias.length.toLocaleString('pt-BR')}.`);
    } catch (error) {
      setErro(error.message || 'Erro ao reprocessar IBGE da base local.');
    } finally {
      setCarregando(false);
      setTimeout(() => setProgress(null), 2500);
    }
  }

  async function limparNaoTomadoresLocal() {
    const ok = window.confirm(`Deseja remover da base local todos os CT-e(s) cujo Tomador de Serviço não contenha: ${regraTomadorServicoRealizadoTexto()}?`);
    if (!ok) return;

    setCarregando(true);
    setErro('');
    setFeedback('Limpando CT-e(s) fora da regra de tomador...');
    setProgress({ etapa: 'Limpando tomadores', atual: 0, total: diagnostico?.total || 0, percentual: 5, mensagem: 'Removendo CT-e(s) que não são tomadores CPX/ITR/GRIP/GP PNEUS...' });

    try {
      const result = await limparNaoTomadoresRealizadoLocal({
        onProgress: ({ avaliados, removidos, mantidos }) => {
          setProgress({
            etapa: 'Limpando tomadores',
            atual: avaliados,
            total: diagnostico?.total || avaliados,
            percentual: 5 + Math.round(pct(avaliados, diagnostico?.total || avaliados) * 0.85),
            mensagem: `${avaliados.toLocaleString('pt-BR')} avaliados • ${removidos.toLocaleString('pt-BR')} removidos • ${mantidos.toLocaleString('pt-BR')} mantidos`,
          });
        },
      });
      setFeedback(`Limpeza concluída: ${result.mantidos.toLocaleString('pt-BR')} mantidos e ${result.removidos.toLocaleString('pt-BR')} removidos pela regra de tomador.`);
      await pesquisar(filtros, false);
    } catch (error) {
      setErro(error.message || 'Erro ao limpar tomadores da base local.');
    } finally {
      setCarregando(false);
      setTimeout(() => setProgress(null), 2500);
    }
  }

  async function limparBase() {
    const texto = window.prompt('Para limpar a base local deste navegador, digite LIMPAR LOCAL');
    if (texto !== 'LIMPAR LOCAL') return;
    setCarregando(true);
    setErro('');
    try {
      await limparRealizadoLocal();
      setResumo(null);
      setAmostra([]);
      setResultado(null);
      setDiagnostico(await diagnosticarRealizadoLocal());
      setFeedback('Base local limpa neste navegador. O Supabase não foi alterado.');
    } catch (error) {
      setErro(error.message || 'Erro ao limpar base local.');
    } finally {
      setCarregando(false);
    }
  }

  async function carregarTabelaTransportadoraSelecionada(nomeTransportadora, options = {}) {
    const nome = String(nomeTransportadora || '').trim();
    const forcarLocal = Boolean(options.forcarLocal || usarTabelaSalvaLocal || economizarSupabase);
    if (!nome) return [];
    if (!forcarLocal && transportadoraSimuladaCache[nome]?.length) return transportadoraSimuladaCache[nome];

    const snapshot = await buscarTabelaTransportadoraLocal(nome).catch(() => null);
    if (snapshot?.payload && (forcarLocal || economizarSupabase)) {
      setProgress((prev) => ({
        ...(prev || {}),
        etapa: 'Carregando tabela local',
        percentual: 10,
        mensagem: `Usando a tabela salva localmente da ${nome}, sem consultar o Supabase.`,
      }));
      await nextFrame();
      const baseLocal = [snapshot.payload];
      setTransportadoraSimuladaCache((prev) => ({ ...prev, [nome]: baseLocal }));
      return baseLocal;
    }

    if (forcarLocal || economizarSupabase) {
      throw new Error(`A tabela da ${nome} ainda não está salva neste navegador. Para economizar Supabase, importe um pacote JSON local ou desmarque o modo economia apenas para baixar uma vez.`);
    }

    setProgress((prev) => ({
      ...(prev || {}),
      etapa: 'Carregando tabela simulada',
      percentual: 12,
      mensagem: `Carregando somente a tabela da ${nome} no Supabase uma vez. Depois salvo localmente para reutilizar.`,
    }));
    await nextFrame();

    const selecionada = await carregarTransportadoraCompletaDb(null, nome).catch(() => null);
    const base = selecionada ? [selecionada] : (transportadoras || []).filter((item) => item.nome === nome);
    if (selecionada) {
      salvarTabelaTransportadoraLocal(selecionada)
        .then(() => atualizarTabelasLocais())
        .catch((error) => console.warn('Não foi possível salvar snapshot local da transportadora.', error));
    }
    setTransportadoraSimuladaCache((prev) => ({ ...prev, [nome]: base }));
    return base;
  }

  async function salvarTransportadoraSelecionadaLocal() {
    const nome = String(filtros.transportadora || '').trim();
    if (!nome) {
      setErro('Escolha uma transportadora para salvar a tabela local.');
      return;
    }

    setSalvandoTabelaLocal(true);
    setErro('');
    setFeedback(`Atualizando tabela local da ${nome}...`);
    setProgress({ etapa: 'Atualizando tabela local', atual: 0, total: 1, percentual: 8, mensagem: 'Buscando a versão atual da transportadora no Supabase uma única vez. A cópia local será sobrescrita com rotas, faixas, taxas e generalidades atuais.' });

    try {
      const tabela = await carregarTransportadoraCompletaDb(null, nome);
      if (!tabela?.nome) throw new Error(`Não encontrei tabela cadastrada para ${nome}.`);
      const registro = await salvarTabelaTransportadoraLocal(tabela);
      await atualizarTabelasLocais();
      setTransportadoraSimuladaCache((prev) => ({ ...prev, [nome]: [tabela] }));
      setUsarTabelaSalvaLocal(true);
      setProgress({ etapa: 'Tabela local atualizada', atual: 1, total: 1, percentual: 100, mensagem: 'Tabela local pronta para simulação rápida.' });
      setFeedback(`Tabela local atualizada: ${registro.nome} • ${Number(registro.contagem?.origens || 0).toLocaleString('pt-BR')} origem(ns) • ${Number(registro.contagem?.rotas || 0).toLocaleString('pt-BR')} rota(s) • ${Number(registro.contagem?.cotacoes || 0).toLocaleString('pt-BR')} faixa(s) • ${Number(registro.contagem?.taxas || 0).toLocaleString('pt-BR')} taxa(s) • ${Number(registro.contagem?.generalidades || 0).toLocaleString('pt-BR')} generalidade(s) • ${formatBytes(registro.tamanhoBytes)}.`);
    } catch (error) {
      setErro(error.message || 'Erro ao salvar tabela local.');
    } finally {
      setSalvandoTabelaLocal(false);
      setTimeout(() => setProgress(null), 2000);
    }
  }

  async function removerTransportadoraLocal() {
    const nome = String(filtros.transportadora || '').trim();
    if (!nome) {
      setErro('Escolha uma transportadora para remover a tabela local.');
      return;
    }
    const ok = window.confirm(`Remover a tabela local salva da ${nome}? Isso não altera o Supabase.`);
    if (!ok) return;
    try {
      await excluirTabelaTransportadoraLocal(nome);
      await atualizarTabelasLocais();
      setTransportadoraSimuladaCache((prev) => {
        const next = { ...prev };
        delete next[nome];
        return next;
      });
      setFeedback(`Tabela local da ${nome} removida deste navegador.`);
    } catch (error) {
      setErro(error.message || 'Erro ao remover tabela local.');
    }
  }

  async function limparPacoteLocalTransportadoras() {
    const ok = window.confirm(
      'Limpar todas as tabelas de transportadoras salvas localmente neste navegador?\n\n' +
      'Isso não altera o Supabase e é recomendado quando um pacote foi gerado com 0 rotas ou incompleto.'
    );
    if (!ok) return;
    setSalvandoTabelaLocal(true);
    setErro('');
    try {
      await limparTodasTabelasTransportadoraLocal();
      await atualizarTabelasLocais();
      setTransportadoraSimuladaCache({});
      setTransportadorasTabela(null);
      setFeedback('Pacote local de transportadoras limpo neste navegador. Baixe novamente o pacote completo do Supabase para corrigir as rotas.');
    } catch (error) {
      setErro(error.message || 'Erro ao limpar pacote local.');
    } finally {
      setSalvandoTabelaLocal(false);
    }
  }

  async function exportarTransportadoraLocal() {
    const nome = String(filtros.transportadora || '').trim();
    if (!nome) {
      setErro('Escolha uma transportadora para exportar a tabela local.');
      return;
    }
    try {
      const snapshot = await buscarTabelaTransportadoraLocal(nome);
      if (!snapshot?.payload) {
        setErro(`Não existe tabela local salva para ${nome}.`);
        return;
      }
      const safe = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'transportadora';
      baixarJson(`tabela-local-${safe}-${Date.now()}.json`, montarArquivoTabelaLocal(snapshot.payload));
      setFeedback(`Tabela local da ${nome} exportada em JSON.`);
    } catch (error) {
      setErro(error.message || 'Erro ao exportar tabela local.');
    }
  }

  async function importarTransportadoraLocal(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setSalvandoTabelaLocal(true);
    setErro('');
    setFeedback('Importando pacote local em JSON...');
    try {
      const texto = await file.text();
      const json = JSON.parse(texto);
      const transportadorasArquivo = extrairTransportadorasDeArquivoLocal(json);
      const registros = await salvarTabelasTransportadoraLocal(transportadorasArquivo);
      await atualizarTabelasLocais();
      setTransportadoraSimuladaCache((prev) => {
        const next = { ...prev };
        transportadorasArquivo.forEach((item) => {
          if (item?.nome) next[item.nome] = [item];
        });
        return next;
      });
      if (registros.length === 1) setFiltros((prev) => ({ ...prev, transportadora: registros[0].nome }));
      setUsarTabelaSalvaLocal(true);
      setEconomizarSupabase(true);
      const totais = registros.reduce((acc, item) => {
        acc.origens += Number(item.contagem?.origens || 0);
        acc.rotas += Number(item.contagem?.rotas || 0);
        acc.cotacoes += Number(item.contagem?.cotacoes || 0);
        acc.generalidades += Number(item.contagem?.generalidades || 0);
        acc.incompletas += Number(item.contagem?.rotas || 0) > 0 && Number(item.contagem?.cotacoes || 0) > 0 ? 0 : 1;
        return acc;
      }, { origens: 0, rotas: 0, cotacoes: 0, generalidades: 0, incompletas: 0 });
      setFeedback(`Pacote local importado: ${registros.length.toLocaleString('pt-BR')} transportadora(s) • ${totais.origens.toLocaleString('pt-BR')} origem(ns) • ${totais.rotas.toLocaleString('pt-BR')} rota(s) • ${totais.cotacoes.toLocaleString('pt-BR')} cotação(ões)/faixa(s) • ${totais.generalidades.toLocaleString('pt-BR')} generalidade(s).${totais.incompletas ? ` Atenção: ${totais.incompletas.toLocaleString('pt-BR')} transportadora(s) sem rotas/cotações úteis para simulação.` : ''} Supabase não foi consultado.`);
    } catch (error) {
      setErro(error.message || 'Erro ao importar pacote local.');
    } finally {
      setSalvandoTabelaLocal(false);
      if (event.target) event.target.value = '';
    }
  }

  function possuiTabelaCompletaLocal(transportadora = {}) {
    // Para simulação local não basta ter cadastro/origem/generalidade.
    // Precisa ter rotas/malha e cotações/faixas. Caso contrário o pacote fica bonito,
    // mas não calcula frete nem ranking e aparece com 0 rotas.
    return transportadoraTemTabelaUtilLocal(transportadora);
  }

  function resumirQualidadePacoteLocal(transportadorasPacote = []) {
    return (transportadorasPacote || []).reduce((acc, item) => {
      const contagem = contarEstruturaTransportadoraLocal(item);
      acc.transportadoras += 1;
      acc.origens += Number(contagem.origens || 0);
      acc.rotas += Number(contagem.rotas || 0);
      acc.cotacoes += Number(contagem.cotacoes || 0);
      acc.taxas += Number(contagem.taxas || 0);
      acc.generalidades += Number(contagem.generalidades || 0);
      acc.incompletas += contagem.origens > 0 && contagem.rotas > 0 && contagem.cotacoes > 0 ? 0 : 1;
      return acc;
    }, { transportadoras: 0, origens: 0, rotas: 0, cotacoes: 0, taxas: 0, generalidades: 0, incompletas: 0 });
  }

  function obterBaseCompletaEmMemoria() {
    const base = Array.isArray(transportadorasTabela) && transportadorasTabela.length
      ? transportadorasTabela
      : Array.isArray(transportadoras)
        ? transportadoras
        : [];

    const completas = (base || []).filter((item) => item?.nome && possuiTabelaCompletaLocal(item));
    return completas;
  }

  async function exportarTodasTabelasLocais() {
    setSalvandoTabelaLocal(true);
    setErro('');
    try {
      const registros = await buscarTodasTabelasTransportadoraLocal();
      const transportadorasLocal = registros.map((item) => item.payload).filter(Boolean);
      if (!transportadorasLocal.length) {
        setErro('Não há tabelas locais salvas para exportar. Este botão exporta apenas o que já foi salvo/importado no navegador. Para gerar a base completa, use “Baixar pacote completo do Supabase”.');
        return;
      }

      const totalCadastro = (transportadoras || []).filter((item) => item?.nome).length;
      if (totalCadastro > transportadorasLocal.length) {
        const ok = window.confirm(
          `Atenção: existem ${transportadorasLocal.length.toLocaleString('pt-BR')} tabela(s) salva(s) localmente, mas o cadastro mostra ${totalCadastro.toLocaleString('pt-BR')} transportadora(s).\n\n` +
          'Este pacote vai exportar somente o que está salvo no navegador. Continuar mesmo assim?\n\n' +
          'Para gerar pacote com todas as transportadoras, clique em “Baixar pacote completo do Supabase”.'
        );
        if (!ok) return;
      }

      baixarJson(`pacote-tabelas-salvas-navegador-${Date.now()}.json`, montarArquivoTabelasLocais(transportadorasLocal));
      setFeedback(`Pacote salvo no navegador exportado com ${transportadorasLocal.length.toLocaleString('pt-BR')} transportadora(s). Se apareceu só TAM, é porque somente TAM está salva localmente neste navegador.`);
    } catch (error) {
      setErro(error.message || 'Erro ao exportar pacote local.');
    } finally {
      setSalvandoTabelaLocal(false);
    }
  }

  async function baixarPacoteCompletoSupabase() {
    const ok = window.confirm(
      'Vou montar um pacote completo com todas as tabelas disponíveis.\n\n' +
      'Será feita uma consulta ao Supabase uma única vez para baixar a estrutura real com rotas e cotações. Não vou usar a memória da tela, porque ela pode estar incompleta e gerar pacote com 0 rotas. Depois o pacote fica salvo no navegador e pode ser exportado/importado sem gastar Supabase.\n\n' +
      'Continuar?'
    );
    if (!ok) return;

    setSalvandoTabelaLocal(true);
    setErro('');
    setProgress({
      etapa: 'Baixando pacote completo do Supabase',
      atual: 0,
      total: 1,
      percentual: 8,
      mensagem: 'Consultando o Supabase agora. Não vou usar a memória da tela, porque ela pode ter só cadastro/resumo e gerar pacote com 0 rotas.',
    });

    try {
      await nextFrame();
      const baseCompleta = await carregarBaseCompletaDb();
      const fonte = 'Supabase';

      const todasComNome = (baseCompleta || []).filter((item) => item?.nome);
      const resumoQualidade = resumirQualidadePacoteLocal(todasComNome);

      if (!Number(resumoQualidade.rotas || 0)) {
        throw new Error(
          `O Supabase retornou ${resumoQualidade.transportadoras.toLocaleString('pt-BR')} transportadora(s), ` +
          `${resumoQualidade.origens.toLocaleString('pt-BR')} origem(ns), mas 0 rota(s). ` +
          'Por segurança não gerei o pacote, porque pacote sem rotas não simula por IBGE. ' +
          'Isso normalmente acontece quando a tela usa apenas cadastro/resumo ou quando a tabela rotas não foi carregada no banco. Confira o cadastro de rotas/malha no Supabase antes de gerar o pacote.'
        );
      }

      const transportadorasValidas = todasComNome.filter((item) => possuiTabelaCompletaLocal(item));
      const incompletas = Math.max(0, resumoQualidade.transportadoras - transportadorasValidas.length);

      if (!transportadorasValidas.length) {
        throw new Error(
          `Baixei dados do Supabase, mas nenhuma transportadora veio completa para simulação. ` +
          `Totais baixados: ${resumoQualidade.origens.toLocaleString('pt-BR')} origem(ns), ` +
          `${resumoQualidade.rotas.toLocaleString('pt-BR')} rota(s), ` +
          `${resumoQualidade.cotacoes.toLocaleString('pt-BR')} cotação(ões)/faixa(s). ` +
          'Para simular localmente, a transportadora precisa ter rotas e cotações/faixas.'
        );
      }

      setProgress({
        etapa: 'Salvando pacote no navegador',
        atual: 0,
        total: transportadorasValidas.length,
        percentual: 65,
        mensagem: `Salvando ${transportadorasValidas.length.toLocaleString('pt-BR')} transportadora(s) localmente para simular sem Supabase.`,
      });
      await nextFrame();

      const registros = await salvarTabelasTransportadoraLocal(transportadorasValidas);
      await atualizarTabelasLocais();
      setTransportadoraSimuladaCache((prev) => {
        const next = { ...prev };
        transportadorasValidas.forEach((item) => {
          if (item?.nome) next[item.nome] = [item];
        });
        return next;
      });
      setTransportadorasTabela(transportadorasValidas);
      setUsarTabelaSalvaLocal(true);
      setEconomizarSupabase(true);

      const pacote = montarArquivoTabelasLocais(transportadorasValidas);
      baixarJson(`pacote-tabelas-completo-${Date.now()}.json`, pacote);

      const totais = registros.reduce((acc, item) => {
        acc.origens += Number(item.contagem?.origens || 0);
        acc.rotas += Number(item.contagem?.rotas || 0);
        acc.cotacoes += Number(item.contagem?.cotacoes || 0);
        acc.taxas += Number(item.contagem?.taxas || 0);
        acc.generalidades += Number(item.contagem?.generalidades || 0);
        return acc;
      }, { origens: 0, rotas: 0, cotacoes: 0, taxas: 0, generalidades: 0 });

      setProgress({
        etapa: 'Pacote completo pronto',
        atual: registros.length,
        total: registros.length,
        percentual: 100,
        mensagem: 'Pacote completo salvo no navegador e exportado em JSON.',
      });
      setFeedback(
        `Pacote completo gerado a partir de ${fonte}: ${registros.length.toLocaleString('pt-BR')} transportadora(s), ` +
        `${totais.origens.toLocaleString('pt-BR')} origem(ns), ${totais.rotas.toLocaleString('pt-BR')} rota(s), ` +
        `${totais.cotacoes.toLocaleString('pt-BR')} faixa(s)/frete(s), ${totais.taxas.toLocaleString('pt-BR')} taxa(s) ` +
        `e ${totais.generalidades.toLocaleString('pt-BR')} generalidade(s). ` +
        `${incompletas ? `${incompletas.toLocaleString('pt-BR')} cadastro(s) sem rota/cotação útil foram ignorados no pacote. ` : ''}` +
        'Agora o rápido e o completo podem usar pacote local.'
      );
    } catch (error) {
      setErro(error.message || 'Erro ao baixar pacote completo para uso local.');
    } finally {
      setSalvandoTabelaLocal(false);
      setTimeout(() => setProgress(null), 3000);
    }
  }

  function mesclarTransportadorasParciais(listas = []) {
    const mapa = new Map();
    const origemKeysPorTransportadora = new Map();

    listas.flat().filter(Boolean).forEach((transportadora) => {
      const chaveTransportadora = transportadora.id || transportadora.nome;
      if (!chaveTransportadora) return;
      const atual = mapa.get(chaveTransportadora) || { ...transportadora, origens: [] };
      const origemKeys = origemKeysPorTransportadora.get(chaveTransportadora) || new Set();

      (transportadora.origens || []).forEach((origem) => {
        const origemKey = origem.id || `${origem.cidade}|${origem.canal}|${(origem.rotas || []).map((rota) => rota.ibgeDestino || rota.nomeRota).join(',')}`;
        if (origemKeys.has(origemKey)) return;
        origemKeys.add(origemKey);
        atual.origens.push(origem);
      });

      mapa.set(chaveTransportadora, atual);
      origemKeysPorTransportadora.set(chaveTransportadora, origemKeys);
    });

    return [...mapa.values()].filter((item) => item.origens?.length);
  }

  async function carregarTabelasConcorrentesParaRealizado(rows = [], tabelaSelecionada = []) {
    if (!rows.length) return tabelaSelecionada;

    const partes = [tabelaSelecionada];

    if (economizarSupabase) {
      setProgress((prev) => ({
        ...(prev || {}),
        etapa: 'Carregando concorrentes locais',
        percentual: 24,
        mensagem: 'Modo economia ativo: usando somente tabelas salvas/importadas localmente para o ranking completo.',
      }));
      await nextFrame();
      const registrosLocais = await buscarTodasTabelasTransportadoraLocal().catch(() => []);
      const locais = registrosLocais.map((item) => item.payload).filter(Boolean);
      if (locais.length) partes.push(locais);
      const mescladasLocais = mesclarTransportadorasParciais(partes);
      if (mescladasLocais.length > (tabelaSelecionada?.length || 0)) return mescladasLocais;
      throw new Error('Modo completo local precisa de mais tabelas salvas/importadas. Importe um pacote local com concorrentes ou desative “Economizar Supabase” para buscar no banco.');
    }

    setProgress((prev) => ({
      ...(prev || {}),
      etapa: 'Carregando concorrentes por rota IBGE',
      percentual: 26,
      mensagem: 'Modo completo otimizado: buscando somente as tabelas das rotas IBGE presentes nos CT-e(s) filtrados.',
    }));
    await nextFrame();

    const routeKeys = Array.from(new Set(
      rows
        .map((row) => {
          const rota = String(row.chaveRotaIbge || '').trim();
          if (!rota) return '';
          return `${categoriaCanalRealizado(row.canal)}|${rota}`;
        })
        .filter(Boolean)
    ));

    try {
      const concorrentesPorRota = await buscarBaseSimulacaoPorRotasDb({
        routeKeys,
        canal: filtrosAplicados.canal || filtros.canal || '',
      });
      if (concorrentesPorRota?.length) partes.push(concorrentesPorRota);
    } catch (error) {
      console.warn('Falha na busca otimizada por rotas. Tentando fallback enxuto por origem/destino.', error);
      const grupos = new Map();
      rows.forEach((row) => {
        const origem = row.cidadeOrigem || '';
        const canal = row.canal || '';
        const destino = String(row.ibgeDestino || '').replace(/\D/g, '');
        if (!origem || !destino) return;
        const key = `${origem}|${canal}`;
        const grupo = grupos.get(key) || { origem, canal, destinos: new Set() };
        grupo.destinos.add(destino);
        grupos.set(key, grupo);
      });

      for (const grupo of grupos.values()) {
        const destinos = [...grupo.destinos];
        for (let i = 0; i < destinos.length; i += 120) {
          const destinoCodigos = destinos.slice(i, i + 120);
          const parcial = await buscarBaseSimulacaoDb({ origem: grupo.origem, canal: grupo.canal, destinoCodigos }).catch(() => []);
          if (parcial?.length) partes.push(parcial);
          await nextFrame();
        }
      }
    }

    const mescladas = mesclarTransportadorasParciais(partes);
    if (mescladas.length) return mescladas;

    return tabelaSelecionada;
  }

  async function simular() {
    if (!filtros.transportadora) {
      setErro('Escolha a transportadora que deseja simular.');
      return;
    }

    setSimulando(true);
    setErro('');
    setResultado(null);
    setEscopoSimulacao(null);
    setProgress({ etapa: 'Carregando malha', atual: 0, total: 0, percentual: 5, mensagem: 'Carregando tabelas e montando escopo da transportadora...' });

    try {
      const tabelaSelecionada = await carregarTabelaTransportadoraSelecionada(filtros.transportadora, { forcarLocal: usarTabelaSalvaLocal });
      if (!tabelaSelecionada?.length) {
        setErro('Não encontrei a tabela dessa transportadora no Supabase. Confira se a tabela está cadastrada e se o nome selecionado é exatamente o mesmo.');
        return;
      }

      const escopo = construirEscopoTransportadoraSimulada({
        transportadoras: tabelaSelecionada,
        nomeTransportadora: filtros.transportadora,
        municipios,
        canalFiltro: filtrosAplicados.canal || filtros.canal,
      });
      setEscopoSimulacao(escopo);

      if (!escopo.transportadora) {
        setErro('Não encontrei essa transportadora nas tabelas cadastradas. Confira se o nome está igual ao cadastro.');
        return;
      }

      if (usarMalhaAutomatica && !escopo.totalRotas) {
        setErro('A transportadora selecionada foi encontrada, mas não possui rotas com IBGE para o canal selecionado. Confira as rotas/tabelas cadastradas.');
        return;
      }

      const filtrosSimulacao = {
        ...filtrosAplicados,
        excluirEbazar: filtros.excluirEbazar,
      };

      const filtrosBase = usarMalhaAutomatica
        ? {
            ...filtrosSimulacao,
            origem: '',
            destino: '',
            ufOrigem: '',
            ufDestino: '',
          }
        : filtrosSimulacao;

      setProgress({
        etapa: usarMalhaAutomatica ? 'Filtrando pela malha' : 'Preparando realizado',
        atual: 0,
        total: escopo.totalRotas || 0,
        percentual: 18,
        mensagem: usarMalhaAutomatica
          ? `Aplicando malha automática da ${escopo.transportadora}: ${escopo.totalRotas.toLocaleString('pt-BR')} rota(s), ${escopo.origens.length.toLocaleString('pt-BR')} origem(ns).`
          : 'Buscando CT-e(s) filtrados na base local...',
      });
      await nextFrame();

      const buscaRealizado = usarMalhaAutomatica
        ? await buscarRealizadoLocalPorMalha(filtrosBase, escopo.routeKeys, { limit: 10000 })
        : await buscarRealizadoLocalParaSimulacao(filtrosBase, { limit: 10000 });

      const { rows, totalCompativel, limit } = buscaRealizado;
      if (!rows.length) {
        setErro(
          usarMalhaAutomatica
            ? 'Nenhum CT-e da base local caiu dentro da malha da transportadora selecionada para o período/filtros atuais. Tente ampliar o período ou remover canal/peso/transportadora realizada.'
            : 'Nenhum CT-e encontrado na base local para simular nos filtros pesquisados.'
        );
        return;
      }

      setFeedback(
        usarMalhaAutomatica
          ? `Simulação automática: ${rows.length.toLocaleString('pt-BR')} CT-e(s) dentro da malha da ${escopo.transportadora}${totalCompativel > rows.length ? ` de ${totalCompativel.toLocaleString('pt-BR')} encontrados. Limite atual: ${limit.toLocaleString('pt-BR')}.` : '.'}`
          : `Preparando simulação local: ${rows.length.toLocaleString('pt-BR')} CT-e(s) usados${totalCompativel > rows.length ? ` de ${totalCompativel.toLocaleString('pt-BR')} encontrados. Limite atual: ${limit.toLocaleString('pt-BR')}.` : '.'}`
      );

      const baseTabelas = modoSimulacao === 'rapido'
        ? tabelaSelecionada
        : await carregarTabelasConcorrentesParaRealizado(rows, tabelaSelecionada);

      setProgress({
        etapa: 'Indexando tabelas',
        atual: 0,
        total: baseTabelas.length,
        percentual: 30,
        mensagem: modoSimulacao === 'rapido'
          ? `Modo rápido: calculando somente ${filtros.transportadora}, sem puxar concorrentes.`
          : economizarSupabase
            ? 'Modo completo local: ranking apenas contra tabelas salvas/importadas localmente.'
            : 'Modo completo: preparando cálculo de ranking contra concorrentes.',
      });
      await nextFrame();

      const analise = await simularRealizadoLocalWorker({
        realizados: rows,
        transportadoras: baseTabelas,
        municipios,
        nomeTransportadora: filtros.transportadora,
        modoSimulacao,
      }, ({ atual = 0, total = rows.length, etapa = 'Calculando frete local' }) => {
        setProgress({
          etapa,
          atual,
          total,
          percentual: 35 + Math.round(pct(atual, total) * 0.63),
          mensagem: `${Number(atual || 0).toLocaleString('pt-BR')} de ${Number(total || rows.length).toLocaleString('pt-BR')} CT-e(s) simulados em segundo plano...`,
        });
      });

      setResultado(analise);
      setProgress({ etapa: 'Concluído', atual: rows.length, total: rows.length, percentual: 100, mensagem: 'Simulação local concluída.' });
      setFeedback(
        analise.resumo.rankingCalculado
          ? `Simulação completa concluída: ${analise.resumo.ctesComSimulacao.toLocaleString('pt-BR')} CT-e(s) avaliados, ${analise.resumo.ctesGanharia.toLocaleString('pt-BR')} sairia(m) pela transportadora e ${analise.resumo.ctesForaMalha.toLocaleString('pt-BR')} fora da malha.`
          : `Simulação rápida concluída: ${analise.resumo.ctesComSimulacao.toLocaleString('pt-BR')} CT-e(s) com frete simulado, ${analise.resumo.ctesGanharia.toLocaleString('pt-BR')} com saving e ${analise.resumo.ctesForaMalha.toLocaleString('pt-BR')} fora da malha.`
      );
    } catch (error) {
      setErro(error.message || 'Erro ao simular realizado local.');
    } finally {
      setSimulando(false);
      setTimeout(() => setProgress(null), 2500);
    }
  }

  const transportadorasDisponiveis = useMemo(() => {
    const fromTabelas = (transportadorasTabela || transportadoras || []).map((item) => item.nome).filter(Boolean);
    const fromLocal = (tabelasLocais || []).map((item) => item.nome).filter(Boolean);
    return [...new Set([...fromTabelas, ...fromLocal])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [transportadorasTabela, transportadoras, tabelasLocais]);

  const tabelaLocalSelecionada = useMemo(() => {
    const nome = String(filtros.transportadora || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (!nome) return null;
    return (tabelasLocais || []).find((item) => item.nomeNormalizado === nome) || null;
  }, [filtros.transportadora, tabelasLocais]);

  function selecionarGrupo(tipo, item) {
    if (!tipo || !item) return;
    setGrupoDetalhe({ tipo, ...item });
  }

  async function aplicarGrupoComoFiltro() {
    if (!grupoDetalhe) return;
    const novoFiltro = { ...filtros };
    if (grupoDetalhe.tipo === 'transportadora') novoFiltro.transportadoraRealizada = grupoDetalhe.chave === 'Não informado' ? '' : grupoDetalhe.chave;
    if (grupoDetalhe.tipo === 'canal') novoFiltro.canal = grupoDetalhe.chave === 'Não informado' ? '' : grupoDetalhe.chave;
    if (grupoDetalhe.tipo === 'mes') novoFiltro.competencia = grupoDetalhe.chave === 'Não informado' ? '' : grupoDetalhe.chave;
    if (grupoDetalhe.tipo === 'origem') {
      const [cidade, uf] = String(grupoDetalhe.chave || '').split('/');
      novoFiltro.origem = cidade || '';
      novoFiltro.ufOrigem = uf || '';
    }
    if (grupoDetalhe.tipo === 'destino') {
      const [cidade, uf] = String(grupoDetalhe.chave || '').split('/');
      novoFiltro.destino = cidade || '';
      novoFiltro.ufDestino = uf || '';
    }
    setFiltros(novoFiltro);
    await pesquisar(novoFiltro);
  }

  async function exportarBaseSelecionada() {
    setExportando(true);
    setErro('');
    try {
      const { rows, totalCompativel, limit } = await exportarRealizadoLocal(filtrosAplicados, { limit: 100000 });
      if (!rows.length) {
        setErro('Não existe base filtrada para exportar. Pesquise primeiro.');
        return;
      }
      baixarXlsx(`realizado-local-base-filtrada-${Date.now()}.xlsx`, {
        Base_Filtrada: rows.map(cteToExportRow),
      });
      setFeedback(`Base filtrada exportada: ${rows.length.toLocaleString('pt-BR')} linha(s)${totalCompativel > limit ? ` de ${totalCompativel.toLocaleString('pt-BR')} encontradas` : ''}.`);
    } catch (error) {
      setErro(error.message || 'Erro ao exportar base filtrada.');
    } finally {
      setExportando(false);
    }
  }

  function exportarResultadoSimulacao() {
    if (!resultado) return;
    baixarXlsx(`realizado-local-simulacao-${Date.now()}.xlsx`, {
      Resultado: (resultado.detalhes || []).map(simToExportRow),
      Saving_Mes: (resultado.analises?.porMes || []).map(analiseToExportRow),
      Saving_Rotas: (resultado.analises?.porRota || []).map(analiseToExportRow),
      Saving_Faixas: (resultado.analises?.porFaixaPeso || []).map(analiseToExportRow),
      Rota_Faixa: (resultado.analises?.porRotaFaixa || []).map(analiseToExportRow),
      Oportunidades_Ajuste: (resultado.analises?.oportunidadesAjuste || []).map(analiseToExportRow),
      Rotas_Competitivas: (resultado.analises?.rotasCompetitivas || []).map(analiseToExportRow),
      Visao_Fornecedor: (resultado.analises?.visaoFornecedor || []).map(analiseToExportRow),
      Ajuste_por_Faixa: (resultado.analises?.ajustePorFaixa || []).map(analiseToExportRow),
      Plano_Acao_Fornecedor: (resultado.analises?.planoAcaoFornecedor || []).map(analiseToExportRow),
      Fora_da_Malha: (resultado.foraMalha || []).map(cteToExportRow),
      Resumo_UF: resultado.resumo?.porUf || [],
    });
    setFeedback('Resultado da simulação exportado em Excel.');
  }

  const grupoAtivoKey = grupoDetalhe ? `${grupoDetalhe.tipo}:${grupoDetalhe.chave}` : '';
  const rankingCalculado = resultado?.resumo?.rankingCalculado !== false;

  return (
    <div className="page-shell realizado-page">
      <div className="page-top between">
        <div className="page-header">
          <div className="amd-mini-brand">AMD Log • Realizado local</div>
          <h1>Realizado CT-e Local</h1>
          <p>
            Carregue CT-e(s) da sua máquina, gere base enxuta local com IBGE e simule sem gravar o realizado no Supabase.
          </p>
        </div>
        <div className="actions-right wrap">
          <button className="btn-secondary" onClick={() => pesquisar(filtros)} disabled={carregando || importando || simulando}>
            {carregando ? 'Pesquisando...' : 'Pesquisar base local'}
          </button>
          <button className="btn-secondary" onClick={exportarBaseSelecionada} disabled={exportando || carregando || importando || simulando || !stats.total}>
            {exportando ? 'Exportando...' : 'Exportar base filtrada'}
          </button>
          <button className="btn-secondary" onClick={reprocessarIbgeLocal} disabled={carregando || importando || simulando || !diagnostico?.total || !municipios.length}>
            Reprocessar IBGE local
          </button>
          <button className="btn-secondary" onClick={limparNaoTomadoresLocal} disabled={carregando || importando || simulando || !diagnostico?.total}>
            Limpar não tomadores
          </button>
          <button className="btn-danger" onClick={limparBase} disabled={carregando || importando || simulando || !diagnostico?.total}>
            Limpar base local
          </button>
        </div>
      </div>

      {erro ? <div className="sim-alert">{erro}</div> : null}
      {feedback ? <div className="sim-alert info">{feedback}</div> : null}
      <div className={ibgeInfo.total ? 'sim-alert success' : 'sim-alert'}>
        <strong>Referência IBGE local:</strong> {ibgeInfo.total.toLocaleString('pt-BR')} município(s) • fonte: {ibgeInfo.fonte}. A importação local usa cidade/UF normalizadas com e sem acento; confira a tela Consulta IBGE se o Supabase estiver vazio.
      </div>
      <div className="sim-alert info">
        <strong>Regra de limpeza do realizado:</strong> entram na base apenas CT-e(s) cujo Tomador de Serviço contenha {regraTomadorServicoRealizadoTexto()}. Use “Limpar não tomadores” para reprocessar uma base antiga já importada.
      </div>
      <div className={filtrosAplicados.excluirEbazar ? 'sim-alert info' : 'sim-alert success'}>
        <strong>Filtro EBAZAR:</strong> {filtrosAplicados.excluirEbazar ? 'EBAZAR está fora da base pesquisada/análise atual.' : 'EBAZAR está incluída na base pesquisada/análise atual.'}
      </div>
      <div className={economizarSupabase ? 'sim-alert success' : 'sim-alert info'}>
        <strong>Modo economia Supabase:</strong> {economizarSupabase ? 'ativo — simulações tentam usar tabelas salvas/importadas localmente antes de consultar o banco.' : 'desativado — o sistema pode consultar o Supabase para baixar tabelas que ainda não estão locais.'}
      </div>

      {progress ? (
        <div className="sim-alert info">
          <div className="sim-parametros-header">
            <div>
              <strong>{progress.etapa}</strong>
              <p>{progress.mensagem}</p>
            </div>
            <span>{Math.round(progress.percentual || 0)}%</span>
          </div>
          <div style={{ height: 10, borderRadius: 999, background: 'rgba(0,0,0,0.08)', overflow: 'hidden', marginTop: 10 }}>
            <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, Number(progress.percentual || 0)))}%`, borderRadius: 999, background: '#9153F0', transition: 'width 180ms ease' }} />
          </div>
        </div>
      ) : null}

      <div className="summary-strip">
        <SummaryCard title="CT-e(s) filtrados" value={stats.total.toLocaleString('pt-BR')} subtitle={`${formatDateBr(stats.periodoInicio)} até ${formatDateBr(stats.periodoFim)}`} />
        <SummaryCard title="Frete realizado" value={formatCurrency(stats.valorCte)} subtitle="Soma do Valor CT-e local" />
        <SummaryCard title="Valor NF" value={formatCurrency(stats.valorNF)} subtitle="Base para % de frete" />
        <SummaryCard title="% frete realizado" value={formatPercent(stats.percentualFrete)} subtitle="Frete realizado / NF" />
        <SummaryCard title="Pendências IBGE" value={stats.pendenciasIbge.toLocaleString('pt-BR')} subtitle={`${stats.comIbge.toLocaleString('pt-BR')} CT-e(s) com rota IBGE`} />
      </div>

      <div className="feature-grid three">
        <section className="panel-card">
          <div className="panel-title">1. Carregar base local</div>
          <p>Selecione um ou mais arquivos mensais. O sistema grava uma base enxuta apenas neste navegador, sem ocupar Supabase.</p>
          <input
            key={fileKey}
            ref={fileInputRef}
            type="file"
            multiple
            accept=".xlsx,.xls,.csv"
            onChange={importarArquivos}
            disabled={importando || simulando}
          />
          <button className="btn-primary full" onClick={() => fileInputRef.current?.click()} disabled={importando || simulando}>
            {importando ? 'Importando local...' : 'Selecionar arquivos locais'}
          </button>
          <div className="import-meta-box">
            Base local neste navegador: <strong>{Number(diagnostico?.total || 0).toLocaleString('pt-BR')}</strong> CT-e(s)
          </div>
        </section>

        <section className="panel-card">
          <div className="panel-title">2. Pesquisar base enxuta</div>
          <div className="form-grid">
            <div className="field"><label>Competência</label><input value={filtros.competencia} onChange={(e) => alterarFiltro('competencia', e.target.value)} placeholder="2026-04" /></div>
            <div className="field"><label>Canal</label><select value={filtros.canal} onChange={(e) => alterarFiltro('canal', e.target.value)}><option value="">Todos</option><option>ATACADO</option><option>B2C</option><option>INTERCOMPANY</option><option>REVERSA</option></select></div>
            <div className="field"><label>Data inicial</label><input type="date" value={filtros.inicio} onChange={(e) => alterarFiltro('inicio', e.target.value)} /></div>
            <div className="field"><label>Data final</label><input type="date" value={filtros.fim} onChange={(e) => alterarFiltro('fim', e.target.value)} /></div>
            <div className="field"><label>UF origem</label><input value={filtros.ufOrigem} onChange={(e) => alterarFiltro('ufOrigem', e.target.value.toUpperCase().slice(0, 2))} placeholder="SC" /></div>
            <div className="field"><label>UF destino</label><input value={filtros.ufDestino} onChange={(e) => alterarFiltro('ufDestino', e.target.value.toUpperCase().slice(0, 2))} placeholder="SP" /></div>
            <div className="field"><label>Peso mínimo</label><input type="number" value={filtros.pesoMin} onChange={(e) => alterarFiltro('pesoMin', e.target.value)} placeholder="Ex.: 40" /></div>
            <div className="field"><label>Peso máximo</label><input type="number" value={filtros.pesoMax} onChange={(e) => alterarFiltro('pesoMax', e.target.value)} placeholder="Ex.: 100" /></div>
          </div>
          <div className="field"><label>Transportadora realizada</label><input value={filtros.transportadoraRealizada} onChange={(e) => alterarFiltro('transportadoraRealizada', e.target.value)} placeholder="Ex.: MOVVI" /></div>
          <label className="check-row" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8, marginBottom: 8 }}>
            <input type="checkbox" checked={Boolean(filtros.excluirEbazar)} onChange={(e) => alterarFiltro('excluirEbazar', e.target.checked)} />
            <span>
              Retirar EBAZAR da base/análise
              <small style={{ display: 'block' }}>Com essa opção marcada, o painel, a exportação e a simulação desconsideram CT-e(s) em que a transportadora realizada contenha “EBAZAR”. Desmarque quando quiser usar EBAZAR na comparação.</small>
            </span>
          </label>
          <div className="form-grid"><div className="field"><label>Origem</label><input value={filtros.origem} onChange={(e) => alterarFiltro('origem', e.target.value)} placeholder="Itajaí" /></div><div className="field"><label>Destino</label><input value={filtros.destino} onChange={(e) => alterarFiltro('destino', e.target.value)} placeholder="São Paulo" /></div></div>
          <button className="btn-primary full" onClick={() => pesquisar(filtros)} disabled={carregando || importando || simulando}>Pesquisar</button>
        </section>

        <section className="panel-card">
          <div className="panel-title">3. Simular local</div>
          <p>Use modo rápido para impacto financeiro. Use completo apenas quando precisar ranking/ganhadores contra concorrentes.</p>
          <div className="field">
            <label>Transportadora simulada</label>
            <select value={filtros.transportadora} onChange={(e) => alterarFiltro('transportadora', e.target.value)}>
              <option value="">Selecione a transportadora cadastrada</option>
              {transportadorasDisponiveis.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <small>Escolha a tabela exata que deseja testar. Assim o sistema não mistura nomes parecidos, como “TOTAL EXPRESS” e “TOTAL EXPRESS SIMULAR”.</small>
          </div>
          <div className="field">
            <label>Modo da simulação</label>
            <select value={modoSimulacao} onChange={(e) => setModoSimulacao(e.target.value)}>
              <option value="rapido">Rápido — impacto financeiro</option>
              <option value="completo">Completo — ranking e ganhadores</option>
            </select>
            <small>
              Rápido calcula somente a transportadora escolhida. Completo otimizado compara apenas concorrentes das mesmas rotas IBGE filtradas.
            </small>
          </div>
          <div className="sim-parametros-box subtle top-space-sm">
            <div className="sim-parametros-header">
              <div>
                <strong>Tabela local da transportadora</strong>
                <p>Use para reduzir consumo do Supabase. O pacote completo pode ser baixado uma vez e depois fica salvo no navegador ou em arquivo JSON na rede.</p>
              </div>
              <span>{tabelasLocais.length.toLocaleString('pt-BR')} de {Math.max((transportadoras || []).filter((item) => item?.nome).length, tabelasLocais.length).toLocaleString('pt-BR')} tabela(s) local(is)</span>
            </div>
            <label className="check-row" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8 }}>
              <input type="checkbox" checked={economizarSupabase} onChange={(e) => setEconomizarSupabase(e.target.checked)} />
              <span>
                Economizar Supabase: usar local sempre que existir
                <small style={{ display: 'block' }}>Com essa opção marcada, o rápido usa a tabela local e o completo usa apenas as tabelas locais importadas. Desmarque só quando quiser baixar do Supabase.</small>
              </span>
            </label>
            <label className="check-row" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8 }}>
              <input type="checkbox" checked={usarTabelaSalvaLocal} onChange={(e) => setUsarTabelaSalvaLocal(e.target.checked)} />
              <span>
                Forçar tabela salva localmente nesta simulação
                <small style={{ display: 'block' }}>Quando marcado, a transportadora selecionada precisa estar salva/importada localmente. Não consulta Supabase.</small>
              </span>
            </label>
            <div className="mini-list top-space-sm">
              <div className="mini-list-row">
                <span>Status da tabela selecionada</span>
                <strong>{tabelaLocalSelecionada ? `Salva em ${formatDateBr(tabelaLocalSelecionada.atualizadoEm)} • ${Number(tabelaLocalSelecionada.contagem?.rotas || 0).toLocaleString('pt-BR')} rota(s) • ${Number(tabelaLocalSelecionada.contagem?.cotacoes || 0).toLocaleString('pt-BR')} faixa(s) • ${Number(tabelaLocalSelecionada.contagem?.taxas || 0).toLocaleString('pt-BR')} taxa(s) • ${Number(tabelaLocalSelecionada.contagem?.generalidades || 0).toLocaleString('pt-BR')} generalidade(s)` : 'Ainda não salva localmente'}</strong>
              </div>
              {tabelaLocalSelecionada ? (
                <div className="mini-list-row">
                  <span>Tamanho aproximado</span>
                  <strong>{formatBytes(tabelaLocalSelecionada.tamanhoBytes)}</strong>
                </div>
              ) : null}
            </div>
            {tabelaLocalSelecionada && (!Number(tabelaLocalSelecionada.contagem?.rotas || 0) || !Number(tabelaLocalSelecionada.contagem?.cotacoes || 0)) ? (
              <div className="sim-alert warn" style={{ marginTop: 10 }}>
                Esta tabela local está incompleta para simulação: precisa ter rota(s) e faixa(s)/cotação(ões). Se apareceu 0 rotas, limpe o pacote local e baixe novamente do Supabase.
              </div>
            ) : null}
            {tabelaLocalSelecionada && Number(tabelaLocalSelecionada.contagem?.generalidades || 0) === 0 ? (
              <div className="sim-alert warn" style={{ marginTop: 10 }}>
                Atenção: esta tabela local está sem generalidades. Se você cadastrou ou corrigiu generalidades da {filtros.transportadora}, clique em <strong>Atualizar/Salvar selecionada</strong> para sobrescrever a cópia local com a versão atual do Supabase.
              </div>
            ) : null}
            {tabelasLocais.length && (transportadoras || []).filter((item) => item?.nome).length > tabelasLocais.length ? (
              <div className="sim-alert warn" style={{ marginTop: 10 }}>
                Hoje existem {tabelasLocais.length.toLocaleString('pt-BR')} tabela(s) salvas no navegador. Para o pacote trazer todas, use <strong>Baixar pacote completo do Supabase</strong> uma vez.
              </div>
            ) : null}
            <div className="button-row" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <button className="btn-secondary" type="button" onClick={salvarTransportadoraSelecionadaLocal} disabled={salvandoTabelaLocal || simulando || importando || !filtros.transportadora} title="Busca a versão atual da transportadora no Supabase e sobrescreve a cópia local, incluindo generalidades.">
                {salvandoTabelaLocal ? 'Atualizando...' : 'Atualizar/Salvar selecionada'}
              </button>
              <button className="btn-secondary" type="button" onClick={() => tabelaLocalInputRef.current?.click()} disabled={salvandoTabelaLocal || simulando || importando}>
                Importar pacote JSON local
              </button>
              <button className="btn-secondary" type="button" onClick={exportarTransportadoraLocal} disabled={!tabelaLocalSelecionada || simulando || importando}>
                Exportar JSON selecionada
              </button>
              <button className="btn-secondary" type="button" onClick={exportarTodasTabelasLocais} disabled={!tabelasLocais.length || simulando || importando || salvandoTabelaLocal}>
                Exportar pacote salvo no navegador
              </button>
              <button className="btn-primary" type="button" onClick={baixarPacoteCompletoSupabase} disabled={simulando || importando || salvandoTabelaLocal}>
                Baixar pacote completo do Supabase
              </button>
              <button className="btn-secondary" type="button" onClick={limparPacoteLocalTransportadoras} disabled={!tabelasLocais.length || simulando || importando || salvandoTabelaLocal}>
                Limpar pacote local
              </button>
              <button className="btn-secondary" type="button" onClick={removerTransportadoraLocal} disabled={!tabelaLocalSelecionada || simulando || importando}>
                Remover local
              </button>
            </div>
            <div className="sim-alert info" style={{ marginTop: 10 }}>
              Para atualizar uma transportadora local, selecione a transportadora e clique em <strong>Atualizar/Salvar selecionada</strong>. Isso consulta o Supabase uma vez e substitui apenas essa transportadora no navegador, mantendo o restante do pacote local.
            </div>
            <input ref={tabelaLocalInputRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={importarTransportadoraLocal} />
          </div>

          <label className="check-row" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8 }}>
            <input type="checkbox" checked={usarMalhaAutomatica} onChange={(e) => setUsarMalhaAutomatica(e.target.checked)} />
            <span>
              Usar malha da transportadora automaticamente
              <small style={{ display: 'block' }}>Mantém período/canal/peso e usa somente as rotas que a transportadora atende.</small>
            </span>
          </label>
          {escopoSimulacao ? (
            <div className="import-meta-box">
              Malha simulada: <strong>{escopoSimulacao.totalRotas.toLocaleString('pt-BR')}</strong> rota(s) úteis • {escopoSimulacao.origens.length.toLocaleString('pt-BR')} origem(ns) • canais: {escopoSimulacao.canais.join(', ') || '—'}
              {escopoSimulacao.totalRotasCadastradas ? <span> • cadastradas: {escopoSimulacao.totalRotasCadastradas.toLocaleString('pt-BR')}</span> : null}
              {escopoSimulacao.rotasSemIbge ? <span> • sem IBGE: {escopoSimulacao.rotasSemIbge.toLocaleString('pt-BR')}</span> : null}
              {escopoSimulacao.rotasCepSemIbge ? <span> • CEP sem IBGE: {escopoSimulacao.rotasCepSemIbge.toLocaleString('pt-BR')}</span> : null}
              {escopoSimulacao.rotasCepSemIbge ? <small style={{ display: 'block', marginTop: 4 }}>Se aparecer CEP sem IBGE, atualize/salve a transportadora selecionada depois de importar a base IBGE/CEP completa.</small> : null}
            </div>
          ) : null}
          <button className="btn-primary full" onClick={simular} disabled={simulando || importando || carregando || !stats.total}>
            {simulando ? 'Simulando local...' : 'Simular no realizado local'}
          </button>
        </section>
      </div>

      <section className="sim-card">
        <div className="sim-parametros-header">
          <div>
            <h2>Painel da base local</h2>
            <p>Visão rápida da última pesquisa local, sem puxar CT-e do Supabase.</p>
          </div>
          <span className="status-pill">{amostra.length.toLocaleString('pt-BR')} linha(s) na amostra</span>
        </div>
        <div className="feature-grid four top-space">
          <MiniTable title="Top transportadoras" tipo="transportadora" rows={resumo?.porTransportadora || []} onSelect={selecionarGrupo} activeKey={grupoAtivoKey} />
          <MiniTable title="Origem" tipo="origem" rows={resumo?.porOrigem || []} onSelect={selecionarGrupo} activeKey={grupoAtivoKey} />
          <MiniTable title="Destino" tipo="destino" rows={resumo?.porDestino || []} onSelect={selecionarGrupo} activeKey={grupoAtivoKey} />
          <MiniTable title="Canal / mês" tipo="canal" rows={resumo?.porCanal || []} onSelect={selecionarGrupo} activeKey={grupoAtivoKey} />
        </div>
        {grupoDetalhe ? (
          <div className="realizado-detail-panel top-space">
            <div>
              <span>Detalhe selecionado</span>
              <strong>{grupoDetalhe.chave}</strong>
              <small>{grupoDetalhe.tipo} • {grupoDetalhe.ctes.toLocaleString('pt-BR')} CT-e(s) • {formatCurrency(grupoDetalhe.frete)} • {formatPercent(grupoDetalhe.percentual)}</small>
            </div>
            <div className="actions-right wrap">
              <button className="btn-secondary" onClick={aplicarGrupoComoFiltro}>Filtrar por este item</button>
              <button className="btn-link" onClick={() => setGrupoDetalhe(null)}>Recolher</button>
            </div>
          </div>
        ) : null}
      </section>

      {resultado ? (
        <section className="sim-card">
          <div className="sim-parametros-header">
            <div>
              <h2>Resultado da simulação local</h2>
              <p>Transportadora simulada: <strong>{filtros.transportadora}</strong> • modo: <strong>{resultado.resumo.modo === 'completo' ? 'Completo' : 'Rápido'}</strong></p>
            </div>
            <button className="btn-secondary" onClick={exportarResultadoSimulacao}>Exportar simulação</button>
          </div>
          <div className="sim-alert info">
            Métrica aplicada: o sistema só considera como carga ganha/alocada quando a transportadora simulada reduz o custo contra o CT-e realizado. Carga em que o valor simulado fica acima do realizado não entra como prejuízo; ela simplesmente não sairia por essa transportadora. {rankingCalculado ? 'No modo completo, além de reduzir custo, a transportadora também precisa ser o menor preço entre as tabelas concorrentes.' : 'No modo rápido, a comparação é somente contra o realizado atual.'}
          </div>
          <div className="sim-analise-resumo top-space">
            <div><span>CT-e(s) avaliados</span><strong>{resultado.resumo.ctesComSimulacao.toLocaleString('pt-BR')}</strong></div>
            <div><span>CT-e(s) que sairia por ela</span><strong>{resultado.resumo.ctesGanharia.toLocaleString('pt-BR')}</strong></div>
            <div><span>% alocação com saving</span><strong>{formatPercent(resultado.resumo.aderencia || 0)}</strong></div>
            <div><span>Faturamento nas cargas ganhas</span><strong>{formatCurrency(resultado.resumo.faturamentoGanhador || 0)}</strong></div>
            <div><span>Saving potencial</span><strong>{formatCurrency(resultado.resumo.savingPotencial || resultado.resumo.economiaGanhador || 0)}</strong></div>
            <div><span>Aumento ignorado / não aloca</span><strong>{formatCurrency(resultado.resumo.aumentoIgnorado || 0)}</strong></div>
            <div><span>Impacto se carregasse tudo</span><strong>{formatCurrency(resultado.resumo.impactoSeCarregasseTudo ?? resultado.resumo.impactoLiquido)}</strong></div>
            <div><span>% frete nas cargas ganhas</span><strong>{formatPercent(resultado.resumo.percentualFreteGanhador || 0)}</strong></div>
            <div><span>Fora da malha</span><strong>{resultado.resumo.ctesForaMalha.toLocaleString('pt-BR')}</strong></div>
          </div>

          <div className="sim-alert success top-space">
            <strong>Visão para negociação:</strong> agora o painel separa o que a transportadora realmente ganharia por preço e mostra onde ela precisa melhorar por rota e faixa de peso. Para B2C, use principalmente as visões de faixa e rota/faixa, porque muitas tabelas são por faixa de kg.
          </div>

          <FornecedorInsightPanel resultado={resultado} transportadora={filtros.transportadora} />

          <AnaliseGerencialTable
            title="Saving mês a mês"
            subtitle="Mostra o potencial real considerando apenas as cargas que sairiam pela transportadora."
            rows={resultado.analises?.porMes || []}
            tipo="mes"
            limit={24}
          />

          <div className="feature-grid two top-space">
            <AnaliseGerencialTable
              title="Onde ela já está competitiva por faixa"
              subtitle="Faixas com maior saving potencial."
              rows={resultado.analises?.porFaixaPeso || []}
              tipo="faixa"
              limit={12}
            />
            <AnaliseGerencialTable
              title="O que precisa melhorar por rota e faixa"
              subtitle="Mostra onde o valor simulado ficou acima da referência e qual redução média seria necessária."
              rows={resultado.analises?.oportunidadesAjuste || []}
              tipo="rota-faixa"
              limit={12}
            />
          </div>

          <AnaliseGerencialTable
            title="Top rotas com saving potencial"
            subtitle="Rotas onde a transportadora gera maior economia real nas cargas que ganharia."
            rows={resultado.analises?.porRota || []}
            tipo="rota"
            limit={20}
          />

          {resultado.resumo.porUf?.length ? (
            <div className="sim-parametros-box top-space">
              <div className="sim-parametros-header"><strong>Resumo por UF destino</strong><span>{resultado.resumo.porUf.length} UF(s)</span></div>
              <div className="sim-table-wrap">
                <table className="sim-table">
                  <thead><tr><th>UF</th><th>CT-e(s)</th><th>Sairia por ela</th><th>% alocação</th><th>Realizado cargas ganhas</th><th>Simulado cargas ganhas</th><th>Saving potencial</th></tr></thead>
                  <tbody>{resultado.resumo.porUf.map((item) => <tr key={item.uf}><td>{item.uf}</td><td>{item.ctes}</td><td>{item.ganharia}</td><td>{formatPercent(item.aderencia || 0)}</td><td>{formatCurrency(item.valorRealizadoGanhador || 0)}</td><td>{formatCurrency(item.valorSimuladoGanhador || 0)}</td><td>{formatCurrency(item.savingPotencial || 0)}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          ) : null}

          {resultado.foraMalha?.length ? (
            <div className="sim-parametros-box top-space">
              <div className="sim-parametros-header"><strong>Fora da malha / pendências</strong><span>{resultado.foraMalha.length.toLocaleString('pt-BR')} CT-e(s)</span></div>
              <div className="sim-table-wrap">
                <table className="sim-table">
                  <thead><tr><th>CT-e</th><th>Canal</th><th>Origem</th><th>Destino</th><th>Peso</th><th>Chave IBGE</th><th>Motivo</th></tr></thead>
                  <tbody>{resultado.foraMalha.slice(0, 30).map((item) => <tr key={item.chaveCte}><td>{item.numeroCte || item.chaveCte?.slice(-8)}</td><td>{item.canal}</td><td>{item.cidadeOrigem}/{item.ufOrigem}</td><td>{item.cidadeDestino}/{item.ufDestino}</td><td>{formatNumber(item.peso, 3)}</td><td>{item.chaveRotaIbge || '—'}</td><td>{item.motivo}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="sim-table-wrap top-space">
            <table className="sim-table">
              <thead><tr><th>CT-e</th><th>Emissão</th><th>Realizada</th><th>Origem → Destino</th><th>Faixa</th><th>Valor CT-e</th><th>Simulado</th><th>Saving considerado</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {resultado.detalhes.slice(0, 100).map((item) => (
                  <Fragment key={item.id}>
                    <tr>
                      <td>{item.numeroCte || item.chaveCte?.slice(-8)}</td>
                      <td>{formatDateBr(item.emissao)}</td>
                      <td>{item.transportadoraRealizada}</td>
                      <td>{item.origem} → {item.cidadeDestino}/{item.ufDestino}</td>
                      <td>{item.faixaPeso || '—'}</td>
                      <td>{formatCurrency(item.valorRealizado)}</td>
                      <td>{formatCurrency(item.valorSimulado)}</td>
                      <td className={item.ganharia ? 'positivo' : ''}>{formatCurrency(item.savingPotencial || 0)}</td>
                      <td title={item.motivoAlocacao || ''}>{rankingLabel(item, rankingCalculado)}</td>
                      <td><button className="link-btn" onClick={() => setDetalheAberto(detalheAberto === item.id ? null : item.id)}>Detalhe</button></td>
                    </tr>
                    {detalheAberto === item.id ? (
                      <tr className="sim-detalhe-row"><td colSpan="10"><DetalheSimulacao item={item} rankingCalculado={rankingCalculado} /></td></tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="table-card">
        <div className="sim-parametros-header">
          <div>
            <div className="panel-title">Amostra da base local enxuta</div>
            <p>Mostrando até 50 CT-e(s) da última pesquisa.</p>
          </div>
          <span className="status-pill">{amostra.length.toLocaleString('pt-BR')} linha(s)</span>
        </div>
        <div className="sim-table-wrap">
          <table className="sim-table">
            <thead><tr><th>Emissão</th><th>CT-e</th><th>Transportadora</th><th>Canal</th><th>Origem</th><th>Destino</th><th>IBGE Origem</th><th>IBGE Destino</th><th>Peso</th><th>Valor CT-e</th><th>Valor NF</th></tr></thead>
            <tbody>
              {amostra.length ? amostra.map((item) => (
                <tr key={item.chaveCte}>
                  <td>{formatDateBr(item.dataEmissao)}</td>
                  <td>{item.numeroCte || item.chaveCte?.slice(-8)}</td>
                  <td>{item.transportadora}</td>
                  <td>{item.canal}</td>
                  <td>{item.cidadeOrigem}/{item.ufOrigem}</td>
                  <td>{item.cidadeDestino}/{item.ufDestino}</td>
                  <td>{item.ibgeOrigem || '—'}</td>
                  <td>{item.ibgeDestino || '—'}</td>
                  <td>{formatNumber(item.peso, 3)}</td>
                  <td>{formatCurrency(item.valorCte)}</td>
                  <td>{formatCurrency(item.valorNF)}</td>
                </tr>
              )) : <tr><td colSpan="11">Nenhum CT-e carregado ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
