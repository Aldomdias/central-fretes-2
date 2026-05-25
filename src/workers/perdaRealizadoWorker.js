/**
 * perdaRealizadoWorker.js
 * Analisa o realizado e identifica o valor "perdido" por usar
 * a transportadora mais cara em vez da mais barata disponível.
 *
 * Para cada CT-e:
 *  1. Busca todos os candidatos (transportadoras com tabela para a rota)
 *  2. Calcula o custo de cada uma
 *  3. Identifica a mais barata (ganhadora)
 *  4. Compara com o valor pago (cte.valorCte)
 *  5. Perda = valorPago - ganhadora.total   (quando > 0)
 *  6. Registra prazo da realizada vs prazo da ganhadora
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

    // ── 1. Mapa de vínculos (nome CT-e → nome tabela) ──────────────────────
    const mapaVinculos = criarMapaVinculosTransportadoras(vinculos);

    // ── 2. Índice de rotas (canal|chaveRota → candidatos) ──────────────────
    self.postMessage({ type: 'progress', etapa: 'Construindo índice de tabelas...', pct: 5 });
    const { index } = construirIndiceFretesPorRota(transportadoras, municipios);

    // ── 3. Análise por CT-e ────────────────────────────────────────────────
    const detalhes = [];
    const semMalha = [];
    const CHUNK = 200;

    for (let i = 0; i < realizados.length; i++) {
      const cte = realizados[i];

      // progresso a cada chunk
      if (i % CHUNK === 0) {
        const pct = 5 + Math.round((i / realizados.length) * 85);
        self.postMessage({
          type: 'progress',
          etapa: `Analisando CT-es: ${i} / ${realizados.length}`,
          pct,
        });
        // yield para não travar
        await new Promise((r) => setTimeout(r, 0));
      }

      const canalCte = categoriaCanalRealizado(cte.canal);
      const key = `${canalCte}|${cte.chaveRotaIbge}`;
      const candidatos = index.get(key) || [];

      if (!cte.chaveRotaIbge || !candidatos.length) {
        semMalha.push({
          chaveCte: cte.chaveCte,
          transportadora: cte.transportadora,
          origem: `${cte.cidadeOrigem}/${cte.ufOrigem}`,
          destino: `${cte.cidadeDestino}/${cte.ufDestino}`,
          motivo: !cte.chaveRotaIbge
            ? 'CT-e sem chave IBGE origem-destino'
            : 'Rota não encontrada nas tabelas',
        });
        continue;
      }

      // Calcular custo para cada candidato
      const calculados = candidatos
        .map((c) => {
          try {
            const r = calcularItemTabela({ ...c, cte, gradeCanal: [] });
            return r;
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => a.total - b.total || a.prazo - b.prazo);

      if (!calculados.length) {
        semMalha.push({
          chaveCte: cte.chaveCte,
          transportadora: cte.transportadora,
          origem: `${cte.cidadeOrigem}/${cte.ufOrigem}`,
          destino: `${cte.cidadeDestino}/${cte.ufDestino}`,
          motivo: 'Nenhuma cotação/faixa de peso válida para a rota',
        });
        continue;
      }

      const ganhadora = calculados[0]; // mais barata

      // Tentar achar a transportadora realizada nas tabelas (via vínculo)
      const nomeVinculado = norm(aplicarVinculoTransportadora(cte.transportadora, mapaVinculos));
      const nomeRaw = norm(cte.transportadora);
      const realizadaCalc = calculados.find(
        (c) => norm(c.transportadora) === nomeVinculado || norm(c.transportadora) === nomeRaw
      ) || calculados.find(
        (c) => nomeVinculado && norm(c.transportadora).includes(nomeVinculado.split(' ')[0])
      );

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
        prazoGanhadora: ganhadora.prazo || 0,
        prazoRealizada: realizadaCalc?.prazo ?? null,
        difPrazo: realizadaCalc != null ? (ganhadora.prazo - realizadaCalc.prazo) : null,
        realizadaNasTabelas: realizadaCalc != null,
        totalOpcoes: calculados.length,
        temPerda,
      });
    }

    // ── 4. Agregações ──────────────────────────────────────────────────────
    self.postMessage({ type: 'progress', etapa: 'Consolidando resultados...', pct: 93 });

    const totalCtes = detalhes.length;
    const ctesComPerda = detalhes.filter((d) => d.temPerda).length;
    const perdaTotal = fmt2(detalhes.reduce((s, d) => s + (d.temPerda ? d.perda : 0), 0));
    const perdaMedia = ctesComPerda > 0 ? fmt2(perdaTotal / ctesComPerda) : 0;

    // Por UF de origem
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

    // Por transportadora realizada
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
        top10Origens,
        porTransportadora,
        detalhes, // tabela completa (paginada na UI)
      },
    });
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || 'Erro ao analisar perda.' });
  }
};
