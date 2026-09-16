const grupos = [
  ['tda', 'TDA', ['tda']], ['tdr', 'TDR', ['tdr']], ['trt', 'TRT', ['trt']],
  ['suframa', 'SUFRAMA', ['suframa']], ['outras', 'Outras', ['outras']],
  ['gris', 'GRIS', ['gris', 'grisMinimo']], ['adVal', 'Ad Valorem', ['adVal', 'adValMinimo']],
];
const numero = (v) => typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.')) || 0;
const valor = (v) => String(numero(v)).replace('.', ',');
const chaveNome = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
export const VERUM_VERSAO_SEM_TAXA_PADRAO = { tda: true, tdr: true, trt: true, suframa: true, outras: true };

export function excessoVerum(cotacao = {}) {
  return String(cotacao.tipoCalculo || '').toUpperCase() === 'PERCENTUAL'
    ? numero(cotacao.rsKg) || cotacao.excesso || 0
    : cotacao.excesso ?? 0;
}

export function taxasVerum(taxa = {}) {
  const itens = grupos.filter(([, , campos]) => campos.some((c) => numero(taxa[c])))
    .map(([id, nome, campos]) => ({ id, nome, descricao: campos.map((c) => {
      if (!numero(taxa[c])) return '';
      const percentual = c === 'gris' || c === 'adVal';
      return `${nome}${c.endsWith('Minimo') ? ' MIN' : ''} ${valor(taxa[c])}${percentual ? '%' : ''}`;
    }).filter(Boolean).join(' - ') }));
  (taxa.taxasExtras || []).forEach((extra) => {
    const partes = [];
    if (numero(extra.pct)) partes.push(`${valor(extra.pct)}% NF`);
    if (numero(extra.valor)) partes.push(`R$ ${valor(extra.valor)} fixo`);
    if (numero(extra.valorPorPeso ?? extra.valor_por_peso)) partes.push(`R$ ${valor(extra.valorPorPeso ?? extra.valor_por_peso)}/${valor(numero(extra.pesoBase ?? extra.peso_base) || 100)} kg`);
    if (numero(extra.min)) partes.push(`MIN R$ ${valor(extra.min)}`);
    if (partes.length) itens.push({ id: `coringa:${chaveNome(extra.nome)}`, nome: extra.nome || 'Coringa', descricao: `${extra.nome || 'Coringa'} ${partes.join(' + ')}` });
  });
  return itens.sort((a, b) => a.id.localeCompare(b.id) || a.descricao.localeCompare(b.descricao));
}

export function opcoesTaxasVerum(rows = []) {
  return [...new Map(rows.flatMap(taxasVerum).map((item) => [item.id, item])).values()];
}

export function gerarDadosVerum(transportadora, origem = null) {
  const rotas = [], cotacoes = [];
  (origem ? [origem] : transportadora?.origens || []).forEach((origemItem) => {
    const emitidas = new Set();
    const config = { ...VERUM_VERSAO_SEM_TAXA_PADRAO, ...(origemItem.taxasEspeciais || []).find((t) => t.verumVersaoSemTaxa)?.verumVersaoSemTaxa };
    (origemItem.rotas || []).forEach((rota) => {
      const base = String(rota.cotacao || rota.nomeRota || '').trim();
      const taxa = (origemItem.taxasEspeciais || []).find((t) => String(t.ibgeDestino).trim() === String(rota.ibgeDestino).trim()) || {};
      const taxas = taxasVerum(taxa);
      const nome = (itens) => [base, ...itens.map((t) => t.descricao)].filter(Boolean).join(' - ');
      rotas.push({ ...rota, transportadora: transportadora.nome, origem: origemItem.cidade, canal: rota.canal || origemItem.canal, nomeRota: nome(taxas), cotacao: nome(taxas) });
      let combinacoes = [taxas];
      taxas.forEach((taxaItem) => {
        if ((taxa.verumVersaoSemTaxa?.[taxaItem.id] ?? config[taxaItem.id]) === true) combinacoes = [...combinacoes, ...combinacoes.map((itens) => itens.filter((t) => t.id !== taxaItem.id))];
      });
      const faixasChaves = new Set();
      const faixas = (origemItem.cotacoes || []).filter((c) => chaveNome(c.rota || c.nomeRota || c.cotacao) === chaveNome(base)
        && (c.grupoTabelaAlternativa || null) === (rota.grupoTabelaAlternativa || null))
        .filter((c) => {
          const chaveFaixa = JSON.stringify(['pesoMin', 'pesoMax', 'valorFixo', 'percentual', 'freteMinimo', 'rsKg', 'excesso', 'composicaoFrete', 'tipoCalculo'].map((campo) => c[campo] ?? ''));
          if (faixasChaves.has(chaveFaixa)) return false;
          faixasChaves.add(chaveFaixa);
          return true;
        });
      combinacoes.forEach((itens) => {
        const nomeRota = nome(itens);
        const chave = JSON.stringify([rota.grupoTabelaAlternativa || null, nomeRota]);
        if (emitidas.has(chave)) return;
        emitidas.add(chave);
        faixas.forEach((c) => cotacoes.push({ ...c, transportadora: transportadora.nome, origem: origemItem.cidade, canal: c.canal || origemItem.canal, rota: nomeRota }));
      });
    });
  });
  return { rotas, cotacoes };
}
