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

  const limpo = texto
    .replace(/R\$/gi, "")
    .replace(/%/g, "")
    .replace(/kg/gi, "")
    .trim();

  const temVirgula = limpo.includes(",");
  let preparado = limpo.replace(/\s/g, "");

  if (temVirgula) {
    preparado = preparado.replace(/\./g, "").replace(",", ".");
  }

  const numero = Number(preparado);
  return Number.isFinite(numero) ? numero : null;
}

function extrairFaixa(texto) {
  const bruto = limpar(texto);

  if (!bruto) {
    return {
      faixaPeso: "",
      pesoInicial: null,
      pesoFinal: null,
      excedente: null,
    };
  }

  const acimaDe = bruto.match(/(?:acima\s+de|maior\s+que|>\s*)(\d+[.,]?\d*)/i);
  if (acimaDe) {
    const pesoInicial = paraNumero(acimaDe[1]);

    return {
      faixaPeso: bruto,
      pesoInicial,
      pesoFinal: 999999999,
      excedente: pesoInicial,
    };
  }

  const match = bruto.match(/(\d+[.,]?\d*)\s*(?:a|até|ate|-|\/)\s*(\d+[.,]?\d*)/i);
  if (!match) {
    return {
      faixaPeso: bruto,
      pesoInicial: null,
      pesoFinal: null,
      excedente: null,
    };
  }

  return {
    faixaPeso: bruto,
    pesoInicial: paraNumero(match[1]),
    pesoFinal: paraNumero(match[2]),
    excedente: null,
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
  if (texto.includes("METROPOLITANA") || texto.includes("METROP")) return "METROPOLITANA";
  if (texto.includes("INTERIOR 1")) return "INTERIOR 1";
  if (texto.includes("INTERIOR 2")) return "INTERIOR 2";
  if (texto.includes("INTERIOR 3")) return "INTERIOR 3";
  if (texto.includes("INTERIOR 4")) return "INTERIOR 4";
  if (texto.includes("INTERIOR 5")) return "INTERIOR 5";
  if (texto.includes("INTERIOR 6")) return "INTERIOR 6";
  if (texto.includes("INTERIOR 7")) return "INTERIOR 7";
  if (texto.includes("INTERIOR 8")) return "INTERIOR 8";
  if (texto.includes("INTERIOR 9")) return "INTERIOR 9";

  return limpar(valorRegiao).toUpperCase();
}

function detectarBlocoFreteFlat(cabecalho) {
  const texto = normalizar(cabecalho);

  const regioes = [
    "METROPOLITANA",
    "CAPITAL",
    "INTERIOR 1",
    "INTERIOR 2",
    "INTERIOR 3",
    "INTERIOR 4",
    "INTERIOR 5",
    "INTERIOR 6",
    "INTERIOR 7",
    "INTERIOR 8",
    "INTERIOR 9",
  ];

  const cotacaoBase = regioes.find((regiao) => texto.includes(regiao));
  if (!cotacaoBase) return null;

  if (texto.includes("AD VALOREM") || texto.includes("ADVALOREM")) {
    return { cotacaoBase, tipo: "adValorem" };
  }

  if (texto.includes("FRETE") || texto.includes("TAXA") || texto.includes("VALOR")) {
    return { cotacaoBase, tipo: "frete" };
  }

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

function procurarIndice(header, nomes) {
  const opcoes = nomes.map((nome) => normalizar(nome));

  return header.findIndex((h) =>
    opcoes.some((opcao) => h === opcao || h.includes(opcao))
  );
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
    ibgeOrigem: procurarIndice(headerRotas, ["IBGE ORIGEM"]),
    cidadeOrigem: procurarIndice(headerRotas, ["CIDADE DE ORIGEM", "CIDADE ORIGEM", "ORIGEM"]),
    ufOrigem: procurarIndice(headerRotas, ["UF ORIGEM"]),
    ibgeDestino: procurarIndice(headerRotas, ["IBGE DESTINO"]),
    cidadeDestino: procurarIndice(headerRotas, ["CIDADE DE DESTINO", "CIDADE DESTINO", "DESTINO"]),
    ufDestino: procurarIndice(headerRotas, ["UF DESTINO"]),
    cepInicial: procurarIndice(headerRotas, ["CEP INICIAL"]),
    cepFinal: procurarIndice(headerRotas, ["CEP FINAL"]),
    prazo: procurarIndice(headerRotas, ["PRAZO"]),
    regiao: procurarIndice(headerRotas, ["REGIAO", "REGIÃO", "COTACAO", "COTAÇÃO"]),
  };

  if (idx.cidadeOrigem < 0 || idx.ufDestino < 0 || idx.regiao < 0) {
    throw new Error(
      "Arquivo de Rotas fora do modelo. Verifique se existem as colunas Cidade de Origem, UF Destino e Região/Cotação."
    );
  }

  const rotas = [];
  const quebrasFaixa = [];

  for (let i = 1; i < rowsRotas.length; i++) {
    const row = rowsRotas[i] || [];

    const origem = limpar(row[idx.cidadeOrigem]);
    const ufDestino = limpar(row[idx.ufDestino]).toUpperCase();
    const cotacaoBase = detectarCotacaoBase(row[idx.regiao]);

    const registro = {
      ibgeOrigem: idx.ibgeOrigem >= 0 ? limpar(row[idx.ibgeOrigem]) : "",
      origem,
      ufOrigem: idx.ufOrigem >= 0 ? limpar(row[idx.ufOrigem]).toUpperCase() : "",
      ibgeDestino: idx.ibgeDestino >= 0 ? limpar(row[idx.ibgeDestino]) : "",
      cidadeDestino: idx.cidadeDestino >= 0 ? limpar(row[idx.cidadeDestino]) : "",
      ufDestino,
      prazo: idx.prazo >= 0 ? limpar(row[idx.prazo]) : "",
      cotacaoBase,
      cotacao: montarCotacaoFinal({ origem, ufDestino, cotacaoBase }),
      cotacaoFinal: montarCotacaoFinal({ origem, ufDestino, cotacaoBase }),
    };

    if (!registro.origem && !registro.ufDestino && !registro.cotacaoBase) continue;

    rotas.push(registro);

    const cepInicial = idx.cepInicial >= 0 ? limpar(row[idx.cepInicial]) : "";
    const cepFinal = idx.cepFinal >= 0 ? limpar(row[idx.cepFinal]) : "";

    if (cepInicial || cepFinal) {
      quebrasFaixa.push({ ...registro, cepInicial, cepFinal });
    }
  }

  const header1 = (rowsFretes[0] || []).map((v) => limpar(v));
  const header2 = (rowsFretes[1] || []).map((v) => limpar(v));
  const header1Norm = header1.map((v) => normalizar(v));
  const header2Norm = header2.map((v) => normalizar(v));

  const cols = Math.max(header1.length, header2.length);

  const fixed = {
    cidadeOrigem: procurarIndice(header1Norm, ["CIDADE DE ORIGEM", "CIDADE ORIGEM", "ORIGEM"]),
    ufOrigem: procurarIndice(header1Norm, ["UF ORIGEM"]),
    ufDestino: procurarIndice(header1Norm, ["UF DESTINO"]),
    faixaPeso: procurarIndice(header1Norm, ["FAIXA PESO", "FAIXA DE PESO", "PESO"]),
  };

  if (fixed.cidadeOrigem < 0 || fixed.ufDestino < 0 || fixed.faixaPeso < 0) {
    throw new Error(
      "Arquivo de Fretes fora do modelo. Verifique se existem as colunas Cidade de Origem, UF Destino e Faixa Peso."
    );
  }

  const blocos = [];
  const blocosMapeados = new Set();

  const temSegundoCabecalho = header2Norm.some(
    (h) =>
      h.includes("FRETE") ||
      h.includes("TAXA") ||
      h.includes("VALOR") ||
      h.includes("AD VALOREM") ||
      h.includes("ADVALOREM")
  );

  for (let c = 0; c < cols; c++) {
    const h1 = normalizar(header1[c]);
    const h2 = normalizar(header2[c]);

    // Modelo com duas linhas de cabeçalho:
    // Linha 1 = CAPITAL / INTERIOR 1...
    // Linha 2 = FRETE KG / AD VALOREM...
    if (
      h1 &&
      h2 &&
      (h2.includes("FRETE") || h2.includes("TAXA") || h2.includes("VALOR"))
    ) {
      const cotacaoBase = detectarCotacaoBase(header1[c]);

      if (cotacaoBase) {
        const chave = `${cotacaoBase}|${c}|duplo`;

        if (!blocosMapeados.has(chave)) {
          const adValoremCol = header2Norm.findIndex(
            (cab, indice) =>
              indice > c &&
              normalizar(header1[indice]) === normalizar(header1[c]) &&
              (cab.includes("AD VALOREM") || cab.includes("ADVALOREM"))
          );

          blocos.push({
            cotacaoBase,
            freteCol: c,
            adValoremCol: adValoremCol >= 0 ? adValoremCol : -1,
          });

          blocosMapeados.add(chave);
        }
      }
    }

    // Modelo com uma linha de cabeçalho:
    // CAPITAL Frete kg (R$), CAPITAL Ad Valorem(%)
    const flat = detectarBlocoFreteFlat(header1[c]);

    if (flat?.tipo === "frete") {
      const adValoremCol = header1.findIndex((cab) => {
        const bloco = detectarBlocoFreteFlat(cab);
        return bloco?.tipo === "adValorem" && bloco.cotacaoBase === flat.cotacaoBase;
      });

      const chave = `${flat.cotacaoBase}|${c}|flat`;

      if (!blocosMapeados.has(chave)) {
        blocos.push({
          cotacaoBase: flat.cotacaoBase,
          freteCol: c,
          adValoremCol: adValoremCol >= 0 ? adValoremCol : -1,
        });

        blocosMapeados.add(chave);
      }
    }
  }

  if (!blocos.length) {
    throw new Error(
      "Não encontrei colunas de frete no arquivo de Fretes. Use colunas como 'CAPITAL Frete kg (R$)' e 'CAPITAL Ad Valorem(%)'."
    );
  }

  const fretes = [];
  const linhaInicialFretes = temSegundoCabecalho ? 2 : 1;

  for (let r = linhaInicialFretes; r < rowsFretes.length; r++) {
    const row = rowsFretes[r] || [];

    const origem = limpar(row[fixed.cidadeOrigem]);
    const ufOrigem = fixed.ufOrigem >= 0 ? limpar(row[fixed.ufOrigem]).toUpperCase() : "";
    const ufDestino = limpar(row[fixed.ufDestino]).toUpperCase();
    const faixa = extrairFaixa(row[fixed.faixaPeso]);

    if (!origem && !ufDestino && !faixa.faixaPeso) continue;

    for (const bloco of blocos) {
      const freteValor = paraNumero(row[bloco.freteCol]);
      const fretePercentual = bloco.adValoremCol >= 0 ? paraNumero(row[bloco.adValoremCol]) : null;

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
        taxaAplicada: freteValor,
        excedente: faixa.excedente,
        origemImportacao: "template_padrao_separado",
      });
    }
  }

  return {
    rotas,
    quebrasFaixa,
    fretes,
  };
}
