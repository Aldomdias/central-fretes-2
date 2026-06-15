import React, { useMemo, useState } from 'react';
import TabelasNegociacaoPage from './TabelasNegociacaoPage';
import {
  TIPOS_NEGOCIACAO,
  atualizarTabelaNegociacao,
  listarTabelasNegociacaoEditor,
} from '../services/tabelasNegociacaoService';

const CANAIS = ['ATACADO', 'B2C', 'INTERCOMPANY', 'REVERSA', 'LOTACAO'];
const UFS = ['', 'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

function texto(v) { return String(v ?? '').trim(); }
function upper(v) { return texto(v).toUpperCase(); }

function tipoNegociacao(t = {}) {
  const tipo = upper(t.tipo_negociacao || t.tipoNegociacao);
  if (tipo) return tipo;
  if (upper(t.tipo_tabela) === 'LOTACAO') return 'TABELA_LOTACAO';
  return 'NOVA_TABELA';
}

function ajustarPorTipo(base, tipoInformado) {
  const tipo = upper(tipoInformado || base.tipo_negociacao) || 'NOVA_TABELA';
  const next = { ...base, tipo_negociacao: tipo };

  if (tipo === 'TABELA_LOTACAO') {
    next.tipo_tabela = 'LOTACAO';
    next.canal = 'LOTACAO';
    next.comparar_com_proprio_realizado = false;
    next.transportadora_base_nome = next.transportadora_base_nome || next.transportadora || '';
    return next;
  }

  next.tipo_tabela = 'FRACIONADO';
  if (next.canal === 'LOTACAO') next.canal = 'ATACADO';

  if (tipo === 'REAJUSTE_TABELA_EXISTENTE') {
    next.comparar_com_proprio_realizado = true;
    next.transportadora_base_nome = next.transportadora_base_nome || next.transportadora || '';
  } else {
    next.comparar_com_proprio_realizado = false;
    next.transportadora_base_nome = '';
    next.tabela_base_id = '';
    next.periodo_realizado_inicio = '';
    next.periodo_realizado_fim = '';
    next.tipo_veiculo = '';
  }

  return next;
}

function formFromTabela(t = {}) {
  return ajustarPorTipo({
    transportadora: t.transportadora || '',
    tipo_negociacao: tipoNegociacao(t),
    canal: t.canal || 'ATACADO',
    tipo_tabela: t.tipo_tabela || 'FRACIONADO',
    transportadora_base_nome: t.transportadora_base_nome || '',
    tabela_base_id: t.tabela_base_id || '',
    comparar_com_proprio_realizado: Boolean(t.comparar_com_proprio_realizado),
    periodo_realizado_inicio: t.periodo_realizado_inicio || '',
    periodo_realizado_fim: t.periodo_realizado_fim || '',
    origem: t.origem || '',
    uf_origem: t.uf_origem || '',
    uf_destino: t.uf_destino || '',
    tipo_veiculo: t.tipo_veiculo || '',
    modalidade: t.modalidade || '',
    descricao: t.descricao || '',
    regiao: t.regiao || '',
    observacao: t.observacao || '',
    data_inicio_prevista: t.data_inicio_prevista || '',
    incluir_simulacao: Boolean(t.incluir_simulacao),
  }, tipoNegociacao(t));
}

export default function TabelasNegociacaoPageWithEditor() {
  const [tabelas, setTabelas] = useState([]);
  const [busca, setBusca] = useState('');
  const [id, setId] = useState('');
  const [form, setForm] = useState(formFromTabela({}));
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [carregandoLista, setCarregandoLista] = useState(false);
  const [listaCarregada, setListaCarregada] = useState(false);

  async function carregar() {
    setErro('');
    setCarregandoLista(true);
    try {
      const lista = await listarTabelasNegociacaoEditor();
      setTabelas(lista || []);
      setListaCarregada(true);
    } catch (e) {
      setErro(e.message || 'Erro ao carregar negociações.');
    } finally {
      setCarregandoLista(false);
    }
  }

  function abrirEditor() {
    setAberto(true);
    if (!listaCarregada && !carregandoLista) {
      carregar();
    }
  }

  const tabelaSelecionada = useMemo(() => tabelas.find((t) => t.id === id) || null, [tabelas, id]);

  const listaFiltrada = useMemo(() => {
    const termo = upper(busca);
    return tabelas
      .filter((t) => !termo || [t.transportadora, t.descricao, t.origem, t.uf_origem, t.uf_destino, t.tipo_negociacao, t.tipo_tabela, t.canal].some((v) => upper(v).includes(termo)))
      .slice(0, 100);
  }, [tabelas, busca]);

  function selecionar(novoId) {
    setId(novoId);
    setErro('');
    setSucesso('');
    const tabela = tabelas.find((t) => t.id === novoId);
    setForm(formFromTabela(tabela || {}));
  }

  function alterar(campo, valor) {
    setForm((p) => ({ ...p, [campo]: valor }));
  }

  function alterarTipo(tipo) {
    setForm((p) => ajustarPorTipo(p, tipo));
  }

  async function salvar() {
    if (!id) return setErro('Selecione uma negociação para editar.');
    if (!texto(form.transportadora)) return setErro('Informe a transportadora.');
    if (form.tipo_negociacao === 'REAJUSTE_TABELA_EXISTENTE' && !texto(form.transportadora_base_nome)) {
      return setErro('Para reajuste, informe a transportadora base atual.');
    }

    setSalvando(true);
    setErro('');
    setSucesso('');
    try {
      const payload = ajustarPorTipo(form, form.tipo_negociacao);
      const atualizada = await atualizarTabelaNegociacao(id, payload);
      setTabelas((prev) => prev.map((t) => (t.id === atualizada.id ? atualizada : t)));
      setForm(formFromTabela(atualizada));
      setSucesso('Negociação atualizada com sucesso. Histórico, itens e laudos foram preservados.');
    } catch (e) {
      setErro(e.message || 'Erro ao salvar alteração da negociação.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <section className="sim-card" style={{ marginBottom: 18, border: '2px solid #bfdbfe' }}>
        <div className="sim-resultado-topo compact-top">
          <div>
            <div className="simulador-subtitulo">Correção rápida</div>
            <h2 style={{ margin: 0 }}>Editar tipo da negociação</h2>
            <p style={{ margin: '6px 0 0', color: '#64748b' }}>Corrige uma negociação criada como nova, reajuste ou lotação sem apagar itens, laudos ou histórico.</p>
          </div>
          <div className="sim-actions" style={{ justifyContent: 'flex-end' }}>
            <button className="sim-tab" type="button" onClick={() => (aberto ? setAberto(false) : abrirEditor())}>{aberto ? 'Recolher' : 'Abrir'}</button>
            <button className="sim-tab" type="button" onClick={carregar} disabled={carregandoLista}>{carregandoLista ? 'Carregando...' : 'Atualizar lista'}</button>
          </div>
        </div>

        {erro ? <div className="sim-alert error" style={{ marginTop: 12 }}>{erro}</div> : null}
        {sucesso ? <div className="sim-alert success" style={{ marginTop: 12 }}>{sucesso}</div> : null}

        {aberto ? (
          <div style={{ marginTop: 14 }}>
            {!listaCarregada && !carregandoLista ? (
              <div className="sim-alert info">Lista ainda não carregada. Clique em <strong>Atualizar lista</strong> para buscar negociações (consulta leve).</div>
            ) : null}
            <div className="sim-form-grid sim-grid-3">
              <label>Buscar
                <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Transportadora, origem, tipo..." />
              </label>
              <label>Negociação
                <select value={id} onChange={(e) => selecionar(e.target.value)}>
                  <option value="">Selecione...</option>
                  {listaFiltrada.map((t) => <option key={t.id} value={t.id}>{t.transportadora} · {tipoNegociacao(t)} · {t.origem || t.uf_origem || 'Todas origens'}</option>)}
                </select>
              </label>
              <label>Selecionada
                <input value={tabelaSelecionada ? `${tabelaSelecionada.status || '-'} · ${tipoNegociacao(tabelaSelecionada)}` : '-'} disabled />
              </label>
            </div>

            {tabelaSelecionada ? (
              <>
                <div className="sim-form-grid sim-grid-5" style={{ marginTop: 12 }}>
                  <label>Transportadora
                    <input value={form.transportadora} onChange={(e) => alterar('transportadora', e.target.value)} />
                  </label>
                  <label>Tipo negociação
                    <select value={form.tipo_negociacao} onChange={(e) => alterarTipo(e.target.value)}>
                      {TIPOS_NEGOCIACAO.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </label>
                  <label>Canal
                    <select value={form.canal} disabled={form.tipo_negociacao === 'TABELA_LOTACAO'} onChange={(e) => alterar('canal', e.target.value)}>
                      {CANAIS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label>Tipo tabela
                    <input value={form.tipo_tabela} disabled />
                  </label>
                  <label className="sim-flag" style={{ justifyContent: 'end' }}>
                    <input type="checkbox" checked={form.incluir_simulacao} onChange={(e) => alterar('incluir_simulacao', e.target.checked)} />
                    Incluir simulação
                  </label>
                </div>

                {form.tipo_negociacao === 'REAJUSTE_TABELA_EXISTENTE' ? (
                  <div className="sim-form-grid sim-grid-5" style={{ marginTop: 12 }}>
                    <label>Transportadora base
                      <input value={form.transportadora_base_nome} onChange={(e) => alterar('transportadora_base_nome', e.target.value)} placeholder="Ex: Panservice" />
                    </label>
                    <label>Tabela atual
                      <input value={form.tabela_base_id} onChange={(e) => alterar('tabela_base_id', e.target.value)} />
                    </label>
                    <label>Realizado início
                      <input type="date" value={form.periodo_realizado_inicio || ''} onChange={(e) => alterar('periodo_realizado_inicio', e.target.value)} />
                    </label>
                    <label>Realizado fim
                      <input type="date" value={form.periodo_realizado_fim || ''} onChange={(e) => alterar('periodo_realizado_fim', e.target.value)} />
                    </label>
                    <label className="sim-flag" style={{ justifyContent: 'end' }}>
                      <input type="checkbox" checked={form.comparar_com_proprio_realizado} onChange={(e) => alterar('comparar_com_proprio_realizado', e.target.checked)} />
                      Próprio realizado
                    </label>
                  </div>
                ) : null}

                {form.tipo_negociacao === 'TABELA_LOTACAO' ? (
                  <div className="sim-form-grid sim-grid-4" style={{ marginTop: 12 }}>
                    <label>Tipo veículo
                      <input value={form.tipo_veiculo} onChange={(e) => alterar('tipo_veiculo', e.target.value)} />
                    </label>
                    <label>Realizado início
                      <input type="date" value={form.periodo_realizado_inicio || ''} onChange={(e) => alterar('periodo_realizado_inicio', e.target.value)} />
                    </label>
                    <label>Realizado fim
                      <input type="date" value={form.periodo_realizado_fim || ''} onChange={(e) => alterar('periodo_realizado_fim', e.target.value)} />
                    </label>
                    <label>Modalidade
                      <input value={form.modalidade} onChange={(e) => alterar('modalidade', e.target.value)} />
                    </label>
                  </div>
                ) : null}

                <div className="sim-form-grid sim-grid-5" style={{ marginTop: 12 }}>
                  <label>Origem
                    <input value={form.origem} onChange={(e) => alterar('origem', e.target.value)} />
                  </label>
                  <label>UF origem
                    <select value={form.uf_origem} onChange={(e) => alterar('uf_origem', e.target.value)}>{UFS.map((uf) => <option key={uf || 't'} value={uf}>{uf || 'Todas'}</option>)}</select>
                  </label>
                  <label>UF destino
                    <select value={form.uf_destino} onChange={(e) => alterar('uf_destino', e.target.value)}>{UFS.map((uf) => <option key={uf || 't'} value={uf}>{uf || 'Todas'}</option>)}</select>
                  </label>
                  <label>Início previsto
                    <input type="date" value={form.data_inicio_prevista || ''} onChange={(e) => alterar('data_inicio_prevista', e.target.value)} />
                  </label>
                  <label>Região
                    <input value={form.regiao} onChange={(e) => alterar('regiao', e.target.value)} />
                  </label>
                </div>

                <div className="sim-form-grid sim-grid-2" style={{ marginTop: 12 }}>
                  <label>Descrição
                    <input value={form.descricao} onChange={(e) => alterar('descricao', e.target.value)} />
                  </label>
                  <label>Observação
                    <input value={form.observacao} onChange={(e) => alterar('observacao', e.target.value)} />
                  </label>
                </div>

                <div className="sim-actions" style={{ marginTop: 14 }}>
                  <button className="primary" type="button" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar alteração'}</button>
                  <button className="sim-tab" type="button" onClick={() => selecionar(id)} disabled={salvando}>Desfazer não salvo</button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </section>

      <TabelasNegociacaoPage />
    </>
  );
}
