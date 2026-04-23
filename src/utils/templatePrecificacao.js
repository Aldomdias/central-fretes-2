// Parser de template de precificação
// Objetivo: ler template no formato de origem/UF/faixa e blocos de cotação,
// convertendo para linhas internas de frete já padronizadas.
//
// Estrutura esperada no template:
// CIDADE DE ORIGEM | UF ORIGEM | UF DESTINO | FAIXA PESO |
// CAPITAL Frete kg (R$) | CAPITAL Ad Valorem(%) |
// INTERIOR 1 Frete kg (R$) | INTERIOR 1 Ad Valorem(%) | ...

import { montarCotacaoPadrao, normalizarChave } from "./formatacaoTabela";

function limpar(valor) {
  return String(valor ?? "").trim();
}

function paraNumero(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  const texto = String(valor).trim().replace(/\./g, "").replace(",", ".");
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : null;
}

function extrairFaixa(textoFaixa) {
  const texto = limpar(textoFaixa);
  if (!texto) return { pesoInicial: null, pesoFinal: null, faixaLabel: "" };

  const match = texto.match(/(\d+[.,]?\d*)\s*(?:a|até|-)\s*(\d+[.,]?\d*)/i);
  if (match) {
    return {
      pesoInicial: paraNumero(match[1]),
      pesoFinal: paraNumero(match[2]),
      faixaLabel: texto
    };
  }

  return {
    pesoInicial: null,
    pesoFinal: null,
    faixaLabel: texto
  };
}

function detectarColunasDeCotacao(headers = []) {
  const blocos = [];
  for (let i = 0; i < headers.length; i++) {
    const atual = limpar(headers[i]);
    const proximo = limpar(headers[i + 1]);

    const ehFrete = /frete\s*kg/i.test(atual);
    const ehAdValorem = /ad\s*valorem/i.test(proximo);

    if (ehFrete && ehAdValorem) {
      const nomeBase = atual.replace(/frete\s*kg.*$/i, "").trim();
      blocos.push({
        cotacaoBase: nomeBase,
        colunaFrete: i,
        colunaAdValorem: i + 1
      });
      i += 1;
    }
  }
  return blocos;
}

export function converterTemplatePrecificacaoParaFretes({
  linhas = [],
  dadosGerais = {}
}) {
  if (!Array.isArray(linhas) || linhas.length < 2) return [];

  const headers = (linhas[0] || []).map((v) => limpar(v));
  const blocos = detectarColunasDeCotacao(headers);

  const idxCidadeOrigem = headers.findIndex((h) => normalizarChave(h) === "CIDADE DE ORIGEM");
  const idxUfOrigem = headers.findIndex((h) => normalizarChave(h) === "UF ORIGEM");
  const idxUfDestino = headers.findIndex((h) => normalizarChave(h) === "UF DESTINO");
  const idxFaixaPeso = headers.findIndex((h) => normalizarChave(h) === "FAIXA PESO");

  const origemPadrao =
    limpar(dadosGerais?.origemNome) ||
    limpar(dadosGerais?.origem) ||
    limpar(dadosGerais?.cidadeOrigem);

  const resultado = [];

  for (let r = 1; r < linhas.length; r++) {
    const linha = linhas[r] || [];
    const origem = limpar(linha[idxCidadeOrigem]) || origemPadrao;
    const ufOrigem = limpar(linha[idxUfOrigem]) || "";
    const ufDestino = limpar(linha[idxUfDestino]) || "";
    const { pesoInicial, pesoFinal, faixaLabel } = extrairFaixa(linha[idxFaixaPeso]);

    for (const bloco of blocos) {
      const freteValor = paraNumero(linha[bloco.colunaFrete]);
      const adValorem = paraNumero(linha[bloco.colunaAdValorem]);

      if (freteValor === null && adValorem === null) continue;

      const cotacao = montarCotacaoPadrao({
        origem,
        ufDestino,
        cotacaoBase: bloco.cotacaoBase
      });

      resultado.push({
        origem,
        ufOrigem,
        ufDestino,
        cotacaoBase: bloco.cotacaoBase,
        cotacao,
        faixaPeso: faixaLabel,
        pesoInicial,
        pesoFinal,
        freteValor,
        fretePercentual: adValorem,
        taxaAplicada: null,
        freteMinimo: null,
        excedente: null,
        origemImportacao: "template_precificacao"
      });
    }
  }

  return resultado;
}
