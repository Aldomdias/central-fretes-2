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
import { converterTemplatePrecificacaoParaFretes } from '../utils/templatePrecificacao';

const COTACOES_BASE = ['Capital', 'Interior 1', 'Interior 2', 'Interior 3', 'Interior 4', 'Interior 5', 'Interior 6', 'Interior 7', 'Interior 8', 'Interior 9', 'Metropolitana'];

function padronizarCotacaoBase(valor = '') {
  const texto = String(valor || '').trim().toUpperCase();
  if (!texto) return 'Interior 1';
  if (texto.includes('CAPITAL')) return 'Capital';
  const match = texto.match(/INTERIOR\s*(\d+)/i);
  if (match) return `Interior ${match[1]}`;
  if (texto.includes('METROPOLIT')) return 'Metropolitana';
  return String(valor || '').trim();
}

function localizarColuna(row = {}, possibilidades = []) {
  const entries = Object.entries(row || {});
  for (const nome of possibilidades) {
    const achou = entries.find(([k]) => k && k.toString().toUpperCase().includes(nome.toUpperCase()));
    if (achou) return achou[1];
  }
  return '';
}

function lerWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = event.target.result;
        const workbook = XLSX.read(data, { type: 'array' });
        const sheets = {};
        workbook.SheetNames.forEach((name) => {
          const sheet = workbook.Sheets[name];
          sheets[name] = {
            matriz: XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }),
            objetos: XLSX.utils.sheet_to_json(sheet, { defval: '' }),
          };
        });
        resolve({ workbook, sheets });
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

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

  const rotasPadronizadas = useMemo(() => aplicarCotacaoPadraoNasRotas(rotas, form, baseIbge), [rotas, form, baseIbge]);
  const modeloFaixaSelecionado = useMemo(() => modelosFaixa.find((item) => item.id === form.modeloFaixaId) || null, [modelosFaixa, form.modeloFaixaId]);

  useEffect(() => {
    if (form.origemNome && !form.origemIbge && baseIbge.length) {
      const municipio = encontrarMunicipioPorNome(baseIbge, form.origemNome);
      if (municipio) {
        setForm((prev) => ({
          ...prev,
          origemIbge: municipio.codigo_municipio_completo || municipio.codigo || municipio.ibge || '',
        }));
      }
    }
  }, [form.origemNome, form.origemIbge, baseIbge]);

  function atualizarCampo(campo, valor) {
    setForm((prev) => ({ ...prev, [campo]: valor }));
  }

  function selecionarTransportadora(id) {
    const existente = encontrarTransportadoraExistente(cadastros, id);
    setForm((prev) => ({
      ...prev,
      transportadoraId: existente?.id || '',
      transportadoraNome: existente?.nome || '',
      origemModo: 'existente',
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
    const novasRotas = rows.map((row) => ({
      ...criarRotaInicial(),
      ibgeDestino: localizarColuna(row, ['IBGE DESTINO']) || row['ibgeDestino'] || row['IBGE'] || '',
      prazo: localizarColuna(row, ['PRAZO']) || row['prazo'] || '',
      cotacaoBase: padronizarCotacaoBase(
        localizarColuna(row, ['REGIÃO', 'REGIAO', 'COTAÇÃO', 'COTACAO']) || row['cotacaoBase'] || 'Interior 1'
      ),
    })).filter((item) => item.ibgeDestino || item.prazo || item.cotacaoBase);
    if (novasRotas.length) setRotas(novasRotas);
    setMensagem(`Rotas importadas: ${novasRotas.length}.`);
  }

  async function importarQuebras(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const rows = await lerPlanilhaComoObjetos(file);
    const novas = rows.map((row) => ({
      ...criarQuebraFaixaInicial(),
      ibgeDestino: row['IBGE DESTINO'] || '',
      prazo: row['PRAZO'] || '',
      cotacaoBase: row['COTAÇÃO'] || 'Interior 1',
      cepInicial: row['CEP INICIAL'] || '',
      cepFinal: row['CEP FINAL'] || '',
    })).filter((item) => item.ibgeDestino || item.cepInicial || item.cepFinal);
    if (novas.length) setQuebras(novas);
    setMensagem(`Quebras importadas: ${novas.length}.`);
  }

  
async function importarTemplatePrecificacao(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const { sheets } = await lerWorkbook(file);

    const sheetRotas = sheets['Rotas'] || sheets['ROTAS'] || Object.values(sheets)[0];
    const sheetFretes = sheets['Fretes'] || sheets['FRETES'] || Object.values(sheets)[1];

    let totalRotas = 0;
    let totalFretes = 0;

    if (sheetRotas?.objetos?.length) {
      const novasRotas = sheetRotas.objetos.map((row) => ({
        ...criarRotaInicial(),
        ibgeDestino: localizarColuna(row, ['IBGE DESTINO']) || '',
        prazo: localizarColuna(row, ['PRAZO']) || '',
        cotacaoBase: padronizarCotacaoBase(localizarColuna(row, ['REGIÃO', 'REGIAO', 'COTAÇÃO', 'COTACAO']) || 'Interior 1'),
      })).filter((item) => item.ibgeDestino || item.prazo || item.cotacaoBase);
      if (novasRotas.length) {
        setRotas(novasRotas);
        totalRotas = novasRotas.length;
      }
    }

    if (sheetFretes?.matriz?.length) {
      const convertidos = converterTemplatePrecificacaoParaFretes({ linhas: sheetFretes.matriz, dadosGerais: form });
      if (convertidos.length) {
        setFretes(convertidos);
        totalFretes = convertidos.length;
      }
    }

    setMensagem(`Template importado: ${totalRotas} rota(s) e ${totalFretes} frete(s).`);
  }

  function exportarModeloRotas() {
    exportarLinhasParaXlsx(XLSX, [{ 'IBGE DESTINO': '', PRAZO: '', 'COTAÇÃO': '' }], `${tituloArquivo(form)}-modelo-rotas.xlsx`, 'Rotas');
  }

  function exportarModeloQuebras() {
    exportarLinhasParaXlsx(XLSX, [{ 'IBGE DESTINO': '', PRAZO: '', 'COTAÇÃO': '', 'CEP INICIAL': '', 'CEP FINAL': '' }], `${tituloArquivo(form)}-modelo-quebra-faixas.xlsx`, 'Quebras');
  }

  
function exportarModeloFretes() {
    const base = fretes.length
      ? fretes
      : gerarFretesPorCotacaoFaixa({
          rotas,
          dadosGerais: form,
          baseIbge,
          tipoCalculo: form.tipoCalculo,
          modeloFaixa: modeloFaixaSelecionado,
        });

    const linhas = form.tipoCalculo === 'PERCENTUAL'
      ? base.map((item) => ({
          COTAÇÃO: item.cotacao || '',
          'FRETE %': '',
          'FRETE MÍNIMO': '',
          'TAXA APLICADA': '',
          EXCEDENTE: '',
        }))
      : base.map((item) => ({
          COTAÇÃO: item.cotacao || '',
          FAIXA: item.faixaNome || `${item.pesoInicial} a ${item.pesoFinal}`,
          'PESO INICIAL': item.pesoInicial ?? '',
          'PESO FINAL': item.pesoFinal ?? '',
          'FRETE VALOR': '',
          'AD VALOREM %': '',
          'FRETE MÍNIMO': '',
          'TAXA APLICADA': '',
          EXCEDENTE: '',
        }));
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
    const linhas = fretes.map((item) => ({
      'NOME TRANSPORTADORA': form.transportadoraNome,
      'CÓDIGO UNIDADE': form.codigoOrigem,
      CANAL: form.canal,
      'REGRA DE CÁLCULO': form.regraCalculo,
      'TIPO DE CÁLCULO': form.tipoCalculo,
      'ROTA DO FRETE': item.cotacao,
      'PESO INICIAL': item.pesoInicial,
      'PESO FINAL': item.pesoFinal,
      'FRETE VALOR': item.freteValor,
      'AD VALOREM %': item.fretePercentual,
      'FRETE MÍNIMO': item.freteMinimo,
      'TAXA APLICADA': item.taxaAplicada,
      EXCEDENTE: item.excedente,
      'DATA INÍCIO': form.vigenciaInicial,
      'DATA FIM': form.vigenciaFinal,
    }));
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

  
function limparTudo() {
    setForm(criarFormularioInicial());
    setRotas([criarRotaInicial()]);
    setQuebras([criarQuebraFaixaInicial()]);
    setFretes([]);
    setMensagem('Tela limpa para começar novamente.');
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
          <p>Monte rotas e fretes sem mexer no simulador principal. Agora com seleção de faixa de peso e importação de template já precificado.</p>
        </div>
        <div className="formatacao-actions-top">
          <button className="btn-secondary" onClick={salvarRascunhoAtual}>Salvar rascunho</button>
          <button className="btn-secondary" onClick={limparTudo}>Limpar tudo</button>
          <button className="btn-primary" onClick={gerarPacoteCompleto}>Gerar rotas + fretes</button>
        </div>
      </div>

      {mensagem ? <div className="formatacao-alert">{mensagem}</div> : null}

      <section className="panel-card formatacao-section">
        <div className="section-header-inline">
          <h3>Dados gerais</h3>
          <div className="hint-line">IBGE de origem automático pela cidade + base IBGE.</div>
        </div>
        <div className="formatacao-grid three">
          <label className="field-block">
            <span>Transportadora</span>
            <select value={form.transportadoraModo} onChange={(e) => atualizarCampo('transportadoraModo', e.target.value)}>
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
            <span>Atualizar base IBGE (opcional)</span>
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
                      {COTACOES_BASE.map((op) => <option key={op}>{op}</option>)}
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
                  <td><select value={item.cotacaoBase} onChange={(e) => atualizarQuebra(item.id, 'cotacaoBase', e.target.value)}>{COTACOES_BASE.map((op) => <option key={op}>{op}</option>)}</select></td>
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
