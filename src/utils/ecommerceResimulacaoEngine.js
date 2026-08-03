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
} = {}) {
  const resultados = [];

  for (const pedido of pedidos) {
    const canal = categoriaCanalRealizado(pedido.canal || 'B2C');
    const destino = resolverIbgeLocal(pedido.cidade, pedido.uf, '', mapasIbge);
    const ibgeDestino = destino?.ibge || '';

    if (!ibgeDestino) {
      resultados.push({ id: pedido.id, sim_status: 'sem_ibge_destino', sim_peso_base: pesoBase });
      continue;
    }

    const candidatos = index.get(`${canal}|${ibgeDestino}`) || [];
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

    resultados.push({
      id: pedido.id,
      sim_status: 'ok',
      sim_peso_base: pesoBase,
      sim_transportadora_ideal: vencedor.transportadora,
      sim_origem_ideal: vencedor.origem,
      sim_valor_ideal: vencedor.total,
      sim_prazo_ideal: vencedor.prazo,
      sim_diferenca_vs_cte: custoReal > 0 ? Number((custoReal - vencedor.total).toFixed(2)) : null,
      sim_diferenca_vs_tabela: pedido.frete_tabela ? Number((Number(pedido.frete_tabela) - vencedor.total).toFixed(2)) : null,
      sim_mesma_transportadora: pedido.cte_transportadora
        ? String(pedido.cte_transportadora).trim().toUpperCase() === String(vencedor.transportadora).trim().toUpperCase()
        : null,
    });
  }

  return resultados;
}
