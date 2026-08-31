import React, { useEffect, useMemo, useState } from 'react';
import BaseCtesStatus from '../components/BaseCtesStatus';
import AmdProcessingOverlay, { ETAPA_LABEL_AUDITORIA, rotuloEtapaAuditoria } from '../components/AmdProcessingOverlay';
import CentralAuditoriaFretesPage from './CentralAuditoriaFretesPage';
import {
  carregarDadosAuditoria,
  calcularMetricasAuditoria,
  agruparPorTransportadora,
  calcularOndeAtacar,
  sugerirNovaMeta,
  avaliarMetaAuditoria,
  exportarAuditoriaExcel,
  exportarCtesDetalhadoExcel,
  carregarMetaAuditoria,
  salvarMetaAuditoria,
  salvarMesCarregadoAuditoria,
  salvarRecorteCarregadoAuditoria,
  TOGGLE_TABELAS_KEY,
  DIVERGENCIA_THRESHOLD,
  ehDivergenteComMargem,
} from '../services/auditoriaService';
import {
  carregarResultadosAuditoriaMes,
  carregarPreListaAuditoriaMes,
  carregarResumoAuditoriaMensal,
  carregarOpcoesPreFiltroAuditoria,
  enriquecerCtesComFaturas,
  enriquecerCtesComFaturasEmLotes,
  processarESalvarAuditoriaMes,
  resimularRegistros,
  invalidarCacheBaseFreteAuditoriaCte,
  buscarResultadosAuditoriaPorIdentificadores,
} from '../services/auditoriaCteProcessamentoService';
import { executarComFila, TAMANHO_LOTE_PESADO } from '../services/processamentoFilaService';
import {
  prepararArquivoLaudoAuditoriaCtes,
  baixarArquivoPreparado,
  cteDivergenteAuditoria,
  identificadorCteAuditoria,
} from '../utils/laudoAuditoriaCtes';
import {
  registrarLaudoGerado,
  buscarJornadaPorIdentificadores,
  atualizarStatusJornada,
  registrarDecisaoJornadaEmLote,
  anularJornada,
  vincularCancelamentoReemissao,
  gerarTokenAleatorio,
  urlPortalTransportadora,
  STATUS_OPERACIONAL,
  RESULTADOS_RETORNO_TRANSPORTADORA,
  JORNADA_COR,
} from '../services/auditoriaCteJornadaService';
import { carregarSessao, usuarioEhGestorAuditoria } from '../utils/authLocal';
import PainelPendenciasJornadaCte from '../components/PainelPendenciasJornadaCte';
import RespostasPortalPendentes from '../components/RespostasPortalPendentes';

const CRITERIOS_FILTRO = [
  { key: 'ok_qualquer', label: 'Dentro da tolerancia (AMD ou Verum)' },
  { key: 'ok_ambos', label: 'AMD e Verum dentro da tolerancia' },
  { key: 'sem_calculo', label: 'Sem cálculo nos dois' },
  { key: 'sem_verum', label: 'Sem cálculo Verum' },
  { key: 'sem_amd', label: 'Sem cálculo AMD/local' },
  { key: 'verum_ok', label: 'Verum bate o cobrado' },
  { key: 'amd_ok', label: 'AMD/local bate o cobrado' },
  { key: 'so_verum', label: 'Só Verum bateu' },
  { key: 'so_amd', label: 'Só AMD/local bateu' },
  { key: 'nenhum_bate', label: 'Nenhum bateu o cobrado' },
  { key: 'div_cobrado', label: 'AMD/local diverge do cobrado' },
  { key: 'div_verum', label: 'AMD/local diverge da Verum' },
];

function fmt(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtMaybe(v) {
  const n = Number(v);
  return Number.isFinite(n) ? fmt(n) : '—';
}

function fmtN(v, d = 0) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtP(v, d = 1) {
  return `${Number(v || 0).toFixed(d).replace('.', ',')}%`;
}

function fmtDataEmissaoAuditoria(row = {}) {
  const valor = String(row.data_emissao || row.emissao || row.dataEmissao || '').slice(0, 10);
  const partes = valor.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : (valor || '—');
}

function fmtPctDetalhe(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toFixed(2).replace('.', ',')}%` : '—';
}

function parseDetalhesCalculoAuditoria(valor) {
  if (!valor) return {};
  if (typeof valor === 'object') return valor;
  try { return JSON.parse(valor); } catch { return {}; }
}

function transportadoraValidadaAuditoria(row = {}) {
  if (typeof row.transportadora_validada_atual === 'boolean') return row.transportadora_validada_atual;
  const detalhes = parseDetalhesCalculoAuditoria(row.detalhes_calculo);
  return Boolean(row.origem_validada ?? detalhes.origem_validada ?? detalhes.tabela_validada);
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

function numeroValorNfAuditoria(item = {}) {
  const detalhes = parseDetalhesCalculoAuditoria(item.detalhes_calculo);
  const candidatos = [
    item.valor_nf,
    item.valorNF,
    item.nf_venda,
    item.valor_nota,
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

function temChaveNfAuditoria(item = {}) {
  const detalhes = parseDetalhesCalculoAuditoria(item.detalhes_calculo);
  const candidatos = [
    item.chave_nf_manual,
    item.chave_nfe_manual,
    item.chave_nfe,
    item.chaveNfe,
    item.chave_nf,
    item.chaveNf,
    detalhes.chave_nfe,
    detalhes.chaveNfe,
    detalhes.chave_nf,
    detalhes.chaveNf,
  ];
  return candidatos.some((valor) => String(valor || '').replace(/\D/g, '').length >= 30);
}

function auditoriaSemValorNf(item = {}) {
  return numeroValorNfAuditoria(item) <= 0 && !temChaveNfAuditoria(item);
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

function pesoCubadoSugeridoAuditoria(alt = {}, det = {}) {
  const cubagem = Number(alt.cubagem_aplicada || 0);
  const fator = Number(alt.fator_cubagem || 0);
  if (cubagem > 0 && fator > 0) return cubagem * fator;
  return Number(alt.peso_cubado_calculado || alt.peso_considerado || 0);
}

function pesoAlternativaAuditoria(alt = {}) {
  const peso = Number(alt.peso_considerado || 0);
  if (peso > 0) return peso;
  return pesoCubadoSugeridoAuditoria(alt);
}

const EXCLUIDAS_AUDITORIA_KEY = 'auditoria_cte_transportadoras_excluidas';
const FILTROS_FOCO_KEY = 'auditoria_cte_filtros_foco_v1';

// Carrega os filtros de foco salvos no navegador (volta vazio se não houver).
// Tomadores do grupo: já vêm marcados na primeira abertura porque é sobre eles
// que a auditoria trabalha no dia a dia. O auditor desmarca se quiser abrir.
const TOMADORES_ATALHO = ['CPX', 'ITR', 'GP PNEUS', 'SPEEDMAX', 'PNEUSTORE'];

function carregarFiltrosFocoSalvos() {
  const padrao = { transps: [], tomadores: [...TOMADORES_ATALHO], ufs: [], cidades: [], canais: [], criterios: [] };
  try {
    const bruto = localStorage.getItem(FILTROS_FOCO_KEY);
    // Só usa o padrão na primeira vez. Depois vale o que o auditor deixou
    // salvo — inclusive uma lista vazia, se ele desmarcou todos de propósito.
    if (!bruto) return padrao;
    const salvo = JSON.parse(bruto || '{}');
    const arr = (v) => (Array.isArray(v) ? v : []);
    return {
      transps: arr(salvo.transps),
      tomadores: arr(salvo.tomadores),
      ufs: arr(salvo.ufs),
      cidades: arr(salvo.cidades),
      canais: arr(salvo.canais),
      criterios: arr(salvo.criterios),
    };
  } catch {
    return padrao;
  }
}
const LIMITE_MATCH_VERUM = 1; // diferença (R$) tolerada para considerar recálculo == Verum
const MARGEM_ERRO_CIMA_KEY = 'central-fretes:auditoria-margem-erro-cima-valor';
const MARGEM_ERRO_BAIXO_KEY = 'central-fretes:auditoria-margem-erro-baixo-valor';
const MARGEM_ERRO_CIMA_PADRAO = 1;
const MARGEM_ERRO_BAIXO_PADRAO = 5;

function competenciaRegistroAuditoria(row = {}, fallback = '') {
  const direta = String(row.competencia || row.mes_competencia || fallback || '').slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(direta)) return direta;
  const data = String(row.data_emissao || row.emissao || row.dataEmissao || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(data) ? data.slice(0, 7) : '';
}

// Mesma normalização usada em agruparPorTransportadora, para casar a exclusão.
function nomeTransportadoraAuditoria(r) {
  return String(r?.transportadora || 'Não informado').trim() || 'Não informado';
}

// Texto do tomador do CT-e (cobre os apelidos de coluna da base/resultado salvo).
function nomeTomadorAuditoria(r) {
  const bruto = r?.tomador_servico ?? r?.tomadorServico ?? r?.tomador ?? r?.nome_tomador ?? '';
  return String(bruto || 'Não informado').trim() || 'Não informado';
}

// Normalização para casamento aproximado (sem acento, só A-Z0-9, maiúsculas).
function normTomador(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function semaforo(atual, meta) {
  if (atual >= meta) return { cor: '#16a34a', bg: '#dcfce7', label: '✓ Meta atingida' };
  if (atual >= meta * 0.9) return { cor: '#d97706', bg: '#fef3c7', label: '⚠ Próximo da meta' };
  return { cor: '#dc2626', bg: '#fee2e2', label: '✗ Abaixo da meta' };
}

function metaStatusStyle(status) {
  const map = {
    ok: { bg: '#dcfce7', color: '#166534', border: '#86efac' },
    cobertura: { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
    assertividade: { bg: '#fef3c7', color: '#92400e', border: '#fde68a' },
    critico: { bg: '#fee2e2', color: '#991b1b', border: '#fecaca' },
    sem_dados: { bg: '#f8fafc', color: '#475569', border: '#e2e8f0' },
  };
  return map[status] || map.sem_dados;
}

function BadgeSeveridade({ severidade }) {
  const map = {
    critico: { bg: '#fee2e2', color: '#dc2626', label: 'Crítico' },
    alto: { bg: '#fef3c7', color: '#b45309', label: 'Alto' },
    medio: { bg: '#e0f2fe', color: '#0369a1', label: 'Médio' },
    baixo: { bg: '#f0fdf4', color: '#16a34a', label: 'Baixo' },
  };
  const s = map[severidade] || map.baixo;
  return (
    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

function ToggleSwitch({ ativo, onChange, label, sublabel }) {
  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: 10,
        cursor: 'pointer',
        background: ativo ? '#eff6ff' : '#f8fafc',
        border: `2px solid ${ativo ? '#3b82f6' : '#e2e8f0'}`,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        userSelect: 'none',
      }}
      onClick={onChange}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onChange();
      }}
    >
      <div style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        background: ativo ? '#3b82f6' : '#cbd5e1',
        position: 'relative',
        flexShrink: 0,
        transition: 'background 0.2s',
      }}>
        <div style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#fff',
          position: 'absolute',
          top: 3,
          left: ativo ? 23 : 3,
          transition: 'left 0.2s',
        }} />
      </div>
      <div>
        <div style={{ fontWeight: 700, color: ativo ? '#1d4ed8' : '#374151', fontSize: 14 }}>{label}</div>
        {sublabel ? <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{sublabel}</div> : null}
      </div>
    </div>
  );
}

// Sobrepõe, em cima da base crua, os campos já calculados/salvos em
// auditoria_cte_resultados (por chave_cte, com numero_cte como fallback).
// CT-es sem correspondência salva ficam com o que vier da base crua mesmo.
function mesclarComResultadosSalvos(brutos = [], salvos = []) {
  const porChave = new Map();
  const porNumero = new Map();
  salvos.forEach((s) => {
    if (s.chave_cte) porChave.set(s.chave_cte, s);
    else if (s.numero_cte) porNumero.set(s.numero_cte, s);
  });
  return brutos.map((row) => {
    const salvo = (row.chave_cte && porChave.get(row.chave_cte))
      || (!row.chave_cte && row.numero_cte ? porNumero.get(row.numero_cte) : null);
    return salvo ? { ...row, ...salvo, id: row.id } : row;
  });
}

// Barra de progresso das operações (carregar/recalcular/resimular/salvar).
// Determinada quando há total conhecido; indeterminada (animada) quando não há.
function BarraProgresso({ progresso }) {
  if (!progresso) return null;

  const etapaLabel = ETAPA_LABEL_AUDITORIA;
  const carregados = Number(progresso.carregados || 0);
  const total = Number(progresso.total || 0);
  const aguardandoFila = progresso.etapa === 'aguardando_fila';
  const determinada = total > 0;
  const pct = determinada ? Math.min(100, Math.round((carregados / total) * 100)) : 0;
  const etapa = etapaLabel[progresso.etapa]
    || String(progresso.etapa || 'Processando').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, background: '#eff6ff', border: '1px solid #bfdbfe' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1d4ed8' }}>{etapa}…</span>
        <span style={{ fontSize: 12, color: '#475569' }}>
          {aguardandoFila
            ? `posição ${Number(progresso.posicao || 1)} na fila`
            : determinada
            ? `${carregados.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')} · ${pct}%`
            : 'aguardando resposta do banco'}
        </span>
      </div>
      <div style={{ position: 'relative', height: 10, borderRadius: 999, background: '#dbeafe', overflow: 'hidden' }}>
        {determinada ? (
          <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: '#2563eb', transition: 'width 0.3s' }} />
        ) : (
          <div className="auditoria-progress-indeterminate" style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: '35%', borderRadius: 999, background: '#2563eb' }} />
        )}
      </div>
      {aguardandoFila && Array.isArray(progresso.emAndamento) && progresso.emAndamento.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#475569' }}>
          Esperando liberar espaço. Rodando agora:
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {progresso.emAndamento.map((tarefa, i) => {
              const t = Number(tarefa.total_itens || 0);
              const f = Number(tarefa.itens_processados || 0);
              return (
                <li key={i}>
                  <strong>{tarefa.usuario_nome || 'alguém'}</strong> · {tarefa.titulo}
                  {t ? ` · ${f.toLocaleString('pt-BR')}/${t.toLocaleString('pt-BR')}` : ''}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <style>{`@keyframes auditoriaProgressSlide{0%{left:-35%}100%{left:100%}}.auditoria-progress-indeterminate{animation:auditoriaProgressSlide 1.1s ease-in-out infinite}`}</style>
    </div>
  );
}

function BarraMeta({ atual, meta, cor }) {
  return (
    <div style={{ marginTop: 8, background: '#e2e8f0', borderRadius: 4, height: 8, position: 'relative' }}>
      <div style={{ position: 'absolute', top: -4, left: `${Math.min(meta, 100)}%`, width: 2, height: 16, background: '#64748b', borderRadius: 1 }} />
      <div style={{ width: `${Math.min(atual, 100)}%`, background: cor, borderRadius: 4, height: 8, transition: 'width 0.5s' }} />
    </div>
  );
}

// Lista de seleção múltipla com busca. Usada nos filtros de foco para marcar
// várias transportadoras / cidades de origem ao mesmo tempo.
function MultiCheckList({ titulo, opcoes, selecionados, onToggle, onLimpar, busca, onBusca, placeholder, maxAltura = 170, recolhivel = false }) {
  const [aberto, setAberto] = useState(!recolhivel);
  const selSet = new Set(selecionados);
  const buscaNorm = (busca || '').trim().toLowerCase();
  const filtradas = buscaNorm
    ? opcoes.filter((o) => o.label.toLowerCase().includes(buscaNorm))
    : opcoes;

  return (
    <div style={{ flex: '1 1 240px', minWidth: 220 }}>
      <div
        role={recolhivel ? 'button' : undefined}
        tabIndex={recolhivel ? 0 : undefined}
        onClick={recolhivel ? () => setAberto((valor) => !valor) : undefined}
        onKeyDown={recolhivel ? (event) => { if (event.key === 'Enter' || event.key === ' ') setAberto((valor) => !valor); } : undefined}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: aberto ? 6 : 0, padding: recolhivel ? '9px 11px' : 0, border: recolhivel ? '1px solid #cbd5e1' : 'none', borderRadius: recolhivel ? 7 : 0, background: recolhivel ? '#fff' : 'transparent', cursor: recolhivel ? 'pointer' : 'default' }}
      >
        <span style={{ fontSize: 12, color: selecionados.length ? '#1d4ed8' : '#475569', fontWeight: 700 }}>
          {titulo}{selecionados.length ? ` (${selecionados.length})` : ''}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {selecionados.length ? (
          <button type="button" onClick={(event) => { event.stopPropagation(); onLimpar(); }} style={{ border: 'none', background: 'none', color: '#2563eb', fontSize: 11, cursor: 'pointer', padding: 0 }}>
            limpar
          </button>
        ) : null}
        {recolhivel ? <span aria-hidden="true" style={{ color: '#64748b', fontSize: 12 }}>{aberto ? '▲' : '▼'}</span> : null}
        </span>
      </div>
      {aberto && onBusca ? (
        <input
          type="text"
          placeholder={placeholder}
          value={busca}
          onChange={(e) => onBusca(e.target.value)}
          style={{ width: '100%', padding: '5px 8px', border: '1px solid #cbd5e1', borderRadius: 6, marginBottom: 6, fontSize: 12 }}
        />
      ) : null}
      {aberto ? <div style={{ maxHeight: maxAltura, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 6, padding: 6, background: '#fff' }}>
        {filtradas.slice(0, 300).map((o) => {
          const marcada = selSet.has(o.value);
          return (
            <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px', cursor: 'pointer', borderRadius: 4, background: marcada ? '#eff6ff' : 'transparent' }}>
              <input type="checkbox" checked={marcada} onChange={() => onToggle(o.value)} />
              <span style={{ fontSize: 12, fontWeight: marcada ? 700 : 500, color: marcada ? '#1d4ed8' : '#334155' }}>{o.label}</span>
              {o.sub ? <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>{o.sub}</span> : null}
            </label>
          );
        })}
        {!filtradas.length ? <div style={{ fontSize: 12, color: '#94a3b8', padding: 4 }}>Nada encontrado.</div> : null}
        {filtradas.length > 300 ? <div style={{ fontSize: 11, color: '#94a3b8', padding: 4 }}>Mostrando 300 de {filtradas.length}. Refine a busca.</div> : null}
      </div> : null}
    </div>
  );
}

function DiagnosticoFontes({ diagnostico = [] }) {
  if (!diagnostico.length) return null;

  return (
    <section className="sim-card">
      <h2>Diagnóstico da consulta</h2>
      <p style={{ color: '#64748b', marginTop: -4 }}>
        A tela tenta primeiro a base do módulo CT-e e, se não encontrar dados, usa fallback por competência e bases legadas/enxutas.
      </p>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>Fonte</th>
              <th>Filtro</th>
              <th>Total</th>
              <th>Calculados</th>
              <th>Sem cálculo</th>
              <th>Erro</th>
            </tr>
          </thead>
          <tbody>
            {diagnostico.map((item, index) => (
              <tr key={`${item.fonte}-${item.filtro}-${index}`}>
                <td>
                  <strong>{item.label || item.tabela}</strong>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{item.tabela}</div>
                </td>
                <td>{item.filtro}</td>
                <td>{fmtN(item.total)}</td>
                <td>{fmtN(item.calculados)}</td>
                <td style={{ color: item.semCalculo > 0 ? '#dc2626' : '#94a3b8', fontWeight: item.semCalculo > 0 ? 700 : 400 }}>
                  {fmtN(item.semCalculo)}
                </td>
                <td style={{ color: item.erro ? '#dc2626' : '#94a3b8' }}>{item.erro || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ResumoMensalAuditoria({ resumoMensal = [] }) {
  if (!resumoMensal.length) return null;

  return (
    <section className="sim-card">
      <h2>Resumo mensal salvo</h2>
      <p style={{ color: '#64748b', marginTop: -4 }}>
        Comparativo mês a mês carregado da tabela <code>auditoria_cte_resumo_mensal</code>.
      </p>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>Competência</th>
              <th>Total CTes</th>
              <th>Calculados</th>
              <th>Sem cálculo</th>
              <th>Assertivos</th>
              <th>Divergentes</th>
              <th>% Cálculo</th>
              <th>% Assertividade</th>
              <th>Valor CT-e</th>
              <th>Valor calculado</th>
              <th>Divergência</th>
            </tr>
          </thead>
          <tbody>
            {resumoMensal.map((item) => (
              <tr key={item.competencia}>
                <td><strong>{item.competencia}</strong></td>
                <td>{fmtN(item.total_ctes)}</td>
                <td>{fmtN(item.calculados)}</td>
                <td>{fmtN(item.sem_calculo)}</td>
                <td>{fmtN(item.assertivos)}</td>
                <td>{fmtN(item.divergentes)}</td>
                <td>{fmtP(item.taxa_calculo)}</td>
                <td>{fmtP(item.taxa_assertividade)}</td>
                <td>{fmt(item.valor_total_cte)}</td>
                <td>{fmt(item.valor_total_calculado)}</td>
                <td>{fmt(item.valor_total_divergencia)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function AuditoriaCtePage({ onMudarPagina, onAbrirTransportadoras } = {}) {
  const sessaoAtual = useMemo(() => carregarSessao(), []);
  const ehGestorAuditoria = usuarioEhGestorAuditoria(sessaoAtual);
  const [ocultarTaxasZeradas, setOcultarTaxasZeradas] = useState(false);
  const [abaAuditoria, setAbaAuditoria] = useState('mensal');
  const [competencia, setCompetencia] = useState('');
  // Período de teste opcional: limita a carga do "Carregar resultado salvo" a
  // alguns dias, para iterar rápido sem puxar o mês inteiro.
  const [dataInicioTeste, setDataInicioTeste] = useState('');
  const [dataFimTeste, setDataFimTeste] = useState('');
  const [registros, setRegistros] = useState([]);
  const [modoPreLista, setModoPreLista] = useState(false);
  const [fonteAuditoria, setFonteAuditoria] = useState(null);
  const [diagnostico, setDiagnostico] = useState([]);
  const [avisos, setAvisos] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [progressoProcessamento, setProgressoProcessamento] = useState(null);
  // Enquanto a cubagem do Tracking não está validada, o recálculo usa só o peso
  // do CT-e (ignora peso cubado). Mesmo flag/lógica do Simulador Realizado.
  const [usarPesoCteAuditoria, setUsarPesoCteAuditoria] = useState(true);
  const [percentualContingenciaPesoAuditoria, setPercentualContingenciaPesoAuditoria] = useState(0);
  // Padrão: usa só o que já está gravado na base (comportamento de sempre).
  // Desmarcando, cruza o Tracking ao vivo antes de calcular — igual ao Simulador.
  // Começa desmarcado: o dia a dia da auditoria precisa enxergar TODOS os CT-es
  // do recorte, não só os que já têm dados completos.
  const [apenasDadosCompletosAuditoria, setApenasDadosCompletosAuditoria] = useState(false);
  // Margem de erro tolerada antes de marcar um CT-e como divergente, em R$
  // absoluto (não percentual — percentual escala com o valor do CT-e e esconde
  // divergência grande em fretes caros). 0 em ambos = usa o limite fixo padrão
  // (R$ 0,05). Cima = cobrança acima do calculado; baixo = cobrança abaixo.
  // Fica salva no navegador e vale pra todos os cálculos seguintes.
  const [margemErroCimaValor, setMargemErroCimaValor] = useState(() => {
    try {
      const salvo = localStorage.getItem(MARGEM_ERRO_CIMA_KEY);
      return salvo == null ? MARGEM_ERRO_CIMA_PADRAO : JSON.parse(salvo);
    } catch { return MARGEM_ERRO_CIMA_PADRAO; }
  });
  const [margemErroBaixoValor, setMargemErroBaixoValor] = useState(() => {
    try {
      const salvo = localStorage.getItem(MARGEM_ERRO_BAIXO_KEY);
      return salvo == null ? MARGEM_ERRO_BAIXO_PADRAO : JSON.parse(salvo);
    } catch { return MARGEM_ERRO_BAIXO_PADRAO; }
  });
  const [mostrarTolerancia, setMostrarTolerancia] = useState(false);
  const atualizarMargemErroCima = (valor) => {
    setMargemErroCimaValor(valor);
    try { localStorage.setItem(MARGEM_ERRO_CIMA_KEY, JSON.stringify(valor)); } catch { /* localStorage indisponível */ }
  };
  const atualizarMargemErroBaixo = (valor) => {
    setMargemErroBaixoValor(valor);
    try { localStorage.setItem(MARGEM_ERRO_BAIXO_KEY, JSON.stringify(valor)); } catch { /* localStorage indisponível */ }
  };
  const margensDivergencia = useMemo(
    () => ({ cimaValor: margemErroCimaValor, baixoValor: margemErroBaixoValor }),
    [margemErroCimaValor, margemErroBaixoValor],
  );
  const [resumoMensal, setResumoMensal] = useState([]);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [ctesSelecionadosLaudo, setCtesSelecionadosLaudo] = useState([]);
  const [mostrarCobrancaAMenorLaudo, setMostrarCobrancaAMenorLaudo] = useState(false);

  const [usarTabelas, setUsarTabelas] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(TOGGLE_TABELAS_KEY) || 'false');
    } catch {
      return false;
    }
  });

  const [meta, setMeta] = useState(carregarMetaAuditoria);
  const [editandoMeta, setEditandoMeta] = useState(false);
  const [metaTemp, setMetaTemp] = useState(meta);

  // Transportadoras fora da análise (ex.: lotação que só calcula após vínculo
  // na Auditoria Lotação). A escolha fica salva e as métricas as ignoram.
  const [excluidas, setExcluidas] = useState(() => {
    try {
      const salvo = JSON.parse(localStorage.getItem(EXCLUIDAS_AUDITORIA_KEY) || '[]');
      return Array.isArray(salvo) ? salvo : [];
    } catch {
      return [];
    }
  });
  const [filtroBuscaExcluir, setFiltroBuscaExcluir] = useState('');

  // Seções secundárias recolhidas por padrão para despoluir a tela.
  const [mostrarAvancado, setMostrarAvancado] = useState(false);

  // Filtro pré-carga de canal: aplicado na query para trazer só os CTes do canal selecionado.
  const [canaisPreCarga, setCanaisPreCarga] = useState([]);
  const [transportadorasPreCargaSelecionadas, setTransportadorasPreCargaSelecionadas] = useState([]);
  const [auditoresPreCargaSelecionados, setAuditoresPreCargaSelecionados] = useState([]);
  const [buscaTransportadoraPreCarga, setBuscaTransportadoraPreCarga] = useState('');
  const [buscaAuditorPreCarga, setBuscaAuditorPreCarga] = useState('');
  const [opcoesPreCarga, setOpcoesPreCarga] = useState({ carteiras: [], vinculos: [], transportadoras: [], auditores: [] });
  const [erroOpcoesPreCarga, setErroOpcoesPreCarga] = useState('');
  const [tentativaOpcoesPreCarga, setTentativaOpcoesPreCarga] = useState(0);

  // Filtros de foco: para identificar onde agir (ajuste de tabela) e, depois,
  // recalcular só o subconjunto. Combina transportadora + origem + critério de erro.
  const [mostrarFiltros, setMostrarFiltros] = useState(false);
  const filtrosSalvos = useMemo(carregarFiltrosFocoSalvos, []);
  const [filtroTransps, setFiltroTransps] = useState(filtrosSalvos.transps);
  const [filtroTomadores, setFiltroTomadores] = useState(filtrosSalvos.tomadores);
  const [filtroUfs, setFiltroUfs] = useState(filtrosSalvos.ufs);
  const [filtroCidades, setFiltroCidades] = useState(filtrosSalvos.cidades);
  const [filtroCanais, setFiltroCanais] = useState(filtrosSalvos.canais);
  const [filtroCriterios, setFiltroCriterios] = useState(filtrosSalvos.criterios); // vazio = todos
  const [filtroSituacaoFatura, setFiltroSituacaoFatura] = useState([]);
  const [filtroJornada, setFiltroJornada] = useState(null); // { label, chaves: Set<string> } — vindo do painel de pendências
  const [jornadaPorChave, setJornadaPorChave] = useState(new Map());
  const [jornadaEditando, setJornadaEditando] = useState(null); // chave_cte em edição no mini-formulário de retorno
  const [jornadaForm, setJornadaForm] = useState({ resultado: 'concordou_desconto', valorAcordado: '', observacao: '' });
  const [jornadaSalvando, setJornadaSalvando] = useState(false);
  const [anularMotivo, setAnularMotivo] = useState('');
  const [reemissaoForm, setReemissaoForm] = useState({ chaveSubstituto: '', motivo: '' });
  const [reemissaoSalvando, setReemissaoSalvando] = useState(false);
  const [modalLaudoAberto, setModalLaudoAberto] = useState(false);
  const [modalRetornoLoteAberto, setModalRetornoLoteAberto] = useState(false);
  const [laudosGerados, setLaudosGerados] = useState([]);
  // Incrementado sempre que a jornada muda, para o painel de pendências recarregar.
  const [jornadaVersao, setJornadaVersao] = useState(0);
  const [buscaTratamento, setBuscaTratamento] = useState('');
  const [buscaTranspFiltro, setBuscaTranspFiltro] = useState('');
  const [buscaTomadorFiltro, setBuscaTomadorFiltro] = useState('');
  const [buscaCidadeFiltro, setBuscaCidadeFiltro] = useState('');

  // Preview de resimulação (apenas em memória — não grava no banco).
  const [resimulando, setResimulando] = useState(false);
  const [resimuladoInfo, setResimuladoInfo] = useState('');
  const [resimuladoDiagnostico, setResimuladoDiagnostico] = useState([]);

  // Detalhe por CT-e: índice da linha expandida (detalhe do cálculo).
  const [cteExpandido, setCteExpandido] = useState(null);
  const [ordenacaoDetalhe, setOrdenacaoDetalhe] = useState('original');
  const [limiteDetalhe, setLimiteDetalhe] = useState(200);

  // Ao abrir a tela, já carrega a visão mês a mês (resumo mensal) — é leve
  // (1 linha por competência) e é a visão principal pra acompanhar o histórico.
  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const resumo = await carregarResumoAuditoriaMensal();
        if (ativo) setResumoMensal(resumo || []);
      } catch { /* silencioso no mount — botão manual continua disponível */ }
    })();
    return () => { ativo = false; };
  }, []);

  useEffect(() => {
    let ativo = true;
    setErroOpcoesPreCarga('');
    carregarOpcoesPreFiltroAuditoria()
      .then((opcoes) => { if (ativo) setOpcoesPreCarga(opcoes); })
      .catch((error) => { if (ativo) setErroOpcoesPreCarga(error.message || 'Não foi possível carregar transportadoras e auditores.'); });
    return () => { ativo = false; };
  }, [tentativaOpcoesPreCarga]);

  const transportadorasPreCarga = useMemo(() => {
    const porAuditor = [...new Set(opcoesPreCarga.carteiras
      .filter((item) => auditoresPreCargaSelecionados.includes(item.auditor_nome))
      .map((item) => item.transportadora)
      .filter(Boolean))];
    let canonicas;
    if (transportadorasPreCargaSelecionadas.length && auditoresPreCargaSelecionados.length) {
      const permitidas = new Set(porAuditor);
      canonicas = transportadorasPreCargaSelecionadas.filter((nome) => permitidas.has(nome));
    } else {
      canonicas = transportadorasPreCargaSelecionadas.length ? transportadorasPreCargaSelecionadas : porAuditor;
    }
    const selecionadas = new Set(canonicas);
    const aliases = opcoesPreCarga.vinculos
      .filter((item) => selecionadas.has(item.nome_tabela))
      .map((item) => item.nome_cte)
      .filter(Boolean);
    return [...new Set([...canonicas, ...aliases])];
  }, [auditoresPreCargaSelecionados, transportadorasPreCargaSelecionadas, opcoesPreCarga]);
  const filtroPreCargaSemCorrespondencia = Boolean(
    transportadorasPreCargaSelecionadas.length
    && auditoresPreCargaSelecionados.length
    && !transportadorasPreCarga.length,
  );

  // Persiste os filtros de foco no navegador a cada mudança (igual às exclusões).
  useEffect(() => {
    try {
      localStorage.setItem(FILTROS_FOCO_KEY, JSON.stringify({
        transps: filtroTransps,
        tomadores: filtroTomadores,
        ufs: filtroUfs,
        cidades: filtroCidades,
        canais: filtroCanais,
        criterios: filtroCriterios,
      }));
    } catch { /* ignora falha de storage */ }
  }, [filtroTransps, filtroTomadores, filtroUfs, filtroCidades, filtroCanais, filtroCriterios]);

  function toggleEmLista(setter) {
    return (valor) => setter((atuais) => (
      atuais.includes(valor) ? atuais.filter((v) => v !== valor) : [...atuais, valor]
    ));
  }

  function limparFiltrosFoco() {
    setFiltroTransps([]);
    setFiltroTomadores([]);
    setFiltroUfs([]);
    setFiltroCidades([]);
    setFiltroCanais([]);
    setFiltroCriterios([]);
    setFiltroSituacaoFatura([]);
  }

  function selecionarTransportadoraTratamento(nome) {
    const valor = String(nome || '').trim();
    setFiltroTransps(valor ? [valor] : []);
    setBuscaTratamento('');
    setFiltroTomadores([]);
    setFiltroUfs([]);
    setFiltroCidades([]);
    setFiltroCanais([]);
    setFiltroCriterios([]);
    setMostrarFiltros(false);
    setCteExpandido(null);
    setResimuladoInfo('');
    setResimuladoDiagnostico([]);
  }

  const filtrosAtivos = Boolean(
    filtroTransps.length || filtroTomadores.length || filtroUfs.length
    || filtroCidades.length || filtroCanais.length || filtroCriterios.length || filtroSituacaoFatura.length,
  );

  // Pode carregar/recalcular com competência OU período (datas) preenchido.
  const podeCarregar = Boolean(competencia || dataInicioTeste || dataFimTeste) && !filtroPreCargaSemCorrespondencia;
  const temPeriodoTeste = Boolean(dataInicioTeste || dataFimTeste);

  const excluidasSet = useMemo(() => new Set(excluidas), [excluidas]);

  function toggleExcluida(nome) {
    setExcluidas((atuais) => {
      const proximas = atuais.includes(nome)
        ? atuais.filter((n) => n !== nome)
        : [...atuais, nome];
      try {
        localStorage.setItem(EXCLUIDAS_AUDITORIA_KEY, JSON.stringify(proximas));
      } catch { /* ignora falha de storage */ }
      return proximas;
    });
  }

  function limparExcluidas() {
    setExcluidas([]);
    try {
      localStorage.setItem(EXCLUIDAS_AUDITORIA_KEY, '[]');
    } catch { /* ignora */ }
  }

  // Conjunto efetivamente analisado: tudo, menos as transportadoras excluídas.
  const registrosAnalise = useMemo(
    () => (excluidasSet.size ? registros.filter((r) => !excluidasSet.has(nomeTransportadoraAuditoria(r))) : registros),
    [registros, excluidasSet],
  );

  // Agrupamento completo (base inteira) para a lista de seleção do filtro.
  const porTransportadoraCompleto = useMemo(() => agruparPorTransportadora(registros, margensDivergencia), [registros, margensDivergencia]);
  const transportadorasExcluidas = useMemo(
    () => porTransportadoraCompleto.filter((it) => excluidasSet.has(it.transportadora)),
    [porTransportadoraCompleto, excluidasSet],
  );
  const ctesExcluidos = useMemo(
    () => transportadorasExcluidas.reduce((acc, it) => acc + it.total, 0),
    [transportadorasExcluidas],
  );

  // UFs de origem disponíveis para o filtro de foco.
  const ufsDisponiveis = useMemo(() => {
    const set = new Set();
    for (const r of registrosAnalise) {
      const uf = String(r.uf_origem || r.ufOrigem || '').trim().toUpperCase();
      if (uf) set.add(uf);
    }
    return Array.from(set).sort();
  }, [registrosAnalise]);

  // Cidades de origem disponíveis (com contagem) para o filtro de foco.
  const cidadesDisponiveis = useMemo(() => {
    const mapa = new Map();
    for (const r of registrosAnalise) {
      const cidade = String(r.cidade_origem || r.origem || '').trim().toUpperCase();
      if (cidade) mapa.set(cidade, (mapa.get(cidade) || 0) + 1);
    }
    return Array.from(mapa.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([value, qtd]) => ({ value, label: value, sub: `${fmtN(qtd)}` }));
  }, [registrosAnalise]);

  // Canais disponíveis (com contagem) para o filtro de foco.
  const canaisDisponiveis = useMemo(() => {
    const mapa = new Map();
    for (const r of registrosAnalise) {
      const canal = String(r.canal || r.canal_original || '').trim().toUpperCase() || 'NÃO INFORMADO';
      mapa.set(canal, (mapa.get(canal) || 0) + 1);
    }
    return Array.from(mapa.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([value, qtd]) => ({ value, label: value, sub: `${fmtN(qtd)}` }));
  }, [registrosAnalise]);

  // Tomadores disponíveis (com contagem) para o filtro de foco.
  const tomadoresDisponiveis = useMemo(() => {
    const mapa = new Map();
    for (const r of registrosAnalise) {
      const nome = nomeTomadorAuditoria(r);
      mapa.set(nome, (mapa.get(nome) || 0) + 1);
    }
    return Array.from(mapa.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([value, qtd]) => ({ value, label: value, sub: `${fmtN(qtd)}` }));
  }, [registrosAnalise]);

  // Atalhos de tomadores frequentes (casamento por "contém", aproximado).
  // A lista fica no topo do arquivo porque também é o padrão inicial do filtro.

  // Transportadoras disponíveis (com contagem) para o filtro de foco.
  const transportadorasOpcoes = useMemo(
    () => porTransportadoraCompleto
      .filter((it) => !excluidasSet.has(it.transportadora))
      .map((it) => ({ value: it.transportadora, label: it.transportadora, sub: `${fmtN(it.total)}` })),
    [porTransportadoraCompleto, excluidasSet],
  );

  const transportadorasTratamentoFiltradas = useMemo(() => {
    const termo = buscaTratamento.trim().toLowerCase();
    const lista = termo
      ? transportadorasOpcoes.filter((item) => item.label.toLowerCase().includes(termo))
      : transportadorasOpcoes;
    return lista.slice(0, 12);
  }, [buscaTratamento, transportadorasOpcoes]);

  // Aplica os filtros de foco (transportadoras + UFs + cidades + critérios de erro),
  // todos multi-seleção. Dentro de cada dimensão é OR; entre dimensões é AND.
  const registrosFiltro = useMemo(() => {
    if (!filtrosAtivos) return registrosAnalise;
    const transpSet = new Set(filtroTransps);
    const ufSet = new Set(filtroUfs);
    const cidSet = new Set(filtroCidades);
    const canalSet = new Set(filtroCanais);
    const critSet = new Set(filtroCriterios);
    const faturaSet = new Set(filtroSituacaoFatura);
    // Tomadores selecionados em forma normalizada para casar por "contém".
    const tomadoresNorm = filtroTomadores.map(normTomador).filter(Boolean);
    return registrosAnalise.filter((r) => {
      if (filtroJornada?.chaves?.size) {
        const chave = String(r.chave_cte || r.chaveCte || '');
        if (!filtroJornada.chaves.has(chave)) return false;
      }
      if (transpSet.size && !transpSet.has(nomeTransportadoraAuditoria(r))) return false;
      if (tomadoresNorm.length) {
        const tomadorReg = normTomador(nomeTomadorAuditoria(r));
        const casa = tomadoresNorm.some((sel) => tomadorReg.includes(sel) || sel.includes(tomadorReg));
        if (!casa) return false;
      }
      if (ufSet.size && !ufSet.has(String(r.uf_origem || r.ufOrigem || '').trim().toUpperCase())) return false;
      if (cidSet.size && !cidSet.has(String(r.cidade_origem || r.origem || '').trim().toUpperCase())) return false;
      if (canalSet.size) {
        const canal = String(r.canal || r.canal_original || '').trim().toUpperCase() || 'NÃO INFORMADO';
        if (!canalSet.has(canal)) return false;
      }
      if (faturaSet.size) {
        const situacao = r.tem_fatura ? 'com_fatura' : 'sem_fatura';
        if (!faturaSet.has(situacao)) return false;
      }
      if (critSet.size) {
        const vc = Number(r.valor_cte || 0);
        const rec = Number(r.valor_calculado || 0);
        const ver = Number(r.valor_calculado_verum || 0);
        const okRec = rec > 0 && !ehDivergenteComMargem(vc - rec, rec, margensDivergencia);
        const okVer = ver > 0 && !ehDivergenteComMargem(vc - ver, ver, margensDivergencia);
        const semCalc = rec <= 0 && ver <= 0;
        const semVerum = ver <= 0;
        const semAmd = rec <= 0;
        const divCobrado = rec > 0 && ehDivergenteComMargem(vc - rec, rec, margensDivergencia);
        const divVerum = rec > 0 && ver > 0 && ehDivergenteComMargem(rec - ver, ver, margensDivergencia);
        const passa = (critSet.has('sem_calculo') && semCalc)
          || (critSet.has('ok_qualquer') && (okRec || okVer))
          || (critSet.has('ok_ambos') && okRec && okVer)
          || (critSet.has('sem_verum') && semVerum)
          || (critSet.has('sem_amd') && semAmd)
          || (critSet.has('verum_ok') && okVer)
          || (critSet.has('amd_ok') && okRec)
          || (critSet.has('so_verum') && okVer && !okRec)
          || (critSet.has('so_amd') && okRec && !okVer)
          || (critSet.has('nenhum_bate') && !okRec && !okVer && (rec > 0 || ver > 0))
          || (critSet.has('div_cobrado') && divCobrado)
          || (critSet.has('div_verum') && divVerum);
        if (!passa) return false;
      }
      return true;
    });
  }, [registrosAnalise, filtrosAtivos, filtroTransps, filtroTomadores, filtroUfs, filtroCidades, filtroCanais, filtroCriterios, filtroSituacaoFatura, filtroJornada, margensDivergencia]);

  const registrosDetalheOrdenados = useMemo(() => {
    const valorDifAmd = (r) => Math.abs(Number(r.diferenca ?? ((Number(r.valor_cte || 0) || 0) - (Number(r.valor_calculado || 0) || 0))));
    const valorDifVerum = (r) => Math.abs(Number(r.diferenca_verum ?? ((Number(r.valor_cte || 0) || 0) - (Number(r.valor_calculado_verum || 0) || 0))));
    const lista = [...registrosFiltro];
    const comparadores = {
      original: null,
      dif_amd_desc: (a, b) => valorDifAmd(b) - valorDifAmd(a),
      dif_amd_asc: (a, b) => valorDifAmd(a) - valorDifAmd(b),
      dif_verum_desc: (a, b) => valorDifVerum(b) - valorDifVerum(a),
      dif_verum_asc: (a, b) => valorDifVerum(a) - valorDifVerum(b),
      frete_pago_desc: (a, b) => Number(b.valor_cte || 0) - Number(a.valor_cte || 0),
      peso_desc: (a, b) => Number(b.peso || 0) - Number(a.peso || 0),
      cte_asc: (a, b) => String(a.numero_cte || a.chave_cte || '').localeCompare(String(b.numero_cte || b.chave_cte || ''), 'pt-BR', { numeric: true }),
    };
    const comparador = comparadores[ordenacaoDetalhe];
    return comparador ? lista.sort(comparador) : lista;
  }, [ordenacaoDetalhe, registrosFiltro]);

  const registrosDetalheVisiveis = useMemo(
    () => registrosDetalheOrdenados.slice(0, limiteDetalhe),
    [registrosDetalheOrdenados, limiteDetalhe],
  );

  useEffect(() => {
    setLimiteDetalhe(200);
    setCteExpandido(null);
  }, [ordenacaoDetalhe, filtroTransps, filtroTomadores, filtroUfs, filtroCidades, filtroCanais, filtroCriterios]);

  // Busca a jornada (em que fase cada CT-e está) dos CT-es visíveis na tabela de detalhe.
  useEffect(() => {
    let cancelado = false;
    const identificadores = registrosDetalheVisiveis
      .flatMap((r) => [r.chave_cte, r.numero_cte])
      .filter(Boolean);
    if (!identificadores.length) {
      setJornadaPorChave(new Map());
      return undefined;
    }
    buscarJornadaPorIdentificadores(identificadores)
      .then((mapa) => { if (!cancelado) setJornadaPorChave(mapa); })
      .catch((error) => { console.warn('Não foi possível carregar a jornada dos CT-es visíveis:', error.message || error); });
    return () => { cancelado = true; };
  }, [registrosDetalheVisiveis]);

  const transportadoraEmTratamento = filtroTransps.length === 1
    && !filtroTomadores.length
    && !filtroUfs.length
    && !filtroCidades.length
    && !filtroCanais.length
    && !filtroCriterios.length
    ? filtroTransps[0]
    : '';

  // Assertividade de um conjunto: % de CT-es (com algum cálculo) em que o
  // recálculo OU a Verum batem o valor cobrado. Mesmo critério da meta.
  function assertividadeDe(lista = []) {
    let base = 0;
    let ok = 0;
    for (const r of lista) {
      const vc = Number(r.valor_cte || 0);
      const rec = Number(r.valor_calculado || 0);
      const ver = Number(r.valor_calculado_verum || 0);
      if (rec <= 0 && ver <= 0) continue;
      base += 1;
      if ((rec > 0 && !ehDivergenteComMargem(vc - rec, rec, margensDivergencia)) || (ver > 0 && !ehDivergenteComMargem(vc - ver, ver, margensDivergencia))) ok += 1;
    }
    return { base, ok, taxa: base > 0 ? (ok / base) * 100 : 0 };
  }

  async function salvarRegistrosRecalculados(registrosParaSalvar = []) {
    const grupos = new Map();
    for (const row of registrosParaSalvar || []) {
      const comp = competenciaRegistroAuditoria(row, competencia);
      if (!comp) continue;
      if (!grupos.has(comp)) grupos.set(comp, []);
      grupos.get(comp).push(row);
    }
    if (!grupos.size) return { gravados: 0, competencias: [] };

    let gravados = 0;
    const competencias = [];
    for (const [comp, linhas] of grupos.entries()) {
      await salvarRecorteCarregadoAuditoria({
        competencia: comp,
        registros: linhas,
        onProgress: setProgressoProcessamento,
      });
      gravados += linhas.length;
      competencias.push(comp);
    }
    const resumo = await carregarResumoAuditoriaMensal();
    setResumoMensal(resumo || []);
    return { gravados, competencias };
  }

  // Resimula apenas o recorte filtrado (preview em memória, sem gravar). Atualiza
  // os mesmos registros dentro da base carregada para as métricas refletirem.
  async function resimularFiltrados(forcarTabelasFrescas = false) {
    const alvo = registrosFiltro;
    if (!alvo.length) {
      setErro('Nenhum CT-e no foco atual para resimular. Ajuste os filtros.');
      return;
    }

    if (forcarTabelasFrescas) invalidarCacheBaseFreteAuditoriaCte();

    setResimulando(true);
    setErro('');
    setResimuladoInfo('');
    setResimuladoDiagnostico([]);
    setProgressoProcessamento(null);

    const antes = assertividadeDe(alvo);

    try {
      const novos = await executarComFila({
        tipo: 'AUDITORIA_CTE',
        titulo: `Resimular auditoria${transportadoraEmTratamento ? ` / ${transportadoraEmTratamento}` : ''}`,
        totalItens: alvo.length,
        metadados: { acao: 'resimular', transportadora: transportadoraEmTratamento || null },
      }, async ({ atualizar }) => resimularRegistros({
          registros: alvo,
          transportadorasAlvo: transportadoraEmTratamento ? [transportadoraEmTratamento] : filtroTransps,
          onProgress: (progresso) => {
            setProgressoProcessamento(progresso);
            atualizar(progresso);
          },
          ignorarCubagem: usarPesoCteAuditoria,
          percentualContingenciaPeso: percentualContingenciaPesoAuditoria,
          apenasDadosCompletos: apenasDadosCompletosAuditoria,
        }), (fila) => setProgressoProcessamento({
          etapa: 'aguardando_fila', carregados: 0, total: alvo.length, posicao: fila.posicao,
        }));
      const mapa = new Map();
      alvo.forEach((orig, i) => mapa.set(orig, novos[i]));
      setRegistros((prev) => prev.map((r) => mapa.get(r) || r));

      // Resimular já grava direto no banco (merge — só esses CT-es, sem apagar
      // o resto do mês), inclusive quando o recorte veio por período/data.
      const salvamento = await salvarRegistrosRecalculados(novos);
      const gravado = salvamento.gravados > 0;

      const depois = assertividadeDe(novos);
      const diagnosticoNovos = Array.from(novos.reduce((mapa, row) => {
        const status = row.status_calculo || (Number(row.valor_calculado || 0) > 0 ? 'CALCULADO' : 'SEM_STATUS');
        const atual = mapa.get(status) || { status, total: 0, exemplo: '' };
        atual.total += 1;
        if (!atual.exemplo && row.motivo_sem_calculo) atual.exemplo = row.motivo_sem_calculo;
        mapa.set(status, atual);
        return mapa;
      }, new Map()).values()).sort((a, b) => b.total - a.total);
      const ganho = depois.taxa - antes.taxa;
      const resolvidos = depois.ok - antes.ok;
      const seta = ganho > 0.05 ? '▲' : ganho < -0.05 ? '▼' : '→';
      setResimuladoDiagnostico(diagnosticoNovos);
      setResimuladoInfo(
        `${fmtN(novos.length)} CT-e(s) resimulados e ${gravado ? `já gravados em auditoria_cte_resultados (${salvamento.competencias.join(', ')})` : 'NÃO gravados (sem competência/data para salvar)'}. `
        + `Assertividade do recorte: ${fmtP(antes.taxa)} ${seta} ${fmtP(depois.taxa)} `
        + `(${resolvidos >= 0 ? '+' : ''}${fmtN(resolvidos)} corrigidos). `
        + 'Ajuste as tabelas e clique em Atualizar/Resimular de novo quando quiser.',
      );
    } catch (e) {
      setErro(e.message || 'Erro ao resimular o recorte filtrado.');
    } finally {
      setResimulando(false);
      setProgressoProcessamento(null);
    }
  }

  // AMD (nosso motor) é sempre a base das métricas; a Verum fica como referência.
  function montarRegistroComAlternativaPeso(row, alternativa) {
    const valorCalculado = Number(alternativa.valor_calculado || 0);
    const valorPago = Number(row.valor_cte || 0);
    const diferenca = valorPago - valorCalculado;
    return {
      ...row,
      peso: alternativa.peso_considerado || row.peso,
      valor_calculado: valorCalculado,
      diferenca,
      diferenca_abs: Math.abs(diferenca),
      percentual_diferenca: valorCalculado > 0 ? (diferenca / valorCalculado) * 100 : 0,
      detalhes_calculo: {
        ...(row.detalhes_calculo || {}),
        peso_considerado: alternativa.peso_considerado,
        valor_base: alternativa.valor_base,
        subtotal: alternativa.subtotal,
        icms: alternativa.icms,
        aliquota_icms: alternativa.aliquota_icms ?? row.detalhes_calculo?.aliquota_icms,
        origem_aliquota_icms: alternativa.origem_aliquota_icms || row.detalhes_calculo?.origem_aliquota_icms,
        uf_origem_icms: alternativa.uf_origem_icms || row.detalhes_calculo?.uf_origem_icms,
        uf_destino_icms: alternativa.uf_destino_icms || row.detalhes_calculo?.uf_destino_icms,
        taxas: alternativa.taxas || row.detalhes_calculo?.taxas,
        componentes_base: alternativa.componentes_base || row.detalhes_calculo?.componentes_base,
        componente_base: alternativa.componente_base || row.detalhes_calculo?.componente_base,
        ajuste_peso_aplicado: alternativa.nome,
      },
    };
  }

  async function aplicarAlternativaPeso(row, alternativa) {
    if (!row || !alternativa) return;
    const atualizado = montarRegistroComAlternativaPeso(row, alternativa);
    setRegistros((prev) => prev.map((item) => (item === row ? atualizado : item)));
    setResimuladoInfo(`Peso alternativo aplicado no CT-e ${row.numero_cte || row.chave_cte || ''}: ${alternativa.nome}. Salvando auditoria...`);
    try {
      if (atualizado.competencia) {
        await salvarRecorteCarregadoAuditoria({
          competencia: atualizado.competencia,
          registros: [atualizado],
          onProgress: setProgressoProcessamento,
        });
        setSucesso(`CT-e ${row.numero_cte || row.chave_cte || ''} atualizado e salvo na auditoria com peso ${fmtN(atualizado.peso, 3)} kg.`);
        setResimuladoInfo('');
      } else {
        setResimuladoInfo(`Peso alternativo aplicado no CT-e ${row.numero_cte || row.chave_cte || ''}, mas não salvei porque a linha não tem competência.`);
      }
    } catch (error) {
      setErro(error.message || 'Erro ao salvar a auditoria com peso corrigido.');
    } finally {
      setProgressoProcessamento(null);
    }
  }

  async function aplicarPesosDentroToleranciaFiltro() {
    const alvo = registrosFiltro;
    if (!alvo.length) {
      setErro('Nenhum CT-e no filtro atual para aplicar peso alternativo.');
      return;
    }

    const atualizados = [];
    const mapa = new Map();

    for (const row of alvo) {
      const det = (() => {
        const d = row.detalhes_calculo;
        if (!d) return null;
        if (typeof d === 'object') return d;
        try { return JSON.parse(d); } catch { return null; }
      })();

      const alternativas = (Array.isArray(det?.comparativo_pesos) ? det.comparativo_pesos : [])
        .map((alt) => ({ ...alt, peso_considerado: pesoAlternativaAuditoria(alt) }))
        .filter((alt) => {
          const valorCalculado = Number(alt.valor_calculado || 0);
          const pesoAlt = Number(alt.peso_considerado || 0);
          if (valorCalculado <= 0 || pesoAlt <= 0) return false;
          if (Math.abs(pesoAlt - Number(row.peso || 0)) <= 0.1) return false;
          return !ehDivergenteComMargem(Number(row.valor_cte || 0) - valorCalculado, valorCalculado, margensDivergencia);
        })
        .sort((a, b) => Math.abs(Number(a.diferenca || 0)) - Math.abs(Number(b.diferenca || 0)));

      const escolhida = alternativas[0];
      if (!escolhida) continue;
      const atualizado = montarRegistroComAlternativaPeso(row, escolhida);
      atualizados.push(atualizado);
      mapa.set(row, atualizado);
    }

    if (!atualizados.length) {
      setResimuladoInfo('Nenhum CT-e do filtro tinha peso alternativo fechando dentro da tolerância atual.');
      return;
    }

    if (!window.confirm(`Aplicar peso alternativo em ${atualizados.length.toLocaleString('pt-BR')} CT-e(s) do filtro atual que fecham dentro da tolerância?`)) return;

    setErro('');
    setResimuladoInfo(`Aplicando peso alternativo em ${fmtN(atualizados.length)} CT-e(s) e salvando...`);
    setRegistros((prev) => prev.map((row) => mapa.get(row) || row));
    try {
      const salvamento = await salvarRegistrosRecalculados(atualizados);
      setSucesso(`${atualizados.length.toLocaleString('pt-BR')} CT-e(s) atualizados por peso alternativo dentro da tolerância${salvamento.gravados ? ` e salvos em ${salvamento.competencias.join(', ')}` : ''}.`);
      setResimuladoInfo('');
    } catch (error) {
      setErro(error.message || 'Erro ao salvar aplicação em lote de pesos alternativos.');
    } finally {
      setProgressoProcessamento(null);
    }
  }

  const registrosBase = registrosFiltro;

  // Comparação Recálculo x Verum (sempre sobre o conjunto analisado), para validar
  // se o recálculo está batendo com a Verum.
  const comparacaoVerum = useMemo(() => {
    let ambos = 0;
    let batem = 0;
    let divergem = 0;
    let somaDifAbs = 0;
    for (const r of registrosFiltro) {
      const rec = Number(r.valor_calculado || 0);
      const ver = Number(r.valor_calculado_verum || 0);
      if (rec > 0 && ver > 0) {
        ambos += 1;
        const dif = Math.abs(rec - ver);
        somaDifAbs += dif;
        if (dif <= LIMITE_MATCH_VERUM) batem += 1;
        else divergem += 1;
      }
    }
    return {
      ambos,
      batem,
      divergem,
      taxaMatch: ambos > 0 ? (batem / ambos) * 100 : 0,
      difMedia: ambos > 0 ? somaDifAbs / ambos : 0,
    };
  }, [registrosFiltro]);

  // Assertividade do sistema: para cada CT-e, vê se a Verum e/ou o Recálculo
  // batem com o valor cobrado (realizado). Conta como assertivo se QUALQUER um
  // dos dois bate — é o critério para a meta e para decidir a substituição.
  const assertividadeSistema = useMemo(() => {
    let comAlgumCalculo = 0;
    let comRecalculo = 0;
    let comVerum = 0;
    let semRecalculo = 0;
    let semVerum = 0;
    let recBate = 0;
    let verBate = 0;
    let combinado = 0;
    let soRecalculo = 0;
    let soVerum = 0;
    let ambosBatem = 0;
    let nenhumBate = 0;
    for (const r of registrosFiltro) {
      const vc = Number(r.valor_cte || 0);
      const rec = Number(r.valor_calculado || 0);
      const ver = Number(r.valor_calculado_verum || 0);
      const okRec = rec > 0 && !ehDivergenteComMargem(vc - rec, rec, margensDivergencia);
      const okVer = ver > 0 && !ehDivergenteComMargem(vc - ver, ver, margensDivergencia);
      if (rec > 0) comRecalculo += 1;
      else semRecalculo += 1;
      if (ver > 0) comVerum += 1;
      else semVerum += 1;
      if (rec > 0 || ver > 0) comAlgumCalculo += 1;
      if (okRec) recBate += 1;
      if (okVer) verBate += 1;
      if (okRec || okVer) combinado += 1;
      if (okRec && !okVer) soRecalculo += 1;
      if (okVer && !okRec) soVerum += 1;
      if (okRec && okVer) ambosBatem += 1;
      if (!okRec && !okVer && (rec > 0 || ver > 0)) nenhumBate += 1;
    }
    return {
      comAlgumCalculo,
      comRecalculo,
      comVerum,
      semRecalculo,
      semVerum,
      taxaCombinada: comAlgumCalculo > 0 ? (combinado / comAlgumCalculo) * 100 : 0,
      taxaRecalculo: comRecalculo > 0 ? (recBate / comRecalculo) * 100 : 0,
      taxaVerum: comVerum > 0 ? (verBate / comVerum) * 100 : 0,
      combinado,
      soRecalculo,
      soVerum,
      ambosBatem,
      nenhumBate,
    };
  }, [registrosFiltro, margensDivergencia]);

  // Diagnóstico do recálculo: onde o motor está parando (transportadora → origem →
  // rota → faixa). Usa o status_calculo/motivo já gravado em cada registro.
  const diagnosticoRecalculo = useMemo(() => {
    const STATUS_LABEL = {
      CALCULADO: 'Calculado',
      SEM_TABELA: 'Transportadora não encontrada no cadastro',
      SEM_ORIGEM: 'Origem/canal não encontrados',
      SEM_ROTA: 'Rota de destino não encontrada',
      SEM_FAIXA: 'Faixa/cotação não encontrada',
      ERRO_CALCULO: 'Erro no cálculo',
      SEM_STATUS: 'Sem status (carregado sem recálculo)',
    };
    const mapa = new Map();
    for (const r of registrosFiltro) {
      const st = r.status_calculo || (Number(r.valor_calculado || 0) > 0 ? 'CALCULADO' : 'SEM_STATUS');
      const atual = mapa.get(st) || { status: st, label: STATUS_LABEL[st] || st, total: 0, motivo: '', transportadoras: new Map() };
      atual.total += 1;
      if (!atual.motivo && r.motivo_sem_calculo) atual.motivo = r.motivo_sem_calculo;
      const t = nomeTransportadoraAuditoria(r);
      atual.transportadoras.set(t, (atual.transportadoras.get(t) || 0) + 1);
      mapa.set(st, atual);
    }
    const linhas = Array.from(mapa.values())
      .map((l) => ({
        ...l,
        topTransp: Array.from(l.transportadoras.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3),
      }))
      .sort((a, b) => b.total - a.total);
    return linhas;
  }, [registrosFiltro]);

  const metricas = useMemo(() => calcularMetricasAuditoria(registrosBase, margensDivergencia), [registrosBase, margensDivergencia]);
  const porTransportadora = useMemo(() => agruparPorTransportadora(registrosBase, margensDivergencia), [registrosBase, margensDivergencia]);
  const ondeAtacar = useMemo(() => calcularOndeAtacar(porTransportadora, meta), [porTransportadora, meta]);
  const sugestaoMeta = useMemo(() => sugerirNovaMeta(metricas), [metricas]);
  const avaliacaoMeta = useMemo(() => avaliarMetaAuditoria(metricas, meta), [metricas, meta]);

  const semaforoCalculo = semaforo(metricas.taxaCalculo, meta.taxaCalculoMeta);
  const semaforoAssert = semaforo(metricas.taxaAssertividade, meta.taxaAssertividadeMeta);
  const estiloAvaliacaoMeta = metaStatusStyle(avaliacaoMeta.status);
  const temDados = registros.length > 0;

  async function carregar() {
    if (!podeCarregar) {
      setErro('Informe a competência (mês) ou um período (datas) antes de carregar.');
      return;
    }

    setCarregando(true);
    setErro('');
    setSucesso('');
    setAvisos([]);
    setDiagnostico([]);
    setFonteAuditoria(null);
    setProgressoProcessamento(null);
    setModoPreLista(false);

    try {
      const salvosRapidos = await carregarResultadosAuditoriaMes({
        competencia,
        dataInicio: dataInicioTeste || undefined,
        dataFim: dataFimTeste || undefined,
        canais: canaisPreCarga.length ? canaisPreCarga : undefined,
        transportadoras: transportadorasPreCarga.length ? transportadorasPreCarga : undefined,
        onProgress: setProgressoProcessamento,
      }).catch(() => []);

      // Carrega a base crua inteira (pega CT-e novo que ainda não foi calculado)
      // e por cima aplica o que já está salvo em auditoria_cte_resultados — o
      // Verum não muda, então sobrepor o AMD já corrigido não tem risco. CT-es
      // que nunca foram salvos ficam com o cálculo cru mesmo (ou sem cálculo).
      const resposta = await carregarDadosAuditoria({
        competencia,
        dataInicio: dataInicioTeste || undefined,
        dataFim: dataFimTeste || undefined,
        canais: canaisPreCarga.length ? canaisPreCarga : undefined,
        transportadoras: transportadorasPreCarga.length ? transportadorasPreCarga : undefined,
        onProgress: setProgressoProcessamento,
      });
      const dadosBrutos = resposta?.registros || [];

      const salvos = salvosRapidos || [];

      const dadosMesclados = salvos && salvos.length ? mesclarComResultadosSalvos(dadosBrutos, salvos) : dadosBrutos;
      const dados = await enriquecerCtesComFaturas(dadosMesclados);
      const qtdMesclados = salvos?.length || 0;

      setRegistros(dados);
      setFonteAuditoria(qtdMesclados
        ? {
          id: 'auditoria_cte_resultados_mesclado',
          tabela: 'auditoria_cte_resultados',
          label: `${resposta?.fonte?.label || 'CT-e'} + auditoria_cte_resultados (salvos sobrepostos)`,
        }
        : resposta?.fonte || null);
      setDiagnostico(resposta?.diagnostico || []);
      setAvisos(resposta?.avisos || []);

      if (!dados.length) {
        setSucesso('Nenhum CTe encontrado para este recorte nas bases verificadas.');
      } else if (qtdMesclados) {
        setSucesso(`${dados.length.toLocaleString('pt-BR')} CTe(s) carregados (${qtdMesclados.toLocaleString('pt-BR')} com resultado salvo aplicado).`);
      } else {
        const fonte = resposta?.fonte?.label || resposta?.fonte?.tabela || 'Supabase';
        setSucesso(`${dados.length.toLocaleString('pt-BR')} CTe(s) carregados da fonte ${fonte}.`);
      }
    } catch (e) {
      setRegistros([]);
      setErro(e.message || 'Erro ao carregar dados do Supabase.');
    } finally {
      setCarregando(false);
      setProgressoProcessamento(null);
    }
  }

  async function carregarPreLista() {
    if (!podeCarregar) {
      setErro('Informe a competÃªncia (mÃªs) ou um perÃ­odo antes de carregar a prÃ©-lista.');
      return;
    }

    setCarregando(true);
    setErro('');
    setSucesso('');
    setAvisos([]);
    setDiagnostico([]);
    setFonteAuditoria(null);
    setProgressoProcessamento(null);

    try {
      const dados = await carregarPreListaAuditoriaMes({
        competencia,
        dataInicio: dataInicioTeste || undefined,
        dataFim: dataFimTeste || undefined,
        canais: canaisPreCarga.length ? canaisPreCarga : undefined,
        transportadoras: transportadorasPreCarga.length ? transportadorasPreCarga : undefined,
        onProgress: setProgressoProcessamento,
      });
      setRegistros(await enriquecerCtesComFaturas(dados || []));
      setModoPreLista(true);
      setFonteAuditoria({
        id: 'prelista_auditoria_cte_resultados',
        tabela: 'auditoria_cte_resultados',
        label: 'PrÃ©-lista leve / auditoria_cte_resultados',
      });
      setSucesso(`${(dados || []).length.toLocaleString('pt-BR')} CT-e(s) carregados em prÃ©-lista leve. Use "Tratar agora" e depois "Carregar CT-es da transportadora" para abrir o detalhe completo.`);
    } catch (error) {
      setRegistros([]);
      setModoPreLista(false);
      setErro(error.message || 'Erro ao carregar prÃ©-lista da auditoria.');
    } finally {
      setCarregando(false);
      setProgressoProcessamento(null);
    }
  }

  async function carregarTransportadoraCompleta() {
    if (!transportadoraEmTratamento) {
      setErro('Selecione uma transportadora em tratamento antes de carregar os CT-es completos.');
      return;
    }
    if (!podeCarregar) {
      setErro('Informe a competÃªncia ou perÃ­odo antes de carregar a transportadora.');
      return;
    }

    setCarregando(true);
    setErro('');
    setSucesso('');
    setProgressoProcessamento(null);

    try {
      const totalPrevisto = porTransportadoraCompleto.find((item) => item.transportadora === transportadoraEmTratamento)?.total || 0;
      if (totalPrevisto > TAMANHO_LOTE_PESADO) {
        setSucesso(`${totalPrevisto.toLocaleString('pt-BR')} CT-es encontrados. Serão carregados em ${Math.ceil(totalPrevisto / TAMANHO_LOTE_PESADO)} lotes de até ${TAMANHO_LOTE_PESADO}.`);
      }
      // Carregar dados e uma operacao paginada de leitura. Ela nao disputa a
      // fila reservada aos calculos pesados; filtros e lotes limitam a carga.
      const progresso = (valor) => setProgressoProcessamento(valor);
      const carregados = await carregarResultadosAuditoriaMes({
        competencia,
        dataInicio: dataInicioTeste || undefined,
        dataFim: dataFimTeste || undefined,
        canais: canaisPreCarga.length ? canaisPreCarga : undefined,
        transportadoras: [transportadoraEmTratamento],
        tamanhoPagina: TAMANHO_LOTE_PESADO,
        onProgress: progresso,
      });
      const dados = await enriquecerCtesComFaturasEmLotes(carregados || [], {
        tamanhoLote: TAMANHO_LOTE_PESADO,
        onProgress: progresso,
      });
      setRegistros(dados || []);
      setModoPreLista(false);
      setFonteAuditoria({
        id: 'auditoria_cte_resultados_transportadora',
        tabela: 'auditoria_cte_resultados',
        label: `Auditoria salva / ${transportadoraEmTratamento}`,
      });
      setSucesso(`${(dados || []).length.toLocaleString('pt-BR')} CT-e(s) completos carregados para ${transportadoraEmTratamento}.`);
    } catch (error) {
      setErro(error.message || 'Erro ao carregar CT-es completos da transportadora.');
    } finally {
      setCarregando(false);
      setProgressoProcessamento(null);
    }
  }

  async function carregarResultadoSalvo() {
    if (!podeCarregar) {
      setErro('Informe a competência ou um período antes de carregar o resultado salvo.');
      return;
    }

    setCarregando(true);
    setErro('');
    setSucesso('');
    setAvisos([]);
    setDiagnostico([]);
    setFonteAuditoria(null);
    setProgressoProcessamento(null);

    try {
      const dados = await carregarResultadosAuditoriaMes({
        competencia,
        dataInicio: dataInicioTeste || undefined,
        dataFim: dataFimTeste || undefined,
        canais: canaisPreCarga.length ? canaisPreCarga : undefined,
        transportadoras: transportadorasPreCarga.length ? transportadorasPreCarga : undefined,
        onProgress: setProgressoProcessamento,
      });

      setRegistros(await enriquecerCtesComFaturas(dados || []));
      setFonteAuditoria({
        id: 'auditoria_cte_resultados',
        tabela: 'auditoria_cte_resultados',
        label: 'Auditoria salva / auditoria_cte_resultados',
      });

      const recorteTeste = dataInicioTeste || dataFimTeste
        ? ` (período de teste ${dataInicioTeste || '...'} a ${dataFimTeste || '...'})`
        : '';
      if (!dados.length) {
        setSucesso(`Nenhum resultado salvo para esta competência${recorteTeste}. Use Salvar mês carregado.`);
      } else {
        setSucesso(`${dados.length.toLocaleString('pt-BR')} resultado(s) salvo(s) carregado(s)${recorteTeste}.`);
      }
    } catch (error) {
      setRegistros([]);
      setErro(error.message || 'Erro ao carregar resultado salvo.');
    } finally {
      setCarregando(false);
      setProgressoProcessamento(null);
    }
  }

  async function salvarMesCarregado() {
    if (!competencia) {
      setErro('Informe a competência antes de salvar o mês.');
      return;
    }

    // Se há CT-es carregados na tela, faz merge: atualiza só esses CT-es (por
    // chave/número) e preserva o resto do mês já salvo. Sem nada carregado, cai
    // no modo antigo: rebusca e substitui o mês inteiro da base.
    const salvarRecorte = registrosFiltro.length > 0;
    const qtd = salvarRecorte ? registrosFiltro.length : 0;

    const avisoFiltro = salvarRecorte && (filtrosAtivos || excluidasSet.size)
      ? `\n\nVocê tem filtros/exclusões ativos. Serão atualizados apenas os ${qtd.toLocaleString('pt-BR')} CT-e(s) do recorte atual — o restante do mês salvo permanece como está.`
      : '';

    const confirmar = window.confirm(
      (salvarRecorte
        ? `Salvar os ${qtd.toLocaleString('pt-BR')} CT-e(s) que estão na tela como a auditoria de ${competencia}? Eles serão atualizados/inseridos em auditoria_cte_resultados; o resto do mês já salvo NÃO é afetado. O resumo mensal é recalculado com o mês inteiro.`
        : `Salvar a auditoria de ${competencia}? Nada está carregado na tela, então o mês inteiro será buscado da base. O resultado salvo e o resumo mensal serão substituídos.`)
      + avisoFiltro
    );

    if (!confirmar) return;

    setProcessando(true);
    setErro('');
    setSucesso('');
    setAvisos([]);
    setProgressoProcessamento(null);

    try {
      const resposta = salvarRecorte
        ? await salvarRecorteCarregadoAuditoria({
          competencia,
          registros: registrosFiltro,
          onProgress: setProgressoProcessamento,
        })
        : await salvarMesCarregadoAuditoria({
          competencia,
          onProgress: setProgressoProcessamento,
        });

      const dados = resposta?.registros || [];
      setRegistros(dados);
      setFonteAuditoria(resposta?.fonte || {
        id: 'auditoria_cte_resultados',
        tabela: 'auditoria_cte_resultados',
        label: 'Auditoria salva / auditoria_cte_resultados',
      });
      // O que foi salvo já é a base inteira agora — zera filtros pra não esconder.
      limparFiltrosFoco();

      const resumo = await carregarResumoAuditoriaMensal();
      setResumoMensal(resumo || []);

      setSucesso(`${dados.length.toLocaleString('pt-BR')} CT-e(s) salvos na auditoria e resumo mensal atualizado para ${competencia}.`);
    } catch (error) {
      setErro(error.message || 'Erro ao salvar mês carregado.');
    } finally {
      setProcessando(false);
      setProgressoProcessamento(null);
    }
  }

  async function recalcularComFerramenta() {
    if (!podeCarregar) {
      setErro('Informe a competência ou um período antes de recalcular.');
      return;
    }

    const alvo = temPeriodoTeste
      ? `o período ${dataInicioTeste || '...'} a ${dataFimTeste || '...'}`
      : competencia;
    const confirmar = window.confirm(
      temPeriodoTeste
        ? `Recalcular ${alvo} com as tabelas cadastradas? O resultado será gravado por competência em auditoria_cte_resultados, preservando o restante do mês.`
        : `Recalcular ${alvo} com as tabelas cadastradas? O recálculo será gravado em auditoria_cte_resultados (o cálculo da Verum é preservado). O resultado salvo desse mês será substituído.`
    );

    if (!confirmar) return;

    setProcessando(true);
    setErro('');
    setSucesso('');
    setAvisos([]);
    setProgressoProcessamento(null);

    try {
      const resposta = await processarESalvarAuditoriaMes({
        competencia,
        dataInicio: dataInicioTeste || undefined,
        dataFim: dataFimTeste || undefined,
        canais: canaisPreCarga.length ? canaisPreCarga : undefined,
        onProgress: setProgressoProcessamento,
        ignorarCubagem: usarPesoCteAuditoria,
        percentualContingenciaPeso: percentualContingenciaPesoAuditoria,
        apenasDadosCompletos: apenasDadosCompletosAuditoria,
      });

      const dados = resposta?.registros || [];
      setRegistros(dados);
      setFonteAuditoria(resposta?.fonte || {
        id: 'auditoria_cte_resultados',
        tabela: 'auditoria_cte_resultados',
        label: 'Auditoria recalculada / auditoria_cte_resultados',
      });

      if (resposta?.gravado) {
        const resumo = await carregarResumoAuditoriaMensal();
        setResumoMensal(resumo || []);
        setSucesso(`${dados.length.toLocaleString('pt-BR')} CT-e(s) recalculados e gravados para ${competencia}. Verum preservada para comparação.`);
      } else {
        const salvamento = await salvarRegistrosRecalculados(dados);
        setSucesso(`${dados.length.toLocaleString('pt-BR')} CT-e(s) recalculados em ${alvo}${salvamento.gravados ? ` e ${salvamento.gravados.toLocaleString('pt-BR')} gravado(s) em ${salvamento.competencias.join(', ')}` : ' (não gravado: sem competência/data nos CT-es)'}. Verum preservada para comparação.`);
      }
    } catch (error) {
      setErro(error.message || 'Erro ao recalcular com a ferramenta.');
    } finally {
      setProcessando(false);
      setProgressoProcessamento(null);
    }
  }

  async function carregarResumoMensal() {
    setCarregando(true);
    setErro('');
    setSucesso('');

    try {
      const resumo = await carregarResumoAuditoriaMensal();
      setResumoMensal(resumo || []);
      setSucesso(`${(resumo || []).length.toLocaleString('pt-BR')} mês(es) encontrados no resumo mensal.`);
    } catch (error) {
      setErro(error.message || 'Erro ao carregar resumo mensal.');
    } finally {
      setCarregando(false);
    }
  }

  function limpar() {
    setCompetencia('');
    setDataInicioTeste('');
    setDataFimTeste('');
    setTransportadorasPreCargaSelecionadas([]);
    setAuditoresPreCargaSelecionados([]);
    setBuscaTransportadoraPreCarga('');
    setBuscaAuditorPreCarga('');
    setRegistros([]);
    setModoPreLista(false);
    setFonteAuditoria(null);
    setDiagnostico([]);
    setAvisos([]);
    setResumoMensal([]);
    setProgressoProcessamento(null);
    setResimuladoInfo('');
    setResimuladoDiagnostico([]);
    setErro('');
    setSucesso('');
    limparFiltrosFoco();
  }

  function toggleUsarTabelas() {
    const novo = !usarTabelas;
    setUsarTabelas(novo);
    localStorage.setItem(TOGGLE_TABELAS_KEY, JSON.stringify(novo));
  }

  function salvarMeta() {
    salvarMetaAuditoria(metaTemp);
    setMeta(metaTemp);
    setEditandoMeta(false);
  }

  function usarSugestaoMeta() {
    setMetaTemp({ ...sugestaoMeta });
  }

  function exportarExcel() {
    exportarAuditoriaExcel(porTransportadora, metricas, competencia, diagnostico);
  }

  function exportarCtesDetalhe() {
    exportarCtesDetalhadoExcel(registrosFiltro, competencia);
  }

  function alternarCteLaudo(row, indice) {
    const id = identificadorCteAuditoria(row, indice);
    setCtesSelecionadosLaudo((atuais) => atuais.includes(id) ? atuais.filter((item) => item !== id) : [...atuais, id]);
  }

  function selecionarDivergentesLaudo() {
    const ids = registrosDetalheOrdenados
      .filter((row) => cteDivergenteAuditoria(row, (dif, base) => ehDivergenteComMargem(dif, base, margensDivergencia)))
      .map((row, indice) => identificadorCteAuditoria(row, indice));
    setCtesSelecionadosLaudo(ids);
    setSucesso(`${ids.length.toLocaleString('pt-BR')} CT-e(s) divergente(s) selecionado(s) para o laudo do transportador.`);
  }

  /** Tira do filtro do card os CT-es que acabaram de mudar de status — senão
   * eles continuam listados num grupo (ex.: "aguardando retorno") ao qual não
   * pertencem mais. */
  function removerDoFiltroJornada(chaves = []) {
    if (!chaves.length) return;
    setFiltroJornada((atual) => {
      if (!atual?.chaves?.size) return atual;
      const restantes = new Set(atual.chaves);
      chaves.forEach((chave) => restantes.delete(String(chave)));
      return { ...atual, chaves: restantes };
    });
  }

  // Mesmo critério do destaque verde na tabela: tem cálculo AMD e a diferença
  // está dentro da margem configurada.
  function cteDentroDaMargem(row) {
    const amd = Number(row.valor_calculado || 0);
    if (amd <= 0) return false;
    const difAmd = row.diferenca !== undefined && row.diferenca !== null
      ? Number(row.diferenca)
      : (Number(row.valor_cte || 0) - amd);
    return !ehDivergenteComMargem(difAmd, amd, margensDivergencia);
  }

  function selecionarDentroDaMargemLaudo() {
    const ids = registrosDetalheOrdenados
      .map((row, indice) => (cteDentroDaMargem(row) ? identificadorCteAuditoria(row, indice) : null))
      .filter(Boolean);
    setCtesSelecionadosLaudo(ids);
    setSucesso(`${ids.length.toLocaleString('pt-BR')} CT-e(s) dentro da tolerância selecionado(s).`);
  }

  /** Marca os selecionados como AUDITADO_OK / SEM_IMPACTO — o "conferi e está certo".
   * CT-e divergente NÃO pode ser dado como OK por auditor comum: isso apagaria
   * uma cobrança indevida sem tratativa. Só gestor libera, com justificativa. */
  async function marcarSelecionadosComoOk() {
    const selecionados = registrosDetalheOrdenados.filter((row, indice) => ctesSelecionadosLaudo.includes(identificadorCteAuditoria(row, indice)));
    const chaves = [...new Set(selecionados.map((r) => r.chave_cte).filter(Boolean))];
    if (!chaves.length) return;

    const divergentes = selecionados.filter((r) => !cteDentroDaMargem(r));
    const valorDivergente = divergentes.reduce((acc, r) => acc + Math.abs(Number(r.diferenca ?? ((Number(r.valor_cte || 0)) - (Number(r.valor_calculado || 0))))), 0);
    let justificativa = '';

    if (divergentes.length) {
      if (!ehGestorAuditoria) {
        setErro(
          `${fmtN(divergentes.length)} CT-e(s) selecionado(s) estão FORA da tolerância (${fmt(valorDivergente)} de divergência). `
          + 'Dar OK neles encerraria a cobrança sem tratativa, então só um gestor pode fazer isso. '
          + 'Use "Selecionar corretos" para marcar apenas os que estão dentro da tolerância.',
        );
        return;
      }
      justificativa = window.prompt(
        `ATENÇÃO — ${divergentes.length} de ${selecionados.length} CT-e(s) estão FORA da tolerância, `
        + `somando ${fmt(valorDivergente)} de divergência.\n\n`
        + 'Você está encerrando essa cobrança sem tratativa. Descreva o motivo (obrigatório):',
        '',
      );
      if (!justificativa || !justificativa.trim()) {
        setErro('Ação cancelada: é obrigatório justificar o OK em CT-e divergente.');
        return;
      }
    }

    setJornadaSalvando(true);
    setErro('');
    setProgressoProcessamento({ etapa: 'salvando_jornada', carregados: 0, total: chaves.length });
    try {
      const usuario = carregarSessao();
      const chavesDivergentes = new Set(divergentes.map((r) => r.chave_cte));
      const observacaoPorChave = new Map(selecionados
        .filter((r) => r.chave_cte)
        .map((r) => [String(r.chave_cte), chavesDivergentes.has(r.chave_cte)
          ? `OK em CT-e divergente liberado pelo gestor ${usuario?.nome || usuario?.email || ''}: ${justificativa.trim()}`
          : 'Conferido pelo auditor: dentro da tolerância.']));

      await registrarDecisaoJornadaEmLote({
        ctes: selecionados,
        competencia,
        statusOperacional: 'AUDITADO_OK',
        statusFinanceiro: 'SEM_IMPACTO',
        observacaoPorChave,
        usuario,
        onProgress: setProgressoProcessamento,
      });
      const mapaAtualizado = await buscarJornadaPorIdentificadores(
        registrosDetalheVisiveis.flatMap((r) => [r.chave_cte, r.numero_cte]).filter(Boolean),
      );
      setJornadaPorChave(mapaAtualizado);
      setJornadaVersao((v) => v + 1);
      removerDoFiltroJornada(chaves);
      setCtesSelecionadosLaudo([]);
      setSucesso(`${chaves.length.toLocaleString('pt-BR')} CT-e(s) marcado(s) como auditado OK.`
        + (divergentes.length ? ` ${divergentes.length} deles estavam divergentes e foram liberados pelo gestor (registrado no histórico).` : ''));
    } catch (error) {
      setErro(error.message || 'Não foi possível marcar os CT-es como OK.');
    } finally {
      setJornadaSalvando(false);
      setProgressoProcessamento(null);
    }
  }

  function selecionarTodosLaudo() {
    const ids = registrosDetalheOrdenados.map((row, indice) => identificadorCteAuditoria(row, indice));
    const todosSelecionados = ids.length > 0 && ids.every((id) => ctesSelecionadosLaudo.includes(id));
    setCtesSelecionadosLaudo(todosSelecionados ? [] : ids);
    setSucesso(todosSelecionados
      ? 'Seleção do laudo limpa.'
      : `${ids.length.toLocaleString('pt-BR')} CT-e(s) do recorte selecionado(s) para o laudo do transportador.`);
  }

  async function salvarRetornoJornada(chaveCte) {
    const config = RESULTADOS_RETORNO_TRANSPORTADORA[jornadaForm.resultado];
    if (!config) return;
    setJornadaSalvando(true);
    setErro('');
    // Grava a decisao: nao ha recalculo aqui, o valor auditado ja esta pronto.
    setProgressoProcessamento({ etapa: 'salvando_jornada', carregados: 0, total: 1 });
    try {
      const usuario = carregarSessao();
      let valorAcordado;
      if (config.pedeValor) {
        const digitado = String(jornadaForm.valorAcordado).trim();
        if (digitado) {
          // Digitou algo -> usa o valor exato informado (pode ser diferente da divergência calculada).
          valorAcordado = Number(digitado.replace(',', '.')) || 0;
        } else {
          // Deixou em branco -> assume que concordou com a divergência identificada pela auditoria.
          const row = registrosDetalheVisiveis.find((r) => r.chave_cte === chaveCte);
          valorAcordado = row
            ? Math.abs(Number(row.diferenca ?? ((Number(row.valor_cte || 0)) - (Number(row.valor_calculado || 0)))))
            : 0;
        }
      }
      await atualizarStatusJornada({
        chaveCte,
        statusOperacional: config.statusOperacional,
        statusFinanceiro: config.statusFinanceiro || undefined,
        valorAcordado,
        observacao: jornadaForm.observacao || `Retorno registrado: ${config.label}`,
        usuario,
      });
      const mapaAtualizado = await buscarJornadaPorIdentificadores(
        registrosDetalheVisiveis.flatMap((r) => [r.chave_cte, r.numero_cte]).filter(Boolean),
      );
      setJornadaPorChave(mapaAtualizado);
      setJornadaVersao((v) => v + 1);
      removerDoFiltroJornada([chaveCte]);
      setJornadaEditando(null);
      setJornadaForm({ resultado: 'concordou_desconto', valorAcordado: '', observacao: '' });
      setSucesso(`Jornada atualizada: ${config.label}.`);
    } catch (error) {
      setErro(error.message || 'Não foi possível registrar o retorno da transportadora.');
    } finally {
      setJornadaSalvando(false);
      setProgressoProcessamento(null);
    }
  }

  async function handleAnularJornada(chaveCte) {
    setJornadaSalvando(true);
    setErro('');
    // Grava a decisao: nao ha recalculo aqui, o valor auditado ja esta pronto.
    setProgressoProcessamento({ etapa: 'salvando_jornada', carregados: 0, total: 1 });
    try {
      const usuario = carregarSessao();
      await anularJornada({ chaveCte, motivo: anularMotivo, usuario });
      const mapaAtualizado = await buscarJornadaPorIdentificadores(
        registrosDetalheVisiveis.flatMap((r) => [r.chave_cte, r.numero_cte]).filter(Boolean),
      );
      setJornadaPorChave(mapaAtualizado);
      setJornadaVersao((v) => v + 1);
      setJornadaEditando(null);
      setAnularMotivo('');
      setSucesso('Auditoria anulada — CT-e voltou para "Não auditado".');
    } catch (error) {
      setErro(error.message || 'Não foi possível anular esta auditoria.');
    } finally {
      setJornadaSalvando(false);
      setProgressoProcessamento(null);
    }
  }

  async function handleVincularReemissao(chaveCteOriginal) {
    const chaveSubstituto = reemissaoForm.chaveSubstituto.trim();
    if (!chaveSubstituto) {
      setErro('Informe a chave (ou número) do CT-e substituto.');
      return;
    }
    setReemissaoSalvando(true);
    setErro('');
    try {
      const usuario = carregarSessao();
      await vincularCancelamentoReemissao({
        chaveCteOriginal,
        chaveCteSubstituto: chaveSubstituto,
        motivo: reemissaoForm.motivo,
        usuario,
      });
      const mapaAtualizado = await buscarJornadaPorIdentificadores(
        registrosDetalheVisiveis.flatMap((r) => [r.chave_cte, r.numero_cte]).filter(Boolean),
      );
      setJornadaPorChave(mapaAtualizado);
      setJornadaVersao((v) => v + 1);
      removerDoFiltroJornada([chaveCteOriginal]);
      setJornadaEditando(null);
      setReemissaoForm({ chaveSubstituto: '', motivo: '' });
      setSucesso(`CT-e ${chaveCteOriginal} marcado como cancelado — vinculado ao substituto ${chaveSubstituto}.`);
    } catch (error) {
      setErro(error.message || 'Não foi possível vincular a reemissão.');
    } finally {
      setReemissaoSalvando(false);
    }
  }

  async function salvarRetornoJornadaEmLote() {
    const config = RESULTADOS_RETORNO_TRANSPORTADORA[jornadaForm.resultado];
    if (!config) return;
    const selecionados = registrosDetalheOrdenados.filter((row, indice) => ctesSelecionadosLaudo.includes(identificadorCteAuditoria(row, indice)));
    const chaves = [...new Set(selecionados.map((r) => r.chave_cte).filter(Boolean))];
    if (!chaves.length) return;
    setJornadaSalvando(true);
    setErro('');
    // Grava a decisao: nao ha recalculo aqui, o valor auditado ja esta pronto.
    setProgressoProcessamento({ etapa: 'salvando_jornada', carregados: 0, total: 1 });
    try {
      const usuario = carregarSessao();
      // No lote, o desconto acordado de cada CT-e = a própria divergência
      // identificada dele (concordou com o valor apontado pela auditoria).
      const valorAcordadoPorChave = config.pedeValor
        ? new Map(selecionados.filter((r) => r.chave_cte).map((r) => [
          String(r.chave_cte),
          Math.abs(Number(r.diferenca ?? ((Number(r.valor_cte || 0)) - (Number(r.valor_calculado || 0))))),
        ]))
        : undefined;

      await registrarDecisaoJornadaEmLote({
        ctes: selecionados,
        competencia,
        statusOperacional: config.statusOperacional,
        statusFinanceiro: config.statusFinanceiro || undefined,
        valorAcordadoPorChave,
        observacao: jornadaForm.observacao || `Retorno em lote: ${config.label}`,
        usuario,
        onProgress: setProgressoProcessamento,
      });
      const mapaAtualizado = await buscarJornadaPorIdentificadores(
        registrosDetalheVisiveis.flatMap((r) => [r.chave_cte, r.numero_cte]).filter(Boolean),
      );
      setJornadaPorChave(mapaAtualizado);
      setJornadaVersao((v) => v + 1);
      removerDoFiltroJornada(chaves);
      setModalRetornoLoteAberto(false);
      setJornadaForm({ resultado: 'concordou_desconto', valorAcordado: '', observacao: '' });
      setSucesso(`Jornada atualizada em lote: ${config.label} (${chaves.length.toLocaleString('pt-BR')} CT-e(s)).`);
    } catch (error) {
      setErro(error.message || 'Não foi possível registrar o retorno em lote.');
    } finally {
      setJornadaSalvando(false);
      setProgressoProcessamento(null);
    }
  }

  function abrirModalLaudo() {
    if (!ctesSelecionadosLaudo.length) return;
    setModalLaudoAberto(true);
  }

  async function confirmarGeracaoLaudo(enviarAgora) {
    try {
      await gerarLaudoEregistrar(enviarAgora);
    } catch (error) {
      // Rede de segurança: sem isso, qualquer erro inesperado aqui deixava o
      // botão "sem fazer nada" e o auditor não tinha como saber o motivo.
      console.error('Falha ao gerar o laudo:', error);
      setErro(`Falha ao gerar o laudo: ${error?.message || error}`);
    }
  }

  async function gerarLaudoEregistrar(enviarAgora) {
    setModalLaudoAberto(false);
    setErro('');
    const selecionados = registrosDetalheOrdenados.filter((row, indice) => ctesSelecionadosLaudo.includes(identificadorCteAuditoria(row, indice)));
    if (!selecionados.length) {
      setErro('Nenhum CT-e selecionado para o laudo.');
      return;
    }

    // Um laudo POR TRANSPORTADORA: cada uma só pode enxergar os CT-es dela.
    // Juntar tudo num arquivo só vazaria dados entre concorrentes.
    const porTransportadora = new Map();
    selecionados.forEach((row) => {
      const chave = row.transportadora || 'SEM_TRANSPORTADORA';
      if (!porTransportadora.has(chave)) porTransportadora.set(chave, []);
      porTransportadora.get(chave).push(row);
    });

    // ETAPA 1 — gerar e baixar o laudo. Tudo síncrono, sem esperar o banco: o
    // download precisa acontecer dentro do gesto do clique, senão o navegador
    // cancela. O token do portal é sorteado aqui e persistido na etapa 2.
    const gerados = [];
    const falhas = [];

    for (const [transportadora, ctes] of porTransportadora) {
      const nome = transportadora === 'SEM_TRANSPORTADORA' ? null : transportadora;
      const token = gerarTokenAleatorio();
      try {
        const arquivo = prepararArquivoLaudoAuditoriaCtes(ctes, {
          competencia,
          mostrarCobrancaAMenor: mostrarCobrancaAMenorLaudo,
          portais: [{ transportadora: nome || '', url: urlPortalTransportadora(token) }],
        });
        gerados.push({ ...arquivo, transportadora: nome || 'Sem transportadora', qtd: ctes.length, ctes, nomeTransportadora: nome, token });
      } catch (error) {
        falhas.push(`${nome || 'sem transportadora'}: ${error.message || error}`);
      }
    }

    // O painel de botões fica SEMPRE visível: o download automático pode ser
    // bloqueado pelo navegador (vários arquivos, ou clique fora de gesto direto)
    // e nesse caso o auditor precisa de um botão pra buscar o arquivo na mão.
    setLaudosGerados(gerados);
    // O painel fica no topo da página e o botão do laudo fica lá embaixo na
    // tabela — sem rolar até ele, o auditor não vê que o arquivo ficou pronto.
    requestAnimationFrame(() => {
      document.getElementById('painel-laudos-gerados')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    if (gerados.length === 1) {
      try {
        baixarArquivoPreparado(gerados[0]);
      } catch (error) {
        console.warn('Download automático bloqueado; use o botão do painel.', error);
      }
    }

    if (falhas.length) {
      setErro(falhas.join(' | '));
      return;
    }
    setSucesso(gerados.length === 1
      ? `Laudo de ${gerados[0].transportadora} gerado (${gerados[0].qtd} CT-e). Registrando na jornada...`
      : `${gerados.length} laudos gerados — um por transportadora. Clique em cada um abaixo para baixar.`);

    // ETAPA 2 — registrar a jornada e ativar o link do portal. Já com o laudo
    // na mão do auditor: uma falha aqui não impede o trabalho dele.
    const usuario = carregarSessao();
    const errosJornada = [];
    let portaisAtivos = 0;
    for (const item of gerados) {
      try {
        const processo = await registrarLaudoGerado({
          transportadora: item.nomeTransportadora,
          cnpjTransportadora: item.ctes[0]?.cnpj_transportadora || null,
          competencia,
          ctes: item.ctes,
          observacao: null,
          enviarAgora,
          usuario,
          tokenPortal: item.token,
        });
        if (processo?.portal?.url) portaisAtivos += 1;
      } catch (jornadaError) {
        console.error(`Jornada não registrada para ${item.transportadora}:`, jornadaError);
        errosJornada.push(`${item.transportadora}: ${jornadaError.message || jornadaError}`);
      }
    }

    if (errosJornada.length) {
      setErro(`Laudo(s) gerado(s), mas a jornada falhou: ${errosJornada.join(' | ')}`);
      return;
    }
    const semPortal = gerados.length - portaisAtivos;
    setSucesso(`${gerados.length === 1 ? 'Laudo gerado' : `${gerados.length} laudos gerados`}`
      + (enviarAgora ? ' e envio registrado na jornada.' : '.')
      + (semPortal ? ` Atenção: ${semPortal} link(s) de resposta não ficaram ativos (a migration do portal já rodou?).` : ' Link de resposta ativo.'));
  }

  return (
    <div className="simulador-shell">
      {modalLaudoAberto ? (
        <div
          role="presentation"
          onClick={() => setModalLaudoAberto(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 16, padding: 24, maxWidth: 520, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
          >
            <h2 style={{ marginTop: 0, marginBottom: 4 }}>📄 Gerar laudo do transportador</h2>
            <p style={{ color: '#475569', fontSize: 14, marginTop: 0 }}>
              {fmtN(ctesSelecionadosLaudo.length)} CT-e(s) selecionado(s). O arquivo HTML do laudo é baixado nos dois casos abaixo — a diferença é só o que acontece com a <strong>jornada</strong> desses CT-es.
            </p>
            <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
              <button
                className="primary"
                type="button"
                style={{ textAlign: 'left', padding: '12px 16px' }}
                onClick={() => confirmarGeracaoLaudo(true)}
              >
                <div style={{ fontWeight: 800 }}>✅ Enviar para a transportadora agora</div>
                <div style={{ fontWeight: 400, fontSize: 12, opacity: 0.9 }}>
                  Registra o envio. Os CT-es passam para "Aguardando retorno da transportadora" no painel da jornada.
                </div>
              </button>
              <button
                className="sim-tab"
                type="button"
                style={{ textAlign: 'left', padding: '12px 16px' }}
                onClick={() => confirmarGeracaoLaudo(false)}
              >
                <div style={{ fontWeight: 800 }}>👁️ Só gerar/visualizar</div>
                <div style={{ fontWeight: 400, fontSize: 12, color: '#64748b' }}>
                  Conferência interna. Não altera o status de envio — os CT-es continuam como estavam (ou entram como "Divergente"/"Auditado OK" se ainda não tinham jornada).
                </div>
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="sim-tab" type="button" onClick={() => setModalLaudoAberto(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      ) : null}

      {modalRetornoLoteAberto ? (
        <div
          role="presentation"
          onClick={() => setModalRetornoLoteAberto(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 16, padding: 24, maxWidth: 480, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
          >
            <h2 style={{ marginTop: 0, marginBottom: 4 }}>🧭 Registrar retorno em lote</h2>
            <p style={{ color: '#475569', fontSize: 14, marginTop: 0 }}>
              Aplica o mesmo resultado aos <strong>{fmtN(ctesSelecionadosLaudo.length)}</strong> CT-e(s) marcados na coluna Laudo da tabela.
            </p>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Resultado do retorno</div>
              <select
                value={jornadaForm.resultado}
                onChange={(e) => setJornadaForm((f) => ({ ...f, resultado: e.target.value }))}
                style={{ width: '100%' }}
              >
                {Object.entries(RESULTADOS_RETORNO_TRANSPORTADORA).map(([key, cfg]) => (
                  <option key={key} value={key}>{cfg.label}</option>
                ))}
              </select>
            </div>
            {RESULTADOS_RETORNO_TRANSPORTADORA[jornadaForm.resultado]?.pedeValor ? (
              <div style={{ background: '#fef9c3', border: '1px solid #fde047', borderRadius: 8, padding: 8, fontSize: 12, color: '#854d0e', marginBottom: 12 }}>
                O valor acordado de cada CT-e será a própria divergência identificada dele (não dá pra digitar um valor único pro lote, já que cada CT-e tem uma divergência diferente). Pra um valor específico e diferente da divergência, registre esse CT-e individualmente pelo badge da tabela.
              </div>
            ) : null}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Observação (opcional, aplicada a todos)</div>
              <input
                type="text"
                placeholder="Ex: retorno por e-mail em 18/08, lote respondido pela transportadora X"
                value={jornadaForm.observacao}
                onChange={(e) => setJornadaForm((f) => ({ ...f, observacao: e.target.value }))}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="sim-tab" type="button" onClick={() => setModalRetornoLoteAberto(false)}>Cancelar</button>
              <button className="primary" type="button" disabled={jornadaSalvando} onClick={salvarRetornoJornadaEmLote}>
                {jornadaSalvando ? 'Salvando...' : `Aplicar a ${fmtN(ctesSelecionadosLaudo.length)} CT-e(s)`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="simulador-header compact-top">
        <div className="simulador-subtitulo">Central Fretes • Auditoria</div>
        <h1>Auditoria de CTes</h1>
        <p>
          Cobertura de cálculo, assertividade e priorização de divergências. Fonte principal: <code>realizado_local_ctes</code>.
          O botão <strong>Salvar mês carregado</strong> grava o resultado em <code>auditoria_cte_resultados</code> e o resumo em <code>auditoria_cte_resumo_mensal</code>.
        </p>
        <BaseCtesStatus />
      </div>

      {laudosGerados.length ? (
        <div id="painel-laudos-gerados" className="panel-card" style={{ marginBottom: 16, borderColor: '#0f6b3e', borderWidth: 2 }}>
          <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span>
              📄 {laudosGerados.length === 1 ? 'Laudo pronto' : `${laudosGerados.length} laudos prontos — um por transportadora`}
            </span>
            <button className="sim-tab" type="button" onClick={() => { laudosGerados.forEach((l) => URL.revokeObjectURL(l.url)); setLaudosGerados([]); }}>
              Fechar
            </button>
          </div>
          <p style={{ marginTop: -4, color: 'var(--muted)', fontSize: 13 }}>
            Cada arquivo tem só os CT-es da transportadora dele. Se o download não começou sozinho (o navegador costuma bloquear), clique abaixo.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {laudosGerados.map((laudo) => (
              <button
                key={laudo.nome}
                type="button"
                className="primary"
                onClick={() => baixarArquivoPreparado(laudo)}
                style={{ textAlign: 'left' }}
              >
                ⬇ {laudo.transportadora} <span style={{ fontWeight: 400, opacity: 0.85 }}>({laudo.qtd} CT-e)</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <RespostasPortalPendentes
        competencia={competencia}
        recarregarChave={jornadaVersao}
        onAplicado={async () => {
          if (!registrosDetalheVisiveis.length) return;
          const mapa = await buscarJornadaPorIdentificadores(
            registrosDetalheVisiveis.flatMap((r) => [r.chave_cte, r.numero_cte]).filter(Boolean),
          );
          setJornadaPorChave(mapa);
          setJornadaVersao((v) => v + 1);
        }}
      />

      <PainelPendenciasJornadaCte
        competencia={competencia}
        recarregarChave={jornadaVersao}
        registrosCarregados={registrosAnalise}
        jornadaPorChave={jornadaPorChave}
        carteiras={opcoesPreCarga.carteiras}
        vinculos={opcoesPreCarga.vinculos}
        dentroDaMargem={cteDentroDaMargem}
        onSelecionarGrupo={async (label, lista, opcoes = {}) => {
          if (!label) {
            setFiltroJornada(null);
            return;
          }
          // Só chave_cte (44 dígitos, única globalmente): número de CT-e sozinho
          // pode se repetir entre transportadoras diferentes e traria CT-es errados.
          const chaves = new Set((lista || []).map((item) => item.chave_cte).filter(Boolean).map(String));
          setFiltroJornada({ label, chaves });
          // O filtro do card precisa ser a única fonte da visão — zera qualquer
          // outro filtro ativo (transportadora, tomador, uf, canal, etc.) senão
          // eles brigam e a lista some (interseção vazia).
          setFiltroTransps([]);
          setFiltroTomadores([]);
          setFiltroUfs([]);
          setFiltroCidades([]);
          setFiltroCanais([]);
          setFiltroCriterios([]);
          setFiltroSituacaoFatura([]);
          setLimiteDetalhe((v) => Math.max(v, chaves.size));
          if (modoPreLista) setModoPreLista(false);

          // Cards calculados sobre a competência já carregada: os CT-es estão
          // na tela, basta filtrar. Rebuscar no banco apagaria justamente os
          // que ainda não foram salvos (ex.: os sem cálculo AMD).
          if (opcoes.jaCarregados) {
            requestAnimationFrame(() => {
              document.getElementById('detalhe-ctes-secao')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
            return;
          }

          setCarregando(true);
          setErro('');
          try {
            const dadosBusca = await buscarResultadosAuditoriaPorIdentificadores([...chaves]);
            setRegistros(await enriquecerCtesComFaturas(dadosBusca || []));
            setFonteAuditoria({
              id: 'auditoria_cte_resultados',
              tabela: 'auditoria_cte_resultados',
              label: 'Auditoria salva / auditoria_cte_resultados',
            });
            requestAnimationFrame(() => {
              document.getElementById('detalhe-ctes-secao')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
          } catch (error) {
            setErro(error.message || `Não foi possível buscar os CT-es de "${label}".`);
          } finally {
            setCarregando(false);
          }
        }}
      />

      <div className="tabs-row audit-main-tabs" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className={`toggle-btn ${abaAuditoria === 'mensal' ? 'active' : ''}`}
          onClick={() => setAbaAuditoria('mensal')}
        >
          Auditoria competencia/periodo
        </button>
        <button
          type="button"
          className={`toggle-btn ${abaAuditoria === 'avulsa' ? 'active' : ''}`}
          onClick={() => setAbaAuditoria('avulsa')}
        >
          Auditoria por chave/lista
        </button>
      </div>

      {abaAuditoria === 'avulsa' ? (
        <CentralAuditoriaFretesPage initialTab="auditoria-cte" embedded onMudarPagina={onMudarPagina} onAbrirTransportadoras={onAbrirTransportadoras} />
      ) : (
      <>

      {erro ? <div className="sim-alert error">{erro}</div> : null}
      {sucesso ? <div className="sim-alert success">{sucesso}</div> : null}
      {avisos.length > 0 ? (
        <div className="sim-alert info">
          <strong>Avisos da consulta:</strong> {avisos.join(' | ')}
        </div>
      ) : null}

      {filtrosAtivos && registros.length > 0 && registrosFiltro.length === 0 ? (
        <div className="sim-alert error" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span>
            <strong>Atenção:</strong> há filtros de foco ativos que estão escondendo todos os{' '}
            {registros.length.toLocaleString('pt-BR')} CT-e(s) carregados (0 no foco). Por isso a tela aparece vazia.
          </span>
          <button className="primary" type="button" onClick={limparFiltrosFoco} style={{ whiteSpace: 'nowrap' }}>
            Limpar filtros de foco
          </button>
        </div>
      ) : null}

      <section className="sim-card">
        <div className="sim-alert info" style={{ marginBottom: 14 }}>
          <strong>Fluxo recomendado.</strong> Carregue os CT-es do mês para conferir. Depois clique em <strong>Salvar mês carregado</strong>. Nos próximos acessos, use <strong>Carregar resultado salvo</strong> ou <strong>Carregar resumo mensal</strong>.
        </div>

        <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end' }}>
          <label>
            Competência (mês) <span style={{ color: '#94a3b8', fontWeight: 400 }}>— ou use o período →</span>
            <input
              type="month"
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
            />
          </label>
          <label>
            Período — início (opcional)
            <input
              type="date"
              value={dataInicioTeste}
              onChange={(e) => setDataInicioTeste(e.target.value)}
              title="Carrega a partir desta data de emissão (dispensa a competência)"
            />
          </label>
          <label>
            Período — fim (opcional)
            <input
              type="date"
              value={dataFimTeste}
              onChange={(e) => setDataFimTeste(e.target.value)}
              title="Carrega até esta data de emissão (dispensa a competência)"
            />
          </label>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <MultiCheckList
              titulo="Transportadoras (opcional)"
              opcoes={opcoesPreCarga.transportadoras.map((nome) => ({ value: nome, label: nome }))}
              selecionados={transportadorasPreCargaSelecionadas}
              onToggle={toggleEmLista(setTransportadorasPreCargaSelecionadas)}
              onLimpar={() => setTransportadorasPreCargaSelecionadas([])}
              busca={buscaTransportadoraPreCarga}
              onBusca={setBuscaTransportadoraPreCarga}
              placeholder="Digite para buscar transportadora..."
              maxAltura={150}
              recolhivel
            />
            <MultiCheckList
              titulo="Auditores (opcional)"
              opcoes={opcoesPreCarga.auditores.map((nome) => ({ value: nome, label: nome }))}
              selecionados={auditoresPreCargaSelecionados}
              onToggle={toggleEmLista(setAuditoresPreCargaSelecionados)}
              onLimpar={() => setAuditoresPreCargaSelecionados([])}
              busca={buscaAuditorPreCarga}
              onBusca={setBuscaAuditorPreCarga}
              placeholder="Digite para buscar auditor..."
              maxAltura={150}
              recolhivel
            />
          </div>
          <div style={{ gridColumn: '1 / -1', color: '#64748b', fontSize: 12 }}>
            Período/competência é obrigatório. Com apenas um filtro, todas as opções marcadas são consideradas. Usando os dois, serão buscadas somente as transportadoras selecionadas que pertencem aos auditores marcados.
          </div>
          {filtroPreCargaSemCorrespondencia ? (
            <div className="sim-alert error" style={{ gridColumn: '1 / -1', margin: 0 }}>
              Nenhuma das transportadoras selecionadas pertence aos auditores marcados. Ajuste um dos filtros para carregar.
            </div>
          ) : null}
          {erroOpcoesPreCarga ? (
            <div className="sim-alert error" style={{ gridColumn: '1 / -1', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span>{erroOpcoesPreCarga}</span>
              <button type="button" className="sim-tab" onClick={() => setTentativaOpcoesPreCarga((valor) => valor + 1)}>Tentar novamente</button>
            </div>
          ) : null}
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ fontSize: 12, color: '#475569', fontWeight: 600, marginBottom: 6 }}>
              Canal (pré-filtro — vazio = todos)
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {['B2C', 'ATACADO', 'INTERCOMPANY', 'REVERSA', 'A DEFINIR'].map((c) => {
                const marcado = canaisPreCarga.includes(c);
                return (
                  <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: marcado ? 700 : 500, color: marcado ? '#1d4ed8' : '#334155', cursor: 'pointer', padding: '4px 10px', borderRadius: 6, background: marcado ? '#eff6ff' : '#f1f5f9', border: `1px solid ${marcado ? '#93c5fd' : '#e2e8f0'}` }}>
                    <input type="checkbox" checked={marcado} onChange={() => setCanaisPreCarga((prev) => marcado ? prev.filter((v) => v !== c) : [...prev, c])} style={{ margin: 0 }} />
                    {c}
                  </label>
                );
              })}
              {canaisPreCarga.length > 0 && (
                <button type="button" className="sim-tab" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setCanaisPreCarga([])}>Limpar canal</button>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={apenasDadosCompletosAuditoria}
                onChange={(event) => setApenasDadosCompletosAuditoria(event.target.checked)}
              />
              Considerar apenas CT-es com dados completos (não consultar Tracking)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={usarPesoCteAuditoria}
                onChange={(event) => setUsarPesoCteAuditoria(event.target.checked)}
              />
              Usar peso do CT-e (ignora cubagem)
            </label>
            {usarPesoCteAuditoria && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                % de contingência sobre o peso:
                <input
                  type="number"
                  min="0"
                  max="200"
                  step="1"
                  value={percentualContingenciaPesoAuditoria}
                  onChange={(event) => setPercentualContingenciaPesoAuditoria(Number(event.target.value) || 0)}
                  style={{ width: 70 }}
                />
              </label>
            )}
            <button
              className="sim-tab"
              type="button"
              onClick={() => setMostrarTolerancia((v) => !v)}
              style={{ fontSize: 12, fontWeight: 800 }}
              title="Tolerância salva neste navegador e usada como padrão na auditoria CT-e"
            >
              Tolerância +R$ {fmtN(margemErroCimaValor, 2)} / -R$ {fmtN(margemErroBaixoValor, 2)}
            </button>
            {mostrarTolerancia && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  Acima (R$):
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={margemErroCimaValor}
                    onChange={(event) => atualizarMargemErroCima(Number(event.target.value) || 0)}
                    style={{ width: 70 }}
                    title="Tolera cobrança até R$X acima do calculado antes de marcar como divergente"
                  />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  Abaixo (R$):
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={margemErroBaixoValor}
                    onChange={(event) => atualizarMargemErroBaixo(Number(event.target.value) || 0)}
                    style={{ width: 70 }}
                    title="Tolera cobrança até R$X abaixo do calculado antes de marcar como divergente"
                  />
                </label>
                <span style={{ fontSize: 12, color: '#64748b' }}>
                  Salvo neste navegador — vale para todos os cálculos daqui pra frente.
                </span>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="primary" type="button" onClick={carregar} disabled={carregando || processando || !podeCarregar}>
              {carregando ? 'Carregando...' : 'Carregar CT-es do mês'}
            </button>
            <button className="sim-tab" type="button" onClick={carregarPreLista} disabled={carregando || processando || !podeCarregar} title="Carrega so colunas leves do resultado salvo para montar resumo/Onde Atacar sem abrir o detalhe completo">
              Pre-lista salva
            </button>
            <button className="primary" type="button" onClick={salvarMesCarregado} disabled={carregando || processando || !competencia}>
              {processando ? 'Salvando...' : 'Salvar mês carregado'}
            </button>
            <button className="primary" type="button" onClick={recalcularComFerramenta} disabled={carregando || processando || !podeCarregar} title="Recalcula cada CT-e com as tabelas de frete cadastradas e preserva a Verum para comparação">
              {processando ? 'Processando...' : 'Recalcular com a ferramenta'}
            </button>
            <button className="sim-tab" type="button" onClick={carregarResultadoSalvo} disabled={carregando || processando || !podeCarregar}>
              Carregar resultado salvo
            </button>
            <button className="sim-tab" type="button" onClick={carregarResumoMensal} disabled={carregando || processando}>
              Carregar resumo mensal
            </button>
            {modoPreLista && transportadoraEmTratamento ? (
              <button className="primary" type="button" onClick={carregarTransportadoraCompleta} disabled={carregando || processando}>
                Carregar CT-es da transportadora
              </button>
            ) : null}
            <button className="sim-tab" type="button" onClick={() => setMostrarFiltros((v) => !v)} style={filtrosAtivos ? { borderColor: '#2563eb', color: '#2563eb', fontWeight: 700 } : undefined}>
              Filtros{filtrosAtivos ? ' (ativos)' : ''}
            </button>
            <button className="sim-tab" type="button" onClick={limpar} disabled={carregando || processando}>
              Limpar
            </button>
          </div>
        </div>

        {registros.length > 0 ? (
          <div style={{ marginTop: 14, padding: '14px 16px', borderRadius: 8, background: '#fff', border: '1px solid #dbe3ef' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#334155' }}>Tratamento por transportadora</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                  Escolha uma transportadora, ajuste as tabelas quando necessário e recalcule só esse recorte até estabilizar o resultado.
                </div>
              </div>
              {transportadoraEmTratamento ? (
                <button className="sim-tab" type="button" onClick={limparFiltrosFoco}>
                  Ver todas
                </button>
              ) : null}
            </div>
            <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end' }}>
              <label style={{ position: 'relative' }}>
                Transportadora em tratamento
                <input
                  type="text"
                  value={buscaTratamento}
                  onChange={(event) => setBuscaTratamento(event.target.value)}
                  placeholder={transportadoraEmTratamento || 'Buscar transportadora para tratar...'}
                  disabled={carregando || processando || resimulando}
                  style={{ paddingRight: 100 }}
                />
                <button
                  className="sim-tab"
                  type="button"
                  onClick={() => selecionarTransportadoraTratamento('')}
                  disabled={carregando || processando || resimulando || !transportadoraEmTratamento}
                  style={{ position: 'absolute', right: 6, top: 24, padding: '4px 9px', fontSize: 11 }}
                >
                  Todas
                </button>
                {buscaTratamento.trim() || !transportadoraEmTratamento ? (
                  <div style={{
                    marginTop: 6,
                    border: '1px solid #dbe3ef',
                    borderRadius: 8,
                    background: '#fff',
                    maxHeight: 220,
                    overflowY: 'auto',
                    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)',
                  }}>
                    {transportadorasTratamentoFiltradas.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => selecionarTransportadoraTratamento(item.value)}
                        disabled={carregando || processando || resimulando}
                        style={{
                          width: '100%',
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 12,
                          padding: '8px 10px',
                          border: 0,
                          borderBottom: '1px solid #edf2f7',
                          background: item.value === transportadoraEmTratamento ? '#eff6ff' : '#fff',
                          color: '#0f2147',
                          fontWeight: item.value === transportadoraEmTratamento ? 800 : 600,
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        <span>{item.label}</span>
                        <span style={{ color: '#64748b', whiteSpace: 'nowrap' }}>{item.sub} CT-es</span>
                      </button>
                    ))}
                    {!transportadorasTratamentoFiltradas.length ? (
                      <div style={{ padding: '10px', color: '#94a3b8', fontSize: 12 }}>Nenhuma transportadora encontrada.</div>
                    ) : null}
                    {transportadorasOpcoes.length > transportadorasTratamentoFiltradas.length ? (
                      <div style={{ padding: '7px 10px', color: '#64748b', fontSize: 11, background: '#f8fafc' }}>
                        Mostrando {fmtN(transportadorasTratamentoFiltradas.length)} de {fmtN(transportadorasOpcoes.length)}. Digite para refinar.
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#475569', fontWeight: 700 }}>
                    Selecionada: {transportadoraEmTratamento}
                  </div>
                )}
              </label>
              <div>
                <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700 }}>CT-es no recorte</div>
                <div style={{ fontSize: 22, color: '#0f172a', fontWeight: 800 }}>{fmtN(registrosFiltro.length)}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700 }}>Sem cálculo</div>
                <div style={{ fontSize: 22, color: metricas.totalSemCalculo ? '#dc2626' : '#16a34a', fontWeight: 800 }}>
                  {fmtN(metricas.totalSemCalculo)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700 }}>Assertividade AMD/local</div>
                <div style={{ fontSize: 22, color: assertividadeSistema.taxaRecalculo >= 98 ? '#16a34a' : assertividadeSistema.taxaRecalculo >= 90 ? '#d97706' : '#dc2626', fontWeight: 800 }}>
                  {fmtP(assertividadeSistema.taxaRecalculo)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="primary"
                  type="button"
                  onClick={() => resimularFiltrados(false)}
                  disabled={resimulando || carregando || processando || !registrosFiltro.length || !transportadoraEmTratamento}
                  title="Recalcula apenas os CT-es da transportadora selecionada e atualiza o preview da tela"
                >
                  {resimulando ? 'Recalculando...' : 'Recalcular transportadora'}
                </button>
                <button
                  className="sim-tab"
                  type="button"
                  onClick={() => resimularFiltrados(true)}
                  disabled={resimulando || carregando || processando || !registrosFiltro.length || !transportadoraEmTratamento}
                  title="Recarrega as tabelas de frete do zero (pega ajustes feitos em outra aba) e resimula o recorte atual, sem sair da busca"
                >
                  {resimulando ? 'Atualizando...' : '↻ Atualizar'}
                </button>
                <button
                  className="sim-tab"
                  type="button"
                  onClick={() => setMostrarFiltros((v) => !v)}
                  disabled={carregando || processando || resimulando}
                >
                  Refinar recorte
                </button>
              </div>
            </div>
            {resimuladoInfo ? (
              <div className="sim-alert success" style={{ marginTop: 10 }}>
                <div>{resimuladoInfo}</div>
                {resimuladoDiagnostico.length ? (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#475569' }}>
                    Resultado local: {resimuladoDiagnostico.map((item) => `${item.status}: ${fmtN(item.total)}`).join(' · ')}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {mostrarFiltros ? (
          <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>
                Filtro de foco — marque várias e resimule só o recorte
              </div>
              {filtrosAtivos ? (
                <button className="sim-tab" type="button" onClick={limparFiltrosFoco}>Limpar todos os filtros</button>
              ) : null}
            </div>

            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <MultiCheckList
                titulo="Transportadora"
                opcoes={transportadorasOpcoes}
                selecionados={filtroTransps}
                onToggle={toggleEmLista(setFiltroTransps)}
                onLimpar={() => setFiltroTransps([])}
                busca={buscaTranspFiltro}
                onBusca={setBuscaTranspFiltro}
                placeholder="Buscar transportadora..."
              />
              <div style={{ flex: '1 1 240px', minWidth: 220 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                  {TOMADORES_ATALHO.map((t) => {
                    const marcado = filtroTomadores.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => toggleEmLista(setFiltroTomadores)(t)}
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '3px 9px',
                          borderRadius: 999,
                          cursor: 'pointer',
                          background: marcado ? '#eff6ff' : '#f1f5f9',
                          border: `1px solid ${marcado ? '#93c5fd' : '#e2e8f0'}`,
                          color: marcado ? '#1d4ed8' : '#475569',
                        }}
                      >
                        {marcado ? '✓ ' : ''}{t}
                      </button>
                    );
                  })}
                </div>
                <MultiCheckList
                  titulo="Tomador (contém)"
                  opcoes={tomadoresDisponiveis}
                  selecionados={filtroTomadores}
                  onToggle={toggleEmLista(setFiltroTomadores)}
                  onLimpar={() => setFiltroTomadores([])}
                  busca={buscaTomadorFiltro}
                  onBusca={setBuscaTomadorFiltro}
                  placeholder="Buscar tomador..."
                />
              </div>
              <MultiCheckList
                titulo="Cidade origem"
                opcoes={cidadesDisponiveis}
                selecionados={filtroCidades}
                onToggle={toggleEmLista(setFiltroCidades)}
                onLimpar={() => setFiltroCidades([])}
                busca={buscaCidadeFiltro}
                onBusca={setBuscaCidadeFiltro}
                placeholder="Buscar cidade..."
              />
              <MultiCheckList
                titulo="UF origem (região)"
                opcoes={ufsDisponiveis.map((uf) => ({ value: uf, label: uf }))}
                selecionados={filtroUfs}
                onToggle={toggleEmLista(setFiltroUfs)}
                onLimpar={() => setFiltroUfs([])}
                maxAltura={170}
              />
              <MultiCheckList
                titulo="Canal"
                opcoes={canaisDisponiveis}
                selecionados={filtroCanais}
                onToggle={toggleEmLista(setFiltroCanais)}
                onLimpar={() => setFiltroCanais([])}
                maxAltura={170}
              />
              <MultiCheckList
                titulo="Situação de faturamento"
                opcoes={[
                  { value: 'sem_fatura', label: 'Sem fatura', sub: `${fmtN(registrosAnalise.filter((r) => !r.tem_fatura).length)}` },
                  { value: 'com_fatura', label: 'Com fatura', sub: `${fmtN(registrosAnalise.filter((r) => r.tem_fatura).length)}` },
                ]}
                selecionados={filtroSituacaoFatura}
                onToggle={toggleEmLista(setFiltroSituacaoFatura)}
                onLimpar={() => setFiltroSituacaoFatura([])}
                maxAltura={100}
              />
              <div style={{ flex: '1 1 240px', minWidth: 220 }}>
                <div style={{ fontSize: 12, color: '#475569', fontWeight: 700, marginBottom: 6 }}>Critério de cálculo/status</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {CRITERIOS_FILTRO.map((c) => {
                    const marcado = filtroCriterios.includes(c.key);
                    return (
                      <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: marcado ? '#1d4ed8' : '#334155', fontWeight: marcado ? 700 : 500, cursor: 'pointer' }}>
                        <input type="checkbox" checked={marcado} onChange={() => toggleEmLista(setFiltroCriterios)(c.key)} />
                        {c.label}
                      </label>
                    );
                  })}
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>Nenhum marcado = todos os CT-es.</div>
              </div>
            </div>

            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button
                className="primary"
                type="button"
                onClick={() => resimularFiltrados(false)}
                disabled={resimulando || carregando || processando || !registrosFiltro.length}
                title="Roda o motor de cálculo só nos CT-es do foco atual e atualiza as métricas na tela (não grava no banco)"
              >
                {resimulando ? 'Resimulando...' : `Resimular filtrados (${fmtN(registrosFiltro.length)})`}
              </button>
              <button
                type="button"
                onClick={() => resimularFiltrados(true)}
                disabled={resimulando || carregando || processando || !registrosFiltro.length}
                title="Recarrega as tabelas de frete do zero (pega ajustes feitos em outra aba) e resimula o recorte atual, sem sair da busca"
              >
                {resimulando ? 'Atualizando...' : '↻ Atualizar (tabelas)'}
              </button>
              <span style={{ fontSize: 13, color: filtrosAtivos ? '#2563eb' : '#94a3b8', fontWeight: 600 }}>
                {filtrosAtivos
                  ? `${fmtN(registrosFiltro.length)} CT-e(s) no foco — métricas, tabelas e assertividade refletem só este recorte.`
                  : 'Sem filtro — mostrando a base completa. Marque opções para focar e resimular só elas.'}
              </span>
            </div>
            {resimuladoInfo && !transportadoraEmTratamento ? (
              <div className="sim-alert success" style={{ marginTop: 10 }}>
                <div>{resimuladoInfo}</div>
                {resimuladoDiagnostico.length ? (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#475569' }}>
                    Resultado local: {resimuladoDiagnostico.map((item) => `${item.status}: ${fmtN(item.total)}`).join(' · ')}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <AmdProcessingOverlay ativo={carregando || processando || resimulando || jornadaSalvando} progresso={progressoProcessamento} />
        <BarraProgresso progresso={progressoProcessamento} />

        {fonteAuditoria ? (
          <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569', fontSize: 13 }}>
            Fonte carregada: <strong>{fonteAuditoria.label || fonteAuditoria.tabela}</strong>
          </div>
        ) : null}

        <div style={{ marginTop: 16 }}>
          <ToggleSwitch
            ativo={usarTabelas}
            onChange={toggleUsarTabelas}
            label="Resimular com tabelas cadastradas"
            sublabel={
              usarTabelas
                ? `Ativo — ${fmtN(metricas.totalSemCalculo)} CTe(s) sem cálculo elegíveis para análise de cobertura`
                : 'Desligado — mantenha desligado enquanto a auditoria estiver usando o cálculo já gravado no CTS.'
            }
          />
        </div>

        {temDados ? (
          <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 13, color: '#334155' }}>
              <strong>Placar Verum × AMD.</strong>{' '}
              <span style={{ color: '#64748b' }}>
                Verum = simulação original (referência, intocável) · AMD = nosso motor (número de trabalho que você ajusta).
              </span>
            </div>
            <div style={{ marginTop: 8, fontSize: 13, color: '#475569' }}>
              <strong>AMD × Verum:</strong>{' '}
              {comparacaoVerum.ambos > 0 ? (
                <>
                  <span style={{ color: comparacaoVerum.taxaMatch >= 99 ? '#16a34a' : comparacaoVerum.taxaMatch >= 90 ? '#d97706' : '#dc2626', fontWeight: 700 }}>
                    {fmtP(comparacaoVerum.taxaMatch)} batem
                  </span>{' '}
                  ({fmtN(comparacaoVerum.batem)} de {fmtN(comparacaoVerum.ambos)} com os dois cálculos) ·{' '}
                  {fmtN(comparacaoVerum.divergem)} divergem · dif. média {fmt(comparacaoVerum.difMedia)}
                </>
              ) : (
                <span style={{ color: '#94a3b8' }}>sem CTes com os dois cálculos para comparar (recalcule para gerar o AMD)</span>
              )}
            </div>

            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed #cbd5e1' }}>
              <div style={{ fontSize: 13, color: '#334155', fontWeight: 700, marginBottom: 8 }}>
                Assertividade vs valor cobrado{' '}
                <span style={{ fontWeight: 400, color: '#64748b' }}>(quantos CT-es cada cálculo acerta o realizado)</span>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 200px', padding: '10px 12px', borderRadius: 8, background: '#ecfdf5', border: '1px solid #a7f3d0' }}>
                  <div style={{ fontSize: 12, color: '#047857', fontWeight: 700 }}>Combinada (Verum OU AMD)</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#047857' }}>{fmtP(assertividadeSistema.taxaCombinada)}</div>
                  <div style={{ fontSize: 11, color: '#475569' }}>{fmtN(assertividadeSistema.combinado)} de {fmtN(assertividadeSistema.comAlgumCalculo)} CT-es · base para a meta</div>
                </div>
                <div style={{ flex: '1 1 160px', padding: '10px 12px', borderRadius: 8, background: '#fff', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 12, color: '#1e293b', fontWeight: 700 }}>AMD (nosso motor)</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: assertividadeSistema.taxaRecalculo >= 99 ? '#16a34a' : assertividadeSistema.taxaRecalculo >= 90 ? '#d97706' : '#dc2626' }}>{fmtP(assertividadeSistema.taxaRecalculo)}</div>
                  <div style={{ fontSize: 11, color: '#475569' }}>{fmtN(assertividadeSistema.comRecalculo)} CT-es com recálculo</div>
                </div>
                <div style={{ flex: '1 1 160px', padding: '10px 12px', borderRadius: 8, background: '#fff', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 12, color: '#1e293b', fontWeight: 700 }}>Verum (original)</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: assertividadeSistema.taxaVerum >= 99 ? '#16a34a' : assertividadeSistema.taxaVerum >= 90 ? '#d97706' : '#dc2626' }}>{fmtP(assertividadeSistema.taxaVerum)}</div>
                  <div style={{ fontSize: 11, color: '#475569' }}>{fmtN(assertividadeSistema.comVerum)} CT-es com Verum</div>
                </div>
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
                Só recálculo acertou: <strong>{fmtN(assertividadeSistema.soRecalculo)}</strong> ·{' '}
                Só Verum acertou: <strong>{fmtN(assertividadeSistema.soVerum)}</strong> ·{' '}
                Ambos: <strong>{fmtN(assertividadeSistema.ambosBatem)}</strong> ·{' '}
                Nenhum bateu: <strong style={{ color: assertividadeSistema.nenhumBate > 0 ? '#dc2626' : '#64748b' }}>{fmtN(assertividadeSistema.nenhumBate)}</strong> ·{' '}
                Sem Verum: <strong style={{ color: assertividadeSistema.semVerum > 0 ? '#b45309' : '#64748b' }}>{fmtN(assertividadeSistema.semVerum)}</strong> ·{' '}
                Sem AMD/local: <strong style={{ color: assertividadeSistema.semRecalculo > 0 ? '#b45309' : '#64748b' }}>{fmtN(assertividadeSistema.semRecalculo)}</strong>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {temDados ? (
        <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          <div className="summary-card">
            <span>Total CTes</span>
            <strong>{fmtN(metricas.total)}</strong>
            <small>base filtrada</small>
          </div>
          <div className="summary-card" style={{ borderLeft: '3px solid #3b82f6' }}>
            <span>Com cálculo</span>
            <strong>{fmtN(metricas.totalCalculados)}</strong>
            <small style={{ color: '#3b82f6', fontWeight: 700 }}>{fmtP(metricas.taxaCalculo)} do total</small>
          </div>
          <div className="summary-card" style={{ borderLeft: '3px solid #94a3b8' }}>
            <span>Sem cálculo</span>
            <strong>{fmtN(metricas.totalSemCalculo)}</strong>
            <small style={{ color: metricas.totalSemCalculo > 0 ? '#dc2626' : '#94a3b8', fontWeight: 700 }}>
              {fmtP(100 - metricas.taxaCalculo)} do total
            </small>
          </div>
          <div className="summary-card" style={{ borderLeft: '3px solid #16a34a' }}>
            <span>Assertivos</span>
            <strong>{fmtN(metricas.totalAssertivos)}</strong>
            <small style={{ color: '#16a34a', fontWeight: 700 }}>{fmtP(metricas.taxaAssertividade)} dos calculados</small>
          </div>
          <div className="summary-card" style={{ borderLeft: '3px solid #f59e0b' }}>
            <span>Com divergência</span>
            <strong>{fmtN(metricas.totalDivergentes)}</strong>
            <small style={{ color: metricas.totalDivergentes > 0 ? '#f59e0b' : '#94a3b8', fontWeight: 700 }}>
              {fmtP(metricas.taxaDivergencia)} dos calculados
            </small>
          </div>
          <div className="summary-card" style={{ borderLeft: '3px solid #dc2626' }}>
            <span>Valor divergência</span>
            <strong style={{ fontSize: 15 }}>{fmt(metricas.valorTotalDivergencia)}</strong>
            <small style={{ color: '#dc2626' }}>excessivo: {fmt(metricas.valorExcessivo)}</small>
          </div>
        </div>
      ) : null}

      {temDados && !modoPreLista ? (
        <section className="sim-card">
          <h2 style={{ marginTop: 0 }}>🔎 Diagnóstico do recálculo — onde o motor para</h2>
          <p style={{ color: '#64748b', marginTop: -4 }}>
            Quebra dos CT-es do foco por etapa de casamento (transportadora → origem → rota → faixa).
            Use para saber o que cadastrar/corrigir. {filtrosAtivos ? 'Reflete só o recorte filtrado.' : 'Base completa.'}
          </p>
          <div className="sim-analise-tabela-wrap">
            <table className="sim-analise-tabela">
              <thead>
                <tr>
                  <th>Situação</th>
                  <th>CT-es</th>
                  <th>% do foco</th>
                  <th>Motivo</th>
                  <th>Maiores transportadoras afetadas</th>
                </tr>
              </thead>
              <tbody>
                {diagnosticoRecalculo.map((l) => {
                  const pct = registrosFiltro.length > 0 ? (l.total / registrosFiltro.length) * 100 : 0;
                  const ok = l.status === 'CALCULADO';
                  return (
                    <tr key={l.status}>
                      <td>
                        <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: ok ? '#dcfce7' : '#fee2e2', color: ok ? '#166534' : '#991b1b' }}>
                          {l.label}
                        </span>
                      </td>
                      <td><strong>{fmtN(l.total)}</strong></td>
                      <td>{fmtP(pct)}</td>
                      <td style={{ fontSize: 12, color: '#64748b' }}>{l.motivo || '—'}</td>
                      <td style={{ fontSize: 12, color: '#475569' }}>
                        {l.topTransp.map(([nome, qtd]) => `${nome} (${fmtN(qtd)})`).join(' · ') || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {temDados ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          <button className="sim-tab" type="button" onClick={() => setMostrarAvancado((v) => !v)} style={mostrarAvancado ? { borderColor: '#2563eb', color: '#2563eb', fontWeight: 700 } : undefined}>
            {mostrarAvancado ? 'Ocultar' : 'Mostrar'} seções de gestão (Meta, Por transportadora, Excluídas, Resumo mensal)
          </button>
        </div>
      ) : null}

      {temDados && mostrarAvancado ? (
        <section className="sim-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>📊 Status da Meta da Área</h2>
            {!editandoMeta ? (
              <button className="sim-tab" type="button" onClick={() => { setMetaTemp({ ...meta }); setEditandoMeta(true); }}>
                Editar meta
              </button>
            ) : null}
          </div>

          <div style={{ padding: 14, borderRadius: 10, background: estiloAvaliacaoMeta.bg, border: `1px solid ${estiloAvaliacaoMeta.border}`, color: estiloAvaliacaoMeta.color, marginBottom: 16 }}>
            <strong>{avaliacaoMeta.titulo}</strong>
            <div style={{ fontSize: 13, marginTop: 4 }}>{avaliacaoMeta.mensagem}</div>
          </div>

          {!editandoMeta ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
              <div style={{ padding: 16, borderRadius: 12, background: semaforoCalculo.bg }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>Taxa de cálculo</span>
                  <span style={{ padding: '3px 10px', borderRadius: 999, background: semaforoCalculo.cor, color: '#fff', fontSize: 12, fontWeight: 700 }}>
                    {semaforoCalculo.label}
                  </span>
                </div>
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                  <span style={{ fontSize: 36, fontWeight: 900, color: semaforoCalculo.cor, lineHeight: 1 }}>
                    {fmtP(metricas.taxaCalculo)}
                  </span>
                  <span style={{ color: '#64748b', fontSize: 13, marginBottom: 4 }}>meta: {fmtP(meta.taxaCalculoMeta)}</span>
                </div>
                <BarraMeta atual={metricas.taxaCalculo} meta={meta.taxaCalculoMeta} cor={semaforoCalculo.cor} />
                <div style={{ marginTop: 6, fontSize: 12, color: '#64748b' }}>
                  {fmtN(metricas.totalCalculados)} de {fmtN(metricas.total)} CTes calculados
                </div>
              </div>

              <div style={{ padding: 16, borderRadius: 12, background: semaforoAssert.bg }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>Assertividade dos calculados</span>
                  <span style={{ padding: '3px 10px', borderRadius: 999, background: semaforoAssert.cor, color: '#fff', fontSize: 12, fontWeight: 700 }}>
                    {semaforoAssert.label}
                  </span>
                </div>
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                  <span style={{ fontSize: 36, fontWeight: 900, color: semaforoAssert.cor, lineHeight: 1 }}>
                    {metricas.totalCalculados > 0 ? fmtP(metricas.taxaAssertividade) : '—'}
                  </span>
                  <span style={{ color: '#64748b', fontSize: 13, marginBottom: 4 }}>meta: {fmtP(meta.taxaAssertividadeMeta)}</span>
                </div>
                <BarraMeta atual={metricas.taxaAssertividade} meta={meta.taxaAssertividadeMeta} cor={semaforoAssert.cor} />
                <div style={{ marginTop: 6, fontSize: 12, color: '#64748b' }}>
                  {fmtN(metricas.totalAssertivos)} assertivos · {fmtN(metricas.totalDivergentes)} divergentes · sem cálculo fora da assertividade
                </div>
              </div>
            </div>
          ) : null}

          {editandoMeta ? (
            <div>
              <div className="sim-alert info" style={{ marginBottom: 14 }}>
                <strong>Meta configurada agora:</strong> {fmtP(meta.taxaCalculoMeta, 0)} dos CTes com cálculo e {fmtP(meta.taxaAssertividadeMeta, 0)} de assertividade.<br />
                <strong>Recomendação:</strong> evitar meta de 100% de assertividade como régua principal. Ela pode virar meta injusta por arredondamento, imposto, generalidade e diferença de tabela.
              </div>
              <div className="sim-form-grid sim-grid-3" style={{ marginBottom: 14 }}>
                <label>
                  Meta taxa de cálculo (%)
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={metaTemp.taxaCalculoMeta}
                    onChange={(e) => setMetaTemp((p) => ({ ...p, taxaCalculoMeta: Number(e.target.value) }))}
                  />
                </label>
                <label>
                  Meta assertividade (%)
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={metaTemp.taxaAssertividadeMeta}
                    onChange={(e) => setMetaTemp((p) => ({ ...p, taxaAssertividadeMeta: Number(e.target.value) }))}
                  />
                </label>
                <label>
                  Descrição da meta
                  <input
                    value={metaTemp.descricao}
                    placeholder="Ex: 95% calculados com 98% de assertividade"
                    onChange={(e) => setMetaTemp((p) => ({ ...p, descricao: e.target.value }))}
                  />
                </label>
              </div>
              {metricas.total > 0 ? (
                <div style={{ padding: '10px 14px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #86efac', marginBottom: 14 }}>
                  <span style={{ fontSize: 13, color: '#15803d' }}>
                    💡 <strong>Sugestão baseada nos dados carregados:</strong> cálculo {fmtP(sugestaoMeta.taxaCalculoMeta, 0)}, assertividade {fmtP(sugestaoMeta.taxaAssertividadeMeta, 0)}
                  </span>
                  <button className="sim-tab" type="button" onClick={usarSugestaoMeta} style={{ marginLeft: 12, padding: '3px 10px', fontSize: 12 }}>
                    Usar sugestão
                  </button>
                </div>
              ) : null}
              <div className="sim-actions">
                <button className="primary" type="button" onClick={salvarMeta}>Salvar meta</button>
                <button className="sim-tab" type="button" onClick={() => { setMetaTemp({ ...meta }); setEditandoMeta(false); }}>Cancelar</button>
              </div>
            </div>
          ) : null}

          {meta.descricao && !editandoMeta ? (
            <div style={{ marginTop: 12, color: '#64748b', fontSize: 13 }}>📌 {meta.descricao}</div>
          ) : null}
        </section>
      ) : null}

      {temDados && ondeAtacar.length > 0 ? (
        <section className="sim-card">
          <h2>🎯 Onde Atacar</h2>
          <p style={{ color: '#64748b', marginBottom: 16 }}>Priorizado por impacto financeiro × volume. Ação sugerida automática por situação detectada.</p>
          <div className="sim-analise-tabela-wrap">
            <table className="sim-analise-tabela">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Transportadora</th>
                  <th>Severidade</th>
                  <th>Sem cálculo</th>
                  <th>Divergentes</th>
                  <th>Assertividade</th>
                  <th>Valor divergência</th>
                  <th>Cobrança excessiva</th>
                  <th>Ação sugerida</th>
                  <th>Tratamento</th>
                  {usarTabelas ? <th>Elegíveis resimular</th> : null}
                </tr>
              </thead>
              <tbody>
                {ondeAtacar.map((it, i) => (
                  <tr key={it.transportadora}>
                    <td style={{ color: '#94a3b8', fontSize: 12 }}>{i + 1}</td>
                    <td><strong>{it.transportadora}</strong><div style={{ fontSize: 11, color: '#94a3b8' }}>{fmtN(it.total)} CTes</div></td>
                    <td><BadgeSeveridade severidade={it.severidade} /></td>
                    <td>{it.semCalculo > 0 ? <span style={{ color: '#dc2626', fontWeight: 700 }}>{fmtN(it.semCalculo)}</span> : <span style={{ color: '#94a3b8' }}>—</span>}</td>
                    <td>{it.divergentes > 0 ? <span style={{ color: '#f59e0b', fontWeight: 700 }}>{fmtN(it.divergentes)}</span> : <span style={{ color: '#94a3b8' }}>—</span>}</td>
                    <td>
                      <span style={{ fontWeight: 700, color: it.calculados === 0 ? '#94a3b8' : it.taxaAssertividade >= meta.taxaAssertividadeMeta ? '#16a34a' : it.taxaAssertividade >= 80 ? '#d97706' : '#dc2626' }}>
                        {it.calculados > 0 ? fmtP(it.taxaAssertividade) : '—'}
                      </span>
                    </td>
                    <td style={{ color: it.valorDivergencia > 0 ? '#dc2626' : '#94a3b8', fontWeight: it.valorDivergencia > 0 ? 700 : 400 }}>
                      {it.valorDivergencia > 0 ? fmt(it.valorDivergencia) : '—'}
                    </td>
                    <td style={{ color: it.valorExcessivo > 0 ? '#dc2626' : '#94a3b8' }}>
                      {it.valorExcessivo > 0 ? fmt(it.valorExcessivo) : '—'}
                    </td>
                    <td>
                      <span style={{
                        padding: '3px 8px',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 700,
                        background: it.acaoSugerida.includes('Cadastrar') ? '#fee2e2' : it.acaoSugerida.includes('Revisar') || it.acaoSugerida.includes('Ampliar') ? '#fef3c7' : '#f0fdf4',
                        color: it.acaoSugerida.includes('Cadastrar') ? '#dc2626' : it.acaoSugerida.includes('Revisar') || it.acaoSugerida.includes('Ampliar') ? '#b45309' : '#16a34a',
                      }}>
                        {it.acaoSugerida}
                      </span>
                    </td>
                    <td>
                      <button
                        className="sim-tab"
                        type="button"
                        onClick={() => selecionarTransportadoraTratamento(it.transportadora)}
                        style={{ fontSize: 11, padding: '3px 9px', whiteSpace: 'nowrap' }}
                      >
                        Tratar agora
                      </button>
                    </td>
                    {usarTabelas ? (
                      <td><span style={{ padding: '2px 7px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: '#eff6ff', color: '#1d4ed8' }}>{fmtN(it.semCalculo)} CTes</span></td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {temDados && mostrarAvancado ? (
        <section className="sim-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>Transportadoras fora da análise</h2>
            <span style={{ fontSize: 13, color: excluidas.length ? '#dc2626' : '#94a3b8', fontWeight: 600 }}>
              {excluidas.length
                ? `${fmtN(excluidas.length)} fora · ${fmtN(ctesExcluidos)} CTes ignorados`
                : 'Nenhuma excluída — métricas usam a base completa'}
            </span>
          </div>
          <p style={{ marginTop: 0, color: '#64748b', fontSize: 13 }}>
            Marque transportadoras que não devem entrar nas métricas (ex.: lotação que só calcula após vínculo na Auditoria Lotação). A escolha fica salva neste navegador.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Buscar transportadora..."
              value={filtroBuscaExcluir}
              onChange={(e) => setFiltroBuscaExcluir(e.target.value)}
              style={{ maxWidth: 320, padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6 }}
            />
            {excluidas.length ? (
              <button className="sim-tab" type="button" onClick={limparExcluidas}>
                Limpar exclusões ({fmtN(excluidas.length)})
              </button>
            ) : null}
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8 }}>
            {porTransportadoraCompleto
              .filter((it) => !filtroBuscaExcluir.trim() || it.transportadora.toLowerCase().includes(filtroBuscaExcluir.trim().toLowerCase()))
              .slice(0, 200)
              .map((it) => {
                const marcada = excluidasSet.has(it.transportadora);
                return (
                  <label
                    key={it.transportadora}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', cursor: 'pointer', background: marcada ? '#fef2f2' : 'transparent', borderRadius: 6 }}
                  >
                    <input type="checkbox" checked={marcada} onChange={() => toggleExcluida(it.transportadora)} />
                    <span style={{ fontWeight: marcada ? 700 : 500, color: marcada ? '#dc2626' : '#334155' }}>{it.transportadora}</span>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>
                      {fmtN(it.total)} CTes · {fmtN(it.semCalculo)} sem cálculo
                    </span>
                  </label>
                );
              })}
            {!porTransportadoraCompleto.length ? <div className="empty-note">Carregue a base primeiro.</div> : null}
          </div>
          {porTransportadoraCompleto.length > 200 ? (
            <div className="empty-note">Mostrando 200 de {porTransportadoraCompleto.length}. Use a busca para encontrar as demais.</div>
          ) : null}
        </section>
      ) : null}

      {temDados && mostrarAvancado ? (
        <section className="sim-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>Por transportadora{excluidas.length ? ` (${fmtN(excluidas.length)} fora da análise)` : ''}</h2>
            <button className="sim-tab" type="button" onClick={exportarExcel}>
              Exportar Excel
            </button>
          </div>
          <div className="sim-analise-tabela-wrap">
            <table className="sim-analise-tabela">
              <thead>
                <tr>
                  <th>Transportadora</th>
                  <th>Total</th>
                  <th>Calculados</th>
                  <th>Sem cálculo</th>
                  <th>Assertivos</th>
                  <th>Divergentes</th>
                  <th>% Cálculo</th>
                  <th>% Assertividade</th>
                  <th>Valor CTe</th>
                  <th>Divergência</th>
                  <th>Excessivo</th>
                  <th>Insuficiente</th>
                </tr>
              </thead>
              <tbody>
                {porTransportadora.slice(0, 100).map((it) => (
                  <tr key={it.transportadora}>
                    <td><strong>{it.transportadora}</strong></td>
                    <td>{fmtN(it.total)}</td>
                    <td>{fmtN(it.calculados)}</td>
                    <td style={{ color: it.semCalculo > 0 ? '#dc2626' : '#94a3b8', fontWeight: it.semCalculo > 0 ? 700 : 400 }}>{fmtN(it.semCalculo)}</td>
                    <td style={{ color: '#16a34a' }}>{fmtN(it.assertivos)}</td>
                    <td style={{ color: it.divergentes > 0 ? '#f59e0b' : '#94a3b8', fontWeight: it.divergentes > 0 ? 700 : 400 }}>{fmtN(it.divergentes)}</td>
                    <td><span style={{ fontWeight: 700, color: it.taxaCalculo >= meta.taxaCalculoMeta ? '#16a34a' : '#dc2626' }}>{fmtP(it.taxaCalculo)}</span></td>
                    <td><span style={{ fontWeight: 700, color: it.calculados === 0 ? '#94a3b8' : it.taxaAssertividade >= meta.taxaAssertividadeMeta ? '#16a34a' : it.taxaAssertividade >= 80 ? '#d97706' : '#dc2626' }}>{it.calculados > 0 ? fmtP(it.taxaAssertividade) : '—'}</span></td>
                    <td>{fmt(it.valorCte)}</td>
                    <td style={{ color: it.valorDivergencia > 0 ? '#dc2626' : '#94a3b8', fontWeight: it.valorDivergencia > 0 ? 700 : 400 }}>{it.valorDivergencia > 0 ? fmt(it.valorDivergencia) : '—'}</td>
                    <td style={{ color: it.valorExcessivo > 0 ? '#dc2626' : '#94a3b8' }}>{it.valorExcessivo > 0 ? fmt(it.valorExcessivo) : '—'}</td>
                    <td style={{ color: it.valorInsuficiente > 0 ? '#f59e0b' : '#94a3b8' }}>{it.valorInsuficiente > 0 ? fmt(it.valorInsuficiente) : '—'}</td>
                  </tr>
                ))}
                {!porTransportadora.length ? <tr><td colSpan="12" style={{ textAlign: 'center', color: '#94a3b8' }}>Nenhum dado. Carregue a base primeiro.</td></tr> : null}
              </tbody>
            </table>
          </div>
          {porTransportadora.length > 100 ? (
            <div className="empty-note">Mostrando 100 de {porTransportadora.length} transportadoras. Exporte o Excel para ver todas.</div>
          ) : null}
        </section>
      ) : null}

      {temDados && !modoPreLista ? (
        <section className="sim-card" id="detalhe-ctes-secao">
          {filtroJornada ? (
            <div
              style={{
                display: 'flex', flexDirection: 'column', gap: 4,
                background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 10, padding: '8px 12px', marginBottom: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#3730a3' }}>
                  🧭 Filtro da jornada ativo: {filtroJornada.label} ({fmtN(filtroJornada.chaves.size)} CT-e(s) no grupo)
                </span>
                <button className="sim-tab" type="button" onClick={() => setFiltroJornada(null)}>Limpar filtro</button>
              </div>
              <span style={{ fontSize: 12, color: '#3730a3' }}>
                {/* Sempre soma o recorte que está de fato na tela (com quaisquer outros filtros aplicados por cima) — não o grupo bruto do card. */}
                Neste recorte ({fmtN(registrosFiltro.length)} CT-e(s) exibido(s)): divergência {fmt(registrosFiltro.reduce((acc, r) => acc + Math.abs(Number(r.diferenca ?? ((Number(r.valor_cte || 0)) - (Number(r.valor_calculado || 0))))), 0))}
              </span>
            </div>
          ) : null}
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '6px 10px', marginBottom: 10, fontSize: 12, color: '#166534' }}>
            💡 Para registrar a resposta da transportadora (concordou, cancelou, desconto...), clique no badge da coluna <strong>Jornada</strong> (última coluna da tabela) na linha do CT-e.
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>📄 Detalhe por CT-e</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select
                value={ordenacaoDetalhe}
                onChange={(event) => {
                  setOrdenacaoDetalhe(event.target.value);
                  setCteExpandido(null);
                }}
                title="Ordenar CT-es do detalhe"
                style={{ minWidth: 210 }}
              >
                <option value="original">Ordem carregada (sem classificar)</option>
                <option value="dif_amd_desc">Maior Dif. AMD</option>
                <option value="dif_amd_asc">Menor Dif. AMD</option>
                <option value="dif_verum_desc">Maior Dif. Verum</option>
                <option value="dif_verum_asc">Menor Dif. Verum</option>
                <option value="frete_pago_desc">Maior frete pago</option>
                <option value="peso_desc">Maior peso</option>
                <option value="cte_asc">Nº CT-e crescente</option>
              </select>
              <button className="sim-tab" type="button" onClick={aplicarPesosDentroToleranciaFiltro}>
                Aplicar pesos OK no filtro
              </button>
              <button className="sim-tab" type="button" onClick={exportarCtesDetalhe}>
                Exportar Excel ({fmtN(registrosFiltro.length)})
              </button>
              <button className="sim-tab" type="button" onClick={selecionarDivergentesLaudo}>Selecionar incorretos</button>
              <button
                className="sim-tab"
                type="button"
                onClick={selecionarDentroDaMargemLaudo}
                title="Marca os CT-es destacados em verde (com cálculo AMD e diferença dentro da tolerância)"
              >
                Selecionar corretos
              </button>
              <button
                type="button"
                disabled={!ctesSelecionadosLaudo.length || jornadaSalvando}
                onClick={marcarSelecionadosComoOk}
                title="Marca os CT-es selecionados como auditados OK na jornada (sem impacto financeiro)"
                style={{
                  background: '#dcfce7', color: '#166534', border: '1px solid #86efac',
                  borderRadius: 8, padding: '6px 12px', fontWeight: 700,
                  cursor: ctesSelecionadosLaudo.length && !jornadaSalvando ? 'pointer' : 'not-allowed',
                  opacity: ctesSelecionadosLaudo.length && !jornadaSalvando ? 1 : 0.55,
                }}
              >
                {jornadaSalvando ? 'Salvando...' : `✅ Marcar como OK (${fmtN(ctesSelecionadosLaudo.length)})`}
              </button>
              <button className="sim-tab" type="button" onClick={selecionarTodosLaudo} disabled={!registrosDetalheOrdenados.length}>
                {registrosDetalheOrdenados.length > 0
                  && registrosDetalheOrdenados.every((row, indice) => ctesSelecionadosLaudo.includes(identificadorCteAuditoria(row, indice)))
                  ? 'Desmarcar todos'
                  : `Selecionar todos (${fmtN(registrosDetalheOrdenados.length)})`}
              </button>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#475569' }}>
                <input type="checkbox" checked={mostrarCobrancaAMenorLaudo} onChange={(event) => setMostrarCobrancaAMenorLaudo(event.target.checked)} />
                Mostrar cobrança a menor no laudo
              </label>
              <button className="primary" type="button" disabled={!ctesSelecionadosLaudo.length} onClick={abrirModalLaudo}>
                Laudo transportador ({fmtN(ctesSelecionadosLaudo.length)})
              </button>
              <button
                className="sim-tab"
                type="button"
                disabled={!ctesSelecionadosLaudo.length}
                title="Aplica o mesmo retorno da transportadora (jornada) a todos os CT-es marcados na coluna Laudo"
                onClick={() => setModalRetornoLoteAberto(true)}
              >
                🧭 Registrar retorno em lote ({fmtN(ctesSelecionadosLaudo.length)})
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ color: '#64748b', fontSize: 12, fontWeight: 700 }}>
              Exibindo {fmtN(Math.min(limiteDetalhe, registrosDetalheOrdenados.length))} de {fmtN(registrosDetalheOrdenados.length)} CT-e(s) do recorte.
            </span>
            {registrosDetalheOrdenados.length > limiteDetalhe ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="sim-tab" type="button" onClick={() => setLimiteDetalhe((v) => v + 200)}>
                  Mostrar mais 200
                </button>
                <button className="sim-tab" type="button" onClick={() => setLimiteDetalhe(registrosDetalheOrdenados.length)}>
                  Mostrar todos do recorte
                </button>
              </div>
            ) : null}
          </div>
          <p style={{ marginTop: 0, color: '#64748b', fontSize: 13 }}>
            Uma linha por CT-e do recorte. <strong>Frete Pago</strong> = cobrado · <strong>Verum</strong> = simulação original (referência) · <strong>AMD</strong> = nosso motor.
            Clique numa linha para ver o detalhe do cálculo. {filtrosAtivos ? 'Reflete o recorte filtrado.' : 'Base completa.'}
          </p>
          <div className="sim-analise-tabela-wrap">
            <table className="sim-analise-tabela">
              <thead>
                <tr>
                  <th title="Selecionar para o laudo">Laudo</th>
                  <th>Nº CT-e</th>
                  <th>Emissão</th>
                  <th>Fatura</th>
                  <th>Transportadora</th>
                  <th>Validação</th>
                  <th>Origem → Destino</th>
                  <th>Peso</th>
                  <th>Frete Pago</th>
                  <th>Cálculo Verum</th>
                  <th>Dif. Verum</th>
                  <th>Cálculo AMD</th>
                  <th>Dif. AMD</th>
                  <th>Status</th>
                  <th title="Em que fase o CT-e está na Jornada (auditoria preventiva)">Jornada</th>
                </tr>
              </thead>
              <tbody>
                {registrosDetalheVisiveis.map((r, idx) => {
                  const jornada = jornadaPorChave.get(String(r.chave_cte)) || jornadaPorChave.get(String(r.numero_cte));
                  const verum = Number(r.valor_calculado_verum || 0);
                  const amd = Number(r.valor_calculado || 0);
                  const pago = Number(r.valor_cte || 0);
                  const difVerum = r.diferenca_verum !== undefined && r.diferenca_verum !== null
                    ? Number(r.diferenca_verum) : (verum > 0 ? pago - verum : 0);
                  const difAmd = r.diferenca !== undefined && r.diferenca !== null
                    ? Number(r.diferenca) : (amd > 0 ? pago - amd : 0);
                  const det = (() => {
                    const d = r.detalhes_calculo;
                    if (!d) return null;
                    if (typeof d === 'object') return d;
                    try { return JSON.parse(d); } catch { return null; }
                  })();
                  const expandida = cteExpandido === idx;
                  const corDif = (v, base) => (base <= 0 ? '#94a3b8' : !ehDivergenteComMargem(v, base, margensDivergencia) ? '#16a34a' : '#dc2626');
                  const dentroDaMargem = amd > 0 && !ehDivergenteComMargem(difAmd, amd, margensDivergencia);
                  const semValorNf = auditoriaSemValorNf(r);
                  const alternativasPeso = (Array.isArray(det?.comparativo_pesos) ? det.comparativo_pesos : [])
                    .map((alt) => ({ ...alt, pesoAlternativo: pesoAlternativaAuditoria(alt) }))
                    .filter((alt) => alt.pesoAlternativo > 0 && Math.abs(alt.pesoAlternativo - Number(r.peso || 0)) > 0.1)
                    .sort((a, b) => Number(a.diferenca_abs || 999999) - Number(b.diferenca_abs || 999999))
                    .slice(0, 2);
                  return (
                    <React.Fragment key={r.chave_cte || r.numero_cte || idx}>
                      <tr
                        onClick={() => setCteExpandido(expandida ? null : idx)}
                        style={{
                          cursor: 'pointer',
                          background: semValorNf ? '#fff7ed' : expandida ? '#eff6ff' : dentroDaMargem ? '#f0fdf4' : undefined,
                          borderLeft: semValorNf ? '3px solid #f97316' : dentroDaMargem ? '3px solid #16a34a' : '3px solid transparent',
                        }}
                      >
                        <td onClick={(event) => event.stopPropagation()}>
                          <input type="checkbox" checked={ctesSelecionadosLaudo.includes(identificadorCteAuditoria(r, idx))} onChange={() => alternarCteLaudo(r, idx)} aria-label={`Selecionar CT-e ${r.numero_cte || ''} para o laudo`} />
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>{r.numero_cte || '—'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDataEmissaoAuditoria(r)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {r.tem_fatura ? <strong style={{ color: '#166534' }}>{(r.numeros_fatura || []).join(', ') || 'Com fatura'}</strong> : <span style={{ color: '#b45309' }}>Sem fatura</span>}
                        </td>
                        <td><strong>{r.transportadora || '—'}</strong></td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {transportadoraValidadaAuditoria(r)
                            ? <span style={{ background: '#dcfce7', color: '#166534', borderRadius: 999, padding: '3px 7px', fontSize: 10, fontWeight: 800 }}>✓ Tabela validada</span>
                            : <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 999, padding: '3px 7px', fontSize: 10, fontWeight: 800 }}>Validação pendente</span>}
                        </td>
                        <td style={{ fontSize: 12 }}>{(r.cidade_origem || '—')}/{r.uf_origem || '—'} → {(r.cidade_destino || '—')}/{r.uf_destino || '—'}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <strong>{fmtN(Number(r.peso || 0), 0)}</strong>
                            {alternativasPeso.map((alternativa) => (
                              <button
                                key={`${alternativa.nome}-${alternativa.pesoAlternativo}`}
                                className="sim-tab"
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  aplicarAlternativaPeso(r, { ...alternativa, peso_considerado: alternativa.pesoAlternativo });
                                }}
                                title={`Aplicar ${alternativa.nome || 'alternativa de peso'} nesta linha`}
                                style={{ padding: '1px 6px', fontSize: 11 }}
                              >
                                usar {fmtN(alternativa.pesoAlternativo, 1)} kg
                              </button>
                            ))}
                          </div>
                        </td>
                        <td>{fmt(pago)}</td>
                        <td style={{ color: verum > 0 ? '#334155' : '#94a3b8' }}>{verum > 0 ? fmt(verum) : '—'}</td>
                        <td style={{ color: corDif(difVerum, verum), fontWeight: 600 }}>{verum > 0 ? fmt(difVerum) : '—'}</td>
                        <td style={{ color: amd > 0 ? '#334155' : '#94a3b8' }}>{amd > 0 ? fmt(amd) : '—'}</td>
                        <td style={{ color: corDif(difAmd, amd), fontWeight: 600 }}>{amd > 0 ? fmt(difAmd) : '—'}</td>
                        <td style={{ fontSize: 11 }}>
                          <span
                            title={r.motivo_sem_calculo || (amd > 0 ? 'Calculado pela tabela local.' : 'Sem cálculo pela tabela local.')}
                            style={{ padding: '2px 6px', borderRadius: 6, fontWeight: 700, background: semValorNf ? '#fed7aa' : amd > 0 ? '#dcfce7' : '#fee2e2', color: semValorNf ? '#9a3412' : amd > 0 ? '#166534' : '#991b1b' }}
                          >
                            {semValorNf ? 'SEM VALOR NF' : (r.status_calculo || (amd > 0 ? 'CALCULADO' : 'SEM_STATUS'))}
                          </span>
                        </td>
                        <td style={{ fontSize: 11 }}>
                          {jornada ? (
                            <span
                              role="button"
                              tabIndex={0}
                              title={(jornada.aguardando_desde ? `Aguardando desde ${new Date(jornada.aguardando_desde).toLocaleDateString('pt-BR')}. ` : '') + 'Clique para registrar o retorno da transportadora.'}
                              onClick={(event) => {
                                event.stopPropagation();
                                setJornadaEditando((atual) => (atual === jornada.chave_cte ? null : jornada.chave_cte));
                                setJornadaForm({ resultado: 'concordou_desconto', valorAcordado: '', observacao: '' });
                              }}
                              style={{
                                padding: '2px 6px', borderRadius: 6, fontWeight: 700, whiteSpace: 'nowrap', cursor: 'pointer',
                                border: jornadaEditando === jornada.chave_cte ? '2px solid var(--primary)' : '2px solid transparent',
                                background: JORNADA_COR[jornada.status_operacional]?.bg || '#e2e8f0',
                                color: JORNADA_COR[jornada.status_operacional]?.fg || '#334155',
                              }}
                            >
                              {STATUS_OPERACIONAL[jornada.status_operacional] || jornada.status_operacional}
                            </span>
                          ) : (
                            <span style={{ color: '#94a3b8' }} title="Este CT-e ainda não entrou em nenhum laudo/processo da jornada">— sem jornada</span>
                          )}
                        </td>
                      </tr>
                      {jornada && jornadaEditando === jornada.chave_cte ? (
                        <tr>
                          <td colSpan="15" style={{ background: '#eef2ff', padding: 12 }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
                              <div>
                                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, color: '#3730a3' }}>Retorno da transportadora</div>
                                <select
                                  value={jornadaForm.resultado}
                                  onChange={(e) => setJornadaForm((f) => ({ ...f, resultado: e.target.value }))}
                                  style={{ minWidth: 260 }}
                                >
                                  {Object.entries(RESULTADOS_RETORNO_TRANSPORTADORA).map(([key, cfg]) => (
                                    <option key={key} value={key}>{cfg.label}</option>
                                  ))}
                                </select>
                              </div>
                              {RESULTADOS_RETORNO_TRANSPORTADORA[jornadaForm.resultado]?.pedeValor ? (
                                <div>
                                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, color: '#3730a3' }}>Valor acordado (R$)</div>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    placeholder="vazio = divergência"
                                    title="Deixe em branco para usar automaticamente a divergência identificada deste CT-e. Preencha só se o valor acordado for diferente."
                                    value={jornadaForm.valorAcordado}
                                    onChange={(e) => setJornadaForm((f) => ({ ...f, valorAcordado: e.target.value }))}
                                    style={{ width: 120 }}
                                  />
                                </div>
                              ) : null}
                              <div style={{ flex: 1, minWidth: 200 }}>
                                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, color: '#3730a3' }}>Observação (opcional)</div>
                                <input
                                  type="text"
                                  placeholder="Ex: retorno por e-mail em 18/08"
                                  value={jornadaForm.observacao}
                                  onChange={(e) => setJornadaForm((f) => ({ ...f, observacao: e.target.value }))}
                                  style={{ width: '100%' }}
                                />
                              </div>
                              <button
                                className="primary"
                                type="button"
                                disabled={jornadaSalvando}
                                onClick={() => salvarRetornoJornada(jornada.chave_cte)}
                              >
                                {jornadaSalvando ? 'Salvando...' : 'Salvar retorno'}
                              </button>
                              <button className="sim-tab" type="button" onClick={() => setJornadaEditando(null)}>Cancelar</button>
                            </div>

                            {jornada.status_operacional === 'CANCELAMENTO_SOLICITADO' ? (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginTop: 10, paddingTop: 10, borderTop: '1px dashed #c7d2fe' }}>
                                <div style={{ flex: 1, minWidth: 220 }}>
                                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, color: '#075985' }}>🔄 Vincular CT-e substituto (reemissão)</div>
                                  <input
                                    type="text"
                                    placeholder="Chave ou número do novo CT-e"
                                    value={reemissaoForm.chaveSubstituto}
                                    onChange={(e) => setReemissaoForm((f) => ({ ...f, chaveSubstituto: e.target.value }))}
                                    style={{ width: '100%' }}
                                  />
                                </div>
                                <div style={{ flex: 1, minWidth: 200 }}>
                                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, color: '#075985' }}>Observação (opcional)</div>
                                  <input
                                    type="text"
                                    placeholder="Ex: reemitido em 18/08"
                                    value={reemissaoForm.motivo}
                                    onChange={(e) => setReemissaoForm((f) => ({ ...f, motivo: e.target.value }))}
                                    style={{ width: '100%' }}
                                  />
                                </div>
                                <button
                                  type="button"
                                  disabled={reemissaoSalvando || !reemissaoForm.chaveSubstituto.trim()}
                                  onClick={() => handleVincularReemissao(jornada.chave_cte)}
                                  style={{ background: '#dbeafe', color: '#1e40af', border: '1px solid #93c5fd', borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer' }}
                                >
                                  {reemissaoSalvando ? 'Vinculando...' : 'Vincular e marcar como cancelado'}
                                </button>
                              </div>
                            ) : null}

                            {jornada.status_operacional === 'CANCELADO' && jornada.chave_cte_substituto ? (
                              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #c7d2fe', fontSize: 12, color: '#065f46' }}>
                                ✅ Cancelado e substituído pelo CT-e <strong>{jornada.chave_cte_substituto}</strong>
                                {jornada.valor_recuperado ? <> — recuperado {Number(jornada.valor_recuperado).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</> : null}
                                {jornada.motivo_cancelamento_reemissao ? <div style={{ color: '#475569' }}>{jornada.motivo_cancelamento_reemissao}</div> : null}
                              </div>
                            ) : null}

                            {jornada.chave_cte_original ? (
                              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #c7d2fe', fontSize: 12, color: '#3730a3' }}>
                                🔗 Este CT-e é a reemissão do CT-e cancelado <strong>{jornada.chave_cte_original}</strong>
                              </div>
                            ) : null}

                            {ehGestorAuditoria ? (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginTop: 10, paddingTop: 10, borderTop: '1px dashed #c7d2fe' }}>
                                <div style={{ flex: 1, minWidth: 220 }}>
                                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, color: '#991b1b' }}>🔒 Só gestor · Anular auditoria (volta pra "Não auditado")</div>
                                  <input
                                    type="text"
                                    placeholder="Motivo da anulação (obrigatório)"
                                    value={anularMotivo}
                                    onChange={(e) => setAnularMotivo(e.target.value)}
                                    style={{ width: '100%' }}
                                  />
                                </div>
                                <button
                                  type="button"
                                  disabled={jornadaSalvando || !anularMotivo.trim()}
                                  onClick={() => handleAnularJornada(jornada.chave_cte)}
                                  style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer' }}
                                >
                                  {jornadaSalvando ? 'Anulando...' : '🗑️ Anular'}
                                </button>
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ) : null}
                      {expandida ? (
                        <tr>
                          <td colSpan="15" style={{ background: '#f8fafc', fontSize: 12, color: '#475569' }}>
                            {r.motivo_sem_calculo ? <div style={{ color: '#b45309', marginBottom: 6 }}><strong>Motivo:</strong> {r.motivo_sem_calculo}</div> : null}
                            {semValorNf ? (
                              <div style={{ background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 8, padding: 10, marginBottom: 10, color: '#9a3412' }}>
                                <strong>CT-e sem valor de NF.</strong> Trate pela auditoria por chave/lista ou pela fatura: informe a chave NF, busque no Tracking e marque reentrega quando for 50% da ida.
                              </div>
                            ) : null}
                            {amd <= 0 ? (
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                                <button
                                  className="sim-tab"
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
                                  className="sim-tab"
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
                            {det ? (
                              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                                <span><strong>Tipo:</strong> {r.tipo_calculo || det.tipo_calculo || '—'}</span>
                                <span><strong>Origem tabela:</strong> {det.origem_cidade || '—'}</span>
                                <span><strong>Rota:</strong> {det.rota_nome || '—'}</span>
                                <span>
                                  {det.origem_validada ? (
                                    <span style={{ background: '#dcfce7', color: '#166534', borderRadius: 999, padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>✓ Tabela validada</span>
                                  ) : (
                                    <span style={{ background: '#f1f5f9', color: '#64748b', borderRadius: 999, padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>Tabela pendente</span>
                                  )}
                                </span>
                                <span><strong>Valor base:</strong> {fmt(det.valor_base)}</span>
                                <span><strong>Subtotal:</strong> {fmt(det.subtotal)}</span>
                                <span><strong>ICMS:</strong> {fmt(det.icms)}</span>
                                <span><strong>Taxas:</strong> {fmtMaybe(somaTaxasCalculo(det.taxas || {}))}</span>
                              </div>
                            ) : <span>Sem detalhe de cálculo para este CT-e.</span>}
                            {det ? (() => {
                              const frete = det.componentes_base || {};
                              const taxas = det.taxas || {};
                              const valorEmergencial = Number(frete.valorEmergencial || 0);
                              const totalTaxas = somaTaxasCalculo(taxas) + valorEmergencial;
                              const taxaExtraDetalhes = Array.isArray(taxas.taxasExtrasDetalhes) ? taxas.taxasExtrasDetalhes : [];
                              const linhaTaxa = (label, valorNumero, extra) => {
                                if (ocultarTaxasZeradas && !(Number(valorNumero) > 0)) return null;
                                return linhaDetalhe(label, fmtMaybe(valorNumero), extra);
                              };
                              const comparativoPesos = Array.isArray(det.comparativo_pesos) ? det.comparativo_pesos : [];
                              return (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginTop: 12 }}>
                                  <div style={{ border: '1px solid #dbe3ef', borderRadius: 8, background: '#fff', padding: 12 }}>
                                    <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>Resumo do calculo</div>
                                    {linhaDetalhe('Motor', det.motor === 'simulador_realizado' ? 'Simulador realizado' : 'Auditoria')}
                                    {linhaDetalhe('Tipo', r.tipo_calculo || det.tipo_calculo || frete.tipoCalculo || '-')}
                                    {linhaDetalhe('Tabela usada', r.transportadora_tabela || det.transportadora_tabela || '-')}
                                    {linhaDetalhe('Origem tabela', det.origem_cidade || '-')}
                                    {linhaDetalhe('Tabela validada?', det.origem_validada ? `Sim${det.origem_validado_por ? ` (${det.origem_validado_por})` : ''}` : 'Não')}
                                    {linhaDetalhe('Rota/cotacao', det.rota_nome || '-')}
                                    {linhaDetalhe('Peso considerado', `${fmtN(det.peso_considerado ?? frete.pesoConsiderado ?? r.peso, 3)} kg`)}
                                    {linhaDetalhe('Valor NF', fmtMaybe(r.valor_nf), true)}
                                    {linhaDetalhe('Frete pago', fmtMaybe(r.valor_cte), true)}
                                    {linhaDetalhe('Calculo AMD/local', fmtMaybe(r.valor_calculado), true)}
                                  </div>
                                  <div style={{ border: '1px solid #dbe3ef', borderRadius: 8, background: '#fff', padding: 12 }}>
                                    <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>Base do frete</div>
                                    {linhaDetalhe('Percentual aplicado', fmtPctDetalhe(frete.percentualAplicado))}
                                    {linhaDetalhe('Valor percentual', fmtMaybe(frete.valorPercentualCalculado ?? frete.valorPercentual))}
                                    {linhaDetalhe('R$/kg aplicado', fmtMaybe(frete.rsKgAplicado))}
                                    {linhaDetalhe('Valor kg garantia', fmtMaybe(frete.valorKgGarantia ?? frete.valorKg))}
                                    {frete.composicaoFrete === 'PESO_MAIS_PERCENTUAL' ? linhaDetalhe('Peso + percentual', fmtMaybe(frete.valorPesoMaisPercentual), true) : null}
                                    {linhaDetalhe('Frete minimo rota', fmtMaybe(frete.minimoRota))}
                                    {linhaDetalhe('Frete minimo cotacao', fmtMaybe(frete.freteMinimoCotacao ?? frete.minimoCotacao))}
                                    {linhaDetalhe('Frete minimo geral', fmtMaybe(frete.freteMinimoGeneralidade ?? frete.minimoGeneralidade))}
                                    {linhaDetalhe('Minimo aplicavel', fmtMaybe(frete.minimoAplicavel))}
                                    {linhaDetalhe('Componente vencedor', frete.componenteBase === 'pesoMaisPercentual' ? 'Peso + percentual' : (frete.componenteBase || det.componente_base || '-'), true)}
                                    {linhaDetalhe('Valor base', fmtMaybe(det.valor_base ?? frete.valorBase), true)}
                                  </div>
                                  {comparativoPesos.length ? (
                                    <div style={{ border: '1px solid #dbe3ef', borderRadius: 8, background: '#fff', padding: 12 }}>
                                      <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>Comparativo de peso</div>
                                      {linhaDetalhe('Peso declarado CT-e', `${fmtN(det.peso_declarado_cte, 3)} kg`)}
                                      {linhaDetalhe('Peso cubado calculado', `${fmtN(det.peso_cubado_tracking, 3)} kg`)}
                                      {Number(det.peso_cubado_original_tracking) > 0 ? linhaDetalhe('Peso/cubagem original Tracking', fmtN(det.peso_cubado_original_tracking, 6)) : null}
                                      {Number(det.cubagem_tracking) > 0 ? linhaDetalhe('Cubagem Tracking', `${fmtN(det.cubagem_tracking, 6)} m³`) : null}
                                      {comparativoPesos.map((alt) => {
                                        const pesoCubadoSugerido = pesoCubadoSugeridoAuditoria(alt, det);
                                        const cubagemAlt = Number(alt.cubagem_aplicada || 0);
                                        const fatorAlt = Number(alt.fator_cubagem || 0);
                                        const isCubagem = cubagemAlt > 0 && fatorAlt > 0;
                                        return (
                                        <div key={alt.nome} style={{ borderTop: '1px solid #e2e8f0', marginTop: 8, paddingTop: 8 }}>
                                          {linhaDetalhe(isCubagem ? 'Peso cubado sugerido' : alt.nome, isCubagem ? `${fmtN(pesoCubadoSugerido, 3)} kg` : fmtMaybe(alt.valor_calculado), alt.nome === det.melhor_comparativo_peso)}
                                          {linhaDetalhe('Peso usado no recalculo', `${fmtN(alt.peso_considerado, 3)} kg`)}
                                          {Number(alt.cubagem_aplicada) > 0 ? linhaDetalhe('Cubagem usada', `${fmtN(alt.cubagem_aplicada, 6)} m³`) : null}
                                          {Number(alt.fator_cubagem) > 0 ? linhaDetalhe('Fator cubagem', `${fmtN(alt.fator_cubagem, 0)} kg/m³`) : null}
                                          {isCubagem ? linhaDetalhe('Conta', `${fmtN(cubagemAlt, 6)} x ${fmtN(fatorAlt, 0)}`) : null}
                                          {linhaDetalhe('Frete recalculado', fmtMaybe(alt.valor_calculado))}
                                          {linhaDetalhe('Diferença vs pago', fmtMaybe(alt.diferenca), alt.nome === det.melhor_comparativo_peso)}
                                        </div>
                                        );
                                      })}
                                    </div>
                                  ) : null}
                                  <div style={{ border: '1px solid #dbe3ef', borderRadius: 8, background: '#fff', padding: 12 }}>
                                    <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>ICMS e totalizacao</div>
                                    {linhaDetalhe('Subtotal antes da emergencial', fmtMaybe(frete.subtotalSemEmergencial))}
                                    {Number(frete.taxaEmergencialPct) > 0 ? linhaDetalhe('Taxa emergencial', `${fmtPctDetalhe(frete.taxaEmergencialPct)} = ${fmtMaybe(frete.valorEmergencial)}`, true) : null}
                                    {linhaDetalhe('Subtotal sem ICMS', fmtMaybe(det.subtotal ?? frete.subtotal), true)}
                                    {linhaDetalhe('Aliquota ICMS', fmtPctDetalhe(det.aliquota_icms ?? frete.aliquotaIcms))}
                                    {linhaDetalhe('Origem aliquota', det.origem_aliquota_icms || frete.origemAliquotaIcms || '-')}
                                    {linhaDetalhe('UF origem/destino', `${det.uf_origem_icms || frete.ufOrigem || '-'} -> ${det.uf_destino_icms || frete.ufDestino || '-'}`)}
                                    {linhaDetalhe('ICMS', fmtMaybe(det.icms ?? frete.icms), true)}
                                    {linhaDetalhe('Total calculado', fmtMaybe(r.valor_calculado), true)}
                                    {linhaDetalhe('Diferenca vs pago', fmtMaybe(r.diferenca), true)}
                                  </div>
                                  <div style={{ border: '1px solid #dbe3ef', borderRadius: 8, background: '#fff', padding: 12 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                      <div style={{ fontWeight: 800, color: '#0f172a' }}>Taxas</div>
                                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#64748b', fontWeight: 400, cursor: 'pointer' }}>
                                        <input
                                          type="checkbox"
                                          checked={ocultarTaxasZeradas}
                                          onChange={(e) => { e.stopPropagation(); setOcultarTaxasZeradas(e.target.checked); }}
                                          onClick={(e) => e.stopPropagation()}
                                        />
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
                                      .filter((taxa) => !ocultarTaxasZeradas || Number(taxa.valor) > 0)
                                      .map((taxa, i) => linhaDetalhe(
                                        `${taxa.nome || `Extra ${i + 1}`}${Number(taxa.valorPorPeso) > 0 ? ` (${fmtMaybe(taxa.valorPorPeso)} / ${Number(taxa.pesoBase) || 100} kg)` : ''}`,
                                        fmtMaybe(taxa.valor)
                                      ))}
                                    {linhaDetalhe('Total taxas', fmtMaybe(totalTaxas), true)}
                                  </div>
                                </div>
                              );
                            })() : null}
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
                {!registrosFiltro.length ? <tr><td colSpan="15" style={{ textAlign: 'center', color: '#94a3b8' }}>Nenhum CT-e no recorte atual.</td></tr> : null}
              </tbody>
            </table>
          </div>
          {registrosDetalheOrdenados.length > limiteDetalhe ? (
            <div className="empty-note">Mostrando {fmtN(limiteDetalhe)} de {fmtN(registrosDetalheOrdenados.length)} CT-es. Use "Mostrar mais" ou exporte o Excel para ver todos.</div>
          ) : null}
        </section>
      ) : null}

      {/* Resumo mensal aparece sempre que carregado (o componente já some se vazio),
          inclusive quando se usa só "Carregar resumo mensal" sem carregar CT-es. */}
      <ResumoMensalAuditoria resumoMensal={resumoMensal} />
      <DiagnosticoFontes diagnostico={diagnostico} />

      {!temDados && !carregando && !processando && !resumoMensal.length ? (
        <section className="sim-card" style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
          <h3>Selecione a competência e carregue os dados</h3>
          <p style={{ color: '#64748b', maxWidth: 620, margin: '0 auto' }}>
            Use <strong>Carregar CT-es do mês</strong> para conferir a base CTS. Depois use <strong>Salvar mês carregado</strong> para gravar o histórico da auditoria.
          </p>
        </section>
      ) : null}
      </>
      )}
    </div>
  );
}
