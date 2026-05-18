import { useEffect, useMemo, useRef, useState } from 'react';
import {
  baixarModelo,
  buildCoberturaReport,
  buildImportPayload,
  exportarControlePasta,
  exportarSecao,
  parseFileToRows,
} from '../utils/importacao';
import {
  listarImportacoes,
  registrarImportacao,
} from '../services/freteDatabaseService';
import { importarTabelaPronta } from '../utils/importadorTabelaPronta';
import {
  listarTabelasNegociacao,
  substituirItensTabelaNegociacao,
} from '../services/tabelasNegociacaoService';

const TIPOS = [
  { id: 'rotas', label: 'Rotas' },
  { id: 'cotacoes', label: 'Fretes/Cotações' },
  { id: 'taxas', label: 'Taxas Especiais' },
  { id: 'generalidades', label: 'Generalidades' },
];

const HISTORICO_KEY = 'simulador-fretes-importacoes-v1';
const LIMITE_HISTORICO = 15;
const LIMITE_SUGERIDO_ARQUIVOS = 15;

const STATUS_IMPORTACAO_INICIAL = {
  totalArquivos: 0,
  arquivoAtual: '',
  arquivoIndex: 0,
  etapa: 'Aguardando importação',
  sucessos: 0,
  falhas: 0,
  totalInseridos: 0,
  totalErros: 0,
  iniciadoEm: '',
  finalizadoEm: '',
  duracaoMs: 0,
  concluido: false,
  cancelado: false,
};

function numeroOuNulo(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function textoLimpo(valor) {
  return String(valor ?? '').trim();
}

function formatarFaixaCotacao(cotacao = {}) {
  const rota = textoLimpo(cotacao.rota || cotacao.nomeRota || cotacao.cotacao);
  const pesoMin = numeroOuNulo(cotacao.pesoMin);
  const pesoMax = numeroOuNulo(cotacao.pesoMax);

  const temFaixa = pesoMin !== null || pesoMax !== null;
  const faixa = temFaixa
    ? `${pesoMin !== null ? pesoMin : 0} A ${pesoMax !== null && pesoMax > 0 ? pesoMax : '∞'} KG`
    : '';

  if (rota && faixa) return `${rota} | ${faixa}`;
  return rota || faixa;
}

function montarItensParaNegociacao(resultado, tipoNegociacao = 'fretes') {
  const fretes = Array.isArray(resultado?.fretes) ? resultado.fretes : [];
  const rotas = Array.isArray(resultado?.rotas) ? resultado.rotas : [];

  if (tipoNegociacao === 'rotas') {
    return rotas.map((rota) => ({
      cidade_origem: rota.origem || '',
      uf_origem: rota.ufOrigem || '',
      ibge_origem: rota.ibgeOrigem || '',
      cidade_destino: rota.cidadeDestino || '',
      uf_destino: rota.ufDestino || '',
      ibge_destino: rota.ibgeDestino || '',
      prazo: rota.prazo || null,
      faixa_peso: rota.cotacaoFinal || rota.cotacao || '',
      origem_importacao: 'IMPORTACAO_ROTAS',
      dados_originais: { tipo_item: 'ROTA', ...rota },
    }));
  }

  const usarRotasParaEnriquecer = tipoNegociacao === 'ambos';

  return fretes.map((frete) => {
    const rotaMatch = usarRotasParaEnriquecer
      ? rotas.find(
          (r) =>
            r.ufDestino === frete.ufDestino &&
            (r.cotacaoBase === frete.cotacaoBase || r.origem === frete.origem)
        )
      : null;

    const cotNome = String(frete.cotacaoFinal || frete.cotacao || '').toUpperCase().trim();
    const faixaRaw = String(frete.faixaPeso || '').trim();
    const faixaPesoFormatada = faixaRaw
      ? (cotNome ? `${cotNome} | ${faixaRaw}` : faixaRaw)
      : cotNome || '';

    return {
      cidade_origem: frete.origem || '',
      uf_origem: frete.ufOrigem || '',
      ibge_origem: rotaMatch?.ibgeOrigem || '',
      cidade_destino: rotaMatch?.cidadeDestino || '',
      uf_destino: frete.ufDestino || '',
      ibge_destino: rotaMatch?.ibgeDestino || '',
      faixa_peso: faixaPesoFormatada,
      peso_inicial: frete.pesoInicial != null ? frete.pesoInicial : null,
      peso_final: frete.pesoFinal != null ? frete.pesoFinal : null,
      frete_minimo: frete.freteMinimo != null ? frete.freteMinimo : null,
      taxa_aplicada: frete.freteValor != null ? frete.freteValor : null,
      frete_percentual: frete.fretePercentual != null ? frete.fretePercentual : null,
      excesso_kg: frete.excedente != null ? frete.excedente : null,
      valor_excedente: frete.valorExcedente != null ? frete.valorExcedente : null,
      prazo: rotaMatch?.prazo || null,
      origem_importacao: tipoNegociacao === 'ambos' ? 'IMPORTACAO_DIRETA' : 'IMPORTACAO_FRETES',
      dados_originais: { tipo_item: 'COTACAO', ...frete },
    };
  });
}

function montarItensNegociacaoDePayload(payload, tipoNegociacao = 'fretes', tabelaNegociacao = null) {
  const itens = [];
  const transportadorasPayload = Array.isArray(payload?.transportadoras) ? payload.transportadoras : [];

  transportadorasPayload.forEach((transportadoraPayload) => {
    const origem = transportadoraPayload?.origem || {};
    const cidadeOrigem = origem.cidade || tabelaNegociacao?.origem || '';
    const ufOrigem = tabelaNegociacao?.uf_origem || '';
    const ufDestinoPadrao = tabelaNegociacao?.uf_destino || '';
    const canal = origem.canal || tabelaNegociacao?.canal || '';

    if (tipoNegociacao === 'rotas') {
      (origem.rotas || []).forEach((rota) => {
        itens.push({
          cidade_origem: cidadeOrigem,
          uf_origem: ufOrigem,
          ibge_origem: rota.ibgeOrigem || '',
          cidade_destino: '',
          uf_destino: ufDestinoPadrao,
          ibge_destino: rota.ibgeDestino || '',
          prazo: rota.prazoEntregaDias || rota.prazo || null,
          faixa_peso: rota.cotacao || rota.nomeRota || '',
          origem_importacao: 'IMPORTACAO_ROTAS',
          dados_originais: {
            tipo_item: 'ROTA',
            transportadora: transportadoraPayload?.nome || tabelaNegociacao?.transportadora || '',
            origem: cidadeOrigem,
            canal,
            ...rota,
          },
        });
      });
      return;
    }

    (origem.cotacoes || []).forEach((cotacao) => {
      itens.push({
        cidade_origem: cidadeOrigem,
        uf_origem: ufOrigem,
        ibge_origem: '',
        cidade_destino: '',
        uf_destino: ufDestinoPadrao,
        ibge_destino: '',
        faixa_peso: formatarFaixaCotacao(cotacao),
        peso_inicial: cotacao.pesoMin != null ? cotacao.pesoMin : null,
        peso_final: cotacao.pesoMax != null ? cotacao.pesoMax : null,
        frete_minimo: cotacao.freteMinimo != null ? cotacao.freteMinimo : null,
        taxa_aplicada: cotacao.valorFixo != null ? cotacao.valorFixo : null,
        frete_percentual: cotacao.percentual != null ? cotacao.percentual : null,
        excesso_kg: cotacao.excesso != null ? cotacao.excesso : null,
        valor_excedente: cotacao.rsKg != null ? cotacao.rsKg : null,
        prazo: null,
        origem_importacao: 'IMPORTACAO_FRETES',
        dados_originais: {
          tipo_item: 'COTACAO',
          transportadora: transportadoraPayload?.nome || tabelaNegociacao?.transportadora || '',
          origem: cidadeOrigem,
          canal,
          ...cotacao,
        },
      });
    });
  });

  return itens;
}

async function montarPayloadNegociacao(file, tipoNegociacao, canalImportacao, tabelaNegociacao) {
  if (tipoNegociacao === 'fretes' || tipoNegociacao === 'rotas') {
    const tipoPadrao = tipoNegociacao === 'fretes' ? 'cotacoes' : 'rotas';
    const parsed = await parseFileToRows(file, tipoPadrao);
    const payloadPadrao = buildImportPayload(parsed, tipoPadrao, { canal: canalImportacao });
    const itens = montarItensNegociacaoDePayload(payloadPadrao, tipoNegociacao, tabelaNegociacao);

    if (!itens.length) {
      const primeiroErro = payloadPadrao.erros?.[0]?.mensagem;
      throw new Error(primeiroErro || `Nenhum item válido encontrado para ${tipoNegociacao === 'fretes' ? 'Fretes/Cotações' : 'Rotas'}.`);
    }

    return {
      itensNegociacao: itens,
      inseridos: itens.length,
      erros: payloadPadrao.erros || [],
      meta: {
        ...(payloadPadrao.meta || {}),
        tipoNegociacao,
        tipoPadrao,
        rotas: tipoNegociacao === 'rotas' ? itens.length : 0,
        fretes: tipoNegociacao === 'fretes' ? itens.length : 0,
        itens: itens.length,
        origemParser: 'importacao_padrao',
      },
    };
  }

  try {
    const resultado = await importarTabelaPronta(file);
    const itens = montarItensParaNegociacao(resultado, 'ambos');

    if (!itens.length) {
      throw new Error('Nenhum item válido encontrado nas abas "Rotas" e "Fretes".');
    }

    return {
      itensNegociacao: itens,
      inseridos: itens.length,
      erros: [],
      meta: {
        tipoNegociacao,
        rotas: resultado.rotas?.length || 0,
        fretes: resultado.fretes?.length || 0,
        itens: itens.length,
        origemParser: 'importador_tabela_pronta',
      },
    };
  } catch (error) {
    if (String(error?.message || '').includes('Arquivo sem abas')) {
      throw new Error('Para importar Rotas + Fretes juntos, use um arquivo com abas chamadas "Rotas" e "Fretes". Se estiver usando o modelo normal da tela de Importação, selecione "Só Fretes" ou "Só Rotas".');
    }
    throw error;
  }
}

function SummaryCard({ title, value, subtitle }) {
  return (
    <div className="summary-card">
      <span>{title}</span>
      <strong>{value}</strong>
      <span>{subtitle}</span>
    </div>
  );
}

function formatarDuracao(ms) {
  if (!ms) return '0s';
  const segundos = Math.max(1, Math.round(ms / 1000));
  if (segundos < 60) return `${segundos}s`;
  const minutos = Math.floor(segundos / 60);
  const resto = segundos % 60;
  return resto ? `${minutos}min ${resto}s` : `${minutos}min`;
}

function formatarDataHora(value) {
  if (!value) return '—';
  const data = new Date(value);
  if (Number.isNaN(data.getTime())) return '—';
  return data.toLocaleString('pt-BR');
}

function persistirHistoricoLocal(historico) {
  try {
    localStorage.setItem(HISTORICO_KEY, JSON.stringify(historico.slice(0, LIMITE_HISTORICO)));
  } catch {}
}

function carregarHistoricoLocal() {
  try {
    const raw = localStorage.getItem(HISTORICO_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function consolidarHistorico(entradas = []) {
  const vistos = new Set();
  return entradas
    .filter(Boolean)
    .filter((item) => {
      const chave = [item.arquivo, item.tipo, item.canal, item.criadoEm || item.finalizadoEm || ''].join('|');
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    })
    .sort((a, b) => {
      const dataA = new Date(a.criadoEm || a.finalizadoEm || 0).getTime();
      const dataB = new Date(b.criadoEm || b.finalizadoEm || 0).getTime();
      return dataB - dataA;
    })
    .slice(0, LIMITE_HISTORICO);
}

function getFilePath(file) {
  return file?.webkitRelativePath || file?.name || '';
}

function getFileKey(fileOrName) {
  const value = typeof fileOrName === 'string' ? fileOrName : getFilePath(fileOrName);
  return String(value || '').split('/').pop().trim().toLowerCase();
}

function calcularControlePasta(files = [], historico = [], tipo = '') {
  const importados = new Set(
    (historico || [])
      .filter((item) => !tipo || item.tipo === tipo)
      .filter((item) => item.status !== 'erro')
      .map((item) => getFileKey(item.arquivo))
  );
  return files
    .filter((file) => /\.(xlsx|xls|csv)$/i.test(file.name || ''))
    .map((file, index) => {
      const nome = file.name || `arquivo-${index + 1}`;
      const caminho = getFilePath(file) || nome;
      const jaImportado = importados.has(getFileKey(nome));
      return {
        id: `${caminho}-${file.size || 0}-${file.lastModified || index}`,
        arquivo: nome,
        caminho,
        tamanhoKb: Math.round((file.size || 0) / 1024),
        modificadoEm: file.lastModified ? new Date(file.lastModified).toISOString() : '',
        status: jaImportado ? 'Já importado' : 'Pendente',
        selecionado: !jaImportado,
        file,
      };
    });
}

function mapImportacaoRemota(item) {
  return {
    arquivo: item.arquivo || 'Arquivo sem nome',
    tipo: item.tipo || '',
    canal: item.canal || 'ATACADO',
    inseridos: item.inseridos || 0,
    erros: Array.isArray(item.erros) ? item.erros : [],
    meta: item.meta || {},
    duracaoMs: item.duracaoMs || item.duracao_ms || 0,
    status: item.status || (item.erros?.length ? 'concluido-com-erros' : 'concluido'),
    criadoEm: item.criadoEm || item.criado_em || item.finalizadoEm || item.finalizado_em || '',
    finalizadoEm: item.finalizadoEm || item.finalizado_em || item.criadoEm || item.criado_em || '',
    etapaAtual: item.etapaAtual || item.etapa_atual || '',
  };
}

export default function ImportacaoPage({ store, transportadoras, onAbrirTransportadoras }) {
  const [tipo, setTipo] = useState('rotas');
  const [processando, setProcessando] = useState(false);
  const cancelarProcessamentoRef = useRef(false);
  const processamentoIdRef = useRef(0);
  const [inputResetKey, setInputResetKey] = useState(0);
  const [historico, setHistorico] = useState(() => carregarHistoricoLocal());
  const [filtro, setFiltro] = useState('');
  const [detalhe, setDetalhe] = useState(null);
  const [canalImportacao, setCanalImportacao] = useState('ATACADO');
  const [pastaArquivos, setPastaArquivos] = useState([]);
  const [statusImportacao, setStatusImportacao] = useState(STATUS_IMPORTACAO_INICIAL);

  const [destino, setDestino] = useState('transportadora');
  const [tipoNegociacao, setTipoNegociacao] = useState('fretes');
  const [tabelasNegociacao, setTabelasNegociacao] = useState([]);
  const [tabelaNegociacaoId, setTabelaNegociacaoId] = useState('');
  const [carregandoNegociacoes, setCarregandoNegociacoes] = useState(false);
  const [erroNegociacoes, setErroNegociacoes] = useState('');

  const tabelaNegociacaoSelecionada = tabelasNegociacao.find((t) => t.id === tabelaNegociacaoId) || null;
  const modoNegociacao = destino === 'negociacao';

  async function carregarTabelasNegociacao() {
    setCarregandoNegociacoes(true);
    setErroNegociacoes('');
    try {
      const lista = await listarTabelasNegociacao({ tipoTabela: 'FRACIONADO' });
      setTabelasNegociacao(lista);
      if (lista.length && !tabelaNegociacaoId) setTabelaNegociacaoId(lista[0].id);
    } catch (e) {
      setErroNegociacoes(e.message || 'Erro ao carregar tabelas de negociação.');
    } finally {
      setCarregandoNegociacoes(false);
    }
  }

  useEffect(() => {
    if (destino === 'negociacao' && !tabelasNegociacao.length) {
      carregarTabelasNegociacao();
    }
  }, [destino]);

  useEffect(() => {
    let ativo = true;
    async function carregarHistorico() {
      try {
        const remoto = await listarImportacoes(LIMITE_HISTORICO);
        if (!ativo || !remoto?.length) return;
        const combinado = consolidarHistorico([...remoto.map(mapImportacaoRemota), ...carregarHistoricoLocal()]);
        setHistorico(combinado);
        if (!detalhe && combinado[0]) setDetalhe(combinado[0]);
        persistirHistoricoLocal(combinado);
      } catch {
        const local = carregarHistoricoLocal();
        if (!ativo) return;
        setHistorico(local);
        if (!detalhe && local[0]) setDetalhe(local[0]);
      }
    }
    carregarHistorico();
    return () => { ativo = false; };
  }, []);

  useEffect(() => { persistirHistoricoLocal(historico); }, [historico]);

  const cobertura = useMemo(() => buildCoberturaReport(transportadoras), [transportadoras]);
  const pendencias = useMemo(
    () => cobertura.detalhes.filter((item) =>
      !filtro ||
      item.transportadora.toLowerCase().includes(filtro.toLowerCase()) ||
      item.origem.toLowerCase().includes(filtro.toLowerCase())
    ),
    [cobertura, filtro]
  );

  const exportarMassa = () => {
    const rows = [];
    transportadoras.forEach((transportadora) => {
      (transportadora.origens || []).forEach((origem) => {
        const base = {
          transportadora: transportadora.nome,
          origem: origem.cidade,
          canal: origem.canal || 'ATACADO',
          codigoUnidade: origem.canal === 'B2C' ? '0001 - B2C' : '0001 - B2B',
        };
        if (tipo === 'rotas') rows.push(...(origem.rotas || []).map((item) => ({ ...base, ...item })));
        if (tipo === 'cotacoes') rows.push(...(origem.cotacoes || []).map((item) => ({ ...base, ...item })));
        if (tipo === 'taxas') rows.push(...(origem.taxasEspeciais || []).map((item) => ({ ...base, ...item })));
        if (tipo === 'generalidades' && origem.generalidades) rows.push({ ...base, ...origem.generalidades });
      });
    });
    exportarSecao(tipo, rows, `exportacao-${tipo}.xlsx`);
  };

  const resetarTelaImportacao = (etapa = 'Fila limpa') => {
    processamentoIdRef.current += 1;
    cancelarProcessamentoRef.current = true;
    setProcessando(false);
    setDetalhe(null);
    setPastaArquivos([]);
    setInputResetKey((prev) => prev + 1);
    setStatusImportacao({ ...STATUS_IMPORTACAO_INICIAL, etapa, finalizadoEm: new Date().toISOString(), concluido: true, cancelado: true });
  };

  const limparProcessamento = () => resetarTelaImportacao('Fila limpa');
  const pararProcessamento = () => resetarTelaImportacao('Cancelado pelo usuário');
  const limparHistoricoLocal = () => { setHistorico([]); setDetalhe(null); persistirHistoricoLocal([]); };

  const processarArquivos = async (filesOriginais) => {
    const files = Array.from(filesOriginais || []).filter((file) => /\.(xlsx|xls|csv)$/i.test(file.name || ''));
    if (!files.length) return;

    if (modoNegociacao && !tabelaNegociacaoSelecionada) {
      alert('Selecione uma tabela de negociação antes de importar.');
      return;
    }

    const inicioLote = Date.now();
    const processamentoId = processamentoIdRef.current + 1;
    processamentoIdRef.current = processamentoId;
    cancelarProcessamentoRef.current = false;

    const processoCancelado = () =>
      cancelarProcessamentoRef.current || processamentoIdRef.current !== processamentoId;

    setProcessando(true);
    setDetalhe(null);
    setStatusImportacao({
      totalArquivos: files.length,
      arquivoAtual: files[0]?.name || '',
      arquivoIndex: 0,
      etapa: modoNegociacao ? 'Preparando importação para negociação' : 'Preparando importação',
      sucessos: 0, falhas: 0, totalInseridos: 0, totalErros: 0,
      iniciadoEm: new Date(inicioLote).toISOString(),
      finalizadoEm: '', duracaoMs: 0, concluido: false, cancelado: false,
    });

    if (processoCancelado()) return;

    const novasEntradas = [];
    const payloadsValidos = [];
    let sucessos = 0, falhas = 0, totalInseridos = 0, totalErros = 0;

    for (let index = 0; index < files.length; index += 1) {
      if (processoCancelado()) break;

      const file = files[index];
      const inicioArquivo = Date.now();
      const nomeArquivo = getFilePath(file) || file.name;

      setStatusImportacao((prev) => ({
        ...prev,
        arquivoAtual: nomeArquivo,
        arquivoIndex: index + 1,
        etapa: 'Lendo arquivo',
        duracaoMs: Date.now() - inicioLote,
      }));

      try {
        let payload;
        let erros = [];

        if (modoNegociacao) {
          setStatusImportacao((prev) => ({
            ...prev,
            etapa: `Lendo planilha de negociação (${tipoNegociacao})...`,
            duracaoMs: Date.now() - inicioLote,
          }));
          payload = await montarPayloadNegociacao(
            file,
            tipoNegociacao,
            canalImportacao,
            tabelaNegociacaoSelecionada
          );
          erros = [...(payload.erros || [])];
        } else {
          const parsed = await parseFileToRows(file, tipo);
          if (processoCancelado()) break;
          setStatusImportacao((prev) => ({ ...prev, etapa: 'Montando payload', duracaoMs: Date.now() - inicioLote }));
          payload = buildImportPayload(parsed, tipo, { canal: canalImportacao });
          erros = [...(payload.erros || [])];
        }

        if (processoCancelado()) break;

        payloadsValidos.push(payload);

        const entrada = {
          arquivo: nomeArquivo,
          tipo: modoNegociacao ? `negociacao:${tabelaNegociacaoSelecionada?.transportadora || '?'}` : tipo,
          canal: canalImportacao,
          inseridos: payload.inseridos,
          erros,
          meta: payload.meta || {},
          duracaoMs: Date.now() - inicioArquivo,
          status: erros.length ? 'concluido-com-erros' : 'concluido',
          criadoEm: new Date(inicioArquivo).toISOString(),
          finalizadoEm: new Date().toISOString(),
          etapaAtual: 'Aguardando gravação do lote',
          destino,
          tabelaNegociacaoNome: modoNegociacao
            ? `${tabelaNegociacaoSelecionada?.transportadora}${tabelaNegociacaoSelecionada?.descricao ? ' — ' + tabelaNegociacaoSelecionada.descricao : ''}`
            : undefined,
          tipoNegociacao: modoNegociacao ? tipoNegociacao : undefined,
        };

        sucessos += 1;
        totalInseridos += entrada.inseridos || 0;
        totalErros += entrada.erros?.length || 0;
        novasEntradas.push(entrada);
      } catch (error) {
        const entradaErro = {
          arquivo: nomeArquivo,
          tipo: modoNegociacao ? 'negociacao' : tipo,
          canal: canalImportacao,
          inseridos: 0,
          erros: [{ linha: '-', coluna: 'arquivo', valor: '', mensagem: error.message || 'Erro ao ler arquivo.' }],
          duracaoMs: Date.now() - inicioArquivo,
          status: 'erro',
          criadoEm: new Date(inicioArquivo).toISOString(),
          finalizadoEm: new Date().toISOString(),
          etapaAtual: 'Falha ao processar arquivo',
        };
        falhas += 1;
        totalErros += entradaErro.erros.length;
        novasEntradas.push(entradaErro);
      }

      setStatusImportacao((prev) => ({
        ...prev, sucessos, falhas, totalInseridos, totalErros,
        duracaoMs: Date.now() - inicioLote,
        etapa: index + 1 < files.length ? 'Preparando próximo arquivo' : 'Gravando lote na base',
      }));
    }

    if (processoCancelado()) {
      setStatusImportacao((prev) => ({
        ...prev, etapa: 'Cancelado pelo usuário',
        finalizadoEm: new Date().toISOString(), duracaoMs: Date.now() - inicioLote,
        concluido: true, cancelado: true, sucessos, falhas, totalInseridos, totalErros,
      }));
      setProcessando(false);
      return;
    }

    let resultado = { ok: true };

    if (payloadsValidos.length) {
      setStatusImportacao((prev) => ({ ...prev, etapa: 'Gravando na base...' }));
      try {
        if (modoNegociacao) {
          const todosItens = payloadsValidos.flatMap((p) => p.itensNegociacao || []);
          await substituirItensTabelaNegociacao(tabelaNegociacaoSelecionada, todosItens);
          totalInseridos = todosItens.length;
          novasEntradas.forEach((e) => {
            if (e.status !== 'erro') { e.inseridos = totalInseridos; e.etapaAtual = 'Finalizado'; }
          });
        } else if (typeof store.importarLoteESalvar === 'function') {
          resultado = await store.importarLoteESalvar(payloadsValidos, tipo);
        } else {
          for (const payload of payloadsValidos) {
            const parcial = await store.importarESalvar(payload, tipo);
            if (parcial?.ok === false) { resultado = parcial; break; }
          }
        }
      } catch (error) {
        resultado = { ok: false, erro: error };
      }
    }

    if (resultado?.ok === false) {
      falhas += payloadsValidos.length || 1;
      totalErros += 1;
      novasEntradas.forEach((entrada) => {
        if (entrada.status !== 'erro') {
          entrada.status = 'erro';
          entrada.erros = [
            ...(entrada.erros || []),
            { linha: '-', coluna: 'supabase', valor: '', mensagem: resultado?.erro?.message || 'Falha ao salvar o lote no Supabase.' },
          ];
          entrada.etapaAtual = 'Falha ao gravar lote';
        }
      });
    } else {
      novasEntradas.forEach((entrada) => { if (entrada.status !== 'erro') entrada.etapaAtual = 'Finalizado'; });
    }

    if (processoCancelado()) { setProcessando(false); return; }

    await Promise.all(
      novasEntradas.map(async (entrada) => {
        try {
          await registrarImportacao(entrada);
        } catch (registroError) {
          entrada.erros = [
            ...(entrada.erros || []),
            { linha: '-', coluna: 'registro', valor: '', mensagem: `Importado, mas não foi possível registrar histórico: ${registroError.message || 'erro desconhecido'}` },
          ];
          entrada.status = entrada.status === 'erro' ? 'erro' : 'concluido-com-erros';
        }
      })
    );

    if (processoCancelado()) { setProcessando(false); return; }

    const finalizadoEm = new Date().toISOString();
    const duracaoMs = Date.now() - inicioLote;
    const historicoAtualizado = consolidarHistorico([...novasEntradas, ...historico]);

    setHistorico(historicoAtualizado);
    setDetalhe(novasEntradas[0] || historicoAtualizado[0] || null);
    setPastaArquivos((prev) =>
      prev.map((item) => {
        const importadoAgora = novasEntradas.some(
          (entrada) => getFileKey(entrada.arquivo) === getFileKey(item.arquivo) && entrada.status !== 'erro'
        );
        return importadoAgora ? { ...item, status: 'Já importado', selecionado: false } : item;
      })
    );
    setStatusImportacao((prev) => ({
      ...prev,
      etapa: falhas ? 'Concluído com alertas' : 'Concluído com sucesso',
      finalizadoEm, duracaoMs, concluido: true,
      arquivoAtual: novasEntradas[novasEntradas.length - 1]?.arquivo || prev.arquivoAtual,
      arquivoIndex: files.length, sucessos, falhas, totalInseridos, totalErros, cancelado: false,
    }));
    setProcessando(false);
  };

  const handleFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    cancelarProcessamentoRef.current = true;
    setProcessando(false);
    await processarArquivos(files);
    event.target.value = '';
    setInputResetKey((prev) => prev + 1);
  };

  const handleFolder = async (event) => {
    const files = Array.from(event.target.files || []);
    cancelarProcessamentoRef.current = true;
    setProcessando(false);
    setPastaArquivos(calcularControlePasta(files, historico, tipo));
    event.target.value = '';
    setInputResetKey((prev) => prev + 1);
  };

  const arquivosPendentesPasta = pastaArquivos.filter((item) => item.selecionado && item.status === 'Pendente');
  const totalPendentesPasta = pastaArquivos.filter((item) => item.status === 'Pendente').length;
  const totalImportadosPasta = pastaArquivos.filter((item) => item.status === 'Já importado').length;
  const importarPendentesPasta = async () => { await processarArquivos(arquivosPendentesPasta.map((item) => item.file)); };
  const alternarArquivoPasta = (id) => {
    setPastaArquivos((prev) =>
      prev.map((item) => item.id === id && item.status === 'Pendente' ? { ...item, selecionado: !item.selecionado } : item)
    );
  };
  const exportarControlePastaAtual = () => {
    exportarControlePasta(
      pastaArquivos.map(({ file, ...item }) => ({ ...item, tipo, modificadoEm: formatarDataHora(item.modificadoEm) })),
      `controle-pasta-importacao-${tipo}.xlsx`
    );
  };

  const progressoPercentual = statusImportacao.totalArquivos
    ? Math.round((statusImportacao.arquivoIndex / statusImportacao.totalArquivos) * 100)
    : 0;
  const ultimoProcessamento = historico[0] || detalhe;

  return (
    <div className="page-shell">
      <div className="page-top between start-mobile">
        <div className="page-header">
          <h1>Importação e Cobertura</h1>
          <p>Importe em massa por tipo, baixe o modelo correto e veja onde ainda falta informação.</p>
        </div>
        <button className="btn-secondary" onClick={onAbrirTransportadoras}>Abrir cadastros</button>
      </div>

      <div className="summary-strip">
        <SummaryCard title="Origens monitoradas" value={cobertura.totais.origens} subtitle="origens com alguma configuração" />
        <SummaryCard title="Cobertura completa" value={cobertura.totais.completas} subtitle="com rotas, cotações e generalidades" />
        <SummaryCard title="Pendências" value={cobertura.totais.pendentes} subtitle="origens que ainda precisam de carga" />
        <SummaryCard title="Destinos mapeados" value={cobertura.totais.destinos} subtitle="soma dos destinos identificados" />
      </div>

      <div className="feature-grid import-grid">
        <div className="panel-card">
          <div className="panel-title">⬆️ Importação em massa</div>

          {/* ── Destino ────────────────────────────────────────────────── */}
          <div style={{ margin: '4px 0 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}>Destino da importação</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className={!modoNegociacao ? 'toggle-btn active' : 'toggle-btn'}
                onClick={() => setDestino('transportadora')}
                disabled={processando}
              >
                Transportadoras
              </button>
              <button
                type="button"
                className={modoNegociacao ? 'toggle-btn active' : 'toggle-btn'}
                onClick={() => setDestino('negociacao')}
                disabled={processando}
              >
                Negociação
              </button>
            </div>
          </div>

          {/* ── Seletor de tabela de negociação ─────────────────────────── */}
          {modoNegociacao && (
            <div style={{ background: 'var(--panel-soft, #f8fafc)', border: '1px solid var(--border-color, #e2e8f0)', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>Tabela de negociação que receberá os itens</span>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={carregarTabelasNegociacao}
                  disabled={carregandoNegociacoes || processando}
                >
                  {carregandoNegociacoes ? 'Carregando...' : '↻ Atualizar'}
                </button>
              </div>

              {erroNegociacoes && (
                <div style={{ color: '#9b2323', fontSize: 12, marginBottom: 8, padding: '6px 10px', background: '#fff1f1', borderRadius: 6 }}>
                  {erroNegociacoes}
                </div>
              )}

              {tabelasNegociacao.length === 0 && !carregandoNegociacoes ? (
                <div style={{ color: 'var(--muted)', fontSize: 12, padding: '8px 0' }}>
                  Nenhuma tabela de negociação fracionado encontrada. Crie uma em <strong>Tabelas Negociação</strong> primeiro.
                </div>
              ) : (
                <div className="field" style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}>Selecionar tabela</label>
                  <select
                    value={tabelaNegociacaoId}
                    onChange={(e) => setTabelaNegociacaoId(e.target.value)}
                    disabled={processando || carregandoNegociacoes}
                    style={{ width: '100%' }}
                  >
                    {carregandoNegociacoes && <option value="">Carregando tabelas...</option>}
                    {!carregandoNegociacoes && tabelasNegociacao.length === 0 && <option value="">Nenhuma tabela encontrada</option>}
                    {tabelasNegociacao.map((tabela) => (
                      <option key={tabela.id} value={tabela.id}>
                        {`${tabela.transportadora || 'Sem transportadora'} — ${tabela.canal || 'Sem canal'} — ${tabela.status || 'Sem status'}${tabela.descricao ? ` — ${tabela.descricao}` : ''}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{ marginTop: 10 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--muted)', marginBottom: 6 }}>
                  O que importar para a negociação
                </label>
                <div className="toggle-row wrap">
                  <button
                    type="button"
                    className={tipoNegociacao === 'fretes' ? 'toggle-btn active' : 'toggle-btn'}
                    onClick={() => setTipoNegociacao('fretes')}
                    disabled={processando}
                  >
                    Só Fretes
                  </button>
                  <button
                    type="button"
                    className={tipoNegociacao === 'rotas' ? 'toggle-btn active' : 'toggle-btn'}
                    onClick={() => setTipoNegociacao('rotas')}
                    disabled={processando}
                  >
                    Só Rotas
                  </button>
                  <button
                    type="button"
                    className={tipoNegociacao === 'ambos' ? 'toggle-btn active' : 'toggle-btn'}
                    onClick={() => setTipoNegociacao('ambos')}
                    disabled={processando}
                  >
                    Rotas + Fretes
                  </button>
                </div>
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>
                  {tipoNegociacao === 'fretes' && 'Usa o mesmo importador padrão de Fretes/Cotações da tela de Transportadoras, lendo a primeira aba do arquivo.'}
                  {tipoNegociacao === 'rotas' && 'Usa o mesmo importador padrão de Rotas da tela de Transportadoras, lendo a primeira aba do arquivo.'}
                  {tipoNegociacao === 'ambos' && 'Usa o importador de tabela pronta e exige abas chamadas Rotas e Fretes no mesmo arquivo.'}
                </div>
              </div>

              {tabelaNegociacaoSelecionada && (
                <div style={{ marginTop: 10, padding: '6px 10px', background: '#e1f5ee', borderRadius: 6, fontSize: 12, color: '#085041' }}>
                  ✓ Destino: <strong>{tabelaNegociacaoSelecionada.transportadora}</strong>
                  {tabelaNegociacaoSelecionada.descricao ? ` — ${tabelaNegociacaoSelecionada.descricao}` : ''}. Os itens existentes desta tabela serão substituídos.
                </div>
              )}
            </div>
          )}

          {/* ── Tipo de dado (só transportadoras) ───────────────────────── */}
          {!modoNegociacao && (
            <div className="toggle-row wrap">
              {TIPOS.map((item) => (
                <button
                  key={item.id}
                  className={tipo === item.id ? 'toggle-btn active' : 'toggle-btn'}
                  onClick={() => setTipo(item.id)}
                  disabled={processando}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}

          <p>
            {modoNegociacao
              ? 'Escolha se a importação da negociação deve ler só Fretes, só Rotas ou as duas abas. Os itens existentes na tabela selecionada serão substituídos pelos do novo arquivo.'
              : 'Use os modelos para não errar o layout. O importador já tenta ler o cabeçalho real mesmo quando ele começa algumas linhas abaixo.'}
          </p>

          <div className="channel-picker">
            <div className="field small-width">
              <label>Canal da importação</label>
              <select value={canalImportacao} onChange={(e) => setCanalImportacao(e.target.value)} disabled={processando}>
                <option value="ATACADO">ATACADO</option>
                <option value="B2C">B2C</option>
              </select>
            </div>
            <div className="hint-box compact">
              {modoNegociacao
                ? 'O canal da tabela de negociação está definido no cadastro. Este canal é usado apenas como referência no histórico.'
                : <>O canal escolhido será usado quando a planilha não trouxer a coluna <strong>Canal</strong> ou quando o código da unidade não indicar B2C.</>}
            </div>
          </div>

          <div className="toolbar-wrap">
            {!modoNegociacao && (
              <>
                <button className="btn-secondary" onClick={() => baixarModelo(tipo)} disabled={processando}>Baixar Modelo</button>
                <button className="btn-secondary" onClick={exportarMassa} disabled={processando}>Exportar Atual</button>
              </>
            )}
            <button className="btn-secondary" type="button" onClick={limparProcessamento}>Limpar fila / liberar tela</button>
            <button className="btn-danger" type="button" onClick={pararProcessamento}>Parar processamento</button>
            <label className={`btn-primary inline-upload ${processando ? 'disabled-like' : ''}`}>
              {processando ? 'Importando...' : modoNegociacao ? 'Importar para negociação' : 'Importar arquivos'}
              <input
                key={`arquivos-${inputResetKey}`}
                type="file"
                accept=".xlsx,.xls,.csv"
                multiple={!modoNegociacao}
                onChange={handleFiles}
                hidden
                disabled={processando || (modoNegociacao && !tabelaNegociacaoSelecionada)}
              />
            </label>
            {!modoNegociacao && (
              <label className={`btn-secondary inline-upload ${processando ? 'disabled-like' : ''}`}>
                Mapear pasta
                <input key={`pasta-${inputResetKey}`} type="file" accept=".xlsx,.xls,.csv" multiple onChange={handleFolder} hidden disabled={processando} {...{ webkitdirectory: 'true', directory: '' }} />
              </label>
            )}
          </div>

          {!modoNegociacao && (
            <div className="hint-box top-space">
              <strong>Modo seguro ativo:</strong><br />
              • Rotas atualizam só <strong>rotas</strong>.<br />
              • Fretes/Cotações atualizam só <strong>cotações</strong>.<br />
              • Taxas atualizam só <strong>taxas especiais</strong>.<br />
              • Generalidades atualizam só <strong>generalidades</strong>.<br />
              • Recomendado: subir até <strong>{LIMITE_SUGERIDO_ARQUIVOS} arquivos por lote</strong> para acompanhar melhor o processamento.
            </div>
          )}

          {pastaArquivos.length > 0 && !modoNegociacao && (
            <div className="folder-control-box">
              <div className="card-topo">
                <div>
                  <div className="list-title">Controle da pasta mapeada</div>
                  <div className="detail-subtitle">{pastaArquivos.length} arquivo(s) · {totalPendentesPasta} pendente(s) · {totalImportadosPasta} já importado(s)</div>
                </div>
                <div className="toolbar-wrap compact-actions">
                  <button className="btn-primary" onClick={importarPendentesPasta} disabled={processando || !arquivosPendentesPasta.length}>Importar pendentes selecionados</button>
                  <button className="btn-secondary" onClick={exportarControlePastaAtual} disabled={!pastaArquivos.length}>Exportar controle</button>
                </div>
              </div>
              <div className="folder-file-list">
                {pastaArquivos.slice(0, 12).map((item) => (
                  <label className="folder-file-item" key={item.id}>
                    <input type="checkbox" checked={item.selecionado} disabled={item.status !== 'Pendente' || processando} onChange={() => alternarArquivoPasta(item.id)} />
                    <span className="folder-file-name">{item.caminho}</span>
                    <span className={`coverage-badge ${item.status === 'Pendente' ? 'warn' : 'ok'}`}>{item.status}</span>
                  </label>
                ))}
                {pastaArquivos.length > 12 && (
                  <div className="detail-subtitle">Exibindo 12 de {pastaArquivos.length}. Use "Exportar controle" para ver a lista completa.</div>
                )}
              </div>
            </div>
          )}

          <div className="import-status-box">
            <div className="card-topo">
              <div>
                <div className="list-title">Status da importação</div>
                <div className="detail-subtitle">
                  {processando ? `Processando ${statusImportacao.arquivoIndex} de ${statusImportacao.totalArquivos}` : statusImportacao.concluido ? 'Último lote finalizado' : 'Aguardando novo lote'}
                </div>
              </div>
              <span className={`coverage-badge ${statusImportacao.cancelado || statusImportacao.falhas ? 'warn' : 'ok'}`}>{statusImportacao.etapa}</span>
            </div>
            <div className="import-progress-track">
              <div className="import-progress-fill" style={{ width: `${progressoPercentual}%` }} />
            </div>
            <div className="summary-strip import-mini-summary">
              <SummaryCard title="Progresso" value={`${progressoPercentual}%`} subtitle={statusImportacao.totalArquivos ? `${statusImportacao.arquivoIndex}/${statusImportacao.totalArquivos} arquivo(s)` : 'nenhum lote ativo'} />
              <SummaryCard title="Inseridos" value={statusImportacao.totalInseridos} subtitle="registros aceitos no lote" />
              <SummaryCard title="Alertas / erros" value={statusImportacao.totalErros} subtitle={`${statusImportacao.falhas} arquivo(s) com falha`} />
              <SummaryCard title="Duração" value={formatarDuracao(statusImportacao.duracaoMs || (processando && statusImportacao.iniciadoEm ? Date.now() - new Date(statusImportacao.iniciadoEm).getTime() : 0))} subtitle={statusImportacao.iniciadoEm ? `iniciado em ${formatarDataHora(statusImportacao.iniciadoEm)}` : 'sem processamento recente'} />
            </div>
            <div className="toolbar-wrap compact-actions top-space">
              <button className="btn-secondary" type="button" onClick={limparProcessamento}>Limpar e liberar nova importação</button>
              <button className="btn-danger" type="button" onClick={pararProcessamento}>Parar agora</button>
            </div>
            <div className="hint-box compact">
              <strong>Arquivo atual:</strong> {statusImportacao.arquivoAtual || '—'}<br />
              <strong>Etapa:</strong> {statusImportacao.etapa}<br />
              <strong>Finalizado em:</strong> {formatarDataHora(statusImportacao.finalizadoEm)}
              {statusImportacao.cancelado ? (<><br /><strong>Observação:</strong> processamento cancelado/limpo na tela. Se algum arquivo já estava gravando no Supabase, aguarde alguns segundos e clique em Atualizar base.</>) : null}
            </div>
          </div>
        </div>

        <div className="panel-card">
          <div className="card-topo">
            <div className="panel-title">🧠 Últimos processamentos</div>
            <button className="btn-secondary" type="button" onClick={limparHistoricoLocal}>Limpar histórico local</button>
          </div>
          <div className="list-stack compact-list">
            {historico.length ? (
              historico.map((item, index) => (
                <div className="process-card" key={`${item.arquivo}-${item.criadoEm || index}`} onClick={() => setDetalhe(item)}>
                  <div className="card-topo">
                    <div>
                      <div className="detail-title">{item.arquivo}</div>
                      <div className="detail-subtitle">
                        {item.destino === 'negociacao' && item.tabelaNegociacaoNome
                          ? <>Negociação: <strong>{item.tabelaNegociacaoNome}</strong> · Tipo: {item.tipoNegociacao || 'fretes'} · Itens: {item.inseridos}</>
                          : <>Tipo: {item.tipo} · Canal: {item.canal} · Inseridos: {item.inseridos}</>}
                      </div>
                    </div>
                    <span className={`coverage-badge ${item.status === 'erro' ? 'warn' : 'ok'}`}>
                      {item.status === 'erro' ? 'Erro' : item.erros?.length ? 'Com alertas' : 'OK'}
                    </span>
                  </div>
                  <div className="detail-subtitle">{item.erros?.length ? `${item.erros.length} inconsistência(s)` : 'Sem inconsistências'}</div>
                  <div className="detail-subtitle">{formatarDataHora(item.finalizadoEm || item.criadoEm)} · {formatarDuracao(item.duracaoMs)}</div>
                </div>
              ))
            ) : (
              <div className="empty-note">Ainda não houve importações registradas.</div>
            )}
          </div>

          {detalhe && (
            <div className="detail-box">
              <div className="card-topo">
                <div>
                  <div className="detail-title">{detalhe.arquivo}</div>
                  <div className="detail-subtitle">
                    {detalhe.destino === 'negociacao'
                      ? <>Negociação: {detalhe.tabelaNegociacaoNome} · Tipo: {detalhe.tipoNegociacao || 'fretes'} · Itens: {detalhe.inseridos}</>
                      : <>Tipo: {detalhe.tipo} · Inseridos: {detalhe.inseridos}</>}
                  </div>
                </div>
                <span className={`coverage-badge ${detalhe.status === 'erro' ? 'warn' : 'ok'}`}>
                  {detalhe.status === 'erro' ? 'Erro' : detalhe.erros?.length ? 'Concluído com alertas' : 'Concluído'}
                </span>
              </div>
              <div className="detail-subtitle">Canal: {detalhe.canal} · Processado em {formatarDataHora(detalhe.finalizadoEm || detalhe.criadoEm)} · Duração {formatarDuracao(detalhe.duracaoMs)}</div>
              {detalhe.erros?.length ? (
                <div className="table-card slim-table">
                  <table>
                    <thead><tr><th>Linha</th><th>Coluna</th><th>Valor</th><th>Mensagem</th></tr></thead>
                    <tbody>
                      {detalhe.erros.map((erro, idx) => (
                        <tr key={`${erro.linha}-${idx}`}><td>{erro.linha}</td><td>{erro.coluna}</td><td>{erro.valor}</td><td>{erro.mensagem}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="hint-box compact">Arquivo processado sem inconsistências.</div>
              )}
            </div>
          )}
          {!detalhe && ultimoProcessamento && (
            <div className="hint-box compact">Último processamento: <strong>{ultimoProcessamento.arquivo}</strong></div>
          )}
        </div>
      </div>

      {!modoNegociacao && (
        <div className="table-card">
          <div className="card-topo">
            <div>
              <div className="list-title">Cobertura por origem</div>
              <div className="list-subtitle">Use este painel para saber onde ainda falta rota, frete ou generalidades.</div>
            </div>
            <div className="field small-width">
              <label>Buscar origem / transportadora</label>
              <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Ex.: Alta Floresta ou Gercadi" />
            </div>
          </div>
          <table>
            <thead>
              <tr><th>Transportadora</th><th>Origem</th><th>Canal</th><th>Generalidades</th><th>Rotas</th><th>Fretes</th><th>Status</th></tr>
            </thead>
            <tbody>
              {pendencias.map((item) => (
                <tr key={`${item.transportadora}-${item.origem}-${item.canal}`}>
                  <td>{item.transportadora}</td><td>{item.origem}</td><td>{item.canal}</td>
                  <td>{item.generalidades ? 'OK' : 'Pendente'}</td>
                  <td>{item.rotas}</td><td>{item.cotacoes}</td>
                  <td><span className={item.status === 'Completa' ? 'coverage-badge ok' : 'coverage-badge warn'}>{item.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
