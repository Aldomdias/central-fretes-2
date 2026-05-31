const fs = require('fs');
const arquivo = 'src/pages/TabelasNegociacaoPage.jsx';
let c = fs.readFileSync(arquivo, 'utf8');

const antiga = 'var historico = getHistoricoRodadasTabela(selecionada);\n    var registrosDaRodada = historico.filter(function(item) {\n      return Number(item.rodada || 0) === numeroRodada;\n    });\n\n    if (!registrosDaRodada.length) {\n      setErro(\'Nenhum registro encontrado para esta rodada.\');\n      return;\n    }\n\n    if (!window.confirm(\'Apagar toda a \' + numeroRodada + \'\u00aa rodada? Ser\u00e3o removidos \' + registrosDaRodada.length + \' registro(s). As outras rodadas ser\u00e3o mantidas.\')) {\n      return;\n    }\n\n    setSalvando(true);\n    setErro(\'\');\n    setSucesso(\'Apagando \' + numeroRodada + \'\u00aa rodada...\');\n\n    try {\n      var atualizada = selecionada;\n\n      for (var i = 0; i < registrosDaRodada.length; i += 1) {\n        var registroId = String(registrosDaRodada[i].id || registrosDaRodada[i].criado_em || \'\');\n        if (registroId) {\n          atualizada = await excluirRegistroRodadaNegociacao(atualizada.id, registroId);\n        }\n      }\n\n      setSelecionada(atualizada);\n      setTabelas(function(lista) {\n        return lista.map(function(item) {\n          return item.id === atualizada.id ? atualizada : item;\n        });\n      });\n\n      setSucesso(numeroRodada + \'\u00aa rodada apagada. As demais rodadas foram mantidas.\');';

const nova = 'var rodadaAtual = getRodadaAtualTabela(selecionada);\n    if (!window.confirm(\'Apagar a \' + numeroRodada + \'\u00aa rodada? As outras rodadas ser\u00e3o mantidas.\')) return;\n\n    setSalvando(true);\n    setErro(\'\');\n    setSucesso(\'Apagando \' + numeroRodada + \'\u00aa rodada...\');\n\n    try {\n      var atualizada = await excluirRodadaNegociacao(selecionada.id, numeroRodada);\n      setSelecionada(atualizada);\n      setTabelas(function(lista) {\n        return lista.map(function(item) {\n          return item.id === atualizada.id ? atualizada : item;\n        });\n      });\n      var rodadaFinal = getRodadaAtualTabela(atualizada);\n      setSucesso(numeroRodada + \'\u00aa rodada apagada. Tabela voltou para a \' + rodadaFinal + \'\u00aa rodada.\');';

if (!c.includes('excluirRegistroRodadaNegociacao(atualizada.id, registroId)')) {
  console.log('ERRO: trecho nao encontrado.');
  process.exit(1);
}
c = c.replace(antiga, nova);
fs.writeFileSync(arquivo, c, 'utf8');
console.log('OK!');
