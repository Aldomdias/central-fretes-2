// Laudo e relatorio de excedentes da Auditoria Lotacao — valores pagos acima
// do acertado/tabela, seguindo o mesmo padrao dos laudos de negociacao.
import * as XLSX from 'xlsx';

function dinheiro(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dataBR(valor) {
  if (!valor) return '-';
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? '-' : data.toLocaleDateString('pt-BR');
}

function valorExcedenteItem(item = {}) {
  return Number(item.valorAdicional || item.excedente || item.audit_exceeded_amount || 0);
}

function distDoItem(item = {}) {
  return item.dist || item.distKey || item.dist_key || '-';
}

function motivoDoItem(item = {}) {
  return item.observacao || item.descricaoProblema || item.descricao_problema || item.motivoQuestionamento || item.motivo_questionamento || '-';
}

function quemAprovouItem(item = {}) {
  return item.respondidoPorNome || item.respondido_por_nome || item.abertoPorNome || item.aberto_por_nome || '-';
}

export function montarLinhasExcedentes(itens = []) {
  return (itens || []).map((item) => ({
    data: item.dataBase || item.criadoEm || item.created_at || '',
    transportadora: item.transportadora || '-',
    cte: item.cte || item.numeroInformado || item.numero_informado || '-',
    fatura: item.fatura || '-',
    dist: distDoItem(item),
    valorLancado: Number(item.valorLancado || 0),
    valorExcedente: valorExcedenteItem(item),
    status: item.status || '-',
    motivo: motivoDoItem(item),
    aprovadoPor: quemAprovouItem(item),
  }));
}

export function montarResumoPorTransportadora(linhas = []) {
  const mapa = new Map();
  linhas.forEach((linha) => {
    const chave = linha.transportadora || '-';
    if (!mapa.has(chave)) mapa.set(chave, { transportadora: chave, qtd: 0, totalExcedente: 0, totalLancado: 0 });
    const acc = mapa.get(chave);
    acc.qtd += 1;
    acc.totalExcedente += linha.valorExcedente;
    acc.totalLancado += linha.valorLancado;
  });
  return Array.from(mapa.values()).sort((a, b) => b.totalExcedente - a.totalExcedente);
}

export function montarLaudoExcedentes(itens = [], contexto = {}) {
  const linhas = montarLinhasExcedentes(itens);
  const porTransportadora = montarResumoPorTransportadora(linhas);
  const totalExcedente = linhas.reduce((acc, l) => acc + l.valorExcedente, 0);
  const totalLancado = linhas.reduce((acc, l) => acc + l.valorLancado, 0);
  const geradoEm = new Date().toISOString();
  const periodo = contexto.periodo || 'periodo selecionado';

  const assunto = `Laudo de excedentes - Lotacao (${dataBR(geradoEm)})`;

  const linhasTexto = porTransportadora.map((t) => (
    `- ${t.transportadora}: ${t.qtd} item(ns), excedente total ${dinheiro(t.totalExcedente)}`
  ));

  const corpoEmail = [
    `Laudo de excedentes da Auditoria Lotacao - ${periodo}`,
    '',
    `Total de itens com excedente: ${linhas.length}`,
    `Valor total lancado: ${dinheiro(totalLancado)}`,
    `Valor total excedente (acima do acertado/tabela): ${dinheiro(totalExcedente)}`,
    '',
    'Por transportadora:',
    ...(linhasTexto.length ? linhasTexto : ['- Nenhum excedente no periodo.']),
  ].join('\n');

  return {
    tipo: 'excedentes_lotacao',
    titulo: 'Laudo de Excedentes - Auditoria Lotacao',
    geradoEm,
    periodo,
    assunto,
    corpoEmail,
    relatorioTexto: corpoEmail,
    totalItens: linhas.length,
    totalLancado,
    totalExcedente,
    porTransportadora,
    linhas,
  };
}

function nomeArquivoSeguro(v, fallback = 'laudo-excedentes') {
  return String(v || fallback)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

export function exportarRelatorioExcedentesExcel(itens = [], contexto = {}) {
  const linhas = montarLinhasExcedentes(itens);
  const porTransportadora = montarResumoPorTransportadora(linhas);

  const wb = XLSX.utils.book_new();

  const resumoSheet = porTransportadora.map((t) => ({
    Transportadora: t.transportadora,
    Itens: t.qtd,
    Valor_Lancado: t.totalLancado,
    Valor_Excedente: t.totalExcedente,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumoSheet), 'Resumo por transportadora');

  const detalheSheet = linhas.map((l) => ({
    Data: dataBR(l.data),
    Transportadora: l.transportadora,
    CTe: l.cte,
    Fatura: l.fatura,
    DIST: l.dist,
    Valor_Lancado: l.valorLancado,
    Valor_Excedente: l.valorExcedente,
    Status: l.status,
    Motivo: l.motivo,
    Aprovado_Por: l.aprovadoPor,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detalheSheet), 'Detalhe');

  const nome = `relatorio-excedentes-lotacao-${nomeArquivoSeguro(contexto.periodo)}.xlsx`;
  XLSX.writeFile(wb, nome);
  return true;
}

function montarHtmlExportavelLaudo(laudoNode, titulo) {
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
    body { margin: 0; background: #f8fafc; color: #0f172a; font-family: Arial, Sans-serif; }
    .laudo-export-shell { padding: 24px; }
    .laudo-page { max-width: 1200px; margin: 0 auto; }
    .laudo-email-acoes { display: none !important; }
    @media print {
      body { background: #fff; }
      .laudo-export-shell { padding: 0; }
      .laudo-page { box-shadow: none !important; border-radius: 0 !important; max-width: none !important; width: 100% !important; }
    }
  </style>
</head>
<body>
  <main class="laudo-export-shell">${laudoNode.outerHTML}</main>
</body>
</html>`;
}

export function gerarLaudoExcedentesPdf(laudoNode, laudo = {}) {
  if (!laudoNode) return false;
  const titulo = laudo.titulo || 'Laudo de Excedentes';
  const html = montarHtmlExportavelLaudo(laudoNode, titulo);
  const janela = window.open('', '_blank', 'width=1200,height=900');
  if (!janela) { window.print(); return false; }
  janela.document.write(html);
  janela.document.close();
  janela.focus();
  setTimeout(() => { janela.print(); }, 350);
  return true;
}
