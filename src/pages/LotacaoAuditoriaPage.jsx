import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buscarCargaPorDistOuCte,
  carregarFluxoCargasLotacao,
  carregarFluxoCargasLotacaoCompleto,
  carregarLancamentosAuditoria,
  carregarSolicitacoesPagamento,
  criarLancamentoAuditoria,
  criarSolicitacaoPagamento,
  cteJaLancado,
  formatarDataCurta,
  formatarMoeda,
  normalizarTexto,
  salvarLancamentosAuditoria,
  salvarSolicitacoesPagamento,
  separarCtes,
} from '../utils/lotacaoFluxoCargas';
import {
  buscarCteLotacaoAuditoriaPorChaveSupabase,
  buscarCtesLotacaoAuditoriaPorChavesSupabase,
  buscarCtesLotacaoAuditoriaPorNumeroSupabase,
  carregarCargasLotacaoSupabase,
  carregarLancamentosAuditoriaSupabase,
  carregarPendenciasAuditoriaSupabase,
  carregarSolicitacoesSupabase,
  carregarTabelasLotacaoSupabase,
  registrarEventoHistoricoSupabase,
  salvarLancamentoAuditoriaSupabase,
  salvarPendenciaAuditoriaSupabase,
  salvarSolicitacaoSupabase,
} from '../services/lotacaoSupabaseService';
import {
  carregarTabelasLotacao,
  pesquisarRotaLotacao,
} from '../utils/lotacaoTables';
import {
  carregarVinculosTransportadoras,
  salvarVinculosTransportadoras,
  removerVinculoTransportadora,
} from '../services/vinculosTransportadorasService';
import { carregarSessao } from '../utils/authLocal';

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ 4.34A — Auditoria Lotação como central única de auditoria operacional      ║
// ║                                                                            ║
// ║ Toda a lógica nova (consolidação DIST/HUB, saldo por viagem consolidada e  ║
// ║ vínculos de transportadora) vive NESTE arquivo, para não tocar no motor de ║
// ║ cálculo, services, simulador, tabelas de negociação ou laudos.             ║
// ╚══════════════════════════════════════════════════════════════════════════╝

const TOLERANCIA_SALDO = 1.0; // R$ — saldo <= isso (em módulo) => viagem fechada
const VINCULOS_STORAGE_KEY = 'central_fretes_lotacao_vinculos_transportadora_v1';

function classeSaldo(valor) {
  if (valor < -0.01) return 'negativo';
  if (valor > 0.01) return 'positivo';
  return '';
}

function pendenciaParaMovimentoAutorizacao(pendencia = {}) {
  return {
    id: pendencia.id,
    tipo: 'EXCEDENTE_AUDITORIA',
    origemSolicitacao: 'AUDITORIA',
    cargaId: pendencia.carga_id || '',
    dist: pendencia.dist || '',
    distKey: pendencia.dist_key || '',
    cte: pendencia.cte || '',
    fatura: pendencia.fatura || '',
    transportadora: pendencia.transportadora || '',
    valorAutorizadoCarga: pendencia.valor_original ?? pendencia.valor_autorizado,
    valorLancado: pendencia.valor_lancado,
    excedente: pendencia.valor_excedente,
    valorAdicional: pendencia.valor_adicional_aprovado ?? pendencia.valor_excedente,
    valorAdicionalAprovado: pendencia.valor_adicional_aprovado,
    valorFinalAutorizado: pendencia.valor_final_autorizado,
    status: pendencia.status || '',
    observacao: pendencia.observation || '',
    resposta: pendencia.resposta_operacao || pendencia.motivo_recusa || '',
    criadoEm: pendencia.created_at || '',
    atualizadoEm: pendencia.updated_at || '',
  };
}

function adicionarHorasIso(dataBase, horas) {
  const base = dataBase ? new Date(dataBase) : new Date();
  if (Number.isNaN(base.getTime())) return new Date().toISOString();
  return new Date(base.getTime() + (Number(horas || 0) * 3600000)).toISOString();
}

function cteParaFiltrosRota(cte = {}) {
  return {
    origem: cte.cidade_origem || '',
    destino: cte.cidade_destino || '',
    transportadora: cte.transportadora || cte.transportadora_contratada || '',
    tipo: '',
  };
}


// ─── VALOR DE REFERÊNCIA DA AUDITORIA (4.34A.3) ─────────────────────────────
// A lotação pode trazer Valor da viagem, Frete Cantu e Frete Transportadora.
// Como alguns fretes vêm com ICMS e outros sem ICMS, a auditoria deve usar o
// valor disponível que estiver MAIS PRÓXIMO do valor do CT-e encontrado.
function numeroAuditoria(valor) {
  if (valor === null || valor === undefined || valor === '') return 0;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  const texto = String(valor)
    .replace(/R\$/gi, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^0-9.-]/g, '');
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : 0;
}

function analisarChavesCteLote(texto = '') {
  const tokens = String(texto || '')
    .split(/[\s,;]+/g)
    .map((item) => item.replace(/\D/g, ''))
    .filter(Boolean);
  const vistas = new Set();
  const validas = [];
  const duplicadas = [];
  const invalidas = [];

  tokens.forEach((token) => {
    if (token.length !== 44) {
      invalidas.push(token);
      return;
    }
    if (vistas.has(token)) {
      duplicadas.push(token);
      return;
    }
    vistas.add(token);
    validas.push(token);
  });

  return {
    lidas: tokens.length,
    validas,
    invalidas,
    duplicadas,
  };
}

function identificadoresCteAuditoria(cte = {}, chaveFallback = '') {
  const registro = cte || {};
  return [
    registro.chave_cte,
    registro.numero_cte,
    registro.cte,
    chaveFallback,
  ].map((item) => normalizarTexto(item || '')).filter(Boolean);
}

function cteJaLancadoEmOutraViagem(lancamentos = [], viagem, identificadores = []) {
  const ids = new Set((identificadores || []).map((item) => normalizarTexto(item)).filter(Boolean));
  if (!ids.size) return false;
  const chaveViagemAtual = viagem ? (viagem.chaveViagem || consolidarChaveViagem(viagem.dist)) : '';

  return (lancamentos || []).some((item) => {
    const chaveLancamento = consolidarChaveViagem(item.dist || item.distKey || '');
    if (chaveViagemAtual && chaveLancamento === chaveViagemAtual) return false;
    return ids.has(normalizarTexto(item.cte || item.cteKey || ''));
  });
}

function adicionarCandidatoValor(lista, fonte, valor, detalhe = '') {
  const numero = numeroAuditoria(valor);
  if (!numero || numero <= 0) return;
  const chave = `${fonte}|${numero.toFixed(2)}|${detalhe}`;
  if (lista.some((item) => item.chave === chave)) return;
  lista.push({ chave, fonte, valor: Number(numero.toFixed(2)), detalhe });
}

function candidatosValorAuditoria(viagem = {}) {
  const candidatos = [];
  adicionarCandidatoValor(candidatos, 'Valor informado da viagem', viagem.valorComparacao);
  adicionarCandidatoValor(candidatos, 'Frete Cantu', viagem.freteCantu);
  adicionarCandidatoValor(candidatos, 'Frete Transportadora', viagem.freteTransp);

  for (const [idx, reg] of (viagem.registrosOriginais || []).entries()) {
    const detalhe = reg.dist ? `registro ${reg.dist}` : `registro ${idx + 1}`;
    adicionarCandidatoValor(candidatos, 'Valor informado da viagem', reg.valorComparacao, detalhe);
    adicionarCandidatoValor(candidatos, 'Frete Cantu', reg.freteCantu, detalhe);
    adicionarCandidatoValor(candidatos, 'Frete Transportadora', reg.freteTransp, detalhe);
  }

  // Remove duplicidades por valor+fonte, mantendo a primeira ocorrência para a tela ficar limpa.
  const vistos = new Set();
  return candidatos.filter((item) => {
    const chave = `${item.fonte}|${item.valor.toFixed(2)}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

function calcularReferenciaAuditoria(viagem = {}, cte = {}) {
  const candidatos = candidatosValorAuditoria(viagem);
  const fallback = numeroAuditoria(viagem.valorComparacao) || candidatos[0]?.valor || 0;
  const valorCte = numeroAuditoria(cte?.valor_cte ?? cte?.valorCte ?? cte?.valor_total);

  if (!valorCte || !candidatos.length) {
    return {
      valorReferencia: Number(fallback.toFixed(2)),
      fonte: candidatos[0]?.fonte || 'Valor informado da viagem',
      detalhe: candidatos[0]?.detalhe || 'sem CT-e selecionado para comparação',
      valorCte: 0,
      diferenca: 0,
      candidatos,
      criterio: 'Sem valor CT-e selecionado; usando a regra base da viagem.',
    };
  }

  const ordenados = candidatos
    .map((item) => ({
      ...item,
      diferenca: Number(Math.abs(item.valor - valorCte).toFixed(2)),
      acimaOuIgualCte: item.valor >= valorCte,
    }))
    .sort((a, b) => {
      if (a.diferenca !== b.diferenca) return a.diferenca - b.diferenca;
      // Em empate, preferimos o valor acima do CT-e para não liberar saldo menor por arredondamento/ICMS.
      if (a.acimaOuIgualCte !== b.acimaOuIgualCte) return a.acimaOuIgualCte ? -1 : 1;
      return b.valor - a.valor;
    });

  const escolhido = ordenados[0];
  return {
    valorReferencia: escolhido.valor,
    fonte: escolhido.fonte,
    detalhe: escolhido.detalhe || '',
    valorCte,
    diferenca: escolhido.diferenca,
    candidatos: ordenados,
    criterio: `${escolhido.fonte} escolhido por ser o valor mais próximo do CT-e.`,
  };
}

function aplicarReferenciaAuditoria(viagem, cte) {
  if (!viagem) return null;
  const referencia = calcularReferenciaAuditoria(viagem, cte);
  return {
    ...viagem,
    valorComparacaoOriginal: viagem.valorComparacao,
    valorComparacao: referencia.valorReferencia || viagem.valorComparacao || 0,
    valorReferenciaAuditoria: referencia,
  };
}

// ─── CONSOLIDAÇÃO DE DIST / HUB ───────────────────────────────────────────────
// Remove sufixos de parte/ocorrência (" 1", "-2", "/3") tratando-os como
// pedaços da MESMA viagem, não como viagens independentes.
//   DIST-12651 1 => DIST-12651   |  12651-2 => 12651  |  HUB-12651 2 => HUB-12651
function distExibicao(distRaw = '') {
  const bruto = String(distRaw || '').trim();
  if (!bruto) return '';
  const base = bruto.replace(/[\s\-_/]+\d{1,2}\s*$/, '').trim();
  return base || bruto;
}

function consolidarChaveViagem(distRaw = '') {
  const base = distExibicao(distRaw);
  return normalizarTexto(base || distRaw);
}

// Recarrega lançamentos re-chaveados pela viagem consolidada, para que os
// utilitários de saldo (que filtram por distKey) enxerguem lançamentos antigos
// gravados com sufixo (ex.: "DIST-12651 1") junto com os novos consolidados.
function reKeyLancamentosPorViagem(lancamentos = []) {
  return (lancamentos || []).map((item) => ({
    ...item,
    distKey: consolidarChaveViagem(item.dist || item.distKey || ''),
  }));
}

function lancamentosDaViagem(lancamentos = [], chaveViagem = '') {
  if (!chaveViagem) return [];
  return (lancamentos || []).filter(
    (item) => consolidarChaveViagem(item.dist || item.distKey || '') === chaveViagem,
  );
}

// Agrupa cargas que pertencem à mesma viagem em um único objeto "viagem
// consolidada" que se comporta como uma carga para os utilitários existentes.
function consolidarViagens(cargas = []) {
  const mapa = new Map();
  for (const carga of cargas || []) {
    const chave = consolidarChaveViagem(carga.dist) || normalizarTexto(carga.dist || '');
    if (!chave) continue;
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push(carga);
  }

  const viagens = [];
  for (const [chave, registros] of mapa.entries()) {
    const base = registros[0] || {};
    const distLabel = distExibicao(base.dist) || base.dist || chave;

    // Valor total da viagem: as linhas duplicadas trazem o MESMO total.
    // Usamos o maior valor informado como total da viagem (= valor único
    // quando todas as linhas coincidem). Nunca somamos as duplicatas.
    const valoresInformados = [
      ...new Set(
        registros
          .map((r) => Number(r.valorComparacao) || 0)
          .filter((v) => v > 0)
          .map((v) => Number(v.toFixed(2))),
      ),
    ].sort((a, b) => b - a);
    const valorTotalViagem = valoresInformados[0] || 0;

    const ctesConsolidados = [
      ...new Set(
        registros.flatMap((r) => (r.ctes?.length ? r.ctes : separarCtes(r.cteRaw || ''))),
      ),
    ].filter(Boolean);

    viagens.push({
      // herda campos de exibição/rota do primeiro registro
      ...base,
      id: `viagem:${chave}`,
      chaveViagem: chave,
      dist: distLabel,         // chaveDist(dist) => chave consolidada
      distKey: chave,
      valorComparacao: valorTotalViagem,
      valoresInformados,
      ctes: ctesConsolidados,
      cteRaw: registros.map((r) => r.cteRaw).filter(Boolean).join('; '),
      registrosOriginais: registros,
      qtdRegistros: registros.length,
    });
  }

  return viagens;
}

// Resumo de saldo de uma viagem consolidada (regra 4.34A).
function resumoViagem(viagem, lancamentos = []) {
  if (!viagem) return null;
  const valorTotal = Number(viagem.valorComparacao) || 0;
  const lancs = lancamentosDaViagem(lancamentos, viagem.chaveViagem || consolidarChaveViagem(viagem.dist));
  const valorAuditado = lancs.reduce((acc, l) => acc + (Number(l.valorLancado) || 0), 0);
  const saldoPendente = Number((valorTotal - valorAuditado).toFixed(2));
  const ctesVinculados = lancs.map((l) => l.cte).filter(Boolean);

  let status = 'PENDENTE';
  if (valorAuditado > 0.009) {
    status = Math.abs(saldoPendente) <= TOLERANCIA_SALDO ? 'AUDITADA' : 'PARCIAL';
  }

  return { valorTotal, valorAuditado, saldoPendente, ctesVinculados, lancamentos: lancs, status };
}

// ─── SUGESTÕES DE CASAMENTO COM O REALIZADO ───────────────────────────────────
function scoreSugestaoHistorico(carga = {}, cte = {}, vinculos = []) {
  const origem = normalizarTexto(cte.cidade_origem || '');
  const destino = normalizarTexto(cte.cidade_destino || '');
  const ufDestino = normalizarTexto(cte.uf_destino || '');
  const transp = normalizarTexto(cte.transportadora || cte.transportadora_contratada || '');
  const transpCteCanonica = normalizarTexto(nomeCanonicoTransportadora(cte.transportadora || cte.transportadora_contratada || '', vinculos));
  const transpCargaCanonica = normalizarTexto(nomeCanonicoTransportadora(carga.transportadora || '', vinculos));
  const cteNumero = normalizarTexto(cte.numero_cte || '');
  let score = 0;
  const motivos = [];

  if (cteNumero && normalizarTexto(carga.cteRaw || '').includes(cteNumero)) {
    score += 45;
    motivos.push('CT-e encontrado na viagem');
  }
  if (origem && normalizarTexto(carga.origem).includes(origem)) {
    score += 18;
    motivos.push('mesma origem');
  }
  if (destino && normalizarTexto(carga.destino).includes(destino)) {
    score += 16;
    motivos.push('mesmo destino');
  } else if (ufDestino && normalizarTexto(carga.ufDestino || '') === ufDestino) {
    score += 8;
    motivos.push('mesma UF destino');
  }
  if (
    transp
    && (
      normalizarTexto(carga.transportadora).includes(transp)
      || (transpCteCanonica && transpCargaCanonica && transpCteCanonica === transpCargaCanonica)
    )
  ) {
    score += 14;
    motivos.push(transpCteCanonica === transpCargaCanonica ? 'transportadora vinculada' : 'mesma transportadora');
  }
  const emissao = cte.emissao ? new Date(cte.emissao).getTime() : 0;
  const dataCarga = new Date(carga.coletaRealizada || carga.coletaPlanejada || carga.importadoEm || 0).getTime();
  if (emissao && dataCarga) {
    const dias = Math.abs(emissao - dataCarga) / 86400000;
    if (dias <= 7) { score += 10; motivos.push('data próxima'); }
    else if (dias <= 30) { score += 4; motivos.push('mesmo período aproximado'); }
  }
  const valorCte = numeroAuditoria(cte.valor_cte || 0);
  const referenciaValor = calcularReferenciaAuditoria(carga, cte);
  const valorCarga = referenciaValor.valorReferencia || numeroAuditoria(carga.valorComparacao || 0);
  if (valorCte && valorCarga) {
    const dif = Math.abs(valorCte - valorCarga) / Math.max(valorCte, valorCarga);
    if (dif <= 0.12) {
      score += 8;
      motivos.push(`valor próximo (${referenciaValor.fonte})`);
    }
  }
  return { score, motivos };
}

// Sugere VIAGENS CONSOLIDADAS (cada viagem aparece uma única vez).
function sugerirViagensPorCte(cargas = [], cte = {}, vinculos = []) {
  const viagens = consolidarViagens(cargas);
  return viagens
    .map((viagem) => {
      // melhor score entre os registros originais da viagem
      let melhor = { score: 0, motivos: [] };
      for (const reg of viagem.registrosOriginais || [viagem]) {
        const r = scoreSugestaoHistorico(reg, cte, vinculos);
        if (r.score > melhor.score) melhor = r;
      }
      return { viagem, ...melhor };
    })
    .filter((item) => item.score >= 18)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

// ─── VÍNCULOS DE TRANSPORTADORA ────────────────────────────────────────────────
// Usa a tabela central transportadora_vinculos via service e mantém fallback local.
function carregarVinculos() {
  try {
    const parsed = JSON.parse(localStorage.getItem(VINCULOS_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function salvarVinculos(vinculos = []) {
  try {
    localStorage.setItem(VINCULOS_STORAGE_KEY, JSON.stringify(vinculos));
  } catch (e) {
    console.warn('[Auditoria] Não foi possível salvar vínculos localmente:', e.message);
  }
}

function vinculoGlobalParaAuditoria(item = {}) {
  return {
    id: item.id || `${normalizarTexto(item.nomeCte || item.nome_cte)}__${normalizarTexto(item.nomeTabela || item.nome_tabela)}`,
    nomeRealizado: item.nomeTabela || item.nome_tabela || item.nomeRealizado || '',
    nomeCteTabela: item.nomeCte || item.nome_cte || item.nomeCteTabela || '',
    cnpj: item.cnpj || item.cnpj_transportadora || '',
    atualizadoEm: item.updatedAt || item.updated_at || item.atualizadoEm || '',
    origem: item.origem || 'manual',
  };
}

function vinculoAuditoriaParaGlobal(item = {}) {
  return {
    id: item.id,
    nomeCte: item.nomeCteTabela || item.nomeCte || item.nome_cte || '',
    nomeTabela: item.nomeRealizado || item.nomeTabela || item.nome_tabela || '',
    origem: item.origem || 'auditoria_lotacao',
  };
}

function nomeCanonicoTransportadora(nome, vinculos = []) {
  const alvo = normalizarTexto(nome || '');
  if (!alvo) return nome || '';
  const achado = (vinculos || []).find(
    (v) => normalizarTexto(v.nomeRealizado || v.nomeTabela || v.nome_tabela) === alvo
      || normalizarTexto(v.nomeCteTabela || v.nomeCte || v.nome_cte) === alvo
      || normalizarTexto(v.cnpj) === alvo,
  );
  return achado ? (achado.nomeRealizado || achado.nomeTabela || nome || '') : (nome || '');
}

// ════════════════════════════ COMPONENTES ════════════════════════════════════

function CardCteEncontrado({ cte, onUsar }) {
  if (!cte) return null;
  const tomador = cte.tomador || cte.raw?.tomador || cte.raw?.nomeTomador || '-';
  return (
    <div className="panel-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Dados oficiais do CT-e</div>
          <p>
            {cte.numero_cte || '-'} · {cte.transportadora || cte.transportadora_contratada || '-'} ·{' '}
            {cte.cidade_origem || '-'} x {cte.cidade_destino || '-'}/{cte.uf_destino || '-'}
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => onUsar(cte)}>Usar dados do CT-e</button>
      </div>
      <div className="sim-analise-resumo">
        <div><span>Chave CT-e</span><strong style={{ fontSize: '0.74rem' }}>{cte.chave_cte || '-'}</strong></div>
        <div><span>Número CT-e</span><strong>{cte.numero_cte || '-'}</strong></div>
        <div><span>Transportadora</span><strong>{cte.transportadora || cte.transportadora_contratada || '-'}</strong></div>
        <div><span>CNPJ transp.</span><strong>{cte.cnpj_transportadora || '-'}</strong></div>
        <div><span>Origem</span><strong>{cte.cidade_origem || '-'}/{cte.uf_origem || '-'}</strong></div>
        <div><span>Destino</span><strong>{cte.cidade_destino || '-'}/{cte.uf_destino || '-'}</strong></div>
        <div><span>Emissão</span><strong>{formatarDataCurta(cte.emissao)}</strong></div>
        <div><span>Canal/Operação</span><strong>{cte.canal || '-'}</strong></div>
        <div><span>Tomador</span><strong>{tomador}</strong></div>
        <div><span>Valor CT-e</span><strong>{formatarMoeda(cte.valor_cte)}</strong></div>
        <div><span>Valor NF</span><strong>{formatarMoeda(cte.valor_nf)}</strong></div>
        <div><span>Peso</span><strong>{Number(cte.peso_declarado || cte.peso_cubado || 0).toLocaleString('pt-BR')} kg</strong></div>
      </div>
    </div>
  );
}

function ValidacaoTabelaLotacao({ resultados }) {
  if (!resultados?.length) {
    return <div className="hint-box compact">Tabela de lotação não encontrada para esta rota/transportadora.</div>;
  }
  return (
    <div className="table-card lotacao-table-card">
      <div className="panel-title" style={{ padding: '0.75rem 1rem 0.25rem' }}>Tabela de lotação aplicável</div>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead><tr><th>Transportadora</th><th>Origem</th><th>Destino</th><th>Tipo</th><th>Valor tabela</th></tr></thead>
          <tbody>
            {resultados.slice(0, 5).map((item, idx) => (
              <tr key={`${item.tabelaId || item.id}-${idx}`}>
                <td><strong>{item.tabelaNome || item.transportadora || '-'}</strong></td>
                <td>{item.origem}/{item.ufOrigem || ''}</td>
                <td>{item.destino}/{item.ufDestino || ''}</td>
                <td>{item.tipo || '-'}</td>
                <td><strong>{formatarMoeda(item.valor)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SugestoesViagens({ sugestoes, onUsar }) {
  if (!sugestoes?.length) {
    return <div className="hint-box compact">Nenhuma viagem provável encontrada no realizado por aproximação.</div>;
  }
  return (
    <div className="table-card lotacao-table-card">
      <div className="panel-title" style={{ padding: '0.75rem 1rem 0.25rem' }}>Sugestões de casamento com o realizado</div>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead><tr><th>Viagem</th><th>Transportadora</th><th>Rota</th><th>Data</th><th>Total viagem</th><th>Confiança</th><th>Motivo</th><th>Ação</th></tr></thead>
          <tbody>
            {sugestoes.map(({ viagem, score, motivos }) => (
              <tr key={viagem.id}>
                <td><strong>{viagem.dist}</strong>{viagem.qtdRegistros > 1 ? ` · ${viagem.qtdRegistros} reg.` : ''}</td>
                <td>{viagem.transportadora}</td>
                <td>{viagem.origem} x {viagem.destino}</td>
                <td>{formatarDataCurta(viagem.coletaRealizada || viagem.coletaPlanejada)}</td>
                <td>{formatarMoeda(viagem.valorComparacao)}</td>
                <td>{score >= 70 ? 'Alta' : score >= 40 ? 'Média' : 'Baixa'}</td>
                <td>{motivos.join(', ') || '-'}</td>
                <td><button type="button" className="btn-secondary" onClick={() => onUsar(viagem)}>Usar esta viagem</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ListaViagens({ viagens, selecionada, onSelecionar }) {
  if (!viagens.length) return null;
  return (
    <div className="mini-list top-space-sm">
      {viagens.map((item) => (
        <button
          key={item.id}
          type="button"
          className={selecionada?.id === item.id ? 'mini-list-row clickable active' : 'mini-list-row clickable'}
          onClick={() => onSelecionar(item)}
        >
          <span>
            <strong>{item.dist}</strong>{item.qtdRegistros > 1 ? ` · ${item.qtdRegistros} registros` : ''} · {item.transportadora} · {item.origem} x {item.destino}
          </span>
          <strong>{formatarMoeda(item.valorComparacao)}</strong>
        </button>
      ))}
    </div>
  );
}

function ResumoViagemCard({ viagem, lancamentos, cte }) {
  if (!viagem) return null;
  const resumo = resumoViagem(viagem, lancamentos);
  const referencia = viagem.valorReferenciaAuditoria || calcularReferenciaAuditoria(viagem, cte);
  const ctes = viagem.ctes?.length ? viagem.ctes : separarCtes(viagem.cteRaw);
  const statusLabel = resumo.status === 'AUDITADA'
    ? 'Auditada / fechada'
    : resumo.status === 'PARCIAL'
    ? 'Parcialmente auditada'
    : 'Pendente';

  return (
    <div className="panel-card lotacao-auditoria-carga-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Viagem consolidada</div>
          <p>{viagem.dist} · {viagem.transportadora} · {viagem.origem} x {viagem.destino}/{viagem.ufDestino || '-'}</p>
        </div>
        <span className={`status-pill ${resumo.status === 'PARCIAL' ? '' : resumo.status === 'PENDENTE' ? 'error' : 'dark'}`}>
          {statusLabel}
        </span>
      </div>

      <div className="summary-strip lotacao-summary-mini">
        <div className="summary-card">
          <span>Valor referência auditoria</span>
          <strong>{formatarMoeda(resumo.valorTotal)}</strong>
          <small>{referencia.fonte}{referencia.valorCte ? ` · diferença ${formatarMoeda(referencia.diferenca)}` : ''}</small>
        </div>
        <div className="summary-card">
          <span>Valor original da viagem</span>
          <strong>{formatarMoeda(viagem.valorComparacaoOriginal ?? viagem.valorComparacao)}</strong>
          <small>{viagem.valoresInformados?.length > 1 ? 'não soma duplicidades' : 'valor base carregado'}</small>
        </div>
        <div className="summary-card">
          <span>Já auditado / vinculado</span>
          <strong>{formatarMoeda(resumo.valorAuditado)}</strong>
          <small>{resumo.ctesVinculados.length} CT-e(s) vinculado(s)</small>
        </div>
        <div className="summary-card">
          <span>Saldo pendente</span>
          <strong className={classeSaldo(resumo.saldoPendente)}>{formatarMoeda(resumo.saldoPendente)}</strong>
          <small>total − auditado</small>
        </div>
        <div className="summary-card">
          <span>Registros originais</span>
          <strong>{viagem.qtdRegistros}</strong>
          <small>consolidados em 1 viagem</small>
        </div>
      </div>

      {viagem.qtdRegistros > 1 && (
        <div className="sim-analise-tabela-wrap top-space-sm">
          <table className="sim-analise-tabela">
            <thead><tr><th>Registro original (DIST/HUB)</th><th>Origem</th><th>Destino</th><th>CT-e(s)</th><th>Valor informado</th></tr></thead>
            <tbody>
              {viagem.registrosOriginais.map((reg, idx) => (
                <tr key={`${reg.id || reg.dist}-${idx}`}>
                  <td><strong>{reg.dist}</strong></td>
                  <td>{reg.origem}</td>
                  <td>{reg.destino}</td>
                  <td>{reg.cteRaw || (reg.ctes || []).join('; ') || '-'}</td>
                  <td>{formatarMoeda(reg.valorComparacao)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="sim-analise-resumo top-space-sm">
        <div><span>Frete Cantu</span><strong>{formatarMoeda(viagem.freteCantu)}</strong></div>
        <div><span>Frete Transportadora</span><strong>{formatarMoeda(viagem.freteTransp)}</strong></div>
        <div><span>ICMS removido</span><strong>{formatarMoeda(viagem.icmsRemovido)}</strong></div>
        <div><span>Pedágio separado</span><strong>{formatarMoeda(viagem.pedagio)}</strong></div>
        <div><span>Tipo de veículo</span><strong>{viagem.tipoVeiculo || '-'}</strong></div>
        <div><span>CT-e(s) da viagem</span><strong>{ctes.join('; ') || '-'}</strong></div>
        <div><span>Critério auditoria</span><strong>{referencia.valorCte ? 'mais próximo do CT-e' : 'regra base'}</strong></div>
        <div><span>Valor CT-e comparado</span><strong>{referencia.valorCte ? formatarMoeda(referencia.valorCte) : '-'}</strong></div>
      </div>

      {referencia.candidatos?.length > 1 && (
        <div className="hint-box compact top-space-sm">
          Valor de referência escolhido: <strong>{referencia.fonte}</strong> {referencia.detalhe ? `(${referencia.detalhe}) ` : ''}
          por menor diferença contra o CT-e. Candidatos: {referencia.candidatos.map((item) => `${item.fonte}: ${formatarMoeda(item.valor)}${item.diferenca !== undefined ? ` (dif. ${formatarMoeda(item.diferenca)})` : ''}`).join(' · ')}
        </div>
      )}

      {viagem.regraCalculo && (
        <div className="hint-box compact top-space-sm">Regra aplicada na base: {viagem.regraCalculo}.</div>
      )}
    </div>
  );
}

// ─── FORMULÁRIO DE LANÇAMENTO ─────────────────────────────────────────────────
function FormLancamento({ viagem, lancamentos, solicitacoes, onRegistrar, salvando, usuarioAtual, valorSugerido, cteSugerido }) {
  const ctes = viagem?.ctes?.length ? viagem.ctes : separarCtes(viagem?.cteRaw || '');
  const lancConsolidados = useMemo(() => reKeyLancamentosPorViagem(lancamentos), [lancamentos]);

  const [form, setForm] = useState({
    cte: cteSugerido && ctes.includes(cteSugerido) ? cteSugerido : (ctes[0] || (cteSugerido ? 'OUTRO' : '')),
    cteOutro: cteSugerido && !ctes.includes(cteSugerido) ? cteSugerido : '',
    valorLancado: valorSugerido ? String(valorSugerido) : '',
    fatura: '',
    observacao: '',
  });

  if (!viagem) return null;

  const resumo = resumoViagem(viagem, lancamentos);
  const totalLancado = resumo.valorAuditado;
  const saldo = resumo.saldoPendente;
  const valorDigitado = Number(String(form.valorLancado || '').replace(',', '.')) || 0;
  const excedentePrevisto = Math.max(0, valorDigitado - Math.max(0, saldo));
  const cteEfetivo = form.cte === 'OUTRO' ? form.cteOutro : form.cte;
  const duplicado = cteJaLancado(lancConsolidados, viagem, cteEfetivo);
  const ctesLancados = resumo.ctesVinculados;

  const observacaoObrigatoria = excedentePrevisto > 0;
  const observacaoVazia = !form.observacao || !form.observacao.trim();
  const bloqueadoPorObservacao = observacaoObrigatoria && observacaoVazia;

  const registrar = () => {
    if (!valorDigitado || valorDigitado <= 0 || duplicado || bloqueadoPorObservacao) return;
    onRegistrar({
      ...form,
      cte: cteEfetivo,
      auditedByUserId: usuarioAtual?.id || '',
      auditedByName: usuarioAtual?.nome || '',
      auditedByEmail: usuarioAtual?.email || '',
      auditedAt: new Date().toISOString(),
      auditStatus: excedentePrevisto > 0 ? 'EXCEDEU_AGUARDANDO_OPERACAO' : 'AUDITADO_OK',
      auditExceededAmount: excedentePrevisto,
      auditAllowedAmount: Math.max(0, saldo),
      auditEnteredAmount: valorDigitado,
    });

    // 4.34A.4 — após salvar, não manter o CT-e recém-vinculado selecionado.
    // Como o pai atualiza os lançamentos em seguida, deixar o mesmo CT-e no select
    // fazia a tela exibir imediatamente o aviso de duplicidade, apesar do registro
    // ter sido salvo corretamente. O aviso deve aparecer apenas quando o usuário
    // consultar/tentar selecionar novamente um CT-e já vinculado.
    const cteSalvo = normalizarTexto(cteEfetivo || '');
    const proximoCteDisponivel = ctes.find((c) => (
      !cteJaLancado(lancConsolidados, viagem, c) && normalizarTexto(c) !== cteSalvo
    ));

    setForm({
      cte: proximoCteDisponivel || 'OUTRO',
      cteOutro: '',
      valorLancado: '',
      fatura: '',
      observacao: '',
    });
  };

  const atualizar = (campo, valor) => setForm((prev) => ({ ...prev, [campo]: valor }));

  return (
    <div className="panel-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Vincular CT-e à viagem</div>
          <p>Informe o CT-e, o valor e a fatura. O saldo é controlado pela viagem consolidada; CT-e já usado na viagem fica bloqueado.</p>
        </div>
        {usuarioAtual && <span className="status-pill">Auditor: {usuarioAtual.nome || usuarioAtual.email}</span>}
      </div>

      <div className="form-grid three">
        <label className="field">
          CT-e auditado
          {ctes.length ? (
            <select value={form.cte} onChange={(e) => atualizar('cte', e.target.value)}>
              {ctes.map((cte) => {
                const usado = cteJaLancado(lancConsolidados, viagem, cte);
                return (
                  <option key={cte} value={cte} disabled={usado}>
                    {cte}{usado ? ' · já vinculado' : ''}
                  </option>
                );
              })}
              <option value="DIST">Lançamento pela viagem</option>
              <option value="OUTRO">Outro CT-e</option>
            </select>
          ) : (
            <input value={form.cte} onChange={(e) => atualizar('cte', e.target.value)} placeholder="CT-e ou viagem" />
          )}
        </label>

        {form.cte === 'OUTRO' && (
          <label className="field">
            Informar outro CT-e
            <input value={form.cteOutro} onChange={(e) => atualizar('cteOutro', e.target.value)} placeholder="Número do CT-e" />
          </label>
        )}

        <label className="field">
          Valor lançado
          <input type="number" min="0" step="0.01" value={form.valorLancado}
            onChange={(e) => atualizar('valorLancado', e.target.value)} placeholder="Ex.: 10000" />
        </label>

        <label className="field">
          Fatura
          <input value={form.fatura} onChange={(e) => atualizar('fatura', e.target.value)} placeholder="Número da fatura" />
        </label>
      </div>

      <label className="field" style={{ marginTop: '0.75rem' }}>
        Observação{observacaoObrigatoria ? <span style={{ color: '#c0392b', marginLeft: 4 }}>*</span> : ''}
        <textarea
          value={form.observacao}
          onChange={(e) => atualizar('observacao', e.target.value)}
          placeholder={observacaoObrigatoria
            ? 'Justificativa obrigatória — informe o motivo do excedente para a operação.'
            : 'Observação da auditoria ou justificativa'}
          style={{
            borderColor: observacaoObrigatoria && observacaoVazia ? '#c0392b' : undefined,
            minHeight: observacaoObrigatoria ? 80 : 60,
          }}
        />
      </label>

      {observacaoObrigatoria && observacaoVazia && (
        <div className="hint-box compact error-text" style={{ marginTop: '0.5rem' }}>
          ⚠ Informe uma justificativa. O campo Observação é obrigatório quando o valor lançado ultrapassa o saldo da viagem.
        </div>
      )}

      <div className="sim-analise-resumo">
        <div><span>Saldo antes do lançamento</span><strong>{formatarMoeda(saldo)}</strong></div>
        <div><span>Valor digitado</span><strong>{formatarMoeda(valorDigitado)}</strong></div>
        <div><span>Excedente previsto</span><strong className={excedentePrevisto > 0 ? 'negativo' : ''}>{formatarMoeda(excedentePrevisto)}</strong></div>
        <div><span>Já auditado na viagem</span><strong>{formatarMoeda(totalLancado)}</strong></div>
      </div>

      {ctesLancados.length > 0 && (
        <div className="hint-box compact">CT-e(s) já vinculados nesta viagem: <strong>{ctesLancados.join(', ')}</strong>.</div>
      )}
      {duplicado && (
        <div className="hint-box compact error-text">Este CT-e já foi vinculado nesta viagem. Não é permitido vincular o mesmo CT-e duas vezes.</div>
      )}
      {excedentePrevisto > 0 && !duplicado && (
        <div className="hint-box compact error-text">
          Este lançamento passa do saldo da viagem. Ao registrar, o sistema cria uma pendência para aprovação na tela Lotação Operação.
        </div>
      )}

      <div className="actions-right">
        <button type="button" className="btn-primary"
          disabled={salvando || !valorDigitado || valorDigitado <= 0 || duplicado || (form.cte === 'OUTRO' && !form.cteOutro.trim()) || bloqueadoPorObservacao}
          title={bloqueadoPorObservacao ? 'Preencha a justificativa antes de registrar' : ''}
          onClick={registrar}>
          {salvando ? 'Salvando...' : excedentePrevisto > 0 ? 'Vincular e abrir pendência' : 'Vincular CT-e à viagem'}
        </button>
      </div>
    </div>
  );
}

function AuditoriaLoteCtes({
  viagem,
  lancamentos,
  texto,
  onTextoChange,
  analise,
  resultados,
  selecionados,
  buscando,
  salvando,
  onBuscar,
  onToggle,
  onToggleTodos,
  onVincular,
  onUsarCte,
  sugestoesViagens = [],
  onUsarViagem,
  mostrarEntrada = true,
}) {
  const resumo = viagem ? resumoViagem(viagem, lancamentos) : null;
  const selecionadosSet = new Set(selecionados || []);
  const validos = (resultados || []).filter((item) => item.selecionavel);
  const encontrados = (resultados || []).filter((item) => item.cte).length;
  const naoEncontrados = (resultados || []).filter((item) => item.status === 'NAO_ENCONTRADO').length;
  const vinculados = (resultados || []).filter((item) => item.status === 'JA_VINCULADO' || item.status === 'JA_VINCULADO_OUTRA').length;
  const valorSelecionado = (resultados || [])
    .filter((item) => selecionadosSet.has(item.chave))
    .reduce((acc, item) => acc + numeroAuditoria(item.cte?.valor_cte), 0);
  const saldoAtual = resumo?.saldoPendente || 0;
  const saldoApos = Number((saldoAtual - valorSelecionado).toFixed(2));
  const todosValidosSelecionados = validos.length > 0 && validos.every((item) => selecionadosSet.has(item.chave));

  return (
    <div className="panel-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Auditoria em lote por chaves CT-e</div>
          <p>Cole várias chaves para buscar, selecionar e vincular à mesma viagem consolidada.</p>
        </div>
        {viagem ? <span className="status-pill dark">Viagem: {viagem.dist}</span> : <span className="status-pill error">Selecione uma viagem</span>}
      </div>

      {mostrarEntrada && (
        <>
          <label className="field">
            Cole uma ou várias chaves CT-e
            <textarea
              value={texto}
              onChange={(e) => onTextoChange(e.target.value)}
              placeholder="Cole chaves por linha, vírgula, ponto e vírgula, espaço ou tab"
              style={{ minHeight: 90 }}
            />
          </label>

          <div className="actions-right top-space-sm">
            <button type="button" className="btn-secondary" onClick={onBuscar} disabled={buscando || salvando || !texto.trim()}>
              {buscando ? 'Buscando...' : 'Buscar CT-es'}
            </button>
          </div>
        </>
      )}

      <div className="summary-strip lotacao-summary-mini top-space-sm">
        <div className="summary-card"><span>Chaves lidas</span><strong>{analise.lidas}</strong></div>
        <div className="summary-card"><span>Válidas</span><strong>{analise.validas.length}</strong></div>
        <div className="summary-card"><span>Duplicadas ignoradas</span><strong>{analise.duplicadas.length}</strong></div>
        <div className="summary-card"><span>Encontradas</span><strong>{encontrados}</strong></div>
        <div className="summary-card"><span>Não encontradas</span><strong>{naoEncontrados}</strong></div>
        <div className="summary-card"><span>Já vinculadas</span><strong>{vinculados}</strong></div>
      </div>

      {analise.invalidas.length > 0 && (
        <div className="hint-box compact error-text">
          Chave(s) inválida(s) ignorada(s): {analise.invalidas.slice(0, 8).join(', ')}
          {analise.invalidas.length > 8 ? ` e mais ${analise.invalidas.length - 8}` : ''}.
        </div>
      )}

      {resultados.length > 0 && (
        <>
          <div className="sim-analise-resumo top-space-sm">
            <div><span>Valor total da viagem</span><strong>{formatarMoeda(resumo?.valorTotal || 0)}</strong></div>
            <div><span>Já auditado/vinculado</span><strong>{formatarMoeda(resumo?.valorAuditado || 0)}</strong></div>
            <div><span>Saldo pendente atual</span><strong>{formatarMoeda(saldoAtual)}</strong></div>
            <div><span>Valor selecionado</span><strong>{formatarMoeda(valorSelecionado)}</strong></div>
            <div><span>Saldo após lote</span><strong className={classeSaldo(saldoApos)}>{formatarMoeda(saldoApos)}</strong></div>
          </div>

          {saldoApos < -0.01 && (
            <div className="hint-box compact error-text">
              O lote selecionado ultrapassa o saldo pendente. Ao vincular, a regra atual abrirá pendência para aprovação quando houver excedente.
            </div>
          )}

          <div className="actions-right top-space-sm">
            <button type="button" className="btn-secondary" onClick={onToggleTodos} disabled={!validos.length || salvando}>
              {todosValidosSelecionados ? 'Limpar seleção' : 'Selecionar todos válidos'}
            </button>
            <button type="button" className="btn-primary" onClick={onVincular} disabled={!viagem || salvando || !selecionados.length}>
              {salvando ? 'Salvando...' : 'Vincular selecionados à viagem'}
            </button>
          </div>

          {!viagem && sugestoesViagens.length > 0 && (
            <div className="table-card lotacao-table-card top-space-sm">
              <div className="panel-title" style={{ padding: '0.75rem 1rem 0.25rem' }}>Escolha a viagem/DIST para liberar seleção</div>
              <div className="mini-list" style={{ padding: '0 1rem 1rem' }}>
                {sugestoesViagens.slice(0, 5).map(({ viagem: item, score, motivos }) => (
                  <button
                    key={item.id}
                    type="button"
                    className="mini-list-row clickable"
                    onClick={() => onUsarViagem?.(item)}
                  >
                    <span>
                      <strong>{item.dist}</strong>{item.qtdRegistros > 1 ? ` · ${item.qtdRegistros} registros` : ''} · {item.transportadora} · {item.origem} x {item.destino}
                      <small style={{ display: 'block', color: 'var(--muted)' }}>{motivos?.join(', ') || 'Sugestão por proximidade'} · {score >= 70 ? 'Alta' : score >= 40 ? 'Média' : 'Baixa'}</small>
                    </span>
                    <strong>{formatarMoeda(item.valorComparacao)}</strong>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="sim-analise-tabela-wrap top-space-sm">
            <table className="sim-analise-tabela">
              <thead>
                <tr><th>Selecionar</th><th>Ação</th><th>Chave CT-e</th><th>Número</th><th>Transportadora</th><th>Origem</th><th>Destino</th><th>Valor CT-e</th><th>Status</th><th>Observação</th></tr>
              </thead>
              <tbody>
                {resultados.map((item) => (
                  <tr key={item.chave}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selecionadosSet.has(item.chave)}
                        disabled={!item.selecionavel || salvando}
                        onChange={() => onToggle(item.chave)}
                      />
                    </td>
                    <td>
                      {item.cte ? (
                        <button type="button" className="btn-secondary" onClick={() => onUsarCte(item.cte)}>
                          Ver DIST
                        </button>
                      ) : '-'}
                    </td>
                    <td style={{ fontSize: 11 }}>{item.chave}</td>
                    <td>{item.cte?.numero_cte || '-'}</td>
                    <td>{item.cte?.transportadora || item.cte?.transportadora_contratada || '-'}</td>
                    <td>{item.cte?.cidade_origem || '-'}/{item.cte?.uf_origem || '-'}</td>
                    <td>{item.cte?.cidade_destino || '-'}/{item.cte?.uf_destino || '-'}</td>
                    <td>{formatarMoeda(item.cte?.valor_cte || 0)}</td>
                    <td><span className={`status-pill ${item.selecionavel ? '' : 'error'}`}>{item.statusLabel}</span></td>
                    <td>{item.observacao || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function HistoricoLancamentos({ viagem, lancamentos }) {
  if (!viagem) return null;
  const lista = lancamentosDaViagem(lancamentos, viagem.chaveViagem || consolidarChaveViagem(viagem.dist))
    .sort((a, b) => new Date(b.auditedAt || b.criadoEm).getTime() - new Date(a.auditedAt || a.criadoEm).getTime());
  if (!lista.length) return <div className="hint-box compact">Nenhum CT-e vinculado a esta viagem.</div>;

  return (
    <div className="table-card lotacao-table-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">CT-es vinculados à viagem</div>
          <p className="compact">Controle de saldo por CT-e/fatura.</p>
        </div>
      </div>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead>
            <tr><th>Data/Hora</th><th>Auditor</th><th>CT-e</th><th>Fatura</th><th>Valor lançado</th><th>Saldo anterior</th><th>Excedente</th><th>Status</th><th>Observação</th></tr>
          </thead>
          <tbody>
            {lista.map((item) => (
              <tr key={item.id}>
                <td>{formatarDataCurta(item.auditedAt || item.criadoEm)}</td>
                <td><span title={item.auditedByEmail || item.audited_by_email || ''}>{item.auditedByName || item.audited_by_name || '-'}</span></td>
                <td>{item.cte || '-'}</td>
                <td>{item.fatura || '-'}</td>
                <td>{formatarMoeda(item.valorLancado)}</td>
                <td>{formatarMoeda(item.saldoAnterior ?? item.totalAnterior)}</td>
                <td className={item.excedente > 0 ? 'negativo' : ''}>{formatarMoeda(item.excedente)}</td>
                <td><span className={`status-pill ${item.excedente > 0 ? 'error' : ''}`}>{item.auditStatus || item.audit_status || item.status}</span></td>
                <td>{item.observacao || item.audit_observation || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MovimentosAutorizacao({ viagem, solicitacoes }) {
  if (!viagem) return null;
  const chave = viagem.chaveViagem || consolidarChaveViagem(viagem.dist);
  const lista = (solicitacoes || [])
    .filter((item) => consolidarChaveViagem(item.dist || item.distKey || item.dist_key || '') === chave)
    .sort((a, b) => new Date(b.criadoEm || 0).getTime() - new Date(a.criadoEm || 0).getTime());
  if (!lista.length) return null;

  return (
    <div className="table-card lotacao-table-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Autorizações e custos da operação</div>
          <p className="compact">Aprovações ficam em Lotação Operação e, quando aprovadas, liberam saldo adicional para auditoria.</p>
        </div>
      </div>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead>
            <tr><th>Data</th><th>Tipo</th><th>Status</th><th>Valor</th><th>CT-e</th><th>Observação</th><th>Resposta</th></tr>
          </thead>
          <tbody>
            {lista.map((item) => (
              <tr key={item.id}>
                <td>{formatarDataCurta(item.criadoEm)}</td>
                <td>{item.tipo === 'CUSTO_ADICIONAL' ? item.tipoCusto || 'Custo adicional' : 'Excedente auditoria'}</td>
                <td><span className="status-pill">{item.status}</span></td>
                <td>{formatarMoeda(item.valorAdicional || item.excedente)}</td>
                <td>{item.cte || '-'}</td>
                <td>{item.observacao || '-'}</td>
                <td>{item.resposta || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Painel-resumo (topo) ─────────────────────────────────────────────────────
function PainelAuditoriaGeral({ lancamentos, solicitacoes, totalCargas, fonteCargas }) {
  const pendentes = (solicitacoes || []).filter((item) => item.status === 'PENDENTE' || item.status === 'EXCEDEU_AGUARDANDO_OPERACAO');
  const aprovados = (solicitacoes || []).filter((item) => item.status === 'APROVADO' || item.status === 'APROVADO_OPERACAO');
  const recusados = (solicitacoes || []).filter((item) => item.status === 'RECUSADO' || item.status === 'RECUSADO_OPERACAO');

  return (
    <div className="panel-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Resumo da auditoria de lotação</div>
          <p className="compact">Central única: base CT-e como fonte, casamento com o realizado e controle de saldo por viagem.</p>
        </div>
        <span className="status-pill dark" style={{ background: fonteCargas === 'supabase' ? undefined : '#b9770e' }}>
          {totalCargas.toLocaleString('pt-BR')} cargas {fonteCargas === 'supabase' ? '(Supabase)' : '(local)'}
        </span>
      </div>
      <div className="summary-strip lotacao-summary-mini">
        <div className="summary-card"><span>CT-es vinculados</span><strong>{(lancamentos || []).length.toLocaleString('pt-BR')}</strong><small>lançamentos auditados</small></div>
        <div className="summary-card"><span>Em aprovação</span><strong>{pendentes.length.toLocaleString('pt-BR')}</strong><small>excedentes pendentes</small></div>
        <div className="summary-card"><span>Aprovados</span><strong>{aprovados.length.toLocaleString('pt-BR')}</strong><small>liberam saldo</small></div>
        <div className="summary-card"><span>Recusados</span><strong>{recusados.length.toLocaleString('pt-BR')}</strong><small>sem liberação</small></div>
      </div>
    </div>
  );
}

// ─── Aba Histórico / Pendências ───────────────────────────────────────────────
function HistoricoPendencias({ lancamentos, solicitacoes }) {
  const pendentes = (solicitacoes || []).filter((item) => item.status === 'PENDENTE' || item.status === 'EXCEDEU_AGUARDANDO_OPERACAO');
  const recentes = [...(lancamentos || [])]
    .sort((a, b) => new Date(b.auditedAt || b.criadoEm || 0).getTime() - new Date(a.auditedAt || a.criadoEm || 0).getTime())
    .slice(0, 100);

  return (
    <div className="table-card lotacao-table-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Histórico de auditorias recentes</div>
          <p className="compact">Últimos lançamentos e o que está aguardando aprovação da operação.</p>
        </div>
        <span className="status-pill dark">{pendentes.length} em aprovação</span>
      </div>
      {pendentes.length > 0 && (
        <div className="hint-box compact top-space-sm">
          Há {pendentes.length.toLocaleString('pt-BR')} solicitação(ões) aguardando validação em Lotação Operação.
        </div>
      )}
      <div className="sim-analise-tabela-wrap top-space-sm">
        <table className="sim-analise-tabela">
          <thead>
            <tr><th>Data</th><th>Auditor</th><th>Viagem</th><th>CT-e</th><th>Fatura</th><th>Valor lançado</th><th>Excedente</th><th>Status</th><th>Justificativa</th></tr>
          </thead>
          <tbody>
            {recentes.map((item) => (
              <tr key={item.id}>
                <td>{formatarDataCurta(item.auditedAt || item.criadoEm)}</td>
                <td><span title={item.auditedByEmail || ''}>{item.auditedByName || '-'}</span></td>
                <td><strong>{distExibicao(item.dist) || item.dist}</strong></td>
                <td>{item.cte || '-'}</td>
                <td>{item.fatura || '-'}</td>
                <td>{formatarMoeda(item.valorLancado)}</td>
                <td className={item.excedente > 0 ? 'negativo' : ''}>{formatarMoeda(item.excedente)}</td>
                <td><span className={`status-pill ${item.excedente > 0 ? 'error' : ''}`}>{item.auditStatus || item.status}</span></td>
                <td>{item.observacao || '-'}</td>
              </tr>
            ))}
            {!recentes.length && <tr><td colSpan="9">Nenhum lançamento registrado até agora.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Aba Vínculos de Transportadora ───────────────────────────────────────────
function PainelVinculos({ vinculos, onSalvar, onRemover, sugestaoRealizado, sugestaoCte, fonte = 'local', salvando = false }) {
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState({ nomeRealizado: sugestaoRealizado || '', nomeCteTabela: sugestaoCte || '', cnpj: '' });

  const atualizar = (campo, valor) => setForm((prev) => ({ ...prev, [campo]: valor }));

  const salvar = () => {
    const nomeRealizado = (form.nomeRealizado || '').trim();
    const nomeCteTabela = (form.nomeCteTabela || '').trim();
    if (!nomeRealizado || !nomeCteTabela) return;
    let novos;
    if (editando) {
      novos = vinculos.map((v) => (v.id === editando ? { ...v, nomeRealizado, nomeCteTabela, cnpj: (form.cnpj || '').trim(), atualizadoEm: new Date().toISOString() } : v));
    } else {
      novos = [
        { id: globalThis.crypto?.randomUUID?.() || `vinc-${Date.now()}`, nomeRealizado, nomeCteTabela, cnpj: (form.cnpj || '').trim(), criadoEm: new Date().toISOString() },
        ...vinculos,
      ];
    }
    onSalvar(novos);
    setEditando(null);
    setForm({ nomeRealizado: '', nomeCteTabela: '', cnpj: '' });
  };

  const editar = (v) => {
    setEditando(v.id);
    setForm({ nomeRealizado: v.nomeRealizado || '', nomeCteTabela: v.nomeCteTabela || '', cnpj: v.cnpj || '' });
  };

  const remover = (id) => {
    if (typeof onRemover === 'function') onRemover(id);
    else onSalvar(vinculos.filter((v) => v.id !== id));
  };

  return (
    <div className="panel-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Vínculos de transportadora</div>
          <p>Liga o nome da transportadora no realizado/lotação ao nome oficial na base CT-e / tabela de frete. Ex.: <strong>LIBARDO</strong> → <strong>LIBARDO TRANSPORTES LTDA</strong>.</p>
        </div>
        <span className="status-pill dark">{vinculos.length} vínculo(s) · {fonte === 'supabase' ? 'Supabase' : 'local'}</span>
      </div>

      <div className="hint-box compact">
        Os vínculos são compartilhados via Supabase e também ficam em cache local como segurança.
      </div>

      <div className="form-grid three top-space-sm">
        <label className="field">
          Nome no realizado / lotação
          <input value={form.nomeRealizado} onChange={(e) => atualizar('nomeRealizado', e.target.value)} placeholder="Ex.: LIBARDO" />
        </label>
        <label className="field">
          Nome no CT-e / tabela
          <input value={form.nomeCteTabela} onChange={(e) => atualizar('nomeCteTabela', e.target.value)} placeholder="Ex.: LIBARDO TRANSPORTES LTDA" />
        </label>
        <label className="field">
          CNPJ (opcional)
          <input value={form.cnpj} onChange={(e) => atualizar('cnpj', e.target.value)} placeholder="00.000.000/0000-00" />
        </label>
      </div>
      <div className="actions-right">
        {editando && (
          <button type="button" className="btn-secondary" onClick={() => { setEditando(null); setForm({ nomeRealizado: '', nomeCteTabela: '', cnpj: '' }); }}>
            Cancelar edição
          </button>
        )}
        <button type="button" className="btn-primary" disabled={salvando || !form.nomeRealizado.trim() || !form.nomeCteTabela.trim()} onClick={salvar}>
          {salvando ? 'Salvando...' : editando ? 'Salvar alteração' : 'Adicionar vínculo'}
        </button>
      </div>

      <div className="sim-analise-tabela-wrap top-space-sm">
        <table className="sim-analise-tabela">
          <thead><tr><th>Nome no realizado</th><th>Nome no CT-e / tabela</th><th>CNPJ</th><th>Ações</th></tr></thead>
          <tbody>
            {vinculos.map((v) => (
              <tr key={v.id}>
                <td><strong>{v.nomeRealizado}</strong></td>
                <td>{v.nomeCteTabela}</td>
                <td>{v.cnpj || '-'}</td>
                <td>
                  <button type="button" className="btn-secondary" style={{ marginRight: 6 }} disabled={salvando} onClick={() => editar(v)}>Editar</button>
                  <button type="button" className="btn-secondary" disabled={salvando} onClick={() => remover(v.id)}>Remover</button>
                </td>
              </tr>
            ))}
            {!vinculos.length && <tr><td colSpan="4">Nenhum vínculo cadastrado ainda.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Barra de abas ────────────────────────────────────────────────────────────
function AbasAuditoria({ ativa, onMudar, pendencias }) {
  const abas = [
    { id: 'auditar', label: 'Auditar' },
    { id: 'vinculos', label: 'Vínculos de Transportadora' },
    { id: 'historico', label: `Histórico / Pendências${pendencias ? ` (${pendencias})` : ''}` },
  ];
  return (
    <div className="mini-list" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', background: 'transparent', padding: 0 }}>
      {abas.map((aba) => (
        <button
          key={aba.id}
          type="button"
          className={ativa === aba.id ? 'btn-primary' : 'btn-secondary'}
          onClick={() => onMudar(aba.id)}
        >
          {aba.label}
        </button>
      ))}
    </div>
  );
}

// ════════════════════════════ PÁGINA PRINCIPAL ═══════════════════════════════
export default function LotacaoAuditoriaPage() {
  const mounted = useRef(true);
  const [usuarioAtual] = useState(() => carregarSessao());

  const [baseFluxo, setBaseFluxo] = useState(() => carregarFluxoCargasLotacao());
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);
  const [fonteCargas, setFonteCargas] = useState('local');

  const [abaAtiva, setAbaAtiva] = useState('auditar');

  // buscas separadas (4.34A)
  const [buscaChave, setBuscaChave] = useState('');
  const [buscaNumeroCte, setBuscaNumeroCte] = useState('');
  const [buscaDist, setBuscaDist] = useState('');

  const [viagensResultado, setViagensResultado] = useState([]);
  const [viagemSelecionada, setViagemSelecionada] = useState(null);
  const [ctesEncontrados, setCtesEncontrados] = useState([]);
  const [cteSelecionado, setCteSelecionado] = useState(null);
  const [sugestoesViagens, setSugestoesViagens] = useState([]);
  const [buscandoSugestoes, setBuscandoSugestoes] = useState(false);
  const [loteChavesTexto, setLoteChavesTexto] = useState('');
  const [loteResultados, setLoteResultados] = useState([]);
  const [loteSelecionados, setLoteSelecionados] = useState([]);
  const [buscandoLote, setBuscandoLote] = useState(false);

  const [tabelasLotacao, setTabelasLotacao] = useState([]);
  const [lancamentos, setLancamentos] = useState(() => carregarLancamentosAuditoria());
  const [solicitacoes, setSolicitacoes] = useState(() => carregarSolicitacoesPagamento());
  const [carregandoAuditoria, setCarregandoAuditoria] = useState(false);

  const [vinculos, setVinculos] = useState(() => carregarVinculos());
  const [fonteVinculos, setFonteVinculos] = useState('local');
  const [salvandoVinculos, setSalvandoVinculos] = useState(false);

  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState('');

  // ── cargas (Supabase > local) ──
  useEffect(() => {
    mounted.current = true;
    setCarregandoHistorico(true);
    (async () => {
      try {
        const cargasSupabase = await carregarCargasLotacaoSupabase({});
        if (mounted.current && cargasSupabase.length > 0) {
          setBaseFluxo({ cargas: cargasSupabase, armazenamento: 'supabase' });
          setFonteCargas('supabase');
          return;
        }
      } catch (err) {
        console.warn('[Auditoria] Supabase indisponível para cargas, usando local:', err.message);
      }
      try {
        const base = await carregarFluxoCargasLotacaoCompleto();
        if (mounted.current) { setBaseFluxo(base); setFonteCargas('local'); }
      } catch (err) {
        console.error('[Auditoria] Erro ao carregar histórico local:', err);
      }
    })().finally(() => { if (mounted.current) setCarregandoHistorico(false); });
    return () => { mounted.current = false; };
  }, []);

  // ── lançamentos e solicitações (Supabase > local) ──
  useEffect(() => {
    setCarregandoAuditoria(true);
    (async () => {
      try {
        const [lancs, sols, pends] = await Promise.all([
          carregarLancamentosAuditoriaSupabase(),
          carregarSolicitacoesSupabase(),
          carregarPendenciasAuditoriaSupabase({}).catch(() => null),
        ]);
        if (lancs !== null) { setLancamentos(lancs); salvarLancamentosAuditoria(lancs); }
        if (sols !== null) {
          const movimentosPendencias = Array.isArray(pends) ? pends.map(pendenciaParaMovimentoAutorizacao) : [];
          const solicitacoesComPendencias = [...movimentosPendencias, ...sols];
          setSolicitacoes(solicitacoesComPendencias);
          salvarSolicitacoesPagamento(solicitacoesComPendencias);
        }
      } catch (err) {
        console.warn('[Auditoria] Usando localStorage para lançamentos/solicitações:', err.message);
      } finally {
        setCarregandoAuditoria(false);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const resp = await carregarTabelasLotacaoSupabase();
        setTabelasLotacao(resp?.tabelas || []);
      } catch {
        setTabelasLotacao(carregarTabelasLotacao());
      }
    })();
  }, []);

  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const lista = await carregarVinculosTransportadoras();
        if (!ativo) return;
        const adaptados = (lista || []).map(vinculoGlobalParaAuditoria).filter((item) => item.nomeRealizado && item.nomeCteTabela);
        if (adaptados.length) {
          setVinculos(adaptados);
          salvarVinculos(adaptados);
        }
        setFonteVinculos('supabase');
      } catch (error) {
        console.warn('[Auditoria] Vínculos no Supabase indisponíveis; usando fallback local:', error.message || error);
        if (ativo) setFonteVinculos('local');
      }
    })();
    return () => { ativo = false; };
  }, []);

  const tabelaAplicavel = useMemo(() => {
    if (!cteSelecionado && !viagemSelecionada) return [];
    const filtros = cteSelecionado ? cteParaFiltrosRota(cteSelecionado) : {
      origem: viagemSelecionada?.origem || '',
      destino: viagemSelecionada?.destino || '',
      transportadora: viagemSelecionada?.transportadora || '',
      tipo: viagemSelecionada?.tipoVeiculo || '',
    };
    return pesquisarRotaLotacao(tabelasLotacao, filtros).slice(0, 10);
  }, [tabelasLotacao, cteSelecionado, viagemSelecionada]);

  const viagemParaAuditoria = useMemo(
    () => aplicarReferenciaAuditoria(viagemSelecionada, cteSelecionado),
    [viagemSelecionada, cteSelecionado],
  );

  const analiseLoteChaves = useMemo(
    () => analisarChavesCteLote(loteChavesTexto),
    [loteChavesTexto],
  );

  // ── Busca por chave CT-e (somente chave de 44 dígitos na base CT-e) ──
  const pesquisarPorChave = useCallback(async () => {
    setMensagem('');
    const chave = String(buscaChave || '').replace(/\D/g, '');
    if (!chave) { setMensagem('Informe a chave CT-e para buscar na base de CT-es.'); return; }
    if (chave.length !== 44) { setMensagem('Informe uma chave CT-e válida com 44 dígitos.'); return; }
    try {
      const ctes = await buscarCteLotacaoAuditoriaPorChaveSupabase(chave);
      setCtesEncontrados(ctes);
      setCteSelecionado(ctes[0] || null);
      setSugestoesViagens([]);
      if (!ctes.length) setMensagem('Nenhum CT-e encontrado na base de CT-es para essa chave.');
    } catch (error) {
      setCtesEncontrados([]); setCteSelecionado(null);
      setMensagem(`Falha ao buscar chave CT-e: ${error.message || String(error)}`);
    }
  }, [buscaChave]);

  // ── Busca por número CT-e (somente número na base CT-e) ──
  const pesquisarPorNumeroCte = useCallback(async () => {
    setMensagem('');
    const numero = String(buscaNumeroCte || '').replace(/\D/g, '');
    if (!numero) { setMensagem('Informe o número do CT-e para buscar na base de CT-es.'); return; }
    try {
      const ctes = await buscarCtesLotacaoAuditoriaPorNumeroSupabase(numero);
      setCtesEncontrados(ctes);
      setCteSelecionado(ctes[0] || null);
      setSugestoesViagens([]);
      if (!ctes.length) setMensagem('Nenhum CT-e encontrado na base de CT-es para esse número.');
    } catch (error) {
      setCtesEncontrados([]); setCteSelecionado(null);
      setMensagem(`Falha ao buscar número CT-e: ${error.message || String(error)}`);
    }
  }, [buscaNumeroCte]);

  // ── Busca por DIST / viagem (somente no realizado, já consolidado) ──
  const pesquisarPorDist = useCallback(() => {
    setMensagem('');
    const termo = buscaDist.trim();
    if (!termo) { setMensagem('Informe DIST, HUB ou número da viagem.'); return; }
    const cargas = buscarCargaPorDistOuCte(baseFluxo.cargas, termo);
    const viagens = consolidarViagens(cargas);
    setViagensResultado(viagens);
    setViagemSelecionada(viagens[0] || null);
    if (!viagens.length) setMensagem('Nenhuma viagem encontrada no realizado para esse DIST/viagem.');
  }, [buscaDist, baseFluxo.cargas]);

  // ── Sugestões no realizado a partir do CT-e ──
  const buscarSugestoesNoRealizado = useCallback(() => {
    if (!cteSelecionado) return;
    setBuscandoSugestoes(true);
    const sugestoes = sugerirViagensPorCte(baseFluxo.cargas, cteSelecionado, vinculos);
    setSugestoesViagens(sugestoes);
    if (sugestoes.length) setViagemSelecionada((atual) => atual || sugestoes[0].viagem);
    setBuscandoSugestoes(false);
  }, [cteSelecionado, baseFluxo.cargas, vinculos]);

  const montarResultadoLote = useCallback((chave, respostaPorChave, lancamentosBase) => {
    const resposta = respostaPorChave.get(chave);
    const cte = resposta?.ctes?.[0] || null;
    const erro = resposta?.erro || '';
    const lancConsolidados = reKeyLancamentosPorViagem(lancamentosBase);
    const ids = identificadoresCteAuditoria(cte, chave);
    const vinculadoNaViagem = viagemParaAuditoria && ids.some((id) => cteJaLancado(lancConsolidados, viagemParaAuditoria, id));
    const vinculadoOutraViagem = cteJaLancadoEmOutraViagem(lancConsolidados, viagemParaAuditoria, ids);

    if (erro) {
      return { chave, cte, status: 'ERRO', statusLabel: 'erro', selecionavel: false, observacao: erro };
    }
    if (!cte) {
      return { chave, cte: null, status: 'NAO_ENCONTRADO', statusLabel: 'não encontrado', selecionavel: false, observacao: 'Chave não localizada na base de CT-es.' };
    }
    if (vinculadoNaViagem) {
      return { chave, cte, status: 'JA_VINCULADO', statusLabel: 'já vinculado', selecionavel: false, observacao: 'CT-e já vinculado nesta viagem.' };
    }
    if (vinculadoOutraViagem) {
      return { chave, cte, status: 'JA_VINCULADO_OUTRA', statusLabel: 'já vinculado', selecionavel: false, observacao: 'CT-e já vinculado em outra viagem.' };
    }
    if (!viagemParaAuditoria) {
      return { chave, cte, status: 'SEM_VIAGEM', statusLabel: 'encontrado', selecionavel: false, observacao: 'Selecione uma viagem consolidada para permitir vínculo.' };
    }
    return { chave, cte, status: 'VALIDO', statusLabel: 'válido para seleção', selecionavel: true, observacao: 'Pronto para vincular.' };
  }, [viagemParaAuditoria]);

  useEffect(() => {
    if (!loteResultados.length) return;
    const lancConsolidados = reKeyLancamentosPorViagem(lancamentos);
    setLoteResultados((atuais) => atuais.map((item) => {
      const cte = item.cte || null;
      if (!cte) return item;
      const ids = identificadoresCteAuditoria(cte, item.chave);
      const vinculadoNaViagem = viagemParaAuditoria && ids.some((id) => cteJaLancado(lancConsolidados, viagemParaAuditoria, id));
      const vinculadoOutraViagem = cteJaLancadoEmOutraViagem(lancConsolidados, viagemParaAuditoria, ids);

      if (vinculadoNaViagem) {
        return { ...item, status: 'JA_VINCULADO', statusLabel: 'já vinculado', selecionavel: false, observacao: 'CT-e já vinculado nesta viagem.' };
      }
      if (vinculadoOutraViagem) {
        return { ...item, status: 'JA_VINCULADO_OUTRA', statusLabel: 'já vinculado', selecionavel: false, observacao: 'CT-e já vinculado em outra viagem.' };
      }
      if (!viagemParaAuditoria) {
        return { ...item, status: 'SEM_VIAGEM', statusLabel: 'encontrado', selecionavel: false, observacao: 'Selecione uma viagem consolidada para permitir vínculo.' };
      }
      return { ...item, status: 'VALIDO', statusLabel: 'válido para seleção', selecionavel: true, observacao: 'Pronto para vincular.' };
    }));
    setLoteSelecionados((atuais) => atuais.filter((chave) => (
      loteResultados.some((item) => item.chave === chave && item.selecionavel)
    )));
  }, [viagemParaAuditoria, lancamentos]);

  const pesquisarLoteChaves = useCallback(async () => {
    setMensagem('');
    setLoteSelecionados([]);
    const textoPesquisa = loteChavesTexto || buscaChave;
    const analise = analisarChavesCteLote(textoPesquisa);
    if (!analise.validas.length) {
      setLoteResultados([]);
      setMensagem('Cole ao menos uma chave CT-e válida com 44 dígitos.');
      return;
    }

    setBuscandoLote(true);
    try {
      const respostas = await buscarCtesLotacaoAuditoriaPorChavesSupabase(analise.validas);
      const respostaPorChave = new Map((respostas || []).map((item) => [item.chave, item]));
      const resultados = analise.validas.map((chave) => montarResultadoLote(chave, respostaPorChave, lancamentos));
      setLoteResultados(resultados);
      const encontrados = resultados.filter((item) => item.cte).length;
      const primeiroEncontrado = resultados.find((item) => item.cte)?.cte || null;
      if (primeiroEncontrado && resultados.length === 1) {
        setCtesEncontrados([primeiroEncontrado]);
        setCteSelecionado(primeiroEncontrado);
        setSugestoesViagens([]);
      } else {
        setCtesEncontrados([]);
        setCteSelecionado(null);
        setSugestoesViagens([]);
      }
      setMensagem(`Lote analisado: ${resultados.length} chave(s), ${encontrados} encontrada(s).`);
    } catch (error) {
      setLoteResultados([]);
      setMensagem(`Falha ao buscar CT-es em lote: ${error.message || String(error)}`);
    } finally {
      setBuscandoLote(false);
    }
  }, [loteChavesTexto, buscaChave, lancamentos, montarResultadoLote]);

  const alternarSelecaoLote = useCallback((chave) => {
    setLoteSelecionados((atuais) => (
      atuais.includes(chave) ? atuais.filter((item) => item !== chave) : atuais.concat(chave)
    ));
  }, []);

  const alternarTodosLote = useCallback(() => {
    const validos = loteResultados.filter((item) => item.selecionavel).map((item) => item.chave);
    setLoteSelecionados((atuais) => (
      validos.length && validos.every((chave) => atuais.includes(chave)) ? [] : validos
    ));
  }, [loteResultados]);

  const usarCteDoLote = useCallback((cte) => {
    if (!cte) return;
    setCteSelecionado(cte);
    setCtesEncontrados([cte]);
    const sugestoes = sugerirViagensPorCte(baseFluxo.cargas, cte, vinculos);
    setSugestoesViagens(sugestoes);
    if (sugestoes.length) {
      setViagemSelecionada(sugestoes[0].viagem);
      setMensagem('CT-e selecionado no lote. Sugestão de viagem aplicada; revise antes de vincular.');
    } else {
      setMensagem('CT-e selecionado no lote. Nenhuma viagem provável encontrada no realizado.');
    }
  }, [baseFluxo.cargas, vinculos]);

  const salvarVinculosState = useCallback(async (novos) => {
    const adaptados = (novos || []).filter((item) => item.nomeRealizado && item.nomeCteTabela);
    setVinculos(adaptados);
    salvarVinculos(adaptados);
    setSalvandoVinculos(true);
    try {
      const resultado = await salvarVinculosTransportadoras(adaptados.map(vinculoAuditoriaParaGlobal));
      const salvos = (resultado.vinculos || []).map(vinculoGlobalParaAuditoria).filter((item) => item.nomeRealizado && item.nomeCteTabela);
      if (salvos.length) {
        setVinculos(salvos);
        salvarVinculos(salvos);
      }
      setFonteVinculos(resultado.modo || 'supabase');
      setMensagem(`Vínculos de transportadora salvos em ${resultado.modo === 'supabase' ? 'Supabase' : 'localStorage'}.`);
    } catch (error) {
      setFonteVinculos('local');
      setMensagem(`Vínculos salvos localmente, mas não no Supabase: ${error.message || String(error)}`);
    } finally {
      setSalvandoVinculos(false);
    }
  }, []);

  const removerVinculoState = useCallback(async (id) => {
    const alvo = (vinculos || []).find((item) => String(item.id) === String(id));
    const restantes = (vinculos || []).filter((item) => String(item.id) !== String(id));
    setVinculos(restantes);
    salvarVinculos(restantes);
    setSalvandoVinculos(true);
    try {
      await removerVinculoTransportadora(alvo?.nomeCteTabela || id, (vinculos || []).map(vinculoAuditoriaParaGlobal));
      setFonteVinculos('supabase');
      setMensagem('Vínculo removido do Supabase.');
    } catch (error) {
      setFonteVinculos('local');
      setMensagem(`Vínculo removido localmente, mas não no Supabase: ${error.message || String(error)}`);
    } finally {
      setSalvandoVinculos(false);
    }
  }, [vinculos]);

  // ── Registrar lançamento (vincular CT-e à viagem consolidada) ──
  const registrarLancamento = useCallback(async (form) => {
    if (!viagemParaAuditoria) return;
    setSalvando(true);
    setMensagem('');
    try {
      const lancConsolidados = reKeyLancamentosPorViagem(lancamentos);
      const lancamento = criarLancamentoAuditoria(viagemParaAuditoria, form, lancConsolidados, solicitacoes);

      const lancamentoComAuditor = {
        ...lancamento,
        auditedByUserId: form.auditedByUserId || usuarioAtual?.id || '',
        auditedByName: form.auditedByName || usuarioAtual?.nome || '',
        auditedByEmail: form.auditedByEmail || usuarioAtual?.email || '',
        auditedAt: form.auditedAt || new Date().toISOString(),
        auditStatus: form.auditStatus || (lancamento.excedente > 0 ? 'EXCEDEU_AGUARDANDO_OPERACAO' : 'AUDITADO_OK'),
        auditExceededAmount: form.auditExceededAmount ?? lancamento.excedente,
        auditAllowedAmount: form.auditAllowedAmount ?? 0,
        auditEnteredAmount: form.auditEnteredAmount ?? lancamento.valorLancado,
        observacao: form.observacao || '',
        origemTela: 'AUDITORIA_LOTACAO',
      };

      const novosLancamentos = [lancamentoComAuditor, ...lancamentos];
      salvarLancamentosAuditoria(novosLancamentos);
      setLancamentos(novosLancamentos);

      try {
        await salvarLancamentoAuditoriaSupabase(lancamentoComAuditor);
      } catch (error) {
        console.warn('[Auditoria] Lançamento salvo localmente; falha no Supabase:', error.message);
      }

      if (lancamentoComAuditor.excedente > 0) {
        const solicitacao = criarSolicitacaoPagamento(viagemParaAuditoria, lancamentoComAuditor);
        const pendenciaId = globalThis.crypto?.randomUUID?.();
        const solicitacaoComAuditor = {
          ...solicitacao,
          auditedByName: lancamentoComAuditor.auditedByName,
          auditedByEmail: lancamentoComAuditor.auditedByEmail,
          auditedAt: lancamentoComAuditor.auditedAt,
          observation: lancamentoComAuditor.observacao,
          status: 'EXCEDEU_AGUARDANDO_OPERACAO',
        };
        const novasSolicitacoes = [solicitacaoComAuditor, ...solicitacoes];
        salvarSolicitacoesPagamento(novasSolicitacoes);
        setSolicitacoes(novasSolicitacoes);

        try { await salvarSolicitacaoSupabase(solicitacaoComAuditor); }
        catch (error) { console.warn('[Auditoria] Solicitação salva localmente; falha no Supabase:', error.message); }

        try {
          await salvarPendenciaAuditoriaSupabase({
            id: pendenciaId,
            lancamentoId: lancamentoComAuditor.id,
            dist: viagemParaAuditoria.dist,
            distKey: viagemParaAuditoria.distKey,
            cte: lancamentoComAuditor.cte,
            fatura: lancamentoComAuditor.fatura,
            transportadora: viagemParaAuditoria.transportadora,
            cargaId: viagemParaAuditoria.id,
            valorLancado: lancamentoComAuditor.valorLancado,
            valorAutorizado: lancamentoComAuditor.saldoAnterior,
            valorExcedente: lancamentoComAuditor.excedente,
            valorOriginal: Number(viagemParaAuditoria.valorComparacao) || 0,
            valorAdicionalAprovado: 0,
            valorFinalAutorizado: Number(viagemParaAuditoria.valorComparacao) || 0,
            prazoOperacaoEm: adicionarHorasIso(lancamentoComAuditor.auditedAt, 24),
            status: 'EXCEDEU_AGUARDANDO_OPERACAO',
            auditedByUserId: lancamentoComAuditor.auditedByUserId,
            auditedByName: lancamentoComAuditor.auditedByName,
            auditedByEmail: lancamentoComAuditor.auditedByEmail,
            auditedAt: lancamentoComAuditor.auditedAt,
            observation: lancamentoComAuditor.observacao,
          });
          if (pendenciaId) {
            await registrarEventoHistoricoSupabase({
              pendenciaId,
              lancamentoId: lancamentoComAuditor.id,
              userId: lancamentoComAuditor.auditedByUserId,
              userName: lancamentoComAuditor.auditedByName,
              userEmail: lancamentoComAuditor.auditedByEmail,
              acao: 'ENVIADO_OPERACAO',
              statusAnterior: 'AUDITORIA',
              statusNovo: 'EXCEDEU_AGUARDANDO_OPERACAO',
              comentario: lancamentoComAuditor.observacao,
              origemTela: 'AUDITORIA_LOTACAO',
            });
          }
        } catch (error) {
          console.warn('[Auditoria] Pendência não registrada no painel novo:', error.message);
        }

        setMensagem('✓ CT-e vinculado e pendência criada para aprovação em Lotação Operação.');
      } else {
        setMensagem('✓ CT-e vinculado à viagem com sucesso.');
      }
    } catch (error) {
      setMensagem(`Erro ao registrar: ${error.message || String(error)}`);
    } finally {
      setSalvando(false);
    }
  }, [viagemParaAuditoria, lancamentos, solicitacoes, usuarioAtual]);

  const vincularLoteSelecionado = useCallback(async () => {
    if (!viagemParaAuditoria) {
      setMensagem('Selecione uma viagem consolidada antes de vincular o lote.');
      return;
    }
    const selecionadosSet = new Set(loteSelecionados);
    const itens = loteResultados.filter((item) => item.selecionavel && selecionadosSet.has(item.chave));
    if (!itens.length) {
      setMensagem('Selecione ao menos um CT-e válido para vincular.');
      return;
    }

    setSalvando(true);
    setMensagem('');

    const salvos = [];
    const falhas = [];
    let novosLancamentos = [...lancamentos];
    let novasSolicitacoes = [...solicitacoes];

    for (const item of itens) {
      try {
        const valorCte = numeroAuditoria(item.cte?.valor_cte);
        const numeroCte = item.cte?.numero_cte || item.chave;
        const lancConsolidados = reKeyLancamentosPorViagem(novosLancamentos);
        const lancamento = criarLancamentoAuditoria(viagemParaAuditoria, {
          cte: numeroCte,
          valorLancado: valorCte,
          fatura: '',
          observacao: 'Auditoria em lote por chaves CT-e',
        }, lancConsolidados, novasSolicitacoes);

        const lancamentoComAuditor = {
          ...lancamento,
          auditedByUserId: usuarioAtual?.id || '',
          auditedByName: usuarioAtual?.nome || '',
          auditedByEmail: usuarioAtual?.email || '',
          auditedAt: new Date().toISOString(),
          auditStatus: lancamento.excedente > 0 ? 'EXCEDEU_AGUARDANDO_OPERACAO' : 'AUDITADO_OK',
          auditExceededAmount: lancamento.excedente,
          auditAllowedAmount: lancamento.saldoAnterior,
          auditEnteredAmount: lancamento.valorLancado,
          observacao: 'Auditoria em lote por chaves CT-e',
          origemTela: 'AUDITORIA_LOTACAO',
        };

        novosLancamentos = [lancamentoComAuditor, ...novosLancamentos];
        try {
          await salvarLancamentoAuditoriaSupabase(lancamentoComAuditor);
        } catch (error) {
          console.warn('[Auditoria em lote] Lançamento salvo localmente; falha no Supabase:', error.message);
        }

        if (lancamentoComAuditor.excedente > 0) {
          const solicitacao = criarSolicitacaoPagamento(viagemParaAuditoria, lancamentoComAuditor);
          const pendenciaId = globalThis.crypto?.randomUUID?.();
          const solicitacaoComAuditor = {
            ...solicitacao,
            auditedByName: lancamentoComAuditor.auditedByName,
            auditedByEmail: lancamentoComAuditor.auditedByEmail,
            auditedAt: lancamentoComAuditor.auditedAt,
            observation: lancamentoComAuditor.observacao,
            status: 'EXCEDEU_AGUARDANDO_OPERACAO',
          };
          novasSolicitacoes = [solicitacaoComAuditor, ...novasSolicitacoes];

          try { await salvarSolicitacaoSupabase(solicitacaoComAuditor); }
          catch (error) { console.warn('[Auditoria em lote] Solicitação salva localmente; falha no Supabase:', error.message); }

          try {
            await salvarPendenciaAuditoriaSupabase({
              id: pendenciaId,
              lancamentoId: lancamentoComAuditor.id,
              dist: viagemParaAuditoria.dist,
              distKey: viagemParaAuditoria.distKey,
              cte: lancamentoComAuditor.cte,
              fatura: lancamentoComAuditor.fatura,
              transportadora: viagemParaAuditoria.transportadora,
              cargaId: viagemParaAuditoria.id,
              valorLancado: lancamentoComAuditor.valorLancado,
              valorAutorizado: lancamentoComAuditor.saldoAnterior,
              valorExcedente: lancamentoComAuditor.excedente,
              valorOriginal: Number(viagemParaAuditoria.valorComparacao) || 0,
              valorAdicionalAprovado: 0,
              valorFinalAutorizado: Number(viagemParaAuditoria.valorComparacao) || 0,
              prazoOperacaoEm: adicionarHorasIso(lancamentoComAuditor.auditedAt, 24),
              status: 'EXCEDEU_AGUARDANDO_OPERACAO',
              auditedByUserId: lancamentoComAuditor.auditedByUserId,
              auditedByName: lancamentoComAuditor.auditedByName,
              auditedByEmail: lancamentoComAuditor.auditedByEmail,
              auditedAt: lancamentoComAuditor.auditedAt,
              observation: lancamentoComAuditor.observacao,
            });
            if (pendenciaId) {
              await registrarEventoHistoricoSupabase({
                pendenciaId,
                lancamentoId: lancamentoComAuditor.id,
                userId: lancamentoComAuditor.auditedByUserId,
                userName: lancamentoComAuditor.auditedByName,
                userEmail: lancamentoComAuditor.auditedByEmail,
                acao: 'ENVIADO_OPERACAO',
                statusAnterior: 'AUDITORIA',
                statusNovo: 'EXCEDEU_AGUARDANDO_OPERACAO',
                comentario: lancamentoComAuditor.observacao,
                origemTela: 'AUDITORIA_LOTACAO',
              });
            }
          } catch (error) {
            console.warn('[Auditoria em lote] Pendência não registrada no painel novo:', error.message);
          }
        }

        salvos.push(item.chave);
      } catch (error) {
        falhas.push(`${item.cte?.numero_cte || item.chave}: ${error.message || String(error)}`);
      }
    }

    salvarLancamentosAuditoria(novosLancamentos);
    salvarSolicitacoesPagamento(novasSolicitacoes);
    setLancamentos(novosLancamentos);
    setSolicitacoes(novasSolicitacoes);
    setLoteSelecionados([]);
    setLoteResultados((atuais) => atuais.map((item) => (
      salvos.includes(item.chave)
        ? { ...item, status: 'JA_VINCULADO', statusLabel: 'já vinculado', selecionavel: false, observacao: 'Vinculado neste lote.' }
        : item
    )));
    setMensagem(
      falhas.length
        ? `Lote processado com ${salvos.length} vínculo(s) salvo(s) e ${falhas.length} falha(s): ${falhas.slice(0, 3).join(' | ')}`
        : `✓ ${salvos.length} CT-e(s) vinculado(s) à viagem com sucesso.`,
    );
    setSalvando(false);
  }, [viagemParaAuditoria, loteSelecionados, loteResultados, lancamentos, solicitacoes, usuarioAtual]);

  const totalCargas = baseFluxo.cargas?.length || 0;
  const pendenciasAbertas = (solicitacoes || []).filter((i) => i.status === 'PENDENTE' || i.status === 'EXCEDEU_AGUARDANDO_OPERACAO').length;

  return (
    <div className="page-shell lotacao-page lotacao-auditoria-page">
      <header className="page-top between">
        <div className="page-header">
          <span className="amd-mini-brand">Lotação · Auditoria</span>
          <h1>Auditoria Lotação</h1>
          <p>Central única de auditoria operacional: parta do CT-e ou do DIST, case com o realizado, consolide a viagem e controle o saldo.</p>
        </div>
        {usuarioAtual && (
          <div style={{ textAlign: 'right', fontSize: '0.85rem', opacity: 0.75 }}>
            <div><strong>{usuarioAtual.nome}</strong></div>
            <div>{usuarioAtual.email}</div>
          </div>
        )}
      </header>

      {(carregandoHistorico || carregandoAuditoria) && (
        <div className="hint-box compact">
          {carregandoHistorico ? 'Carregando histórico de cargas do Supabase...' : 'Carregando lançamentos e solicitações...'}
        </div>
      )}

      <PainelAuditoriaGeral lancamentos={lancamentos} solicitacoes={solicitacoes} totalCargas={totalCargas} fonteCargas={fonteCargas} />

      <AbasAuditoria ativa={abaAtiva} onMudar={setAbaAtiva} pendencias={pendenciasAbertas} />

      {abaAtiva === 'auditar' && (
        <>
          <div className="panel-card">
            <div className="section-row compact-top">
              <div>
                <div className="panel-title">Auditar</div>
                <p>Use buscas separadas: chave CT-e e número CT-e consultam a base de CT-es; DIST/HUB consulta somente o realizado.</p>
              </div>
            </div>

            <div className="form-grid three">
              <label className="field full-span">
                Buscar por chave CT-e
                <textarea
                  value={buscaChave}
                  onChange={(e) => {
                    setBuscaChave(e.target.value);
                    setLoteChavesTexto(e.target.value);
                    setLoteResultados([]);
                    setLoteSelecionados([]);
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); pesquisarLoteChaves(); } }}
                  placeholder="Cole uma ou várias chaves CT-e"
                  style={{ minHeight: 74 }}
                />
              </label>
            </div>
            <div className="actions-right">
              <button type="button" className="btn-primary" onClick={pesquisarLoteChaves} disabled={buscandoLote}>
                {buscandoLote ? 'Buscando...' : 'Buscar CT-e(s)'}
              </button>
            </div>

            <div className="form-grid three top-space-sm">
              <label className="field full-span">
                Buscar por número CT-e
                <input
                  value={buscaNumeroCte}
                  onChange={(e) => setBuscaNumeroCte(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') pesquisarPorNumeroCte(); }}
                  placeholder="Ex.: 69704"
                />
              </label>
            </div>
            <div className="actions-right">
              <button type="button" className="btn-secondary" onClick={pesquisarPorNumeroCte}>Buscar número CT-e</button>
            </div>

            <div className="form-grid three top-space-sm">
              <label className="field full-span">
                Buscar por DIST / viagem
                <input
                  value={buscaDist}
                  onChange={(e) => setBuscaDist(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') pesquisarPorDist(); }}
                  placeholder="Ex.: 12651, DIST-12651 ou HUB-12651"
                />
              </label>
            </div>
            <div className="actions-right">
              <button type="button" className="btn-secondary" onClick={pesquisarPorDist}>Buscar DIST / viagem</button>
            </div>

            {mensagem && <div className="hint-box compact">{mensagem}</div>}

            {(loteResultados.length > 0 || analiseLoteChaves.lidas > 0) && (
              <AuditoriaLoteCtes
                viagem={viagemParaAuditoria}
                lancamentos={lancamentos}
                texto={buscaChave}
                onTextoChange={(valor) => {
                  setBuscaChave(valor);
                  setLoteChavesTexto(valor);
                  setLoteResultados([]);
                  setLoteSelecionados([]);
                }}
                analise={analiseLoteChaves}
                resultados={loteResultados}
                selecionados={loteSelecionados}
                buscando={buscandoLote}
                salvando={salvando}
                onBuscar={pesquisarLoteChaves}
                onToggle={alternarSelecaoLote}
                onToggleTodos={alternarTodosLote}
                onVincular={vincularLoteSelecionado}
                onUsarCte={usarCteDoLote}
                sugestoesViagens={sugestoesViagens}
                onUsarViagem={setViagemSelecionada}
                mostrarEntrada={false}
              />
            )}

            {ctesEncontrados.length > 1 && (
              <div className="mini-list top-space-sm">
                {ctesEncontrados.map((cte) => (
                  <button
                    key={cte.id || cte.chave_cte || cte.numero_cte}
                    type="button"
                    className={cteSelecionado?.id === cte.id ? 'mini-list-row clickable active' : 'mini-list-row clickable'}
                    onClick={() => setCteSelecionado(cte)}
                  >
                    <span><strong>{cte.numero_cte || '-'}</strong> · {cte.transportadora || '-'} · {cte.cidade_origem || '-'} x {cte.cidade_destino || '-'}</span>
                    <strong>{formatarMoeda(cte.valor_cte)}</strong>
                  </button>
                ))}
              </div>
            )}

            <ListaViagens viagens={viagensResultado} selecionada={viagemSelecionada} onSelecionar={setViagemSelecionada} />
          </div>

          {cteSelecionado && <CardCteEncontrado cte={cteSelecionado} onUsar={setCteSelecionado} />}

          {cteSelecionado && (
            <div className="actions-right">
              <button type="button" className="btn-primary" onClick={buscarSugestoesNoRealizado} disabled={buscandoSugestoes}>
                {buscandoSugestoes ? 'Buscando...' : 'Buscar sugestões no realizado'}
              </button>
            </div>
          )}

          {cteSelecionado && sugestoesViagens.length > 0 && (
            <SugestoesViagens sugestoes={sugestoesViagens} onUsar={setViagemSelecionada} />
          )}

          {(cteSelecionado || viagemSelecionada) && <ValidacaoTabelaLotacao resultados={tabelaAplicavel} />}

          <ResumoViagemCard viagem={viagemParaAuditoria} lancamentos={lancamentos} cte={cteSelecionado} />
          <FormLancamento
            key={`${viagemParaAuditoria?.id || 'sem-viagem'}-${viagemParaAuditoria?.valorComparacao || 0}`}
            viagem={viagemParaAuditoria}
            lancamentos={lancamentos}
            solicitacoes={solicitacoes}
            onRegistrar={registrarLancamento}
            salvando={salvando}
            usuarioAtual={usuarioAtual}
            valorSugerido={cteSelecionado?.valor_cte}
            cteSugerido={cteSelecionado?.numero_cte}
          />
          <HistoricoLancamentos viagem={viagemParaAuditoria} lancamentos={lancamentos} />
          <MovimentosAutorizacao viagem={viagemParaAuditoria} solicitacoes={solicitacoes} />
        </>
      )}

      {abaAtiva === 'vinculos' && (
        <PainelVinculos
          vinculos={vinculos}
          onSalvar={salvarVinculosState}
          onRemover={removerVinculoState}
          sugestaoRealizado={viagemSelecionada?.transportadora || ''}
          sugestaoCte={cteSelecionado?.transportadora || cteSelecionado?.transportadora_contratada || ''}
          fonte={fonteVinculos}
          salvando={salvandoVinculos}
        />
      )}

      {abaAtiva === 'historico' && (
        <HistoricoPendencias lancamentos={lancamentos} solicitacoes={solicitacoes} />
      )}
    </div>
  );
}
