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
      const chave = [
        item.arquivo,
        item.tipo,
        item.canal,
        item.criadoEm || item.finalizadoEm || '',
      ].join('|');
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
  return String(value || '')
    .split('/')
    .pop()
    .trim()
    .toLowerCase();
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

  useEffect(() => {
    let ativo = true;

    async function carregarHistorico() {
      try {
        const remoto = await listarImportacoes(LIMITE_HISTORICO);
        if (!ativo || !remoto?.length) return;
        const combinado = consolidarHistorico([
          ...remoto.map(mapImportacaoRemota),
          ...carregarHistoricoLocal(),
        ]);
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
    return () => {
      ativo = false;
    };
  }, []);

  useEffect(() => {
    persistirHistoricoLocal(historico);
  }, [historico]);

  const cobertura = useMemo(
    () => buildCoberturaReport(transportadoras),
    [transportadoras]
  );

  const pendencias = useMemo(
    () =>
      cobertura.detalhes.filter(
        (item) =>
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
          codigoUnidade:
            origem.canal === 'B2C' ? '0001 - B2C' : '0001 - B2B',
        };

        if (tipo === 'rotas') {
          rows.push(...(origem.rotas || []).map((item) => ({ ...base, ...item })));
        }

        if (tipo === 'cotacoes') {
          rows.push(...(origem.cotacoes || []).map((item) => ({ ...base, ...item })));
        }

        if (tipo === 'taxas') {
          rows.push(
            ...(origem.taxasEspeciais || []).map((item) => ({ ...base, ...item }))
          );
        }

        if (tipo === 'generalidades' && origem.generalidades) {
          rows.push({ ...base, ...origem.generalidades });
        }
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
    setStatusImportacao({
      ...STATUS_IMPORTACAO_INICIAL,
      etapa,
      finalizadoEm: new Date().toISOString(),
      concluido: true,
      cancelado: true,
    });
  };

  const limparProcessamento = () => {
    resetarTelaImportacao('Fila limpa');
  };

  const pararProcessamento = () => {
    resetarTelaImportacao('Cancelado pelo usuário');
  };

  const limparHistoricoLocal = () => {
    setHistorico([]);
    setDetalhe(null);
    persistirHistoricoLocal([]);
  };

  const processarArquivos = async (filesOriginais) => {
    const files = Array.from(filesOriginais || []).filter((file) => /\.(xlsx|xls|csv)$/i.test(file.name || ''));
    if (!files.length) return;

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
      etapa: 'Preparando importação',
      sucessos: 0,
      falhas: 0,
      totalInseridos: 0,
      totalErros: 0,
      iniciadoEm: new Date(inicioLote).toISOString(),
      finalizadoEm: '',
      duracaoMs: 0,
      concluido: false,
      cancelado: false,
    });

    if (processoCancelado()) return;

    const novasEntradas = [];
    const payloadsValidos = [];
    let sucessos = 0;
    let falhas = 0;
    let totalInseridos = 0;
    let totalErros = 0;

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
        const parsed = await parseFileToRows(file, tipo);

        if (processoCancelado()) break;

        setStatusImportacao((prev) => ({
          ...prev,
          etapa: 'Montando payload',
          duracaoMs: Date.now() - inicioLote,
        }));

        const payload = buildImportPayload(parsed, tipo, {
          canal: canalImportacao,
        });
        const erros = [...(payload.erros || [])];

        if (processoCancelado()) break;

        payloadsValidos.push(payload);

        const entrada = {
          arquivo: nomeArquivo,
          tipo,
          canal: canalImportacao,
          inseridos: payload.inseridos,
          erros,
          meta: parsed.meta,
          duracaoMs: Date.now() - inicioArquivo,
          status: erros.length ? 'concluido-com-erros' : 'concluido',
          criadoEm: new Date(inicioArquivo).toISOString(),
          finalizadoEm: new Date().toISOString(),
          etapaAtual: 'Aguardando gravação do lote',
        };

        sucessos += 1;
        totalInseridos += entrada.inseridos || 0;
        totalErros += entrada.erros?.length || 0;
        novasEntradas.push(entrada);
      } catch (error) {
        const entradaErro = {
          arquivo: nomeArquivo,
          tipo,
          canal: canalImportacao,
          inseridos: 0,
          erros: [
            {
              linha: '-',
              coluna: 'arquivo',
              valor: '',
              mensagem: error.message || 'Erro ao ler arquivo.',
            },
          ],
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
        ...prev,
        sucessos,
        falhas,
        totalInseridos,
        totalErros,
        duracaoMs: Date.now() - inicioLote,
        etapa: index + 1 < files.length ? 'Preparando próximo arquivo' : 'Gravando lote na base',
      }));
    }

    if (processoCancelado()) {
      const finalizadoEm = new Date().toISOString();
      const duracaoMs = Date.now() - inicioLote;
      setStatusImportacao((prev) => ({
        ...prev,
        etapa: 'Cancelado pelo usuário',
        finalizadoEm,
        duracaoMs,
        concluido: true,
        cancelado: true,
        sucessos,
        falhas,
        totalInseridos,
        totalErros,
      }));
      setProcessando(false);
      return;
    }

    if (processoCancelado()) {
      setProcessando(false);
      return;
    }

    let resultado = { ok: true };
    if (payloadsValidos.length) {
      setStatusImportacao((prev) => ({ ...prev, etapa: 'Gravando lote na base' }));
      try {
        if (typeof store.importarLoteESalvar === 'function') {
          resultado = await store.importarLoteESalvar(payloadsValidos, tipo);
        } else {
          // Fallback para versões antigas do store.
          for (const payload of payloadsValidos) {
            const parcial = await store.importarESalvar(payload, tipo);
            if (parcial?.ok === false) {
              resultado = parcial;
              break;
            }
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
            {
              linha: '-',
              coluna: 'supabase',
              valor: '',
              mensagem: resultado?.erro?.message || 'Falha ao salvar o lote no Supabase.',
            },
          ];
          entrada.etapaAtual = 'Falha ao gravar lote';
        }
      });
    } else {
      novasEntradas.forEach((entrada) => {
        if (entrada.status !== 'erro') entrada.etapaAtual = 'Finalizado';
      });
    }

    if (processoCancelado()) {
      const finalizadoEm = new Date().toISOString();
      const duracaoMs = Date.now() - inicioLote;
      setStatusImportacao((prev) => ({
        ...prev,
        etapa: 'Cancelado pelo usuário',
        finalizadoEm,
        duracaoMs,
        concluido: true,
        cancelado: true,
        sucessos,
        falhas,
        totalInseridos,
        totalErros,
      }));
      setProcessando(false);
      return;
    }

    await Promise.all(
      novasEntradas.map(async (entrada) => {
        try {
          await registrarImportacao(entrada);
        } catch (registroError) {
          entrada.erros = [
            ...(entrada.erros || []),
            {
              linha: '-',
              coluna: 'registro',
              valor: '',
              mensagem: `Importado, mas não foi possível registrar histórico: ${registroError.message || 'erro desconhecido'}`,
            },
          ];
          entrada.status = entrada.status === 'erro' ? 'erro' : 'concluido-com-erros';
        }
      })
    );

    if (processoCancelado()) {
      setProcessando(false);
      return;
    }

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
      finalizadoEm,
      duracaoMs,
      concluido: true,
      arquivoAtual: novasEntradas[novasEntradas.length - 1]?.arquivo || prev.arquivoAtual,
      arquivoIndex: files.length,
      sucessos,
      falhas,
      totalInseridos,
      totalErros,
      cancelado: false,
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

  const importarPendentesPasta = async () => {
    await processarArquivos(arquivosPendentesPasta.map((item) => item.file));
  };

  const alternarArquivoPasta = (id) => {
    setPastaArquivos((prev) =>
      prev.map((item) =>
        item.id === id && item.status === 'Pendente'
          ? { ...item, selecionado: !item.selecionado }
          : item
      )
    );
  };

  const exportarControlePastaAtual = () => {
    exportarControlePasta(
      pastaArquivos.map(({ file, ...item }) => ({
        ...item,
        tipo,
        modificadoEm: formatarDataHora(item.modificadoEm),
      })),
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
          <p>
            Importe em massa por tipo, baixe o modelo correto e veja onde ainda
            falta informação.
          </p>
        </div>

        <button className="btn-secondary" onClick={onAbrirTransportadoras}>
          Abrir cadastros
        </button>
      </div>

      <div className="summary-strip">
        <SummaryCard
          title="Origens monitoradas"
          value={cobertura.totais.origens}
          subtitle="origens com alguma configuração"
        />
        <SummaryCard
          title="Cobertura completa"
          value={cobertura.totais.completas}
          subtitle="com rotas, cotações e generalidades"
        />
        <SummaryCard
          title="Pendências"
          value={cobertura.totais.pendentes}
          subtitle="origens que ainda precisam de carga"
        />
        <SummaryCard
          title="Destinos mapeados"
          value={cobertura.totais.destinos}
          subtitle="soma dos destinos identificados"
        />
      </div>

      <div className="feature-grid import-grid">
        <div className="panel-card">
          <div className="panel-title">⬆️ Importação em massa</div>

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

          <p>
            Use os modelos para não errar o layout. O importador já tenta ler o
            cabeçalho real mesmo quando ele começa algumas linhas abaixo.
          </p>

          <div className="channel-picker">
            <div className="field small-width">
              <label>Canal da importação</label>
              <select
                value={canalImportacao}
                onChange={(e) => setCanalImportacao(e.target.value)}
                disabled={processando}
              >
                <option value="ATACADO">ATACADO</option>
                <option value="B2C">B2C</option>
              </select>
            </div>

            <div className="hint-box compact">
              O canal escolhido será usado quando a planilha não trouxer a
              coluna <strong>Canal</strong> ou quando o código da unidade não
              indicar B2C.
            </div>
          </div>

          <div className="toolbar-wrap">
            <button className="btn-secondary" onClick={() => baixarModelo(tipo)} disabled={processando}>
              Baixar Modelo
            </button>

            <button className="btn-secondary" onClick={exportarMassa} disabled={processando}>
              Exportar Atual
            </button>

            <button
              className="btn-secondary"
              type="button"
              onClick={limparProcessamento}
            >
              Limpar fila / liberar tela
            </button>

            <button
              className="btn-danger"
              type="button"
              onClick={pararProcessamento}
            >
              Parar processamento
            </button>

            <label className={`btn-primary inline-upload ${processando ? 'disabled-like' : ''}`}>
              {processando ? 'Importando arquivos...' : 'Importar arquivos'}
              <input
                key={`arquivos-${inputResetKey}`}
                type="file"
                accept=".xlsx,.xls,.csv"
                multiple
                onChange={handleFiles}
                hidden
                disabled={processando}
              />
            </label>

            <label className={`btn-secondary inline-upload ${processando ? 'disabled-like' : ''}`}>
              Mapear pasta
              <input
                key={`pasta-${inputResetKey}`}
                type="file"
                accept=".xlsx,.xls,.csv"
                multiple
                onChange={handleFolder}
                hidden
                disabled={processando}
                {...{ webkitdirectory: 'true', directory: '' }}
              />
            </label>
          </div>

          <div className="hint-box top-space">
            <strong>Modo seguro ativo:</strong>
            <br />
            • Rotas atualizam só <strong>rotas</strong>.
            <br />
            • Fretes/Cotações atualizam só <strong>cotações</strong>.
            <br />
            • Taxas atualizam só <strong>taxas especiais</strong>.
            <br />
            • Generalidades atualizam só <strong>generalidades</strong>.
            <br />
            • Recomendado: subir até <strong>{LIMITE_SUGERIDO_ARQUIVOS} arquivos por lote</strong> para acompanhar melhor o processamento.
          </div>

          {pastaArquivos.length > 0 && (
            <div className="folder-control-box">
              <div className="card-topo">
                <div>
                  <div className="list-title">Controle da pasta mapeada</div>
                  <div className="detail-subtitle">
                    {pastaArquivos.length} arquivo(s) encontrados · {totalPendentesPasta} pendente(s) · {totalImportadosPasta} já importado(s)
                  </div>
                </div>
                <div className="toolbar-wrap compact-actions">
                  <button
                    className="btn-primary"
                    onClick={importarPendentesPasta}
                    disabled={processando || !arquivosPendentesPasta.length}
                  >
                    Importar pendentes selecionados
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={exportarControlePastaAtual}
                    disabled={!pastaArquivos.length}
                  >
                    Exportar controle
                  </button>
                </div>
              </div>

              <div className="folder-file-list">
                {pastaArquivos.slice(0, 12).map((item) => (
                  <label className="folder-file-item" key={item.id}>
                    <input
                      type="checkbox"
                      checked={item.selecionado}
                      disabled={item.status !== 'Pendente' || processando}
                      onChange={() => alternarArquivoPasta(item.id)}
                    />
                    <span className="folder-file-name">{item.caminho}</span>
                    <span className={`coverage-badge ${item.status === 'Pendente' ? 'warn' : 'ok'}`}>
                      {item.status}
                    </span>
                  </label>
                ))}
                {pastaArquivos.length > 12 && (
                  <div className="detail-subtitle">
                    Exibindo 12 de {pastaArquivos.length}. Use “Exportar controle” para ver a lista completa.
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="import-status-box">
            <div className="card-topo">
              <div>
                <div className="list-title">Status da importação</div>
                <div className="detail-subtitle">
                  {processando
                    ? `Processando ${statusImportacao.arquivoIndex} de ${statusImportacao.totalArquivos}`
                    : statusImportacao.concluido
                      ? 'Último lote finalizado'
                      : 'Aguardando novo lote'}
                </div>
              </div>
              <span className={`coverage-badge ${statusImportacao.cancelado || statusImportacao.falhas ? 'warn' : 'ok'}`}>
                {statusImportacao.etapa}
              </span>
            </div>

            <div className="import-progress-track">
              <div
                className="import-progress-fill"
                style={{ width: `${progressoPercentual}%` }}
              />
            </div>

            <div className="summary-strip import-mini-summary">
              <SummaryCard
                title="Progresso"
                value={`${progressoPercentual}%`}
                subtitle={statusImportacao.totalArquivos ? `${statusImportacao.arquivoIndex}/${statusImportacao.totalArquivos} arquivo(s)` : 'nenhum lote ativo'}
              />
              <SummaryCard
                title="Inseridos"
                value={statusImportacao.totalInseridos}
                subtitle="registros aceitos no lote"
              />
              <SummaryCard
                title="Alertas / erros"
                value={statusImportacao.totalErros}
                subtitle={`${statusImportacao.falhas} arquivo(s) com falha`}
              />
              <SummaryCard
                title="Duração"
                value={formatarDuracao(statusImportacao.duracaoMs || (processando && statusImportacao.iniciadoEm ? Date.now() - new Date(statusImportacao.iniciadoEm).getTime() : 0))}
                subtitle={statusImportacao.iniciadoEm ? `iniciado em ${formatarDataHora(statusImportacao.iniciadoEm)}` : 'sem processamento recente'}
              />
            </div>

            <div className="toolbar-wrap compact-actions top-space">
              <button className="btn-secondary" type="button" onClick={limparProcessamento}>
                Limpar e liberar nova importação
              </button>
              <button className="btn-danger" type="button" onClick={pararProcessamento}>
                Parar agora
              </button>
            </div>

            <div className="hint-box compact">
              <strong>Arquivo atual:</strong> {statusImportacao.arquivoAtual || '—'}
              <br />
              <strong>Etapa:</strong> {statusImportacao.etapa}
              <br />
              <strong>Finalizado em:</strong> {formatarDataHora(statusImportacao.finalizadoEm)}
              {statusImportacao.cancelado ? (
                <>
                  <br />
                  <strong>Observação:</strong> processamento cancelado/limpo na tela. Se algum arquivo já estava gravando no Supabase, aguarde alguns segundos e clique em Atualizar base.
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="panel-card">
          <div className="card-topo">
            <div className="panel-title">🧠 Últimos processamentos</div>
            <button className="btn-secondary" type="button" onClick={limparHistoricoLocal}>
              Limpar histórico local
            </button>
          </div>

          <div className="list-stack compact-list">
            {historico.length ? (
              historico.map((item, index) => (
                <div
                  className="process-card"
                  key={`${item.arquivo}-${item.criadoEm || index}`}
                  onClick={() => setDetalhe(item)}
                >
                  <div className="card-topo">
                    <div>
                      <div className="detail-title">{item.arquivo}</div>
                      <div className="detail-subtitle">
                        Tipo: {item.tipo} · Canal: {item.canal} · Inseridos: {item.inseridos}
                      </div>
                    </div>
                    <span className={`coverage-badge ${item.status === 'erro' ? 'warn' : 'ok'}`}>
                      {item.status === 'erro'
                        ? 'Erro'
                        : item.erros?.length
                          ? 'Com alertas'
                          : 'OK'}
                    </span>
                  </div>
                  <div className="detail-subtitle">
                    {item.erros?.length
                      ? `${item.erros.length} inconsistência(s)`
                      : 'Sem inconsistências'}
                  </div>
                  <div className="detail-subtitle">
                    {formatarDataHora(item.finalizadoEm || item.criadoEm)} · {formatarDuracao(item.duracaoMs)}
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-note">
                Ainda não houve importações registradas.
              </div>
            )}
          </div>

          {detalhe && (
            <div className="detail-box">
              <div className="card-topo">
                <div>
                  <div className="detail-title">{detalhe.arquivo}</div>
                  <div className="detail-subtitle">
                    Tipo: {detalhe.tipo} · Inseridos: {detalhe.inseridos}
                  </div>
                </div>
                <span className={`coverage-badge ${detalhe.status === 'erro' ? 'warn' : 'ok'}`}>
                  {detalhe.status === 'erro'
                    ? 'Erro'
                    : detalhe.erros?.length
                      ? 'Concluído com alertas'
                      : 'Concluído'}
                </span>
              </div>

              <div className="detail-subtitle">
                Canal: {detalhe.canal} · Processado em {formatarDataHora(detalhe.finalizadoEm || detalhe.criadoEm)} · Duração {formatarDuracao(detalhe.duracaoMs)}
              </div>

              {detalhe.erros?.length ? (
                <div className="table-card slim-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Linha</th>
                        <th>Coluna</th>
                        <th>Valor</th>
                        <th>Mensagem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detalhe.erros.map((erro, idx) => (
                        <tr key={`${erro.linha}-${idx}`}>
                          <td>{erro.linha}</td>
                          <td>{erro.coluna}</td>
                          <td>{erro.valor}</td>
                          <td>{erro.mensagem}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="hint-box compact">
                  Arquivo processado sem inconsistências.
                </div>
              )}
            </div>
          )}

          {!detalhe && ultimoProcessamento && (
            <div className="hint-box compact">
              Último processamento: <strong>{ultimoProcessamento.arquivo}</strong>
            </div>
          )}
        </div>
      </div>

      <div className="table-card">
        <div className="card-topo">
          <div>
            <div className="list-title">Cobertura por origem</div>
            <div className="list-subtitle">
              Use este painel para saber onde ainda falta rota, frete ou
              generalidades.
            </div>
          </div>

          <div className="field small-width">
            <label>Buscar origem / transportadora</label>
            <input
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Ex.: Alta Floresta ou Gercadi"
            />
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Transportadora</th>
              <th>Origem</th>
              <th>Canal</th>
              <th>Generalidades</th>
              <th>Rotas</th>
              <th>Fretes</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {pendencias.map((item) => (
              <tr key={`${item.transportadora}-${item.origem}-${item.canal}`}>
                <td>{item.transportadora}</td>
                <td>{item.origem}</td>
                <td>{item.canal}</td>
                <td>{item.generalidades ? 'OK' : 'Pendente'}</td>
                <td>{item.rotas}</td>
                <td>{item.cotacoes}</td>
                <td>
                  <span className={item.status === 'Completa' ? 'coverage-badge ok' : 'coverage-badge warn'}>
                    {item.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
