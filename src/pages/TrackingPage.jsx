import { useEffect, useState } from 'react';
import {
  diagnosticarTrackingLocal,
  importarTrackingLocal,
  limparTrackingLocal,
  listarTrackingLocal,
  resumirTrackingLocal,
  exportarTrackingLocal,
} from '../utils/trackingLocal';
import {
  diagnosticarTrackingSupabase,
  importarTrackingSupabase,
  listarTrackingSupabase,
  resumirTrackingSupabase,
} from '../services/trackingSupabaseService';
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
  if (!diagnostico?.total) return 'Base local vazia. Use o envio complementar ao Supabase ou importe localmente para conferência.';
  return `${textoPeriodoBase(resumo)} - ${formatarNumero(diagnostico.total)} linha(s), ${formatarNumero(resumo?.notas)} nota(s), ${formatarNumero(resumo?.volumes)} volume(s), ${formatarMoeda(resumo?.valorNF)} em NF.`;
}

function textoBaseSupabase(resumoSupabase, resumoSupabaseDetalhado, diagnosticoSupabase) {
  const base = resumoSupabaseDetalhado || resumoSupabase;
  if (!base) return 'Consultando Supabase...';
  if (base?.erro) return base.erro;
  if (!base?.configurado) return 'Supabase nao configurado para consulta do Tracking.';
  const total = Number(diagnosticoSupabase?.total || base.total || 0);
  if (!total) return 'Supabase tracking_rows vazio ou sem permissao de leitura para esta sessao.';
  const periodo = base.periodoInicio && base.periodoFim
    ? `Atualizada de ${formatarDataCurta(base.periodoInicio)} a ${formatarDataCurta(base.periodoFim)}`
    : 'Periodo nao identificado';
  const detalheParcial = base.parcial
    ? ` Resumo financeiro parcial: ${formatarNumero(base.totalLido)} de ${formatarNumero(total)} linha(s) amostradas.`
    : '';
  return `${periodo} - ${formatarNumero(total)} linha(s) no Supabase, ${formatarNumero(base.volumes)} volume(s), ${formatarMoeda(base.valorNF)} em NF.${detalheParcial}`;
}

function resumirArquivosSelecionados(arquivos = []) {
  if (!arquivos.length) return 'Nenhum arquivo selecionado.';
  if (arquivos.length === 1) return arquivos[0].name;
  const nomes = arquivos.slice(0, 3).map((arquivo) => arquivo.name).join(', ');
  return `${arquivos.length} arquivos selecionados: ${nomes}${arquivos.length > 3 ? '...' : ''}`;
}

export default function TrackingPage() {
  const [arquivos, setArquivos] = useState([]);
  const [modoImportacao, setModoImportacao] = useState('complementar');
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const [progresso, setProgresso] = useState(null);
  const [atualizandoResumo, setAtualizandoResumo] = useState(false);
  const [diagnostico, setDiagnostico] = useState({ total: 0, ultimaAtualizacao: '' });
  const [diagnosticoSupabase, setDiagnosticoSupabase] = useState(null);
  const [resumoSupabase, setResumoSupabase] = useState(null);
  const [resumo, setResumo] = useState(null);
  const [amostra, setAmostra] = useState([]);
  const [fonteAmostra, setFonteAmostra] = useState('supabase');
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
      if ((listaSupabase.rows || []).length) {
        setAmostra(listaSupabase.rows || []);
        setFonteAmostra('supabase');
      } else if ((lista.rows || []).length) {
        setAmostra(lista.rows || []);
        setFonteAmostra('local');
      } else {
        setAmostra([]);
        setFonteAmostra('supabase');
      }
      if (comFeedback) {
        const fonte = (listaSupabase.rows || []).length ? 'Supabase' : (lista.rows || []).length ? 'local' : 'nenhuma base';
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

  async function importarLocal() {
    if (!arquivos.length) {
      setErro('Selecione um arquivo ou uma pasta com arquivos de Tracking.');
      return;
    }
    setCarregando(true);
    setErro('');
    setProgresso(null);
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
      setMensagem(`Importacao local concluida: ${formatarNumero(resultado.total)} linha(s) salvas.${resultado.duplicadosArquivo ? ` Duplicados no arquivo ignorados: ${formatarNumero(resultado.duplicadosArquivo)}.` : ''}`);
      setArquivos([]);
      await atualizarTela();
    } catch (error) {
      setErro(error.message || 'Erro ao importar Tracking.');
    } finally {
      setCarregando(false);
    }
  }

  async function enviarSupabase({ usarLocal = false } = {}) {
    if (!usarLocal && !arquivos.length) {
      setErro('Selecione o arquivo de Tracking para enviar ao Supabase.');
      return;
    }
    if (usarLocal && !diagnostico.total) {
      setErro('Importe o Tracking local antes de reenviar a base local ao Supabase.');
      return;
    }

    setCarregando(true);
    setErro('');
    setProgresso(null);
    setMensagem(usarLocal ? 'Preparando Tracking local para enviar ao Supabase...' : 'Lendo arquivo e comparando chaves NF no Supabase...');

    try {
      let municipios = [];
      try {
        municipios = await carregarMunicipiosIbgeDb();
      } catch {
        municipios = [];
      }

      let resultado;
      if (usarLocal) {
        const { rows } = await exportarTrackingLocal({}, { limit: 500000 });
        resultado = await importarTrackingSupabase({
          rows,
          modo: modoImportacao,
          municipios,
          onProgress: (event) => {
            if (event.complementar) setProgresso(event.complementar);
            if (event.mensagem) setMensagem(event.mensagem);
            if (event.etapa === 'envio') {
              const detalheDuplicados = event.duplicadosIgnorados ? ` Duplicados ignorados: ${formatarNumero(event.duplicadosIgnorados)}.` : '';
              setMensagem(`${event.percentual}% - Lote ${event.lote}/${event.totalLotes}: ${formatarNumero(event.enviados)} de ${formatarNumero(event.total)} linha(s).${detalheDuplicados}`);
            }
          },
        });
      } else {
        resultado = await importarTrackingSupabase({
          arquivos,
          modo: modoImportacao,
          municipios,
          onProgress: (event) => {
            if (event.complementar) setProgresso(event.complementar);
            if (event.mensagem) setMensagem(event.mensagem);
            if (event.etapa === 'envio') {
              const detalheDuplicados = event.duplicadosIgnorados ? ` Duplicados ignorados: ${formatarNumero(event.duplicadosIgnorados)}.` : '';
              setMensagem(`${event.percentual}% - Lote ${event.lote}/${event.totalLotes}: ${formatarNumero(event.enviados)} de ${formatarNumero(event.total)} linha(s).${detalheDuplicados}`);
            }
          },
        });
      }

      const comp = resultado.complementar;
      const sufixo = comp
        ? ` Lidos: ${formatarNumero(comp.lidos)} · já na base: ${formatarNumero(comp.jaNaBase)} · novos: ${formatarNumero(comp.novos)}.`
        : '';
      setMensagem(`${resultado.mensagem || 'Tracking enviado ao Supabase.'}${sufixo}`);
      if (!usarLocal) setArquivos([]);
      await atualizarTela();
    } catch (error) {
      setErro(error.message || 'Erro ao enviar Tracking ao Supabase.');
    } finally {
      setCarregando(false);
      setProgresso(null);
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
        <h1>Tracking</h1>
        <p>
          Importe a base de notas fiscais/tracking para volumetria e simulação. O envio ao Supabase usa a <strong>chave da NF</strong> como identificador — uma linha por NF — e no modo complementar sobe apenas o que ainda não está na base.
        </p>
      </div>

      {erro ? <div className="sim-alert error">{erro}</div> : null}
      {mensagem ? <div className="sim-alert info">{mensagem}</div> : null}

      <section className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Subir / atualizar Tracking no Supabase</div>
            <p>Use Excel ou CSV. O leitor reconhece o layout do relatório Trackings: Pedido ERP, Canal, origem, destino, NF, chave NF, peso, cubagem, valor da NF e volumes.</p>
          </div>
          <div className="actions-right gap-row">
            <button className="btn-secondary" type="button" onClick={() => atualizarTela({ comFeedback: true })} disabled={carregando || atualizandoResumo}>{atualizandoResumo ? 'Atualizando...' : 'Atualizar resumo'}</button>
            <button className="btn-danger" type="button" onClick={limparBase} disabled={carregando || !diagnostico.total}>Limpar base local</button>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 10, margin: '12px 0' }}>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: 12, background: modoImportacao === 'complementar' ? '#f0fdf4' : '#f8fafc', border: `1px solid ${modoImportacao === 'complementar' ? '#86efac' : '#e2e8f0'}`, cursor: 'pointer' }}>
            <input type="radio" name="modo-importacao-tracking" value="complementar" checked={modoImportacao === 'complementar'} onChange={() => setModoImportacao('complementar')} disabled={carregando} style={{ marginTop: 3 }} />
            <span>
              <strong>Complementar (só novos)</strong>
              <br />
              <small>Compara pela <strong>chave da NF</strong> e envia apenas linhas que ainda não estão no Supabase. Ideal para atualização semanal.</small>
            </span>
          </label>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: 12, background: modoImportacao === 'substituir' ? '#fff7ed' : '#f8fafc', border: `1px solid ${modoImportacao === 'substituir' ? '#fdba74' : '#e2e8f0'}`, cursor: 'pointer' }}>
            <input type="radio" name="modo-importacao-tracking" value="substituir" checked={modoImportacao === 'substituir'} onChange={() => setModoImportacao('substituir')} disabled={carregando} style={{ marginTop: 3 }} />
            <span>
              <strong>Substituir / regravar arquivo inteiro</strong>
              <br />
              <small>Faz upsert de todas as linhas do arquivo, atualizando registros com a mesma chave NF.</small>
            </span>
          </label>
        </div>

        <div className="form-grid two">
          <label className="field">
            Arquivos Excel
            <input type="file" accept=".xlsx,.xls,.xlsm,.csv" multiple onChange={(event) => setArquivos(Array.from(event.target.files || []))} />
          </label>
          <label className="field">
            Pasta compartilhada/local
            <input type="file" accept=".xlsx,.xls,.xlsm,.csv" multiple webkitdirectory="true" directory="true" onChange={(event) => setArquivos(Array.from(event.target.files || []))} />
          </label>
        </div>

        <div className="hint-box compact">{resumirArquivosSelecionados(arquivos)}</div>

        {progresso ? (
          <div className="summary-strip lotacao-summary-mini" style={{ marginTop: 12 }}>
            <div className="summary-card"><span>Lidos</span><strong>{formatarNumero(progresso.lidos)}</strong></div>
            <div className="summary-card"><span>Já na base</span><strong>{formatarNumero(progresso.jaNaBase)}</strong></div>
            <div className="summary-card"><span>Novos</span><strong>{formatarNumero(progresso.novos)}</strong></div>
            {progresso.semChave ? <div className="summary-card"><span>Sem chave NF</span><strong>{formatarNumero(progresso.semChave)}</strong><small>ainda serão enviados</small></div> : null}
          </div>
        ) : null}

        <div className="actions-right" style={{ marginTop: 12, flexWrap: 'wrap', gap: 10 }}>
          <button className="btn-primary" type="button" onClick={() => enviarSupabase({ usarLocal: false })} disabled={carregando || !arquivos.length}>
            {carregando ? 'Enviando...' : (modoImportacao === 'complementar' ? 'Complementar / enviar novos' : 'Enviar arquivo ao Supabase')}
          </button>
          <button className="btn-secondary" type="button" onClick={importarLocal} disabled={carregando || !arquivos.length}>
            {carregando ? 'Importando...' : 'Só importar local (conferência)'}
          </button>
          {diagnostico.total ? (
            <button className="btn-secondary" type="button" onClick={() => enviarSupabase({ usarLocal: true })} disabled={carregando}>
              Reenviar base local ao Supabase
            </button>
          ) : null}
        </div>
      </section>

      <section className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Base atual do Tracking</div>
            <p>{textoBaseAtual(diagnostico, resumo)}</p>
            <p className="compact"><strong>Supabase:</strong> {textoBaseSupabase(resumoSupabase, resumoSupabase, diagnosticoSupabase)}</p>
          </div>
        </div>
      </section>

      <div className="summary-strip lotacao-summary-mini">
        <div className="summary-card"><span>{labelLinhas}</span><strong>{formatarNumero(diagnostico.total || diagnosticoSupabase?.total || 0)}</strong><small>Última atualização: {formatarDataHora(diagnostico.total ? diagnostico.ultimaAtualizacao : diagnosticoSupabase?.ultimaAtualizacao)}</small></div>
        <div className="summary-card"><span>Periodo da base</span><strong>{resumoExibido?.periodoInicio && resumoExibido?.periodoFim ? `${formatarDataCurta(resumoExibido.periodoInicio)} a ${formatarDataCurta(resumoExibido.periodoFim)}` : '-'}</strong><small>{textoPeriodoBase(resumoExibido)}</small></div>
        <div className="summary-card"><span>Valor NF</span><strong>{formatarMoeda(resumoExibido?.valorNF)}</strong><small>{formatarNumero(resumoExibido?.notas)} notas/linhas{resumoSupabase?.parcial ? ' (amostra)' : ''}</small></div>
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
                <th>Chave NF</th>
                <th>Pedido ERP</th>
                <th>Canal</th>
                <th>Transportadora</th>
                <th>Origem</th>
                <th>Destino</th>
                <th>Peso</th>
                <th>Cubagem</th>
                <th>Valor NF</th>
                <th>Volumes</th>
              </tr>
            </thead>
            <tbody>
              {amostra.map((row) => (
                <tr key={row.id}>
                  <td>{row.data || '-'}</td>
                  <td>{row.notaFiscal || row.pedido || '-'}</td>
                  <td style={{ fontSize: '0.75rem', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }} title={row.chaveNfe || ''}>{row.chaveNfe ? `${String(row.chaveNfe).slice(0, 8)}…${String(row.chaveNfe).slice(-6)}` : '-'}</td>
                  <td>{row.pedidoErp || '-'}</td>
                  <td>{row.canal || '-'}</td>
                  <td>{row.transportadora || '-'}</td>
                  <td>{row.cidadeOrigem}/{row.ufOrigem}</td>
                  <td>{row.cidadeDestino}/{row.ufDestino}</td>
                  <td>{formatarNumero(row.peso, 2)}</td>
                  <td>{formatarNumero(row.cubagem, 4)}</td>
                  <td>{formatarMoeda(row.valorNF)}</td>
                  <td>{formatarNumero(row.qtdVolumes)}</td>
                </tr>
              ))}
              {!amostra.length && <tr><td colSpan="12">Nenhuma linha de Tracking importada ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
