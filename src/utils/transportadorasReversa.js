// Marcacao de quais transportadoras fazem logistica reversa.
// Nem toda transportadora contratada faz coleta reversa, entao o Simulador
// Reversa nao pode ranquear todo mundo que tem tabela pra rota — apareceria
// uma opcao mais barata que a operacao nao consegue acionar.

export function normalizarNomeReversa(valor = '') {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizarMarcacaoReversa(item = {}) {
  const transportadora = String(item.transportadora ?? item.nome ?? '').trim();
  const norm = String(item.transportadoraNorm ?? item.transportadora_norm ?? '').trim()
    || normalizarNomeReversa(transportadora);
  return {
    id: String(item.id ?? norm ?? '').trim(),
    transportadora,
    transportadoraNorm: norm,
  };
}

export function marcacaoReversaValida(item = {}) {
  return Boolean(item?.transportadora && item?.transportadoraNorm);
}

// Set de nomes normalizados, pronto pra filtrar o resultado da simulacao.
export function criarSetTransportadorasReversa(lista = []) {
  return new Set(
    (lista || [])
      .map(normalizarMarcacaoReversa)
      .filter(marcacaoReversaValida)
      .map((item) => item.transportadoraNorm),
  );
}

// Sem nenhuma marcacao ainda a tela nao pode ficar vazia: enquanto o cadastro
// nao existe, todo mundo passa e a tela avisa que o filtro esta desligado.
export function fazReversa(nomeTransportadora, setReversa) {
  if (!setReversa || !setReversa.size) return true;
  return setReversa.has(normalizarNomeReversa(nomeTransportadora));
}

export function ehRecoliReversa(nomeTransportadora = '') {
  return normalizarNomeReversa(nomeTransportadora).split(' ').includes('recoli');
}

export function mesmaTransportadoraReversa(nomeCandidata = '', nomeEntrega = '') {
  const candidata = normalizarNomeReversa(nomeCandidata);
  const entrega = normalizarNomeReversa(nomeEntrega);
  if (!candidata || !entrega) return false;
  if (candidata === entrega) return true;

  const tokensCandidata = candidata.split(' ').filter(Boolean);
  const tokensEntrega = entrega.split(' ').filter(Boolean);
  // Permite cadastros abreviados como "FL" contra "FL TRANSPORTES", sem
  // aceitar substring solta dentro de outra palavra.
  return (tokensCandidata.length === 1 && tokensEntrega.includes(tokensCandidata[0]))
    || (tokensEntrega.length === 1 && tokensCandidata.includes(tokensEntrega[0]));
}

export function elegivelParaReversa(nomeCandidata, nomeEntrega, setReversa) {
  if (!fazReversa(nomeCandidata, setReversa)) return false;
  // Sem configuração, preserva o comportamento seguro de contingência da tela.
  if (!setReversa || !setReversa.size) return true;
  if (ehRecoliReversa(nomeCandidata)) return true;
  return mesmaTransportadoraReversa(nomeCandidata, nomeEntrega);
}
