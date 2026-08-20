import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  STATUS_OPERACIONAL,
  VALOR_FONTES,
  diffAlocacao,
  labelStatusOperacional,
  montarAlocacaoPorTabela,
  montarPainelAlocacao,
  rankingTransportadorasParaCarga,
} from '../utils/lotacaoAlocacao';
import { formatarMoeda } from '../utils/lotacaoTables';
import {
  carregarEventosCargaSupabase,
  salvarAlocacaoCargaSupabase,
} from '../services/lotacaoSupabaseService';

function hojeIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatarDataHora(valor) {
  if (!valor) return '-';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '-';
  return data.toLocaleString('pt-BR');
}

function PendenciaTags({ pendencias = [] }) {
  if (!pendencias.length) return <span className="status-pill ok">OK</span>;
  return (
    <div className="gap-row" style={{ flexWrap: 'wrap', gap: 4 }}>
      {pendencias.map((item) => (
        <span key={item.id} className={item.grave ? 'status-pill danger' : 'status-pill warn'}>
          {item.label}
        </span>
      ))}
    </div>
  );
}

function RankingTabelas({ ranking, onEscolher, salvando }) {
  if (!ranking.length) {
    return (
      <div className="hint-box compact">
        Nenhuma tabela cadastrada cobre esta rota e tipo de veículo. Registre o valor manualmente
        abaixo — na Fase 2 este caso vira uma cotação com propostas concorrentes.
      </div>
    );
  }

  return (
    <table className="data-table compact">
      <thead>
        <tr>
          <th>#</th>
          <th>Transportadora</th>
          <th>Tabela</th>
          <th>Valor</th>
          <th>Target</th>
          <th>Prazo</th>
          <th>vs. melhor</th>
          <th>Alertas</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {ranking.map((opcao) => (
          <tr key={`${opcao.tabelaId}-${opcao.rotaId}`}>
            <td>{opcao.posicao}</td>
            <td><strong>{opcao.transportadora}</strong></td>
            <td>{opcao.tabelaNome}</td>
            <td>{formatarMoeda(opcao.valor)}</td>
            <td>{opcao.target === null ? '-' : formatarMoeda(opcao.target)}</td>
            <td>{opcao.prazo || '-'}</td>
            <td>{opcao.melhorPreco ? '—' : `+ ${formatarMoeda(opcao.diferencaMelhor)}`}</td>
            <td>
              {opcao.acimaTarget && <span className="status-pill danger">Acima do target</span>}
              {opcao.abaixoAntt && <span className="status-pill danger">Abaixo do ANTT</span>}
              {!opcao.acimaTarget && !opcao.abaixoAntt && <span className="status-pill ok">-</span>}
            </td>
            <td>
              <button type="button" className="btn-primary" disabled={salvando} onClick={() => onEscolher(opcao)}>
                Alocar
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PainelAlocacao({ carga, tabelas, usuario, onSalvo, onFechar }) {
  const [form, setForm] = useState({
    statusOperacional: '',
    transportadora: '',
    placaCavalo: '',
    placaCarreta: '',
    valorComparacao: '',
    valorFonte: '',
    observacaoAlocacao: '',
  });
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState(null);
  const [trilha, setTrilha] = useState([]);

  useEffect(() => {
    setMensagem(null);
    setForm({
      statusOperacional: carga.statusOperacional || 'PLANEJADA',
      transportadora: carga.transportadora || '',
      placaCavalo: carga.placaCavalo || '',
      placaCarreta: carga.placaCarreta || '',
      valorComparacao: carga.valorAutorizado ? String(carga.valorAutorizado) : '',
      valorFonte: carga.valorFonte || '',
      observacaoAlocacao: carga.observacaoAlocacao || '',
    });
    carregarEventosCargaSupabase(carga.id).then(setTrilha).catch(() => setTrilha([]));
  }, [carga]);

  const ranking = useMemo(() => rankingTransportadorasParaCarga(tabelas, carga), [tabelas, carga]);

  const gravar = useCallback(async (alteracoes, motivo) => {
    setSalvando(true);
    setMensagem(null);
    try {
      const eventos = diffAlocacao(carga, alteracoes);
      await salvarAlocacaoCargaSupabase(carga.id, { ...alteracoes, dist: carga.dist }, {
        usuario: { id: usuario?.id, nome: usuario?.nome },
        motivo,
        eventos,
      });
      setMensagem({ tipo: 'ok', texto: `Alocação salva. ${eventos.length} alteração(ões) registrada(s) na trilha.` });
      const atualizada = await carregarEventosCargaSupabase(carga.id).catch(() => []);
      setTrilha(atualizada);
      onSalvo({ ...carga, ...alteracoes });
    } catch (erro) {
      setMensagem({ tipo: 'erro', texto: erro.message });
    } finally {
      setSalvando(false);
    }
  }, [carga, usuario, onSalvo]);

  const escolherTabela = (opcao) => {
    const alocacao = montarAlocacaoPorTabela(opcao, {
      usuario: usuario?.nome || '',
      observacao: form.observacaoAlocacao,
    });
    gravar(alocacao, `Alocada pela tabela ${opcao.tabelaNome} (posição ${opcao.posicao} do ranking)`);
  };

  const salvarManual = () => {
    const valor = Number(String(form.valorComparacao).replace(',', '.'));
    if (form.transportadora && !Number.isFinite(valor)) {
      setMensagem({ tipo: 'erro', texto: 'Informe um valor autorizado numérico.' });
      return;
    }
    if (form.transportadora && Number.isFinite(valor) && valor > 0 && !form.valorFonte) {
      setMensagem({ tipo: 'erro', texto: 'Informe a origem do valor (tabela, cotação ou manual) — é o que a auditoria vai cobrar.' });
      return;
    }
    gravar({
      statusOperacional: form.statusOperacional,
      transportadora: form.transportadora,
      placaCavalo: form.placaCavalo,
      placaCarreta: form.placaCarreta,
      valorComparacao: Number.isFinite(valor) ? valor : null,
      valorFonte: form.valorFonte,
      observacaoAlocacao: form.observacaoAlocacao,
      alocadoEm: new Date().toISOString(),
      alocadoPor: usuario?.nome || '',
    }, 'Edição manual da alocação');
  };

  const atualizar = (campo, valor) => setForm((prev) => ({ ...prev, [campo]: valor }));

  return (
    <div className="table-card lotacao-table-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">DIST {carga.dist || '(sem DIST)'} — {carga.origem} → {carga.destino}</div>
          <p className="compact">
            {carga.tipoVeiculo || 'Tipo de veículo não informado'} · Coleta {carga.diaColeta || 'sem data'} ·
            Status {labelStatusOperacional(carga.statusOperacional)}
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={onFechar}>Fechar</button>
      </div>

      {mensagem && <div className={mensagem.tipo === 'erro' ? 'error-box' : 'hint-box compact'}>{mensagem.texto}</div>}

      <div className="panel-title top-space-sm">Transportadoras com tabela para esta rota</div>
      <RankingTabelas ranking={ranking} onEscolher={escolherTabela} salvando={salvando} />

      <div className="panel-title top-space-sm">Alocação</div>
      <div className="gap-row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <label>
          Status
          <select value={form.statusOperacional} onChange={(e) => atualizar('statusOperacional', e.target.value)}>
            {STATUS_OPERACIONAL.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
        <label>
          Transportadora
          <input value={form.transportadora} onChange={(e) => atualizar('transportadora', e.target.value)} />
        </label>
        <label>
          Placa cavalo
          <input value={form.placaCavalo} onChange={(e) => atualizar('placaCavalo', e.target.value.toUpperCase())} />
        </label>
        <label>
          Placa carreta
          <input value={form.placaCarreta} onChange={(e) => atualizar('placaCarreta', e.target.value.toUpperCase())} />
        </label>
        <label>
          Valor autorizado
          <input value={form.valorComparacao} onChange={(e) => atualizar('valorComparacao', e.target.value)} />
        </label>
        <label>
          Origem do valor
          <select value={form.valorFonte} onChange={(e) => atualizar('valorFonte', e.target.value)}>
            <option value="">Selecione</option>
            {VALOR_FONTES.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="top-space-sm" style={{ display: 'block' }}>
        Observação
        <input
          style={{ width: '100%' }}
          value={form.observacaoAlocacao}
          onChange={(e) => atualizar('observacaoAlocacao', e.target.value)}
          placeholder="Ex.: transportadora do ranking recusou a carga"
        />
      </label>
      <div className="gap-row top-space-sm">
        <button type="button" className="btn-primary" disabled={salvando} onClick={salvarManual}>
          {salvando ? 'Salvando...' : 'Salvar alocação'}
        </button>
      </div>

      <div className="panel-title top-space-sm">Trilha de alterações</div>
      {!trilha.length && <p className="compact">Nenhuma alteração registrada nesta carga ainda.</p>}
      {trilha.length > 0 && (
        <table className="data-table compact">
          <thead>
            <tr>
              <th>Quando</th>
              <th>Quem</th>
              <th>Campo</th>
              <th>De</th>
              <th>Para</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {trilha.map((evento) => (
              <tr key={evento.id}>
                <td>{formatarDataHora(evento.criadoEm)}</td>
                <td>{evento.usuarioNome || '-'}</td>
                <td>{evento.campo}</td>
                <td>{evento.valorAnterior || '-'}</td>
                <td>{evento.valorNovo || '-'}</td>
                <td>{evento.motivo || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function AlocacaoDiariaLotacao({ cargas = [], tabelas = [], usuario = null, onCargaAtualizada }) {
  const [filtros, setFiltros] = useState({ data: hojeIso(), status: '', origem: '', busca: '' });
  const [cargaSelecionadaId, setCargaSelecionadaId] = useState('');

  const painel = useMemo(() => montarPainelAlocacao(cargas, filtros), [cargas, filtros]);
  const cargaSelecionada = useMemo(
    () => painel.cargas.find((item) => item.id === cargaSelecionadaId) || null,
    [painel.cargas, cargaSelecionadaId],
  );

  const atualizar = (campo, valor) => setFiltros((prev) => ({ ...prev, [campo]: valor }));

  return (
    <>
      <div className="table-card lotacao-table-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Alocação diária</div>
            <p className="compact">
              Cargas do dia com o que falta para rodar: transportadora, placa e valor com origem rastreável.
              Pendências graves aparecem primeiro.
            </p>
          </div>
          <span className="status-pill dark">{painel.total} carga(s)</span>
        </div>

        <div className="gap-row" style={{ flexWrap: 'wrap', gap: 12 }}>
          <label>
            Dia da coleta
            <input type="date" value={filtros.data} onChange={(e) => atualizar('data', e.target.value)} />
          </label>
          <label>
            Status
            <select value={filtros.status} onChange={(e) => atualizar('status', e.target.value)}>
              <option value="">Todos</option>
              {STATUS_OPERACIONAL.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <label>
            Origem
            <input value={filtros.origem} onChange={(e) => atualizar('origem', e.target.value)} />
          </label>
          <label>
            Busca (DIST, destino, placa)
            <input value={filtros.busca} onChange={(e) => atualizar('busca', e.target.value)} />
          </label>
          <button type="button" className="btn-secondary" onClick={() => setFiltros({ data: '', status: '', origem: '', busca: '' })}>
            Limpar filtros
          </button>
        </div>

        <div className="gap-row top-space-sm" style={{ flexWrap: 'wrap', gap: 6 }}>
          {painel.porStatus.map((item) => (
            <span key={item.id} className="status-pill dark">{item.label}: {item.total}</span>
          ))}
          <span className={painel.comPendenciaGrave ? 'status-pill danger' : 'status-pill ok'}>
            Pendências graves: {painel.comPendenciaGrave}
          </span>
        </div>

        {!painel.total && (
          <div className="hint-box compact top-space-sm">
            Nenhuma carga para este filtro. Se você acabou de importar o fluxo, confira a data de coleta planejada.
          </div>
        )}

        {painel.total > 0 && (
          <table className="data-table compact top-space-sm">
            <thead>
              <tr>
                <th>DIST</th>
                <th>Rota</th>
                <th>Veículo</th>
                <th>Status</th>
                <th>Transportadora</th>
                <th>Placa</th>
                <th>Valor</th>
                <th>Origem valor</th>
                <th>Pendências</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {painel.cargas.map((carga) => (
                <tr key={carga.id} className={carga.id === cargaSelecionadaId ? 'row-selected' : ''}>
                  <td>{carga.dist || '-'}</td>
                  <td>{carga.origem} → {carga.destino}</td>
                  <td>{carga.tipoVeiculo || '-'}</td>
                  <td>{carga.statusLabel}</td>
                  <td>{carga.transportadora || '-'}</td>
                  <td>{carga.placaCavalo || '-'}</td>
                  <td>{carga.valorAutorizado > 0 ? formatarMoeda(carga.valorAutorizado) : '-'}</td>
                  <td>{carga.valorFonte || '-'}</td>
                  <td><PendenciaTags pendencias={carga.pendencias} /></td>
                  <td>
                    <button type="button" className="btn-secondary" onClick={() => setCargaSelecionadaId(carga.id)}>
                      Alocar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {cargaSelecionada && (
        <PainelAlocacao
          carga={cargaSelecionada}
          tabelas={tabelas}
          usuario={usuario}
          onSalvo={onCargaAtualizada}
          onFechar={() => setCargaSelecionadaId('')}
        />
      )}
    </>
  );
}
