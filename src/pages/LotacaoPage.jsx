import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  analisarAnttTodasTransportadoras,
  analisarTabelaVersusAntt,
  baixarModeloAntt,
  baixarModeloTransportadora,
  carregarTabelasLotacao,
  compararComReferencia,
  compararTabelaReajuste,
  exportarComparativoReajusteXlsx,
  criarReferenciaMenorPreco,
  formatarMoeda,
  formatarPercentual,
  importarTabelaLotacao,
  nomeTipoLotacao,
  obterAntt,
  obterTabelasPorTipo,
  pesquisarRotaLotacao,
  rankingMelhoresPorRota,
  removerTabelaLotacao,
  resumoLotacao,
  salvarTabelasLotacao,
  upsertTabelaLotacao,
} from '../utils/lotacaoTables';
import {
  carregarTabelasLotacaoSupabase,
  diagnosticarLotacaoSupabase,
  lotacaoSupabaseConfigurado,
  obterInfoLotacaoSupabase,
  removerTabelaLotacaoSupabase,
  salvarTabelaLotacaoSupabase,
  resumoRotasLotacaoSupabase,
} from '../services/lotacaoSupabaseService';

function formatarData(valor) {
  if (!valor) return '-';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '-';
  return data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function classeDiferenca(valor) {
  if (valor > 0.01) return 'negativo';
  if (valor < -0.01) return 'positivo';
  return '';
}

function classeAntt(status) {
  if (status === 'Abaixo ANTT' || status === 'Abaixo NTT') return 'negativo';
  if (status === 'Acima ANTT' || status === 'Acima NTT') return 'positivo';
  return '';
}

function classeReajuste(status) {
  if (status === 'Aumentou') return 'negativo';
  if (status === 'Reduziu') return 'positivo';
  return '';
}

function percentualSeguro(valor, casas = 1) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return '-';
  return formatarPercentual(numero, casas);
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
    if (nomeObrigatorio) setNome('');
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


function ComparativoReajusteLotacao({ transportadoras, carregando, tabelaAntigaId, onTabelaAntigaChange, onImportar, tabelaReajuste, onLimpar, comparativo }) {
  const [nomeReajuste, setNomeReajuste] = useState('');
  const [arquivo, setArquivo] = useState(null);
  const detalhes = Array.isArray(comparativo?.detalhes) ? comparativo.detalhes : [];
  const temComparativo = Boolean(comparativo && !comparativo.erro);

  const enviar = async () => {
    if (!arquivo || !tabelaAntigaId) return;
    await onImportar({ file: arquivo, nome: nomeReajuste.trim(), tabelaAntigaId });
    setArquivo(null);
  };

  return (
    <div className="panel-card lotacao-reajuste-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Comparar tabela de reajuste</div>
          <p>
            Suba uma tabela reajustada para comparar contra a tabela antiga cadastrada, sem substituir a oficial.
            A visão mostra o aumento rota a rota e também compara valor antigo e reajustado contra a NTT.
          </p>
        </div>
        {tabelaReajuste && (
          <button type="button" className="btn-secondary" onClick={onLimpar} disabled={carregando}>
            Limpar reajuste
          </button>
        )}
      </div>

      <div className="filter-grid three lotacao-reajuste-form">
        <label className="field">
          Tabela antiga/oficial
          <select value={tabelaAntigaId || ''} onChange={(event) => onTabelaAntigaChange(event.target.value)} disabled={!transportadoras.length}>
            {transportadoras.length === 0 && <option value="">Cadastre uma transportadora primeiro</option>}
            {transportadoras.map((tabela) => (
              <option key={tabela.id} value={tabela.id}>{tabela.nome}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Nome da tabela reajustada
          <input
            value={nomeReajuste}
            onChange={(event) => setNomeReajuste(event.target.value)}
            placeholder="Ex.: TransGP reajuste 2026"
          />
        </label>
        <label className="field">
          Arquivo Excel de reajuste
          <input
            type="file"
            accept=".xlsx,.xls,.xlsm"
            onChange={(event) => setArquivo(event.target.files?.[0] || null)}
          />
        </label>
      </div>

      <div className="actions-right gap-row lotacao-reajuste-actions">
        {temComparativo && (
          <button
            type="button"
            className="btn-secondary"
            disabled={carregando || !detalhes.length}
            onClick={() => exportarComparativoReajusteXlsx(comparativo)}
          >
            Baixar visão Excel
          </button>
        )}
        <button
          type="button"
          className="btn-primary"
          disabled={carregando || !arquivo || !tabelaAntigaId}
          onClick={enviar}
        >
          {carregando ? 'Comparando...' : 'Subir reajuste e comparar'}
        </button>
      </div>

      {comparativo?.erro && (
        <div className="formatacao-alerta top-space-sm">
          Não consegui montar o comparativo de reajuste: {comparativo.erro}
        </div>
      )}

      {!temComparativo && !comparativo?.erro && (
        <div className="hint-box compact">
          Use o mesmo modelo de transportadora. A coluna TARGET será lida como valor reajustado. Se a ANTT/NTT estiver cadastrada, o relatório também mostra quantas rotas ficam abaixo, iguais ou acima da referência.
        </div>
      )}

      {temComparativo && (
        <>
          <div className="summary-strip lotacao-summary-mini top-space-sm">
            <div className="summary-card">
              <span>Rotas comparadas</span>
              <strong>{comparativo.comparadas || 0}</strong>
              <small>{percentualSeguro(comparativo.coberturaAntiga)} da antiga</small>
            </div>
            <div className="summary-card">
              <span>Aumento ponderado</span>
              <strong className={comparativo.variacaoPonderada > 0 ? 'negativo' : comparativo.variacaoPonderada < 0 ? 'positivo' : ''}>
                {percentualSeguro(comparativo.variacaoPonderada)}
              </strong>
              <small>{formatarMoeda(comparativo.diferencaTotal)} de diferença</small>
            </div>
            <div className="summary-card">
              <span>Antiga abaixo NTT</span>
              <strong className="negativo">{comparativo.antigoAbaixoAntt || 0}</strong>
              <small>{percentualSeguro(comparativo.pctAntigoAbaixoAntt)} das rotas com NTT</small>
            </div>
            <div className="summary-card">
              <span>Reajuste acima NTT</span>
              <strong className="positivo">{comparativo.reajusteAcimaAntt || 0}</strong>
              <small>{percentualSeguro(comparativo.pctReajusteAcimaAntt)} · média {percentualSeguro(comparativo.variacaoMediaReajusteAcimaAntt)}</small>
            </div>
            <div className="summary-card">
              <span>Reajuste até NTT</span>
              <strong>{comparativo.rotasQuePrecisamAjusteAntt || 0}</strong>
              <small>{formatarMoeda(comparativo.valorNecessarioAjustarAteAntt || 0)} para ajustar antiga</small>
            </div>
          </div>

          <div className="sim-analise-resumo top-space-sm">
            <div>
              <span>Tabela antiga</span>
              <strong>{comparativo.tabelaAntigaNome || '-'}</strong>
            </div>
            <div>
              <span>Tabela reajustada</span>
              <strong>{comparativo.tabelaReajusteNome || '-'}</strong>
            </div>
            <div>
              <span>Antiga acima/igual NTT</span>
              <strong>{comparativo.antigoAcimaAntt || 0} acima · {comparativo.antigoIgualAntt || 0} igual</strong>
            </div>
            <div>
              <span>Reajuste abaixo/igual NTT</span>
              <strong>{comparativo.reajusteAbaixoAntt || 0} abaixo · {comparativo.reajusteIgualAntt || 0} igual</strong>
            </div>
            <div>
              <span>Rotas ajustadas até NTT</span>
              <strong>{comparativo.ajustadasAteAntt || 0}</strong>
            </div>
            <div>
              <span>Sem paridade de rota</span>
              <strong>{comparativo.rotasNovas || 0} novas · {comparativo.rotasSemReajuste || 0} sem reajuste</strong>
            </div>
          </div>

          {!comparativo.comparadasAntt && (
            <div className="hint-box compact top-space-sm">
              A coluna NTT só será preenchida quando existir uma tabela ANTT/NTT cadastrada no módulo de Lotação com a mesma chave da rota.
            </div>
          )}

          <div className="section-row compact-top top-space-sm">
            <div>
              <div className="panel-title small-title">Visão rota a rota para enviar aos transportadores</div>
              <p className="compact">Mostra valor anterior, NTT, valor reajustado e o percentual de aumento por rota.</p>
            </div>
            <span className="status-pill dark">{detalhes.length} linhas</span>
          </div>

          <div className="sim-analise-tabela-wrap">
            <table className="sim-analise-tabela">
              <thead>
                <tr>
                  <th>Origem</th>
                  <th>Destino</th>
                  <th>Tipo</th>
                  <th>KM</th>
                  <th>Valor anterior</th>
                  <th>NTT</th>
                  <th>Valor reajuste</th>
                  <th>Diferença</th>
                  <th>% aumento</th>
                  <th>Anterior x NTT</th>
                  <th>Reajuste x NTT</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {detalhes.map((item) => (
                  <tr key={item.id}>
                    <td>{item.origem}/{item.ufOrigem}</td>
                    <td>{item.destino}/{item.ufDestino}</td>
                    <td>{item.tipo}</td>
                    <td>{item.km || '-'}</td>
                    <td>{formatarMoeda(item.valorAntigo)}</td>
                    <td>{item.valorAntt === null || item.valorAntt === undefined ? '-' : formatarMoeda(item.valorAntt)}</td>
                    <td>{formatarMoeda(item.valorNovo)}</td>
                    <td className={classeReajuste(item.status)}>{formatarMoeda(item.diferenca)}</td>
                    <td className={classeReajuste(item.status)}><strong>{percentualSeguro(item.variacao)}</strong></td>
                    <td className={classeAntt(item.statusAntigoAntt)}>{item.valorAntt === null || item.valorAntt === undefined ? '-' : percentualSeguro(item.variacaoAntigoAntt)}</td>
                    <td className={classeAntt(item.statusNovoAntt)}>{item.valorAntt === null || item.valorAntt === undefined ? '-' : percentualSeguro(item.variacaoNovoAntt)}</td>
                    <td><span className="status-pill">{item.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(comparativo.rotasNovas > 0 || comparativo.rotasSemReajuste > 0) && (
            <div className="hint-box compact top-space-sm">
              Atenção: {comparativo.rotasNovas || 0} rota(s) existem apenas na tabela reajustada e {comparativo.rotasSemReajuste || 0} rota(s) da antiga não vieram na reajustada. Essas rotas não entram no percentual de aumento.
            </div>
          )}
        </>
      )}
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
            O módulo agora trabalha sem upload de Target. O Target é calculado automaticamente como o menor preço
            entre as transportadoras cadastradas para cada origem, destino e tipo de veículo.
          </p>
        </div>
        <div className="lotacao-model-actions">
          <button type="button" className="btn-secondary" onClick={baixarModeloTransportadora}>
            Baixar modelo Transportadora
          </button>
          <button type="button" className="btn-secondary" onClick={baixarModeloAntt}>
            Baixar modelo ANTT
          </button>
        </div>
      </div>

      <div className="lotacao-modelo-grid">
        <div>
          <strong>Transportadoras</strong>
          <p>
            Use o modelo TARGET que você enviou como padrão para subir as transportadoras. A coluna TARGET continua
            sendo o valor da tabela da transportadora, mas não existe mais uma tabela Target separada.
          </p>
        </div>
        <div>
          <strong>ANTT</strong>
          <p>
            Use o modelo ANTT BASE enviado. O sistema compara todas as transportadoras contra o Frete ANTT Oficial
            e mostra quantas rotas estão abaixo, iguais ou acima da referência.
          </p>
        </div>
        <div>
          <strong>Chave de comparação</strong>
          <p>
            Origem + UF Origem + Destino + UF Destino + Tipo de veículo. Se existir rota repetida na mesma tabela,
            o sistema considera o menor valor para não distorcer o ranking.
          </p>
        </div>
      </div>

      <div className="hint-box compact">
        Regra nova: o melhor preço passa a ser calculado entre as transportadoras cadastradas. A ANTT fica como
        referência separada para análise de abaixo/acima da tabela oficial.
      </div>
    </div>
  );
}

function ResumoMelhorPreco({ comparativo }) {
  if (!comparativo) {
    return (
      <div className="panel-card">
        <div className="panel-title">Versus melhor preço</div>
        <p>Cadastre transportadoras para comparar contra o menor valor disponível por rota.</p>
      </div>
    );
  }

  const aderenciaMelhor = comparativo.comparadas ? (comparativo.empata / comparativo.comparadas) * 100 : 0;

  return (
    <div className="panel-card lotacao-comparativo-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Versus melhor preço entre transportadoras</div>
          <p>{comparativo.tabelaNome} versus menor valor cadastrado por rota.</p>
        </div>
        <span className="status-pill dark">Melhor em {formatarPercentual(aderenciaMelhor)}</span>
      </div>

      <div className="summary-strip lotacao-summary-mini">
        <div className="summary-card">
          <span>Rotas comparadas</span>
          <strong>{comparativo.comparadas}</strong>
        </div>
        <div className="summary-card">
          <span>É melhor opção</span>
          <strong>{comparativo.empata}</strong>
        </div>
        <div className="summary-card">
          <span>Acima do melhor</span>
          <strong>{comparativo.perde}</strong>
        </div>
        <div className="summary-card">
          <span>Diferença total</span>
          <strong>{formatarMoeda(comparativo.somaDiferenca)}</strong>
        </div>
      </div>

      <div className="sim-analise-resumo">
        <div>
          <span>Cobertura</span>
          <strong>{formatarPercentual(comparativo.cobertura)}</strong>
        </div>
        <div>
          <span>Sem comparação</span>
          <strong>{comparativo.semReferencia}</strong>
        </div>
        <div>
          <span>Variação média vs melhor</span>
          <strong>{formatarPercentual(comparativo.variacaoMedia)}</strong>
        </div>
        <div>
          <span>Rotas no mercado</span>
          <strong>{comparativo.referenciaTotal}</strong>
        </div>
      </div>
    </div>
  );
}

function ResumoAntt({ titulo, analise }) {
  if (!analise) {
    return (
      <div className="panel-card">
        <div className="panel-title">{titulo}</div>
        <p>Suba a ANTT e cadastre transportadoras para ver a análise.</p>
      </div>
    );
  }

  return (
    <div className="panel-card lotacao-comparativo-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">{titulo}</div>
          <p>{analise.tabelaNome} versus {analise.referenciaNome}.</p>
        </div>
        <span className="status-pill dark">Abaixo {formatarPercentual(analise.pctAbaixo)}</span>
      </div>

      <div className="summary-strip lotacao-summary-mini">
        <div className="summary-card">
          <span>Comparadas</span>
          <strong>{analise.comparadas}</strong>
        </div>
        <div className="summary-card">
          <span>Abaixo ANTT</span>
          <strong>{analise.abaixo}</strong>
        </div>
        <div className="summary-card">
          <span>Acima ANTT</span>
          <strong>{analise.acima}</strong>
        </div>
        <div className="summary-card">
          <span>Diferença total</span>
          <strong>{formatarMoeda(analise.somaDiferenca)}</strong>
        </div>
      </div>

      <div className="sim-analise-resumo">
        <div>
          <span>% abaixo ANTT</span>
          <strong>{formatarPercentual(analise.pctAbaixo)}</strong>
        </div>
        <div>
          <span>% acima ANTT</span>
          <strong>{formatarPercentual(analise.pctAcima)}</strong>
        </div>
        <div>
          <span>% igual ANTT</span>
          <strong>{formatarPercentual(analise.pctIgual)}</strong>
        </div>
        <div>
          <span>Variação média</span>
          <strong>{formatarPercentual(analise.variacaoMedia)}</strong>
        </div>
        <div>
          <span>Sem ANTT</span>
          <strong>{analise.semReferencia}</strong>
        </div>
      </div>
    </div>
  );
}

function RankingMelhores({ ranking }) {
  if (!ranking?.ranking?.length) return null;

  return (
    <div className="table-card lotacao-table-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Melhores opções por rota</div>
          <p className="compact">
            Quantas vezes cada transportadora é o menor preço entre as tabelas cadastradas.
          </p>
        </div>
        <span className="status-pill dark">{ranking.rotasMapeadas} rotas mapeadas</span>
      </div>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>Posição</th>
              <th>Transportadora</th>
              <th>Melhor opção</th>
              <th>Participações</th>
              <th>% melhor</th>
              <th>Ticket médio</th>
            </tr>
          </thead>
          <tbody>
            {ranking.ranking.map((item, index) => (
              <tr key={item.nome}>
                <td>{index + 1}</td>
                <td><strong>{item.nome}</strong></td>
                <td>{item.melhores}</td>
                <td>{item.participacoes}</td>
                <td>{formatarPercentual(item.percentualMelhor)}</td>
                <td>{formatarMoeda(item.ticketMedio)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabelaDetalhesMelhorPreco({ comparativo }) {
  const linhas = (comparativo?.detalhes || []).filter((item) => Math.abs(item.diferenca) > 0.01);
  if (!linhas.length) return null;

  return (
    <div className="table-card lotacao-table-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Onde a transportadora está acima do melhor preço</div>
          <p className="compact">Principais rotas onde existe outra transportadora mais barata.</p>
        </div>
      </div>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>Origem</th>
              <th>Destino</th>
              <th>Tipo</th>
              <th>Tabela selecionada</th>
              <th>Melhor preço</th>
              <th>Melhor transportadora</th>
              <th>Diferença</th>
              <th>%</th>
            </tr>
          </thead>
          <tbody>
            {linhas.slice(0, 80).map((item) => (
              <tr key={item.id}>
                <td>{item.origem}/{item.ufOrigem}</td>
                <td>{item.destino}/{item.ufDestino}</td>
                <td>{item.tipo}</td>
                <td>{formatarMoeda(item.valorTabela)}</td>
                <td>{formatarMoeda(item.valorReferencia)}</td>
                <td>{item.melhorTabelaNome || '-'}</td>
                <td className={classeDiferenca(item.diferenca)}>{formatarMoeda(item.diferenca)}</td>
                <td className={classeDiferenca(item.diferenca)}>{formatarPercentual(item.variacao)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabelaDetalhesAntt({ titulo, analise }) {
  if (!analise?.detalhes?.length) return null;

  return (
    <div className="table-card lotacao-table-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">{titulo}</div>
          <p className="compact">Maiores diferenças percentuais contra a referência ANTT.</p>
        </div>
      </div>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>Transportadora</th>
              <th>Origem</th>
              <th>Destino</th>
              <th>Tipo</th>
              <th>Tabela</th>
              <th>ANTT</th>
              <th>Diferença</th>
              <th>%</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {analise.detalhes.slice(0, 100).map((item) => (
              <tr key={item.id}>
                <td><strong>{item.tabelaNome}</strong></td>
                <td>{item.origem}/{item.ufOrigem}</td>
                <td>{item.destino}/{item.ufDestino}</td>
                <td>{item.tipo}</td>
                <td>{formatarMoeda(item.valorTabela)}</td>
                <td>{formatarMoeda(item.valorAntt)}</td>
                <td className={classeAntt(item.status)}>{formatarMoeda(item.diferenca)}</td>
                <td className={classeAntt(item.status)}>{formatarPercentual(item.variacao)}</td>
                <td><span className="status-pill">{item.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResumoAnttPorTransportadora({ analise }) {
  if (!analise?.porTransportadora?.length) return null;

  return (
    <div className="table-card lotacao-table-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Resumo ANTT por transportadora</div>
          <p className="compact">Visão rápida de cada tabela contra a referência ANTT.</p>
        </div>
      </div>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>Transportadora</th>
              <th>Comparadas</th>
              <th>Abaixo ANTT</th>
              <th>% abaixo</th>
              <th>Acima ANTT</th>
              <th>% acima</th>
              <th>Igual</th>
              <th>Diferença total</th>
              <th>Variação média</th>
            </tr>
          </thead>
          <tbody>
            {analise.porTransportadora.map((item) => (
              <tr key={item.tabelaNome}>
                <td><strong>{item.tabelaNome}</strong></td>
                <td>{item.comparadas}</td>
                <td className="negativo">{item.abaixo}</td>
                <td className="negativo">{formatarPercentual(item.pctAbaixo)}</td>
                <td className="positivo">{item.acima}</td>
                <td className="positivo">{formatarPercentual(item.pctAcima)}</td>
                <td>{item.igual}</td>
                <td>{formatarMoeda(item.somaDiferenca)}</td>
                <td>{formatarPercentual(item.variacaoMedia)}</td>
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
          <p>Digite origem, destino ou tipo de veículo para ver o ranking das transportadoras, do mais barato ao mais caro.</p>
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
                <th>Transportadora</th>
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
          <p className="compact">A ANTT é única. Ao subir novamente, o sistema substitui a versão anterior. Transportadoras são substituídas pelo mesmo nome.</p>
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


function normLot(v) {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
}

function fmt(v) { return Number(v||0).toLocaleString('pt-BR', {style:'currency',currency:'BRL'}); }
function fmtPct(v) { return `${Number(v||0).toFixed(1)}%`; }

function ExportBtn({ icon, title, sub, onClick, accent = '#185FA5' }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 9,
        padding: '8px 13px',
        border: `1.5px solid ${hover ? accent : '#D8D8E0'}`,
        borderRadius: 10,
        background: hover ? '#F0F6FF' : '#FAFAFA',
        cursor: 'pointer', textAlign: 'left',
        boxShadow: hover ? `0 0 0 3px ${accent}22` : '0 1px 3px rgba(0,0,0,0.07)',
        transition: 'all 0.14s ease',
        minWidth: 130,
        outline: 'none',
      }}
    >
      <span style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 30, height: 30, borderRadius: 7, flexShrink: 0,
        background: hover ? accent : '#E8EDF5',
        transition: 'background 0.14s ease',
      }}>
        <i className={`ti ti-${icon}`} style={{ fontSize: 15, color: hover ? '#fff' : accent }} aria-hidden="true" />
      </span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#1A1A2E', lineHeight: 1.3 }}>{title}</div>
        <div style={{ fontSize: 10, color: '#6B7280', lineHeight: 1.3, marginTop: 1 }}>{sub}</div>
      </div>
    </button>
  );
}

function ExpandCard({ icon, title, badge, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 18,
        overflow: 'hidden',
        background: '#fff',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 16px',
          background: 'var(--panel-soft)',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 14,
            fontWeight: 700,
            color: 'var(--text)',
          }}
        >
          <i className={`ti ti-${icon}`} style={{ fontSize: 16 }} aria-hidden="true" />
          {title}
        </span>

        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: 'var(--muted)',
            fontWeight: 600,
          }}
        >
          {badge}
          <i className={`ti ti-chevron-${open ? 'up' : 'down'}`} style={{ fontSize: 14 }} aria-hidden="true" />
        </span>
      </button>

      {open && <div style={{ padding: 16 }}>{children}</div>}
    </div>
  );
}

function FiltroBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{fontSize:11,padding:'4px 10px',borderRadius:'var(--border-radius-md)',border:'0.5px solid var(--color-border-secondary)',background:active?'var(--color-text-primary)':'var(--color-background-primary)',color:active?'var(--color-background-primary)':'var(--color-text-primary)',cursor:'pointer'}}>
      {children}
    </button>
  );
}

function PainelTransportadora({
  tabela,
  transportadoras,
  selecionadaId,
  setSelecionadaId,
  resumoRealizado,
  comparativo,
  analiseAntt,
  periodo,
  setPeriodo,
}) {
  const [filtroRota, setFiltroRota] = useState('todas');

  const linhasTabela = tabela?.linhas || [];

  const mapaReal = useMemo(() => {
    const m = new Map();
    (resumoRealizado || []).forEach((r) => {
      const k = `${normLot(r.origem)}|${normLot(r.destino)}|${normLot(r.tipo_veiculo)}`;
      const prev = m.get(k);
      if (!prev || Number(r.total_cargas || 0) > Number(prev.total_cargas || 0)) {
        m.set(k, r);
      }
    });
    return m;
  }, [resumoRealizado]);

  const linhas = useMemo(() => {
    return linhasTabela
      .map((linha) => {
        const k = `${normLot(linha.origem)}|${normLot(linha.destino)}|${normLot(linha.tipo)}`;
        const real = mapaReal.get(k) || null;

        const detComp = (comparativo?.detalhes || []).find(
          (d) =>
            normLot(d.origem) === normLot(linha.origem) &&
            normLot(d.destino) === normLot(linha.destino) &&
            normLot(d.tipo) === normLot(linha.tipo)
        );

        const detAntt = (analiseAntt?.detalhes || []).find(
          (d) =>
            normLot(d.origem) === normLot(linha.origem) &&
            normLot(d.destino) === normLot(linha.destino) &&
            normLot(d.tipo) === normLot(linha.tipo)
        );

        const nossaTabela = Number(linha.target || linha.valorOtimizado || linha.valor || 0);
        const melhorConc = Number(detComp?.valorReferencia || 0);
        const ganhouTabela = detComp ? detComp.diferenca <= 0.01 : null;

        const pctParaGanhar =
          !ganhouTabela && melhorConc > 0 && nossaTabela > 0
            ? ((nossaTabela - melhorConc) / nossaTabela) * 100
            : 0;

        const realizadoMedio = real ? Number(real.frete_medio) : null;
        const cargasMes = real ? Number(real.total_cargas) : 0;

        return {
          ...linha,
          real,
          nossaTabela,
          melhorConc,
          ganhouTabela,
          pctParaGanhar,
          realizadoMedio,
          cargasMes,
          concorrente: detComp?.melhorTabelaNome || '-',
          statusAntt: detAntt?.status || null,
          valorAntt: detAntt?.valorAntt ?? null,
          diferencaAntt: detAntt?.diferenca ?? null,
          variacaoAntt: detAntt?.variacao ?? detAntt?.variacaoNovoAntt ?? null,
        };
      })
      .sort((a, b) => b.cargasMes - a.cargasMes);
  }, [linhasTabela, mapaReal, comparativo, analiseAntt]);

  const ganhouN = linhas.filter((l) => l.ganhouTabela === true).length;
  const perdeuN = linhas.filter((l) => l.ganhouTabela === false).length;
  const comReal = linhas.filter((l) => l.real != null).length;
  const rotasAtivas = linhas.filter((l) => l.cargasMes > 0).length;
  const totalCargas = linhas.reduce((a, l) => a + Number(l.cargasMes || 0), 0);

  const savingPotencial = linhas
    .filter((l) => l.ganhouTabela === false && l.nossaTabela > l.melhorConc)
    .reduce((a, l) => a + (l.nossaTabela - l.melhorConc) * Math.max(l.cargasMes, 1), 0);

  const abaixoAntt = (analiseAntt?.detalhes || []).filter((d) => d.status?.includes('Abaixo')).length;
  const acimaAntt = (analiseAntt?.detalhes || []).filter((d) => d.status?.includes('Acima')).length;

  const linhasComReal = linhas.filter((l) => l.realizadoMedio != null);
  const realizadoMedioGeral = linhasComReal.length
    ? linhasComReal.reduce((a, l) => a + Number(l.realizadoMedio || 0), 0) / linhasComReal.length
    : null;
  const tabelaMediaGeral = linhasComReal.length
    ? linhasComReal.reduce((a, l) => a + Number(l.nossaTabela || 0), 0) / linhasComReal.length
    : null;

  const topRotas = useMemo(() => {
    const ordenadas = [...linhas].filter((l) => l.cargasMes > 0).sort((a, b) => b.cargasMes - a.cargasMes);

    if (!ordenadas.length) {
      return [...linhas].slice(0, 5);
    }

    const total = ordenadas.reduce((a, l) => a + l.cargasMes, 0);
    const selecionadas = [];
    let acumulado = 0;

    for (const item of ordenadas) {
      selecionadas.push(item);
      acumulado += item.cargasMes;

      if (selecionadas.length >= 5 && total > 0 && acumulado / total >= 0.8) {
        break;
      }
    }

    return selecionadas;
  }, [linhas]);

  const maxCargas = topRotas[0]?.cargasMes || 1;

  const linhasFiltradas = linhas.filter((l) => {
    if (filtroRota === 'ganhou') return l.ganhouTabela === true;
    if (filtroRota === 'perdeu') return l.ganhouTabela === false;
    if (filtroRota === 'comReal') return l.real != null;
    if (filtroRota === 'semReal') return l.real == null;
    return true;
  });

  const exportarDiretoria = () => {
    import('xlsx')
      .then((XLSX) => {
        const rows = linhas.map((l) => ({
          Origem: l.origem,
          Destino: l.destino,
          Tipo: l.tipo,
          KM: l.km,
          'Nossa tabela': l.nossaTabela,
          Concorrente: l.melhorConc,
          'Transportadora concorrente': l.concorrente,
          '% para ganhar': l.pctParaGanhar.toFixed(1),
          'Realizado médio': l.realizadoMedio,
          'Cargas/mês': l.cargasMes,
          Status:
            l.ganhouTabela === true
              ? 'Ganhou'
              : l.ganhouTabela === false
              ? 'Perdeu'
              : 'Sem comparativo',
        }));

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Análise');
        XLSX.writeFile(wb, `analise-${tabela?.nome || 'transportadora'}.xlsx`);
      })
      .catch(() => alert('Erro ao exportar'));
  };

  const exportarDevolucao = () => {
    import('xlsx')
      .then((XLSX) => {
        const rows = linhas
          .filter((l) => l.ganhouTabela === false && l.pctParaGanhar > 0)
          .sort((a, b) => b.cargasMes - a.cargasMes)
          .map((l) => ({
            Origem: l.origem,
            Destino: l.destino,
            Tipo: l.tipo,
            KM: l.km,
            'Nossa tabela': l.nossaTabela,
            Concorrente: l.melhorConc,
            '% necessário de redução': `-${l.pctParaGanhar.toFixed(1)}%`,
            'Cargas/mês': l.cargasMes,
            'Saving mensal potencial': ((l.nossaTabela - l.melhorConc) * Math.max(l.cargasMes, 1)).toFixed(2),
            Prioridade: l.cargasMes >= 10 ? 'Alta' : l.cargasMes >= 3 ? 'Média' : 'Baixa',
          }));

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Devolução');
        XLSX.writeFile(wb, `devolucao-${tabela?.nome || 'transportadora'}.xlsx`);
      })
      .catch(() => alert('Erro ao exportar'));
  };

  // ── helpers compartilhados entre os dois relatórios ──────────────────
  // ── paleta AMD Log ────────────────────────────────────────────────────
  const AMD = {
    navy:    '1E3A5F',
    azul:    '185FA5',
    azulCl:  'D6E8FA',
    verde:   '1D9E75',
    verdeCl: 'D4F0E7',
    lrnj:    'D85A30',
    lrnjCl:  'FBE6DE',
    branco:  'FFFFFF',
    cinzaCl: 'F5F7FA',
    cinzaMd: 'E2E6ED',
    cinzaTx: '6B7280',
    texto:   '1A1A2E',
  };

  // ── aplica estilo em range de células ─────────────────────────────────
  const _styleRange = (ws, XLSX, r1, r2, c1, c2, s) => {
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        const a = XLSX.utils.encode_cell({ r, c });
        if (!ws[a]) ws[a] = { v: '', t: 's' };
        ws[a].s = s;
      }
    }
  };

  // ── aplica estilo em células individuais ─────────────────────────────
  const _styleCell = (ws, XLSX, r, c, s) => {
    const a = XLSX.utils.encode_cell({ r, c });
    if (!ws[a]) ws[a] = { v: '', t: 's' };
    ws[a].s = s;
  };

  // ── estilos base ─────────────────────────────────────────────────────
  const _S = {
    brd: (rgb = 'D0D5DD') => ({
      top:    { style: 'thin', color: { rgb } },
      bottom: { style: 'thin', color: { rgb } },
      left:   { style: 'thin', color: { rgb } },
      right:  { style: 'thin', color: { rgb } },
    }),
    navy:  (sz = 11) => ({ font: { bold: true,  sz, color: { rgb: 'FFFFFF' }, name: 'Calibri' }, fill: { patternType: 'solid', fgColor: { rgb: '1E3A5F' } }, alignment: { horizontal: 'left', vertical: 'center' } }),
    azul:  (sz = 10) => ({ font: { bold: true,  sz, color: { rgb: 'FFFFFF' }, name: 'Calibri' }, fill: { patternType: 'solid', fgColor: { rgb: '185FA5' } }, alignment: { horizontal: 'left', vertical: 'center' } }),
    th:    ()        => ({ font: { bold: true,  sz: 10, color: { rgb: 'FFFFFF' }, name: 'Calibri' }, fill: { patternType: 'solid', fgColor: { rgb: '1E3A5F' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } }),
    lbl:   ()        => ({ font: { bold: false, sz: 10, color: { rgb: '1A1A2E' }, name: 'Calibri' }, fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } }, alignment: { horizontal: 'left', vertical: 'center' }, border: { top: { style: 'thin', color: { rgb: 'E2E6ED' } }, bottom: { style: 'thin', color: { rgb: 'E2E6ED' } }, left: { style: 'thin', color: { rgb: 'E2E6ED' } }, right: { style: 'thin', color: { rgb: 'E2E6ED' } } } }),
    val:   (rgb = '1E3A5F') => ({ font: { bold: true, sz: 11, color: { rgb }, name: 'Calibri' }, fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } }, alignment: { horizontal: 'right', vertical: 'center' }, border: { top: { style: 'thin', color: { rgb: 'E2E6ED' } }, bottom: { style: 'thin', color: { rgb: 'E2E6ED' } }, left: { style: 'thin', color: { rgb: 'E2E6ED' } }, right: { style: 'thin', color: { rgb: 'E2E6ED' } } } }),
    note:  ()        => ({ font: { italic: true, sz: 9, color: { rgb: '6B7280' }, name: 'Calibri' }, fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } }, alignment: { horizontal: 'left', vertical: 'center' }, border: { top: { style: 'thin', color: { rgb: 'E2E6ED' } }, bottom: { style: 'thin', color: { rgb: 'E2E6ED' } }, left: { style: 'thin', color: { rgb: 'E2E6ED' } }, right: { style: 'thin', color: { rgb: 'E2E6ED' } } } }),
    sep:   ()        => ({ font: { sz: 3, color: { rgb: 'E2E6ED' } }, fill: { patternType: 'solid', fgColor: { rgb: 'E2E6ED' } } }),
    foot:  ()        => ({ font: { italic: true, sz: 9, color: { rgb: '6B7280' }, name: 'Calibri' }, fill: { patternType: 'solid', fgColor: { rgb: 'E2E6ED' } }, alignment: { horizontal: 'left', vertical: 'center' } }),
    tdL:   (par)     => ({ font: { sz: 10, color: { rgb: '1A1A2E' }, name: 'Calibri' }, fill: { patternType: 'solid', fgColor: { rgb: par ? 'F5F7FA' : 'FFFFFF' } }, alignment: { horizontal: 'left',   vertical: 'center' }, border: { top: { style: 'thin', color: { rgb: 'E2E6ED' } }, bottom: { style: 'thin', color: { rgb: 'E2E6ED' } }, left: { style: 'thin', color: { rgb: 'E2E6ED' } }, right: { style: 'thin', color: { rgb: 'E2E6ED' } } } }),
    tdR:   (par)     => ({ font: { sz: 10, color: { rgb: '1A1A2E' }, name: 'Calibri' }, fill: { patternType: 'solid', fgColor: { rgb: par ? 'F5F7FA' : 'FFFFFF' } }, alignment: { horizontal: 'right',  vertical: 'center' }, border: { top: { style: 'thin', color: { rgb: 'E2E6ED' } }, bottom: { style: 'thin', color: { rgb: 'E2E6ED' } }, left: { style: 'thin', color: { rgb: 'E2E6ED' } }, right: { style: 'thin', color: { rgb: 'E2E6ED' } } } }),
    tdC:   (par, rgb)=> ({ font: { bold: true, sz: 10, color: { rgb }, name: 'Calibri' }, fill: { patternType: 'solid', fgColor: { rgb: par ? 'F5F7FA' : 'FFFFFF' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: { top: { style: 'thin', color: { rgb: 'E2E6ED' } }, bottom: { style: 'thin', color: { rgb: 'E2E6ED' } }, left: { style: 'thin', color: { rgb: 'E2E6ED' } }, right: { style: 'thin', color: { rgb: 'E2E6ED' } } } }),
    numRed:(par)     => ({ font: { bold: true, sz: 10, color: { rgb: 'D85A30' }, name: 'Calibri' }, fill: { patternType: 'solid', fgColor: { rgb: par ? 'F5F7FA' : 'FFFFFF' } }, alignment: { horizontal: 'right',  vertical: 'center' }, border: { top: { style: 'thin', color: { rgb: 'E2E6ED' } }, bottom: { style: 'thin', color: { rgb: 'E2E6ED' } }, left: { style: 'thin', color: { rgb: 'E2E6ED' } }, right: { style: 'thin', color: { rgb: 'E2E6ED' } } } }),
    numGrn:(par)     => ({ font: { bold: true, sz: 10, color: { rgb: '1D9E75' }, name: 'Calibri' }, fill: { patternType: 'solid', fgColor: { rgb: par ? 'F5F7FA' : 'FFFFFF' } }, alignment: { horizontal: 'right',  vertical: 'center' }, border: { top: { style: 'thin', color: { rgb: 'E2E6ED' } }, bottom: { style: 'thin', color: { rgb: 'E2E6ED' } }, left: { style: 'thin', color: { rgb: 'E2E6ED' } }, right: { style: 'thin', color: { rgb: 'E2E6ED' } } } }),
  };

  // ── helper: estiliza tabela de dados (linha 0 = header) ──────────────
  const _styledTable = (ws, XLSX, data, colColors) => {
    const nCols = data[0]?.length || 0;
    // header row
    for (let c = 0; c < nCols; c++) _styleCell(ws, XLSX, 0, c, _S.th());
    // data rows
    for (let r = 1; r < data.length; r++) {
      const par = r % 2 === 0;
      for (let c = 0; c < nCols; c++) {
        const spec = colColors?.[c];
        const val = data[r][c];
        if (spec === 'right')   _styleCell(ws, XLSX, r, c, _S.tdR(par));
        else if (spec === 'center') _styleCell(ws, XLSX, r, c, _S.tdC(par, '1A1A2E'));
        else                    _styleCell(ws, XLSX, r, c, _S.tdL(par));
      }
    }
  };

  // ── cálculos compartilhados ───────────────────────────────────────────
  const _calcRelatorio = () => {
    const nomeArq      = tabela?.nome || 'transportadora';
    const dataRel      = new Date().toLocaleDateString('pt-BR');
    const periodoLabel = { '1m': 'Último mês', '3m': 'Últimos 3 meses', '6m': 'Últimos 6 meses', '12m': 'Últimos 12 meses', all: 'Todo período' }[periodo] || periodo;
    const totalRotas   = linhas.length;
    const ganhouLst    = linhas.filter((l) => l.ganhouTabela === true);
    const perdeuLst    = linhas.filter((l) => l.ganhouTabela === false);
    const pctGanhou    = totalRotas ? ((ganhouLst.length / totalRotas) * 100).toFixed(1) : '0.0';
    const pctPerdeu    = totalRotas ? ((perdeuLst.length  / totalRotas) * 100).toFixed(1) : '0.0';
    const volumeTop80  = topRotas.reduce((a, l) => a + Number(l.cargasMes || 0), 0);
    const pctVol80     = totalCargas ? ((volumeTop80 / totalCargas) * 100).toFixed(1) : '0.0';
    const fmtBRL       = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const fatPrevisto  = ganhouLst.reduce((a, l) => a + Number(l.nossaTabela || 0) * Math.max(Number(l.cargasMes || 0), 0), 0);
    const fatPerdido   = perdeuLst.reduce((a, l) => a + Number(l.nossaTabela || 0) * Math.max(Number(l.cargasMes || 0), 0), 0);
    const savingGanhou = ganhouLst.filter((l) => l.melhorConc > 0).reduce((a, l) => a + (Number(l.melhorConc || 0) - Number(l.nossaTabela || 0)) * Math.max(Number(l.cargasMes || 1), 1), 0);
    return { nomeArq, dataRel, periodoLabel, totalRotas, ganhouLst, perdeuLst, pctGanhou, pctPerdeu, volumeTop80, pctVol80, fmtBRL, fatPrevisto, fatPerdido, savingGanhou };
  };

  // ── RELATÓRIO FORNECEDOR ──────────────────────────────────────────────
  const exportarFornecedor = () => {
    import('xlsx').then((XLSX) => {
      const { nomeArq, dataRel, periodoLabel, totalRotas, ganhouLst, perdeuLst, pctGanhou, pctPerdeu, volumeTop80, pctVol80 } = _calcRelatorio();
      const top80G = topRotas.filter((l) => l.ganhouTabela === true).length;
      const top80P = topRotas.filter((l) => l.ganhouTabela === false).length;

      // ── Sheet 1: Resumo ───────────────────────────────────────────────
      const sep = ['', '', '', ''];
      const resumoAOA = [
        /* 0  */ ['PROPOSTA DE NEGOCIAÇÃO DE FRETE — LOTAÇÃO', '', '', ''],
        /* 1  */ ['Transportadora: ' + nomeArq, '', 'Período: ' + periodoLabel, 'Data: ' + dataRel],
        /* 2  */ sep,
        /* 3  */ ['COBERTURA DA TABELA', '', '', ''],
        /* 4  */ ['Total de rotas cadastradas', totalRotas, 'rotas', ''],
        /* 5  */ ['Volume total (cargas/mês)', totalCargas, 'embarques', ''],
        /* 6  */ sep,
        /* 7  */ ['RESULTADO COMPETITIVO', '', '', ''],
        /* 8  */ ['Rotas em que somos competitivos', ganhouLst.length + ' rotas', pctGanhou + '%', ''],
        /* 9  */ ['Rotas onde precisamos de ajuste', perdeuLst.length + ' rotas', pctPerdeu + '%', ''],
        /* 10 */ sep,
        /* 11 */ ['VOLUME CRÍTICO — PARETO 80%', '', '', ''],
        /* 12 */ ['Rotas que concentram 80% do volume', topRotas.length + ' rotas', pctVol80 + '% do volume total', ''],
        /* 13 */ ['Embarques/mês nessas rotas críticas', volumeTop80, 'de ' + totalCargas + ' totais', ''],
        /* 14 */ ['  · Competitivos nessas rotas', top80G + ' de ' + topRotas.length, '', ''],
        /* 15 */ ['  · Precisam de ajuste nessas rotas', top80P + ' de ' + topRotas.length, '', ''],
        /* 16 */ sep,
        /* 17 */ ['PRÓXIMOS PASSOS', '', '', ''],
        /* 18 */ ['1', 'Revisar aba "Top 80% Volume"', 'PRIORIDADE MÁXIMA', 'Rotas com maior volume — maior impacto'],
        /* 19 */ ['2', 'Revisar aba "Rotas a Negociar"', 'PRIORIDADE ALTA', 'Todas as rotas onde precisamos de ajuste'],
        /* 20 */ ['3', 'Focar em linhas "Prioridade Alta"', '≥ 10 cargas/mês', 'Maior retorno volumétrico'],
        /* 21 */ ['4', 'Observar coluna "% de Ajuste"', 'Por rota', 'Variação necessária para competir'],
        /* 22 */ sep,
        /* 23 */ ['Gerado por Central de Fretes · Lotação — ' + dataRel, '', '', ''],
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(resumoAOA);
      ws1['!cols'] = [{ wch: 42 }, { wch: 22 }, { wch: 28 }, { wch: 38 }];
      ws1['!rows'] = [{ hpt: 28 }, { hpt: 14 }];
      // aplicar estilos linha a linha
      _styleRange(ws1, XLSX, 0, 0, 0, 3, _S.navy(14));
      _styleRange(ws1, XLSX, 1, 1, 0, 3, { font: { sz: 9, color: { rgb: AMD.azulCl }, name: 'Calibri' }, fill: { patternType: 'solid', fgColor: { rgb: AMD.navy } } });
      _styleRange(ws1, XLSX, 2, 2, 0, 3, _S.sep());
      _styleRange(ws1, XLSX, 3, 3, 0, 3, _S.azul());
      _styleCell(ws1, XLSX, 4, 0, _S.lbl());  _styleCell(ws1, XLSX, 4, 1, _S.val());  _styleCell(ws1, XLSX, 4, 2, _S.note());  _styleCell(ws1, XLSX, 4, 3, _S.note());
      _styleCell(ws1, XLSX, 5, 0, _S.lbl());  _styleCell(ws1, XLSX, 5, 1, _S.val());  _styleCell(ws1, XLSX, 5, 2, _S.note());  _styleCell(ws1, XLSX, 5, 3, _S.note());
      _styleRange(ws1, XLSX, 6, 6, 0, 3, _S.sep());
      _styleRange(ws1, XLSX, 7, 7, 0, 3, _S.azul());
      _styleCell(ws1, XLSX, 8, 0, _S.lbl());  _styleCell(ws1, XLSX, 8, 1, _S.val(AMD.verde));  _styleCell(ws1, XLSX, 8, 2, _S.val(AMD.verde));  _styleCell(ws1, XLSX, 8, 3, _S.note());
      _styleCell(ws1, XLSX, 9, 0, _S.lbl());  _styleCell(ws1, XLSX, 9, 1, _S.val(AMD.lrnj));   _styleCell(ws1, XLSX, 9, 2, _S.val(AMD.lrnj));   _styleCell(ws1, XLSX, 9, 3, _S.note());
      _styleRange(ws1, XLSX, 10, 10, 0, 3, _S.sep());
      _styleRange(ws1, XLSX, 11, 11, 0, 3, _S.azul());
      _styleRange(ws1, XLSX, 12, 15, 0, 0, _S.lbl());
      _styleRange(ws1, XLSX, 12, 15, 1, 1, _S.val());
      _styleRange(ws1, XLSX, 12, 15, 2, 3, _S.note());
      _styleRange(ws1, XLSX, 16, 16, 0, 3, _S.sep());
      _styleRange(ws1, XLSX, 17, 17, 0, 3, _S.azul());
      for (let r = 18; r <= 21; r++) {
        _styleCell(ws1, XLSX, r, 0, { font: { bold: true, sz: 11, color: { rgb: AMD.azul }, name: 'Calibri' }, fill: { patternType: 'solid', fgColor: { rgb: AMD.azulCl } }, alignment: { horizontal: 'center', vertical: 'center' } });
        _styleCell(ws1, XLSX, r, 1, { font: { bold: true, sz: 10, color: { rgb: AMD.texto }, name: 'Calibri' }, fill: { patternType: 'solid', fgColor: { rgb: AMD.cinzaCl } }, alignment: { horizontal: 'left', vertical: 'center' } });
        _styleCell(ws1, XLSX, r, 2, { font: { bold: true, sz: 10, color: { rgb: AMD.azul  }, name: 'Calibri' }, fill: { patternType: 'solid', fgColor: { rgb: AMD.cinzaCl } }, alignment: { horizontal: 'left', vertical: 'center' } });
        _styleCell(ws1, XLSX, r, 3, _S.note());
      }
      _styleRange(ws1, XLSX, 22, 22, 0, 3, _S.sep());
      _styleRange(ws1, XLSX, 23, 23, 0, 3, _S.foot());

      // ── Sheet 2: Top 80% Volume ───────────────────────────────────────
      const top80Hdr = ['Origem', 'Destino', 'Tipo', 'Cargas/mês', '% do Volume', 'Proposta', '% de Ajuste', 'Situação'];
      const top80Data = [top80Hdr, ...topRotas.map((l) => {
        const pctVol = totalCargas ? ((l.cargasMes / totalCargas) * 100).toFixed(1) + '%' : '-';
        const sit = l.ganhouTabela === true ? 'Competitivo' : l.ganhouTabela === false ? 'Precisa ajuste' : 'Sem comparativo';
        return [l.origem, l.destino, l.tipo, l.cargasMes || 0, pctVol, Number(l.nossaTabela || 0), l.pctParaGanhar > 0 ? '-' + Number(l.pctParaGanhar).toFixed(1) + '%' : '—', sit];
      })];
      const ws2 = XLSX.utils.aoa_to_sheet(top80Data);
      ws2['!cols'] = [{ wch: 16 }, { wch: 22 }, { wch: 14 }, { wch: 13 }, { wch: 13 }, { wch: 16 }, { wch: 13 }, { wch: 18 }];
      ws2['!rows'] = [{ hpt: 28 }];
      // header
      for (let c = 0; c < top80Hdr.length; c++) _styleCell(ws2, XLSX, 0, c, _S.th());
      // data rows
      for (let r = 1; r < top80Data.length; r++) {
        const par = r % 2 === 0;
        const l = topRotas[r - 1];
        [0, 1, 2].forEach((c) => _styleCell(ws2, XLSX, r, c, _S.tdL(par)));
        [3, 4, 5].forEach((c) => _styleCell(ws2, XLSX, r, c, _S.tdR(par)));
        _styleCell(ws2, XLSX, r, 6, l?.pctParaGanhar > 0 ? _S.numRed(par) : _S.tdR(par));
        const sitCor = l?.ganhouTabela === true ? AMD.verde : l?.ganhouTabela === false ? AMD.lrnj : AMD.cinzaTx;
        _styleCell(ws2, XLSX, r, 7, _S.tdC(par, sitCor));
      }

      // ── Sheet 3: Rotas a Negociar ─────────────────────────────────────
      const negHdr = ['Origem', 'Destino', 'Tipo', 'KM', 'Cargas/mês', 'Proposta', 'Frete Vencedor', '% de Ajuste', 'Prioridade'];
      const perdSorted = [...perdeuLst].sort((a, b) => (b.cargasMes || 0) - (a.cargasMes || 0));
      const negData = [negHdr, ...perdSorted.map((l) => {
        const prio = (l.cargasMes || 0) >= 10 ? 'Alta' : (l.cargasMes || 0) >= 3 ? 'Média' : 'Baixa';
        return [l.origem, l.destino, l.tipo, l.km || '', l.cargasMes || 0, Number(l.nossaTabela || 0), l.melhorConc > 0 ? Number(l.melhorConc) : '', l.pctParaGanhar > 0 ? '-' + Number(l.pctParaGanhar).toFixed(1) + '%' : '—', prio];
      })];
      const ws3 = XLSX.utils.aoa_to_sheet(negData);
      ws3['!cols'] = [{ wch: 14 }, { wch: 22 }, { wch: 13 }, { wch: 7 }, { wch: 13 }, { wch: 16 }, { wch: 16 }, { wch: 13 }, { wch: 12 }];
      ws3['!rows'] = [{ hpt: 28 }];
      for (let c = 0; c < negHdr.length; c++) _styleCell(ws3, XLSX, 0, c, _S.th());
      for (let r = 1; r < negData.length; r++) {
        const par = r % 2 === 0;
        const l = perdSorted[r - 1];
        [0, 1, 2, 3].forEach((c) => _styleCell(ws3, XLSX, r, c, _S.tdL(par)));
        [4, 5, 6].forEach((c) => _styleCell(ws3, XLSX, r, c, _S.tdR(par)));
        _styleCell(ws3, XLSX, r, 7, _S.numRed(par));
        const prio = (l.cargasMes || 0) >= 10 ? 'Alta' : (l.cargasMes || 0) >= 3 ? 'Média' : 'Baixa';
        const prioCor = prio === 'Alta' ? AMD.lrnj : prio === 'Média' ? AMD.azul : AMD.cinzaTx;
        _styleCell(ws3, XLSX, r, 8, _S.tdC(par, prioCor));
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws1, 'Resumo');
      XLSX.utils.book_append_sheet(wb, ws2, 'Top 80% Volume');
      XLSX.utils.book_append_sheet(wb, ws3, 'Rotas a Negociar');
      XLSX.writeFile(wb, 'proposta-negociacao-' + nomeArq + '.xlsx', { cellStyles: true });
    }).catch((err) => { console.error('FORNECEDOR ERR', err); alert('Erro: ' + (err?.message || String(err))); });
  };

  // ── RELATÓRIO GESTÃO ──────────────────────────────────────────────────
  const exportarGestao = () => {
    import('xlsx').then((XLSX) => {
      const { nomeArq, dataRel, periodoLabel, totalRotas, ganhouLst, perdeuLst, pctGanhou, pctPerdeu, volumeTop80, pctVol80, fmtBRL, fatPrevisto, fatPerdido, savingGanhou } = _calcRelatorio();
      const top80G = topRotas.filter((l) => l.ganhouTabela === true).length;
      const top80P = topRotas.filter((l) => l.ganhouTabela === false).length;

      // ── Sheet 1: Resumo Executivo ─────────────────────────────────────
      const sep = ['', '', '', ''];
      const resumoAOA = [
        /* 0  */ ['RELATÓRIO DE GESTÃO — LOTAÇÃO', '', '', ''],
        /* 1  */ ['Transportadora: ' + nomeArq, '', 'Período: ' + periodoLabel, 'Data: ' + dataRel],
        /* 2  */ sep,
        /* 3  */ ['COBERTURA DA TABELA', '', '', ''],
        /* 4  */ ['Total de rotas cadastradas', totalRotas, 'rotas', ''],
        /* 5  */ ['Volume total (cargas/mês)', totalCargas, 'embarques', ''],
        /* 6  */ sep,
        /* 7  */ ['RESULTADO COMPETITIVO', '', '', ''],
        /* 8  */ ['Rotas ganhas', ganhouLst.length + ' rotas', pctGanhou + '% do total', ''],
        /* 9  */ ['Rotas perdidas', perdeuLst.length + ' rotas', pctPerdeu + '% do total', ''],
        /* 10 */ sep,
        /* 11 */ ['VOLUME CRÍTICO — PARETO 80%', '', '', ''],
        /* 12 */ ['Rotas que concentram 80% do volume', topRotas.length + ' rotas', pctVol80 + '% do volume', ''],
        /* 13 */ ['Embarques/mês nessas rotas', volumeTop80, 'de ' + totalCargas + ' totais', ''],
        /* 14 */ ['  · Ganhamos nessas rotas', top80G + ' de ' + topRotas.length, '', ''],
        /* 15 */ ['  · Perdemos nessas rotas', top80P + ' de ' + topRotas.length, '', ''],
        /* 16 */ sep,
        /* 17 */ ['IMPACTO FINANCEIRO', '', '', ''],
        /* 18 */ ['Faturamento previsto (rotas ganhas)', fmtBRL(fatPrevisto), 'proposta × cargas/mês', ''],
        /* 19 */ ['Volume em risco (rotas perdidas)', fmtBRL(fatPerdido), 'nossa tabela × cargas das rotas perdidas', ''],
        /* 20 */ ['Saving das rotas ganhas (vs concorrente)', fmtBRL(savingGanhou), 'vantagem competitiva por mês', ''],
        /* 21 */ ['Saving potencial (se ganhar todas perdidas)', fmtBRL(savingPotencial), 'estimativa acumulada', ''],
        /* 22 */ sep,
        /* 23 */ ['Gerado por Central de Fretes · Lotação — ' + dataRel, '', '', ''],
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(resumoAOA);
      ws1['!cols'] = [{ wch: 46 }, { wch: 26 }, { wch: 36 }, { wch: 10 }];
      ws1['!rows'] = [{ hpt: 28 }, { hpt: 14 }];
      _styleRange(ws1, XLSX, 0, 0, 0, 3, _S.navy(14));
      _styleRange(ws1, XLSX, 1, 1, 0, 3, { font: { sz: 9, color: { rgb: AMD.azulCl }, name: 'Calibri' }, fill: { patternType: 'solid', fgColor: { rgb: AMD.navy } } });
      _styleRange(ws1, XLSX, 2, 2, 0, 3, _S.sep());
      _styleRange(ws1, XLSX, 3, 3, 0, 3, _S.navy());
      _styleRange(ws1, XLSX, 4, 5, 0, 0, _S.lbl()); _styleRange(ws1, XLSX, 4, 5, 1, 1, _S.val()); _styleRange(ws1, XLSX, 4, 5, 2, 3, _S.note());
      _styleRange(ws1, XLSX, 6, 6, 0, 3, _S.sep());
      _styleRange(ws1, XLSX, 7, 7, 0, 3, _S.navy());
      _styleCell(ws1, XLSX, 8, 0, _S.lbl()); _styleCell(ws1, XLSX, 8, 1, _S.val(AMD.verde)); _styleCell(ws1, XLSX, 8, 2, _S.val(AMD.verde)); _styleCell(ws1, XLSX, 8, 3, _S.note());
      _styleCell(ws1, XLSX, 9, 0, _S.lbl()); _styleCell(ws1, XLSX, 9, 1, _S.val(AMD.lrnj));  _styleCell(ws1, XLSX, 9, 2, _S.val(AMD.lrnj));  _styleCell(ws1, XLSX, 9, 3, _S.note());
      _styleRange(ws1, XLSX, 10, 10, 0, 3, _S.sep());
      _styleRange(ws1, XLSX, 11, 11, 0, 3, _S.navy());
      _styleRange(ws1, XLSX, 12, 15, 0, 0, _S.lbl()); _styleRange(ws1, XLSX, 12, 15, 1, 1, _S.val()); _styleRange(ws1, XLSX, 12, 15, 2, 3, _S.note());
      _styleRange(ws1, XLSX, 16, 16, 0, 3, _S.sep());
      _styleRange(ws1, XLSX, 17, 17, 0, 3, _S.navy());
      _styleCell(ws1, XLSX, 18, 0, _S.lbl()); _styleCell(ws1, XLSX, 18, 1, _S.val(AMD.verde)); _styleCell(ws1, XLSX, 18, 2, _S.note()); _styleCell(ws1, XLSX, 18, 3, _S.note());
      _styleCell(ws1, XLSX, 19, 0, _S.lbl()); _styleCell(ws1, XLSX, 19, 1, _S.val(AMD.lrnj));  _styleCell(ws1, XLSX, 19, 2, _S.note()); _styleCell(ws1, XLSX, 19, 3, _S.note());
      _styleCell(ws1, XLSX, 20, 0, _S.lbl()); _styleCell(ws1, XLSX, 20, 1, _S.val(AMD.verde)); _styleCell(ws1, XLSX, 20, 2, _S.note()); _styleCell(ws1, XLSX, 20, 3, _S.note());
      _styleCell(ws1, XLSX, 21, 0, _S.lbl()); _styleCell(ws1, XLSX, 21, 1, _S.val(AMD.azul));  _styleCell(ws1, XLSX, 21, 2, _S.note()); _styleCell(ws1, XLSX, 21, 3, _S.note());
      _styleRange(ws1, XLSX, 22, 22, 0, 3, _S.sep());
      _styleRange(ws1, XLSX, 23, 23, 0, 3, _S.foot());

      // ── Sheet 2: Top 80% Volume ───────────────────────────────────────
      const top80Hdr = ['Origem', 'Destino', 'Tipo', 'Cargas/mês', '% Volume', 'Nossa Tabela', 'Frete Vencedor', 'Realizado Médio', '% p/ Ganhar', 'Status'];
      const top80Data = [top80Hdr, ...topRotas.map((l) => {
        const pctVol = totalCargas ? ((l.cargasMes / totalCargas) * 100).toFixed(1) + '%' : '-';
        return [l.origem, l.destino, l.tipo, l.cargasMes || 0, pctVol, Number(l.nossaTabela || 0), l.melhorConc > 0 ? Number(l.melhorConc) : '', l.realizadoMedio != null ? Number(l.realizadoMedio) : '', l.pctParaGanhar > 0 ? '-' + Number(l.pctParaGanhar).toFixed(1) + '%' : '—', l.ganhouTabela === true ? 'Ganhou' : l.ganhouTabela === false ? 'Perdeu' : '—'];
      })];
      const ws2 = XLSX.utils.aoa_to_sheet(top80Data);
      ws2['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 13 }, { wch: 13 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 12 }];
      ws2['!rows'] = [{ hpt: 28 }];
      for (let c = 0; c < top80Hdr.length; c++) _styleCell(ws2, XLSX, 0, c, _S.th());
      for (let r = 1; r < top80Data.length; r++) {
        const par = r % 2 === 0;
        const l = topRotas[r - 1];
        [0, 1, 2].forEach((c) => _styleCell(ws2, XLSX, r, c, _S.tdL(par)));
        [3, 4, 5, 6, 7].forEach((c) => _styleCell(ws2, XLSX, r, c, _S.tdR(par)));
        _styleCell(ws2, XLSX, r, 8, l?.pctParaGanhar > 0 ? _S.numRed(par) : _S.tdR(par));
        _styleCell(ws2, XLSX, r, 9, _S.tdC(par, l?.ganhouTabela === true ? AMD.verde : l?.ganhouTabela === false ? AMD.lrnj : AMD.cinzaTx));
      }

      // ── Sheet 3: Rotas Perdidas ───────────────────────────────────────
      const perdHdr = ['Origem', 'Destino', 'Tipo', 'KM', 'Cargas/mês', 'Nossa Tabela', 'Frete Vencedor', '% p/ Ganhar', 'Saving Mensal', 'Prioridade'];
      const perdSorted = [...perdeuLst].sort((a, b) => (b.cargasMes || 0) - (a.cargasMes || 0));
      const perdData = [perdHdr, ...perdSorted.map((l) => {
        const sav = l.melhorConc > 0 ? (Number(l.nossaTabela || 0) - Number(l.melhorConc || 0)) * Math.max(Number(l.cargasMes || 1), 1) : 0;
        const prio = (l.cargasMes || 0) >= 10 ? 'Alta' : (l.cargasMes || 0) >= 3 ? 'Média' : 'Baixa';
        return [l.origem, l.destino, l.tipo, l.km || '', l.cargasMes || 0, Number(l.nossaTabela || 0), l.melhorConc > 0 ? Number(l.melhorConc) : '', l.pctParaGanhar > 0 ? '-' + Number(l.pctParaGanhar).toFixed(1) + '%' : '—', sav > 0 ? Number(sav.toFixed(2)) : '', prio];
      })];
      const ws3 = XLSX.utils.aoa_to_sheet(perdData);
      ws3['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 13 }, { wch: 7 }, { wch: 13 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 18 }, { wch: 12 }];
      ws3['!rows'] = [{ hpt: 28 }];
      for (let c = 0; c < perdHdr.length; c++) _styleCell(ws3, XLSX, 0, c, _S.th());
      for (let r = 1; r < perdData.length; r++) {
        const par = r % 2 === 0;
        const l = perdSorted[r - 1];
        [0, 1, 2, 3].forEach((c) => _styleCell(ws3, XLSX, r, c, _S.tdL(par)));
        [4, 5, 6].forEach((c) => _styleCell(ws3, XLSX, r, c, _S.tdR(par)));
        _styleCell(ws3, XLSX, r, 7, _S.numRed(par));
        _styleCell(ws3, XLSX, r, 8, _S.numRed(par));
        const prio = (l.cargasMes || 0) >= 10 ? 'Alta' : (l.cargasMes || 0) >= 3 ? 'Média' : 'Baixa';
        _styleCell(ws3, XLSX, r, 9, _S.tdC(par, prio === 'Alta' ? AMD.lrnj : prio === 'Média' ? AMD.azul : AMD.cinzaTx));
      }

      // ── Sheet 4: Rotas Ganhas ─────────────────────────────────────────
      const ganHdr = ['Origem', 'Destino', 'Tipo', 'KM', 'Cargas/mês', 'Nossa Tabela', 'Frete Concorrente', 'Realizado Médio', 'Fat. Previsto (mês)', 'Saving vs Conc.'];
      const ganSorted = [...ganhouLst].sort((a, b) => (b.cargasMes || 0) - (a.cargasMes || 0));
      const ganData = [ganHdr, ...ganSorted.map((l) => {
        const fat = Number(l.nossaTabela || 0) * Math.max(Number(l.cargasMes || 0), 0);
        const sav = l.melhorConc > 0 ? (Number(l.melhorConc || 0) - Number(l.nossaTabela || 0)) * Math.max(Number(l.cargasMes || 1), 1) : 0;
        return [l.origem, l.destino, l.tipo, l.km || '', l.cargasMes || 0, Number(l.nossaTabela || 0), l.melhorConc > 0 ? Number(l.melhorConc) : '', l.realizadoMedio != null ? Number(l.realizadoMedio) : '', fat > 0 ? Number(fat.toFixed(2)) : '', sav > 0 ? Number(sav.toFixed(2)) : ''];
      })];
      const ws4 = XLSX.utils.aoa_to_sheet(ganData);
      ws4['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 13 }, { wch: 7 }, { wch: 13 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 20 }, { wch: 18 }];
      ws4['!rows'] = [{ hpt: 28 }];
      for (let c = 0; c < ganHdr.length; c++) _styleCell(ws4, XLSX, 0, c, _S.th());
      for (let r = 1; r < ganData.length; r++) {
        const par = r % 2 === 0;
        [0, 1, 2, 3].forEach((c) => _styleCell(ws4, XLSX, r, c, _S.tdL(par)));
        [4, 5, 6, 7].forEach((c) => _styleCell(ws4, XLSX, r, c, _S.tdR(par)));
        _styleCell(ws4, XLSX, r, 8, _S.numGrn(par));
        _styleCell(ws4, XLSX, r, 9, _S.numGrn(par));
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws1, 'Resumo Executivo');
      XLSX.utils.book_append_sheet(wb, ws2, 'Top 80% Volume');
      XLSX.utils.book_append_sheet(wb, ws3, 'Rotas Perdidas');
      XLSX.utils.book_append_sheet(wb, ws4, 'Rotas Ganhas');
      XLSX.writeFile(wb, 'gestao-lotacao-' + nomeArq + '.xlsx', { cellStyles: true });
    }).catch((err) => { console.error('GESTAO ERR', err); alert('Erro: ' + (err?.message || String(err))); });
  };


  if (!tabela) {
    return (
      <div className="panel-card">
        <div className="panel-title">Selecione uma transportadora para ver a análise</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="panel-card" style={{ gap: 12 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'flex-end',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(220px, 280px) minmax(180px, 220px)',
              gap: 12,
              flex: 1,
              minWidth: 320,
            }}
          >
            <label className="field">
              Transportadora
              <select value={selecionadaId || ''} onChange={(event) => setSelecionadaId(event.target.value)}>
                {transportadoras.length === 0 && <option value="">Nenhuma cadastrada</option>}
                {transportadoras.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.nome}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              Período
              <select value={periodo} onChange={(event) => setPeriodo(event.target.value)}>
                <option value="1m">Último mês</option>
                <option value="3m">Últimos 3 meses</option>
                <option value="6m">Últimos 6 meses</option>
                <option value="12m">Últimos 12 meses</option>
                <option value="all">Todo período</option>
              </select>
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid #EAECF0', paddingTop: 12 }}>
            <ExportBtn
              icon="file-export"
              title="Exportar diretoria"
              sub="Visão executiva"
              onClick={exportarDiretoria}
              accent="#6B7280"
            />
            <ExportBtn
              icon="send"
              title="Devolução transp."
              sub="Rotas perdidas"
              onClick={exportarDevolucao}
              accent="#D85A30"
            />
            <ExportBtn
              icon="report-analytics"
              title="Relatório fornecedor"
              sub="80% + resumo geral"
              onClick={exportarFornecedor}
              accent="#185FA5"
            />
            <ExportBtn
              icon="chart-line"
              title="Relatório gestão"
              sub="Saving + faturamento"
              onClick={exportarGestao}
              accent="#1E3A5F"
            />
          </div>

        <div
          className="summary-strip lotacao-kpis"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}
        >
          <div className="summary-card">
            <span>Total rotas</span>
            <strong>{linhas.length}</strong>
          </div>

          <div className="summary-card">
            <span>Ganhou</span>
            <strong style={{ color: '#1D9E75' }}>{ganhouN}</strong>
            <small>{linhas.length ? `${((ganhouN / linhas.length) * 100).toFixed(0)}%` : '-'}</small>
          </div>

          <div className="summary-card">
            <span>Perdeu</span>
            <strong style={{ color: '#D85A30' }}>{perdeuN}</strong>
            <small>{linhas.length ? `${((perdeuN / linhas.length) * 100).toFixed(0)}%` : '-'}</small>
          </div>

          <div className="summary-card">
            <span>Cargas/mês</span>
            <strong>{totalCargas || 0}</strong>
            <small>{rotasAtivas} rotas ativas</small>
          </div>

          <div className="summary-card">
            <span>Realizado médio</span>
            <strong>{realizadoMedioGeral != null ? fmt(realizadoMedioGeral) : '-'}</strong>
            <small>{tabelaMediaGeral != null ? `vs ${fmt(tabelaMediaGeral)} tabela` : 'sem realizado'}</small>
          </div>

          <div className="summary-card">
            <span>Saving potencial</span>
            <strong style={{ color: '#D85A30' }}>{fmt(savingPotencial)}</strong>
            <small>se ganhar todas</small>
          </div>
        </div>
      </div>

      <ExpandCard
        icon="chart-bar"
        title="Top rotas por volume — 80% do faturamento"
        badge={`${topRotas.length} rotas`}
        defaultOpen={true}
      >
        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead>
              <tr>
                <th>Rota</th>
                <th>Tipo</th>
                <th>Cargas/mês</th>
                <th>% volume</th>
                <th>Nossa tabela</th>
                <th>Realizado médio</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {topRotas.map((l, i) => {
                const pctVolume = totalCargas ? (l.cargasMes / totalCargas) * 100 : 0;
                return (
                  <tr key={i}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {l.origem} → {l.destino}
                    </td>
                    <td>{l.tipo}</td>
                    <td>{l.cargasMes || '-'}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div
                          style={{
                            height: 8,
                            width: 100,
                            borderRadius: 999,
                            background: '#ebe7df',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              width: `${(l.cargasMes / maxCargas) * 100}%`,
                              borderRadius: 999,
                              background: l.ganhouTabela === true ? '#1D9E75' : '#D85A30',
                            }}
                          />
                        </div>
                        <span>{pctVolume.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td>{fmt(l.nossaTabela)}</td>
                    <td style={{ color: l.realizadoMedio != null ? '#185FA5' : 'var(--muted)' }}>
                      {l.realizadoMedio != null ? fmt(l.realizadoMedio) : 'sem dados'}
                    </td>
                    <td>
                      {l.ganhouTabela === true && <span className="coverage-badge ok">Ganhou</span>}
                      {l.ganhouTabela === false && (
                        <span className="coverage-badge warn">
                          Perdeu {l.pctParaGanhar > 0 ? `- ${fmtPct(l.pctParaGanhar)}` : ''}
                        </span>
                      )}
                      {l.ganhouTabela === null && <span className="coverage-badge">Sem comp.</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ExpandCard>

      <ExpandCard
        icon="route"
        title="Todas as rotas — tabela vs concorrentes vs realizado"
        badge={`${linhas.length} rotas`}
        defaultOpen={true}
      >
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <FiltroBtn active={filtroRota === 'todas'} onClick={() => setFiltroRota('todas')}>
            Todas
          </FiltroBtn>
          <FiltroBtn active={filtroRota === 'ganhou'} onClick={() => setFiltroRota('ganhou')}>
            Ganhou ({ganhouN})
          </FiltroBtn>
          <FiltroBtn active={filtroRota === 'perdeu'} onClick={() => setFiltroRota('perdeu')}>
            Perdeu ({perdeuN})
          </FiltroBtn>
          <FiltroBtn active={filtroRota === 'comReal'} onClick={() => setFiltroRota('comReal')}>
            Com realizado
          </FiltroBtn>
          <FiltroBtn active={filtroRota === 'semReal'} onClick={() => setFiltroRota('semReal')}>
            Sem realizado
          </FiltroBtn>
        </div>

        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead>
              <tr>
                <th>Origem → Destino</th>
                <th>Tipo</th>
                <th>KM</th>
                <th>Nossa tabela</th>
                <th>Concorrente</th>
                <th>% p/ ganhar</th>
                <th>Realizado</th>
                <th>Cargas/mês</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {linhasFiltradas.slice(0, 200).map((l, i) => (
                <tr key={i}>
                  <td>
                    {l.origem}/{l.ufOrigem} → {l.destino}/{l.ufDestino}
                  </td>
                  <td>{l.tipo}</td>
                  <td>{l.km || '-'}</td>
                  <td>{fmt(l.nossaTabela)}</td>
                  <td>{l.melhorConc > 0 ? fmt(l.melhorConc) : '-'}</td>
                  <td style={{ color: l.pctParaGanhar > 0 ? '#D85A30' : 'inherit' }}>
                    {l.pctParaGanhar > 0 ? `-${fmtPct(l.pctParaGanhar)}` : '—'}
                  </td>
                  <td style={{ color: l.realizadoMedio != null ? '#185FA5' : 'var(--muted)' }}>
                    {l.realizadoMedio != null ? fmt(l.realizadoMedio) : 'sem dados'}
                  </td>
                  <td>{l.cargasMes || '-'}</td>
                  <td>
                    {l.ganhouTabela === true && <span className="coverage-badge ok">Ganhou</span>}
                    {l.ganhouTabela === false && <span className="coverage-badge warn">Perdeu</span>}
                    {l.ganhouTabela === null && <span className="coverage-badge">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
          Exibindo {Math.min(linhasFiltradas.length, 200)} de {linhasFiltradas.length}
        </div>
      </ExpandCard>

      <ExpandCard
        icon="scale"
        title="Análise ANTT"
        badge={`${abaixoAntt} abaixo · ${acimaAntt} acima`}
        defaultOpen={false}
      >
        <p style={{ margin: '0 0 12px', color: 'var(--muted)', fontSize: 12 }}>
          Clique para expandir e ver rotas abaixo e acima da ANTT com a diferença percentual.
        </p>

        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead>
              <tr>
                <th>Origem</th>
                <th>Destino</th>
                <th>Tipo</th>
                <th>Nossa tabela</th>
                <th>ANTT</th>
                <th>Diferença</th>
                <th>%</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(analiseAntt?.detalhes || []).slice(0, 100).map((d, i) => (
                <tr key={i}>
                  <td>{d.origem}/{d.ufOrigem}</td>
                  <td>{d.destino}/{d.ufDestino}</td>
                  <td>{d.tipo}</td>
                  <td>{fmt(d.valorTabela)}</td>
                  <td>{fmt(d.valorAntt)}</td>
                  <td style={{ color: d.diferenca < 0 ? '#D85A30' : '#1D9E75' }}>{fmt(d.diferenca)}</td>
                  <td style={{ color: d.diferenca < 0 ? '#D85A30' : '#1D9E75' }}>
                    {formatarPercentual(d.variacao ?? d.variacaoNovoAntt ?? 0)}
                  </td>
                  <td>
                    <span className={`coverage-badge ${d.status?.includes('Abaixo') ? 'warn' : 'ok'}`}>
                      {d.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ExpandCard>
    </div>
  );
}

export default function LotacaoPage() {
  const [tabelas, setTabelas] = useState([]);
  const [selecionadaId, setSelecionadaId] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [fonteDados, setFonteDados] = useState('carregando');
  const [diagnostico, setDiagnostico] = useState(null);
  const [tabelaReajuste, setTabelaReajuste] = useState(null);
  const [tabelaAntigaReajusteId, setTabelaAntigaReajusteId] = useState('');

  const usarSupabase = lotacaoSupabaseConfigurado();
  const supabaseInfo = obterInfoLotacaoSupabase();
  const [resumoRealizado, setResumoRealizado] = useState([]);
  const [periodoAnalise, setPeriodoAnalise] = useState('3m');

  const recarregarDados = useCallback(async ({ silencioso = false } = {}) => {
    if (!silencioso) setCarregando(true);
    try {
      if (usarSupabase) {
        const resposta = await carregarTabelasLotacaoSupabase();
        setTabelas(resposta.tabelas || []);
        setFonteDados('supabase');
        if (!silencioso) setFeedback(`Base de lotação atualizada pelo Supabase. Tabelas: ${(resposta.tabelas || []).length}.`);
        return;
      }

      const locais = carregarTabelasLotacao();
      setTabelas(locais);
      setFonteDados('local');
      if (!silencioso) setFeedback('Supabase não configurado. Dados carregados do navegador temporariamente.');
    } catch (error) {
      const locais = carregarTabelasLotacao();
      setTabelas(locais);
      setFonteDados('local-fallback');
      setFeedback(`Não consegui carregar a lotação no Supabase: ${error.message || error}. Carreguei o backup local do navegador, se existir.`);
    } finally {
      if (!silencioso) setCarregando(false);
    }
  }, [usarSupabase]);

  useEffect(() => {
    recarregarDados({ silencioso: true });
  }, [recarregarDados]);

  useEffect(() => {
    if (!usarSupabase) return;
    resumoRotasLotacaoSupabase({}).then(d => setResumoRealizado(d||[])).catch(()=>{});
  }, [usarSupabase]);

  useEffect(() => {
    if (!usarSupabase && fonteDados !== 'carregando') {
      salvarTabelasLotacao(tabelas);
    }
  }, [fonteDados, tabelas, usarSupabase]);

  const resumo = useMemo(() => resumoLotacao(tabelas), [tabelas]);
  const transportadoras = useMemo(() => obterTabelasPorTipo(tabelas, 'TRANSPORTADORA'), [tabelas]);
  const antt = useMemo(() => obterAntt(tabelas), [tabelas]);
  const referenciaMenorPreco = useMemo(() => criarReferenciaMenorPreco(transportadoras), [transportadoras]);
  const ranking = useMemo(() => rankingMelhoresPorRota(transportadoras), [transportadoras]);
  const analiseAnttGeral = useMemo(() => analisarAnttTodasTransportadoras(transportadoras, antt), [transportadoras, antt]);

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


  useEffect(() => {
    if (!tabelaAntigaReajusteId && transportadoras[0]) setTabelaAntigaReajusteId(transportadoras[0].id);
    if (tabelaAntigaReajusteId && !transportadoras.some((item) => item.id === tabelaAntigaReajusteId)) {
      setTabelaAntigaReajusteId(transportadoras[0]?.id || '');
    }
  }, [transportadoras, tabelaAntigaReajusteId]);

  const comparativoMelhorPreco = useMemo(
    () => compararComReferencia(tabelaSelecionada, referenciaMenorPreco),
    [tabelaSelecionada, referenciaMenorPreco]
  );
  const analiseAnttSelecionada = useMemo(
    () => analisarTabelaVersusAntt(tabelaSelecionada, antt),
    [tabelaSelecionada, antt]
  );


  const tabelaAntigaReajuste = useMemo(
    () => transportadoras.find((item) => item.id === tabelaAntigaReajusteId) || transportadoras[0] || null,
    [transportadoras, tabelaAntigaReajusteId]
  );

  const comparativoReajuste = useMemo(() => {
    try {
      return compararTabelaReajuste(tabelaAntigaReajuste, tabelaReajuste, antt);
    } catch (error) {
      return { erro: error.message || String(error), detalhes: [] };
    }
  }, [tabelaAntigaReajuste, tabelaReajuste, antt]);

  const importar = async ({ tipo, file, nome }) => {
    setCarregando(true);
    setFeedback('');
    try {
      const nomePadrao = tipo === 'ANTT' ? 'ANTT' : nome;
      const tabela = await importarTabelaLotacao(file, { tipo, nomePadrao });

      if (usarSupabase) {
        await salvarTabelaLotacaoSupabase(tabela);
        await recarregarDados({ silencioso: true });
        setFonteDados('supabase');
      } else {
        const next = upsertTabelaLotacao(tabelas, tabela);
        setTabelas(next);
        salvarTabelasLotacao(next);
        setFonteDados('local');
      }

      if (tipo === 'TRANSPORTADORA') setSelecionadaId(tabela.id);
      setFeedback(
        `Tabela ${tabela.nome} importada com ${tabela.linhas.length} rotas válidas (${tabela.rotasUnicas || tabela.linhas.length} rotas únicas). ` +
        `Destino dos dados: ${usarSupabase ? 'Supabase' : 'navegador/localStorage'}. ` +
        `Modelo: ${tabela.modelo}. Valor usado: ${tabela.resumoFontesValor || 'não identificado'}. ` +
        `Abas importadas: ${listarAbas(tabela.abasImportadas)}.`
      );
    } catch (error) {
      setFeedback(error.message || 'Erro ao importar tabela de lotação.');
    } finally {
      setCarregando(false);
    }
  };


  const importarReajuste = async ({ file, nome, tabelaAntigaId }) => {
    setCarregando(true);
    setFeedback('');
    try {
      const antiga = transportadoras.find((item) => item.id === tabelaAntigaId) || transportadoras[0];
      const nomePadrao = nome || `${antiga?.nome || 'Tabela'} reajustada`;
      const tabela = await importarTabelaLotacao(file, { tipo: 'TRANSPORTADORA', nomePadrao });
      setTabelaReajuste({
        ...tabela,
        nome: nomePadrao,
        tipo: 'TRANSPORTADORA',
        modelo: 'REAJUSTE TEMPORÁRIO / LOTAÇÃO',
      });
      setTabelaAntigaReajusteId(tabelaAntigaId || antiga?.id || '');
      setFeedback(
        `Tabela de reajuste ${nomePadrao} carregada para comparação temporária com ${antiga?.nome || 'a tabela antiga'}. ` +
        `Foram lidas ${tabela.linhas.length} rotas válidas (${tabela.rotasUnicas || tabela.linhas.length} rotas únicas). ` +
        'Ela não foi salva no Supabase nem substituiu a tabela oficial.'
      );
    } catch (error) {
      setFeedback(error.message || 'Erro ao importar tabela de reajuste.');
    } finally {
      setCarregando(false);
    }
  };

  const remover = async (id) => {
    const tabela = tabelas.find((item) => item.id === id);
    if (!tabela) return;
    const ok = window.confirm(`Deseja excluir a tabela ${tabela.nome}?`);
    if (!ok) return;

    setCarregando(true);
    setFeedback('');
    try {
      if (usarSupabase) {
        await removerTabelaLotacaoSupabase(id);
        await recarregarDados({ silencioso: true });
        setFonteDados('supabase');
      } else {
        const next = removerTabelaLotacao(tabelas, id);
        setTabelas(next);
        salvarTabelasLotacao(next);
        setFonteDados('local');
      }
      setFeedback(`Tabela ${tabela.nome} excluída.`);
    } catch (error) {
      setFeedback(error.message || 'Erro ao excluir tabela de lotação.');
    } finally {
      setCarregando(false);
    }
  };

  const diagnosticar = async () => {
    setCarregando(true);
    setFeedback('');
    try {
      const resposta = await diagnosticarLotacaoSupabase();
      setDiagnostico(resposta);
      if (resposta.ok) {
        setFeedback(`Supabase OK para Lotação. Tabelas: ${resposta.tabelas}. Rotas: ${resposta.rotas}.`);
      } else {
        setFeedback(resposta.erro || 'Supabase não configurado para o módulo de lotação.');
      }
    } catch (error) {
      setDiagnostico({ ok: false, erro: error.message || String(error) });
      setFeedback(error.message || 'Erro ao diagnosticar Supabase de lotação.');
    } finally {
      setCarregando(false);
    }
  };

  const statusDados = fonteDados === 'supabase'
    ? `Supabase${supabaseInfo.host ? ` · ${supabaseInfo.host}` : ''}`
    : fonteDados === 'local-fallback'
      ? 'Backup local do navegador'
      : fonteDados === 'local'
        ? 'Navegador/localStorage'
        : 'Carregando';

  return (
    <div className="page-shell lotacao-page">
      <div className="page-top between start-mobile">
        <div className="page-header">
          <div className="amd-mini-brand">Central de Fretes · Lotação</div>
          <h1>Controle de transportadoras e lotação</h1>
          <p>
            Módulo independente para cadastrar tabelas de transportadoras, comparar o menor preço entre elas e
            acompanhar se os valores estão abaixo, iguais ou acima da referência ANTT.
          </p>
        </div>
        <div className="actions-right gap-row lotacao-actions-top">
          <button type="button" className="btn-secondary" onClick={diagnosticar} disabled={carregando || !usarSupabase}>
            Diagnosticar Supabase
          </button>
          <button type="button" className="btn-secondary" onClick={() => recarregarDados()} disabled={carregando}>
            Atualizar base
          </button>
        </div>
      </div>

      <div className={fonteDados === 'supabase' ? 'sim-alert success' : 'sim-alert info'}>
        <strong>Base de dados:</strong> {statusDados}. {usarSupabase ? 'As tabelas importadas ficam disponíveis no Supabase.' : 'Configure o Supabase para gravar no servidor.'}
        {diagnostico?.ok ? <span> · Diagnóstico: {diagnostico.tabelas} tabelas e {diagnostico.rotas} rotas.</span> : null}
      </div>

      {feedback && <div className="formatacao-alerta">{feedback}</div>}

      <ModelosAceitos />

      <div className="summary-strip lotacao-kpis">
        <div className="summary-card">
          <span>Transportadoras</span>
          <strong>{resumo.totalTransportadoras}</strong>
        </div>
        <div className="summary-card">
          <span>Rotas mercado</span>
          <strong>{resumo.totalRotasTransportadoras}</strong>
          <small>{resumo.rotasMelhorPreco || 0} únicas</small>
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

      <div className="feature-grid import-grid">
        <UploadCard
          tipo="ANTT"
          titulo="Subir tabela ANTT"
          descricao="Use o modelo ANTT BASE enviado. O valor de comparação será a coluna Frete ANTT Oficial. Subir novamente substitui a versão anterior."
          onImportar={importar}
          carregando={carregando}
        />
        <UploadCard
          tipo="TRANSPORTADORA"
          titulo="Cadastrar transportadora"
          descricao="Use o modelo de transportadora baseado no TARGET enviado. A coluna TARGET será o valor da tabela da transportadora."
          nomeObrigatorio
          onImportar={importar}
          carregando={carregando}
        />
      </div>


      <ComparativoReajusteLotacao
        transportadoras={transportadoras}
        carregando={carregando}
        tabelaAntigaId={tabelaAntigaReajusteId}
        onTabelaAntigaChange={setTabelaAntigaReajusteId}
        onImportar={importarReajuste}
        tabelaReajuste={tabelaReajuste}
        onLimpar={() => {
          setTabelaReajuste(null);
          setFeedback('Comparativo de reajuste limpo. Nenhuma tabela oficial foi alterada.');
        }}
        comparativo={comparativoReajuste}
      />

      <PainelTransportadora
        tabela={tabelaSelecionada}
        transportadoras={transportadoras}
        selecionadaId={tabelaSelecionada?.id || ''}
        setSelecionadaId={setSelecionadaId}
        resumoRealizado={resumoRealizado}
        comparativo={comparativoMelhorPreco}
        analiseAntt={analiseAnttSelecionada}
        periodo={periodoAnalise}
        setPeriodo={setPeriodoAnalise}
      />

      <PesquisaRotas tabelas={tabelas} />

      <ListaTabelas tabelas={tabelas} onRemover={remover} />

      <div className="hint-box">
        Regra usada: comparação por Origem + UF Origem + Destino + UF Destino + Tipo de veículo. O Target é dinâmico:
        sempre o menor preço entre as transportadoras cadastradas. A ANTT é referência paralela para identificar
        valores abaixo, iguais ou acima da tabela oficial. Quando o Supabase estiver configurado e o script SQL aplicado,
        as tabelas ficam salvas no servidor e não apenas no navegador.
      </div>
    </div>
  );
}
