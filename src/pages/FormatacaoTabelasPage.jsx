import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  adicionarModeloFaixa,
  aplicarCotacaoPadraoNasRotas,
  atualizarModeloFaixa,
  baixarArquivoTexto,
  carregarBaseIbge,
  carregarModelosFaixa,
  carregarRascunhos,
  construirCadastroBase,
  criarFormularioInicial,
  criarQuebraFaixaInicial,
  criarRotaInicial,
  encontrarMunicipioPorNome,
  encontrarOrigemExistente,
  encontrarTransportadoraExistente,
  exportarLinhasParaXlsx,
  gerarFretesPorCotacaoFaixa,
  proximoCodigoOrigem,
  salvarBaseIbge,
  salvarModelosFaixa,
  salvarRascunhos,
  validarModeloFaixa,
} from '../utils/formatacaoTabela';
import { converterTemplatePrecificacaoParaFretes, converterWorkbookTemplateParaEstrutura } from '../utils/templatePrecificacao';
import { importarTemplatePadraoSeparado } from '../utils/importadorTemplatePadrao';

const COTACOES_BASE = [
  'Capital',
  'Metropolitana',
  'Interior 1',
  'Interior 2',
  'Interior 3',
  'Interior 4',
  'Interior 5',
  'Interior 6',
  'Interior 7',
  'Interior 8',
  'Interior 9',
];

function lerPlanilhaComoMatriz(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = event.target.result;
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        resolve(rows);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}


function lerWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = event.target.result;
        const workbook = XLSX.read(data, { type: 'array' });
        resolve(workbook);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function lerPlanilhaComoObjetos(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = event.target.result;
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        resolve(rows);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function tituloArquivo(form) {
  const partes = [form.transportadoraNome, form.origemNome, form.canal].filter(Boolean);
  return partes.join('-').replace(/\s+/g, '_') || 'formatacao';
}

export default function FormatacaoTabelasPage({ transportadoras = [] }) {
  const cadastros = useMemo(() => construirCadastroBase(transportadoras), [transportadoras]);
  const [form, setForm] = useState(criarFormularioInicial());
  const [rotas, setRotas] = useState([criarRotaInicial()]);
  const [quebras, setQuebras] = useState([criarQuebraFaixaInicial()]);
  const [fretes, setFretes] = useState([]);
  const [rascunhos, setRascunhos] = useState(() => carregarRascunhos());
  const [baseIbge, setBaseIbge] = useState(() => carregarBaseIbge());
  const [modelosFaixa, setModelosFaixa] = useState(() => carregarModelosFaixa());
  const [faixaEditando, setFaixaEditando] = useState(null);
  const [mensagem, setMensagem] = useState('');
  const [arquivoRotasTemplate, setArquivoRotasTemplate] = useState(null);
  const [arquivoFretesTemplate, setArquivoFretesTemplate] = useState(null);

  const rotasPadronizadas = useMemo(() => aplicarCotacaoPadraoNasRotas(rotas, form, baseIbge), [rotas, form, baseIbge]);
  const modeloFaixaSelecionado = useMemo(() => modelosFaixa.find((item) => item.id === form.modeloFaixaId) || null, [modelosFaixa, form.modeloFaixaId]);

  useEffect(() => {
    if (!baseIbge.length) return;
    const municipio = form.origemNome ? encontrarMunicipioPorNome(baseIbge, form.origemNome) : null;
    setForm((prev) => {
      const novoIbge = municipio?.codigo_municipio_completo || municipio?.codigo || municipio?.ibge || '';
      if (prev.origemIbge === novoIbge) return prev;
      return { ...prev, origemIbge: novoIbge };
    });
  }, [form.origemNome, baseIbge]);

  function atualizarCampo(campo, valor) {
    setForm((prev) => {
      const proximo = { ...prev, [campo]: valor };
      if (campo === 'origemNome') {
        const municipio = valor ? encontrarMunicipioPorNome(baseIbge, valor) : null;
        proximo.origemIbge = municipio?.codigo_municipio_completo || municipio?.codigo || municipio?.ibge || '';
      }

      if (campo === 'canal') {
        const canal = String(valor || '').toUpperCase();
        const modeloAtual = modelosFaixa.find((item) => item.id === prev.modeloFaixaId);
        const modeloAtualNaoCombina = modeloAtual?.canal && String(modeloAtual.canal).toUpperCase() !== canal;
        if (modeloAtualNaoCombina || !prev.modeloFaixaId) {
          const modeloDoCanal = modelosFaixa.find((item) => String(item.canal || '').toUpperCase() === canal);
          if (modeloDoCanal) proximo.modeloFaixaId = modeloDoCanal.id;
        }
      }

      return proximo;
    });
  }

  function selecionarTransportadora(id) {
    const existente = encontrarTransportadoraExistente(cadastros, id);
    setForm((prev) => ({
      ...prev,
      transportadoraId: existente?.id || '',
      transportadoraNome: existente?.nome || '',
    }));
  }

  function selecionarOrigem(id) {
    const origem = encontrarOrigemExistente(cadastros, id);
    if (!origem) return;
    setForm((prev) => ({
      ...prev,
      origemId: origem.id,
      origemNome: origem.nome,
      codigoOrigem: origem.codigo,
      origemIbge: origem.ibge,
      canal: origem.canal || prev.canal,
    }));
  }

  function adicionarRota() {
    setRotas((prev) => [...prev, criarRotaInicial()]);
  }

  function atualizarRota(id, campo, valor) {
    setRotas((prev) => prev.map((item) => (item.id === id ? { ...item, [campo]: valor } : item)));
  }

  function removerRota(id) {
    setRotas((prev) => (prev.length === 1 ? prev : prev.filter((item) => item.id !== id)));
  }

  function adicionarQuebra() {
    setQuebras((prev) => [...prev, criarQuebraFaixaInicial()]);
  }

  function atualizarQuebra(id, campo, valor) {
    setQuebras((prev) => prev.map((item) => (item.id === id ? { ...item, [campo]: valor } : item)));
  }

  function removerQuebra(id) {
    setQuebras((prev) => (prev.length === 1 ? prev : prev.filter((item) => item.id !== id)));
  }

  function gerarFretes() {
    const linhas = gerarFretesPorCotacaoFaixa({
      rotas,
      dadosGerais: form,
      baseIbge,
      tipoCalculo: form.tipoCalculo,
      modeloFaixa: modeloFaixaSelecionado,
    });
    setFretes(linhas);
    setMensagem(`Fretes gerados: ${linhas.length} linha(s).`);
  }

  function atualizarFrete(index, campo, valor) {
    setFretes((prev) => prev.map((item, idx) => (idx === index ? { ...item, [campo]: valueOrBlank(valor) } : item)));
  }

  function valueOrBlank(valor) {
    return valor ?? '';
  }

  function aplicarEmMassa(campo, valor, filtroCotacao = '') {
    setFretes((prev) => prev.map((item) => (!filtroCotacao || item.cotacao === filtroCotacao ? { ...item, [campo]: valor } : item)));
  }

  async function importarBaseIbge(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const rows = await lerPlanilhaComoObjetos(file);
    const baseNormalizada = rows.map((row) => ({
      codigo_municipio_completo: row['Código Município Completo'] || row['codigo_municipio_completo'] || row['Código Município'] || row['Município'] || row['codigo'],
      nome_municipio: row['Nome_Município'] || row['Município'] || row['nome_municipio'] || row['nome'],
      nome_municipio_sem_acento: row['Nome_Município Sem acento'] || row['nome_municipio_sem_acento'] || '',
      uf: row.UF || row['Sigla UF'] || row.sigla_uf || '',
    })).filter((item) => item.codigo_municipio_completo && item.uf);
    setBaseIbge(baseNormalizada);
    salvarBaseIbge(baseNormalizada);
    setMensagem(`Base IBGE carregada com ${baseNormalizada.length} município(s).`);
  }

  async function importarRotas(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const rows = await lerPlanilhaComoObjetos(file);
    const novasRotas = rows
      .filter((row) => row['IBGE DESTINO'] || row['ibgeDestino'] || row['IBGE'] || row['PRAZO'] || row['prazo'] || row['COTAÇÃO'] || row['Cotação'] || row['cotacaoBase'])
      .map((row) => ({
        ...criarRotaInicial(),
        ibgeDestino: row['IBGE DESTINO'] || row['ibgeDestino'] || row['IBGE'] || '',
        prazo: row['PRAZO'] || row['prazo'] || '',
        cotacaoBase: row['COTAÇÃO'] || row['Cotação'] || row['cotacaoBase'] || 'Interior 1',
      }))
      .filter((item) => item.ibgeDestino || item.prazo);
    if (novasRotas.length) setRotas(novasRotas);
    setMensagem(`Rotas importadas: ${novasRotas.length}.`);
  }

  async function importarQuebras(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const rows = await lerPlanilhaComoObjetos(file);
    const novas = rows.map((row) => ({
      ...criarQuebraFaixaInicial(),
      ibgeDestino: row['IBGE DESTINO'] || row['ibgeDestino'] || row['IBGE'] || '',
      prazo: row['PRAZO'] || row['prazo'] || '',
      cotacaoBase: row['COTAÇÃO'] || row['Cotação'] || row['cotacaoBase'] || 'Interior 1',
      cepInicial: row['CEP INICIAL'] || row['cepInicial'] || row['cep_inicial'] || '',
      cepFinal: row['CEP FINAL'] || row['cepFinal'] || row['cep_final'] || '',
    })).filter((item) => item.ibgeDestino || item.cepInicial || item.cepFinal);
    if (novas.length) setQuebras(novas);
    setMensagem(`Quebras importadas: ${novas.length}.`);
  }


  async function importarTemplateSeparado() {
    try {
      if (!arquivoRotasTemplate || !arquivoFretesTemplate) {
        setMensagem('Selecione o arquivo de Rotas e o arquivo de Fretes do template.');
        return;
      }

      const convertido = await importarTemplatePadraoSeparado({
        arquivoRotas: arquivoRotasTemplate,
        arquivoFretes: arquivoFretesTemplate,
        dadosGerais: form,
      });

      if (convertido.dadosGeraisPatch?.origemNome || convertido.dadosGeraisPatch?.origemIbge) {
        setForm((prev) => ({
          ...prev,
          origemModo: prev.origemModo || 'novo',
          origemNome: convertido.dadosGeraisPatch?.origemNome || prev.origemNome,
          origemIbge: convertido.dadosGeraisPatch?.origemIbge || prev.origemIbge,
        }));
      }

      if (convertido.rotas.length) setRotas(convertido.rotas);
      if (convertido.quebrasFaixa.length) setQuebras(convertido.quebrasFaixa);
      if (convertido.fretes.length) setFretes(convertido.fretes);

      setMensagem(`Template separado importado: ${convertido.rotas.length} rota(s), ${convertido.quebrasFaixa.length} quebra(s) e ${convertido.fretes.length} frete(s).`);
    } catch (error) {
      setMensagem(error?.message || 'Erro ao importar template separado.');
    }
  }

  async function importarTemplatePrecificacao(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const workbook = await lerWorkbook(file);
    const possuiRotas = (workbook.SheetNames || []).some((nome) => nome.toUpperCase() === 'ROTAS');
    const possuiFretes = (workbook.SheetNames || []).some((nome) => nome.toUpperCase() === 'FRETES');

    if (possuiRotas || possuiFretes) {
      const convertido = converterWorkbookTemplateParaEstrutura({
        XLSX,
        workbook,
        dadosGerais: form,
      });

      if (convertido.dadosGeraisPatch?.origemNome || convertido.dadosGeraisPatch?.origemIbge) {
        setForm((prev) => ({
          ...prev,
          origemNome: convertido.dadosGeraisPatch?.origemNome || prev.origemNome,
          origemIbge: convertido.dadosGeraisPatch?.origemIbge || prev.origemIbge,
        }));
      }

      if (convertido.rotas.length) setRotas(convertido.rotas);
      if (convertido.quebras.length) setQuebras(convertido.quebras);
      if (convertido.fretes.length) setFretes(convertido.fretes);

      setMensagem(`Template importado com sucesso: ${convertido.rotas.length} rota(s), ${convertido.quebras.length} quebra(s) e ${convertido.fretes.length} frete(s).`);
      event.target.value = '';
      return;
    }

    const linhas = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' });
    const convertidos = converterTemplatePrecificacaoParaFretes({ linhas, dadosGerais: form });
    setFretes(convertidos);
    setMensagem(`Template importado: ${convertidos.length} linha(s) de frete.`);
    event.target.value = '';
  }

  function exportarModeloRotas() {
    exportarLinhasParaXlsx(XLSX, [{ 'IBGE DESTINO': '', PRAZO: '', 'COTAÇÃO': '' }], `${tituloArquivo(form)}-modelo-rotas.xlsx`, 'Rotas');
  }

  function exportarModeloQuebras() {
    exportarLinhasParaXlsx(XLSX, [{ 'IBGE DESTINO': '', PRAZO: '', 'COTAÇÃO': '', 'CEP INICIAL': '', 'CEP FINAL': '' }], `${tituloArquivo(form)}-modelo-quebra-faixas.xlsx`, 'Quebras');
  }

  function exportarModeloFretes() {
    const linhas = form.tipoCalculo === 'PERCENTUAL'
      ? [{ COTAÇÃO: '', 'FRETE %': '', 'FRETE MÍNIMO': '', 'TAXA APLICADA': '', EXCEDENTE: '' }]
      : [{ COTAÇÃO: '', FAIXA: '', 'PESO INICIAL': '', 'PESO FINAL': '', 'FRETE VALOR': '', 'AD VALOREM %': '', 'FRETE MÍNIMO': '', 'TAXA APLICADA': '', EXCEDENTE: '' }];
    exportarLinhasParaXlsx(XLSX, linhas, `${tituloArquivo(form)}-modelo-fretes.xlsx`, 'Fretes');
  }

  function exportarRotas() {
    const linhas = rotasPadronizadas.map((item) => ({
      'NOME TRANSPORTADORA': form.transportadoraNome,
      'CÓDIGO UNIDADE': form.codigoOrigem,
      CANAL: form.canal,
      COTAÇÃO: item.cotacaoFinal,
      'IBGE ORIGEM': form.origemIbge,
      'IBGE DESTINO': item.ibgeDestino,
      PRAZO: item.prazo,
      'DATA INÍCIO': form.vigenciaInicial,
      'DATA FIM': form.vigenciaFinal,
    }));
    exportarLinhasParaXlsx(XLSX, linhas, `${tituloArquivo(form)}-rotas.xlsx`, 'Prazos de frete');
  }

  function exportarFretes() {
    const isFaixa = form.tipoCalculo === 'FAIXA_PESO';
    const linhas = fretes.map((item) => {
      const taxaFaixa = item.taxaAplicada || item.freteValor || '';
      return {
        'NOME TRANSPORTADORA': form.transportadoraNome,
        'CÓDIGO UNIDADE': form.codigoOrigem,
        CANAL: form.canal,
        'REGRA DE CÁLCULO': form.regraCalculo,
        'TIPO DE CÁLCULO': form.tipoCalculo,
        'ROTA DO FRETE': item.cotacao,
        'PESO INICIAL': item.pesoInicial,
        'PESO FINAL': item.pesoFinal,
        // Na tabela por faixa, o valor da faixa precisa sair em TAXA APLICADA.
        // FRETE VALOR e FRETE MÍNIMO ficam vazios para não confundir a importação Verum.
        'FRETE VALOR': isFaixa ? '' : item.freteValor,
        'AD VALOREM %': item.fretePercentual,
        'FRETE MÍNIMO': isFaixa ? '' : item.freteMinimo,
        'TAXA APLICADA': isFaixa ? taxaFaixa : item.taxaAplicada,
        EXCEDENTE: item.excedente,
        'DATA INÍCIO': form.vigenciaInicial,
        'DATA FIM': form.vigenciaFinal,
      };
    });
    exportarLinhasParaXlsx(XLSX, linhas, `${tituloArquivo(form)}-fretes.xlsx`, 'Valores de frete');
  }

  function gerarPacoteCompleto() {
    exportarRotas();
    setTimeout(() => exportarFretes(), 400);
    setMensagem('Arquivos de rotas e fretes gerados separadamente.');
  }

  function salvarRascunhoAtual() {
    const registro = { form, rotas, quebras, fretes };
    const novaLista = [registro, ...rascunhos.filter((item) => item.form.id !== form.id)];
    setRascunhos(novaLista);
    salvarRascunhos(novaLista);
    setMensagem('Rascunho salvo com sucesso.');
  }

  function carregarRascunho(item) {
    setForm(item.form);
    setRotas(item.rotas?.length ? item.rotas : [criarRotaInicial()]);
    setQuebras(item.quebras?.length ? item.quebras : [criarQuebraFaixaInicial()]);
    setFretes(item.fretes || []);
    setMensagem(`Rascunho carregado: ${item.form.nomeFormatacao || item.form.transportadoraNome}.`);
  }

  function iniciarNovaFaixa() {
    setFaixaEditando({ id: '', nome: '', canal: form.canal, itens: [{ id: `tmp-${Date.now()}`, pesoInicial: 0, pesoFinal: 0 }] });
  }

  function editarFaixaExistente(id) {
    const modelo = modelosFaixa.find((item) => item.id === id);
    if (modelo) setFaixaEditando(JSON.parse(JSON.stringify(modelo)));
  }

  function salvarFaixaEditada() {
    const erros = validarModeloFaixa(faixaEditando);
    if (erros.length) {
      setMensagem(erros[0]);
      return;
    }
    let proximos = modelosFaixa;
    if (faixaEditando.id) {
      proximos = atualizarModeloFaixa(modelosFaixa, faixaEditando);
    } else {
      proximos = adicionarModeloFaixa(modelosFaixa, faixaEditando);
    }
    setModelosFaixa(proximos);
    salvarModelosFaixa(proximos);
    setForm((prev) => ({ ...prev, modeloFaixaId: (faixaEditando.id || proximos[proximos.length - 1].id) }));
    setFaixaEditando(null);
    setMensagem('Modelo de faixa salvo.');
  }

  function atualizarItemFaixa(index, campo, valor) {
    setFaixaEditando((prev) => ({
      ...prev,
      itens: prev.itens.map((item, idx) => (idx === index ? { ...item, [campo]: valor } : item)),
    }));
  }

  function adicionarItemFaixa() {
    setFaixaEditando((prev) => ({ ...prev, itens: [...prev.itens, { id: `tmp-${Date.now()}-${prev.itens.length}`, pesoInicial: '', pesoFinal: '' }] }));
  }

  function preencherOrigemNova() {
    setForm((prev) => ({ ...prev, codigoOrigem: proximoCodigoOrigem(cadastros) }));
  }

  const acoesMassaRef = useRef({ campo: 'freteValor', valor: '', cotacao: '' });

  return (
    <div className="page-shell formatacao-shell">
      <div className="page-top between">
        <div className="page-header">
          <div className="amd-mini-brand">Cadastro guiado</div>
          <h1>Formatação de Tabelas</h1>
          <p>Monte rotas e fretes sem mexer no simulador principal. Agora com faixa de peso, cotação com UF destino e importação do template padrão com Rotas + Fretes.</p>
        </div>
        <div className="formatacao-actions-top">
          <button className="btn-secondary" onClick={salvarRascunhoAtual}>Salvar rascunho</button>
          <button className="btn-primary" onClick={gerarPacoteCompleto}>Gerar pacote completo</button>
        </div>
      </div>

      {mensagem ? <div className="formatacao-alert">{mensagem}</div> : null}

      <section className="panel-card formatacao-section">
        <div className="section-header-inline">
          <h3>Dados gerais</h3>
          <div className="hint-line">IBGE de origem automático pela cidade usando a base IBGE fixa do sistema.</div>
        </div>
        <div className="formatacao-grid three">
          <label className="field-block">
            <span>Transportadora</span>
            <select value={form.transportadoraModo} onChange={(e) => { atualizarCampo('transportadoraModo', e.target.value); if (e.target.value === 'novo') atualizarCampo('transportadoraId', ''); }}>
              <option value="existente">Existente</option>
              <option value="novo">Novo cadastro</option>
            </select>
          </label>
          {form.transportadoraModo === 'existente' ? (
            <label className="field-block">
              <span>Lista de transportadoras</span>
              <select value={form.transportadoraId} onChange={(e) => selecionarTransportadora(e.target.value)}>
                <option value="">Selecione</option>
                {cadastros.transportadoras.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
              </select>
            </label>
          ) : (
            <label className="field-block">
              <span>Nova transportadora</span>
              <input value={form.transportadoraNome} onChange={(e) => atualizarCampo('transportadoraNome', e.target.value)} />
            </label>
          )}
          <label className="field-block">
            <span>Nome da formatação</span>
            <input value={form.nomeFormatacao} onChange={(e) => atualizarCampo('nomeFormatacao', e.target.value)} placeholder="Ex.: Itajaí | Atacado" />
          </label>

          <label className="field-block">
            <span>Origem</span>
            <select value={form.origemModo} onChange={(e) => {
              atualizarCampo('origemModo', e.target.value);
              if (e.target.value === 'novo') preencherOrigemNova();
            }}>
              <option value="existente">Existente</option>
              <option value="novo">Nova origem</option>
            </select>
          </label>
          {form.origemModo === 'existente' ? (
            <label className="field-block">
              <span>Lista de origens</span>
              <select value={form.origemId} onChange={(e) => selecionarOrigem(e.target.value)}>
                <option value="">Selecione</option>
                {cadastros.origens.map((item) => <option key={item.id} value={item.id}>{item.nome} - {item.canal}</option>)}
              </select>
            </label>
          ) : (
            <label className="field-block">
              <span>Nova origem</span>
              <input value={form.origemNome} onChange={(e) => atualizarCampo('origemNome', e.target.value)} placeholder="Ex.: Itajaí" />
            </label>
          )}
          <label className="field-block readonly-field">
            <span>Código unidade</span>
            <input value={form.codigoOrigem} readOnly />
          </label>

          <label className="field-block readonly-field">
            <span>IBGE origem</span>
            <input value={form.origemIbge} readOnly />
          </label>
          <label className="field-block">
            <span>Canal</span>
            <select value={form.canal} onChange={(e) => atualizarCampo('canal', e.target.value)}>
              <option value="ATACADO">ATACADO</option>
              <option value="B2C">B2C</option>
              <option value="INTERCOMPANY">INTERCOMPANY</option>
            </select>
          </label>
          <label className="field-block">
            <span>Método de envio</span>
            <select value={form.metodoEnvio} onChange={(e) => atualizarCampo('metodoEnvio', e.target.value)}>
              <option>Normal</option>
              <option>Expresso</option>
            </select>
          </label>
          <label className="field-block">
            <span>Regra de cálculo</span>
            <select value={form.regraCalculo} onChange={(e) => atualizarCampo('regraCalculo', e.target.value)}>
              <option>Sem regra</option>
              <option>Maior valor</option>
              <option>Menor valor</option>
            </select>
          </label>
          <label className="field-block">
            <span>Tipo de cálculo</span>
            <select value={form.tipoCalculo} onChange={(e) => atualizarCampo('tipoCalculo', e.target.value)}>
              <option value="FAIXA_PESO">Faixa de peso</option>
              <option value="PERCENTUAL">Percentual</option>
            </select>
          </label>
          {form.tipoCalculo === 'FAIXA_PESO' ? (
            <>
              <label className="field-block">
                <span>Modelo de faixa</span>
                <select value={form.modeloFaixaId} onChange={(e) => atualizarCampo('modeloFaixaId', e.target.value)}>
                  {modelosFaixa.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
                </select>
              </label>
              <div className="field-block button-stack">
                <span>Ações da faixa</span>
                <div className="inline-actions-wrap">
                  <button className="btn-secondary" onClick={iniciarNovaFaixa}>Nova faixa</button>
                  <button className="btn-secondary" onClick={() => editarFaixaExistente(form.modeloFaixaId)}>Alterar faixa</button>
                </div>
              </div>
            </>
          ) : null}
          <label className="field-block">
            <span>Vigência inicial</span>
            <input type="date" value={form.vigenciaInicial} onChange={(e) => atualizarCampo('vigenciaInicial', e.target.value)} />
          </label>
          <label className="field-block">
            <span>Vigência final</span>
            <input type="date" value={form.vigenciaFinal} onChange={(e) => atualizarCampo('vigenciaFinal', e.target.value)} />
          </label>
          <div className="field-block button-stack">
            <span>Base IBGE</span>
            <input type="file" accept=".xlsx,.xls,.xlsb,.csv" onChange={importarBaseIbge} />
          </div>
        </div>
      </section>

      {faixaEditando ? (
        <section className="panel-card formatacao-section">
          <div className="section-header-inline">
            <h3>Cadastro de faixa de peso</h3>
            <button className="btn-link" onClick={() => setFaixaEditando(null)}>Fechar</button>
          </div>
          <div className="formatacao-grid three">
            <label className="field-block"><span>Nome do modelo</span><input value={faixaEditando.nome} onChange={(e) => setFaixaEditando((prev) => ({ ...prev, nome: e.target.value }))} /></label>
            <label className="field-block"><span>Canal</span><select value={faixaEditando.canal} onChange={(e) => setFaixaEditando((prev) => ({ ...prev, canal: e.target.value }))}><option value="ATACADO">ATACADO</option><option value="B2C">B2C</option></select></label>
            <div className="field-block button-stack"><span>Ações</span><div className="inline-actions-wrap"><button className="btn-secondary" onClick={adicionarItemFaixa}>Adicionar linha</button><button className="btn-primary" onClick={salvarFaixaEditada}>Salvar faixa</button></div></div>
          </div>
          <div className="table-card compact-card">
            <table className="basic-table compact-table">
              <thead><tr><th>Peso inicial</th><th>Peso final</th></tr></thead>
              <tbody>
                {faixaEditando.itens.map((item, index) => (
                  <tr key={item.id}>
                    <td><input value={item.pesoInicial} onChange={(e) => atualizarItemFaixa(index, 'pesoInicial', e.target.value)} /></td>
                    <td><input value={item.pesoFinal} onChange={(e) => atualizarItemFaixa(index, 'pesoFinal', e.target.value)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="panel-card formatacao-section">
        <div className="section-header-inline">
          <h3>1. Importar template recebido</h3>
          <div className="hint-line">Fluxo separado para o modelo enviado ao transportador: selecione Rotas + Fretes e o sistema monta as linhas sem misturar com o cadastro passo a passo.</div>
        </div>
        <div className="feature-grid three-cols">
          <div className="info-card compact-info-card">
            <strong>Arquivo de Rotas</strong>
            <p>Planilha preenchida com IBGE destino, UF destino, prazo, região/cotação e CEP quando existir.</p>
            <label className="btn-secondary file-button">
              <input type="file" accept=".xlsx,.xls,.xlsb,.csv" onChange={(e) => setArquivoRotasTemplate(e.target.files?.[0] || null)} />
              Selecionar Rotas
            </label>
            <small>{arquivoRotasTemplate?.name || 'Nenhum arquivo selecionado'}</small>
          </div>
          <div className="info-card compact-info-card">
            <strong>Arquivo de Fretes</strong>
            <p>Planilha de precificação com faixas, frete kg/taxa aplicada, ad valorem e excedente.</p>
            <label className="btn-secondary file-button">
              <input type="file" accept=".xlsx,.xls,.xlsb,.csv" onChange={(e) => setArquivoFretesTemplate(e.target.files?.[0] || null)} />
              Selecionar Fretes
            </label>
            <small>{arquivoFretesTemplate?.name || 'Nenhum arquivo selecionado'}</small>
          </div>
          <div className="info-card compact-info-card">
            <strong>Resultado</strong>
            <p>Depois de importar, revise as rotas e fretes abaixo e gere o pacote final Verum.</p>
            <button className="btn-primary" onClick={importarTemplateSeparado}>Importar Rotas + Fretes</button>
          </div>
        </div>
      </section>

      <section className="panel-card formatacao-section">
        <div className="section-header-inline">
          <h3>Rotas</h3>
          <div className="inline-actions-wrap">
            <button className="btn-secondary" onClick={exportarModeloRotas}>Exportar modelo</button>
            <label className="btn-secondary file-button"><input type="file" accept=".xlsx,.xls,.xlsb,.csv" onChange={importarRotas} />Importar rotas</label>
            <button className="btn-secondary" onClick={adicionarRota}>Adicionar rota</button>
          </div>
        </div>
        <div className="table-card compact-card">
          <table className="basic-table compact-table">
            <thead><tr><th>IBGE destino</th><th>Prazo</th><th>Cotação base</th><th>Cotação final</th><th /></tr></thead>
            <tbody>
              {rotasPadronizadas.map((item) => (
                <tr key={item.id}>
                  <td><input value={item.ibgeDestino} onChange={(e) => atualizarRota(item.id, 'ibgeDestino', e.target.value)} /></td>
                  <td><input value={item.prazo} onChange={(e) => atualizarRota(item.id, 'prazo', e.target.value)} /></td>
                  <td>
                    <select value={item.cotacaoBase} onChange={(e) => atualizarRota(item.id, 'cotacaoBase', e.target.value)}>
                      {Array.from(new Set([item.cotacaoBase, ...COTACOES_BASE].filter(Boolean))).map((op) => <option key={op}>{op}</option>)}
                    </select>
                  </td>
                  <td>{item.cotacaoFinal}</td>
                  <td><button className="btn-link" onClick={() => removerRota(item.id)}>Remover</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel-card formatacao-section">
        <div className="section-header-inline">
          <h3>Quebra de faixas</h3>
          <div className="inline-actions-wrap">
            <button className="btn-secondary" onClick={exportarModeloQuebras}>Exportar modelo</button>
            <label className="btn-secondary file-button"><input type="file" accept=".xlsx,.xls,.xlsb,.csv" onChange={importarQuebras} />Importar quebra</label>
            <button className="btn-secondary" onClick={adicionarQuebra}>Adicionar linha</button>
          </div>
        </div>
        <div className="table-card compact-card">
          <table className="basic-table compact-table">
            <thead><tr><th>IBGE destino</th><th>Prazo</th><th>Cotação base</th><th>CEP inicial</th><th>CEP final</th><th /></tr></thead>
            <tbody>
              {quebras.map((item) => (
                <tr key={item.id}>
                  <td><input value={item.ibgeDestino} onChange={(e) => atualizarQuebra(item.id, 'ibgeDestino', e.target.value)} /></td>
                  <td><input value={item.prazo} onChange={(e) => atualizarQuebra(item.id, 'prazo', e.target.value)} /></td>
                  <td><select value={item.cotacaoBase} onChange={(e) => atualizarQuebra(item.id, 'cotacaoBase', e.target.value)}>{Array.from(new Set([item.cotacaoBase, ...COTACOES_BASE].filter(Boolean))).map((op) => <option key={op}>{op}</option>)}</select></td>
                  <td><input value={item.cepInicial} onChange={(e) => atualizarQuebra(item.id, 'cepInicial', e.target.value)} /></td>
                  <td><input value={item.cepFinal} onChange={(e) => atualizarQuebra(item.id, 'cepFinal', e.target.value)} /></td>
                  <td><button className="btn-link" onClick={() => removerQuebra(item.id)}>Remover</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel-card formatacao-section">
        <div className="section-header-inline">
          <h3>Fretes</h3>
          <div className="inline-actions-wrap">
            <button className="btn-primary" onClick={gerarFretes}>Aplicar faixas e gerar fretes</button>
            <button className="btn-secondary" onClick={exportarModeloFretes}>Exportar modelo</button>
            <label className="btn-secondary file-button"><input type="file" accept=".xlsx,.xls,.xlsb,.ods,.csv" onChange={importarTemplatePrecificacao} />Importar template de precificação</label>
          </div>
        </div>

        <div className="feature-grid three-cols">
          <div className="info-card compact-info-card">
            <strong>Modelo atual</strong>
            <p>Continue exportando o modelo padrão para preenchimento manual.</p>
          </div>
          <div className="info-card compact-info-card">
            <strong>Faixa aplicada</strong>
            <p>{form.tipoCalculo === 'FAIXA_PESO' ? (modeloFaixaSelecionado?.nome || 'Nenhuma') : 'Não se aplica para percentual'}</p>
          </div>
          <div className="info-card compact-info-card">
            <strong>Template pronto</strong>
            <p>Importe a planilha já precificada para autoformatar os fretes.</p>
          </div>
        </div>

        <div className="massa-box">
          <strong>Preenchimento em massa</strong>
          <div className="formatacao-grid four compact-top-gap">
            <select defaultValue="freteValor" onChange={(e) => { acoesMassaRef.current.campo = e.target.value; }}>
              <option value="freteValor">Frete valor</option>
              <option value="fretePercentual">Ad valorem %</option>
              <option value="freteMinimo">Frete mínimo</option>
              <option value="taxaAplicada">Taxa aplicada</option>
              <option value="excedente">Excedente</option>
            </select>
            <input placeholder="Valor" onChange={(e) => { acoesMassaRef.current.valor = e.target.value; }} />
            <select defaultValue="" onChange={(e) => { acoesMassaRef.current.cotacao = e.target.value; }}>
              <option value="">Todas as cotações</option>
              {Array.from(new Set(fretes.map((item) => item.cotacao).filter(Boolean))).map((item) => <option key={item}>{item}</option>)}
            </select>
            <button className="btn-secondary" onClick={() => aplicarEmMassa(acoesMassaRef.current.campo, acoesMassaRef.current.valor, acoesMassaRef.current.cotacao)}>Aplicar</button>
          </div>
        </div>

        <div className="table-card compact-card">
          <table className="basic-table compact-table fretes-table">
            <thead>
              <tr>
                <th>Cotação</th><th>Faixa</th><th>Peso inicial</th><th>Peso final</th><th>Frete valor</th><th>Ad valorem %</th><th>Frete mínimo</th><th>Taxa aplicada</th><th>Excedente</th><th>Origem</th>
              </tr>
            </thead>
            <tbody>
              {fretes.map((item, index) => (
                <tr key={`${item.cotacao}-${index}`}>
                  <td>{item.cotacao}</td>
                  <td>{item.faixaNome}</td>
                  <td>{item.pesoInicial}</td>
                  <td>{item.pesoFinal}</td>
                  <td><input value={item.freteValor} onChange={(e) => atualizarFrete(index, 'freteValor', e.target.value)} /></td>
                  <td><input value={item.fretePercentual} onChange={(e) => atualizarFrete(index, 'fretePercentual', e.target.value)} /></td>
                  <td><input value={item.freteMinimo} onChange={(e) => atualizarFrete(index, 'freteMinimo', e.target.value)} /></td>
                  <td><input value={item.taxaAplicada} onChange={(e) => atualizarFrete(index, 'taxaAplicada', e.target.value)} /></td>
                  <td><input value={item.excedente} onChange={(e) => atualizarFrete(index, 'excedente', e.target.value)} /></td>
                  <td>{item.origemImportacao}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel-card formatacao-section">
        <div className="section-header-inline">
          <h3>Rascunhos salvos</h3>
        </div>
        <div className="list-card compact-list-card">
          {(rascunhos || []).length ? rascunhos.map((item, index) => (
            <button key={`${item.form.id}-${index}`} className="draft-item" onClick={() => carregarRascunho(item)}>
              <strong>{item.form.nomeFormatacao || `${item.form.transportadoraNome} - ${item.form.origemNome}`}</strong>
              <span>{item.form.canal} | {item.form.tipoCalculo}</span>
            </button>
          )) : <div className="empty-note">Nenhum rascunho salvo ainda.</div>}
        </div>
      </section>
    </div>
  );
}
