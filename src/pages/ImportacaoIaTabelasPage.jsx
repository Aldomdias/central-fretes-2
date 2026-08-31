import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  criarTabelaNegociacao,
  substituirItensTabelaNegociacao,
  atualizarTabelaNegociacao,
} from '../services/tabelasNegociacaoService';
import { auditarResultadoIa, normalizarResultadoIa, validarResultadoIa } from '../utils/importacaoIaNegociacao';
import { getSupabaseClient } from '../lib/supabaseClient';

const CANAIS = ['B2C', 'ATACADO', 'INTERCOMPANY', 'REVERSA', 'A DEFINIR'];
const TIPOS_ARQUIVO_LEITURA_DIRETA = ['xlsx', 'xls', 'xlsb', 'csv'];
const LOTE_LINHAS_IA = 40;
const CONCORRENCIA_IA = 4;
const TIMEOUT_LOTE_IA_MS = 360000;

const MOTORES_IA = {
  kimi: { nome: 'kimi', label: 'Kimi', endpoint: '/api/importacao-ia-tabelas' },
  openai: { nome: 'openai', label: 'OpenAI', endpoint: '/api/importacao-ia-openai' },
};

async function processarLotesComConcorrencia(lotes, concorrencia, worker, aoConcluirUm) {
  const resultados = new Array(lotes.length);
  let proximo = 0;
  let concluidos = 0;
  async function trabalhador() {
    while (proximo < lotes.length) {
      const indice = proximo;
      proximo += 1;
      resultados[indice] = await worker(lotes[indice], indice);
      concluidos += 1;
      aoConcluirUm?.(concluidos, lotes.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concorrencia, lotes.length) }, trabalhador));
  return resultados;
}

function mesclarResultadosIa(lista) {
  const validos = lista.filter(Boolean);
  if (!validos.length) return {};
  const base = validos.find((r) => r.transportadora || r.origem?.cidade) || validos[0];
  const generalidades = validos.reduce((acc, r) => Object.assign(acc, r.generalidades || {}), {});
  const observacoes = Array.from(new Set(validos.flatMap((r) => r.resumo?.observacoes || [])));
  const prazosPendentes = validos.reduce((soma, r) => soma + (Number(r.resumo?.prazos_pendentes) || 0), 0);
  const coberturas = validos.map((r) => Number(r.resumo?.cobertura_percentual)).filter((v) => Number.isFinite(v));
  return {
    transportadora: base.transportadora,
    origem: base.origem,
    vigencia: base.vigencia,
    modelo: base.modelo,
    rotas: validos.flatMap((r) => r.rotas || []),
    fretes: validos.flatMap((r) => r.fretes || []),
    generalidades,
    gaps: validos.flatMap((r) => r.gaps || []),
    resumo: {
      cobertura_percentual: coberturas.length ? Math.round(coberturas.reduce((a, b) => a + b, 0) / coberturas.length) : 0,
      prazos_pendentes: prazosPendentes,
      observacoes,
    },
  };
}

const PROMPT_MESTRE_VERUM = `
Voce e um motor de normalizacao de tabelas de frete. Recebe arquivo de transportadora em qualquer formato/layout (planilha, PDF, imagem de tabela) e devolve dois arrays JSON: fretes[] e rotas[], no padrao Verum/Central de Fretes.

Regra principal: nunca invente dado. Quando uma informacao nao existir no arquivo e nao puder ser derivada com seguranca, deixe o campo faltante fora da saida e reporte em gaps[]. Nao preencha com zero, media ou suposicao silenciosa, exceto defaults explicitamente permitidos.

Schema de saida:
{
  "transportadora": "string ou null",
  "origem": { "cidade": "string", "uf": "string", "ibge": "number ou null" },
  "vigencia": { "inicio": "YYYY-MM-DD", "fim": "YYYY-MM-DD", "fonte": "explicita | default_aplicado" },
  "modelo": "percentual | faixa_peso",
  "fretes": [{
    "nome_transportadora": "string",
    "codigo_unidade": "",
    "regra_calculo": "Maior valor",
    "rota_do_frete": "string",
    "peso_minimo": "number",
    "peso_limite": "number",
    "excesso_de_peso": "number",
    "taxa_aplicada": "number",
    "frete_percentual": "number",
    "frete_minimo": "number",
    "inicio_vigencia": "YYYY-MM-DD",
    "fim_vigencia": "YYYY-MM-DD"
  }],
  "rotas": [{
    "nome_transportadora": "string",
    "codigo_unidade": "",
    "cotacao": "igual ao rota_do_frete correspondente",
    "codigo_ibge_origem": "number",
    "codigo_ibge_destino": "number",
    "cep_inicial": "number",
    "cep_final": "number",
    "metodo_envio": "Normal",
    "prazo_entrega": "number",
    "inicio_vigencia": "YYYY-MM-DD",
    "fim_vigencia": "YYYY-MM-DD"
  }],
  "gaps": [{ "tipo": "string", "descricao": "string", "linhas_afetadas": "number", "ufs_afetadas": ["string"] }]
}

Regras confirmadas:
1. regra_calculo = "Maior valor", salvo instrucao contraria no arquivo.
2. Modelo por faixa de peso:
   - taxa_aplicada = valor fixo em R$ da faixa.
   - excesso_de_peso = R$/kg acima do teto, somente na ultima faixa de cada rota; faixas anteriores = 0.
   - frete_percentual = Ad Valorem (%) ou frete percentual da rota. Se vier fracao, converter 0,006 para 0,6.
   - frete_minimo = 0 nesse modelo.
   - Ad Valorem Minimo fixo, Gris, Pedagio, CTRC, TAS e outros valores gerais nao entram em fretes[] nem rotas[]; reporte como gaps tipo "generalidade_cadastro".
3. Modelo percentual puro:
   - peso_minimo = 0, peso_limite = 999999999.
   - taxa_aplicada = 0.
   - frete_percentual = frete (%) da rota.
   - frete_minimo = minimo (R$) da rota.
   - excesso_de_peso = 0 sempre.
4. Extensao de tabela alem do teto original so se o usuario pedir explicitamente.

Codigo de rota:
- rota_do_frete e cotacao sao a chave de juncao e devem ser identicos.
- Se houver codigo proprio consistente da transportadora (MTC, AC-A, PR-A etc.), preserve.
- Se houver UF + regiao, normalize como UF-CAPITAL, UF-INT1, UF-INT2 etc.
- Preserve saltos de numeracao de interior quando existirem.

Origem e IBGE:
- Use origem informada no upload ou identificada com seguranca no arquivo.
- Se vier codigo IBGE, use diretamente.
- Se nao vier, resolva por municipio + UF contra base IBGE quando disponivel. Matches por aproximacao devem ser reportados em gaps[].

Vigencia:
- Se houver datas no arquivo, use-as.
- Se nao houver, pergunte ao usuario antes de aplicar default. Nesta tela, se o usuario informar datas, trate como default_aplicado.

Rotas/atendimento:
- Gere rotas[] para cidades com codigo/regiao que bata com fretes[], IBGE resolvido e prazo numerico valido.
- Prazo "A CONSULTAR", vazio ou nulo nao vira 0; reporte em gaps[].
- Se nao houver CEP, gere rota com IBGE quando possivel e reporte ausencia de CEP.

Relatorio gaps[] obrigatorio:
- cidades sem regiao/codigo,
- regioes sem tarifa correspondente,
- UFs na abrangencia sem preco e vice-versa,
- faixas de peso buracadas,
- prazos invalidos,
- CEPs ausentes,
- generalidades identificadas e deixadas fora.

Pergunte ao usuario somente quando impossivel derivar: transportadora ausente, vigencia ausente, campo numerico novo sem regra clara, origem fisica divergente da origem de faturamento.
`.trim();

const SINONIMOS = {
  origem: ['origem', 'cidade origem', 'cidade_origem', 'base', 'filial', 'unidade', 'praca origem', 'praça origem'],
  ufOrigem: ['uf origem', 'uf_origem', 'estado origem', 'estado_origem'],
  destino: ['destino', 'cidade destino', 'cidade_destino', 'municipio', 'município', 'cidade', 'praca destino', 'praça destino'],
  ufDestino: ['uf destino', 'uf_destino', 'estado destino', 'estado_destino', 'uf', 'dest uf'],
  rota: ['rota', 'nome rota', 'cotacao', 'cotação', 'faixa/rota', 'tabela', 'regiao', 'região'],
  pesoMin: ['peso minimo', 'peso mínimo', 'peso inicial', 'peso de', 'kg inicial', 'de kg', 'min'],
  pesoMax: ['peso maximo', 'peso máximo', 'peso final', 'peso ate', 'peso até', 'kg final', 'ate kg', 'até kg', 'max'],
  taxa: ['taxa aplicada', 'frete', 'valor frete', 'valor', 'preco', 'preço', 'r$', 'frete kg', 'valor fixo'],
  percentual: ['% nf', 'percentual nf', 'ad valorem', 'frete percentual', 'percentual', '%'],
  freteMinimo: ['frete minimo', 'frete mínimo', 'minimo', 'mínimo', 'valor minimo', 'valor mínimo'],
  excesso: ['excesso', 'excedente', 'kg excedente', 'valor excedente'],
  prazo: ['prazo', 'prazo entrega', 'dias', 'lead time'],
};

function limpar(valor = '') {
  return String(valor ?? '').trim();
}

function normalizar(valor = '') {
  return limpar(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9%]+/g, ' ')
    .trim()
    .toLowerCase();
}

function numero(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : '';
  const texto = limpar(valor).replace(/\s/g, '').replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  if (!texto) return '';
  const n = Number(texto);
  return Number.isFinite(n) ? n : '';
}

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

function fimPadraoISO() {
  const data = new Date();
  data.setFullYear(data.getFullYear() + 3);
  return data.toISOString().slice(0, 10);
}

function extensaoArquivo(nome = '') {
  return limpar(nome).split('.').pop()?.toLowerCase() || '';
}

function localizarColuna(cabecalhos, campo) {
  const candidatos = SINONIMOS[campo] || [];
  const mapa = new Map(cabecalhos.map((cab) => [normalizar(cab), cab]));

  for (const sinonimo of candidatos) {
    const direto = mapa.get(normalizar(sinonimo));
    if (direto) return direto;
  }

  for (const cab of cabecalhos) {
    const norm = normalizar(cab);
    if (candidatos.some((sinonimo) => norm.includes(normalizar(sinonimo)))) return cab;
  }
  return '';
}

function montarMapeamento(cabecalhos) {
  return Object.keys(SINONIMOS).reduce((acc, campo) => {
    acc[campo] = localizarColuna(cabecalhos, campo);
    return acc;
  }, {});
}

function extrairLinhasPlanilha(workbook) {
  const abas = workbook.SheetNames || [];
  const linhas = [];
  abas.forEach((aba) => {
    const ws = workbook.Sheets[aba];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    rows.forEach((row) => linhas.push({ __aba: aba, ...row }));
  });
  return linhas;
}

async function lerArquivoTabela(arquivo) {
  const ext = extensaoArquivo(arquivo.name);
  if (!TIPOS_ARQUIVO_LEITURA_DIRETA.includes(ext)) {
    return {
      tipo: 'anexo_ia',
      linhas: [],
      mensagem: 'Arquivo anexado para leitura por IA/OCR. A leitura direta local suporta Excel e CSV.',
    };
  }

  const buffer = await arquivo.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const linhas = extrairLinhasPlanilha(workbook);
  return { tipo: 'planilha', linhas, mensagem: `${linhas.length.toLocaleString('pt-BR')} linha(s) lidas em ${workbook.SheetNames.length} aba(s).` };
}

function valor(row, coluna) {
  return coluna ? row[coluna] : '';
}

function deduplicarLinhasParaIa(linhas, mapeamento) {
  const camposChave = ['origem', 'ufOrigem', 'destino', 'ufDestino', 'rota', 'pesoMin', 'pesoMax', 'taxa', 'percentual', 'freteMinimo', 'excesso', 'prazo'];
  const vistos = new Set();
  const unicas = [];
  linhas.forEach((row) => {
    const chave = camposChave.map((campo) => limpar(valor(row, mapeamento[campo])).toUpperCase()).join('|');
    if (vistos.has(chave)) return;
    vistos.add(chave);
    unicas.push(row);
  });
  return unicas;
}

function montarSaidaPadrao({ linhas, mapeamento, transportadora, canal, inicioVigencia, fimVigencia }) {
  const rotasMap = new Map();
  const fretes = [];

  linhas.forEach((row, index) => {
    const origem = limpar(valor(row, mapeamento.origem));
    const ufOrigem = limpar(valor(row, mapeamento.ufOrigem)).toUpperCase();
    const destino = limpar(valor(row, mapeamento.destino));
    const ufDestino = limpar(valor(row, mapeamento.ufDestino)).toUpperCase();
    const rotaBase = limpar(valor(row, mapeamento.rota));
    const rota = rotaBase || [origem, destino || ufDestino].filter(Boolean).join(' -> ');
    const pesoMin = numero(valor(row, mapeamento.pesoMin));
    const pesoMax = numero(valor(row, mapeamento.pesoMax));
    const taxa = numero(valor(row, mapeamento.taxa));
    const percentual = numero(valor(row, mapeamento.percentual));
    const freteMinimo = numero(valor(row, mapeamento.freteMinimo));
    const excesso = numero(valor(row, mapeamento.excesso));
    const prazo = numero(valor(row, mapeamento.prazo));

    if (!rota && !origem && !destino && !ufDestino && taxa === '' && percentual === '') return;

    const rotaKey = `${origem}|${ufOrigem}|${destino}|${ufDestino}|${rota}`;
    if (!rotasMap.has(rotaKey)) {
      rotasMap.set(rotaKey, {
        'NOME TRANSPORTADORA': transportadora,
        CANAL: canal,
        'NOME ROTA': rota,
        'IBGE ORIGEM': '',
        'CIDADE ORIGEM': origem,
        'UF ORIGEM': ufOrigem,
        'IBGE DESTINO': '',
        'CIDADE DESTINO': destino,
        'UF DESTINO': ufDestino,
        PRAZO: prazo,
        'DATA INICIO': inicioVigencia,
        'DATA FIM': fimVigencia,
      });
    }

    fretes.push({
      'Nome da transportadora': transportadora,
      'Codigo da unidade': origem,
      Canal: canal,
      'Regra de calculo': percentual !== '' && taxa === '' ? 'PERCENTUAL' : 'FAIXA_DE_PESO',
      'Tipo de calculo': percentual !== '' && taxa === '' ? 'PERCENTUAL' : 'FAIXA_DE_PESO',
      'Rota do frete': rota,
      'Peso minimo': pesoMin,
      'Peso limite': pesoMax,
      'Excesso de peso': excesso,
      'Taxa aplicada': taxa,
      'Frete percentual': percentual,
      'Frete minimo': freteMinimo,
      'Inicio da vigencia': inicioVigencia,
      'Fim da vigencia': fimVigencia,
      '_linha_origem': index + 1,
    });
  });

  return { rotas: Array.from(rotasMap.values()), fretes };
}

function exportarXlsx(linhas, nomeArquivo, aba) {
  if (!linhas.length) return;
  const ws = XLSX.utils.json_to_sheet(linhas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, aba);
  XLSX.writeFile(wb, nomeArquivo);
}

function statusCampo(coluna) {
  return coluna ? 'ok' : 'pendente';
}

export default function ImportacaoIaTabelasPage({ usuario, onMudarPagina }) {
  const inputRef = useRef(null);
  const [arquivo, setArquivo] = useState(null);
  const [linhas, setLinhas] = useState([]);
  const [mapeamento, setMapeamento] = useState({});
  const [transportadora, setTransportadora] = useState('');
  const [canal, setCanal] = useState('B2C');
  const [inicioVigencia, setInicioVigencia] = useState(hojeISO());
  const [fimVigencia, setFimVigencia] = useState(fimPadraoISO());
  const [mensagem, setMensagem] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [mostrarPrompt, setMostrarPrompt] = useState(false);
  const [resultadoIa, setResultadoIa] = useState(null);
  const [processandoIa, setProcessandoIa] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const cabecalhos = useMemo(() => {
    const set = new Set();
    linhas.slice(0, 200).forEach((row) => Object.keys(row).filter((k) => k !== '__aba').forEach((k) => set.add(k)));
    return Array.from(set);
  }, [linhas]);

  const saida = useMemo(() => montarSaidaPadrao({
    linhas,
    mapeamento,
    transportadora,
    canal,
    inicioVigencia,
    fimVigencia,
  }), [linhas, mapeamento, transportadora, canal, inicioVigencia, fimVigencia]);

  const falhasResultado = useMemo(() => resultadoIa
    ? auditarResultadoIa(resultadoIa, { mapeamento, cabecalhos, totalLinhas: linhas.length })
    : [], [resultadoIa, mapeamento, cabecalhos, linhas.length]);
  const falhasBloqueantes = falhasResultado.filter((item) => item.severidade === 'BLOQUEANTE');
  const falhasAlerta = falhasResultado.filter((item) => item.severidade === 'ALERTA');

  const camposObrigatorios = [
    ['origem', 'Origem'],
    ['rota', 'Rota/cotacao'],
    ['pesoMin', 'Peso inicial'],
    ['pesoMax', 'Peso final'],
    ['taxa', 'Taxa/frete'],
  ];

  const promptIa = useMemo(() => {
    const amostra = linhas.slice(0, 15);
    return [
      PROMPT_MESTRE_VERUM,
      '---',
      'Contexto informado na tela:',
      `Transportadora: ${transportadora || '[nao informado]'}`,
      `Canal: ${canal}`,
      `Vigencia sugerida: ${inicioVigencia || '[nao informado]'} a ${fimVigencia || '[nao informado]'}`,
      `Arquivo: ${arquivo?.name || '[nao anexado]'}`,
      `Colunas detectadas: ${cabecalhos.join(', ') || '[nenhuma]'}`,
      `Mapeamento sugerido pela tela: ${JSON.stringify(mapeamento, null, 2)}`,
      'Amostra extraida do arquivo:',
      JSON.stringify(amostra, null, 2),
    ].join('\n\n');
  }, [arquivo?.name, cabecalhos, canal, fimVigencia, inicioVigencia, linhas, mapeamento, transportadora]);

  async function selecionarArquivo(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setArquivo(file);
    setLinhas([]);
    setMapeamento({});
    setMensagem('');
    setCarregando(true);
    try {
      const resposta = await lerArquivoTabela(file);
      setLinhas(resposta.linhas || []);
      const mapa = montarMapeamento(Object.keys(resposta.linhas?.[0] || {}));
      setMapeamento(mapa);
      setMensagem(resposta.mensagem);
    } catch (error) {
      setMensagem(error?.message || 'Nao foi possivel ler o arquivo.');
    } finally {
      setCarregando(false);
      event.target.value = '';
    }
  }

  function atualizarCampo(campo, coluna) {
    setMapeamento((prev) => ({ ...prev, [campo]: coluna }));
  }

  async function processarComIa(motor) {
    if (!arquivo || !linhas.length) return setMensagem('Anexe uma planilha Excel/CSV antes de processar com IA.');
    if (!transportadora.trim()) return setMensagem('Informe a transportadora antes de processar.');
    if (!inicioVigencia || !fimVigencia) return setMensagem('Informe a vigência antes de processar.');
    setProcessandoIa(motor.nome);
    setResultadoIa(null);
    setMensagem(`${motor.label} está analisando e normalizando a tabela...`);
    try {
      const supabase = getSupabaseClient();
      const { data: sessaoData } = supabase ? await supabase.auth.getSession() : { data: null };
      const accessToken = sessaoData?.session?.access_token || '';
      const linhasUnicas = deduplicarLinhasParaIa(linhas, mapeamento);
      const lotes = [];
      for (let i = 0; i < linhasUnicas.length; i += LOTE_LINHAS_IA) lotes.push(linhasUnicas.slice(i, i + LOTE_LINHAS_IA));

      setMensagem(`${linhasUnicas.length.toLocaleString('pt-BR')} linha(s) única(s) de ${linhas.length.toLocaleString('pt-BR')} lida(s). ${motor.label} está analisando... 0/${lotes.length} lote(s)`);
      let ultimoModelo = '';
      const respostasLotes = await processarLotesComConcorrencia(
        lotes,
        CONCORRENCIA_IA,
        async (loteLinhas, indice) => {
          const controlador = new AbortController();
          const timeoutId = window.setTimeout(() => controlador.abort(), TIMEOUT_LOTE_IA_MS);
          try {
            const resposta = await fetch(motor.endpoint, {
              method: 'POST',
              signal: controlador.signal,
              headers: {
                'Content-Type': 'application/json',
                ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
              },
              body: JSON.stringify({
                arquivo: arquivo.name,
                linhas: loteLinhas,
                contexto: { transportadora, canal, inicioVigencia, fimVigencia },
              }),
            });
            const payload = await resposta.json().catch(() => ({}));
            if (!resposta.ok) throw new Error(payload.erro ? `Lote ${indice + 1}/${lotes.length}: ${payload.erro}` : 'Falha ao processar com IA.');
            ultimoModelo = payload.modelo || ultimoModelo;
            return payload.resultado;
          } catch (erro) {
            if (erro?.name === 'AbortError') throw new Error(`Lote ${indice + 1}/${lotes.length}: ${motor.label} não respondeu em ${TIMEOUT_LOTE_IA_MS / 1000}s.`);
            throw erro;
          } finally {
            window.clearTimeout(timeoutId);
          }
        },
        (concluidos, total) => setMensagem(`${motor.label} está analisando e normalizando a tabela... ${concluidos}/${total} lote(s)`),
      );

      const resultadoBruto = mesclarResultadosIa(respostasLotes);
      const normalizado = normalizarResultadoIa(resultadoBruto, { transportadora });
      setResultadoIa(normalizado);
      setMensagem(`Análise concluída com ${ultimoModelo} em ${lotes.length} lote(s): ${normalizado.rotas.length} rota(s), ${normalizado.fretes.length} frete(s) e ${normalizado.gaps.length} gap(s).`);
    } catch (error) {
      setMensagem(error?.message || 'Não foi possível processar a tabela com IA.');
    } finally {
      setProcessandoIa(false);
    }
  }

  async function disponibilizarParaNegociacao() {
    if (!resultadoIa) return;
    const erros = validarResultadoIa(resultadoIa, { mapeamento, cabecalhos, totalLinhas: linhas.length });
    if (erros.length) return setMensagem(`Revise antes de salvar: ${erros.join(' ')}`);
    setSalvando(true);
    setMensagem('Criando negociação e salvando rotas, fretes e generalidades...');
    try {
      const origem = resultadoIa.origem || {};
      const tabela = await criarTabelaNegociacao({
        transportadora: resultadoIa.transportadora,
        canal,
        tipo_negociacao: 'NOVA_TABELA',
        tipo_tabela: 'FRACIONADO',
        origem: origem.cidade || '',
        uf_origem: origem.uf || '',
        data_inicio_prevista: resultadoIa.vigencia?.inicio || inicioVigencia,
        origem_importacao: 'IMPORTACAO_IA_KIMI_K3',
        generalidades: resultadoIa.generalidades,
        observacao: `Importado por IA do arquivo ${arquivo?.name || ''}. ${falhasResultado.length} possível(is) falha(s) mapeada(s).`,
        usuario,
      });
      await substituirItensTabelaNegociacao(tabela, resultadoIa.itens, {
        modo: 'total',
        origemImportacao: 'IMPORTACAO_IA_KIMI_K3',
        arquivo: arquivo?.name,
      });
      await atualizarTabelaNegociacao(tabela.id, {
        status: 'EM TESTE',
        incluir_simulacao: true,
        data_inicio_vigencia: resultadoIa.vigencia?.inicio || inicioVigencia,
        generalidades: resultadoIa.generalidades,
      });
      setMensagem('Tabela disponibilizada em Negociações. A publicação oficial continuará bloqueada até aprovação do gestor.');
      window.setTimeout(() => onMudarPagina?.('tabelas-negociacao'), 900);
    } catch (error) {
      setMensagem(error?.message || 'Não foi possível criar a negociação.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="page-shell formatacao-shell">
      <div className="page-top between">
        <div className="page-header">
          <div className="amd-mini-brand">Base e cadastros</div>
          <h1>Importar tabela com IA</h1>
          <p>Anexe uma tabela da transportadora, revise o mapeamento e gere o modelo padrao de rotas e fretes sem alterar a importacao atual.</p>
        </div>
        <div className="toolbar-wrap">
          <button className="btn-secondary" type="button" onClick={() => setMostrarPrompt((v) => !v)}>Prompt IA</button>
          <button className="btn-primary" type="button" onClick={() => processarComIa(MOTORES_IA.kimi)} disabled={!!processandoIa || !linhas.length}>
            {processandoIa === 'kimi' ? 'Processando com Kimi...' : 'Processar com IA (Kimi)'}
          </button>
          <button className="btn-primary" type="button" onClick={() => processarComIa(MOTORES_IA.openai)} disabled={!!processandoIa || !linhas.length}>
            {processandoIa === 'openai' ? 'Processando com OpenAI...' : 'Processar com IA (OpenAI)'}
          </button>
          <button className="btn-primary" type="button" onClick={() => inputRef.current?.click()} disabled={carregando}>
            {carregando ? 'Lendo arquivo...' : 'Anexar arquivo'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.xlsb,.csv"
            onChange={selecionarArquivo}
            hidden
          />
        </div>
      </div>

      {mensagem ? <div className="formatacao-alert">{mensagem}</div> : null}

      <section className="panel-card formatacao-section">
        <div className="section-header-inline">
          <h3>Configuracao da tabela</h3>
        </div>
        <div className="form-grid">
          <label>
            Transportadora
            <input value={transportadora} onChange={(e) => setTransportadora(e.target.value)} placeholder="Ex.: TRANSLOVATO" />
          </label>
          <label>
            Canal
            <select value={canal} onChange={(e) => setCanal(e.target.value)}>
              {CANAIS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            Inicio vigencia
            <input type="date" value={inicioVigencia} onChange={(e) => setInicioVigencia(e.target.value)} />
          </label>
          <label>
            Fim vigencia
            <input type="date" value={fimVigencia} onChange={(e) => setFimVigencia(e.target.value)} />
          </label>
        </div>
        <div className="inline-meta compact-top-gap">
          <span>Arquivo: <strong>{arquivo?.name || 'nenhum'}</strong></span>
          <span>Linhas lidas: <strong>{linhas.length.toLocaleString('pt-BR')}</strong></span>
          <span>Rotas previstas: <strong>{saida.rotas.length.toLocaleString('pt-BR')}</strong></span>
          <span>Fretes previstos: <strong>{saida.fretes.length.toLocaleString('pt-BR')}</strong></span>
        </div>
      </section>

      {mostrarPrompt ? (
        <section className="panel-card formatacao-section">
          <div className="section-header-inline">
            <h3>Pacote para IA</h3>
            <button className="btn-secondary" type="button" onClick={() => navigator.clipboard?.writeText(promptIa)}>Copiar prompt</button>
          </div>
          <textarea value={promptIa} readOnly rows={12} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }} />
        </section>
      ) : null}

      {resultadoIa ? (
        <section className="panel-card formatacao-section">
          <div className="section-header-inline">
            <h3>Revisão da IA</h3>
            <button className="btn-primary" type="button" onClick={disponibilizarParaNegociacao} disabled={salvando || falhasBloqueantes.length > 0}>
              {salvando ? 'Salvando...' : 'Disponibilizar para negociação'}
            </button>
          </div>
          <div className="inline-meta">
            <span>Rotas: <strong>{resultadoIa.rotas.length.toLocaleString('pt-BR')}</strong></span>
            <span>Fretes: <strong>{resultadoIa.fretes.length.toLocaleString('pt-BR')}</strong></span>
            <span>Generalidades: <strong>{Object.keys(resultadoIa.generalidades || {}).length}</strong></span>
            <span>Bloqueantes: <strong>{falhasBloqueantes.length}</strong></span>
            <span>Alertas: <strong>{falhasAlerta.length}</strong></span>
          </div>
          {falhasResultado.length ? (
            <div className="formatacao-alert compact-top-gap">
              {falhasResultado.slice(0, 30).map((gap, index) => (
                <div key={`${gap.codigo || gap.tipo}-${index}`}>
                  <strong>[{gap.severidade}] {gap.codigo || gap.tipo}:</strong> {gap.descricao}
                </div>
              ))}
            </div>
          ) : <div className="formatacao-alert compact-top-gap">Nenhuma falha estrutural encontrada.</div>}
          {falhasBloqueantes.length ? <p className="muted-text">Corrija as falhas bloqueantes antes de disponibilizar a tabela para negociação.</p> : null}
        </section>
      ) : null}

      <section className="panel-card formatacao-section">
        <div className="section-header-inline">
          <h3>Mapeamento automatico</h3>
          <span className="muted-text">Ajuste as colunas antes de exportar.</span>
        </div>
        <div className="grid two-cols">
          {Object.keys(SINONIMOS).map((campo) => (
            <label key={campo}>
              {campo}
              <select value={mapeamento[campo] || ''} onChange={(e) => atualizarCampo(campo, e.target.value)}>
                <option value="">Nao identificado</option>
                {cabecalhos.map((cab) => <option key={cab} value={cab}>{cab}</option>)}
              </select>
            </label>
          ))}
        </div>
        <div className="inline-actions-wrap compact-top-gap">
          {camposObrigatorios.map(([campo, label]) => (
            <span key={campo} className={`status-pill ${statusCampo(mapeamento[campo]) === 'ok' ? 'success' : 'warn'}`}>
              {label}: {mapeamento[campo] || 'pendente'}
            </span>
          ))}
        </div>
      </section>

      <section className="panel-card formatacao-section">
        <div className="section-header-inline">
          <h3>Saida padrao</h3>
          <div className="toolbar-wrap">
            <button className="btn-secondary" type="button" onClick={() => exportarXlsx(saida.rotas, 'rotas-importacao-ia.xlsx', 'Rotas')} disabled={!saida.rotas.length}>Exportar rotas</button>
            <button className="btn-secondary" type="button" onClick={() => exportarXlsx(saida.fretes, 'fretes-importacao-ia.xlsx', 'Fretes')} disabled={!saida.fretes.length}>Exportar fretes</button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Rota</th>
                <th>Origem</th>
                <th>Destino</th>
                <th>Peso inicial</th>
                <th>Peso final</th>
                <th>Taxa</th>
                <th>% NF</th>
                <th>Minimo</th>
              </tr>
            </thead>
            <tbody>
              {saida.fretes.slice(0, 300).map((item, idx) => (
                <tr key={`${item['Rota do frete']}-${idx}`}>
                  <td>{item['Rota do frete'] || '-'}</td>
                  <td>{item['Codigo da unidade'] || '-'}</td>
                  <td>{saida.rotas.find((rota) => rota['NOME ROTA'] === item['Rota do frete'])?.['CIDADE DESTINO'] || '-'}</td>
                  <td>{item['Peso minimo']}</td>
                  <td>{item['Peso limite']}</td>
                  <td>{item['Taxa aplicada']}</td>
                  <td>{item['Frete percentual']}</td>
                  <td>{item['Frete minimo']}</td>
                </tr>
              ))}
              {!saida.fretes.length ? (
                <tr><td colSpan="8" className="empty-note">Anexe um arquivo Excel/CSV ou use o prompt IA para gerar as tabelas padrao.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
