function texto(valor) {
  return String(valor ?? '').trim();
}

function numero(valor) {
  if (valor === '' || valor === null || valor === undefined) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function chave(valor) {
  return texto(valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

function falha(codigo, severidade, descricao, detalhes = {}) {
  return { codigo, tipo: codigo.toLowerCase(), severidade, descricao, ...detalhes };
}

export function deduplicarLinhasParaIa(linhas = [], mapeamento = {}) {
  const camposChave = ['origem', 'ufOrigem', 'destino', 'ufDestino', 'rota', 'pesoMin', 'pesoMax', 'taxa', 'percentual', 'freteMinimo', 'excesso', 'prazo'];
  const vistos = new Set();
  const unicas = [];

  linhas.forEach((row = {}) => {
    const valoresMapeados = camposChave.map((campo) => texto(row[mapeamento[campo]]).toUpperCase());
    const possuiValorMapeado = valoresMapeados.some(Boolean);
    const chaveLinha = possuiValorMapeado
      ? `MAPA:${valoresMapeados.join('|')}`
      : `BRUTA:${JSON.stringify(Object.entries(row)
        .filter(([campo]) => campo !== '__aba')
        .sort(([campoA], [campoB]) => campoA.localeCompare(campoB))
        .map(([campo, valor]) => [campo, texto(valor).toUpperCase()]))}`;

    if (vistos.has(chaveLinha)) return;
    vistos.add(chaveLinha);
    unicas.push(row);
  });

  return unicas;
}

export function auditarResultadoIa(resultado = {}, contexto = {}) {
  const falhas = [];
  const rotas = Array.isArray(resultado.rotas) ? resultado.rotas : [];
  const fretes = Array.isArray(resultado.fretes) ? resultado.fretes : [];
  const mapa = contexto.mapeamento || {};

  ['origem', 'rota'].forEach((campo) => {
    if (!texto(mapa[campo])) falhas.push(falha('COLUNA_NAO_MAPEADA', 'ALERTA', `A coluna de ${campo} não foi identificada no arquivo.`, { campo }));
  });
  if (!texto(mapa.taxa) && !texto(mapa.percentual)) {
    falhas.push(falha('PRECO_NAO_MAPEADO', 'BLOQUEANTE', 'Nenhuma coluna de taxa ou percentual foi mapeada.'));
  }

  const chavesRotas = new Set(rotas.map((r) => chave(r.cotacao)).filter(Boolean));
  const chavesFretes = new Set(fretes.map((f) => chave(f.cotacao || f.faixa_peso)).filter(Boolean));
  chavesRotas.forEach((cotacao) => {
    if (!chavesFretes.has(cotacao)) falhas.push(falha('ROTA_SEM_FRETE', 'BLOQUEANTE', `A rota ${cotacao} não possui tarifa correspondente.`, { cotacao }));
  });
  chavesFretes.forEach((cotacao) => {
    if (!chavesRotas.has(cotacao)) falhas.push(falha('FRETE_SEM_ROTA', 'BLOQUEANTE', `A tarifa ${cotacao} não possui rota de atendimento correspondente.`, { cotacao }));
  });

  const destinos = new Set();
  rotas.forEach((rota, index) => {
    const ref = texto(rota.cotacao) || `linha ${index + 1}`;
    if (!texto(rota.ibge_destino)) falhas.push(falha('IBGE_DESTINO_AUSENTE', 'BLOQUEANTE', `${ref}: código IBGE de destino ausente.`, { indice: index }));
    if (!texto(rota.cep_inicial) || !texto(rota.cep_final)) falhas.push(falha('CEP_AUSENTE', 'ALERTA', `${ref}: faixa de CEP incompleta.`, { indice: index }));
    if (numero(rota.prazo) === null || numero(rota.prazo) === 999) falhas.push(falha('PRAZO_PENDENTE', 'ALERTA', `${ref}: prazo pendente de confirmação.`, { indice: index }));
    const destino = `${texto(rota.ibge_destino)}|${chave(rota.cotacao)}`;
    if (destinos.has(destino)) falhas.push(falha('ROTA_DUPLICADA', 'ALERTA', `${ref}: rota duplicada para o mesmo destino.`, { indice: index }));
    destinos.add(destino);
  });

  const porCotacao = new Map();
  fretes.forEach((frete, index) => {
    const cotacao = chave(frete.cotacao || frete.faixa_peso);
    if (!cotacao) falhas.push(falha('COTACAO_AUSENTE', 'BLOQUEANTE', `Frete ${index + 1}: código da rota ausente.`, { indice: index }));
    const minimo = numero(frete.peso_inicial);
    const maximo = numero(frete.peso_final);
    if (minimo === null || maximo === null || minimo < 0 || maximo <= minimo) {
      falhas.push(falha('FAIXA_INVALIDA', 'BLOQUEANTE', `${cotacao || `frete ${index + 1}`}: faixa de peso inválida (${minimo ?? '-'} a ${maximo ?? '-'}).`, { indice: index }));
    }
    const componentes = [frete.taxa_aplicada, frete.frete_percentual, frete.frete_minimo, frete.valor_excedente]
      .map(numero).filter((v) => v !== null);
    if (!componentes.some((v) => v > 0)) falhas.push(falha('VALOR_FRETE_AUSENTE', 'BLOQUEANTE', `${cotacao || `frete ${index + 1}`}: nenhum componente de frete possui valor positivo.`, { indice: index }));
    if (!porCotacao.has(cotacao)) porCotacao.set(cotacao, []);
    porCotacao.get(cotacao).push({ minimo, maximo, index });
  });

  porCotacao.forEach((faixas, cotacao) => {
    faixas.sort((a, b) => (a.minimo ?? 0) - (b.minimo ?? 0));
    for (let i = 1; i < faixas.length; i += 1) {
      const anterior = faixas[i - 1];
      const atual = faixas[i];
      if (anterior.maximo === null || atual.minimo === null) continue;
      if (atual.minimo > anterior.maximo) falhas.push(falha('BURACO_FAIXA_PESO', 'ALERTA', `${cotacao}: existe intervalo entre ${anterior.maximo} e ${atual.minimo} kg.`));
      if (atual.minimo < anterior.maximo) falhas.push(falha('SOBREPOSICAO_FAIXA_PESO', 'BLOQUEANTE', `${cotacao}: as faixas se sobrepõem em ${atual.minimo} kg.`));
    }
  });

  const inicio = texto(resultado.vigencia?.inicio);
  const fim = texto(resultado.vigencia?.fim);
  if (!inicio || !fim || Number.isNaN(Date.parse(inicio)) || Number.isNaN(Date.parse(fim))) {
    falhas.push(falha('VIGENCIA_INVALIDA', 'BLOQUEANTE', 'A vigência está ausente ou possui formato inválido.'));
  } else if (inicio > fim) {
    falhas.push(falha('VIGENCIA_INVERTIDA', 'BLOQUEANTE', 'O início da vigência é posterior ao fim.'));
  }

  (resultado.gaps || []).forEach((gap) => falhas.push({
    ...gap,
    codigo: gap.codigo || chave(gap.tipo) || 'GAP_IA',
    severidade: gap.severidade || 'ALERTA',
    origem: 'IA',
  }));

  return falhas.filter((item, index, lista) => lista.findIndex((outro) =>
    outro.codigo === item.codigo && outro.descricao === item.descricao
  ) === index);
}

export function normalizarResultadoIa(resultado = {}, contexto = {}) {
  const transportadora = texto(resultado.transportadora) || texto(contexto.transportadora);
  const origemPadrao = resultado.origem || {};
  const vigencia = resultado.vigencia || {};

  const rotas = (resultado.rotas || []).map((rota) => ({
    tipo_item: 'ROTA',
    cidade_origem: texto(rota.cidade_origem) || texto(origemPadrao.cidade),
    uf_origem: texto(rota.uf_origem) || texto(origemPadrao.uf),
    ibge_origem: texto(rota.ibge_origem) || texto(origemPadrao.ibge),
    cidade_destino: texto(rota.cidade_destino),
    uf_destino: texto(rota.uf_destino),
    ibge_destino: texto(rota.ibge_destino),
    faixa_peso: 'ROTA',
    prazo: numero(rota.prazo),
    origem_importacao: 'IMPORTACAO_IA_KIMI_K3',
    cotacao: texto(rota.cotacao),
    cep_inicial: texto(rota.cep_inicial),
    cep_final: texto(rota.cep_final),
    inicio_vigencia: texto(rota.inicio_vigencia) || texto(vigencia.inicio),
    fim_vigencia: texto(rota.fim_vigencia) || texto(vigencia.fim),
  }));

  const fretes = (resultado.fretes || []).map((frete) => ({
    tipo_item: 'COTACAO',
    cidade_origem: texto(frete.cidade_origem) || texto(origemPadrao.cidade),
    uf_origem: texto(frete.uf_origem) || texto(origemPadrao.uf),
    uf_destino: texto(frete.uf_destino),
    faixa_peso: texto(frete.rota_do_frete),
    peso_inicial: numero(frete.peso_minimo),
    peso_final: numero(frete.peso_limite),
    excesso_kg: numero(frete.excesso_de_peso),
    valor_excedente: numero(frete.excesso_de_peso),
    taxa_aplicada: numero(frete.taxa_aplicada),
    frete_percentual: numero(frete.frete_percentual),
    frete_minimo: numero(frete.frete_minimo),
    origem_importacao: 'IMPORTACAO_IA_KIMI_K3',
    cotacao: texto(frete.rota_do_frete),
    inicio_vigencia: texto(frete.inicio_vigencia) || texto(vigencia.inicio),
    fim_vigencia: texto(frete.fim_vigencia) || texto(vigencia.fim),
  }));

  return {
    transportadora,
    origem: origemPadrao,
    vigencia,
    itens: rotas.concat(fretes),
    rotas,
    fretes,
    generalidades: resultado.generalidades || {},
    gaps: Array.isArray(resultado.gaps) ? resultado.gaps : [],
    resumo: resultado.resumo || {},
  };
}

export function validarResultadoIa(resultado = {}, contexto = {}) {
  const erros = [];
  if (!texto(resultado.transportadora)) erros.push('Transportadora não identificada.');
  if (!(resultado.rotas || []).length) erros.push('Nenhuma rota válida foi gerada.');
  if (!(resultado.fretes || []).length) erros.push('Nenhum frete válido foi gerado.');
  if (!texto(resultado.vigencia?.inicio) || !texto(resultado.vigencia?.fim)) erros.push('Vigência incompleta.');
  auditarResultadoIa(resultado, contexto)
    .filter((item) => item.severidade === 'BLOQUEANTE')
    .forEach((item) => erros.push(item.descricao));
  return erros;
}
