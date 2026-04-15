import { useMemo, useState } from "react";

const estadoInicial = {
  transportadoraId: 1,
  ativo: true,
  canal: "B2C",
  cidade: "",
  uf: "",
};

export default function AtendimentoPage({
  atendimentos,
  transportadoras,
  onAdicionar,
}) {
  const [buscaCidade, setBuscaCidade] = useState("");
  const [buscaTransportadora, setBuscaTransportadora] = useState("");
  const [formulario, setFormulario] = useState(estadoInicial);

  const lista = useMemo(() => {
    return atendimentos.filter((item) => {
      const atendeCidade = item.cidade
        .toLowerCase()
        .includes(buscaCidade.toLowerCase());

      const atendeTransportadora = item.transportadoraNome
        .toLowerCase()
        .includes(buscaTransportadora.toLowerCase());

      return atendeCidade && atendeTransportadora;
    });
  }, [atendimentos, buscaCidade, buscaTransportadora]);

  const salvar = () => {
    if (!formulario.cidade.trim() || !formulario.uf.trim()) return;

    onAdicionar({
      ...formulario,
      cidade: formulario.cidade.trim(),
      uf: formulario.uf.trim().toUpperCase(),
    });

    setFormulario(estadoInicial);
  };

  return (
    <div className="pagina">
      <div className="cabecalho-pagina">
        <div>
          <h2>Atendimento por Cidade</h2>
          <p>
            Visão estratégica para buscar quais transportadoras atendem cada
            cidade e canal.
          </p>
        </div>
      </div>

      <div className="grade-dupla">
        <section className="card-padrao">
          <div className="card-topo">
            <h3>Novo atendimento</h3>
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
              Canal
              <select
                value={formulario.canal}
                onChange={(e) =>
                  setFormulario({
                    ...formulario,
                    canal: e.target.value,
                  })
                }
              >
                <option value="B2C">B2C</option>
                <option value="ATACADO">ATACADO</option>
                <option value="LOTAÇÃO">LOTAÇÃO</option>
              </select>
            </label>

            <label>
              Cidade
              <input
                value={formulario.cidade}
                onChange={(e) =>
                  setFormulario({
                    ...formulario,
                    cidade: e.target.value,
                  })
                }
                placeholder="Ex.: Itajaí"
              />
            </label>

            <label>
              UF
              <input
                value={formulario.uf}
                onChange={(e) =>
                  setFormulario({
                    ...formulario,
                    uf: e.target.value,
                  })
                }
                placeholder="SC"
                maxLength={2}
              />
            </label>

            <label className="switch-linha coluna-inteira">
              <span>Ativo</span>
              <input
                type="checkbox"
                checked={formulario.ativo}
                onChange={(e) =>
                  setFormulario({
                    ...formulario,
                    ativo: e.target.checked,
                  })
                }
              />
            </label>
          </div>

          <div className="acoes-formulario">
            <button className="botao-primario" onClick={salvar}>
              Adicionar atendimento
            </button>
          </div>
        </section>

        <section className="card-padrao">
          <div className="card-topo entre-linhas">
            <h3>Consulta de abrangência</h3>
          </div>

          <div className="filtros-inline">
            <input
              className="input-busca"
              value={buscaCidade}
              onChange={(e) => setBuscaCidade(e.target.value)}
              placeholder="Buscar cidade"
            />
            <input
              className="input-busca"
              value={buscaTransportadora}
              onChange={(e) => setBuscaTransportadora(e.target.value)}
              placeholder="Buscar transportadora"
            />
          </div>

          <div className="lista-tabela tabela-quatro-colunas">
            <div className="linha cabecalho quatro-colunas">
              <span>Transportadora</span>
              <span>Canal</span>
              <span>Cidade</span>
              <span>UF</span>
            </div>

            {lista.map((item) => (
              <div className="linha quatro-colunas" key={item.id}>
                <span>{item.transportadoraNome}</span>
                <span>{item.canal}</span>
                <span>{item.cidade}</span>
                <span>{item.uf}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
