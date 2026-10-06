// Geracao dos scripts VBScript (SAP GUI Scripting) dos robos de lancamento (NFS-e e CT-e).
// Os trechos de tela do SAP (ME21N/MIRO) vem de sapCorposLancamento.js, copiados literalmente
// das macros das planilhas originais. Aqui fica so o "esqueleto": conexao, laco por linha,
// log, gravacao do resultado e parada no primeiro erro (como a macro, que parava no erro).

import {
  CORPO_NFSE_MIRO,
  CORPO_NFSE_PEDIDO,
  CORPO_CTE_MIRO,
  CORPO_CTE_PEDIDO,
} from './sapCorposLancamento';

export const PASTA_NFSE = 'C:\\Temp\\LancamentoNFSe';
export const PASTA_CTE = 'C:\\Temp\\LancamentoCTe';

function ascii(valor) {
  return String(valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '?');
}

export function vbs(valor) {
  return `"${ascii(valor).replace(/"/g, '""')}"`;
}

// Cada linha do lote vira uma chamada curta (VBScript limita ~1000 caracteres por linha).
function linhasEmbutidas(linhas, campos) {
  const out = [`ReDim L(${Math.max(linhas.length - 1, 0)})`];
  linhas.forEach((l, i) => {
    out.push(`L(${i}) = Array(${campos.map((c) => vbs(l[c])).join(', ')})`);
  });
  return out;
}

// Marca cada comando do SAP com o passo atual (variavel "passo"), para o erro dizer onde parou.
function marcarPassos(corpo, etapa) {
  let n = 0;
  return corpo
    .split('\n')
    .map((linha) => {
      const m = linha.match(/^(\s+)(session\.findById\(.*)$/);
      if (!m) return linha;
      n += 1;
      const alvo = (linha.match(/\/([a-z]{3,4}[A-Za-z0-9_\-]*)(\[[0-9,]+\])?"\)/) || [])[1] || '';
      return `${m[1]}passo = ${vbs(`${etapa} #${n} ${alvo}`)} : ${m[2]}`;
    })
    .join('\n');
}

export const CONEXAO = [
  'Sub Conectar()',
  '    On Error Resume Next',
  '    Set sapGuiAuto = GetObject("SAPGUI")',
  '    If Err.Number <> 0 Then',
  '        MsgBox "SAP GUI nao encontrado. Abra o SAP Logon, entre no sistema e habilite o scripting.", vbCritical, "Robo de lancamento"',
  '        WScript.Quit 1',
  '    End If',
  '    On Error GoTo 0',
  '    Set appl = sapGuiAuto.GetScriptingEngine',
  '    Set con = appl.Children(0)',
  '    Set session = con.Children(0)',
  'End Sub',
];

function utilitarios({ pasta, arquivoResultado }) {
  return [
    'Sub Log(t)',
    '    logf.WriteLine Now & " - " & t',
    'End Sub',
    '',
    'Sub GravarResultado(id, tipo, valor)',
    `    Dim f : Set f = fso.OpenTextFile(${vbs(`${pasta}\\${arquivoResultado}`)}, 8, True)`,
    '    f.WriteLine id & ";" & tipo & ";" & valor',
    '    f.Close',
    'End Sub',
    '',
    'Function StatusSap()',
    '    On Error Resume Next',
    '    StatusSap = session.findById("wnd[0]/sbar").Text',
    '    If Err.Number <> 0 Then StatusSap = "(sem mensagem)" : Err.Clear',
    'End Function',
    '',
    "' O numero do documento tem 10 digitos; se nao for numerico, o SAP nao gravou.",
    'Function NumeroSap(txt, oQue)',
    '    If Len(txt) <> 10 Or Not IsNumeric(txt) Then',
    '        Err.Raise 5000, , oQue & " nao foi gerado. Mensagem do SAP: " & StatusSap()',
    '    End If',
    '    NumeroSap = txt',
    'End Function',
    '',
    'Sub PreencherEmpresaInicial()',
    '    On Error Resume Next',
    '    session.findById("wnd[1]/usr/ctxtBKPF-BUKRS").Text = "1420"',
    '    session.findById("wnd[1]").sendVKey 0',
    'End Sub',
    '',
    'Sub TentarConfirmarPopup()',
    '    On Error Resume Next',
    '    session.findById("wnd[1]/tbar[0]/btn[0]").press',
    'End Sub',
    '',
    'Sub Falhar(etapa, rotulo)',
    '    Dim msg : msg = "ERRO em " & etapa & " (" & rotulo & "): " & Err.Description & " [erro " & Err.Number & ", passo: " & passo & "] | SAP: " & StatusSap()',
    '    Log msg',
    '    logf.Close',
    '    MsgBox msg & vbCrLf & vbCrLf & "O que ja foi lancado esta salvo em " & pastaLog & ". Corrija no SAP e rode de novo: o robo pula o que ja tem numero.", vbCritical, "Robo de lancamento"',
    '    WScript.Quit 1',
    'End Sub',
  ];
}

export function cabecalho(titulo) {
  return [
    `' ${ascii(titulo)}`,
    "' Gerado pela Central de Fretes (modulo Automacao). Rode com o SAP Logon aberto e logado.",
    "' Requer SAP GUI Scripting habilitado. O robo para no primeiro erro e nao repete o que ja tem numero.",
    'Option Explicit',
    '',
  ];
}

// ---------------------------------------------------------------- NFS-e
// Campos de cada linha (ordem fixa, usada pelo script): ver CAMPOS_NFSE.
export const CAMPOS_NFSE = ['id', 'emp', 'nf', 'cnpj', 'dtEmissao', 'valor', 'codImp', 'cfop', 'dtVenc', 'centro', 'cc', 'pedido', 'miro'];

export function gerarScriptNfse({ linhas = [], pasta = PASTA_NFSE } = {}) {
  if (!linhas.length) throw new Error('Nao ha notas para lancar.');
  const semDados = linhas.filter((l) => !l.emp || !l.centro || !l.cc || !l.dtEmissao || !l.dtVenc || !l.valor);
  if (semDados.length) throw new Error(`${semDados.length} nota(s) sem empresa, centro, centro de custo, datas ou valor. Corrija antes de gerar o script.`);

  const I = Object.fromEntries(CAMPOS_NFSE.map((c, i) => [c, i]));
  const corpo = [
    ...cabecalho('Robo NFS-e - Criar pedido (ME21N) e MIRO'),
    'Dim fso, logf, sapGuiAuto, appl, con, session, L(), k, kk, n, pend, r, Pedidos, Miros',
    'Dim tentativas, CNPJ, OrgCompra, Centro, Valor, C_Custo, CodImposto, NrPedido',
    'Dim Empresa, DtaEmissao, DtaVencimento, Referencia, Ctg, CFOP, nrMiro, rotulo',
    `Dim passo, pastaLog : pastaLog = ${vbs(pasta)}`,
    '',
    ...utilitarios({ pasta, arquivoResultado: 'resultado_nfse.csv' }),
    '',
    ...CONEXAO,
    '',
    'Sub CriarPedidoLinha()',
    '    r = L(kk)',
    `    CNPJ = r(${I.cnpj})`,
    `    OrgCompra = r(${I.emp})`,
    `    Centro = r(${I.centro})`,
    `    Valor = r(${I.valor})`,
    `    C_Custo = r(${I.cc})`,
    `    CodImposto = r(${I.codImp})`,
    marcarPassos(CORPO_NFSE_PEDIDO, 'pedido'),
    `    NrPedido = NumeroSap(NrPedido, "Pedido")`,
    `    GravarResultado r(${I.id}), "pedido", NrPedido`,
    `    Pedidos(kk) = NrPedido`,
    '    WScript.Sleep 2000',
    'End Sub',
    '',
    'Sub CriarMiroLinha()',
    '    r = L(kk)',
    `    Empresa = r(${I.emp})`,
    `    DtaEmissao = r(${I.dtEmissao})`,
    `    DtaVencimento = r(${I.dtVenc})`,
    `    Referencia = r(${I.nf})`,
    `    Valor = r(${I.valor})`,
    '    NrPedido = Pedidos(kk)',
    '    Ctg = "YZ"',
    `    CFOP = r(${I.cfop})`,
    marcarPassos(CORPO_NFSE_MIRO, 'miro'),
    `    nrMiro = NumeroSap(nrMiro, "MIRO")`,
    `    GravarResultado r(${I.id}), "miro", nrMiro`,
    `    Miros(kk) = nrMiro`,
    'End Sub',
    '',
    ...linhasEmbutidas(linhas, CAMPOS_NFSE),
    'n = UBound(L) + 1',
    'Set Pedidos = CreateObject("Scripting.Dictionary") : Set Miros = CreateObject("Scripting.Dictionary")',
    `For k = 0 To n - 1 : Pedidos.Add k, L(k)(${I.pedido}) : Miros.Add k, L(k)(${I.miro})`,
    'Next',
    '',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    `If Not fso.FolderExists(${vbs(pasta)}) Then fso.CreateFolder ${vbs(pasta)}`,
    `Set logf = fso.OpenTextFile(${vbs(`${pasta}\\log_lancamento_nfse.txt`)}, 8, True)`,
    'Log "Inicio: " & n & " nota(s)."',
    'Conectar',
    '',
    "' Fase 1: pedidos (ME21N) das notas que ainda nao tem pedido",
    'pend = 0',
    `For k = 0 To n - 1 : If Pedidos(k) = "" Then pend = pend + 1`,
    'Next',
    'If pend > 0 Then',
    '    session.findById("wnd[0]").maximize',
    '    session.findById("wnd[0]/tbar[0]/okcd").Text = "/NME21N"',
    '    session.findById("wnd[0]").sendVKey 0',
    '    For k = 0 To n - 1',
    `        If Pedidos(k) = "" Then`,
    `            rotulo = L(k)(${I.nf})`,
    '            On Error Resume Next',
    '            kk = k : CriarPedidoLinha',
    '            If Err.Number <> 0 Then Falhar "pedido", rotulo',
    '            On Error GoTo 0',
    '            Log "Pedido criado: NF " & rotulo & " -> " & NrPedido',
    '        End If',
    '    Next',
    'End If',
    '',
    "' Fase 2: MIRO das notas que tem pedido e ainda nao tem MIRO",
    'For k = 0 To n - 1',
    `    If Pedidos(k) <> "" And Miros(k) = "" Then`,
    `        rotulo = L(k)(${I.nf})`,
    '        On Error Resume Next',
    '        kk = k : CriarMiroLinha',
    '        If Err.Number <> 0 Then Falhar "MIRO", rotulo',
    '        On Error GoTo 0',
    '        Log "MIRO criada: NF " & rotulo & " -> " & nrMiro',
    '    End If',
    'Next',
    '',
    'Log "Fim."',
    'logf.Close',
    'MsgBox "NFS-e lancadas com sucesso. Volte para a Central de Fretes e importe o arquivo resultado_nfse.csv.", vbInformation, "Robo NFS-e"',
  ];
  return corpo.join('\n').replace(/\r?\n/g, '\r\n') + '\r\n';
}

// ---------------------------------------------------------------- CT-e
export const CAMPOS_CTE = ['id', 'emp', 'cte', 'bruto', 'prot', 'cnpj', 'centro', 'liquido', 'aliquota', 'cc', 'codImp', 'dtEmissao', 'dtVenc', 'tpEmis', 'cNF', 'dv', 'centro1', 'pedido', 'miro'];

export function gerarScriptCte({ linhas = [], pasta = PASTA_CTE } = {}) {
  if (!linhas.length) throw new Error('Nao ha CT-e para lancar.');
  const semDados = linhas.filter((l) => !l.emp || !l.centro || !l.cc || !l.codImp || !l.dtEmissao || !l.dtVenc || !l.bruto || !l.liquido);
  if (semDados.length) throw new Error(`${semDados.length} CT-e sem empresa, centro, centro de custo, codigo de imposto, datas ou valores. Corrija antes de gerar o script.`);

  const I = Object.fromEntries(CAMPOS_CTE.map((c, i) => [c, i]));
  const corpo = [
    ...cabecalho('Robo CT-e - Criar pedido de servico (ME21N) e MIRO'),
    'Dim fso, logf, sapGuiAuto, appl, con, session, L(), k, kk, n, pend, r, Pedidos, Miros',
    'Dim tentativas, Valor, aliquota, NrPedido, nrMiro, rotulo, DtaEmissao, DtaVencimento',
    'Dim v_emp, v_cte, v_bruto, v_prot, v_cnpj, v_centro, v_cc, v_imp, v_pedido, v_tp, v_c8, v_dv, v_centro1',
    `Dim passo, pastaLog : pastaLog = ${vbs(pasta)}`,
    '',
    ...utilitarios({ pasta, arquivoResultado: 'resultado_cte.csv' }),
    '',
    ...CONEXAO,
    '',
    'Sub CarregarLinha()',
    '    r = L(kk)',
    `    v_emp = r(${I.emp}) : v_cte = r(${I.cte}) : v_bruto = r(${I.bruto}) : v_prot = r(${I.prot})`,
    `    v_cnpj = r(${I.cnpj}) : v_centro = r(${I.centro}) : v_cc = r(${I.cc}) : v_imp = r(${I.codImp})`,
    `    v_pedido = Pedidos(kk) : v_tp = r(${I.tpEmis}) : v_c8 = r(${I.cNF}) : v_dv = r(${I.dv}) : v_centro1 = r(${I.centro1})`,
    `    Valor = r(${I.liquido})`,
    `    DtaEmissao = r(${I.dtEmissao}) : DtaVencimento = r(${I.dtVenc})`,
    `    aliquota = Val(r(${I.aliquota}))`,
    'End Sub',
    '',
    'Sub CriarPedidoLinha()',
    '    CarregarLinha',
    marcarPassos(CORPO_CTE_PEDIDO, 'pedido'),
    '    NrPedido = Right(session.findById("wnd[0]/sbar").Text, 10)',
    `    NrPedido = NumeroSap(NrPedido, "Pedido")`,
    `    GravarResultado r(${I.id}), "pedido", NrPedido`,
    `    Pedidos(kk) = NrPedido`,
    'End Sub',
    '',
    'Sub CriarMiroLinha()',
    '    CarregarLinha',
    marcarPassos(CORPO_CTE_MIRO, 'miro'),
    '    nrMiro = Mid(session.findById("wnd[0]/sbar").Text, 14, 10)',
    `    nrMiro = NumeroSap(nrMiro, "MIRO")`,
    `    GravarResultado r(${I.id}), "miro", nrMiro`,
    `    Miros(kk) = nrMiro`,
    'End Sub',
    '',
    ...linhasEmbutidas(linhas, CAMPOS_CTE),
    'n = UBound(L) + 1',
    'Set Pedidos = CreateObject("Scripting.Dictionary") : Set Miros = CreateObject("Scripting.Dictionary")',
    `For k = 0 To n - 1 : Pedidos.Add k, L(k)(${I.pedido}) : Miros.Add k, L(k)(${I.miro})`,
    'Next',
    '',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    `If Not fso.FolderExists(${vbs(pasta)}) Then fso.CreateFolder ${vbs(pasta)}`,
    `Set logf = fso.OpenTextFile(${vbs(`${pasta}\\log_lancamento_cte.txt`)}, 8, True)`,
    'Log "Inicio: " & n & " CT-e."',
    'Conectar',
    '',
    "' Fase 1: pedidos (ME21N) dos CT-e que ainda nao tem pedido",
    'pend = 0',
    `For k = 0 To n - 1 : If Pedidos(k) = "" Then pend = pend + 1`,
    'Next',
    'If pend > 0 Then',
    '    session.findById("wnd[0]").maximize',
    '    session.findById("wnd[0]/tbar[0]/okcd").Text = "/NME21N"',
    '    session.findById("wnd[0]").sendVKey 0',
    '    For k = 0 To n - 1',
    `        If Pedidos(k) = "" Then`,
    `            rotulo = L(k)(${I.cte})`,
    '            WScript.Sleep 1000',
    '            On Error Resume Next',
    '            kk = k : CriarPedidoLinha',
    '            If Err.Number <> 0 Then Falhar "pedido", rotulo',
    '            On Error GoTo 0',
    '            Log "Pedido criado: CT-e " & rotulo & " -> " & NrPedido',
    '        End If',
    '    Next',
    'End If',
    '',
    "' Fase 2: MIRO dos CT-e que tem pedido e ainda nao tem MIRO",
    'For k = 0 To n - 1',
    `    If Pedidos(k) <> "" And Miros(k) = "" Then`,
    `        rotulo = L(k)(${I.cte})`,
    '        On Error Resume Next',
    '        kk = k : CriarMiroLinha',
    '        If Err.Number <> 0 Then Falhar "MIRO", rotulo',
    '        On Error GoTo 0',
    '        Log "MIRO criada: CT-e " & rotulo & " -> " & nrMiro',
    '    End If',
    'Next',
    '',
    'Log "Fim."',
    'logf.Close',
    'MsgBox "CT-e lancados com sucesso. Volte para a Central de Fretes e importe o arquivo resultado_cte.csv.", vbInformation, "Robo CT-e"',
  ];
  return corpo.join('\n').replace(/\r?\n/g, '\r\n') + '\r\n';
}
