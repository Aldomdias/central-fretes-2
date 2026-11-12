import React, { useEffect, useMemo, useState } from 'react';
import {
  listarTransportadorasCadastro,
  listarOrigensNegociacaoParaPublicacao,
  sugerirDestinoOrigensPublicacao,
} from '../../services/tabelasNegociacaoService';

// Tela única de publicação na base oficial: o gestor escolhe a transportadora,
// para qual origem cada origem da negociação vai (ou se é origem nova) e se a
// tabela substitui a atual a partir da vigência ou entra como nova aba.
// Nada é publicado sem todos os destinos definidos.

const NOVA = '__NOVA__';
const NOVA_TRANSPORTADORA = '__NOVA_TRANSPORTADORA__';

function normalizarNome(nome) {
  return String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function rotuloOrigemNegociacao(origem) {
  const cidade = origem.cidade ? `${origem.cidade}${origem.uf ? `/${origem.uf}` : ''}` : `Sem cidade${origem.ibgeOrigem ? ` (IBGE ${origem.ibgeOrigem})` : ''}`;
  return `${cidade} · ${origem.canal}`;
}

function rotuloAbas(abas = []) {
  if (!abas.length) return '';
  return ` — abas: ${abas.map((aba) => aba.grupo).join(', ')}`;
}

export default function PublicacaoOficialModal({ tabela, titulo, onCancelar, onConfirmar }) {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [transportadoras, setTransportadoras] = useState([]);
  const [origensNeg, setOrigensNeg] = useState([]);
  const [lotacao, setLotacao] = useState(false);
  const [transportadoraId, setTransportadoraId] = useState('');
  const [nomeNova, setNomeNova] = useState(tabela?.transportadora || '');
  const [oficiais, setOficiais] = useState([]);
  const [carregandoOrigens, setCarregandoOrigens] = useState(false);
  const [destinos, setDestinos] = useState({});
  const [cidadesNovas, setCidadesNovas] = useState({});
  const [modoTabela, setModoTabela] = useState('SUBSTITUIR_VIGENCIA');
  const [nomeAba, setNomeAba] = useState('');
  // Só no modo "nova aba": gravar a data como vigência da aba. Sem isso a aba
  // entra sem vigência e concorre com a principal em qualquer data.
  const [vigenciaNaAba, setVigenciaNaAba] = useState(false);
  const [inicioVigencia, setInicioVigencia] = useState(tabela?.data_inicio_vigencia ? String(tabela.data_inicio_vigencia).slice(0, 10) : hojeISO());

  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const [lista, neg] = await Promise.all([
          listarTransportadorasCadastro(),
          listarOrigensNegociacaoParaPublicacao(tabela.id),
        ]);
        if (!ativo) return;
        setTransportadoras(lista || []);
        setOrigensNeg(neg.origens || []);
        setLotacao(Boolean(neg.lotacao));
        setCidadesNovas(Object.fromEntries((neg.origens || []).map((o) => [o.chave, o.cidade || ''])));
        // Pré-seleciona a transportadora de mesmo nome (sem caixa/acento).
        const alvos = [tabela?.transportadora_base_nome, tabela?.transportadora].map(normalizarNome).filter(Boolean);
        const achada = (lista || []).find((t) => alvos.includes(normalizarNome(t.nome)));
        setTransportadoraId(achada ? String(achada.id) : NOVA_TRANSPORTADORA);
      } catch (e) {
        if (ativo) setErro(e.message || 'Erro ao carregar os dados para publicação.');
      } finally {
        if (ativo) setCarregando(false);
      }
    })();
    return () => { ativo = false; };
  }, [tabela]);

  const transportadoraEscolhida = useMemo(
    () => transportadoras.find((t) => String(t.id) === String(transportadoraId)) || null,
    [transportadoras, transportadoraId],
  );

  useEffect(() => {
    let ativo = true;
    if (!transportadoraEscolhida || lotacao) {
      setOficiais([]);
      setDestinos(Object.fromEntries(origensNeg.map((o) => [o.chave, NOVA])));
      return undefined;
    }
    setCarregandoOrigens(true);
    sugerirDestinoOrigensPublicacao(transportadoraEscolhida.id, origensNeg)
      .then((res) => {
        if (!ativo) return;
        setOficiais(res.oficiais || []);
        // Sugestão: mesma cidade/canal ou mesmo IBGE. Sem sugestão fica em
        // branco para o gestor escolher (não assume "nova" sozinho).
        setDestinos(Object.fromEntries(origensNeg.map((o) => [o.chave, res.sugestoes?.[o.chave] ? String(res.sugestoes[o.chave]) : ''])));
      })
      .catch((e) => { if (ativo) setErro(e.message || 'Erro ao carregar as origens da transportadora.'); })
      .finally(() => { if (ativo) setCarregandoOrigens(false); });
    return () => { ativo = false; };
  }, [transportadoraEscolhida, origensNeg, lotacao]);

  const algumaExistente = origensNeg.some((o) => destinos[o.chave] && destinos[o.chave] !== NOVA);

  function confirmar() {
    setErro('');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inicioVigencia)) return setErro('Informe o início da vigência.');
    const nomeOficial = transportadoraEscolhida ? transportadoraEscolhida.nome : String(nomeNova || '').trim();
    if (!nomeOficial) return setErro('Informe o nome da transportadora nova.');
    if (lotacao) {
      return onConfirmar({ transportadora_oficial_nome: nomeOficial, data_inicio_vigencia: inicioVigencia });
    }
    const mapa = {};
    const usadas = new Set();
    for (const origem of origensNeg) {
      const destino = destinos[origem.chave];
      if (!destino) return setErro(`Escolha o destino da origem ${rotuloOrigemNegociacao(origem)}.`);
      if (destino === NOVA) {
        const cidade = String(cidadesNovas[origem.chave] || '').trim();
        if (!cidade) return setErro(`Informe a cidade da nova origem (${rotuloOrigemNegociacao(origem)}).`);
        mapa[origem.chave] = { destino: 'NOVA', cidade, uf: origem.uf || '' };
      } else {
        if (usadas.has(destino)) return setErro('Duas origens da negociação estão indo para a mesma origem oficial.');
        usadas.add(destino);
        mapa[origem.chave] = { destino: 'EXISTENTE', origem_id: destino };
      }
    }
    if (algumaExistente && modoTabela === 'NOVA_ABA' && !String(nomeAba).trim()) {
      return setErro('Informe o nome da nova aba de tabela.');
    }
    return onConfirmar({
      transportadora_oficial_nome: nomeOficial,
      data_inicio_vigencia: inicioVigencia,
      modo_tabela: modoTabela,
      nome_aba: String(nomeAba).trim(),
      vigencia_na_aba: modoTabela === 'NOVA_ABA' && vigenciaNaAba,
      mapa_origens: mapa,
    });
  }

  const [ano, mes, dia] = inicioVigencia.split('-');
  const grupoReajuste = ano ? `Reajuste ${dia}/${mes}/${ano}` : 'Reajuste';

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 100001, display: 'grid', placeItems: 'center', padding: 20 }}
      onClick={onCancelar}
    >
      <div className="sim-card" style={{ width: 'min(760px,100%)', maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>{titulo || 'Publicar na base oficial'}</h2>
        <p style={{ color: '#64748b', marginTop: 0 }}>
          Negociação <strong>{tabela?.transportadora}</strong>. Escolha exatamente onde a tabela vai entrar — nada é gravado sem destino definido.
        </p>

        {carregando ? <div className="sim-alert">Carregando transportadoras e origens da negociação…</div> : (
          <>
            <label>1. Transportadora na base oficial
              <select value={transportadoraId} onChange={(e) => setTransportadoraId(e.target.value)}>
                <option value={NOVA_TRANSPORTADORA}>Transportadora nova (cadastrar)</option>
                {transportadoras.map((t) => <option key={t.id} value={String(t.id)}>{t.nome}</option>)}
              </select>
            </label>
            {!transportadoraEscolhida ? (
              <label>Nome da transportadora nova
                <input value={nomeNova} onChange={(e) => setNomeNova(e.target.value)} />
              </label>
            ) : null}

            {!lotacao ? (
              <div style={{ marginTop: 12 }}>
                <strong>2. Origem de destino</strong>
                {carregandoOrigens ? <div className="sim-alert">Carregando origens de {transportadoraEscolhida?.nome}…</div> : null}
                {origensNeg.map((origem) => {
                  const destino = destinos[origem.chave] || '';
                  return (
                    <div key={origem.chave} style={{ border: '1px solid #dbe3ef', borderRadius: 10, padding: 10, marginTop: 8 }}>
                      <div style={{ fontSize: 13 }}>
                        Origem da negociação: <strong>{rotuloOrigemNegociacao(origem)}</strong>
                        <span style={{ color: '#64748b' }}> · {origem.rotas} rotas · {origem.cotacoes} fretes</span>
                      </div>
                      <select
                        value={destino}
                        disabled={!transportadoraEscolhida}
                        onChange={(e) => setDestinos((p) => ({ ...p, [origem.chave]: e.target.value }))}
                        style={{ marginTop: 6, width: '100%' }}
                      >
                        <option value="">Selecione…</option>
                        {oficiais.map((o) => (
                          <option key={o.id} value={String(o.id)}>
                            Existente: {o.cidade || '(sem cidade)'} · {o.canal || 'ATACADO'}{rotuloAbas(o.abas)}
                          </option>
                        ))}
                        <option value={NOVA}>Nova origem nesta transportadora</option>
                      </select>
                      {destino === NOVA ? (
                        <label style={{ marginTop: 6 }}>Cidade da nova origem
                          <input
                            value={cidadesNovas[origem.chave] || ''}
                            onChange={(e) => setCidadesNovas((p) => ({ ...p, [origem.chave]: e.target.value }))}
                            placeholder="Ex.: Goiânia"
                          />
                        </label>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {algumaExistente ? (
              <div style={{ marginTop: 12 }}>
                <strong>3. Na origem existente</strong>
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 6 }}>
                  <input type="radio" checked={modoTabela === 'SUBSTITUIR_VIGENCIA'} onChange={() => setModoTabela('SUBSTITUIR_VIGENCIA')} />
                  <span>Substituir a partir da vigência — cria a aba <strong>{grupoReajuste}</strong>; a tabela atual vale até o dia anterior.</span>
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 6 }}>
                  <input type="radio" checked={modoTabela === 'NOVA_ABA'} onChange={() => setModoTabela('NOVA_ABA')} />
                  <span>Incluir como nova aba de tabela (sem encerrar a atual)</span>
                </label>
                {modoTabela === 'NOVA_ABA' ? (
                  <>
                    <label>Nome da nova aba
                      <input value={nomeAba} onChange={(e) => setNomeAba(e.target.value)} placeholder="Ex.: Tabela OTR" />
                    </label>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8 }}>
                      <input type="checkbox" checked={vigenciaNaAba} onChange={(e) => setVigenciaNaAba(e.target.checked)} />
                      <span>
                        Gravar o início da vigência nesta aba — a partir da data, esta aba (e outras abas com a mesma data) substituem a tabela principal na Auditoria; antes dela continua a principal.
                      </span>
                    </label>
                    {!vigenciaNaAba ? (
                      <div style={{ fontSize: 12, color: '#92400e', background: '#fef3c7', borderRadius: 8, padding: '6px 10px', marginTop: 6 }}>
                        Sem marcar, a aba entra <strong>sem vigência</strong>: concorre com a tabela principal em qualquer data (como OTR/rodas). A data abaixo não fica registrada na aba.
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}

            <label style={{ marginTop: 12 }}>Início da vigência
              <input type="date" value={inicioVigencia} onChange={(e) => setInicioVigencia(e.target.value)} />
            </label>
          </>
        )}

        {erro ? <div className="sim-alert error" style={{ marginTop: 10 }}>{erro}</div> : null}
        <div className="sim-actions" style={{ marginTop: 14 }}>
          <button className="primary" type="button" disabled={carregando || carregandoOrigens} onClick={confirmar}>Publicar</button>
          <button className="sim-tab" type="button" onClick={onCancelar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
