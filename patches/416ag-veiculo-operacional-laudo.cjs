const fs = require('fs');
const path = require('path');

let changed = false;

function save(file, src, old, label) {
  if (src !== old) {
    fs.writeFileSync(file, src, 'utf8');
    changed = true;
    console.log('OK ' + label);
  } else {
    console.log('SKIP ' + label);
  }
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

function insertAfter(src, marker, block, label) {
  if (src.includes(block.trim().split('\n')[0])) return src;
  const idx = src.indexOf(marker);
  if (idx < 0) {
    console.warn('WARN ' + label);
    return src;
  }
  changed = true;
  console.log('OK ' + label);
  return src.slice(0, idx + marker.length) + '\n' + block + src.slice(idx + marker.length);
}

const utilPath = path.join(process.cwd(), 'src/utils/laudosRodadasNegociacaoHtml.js');
let util = fs.readFileSync(utilPath, 'utf8');
const utilOld = util;

const helperVeiculo = `const MARGEM_OPERACIONAL_VEICULO_LAUDO = 0.9;

const VEICULOS_OPERACIONAIS_LAUDO = [
  { tipo: 'Fiorino / utilitário leve', cubagemMin: 3, cubagemRef: 4, pesoMin: 500, pesoRef: 700, uso: 'Coleta pequena, e-commerce, volumes leves' },
  { tipo: 'HR / Kia Bongo / VUC pequeno', cubagemMin: 8, cubagemRef: 12, pesoMin: 1000, pesoRef: 1500, uso: 'Coletas urbanas pequenas/médias' },
  { tipo: 'Van / Sprinter / Master', cubagemMin: 10, cubagemRef: 15, pesoMin: 1200, pesoRef: 1800, uso: 'Fracionado leve, coleta expressa' },
  { tipo: 'VUC / 3/4', cubagemMin: 18, cubagemRef: 25, pesoMin: 2000, pesoRef: 3500, uso: 'Coleta urbana, restrição de cidade, fracionado médio' },
  { tipo: 'Toco', cubagemMin: 35, cubagemRef: 45, pesoMin: 5000, pesoRef: 7000, uso: 'Coletas maiores e transferência curta' },
  { tipo: 'Truck', cubagemMin: 50, cubagemRef: 60, pesoMin: 10000, pesoRef: 14000, uso: 'Coletas grandes, fracionado pesado, filial/CD' },
  { tipo: 'Bitruck', cubagemMin: 60, cubagemRef: 70, pesoMin: 16000, pesoRef: 18000, uso: 'Alto peso com cubagem média' },
  { tipo: 'Carreta simples / sider / baú', cubagemMin: 90, cubagemRef: 100, pesoMin: 24000, pesoRef: 28000, uso: 'Transferência, grandes coletas, lotação' },
  { tipo: 'Carreta LS / Vanderleia', cubagemMin: 95, cubagemRef: 105, pesoMin: 28000, pesoRef: 32000, uso: 'Transferência pesada / lotação' },
  { tipo: 'Rodotrem / Bitrem', cubagemMin: 110, cubagemRef: 140, pesoMin: 38000, pesoRef: 45000, uso: 'Transferência de alto volume/peso' },
];

function diasPeriodoOperacionalLaudo(resumo = {}) {
  const ini = resumo.filtros?.inicio || resumo.inicio || resumo.dataInicio;
  const fim = resumo.filtros?.fim || resumo.fim || resumo.dataFim;
  const dIni = ini ? new Date(ini) : null;
  const dFim = fim ? new Date(fim) : null;
  if (dIni && dFim && !Number.isNaN(dIni.getTime()) && !Number.isNaN(dFim.getTime()) && dFim >= dIni) {
    return Math.max(1, Math.ceil((dFim.getTime() - dIni.getTime()) / 86400000) + 1);
  }
  return 22;
}

function cubagemOperacionalItemLaudo(item = {}) {
  const direta = n(item.cubagem || item.cubagemTotal || item.cubagem_total || item.cubagemAplicada || item.cubagemRealizada);
  if (direta > 0) return direta;
  const unit = n(item.cubagemUnitaria || item.cubagem_unitaria);
  const volumes = n(item.volumes || item.qtdVolumes || item.qtd_volumes) || 1;
  return unit > 0 ? unit * Math.max(volumes, 1) : 0;
}

function pesoOperacionalItemLaudo(item = {}) {
  return n(item.peso || item.pesoRealizado || item.pesoDeclarado || item.peso_declarado || item.pesoCubado || item.peso_cubado || item.pesoConsiderado);
}

function calcularIndicadorVeiculoOperacionalLaudo({ cubagemDia = 0, pesoDia = 0 } = {}) {
  const cubagem = Math.max(0, n(cubagemDia));
  const peso = Math.max(0, n(pesoDia));
  const primeiro = VEICULOS_OPERACIONAIS_LAUDO[0];
  if (!cubagem && !peso) {
    return { semDados: true, cubagemDia: cubagem, pesoDia: peso, veiculo: primeiro, ocupacaoOperacional: 0, qtdVeiculos: 1, fatorLimitante: 'cubagem', alerta: 'Sem cubagem/peso suficiente para sugerir veículo.' };
  }
  const atendeFisico = (v) => cubagem <= v.cubagemRef && peso <= v.pesoRef;
  const atendeOperacional = (v) => cubagem <= v.cubagemRef * MARGEM_OPERACIONAL_VEICULO_LAUDO && peso <= v.pesoRef * MARGEM_OPERACIONAL_VEICULO_LAUDO;
  const veiculoMinimo = VEICULOS_OPERACIONAIS_LAUDO.find(atendeFisico) || VEICULOS_OPERACIONAIS_LAUDO[VEICULOS_OPERACIONAIS_LAUDO.length - 1];
  const veiculoComFolga = VEICULOS_OPERACIONAIS_LAUDO.find(atendeOperacional) || VEICULOS_OPERACIONAIS_LAUDO[VEICULOS_OPERACIONAIS_LAUDO.length - 1];
  const cargaAcimaMaior = !VEICULOS_OPERACIONAIS_LAUDO.some(atendeOperacional);
  const veiculo = cargaAcimaMaior ? VEICULOS_OPERACIONAIS_LAUDO[VEICULOS_OPERACIONAIS_LAUDO.length - 1] : veiculoComFolga;
  const ocupacaoFisica = Math.max(veiculo.cubagemRef ? cubagem / veiculo.cubagemRef : 0, veiculo.pesoRef ? peso / veiculo.pesoRef : 0);
  const qtdVeiculos = Math.max(1, Math.ceil(ocupacaoFisica));
  const ocupacaoCubagem = veiculo.cubagemRef ? cubagem / (veiculo.cubagemRef * MARGEM_OPERACIONAL_VEICULO_LAUDO * qtdVeiculos) : 0;
  const ocupacaoPeso = veiculo.pesoRef ? peso / (veiculo.pesoRef * MARGEM_OPERACIONAL_VEICULO_LAUDO * qtdVeiculos) : 0;
  const ocupacaoOperacional = Math.max(ocupacaoCubagem, ocupacaoPeso);
  const fatorLimitante = ocupacaoCubagem >= ocupacaoPeso ? 'cubagem' : 'peso';
  const minimoNoLimite = veiculoMinimo.tipo !== veiculo.tipo;
  let alerta = 'Capacidade adequada com folga operacional.';
  if (cargaAcimaMaior && qtdVeiculos > 1) alerta = \`Demanda acima de 1 veículo; estimar \${qtdVeiculos} veículo(s)/dia.\`;
  else if (minimoNoLimite) alerta = \`\${veiculoMinimo.tipo} comporta, mas fica acima da folga operacional; recomendado subir para \${veiculo.tipo}.\`;
  else if (ocupacaoOperacional >= 0.9) alerta = 'Ocupação alta; acompanhar peso, cubagem e janela de coleta.';
  return { semDados: false, cubagemDia: cubagem, pesoDia: peso, veiculo, veiculoMinimo, ocupacaoOperacional, qtdVeiculos, fatorLimitante, minimoNoLimite, alerta, margemOperacional: MARGEM_OPERACIONAL_VEICULO_LAUDO };
}

function calcularVeiculoOperacionalLaudo(simulacao = {}) {
  const resumo = getResumoRodada(simulacao);
  const detalhes = extrairDetalhesResumo(resumo);
  const ganhas = detalhes.filter(isGanha);
  const dias = diasPeriodoOperacionalLaudo(resumo);
  const cubagemTotal = ganhas.reduce((acc, item) => acc + cubagemOperacionalItemLaudo(item), 0);
  const pesoTotal = ganhas.reduce((acc, item) => acc + pesoOperacionalItemLaudo(item), 0);
  const indicador = calcularIndicadorVeiculoOperacionalLaudo({ cubagemDia: cubagemTotal / dias, pesoDia: pesoTotal / dias });
  return { ...indicador, cubagemTotal, pesoTotal, diasBase: dias, ctesGanhos: ganhas.length };
}

`;
util = insertBefore(util, 'function classificarRecomendacao', helperVeiculo, 'helpers veiculo operacional');

if (!util.includes('const veiculoOperacional = ultima ? calcularVeiculoOperacionalLaudo(ultima) : null;')) {
  util = util.replace(
    '  const metricasNfAtual = ultima ? calcularMetricasNfRodada(ultima) : {};',
    '  const metricasNfAtual = ultima ? calcularMetricasNfRodada(ultima) : {};\n  const veiculoOperacional = ultima ? calcularVeiculoOperacionalLaudo(ultima) : null;'
  );
}
if (!util.includes('veiculoOperacional,')) {
  util = util.replace('    cidadesParetoVolume,\n', '    cidadesParetoVolume,\n    veiculoOperacional,\n');
}
if (!util.includes("'VEÍCULO SUGERIDO NAS CARGAS GANHAS'")) {
  util = util.replace(
    "    'EVOLUÇÃO DAS RODADAS',",
    "    'VEÍCULO SUGERIDO NAS CARGAS GANHAS',\n    ...(comparativo.atual?.veiculoOperacional && !comparativo.atual.veiculoOperacional.semDados ? [\n      `- ${comparativo.atual.veiculoOperacional.veiculo.tipo}: ${percentual(comparativo.atual.veiculoOperacional.ocupacaoOperacional * 100)} ocupado, limitante ${comparativo.atual.veiculoOperacional.fatorLimitante}. Cubagem/dia ${numero(comparativo.atual.veiculoOperacional.cubagemDia, 2)} m³ e peso/dia ${numero(comparativo.atual.veiculoOperacional.pesoDia, 0)} kg.`\n    ] : ['- Sem cubagem/peso suficiente para sugerir veículo.']),\n    '',\n    'EVOLUÇÃO DAS RODADAS',"
  );
  util = util.replace(
    '  comparativo.atual = { ...(comparativo.atual || {}), ...metricasNfAtual, percentualFreteReal:',
    '  comparativo.atual = { ...(comparativo.atual || {}), ...metricasNfAtual, veiculoOperacional, percentualFreteReal:'
  );
}

save(utilPath, util, utilOld, 'utils veiculo operacional');

const compPath = path.join(process.cwd(), 'src/components/laudos/LaudoRodadasNegociacaoTemplate.jsx');
let comp = fs.readFileSync(compPath, 'utf8');
const compOld = comp;

const helperTemplate = `function numeroOperacional(valor, casas = 1) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

function VeiculoOcupacaoIlustracaoLaudo({ ocupacaoPercentual = 0 }) {
  const fill = Math.max(0, Math.min(100, ocupacaoPercentual));
  const fillColor = fill >= 90 ? '#fb923c' : fill >= 70 ? '#34d399' : '#60a5fa';
  return (
    <svg viewBox="0 0 220 88" role="img" aria-label="Ocupação estimada do veículo" style={{ width: '100%', maxWidth: 190 }}>
      <rect x="18" y="28" width="92" height="34" rx="8" fill="#eff6ff" stroke="#bfdbfe" strokeWidth="2" />
      <rect x="20" y="30" width={Math.max(0, 88 * (fill / 100))} height="30" rx="6" fill={fillColor} opacity="0.9" />
      <path d="M110 38h22l18 16v8h-40V38Z" fill="#e0f2fe" stroke="#bfdbfe" strokeWidth="2" />
      <path d="M123 41h8l11 10h-19V41Z" fill="#f8fafc" stroke="#bfdbfe" strokeWidth="1.5" />
      <circle cx="40" cy="68" r="9" fill="#0f172a" />
      <circle cx="40" cy="68" r="4" fill="#f8fafc" />
      <circle cx="116" cy="68" r="9" fill="#0f172a" />
      <circle cx="116" cy="68" r="4" fill="#f8fafc" />
      <line x1="18" y1="66" x2="150" y2="66" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function VeiculoOperacionalLaudoCard({ dados }) {
  if (!dados || dados.semDados) return null;
  const ocupacaoPercentual = Number(dados.ocupacaoOperacional || 0) * 100;
  const badgeBg = dados.ocupacaoOperacional >= 0.9 ? '#fff7ed' : dados.ocupacaoOperacional >= 0.7 ? '#ecfdf5' : '#eff6ff';
  const badgeColor = dados.ocupacaoOperacional >= 0.9 ? '#c2410c' : dados.ocupacaoOperacional >= 0.7 ? '#047857' : '#1d4ed8';
  const faixaCubagem = numeroOperacional(dados.veiculo?.cubagemMin, 0) + ' a ' + numeroOperacional(dados.veiculo?.cubagemRef, 0) + ' m³';
  const faixaPeso = numeroOperacional(dados.veiculo?.pesoMin, 0) + ' a ' + numeroOperacional(dados.veiculo?.pesoRef, 0) + ' kg';
  return (
    <section className="laudo-rodadas-section">
      <h2>Veículo sugerido nas cargas ganhas</h2>
      <div className="laudo-rodadas-kpi" style={{ alignItems: 'stretch', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
          <div>
            <span>Veículo sugerido</span>
            <strong style={{ fontSize: '1rem', lineHeight: 1.15 }}>{dados.veiculo?.tipo}</strong>
          </div>
          <div style={{ padding: '4px 8px', borderRadius: 999, background: badgeBg, color: badgeColor, fontSize: '0.72rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
            {percentual(ocupacaoPercentual)} ocupado
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '170px minmax(0, 1fr)', gap: 12, alignItems: 'center' }}>
          <VeiculoOcupacaoIlustracaoLaudo ocupacaoPercentual={ocupacaoPercentual} />
          <small style={{ display: 'grid', gap: 4 }}>
            <span>Cubagem/dia: <strong>{numeroOperacional(dados.cubagemDia, 2)} m³</strong></span>
            <span>Peso/dia: <strong>{numeroOperacional(dados.pesoDia, 0)} kg</strong></span>
            <span>Referência: <strong>{faixaCubagem} • {faixaPeso}</strong></span>
            {dados.qtdVeiculos > 1 ? <span>Necessidade: <strong>{dados.qtdVeiculos} veículo(s)/dia</strong></span> : null}
            <span>Limitante: <strong>{dados.fatorLimitante === 'peso' ? 'peso' : 'cubagem'}</strong></span>
          </small>
        </div>
        <small style={{ color: badgeColor }}>{dados.alerta}{dados.minimoNoLimite ? ' Menor veículo físico: ' + dados.veiculoMinimo?.tipo + '.' : ''}</small>
        <small>Uso comum: {dados.veiculo?.uso}</small>
      </div>
    </section>
  );
}

`;
comp = insertBefore(comp, 'function prioridadeClasse', helperTemplate, 'componentes veiculo operacional');

if (!comp.includes('<VeiculoOperacionalLaudoCard dados={laudo.veiculoOperacional || atual.veiculoOperacional} />')) {
  comp = comp.replace(
    '        <section className="laudo-rodadas-section">\n          <h2>{poucaBase ?',
    '        <VeiculoOperacionalLaudoCard dados={laudo.veiculoOperacional || atual.veiculoOperacional} />\n\n        <section className="laudo-rodadas-section">\n          <h2>{poucaBase ?'
  );
}

if (!comp.includes('Veiculo_Tipo: atual.veiculoOperacional?.veiculo?.tipo || laudo.veiculoOperacional?.veiculo?.tipo ||')) {
  comp = comp.replace(
    '    Reducao_Media_Atual: atual.reducaoMedia || 0,\n',
    "    Reducao_Media_Atual: atual.reducaoMedia || 0,\n    Veiculo_Tipo: atual.veiculoOperacional?.veiculo?.tipo || laudo.veiculoOperacional?.veiculo?.tipo || '',\n    Veiculo_Ocupacao: atual.veiculoOperacional?.ocupacaoOperacional || laudo.veiculoOperacional?.ocupacaoOperacional || 0,\n    Veiculo_Cubagem_Dia: atual.veiculoOperacional?.cubagemDia || laudo.veiculoOperacional?.cubagemDia || 0,\n    Veiculo_Peso_Dia: atual.veiculoOperacional?.pesoDia || laudo.veiculoOperacional?.pesoDia || 0,\n"
  );
}

save(compPath, comp, compOld, 'template veiculo operacional');

console.log(changed ? '4.16AG aplicado.' : '4.16AG sem alterações.');
