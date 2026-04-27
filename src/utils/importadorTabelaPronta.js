
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

  // aceita 0.005, 0,5, 1.234,56 etc.
  const temVirgula = texto.includes(",");
  let preparado = texto.replace(/\s/g, "");
  if (temVirgula) {
    preparado = preparado.replace(/\./g, "").replace(",", ".");
  }
  const numero = Number(preparado);
  return Number.isFinite(numero) ? numero : null;
}

function extrairFaixa(texto) {
  const bruto = limpar(texto);
  if (!bruto) return { faixaPeso: "", pesoInicial: null, pesoFinal: null };

  const match = bruto.match(/(\d+[.,]?\d*)\s*(?:A|ATÉ|ATE|-|\/)\s*(\d+[.,]?\d*)/i);
  if (!match) {
    return { faixaPeso: bruto, pesoInicial: null, pesoFinal: null };
  }

  return {
    faixaPeso: bruto,
    pesoInicial: paraNumero(match[1]),
    pesoFinal: paraNumero(match[2]),
  };
}

function obterSheet(workbook, nomes) {
  const nomesNormalizados = nomes.map((n) => normalizar(n));
  const nomeEncontrado = (workbook.SheetNames || []).find((sheetName) =>
    nomesNormalizados.includes(normalizar(sheetName))
  );
  return nomeEncontrado ? workbook.Sheets[nomeEncontrado] : null;
}

function detectarCotacaoBase(valorRegiao) {
  const texto = normalizar(valorRegiao);
  if (!texto) return "";

  if (texto.includes("CAPITAL")) return "CAPITAL";
  if (texto.includes("INTERIOR 1")) return "INTERIOR 1";
  if (texto.includes("INTERIOR 2")) return "INTERIOR 2";
  if (texto.includes("INTERIOR 3")) return "INTERIOR 3";
  if (texto.includes("METROP")) return "METROPOLITANA";
  return limpar(valorRegiao).toUpperCase();
}

function montarCotacaoFinal({ origem, ufDestino, cotacaoBase }) {
  return [limpar(origem), limpar(ufDestino).toUpperCase(), limpar(cotacaoBase).toUpperCase()]
    .filter(Boolean)
    .join(" - ");
}

function parseRotasSheet(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  if (!rows.length) return { rotas: [], quebrasFaixa: [] };

  const header = rows[0].map((v) => normalizar(v));

  const idx = {
    ibgeOrigem: header.findIndex((h) => h === "IBGE ORIGEM"),
    cidadeOrigem: header.findIndex((h) => h === "CIDADE DE ORIGEM"),
    ufOrigem: header.findIndex((h) => h === "UF ORIGEM"),
    ibgeDestino: header.findIndex((h) => h === "IBGE DESTINO"),
    cidadeDestino: header.findIndex((h) => h === "CIDADE DE DESTINO"),
    ufDestino: header.findIndex((h) => h === "UF DESTINO"),
    cepInicial: header.findIndex((h) => h === "CEP INICIAL"),
    cepFinal: header.findIndex((h) => h === "CEP FINAL"),
    prazo: header.findIndex((h) => h === "PRAZO"),
    regiao: header.findIndex((h) => h === "REGIAO" || h === "REGIÃO" || h === "COTACAO" || h === "COTAÇÃO"),
  };

  const rotas = [];
  const quebrasFaixa = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const ibgeDestino = limpar(row[idx.ibgeDestino]);
    const prazo = limpar(row[idx.prazo]);
    const ufDestino = limpar(row[idx.ufDestino]).toUpperCase();
    const origem = limpar(row[idx.cidadeOrigem]);
    const cotacaoBase = detectarCotacaoBase(row[idx.regiao]);
    const cotacaoFinal = montarCotacaoFinal({ origem, ufDestino, cotacaoBase });
    const cepInicial = limpar(row[idx.cepInicial]);
    const cepFinal = limpar(row[idx.cepFinal]);

    if (!ibgeDestino && !prazo && !cotacaoBase && !ufDestino) continue;

    const base = {
      ibgeOrigem: limpar(row[idx.ibgeOrigem]),
      origem,
      ufOrigem: limpar(row[idx.ufOrigem]).toUpperCase(),
      ibgeDestino,
      cidadeDestino: limpar(row[idx.cidadeDestino]),
      ufDestino,
      prazo,
      cotacaoBase,
      cotacao: cotacaoFinal,
      cotacaoFinal,
    };

    rotas.push(base);

    if (cepInicial || cepFinal) {
      quebrasFaixa.push({
        ...base,
        cepInicial,
        cepFinal,
      });
    }
  }

  return { rotas, quebrasFaixa };
}

function parseFretesSheet(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  if (rows.length < 2) return [];

  const header1 = rows[0].map((v) => limpar(v));
  const header2 = rows[1].map((v) => limpar(v));
  const nCols = Math.max(header1.length, header2.length);

  const fixed = {
    cidadeOrigem: -1,
    ufOrigem: -1,
    ufDestino: -1,
    faixaPeso: -1,
  };
  const blocos = [];

  for (let c = 0; c < nCols; c++) {
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
  }

  const fretes = [];

  for (let r = 2; r < rows.length; r++) {
    const row = rows[r];
    const origem = limpar(row[fixed.cidadeOrigem]);
    const ufOrigem = limpar(row[fixed.ufOrigem]).toUpperCase();
    const ufDestino = limpar(row[fixed.ufDestino]).toUpperCase();
    const faixaInfo = extrairFaixa(row[fixed.faixaPeso]);

    if (!origem && !ufDestino && !faixaInfo.faixaPeso) continue;

    for (const bloco of blocos) {
      const freteValor = paraNumero(row[bloco.freteCol]);
      const fretePercentual = paraNumero(row[bloco.adValoremCol]);

      if (freteValor === null && fretePercentual === null) continue;

      const cotacao = montarCotacaoFinal({
        origem,
        ufDestino,
        cotacaoBase: bloco.cotacaoBase,
      });

      fretes.push({
        origem,
        ufOrigem,
        ufDestino,
        cotacaoBase: bloco.cotacaoBase,
        cotacao,
        cotacaoFinal: cotacao,
        faixaPeso: faixaInfo.faixaPeso,
        pesoInicial: faixaInfo.pesoInicial,
        pesoFinal: faixaInfo.pesoFinal,
        freteValor,
        fretePercentual,
        freteMinimo: null,
        taxaAplicada: null,
        excedente: null,
        origemImportacao: "template_rotas_fretes",
      });
    }
  }

  return fretes;
}

export async function importarTabelaPronta(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });

  const rotasSheet = obterSheet(workbook, ["Rotas"]);
  const fretesSheet = obterSheet(workbook, ["Fretes"]);

  if (!rotasSheet && !fretesSheet) {
    throw new Error('Arquivo sem abas "Rotas" ou "Fretes".');
  }

  const { rotas, quebrasFaixa } = rotasSheet
    ? parseRotasSheet(rotasSheet)
    : { rotas: [], quebrasFaixa: [] };

  const fretes = fretesSheet ? parseFretesSheet(fretesSheet) : [];

  return {
    rotas,
    quebrasFaixa,
    fretes,
  };
}
