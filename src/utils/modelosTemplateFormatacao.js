import * as XLSX from "xlsx";

function baixarWorkbook(nome, sheets) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(({ name, rows }) => {
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  XLSX.writeFile(wb, nome);
}

export function baixarModeloTemplateRotas() {
  const rows = [
    {
      "IBGE ORIGEM": "4106902",
      "CIDADE DE ORIGEM": "Curitiba",
      "UF ORIGEM": "PR",
      "IBGE DESTINO": "4106902",
      "CIDADE DE DESTINO": "Curitiba",
      "UF DESTINO": "PR",
      "CEP INICIAL": "",
      "CEP FINAL": "",
      "PRAZO": "1",
      "REGIÃO": "CAPITAL",
    },
    {
      "IBGE ORIGEM": "4106902",
      "CIDADE DE ORIGEM": "Curitiba",
      "UF ORIGEM": "PR",
      "IBGE DESTINO": "4106902",
      "CIDADE DE DESTINO": "Curitiba",
      "UF DESTINO": "PR",
      "CEP INICIAL": "",
      "CEP FINAL": "",
      "PRAZO": "2",
      "REGIÃO": "INTERIOR 1",
    },
  ];

  baixarWorkbook("Rotas-modelo-template.xlsx", [
    { name: "Rotas", rows },
  ]);
}

export function baixarModeloTemplateFretes() {
  const rows = [
    {
      "CIDADE DE ORIGEM": "Curitiba",
      "UF ORIGEM": "PR",
      "UF DESTINO": "PR",
      "FAIXA PESO": "0 a 10 kg",
      "CAPITAL Frete kg (R$)": 80,
      "CAPITAL Ad Valorem(%)": 0.03,
      "INTERIOR 1 Frete kg (R$)": 80,
      "INTERIOR 1 Ad Valorem(%)": 0.03,
    },
    {
      "CIDADE DE ORIGEM": "Curitiba",
      "UF ORIGEM": "PR",
      "UF DESTINO": "PR",
      "FAIXA PESO": "10 a 25 kg",
      "CAPITAL Frete kg (R$)": 80,
      "CAPITAL Ad Valorem(%)": 0.03,
      "INTERIOR 1 Frete kg (R$)": 80,
      "INTERIOR 1 Ad Valorem(%)": 0.03,
    },
    {
      "CIDADE DE ORIGEM": "Curitiba",
      "UF ORIGEM": "PR",
      "UF DESTINO": "PR",
      "FAIXA PESO": "Acima de 300 kg (KG excedente)",
      "CAPITAL Frete kg (R$)": 0.95,
      "CAPITAL Ad Valorem(%)": 0.03,
      "INTERIOR 1 Frete kg (R$)": 0.95,
      "INTERIOR 1 Ad Valorem(%)": 0.03,
    },
  ];

  baixarWorkbook("Fretes-modelo-template.xlsx", [
    { name: "Fretes", rows },
  ]);
}
