import React, { useEffect, useMemo, useState } from 'react';
import { carregarPainelPendencias } from '../services/auditoriaCteJornadaService';

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function divergenciaDoCte(row) {
  return Math.abs(Number(row.diferenca ?? ((Number(row.valor_cte || 0)) - (Number(row.valor_calculado || 0)))));
}

/** Cards derivados dos CT-es carregados na tela (não da tabela de jornada):
 * é o trabalho que ainda precisa ser feito na competência aberta. */
const CARDS_CARGA = [
  { chave: 'semCalculoAmd', label: 'Sem cálculo AMD', icone: '🚫', alerta: true, ajuda: 'CT-es que o motor AMD não conseguiu calcular — precisam de tabela/cadastro antes de auditar.' },
  { chave: 'aAuditar', label: 'A auditar', icone: '📋', ajuda: 'Calculados pelo AMD e ainda sem nenhuma decisão registrada na jornada.' },
  { chave: 'divergentesAbertos', label: 'Divergentes em aberto', icone: '⚠️', alerta: true, ajuda: 'Calculados, fora da tolerância e ainda sem tratativa registrada.' },
];

/** Cards do fluxo de tratativa — esses vêm da tabela de jornada. */
const CARDS_JORNADA = [
  { chave: 'naoAuditados', label: 'Não auditados', icone: '📄', ajuda: 'CT-es que já entraram na jornada mas seguem sem decisão registrada.' },
  { chave: 'auditadosOk', label: 'Auditados OK', icone: '✅' },
  { chave: 'divergentes', label: 'Divergentes', icone: '❗', ajuda: 'Marcados como divergentes na jornada, aguardando tratativa.' },
  { chave: 'aguardandoRetorno', label: 'Aguardando transportadora', icone: '⏳' },
  { chave: 'aguardandoRetornoAtrasados', label: 'Aguardando há mais de 7 dias', icone: '⏰', alerta: true },
  { chave: 'auditadosSemFatura', label: 'Auditados sem fatura (15+ dias)', icone: '🧾', alerta: true },
  { chave: 'acordosFechadosAguardandoFatura', label: 'Acordos aguardando fatura', icone: '🤝' },
  { chave: 'descontosAguardandoConciliacao', label: 'Descontos aguardando conciliação', icone: '💰' },
  { chave: 'cancelamentosAguardandoReemissao', label: 'Cancelamentos aguardando reemissão', icone: '🔄', alerta: true },
];

export default function PainelPendenciasJornadaCte({
  competencia,
  onSelecionarGrupo,
  recarregarChave = 0,
  registrosCarregados = [],
  jornadaPorChave = new Map(),
  carteiras = [],
  vinculos = [],
  dentroDaMargem,
}) {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState(true);
  const [cardAtivo, setCardAtivo] = useState(null);
  const [auditorAtivo, setAuditorAtivo] = useState(null);

  useEffect(() => {
    let cancelado = false;
    async function carregar() {
      setCarregando(true);
      setErro('');
      try {
        const painel = await carregarPainelPendencias({ competencia });
        if (!cancelado) setDados(painel);
      } catch (error) {
        if (!cancelado) setErro(error.message || 'Não foi possível carregar o painel de pendências da jornada.');
      } finally {
        if (!cancelado) setCarregando(false);
      }
    }
    carregar();
    return () => { cancelado = true; };
    // recarregarChave muda quando o auditor mexe na jornada (marcar OK, registrar
    // retorno, anular...) — sem isso os cards ficariam com a contagem velha.
  }, [competencia, recarregarChave]);

  // transportadora -> auditor responsável (cadastro de carteiras).
  const auditorPorTransportadora = useMemo(() => {
    const mapa = new Map();
    (carteiras || []).forEach((c) => {
      const transp = String(c.transportadora || '').trim().toUpperCase();
      if (transp) mapa.set(transp, String(c.auditor_nome || '').trim() || 'Sem auditor');
    });
    return mapa;
  }, [carteiras]);

  // O CT-e traz o nome como veio no documento (nome_cte); a carteira usa o nome
  // canônico da tabela (nome_tabela). Sem passar pelo vínculo, quase tudo cairia
  // em "Sem auditor".
  const nomeTabelaPorNomeCte = useMemo(() => {
    const mapa = new Map();
    (vinculos || []).forEach((v) => {
      const origem = String(v.nome_cte || '').trim().toUpperCase();
      const destino = String(v.nome_tabela || '').trim().toUpperCase();
      if (origem && destino) mapa.set(origem, destino);
    });
    return mapa;
  }, [vinculos]);

  const auditorDoCte = useMemo(() => (row) => {
    const bruto = String(row.transportadora || '').trim().toUpperCase();
    if (!bruto) return 'Sem auditor';
    const canonico = nomeTabelaPorNomeCte.get(bruto) || bruto;
    return auditorPorTransportadora.get(canonico)
      || auditorPorTransportadora.get(bruto)
      || 'Sem auditor';
  }, [auditorPorTransportadora, nomeTabelaPorNomeCte]);

  // Recorte por auditor: quando um auditor está selecionado, todo o resto do
  // painel passa a olhar só a carteira dele.
  const registrosDoRecorte = useMemo(() => {
    if (!auditorAtivo) return registrosCarregados;
    return registrosCarregados.filter((r) => auditorDoCte(r) === auditorAtivo);
  }, [registrosCarregados, auditorAtivo, auditorDoCte]);

  /** Um CT-e está "resolvido" quando já tem decisão registrada na jornada.
   * Usa o conjunto vindo do banco (cobre a competência inteira) e cai pro mapa
   * das linhas visíveis, que reflete alterações feitas agora sem recarregar. */
  const cteResolvido = useMemo(() => (row) => {
    const jornadaLocal = jornadaPorChave.get(String(row.chave_cte)) || jornadaPorChave.get(String(row.numero_cte));
    if (jornadaLocal) return jornadaLocal.status_operacional !== 'NAO_AUDITADO';
    return Boolean(dados?.chavesTratadas?.has(String(row.chave_cte)));
  }, [jornadaPorChave, dados]);

  const gruposCarga = useMemo(() => {
    const semCalculoAmd = [];
    const aAuditar = [];
    const divergentesAbertos = [];
    registrosDoRecorte.forEach((row) => {
      const amd = Number(row.valor_calculado || 0);
      if (amd <= 0) { semCalculoAmd.push(row); return; }
      // Já tratado (OK, acordo, aguardando retorno...) sai das filas de trabalho.
      if (cteResolvido(row)) return;
      aAuditar.push(row);
      if (dentroDaMargem && !dentroDaMargem(row)) divergentesAbertos.push(row);
    });
    return { semCalculoAmd, aAuditar, divergentesAbertos };
  }, [registrosDoRecorte, cteResolvido, dentroDaMargem]);

  // Um card por auditor com o que ainda falta fechar na carteira dele.
  const cardsAuditores = useMemo(() => {
    if (!registrosCarregados.length) return [];
    const mapa = new Map();
    registrosCarregados.forEach((row) => {
      const auditor = auditorDoCte(row);
      if (!mapa.has(auditor)) mapa.set(auditor, { auditor, pendentes: 0, divergencia: 0, total: 0 });
      const item = mapa.get(auditor);
      item.total += 1;
      if (!cteResolvido(row)) {
        item.pendentes += 1;
        if (dentroDaMargem && Number(row.valor_calculado || 0) > 0 && !dentroDaMargem(row)) {
          item.divergencia += divergenciaDoCte(row);
        }
      }
    });
    return [...mapa.values()].sort((a, b) => b.pendentes - a.pendentes);
  }, [registrosCarregados, auditorDoCte, cteResolvido, dentroDaMargem]);

  const totaisAuditores = useMemo(() => cardsAuditores.reduce(
    (acc, item) => ({ total: acc.total + item.total, pendentes: acc.pendentes + item.pendentes }),
    { total: 0, pendentes: 0 },
  ), [cardsAuditores]);

  if (erro && !registrosCarregados.length) {
    // Painel é aditivo — se a migration da jornada ainda não rodou, não bloqueia a tela principal.
    return null;
  }

  function clicarCard(chave, lista, label, origem) {
    const desativando = cardAtivo === chave;
    setCardAtivo(desativando ? null : chave);
    // origem 'carga' = CT-es que já estão carregados na tela; a página deve só
    // filtrar. Rebuscar no banco apagaria os que ainda não foram salvos em
    // auditoria_cte_resultados (ex.: os sem cálculo AMD).
    if (onSelecionarGrupo) {
      onSelecionarGrupo(desativando ? null : label, desativando ? [] : lista, { jaCarregados: origem === 'carga' });
    }
  }

  const todosCards = [
    ...CARDS_CARGA.map((c) => ({ ...c, lista: gruposCarga[c.chave] || [], origem: 'carga' })),
    ...CARDS_JORNADA.map((c) => ({ ...c, lista: (dados?.[c.chave]) || [], origem: 'jornada' })),
  ];

  const cardAtivoInfo = todosCards.find((c) => c.chave === cardAtivo);
  const listaAtiva = cardAtivoInfo?.lista || null;
  const somarCampo = (lista, campo) => lista.reduce((acc, l) => acc + Number(l[campo] || 0), 0);
  const totais = cardAtivo && cardAtivoInfo?.origem === 'carga'
    ? {
        divergencia: (listaAtiva || []).reduce((acc, r) => acc + divergenciaDoCte(r), 0),
        acordado: 0,
        recuperado: 0,
      }
    : cardAtivo
      ? {
          divergencia: somarCampo(listaAtiva || [], 'valor_divergencia_identificada'),
          acordado: somarCampo(listaAtiva || [], 'valor_acordado'),
          recuperado: somarCampo(listaAtiva || [], 'valor_recuperado'),
        }
      : {
          divergencia: dados?.valorDivergenteIdentificado || 0,
          acordado: dados?.valorAcordado || 0,
          recuperado: dados?.valorRecuperado || 0,
        };

  return (
    <div className="panel-card" style={{ marginBottom: 16 }}>
      <div
        className="panel-title"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
        onClick={() => setAberto((v) => !v)}
      >
        <span>🧭 Jornada do CT-e — Painel de pendências{carregando ? <span style={{ fontWeight: 400, color: 'var(--muted)' }}> (carregando...)</span> : null}</span>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>{aberto ? '▲ ocultar' : '▼ exibir'}</span>
      </div>

      {aberto ? (
        <>
          {cardsAuditores.length ? (
            <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--border-soft)' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                  gap: 10,
                }}
              >
                {[{ auditor: null, nome: 'Todos', descricao: 'Todos os CT-es carregados', total: totaisAuditores.total, pendentes: totaisAuditores.pendentes }, ...cardsAuditores.map((i) => ({ ...i, nome: i.auditor, descricao: null }))].map((item) => {
                  const selecionado = auditorAtivo === item.auditor;
                  return (
                    <button
                      key={item.nome}
                      type="button"
                      onClick={() => {
                        setAuditorAtivo(item.auditor);
                        setCardAtivo(null);
                        if (onSelecionarGrupo) onSelecionarGrupo(null, []);
                      }}
                      title={`${item.pendentes.toLocaleString('pt-BR')} sem decisão de ${item.total.toLocaleString('pt-BR')} CT-e(s) · clique para filtrar os cards abaixo`}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                        textAlign: 'left', cursor: 'pointer', borderRadius: 12, padding: '12px 16px',
                        border: `1px solid ${selecionado ? 'var(--primary)' : 'var(--border-soft)'}`,
                        background: selecionado ? '#eef2ff' : 'var(--panel)',
                        boxShadow: selecionado ? '0 0 0 2px rgba(7,27,73,0.10)' : 'var(--shadow)',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.nome}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {item.descricao || `${item.pendentes.toLocaleString('pt-BR')} em aberto`}
                        </div>
                      </div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: item.pendentes ? '#dc2626' : '#94a3b8', whiteSpace: 'nowrap' }}>
                        {item.total.toLocaleString('pt-BR')}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 10,
            }}
          >
            {todosCards.map((card) => {
              const qtd = card.lista.length;
              const emAlerta = card.alerta && qtd > 0;
              const selecionado = cardAtivo === card.chave;
              return (
                <div
                  key={card.chave}
                  className="stat-card"
                  role="button"
                  tabIndex={0}
                  title={card.ajuda || (qtd ? `Ver os ${qtd} CT-e(s) deste grupo no detalhe abaixo` : 'Nenhum CT-e neste grupo')}
                  onClick={() => qtd && clicarCard(card.chave, card.lista, card.label, card.origem)}
                  onKeyDown={(e) => { if (qtd && (e.key === 'Enter' || e.key === ' ')) clicarCard(card.chave, card.lista, card.label, card.origem); }}
                  style={{
                    padding: '12px 14px',
                    cursor: qtd ? 'pointer' : 'default',
                    borderColor: selecionado ? 'var(--primary)' : (emAlerta ? '#e0a200' : 'var(--border)'),
                    borderWidth: selecionado ? 2 : 1,
                    background: emAlerta ? '#fff8e8' : 'var(--panel)',
                    boxShadow: selecionado ? '0 0 0 2px rgba(7,27,73,0.12)' : undefined,
                    opacity: qtd ? 1 : 0.7,
                  }}
                >
                  <div className="stat-icon">{card.icone}</div>
                  <div className="stat-value" style={{ fontSize: 24, color: emAlerta ? '#946200' : 'var(--text)' }}>
                    {qtd.toLocaleString('pt-BR')}
                  </div>
                  <div className="stat-desc">{card.label}</div>
                </div>
              );
            })}
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 24,
              marginTop: 4,
              paddingTop: 10,
              borderTop: '1px solid var(--border-soft)',
              fontSize: 13,
              color: 'var(--muted)',
            }}
          >
            <span style={{ fontWeight: 700, color: cardAtivo ? 'var(--primary)' : 'var(--muted)' }}>
              {cardAtivo ? `${cardAtivoInfo?.icone} ${cardAtivoInfo?.label}:` : 'Total geral:'}
            </span>
            <span>Divergência identificada: <strong style={{ color: 'var(--text)' }}>{formatarMoeda(totais.divergencia)}</strong></span>
            <span>Acordado: <strong style={{ color: 'var(--text)' }}>{formatarMoeda(totais.acordado)}</strong></span>
            <span>Recuperado: <strong style={{ color: 'var(--text)' }}>{formatarMoeda(totais.recuperado)}</strong></span>
          </div>
        </>
      ) : null}
    </div>
  );
}
