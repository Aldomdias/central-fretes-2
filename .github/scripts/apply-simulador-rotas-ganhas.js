const fs = require('fs');

const filePath = 'src/pages/SimuladorPage.jsx';
let content = fs.readFileSync(filePath, 'utf8');
let changed = false;

function replaceOnce(search, replacement, label) {
  if (content.includes(replacement)) return;
  if (!content.includes(search)) {
    throw new Error(`Trecho nao encontrado: ${label}`);
  }
  content = content.replace(search, replacement);
  changed = true;
}

const oldLaudo = `function gerarLaudoTextoRealizado(resumo, transportadora) {
  if (!resumo) return [];
  const linhas = [];
  linhas.push(\`A transportadora ${transportadora || 'selecionada'} participou da simulação em ${resumo.ctesComTabelaSelecionada} CT-es de ${resumo.ctesAnalisados} analisados.\`);
  linhas.push(\`Ela ganharia ${resumo.ctesGanhariaSelecionada} CT-es (${formatPercent(resumo.aderenciaSelecionada)}) e perderia ${resumo.ctesPerdidosSelecionada} CT-es para concorrentes mais baratos.\`);
  linhas.push(\`A projeção de faturamento pela tabela selecionada é ${formatMoney(resumo.faturamentoSelecionadaMes)} por mês e ${formatMoney(resumo.faturamentoSelecionadaAno)} em 12 meses.\`);
  linhas.push(\`O saving da tabela ganhadora contra o frete realizado é ${formatMoney(resumo.savingSelecionadaVsReal)} no período, considerando somente os CT-es em que a tabela selecionada ficaria em 1º lugar.\`);
  linhas.push(\`Como referência de mercado, o melhor preço entre todas as tabelas geraria ${formatMoney(resumo.savingVencedorVsReal)} de saving potencial no mesmo recorte.\`);
  linhas.push(\`Nas rotas perdidas, a redução média necessária para virar ganhadora é de ${formatPercent(resumo.reducaoMediaNecessaria)}.\`);
  return linhas;
}`;

const newLaudo = `function gerarLaudoTextoRealizado(resumo, transportadora) {
  if (!resumo) return [];
  const linhas = [];
  linhas.push(\`A transportadora ${transportadora || 'selecionada'} participou da simulação em ${resumo.ctesComTabelaSelecionada} CT-es de ${resumo.ctesAnalisados} analisados.\`);
  linhas.push(\`Ela ganharia ${resumo.ctesGanhariaSelecionada} CT-es (${formatPercent(resumo.aderenciaSelecionada)}) e perderia ${resumo.ctesPerdidosSelecionada} CT-es para concorrentes mais baratos.\`);
  if (resumo.qtdRotasComTabelaSelecionada) {
    linhas.push(\`Em rotas com tabela, ela aparece em ${resumo.qtdRotasComTabelaSelecionada} rota(s): ${resumo.qtdRotasGanhasSelecionada} ganha(s), ${resumo.qtdRotasParciaisSelecionada} parcial(is) e ${resumo.qtdRotasPerdidasSelecionada} perdida(s).\`);
  }
  if (Array.isArray(resumo.rotasGanhasDestaque) && resumo.rotasGanhasDestaque.length) {
    const rotas = resumo.rotasGanhasDestaque.map((rota) => \`${rota.rota} (${rota.qtdGanhasSelecionada} CT-es)\`).join('; ');
    linhas.push(\`Principais rotas ganhas: ${rotas}.\`);
  }
  linhas.push(\`A projeção de faturamento nos CT-es ganhos pela tabela selecionada é ${formatMoney(resumo.faturamentoSelecionadaGanhadoraMes)} por mês e ${formatMoney(resumo.faturamentoSelecionadaGanhadoraAno)} em 12 meses.\`);
  linhas.push(\`O saving da tabela ganhadora contra o frete realizado é ${formatMoney(resumo.savingSelecionadaVsReal)} no período, considerando somente os CT-es em que a tabela selecionada ficaria em 1º lugar.\`);
  linhas.push(\`Como referência de mercado, o melhor preço entre todas as tabelas geraria ${formatMoney(resumo.savingVencedorVsReal)} de saving potencial no mesmo recorte.\`);
  linhas.push(\`Nas rotas perdidas, a redução média necessária para virar ganhadora é de ${formatPercent(resumo.reducaoMediaNecessaria)}.\`);
  return linhas;
}`;

replaceOnce(oldLaudo, newLaudo, 'laudo executivo');

replaceOnce(
  "      if (Number(itemSelecionada.ranking) === 1) rota.qtdGanhasSelecionada += 1;",
  "      if (statusSelecionada === 'Ganharia') rota.qtdGanhasSelecionada += 1;",
  'classificacao de rotas ganhas'
);

replaceOnce(
  `  const faturamentoSelecionadaMes = meses ? freteSelecionada / meses : freteSelecionada;
  const faturamentoSelecionadaAno = faturamentoSelecionadaMes * 12;`,
  `  const faturamentoSelecionadaMes = meses ? freteSelecionada / meses : freteSelecionada;
  const faturamentoSelecionadaAno = faturamentoSelecionadaMes * 12;
  const faturamentoSelecionadaGanhadoraMes = meses ? freteSelecionadaGanhadora / meses : freteSelecionadaGanhadora;
  const faturamentoSelecionadaGanhadoraAno = faturamentoSelecionadaGanhadoraMes * 12;`,
  'faturamento ganhador'
);

replaceOnce(
  `  const pareto80Volume = calcularPareto80Volume(rotas);`,
  `  const pareto80Volume = calcularPareto80Volume(rotas);
  const rotasComTabelaSelecionada = rotas.filter((rota) => Number(rota.qtdComSelecionada || 0) > 0);
  const rotasGanhasSelecionada = rotasComTabelaSelecionada.filter((rota) => Number(rota.qtdGanhasSelecionada || 0) > 0 && Number(rota.qtdPerdidasSelecionada || 0) === 0);
  const rotasParciaisSelecionada = rotasComTabelaSelecionada.filter((rota) => Number(rota.qtdGanhasSelecionada || 0) > 0 && Number(rota.qtdPerdidasSelecionada || 0) > 0);
  const rotasPerdidasSelecionada = rotasComTabelaSelecionada.filter((rota) => Number(rota.qtdGanhasSelecionada || 0) === 0 && Number(rota.qtdPerdidasSelecionada || 0) > 0);
  const rotasGanhasDestaque = [...rotasGanhasSelecionada, ...rotasParciaisSelecionada]
    .sort((a, b) => Number(b.qtdGanhasSelecionada || 0) - Number(a.qtdGanhasSelecionada || 0) || Number(b.savingSelecionada || 0) - Number(a.savingSelecionada || 0))
    .slice(0, 3);`,
  'resumo de rotas ganhas'
);

replaceOnce(
  `    faturamentoSelecionadaMes,
    faturamentoSelecionadaAno,`,
  `    faturamentoSelecionadaMes,
    faturamentoSelecionadaAno,
    faturamentoSelecionadaGanhadoraMes,
    faturamentoSelecionadaGanhadoraAno,`,
  'campos de faturamento ganhador'
);

replaceOnce(
  `    rotas,
    porTransportadoraReal,`,
  `    rotas,
    qtdRotasComTabelaSelecionada: rotasComTabelaSelecionada.length,
    qtdRotasGanhasSelecionada: rotasGanhasSelecionada.length,
    qtdRotasParciaisSelecionada: rotasParciaisSelecionada.length,
    qtdRotasPerdidasSelecionada: rotasPerdidasSelecionada.length,
    rotasGanhasDestaque,
    porTransportadoraReal,`,
  'campos de resumo de rotas'
);

if (changed) {
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('SimuladorPage.jsx atualizado.');
} else {
  console.log('Nenhuma alteracao necessaria.');
}
