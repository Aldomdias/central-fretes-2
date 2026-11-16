import React, { useState } from 'react';
import {
  filtrarTabelasGestao,
  formatarMoeda,
  formatarData,
  usuarioEhGestor,
  podePublicarOficial,
} from '../../utils/tabelasNegociacaoGestao';
import { gestaoStyles } from './GestaoStyles';

// Mesma transportadora + origem + canal pode ter mais de uma tabela
// (ex.: principal "Passeio" e alternativa "Agrícola"). Sem a identificação o
// gestor não sabe qual card está aprovando — mesma lógica da lista de negociações.
const chaveGrupo = (t) => [t.transportadora, t.origem_label, t.canal].map((v) => String(v || '').trim().toUpperCase()).join('|');

function contarPorGrupo(lista) {
  const mapa = new Map();
  lista.forEach((t) => { const k = chaveGrupo(t); mapa.set(k, (mapa.get(k) || 0) + 1); });
  return mapa;
}

function IdentificacaoTabela({ tabela: t, todas = [], qtdNoGrupo = 0 }) {
  const ehAlternativa = Boolean(t.tabela_alternativa_de);
  if (t.variante_tabela || ehAlternativa) {
    const principal = ehAlternativa ? todas.find((x) => String(x.id) === String(t.tabela_alternativa_de)) : null;
    const nomePrincipal = principal ? (principal.variante_tabela || principal.nome_negociacao || principal.descricao) : '';
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span
          title={ehAlternativa ? 'Tabela alternativa (mesma transportadora+origem)' : 'Tabela principal'}
          style={{ display: 'inline-block', fontSize: 12, fontWeight: 800, padding: '3px 10px', borderRadius: 999, background: ehAlternativa ? '#ede9fe' : '#e0f2fe', color: ehAlternativa ? '#5b21b6' : '#0369a1' }}
        >
          {ehAlternativa ? 'Tabela alternativa' : 'Tabela principal'}{t.variante_tabela ? `: ${t.variante_tabela}` : ''}
        </span>
        {ehAlternativa && nomePrincipal ? (
          <span style={{ fontSize: 11, color: '#64748b' }}>alternativa de: {nomePrincipal}</span>
        ) : null}
      </span>
    );
  }
  if (qtdNoGrupo > 1) {
    return (
      <span
        title='Há mais de uma tabela desta transportadora nesta origem/canal. Abra a negociação e preencha "Identificação da tabela" (ex.: Agrícola / Passeio) para diferenciá-las.'
        style={{ display: 'inline-block', fontSize: 12, fontWeight: 800, padding: '3px 10px', borderRadius: 999, background: '#fef3c7', color: '#92400e' }}
      >
        {qtdNoGrupo} tabelas desta transportadora nesta origem · sem identificação
      </span>
    );
  }
  return null;
}

export default function GestaoAprovacoes({
  tabelas = [],
  sessao = null,
  onAprovar,
  onRecusar,
  onDevolver,
  onComplemento,
  onPublicar,
  onAprovarPublicar,
  onMarcarJaPublicada,
  mensagemErro = '',
  mensagemSucesso = '',
  salvando = false,
}) {
  const [observacao, setObservacao] = useState({});
  const pendentes = filtrarTabelasGestao(tabelas, { aguardandoAprovacao: true }, sessao);
  const aprovadas = filtrarTabelasGestao(tabelas, { statusGestao: 'APROVADA_GESTOR' }, sessao);
  const ehGestor = usuarioEhGestor(sessao);
  const qtdPendentesGrupo = contarPorGrupo(pendentes);
  const qtdAprovadasGrupo = contarPorGrupo(aprovadas);

  function obs(id) {
    return observacao[id] || '';
  }

  function setObs(id, valor) {
    setObservacao((p) => ({ ...p, [id]: valor }));
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section className="sim-card">
        <h2 style={{ marginTop: 0 }}>Aguardando aprovação do gestor</h2>
        {!ehGestor ? (
          <div className="sim-alert info">Somente perfil Gestão pode aprovar, recusar ou devolver negociações.</div>
        ) : null}
        {mensagemErro ? <div className="sim-alert erro">{mensagemErro}</div> : null}
        {mensagemSucesso ? <div className="sim-alert success">{mensagemSucesso}</div> : null}

        {pendentes.map((t) => (
          <div key={t.id} className="sim-parametros-box" style={{ marginBottom: 14 }}>
            <div className="sim-parametros-header">
              <div>
                <strong>{t.transportadora}</strong> · {t.nome_negociacao}
                <div style={{ marginTop: 6 }}>
                  <IdentificacaoTabela tabela={t} todas={tabelas} qtdNoGrupo={qtdPendentesGrupo.get(chaveGrupo(t)) || 0} />
                </div>
                <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 12 }}>
                  Negociador: {t.negociador_display} · Tipo: {t.is_reajuste ? 'Reajuste' : 'Negociação'} · Canal: {t.canal}
                </p>
                <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 12 }}>
                  Origens: {t.origem_label} · Enviada em: {formatarData(t.enviado_aprovacao_em)}
                  {t.qtd_rotas ? ` · ${Number(t.qtd_rotas).toLocaleString('pt-BR')} rotas` : ''}
                </p>
                {t.observacao ? (
                  <p style={{ margin: '4px 0 0', color: '#334155', fontSize: 12 }}>
                    Obs. do negociador: {t.observacao}
                  </p>
                ) : null}
              </div>
              <div style={{ textAlign: 'right', fontSize: 12 }}>
                <div>Saving: {formatarMoeda(t.saving_estimado)}</div>
                {t.is_reajuste ? <div>Impacto: {formatarMoeda(t.impacto_reajuste)}</div> : null}
              </div>
            </div>
            {t.analises_canais?.length > 1 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10, marginTop: 12 }}>
                {t.analises_canais.map((canal) => (
                  <div key={canal.canal} style={{ border: '1px solid #dbe3ef', borderRadius: 10, padding: 11, background: '#f8fafc' }}>
                    <strong>{canal.label}</strong>
                    <div style={{ marginTop: 5 }}>Saving: <strong>{formatarMoeda(canal.saving)}</strong></div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>Aderência: {Number(canal.aderencia || 0).toFixed(2)}% · {Number(canal.ctes || 0).toLocaleString('pt-BR')} CT-es</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>Faturamento/mês: {formatarMoeda(canal.faturamento)}</div>
                  </div>
                ))}
                <div style={{ border: '1px solid #a7c0ef', borderRadius: 10, padding: 11, background: '#eef4ff' }}>
                  <strong>Total para aprovação</strong>
                  <div style={{ marginTop: 5 }}>Saving: <strong>{formatarMoeda(t.saving_estimado)}</strong></div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>Uma única aprovação para a negociação completa.</div>
                </div>
              </div>
            ) : null}
            <textarea
              value={obs(t.id)}
              onChange={(e) => setObs(t.id, e.target.value)}
              placeholder="Observação da análise do gestor..."
              style={{ width: '100%', minHeight: 70, marginTop: 10 }}
            />
            {ehGestor ? (
              <div className="sim-actions" style={{ marginTop: 10 }}>
                <button className="sim-tab" type="button" disabled={salvando} onClick={() => onAprovar(t, obs(t.id))} title="Só aprova. A tabela NÃO vai para Transportadoras até clicar em Publicar na base oficial.">Aprovar (sem publicar)</button>
                {typeof onAprovarPublicar === 'function' ? (
                  <button className="primary" type="button" disabled={salvando} onClick={() => onAprovarPublicar(t, obs(t.id))}>Aprovar e publicar</button>
                ) : null}
                <button className="sim-tab" type="button" disabled={salvando} onClick={() => onRecusar(t, obs(t.id))}>Recusar</button>
                <button className="sim-tab" type="button" disabled={salvando} onClick={() => onDevolver(t, obs(t.id))}>Devolver para ajuste</button>
                <button className="sim-tab" type="button" disabled={salvando} onClick={() => onComplemento(t, obs(t.id))}>Solicitar complemento</button>
              </div>
            ) : null}
          </div>
        ))}
        {!pendentes.length ? <div className="sim-alert success">Nenhuma negociação aguardando aprovação do gestor.</div> : null}
      </section>

      <section className="sim-card">
        <h2 style={{ marginTop: 0 }}>Aprovadas — prontas para publicação</h2>
        <p style={{ color: '#64748b' }}>Somente negociações aprovadas pelo gestor podem ir para a base oficial.</p>
        {aprovadas.map((t) => (
          <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #e2e8f0', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <strong>{t.transportadora}</strong> · {t.origem_label}
              <div style={{ margin: '4px 0' }}>
                <IdentificacaoTabela tabela={t} todas={tabelas} qtdNoGrupo={qtdAprovadasGrupo.get(chaveGrupo(t)) || 0} />
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>Aprovada em {formatarData(t.aprovado_em)} por {t.aprovador_display}</div>
              <div style={{ fontSize: 12, color: '#475569', marginTop: 3 }}>
                Destino: {t.tipo_negociacao_norm === 'TABELA_LOTACAO' ? 'Transportadoras · Lotação' : `Transportadoras · ${t.canal || 'Tabela oficial'}`}
              </div>
            </div>
            {ehGestor && podePublicarOficial(t) ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button className="primary" type="button" disabled={salvando} onClick={() => onPublicar(t)}>Publicar na base oficial</button>
                <button
                  className="sim-tab"
                  type="button"
                  disabled={salvando}
                  onClick={() => {
                    const motivo = window.prompt('Motivo para devolver ' + t.transportadora + ' para negociação:', 'Devolvida para nova simulação e reenvio');
                    if (motivo && motivo.trim()) onDevolver(t, motivo.trim());
                  }}
                  title="Tira das aprovadas e devolve para a negociação, para ajustar, simular e reenviar"
                >Devolver para negociação</button>
                {typeof onMarcarJaPublicada === 'function' ? (
                  <button className="sim-tab" type="button" disabled={salvando} onClick={() => onMarcarJaPublicada(t)} title="Use quando a tabela já foi inserida manualmente na base oficial">Já está na base oficial</button>
                ) : null}
              </div>
            ) : (
              <span style={gestaoStyles.badgeStatus('#16a34a')}>Aprovada</span>
            )}
          </div>
        ))}
        {!aprovadas.length ? <div style={{ color: '#64748b' }}>Nenhuma negociação aprovada aguardando publicação.</div> : null}
      </section>
    </div>
  );
}
