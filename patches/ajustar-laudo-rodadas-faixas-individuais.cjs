const fs = require('fs');
const path = require('path');

let changed = false;
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
function insertBefore(src, marker, block, label) {
  if (src.includes(block.trim().split('\n')[0])) {
    console.log('SKIP ' + label);
    return src;
  }
  const idx = src.indexOf(marker);
  if (idx >= 0) {
    changed = true;
    console.log('OK ' + label);
    return src.slice(0, idx) + block + '\n' + src.slice(idx);
  }
  console.warn('WARN ' + label);
  return src;
}

const utilPath = path.join(process.cwd(), 'src/utils/laudosRodadasNegociacaoHtml.js');
let util = fs.readFileSync(utilPath, 'utf8');

const helpers = `function itemTemIdentificadorOperacional(item = {}) {
  return Boolean(
    item.numeroCte || item.numeroCTe || item.cte || item.chaveCte || item.chave_cte || item.chave_cte_ref ||
    item.numeroNF || item.notaFiscal || item.nf || item.chaveNf || item.chave_nf || item.pedido || item.numeroPedido ||
    item.idCte || item.id_cte || item.idTracking || item.tracking_id
  );
}

function itemTemFaixaB2CConfiavel(item = {}) {
  const faixa = normalizarFaixaB2C(item.faixaPeso || item.faixa_peso || item.faixa || item.pesoFaixa || item.faixa_peso_padrao);
  return Boolean(faixa);
}

function itemPareceLinhaAgregada(item = {}) {
  const qtd = n(item.ctes || item.qtd || item.qtdCtes || item.qtdAnalisados || item.qtdGanhasSelecionada || item.qtdPerdidasSelecionada || item.ctesGanhos || item.ctesPerdidos);
  if (qtd > 1 && !itemTemFaixaB2CConfiavel(item)) return true;
  if ((item.rota || item.nomeRota || item.cotacao || item.cotacaoFinal) && qtd > 1 && !itemTemFaixaB2CConfiavel(item)) return true;
  return false;
}

function itemValidoParaFaixaB2C(item = {}) {
  if (!item || typeof item !== 'object') return false;
  if (itemTemFaixaB2CConfiavel(item)) return true;
  if (itemPareceLinhaAgregada(item)) return false;
  return itemTemIdentificadorOperacional(item) && pesoIndividualCte(item) > 0;
}
`;
util = insertBefore(util, 'function getFaixa(item = {}) {', helpers, 'helpers de faixa individual');

const oldExtrairFaixa = `function extrairDetalhesFaixaB2C(resumo = {}) {
  const candidatos = [resumo.ctesDetalhes, resumo.detalhes, resumo.linhasDetalhe];
  return candidatos
    .reduce((acc, lista) => Array.isArray(lista) ? acc.concat(lista) : acc, [])
    .filter((item) => getFaixa(item) !== 'Sem faixa');
}`;
const newExtrairFaixa = `function extrairDetalhesFaixaB2C(resumo = {}) {
  const candidatos = [resumo.ctesDetalhes, resumo.detalhes, resumo.linhasDetalhe];
  return candidatos
    .reduce((acc, lista) => Array.isArray(lista) ? acc.concat(lista) : acc, [])
    .filter(itemValidoParaFaixaB2C)
    .filter((item) => getFaixa(item) !== 'Sem faixa');
}`;
util = replaceOnce(util, oldExtrairFaixa, newExtrairFaixa, 'filtra faixa apenas com base individual/confiável');

const oldRotasCriticas = `  const rotasCriticas = rotasComparadas
    .filter((r) => n(r.ctesPerdidos) > 0 || n(r.faturamentoNaoCapturado) > 0 || n(r.ajusteMedio) > 0)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos) || n(b.ajusteMedio) - n(a.ajusteMedio))
    .slice(0, 20);`;
const newRotasCriticas = `  const rotasCriticas = rotasComparadas
    .map((r) => ({ ...r, faixa: 'Todas as faixas' }))
    .filter((r) => n(r.ctesPerdidos) > 0 || n(r.faturamentoNaoCapturado) > 0 || n(r.ajusteMedio) > 0)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos) || n(b.ajusteMedio) - n(a.ajusteMedio))
    .slice(0, 20);`;
util = replaceOnce(util, oldRotasCriticas, newRotasCriticas, 'rotas críticas não recebem faixa falsa');

const oldCotacoes = `  const cotacoesCriticas = primeira && ultima ? compararGenerico(primeira, ultima, agruparPorCotacao)
    .filter((c) => n(c.ctesPerdidos) > 0 || n(c.faturamentoNaoCapturado) > 0)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 15) : [];`;
const newCotacoes = `  const cotacoesCriticas = primeira && ultima ? compararGenerico(primeira, ultima, agruparPorCotacao)
    .map((c) => ({ ...c, faixa: 'Todas as faixas' }))
    .filter((c) => n(c.ctesPerdidos) > 0 || n(c.faturamentoNaoCapturado) > 0)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 15) : [];`;
util = replaceOnce(util, oldCotacoes, newCotacoes, 'cotação não recebe faixa falsa');

const oldDestinos = `  const destinosCriticos = primeira && ultima ? compararGenerico(primeira, ultima, agruparPorDestino)
    .filter((d) => n(d.ctesPerdidos) > 0 || n(d.faturamentoNaoCapturado) > 0)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 15) : [];`;
const newDestinos = `  const destinosCriticos = primeira && ultima ? compararGenerico(primeira, ultima, agruparPorDestino)
    .map((d) => ({ ...d, faixa: 'Todas as faixas' }))
    .filter((d) => n(d.ctesPerdidos) > 0 || n(d.faturamentoNaoCapturado) > 0)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 15) : [];`;
util = replaceOnce(util, oldDestinos, newDestinos, 'destino não recebe faixa falsa');

fs.writeFileSync(utilPath, util, 'utf8');

const compPath = path.join(process.cwd(), 'src/components/laudos/LaudoRodadasNegociacaoTemplate.jsx');
let comp = fs.readFileSync(compPath, 'utf8');

const oldFaixaSection = `<TabelaSimples titulo="Faixas B2C por rota/destino" linhas={(laudo.faixasCriticas || laudo.faixasPrioritarias || []).slice(0, 8)} tipo="faixa" />`;
const newFaixaSection = `{(laudo.faixasCriticas || laudo.faixasPrioritarias || []).length ? (
          <TabelaSimples titulo="Faixas B2C por rota/destino" linhas={(laudo.faixasCriticas || laudo.faixasPrioritarias || []).slice(0, 12)} tipo="faixa" />
        ) : (
          <section className="laudo-rodadas-section">
            <h2>Faixas B2C por rota/destino</h2>
            <div className="laudo-rodadas-alert warn">
              Base individual de peso não disponível nesta simulação. Para calcular corretamente 0 a 2 kg, 2 a 5 kg, 5 a 10 kg e demais faixas B2C, recalcule/salve a rodada com os CT-es individuais da base pesquisada.
            </div>
          </section>
        )}`;
comp = replaceOnce(comp, oldFaixaSection, newFaixaSection, 'aviso quando não há base individual para faixa');

fs.writeFileSync(compPath, comp, 'utf8');
console.log(changed ? '4.16F aplicado.' : '4.16F sem alterações.');
