// Robo CT-e — consultas no SAP que a planilha fazia para achar o centro de custo:
//   2a. SE16N na tabela J_1BNFE_ACTIVE (chave da NF de venda -> numero do documento) -> EXPORT1
//   2c. ZSD0004 pelos numeros de documento (partidas: escritorio de vendas)            -> EXPORT2
// Os passos 2b/2d (ler os arquivos exportados) sao feitos na propria tela.

import { CONEXAO, cabecalho, vbs } from './sapLancamentoVbs';

export const PASTA_ETAPAS_CTE = 'C:\\Temp\\Etapas';

const CLIPBOARD = [
  'Sub Copiar(texto)',
  '    Dim ex : Set ex = sh.Exec("cmd /c clip")',
  '    ex.StdIn.Write texto',
  '    ex.StdIn.Close',
  '    Do While ex.Status = 0 : WScript.Sleep 50 : Loop',
  'End Sub',
];

function rodape(nome, msgFinal) {
  return [
    '',
    'Sub Falha(etapa)',
    `    MsgBox "ERRO em " & etapa & ": " & Err.Description & vbCrLf & vbCrLf & "Confira a tela do SAP.", vbCritical, ${vbs(nome)}`,
    '    WScript.Quit 1',
    'End Sub',
    '',
    'On Error Resume Next',
    'Executar',
    'If Err.Number <> 0 Then Falha "execucao"',
    'On Error GoTo 0',
    `MsgBox ${vbs(msgFinal)}, vbInformation, ${vbs(nome)}`,
  ];
}

const F2 = 'wnd[1]/usr/ssubSUB_CONFIGURATION:SAPLSALV_GUI_CUL_EXPORT_AS:0512/';
const L1 = 'wnd[1]/usr/subSUB_CONFIGURATION:SAPLSALV_CUL_LAYOUT_CHOOSE:0500/cntlD500_CONTAINER/shellcont/shell';

function juntar(corpo) {
  return corpo.join('\n').replace(/\r?\n/g, '\r\n') + '\r\n';
}

// Passo 2a — equivale ao inicio da macro "Consultar".
// consultas: [{ regiao, ano, mes, cnpj, modelo, serie, nnf, aleatorio, dv }]
export function gerarScriptConsultaNotasCte({ consultas = [], pasta = PASTA_ETAPAS_CTE } = {}) {
  if (!consultas.length) throw new Error('Nao ha chaves de NF de venda para consultar.');
  const CAMPOS = ['regiao', 'ano', 'mes', 'cnpj', 'modelo', 'serie', 'nnf', 'aleatorio', 'dv'];
  const TBL = 'wnd[0]/usr/subTAB_SUB:SAPLSE16N:0121/tblSAPLSE16NSELFIELDS_TC';
  return juntar([
    ...cabecalho('Robo CT-e - 2a. Consultar NFs de venda (SE16N / J_1BNFE_ACTIVE)'),
    'Dim fso, sh, sapGuiAuto, appl, con, session, D(), i, j, partes, col(8), f',
    ...CONEXAO,
    '',
    ...CLIPBOARD,
    '',
    'Sub ColarNoCampo(j)',
    `    session.findById("${TBL}/btnPUSH[4," & j & "]").SetFocus`,
    `    session.findById("${TBL}/btnPUSH[4," & j & "]").press`,
    '    session.findById("wnd[1]/tbar[0]/btn[24]").press',
    '    session.findById("wnd[1]/tbar[0]/btn[8]").press',
    'End Sub',
    '',
    'Sub Executar()',
    '    Set fso = CreateObject("Scripting.FileSystemObject")',
    '    Set sh = CreateObject("WScript.Shell")',
    `    ReDim D(${consultas.length - 1})`,
    ...consultas.map((c, i) => `    D(${i}) = ${vbs(CAMPOS.map((k) => c[k]).join('|'))}`),
    '    For j = 0 To 8 : col(j) = "" : Next',
    `    For i = 0 To ${consultas.length - 1}`,
    '        partes = Split(D(i), "|")',
    '        For j = 0 To 8 : col(j) = col(j) & partes(j) & vbCrLf : Next',
    '    Next',
    "    ' limpa a pasta de etapas (como o botao 1. Importar da planilha)",
    `    If Not fso.FolderExists(${vbs(pasta)}) Then fso.CreateFolder ${vbs(pasta)}`,
    `    For Each f In fso.GetFolder(${vbs(pasta)}).Files : f.Delete True : Next`,
    '    Conectar',
    '    session.findById("wnd[0]").maximize',
    '    session.findById("wnd[0]/tbar[0]/okcd").Text = "/nse16n"',
    '    session.findById("wnd[0]").sendVKey 0',
    '    session.findById("wnd[0]/usr/ctxtGD-TAB").Text = "J_1BNFE_ACTIVE"',
    '    session.findById("wnd[0]/usr/txtGD-MAX_LINES").Text = "999999"',
    '    session.findById("wnd[0]/usr/txtGD-MAX_LINES").SetFocus',
    '    session.findById("wnd[0]").sendVKey 0',
    "    ' posiciona a lista de campos em REGIO",
    '    session.findById("wnd[0]").sendVKey 71',
    '    session.findById("wnd[1]/usr/sub:SAPLSPO4:0300/txtSVALD-VALUE[0,21]").Text = "REGIO"',
    '    session.findById("wnd[1]/tbar[0]/btn[0]").press',
    '    session.findById("wnd[0]").maximize',
    "    ' regiao, ano, mes, CNPJ, modelo, serie, numero da NF, aleatorio, digito verificador",
    '    For j = 0 To 8',
    '        Copiar col(j)',
    '        ColarNoCampo j',
    '    Next',
    '    session.findById("wnd[0]/tbar[1]/btn[8]").press',
    "    ' exporta (layout de indice 1) como EXPORT1",
    '    session.findById("wnd[0]").maximize',
    '    session.findById("wnd[0]/shellcont/shell").pressToolbarContextButton "&MB_VARIANT"',
    '    session.findById("wnd[0]/shellcont/shell").selectContextMenuItem "&LOAD"',
    `    session.findById("${L1}").setCurrentCell 1, "TEXT"`,
    `    session.findById("${L1}").selectedRows = "1"`,
    `    session.findById("${L1}").clickCurrentCell`,
    '    session.findById("wnd[0]/shellcont/shell").pressToolbarContextButton "&MB_EXPORT"',
    '    session.findById("wnd[0]/shellcont/shell").selectContextMenuItem "&XXL"',
    `    session.findById("${F2}txtGS_EXPORT-FILE_NAME").Text = "EXPORT1"`,
    '    session.findById("wnd[1]/tbar[0]/btn[20]").press',
    `    session.findById("wnd[1]/usr/ctxtDY_PATH").Text = ${vbs(pasta)}`,
    '    session.findById("wnd[1]/usr/ctxtDY_PATH").SetFocus',
    '    session.findById("wnd[1]/tbar[0]/btn[0]").press',
    '    WScript.Sleep 3000',
    'End Sub',
    ...rodape('Robo CT-e', `Consulta exportada para ${pasta}. Volte para a Central de Fretes e carregue o arquivo EXPORT1.XLSX (passo 2b).`),
  ]);
}

// Passo 2c — equivale a macro "doc": ZSD0004 pelos numeros de documento e exportacao (EXPORT2).
export function gerarScriptPartidasCte({ docnums = [], pasta = PASTA_ETAPAS_CTE } = {}) {
  if (!docnums.length) throw new Error('Nao ha numeros de documento para consultar.');
  return juntar([
    ...cabecalho('Robo CT-e - 2c. Consultar partidas (ZSD0004)'),
    'Dim fso, sh, sapGuiAuto, appl, con, session, D(), texto',
    ...CONEXAO,
    '',
    ...CLIPBOARD,
    '',
    'Sub Executar()',
    '    Set fso = CreateObject("Scripting.FileSystemObject")',
    '    Set sh = CreateObject("WScript.Shell")',
    `    ReDim D(${docnums.length - 1})`,
    ...docnums.map((d, i) => `    D(${i}) = ${vbs(d)}`),
    '    texto = Join(D, vbCrLf) & vbCrLf',
    `    If Not fso.FolderExists(${vbs(pasta)}) Then fso.CreateFolder ${vbs(pasta)}`,
    '    Conectar',
    '    session.findById("wnd[0]").maximize',
    '    session.findById("wnd[0]/tbar[0]/okcd").Text = "/nzsd0004"',
    '    session.findById("wnd[0]").sendVKey 0',
    '    Copiar texto',
    '    session.findById("wnd[0]/usr/btn%_S_DOCNUM_%_APP_%-VALU_PUSH").press',
    '    session.findById("wnd[1]/tbar[0]/btn[24]").press',
    '    session.findById("wnd[1]/tbar[0]/btn[8]").press',
    '    session.findById("wnd[0]/tbar[1]/btn[8]").press',
    '    session.findById("wnd[0]/tbar[1]/btn[33]").press',
    '    session.findById("wnd[0]/tbar[1]/btn[33]").press',
    `    session.findById("${L1}").currentCellColumn = "DEFAULT"`,
    `    session.findById("${L1}").clickCurrentCell`,
    '    session.findById("wnd[0]").maximize',
    '    session.findById("wnd[0]/mbar/menu[0]/menu[3]/menu[1]").Select',
    `    session.findById("${F2}txtGS_EXPORT-FILE_NAME").Text = "EXPORT2"`,
    '    session.findById("wnd[1]/tbar[0]/btn[20]").press',
    `    session.findById("wnd[1]/usr/ctxtDY_PATH").Text = ${vbs(pasta)}`,
    '    session.findById("wnd[1]/usr/ctxtDY_PATH").SetFocus',
    '    session.findById("wnd[1]/tbar[0]/btn[0]").press',
    '    WScript.Sleep 3000',
    'End Sub',
    ...rodape('Robo CT-e', `Partidas exportadas para ${pasta}. Volte para a Central de Fretes e carregue o arquivo EXPORT2.XLSX (passo 2d).`),
  ]);
}
