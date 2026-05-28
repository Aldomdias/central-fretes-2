import React, { useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { montarLaudosRodadasNegociacao, formatadoresLaudoRodadas } from '../../utils/laudosRodadasNegociacaoHtml';
import './LaudoRodadasNegociacaoTemplate.css';

const { dinheiro, numero, percentual, dataBR } = formatadoresLaudoRodadas;

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

const CSS_EXPORT = `
  body { margin: 0; background: #f8fafc; color: #0f172a; font-family: Arial, sans-serif; }
  .laudo-export-shell { padding: 24px; }
  .laudo-rodadas-page { max-width: 1200px; margin: 0 auto; background: #f8fafc; color: #0f172a; border: 1px solid #e2e8f0; border-radius: 18px; overflow: hidden; box-shadow: 0 18px 42px rgba(15, 23, 42, 0.08); }
  .laudo-rodadas-header { padding: 26px; background: linear-gradient(135deg, #430d95, #6514de 55%, #9153f0); color: #fff; }
  .laudo-rodadas-header small { display: block; text-transform: uppercase; letter-spacing: .08em; opacity: .86; font-weight: 800; }
  .laudo-rodadas-header h1 { margin: 8px 0 6px; font-size: 28px; line-height: 1.12; }
  .laudo-rodadas-header p { margin: 0; opacity: .92; }
  .laudo-rodadas-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-top: 18px; }
  .laudo-rodadas-meta div { background: rgba(255, 255, 255, .13); border: 1px solid rgba(255, 255, 255, .22); border-radius: 12px; padding: 10px 12px; }
  .laudo-rodadas-meta span, .laudo-rodadas-kpi span { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; opacity: .75; font-weight: 800; }
  .laudo-rodadas-body { padding: 22px; display: grid; gap: 18px; }
  .laudo-rodadas-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .laudo-rodadas-actions button { border: 1px solid #cbd5e1; background: #fff; color: #334155; border-radius: 10px; padding: 9px 13px; font-weight: 800; cursor: pointer; }
  .laudo-rodadas-actions button.primary { background: #6514de; color: #fff; border-color: #6514de; }
  .laudo-rodadas-alert { padding: 12px 14px; border-radius: 12px; border: 1px solid #bfdbfe; background: #eff6ff; color: #1e3a8a; font-weight: 700; }
  .laudo-rodadas-alert.warn { background: #fff7ed; color: #9a3412; border-color: #fed7aa; }
  .laudo-rodadas-alert.danger { background: #fef2f2; color: #991b1b; border-color: #fecaca; }
  .laudo-rodadas-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
  .laudo-rodadas-kpi, .laudo-rodadas-section { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 14px; box-shadow: 0 8px 22px rgba(15, 23, 42, .05); }
  .laudo-rodadas-kpi strong { display: block; font-size: 22px; margin-top: 4px; color: #111827; }
  .laudo-rodadas-section h2 { margin: 0 0 8px; font-size: 18px; }
  .laudo-rodadas-section p { color: #475569; line-height: 1.55; }
  .laudo-rodadas-table-wrap { overflow-x: auto; margin-top: 12px; }
  .laudo-rodadas-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .laudo-rodadas-table th, .laudo-rodadas-table td { border-bottom: 1px solid #e2e8f0; padding: 9px 8px; text-align: left; vertical-align: top; }
  .laudo-rodadas-table th { background: #f8fafc; color: #475569; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
  .laudo-rodadas-table .right { text-align: right; }
  .laudo-rodadas-recomendacao { background: #f5f3ff; border: 1px solid #ddd6fe; color: #4c1d95; border-radius: 14px; padding: 14px; line-height: 1.55; font-weight: 700; }
  @media print { .laudo-rodadas-actions { display: none !important; } .laudo-export-shell { padding: 0; } .laudo-rodadas-page { box-shadow: none !important; border-radius: 0 !important; max-width: none !important; width: 100% !important; } }
`;

function montarHtmlExportavel(laudoNode, titulo) {
  const clone = laudoNode.cloneNode(true);
  clone.querySelectorAll('.laudo-rodadas-actions').forEach((node) => node.remove());
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(titulo)}</title>
  <style>${CSS_EXPORT}</style>
</head>
<body>
  <main class="laudo-export-shell">${clone.outerHTML}</main>
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
  janela.document.write(html);
  janela.document.close();
  janela.focus();
  setTimeout(() => janela.print(), 500);
}

function normalizarLista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function primeiraLista(...listas) {
  for (const lista of listas) {
    if (Array.isArray(lista) && lista.length) return lista;
  }
  return [];
}

function temDados(linhas) {
  return Array.isArray(linhas) && linhas.length > 0;
}

function prioridadeClasse(valor) {
  const v = String(valor || '').toLowerCase();
  if (v.includes('alta')) return 'alta';
  if (v.includes('média') || v.includes('media')) return 'media';
  return 'baixa';
}

function exportarExcel(laudo = {}, externo = false) {
  const wb = XLSX.utils.book_new();
  const comparativo = laudo.comparativo || {};
  const atual = comparativo.atual || {};
  const inicial = comparativo.inicial || {};

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
    Transportadora: laudo.transportadora || '',
    Canal: laudo.canal || '',
    Origem: laudo.origem || '',
    Periodo: laudo.periodo || '',
    Rodadas: laudo.quantidadeSimulacoes || 0,
    Aderencia_Inicial: inicial.aderencia || 0,
    Aderencia_Atual: atual.aderencia || 0,
    CTEs_Ganhos: atual.ctesGanhos || 0,
    Volumes: atual.volumesGanhos || 0,
    Faturamento_Mes: atual.faturamentoMes || 0,
    Saving_Mes: atual.savingMes || 0,
    Recomendacao: laudo.recomendacao || '',
  }]), 'Resumo');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(normalizarLista(laudo.evolucaoRodadas).map((item) => ({
    Rodada: item.rodada || '',
    Data: dataBR(item.criadoEm),
    CTEs_Ganhos: item.ctesGanhos || 0,
    Volumes: item.volumesGanhos || 0,
    Aderencia: item.aderencia || 0,
    Faturamento_Mes: item.faturamentoMes || 0,
    Saving_Mes: item.savingMes || 0,
  })).concat(normalizarLista(laudo.evolucaoRodadas).length ? [] : [{ Aviso: 'Sem evolução de rodadas.' }])), 'Rodadas');

  const paretoCidades = primeiraLista(laudo.paretoCidades, laudo.paretoCidadesVolume, laudo.cidadesPareto, laudo.cidadesCriticas);
  const ufDestino = primeiraLista(laudo.ufsCriticas, laudo.ufsPrioritarias, laudo.ufDestino, laudo.visaoUfDestino);
  const destinoFaixa = primeiraLista(laudo.destinoFaixa, laudo.destinoFaixaPareto, laudo.paretoDestinoFaixa, laudo.rotasCriticas, laudo.ondeAjustar);
  const mesorregiaoFaixa = primeiraLista(laudo.mesorregiaoFaixa, laudo.mesorregioesFaixa, laudo.mesorregiaoPorFaixa);

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(temDados(paretoCidades) ? paretoCidades : [{ Aviso: 'Sem Pareto de cidades.' }]), 'Pareto cidades');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(temDados(ufDestino) ? ufDestino : [{ Aviso: 'Sem visão por UF destino.' }]), 'UF destino');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(temDados(destinoFaixa) ? destinoFaixa : [{ Aviso: 'Sem Destino x faixa.' }]), 'Destino x faixa');
  if (temDados(mesorregiaoFaixa)) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mesorregiaoFaixa), 'Mesorregiao x faixa');

  const tipo = externo ? 'transportador' : 'diretoria';
  XLSX.writeFile(wb, `laudo-rodadas-${tipo}-${nomeArquivoSeguro(laudo.transportadora)}.xlsx`);
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
          </tr>
        </thead>
        <tbody>
          {normalizarLista(linhas).map((item, idx) => (
            <tr key={item.id || `${item.rodada || idx}-${item.criadoEm || idx}`}>
              <td><strong>{item.rodada || idx + 1}ª</strong></td>
              <td>{dataBR(item.criadoEm)}</td>
              <td className="right">{numero(item.ctesGanhos)}</td>
              <td className="right">{numero(item.volumesGanhos)}</td>
              <td className="right">{percentual(item.aderencia)}</td>
              <td className="right">{dinheiro(item.faturamentoMes)}</td>
              {!externo ? <td className="right">{dinheiro(item.savingMes)}</td> : null}
            </tr>
          ))}
          {!normalizarLista(linhas).length ? <tr><td colSpan={externo ? 6 : 7}>Nenhuma simulação salva para montar evolução.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

function TabelaOportunidades({ linhas = [] }) {
  const lista = normalizarLista(linhas).slice(0, 12);
  return (
    <div className="laudo-rodadas-table-wrap">
      <table className="laudo-rodadas-table">
        <thead>
          <tr>
            <th>Rota/Cidade/UF</th>
            <th>Faixa</th>
            <th className="right">CT-es perdidos</th>
            <th className="right">CT-es ganhos</th>
            <th className="right">Volumes</th>
            <th className="right">Fat. não capturado</th>
            <th>Prioridade</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((item, idx) => (
            <tr key={item.chave || item.rota || item.ufDestino || item.faixa || idx}>
              <td><strong>{item.rota || item.chave || item.cidade || item.destino || item.ufDestino || '-'}</strong></td>
              <td>{item.faixa || item.faixaPeso || '-'}</td>
              <td className="right">{numero(item.ctesPerdidos)}</td>
              <td className="right">{numero(item.ctesGanhos)}</td>
              <td className="right">{numero(item.volumes || item.volume)}</td>
              <td className="right">{dinheiro(item.faturamentoNaoCapturado)}</td>
              <td><span className={`laudo-rodadas-badge ${prioridadeClasse(item.prioridade)}`}>{item.prioridade || 'BAIXA'}</span></td>
            </tr>
          ))}
          {!lista.length ? <tr><td colSpan="7">Sem dados suficientes para este agrupamento.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

function SecaoTabela({ titulo, descricao, linhas }) {
  if (!temDados(linhas)) return null;
  return (
    <section className="laudo-rodadas-section">
      <h2>{titulo}</h2>
      {descricao ? <p>{descricao}</p> : null}
      <TabelaOportunidades linhas={linhas} />
    </section>
  );
}

export function LaudoRodadasNegociacaoTemplate({ tipo = 'executivo', tabela = null, dados = null }) {
  const laudoRef = useRef(null);

  const laudo = useMemo(() => {
    try {
      if (dados) return dados;
      const laudos = montarLaudosRodadasNegociacao(tabela || {}) || {};
      return tipo === 'transportador' ? laudos.transportador : laudos.executivo;
    } catch (error) {
      console.error('Erro ao montar laudo de rodadas:', error);
      return null;
    }
  }, [dados, tabela, tipo]);

  if (!laudo) {
    return (
      <article className="laudo-rodadas-page">
        <header className="laudo-rodadas-header">
          <small>Laudo de rodadas</small>
          <h1>Laudo indisponível</h1>
          <p>Não foi possível montar os dados do laudo desta negociação.</p>
        </header>
        <div className="laudo-rodadas-body">
          <div className="laudo-rodadas-alert warn">Salve uma simulação ou atualize a negociação antes de gerar o laudo.</div>
        </div>
      </article>
    );
  }

  const externo = tipo === 'transportador' || laudo.tipo === 'transportador_rodadas';
  const comparativo = laudo.comparativo || {};
  const inicial = comparativo.inicial || {};
  const atual = comparativo.atual || {};
  const quantidadeRodadas = Number(laudo.quantidadeSimulacoes || normalizarLista(laudo.evolucaoRodadas).length || 0);
  const poucaBase = quantidadeRodadas < 2;
  const tipoArquivo = externo ? 'transportador' : 'diretoria';
  const tituloExport = `${laudo.titulo || 'Laudo de rodadas'} - ${laudo.transportadora || 'Transportadora'}`;

  const paretoCidades = primeiraLista(laudo.paretoCidades, laudo.paretoCidadesVolume, laudo.cidadesPareto, laudo.cidadesCriticas);
  const ufDestino = primeiraLista(laudo.ufsCriticas, laudo.ufsPrioritarias, laudo.ufDestino, laudo.visaoUfDestino);
  const destinoFaixa = primeiraLista(laudo.destinoFaixa, laudo.destinoFaixaPareto, laudo.paretoDestinoFaixa, laudo.rotasCriticas, laudo.ondeAjustar);
  const mesorregiaoFaixa = primeiraLista(laudo.mesorregiaoFaixa, laudo.mesorregioesFaixa, laudo.mesorregiaoPorFaixa);
  const melhorias = primeiraLista(laudo.rotasMelhoraram, laudo.ondeMelhorou);

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
        <h1>{laudo.titulo || 'Laudo de rodadas'}</h1>
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
          <button type="button" className="sim-tab" onClick={handleHtml}>Baixar HTML</button>
          <button type="button" className="sim-tab" onClick={handleExcel}>Baixar Excel</button>
        </div>

        {externo ? (
          <div className="laudo-rodadas-alert">Este relatório mostra oportunidades de ajuste comercial por rota, cotação, UF e faixa de peso. Não expõe referências internas nem concorrentes.</div>
        ) : (
          <div className="laudo-rodadas-alert danger">Uso interno: contém saving, impacto financeiro e recomendação estratégica. Não enviar esta versão ao transportador.</div>
        )}

        {poucaBase ? <div className="laudo-rodadas-alert warn">Diagnóstico inicial: com apenas uma rodada salva, o laudo mostra a fotografia atual. A evolução aparecerá a partir da segunda rodada.</div> : null}

        <section className="laudo-rodadas-kpis">
          <div className="laudo-rodadas-kpi"><span>Aderência atual</span><strong>{percentual(atual.aderencia)}</strong></div>
          <div className="laudo-rodadas-kpi"><span>CT-es competitivos</span><strong>{numero(atual.ctesGanhos)}</strong></div>
          <div className="laudo-rodadas-kpi"><span>Volumes competitivos</span><strong>{numero(atual.volumesGanhos)}</strong></div>
          <div className="laudo-rodadas-kpi"><span>Faturamento capturado/mês</span><strong>{dinheiro(atual.faturamentoMes)}</strong></div>
          {!externo ? <div className="laudo-rodadas-kpi"><span>Saving/mês</span><strong>{dinheiro(atual.savingMes)}</strong></div> : null}
          <div className="laudo-rodadas-kpi"><span>Ajuste médio necessário</span><strong>{percentual(atual.reducaoMedia)}</strong><small>{poucaBase ? 'Sem variação' : `Inicial: ${percentual(inicial.reducaoMedia)}`}</small></div>
        </section>

        {poucaBase ? (
          <section className="laudo-rodadas-section">
            <h2>Diagnóstico inicial</h2>
            <p>
              {externo
                ? `A proposta atual apresenta ${percentual(atual.aderencia)} de aderência, com ${numero(atual.ctesGanhos)} CT-es competitivos.`
                : `A primeira rodada apresenta ${percentual(atual.aderencia)} de aderência, ${numero(atual.ctesGanhos)} CT-es competitivos, faturamento capturado estimado de ${dinheiro(atual.faturamentoMes)} por mês e saving mensal de ${dinheiro(atual.savingMes)}.`}
            </p>
          </section>
        ) : (
          <>
            <section className="laudo-rodadas-section">
              <h2>Resumo da evolução</h2>
              <p>
                {externo
                  ? `A proposta saiu de ${percentual(inicial.aderencia)} para ${percentual(atual.aderencia)} de aderência. Os CT-es competitivos passaram de ${numero(inicial.ctesGanhos)} para ${numero(atual.ctesGanhos)}.`
                  : `A negociação saiu de ${percentual(inicial.aderencia)} para ${percentual(atual.aderencia)} de aderência, com saving mensal de ${dinheiro(inicial.savingMes)} para ${dinheiro(atual.savingMes)}.`}
              </p>
            </section>

            <section className="laudo-rodadas-section">
              <h2>Evolução rodada a rodada</h2>
              <TabelaEvolucao linhas={laudo.evolucaoRodadas || []} externo={externo} />
            </section>

            {temDados(melhorias) ? (
              <section className="laudo-rodadas-section">
                <h2>{externo ? 'Onde a proposta melhorou' : 'Rotas/Cotações que evoluíram'}</h2>
                <TabelaOportunidades linhas={melhorias} />
              </section>
            ) : null}
          </>
        )}

        <SecaoTabela titulo="Mesorregião x Faixa" descricao="Agrupamento exibido somente quando houver dado real de mesorregião." linhas={mesorregiaoFaixa} />
        <SecaoTabela titulo="Pareto 80% das cidades por volume total" descricao="Cidades/destinos que concentram maior volume." linhas={paretoCidades} />
        <SecaoTabela titulo="Visão por Estado/UF" descricao="Estados com maior oportunidade de captura ou ajuste." linhas={ufDestino} />
        <SecaoTabela titulo="Pareto 80% — Destino x Faixa" descricao="Combinação de destino e faixa de peso com maior impacto." linhas={destinoFaixa} />

        <section className="laudo-rodadas-section">
          <h2>Recomendação final</h2>
          <div className="laudo-rodadas-recomendacao">{laudo.recomendacao || 'Revisar os pontos de maior impacto e avançar para a próxima rodada de negociação.'}</div>
        </section>
      </div>
    </article>
  );
}
