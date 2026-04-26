import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { importarTemplatePadraoSeparado } from '../utils/importadorTemplatePadrao';
import { baixarModeloTemplateFretes, baixarModeloTemplateRotas } from '../utils/modelosTemplateFormatacao';

function normalizarTexto(valor) {
  return String(valor ?? '').trim();
}

function numeroOuVazio(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : valor;
}

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

function fimTresAnosISO() {
  const data = new Date();
  data.setFullYear(data.getFullYear() + 3);
  return data.toISOString().slice(0, 10);
}

function gerarId(prefixo) {
  if (globalThis.crypto?.randomUUID) return `${prefixo}-${globalThis.crypto.randomUUID()}`;
  return `${prefixo}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function chaveOrigem(cidade, canal) {
  return `${normalizarTexto(cidade).toLowerCase()}|${normalizarTexto(canal).toUpperCase()}`;
}

function exportarXlsx(linhas, nomeArquivo, aba = 'Tabela formatada') {
  if (!linhas.length) return;
  const ws = XLSX.utils.json_to_sheet(linhas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, aba);
  XLSX.writeFile(wb, nomeArquivo);
}

function montarLinhasFormatadas({ resultado, transportadora, canal, inicioVigencia, fimVigencia }) {
  const nomeTransportadora = normalizarTexto(transportadora);
  const canalFinal = normalizarTexto(canal || 'ATACADO').toUpperCase();

  const rotas = (resultado?.rotas || []).map((item) => ({
    id: gerarId('rota'),
    nomeRota: item.cotacaoFinal || item.cotacao || `${item.origem} - ${item.ufDestino} - ${item.cotacaoBase}`,
    ibgeOrigem: item.ibgeOrigem || '',
    cidadeOrigem: item.origem || '',
    ufOrigem: item.ufOrigem || '',
    ibgeDestino: item.ibgeDestino || '',
    cidadeDestino: item.cidadeDestino || '',
    ufDestino: item.ufDestino || '',
    canal: canalFinal,
    prazoEntregaDias: item.prazo || '',
    valorMinimoFrete: '',
    cotacaoBase: item.cotacaoBase || '',
    cotacaoFinal: item.cotacaoFinal || item.cotacao || '',
    inicioVigencia,
    fimVigencia,
  }));

  const cotacoes = (resultado?.fretes || []).map((item) => ({
    id: gerarId('cotacao'),
    rota: item.cotacaoFinal || item.cotacao || `${item.origem} - ${item.ufDestino} - ${item.cotacaoBase}`,
    origem: item.origem || '',
    ufOrigem: item.ufOrigem || '',
    ufDestino: item.ufDestino || '',
    cotacaoBase: item.cotacaoBase || '',
    faixaPeso: item.faixaPeso || '',
    pesoMin: item.pesoInicial ?? '',
    pesoMax: item.pesoFinal ?? '',
    valorFixo: item.taxaAplicada ?? item.freteValor ?? '',
    taxaAplicada: item.taxaAplicada ?? item.freteValor ?? '',
    excesso: item.excedente ?? '',
    percentual: item.fretePercentual ?? '',
    freteMinimo: item.freteMinimo ?? '',
    regraCalculo: 'FAIXA_DE_PESO',
    tipoCalculo: 'FAIXA_DE_PESO',
    canal: canalFinal,
    inicioVigencia,
    fimVigencia,
  }));

  const linhasExportacao = cotacoes.map((item) => ({
    'NOME TRANSPORTADORA': nomeTransportadora,
    'CANAL': canalFinal,
    'ROTA DO FRETE': item.rota,
    'ORIGEM': item.origem,
    'UF ORIGEM': item.ufOrigem,
    'UF DESTINO': item.ufDestino,
    'COTAÇÃO': item.cotacaoBase,
    'FAIXA': item.faixaPeso,
    'PESO INICIAL': numeroOuVazio(item.pesoMin),
    'PESO FINAL': numeroOuVazio(item.pesoMax),
    'TAXA APLICADA': numeroOuVazio(item.valorFixo),
    'EXCEDENTE': numeroOuVazio(item.excesso),
    'AD VALOREM / % FRETE': numeroOuVazio(item.percentual),
    'FRETE MÍNIMO': numeroOuVazio(item.freteMinimo),
    'DATA INÍCIO': inicioVigencia,
    'DATA FIM': fimVigencia,
  }));

  const linhasRotas = rotas.map((item) => ({
    'NOME TRANSPORTADORA': nomeTransportadora,
    'CANAL': canalFinal,
    'NOME ROTA': item.nomeRota,
    'IBGE ORIGEM': item.ibgeOrigem,
    'CIDADE ORIGEM': item.cidadeOrigem,
    'UF ORIGEM': item.ufOrigem,
    'IBGE DESTINO': item.ibgeDestino,
    'CIDADE DESTINO': item.cidadeDestino,
    'UF DESTINO': item.ufDestino,
    'PRAZO': item.prazoEntregaDias,
    'DATA INÍCIO': inicioVigencia,
    'DATA FIM': fimVigencia,
  }));

  return { rotas, cotacoes, linhasExportacao, linhasRotas };
}

function montarTransportadorasParaSalvar({ resultado, transportadoraNome, canal, inicioVigencia, fimVigencia, transportadorasAtuais }) {
  const baseNome = normalizarTexto(transportadoraNome);
  const canalFinal = normalizarTexto(canal || 'ATACADO').toUpperCase();
  const { rotas, cotacoes } = montarLinhasFormatadas({ resultado, transportadora: baseNome, canal: canalFinal, inicioVigencia, fimVigencia });
  const existente = (transportadorasAtuais || []).find((item) => normalizarTexto(item.nome).toLowerCase() === baseNome.toLowerCase());

  const transportadora = existente
    ? JSON.parse(JSON.stringify(existente))
    : { id: gerarId('transportadora'), nome: baseNome, status: 'Ativa', origens: [] };

  const grupos = new Map();
  rotas.forEach((rota) => {
    const chave = chaveOrigem(rota.cidadeOrigem, canalFinal);
    if (!grupos.has(chave)) grupos.set(chave, { cidade: rota.cidadeOrigem, canal: canalFinal, rotas: [], cotacoes: [] });
    grupos.get(chave).rotas.push({
      id: rota.id,
      nomeRota: rota.nomeRota,
      ibgeOrigem: rota.ibgeOrigem,
      ibgeDestino: rota.ibgeDestino,
      canal: rota.canal,
      prazoEntregaDias: rota.prazoEntregaDias,
      valorMinimoFrete: rota.valorMinimoFrete,
      cidadeDestino: rota.cidadeDestino,
      ufDestino: rota.ufDestino,
      inicioVigencia,
      fimVigencia,
    });
  });

  cotacoes.forEach((cotacao) => {
    const chave = chaveOrigem(cotacao.origem, canalFinal);
    if (!grupos.has(chave)) grupos.set(chave, { cidade: cotacao.origem, canal: canalFinal, rotas: [], cotacoes: [] });
    grupos.get(chave).cotacoes.push({
      id: cotacao.id,
      rota: cotacao.rota,
      pesoMin: cotacao.pesoMin,
      pesoMax: cotacao.pesoMax,
      valorFixo: cotacao.valorFixo,
      taxaAplicada: cotacao.taxaAplicada,
      excesso: cotacao.excesso,
      percentual: cotacao.percentual,
      freteMinimo: cotacao.freteMinimo,
      regraCalculo: cotacao.regraCalculo,
      tipoCalculo: cotacao.tipoCalculo,
      canal: cotacao.canal,
      inicioVigencia,
      fimVigencia,
    });
  });

  grupos.forEach((grupo) => {
    const origemExistente = (transportadora.origens || []).find((origem) => chaveOrigem(origem.cidade, origem.canal) === chaveOrigem(grupo.cidade, grupo.canal));
    if (origemExistente) {
      origemExistente.rotas = [...(origemExistente.rotas || []), ...grupo.rotas];
      origemExistente.cotacoes = [...(origemExistente.cotacoes || []), ...grupo.cotacoes];
    } else {
      transportadora.origens = [
        ...(transportadora.origens || []),
        {
          id: gerarId('origem'),
          cidade: grupo.cidade,
          canal: grupo.canal,
          status: 'Ativa',
          generalidades: {},
          rotas: grupo.rotas,
          cotacoes: grupo.cotacoes,
          taxasEspeciais: [],
        },
      ];
    }
  });

  return transportadora;
}

export default function ImportarTemplatePage({ store, transportadoras = [] }) {
  const [arquivoRotas, setArquivoRotas] = useState(null);
  const [arquivoFretes, setArquivoFretes] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [formatado, setFormatado] = useState(null);
  const [mostrarPreview, setMostrarPreview] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [modoTransportadora, setModoTransportadora] = useState('nova');
  const [transportadoraExistente, setTransportadoraExistente] = useState('');
  const [novaTransportadora, setNovaTransportadora] = useState('');
  const [canal, setCanal] = useState('B2C');
  const [inicioVigencia, setInicioVigencia] = useState(hojeISO());
  const [fimVigencia, setFimVigencia] = useState(fimTresAnosISO());

  const transportadoraFinal = useMemo(() => {
    if (modoTransportadora === 'existente') {
      const item = transportadoras.find((t) => String(t.id) === String(transportadoraExistente));
      return item?.nome || '';
    }
    return novaTransportadora;
  }, [modoTransportadora, novaTransportadora, transportadoraExistente, transportadoras]);

  async function processarTemplate() {
    try {
      setMensagem('');
      setFormatado(null);
      setMostrarPreview(false);
      const convertido = await importarTemplatePadraoSeparado({ arquivoRotas, arquivoFretes });
      setResultado(convertido);
      setMensagem(`Template lido com sucesso: ${convertido.rotas.length} rota(s), ${convertido.quebrasFaixa.length} quebra(s) e ${convertido.fretes.length} frete(s). Agora clique em Formatar no padrão do sistema.`);
    } catch (error) {
      setResultado(null);
      setFormatado(null);
      setMensagem(error?.message || 'Não foi possível importar o template.');
    }
  }

  function formatarParaSistema() {
    if (!resultado) {
      setMensagem('Leia o template antes de formatar.');
      return;
    }
    if (!normalizarTexto(transportadoraFinal)) {
      setMensagem('Informe uma transportadora nova ou selecione uma transportadora já cadastrada.');
      return;
    }
    const linhas = montarLinhasFormatadas({ resultado, transportadora: transportadoraFinal, canal, inicioVigencia, fimVigencia });
    setFormatado(linhas);
    setMostrarPreview(true);
    setMensagem(`Tabela formatada: ${linhas.rotas.length} rota(s) e ${linhas.cotacoes.length} cotação(ões) prontas para revisar, baixar ou salvar.`);
  }

  function baixarTabelaFormatada() {
    if (!formatado) {
      formatarParaSistema();
      return;
    }
    exportarXlsx(formatado.linhasExportacao, `fretes-formatados-${normalizarTexto(transportadoraFinal || 'transportadora')}.xlsx`, 'Fretes');
  }

  function baixarRotasFormatadas() {
    if (!formatado) {
      formatarParaSistema();
      return;
    }
    exportarXlsx(formatado.linhasRotas, `rotas-formatadas-${normalizarTexto(transportadoraFinal || 'transportadora')}.xlsx`, 'Rotas');
  }

  function salvarNaTransportadora() {
    if (!resultado) {
      setMensagem('Leia o template antes de salvar.');
      return;
    }
    if (!store?.salvarTransportadora) {
      setMensagem('Não encontrei a função de salvar transportadora no store.');
      return;
    }
    if (!normalizarTexto(transportadoraFinal)) {
      setMensagem('Informe uma transportadora nova ou selecione uma transportadora já cadastrada.');
      return;
    }

    const transportadora = montarTransportadorasParaSalvar({
      resultado,
      transportadoraNome: transportadoraFinal,
      canal,
      inicioVigencia,
      fimVigencia,
      transportadorasAtuais: transportadoras,
    });

    store.salvarTransportadora(transportadora);
    setMensagem(`Incluído na transportadora ${transportadora.nome}: ${resultado.rotas.length} rota(s) e ${resultado.fretes.length} cotação(ões).`);
  }

  return (
    <div className="page-shell formatacao-shell">
      <div className="page-top between">
        <div className="page-header">
          <div className="amd-mini-brand">Importação separada</div>
          <h1>Importar Template</h1>
          <p>Use esta tela somente para o template preenchido pelo transportador. A formatação manual continua separada em Formatação de Tabelas.</p>
        </div>
      </div>

      {mensagem ? <div className="formatacao-alert">{mensagem}</div> : null}

      <section className="panel-card formatacao-section">
        <div className="section-header-inline">
          <h3>Modelos oficiais</h3>
          <div className="inline-actions-wrap">
            <button className="btn-secondary" onClick={baixarModeloTemplateRotas}>Baixar modelo de Rotas</button>
            <button className="btn-secondary" onClick={baixarModeloTemplateFretes}>Baixar modelo de Fretes</button>
          </div>
        </div>
        <div className="feature-grid three-cols">
          <div className="info-card compact-info-card"><strong>1. Baixe os modelos</strong><p>Assim você garante que as colunas estão exatamente no padrão que o sistema lê.</p></div>
          <div className="info-card compact-info-card"><strong>2. Preencha Rotas + Fretes</strong><p>Rotas ficam em um arquivo e valores de frete em outro arquivo.</p></div>
          <div className="info-card compact-info-card"><strong>3. Importe e valide</strong><p>Após ler, formate no padrão do sistema e escolha revisar, baixar ou salvar.</p></div>
        </div>
      </section>

      <section className="panel-card formatacao-section">
        <div className="section-header-inline"><h3>Dados para salvar</h3></div>
        <div className="formatacao-grid two">
          <label className="field-block">
            <span>Transportadora</span>
            <select value={modoTransportadora} onChange={(e) => setModoTransportadora(e.target.value)}>
              <option value="nova">Nova transportadora</option>
              <option value="existente">Transportadora já cadastrada</option>
            </select>
          </label>
          {modoTransportadora === 'existente' ? (
            <label className="field-block">
              <span>Selecionar transportadora</span>
              <select value={transportadoraExistente} onChange={(e) => setTransportadoraExistente(e.target.value)}>
                <option value="">Selecione</option>
                {transportadoras.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
              </select>
            </label>
          ) : (
            <label className="field-block">
              <span>Nome da nova transportadora</span>
              <input value={novaTransportadora} onChange={(e) => setNovaTransportadora(e.target.value)} placeholder="Ex.: Transportadora Teste" />
            </label>
          )}
          <label className="field-block">
            <span>Canal</span>
            <select value={canal} onChange={(e) => setCanal(e.target.value)}>
              <option value="B2C">B2C</option>
              <option value="ATACADO">ATACADO</option>
              <option value="INTERCOMPANY">INTERCOMPANY</option>
              <option value="REVERSA">REVERSA</option>
            </select>
          </label>
          <label className="field-block"><span>Início da vigência</span><input type="date" value={inicioVigencia} onChange={(e) => setInicioVigencia(e.target.value)} /></label>
          <label className="field-block"><span>Fim da vigência</span><input type="date" value={fimVigencia} onChange={(e) => setFimVigencia(e.target.value)} /></label>
        </div>
      </section>

      <section className="panel-card formatacao-section">
        <div className="section-header-inline"><h3>Importar arquivos preenchidos</h3></div>
        <div className="formatacao-grid two">
          <label className="field-block"><span>Arquivo de Rotas</span><input type="file" accept=".xlsx,.xls,.xlsb,.csv" onChange={(e) => setArquivoRotas(e.target.files?.[0] || null)} /></label>
          <label className="field-block"><span>Arquivo de Fretes</span><input type="file" accept=".xlsx,.xls,.xlsb,.csv" onChange={(e) => setArquivoFretes(e.target.files?.[0] || null)} /></label>
        </div>
        <div className="inline-actions-wrap compact-top-gap"><button className="btn-primary" onClick={processarTemplate}>Ler template</button></div>
      </section>

      {resultado ? (
        <section className="panel-card formatacao-section">
          <div className="section-header-inline"><h3>Prévia da leitura</h3></div>
          <div className="feature-grid three-cols">
            <div className="info-card compact-info-card"><strong>Rotas</strong><p>{resultado.rotas.length}</p></div>
            <div className="info-card compact-info-card"><strong>Quebras</strong><p>{resultado.quebrasFaixa.length}</p></div>
            <div className="info-card compact-info-card"><strong>Fretes lidos</strong><p>{resultado.fretes.length}</p></div>
          </div>
          <div className="inline-actions-wrap compact-top-gap">
            <button className="btn-primary" onClick={formatarParaSistema}>Formatar no padrão do sistema</button>
            <button className="btn-secondary" onClick={() => setMostrarPreview((prev) => !prev)}>{mostrarPreview ? 'Recolher revisão' : 'Visualizar tabela formatada'}</button>
            <button className="btn-secondary" onClick={baixarRotasFormatadas}>Baixar rotas formatadas</button>
            <button className="btn-secondary" onClick={baixarTabelaFormatada}>Baixar fretes formatados</button>
            <button className="btn-primary" onClick={salvarNaTransportadora}>Salvar/Incluir na transportadora</button>
          </div>
        </section>
      ) : null}

      {formatado && mostrarPreview ? (
        <section className="panel-card formatacao-section">
          <div className="section-header-inline"><h3>Revisão da tabela formatada</h3><span>{formatado.cotacoes.length} cotação(ões)</span></div>
          <div className="table-scroll">
            <table className="basic-table compact-table fretes-table">
              <thead><tr><th>Rota</th><th>Faixa</th><th>Peso inicial</th><th>Peso final</th><th>Taxa aplicada</th><th>% Frete / Ad Valorem</th><th>Vigência</th></tr></thead>
              <tbody>
                {formatado.cotacoes.slice(0, 100).map((item) => (
                  <tr key={item.id}>
                    <td>{item.rota}</td>
                    <td>{item.faixaPeso}</td>
                    <td>{numeroOuVazio(item.pesoMin)}</td>
                    <td>{numeroOuVazio(item.pesoMax)}</td>
                    <td>{numeroOuVazio(item.valorFixo)}</td>
                    <td>{numeroOuVazio(item.percentual)}</td>
                    <td>{inicioVigencia} até {fimVigencia}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {formatado.cotacoes.length > 100 ? <div className="empty-note">Mostrando as primeiras 100 linhas para não deixar a tela pesada.</div> : null}
        </section>
      ) : null}
    </div>
  );
}
