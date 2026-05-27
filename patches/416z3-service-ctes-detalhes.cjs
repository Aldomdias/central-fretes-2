const fs = require('fs');
const path = require('path');
const file = path.join(process.cwd(), 'src/services/tabelasNegociacaoService.js');
let src = fs.readFileSync(file, 'utf8');
const old = src;
if (!src.includes('ctesDetalhes: (resultado.ctesDetalhes || [])')) {
  src = src.replace(
    "    diagnostico: resultado.diagnostico || {},",
    `    diagnostico: resultado.diagnostico || {},
    ctesDetalhes: (resultado.ctesDetalhes || []).slice(0, 3000).map((item) => ({
      cte: item.cte || '',
      origem: item.origem || '',
      ufOrigem: item.ufOrigem || '',
      destino: item.destino || '',
      ufDestino: item.ufDestino || '',
      peso: item.peso || 0,
      volumes: item.volumes || 0,
      freteRealizado: item.freteRealizado || 0,
      freteSelecionada: item.freteSelecionada || 0,
      statusSelecionada: item.statusSelecionada || '',
      ganhouRealizado: item.ganhouRealizado || false,
      savingSelecionada: item.savingSelecionada || 0,
      diferencaParaVencedor: item.diferencaParaVencedor || 0,
      reducaoNecessaria: item.reducaoNecessaria || 0,
      nomeRota: item.nomeRota || item.nomeRotaCotacao || item.cotacaoComercial || item.rotaCotacao || '',
      faixaPeso: item.faixaPeso || item.faixaPesoCotacao || '',
    })),`
  );
}
if (src !== old) fs.writeFileSync(file, src, 'utf8');
console.log(src !== old ? '4.16Z3 service aplicado.' : '4.16Z3 service sem alterações.');
