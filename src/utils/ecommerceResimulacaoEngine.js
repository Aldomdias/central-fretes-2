import {
  montarMapasIbge,
  resolverIbgeLocal,
  categoriaCanalRealizado,
  construirIndicePorDestino,
  calcularItemTabela,
  ordenarCalculadosPorCriterio,
} from './realizadoLocalEngine';

// Monta uma vez o indice canal|destino -> candidatos (CD + transportadora) da malha B2C.
// O indice e reaproveitado para todos os lotes de pedidos, ja que o tamanho dele depende
// da malha cadastrada (transportadoras/origens/rotas), nao do volume de pedidos.
export function construirIndiceResimulacaoEcommerce(transportadoras = [], municipios = []) {
  const mapasIbge = montarMapasIbge(municipios);
  const { index } = construirIndicePorDestino(transportadoras, municipios);
  return { mapasIbge, index };
}

function normalizarCidadeCd(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase();
}

// Resimula, para cada pedido, qual seria o CD (origem) + transportadora ideal considerando
// toda a malha B2C cadastrada hoje, usando peso cotado e o mesmo criterio 80/20 preco x prazo
// que o marketplace usa na oferta em tempo real. Ignora desconto de campanha e adicional
// tributario de proposito: o objetivo e mostrar o preco de tabela "limpo".
export function resimularLotePedidosEcommerce({
  pedidos = [],
  mapasIbge,
  index,
  criterioB2c = { usarPonderadoB2c: true, pesoPreco: 80, pesoPrazo: 20 },
  pesoBase = 'cotado', // 'cotado' | 'faturado' - qual peso do pedido usar no calculo
  cdsPermitidos = [], // vazio = todas as origens; senao, restringe a esses CDs (cidade da origem)
} = {}) {
  const resultados = [];
  const cdsPermitidosSet = cdsPermitidos.length
    ? new Set(cdsPermitidos.map(normalizarCidadeCd))
    : null;

  for (const pedido of pedidos) {
    const canal = categoriaCanalRealizado(pedido.canal || 'B2C');
    const ibgeDestino = resolverIbgeLocal(pedido.cidade, pedido.uf, mapasIbge) || '';

    if (!ibgeDestino) {
      resultados.push({ id: pedido.id, sim_status: 'sem_ibge_destino', sim_peso_base: pesoBase });
      continue;
    }

    const candidatosBrutos = index.get(`${canal}|${ibgeDestino}`) || [];
    const candidatos = cdsPermitidosSet
      ? candidatosBrutos.filter((c) => cdsPermitidosSet.has(normalizarCidadeCd(c.origem?.cidade)))
      : candidatosBrutos;
    if (!candidatos.length) {
      resultados.push({ id: pedido.id, sim_status: 'sem_malha', sim_peso_base: pesoBase });
      continue;
    }

    const pesoFaturado = Number(pedido.peso_faturado || 0);
    const pesoCotado = Number(pedido.peso_cotado || 0);
    const pesoEscolhido = pesoBase === 'faturado' && pesoFaturado > 0 ? pesoFaturado : pesoCotado;

    const cte = {
      peso: pesoEscolhido,
      pesoDeclarado: pesoEscolhido,
      pesoCubado: 0,
      valorNF: Number(pedido.valor_pedido || pedido.valor_faturado || 0),
      canal,
      ufOrigem: '',
      ibgeDestino,
      documentoDestinatario: '',
    };

    const calculados = candidatos
      .map((candidato) => calcularItemTabela({ ...candidato, cte, gradeCanal: [] }))
      .filter(Boolean);

    if (!calculados.length) {
      resultados.push({ id: pedido.id, sim_status: 'sem_cotacao_peso', sim_peso_base: pesoBase });
      continue;
    }

    const ordenados = ordenarCalculadosPorCriterio(calculados, canal, criterioB2c);
    const vencedor = ordenados[0];
    const custoReal = Number(pedido.custo_frete_transportadora || pedido.cte_valor || 0);

    // Guarda as N melhores opcoes simuladas (nao so a vencedora), com o detalhe
    // do calculo de cada uma, pra poder mostrar na tela e o usuario conferir
    // manualmente por que aquela transportadora/CD venceu.
    const candidatosResumo = ordenados.slice(0, 8).map((item) => ({
      transportadora: item.transportadora,
      origem: item.origem,
      origemValidada: Boolean(item.origemValidada),
      valor: item.total,
      prazo: item.prazo,
      faixaPeso: item.faixaPeso,
      tipoCalculo: item.tipoCalculo,
      detalhes: item.detalhes?.frete || null,
    }));

    resultados.push({
      id: pedido.id,
      sim_status: 'ok',
      sim_peso_base: pesoBase,
      sim_transportadora_ideal: vencedor.transportadora,
      sim_origem_ideal: vencedor.origem,
      sim_origem_validada: Boolean(vencedor.origemValidada),
      sim_valor_ideal: vencedor.total,
      sim_prazo_ideal: vencedor.prazo,
      sim_diferenca_vs_cte: custoReal > 0 ? Number((custoReal - vencedor.total).toFixed(2)) : null,
      sim_diferenca_vs_tabela: pedido.frete_tabela ? Number((Number(pedido.frete_tabela) - vencedor.total).toFixed(2)) : null,
      sim_mesma_transportadora: pedido.cte_transportadora
        ? String(pedido.cte_transportadora).trim().toUpperCase() === String(vencedor.transportadora).trim().toUpperCase()
        : null,
      sim_candidatos: candidatosResumo,
    });
  }

  return resultados;
}
