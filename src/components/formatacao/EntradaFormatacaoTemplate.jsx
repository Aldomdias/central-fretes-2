
import React, { useState } from "react";

export default function EntradaFormatacaoTemplate({
  onAbrirModeloManual,
  onImportarTemplatePadrao,
  carregando = false,
}) {
  const [arquivoRotas, setArquivoRotas] = useState(null);
  const [arquivoFretes, setArquivoFretes] = useState(null);

  const podeImportar = arquivoRotas && arquivoFretes && !carregando;

  async function handleImportar() {
    if (!podeImportar) return;
    await onImportarTemplatePadrao({ arquivoRotas, arquivoFretes });
  }

  return (
    <div className="formatacao-entrada-grid">
      <div className="formatacao-card-opcao">
        <h3>Enviar template padrão</h3>
        <p>
          Use este modo quando você já tiver os arquivos no modelo padrão:
          <strong> Rotas.xlsx </strong> e <strong> fretes.xlsx</strong>.
        </p>

        <label className="formatacao-upload-box">
          <span>Selecionar arquivo de Rotas</span>
          <input
            type="file"
            accept=".xlsx,.xls,.ods"
            onChange={(e) => setArquivoRotas(e.target.files?.[0] || null)}
          />
          <small>{arquivoRotas ? arquivoRotas.name : "Nenhum arquivo selecionado"}</small>
        </label>

        <label className="formatacao-upload-box">
          <span>Selecionar arquivo de Fretes</span>
          <input
            type="file"
            accept=".xlsx,.xls,.ods"
            onChange={(e) => setArquivoFretes(e.target.files?.[0] || null)}
          />
          <small>{arquivoFretes ? arquivoFretes.name : "Nenhum arquivo selecionado"}</small>
        </label>

        <button
          type="button"
          className="formatacao-primary-btn"
          disabled={!podeImportar}
          onClick={handleImportar}
        >
          {carregando ? "Importando..." : "Importar e formatar automaticamente"}
        </button>
      </div>

      <div className="formatacao-card-opcao">
        <h3>Usar modelo criado na ferramenta</h3>
        <p>
          Use este modo para seguir pelo preenchimento manual, aplicação de faixas,
          geração de fretes e exportação para preenchimento.
        </p>

        <button
          type="button"
          className="formatacao-secondary-btn"
          onClick={onAbrirModeloManual}
        >
          Ir para o modelo criado
        </button>
      </div>
    </div>
  );
}
