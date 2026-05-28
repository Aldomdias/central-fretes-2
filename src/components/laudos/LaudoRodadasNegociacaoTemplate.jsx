import React, { useRef } from 'react';
import * as XLSX from 'xlsx';
import { montarLaudosRodadasNegociacao, formatadoresLaudoRodadas } from '../../utils/laudosRodadasNegociacaoHtml';
import './LaudoRodadasNegociacaoTemplate.css';

const { dinheiro, numero, percentual, dataBR } = formatadoresLaudoRodadas;

const CSS_EXPORT_LAUDO_RODADAS = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #f8fafc; color: #0f172a; font-family: Arial, Helvetica, sans-serif; }
  .laudo-export-shell { padding: 24px; }
  .laudo-rodadas-page { max-width: 1200px; margin: 0 auto; background: #f8fafc; color: #0f172a; border: 1px solid #e2e8f0; border-radius: 18px; overflow: hidden; box-shadow: 0 18px 42px rgba(15, 23, 42, 0.08); }
  .laudo-rodadas-header { padding: 26px; background: linear-gradient(135deg, #430d95, #6514de 55%, #9153f0); color: #fff; }
  .laudo-rodadas-header small { display: block; text-transform: uppercase; letter-spacing: .08em; opacity: .86; font-weight: 800; }
  .laudo-rodadas-header h1 { margin: 8px 0 6px; font-size: 28px; line-height: 1.12; }
  .laudo-rodadas-header p { margin: 0; opacity: .92; }
  .laudo-rodadas-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-top: 18px; }
  .laudo-rodadas-meta div { background: rgba(255, 255, 255, .13); border: 1px solid rgba(255, 255, 255, .22); border-radius: 12px; padding: 10px 12px; }
  .laudo-rodadas-meta span, .laudo-rodadas-kpi span { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; opacity: .75; font-weight: 800; }
  .laudo-rodadas-meta strong { display: block; margin-top: 4px; font-size: 14px; }
  .laudo-rodadas-body { padding: 22px; display: grid; gap: 18px; }
  .laudo-rodadas-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .laudo-rodadas-actions button { border: 1px solid #cbd5e1; background: #fff; color: #334155; border-radius: 10px; padding: 9px 13px; font-weight: 800; cursor: pointer; }
  .laudo-rodadas-actions button.primary { background: #6514de; color: #fff; border-color: #6514de; }
  .laudo-rodadas-alert { padding: 12px 14px; border-radius: 12px; border: 1px solid #bfdbfe; background: #eff6ff; color: #1e3a8a; font-weight: 700; }
  .laudo-rodadas-alert.warn { background: #fff7ed; color: #9a3412; border-color: #fed7aa; }
  .laudo-rodadas-alert.danger { background: #fef2f2; color: #991b1b; border-color: #fecaca; }
  .laudo-rodadas-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
  .laudo-rodadas-kpi { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 14px; box-shadow: 0 8px 22px rgba(15, 23, 42, .05); page-break-inside: avoid; }
  .laudo-rodadas-kpi strong { display: block; font-size: 22px; margin-top: 4px; color: #111827; }
  .laudo-rodadas-kpi small { display: block; margin-top: 4px; color: #64748b; }
  .laudo-rodadas-section { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 16px; box-shadow: 0 8px 22px rgba(15, 23, 42, .04); page-break-inside: avoid; }
  .laudo-rodadas-section h2 { margin: 0 0 8px; font-size: 18px; }
  .laudo-rodadas-section p { color: #475569; line-height: 1.55; }
  .laudo-rodadas-table-wrap { overflow-x: auto; margin-top: 12px; }
  .laudo-rodadas-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .laudo-rodadas-table th, .laudo-rodadas-table td { border-bottom: 1px solid #e2e8f0; padding: 9px 8px; text-align: left; vertical-align: top; }
  .laudo-rodadas-table th { background: #f8fafc; color: #475569; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
  .laudo-rodadas-table .right { text-align: right; }
  .laudo-rodadas-badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 3px 8px; font-size: 11px; font-weight: 800; background: #e0f2fe; color: #075985; }
  .laudo-rodadas-badge.alta { background: #fee2e2; color: #991b1b; }
  .laudo-rodadas-badge.media { background: #fef3c7; color: #92400e; }
  .laudo-rodadas-badge.baixa { background: #dcfce7; color: #166534; }
  .laudo-rodadas-recomendacao { background: #f5f3ff; border: 1px solid #ddd6fe; color: #4c1d95; border-radius: 14px; padding: 14px; line-height: 1.55; font-weight: 700; }
  @media print {
    body { background: #fff; }
    .laudo-export-shell { padding: 0; }
    .laudo-rodadas-actions { display: none !important; }
    .laudo-rodadas-page { box-shadow: none !important; border-radius: 0 !important; max-width: none !important; width: 100% !important; border: 0 !important; }
    .laudo-rodadas-section, .laudo-rodadas-kpi { break-inside: avoid; page-break-inside: avoid; }
    .laudo-rodadas-table { font-size: 10px; }
  }
`;

function Variacao({ valor, tipo = 'numero', sufixo = '' }) {
  const v = Number(valor || 0);
  const positivo = v >= 0;
  const texto = tipo === 'dinheiro'
    ? dinheiro(Math.abs(v))
    : tipo === 'percentual'
      ? percentual(Math.abs(v))
      : numero(Math.abs(v));
  return <small style={{ color: positivo ? '#15803d' : '#b91c1c', fontWeight: 800 }}>{positivo ? '+' : '-'}{texto}{sufixo}</small>;
}

function prioridadeClasse(valor) {
  const v = String(valor || '').toLowerCase();
  if (v.includes('alta')) return 'alta';
  if (v.includes('média') || v.includes('media')) return 'media';
  return 'baixa';
}

function nomeArquivoSeguro(v, fallback = 'laudo-rodadas') {
  return String(v || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

function baixarArquivo(conteudo, nomeArquivo, tipo) {
  const blob = new Blob([conteudo], { type: tipo });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

function escapeHtml(valor) {
  return String(valor || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function montarHtmlExportavel(laudoNode, titulo) {
  const clone = laudoNode.cloneNode(true);
  clone.querySelectorAll('.laudo-rodadas-actions').forEach((node) => node.remove());
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(titulo)}</title>
  <style>${CSS_EXPORT_LAUDO_RODADAS}</style>
</head>
<body>
  <main class="laudo-export-shell">
    ${clone.outerHTML}
  </main>
</body>
</html>`;
}

function abrirPdf(laudoNode, titulo) {
  const html = montarHtmlExportavel(laudoNode, titulo);
  const janela = window.open('', '_blank', 'width=1200,height=900');
  if (!janela) {
    window.print();
    return;
  }
  janela.document.open();
  janela.document.write(html);
  janela.document.close();
  janela.focus();
  setTimeout(() => janela.print(), 600);
}

function comoArray(...listas) {
  for (const lista of listas) {
    if (Array.isArray(lista) && lista.length) return lista;
  }
  return [];
}

function temDadosReais(linhas = []) {
  return Array.isArray(linhas) && linhas.some((item) => item && Object.values(item).some((valor) => valor !== null && valor !== undefined && valor !== '' && valor !== 0));
}

function planilhaSegura(linhas = [], fallback = {}) {
  return Array.isArray(linhas) && linhas.length ? linhas : [fallback];
}

function linhaResumoExcel(laudo = {}) {
  const comparativo = laudo.comparativo || {};
  const inicial = comparativo.inicial || {};
  const atual = comparativo.atual || {};
  return [{
    Transportadora: laudo.transportadora || '',
    Canal: laudo.canal || '',
    Origem: laudo.origem || '',
    Periodo: laudo.periodo || '',
    Tipo: laudo.tipo || '',
    Rodadas: laudo.quantidadeSimulacoes || 0,
    Aderencia_Inicial: inicial.aderencia || 0,
    Aderencia_Atual: atual.aderencia || 0,
    Evolucao_Aderencia: comparativo.evolucaoAderencia || 0,
    CTEs_Ganhos_Inicial: inicial.ctesGanhos || 0,
    CTEs_Ganhos_Atual: atual.ctesGanhos || 0,
    Volumes_Atual: atual.volumesGanhos || 0,
    Faturamento_Capturado_Mes: atual.faturamentoMes || 0,
    Saving_Mes: atual.savingMes || 0,
    Ajuste_Medio_Atual: atual.reducaoMedia || 0,
    Recomendacao: laudo.recomendacao || '',
  }];
}

function evolucaoExcel(linhas = []) {
  return linhas.map((item) => ({
    Rodada: item.rodada || '',
    Data: dataBR(item.criadoEm),
    CTEs_Analisados: item.ctesAnalisados || 0,
    CTEs_Com_Tabela: item.ctesComTabela || 0,
    CTEs_Ganhos: item.ctesGanhos || 0,
    CTEs_Perdidos: item.ctesPerdidos || 0,
    Volumes_Ganhos: item.volumesGanhos || 0,
    Pedidos_Dia: item.pedidosDia || 0,
    Pedidos_Mes: item.pedidosMes || 0,
    Volumes_Dia: item.volumesDia || 0,
    Volumes_Mes: item.volumesMes || 0,
    Aderencia: item.aderencia || 0,
    Faturamento_Mes: item.faturamentoMes || 0,
    Faturamento_Ano: item.faturamentoAno || 0,
    Saving_Mes: item.savingMes || 0,
    Saving_Ano: item.savingAno || 0,
    Percentual_Frete_Real: item.percentualFreteReal || 0,
    Percentual_Frete_Tabela: item.percentualFreteTabela || 0,
    Ajuste_Medio: item.reducaoMedia || 0,
  }));
}

function oportunidadesExcel(linhas = []) {
  return linhas.map((item) => ({
    Chave: item.chave || item.rota || item.ufDestino || item.faixa || item.cidade || item.destino || '',
    Origem: item.origem || '',
    Destino: item.destino || item.cidade || item.cidadeDestino || '',
    UF_Destino: item.ufDestino || item.uf || '',
    Faixa: item.faixa || item.faixaPeso || '',
    CTEs_Analisados: item.ctesAnalisados || item.ctes || 0,
    CTEs_Ganhos: item.ctesGanhos || 0,
    CTEs_Perdidos: item.ctesPerdidos || 0,
    Volumes: item.volumes || item.volume || 0,
    Faturamento_Potencial: item.faturamentoPotencial || 0,
    Faturamento_Capturado: item.faturamentoCapturado || 0,
    Faturamento_Nao_Capturado: item.faturamentoNaoCapturado || 0,
    Aderencia: item.aderencia || item.aderenciaAtual || 0,
    Ajuste_Medio: item.ajusteMedio || 0,
    Prioridade: item.prioridade || '',
    Status: item.status || '',
  }));
}

function exportarExcel(laudo = {}, externo) {
  const wb = XLSX.utils.book_new();
  const paretoCidades = comoArray(laudo.paretoCidades, laudo.paretoCidadesVolume, laudo.cidadesPareto, laudo.cidadesCriticas);
  const ufDestino = comoArray(laudo.ufsCriticas, laudo.ufsPrioritarias, laudo.ufDestino, laudo.visaoUfDestino);
  const destinoFaixa = comoArray(laudo.destinoFaixa, laudo.destinoFaixaPareto, laudo.paretoDestinoFaixa, laudo.rotasCriticas, laudo.ondeAjustar);
  const mesorregiaoFaixa = comoArray(laudo.mesorregiaoFaixa, laudo.mesorregioesFaixa, laudo.mesorregiaoPorFaixa);

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhaResumoExcel(laudo)), 'Resumo');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(planilhaSegura(evolucaoExcel(laudo.evolucaoRodadas || []), { Aviso: 'Nenhuma rodada salva para evolução.' })), 'Rodadas');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(planilhaSegura(oportunidadesExcel(paretoCidades), { Aviso: 'Sem Pareto de cidades para este recorte.' })), 'Pareto cidades');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(planilhaSegura(oportunidadesExcel(ufDestino), { Aviso: 'Sem visão por UF destino para este recorte.' })), 'UF destino');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(planilhaSegura(oportunidadesExcel(destinoFaixa), { Aviso: 'Sem visão Destino x faixa para este recorte.' })), 'Destino x faixa');
  if (temDadosReais(mesorregiaoFaixa)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(oportunidadesExcel(mesorregiaoFaixa)), 'Mesorregiao x faixa');
  }

  const tipo = externo ? 'transportador' : 'diretoria';
  const nome = `laudo-rodadas-${tipo}-${nomeArquivoSeguro(laudo.transportadora)}.xlsx`;
  XLSX.writeFile(wb, nome);
}

function TabelaEvolucao({ linhas = [], externo }) {
  return (
    <div className="laudo-rodadas-table-wrap">
      <table className="laudo-rodadas-table">
        <thead>
          <tr>
            <th>Rodada</th>
            <th>Data</th>
            <th className="right">CT-es ganhos</th>
            <th className="right">Volumes</th>
            <th className="right">Aderência</th>
            <th className="right">Faturamento/mês</th>
            {!externo ? <th className="right">Saving/mês</th> : null}
            <th className="right">Ajuste médio</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((item) => (
            <tr key={item.id || `${item.rodada}-${item.criadoEm}`}>
              <td><strong>{item.rodada}ª</strong></td>
              <td>{dataBR(item.criadoEm)}</td>
              <td className="right">{numero(item.ctesGanhos)}</td>
              <td className="right">{numero(item.volumesGanhos)}</td>
              <td className="right">{percentual(item.aderencia)}</td>
              <td className="right">{dinheiro(item.faturamentoMes)}</td>
              {!externo ? <td className="right">{dinheiro(item.savingMes)}</td> : null}
              <td className="right">{percentual(item.reducaoMedia)}</td>
            </tr>
          ))}
          {!linhas.length ? <tr><td colSpan={externo ? 7 : 8}>Nenhuma simulação salva para montar evolução.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

function TabelaOportunidades({ linhas = [], modo = 'rota' }) {
  return (
    <div className="laudo-rodadas-table-wrap">
      <table className="laudo-rodadas-table">
        <thead>
          <tr>
            <th>{modo === 'uf' ? 'UF destino' : modo === 'faixa' ? 'Faixa' : modo === 'cidade' ? 'Cidade/Destino' : 'Rota/Cotação'}</th>
            <th>UF</th>
            <th>Faixa</th>
            <th className="right">CT-es perdidos</th>
            <th className="right">CT-es ganhos</th>
            <th className="right">Volumes</th>
            <th className="right">Fat. não capturado</th>
            <th className="right">Ajuste médio</th>
            <th>Prioridade</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((item, idx) => (
            <tr key={item.chave || item.rota || item.ufDestino || item.faixa || item.cidade || idx}>
              <td>
                <strong>{item.rota || item.chave || item.cidade || item.destino || item.ufDestino || item.faixa || '-'}</strong>
                {item.origem || item.destino ? <div style={{ color: '#64748b', fontSize: 11 }}>{[item.origem, item.destino].filter(Boolean).join(' > ')}</div> : null}
              </td>
              <td>{item.ufDestino || item.uf || '-'}</td>
              <td>{item.faixa || item.faixaPeso || '-'}</td>
              <td className="right">{numero(item.ctesPerdidos)}</td>
              <td className="right">{numero(item.ctesGanhos)}</td>
              <td className="right">{numero(item.volumes || item.volume)}</td>
              <td className="right">{dinheiro(item.faturamentoNaoCapturado)}</td>
              <td className="right">{percentual(item.ajusteMedio)}</td>
              <td><span className={`laudo-rodadas-badge ${prioridadeClasse(item.prioridade)}`}>{item.prioridade || 'BAIXA'}</span></td>
            </tr>
          ))}
          {!linhas.length ? <tr><td colSpan="9">Sem dados suficientes para este agrupamento.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

function TabelaMelhorias({ linhas = [] }) {
  return (
    <div className="laudo-rodadas-table-wrap">
      <table className="laudo-rodadas-table">
        <thead>
          <tr>
            <th>Rota/Cotação</th>
            <th>UF</th>
            <th className="right">Ganhos 1ª rodada</th>
            <th className="right">Ganhos atual</th>
            <th className="right">Evolução</th>
            <th className="right">Aderência atual</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((item, idx) => (
            <tr key={item.chave || item.rota || idx}>
              <td><strong>{item.rota || item.chave || '-'}</strong></td>
              <td>{item.ufDestino || '-'}</td>
              <td className="right">{numero(item.ctesGanhosInicial)}</td>
              <td className="right">{numero(item.ctesGanhosFinal)}</td>
              <td className="right">+{numero(item.evolucaoCtes)}</td>
              <td className="right">{percentual(item.aderenciaAtual)}</td>
            </tr>
          ))}
          {!linhas.length ? <tr><td colSpan="6">Ainda não há melhoria destacada por rota/cotação.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

function SecaoTabela({ titulo, descricao, linhas, modo }) {
  if (!temDadosReais(linhas)) return null;
  return (
    <section className="laudo-rodadas-section">
      <h2>{titulo}</h2>
      {descricao ? <p>{descricao}</p> : null}
      <TabelaOportunidades linhas={linhas} modo={modo} />
    </section>
  );
}

export function LaudoRodadasNegociacaoTemplate({ tipo = 'executivo', tabela = null, dados = null }) {
  const laudoRef = useRef(null);
  const laudos = dados ? null : montarLaudosRodadasNegociacao(tabela || {});
  const laudo = dados || (tipo === 'transportador' ? laudos.transportador : laudos.executivo);
  const externo = tipo === 'transportador' || laudo.tipo === 'transportador_rodadas';
  const comparativo = laudo.comparativo || {};
  const inicial = comparativo.inicial || {};
  const atual = comparativo.atual || {};
  const quantidadeRodadas = Number(laudo.quantidadeSimulacoes || (laudo.evolucaoRodadas || []).length || 0);
  const poucaBase = quantidadeRodadas < 2;
  const tipoArquivo = externo ? 'transportador' : 'diretoria';
  const tituloExport = `${laudo.titulo || 'Laudo de rodadas'} - ${laudo.transportadora || 'Transportadora'}`;

  const paretoCidades = comoArray(laudo.paretoCidades, laudo.paretoCidadesVolume, laudo.cidadesPareto, laudo.cidadesCriticas).slice(0, 12);
  const ufDestino = comoArray(laudo.ufsCriticas, laudo.ufsPrioritarias, laudo.ufDestino, laudo.visaoUfDestino).slice(0, 10);
  const destinoFaixa = comoArray(laudo.destinoFaixa, laudo.destinoFaixaPareto, laudo.paretoDestinoFaixa, laudo.rotasCriticas, laudo.ondeAjustar).slice(0, 12);
  const mesorregiaoFaixa = comoArray(laudo.mesorregiaoFaixa, laudo.mesorregioesFaixa, laudo.mesorregiaoPorFaixa).slice(0, 12);
  const melhorias = comoArray(laudo.rotasMelhoraram, laudo.ondeMelhorou).slice(0, 10);

  function handlePdf() {
    if (!laudoRef.current) return;
    abrirPdf(laudoRef.current, tituloExport);
  }

  function handleHtml() {
    if (!laudoRef.current) return;
    const html = montarHtmlExportavel(laudoRef.current, tituloExport);
    baixarArquivo(html, `laudo-rodadas-${tipoArquivo}-${nomeArquivoSeguro(laudo.transportadora)}.html`, 'text/html;charset=utf-8');
  }

  function handleExcel() {
    exportarExcel(laudo, externo);
  }

  return (
    <article className="laudo-rodadas-page" ref={laudoRef}>
      <header className="laudo-rodadas-header">
        <small>{externo ? 'Devolutiva comercial' : 'Uso interno - diretoria e gestão'}</small>
        <h1>{laudo.titulo}</h1>
        <p>{laudo.transportadora || 'Transportadora'} · {laudo.canal || '-'} · {laudo.origem || 'Origem não informada'}</p>
        <div className="laudo-rodadas-meta">
          <div><span>Transportadora</span><strong>{laudo.transportadora || '-'}</strong></div>
          <div><span>Canal</span><strong>{laudo.canal || '-'}</strong></div>
          <div><span>Período</span><strong>{laudo.periodo || '-'}</strong></div>
          <div><span>Rodadas</span><strong>{numero(quantidadeRodadas)}</strong></div>
          <div><span>Gerado em</span><strong>{dataBR(laudo.geradoEm)}</strong></div>
        </div>
      </header>

      <div className="laudo-rodadas-body">
        <div className="laudo-rodadas-actions">
          <button type="button" className="primary" onClick={handlePdf}>Gerar PDF</button>
          <button type="button" onClick={handleHtml}>Baixar HTML</button>
          <button type="button" onClick={handleExcel}>Baixar Excel</button>
        </div>

        {externo ? (
          <div className="laudo-rodadas-alert">Este relatório mostra oportunidades de ajuste comercial por rota, cotação, UF e faixa de peso. Não expõe referências internas nem concorrentes.</div>
        ) : (
          <div className="laudo-rodadas-alert danger">Uso interno: contém saving, impacto financeiro e recomendação estratégica. Não enviar esta versão ao transportador.</div>
        )}

        {poucaBase ? (
          <div className="laudo-rodadas-alert warn">Diagnóstico inicial: com apenas uma rodada salva, o laudo mostra a fotografia atual da proposta. A evolução será exibida automaticamente a partir da segunda rodada.</div>
        ) : null}

        <section className="laudo-rodadas-kpis">
          <div className="laudo-rodadas-kpi"><span>Aderência atual</span><strong>{percentual(atual.aderencia)}</strong>{!poucaBase ? <Variacao valor={comparativo.evolucaoAderencia} tipo="percentual" sufixo=" p.p." /> : <small>Diagnóstico inicial</small>}</div>
          <div className="laudo-rodadas-kpi"><span>CT-es competitivos</span><strong>{numero(atual.ctesGanhos)}</strong>{!poucaBase ? <Variacao valor={comparativo.evolucaoCtesGanhos} /> : <small>Base atual</small>}</div>
          <div className="laudo-rodadas-kpi"><span>Volumes competitivos</span><strong>{numero(atual.volumesGanhos)}</strong>{!poucaBase ? <Variacao valor={comparativo.evolucaoVolumes} /> : <small>Base atual</small>}</div>
          <div className="laudo-rodadas-kpi"><span>Faturamento capturado/mês</span><strong>{dinheiro(atual.faturamentoMes)}</strong>{!poucaBase ? <Variacao valor={comparativo.evolucaoFaturamentoMes} tipo="dinheiro" /> : <small>Base atual</small>}</div>
          {!externo ? <div className="laudo-rodadas-kpi"><span>Saving/mês</span><strong>{dinheiro(atual.savingMes)}</strong>{!poucaBase ? <Variacao valor={comparativo.evolucaoSavingMes} tipo="dinheiro" /> : <small>Base atual</small>}</div> : null}
          <div className="laudo-rodadas-kpi"><span>Ajuste médio necessário</span><strong>{percentual(atual.reducaoMedia)}</strong><small>{poucaBase ? 'Sem variação' : `Inicial: ${percentual(inicial.reducaoMedia)}`}</small></div>
        </section>

        {poucaBase ? (
          <section className="laudo-rodadas-section">
            <h2>Diagnóstico inicial</h2>
            <p>
              {externo
                ? `A proposta atual apresenta ${percentual(atual.aderencia)} de aderência, com ${numero(atual.ctesGanhos)} CT-es competitivos. A próxima etapa é revisar os destinos e faixas de maior impacto listados abaixo.`
                : `A primeira rodada apresenta ${percentual(atual.aderencia)} de aderência, ${numero(atual.ctesGanhos)} CT-es competitivos, faturamento capturado estimado de ${dinheiro(atual.faturamentoMes)} por mês e saving mensal de ${dinheiro(atual.savingMes)}.`}
            </p>
          </section>
        ) : (
          <>
            <section className="laudo-rodadas-section">
              <h2>Resumo da evolução</h2>
              <p>
                {externo
                  ? `A proposta saiu de ${percentual(inicial.aderencia)} para ${percentual(atual.aderencia)} de aderência. Os CT-es competitivos passaram de ${numero(inicial.ctesGanhos)} para ${numero(atual.ctesGanhos)}. O objetivo da próxima rodada deve ser revisar os pontos de maior impacto listados abaixo.`
                  : `A negociação saiu de ${percentual(inicial.aderencia)} para ${percentual(atual.aderencia)} de aderência, com saving mensal de ${dinheiro(inicial.savingMes)} para ${dinheiro(atual.savingMes)} e faturamento capturado de ${dinheiro(inicial.faturamentoMes)} para ${dinheiro(atual.faturamentoMes)} por mês.`}
              </p>
            </section>

            <section className="laudo-rodadas-section">
              <h2>Evolução rodada a rodada</h2>
              <TabelaEvolucao linhas={laudo.evolucaoRodadas || []} externo={externo} />
            </section>

            <section className="laudo-rodadas-section">
              <h2>{externo ? 'Onde a proposta melhorou' : 'Rotas/Cotações que evoluíram'}</h2>
              <TabelaMelhorias linhas={melhorias} />
            </section>
          </>
        )}

        <SecaoTabela
          titulo="Mesorregião x Faixa"
          descricao="Agrupamento exibido somente quando houver dado real de mesorregião na simulação."
          linhas={mesorregiaoFaixa}
          modo="rota"
        />

        <SecaoTabela
          titulo="Pareto 80% das cidades por volume total"
          descricao="Cidades/destinos que concentram maior volume e devem direcionar a próxima negociação."
          linhas={paretoCidades}
          modo="cidade"
        />

        <SecaoTabela
          titulo="Visão por Estado/UF"
          descricao="Estados com maior oportunidade de captura, perda de competitividade ou ajuste necessário."
          linhas={ufDestino}
          modo="uf"
        />

        <SecaoTabela
          titulo="Pareto 80% — Destino x Faixa"
          descricao="Combinação de destino e faixa de peso com maior impacto na aderência."
          linhas={destinoFaixa}
          modo="faixa"
        />

        <section className="laudo-rodadas-section">
          <h2>Recomendação final</h2>
          <div className="laudo-rodadas-recomendacao">{laudo.recomendacao}</div>
        </section>
      </div>
    </article>
  );
}
