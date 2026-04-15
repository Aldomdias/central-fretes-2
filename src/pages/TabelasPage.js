import { useMemo, useState } from "react";

const estadoInicial = {
  transportadoraId: 1,
  nomeTabela: "",
  codigoUnidade: "",
  cidadeOrigem: "",
  ufOrigem: "",
  canal: "B2C",
  tipoCalculo: "PERCENTUAL",
  ativo: true,
};

export default function TabelasPage({ tabelas, transportadoras, onAdicionar }) {
  const [transportadoraFiltro, setTransportadoraFiltro] = useState(
    transportadoras[0]?.id || 1
  );
  const [formulario, setFormulario] = useState(estadoInicial);

  const lista = useMemo(() => {
    return tabelas.filter(
      (item) => item.transportadoraId === Number(transportadoraFiltro)
    );
  }, [tabelas, transportadoraFiltro]);

  const salvar = () => {
    if (!formulario.nomeTabela.trim()) return;
    if (!formulario.codigoUnidade.trim()) return;

    onAdicionar({
      ...formulario,
      nomeTabela: formulario.nomeTabela.trim(),
      codigoUnidade: formulario.codigoUnidade.trim(),
      cidadeOrigem: formulario.cidadeOrigem.trim(),
      ufOrigem: formulario.ufOrigem.trim().toUpperCase(),
    });

    setFormulario({
      ...estadoInicial,
      transportadoraId: formulario.transportadoraId,
    });
  };

  return (
    <div className="pagina">
      <div className="cabecalho-pagina">
        <div>
          <h2>Tabelas da Transportadora</h2>
          <p>
            A estrutura agora fica centrada na transportadora. Dentro dela ficam
            as tabelas/origens, e depois as rotas, fretes, generalidades e taxas
            por destino.
          </p>
        </div>
      </div>

      <section className="card-padrao">
        <div className="card-topo">
          <h3>Selecionar transportadora</h3>
        </div>

        <div className="form-grid">
          <label className="coluna-inteira">
            Transportadora
            <select
              value={transportadoraFiltro}
              onChange={(e) => {
                const valor = Number(e.target.value);
                setTransportadoraFiltro(valor);
                setFormulario((anterior) => ({
                  ...anterior,
                  transportadoraId: valor,
                }));
              }}
            >
              {transportadoras.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nome}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <div className="grade-dupla">
        <section className="card-padrao">
          <div className="card-topo">
            <h3>Nova tabela/origem</h3>
          </div>

          <div className="form-grid">
            <label>
              Nome da tabela
              <input
                value={formulario.nomeTabela}
                onChange={(e) =>
                  setFormulario({ ...formulario, nomeTabela: e.target.value })
                }
                placeholder="Ex.: Jadlog - Itajaí"
              />
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
              Cidade de origem
              <input
                value={formulario.cidadeOrigem}
                onChange={(e) =>
                  setFormulario({ ...formulario, cidadeOrigem: e.target.value })
                }
                placeholder="Ex.: Itajaí"
              />
            </label>

            <label>
              UF de origem
              <input
                value={formulario.ufOrigem}
                onChange={(e) =>
                  setFormulario({ ...formulario, ufOrigem: e.target.value })
                }
                placeholder="SC"
                maxLength={2}
              />
            </label>

            <label>
              Canal
              <select
                value={formulario.canal}
                onChange={(e) =>
                  setFormulario({ ...formulario, canal: e.target.value })
                }
              >
                <option value="B2C">B2C</option>
                <option value="ATACADO">ATACADO</option>
                <option value="LOTAÇÃO">LOTAÇÃO</option>
              </select>
            </label>

            <label>
              Tipo de cálculo predominante
              <select
                value={formulario.tipoCalculo}
                onChange={(e) =>
                  setFormulario({ ...formulario, tipoCalculo: e.target.value })
                }
              >
                <option value="PERCENTUAL">PERCENTUAL</option>
                <option value="FAIXA_PESO">FAIXA_DE_PESO</option>
              </select>
            </label>

            <label className="switch-linha coluna-inteira">
              <span>Ativa</span>
              <input
                type="checkbox"
                checked={formulario.ativo}
                onChange={(e) =>
                  setFormulario({ ...formulario, ativo: e.target.checked })
                }
              />
            </label>
          </div>

          <div className="acoes-formulario">
            <button className="botao-primario" onClick={salvar}>
              Adicionar tabela
            </button>
          </div>
        </section>

        <section className="card-padrao">
          <div className="card-topo">
            <h3>Tabelas da transportadora selecionada</h3>
          </div>

          <div className="lista-tabela">
            <div
              className="linha cabecalho"
              style={{
                gridTemplateColumns: "1.3fr 0.8fr 0.9fr 0.8fr 0.7fr 0.7fr",
              }}
            >
              <span>Tabela</span>
              <span>Unidade</span>
              <span>Origem</span>
              <span>Canal</span>
              <span>Cálculo</span>
              <span>Status</span>
            </div>

            {lista.map((item) => (
              <div
                className="linha"
                key={item.id}
                style={{
                  gridTemplateColumns: "1.3fr 0.8fr 0.9fr 0.8fr 0.7fr 0.7fr",
                }}
              >
                <span>{item.nomeTabela}</span>
                <span>{item.codigoUnidade}</span>
                <span>
                  {item.cidadeOrigem}/{item.ufOrigem}
                </span>
                <span>{item.canal}</span>
                <span>{item.tipoCalculo}</span>
                <span>
                  <span
                    className={item.ativo ? "badge ativo" : "badge inativo"}
                  >
                    {item.ativo ? "Ativa" : "Inativa"}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="card-padrao">
        <div className="card-topo">
          <h3>Como vamos seguir a partir daqui</h3>
        </div>
        <p style={{ margin: 0, color: "#31415f" }}>
          Cada tabela da transportadora será a base para: generalidades gerais,
          taxas por destino, rotas da tabela e fretes da tabela. Isso evita a
          confusão de deixar tudo solto fora da transportadora.
        </p>
      </section>
    </div>
  );
}
