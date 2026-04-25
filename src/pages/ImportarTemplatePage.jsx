import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { importarTemplatePadraoSeparado } from '../utils/importadorTemplatePadrao';
import { construirCadastroBase, exportarLinhasParaXlsx, encontrarTransportadoraExistente } from '../utils/formatacaoTabela';

const inicial = { transportadoraModo: 'existente', transportadoraId: '', transportadoraNome: '', codigoOrigem: '', canal: 'ATACADO', regraCalculo: 'Sem regra', tipoCalculo: 'FAIXA_PESO', vigenciaInicial: '', vigenciaFinal: '' };
const nomeArquivo = (d) => [d.transportadoraNome, d.codigoOrigem, d.canal].filter(Boolean).join('-').replace(/\s+/g, '_') || 'template-importado';

export default function ImportarTemplatePage({ transportadoras = [] }) {
  const cadastros = useMemo(() => construirCadastroBase(transportadoras), [transportadoras]);
  const [dados, setDados] = useState(inicial);
  const [arquivoRotas, setArquivoRotas] = useState(null);
  const [arquivoFretes, setArquivoFretes] = useState(null);
  const [resultado, setResultado] = useState({ rotas: [], quebrasFaixa: [], fretes: [] });
  const [mensagem, setMensagem] = useState('');
  const setCampo = (campo, valor) => setDados((prev) => ({ ...prev, [campo]: valor }));
  const selecionarTransportadora = (id) => {
    const existente = encontrarTransportadoraExistente(cadastros, id);
    setDados((prev) => ({ ...prev, transportadoraId: existente?.id || '', transportadoraNome: existente?.nome || '' }));
  };
  const importarArquivos = async () => {
    try {
      const convertido = await importarTemplatePadraoSeparado({ arquivoRotas, arquivoFretes });
      setResultado(convertido);
      setMensagem(`Template importado: ${convertido.rotas.length} rota(s), ${convertido.quebrasFaixa.length} quebra(s) e ${convertido.fretes.length} frete(s).`);
    } catch (error) {
      setMensagem(error?.message || 'Erro ao importar template.');
    }
  };
  const exportarRotas = () => exportarLinhasParaXlsx(XLSX, resultado.rotas.map((r) => ({
    'NOME TRANSPORTADORA': dados.transportadoraNome, 'CÓDIGO UNIDADE': dados.codigoOrigem, CANAL: dados.canal, COTAÇÃO: r.cotacaoFinal || r.cotacao, 'IBGE ORIGEM': r.ibgeOrigem || '', 'IBGE DESTINO': r.ibgeDestino, PRAZO: r.prazo, 'DATA INÍCIO': dados.vigenciaInicial, 'DATA FIM': dados.vigenciaFinal,
  })), `${nomeArquivo(dados)}-rotas.xlsx`, 'Prazos de frete');
  const exportarFretes = () => exportarLinhasParaXlsx(XLSX, resultado.fretes.map((f) => ({
    'NOME TRANSPORTADORA': dados.transportadoraNome, 'CÓDIGO UNIDADE': dados.codigoOrigem, CANAL: dados.canal, 'REGRA DE CÁLCULO': dados.regraCalculo, 'TIPO DE CÁLCULO': dados.tipoCalculo, 'ROTA DO FRETE': f.cotacaoFinal || f.cotacao, 'PESO INICIAL': f.pesoInicial ?? '', 'PESO FINAL': f.pesoFinal ?? '', 'FRETE VALOR': dados.tipoCalculo === 'FAIXA_PESO' ? '' : (f.freteValor ?? ''), 'AD VALOREM %': f.fretePercentual ?? '', 'FRETE MÍNIMO': dados.tipoCalculo === 'FAIXA_PESO' ? '' : (f.freteMinimo ?? ''), 'TAXA APLICADA': dados.tipoCalculo === 'FAIXA_PESO' ? (f.freteValor ?? f.taxaAplicada ?? '') : (f.taxaAplicada ?? ''), EXCEDENTE: f.excedente ?? '', 'DATA INÍCIO': dados.vigenciaInicial, 'DATA FIM': dados.vigenciaFinal,
  })), `${nomeArquivo(dados)}-fretes.xlsx`, 'Valores de frete');
  const gerarPacote = () => {
    if (!resultado.rotas.length && !resultado.fretes.length) return setMensagem('Importe Rotas e Fretes antes de gerar.');
    exportarRotas(); setTimeout(exportarFretes, 400);
  };
  return (
    <div className="page-shell formatacao-shell">
      <div className="page-top between"><div className="page-header"><div className="amd-mini-brand">Template preenchido</div><h1>Importar Template</h1><p>Fluxo separado para arquivos preenchidos pelo transportador: Rotas e Fretes.</p></div><div className="formatacao-actions-top"><button className="btn-primary" onClick={gerarPacote}>Gerar pacote completo</button></div></div>
      {mensagem ? <div className="formatacao-alert">{mensagem}</div> : null}
      <section className="panel-card formatacao-section"><div className="section-header-inline"><h3>Dados da importação</h3><div className="hint-line">Pode usar transportadora cadastrada ou digitar uma nova.</div></div><div className="formatacao-grid three">
        <label className="field-block"><span>Transportadora</span><select value={dados.transportadoraModo} onChange={(e) => setCampo('transportadoraModo', e.target.value)}><option value="existente">Existente</option><option value="novo">Novo cadastro</option></select></label>
        {dados.transportadoraModo === 'existente' ? <label className="field-block"><span>Lista de transportadoras</span><select value={dados.transportadoraId} onChange={(e) => selecionarTransportadora(e.target.value)}><option value="">Selecione</option>{cadastros.transportadoras.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}</select></label> : <label className="field-block"><span>Nova transportadora</span><input value={dados.transportadoraNome} onChange={(e) => setCampo('transportadoraNome', e.target.value)} /></label>}
        <label className="field-block"><span>Código unidade</span><input value={dados.codigoOrigem} onChange={(e) => setCampo('codigoOrigem', e.target.value)} /></label>
        <label className="field-block"><span>Canal</span><select value={dados.canal} onChange={(e) => setCampo('canal', e.target.value)}><option value="ATACADO">ATACADO</option><option value="B2C">B2C</option><option value="INTERCOMPANY">INTERCOMPANY</option></select></label>
        <label className="field-block"><span>Tipo de cálculo</span><select value={dados.tipoCalculo} onChange={(e) => setCampo('tipoCalculo', e.target.value)}><option value="FAIXA_PESO">Faixa de peso</option><option value="PERCENTUAL">Percentual</option></select></label>
        <label className="field-block"><span>Regra</span><select value={dados.regraCalculo} onChange={(e) => setCampo('regraCalculo', e.target.value)}><option>Sem regra</option><option>Maior valor</option><option>Menor valor</option></select></label>
        <label className="field-block"><span>Vigência inicial</span><input type="date" value={dados.vigenciaInicial} onChange={(e) => setCampo('vigenciaInicial', e.target.value)} /></label><label className="field-block"><span>Vigência final</span><input type="date" value={dados.vigenciaFinal} onChange={(e) => setCampo('vigenciaFinal', e.target.value)} /></label>
      </div></section>
      <section className="panel-card formatacao-section"><div className="section-header-inline"><h3>Arquivos do template</h3><div className="hint-line">Esta tela é independente da Formatação de Tabelas.</div></div><div className="formatacao-grid three"><label className="field-block"><span>Arquivo Rotas</span><input type="file" accept=".xlsx,.xls,.xlsb,.csv" onChange={(e) => setArquivoRotas(e.target.files?.[0] || null)} /></label><label className="field-block"><span>Arquivo Fretes</span><input type="file" accept=".xlsx,.xls,.xlsb,.csv" onChange={(e) => setArquivoFretes(e.target.files?.[0] || null)} /></label><div className="field-block button-stack"><span>Ação</span><button className="btn-primary" onClick={importarArquivos}>Importar template</button></div></div></section>
      <section className="panel-card formatacao-section"><div className="section-header-inline"><h3>Prévia</h3><div className="hint-line">Rotas: {resultado.rotas.length} | Fretes: {resultado.fretes.length}</div></div><div className="feature-grid two-cols"><div className="info-card compact-info-card"><strong>Rotas lidas</strong><p>{resultado.rotas.slice(0, 5).map((r) => r.cotacaoFinal || r.cotacao).join(' | ') || 'Nenhuma rota importada.'}</p></div><div className="info-card compact-info-card"><strong>Fretes lidos</strong><p>{resultado.fretes.slice(0, 5).map((f) => `${f.cotacaoFinal || f.cotacao} ${f.pesoInicial ?? ''}-${f.pesoFinal ?? ''}`).join(' | ') || 'Nenhum frete importado.'}</p></div></div></section>
    </div>
  );
}
