import { useEffect, useMemo, useState } from 'react';
import {
  baixarModeloAntt,
  baixarModeloTargetTransportadora,
  carregarTabelasLotacao,
  compararComReferencia,
  formatarMoeda,
  formatarPercentual,
  importarTabelaLotacao,
  nomeTipoLotacao,
  obterReferencia,
  obterTabelasPorTipo,
  pesquisarRotaLotacao,
  removerTabelaLotacao,
  resumoLotacao,
  salvarTabelasLotacao,
  upsertTabelaLotacao,
} from '../utils/lotacaoTables';

function formatarData(valor) {
  if (!valor) return '-';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '-';
  return data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function classeStatus(status) {
  if (status === 'Ganha') return 'positivo';
  if (status === 'Perde') return 'negativo';
  return '';
}

function listarAbas(abas = []) {
  if (!abas.length) return '-';
  return abas.map((aba) => `${aba.nome} (${aba.rotas})`).join(', ');
}

function UploadCard({ tipo, titulo, descricao, nomeObrigatorio, onImportar, carregando }) {
  const [nome, setNome] = useState('');
  const [arquivo, setArquivo] = useState(null);

  const enviar = async () => {
    if (!arquivo) return;
    await onImportar({ tipo, file: arquivo, nome: nome.trim() });
    setArquivo(null);
    if (tipo !== 'TRANSPORTADORA') setNome('');
  };

  return (
    <div className="panel-card lotacao-upload-card">
      <div>
        <div className="panel-title">{titulo}</div>
        <p>{descricao}</p>
      </div>

      {nomeObrigatorio && (
        <label className="field">
          Nome da transportadora
          <input
            value={nome}
            onChange={(event) => setNome(event.target.value)}
            placeholder="Ex.: TransGP, Camilo dos Santos, Rodonaves..."
          />
        </label>
      )}

      <label className="field">
        Arquivo Excel
        <input
          type="file"
          accept=".xlsx,.xls,.xlsm"
          onChange={(event) => setArquivo(event.target.files?.[0] || null)}
        />
      </label>

      <button
        type="button"
        className="btn-primary full"
        disabled={carregando || !arquivo || (nomeObrigatorio && !nome.trim())}
        onClick={enviar}
      >
        {carregando ? 'Importando...' : 'Subir tabela'}
      </button>
    </div>
  );
}

function ModelosAceitos() {
  return (
    <div className="panel-card lotacao-modelos-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Modelos oficiais aceitos</div>
          <p className="compact">
            A leitura foi travada nos dois modelos enviados: um para ANTT e outro para Target/Transportadoras.
            Assim o sistema não tenta adivinhar valor e evita aderência errada.
          </p>
        </div>
        <div className="lotacao-model-actions">
          <button type="button" className="btn-secondary" onClick={baixarModeloTargetTransportadora}>
            Baixar modelo Target/Transportadora
          </button>
          <button type="button" className="btn-secondary" onClick={baixarModeloAntt}>
            Baixar modelo ANTT
          </button>
        </div>
      </div>

      <div className="lotacao-modelo-grid">
        <div>
          <strong>Target e Transportadoras</strong>
          <p>
            Colunas aceitas: Transportadora, Origem, UF ORIGEM, Destino, UF DESTINO ou UF, KM, TIPO,
            TARGET, ICMS e Pedágio. O valor da comparação será sempre a coluna TARGET.
          </p>
        </div>
        <div>
          <strong>ANTT</strong>
          <p>
            Colunas aceitas: Transportadora, Origem, UF ORIGEM, Destino, UF DESTINO ou UF, KM, TIPO e
            Frete ANTT Oficial. O valor da comparação será sempre o Frete ANTT Oficial.
          </p>
        </div>
        <div>
          <strong>Chave de comparação</strong>
          <p>
            Origem + UF Origem + Destino + UF Destino + Tipo de veículo. Se existir rota repetida na mesma
            tabela, o sistema considera o menor valor para não distorcer o ranking.
          </p>
        </div>
      </div>

      <div className="hint-box compact">
        Validação esperada: se subir o arquivo TARGET como Target e depois subir o mesmo arquivo como Transportadora,
        o comparativo versus Target precisa fechar em 100% de aderência, com todas as rotas empatadas.
      </div>
    </div>
  );
}

function ResumoComparativo({ titulo, comparativo }) {
  if (!comparativo) {
    return (
      <div className="panel-card">
        <div className="panel-title">{titulo}</div>
        <p>Suba a referência e selecione uma transportadora para comparar.</p>
      </div>
    );
  }

  return (
    <div className="panel-card lotacao-comparativo-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">{titulo}</div>
          <p>
            {comparativo.tabelaNome} versus {comparativo.referenciaNome}
          </p>
        </div>
        <span className="status-pill dark">Aderência {formatarPercentual(comparativo.aderencia)}</span>
      </div>

      <div className="summary-strip lotacao-summary-mini">
        <div className="summary-card">
          <span>Rotas comparadas</span>
          <strong>{comparativo.comparadas}</strong>
        </div>
        <div className="summary-card">
          <span>Ganha</span>
          <strong>{comparativo.ganha}</strong>
        </div>
        <div className="summary-card">
          <span>Perde</span>
          <strong>{comparativo.perde}</strong>
        </div>
        <div className="summary-card">
          <span>Diferença total</span>
          <strong>{formatarMoeda(comparativo.somaDiferenca)}</strong>
        </div>
      </div>

      <div className="sim-analise-resumo">
        <div>
          <span>Cobertura da comparação</span>
          <strong>{formatarPercentual(comparativo.cobertura)}</strong>
        </div>
        <div>
          <span>Empata</span>
          <strong>{comparativo.empata}</strong>
        </div>
        <div>
          <span>Sem referência</span>
          <strong>{comparativo.semReferencia}</strong>
        </div>
        <div>
          <span>Variação média</span>
          <strong>{formatarPercentual(comparativo.variacaoMedia)}</strong>
        </div>
      </div>
    </div>
  );
}

function TabelaDetalhesComparativo({ titulo, comparativo }) {
  if (!comparativo?.detalhes?.length) return null;

  return (
    <div className="table-card lotacao-table-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">{titulo}</div>
          <p className="compact">Principais rotas onde a tabela mais ganha ou perde contra a referência.</p>
        </div>
      </div>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>Origem</th>
              <th>Destino</th>
              <th>Tipo</th>
              <th>Tabela</th>
              <th>Referência</th>
              <th>Diferença</th>
              <th>Valor lido</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {comparativo.detalhes.slice(0, 80).map((item) => (
              <tr key={item.id}>
                <td>{item.origem}/{item.ufOrigem}</td>
                <td>{item.destino}/{item.ufDestino}</td>
                <td>{item.tipo}</td>
                <td>{formatarMoeda(item.valorTabela)}</td>
                <td>{formatarMoeda(item.valorReferencia)}</td>
                <td className={classeStatus(item.status)}>{formatarMoeda(item.diferenca)}</td>
                <td>{item.fonteTabela || '-'} x {item.fonteReferencia || '-'}</td>
                <td><span className={`status-pill ${item.status === 'Ganha' ? 'dark' : ''}`}>{item.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PesquisaRotas({ tabelas }) {
  const [filtros, setFiltros] = useState({ origem: '', destino: '', tipo: '' });

  const resultados = useMemo(() => {
    if (!filtros.origem && !filtros.destino && !filtros.tipo) return [];
    return pesquisarRotaLotacao(tabelas, filtros).slice(0, 150);
  }, [tabelas, filtros]);

  const menor = resultados[0];
  const maior = resultados.length ? resultados[resultados.length - 1] : null;

  return (
    <div className="panel-card">
      <div className="section-row">
        <div>
          <div className="panel-title">Pesquisa por origem e destino</div>
          <p>Digite origem, destino ou tipo de veículo para ver o ranking do mais barato ao mais caro.</p>
        </div>
      </div>

      <div className="form-grid three">
        <label className="field">
          Origem
          <input
            value={filtros.origem}
            onChange={(event) => setFiltros((prev) => ({ ...prev, origem: event.target.value }))}
            placeholder="Ex.: Itajaí"
          />
        </label>
        <label className="field">
          Destino
          <input
            value={filtros.destino}
            onChange={(event) => setFiltros((prev) => ({ ...prev, destino: event.target.value }))}
            placeholder="Ex.: Maceió"
          />
        </label>
        <label className="field">
          Tipo
          <input
            value={filtros.tipo}
            onChange={(event) => setFiltros((prev) => ({ ...prev, tipo: event.target.value }))}
            placeholder="Ex.: Carreta baú"
          />
        </label>
      </div>

      {resultados.length > 0 && (
        <div className="sim-analise-resumo">
          <div>
            <span>Mais barato</span>
            <strong>{menor.tabelaNome} · {formatarMoeda(menor.valor)}</strong>
          </div>
          <div>
            <span>Mais caro</span>
            <strong>{maior.tabelaNome} · {formatarMoeda(maior.valor)}</strong>
          </div>
          <div>
            <span>Diferença menor x maior</span>
            <strong>{formatarMoeda((maior?.valor || 0) - (menor?.valor || 0))}</strong>
          </div>
          <div>
            <span>Opções encontradas</span>
            <strong>{resultados.length}</strong>
          </div>
        </div>
      )}

      {resultados.length > 0 ? (
        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead>
              <tr>
                <th>Posição</th>
                <th>Tabela</th>
                <th>Tipo tabela</th>
                <th>Origem</th>
                <th>Destino</th>
                <th>Tipo</th>
                <th>KM</th>
                <th>Valor</th>
                <th>Valor lido</th>
              </tr>
            </thead>
            <tbody>
              {resultados.map((item, index) => (
                <tr key={`${item.tabelaId}-${item.id}-${index}`}>
                  <td>{index + 1}</td>
                  <td><strong>{item.tabelaNome}</strong></td>
                  <td>{nomeTipoLotacao(item.tabelaTipo)}</td>
                  <td>{item.origem}/{item.ufOrigem}</td>
                  <td>{item.destino}/{item.ufDestino}</td>
                  <td>{item.tipo}</td>
                  <td>{item.km || '-'}</td>
                  <td><strong>{formatarMoeda(item.valor)}</strong></td>
                  <td>{item.valorFonte || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="hint-box">
          Informe pelo menos um filtro para pesquisar. Exemplo: origem Itajaí e destino Maceió.
        </div>
      )}
    </div>
  );
}

function ListaTabelas({ tabelas, onRemover }) {
  if (!tabelas.length) {
    return (
      <div className="panel-card">
        <div className="panel-title">Tabelas cadastradas</div>
        <p>Nenhuma tabela de lotação cadastrada ainda.</p>
      </div>
    );
  }

  return (
    <div className="table-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Tabelas cadastradas</div>
          <p className="compact">Target e ANTT são únicos. Ao subir novamente, o sistema substitui a versão anterior.</p>
        </div>
      </div>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Nome</th>
              <th>Modelo</th>
              <th>Arquivo</th>
              <th>Rotas</th>
              <th>Rotas únicas</th>
              <th>Valor usado</th>
              <th>Abas importadas</th>
              <th>Importado em</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            {tabelas.map((tabela) => (
              <tr key={tabela.id}>
                <td><span className="status-pill">{nomeTipoLotacao(tabela.tipo)}</span></td>
                <td><strong>{tabela.nome}</strong></td>
                <td>{tabela.modelo || '-'}</td>
                <td>{tabela.fileName || '-'}</td>
                <td>{tabela.linhas?.length || 0}</td>
                <td>{tabela.rotasUnicas || '-'}</td>
                <td>{tabela.resumoFontesValor || '-'}</td>
                <td>{listarAbas(tabela.abasImportadas)}</td>
                <td>{formatarData(tabela.createdAt)}</td>
                <td>
                  <button type="button" className="btn-link" onClick={() => onRemover(tabela.id)}>
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function LotacaoPage() {
  const [tabelas, setTabelas] = useState(() => carregarTabelasLotacao());
  const [selecionadaId, setSelecionadaId] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    salvarTabelasLotacao(tabelas);
  }, [tabelas]);

  const resumo = useMemo(() => resumoLotacao(tabelas), [tabelas]);
  const transportadoras = useMemo(() => obterTabelasPorTipo(tabelas, 'TRANSPORTADORA'), [tabelas]);
  const tabelaSelecionada = useMemo(
    () => transportadoras.find((item) => item.id === selecionadaId) || transportadoras[0] || null,
    [transportadoras, selecionadaId]
  );

  useEffect(() => {
    if (!selecionadaId && transportadoras[0]) setSelecionadaId(transportadoras[0].id);
    if (selecionadaId && !transportadoras.some((item) => item.id === selecionadaId)) {
      setSelecionadaId(transportadoras[0]?.id || '');
    }
  }, [transportadoras, selecionadaId]);

  const target = obterReferencia(tabelas, 'TARGET');
  const antt = obterReferencia(tabelas, 'ANTT');

  const comparativoTarget = useMemo(
    () => compararComReferencia(tabelaSelecionada, target),
    [tabelaSelecionada, target]
  );
  const comparativoAntt = useMemo(
    () => compararComReferencia(tabelaSelecionada, antt),
    [tabelaSelecionada, antt]
  );

  const importar = async ({ tipo, file, nome }) => {
    setCarregando(true);
    setFeedback('');
    try {
      const nomePadrao = tipo === 'TARGET' ? 'Target Lotação' : tipo === 'ANTT' ? 'ANTT' : nome;
      const tabela = await importarTabelaLotacao(file, { tipo, nomePadrao });
      const next = upsertTabelaLotacao(tabelas, tabela);
      setTabelas(next);
      if (tipo === 'TRANSPORTADORA') setSelecionadaId(tabela.id);
      setFeedback(
        `Tabela ${tabela.nome} importada com ${tabela.linhas.length} rotas válidas (${tabela.rotasUnicas || tabela.linhas.length} rotas únicas). ` +
        `Modelo: ${tabela.modelo}. Valor usado: ${tabela.resumoFontesValor || 'não identificado'}. ` +
        `Abas importadas: ${listarAbas(tabela.abasImportadas)}.`
      );
    } catch (error) {
      setFeedback(error.message || 'Erro ao importar tabela de lotação.');
    } finally {
      setCarregando(false);
    }
  };

  const remover = (id) => {
    const tabela = tabelas.find((item) => item.id === id);
    if (!tabela) return;
    const ok = window.confirm(`Deseja excluir a tabela ${tabela.nome}?`);
    if (!ok) return;
    setTabelas((prev) => removerTabelaLotacao(prev, id));
    setFeedback(`Tabela ${tabela.nome} excluída.`);
  };

  return (
    <div className="page-shell lotacao-page">
      <div className="page-top between start-mobile">
        <div className="page-header">
          <div className="amd-mini-brand">Central de Fretes · Lotação</div>
          <h1>Controle de transportadoras e lotação</h1>
          <p>
            Módulo independente para subir tabela target, tabela ANTT e tabelas de transportadoras. A cada cadastro,
            o sistema compara automaticamente quem ganha, quem perde e permite pesquisar origem/destino.
          </p>
        </div>
      </div>

      {feedback && <div className="formatacao-alerta">{feedback}</div>}

      <ModelosAceitos />

      <div className="summary-strip lotacao-kpis">
        <div className="summary-card">
          <span>Transportadoras</span>
          <strong>{resumo.totalTransportadoras}</strong>
        </div>
        <div className="summary-card">
          <span>Rotas target</span>
          <strong>{resumo.rotasTarget}</strong>
          <small>{resumo.rotasUnicasTarget || 0} únicas</small>
        </div>
        <div className="summary-card">
          <span>Rotas ANTT</span>
          <strong>{resumo.rotasAntt}</strong>
          <small>{resumo.rotasUnicasAntt || 0} únicas</small>
        </div>
        <div className="summary-card">
          <span>Total de rotas</span>
          <strong>{resumo.totalRotas}</strong>
        </div>
      </div>

      <div className="feature-grid three-cols">
        <UploadCard
          tipo="TARGET"
          titulo="Subir tabela target"
          descricao="Use o modelo TARGET enviado. O valor de comparação será a coluna TARGET. Subir novamente substitui a versão anterior."
          onImportar={importar}
          carregando={carregando}
        />
        <UploadCard
          tipo="ANTT"
          titulo="Subir tabela ANTT"
          descricao="Use o modelo ANTT BASE enviado. O valor de comparação será a coluna Frete ANTT Oficial."
          onImportar={importar}
          carregando={carregando}
        />
        <UploadCard
          tipo="TRANSPORTADORA"
          titulo="Cadastrar transportadora"
          descricao="Use o mesmo modelo do Target para as transportadoras. O sistema compara contra Target e ANTT quando existirem."
          nomeObrigatorio
          onImportar={importar}
          carregando={carregando}
        />
      </div>

      <div className="panel-card">
        <div className="section-row">
          <div>
            <div className="panel-title">Comparativo automático da transportadora</div>
            <p>Escolha uma transportadora cadastrada para ver a aderência versus Target e versus ANTT.</p>
          </div>
          <label className="field small-width">
            Transportadora
            <select value={tabelaSelecionada?.id || ''} onChange={(event) => setSelecionadaId(event.target.value)}>
              {transportadoras.length === 0 && <option value="">Nenhuma cadastrada</option>}
              {transportadoras.map((tabela) => (
                <option key={tabela.id} value={tabela.id}>{tabela.nome}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="feature-grid import-grid">
        <ResumoComparativo titulo="Versus Target" comparativo={comparativoTarget} />
        <ResumoComparativo titulo="Versus ANTT" comparativo={comparativoAntt} />
      </div>

      <div className="feature-grid import-grid">
        <TabelaDetalhesComparativo titulo="Maiores diferenças versus Target" comparativo={comparativoTarget} />
        <TabelaDetalhesComparativo titulo="Maiores diferenças versus ANTT" comparativo={comparativoAntt} />
      </div>

      <PesquisaRotas tabelas={tabelas} />

      <ListaTabelas tabelas={tabelas} onRemover={remover} />

      <div className="hint-box">
        Regra usada: comparação por Origem + UF Origem + Destino + UF Destino + Tipo de veículo. Aderência considera as rotas em que a transportadora fica menor ou igual à referência. Os dados continuam salvos apenas no navegador até ligarmos o módulo ao servidor/Supabase.
      </div>
    </div>
  );
}
