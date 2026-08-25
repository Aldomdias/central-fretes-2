import React, { useEffect, useMemo, useRef, useState } from 'react';
import { gestaoStyles } from './GestaoStyles';
import { formatarData } from '../../utils/tabelasNegociacaoGestao';
import { buscarPrimeiroCteSaving, calcularSavingPosAprovacaoAgregado, listarFaixasPesoNegociacao, listarRealizadoLocalCtesParaSimulacao, listarTransportadorasRealizadoReajustes } from '../../services/freteDatabaseService';
import { carregarCargasLotacaoSupabase } from '../../services/lotacaoSupabaseService';
import { atualizarDataReferenciaSaving, atualizarOrigemRealizadoSaving, atualizarVinculoTransportadoraSaving, salvarSavingPosAprovacaoCache } from '../../services/tabelasNegociacaoService';
import { normalizarTextoReajuste } from '../../utils/reajustesLocal';
import { calcularJanelasSaving, calcularSavingLotacaoPorFluxo, calcularSavingPorRotaFaixa, MESES_BASE_SAVING_PADRAO } from '../../utils/savingsPosAprovacaoNegociacao';
import { GRADE_FRETE_PADRAO, normalizarCanalGrade } from '../../utils/gradeFreteConfig';

// Faixas com fim acima deste valor são "abertas" (ex.: 0–999999 de tabela por percentual)
// e não representam segmentação real de peso.
const LIMITE_FAIXA_ABERTA = 100000;

// Filtro de transportadora é feito no cliente como reforço (não é o filtro principal):
// ilike com wildcard nas duas pontas não usa índice em realizado_local_ctes, então a
// consulta já filtra no servidor (ilike ou lista exata de vínculo) e isso aqui só
// blinda contra falso-positivo de nome parcial.
function filtrarLinhasPorTransportadora(linhas = [], nomeTransportadora = '') {
  const alvo = normalizarTextoReajuste(nomeTransportadora);
  if (!alvo) return linhas;
  return (linhas || []).filter((row) => {
    const nome = normalizarTextoReajuste(row.transportadora || row.nomeTransportadora || '');
    return nome === alvo || nome.includes(alvo) || alvo.includes(nome);
  });
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function formatPercent(value) {
  return `${(Number(value || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

const STATUS_ELEGIVEIS = ['APROVADA_GESTOR', 'PUBLICADA_OFICIAL'];
const VERSAO_METRICA_SAVING = 7;

function nomeArquivoSeguro(v) {
  return String(v || 'relatorio')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function linhaTabelaHtml(cols) {
  return `<tr>${cols.map((c) => `<td>${c ?? ''}</td>`).join('')}</tr>`;
}

function gerarHtmlLaudoSavings(negociacoes = [], resultados = {}) {
  const dataRef = new Date().toLocaleString('pt-BR');
  const calculadas = negociacoes.filter((item) => resultados[item.id]);
  const pendentes = negociacoes.filter((item) => !resultados[item.id]);
  const savingTotal = calculadas.reduce((acc, item) => acc + (resultados[item.id]?.totais.saving || 0), 0);
  const positivas = calculadas.filter((item) => (resultados[item.id]?.totais.saving || 0) >= 0).length;
  const negativas = calculadas.length - positivas;

  const porTransportadora = new Map();
  calculadas.forEach((item) => {
    const r = resultados[item.id];
    const atual = porTransportadora.get(item.transportadora) || {
      transportadora: item.transportadora, canal: item.canal, qtd: 0, saving: 0, rotas: 0, aprovadoEm: item.aprovadoEm,
    };
    atual.qtd += 1;
    atual.saving += r.totais.saving || 0;
    atual.rotas += r.linhas.length;
    if (String(item.aprovadoEm) > String(atual.aprovadoEm)) atual.aprovadoEm = item.aprovadoEm;
    porTransportadora.set(item.transportadora, atual);
  });
  const rankingTransportadoras = [...porTransportadora.values()].sort((a, b) => b.saving - a.saving);

  const cards = [
    ['Negociações aprovadas', negociacoes.length],
    ['Já calculadas', calculadas.length],
    ['Pendentes de cálculo', pendentes.length],
    ['Transportadoras acompanhadas', porTransportadora.size],
    ['Saving projetado (total)', formatMoney(savingTotal)],
    ['Com saving positivo', positivas],
    ['Com saving negativo', negativas],
  ];

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Laudo - Savings pós-aprovação</title>
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
    .pos { color: #087f3f; font-weight: 700; }
    .neg { color: #c1121f; font-weight: 700; }
    @media print { body { background: #fff; } main { padding: 0; max-width: none; } section { break-inside: avoid; } }
  </style>
</head>
<body>
  <main>
    <section>
      <h1>Laudo de savings pós-aprovação</h1>
      <div class="muted">Gerado em ${dataRef}. Compara o percentual de frete praticado pela transportadora hoje contra o mercado (todas as transportadoras) na mesma rota/faixa, antes da negociação.</div>
    </section>
    <section>
      <h2>Resumo geral</h2>
      <div class="cards">
        ${cards.map(([label, value]) => `<div class="card"><span>${label}</span><strong>${value}</strong></div>`).join('')}
      </div>
    </section>
    <section>
      <h2>Saving projetado por transportadora</h2>
      <table>
        <thead><tr><th>Transportadora</th><th>Canal</th><th>Negociações</th><th>Rotas comparáveis</th><th>Saving</th></tr></thead>
        <tbody>
          ${rankingTransportadoras.map((t) => linhaTabelaHtml([
            t.transportadora,
            t.canal,
            t.qtd,
            t.rotas,
            `<span class="${t.saving >= 0 ? 'pos' : 'neg'}">${formatMoney(t.saving)}</span>`,
          ])).join('') || linhaTabelaHtml(['Nenhuma negociação calculada ainda', '', '', '', ''])}
        </tbody>
        <tfoot>
          <tr><td colspan="4"><strong>Total geral</strong></td><td><strong>${formatMoney(savingTotal)}</strong></td></tr>
        </tfoot>
      </table>
    </section>
    <section>
      <h2>Acompanhamento — negociações já calculadas</h2>
      <table>
        <thead><tr><th>Transportadora</th><th>Negociação</th><th>Canal</th><th>Aprovado em</th><th>Rotas</th><th>Saving</th></tr></thead>
        <tbody>
          ${calculadas.map((item) => {
            const r = resultados[item.id];
            return linhaTabelaHtml([
              item.transportadora,
              item.nome,
              item.canal,
              formatarData(item.aprovadoEm),
              r.linhas.length,
              `<span class="${r.totais.saving >= 0 ? 'pos' : 'neg'}">${formatMoney(r.totais.saving)}</span>`,
            ]);
          }).join('') || linhaTabelaHtml(['Nenhuma negociação calculada ainda', '', '', '', '', ''])}
        </tbody>
      </table>
    </section>
    <section>
      <h2>Pendentes de cálculo</h2>
      <table>
        <thead><tr><th>Transportadora</th><th>Negociação</th><th>Canal</th><th>Aprovado em</th></tr></thead>
        <tbody>
          ${pendentes.map((item) => linhaTabelaHtml([
            item.transportadora, item.nome, item.canal, formatarData(item.aprovadoEm),
          ])).join('') || linhaTabelaHtml(['Todas as negociações aprovadas já foram calculadas', '', '', ''])}
        </tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}

function escapeHtmlSaving(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function nomeMesSaving(valor) {
  if (!valor) return 'Não informado';
  const data = new Date(`${String(valor).slice(0, 7)}-01T12:00:00`);
  const nome = data.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}

function gerarHtmlLaudoSavingsExecutivo(tabelas = [], negociacoes = [], resultados = {}) {
  const calculadas = negociacoes.filter((item) => resultados[item.id]);
  const aguardando = negociacoes.filter((item) => !resultados[item.id]);
  const emAndamento = (tabelas || []).filter((t) => !['APROVADA_GESTOR', 'PUBLICADA_OFICIAL', 'RECUSADA', 'CANCELADA', 'SUBSTITUIDA'].includes(t.status_gestao));
  const savingRealizado = calculadas.reduce((acc, item) => acc + Number(resultados[item.id]?.totais?.saving || 0), 0);
  const savingProjetado = negociacoes.reduce((acc, item) => acc + Number(item.savingProjetado || 0), 0);
  const savingProjetadoIniciado = calculadas.reduce((acc, item) => acc + Number(item.savingProjetado || 0), 0);
  const competenciaAtual = `${new Date().toISOString().slice(0, 7)}-01`;
  const primeiroCteGeral = calculadas.map((item) => resultados[item.id]?.primeiroCte).filter(Boolean).sort()[0] || '';
  const porMes = new Map();
  calculadas.forEach((item) => {
    (resultados[item.id]?.mensal || []).forEach((mes) => {
      const atual = porMes.get(mes.competencia) || { competencia: mes.competencia, saving: 0, ctes: 0, iniciadas: 0 };
      atual.saving += Number(mes.saving || 0);
      atual.ctes += Number(mes.ctesAtual || 0);
      porMes.set(mes.competencia, atual);
    });
    const primeiro = resultados[item.id]?.primeiroCte;
    if (primeiro) {
      const competencia = `${primeiro.slice(0, 7)}-01`;
      const atual = porMes.get(competencia) || { competencia, saving: 0, ctes: 0, iniciadas: 0 };
      atual.iniciadas += 1;
      porMes.set(competencia, atual);
    }
  });
  const meses = [...porMes.values()].sort((a, b) => a.competencia.localeCompare(b.competencia));
  meses.forEach((mes) => {
    mes.projetado = calculadas.reduce((acc, item) => {
      const primeiro = resultados[item.id]?.primeiroCte;
      return primeiro && primeiro.slice(0, 7) <= mes.competencia.slice(0, 7)
        ? acc + Number(item.savingProjetado || 0)
        : acc;
    }, 0);
    mes.atingimento = mes.projetado ? mes.saving / mes.projetado : 0;
  });
  const realizadoMesAtual = meses.find((mes) => mes.competencia === competenciaAtual)?.saving || 0;
  const maiorSavingMes = Math.max(1, ...meses.map((mes) => Math.abs(mes.saving)));
  const porTransportadora = new Map();
  negociacoes.forEach((item) => {
    const resultado = resultados[item.id];
    const chave = item.transportadora;
    const atual = porTransportadora.get(chave) || { transportadora: chave, aprovadas: 0, iniciadas: 0, projetado: 0, realizado: 0, realizadoMes: 0, primeiroCte: '', ctes: 0 };
    atual.aprovadas += 1;
    atual.projetado += Number(item.savingProjetado || 0);
    if (resultado) {
      atual.iniciadas += 1;
      atual.realizado += Number(resultado.totais?.saving || 0);
      atual.realizadoMes += Number((resultado.mensal || []).find((mes) => mes.competencia === competenciaAtual)?.saving || 0);
      atual.ctes += Number(resultado.ctesAtual || 0);
      if (resultado.primeiroCte && (!atual.primeiroCte || resultado.primeiroCte < atual.primeiroCte)) atual.primeiroCte = resultado.primeiroCte;
    }
    porTransportadora.set(chave, atual);
  });
  const ranking = [...porTransportadora.values()].sort((a, b) => b.realizado - a.realizado);
  const cards = [
    ['Em negociação', emAndamento.length, '#2563eb'],
    ['Aprovadas', negociacoes.length, '#0f766e'],
    ['Iniciadas no realizado', calculadas.length, '#15803d'],
    ['Aguardando início / integração', aguardando.length, '#b45309'],
    ['Projetado mensal · aprovadas', formatMoney(savingProjetado), '#475569'],
    ['Projetado mensal · já iniciadas', formatMoney(savingProjetadoIniciado), '#2563eb'],
    ['Realizado no mês · até hoje', formatMoney(realizadoMesAtual), realizadoMesAtual >= 0 ? '#087f3f' : '#c1121f'],
    ['Realizado acumulado · desde o início', formatMoney(savingRealizado), savingRealizado >= 0 ? '#087f3f' : '#c1121f'],
  ];
  const funil = [
    ['Em negociação', emAndamento.length, '#60a5fa'], ['Aprovadas', negociacoes.length, '#2dd4bf'],
    ['Iniciadas', calculadas.length, '#22c55e'], ['Aguardando início', aguardando.length, '#f59e0b'],
  ];
  const maxFunil = Math.max(1, ...funil.map((item) => item[1]));
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Laudo executivo mensal de negociações</title></head>
  <body style="margin:0;background:#eef2f7;color:#0f172a;font-family:Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef2f7"><tr><td align="center" style="padding:24px">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:1100px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #dbe4f0">
    <tr><td style="padding:28px;background:#06265c;color:#fff"><div style="font-size:12px;letter-spacing:1.4px;text-transform:uppercase;color:#93c5fd">Central de Fretes · Gestão de Negociações</div><h1 style="margin:8px 0 6px;font-size:28px">Laudo executivo mensal</h1><div style="color:#dbeafe;font-size:13px">Acompanhamento do negociado versus realizado · Gerado em ${new Date().toLocaleString('pt-BR')}</div></td></tr>
    <tr><td style="padding:24px">
      <table role="presentation" width="100%" cellspacing="8" cellpadding="0"><tr>${cards.slice(0, 4).map(([label, valor, cor]) => `<td width="25%" style="border:1px solid #dbe4f0;border-radius:10px;padding:14px"><div style="font-size:11px;color:#64748b">${label}</div><div style="font-size:24px;font-weight:800;color:${cor};margin-top:6px">${valor}</div></td>`).join('')}</tr></table>
      <table role="presentation" width="100%" cellspacing="8" cellpadding="0"><tr>${cards.slice(4).map(([label, valor, cor]) => `<td width="25%" style="border:1px solid #dbe4f0;border-radius:10px;padding:16px"><div style="font-size:11px;color:#64748b">${label}</div><div style="font-size:21px;font-weight:800;color:${cor};margin-top:6px">${valor}</div></td>`).join('')}</tr></table>
      <div style="margin:22px 0 8px;font-size:18px;font-weight:800;color:#06265c">Andamento das negociações</div>
      ${funil.map(([label, valor, cor]) => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:7px 0"><tr><td width="190" style="font-size:12px">${label}</td><td><div style="height:18px;background:#e8eef6;border-radius:9px;overflow:hidden"><div style="height:18px;width:${Math.max(3, (valor / maxFunil) * 100)}%;background:${cor};border-radius:9px"></div></div></td><td width="45" align="right" style="font-weight:800">${valor}</td></tr></table>`).join('')}
      <div style="margin:22px 0 8px;font-size:18px;font-weight:800;color:#06265c">Evolução mês a mês</div>
      <table width="100%" cellspacing="0" cellpadding="8" style="border-collapse:collapse;font-size:12px"><thead><tr style="background:#f1f5f9;color:#06265c"><th align="left">Mês</th><th align="right">Iniciadas no mês</th><th align="right">CT-es</th><th align="right">Projetado mensal ativo</th><th align="right">Saving realizado</th><th align="right">Atingimento</th><th align="left">Evolução</th></tr></thead><tbody>
      ${meses.map((mes) => `<tr><td style="border-bottom:1px solid #e2e8f0"><strong>${nomeMesSaving(mes.competencia)}</strong></td><td align="right" style="border-bottom:1px solid #e2e8f0">${mes.iniciadas}</td><td align="right" style="border-bottom:1px solid #e2e8f0">${mes.ctes.toLocaleString('pt-BR')}</td><td align="right" style="border-bottom:1px solid #e2e8f0">${formatMoney(mes.projetado)}</td><td align="right" style="border-bottom:1px solid #e2e8f0;color:${mes.saving >= 0 ? '#087f3f' : '#c1121f'}"><strong>${formatMoney(mes.saving)}</strong></td><td align="right" style="border-bottom:1px solid #e2e8f0"><strong>${formatPercent(mes.atingimento)}</strong></td><td style="border-bottom:1px solid #e2e8f0"><div style="width:${Math.max(2, Math.abs(mes.saving) / maiorSavingMes * 100)}%;height:10px;border-radius:5px;background:${mes.saving >= 0 ? '#22c55e' : '#ef4444'}"></div></td></tr>`).join('') || '<tr><td colspan="7" style="padding:16px;color:#64748b">Ainda não há realizado mensal calculado.</td></tr>'}
      </tbody></table>
      <div style="margin:22px 0 8px;font-size:18px;font-weight:800;color:#06265c">Projetado versus realizado por transportadora</div>
      <table width="100%" cellspacing="0" cellpadding="8" style="border-collapse:collapse;font-size:12px"><thead><tr style="background:#f1f5f9;color:#06265c"><th align="left">Transportadora</th><th align="right">Aprovadas</th><th align="right">Iniciadas</th><th align="left">Primeiro CT-e</th><th align="right">Projetado mensal</th><th align="right">Realizado no mês</th><th align="right">Realizado acumulado</th></tr></thead><tbody>
      ${ranking.map((t) => `<tr><td style="border-bottom:1px solid #e2e8f0"><strong>${escapeHtmlSaving(t.transportadora)}</strong></td><td align="right" style="border-bottom:1px solid #e2e8f0">${t.aprovadas}</td><td align="right" style="border-bottom:1px solid #e2e8f0">${t.iniciadas}</td><td style="border-bottom:1px solid #e2e8f0">${t.primeiroCte ? formatarData(t.primeiroCte) : 'Aguardando início'}</td><td align="right" style="border-bottom:1px solid #e2e8f0">${formatMoney(t.projetado)}</td><td align="right" style="border-bottom:1px solid #e2e8f0;color:${t.realizadoMes >= 0 ? '#087f3f' : '#c1121f'}"><strong>${formatMoney(t.realizadoMes)}</strong></td><td align="right" style="border-bottom:1px solid #e2e8f0">${formatMoney(t.realizado)}</td></tr>`).join('')}
      </tbody></table>
      <div style="margin:22px 0 8px;font-size:18px;font-weight:800;color:#06265c">Acompanhamento individual</div>
      <table width="100%" cellspacing="0" cellpadding="7" style="border-collapse:collapse;font-size:11px"><thead><tr style="background:#f1f5f9;color:#06265c"><th align="left">Transportadora / origem</th><th align="left">Canal</th><th align="left">Início considerado</th><th align="left">Critério da data</th><th align="left">Situação</th><th align="right">Saving</th></tr></thead><tbody>
      ${negociacoes.map((item) => { const r = resultados[item.id]; const inicio = r?.primeiroCte || item.dataReferenciaSalva || item.aprovadoEm; const criterio = r?.primeiroCte ? 'Primeiro CT-e' : item.dataReferenciaSalva ? 'Data de referência' : 'Data de aprovação (fallback)'; return `<tr><td style="border-bottom:1px solid #e2e8f0"><strong>${escapeHtmlSaving(item.transportadora)}</strong><br><span style="color:#64748b">${escapeHtmlSaving(item.origem || 'Todas')}</span></td><td style="border-bottom:1px solid #e2e8f0">${escapeHtmlSaving(item.canal)}</td><td style="border-bottom:1px solid #e2e8f0"><strong>${formatarData(inicio)}</strong></td><td style="border-bottom:1px solid #e2e8f0;color:#64748b">${criterio}</td><td style="border-bottom:1px solid #e2e8f0;color:${r ? '#087f3f' : '#b45309'}"><strong>${r ? 'Iniciada no realizado' : 'Aguardando início / integração'}</strong></td><td align="right" style="border-bottom:1px solid #e2e8f0;color:${Number(r?.totais?.saving || 0) >= 0 ? '#087f3f' : '#c1121f'}">${r ? `<strong>${formatMoney(r.totais.saving)}</strong>` : '—'}</td></tr>`; }).join('')}
      </tbody></table>
      <div style="margin-top:20px;padding:13px;background:#eff6ff;border-left:4px solid #2563eb;font-size:11px;color:#334155"><strong>Critério:</strong> uma negociação é considerada iniciada quando há CT-e após a data de referência. O saving compara o realizado com o histórico anterior na mesma rota e na faixa de peso da tabela negociada. Primeiro CT-e geral identificado: ${primeiroCteGeral ? formatarData(primeiroCteGeral) : 'ainda não identificado'}.</div>
    </td></tr>
  </table></td></tr></table></body></html>`;
}

function baixarLaudoSavings(tabelas, negociacoes, resultados) {
  const html = gerarHtmlLaudoSavingsExecutivo(tabelas, negociacoes, resultados);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${nomeArquivoSeguro('laudo-savings-pos-aprovacao')}-${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

function base64Utf8Saving(valor) {
  return btoa(unescape(encodeURIComponent(valor)));
}

function baixarEmailSavings(tabelas, negociacoes, resultados) {
  const html = gerarHtmlLaudoSavingsExecutivo(tabelas, negociacoes, resultados);
  const assunto = `Laudo mensal de negociações e savings - ${new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`;
  const base64 = base64Utf8Saving(html).replace(/(.{76})/g, '$1\r\n');
  const eml = ['MIME-Version: 1.0', `Subject: ${assunto}`, 'Content-Type: text/html; charset="utf-8"', 'Content-Transfer-Encoding: base64', '', base64, ''].join('\r\n');
  const blob = new Blob([eml], { type: 'message/rfc822' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${nomeArquivoSeguro('email-laudo-mensal-negociacoes')}-${new Date().toISOString().slice(0, 10)}.eml`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

export default function GestaoSavingsAprovados({ tabelas = [], podeDevolver = false, onDevolver, onSavingSalvo }) {
  const [resultados, setResultados] = useState({});
  const [carregando, setCarregando] = useState({});
  const [erros, setErros] = useState({});
  const [abertos, setAbertos] = useState({});
  const [datasReferencia, setDatasReferencia] = useState({});
  const [salvandoData, setSalvandoData] = useState({});
  const [origensRealizado, setOrigensRealizado] = useState({});
  const [salvandoOrigem, setSalvandoOrigem] = useState({});
  const [vinculos, setVinculos] = useState({});
  const [vinculosAbertos, setVinculosAbertos] = useState({});
  const [salvandoVinculo, setSalvandoVinculo] = useState({});
  const [nomesRealizado, setNomesRealizado] = useState([]);
  const [carregandoNomes, setCarregandoNomes] = useState(false);
  const [buscaVinculo, setBuscaVinculo] = useState({});
  const [calculandoTodas, setCalculandoTodas] = useState(false);
  const [progressoTodas, setProgressoTodas] = useState(null);
  const [progressoItem, setProgressoItem] = useState({});
  const [canalFiltro, setCanalFiltro] = useState('TODOS');
  const [statusFiltro, setStatusFiltro] = useState('TODOS');
  const [transportadoraFiltro, setTransportadoraFiltro] = useState('TODAS');
  const [competenciaFiltro, setCompetenciaFiltro] = useState('TODAS');
  const [buscaAnalitica, setBuscaAnalitica] = useState('');
  const [visaoAnalitica, setVisaoAnalitica] = useState('dashboard');
  // Cache da consulta "base" (mercado inteiro) por canal+período — várias negociações
  // do mesmo canal com a mesma janela reaproveitam a mesma busca em vez de repetir
  // uma consulta pesada (empresa inteira) pra cada transportadora em "Calcular todas".
  const cacheBaseRef = useRef(new Map());

  const negociacoesAprovadas = useMemo(() => {
    return (tabelas || [])
      .filter((t) => STATUS_ELEGIVEIS.includes(t.status_gestao) && t.transportadora && t.aprovado_em)
      .flatMap((t) => {
        const canalCadastro = String(t.canal || '').toUpperCase();
        const canais = canalCadastro.includes('AMBOS') || canalCadastro.includes('TODOS') || canalCadastro.includes('+')
          ? ['ATACADO', 'B2C']
          : [t.canal || ''];
        return canais.map((canal) => ({
        id: canais.length > 1 ? `${t.id}::${canal}` : t.id,
        negociacaoId: t.id,
        transportadora: t.transportadora,
        nome: t.descricao || t.nome_negociacao || t.transportadora,
        origem: t.origem || '',
        origemRealizadoSalva: t.origem_realizado_saving || '',
        canal,
        isLotacao: String(t.tipo_negociacao || t.tipo_tabela || t.canal || '')
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().includes('LOTACAO'),
        aprovadoEm: t.aprovado_em,
        dataReferenciaSalva: t.data_referencia_saving || t.aprovado_em,
        vinculoSalvo: Array.isArray(t.vinculo_transportadoras_saving) ? t.vinculo_transportadoras_saving : [],
        publicadoEm: t.publicado_em || '',
        statusGestao: t.status_gestao,
        savingProjetado: Number(t.saving_estimado || t.saving_projetado || 0),
        savingCache: t.saving_pos_aprovacao_detalhe?.porCanal?.[canal] || (canais.length === 1 ? t.saving_pos_aprovacao_detalhe : null),
        savingCacheCalculadoEm: t.saving_pos_aprovacao_calculado_em || '',
      }));
      })
      .sort((a, b) => String(b.aprovadoEm).localeCompare(String(a.aprovadoEm)));
  }, [tabelas]);

  // Hidrata o resultado a partir do cache salvo no banco (sobrevive a um F5),
  // sem sobrescrever um cálculo já feito nesta sessão.
  useEffect(() => {
    setResultados((prev) => {
      let mudou = false;
      const next = { ...prev };
      negociacoesAprovadas.forEach((item) => {
        if (next[item.id] && next[item.id].versaoMetrica !== VERSAO_METRICA_SAVING) {
          delete next[item.id];
          mudou = true;
        }
        const cacheCompativel = item.savingCache
          && item.savingCache.versaoMetrica === VERSAO_METRICA_SAVING
          && (!item.isLotacao || item.savingCache.tipoCalculo === 'LOTACAO_FLUXO');
        if (!next[item.id] && cacheCompativel) {
          next[item.id] = { ...item.savingCache, deCache: true };
          mudou = true;
        }
      });
      return mudou ? next : prev;
    });
  }, [negociacoesAprovadas]);

  useEffect(() => {
    setCarregandoNomes(true);
    listarTransportadorasRealizadoReajustes()
      .then(setNomesRealizado)
      .catch(() => {})
      .finally(() => setCarregandoNomes(false));
  }, []);

  function dataReferenciaAtual(item) {
    return String(datasReferencia[item.id] || item.dataReferenciaSalva || item.aprovadoEm).slice(0, 10);
  }

  function negociacaoId(item) {
    return item.negociacaoId || item.id;
  }

  function vinculoAtual(item) {
    return vinculos[item.id] || item.vinculoSalvo || [];
  }

  async function salvarDataReferencia(item, novaData) {
    setSalvandoData((prev) => ({ ...prev, [item.id]: true }));
    setErros((prev) => ({ ...prev, [item.id]: '' }));
    try {
      await atualizarDataReferenciaSaving(negociacaoId(item), novaData);
      setDatasReferencia((prev) => ({ ...prev, [item.id]: novaData }));
      setResultados((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    } catch (err) {
      setErros((prev) => ({ ...prev, [item.id]: err?.message || 'Erro ao salvar a data de referência.' }));
    } finally {
      setSalvandoData((prev) => ({ ...prev, [item.id]: false }));
    }
  }

  async function abrirBuscaVinculos(item) {
    setVinculosAbertos((prev) => ({ ...prev, [item.id]: !prev[item.id] }));
    setBuscaVinculo((prev) => ({ ...prev, [item.id]: prev[item.id] ?? item.transportadora }));
    if (!nomesRealizado.length && !carregandoNomes) {
      setCarregandoNomes(true);
      try {
        const lista = await listarTransportadorasRealizadoReajustes();
        setNomesRealizado(lista);
      } catch (err) {
        setErros((prev) => ({ ...prev, [item.id]: err?.message || 'Erro ao buscar transportadoras do realizado.' }));
      } finally {
        setCarregandoNomes(false);
      }
    }
  }

  function alternarVinculo(item, nome) {
    setVinculos((prev) => {
      const atual = prev[item.id] || item.vinculoSalvo || [];
      const existe = atual.includes(nome);
      const proximo = existe ? atual.filter((n) => n !== nome) : [...atual, nome];
      return { ...prev, [item.id]: proximo };
    });
  }

  async function salvarVinculo(item) {
    const lista = vinculoAtual(item);
    setSalvandoVinculo((prev) => ({ ...prev, [item.id]: true }));
    setErros((prev) => ({ ...prev, [item.id]: '' }));
    try {
      await atualizarVinculoTransportadoraSaving(negociacaoId(item), lista);
      setVinculosAbertos((prev) => ({ ...prev, [item.id]: false }));
      setResultados((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    } catch (err) {
      setErros((prev) => ({ ...prev, [item.id]: err?.message || 'Erro ao salvar o vínculo de transportadora.' }));
    } finally {
      setSalvandoVinculo((prev) => ({ ...prev, [item.id]: false }));
    }
  }

  function resultadosBusca(item) {
    const termo = normalizarTextoReajuste(buscaVinculo[item.id] ?? item.transportadora);
    const lista = nomesRealizado.filter((n) => !termo || normalizarTextoReajuste(n.nome).includes(termo));
    return lista.slice(0, 40);
  }

  function origemRealizadoAtual(item) {
    const override = origensRealizado[item.id];
    if (override !== undefined) return String(override).trim();
    return String((item.origemRealizadoSalva || item.origem) ?? '').trim();
  }

  async function salvarOrigemRealizado(item) {
    const origem = origemRealizadoAtual(item);
    setSalvandoOrigem((prev) => ({ ...prev, [item.id]: true }));
    setErros((prev) => ({ ...prev, [item.id]: '' }));
    try {
      const atualizada = await atualizarOrigemRealizadoSaving(negociacaoId(item), origem === item.origem ? '' : origem);
      if (typeof onSavingSalvo === 'function') onSavingSalvo(negociacaoId(item), atualizada);
      setResultados((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    } catch (err) {
      setErros((prev) => ({ ...prev, [item.id]: err?.message || 'Erro ao salvar o vínculo de origem.' }));
    } finally {
      setSalvandoOrigem((prev) => ({ ...prev, [item.id]: false }));
    }
  }

  function atualizarProgressoItem(id, percentual, etapa) {
    setProgressoItem((prev) => {
      const atual = prev[id]?.percentual || 0;
      return { ...prev, [id]: { percentual: Math.max(atual, percentual), etapa } };
    });
  }

  async function calcularSaving(item, { abrirDepois = true } = {}) {
    let progressoTimer = null;
    const dataReferencia = dataReferenciaAtual(item);
    const janelas = calcularJanelasSaving(dataReferencia, MESES_BASE_SAVING_PADRAO);
    if (!janelas) {
      setErros((prev) => ({ ...prev, [item.id]: 'Data de referência inválida.' }));
      return;
    }
    setCarregando((prev) => ({ ...prev, [item.id]: true }));
    setProgressoItem((prev) => ({ ...prev, [item.id]: { percentual: 5, etapa: 'Preparando cálculo' } }));
    setErros((prev) => ({ ...prev, [item.id]: '' }));
    try {
      const origemRealizado = origemRealizadoAtual(item);
      const vinculoLista = vinculoAtual(item);
      if (item.isLotacao) {
        const nomes = vinculoLista.length ? vinculoLista : [item.transportadora];
        atualizarProgressoItem(item.id, 20, 'Buscando histórico e viagens');
        const [cargasBase, cargasPorNome] = await Promise.all([
          carregarCargasLotacaoSupabase({ inicio: janelas.inicioBase, fim: janelas.fimBase, limit: 50000 }),
          Promise.all(nomes.map((transportadora) => carregarCargasLotacaoSupabase({
            transportadora, origem: origemRealizado || undefined,
            inicio: janelas.inicioAtual, fim: janelas.fimAtual, limit: 50000,
          }))),
        ]);
        atualizarProgressoItem(item.id, 75, 'Viagens carregadas');
        const cargasAtual = cargasPorNome.flat();
        if (!cargasAtual.length) {
          throw new Error(`Sem realizado após a referência para ${item.transportadora}${origemRealizado ? ` na origem ${origemRealizado}` : ''}. O saving ainda não pode ser medido.`);
        }
        atualizarProgressoItem(item.id, 88, 'Comparando fluxos');
        const resultado = calcularSavingLotacaoPorFluxo(cargasBase, cargasAtual);
        const primeiroCte = cargasAtual
          .map((carga) => carga.data_emissao || carga.emissao || carga.dataEmissao || '')
          .filter(Boolean)
          .map((data) => String(data).slice(0, 10))
          .sort()[0] || '';
        const resultadoCompleto = {
          ...resultado, janelas, ctesBase: cargasBase.length, ctesAtual: cargasAtual.length,
          versaoMetrica: VERSAO_METRICA_SAVING, deCache: false, calculadoEm: new Date().toISOString(), primeiroCte,
        };
        setResultados((prev) => ({ ...prev, [item.id]: resultadoCompleto }));
        atualizarProgressoItem(item.id, 100, 'Concluído');
        if (abrirDepois) setAbertos((prev) => ({ ...prev, [item.id]: true }));
        const cacheSalvo = await salvarSavingPosAprovacaoCache(negociacaoId(item), { ...resultadoCompleto, canal: item.canal });
        if (typeof onSavingSalvo === 'function') onSavingSalvo(negociacaoId(item), cacheSalvo);
        return;
      }
      // Se houver vínculo manual, usa lista exata (rápido, indexado). Senão cai no
      // ilike pelo nome da negociação — pode não achar tudo se o nome cadastrado
      // divergir do nome usado no realizado; por isso o botão "Buscar vínculos".
      const filtroTransportadora = vinculoLista.length
        ? { transportadorasExatas: vinculoLista }
        : { transportadoraRealizada: item.transportadora };

      try {
        atualizarProgressoItem(item.id, 20, 'Identificando rotas atuais');
        let pulso = 20;
        progressoTimer = window.setInterval(() => {
          pulso = Math.min(pulso + 4, 72);
          atualizarProgressoItem(item.id, pulso, 'Banco agregando rotas e histórico');
        }, 1500);
        const canalGrade = normalizarCanalGrade(item.canal);
        atualizarProgressoItem(item.id, 16, 'Lendo faixas da negociação');
        const faixasNegociadas = await listarFaixasPesoNegociacao(negociacaoId(item));
        // Tabelas por percentual (ad valorem) têm faixa única 0–999999: nesse caso as
        // faixas da negociação não segmentam nada e a comparação com o histórico
        // ficaria em um único balde. Caímos na grade padrão do canal para comparar
        // base x atual em faixas equivalentes.
        const faixasSegmentam = faixasNegociadas.filter((faixa) => faixa.fim < LIMITE_FAIXA_ABERTA).length >= 1;
        const usarFaixasNegociadas = faixasNegociadas.length > 0 && faixasSegmentam;
        const limitesPeso = usarFaixasNegociadas
          ? faixasNegociadas.map((faixa) => faixa.fim)
          : (GRADE_FRETE_PADRAO[canalGrade] || []).map((faixa) => faixa.peso);
        const origemFaixas = usarFaixasNegociadas
          ? 'TABELA_NEGOCIADA'
          : (faixasNegociadas.length ? 'GRADE_PADRAO_PERCENTUAL' : 'GRADE_PADRAO');
        atualizarProgressoItem(item.id, 20, usarFaixasNegociadas
          ? `Usando ${faixasNegociadas.length} faixas negociadas`
          : (faixasNegociadas.length ? `Tabela sem faixas de peso: usando grade padrão ${canalGrade}` : 'Usando grade padrão'));
        const filtrosCalculo = {
          transportadoras: vinculoLista.length ? vinculoLista : [item.transportadora],
          origem: origemRealizado,
          canal: item.canal,
          dataCorte: dataReferencia,
          fimAtual: janelas.fimAtual,
          mesesBase: MESES_BASE_SAVING_PADRAO,
          limitesPeso,
        };
        const resultadoAgregado = await calcularSavingPosAprovacaoAgregado(filtrosCalculo);
        const primeiroCte = await buscarPrimeiroCteSaving(filtrosCalculo);
        window.clearInterval(progressoTimer);
        progressoTimer = null;
        atualizarProgressoItem(item.id, 88, 'Consolidando resultado');
        if (!resultadoAgregado.ctesAtual) {
          const amostraAtual = await listarRealizadoLocalCtesParaSimulacao({
            transportadorasExatas: vinculoLista.length ? vinculoLista : [item.transportadora],
            origem: origemRealizado || undefined,
            canal: item.canal || undefined,
            inicio: janelas.inicioAtual,
            fim: janelas.fimAtual,
            limit: 1,
          });
          if (!amostraAtual.length) {
            throw new Error(`Sem realizado após a referência${origemRealizado ? ` na origem ${origemRealizado}` : ''}. O saving ainda não pode ser medido.`);
          }
        }
        const resultadoCompleto = {
          ...resultadoAgregado, janelas, versaoMetrica: VERSAO_METRICA_SAVING,
          deCache: false, calculadoEm: new Date().toISOString(), origemFaixas,
          quantidadeFaixas: usarFaixasNegociadas ? faixasNegociadas.length : limitesPeso.length,
          canalGradeFaixas: canalGrade, primeiroCte,
        };
        setResultados((prev) => ({ ...prev, [item.id]: resultadoCompleto }));
        atualizarProgressoItem(item.id, 100, `Concluído em ${(resultadoAgregado.tempoMs / 1000).toFixed(1)}s`);
        if (abrirDepois) setAbertos((prev) => ({ ...prev, [item.id]: true }));
        const cacheSalvo = await salvarSavingPosAprovacaoCache(negociacaoId(item), { ...resultadoCompleto, canal: item.canal });
        if (typeof onSavingSalvo === 'function') onSavingSalvo(negociacaoId(item), cacheSalvo);
        return;
      } catch (rpcError) {
        if (progressoTimer) window.clearInterval(progressoTimer);
        progressoTimer = null;
        const codigo = String(rpcError?.code || '');
        if (!['PGRST202', '42883'].includes(codigo)) throw rpcError;
        atualizarProgressoItem(item.id, 15, 'RPC indisponível; usando busca compatível');
      }

      // A base NÃO é filtrada por transportadora: é o percentual praticado por
      // TODAS as transportadoras na mesma rota+faixa, nos meses anteriores à data
      // de referência — o "preço de mercado" daquela rota antes da negociação.
      // O "atual" é só desta transportadora, que pode ser nova na rota (sem
      // histórico próprio) — é justamente esse o caso que o saving mede.
      // Filtra canal no servidor (rápido, indexado) — AMBOS já entra na lista de
      // variantes de qualquer canal, então não perde CT-e nenhum.
      const chaveCacheBase = `${item.canal}|${janelas.inicioBase}|${janelas.fimBase}`;
      atualizarProgressoItem(item.id, 15, 'Buscando histórico de mercado');
      let promiseBase = cacheBaseRef.current.get(chaveCacheBase);
      if (!promiseBase) {
        promiseBase = listarRealizadoLocalCtesParaSimulacao({
          canal: item.canal || undefined,
          inicio: janelas.inicioBase,
          fim: janelas.fimBase,
        });
        cacheBaseRef.current.set(chaveCacheBase, promiseBase);
        promiseBase.catch(() => cacheBaseRef.current.delete(chaveCacheBase));
      }

      const promessaBaseAcompanhada = promiseBase.then((dados) => {
        atualizarProgressoItem(item.id, 45, 'Histórico carregado');
        return dados;
      });
      atualizarProgressoItem(item.id, 25, 'Buscando realizado da transportadora');
      const promessaAtual = listarRealizadoLocalCtesParaSimulacao({
          ...filtroTransportadora,
          origem: origemRealizado || undefined,
          inicio: janelas.inicioAtual,
          fim: janelas.fimAtual,
        }).then((dados) => {
          atualizarProgressoItem(item.id, 70, 'Realizado carregado');
          return dados;
        });
      const [linhasBaseBruto, linhasAtualBruto] = await Promise.all([promessaBaseAcompanhada, promessaAtual]);
      const linhasAtual = vinculoLista.length ? linhasAtualBruto : filtrarLinhasPorTransportadora(linhasAtualBruto, item.transportadora);
      if (!linhasAtual.length) {
        const alvo = normalizarTextoReajuste(item.transportadora);
        const temNomeCompativel = nomesRealizado.some((n) => {
          const nome = normalizarTextoReajuste(n.nome);
          return nome === alvo || nome.includes(alvo) || alvo.includes(nome);
        });
        throw new Error(temNomeCompativel
          ? `Transportadora vinculada, mas sem realizado após a referência${origemRealizado ? ` na origem ${origemRealizado}` : ''}. O saving ainda não pode ser medido.`
          : 'Sem vínculo com uma transportadora do realizado. Abra “Buscar vínculos” e selecione o nome correto antes de calcular.');
      }
      atualizarProgressoItem(item.id, 88, 'Comparando rotas e faixas');
      const resultado = calcularSavingPorRotaFaixa(linhasBaseBruto, linhasAtual, { canalPadrao: item.canal });
      const resultadoCompleto = { ...resultado, janelas, ctesBase: linhasBaseBruto.length, ctesAtual: linhasAtual.length, versaoMetrica: VERSAO_METRICA_SAVING, deCache: false, calculadoEm: new Date().toISOString() };
      setResultados((prev) => ({ ...prev, [item.id]: resultadoCompleto }));
      atualizarProgressoItem(item.id, 100, 'Concluído');
      if (abrirDepois) setAbertos((prev) => ({ ...prev, [item.id]: true }));
      // Salva o resultado no banco pra sobreviver a um F5 — se der erro (ex: migration
      // ainda não aplicada), o cálculo em tela continua valendo, só não persiste.
      const cacheSalvo = await salvarSavingPosAprovacaoCache(negociacaoId(item), { ...resultadoCompleto, canal: item.canal });
      if (typeof onSavingSalvo === 'function') onSavingSalvo(negociacaoId(item), cacheSalvo);
    } catch (err) {
      setErros((prev) => ({ ...prev, [item.id]: err?.message || 'Erro ao calcular saving.' }));
    } finally {
      if (progressoTimer) window.clearInterval(progressoTimer);
      setCarregando((prev) => ({ ...prev, [item.id]: false }));
    }
  }

  async function calcularTodas({ recalcular = false, negociacoesAlvo = null, modoLabel = null } = {}) {
    setCalculandoTodas(true);
    const base = negociacoesAlvo || negociacoesAprovadas;
    const fila = negociacoesAlvo
      ? negociacoesAlvo
      : (recalcular ? base : base.filter((item) => !resultados[item.id]));
    for (let i = 0; i < fila.length; i += 1) {
      const item = fila[i];
      setProgressoTodas({
        atual: i + 1,
        total: fila.length,
        transportadora: item.transportadora,
        modo: modoLabel || (recalcular ? 'Recalculando todas' : 'Calculando pendentes'),
      });
      if (!item.isLotacao && statusVinculo(item).label === 'Sem vínculo') {
        setErros((prev) => ({ ...prev, [item.id]: 'Sem vínculo com uma transportadora do realizado. Selecione o nome correto em “Buscar vínculos”.' }));
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await calcularSaving(item, { abrirDepois: false });
    }
    setProgressoTodas(null);
    setCalculandoTodas(false);
  }

  // Atualiza só as negociações que já têm CT-e naquela competência, em vez de
  // recalcular tudo — assim um mês fechado (ex.: julho) não fica sendo puxado de
  // novo toda hora; só a competência escolhida (ex.: agosto) é reconsultada.
  function atualizarCompetencia(competencia) {
    const alvo = negociacoesCalculadas.filter((item) =>
      (resultados[item.id]?.mensal || []).some((mes) => mes.competencia === competencia));
    if (!alvo.length) return;
    calcularTodas({
      negociacoesAlvo: alvo,
      modoLabel: `Atualizando ${nomeMesSaving(competencia)}`,
    });
  }

  function verDetalhe(item) {
    setAbertos((prev) => ({ ...prev, [item.id]: true }));
    const el = document.getElementById(`saving-item-${item.id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const canaisDisponiveis = [...new Set(negociacoesAprovadas.map((item) => item.canal || 'SEM CANAL'))].sort();
  const transportadorasDisponiveis = [...new Set(negociacoesAprovadas.map((item) => item.transportadora))].sort();
  const competenciasDisponiveis = [...new Set(negociacoesAprovadas.flatMap((item) =>
    (resultados[item.id]?.mensal || []).map((mes) => String(mes.competencia).slice(0, 7))
  ))].sort().reverse();
  const termoAnalitico = normalizarTextoReajuste(buscaAnalitica);
  const negociacoesFiltradas = negociacoesAprovadas.filter((item) => {
    const canalOk = canalFiltro === 'TODOS' || (item.canal || 'SEM CANAL') === canalFiltro;
    const statusOk = statusFiltro === 'TODOS'
      || (statusFiltro === 'CALCULADAS' ? Boolean(resultados[item.id]) : !resultados[item.id]);
    const transportadoraOk = transportadoraFiltro === 'TODAS' || item.transportadora === transportadoraFiltro;
    const competenciaOk = competenciaFiltro === 'TODAS' || (resultados[item.id]?.mensal || [])
      .some((mes) => String(mes.competencia).startsWith(competenciaFiltro));
    const buscaOk = !termoAnalitico || normalizarTextoReajuste(
      `${item.transportadora} ${item.nome} ${item.origem} ${item.canal}`
    ).includes(termoAnalitico);
    return canalOk && statusOk && transportadoraOk && competenciaOk && buscaOk;
  });
  const negociacoesCalculadas = negociacoesFiltradas.filter((item) => resultados[item.id]);
  const negociacoesPendentes = negociacoesFiltradas.filter((item) => !resultados[item.id]);
  function savingNoEscopo(item) {
    const resultado = resultados[item.id];
    if (!resultado) return 0;
    if (competenciaFiltro === 'TODAS') return Number(resultado.totais?.saving || 0);
    return (resultado.mensal || [])
      .filter((mes) => String(mes.competencia).startsWith(competenciaFiltro))
      .reduce((acc, mes) => acc + Number(mes.saving || 0), 0);
  }
  const savingTotal = negociacoesCalculadas.reduce((acc, item) => acc + savingNoEscopo(item), 0);
  const savingMensal = [...negociacoesCalculadas.reduce((mapa, item) => {
    (resultados[item.id]?.mensal || []).filter((mes) => competenciaFiltro === 'TODAS' || String(mes.competencia).startsWith(competenciaFiltro)).forEach((mes) => {
      const atual = mapa.get(mes.competencia) || { competencia: mes.competencia, saving: 0, ctesAtual: 0, transportadoras: new Set() };
      atual.saving += Number(mes.saving || 0);
      atual.ctesAtual += Number(mes.ctesAtual || 0);
      atual.transportadoras.add(item.transportadora);
      mapa.set(mes.competencia, atual);
    });
    return mapa;
  }, new Map()).values()].sort((a, b) => String(a.competencia).localeCompare(String(b.competencia)));
  const transportadorasAcompanhadas = new Set(negociacoesCalculadas.map((item) => item.transportadora)).size;
  const rankingCanais = [...negociacoesCalculadas.reduce((mapa, item) => {
    const canal = item.canal || 'SEM CANAL';
    const atual = mapa.get(canal) || { canal, saving: 0, negociacoes: 0, rotas: 0 };
    atual.saving += savingNoEscopo(item);
    atual.negociacoes += 1;
    atual.rotas += Number(resultados[item.id]?.linhas?.length || 0);
    mapa.set(canal, atual);
    return mapa;
  }, new Map()).values()].sort((a, b) => b.saving - a.saving);
  const rankingTransportadoras = [...negociacoesCalculadas.reduce((mapa, item) => {
    const atual = mapa.get(item.transportadora) || { nome: item.transportadora, saving: 0, negociacoes: 0 };
    atual.saving += savingNoEscopo(item);
    atual.negociacoes += 1;
    mapa.set(item.transportadora, atual);
    return mapa;
  }, new Map()).values()].sort((a, b) => b.saving - a.saving);
  const maiorSavingCanal = Math.max(1, ...rankingCanais.map((item) => Math.abs(item.saving)));
  const savingPositivo = negociacoesCalculadas.filter((item) => savingNoEscopo(item) >= 0);
  const savingNegativo = negociacoesCalculadas.filter((item) => savingNoEscopo(item) < 0);
  const rotasComparaveis = negociacoesCalculadas.reduce((acc, item) => acc + Number(resultados[item.id]?.linhas?.length || 0), 0);
  const ctesComparaveis = savingMensal.reduce((acc, mes) => acc + Number(mes.ctesAtual || 0), 0);
  const melhorCanal = rankingCanais[0] || null;
  const piorCanal = rankingCanais.length ? [...rankingCanais].sort((a, b) => a.saving - b.saving)[0] : null;
  const ultimoMes = savingMensal[savingMensal.length - 1] || null;
  const mesAnterior = savingMensal[savingMensal.length - 2] || null;
  const variacaoMensal = mesAnterior && mesAnterior.saving
    ? (Number(ultimoMes?.saving || 0) - Number(mesAnterior.saving)) / Math.abs(Number(mesAnterior.saving))
    : null;
  const kpis = [
    { label: 'Aprovadas no recorte', value: negociacoesFiltradas.length },
    { label: 'Já calculadas', value: negociacoesCalculadas.length },
    { label: 'Pendentes', value: negociacoesPendentes.length },
    { label: 'Transportadoras', value: transportadorasAcompanhadas },
    { label: 'Saving projetado', value: formatMoney(savingTotal) },
  ];

  function statusVinculo(item) {
    if (vinculoAtual(item).length) return { label: 'Manual', cor: '#1d4ed8' };
    if (item.isLotacao) return { label: 'Automático', cor: '#475569' };
    if (carregandoNomes) return { label: 'Verificando…', cor: '#64748b' };
    const alvo = normalizarTextoReajuste(item.transportadora);
    const compativel = nomesRealizado.some((n) => {
      const nome = normalizarTextoReajuste(n.nome);
      return nome === alvo || nome.includes(alvo) || alvo.includes(nome);
    });
    return compativel
      ? { label: 'Automático', cor: '#087f3f' }
      : { label: 'Sem vínculo', cor: '#c1121f' };
  }

  function devolverParaNegociacao(item) {
    if (!podeDevolver || typeof onDevolver !== 'function') return;
    const motivo = window.prompt(`Informe o motivo para devolver a negociação de ${item.transportadora}:`);
    if (motivo === null) return;
    const observacao = String(motivo || '').trim();
    if (!observacao) {
      window.alert('Informe o motivo da devolução.');
      return;
    }
    if (!window.confirm('Devolver esta negociação para ajustes? Ela sairá dos savings até ser aprovada novamente.')) return;
    onDevolver(item, observacao);
  }

  return (
    <section className="sim-card">
      <h2 style={{ marginTop: 0 }}>Savings pós-aprovação</h2>
      <p style={{ color: '#64748b' }}>
        Acompanha o resultado das negociações aprovadas no realizado. Atacado e B2C comparam frete/NF por rota e faixa;
        lotação compara as viagens carregadas pela transportadora com o custo médio histórico do mesmo fluxo e veículo,
        nos {MESES_BASE_SAVING_PADRAO} meses anteriores à data de referência.
      </p>

      <div style={{ display: 'flex', gap: 6, margin: '16px 0 12px', flexWrap: 'wrap' }}>
        {[['dashboard', 'Visão executiva'], ['laudo', 'Laudo interativo'], ['mensal', 'Evolução mensal'], ['detalhes', 'Detalhamento']].map(([id, label]) => (
          <button key={id} type="button" className="sim-tab" onClick={() => setVisaoAnalitica(id)} style={{ padding: '7px 12px', fontWeight: visaoAnalitica === id ? 800 : 600, color: visaoAnalitica === id ? '#1d4ed8' : '#475569', background: visaoAnalitica === id ? '#eff6ff' : '#fff', borderColor: visaoAnalitica === id ? '#60a5fa' : '#cbd5e1' }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ padding: 14, border: '1px solid #dbe4f0', borderRadius: 12, background: '#f8fafc', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: 10 }}>
        <label style={{ fontSize: 11, color: '#475569' }}>Canal
          <select value={canalFiltro} onChange={(e) => setCanalFiltro(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4, padding: '7px 8px' }}>
            <option value="TODOS">Todos os canais</option>
            {canaisDisponiveis.map((canal) => <option key={canal} value={canal}>{canal}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 11, color: '#475569' }}>Competência
          <select value={competenciaFiltro} onChange={(e) => setCompetenciaFiltro(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4, padding: '7px 8px' }}>
            <option value="TODAS">Todo o período</option>
            {competenciasDisponiveis.map((mes) => <option key={mes} value={mes}>{nomeMesSaving(`${mes}-01`)}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 11, color: '#475569' }}>Transportadora
          <select value={transportadoraFiltro} onChange={(e) => setTransportadoraFiltro(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4, padding: '7px 8px' }}>
            <option value="TODAS">Todas</option>
            {transportadorasDisponiveis.map((nome) => <option key={nome} value={nome}>{nome}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 11, color: '#475569' }}>Situação
          <select value={statusFiltro} onChange={(e) => setStatusFiltro(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4, padding: '7px 8px' }}>
            <option value="TODOS">Todas</option><option value="CALCULADAS">Calculadas</option><option value="PENDENTES">Pendentes</option>
          </select>
        </label>
        <label style={{ fontSize: 11, color: '#475569' }}>Busca livre
          <input value={buscaAnalitica} onChange={(e) => setBuscaAnalitica(e.target.value)} placeholder="Rota, origem, negociação..." style={{ display: 'block', width: '100%', marginTop: 4, padding: '7px 8px', boxSizing: 'border-box' }} />
        </label>
        <div style={{ display: 'flex', alignItems: 'end' }}>
          <button type="button" className="sim-tab" style={{ width: '100%', padding: '7px 8px' }} onClick={() => { setCanalFiltro('TODOS'); setCompetenciaFiltro('TODAS'); setTransportadoraFiltro('TODAS'); setStatusFiltro('TODOS'); setBuscaAnalitica(''); }}>Limpar filtros</button>
        </div>
      </div>

      {!negociacoesAprovadas.length ? (
        <div className="sim-alert info">Nenhuma negociação aprovada pelo gestor até o momento.</div>
      ) : (
        <>
          <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginTop: 4 }}>
            {kpis.map((c) => (
              <div key={c.label} className="summary-card">
                <span>{c.label}</span>
                <strong>{c.value}</strong>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="sim-tab"
              onClick={() => calcularTodas({ recalcular: false, negociacoesAlvo: negociacoesFiltradas, modoLabel: 'Calculando seleção' })}
              disabled={calculandoTodas || !negociacoesPendentes.length}
            >
              Calcular pendentes ({negociacoesPendentes.length})
            </button>
            <button
              type="button"
              className="sim-tab"
              onClick={() => calcularTodas({ recalcular: true, negociacoesAlvo: negociacoesFiltradas, modoLabel: 'Recalculando seleção' })}
              disabled={calculandoTodas || !negociacoesFiltradas.length}
              title="Consulta novamente a base atualizada e substitui todos os savings salvos"
            >
              Recalcular seleção ({negociacoesFiltradas.length})
            </button>
            <button
              type="button"
              className="sim-tab"
              onClick={() => baixarLaudoSavings(tabelas, negociacoesFiltradas, resultados)}
              disabled={!negociacoesCalculadas.length}
              title={!negociacoesCalculadas.length ? 'Calcule ao menos uma negociação para gerar o laudo' : ''}
            >
              Baixar laudo executivo
            </button>
            <button
              type="button"
              className="sim-tab"
              onClick={() => baixarEmailSavings(tabelas, negociacoesFiltradas, resultados)}
              disabled={!negociacoesCalculadas.length}
              title="Baixa um arquivo .eml com o resumo formatado no corpo do e-mail"
            >
              Baixar e-mail mensal
            </button>
            {progressoTodas ? (
              <div style={{ display: 'grid', gap: 4, minWidth: 310, padding: '7px 10px', border: '1px solid #bfdbfe', borderRadius: 8, background: '#eff6ff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 11, color: '#1e3a8a' }}>
                  <span><strong>{progressoTodas.modo}: {progressoTodas.atual} de {progressoTodas.total}</strong> · {progressoTodas.transportadora}</span>
                  <span>{Math.round((progressoTodas.atual / progressoTodas.total) * 100)}%</span>
                </div>
                <progress
                  value={progressoTodas.atual}
                  max={progressoTodas.total}
                  style={{ width: '100%', height: 9, accentColor: '#2563eb' }}
                  aria-label={`Processando ${progressoTodas.atual} de ${progressoTodas.total}`}
                />
              </div>
            ) : null}
          </div>
          {visaoAnalitica === 'dashboard' && negociacoesCalculadas.length ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))', gap: 14, marginTop: 14 }}>
              <div style={{ border: '1px solid #dbe4f0', borderRadius: 12, padding: 14 }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Saving por canal</h3>
                <div style={{ display: 'grid', gap: 11 }}>
                  {rankingCanais.map((item) => (
                    <button key={item.canal} type="button" onClick={() => setCanalFiltro(item.canal)} style={{ border: 0, background: 'transparent', padding: 0, textAlign: 'left', cursor: 'pointer' }} title={`Filtrar pelo canal ${item.canal}`}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}><strong>{item.canal}</strong><span style={{ color: item.saving >= 0 ? '#087f3f' : '#c1121f', fontWeight: 800 }}>{formatMoney(item.saving)}</span></div>
                      <div style={{ height: 8, borderRadius: 99, background: '#e2e8f0', marginTop: 5, overflow: 'hidden' }}><div style={{ width: `${Math.max(3, Math.abs(item.saving) / maiorSavingCanal * 100)}%`, height: '100%', borderRadius: 99, background: item.saving >= 0 ? '#16a34a' : '#dc2626' }} /></div>
                      <div style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>{item.negociacoes} negociações · {item.rotas} rotas comparáveis</div>
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ border: '1px solid #dbe4f0', borderRadius: 12, padding: 14 }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Ranking de transportadoras</h3>
                <div style={{ display: 'grid', gap: 7 }}>
                  {rankingTransportadoras.slice(0, 8).map((item, index) => (
                    <button key={item.nome} type="button" onClick={() => setTransportadoraFiltro(item.nome)} style={{ display: 'grid', gridTemplateColumns: '24px minmax(0, 1fr) auto', gap: 7, alignItems: 'center', border: 0, borderBottom: '1px solid #f1f5f9', background: 'transparent', padding: '5px 0', textAlign: 'left', cursor: 'pointer' }}>
                      <span style={{ color: '#94a3b8', fontWeight: 800 }}>{index + 1}</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.nome}</span><strong style={{ color: item.saving >= 0 ? '#087f3f' : '#c1121f' }}>{formatMoney(item.saving)}</strong>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
          {visaoAnalitica === 'laudo' ? (
            <article style={{ marginTop: 16, border: '1px solid #cbd5e1', borderRadius: 14, overflow: 'hidden', background: '#fff' }}>
              <header style={{ padding: '20px 22px', color: '#fff', background: 'linear-gradient(135deg, #001f4f, #174ea6)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'start', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 11, letterSpacing: 1.1, textTransform: 'uppercase', opacity: 0.8 }}>Laudo gerencial interativo</div>
                    <h3 style={{ margin: '5px 0 4px', fontSize: 23 }}>Performance de savings pós-aprovação</h3>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>Recorte atual: {canalFiltro === 'TODOS' ? 'todos os canais' : canalFiltro} · {competenciaFiltro === 'TODAS' ? 'todo o período' : nomeMesSaving(`${competenciaFiltro}-01`)}</div>
                  </div>
                  <button type="button" className="sim-tab" onClick={() => baixarLaudoSavings(tabelas, negociacoesFiltradas, resultados)} disabled={!negociacoesCalculadas.length} style={{ background: '#fff', color: '#001f4f', padding: '7px 11px' }}>Exportar este recorte</button>
                </div>
              </header>

              {!negociacoesCalculadas.length ? (
                <div className="sim-alert info" style={{ margin: 18 }}>Não há negociações calculadas neste recorte. Ajuste os filtros ou calcule as pendências.</div>
              ) : (
                <div style={{ padding: 20, display: 'grid', gap: 18 }}>
                  <section>
                    <h4 style={{ margin: '0 0 10px', color: '#001f4f' }}>1. Parecer executivo</h4>
                    <div style={{ padding: 14, borderRadius: 10, background: savingTotal >= 0 ? '#f0fdf4' : '#fef2f2', borderLeft: `4px solid ${savingTotal >= 0 ? '#16a34a' : '#dc2626'}`, lineHeight: 1.55, fontSize: 13 }}>
                      O recorte apresenta <strong style={{ color: savingTotal >= 0 ? '#087f3f' : '#c1121f' }}>{formatMoney(savingTotal)}</strong> de saving realizado em <strong>{negociacoesCalculadas.length}</strong> negociações calculadas, cobrindo <strong>{rotasComparaveis.toLocaleString('pt-BR')} rotas</strong> e <strong>{ctesComparaveis.toLocaleString('pt-BR')} CT-es comparáveis</strong>. {savingPositivo.length} negociações geram economia e {savingNegativo.length} apresentam impacto negativo.
                      {melhorCanal ? <> O canal de maior contribuição é <button type="button" onClick={() => setCanalFiltro(melhorCanal.canal)} style={{ border: 0, padding: 0, background: 'transparent', color: '#1d4ed8', fontWeight: 800, cursor: 'pointer' }}>{melhorCanal.canal}</button>, com {formatMoney(melhorCanal.saving)}.</> : null}
                    </div>
                  </section>

                  <section>
                    <h4 style={{ margin: '0 0 10px', color: '#001f4f' }}>2. Indicadores e tendência</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                      {[
                        ['Saving no recorte', formatMoney(savingTotal), savingTotal >= 0 ? '#087f3f' : '#c1121f'],
                        ['Negociações positivas', `${savingPositivo.length} de ${negociacoesCalculadas.length}`, '#087f3f'],
                        ['Exceções negativas', savingNegativo.length, savingNegativo.length ? '#c1121f' : '#087f3f'],
                        ['Variação último mês', variacaoMensal === null ? 'Sem base anterior' : formatPercent(variacaoMensal), variacaoMensal === null || variacaoMensal >= 0 ? '#087f3f' : '#c1121f'],
                      ].map(([label, value, color]) => <div key={label} style={{ padding: 12, border: '1px solid #e2e8f0', borderRadius: 10 }}><div style={{ fontSize: 11, color: '#64748b' }}>{label}</div><strong style={{ display: 'block', marginTop: 5, fontSize: 18, color }}>{value}</strong></div>)}
                    </div>
                  </section>

                  <section>
                    <h4 style={{ margin: '0 0 10px', color: '#001f4f' }}>3. Contribuição por canal</h4>
                    <div style={gestaoStyles.tabelaWrap}>
                      <table className="sim-table" style={{ minWidth: 620 }}><thead><tr><th>Canal</th><th>Negociações</th><th>Rotas</th><th>Participação</th><th>Saving</th><th></th></tr></thead><tbody>
                        {rankingCanais.map((canal) => <tr key={canal.canal}><td><strong>{canal.canal}</strong></td><td>{canal.negociacoes}</td><td>{canal.rotas}</td><td>{savingTotal ? formatPercent(canal.saving / savingTotal) : '—'}</td><td style={{ fontWeight: 800, color: canal.saving >= 0 ? '#087f3f' : '#c1121f' }}>{formatMoney(canal.saving)}</td><td><button type="button" className="sim-tab" style={{ padding: '3px 8px', fontSize: 10 }} onClick={() => setCanalFiltro(canal.canal)}>Analisar canal</button></td></tr>)}
                      </tbody></table>
                    </div>
                  </section>

                  <section>
                    <h4 style={{ margin: '0 0 10px', color: '#001f4f' }}>4. Pontos de atenção</h4>
                    {savingNegativo.length ? <div style={gestaoStyles.tabelaWrap}><table className="sim-table" style={{ minWidth: 680 }}><thead><tr><th>Transportadora</th><th>Canal</th><th>Origem</th><th>Rotas</th><th>Impacto</th><th></th></tr></thead><tbody>
                      {[...savingNegativo].sort((a, b) => savingNoEscopo(a) - savingNoEscopo(b)).map((item) => <tr key={item.id}><td><strong>{item.transportadora}</strong></td><td>{item.canal}</td><td>{item.origem || '—'}</td><td>{resultados[item.id]?.linhas?.length || 0}</td><td style={{ color: '#c1121f', fontWeight: 800 }}>{formatMoney(savingNoEscopo(item))}</td><td><button type="button" className="sim-tab" style={{ padding: '3px 8px', fontSize: 10 }} onClick={() => { setTransportadoraFiltro(item.transportadora); setVisaoAnalitica('detalhes'); setAbertos((prev) => ({ ...prev, [item.id]: true })); }}>Abrir evidências</button></td></tr>)}
                    </tbody></table></div> : <div className="sim-alert info">Nenhuma negociação com saving negativo no recorte atual.</div>}
                  </section>

                  <section style={{ padding: 14, background: '#f8fafc', borderRadius: 10 }}>
                    <h4 style={{ margin: '0 0 8px', color: '#001f4f' }}>5. Recomendação</h4>
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: '#475569' }}>
                      {savingNegativo.length
                        ? `Priorizar a revisão das ${savingNegativo.length} negociação(ões) com impacto negativo, começando por ${[...savingNegativo].sort((a, b) => savingNoEscopo(a) - savingNoEscopo(b))[0]?.transportadora}. Validar rotas, faixas e vínculo do realizado antes da próxima atualização.`
                        : 'Manter o acompanhamento mensal e validar a continuidade do ganho nas rotas de maior volume. O recorte não apresenta exceções negativas neste momento.'}
                      {piorCanal && piorCanal.saving < 0 ? ` O canal ${piorCanal.canal} requer atenção especial.` : ''}
                    </p>
                  </section>
                </div>
              )}
            </article>
          ) : null}
          {visaoAnalitica === 'mensal' && savingMensal.length ? (
            <div style={{ marginTop: 14, ...gestaoStyles.tabelaWrap }}>
              <table className="sim-table" style={{ minWidth: 620 }}>
                <thead><tr><th>MÃªs do realizado</th><th>CT-es comparÃ¡veis</th><th>Transportadoras</th><th>Saving do mÃªs</th><th></th></tr></thead>
                <tbody>
                  {savingMensal.map((mes) => (
                    <tr key={mes.competencia}>
                      <td><strong>{new Date(`${mes.competencia}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</strong></td>
                      <td>{mes.ctesAtual.toLocaleString('pt-BR')}</td>
                      <td>{mes.transportadoras.size}</td>
                      <td style={{ fontWeight: 800, color: mes.saving >= 0 ? '#087f3f' : '#c1121f' }}>{formatMoney(mes.saving)}</td>
                      <td>
                        <button
                          type="button"
                          className="sim-tab"
                          style={{ padding: '2px 8px', fontSize: 10 }}
                          disabled={calculandoTodas}
                          title="Recalcula só as negociações com CT-e nesta competência, sem mexer nos meses já fechados"
                          onClick={() => atualizarCompetencia(mes.competencia)}
                        >
                          Atualizar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}

      {negociacoesFiltradas.length && !['mensal', 'laudo'].includes(visaoAnalitica) ? (
        <div style={{ marginTop: 14, ...gestaoStyles.tabelaWrap }}>
          <table className="sim-table" style={{ minWidth: 1080 }}>
            <thead>
              <tr>
                <th>Transportadora</th>
                <th>Negociação</th>
                <th>Origem</th>
                <th>Canal</th>
                <th>Vínculo</th>
                <th>Aprovado em</th>
                <th>Status</th>
                <th>Rotas comparáveis</th>
                <th>Saving</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {negociacoesFiltradas.map((item) => {
                const r = resultados[item.id];
                const vinculoStatus = statusVinculo(item);
                return (
                  <tr key={item.id}>
                    <td><strong>{item.transportadora}</strong></td>
                    <td>{item.nome}</td>
                    <td style={{ minWidth: 155 }}>
                      <strong>{item.origem || '—'}</strong>
                      <div style={{ display: 'flex', gap: 4, marginTop: 4, alignItems: 'center' }}>
                        <input
                          type="text"
                          value={origensRealizado[item.id] ?? (item.origemRealizadoSalva || item.origem)}
                          onChange={(e) => setOrigensRealizado((prev) => ({ ...prev, [item.id]: e.target.value }))}
                          placeholder="Origem no realizado"
                          title="Nome correspondente da origem na base de CT-es"
                          style={{ width: 115, minWidth: 0, padding: '3px 5px', fontSize: 10 }}
                        />
                        {origemRealizadoAtual(item) !== (item.origemRealizadoSalva || item.origem) ? (
                          <button type="button" className="sim-tab" style={{ padding: '2px 6px', fontSize: 9 }} disabled={Boolean(salvandoOrigem[item.id])} onClick={() => salvarOrigemRealizado(item)}>
                            {salvandoOrigem[item.id] ? '...' : 'Salvar'}
                          </button>
                        ) : null}
                      </div>
                      {item.origemRealizadoSalva && item.origemRealizadoSalva !== item.origem ? (
                        <div style={{ fontSize: 9, color: '#1d4ed8', marginTop: 2 }}>Realizado: {item.origemRealizadoSalva}</div>
                      ) : null}
                    </td>
                    <td>{item.canal}</td>
                    <td style={{ minWidth: 190 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                        <span style={gestaoStyles.badgeStatus(vinculoStatus.cor)}>{vinculoStatus.label}</span>
                        <button
                          type="button"
                          className="sim-tab"
                          style={{ padding: '2px 7px', fontSize: 10 }}
                          onClick={() => {
                            setBuscaVinculo((prev) => ({
                              ...prev,
                              [item.id]: prev[item.id] ?? vinculoAtual(item)[0] ?? item.transportadora,
                            }));
                            setVinculosAbertos((prev) => ({ ...prev, [item.id]: !prev[item.id] }));
                          }}
                        >
                          {vinculosAbertos[item.id] ? 'Cancelar' : vinculoAtual(item).length ? 'Editar' : 'Vincular'}
                        </button>
                      </div>
                      {vinculosAbertos[item.id] ? (
                        <div style={{ marginTop: 6, padding: 7, border: '1px solid #cbd5e1', borderRadius: 7, background: '#fff', minWidth: 260 }}>
                          <input
                            type="text"
                            value={buscaVinculo[item.id] || ''}
                            onChange={(e) => setBuscaVinculo((prev) => ({ ...prev, [item.id]: e.target.value }))}
                            placeholder="Pesquisar nome no realizado"
                            style={{ width: '100%', minWidth: 0, padding: '5px 7px', fontSize: 11 }}
                          />
                          <div style={{ display: 'grid', gap: 4, maxHeight: 150, overflowY: 'auto', marginTop: 6 }}>
                            {resultadosBusca(item).map((n) => (
                              <label key={n.nome} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={vinculoAtual(item).includes(n.nome)}
                                  onChange={() => alternarVinculo(item, n.nome)}
                                />
                                <span>{n.nome}</span>
                                <span
                                  style={{ color: '#94a3b8', marginLeft: 'auto' }}
                                  title="Quantidade total encontrada para esse nome na base. O saving exige também uma rota/faixa histórica comparável."
                                >
                                  {n.ctes} CT-es na base
                                </span>
                              </label>
                            ))}
                          </div>
                          {vinculoAtual(item).length ? (
                            <div style={{ marginTop: 6, fontSize: 10, color: '#1d4ed8' }}>
                              {vinculoAtual(item).length} vínculo(s): {vinculoAtual(item).join(', ')}
                            </div>
                          ) : null}
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 7 }}>
                            <button
                              type="button"
                              className="sim-tab"
                              style={{ padding: '3px 8px', fontSize: 10 }}
                              disabled={!vinculoAtual(item).length || Boolean(salvandoVinculo[item.id])}
                              onClick={() => salvarVinculo(item)}
                            >
                              {salvandoVinculo[item.id] ? 'Salvando…' : 'Salvar vínculos'}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </td>
                    <td>{formatarData(item.aprovadoEm)}</td>
                    <td style={{ maxWidth: 260 }}>
                      {carregando[item.id] ? (
                        <div style={{ display: 'grid', gap: 3, minWidth: 180 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10, color: '#1d4ed8' }}>
                            <strong>{progressoItem[item.id]?.etapa || 'Calculando…'}</strong>
                            <span>{progressoItem[item.id]?.percentual || 5}%</span>
                          </div>
                          <progress
                            value={progressoItem[item.id]?.percentual || 5}
                            max="100"
                            style={{ width: '100%', height: 8, accentColor: '#2563eb' }}
                            aria-label={`Progresso de ${item.transportadora}`}
                          />
                        </div>
                      ) : r ? (
                        <span style={gestaoStyles.badgeStatus('#087f3f')}>Calculado</span>
                      ) : erros[item.id] ? (
                        <div>
                          <span style={gestaoStyles.badgeStatus('#c1121f')}>Erro</span>
                          <div style={{ fontSize: 11, color: '#c1121f', marginTop: 3 }}>{erros[item.id]}</div>
                        </div>
                      ) : (
                        <span style={gestaoStyles.badgeStatus('#b45309')}>Pendente</span>
                      )}
                    </td>
                    <td>{r ? r.linhas.length : '—'}</td>
                    <td style={{ fontWeight: 700, color: r ? (r.totais.saving >= 0 ? '#087f3f' : '#c1121f') : '#94a3b8' }}>
                      {r ? formatMoney(savingNoEscopo(item)) : '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="sim-tab"
                          style={{ padding: '3px 8px', fontSize: 11 }}
                          onClick={() => (r ? verDetalhe(item) : calcularSaving(item))}
                          disabled={Boolean(carregando[item.id])}
                          title={!r && erros[item.id] ? erros[item.id] : ''}
                        >
                          {carregando[item.id] ? 'Calculando…' : r ? 'Ver detalhe' : erros[item.id] ? 'Tentar de novo' : 'Calcular'}
                        </button>
                        {podeDevolver && item.statusGestao === 'APROVADA_GESTOR' ? (
                          <button
                            type="button"
                            className="sim-tab"
                            style={{ padding: '3px 8px', fontSize: 11, color: '#b45309', borderColor: '#fed7aa' }}
                            onClick={() => devolverParaNegociacao(item)}
                            disabled={Boolean(carregando[item.id])}
                          >
                            Devolver
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={8}><strong>Total geral</strong></td>
                <td style={{ fontWeight: 800 }}>{formatMoney(savingTotal)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        {visaoAnalitica === 'detalhes' ? negociacoesFiltradas.map((item) => {
          const resultado = resultados[item.id];
          const aberto = Boolean(abertos[item.id]);
          const vinculoLista = vinculoAtual(item);
          const vinculoMudou = JSON.stringify([...vinculoLista].sort()) !== JSON.stringify([...(item.vinculoSalvo || [])].sort());
          return (
            <div key={item.id} id={`saving-item-${item.id}`} style={gestaoStyles.origemCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <strong>{item.transportadora}</strong>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    {item.nome}{item.origem ? ` · ${item.origem}` : ''}{item.canal ? ` · ${item.canal}` : ''}
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Aprovado no sistema em {formatarData(item.aprovadoEm)}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    <label style={{ fontSize: 11, color: '#64748b' }}>Data de referência p/ saving:</label>
                    <input
                      type="date"
                      value={dataReferenciaAtual(item)}
                      onChange={(e) => setDatasReferencia((prev) => ({ ...prev, [item.id]: e.target.value }))}
                      style={{ fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid #cbd5e1' }}
                    />
                    {dataReferenciaAtual(item) !== String(item.dataReferenciaSalva).slice(0, 10) ? (
                      <button
                        type="button"
                        className="sim-tab"
                        style={{ padding: '3px 8px', fontSize: 11 }}
                        disabled={Boolean(salvandoData[item.id])}
                        onClick={() => salvarDataReferencia(item, dataReferenciaAtual(item))}
                      >
                        {salvandoData[item.id] ? 'Salvando…' : 'Salvar data'}
                      </button>
                    ) : null}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <button
                      type="button"
                      className="sim-tab"
                      style={{ padding: '3px 8px', fontSize: 11 }}
                      onClick={() => abrirBuscaVinculos(item)}
                    >
                      {vinculoLista.length ? `Vínculo: ${vinculoLista.length} nome(s)` : 'Buscar vínculos'}
                    </button>
                  </div>
                  {vinculosAbertos[item.id] ? (
                    <div style={{ marginTop: 8, padding: 10, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, maxWidth: 480 }}>
                      {carregandoNomes ? (
                        <div style={{ fontSize: 12, color: '#64748b' }}>Carregando transportadoras do realizado…</div>
                      ) : (
                        <>
                          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>
                            Pesquise e marque o(s) nome(s) exatos usados no realizado que correspondem a "{item.transportadora}":
                          </div>
                          <input
                            type="text"
                            value={buscaVinculo[item.id] ?? item.transportadora}
                            onChange={(e) => setBuscaVinculo((prev) => ({ ...prev, [item.id]: e.target.value }))}
                            placeholder="Pesquisar transportadora…"
                            style={{ width: '100%', fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid #cbd5e1', marginBottom: 8 }}
                          />
                          <div style={{ display: 'grid', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
                            {resultadosBusca(item).length ? resultadosBusca(item).map((n) => (
                              <label key={n.nome} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <input
                                  type="checkbox"
                                  checked={vinculoLista.includes(n.nome)}
                                  onChange={() => alternarVinculo(item, n.nome)}
                                />
                                {n.nome} <span style={{ color: '#94a3b8' }}>({n.ctes} CT-es na base)</span>
                              </label>
                            )) : (
                              <div style={{ fontSize: 12, color: '#94a3b8' }}>Nenhum resultado para essa busca.</div>
                            )}
                          </div>
                          {vinculoLista.length ? (
                            <div style={{ fontSize: 11, color: '#1d4ed8', marginTop: 6 }}>
                              Selecionados: {vinculoLista.join(', ')}
                            </div>
                          ) : null}
                          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                            <button
                              type="button"
                              className="sim-tab"
                              style={{ padding: '3px 8px', fontSize: 11 }}
                              disabled={!vinculoMudou || Boolean(salvandoVinculo[item.id])}
                              onClick={() => salvarVinculo(item)}
                            >
                              {salvandoVinculo[item.id] ? 'Salvando…' : 'Salvar vínculo'}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  {resultado ? (
                    <>
                      <strong style={{ color: resultado.totais.saving >= 0 ? '#087f3f' : '#c1121f' }}>
                        Saving: {formatMoney(resultado.totais.saving)}
                      </strong>
                      <span style={{ fontSize: 10, color: '#94a3b8' }}>
                        {resultado.deCache
                          ? `salvo em ${formatarData(item.savingCacheCalculadoEm)}`
                          : 'calculado agora'}
                      </span>
                    </>
                  ) : null}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      type="button"
                      className="sim-tab"
                      onClick={() => (resultado ? setAbertos((prev) => ({ ...prev, [item.id]: !aberto })) : calcularSaving(item))}
                      disabled={Boolean(carregando[item.id])}
                    >
                      {carregando[item.id] ? 'Calculando…' : resultado ? (aberto ? 'Ocultar' : 'Ver detalhe') : 'Calcular saving'}
                    </button>
                    {resultado ? (
                      <button
                        type="button"
                        className="sim-tab"
                        style={{ padding: '3px 8px', fontSize: 11 }}
                        onClick={() => calcularSaving(item)}
                        disabled={Boolean(carregando[item.id])}
                      >
                        Recalcular
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              {erros[item.id] ? <div className="sim-alert erro" style={{ marginTop: 8 }}>{erros[item.id]}</div> : null}

              {resultado && aberto ? (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
                    Base (mercado, todas as transportadoras): {formatarData(resultado.janelas.inicioBase)} a {formatarData(resultado.janelas.fimBase)} ({resultado.ctesBase} CT-es) ·
                    {' '}Atual comparável (só essa transportadora): {formatarData(resultado.janelas.inicioAtual)} a {formatarData(resultado.janelas.fimAtual)} ({resultado.ctesAtual} CT-es)
                  </div>
                  <div className="sim-alert info" style={{ marginBottom: 10, padding: '7px 10px', fontSize: 11 }}>
                    O total do vínculo confirma que existem CT-es com esse nome na base. No saving entram somente os CT-es cuja rota e faixa de peso também possuem histórico anterior ao corte. Resultado negativo representa aumento de custo.
                  </div>
                  <div style={{ fontSize: 11, color: resultado.origemFaixas === 'TABELA_NEGOCIADA' ? '#087f3f' : '#b45309', marginBottom: 10, fontWeight: 700 }}>
                    Faixas utilizadas: {resultado.origemFaixas === 'TABELA_NEGOCIADA'
                      ? `tabela negociada (${resultado.quantidadeFaixas} faixas)`
                      : resultado.origemFaixas === 'GRADE_PADRAO_PERCENTUAL'
                        ? `grade padrão ${resultado.canalGradeFaixas || ''} (${resultado.quantidadeFaixas || 0} faixas) — tabela por percentual, sem faixas de peso próprias`
                        : `grade padrão (${resultado.quantidadeFaixas || 0} faixas — fallback)`}
                  </div>
                  {resultado.mensal?.length ? (
                    <div style={{ ...gestaoStyles.tabelaWrap, marginBottom: 12 }}>
                      <table className="sim-table" style={{ minWidth: 620 }}>
                        <thead><tr><th>MÃªs</th><th>CT-es</th><th>Rotas/faixas</th><th>Frete/NF atual</th><th>Saving</th></tr></thead>
                        <tbody>{resultado.mensal.map((mes) => (
                          <tr key={mes.competencia}>
                            <td><strong>{new Date(`${mes.competencia}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</strong></td>
                            <td>{mes.ctesAtual.toLocaleString('pt-BR')}</td>
                            <td>{mes.rotas}</td>
                            <td>{formatPercent(mes.pctAtualMedio)}</td>
                            <td style={{ fontWeight: 800, color: mes.saving >= 0 ? '#087f3f' : '#c1121f' }}>{formatMoney(mes.saving)}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  ) : null}
                  {!resultado.linhas.length ? (
                    <div className="sim-alert info">
                      {resultado.ctesAtual === 0
                        ? 'Não há CT-e nenhum dessa transportadora no período atual (ou com esse vínculo). Confira a data de referência e o vínculo de transportadora.'
                        : 'Nenhuma rota/faixa do período atual dessa transportadora teve preço de mercado comparável na base (nenhuma outra transportadora rodou nessas mesmas rotas/faixas antes).'}
                    </div>
                  ) : (
                    <div style={gestaoStyles.tabelaWrap}>
                      <table className="sim-table" style={{ minWidth: 920 }}>
                        <thead>
                          <tr>
                            <th>Rota</th>
                            <th>Faixa</th>
                            <th>{resultado.tipoCalculo === 'LOTACAO_FLUXO' ? 'Média antes' : '% antes'}</th>
                            <th>{resultado.tipoCalculo === 'LOTACAO_FLUXO' ? 'Média atual' : '% atual'}</th>
                            <th>Diferença</th>
                            <th>{resultado.tipoCalculo === 'LOTACAO_FLUXO' ? 'Frete atual' : 'Valor NF atual'}</th>
                            <th>Saving</th>
                          </tr>
                        </thead>
                        <tbody>
                          {resultado.linhas.map((linha) => (
                            <tr key={`${linha.rota}||${linha.faixa}`}>
                              <td>{linha.rota}</td>
                              <td>{linha.faixa}</td>
                              <td>{resultado.tipoCalculo === 'LOTACAO_FLUXO' ? formatMoney(linha.pctBase) : formatPercent(linha.pctBase)}</td>
                              <td>{resultado.tipoCalculo === 'LOTACAO_FLUXO' ? formatMoney(linha.pctAtual) : formatPercent(linha.pctAtual)}</td>
                              <td style={{ color: linha.diffPct >= 0 ? '#087f3f' : '#c1121f', fontWeight: 700 }}>
                                {resultado.tipoCalculo === 'LOTACAO_FLUXO' ? formatMoney(linha.diffPct) : formatPercent(linha.diffPct)}
                              </td>
                              <td>{formatMoney(linha.valorNFAtual)}</td>
                              <td style={{ fontWeight: 700 }}>{formatMoney(linha.saving)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td colSpan={2}><strong>Total</strong></td>
                            <td>{resultado.tipoCalculo === 'LOTACAO_FLUXO' ? formatMoney(resultado.totais.pctBaseMedio) : formatPercent(resultado.totais.pctBaseMedio)}</td>
                            <td>{resultado.tipoCalculo === 'LOTACAO_FLUXO' ? formatMoney(resultado.totais.pctAtualMedio) : formatPercent(resultado.totais.pctAtualMedio)}</td>
                            <td>{resultado.tipoCalculo === 'LOTACAO_FLUXO' ? formatMoney(resultado.totais.pctBaseMedio - resultado.totais.pctAtualMedio) : formatPercent(resultado.totais.pctBaseMedio - resultado.totais.pctAtualMedio)}</td>
                            <td>{formatMoney(resultado.totais.valorNFAtual)}</td>
                            <td style={{ fontWeight: 800 }}>{formatMoney(resultado.totais.saving)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          );
        }) : null}
      </div>
    </section>
  );
}
