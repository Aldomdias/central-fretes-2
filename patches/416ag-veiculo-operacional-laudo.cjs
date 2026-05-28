const fs = require('fs');
const path = require('path');

let changed = false;

function apply(file, transform, label) {
  const before = fs.readFileSync(file, 'utf8');
  const after = transform(before);
  if (after !== before) {
    fs.writeFileSync(file, after, 'utf8');
    changed = true;
    console.log('OK ' + label);
  } else {
    console.log('SKIP ' + label);
  }
}

const pagePath = path.join(process.cwd(), 'src/pages/TabelasNegociacaoPage.jsx');
const servicePath = path.join(process.cwd(), 'src/services/tabelasNegociacaoService.js');

apply(pagePath, function(src) {
  src = src.replace(
/function getHistoricoRodadasTabela\(tabela\) \{[\s\S]*?\n\}\nfunction getRodadaAtualTabela\(tabela\) \{[\s\S]*?\n\}/,
`function getHistoricoRodadasTabela(tabela) {
  var resumo = getResumoTabela(tabela);
  var fonte = [];
  if (Array.isArray(resumo.historico_rodadas)) fonte = resumo.historico_rodadas;
  else if (Array.isArray(resumo.rodadas)) fonte = resumo.rodadas;
  return fonte
    .filter(function(item) { return item && typeof item === 'object'; })
    .map(function(item, idx) {
      var rodadaNumero = Number(item.rodada || item.numero_rodada || item.rodada_atual || 0);
      return Object.assign({}, item, {
        id: item.id || item.criado_em || ('rodada-' + idx),
        tipo_registro: item.tipo_registro || item.tipo || 'REGISTRO',
        rodada: Number.isFinite(rodadaNumero) && rodadaNumero > 0 ? rodadaNumero : idx + 1,
        indicadores: item.indicadores && typeof item.indicadores === 'object' && !Array.isArray(item.indicadores) ? item.indicadores : {},
        itens_importados: item.itens_importados && typeof item.itens_importados === 'object' && !Array.isArray(item.itens_importados) ? item.itens_importados : {},
        itens_salvos_apos_importacao: item.itens_salvos_apos_importacao && typeof item.itens_salvos_apos_importacao === 'object' && !Array.isArray(item.itens_salvos_apos_importacao) ? item.itens_salvos_apos_importacao : {},
        nao_calculados_por_motivo: Array.isArray(item.nao_calculados_por_motivo) ? item.nao_calculados_por_motivo : [],
        base: item.base && typeof item.base === 'object' && !Array.isArray(item.base) ? item.base : {},
        divergencia_base: item.divergencia_base && typeof item.divergencia_base === 'object' && !Array.isArray(item.divergencia_base) ? item.divergencia_base : null,
      });
    })
    .sort(function(a, b) {
      var ra = Number(a.rodada || 0);
      var rb = Number(b.rodada || 0);
      if (ra !== rb) return ra - rb;
      return new Date(a.criado_em || 0).getTime() - new Date(b.criado_em || 0).getTime();
    });
}
function getRodadaAtualTabela(tabela) {
  var resumo = getResumoTabela(tabela);
  var hist = getHistoricoRodadasTabela(tabela);
  var maxHist = hist.reduce(function(max, item) {
    var r = Number(item && item.rodada || 0);
    return Number.isFinite(r) && r > max ? r : max;
  }, 0);
  var rodadaResumo = Number(resumo.rodada_atual || (tabela && tabela.rodada_atual) || 0);
  return Math.max(Number.isFinite(rodadaResumo) ? rodadaResumo : 0, maxHist, 1);
}`
  );

  src = src.replace(
    /var simulacoes = historico\.filter\(function\(r\) \{ return r\.tipo_registro === 'SIMULACAO'; \}\);/g,
    "var simulacoes = historico.filter(function(r) { return r && r.tipo_registro === 'SIMULACAO'; });"
  );

  src = src.replace(
    /var lista = rodada\.nao_calculados_por_motivo \|\| \[\];\s*\n\s*var total = lista\.reduce\(function\(s, x\) \{ return s \+ \(x\.qtd \|\| 0\); \}, 0\);/g,
    "var lista = Array.isArray(rodada.nao_calculados_por_motivo) ? rodada.nao_calculados_por_motivo : [];\n                                var total = lista.reduce(function(s, x) { return s + Number(x && x.qtd || 0); }, 0);"
  );

  src = src.replace(
    /!historico\.length \? <tr><td colSpan="9">Nenhuma rodada registrada ainda\.<\/td><\/tr> : null/g,
    '!historico.length ? <tr><td colSpan="11">Nenhuma rodada registrada ainda.</td></tr> : null'
  );

  return src;
}, 'aba Rodadas segura');

apply(servicePath, function(src) {
  src = src.replace(
/function getHistoricoRodadas\(tabela = \{\}\) \{[\s\S]*?\n\}\n\nfunction calcularProximaRodada\(tabela = \{\}, deveAbrirNovaRodada = false\) \{[\s\S]*?\n\}/,
`function getHistoricoRodadas(tabela = {}) {
  const resumo = getResumoSimulacaoSeguro(tabela);
  const fonte = Array.isArray(resumo.historico_rodadas)
    ? resumo.historico_rodadas
    : Array.isArray(resumo.rodadas)
      ? resumo.rodadas
      : [];
  return fonte
    .filter((item) => item && typeof item === 'object')
    .map((item, idx) => {
      const rodadaNumero = inteiro(item.rodada || item.numero_rodada || item.rodada_atual || 0);
      return {
        ...item,
        id: item.id || item.criado_em || 'rodada-' + idx,
        tipo_registro: item.tipo_registro || item.tipo || 'REGISTRO',
        rodada: rodadaNumero || idx + 1,
        indicadores: item.indicadores && typeof item.indicadores === 'object' && !Array.isArray(item.indicadores) ? item.indicadores : {},
        itens_importados: item.itens_importados && typeof item.itens_importados === 'object' && !Array.isArray(item.itens_importados) ? item.itens_importados : {},
        itens_salvos_apos_importacao: item.itens_salvos_apos_importacao && typeof item.itens_salvos_apos_importacao === 'object' && !Array.isArray(item.itens_salvos_apos_importacao) ? item.itens_salvos_apos_importacao : {},
        nao_calculados_por_motivo: Array.isArray(item.nao_calculados_por_motivo) ? item.nao_calculados_por_motivo : [],
      };
    })
    .sort((a, b) => {
      const ra = inteiro(a.rodada || 0);
      const rb = inteiro(b.rodada || 0);
      if (ra !== rb) return ra - rb;
      return new Date(a.criado_em || 0).getTime() - new Date(b.criado_em || 0).getTime();
    });
}

function getMaiorRodadaRegistrada(tabela = {}) {
  const resumo = getResumoSimulacaoSeguro(tabela);
  const historico = getHistoricoRodadas(tabela);
  const maiorHistorico = historico.reduce((max, item) => Math.max(max, inteiro(item.rodada || 0)), 0);
  const rodadaResumo = inteiro(resumo.rodada_atual || tabela.rodada_atual || 0);
  const rodadaUltimaImportacao = inteiro(resumo.ultima_importacao && resumo.ultima_importacao.rodada || 0);
  const rodadaUltimaSimulacao = inteiro(resumo.ultima_simulacao && (resumo.ultima_simulacao.rodada || (resumo.ultima_simulacao.indicadores && resumo.ultima_simulacao.indicadores.rodada)) || 0);
  const rodadaUltimaAberta = inteiro(resumo.ultima_rodada_aberta && resumo.ultima_rodada_aberta.rodada || 0);
  return Math.max(maiorHistorico, rodadaResumo, rodadaUltimaImportacao, rodadaUltimaSimulacao, rodadaUltimaAberta, 1);
}

function calcularProximaRodada(tabela = {}, deveAbrirNovaRodada = false) {
  const rodadaAtual = getMaiorRodadaRegistrada(tabela);
  return deveAbrirNovaRodada ? rodadaAtual + 1 : rodadaAtual;
}`
  );

  src = src.replace(
    /const rodadaAtual = inteiro\(resumoAnterior\.rodada_atual \|\| tabelaAtual\.rodada_atual \|\| 1\) \|\| 1;\s*\n\s*const proximaRodada = rodadaAtual \+ 1;/g,
    'const rodadaAtual = getMaiorRodadaRegistrada(tabelaAtual);\n  const proximaRodada = rodadaAtual + 1;'
  );

  return src;
}, 'service nova rodada segura');

console.log(changed ? '4.16AG emergencial aplicado.' : '4.16AG emergencial sem alterações.');
