import { montarCotacaoPadrao } from './formatacaoTabela';

function limpar(valor) {
  return String(valor ?? '').trim();
}

function paraNumero(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const texto = String(valor)
    .replace(/R\$/gi, '')
    .replace(/%/g, '')
    .trim()
    .replace(/\./g, '')
    .replace(',', '.');
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : null;
}

function extrairFaixa(textoFaixa) {
  const texto = limpar(textoFaixa);
  const match = texto.match(/(\d+[.,]?\d*)\s*(?:a|até|-).*?(\d+[.,]?\d*)/i);
  if (!match) return { pesoInicial: null, pesoFinal: null, faixaLabel: texto };
  return {
    pesoInicial: paraNumero(match[1]),
    pesoFinal: paraNumero(match[2]),
    faixaLabel: texto,
  };
}

function detectarBlocos(linha1 = [], linha2 = []) {
  const blocos = [];
  for (let i = 4; i < Math.max(linha1.length, linha2.length); i += 2) {
    const cotacaoBase = limpar(linha1[i]);
    const tipoFrete = limpar(linha2[i]);
    const tipoAdValorem = limpar(linha2[i + 1]);
    if (!cotacaoBase) continue;
    if (/frete\s*kg/i.test(tipoFrete) && /ad\s*valorem/i.test(tipoAdValorem)) {
      blocos.push({ cotacaoBase, colunaFrete: i, colunaAdValorem: i + 1 });
    }
  }
  return blocos;
}

export function converterTemplatePrecificacaoParaFretes({ linhas = [], dadosGerais = {} }) {
  if (!Array.isArray(linhas) || linhas.length < 3) return [];

  const linha1 = linhas[0] || [];
  const linha2 = linhas[1] || [];
  const blocos = detectarBlocos(linha1, linha2);
  const origemPadrao = limpar(dadosGerais.origemNome || dadosGerais.origem || '');

  const resultado = [];
  for (let i = 2; i < linhas.length; i += 1) {
    const linha = linhas[i] || [];
    const origem = limpar(linha[0]) || origemPadrao;
    const ufOrigem = limpar(linha[1]);
    const ufDestino = limpar(linha[2]);
    const { pesoInicial, pesoFinal, faixaLabel } = extrairFaixa(linha[3]);

    blocos.forEach((bloco) => {
      const freteValor = paraNumero(linha[bloco.colunaFrete]);
      const fretePercentual = paraNumero(linha[bloco.colunaAdValorem]);
      if (freteValor === null && fretePercentual === null) return;

      resultado.push({
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

  return resultado;
}
