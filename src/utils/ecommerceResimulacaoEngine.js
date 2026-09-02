import {
  montarMapasIbge,
  resolverIbgeLocal,
  categoriaCanalRealizado,
  construirIndicePorDestino,
  calcularItemTabela,
  ordenarCalculadosPorCriterio,
  getUfByIbge,
} from './realizadoLocalEngine';
import { aplicarVinculoTransportadora } from '../services/vinculosTransportadorasPuro.js';
import { isTransportadoraEbazarEcommerce } from './ecommerceAuditoriaPuro.js';

// Monta uma vez o indice canal|destino -> candidatos (CD + transportadora) da malha B2C.
// O indice e reaproveitado para todos os lotes de pedidos, ja que o tamanho dele depende
// da malha cadastrada (transportadoras/origens/rotas), nao do volume de pedidos.
export function construirIndiceResimulacaoEcommerce(transportadoras = [], municipios = []) {
  const mapasIbge = montarMapasIbge(municipios);
  const statusAtivo = (status) => {
    const normalizado = String(status || 'ATIVA').trim().toUpperCase();
    return normalizado === 'ATIVA' || normalizado === 'ATIVO';
  };
  // A auditoria deve representar apenas opcoes realmente contrataveis hoje.
  // Bloqueia a transportadora inteira quando inativa e, de forma independente,
  // remove CDs/origens inativos de uma transportadora ainda ativa.
  const malhaAtiva = (transportadoras || [])
    .filter((transportadora) => statusAtivo(transportadora?.status))
    .map((transportadora) => ({
      ...transportadora,
      origens: (transportadora.origens || []).filter((origem) => statusAtivo(origem?.status)),
    }))
    .filter((transportadora) => transportadora.origens.length);
  const { index } = construirIndicePorDestino(malhaAtiva, municipios);
  return { mapasIbge, index };
}

function normalizarCidadeCd(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
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
  mapaVinculos = null, // Map nome_cte -> nome_tabela (transportadora_vinculos), pra achar
  // a transportadora real quando o nome no CT-e difere do nome cadastrado (ex: "TEX
  // COURIER S.A" no CT-e = "TOTAL EXPRESS" na tabela).
} = {}) {
  const resultados = [];
  const cdsPermitidosGlobalSet = cdsPermitidos.length
    ? new Set(cdsPermitidos.map(normalizarCidadeCd))
    : null;

  for (const pedido of pedidos) {
    const canal = categoriaCanalRealizado(pedido.canal || 'B2C');
    const ibgeDestino = resolverIbgeLocal(pedido.cidade, pedido.uf, mapasIbge) || '';

    if (!ibgeDestino) {
      resultados.push({ id: pedido.id, sim_status: 'sem_ibge_destino', sim_peso_base: pesoBase });
      continue;
    }

    // Restricao por pedido (CDs com saldo na venda daquele pedido especifico) tem prioridade
    // sobre a lista global de cdsPermitidos - so cai pro global quando o pedido nao trouxe
    // NENHUM codigo de CD (campo vazio no relatorio do marketplace). Se o pedido trouxe
    // codigo(s) mas nenhum bateu com cd_centros (array vazio, nao undefined), NAO cai pro
    // global - o Set vazio resulta em zero candidatos (sim_status 'sem_malha'), que e o
    // comportamento seguro: nunca libera todas as origens so porque um codigo nao foi
    // reconhecido.
    const temRestricaoPedido = Array.isArray(pedido.cdsSaldoCidades);
    const cdsPermitidosPedidoSet = temRestricaoPedido
      ? new Set(pedido.cdsSaldoCidades.map(normalizarCidadeCd))
      : cdsPermitidosGlobalSet;

    // Pedido trouxe codigo(s) de CD, mas nenhum bateu com cd_centros - registra num status
    // proprio (em vez de cair generico em 'sem_malha') pra dar pra filtrar depois e revisar
    // o de-para de codigo->cidade.
    if (temRestricaoPedido && cdsPermitidosPedidoSet.size === 0) {
      resultados.push({ id: pedido.id, sim_status: 'sem_cd_saldo_reconhecido', sim_peso_base: pesoBase });
      continue;
    }

    const candidatosBrutos = index.get(`${canal}|${ibgeDestino}`) || [];
    const candidatos = cdsPermitidosPedidoSet
      ? candidatosBrutos.filter((c) => cdsPermitidosPedidoSet.has(normalizarCidadeCd(c.origem?.cidade)))
      : candidatosBrutos;
    if (!candidatos.length) {
      resultados.push({ id: pedido.id, sim_status: 'sem_malha', sim_peso_base: pesoBase });
      continue;
    }

    const cte = montarCteDoPedido(pedido, canal, ibgeDestino, pesoBase);

    const calculados = candidatos
      .map((candidato) => calcularItemTabela({ ...candidato, cte, gradeCanal: [] }))
      .filter(Boolean);

    resultados.push(finalizarResultadoPedido(pedido, calculados, canal, { criterioB2c, pesoBase, mapaVinculos }));
  }

  return resultados;
}

// Monta o objeto "cte" (peso/cubagem/valor NF) que calcularItemTabela espera, a partir
// dos campos do pedido do e-commerce. Compartilhado entre o fluxo de 1 carregamento so
// (resimularLotePedidosEcommerce) e o fluxo por origem (calcularCandidatosOrigemEcommerce).
function montarCteDoPedido(pedido, canal, ibgeDestino, pesoBase) {
  // O peso de entrada e o peso real da NF. O motor calcula separadamente o
  // peso cubado a partir da cubagem e do fator de cada transportadora/CD, e
  // tarifa pelo maior entre peso real e peso cubado calculado.
  const pesoFaturado = Number(pedido.peso_real_faturado || 0);
  const pesoCotado = Number(pedido.peso_real_cotado || 0);
  const pesoEscolhido = pesoBase === 'faturado' && pesoFaturado > 0 ? pesoFaturado : pesoCotado;
  return {
    peso: pesoEscolhido,
    pesoDeclarado: pesoEscolhido,
    pesoCubado: 0,
    // Cubagem real da NF (relatorio do marketplace). Marcado como 'tracking' pra
    // reaproveitar a mesma regra do motor de realizado: cubagem so entra no calculo
    // quando e dado real (nao estimativa de grade), aplicando o fator de cubagem
    // de cada transportadora/CD candidato e usando o maior entre peso e peso cubado.
    cubagem: Number(pedido.cubagem_cotada || 0),
    origemCubagem: 'tracking',
    // Excecao comercial exclusiva da Auditoria E-commerce. O motor compartilhado
    // so aplica FL/CD peso x 1,20 quando esta marca explicita estiver presente;
    // simuladores e demais ferramentas continuam com a cubagem normal.
    aplicarRegraFlCdEcommerce: true,
    valorNF: Number(pedido.valor_pedido || pedido.valor_faturado || 0),
    canal,
    ufOrigem: '',
    ibgeDestino,
    documentoDestinatario: '',
  };
}

// Dado um pedido e a lista de candidatos JA CALCULADOS (calcularItemTabela), escolhe o
// vencedor pelo criterio B2c, monta o resumo de candidatos (top8 + transportadora real)
// e retorna o resultado final no mesmo formato salvo em ecommerce_order_snapshot.
// Extraido de resimularLotePedidosEcommerce pra ser reaproveitado no fluxo por origem,
// onde os candidatos vem acumulados de varias cargas de malha (uma por origem) em vez
// de um unico index gigante carregado de uma vez so.
function finalizarResultadoPedido(pedido, calculados, canal, { criterioB2c, pesoBase, mapaVinculos }) {
  const nomeCteResolvido = mapaVinculos
    ? aplicarVinculoTransportadora(pedido.cte_transportadora, mapaVinculos)
    : pedido.cte_transportadora;
  const cidadesSaldo = Array.isArray(pedido.cdsSaldoCidades)
    ? new Set(pedido.cdsSaldoCidades.map(normalizarCidadeCd))
    : null;
  const origemRealTemSaldo = cidadesSaldo?.has(normalizarCidadeCd(pedido.cte_cidade_origem));
  const valorOpcaoOriginal = Number(pedido.frete_tabela || 0);
  const candidatoEquivalenteOriginal = calculados.find((item) => {
    const mesmaOrigem = normalizarCidadeCd(item.origem) === normalizarCidadeCd(pedido.cte_cidade_origem);
    const nomeItem = String(item.transportadora || '').trim().toUpperCase();
    const nomeOriginal = String(nomeCteResolvido || '').trim().toUpperCase();
    const mesmaTransportadora = nomeItem === nomeOriginal || nomeItem.includes(nomeOriginal) || nomeOriginal.includes(nomeItem);
    return mesmaOrigem && mesmaTransportadora;
  });
  const opcaoOriginal = origemRealTemSaldo && valorOpcaoOriginal > 0 && nomeCteResolvido && !isTransportadoraEbazarEcommerce(nomeCteResolvido)
    ? {
        transportadora: nomeCteResolvido,
        origem: pedido.cte_cidade_origem,
        origemValidada: true,
        total: valorOpcaoOriginal,
        prazo: Number(pedido.prazo_dias_corridos || 0),
        faixaPeso: 'OPCAO ORIGINAL',
        pesoMinFaixa: null,
        pesoMaxFaixa: null,
        ibgeDestino: calculados[0]?.ibgeDestino || '',
        rotaNome: 'OPCAO ORIGINAL CARREGADA',
        tipoCalculo: 'OPCAO_ORIGINAL',
        // O valor permanece o que a roteadora carregou, mas reaproveitamos os dados
        // de peso da mesma transportadora/origem recalculada para tornar a escolha
        // auditavel. Se a tabela atual nao produzir esse candidato, nao inventamos
        // fator ou peso: os campos ficam indisponiveis.
        detalhes: {
          frete: candidatoEquivalenteOriginal?.detalhes?.frete
            ? { ...candidatoEquivalenteOriginal.detalhes.frete, origemValor: 'frete_tabela_order_snapshot' }
            : { origemValor: 'frete_tabela_order_snapshot' },
        },
        ehOpcaoOriginal: true,
      }
    : null;
  const calculadosComOriginal = opcaoOriginal ? [...calculados, opcaoOriginal] : calculados;

  if (!calculadosComOriginal.length) {
    return { id: pedido.id, sim_status: 'sem_cotacao_peso', sim_peso_base: pesoBase };
  }

  const ordenados = ordenarCalculadosPorCriterio(calculadosComOriginal, canal, criterioB2c);
  const vencedor = ordenados[0];
  const custoReal = Number(pedido.custo_frete_transportadora || pedido.cte_valor || 0);

  // Guarda as N melhores opcoes simuladas (nao so a vencedora), com o detalhe
  // do calculo de cada uma, pra poder mostrar na tela e o usuario conferir
  // manualmente por que aquela transportadora/CD venceu. A transportadora que
  // realmente carregou o CT-e sempre entra na lista, mesmo fora do top 8 -
  // senao some da tela e parece que a auditoria esta ignorando o que aconteceu
  // de verdade, o que quebra a credibilidade do numero mostrado.
  // Uma transportadora pode ter varias origens/CDs cadastrados - so bater o
  // nome nao basta (ex: TAM tem origem em Serra/ES e em Itajai/SC, com
  // tabelas bem diferentes). Quando o CT-e real informa a UF de origem,
  // exige tambem que a UF do candidato bata; so cai pro match so-por-nome
  // se nenhum candidato daquela transportadora tiver a UF certa.
  // O nome no CT-e pode ser a razao social (ex: "TEX COURIER S.A"), diferente
  // do nome cadastrado na tabela de fretes (ex: "TOTAL EXPRESS") - resolve
  // pelo vinculo cadastrado em Ferramentas antes de comparar nomes.
  const nomeReal = nomeCteResolvido ? String(nomeCteResolvido).trim().toUpperCase() : '';
  const ufReal = pedido.cte_uf_origem ? String(pedido.cte_uf_origem).trim().toUpperCase() : '';
  const mesmoNome = (item) => {
    if (!nomeReal) return false;
    const nomeItem = String(item.transportadora || '').trim().toUpperCase();
    return nomeItem === nomeReal || nomeReal.includes(nomeItem) || nomeItem.includes(nomeReal);
  };
  const mesmoNomeEUf = (item) => mesmoNome(item) && ufReal && getUfByIbge(item.ibgeOrigem) === ufReal;

  const top8 = ordenados.slice(0, 8);
  let posicaoReal = ufReal ? ordenados.findIndex(mesmoNomeEUf) : -1;
  if (posicaoReal < 0) posicaoReal = ordenados.findIndex(mesmoNome);
  const candidatoReal = posicaoReal >= 0 ? ordenados[posicaoReal] : null;
  const realJaNoTop8 = candidatoReal ? top8.includes(candidatoReal) : true;
  const listaCandidatos = realJaNoTop8 || !candidatoReal ? top8 : [...top8, candidatoReal];

  const candidatosResumo = listaCandidatos.map((item) => ({
    transportadora: item.transportadora,
    origem: item.origem,
    origemValidada: Boolean(item.origemValidada),
    valor: item.total,
    prazo: item.prazo,
    faixaPeso: item.faixaPeso,
    pesoMinFaixa: item.pesoMinFaixa,
    pesoMaxFaixa: item.pesoMaxFaixa,
    ibgeDestino: item.ibgeDestino,
    rotaNome: item.rotaNome,
    tipoCalculo: item.tipoCalculo,
    ehOpcaoOriginal: Boolean(item.ehOpcaoOriginal),
    detalhes: item.detalhes?.frete || null,
    ehTransportadoraReal: item === candidatoReal,
    posicaoRanking: item === candidatoReal ? posicaoReal + 1 : null,
    totalCandidatos: item === candidatoReal ? ordenados.length : null,
  }));

  return {
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
    sim_mesma_transportadora: nomeCteResolvido
      ? String(nomeCteResolvido).trim().toUpperCase() === String(vencedor.transportadora).trim().toUpperCase()
      : null,
    sim_candidatos: candidatosResumo,
  };
}

// Fase 1 do fluxo por origem: dado o index de UMA origem so (malha pequena, carregada
// rapido), calcula os candidatos brutos (ainda nao ranqueados) de cada pedido que tem
// essa origem entre os seus "CDs com Saldo na Venda". Esses candidatos sao acumulados
// (staged) no banco; depois que todas as origens relevantes de um pedido passarem por
// aqui, calcularResultadoFinalEcommerce faz o ranking final entre todas elas.
export function calcularCandidatosOrigemEcommerce({ pedidos = [], mapasIbge, index, pesoBase = 'cotado' } = {}) {
  const saida = [];
  for (const pedido of pedidos) {
    const canal = categoriaCanalRealizado(pedido.canal || 'B2C');
    const ibgeDestino = resolverIbgeLocal(pedido.cidade, pedido.uf, mapasIbge) || '';
    if (!ibgeDestino) continue;
    const candidatosBrutos = index.get(`${canal}|${ibgeDestino}`) || [];
    if (!candidatosBrutos.length) continue;
    const cte = montarCteDoPedido(pedido, canal, ibgeDestino, pesoBase);
    const calculados = candidatosBrutos
      .map((candidato) => calcularItemTabela({ ...candidato, cte, gradeCanal: [] }))
      .filter(Boolean);
    if (calculados.length) saida.push({ pedidoId: pedido.id, canal, candidatos: calculados });
  }
  return saida;
}

// Fase 2 (fechamento): dado, para cada pedido, TODOS os candidatos ja acumulados (de
// todas as origens processadas), escolhe o vencedor e monta o resultado final - mesmo
// formato/regras de resimularLotePedidosEcommerce, so que os candidatos vieram
// acumulados em vez de calculados na hora a partir de um unico index.
export function calcularResultadoFinalEcommerce({ itens = [], criterioB2c, pesoBase = 'cotado', mapaVinculos = null } = {}) {
  return itens.map(({ pedido, canal, calculados }) => finalizarResultadoPedido(pedido, calculados, canal, { criterioB2c, pesoBase, mapaVinculos }));
}
