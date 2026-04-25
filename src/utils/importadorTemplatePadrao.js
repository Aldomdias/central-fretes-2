
import * as XLSX from "xlsx";

function limpar(valor) {
  return String(valor ?? "").trim();
}

function normalizar(valor) {
  return limpar(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function paraNumero(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  const texto = String(valor).trim();
  if (!texto) return null;
  const temVirgula = texto.includes(",");
  let preparado = texto.replace(/\s/g, "");
  if (temVirgula) preparado = preparado.replace(/\./g, "").replace(",", ".");
  const n = Number(preparado);
  return Number.isFinite(n) ? n : null;
}

function extrairFaixa(texto) {
  const bruto = limpar(texto);
  if (!bruto) return { faixaPeso: "", pesoInicial: null, pesoFinal: null };
  const match = bruto.match(/(\d+[.,]?\d*)\s*(?:a|até|ate|-|\/)\s*(\d+[.,]?\d*)/i);
  if (!match) return { faixaPeso: bruto, pesoInicial: null, pesoFinal: null };
  return {
    faixaPeso: bruto,
    pesoInicial: paraNumero(match[1]),
    pesoFinal: paraNumero(match[2]),
  };
}

function montarCotacaoFinal({ origem, ufDestino, cotacaoBase }) {
  return [limpar(origem), limpar(ufDestino).toUpperCase(), limpar(cotacaoBase).toUpperCase()]
    .filter(Boolean)
    .join(" - ");
}

function detectarCotacaoBase(valorRegiao) {
  const texto = normalizar(valorRegiao);
  if (!texto) return "";
  if (texto.includes("CAPITAL")) return "CAPITAL";
  if (texto.includes("INTERIOR 1")) return "INTERIOR 1";
  if (texto.includes("INTERIOR 2")) return "INTERIOR 2";
  if (texto.includes("INTERIOR 3")) return "INTERIOR 3";
  if (texto.includes("INTERIOR 4")) return "INTERIOR 4";
  if (texto.includes("INTERIOR 5")) return "INTERIOR 5";
  if (texto.includes("INTERIOR 6")) return "INTERIOR 6";
  if (texto.includes("INTERIOR 7")) return "INTERIOR 7";
  if (texto.includes("INTERIOR 8")) return "INTERIOR 8";
  if (texto.includes("INTERIOR 9")) return "INTERIOR 9";
  if (texto.includes("METROP")) return "METROPOLITANA";
  return limpar(valorRegiao).toUpperCase();
}

async function lerArquivoExcel(file) {
  const buffer = await file.arrayBuffer();
  return XLSX.read(buffer, { type: "array" });
}

function primeiraAba(workbook) {
  const nome = workbook.SheetNames?.[0];
  return nome ? workbook.Sheets[nome] : null;
}

function indicePorAliases(header = [], aliases = []) {
  const normalizados = aliases.map((alias) => normalizar(alias));
  return header.findIndex((h) => normalizados.some((alias) => h === alias || h.includes(alias)));
}

function valorDaLinha(row = [], idx = -1) {
  return idx >= 0 ? row[idx] : '';
}

export async function importarTemplatePadraoSeparado({ arquivoRotas, arquivoFretes, dadosGerais = {} }) {
  if (!arquivoRotas || !arquivoFretes) {
    throw new Error("Selecione os arquivos de Rotas e Fretes.");
  }

  const wbRotas = await lerArquivoExcel(arquivoRotas);
  const wbFretes = await lerArquivoExcel(arquivoFretes);

  const sheetRotas = primeiraAba(wbRotas);
  const sheetFretes = primeiraAba(wbFretes);

  if (!sheetRotas || !sheetFretes) {
    throw new Error("Não foi possível ler as planilhas enviadas.");
  }

  const rowsRotas = XLSX.utils.sheet_to_json(sheetRotas, { header: 1, defval: "" });
  const rowsFretes = XLSX.utils.sheet_to_json(sheetFretes, { header: 1, defval: "" });

  const headerRotas = (rowsRotas[0] || []).map((v) => normalizar(v));

  const idx = {
    ibgeOrigem: indicePorAliases(headerRotas, ["IBGE ORIGEM", "CODIGO IBGE ORIGEM"]),
    cidadeOrigem: indicePorAliases(headerRotas, ["CIDADE DE ORIGEM", "ORIGEM"]),
    ufOrigem: indicePorAliases(headerRotas, ["UF ORIGEM"]),
    ibgeDestino: indicePorAliases(headerRotas, ["IBGE DESTINO", "CODIGO IBGE DESTINO", "IBGE"]),
    cidadeDestino: indicePorAliases(headerRotas, ["CIDADE DE DESTINO", "DESTINO"]),
    ufDestino: indicePorAliases(headerRotas, ["UF DESTINO"]),
    cepInicial: indicePorAliases(headerRotas, ["CEP INICIAL"]),
    cepFinal: indicePorAliases(headerRotas, ["CEP FINAL"]),
    prazo: indicePorAliases(headerRotas, ["PRAZO"]),
    regiao: indicePorAliases(headerRotas, ["REGIAO", "REGIÃO", "COTACAO", "COTAÇÃO"]),
  };

  const rotas = [];
  const quebrasFaixa = [];

  for (let i = 1; i < rowsRotas.length; i++) {
    const row = rowsRotas[i] || [];
    const origem = limpar(valorDaLinha(row, idx.cidadeOrigem));
    const ufDestino = limpar(valorDaLinha(row, idx.ufDestino)).toUpperCase();
    const cotacaoBase = detectarCotacaoBase(valorDaLinha(row, idx.regiao));
    const registro = {
      ibgeOrigem: limpar(valorDaLinha(row, idx.ibgeOrigem)),
      origem,
      ufOrigem: limpar(valorDaLinha(row, idx.ufOrigem)).toUpperCase(),
      ibgeDestino: limpar(valorDaLinha(row, idx.ibgeDestino)),
      cidadeDestino: limpar(valorDaLinha(row, idx.cidadeDestino)),
      ufDestino,
      prazo: limpar(valorDaLinha(row, idx.prazo)),
      cotacaoBase,
      cotacao: montarCotacaoFinal({ origem, ufDestino, cotacaoBase }),
      cotacaoFinal: montarCotacaoFinal({ origem, ufDestino, cotacaoBase }),
    };

    if (!registro.ibgeDestino && !registro.cotacaoBase && !registro.prazo) continue;
    rotas.push(registro);

    const cepInicial = limpar(valorDaLinha(row, idx.cepInicial));
    const cepFinal = limpar(valorDaLinha(row, idx.cepFinal));
    if (cepInicial || cepFinal) {
      quebrasFaixa.push({ ...registro, cepInicial, cepFinal });
    }
  }

  const header1 = (rowsFretes[0] || []).map((v) => limpar(v));
  const header2 = (rowsFretes[1] || []).map((v) => limpar(v));
  const cols = Math.max(header1.length, header2.length);

  const fixed = {
    cidadeOrigem: -1,
    ufOrigem: -1,
    ufDestino: -1,
    faixaPeso: -1,
  };
  const blocos = [];

  for (let c = 0; c < cols; c++) {
    const h1 = normalizar(header1[c]);
    const h2 = normalizar(header2[c]);

    if (h1.includes("CIDADE") && h1.includes("ORIGEM")) fixed.cidadeOrigem = c;
    if (h1.includes("UF") && h1.includes("ORIGEM")) fixed.ufOrigem = c;
    if (h1.includes("UF") && h1.includes("DESTINO")) fixed.ufDestino = c;
    if (h1.includes("FAIXA") && h1.includes("PESO")) fixed.faixaPeso = c;

    if (h1 && h2.includes("FRETE") && (h2.includes("KG") || h2.includes("TAXA"))) {
      blocos.push({
        cotacaoBase: limpar(header1[c]).toUpperCase(),
        freteCol: c,
        adValoremCol: c + 1,
      });
    }
  }

  const fretes = [];

  for (let r = 2; r < rowsFretes.length; r++) {
    const row = rowsFretes[r] || [];
    const origem = limpar(valorDaLinha(row, fixed.cidadeOrigem));
    const ufOrigem = limpar(valorDaLinha(row, fixed.ufOrigem)).toUpperCase();
    const ufDestino = limpar(valorDaLinha(row, fixed.ufDestino)).toUpperCase();
    const faixa = extrairFaixa(valorDaLinha(row, fixed.faixaPeso));

    if (!origem && !ufDestino && !faixa.faixaPeso) continue;

    for (const bloco of blocos) {
      const freteValor = paraNumero(valorDaLinha(row, bloco.freteCol));
      const fretePercentual = paraNumero(valorDaLinha(row, bloco.adValoremCol));
      if (freteValor === null && fretePercentual === null) continue;

      const cotacaoFinal = montarCotacaoFinal({
        origem,
        ufDestino,
        cotacaoBase: bloco.cotacaoBase,
      });

      fretes.push({
        origem,
        ufOrigem,
        ufDestino,
        cotacaoBase: bloco.cotacaoBase,
        cotacao: cotacaoFinal,
        cotacaoFinal,
        faixaNome: faixa.faixaPeso,
        faixaPeso: faixa.faixaPeso,
        pesoInicial: faixa.pesoInicial ?? '',
        pesoFinal: faixa.pesoFinal ?? '',
        // No padrão por faixa, o valor da faixa deve sair como TAXA APLICADA.
        // Isso evita exportar frete mínimo ou frete valor errado para o Verum.
        freteValor: '',
        fretePercentual: fretePercentual ?? '',
        freteMinimo: '',
        taxaAplicada: freteValor ?? '',
        excedente: faixa.pesoFinal >= 999999999 ? (freteValor ?? '') : '', 
        origemImportacao: "template_padrao_separado",
      });
    }
  }

  const primeiraRotaComOrigem = rotas.find((rota) => rota.origem || rota.ibgeOrigem) || {};

  return {
    rotas: rotas.map((rota, index) => ({ ...rota, id: rota.id || `rota-template-${index + 1}` })),
    quebrasFaixa: quebrasFaixa.map((quebra, index) => ({ ...quebra, id: quebra.id || `qf-template-${index + 1}` })),
    fretes: fretes.map((frete, index) => ({ ...frete, id: frete.id || `frete-template-${index + 1}` })),
    dadosGeraisPatch: {
      origemNome: primeiraRotaComOrigem.origem || dadosGerais.origemNome || '',
      origemIbge: primeiraRotaComOrigem.ibgeOrigem || dadosGerais.origemIbge || '',
    },
  };
}
