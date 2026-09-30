// GERADO a partir do VBA das planilhas "Lancamento NFS-e" e "Lancamento CT-e" (trechos de SAP GUI Scripting).
// Nao editar a mao: os IDs de tela do SAP foram copiados literalmente das macros originais.

export const CORPO_NFSE_PEDIDO = String.raw`    'Informa o CNPJ
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:" & Mid(session.ActiveWindow.SystemFocus.Id, 49, 4) & "/subSUB0:SAPLMEGUI:0030/subSUB1:SAPLMEGUI:1105/ctxtMEPO_TOPLINE-SUPERFIELD").Text = CNPJ
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:" & Mid(session.ActiveWindow.SystemFocus.Id, 49, 4) & "/subSUB0:SAPLMEGUI:0030/subSUB1:SAPLMEGUI:1105/ctxtMEPO_TOPLINE-SUPERFIELD").SetFocus
    session.findById("wnd[0]").sendVKey 0
    'Preenche a organizao de compras.
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:" & Mid(session.ActiveWindow.SystemFocus.Id, 49, 4) & "/subSUB1:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1102/tabsHEADER_DETAIL/tabpTABHDT8/ssubTABSTRIPCONTROL2SUB:SAPLMEGUI:1221/ctxtMEPO1222-EKORG").Text = OrgCompra
    session.findById("wnd[0]").sendVKey 0
    'Preenche o grupo de compras.
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:0013/subSUB1:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1102/tabsHEADER_DETAIL/tabpTABHDT8/ssubTABSTRIPCONTROL2SUB:SAPLMEGUI:1221/ctxtMEPO1222-EKGRP").Text = "FRT"
    session.findById("wnd[0]").sendVKey 0
    'Preenche a condio de pagamento do pedido.
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:0013/subSUB1:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1102/tabsHEADER_DETAIL/tabpTABHDT1/ssubTABSTRIPCONTROL2SUB:SAPLMEGUI:1226/ctxtMEPO1226-ZTERM").Text = "0001"
    session.findById("wnd[0]").sendVKey 0
    'Preenche os dados do item do pedido.
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:0013/subSUB2:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1211/tblSAPLMEGUITC_1211/ctxtMEPO1211-KNTTP[2,0]").Text = "K"
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:0013/subSUB2:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1211/tblSAPLMEGUITC_1211/ctxtMEPO1211-KNTTP[2,0]").SetFocus
    session.findById("wnd[0]").sendVKey 0
    'Informa o material padro utilizado para frete.
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:" & Mid(session.ActiveWindow.SystemFocus.Id, 49, 4) & "/subSUB2:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1211/tblSAPLMEGUITC_1211/ctxtMEPO1211-EMATN[4,0]").Text = "98020419"
    session.findById("wnd[0]").sendVKey 0
    'Informa o centro responsvel pelo pedido.
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:" & Mid(session.ActiveWindow.SystemFocus.Id, 49, 4) & "/subSUB2:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1211/tblSAPLMEGUITC_1211/ctxtMEPO1211-NAME1[15,0]").Text = Centro
    session.findById("wnd[0]").sendVKey 0
    'Informa o centro de custo.
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:" & Mid(session.ActiveWindow.SystemFocus.Id, 49, 4) & "/subSUB3:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1301/subSUB2:SAPLMEGUI:1303/tabsITEM_DETAIL/tabpTABIDT15").Select
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:" & Mid(session.ActiveWindow.SystemFocus.Id, 49, 4) & "/subSUB3:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1301/subSUB2:SAPLMEGUI:1303/tabsITEM_DETAIL/tabpTABIDT15/ssubTABSTRIPCONTROL1SUB:SAPLMEVIEWS:1101/subSUB2:SAPLMEACCTVI:0100/subSUB1:SAPLMEACCTVI:1100/subKONTBLOCK:SAPLKACB:1101/ctxtCOBL-KOSTL").Text = C_Custo
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:" & Mid(session.ActiveWindow.SystemFocus.Id, 49, 4) & "/subSUB3:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1301/subSUB2:SAPLMEGUI:1303/tabsITEM_DETAIL/tabpTABIDT15/ssubTABSTRIPCONTROL1SUB:SAPLMEVIEWS:1101/subSUB2:SAPLMEACCTVI:0100/subSUB1:SAPLMEACCTVI:1100/subKONTBLOCK:SAPLKACB:1101/ctxtCOBL-KOSTL").SetFocus
    session.findById("wnd[0]").sendVKey 0
    'Desmarca a opo de Entrada de Mercadoria (EM).
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:" & Mid(session.ActiveWindow.SystemFocus.Id, 49, 4) & "/subSUB3:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1301/subSUB2:SAPLMEGUI:1303/tabsITEM_DETAIL/tabpTABIDT7").Select
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:" & Mid(session.ActiveWindow.SystemFocus.Id, 49, 4) & "/subSUB3:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1301/subSUB2:SAPLMEGUI:1303/tabsITEM_DETAIL/tabpTABIDT7/ssubTABSTRIPCONTROL1SUB:SAPLMEGUI:1313/chkMEPO1313-WEPOS").Selected = False
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:" & Mid(session.ActiveWindow.SystemFocus.Id, 49, 4) & "/subSUB3:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1301/subSUB2:SAPLMEGUI:1303/tabsITEM_DETAIL/tabpTABIDT7/ssubTABSTRIPCONTROL1SUB:SAPLMEGUI:1313/chkMEPO1313-WEPOS").SetFocus
    'Quantidade dp material
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:" & Mid(session.ActiveWindow.SystemFocus.Id, 49, 4) & "/subSUB3:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1301/subSUB2:SAPLMEGUI:1303/tabsITEM_DETAIL/tabpTABIDT8").Select
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:" & Mid(session.ActiveWindow.SystemFocus.Id, 49, 4) & "/subSUB2:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1211/tblSAPLMEGUITC_1211/txtMEPO1211-MENGE[6,0]").Text = "1"
    session.findById("wnd[0]").sendVKey 0
    'Preenche o valor do item.
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:" & Mid(session.ActiveWindow.SystemFocus.Id, 49, 4) & "/subSUB2:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1211/tblSAPLMEGUITC_1211/txtMEPO1211-NETPR[10,0]").Text = Valor
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:" & Mid(session.ActiveWindow.SystemFocus.Id, 49, 4) & "/subSUB2:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1211/tblSAPLMEGUITC_1211/txtMEPO1211-NETPR[10,0]").SetFocus
    session.findById("wnd[0]").sendVKey 0
    'Acessa aba fatura
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:" & Mid(session.ActiveWindow.SystemFocus.Id, 49, 4) & "/subSUB3:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1301/subSUB2:SAPLMEGUI:1303/tabsITEM_DETAIL/tabpTABIDT8").Select
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:" & Mid(session.ActiveWindow.SystemFocus.Id, 49, 4) & "/subSUB3:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1301/subSUB2:SAPLMEGUI:1303/tabsITEM_DETAIL/tabpTABIDT8/ssubTABSTRIPCONTROL1SUB:SAPLMEGUI:1317/ctxtMEPO1317-MWSKZ").SetFocus
    'Preenche o cdigo de imposto na aba de faturamento.
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:" & Mid(session.ActiveWindow.SystemFocus.Id, 49, 4) & "/subSUB3:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1301/subSUB2:SAPLMEGUI:1303/tabsITEM_DETAIL/tabpTABIDT8/ssubTABSTRIPCONTROL1SUB:SAPLMEGUI:1317/ctxtMEPO1317-MWSKZ").Text = CodImposto
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:" & Mid(session.ActiveWindow.SystemFocus.Id, 49, 4) & "/subSUB3:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1301/subSUB2:SAPLMEGUI:1303/tabsITEM_DETAIL/tabpTABIDT8/ssubTABSTRIPCONTROL1SUB:SAPLMEGUI:1317/ctxtMEPO1317-MWSKZ").SetFocus
    session.findById("wnd[0]").sendVKey 0
    'Salva o pedido, captura o nmero gerado pelo SAP e grava o resultado na planilha.
    session.findById("wnd[0]/tbar[0]/btn[11]").press
    session.findById("wnd[1]/usr/btnSPOP-VAROPTION1").press
    NrPedido = Right(session.findById("wnd[0]/sbar").Text, 10)`;

export const CORPO_NFSE_MIRO = String.raw`    session.findById("wnd[0]").maximize
    session.findById("wnd[0]/tbar[0]/okcd").Text = "/NMIRO"
    session.findById("wnd[0]").sendVKey 0
    ' AGUARDA A TELA DE SELEO DA EMPRESA APARECER
    'Realiza at 6 tentativas para localizar a janela de seleo da empresa
    For tentativas = 1 To 6
    If session.Children.Count > 1 Then
    PreencherEmpresaInicial
    Exit For
    End If
    session.findById("wnd[0]").sendVKey 0
    Next
    ' SELECIONA A EMPRESA CORRETA PARA O LANAMENTO
    session.findById("wnd[0]").sendVKey 7
    session.findById("wnd[1]/usr/ctxtBKPF-BUKRS").Text = Empresa 'Empresa
    session.findById("wnd[1]").sendVKey 0
    WScript.Sleep 1000
    ' DADOS DO CABEALHO DA NOTA
    'Data de emisso da NF
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/tabsHEADER/tabpHEADER_TOTAL/ssubHEADER_SCREEN:SAPLFDCB:0010/ctxtINVFO-BLDAT").Text = DtaEmissao 'Data da Emisso
    session.findById("wnd[0]").sendVKey 0
    'Segundo enter para validao da data pelo SAP
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/tabsHEADER/tabpHEADER_TOTAL/ssubHEADER_SCREEN:SAPLFDCB:0010/ctxtINVFO-BLDAT").Text = DtaEmissao 'Data da Emisso
    session.findById("wnd[0]").sendVKey 0
    'Preenche a referncia da nota fiscal
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/tabsHEADER/tabpHEADER_TOTAL/ssubHEADER_SCREEN:SAPLFDCB:0010/txtINVFO-XBLNR").Text = Referencia 'Nr NF
    'Preenche o valor total da nota fiscal
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/tabsHEADER/tabpHEADER_TOTAL/ssubHEADER_SCREEN:SAPLFDCB:0010/txtINVFO-WRBTR").Text = Valor ' Valor
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/tabsHEADER/tabpHEADER_TOTAL/ssubHEADER_SCREEN:SAPLFDCB:0010/txtINVFO-WRBTR").SetFocus
    session.findById("wnd[0]").sendVKey 0
    'Preenche o pedido de compra vinculado  nota
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/subITEMS:SAPLMR1M:6010/tabsITEMTAB/tabpITEMS_PO/ssubTABS:SAPLMR1M:6020/subREFERENZBELEG:SAPLMR1M:6211/ctxtRM08M-EBELN").Text = NrPedido 'Pedido
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/subITEMS:SAPLMR1M:6010/tabsITEMTAB/tabpITEMS_PO/ssubTABS:SAPLMR1M:6020/subREFERENZBELEG:SAPLMR1M:6211/ctxtRM08M-EBELN").SetFocus
    session.findById("wnd[0]").sendVKey 0
    ' ABA PAGAMENTO
    'Acessa a aba de pagamento da MIRO
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/tabsHEADER/tabpHEADER_PAY").Select
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/tabsHEADER/tabpHEADER_PAY").Select
    'Preenche a data base para clculo do vencimento
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/tabsHEADER/tabpHEADER_PAY/ssubHEADER_SCREEN:SAPLFDCB:0020/ctxtINVFO-ZFBDT").Text = DtaVencimento 'Data vencimento
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/tabsHEADER/tabpHEADER_PAY/ssubHEADER_SCREEN:SAPLFDCB:0020/ctxtINVFO-ZFBDT").SetFocus
    session.findById("wnd[0]").sendVKey 0
    ' ABA FINANCEIRA
    'Acessa a aba financeira da nota fiscal
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/tabsHEADER/tabpHEADER_FI").Select
    'Informa a categoria da nota fiscal brasileira
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/tabsHEADER/tabpHEADER_FI/ssubHEADER_SCREEN:SAPLFDCB:0150/ctxtINVFO-J_1BNFTYPE").Text = Ctg 'ctg Nota
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/tabsHEADER/tabpHEADER_FI/ssubHEADER_SCREEN:SAPLFDCB:0150/ctxtINVFO-J_1BNFTYPE").SetFocus
    session.findById("wnd[0]").sendVKey 0
    ' ACESSA A TELA DE IMPOSTOS
    'Abre a tela de informaes fiscais da nota
    session.findById("wnd[0]/tbar[1]/btn[21]").press
    'Posiciona o cursor no item da nota fiscal
    session.findById("wnd[0]/usr/tabsTABSTRIP1/tabpTAB1/ssubHEADER_TAB:SAPLJ1BB2:2100/tblSAPLJ1BB2ITEM_CONTROL/ctxtJ_1BDYLIN-MATNR[4,0]").SetFocus
    session.findById("wnd[0]").sendVKey 2
    ' PREENCHIMENTO DO CFOP
    'Informa o cdigo fiscal da operao
    session.findById("wnd[0]/usr/tabsTABSTRIP1/tabpTAB1/ssubHEADER_TAB:SAPLJ1BB2:2100/tblSAPLJ1BB2ITEM_CONTROL/ctxtJ_1BDYLIN-CFOP[27,0]").Text = CFOP 'CFOP
    'Posiciona o cursor e confirma o preenchimento
    session.findById("wnd[0]").sendVKey 0
    ' RETORNO  TELA PRINCIPAL DA MIRO
    'Retorna da tela fiscal para a tela principal da MIRO
    session.findById("wnd[0]/tbar[0]/btn[3]").press
    session.findById("wnd[0]/tbar[0]/btn[3]").press
    'Executa a verificao da nota fiscal
    session.findById("wnd[0]/tbar[1]/btn[43]").press
    'Fecha a janela de mensagens apresentada pelo SAP
    session.findById("wnd[1]").Close
    ' GRAVAO DA MIRO
    'Salva o lanamento da nota fiscal
    session.findById("wnd[0]/tbar[0]/btn[11]").press
    'session.findById("wnd[0]/sbar").DoubleClick
    'Captura o nmero da MIRO gerada pelo SAP
    nrMiro = Mid(session.findById("wnd[0]/sbar").Text, 14, 10)`;

export const CORPO_CTE_PEDIDO = String.raw`    session.findById("wnd[0]").sendVKey 2
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:" & Mid(session.ActiveWindow.SystemFocus.Id, 49, 4) & "/subSUB0:SAPLMEGUI:0030/subSUB1:SAPLMEGUI:1105/ctxtMEPO_TOPLINE-SUPERFIELD").Text = v_cnpj 'CNPJ'
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:" & Mid(session.ActiveWindow.SystemFocus.Id, 49, 4) & "/subSUB0:SAPLMEGUI:0030/subSUB1:SAPLMEGUI:1105/ctxtMEPO_TOPLINE-SUPERFIELD").SetFocus
    session.findById("wnd[0]").sendVKey 0
    WScript.Sleep 1000
    ' DADOS DO CABEALHO DO PEDIDO
    'Organizao de compras
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:0013/subSUB1:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1102/tabsHEADER_DETAIL/tabpTABHDT8/ssubTABSTRIPCONTROL2SUB:SAPLMEGUI:1221/ctxtMEPO1222-EKORG").Text = v_emp 'ORDEM DE COMPRA'
    session.findById("wnd[0]").sendVKey 0
    'Grupo comprador
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:0013/subSUB1:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1102/tabsHEADER_DETAIL/tabpTABHDT8/ssubTABSTRIPCONTROL2SUB:SAPLMEGUI:1221/ctxtMEPO1222-EKGRP").Text = "FRT"
    session.findById("wnd[0]").sendVKey 0
    'Moeda do pedido
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:0013/subSUB1:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1102/tabsHEADER_DETAIL/tabpTABHDT1/ssubTABSTRIPCONTROL2SUB:SAPLMEGUI:1226/ctxtMEPO1226-WAERS").Text = "BRL"
    session.findById("wnd[0]").sendVKey 0
    'Condio de pagamento
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:0013/subSUB1:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1102/tabsHEADER_DETAIL/tabpTABHDT1/ssubTABSTRIPCONTROL2SUB:SAPLMEGUI:1226/ctxtMEPO1226-ZTERM").Text = "0001"
    session.findById("wnd[0]").sendVKey 0
    ' ABA PARCEIROS
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:0013/subSUB1:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1102/tabsHEADER_DETAIL/tabpTABHDT6").Select
    'Define parceiro FM e informa centro/filial
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:0018/subSUB1:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1102/tabsHEADER_DETAIL/tabpTABHDT6/ssubTABSTRIPCONTROL2SUB:SAPLMEGUI:1224/subPARTNERS:SAPLEKPA:0111/tblSAPLEKPATC_0111/ctxtMMPA-PARVW[0,1]").Text = "FM"
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:0018/subSUB1:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1102/tabsHEADER_DETAIL/tabpTABHDT6/ssubTABSTRIPCONTROL2SUB:SAPLMEGUI:1224/subPARTNERS:SAPLEKPA:0111/tblSAPLEKPATC_0111/ctxtWRF02K-GPARN[2,1]").Text = v_centro1 'CENTRO DE CUSTO "CEN+FILIAL'
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:0018/subSUB1:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1102/tabsHEADER_DETAIL/tabpTABHDT6/ssubTABSTRIPCONTROL2SUB:SAPLMEGUI:1224/subPARTNERS:SAPLEKPA:0111/tblSAPLEKPATC_0111/ctxtWRF02K-GPARN[2,1]").SetFocus
    session.findById("wnd[0]").sendVKey 0
    ' DADOS DO ITEM DO PEDIDO
    'Categoria de imputao e tipo de item
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:0018/subSUB2:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1211/tblSAPLMEGUITC_1211/ctxtMEPO1211-KNTTP[2,0]").Text = "K"
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:0018/subSUB2:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1211/tblSAPLMEGUITC_1211/ctxtMEPO1211-EPSTP[3,0]").Text = "D"
    'Descrio do item
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:0018/subSUB2:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1211/tblSAPLMEGUITC_1211/txtMEPO1211-TXZ01[5,0]").Text = "FRETE"
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:0018/subSUB2:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1211/tblSAPLMEGUITC_1211/txtMEPO1211-TXZ01[5,0]").SetFocus
    session.findById("wnd[0]").sendVKey 0
    WScript.Sleep 1000
    'Centro/filial
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:" & Mid(session.ActiveWindow.SystemFocus.Id, 49, 4) & "/subSUB2:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1211/tblSAPLMEGUITC_1211/ctxtMEPO1211-NAME1[15,0]").Text = v_centro 'CENTRO (FILIAL 4201)'
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:" & Mid(session.ActiveWindow.SystemFocus.Id, 49, 4) & "/subSUB2:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1211/tblSAPLMEGUITC_1211/ctxtMEPO1211-NAME1[15,0]").SetFocus
    session.findById("wnd[0]").sendVKey 0
    WScript.Sleep 1000
    'Grupo de mercadorias (0019 ou 0017?)
    session.findById("wnd[0]").sendVKey 0
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:0019/subSUB2:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1211/tblSAPLMEGUITC_1211/ctxtMEPO1211-WGBEZ[14,0]").Text = "07004"
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:0019/subSUB2:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1211/tblSAPLMEGUITC_1211/ctxtMEPO1211-WGBEZ[14,0]").SetFocus
    session.findById("wnd[0]").sendVKey 0
    ' ABA SERVIOS
    'Cdigo do servio
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:0019/subSUB3:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1301/subSUB2:SAPLMEGUI:1303/tabsITEM_DETAIL/tabpTABIDT1/ssubTABSTRIPCONTROL1SUB:SAPLMEGUI:1328/subSUB0:SAPLMLSP:0400/tblSAPLMLSPTC_VIEW/ctxtESLL-SRVPOS[2,0]").Text = "3000001"
    'Quantidade do servio
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:0019/subSUB3:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1301/subSUB2:SAPLMEGUI:1303/tabsITEM_DETAIL/tabpTABIDT1/ssubTABSTRIPCONTROL1SUB:SAPLMEGUI:1328/subSUB0:SAPLMLSP:0400/tblSAPLMLSPTC_VIEW/txtESLL-MENGE[4,0]").Text = "1"
    'Valor lquido do frete
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:0019/subSUB3:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1301/subSUB2:SAPLMEGUI:1303/tabsITEM_DETAIL/tabpTABIDT1/ssubTABSTRIPCONTROL1SUB:SAPLMEGUI:1328/subSUB0:SAPLMLSP:0400/tblSAPLMLSPTC_VIEW/txtESLL-TBTWR[6,0]").Text = Valor 'VALOR LIQUIDO'
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:0019/subSUB3:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1301/subSUB2:SAPLMEGUI:1303/tabsITEM_DETAIL/tabpTABIDT1/ssubTABSTRIPCONTROL1SUB:SAPLMEGUI:1328/subSUB0:SAPLMLSP:0400/tblSAPLMLSPTC_VIEW/txtESLL-TBTWR[6,0]").SetFocus
    session.findById("wnd[0]").sendVKey 0
    ' CENTRO DE CUSTO
    session.findById("wnd[1]/usr/subKONTBLOCK:SAPLKACB:1101/ctxtCOBL-KOSTL").Text = v_cc 'CENTRO DE CUSTO'
    session.findById("wnd[1]/usr/subKONTBLOCK:SAPLKACB:1101/ctxtCOBL-KOSTL").SetFocus
    session.findById("wnd[1]").sendVKey 0
    ' IMPOSTO
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:0015/subSUB3:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1301/subSUB2:SAPLMEGUI:1303/tabsITEM_DETAIL/tabpTABIDT8/ssubTABSTRIPCONTROL1SUB:SAPLMEGUI:1317/ctxtMEPO1317-MWSKZ").Text = v_imp 'IMPOSTO (F1 OU F2)'
    session.findById("wnd[0]").sendVKey 0
    ' DESABILITA RECEBIMENTO DE MERCADORIA
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:0015/subSUB3:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1301/subSUB2:SAPLMEGUI:1303/tabsITEM_DETAIL/tabpTABIDT7").Select
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:0019/subSUB3:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1301/subSUB2:SAPLMEGUI:1303/tabsITEM_DETAIL/tabpTABIDT7/ssubTABSTRIPCONTROL1SUB:SAPLMEGUI:1313/chkMEPO1313-WEPOS").Selected = False
    session.findById("wnd[0]/usr/subSUB0:SAPLMEGUI:0019/subSUB3:SAPLMEVIEWS:1100/subSUB2:SAPLMEVIEWS:1200/subSUB1:SAPLMEGUI:1301/subSUB2:SAPLMEGUI:1303/tabsITEM_DETAIL/tabpTABIDT7/ssubTABSTRIPCONTROL1SUB:SAPLMEGUI:1313/chkMEPO1313-WEPOS").SetFocus
    ' SALVA O PEDIDO
    session.findById("wnd[0]/tbar[0]/btn[11]").press
    session.findById("wnd[1]/usr/btnSPOP-VAROPTION1").press
    session.findById("wnd[0]/sbar").DoubleClick
    WScript.Sleep 1000
    'Aguarda o SAP finalizar o processamento
    Do While session.Busy
    WScript.Sleep 100
    Loop
    'Fecha possveis janelas adicionais
    TentarConfirmarPopup
    WScript.Sleep 1000
    'Captura o nmero do pedido criado
    NrPedido = Right(session.findById("wnd[0]/sbar").Text, 10)`;

export const CORPO_CTE_MIRO = String.raw`    session.findById("wnd[0]").maximize
    session.findById("wnd[0]/tbar[0]/okcd").Text = "/NMIRO"
    session.findById("wnd[0]").sendVKey 0
    ' AGUARDA A TELA DE SELEO DA EMPRESA APARECER
    For tentativas = 1 To 6
    If session.Children.Count > 1 Then
    PreencherEmpresaInicial
    Exit For
    End If
    session.findById("wnd[0]").sendVKey 0
    Next
    ' SELECIONA A EMPRESA CORRETA PARA O LANAMENTO
    session.findById("wnd[0]").sendVKey 7
    session.findById("wnd[1]/usr/ctxtBKPF-BUKRS").Text = v_emp
    session.findById("wnd[1]").sendVKey 0
    WScript.Sleep 1000
    ' DADOS GERAIS DA FATURA
    'Data de emisso do documento
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/tabsHEADER/tabpHEADER_TOTAL/ssubHEADER_SCREEN:SAPLFDCB:0010/ctxtINVFO-BLDAT").Text = DtaEmissao
    session.findById("wnd[0]").sendVKey 0
    'Segundo enter necessrio para validao da data no SAP
    session.findById("wnd[0]").sendVKey 0
    'Nmero do CT-e
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/tabsHEADER/tabpHEADER_TOTAL/ssubHEADER_SCREEN:SAPLFDCB:0010/txtINVFO-XBLNR").Text = v_cte 'CT-E'
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/tabsHEADER/tabpHEADER_TOTAL/ssubHEADER_SCREEN:SAPLFDCB:0010/txtINVFO-XBLNR").SetFocus
    session.findById("wnd[0]").sendVKey 0
    'Valor total da fatura
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/tabsHEADER/tabpHEADER_TOTAL/ssubHEADER_SCREEN:SAPLFDCB:0010/txtINVFO-WRBTR").Text = v_bruto 'VALOR'
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/tabsHEADER/tabpHEADER_TOTAL/ssubHEADER_SCREEN:SAPLFDCB:0010/txtINVFO-WRBTR").SetFocus
    session.findById("wnd[0]").sendVKey 0
    ' REFERNCIA AO PEDIDO DE COMPRA
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/subITEMS:SAPLMR1M:6010/tabsITEMTAB/tabpITEMS_PO/ssubTABS:SAPLMR1M:6020/subREFERENZBELEG:SAPLMR1M:6211/ctxtRM08M-EBELN").Text = v_pedido 'PEDIDO'
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/subITEMS:SAPLMR1M:6010/tabsITEMTAB/tabpITEMS_PO/ssubTABS:SAPLMR1M:6020/subREFERENZBELEG:SAPLMR1M:6211/ctxtRM08M-EBELN").SetFocus
    session.findById("wnd[0]").sendVKey 0
    'Tela de anlise de crdito
    session.findById("wnd[0]").sendVKey 0
    ' ABA PAGAMENTO
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/tabsHEADER/tabpHEADER_PAY").Select
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/tabsHEADER/tabpHEADER_PAY").Select
    WScript.Sleep 1000
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/tabsHEADER/tabpHEADER_PAY").Select
    'Data base para vencimento do pagamento
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/tabsHEADER/tabpHEADER_PAY/ssubHEADER_SCREEN:SAPLFDCB:0020/ctxtINVFO-ZFBDT").Text = DtaVencimento
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/tabsHEADER/tabpHEADER_PAY/ssubHEADER_SCREEN:SAPLFDCB:0020/ctxtINVFO-ZFBDT").SetFocus
    session.findById("wnd[0]").sendVKey 0
    ' ABA FINANCEIRA
    'Define o tipo de nota fiscal brasileira
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/tabsHEADER/tabpHEADER_FI").Select
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/tabsHEADER/tabpHEADER_FI/ssubHEADER_SCREEN:SAPLFDCB:0150/ctxtINVFO-J_1BNFTYPE").Text = "YJ"
    session.findById("wnd[0]/usr/subHEADER_AND_ITEMS:SAPLMR1M:6005/tabsHEADER/tabpHEADER_FI/ssubHEADER_SCREEN:SAPLFDCB:0150/ctxtINVFO-J_1BNFTYPE").SetFocus
    session.findById("wnd[0]").sendVKey 0
    ' ABRE A TELA DE IMPOSTOS
    session.findById("wnd[0]/tbar[1]/btn[21]").press
    session.findById("wnd[0]/usr/tabsTABSTRIP1/tabpTAB1/ssubHEADER_TAB:SAPLJ1BB2:2100/tblSAPLJ1BB2ITEM_CONTROL/ctxtJ_1BDYLIN-ITMTYP[1,0]").SetFocus
    session.findById("wnd[0]").sendVKey 2
    WScript.Sleep 1000
    ' TRATAMENTO DE IMPOSTOS
    If aliquota = 0 Then
    ' CT-e ISENTO DE IMPOSTO
    'Preenche a base de clculo dos impostos e solicita ao SAP o reclculo automtico
    session.findById("wnd[0]/usr/tabsITEM_TAB/tabpTAX").Select
    session.findById("wnd[0]/usr/tabsITEM_TAB/tabpTAX/ssubITEM_TABS:SAPLJ1BB2:3200/tblSAPLJ1BB2TAX_CONTROL/txtJ_1BDYSTX-BASE[3,0]").Text = v_bruto
    session.findById("wnd[0]").sendVKey 0
    session.findById("wnd[0]/usr/tabsITEM_TAB/tabpTAX/ssubITEM_TABS:SAPLJ1BB2:3200/tblSAPLJ1BB2TAX_CONTROL/txtJ_1BDYSTX-BASE[3,2]").Text = v_bruto
    session.findById("wnd[0]").sendVKey 0
    session.findById("wnd[0]/usr/tabsITEM_TAB/tabpTAX/ssubITEM_TABS:SAPLJ1BB2:3200/tblSAPLJ1BB2TAX_CONTROL/txtJ_1BDYSTX-BASE[3,1]").Text = v_bruto
    session.findById("wnd[0]").sendVKey 0
    session.findById("wnd[0]/usr/tabsITEM_TAB/tabpTAX/ssubITEM_TABS:SAPLJ1BB2:3200/tblSAPLJ1BB2TAX_CONTROL").getAbsoluteRow(0).Selected = True
    session.findById("wnd[0]/usr/tabsITEM_TAB/tabpTAX/ssubITEM_TABS:SAPLJ1BB2:3200/tblSAPLJ1BB2TAX_CONTROL").getAbsoluteRow(1).Selected = True
    session.findById("wnd[0]/usr/tabsITEM_TAB/tabpTAX/ssubITEM_TABS:SAPLJ1BB2:3200/tblSAPLJ1BB2TAX_CONTROL").getAbsoluteRow(2).Selected = True
    session.findById("wnd[0]/usr/tabsITEM_TAB/tabpTAX/ssubITEM_TABS:SAPLJ1BB2:3200/tblSAPLJ1BB2TAX_CONTROL").getAbsoluteRow(3).Selected = True
    session.findById("wnd[0]/usr/tabsITEM_TAB/tabpTAX/ssubITEM_TABS:SAPLJ1BB2:3200/tblSAPLJ1BB2TAX_CONTROL").getAbsoluteRow(4).Selected = True
    session.findById("wnd[0]/usr/tabsITEM_TAB/tabpTAX/ssubITEM_TABS:SAPLJ1BB2:3200/tblSAPLJ1BB2TAX_CONTROL/ctxtJ_1BDYSTX-TAXTYP[0,2]").SetFocus
    session.findById("wnd[0]").sendVKey 0
    session.findById("wnd[0]/usr/tabsITEM_TAB/tabpTAX/ssubITEM_TABS:SAPLJ1BB2:3200/btnPB_CALCULATOR").press
    session.findById("wnd[0]/tbar[0]/btn[3]").press
    Else
    ' CT-e COM IMPOSTO
    'Preenche todas as bases tributrias e informa a alquota correspondente
    'Exemplo:
    '12 significa 12%
    '7 significa 7%
    '4 significa 4%
    session.findById("wnd[0]/usr/tabsITEM_TAB/tabpTAX").Select
    session.findById("wnd[0]/usr/tabsITEM_TAB/tabpTAX/ssubITEM_TABS:SAPLJ1BB2:3200/tblSAPLJ1BB2TAX_CONTROL/txtJ_1BDYSTX-BASE[3,0]").Text = v_bruto
    session.findById("wnd[0]").sendVKey 0
    session.findById("wnd[0]/usr/tabsITEM_TAB/tabpTAX/ssubITEM_TABS:SAPLJ1BB2:3200/tblSAPLJ1BB2TAX_CONTROL/txtJ_1BDYSTX-BASE[3,2]").Text = v_bruto
    session.findById("wnd[0]").sendVKey 0
    session.findById("wnd[0]/usr/tabsITEM_TAB/tabpTAX/ssubITEM_TABS:SAPLJ1BB2:3200/tblSAPLJ1BB2TAX_CONTROL/txtJ_1BDYSTX-BASE[3,1]").Text = v_bruto
    session.findById("wnd[0]").sendVKey 0
    session.findById("wnd[0]/usr/tabsITEM_TAB/tabpTAX/ssubITEM_TABS:SAPLJ1BB2:3200/tblSAPLJ1BB2TAX_CONTROL/txtJ_1BDYSTX-BASE[3,3]").Text = v_bruto
    session.findById("wnd[0]").sendVKey 0
    session.findById("wnd[0]/usr/tabsITEM_TAB/tabpTAX/ssubITEM_TABS:SAPLJ1BB2:3200/tblSAPLJ1BB2TAX_CONTROL/txtJ_1BDYSTX-BASE[3,4]").Text = v_bruto
    session.findById("wnd[0]").sendVKey 0
    session.findById("wnd[0]/usr/tabsITEM_TAB/tabpTAX/ssubITEM_TABS:SAPLJ1BB2:3200/tblSAPLJ1BB2TAX_CONTROL/txtJ_1BDYSTX-RATE[4,3]").Text = aliquota
    session.findById("wnd[0]").sendVKey 0
    session.findById("wnd[0]/usr/tabsITEM_TAB/tabpTAX/ssubITEM_TABS:SAPLJ1BB2:3200/tblSAPLJ1BB2TAX_CONTROL").getAbsoluteRow(0).Selected = True
    session.findById("wnd[0]/usr/tabsITEM_TAB/tabpTAX/ssubITEM_TABS:SAPLJ1BB2:3200/tblSAPLJ1BB2TAX_CONTROL").getAbsoluteRow(1).Selected = True
    session.findById("wnd[0]/usr/tabsITEM_TAB/tabpTAX/ssubITEM_TABS:SAPLJ1BB2:3200/tblSAPLJ1BB2TAX_CONTROL").getAbsoluteRow(2).Selected = True
    session.findById("wnd[0]/usr/tabsITEM_TAB/tabpTAX/ssubITEM_TABS:SAPLJ1BB2:3200/tblSAPLJ1BB2TAX_CONTROL").getAbsoluteRow(3).Selected = True
    session.findById("wnd[0]/usr/tabsITEM_TAB/tabpTAX/ssubITEM_TABS:SAPLJ1BB2:3200/tblSAPLJ1BB2TAX_CONTROL").getAbsoluteRow(4).Selected = True
    session.findById("wnd[0]/usr/tabsITEM_TAB/tabpTAX/ssubITEM_TABS:SAPLJ1BB2:3200/tblSAPLJ1BB2TAX_CONTROL/ctxtJ_1BDYSTX-TAXTYP[0,2]").SetFocus
    session.findById("wnd[0]").sendVKey 0
    session.findById("wnd[0]/usr/tabsITEM_TAB/tabpTAX/ssubITEM_TABS:SAPLJ1BB2:3200/btnPB_CALCULATOR").press
    session.findById("wnd[0]/tbar[0]/btn[3]").press
    End If
    ' DADOS DA AUTORIZAO DA NF-E
    'Nmero do protocolo SEFAZ
    session.findById("wnd[0]/usr/tabsTABSTRIP1/tabpTAB8").Select
    session.findById("wnd[0]/usr/tabsTABSTRIP1/tabpTAB8/ssubHEADER_TAB:SAPLJ1BB2:2800/subTIMESTAMP:SAPLJ1BB2:2803/subAUTHCODE_AREA:SAPLJ1BB2:2805/txtJ_1BDYDOC-AUTHCOD").Text = v_prot 'PROTOCOLO'
    session.findById("wnd[0]").sendVKey 0
    'Data da autorizao da nota fiscal
    session.findById("wnd[0]/usr/tabsTABSTRIP1/tabpTAB8/ssubHEADER_TAB:SAPLJ1BB2:2800/subTIMESTAMP:SAPLJ1BB2:2803/ctxtJ_1BDYDOC-AUTHDATE").Text = DtaEmissao
    session.findById("wnd[0]/usr/tabsTABSTRIP1/tabpTAB8/ssubHEADER_TAB:SAPLJ1BB2:2800/subTIMESTAMP:SAPLJ1BB2:2803/ctxtJ_1BDYDOC-AUTHDATE").SetFocus
    session.findById("wnd[0]").sendVKey 0
    'Tipo de emisso e nmero da chave da NF-e
    'session.findById("wnd[0]/usr/tabsTABSTRIP1/tabpTAB8/ssubHEADER_TAB:SAPLJ1BB2:2800/subRANDOM_NUMBER:SAPLJ1BB2:2801/ctxtJ_1BNFE_DOCNUM9_DIVIDED-TPEMIS").Text = Cells(i, 20).Value
    'session.findById("wnd[0]/usr/tabsTABSTRIP1/tabpTAB8/ssubHEADER_TAB:SAPLJ1BB2:2800/subRANDOM_NUMBER:SAPLJ1BB2:2801/txtJ_1BNFE_DOCNUM9_DIVIDED-DOCNUM8").Text = Cells(i, 21).Value
    'session.findById("wnd[0]").sendVKey 0
    'session.findById("wnd[0]/usr/tabsTABSTRIP1/tabpTAB8/ssubHEADER_TAB:SAPLJ1BB2:2800/subRANDOM_NUMBER:SAPLJ1BB2:2801/txtJ_1BNFE_ACTIVE-CDV").SetFocus
    'session.findById("wnd[0]").sendVKey 0
    'NV Tipo de emisso e nmero da chave da NF-e
    session.findById("wnd[0]/usr/tabsTABSTRIP1/tabpTAB8/ssubHEADER_TAB:SAPLJ1BB2:2800/subACCESS_KEY:SAPLJ1BB2:2808/subRANDOM_NUMBER:SAPLJ1BB2:2801/ctxtJ_1BNFE_DOCNUM9_DIVIDED-TPEMIS").Text = v_tp
    session.findById("wnd[0]/usr/tabsTABSTRIP1/tabpTAB8/ssubHEADER_TAB:SAPLJ1BB2:2800/subACCESS_KEY:SAPLJ1BB2:2808/subRANDOM_NUMBER:SAPLJ1BB2:2801/txtJ_1BNFE_DOCNUM9_DIVIDED-DOCNUM8").Text = v_c8
    session.findById("wnd[0]/usr/tabsTABSTRIP1/tabpTAB8/ssubHEADER_TAB:SAPLJ1BB2:2800/subACCESS_KEY:SAPLJ1BB2:2808/subRANDOM_NUMBER:SAPLJ1BB2:2801/txtJ_1BNFE_ACTIVE-CDV").Text = v_dv
    session.findById("wnd[0]/usr/tabsTABSTRIP1/tabpTAB8/ssubHEADER_TAB:SAPLJ1BB2:2800/subACCESS_KEY:SAPLJ1BB2:2808/subRANDOM_NUMBER:SAPLJ1BB2:2801/txtJ_1BNFE_ACTIVE-CDV").SetFocus
    session.findById("wnd[0]").sendVKey 0
    WScript.Sleep 1000
    ' GRAVA O DOCUMENTO NO SAP
    session.findById("wnd[0]/tbar[0]/btn[3]").press
    session.findById("wnd[0]/tbar[0]/btn[11]").press
    'Captura o nmero do documento MIRO gerado
    nrMiro = Mid(session.findById("wnd[0]/sbar").Text, 14, 10)`;
