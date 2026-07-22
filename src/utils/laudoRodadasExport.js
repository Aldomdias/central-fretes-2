import * as XLSX from 'xlsx';
import { formatadoresLaudoRodadas } from './laudosRodadasNegociacaoHtml.js';
import { laudoConsolidadoPorAudience, montarExcelAjusteRotaFaixaConsolidado, montarHtmlEmailSeguroLaudoConsolidado, origemLabelTabela } from './laudoTransportadoraConsolidado.js';

const { dataBR } = formatadoresLaudoRodadas;

export function nomeArquivoSeguroLaudo(v, fallback = 'laudo-rodadas') {
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

function listaLaudoSegura() {
  for (let i = 0; i < arguments.length; i += 1) {
    if (Array.isArray(arguments[i])) return arguments[i];
  }
  return [];
}

function mesorregiaoReal(valor) {
  const texto = String(valor || '').trim().toLowerCase();
  return texto && !texto.includes('não identificada') && !texto.includes('nao identificada');
}

export function laudoRodadasExterno(laudo = {}, tipo = '') {
  return tipo === 'transportador' || laudo.tipo === 'transportador_rodadas';
}

export function tituloExportLaudoRodadas(laudo = {}) {
  return `${laudo.titulo || 'Laudo de rodadas'} - ${laudo.transportadora || 'Transportadora'}`;
}

function montarHtmlExportavel(laudoNode, titulo, selectorOcultar = '.laudo-rodadas-actions, .laudo-email-acoes, .laudo-consolidado-toolbar') {
  const estilos = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
    .map((node) => node.outerHTML)
    .join('\n');
  const ocultar = selectorOcultar ? `${selectorOcultar} { display: none !important; }` : '';
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${titulo}</title>
  ${estilos}
  <style>
    body { margin: 0; background: #f8fafc; color: #0f172a; font-family: Arial, Sans-serif; }
    .laudo-export-shell { padding: 24px; }
    .laudo-rodadas-page, .laudo-page { max-width: 1200px; margin: 0 auto; }
    ${ocultar}
    @media print {
      body { background: #fff; }
      .laudo-export-shell { padding: 0; }
      .laudo-rodadas-page, .laudo-page { box-shadow: none !important; border-radius: 0 !important; max-width: none !important; width: 100% !important; }
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

export function baixarLaudoRodadasHtml(laudoNode, laudo = {}, tipo = '') {
  if (!laudoNode) return false;
  const externo = laudoRodadasExterno(laudo, tipo);
  const tipoArquivo = externo ? 'transportador' : 'diretoria';
  const titulo = tituloExportLaudoRodadas(laudo);
  const html = montarHtmlExportavel(laudoNode, titulo);
  baixarArquivo(html, `laudo-rodadas-${tipoArquivo}-${nomeArquivoSeguroLaudo(laudo.transportadora)}.html`, 'text/html;charset=utf-8');
  return true;
}

export function gerarLaudoRodadasPdf(laudoNode, laudo = {}) {
  if (!laudoNode) return false;
  const titulo = tituloExportLaudoRodadas(laudo);
  const html = montarHtmlExportavel(laudoNode, titulo);
  const janela = window.open('', '_blank', 'width=1200,height=900');
  if (!janela) {
    window.print();
    return false;
  }
  janela.document.write(html);
  janela.document.close();
  janela.focus();
  setTimeout(() => {
    janela.print();
  }, 350);
  return true;
}

function linhaResumoExcel(laudo = {}, externo = false) {
  const comparativo = laudo.comparativo || {};
  const inicial = comparativo.inicial || {};
  const atual = comparativo.atual || {};
  const row = {
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
    Ajuste_Medio_Atual: atual.reducaoMedia || 0,
    Recomendacao: laudo.recomendacao || '',
  };
  if (!externo) {
    row.Saving_Mes = atual.savingMes || 0;
  }
  return [row];
}

function evolucaoExcel(linhas = [], externo = false) {
  return linhas.map((item) => {
    const row = {
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
      Percentual_Frete_Real: item.percentualFreteReal || 0,
      Percentual_Frete_Tabela: item.percentualFreteTabela || 0,
      Ajuste_Medio: item.reducaoMedia || 0,
    };
    if (!externo) {
      row.Saving_Mes = item.savingMes || 0;
      row.Saving_Ano = item.savingAno || 0;
    }
    return row;
  });
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

export function baixarLaudoRodadasExcel(laudo = {}, tipo = '') {
  const externo = laudoRodadasExterno(laudo, tipo);
  const poucaBase = Number(laudo.quantidadeSimulacoes || 0) < 2;
  const mesorregioesReais = (laudo.mesorregiaoFaixas || []).filter((item) => mesorregiaoReal(item.mesorregiao || item.rota));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhaResumoExcel(laudo, externo)), 'Resumo');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(evolucaoExcel(laudo.evolucaoRodadas || [], externo)), 'Evolucao Rodadas');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(oportunidadesExcel(laudo.rotasCriticas || laudo.ondeAjustar || [])), 'Rotas Criticas');
  if (!poucaBase) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(oportunidadesExcel(laudo.rotasMelhoraram || laudo.ondeMelhorou || [])), 'Rotas Melhoraram');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(oportunidadesExcel(listaLaudoSegura(laudo?.ufsCriticas, laudo?.ufsPrioritarias))), 'UFs Prioritarias');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(paretoCidadesExcel(laudo.paretoCidades || laudo.cidadesParetoVolume || [])), 'Pareto Cidades');
  if (mesorregioesReais.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(oportunidadesExcel(mesorregioesReais)), 'Mesorregiao Faixa');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(oportunidadesExcel(laudo.destinoFaixaPareto || [])), 'Pareto Destino Faixa');

  const tipoArquivo = externo ? 'transportador' : 'diretoria';
  const nome = `laudo-rodadas-${tipoArquivo}-${nomeArquivoSeguroLaudo(laudo.transportadora)}.xlsx`;
  XLSX.writeFile(wb, nome);
  return true;
}

export function textoLaudoRodadas(laudo = {}) {
  return String(laudo.relatorioTexto || laudo.relatorio || laudo.corpoEmail || '').trim();
}

export function textoEmailLaudoRodadas(laudo = {}) {
  if (laudo.laudoCompleto) return String(laudo.laudoCompleto).trim();
  const assunto = String(laudo.assunto || '').trim();
  const corpo = String(laudo.corpoEmail || laudo.relatorioTexto || laudo.relatorio || '').trim();
  if (!assunto && !corpo) return '';
  return assunto ? `Assunto: ${assunto}\n\n${corpo}` : corpo;
}

export function baixarLaudoRodadasTexto(laudo = {}, tipo = '') {
  const conteudo = textoLaudoRodadas(laudo);
  if (!conteudo) return false;
  const externo = laudoRodadasExterno(laudo, tipo);
  const tipoArquivo = externo ? 'transportador' : 'diretoria';
  baixarArquivo(conteudo, `laudo-rodadas-${tipoArquivo}-${nomeArquivoSeguroLaudo(laudo.transportadora)}.txt`, 'text/plain;charset=utf-8');
  return true;
}

export function baixarLaudoRodadasEmail(laudo = {}, tipo = '') {
  const conteudo = textoEmailLaudoRodadas(laudo);
  if (!conteudo) return false;
  const externo = laudoRodadasExterno(laudo, tipo);
  const tipoArquivo = externo ? 'transportador' : 'diretoria';
  baixarArquivo(conteudo, `email-laudo-rodadas-${tipoArquivo}-${nomeArquivoSeguroLaudo(laudo.transportadora)}.txt`, 'text/plain;charset=utf-8');
  return true;
}

export function baixarLaudoTransportadoraConsolidadoHtml(laudoNode, laudo = {}, audience = 'transportadora') {
  if (!laudoNode) return false;
  const titulo = laudo.titulo || `Devolutiva consolidada — ${laudo.transportadora || 'Transportadora'}`;
  const html = montarHtmlExportavel(laudoNode, titulo, '.laudo-consolidado-toolbar, .laudo-email-acoes');
  const tipoArquivo = audience === 'diretoria' ? 'diretoria' : 'transportadora';
  baixarArquivo(html, `laudo-consolidado-${tipoArquivo}-${nomeArquivoSeguroLaudo(laudo.transportadora, 'transportadora')}.html`, 'text/html;charset=utf-8');
  return true;
}

function prepararLaudoConsolidadoExport(laudo = {}, opcoes = {}) {
  if (opcoes.exibirFaturamentoGanho === false) {
    const audience = laudo.audience === 'diretoria' ? 'diretoria' : 'transportadora';
    return laudoConsolidadoPorAudience(laudo, audience, { exibirFaturamentoGanho: false });
  }
  if (laudo.exibirFaturamentoGanho === false) return laudo;
  return laudo;
}

export function baixarLaudoTransportadoraConsolidadoTexto(laudo = {}, opcoes = {}) {
  const laudoExport = prepararLaudoConsolidadoExport(laudo, opcoes);
  const conteudo = textoLaudoRodadas(laudoExport);
  if (!conteudo) return false;
  const audience = laudoExport.audience === 'diretoria' ? 'diretoria' : 'transportadora';
  baixarArquivo(conteudo, `laudo-consolidado-${audience}-${nomeArquivoSeguroLaudo(laudoExport.transportadora, 'transportadora')}.txt`, 'text/plain;charset=utf-8');
  return true;
}

export function baixarLaudoTransportadoraConsolidadoEmail(laudo = {}, opcoes = {}) {
  const laudoExport = prepararLaudoConsolidadoExport(laudo, opcoes);
  const conteudo = textoEmailLaudoRodadas(laudoExport);
  if (!conteudo) return false;
  const audience = laudoExport.audience === 'diretoria' ? 'diretoria' : 'transportadora';
  baixarArquivo(conteudo, `email-laudo-consolidado-${audience}-${nomeArquivoSeguroLaudo(laudoExport.transportadora, 'transportadora')}.txt`, 'text/plain;charset=utf-8');
  return true;
}

export function gerarLaudoTransportadoraConsolidadoPdf(laudoNode, laudo = {}) {
  if (!laudoNode) return false;
  const titulo = laudo.titulo || `Devolutiva consolidada — ${laudo.transportadora || 'Transportadora'}`;
  const html = montarHtmlExportavel(laudoNode, titulo, '.laudo-consolidado-toolbar, .laudo-email-acoes');
  const janela = window.open('', '_blank', 'width=1200,height=900');
  if (!janela) {
    window.print();
    return false;
  }
  janela.document.write(html);
  janela.document.close();
  janela.focus();
  setTimeout(() => {
    janela.print();
  }, 350);
  return true;
}

function base64Utf8(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function quebrarLinhasBase64(base64) {
  return base64.replace(/(.{76})/g, '$1\r\n');
}

function parteMimeTexto(contentType, conteudo) {
  return `Content-Type: ${contentType}\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${conteudo}`;
}

function parteMimeAnexo(contentType, nomeArquivo, base64) {
  return `Content-Type: ${contentType}; name="${nomeArquivo}"\r\nContent-Disposition: attachment; filename="${nomeArquivo}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${quebrarLinhasBase64(base64)}`;
}

/**
 * Monta um .eml (RFC 822/MIME) com o laudo devolutiva consolidado como corpo
 * HTML (preserva o layout ao abrir como rascunho no Outlook/cliente de
 * e-mail) e, em anexo: um HTML "ajuste por rota" por origem (mesmo padrao ja
 * usado no Simulador) + o Excel consolidado de todas as origens. Os HTMLs
 * por origem vem de `resumo_simulacao.laudos.analise_rota_faixa.laudoHtml`,
 * persistido ao salvar a negociacao — origens sem esse snapshot nao entram
 * como anexo (mesma regra da aba "Origens sem detalhe" do Excel).
 */
export function baixarLaudoTransportadoraConsolidadoEml(laudo = {}, tabelasOrigens = []) {
  if (!laudo) return false;

  const transportadora = laudo.transportadora || 'Transportadora';
  const titulo = laudo.titulo || `Devolutiva consolidada — ${transportadora}`;
  const assunto = laudo.assunto || titulo;
  const corpoHtml = montarHtmlEmailSeguroLaudoConsolidado(laudo);

  const origensComHtml = (tabelasOrigens || [])
    .filter((t) => String(t.transportadora || '').toUpperCase() === String(transportadora).toUpperCase())
    .map((t) => ({ tabela: t, laudoHtml: t.resumo_simulacao?.laudos?.analise_rota_faixa?.laudoHtml }))
    .filter((item) => item.laudoHtml);

  const boundary = `----laudo-devolutiva-${Date.now()}`;
  const partes = [parteMimeTexto('text/html; charset="utf-8"', corpoHtml)];

  origensComHtml.forEach(({ tabela, laudoHtml }) => {
    const nomeArquivo = `ajuste-rota-${nomeArquivoSeguroLaudo(origemLabelTabela(tabela))}.html`;
    partes.push(parteMimeAnexo('text/html', nomeArquivo, base64Utf8(laudoHtml)));
  });

  if (tabelasOrigens?.length) {
    const wb = montarExcelAjusteRotaFaixaConsolidado(tabelasOrigens, transportadora);
    const base64Xlsx = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    const nomeXlsx = `laudo-devolutiva-ajuste-rota-${nomeArquivoSeguroLaudo(transportadora)}.xlsx`;
    partes.push(parteMimeAnexo('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', nomeXlsx, base64Xlsx));
  }

  const eml = [
    'MIME-Version: 1.0',
    `Subject: ${assunto}`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    ...partes.flatMap((parte) => [`--${boundary}`, parte, '']),
    `--${boundary}--`,
    '',
  ].join('\r\n');

  baixarArquivo(eml, `email-laudo-devolutiva-${nomeArquivoSeguroLaudo(transportadora)}.eml`, 'message/rfc822');
  return true;
}
