import { normalizarChaveCte } from './auditoriaFretesDomain';

// Correcoes manuais de uma fatura que entram no calculo dos CT-es (valor da NF, peso aplicado, NF/tracking manual,
// endereco, canal, reentrega e forma de peso escolhida na linha). Usado pelo Recalcular da tela da fatura e pelo
// Reavaliar do Robo Auditor: sem isso o robo recalculava ignorando as correcoes e sobrescrevia o resultado.

export function parseDetalhesCalculoAuditoria(valor) {
  if (!valor) return {};
  if (typeof valor === 'object') return valor;
  try { return JSON.parse(valor); } catch { return {}; }
}

export function numeroFlexAuditoria(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  const texto = String(valor ?? '').trim();
  if (!texto) return 0;
  const limpo = texto.replace(/R\$|kg|%/gi, '').replace(/\s/g, '');
  const normalizado = limpo.includes(',')
    ? limpo.replace(/\./g, '').replace(',', '.')
    : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : 0;
}

export function numeroValorNfAuditoria(item = {}, base = null) {
  const detalhes = parseDetalhesCalculoAuditoria(item.detalhes_calculo || base?.detalhes_calculo);
  const candidatos = [
    item.valor_nf,
    item.valorNF,
    item.nf_venda,
    item.valor_nota,
    item.valor_mercadoria,
    item.valorMercadoria,
    item.valor_produtos,
    item.valorProdutos,
    base?.valor_nf,
    base?.valorNF,
    base?.nf_venda,
    base?.valor_nota,
    base?.valor_mercadoria,
    base?.valorMercadoria,
    detalhes.valor_nf,
    detalhes.valorNF,
    detalhes.valorNf,
    detalhes.valor_nota,
    detalhes.valorNfInformado,
    detalhes.valorNFInformado,
    detalhes.resumo?.valor_nf,
    detalhes.resumo?.valorNF,
    detalhes.resumo?.valorNf,
    detalhes.frete?.valorNFInformado,
    detalhes.frete?.valorNf,
    detalhes.frete?.valor_nf,
  ];
  for (const candidato of candidatos) {
    const n = numeroFlexAuditoria(candidato);
    if (n > 0) return n;
  }
  return 0;
}

export function numeroPesoAuditoria(item = {}, base = null) {
  const detalhes = parseDetalhesCalculoAuditoria(item.detalhes_calculo || base?.detalhes_calculo);
  const candidatos = [
    item.peso,
    item.peso_declarado,
    item.pesoDeclarado,
    item.peso_final,
    item.pesoFinal,
    item.peso_total,
    item.pesoTotal,
    item.peso_kg,
    base?.peso,
    base?.peso_declarado,
    base?.pesoDeclarado,
    base?.peso_final,
    base?.pesoFinal,
    detalhes.peso_considerado,
    detalhes.peso_declarado_cte,
    detalhes.componentes_base?.pesoConsiderado,
    detalhes.frete?.pesoConsiderado,
  ];
  for (const candidato of candidatos) {
    const n = numeroFlexAuditoria(candidato);
    if (n > 0) return n;
  }
  return 0;
}

// alvo: detalhes da fatura ja mesclados com a referencia da auditoria (detalhes_calculo, valor_nf, peso).
// modoPorId: forma de peso escolhida agora na linha (tela). pesoTrackingMaisProximo: flag da fatura / do Reavaliar.
export function montarCorrecoesCalculoFatura(alvo = [], { modoPorId = null, pesoTrackingMaisProximo = false } = {}) {
  const valorNfOverridePorChave = {};
  const trackingOverridePorChave = {};
  const reentregaPorChave = {};
  const modoPesoPorChave = {};
  // Chaves que entram na escolha automatica de peso, exceto as com forma escolhida agora na linha.
  const chavesAutoPeso = new Set();
  alvo.forEach((item) => {
    const chave = normalizarChaveCte(item.chave_cte) || normalizarChaveCte(item.numero_cte);
    if (!chave) return;
    // Modo de peso do CT-e: o escolhido agora na linha, senao o que ja estava
    // gravado no ultimo calculo. Padrao = peso do CT-e.
    const modoGravado = parseDetalhesCalculoAuditoria(item.detalhes_calculo).modo_peso_fatura;
    const modoEscolhido = modoPorId?.[item.id] ?? (['tracking', 'tracking_original'].includes(modoGravado) ? modoGravado : 'cte');
    if (modoEscolhido !== 'cte') modoPesoPorChave[chave] = modoEscolhido;
    if (pesoTrackingMaisProximo && modoPorId?.[item.id] === undefined) chavesAutoPeso.add(chave);
    const valorNfPreservado = numeroValorNfAuditoria(item);
    // O `peso` salvo na linha pode ser o peso da melhor alternativa que o
    // motor escolheu sozinho (ex.: cubado errado de 75,6 kg), nao o do CT-e.
    // So preserva o salvo quando o usuario aplicou o peso manualmente
    // (alternativa_peso_aplicada); senao nao preserva e o calculo le o peso
    // do CT-e na base (o proprio detalhe salvo pode carregar o peso errado).
    const detalhesPeso = parseDetalhesCalculoAuditoria(item.detalhes_calculo);
    const pesoManual = Boolean(detalhesPeso.alternativa_peso_aplicada) || item.tracking_manual_nf;
    const pesoPreservado = pesoManual ? numeroPesoAuditoria(item) : 0;
    if (valorNfPreservado > 0) valorNfOverridePorChave[chave] = valorNfPreservado;
    if (pesoPreservado > 0 || valorNfPreservado > 0) {
      trackingOverridePorChave[chave] = {
        ...trackingOverridePorChave[chave],
        valorNF: valorNfPreservado,
        peso: pesoPreservado,
        pesoDeclarado: pesoPreservado,
      };
    }
    if (item.tracking_manual_nf) {
      trackingOverridePorChave[chave] = {
        ...trackingOverridePorChave[chave],
        chaveNfe: item.chave_nf_manual || item.chave_nfe_manual || '',
        valorNF: Number(item.valor_nf || 0),
        peso: Number(item.peso || 0),
        pesoDeclarado: Number(item.peso || 0),
        cubagemFinal: Number(item.cubagem || 0),
        qtdVolumes: Number(item.qtd_volumes || 0),
        canal: item.canal || '',
        cidadeOrigem: item.cidade_origem || '',
        ufOrigem: item.uf_origem || '',
        cidadeDestino: item.cidade_destino || '',
        ufDestino: item.uf_destino || '',
        ibgeOrigem: item.ibge_origem || '',
        ibgeDestino: item.ibge_destino || '',
      };
    }
    if (item.endereco_corrigido_manual) {
      trackingOverridePorChave[chave] = {
        ...trackingOverridePorChave[chave],
        cidadeOrigem: item.cidade_origem || '',
        ufOrigem: item.uf_origem || '',
        ibgeOrigem: item.ibge_origem || '',
        cidadeDestino: item.cidade_destino || '',
        ufDestino: item.uf_destino || '',
        ibgeDestino: item.ibge_destino || '',
      };
    }
    if (item.canal_corrigido_manual) {
      trackingOverridePorChave[chave] = {
        ...trackingOverridePorChave[chave],
        canal: item.canal || '',
      };
    }
    if (item.reentrega_manual) reentregaPorChave[chave] = true;
  });
  return { valorNfOverridePorChave, trackingOverridePorChave, reentregaPorChave, modoPesoPorChave, chavesAutoPeso };
}
