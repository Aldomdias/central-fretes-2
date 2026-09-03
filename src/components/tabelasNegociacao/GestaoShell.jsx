import React, { useEffect, useMemo, useState } from 'react';
import { carregarSessao } from '../../utils/authLocal';
import { enriquecerTabelaGestao, usuarioEhGestor } from '../../utils/tabelasNegociacaoGestao';
import GestaoDashboard from './GestaoDashboard';
import GestaoFiltros from './GestaoFiltros';
import GestaoListaNegociacoes from './GestaoListaNegociacoes';
import GestaoPorTransportadora from './GestaoPorTransportadora';
import GestaoAprovacoes from './GestaoAprovacoes';
import GestaoHistorico from './GestaoHistorico';
import GestaoSavingsAprovados from './GestaoSavingsAprovados';
import GestaoSavingSimulado from './GestaoSavingSimulado';
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

function usuarioPodeDevolverSaving(sessao) {
  if (!usuarioEhGestor(sessao)) return false;
  const id = String(sessao?.id || '').trim().toLowerCase();
  const email = String(sessao?.email || '').trim().toLowerCase();
  return id === 'user-gestao-aldo'
    || email === 'aldo.dias@cantu.inc'
    || email === 'aldomdias@gmail.com';
}

const ABAS = [
  ['visao-geral', 'Visão geral'],
  ['negociacoes', 'Negociações'],
  ['transportadora', 'Por transportadora'],
  ['aprovacoes', 'Aprovações'],
  ['savings-aprovados', 'Savings pós-aprovação'],
  ['saving-simulado', 'Saving simulado'],
  ['historico', 'Histórico'],
];

export default function GestaoShell({
  tabelas = [],
  onAbrirNegociacao,
  onAdicionarOrigem,
  onGerarLaudoTransportadora,
  carregandoLaudoTransportadora = false,
  onEnviarAprovacao,
  onAlternarSimulacao,
  onDescontinuar,
  onSavingSalvo,
  onExcluir,
  onAprovarGestor,
  onRecusarGestor,
  onDevolverGestor,
  onComplementoGestor,
  onPublicarOficial,
  onAprovarPublicarOficial,
  onMarcarJaPublicada,
  mensagemErro = '',
  mensagemSucesso = '',
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
            onDescontinuar={onDescontinuar}
            onExcluir={onExcluir}
            selecionadaId={selecionadaId}
          />
        </>
      ) : null}

      {aba === 'transportadora' ? (
        <div style={gestaoStyles.duasColunas}>
          <GestaoPorTransportadora
            tabelas={tabelas}
            sessao={sessao}
            onAbrirOrigem={(id) => onAbrirNegociacao(id)}
            onAdicionarOrigem={onAdicionarOrigem}
            onGerarLaudoTransportadora={onGerarLaudoTransportadora}
            carregandoLaudoTransportadora={carregandoLaudoTransportadora}
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
          onAprovarPublicar={onAprovarPublicarOficial}
          onMarcarJaPublicada={onMarcarJaPublicada}
          mensagemErro={mensagemErro}
          mensagemSucesso={mensagemSucesso}
          salvando={salvandoGestao}
        />
      ) : null}

      {aba === 'savings-aprovados' ? (
        <GestaoSavingsAprovados
          tabelas={tabelas}
          podeDevolver={usuarioPodeDevolverSaving(sessao)}
          onDevolver={onDevolverGestor}
          onSavingSalvo={onSavingSalvo}
        />
      ) : null}

      {aba === 'saving-simulado' ? (
        <GestaoSavingSimulado tabelas={tabelas} />
      ) : null}

      {aba === 'historico' ? (
        <GestaoHistorico tabelas={tabelas} filtroTransportadora={filtros.transportadora} />
      ) : null}
    </div>
  );
}
