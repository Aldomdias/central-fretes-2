import React, { useState } from "react";

export default function EntradaFormatacaoTemplate({
  onAbrirModeloManual,
  onImportarTemplatePadrao,
  carregando = false,
}) {
  const [arquivoRotas, setArquivoRotas] = useState(null);
  const [arquivoFretes, setArquivoFretes] = useState(null);

  const podeImportar = arquivoRotas && arquivoFretes && !carregando;

  return (
    <div className="formatacao-entrada-grid">
      <div className="formatacao-card-opcao">
        <h3>Enviar template padrão</h3>
        <p>
          Anexe os dois arquivos do modelo padrão para formatar automaticamente:
          <strong> Rotas </strong> e <strong> Fretes</strong>.
        </p>

        <label className="formatacao-upload-box">
          <span>Arquivo de Rotas</span>
          <input
            type="file"
            accept=".xlsx,.xls,.ods"
            onChange={(e) => setArquivoRotas(e.target.files?.[0] || null)}
          />
          <small>{arquivoRotas ? arquivoRotas.name : "Nenhum arquivo selecionado"}</small>
        </label>

        <label className="formatacao-upload-box">
          <span>Arquivo de Fretes</span>
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
          onClick={() => onImportarTemplatePadrao({ arquivoRotas, arquivoFretes })}
        >
          {carregando ? "Importando..." : "Importar e formatar automaticamente"}
        </button>
      </div>

      <div className="formatacao-card-opcao">
        <h3>Usar modelo criado na ferramenta</h3>
        <p>
          Entre no fluxo manual para cadastrar rotas, aplicar faixas,
          gerar fretes e exportar modelo para preenchimento.
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
