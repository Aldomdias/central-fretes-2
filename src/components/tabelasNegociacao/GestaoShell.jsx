import React, { useEffect, useMemo, useState } from 'react';
import { carregarSessao } from '../../utils/authLocal';
import { enriquecerTabelaGestao } from '../../utils/tabelasNegociacaoGestao';
import GestaoDashboard from './GestaoDashboard';
import GestaoFiltros from './GestaoFiltros';
import GestaoListaNegociacoes from './GestaoListaNegociacoes';
import GestaoPorTransportadora from './GestaoPorTransportadora';
import GestaoAprovacoes from './GestaoAprovacoes';
import GestaoHistorico from './GestaoHistorico';
import { gestaoStyles } from './GestaoStyles';

const FILTROS_INICIAIS = {
  busca: '',
  transportadora: '',
  negociador: '',
  criadoPor: '',
  statusGestao: '',
  tipoNegociacao: '',
  canal: '',
  origem: '',
  regiaoOrigem: '',
  ufOrigem: '',
  ufDestino: '',
  comSavingPositivo: false,
  comReajuste: false,
  aguardandoAprovacao: false,
  minhasNegociacoes: false,
  semAtualizacao: false,
  filtroRapido: '',
};

const ABAS = [
  ['visao-geral', 'Visão geral'],
  ['negociacoes', 'Negociações'],
  ['transportadora', 'Por transportadora'],
  ['aprovacoes', 'Aprovações'],
  ['historico', 'Histórico'],
];

export default function GestaoShell({
  tabelas = [],
  onAbrirNegociacao,
  onEnviarAprovacao,
  onAlternarSimulacao,
  onAprovarGestor,
  onRecusarGestor,
  onDevolverGestor,
  onComplementoGestor,
  onPublicarOficial,
  salvandoGestao = false,
  selecionadaId = null,
  abaInicial = 'visao-geral',
  onAbaChange,
}) {
  const [aba, setAba] = useState(abaInicial);
  const [filtros, setFiltros] = useState(FILTROS_INICIAIS);
  const [filtroTransportadora, setFiltroTransportadora] = useState('');
  const sessao = useMemo(() => carregarSessao(), []);

  function mudarAba(novaAba) {
    setAba(novaAba);
    if (typeof onAbaChange === 'function') onAbaChange(novaAba);
  }

  useEffect(() => {
    setAba(abaInicial);
  }, [abaInicial]);

  const negociadores = useMemo(() => {
    const nomes = new Set();
    tabelas.forEach((t) => {
      const e = enriquecerTabelaGestao(t, sessao);
      if (e.negociador_display && e.negociador_display !== 'Legado' && e.negociador_display !== 'Não informado') {
        nomes.add(e.negociador_display);
      }
    });
    return [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [tabelas, sessao]);

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={gestaoStyles.abas}>
        {ABAS.map(([key, label]) => (
          <button key={key} type="button" style={aba === key ? gestaoStyles.abaAtiva : gestaoStyles.aba} onClick={() => mudarAba(key)}>
            {label}
          </button>
        ))}
      </div>

      {aba === 'visao-geral' ? (
        <section className="sim-card">
          <h2 style={{ marginTop: 0 }}>Dashboard gerencial</h2>
          <GestaoDashboard tabelas={tabelas} />
        </section>
      ) : null}

      {aba === 'negociacoes' ? (
        <>
          <GestaoFiltros
            filtros={filtros}
            onChange={setFiltros}
            onLimpar={() => setFiltros(FILTROS_INICIAIS)}
            negociadores={negociadores}
          />
          <GestaoListaNegociacoes
            tabelas={tabelas}
            filtros={filtros}
            sessao={sessao}
            onAbrir={onAbrirNegociacao}
            onEnviarAprovacao={onEnviarAprovacao}
            onAlternarSimulacao={onAlternarSimulacao}
            selecionadaId={selecionadaId}
          />
        </>
      ) : null}

      {aba === 'transportadora' ? (
        <div style={gestaoStyles.duasColunas}>
          <GestaoPorTransportadora
            tabelas={tabelas}
            sessao={sessao}
            onAbrirOrigem={(id) => onAbrirNegociacao({ id })}
            filtroTransportadora={filtroTransportadora}
            onFiltroTransportadoraChange={setFiltroTransportadora}
          />
          <div style={gestaoStyles.painelLateral}>
            <GestaoHistorico
              tabelas={tabelas}
              filtroTransportadora={filtroTransportadora}
              modo="painel"
            />
          </div>
        </div>
      ) : null}

      {aba === 'aprovacoes' ? (
        <GestaoAprovacoes
          tabelas={tabelas}
          sessao={sessao}
          onAprovar={onAprovarGestor}
          onRecusar={onRecusarGestor}
          onDevolver={onDevolverGestor}
          onComplemento={onComplementoGestor}
          onPublicar={onPublicarOficial}
          salvando={salvandoGestao}
        />
      ) : null}

      {aba === 'historico' ? (
        <GestaoHistorico tabelas={tabelas} filtroTransportadora={filtros.transportadora} />
      ) : null}
    </div>
  );
}
