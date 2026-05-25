/**
 * perdaRealizadoWorker.js
 * Analisa o realizado e identifica o valor perdido por usar uma transportadora
 * mais cara em vez da opção mais barata disponível na tabela.
 *
 * Regra da tela:
 * - conta/análise principal somente CT-es que tenham tabela compatível;
 * - conta/análise principal somente CT-es que tenham prazo da realizada e da ganhadora;
 * - itens sem tabela ou sem prazo ficam fora da conta principal, apenas como diagnóstico.
 */
import {
  calcularItemTabela,
  construirIndiceFretesPorRota,
  categoriaCanalRealizado,
} from '../utils/realizadoLocalEngine';
import {
  criarMapaVinculosTransportadoras,
  aplicarVinculoTransportadora,
} from '../services/vinculosTransportadorasService';

function norm(s) {
  return String(s || '').trim().toUpperCase();
}

function fmt2(n) {
  return Math.round((n || 0) * 100) / 100;
}

function numeroValido(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function prazoValido(value) {
  const n = numeroValido(value);
  return n !== null && n > 0;
}

function registrarIgnorado(lista, cte, motivo, extra = {}) {
  lista.push({
    chaveCte: cte.chaveCte,
    numeroCte: cte.numeroCte,
    transportadora: cte.transportadora,
    origem: `${cte.cidadeOrigem}/${cte.ufOrigem}`,
    destino: `${cte.cidadeDestino}/${cte.ufDestino}`,
    motivo,
    ...extra,
  });
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  if (msg.type !== 'analisar-perda') return;

  try {
    const {
      realizados = [],
      transportadoras = [],
      municipios = [],
      vinculos = [],
    } = msg;

    const mapaVinculos = criarMapaVinculosTransportadoras(vinculos);

    self.postMessage({ type: 'progress', etapa: 'Construindo índice de tabelas...', pct: 5 });
    const { index } = construirIndiceFretesPorRota(transportadoras, municipios);

    const detalhes = [];
    const semMalha = [];
    const semPrazo = [];
    const CHUNK = 200;

    for (let i = 0; i < realizados.length; i += 1) {
      const cte = realizados[i];

      if (i % CHUNK === 0) {
        const pct = 5 + Math.round((i / Math.max(realizados.length, 1)) * 85);
        self.postMessage({
          type: 'progress',
          etapa: `Analisando CT-es: ${i} / ${realizados.length}`,
          pct,
        });
        await new Promise((r) => setTimeout(r, 0));
      }

      const canalCte = categoriaCanalRealizado(cte.canal);
      const key = `${canalCte}|${cte.chaveRotaIbge}`;
      const candidatos = index.get(key) || [];

      if (!cte.chaveRotaIbge || !candidatos.length) {
        registrarIgnorado(
          semMalha,
          cte,
          !cte.chaveRotaIbge ? 'CT-e sem chave IBGE origem-destino' : 'Rota não encontrada nas tabelas'
        );
        continue;
      }

      const calculados = candidatos
        .map((c) => {
          try {
            return calcularItemTabela({ ...c, cte, gradeCanal: [] });
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => a.total - b.total || a.prazo - b.prazo);

      if (!calculados.length) {
        registrarIgnorado(semMalha, cte, 'Nenhuma cotação/faixa de peso válida para a rota');
        continue;
      }

      const ganhadora = calculados[0];
      const nomeVinculado = norm(aplicarVinculoTransportadora(cte.transportadora, mapaVinculos));
      const nomeRaw = norm(cte.transportadora);
      const realizadaCalc = calculados.find(
        (c) => norm(c.transportadora) === nomeVinculado || norm(c.transportadora) === nomeRaw
      ) || calculados.find(
        (c) => nomeVinculado && norm(c.transportadora).includes(nomeVinculado.split(' ')[0])
      );

      const prazoGanhadora = numeroValido(ganhadora?.prazo);
      const prazoRealizada = numeroValido(realizadaCalc?.prazo);

      if (!realizadaCalc) {
        registrarIgnorado(semPrazo, cte, 'Transportadora realizada não encontrada nas tabelas da rota', {
          transportadoraGanhadora: ganhadora.transportadora,
          prazoGanhadora,
          totalOpcoes: calculados.length,
        });
        continue;
      }

      if (!prazoValido(prazoRealizada) || !prazoValido(prazoGanhadora)) {
        registrarIgnorado(semPrazo, cte, 'Sem prazo válido para comparar realizada x ganhadora', {
          transportadoraGanhadora: ganhadora.transportadora,
          prazoRealizada,
          prazoGanhadora,
          totalOpcoes: calculados.length,
        });
        continue;
      }

      const valorPago = Number(cte.valorCte || 0);
      const valorGanhadora = ganhadora.total;
      const perda = fmt2(valorPago - valorGanhadora);
      const temPerda = perda > 0.01;

      detalhes.push({
        chaveCte: cte.chaveCte || '',
        numeroCte: cte.numeroCte || '',
        emissao: cte.dataEmissao || '',
        competencia: cte.competencia || '',
        canal: cte.canal || '',
        ufOrigem: cte.ufOrigem || '',
        cidadeOrigem: cte.cidadeOrigem || '',
        ufDestino: cte.ufDestino || '',
        cidadeDestino: cte.cidadeDestino || '',
        peso: cte.peso || 0,
        valorNF: Number(cte.valorNF || 0),
        valorPago,
        transportadoraRealizada: cte.transportadora || '',
        transportadoraGanhadora: ganhadora.transportadora,
        valorGanhadora: fmt2(valorGanhadora),
        perda,
        perdaPercentual: valorPago > 0 ? fmt2((perda / valorPago) * 100) : 0,
        prazoGanhadora,
        prazoRealizada,
        difPrazo: prazoGanhadora - prazoRealizada,
        realizadaNasTabelas: true,
        totalOpcoes: calculados.length,
        temPerda,
      });
    }

    self.postMessage({ type: 'progress', etapa: 'Consolidando resultados comparáveis...', pct: 93 });

    const totalCtes = detalhes.length;
    const ctesComPerda = detalhes.filter((d) => d.temPerda).length;
    const perdaTotal = fmt2(detalhes.reduce((s, d) => s + (d.temPerda ? d.perda : 0), 0));
    const perdaMedia = ctesComPerda > 0 ? fmt2(perdaTotal / ctesComPerda) : 0;

    const mapaOrigem = new Map();
    for (const d of detalhes) {
      if (!d.temPerda) continue;
      const k = `${d.cidadeOrigem}/${d.ufOrigem}`;
      const g = mapaOrigem.get(k) || {
        origem: k,
        ufOrigem: d.ufOrigem,
        cidadeOrigem: d.cidadeOrigem,
        ctes: 0,
        perdaTotal: 0,
        valorPagoTotal: 0,
      };
      g.ctes += 1;
      g.perdaTotal = fmt2(g.perdaTotal + d.perda);
      g.valorPagoTotal = fmt2(g.valorPagoTotal + d.valorPago);
      mapaOrigem.set(k, g);
    }

    const top10Origens = Array.from(mapaOrigem.values())
      .sort((a, b) => b.perdaTotal - a.perdaTotal)
      .slice(0, 10)
      .map((g) => ({ ...g, perdaPercentual: g.valorPagoTotal > 0 ? fmt2((g.perdaTotal / g.valorPagoTotal) * 100) : 0 }));

    const mapaTransp = new Map();
    for (const d of detalhes) {
      if (!d.temPerda) continue;
      const k = d.transportadoraRealizada;
      const g = mapaTransp.get(k) || { transportadora: k, ctes: 0, perdaTotal: 0 };
      g.ctes += 1;
      g.perdaTotal = fmt2(g.perdaTotal + d.perda);
      mapaTransp.set(k, g);
    }

    const porTransportadora = Array.from(mapaTransp.values())
      .sort((a, b) => b.perdaTotal - a.perdaTotal)
      .slice(0, 15);

    self.postMessage({
      type: 'done',
      result: {
        totalCtes,
        ctesComPerda,
        perdaTotal,
        perdaMedia,
        semMalha: semMalha.length,
        semPrazo: semPrazo.length,
        semComparacao: semMalha.length + semPrazo.length,
        top10Origens,
        porTransportadora,
        detalhes,
      },
    });
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || 'Erro ao analisar perda.' });
  }
};
