import { montarCotacaoPadrao, normalizarChave } from './formatacaoTabela';

function limpar(valor) {
  return String(valor ?? '').trim();
}

function paraNumero(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const texto = String(valor).trim().replace(/\./g, '').replace(',', '.');
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : null;
}

function extrairFaixa(textoFaixa) {
  const texto = limpar(textoFaixa);
  const match = texto.match(/(\d+[.,]?\d*)\s*(?:a|até|-)\s*(\d+[.,]?\d*)/i);
  if (!match) return { pesoInicial: null, pesoFinal: null, faixaLabel: texto };
  return {
    pesoInicial: paraNumero(match[1]),
    pesoFinal: paraNumero(match[2]),
    faixaLabel: texto,
  };
}

function detectarColunasDeCotacao(headers = []) {
  const blocos = [];
  for (let i = 0; i < headers.length; i += 1) {
    const atual = limpar(headers[i]);
    const proximo = limpar(headers[i + 1]);
    if (/frete\s*kg/i.test(atual) && /ad\s*valorem/i.test(proximo)) {
      blocos.push({
        cotacaoBase: atual.replace(/frete\s*kg.*$/i, '').trim(),
        colunaFrete: i,
        colunaAdValorem: i + 1,
      });
      i += 1;
    }
  }
  return blocos;
}

export function converterTemplatePrecificacaoParaFretes({ linhas = [], dadosGerais = {} }) {
  if (!Array.isArray(linhas) || linhas.length < 2) return [];
  const headers = (linhas[0] || []).map(limpar);
  const blocos = detectarColunasDeCotacao(headers);

  const idxCidadeOrigem = headers.findIndex((h) => normalizarChave(h) === 'CIDADE DE ORIGEM');
  const idxUfOrigem = headers.findIndex((h) => normalizarChave(h) === 'UF ORIGEM');
  const idxUfDestino = headers.findIndex((h) => normalizarChave(h) === 'UF DESTINO');
  const idxFaixaPeso = headers.findIndex((h) => normalizarChave(h) === 'FAIXA PESO');

  const origemPadrao = limpar(dadosGerais.origemNome || dadosGerais.origem || '');
  const linhasGeradas = [];

  for (let i = 1; i < linhas.length; i += 1) {
    const linha = linhas[i] || [];
    const origem = limpar(linha[idxCidadeOrigem]) || origemPadrao;
    const ufOrigem = limpar(linha[idxUfOrigem]);
    const ufDestino = limpar(linha[idxUfDestino]);
    const { pesoInicial, pesoFinal, faixaLabel } = extrairFaixa(linha[idxFaixaPeso]);

    blocos.forEach((bloco) => {
      const freteValor = paraNumero(linha[bloco.colunaFrete]);
      const fretePercentual = paraNumero(linha[bloco.colunaAdValorem]);
      if (freteValor === null && fretePercentual === null) return;

      linhasGeradas.push({
        cotacaoBase: bloco.cotacaoBase,
        cotacao: montarCotacaoPadrao({ origem, ufDestino, cotacaoBase: bloco.cotacaoBase }),
        origem,
        ufOrigem,
        ufDestino,
        faixaNome: faixaLabel,
        pesoInicial,
        pesoFinal,
        freteValor: freteValor ?? '',
        fretePercentual: fretePercentual ?? '',
        freteMinimo: '',
        taxaAplicada: '',
        excedente: '',
        origemImportacao: 'template_precificacao',
      });
    });
  }

  return linhasGeradas;
}
