// Macro do Excel (VBA) dos robos de lancamento: alternativa ao .vbs nas maquinas em que o antivirus
// bloqueia o script. O codigo sai do mesmo corpo do .vbs (corpoNfse/corpoCte), convertido para VBA:
// sem WScript, gravando arquivos com Open/Print do proprio Excel e sem RegExp. A macro fica numa
// planilha da maquina; a cada lote a Central baixa so os dados (.xlsx, sem codigo) e a macro le esse arquivo.

import { CAMPOS_CTE, CAMPOS_NFSE, corpoCte, corpoNfse } from './sapLancamentoVbs';

// Rotinas do .vbs que mudam no Excel (null = nao existe no Excel).
const SUBSTITUTAS = {
  EscolherPasta: null,
  CriarPasta: null,
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
  "' Acrescenta uma linha no fim de um arquivo texto (log, resultado e pendencias).",
  'Sub AnexarLinha(caminho, texto)',
  '    Dim h',
  '    h = FreeFile',
  '    Open caminho For Append As #h',
  '    Print #h, texto',
  '    Close #h',
  'End Sub',
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
  '    If CStr(ws.Cells(1, NCAMPOS + 2).Value) <> "macro " & VERSAO_MACRO Then',
  '        wb.Close False',
  '        MsgBox "O codigo da macro esta desatualizado. Na Central de Fretes, clique em ""Codigo da macro (Excel)"", troque o codigo do modulo e rode de novo.", vbExclamation, ROBO',
  '        Exit Function',
  '    End If',
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

function gerarMacro({ corpo, campos, robo, macro }) {
  const { dims, inicio, rotinas, principal } = separar(corpo);
  const rotinasVba = rotinas.flatMap((r) => {
    if (!(r.nome in SUBSTITUTAS)) return [...r.linhas, ''];
    return SUBSTITUTAS[r.nome] ? [...SUBSTITUTAS[r.nome], ''] : [];
  });
  const programa = [
    ...rotinasVba,
    ...AUXILIARES_EXCEL,
    '',
    `' Botao / Alt+F8: escolha a planilha de dados baixada da Central. O resultado e o log ficam na mesma pasta dela.`,
    `Public Sub ${macro}()`,
    '    Dim arq',
    '    arq = Application.GetOpenFilename("Dados do lote (*.xlsx), *.xlsx", , "Escolha a planilha de dados baixada da Central de Fretes")',
    '    If VarType(arq) = vbBoolean Then Exit Sub',
    '    If Not CarregarDados(arq) Then Exit Sub',
    ...inicio.map((a) => `    ${a}`),
    '    pastaLog = Left(arq, InStrRev(arq, "\\") - 1)',
    ...principal.map((l) => (l ? `    ${l}` : l)),
    'End Sub',
  ].join('\n');
  const declaracoes = [
    ...dims,
    'Dim arqLog',
    `Private Const ROBO = "${robo}"`,
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
  return gerarMacro({ corpo: corpoNfse([], ''), campos: CAMPOS_NFSE, robo: 'Robo NFS-e', macro: 'LancarNFSe' });
}

export function gerarMacroCte() {
  return gerarMacro({ corpo: corpoCte([], ''), campos: CAMPOS_CTE, robo: 'Robo CT-e', macro: 'LancarCTe' });
}

// Linhas da planilha de dados: cabecalho = campos (+ a versao da macro na coluna depois de um espaco).
export function matrizDadosMacro(linhas, { campos, versao }) {
  return [
    [...campos, '', `macro ${versao}`],
    ...linhas.map((l) => campos.map((c) => String(l[c] ?? ''))),
  ];
}
