const fs = require('fs');
const path = require('path');
let changed = false;

function rep(src, from, to, label) {
  if (src.includes(from)) {
    changed = true;
    console.log('OK ' + label);
    return src.replace(from, to);
  }
  if (src.includes(to)) {
    console.log('SKIP ' + label);
    return src;
  }
  console.warn('WARN ' + label);
  return src;
}

function replaceRange(src, startMarker, endMarker, replacement, label) {
  const start = src.indexOf(startMarker);
  const end = start >= 0 ? src.indexOf(endMarker, start) : -1;
  if (start >= 0 && end > start) {
    changed = true;
    console.log('OK ' + label);
    return src.slice(0, start) + replacement + '\n\n' + src.slice(end);
  }
  console.warn('WARN ' + label);
  return src;
}

function insertBefore(src, marker, block, label) {
  if (src.includes(block.trim().split('\n')[0])) {
    console.log('SKIP ' + label);
    return src;
  }
  const idx = src.indexOf(marker);
  if (idx < 0) {
    console.warn('WARN ' + label);
    return src;
  }
  changed = true;
  console.log('OK ' + label);
  return src.slice(0, idx) + block + '\n' + src.slice(idx);
}

function save(file, src, original, label) {
  if (src !== original) {
    fs.writeFileSync(file, src, 'utf8');
    changed = true;
    console.log('OK ' + label);
  }
}

// 1) Não altera motor de cálculo: apenas grava no detalhe do CT-e a rota/cotação real usada pelo cálculo.
const simPath = path.join(process.cwd(), 'src/pages/SimuladorPage.jsx');
let sim = fs.readFileSync(simPath, 'utf8');
const simOriginal = sim;
sim = rep(sim,
`      canal,
      transportadoraReal: row.transportadora || '',`,
`      canal,
      rotaSelecionada: itemSelecionada?.rotaNome || '',
      rotaCotacao: itemSelecionada?.rotaNome || vencedor?.rotaNome || '',
      rotaVencedora: vencedor?.rotaNome || '',
      faixaCotacaoSelecionada: itemSelecionada?.detalhes?.frete?.faixaPeso || '',
      transportadoraReal: row.transportadora || '',`,
'rota real no cteDetalhes');
sim = rep(sim,
`      todosResultados: resultado.slice(0, 8).map((r) => ({
        transportadora: r.transportadora,
        total: r.total,
        ranking: r.ranking,
        origem: r.origem,
        detalhes: r.detalhes || null,
      })),`,
`      todosResultados: resultado.slice(0, 8).map((r) => ({
        transportadora: r.transportadora,
        total: r.total,
        ranking: r.ranking,
        origem: r.origem,
        rotaNome: r.rotaNome || '',
        detalhes: r.detalhes || null,
      })),`,
'rota nos todosResultados');
save(simPath, sim, simOriginal, 'SimuladorPage');

// 2) Serviço: a cotação/rota vem da rota real do cálculo, não da cidade.
const servicePath = path.join(process.cwd(), 'src/services/tabelasNegociacaoService.js');
let service = fs.readFileSync(servicePath, 'utf8');
const serviceOriginal = service;
const cotacaoFn = `function cotacaoLaudoServico(item = {}) {
  const candidatos = [
    item.rotaSelecionada,
    item.rotaCotacao,
    item.rotaVencedora,
    item.cotacao,
    item.cotacaoFinal,
    item.faixaCotacao,
    item.rota,
    item.nomeRota,
    item.todosResultados?.[0]?.rotaNome,
    item.selecionadaDetalhes?.frete?.faixaPeso,
    item.selecionadaDetalhes?.frete?.faixa_peso,
    item.vencedorDetalhes?.frete?.faixaPeso,
    item.vencedorDetalhes?.frete?.faixa_peso,
  ];
  const bruto = texto(candidatos.find((v) => texto(v))) || texto(item.destino || item.cidadeDestino || 'Destino');
  const partes = bruto.split('|').map((p) => texto(p)).filter(Boolean);
  const base = partes[0] || bruto;
  return base.replace(/ [0-9][0-9.,]* *A *[0-9][0-9.,]* *KG.*$/i, '').trim() || base;
}`;
service = replaceRange(service, 'function cotacaoLaudoServico', 'function montarAnaliseFaixasB2CLaudoServico', cotacaoFn, 'cotacaoLaudoServico por rota real');
service = rep(service,
`    const destino = texto(item.destino || item.cidadeDestino || 'Destino');
    const ufDestino = upper(item.ufDestino || item.uf || item.estadoDestino || '');
    const rota = cotacaoLaudoServico(item);
    const chave = [origem, destino, ufDestino, rota, faixa].map(upper).join('|');
    if (!mapa.has(chave)) mapa.set(chave, { chave, origem, destino, ufDestino, rota, cotacao: rota, faixa, ctesAnalisados: 0, ctesGanhos: 0, ctesPerdidos: 0, volumes: 0, pesoTotal: 0, faturamentoPotencial: 0, faturamentoCapturado: 0, faturamentoNaoCapturado: 0, reducaoSoma: 0, reducaoQtd: 0 });`,
`    const destino = texto(item.destino || item.cidadeDestino || 'Destino');
    const ufDestino = upper(item.ufDestino || item.uf || item.estadoDestino || '');
    const rota = cotacaoLaudoServico(item);
    const chave = [origem, ufDestino, rota, faixa].map(upper).join('|');
    if (!mapa.has(chave)) mapa.set(chave, { chave, origem, destino: '', destinoExemplo: destino, ufDestino, rota, cotacao: rota, faixa, ctesAnalisados: 0, ctesGanhos: 0, ctesPerdidos: 0, volumes: 0, pesoTotal: 0, faturamentoPotencial: 0, faturamentoCapturado: 0, faturamentoNaoCapturado: 0, reducaoSoma: 0, reducaoQtd: 0 });`,
'agrega faixa por origem/uf/rota/faixa');
save(servicePath, service, serviceOriginal, 'service laudo');

// 3) Utils: agrupa cotação por origem + UF + rota; destino continua sendo cidade.
const utilPath = path.join(process.cwd(), 'src/utils/laudosRodadasNegociacaoHtml.js');
let util = fs.readFileSync(utilPath, 'utf8');
const utilOriginal = util;
const helper = `function agruparAnaliseSalvaPorCampo(lista = [], campo = 'rota') {
  const mapa = new Map();
  lista.forEach((item) => {
    const chave = campo === 'destino'
      ? [item.origem, item.destino || item.destinoExemplo, item.ufDestino].filter(Boolean).join(' > ')
      : [item.origem, item.ufDestino, item.rota || item.cotacao].filter(Boolean).join(' > ');
    if (!chave) return;
    if (!mapa.has(chave)) {
      mapa.set(chave, { chave, origem: item.origem || '', destino: campo === 'destino' ? (item.destino || item.destinoExemplo || '') : '', ufDestino: item.ufDestino || '-', rota: campo === 'destino' ? [item.origem, item.destino || item.destinoExemplo, item.ufDestino].filter(Boolean).join(' > ') : (item.rota || item.cotacao || chave), faixa: 'Todas as faixas', ctesAnalisados: 0, ctesGanhos: 0, ctesPerdidos: 0, volumes: 0, faturamentoPotencial: 0, faturamentoCapturado: 0, faturamentoNaoCapturado: 0, reducaoSoma: 0, reducaoQtd: 0 });
    }
    const acc = mapa.get(chave);
    acc.ctesAnalisados += n(item.ctesAnalisados);
    acc.ctesGanhos += n(item.ctesGanhos);
    acc.ctesPerdidos += n(item.ctesPerdidos);
    acc.volumes += n(item.volumes);
    acc.faturamentoPotencial += n(item.faturamentoPotencial);
    acc.faturamentoCapturado += n(item.faturamentoCapturado);
    acc.faturamentoNaoCapturado += n(item.faturamentoNaoCapturado);
    const peso = Math.max(n(item.ctesPerdidos), 1);
    acc.reducaoSoma += n(item.ajusteMedio) * peso;
    acc.reducaoQtd += peso;
  });
  return finalizarAgrupados(Array.from(mapa.values())).sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos));
}

`;
util = insertBefore(util, 'function classificarRecomendacao', helper, 'helper agrupamento salvo');
util = rep(util,
`  const ufsCriticas = primeira && ultima ? compararGenerico(primeira, ultima, agruparPorUf)
    .filter((u) => n(u.ctesPerdidos) > 0 || n(u.faturamentoNaoCapturado) > 0)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 12) : [];
  const faixasCriticas = primeira && ultima ? compararGenerico(primeira, ultima, (sim) => agruparDetalhes(sim, getFaixa))
    .filter((f) => n(f.ctesPerdidos) > 0 || n(f.faturamentoNaoCapturado) > 0)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 12) : [];`,
`  const faixasSalvasUltima = ultima ? obterAnaliseFaixasB2CSalva(ultima) : [];
  const ufsCriticas = primeira && ultima ? compararGenerico(primeira, ultima, agruparPorUf)
    .filter((u) => n(u.ctesPerdidos) > 0 || n(u.faturamentoNaoCapturado) > 0)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 12) : [];
  const cotacoesCriticas = faixasSalvasUltima.length ? agruparAnaliseSalvaPorCampo(faixasSalvasUltima, 'rota').slice(0, 15) : [];
  const destinosCriticos = primeira && ultima ? compararGenerico(primeira, ultima, agruparPorDestino)
    .map((d) => ({ ...d, faixa: 'Todas as faixas' }))
    .filter((d) => n(d.ctesPerdidos) > 0 || n(d.faturamentoNaoCapturado) > 0)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 15) : [];
  const faixasCriticas = faixasSalvasUltima.length ? faixasSalvasUltima.slice(0, 20) : (primeira && ultima ? compararGenerico(primeira, ultima, (sim) => agruparDetalhes(sim, getFaixa)).filter((f) => n(f.ctesPerdidos) > 0 || n(f.faturamentoNaoCapturado) > 0).sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos)).slice(0, 12) : []);`,
'cria visoes cotacao/destino/faixa');
util = rep(util, `    ufsCriticas,
    faixasCriticas,`, `    ufsCriticas,
    cotacoesCriticas,
    destinosCriticos,
    faixasCriticas,`, 'inclui visoes no base');
util = rep(util, `      ondeAjustar: rotasCriticas,
      recomendacao: recomendacaoTransp,`, `      ondeAjustar: rotasCriticas,
      cotacoesPrioritarias: cotacoesCriticas,
      destinosPrioritarios: destinosCriticos,
      recomendacao: recomendacaoTransp,`, 'inclui visoes transportador');
save(utilPath, util, utilOriginal, 'utils laudo');

// 4) Componente: tabela de faixas sem destino, por origem + UF + cotação/rota + faixa.
const compPath = path.join(process.cwd(), 'src/components/laudos/LaudoRodadasNegociacaoTemplate.jsx');
let comp = fs.readFileSync(compPath, 'utf8');
const compOriginal = comp;
const tabelaFaixas = `function TabelaFaixas({ titulo, linhas = [] }) {
  return (
    <section className="laudo-rodadas-section">
      <h2>{titulo}</h2>
      <div className="laudo-rodadas-table-wrap">
        <table className="laudo-rodadas-table">
          <thead><tr><th>Origem</th><th>UF destino</th><th>Cotação/Rota</th><th>Faixa</th><th className="right">CT-es perdidos</th><th className="right">CT-es ganhos</th><th className="right">Aderência</th><th className="right">Fat. não capturado</th><th className="right">Ajuste médio</th><th>Prioridade</th></tr></thead>
          <tbody>{linhas.map((item) => (<tr key={item.chave || [item.origem, item.ufDestino, item.rota, item.faixa].filter(Boolean).join('-')}><td>{item.origem || '-'}</td><td>{item.ufDestino || '-'}</td><td><strong>{item.rota || item.cotacao || '-'}</strong></td><td><strong>{item.faixa || '-'}</strong></td><td className="right">{numero(item.ctesPerdidos)}</td><td className="right">{numero(item.ctesGanhos)}</td><td className="right">{percentual(item.aderencia)}</td><td className="right">{dinheiro(item.faturamentoNaoCapturado)}</td><td className="right">{percentual(item.ajusteMedio)}</td><td><span className={'laudo-rodadas-badge ' + prioridadeClasse(item.prioridade)}>{item.prioridade || 'BAIXA'}</span></td></tr>))}{!linhas.length ? <tr><td colSpan="10">Sem leitura suficiente por faixa neste recorte.</td></tr> : null}</tbody>
        </table>
      </div>
    </section>
  );
}

`;
comp = insertBefore(comp, 'function TabelaSimples', tabelaFaixas, 'componente tabela de faixas');
comp = rep(comp, '<TabelaSimples titulo="Faixas de peso prioritárias" linhas={(laudo.faixasCriticas || laudo.faixasPrioritarias || []).slice(0, 8)} tipo="faixa" />', '<TabelaFaixas titulo="Faixas por cotação/rota" linhas={(laudo.faixasCriticas || laudo.faixasPrioritarias || []).slice(0, 20)} />', 'troca tabela faixa antiga');
comp = rep(comp, '<TabelaSimples titulo="Faixas B2C por rota/destino" linhas={(laudo.faixasCriticas || laudo.faixasPrioritarias || []).slice(0, 8)} tipo="faixa" />', '<TabelaFaixas titulo="Faixas por cotação/rota" linhas={(laudo.faixasCriticas || laudo.faixasPrioritarias || []).slice(0, 20)} />', 'troca tabela faixa b2c');
comp = rep(comp, '<TabelaSimples titulo="Faixas por rota/destino" linhas={(laudo.faixasCriticas || laudo.faixasPrioritarias || []).slice(0, 12)} tipo="faixa" />', '<TabelaFaixas titulo="Faixas por cotação/rota" linhas={(laudo.faixasCriticas || laudo.faixasPrioritarias || []).slice(0, 20)} />', 'troca tabela faixa rota destino');
save(compPath, comp, compOriginal, 'componente laudo');

console.log(changed ? '4.16J aplicado.' : '4.16J sem alterações.');
