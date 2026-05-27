const fs = require('fs');
const path = require('path');

let changed = false;
function replaceRange(src, startMarker, endMarker, replacement, label) {
  const start = src.indexOf(startMarker);
  const end = start >= 0 ? src.indexOf(endMarker, start) : -1;
  if (start >= 0 && end > start) {
    const atual = src.slice(start, end);
    if (atual !== replacement) {
      changed = true;
      console.log('OK ' + label);
      return src.slice(0, start) + replacement + src.slice(end);
    }
    console.log('SKIP ' + label);
    return src;
  }
  console.warn('WARN ' + label);
  return src;
}
function replaceOnce(src, from, to, label) {
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

const utilPath = path.join(process.cwd(), 'src/utils/laudosRodadasNegociacaoHtml.js');
let util = fs.readFileSync(utilPath, 'utf8');

const faixaNova = String.raw`const FAIXAS_B2C_OFICIAIS = [
  { min: 0, max: 2, label: '0 a 2 kg' },
  { min: 2, max: 5, label: '2 a 5 kg' },
  { min: 5, max: 10, label: '5 a 10 kg' },
  { min: 10, max: 20, label: '10 a 20 kg' },
  { min: 20, max: 30, label: '20 a 30 kg' },
  { min: 30, max: 50, label: '30 a 50 kg' },
  { min: 50, max: 70, label: '50 a 70 kg' },
  { min: 70, max: 100, label: '70 a 100 kg' },
  { min: 100, max: Infinity, label: 'Acima de 100 kg' },
];

function normalizarFaixaB2C(valor) {
  const raw = texto(valor);
  if (!raw) return '';
  const s = raw.toLowerCase().replace(',', '.');
  const nums = s.match(/\d+(?:\.\d+)?/g) || [];
  if ((s.includes('acima') || s.includes('+')) && nums.length) {
    const base = Number(nums[0]);
    if (base >= 100) return 'Acima de 100 kg';
  }
  if (nums.length >= 2) {
    const ini = Number(nums[0]);
    const fim = Number(nums[1]);
    const achou = FAIXAS_B2C_OFICIAIS.find((f) => Number.isFinite(f.max) && Math.abs(f.min - ini) < 0.01 && Math.abs(f.max - fim) < 0.01);
    return achou ? achou.label : '';
  }
  return '';
}

function pesoIndividualCte(item = {}) {
  return n(
    item.pesoRealizado || item.peso_realizado || item.pesoCte || item.peso_cte || item.pesoCobrado || item.peso_cobrado ||
    item.pesoCubado || item.peso_cubado || item.pesoTaxado || item.peso_taxado || item.pesoDeclarado || item.peso_declarado ||
    item.pesoFinalCalculado || item.peso_final_calculado || item.pesoMedio || item.peso_medio || item.peso
  );
}

function getFaixa(item = {}) {
  const direta = normalizarFaixaB2C(item.faixaPeso || item.faixa_peso || item.faixa || item.pesoFaixa || item.faixa_peso_padrao);
  if (direta) return direta;
  const peso = pesoIndividualCte(item);
  if (!peso) return 'Sem faixa';
  const faixa = FAIXAS_B2C_OFICIAIS.find((f) => peso > f.min && peso <= f.max) || FAIXAS_B2C_OFICIAIS[0];
  return faixa.label;
}`;
util = replaceRange(util, 'function getFaixa(item = {}) {', '\n\nfunction isGanha', faixaNova, 'grade oficial B2C');

const blocoAgregacao = String.raw`function extrairDetalhesResumo(resumo = {}) {
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

function extrairDetalhesOperacionais(resumo = {}) {
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

function extrairDetalhesFaixaB2C(resumo = {}) {
  const candidatos = [resumo.ctesDetalhes, resumo.detalhes, resumo.linhasDetalhe];
  return candidatos
    .reduce((acc, lista) => Array.isArray(lista) ? acc.concat(lista) : acc, [])
    .filter((item) => getFaixa(item) !== 'Sem faixa');
}

function agruparDetalhes(simulacao, agrupador, opcoes = {}) {
  const resumo = getResumoRodada(simulacao);
  const ind = getIndicadoresRodada(simulacao);
  const detalhes = opcoes.somenteFaixaB2C ? extrairDetalhesFaixaB2C(resumo) : extrairDetalhesOperacionais(resumo);
  const mapa = new Map();

  detalhes.forEach((item) => {
    const chave = agrupador(item);
    if (!chave || chave === 'Sem faixa' || chave === '-') return;
    agregarRegistro(mapa, chave, item, ind);
  });

  return finalizarAgrupados(Array.from(mapa.values()));
}

function somarCamposContagem(item = {}, tipo = 'ganho') {
  if (tipo === 'ganho') return n(item.ctesGanhos || item.ctes_ganhos || item.qtdGanhasSelecionada || item.qtd_ganhas || item.ganhas || item.ctesCompetitivos || item.competitivos || item.qtdCompetitiva);
  if (tipo === 'perdido') return n(item.ctesPerdidos || item.ctes_perdidos || item.qtdPerdidasSelecionada || item.qtd_perdidas || item.perdidas || item.ctesNaoCompetitivos || item.naoCompetitivos || item.qtdNaoCompetitiva);
  return n(item.ctes || item.qtd || item.qtdCtes || item.ctesAnalisados || item.qtdAnalisados || item.totalCtes || item.total);
}

function chaveCotacaoAnalitica(item = {}) {
  const origem = texto(item.origem || item.cidadeOrigem || item.cidade_origem || item.ufOrigem || item.uf_origem);
  const ufDestino = getUfDestino(item);
  const cotacao = texto(item.cotacao || item.cotacaoFinal || item.faixaCotacao || item.regiao || item.rota || item.nomeRota || item.nome);
  return [origem || 'Origem', ufDestino || 'UF', cotacao || 'Cotação/Rota'].filter(Boolean).join(' > ');
}

function chaveDestinoAnalitico(item = {}) {
  const origem = texto(item.origem || item.cidadeOrigem || item.cidade_origem || item.ufOrigem || item.uf_origem);
  const cidade = texto(item.destino || item.cidadeDestino || item.cidade_destino || item.cidade || item.municipioDestino || item.municipio_destino);
  const ufDestino = getUfDestino(item);
  return [origem || 'Origem', cidade || 'Destino', ufDestino].filter(Boolean).join(' > ');
}

function chaveFaixaB2CAnalitica(item = {}) {
  const faixa = getFaixa(item);
  if (!faixa || faixa === 'Sem faixa') return 'Sem faixa';
  return chaveDestinoAnalitico(item) + ' | ' + faixa;
}

function agruparPorUf(simulacao) {
  const porDetalhe = agruparDetalhes(simulacao, getUfDestino);
  const temContagem = porDetalhe.some((item) => n(item.ctesGanhos) || n(item.ctesPerdidos) || n(item.ctesAnalisados));
  if (temContagem) return porDetalhe;

  const resumo = getResumoRodada(simulacao);
  const estados = Array.isArray(resumo.resumoPorEstado) ? resumo.resumoPorEstado : Array.isArray(resumo.estadosGanhadoresDestaque) ? resumo.estadosGanhadoresDestaque : [];
  if (!estados.length) return porDetalhe;
  return finalizarAgrupados(estados.map((item) => {
    const analisados = somarCamposContagem(item, 'total');
    const ganhos = somarCamposContagem(item, 'ganho');
    const perdidos = somarCamposContagem(item, 'perdido') || Math.max(analisados - ganhos, 0);
    return {
      chave: getUfDestino(item),
      rota: getUfDestino(item),
      ufDestino: getUfDestino(item),
      faixa: 'Todas',
      ctesAnalisados: analisados || ganhos + perdidos,
      ctesGanhos: ganhos,
      ctesPerdidos: perdidos,
      volumes: n(item.volumes || item.volumesCapturados || item.qtdVolumes),
      faturamentoPotencial: n(item.faturamentoPotencial || item.freteRealizado || item.valorNF || item.valorPotencial),
      faturamentoCapturado: n(item.faturamentoCapturado || item.freteSelecionadaGanhadora || item.freteCapturado),
      reducaoSoma: n(item.reducaoMediaNecessaria || item.ajusteMedio || item.reducaoMedia) * Math.max(perdidos || analisados || 1, 1),
      reducaoQtd: Math.max(perdidos || analisados || 1, 1),
    };
  }));
}

function agruparPorCotacao(simulacao) {
  return agruparDetalhes(simulacao, chaveCotacaoAnalitica);
}

function agruparPorDestino(simulacao) {
  return agruparDetalhes(simulacao, chaveDestinoAnalitico);
}

function agruparPorFaixaB2C(simulacao) {
  return agruparDetalhes(simulacao, chaveFaixaB2CAnalitica, { somenteFaixaB2C: true });
}`;
util = replaceRange(util, 'function extrairDetalhesResumo(resumo = {}) {', '\n\nfunction compararRotas', blocoAgregacao, 'bloco de visões analíticas');

const oldMontagem = String.raw`  const ufsCriticas = primeira && ultima ? compararGenerico(primeira, ultima, agruparPorUf)
    .filter((u) => n(u.ctesPerdidos) > 0 || n(u.faturamentoNaoCapturado) > 0)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 12) : [];
  const faixasCriticas = primeira && ultima ? compararGenerico(primeira, ultima, (sim) => agruparDetalhes(sim, getFaixa))
    .filter((f) => n(f.ctesPerdidos) > 0 || n(f.faturamentoNaoCapturado) > 0)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 12) : [];`;
const newMontagem = String.raw`  const ufsCriticas = primeira && ultima ? compararGenerico(primeira, ultima, agruparPorUf)
    .filter((u) => n(u.ctesPerdidos) > 0 || n(u.ctesGanhos) > 0 || n(u.ctesAnalisados) > 0 || n(u.faturamentoNaoCapturado) > 0)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 12) : [];
  const cotacoesCriticas = primeira && ultima ? compararGenerico(primeira, ultima, agruparPorCotacao)
    .filter((c) => n(c.ctesPerdidos) > 0 || n(c.faturamentoNaoCapturado) > 0)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 15) : [];
  const destinosCriticos = primeira && ultima ? compararGenerico(primeira, ultima, agruparPorDestino)
    .filter((d) => n(d.ctesPerdidos) > 0 || n(d.faturamentoNaoCapturado) > 0)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 15) : [];
  const faixasCriticas = primeira && ultima ? compararGenerico(primeira, ultima, agruparPorFaixaB2C)
    .filter((f) => f.chave !== 'Sem faixa' && (n(f.ctesPerdidos) > 0 || n(f.faturamentoNaoCapturado) > 0))
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 20) : [];`;
util = replaceOnce(util, oldMontagem, newMontagem, 'monta UF, cotação, destino e faixa B2C');

util = replaceOnce(util, '    ufsCriticas,\n    faixasCriticas,', '    ufsCriticas,\n    cotacoesCriticas,\n    destinosCriticos,\n    faixasCriticas,', 'inclui novas visões no base');
util = replaceOnce(util, '      ondeAjustar: rotasCriticas,\n      recomendacao: recomendacaoTransp,', '      ondeAjustar: rotasCriticas,\n      cotacoesPrioritarias: cotacoesCriticas,\n      destinosPrioritarios: destinosCriticos,\n      recomendacao: recomendacaoTransp,', 'inclui novas visões no transportador');

fs.writeFileSync(utilPath, util, 'utf8');

const compPath = path.join(process.cwd(), 'src/components/laudos/LaudoRodadasNegociacaoTemplate.jsx');
let comp = fs.readFileSync(compPath, 'utf8');
const marker = `        <section className="laudo-rodadas-section">
          <h2>{externo ? 'Onde a proposta melhorou' : 'Rotas/Cotações que evoluíram'}</h2>
          <TabelaMelhorias linhas={(laudo.rotasMelhoraram || laudo.ondeMelhorou || []).slice(0, 10)} />
        </section>`;
const insertion = `${marker}

        <section className="laudo-rodadas-section">
          <h2>Visão por cotação/rota</h2>
          <p>Mostra a competitividade por agrupamento de precificação, como Capital, Interior, região ou cotação da tabela.</p>
          <TabelaRotas linhas={(laudo.cotacoesCriticas || laudo.cotacoesPrioritarias || []).slice(0, 12)} />
        </section>

        <section className="laudo-rodadas-section">
          <h2>Visão por destino/cidade</h2>
          <p>Mostra os destinos específicos onde a proposta ainda perde volume ou faturamento potencial.</p>
          <TabelaRotas linhas={(laudo.destinosCriticos || laudo.destinosPrioritarios || []).slice(0, 12)} />
        </section>`;
if (!comp.includes('Visão por cotação/rota')) {
  comp = replaceOnce(comp, marker, insertion, 'adiciona seções de cotação e destino');
} else {
  console.log('SKIP seções de cotação e destino');
}
comp = replaceOnce(comp, '<TabelaSimples titulo="UFs destino prioritárias"', '<TabelaSimples titulo="Visão por Estado/UF"', 'renomeia visão UF');
comp = replaceOnce(comp, '<TabelaSimples titulo="Faixas de peso prioritárias"', '<TabelaSimples titulo="Faixas B2C por rota/destino"', 'renomeia visão faixa');
fs.writeFileSync(compPath, comp, 'utf8');

console.log(changed ? '4.16E aplicado.' : '4.16E sem alterações.');
