import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

const estadoInicial = {
  transportadoraId: 1,
  codigoUnidade: "",
  tipoCalculo: "PERCENTUAL",
  regraCalculo: "PERCENTUAL_KG_MINIMO",
  rotaFrete: "",
  pesoMinimo: "",
  pesoLimite: "",
  excessoPeso: "",
  taxaAplicada: "",
  fretePercentual: "",
  freteMinimo: "",
  inicioVigencia: "",
  fimVigencia: "",
};

function baixarArquivo(nome, workbook) {
  XLSX.writeFile(workbook, nome);
}

function lerValor(linha, chaves) {
  for (const chave of chaves) {
    if (
      linha[chave] !== undefined &&
      linha[chave] !== null &&
      String(linha[chave]).trim() !== ""
    ) {
      return String(linha[chave]).trim();
    }
  }
  return "";
}

function numeroTexto(valor) {
  return String(valor || "")
    .replace(".", "")
    .replace(",", ".")
    .trim();
}

function ehValorPreenchido(valor) {
  const v = String(valor || "").trim();
  return v !== "" && v !== "0" && v !== "0,00" && v !== "0.00";
}

function detectarTipoTabela({
  regraCalculo,
  pesoMinimo,
  pesoLimite,
  taxaAplicada,
  fretePercentual,
}) {
  const regra = String(regraCalculo || "").toLowerCase();

  if (regra.includes("maior valor") || regra.includes("percentual")) {
    return "PERCENTUAL";
  }

  const pesoMin = numeroTexto(pesoMinimo);
  const pesoMax = numeroTexto(pesoLimite);

  const limiteMuitoAlto =
    pesoMax === "999999999" ||
    pesoMax === "99999999" ||
    pesoMax === "9999999" ||
    pesoMax === "999999";

  if (
    !limiteMuitoAlto &&
    (ehValorPreenchido(taxaAplicada) || ehValorPreenchido(pesoMin))
  ) {
    return "FAIXA_DE_PESO";
  }

  if (ehValorPreenchido(fretePercentual)) {
    return "PERCENTUAL";
  }

  return "FAIXA_DE_PESO";
}

export default function FretesPage({
  fretes,
  transportadoras,
  onAdicionar,
  onImportar,
}) {
  const [busca, setBusca] = useState("");
  const [formulario, setFormulario] = useState(estadoInicial);
  const [mostrarManual, setMostrarManual] = useState(false);
  const [tipoImportacao, setTipoImportacao] = useState("AUTO");
  const inputArquivo = useRef(null);

  const lista = useMemo(() => {
    const termo = busca.toLowerCase().trim();
    if (!termo) return fretes;

    return fretes.filter((item) => {
      return (
        item.transportadoraNome.toLowerCase().includes(termo) ||
        item.rotaFrete.toLowerCase().includes(termo) ||
        item.regraCalculo.toLowerCase().includes(termo) ||
        String(item.tipoCalculo || "")
          .toLowerCase()
          .includes(termo) ||
        item.codigoUnidade.toLowerCase().includes(termo)
      );
    });
  }, [fretes, busca]);

  const salvar = () => {
    if (!formulario.rotaFrete.trim()) return;

    const regraFinal =
      formulario.tipoCalculo === "FAIXA_DE_PESO"
        ? "FAIXA_DE_PESO"
        : formulario.regraCalculo;

    onAdicionar({
      ...formulario,
      tipoCalculo: formulario.tipoCalculo,
      regraCalculo: regraFinal,
      codigoUnidade: formulario.codigoUnidade.trim(),
      rotaFrete: formulario.rotaFrete.trim(),
      pesoMinimo: formulario.pesoMinimo.trim(),
      pesoLimite: formulario.pesoLimite.trim(),
      excessoPeso: formulario.excessoPeso.trim(),
      taxaAplicada: formulario.taxaAplicada.trim(),
      fretePercentual: formulario.fretePercentual.trim(),
      freteMinimo: formulario.freteMinimo.trim(),
    });

    setFormulario(estadoInicial);
    setMostrarManual(false);
  };

  const exportarFretes = () => {
    const dados = fretes.map((item) => ({
      "Nome da transportadora": item.transportadoraNome,
      "Código da unidade": item.codigoUnidade,
      "Tipo da tabela": item.tipoCalculo || "PERCENTUAL",
      "Regra de cálculo": item.regraCalculo,
      "Rota do frete": item.rotaFrete,
      "Peso mínimo": item.pesoMinimo,
      "Peso limite": item.pesoLimite,
      "Excesso de peso": item.excessoPeso,
      "Taxa aplicada": item.taxaAplicada,
      "Frete percentual": item.fretePercentual,
      "Frete mínimo": item.freteMinimo,
      "Início da vigência": item.inicioVigencia,
      "Fim da vigência": item.fimVigencia,
    }));

    const ws = XLSX.utils.json_to_sheet(dados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fretes");
    baixarArquivo("Fretes-Exportados.xlsx", wb);
  };

  const importarArquivo = async (event) => {
    const arquivo = event.target.files?.[0];
    if (!arquivo) return;

    const buffer = await arquivo.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const primeiraAba = workbook.SheetNames[0];
    const sheet = workbook.Sheets[primeiraAba];
    const linhas = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    const novos = linhas
      .map((linha, index) => {
        const nomeTransportadora = lerValor(linha, [
          "Nome da transportadora",
          "Transportadora",
          "Nome Transportadora",
        ]);

        const transportadora = transportadoras.find(
          (item) => item.nome.toLowerCase() === nomeTransportadora.toLowerCase()
        );

        const regraLida = lerValor(linha, [
          "Regra de cálculo",
          "Regra de calculo",
        ]);

        const pesoMinimo = lerValor(linha, ["Peso mínimo", "Peso minimo"]);
        const pesoLimite = lerValor(linha, ["Peso limite"]);
        const taxaAplicada = lerValor(linha, ["Taxa aplicada"]);
        const fretePercentual = lerValor(linha, ["Frete percentual"]);

        const tipoFinal =
          tipoImportacao === "AUTO"
            ? detectarTipoTabela({
                regraCalculo: regraLida,
                pesoMinimo,
                pesoLimite,
                taxaAplicada,
                fretePercentual,
              })
            : tipoImportacao;

        const regraFinal =
          tipoFinal === "FAIXA_DE_PESO"
            ? "FAIXA_DE_PESO"
            : regraLida || "MAIOR_VALOR";

        return {
          id: index + 1,
          transportadoraId: transportadora ? transportadora.id : 0,
          transportadoraNome: nomeTransportadora,
          codigoUnidade: lerValor(linha, [
            "Código da unidade",
            "Codigo da unidade",
            "Unidade",
          ]),
          tipoCalculo: tipoFinal,
          regraCalculo: regraFinal,
          rotaFrete: lerValor(linha, ["Rota do frete", "Rota Frete"]),
          pesoMinimo,
          pesoLimite,
          excessoPeso: lerValor(linha, ["Excesso de peso", "Excesso peso"]),
          taxaAplicada,
          fretePercentual,
          freteMinimo: lerValor(linha, ["Frete mínimo", "Frete minimo"]),
          inicioVigencia: lerValor(linha, [
            "Início da vigência",
            "Inicio da vigencia",
          ]),
          fimVigencia: lerValor(linha, [
            "Fim da vigência",
            "Término da vigência",
            "Termino da vigencia",
          ]),
        };
      })
      .filter((item) => item.rotaFrete);

    onImportar(novos);
    event.target.value = "";
  };

  return (
    <div className="pagina">
      <div className="cabecalho-pagina">
        <div>
          <h2>Fretes</h2>
          <p>
            A importação agora pode diferenciar melhor os modelos de frete por
            percentual e por faixa de peso, mantendo o mesmo layout de arquivo.
          </p>
        </div>
      </div>

      <section className="card-padrao">
        <div className="card-topo">
          <h3>Importação e exportação</h3>
        </div>

        <div className="form-grid" style={{ marginBottom: "16px" }}>
          <label>
            Tipo da tabela na importação
            <select
              value={tipoImportacao}
              onChange={(e) => setTipoImportacao(e.target.value)}
            >
              <option value="AUTO">AUTO</option>
              <option value="PERCENTUAL">PERCENTUAL</option>
              <option value="FAIXA_DE_PESO">FAIXA_DE_PESO</option>
            </select>
          </label>
        </div>

        <div
          className="acoes-formulario"
          style={{ justifyContent: "flex-start", flexWrap: "wrap" }}
        >
          <input
            ref={inputArquivo}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: "none" }}
            onChange={importarArquivo}
          />
          <button
            className="botao-primario"
            onClick={() => inputArquivo.current?.click()}
          >
            Importar Fretes
          </button>
          <button className="botao-secundario" onClick={exportarFretes}>
            Exportar Fretes
          </button>
          <button
            className="botao-secundario"
            onClick={() => setMostrarManual((valor) => !valor)}
          >
            {mostrarManual ? "Fechar ajuste manual" : "Adicionar frete manual"}
          </button>
        </div>
      </section>

      {mostrarManual && (
        <section className="card-padrao">
          <div className="card-topo">
            <h3>Ajuste manual de frete</h3>
          </div>

          <div className="form-grid">
            <label>
              Transportadora
              <select
                value={formulario.transportadoraId}
                onChange={(e) =>
                  setFormulario({
                    ...formulario,
                    transportadoraId: Number(e.target.value),
                  })
                }
              >
                {transportadoras.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.nome}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Código da unidade
              <input
                value={formulario.codigoUnidade}
                onChange={(e) =>
                  setFormulario({
                    ...formulario,
                    codigoUnidade: e.target.value,
                  })
                }
                placeholder="Ex.: ITJ"
              />
            </label>

            <label>
              Tipo de cálculo
              <select
                value={formulario.tipoCalculo}
                onChange={(e) =>
                  setFormulario({
                    ...formulario,
                    tipoCalculo: e.target.value,
                  })
                }
              >
                <option value="PERCENTUAL">PERCENTUAL</option>
                <option value="FAIXA_DE_PESO">FAIXA_DE_PESO</option>
              </select>
            </label>

            <label>
              Regra de cálculo
              <select
                value={formulario.regraCalculo}
                onChange={(e) =>
                  setFormulario({
                    ...formulario,
                    regraCalculo: e.target.value,
                  })
                }
              >
                <option value="MAIOR_VALOR">MAIOR_VALOR</option>
                <option value="PERCENTUAL_KG_MINIMO">
                  PERCENTUAL_KG_MINIMO
                </option>
                <option value="PERCENTUAL">PERCENTUAL</option>
                <option value="KG">KG</option>
                <option value="MINIMO">MINIMO</option>
                <option value="FAIXA_DE_PESO">FAIXA_DE_PESO</option>
              </select>
            </label>

            <label>
              Rota do frete
              <input
                value={formulario.rotaFrete}
                onChange={(e) =>
                  setFormulario({
                    ...formulario,
                    rotaFrete: e.target.value,
                  })
                }
                placeholder="Ex.: SP CAPITAL"
              />
            </label>

            <label>
              Peso mínimo
              <input
                value={formulario.pesoMinimo}
                onChange={(e) =>
                  setFormulario({
                    ...formulario,
                    pesoMinimo: e.target.value,
                  })
                }
                placeholder="Peso inicial"
              />
            </label>

            <label>
              Peso limite
              <input
                value={formulario.pesoLimite}
                onChange={(e) =>
                  setFormulario({
                    ...formulario,
                    pesoLimite: e.target.value,
                  })
                }
                placeholder="Peso final"
              />
            </label>

            <label>
              Excesso de peso
              <input
                value={formulario.excessoPeso}
                onChange={(e) =>
                  setFormulario({
                    ...formulario,
                    excessoPeso: e.target.value,
                  })
                }
                placeholder="Valor excedente"
              />
            </label>

            <label>
              Taxa aplicada
              <input
                value={formulario.taxaAplicada}
                onChange={(e) =>
                  setFormulario({
                    ...formulario,
                    taxaAplicada: e.target.value,
                  })
                }
                placeholder="Valor da faixa ou taxa base"
              />
            </label>

            <label>
              Frete percentual
              <input
                value={formulario.fretePercentual}
                onChange={(e) =>
                  setFormulario({
                    ...formulario,
                    fretePercentual: e.target.value,
                  })
                }
                placeholder="Percentual sobre NF"
              />
            </label>

            <label>
              Frete mínimo
              <input
                value={formulario.freteMinimo}
                onChange={(e) =>
                  setFormulario({
                    ...formulario,
                    freteMinimo: e.target.value,
                  })
                }
                placeholder="Valor mínimo"
              />
            </label>

            <label>
              Início da vigência
              <input
                type="date"
                value={formulario.inicioVigencia}
                onChange={(e) =>
                  setFormulario({
                    ...formulario,
                    inicioVigencia: e.target.value,
                  })
                }
              />
            </label>

            <label>
              Fim da vigência
              <input
                type="date"
                value={formulario.fimVigencia}
                onChange={(e) =>
                  setFormulario({
                    ...formulario,
                    fimVigencia: e.target.value,
                  })
                }
              />
            </label>
          </div>

          <div className="acoes-formulario">
            <button className="botao-primario" onClick={salvar}>
              Salvar ajuste manual
            </button>
          </div>
        </section>
      )}

      <section className="card-padrao">
        <div className="card-topo entre-linhas">
          <h3>Lista de fretes</h3>
          <input
            className="input-busca"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por transportadora, rota, unidade, tipo ou regra"
          />
        </div>

        <div className="lista-tabela">
          <div className="linha cabecalho fretes-grid">
            <span>Transportadora</span>
            <span>Tipo</span>
            <span>Rota</span>
            <span>Regra</span>
            <span>Faixa</span>
            <span>% / Mínimo</span>
          </div>

          {lista.map((item) => (
            <div className="linha fretes-grid" key={item.id}>
              <span>{item.transportadoraNome}</span>
              <span>{item.tipoCalculo || "-"}</span>
              <span>{item.rotaFrete}</span>
              <span>{item.regraCalculo}</span>
              <span>
                {item.pesoMinimo || "-"} até {item.pesoLimite || "-"}
              </span>
              <span>
                {item.fretePercentual || "-"} / {item.freteMinimo || "-"}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
