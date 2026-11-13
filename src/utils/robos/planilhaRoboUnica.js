// Planilha unica do robo (Robo Lancamento.xlsm): os 4 robos que rodam no Excel com o SAP aberto,
// um modulo e um botao para cada. A cada rodada a Central baixa so o arquivo de dados de cada robo.
import { gerarMacroCte, gerarMacroNfse, PLANILHA_ROBO } from './sapMacroExcel';
import { gerarMacroReprocessar } from './reprocessarCteMacro';
import { gerarMacroSaldo } from './correcaoSaldoMacro';
import { baixarArquivo } from './lancamentoComum';

export const ROBOS_DA_PLANILHA = [
  { macro: 'LancarNFSe', titulo: 'Lançamento NFS-e', aba: 'Codigo NFS-e', botao: 'Lançar NFS-e', gerar: gerarMacroNfse },
  { macro: 'LancarCTe', titulo: 'Lançamento CT-e', aba: 'Codigo CT-e', botao: 'Lançar CT-e', gerar: gerarMacroCte },
  { macro: 'ReprocessarCTe', titulo: 'Escrituração (Reprocessar CT-e)', aba: 'Codigo Escrituracao', botao: 'Escriturar CT-e', gerar: gerarMacroReprocessar },
  { macro: 'CorrigirSaldo', titulo: 'Correção de saldo', aba: 'Codigo Saldo', botao: 'Corrigir saldo', gerar: gerarMacroSaldo },
];

// Situacao de cada robo na planilha publicada: ok, desatualizado ou faltando.
export function situacaoPlanilhaRobo() {
  return ROBOS_DA_PLANILHA.map((r) => {
    const { versao } = r.gerar();
    const publicada = PLANILHA_ROBO.versoes[r.macro] || '';
    return { ...r, versao, publicada, situacao: !publicada ? 'faltando' : publicada === versao ? 'ok' : 'desatualizado' };
  });
}

// Kit para montar/atualizar a planilha: aba "Montagem" com o passo a passo e uma aba de codigo por robo
// (coluna A = uma linha de codigo; seleciona a coluna, copia e cola no modulo).
export async function baixarKitMontagem() {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const situacao = situacaoPlanilhaRobo();
  const passos = [
    ['Montagem / atualização da planilha do robô (Robo Lancamento.xlsm)'],
    [''],
    ['1. Baixe a planilha do robô na Central (Baixar planilha do robô .xlsm) e abra. Se o Excel bloquear: botão direito no arquivo > Propriedades > Desbloquear.'],
    ['2. Aperte Alt+F11 (editor de macros).'],
    ['3. Para cada robô abaixo marcado como FALTANDO: menu Inserir > Módulo. Na aba de código dele, clique na letra A (coluna inteira), Ctrl+C, volte ao editor e cole (Ctrl+V).'],
    ['4. Para cada robô DESATUALIZADO: no editor, abra o módulo dele, Ctrl+A, Delete e cole o código novo como no passo 3.'],
    ['5. Feche o editor. Na aba "Robô", Inserir > Formas > retângulo, escreva o nome do botão, botão direito > Atribuir Macro > escolha a macro do robô.'],
    ['6. Arquivo > Salvar (formato .xlsm). Envie a planilha para publicar na Central: assim todo mundo baixa já montada.'],
    [''],
    ['Robô', 'Macro (Atribuir Macro)', 'Texto do botão', 'Aba do código', 'Situação na planilha publicada'],
    ...situacao.map((r) => [r.titulo, r.macro, r.botao, r.aba, r.situacao === 'ok' ? 'ok' : r.situacao === 'faltando' ? 'FALTANDO' : 'DESATUALIZADO']),
  ];
  const ws = XLSX.utils.aoa_to_sheet(passos);
  ws['!cols'] = [{ wch: 34 }, { wch: 24 }, { wch: 18 }, { wch: 22 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Montagem');
  situacao.forEach((r) => {
    const linhas = r.gerar().codigo.replace(/\r\n$/, '').split('\r\n').map((l) => [l]);
    const aba = XLSX.utils.aoa_to_sheet(linhas);
    aba['!cols'] = [{ wch: 160 }];
    XLSX.utils.book_append_sheet(wb, aba, r.aba);
  });
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  baixarArquivo('kit-montagem-robo-lancamento.xlsx', new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}
