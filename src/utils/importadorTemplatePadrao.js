
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

function detectarBlocoFreteFlat(cabecalho) {
  const texto = normalizar(cabecalho);
  const regioes = ["CAPITAL", "METROPOLITANA", "INTERIOR 1", "INTERIOR 2", "INTERIOR 3", "INTERIOR 4", "INTERIOR 5", "INTERIOR 6", "INTERIOR 7", "INTERIOR 8", "INTERIOR 9"];
  const cotacaoBase = regioes.find((regiao) => texto.includes(regiao));
  if (!cotacaoBase) return null;
  if (texto.includes("FRETE") || texto.includes("TAXA")) return { cotacaoBase, tipo: "frete" };
  if (texto.includes("AD VALOREM")) return { cotacaoBase, tipo: "adValorem" };
  return null;
}

async function lerArquivoExcel(file) {
  const buffer = await file.arrayBuffer();
  return XLSX.read(buffer, { type: "array" });
}

function primeiraAba(workbook) {
  const nome = workbook.SheetNames?.[0];
  return nome ? workbook.Sheets[nome] : null;
}

export async function importarTemplatePadraoSeparado({ arquivoRotas, arquivoFretes }) {
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
    ibgeOrigem: headerRotas.findIndex((h) => h === "IBGE ORIGEM"),
    cidadeOrigem: headerRotas.findIndex((h) => h === "CIDADE DE ORIGEM"),
    ufOrigem: headerRotas.findIndex((h) => h === "UF ORIGEM"),
    ibgeDestino: headerRotas.findIndex((h) => h === "IBGE DESTINO"),
    cidadeDestino: headerRotas.findIndex((h) => h === "CIDADE DE DESTINO"),
    ufDestino: headerRotas.findIndex((h) => h === "UF DESTINO"),
    cepInicial: headerRotas.findIndex((h) => h === "CEP INICIAL"),
    cepFinal: headerRotas.findIndex((h) => h === "CEP FINAL"),
    prazo: headerRotas.findIndex((h) => h.startsWith("PRAZO")),
    regiao: headerRotas.findIndex((h) => h.startsWith("REGIAO") || h.startsWith("REGIÃO")),
  };

  const rotas = [];
  const quebrasFaixa = [];

  for (let i = 1; i < rowsRotas.length; i++) {
    const row = rowsRotas[i] || [];
    const origem = limpar(row[idx.cidadeOrigem]);
    const ufDestino = limpar(row[idx.ufDestino]).toUpperCase();
    const cotacaoBase = detectarCotacaoBase(row[idx.regiao]);
    const registro = {
      ibgeOrigem: limpar(row[idx.ibgeOrigem]),
      origem,
      ufOrigem: limpar(row[idx.ufOrigem]).toUpperCase(),
      ibgeDestino: limpar(row[idx.ibgeDestino]),
      cidadeDestino: limpar(row[idx.cidadeDestino]),
      ufDestino,
      prazo: limpar(row[idx.prazo]),
      cotacaoBase,
      cotacao: montarCotacaoFinal({ origem, ufDestino, cotacaoBase }),
      cotacaoFinal: montarCotacaoFinal({ origem, ufDestino, cotacaoBase }),
    };

    if (!registro.ibgeDestino && !registro.cotacaoBase && !registro.prazo) continue;
    rotas.push(registro);

    const cepInicial = limpar(row[idx.cepInicial]);
    const cepFinal = limpar(row[idx.cepFinal]);
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

    if (h1 === "CIDADE DE ORIGEM") fixed.cidadeOrigem = c;
    if (h1 === "UF ORIGEM") fixed.ufOrigem = c;
    if (h1 === "UF DESTINO") fixed.ufDestino = c;
    if (h1 === "FAIXA PESO") fixed.faixaPeso = c;

    if (h1 && h2 === "FRETE KG (R$)") {
      blocos.push({
        cotacaoBase: limpar(header1[c]).toUpperCase(),
        freteCol: c,
        adValoremCol: c + 1,
      });
    }

    const flat = detectarBlocoFreteFlat(header1[c]);
    if (flat?.tipo === "frete") {
      const adValoremCol = header1.findIndex((cab) => {
        const bloco = detectarBlocoFreteFlat(cab);
        return bloco?.tipo === "adValorem" && bloco.cotacaoBase === flat.cotacaoBase;
      });
      blocos.push({
        cotacaoBase: flat.cotacaoBase,
        freteCol: c,
        adValoremCol: adValoremCol >= 0 ? adValoremCol : c + 1,
      });
    }
  }

  const fretes = [];

  const linhaInicialFretes = (rowsFretes[1] || []).some((v) => limpar(v)) ? 2 : 1;

  for (let r = linhaInicialFretes; r < rowsFretes.length; r++) {
    const row = rowsFretes[r] || [];
    const origem = limpar(row[fixed.cidadeOrigem]);
    const ufOrigem = limpar(row[fixed.ufOrigem]).toUpperCase();
    const ufDestino = limpar(row[fixed.ufDestino]).toUpperCase();
    const faixa = extrairFaixa(row[fixed.faixaPeso]);

    if (!origem && !ufDestino && !faixa.faixaPeso) continue;

    for (const bloco of blocos) {
      const freteValor = paraNumero(row[bloco.freteCol]);
      const fretePercentual = paraNumero(row[bloco.adValoremCol]);
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
        faixaPeso: faixa.faixaPeso,
        pesoInicial: faixa.pesoInicial,
        pesoFinal: faixa.pesoFinal,
        freteValor,
        fretePercentual,
        freteMinimo: null,
        taxaAplicada: null,
        excedente: null,
        origemImportacao: "template_padrao_separado",
      });
    }
  }

  return { rotas, quebrasFaixa, fretes };
}
