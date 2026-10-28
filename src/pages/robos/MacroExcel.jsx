// Passo a passo da planilha do robo no Excel (alternativa ao .vbs quando o antivirus bloqueia).
export function passosMacroExcel(macro) {
  return (
    <>
      <li>Clique em <b>Copiar código</b>.</li>
      <li>No Excel, abra uma pasta de trabalho nova e aperte <b>Alt+F11</b>; no editor, vá em <b>Inserir → Módulo</b> e cole (Ctrl+V). Se já tem a planilha do robô, apague o código antigo do módulo e cole o novo.</li>
      <li>Salve como <b>Pasta de Trabalho Habilitada para Macro do Excel (*.xlsm)</b>, por exemplo <code>Robo Lancamento.xlsm</code>. NFS-e e CT-e podem ficar na mesma planilha, um módulo para cada.</li>
      <li>Botão (opcional): <b>Inserir → Formas</b>, desenhe um retângulo, clique com o botão direito → <b>Atribuir Macro</b> → <code>{macro}</code>.</li>
      <li>A cada lote: baixe <b>Dados para o Excel</b> na Central, abra a planilha do robô com o SAP logado, clique no botão (ou <b>Alt+F8</b> → <code>{macro}</code> → Executar) e escolha o arquivo de dados. O resultado e o log ficam na mesma pasta do arquivo de dados.</li>
    </>
  );
}
