const fs = require('fs');
const path = require('path');

let alterou = false;

function trocar(src, antigo, novo, msg) {
  if (src.includes(antigo)) {
    console.log('OK ' + msg);
    alterou = true;
    return src.replace(antigo, novo);
  }
  if (src.includes(novo)) {
    console.log('SKIP ' + msg);
    return src;
  }
  console.warn('WARN ' + msg);
  return src;
}

// 1) Corrige análise por faixa de peso para não usar rota/cotação agregada como CT-e individual.
const utilPath = path.join(process.cwd(), 'src/utils/laudosRodadasNegociacaoHtml.js');
let util = fs.readFileSync(utilPath, 'utf8');

const getFaixaAntigo = `function getFaixa(item = {}) {
  const direta = texto(item.faixaPeso || item.faixa_peso || item.faixa || item.pesoFaixa || item.faixa_peso_padrao);
  if (direta) return direta;
  const ini = n(item.pesoInicial || item.peso_inicial);
  const fim = n(item.pesoFinal || item.peso_final);
  if (ini || fim) return \`${'${numero(ini)}'} a ${'${fim ? numero(fim) : +}'} kg\`;
  const peso = n(item.peso || item.pesoDeclarado || item.peso_final_calculado);
  if (!peso) return 'Sem faixa';
  if (peso <= 20) return '0 a 20 kg';
  if (peso <= 50) return '21 a 50 kg';
  if (peso <= 100) return '51 a 100 kg';
  if (peso <= 300) return '101 a 300 kg';
  if (peso <= 500) return '301 a 500 kg';
  return 'Acima de 500 kg';
}`;

const getFaixaNovo = `function itemTemIdentificadorCte(item = {}) {
  return Boolean(
    item.numeroCte || item.numeroCTe || item.cte || item.chaveCte || item.chave_cte || item.chave_cte_ref ||
    item.notaFiscal || item.numeroNF || item.nf || item.chaveNf || item.chave_nf || item.pedido || item.numeroPedido ||
    item.valorCte || item.valorCTe || item.trackingMatch
  );
}

function itemPareceAgregado(item = {}) {
  const qtd = n(item.ctes || item.qtd || item.qtdCtes || item.qtdAnalisados || item.qtdGanhasSelecionada || item.qtdPerdidasSelecionada);
  if (qtd > 1) return true;
  if ((item.rota || item.nomeRota || item.cotacao || item.cotacaoFinal) && !itemTemIdentificadorCte(item)) return true;
  return false;
}

function itemValidoParaFaixa(item = {}) {
  if (!item || typeof item !== 'object') return false;
  if (itemTemIdentificadorCte(item)) return true;
  const direta = texto(item.faixaPeso || item.faixa_peso || item.faixa || item.pesoFaixa || item.faixa_peso_padrao);
  return Boolean(direta && !itemPareceAgregado(item));
}

function pesoIndividual(item = {}) {
  if (!itemValidoParaFaixa(item)) return 0;
  return n(
    item.pesoDeclarado || item.peso_declarado || item.pesoFinalCalculado || item.peso_final_calculado ||
    item.pesoCobrado || item.peso_cobrado || item.pesoCubado || item.peso_cubado || item.peso
  );
}

function getFaixa(item = {}) {
  if (!itemValidoParaFaixa(item)) return 'Sem faixa';
  const direta = texto(item.faixaPeso || item.faixa_peso || item.faixa || item.pesoFaixa || item.faixa_peso_padrao);
  if (direta) return direta;
  const peso = pesoIndividual(item);
  if (!peso) return 'Sem faixa';
  if (peso <= 20) return '0 a 20 kg';
  if (peso <= 50) return '21 a 50 kg';
  if (peso <= 100) return '51 a 100 kg';
  if (peso <= 300) return '101 a 300 kg';
  if (peso <= 500) return '301 a 500 kg';
  return 'Acima de 500 kg';
}`;

util = trocar(util, getFaixaAntigo, getFaixaNovo, 'substitui regra de faixa por peso individual');

const extrairAntigo = `function extrairDetalhesResumo(resumo = {}) {
  const candidatos = [
    resumo.ctesDetalhes,
    resumo.detalhes,
    resumo.linhasDetalhe,
    resumo.rotas,
    resumo.rotasPerdidasDestaque,
    resumo.rotasGanhasDestaque,
  ];
  return candidatos.reduce((acc, lista) => Array.isArray(lista) ? acc.concat(lista) : acc, []);
}`;

const extrairNovo = `function extrairDetalhesResumo(resumo = {}) {
  const candidatos = [
    resumo.ctesDetalhes,
    resumo.detalhes,
    resumo.linhasDetalhe,
    resumo.rotas,
    resumo.rotasPerdidasDestaque,
    resumo.rotasGanhasDestaque,
  ];
  return candidatos.reduce((acc, lista) => Array.isArray(lista) ? acc.concat(lista) : acc, []);
}

function extrairDetalhesFaixa(resumo = {}) {
  const candidatos = [
    resumo.ctesDetalhes,
    resumo.detalhes,
    resumo.linhasDetalhe,
  ];
  return candidatos
    .reduce((acc, lista) => Array.isArray(lista) ? acc.concat(lista) : acc, [])
    .filter(itemValidoParaFaixa);
}`;

util = trocar(util, extrairAntigo, extrairNovo, 'adiciona extração exclusiva para faixa de peso');

const agruparAntigo = `function agruparDetalhes(simulacao, agrupador) {
  const resumo = getResumoRodada(simulacao);
  const ind = getIndicadoresRodada(simulacao);
  const detalhes = extrairDetalhesResumo(resumo);
  const mapa = new Map();`;

const agruparNovo = `function agruparDetalhes(simulacao, agrupador, opcoes = {}) {
  const resumo = getResumoRodada(simulacao);
  const ind = getIndicadoresRodada(simulacao);
  const detalhes = opcoes.somenteFaixaIndividual ? extrairDetalhesFaixa(resumo) : extrairDetalhesResumo(resumo);
  const mapa = new Map();`;

util = trocar(util, agruparAntigo, agruparNovo, 'permite agrupamento apenas por CT-e individual');

const faixaAntigo = `  const faixasCriticas = primeira && ultima ? compararGenerico(primeira, ultima, (sim) => agruparDetalhes(sim, getFaixa))
    .filter((f) => n(f.ctesPerdidos) > 0 || n(f.faturamentoNaoCapturado) > 0)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 12) : [];`;

const faixaNovo = `  const faixasCriticas = primeira && ultima ? compararGenerico(primeira, ultima, (sim) => agruparDetalhes(sim, getFaixa, { somenteFaixaIndividual: true }))
    .filter((f) => f.chave !== 'Sem faixa' && (n(f.ctesPerdidos) > 0 || n(f.faturamentoNaoCapturado) > 0))
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 12) : [];`;

util = trocar(util, faixaAntigo, faixaNovo, 'usa só CT-e individual na análise por faixa');

fs.writeFileSync(utilPath, util, 'utf8');

// 2) Ajusta export HTML/PDF: embute CSS e remove seção de texto de cópia do arquivo exportado.
const compPath = path.join(process.cwd(), 'src/components/laudos/LaudoRodadasNegociacaoTemplate.jsx');
let comp = fs.readFileSync(compPath, 'utf8');

const inicio = comp.indexOf('function montarHtmlExportavel(laudoNode, titulo) {');
const fim = inicio >= 0 ? comp.indexOf('\n\nfunction abrirPdf', inicio) : -1;
if (inicio >= 0 && fim > inicio) {
  const novoHtml = `function montarHtmlExportavel(laudoNode, titulo) {
  const clone = laudoNode.cloneNode(true);
  clone.querySelectorAll('.laudo-rodadas-actions').forEach((el) => el.remove());
  clone.querySelectorAll('.laudo-rodadas-copy').forEach((el) => {
    const secao = el.closest('.laudo-rodadas-section');
    if (secao) secao.remove();
    else el.remove();
  });

  const cssExportavel = \`
    * { box-sizing: border-box; }
    body { margin: 0; background: #f8fafc; color: #0f172a; font-family: Arial, Helvetica, sans-serif; }
    .laudo-export-shell { padding: 24px; }
    .laudo-rodadas-page { background: #f8fafc; color: #0f172a; border: 1px solid #e2e8f0; border-radius: 18px; overflow: hidden; box-shadow: 0 18px 42px rgba(15,23,42,.08); max-width: 1200px; margin: 0 auto; }
    .laudo-rodadas-header { padding: 26px; background: linear-gradient(135deg, #430d95, #6514de 55%, #9153f0); color: #fff; }
    .laudo-rodadas-header small { display: block; text-transform: uppercase; letter-spacing: .08em; opacity: .86; font-weight: 800; }
    .laudo-rodadas-header h1 { margin: 8px 0 6px; font-size: 28px; line-height: 1.12; }
    .laudo-rodadas-header p { margin: 0; opacity: .92; }
    .laudo-rodadas-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-top: 18px; }
    .laudo-rodadas-meta div { background: rgba(255,255,255,.13); border: 1px solid rgba(255,255,255,.22); border-radius: 12px; padding: 10px 12px; }
    .laudo-rodadas-meta span, .laudo-rodadas-kpi span { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; opacity: .75; font-weight: 800; }
    .laudo-rodadas-meta strong { display: block; margin-top: 4px; font-size: 14px; }
    .laudo-rodadas-body { padding: 22px; display: grid; gap: 18px; }
    .laudo-rodadas-actions, .laudo-rodadas-copy-section { display: none !important; }
    .laudo-rodadas-alert { padding: 12px 14px; border-radius: 12px; border: 1px solid #bfdbfe; background: #eff6ff; color: #1e3a8a; font-weight: 700; }
    .laudo-rodadas-alert.warn { background: #fff7ed; color: #9a3412; border-color: #fed7aa; }
    .laudo-rodadas-alert.danger { background: #fef2f2; color: #991b1b; border-color: #fecaca; }
    .laudo-rodadas-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
    .laudo-rodadas-kpi { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 14px; box-shadow: 0 8px 22px rgba(15,23,42,.05); }
    .laudo-rodadas-kpi strong { display: block; font-size: 22px; margin-top: 4px; color: #111827; }
    .laudo-rodadas-kpi small { display: block; margin-top: 4px; color: #64748b; }
    .laudo-rodadas-section { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 16px; box-shadow: 0 8px 22px rgba(15,23,42,.04); page-break-inside: avoid; }
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
    @media print { body { background: #fff; } .laudo-export-shell { padding: 0; } .laudo-rodadas-page { box-shadow: none !important; border-radius: 0 !important; max-width: none !important; width: 100% !important; } }
  \`;

  return \`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>\${titulo}</title>
  <style>\${cssExportavel}</style>
</head>
<body>
  <main class="laudo-export-shell">
    \${clone.outerHTML}
  </main>
</body>
</html>\`;
}`;
  comp = comp.slice(0, inicio) + novoHtml + comp.slice(fim);
  alterou = true;
  console.log('OK export HTML/PDF com CSS embutido');
}

const secaoAntiga = '<section className="laudo-rodadas-section">\n          <h2>Texto pronto para copiar</h2>';
const secaoNova = '<section className="laudo-rodadas-section laudo-rodadas-copy-section">\n          <h2>Texto pronto para copiar</h2>';
if (comp.includes(secaoAntiga)) {
  comp = comp.replace(secaoAntiga, secaoNova);
  alterou = true;
  console.log('OK texto pronto para copiar marcado como apenas tela');
}

fs.writeFileSync(compPath, comp, 'utf8');

if (alterou) console.log('4.16B aplicado: faixas corrigidas e export ajustado.');
else console.log('4.16B sem alterações.');
