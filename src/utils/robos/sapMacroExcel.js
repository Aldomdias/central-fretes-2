// Macro do Excel (VBA) dos robos de lancamento: alternativa ao .vbs nas maquinas em que o antivirus
// bloqueia o script. O codigo sai do mesmo corpo do .vbs (corpoNfse/corpoCte), convertido para VBA:
// sem WScript, gravando arquivos com Open/Print do proprio Excel e sem RegExp. A macro fica numa
// planilha da maquina; a cada lote a Central baixa so os dados (.xlsx, sem codigo) e a macro le esse arquivo.

import { CAMPOS_CTE, CAMPOS_NFSE, corpoCte, corpoNfse } from './sapLancamentoVbs';

// Rotinas do .vbs que mudam no Excel (null = nao existe no Excel).
const SUBSTITUTAS = {
  EscolherPasta: null,
  CriarPasta: null,
  AvisarCentral: [
    "' Manda o pedido / a MIRO para a fila do robo na Central (se o arquivo de dados trouxe o endereco).",
    'Sub AvisarCentral(id, tipo, valor)',
    '    If tipo = "miro" Then',
    '        EnviarCentral id, """miro"":""" & valor & """,""motivo"":null"',
    '    Else',
    '        EnviarCentral id, """pedido"":""" & valor & """"',
    '    End If',
    'End Sub',
  ],
  AvisarFalhaCentral: [
    "' Manda o motivo da falha da nota atual (L(kk)) para a fila do robo.",
    'Sub AvisarFalhaCentral(sap, desc)',
    '    Dim m',
    '    m = sap',
    '    If m = "" Or m = "(sem mensagem)" Then m = desc',
    '    EnviarCentral L(kk)(0), """motivo"":""" & JsonTexto(m) & """"',
    'End Sub',
  ],
  NumeroDoStatus: [
    "' Pega o numero de 10 digitos do documento na mensagem do SAP (ex.: Pedido normal criado sob o no 4510056532).",
    'Function NumeroDoStatus(txt)',
    '    NumeroDoStatus = Numero10(txt, True)',
    '    If NumeroDoStatus = "" Then NumeroDoStatus = txt',
    'End Function',
  ],
  MiroJaLancada: [
    "' MIRO recusada porque a fatura ja existe (\"Verificar se fatura ja inserida no lancamento contabil 5106194881 2026\"):",
    "' devolve o numero do documento que o SAP informou; vazio se a mensagem for outra.",
    'Function MiroJaLancada()',
    '    Dim txt, u',
    '    MiroJaLancada = ""',
    '    txt = StatusSap()',
    '    u = LCase(txt)',
    '    If InStr(u, "inserida") > 0 Or InStr(u, "already entered") > 0 Or InStr(u, "already been entered") > 0 Then MiroJaLancada = Numero10(txt, False)',
    'End Function',
  ],
};

const AUXILIARES_EXCEL = [
  "' Espera ms milissegundos sem travar o Excel.",
  'Sub Esperar(ms)',
  '    Dim ini',
  '    If ms >= 1000 Then',
  '        Application.Wait Now + TimeSerial(0, 0, ms \\ 1000)',
  '    Else',
  '        ini = Timer',
  '        Do While Timer < ini + ms / 1000 And Timer >= ini',
  '            DoEvents',
  '        Loop',
  '    End If',
  'End Sub',
  '',
  "' Acrescenta uma linha no fim de um arquivo texto (log, resultado e pendencias). Se a pasta nao deixa",
  "' gravar (erro 70: pasta protegida, OneDrive...), passa a gravar em %TEMP%\\CentralFretes.",
  'Sub AnexarLinha(ByVal caminho, texto)',
  '    Dim h, reserva',
  '    On Error Resume Next',
  '    h = FreeFile',
  '    Open caminho For Append As #h',
  '    If Err.Number <> 0 Then',
  '        Err.Clear',
  '        reserva = Environ("TEMP") & "\\CentralFretes"',
  '        If pastaLog <> reserva Then',
  '            MkDir reserva',
  '            Err.Clear',
  '            arqLog = reserva & Mid(arqLog, InStrRev(arqLog, "\\"))',
  '            pastaLog = reserva',
  '        End If',
  '        caminho = pastaLog & Mid(caminho, InStrRev(caminho, "\\"))',
  '        h = FreeFile',
  '        Open caminho For Append As #h',
  '        If Err.Number <> 0 Then',
  '            On Error GoTo 0',
  '            Err.Raise 70, , "Sem permissao para gravar em " & caminho',
  '        End If',
  '    End If',
  '    On Error GoTo 0',
  '    Print #h, texto',
  '    Close #h',
  'End Sub',
  '',
  "' Atualiza a nota na fila do robo da Central (tabela robos_fila). Sem internet ou bloqueado: so conta a falha,",
  "' o robo segue e no fim pede para importar o arquivo de resultado. Resposta [] = a nota nao estava na fila.",
  'Sub EnviarCentral(id, campos)',
  '    Dim http, url',
  '    If urlCentral = "" Then Exit Sub',
  '    On Error Resume Next',
  '    Set http = CreateObject("MSXML2.XMLHTTP.6.0")',
  '    url = urlCentral & "/rest/v1/robos_fila?tipo=eq." & TIPO_FILA & "&chave=eq." & Application.WorksheetFunction.EncodeURL(id)',
  '    http.Open "PATCH", url, False',
  '    http.setRequestHeader "apikey", chaveCentral',
  '    http.setRequestHeader "Authorization", "Bearer " & chaveCentral',
  '    http.setRequestHeader "Content-Type", "application/json"',
  '    http.setRequestHeader "Prefer", "return=representation"',
  '    http.send "{" & campos & "}"',
  '    If Err.Number <> 0 Then',
  '        nFalhaEnvio = nFalhaEnvio + 1',
  '    ElseIf http.Status >= 300 Or Len(http.responseText) < 5 Then',
  '        nFalhaEnvio = nFalhaEnvio + 1',
  '    Else',
  '        nEnviados = nEnviados + 1',
  '    End If',
  '    Err.Clear',
  'End Sub',
  '',
  "' Texto seguro dentro de aspas no JSON.",
  'Function JsonTexto(t)',
  '    JsonTexto = Replace(Replace(Replace(Replace(CStr(t), "\\", "\\\\"), """", "\\"""), vbCr, " "), vbLf, " ")',
  'End Function',
  '',
  "' Primeiro (ou ultimo) numero de 10 digitos do texto; vazio se nao houver.",
  'Function Numero10(txt, ultimo)',
  '    Dim i, c, atual',
  '    Numero10 = ""',
  '    atual = ""',
  '    For i = 1 To Len(txt) + 1',
  '        c = Mid(txt, i, 1)',
  '        If c Like "#" Then',
  '            atual = atual & c',
  '        Else',
  '            If Len(atual) >= 10 Then',
  '                Numero10 = Left(atual, 10)',
  '                If Not ultimo Then Exit Function',
  '            End If',
  '            atual = ""',
  '        End If',
  '    Next',
  'End Function',
  '',
  "' Le a planilha de dados baixada da Central (1a aba: cabecalho na linha 1, uma nota por linha).",
  'Function CarregarDados(arq)',
  '    Dim wb, ws, i, j, ultima, v(), cab',
  '    CarregarDados = False',
  '    Set wb = Workbooks.Open(arq, False, True)',
  '    Set ws = wb.Worksheets(1)',
  '    cab = ""',
  '    For j = 1 To NCAMPOS',
  '        cab = cab & CStr(ws.Cells(1, j).Value) & ";"',
  '    Next',
  '    If cab <> CABECALHO_DADOS Then',
  '        wb.Close False',
  '        MsgBox "Esta planilha nao e a de dados do " & ROBO & " baixada da Central de Fretes.", vbExclamation, ROBO',
  '        Exit Function',
  '    End If',
  "    ' Versao diferente: a Central mudou o robo depois desta planilha. Os dados servem (o cabecalho confere), so avisa.",
  '    If CStr(ws.Cells(1, NCAMPOS + 2).Value) <> "macro " & VERSAO_MACRO Then',
  '        If MsgBox("O codigo desta planilha e de outra versao do robo (planilha " & VERSAO_MACRO & ", Central " & Mid(CStr(ws.Cells(1, NCAMPOS + 2).Value), 7) & "). Baixe a planilha do robo de novo na Central quando puder." & vbCrLf & vbCrLf & "Continuar mesmo assim?", vbYesNo + vbQuestion, ROBO) = vbNo Then',
  '            wb.Close False',
  '            Exit Function',
  '        End If',
  '    End If',
  "    ' Endereco e chave publica da Central (vem no arquivo de dados): sem eles, o resultado vai so pelo arquivo.",
  '    urlCentral = CStr(ws.Cells(1, NCAMPOS + 3).Value)',
  '    chaveCentral = CStr(ws.Cells(1, NCAMPOS + 4).Value)',
  '    ultima = ws.Cells(ws.Rows.Count, 1).End(-4162).Row',
  '    If ultima < 2 Then',
  '        wb.Close False',
  '        MsgBox "A planilha de dados esta vazia.", vbExclamation, ROBO',
  '        Exit Function',
  '    End If',
  '    ReDim L(ultima - 2)',
  '    For i = 2 To ultima',
  '        ReDim v(NCAMPOS - 1)',
  '        For j = 1 To NCAMPOS',
  '            v(j - 1) = CStr(ws.Cells(i, j).Value)',
  '        Next',
  '        L(i - 2) = v',
  '    Next',
  '    wb.Close False',
  '    CarregarDados = True',
  'End Function',
];

// Separa o .vbs em declaracoes (Dim), atribuicoes iniciais, rotinas (Sub/Function) e o programa principal.
function separar(linhasVbs) {
  const dims = [];
  const inicio = [];
  const rotinas = [];
  const principal = [];
  let bloco = null;
  let comentarios = [];
  let cabecalho = true;
  linhasVbs.join('\n').split('\n').forEach((linha) => {
    if (cabecalho) {
      if (/^Option Explicit/.test(linha)) cabecalho = false;
      return;
    }
    if (bloco) {
      bloco.linhas.push(linha);
      if (/^End (Sub|Function)\b/.test(linha)) { rotinas.push(bloco); bloco = null; }
      return;
    }
    const inicioBloco = linha.match(/^(?:Sub|Function) (\w+)/);
    if (inicioBloco) { bloco = { nome: inicioBloco[1], linhas: [...comentarios, linha] }; comentarios = []; return; }
    if (/^'/.test(linha)) { comentarios.push(linha); return; }
    if (!linha.trim()) { if (principal.length) principal.push(''); return; }
    if (/^Dim /.test(linha)) {
      const [decl, ...atribuicoes] = linha.split(' : ');
      dims.push(decl);
      inicio.push(...atribuicoes);
      return;
    }
    if (/^ReDim L\(|^L\(\d+\) = Array\(/.test(linha)) return; // dados embutidos: no Excel vem da planilha
    principal.push(...comentarios, linha);
    comentarios = [];
  });
  return { dims, inicio, rotinas, principal };
}

// Ajustes de VBScript para VBA (arquivos, espera, parada e o nome Log, que no VBA e funcao matematica).
function paraVba(texto) {
  return texto
    .replace(/^(\s*)(?:Dim f : )?Set f = fso\.OpenTextFile\((.+), 8, True\)\n\s*f\.WriteLine (.+)\n\s*f\.Close$/gm, '$1AnexarLinha $2, $3')
    .replace(/^(\s*)logf\.WriteLine (.+)$/gm, '$1AnexarLinha arqLog, $2')
    .replace(/^(\s*)Set logf = fso\.OpenTextFile\((.+), 8, True\)$/gm, '$1arqLog = $2')
    .replace(/^[ \t]*(?:Set fso = CreateObject\("Scripting\.FileSystemObject"\)|CriarPasta pastaLog|If pastaLog = "" Then pastaLog = EscolherPasta\(\)|logf\.Close)[ \t]*\n/gm, '')
    .replace(/WScript\.Sleep /g, 'Esperar ')
    .replace(/WScript\.Quit 1/g, 'End')
    .replace(/^Sub Log\(/m, 'Sub Registrar(')
    .replace(/^(\s*)Log /gm, '$1Registrar ')
    .replace(/^(Sub|Function) /gm, 'Private $1 ');
}

// Assinatura curta do codigo: a planilha de dados leva a mesma, e a macro recusa dados de outra versao.
function assinatura(texto) {
  let h = 5381;
  for (let i = 0; i < texto.length; i += 1) h = ((h * 33) ^ texto.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

function gerarMacro({ corpo, campos, robo, macro, tipoFila }) {
  const { dims, inicio, rotinas, principal } = separar(corpo);
  const rotinasVba = rotinas.flatMap((r) => {
    if (!(r.nome in SUBSTITUTAS)) return [...r.linhas, ''];
    return SUBSTITUTAS[r.nome] ? [...SUBSTITUTAS[r.nome], ''] : [];
  });
  const programa = [
    ...rotinasVba,
    ...AUXILIARES_EXCEL,
    '',
    `' Botao / Alt+F8: escolha a planilha de dados baixada da Central. O resultado e o log ficam na pasta desta planilha do robo.`,
    `Public Sub ${macro}()`,
    '    Dim arq',
    '    arq = Application.GetOpenFilename("Dados do lote (*.xlsx), *.xlsx", , "Escolha a planilha de dados baixada da Central de Fretes")',
    '    If VarType(arq) = vbBoolean Then Exit Sub',
    '    If Not CarregarDados(arq) Then Exit Sub',
    ...inicio.map((a) => `    ${a}`),
    '    nEnviados = 0',
    '    nFalhaEnvio = 0',
    "    ' Pasta de trabalho = a da planilha do robo (na nuvem/OneDrive o caminho e um link: usa a do arquivo de dados)",
    '    pastaLog = ThisWorkbook.Path',
    '    If pastaLog = "" Or LCase(Left(pastaLog, 4)) = "http" Then pastaLog = Left(arq, InStrRev(arq, "\\") - 1)',
    ...principal.map((l) => (l ? `    ${l}` : l)),
    '    On Error Resume Next',
    '    Dim aviso',
    '    aviso = ""',
    '    If nFalhaEnvio > 0 Then',
    '        aviso = "ATENCAO: " & nFalhaEnvio & " resultado(s) nao chegaram na Central. Importe o arquivo de resultado na Central de Fretes." & vbCrLf & vbCrLf',
    '    ElseIf nEnviados > 0 Then',
    '        aviso = "Resultado ja enviado para a Central de Fretes (" & nEnviados & " registro(s)). Nao precisa importar." & vbCrLf & vbCrLf',
    '    End If',
    '    If MsgBox(aviso & "Abrir a pasta com o resultado?" & vbCrLf & vbCrLf & pastaLog, vbYesNo + vbQuestion, ROBO) = vbYes Then ThisWorkbook.FollowHyperlink pastaLog',
    'End Sub',
  ].join('\n');
  const declaracoes = [
    ...dims,
    'Dim arqLog, urlCentral, chaveCentral, nEnviados, nFalhaEnvio',
    `Private Const ROBO = "${robo}"`,
    `Private Const TIPO_FILA = "${tipoFila}"`,
    `Private Const NCAMPOS = ${campos.length}`,
    `Private Const CABECALHO_DADOS = "${campos.join(';')};"`,
  ].join('\n');
  const semVersao = `${declaracoes}\n\n${paraVba(programa)}`;
  const versao = assinatura(semVersao);
  const codigo = [
    `' ${robo} (Excel) - Central de Fretes.`,
    "' Cole este codigo num Modulo do Excel (Alt+F11 > Inserir > Modulo) e salve como Pasta de Trabalho Habilitada para Macro (.xlsm).",
    `' Para rodar: Alt+F8 > ${macro} (ou um botao com essa macro) e escolha a planilha de dados baixada da Central.`,
    "' Nao edite: quando a Central mudar o robo, ela avisa e voce cola o codigo novo.",
    'Option Explicit',
    '',
    `Private Const VERSAO_MACRO = "${versao}"`,
    semVersao,
  ].join('\n');
  return { codigo: codigo.replace(/\r?\n/g, '\r\n') + '\r\n', versao, campos, macro };
}

export function gerarMacroNfse() {
  return gerarMacro({ corpo: corpoNfse([], ''), campos: CAMPOS_NFSE, robo: 'Robo NFS-e', macro: 'LancarNFSe', tipoFila: 'NFSE' });
}

export function gerarMacroCte() {
  return gerarMacro({ corpo: corpoCte([], ''), campos: CAMPOS_CTE, robo: 'Robo CT-e', macro: 'LancarCTe', tipoFila: 'CTE' });
}

// Linhas da planilha de dados: cabecalho = campos (+ a versao da macro na coluna depois de um espaco e,
// se informados, o endereco e a chave publica da Central, para a macro mandar o resultado direto).
export function matrizDadosMacro(linhas, { campos, versao }, central = {}) {
  return [
    [...campos, '', `macro ${versao}`, central.url || '', central.chave || ''],
    ...linhas.map((l) => campos.map((c) => String(l[c] ?? ''))),
  ];
}

// Planilha do robo pronta (montada no Excel com o codigo acima e publicada em public/robos).
// Quando o robo mudar, a versao do codigo muda: remonte a planilha com o codigo novo, troque o
// arquivo e atualize as versoes abaixo. Enquanto isso, a tela avisa que a planilha esta desatualizada.
export const PLANILHA_ROBO = {
  url: '/robos/robo-lancamento.xlsm',
  nome: 'Robo Lancamento.xlsm',
  versoes: { LancarNFSe: '5d2bc9ee', LancarCTe: '6f7bc98a' },
};
