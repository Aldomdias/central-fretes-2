const fs = require('fs');
const path = require('path');
let changed = false;
function save(file, src, old, msg){ if(src !== old){ fs.writeFileSync(file, src, 'utf8'); changed = true; console.log('OK ' + msg); } else console.log('SKIP ' + msg); }
function rep(src, a, b, msg){ if(src.includes(a)){ changed = true; console.log('OK ' + msg); return src.replace(a,b); } if(src.includes(b)){ console.log('SKIP ' + msg); return src; } console.warn('WARN ' + msg); return src; }
function range(src, a, b, novo, msg){ const i=src.indexOf(a); const j=i>=0?src.indexOf(b,i):-1; if(i>=0 && j>i){ changed=true; console.log('OK '+msg); return src.slice(0,i)+novo+'\n\n'+src.slice(j); } console.warn('WARN '+msg); return src; }

const calcFile = path.join(process.cwd(), 'src/utils/calculoFrete.js');
let calc = fs.readFileSync(calcFile, 'utf8');
const calcOld = calc;
if(!calc.includes("rotaCotacao: cotacao?.rota || rota?.nomeRota || ''")){
  calc = rep(calc, '      tipoCalculo: calculo.tipoCalculo,\n', "      tipoCalculo: calculo.tipoCalculo,\n      rotaCotacao: cotacao?.rota || rota?.nomeRota || '',\n      cotacaoComercial: cotacao?.rota || rota?.nomeRota || '',\n", 'rota comercial no calculoFrete');
}
save(calcFile, calc, calcOld, 'calculoFrete');

const simFile = path.join(process.cwd(), 'src/pages/SimuladorPage.jsx');
let sim = fs.readFileSync(simFile, 'utf8');
const simOld = sim;
const novoBloco = `      canal,
      rotaSelecionada: itemSelecionada?.detalhes?.frete?.rotaCotacao || itemSelecionada?.detalhes?.frete?.cotacaoComercial || itemSelecionada?.rotaNome || '',
      rotaCotacao: itemSelecionada?.detalhes?.frete?.rotaCotacao || itemSelecionada?.detalhes?.frete?.cotacaoComercial || itemSelecionada?.rotaNome || '',
      rotaVencedora: vencedor?.detalhes?.frete?.rotaCotacao || vencedor?.detalhes?.frete?.cotacaoComercial || vencedor?.rotaNome || '',
      faixaCotacaoSelecionada: itemSelecionada?.detalhes?.frete?.faixaPeso || '',
      transportadoraReal: row.transportadora || '',`;
sim = rep(sim, `      canal,
      rotaSelecionada: itemSelecionada?.rotaNome || '',
      rotaCotacao: itemSelecionada?.rotaNome || vencedor?.rotaNome || '',
      rotaVencedora: vencedor?.rotaNome || '',
      faixaCotacaoSelecionada: itemSelecionada?.detalhes?.frete?.faixaPeso || '',
      transportadoraReal: row.transportadora || '',`, novoBloco, 'cteDetalhes rota comercial');
sim = rep(sim, `      canal,
      rotaSelecionada: itemSelecionada?.rotaNome || '',
      rotaCotacao: itemSelecionada?.detalhes?.frete?.faixaPeso || itemSelecionada?.detalhes?.frete?.faixa_peso || itemSelecionada?.detalhes?.frete?.faixa || itemSelecionada?.detalhes?.frete?.nomeFaixa || itemSelecionada?.rotaNome || vencedor?.rotaNome || '',
      rotaVencedora: vencedor?.rotaNome || '',
      faixaCotacaoSelecionada: itemSelecionada?.detalhes?.frete?.faixaPeso || itemSelecionada?.detalhes?.frete?.faixa_peso || itemSelecionada?.detalhes?.frete?.faixa || itemSelecionada?.detalhes?.frete?.nomeFaixa || '',
      transportadoraReal: row.transportadora || '',`, novoBloco, 'cteDetalhes remove faixa como rota');
sim = rep(sim, `        rotaNome: r.rotaNome || '',`, `        rotaNome: r.detalhes?.frete?.rotaCotacao || r.detalhes?.frete?.cotacaoComercial || r.rotaNome || '',`, 'todosResultados rota comercial');
save(simFile, sim, simOld, 'SimuladorPage');

const serviceFile = path.join(process.cwd(), 'src/services/tabelasNegociacaoService.js');
let service = fs.readFileSync(serviceFile, 'utf8');
const serviceOld = service;
const novaFuncao = `function cotacaoLaudoServico(item = {}) {
  const rotaResultado = Array.isArray(item.todosResultados)
    ? item.todosResultados.map((r) => r?.detalhes?.frete?.rotaCotacao || r?.detalhes?.frete?.cotacaoComercial || r?.rotaNome).find((v) => texto(v))
    : '';
  const candidatos = [item.rotaCotacao, item.rotaSelecionada, item.rotaVencedora, item.cotacaoComercial, item.selecionadaDetalhes?.frete?.rotaCotacao, item.selecionadaDetalhes?.frete?.cotacaoComercial, item.vencedorDetalhes?.frete?.rotaCotacao, item.vencedorDetalhes?.frete?.cotacaoComercial, rotaResultado, item.cotacao, item.cotacaoFinal, item.faixaCotacao, item.rota, item.nomeRota].map((v) => texto(v)).filter(Boolean);
  const invalida = (v) => {
    const s = String(v || '').toUpperCase().trim();
    if (!s) return true;
    if (s.includes('IBGE')) return true;
    if (/^\\d+[.,]?\\d*\\s*(ATE|ATÉ|A)\\s*\\d+[.,]?\\d*/i.test(s)) return true;
    if (/^ACIMA DE\\s*\\d+/i.test(s)) return true;
    return false;
  };
  const bruto = candidatos.find((v) => !invalida(v)) || texto(item.destino || item.cidadeDestino || 'Destino');
  const partes = bruto.split('|').map((p) => texto(p)).filter(Boolean);
  const base = partes[0] || bruto;
  return base.replace(/ [0-9][0-9.,]* *A *[0-9][0-9.,]* *KG.*$/i, '').trim() || base;
}`;
service = range(service, 'function cotacaoLaudoServico', 'function montarAnaliseFaixasB2CLaudoServico', novaFuncao, 'cotacaoLaudoServico comercial');
service = rep(service, `    analiseFaixasB2C: (resultado.analiseFaixasB2C || montarAnaliseFaixasB2CLaudoServico(resultado)).slice(0, 500),`, `    analiseFaixasB2C: (resultado.analiseFaixasB2C || montarAnaliseFaixasB2CLaudoServico(resultado)).slice(0, 10000),`, 'faixas completas no service');
save(serviceFile, service, serviceOld, 'tabelasNegociacaoService');
console.log(changed ? '4.16W aplicado.' : '4.16W sem alterações.');
