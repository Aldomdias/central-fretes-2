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

const utilPath = path.join(process.cwd(), 'src/utils/laudosRodadasNegociacaoHtml.js');
let util = fs.readFileSync(utilPath, 'utf8');

const pontoChaveFaixa = `function isGanha(item = {}) {`;
const novaFuncaoChaveFaixa = `function chaveFaixaRota(item = {}) {
  const faixa = getFaixa(item);
  if (!faixa || faixa === 'Sem faixa') return 'Sem faixa';
  const origem = texto(item.origem || item.cidadeOrigem || item.cidade_origem || item.ufOrigem || item.uf_origem);
  const destino = texto(item.destino || item.cidadeDestino || item.cidade_destino || item.ufDestino || item.uf_destino);
  const ufDestino = getUfDestino(item);
  const rota = texto(item.rota || item.nomeRota || item.cotacao || item.cotacaoFinal || item.faixaCotacao || item.regiao || item.nome);
  const baseRota = [origem || 'Origem', destino || ufDestino || 'Destino', rota].filter(Boolean).join(' > ');
  return baseRota + ' | ' + faixa;
}

function isGanha(item = {}) {`;
if (!util.includes('function chaveFaixaRota(item = {})')) {
  util = trocar(util, pontoChaveFaixa, novaFuncaoChaveFaixa, 'adiciona chave rota + faixa');
} else {
  console.log('SKIP chave rota + faixa já existe');
}

const faixaAntiga = `  const faixasCriticas = primeira && ultima ? compararGenerico(primeira, ultima, (sim) => agruparDetalhes(sim, getFaixa, { somenteFaixaIndividual: true }))
    .filter((f) => f.chave !== 'Sem faixa' && (n(f.ctesPerdidos) > 0 || n(f.faturamentoNaoCapturado) > 0))
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 12) : [];`;
const faixaNova = `  const faixasCriticas = primeira && ultima ? compararGenerico(primeira, ultima, (sim) => agruparDetalhes(sim, chaveFaixaRota, { somenteFaixaIndividual: true }))
    .filter((f) => f.chave !== 'Sem faixa' && (n(f.ctesPerdidos) > 0 || n(f.faturamentoNaoCapturado) > 0))
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 20) : [];`;
util = trocar(util, faixaAntiga, faixaNova, 'agrupa faixa por rota/cotação + faixa');

const relatorioFaixaAntigo1 = "`- ${f.faixa || f.rota}: ${numero(f.ctesPerdidos)} CT-es perdidos, ${dinheiro(f.faturamentoNaoCapturado)} não capturado, ajuste médio ${percentual(f.ajusteMedio)}.`";
const relatorioFaixaNovo1 = "`- ${[f.rota, f.faixa].filter(Boolean).join(' / ') || f.chave}: ${numero(f.ctesPerdidos)} CT-es perdidos, ${dinheiro(f.faturamentoNaoCapturado)} não capturado, ajuste médio ${percentual(f.ajusteMedio)}.`";
util = trocar(util, relatorioFaixaAntigo1, relatorioFaixaNovo1, 'relatório diretoria mostra rota + faixa');

const relatorioFaixaAntigo2 = "`- ${f.faixa || f.rota}: ${numero(f.ctesPerdidos)} CT-es com oportunidade, ajuste médio ${percentual(f.ajusteMedio)}.`";
const relatorioFaixaNovo2 = "`- ${[f.rota, f.faixa].filter(Boolean).join(' / ') || f.chave}: ${numero(f.ctesPerdidos)} CT-es com oportunidade, ajuste médio ${percentual(f.ajusteMedio)}.`";
util = trocar(util, relatorioFaixaAntigo2, relatorioFaixaNovo2, 'relatório transportador mostra rota + faixa');

fs.writeFileSync(utilPath, util, 'utf8');

const compPath = path.join(process.cwd(), 'src/components/laudos/LaudoRodadasNegociacaoTemplate.jsx');
let comp = fs.readFileSync(compPath, 'utf8');
const celulaAntiga = `<td><strong>{tipo === 'faixa' ? (item.faixa || item.rota || item.chave) : (item.ufDestino || item.rota || item.chave)}</strong></td>`;
const celulaNova = `<td>{tipo === 'faixa' ? (
                  <>
                    <strong>{item.rota || item.chave || '-'}</strong>
                    <div style={{ color: '#64748b', fontSize: 11 }}>{item.faixa || '-'}</div>
                    {item.origem || item.destino ? <div style={{ color: '#94a3b8', fontSize: 11 }}>{[item.origem, item.destino].filter(Boolean).join(' > ')}</div> : null}
                  </>
                ) : (
                  <strong>{item.ufDestino || item.rota || item.chave}</strong>
                )}</td>`;
comp = trocar(comp, celulaAntiga, celulaNova, 'tabela de faixas mostra rota/cotação + faixa');
fs.writeFileSync(compPath, comp, 'utf8');

if (alterou) console.log('4.16B ajustado: faixas agora são por rota/cotação + faixa.');
else console.log('4.16B faixa por rota sem alterações.');
