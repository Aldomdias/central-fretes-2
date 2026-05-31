import React, { useRef } from 'react';
import * as XLSX from 'xlsx';
import { montarLaudosRodadasNegociacao, formatadoresLaudoRodadas } from '../../utils/laudosRodadasNegociacaoHtml';
import './LaudoRodadasNegociacaoTemplate.css';

const { dinheiro, numero, percentual, dataBR } = formatadoresLaudoRodadas;

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

function percentualPp(valor) {
  const v = Number(valor || 0);
  return (v > 0 ? '+' : '') + v.toFixed(2) + ' p.p.';
}

function mesorregiaoReal(valor) {
  const texto = String(valor || '').trim().toLowerCase();
  return texto && !texto.includes('não identificada') && !texto.includes('nao identificada');
}

function diagnosticoResumoTexto({ externo, poucaBase, atual, inicial }) {
  if (poucaBase) {
    return externo
      ? 'Esta é a primeira rodada salva da análise. A proposta apresenta aderência atual de ' + percentual(atual.aderencia) + ', com ' + numero(atual.ctesGanhos) + ' CT-es competitivos, ' + numero(atual.volumesGanhos) + ' volumes competitivos e faturamento potencial capturado de ' + dinheiro(atual.faturamentoMes) + ' por mês. As próximas seções mostram onde estão os maiores volumes e as oportunidades de ajuste.'
      : 'Esta é a primeira rodada salva da análise. O cenário atual apresenta aderência de ' + percentual(atual.aderencia) + ', saving mensal de ' + dinheiro(atual.savingMes) + ' e faturamento capturado de ' + dinheiro(atual.faturamentoMes) + ' por mês.';
  }
  return externo
    ? 'A proposta saiu de ' + percentual(inicial.aderencia) + ' para ' + percentual(atual.aderencia) + ' de aderência. Os CT-es competitivos passaram de ' + numero(inicial.ctesGanhos) + ' para ' + numero(atual.ctesGanhos) + '. O objetivo da próxima rodada deve ser revisar os pontos de maior impacto listados abaixo.'
    : 'A negociação saiu de ' + percentual(inicial.aderencia) + ' para ' + percentual(atual.aderencia) + ' de aderência, com saving mensal de ' + dinheiro(inicial.savingMes) + ' para ' + dinheiro(atual.savingMes) + ' e faturamento capturado de ' + dinheiro(inicial.faturamentoMes) + ' para ' + dinheiro(atual.faturamentoMes) + ' por mês.';
}

function numeroOperacional(valor, casas = 1) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

function VeiculoOcupacaoIlustracaoLaudo({ ocupacaoPercentual = 0 }) {
  const fill = Math.max(0, Math.min(100, ocupacaoPercentual));
  const fillColor = fill >= 90 ? '#fb923c' : fill >= 70 ? '#34d399' : '#60a5fa';
  return (
    <svg viewBox="0 0 220 88" role="img" aria-label="Ocupação estimada do veículo" style={{ width: '100%', maxWidth: 190 }}>
      <rect x="18" y="28" width="92" height="34" rx="8" fill="#eff6ff" stroke="#bfdbfe" strokeWidth="2" />
      <rect x="20" y="30" width={Math.max(0, 88 * (fill / 100))} height="30" rx="6" fill={fillColor} opacity="0.9" />
      <path d="M110 38h22l18 16v8h-40V38Z" fill="#e0f2fe" stroke="#bfdbfe" strokeWidth="2" />
      <path d="M123 41h8l11 10h-19V41Z" fill="#f8fafc" stroke="#bfdbfe" strokeWidth="1.5" />
      <circle cx="40" cy="68" r="9" fill="#0f172a" />
      <circle cx="40" cy="68" r="4" fill="#f8fafc" />
      <circle cx="116" cy="68" r="9" fill="#0f172a" />
      <circle cx="116" cy="68" r="4" fill="#f8fafc" />
      <line x1="18" y1="66" x2="150" y2="66" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function VeiculoOperacionalLaudoCard({ dados }) {
  if (!dados || dados.semDados) return null;
  const ocupacaoPercentual = Number(dados.ocupacaoOperacional || 0) * 100;
  const badgeBg = dados.ocupacaoOperacional >= 0.9 ? '#fff7ed' : dados.ocupacaoOperacional >= 0.7 ? '#ecfdf5' : '#eff6ff';
  const badgeColor = dados.ocupacaoOperacional >= 0.9 ? '#c2410c' : dados.ocupacaoOperacional >= 0.7 ? '#047857' : '#1d4ed8';
  const faixaCubagem = numeroOperacional(dados.veiculo?.cubagemMin, 0) + ' a ' + numeroOperacional(dados.veiculo?.cubagemRef, 0) + ' m³';
  const faixaPeso = numeroOperacional(dados.veiculo?.pesoMin, 0) + ' a ' + numeroOperacional(dados.veiculo?.pesoRef, 0) + ' kg';
  return (
    <section className="laudo-rodadas-section">
      <h2>Veículo sugerido nas cargas ganhas</h2>
      <div className="laudo-rodadas-kpi" style={{ alignItems: 'stretch', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
          <div>
            <span>Veículo sugerido</span>
            <strong style={{ fontSize: '1rem', lineHeight: 1.15 }}>{dados.veiculo?.tipo}</strong>
          </div>
          <div style={{ padding: '4px 8px', borderRadius: 999, background: badgeBg, color: badgeColor, fontSize: '0.72rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
            {percentual(ocupacaoPercentual)} ocupado
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '170px minmax(0, 1fr)', gap: 12, alignItems: 'center' }}>
          <VeiculoOcupacaoIlustracaoLaudo ocupacaoPercentual={ocupacaoPercentual} />
          <small style={{ display: 'grid', gap: 4 }}>
            <span>Cubagem/dia: <strong>{numeroOperacional(dados.cubagemDia, 2)} m³</strong></span>
            <span>Peso/dia: <strong>{numeroOperacional(dados.pesoDia, 0)} kg</strong></span>
            <span>Referência: <strong>{faixaCubagem} • {faixaPeso}</strong></span>
            {dados.qtdVeiculos > 1 ? <span>Necessidade: <strong>{dados.qtdVeiculos} veículo(s)/dia</strong></span> : null}
            <span>Limitante: <strong>{dados.fatorLimitante === 'peso' ? 'peso' : 'cubagem'}</strong></span>
          </small>
        </div>
        <small style={{ color: badgeColor }}>{dados.alerta}{dados.minimoNoLimite ? ' Menor veículo físico: ' + dados.veiculoMinimo?.tipo + '.' : ''}</small>
        <small>Uso comum: {dados.veiculo?.uso}</small>
      </div>
    </section>
  );
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

function montarHtmlExportavel(laudoNode, titulo) {
  const estilos = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
    .map((node) => node.outerHTML)
    .join('\n');
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${titulo}</title>
  ${estilos}
  <style>
    body { margin: 0; background: #f8fafc; color: #0f172a; font-family: Arial, sans-serif; }
    .laudo-export-shell { padding: 24px; }
    .laudo-rodadas-page { max-width: 1200px; margin: 0 auto; }
    .laudo-rodadas-actions { display: none !important; }
    @media print {
      body { background: #fff; }
      .laudo-export-shell { padding: 0; }
      .laudo-rodadas-page { box-shadow: none !important; border-radius: 0 !important; max-width: none !important; width: 100% !important; }
    }
  </style>
</head>
<body>
  <main class="laudo-export-shell">
    ${laudoNode.outerHTML}
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
  janela.document.write(html);
  janela.document.close();
  janela.focus();
  setTimeout(() => {
    janela.print();
  }, 350);
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
    Rodada: item.rodada,
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
    Rota_Cotacao: item.rota || item.chave || '',
    Origem: item.origem || '',
    Destino: item.destino || '',
    UF_Destino: item.ufDestino || '',
    Faixa: item.faixa || '',
    CTEs_Analisados: item.ctesAnalisados || 0,
    CTEs_Ganhos: item.ctesGanhos || 0,
    CTEs_Perdidos: item.ctesPerdidos || 0,
    Volumes: item.volumes || 0,
    Faturamento_Potencial: item.faturamentoPotencial || 0,
    Faturamento_Capturado: item.faturamentoCapturado || 0,
    Faturamento_Nao_Capturado: item.faturamentoNaoCapturado || 0,
    Aderencia: item.aderencia || item.aderenciaAtual || 0,
    Ajuste_Medio: item.ajusteMedio || 0,
    Prioridade: item.prioridade || '',
    Status: item.status || '',
    Ganhos_Inicial: item.ctesGanhosInicial || 0,
    Ganhos_Final: item.ctesGanhosFinal || 0,
    Evolucao_CTEs: item.evolucaoCtes || 0,
  }));
}

function paretoCidadesExcel(linhas = []) {
  return linhas.map((item, idx) => ({
    Posicao: idx + 1,
    Cidade: item.cidade || '',
    UF_Destino: item.ufDestino || '',
    CTEs: item.ctes || 0,
    Volumes: item.volumes || 0,
    Percentual_Volume: item.pctVolume || 0,
    Percentual_Acumulado: item.pctAcumulado || 0,
    Frete_Realizado: item.freteRealizado || 0,
    Valor_NF: item.valorNF || 0,
  }));
}


function exportarExcel(laudo = {}, externo) {
  const poucaBase = Number(laudo.quantidadeSimulacoes || 0) < 2;
  const mesorregioesReais = (laudo.mesorregiaoFaixas || []).filter((item) => mesorregiaoReal(item.mesorregiao || item.rota));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhaResumoExcel(laudo)), 'Resumo');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(evolucaoExcel(laudo.evolucaoRodadas || [])), 'Evolucao Rodadas');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(oportunidadesExcel(laudo.rotasCriticas || laudo.ondeAjustar || [])), 'Rotas Criticas');
  if (!poucaBase) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(oportunidadesExcel(laudo.rotasMelhoraram || laudo.ondeMelhorou || [])), 'Rotas Melhoraram');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(oportunidadesExcel(laudo.ufsCriticas || laudo.ufsPrioritarias || [])), 'UFs Prioritarias');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(paretoCidadesExcel(laudo.cidadesParetoVolume || [])), 'Pareto Cidades');
  if (mesorregioesReais.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(oportunidadesExcel(mesorregioesReais)), 'Mesorregiao Faixa');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(oportunidadesExcel(laudo.destinoFaixaPareto || [])), 'Pareto Destino Faixa');

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

function TabelaRotas({ linhas = [] }) {
  return (
    <div className="laudo-rodadas-table-wrap">
      <table className="laudo-rodadas-table">
        <thead>
          <tr>
            <th>Rota/Cotação</th>
            <th>UF</th>
            <th>Faixa</th>
            <th className="right">CT-es perdidos</th>
            <th className="right">CT-es ganhos</th>
            <th className="right">Fat. não capturado</th>
            <th className="right">Ajuste médio</th>
            <th>Prioridade</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((item) => (
            <tr key={item.chave || item.rota}>
              <td>
                <strong>{item.rota || item.chave || '-'}</strong>
                {item.origem || item.destino ? <div style={{ color: '#64748b', fontSize: 11 }}>{[item.origem, item.destino].filter(Boolean).join(' > ')}</div> : null}
              </td>
              <td>{item.ufDestino || '-'}</td>
              <td>{item.faixa || '-'}</td>
              <td className="right">{numero(item.ctesPerdidos)}</td>
              <td className="right">{numero(item.ctesGanhos)}</td>
              <td className="right">{dinheiro(item.faturamentoNaoCapturado)}</td>
              <td className="right">{percentual(item.ajusteMedio)}</td>
              <td><span className={`laudo-rodadas-badge ${prioridadeClasse(item.prioridade)}`}>{item.prioridade || 'BAIXA'}</span></td>
            </tr>
          ))}
          {!linhas.length ? <tr><td colSpan="8">Não há rotas críticas suficientes para este recorte.</td></tr> : null}
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
          {linhas.map((item) => (
            <tr key={item.chave || item.rota}>
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

function TabelaDestinoFaixaPareto({ linhas = [] }) {
  return (
    <section className="laudo-rodadas-section">
      <h2>Pareto 80% — Destino x Faixa</h2>
      <p>Mostra onde o volume está concentrado por origem, destino e faixa de peso.</p>
      <div className="laudo-rodadas-table-wrap">
        <table className="laudo-rodadas-table">
          <thead><tr><th>Origem → Destino/UF</th><th>Faixa</th><th className="right">CT-es</th><th className="right">Volumes</th><th className="right">% volume</th><th className="right">% acumulado</th><th className="right">CT-es ganhos</th><th className="right">CT-es perdidos</th><th className="right">Aderência</th><th className="right">Fat. não capturado</th><th className="right">Ajuste médio</th></tr></thead>
          <tbody>
            {linhas.map((item, idx) => (
              <tr key={item.chave || idx}>
                <td><strong>{item.rotaDestino || [item.origem, item.destino ? item.destino + (item.ufDestino ? '/' + item.ufDestino : '') : item.ufDestino].filter(Boolean).join(' → ') || '-'}</strong></td>
                <td>{item.faixa || '-'}</td>
                <td className="right">{numero(item.ctes)}</td>
                <td className="right">{numero(item.volumes)}</td>
                <td className="right">{percentual(item.pctVolume)}</td>
                <td className="right">{percentual(item.pctAcumulado)}</td>
                <td className="right">{numero(item.ctesGanhos)}</td>
                <td className="right">{numero(item.ctesPerdidos)}</td>
                <td className="right">{percentual(item.aderencia)}</td>
                <td className="right">{dinheiro(item.faturamentoNaoCapturado)}</td>
                <td className="right">{percentual(item.ajusteMedio)}</td>
              </tr>
            ))}
            {!linhas.length ? <tr><td colSpan="11">Sem leitura suficiente por destino e faixa.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}


function TabelaFaixas({ titulo, linhas = [] }) {
  return (
    <section className="laudo-rodadas-section">
      <h2>{titulo}</h2>
      <div className="laudo-rodadas-table-wrap">
        <table className="laudo-rodadas-table">
          <thead><tr><th>Origem</th><th>UF destino</th><th>Destino</th><th>Faixa</th><th className="right">CT-es perdidos</th><th className="right">CT-es ganhos</th><th className="right">Aderência</th><th className="right">Fat. não capturado</th><th className="right">Ajuste médio</th><th>Prioridade</th></tr></thead>
          <tbody>{linhas.map((item) => (<tr key={item.chave || [item.origem, item.ufDestino, item.rota, item.faixa].filter(Boolean).join('-')}><td>{item.origem || '-'}</td><td>{item.ufDestino || '-'}</td><td><strong>{item.rota || item.cotacao || '-'}</strong></td><td><strong>{item.faixa || '-'}</strong></td><td className="right">{numero(item.ctesPerdidos)}</td><td className="right">{numero(item.ctesGanhos)}</td><td className="right">{percentual(item.aderencia)}</td><td className="right">{dinheiro(item.faturamentoNaoCapturado)}</td><td className="right">{percentual(item.ajusteMedio)}</td><td><span className={'laudo-rodadas-badge ' + prioridadeClasse(item.prioridade)}>{item.prioridade || 'BAIXA'}</span></td></tr>))}{!linhas.length ? <tr><td colSpan="10">Sem leitura suficiente por faixa neste recorte.</td></tr> : null}</tbody>
        </table>
      </div>
    </section>
  );
}


function TabelaParetoCidades({ linhas = [] }) {
  return (
    <section className="laudo-rodadas-section">
      <h2>Pareto 80% das cidades por volume total</h2>
      <p>Cidades que concentram aproximadamente 80% do volume total da última rodada analisada, independentemente de ganho ou perda.</p>
      <div className="laudo-rodadas-table-wrap">
        <table className="laudo-rodadas-table">
          <thead><tr><th>Origem → Destino/UF</th><th className="right">CT-es</th><th className="right">Volumes</th><th className="right">% volume</th><th className="right">% acumulado</th><th className="right">CT-es ganhos</th><th className="right">CT-es perdidos</th><th className="right">Fat. capturado</th><th className="right">Fat. não capturado</th><th className="right">Redução média</th></tr></thead>
          <tbody>{linhas.map((item) => (<tr key={item.chave || item.rotaDestino || item.cidade}><td><strong>{item.rotaDestino || [item.origem, item.cidade ? item.cidade + (item.ufDestino ? '/' + item.ufDestino : '') : item.ufDestino].filter(Boolean).join(' → ') || '-'}</strong></td><td className="right">{numero(item.ctes)}</td><td className="right">{numero(item.volumes)}</td><td className="right">{percentual(item.pctVolume)}</td><td className="right">{percentual(item.pctAcumulado)}</td><td className="right">{numero(item.ctesGanhos)}</td><td className="right">{numero(item.ctesPerdidos)}</td><td className="right">{dinheiro(item.faturamentoCapturado)}</td><td className="right">{dinheiro(item.faturamentoNaoCapturado)}</td><td className="right">{percentual(item.ajusteMedio)}</td></tr>))}{!linhas.length ? <tr><td colSpan="10">Execute uma nova simulação para gerar o Pareto de cidades.</td></tr> : null}</tbody>
        </table>
      </div>
    </section>
  );
}


function TabelaSimples({ titulo, linhas = [], tipo = 'uf' }) {
  return (
    <section className="laudo-rodadas-section">
      <h2>{titulo}</h2>
      <div className="laudo-rodadas-table-wrap">
        <table className="laudo-rodadas-table">
          <thead>
            <tr>
              <th>{tipo === 'faixa' ? 'Faixa de peso' : 'UF destino'}</th>
              <th className="right">CT-es perdidos</th>
              <th className="right">CT-es ganhos</th>
              <th className="right">Aderência</th>
              <th className="right">Fat. não capturado</th>
              <th className="right">Ajuste médio</th>
              <th>Prioridade</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((item) => (
              <tr key={item.chave || item.rota || item.faixa}>
                <td><strong>{tipo === 'faixa' ? (item.faixa || item.rota || item.chave) : (item.ufDestino || item.rota || item.chave)}</strong></td>
                <td className="right">{numero(item.ctesPerdidos)}</td>
                <td className="right">{numero(item.ctesGanhos)}</td>
                <td className="right">{percentual(item.aderencia)}</td>
                <td className="right">{dinheiro(item.faturamentoNaoCapturado)}</td>
                <td className="right">{percentual(item.ajusteMedio)}</td>
                <td><span className={`laudo-rodadas-badge ${prioridadeClasse(item.prioridade)}`}>{item.prioridade || 'BAIXA'}</span></td>
              </tr>
            ))}
            {!linhas.length ? <tr><td colSpan="7">Sem leitura suficiente para este agrupamento.</td></tr> : null}
          </tbody>
        </table>
      </div>
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
  const poucaBase = Number(laudo.quantidadeSimulacoes || 0) < 2;
  const mesorregioesReais = (laudo.mesorregiaoFaixas || []).filter((item) => mesorregiaoReal(item.mesorregiao || item.rota));
  const tipoArquivo = externo ? 'transportador' : 'diretoria';
  const tituloExport = `${laudo.titulo || 'Laudo de rodadas'} - ${laudo.transportadora || 'Transportadora'}`;

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
          <div><span>Rodadas</span><strong>{numero(laudo.quantidadeSimulacoes || 0)}</strong></div>
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

        {poucaBase ? (
          <div className="laudo-rodadas-alert warn">Para análise completa de evolução, o ideal é ter pelo menos duas simulações salvas. Com uma única rodada, o laudo mostra apenas o diagnóstico atual.</div>
        ) : null}
        <section className="laudo-rodadas-kpis">
          <div className="laudo-rodadas-kpi"><span>Aderência da proposta</span><strong>{percentual(atual.aderencia)}</strong>{!poucaBase ? <Variacao valor={comparativo.evolucaoAderencia} tipo="percentual" sufixo=" p.p." /> : <small>Diagnóstico atual</small>}</div>
          <div className="laudo-rodadas-kpi"><span>CT-es que a proposta captura</span><strong>{numero(atual.ctesGanhos)}</strong>{!poucaBase ? <Variacao valor={comparativo.evolucaoCtesGanhos} /> : <small>Base competitiva</small>}</div>
          <div className="laudo-rodadas-kpi"><span>Volumes que a proposta captura</span><strong>{numero(atual.volumesGanhos)}</strong>{!poucaBase ? <Variacao valor={comparativo.evolucaoVolumes} /> : <small>Volume competitivo</small>}</div>
          <div className="laudo-rodadas-kpi"><span>Faturamento potencial capturado/mês</span><strong>{dinheiro(atual.faturamentoMes)}</strong>{!poucaBase ? <Variacao valor={comparativo.evolucaoFaturamentoMes} tipo="dinheiro" /> : <small>Estimativa mensal</small>}</div>
          {!externo ? <div className="laudo-rodadas-kpi"><span>Saving/mês</span><strong>{dinheiro(atual.savingMes)}</strong><Variacao valor={comparativo.evolucaoSavingMes} tipo="dinheiro" /></div> : null}
          <div className="laudo-rodadas-kpi"><span>Frete atual sobre NF</span><strong>{percentual(atual.percentualFreteReal)}</strong><small>Base realizada</small></div>
          <div className="laudo-rodadas-kpi"><span>Frete da proposta sobre NF</span><strong>{percentual(atual.percentualFreteTabela)}</strong><small>Tabela simulada</small></div>
          <div className="laudo-rodadas-kpi"><span>Redução sobre NF</span><strong>{percentualPp((atual.percentualFreteTabela || 0) - (atual.percentualFreteReal || 0))}</strong><small>Meta frete/NF</small></div>
          <div className="laudo-rodadas-kpi"><span>Redução média para capturar volume perdido</span><strong>{percentual(atual.reducaoMedia)}</strong><small>Cargas ainda não competitivas</small></div>
        </section>
        <VeiculoOperacionalLaudoCard dados={laudo.veiculoOperacional || atual.veiculoOperacional} />

        <section className="laudo-rodadas-section">
          <h2>{poucaBase ? 'Diagnóstico inicial' : 'Resumo da evolução'}</h2>
          <p>{diagnosticoResumoTexto({ externo, poucaBase, atual, inicial })}</p>
        </section>

        <section className="laudo-rodadas-section">
          <h2>Evolução rodada a rodada</h2>
          <TabelaEvolucao linhas={laudo.evolucaoRodadas || []} externo={externo} />
        </section>

        {!poucaBase ? (
          <section className="laudo-rodadas-section">
            <h2>{externo ? 'Onde a proposta melhorou' : 'Rotas/Cotações que evoluíram'}</h2>
            <TabelaMelhorias linhas={(laudo.rotasMelhoraram || laudo.ondeMelhorou || []).slice(0, 10)} />
          </section>
        ) : null}

        <TabelaParetoCidades linhas={(laudo.cidadesParetoVolume || []).slice(0, 20)} />
        <TabelaSimples titulo="Visão por Estado/UF" linhas={(laudo.ufsCriticas || laudo.ufsPrioritarias || []).slice(0, 8)} tipo="uf" />
        {mesorregioesReais.length ? (
        <section className="laudo-rodadas-section">
          <h2>Mesorregião x Faixa</h2>
          <p>Agrupamento regional por mesorregião do IBGE e faixa de peso, para direcionar ajustes sem depender do nome comercial da cotação.</p>
          <div className="laudo-rodadas-table-wrap">
            <table className="laudo-rodadas-table">
              <thead><tr><th>Origem</th><th>UF destino</th><th>Mesorregião</th><th>Faixa</th><th className="right">CT-es perdidos</th><th className="right">CT-es ganhos</th><th className="right">Aderência</th><th className="right">Fat. não capturado</th><th className="right">Ajuste médio</th><th>Prioridade</th></tr></thead>
              <tbody>
                {mesorregioesReais.slice(0, 25).map((item, idx) => (
                  <tr key={idx}>
                    <td>{item.origem || '-'}</td>
                    <td>{item.ufDestino || '-'}</td>
                    <td><strong>{item.mesorregiao || item.rota || '-'}</strong></td>
                    <td>{item.faixa || '-'}</td>
                    <td className="right">{numero(item.ctesPerdidos)}</td>
                    <td className="right">{numero(item.ctesGanhos)}</td>
                    <td className="right">{percentual(item.aderencia)}</td>
                    <td className="right">{dinheiro(item.faturamentoNaoCapturado)}</td>
                    <td className="right">{percentual(item.ajusteMedio)}</td>
                    <td><span className={`laudo-rodadas-badge ${prioridadeClasse(item.prioridade)}`}>{item.prioridade || 'BAIXA'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        ) : null}

        <section className="laudo-rodadas-section">
          <h2>Pareto 80% das cidades por volume total</h2>
          <p>Cidades que concentram 80% do volume total da última rodada, independentemente de ganho ou perda.</p>
          <div className="laudo-rodadas-table-wrap">
            <table className="laudo-rodadas-table">
              <thead><tr><th>Cidade destino</th><th>UF</th><th className="right">CT-es</th><th className="right">Volumes</th><th className="right">% volume</th><th className="right">% acumulado</th><th className="right">CT-es ganhos</th><th className="right">CT-es perdidos</th><th className="right">Aderência</th><th className="right">Fat. não capturado</th></tr></thead>
              <tbody>
                {(laudo.paretoCidades || []).length > 0
                  ? (laudo.paretoCidades || []).map((item, idx) => (
                    <tr key={idx}>
                      <td><strong>{item.cidade || '-'}</strong></td>
                      <td>{item.ufDestino || '-'}</td>
                      <td className="right">{numero(item.ctes)}</td>
                      <td className="right">{numero(item.volumes)}</td>
                      <td className="right">{percentual(item.pctVolume)}</td>
                      <td className="right">{percentual(item.pctAcumulado)}</td>
                      <td className="right">{numero(item.ctesGanhos)}</td>
                      <td className="right">{numero(item.ctesPerdidos)}</td>
                      <td className="right">{percentual(item.aderencia)}</td>
                      <td className="right">{dinheiro(item.faturamentoNaoCapturado)}</td>
                    </tr>
                  ))
                  : <tr><td colSpan={10}>Execute uma nova simulação para gerar o Pareto de cidades.</td></tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <TabelaDestinoFaixaPareto linhas={(laudo.destinoFaixaPareto || []).slice(0, 30)} />

        <section className="laudo-rodadas-section">
          <h2>Recomendação final</h2>
          <div className="laudo-rodadas-recomendacao">{laudo.recomendacao}</div>
        </section>
      </div>
    </article>
  );
}
