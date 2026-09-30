// Robo "Reprocessar CT-e" — substitui a planilha "Reprocessar Cte.xlsm".
//
// A planilha fazia 3 coisas:
//   1. (macro RelatorioChaves) abrir a transacao ZMMCTE_PED_LOG no SAP, filtrar o erro de
//      saldo e exportar o relatorio para C:\Temp\ReprocessarCte;
//   2. (Power Query "SAP GUI") ler o arquivo exportado, tirar as linhas da transportadora
//      EBAZAR e ficar so com a coluna "Chave CTe";
//   3. (macro Reprocessar) colar as chaves no SAP em lotes de 200 e mandar reprocessar.
//
// O navegador nao consegue controlar o SAP GUI, entao os passos 1 e 3 viram scripts .vbs
// gerados aqui (rodam no PC do usuario, com o SAP aberto). O passo 2 roda na propria tela.

export const TRANSACAO_SAP = 'ZMMCTE_PED_LOG';
export const PASTA_EXPORTACAO = 'C:\\Temp\\ReprocessarCte';
export const NOME_ARQUIVO_EXPORTACAO = 'CT-esErro';
export const LOTE_PADRAO = 200;
export const TRANSPORTADORAS_IGNORADAS_PADRAO = ['EBAZAR'];

function semAcento(texto = '') {
  return String(texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizarCabecalho(texto = '') {
  return semAcento(texto).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Chave de acesso do CT-e = 44 digitos. O SAP/Excel pode entregar com espacos ou em notacao
// cientifica; aqui so aceitamos o que realmente e uma chave.
export function normalizarChaveCte(valor) {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  return digitos.length === 44 ? digitos : '';
}

// Extrai chaves de um texto colado (uma por linha, ou separadas por espaco/;/,).
export function extrairChavesDeTexto(texto = '') {
  const partes = String(texto ?? '').split(/[\s;,|]+/).filter(Boolean);
  const chaves = [];
  const invalidas = [];
  partes.forEach((parte) => {
    const chave = normalizarChaveCte(parte);
    if (chave) chaves.push(chave);
    else invalidas.push(parte);
  });
  return { chaves, invalidas };
}

// Recebe as linhas do arquivo exportado do SAP (matriz, 1a linha = cabecalho) e devolve as
// chaves a reprocessar, na mesma ordem do relatorio. Equivale ao Power Query "SAP GUI".
export function chavesDoRelatorioSap(matriz = [], { ignorarTransportadoras = TRANSPORTADORAS_IGNORADAS_PADRAO } = {}) {
  const linhas = (matriz || []).filter((linha) => Array.isArray(linha) && linha.some((c) => String(c ?? '').trim() !== ''));
  // O relatorio do SAP pode trazer linhas de titulo antes do cabecalho: acha a que tem "Chave CTe".
  const idxCab = linhas.findIndex((linha) => linha.some((c) => normalizarCabecalho(c) === 'chave cte'));
  if (idxCab < 0) throw new Error('Nao encontrei a coluna "Chave CTe" no arquivo. Confira se e o relatorio exportado da transacao ZMMCTE_PED_LOG.');

  const cab = linhas[idxCab].map(normalizarCabecalho);
  const colChave = cab.indexOf('chave cte');
  const colTransp = cab.indexOf('transportadora');
  const ignorar = (ignorarTransportadoras || []).map((t) => semAcento(t).toUpperCase().trim()).filter(Boolean);

  const stats = { linhasLidas: 0, ignoradasTransportadora: 0, semChaveValida: 0, chavesBrutas: 0 };
  const chaves = [];
  linhas.slice(idxCab + 1).forEach((linha) => {
    stats.linhasLidas += 1;
    if (colTransp >= 0 && ignorar.length) {
      const transp = semAcento(linha[colTransp]).toUpperCase();
      if (ignorar.some((t) => transp.includes(t))) { stats.ignoradasTransportadora += 1; return; }
    }
    const chave = normalizarChaveCte(linha[colChave]);
    if (!chave) { stats.semChaveValida += 1; return; }
    chaves.push(chave);
    stats.chavesBrutas += 1;
  });
  return { chaves, stats, temColunaTransportadora: colTransp >= 0 };
}

// Le o arquivo exportado (xlsx/xls como o Power Query, ou txt/csv separado por "|").
export async function lerArquivoRelatorioSap(arquivo) {
  const XLSX = await import('xlsx');
  const nome = String(arquivo?.name || '').toLowerCase();
  const buffer = await arquivo.arrayBuffer();
  let wb;
  if (/\.(txt|csv)$/i.test(nome)) {
    // Encoding 1252 como no Power Query; delimitador "|" do relatorio em texto do SAP.
    const texto = new TextDecoder('windows-1252').decode(buffer);
    const primeira = texto.split(/\r?\n/).find((l) => l.includes('Chave CTe')) || '';
    const delim = primeira.includes('|') ? '|' : primeira.includes('\t') ? '\t' : primeira.includes(';') ? ';' : ',';
    const matriz = texto.split(/\r?\n/).map((l) => l.split(delim).map((c) => c.trim()));
    return matriz;
  }
  wb = XLSX.read(buffer, { type: 'array', raw: true });
  // O Power Query lia a aba "Data"; se nao existir, usa a primeira.
  const aba = wb.SheetNames.includes('Data') ? 'Data' : wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: true, defval: '', blankrows: false });
}

export function removerDuplicadas(chaves = []) {
  return [...new Set(chaves)];
}

export function dividirEmLotes(chaves = [], tamanho = LOTE_PADRAO) {
  const n = Math.max(1, Math.floor(Number(tamanho)) || LOTE_PADRAO);
  const lotes = [];
  for (let i = 0; i < chaves.length; i += n) lotes.push(chaves.slice(i, i + n));
  return lotes;
}

// ---- datas (SAP usa dd.mm.aaaa) ----

export function isoParaSap(iso = '') {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

export function dataSapValida(texto = '') {
  const m = String(texto || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return false;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return d.getFullYear() === Number(m[3]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[1]);
}

// ---- geracao dos scripts VBScript (SAP GUI Scripting) ----

function vbsStr(valor) {
  return `"${String(valor ?? '').replace(/"/g, '""')}"`;
}

const CABECALHO_VBS = (titulo) => [
  `' ${titulo}`,
  `' Gerado pela Central de Fretes (modulo Automacao). Rode com o SAP Logon aberto e logado.`,
  `' Requer SAP GUI Scripting habilitado (ja e o mesmo requisito da planilha antiga).`,
  'Option Explicit',
  '',
];

const CONEXAO_SAP_VBS = [
  'Dim SapGuiAuto, Appl, Connection, session',
  'On Error Resume Next',
  'Set SapGuiAuto = GetObject("SAPGUI")',
  'If Err.Number <> 0 Then',
  '    MsgBox "SAP GUI nao encontrado. Abra o SAP Logon, entre no sistema e habilite o scripting.", vbCritical, "Robo CT-e"',
  '    WScript.Quit 1',
  'End If',
  'On Error GoTo 0',
  'Set Appl = SapGuiAuto.GetScriptingEngine',
  'Set Connection = Appl.Children(0)',
  'Set session = Connection.Children(0)',
  '',
];

function abrirTransacaoVbs() {
  return [
    'session.findById("wnd[0]").maximize',
    `session.findById("wnd[0]/tbar[0]/okcd").Text = "/N${TRANSACAO_SAP}"`,
    'session.findById("wnd[0]").sendVKey 0',
  ];
}

// Script 1 — equivale ao botao "1. Executar" (macro RelatorioChaves) ate a exportacao.
export function gerarScriptExportacaoVbs({ dataInicial, dataFinal = '', pasta = PASTA_EXPORTACAO, nomeArquivo = NOME_ARQUIVO_EXPORTACAO } = {}) {
  if (!dataSapValida(dataInicial)) throw new Error('Informe a data inicial.');
  if (dataFinal && !dataSapValida(dataFinal)) throw new Error('Data final invalida.');
  const linhas = [
    ...CABECALHO_VBS('Robo CT-e - 1. Exportar relatorio de erros (ZMMCTE_PED_LOG)'),
    ...CONEXAO_SAP_VBS,
    'Dim fso, arq',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    // ApagarArquivos: limpa a pasta de exportacao (Kill C:\Temp\ReprocessarCte\*.*)
    `If Not fso.FolderExists(${vbsStr(pasta)}) Then`,
    `    ' cria a pasta (e as pais) se ainda nao existir`,
    '    Dim partes, acum, i',
    `    partes = Split(${vbsStr(pasta)}, "\\")`,
    '    acum = partes(0)',
    '    For i = 1 To UBound(partes)',
    '        acum = acum & "\\" & partes(i)',
    '        If Not fso.FolderExists(acum) Then fso.CreateFolder acum',
    '    Next',
    'End If',
    'On Error Resume Next',
    `For Each arq In fso.GetFolder(${vbsStr(pasta)}).Files`,
    '    arq.Delete True',
    'Next',
    'On Error GoTo 0',
    '',
    ...abrirTransacaoVbs(),
    `session.findById("wnd[0]/usr/ctxtS_DATA-LOW").Text = ${vbsStr(dataInicial)}`,
    'session.findById("wnd[0]/usr/chkP_ERRO").Selected = False',
    'session.findById("wnd[0]/usr/chkP_TODE").Selected = True',
    ...(dataFinal
      ? [`session.findById("wnd[0]/usr/ctxtS_DATA-HIGH").Text = ${vbsStr(dataFinal)}`]
      : [
        // Sem data final: "opcoes de selecao" (F2) escolhendo a 1a opcao, como na macro.
        'session.findById("wnd[0]/usr/ctxtS_DATA-HIGH").Text = ""',
        'session.findById("wnd[0]").sendVKey 2',
        'session.findById("wnd[1]/usr/cntlOPTION_CONTAINER/shellcont/shell").currentCellRow = 1',
        'session.findById("wnd[1]/usr/cntlOPTION_CONTAINER/shellcont/shell").selectedRows = "1"',
        'session.findById("wnd[1]/usr/cntlOPTION_CONTAINER/shellcont/shell").doubleClickCurrentCell',
      ]),
    '',
    "' Executa o relatorio",
    'session.findById("wnd[0]/tbar[1]/btn[8]").press',
    '',
    "' Filtra o erro de saldo",
    'session.findById("wnd[0]").sendVKey 29',
    'session.findById("wnd[1]/usr/subSUB_CONFIGURATION:SAPLSALV_CUL_FILTER_CRITERIA:0600/cntlCONTAINER1_FILT/shellcont/shell").currentCellRow = 20',
    'session.findById("wnd[1]/usr/subSUB_CONFIGURATION:SAPLSALV_CUL_FILTER_CRITERIA:0600/cntlCONTAINER1_FILT/shellcont/shell").firstVisibleRow = 16',
    'session.findById("wnd[1]/usr/subSUB_CONFIGURATION:SAPLSALV_CUL_FILTER_CRITERIA:0600/cntlCONTAINER1_FILT/shellcont/shell").selectedRows = "20"',
    'session.findById("wnd[1]/usr/subSUB_CONFIGURATION:SAPLSALV_CUL_FILTER_CRITERIA:0600/cntlCONTAINER1_FILT/shellcont/shell").doubleClickCurrentCell',
    'session.findById("wnd[1]/usr/subSUB_CONFIGURATION:SAPLSALV_CUL_FILTER_CRITERIA:0600/btn600_BUTTON").press',
    'session.findById("wnd[2]/usr/ssub%_SUBSCREEN_FREESEL:SAPLSSEL:1105/ctxt%%DYN001-LOW").Text = "*"',
    'session.findById("wnd[2]/usr/ssub%_SUBSCREEN_FREESEL:SAPLSSEL:1105/ctxt%%DYN001-LOW").caretPosition = 6',
    'session.findById("wnd[2]").sendVKey 0',
    '',
    "' Exporta o relatorio",
    'session.findById("wnd[0]/tbar[1]/btn[43]").press',
    `session.findById("wnd[1]/usr/ssubSUB_CONFIGURATION:SAPLSALV_GUI_CUL_EXPORT_AS:0512/txtGS_EXPORT-FILE_NAME").Text = ${vbsStr(nomeArquivo)}`,
    'session.findById("wnd[1]/usr/ssubSUB_CONFIGURATION:SAPLSALV_GUI_CUL_EXPORT_AS:0512/cmbGS_EXPORT-FORMAT").SetFocus',
    'session.findById("wnd[1]/tbar[0]/btn[20]").press',
    `session.findById("wnd[1]/usr/ctxtDY_PATH").Text = ${vbsStr(pasta)}`,
    'session.findById("wnd[1]/usr/ctxtDY_PATH").SetFocus',
    'session.findById("wnd[1]/usr/ctxtDY_PATH").caretPosition = 66',
    'session.findById("wnd[1]/tbar[0]/btn[0]").press',
    '',
    "' Aguarda o arquivo ser gravado",
    'WScript.Sleep 5000',
    `MsgBox "Relatorio exportado para ${pasta.replace(/"/g, '')}." & vbCrLf & "Volte para a Central de Fretes e carregue o arquivo.", vbInformation, "Robo CT-e"`,
  ];
  return linhas.join('\r\n') + '\r\n';
}

// Script 2 — equivale a macro Reprocessar: cola as chaves em lotes e reprocessa.
export function gerarScriptReprocessarVbs({ chaves = [], dataInicial, dataFinal = '', lote = LOTE_PADRAO, pasta = PASTA_EXPORTACAO } = {}) {
  if (!chaves.length) throw new Error('Nao ha chaves para reprocessar.');
  if (!dataSapValida(dataInicial)) throw new Error('Informe a data inicial.');
  if (dataFinal && !dataSapValida(dataFinal)) throw new Error('Data final invalida.');
  const lotes = dividirEmLotes(chaves, lote);

  // VBScript limita cada linha a ~1000 caracteres: cada lote vira varias linhas curtas.
  const dadosLotes = [];
  lotes.forEach((chavesLote, idx) => {
    dadosLotes.push(`ReDim Preserve lotes(${idx})`);
    dadosLotes.push('t = ""');
    for (let i = 0; i < chavesLote.length; i += 15) {
      dadosLotes.push(`t = t & ${vbsStr(chavesLote.slice(i, i + 15).join('|'))} & "|"`);
    }
    dadosLotes.push(`lotes(${idx}) = Left(t, Len(t) - 1)`);
  });

  const linhas = [
    ...CABECALHO_VBS(`Robo CT-e - 2. Reprocessar ${chaves.length} chave(s) em ${lotes.length} lote(s) de ate ${lote}`),
    ...CONEXAO_SAP_VBS,
    'Dim sh, fso, log, lotes(), t, i, k, partes, ok, falhas',
    'Set sh = CreateObject("WScript.Shell")',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    `Dim logPath : logPath = ${vbsStr(`${pasta}\\log_reprocessar.txt`)}`,
    `If Not fso.FolderExists(${vbsStr(pasta)}) Then fso.CreateFolder ${vbsStr(pasta)}`,
    'Set log = fso.OpenTextFile(logPath, 2, True)',
    `log.WriteLine Now & " - inicio: ${chaves.length} chaves, ${lotes.length} lotes"`,
    '',
    ...dadosLotes,
    '',
    'ok = 0 : falhas = 0',
    ...abrirTransacaoVbs(),
    `session.findById("wnd[0]/usr/ctxtS_DATA-LOW").Text = ${vbsStr(dataInicial)}`,
    `session.findById("wnd[0]/usr/ctxtS_DATA-HIGH").Text = ${vbsStr(dataFinal)}`,
    '',
    `For i = 0 To ${lotes.length - 1}`,
    '    On Error Resume Next',
    '    partes = Split(lotes(i), "|")',
    "    ' copia o lote para a area de transferencia (uma chave por linha)",
    '    Dim texto : texto = Join(partes, vbCrLf)',
    '    Dim exec : Set exec = sh.Exec("cmd /c clip")',
    '    exec.StdIn.Write texto',
    '    exec.StdIn.Close',
    '    Do While exec.Status = 0 : WScript.Sleep 50 : Loop',
    '',
    "    ' abre selecao multipla, limpa a anterior, cola e confirma",
    '    session.findById("wnd[0]/usr/btn%_S_CHAVE_%_APP_%-VALU_PUSH").press',
    '    session.findById("wnd[1]/tbar[0]/btn[16]").press',
    '    session.findById("wnd[1]/tbar[0]/btn[24]").press',
    '    session.findById("wnd[1]/tbar[0]/btn[8]").press',
    '',
    "    ' marca opcoes e executa",
    '    session.findById("wnd[0]/usr/chkP_ERRO").Selected = False',
    '    session.findById("wnd[0]/usr/chkP_TODE").Selected = True',
    '    session.findById("wnd[0]/tbar[1]/btn[8]").press',
    '',
    "    ' reprocessa tudo o que apareceu na grade",
    '    session.findById("wnd[0]/usr/cntlGRID1/shellcont/shell/shellcont[1]/shell").setCurrentCell -1, ""',
    '    session.findById("wnd[0]/usr/cntlGRID1/shellcont/shell/shellcont[1]/shell").SelectAll',
    '    session.findById("wnd[0]/tbar[1]/btn[13]").press',
    '',
    "    ' volta para a tela de selecao",
    '    session.findById("wnd[0]/tbar[0]/btn[3]").press',
    '',
    '    If Err.Number <> 0 Then',
    '        falhas = falhas + 1',
    '        log.WriteLine Now & " - lote " & (i + 1) & " FALHOU: " & Err.Description',
    '        Err.Clear',
    '    Else',
    '        ok = ok + 1',
    '        log.WriteLine Now & " - lote " & (i + 1) & " de ' + lotes.length + ' reprocessado (" & (UBound(partes) + 1) & " chaves)"',
    '    End If',
    '    On Error GoTo 0',
    'Next',
    '',
    'log.WriteLine Now & " - fim: " & ok & " lote(s) ok, " & falhas & " com falha"',
    'log.Close',
    'MsgBox "Correcoes concluidas: " & ok & " lote(s) ok, " & falhas & " com falha." & vbCrLf & "Log: " & logPath, vbInformation, "Robo CT-e"',
  ];
  return linhas.join('\r\n') + '\r\n';
}

export function baixarTexto(nomeArquivo, conteudo, mime = 'application/octet-stream') {
  // octet-stream (e nao text/plain): senao Edge/Chrome anexam ".txt" ao nome e o .vbs nao executa.
  // BOM ausente de proposito: o VBScript le ANSI e o conteudo gerado e ASCII.
  const blob = new Blob([conteudo], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
