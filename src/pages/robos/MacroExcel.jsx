import { useMemo } from 'react';
import { PLANILHA_ROBO } from '../../utils/robos/sapMacroExcel';
import { baixarKitMontagem } from '../../utils/robos/planilhaRoboUnica';

// Passo a passo da planilha do robo no Excel (alternativa ao .vbs quando o antivirus bloqueia).
export function passosMacroExcel(macro, nomePlanilha = 'Robo Lancamento.xlsm', textoLote = null) {
  return (
    <>
      <li>Mais fácil: use <b>Baixar planilha do robô (.xlsm)</b>, que já vem montada. Este código só é preciso para montar ou atualizar a planilha.</li>
      <li>Clique em <b>Copiar código</b>.</li>
      <li>No Excel, abra uma pasta de trabalho nova e aperte <b>Alt+F11</b>; no editor, vá em <b>Inserir → Módulo</b> e cole (Ctrl+V). Se já tem a planilha do robô, apague o código antigo do módulo e cole o novo.</li>
      <li>Salve como <b>Pasta de Trabalho Habilitada para Macro do Excel (*.xlsm)</b>, por exemplo <code>{nomePlanilha}</code>.{nomePlanilha === 'Robo Lancamento.xlsm' ? ' Os 4 robôs (NFS-e, CT-e, Escrituração e Correção de saldo) ficam na mesma planilha, um módulo e um botão para cada.' : ''}</li>
      <li>Botão (opcional): <b>Inserir → Formas</b>, desenhe um retângulo, clique com o botão direito → <b>Atribuir Macro</b> → <code>{macro}</code>.</li>
      {textoLote ? <li>{textoLote}</li> : <li>A cada lote: baixe <b>Dados para o Excel</b> na Central, abra a planilha do robô com o SAP logado, clique no botão (ou <b>Alt+F8</b> → <code>{macro}</code> → Executar) e escolha o arquivo de dados. O resultado, o log e as pendências ficam na pasta onde a planilha do robô está salva; no fim o robô oferece abrir essa pasta.</li>}
    </>
  );
}

// Download da planilha unica do robo ja montada (os 4 robos: NFS-e, CT-e, Escrituracao e Correcao de saldo).
// gerar(): o gerador da macro deste robo (ou uma lista), para comparar com a versao da planilha publicada.
// Robo que ainda nao esta na planilha (ou mudou): aviso + kit de montagem com o codigo dos 4 modulos.
export function BaixarPlanilhaRobo({ gerar, planilha = PLANILHA_ROBO }) {
  const atual = useMemo(() => [gerar()].flat(), [gerar]);
  const naoPublicada = atual.some((m) => !planilha.versoes[m.macro]);
  const desatualizada = !naoPublicada && atual.some((m) => planilha.versoes[m.macro] !== m.versao);
  return (
    <>
      <a
        className="btn-secondary"
        href={planilha.url}
        download={planilha.nome}
        title="Planilha do Excel com os robos ja montados (um botao para cada robo)"
        style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
      >
        Baixar planilha do robô (.xlsm)
      </a>
      {naoPublicada || desatualizada ? (
        <>
          <button type="button" className="btn-secondary" onClick={() => baixarKitMontagem()} title="Codigo dos 4 robos e o passo a passo para montar a planilha unica">
            Kit de montagem (.xlsx)
          </button>
          <span style={{ fontSize: 12, color: '#b45309', alignSelf: 'center' }}>
            {naoPublicada
              ? 'Este robô ainda não está na planilha publicada: use o kit de montagem para incluir o módulo dele.'
              : 'A planilha publicada está desatualizada para este robô: atualize o módulo com o kit de montagem.'}
          </span>
        </>
      ) : null}
    </>
  );
}
