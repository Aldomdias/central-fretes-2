import { useMemo } from 'react';
import { PLANILHA_ROBO } from '../../utils/robos/sapMacroExcel';

// Passo a passo da planilha do robo no Excel (alternativa ao .vbs quando o antivirus bloqueia).
export function passosMacroExcel(macro) {
  return (
    <>
      <li>Mais fácil: use <b>Baixar planilha do robô (.xlsm)</b>, que já vem montada. Este código só é preciso para montar ou atualizar a planilha.</li>
      <li>Clique em <b>Copiar código</b>.</li>
      <li>No Excel, abra uma pasta de trabalho nova e aperte <b>Alt+F11</b>; no editor, vá em <b>Inserir → Módulo</b> e cole (Ctrl+V). Se já tem a planilha do robô, apague o código antigo do módulo e cole o novo.</li>
      <li>Salve como <b>Pasta de Trabalho Habilitada para Macro do Excel (*.xlsm)</b>, por exemplo <code>Robo Lancamento.xlsm</code>. NFS-e e CT-e podem ficar na mesma planilha, um módulo para cada.</li>
      <li>Botão (opcional): <b>Inserir → Formas</b>, desenhe um retângulo, clique com o botão direito → <b>Atribuir Macro</b> → <code>{macro}</code>.</li>
      <li>A cada lote: baixe <b>Dados para o Excel</b> na Central, abra a planilha do robô com o SAP logado, clique no botão (ou <b>Alt+F8</b> → <code>{macro}</code> → Executar) e escolha o arquivo de dados. O resultado, o log e as pendências ficam na pasta onde a planilha do robô está salva; no fim o robô oferece abrir essa pasta.</li>
    </>
  );
}

// Download da planilha do robo ja montada. gerar(): gerarMacroNfse/gerarMacroCte, para comparar a
// versao do codigo atual com a da planilha publicada.
export function BaixarPlanilhaRobo({ gerar }) {
  const atual = useMemo(() => gerar(), [gerar]);
  const desatualizada = PLANILHA_ROBO.versoes[atual.macro] !== atual.versao;
  return (
    <>
      <a
        className="btn-secondary"
        href={PLANILHA_ROBO.url}
        download={PLANILHA_ROBO.nome}
        title="Planilha do Excel com o robo ja montado (botoes Lancar NFS-e e Lancar CT-e)"
        style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
      >
        Baixar planilha do robô (.xlsm)
      </a>
      {desatualizada ? (
        <span style={{ fontSize: 12, color: '#b45309', alignSelf: 'center' }}>
          A planilha publicada está desatualizada: monte com o “Código da macro (Excel)”.
        </span>
      ) : null}
    </>
  );
}
