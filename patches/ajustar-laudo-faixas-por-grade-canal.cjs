const fs = require('fs');
const path = require('path');
let changed = false;
function repFile(file, a, b, msg) {
  let src = fs.readFileSync(file, 'utf8');
  if (src.includes(a)) {
    src = src.replace(a, b);
    fs.writeFileSync(file, src, 'utf8');
    changed = true;
    console.log('OK ' + msg);
    return;
  }
  if (src.includes(b)) {
    console.log('SKIP ' + msg);
    return;
  }
  console.warn('WARN ' + msg);
}

const simPath = path.join(process.cwd(), 'src/pages/SimuladorPage.jsx');
repFile(simPath,
`        ...resultadoRealizado,
        laudosEmail: laudosEmailRealizado,
        laudos: prepararLaudosNegociacao(resultadoRealizado, contextoLaudos),`,
`        ...resultadoRealizado,
        gradeFaixasLaudo: grade?.[canalRealizado] || grade?.ATACADO || [],
        laudosEmail: laudosEmailRealizado,
        laudos: prepararLaudosNegociacao(resultadoRealizado, contextoLaudos),`,
'envia grade real do canal ao salvar resultado'
);

const servicePath = path.join(process.cwd(), 'src/services/tabelasNegociacaoService.js');
repFile(servicePath,
`function faixaB2CLaudoServico(peso) {
  const p = numero(peso);
  if (!p) return '';
  if (p <= 2) return '0 a 2 kg';
  if (p <= 5) return '2 a 5 kg';
  if (p <= 10) return '5 a 10 kg';
  if (p <= 20) return '10 a 20 kg';
  if (p <= 30) return '20 a 30 kg';
  if (p <= 50) return '30 a 50 kg';
  if (p <= 70) return '50 a 70 kg';
  if (p <= 100) return '70 a 100 kg';
  return 'Acima de 100 kg';
}`,
`function formatarLimiteFaixaServico(valor) {
  const nValor = numero(valor);
  if (Math.abs(nValor - Math.round(nValor)) < 0.0001) return String(Math.round(nValor));
  return String(nValor).replace('.', ',');
}

function gradeFaixasLaudoServico(resultado = {}) {
  const canal = upper(resultado.filtros?.canal || resultado.canal || 'ATACADO');
  const gradeRecebida = Array.isArray(resultado.gradeFaixasLaudo) ? resultado.gradeFaixasLaudo : [];
  const fallbackB2C = [2, 5, 10, 20, 30, 50, 70, 100, 999999999].map((peso) => ({ peso }));
  const fallbackAtacado = [20, 30, 50, 70, 100, 150, 250, 500, 999999999].map((peso) => ({ peso }));
  const base = gradeRecebida.length ? gradeRecebida : (canal.includes('B2C') ? fallbackB2C : fallbackAtacado);
  return base
    .map((item) => ({
      peso: numero(item.peso || item.limite || item.limite_kg || item.peso_final || item.pesoFinal),
      label: texto(item.label || item.faixa || item.faixaPeso || item.faixa_peso),
    }))
    .filter((item) => item.peso > 0)
    .sort((a, b) => a.peso - b.peso);
}

function faixaB2CLaudoServico(peso, resultado = {}) {
  const p = numero(peso);
  if (!p) return '';
  const grade = gradeFaixasLaudoServico(resultado);
  if (!grade.length) return '';
  let anterior = 0;
  for (const item of grade) {
    if (p <= item.peso) {
      if (item.label) return item.label;
      if (item.peso >= 999999 || item.peso === Infinity) return 'Acima de ' + formatarLimiteFaixaServico(anterior) + ' kg';
      return formatarLimiteFaixaServico(anterior) + ' a ' + formatarLimiteFaixaServico(item.peso) + ' kg';
    }
    anterior = item.peso;
  }
  const ultimo = grade[grade.length - 1]?.peso || anterior;
  return 'Acima de ' + formatarLimiteFaixaServico(ultimo) + ' kg';
}`,
'faixa do laudo passa a usar grade real do canal'
);

repFile(servicePath,
`    const faixa = faixaB2CLaudoServico(peso);`,
`    const faixa = faixaB2CLaudoServico(peso, resultado);`,
'calcula faixa usando grade recebida no resultado'
);

const compPath = path.join(process.cwd(), 'src/components/laudos/LaudoRodadasNegociacaoTemplate.jsx');
repFile(compPath,
`<TabelaSimples titulo="Faixas B2C por rota/destino" linhas={(laudo.faixasCriticas || laudo.faixasPrioritarias || []).slice(0, 8)} tipo="faixa" />`,
`<TabelaSimples titulo="Faixas por rota/destino" linhas={(laudo.faixasCriticas || laudo.faixasPrioritarias || []).slice(0, 8)} tipo="faixa" />`,
'renomeia seção de faixas no laudo'
);
repFile(compPath,
`<TabelaSimples titulo="Faixas B2C por rota/destino" linhas={(laudo.faixasCriticas || laudo.faixasPrioritarias || []).slice(0, 12)} tipo="faixa" />`,
`<TabelaSimples titulo="Faixas por rota/destino" linhas={(laudo.faixasCriticas || laudo.faixasPrioritarias || []).slice(0, 12)} tipo="faixa" />`,
'renomeia seção de faixas no laudo com limite 12'
);
repFile(compPath,
`              Base individual de peso não disponível nesta simulação. Para calcular corretamente 0 a 2 kg, 2 a 5 kg, 5 a 10 kg e demais faixas B2C, recalcule/salve a rodada com os CT-es individuais da base pesquisada.`,
`              Base individual de peso não disponível nesta simulação. Para calcular corretamente as faixas da grade do canal, recalcule/salve a rodada com os CT-es individuais da base pesquisada.`,
'ajusta aviso de faixa para grade do canal'
);

console.log(changed ? '4.16H aplicado.' : '4.16H sem alterações.');
