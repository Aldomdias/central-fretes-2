import { useEffect, useState } from 'react';
import {
  diagnosticarTrackingLocal,
  importarTrackingLocal,
  limparTrackingLocal,
  listarTrackingLocal,
  resumirTrackingLocal,
} from '../utils/trackingLocal';

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

export default function TrackingPage() {
  const [arquivos, setArquivos] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const [diagnostico, setDiagnostico] = useState({ total: 0, ultimaAtualizacao: '' });
  const [resumo, setResumo] = useState(null);
  const [amostra, setAmostra] = useState([]);

  async function atualizarTela() {
    const [diag, res, lista] = await Promise.all([
      diagnosticarTrackingLocal(),
      resumirTrackingLocal(),
      listarTrackingLocal({}, { limit: 50 }),
    ]);
    setDiagnostico(diag);
    setResumo(res);
    setAmostra(lista.rows || []);
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
      const resultado = await importarTrackingLocal(arquivos, {
        onProgress: ({ total, arquivo }) => setMensagem(`Importando ${arquivo || ''} • ${formatarNumero(total)} linhas salvas...`),
      });
      setMensagem(`Tracking importado: ${formatarNumero(resultado.total)} linha(s) salvas em base local.`);
      setArquivos([]);
      await atualizarTela();
    } catch (error) {
      setErro(error.message || 'Erro ao importar Tracking.');
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
          Neste primeiro momento a base fica local no navegador, sem enviar para o servidor.
        </p>
      </div>

      {erro ? <div className="sim-alert error">{erro}</div> : null}
      {mensagem ? <div className="sim-alert info">{mensagem}</div> : null}

      <section className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Importar arquivo ou pasta de Tracking</div>
            <p>Use Excel com colunas de origem, destino, IBGE, canal, peso, cubagem, valor da nota e volumes. O leitor tenta reconhecer nomes de coluna automaticamente.</p>
          </div>
          <div className="actions-right gap-row">
            <button className="btn-secondary" type="button" onClick={atualizarTela} disabled={carregando}>Atualizar</button>
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

        <div className="actions-right">
          <button className="btn-primary" type="button" onClick={importar} disabled={carregando || !arquivos.length}>
            {carregando ? 'Importando...' : `Importar ${arquivos.length ? `(${arquivos.length})` : ''}`}
          </button>
        </div>
      </section>

      <div className="summary-strip lotacao-summary-mini">
        <div className="summary-card"><span>Linhas locais</span><strong>{formatarNumero(diagnostico.total)}</strong><small>Última atualização: {formatarDataHora(diagnostico.ultimaAtualizacao)}</small></div>
        <div className="summary-card"><span>Valor NF</span><strong>{formatarMoeda(resumo?.valorNF)}</strong><small>{formatarNumero(resumo?.notas)} notas/linhas</small></div>
        <div className="summary-card"><span>Peso total</span><strong>{formatarNumero(resumo?.peso, 2)} kg</strong><small>Volumes: {formatarNumero(resumo?.volumes)}</small></div>
        <div className="summary-card"><span>Cubagem total</span><strong>{formatarNumero(resumo?.cubagem, 4)} m³</strong><small>{resumo?.periodoInicio || '-'} até {resumo?.periodoFim || '-'}</small></div>
      </div>

      <section className="table-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Últimas linhas importadas</div>
            <p className="compact">Amostra da base local para validar se as colunas foram reconhecidas corretamente.</p>
          </div>
        </div>
        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead>
              <tr>
                <th>Data</th>
                <th>NF</th>
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
              {!amostra.length && <tr><td colSpan="10">Nenhuma linha de Tracking importada ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
