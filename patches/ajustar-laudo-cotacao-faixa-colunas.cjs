const fs = require('fs');
const path = require('path');
let changed = false;

function writeIfChanged(file, src, original, label) {
  if (src !== original) {
    fs.writeFileSync(file, src, 'utf8');
    changed = true;
    console.log('OK ' + label);
  } else {
    console.log('SKIP ' + label);
  }
}

function replaceRangeByMarkers(src, startMarker, endMarker, replacement, label) {
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
  if (src.includes(block.trim().split('\n')[0])) return src;
  const idx = src.indexOf(marker);
  if (idx < 0) {
    console.warn('WARN ' + label);
    return src;
  }
  changed = true;
  console.log('OK ' + label);
  return src.slice(0, idx) + block + '\n' + src.slice(idx);
}

// 1) Ajusta a cotação salva: remove a parte da faixa do texto da tabela.
const servicePath = path.join(process.cwd(), 'src/services/tabelasNegociacaoService.js');
let service = fs.readFileSync(servicePath, 'utf8');
const originalService = service;
const cotacaoNova = `function cotacaoLaudoServico(item = {}) {
  const candidatos = [
    item.cotacao,
    item.cotacaoFinal,
    item.faixaCotacao,
    item.rota,
    item.nomeRota,
    item.selecionadaDetalhes?.frete?.faixa_peso,
    item.selecionadaDetalhes?.frete?.faixa,
    item.vencedorDetalhes?.frete?.faixa_peso,
    item.todosResultados?.[0]?.detalhes?.frete?.faixa_peso,
    item.destino,
    item.cidadeDestino,
  ];
  const bruto = texto(candidatos.find((v) => texto(v))) || 'Destino';
  const partes = bruto.split('|').map((p) => texto(p)).filter(Boolean);
  const base = partes[0] || bruto;
  return base.replace(/ [0-9][0-9.,]* *A *[0-9][0-9.,]* *KG.*$/i, '').trim() || base;
}`;
service = replaceRangeByMarkers(service, 'function cotacaoLaudoServico', 'function montarAnaliseFaixasB2CLaudoServico', cotacaoNova, 'cotação salva sem faixa embutida');
writeIfChanged(servicePath, service, originalService, 'service do laudo');

// 2) Faz o laudo derivar visão por cotação e por destino a partir da análise de faixas salva.
const utilPath = path.join(process.cwd(), 'src/utils/laudosRodadasNegociacaoHtml.js');
let util = fs.readFileSync(utilPath, 'utf8');
const originalUtil = util;
const helpers = `function agruparAnaliseSalvaPorCampo(lista = [], campo = 'rota') {
  const mapa = new Map();
  lista.forEach((item) => {
    const chave = campo === 'destino'
      ? [item.origem, item.destino, item.ufDestino].filter(Boolean).join(' > ')
      : [item.origem, item.ufDestino, item.rota || item.cotacao].filter(Boolean).join(' > ');
    if (!chave) return;
    if (!mapa.has(chave)) {
      mapa.set(chave, {
        chave,
        origem: item.origem || '',
        destino: campo === 'destino' ? (item.destino || '') : '',
        ufDestino: item.ufDestino || '-',
        rota: campo === 'destino' ? [item.origem, item.destino, item.ufDestino].filter(Boolean).join(' > ') : (item.rota || item.cotacao || chave),
        faixa: 'Todas as faixas',
        ctesAnalisados: 0,
        ctesGanhos: 0,
        ctesPerdidos: 0,
        volumes: 0,
        faturamentoPotencial: 0,
        faturamentoCapturado: 0,
        faturamentoNaoCapturado: 0,
        reducaoSoma: 0,
        reducaoQtd: 0,
      });
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
  return finalizarAgrupados(Array.from(mapa.values()))
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos));
}

`;
util = insertBefore(util, 'function classificarRecomendacao', helpers, 'helpers para agrupar análise salva');

const oldBlock = `  const ufsCriticas = primeira && ultima ? compararGenerico(primeira, ultima, agruparPorUf)
    .filter((u) => n(u.ctesPerdidos) > 0 || n(u.ctesGanhos) > 0 || n(u.ctesAnalisados) > 0 || n(u.faturamentoNaoCapturado) > 0)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 12) : [];
  const cotacoesCriticas = primeira && ultima ? compararGenerico(primeira, ultima, agruparPorCotacao)
    .map((c) => ({ ...c, faixa: 'Todas as faixas' }))
    .filter((c) => n(c.ctesPerdidos) > 0 || n(c.faturamentoNaoCapturado) > 0)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 15) : [];
  const destinosCriticos = primeira && ultima ? compararGenerico(primeira, ultima, agruparPorDestino)
    .map((d) => ({ ...d, faixa: 'Todas as faixas' }))
    .filter((d) => n(d.ctesPerdidos) > 0 || n(d.faturamentoNaoCapturado) > 0)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 15) : [];
  const faixasSalvasUltima = ultima ? obterAnaliseFaixasB2CSalva(ultima) : [];
  const faixasCriticas = faixasSalvasUltima.length
    ? faixasSalvasUltima
        .filter((f) => n(f.ctesPerdidos) > 0 || n(f.faturamentoNaoCapturado) > 0)
        .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
        .slice(0, 20)
    : (primeira && ultima ? compararGenerico(primeira, ultima, agruparPorFaixaB2C)
        .filter((f) => f.chave !== 'Sem faixa' && (n(f.ctesPerdidos) > 0 || n(f.faturamentoNaoCapturado) > 0))
        .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
        .slice(0, 20) : []);`;
const newBlock = `  const faixasSalvasUltima = ultima ? obterAnaliseFaixasB2CSalva(ultima) : [];
  const ufsCriticas = primeira && ultima ? compararGenerico(primeira, ultima, agruparPorUf)
    .filter((u) => n(u.ctesPerdidos) > 0 || n(u.ctesGanhos) > 0 || n(u.ctesAnalisados) > 0 || n(u.faturamentoNaoCapturado) > 0)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 12) : [];
  const cotacoesCriticas = faixasSalvasUltima.length
    ? agruparAnaliseSalvaPorCampo(faixasSalvasUltima, 'rota').filter((c) => n(c.ctesPerdidos) > 0 || n(c.faturamentoNaoCapturado) > 0).slice(0, 15)
    : (primeira && ultima ? compararGenerico(primeira, ultima, agruparPorCotacao)
        .map((c) => ({ ...c, faixa: 'Todas as faixas' }))
        .filter((c) => n(c.ctesPerdidos) > 0 || n(c.faturamentoNaoCapturado) > 0)
        .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
        .slice(0, 15) : []);
  const destinosCriticos = faixasSalvasUltima.length
    ? agruparAnaliseSalvaPorCampo(faixasSalvasUltima, 'destino').filter((d) => n(d.ctesPerdidos) > 0 || n(d.faturamentoNaoCapturado) > 0).slice(0, 15)
    : (primeira && ultima ? compararGenerico(primeira, ultima, agruparPorDestino)
        .map((d) => ({ ...d, faixa: 'Todas as faixas' }))
        .filter((d) => n(d.ctesPerdidos) > 0 || n(d.faturamentoNaoCapturado) > 0)
        .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
        .slice(0, 15) : []);
  const faixasCriticas = faixasSalvasUltima.length
    ? faixasSalvasUltima
        .filter((f) => n(f.ctesPerdidos) > 0 || n(f.faturamentoNaoCapturado) > 0)
        .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
        .slice(0, 20)
    : (primeira && ultima ? compararGenerico(primeira, ultima, agruparPorFaixaB2C)
        .filter((f) => f.chave !== 'Sem faixa' && (n(f.ctesPerdidos) > 0 || n(f.faturamentoNaoCapturado) > 0))
        .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
        .slice(0, 20) : []);`;
if (util.includes(oldBlock)) {
  util = util.replace(oldBlock, newBlock);
  changed = true;
  console.log('OK visão por cotação/destino usa análise salva');
} else {
  console.warn('WARN bloco de visões analíticas não encontrado');
}
writeIfChanged(utilPath, util, originalUtil, 'utils do laudo');

// 3) Ajusta componente: tabela de faixa com colunas completas.
const compPath = path.join(process.cwd(), 'src/components/laudos/LaudoRodadasNegociacaoTemplate.jsx');
let comp = fs.readFileSync(compPath, 'utf8');
const originalComp = comp;
const tabelaFaixas = `function TabelaFaixas({ titulo, linhas = [] }) {
  return (
    <section className="laudo-rodadas-section">
      <h2>{titulo}</h2>
      <div className="laudo-rodadas-table-wrap">
        <table className="laudo-rodadas-table">
          <thead>
            <tr>
              <th>Cotação/Rota</th>
              <th>Origem</th>
              <th>Destino</th>
              <th>UF</th>
              <th>Faixa</th>
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
              <tr key={item.chave || [item.rota, item.destino, item.ufDestino, item.faixa].filter(Boolean).join('-')}>
                <td><strong>{item.rota || item.cotacao || '-'}</strong></td>
                <td>{item.origem || '-'}</td>
                <td>{item.destino || '-'}</td>
                <td>{item.ufDestino || '-'}</td>
                <td><strong>{item.faixa || '-'}</strong></td>
                <td className="right">{numero(item.ctesPerdidos)}</td>
                <td className="right">{numero(item.ctesGanhos)}</td>
                <td className="right">{percentual(item.aderencia)}</td>
                <td className="right">{dinheiro(item.faturamentoNaoCapturado)}</td>
                <td className="right">{percentual(item.ajusteMedio)}</td>
                <td><span className={'laudo-rodadas-badge ' + prioridadeClasse(item.prioridade)}>{item.prioridade || 'BAIXA'}</span></td>
              </tr>
            ))}
            {!linhas.length ? <tr><td colSpan="11">Sem leitura suficiente por faixa neste recorte.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

`;
comp = insertBefore(comp, 'function TabelaSimples', tabelaFaixas, 'componente tabela de faixas');
comp = comp.replace('<TabelaSimples titulo="Faixas de peso prioritárias" linhas={(laudo.faixasCriticas || laudo.faixasPrioritarias || []).slice(0, 8)} tipo="faixa" />', '<TabelaFaixas titulo="Faixas por cotação/rota e destino" linhas={(laudo.faixasCriticas || laudo.faixasPrioritarias || []).slice(0, 20)} />');
comp = comp.replace('<TabelaSimples titulo="Faixas B2C por rota/destino" linhas={(laudo.faixasCriticas || laudo.faixasPrioritarias || []).slice(0, 8)} tipo="faixa" />', '<TabelaFaixas titulo="Faixas por cotação/rota e destino" linhas={(laudo.faixasCriticas || laudo.faixasPrioritarias || []).slice(0, 20)} />');
comp = comp.replace('<TabelaSimples titulo="Faixas por rota/destino" linhas={(laudo.faixasCriticas || laudo.faixasPrioritarias || []).slice(0, 8)} tipo="faixa" />', '<TabelaFaixas titulo="Faixas por cotação/rota e destino" linhas={(laudo.faixasCriticas || laudo.faixasPrioritarias || []).slice(0, 20)} />');
comp = comp.replace('<TabelaSimples titulo="Faixas por rota/destino" linhas={(laudo.faixasCriticas || laudo.faixasPrioritarias || []).slice(0, 12)} tipo="faixa" />', '<TabelaFaixas titulo="Faixas por cotação/rota e destino" linhas={(laudo.faixasCriticas || laudo.faixasPrioritarias || []).slice(0, 20)} />');
writeIfChanged(compPath, comp, originalComp, 'componente do laudo');

console.log(changed ? '4.16I aplicado.' : '4.16I sem alterações.');
