import { useMemo, useRef, useState } from 'react';
import { parseDescontosObtidosFile } from '../utils/descontosObtidosImport';
import { importarDescontosObtidos } from '../services/descontosObtidosService';

function formatMoeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatInt(valor) {
  return Number(valor || 0).toLocaleString('pt-BR');
}

function StatusCard({ label, value, subtitle }) {
  return (
    <div className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {subtitle ? <span>{subtitle}</span> : null}
    </div>
  );
}

function resumirPorRegra(registros) {
  const resumo = {};
  registros.forEach((r) => {
    resumo[r.regraAplicada] = resumo[r.regraAplicada] || { qtd: 0, valor: 0 };
    resumo[r.regraAplicada].qtd += 1;
    resumo[r.regraAplicada].valor += r.valor;
  });
  return resumo;
}

function filtrarPlanilhas(arquivos) {
  return Array.from(arquivos || []).filter((f) => /\.(xlsx|xls)$/i.test(f.name));
}

const LABEL_REGRA = {
  desc_fin_obtidos: 'Desc. Fin. Obtidos (conta 41301002, centro de custo Transporte)',
  fretes_carretos: 'Fretes e Carretos (conta 32208005, direto)',
};

export default function ImportarDescontosObtidosPage() {
  const [arquivos, setArquivos] = useState([]);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState('');
  const [feedback, setFeedback] = useState('');
  const [previews, setPreviews] = useState([]);
  const [resultados, setResultados] = useState([]);
  const [progresso, setProgresso] = useState(null);
  const inputArquivosRef = useRef(null);
  const inputPastaRef = useRef(null);

  const registrosTotais = useMemo(() => previews.flatMap((p) => p.registros), [previews]);
  const resumoRegra = useMemo(() => resumirPorRegra(registrosTotais), [registrosTotais]);
  const totalLido = previews.length > 0;

  const resumoResultados = useMemo(() => {
    if (!resultados.length) return null;
    return resultados.reduce(
      (acc, r) => ({
        totalLinhas: acc.totalLinhas + r.totalLinhas,
        inseridos: acc.inseridos + r.inseridos,
        duplicados: acc.duplicados + r.duplicados,
      }),
      { totalLinhas: 0, inseridos: 0, duplicados: 0 }
    );
  }, [resultados]);

  function adicionarArquivos(lista) {
    const novos = filtrarPlanilhas(lista);
    if (!novos.length) {
      setErro('Nenhuma planilha (.xlsx/.xls) encontrada na seleção.');
      return;
    }
    setErro('');
    setArquivos((atual) => {
      const existentes = new Set(atual.map((f) => `${f.name}-${f.size}-${f.lastModified}`));
      const semDuplicar = novos.filter((f) => !existentes.has(`${f.name}-${f.size}-${f.lastModified}`));
      return [...atual, ...semDuplicar];
    });
    setPreviews([]);
    setResultados([]);
  }

  async function lerArquivos() {
    if (!arquivos.length) {
      setErro('Selecione ao menos um arquivo exportado do SAP.');
      return;
    }

    setErro('');
    setResultados([]);
    setProcessando(true);
    setPreviews([]);

    const lidos = [];
    const falhas = [];

    for (let i = 0; i < arquivos.length; i += 1) {
      const arquivo = arquivos[i];
      setFeedback(`Lendo ${i + 1} de ${arquivos.length}: ${arquivo.name}...`);
      try {
        const dados = await parseDescontosObtidosFile(arquivo);
        lidos.push(dados);
      } catch (error) {
        falhas.push(`${arquivo.name}: ${error.message || 'erro ao ler'}`);
      }
    }

    setPreviews(lidos);
    setProcessando(false);

    const totalElegivel = lidos.reduce((acc, d) => acc + d.meta.linhasElegiveis, 0);
    const totalOriginal = lidos.reduce((acc, d) => acc + d.meta.linhasOriginais, 0);
    const resumoFalhas = falhas.length ? ` ${falhas.length} arquivo(s) com erro: ${falhas.join('; ')}` : '';
    setFeedback(
      `${formatInt(lidos.length)} arquivo(s) lido(s): ${formatInt(totalElegivel)} de ${formatInt(totalOriginal)} linha(s) reconhecidas como desconto obtido.${resumoFalhas}`
    );
    if (falhas.length) setErro(resumoFalhas.trim());
  }

  async function importar() {
    if (!previews.length) {
      setErro('Leia os arquivos antes de importar.');
      return;
    }

    setErro('');
    setProcessando(true);
    setResultados([]);
    const respostas = [];
    const falhas = [];

    for (let i = 0; i < previews.length; i += 1) {
      const preview = previews[i];
      if (!preview.registros.length) continue;

      setProgresso({ arquivoAtual: i + 1, totalArquivos: previews.length, arquivo: preview.meta.arquivo, enviados: 0, total: preview.registros.length });
      setFeedback(`Gravando arquivo ${i + 1} de ${previews.length}: ${preview.meta.arquivo}...`);

      try {
        const resposta = await importarDescontosObtidos({
          registros: preview.registros,
          arquivoOrigem: preview.meta.arquivo,
          onProgress: (event) => setProgresso((atual) => ({ ...atual, ...event })),
        });
        respostas.push({ arquivo: preview.meta.arquivo, ...resposta });
      } catch (error) {
        falhas.push(`${preview.meta.arquivo}: ${error.message || 'erro ao importar'}`);
      }
    }

    setResultados(respostas);
    setProcessando(false);
    setProgresso(null);

    const totalInseridos = respostas.reduce((acc, r) => acc + r.inseridos, 0);
    const totalDuplicados = respostas.reduce((acc, r) => acc + r.duplicados, 0);
    const resumoFalhas = falhas.length ? ` ${falhas.length} arquivo(s) com erro: ${falhas.join('; ')}` : '';
    setFeedback(
      `Importação concluída: ${formatInt(totalInseridos)} nova(s) linha(s) gravada(s), ${formatInt(totalDuplicados)} já existente(s) (ignorada(s)).${resumoFalhas}`
    );
    if (falhas.length) setErro(resumoFalhas.trim());
  }

  function removerArquivo(nome) {
    setArquivos((atual) => atual.filter((f) => f.name !== nome));
    setPreviews([]);
    setResultados([]);
  }

  function limparSelecao() {
    setArquivos([]);
    setPreviews([]);
    setResultados([]);
    setErro('');
    setFeedback('Seleção limpa.');
    if (inputArquivosRef.current) inputArquivosRef.current.value = '';
    if (inputPastaRef.current) inputPastaRef.current.value = '';
  }

  return (
    <div className="page-shell realizado-page">
      <div className="page-top between">
        <div className="page-header">
          <div className="amd-mini-brand">AMD Log • Descontos Obtidos (SAP)</div>
          <h1>Importar Descontos Obtidos</h1>
          <p>
            Importe o(s) extrato(s) contábil(is) do SAP com os descontos financeiros efetivamente concedidos pelas
            transportadoras. Regra aplicada automaticamente: até a mudança de padrão, conta 41301002 (Desc.
            Fin. Obtidos) restrita a centro de lucro de transporte; depois, conta 32208005 (Fretes e Carretos)
            direto, sem filtro de centro de lucro.
          </p>
        </div>
        <div className="actions-right wrap">
          <button className="btn-secondary" type="button" onClick={limparSelecao} disabled={processando}>
            Limpar seleção
          </button>
        </div>
      </div>

      {erro ? <div className="sim-alert">{erro}</div> : null}
      {feedback ? <div className="sim-alert info">{feedback}</div> : null}

      {progresso ? (
        <div className="sim-alert info">
          <div className="sim-parametros-header">
            <div>
              <strong>Gravando... (arquivo {progresso.arquivoAtual} de {progresso.totalArquivos})</strong>
              <p>{progresso.arquivo}: {formatInt(progresso.enviados)} de {formatInt(progresso.total)} linha(s)</p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="feature-grid two">
        <section className="panel-card">
          <div>
            <div className="panel-title">1. Selecionar arquivos</div>
            <p>Exportações do SAPUI5 (.xlsx). Selecione vários arquivos de uma vez (Ctrl/Shift+clique) ou a pasta inteira.</p>
          </div>

          <div className="form-grid">
            <div className="field">
              <label>Arquivos (seleção múltipla)</label>
              <input
                ref={inputArquivosRef}
                id="descontos-obtidos-file-input"
                type="file"
                accept=".xlsx,.xls"
                multiple
                onChange={(event) => adicionarArquivos(event.target.files)}
                disabled={processando}
              />
            </div>
            <div className="field">
              <label>Ou selecionar pasta inteira</label>
              <input
                ref={inputPastaRef}
                id="descontos-obtidos-folder-input"
                type="file"
                webkitdirectory="true"
                directory="true"
                multiple
                onChange={(event) => adicionarArquivos(event.target.files)}
                disabled={processando}
              />
            </div>
          </div>

          <div className="actions-right wrap" style={{ justifyContent: 'stretch' }}>
            <button className="btn-secondary full" type="button" onClick={lerArquivos} disabled={!arquivos.length || processando}>
              {processando ? 'Lendo...' : `Ler ${arquivos.length || ''} arquivo(s)`}
            </button>
            <button className="btn-primary full" type="button" onClick={importar} disabled={!totalLido || processando}>
              {processando ? 'Importando...' : 'Importar todos'}
            </button>
          </div>

          {arquivos.length ? (
            <div className="import-meta-box">
              <strong>{arquivos.length} arquivo(s) selecionado(s):</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {arquivos.map((f) => (
                  <li key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {f.name}
                    <button
                      type="button"
                      onClick={() => removerArquivo(f.name)}
                      disabled={processando}
                      style={{ border: 'none', background: 'none', color: '#b91c1c', cursor: 'pointer', padding: 0 }}
                    >
                      remover
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="panel-card">
          <div>
            <div className="panel-title">2. Prévia por regra (todos os arquivos lidos)</div>
            <p>Confira antes de gravar. Linhas com valor positivo ou fora dessas contas são ignoradas.</p>
          </div>
          <div className="sim-analise-resumo top-space">
            {Object.entries(resumoRegra).length === 0 ? (
              <div><span>Nenhum arquivo lido ainda</span><strong>—</strong></div>
            ) : (
              Object.entries(resumoRegra).map(([regra, dados]) => (
                <div key={regra}>
                  <span>{LABEL_REGRA[regra] || regra}</span>
                  <strong>{formatInt(dados.qtd)} linha(s) • {formatMoeda(dados.valor)}</strong>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {previews.length ? (
        <section className="table-card">
          <div className="sim-parametros-header">
            <div>
              <div className="panel-title">Prévia por arquivo</div>
              <p>Linhas elegíveis por arquivo, antes de gravar.</p>
            </div>
          </div>
          <div className="sim-table-wrap">
            <table className="sim-table">
              <thead>
                <tr>
                  <th>Arquivo</th>
                  <th>Linhas no arquivo</th>
                  <th>Linhas elegíveis</th>
                </tr>
              </thead>
              <tbody>
                {previews.map((p) => (
                  <tr key={p.meta.arquivo}>
                    <td>{p.meta.arquivo}</td>
                    <td>{formatInt(p.meta.linhasOriginais)}</td>
                    <td>{formatInt(p.meta.linhasElegiveis)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {resumoResultados ? (
        <section className="table-card">
          <div className="sim-parametros-header">
            <div>
              <div className="panel-title">Resultado da importação</div>
              <p>Linhas duplicadas (mesmo lançamento já importado antes) são ignoradas automaticamente.</p>
            </div>
          </div>
          <div className="summary-strip">
            <StatusCard label="Arquivos importados" value={formatInt(resultados.length)} />
            <StatusCard label="Linhas nos arquivos" value={formatInt(resumoResultados.totalLinhas)} />
            <StatusCard label="Novas gravadas" value={formatInt(resumoResultados.inseridos)} />
            <StatusCard label="Já existiam" value={formatInt(resumoResultados.duplicados)} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
