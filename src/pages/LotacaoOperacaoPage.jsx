import { useEffect, useMemo, useState } from 'react';
import {
  carregarFluxoCargasLotacao,
  buscarHistoricoLotacao,
  formatarDataCurta,
  formatarMoeda,
  importarMultiplosFluxos,
  limparFluxoCargasLotacao,
  mesclarFluxoCargas,
  rankingHistoricoPorTransportadora,
  resumirFluxoCargas,
  salvarFluxoCargasLotacao,
} from '../utils/lotacaoFluxoCargas';
import {
  carregarTabelasLotacao,
  pesquisarRotaLotacao,
} from '../utils/lotacaoTables';

function arquivosValidos(files = []) {
  return Array.from(files || []).filter((file) => /\.xls[xm]?$/i.test(file.name || ''));
}

function StatusMensagem({ mensagem }) {
  if (!mensagem) return null;
  return <div className={`hint-box compact ${mensagem.tipo === 'erro' ? 'error-text' : ''}`}>{mensagem.texto}</div>;
}

function ImportarFluxoCard({ onImportado, resumo }) {
  const [arquivos, setArquivos] = useState([]);
  const [aliquota, setAliquota] = useState(12);
  const [modo, setModo] = useState('atualizar');
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState(null);

  const importar = async () => {
    const lista = arquivosValidos(arquivos);
    if (!lista.length) {
      setMensagem({ tipo: 'erro', texto: 'Selecione ao menos um arquivo Excel do fluxo de carga.' });
      return;
    }

    setCarregando(true);
    setMensagem(null);
    try {
      const baseAtual = carregarFluxoCargasLotacao();
      const resultado = await importarMultiplosFluxos(lista, { aliquotaIcmsPadrao: aliquota });
      if (!resultado.resultados.length) {
        throw new Error(resultado.erros[0]?.erro || 'Nenhuma carga válida encontrada nos arquivos selecionados.');
      }
      const novaBase = mesclarFluxoCargas(baseAtual, resultado.resultados, { modo, aliquotaIcmsPadrao: aliquota });
      salvarFluxoCargasLotacao(novaBase);
      onImportado(novaBase);
      setArquivos([]);
      const total = resultado.resultados.reduce((acc, item) => acc + (item.cargas?.length || 0), 0);
      const erroTexto = resultado.erros.length ? ` ${resultado.erros.length} arquivo(s) tiveram erro.` : '';
      setMensagem({ tipo: 'ok', texto: `${total} carga(s) importada(s) no histórico de lotação.${erroTexto}` });
    } catch (error) {
      setMensagem({ tipo: 'erro', texto: error.message || String(error) });
    } finally {
      setCarregando(false);
    }
  };

  const limpar = () => {
    if (!window.confirm('Deseja limpar todo o histórico local de cargas de lotação?')) return;
    limparFluxoCargasLotacao();
    onImportado(carregarFluxoCargasLotacao());
    setMensagem({ tipo: 'ok', texto: 'Histórico local de cargas apagado.' });
  };

  return (
    <div className="panel-card lotacao-fluxo-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Atualizar histórico de cargas</div>
          <p>
            Suba o arquivo do fluxo de carga ou selecione uma pasta com os arquivos do dia. O sistema guarda somente os campos necessários para consulta e auditoria.
          </p>
        </div>
        <span className="status-pill dark">{resumo.totalCargas} cargas</span>
      </div>

      <div className="form-grid three">
        <label className="field">
          Arquivo(s) Excel
          <input
            type="file"
            accept=".xlsx,.xls,.xlsm"
            multiple
            onChange={(event) => setArquivos(Array.from(event.target.files || []))}
          />
        </label>
        <label className="field">
          Pasta de arquivos
          <input
            type="file"
            accept=".xlsx,.xls,.xlsm"
            multiple
            webkitdirectory="true"
            directory="true"
            onChange={(event) => setArquivos(Array.from(event.target.files || []))}
          />
        </label>
        <label className="field">
          ICMS padrão para V = W
          <input
            type="number"
            min="0"
            max="30"
            step="0.01"
            value={aliquota}
            onChange={(event) => setAliquota(event.target.value)}
          />
        </label>
      </div>

      <div className="form-grid three">
        <label className="field">
          Modo da carga
          <select value={modo} onChange={(event) => setModo(event.target.value)}>
            <option value="atualizar">Atualizar histórico mantendo cargas antigas</option>
            <option value="substituir">Substituir histórico local por esta carga</option>
          </select>
        </label>
        <div className="hint-box compact full-span">
          Regra do valor comparável: quando V e W são diferentes, usa o menor valor sem ICMS informado. Quando V = W, remove o ICMS padrão acima. Pedágio fica separado e não entra no valor comparável.
        </div>
      </div>

      {arquivos.length > 0 && (
        <div className="hint-box compact">
          {arquivosValidos(arquivos).length} arquivo(s) Excel selecionado(s). Arquivos de outros formatos serão ignorados.
        </div>
      )}

      <div className="actions-right gap-row">
        <button type="button" className="btn-secondary" disabled={carregando || resumo.totalCargas === 0} onClick={limpar}>
          Limpar histórico
        </button>
        <button type="button" className="btn-primary" disabled={carregando || !arquivosValidos(arquivos).length} onClick={importar}>
          {carregando ? 'Importando...' : 'Importar fluxo'}
        </button>
      </div>

      <StatusMensagem mensagem={mensagem} />
    </div>
  );
}

function KpisFluxo({ resumo }) {
  return (
    <div className="summary-strip lotacao-summary-mini">
      <div className="summary-card">
        <span>Cargas no histórico</span>
        <strong>{resumo.totalCargas}</strong>
        <small>{resumo.rotas} rotas únicas</small>
      </div>
      <div className="summary-card">
        <span>Transportadoras</span>
        <strong>{resumo.transportadoras}</strong>
        <small>{resumo.origens} origens · {resumo.destinos} destinos</small>
      </div>
      <div className="summary-card">
        <span>Valor comparável</span>
        <strong>{formatarMoeda(resumo.valorTotal)}</strong>
        <small>Sem pedágio e com ajuste de ICMS</small>
      </div>
      <div className="summary-card">
        <span>Mais de um CT-e</span>
        <strong>{resumo.comMultiplosCtes}</strong>
        <small>Precisa controle de saldo</small>
      </div>
    </div>
  );
}

function ResultadoTabelas({ resultados }) {
  if (!resultados.length) {
    return <div className="hint-box compact">Nenhuma tabela cadastrada encontrada para os filtros informados.</div>;
  }

  return (
    <div className="sim-analise-tabela-wrap">
      <table className="sim-analise-tabela">
        <thead>
          <tr>
            <th>Posição</th>
            <th>Transportadora</th>
            <th>Origem</th>
            <th>Destino</th>
            <th>Tipo</th>
            <th>KM</th>
            <th>Valor tabela</th>
          </tr>
        </thead>
        <tbody>
          {resultados.slice(0, 120).map((item, index) => (
            <tr key={`${item.tabelaId}-${item.id}-${index}`}>
              <td>{index + 1}</td>
              <td><strong>{item.tabelaNome}</strong></td>
              <td>{item.origem}/{item.ufOrigem}</td>
              <td>{item.destino}/{item.ufDestino}</td>
              <td>{item.tipo}</td>
              <td>{item.km || '-'}</td>
              <td><strong>{formatarMoeda(item.valor)}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultadoHistorico({ resultados }) {
  if (!resultados.length) {
    return <div className="hint-box compact">Nenhum carregamento histórico encontrado para os filtros informados.</div>;
  }

  return (
    <div className="sim-analise-tabela-wrap">
      <table className="sim-analise-tabela">
        <thead>
          <tr>
            <th>DIST</th>
            <th>Data</th>
            <th>Origem</th>
            <th>Destino</th>
            <th>Transportadora</th>
            <th>Tipo</th>
            <th>Valor comparável</th>
            <th>Frete Cantu</th>
            <th>Frete Transp</th>
            <th>Pedágio</th>
            <th>CT-e</th>
          </tr>
        </thead>
        <tbody>
          {resultados.map((item) => (
            <tr key={item.id}>
              <td><strong>{item.dist}</strong></td>
              <td>{formatarDataCurta(item.coletaRealizada || item.coletaPlanejada || item.liberado)}</td>
              <td>{item.origem}</td>
              <td>{item.destino}</td>
              <td>{item.transportadora}</td>
              <td>{item.tipoVeiculo}</td>
              <td><strong>{formatarMoeda(item.valorComparacao)}</strong></td>
              <td>{formatarMoeda(item.freteCantu)}</td>
              <td>{formatarMoeda(item.freteTransp)}</td>
              <td>{formatarMoeda(item.pedagio)}</td>
              <td>{item.cteRaw || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RankingHistorico({ ranking }) {
  if (!ranking.length) return null;
  return (
    <div className="table-card lotacao-table-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Quem mais carregou no histórico filtrado</div>
          <p className="compact">Resumo da operação com base nos carregamentos importados.</p>
        </div>
      </div>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>Transportadora</th>
              <th>Cargas</th>
              <th>Média</th>
              <th>Menor</th>
              <th>Maior</th>
              <th>Última carga</th>
            </tr>
          </thead>
          <tbody>
            {ranking.slice(0, 20).map((item) => (
              <tr key={item.nome}>
                <td><strong>{item.nome}</strong></td>
                <td>{item.cargas}</td>
                <td>{formatarMoeda(item.media)}</td>
                <td>{formatarMoeda(item.menor)}</td>
                <td>{formatarMoeda(item.maior)}</td>
                <td>{item.ultimo?.dist || '-'} · {formatarDataCurta(item.ultimo?.coletaRealizada || item.ultimo?.coletaPlanejada)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function LotacaoOperacaoPage() {
  const [baseFluxo, setBaseFluxo] = useState(() => carregarFluxoCargasLotacao());
  const [tabelas, setTabelas] = useState([]);
  const [fonte, setFonte] = useState('historico');
  const [filtros, setFiltros] = useState({ origem: '', destino: '', tipo: '', transportadora: '' });

  useEffect(() => {
    setTabelas(carregarTabelasLotacao());
  }, []);

  const resumo = useMemo(() => resumirFluxoCargas(baseFluxo), [baseFluxo]);
  const resultadosHistorico = useMemo(() => buscarHistoricoLotacao(baseFluxo.cargas, filtros), [baseFluxo.cargas, filtros]);
  const resultadosTabela = useMemo(() => pesquisarRotaLotacao(tabelas, filtros), [tabelas, filtros]);
  const rankingHistorico = useMemo(() => rankingHistoricoPorTransportadora(resultadosHistorico), [resultadosHistorico]);

  const atualizarFiltro = (campo, valor) => setFiltros((prev) => ({ ...prev, [campo]: valor }));
  const mostrarTabela = fonte === 'tabela' || fonte === 'ambos';
  const mostrarHistorico = fonte === 'historico' || fonte === 'ambos';

  return (
    <div className="page-shell lotacao-page lotacao-fluxo-page">
      <header className="page-top between">
        <div className="page-header">
          <span className="amd-mini-brand">Lotação · Operação</span>
          <h1>Consulta de cargas e tabelas</h1>
          <p>
            Tela para a operação pesquisar origem, destino e tipo de veículo, consultando tanto as tabelas cadastradas quanto o histórico real de carregamentos.
          </p>
        </div>
      </header>

      <ImportarFluxoCard onImportado={setBaseFluxo} resumo={resumo} />
      <KpisFluxo resumo={resumo} />

      <div className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Pesquisar lotação</div>
            <p>Use origem, destino, tipo de veículo e escolha se quer ver tabela cadastrada, histórico ou os dois.</p>
          </div>
        </div>

        <div className="form-grid three">
          <label className="field">
            Fonte da consulta
            <select value={fonte} onChange={(event) => setFonte(event.target.value)}>
              <option value="historico">Histórico de carregamentos</option>
              <option value="tabela">Tabelas cadastradas</option>
              <option value="ambos">Tabela + histórico</option>
            </select>
          </label>
          <label className="field">
            Origem
            <input value={filtros.origem} onChange={(event) => atualizarFiltro('origem', event.target.value)} placeholder="Ex.: Itajaí" />
          </label>
          <label className="field">
            Destino
            <input value={filtros.destino} onChange={(event) => atualizarFiltro('destino', event.target.value)} placeholder="Ex.: Maceió" />
          </label>
        </div>

        <div className="form-grid three">
          <label className="field">
            Tipo de veículo
            <input value={filtros.tipo} onChange={(event) => atualizarFiltro('tipo', event.target.value)} placeholder="Ex.: Carreta baú" />
          </label>
          <label className="field">
            Transportadora no histórico
            <input value={filtros.transportadora} onChange={(event) => atualizarFiltro('transportadora', event.target.value)} placeholder="Opcional" />
          </label>
          <div className="actions-right lotacao-fluxo-search-actions">
            <button type="button" className="btn-secondary" onClick={() => setFiltros({ origem: '', destino: '', tipo: '', transportadora: '' })}>
              Limpar filtros
            </button>
          </div>
        </div>
      </div>

      {mostrarTabela && (
        <div className="table-card lotacao-table-card">
          <div className="section-row compact-top">
            <div>
              <div className="panel-title">Resultado pelas tabelas cadastradas</div>
              <p className="compact">Ordenado do menor para o maior valor cadastrado.</p>
            </div>
            <span className="status-pill dark">{resultadosTabela.length} opções</span>
          </div>
          <ResultadoTabelas resultados={resultadosTabela} />
        </div>
      )}

      {mostrarHistorico && (
        <>
          <div className="table-card lotacao-table-card">
            <div className="section-row compact-top">
              <div>
                <div className="panel-title">Histórico de carregamentos</div>
                <p className="compact">Últimos carregamentos encontrados no fluxo importado.</p>
              </div>
              <span className="status-pill dark">{resultadosHistorico.length} cargas</span>
            </div>
            <ResultadoHistorico resultados={resultadosHistorico} />
          </div>
          <RankingHistorico ranking={rankingHistorico} />
        </>
      )}
    </div>
  );
}
