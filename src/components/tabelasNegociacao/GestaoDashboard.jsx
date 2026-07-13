import React from 'react';
import * as XLSX from 'xlsx';
import {
  agruparPorTransportadora,
  calcularDashboardGestao,
  enriquecerTabelaGestao,
  formatarMoeda,
} from '../../utils/tabelasNegociacaoGestao';
import { carregarResumoCentralSolicitacoes, carregarSolicitacoesDetalhado } from '../../services/centralSolicitacoesService';
import { getSupabaseClient } from '../../lib/supabaseClient';

function formatarNumero(v) {
  return Number(v || 0).toLocaleString('pt-BR');
}

function agruparPorCanal(lista = []) {
  const mapa = new Map();
  lista.forEach((t) => {
    const canal = t.canal || 'Não informado';
    const atual = mapa.get(canal) || { canal, qtd: 0, saving: 0 };
    atual.qtd += 1;
    atual.saving += Number(t.saving_estimado || 0);
    mapa.set(canal, atual);
  });
  return [...mapa.values()].sort((a, b) => b.qtd - a.qtd);
}

function nomeArquivoSeguro(v) {
  return String(v || 'relatorio')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function linhaTabela(cols) {
  return `<tr>${cols.map((c) => `<td>${c ?? ''}</td>`).join('')}</tr>`;
}

function gerarHtmlRelatorioDiretoria(tabelas = [], kpi = {}, centralSolicitacoes = null) {
  const dataRef = new Date().toLocaleString('pt-BR');
  const lista = tabelas.map((t) => enriquecerTabelaGestao(t));
  const andamento = lista.filter((t) => ['RASCUNHO', 'EM_NEGOCIACAO', 'EM_ANALISE', 'AGUARDANDO_TRANSPORTADORA', 'AGUARDANDO_APROVACAO_GESTOR', 'APROVADA_NEGOCIADOR', 'DEVOLVIDA_AJUSTE'].includes(t.status_gestao));
  const concluidas = lista.filter((t) => ['APROVADA_GESTOR', 'PUBLICADA_OFICIAL', 'RECUSADA', 'CANCELADA', 'SUBSTITUIDA'].includes(t.status_gestao));
  const grupos = agruparPorTransportadora(lista).slice(0, 30);
  const topSaving = [...lista].sort((a, b) => b.saving_estimado - a.saving_estimado).slice(0, 30);
  const porCanal = agruparPorCanal(lista);

  const cards = [
    ['Negociacoes totais', formatarNumero(kpi.total)],
    ['Em andamento', formatarNumero(kpi.emAndamento)],
    ['Concluidas', formatarNumero(concluidas.length)],
    ['Publicadas', formatarNumero(kpi.publicadas)],
    ['Saving acumulado', formatarMoeda(kpi.savingAcumulado)],
    ['Saving potencial', formatarMoeda(kpi.savingPotencial)],
    ['Transportadoras', formatarNumero(kpi.transportadoras)],
  ];
  const protocolosCentral = centralSolicitacoes?.protocolos || [];

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Relatorio executivo - negociacoes</title>
  <style>
    body { margin: 0; background: #f4f6fa; color: #0f172a; font-family: Arial, sans-serif; }
    main { max-width: 1120px; margin: 0 auto; padding: 28px; }
    section { background: #fff; border: 1px solid #dbe4f0; border-radius: 10px; padding: 18px; margin-bottom: 16px; }
    h1 { margin: 0 0 4px; color: #001f4f; }
    h2 { margin: 0 0 12px; color: #001f4f; font-size: 18px; }
    .muted { color: #64748b; font-size: 13px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
    .card { border: 1px solid #dbe4f0; border-radius: 8px; padding: 12px; }
    .card span { color: #475569; font-size: 12px; display: block; }
    .card strong { display: block; margin-top: 6px; font-size: 20px; color: #001f4f; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f8fafc; color: #001f4f; }
    @media print { body { background: #fff; } main { padding: 0; max-width: none; } section { break-inside: avoid; } }
  </style>
</head>
<body>
  <main>
    <section>
      <h1>Relatorio executivo de negociacoes</h1>
      <div class="muted">Gerado em ${dataRef}. Base: Central Fretes - Tabelas de Negociacao.</div>
    </section>
    <section>
      <h2>Resumo geral</h2>
      <div class="cards">
        ${cards.map(([label, value]) => `<div class="card"><span>${label}</span><strong>${value}</strong></div>`).join('')}
      </div>
    </section>
    <section>
      <h2>Negociacoes por canal</h2>
      <div class="cards">
        ${porCanal.map((c) => `<div class="card"><span>${c.canal}</span><strong>${formatarNumero(c.qtd)}</strong><span>${formatarMoeda(c.saving)}</span></div>`).join('') || '<div class="muted">Sem dados</div>'}
      </div>
    </section>
    <section>
      <h2>Negociacoes por transportadora</h2>
      <table>
        <thead><tr><th>Transportadora</th><th>Negociacoes</th><th>Saving</th><th>Impacto reajuste</th><th>Origens</th></tr></thead>
        <tbody>
          ${grupos.map((g) => linhaTabela([
            g.transportadora,
            formatarNumero(g.qtdNegociacoes),
            formatarMoeda(g.savingTotal),
            formatarMoeda(g.impactoTotal),
            g.origens.slice(0, 8).map((o) => o.label).join(', '),
          ])).join('') || linhaTabela(['Sem dados', '', '', '', ''])}
        </tbody>
      </table>
    </section>
    <section>
      <h2>Negociacoes em andamento</h2>
      <table>
        <thead><tr><th>AMD</th><th>Transportadora</th><th>Origem</th><th>Status</th><th>Negociador</th><th>Saving</th><th>Atualizacao</th></tr></thead>
        <tbody>
          ${andamento.slice(0, 80).map((t) => linhaTabela([
            t.numero_amd || '',
            t.transportadora,
            t.origem_label,
            t.status_gestao_label,
            t.negociador_display,
            formatarMoeda(t.saving_estimado),
            t.atualizado_em ? new Date(t.atualizado_em).toLocaleDateString('pt-BR') : '',
          ])).join('') || linhaTabela(['Sem negociacoes em andamento', '', '', '', '', '', ''])}
        </tbody>
      </table>
    </section>
    <section>
      <h2>Concluidas e publicadas</h2>
      <table>
        <thead><tr><th>AMD</th><th>Transportadora</th><th>Origem</th><th>Status</th><th>Saving</th><th>Impacto reajuste</th></tr></thead>
        <tbody>
          ${concluidas.slice(0, 80).map((t) => linhaTabela([
            t.numero_amd || '',
            t.transportadora,
            t.origem_label,
            t.status_gestao_label,
            formatarMoeda(t.saving_estimado),
            formatarMoeda(t.impacto_reajuste),
          ])).join('') || linhaTabela(['Sem negociacoes concluidas', '', '', '', '', ''])}
        </tbody>
      </table>
    </section>
    <section>
      <h2>Maiores savings</h2>
      <table>
        <thead><tr><th>AMD</th><th>Transportadora</th><th>Origem</th><th>Status</th><th>Saving</th></tr></thead>
        <tbody>
          ${topSaving.map((t) => linhaTabela([
            t.numero_amd || '',
            t.transportadora,
            t.origem_label,
            t.status_gestao_label,
            formatarMoeda(t.saving_estimado),
          ])).join('') || linhaTabela(['Sem saving registrado', '', '', '', ''])}
        </tbody>
      </table>
    </section>
    <section>
      <h2>Central de solicitacoes</h2>
      ${centralSolicitacoes?.configurado ? `
      <div class="cards">
        <div class="card"><span>Solicitacoes tabela/negociacao</span><strong>${formatarNumero(centralSolicitacoes.total)}</strong></div>
        ${(centralSolicitacoes.porStatus || []).slice(0, 5).map((item) => `<div class="card"><span>${item.nome}</span><strong>${formatarNumero(item.qtd)}</strong></div>`).join('')}
      </div>
      <table style="margin-top: 14px">
        <thead><tr><th>Tipo</th><th>Quantidade</th></tr></thead>
        <tbody>
          ${(centralSolicitacoes.porTipo || []).map((item) => linhaTabela([item.nome, formatarNumero(item.qtd)])).join('') || linhaTabela(['Sem dados', ''])}
        </tbody>
      </table>
      <h2 style="margin-top:18px">Protocolos AMD vinculados nas negociacoes</h2>
      <table>
        <thead><tr><th>AMD</th><th>Status Central</th><th>Tipo</th><th>Assunto</th><th>Transportadora</th></tr></thead>
        <tbody>
          ${protocolosCentral.map((p) => linhaTabela([
            p.protocolo,
            p.status,
            p.tipo_solicitacao,
            p.assunto,
            p.transportadora_cadastro || '',
          ])).join('') || linhaTabela(['Nenhum protocolo AMD das negociacoes foi encontrado na Central', '', '', '', ''])}
        </tbody>
      </table>
      ` : '<p class="muted">Central de solicitacoes nao configurada.</p>'}
    </section>
  </main>
</body>
</html>`;
}

function baixarRelatorioDiretoria(tabelas = [], kpi = {}, centralSolicitacoes = null) {
  const html = gerarHtmlRelatorioDiretoria(tabelas, kpi, centralSolicitacoes);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${nomeArquivoSeguro('relatorio-diretoria-negociacoes')}-${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

function nomeMes(mes) {
  const [ano, mesNum] = String(mes || '').split('-');
  if (!ano || !mesNum) return mes || 'Não informado';
  const data = new Date(Number(ano), Number(mesNum) - 1, 1);
  const label = data.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function agruparNegociacoesPorMesInicio(lista = []) {
  const mapa = new Map();
  lista.forEach((t) => {
    const referencia = t.criado_em || t.atualizado_em;
    const mes = String(referencia || '').slice(0, 7);
    if (!mes) return;
    const atual = mapa.get(mes) || { mes, qtd: 0, saving: 0 };
    atual.qtd += 1;
    atual.saving += Number(t.saving_estimado || 0);
    mapa.set(mes, atual);
  });
  return [...mapa.values()].sort((a, b) => a.mes.localeCompare(b.mes));
}

function agruparNegociacoesPorMesConclusao(lista = []) {
  const mapa = new Map();
  lista
    .filter((t) => t.status_gestao === 'APROVADA_GESTOR' || t.status_gestao === 'PUBLICADA_OFICIAL')
    .forEach((t) => {
      const referencia = t.publicado_em || t.aprovado_em || t.atualizado_em;
      const mes = String(referencia || '').slice(0, 7);
      if (!mes) return;
      const atual = mapa.get(mes) || { mes, qtd: 0, saving: 0 };
      atual.qtd += 1;
      atual.saving += Number(t.saving_estimado || 0);
      mapa.set(mes, atual);
    });
  return [...mapa.values()].sort((a, b) => a.mes.localeCompare(b.mes));
}

function gerarHtmlRelatorioResumido(tabelas = [], kpi = {}, centralSolicitacoes = null) {
  const dataRef = new Date().toLocaleString('pt-BR');
  const lista = tabelas.map((t) => enriquecerTabelaGestao(t));
  const negociacoesIniciadasPorMes = agruparNegociacoesPorMesInicio(lista).slice(-12);
  const negociacoesConcluidasPorMes = agruparNegociacoesPorMesConclusao(lista).slice(-12);
  const solicitacoesPorMes = (centralSolicitacoes?.porMes || []).slice(-12);
  const porCanal = agruparPorCanal(lista);

  const cards = [
    ['Negociacoes totais', formatarNumero(kpi.total)],
    ['Em andamento', formatarNumero(kpi.emAndamento)],
    ['Publicadas', formatarNumero(kpi.publicadas)],
    ['Saving acumulado', formatarMoeda(kpi.savingAcumulado)],
    ['Saving potencial', formatarMoeda(kpi.savingPotencial)],
  ];

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Relatorio executivo resumido - negociacoes</title>
  <style>
    body { margin: 0; background: #f4f6fa; color: #0f172a; font-family: Arial, sans-serif; }
    main { max-width: 860px; margin: 0 auto; padding: 28px; }
    section { background: #fff; border: 1px solid #dbe4f0; border-radius: 10px; padding: 18px; margin-bottom: 16px; }
    h1 { margin: 0 0 4px; color: #001f4f; }
    h2 { margin: 0 0 12px; color: #001f4f; font-size: 18px; }
    .muted { color: #64748b; font-size: 13px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
    .duas-colunas { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 640px) { .duas-colunas { grid-template-columns: 1fr; } }
    .card { border: 1px solid #dbe4f0; border-radius: 8px; padding: 12px; }
    .card span { color: #475569; font-size: 12px; display: block; }
    .card strong { display: block; margin-top: 6px; font-size: 20px; color: #001f4f; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f8fafc; color: #001f4f; }
    @media print { body { background: #fff; } main { padding: 0; max-width: none; } section { break-inside: avoid; } }
  </style>
</head>
<body>
  <main>
    <section>
      <h1>Relatorio executivo resumido de negociacoes</h1>
      <div class="muted">Gerado em ${dataRef}. Base: Central Fretes - Tabelas de Negociacao.</div>
    </section>
    <section>
      <h2>Resumo geral</h2>
      <div class="cards">
        ${cards.map(([label, value]) => `<div class="card"><span>${label}</span><strong>${value}</strong></div>`).join('')}
      </div>
    </section>
    <section>
      <h2>Negociacoes por canal</h2>
      <div class="cards">
        ${porCanal.map((c) => `<div class="card"><span>${c.canal}</span><strong>${formatarNumero(c.qtd)}</strong><span>${formatarMoeda(c.saving)}</span></div>`).join('') || '<div class="muted">Sem dados</div>'}
      </div>
    </section>
    <section>
      <h2>Visao mensal - Negociacoes</h2>
      <div class="duas-colunas">
        <div>
          <div class="muted" style="margin-bottom:8px">Iniciadas no mes</div>
          <table>
            <thead><tr><th>Mes</th><th>Negociacoes</th><th>Saving</th></tr></thead>
            <tbody>
              ${negociacoesIniciadasPorMes.map((m) => linhaTabela([nomeMes(m.mes), formatarNumero(m.qtd), formatarMoeda(m.saving)])).join('') || linhaTabela(['Sem dados', '', ''])}
            </tbody>
          </table>
        </div>
        <div>
          <div class="muted" style="margin-bottom:8px">Concluidas no mes (aprovada/publicada)</div>
          <table>
            <thead><tr><th>Mes</th><th>Negociacoes</th><th>Saving</th></tr></thead>
            <tbody>
              ${negociacoesConcluidasPorMes.map((m) => linhaTabela([nomeMes(m.mes), formatarNumero(m.qtd), formatarMoeda(m.saving)])).join('') || linhaTabela(['Sem dados', '', ''])}
            </tbody>
          </table>
        </div>
      </div>
    </section>
    <section>
      <h2>Central de solicitacoes</h2>
      ${centralSolicitacoes?.configurado ? `
      <div class="cards">
        <div class="card"><span>Solicitacoes tabela/negociacao</span><strong>${formatarNumero(centralSolicitacoes.total)}</strong></div>
        ${(centralSolicitacoes.porStatus || []).slice(0, 4).map((item) => `<div class="card"><span>${item.nome}</span><strong>${formatarNumero(item.qtd)}</strong></div>`).join('')}
      </div>
      <table style="margin-top: 14px">
        <thead><tr><th>Tipo</th><th>Quantidade</th></tr></thead>
        <tbody>
          ${(centralSolicitacoes.porTipo || []).map((item) => linhaTabela([item.nome, formatarNumero(item.qtd)])).join('') || linhaTabela(['Sem dados', ''])}
        </tbody>
      </table>
      <h2 style="margin-top:18px">Visao mensal - Solicitacoes</h2>
      <table>
        <thead><tr><th>Mes</th><th>Solicitacoes</th></tr></thead>
        <tbody>
          ${solicitacoesPorMes.map((m) => linhaTabela([nomeMes(m.mes), formatarNumero(m.qtd)])).join('') || linhaTabela(['Sem dados', ''])}
        </tbody>
      </table>
      ` : '<p class="muted">Central de solicitacoes nao configurada.</p>'}
    </section>
  </main>
</body>
</html>`;
}

function baixarRelatorioResumido(tabelas = [], kpi = {}, centralSolicitacoes = null) {
  const html = gerarHtmlRelatorioResumido(tabelas, kpi, centralSolicitacoes);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${nomeArquivoSeguro('relatorio-resumido-negociacoes')}-${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

const COLS_EXCEL_NEGOCIACOES = [
  'numero_amd', 'transportadora', 'canal', 'tipo_negociacao', 'tipo_tabela', 'tipo_tabela_negociacao',
  'status', 'status_gestao', 'status_aprovacao',
  'negociador_nome', 'aprovador_nome', 'criado_por_nome',
  'origem', 'regiao', 'uf_origem', 'uf_destino', 'modalidade', 'tipo_veiculo',
  'saving_projetado', 'aderencia_projetada', 'faturamento_projetado', 'impacto_projetado', 'percentual_frete_projetado',
  'impacto_valor', 'impacto_percentual', 'impacto_mensal', 'impacto_anual',
  'valor_atual_realizado', 'valor_simulado_nova_tabela',
  'frete_percentual_nf_atual', 'frete_percentual_nf_simulado',
  'qtd_registros_analisados', 'qtd_registros_com_tabela', 'ctes_analisados', 'ctes_atendidos', 'rotas_sem_cobertura',
  'volumetria_dia',
  'data_recebimento', 'data_inicio_prevista', 'data_inicio_vigencia',
  'enviado_aprovacao_em', 'aprovado_em', 'publicado_em', 'data_aprovacao',
  'criado_em', 'atualizado_em',
  'incluir_simulacao', 'substituir_tabela_anterior', 'promovida_para_oficial',
  'transportadora_base_nome', 'tabela_base_id',
  'observacao', 'justificativa_aprovacao', 'observacao_aprovacao',
  'solicitacao_amd_id', 'id',
];

const COLS_EXCEL_SOLICITACOES = [
  'protocolo', 'tipo_registro', 'protocolo_pai',
  'tipo_solicitacao', 'tipo_ajuste', 'status', 'prioridade',
  'area', 'nome', 'email', 'responsavel',
  'assunto', 'descricao', 'mensagem_status',
  'transportadora_cadastro', 'cidade_centro', 'centro_origem', 'canal',
  'data_abertura', 'data_ultima_atualizacao',
];

function projetarLinhasExcel(linhas, colunas) {
  return linhas.map((linha) => {
    const out = {};
    colunas.forEach((c) => {
      const v = linha[c];
      out[c] = v && typeof v === 'object' ? JSON.stringify(v) : v;
    });
    return out;
  });
}

function baixarExcel(workbook, nomeBase) {
  const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/octet-stream' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${nomeArquivoSeguro(nomeBase)}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

const STORAGE_KEY_TRANSPORTADORAS_EXCLUIDAS = 'central-fretes:laudo-transportadoras-excluidas-saving';

function carregarTransportadorasExcluidas() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TRANSPORTADORAS_EXCLUIDAS);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function salvarTransportadorasExcluidas(set) {
  try {
    localStorage.setItem(STORAGE_KEY_TRANSPORTADORAS_EXCLUIDAS, JSON.stringify([...set]));
  } catch {
    // localStorage indisponível — seleção não persiste, sem impacto funcional.
  }
}

const STORAGE_KEY_NEGOCIACOES_EXCLUIDAS = 'central-fretes:laudo-negociacoes-excluidas-saving';

function carregarNegociacoesExcluidas() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_NEGOCIACOES_EXCLUIDAS);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function salvarNegociacoesExcluidas(set) {
  try {
    localStorage.setItem(STORAGE_KEY_NEGOCIACOES_EXCLUIDAS, JSON.stringify([...set]));
  } catch {
    // localStorage indisponível — seleção não persiste, sem impacto funcional.
  }
}

export default function GestaoDashboard({ tabelas = [] }) {
  const [transportadorasExcluidas, setTransportadorasExcluidas] = React.useState(carregarTransportadorasExcluidas);
  const [painelTransportadorasAberto, setPainelTransportadorasAberto] = React.useState(false);
  const [negociacoesExcluidas, setNegociacoesExcluidas] = React.useState(carregarNegociacoesExcluidas);
  const [painelInterativoAberto, setPainelInterativoAberto] = React.useState(false);
  const [filtroInterativo, setFiltroInterativo] = React.useState('');

  const transportadorasDisponiveis = React.useMemo(
    () => [...new Set(tabelas.map((t) => t.transportadora).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [tabelas],
  );
  const tabelasParaLaudo = React.useMemo(
    () => tabelas.filter((t) => !transportadorasExcluidas.has(t.transportadora) && !negociacoesExcluidas.has(t.id)),
    [tabelas, transportadorasExcluidas, negociacoesExcluidas],
  );

  function alternarTransportadora(nome) {
    setTransportadorasExcluidas((prev) => {
      const next = new Set(prev);
      if (next.has(nome)) next.delete(nome); else next.add(nome);
      salvarTransportadorasExcluidas(next);
      return next;
    });
  }

  function alternarNegociacao(id) {
    setNegociacoesExcluidas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      salvarNegociacoesExcluidas(next);
      return next;
    });
  }

  const listaInterativa = React.useMemo(() => {
    const enriquecida = tabelas.map((t) => enriquecerTabelaGestao(t));
    const termo = filtroInterativo.trim().toLowerCase();
    const filtrada = termo
      ? enriquecida.filter((t) => [t.transportadora, t.numero_amd, t.origem_label, t.canal]
        .some((campo) => String(campo || '').toLowerCase().includes(termo)))
      : enriquecida;
    return filtrada.sort((a, b) => (b.atualizado_em || '').localeCompare(a.atualizado_em || ''));
  }, [tabelas, filtroInterativo]);

  const kpi = calcularDashboardGestao(tabelasParaLaudo);
  const [gerandoRelatorio, setGerandoRelatorio] = React.useState(false);
  const [gerandoRelatorioResumido, setGerandoRelatorioResumido] = React.useState(false);
  const [gerandoExcel, setGerandoExcel] = React.useState(false);

  async function gerarExcelDetalhado() {
    setGerandoExcel(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('Supabase não configurado.');

      const ids = tabelas.map((t) => t.id).filter(Boolean);
      const { data: negociacoesDetalhado, error } = await supabase
        .from('tabelas_negociacao')
        .select(COLS_EXCEL_NEGOCIACOES.join(','))
        .in('id', ids.length ? ids : ['-'])
        .order('criado_em', { ascending: true });
      if (error) throw new Error(error.message || 'Erro ao buscar negociações detalhadas.');

      const solicitacoesDetalhado = await carregarSolicitacoesDetalhado();

      const wb = XLSX.utils.book_new();
      const wsNeg = XLSX.utils.json_to_sheet(projetarLinhasExcel(negociacoesDetalhado || [], COLS_EXCEL_NEGOCIACOES), { header: COLS_EXCEL_NEGOCIACOES });
      const wsSol = XLSX.utils.json_to_sheet(projetarLinhasExcel(solicitacoesDetalhado || [], COLS_EXCEL_SOLICITACOES), { header: COLS_EXCEL_SOLICITACOES });
      XLSX.utils.book_append_sheet(wb, wsNeg, 'Negociacoes');
      XLSX.utils.book_append_sheet(wb, wsSol, 'Solicitacoes');
      baixarExcel(wb, 'laudo-detalhado-negociacoes-solicitacoes');
    } catch (error) {
      window.alert(error.message || 'Erro ao gerar relatório Excel detalhado.');
    } finally {
      setGerandoExcel(false);
    }
  }

  async function gerarRelatorio() {
    setGerandoRelatorio(true);
    try {
      const protocolos = tabelasParaLaudo.map((t) => t.numero_amd).filter(Boolean);
      const central = await carregarResumoCentralSolicitacoes(protocolos);
      baixarRelatorioDiretoria(tabelasParaLaudo, kpi, central);
    } catch (error) {
      window.alert(error.message || 'Erro ao gerar laudo diretoria com a Central de Solicitações.');
    } finally {
      setGerandoRelatorio(false);
    }
  }

  async function gerarRelatorioResumido() {
    setGerandoRelatorioResumido(true);
    try {
      const protocolos = tabelasParaLaudo.map((t) => t.numero_amd).filter(Boolean);
      const central = await carregarResumoCentralSolicitacoes(protocolos);
      baixarRelatorioResumido(tabelasParaLaudo, kpi, central);
    } catch (error) {
      window.alert(error.message || 'Erro ao gerar laudo resumido com a Central de Solicitações.');
    } finally {
      setGerandoRelatorioResumido(false);
    }
  }

  const cards = [
    { label: 'Em andamento', value: kpi.emAndamento, hint: 'negociações ativas' },
    { label: 'Aguardando gestor', value: kpi.aguardandoAprovacao, hint: 'aprovação pendente' },
    { label: 'Aprovadas', value: kpi.aprovadas, hint: 'pelo gestor' },
    { label: 'Recusadas', value: kpi.recusadas, hint: 'negociações' },
    { label: 'Publicadas', value: kpi.publicadas, hint: 'base oficial' },
    { label: 'Saving acumulado', value: formatarMoeda(kpi.savingAcumulado), hint: 'aprovado/publicado' },
    { label: 'Saving potencial', value: formatarMoeda(kpi.savingPotencial), hint: 'em negociação' },
    { label: 'Transportadoras', value: kpi.transportadoras, hint: 'em negociação' },
    { label: 'Origens/rotas', value: kpi.origensRotas, hint: 'envolvidas' },
    { label: 'Sem atualização', value: kpi.semAtualizacao, hint: `>${14} dias` },
    { label: 'Novas / Reajustes', value: `${kpi.novas} / ${kpi.reajustes}`, hint: 'por tipo' },
  ];

  return (
    <div>
      <div className="actions-row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div className="actions-row" style={{ gap: 8 }}>
          <button type="button" onClick={() => setPainelTransportadorasAberto((v) => !v)}>
            {painelTransportadorasAberto ? 'Fechar' : 'Transportadoras no laudo'} ({transportadorasDisponiveis.length - transportadorasExcluidas.size}/{transportadorasDisponiveis.length})
          </button>
          <button type="button" onClick={() => setPainelInterativoAberto((v) => !v)}>
            {painelInterativoAberto ? 'Fechar' : 'Laudo interativo'} ({tabelas.length - negociacoesExcluidas.size}/{tabelas.length})
          </button>
        </div>
        <div className="actions-row" style={{ gap: 8 }}>
          <button type="button" onClick={gerarExcelDetalhado} disabled={gerandoExcel}>
            {gerandoExcel ? 'Gerando...' : 'Excel detalhado'}
          </button>
          <button type="button" onClick={gerarRelatorioResumido} disabled={gerandoRelatorioResumido}>
            {gerandoRelatorioResumido ? 'Gerando...' : 'Laudo resumido'}
          </button>
          <button className="primary" type="button" onClick={gerarRelatorio} disabled={gerandoRelatorio}>
            {gerandoRelatorio ? 'Gerando...' : 'Laudo diretoria'}
          </button>
        </div>
      </div>

      {painelTransportadorasAberto ? (
        <div className="sim-parametros-box" style={{ marginBottom: 12 }}>
          <div className="sim-parametros-header">
            <strong>Transportadoras incluídas no laudo (saving)</strong>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Desmarque quem ainda não está registrado/finalizado. A escolha fica salva neste navegador e vale pros dois laudos.
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6, marginTop: 10 }}>
            {transportadorasDisponiveis.map((nome) => (
              <label key={nome} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={!transportadorasExcluidas.has(nome)}
                  onChange={() => alternarTransportadora(nome)}
                />
                {nome}
              </label>
            ))}
            {!transportadorasDisponiveis.length ? <div className="muted">Sem transportadoras carregadas.</div> : null}
          </div>
        </div>
      ) : null}

      {painelInterativoAberto ? (
        <div className="sim-parametros-box" style={{ marginBottom: 12 }}>
          <div className="sim-parametros-header">
            <strong>Laudo interativo — marque o que está concluído</strong>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Desmarque negociações individuais que ainda não fecharam. Some ao filtro de transportadoras acima. Fica salvo neste navegador.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0' }}>
            <input
              type="text"
              placeholder="Buscar por transportadora, AMD, origem ou canal..."
              value={filtroInterativo}
              onChange={(e) => setFiltroInterativo(e.target.value)}
              style={{ flex: 1, maxWidth: 360 }}
            />
            <span className="muted" style={{ fontSize: 12 }}>
              {kpi.total} incluídas · saving {formatarMoeda(kpi.savingAcumulado + kpi.savingPotencial)}
            </span>
          </div>
          <div style={{ maxHeight: 420, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ position: 'sticky', top: 0, background: '#f8fafc' }}>
                <tr>
                  <th style={{ padding: 8, textAlign: 'left' }}>Incluir</th>
                  <th style={{ padding: 8, textAlign: 'left' }}>AMD</th>
                  <th style={{ padding: 8, textAlign: 'left' }}>Transportadora</th>
                  <th style={{ padding: 8, textAlign: 'left' }}>Canal</th>
                  <th style={{ padding: 8, textAlign: 'left' }}>Status</th>
                  <th style={{ padding: 8, textAlign: 'left' }}>Saving</th>
                </tr>
              </thead>
              <tbody>
                {listaInterativa.map((t) => (
                  <tr key={t.id} style={{ borderTop: '1px solid #e2e8f0', opacity: transportadorasExcluidas.has(t.transportadora) ? 0.4 : 1 }}>
                    <td style={{ padding: 8 }}>
                      <input
                        type="checkbox"
                        checked={!negociacoesExcluidas.has(t.id)}
                        onChange={() => alternarNegociacao(t.id)}
                      />
                    </td>
                    <td style={{ padding: 8 }}>{t.numero_amd || '—'}</td>
                    <td style={{ padding: 8 }}>{t.transportadora}</td>
                    <td style={{ padding: 8 }}>{t.canal || '—'}</td>
                    <td style={{ padding: 8 }}>{t.status_gestao_label}</td>
                    <td style={{ padding: 8 }}>{formatarMoeda(t.saving_estimado)}</td>
                  </tr>
                ))}
                {!listaInterativa.length ? (
                  <tr><td colSpan={6} style={{ padding: 8 }} className="muted">Nenhuma negociação encontrada.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        {cards.map((c) => (
          <div key={c.label} className="summary-card">
            <span>{c.label}</span>
            <strong>{c.value}</strong>
            <small>{c.hint}</small>
          </div>
        ))}
      </div>

      <div className="feature-grid import-grid" style={{ marginTop: 18 }}>
        <div className="sim-parametros-box">
          <div className="sim-parametros-header"><strong>Saving por negociador</strong></div>
          <div className="sim-cobertura-lista" style={{ marginTop: 10 }}>
            {kpi.savingPorNegociador.slice(0, 8).map((item) => (
              <div key={item.nome}><strong>{item.nome}</strong> · {formatarMoeda(item.saving)} · {item.qtd} neg.</div>
            ))}
            {!kpi.savingPorNegociador.length ? <div>Sem dados de saving por negociador.</div> : null}
          </div>
        </div>
        <div className="sim-parametros-box">
          <div className="sim-parametros-header"><strong>Saving por transportadora</strong></div>
          <div className="sim-cobertura-lista" style={{ marginTop: 10 }}>
            {kpi.savingPorTransportadora.slice(0, 8).map((item) => (
              <div key={item.nome}><strong>{item.nome}</strong> · {formatarMoeda(item.saving)}</div>
            ))}
            {!kpi.savingPorTransportadora.length ? <div>Sem dados de saving por transportadora.</div> : null}
          </div>
        </div>
        <div className="sim-parametros-box">
          <div className="sim-parametros-header"><strong>Saving por canal</strong></div>
          <div className="sim-cobertura-lista" style={{ marginTop: 10 }}>
            {kpi.savingPorCanal.slice(0, 8).map((item) => (
              <div key={item.nome}><strong>{item.nome}</strong> · {formatarMoeda(item.saving)} · {item.qtd} neg.</div>
            ))}
            {!kpi.savingPorCanal.length ? <div>Sem dados de saving por canal.</div> : null}
          </div>
        </div>
        <div className="sim-parametros-box">
          <div className="sim-parametros-header"><strong>Reajustes em gestão</strong></div>
          <div className="sim-cobertura-lista" style={{ marginTop: 10 }}>
            <div><strong>Aguardando aprovação:</strong> {kpi.reajustesAguardando}</div>
            <div><strong>Aprovados:</strong> {kpi.reajustesAprovados}</div>
            <div><strong>Recusados:</strong> {kpi.reajustesRecusados}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
