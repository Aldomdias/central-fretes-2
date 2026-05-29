const fs = require('fs');
const path = require('path');

const root = process.cwd();
const pagePath = path.join(root, 'src/pages/TabelasNegociacaoPage.jsx');
const servicePath = path.join(root, 'src/services/tabelasNegociacaoService.js');

function read(file) {
  if (!fs.existsSync(file)) throw new Error(`Arquivo não encontrado: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

function write(file, content) {
  fs.writeFileSync(file, content, 'utf8');
}

function replaceOnce(content, from, to, label) {
  if (content.includes(to)) {
    console.log(`OK - ${label} já aplicado.`);
    return content;
  }
  if (!content.includes(from)) {
    throw new Error(`Não encontrei o trecho para aplicar: ${label}`);
  }
  console.log(`Aplicando: ${label}`);
  return content.replace(from, to);
}

function patchPage() {
  let content = read(pagePath);

  content = replaceOnce(
    content,
`function getHistoricoRodadasTabela(tabela) {
  var resumo = getResumoTabela(tabela);
  if (Array.isArray(resumo.historico_rodadas)) return resumo.historico_rodadas;
  if (Array.isArray(resumo.rodadas)) return resumo.rodadas;
  return [];
}
function getRodadaAtualTabela(tabela) {
  var resumo = getResumoTabela(tabela);
  var hist = getHistoricoRodadasTabela(tabela);
  return Number(resumo.rodada_atual || (hist.length ? hist[hist.length - 1].rodada : 1) || 1);
}`,
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
  var rodadaResumo = Number(resumo.rodada_atual || tabela?.rodada_atual || 0);
  var rodada = Math.max(Number.isFinite(rodadaResumo) ? rodadaResumo : 0, maxHist, 1);
  return rodada;
}`,
    'normalização segura do histórico de rodadas na tela'
  );

  content = replaceOnce(
    content,
`            var historico = getHistoricoRodadasTabela(selecionada).slice().reverse();
            var simulacoes = historico.filter(function(r) { return r.tipo_registro === 'SIMULACAO'; });`,
`            var historico = getHistoricoRodadasTabela(selecionada).slice().reverse();
            var simulacoes = historico.filter(function(r) { return r && r.tipo_registro === 'SIMULACAO'; });`,
    'proteção do filtro de simulações'
  );

  content = replaceOnce(
    content,
`                                var lista = rodada.nao_calculados_por_motivo || [];
                                var total = lista.reduce(function(s, x) { return s + (x.qtd || 0); }, 0);`,
`                                var lista = Array.isArray(rodada.nao_calculados_por_motivo) ? rodada.nao_calculados_por_motivo : [];
                                var total = lista.reduce(function(s, x) { return s + (Number(x && x.qtd || 0)); }, 0);`,
    'correção do reduce em nao_calculados_por_motivo'
  );

  content = replaceOnce(
    content,
`                      {!historico.length ? <tr><td colSpan="9">Nenhuma rodada registrada ainda.</td></tr> : null}`,
`                      {!historico.length ? <tr><td colSpan="11">Nenhuma rodada registrada ainda.</td></tr> : null}`,
    'colSpan correto da tabela de rodadas'
  );

  write(pagePath, content);
}

function patchService() {
  let content = read(servicePath);

  content = replaceOnce(
    content,
`function getHistoricoRodadas(tabela = {}) {
  const resumo = getResumoSimulacaoSeguro(tabela);
  if (Array.isArray(resumo.historico_rodadas)) return resumo.historico_rodadas;
  if (Array.isArray(resumo.rodadas)) return resumo.rodadas;
  return [];
}

function calcularProximaRodada(tabela = {}, deveAbrirNovaRodada = false) {
  const resumo = getResumoSimulacaoSeguro(tabela);
  const rodadaAtual = inteiro(resumo.rodada_atual || tabela.rodada_atual || 1) || 1;
  return deveAbrirNovaRodada ? rodadaAtual + 1 : rodadaAtual;
}`,
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
        id: item.id || item.criado_em || `rodada-${idx}`,
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
  const maiorHistorico = historico.reduce((max, item) => {
    const rodada = inteiro(item.rodada || 0);
    return rodada > max ? rodada : max;
  }, 0);
  const rodadaResumo = inteiro(resumo.rodada_atual || tabela.rodada_atual || 0);
  const rodadaUltimaImportacao = inteiro(resumo.ultima_importacao?.rodada || 0);
  const rodadaUltimaSimulacao = inteiro(resumo.ultima_simulacao?.rodada || resumo.ultima_simulacao?.indicadores?.rodada || 0);
  const rodadaUltimaAberta = inteiro(resumo.ultima_rodada_aberta?.rodada || 0);
  return Math.max(maiorHistorico, rodadaResumo, rodadaUltimaImportacao, rodadaUltimaSimulacao, rodadaUltimaAberta, 1);
}

function calcularProximaRodada(tabela = {}, deveAbrirNovaRodada = false) {
  const rodadaAtual = getMaiorRodadaRegistrada(tabela);
  return deveAbrirNovaRodada ? rodadaAtual + 1 : rodadaAtual;
}`,
    'normalização e cálculo seguro de próxima rodada no service'
  );

  content = replaceOnce(
    content,
`  const resumoAnterior = getResumoSimulacaoSeguro(tabelaAtual);
  const historicoAnterior = getHistoricoRodadas(tabelaAtual);
  const rodadaAtual = inteiro(resumoAnterior.rodada_atual || tabelaAtual.rodada_atual || 1) || 1;
  const proximaRodada = rodadaAtual + 1;
  const agora = dataISO();`,
`  const resumoAnterior = getResumoSimulacaoSeguro(tabelaAtual);
  const historicoAnterior = getHistoricoRodadas(tabelaAtual);
  const rodadaAtual = getMaiorRodadaRegistrada(tabelaAtual);
  const proximaRodada = rodadaAtual + 1;
  const agora = dataISO();`,
    'abrir nova rodada usando maior rodada registrada'
  );

  write(servicePath, content);
}

patchPage();
patchService();
console.log('Patch 4.16AF rodadas aplicado com sucesso.');
