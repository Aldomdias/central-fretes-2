/**
 * perdaRealizadoWorker.js
 * Regras principais:
 * - cálculo geral considera somente opções ATIVAS;
 * - CT-es só entram na conta principal quando têm tabela, faixa/cotação válida e prazo comparável;
 * - opções inativadas ficam em aba separada para medir economia bloqueada;
 * - envia detalhe enxuto do cálculo para auditoria/validação na UI.
 */
import {
  calcularItemTabela,
  construirIndiceFretesPorRota,
  categoriaCanalRealizado,
  ordenarCalculadosPorCriterio,
} from '../utils/realizadoLocalEngine';
import {
  criarMapaVinculosTransportadoras,
  aplicarVinculoTransportadora,
} from '../services/vinculosTransportadorasService';

function norm(s) {
  return String(s || '').trim().toUpperCase();
}

function fmt2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function numeroValido(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function prazoValido(value) {
  const n = numeroValido(value);
  return n !== null && n > 0;
}

function statusInativo(status = '') {
  const s = norm(status).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return s.includes('INATIV') || s.includes('BLOQUEAD') || s.includes('SUSPENS') || s.includes('DESATIV');
}

function transportadoraAtiva(transportadora = {}) {
  if (transportadora?.ativo === false || transportadora?.ativa === false) return false;
  const status = transportadora?.status || transportadora?.situacao || transportadora?.statusCadastro || '';
  if (!status) return true;
  return !statusInativo(status);
}

function resumoTaxas(taxas) {
  if (!taxas) return { total: 0, itens: [] };
  const lista = Array.isArray(taxas)
    ? taxas
    : Object.entries(taxas).map(([nome, valor]) => ({ nome, valor }));
  const itens = lista.map((item) => ({
    nome: item.nome || item.label || item.tipo || item.chave || 'Taxa',
    valor: fmt2(item.valor ?? item.total ?? item.valorCalculado ?? 0),
  })).filter((item) => Math.abs(item.valor) > 0.0001);
  return { total: fmt2(itens.reduce((acc, item) => acc + item.valor, 0)), itens };
}

function detalheCalculo(item) {
  const f = item?.detalhes?.frete || {};
  const taxas = resumoTaxas(item?.detalhes?.taxas);
  return {
    transportadora: item?.transportadora || '',
    statusTransportadora: item?.statusTransportadora || '',
    ativa: item?.ativa !== false,
    temTabelaCalculo: true,
    fontePrazo: 'Tabela de Frete > Rota > prazoEntregaDias',
    total: fmt2(item?.total || 0),
    prazo: numeroValido(item?.prazo),
    tipoCalculo: item?.tipoCalculo || f.tipoCalculo || '',
    faixaPeso: item?.faixaPeso || f.faixaPeso || '',
    pesoInformado: fmt2(f.pesoInformado || 0),
    pesoDeclarado: fmt2(f.pesoDeclarado || 0),
    pesoCubadoOriginal: fmt2(f.pesoCubadoOriginal || 0),
    cubagemRealizada: fmt2(f.cubagemRealizada || 0),
    cubagemGrade: fmt2(f.cubagemGrade || 0),
    cubagemAplicada: fmt2(f.cubagemAplicada || 0),
    origemCubagem: f.origemCubagem || '',
    fatorCubagem: fmt2(f.fatorCubagem || 0),
    pesoCubadoCalculado: fmt2(f.pesoCubadoCalculado || f.pesoCubado || 0),
    pesoConsiderado: fmt2(f.pesoConsiderado || 0),
    valorNFInformado: fmt2(f.valorNFInformado || 0),
    percentualAplicado: fmt2(f.percentualAplicado || 0),
    valorFixoAplicado: fmt2(f.valorFixoAplicado || 0),
    rsKgAplicado: fmt2(f.rsKgAplicado || 0),
    freteMinimoCotacao: fmt2(f.freteMinimoCotacao || 0),
    minimoRota: fmt2(f.minimoRota || 0),
    minimoAplicavel: fmt2(f.minimoAplicavel || 0),
    valorBase: fmt2(f.valorBase || 0),
    subtotal: fmt2(f.subtotal || 0),
    icms: fmt2(f.icms || 0),
    aliquotaIcms: fmt2(f.aliquotaIcms || 0),
    incideIcms: Boolean(f.incideIcms),
    taxasTotal: taxas.total,
    taxas: taxas.itens,
    valorExcedente: fmt2(f.valorExcedente || 0),
    componenteBase: f.componenteBase || '',
  };
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

function matchTransportadoraCalculada(calculados, nomeTransportadora, mapaVinculos) {
  const nomeVinculado = norm(aplicarVinculoTransportadora(nomeTransportadora, mapaVinculos));
  const nomeRaw = norm(nomeTransportadora);
  return calculados.find(
    (c) => norm(c.transportadora) === nomeVinculado || norm(c.transportadora) === nomeRaw
  ) || calculados.find(
    (c) => nomeVinculado && norm(c.transportadora).includes(nomeVinculado.split(' ')[0])
  );
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  if (msg.type !== 'analisar-perda') return;

  try {
    const { realizados = [], transportadoras = [], municipios = [], vinculos = [], criterioB2c = {} } = msg;
    const mapaVinculos = criarMapaVinculosTransportadoras(vinculos);

    self.postMessage({ type: 'progress', etapa: 'Construindo índice de tabelas...', pct: 5 });
    const { index } = construirIndiceFretesPorRota(transportadoras, municipios);

    const detalhes = [];
    const semMalha = [];
    const semPrazo = [];
    const inativasDetalhes = [];
    const CHUNK = 200;

    for (let i = 0; i < realizados.length; i += 1) {
      const cte = realizados[i];
      if (i % CHUNK === 0) {
        const pct = 5 + Math.round((i / Math.max(realizados.length, 1)) * 85);
        self.postMessage({ type: 'progress', etapa: `Analisando CT-es: ${i} / ${realizados.length}`, pct });
        await new Promise((r) => setTimeout(r, 0));
      }

      const canalCte = categoriaCanalRealizado(cte.canal);
      const key = `${canalCte}|${cte.chaveRotaIbge}`;
      const candidatos = index.get(key) || [];

      if (!cte.chaveRotaIbge || !candidatos.length) {
        registrarIgnorado(semMalha, cte, !cte.chaveRotaIbge ? 'CT-e sem chave IBGE origem-destino' : 'Rota não encontrada nas tabelas');
        continue;
      }

      const calculados = candidatos
        .map((c) => {
          try {
            const r = calcularItemTabela({ ...c, cte, gradeCanal: [] });
            if (!r || !Number.isFinite(Number(r.total)) || Number(r.total) <= 0) return null;
            const ativa = transportadoraAtiva(c.transportadora);
            const statusTransportadora = c.transportadora?.status || c.transportadora?.situacao || '';
            return { ...r, ativa, statusTransportadora };
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      if (!calculados.length) {
        registrarIgnorado(semMalha, cte, 'Nenhuma cotação/faixa de peso válida para a rota');
        continue;
      }

      const calculadosAtivos = ordenarCalculadosPorCriterio(calculados.filter((item) => item.ativa !== false), canalCte, criterioB2c);
      const calculadosInativos = ordenarCalculadosPorCriterio(calculados.filter((item) => item.ativa === false), canalCte, criterioB2c);
      const ganhadoraAtiva = calculadosAtivos[0] || null;
      const menorInativa = calculadosInativos[0] || null;

      if (menorInativa && (!ganhadoraAtiva || menorInativa.total < ganhadoraAtiva.total - 0.01)) {
        const valorPago = Number(cte.valorCte || 0);
        inativasDetalhes.push({
          chaveCte: cte.chaveCte || '',
          numeroCte: cte.numeroCte || '',
          emissao: cte.dataEmissao || '',
          canal: cte.canal || '',
          origem: `${cte.cidadeOrigem}/${cte.ufOrigem}`,
          destino: `${cte.cidadeDestino}/${cte.ufDestino}`,
          transportadoraRealizada: cte.transportadora || '',
          transportadoraInativa: menorInativa.transportadora,
          statusInativa: menorInativa.statusTransportadora || 'Inativa',
          valorPago,
          valorInativa: fmt2(menorInativa.total),
          transportadoraAtivaMaisBarata: ganhadoraAtiva?.transportadora || '',
          valorAtivaMaisBarata: ganhadoraAtiva ? fmt2(ganhadoraAtiva.total) : null,
          economiaVsAtiva: ganhadoraAtiva ? fmt2(ganhadoraAtiva.total - menorInativa.total) : 0,
          economiaVsPago: fmt2(valorPago - menorInativa.total),
          criterioSelecao: ganhadoraAtiva?.criterioSelecao || 'MENOR_PRECO',
          scoreAtivaMaisBarata: ganhadoraAtiva?.scorePonderado ?? null,
          prazoInativa: numeroValido(menorInativa.prazo),
          prazoAtivaMaisBarata: numeroValido(ganhadoraAtiva?.prazo),
          fontePrazo: 'Tabela de Frete > Rota > prazoEntregaDias',
          detalheInativa: detalheCalculo(menorInativa),
          detalheAtiva: ganhadoraAtiva ? detalheCalculo(ganhadoraAtiva) : null,
        });
      }

      if (!ganhadoraAtiva) {
        registrarIgnorado(semMalha, cte, 'A rota possui somente transportadoras inativadas', { totalOpcoesInativas: calculadosInativos.length });
        continue;
      }

      const realizadaCalc = matchTransportadoraCalculada(calculadosAtivos, cte.transportadora, mapaVinculos);
      const prazoGanhadora = numeroValido(ganhadoraAtiva?.prazo);
      const prazoRealizada = numeroValido(realizadaCalc?.prazo);

      if (!realizadaCalc) {
        registrarIgnorado(semPrazo, cte, 'Transportadora realizada não encontrada entre as tabelas ativas da rota', {
          transportadoraGanhadora: ganhadoraAtiva.transportadora,
          prazoGanhadora,
          totalOpcoesAtivas: calculadosAtivos.length,
          totalOpcoesInativas: calculadosInativos.length,
        });
        continue;
      }

      if (!prazoValido(prazoRealizada) || !prazoValido(prazoGanhadora)) {
        registrarIgnorado(semPrazo, cte, 'Sem prazo válido para comparar realizada x ganhadora ativa', {
          transportadoraGanhadora: ganhadoraAtiva.transportadora,
          prazoRealizada,
          prazoGanhadora,
          totalOpcoesAtivas: calculadosAtivos.length,
          totalOpcoesInativas: calculadosInativos.length,
        });
        continue;
      }

      const valorPago = Number(cte.valorCte || 0);
      const valorGanhadora = ganhadoraAtiva.total;
      const perda = fmt2(valorPago - valorGanhadora);
      const temPerda = perda > 0.01;
      const alternativasAtivas = calculadosAtivos.map((item) => ({
        transportadora: item.transportadora,
        total: fmt2(item.total),
        valor: fmt2(item.total),
        prazo: numeroValido(item.prazo),
        criterioSelecao: item.criterioSelecao || 'MENOR_PRECO',
        scorePonderado: item.scorePonderado ?? null,
        faixaPeso: item.faixaPeso || '',
        tipoCalculo: item.tipoCalculo || '',
      }));

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
        transportadoraRealizadaCadastro: realizadaCalc.transportadora || '',
        transportadoraGanhadora: ganhadoraAtiva.transportadora,
        valorGanhadora: fmt2(valorGanhadora),
        perda,
        perdaPercentual: valorPago > 0 ? fmt2((perda / valorPago) * 100) : 0,
        criterioSelecao: ganhadoraAtiva.criterioSelecao || 'MENOR_PRECO',
        scorePonderado: ganhadoraAtiva.scorePonderado ?? null,
        pesoPrecoScore: ganhadoraAtiva.pesoPrecoScore ?? null,
        pesoPrazoScore: ganhadoraAtiva.pesoPrazoScore ?? null,
        prazoGanhadora,
        prazoRealizada,
        difPrazo: prazoGanhadora - prazoRealizada,
        fontePrazo: 'Tabela de Frete > Rota > prazoEntregaDias',
        realizadaNasTabelas: true,
        totalOpcoes: calculadosAtivos.length,
        totalOpcoesInativas: calculadosInativos.length,
        temPerda,
        faixaGanhadora: ganhadoraAtiva.faixaPeso || '',
        faixaRealizada: realizadaCalc.faixaPeso || '',
        tipoCalculoGanhadora: ganhadoraAtiva.tipoCalculo || '',
        tipoCalculoRealizada: realizadaCalc.tipoCalculo || '',
        calculoGanhadora: detalheCalculo(ganhadoraAtiva),
        calculoRealizada: detalheCalculo(realizadaCalc),
        alternativasAtivas,
        menorInativa: menorInativa ? detalheCalculo(menorInativa) : null,
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
      const g = mapaOrigem.get(k) || { origem: k, ufOrigem: d.ufOrigem, cidadeOrigem: d.cidadeOrigem, ctes: 0, perdaTotal: 0, valorPagoTotal: 0 };
      g.ctes += 1;
      g.perdaTotal = fmt2(g.perdaTotal + d.perda);
      g.valorPagoTotal = fmt2(g.valorPagoTotal + d.valorPago);
      mapaOrigem.set(k, g);
    }
    const top10Origens = Array.from(mapaOrigem.values()).sort((a, b) => b.perdaTotal - a.perdaTotal).slice(0, 10).map((g) => ({ ...g, perdaPercentual: g.valorPagoTotal > 0 ? fmt2((g.perdaTotal / g.valorPagoTotal) * 100) : 0 }));

    const mapaTransp = new Map();
    for (const d of detalhes) {
      if (!d.temPerda) continue;
      const k = d.transportadoraRealizada;
      const g = mapaTransp.get(k) || { transportadora: k, ctes: 0, perdaTotal: 0 };
      g.ctes += 1;
      g.perdaTotal = fmt2(g.perdaTotal + d.perda);
      mapaTransp.set(k, g);
    }
    const porTransportadora = Array.from(mapaTransp.values()).sort((a, b) => b.perdaTotal - a.perdaTotal).slice(0, 15);

    const economiaInativaTotal = fmt2(inativasDetalhes.reduce((acc, item) => acc + Math.max(0, Number(item.economiaVsAtiva || 0)), 0));
    const economiaInativaVsPagoTotal = fmt2(inativasDetalhes.reduce((acc, item) => acc + Math.max(0, Number(item.economiaVsPago || 0)), 0));

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
        inativas: inativasDetalhes.length,
        economiaInativaTotal,
        economiaInativaVsPagoTotal,
        top10Origens,
        porTransportadora,
        detalhes,
        inativasDetalhes,
      },
    });
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || 'Erro ao analisar perda.' });
  }
};
