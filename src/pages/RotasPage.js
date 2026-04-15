import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

const estadoInicial = {
  transportadoraId: 1,
  codigoUnidade: "",
  cotacao: "",
  ibgeOrigem: "",
  ibgeDestino: "",
  cepInicial: "",
  cepFinal: "",
  metodoEnvio: "RODOVIARIO",
  prazoEntrega: "",
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

export default function RotasPage({
  rotas,
  transportadoras,
  onAdicionar,
  onImportar,
}) {
  const [busca, setBusca] = useState("");
  const [formulario, setFormulario] = useState(estadoInicial);
  const [mostrarManual, setMostrarManual] = useState(false);
  const inputArquivo = useRef(null);

  const lista = useMemo(() => {
    const termo = busca.toLowerCase().trim();
    if (!termo) return rotas;

    return rotas.filter((item) => {
      return (
        item.transportadoraNome.toLowerCase().includes(termo) ||
        item.cotacao.toLowerCase().includes(termo) ||
        item.ibgeDestino.toLowerCase().includes(termo) ||
        item.cepInicial.toLowerCase().includes(termo) ||
        item.cepFinal.toLowerCase().includes(termo)
      );
    });
  }, [rotas, busca]);

  const salvar = () => {
    if (!formulario.cotacao.trim()) return;
    if (!formulario.ibgeOrigem.trim()) return;
    if (!formulario.ibgeDestino.trim()) return;

    onAdicionar({
      ...formulario,
      codigoUnidade: formulario.codigoUnidade.trim(),
      cotacao: formulario.cotacao.trim(),
      ibgeOrigem: formulario.ibgeOrigem.trim(),
      ibgeDestino: formulario.ibgeDestino.trim(),
      cepInicial: formulario.cepInicial.trim(),
      cepFinal: formulario.cepFinal.trim(),
      prazoEntrega: formulario.prazoEntrega.trim(),
    });

    setFormulario(estadoInicial);
    setMostrarManual(false);
  };

  const exportarRotas = () => {
    const dados = rotas.map((item) => ({
      "Nome da transportadora": item.transportadoraNome,
      "Código da unidade": item.codigoUnidade,
      Cotação: item.cotacao,
      "Código IBGE Origem": item.ibgeOrigem,
      "Código IBGE Destino": item.ibgeDestino,
      "CEP inicial": item.cepInicial,
      "CEP final": item.cepFinal,
      "Método de envio": item.metodoEnvio,
      "Prazo de entrega": item.prazoEntrega,
      "Início da vigência": item.inicioVigencia,
      "Término da vigência": item.fimVigencia,
    }));

    const ws = XLSX.utils.json_to_sheet(dados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rotas");
    baixarArquivo("Rotas-Exportadas.xlsx", wb);
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

        return {
          id: index + 1,
          transportadoraId: transportadora ? transportadora.id : 0,
          transportadoraNome: nomeTransportadora,
          codigoUnidade: lerValor(linha, [
            "Código da unidade",
            "Codigo da unidade",
            "Unidade",
          ]),
          cotacao: lerValor(linha, ["Cotação", "Cotacao"]),
          ibgeOrigem: lerValor(linha, [
            "Código IBGE Origem",
            "Codigo IBGE Origem",
            "IBGE Origem",
          ]),
          ibgeDestino: lerValor(linha, [
            "Código IBGE Destino",
            "Codigo IBGE Destino",
            "IBGE Destino",
          ]),
          cepInicial: lerValor(linha, ["CEP inicial", "CEP Inicial"]),
          cepFinal: lerValor(linha, ["CEP final", "CEP Final"]),
          metodoEnvio:
            lerValor(linha, ["Método de envio", "Metodo de envio"]) ||
            "RODOVIARIO",
          prazoEntrega: lerValor(linha, ["Prazo de entrega"]),
          inicioVigencia: lerValor(linha, [
            "Início da vigência",
            "Inicio da vigencia",
          ]),
          fimVigencia: lerValor(linha, [
            "Término da vigência",
            "Termino da vigencia",
          ]),
        };
      })
      .filter((item) => item.cotacao && item.ibgeDestino);

    onImportar(novos);
    event.target.value = "";
  };

  return (
    <div className="pagina">
      <div className="cabecalho-pagina">
        <div>
          <h2>Rotas</h2>
          <p>
            Nesta tela, o foco principal é importar e exportar rotas inteiras. O
            cadastro manual deve ser usado apenas para ajustes mínimos.
          </p>
        </div>
      </div>

      <section className="card-padrao">
        <div className="card-topo">
          <h3>Operação principal de Rotas</h3>
          <p style={{ margin: 0, color: "#63738d" }}>
            Use a importação como fluxo principal. O cadastro manual fica
            disponível apenas para exceções e pequenos ajustes.
          </p>
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
            Importar Rotas
          </button>
          <button className="botao-secundario" onClick={exportarRotas}>
            Exportar Rotas
          </button>
          <button
            className="botao-secundario"
            onClick={() => setMostrarManual((valor) => !valor)}
          >
            {mostrarManual ? "Fechar ajuste manual" : "Adicionar rota manual"}
          </button>
        </div>
      </section>

      {mostrarManual && (
        <section className="card-padrao">
          <div className="card-topo">
            <h3>Ajuste manual de rota</h3>
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
              Cotação
              <input
                value={formulario.cotacao}
                onChange={(e) =>
                  setFormulario({
                    ...formulario,
                    cotacao: e.target.value,
                  })
                }
                placeholder="Ex.: SP CAPITAL"
              />
            </label>

            <label>
              Método de envio
              <select
                value={formulario.metodoEnvio}
                onChange={(e) =>
                  setFormulario({
                    ...formulario,
                    metodoEnvio: e.target.value,
                  })
                }
              >
                <option value="RODOVIARIO">RODOVIARIO</option>
                <option value="AEREO">AEREO</option>
              </select>
            </label>

            <label>
              IBGE origem
              <input
                value={formulario.ibgeOrigem}
                onChange={(e) =>
                  setFormulario({
                    ...formulario,
                    ibgeOrigem: e.target.value,
                  })
                }
                placeholder="Código IBGE origem"
              />
            </label>

            <label>
              IBGE destino
              <input
                value={formulario.ibgeDestino}
                onChange={(e) =>
                  setFormulario({
                    ...formulario,
                    ibgeDestino: e.target.value,
                  })
                }
                placeholder="Código IBGE destino"
              />
            </label>

            <label>
              CEP inicial
              <input
                value={formulario.cepInicial}
                onChange={(e) =>
                  setFormulario({
                    ...formulario,
                    cepInicial: e.target.value,
                  })
                }
                placeholder="Somente números"
              />
            </label>

            <label>
              CEP final
              <input
                value={formulario.cepFinal}
                onChange={(e) =>
                  setFormulario({
                    ...formulario,
                    cepFinal: e.target.value,
                  })
                }
                placeholder="Somente números"
              />
            </label>

            <label>
              Prazo de entrega
              <input
                value={formulario.prazoEntrega}
                onChange={(e) =>
                  setFormulario({
                    ...formulario,
                    prazoEntrega: e.target.value,
                  })
                }
                placeholder="Dias"
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

            <label className="coluna-inteira">
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
          <h3>Lista de rotas</h3>
          <input
            className="input-busca"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por cotação, transportadora, IBGE ou CEP"
          />
        </div>

        <div className="lista-tabela">
          <div className="linha cabecalho rotas-grid">
            <span>Transportadora</span>
            <span>Unidade</span>
            <span>Cotação</span>
            <span>IBGE destino</span>
            <span>CEP faixa</span>
            <span>Prazo</span>
          </div>

          {lista.map((item) => (
            <div className="linha rotas-grid" key={item.id}>
              <span>{item.transportadoraNome}</span>
              <span>{item.codigoUnidade}</span>
              <span>{item.cotacao}</span>
              <span>{item.ibgeDestino}</span>
              <span>
                {item.cepInicial} até {item.cepFinal}
              </span>
              <span>{item.prazoEntrega}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
