const fs = require('fs');
const path = require('path');

let changed = false;

function apply(file, transform, label) {
  if (!fs.existsSync(file)) {
    console.warn('WARN arquivo nao encontrado: ' + label);
    return;
  }
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

function replaceAll(src, from, to) {
  return src.split(from).join(to);
}

const pagePath = path.join(process.cwd(), 'src/pages/TabelasNegociacaoPage.jsx');
const ctePath = path.join(process.cwd(), 'src/pages/CtePage.jsx');

apply(pagePath, function(src) {
  src = replaceAll(
    src,
    'var lista = rodada.nao_calculados_por_motivo || [];\n                                var total = lista.reduce(function(s, x) { return s + (x.qtd || 0); }, 0);',
    'var lista = Array.isArray(rodada.nao_calculados_por_motivo) ? rodada.nao_calculados_por_motivo : [];\n                                var total = lista.reduce(function(s, x) { return s + (Number((x && x.qtd) || 0)); }, 0);'
  );

  src = replaceAll(
    src,
    "var titulo = lista.map(function(x) { return x.motivo + ': ' + x.qtd; }).join('\\n');",
    "var titulo = lista.map(function(x) { return (x && x.motivo ? x.motivo : '?') + ': ' + ((x && x.qtd) || 0); }).join('\\n');"
  );

  src = replaceAll(
    src,
    'var ind = rodada.indicadores || {};',
    'if (!rodada || typeof rodada !== \'object\') return null;\n                        var ind = rodada.indicadores && typeof rodada.indicadores === \'object\' && !Array.isArray(rodada.indicadores) ? rodada.indicadores : {};'
  );

  src = replaceAll(
    src,
    "var imp = rodada.itens_importados || {};\n                        var salvos = rodada.itens_salvos_apos_importacao || {};",
    "var imp = rodada.itens_importados && typeof rodada.itens_importados === 'object' && !Array.isArray(rodada.itens_importados) ? rodada.itens_importados : {};\n                        var salvos = rodada.itens_salvos_apos_importacao && typeof rodada.itens_salvos_apos_importacao === 'object' && !Array.isArray(rodada.itens_salvos_apos_importacao) ? rodada.itens_salvos_apos_importacao : {};"
  );

  src = replaceAll(
    src,
    "var isSim = rodada.tipo_registro === 'SIMULACAO';",
    "var isSim = rodada.tipo_registro === 'SIMULACAO';\n                        var isAbertura = rodada.tipo_registro === 'NOVA_RODADA';"
  );

  src = replaceAll(
    src,
    "<td>{isSim ? 'SIMULAÇÃO' : 'IMPORTAÇÃO'}</td>",
    "<td>{isSim ? 'SIMULAÇÃO' : isAbertura ? 'ABERTURA' : 'IMPORTAÇÃO'}</td>"
  );

  src = replaceAll(
    src,
    "<tr><th>Rodada</th><th>Tipo</th><th>Data</th><th>Aderência</th><th>Saving mês/ano</th><th>Faturamento mês/ano</th><th>Pedidos/Volumes</th><th>Frete % NF</th><th>Base CT-es</th><th>Não calc.</th><th>Observação</th></tr>",
    "<tr><th>Rodada</th><th>Tipo</th><th>Data</th><th>Aderência</th><th>Saving mês/ano</th><th>Faturamento mês/ano</th><th>Pedidos/Volumes</th><th>Base CT-es</th><th>Não calc.</th><th>Frete % NF</th><th>Observação</th></tr>"
  );

  src = replaceAll(
    src,
    "setAbaNegoc('importacao');\n      setMensagem('Nova rodada aberta. Importe a nova proposta antes de salvar outra simulação.');",
    "setAbaNegoc('rodadas');\n      setMensagem('Nova rodada aberta e registrada no histórico. Importe a nova proposta antes de salvar outra simulação.');"
  );

  src = replaceAll(
    src,
    "!historico.length ? <tr><td colSpan=\"9\">Nenhuma rodada registrada ainda.</td></tr> : null",
    "!historico.length ? <tr><td colSpan=\"11\">Nenhuma rodada registrada ainda.</td></tr> : null"
  );

  if (!src.includes('function TabelaDestinoFaixaPareto')) {
    src = src.replace(
      'export default function TabelasNegociacaoPage() {',
      "function TabelaDestinoFaixaPareto(props) {\n  var fonte = (props && (props.dados || props.linhas || props.itens || props.destinoFaixaPareto || props.data)) || [];\n  var linhas = Array.isArray(fonte) ? fonte : [];\n  if (!linhas.length) return null;\n  return (\n    <div className=\"sim-analise-tabela-wrap\">\n      <table className=\"sim-analise-tabela\">\n        <thead>\n          <tr><th>Destino</th><th>UF</th><th>Faixa</th><th>CT-es</th><th>Volumes</th><th>% Volume</th></tr>\n        </thead>\n        <tbody>\n          {linhas.slice(0, 20).map(function(item, idx) {\n            return (\n              <tr key={(item && (item.chave || item.rota || item.destino)) || idx}>\n                <td>{(item && (item.destino || item.cidade || item.cidadeDestino || item.rota || item.chave)) || '-'}</td>\n                <td>{(item && (item.ufDestino || item.uf_destino || item.uf)) || '-'}</td>\n                <td>{(item && (item.faixa || item.faixaPeso || item.faixa_peso)) || '-'}</td>\n                <td>{(item && (item.ctes || item.qtdCtes || item.quantidade || item.total)) || 0}</td>\n                <td>{(item && (item.volumes || item.volume || item.qtdVolumes)) || 0}</td>\n                <td>{(item && (item.percentual || item.percentualVolume || item.percVolume)) || 0}%</td>\n              </tr>\n            );\n          })}\n        </tbody>\n      </table>\n    </div>\n  );\n}\n\nconst TabelasDestinoFaixaPareto = TabelaDestinoFaixaPareto;\n\nexport default function TabelasNegociacaoPage() {"
    );
  }

  if (!src.includes('function repararHistoricoRodadasLocal')) {
    src = src.replace(
      'function getIndicadoresTabela(tabela) {',
      "function precisaRepararHistoricoRodadas(tabela) {\n  var resumo = getResumoTabela(tabela);\n  var hist = getHistoricoRodadasTabela(tabela);\n  var rodadaAtual = Number(resumo.rodada_atual || tabela?.rodada_atual || 0);\n  return rodadaAtual > 1 && !hist.length;\n}\n\nfunction repararHistoricoRodadasLocal(tabela, setSelecionada, setMensagem) {\n  if (!tabela) return;\n  var resumo = getResumoTabela(tabela);\n  var rodadaAtual = Number(resumo.rodada_atual || tabela.rodada_atual || 1) || 1;\n  var agora = new Date().toISOString();\n  var historico = [{\n    id: 'reparo-' + rodadaAtual + '-' + Date.now(),\n    tipo_registro: 'NOVA_RODADA',\n    rodada: rodadaAtual,\n    criado_em: agora,\n    observacao: 'Histórico reparado automaticamente a partir da rodada atual.',\n    origem_importacao: 'REPARO_HISTORICO',\n  }];\n  var atualizada = Object.assign({}, tabela, {\n    resumo_simulacao: Object.assign({}, resumo, {\n      rodada_atual: rodadaAtual,\n      historico_rodadas: historico,\n      ultima_rodada_aberta: historico[0],\n    }),\n  });\n  setSelecionada(atualizada);\n  setMensagem('Histórico de rodadas reparado na tela. Clique em salvar/importar ou abra uma nova rodada para persistir a sequência.');\n}\n\nfunction getIndicadoresTabela(tabela) {"
    );
  }

  if (!src.includes('precisaRepararHistoricoRodadas(selecionada) ? (')) {
    src = src.replace(
      '<div className="sim-analise-tabela-wrap">',
      "{precisaRepararHistoricoRodadas(selecionada) ? (\n                  <div className=\"sim-alert warn\" style={{ marginBottom: 14 }}>\n                    Histórico vazio com rodada atual maior que 1.\n                    <button className=\"sim-tab\" type=\"button\" style={{ marginLeft: 8 }} onClick={function() { repararHistoricoRodadasLocal(selecionada, setSelecionada, setMensagem); }}>🔧 Reparar histórico</button>\n                  </div>\n                ) : null}\n\n                <div className=\"sim-analise-tabela-wrap\">"
    );
  }

  return src;
}, 'correcoes Rodadas Claude');

apply(ctePath, function(src) {
  src = src.replace(/const ANALISE_MAX_REGISTROS = 5000;\n/g, '');
  src = src.replace(/&& todos\.length < ANALISE_MAX_REGISTROS/g, '');
  src = src.replace(/Math\.min\(inicio \+ ANALISE_BATCH_SIZE - 1, ANALISE_MAX_REGISTROS - 1\)/g, 'inicio + ANALISE_BATCH_SIZE - 1');
  src = src.replace(/setMensagem\(`Carregando CT-es para análise: \$\{todos\.length\.toLocaleString\('pt-BR'\)\} de até \$\{ANALISE_MAX_REGISTROS\.toLocaleString\('pt-BR'\)\}\.\.\.`\);/g, "setMensagem(`Carregando CT-es para análise: ${todos.length.toLocaleString('pt-BR')} CT-es carregados...`);");
  src = src.replace(/if \(todos\.length >= ANALISE_MAX_REGISTROS\) \{[\s\S]*?\n\s*\}/g, '');
  return src;
}, 'remove limite 5000 CTes');

console.log(changed ? '4.16AG correcoes Claude aplicadas.' : '4.16AG sem alterações.');
