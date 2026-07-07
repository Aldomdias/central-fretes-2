import React from 'react';
import {
  agruparPorTransportadora,
  calcularDashboardGestao,
  enriquecerTabelaGestao,
  formatarMoeda,
} from '../../utils/tabelasNegociacaoGestao';
import { carregarResumoCentralSolicitacoes } from '../../services/centralSolicitacoesService';

function formatarNumero(v) {
  return Number(v || 0).toLocaleString('pt-BR');
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

  const cards = [
    ['Negociacoes totais', formatarNumero(kpi.total)],
    ['Em andamento', formatarNumero(kpi.emAndamento)],
    ['Concluidas', formatarNumero(concluidas.length)],
    ['Publicadas', formatarNumero(kpi.publicadas)],
    ['Saving acumulado', formatarMoeda(kpi.savingAcumulado)],
    ['Saving potencial', formatarMoeda(kpi.savingPotencial)],
    ['Impacto reajustes', formatarMoeda(kpi.impactoReajustes)],
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

export default function GestaoDashboard({ tabelas = [] }) {
  const kpi = calcularDashboardGestao(tabelas);
  const [gerandoRelatorio, setGerandoRelatorio] = React.useState(false);

  async function gerarRelatorio() {
    setGerandoRelatorio(true);
    try {
      const protocolos = tabelas.map((t) => t.numero_amd).filter(Boolean);
      const central = await carregarResumoCentralSolicitacoes(protocolos);
      baixarRelatorioDiretoria(tabelas, kpi, central);
    } catch (error) {
      window.alert(error.message || 'Erro ao gerar laudo diretoria com a Central de Solicitações.');
    } finally {
      setGerandoRelatorio(false);
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
    { label: 'Impacto reajustes', value: formatarMoeda(kpi.impactoReajustes), hint: 'financeiro' },
    { label: 'Transportadoras', value: kpi.transportadoras, hint: 'em negociação' },
    { label: 'Origens/rotas', value: kpi.origensRotas, hint: 'envolvidas' },
    { label: 'Sem atualização', value: kpi.semAtualizacao, hint: `>${14} dias` },
    { label: 'Novas / Reajustes', value: `${kpi.novas} / ${kpi.reajustes}`, hint: 'por tipo' },
  ];

  return (
    <div>
      <div className="actions-row" style={{ justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="primary" type="button" onClick={gerarRelatorio} disabled={gerandoRelatorio}>
          {gerandoRelatorio ? 'Gerando...' : 'Laudo diretoria'}
        </button>
      </div>

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
          <div className="sim-parametros-header"><strong>Reajustes em gestão</strong></div>
          <div className="sim-cobertura-lista" style={{ marginTop: 10 }}>
            <div><strong>Aguardando aprovação:</strong> {kpi.reajustesAguardando}</div>
            <div><strong>Aprovados:</strong> {kpi.reajustesAprovados}</div>
            <div><strong>Recusados:</strong> {kpi.reajustesRecusados}</div>
            <div><strong>Impacto total:</strong> {formatarMoeda(kpi.impactoReajustes)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
