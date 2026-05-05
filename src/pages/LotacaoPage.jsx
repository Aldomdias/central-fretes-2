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


function classeReajuste(status) {
  if (status === 'Aumentou') return 'negativo';
  if (status === 'Reduziu') return 'positivo';
  return '';
}

function ComparativoReajusteLotacao({ transportadoras, carregando, tabelaAntigaId, onTabelaAntigaChange, onImportar, tabelaReajuste, onLimpar, comparativo }) {
  const [nomeReajuste, setNomeReajuste] = useState('');
  const [arquivo, setArquivo] = useState(null);

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
            Suba uma tabela nova de reajuste para comparar contra a tabela antiga cadastrada, sem substituir a tabela oficial.
            O percentual é calculado rota a rota pela mesma chave da Lotação.
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
          <select value={tabelaAntigaId} onChange={(event) => onTabelaAntigaChange(event.target.value)} disabled={!transportadoras.length}>
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
        {comparativo && (
          <button
            type="button"
            className="btn-secondary"
            disabled={carregando || !comparativo.detalhes?.length}
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

      {!comparativo && (
        <div className="hint-box compact">
          Use o mesmo modelo de transportadora. A coluna TARGET será lida como valor reajustado. Se a ANTT/NTT estiver cadastrada, o relatório também mostra a comparação da tabela antiga e da reajustada contra a referência.
        </div>
      )}

      {comparativo && (
        <>
          <div className="summary-strip lotacao-summary-mini top-space-sm">
            <div className="summary-card">
              <span>Rotas comparadas</span>
              <strong>{comparativo.comparadas}</strong>
              <small>{formatarPercentual(comparativo.coberturaAntiga)} da antiga</small>
            </div>
            <div className="summary-card">
              <span>Aumento ponderado</span>
              <strong className={comparativo.variacaoPonderada > 0 ? 'negativo' : comparativo.variacaoPonderada < 0 ? 'positivo' : ''}>
                {formatarPercentual(comparativo.variacaoPonderada)}
              </strong>
              <small>Diferença / valor antigo</small>
            </div>
            <div className="summary-card">
              <span>Diferença total</span>
              <strong className={comparativo.diferencaTotal > 0 ? 'negativo' : comparativo.diferencaTotal < 0 ? 'positivo' : ''}>
                {formatarMoeda(comparativo.diferencaTotal)}
              </strong>
              <small>{formatarMoeda(comparativo.somaValorAntigo)} → {formatarMoeda(comparativo.somaValorNovo)}</small>
            </div>
            <div className="summary-card">
              <span>Reajuste x NTT</span>
              <strong className={comparativo.diferencaTotalReajusteAntt > 0 ? 'positivo' : comparativo.diferencaTotalReajusteAntt < 0 ? 'negativo' : ''}>
                {comparativo.comparadasAntt ? formatarPercentual(comparativo.variacaoMediaReajusteAntt) : '-'}
              </strong>
              <small>{comparativo.comparadasAntt ? `${comparativo.reajusteAcimaAntt} acima · ${comparativo.reajusteAbaixoAntt} abaixo` : 'Suba a ANTT/NTT'}</small>
            </div>
            <div className="summary-card">
              <span>Rotas com aumento</span>
              <strong>{comparativo.aumentou}</strong>
              <small>{comparativo.reduziu} reduziram · {comparativo.manteve} iguais</small>
            </div>
          </div>

          <div className="sim-analise-resumo top-space-sm">
            <div>
              <span>Tabela antiga</span>
              <strong>{comparativo.tabelaAntigaNome}</strong>
            </div>
            <div>
              <span>Tabela reajustada</span>
              <strong>{comparativo.tabelaReajusteNome}</strong>
            </div>
            <div>
              <span>Variação média simples</span>
              <strong>{formatarPercentual(comparativo.variacaoMedia)}</strong>
            </div>
            <div>
              <span>Rotas com NTT</span>
              <strong>{comparativo.comparadasAntt || 0}</strong>
            </div>
            <div>
              <span>Sem paridade de rota</span>
              <strong>{comparativo.rotasNovas} novas · {comparativo.rotasSemReajuste} sem reajuste</strong>
            </div>
          </div>

          {!comparativo.comparadasAntt && (
            <div className="hint-box compact top-space-sm">
              A coluna NTT só será preenchida quando existir uma tabela ANTT/NTT cadastrada no módulo de Lotação com a mesma chave da rota.
            </div>
          )}

          <div className="section-row compact-top top-space-sm">
            <div>
              <div className="panel-title small-title">Percentual de aumento por rota</div>
              <p className="compact">Mostrando as maiores variações primeiro. Valores negativos indicam redução.</p>
            </div>
            <span className="status-pill dark">{comparativo.detalhes.length} linhas</span>
          </div>

          <div className="sim-analise-tabela-wrap">
            <table className="sim-analise-tabela">
              <thead>
                <tr>
                  <th>Origem</th>
                  <th>Destino</th>
                  <th>Tipo</th>
                  <th>KM</th>
                  <th>Valor antigo</th>
                  <th>NTT</th>
                  <th>Valor reajuste</th>
                  <th>Diferença</th>
                  <th>% aumento</th>
                  <th>Antigo x NTT</th>
                  <th>Reajuste x NTT</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {comparativo.detalhes.map((item) => (
                  <tr key={item.id}>
                    <td>{item.origem}/{item.ufOrigem}</td>
                    <td>{item.destino}/{item.ufDestino}</td>
                    <td>{item.tipo}</td>
                    <td>{item.km || '-'}</td>
                    <td>{formatarMoeda(item.valorAntigo)}</td>
                    <td>{formatarMoeda(item.valorAntt)}</td>
                    <td>{formatarMoeda(item.valorNovo)}</td>
                    <td className={classeReajuste(item.status)}>{formatarMoeda(item.diferenca)}</td>
                    <td className={classeReajuste(item.status)}><strong>{formatarPercentual(item.variacao)}</strong></td>
                    <td className={classeAntt(item.statusAntigoAntt)}>{item.valorAntt === null || item.valorAntt === undefined ? '-' : formatarPercentual(item.variacaoAntigoAntt)}</td>
                    <td className={classeAntt(item.statusNovoAntt)}>{item.valorAntt === null || item.valorAntt === undefined ? '-' : formatarPercentual(item.variacaoNovoAntt)}</td>
                    <td><span className="status-pill">{item.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(comparativo.detalhesRotasNovas.length > 0 || comparativo.detalhesRotasSemReajuste.length > 0) && (
            <div className="hint-box compact top-space-sm">
              Atenção: {comparativo.rotasNovas} rota(s) existem apenas na tabela reajustada e {comparativo.rotasSemReajuste} rota(s) da antiga não vieram na reajustada.
              Essas rotas não entram no percentual de aumento, porque não têm par correspondente para comparação.
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
  const comparativoReajuste = useMemo(
    () => compararTabelaReajuste(tabelaAntigaReajuste, tabelaReajuste, antt),
    [tabelaAntigaReajuste, tabelaReajuste, antt]
  );

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
        tipo: 'REAJUSTE_TEMPORARIO',
        modelo: 'REAJUSTE TEMPORÁRIO / LOTAÇÃO',
      });
      setTabelaAntigaReajusteId(tabelaAntigaId || antiga?.id || '');
      setFeedback(
        `Tabela de reajuste ${nomePadrao} carregada para comparação temporária com ${antiga?.nome || 'a tabela antiga'}. ` +
        `Foram lidas ${tabela.linhas.length} rotas válidas (${tabela.rotasUnicas || tabela.linhas.length} rotas únicas). ` +
        'Ela não foi salva no Supabase nem substituiu a tabela oficial. Se a ANTT/NTT estiver cadastrada, a visão também trará o comparativo contra a referência.'
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

      <RankingMelhores ranking={ranking} />

      <ResumoAntt titulo="Análise geral versus ANTT" analise={analiseAnttGeral} />
      <ResumoAnttPorTransportadora analise={analiseAnttGeral} />

      <div className="panel-card">
        <div className="section-row">
          <div>
            <div className="panel-title">Comparativo automático da transportadora</div>
            <p>Escolha uma transportadora para ver se ela é a melhor opção nas rotas e como fica versus ANTT.</p>
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
        <ResumoMelhorPreco comparativo={comparativoMelhorPreco} />
        <ResumoAntt titulo="Transportadora selecionada versus ANTT" analise={analiseAnttSelecionada} />
      </div>

      <div className="feature-grid import-grid">
        <TabelaDetalhesMelhorPreco comparativo={comparativoMelhorPreco} />
        <TabelaDetalhesAntt titulo="Maiores diferenças da selecionada versus ANTT" analise={analiseAnttSelecionada} />
      </div>

      <TabelaDetalhesAntt titulo="Maiores diferenças gerais versus ANTT" analise={analiseAnttGeral} />

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
