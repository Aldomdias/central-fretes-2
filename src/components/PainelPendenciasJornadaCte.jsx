import React, { useEffect, useState } from 'react';
import { carregarPainelPendencias } from '../services/auditoriaCteJornadaService';

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const CARDS = [
  { chave: 'naoAuditados', label: 'Não auditados', icone: '📋' },
  { chave: 'auditadosOk', label: 'Auditados OK', icone: '✅' },
  { chave: 'divergentes', label: 'Divergentes', icone: '⚠️' },
  { chave: 'aguardandoRetorno', label: 'Aguardando transportadora', icone: '⏳' },
  { chave: 'aguardandoRetornoAtrasados', label: 'Aguardando há mais de 7 dias', icone: '⏰', alerta: true },
  { chave: 'auditadosSemFatura', label: 'Auditados sem fatura (15+ dias)', icone: '🧾', alerta: true },
  { chave: 'acordosFechadosAguardandoFatura', label: 'Acordos aguardando fatura', icone: '🤝' },
  { chave: 'descontosAguardandoConciliacao', label: 'Descontos aguardando conciliação', icone: '💰' },
];

export default function PainelPendenciasJornadaCte({ competencia, onSelecionarGrupo }) {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState(true);
  const [cardAtivo, setCardAtivo] = useState(null);

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
  }, [competencia]);

  if (erro) {
    // Painel é aditivo — se a migration da jornada ainda não rodou, não bloqueia a tela principal.
    return null;
  }

  function clicarCard(card) {
    const desativando = cardAtivo === card.chave;
    setCardAtivo(desativando ? null : card.chave);
    if (onSelecionarGrupo) onSelecionarGrupo(desativando ? null : card.label, desativando ? [] : (dados[card.chave] || []));
  }

  const cardAtivoInfo = CARDS.find((c) => c.chave === cardAtivo);
  const listaAtiva = dados && cardAtivo ? (dados[cardAtivo] || []) : null;
  const somarCampo = (lista, campo) => lista.reduce((acc, l) => acc + Number(l[campo] || 0), 0);
  const totais = listaAtiva
    ? {
        divergencia: somarCampo(listaAtiva, 'valor_divergencia_identificada'),
        acordado: somarCampo(listaAtiva, 'valor_acordado'),
        recuperado: somarCampo(listaAtiva, 'valor_recuperado'),
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

      {aberto && dados ? (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 10,
            }}
          >
            {CARDS.map((card) => {
              const lista = dados[card.chave] || [];
              const qtd = Array.isArray(lista) ? lista.length : 0;
              const emAlerta = card.alerta && qtd > 0;
              const selecionado = cardAtivo === card.chave;
              return (
                <div
                  key={card.chave}
                  className="stat-card"
                  role="button"
                  tabIndex={0}
                  title={qtd ? `Ver os ${qtd} CT-e(s) deste grupo no detalhe abaixo` : 'Nenhum CT-e neste grupo'}
                  onClick={() => qtd && clicarCard(card)}
                  onKeyDown={(e) => { if (qtd && (e.key === 'Enter' || e.key === ' ')) clicarCard(card); }}
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
