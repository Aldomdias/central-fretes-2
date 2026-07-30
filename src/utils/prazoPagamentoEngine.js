// Motor de cálculo do Prazo Médio de Pagamento.
//
// Duas leituras do mesmo prazo:
// - "Fatura": Vencimento - Emissão da Fatura (o que a transportadora lança).
// - "Real": Vencimento - Emissão do CT-e (o que efetivamente aconteceu,
//   já que o transportador só emite o CT-e depois de entregar a carga —
//   segurando a emissão empurra o prazo real para cima).

function diasEntre(inicioISO, fimISO) {
  if (!inicioISO || !fimISO) return null;
  const ini = new Date(`${String(inicioISO).slice(0, 10)}T00:00:00Z`);
  const fim = new Date(`${String(fimISO).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(ini.getTime()) || Number.isNaN(fim.getTime())) return null;
  return Math.round((fim - ini) / 86400000);
}

// Primeira palavra do nome do tomador — aproxima o "grupo" comercial
// (ex.: "CPX DISTRIBUIDORA S/A" -> "CPX", "ITR PNEUS" -> "ITR").
function grupoTomador(nome) {
  if (!nome) return null;
  return String(nome).trim().split(/\s+/)[0].toUpperCase();
}

// Normaliza cada linha de fatura_detalhes+fatura+cte em um registro com os dois prazos.
export function normalizarLinhasPrazo(linhas = []) {
  return (linhas || [])
    .map((l) => {
      const prazoFatura = diasEntre(l.data_emissao_fatura, l.data_vencimento);
      // gap_emissao = Emissão Fatura − Emissão CT-e. Fisicamente a fatura só
      // pode ser lançada depois (ou no mesmo dia) do CT-e ser emitido — se der
      // negativo, a data de emissão do CT-e nessa base está errada. Nesse caso
      // usamos a própria data da fatura como emissão do CT-e (equivale a gap
      // zero), em vez de descartar a linha como "não localizada".
      const gapBruto = l.data_emissao_cte ? diasEntre(l.data_emissao_cte, l.data_emissao_fatura) : null;
      const emissaoCteInvalida = gapBruto != null && gapBruto < 0;
      const dataEmissaoCteValida = emissaoCteInvalida ? l.data_emissao_fatura : l.data_emissao_cte;
      const prazoReal = dataEmissaoCteValida ? diasEntre(dataEmissaoCteValida, l.data_vencimento) : null;
      return {
        ...l,
        data_emissao_cte: dataEmissaoCteValida,
        prazo_fatura: prazoFatura,
        prazo_real: prazoReal,
        gap_emissao: emissaoCteInvalida ? null : gapBruto,
        emissao_cte_invalida: emissaoCteInvalida,
        mes_emissao_cte: dataEmissaoCteValida ? String(dataEmissaoCteValida).slice(0, 7) : null,
        mes_emissao_fatura: l.data_emissao_fatura ? String(l.data_emissao_fatura).slice(0, 7) : null,
        grupo_tomador: grupoTomador(l.nome_tomador),
      };
    })
    .filter((l) => l.prazo_fatura != null && l.prazo_fatura >= 0);
}

function media(lista, campo) {
  const validos = lista.filter((l) => l[campo] != null);
  if (!validos.length) return null;
  return validos.reduce((s, l) => s + l[campo], 0) / validos.length;
}

function mediaPonderada(lista, campo, peso = 'valor_frete') {
  const validos = lista.filter((l) => l[campo] != null && Number.isFinite(l[peso]));
  const somaPeso = validos.reduce((s, l) => s + (l[peso] || 0), 0);
  if (!somaPeso) return null;
  const somaPonderada = validos.reduce((s, l) => s + l[campo] * (l[peso] || 0), 0);
  return somaPonderada / somaPeso;
}

export function calcularIndicadores(linhas) {
  const qtd = linhas.length;
  const qtdComCte = linhas.filter((l) => l.prazo_real != null).length;
  const qtdFaturas = new Set(linhas.map((l) => l.fatura_id).filter(Boolean)).size;
  const valorTotal = linhas.reduce((s, l) => s + (l.valor_frete || 0), 0);
  return {
    qtd,
    qtdComCte,
    qtdFaturas,
    valorTotal,
    prazoFaturaSimples: media(linhas, 'prazo_fatura'),
    prazoFaturaPonderado: mediaPonderada(linhas, 'prazo_fatura'),
    prazoRealSimples: media(linhas, 'prazo_real'),
    prazoRealPonderado: mediaPonderada(linhas, 'prazo_real'),
    gapMedioSimples: media(linhas, 'gap_emissao'),
    gapMedioPonderado: mediaPonderada(linhas, 'gap_emissao'),
  };
}

export function agruparPor(linhas, campo) {
  const grupos = new Map();
  linhas.forEach((l) => {
    const chave = l[campo] || '(sem valor)';
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(l);
  });
  return [...grupos.entries()]
    .map(([chave, itens]) => ({ chave, ...calcularIndicadores(itens) }))
    .sort((a, b) => b.valorTotal - a.valorTotal);
}

export function evolucaoMensal(linhas) {
  return agruparPor(linhas, 'mes_emissao_cte')
    .filter((g) => g.chave !== '(sem valor)')
    .sort((a, b) => (a.chave < b.chave ? -1 : 1));
}

// A transportadora costuma negociar um prazo fixo (ex.: sempre 28 dias).
// A "moda" (valor mais frequente) do Prazo Fatura por transportadora
// aproxima esse prazo contratual — mais robusta que a média porque não é
// puxada pelos próprios outliers que queremos detectar.
function modaPrazo(valores) {
  const contagem = new Map();
  valores.forEach((v) => contagem.set(v, (contagem.get(v) || 0) + 1));
  let melhorValor = null;
  let melhorContagem = 0;
  contagem.forEach((qtd, valor) => {
    if (qtd > melhorContagem) {
      melhorContagem = qtd;
      melhorValor = valor;
    }
  });
  return { valor: melhorValor, qtd: melhorContagem };
}

// Sinaliza CT-es cujo Prazo Fatura destoa do padrão da própria transportadora
// — ex.: transportadora sempre fatura com 28 dias e aparece um registro com
// 10 dias. É provável lançamento errado (fatura devolvida/corrigida depois),
// não uma renegociação real.
export function detectarPrazosAtipicos(linhas, { minAmostras = 5, desvioMinimoDias = 5 } = {}) {
  const porTransportadora = new Map();
  linhas.forEach((l) => {
    if (l.prazo_fatura == null) return;
    const chave = l.transportadora || '(sem valor)';
    if (!porTransportadora.has(chave)) porTransportadora.set(chave, []);
    porTransportadora.get(chave).push(l);
  });

  const atipicos = [];
  porTransportadora.forEach((itens, transportadora) => {
    if (itens.length < minAmostras) return;
    const { valor: prazoTipico, qtd: qtdNoPadrao } = modaPrazo(itens.map((l) => l.prazo_fatura));
    if (prazoTipico == null) return;
    // Só sinaliza quando o padrão é de fato dominante (maioria dos CT-es
    // dessa transportadora bate no mesmo prazo) — senão não há "padrão".
    if (qtdNoPadrao / itens.length < 0.5) return;

    itens.forEach((l) => {
      const desvio = l.prazo_fatura - prazoTipico;
      if (Math.abs(desvio) >= desvioMinimoDias) {
        atipicos.push({ ...l, transportadora, prazoTipico, qtdNoPadrao, totalTransportadora: itens.length, desvio });
      }
    });
  });

  return atipicos.sort((a, b) => Math.abs(b.desvio) - Math.abs(a.desvio));
}
