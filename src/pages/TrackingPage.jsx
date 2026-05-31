import { useEffect, useState } from 'react';
import {
  diagnosticarTrackingLocal,
  importarTrackingLocal,
  limparTrackingLocal,
  listarTrackingLocal,
  resumirTrackingLocal,
  exportarTrackingLocal,
} from '../utils/trackingLocal';
import { diagnosticarTrackingSupabase, listarTrackingSupabase, resumirTrackingSupabase, subirTrackingSupabase } from '../services/trackingSupabaseService';
import { carregarMunicipiosIbgeDb } from '../services/freteDatabaseService';

function formatarNumero(value, casas = 0) {
  return Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

function formatarMoeda(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarDataHora(value) {
  if (!value) return '-';
  const data = new Date(value);
  if (Number.isNaN(data.getTime())) return '-';
  return data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function formatarDataCurta(value) {
  if (!value) return '-';
  const [ano, mes, dia] = String(value).slice(0, 10).split('-');
  if (!ano || !mes || !dia) return '-';
  return `${dia}-${mes}-${ano}`;
}

function textoPeriodoBase(resumo) {
  if (!resumo?.periodoInicio || !resumo?.periodoFim) return 'Sem periodo identificado';
  return `Atualizada de ${formatarDataCurta(resumo.periodoInicio)} a ${formatarDataCurta(resumo.periodoFim)}`;
}

function textoBaseAtual(diagnostico, resumo) {
  if (!diagnostico?.total) return 'Base local vazia. Importe um arquivo para ver o periodo, volumes, valor NF e ultimas linhas.';
  return `${textoPeriodoBase(resumo)} - ${formatarNumero(diagnostico.total)} linha(s), ${formatarNumero(resumo?.notas)} nota(s), ${formatarNumero(resumo?.volumes)} volume(s), ${formatarMoeda(resumo?.valorNF)} em NF.`;
}

function textoBaseSupabase(resumoSupabase, resumoSupabaseDetalhado) {
  const base = resumoSupabaseDetalhado || resumoSupabase;
  if (!base) return 'Consultando Supabase...';
  if (base?.erro) return base.erro;
  if (!base?.configurado) return 'Supabase nao configurado para consulta do Tracking.';
  if (!base.total) return 'Supabase tracking_rows vazio ou sem permissao de leitura para esta sessao.';
  const periodo = base.periodoInicio && base.periodoFim
    ? `Atualizada de ${formatarDataCurta(base.periodoInicio)} a ${formatarDataCurta(base.periodoFim)}`
    : 'Periodo nao identificado';
  const detalheParcial = base.parcial ? ` Resumo parcial: ${formatarNumero(base.totalLido)} de ${formatarNumero(base.total)} linha(s).` : '';
  return `${periodo} - ${formatarNumero(base.total)} linha(s), ${formatarNumero(base.volumes)} volume(s), ${formatarMoeda(base.valorNF)} em NF.${detalheParcial}`;
}

function resumirArquivosSelecionados(arquivos = []) {
  if (!arquivos.length) return 'Nenhum arquivo selecionado.';
  if (arquivos.length === 1) return arquivos[0].name;
  const nomes = arquivos.slice(0, 3).map((arquivo) => arquivo.name).join(', ');
  return `${arquivos.length} arquivos selecionados: ${nomes}${arquivos.length > 3 ? '...' : ''}`;
}

export default function TrackingPage() {
  const [arquivos, setArquivos] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const [atualizandoResumo, setAtualizandoResumo] = useState(false);
  const [diagnostico, setDiagnostico] = useState({ total: 0, ultimaAtualizacao: '' });
  const [diagnosticoSupabase, setDiagnosticoSupabase] = useState(null);
  const [resumoSupabase, setResumoSupabase] = useState(null);
  const [resumo, setResumo] = useState(null);
  const [amostra, setAmostra] = useState([]);
  const [fonteAmostra, setFonteAmostra] = useState('local');
  const resumoExibido = diagnostico.total ? resumo : resumoSupabase;
  const labelLinhas = diagnostico.total ? 'Linhas locais' : 'Linhas Supabase';

  async function atualizarTela(options = {}) {
    const comFeedback = Boolean(options.comFeedback);
    if (comFeedback) {
      setAtualizandoResumo(true);
      setErro('');
      setMensagem('Consultando base local e Supabase...');
    }
    try {
      const [diag, res, lista, supabaseDiag, supabaseResumo, listaSupabase] = await Promise.all([
        diagnosticarTrackingLocal(),
        resumirTrackingLocal(),
        listarTrackingLocal({}, { limit: 50 }),
        diagnosticarTrackingSupabase().catch((error) => ({ configurado: true, total: 0, erro: error.message || 'Erro ao consultar Tracking no Supabase.' })),
        resumirTrackingSupabase().catch((error) => ({ configurado: true, total: 0, erro: error.message || 'Erro ao resumir Tracking no Supabase.' })),
        listarTrackingSupabase({ limit: 50 }).catch((error) => ({ rows: [], erro: error.message || 'Erro ao listar Tracking no Supabase.' })),
      ]);
      setDiagnostico(diag);
      setDiagnosticoSupabase(supabaseDiag);
      setResumoSupabase(supabaseResumo);
      setResumo(res);
      if ((lista.rows || []).length) {
        setAmostra(lista.rows || []);
        setFonteAmostra('local');
      } else if ((listaSupabase.rows || []).length) {
        setAmostra(listaSupabase.rows || []);
        setFonteAmostra('supabase');
      } else {
        setAmostra([]);
        setFonteAmostra('local');
      }
      if (comFeedback) {
        const fonte = (lista.rows || []).length ? 'local' : (listaSupabase.rows || []).length ? 'Supabase' : 'nenhuma base';
        setMensagem(`Resumo atualizado. Fonte exibida: ${fonte}.`);
      }
    } catch (error) {
      setErro(error.message || 'Erro ao atualizar Tracking.');
    } finally {
      if (comFeedback) setAtualizandoResumo(false);
    }
  }

  useEffect(() => {
    atualizarTela().catch(() => {});
  }, []);

  async function importar() {
    if (!arquivos.length) {
      setErro('Selecione um arquivo ou uma pasta com arquivos de Tracking.');
      return;
    }
    setCarregando(true);
    setErro('');
    setMensagem('Importando Tracking local...');
    try {
      let municipios = [];
      try {
        municipios = await carregarMunicipiosIbgeDb();
      } catch {
        municipios = [];
      }
      const resultado = await importarTrackingLocal(arquivos, {
        municipios,
        onProgress: ({ etapa, total, arquivo, lote, totalLotes, duplicadosArquivo }) => {
          if (etapa === 'lendo') {
            setMensagem(`Lendo arquivo ${arquivo || ''}...`);
            return;
          }
          if (etapa === 'processando') {
            setMensagem(`Processando colunas de ${arquivo || ''}...`);
            return;
          }
          if (etapa === 'importando') {
            const detalheDuplicados = duplicadosArquivo ? ` Duplicados ignorados: ${formatarNumero(duplicadosArquivo)}.` : '';
            setMensagem(`Importando lote ${lote}/${totalLotes} de ${arquivo || ''}... ${formatarNumero(total)} linha(s) salvas.${detalheDuplicados}`);
            return;
          }
          setMensagem(`Importando ${arquivo || ''}...`);
        },
      });
      setMensagem(`Importacao concluida: ${formatarNumero(resultado.total)} linha(s) salvas em base local.${resultado.duplicadosArquivo ? ` Duplicados no arquivo ignorados: ${formatarNumero(resultado.duplicadosArquivo)}.` : ''}`);
      setArquivos([]);
      await atualizarTela();
    } catch (error) {
      setErro(error.message || 'Erro ao importar Tracking.');
    } finally {
      setCarregando(false);
    }
  }

  async function enviarSupabase() {
    if (!diagnostico.total) {
      setErro('Importe o Tracking local antes de enviar para o Supabase.');
      return;
    }
    setCarregando(true);
    setErro('');
    setMensagem('Preparando Tracking local para enviar ao Supabase...');
    try {
      const { rows } = await exportarTrackingLocal({}, { limit: 500000 });
      const resultado = await subirTrackingSupabase(rows, ({ enviados, total, percentual, lote, totalLotes, duplicadosIgnorados }) => {
        const detalheDuplicados = duplicadosIgnorados ? ` Duplicados ignorados: ${formatarNumero(duplicadosIgnorados)}.` : '';
        setMensagem(`${percentual}% - Importando lote ${lote}/${totalLotes} no Supabase: ${formatarNumero(enviados)} de ${formatarNumero(total)} linha(s).${detalheDuplicados}`);
      });
      setMensagem(`Tracking enviado ao Supabase: ${formatarNumero(resultado.enviados)} linha(s) gravadas/atualizadas.${resultado.duplicadosIgnorados ? ` Duplicados ignorados: ${formatarNumero(resultado.duplicadosIgnorados)}.` : ''}`);
      await atualizarTela();
    } catch (error) {
      setErro(error.message || 'Erro ao enviar Tracking ao Supabase.');
    } finally {
      setCarregando(false);
    }
  }

  async function limparBase() {
    if (!window.confirm('Deseja limpar a base local de Tracking deste navegador?')) return;
    setCarregando(true);
    setErro('');
    try {
      await limparTrackingLocal();
      setMensagem('Base local de Tracking limpa.');
      await atualizarTela();
    } catch (error) {
      setErro(error.message || 'Erro ao limpar Tracking.');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="amd-mini-brand">AMD Log • Tracking</div>
        <h1>Tracking local</h1>
        <p>
          Importe a base de notas fiscais/tracking para gerar volumetria para transportadores e, depois, evoluir para torre de controle de performance.
Agora a base pode ficar local para conferência e também ser enviada ao Supabase pelo botão Enviar para Supabase.
        </p>
      </div>

      {erro ? <div className="sim-alert error">{erro}</div> : null}
      {mensagem ? <div className="sim-alert info">{mensagem}</div> : null}

      <section className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Importar arquivo ou pasta de Tracking</div>
            <p>Use Excel ou CSV. O leitor já reconhece o layout do relatório Trackings com ponto e vírgula: Pedido ERP, Canal, CD de origem, Cidade de origem, Cidade destino, Região destino, NF, peso declarado, peso cubado/cubagem, valor da NF e volumes.</p>
          </div>
          <div className="actions-right gap-row">
            <button className="btn-secondary" type="button" onClick={() => atualizarTela({ comFeedback: true })} disabled={carregando || atualizandoResumo}>{atualizandoResumo ? 'Atualizando...' : 'Atualizar'}</button>
            <button className="btn-primary" type="button" onClick={enviarSupabase} disabled={carregando || !diagnostico.total}>Enviar para Supabase</button>
            <button className="btn-danger" type="button" onClick={limparBase} disabled={carregando || !diagnostico.total}>Limpar base local</button>
          </div>
        </div>

        <div className="form-grid two">
          <label className="field">
            Arquivos Excel
            <input
              type="file"
              accept=".xlsx,.xls,.xlsm,.csv"
              multiple
              onChange={(event) => setArquivos(Array.from(event.target.files || []))}
            />
          </label>
          <label className="field">
            Pasta compartilhada/local
            <input
              type="file"
              accept=".xlsx,.xls,.xlsm,.csv"
              multiple
              webkitdirectory="true"
              directory="true"
              onChange={(event) => setArquivos(Array.from(event.target.files || []))}
            />
          </label>
        </div>

        <div className="hint-box compact">
          O navegador não permite deixar um caminho de rede fixo lendo sozinho por segurança. Mas cada usuário pode selecionar a pasta compartilhada no botão acima e clicar em importar/atualizar quando precisar. A base fica gravada localmente naquele navegador até limpar ou reimportar.
        </div>
        <div className="hint-box compact">
          {resumirArquivosSelecionados(arquivos)}
        </div>

        <div className="actions-right">
          <button className="btn-primary" type="button" onClick={importar} disabled={carregando || !arquivos.length}>
            {carregando ? 'Importando...' : `Importar ${arquivos.length ? `(${arquivos.length})` : ''}`}
          </button>
        </div>
      </section>

      <section className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Base atual do Tracking</div>
            <p>{textoBaseAtual(diagnostico, resumo)}</p>
            <p className="compact"><strong>Supabase:</strong> {textoBaseSupabase(diagnosticoSupabase, resumoSupabase)}</p>
          </div>
          <div className="actions-right">
            <button className="btn-secondary" type="button" onClick={() => atualizarTela({ comFeedback: true })} disabled={carregando || atualizandoResumo}>{atualizandoResumo ? 'Atualizando...' : 'Atualizar resumo'}</button>
          </div>
        </div>
      </section>

      <div className="summary-strip lotacao-summary-mini">
        <div className="summary-card"><span>{labelLinhas}</span><strong>{formatarNumero(diagnostico.total || resumoSupabase?.total || 0)}</strong><small>Última atualização: {formatarDataHora(diagnostico.total ? diagnostico.ultimaAtualizacao : diagnosticoSupabase?.ultimaAtualizacao)}</small></div>
        <div className="summary-card"><span>Periodo da base</span><strong>{resumoExibido?.periodoInicio && resumoExibido?.periodoFim ? `${formatarDataCurta(resumoExibido.periodoInicio)} a ${formatarDataCurta(resumoExibido.periodoFim)}` : '-'}</strong><small>{textoPeriodoBase(resumoExibido)}</small></div>
        <div className="summary-card"><span>Valor NF</span><strong>{formatarMoeda(resumoExibido?.valorNF)}</strong><small>{formatarNumero(resumoExibido?.notas)} notas/linhas</small></div>
        <div className="summary-card"><span>Peso total</span><strong>{formatarNumero(resumoExibido?.peso, 2)} kg</strong><small>Volumes: {formatarNumero(resumoExibido?.volumes)}</small></div>
        <div className="summary-card"><span>Cubagem total</span><strong>{formatarNumero(resumoExibido?.cubagem, 4)} m³</strong><small>{resumoExibido?.periodoInicio || '-'} até {resumoExibido?.periodoFim || '-'}</small></div>
        <div className="summary-card"><span>IBGE resolvido</span><strong>{formatarNumero(resumoExibido?.comIbge || 0)}</strong><small>Sem IBGE: {formatarNumero(resumoExibido?.semIbge || 0)}</small></div>
      </div>

      <section className="table-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Últimas linhas importadas</div>
            <p className="compact">Amostra da base {fonteAmostra === 'supabase' ? 'do Supabase' : 'local'} para validar se as colunas foram reconhecidas corretamente.</p>
          </div>
        </div>
        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead>
              <tr>
                <th>Data</th>
                <th>NF</th>
                <th>Pedido ERP</th>
                <th>Canal</th>
                <th>Transportadora</th>
                <th>Origem</th>
                <th>IBGE Origem</th>
                <th>Destino</th>
                <th>IBGE Destino</th>
                <th>Peso</th>
                <th>Cubagem unit.</th>
                <th>Cubagem total</th>
                <th>Valor NF</th>
                <th>Volumes</th>
              </tr>
            </thead>
            <tbody>
              {amostra.map((row) => (
                <tr key={row.id}>
                  <td>{row.data || '-'}</td>
                  <td>{row.notaFiscal || row.pedido || '-'}</td>
                  <td>{row.pedidoErp || '-'}</td>
                  <td>{row.canal || '-'}</td>
                  <td>{row.transportadora || '-'}</td>
                  <td>{row.cidadeOrigem}/{row.ufOrigem}</td>
                  <td>{row.ibgeOrigem || '-'}</td>
                  <td>{row.cidadeDestino}/{row.ufDestino}</td>
                  <td>{row.ibgeDestino || '-'}</td>
                  <td>{formatarNumero(row.peso, 2)}</td>
                  <td>{formatarNumero(row.cubagem, 4)}</td>
                  <td>{formatarNumero(Number(row.cubagem || 0) * Math.max(Number(row.qtdVolumes || 0) || 1, 1), 4)}</td>
                  <td>{formatarMoeda(row.valorNF)}</td>
                  <td>{formatarNumero(row.qtdVolumes)}</td>
                </tr>
              ))}
              {!amostra.length && <tr><td colSpan="14">Nenhuma linha de Tracking importada ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
