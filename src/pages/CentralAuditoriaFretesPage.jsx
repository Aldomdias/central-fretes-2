import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import BaseCtesStatus from '../components/BaseCtesStatus';
import AmdProcessingOverlay from '../components/AmdProcessingOverlay';
import ModalEnviarProtocoloFinanceiro from '../components/ModalEnviarProtocoloFinanceiro';
import DadosBancariosTransportadoras from '../components/DadosBancariosTransportadoras';
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
  buscarDetalhesFaturasPorCtesSupabase,
  carregarDetalhesFaturaSupabase,
  limparDetalhesFaturaSupabase,
  salvarDetalhesFaturaSupabase,
  salvarFaturaSupabase,
} from '../services/lotacaoSupabaseService';
import {
  BOLETO_STATUS,
  ENCERRADOS,
  FATURA_STATUS,
  SOLICITACAO_FINANCEIRA_TIPOS,
  calcularDashboard,
  conciliarPagamentos,
  conciliarPagamentosSap,
  pareceRelatorioPagamentosSap,
  diasAte,
  faixaVencimento,
  isoDate,
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
  buscarResumoOrigensFaturas,
  carregarPlataformaAuditoria,
  carregarPlataformaAuditoriaFinanceiro,
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
  salvarPagamentosFinanceirosEmLote,
  atualizarStatusFaturasPagasEmLote,
  marcarFaturasLancadasFinanceiroEmLote,
  vincularNovaFatura,
  registrarHistoricoCarteiraAuditoria,
  listarHistoricoCarteiraAuditoria,
} from '../services/auditoriaFretesService';
import {
  buscarCtesPorIdentificadores,
  buscarResultadosAuditoriaPorIdentificadores,
  processarCtesPorChave,
  invalidarCacheBaseFreteAuditoriaCte,
  buscarResultadoAuditoriaPorChave,
} from '../services/auditoriaCteProcessamentoService';
import { salvarRecorteCarregadoAuditoria } from '../services/auditoriaService';
import { listarUsuariosSupabase } from '../services/usuariosSupabaseService';
import { getSupabaseClient } from '../lib/supabaseClient';
import { carregarVinculosTransportadoras, criarMapaVinculosTransportadoras, aplicarVinculoTransportadora } from '../services/vinculosTransportadorasService';
import { buscarTrackingPorChaveNfeManual } from '../services/trackingSupabaseService';
import { consultarMunicipiosIbge } from '../services/ibgeService';

const TABS = [
  ['dashboard', 'Dashboard'],
  ['faturas', 'Faturas'],
  ['gestao', 'Centro de Gestores'],
  ['financeiro', 'Central Financeira'],
];
const ULTIMA_CARGA_FATURAS_KEY = 'amd_ultima_carga_faturas_v1';

function carregarUltimaCargaFaturas() {
  try { return JSON.parse(localStorage.getItem(ULTIMA_CARGA_FATURAS_KEY) || 'null'); } catch { return null; }
}

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

function escapeHtmlAuditoria(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function detalheLinhaHtmlAuditoria(label, value) {
  return `<div class="calc-line"><span>${escapeHtmlAuditoria(label)}</span><strong>${escapeHtmlAuditoria(value ?? '-')}</strong></div>`;
}

function formatarDinheiroHtmlAuditoria(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? dinheiro(n) : '-';
}

const OPCOES_LAUDO_TRANSPORTADOR_PADRAO = {
  mostrarCobrancaMaior: true,
  mostrarCobrancaMenor: false,
  mostrarTolerancia: false,
  mostrarSemCalculo: true,
};

const DOCCOB_FORM_PADRAO = {
  filial: '',
  numeroDocumento: '',
  serieDocumento: '',
  dataEmissao: isoDate(),
  dataVencimento: '',
  cnpjTransportadora: '',
  razaoSocialTransportadora: '',
  agenteCobranca: '',
  // "BCO" (cobranca via banco) - confirmado num arquivo real que integrou
  // certo nessa mesma integracao AMD/Verum; "CTE" nao e um codigo valido.
  tipoCobranca: 'BCO',
  cnpjEmissorNf: '',
};

// Decide, para o laudo do transportador, se um CT-e deve ser mascarado como
// "OK" (cobrado = calculado, diferenca zero) conforme as opcoes escolhidas ao
// gerar o laudo. Sem calculo nunca e mascarado como OK — so muda o destaque.
function prepararLinhaLaudoTransportador(item = {}, opts = OPCOES_LAUDO_TRANSPORTADOR_PADRAO, tolerancia = TOLERANCIA_PADRAO) {
  const calculado = Number(item.calculado_frete || 0);
  const diferenca = Number(item.diferenca || 0);
  const semCalculo = calculado <= 0;
  const dentroTolerancia = !semCalculo && dentroDaToleranciaAuditoria(diferenca, tolerancia);
  const cobrancaMenorFora = !semCalculo && !dentroTolerancia && diferenca < 0;
  const cobrancaMaiorFora = !semCalculo && !dentroTolerancia && diferenca > 0;
  const masked = Boolean(opts?.transportador) && !semCalculo && (
    (dentroTolerancia && !opts.mostrarTolerancia)
    || (cobrancaMenorFora && !opts.mostrarCobrancaMenor)
    || (cobrancaMaiorFora && !opts.mostrarCobrancaMaior)
  );
  const statusPublico = semCalculo ? nomeStatus(item.status || 'SEM_CALCULO') : masked ? 'OK' : nomeStatus(item.status || '-');
  const diffPublico = masked ? 0 : diferenca;
  const calculadoPublico = masked ? Number(item.valor_frete || 0) : calculado;
  return { statusPublico, diffPublico, calculadoPublico, masked, semCalculo };
}

// Aplica a mascara acima numa lista inteira, pra que os cards/resumo do laudo
// publico batam exatamente com o que aparece nas linhas/detalhe.
function aplicarMascaraLaudoTransportador(linhas = [], opts = OPCOES_LAUDO_TRANSPORTADOR_PADRAO, tolerancia = TOLERANCIA_PADRAO) {
  if (!opts?.transportador) return linhas;
  return linhas.map((item) => {
    const { masked, diffPublico, calculadoPublico } = prepararLinhaLaudoTransportador(item, opts, tolerancia);
    if (!masked) return item;
    return { ...item, diferenca: diffPublico, calculado_frete: calculadoPublico, status: 'OK' };
  });
}

function detalhesCalculoHtmlFatura(item = {}, opts = {}) {
  const { masked = false, calculadoPublico, diffPublico } = opts;
  if (masked) {
    return `<div class="calc-grid">
      <div class="calc-box"><h4>Resumo do calculo</h4>
        ${detalheLinhaHtmlAuditoria('Frete pago', formatarDinheiroHtmlAuditoria(item.valor_frete))}
        ${detalheLinhaHtmlAuditoria('Calculo', formatarDinheiroHtmlAuditoria(item.valor_frete))}
        ${detalheLinhaHtmlAuditoria('Diferenca', formatarDinheiroHtmlAuditoria(0))}
        ${detalheLinhaHtmlAuditoria('Status', 'OK')}
      </div>
    </div>`;
  }
  const det = parseDetalhesCalculoAuditoria(item.detalhes_calculo);
  if (!det || !Object.keys(det).length) return '<div class="calc-empty">Sem detalhe de calculo salvo para este CT-e.</div>';
  const frete = det.componentes_base || det.frete || {};
  const taxas = det.taxas || {};
  const calculadoFinal = calculadoPublico ?? Number(item.calculado_frete || det.total_calculado || 0);
  const diffFinal = diffPublico ?? Number(item.diferenca || 0);
  const rota = det.rota_nome || det.rota_cotacao || det.rota || `${item.cidade_origem || item.origem || ''} -> ${item.cidade_destino || item.destino || ''}`;
  const taxa = (label, campo) => detalheLinhaHtmlAuditoria(label, formatarDinheiroHtmlAuditoria(taxas?.[campo]));
  return `<div class="calc-grid">
    <div class="calc-box"><h4>Resumo do calculo</h4>
      ${detalheLinhaHtmlAuditoria('Motor', det.motor || 'Auditoria')}
      ${detalheLinhaHtmlAuditoria('Tipo', item.tipo_calculo || det.tipo_calculo || frete.tipoCalculo || '-')}
      ${detalheLinhaHtmlAuditoria('Tabela usada', item.transportadora_tabela || det.transportadora_tabela || item.transportadora || '-')}
      ${detalheLinhaHtmlAuditoria('Canal', item.canal || det.canal || '-')}
      ${detalheLinhaHtmlAuditoria('Origem tabela', det.origem_cidade || det.origem_tabela || item.cidade_origem || '-')}
      ${detalheLinhaHtmlAuditoria('Tabela validada?', det.origem_validada ? `Sim${det.origem_validado_por ? ` (${det.origem_validado_por})` : ''}` : 'Nao')}
      ${detalheLinhaHtmlAuditoria('Rota/cotacao', rota || '-')}
      ${detalheLinhaHtmlAuditoria('Peso usado', `${numeroFmt(det.peso_considerado ?? frete.pesoConsiderado ?? item.peso, 3)} kg`)}
      ${detalheLinhaHtmlAuditoria('Valor NF', formatarDinheiroHtmlAuditoria(det.valor_nf ?? item.valor_nf))}
      ${detalheLinhaHtmlAuditoria('Frete pago', formatarDinheiroHtmlAuditoria(item.valor_frete))}
      ${detalheLinhaHtmlAuditoria('Calculo AMD/local', formatarDinheiroHtmlAuditoria(calculadoFinal))}
      ${detalheLinhaHtmlAuditoria('Diferenca', formatarDinheiroHtmlAuditoria(diffFinal))}
    </div>
    <div class="calc-box"><h4>Base do frete</h4>
      ${detalheLinhaHtmlAuditoria('Percentual aplicado', pctFmt(frete.percentualAplicado ?? frete.percentual_aplicado ?? det.percentual_aplicado))}
      ${detalheLinhaHtmlAuditoria('Valor percentual', formatarDinheiroHtmlAuditoria(frete.valorPercentualCalculado ?? frete.valorPercentual ?? det.valor_percentual))}
      ${detalheLinhaHtmlAuditoria('R$/kg aplicado', formatarDinheiroHtmlAuditoria(frete.rsKgAplicado ?? det.valor_kg_aplicado))}
      ${detalheLinhaHtmlAuditoria('Frete minimo rota', formatarDinheiroHtmlAuditoria(frete.minimoRota ?? det.frete_minimo_rota))}
      ${detalheLinhaHtmlAuditoria('Frete minimo cotacao', formatarDinheiroHtmlAuditoria(frete.freteMinimoCotacao ?? frete.minimoCotacao ?? det.frete_minimo_cotacao))}
      ${detalheLinhaHtmlAuditoria('Minimo aplicavel', formatarDinheiroHtmlAuditoria(frete.minimoAplicavel ?? det.minimo_aplicavel))}
      ${detalheLinhaHtmlAuditoria('Componente vencedor', frete.componenteBase || det.componente_base || '-')}
      ${detalheLinhaHtmlAuditoria('Valor base', formatarDinheiroHtmlAuditoria(det.valor_base ?? frete.valorBase))}
    </div>
    <div class="calc-box"><h4>ICMS e totalizacao</h4>
      ${detalheLinhaHtmlAuditoria('Subtotal antes da emergencial', formatarDinheiroHtmlAuditoria(frete.subtotalSemEmergencial))}
      ${Number(frete.taxaEmergencialPct) > 0 ? detalheLinhaHtmlAuditoria('Taxa emergencial', `${pctFmt(frete.taxaEmergencialPct)} = ${formatarDinheiroHtmlAuditoria(frete.valorEmergencial)}`) : ''}
      ${detalheLinhaHtmlAuditoria('Subtotal sem ICMS', formatarDinheiroHtmlAuditoria(det.subtotal_sem_icms ?? det.subtotal))}
      ${detalheLinhaHtmlAuditoria('Aliquota ICMS', pctFmt(det.aliquota_icms ?? frete.aliquotaIcms))}
      ${detalheLinhaHtmlAuditoria('Origem aliquota', det.origem_aliquota_icms || frete.origemAliquotaIcms || '-')}
      ${detalheLinhaHtmlAuditoria('UF origem/destino', `${item.uf_origem || det.uf_origem_icms || '-'} -> ${item.uf_destino || det.uf_destino_icms || '-'}`)}
      ${detalheLinhaHtmlAuditoria('ICMS', formatarDinheiroHtmlAuditoria(det.icms))}
      ${detalheLinhaHtmlAuditoria('Total calculado', formatarDinheiroHtmlAuditoria(calculadoFinal))}
    </div>
    <div class="calc-box"><h4>Taxas</h4>
      ${taxa('Ad Valorem', 'adValorem')}${taxa('GRIS', 'gris')}${taxa('Pedagio', 'pedagio')}${taxa('TAS', 'tas')}${taxa('CTRC', 'ctrc')}${detalheLinhaHtmlAuditoria('Taxa emergencial', formatarDinheiroHtmlAuditoria(frete.valorEmergencial))}${taxa('TDA', 'tda')}${taxa('TDE', 'tde')}${taxa('TDR', 'tdr')}${taxa('TRT', 'trt')}${taxa('Suframa', 'suframa')}${taxa('Outras', 'outras')}${taxa('Taxa extra', 'taxaExtra')}
    </div>
  </div>`;
}
function extrairIdentificadoresCte(texto = '') {
  return [...new Set(String(texto || '').match(/\d{5,}/g) || [])];
}

function chaveUnicaCteFatura(item = {}) {
  return normalizarChaveCte(item.chave_cte) || normalizarChaveCte(item.numero_cte) || String(item.id || '');
}

function deduplicarDetalhesFatura(lista = []) {
  const mapa = new Map();
  for (const item of lista || []) {
    const chave = chaveUnicaCteFatura(item);
    if (!chave) continue;
    const anterior = mapa.get(chave);
    if (!anterior) {
      mapa.set(chave, item);
      continue;
    }
    const valorAtual = Number(item.valor_frete || 0);
    const valorAnterior = Number(anterior.valor_frete || 0);
    const temCalculoAtual = Number(item.calculado_frete || item.calculado_frete_verum || 0) > 0;
    const temCalculoAnterior = Number(anterior.calculado_frete || anterior.calculado_frete_verum || 0) > 0;
    if ((valorAtual > 0 && valorAnterior <= 0) || (temCalculoAtual && !temCalculoAnterior)) {
      mapa.set(chave, { ...anterior, ...item });
    }
  }
  return [...mapa.values()];
}

function mesclarDetalheComReferenciaAuditoria(item = {}, referenciaCtes = new Map()) {
  const base = referenciaCtes.get(normalizarChaveCte(item.chave_cte))
    || referenciaCtes.get(normalizarChaveCte(item.numero_cte));
  if (!base) return item;
  const valor = Number(item.valor_frete || base.valor_cte || 0);
  // Nao usar item.calculado_frete como fallback: quando a base (resultado
  // fresco da auditoria) diz que nao ha calculo (valor 0), manter o AMD
  // antigo do item junto com o motivo de falha atual e enganoso.
  const amd = Number(base.valor_calculado || 0);
  const verum = Number(base.valor_calculado_verum ?? item.calculado_frete_verum ?? 0);
  const diferenca = amd > 0 ? Number((valor - amd).toFixed(2)) : Number(item.diferenca || 0);
  const diferencaVerum = verum > 0 ? Number((valor - verum).toFixed(2)) : Number(item.diferenca_verum || 0);
  return {
    ...item,
    canal: item.canal || base.canal || '',
    cidade_origem: item.cidade_origem || item.origem || base.cidade_origem || base.origem || '',
    uf_origem: item.uf_origem || base.uf_origem || '',
    cidade_destino: item.cidade_destino || item.destino || base.cidade_destino || base.destino || '',
    uf_destino: item.uf_destino || base.uf_destino || '',
    ibge_origem: item.ibge_origem || base.ibge_origem || '',
    ibge_destino: item.ibge_destino || base.ibge_destino || '',
    peso: Number(item.peso || base.peso || 0),
    valor_frete: valor,
    valor_nf: numeroValorNfAuditoria(item, base) || item.valor_nf || base.valor_nf || base.valorNF || 0,
    // base e o resultado fresco da auditoria (auditoria_cte_resultados) —
    // prioriza sempre ele; item.detalhes_calculo costuma ser antigo/vazio
    // (veio da importacao da fatura, sem o calculo detalhado).
    detalhes_calculo: base.detalhes_calculo || item.detalhes_calculo || null,
    calculado_frete_verum: verum || Number(item.calculado_frete_verum || 0),
    diferenca_verum: diferencaVerum,
    calculado_frete: amd,
    diferenca,
    status: amd > 0 ? (Math.abs(diferenca) <= 0.01 ? 'OK' : 'DIVERGENTE') : (item.status || 'SEM_CALCULO'),
    // Idem: se a base calculou com sucesso (motivo vazio), nao reaproveitar
    // o motivo antigo do item ("Transportadora nao encontrada" de uma
    // checagem anterior) so porque o texto da base esta vazio.
    motivo_divergencia: amd > 0 ? (base.motivo_sem_calculo || '') : (base.motivo_sem_calculo || item.motivo_divergencia || ''),
  };
}
function parseDetalhesCalculoAuditoria(valor) {
  if (!valor) return {};
  if (typeof valor === 'object') return valor;
  try { return JSON.parse(valor); } catch { return {}; }
}

function numeroFlexAuditoria(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  const texto = String(valor ?? '').trim();
  if (!texto) return 0;
  const limpo = texto.replace(/R\$|kg|%/gi, '').replace(/\s/g, '');
  const normalizado = limpo.includes(',')
    ? limpo.replace(/\./g, '').replace(',', '.')
    : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : 0;
}

function numeroValorNfAuditoria(item = {}, base = null) {
  const detalhes = parseDetalhesCalculoAuditoria(item.detalhes_calculo || base?.detalhes_calculo);
  const candidatos = [
    item.valor_nf,
    item.valorNF,
    item.nf_venda,
    item.valor_nota,
    base?.valor_nf,
    base?.valorNF,
    base?.nf_venda,
    base?.valor_nota,
    detalhes.valor_nf,
    detalhes.valorNF,
    detalhes.valorNf,
    detalhes.valor_nota,
    detalhes.valorNfInformado,
    detalhes.valorNFInformado,
    detalhes.resumo?.valor_nf,
    detalhes.resumo?.valorNF,
    detalhes.resumo?.valorNf,
    detalhes.frete?.valorNFInformado,
    detalhes.frete?.valorNf,
    detalhes.frete?.valor_nf,
  ];
  for (const candidato of candidatos) {
    const n = numeroFlexAuditoria(candidato);
    if (n > 0) return n;
  }
  return 0;
}

function temChaveNfAuditoria(item = {}, base = null) {
  const detalhes = parseDetalhesCalculoAuditoria(item.detalhes_calculo || base?.detalhes_calculo);
  const candidatos = [
    item.chave_nf_manual,
    item.chave_nfe_manual,
    item.chave_nfe,
    item.chaveNfe,
    item.chave_nf,
    item.chaveNf,
    base?.chave_nfe,
    base?.chaveNfe,
    base?.chave_nf,
    base?.chaveNf,
    detalhes.chave_nfe,
    detalhes.chaveNfe,
    detalhes.chave_nf,
    detalhes.chaveNf,
  ];
  return candidatos.some((valor) => String(valor || '').replace(/\D/g, '').length >= 30);
}

function chaveNfAuditoria(item = {}, base = null) {
  const detalhes = parseDetalhesCalculoAuditoria(item.detalhes_calculo || base?.detalhes_calculo);
  const candidatos = [
    item.chave_nf_manual,
    item.chave_nfe_manual,
    item.chave_nfe,
    item.chaveNfe,
    item.chave_nf,
    item.chaveNf,
    base?.chave_nfe,
    base?.chaveNfe,
    base?.chave_nf,
    base?.chaveNf,
    detalhes.chave_nfe,
    detalhes.chaveNfe,
    detalhes.chave_nf,
    detalhes.chaveNf,
  ];
  const encontrada = candidatos.find((valor) => String(valor || '').replace(/\D/g, '').length >= 30);
  return String(encontrada || '').replace(/\D/g, '');
}

function detalheSemValorNf(item = {}, base = null) {
  const temValorNf = numeroValorNfAuditoria(item, base) > 0;
  const temCalculo = Number(item.calculado_frete || item.calculado_frete_verum || base?.valor_calculado || base?.valor_calculado_verum || 0) > 0;
  return !temValorNf && !temChaveNfAuditoria(item, base) && !temCalculo;
}

function motivoAuditoriaLinha(item = {}, semValorNf = false) {
  if (semValorNf) return 'Sem valor NF - informar chave NF';
  const motivo = String(item.motivo_divergencia || item.motivo_sem_calculo || '').trim();
  if (/sem\s+valor\s+nf|informar\s+chave\s+nf/i.test(motivo)) return '-';
  return nomeStatus(motivo || '-');
}
function resumirDetalhesAuditoria(lista = [], tolerancia = TOLERANCIA_PADRAO) {
  const total = lista.length;
  const calculados = lista.filter((item) => Number(item.calculado_frete || 0) > 0).length;
  const semCalculo = total - calculados;
  const divergentes = lista.filter((item) =>
    Number(item.calculado_frete || 0) > 0
    && !dentroDaToleranciaAuditoria(Number(item.diferenca || 0), tolerancia)).length;
  const fretePago = lista.reduce((acc, item) => acc + Number(item.valor_frete || 0), 0);
  const calculoAmd = lista.reduce((acc, item) => acc + Number(item.calculado_frete || 0), 0);
  const cobrancaAcima = lista.reduce((acc, item) => {
    const dif = Number(item.diferenca || 0);
    if (Number(item.calculado_frete || 0) <= 0 || dentroDaToleranciaAuditoria(dif, tolerancia)) return acc;
    return acc + Math.max(dif, 0);
  }, 0);
  const cobrancaAbaixo = lista.reduce((acc, item) => {
    const dif = Number(item.diferenca || 0);
    if (Number(item.calculado_frete || 0) <= 0 || dentroDaToleranciaAuditoria(dif, tolerancia)) return acc;
    return acc + Math.abs(Math.min(dif, 0));
  }, 0);
  return {
    total,
    calculados,
    semCalculo,
    divergentes,
    ok: calculados - divergentes,
    fretePago,
    calculoAmd,
    cobrancaAcima,
    cobrancaAbaixo,
    totalDescontar: Math.max(0, cobrancaAcima - cobrancaAbaixo),
  };
}

const AUDITORIA_TOLERANCIA_KEY = 'amd_auditoria_cte_tolerancia_v1';
const TOLERANCIA_PADRAO = { acima: 1, abaixo: 5 };

function carregarToleranciaAuditoria() {
  try {
    const raw = localStorage.getItem(AUDITORIA_TOLERANCIA_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      acima: Number.isFinite(Number(parsed.acima)) ? Number(parsed.acima) : TOLERANCIA_PADRAO.acima,
      abaixo: Number.isFinite(Number(parsed.abaixo)) ? Number(parsed.abaixo) : TOLERANCIA_PADRAO.abaixo,
    };
  } catch {
    return TOLERANCIA_PADRAO;
  }
}

function dentroDaToleranciaAuditoria(diferenca, tolerancia = TOLERANCIA_PADRAO) {
  const valor = Number(diferenca);
  if (!Number.isFinite(valor)) return false;
  const acima = Math.max(0, Number(tolerancia.acima || 0));
  const abaixo = Math.max(0, Number(tolerancia.abaixo || 0));
  return valor <= acima && valor >= -abaixo;
}

// Cor de status de uma linha de CT-e: verde dentro da tolerancia, vermelho
// quando cobrado acima do calculado, amarelo quando cobrado abaixo.
function corStatusLinhaAuditoria(item = {}, tolerancia = TOLERANCIA_PADRAO) {
  if (!(Number(item.calculado_frete || 0) > 0)) return null;
  const diferenca = Number(item.diferenca || 0);
  if (dentroDaToleranciaAuditoria(diferenca, tolerancia)) return { bg: '#f0fdf4', borda: '#16a34a' };
  return diferenca > 0 ? { bg: '#fef2f2', borda: '#dc2626' } : { bg: '#fffbeb', borda: '#d97706' };
}

function baixarArquivoAuditoria(conteudo, nome, tipo) {
  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function pesoAlternativoAuditoriaAvulsa(alt = {}) {
  const peso = Number(alt.peso_considerado || 0);
  if (peso > 0) return peso;
  const cubagem = Number(alt.cubagem_aplicada || 0);
  const fator = Number(alt.fator_cubagem || 0);
  if (cubagem > 0 && fator > 0) return cubagem * fator;
  return Number(alt.peso_cubado_calculado || 0);
}

function valorCalculadoAlternativaAuditoriaAvulsa(alt = {}) {
  return Number(
    alt.valor_calculado
    ?? alt.valorCalculado
    ?? alt.frete_recalculado
    ?? alt.freteRecalculado
    ?? alt.total_calculado
    ?? alt.totalCalculado
    ?? alt.calculo_amd
    ?? alt.calculoAmd
    ?? 0
  );
}

const CAMPOS_TAXAS_CALCULO = ['adValorem', 'gris', 'pedagio', 'tas', 'ctrc', 'tda', 'tde', 'tdr', 'trt', 'suframa', 'outras', 'taxaExtra'];

function somaTaxasCalculo(taxas = {}) {
  return CAMPOS_TAXAS_CALCULO.reduce((acc, campo) => {
    const n = Number(taxas?.[campo] || 0);
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
function PainelDetalheCalculo({ resultado, onMudarPagina, onAbrirTransportadoras }) {
  const [ocultarZeradas, setOcultarZeradas] = useState(false);
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
  const valorEmergencial = Number(frete.valorEmergencial || 0);
  const totalTaxas = somaTaxasCalculo(taxas) + valorEmergencial;
  const taxaExtraDetalhes = Array.isArray(taxas.taxasExtrasDetalhes) ? taxas.taxasExtrasDetalhes : [];
  const linhaTaxa = (label, valorNumero, extra) => {
    if (ocultarZeradas && !(Number(valorNumero) > 0)) return null;
    return linhaDetalhe(label, dinheiroMaybe(valorNumero), extra);
  };
  const comparativoPesos = Array.isArray(det.comparativo_pesos) ? det.comparativo_pesos : [];

  return (
    <>
      {resultado.motivo_sem_calculo ? <div style={{ color: '#b45309', marginBottom: 6 }}><strong>Motivo:</strong> {resultado.motivo_sem_calculo}</div> : null}
      {Number(resultado.valor_calculado || 0) <= 0 ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <button
            className="btn-secondary audit-small-button"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onMudarPagina?.('consulta-ibge');
            }}
            title="Abrir Consulta IBGE para conferir/vincular codigo de cidade usado na rota"
          >
            Encontrar rota/IBGE
          </button>
          <button
            className="btn-secondary audit-small-button"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (onAbrirTransportadoras) onAbrirTransportadoras();
              else onMudarPagina?.('transportadoras');
            }}
            title="Abrir cadastro para vincular o nome da transportadora do CT-e com a tabela cadastrada"
          >
            Vincular transportadora
          </button>
        </div>
      ) : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginTop: 12 }}>
        <div style={{ border: '1px solid #dbe3ef', borderRadius: 8, background: '#fff', padding: 12 }}>
          <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>Resumo do calculo</div>
          {linhaDetalhe('Motor', det.motor === 'simulador_realizado' ? 'Simulador realizado' : 'Auditoria')}
          {linhaDetalhe('Tipo', resultado.tipo_calculo || det.tipo_calculo || frete.tipoCalculo || '-')}
          {linhaDetalhe('Tabela usada', resultado.transportadora_tabela || det.transportadora_tabela || '-')}
          {linhaDetalhe('Canal', resultado.canal || det.canal || '-')}
          {linhaDetalhe('Origem tabela', det.origem_cidade || '-')}
          {linhaDetalhe('Tabela validada?', det.origem_validada ? `Sim${det.origem_validado_por ? ` (${det.origem_validado_por})` : ''}` : 'Não')}
          {det.calculo_devolucao_invertida ? linhaDetalhe('Regra devolucao', det.observacao_devolucao || 'Calculado pela rota de ida equivalente.', true) : null}
          {linhaDetalhe('Rota/cotacao', det.rota_nome || '-')}
          {linhaDetalhe('Peso considerado', `${numeroFmt(det.peso_considerado ?? frete.pesoConsiderado ?? resultado.peso, 3)} kg`)}
          {linhaDetalhe('Valor NF', dinheiroMaybe(resultado.valor_nf), true)}
          {linhaDetalhe('Frete pago', dinheiroMaybe(resultado.valor_cte), true)}
          {linhaDetalhe('Calculado Verum', dinheiroMaybe(resultado.valor_calculado_verum), true)}
          {linhaDetalhe('Calculo AMD/local', dinheiroMaybe(resultado.valor_calculado), true)}
          {linhaDetalhe('Dif. AMD x Verum', dinheiroMaybe(Number(resultado.valor_calculado || 0) - Number(resultado.valor_calculado_verum || 0)), true)}
        </div>
        <div style={{ border: '1px solid #dbe3ef', borderRadius: 8, background: '#fff', padding: 12 }}>
          <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>Base do frete</div>
          {linhaDetalhe('Percentual aplicado', pctFmt(frete.percentualAplicado))}
          {linhaDetalhe('Valor percentual', dinheiroMaybe(frete.valorPercentualCalculado ?? frete.valorPercentual))}
          {linhaDetalhe('R$/kg aplicado', dinheiroMaybe(frete.rsKgAplicado))}
          {linhaDetalhe('Valor kg garantia', dinheiroMaybe(frete.valorKgGarantia ?? frete.valorKg))}
          {frete.composicaoFrete === 'PESO_MAIS_PERCENTUAL' ? linhaDetalhe('Peso + percentual', dinheiroMaybe(frete.valorPesoMaisPercentual), true) : null}
          {linhaDetalhe('Frete minimo rota', dinheiroMaybe(frete.minimoRota))}
          {linhaDetalhe('Frete minimo cotacao', dinheiroMaybe(frete.freteMinimoCotacao ?? frete.minimoCotacao))}
          {linhaDetalhe('Frete minimo geral', dinheiroMaybe(frete.freteMinimoGeneralidade ?? frete.minimoGeneralidade))}
          {linhaDetalhe('Minimo aplicavel', dinheiroMaybe(frete.minimoAplicavel))}
          {linhaDetalhe('Componente vencedor', frete.componenteBase === 'pesoMaisPercentual' ? 'Peso + percentual' : (frete.componenteBase || det.componente_base || '-'), true)}
          {linhaDetalhe('Valor base', dinheiroMaybe(det.valor_base ?? frete.valorBase), true)}
        </div>
        {comparativoPesos.length ? (
          <div style={{ border: '1px solid #dbe3ef', borderRadius: 8, background: '#fff', padding: 12 }}>
            <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>Comparativo de peso</div>
            {linhaDetalhe('Peso declarado CT-e', `${numeroFmt(det.peso_declarado_cte, 3)} kg`)}
            {linhaDetalhe('Peso cubado calculado', `${numeroFmt(det.peso_cubado_tracking, 3)} kg`)}
            {Number(det.peso_cubado_original_tracking) > 0 ? linhaDetalhe('Peso/cubagem original Tracking', numeroFmt(det.peso_cubado_original_tracking, 6)) : null}
            {Number(det.cubagem_tracking) > 0 ? linhaDetalhe('Cubagem Tracking', `${numeroFmt(det.cubagem_tracking, 6)} m³`) : null}
            {comparativoPesos.map((alt) => (
              <div key={alt.nome} style={{ borderTop: '1px solid #e2e8f0', marginTop: 8, paddingTop: 8 }}>
                {linhaDetalhe(alt.nome, dinheiroMaybe(alt.valor_calculado), alt.nome === det.melhor_comparativo_peso)}
                {linhaDetalhe('Peso usado', `${numeroFmt(alt.peso_considerado, 3)} kg`)}
                {Number(alt.cubagem_aplicada) > 0 ? linhaDetalhe('Cubagem usada', `${numeroFmt(alt.cubagem_aplicada, 6)} m³`) : null}
                {Number(alt.fator_cubagem) > 0 ? linhaDetalhe('Fator cubagem', `${numeroFmt(alt.fator_cubagem, 0)} kg/m³`) : null}
                {Number(alt.peso_cubado_calculado) > 0 ? linhaDetalhe('Peso cubado calc.', `${numeroFmt(alt.peso_cubado_calculado, 3)} kg`) : null}
                {linhaDetalhe('Diferença vs pago', dinheiroMaybe(alt.diferenca), alt.nome === det.melhor_comparativo_peso)}
              </div>
            ))}
          </div>
        ) : null}
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontWeight: 800, color: '#0f172a' }}>Taxas</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#64748b', fontWeight: 400, cursor: 'pointer' }}>
              <input type="checkbox" checked={ocultarZeradas} onChange={(e) => setOcultarZeradas(e.target.checked)} />
              Ocultar zeradas
            </label>
          </div>
          {linhaTaxa('Ad Valorem', taxas.adValorem)}
          {linhaTaxa('GRIS', taxas.gris)}
          {linhaTaxa('Pedagio', taxas.pedagio)}
          {linhaTaxa('TAS', taxas.tas)}
          {linhaTaxa('CTRC', taxas.ctrc)}
          {linhaTaxa('Taxa emergencial', valorEmergencial)}
          {linhaTaxa('TDA', taxas.tda)}
          {linhaTaxa('TDE', taxas.tde)}
          {linhaTaxa('TDR', taxas.tdr)}
          {linhaTaxa('TRT', taxas.trt)}
          {linhaTaxa('Suframa', taxas.suframa)}
          {linhaTaxa('Outras', taxas.outras)}
          {linhaTaxa('Taxa extra', taxas.taxaExtra)}
          {taxaExtraDetalhes
            .filter((taxa) => !ocultarZeradas || Number(taxa.valor) > 0)
            .map((taxa, i) => linhaDetalhe(
              `${taxa.nome || `Extra ${i + 1}`}${Number(taxa.valorPorPeso) > 0 ? ` (${dinheiroMaybe(taxa.valorPorPeso)} / ${Number(taxa.pesoBase) || 100} kg)` : ''}`,
              dinheiroMaybe(taxa.valor)
            ))}
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

// Compartilhado entre a Gestao (distribuicao de carteiras) e a importacao de
// faturas — mesma normalizacao pros dois lados baterem o nome da mesma forma.
function normalizarNomeTransportadora(v) {
  return String(v || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

const OPCOES_FILTRO_VENCIMENTO = [
  { value: '', label: 'Todos os vencimentos' },
  { value: 'vence_10', label: 'Vencendo nos próximos 10 dias' },
  { value: 'vence_20', label: 'Vencendo nos próximos 20 dias' },
  { value: 'vence_30', label: 'Vencendo nos próximos 30 dias' },
  { value: 'vencendo', label: 'Vencendo (qualquer prazo futuro)' },
  { value: 'venceu_10', label: 'Venceu nos últimos 10 dias' },
  { value: 'venceu_20', label: 'Venceu nos últimos 20 dias' },
  { value: 'venceu_30', label: 'Venceu nos últimos 30 dias' },
  { value: 'vencida', label: 'Vencida (qualquer prazo)' },
];

function faturaNaJanelaVencimento(fatura, preset) {
  if (!preset || !fatura?.data_vencimento) return false;
  const dias = diasAte(fatura.data_vencimento);
  if (dias == null) return false;
  switch (preset) {
    case 'vence_10': return dias >= 0 && dias <= 10;
    case 'vence_20': return dias >= 0 && dias <= 20;
    case 'vence_30': return dias >= 0 && dias <= 30;
    case 'vencendo': return dias >= 0;
    case 'venceu_10': return dias < 0 && dias >= -10;
    case 'venceu_20': return dias < 0 && dias >= -20;
    case 'venceu_30': return dias < 0 && dias >= -30;
    case 'vencida': return dias < 0;
    default: return false;
  }
}

// Fatura 100% auditada: todos os CT-es vinculados já passaram pelo cálculo
// (auditados >= totais, com pelo menos 1 CT-e). Não exige "sem divergência" —
// só que o resultado já é definitivo, não tem mais nada pendente de cálculo.
function faturaTotalmenteAuditada(fatura) {
  const totais = Number(fatura.ctes_totais || 0);
  const auditados = Number(fatura.ctes_auditados || 0);
  return totais > 0 && auditados >= totais;
}

function situacaoPagamentoFatura(fatura) {
  if (fatura.status === 'PAGA') return 'PAGO';
  if (fatura.status === 'PAGA_COM_DIVERGENCIA') return 'PAGO_DIVERGENTE';
  if (fatura.partida) return 'PARTIDA_LANCADA';
  if (fatura.lancamento_financeiro) return 'LANCADA_FINANCEIRO';
  return 'NAO_PAGO';
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

// Configuracao do que o laudo do transportador mostra. CT-es sem calculo
// nunca viram OK — o checkbox correspondente so controla o destaque visual.
function OpcoesLaudoTransportador({ opcoes, onMudar }) {
  const marcar = (campo) => (event) => onMudar({ ...opcoes, [campo]: event.target.checked });
  return (
    <div className="hint-box compact" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
      <strong>Laudo transportador mostra:</strong>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={opcoes.mostrarCobrancaMaior} onChange={marcar('mostrarCobrancaMaior')} /> Cobranca a maior
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={opcoes.mostrarCobrancaMenor} onChange={marcar('mostrarCobrancaMenor')} /> Cobranca a menor
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={opcoes.mostrarTolerancia} onChange={marcar('mostrarTolerancia')} /> CT-es dentro da tolerancia
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={opcoes.mostrarSemCalculo} onChange={marcar('mostrarSemCalculo')} /> Sem calculo (destacado)
      </label>
    </div>
  );
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
  const [buscaCtes, setBuscaCtes] = useState('');
  const [filtroStatusCte, setFiltroStatusCte] = useState('todos');
  const [filtroCanalCte, setFiltroCanalCte] = useState('todos');
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
  const [correcaoEndereco, setCorrecaoEndereco] = useState({});
  const [salvandoCorrecaoEndereco, setSalvandoCorrecaoEndereco] = useState(null);
  const [correcaoCanal, setCorrecaoCanal] = useState({});
  const [salvandoCorrecaoCanal, setSalvandoCorrecaoCanal] = useState(null);
  const [chaveNfVisivel, setChaveNfVisivel] = useState({});
  const [opcoesLaudoTransportador, setOpcoesLaudoTransportador] = useState(OPCOES_LAUDO_TRANSPORTADOR_PADRAO);
  const [protocoloAberto, setProtocoloAberto] = useState(false);
  const toleranciaFatura = carregarToleranciaAuditoria();
  const detalhesOriginais = state.detalhes[fatura.id] || [];
  const detalhes = useMemo(
    () => deduplicarDetalhesFatura(detalhesOriginais).map((item) => mesclarDetalheComReferenciaAuditoria(item, referenciaCtes)),
    [detalhesOriginais, referenciaCtes]
  );
  const duplicadosRemovidos = Math.max(0, detalhesOriginais.length - detalhes.length);
  const resumoAuditoriaFatura = useMemo(() => resumirDetalhesAuditoria(detalhes, toleranciaFatura), [detalhes, toleranciaFatura.acima, toleranciaFatura.abaixo]);
  const divergencias = detalhes.filter((item) =>
    Number(item.calculado_frete || 0) > 0
    && !dentroDaToleranciaAuditoria(Number(item.diferenca || 0), toleranciaFatura));
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
    const aoTeclar = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [onClose]);

  useEffect(() => {
    let ativo = true;
    setCarregandoDetalhes(true);
    setErroDetalhes('');
    carregarDetalhesFaturaSupabase(fatura.id)
      .then(async (lista) => {
        if (!ativo) return;
        const listaUnica = deduplicarDetalhesFatura(lista || []);
        onState((atual) => ({ ...atual, detalhes: { ...atual.detalhes, [fatura.id]: listaUnica } }));
        // Cruza com a base auditada para exibir rota, peso, canal e valores de referencia.
        const referencia = await buscarReferenciaCtes(listaUnica.flatMap((item) => [item.chave_cte, item.numero_cte]));
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

  const mudarStatus = async (status, extras = {}) => {
    const { descricaoHistorico, ...camposFatura } = extras;
    const next = await atualizarFaturaAuditoria(state, { ...fatura, ...camposFatura, status }, {
      acao: 'STATUS_ALTERADO',
      status_anterior: fatura.status,
      status_novo: status,
      descricao: descricaoHistorico || `Status alterado para ${nomeStatus(status)}.`,
      usuario_nome: sessao?.nome || sessao?.email || 'Usuario local',
      usuario_email: sessao?.email || '',
    });
    onState(next);
  };

  const liberarParaPagamento = async () => {
    const resumo = resumirDetalhesAuditoria(detalhes, toleranciaFatura);
    const saldo = Number((resumo.cobrancaAcima - resumo.cobrancaAbaixo).toFixed(2));
    await mudarStatus('PRONTA_PARA_PAGAMENTO', {
      valor_calculado: Number(resumo.calculoAmd.toFixed(2)),
      diferenca: saldo,
      valor_recuperado: Math.max(saldo, 0),
      ctes_totais: resumo.total,
      ctes_auditados: resumo.calculados,
      ctes_divergentes: resumo.divergentes,
      ctes_sem_calculo: resumo.semCalculo,
      auditoria_cobranca_acima: Number(resumo.cobrancaAcima.toFixed(2)),
      auditoria_cobranca_abaixo: Number(resumo.cobrancaAbaixo.toFixed(2)),
      auditoria_total_descontar: Number(Math.max(saldo, 0).toFixed(2)),
      auditoria_tolerancia_acima: Number(toleranciaFatura.acima || 0),
      auditoria_tolerancia_abaixo: Number(toleranciaFatura.abaixo || 0),
      descricaoHistorico: `Liberada para pagamento. Auditoria: ${resumo.total} CT-e(s), ${resumo.divergentes} divergente(s), cobran�a acima ${dinheiro(resumo.cobrancaAcima)}, cobran�a abaixo ${dinheiro(resumo.cobrancaAbaixo)}, saldo a descontar ${dinheiro(Math.max(saldo, 0))}. Toler�ncia aplicada: +${dinheiro(toleranciaFatura.acima)} / -${dinheiro(toleranciaFatura.abaixo)}.`,
    });
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

  const atualizarDetalheManual = async (item, patch, mensagem = '') => {
    const atualizados = detalhesOriginais.map((det) => (det.id === item.id ? { ...det, ...patch } : det));
    onState((atual) => ({ ...atual, detalhes: { ...atual.detalhes, [fatura.id]: atualizados } }));
    // O painel de detalhe do calculo fica em cache por chave (resultadosDetalhe);
    // sem isso, depois de corrigir endereco/canal o painel continuaria mostrando
    // o resultado antigo ate a pagina ser recarregada.
    if (item.chave_cte) {
      setResultadosDetalhe((atual) => {
        if (!atual.has(item.chave_cte)) return atual;
        const copia = new Map(atual);
        copia.delete(item.chave_cte);
        return copia;
      });
    }
    try {
      await salvarDetalhesFaturaSupabase([{ ...item, ...patch }]);
      if (mensagem) setInfoRecalculo(mensagem);
    } catch (error) {
      setErroDetalhes(error.message || String(error));
    }
  };

  const buscarNfManualTracking = async (item) => {
    const chaveNf = String(item.chave_nf_manual || item.chave_nfe_manual || '').replace(/\D/g, '');
    if (!chaveNf) {
      setErroDetalhes('Informe a chave da NF para buscar no Tracking.');
      return;
    }
    setCarregandoDetalheCte(item.chave_cte || item.id);
    setErroDetalhes('');
    try {
      const tracking = await buscarTrackingPorChaveNfeManual(chaveNf);
      if (!tracking) {
        setErroDetalhes('NF nao encontrada no Tracking. Confira a chave/numero informado.');
        return;
      }
      const patch = {
        chave_nf_manual: chaveNf,
        chave_nfe_manual: chaveNf,
        valor_nf: Number(tracking.valorNF || item.valor_nf || 0),
        peso: Number(tracking.peso || tracking.pesoDeclarado || item.peso || 0),
        cubagem: Number(tracking.cubagemFinal || tracking.cubagemTotal || item.cubagem || 0),
        qtd_volumes: Number(tracking.qtdVolumes || item.qtd_volumes || 0),
        canal: item.canal || tracking.canal || tracking.canalOriginal || '',
        cidade_origem: item.cidade_origem || tracking.cidadeOrigem || '',
        uf_origem: item.uf_origem || tracking.ufOrigem || '',
        cidade_destino: item.cidade_destino || tracking.cidadeDestino || '',
        uf_destino: item.uf_destino || tracking.ufDestino || '',
        ibge_origem: item.ibge_origem || tracking.ibgeOrigem || '',
        ibge_destino: item.ibge_destino || tracking.ibgeDestino || '',
        tracking_manual_nf: true,
        motivo_divergencia: 'NF complementar vinculada manualmente pelo Tracking.',
      };
      await atualizarDetalheManual(item, patch, 'NF localizada no Tracking e vinculada ao CT-e. Recalcule para atualizar a auditoria.');
    } catch (error) {
      setErroDetalhes(error.message || String(error));
    } finally {
      setCarregandoDetalheCte(null);
    }
  };

  const atualizarRascunhoCorrecaoEndereco = (itemId, patch) => {
    setCorrecaoEndereco((atual) => ({
      ...atual,
      [itemId]: { tipo: 'destino', valor: '', justificativa: '', ...atual[itemId], ...patch },
    }));
  };

  const salvarCorrecaoEndereco = async (item) => {
    const rascunho = correcaoEndereco[item.id] || { tipo: 'destino', valor: '', justificativa: '' };
    const valor = String(rascunho.valor || '').trim();
    const justificativa = String(rascunho.justificativa || '').trim();
    if (!valor) {
      setErroDetalhes('Informe o CEP ou o codigo IBGE correto (do rodape do CT-e).');
      return;
    }
    if (!justificativa) {
      setErroDetalhes('Informe a justificativa da correcao de endereco.');
      return;
    }
    setSalvandoCorrecaoEndereco(item.id);
    setErroDetalhes('');
    try {
      const digitos = valor.replace(/\D/g, '');
      let resultados = await consultarMunicipiosIbge({ termo: valor, limite: 1 });
      let municipio = resultados[0];
      if (!municipio && digitos.length === 8) {
        // Faixa CEP->IBGE local nao tem esse CEP cadastrado; tenta o ViaCEP
        // publico pra achar cidade/UF e so entao resolver o IBGE.
        try {
          const resp = await fetch(`https://viacep.com.br/ws/${digitos}/json/`);
          const viaCep = resp.ok ? await resp.json() : null;
          if (viaCep && !viaCep.erro && viaCep.localidade) {
            const porCidade = await consultarMunicipiosIbge({ termo: viaCep.localidade, uf: viaCep.uf, limite: 1 });
            municipio = porCidade[0];
          }
        } catch {
          // Sem internet/ViaCEP fora do ar: segue sem resultado.
        }
      }
      if (!municipio) {
        setErroDetalhes('Nao encontrei cidade para esse CEP/IBGE. Confira o valor informado ou tente o codigo IBGE diretamente.');
        return;
      }
      const ehOrigem = rascunho.tipo === 'origem';
      const patch = ehOrigem ? {
        cidade_origem: municipio.cidade,
        uf_origem: municipio.uf,
        ibge_origem: municipio.ibge,
      } : {
        cidade_destino: municipio.cidade,
        uf_destino: municipio.uf,
        ibge_destino: municipio.ibge,
      };
      patch.endereco_corrigido_manual = true;
      patch.justificativa_correcao_endereco = justificativa;
      patch.motivo_divergencia = `Endereco de ${ehOrigem ? 'origem' : 'destino'} corrigido manualmente para ${municipio.cidade}/${municipio.uf} (endereco do rodape do CT-e). Justificativa: ${justificativa}`;
      await atualizarDetalheManual(item, patch, `Endereco corrigido para ${municipio.cidade}/${municipio.uf}. Recalcule para aplicar.`);
      atualizarRascunhoCorrecaoEndereco(item.id, { valor: '', justificativa: '' });
    } catch (error) {
      setErroDetalhes(error.message || String(error));
    } finally {
      setSalvandoCorrecaoEndereco(null);
    }
  };

  const atualizarRascunhoCorrecaoCanal = (itemId, patch) => {
    setCorrecaoCanal((atual) => ({
      ...atual,
      [itemId]: { canal: '', justificativa: '', ...atual[itemId], ...patch },
    }));
  };

  const salvarCorrecaoCanal = async (item) => {
    const rascunho = correcaoCanal[item.id] || { canal: '', justificativa: '' };
    const canal = String(rascunho.canal || '').trim().toUpperCase();
    const justificativa = String(rascunho.justificativa || '').trim();
    if (!canal) {
      setErroDetalhes('Informe o canal correto do CT-e.');
      return;
    }
    if (!justificativa) {
      setErroDetalhes('Informe a justificativa da correcao de canal.');
      return;
    }
    setSalvandoCorrecaoCanal(item.id);
    setErroDetalhes('');
    try {
      const quemFez = sessao?.nome || sessao?.email || 'Usuario local';
      const patch = {
        canal,
        canal_corrigido_manual: true,
        justificativa_correcao_canal: justificativa,
        canal_corrigido_por: quemFez,
        canal_corrigido_em: new Date().toISOString(),
        motivo_divergencia: `Canal corrigido manualmente de ${item.canal || '?'} para ${canal} por ${quemFez}. Justificativa: ${justificativa}`,
      };
      await atualizarDetalheManual(item, patch, `Canal corrigido para ${canal}. Recalcule para aplicar.`);
      atualizarRascunhoCorrecaoCanal(item.id, { canal: '', justificativa: '' });
    } catch (error) {
      setErroDetalhes(error.message || String(error));
    } finally {
      setSalvandoCorrecaoCanal(null);
    }
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
      const valorNfOverridePorChave = {};
      const trackingOverridePorChave = {};
      const reentregaPorChave = {};
      alvo.forEach((item) => {
        const chave = normalizarChaveCte(item.chave_cte) || normalizarChaveCte(item.numero_cte);
        if (!chave) return;
        if (Number(item.valor_nf || 0) > 0) valorNfOverridePorChave[chave] = Number(item.valor_nf || 0);
        if (item.tracking_manual_nf) {
          trackingOverridePorChave[chave] = {
            ...trackingOverridePorChave[chave],
            chaveNfe: item.chave_nf_manual || item.chave_nfe_manual || '',
            valorNF: Number(item.valor_nf || 0),
            peso: Number(item.peso || 0),
            pesoDeclarado: Number(item.peso || 0),
            cubagemFinal: Number(item.cubagem || 0),
            qtdVolumes: Number(item.qtd_volumes || 0),
            canal: item.canal || '',
            cidadeOrigem: item.cidade_origem || '',
            ufOrigem: item.uf_origem || '',
            cidadeDestino: item.cidade_destino || '',
            ufDestino: item.uf_destino || '',
            ibgeOrigem: item.ibge_origem || '',
            ibgeDestino: item.ibge_destino || '',
          };
        }
        if (item.endereco_corrigido_manual) {
          trackingOverridePorChave[chave] = {
            ...trackingOverridePorChave[chave],
            cidadeOrigem: item.cidade_origem || '',
            ufOrigem: item.uf_origem || '',
            ibgeOrigem: item.ibge_origem || '',
            cidadeDestino: item.cidade_destino || '',
            ufDestino: item.uf_destino || '',
            ibgeDestino: item.ibge_destino || '',
          };
        }
        if (item.canal_corrigido_manual) {
          trackingOverridePorChave[chave] = {
            ...trackingOverridePorChave[chave],
            canal: item.canal || '',
          };
        }
        if (item.reentrega_manual) reentregaPorChave[chave] = true;
      });
      const { registros, encontrados, naoEncontrados } = await processarCtesPorChave(chaves, setProgressoRecalculo, {
        ignorarCubagem: true,
        valorNfOverridePorChave,
        trackingOverridePorChave,
        reentregaPorChave,
      });
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

  const baixarLaudoFatura = (versao = 'interno') => {
    const transportador = versao === 'transportador' || versao === 'email';
    const linhas = detalhes;
    const titulo = transportador ? 'Relatorio de divergencias de frete' : 'Laudo interno de auditoria de fatura';
    const toleranciaLaudo = carregarToleranciaAuditoria();
    const opts = { ...opcoesLaudoTransportador, transportador };
    const linhasParaResumo = aplicarMascaraLaudoTransportador(linhas, opts, toleranciaLaudo);
    const resumo = resumirDetalhesAuditoria(linhasParaResumo, toleranciaLaudo);
    const cards = [
      ['CT-es', resumo.total],
      ['Calculados AMD', resumo.calculados],
      ['Divergentes', resumo.divergentes],
      ['Sem calculo', resumo.semCalculo],
      ['Frete pago', dinheiro(resumo.fretePago)],
      ['Calculo AMD', dinheiro(resumo.calculoAmd)],
      ['Cobranca acima', dinheiro(resumo.cobrancaAcima)],
      ['Cobranca abaixo', dinheiro(resumo.cobrancaAbaixo)],
      ['Total a descontar', dinheiro(resumo.totalDescontar)],
    ];
    const rows = linhas
      .map((item) => {
      const base = referenciaCtes.get(normalizarChaveCte(item.chave_cte))
        || referenciaCtes.get(normalizarChaveCte(item.numero_cte));
      const origem = base?.cidade_origem || item.origem;
      const destino = base?.cidade_destino || item.destino;
      const rota = origem || destino
        ? `${origem || '-'}/${base?.uf_origem || ''} -> ${destino || '-'}/${base?.uf_destino || ''}`
        : '-';
      const { statusPublico, diffPublico, calculadoPublico, masked } = prepararLinhaLaudoTransportador(item, opts, toleranciaLaudo);
      const detalheId = `cte-${escapeHtmlAuditoria(item.numero_cte || item.id || '')}-${Math.random().toString(36).slice(2)}`;
      const pesoLinha = Number(item.peso || base?.peso || 0);
      return `
        <tr class="main-row" onclick="toggleDetail('${detalheId}')">
          <td>${escapeHtmlAuditoria(item.numero_cte || '-')}</td>
          <td>${escapeHtmlAuditoria(item.chave_cte || '-')}</td>
          <td>${escapeHtmlAuditoria(rota)}</td>
          <td>${escapeHtmlAuditoria(item.canal || base?.canal || '-')}</td>
          <td>${pesoLinha > 0 ? `${numeroFmt(pesoLinha, 3)} kg` : '-'}</td>
          <td>${dinheiro(item.valor_frete)}</td>
          <td>${Number(item.calculado_frete || 0) ? dinheiro(calculadoPublico) : '-'}</td>
          <td>${dinheiro(diffPublico)}</td>
          <td>${escapeHtmlAuditoria(statusPublico)}</td>
        </tr>
        <tr id="${detalheId}" class="detail-row"><td colspan="9">${detalhesCalculoHtmlFatura(item, { masked, calculadoPublico, diffPublico })}</td></tr>`;
    }).join('');
    const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtmlAuditoria(titulo)} - ${escapeHtmlAuditoria(fatura.numero_fatura)}</title>
  <style>
    body{font-family:Arial,sans-serif;color:#061a44;margin:0;background:#f4f7fb}
    .hero{background:#071d49;color:white;padding:26px 34px}
    .wrap{padding:24px 34px}
    .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:18px 0}
    .card{border:1px solid #d6e0ef;border-radius:12px;background:white;padding:14px}
    .card span{display:block;color:#64748b;font-size:12px;font-weight:700}
    .card strong{display:block;font-size:22px;margin-top:6px}
    table{width:100%;border-collapse:collapse;background:white;border:1px solid #d6e0ef;border-radius:12px;overflow:hidden}
    th,td{border-bottom:1px solid #e5ebf5;padding:9px 10px;text-align:left;font-size:12px}
    th{background:#eef4ff}.main-row{cursor:pointer}.main-row:hover{background:#f8fbff}.detail-row{display:none;background:#fbfdff}.detail-row.open{display:table-row}.calc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}.calc-box{border:1px solid #dbe3ef;border-radius:10px;background:white;padding:12px}.calc-box h4{margin:0 0 8px}.calc-line{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #e5ebf5;padding:4px 0}.calc-line span{color:#64748b}.calc-line strong{text-align:right}.calc-empty{color:#64748b}.note{padding:12px 14px;border-radius:8px;background:#eff6ff;color:#1e3a8a;margin:16px 0;font-size:13px;font-weight:600}
    .report-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:16px 0}
    .export-button{border:0;border-radius:8px;background:#0f6b3e;color:#fff;font-weight:700;padding:11px 16px;cursor:pointer;white-space:nowrap}
    .filters{display:grid;grid-template-columns:minmax(240px,2fr) minmax(170px,1fr) auto auto;align-items:end;gap:10px;padding:12px;margin:0 0 12px;background:#f8fafc;border:1px solid #d6e0ef;border-radius:9px}
    .filters label{display:flex;flex-direction:column;gap:5px;color:#475569;font-size:11px;font-weight:700}
    .filters input,.filters select{box-sizing:border-box;width:100%;border:1px solid #cbd5e1;border-radius:7px;background:#fff;padding:9px;color:#0f172a}
    .clear-button{border:1px solid #cbd5e1;border-radius:7px;background:#fff;padding:9px 12px;cursor:pointer}
    .filters strong{padding:9px 0;white-space:nowrap}
    @media(max-width:850px){.filters{grid-template-columns:1fr 1fr}.filters label:first-child{grid-column:1/-1}}
    @media print{.filters,.export-button{display:none}}
  </style>
</head>
<body>
  <div class="hero">
    <h1>${escapeHtmlAuditoria(titulo)}</h1>
    <p>Fatura ${escapeHtmlAuditoria(fatura.numero_fatura)} - ${escapeHtmlAuditoria(fatura.transportadora)} - gerado em ${new Date().toLocaleString('pt-BR')}</p>
  </div>
  <div class="wrap">
    <div class="cards">${cards.map(([label, value]) => `<div class="card"><span>${escapeHtmlAuditoria(label)}</span><strong>${escapeHtmlAuditoria(value)}</strong></div>`).join('')}</div>
    <div class="note">Clique em cima de qualquer CT-e na tabela abaixo para abrir os detalhes completos do calculo (taxas, ICMS, base do frete etc.).</div>
    <div class="filters">
      <label>Buscar<input id="filtro-busca" type="search" placeholder="CT-e, chave, rota ou canal" oninput="aplicarFiltros()"></label>
      <label>Situacao<select id="filtro-status" onchange="aplicarFiltros()">
        <option value="">Todas</option>
        <option value="DIVERGENTE">Somente divergentes</option>
        <option value="OK">OK</option>
      </select></label>
      <button type="button" class="clear-button" onclick="limparFiltros()">Limpar filtros</button>
      <strong id="resultado-filtro"></strong>
    </div>
    <div class="report-actions">
      <button class="export-button" type="button" onclick="exportarExcel()">Exportar Excel</button>
    </div>
    <table>
      <thead><tr><th>CT-e</th><th>Chave</th><th>Rota</th><th>Canal</th><th>Peso</th><th>Frete pago</th><th>Calculo AMD</th><th>Diferenca</th><th>Status</th></tr></thead>
      <tbody id="tabela-fatura-body">${rows || '<tr><td colspan="9">Nenhum CT-e encontrado nesta fatura.</td></tr>'}</tbody>
    </table>
  </div>
  <script>
    function toggleDetail(id){var el=document.getElementById(id);if(!el)return;el.style.display='';el.classList.toggle('open')}
    function normalizarFiltro(v){return String(v||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toUpperCase()}
    function aplicarFiltros(){
      var busca=normalizarFiltro(document.getElementById('filtro-busca').value);
      var status=document.getElementById('filtro-status').value;
      var visiveis=0;
      document.querySelectorAll('#tabela-fatura-body .main-row').forEach(function(row){
        var cols=row.cells;
        var texto=normalizarFiltro(row.textContent);
        var statusLinha=String(cols[8]&&cols[8].textContent||'').trim().toUpperCase();
        var atendeStatus=!status||(status==='DIVERGENTE'?statusLinha!=='OK':statusLinha===status);
        var mostrar=(!busca||texto.includes(busca))&&atendeStatus;
        row.style.display=mostrar?'':'none';
        var detalhe=row.nextElementSibling;
        if(!mostrar&&detalhe&&detalhe.classList.contains('detail-row')){detalhe.style.display='none';detalhe.classList.remove('open')}
        if(mostrar)visiveis++;
      });
      document.getElementById('resultado-filtro').textContent=visiveis+' CT-e(s) exibido(s)';
    }
    function limparFiltros(){
      document.getElementById('filtro-busca').value='';
      document.getElementById('filtro-status').value='';
      aplicarFiltros();
    }
    function exportarExcel(){
      var corpo=document.getElementById('tabela-fatura-body');
      var tabela=corpo.closest('table');
      var copia=tabela.cloneNode(true);
      Array.from(copia.querySelectorAll('.detail-row')).forEach(function(row){row.remove()});
      Array.from(copia.querySelectorAll('tbody tr')).forEach(function(row){
        if(row.style.display==='none')row.remove();
      });
      var conteudo='<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body>'+copia.outerHTML+'</body></html>';
      var blob=new Blob(['\\ufeff',conteudo],{type:'application/vnd.ms-excel;charset=utf-8'});
      var url=URL.createObjectURL(blob);
      var link=document.createElement('a');
      link.href=url;
      link.download='laudo_fatura_${escapeHtmlAuditoria(fatura.numero_fatura)}.xls';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function(){URL.revokeObjectURL(url)},1000);
    }
    aplicarFiltros();
  </script>
</body>
</html>`;
    const sufixo = versao === 'email' ? 'email_transportador' : versao;
    baixarArquivo(new Blob([html], { type: 'text/html;charset=utf-8' }), `laudo_fatura_${fatura.numero_fatura}_${sufixo}.html`);
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

  const ctesNaBase = detalhes.filter((item) =>
    referenciaCtes.has(normalizarChaveCte(item.chave_cte))
    || referenciaCtes.has(normalizarChaveCte(item.numero_cte))).length;

  const canaisDisponiveisCtes = [...new Set(detalhes.map((item) =>
    item.canal || referenciaCtes.get(normalizarChaveCte(item.chave_cte))?.canal
    || referenciaCtes.get(normalizarChaveCte(item.numero_cte))?.canal).filter(Boolean))];

  const statusFiltroCte = (item, base) => {
    const semValorNf = detalheSemValorNf(item, base);
    if (semValorNf) return 'sem_nf';
    const cor = corStatusLinhaAuditoria(item, toleranciaFatura);
    if (!cor) return 'sem_calculo';
    if (cor.borda === '#16a34a') return 'ok';
    return cor.borda === '#dc2626' ? 'acima' : 'abaixo';
  };

  const aplicarFiltrosCtes = (lista) => lista.filter((item) => {
    const base = referenciaCtes.get(normalizarChaveCte(item.chave_cte))
      || referenciaCtes.get(normalizarChaveCte(item.numero_cte));
    if (filtroCanalCte !== 'todos' && (item.canal || base?.canal || '') !== filtroCanalCte) return false;
    if (filtroStatusCte !== 'todos' && statusFiltroCte(item, base) !== filtroStatusCte) return false;
    if (buscaCtes.trim()) {
      const termo = buscaCtes.trim().toLowerCase();
      const alvo = [item.numero_cte, item.chave_cte, base?.cidade_origem, base?.cidade_destino, base?.uf_origem, base?.uf_destino]
        .map((v) => String(v || '').toLowerCase()).join(' ');
      if (!alvo.includes(termo)) return false;
    }
    return true;
  });

  const tabelaCtes = (listaOriginal) => {
    const lista = aplicarFiltrosCtes(listaOriginal);
    return (
    <div className="sim-analise-tabela-wrap">
      {detalhes.length > 0 && (
        <p className="compact">
          Mostrando {lista.length} de {listaOriginal.length} CT-e(s){listaOriginal.length !== detalhes.length ? '' : ` da fatura`}. {ctesNaBase} ja cruzaram com a base auditada
          {ctesNaBase < detalhes.length ? '; os demais continuam listados para auditoria.' : '.'}
        </p>
      )}
      <div className="form-grid three" style={{ marginBottom: 10 }}>
        <label className="field">Buscar (CT-e, chave, cidade, UF)
          <input value={buscaCtes} onChange={(e) => setBuscaCtes(e.target.value)} placeholder="Digite para filtrar..." />
        </label>
        <label className="field">Status
          <select value={filtroStatusCte} onChange={(e) => setFiltroStatusCte(e.target.value)}>
            <option value="todos">Todos</option>
            <option value="ok">Dentro da tolerancia</option>
            <option value="acima">Cobrado acima</option>
            <option value="abaixo">Cobrado abaixo</option>
            <option value="sem_calculo">Sem calculo</option>
            <option value="sem_nf">Sem valor NF</option>
          </select>
        </label>
        <label className="field">Canal
          <select value={filtroCanalCte} onChange={(e) => setFiltroCanalCte(e.target.value)}>
            <option value="todos">Todos</option>
            {canaisDisponiveisCtes.map((canal) => <option key={canal} value={canal}>{canal}</option>)}
          </select>
        </label>
      </div>
      <table className="sim-analise-tabela">
        <thead><tr><th></th><th>CT-e</th><th>Chave</th><th>Rota (base)</th><th>Canal</th><th>Peso</th><th>Valor</th><th>Verum</th><th>Dif. Verum</th><th>AMD</th><th>Dif. AMD</th><th>Motivo</th><th>Status</th></tr></thead>
        <tbody>
          {lista.map((item) => {
            const base = referenciaCtes.get(normalizarChaveCte(item.chave_cte))
              || referenciaCtes.get(normalizarChaveCte(item.numero_cte));
            const expandido = cteExpandido === item.id;
            const semValorNf = detalheSemValorNf(item, base);
            const corStatus = semValorNf ? null : corStatusLinhaAuditoria(item, toleranciaFatura);
            const estiloLinha = semValorNf
              ? { background: '#fff7ed', boxShadow: 'inset 4px 0 #f97316' }
              : corStatus
                ? { background: corStatus.bg, boxShadow: `inset 4px 0 ${corStatus.borda}`, outline: expandido ? '2px solid #3b82f6' : undefined, outlineOffset: expandido ? '-2px' : undefined }
                : expandido ? { background: '#eff6ff' } : undefined;
            return (
              <Fragment key={item.id}>
                <tr style={estiloLinha}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selecionados.includes(item.id)} onChange={() => selecionar(item.id)} /></td>
                  <td style={{ cursor: 'pointer' }} onClick={() => alternarDetalheCte(item)}>{item.numero_cte || '-'}</td>
                  <td style={{ cursor: 'pointer' }} onClick={() => alternarDetalheCte(item)}><small>{item.chave_cte || '-'}</small></td>
                  <td style={{ cursor: 'pointer' }} onClick={() => alternarDetalheCte(item)}>{base ? <small>{base.cidade_origem || '?'}/{base.uf_origem || '?'} → {base.cidade_destino || '?'}/{base.uf_destino || '?'}</small> : <small className="error-text">Fora da base</small>}</td>
                  <td style={{ cursor: 'pointer' }} onClick={() => alternarDetalheCte(item)}>{base?.canal || '-'}</td>
                  <td style={{ cursor: 'pointer' }} onClick={() => alternarDetalheCte(item)}>{base?.peso || item.peso ? Number(base?.peso || item.peso).toLocaleString('pt-BR') : '-'}</td>
                  <td style={{ cursor: 'pointer' }} onClick={() => alternarDetalheCte(item)}>{dinheiro(item.valor_frete)}</td>
                  <td style={{ cursor: 'pointer' }} onClick={() => alternarDetalheCte(item)}>{Number(item.calculado_frete_verum || 0) ? dinheiro(item.calculado_frete_verum) : 'Sem calculo'}</td>
                  <td style={{ cursor: 'pointer' }} className={Number(item.diferenca_verum || 0) ? 'negativo' : ''} onClick={() => alternarDetalheCte(item)}>{Number(item.calculado_frete_verum || 0) ? dinheiro(item.diferenca_verum) : '-'}</td>
                  <td style={{ cursor: 'pointer' }} onClick={() => alternarDetalheCte(item)}>{Number(item.calculado_frete || 0) ? dinheiro(item.calculado_frete) : 'Sem calculo'}</td>
                  <td style={{ cursor: 'pointer' }} className={Number(item.diferenca || 0) ? 'negativo' : ''} onClick={() => alternarDetalheCte(item)}>{dinheiro(item.diferenca)}</td>
                  <td style={{ cursor: 'pointer' }} onClick={() => alternarDetalheCte(item)}>{motivoAuditoriaLinha(item, semValorNf)}</td>
                  <td style={{ cursor: 'pointer' }} onClick={() => alternarDetalheCte(item)}><Status value={item.status} /></td>
                </tr>
                {expandido && (
                  <tr>
                    <td colSpan="13" style={{ background: '#f8fafc', fontSize: 12, color: '#475569' }}>
                      <div className="hint-box compact" style={{ marginBottom: 10, borderColor: semValorNf ? '#fdba74' : '#dbe3ef', background: semValorNf ? '#fff7ed' : '#f8fafc' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                          <strong>{semValorNf ? 'CT-e sem valor NF identificado.' : 'Ajustes manuais do CT-e'}</strong>
                          <button
                            className="btn-secondary audit-small-button"
                            type="button"
                            onClick={() => setChaveNfVisivel((atual) => ({ ...atual, [item.id]: !atual[item.id] }))}
                          >
                            {chaveNfVisivel[item.id] ? 'Ocultar chave da NF' : 'Exibir chave da NF'}
                          </button>
                        </div>
                        {chaveNfVisivel[item.id] ? (
                          <p className="compact">
                            Chave da NF: <strong>{chaveNfAuditoria(item, base) || 'Nao identificada para este CT-e.'}</strong>
                          </p>
                        ) : null}
                        <div className="form-grid three" style={{ marginTop: 8 }}>
                          {semValorNf ? (
                            <label className="field">Chave NF para buscar no Tracking
                              <input
                                defaultValue={item.chave_nf_manual || item.chave_nfe_manual || ''}
                                placeholder="Cole a chave NF ou numero da nota"
                                onBlur={(event) => atualizarDetalheManual(item, {
                                  chave_nf_manual: event.target.value.replace(/\D/g, ''),
                                  chave_nfe_manual: event.target.value.replace(/\D/g, ''),
                                })}
                              />
                            </label>
                          ) : null}
                          <label className="field">Reentrega
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 36 }}>
                              <input
                                type="checkbox"
                                checked={Boolean(item.reentrega_manual)}
                                onChange={(event) => atualizarDetalheManual(item, {
                                  reentrega_manual: event.target.checked,
                                  motivo_divergencia: event.target.checked ? 'CT-e marcado manualmente como reentrega: calcular 50% da ida.' : item.motivo_divergencia,
                                }, event.target.checked ? 'Reentrega marcada. Recalcule para aplicar 50% do valor da ida.' : 'Reentrega desmarcada.')}
                              />
                              <span>Aplicar 50% do calculo da ida</span>
                            </span>
                          </label>
                          {semValorNf ? (
                            <div className="audit-form-actions">
                              <button className="btn-secondary audit-small-button" type="button" onClick={() => buscarNfManualTracking(item)}>
                                Buscar NF no Tracking
                              </button>
                            </div>
                          ) : null}
                        </div>
                        {item.tracking_manual_nf ? (
                          <p className="compact">NF vinculada manualmente pelo Tracking. Valor NF: <strong>{dinheiro(item.valor_nf)}</strong>; peso: <strong>{numeroFmt(item.peso, 3)} kg</strong>.</p>
                        ) : null}
                      </div>
                      <div className="hint-box compact" style={{ marginBottom: 10, borderColor: '#93c5fd', background: '#eff6ff' }}>
                        <strong>Corrigir endereco pelo rodape do CT-e</strong>
                        <p className="compact">Se o endereco correto (CEP/IBGE) estiver no rodape do CT-e e divergir da base, informe aqui. Ao salvar e recalcular, o calculo AMD passa a usar esse endereco.</p>
                        <div className="form-grid three" style={{ marginTop: 8 }}>
                          <label className="field">Endereco a corrigir
                            <select
                              value={correcaoEndereco[item.id]?.tipo || 'destino'}
                              onChange={(event) => atualizarRascunhoCorrecaoEndereco(item.id, { tipo: event.target.value })}
                            >
                              <option value="destino">Destino</option>
                              <option value="origem">Origem</option>
                            </select>
                          </label>
                          <label className="field">CEP ou IBGE correto (rodape)
                            <input
                              value={correcaoEndereco[item.id]?.valor || ''}
                              placeholder="Ex: 88300000 ou 4208203"
                              onChange={(event) => atualizarRascunhoCorrecaoEndereco(item.id, { valor: event.target.value })}
                            />
                          </label>
                          <label className="field">Justificativa (obrigatoria)
                            <input
                              value={correcaoEndereco[item.id]?.justificativa || ''}
                              placeholder="Ex: rodape do CT-e informa CEP divergente da NF"
                              onChange={(event) => atualizarRascunhoCorrecaoEndereco(item.id, { justificativa: event.target.value })}
                            />
                          </label>
                        </div>
                        <div className="audit-form-actions" style={{ marginTop: 8 }}>
                          <button
                            className="btn-secondary audit-small-button"
                            type="button"
                            disabled={salvandoCorrecaoEndereco === item.id}
                            onClick={() => salvarCorrecaoEndereco(item)}
                          >
                            {salvandoCorrecaoEndereco === item.id ? 'Salvando...' : 'Salvar correcao de endereco'}
                          </button>
                        </div>
                        {item.endereco_corrigido_manual ? (
                          <p className="compact">Endereco corrigido manualmente. Origem: <strong>{item.cidade_origem || '-'}/{item.uf_origem || '-'}</strong>; destino: <strong>{item.cidade_destino || '-'}/{item.uf_destino || '-'}</strong>. Justificativa: {item.justificativa_correcao_endereco || '-'}</p>
                        ) : null}
                      </div>
                      <div className="hint-box compact" style={{ marginBottom: 10, borderColor: '#c4b5fd', background: '#f5f3ff' }}>
                        <strong>Corrigir canal do CT-e</strong>
                        <p className="compact">Canal atual: <strong>{item.canal || base?.canal || '-'}</strong>. Se o canal cadastrado estiver errado (ex: saiu como B2C mas era Atacado), informe o correto abaixo. Ao salvar e recalcular, o AMD passa a usar esse canal.</p>
                        <div className="form-grid three" style={{ marginTop: 8 }}>
                          <label className="field">Canal correto
                            <select
                              value={correcaoCanal[item.id]?.canal || ''}
                              onChange={(event) => atualizarRascunhoCorrecaoCanal(item.id, { canal: event.target.value })}
                            >
                              <option value="">Selecione...</option>
                              {[...new Set([...canaisDisponiveisCtes, 'ATACADO', 'B2C', 'AMBOS'])].map((canal) => (
                                <option key={canal} value={canal}>{canal}</option>
                              ))}
                            </select>
                          </label>
                          <label className="field">Justificativa (obrigatoria)
                            <input
                              value={correcaoCanal[item.id]?.justificativa || ''}
                              placeholder="Ex: NF confirma pedido Atacado, tabela estava marcada B2C"
                              onChange={(event) => atualizarRascunhoCorrecaoCanal(item.id, { justificativa: event.target.value })}
                            />
                          </label>
                          <div className="audit-form-actions">
                            <button
                              className="btn-secondary audit-small-button"
                              type="button"
                              disabled={salvandoCorrecaoCanal === item.id}
                              onClick={() => salvarCorrecaoCanal(item)}
                            >
                              {salvandoCorrecaoCanal === item.id ? 'Salvando...' : 'Salvar correcao de canal'}
                            </button>
                          </div>
                        </div>
                        {item.canal_corrigido_manual ? (
                          <p className="compact">Canal corrigido manualmente para <strong>{item.canal}</strong> por <strong>{item.canal_corrigido_por || '-'}</strong>{item.canal_corrigido_em ? ` em ${dataBr(item.canal_corrigido_em)}` : ''}. Justificativa: {item.justificativa_correcao_canal || '-'}</p>
                        ) : null}
                      </div>
                      {carregandoDetalheCte === (item.chave_cte || item.id)
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
  };

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

      <div className="summary-strip auditoria-avulsa-summary">
        <Card label="CT-es" value={resumoAuditoriaFatura.total} />
        <Card label="Calculados AMD" value={resumoAuditoriaFatura.calculados} />
        <Card label="Divergentes" value={resumoAuditoriaFatura.divergentes} color={resumoAuditoriaFatura.divergentes ? '#dc2626' : '#047857'} />
        <Card label="Sem calculo" value={resumoAuditoriaFatura.semCalculo} color={resumoAuditoriaFatura.semCalculo ? '#d97706' : '#047857'} />
        <Card label="Frete pago" value={dinheiro(resumoAuditoriaFatura.fretePago)} />
        <Card label="Calculo AMD" value={dinheiro(resumoAuditoriaFatura.calculoAmd)} />
        <Card label="Cobranca acima" value={dinheiro(resumoAuditoriaFatura.cobrancaAcima)} color="#dc2626" />
        <Card label="Cobranca abaixo" value={dinheiro(resumoAuditoriaFatura.cobrancaAbaixo)} color="#d97706" />
        <Card label="Total a descontar" value={dinheiro(resumoAuditoriaFatura.totalDescontar)} color={resumoAuditoriaFatura.totalDescontar ? '#d97706' : '#047857'} />
      </div>
      {duplicadosRemovidos > 0 && (
        <div className="hint-box compact">
          {duplicadosRemovidos} linha(s) repetida(s) do bloco foram ocultadas. A fatura esta sendo analisada com um registro por CT-e.
        </div>
      )}

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
            <label className="field">Data de compensacao<input value={fatura.data_pagamento ? dataBr(fatura.data_pagamento) : '-'} readOnly /></label>
            <label className="field">Partida<input value={fatura.partida || '-'} readOnly /></label>
            <label className="field">Valor pago<input value={fatura.valor_pago ? dinheiro(fatura.valor_pago) : '-'} readOnly /></label>
            <label className="field">Data do lancamento financeiro<input value={fatura.lancamento_financeiro_em ? dataBr(fatura.lancamento_financeiro_em) : '-'} readOnly /></label>
            <label className="field">Lancamento financeiro<input value={fatura.lancamento_financeiro || '-'} readOnly /></label>
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
      <OpcoesLaudoTransportador opcoes={opcoesLaudoTransportador} onMudar={setOpcoesLaudoTransportador} />
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
        <button className="btn-secondary" disabled={!detalhes.length} onClick={() => baixarLaudoFatura('interno')}>Laudo HTML</button>
        <button className="btn-secondary" disabled={!detalhes.length} onClick={() => baixarLaudoFatura('transportador')}>Laudo transportador</button>
        <button className="btn-secondary" disabled={!detalhes.length} onClick={() => baixarLaudoFatura('email')}>HTML e-mail</button>
        <button className="btn-secondary" disabled={!selecionados.length} onClick={() => exportarDoccob('EDI')}>Gerar DOCCOB EDI (Verum)</button>
        <button className="btn-secondary" disabled={!selecionados.length} onClick={() => exportarDoccob('CSV')}>Gerar DOCCOB CSV</button>
        <button className="btn-secondary" disabled={!selecionados.length} onClick={() => exportarDoccob('XLSX')}>Gerar DOCCOB XLSX</button>
        <button className="btn-secondary" onClick={() => mudarStatus('AGUARDANDO_NOVA_FATURA')}>Solicitar nova fatura</button>
        <button className="btn-primary" onClick={liberarParaPagamento}>Liberar para pagamento</button>
        <button
          className="btn-primary"
          disabled={ENCERRADOS.has(fatura.status)}
          title={ENCERRADOS.has(fatura.status) ? 'Fatura encerrada' : 'Preparar e enviar a fatura para o Protocolo Financeiro'}
          onClick={() => setProtocoloAberto(true)}
        >
          Enviar para Protocolo
        </button>
      </div>
      {protocoloAberto && (
        <ModalEnviarProtocoloFinanceiro
          state={state}
          fatura={fatura}
          detalhes={detalhes}
          tolerancia={toleranciaFatura}
          sessao={sessao}
          onClose={() => setProtocoloAberto(false)}
          onState={onState}
        />
      )}
    </div>
  );
}

const PERFIS_VEEM_TODAS_FATURAS = new Set(['GESTAO', 'GESTOR_AUDITORIA_FRETES', 'FINANCEIRO']);

function Faturas({ state, onState, modo = 'faturas', onMudarPagina, onAbrirTransportadoras }) {
  const mostrarAuditoriaAvulsa = modo === 'auditoria-cte';
  const mostrarFaturas = modo === 'faturas';
  const sessao = carregarSessao();
  const arquivoRef = useRef(null);
  const [filtro, setFiltro] = useState('');
  const [filtroFaturasLote, setFiltroFaturasLote] = useState('');
  const [status, setStatus] = useState('');
  const [filtroPagamento, setFiltroPagamento] = useState('');
  const [canalFiltro, setCanalFiltro] = useState('');
  // Auditor entra ja filtrado nas proprias faturas; gestor/financeiro entram vendo tudo.
  const [visaoFatura, setVisaoFatura] = useState(() => (PERFIS_VEEM_TODAS_FATURAS.has(sessao?.perfil) ? 'todas' : 'minhas'));
  const [filtroRapido, setFiltroRapido] = useState('');
  const [paginaFaturas, setPaginaFaturas] = useState(1);
  const TAM_PAGINA_FATURAS = 100;
  const [somenteAuditadas, setSomenteAuditadas] = useState(false);
  const [detectandoCanais, setDetectandoCanais] = useState(false);
  const [progressoCanais, setProgressoCanais] = useState(null);
  const [progressoImportacao, setProgressoImportacao] = useState(null);
  const [aberta, setAberta] = useState(null);
  const [importando, setImportando] = useState(false);
  const [mensagemImportacao, setMensagemImportacao] = useState('');
  const [ultimaCargaFaturas, setUltimaCargaFaturas] = useState(carregarUltimaCargaFaturas);
  const [selecionadasIds, setSelecionadasIds] = useState([]);
  const [statusLote, setStatusLote] = useState('');
  const [auditorLote, setAuditorLote] = useState('');
  const [emailAuditorLote, setEmailAuditorLote] = useState('');
  const [origemFiltroFatura, setOrigemFiltroFatura] = useState('');
  const [auditorFiltro, setAuditorFiltro] = useState('');
  const [filtrosAvancadosAbertos, setFiltrosAvancadosAbertos] = useState(false);
  const [resumoOrigensFaturas, setResumoOrigensFaturas] = useState(new Map());
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
  const [toleranciaAuditoria, setToleranciaAuditoria] = useState(carregarToleranciaAuditoria);
  const [toleranciaAberta, setToleranciaAberta] = useState(false);
  const [usarPesoCteAvulso, setUsarPesoCteAvulso] = useState(true);
  const [percentualContingenciaAvulso, setPercentualContingenciaAvulso] = useState(0);
  const [apenasDadosCompletosAvulso, setApenasDadosCompletosAvulso] = useState(true);
  const [filtroAuditoriaAvulsa, setFiltroAuditoriaAvulsa] = useState('todos');
  const [mostrarDiferencaNegativaLaudoTransportador, setMostrarDiferencaNegativaLaudoTransportador] = useState(false);
  const [opcoesLaudoTransportadorLote, setOpcoesLaudoTransportadorLote] = useState(OPCOES_LAUDO_TRANSPORTADOR_PADRAO);
  const [ctesSelecionadosDoccob, setCtesSelecionadosDoccob] = useState([]);
  const [doccobFormAberto, setDoccobFormAberto] = useState(false);
  const [doccobForm, setDoccobForm] = useState(DOCCOB_FORM_PADRAO);
  const [doccobNumerosNf, setDoccobNumerosNf] = useState({});
  const [doccobCnpjEmissorPorItem, setDoccobCnpjEmissorPorItem] = useState({});
  const [doccobImportandoContingencia, setDoccobImportandoContingencia] = useState('');
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
  const alterarToleranciaAuditoria = (campo, valor) => {
    const proxima = {
      ...toleranciaAuditoria,
      [campo]: Math.max(0, Number(valor || 0)),
    };
    setToleranciaAuditoria(proxima);
    localStorage.setItem(AUDITORIA_TOLERANCIA_KEY, JSON.stringify(proxima));
  };
  const numerosFaturasLote = useMemo(() => extrairIdentificadoresCte(filtroFaturasLote), [filtroFaturasLote]);
  const numerosFaturasLoteSet = useMemo(() => new Set(numerosFaturasLote.map((item) => normalizarChaveCte(item))), [numerosFaturasLote]);
  const dentroVisaoFatura = (fatura) => {
    if (visaoFatura === 'todas') return true;
    const emailAuditor = String(fatura.auditor_email || '').trim().toLowerCase();
    const nomeAuditor = String(fatura.auditor_nome || '').trim().toLowerCase();
    if (visaoFatura === 'sem_auditor') return !emailAuditor && !nomeAuditor;
    const meuEmail = String(sessao?.email || '').trim().toLowerCase();
    const meuNome = String(sessao?.nome || '').trim().toLowerCase();
    return (!!meuEmail && emailAuditor === meuEmail) || (!!meuNome && nomeAuditor === meuNome);
  };
  const dentroFiltroRapido = (fatura) => {
    if (!filtroRapido) return true;
    if (filtroRapido === 'vencidas') return faixaVencimento(fatura) === 'VENCIDA';
    if (filtroRapido === 'a_vencer') {
      const dias = diasAte(fatura.data_vencimento);
      return dias != null && dias >= 0 && dias <= 7 && !ENCERRADOS.has(fatura.status);
    }
    if (filtroRapido === 'novas') return fatura.status === 'RECEBIDA';
    if (filtroRapido === 'enviadas') return fatura.status === 'ENVIADA_AO_FINANCEIRO';
    if (filtroRapido === 'lancadas') return ['PARTIDA_LANCADA', 'LANCADA_FINANCEIRO'].includes(situacaoPagamentoFatura(fatura));
    if (filtroRapido === 'pagas') return ['PAGO', 'PAGO_DIVERGENTE'].includes(situacaoPagamentoFatura(fatura));
    if (filtroRapido === 'pagas_divergentes') return situacaoPagamentoFatura(fatura) === 'PAGO_DIVERGENTE';
    return true;
  };
  // Base pros cards do topo: so a visao (minhas/todas/sem auditor), sem os
  // demais filtros - assim os numeros ficam estaveis enquanto o auditor
  // pesquisa/filtra a tabela abaixo.
  const faturasEscopo = useMemo(() => state.faturas.filter(dentroVisaoFatura), [state.faturas, visaoFatura, sessao?.email, sessao?.nome]);
  const resumoCards = useMemo(() => ({
    vencidas: faturasEscopo.filter((fatura) => faixaVencimento(fatura) === 'VENCIDA').length,
    aVencer: faturasEscopo.filter((fatura) => {
      const dias = diasAte(fatura.data_vencimento);
      return dias != null && dias >= 0 && dias <= 7 && !ENCERRADOS.has(fatura.status);
    }).length,
    novas: faturasEscopo.filter((fatura) => fatura.status === 'RECEBIDA').length,
    enviadas: faturasEscopo.filter((fatura) => fatura.status === 'ENVIADA_AO_FINANCEIRO').length,
    lancadas: faturasEscopo.filter((fatura) => ['PARTIDA_LANCADA', 'LANCADA_FINANCEIRO'].includes(situacaoPagamentoFatura(fatura))).length,
    pagas: faturasEscopo.filter((fatura) => ['PAGO', 'PAGO_DIVERGENTE'].includes(situacaoPagamentoFatura(fatura))).length,
    pagasDivergentes: faturasEscopo.filter((fatura) => situacaoPagamentoFatura(fatura) === 'PAGO_DIVERGENTE').length,
  }), [faturasEscopo]);
  // Predicados nomeados (um por filtro) em vez de um && gigante: assim da pra
  // montar as opcoes de cada select considerando os OUTROS filtros ja
  // aplicados (estilo planilha) - ex.: se ja filtrou por Status, o select de
  // Auditor so mostra auditores que aparecem nas faturas daquele status.
  const predicadosFatura = {
    busca: (fatura) => {
      if (!filtro) return true;
      const texto = `${fatura.numero_fatura} ${fatura.transportadora} ${fatura.auditor_nome}`.toLowerCase();
      return texto.includes(filtro.toLowerCase());
    },
    lote: (fatura) => !numerosFaturasLoteSet.size || numerosFaturasLoteSet.has(normalizarChaveCte(fatura.numero_fatura)),
    origem: (fatura) => {
      if (!origemFiltroFatura) return true;
      const origemResumo = resumoOrigensFaturas.get(fatura.id);
      const textoOrigens = (origemResumo?.origens || []).map((item) => item.origem).join(' ').toLowerCase();
      return textoOrigens.includes(origemFiltroFatura.toLowerCase());
    },
    status: (fatura) => !status || fatura.status === status,
    canal: (fatura) => !canalFiltro || fatura.canal === canalFiltro,
    auditor: (fatura) => !auditorFiltro || fatura.auditor_nome === auditorFiltro,
    somenteAuditadas: (fatura) => !somenteAuditadas || faturaTotalmenteAuditada(fatura),
    competencia: (fatura) => !competenciaFiltro || (fatura.data_emissao || '').slice(0, 7) === competenciaFiltro,
    periodoInicio: (fatura) => !periodoInicio || ((fatura.data_emissao || '').slice(0, 10) >= periodoInicio),
    periodoFim: (fatura) => !periodoFim || ((fatura.data_emissao || '').slice(0, 10) <= periodoFim),
    vencimentoInicio: (fatura) => !vencimentoInicio || ((fatura.data_vencimento || '').slice(0, 10) >= vencimentoInicio),
    vencimentoFim: (fatura) => !vencimentoFim || ((fatura.data_vencimento || '').slice(0, 10) <= vencimentoFim),
    pagamento: (fatura) => !filtroPagamento || situacaoPagamentoFatura(fatura) === filtroPagamento,
    visao: dentroVisaoFatura,
    rapido: dentroFiltroRapido,
  };
  const passaFiltros = (fatura, ignorar) => Object.entries(predicadosFatura)
    .every(([chave, predicado]) => chave === ignorar || predicado(fatura));

  const lista = state.faturas
    .filter((fatura) => passaFiltros(fatura))
    // Vencimento do menor pro maior - fatura sem vencimento vai pro final.
    .sort((a, b) => {
      if (!a.data_vencimento && !b.data_vencimento) return 0;
      if (!a.data_vencimento) return 1;
      if (!b.data_vencimento) return -1;
      return a.data_vencimento.localeCompare(b.data_vencimento);
    });

  const canaisDisponiveis = [...new Set(
    state.faturas.filter((fatura) => passaFiltros(fatura, 'canal')).map((item) => item.canal).filter(Boolean)
  )].sort();
  const auditoresDisponiveis = [...new Set(
    state.faturas.filter((fatura) => passaFiltros(fatura, 'auditor')).map((item) => item.auditor_nome).filter(Boolean)
  )].sort();
  // Competencia = mes/ano da emissao (nao existe campo proprio na fatura).
  const competenciasDisponiveis = [...new Set(
    state.faturas.filter((fatura) => passaFiltros(fatura, 'competencia')).map((item) => (item.data_emissao || '').slice(0, 7)).filter(Boolean)
  )].sort().reverse();

  // Renderizar milhares de linhas de tabela de uma vez e' o que deixa a tela
  // lenta pra abrir/fechar uma fatura (o React precisa desmontar/remontar
  // tudo isso a cada troca) - pagina no cliente pra manter o DOM leve.
  const totalPaginasFaturas = Math.max(1, Math.ceil(lista.length / TAM_PAGINA_FATURAS));
  const paginaFaturasAtual = Math.min(paginaFaturas, totalPaginasFaturas);
  const listaPaginada = lista.slice(
    (paginaFaturasAtual - 1) * TAM_PAGINA_FATURAS,
    paginaFaturasAtual * TAM_PAGINA_FATURAS,
  );
  const chaveFiltrosFaturas = [
    filtro, status, canalFiltro, auditorFiltro, filtroPagamento, origemFiltroFatura, somenteAuditadas,
    competenciaFiltro, periodoInicio, periodoFim, vencimentoInicio, vencimentoFim,
    filtroFaturasLote, visaoFatura, filtroRapido,
  ].join('|');
  useEffect(() => {
    setPaginaFaturas(1);
  }, [chaveFiltrosFaturas]);

  const resultadoCtesAvulsosFiltrado = useMemo(() => resultadoCtesAvulsos.filter((row) => {
    const calculado = Number(row.valor_calculado || 0) > 0;
    const ok = calculado && dentroDaToleranciaAuditoria(row.diferenca, toleranciaAuditoria);
    const divergente = calculado && !ok;
    if (filtroAuditoriaAvulsa === 'divergentes') return divergente;
    if (filtroAuditoriaAvulsa === 'ok') return ok;
    if (filtroAuditoriaAvulsa === 'sem_calculo') return !calculado;
    if (filtroAuditoriaAvulsa === 'devolucao') return Boolean(row.detalhes_calculo?.calculo_devolucao_invertida);
    if (filtroAuditoriaAvulsa === 'peso_alt') {
      return Array.isArray(row.detalhes_calculo?.comparativo_pesos)
        && row.detalhes_calculo.comparativo_pesos.some((alt) => pesoAlternativoAuditoriaAvulsa(alt) > 0);
    }
    return true;
  }), [resultadoCtesAvulsos, filtroAuditoriaAvulsa, toleranciaAuditoria]);

  useEffect(() => {
    if (!mostrarFaturas || !listaPaginada.length) {
      setResumoOrigensFaturas(new Map());
      return;
    }
    let ativo = true;
    const ids = listaPaginada.map((item) => item.id);
    buscarResumoOrigensFaturas(ids)
      .then((mapa) => {
        if (ativo) setResumoOrigensFaturas(mapa);
      })
      .catch(() => {
        if (ativo) setResumoOrigensFaturas(new Map());
      });
    return () => {
      ativo = false;
    };
  }, [mostrarFaturas, listaPaginada.map((item) => item.id).join('|')]);

  const resumoAuditoriaAvulsa = useMemo(() => {
    const resumo = resultadoCtesAvulsos.reduce((acc, row) => {
    const calculado = Number(row.valor_calculado || 0) > 0;
    const diferenca = Number(row.diferenca || 0);
    const ok = calculado && dentroDaToleranciaAuditoria(diferenca, toleranciaAuditoria);
    acc.total += 1;
    acc.pago += Number(row.valor_cte || 0);
    acc.amd += Number(row.valor_calculado || 0);
    if (calculado) acc.calculados += 1;
    if (ok) acc.ok += 1;
    if (calculado && !ok) acc.divergentes += 1;
    if (!calculado) acc.semCalculo += 1;
    if (calculado && !ok && diferenca > 0) acc.cobrancaAcima += diferenca;
    if (calculado && !ok && diferenca < 0) acc.cobrancaAbaixo += Math.abs(diferenca);
    return acc;
    }, {
    total: 0,
    calculados: 0,
    ok: 0,
    divergentes: 0,
    semCalculo: 0,
    pago: 0,
    amd: 0,
    cobrancaAcima: 0,
    cobrancaAbaixo: 0,
    totalDescontar: 0,
    });
    return {
      ...resumo,
      totalDescontar: Math.max(resumo.cobrancaAcima - resumo.cobrancaAbaixo, 0),
    };
  }, [resultadoCtesAvulsos, toleranciaAuditoria]);

  const localizarFaturasPorChaves = async (chaves = [], numeros = []) => {
    const alvo = new Set(chaves.map(normalizarChaveCte).filter(Boolean));
    const numerosAlvo = new Set(numeros.map((item) => String(item || '').replace(/\D/g, '')).filter(Boolean));
    if (!alvo.size && !numerosAlvo.size) return [];

    const detalhesAlvo = await buscarDetalhesFaturasPorCtesSupabase({
      chaves: Array.from(alvo),
      numeros: Array.from(numerosAlvo),
    }).catch(() => []);
    const faturaIds = [...new Set((detalhesAlvo || []).map((item) => item.fatura_id).filter(Boolean))];
    if (!faturaIds.length) return [];

    const faturasAfetadas = [];
    for (const faturaId of faturaIds) {
      const fatura = state.faturas.find((item) => item.id === faturaId);
      if (!fatura) continue;
      let detalhes = state.detalhes?.[faturaId] || [];
      if (!detalhes.length) {
        try {
          detalhes = await carregarDetalhesFaturaSupabase(faturaId);
        } catch {
          detalhes = detalhesAlvo.filter((item) => item.fatura_id === faturaId);
        }
      }
      faturasAfetadas.push({ fatura, detalhes });
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

  const numeroSeguro = (valor) => {
    const n = Number(valor);
    return Number.isFinite(n) ? n : 0;
  };

  const primeiroValor = (obj, campos) => {
    for (const campo of campos) {
      if (obj?.[campo] !== undefined && obj?.[campo] !== null && obj?.[campo] !== '') return obj[campo];
    }
    return null;
  };

  const chaveResultadoAuditoria = (row = {}) => (
    String(row.chave_cte || row.chaveCte || row.chave || '').replace(/\D/g, '')
    || String(row.numero_cte || row.numeroCte || row.cte || row.nro_cte || '').replace(/\D/g, '')
  );

  const linhaConsultaCteAvulso = (cte = {}, resultadoSalvo = null) => {
    const valorCte = numeroSeguro(primeiroValor(cte, ['valor_cte', 'valorCte', 'valor_frete', 'frete']));
    const valorVerum = numeroSeguro(primeiroValor(cte, [
      'valor_calculado',
      'valorCalculado',
      'frete_calculado',
      'freteCalculado',
      'valor_tabela',
      'valorTabela',
      'valor_simulado',
      'valorSimulado',
    ]));
    const peso = numeroSeguro(primeiroValor(cte, ['peso', 'peso_final', 'pesoFinal', 'peso_declarado', 'pesoDeclarado']));
    const base = {
      competencia: String(primeiroValor(cte, ['competencia', 'mes_competencia']) || '').slice(0, 7),
      data_emissao: primeiroValor(cte, ['data_emissao', 'emissao', 'dataEmissao']),
      chave_cte: primeiroValor(cte, ['chave_cte', 'chaveCte', 'chave']),
      numero_cte: primeiroValor(cte, ['numero_cte', 'numeroCte', 'cte', 'nro_cte']),
      transportadora: primeiroValor(cte, ['transportadora', 'nome_transportadora', 'transportadora_realizada', 'transportador']),
      cidade_origem: primeiroValor(cte, ['cidade_origem', 'cidadeOrigem', 'origem']),
      uf_origem: String(primeiroValor(cte, ['uf_origem', 'ufOrigem']) || '').toUpperCase(),
      cidade_destino: primeiroValor(cte, ['cidade_destino', 'cidadeDestino', 'destino']),
      uf_destino: String(primeiroValor(cte, ['uf_destino', 'ufDestino']) || '').toUpperCase(),
      canal: primeiroValor(cte, ['canal', 'canal_original']),
      peso,
      peso_declarado: numeroSeguro(primeiroValor(cte, ['peso_declarado', 'pesoDeclarado', 'peso'])),
      peso_cubado: numeroSeguro(primeiroValor(cte, ['peso_cubado', 'pesoCubado'])),
      cubagem: numeroSeguro(primeiroValor(cte, ['cubagem', 'cubagem_total', 'cubagemTotal'])),
      qtd_volumes: numeroSeguro(primeiroValor(cte, ['qtd_volumes', 'qtdVolumes', 'volumes'])),
      valor_nf: numeroSeguro(primeiroValor(cte, ['valor_nf', 'valorNF', 'nf_venda', 'valor_nota'])),
      valor_cte: valorCte,
      valor_calculado_verum: valorVerum,
      diferenca_verum: valorVerum > 0 ? valorCte - valorVerum : 0,
      valor_calculado: valorVerum,
      diferenca: valorVerum > 0 ? valorCte - valorVerum : 0,
      status_calculo: 'CONSULTADO',
      status_auditoria: valorVerum > 0 ? 'VERUM' : 'PENDENTE',
      motivo_sem_calculo: valorVerum > 0
        ? 'CT-e carregado com c�lculo Verum. Clique em Auditar CT-es para calcular AMD.'
        : 'CT-e carregado. Clique em Auditar CT-es para calcular AMD.',
      tracking_status: 'NAO_CONSULTADO',
      detalhes_calculo: null,
    };
    if (!resultadoSalvo) return base;
    const amdSalvo = numeroSeguro(resultadoSalvo.valor_calculado);
    const verumSalvo = numeroSeguro(resultadoSalvo.valor_calculado_verum);
    const verumFinal = verumSalvo > 0 ? verumSalvo : valorVerum;
    return {
      ...base,
      ...resultadoSalvo,
      valor_cte: numeroSeguro(resultadoSalvo.valor_cte) || valorCte,
      valor_calculado_verum: verumFinal,
      diferenca_verum: verumFinal > 0 ? (numeroSeguro(resultadoSalvo.valor_cte) || valorCte) - verumFinal : 0,
      valor_calculado: amdSalvo > 0 ? amdSalvo : verumFinal,
      diferenca: amdSalvo > 0
        ? numeroSeguro(resultadoSalvo.diferenca)
        : (verumFinal > 0 ? (numeroSeguro(resultadoSalvo.valor_cte) || valorCte) - verumFinal : 0),
      status_auditoria: amdSalvo > 0 ? resultadoSalvo.status_auditoria : (verumFinal > 0 ? 'VERUM' : 'PENDENTE'),
      motivo_sem_calculo: amdSalvo > 0
        ? resultadoSalvo.motivo_sem_calculo
        : 'CT-e carregado com c�lculo Verum. Clique em Auditar CT-es para calcular AMD.',
    };
  };

  const consultarCtesAvulsos = async () => {
    const ids = extrairIdentificadoresCte(buscaCtesAvulsa);
    if (!ids.length) {
      setMensagemImportacao('Cole uma chave de CT-e ou uma lista de CT-es para consultar.');
      return;
    }
    setAuditandoCtesAvulsos(true);
    setProgressoCtesAvulsos(null);
    setResultadoCtesAvulsos([]);
    setResultadoCtesAvulsosSalvos(false);
    setCteAvulsoExpandido(null);
    try {
      setMensagemImportacao('Consultando CT-es e auditorias salvas...');
      const [base, salvos] = await Promise.all([
        buscarCtesPorIdentificadores(ids, setProgressoCtesAvulsos),
        buscarResultadosAuditoriaPorIdentificadores(ids, setProgressoCtesAvulsos).catch(() => []),
      ]);
      const salvosPorChave = new Map((salvos || []).map((row) => [chaveResultadoAuditoria(row), row]));
      const linhas = (base.ctes || []).map((cte) => linhaConsultaCteAvulso(cte, salvosPorChave.get(chaveResultadoAuditoria(cte))));
      setResultadoCtesAvulsos(linhas);
      setResultadoCtesAvulsosSalvos(linhas.some((row) => Number(row.valor_calculado || 0) > 0 && row.detalhes_calculo));
      setMensagemImportacao(
        `Consulta concluida: ${base.encontrados} CT-e(s) encontrado(s)${base.naoEncontrados ? `, ${base.naoEncontrados} nao encontrado(s)` : ''}. `
        + 'Clique em Auditar CT-es para recalcular AMD quando necessario.',
      );
    } catch (error) {
      setMensagemImportacao(`Erro ao consultar CT-es: ${error.message}`);
    } finally {
      setAuditandoCtesAvulsos(false);
      setProgressoCtesAvulsos(null);
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
      const valorNfOverridePorChave = {};
      const trackingOverridePorChave = {};
      const reentregaPorChave = {};
      resultadoCtesAvulsos.forEach((row) => {
        const chave = chaveResultadoAuditoria(row);
        if (!chave) return;
        if (Number(row.valor_nf || 0) > 0) valorNfOverridePorChave[chave] = Number(row.valor_nf || 0);
        if (row.tracking_manual_nf) {
          trackingOverridePorChave[chave] = {
            chaveNfe: row.chave_nf_manual || row.chave_nfe_manual || '',
            valorNF: Number(row.valor_nf || 0),
            peso: Number(row.peso || 0),
            pesoDeclarado: Number(row.peso_declarado || row.peso || 0),
            cubagemFinal: Number(row.cubagem || 0),
            qtdVolumes: Number(row.qtd_volumes || 0),
            canal: row.canal || '',
            cidadeOrigem: row.cidade_origem || '',
            ufOrigem: row.uf_origem || '',
            cidadeDestino: row.cidade_destino || '',
            ufDestino: row.uf_destino || '',
            ibgeOrigem: row.ibge_origem || '',
            ibgeDestino: row.ibge_destino || '',
          };
        }
        if (row.reentrega_manual) reentregaPorChave[chave] = true;
      });
      const { registros, encontrados, naoEncontrados } = await processarCtesPorChave(ids, setProgressoCtesAvulsos, {
        ignorarCubagem: usarPesoCteAvulso,
        percentualContingenciaPeso: percentualContingenciaAvulso,
        apenasDadosCompletos: apenasDadosCompletosAvulso,
        valorNfOverridePorChave,
        trackingOverridePorChave,
        reentregaPorChave,
      });
      setResultadoCtesAvulsos(registros);
      if (registros.length) {
        await salvarAuditoriaAvulsa(registros);
      } else {
        setMensagemImportacao(`Auditoria avulsa concluida: ${encontrados} CT-e(s) encontrado(s)${naoEncontrados ? `, ${naoEncontrados} nao encontrado(s)` : ''}. Nenhum registro foi gravado.`);
      }
    } catch (error) {
      setMensagemImportacao(`Erro na auditoria avulsa: ${error.message}`);
    } finally {
      setAuditandoCtesAvulsos(false);
      setProgressoCtesAvulsos(null);
    }
  };

  const atualizarCteAvulsoManual = (row, patch) => {
    const chave = chaveResultadoAuditoria(row);
    setResultadoCtesAvulsos((atuais) => atuais.map((item) => (
      chaveResultadoAuditoria(item) === chave ? { ...item, ...patch } : item
    )));
    setResultadoCtesAvulsosSalvos(false);
  };

  const buscarNfManualTrackingAvulso = async (row) => {
    const chaveNf = String(row.chave_nf_manual || row.chave_nfe_manual || '').replace(/\D/g, '');
    if (!chaveNf) {
      setMensagemImportacao('Informe a chave da NF para buscar no Tracking.');
      return;
    }
    setAuditandoCtesAvulsos(true);
    try {
      const tracking = await buscarTrackingPorChaveNfeManual(chaveNf);
      if (!tracking) {
        setMensagemImportacao('NF nao encontrada no Tracking. Confira a chave/numero informado.');
        return;
      }
      atualizarCteAvulsoManual(row, {
        chave_nf_manual: chaveNf,
        chave_nfe_manual: chaveNf,
        valor_nf: Number(tracking.valorNF || row.valor_nf || 0),
        peso: Number(tracking.peso || tracking.pesoDeclarado || row.peso || 0),
        peso_declarado: Number(tracking.pesoDeclarado || tracking.peso || row.peso_declarado || 0),
        cubagem: Number(tracking.cubagemFinal || tracking.cubagemTotal || row.cubagem || 0),
        qtd_volumes: Number(tracking.qtdVolumes || row.qtd_volumes || 0),
        canal: row.canal || tracking.canal || tracking.canalOriginal || '',
        cidade_origem: row.cidade_origem || tracking.cidadeOrigem || '',
        uf_origem: row.uf_origem || tracking.ufOrigem || '',
        cidade_destino: row.cidade_destino || tracking.cidadeDestino || '',
        uf_destino: row.uf_destino || tracking.ufDestino || '',
        ibge_origem: row.ibge_origem || tracking.ibgeOrigem || '',
        ibge_destino: row.ibge_destino || tracking.ibgeDestino || '',
        tracking_manual_nf: true,
        motivo_sem_calculo: 'NF complementar vinculada manualmente pelo Tracking. Clique em Auditar CT-es para recalcular.',
      });
      setMensagemImportacao('NF localizada no Tracking e vinculada ao CT-e. Clique em Auditar CT-es para recalcular.');
    } catch (error) {
      setMensagemImportacao(`Erro ao buscar NF no Tracking: ${error.message}`);
    } finally {
      setAuditandoCtesAvulsos(false);
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
      const { registros } = await processarCtesPorChave(todasChaves, setProgressoLote, { ignorarCubagem: true });
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

  const aplicarPesoAlternativoAvulso = async (row, alternativa) => {
    const peso = pesoAlternativoAuditoriaAvulsa(alternativa);
    if (!peso) return;
    const chaveAlvo = chaveResultadoAuditoria(row);
    if (!chaveAlvo) return;
    const valorAlternativo = valorCalculadoAlternativaAuditoriaAvulsa(alternativa);
    if (valorAlternativo > 0) {
      const diferencaAlternativa = Number(row.valor_cte || 0) - valorAlternativo;
      const atualizadoImediato = {
        ...row,
        peso,
        valor_calculado: valorAlternativo,
        diferenca: diferencaAlternativa,
        diferenca_abs: Math.abs(diferencaAlternativa),
        percentual_diferenca: valorAlternativo > 0 ? (diferencaAlternativa / valorAlternativo) * 100 : 0,
        detalhes_calculo: {
          ...(row.detalhes_calculo || {}),
          peso_considerado: peso,
          valor_base: alternativa.valor_base ?? row.detalhes_calculo?.valor_base,
          subtotal: alternativa.subtotal ?? row.detalhes_calculo?.subtotal,
          icms: alternativa.icms ?? row.detalhes_calculo?.icms,
          aliquota_icms: alternativa.aliquota_icms ?? row.detalhes_calculo?.aliquota_icms,
          origem_aliquota_icms: alternativa.origem_aliquota_icms || row.detalhes_calculo?.origem_aliquota_icms,
          taxas: alternativa.taxas || row.detalhes_calculo?.taxas,
          componentes_base: alternativa.componentes_base || row.detalhes_calculo?.componentes_base,
          ajuste_peso_aplicado: alternativa.nome || 'Peso alternativo',
          alternativa_peso_aplicada: {
            ...alternativa,
            peso_considerado: peso,
            valor_calculado: valorAlternativo,
            diferenca: diferencaAlternativa,
          },
        },
      };
      setResultadoCtesAvulsos((prev) => prev.map((item) => (chaveResultadoAuditoria(item) === chaveAlvo ? atualizadoImediato : item)));
      setResultadoCtesAvulsosSalvos(false);
    }
    setAuditandoCtesAvulsos(true);
    setProgressoCtesAvulsos({ etapa: 'recalculando_peso', carregados: 0, total: 1 });
    try {
      const { registros } = await processarCtesPorChave([row.chave_cte || row.numero_cte || chaveAlvo], setProgressoCtesAvulsos, {
        ignorarCubagem: true,
        percentualContingenciaPeso: 0,
        apenasDadosCompletos: apenasDadosCompletosAvulso,
        pesosOverridePorChave: { [chaveAlvo]: peso },
      });
      const recalculado = registros?.[0];
      if (!recalculado) throw new Error('Nao foi possivel recalcular este CT-e com o peso escolhido.');
      const atualizado = {
        ...row,
        ...recalculado,
        peso,
        detalhes_calculo: {
          ...(recalculado.detalhes_calculo || {}),
          comparativo_pesos: row.detalhes_calculo?.comparativo_pesos || recalculado.detalhes_calculo?.comparativo_pesos,
          peso_considerado: peso,
          ajuste_peso_aplicado: alternativa.nome || 'Peso alternativo',
          alternativa_peso_aplicada: {
            ...alternativa,
            peso_considerado: peso,
            valor_calculado: recalculado.valor_calculado,
            diferenca: recalculado.diferenca,
          },
        },
      };
      setResultadoCtesAvulsos((prev) => prev.map((item) => (chaveResultadoAuditoria(item) === chaveAlvo ? atualizado : item)));
      setResultadoCtesAvulsosSalvos(false);
      await salvarAuditoriaAvulsa([atualizado]);
      setResultadoCtesAvulsosSalvos(true);
      setMensagemImportacao(`Peso alternativo aplicado e salvo no CT-e ${row.numero_cte || row.chave_cte || ''}: ${numeroFmt(peso, 1)} kg, calculo ${dinheiro(recalculado.valor_calculado)}.`);
    } catch (error) {
      setMensagemImportacao(`Erro ao aplicar peso alternativo: ${error.message}`);
    } finally {
      setAuditandoCtesAvulsos(false);
      setProgressoCtesAvulsos(null);
    }
  };

  const aplicarPesosOkAuditoriaAvulsa = () => {
    let aplicados = 0;
    const atualizados = resultadoCtesAvulsos.map((row) => {
      const alternativas = (Array.isArray(row.detalhes_calculo?.comparativo_pesos) ? row.detalhes_calculo.comparativo_pesos : [])
        .map((alt) => ({ ...alt, pesoAlternativo: pesoAlternativoAuditoriaAvulsa(alt) }))
        .filter((alt) => {
          const valorCalculado = valorCalculadoAlternativaAuditoriaAvulsa(alt);
          const pesoAlt = Number(alt.pesoAlternativo || 0);
          if (valorCalculado <= 0 || pesoAlt <= 0) return false;
          if (Math.abs(pesoAlt - Number(row.peso || 0)) <= 0.1) return false;
          const diferenca = Number(row.valor_cte || 0) - valorCalculado;
          return dentroDaToleranciaAuditoria(diferenca, toleranciaAuditoria);
        })
        .sort((a, b) => Math.abs(Number(a.diferenca || 0)) - Math.abs(Number(b.diferenca || 0)));
      const escolhida = alternativas[0];
      if (!escolhida) return row;
      aplicados += 1;
      const valorCalculado = valorCalculadoAlternativaAuditoriaAvulsa(escolhida);
      const diferenca = Number(row.valor_cte || 0) - valorCalculado;
      return {
        ...row,
        peso: escolhida.pesoAlternativo,
        valor_calculado: valorCalculado,
        diferenca,
        diferenca_abs: Math.abs(diferenca),
        percentual_diferenca: valorCalculado > 0 ? (diferenca / valorCalculado) * 100 : 0,
        detalhes_calculo: {
          ...(row.detalhes_calculo || {}),
          peso_considerado: escolhida.pesoAlternativo,
          valor_base: escolhida.valor_base ?? row.detalhes_calculo?.valor_base,
          subtotal: escolhida.subtotal ?? row.detalhes_calculo?.subtotal,
          icms: escolhida.icms ?? row.detalhes_calculo?.icms,
          aliquota_icms: escolhida.aliquota_icms ?? row.detalhes_calculo?.aliquota_icms,
          origem_aliquota_icms: escolhida.origem_aliquota_icms || row.detalhes_calculo?.origem_aliquota_icms,
          taxas: escolhida.taxas || row.detalhes_calculo?.taxas,
          componentes_base: escolhida.componentes_base || row.detalhes_calculo?.componentes_base,
          ajuste_peso_aplicado: escolhida.nome || 'Peso alternativo dentro da tolerancia',
          alternativa_peso_aplicada: {
            ...escolhida,
            valor_calculado: valorCalculado,
            diferenca,
          },
        },
      };
    });
    setResultadoCtesAvulsos(atualizados);
    setResultadoCtesAvulsosSalvos(false);
    setMensagemImportacao(aplicados
      ? `${aplicados} CT-e(s) tiveram peso alternativo aplicado porque entraram na tolerancia. Clique em Salvar auditoria para gravar.`
      : 'Nenhum CT-e tinha peso alternativo que entrasse na tolerancia atual.');
  };

  const exportarAuditoriaAvulsaExcel = () => {
    if (!resultadoCtesAvulsos.length) return;
    const linhas = resultadoCtesAvulsos.map((row) => ({
      'CT-e': row.numero_cte || '',
      Chave: row.chave_cte || '',
      Transportadora: row.transportadora || row.transportadora_realizada || '',
      Canal: row.canal || row.canal_original || '',
      Origem: row.cidade_origem || row.origem || '',
      'UF Origem': row.uf_origem || '',
      Destino: row.cidade_destino || row.destino || '',
      'UF Destino': row.uf_destino || '',
      'Peso usado': Number(row.peso || 0),
      'Valor NF': Number(row.valor_nf || 0),
      'Frete pago': Number(row.valor_cte || 0),
      'Calculo AMD': Number(row.valor_calculado || 0),
      Diferenca: Number(row.diferenca || 0),
      Status: row.status_auditoria || row.status_calculo || row.motivo_sem_calculo || '',
      'Dentro tolerancia': Number(row.valor_calculado || 0) > 0 && dentroDaToleranciaAuditoria(row.diferenca, toleranciaAuditoria) ? 'SIM' : 'NAO',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), 'CT-es auditados');
    XLSX.writeFile(wb, `auditoria-cte-avulsa-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const alternarCteDoccob = (row, indice) => {
    const id = row.chave_cte || row.numero_cte || indice;
    setCtesSelecionadosDoccob((atuais) => atuais.includes(id) ? atuais.filter((item) => item !== id) : [...atuais, id]);
  };

  const selecionarTodosDoccob = () => {
    const ids = resultadoCtesAvulsosFiltrado.map((row, indice) => row.chave_cte || row.numero_cte || indice);
    const todosSelecionados = ids.length > 0 && ids.every((id) => ctesSelecionadosDoccob.includes(id));
    setCtesSelecionadosDoccob(todosSelecionados ? [] : ids);
  };

  const abrirFormularioDoccob = () => {
    if (!ctesSelecionadosDoccob.length) return;
    const selecionados = resultadoCtesAvulsosFiltrado.filter((row, indice) => ctesSelecionadosDoccob.includes(row.chave_cte || row.numero_cte || indice));
    const primeiro = selecionados[0];
    setDoccobForm((atual) => ({
      ...atual,
      cnpjTransportadora: atual.cnpjTransportadora || primeiro?.cnpj_transportadora || '',
      razaoSocialTransportadora: atual.razaoSocialTransportadora || primeiro?.transportadora || '',
    }));
    setDoccobNumerosNf((atual) => {
      const proximo = { ...atual };
      selecionados.forEach((row) => {
        const key = row.chave_cte || row.numero_cte;
        if (proximo[key] === undefined) proximo[key] = row.numero_nf || '';
      });
      return proximo;
    });
    setDoccobFormAberto(true);
  };

  // Contingencia: quando o CT-e nao tem numero/CNPJ da NF na base nem no
  // tracking (ex.: transportadora de atacado sem tracking vinculado), deixa
  // importar uma planilha avulsa so com Chave/CT-e + Numero NF + CNPJ
  // remetente pra completar o DOCCOB na hora, sem reimportar a base inteira.
  const importarContingenciaDoccobNf = async (arquivo) => {
    if (!arquivo) return;
    setDoccobImportandoContingencia('Lendo planilha...');
    try {
      const buffer = await arquivo.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array', raw: false });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const linhas = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
      const norm = (texto) => String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const pegar = (linha, chaves) => {
        for (const [k, v] of Object.entries(linha)) {
          if (chaves.includes(norm(k))) return v;
        }
        return '';
      };

      let casados = 0;
      const proximosNf = {};
      const proximosCnpj = {};
      linhas.forEach((linha) => {
        const chaveCte = String(pegar(linha, ['chave cte', 'chave do cte', 'chave ct e']) || '').replace(/\D/g, '');
        const numeroCte = String(pegar(linha, ['numero cte', 'cte', 'ct e', 'n cte']) || '').trim();
        const chave = chaveCte || numeroCte;
        if (!chave) return;
        const numeroNf = String(pegar(linha, ['numero nf', 'nf', 'numero da nf', 'n nf']) || '').trim();
        const cnpjEmissor = String(pegar(linha, ['cnpj remetente', 'documento remetente', 'cnpj emissor', 'documento emissor', 'cnpj do remetente']) || '').replace(/\D/g, '');
        if (numeroNf) proximosNf[chave] = numeroNf;
        if (cnpjEmissor) proximosCnpj[chave] = cnpjEmissor;
        if (numeroNf || cnpjEmissor) casados += 1;
      });

      setDoccobNumerosNf((atual) => ({ ...atual, ...proximosNf }));
      setDoccobCnpjEmissorPorItem((atual) => ({ ...atual, ...proximosCnpj }));
      setDoccobImportandoContingencia(`${casados} linha(s) da planilha aplicada(s) aos CT-es selecionados.`);
    } catch (error) {
      setDoccobImportandoContingencia(`Erro ao ler planilha: ${error.message || error}`);
    }
  };

  const gerarDoccobAuditoriaAvulsa = () => {
    const selecionados = resultadoCtesAvulsosFiltrado.filter((row, indice) => ctesSelecionadosDoccob.includes(row.chave_cte || row.numero_cte || indice));
    if (!selecionados.length) return;
    const fatura = {
      filial: doccobForm.filial,
      numero_fatura: doccobForm.numeroDocumento,
      serie_fatura: doccobForm.serieDocumento,
      data_emissao: doccobForm.dataEmissao,
      data_vencimento: doccobForm.dataVencimento,
      cnpj_transportadora: doccobForm.cnpjTransportadora,
      transportadora: doccobForm.razaoSocialTransportadora,
      valor_icms: 0,
    };
    const detalhes = selecionados.map((row) => ({
      id: row.chave_cte || row.numero_cte,
      chave_cte: row.chave_cte,
      numero_cte: row.numero_cte,
      serie_cte: row.serie_cte || '',
      filial: doccobForm.filial,
      valor_frete: Number(row.valor_cte || 0),
      numero_nf: doccobNumerosNf[row.chave_cte || row.numero_cte] || row.numero_nf || '',
      valor_nf: Number(row.valor_nf || 0),
      peso_nf: Number(row.peso || 0),
      data_emissao: row.data_emissao,
      cnpj_transportadora: doccobForm.cnpjTransportadora,
      cnpj_tomador: row.cnpj_tomador || '',
      tomador_servico: row.tomador_servico || '',
      // CGC emissor da NF: prioriza o que veio da base (documento remetente/
      // chave da NF/tomador), depois a planilha de contingencia importada
      // aqui na tela, e por ultimo o campo unico digitado no formulario.
      cnpj_emissor_nf: row.cnpj_emissor_nf || doccobCnpjEmissorPorItem[row.chave_cte || row.numero_cte] || doccobForm.cnpjEmissorNf,
    }));
    const conteudo = montarArquivoDoccobEdi(fatura, detalhes, [], {
      tipoCobranca: doccobForm.tipoCobranca,
      agenteCobranca: doccobForm.agenteCobranca,
      cnpjEmissorNf: doccobForm.cnpjEmissorNf,
    });
    const nome = montarNomeDoccob(fatura);
    const blob = new Blob([conteudo], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${nome}.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
    setDoccobFormAberto(false);
  };

  const baixarLaudoAuditoriaAvulsa = (tipoLaudo = 'interno') => {
    if (!resultadoCtesAvulsos.length) return;
    const laudoTransportador = tipoLaudo === 'transportador';
    const esc = (valor) => String(valor ?? '').replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[m]));
    const total = resultadoCtesAvulsos.length;
    const calculados = resultadoCtesAvulsos.filter((row) => Number(row.valor_calculado || 0) > 0).length;
    const ok = resultadoCtesAvulsos.filter((row) => Number(row.valor_calculado || 0) > 0 && dentroDaToleranciaAuditoria(row.diferenca, toleranciaAuditoria)).length;
    const divergentes = calculados - ok;
    const semCalculo = total - calculados;
    const diferencaCobravel = (row) => {
      if (Number(row.valor_calculado || 0) <= 0) return 0;
      if (dentroDaToleranciaAuditoria(row.diferenca, toleranciaAuditoria)) return 0;
      if (laudoTransportador && !mostrarDiferencaNegativaLaudoTransportador && Number(row.diferenca || 0) < 0) return 0;
      return Number(row.diferenca || 0);
    };
    const excesso = resultadoCtesAvulsos.reduce((acc, row) => acc + Math.max(diferencaCobravel(row), 0), 0);
    const insuf = resultadoCtesAvulsos.reduce((acc, row) => acc + Math.abs(Math.min(diferencaCobravel(row), 0)), 0);
    const totalDescontar = Math.max(excesso - insuf, 0);
    const totalPago = resultadoCtesAvulsos.reduce((acc, row) => acc + Number(row.valor_cte || 0), 0);
    const totalAmd = resultadoCtesAvulsos.reduce((acc, row) => acc + Number(row.valor_calculado || 0), 0);
    const taxaOk = calculados > 0 ? (ok / calculados) * 100 : 0;
    const porTransp = Array.from(resultadoCtesAvulsos.reduce((mapa, row) => {
      const nome = row.transportadora || row.transportadora_realizada || 'Nao informado';
      const atual = mapa.get(nome) || { nome, total: 0, calculados: 0, ok: 0, divergencia: 0 };
      atual.total += 1;
      if (Number(row.valor_calculado || 0) > 0) atual.calculados += 1;
      if (Number(row.valor_calculado || 0) > 0 && dentroDaToleranciaAuditoria(row.diferenca, toleranciaAuditoria)) atual.ok += 1;
      atual.divergencia += Math.abs(Number(row.diferenca || 0));
      mapa.set(nome, atual);
      return mapa;
    }, new Map()).values()).sort((a, b) => b.divergencia - a.divergencia);
    const topDivergencias = [...resultadoCtesAvulsos]
      .filter((row) => Number(row.valor_calculado || 0) > 0)
      .sort((a, b) => Math.abs(Number(b.diferenca || 0)) - Math.abs(Number(a.diferenca || 0)));
    const devolucoes = resultadoCtesAvulsos.filter((row) => row.detalhes_calculo?.calculo_devolucao_invertida);
    const ajustesPeso = resultadoCtesAvulsos.filter((row) => row.detalhes_calculo?.ajuste_peso_aplicado);
    const semCalculoRows = resultadoCtesAvulsos.filter((row) => Number(row.valor_calculado || 0) <= 0);
    const dinheiroLaudo = (valor) => (Number.isFinite(Number(valor)) ? dinheiro(valor) : '-');
    const numeroLaudo = (valor, casas = 2) => (Number.isFinite(Number(valor)) ? numeroFmt(valor, casas) : '-');
    const pesoUsado = (row) => Number(row.detalhes_calculo?.peso_considerado ?? row.peso ?? 0);
    const deveOcultarDiferencaNegativa = (row) => laudoTransportador
      && !mostrarDiferencaNegativaLaudoTransportador
      && Number(row.diferenca || 0) < 0;
    const diferencaExibida = (row) => (deveOcultarDiferencaNegativa(row) ? 0 : Number(row.diferenca || 0));
    const statusExibido = (row) => {
      if (deveOcultarDiferencaNegativa(row)) return 'OK';
      return Number(row.valor_calculado || 0) > 0 && dentroDaToleranciaAuditoria(row.diferenca, toleranciaAuditoria) ? 'OK' : 'Divergente';
    };
    const detailId = (prefixo, row, index) => `${prefixo}-${String(row.numero_cte || row.chave_cte || index).replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const detalheLinha = (label, value, classe = '') => `
      <div class="kv ${classe}">
        <span>${esc(label)}</span>
        <strong>${value}</strong>
      </div>
    `;
    const detalheBox = (titulo, linhas) => `
      <div class="detail-box">
        <h3>${esc(titulo)}</h3>
        ${linhas.join('')}
      </div>
    `;
    const detalhesCalculoHtml = (row, modo = 'interno') => {
      const publico = modo === 'transportador';
      const det = row.detalhes_calculo || {};
      const base = det.componentes_base || {};
      const taxas = det.taxas || {};
      const rota = det.rota_cotacao || det.rota || row.rota || `${row.cidade_origem || row.origem || ''} -> ${row.cidade_destino || row.destino || ''}`;
      const linhaOkTransportador = publico && statusExibido(row) === 'OK';
      const valorPagoPublico = Number(row.valor_cte || 0);
      const valorCalculadoPublico = linhaOkTransportador ? valorPagoPublico : Number(row.valor_calculado || 0);
      const valorBasePublico = linhaOkTransportador ? valorPagoPublico : (det.valor_base ?? base.valor_base);
      const valorTaxaPublica = (value) => (linhaOkTransportador ? null : value);
      const dinheiroPublico = (value) => (linhaOkTransportador ? '-' : dinheiroLaudo(value));
      const percentualPublico = (value) => (linhaOkTransportador ? '-' : (Number.isFinite(Number(value)) ? pctFmt(value) : '-'));
      const taxaLinhas = [
        ['Ad Valorem', valorTaxaPublica(taxas.adValorem ?? taxas.ad_valorem ?? taxas.advalorem)],
        ['GRIS', valorTaxaPublica(taxas.gris)],
        ['Pedagio', valorTaxaPublica(taxas.pedagio)],
        ['TAS', valorTaxaPublica(taxas.tas)],
        ['CTRC', valorTaxaPublica(taxas.ctrc)],
        ['Taxa emergencial', valorTaxaPublica(base.valorEmergencial)],
        ['TDA', valorTaxaPublica(taxas.tda)],
        ['TDE', valorTaxaPublica(taxas.tde)],
        ['TDR', valorTaxaPublica(taxas.tdr)],
        ['TRT', valorTaxaPublica(taxas.trt)],
        ['Suframa', valorTaxaPublica(taxas.suframa)],
        ['Outras', valorTaxaPublica(taxas.outras)],
        ['Taxa extra', valorTaxaPublica(taxas.taxaExtra ?? taxas.taxa_extra)],
        ['Total taxas', valorTaxaPublica(det.total_taxas ?? taxas.total)],
      ].map(([label, value]) => detalheLinha(label, linhaOkTransportador ? '-' : dinheiroLaudo(value)));
      const comparativo = Array.isArray(det.comparativo_pesos) ? det.comparativo_pesos : [];
      const comparativoHtml = comparativo.map((alt) => `
        <tr>
          <td>${esc(alt.nome || alt.tipo || 'Alternativo')}</td>
          <td>${numeroLaudo(alt.peso_usado ?? alt.peso ?? alt.pesoAlternativo, 3)} kg</td>
          <td>${dinheiroLaudo(alt.valor_calculado)}</td>
          <td class="${Number(alt.diferenca || 0) > 0 ? 'bad' : 'warn'}">${dinheiroLaudo(alt.diferenca)}</td>
        </tr>
      `).join('');
      return `
        <div class="detail-panel">
          <div class="detail-head">
            <strong>Detalhe do cálculo do CT-e ${esc(row.numero_cte || '')}</strong>
            <span>${esc(row.chave_cte || '')}</span>
          </div>
          <div class="detail-grid">
            ${detalheBox('Resumo do cálculo', [
              detalheLinha('Motor', esc(det.motor || 'Simulador realizado')),
              detalheLinha('Tipo', esc(det.tipo_calculo || det.tipo || '-')),
              detalheLinha('Tabela usada', esc(det.tabela_usada || row.transportadora || row.transportadora_realizada || '-')),
              detalheLinha('Canal', esc(det.canal || row.canal || row.canal_original || '-')),
              detalheLinha('Origem tabela', esc(det.origem_tabela || '-')),
              detalheLinha('Rota/cotação', esc(rota || '-')),
              detalheLinha('Peso usado', `${numeroLaudo(pesoUsado(row), 3)} kg`),
              detalheLinha('Valor NF', dinheiroLaudo(det.valor_nf ?? row.valor_nf)),
              detalheLinha('Frete pago', dinheiroLaudo(row.valor_cte)),
              detalheLinha('Cálculo AMD/local', dinheiroLaudo(valorCalculadoPublico)),
              linhaOkTransportador ? '' : detalheLinha('Diferença', dinheiroLaudo(diferencaExibida(row)), diferencaExibida(row) > 0 ? 'bad' : 'warn'),
            ])}
            ${detalheBox('Base do frete', [
              detalheLinha('Percentual aplicado', percentualPublico(base.percentual_aplicado ?? det.percentual_aplicado)),
              detalheLinha('Valor percentual', dinheiroPublico(base.valor_percentual ?? det.valor_percentual)),
              detalheLinha('R$/kg aplicado', dinheiroPublico(base.valor_kg ?? base.valor_kg_aplicado ?? det.valor_kg_aplicado)),
              detalheLinha('Valor kg garantia', dinheiroPublico(base.valor_kg_garantia ?? det.valor_kg_garantia)),
              detalheLinha('Frete mínimo rota', dinheiroPublico(base.frete_minimo_rota ?? det.frete_minimo_rota)),
              detalheLinha('Frete mínimo cotação', dinheiroPublico(base.frete_minimo_cotacao ?? det.frete_minimo_cotacao)),
              detalheLinha('Frete mínimo geral', dinheiroPublico(base.frete_minimo_geral ?? det.frete_minimo_geral)),
              detalheLinha('Mínimo aplicável', dinheiroPublico(base.minimo_aplicavel ?? det.minimo_aplicavel)),
              detalheLinha('Componente vencedor', esc(linhaOkTransportador ? '-' : (base.componente_vencedor || det.componente_vencedor || '-'))),
              detalheLinha('Valor base', dinheiroLaudo(valorBasePublico)),
            ])}
            ${detalheBox('ICMS e totalização', [
              detalheLinha('Subtotal antes da emergencial', dinheiroPublico(base.subtotalSemEmergencial)),
              Number(base.taxaEmergencialPct) > 0
                ? detalheLinha('Taxa emergencial', linhaOkTransportador ? '-' : `${percentualPublico(base.taxaEmergencialPct)} = ${dinheiroLaudo(base.valorEmergencial)}`)
                : '',
              detalheLinha('Subtotal sem ICMS', dinheiroPublico(det.subtotal_sem_icms ?? det.subtotal)),
              detalheLinha('Alíquota ICMS', percentualPublico(det.aliquota_icms)),
              detalheLinha('Origem alíquota', esc(linhaOkTransportador ? '-' : (det.origem_aliquota_icms || '-'))),
              detalheLinha('UF origem/destino', esc(`${row.uf_origem || '-'} -> ${row.uf_destino || '-'}`)),
              detalheLinha('ICMS', dinheiroPublico(det.icms)),
              detalheLinha('Total calculado', dinheiroLaudo(valorCalculadoPublico)),
            ])}
            ${publico ? '' : detalheBox('Pesos disponíveis', [
              detalheLinha('Peso usado no cálculo', `${numeroLaudo(pesoUsado(row), 3)} kg`),
              detalheLinha('Peso declarado CT-e', `${numeroLaudo(det.peso_declarado_cte ?? det.peso_declarado, 3)} kg`),
              detalheLinha('Peso cubado calculado', `${numeroLaudo(det.peso_cubado_calculado ?? det.peso_cubado, 3)} kg`),
              detalheLinha('Cubagem Tracking', `${numeroLaudo(det.cubagem_tracking ?? det.cubagem, 6)} m3`),
              detalheLinha('Fator cubagem', `${numeroLaudo(det.fator_cubagem, 0)} kg/m3`),
              detalheLinha('Ajuste aplicado', esc(det.ajuste_peso_aplicado || '-')),
            ])}
            ${detalheBox('Taxas', taxaLinhas)}
          </div>
          ${!publico && comparativoHtml ? `<h3 class="subhead">Comparativo de pesos</h3><table class="inner"><thead><tr><th>Opção</th><th>Peso</th><th>Cálculo</th><th>Diferença</th></tr></thead><tbody>${comparativoHtml}</tbody></table>` : ''}
        </div>
      `;
    };

    const linhasTransportadora = porTransp.map((item) => `
      <tr>
        <td>${esc(item.nome)}</td>
        <td>${numeroFmt(item.total)}</td>
        <td>${numeroFmt(item.calculados)}</td>
        <td>${numeroFmt(item.ok)}</td>
        <td>${item.calculados ? pctFmt((item.ok / item.calculados) * 100) : '—'}</td>
        <td>${dinheiro(item.divergencia)}</td>
      </tr>
    `).join('');

    const linhasDivergencias = topDivergencias.map((row, index) => {
      const id = detailId('div', row, index);
      return `
      <tr class="clickable" onclick="toggleDetail('${id}')">
        <td>${esc(row.numero_cte || '')}</td>
        <td>${esc(row.transportadora || row.transportadora_realizada || '')}</td>
        <td>${esc(row.cidade_origem || row.origem || '')}/${esc(row.uf_origem || '')} -> ${esc(row.cidade_destino || row.destino || '')}/${esc(row.uf_destino || '')}</td>
        <td>${numeroFmt(pesoUsado(row), 3)} kg</td>
        <td>${dinheiro(row.valor_cte)}</td>
        <td>${dinheiro(row.valor_calculado)}</td>
        <td class="${diferencaExibida(row) > 0 ? 'bad' : 'warn'}">${dinheiro(diferencaExibida(row))}</td>
        <td>${statusExibido(row)}</td>
      </tr>
      <tr id="${id}" class="detail-row"><td colspan="8">${detalhesCalculoHtml(row, laudoTransportador ? 'transportador' : 'interno')}</td></tr>
    `;
    }).join('');

    const linhasSemCalculo = semCalculoRows.map((row, index) => {
      const id = detailId('sem', row, index);
      return `
      <tr class="clickable" onclick="toggleDetail('${id}')">
        <td>${esc(row.numero_cte || '')}</td>
        <td>${esc(row.transportadora || row.transportadora_realizada || '')}</td>
        <td>${esc(row.cidade_origem || row.origem || '')} -> ${esc(row.cidade_destino || row.destino || '')}</td>
        <td>${esc(row.canal || row.canal_original || '')}</td>
        <td>${esc(row.motivo_sem_calculo || row.status_auditoria || row.status_calculo || '')}</td>
      </tr>
      <tr id="${id}" class="detail-row"><td colspan="5">${detalhesCalculoHtml(row, laudoTransportador ? 'transportador' : 'interno')}</td></tr>
    `;
    }).join('');
    const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Laudo de Auditoria CT-e</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; color: #06183d; background: #eef3f9; }
    .page { max-width: 1180px; margin: 28px auto; background: #fff; border: 1px solid #d8e2ef; border-radius: 12px; overflow: hidden; }
    header { padding: 28px 32px; background: #06183d; color: #fff; }
    header h1 { margin: 0 0 8px; font-size: 28px; }
    header p { margin: 0; color: #cbd5e1; }
    section { padding: 22px 32px; border-top: 1px solid #e2e8f0; }
    h2 { margin: 0 0 12px; font-size: 18px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
    .card { border: 1px solid #dbe3ef; border-radius: 10px; padding: 14px; background: #f8fafc; }
    .label { color: #64748b; font-size: 12px; font-weight: 700; }
    .value { margin-top: 6px; font-size: 22px; font-weight: 800; }
    .good { color: #15803d; } .bad { color: #dc2626; } .warn { color: #d97706; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; background: #f1f5f9; color: #334155; padding: 8px; border-bottom: 1px solid #cbd5e1; }
    td { padding: 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    tr.clickable { cursor: pointer; }
    tr.clickable:hover { background: #eff6ff; }
    .detail-row { display: none; }
    .detail-row.open { display: table-row; }
    .detail-row > td { padding: 0 8px 12px; background: #f8fafc; }
    .detail-panel { border: 1px solid #dbe3ef; border-radius: 10px; padding: 14px; margin-top: 6px; background: #fff; }
    .detail-head { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 12px; color: #334155; }
    .detail-head span { color: #64748b; font-size: 11px; overflow-wrap: anywhere; }
    .detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; }
    .detail-box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; background: #fbfdff; }
    .detail-box h3, .subhead { margin: 0 0 8px; font-size: 13px; color: #06183d; }
    .kv { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; border-bottom: 1px solid #edf2f7; }
    .kv span { color: #64748b; }
    .kv strong { text-align: right; overflow-wrap: anywhere; }
    table.inner { margin-top: 6px; }
    .note { padding: 12px 14px; border-radius: 8px; background: #eff6ff; color: #1e3a8a; margin-top: 10px; }
    footer { padding: 18px 32px; color: #64748b; font-size: 12px; }
    @media print { body { background: #fff; } .page { margin: 0; border: 0; border-radius: 0; } }
  </style>
</head>
<body>
  <main class="page">
    <header>
      <h1>${laudoTransportador ? 'Laudo de Divergencias CT-e' : 'Laudo Interno de Auditoria CT-e'}</h1>
      <p>Gerado em ${esc(new Date().toLocaleString('pt-BR'))}${laudoTransportador ? '' : ` · Tolerância aplicada: +R$ ${numeroFmt(toleranciaAuditoria.acima, 2)} / -R$ ${numeroFmt(toleranciaAuditoria.abaixo, 2)}`}</p>
    </header>

    <section>
      <h2>Resumo executivo</h2>
      <div class="cards">
        <div class="card"><div class="label">CT-es auditados</div><div class="value">${numeroFmt(total)}</div></div>
        <div class="card"><div class="label">Calculados AMD</div><div class="value">${numeroFmt(calculados)}</div></div>
        <div class="card"><div class="label">Dentro da tolerância</div><div class="value good">${numeroFmt(ok)} (${pctFmt(taxaOk)})</div></div>
        <div class="card"><div class="label">Divergentes</div><div class="value bad">${numeroFmt(divergentes)}</div></div>
        <div class="card"><div class="label">Sem cálculo</div><div class="value warn">${numeroFmt(semCalculo)}</div></div>
        <div class="card"><div class="label">Frete pago</div><div class="value">${dinheiro(totalPago)}</div></div>
        <div class="card"><div class="label">Cálculo AMD</div><div class="value">${dinheiro(totalAmd)}</div></div>
        <div class="card"><div class="label">Cobrança acima</div><div class="value bad">${dinheiro(excesso)}</div></div>
        <div class="card"><div class="label">Cobrança abaixo</div><div class="value warn">${dinheiro(insuf)}</div></div>
        ${laudoTransportador && mostrarDiferencaNegativaLaudoTransportador
          ? `<div class="card"><div class="label">Total a descontar</div><div class="value bad">${dinheiro(totalDescontar)}</div></div>`
          : ''}
      </div>
      <div class="note">Valores positivos em diferença indicam cobrança acima do cálculo AMD/local. Valores negativos indicam cobrança abaixo do cálculo.</div>
    </section>

    <section>
      <h2>Resumo por transportadora</h2>
      <div class="note">Clique em um CT-e para abrir ou fechar o detalhe do calculo.</div>
    <table><thead><tr><th>Transportadora</th><th>CT-es</th><th>Calculados</th><th>OK</th><th>Assertividade</th><th>Divergência absoluta</th></tr></thead><tbody>${linhasTransportadora}</tbody></table>
    </section>

    <section>
      <h2>Principais divergências</h2>
      <div class="note">Clique em qualquer CT-e para abrir ou fechar os detalhes do c�lculo.</div>
      <div class="note">Clique em um CT-e para abrir ou fechar o detalhe do calculo.</div>
    <table><thead><tr><th>CT-e</th><th>Transportadora</th><th>Rota</th><th>Peso</th><th>Pago</th><th>AMD</th><th>Dif.</th><th>Status</th></tr></thead><tbody>${linhasDivergencias || '<tr><td colspan="8">Sem divergências calculadas.</td></tr>'}</tbody></table>
    </section>

    <section>
      <h2>Pontos de atenção</h2>
      <div class="cards">
        <div class="card"><div class="label">Devoluções invertidas</div><div class="value">${numeroFmt(devolucoes.length)}</div></div>
        <div class="card"><div class="label">Pesos ajustados manualmente</div><div class="value">${numeroFmt(ajustesPeso.length)}</div></div>
        <div class="card"><div class="label">Sem cálculo listados</div><div class="value">${numeroFmt(semCalculoRows.length)}</div></div>
      </div>
      ${semCalculoRows.length ? `<h2 style="margin-top:20px">CT-es sem cálculo</h2><div class="note">Clique na linha para ver os dados dispon�veis do CT-e e o motivo do n�o c�lculo.</div><table><thead><tr><th>CT-e</th><th>Transportadora</th><th>Rota</th><th>Canal</th><th>Motivo</th></tr></thead><tbody>${linhasSemCalculo}</tbody></table>` : ''}
    </section>

    <footer>Laudo gerado pela Central Fretes. Use a exportação Excel para auditoria linha a linha.</footer>
  </main>
  <script>
    function toggleDetail(id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('open');
    }
  </script>
</body>
</html>`;
    baixarArquivoAuditoria(html, `${laudoTransportador ? 'laudo-transportador-cte' : 'laudo-interno-auditoria-cte'}-${new Date().toISOString().slice(0, 10)}.html`, 'text/html;charset=utf-8');
  };

  const alternarSelecao = (id) => {
    setSelecionadasIds((atual) => (atual.includes(id) ? atual.filter((item) => item !== id) : [...atual, id]));
  };

  const selecionarFaturasFiltradas = () => {
    setSelecionadasIds([...new Set(lista.map((item) => item.id))]);
  };

  const todasFiltradasSelecionadas = lista.length > 0 && lista.every((item) => selecionadasIds.includes(item.id));
  const alternarSelecaoFiltradas = () => {
    if (todasFiltradasSelecionadas) {
      const idsVisiveis = new Set(lista.map((item) => item.id));
      setSelecionadasIds((atual) => atual.filter((id) => !idsVisiveis.has(id)));
    } else {
      setSelecionadasIds((atual) => [...new Set([...atual, ...lista.map((item) => item.id)])]);
    }
  };

  const faturasSelecionadas = state.faturas.filter((item) => selecionadasIds.includes(item.id));

  // Resumo pre-laudo: usa os CT-es ja em cache (state.detalhes) quando a
  // fatura ja foi aberta/recalculada; senao cai nos agregados salvos na
  // propria fatura. Atualiza sozinho ao (des)selecionar faturas ou mudar as
  // opcoes do laudo transportador, pra dar previa antes de gerar o arquivo.
  const resumoSelecaoFaturas = useMemo(() => {
    const toleranciaCfg = carregarToleranciaAuditoria();
    const opts = { ...opcoesLaudoTransportadorLote, transportador: true };
    let ctes = 0, fretePago = 0, calculoAmd = 0, cobrancaAcima = 0, cobrancaAbaixo = 0, semCalculo = 0, tolerancia = 0, divergentes = 0;
    faturasSelecionadas.forEach((fatura) => {
      const cache = state.detalhes?.[fatura.id];
      if (cache && cache.length) {
        const unicos = deduplicarDetalhesFatura(cache);
        const mascarados = aplicarMascaraLaudoTransportador(unicos, opts, toleranciaCfg);
        const resumo = resumirDetalhesAuditoria(mascarados, toleranciaCfg);
        ctes += resumo.total;
        fretePago += resumo.fretePago;
        calculoAmd += resumo.calculoAmd;
        cobrancaAcima += resumo.cobrancaAcima;
        cobrancaAbaixo += resumo.cobrancaAbaixo;
        semCalculo += resumo.semCalculo;
        divergentes += resumo.divergentes;
        unicos.forEach((item) => {
          if (Number(item.calculado_frete || 0) > 0 && dentroDaToleranciaAuditoria(Number(item.diferenca || 0), toleranciaCfg)) tolerancia += 1;
        });
      } else {
        ctes += Number(fatura.ctes_totais || 0);
        fretePago += Number(fatura.valor_fatura || 0);
        calculoAmd += Number(fatura.valor_calculado || 0);
        cobrancaAcima += Number(fatura.auditoria_cobranca_acima || 0);
        cobrancaAbaixo += Number(fatura.auditoria_cobranca_abaixo || 0);
        semCalculo += Number(fatura.ctes_sem_calculo || 0);
        divergentes += Number(fatura.ctes_divergentes || 0);
      }
    });
    return {
      faturas: faturasSelecionadas.length,
      ctes,
      fretePago,
      calculoAmd,
      cobrancaAcima,
      cobrancaAbaixo,
      totalDescontar: Math.max(0, cobrancaAcima - cobrancaAbaixo),
      semCalculo,
      tolerancia,
      divergentes,
    };
  }, [faturasSelecionadas, state.detalhes, opcoesLaudoTransportadorLote]);

  const atualizarFaturasEmMassa = async (tipo) => {
    if (!faturasSelecionadas.length) return;
    setMensagemImportacao('');
    setRecalculandoLote(true);
    setProgressoLote(null);
    try {
      let next = state;
      for (let i = 0; i < faturasSelecionadas.length; i += 1) {
        const fatura = next.faturas.find((item) => item.id === faturasSelecionadas[i].id) || faturasSelecionadas[i];
        setProgressoLote({ etapa: 'atualizando_faturas_lote', carregados: i + 1, total: faturasSelecionadas.length });
        let payload = { ...fatura };
        let evento = {
          acao: 'EDICAO_EM_MASSA',
          descricao: 'Fatura atualizada em massa.',
          usuario_nome: sessao?.nome || sessao?.email || 'Usuario local',
          usuario_email: sessao?.email || '',
        };
        if (tipo === 'auditor') {
          if (!auditorLote.trim()) throw new Error('Informe o auditor para aplicar em massa.');
          payload = { ...payload, auditor_nome: auditorLote.trim(), auditor_email: emailAuditorLote.trim() };
          evento = { ...evento, acao: 'AUDITOR_ATRIBUIDO_EM_MASSA', descricao: `Auditor atribuido em massa: ${auditorLote.trim()}.` };
        }
        if (tipo === 'status') {
          if (!statusLote) throw new Error('Selecione um status para aplicar em massa.');
          payload = { ...payload, status: statusLote };
          evento = { ...evento, acao: 'STATUS_EM_MASSA', status_anterior: fatura.status, status_novo: statusLote, descricao: `Status aplicado em massa: ${nomeStatus(statusLote)}.` };
        }
        if (tipo === 'liberar') {
          const detalhesFatura = state.detalhes?.[fatura.id] || await carregarDetalhesFaturaSupabase(fatura.id);
          const resumo = resumirDetalhesAuditoria(detalhesFatura, carregarToleranciaAuditoria());
          const saldo = Number((resumo.cobrancaAcima - resumo.cobrancaAbaixo).toFixed(2));
          payload = {
            ...payload,
            status: 'PRONTA_PARA_PAGAMENTO',
            valor_calculado: Number(resumo.calculoAmd.toFixed(2)),
            diferenca: saldo,
            valor_recuperado: Math.max(saldo, 0),
            ctes_totais: resumo.total || payload.ctes_totais,
            ctes_auditados: resumo.calculados,
            ctes_divergentes: resumo.divergentes,
            ctes_sem_calculo: resumo.semCalculo,
            auditoria_cobranca_acima: Number(resumo.cobrancaAcima.toFixed(2)),
            auditoria_cobranca_abaixo: Number(resumo.cobrancaAbaixo.toFixed(2)),
            auditoria_total_descontar: Number(Math.max(saldo, 0).toFixed(2)),
          };
          evento = {
            ...evento,
            acao: 'LIBERACAO_PAGAMENTO_EM_MASSA',
            status_anterior: fatura.status,
            status_novo: 'PRONTA_PARA_PAGAMENTO',
            descricao: `Liberada em massa para pagamento. Cobran�a acima ${dinheiro(resumo.cobrancaAcima)}, cobran�a abaixo ${dinheiro(resumo.cobrancaAbaixo)}, saldo a descontar ${dinheiro(Math.max(saldo, 0))}.`,
          };
        }
        next = await atualizarFaturaAuditoria(next, payload, evento);
      }
      onState(next);
      setMensagemImportacao(`${faturasSelecionadas.length} fatura(s) atualizada(s) em massa.`);
    } catch (error) {
      setMensagemImportacao(`Erro na edicao em massa: ${error.message}`);
    } finally {
      setRecalculandoLote(false);
      setProgressoLote(null);
    }
  };

  const baixarLaudoFaturasSelecionadas = async (tipoLaudo = 'transportador') => {
    if (!faturasSelecionadas.length) {
      setMensagemImportacao('Selecione uma ou mais faturas para gerar o laudo consolidado.');
      return;
    }
    setRecalculandoLote(true);
    setProgressoLote(null);
    try {
      const toleranciaLaudo = carregarToleranciaAuditoria();
      const laudoTransportador = tipoLaudo === 'transportador';
      const opts = { ...opcoesLaudoTransportadorLote, transportador: laudoTransportador };
      const blocos = [];
      for (let i = 0; i < faturasSelecionadas.length; i += 1) {
        const fatura = faturasSelecionadas[i];
        setProgressoLote({ etapa: 'montando_laudo', carregados: i + 1, total: faturasSelecionadas.length });
        const detalhesRaw = state.detalhes?.[fatura.id]?.length
          ? state.detalhes[fatura.id]
          : await carregarDetalhesFaturaSupabase(fatura.id);
        const detalhesUnicos = deduplicarDetalhesFatura(detalhesRaw || []);
        const refs = await buscarReferenciaCtes(detalhesUnicos.flatMap((item) => [item.chave_cte, item.numero_cte]));
        const detalhesLaudo = detalhesUnicos.map((item) => mesclarDetalheComReferenciaAuditoria(item, refs));
        blocos.push({ fatura, detalhes: detalhesLaudo });
      }
      const todosDetalhes = blocos.flatMap((bloco) => bloco.detalhes);
      const linhasParaResumo = aplicarMascaraLaudoTransportador(todosDetalhes, opts, toleranciaLaudo);
      const resumoGeral = resumirDetalhesAuditoria(linhasParaResumo, toleranciaLaudo);
      const transportadoras = [...new Set(faturasSelecionadas.map((f) => f.transportadora).filter(Boolean))].join(', ');
      const cards = [
        ['Faturas', faturasSelecionadas.length],
        ['CT-es', resumoGeral.total],
        ['Divergentes', resumoGeral.divergentes],
        ['Sem calculo', resumoGeral.semCalculo],
        ['Frete pago', dinheiro(resumoGeral.fretePago)],
        ['Calculo AMD', dinheiro(resumoGeral.calculoAmd)],
        ['Cobranca acima', dinheiro(resumoGeral.cobrancaAcima)],
        ['Cobranca abaixo', dinheiro(resumoGeral.cobrancaAbaixo)],
        ['Total a descontar', dinheiro(resumoGeral.totalDescontar)],
      ];
      // Laudo hierarquico: uma linha por fatura, expande CT-es; cada CT-e
      // expande o detalhe do calculo. Tudo fechado por padrao.
      const linhasFatura = blocos.map((bloco, idxFatura) => {
        const grupoId = `grp-fat-${idxFatura}`;
        const linhasCteMascaradas = bloco.detalhes.map((item) => ({ item, ...prepararLinhaLaudoTransportador(item, opts, toleranciaLaudo) }));
        const cobradoFatura = bloco.detalhes.reduce((acc, item) => acc + Number(item.valor_frete || 0), 0);
        const amdFaturaPublico = linhasCteMascaradas.reduce((acc, l) => acc + l.calculadoPublico, 0);
        const diffFaturaPublico = linhasCteMascaradas.reduce((acc, l) => acc + l.diffPublico, 0);
        const origens = [...new Set(bloco.detalhes.map((item) => item.cidade_origem || item.origem).filter(Boolean))];
        const resumoOrigem = origens.length > 1 ? `${origens[0]} +${origens.length - 1} origem(ns)` : (origens[0] || '-');
        const linhasCteHtml = linhasCteMascaradas.map((linha, idxCte) => {
          const item = linha.item;
          const detalheId = `cte-${idxFatura}-${idxCte}`;
          const origemCte = item.cidade_origem || item.origem;
          const destinoCte = item.cidade_destino || item.destino;
          const rota = origemCte || destinoCte
            ? `${origemCte || '-'}/${item.uf_origem || ''} -> ${destinoCte || '-'}/${item.uf_destino || ''}`
            : '-';
          const pesoCte = Number(item.peso || 0);
          return `
          <tr class="main-row"${linha.semCalculo ? ' style="background:#fff7ed"' : ''} onclick="toggleDetail('${detalheId}')">
            <td>${escapeHtmlAuditoria(item.numero_cte || '-')}</td>
            <td>${escapeHtmlAuditoria(item.chave_cte || '-')}</td>
            <td>${escapeHtmlAuditoria(rota)}</td>
            <td>${escapeHtmlAuditoria(item.canal || '-')}</td>
            <td>${pesoCte > 0 ? `${numeroFmt(pesoCte, 3)} kg` : '-'}</td>
            <td>${dinheiro(item.valor_frete)}</td>
            <td>${Number(item.calculado_frete || 0) ? dinheiro(linha.calculadoPublico) : '-'}</td>
            <td>${dinheiro(linha.diffPublico)}</td>
            <td>${escapeHtmlAuditoria(linha.statusPublico)}</td>
          </tr>
          <tr id="${detalheId}" class="detail-row"><td colspan="9">${detalhesCalculoHtmlFatura(item, { masked: linha.masked, calculadoPublico: linha.calculadoPublico, diffPublico: linha.diffPublico })}</td></tr>`;
        }).join('');
        return `
        <tr class="main-row" onclick="toggleDetail('${grupoId}')">
          <td>${escapeHtmlAuditoria(bloco.fatura.numero_fatura || '-')}</td>
          <td>${escapeHtmlAuditoria(bloco.fatura.transportadora || '-')}</td>
          <td>${dinheiro(cobradoFatura)}</td>
          <td>${dinheiro(amdFaturaPublico)}</td>
          <td>${dinheiro(diffFaturaPublico)}</td>
          <td>${numeroFmt(bloco.detalhes.length)}</td>
          <td>${escapeHtmlAuditoria(resumoOrigem)}</td>
        </tr>
        <tr id="${grupoId}" class="detail-row"><td colspan="7">
          <table><thead><tr><th>CT-e</th><th>Chave</th><th>Rota</th><th>Canal</th><th>Peso</th><th>Frete pago</th><th>Calculo AMD</th><th>Diferenca</th><th>Status</th></tr></thead>
          <tbody>${linhasCteHtml || '<tr><td colspan="9">Nenhum CT-e nesta fatura.</td></tr>'}</tbody></table>
        </td></tr>`;
      }).join('');
      const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" />
        <title>Laudo consolidado de faturas</title>
        <style>
          body{font-family:Arial,sans-serif;color:#061a44;margin:0;background:#f4f7fb}
          .hero{background:#071d49;color:white;padding:26px 34px}.wrap{padding:24px 34px}
          .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:18px 0}
          .card{border:1px solid #d6e0ef;border-radius:12px;background:white;padding:14px}.card span{display:block;color:#64748b;font-size:12px;font-weight:700}.card strong{display:block;font-size:22px;margin-top:6px}
          table{width:100%;border-collapse:collapse;background:white;border:1px solid #d6e0ef;border-radius:12px;overflow:hidden}th,td{border-bottom:1px solid #e5ebf5;padding:9px 10px;text-align:left;font-size:12px}th{background:#eef4ff}.main-row{cursor:pointer}.main-row:hover{background:#f8fbff}.detail-row{display:none;background:#fbfdff}.detail-row.open{display:table-row}.detail-row>td{padding:14px}.calc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}.calc-box{border:1px solid #dbe3ef;border-radius:10px;background:white;padding:12px}.calc-box h4{margin:0 0 8px}.calc-line{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #e5ebf5;padding:4px 0}.calc-line span{color:#64748b}.calc-line strong{text-align:right}.calc-empty{color:#64748b}.note{padding:12px 14px;border-radius:8px;background:#eff6ff;color:#1e3a8a;margin:16px 0;font-size:13px;font-weight:600}
          .report-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:16px 0}
          .export-button{border:0;border-radius:8px;background:#0f6b3e;color:#fff;font-weight:700;padding:11px 16px;cursor:pointer;white-space:nowrap}
          .filters{display:grid;grid-template-columns:minmax(240px,2fr) minmax(170px,1fr) auto auto;align-items:end;gap:10px;padding:12px;margin:0 0 12px;background:#f8fafc;border:1px solid #d6e0ef;border-radius:9px}
          .filters label{display:flex;flex-direction:column;gap:5px;color:#475569;font-size:11px;font-weight:700}
          .filters input,.filters select{box-sizing:border-box;width:100%;border:1px solid #cbd5e1;border-radius:7px;background:#fff;padding:9px;color:#0f172a}
          .clear-button{border:1px solid #cbd5e1;border-radius:7px;background:#fff;padding:9px 12px;cursor:pointer}
          .filters strong{padding:9px 0;white-space:nowrap}
          @media(max-width:850px){.filters{grid-template-columns:1fr 1fr}.filters label:first-child{grid-column:1/-1}}
          @media print{.filters,.export-button{display:none}}
        </style></head><body>
        <div class="hero"><h1>Laudo consolidado de faturas</h1><p>${escapeHtmlAuditoria(transportadoras || 'Transportadora')} - ${faturasSelecionadas.length} fatura(s) - gerado em ${new Date().toLocaleString('pt-BR')}</p></div>
        <div class="wrap"><div class="cards">${cards.map(([label, value]) => `<div class="card"><span>${escapeHtmlAuditoria(label)}</span><strong>${escapeHtmlAuditoria(value)}</strong></div>`).join('')}</div>
        <div class="note">Clique em cima de qualquer fatura para ver os CT-es; clique em cima de um CT-e para abrir os detalhes completos do calculo (taxas, ICMS, base do frete etc.).</div>
        <div class="filters">
          <label>Buscar<input id="filtro-busca" type="search" placeholder="Fatura, transportadora ou origem" oninput="aplicarFiltros()"></label>
          <label>Situacao<select id="filtro-status" onchange="aplicarFiltros()">
            <option value="">Todas</option>
            <option value="DIVERGENTE">Somente divergentes</option>
            <option value="OK">Sem diferenca</option>
          </select></label>
          <button type="button" class="clear-button" onclick="limparFiltros()">Limpar filtros</button>
          <strong id="resultado-filtro"></strong>
        </div>
        <div class="report-actions">
          <button class="export-button" type="button" onclick="exportarExcel()">Exportar Excel</button>
        </div>
    <table><thead><tr><th>Fatura</th><th>Transportadora</th><th>Valor cobrado</th><th>Calculo AMD</th><th>Diferenca</th><th>CT-es</th><th>Origem</th></tr></thead><tbody id="tabela-faturas-body">${linhasFatura || '<tr><td colspan="7">Nenhuma fatura selecionada.</td></tr>'}</tbody></table></div>
        <script>
          function toggleDetail(id){var el=document.getElementById(id);if(!el)return;el.style.display='';el.classList.toggle('open')}
          function normalizarFiltro(v){return String(v||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toUpperCase()}
          function aplicarFiltros(){
            var busca=normalizarFiltro(document.getElementById('filtro-busca').value);
            var status=document.getElementById('filtro-status').value;
            var visiveis=0;
            var linhas=document.querySelectorAll('#tabela-faturas-body > tr.main-row');
            linhas.forEach(function(row){
              var cols=row.cells;
              var texto=normalizarFiltro(row.textContent);
              var diferencaTexto=String(cols[4]&&cols[4].textContent||'').trim();
              var temDiferenca=diferencaTexto&&diferencaTexto!=='R$ 0,00'&&diferencaTexto!=='-R$ 0,00';
              var atendeStatus=!status||(status==='DIVERGENTE'?temDiferenca:!temDiferenca);
              var mostrar=(!busca||texto.includes(busca))&&atendeStatus;
              row.style.display=mostrar?'':'none';
              var detalhe=row.nextElementSibling;
              if(!mostrar&&detalhe&&detalhe.classList.contains('detail-row')){detalhe.style.display='none';detalhe.classList.remove('open')}
              if(mostrar)visiveis++;
            });
            document.getElementById('resultado-filtro').textContent=visiveis+' fatura(s) exibida(s)';
          }
          function limparFiltros(){
            document.getElementById('filtro-busca').value='';
            document.getElementById('filtro-status').value='';
            aplicarFiltros();
          }
          function exportarExcel(){
            var corpo=document.getElementById('tabela-faturas-body');
            var tabela=corpo.closest('table');
            var copia=tabela.cloneNode(true);
            Array.from(copia.querySelectorAll('.detail-row')).forEach(function(row){row.remove()});
            Array.from(copia.querySelectorAll('tbody tr')).forEach(function(row){
              if(row.style.display==='none')row.remove();
            });
            var conteudo='<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body>'+copia.outerHTML+'</body></html>';
            var blob=new Blob(['\\ufeff',conteudo],{type:'application/vnd.ms-excel;charset=utf-8'});
            var url=URL.createObjectURL(blob);
            var link=document.createElement('a');
            link.href=url;
            link.download='laudo-consolidado-faturas-${new Date().toISOString().slice(0, 10)}.xls';
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(function(){URL.revokeObjectURL(url)},1000);
          }
          aplicarFiltros();
        </script>
        </body></html>`;
      baixarArquivoAuditoria(html, `laudo-consolidado-faturas-${new Date().toISOString().slice(0, 10)}.html`, 'text/html;charset=utf-8');
      setMensagemImportacao(`Laudo consolidado gerado com ${faturasSelecionadas.length} fatura(s).`);
    } catch (error) {
      setMensagemImportacao(`Erro ao gerar laudo consolidado: ${error.message}`);
    } finally {
      setRecalculandoLote(false);
      setProgressoLote(null);
    }
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

      // Fatura nova ja nasce com o auditor atual da carteira da transportadora
      // (se ela tiver um definido) — assim "so as novas vao pro novo auditor"
      // acontece sozinho quando a gestora troca a carteira. So se aplica em
      // fatura NOVA (sem existenteId): reimportacao nunca mexe no auditor de
      // uma fatura que ja existia, pra nao atropelar quem ja estava tratando.
      const vinculosImportacao = await carregarVinculosTransportadoras().catch(() => []);
      const mapaVinculosImportacao = criarMapaVinculosTransportadoras(vinculosImportacao);
      const mapaAuditorPorTransportadora = new Map();
      (state.carteiras || []).forEach((carteira) => {
        if (!carteira.auditor_nome) return;
        mapaAuditorPorTransportadora.set(normalizarNomeTransportadora(carteira.transportadora), {
          auditor_nome: carteira.auditor_nome,
          auditor_email: carteira.auditor_email || '',
        });
      });

      let faturasSalvas = 0;
      let faturasNovas = 0;
      let faturasAtualizadas = 0;
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
          const nomeResolvido = aplicarVinculoTransportadora(fatura.transportadora, mapaVinculosImportacao);
          const auditorDaCarteira = !existenteId
            ? mapaAuditorPorTransportadora.get(normalizarNomeTransportadora(nomeResolvido))
            : null;
          const resultado = await salvarFaturaSupabase({
            ...(existenteId ? { id: existenteId } : {}),
            ...fatura,
            ...(auditorDaCarteira || {}),
            importado_por: sessao?.nome || sessao?.email || '',
            importado_em: new Date().toISOString(),
          });
          if (!resultado?.ok || !resultado.id) return;
          faturasSalvas += 1;
          if (existenteId) faturasAtualizadas += 1;
          else faturasNovas += 1;
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
      // carregarPlataformaAuditoria() nao busca protocolos/solicitacaoHistorico/
      // pagamentos (so a aba Financeiro usa, sob demanda) — preserva o que ja
      // tinha sido carregado antes pra nao "sumir" se o usuario ja tinha aberto
      // essa aba nesta sessao.
      onState({
        ...atualizado,
        protocolos: state.protocolos?.length ? state.protocolos : atualizado.protocolos,
        solicitacaoHistorico: state.solicitacaoHistorico?.length ? state.solicitacaoHistorico : atualizado.solicitacaoHistorico,
        pagamentos: state.pagamentos?.length ? state.pagamentos : atualizado.pagamentos,
      });

      // O calculo de status AMD NAO roda mais aqui: em arquivos grandes deixava
      // a importacao muito longa. Fica pra ser feito depois, fatura por fatura
      // (ou selecao de CT-es) usando o botao "Recalcular CT-es" dentro da fatura.
      const alertaVinculo = analise.detalhesNaoVinculados > 0
        ? ` ATENCAO: ${analise.detalhesNaoVinculados} CT-e(s) da aba Detalhes nao casaram com nenhuma fatura (confira Numero/Serie Fatura nas duas abas).`
        : '';
      const resumoCarga = {
        status: 'CONCLUIDA',
        arquivo: file.name,
        concluidaEm: new Date().toISOString(),
        usuario: sessao?.nome || sessao?.email || '',
        recebidas: rowsFaturas.length,
        novas: faturasNovas,
        atualizadas: faturasAtualizadas,
        ignoradas: analise.faturasIgnoradas,
        ctesVinculados: detalhesSalvos,
        ctesNaoVinculados: analise.detalhesNaoVinculados,
        faltamRecalcular: faturasSalvas,
      };
      setUltimaCargaFaturas(resumoCarga);
      localStorage.setItem(ULTIMA_CARGA_FATURAS_KEY, JSON.stringify(resumoCarga));
      setMensagemImportacao(
        `Importacao concluida: ${faturasNovas} nova(s), ${faturasAtualizadas} atualizada(s), ${detalhesSalvos} CT-e(s) vinculado(s), `
        + `${analise.faturasIgnoradas} fatura(s) ignorada(s). `
        + `Use "Recalcular CT-es" em cada fatura para calcular o status AMD.${alertaVinculo}`,
      );
    } catch (error) {
      const resumoErro = { status: 'ERRO', arquivo: file.name, concluidaEm: new Date().toISOString(), erro: error.message };
      setUltimaCargaFaturas(resumoErro);
      localStorage.setItem(ULTIMA_CARGA_FATURAS_KEY, JSON.stringify(resumoErro));
      setMensagemImportacao(`Erro na importacao: ${error.message}`);
    } finally {
      setImportando(false);
      setProgressoImportacao(null);
    }
  };

  return (
    <>
      {mostrarAuditoriaAvulsa && (
      <div className="panel-card audit-quick-card">
        <div className="section-row compact-top audit-quick-header">
          <div>
            <div className="panel-title">Auditoria rapida de CT-e</div>
            <p>Cole uma chave ou lista de CT-es para calcular com a tabela AMD atual e salvar na auditoria.</p>
          </div>
          <div className="actions-right">
            <div className={`audit-tolerance-control ${toleranciaAberta ? 'open' : ''}`} title="Tolerancia padrao da auditoria avulsa">
              <button className="audit-tolerance-toggle" type="button" onClick={() => setToleranciaAberta((atual) => !atual)}>
                Tolerancia +R$ {numeroFmt(toleranciaAuditoria.acima, 2)} / -R$ {numeroFmt(toleranciaAuditoria.abaixo, 2)}
              </button>
              {toleranciaAberta && (
                <>
                  <label>Acima R$<input type="number" min="0" step="0.01" value={toleranciaAuditoria.acima} onChange={(e) => alterarToleranciaAuditoria('acima', e.target.value)} /></label>
                  <label>Abaixo R$<input type="number" min="0" step="0.01" value={toleranciaAuditoria.abaixo} onChange={(e) => alterarToleranciaAuditoria('abaixo', e.target.value)} /></label>
                </>
              )}
            </div>
            <button className="btn-secondary audit-small-button" type="button" onClick={() => { setBuscaCtesAvulsa(''); setResultadoCtesAvulsos([]); setResultadoCtesAvulsosSalvos(false); setCteAvulsoExpandido(null); }} disabled={auditandoCtesAvulsos}>Limpar</button>
            <button className="btn-secondary audit-small-button" type="button" onClick={consultarCtesAvulsos} disabled={auditandoCtesAvulsos || !extrairIdentificadoresCte(buscaCtesAvulsa).length}>
              Consultar CT-es
            </button>
            <button className="btn-primary audit-small-button" type="button" onClick={auditarCtesAvulsos} disabled={auditandoCtesAvulsos || !extrairIdentificadoresCte(buscaCtesAvulsa).length}>
              {auditandoCtesAvulsos ? 'Auditando...' : 'Auditar CT-es'}
            </button>
            <button className="btn-secondary audit-small-button" type="button" onClick={auditarCtesAvulsos} disabled={auditandoCtesAvulsos || !extrairIdentificadoresCte(buscaCtesAvulsa).length} title="Limpa cache das tabelas e recalcula a lista atual">
              Atualizar tabelas e recalcular
            </button>
            <button className="btn-secondary audit-small-button" type="button" onClick={() => salvarAuditoriaAvulsa()} disabled={auditandoCtesAvulsos || !resultadoCtesAvulsos.length}>
              {resultadoCtesAvulsosSalvos ? 'Salvar novamente' : 'Salvar auditoria'}
            </button>
            <button className="btn-secondary audit-small-button" type="button" onClick={exportarAuditoriaAvulsaExcel} disabled={!resultadoCtesAvulsos.length}>Exportar Excel</button>
            <button className="btn-secondary audit-small-button" type="button" onClick={() => baixarLaudoAuditoriaAvulsa('interno')} disabled={!resultadoCtesAvulsos.length}>Laudo interno</button>
            <label className="audit-inline-check" title="Quando desmarcado, diferencas negativas saem como OK e R$ 0,00 no laudo do transportador">
              <input
                type="checkbox"
                checked={mostrarDiferencaNegativaLaudoTransportador}
                onChange={(e) => setMostrarDiferencaNegativaLaudoTransportador(e.target.checked)}
              />
              Mostrar dif. para baixo
            </label>
            <button className="btn-secondary audit-small-button" type="button" onClick={() => baixarLaudoAuditoriaAvulsa('transportador')} disabled={!resultadoCtesAvulsos.length}>Laudo transportador</button>
            <button className="btn-secondary audit-small-button" type="button" onClick={abrirFormularioDoccob} disabled={!ctesSelecionadosDoccob.length} title="Gera o arquivo DOCCOB EDI (layout PROCEDA 3.0A) com os CT-es marcados abaixo">
              Gerar DOCCOB ({ctesSelecionadosDoccob.length})
            </button>
          </div>
        </div>

        <div className="audit-quick-options" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', margin: '10px 0 12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700 }}>
            <input type="checkbox" checked={apenasDadosCompletosAvulso} onChange={(e) => setApenasDadosCompletosAvulso(e.target.checked)} />
            Considerar apenas CT-es com dados completos
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700 }}>
            <input type="checkbox" checked={usarPesoCteAvulso} onChange={(e) => setUsarPesoCteAvulso(e.target.checked)} />
            Usar peso do CT-e (ignora cubagem)
          </label>
          {usarPesoCteAvulso ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700 }}>
              % contingencia peso
              <input type="number" min="0" max="200" step="1" value={percentualContingenciaAvulso} onChange={(e) => setPercentualContingenciaAvulso(Number(e.target.value) || 0)} style={{ width: 72 }} />
            </label>
          ) : null}
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
              <span>{resultadoCtesAvulsosSalvos ? 'Auditoria salva e faturas relacionadas atualizadas.' : 'A auditoria sera salva automaticamente apos o calculo.'}</span>
            </div>
            <div className="audit-quick-summary-strip">
              <div className="audit-quick-summary-card">
                <span>CT-es</span>
                <strong>{numeroFmt(resumoAuditoriaAvulsa.total)}</strong>
              </div>
              <div className="audit-quick-summary-card">
                <span>Calculados AMD</span>
                <strong>{numeroFmt(resumoAuditoriaAvulsa.calculados)}</strong>
              </div>
              <div className="audit-quick-summary-card">
                <span>Dentro da tolerancia</span>
                <strong className="success">{numeroFmt(resumoAuditoriaAvulsa.ok)}</strong>
              </div>
              <div className="audit-quick-summary-card">
                <span>Divergentes</span>
                <strong className="danger">{numeroFmt(resumoAuditoriaAvulsa.divergentes)}</strong>
              </div>
              <div className="audit-quick-summary-card">
                <span>Sem calculo</span>
                <strong className="warning">{numeroFmt(resumoAuditoriaAvulsa.semCalculo)}</strong>
              </div>
              <div className="audit-quick-summary-card">
                <span>Frete pago</span>
                <strong>{dinheiro(resumoAuditoriaAvulsa.pago)}</strong>
              </div>
              <div className="audit-quick-summary-card">
                <span>Calculo AMD</span>
                <strong>{dinheiro(resumoAuditoriaAvulsa.amd)}</strong>
              </div>
              <div className="audit-quick-summary-card">
                <span>Cobranca acima</span>
                <strong className="danger">{dinheiro(resumoAuditoriaAvulsa.cobrancaAcima)}</strong>
              </div>
              <div className="audit-quick-summary-card">
                <span>Cobranca abaixo</span>
                <strong className="warning">{dinheiro(resumoAuditoriaAvulsa.cobrancaAbaixo)}</strong>
              </div>
              {mostrarDiferencaNegativaLaudoTransportador && (
                <div className="audit-quick-summary-card">
                  <span>Total a descontar</span>
                  <strong className="warning">{dinheiro(resumoAuditoriaAvulsa.totalDescontar)}</strong>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '10px 0' }}>
              <label className="field" style={{ minWidth: 260 }}>
                Filtrar resultado
                <select value={filtroAuditoriaAvulsa} onChange={(e) => setFiltroAuditoriaAvulsa(e.target.value)}>
                  <option value="todos">Todos</option>
                  <option value="divergentes">Somente divergentes</option>
                  <option value="ok">Dentro da tolerancia</option>
                  <option value="sem_calculo">Sem calculo</option>
                  <option value="devolucao">Devolucao invertida</option>
                  <option value="peso_alt">Com opcao de peso</option>
                </select>
              </label>
              <button className="btn-secondary audit-small-button" type="button" onClick={aplicarPesosOkAuditoriaAvulsa}>
                Aplicar pesos que entram na tolerancia
              </button>
              <button className="btn-secondary audit-small-button" type="button" onClick={selecionarTodosDoccob} disabled={!resultadoCtesAvulsosFiltrado.length}>
                {resultadoCtesAvulsosFiltrado.length && resultadoCtesAvulsosFiltrado.every((row, indice) => ctesSelecionadosDoccob.includes(row.chave_cte || row.numero_cte || indice)) ? 'Limpar selecao DOCCOB' : 'Selecionar todos p/ DOCCOB'}
              </button>
              <span style={{ color: '#64748b', fontSize: 12, fontWeight: 700 }}>
                Exibindo {resultadoCtesAvulsosFiltrado.length} de {resultadoCtesAvulsos.length}
              </span>
            </div>
            {doccobFormAberto && (
              <div className="sim-card" style={{ margin: '10px 0', padding: 14, border: '1px solid #cbd5e1', borderRadius: 8 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>
                  Gerar DOCCOB EDI (layout PROCEDA 3.0A) com {ctesSelecionadosDoccob.length} CT-e(s) selecionado(s)
                </div>
                <div className="sim-form-grid sim-grid-4">
                  <label>Filial<input value={doccobForm.filial} onChange={(e) => setDoccobForm((atual) => ({ ...atual, filial: e.target.value }))} placeholder="Unidade emissora" /></label>
                  <label>Numero documento cobranca<input value={doccobForm.numeroDocumento} onChange={(e) => setDoccobForm((atual) => ({ ...atual, numeroDocumento: e.target.value }))} /></label>
                  <label>Serie<input value={doccobForm.serieDocumento} onChange={(e) => setDoccobForm((atual) => ({ ...atual, serieDocumento: e.target.value }))} /></label>
                  <label>Tipo cobranca<input value={doccobForm.tipoCobranca} onChange={(e) => setDoccobForm((atual) => ({ ...atual, tipoCobranca: e.target.value }))} /></label>
                  <label>Data emissao<input type="date" value={doccobForm.dataEmissao} onChange={(e) => setDoccobForm((atual) => ({ ...atual, dataEmissao: e.target.value }))} /></label>
                  <label>Data vencimento<input type="date" value={doccobForm.dataVencimento} onChange={(e) => setDoccobForm((atual) => ({ ...atual, dataVencimento: e.target.value }))} /></label>
                  <label>CNPJ transportadora<input value={doccobForm.cnpjTransportadora} onChange={(e) => setDoccobForm((atual) => ({ ...atual, cnpjTransportadora: e.target.value }))} /></label>
                  <label>Razao social transportadora<input value={doccobForm.razaoSocialTransportadora} onChange={(e) => setDoccobForm((atual) => ({ ...atual, razaoSocialTransportadora: e.target.value }))} /></label>
                  <label>Banco/agente cobranca<input value={doccobForm.agenteCobranca} onChange={(e) => setDoccobForm((atual) => ({ ...atual, agenteCobranca: e.target.value }))} /></label>
                  <label>
                    CNPJ emissor da NF (reserva p/ CT-e sem cnpj tomador na base)
                    <input value={doccobForm.cnpjEmissorNf} onChange={(e) => setDoccobForm((atual) => ({ ...atual, cnpjEmissorNf: e.target.value }))} placeholder="Nao usar o CNPJ da transportadora" />
                  </label>
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                  {(() => {
                    const selecionados = resultadoCtesAvulsosFiltrado.filter((row, indice) => ctesSelecionadosDoccob.includes(row.chave_cte || row.numero_cte || indice));
                    const comCnpj = selecionados.filter((row) => row.cnpj_emissor_nf).length;
                    return `CNPJ emissor da NF: ${comCnpj} de ${selecionados.length} CT-e(s) selecionados ja tem esse CNPJ (extraido da chave da NF ou do CNPJ tomador). Os demais usarao o campo de reserva acima (se preenchido) ou ficarao sem esse dado.`;
                  })()}
                </div>
                <div style={{ marginTop: 12, padding: 10, border: '1px dashed #cbd5e1', borderRadius: 6, background: '#f8fafc' }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                    Contingencia: importar planilha com Numero NF / CNPJ remetente
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>
                    Pra CT-es sem tracking vinculado (ex.: atacado). Colunas aceitas: "Chave CTE" ou "CT-e", "Numero NF", "CNPJ remetente" (ou "Documento remetente"). Preenche so os campos abaixo que ainda estiverem vazios.
                  </div>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => importarContingenciaDoccobNf(e.target.files?.[0])}
                  />
                  {doccobImportandoContingencia ? (
                    <div style={{ fontSize: 12, color: '#0f766e', marginTop: 6 }}>{doccobImportandoContingencia}</div>
                  ) : null}
                </div>
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                    Numero da nota fiscal por CT-e (campo obrigatorio no DOCCOB - nossa base nao guarda esse numero, preencha manualmente)
                  </div>
                  <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 6 }}>
                    <table className="sim-analise-tabela" style={{ margin: 0 }}>
                      <thead><tr><th>CT-e</th><th>Valor pago</th><th>Numero da NF</th></tr></thead>
                      <tbody>
                        {resultadoCtesAvulsosFiltrado
                          .filter((row, indice) => ctesSelecionadosDoccob.includes(row.chave_cte || row.numero_cte || indice))
                          .map((row) => {
                            const key = row.chave_cte || row.numero_cte;
                            return (
                              <tr key={key}>
                                <td>{row.numero_cte || '-'}</td>
                                <td>{dinheiro(Number(row.valor_cte || 0))}</td>
                                <td>
                                  <input
                                    style={{ width: 140 }}
                                    value={doccobNumerosNf[key] ?? ''}
                                    onChange={(e) => setDoccobNumerosNf((atual) => ({ ...atual, [key]: e.target.value }))}
                                    placeholder="Numero da NF"
                                  />
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button className="btn-primary audit-small-button" type="button" onClick={gerarDoccobAuditoriaAvulsa} disabled={!doccobForm.numeroDocumento || !doccobForm.cnpjTransportadora}>
                    Baixar arquivo DOCCOB (.txt)
                  </button>
                  <button className="btn-secondary audit-small-button" type="button" onClick={() => setDoccobFormAberto(false)}>Cancelar</button>
                </div>
              </div>
            )}
            <div className="audit-quick-table-wrap">
              <table className="sim-analise-tabela audit-quick-table">
                <thead><tr><th>DOCCOB</th><th>CT-e</th><th>Chave</th><th>Transportadora</th><th>Canal</th><th>Rota</th><th>Peso NF</th><th>Pago</th><th>C�lculo Verum</th><th>Dif. Verum</th><th>C�lculo AMD</th><th>Dif. AMD</th><th>Status</th></tr></thead>
                <tbody>
                  {resultadoCtesAvulsosFiltrado.map((row, index) => {
                    const key = row.chave_cte || row.numero_cte || index;
                    const aberto = cteAvulsoExpandido === key;
                    const marcadoDoccob = ctesSelecionadosDoccob.includes(key);
                    const linhaOk = Number(row.valor_calculado || 0) > 0 && dentroDaToleranciaAuditoria(row.diferenca, toleranciaAuditoria);
                    const semValorNf = detalheSemValorNf(row);
                    const pago = Number(row.valor_cte || 0);
                    const verum = Number(row.valor_calculado_verum || 0);
                    const difVerum = row.diferenca_verum !== undefined && row.diferenca_verum !== null
                      ? Number(row.diferenca_verum)
                      : (verum > 0 ? pago - verum : 0);
                    const statusClass = `audit-status audit-status-${linhaOk ? 'ok' : String(row.status_calculo || row.status_auditoria || '').toLowerCase()}`;
                    const comparativoPesos = Array.isArray(row.detalhes_calculo?.comparativo_pesos)
                      ? row.detalhes_calculo.comparativo_pesos
                      : [];
                    const alternativasPeso = comparativoPesos
                      .map((alt) => ({
                        ...alt,
                        pesoAlternativo: pesoAlternativoAuditoriaAvulsa(alt),
                        valorAlternativo: valorCalculadoAlternativaAuditoriaAvulsa(alt),
                      }))
                      .filter((alt) => alt.pesoAlternativo > 0 && Math.abs(alt.pesoAlternativo - Number(row.peso || 0)) > 0.1)
                      .sort((a, b) => Math.abs(Number(a.diferenca || 999999)) - Math.abs(Number(b.diferenca || 999999)))
                      .slice(0, 2);
                    return (
                      <Fragment key={key}>
                        <tr className={`${aberto ? 'selected' : ''} ${linhaOk ? 'audit-row-ok' : ''}`.trim()} style={semValorNf ? { background: '#fff7ed', boxShadow: 'inset 4px 0 #f97316' } : undefined} role="button" tabIndex={0} onClick={() => setCteAvulsoExpandido(aberto ? null : key)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setCteAvulsoExpandido(aberto ? null : key); }}>
                          <td onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={marcadoDoccob} onChange={() => alternarCteDoccob(row, index)} />
                          </td>
                          <td><strong>{row.numero_cte || '-'}</strong></td>
                          <td><span className="audit-key-cell">{row.chave_cte || '-'}</span></td>
                          <td>{row.transportadora || row.transportadora_realizada || '-'}</td>
                          <td>{row.canal || row.canal_original || '-'}</td>
                          <td>{row.origem || row.cidade_origem || '-'} -&gt; {row.destino || row.cidade_destino || '-'}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span>{numeroFmt(row.peso ?? row.peso_declarado ?? row.detalhes_calculo?.peso_considerado, 3)} kg</span>
                              {alternativasPeso.map((alt) => (
                                <button
                                  key={`${alt.nome}-${alt.pesoAlternativo}`}
                                  className="btn-secondary audit-small-button"
                                  type="button"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    aplicarPesoAlternativoAvulso(row, alt);
                                  }}
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                  }}
                                  style={{ padding: '1px 6px', fontSize: 11 }}
                                  title={`Aplicar ${alt.nome || 'peso alternativo'} nesta linha`}
                                >
                                  usar {numeroFmt(alt.pesoAlternativo, 1)} kg � {dinheiroMaybe(alt.valorAlternativo)}
                                </button>
                              ))}
                            </div>
                          </td>
                          <td>{dinheiroMaybe(row.valor_cte)}</td>
                          <td>{verum > 0 ? dinheiroMaybe(verum) : '-'}</td>
                          <td>{verum > 0 ? dinheiroMaybe(difVerum) : '-'}</td>
                          <td>{dinheiroMaybe(row.valor_calculado)}</td>
                          <td>{dinheiroMaybe(row.diferenca)}</td>
                          <td><span className={statusClass}>{semValorNf ? 'Sem valor NF' : linhaOk ? 'Dentro da tolerancia' : (row.detalhes_calculo?.calculo_devolucao_invertida ? 'Devolucao invertida' : (row.status_auditoria || row.motivo_sem_calculo || '-'))}</span></td>
                        </tr>
                        {aberto && (
                          <tr className="audit-quick-detail-row"><td colSpan="13">
                            <div className="hint-box compact" style={{ marginBottom: 10, borderColor: semValorNf ? '#fdba74' : '#dbe3ef', background: semValorNf ? '#fff7ed' : '#f8fafc' }}>
                              <strong>{semValorNf ? 'CT-e sem valor NF identificado.' : 'Ajustes manuais do CT-e'}</strong>
                              <div className="form-grid three" style={{ marginTop: 8 }}>
                                {semValorNf ? (
                                  <label className="field">Chave NF para buscar no Tracking
                                    <input
                                      defaultValue={row.chave_nf_manual || row.chave_nfe_manual || ''}
                                      placeholder="Cole a chave NF ou numero da nota"
                                      onBlur={(event) => atualizarCteAvulsoManual(row, {
                                        chave_nf_manual: event.target.value.replace(/\D/g, ''),
                                        chave_nfe_manual: event.target.value.replace(/\D/g, ''),
                                      })}
                                    />
                                  </label>
                                ) : null}
                                <label className="field">Reentrega
                                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 36 }}>
                                    <input
                                      type="checkbox"
                                      checked={Boolean(row.reentrega_manual)}
                                      onChange={(event) => atualizarCteAvulsoManual(row, {
                                        reentrega_manual: event.target.checked,
                                        motivo_sem_calculo: event.target.checked ? 'CT-e marcado manualmente como reentrega: calcular 50% da ida.' : row.motivo_sem_calculo,
                                      })}
                                    />
                                    <span>Aplicar 50% do calculo da ida</span>
                                  </span>
                                </label>
                                {semValorNf ? (
                                  <div className="audit-form-actions">
                                    <button className="btn-secondary audit-small-button" type="button" onClick={() => buscarNfManualTrackingAvulso(row)}>
                                      Buscar NF no Tracking
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                              {row.tracking_manual_nf ? (
                                <p className="compact">NF vinculada manualmente pelo Tracking. Valor NF: <strong>{dinheiro(row.valor_nf)}</strong>; peso: <strong>{numeroFmt(row.peso, 3)} kg</strong>.</p>
                              ) : null}
                            </div>
                            <PainelDetalheCalculo resultado={row} onMudarPagina={onMudarPagina} onAbrirTransportadoras={onAbrirTransportadoras} />
                          </td></tr>
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
      )}


      {mostrarFaturas && (
      <>
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
        <p className="compact" style={{ marginTop: -4 }}>
          {visaoFatura === 'minhas' ? 'Mostrando suas faturas.' : visaoFatura === 'sem_auditor' ? 'Mostrando faturas sem auditor definido.' : 'Mostrando todas as faturas.'}
          {' '}Clique em um card para filtrar rápido; clique de novo para tirar o filtro.
        </p>
        <div className="summary-strip audit-quick-cards">
          {[
            ['vencidas', 'Vencidas', resumoCards.vencidas, resumoCards.vencidas ? '#9b1111' : '#047857'],
            ['a_vencer', 'A vencer (7 dias)', resumoCards.aVencer, resumoCards.aVencer ? '#d97706' : '#047857'],
            ['novas', 'Novas (recebidas)', resumoCards.novas, '#0369a1'],
            ['enviadas', 'Enviadas ao financeiro', resumoCards.enviadas, '#7c3aed'],
            ['lancadas', 'Já lançadas (aguardando pagto.)', resumoCards.lancadas, '#b45309'],
            ['pagas', 'Pagas', resumoCards.pagas, '#047857'],
            ['pagas_divergentes', 'Pagas com divergência', resumoCards.pagasDivergentes, resumoCards.pagasDivergentes ? '#d97706' : '#047857'],
          ].map(([chave, label, valor, cor]) => (
            <div
              key={chave}
              onClick={() => setFiltroRapido((atual) => (atual === chave ? '' : chave))}
              style={{ cursor: 'pointer' }}
              title={filtroRapido === chave ? 'Clique para remover o filtro' : 'Clique para filtrar a lista abaixo'}
            >
              <Card
                label={label}
                value={valor}
                color={cor}
                detail={filtroRapido === chave ? 'Filtro ativo' : undefined}
              />
            </div>
          ))}
        </div>
        <div className="form-grid three">
          <label className="field">Busca<input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Fatura, transportadora ou auditor" /></label>
          <label className="field">Status<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todos</option>{FATURA_STATUS.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="field">Auditor
            <select value={auditorFiltro} onChange={(e) => setAuditorFiltro(e.target.value)}>
              <option value="">Todos</option>
              {auditoresDisponiveis.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>
        <div className="form-grid three">
          <label className="field">Pagamento
            <select value={filtroPagamento} onChange={(e) => setFiltroPagamento(e.target.value)}>
              <option value="">Todos</option>
              <option value="PAGO">Pago</option>
              <option value="PAGO_DIVERGENTE">Pago com divergencia</option>
              <option value="PARTIDA_LANCADA">Partida lancada (aguardando)</option>
              <option value="LANCADA_FINANCEIRO">Lancada no financeiro (aguardando)</option>
              <option value="NAO_PAGO">Nao pago</option>
            </select>
          </label>
          <label className="field">Visao
            <select value={visaoFatura} onChange={(e) => setVisaoFatura(e.target.value)}>
              <option value="minhas">Minhas faturas</option>
              <option value="todas">Todas as faturas</option>
              <option value="sem_auditor">Sem auditor definido</option>
            </select>
          </label>
          <label className="field">
            Competência (emissão)
            <select value={competenciaFiltro} onChange={(e) => setCompetenciaFiltro(e.target.value)}>
              <option value="">Todas</option>
              {competenciasDisponiveis.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>
        <button
          type="button"
          className="btn-secondary audit-small-button"
          onClick={() => setFiltrosAvancadosAbertos((v) => !v)}
          style={{ marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <span>{filtrosAvancadosAbertos ? '▲' : '▼'}</span>
          {filtrosAvancadosAbertos ? 'Ocultar filtros avancados' : 'Mais filtros (canal, origem, período, lote)'}
        </button>
        {filtrosAvancadosAbertos && (
          <>
            <div className="form-grid three">
              <label className="field">Canal<select value={canalFiltro} onChange={(e) => setCanalFiltro(e.target.value)}><option value="">Todos</option>{canaisDisponiveis.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label className="field">Origem dos CT-es<input value={origemFiltroFatura} onChange={(e) => setOrigemFiltroFatura(e.target.value)} placeholder="Ex.: Itajaí, Contagem, Jaboatão" /></label>
              <label className="field">Emissão de<input type="date" value={periodoInicio} onChange={(e) => setPeriodoInicio(e.target.value)} /></label>
            </div>
            <div className="form-grid three">
              <label className="field">Emissão até<input type="date" value={periodoFim} onChange={(e) => setPeriodoFim(e.target.value)} /></label>
              <label className="field">Vencimento de<input type="date" value={vencimentoInicio} onChange={(e) => setVencimentoInicio(e.target.value)} /></label>
              <label className="field">Vencimento até<input type="date" value={vencimentoFim} onChange={(e) => setVencimentoFim(e.target.value)} /></label>
            </div>
            <div className="form-grid three">
              <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={somenteAuditadas} onChange={(e) => setSomenteAuditadas(e.target.checked)} />
                Só faturas com todos os CT-es na base (100% auditadas)
              </label>
            </div>
            <div className="form-grid three">
              <label className="field">Faturas em lote
                <textarea
                  value={filtroFaturasLote}
                  onChange={(e) => setFiltroFaturasLote(e.target.value)}
                  placeholder="Cole números de fatura, um por linha ou separados por vírgula"
                  rows={3}
                />
              </label>
            </div>
            {!canaisDisponiveis.length && <p className="compact">Nenhuma fatura tem canal detectado ainda — clique em "Detectar canais" pra habilitar o filtro de canal.</p>}
          </>
        )}
        {numerosFaturasLote.length > 0 && (
          <div className="hint-box compact">
            Filtro por lote: {numerosFaturasLote.length} número(s) informado(s), {lista.length} fatura(s) encontrada(s).
            <button className="btn-secondary audit-small-button" disabled={!lista.length} onClick={selecionarFaturasFiltradas} style={{ marginLeft: 8 }}>
              Selecionar filtradas
            </button>
            <button className="btn-secondary audit-small-button" onClick={() => setFiltroFaturasLote('')} style={{ marginLeft: 8 }}>
              Limpar lote
            </button>
          </div>
        )}
        <AmdProcessingOverlay ativo={importando} progresso={progressoImportacao} mensagemRodape="Pode levar mais tempo em arquivos com muitas faturas/CT-es e várias transportadoras." />
        <AmdProcessingOverlay ativo={recalculandoLote} progresso={progressoLote} mensagemRodape="Pode levar mais tempo com muitas faturas/CT-es selecionados." />
        {ultimaCargaFaturas && (
          <div className="hint-box compact" style={{ marginTop: 10, borderLeft: `4px solid ${ultimaCargaFaturas.status === 'CONCLUIDA' ? '#059669' : '#dc2626'}` }}>
            <strong>Última carga de faturas: {ultimaCargaFaturas.status === 'CONCLUIDA' ? 'concluída' : 'com erro'}</strong>
            {' · '}{ultimaCargaFaturas.arquivo || 'arquivo não identificado'}
            {' · '}{ultimaCargaFaturas.concluidaEm ? new Date(ultimaCargaFaturas.concluidaEm).toLocaleString('pt-BR') : '—'}
            {ultimaCargaFaturas.usuario ? ` · ${ultimaCargaFaturas.usuario}` : ''}
            {ultimaCargaFaturas.status === 'CONCLUIDA' ? (
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
                <span>Recebidas: <strong>{Number(ultimaCargaFaturas.recebidas || 0).toLocaleString('pt-BR')}</strong></span>
                <span>Novas: <strong>{Number(ultimaCargaFaturas.novas || 0).toLocaleString('pt-BR')}</strong></span>
                <span>Atualizadas, sem duplicar: <strong>{Number(ultimaCargaFaturas.atualizadas || 0).toLocaleString('pt-BR')}</strong></span>
                <span>Ignoradas: <strong>{Number(ultimaCargaFaturas.ignoradas || 0).toLocaleString('pt-BR')}</strong></span>
                <span>CT-es vinculados: <strong>{Number(ultimaCargaFaturas.ctesVinculados || 0).toLocaleString('pt-BR')}</strong></span>
                <span style={{ color: ultimaCargaFaturas.ctesNaoVinculados ? '#b45309' : undefined }}>CT-es sem vínculo: <strong>{Number(ultimaCargaFaturas.ctesNaoVinculados || 0).toLocaleString('pt-BR')}</strong></span>
                <span style={{ color: ultimaCargaFaturas.faltamRecalcular ? '#b45309' : undefined }}>Falta recalcular AMD: <strong>{Number(ultimaCargaFaturas.faltamRecalcular || 0).toLocaleString('pt-BR')} fatura(s)</strong></span>
              </div>
            ) : <div style={{ marginTop: 8 }}>{ultimaCargaFaturas.erro}</div>}
          </div>
        )}
        {mensagemImportacao && <div className="hint-box compact">{mensagemImportacao}</div>}
        <p className="compact">Layout esperado: abas Faturas e Detalhes, com Transportadora, Numero Fatura, Data Vencimento, Valor Fatura e Chave CTe.</p>
      </div>
      {selecionadasIds.length > 0 && (
        <>
        <div className="summary-strip auditoria-avulsa-summary">
          <Card label="Faturas selecionadas" value={resumoSelecaoFaturas.faturas} />
          <Card label="CT-es selecionados" value={resumoSelecaoFaturas.ctes} />
          <Card label="Frete cobrado" value={dinheiro(resumoSelecaoFaturas.fretePago)} />
          <Card label="Calculo AMD" value={dinheiro(resumoSelecaoFaturas.calculoAmd)} />
          <Card label="Cobranca a maior" value={dinheiro(resumoSelecaoFaturas.cobrancaAcima)} color="#dc2626" />
          <Card label="Cobranca a menor" value={dinheiro(resumoSelecaoFaturas.cobrancaAbaixo)} color="#d97706" />
          <Card label="Total a descontar" value={dinheiro(resumoSelecaoFaturas.totalDescontar)} color={resumoSelecaoFaturas.totalDescontar ? '#d97706' : '#047857'} />
          <Card label="Sem calculo" value={resumoSelecaoFaturas.semCalculo} color={resumoSelecaoFaturas.semCalculo ? '#d97706' : '#047857'} />
          <Card label="Dentro da tolerancia" value={resumoSelecaoFaturas.tolerancia} />
          <Card label="Divergentes" value={resumoSelecaoFaturas.divergentes} color={resumoSelecaoFaturas.divergentes ? '#dc2626' : '#047857'} />
        </div>
        <OpcoesLaudoTransportador opcoes={opcoesLaudoTransportadorLote} onMudar={setOpcoesLaudoTransportadorLote} />
        <div className="audit-action-bar">
          <span>{selecionadasIds.length} fatura(s) selecionada(s)</span>
          <button className="btn-primary" disabled={recalculandoLote} onClick={recalcularLote}>
            {recalculandoLote ? 'Recalculando...' : `Recalcular CT-es (${selecionadasIds.length} fatura(s))`}
          </button>
          <select value={statusLote} onChange={(e) => setStatusLote(e.target.value)} disabled={recalculandoLote}>
            <option value="">Status em massa</option>
            {FATURA_STATUS.map((item) => <option key={item} value={item}>{nomeStatus(item)}</option>)}
          </select>
          <button className="btn-secondary" disabled={recalculandoLote || !statusLote} onClick={() => atualizarFaturasEmMassa('status')}>Aplicar status</button>
          <input value={auditorLote} onChange={(e) => setAuditorLote(e.target.value)} placeholder="Auditor" disabled={recalculandoLote} style={{ maxWidth: 180 }} />
          <input value={emailAuditorLote} onChange={(e) => setEmailAuditorLote(e.target.value)} placeholder="E-mail auditor" disabled={recalculandoLote} style={{ maxWidth: 210 }} />
          <button className="btn-secondary" disabled={recalculandoLote || !auditorLote.trim()} onClick={() => atualizarFaturasEmMassa('auditor')}>Aplicar auditor</button>
          <button className="btn-primary" disabled={recalculandoLote} onClick={() => atualizarFaturasEmMassa('liberar')}>Liberar selecionadas</button>
          <button className="btn-secondary" disabled={recalculandoLote} onClick={() => baixarLaudoFaturasSelecionadas('interno')}>Laudo consolidado</button>
          <button className="btn-secondary" disabled={recalculandoLote} onClick={() => baixarLaudoFaturasSelecionadas('transportador')}>Laudo transportador lote</button>
          <button className="btn-secondary" disabled={recalculandoLote} onClick={() => setSelecionadasIds([])}>Limpar selecao</button>
        </div>
        </>
      )}
      <div className="section-row compact-top">
        <span className="compact">
          {lista.length ? `Pagina ${paginaFaturasAtual} de ${totalPaginasFaturas} - mostrando ${listaPaginada.length} de ${lista.length} fatura(s)` : 'Nenhuma fatura encontrada com os filtros atuais.'}
        </span>
        {totalPaginasFaturas > 1 && (
          <div className="actions-right">
            <button className="btn-secondary audit-small-button" disabled={paginaFaturasAtual <= 1} onClick={() => setPaginaFaturas((p) => Math.max(1, p - 1))}>Anterior</button>
            <button className="btn-secondary audit-small-button" disabled={paginaFaturasAtual >= totalPaginasFaturas} onClick={() => setPaginaFaturas((p) => Math.min(totalPaginasFaturas, p + 1))}>Proxima</button>
          </div>
        )}
      </div>
      <div className="table-card">
        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead><tr><th><input type="checkbox" checked={todasFiltradasSelecionadas} disabled={!lista.length} onChange={alternarSelecaoFiltradas} title="Selecionar/desmarcar todas as faturas filtradas (todas as paginas)" /></th><th>Fatura</th><th>Transportadora</th><th>Origem</th><th>Vencimento</th><th>Valor</th><th>CT-es</th><th>Divergencia</th><th>Auditor</th><th>Status</th><th>Pagamento</th><th></th></tr></thead>
            <tbody>
              {listaPaginada.map((fatura) => {
                const auditadaCompleta = faturaTotalmenteAuditada(fatura);
                return (
                  <tr key={fatura.id} onClick={() => setAberta(fatura)} style={{ cursor: 'pointer', ...(auditadaCompleta ? { background: '#f0fdf4', borderLeft: '3px solid #16a34a' } : {}) }}>
                    <td onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selecionadasIds.includes(fatura.id)} onChange={() => alternarSelecao(fatura.id)} /></td>
                    <td><strong>{fatura.numero_fatura}</strong></td>
                    <td>{fatura.transportadora}</td>
                    <td title={resumoOrigensFaturas.get(fatura.id)?.tooltip || 'Origem ainda nao carregada/auditada'}>
                      {resumoOrigensFaturas.get(fatura.id)?.principal || '-'}
                      {resumoOrigensFaturas.get(fatura.id)?.totalOrigens > 1 && (
                        <small className="audit-days">+{resumoOrigensFaturas.get(fatura.id).totalOrigens - 1} origem(ns)</small>
                      )}
                    </td>
                    <td style={{ color: corAlerta(fatura), fontWeight: 700 }}>{dataBr(fatura.data_vencimento)}<small className="audit-days">{diasAte(fatura.data_vencimento)} dia(s)</small></td>
                    <td>{dinheiro(fatura.valor_fatura)}</td>
                    <td>
                      {fatura.ctes_auditados || fatura.ctes_vinculados || 0}/{fatura.ctes_totais || 0}
                      {auditadaCompleta && <small style={{ display: 'block', color: '#16a34a', fontWeight: 700 }}>100% auditada</small>}
                    </td>
                    <td className={Number(fatura.diferenca) ? 'negativo' : ''}>{dinheiro(fatura.diferenca)}</td>
                    <td>{fatura.auditor_nome || <strong className="error-text">SEM AUDITOR DEFINIDO</strong>}</td>
                    <td><Status value={fatura.status} /></td>
                    <td
                      title={fatura.data_pagamento
                        ? `Pago em ${dataBr(fatura.data_pagamento)} - partida ${fatura.partida || '-'} - valor ${dinheiro(fatura.valor_pago)}`
                        : fatura.lancamento_financeiro
                          ? `Ja lancada no financeiro em ${dataBr(fatura.lancamento_financeiro_em)} (lancamento ${fatura.lancamento_financeiro}), aguardando pagamento final`
                          : 'Ainda sem pagamento conciliado'}
                    >
                      <Status value={situacaoPagamentoFatura(fatura)} />
                    </td>
                    <td><button className="btn-secondary audit-small-button" onClick={(event) => { event.stopPropagation(); setAberta(fatura); }}>Abrir</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}
    </>
  );
}

function Gestao({ state, onState }) {
  const [visao, setVisao] = useState('transportadora');
  const [filtroBusca, setFiltroBusca] = useState('');
  const [filtroAuditor, setFiltroAuditor] = useState('');
  const [filtroVencimento, setFiltroVencimento] = useState('');
  const [editandoTransportadora, setEditandoTransportadora] = useState(null);
  const [auditorId, setAuditorId] = useState('');
  const [auditores, setAuditores] = useState([]);
  const [carregandoAuditores, setCarregandoAuditores] = useState(false);
  const [erroAuditores, setErroAuditores] = useState('');
  const [adicionandoParaAuditor, setAdicionandoParaAuditor] = useState(null);
  const [transportadoraParaAdicionar, setTransportadoraParaAdicionar] = useState('');
  const [selecionadas, setSelecionadas] = useState(() => new Set());
  const [auditorIdMassa, setAuditorIdMassa] = useState('');
  const [aplicandoMassa, setAplicandoMassa] = useState(false);
  const [erroAtribuicao, setErroAtribuicao] = useState('');
  const [salvandoAtribuicao, setSalvandoAtribuicao] = useState(false);

  const alternarSelecao = (transportadora) => {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(transportadora)) next.delete(transportadora); else next.add(transportadora);
      return next;
    });
  };
  const [transportadorasCadastro, setTransportadorasCadastro] = useState([]);
  const [carregandoTransportadoras, setCarregandoTransportadoras] = useState(false);
  const [erroTransportadoras, setErroTransportadoras] = useState('');
  const [historicoAberto, setHistoricoAberto] = useState(null);
  const [historicoItens, setHistoricoItens] = useState([]);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);
  const [erroHistorico, setErroHistorico] = useState('');

  const abrirHistorico = async (transportadora) => {
    setHistoricoAberto(transportadora);
    setCarregandoHistorico(true);
    setErroHistorico('');
    try {
      setHistoricoItens(await listarHistoricoCarteiraAuditoria(transportadora));
    } catch (error) {
      setErroHistorico(error.message || 'Erro ao carregar histórico.');
    } finally {
      setCarregandoHistorico(false);
    }
  };

  useEffect(() => {
    let cancelado = false;
    setCarregandoAuditores(true);
    listarUsuariosSupabase()
      .then((usuarios) => {
        if (cancelado) return;
        setAuditores((usuarios || []).filter((u) => u.perfil === 'AUDITORIA_FRETES' && u.ativo));
      })
      .catch((error) => { if (!cancelado) setErroAuditores(error.message || 'Erro ao carregar auditores.'); })
      .finally(() => { if (!cancelado) setCarregandoAuditores(false); });
    return () => { cancelado = true; };
  }, []);

  useEffect(() => {
    let cancelado = false;
    const supabase = getSupabaseClient();
    if (!supabase) return undefined;
    setCarregandoTransportadoras(true);
    supabase.from('transportadoras').select('id, nome, status').order('nome', { ascending: true })
      .then(({ data, error }) => {
        if (cancelado) return;
        if (error) { setErroTransportadoras(error.message || 'Erro ao carregar transportadoras.'); return; }
        setTransportadorasCadastro(data || []);
      })
      .finally(() => { if (!cancelado) setCarregandoTransportadoras(false); });
    return () => { cancelado = true; };
  }, []);

  const [mapaVinculos, setMapaVinculos] = useState(null);
  useEffect(() => {
    let cancelado = false;
    carregarVinculosTransportadoras()
      .then((vinculos) => { if (!cancelado) setMapaVinculos(criarMapaVinculosTransportadoras(vinculos)); })
      .catch(() => { if (!cancelado) setMapaVinculos(new Map()); });
    return () => { cancelado = true; };
  }, []);

  // Carteira = 1 linha por transportadora do cadastro (modulo Transportadoras),
  // nao so as que ja tem carteira criada em auditoria_carteiras. Transportadoras
  // sem fatura/carteira ainda aparecem com faturas/CT-es zerados — normal, so
  // ganham numero quando a base de faturas vincular algo a elas.
  // O nome da fatura vem de importacao/texto livre e pode ser bem diferente do
  // nome oficial (razao social vs nome curto) — por isso primeiro resolvemos
  // pelo mesmo vinculo de nomes ja mantido em Ferramentas (transportadora_vinculos),
  // e só depois normalizamos (maiuscula/acento) pra comparar.
  const resolverNomeTransportadora = (v) => (mapaVinculos ? aplicarVinculoTransportadora(v, mapaVinculos) : v);

  // Agrupar faturas/carteiras 1x (O(faturas)+O(carteiras)) em vez de fazer um
  // .filter/.find na lista inteira de faturas para CADA transportadora
  // (O(transportadoras x faturas) — travava a tela e o filtro com bases grandes).
  const mapaFaturasPorTransportadora = useMemo(() => {
    const mapa = new Map();
    state.faturas.forEach((item) => {
      const chave = normalizarNomeTransportadora(resolverNomeTransportadora(item.transportadora));
      if (!mapa.has(chave)) mapa.set(chave, []);
      mapa.get(chave).push(item);
    });
    return mapa;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.faturas, mapaVinculos]);

  const mapaCarteirasExistentes = useMemo(() => {
    const mapa = new Map();
    state.carteiras.forEach((c) => mapa.set(normalizarNomeTransportadora(c.transportadora), c));
    return mapa;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.carteiras]);

  const carteiras = useMemo(() => {
    const base = transportadorasCadastro.length ? transportadorasCadastro : state.carteiras.map((c) => ({ nome: c.transportadora }));
    return base.map((t) => {
      const nomeNorm = normalizarNomeTransportadora(t.nome);
      const existente = mapaCarteirasExistentes.get(nomeNorm);
      const faturas = mapaFaturasPorTransportadora.get(nomeNorm) || [];
      let ctes = 0; let valor = 0; let vencidas = 0; let vencendo = 0; let aguardando = 0; let pagas = 0; let canceladas = 0;
      faturas.forEach((item) => {
        ctes += Number(item.ctes_totais || 0);
        valor += Number(item.valor_fatura || 0);
        const faixa = faixaVencimento(item);
        if (faixa === 'VENCIDA') vencidas += 1;
        else if (['CRITICO', 'LARANJA', 'AMARELO', 'VENCENDO_7_DIAS'].includes(faixa)) vencendo += 1;
        if (['AGUARDANDO_TRANSPORTADORA', 'AGUARDANDO_NOVA_FATURA'].includes(item.status)) aguardando += 1;
        if (['PAGA', 'PAGA_COM_DIVERGENCIA'].includes(item.status)) pagas += 1;
        if (item.status === 'CANCELADA') canceladas += 1;
      });
      return {
        id: existente?.id || null,
        transportadora: t.nome,
        auditor_nome: existente?.auditor_nome || '',
        auditor_email: existente?.auditor_email || '',
        atribuido_em: existente?.atribuido_em || null,
        atribuido_por: existente?.atribuido_por || '',
        quantidade: faturas.length,
        ctes, valor, vencidas, vencendo, aguardando, pagas, canceladas,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transportadorasCadastro, state.carteiras, mapaFaturasPorTransportadora, mapaCarteirasExistentes]);

  const carteirasFiltradas = useMemo(() => {
    const buscaNorm = normalizarNomeTransportadora(filtroBusca);
    return carteiras.filter((item) => {
      if (buscaNorm && !normalizarNomeTransportadora(item.transportadora).includes(buscaNorm)) return false;
      if (filtroAuditor === 'SEM_AUDITOR' && item.auditor_nome) return false;
      if (filtroAuditor && filtroAuditor !== 'SEM_AUDITOR' && item.auditor_nome !== filtroAuditor) return false;
      if (filtroVencimento) {
        const faturas = mapaFaturasPorTransportadora.get(normalizarNomeTransportadora(item.transportadora)) || [];
        if (!faturas.some((fatura) => faturaNaJanelaVencimento(fatura, filtroVencimento))) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carteiras, filtroBusca, filtroAuditor, filtroVencimento, mapaFaturasPorTransportadora]);

  const porAuditor = useMemo(() => {
    const mapa = new Map();
    carteiras.forEach((item) => {
      if (!item.auditor_nome) return;
      const acumulado = mapa.get(item.auditor_nome) || { faturas: 0, ctes: 0, transportadoras: 0 };
      acumulado.faturas += item.quantidade;
      acumulado.ctes += item.ctes;
      acumulado.transportadoras += 1;
      mapa.set(item.auditor_nome, acumulado);
    });
    return mapa;
  }, [carteiras]);

  // Recebe o estado base explicitamente (em vez de fechar sobre `state`) pra
  // poder ser encadeada em sequencia numa atribuicao em massa — cada chamada
  // usa o resultado da anterior, senao a 2a atribuicao pisaria na 1a porque
  // as duas partiriam do mesmo `state.carteiras` desatualizado.
  //
  // Regra de continuidade (pedido do usuario, 2026-07-22):
  // - Fatura ja encerrada (paga/paga c/ divergencia/cancelada/substituida)
  //   NUNCA muda de auditor — fica pra sempre com quem tratou.
  // - Fatura aberta (vencida ou a vencer) sem auditor definido: sempre vai
  //   pro novo auditor da carteira, normal.
  // - Fatura aberta que ja tem outro auditor: so muda se `transferirAbertas`
  //   for true. Se false, mantem o auditor atual "ate ele resolver" e nao
  //   empurra pendencia pra pessoa nova.
  const aplicarAtribuicaoComEstado = async (estadoBase, carteira, usuario, { transferirAbertas = true } = {}) => {
    const gestorNome = carregarSessao()?.nome || 'Gestao';
    const agora = new Date().toISOString();
    let next = await salvarCarteiraAuditoria(estadoBase, {
      ...carteira,
      auditor_id: usuario.id,
      auditor_nome: usuario.nome,
      auditor_email: usuario.email,
      atribuido_por: gestorNome,
      atribuido_em: agora,
    });
    const carteiraNorm = normalizarNomeTransportadora(carteira.transportadora);
    const relacionadas = next.faturas.filter((item) => normalizarNomeTransportadora(resolverNomeTransportadora(item.transportadora)) === carteiraNorm);
    for (const fatura of relacionadas) {
      if (ENCERRADOS.has(fatura.status)) continue;
      const jaTemOutroAuditor = Boolean(fatura.auditor_nome) && fatura.auditor_nome !== usuario.nome;
      if (jaTemOutroAuditor && !transferirAbertas) continue;
      next = await atualizarFaturaAuditoria(next, { ...fatura, auditor_nome: usuario.nome, auditor_email: usuario.email }, {
        acao: 'AUDITOR_ATRIBUIDO', descricao: `Carteira atribuida a ${usuario.nome}.`, usuario_nome: gestorNome,
      });
    }
    await registrarHistoricoCarteiraAuditoria({
      transportadora: carteira.transportadora, auditorNome: usuario.nome, auditorEmail: usuario.email, atribuidoPor: gestorNome,
    });
    return next;
  };

  // Faturas ABERTAS (nao encerradas) de uma carteira que ja tem outro auditor
  // dono — sao as que disparam a pergunta de transferencia. Encerradas nunca
  // contam aqui (ja ficam com quem tratou de qualquer forma).
  const contarPendenciasDeOutroAuditor = (carteira, novoAuditorNome) => {
    const carteiraNorm = normalizarNomeTransportadora(carteira.transportadora);
    return state.faturas.filter((item) => (
      normalizarNomeTransportadora(resolverNomeTransportadora(item.transportadora)) === carteiraNorm
      && !ENCERRADOS.has(item.status)
      && item.auditor_nome
      && item.auditor_nome !== novoAuditorNome
    )).length;
  };

  const [confirmacaoTransferencia, setConfirmacaoTransferencia] = useState(null);

  const executarAtribuicaoUnica = async (carteira, usuario, transferirAbertas) => {
    setErroAtribuicao('');
    setSalvandoAtribuicao(true);
    try {
      onState(await aplicarAtribuicaoComEstado(state, carteira, usuario, { transferirAbertas }));
      setEditandoTransportadora(null);
      setAuditorId('');
      setAdicionandoParaAuditor(null);
      setTransportadoraParaAdicionar('');
      setConfirmacaoTransferencia(null);
    } catch (error) {
      setErroAtribuicao(error.message || 'Erro ao atribuir auditor.');
    } finally {
      setSalvandoAtribuicao(false);
    }
  };

  const executarAtribuicaoMassa = async (listaCarteiras, usuario, transferirAbertas) => {
    setAplicandoMassa(true);
    setSalvandoAtribuicao(true);
    setErroAtribuicao('');
    try {
      let estadoAtual = state;
      for (const carteira of listaCarteiras) {
        estadoAtual = await aplicarAtribuicaoComEstado(estadoAtual, carteira, usuario, { transferirAbertas });
      }
      onState(estadoAtual);
      setSelecionadas(new Set());
      setAuditorIdMassa('');
      setConfirmacaoTransferencia(null);
    } catch (error) {
      setErroAtribuicao(error.message || 'Erro ao atribuir auditor em massa.');
    } finally {
      setAplicandoMassa(false);
      setSalvandoAtribuicao(false);
    }
  };

  const atribuir = async () => {
    if (!editandoTransportadora || !auditorId) return;
    const usuario = auditores.find((u) => String(u.id) === String(auditorId));
    const carteira = carteiras.find((item) => item.transportadora === editandoTransportadora);
    if (!usuario || !carteira) return;
    const pendencias = contarPendenciasDeOutroAuditor(carteira, usuario.nome);
    if (pendencias > 0) {
      setConfirmacaoTransferencia({ tipo: 'unica', carteira, usuario, pendencias });
      return;
    }
    await executarAtribuicaoUnica(carteira, usuario, true);
  };

  const adicionarTransportadoraAoAuditor = async (usuario) => {
    const carteira = carteiras.find((item) => item.transportadora === transportadoraParaAdicionar);
    if (!carteira) return;
    const pendencias = contarPendenciasDeOutroAuditor(carteira, usuario.nome);
    if (pendencias > 0) {
      setConfirmacaoTransferencia({ tipo: 'unica', carteira, usuario, pendencias });
      return;
    }
    await executarAtribuicaoUnica(carteira, usuario, true);
  };

  const atribuirEmMassa = async () => {
    const usuario = auditores.find((u) => String(u.id) === String(auditorIdMassa));
    if (!usuario || !selecionadas.size) return;
    const listaCarteiras = [...selecionadas].map((nome) => carteiras.find((item) => item.transportadora === nome)).filter(Boolean);
    const pendencias = listaCarteiras.reduce((total, c) => total + contarPendenciasDeOutroAuditor(c, usuario.nome), 0);
    if (pendencias > 0) {
      setConfirmacaoTransferencia({ tipo: 'massa', listaCarteiras, usuario, pendencias });
      return;
    }
    await executarAtribuicaoMassa(listaCarteiras, usuario, true);
  };

  return (
    <>
      <AmdProcessingOverlay ativo={salvandoAtribuicao} progresso={{}} mensagemRodape="Gravando a atribuição de auditor." />
      <div className="summary-strip">
        <Card label="Auditores ativos" value={new Set(carteiras.filter((item) => item.auditor_nome).map((item) => item.auditor_nome)).size} />
        <Card label="Transportadoras" value={carteiras.length} />
        <Card label="Sem responsavel" value={carteiras.filter((item) => !item.auditor_nome).length} color="#9b1111" />
        <Card label="Faturas vencidas" value={carteiras.reduce((total, item) => total + item.vencidas, 0)} color="#9b1111" />
      </div>
      {porAuditor.size > 0 && (
        <div className="table-card">
          <div className="panel-title audit-table-title">Carga por auditor</div>
          <div className="sim-analise-tabela-wrap">
            <table className="sim-analise-tabela">
              <thead><tr><th>Auditor</th><th>Transportadoras</th><th>Faturas</th><th>CT-es</th></tr></thead>
              <tbody>
                {[...porAuditor.entries()].map(([nome, acumulado]) => (
                  <tr key={nome}>
                    <td><strong>{nome}</strong></td>
                    <td>{acumulado.transportadoras}</td>
                    <td>{acumulado.faturas}</td>
                    <td>{acumulado.ctes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="sim-actions" style={{ marginBottom: 12 }}>
        <button className={visao === 'transportadora' ? 'btn-primary' : 'btn-secondary'} onClick={() => setVisao('transportadora')}>Por transportadora</button>
        <button className={visao === 'auditor' ? 'btn-primary' : 'btn-secondary'} onClick={() => setVisao('auditor')}>Por auditor</button>
      </div>
      <div className="sim-actions" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <input
          type="text"
          placeholder="Buscar transportadora..."
          value={filtroBusca}
          onChange={(e) => setFiltroBusca(e.target.value)}
          style={{ minWidth: 200 }}
        />
        <select value={filtroAuditor} onChange={(e) => setFiltroAuditor(e.target.value)}>
          <option value="">Todos os auditores</option>
          <option value="SEM_AUDITOR">Sem auditor definido</option>
          {auditores.map((u) => <option key={u.id} value={u.nome}>{u.nome}</option>)}
        </select>
        <select value={filtroVencimento} onChange={(e) => setFiltroVencimento(e.target.value)}>
          {OPCOES_FILTRO_VENCIMENTO.map((opcao) => <option key={opcao.value} value={opcao.value}>{opcao.label}</option>)}
        </select>
        {(filtroBusca || filtroAuditor || filtroVencimento) && (
          <button className="btn-secondary audit-small-button" onClick={() => { setFiltroBusca(''); setFiltroAuditor(''); setFiltroVencimento(''); }}>Limpar filtros</button>
        )}
        <small style={{ color: 'var(--muted, #5f7197)' }}>{carteirasFiltradas.length} de {carteiras.length} transportadora(s)</small>
      </div>
      {visao === 'transportadora' ? (
        <div className="table-card">
          <div className="panel-title audit-table-title">Distribuicao de carteiras</div>
          {carregandoTransportadoras && <div style={{ padding: '4px 4px 8px' }}>Carregando transportadoras...</div>}
          {erroTransportadoras && <div className="error-text" style={{ padding: '4px 4px 8px' }}>{erroTransportadoras}</div>}
          {erroAtribuicao && <div className="error-text" style={{ padding: '4px 4px 8px' }}>{erroAtribuicao}</div>}
          {selecionadas.size > 0 && (
            <div className="sim-actions" style={{ margin: '4px 4px 12px', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <strong>{selecionadas.size} selecionada(s)</strong>
              <select value={auditorIdMassa} onChange={(e) => setAuditorIdMassa(e.target.value)} disabled={aplicandoMassa}>
                <option value="">Selecione um auditor</option>
                {auditores.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select>
              <button className="btn-primary audit-small-button" onClick={atribuirEmMassa} disabled={!auditorIdMassa || aplicandoMassa}>
                {aplicandoMassa ? 'Atribuindo...' : 'Atribuir às selecionadas'}
              </button>
              <button className="btn-secondary audit-small-button" onClick={() => setSelecionadas(new Set())} disabled={aplicandoMassa}>Limpar seleção</button>
            </div>
          )}
          <div className="sim-analise-tabela-wrap">
            <table className="sim-analise-tabela">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={carteirasFiltradas.length > 0 && carteirasFiltradas.every((item) => selecionadas.has(item.transportadora))}
                      onChange={(e) => setSelecionadas(e.target.checked ? new Set(carteirasFiltradas.map((item) => item.transportadora)) : new Set())}
                    />
                  </th>
                  <th>Auditor</th><th>Desde</th><th>Transportadora</th><th>Faturas</th><th>CT-es</th><th>Valor em aberto</th><th>Vencidas</th><th>Vencendo</th><th>Aguardando retorno</th><th>Pagas</th><th>Canceladas</th><th></th>
                </tr>
              </thead>
              <tbody>
                {carteirasFiltradas.map((item) => (
                  <Fragment key={item.transportadora}>
                    <tr>
                      <td><input type="checkbox" checked={selecionadas.has(item.transportadora)} onChange={() => alternarSelecao(item.transportadora)} /></td>
                      <td>{item.auditor_nome || <strong className="error-text">SEM AUDITOR DEFINIDO</strong>}</td>
                      <td>{dataBr(item.atribuido_em)}</td>
                      <td><strong>{item.transportadora}</strong></td><td>{item.quantidade}</td><td>{item.ctes}</td><td>{dinheiro(item.valor)}</td>
                      <td>{item.vencidas}</td><td>{item.vencendo}</td><td>{item.aguardando}</td><td>{item.pagas}</td><td>{item.canceladas}</td>
                      <td>
                        <button
                          className="btn-secondary audit-small-button"
                          onClick={() => {
                            if (editandoTransportadora === item.transportadora) { setEditandoTransportadora(null); return; }
                            setEditandoTransportadora(item.transportadora);
                            const atual = auditores.find((u) => u.nome === item.auditor_nome);
                            setAuditorId(atual ? atual.id : '');
                          }}
                        >
                          {item.auditor_nome ? 'Alterar auditor' : 'Atribuir auditor'}
                        </button>
                        <button
                          className="btn-secondary audit-small-button"
                          onClick={() => {
                            if (historicoAberto === item.transportadora) { setHistoricoAberto(null); return; }
                            abrirHistorico(item.transportadora);
                          }}
                        >
                          Histórico
                        </button>
                      </td>
                    </tr>
                    {editandoTransportadora === item.transportadora && (
                      <tr>
                        <td colSpan={13} style={{ background: 'var(--panel-soft, #f8faff)' }}>
                          <div className="sim-actions" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '8px 4px' }}>
                            <strong>Atribuir {item.transportadora}:</strong>
                            <select value={auditorId} onChange={(e) => setAuditorId(e.target.value)} disabled={carregandoAuditores}>
                              <option value="">{carregandoAuditores ? 'Carregando...' : 'Selecione um auditor'}</option>
                              {auditores.map((u) => (
                                <option key={u.id} value={u.id}>{u.nome}{porAuditor.get(u.nome) ? ` — ${porAuditor.get(u.nome).faturas} fatura(s), ${porAuditor.get(u.nome).ctes} CT-e(s)` : ''}</option>
                              ))}
                            </select>
                            <button className="btn-primary audit-small-button" onClick={atribuir} disabled={!auditorId}>Salvar</button>
                            <button className="btn-secondary audit-small-button" onClick={() => setEditandoTransportadora(null)}>Cancelar</button>
                            {erroAuditores && <small className="error-text">{erroAuditores}</small>}
                            {!carregandoAuditores && !auditores.length && !erroAuditores && (
                              <small className="error-text">Nenhum usuário com perfil "Auditoria de Fretes" cadastrado.</small>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    {historicoAberto === item.transportadora && (
                      <tr>
                        <td colSpan={13} style={{ background: 'var(--panel-soft, #f8faff)' }}>
                          <div style={{ padding: '8px 4px' }}>
                            <strong>Histórico de auditores — {item.transportadora}</strong>
                            {carregandoHistorico && <div>Carregando...</div>}
                            {erroHistorico && <div className="error-text">{erroHistorico}</div>}
                            {!carregandoHistorico && !erroHistorico && (
                              historicoItens.length ? (
                                <table className="sim-analise-tabela" style={{ marginTop: 8 }}>
                                  <thead><tr><th>Auditor</th><th>Atribuído em</th><th>Atribuído por</th></tr></thead>
                                  <tbody>
                                    {historicoItens.map((h) => (
                                      <tr key={h.id}>
                                        <td>{h.auditor_nome || '-'}</td>
                                        <td>{dataBr(h.atribuido_em)}</td>
                                        <td>{h.atribuido_por || '-'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : <div style={{ padding: '8px 0' }}>Nenhuma troca de auditor registrada ainda para essa transportadora.</div>
                            )}
                            <div className="audit-form-actions" style={{ marginTop: 10 }}>
                              <button className="btn-secondary audit-small-button" onClick={() => setHistoricoAberto(null)}>Fechar</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="table-card">
          <div className="panel-title audit-table-title">Carteira por auditor</div>
          {!auditores.length && (
            <div style={{ padding: '12px 4px' }}>
              {carregandoAuditores ? 'Carregando auditores...' : (erroAuditores || 'Nenhum usuário com perfil "Auditoria de Fretes" cadastrado.')}
            </div>
          )}
          {(filtroAuditor && filtroAuditor !== 'SEM_AUDITOR' ? auditores.filter((u) => u.nome === filtroAuditor) : auditores).map((u) => {
            const transportadorasDoAuditor = carteirasFiltradas.filter((item) => item.auditor_nome === u.nome);
            const disponiveis = carteiras.filter((item) => item.auditor_nome !== u.nome);
            return (
              <div key={u.id} style={{ borderTop: '1px solid var(--border, #e2e8f0)', padding: '14px 4px' }}>
                <div className="sim-actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>{u.nome}</strong>
                  <button className="btn-secondary audit-small-button" onClick={() => { setAdicionandoParaAuditor(u.id); setTransportadoraParaAdicionar(''); }}>+ Adicionar transportadora</button>
                </div>
                {transportadorasDoAuditor.length ? (
                  <table className="sim-analise-tabela" style={{ marginTop: 8 }}>
                    <thead><tr><th>Transportadora</th><th>Faturas</th><th>CT-es</th><th>Valor em aberto</th><th>Vencidas</th><th>Pagas</th><th>Canceladas</th></tr></thead>
                    <tbody>
                      {transportadorasDoAuditor.map((item) => (
                        <tr key={item.transportadora}>
                          <td>{item.transportadora}</td><td>{item.quantidade}</td><td>{item.ctes}</td><td>{dinheiro(item.valor)}</td><td>{item.vencidas}</td><td>{item.pagas}</td><td>{item.canceladas}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ padding: '8px 0', color: 'var(--muted, #5f7197)' }}>Nenhuma transportadora atribuída ainda.</div>
                )}
                {adicionandoParaAuditor === u.id && (
                  <div className="form-grid three" style={{ marginTop: 10 }}>
                    <label className="field">
                      Transportadora
                      <select value={transportadoraParaAdicionar} onChange={(e) => setTransportadoraParaAdicionar(e.target.value)}>
                        <option value="">Selecione uma transportadora</option>
                        {disponiveis.map((item) => (
                          <option key={item.transportadora} value={item.transportadora}>{item.transportadora}{item.auditor_nome ? ` (atual: ${item.auditor_nome})` : ''}</option>
                        ))}
                      </select>
                    </label>
                    <div className="audit-form-actions">
                      <button className="btn-secondary" onClick={() => setAdicionandoParaAuditor(null)}>Cancelar</button>
                      <button className="btn-primary" onClick={() => adicionarTransportadoraAoAuditor(u)} disabled={!transportadoraParaAdicionar}>Adicionar</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {confirmacaoTransferencia && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 100001, display: 'grid', placeItems: 'center', padding: 20 }}
          onClick={() => !salvandoAtribuicao && setConfirmacaoTransferencia(null)}
        >
          <div className="sim-card" style={{ width: 'min(520px, 100%)' }} onClick={(event) => event.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Faturas pendentes com outro auditor</h3>
            <p style={{ color: '#475569' }}>
              {confirmacaoTransferencia.tipo === 'unica'
                ? `A transportadora ${confirmacaoTransferencia.carteira.transportadora} tem ${confirmacaoTransferencia.pendencias} fatura(s) aberta(s) (vencida ou a vencer) ainda com outro auditor. Faturas já pagas/canceladas nunca mudam de auditor.`
                : `As transportadoras selecionadas têm, no total, ${confirmacaoTransferencia.pendencias} fatura(s) aberta(s) (vencida ou a vencer) ainda com outro auditor. Faturas já pagas/canceladas nunca mudam de auditor.`}
            </p>
            <p style={{ color: '#475569' }}>O que fazer com essas faturas pendentes?</p>
            <div className="audit-form-actions" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <button
                className="btn-primary"
                disabled={salvandoAtribuicao}
                onClick={() => (confirmacaoTransferencia.tipo === 'unica'
                  ? executarAtribuicaoUnica(confirmacaoTransferencia.carteira, confirmacaoTransferencia.usuario, true)
                  : executarAtribuicaoMassa(confirmacaoTransferencia.listaCarteiras, confirmacaoTransferencia.usuario, true))}
              >
                Transferir para {confirmacaoTransferencia.usuario.nome}
              </button>
              <button
                className="btn-secondary"
                disabled={salvandoAtribuicao}
                onClick={() => (confirmacaoTransferencia.tipo === 'unica'
                  ? executarAtribuicaoUnica(confirmacaoTransferencia.carteira, confirmacaoTransferencia.usuario, false)
                  : executarAtribuicaoMassa(confirmacaoTransferencia.listaCarteiras, confirmacaoTransferencia.usuario, false))}
              >
                Manter com quem já está tratando (só as novas vão para {confirmacaoTransferencia.usuario.nome})
              </button>
              <button className="btn-secondary" disabled={salvandoAtribuicao} onClick={() => setConfirmacaoTransferencia(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Financeiro({ state, onState }) {
  const sessao = carregarSessao();
  const pagamentoRef = useRef(null);
  const pagamentoPastaRef = useRef(null);
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
  const [processandoPagamentos, setProcessandoPagamentos] = useState(false);
  const [progressoPagamentos, setProgressoPagamentos] = useState(null);
  const [resumoPagamentosSap, setResumoPagamentosSap] = useState(null);
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

  // Processa um unico arquivo (SAP ou layout simples) contra o estado atual e
  // devolve o proximo estado + resumo parcial, sem mexer em state React -
  // permite encadear varios arquivos de uma pasta em sequencia.
  const processarArquivoPagamentos = async (file, stateAtual) => {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
    const headers = rows.length ? Object.keys(rows[0]) : [];

    if (pareceRelatorioPagamentosSap(headers)) {
      // Relatorio SAP: cobre a empresa inteira (dezenas de milhares de
      // linhas), so persistimos e mudamos status das faturas que casaram.
      const conciliados = conciliarPagamentosSap(stateAtual.faturas, rows);
      const matched = conciliados.filter((item) => item.fatura_id);
      const compensados = matched.filter((item) => item.resultado === 'PAGO' || item.resultado === 'DIVERGENTE');
      const partidas = matched.filter((item) => item.resultado === 'PARTIDA_LANCADA');
      const lancadasFinanceiro = matched.filter((item) => item.resultado === 'LANCADA_FINANCEIRO');
      const cnpjDivergente = conciliados.filter((item) => item.resultado === 'CNPJ_DIVERGENTE').length;
      const ambiguos = conciliados.filter((item) => item.resultado === 'AMBIGUO').length;
      const naoLocalizados = conciliados.length - matched.length - cnpjDivergente - ambiguos;

      const salvos = await salvarPagamentosFinanceirosEmLote(matched, (progresso) => setProgressoPagamentos({ etapa: `salvando_pagamentos (${file.name})`, ...progresso }));
      let next = await atualizarStatusFaturasPagasEmLote(
        { ...stateAtual, pagamentos: [...salvos.slice(0, 500), ...stateAtual.pagamentos] },
        compensados,
        sessao?.nome || sessao?.email || 'Usuario local',
        (progresso) => setProgressoPagamentos({ etapa: `atualizando_faturas (${file.name})`, ...progresso }),
      );
      // Partida lancada sem compensacao ainda (statusComp=2) tambem precisa
      // aparecer marcada na fatura - senao fica invisivel fora da tabela de
      // pagamentos, mesmo ja tendo um lancamento contabil aberto no financeiro.
      next = await marcarFaturasLancadasFinanceiroEmLote(
        next,
        [...partidas, ...lancadasFinanceiro],
        (progresso) => setProgressoPagamentos({ etapa: `marcando_lancadas_financeiro (${file.name})`, ...progresso }),
      );
      return {
        next,
        resumo: {
          totalLinhas: conciliados.length, pagas: compensados.length, partidasLancadas: partidas.length,
          lancadasFinanceiro: lancadasFinanceiro.length, naoLocalizados, ambiguos, cnpjDivergente,
        },
      };
    }

    const normalizados = rows.map((row) => ({
      numero_fatura: String(row['Numero Fatura'] || row['Fatura'] || row['numero_fatura'] || ''),
      transportadora: String(row['Transportadora'] || row['transportadora'] || ''),
      valor_pago: Number(row['Valor Pago'] || row['Valor'] || row['valor_pago'] || 0),
      data_pagamento: row['Data Pagamento'] || row['data_pagamento'] || new Date().toISOString().slice(0, 10),
      documento_compensacao: String(row['Documento Compensacao'] || row['Documento'] || ''),
      arquivo_origem: file.name,
    }));
    const conciliados = conciliarPagamentos(stateAtual.faturas, normalizados);
    // transportadora orienta a conciliacao, mas nao é coluna de financeiro_pagamentos.
    const registros = conciliados.map(({ transportadora, ...pagamento }) => pagamento);
    let next = await salvarPagamentosFinanceiros(stateAtual, registros);
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
    const compensados = registros.filter((item) => item.fatura_id && item.resultado === 'PAGO');
    const divergentes = registros.filter((item) => item.fatura_id && item.resultado === 'DIVERGENTE');
    const ambiguos = registros.filter((item) => item.resultado === 'AMBIGUO').length;
    const naoLocalizados = registros.filter((item) => item.resultado === 'NAO_LOCALIZADO').length;
    return {
      next,
      resumo: { totalLinhas: registros.length, pagas: compensados.length + divergentes.length, partidasLancadas: 0, lancadasFinanceiro: 0, naoLocalizados, ambiguos, cnpjDivergente: 0 },
    };
  };

  const somarResumos = (a, b) => ({
    totalLinhas: (a?.totalLinhas || 0) + b.totalLinhas,
    pagas: (a?.pagas || 0) + b.pagas,
    partidasLancadas: (a?.partidasLancadas || 0) + b.partidasLancadas,
    lancadasFinanceiro: (a?.lancadasFinanceiro || 0) + (b.lancadasFinanceiro || 0),
    naoLocalizados: (a?.naoLocalizados || 0) + b.naoLocalizados,
    ambiguos: (a?.ambiguos || 0) + b.ambiguos,
    cnpjDivergente: (a?.cnpjDivergente || 0) + b.cnpjDivergente,
  });

  const importarPagamentos = async (event) => {
    const arquivos = Array.from(event.target.files || []).filter((file) => /\.(xlsx|xls|csv)$/i.test(file.name));
    event.target.value = '';
    if (!arquivos.length) return;
    setErroFinanceiro('');
    setResumoPagamentosSap(null);
    setProcessandoPagamentos(true);
    setProgressoPagamentos(null);
    try {
      let estadoAtual = state;
      let resumoTotal = null;
      const falhas = [];
      for (let indice = 0; indice < arquivos.length; indice += 1) {
        const file = arquivos[indice];
        setProgressoPagamentos({ etapa: `arquivo ${indice + 1}/${arquivos.length}: ${file.name}` });
        try {
          const { next, resumo } = await processarArquivoPagamentos(file, estadoAtual);
          estadoAtual = next;
          resumoTotal = somarResumos(resumoTotal, resumo);
          onState(estadoAtual);
        } catch (error) {
          falhas.push(`${file.name}: ${error.message || error}`);
        }
      }
      setResumoPagamentosSap(resumoTotal ? { ...resumoTotal, arquivos: arquivos.length } : null);
      setErroFinanceiro(falhas.length ? `Falha ao processar ${falhas.length} arquivo(s): ${falhas.join(' | ')}` : '');
    } catch (error) {
      setErroFinanceiro(error.message || String(error));
    } finally {
      setProcessandoPagamentos(false);
      setProgressoPagamentos(null);
    }
  };

  return (
    <>
      <div className="tabs-row">
        {[
          ['protocolos', 'Protocolos'], ['solicitacoes', 'Solicitacoes e SLA'], ['boletos', 'Boletos'], ['pagamentos', 'Pagamentos'], ['dados-bancarios', 'Dados Bancarios'],
        ].map(([id, label]) => <button key={id} className={`toggle-btn ${subtab === id ? 'active' : ''}`} onClick={() => setSubtab(id)}>{label}</button>)}
      </div>
      {erroFinanceiro && <div className="hint-box compact error-text">{erroFinanceiro}</div>}
      {subtab === 'dados-bancarios' && <DadosBancariosTransportadoras sessao={sessao} />}

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
            <div className="section-row compact-top">
              <div>
                <div className="panel-title">Comprovantes de pagamento</div>
                <p>Layout simples: Numero Fatura, Valor Pago, Data Pagamento, Documento Compensacao.</p>
                <p>Ou exportacao SAP (contas a pagar): reconhece automaticamente as colunas Referência, Nome do fornecedor, Montante (ME), Status comp., Lançto.compensação e Lançamento contábil. So gravamos e atualizamos as faturas que casaram com o relatorio - o restante (outros fornecedores da empresa) e ignorado.</p>
              </div>
              <div className="audit-form-actions">
                <button className="btn-primary" disabled={processandoPagamentos} onClick={() => pagamentoRef.current?.click()}>{processandoPagamentos ? 'Processando...' : 'Importar arquivo(s)'}</button>
                <button className="btn-secondary" disabled={processandoPagamentos} onClick={() => pagamentoPastaRef.current?.click()}>{processandoPagamentos ? 'Processando...' : 'Importar pasta'}</button>
              </div>
            </div>
            <input ref={pagamentoRef} type="file" accept=".xlsx,.xls,.csv" multiple hidden onChange={importarPagamentos} />
            <input ref={pagamentoPastaRef} type="file" webkitdirectory="" directory="" multiple hidden onChange={importarPagamentos} />
            {processandoPagamentos && (
              <div className="hint-box compact">
                Processando{progressoPagamentos?.etapa ? `: ${progressoPagamentos.etapa}` : '...'}
                {progressoPagamentos?.total ? ` (${progressoPagamentos.carregados}/${progressoPagamentos.total})` : ''}
              </div>
            )}
            {resumoPagamentosSap && (
              <div className="hint-box compact">
                {resumoPagamentosSap.arquivos > 1 ? `${resumoPagamentosSap.arquivos} arquivo(s) processado(s)` : 'Relatorio processado'}: {resumoPagamentosSap.totalLinhas} linha(s) · <strong>{resumoPagamentosSap.pagas}</strong> fatura(s) marcada(s) como paga(s) ·{' '}
                <strong>{resumoPagamentosSap.lancadasFinanceiro || 0}</strong> ja lancada(s) no financeiro (aguardando pagamento final) ·{' '}
                <strong>{resumoPagamentosSap.partidasLancadas}</strong> com partida lancada aguardando compensacao · {resumoPagamentosSap.naoLocalizados} sem fatura correspondente
                {resumoPagamentosSap.cnpjDivergente ? ` · ${resumoPagamentosSap.cnpjDivergente} com numero de fatura batendo mas CNPJ da transportadora divergente (nao casado por seguranca)` : ''}
                {resumoPagamentosSap.ambiguos ? ` · ${resumoPagamentosSap.ambiguos} ambiguo(s) (numero de fatura repetido para o mesmo CNPJ)` : ''}.
              </div>
            )}
          </div>
          <SimpleTable
            headers={['Fatura', 'Transportadora', 'Vencimento', 'Valor pago', 'Data', 'Partida (compensação)', 'Lançamento contábil', 'Resultado', 'Diferenca']}
            rows={state.pagamentos.map((item) => {
              const fat = state.faturas.find((fatura) => fatura.id === item.fatura_id);
              return [
                item.numero_fatura || '-',
                item.transportadora || fat?.transportadora || '-',
                fat?.data_vencimento ? dataBr(fat.data_vencimento) : '-',
                dinheiro(item.valor_pago), dataBr(item.data_pagamento),
                item.partida || item.documento_compensacao || '-',
                item.lancamento_contabil || '-',
                <Status key="r" value={item.resultado} />, dinheiro(item.diferenca),
              ];
            })}
            empty="Nenhum relatorio financeiro importado."
          />
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

export default function CentralAuditoriaFretesPage({ initialTab = 'dashboard', embedded = false, onMudarPagina, onAbrirTransportadoras }) {
  const [tab, setTab] = useState(initialTab);
  const [state, setState] = useState(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    carregarPlataformaAuditoria().then(setState).catch((error) => setErro(error.message));
  }, []);

  useEffect(() => setTab(initialTab), [initialTab]);

  // protocolos/solicitacaoHistorico/pagamentos so a aba Financeiro usa — busca
  // sob demanda na primeira vez que ela abre, em vez de atrasar a tela inicial.
  const [financeiroExtrasCarregados, setFinanceiroExtrasCarregados] = useState(false);
  useEffect(() => {
    if (tab !== 'financeiro' || financeiroExtrasCarregados || !state || state.modo !== 'SUPABASE') return;
    setFinanceiroExtrasCarregados(true);
    carregarPlataformaAuditoriaFinanceiro()
      .then((extras) => setState((prev) => (prev ? { ...prev, ...extras } : prev)))
      .catch((error) => setErro(error.message));
  }, [tab, financeiroExtrasCarregados, state]);

  const restaurar = () => setState({ ...restaurarDemonstracaoAuditoria(), modo: 'DEMONSTRACAO_LOCAL' });

  if (!state) return <div className="panel-card">{erro ? `Erro: ${erro}` : 'Carregando Plataforma de Auditoria de Fretes...'}</div>;

  if (embedded) {
    return <Faturas state={state} onState={setState} modo={initialTab === 'auditoria-cte' ? 'auditoria-cte' : 'faturas'} onMudarPagina={onMudarPagina} onAbrirTransportadoras={onAbrirTransportadoras} />;
  }

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
      {tab === 'faturas' && <Faturas state={state} onState={setState} modo="faturas" onMudarPagina={onMudarPagina} onAbrirTransportadoras={onAbrirTransportadoras} />}
      {tab === 'auditoria-cte' && <Faturas state={state} onState={setState} modo="auditoria-cte" onMudarPagina={onMudarPagina} onAbrirTransportadoras={onAbrirTransportadoras} />}
      {tab === 'gestao' && <Gestao state={state} onState={setState} />}
      {tab === 'financeiro' && <Financeiro state={state} onState={setState} />}
    </div>
  );
}

