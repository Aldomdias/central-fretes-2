import React, { useEffect, useMemo, useState } from 'react';
import { centralSolicitacoesConfigurada, criarSolicitacaoCentralNegociacao } from '../services/centralSolicitacoesService';

// Opcoes de ajuste de tabela que o time abre para a Verum. Cada uma ja leva um
// roteiro de descricao para o solicitante so completar os dados que faltam.
export const TIPOS_AJUSTE_TABELA = [
  {
    valor: 'Correção de valor de frete',
    descricao: 'Valor de frete divergente na tabela cadastrada.\n\nRota (origem → destino):\nFaixa de peso:\nValor cadastrado hoje:\nValor correto (negociado):\nOnde consta o valor correto (proposta/e-mail/planilha):',
  },
  {
    valor: 'Correção de frete mínimo',
    descricao: 'Frete mínimo divergente na tabela cadastrada.\n\nRota/UF de destino:\nFrete mínimo cadastrado hoje:\nFrete mínimo correto:\nOnde consta o valor correto:',
  },
  {
    valor: 'Correção de faixa de peso',
    descricao: 'Faixas de peso cadastradas não conferem com a tabela negociada.\n\nRota/UF de destino:\nFaixas cadastradas hoje:\nFaixas corretas:\nObservação:',
  },
  {
    valor: 'Correção de taxas e generalidades',
    descricao: 'Taxa/generalidade divergente (GRIS, Ad Valorem, TDE, TDA, pedágio, coringas).\n\nTaxa envolvida:\nValor/percentual cadastrado hoje:\nValor/percentual correto:\nRegra de aplicação (mínimo, por NF, por entrega):',
  },
  {
    valor: 'Inclusão de rota/cidade',
    descricao: 'Rota ou cidade atendida que não está na tabela cadastrada.\n\nOrigem:\nCidade(s)/UF de destino:\nValores negociados:\nPrazo:\nData de início do atendimento:',
  },
  {
    valor: 'Exclusão de rota/cidade',
    descricao: 'Rota ou cidade que não deve mais constar na tabela.\n\nOrigem:\nCidade(s)/UF de destino:\nMotivo da exclusão:\nData a partir de quando deixa de valer:',
  },
  {
    valor: 'Correção de prazo de entrega',
    descricao: 'Prazo de entrega divergente na tabela cadastrada.\n\nRota (origem → destino):\nPrazo cadastrado hoje:\nPrazo correto:\nPrazo é em dias úteis ou corridos:',
  },
  {
    valor: 'Correção de ICMS/tributação',
    descricao: 'Tratamento tributário divergente.\n\nUF de origem / UF de destino:\nRegra cadastrada hoje:\nRegra correta:\nObservação:',
  },
  {
    valor: 'Correção de canal (ATACADO/B2C)',
    descricao: 'Canal da origem/tabela está cadastrado errado.\n\nOrigem:\nCanal cadastrado hoje:\nCanal correto:\nObservação:',
  },
  {
    valor: 'Divergência entre tabela cadastrada e negociada',
    descricao: 'A tabela no sistema não confere com o que foi negociado.\n\nO que está divergente:\nDocumento de referência da negociação:\nData da negociação:\nImpacto identificado:',
  },
  {
    valor: 'Reajuste de tabela',
    descricao: 'Aplicação de reajuste na tabela vigente.\n\nPercentual/índice acordado:\nData de vigência:\nAbrangência (origens/rotas):\nDocumento de referência:',
  },
  {
    valor: 'Cadastro de nova tabela',
    descricao: 'Tabela nova a ser cadastrada.\n\nOrigem(ns):\nAbrangência de destinos:\nCanal:\nData de vigência:\nArquivo/documento da tabela:',
  },
  {
    valor: 'Outro ajuste de tabela',
    descricao: 'Descreva o ajuste necessário:\n\nO que está errado hoje:\nComo deve ficar:\nReferência:',
  },
];

const PRIORIDADES = ['Baixa', 'Média', 'Alta', 'Urgente'];

export default function ModalChamadoAmdTabela({
  open,
  onClose,
  transportadora,
  origens = [],
  origemPadrao = '',
  canalPadrao = '',
  sessao,
  onCriado,
}) {
  const [tipoAjuste, setTipoAjuste] = useState(TIPOS_AJUSTE_TABELA[0].valor);
  const [origem, setOrigem] = useState('');
  const [canal, setCanal] = useState('');
  const [prioridade, setPrioridade] = useState('Média');
  const [descricao, setDescricao] = useState(TIPOS_AJUSTE_TABELA[0].descricao);
  const [descricaoTocada, setDescricaoTocada] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [resultado, setResultado] = useState(null);

  const configurada = centralSolicitacoesConfigurada();
  const transportadoraNome = String(transportadora?.nome || '').trim();

  const origensDisponiveis = useMemo(() => {
    const nomes = (origens || [])
      .map((item) => String(item?.cidade || item?.origem || '').trim())
      .filter(Boolean);
    return [...new Set(nomes)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [origens]);

  useEffect(() => {
    if (!open) return;
    const inicial = TIPOS_AJUSTE_TABELA[0];
    setTipoAjuste(inicial.valor);
    setDescricao(inicial.descricao);
    setDescricaoTocada(false);
    setOrigem(origemPadrao || '');
    setCanal(canalPadrao || '');
    setPrioridade('Média');
    setErro('');
    setResultado(null);
    setEnviando(false);
  }, [open, origemPadrao, canalPadrao]);

  const trocarTipo = (valor) => {
    setTipoAjuste(valor);
    const modelo = TIPOS_AJUSTE_TABELA.find((item) => item.valor === valor);
    // So sobrescreve o texto se o usuario ainda nao escreveu nada proprio.
    if (modelo && !descricaoTocada) setDescricao(modelo.descricao);
  };

  const assunto = [tipoAjuste, transportadoraNome, origem].filter(Boolean).join(' - ');

  const enviar = async () => {
    if (enviando) return;
    const modelo = TIPOS_AJUSTE_TABELA.find((item) => item.valor === tipoAjuste);
    if (!descricao.trim() || descricao.trim() === (modelo?.descricao || '').trim()) {
      setErro('Descreva o ajuste antes de abrir o chamado (preencha os campos do roteiro).');
      return;
    }
    setEnviando(true);
    setErro('');
    try {
      const resposta = await criarSolicitacaoCentralNegociacao({
        tipoSolicitacao: 'GESTÃO E CADASTRO DE TABELA',
        tipoAjuste,
        transportadora: transportadoraNome,
        origem,
        canal,
        prioridade,
        assunto,
        descricao,
        nome: sessao?.nome || '',
        email: sessao?.email || '',
        area: 'Suprimentos',
        mensagemStatus: `Aberto por ${sessao?.nome || 'Central Fretes'} no cadastro de transportadoras.`,
      });
      if (!resposta?.ok) {
        setErro('Central de Solicitações não está configurada neste ambiente.');
        setEnviando(false);
        return;
      }
      setResultado(resposta.solicitacao);
      onCriado?.(resposta.solicitacao);
    } catch (e) {
      setErro(e?.message || 'Não foi possível abrir o chamado na Central de Solicitações.');
    }
    setEnviando(false);
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Abrir chamado AMD · Ajuste de tabela</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>

        {resultado ? (
          <div>
            <div className="mini-feedback success" style={{ marginBottom: 12 }}>
              Chamado aberto na Central de Solicitações.
            </div>
            <div className="hint-box">
              <strong>Protocolo {resultado.protocolo}</strong><br />
              Status: {resultado.status || 'Aberta'}<br />
              Transportadora: {transportadoraNome || '-'}{origem ? ` · Origem: ${origem}` : ''}<br />
              Solicitante: {sessao?.nome || '-'} ({sessao?.email || '-'})
            </div>
            <div className="toolbar-wrap top-space" style={{ justifyContent: 'flex-end' }}>
              <button className="btn-primary" onClick={onClose}>Fechar</button>
            </div>
          </div>
        ) : (
          <div>
            <div className="hint-box compact" style={{ marginBottom: 12 }}>
              <strong>Solicitante:</strong> {sessao?.nome || 'Não identificado'} ({sessao?.email || 'sem e-mail'}) ·{' '}
              <strong>Origem do chamado:</strong> Central Fretes · Cadastro de Transportadoras ·{' '}
              <strong>Transportadora:</strong> {transportadoraNome || 'Não informada'}
            </div>

            {!configurada ? (
              <div className="mini-feedback error" style={{ marginBottom: 12 }}>
                Central de Solicitações não configurada neste ambiente.
              </div>
            ) : null}

            <div className="form-grid three">
              <div className="field">
                <label>Tipo de ajuste</label>
                <select value={tipoAjuste} onChange={(e) => trocarTipo(e.target.value)}>
                  {TIPOS_AJUSTE_TABELA.map((item) => (
                    <option key={item.valor} value={item.valor}>{item.valor}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Origem</label>
                {origensDisponiveis.length ? (
                  <select value={origem} onChange={(e) => setOrigem(e.target.value)}>
                    <option value="">Todas as origens</option>
                    {origensDisponiveis.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                ) : (
                  <input value={origem} onChange={(e) => setOrigem(e.target.value)} placeholder="Cidade de origem" />
                )}
              </div>
              <div className="field">
                <label>Canal</label>
                <select value={canal} onChange={(e) => setCanal(e.target.value)}>
                  <option value="">Não se aplica</option>
                  <option value="ATACADO">ATACADO</option>
                  <option value="B2C">B2C</option>
                  <option value="ATACADO+B2C">ATACADO + B2C</option>
                </select>
              </div>
            </div>

            <div className="form-grid two top-space">
              <div className="field">
                <label>Prioridade</label>
                <select value={prioridade} onChange={(e) => setPrioridade(e.target.value)}>
                  {PRIORIDADES.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Assunto (gerado)</label>
                <input value={assunto} readOnly />
              </div>
            </div>

            <div className="field top-space">
              <label>Descrição do ajuste</label>
              <textarea
                rows={12}
                value={descricao}
                onChange={(e) => { setDescricao(e.target.value); setDescricaoTocada(true); }}
                style={{ width: '100%', fontFamily: 'inherit' }}
              />
              <span style={{ fontSize: 12, color: 'var(--text-muted, #64748b)' }}>
                O roteiro acima já vem preenchido pelo tipo de ajuste. Complete os campos com os dados do caso.
              </span>
            </div>

            {erro ? <div className="mini-feedback error top-space">{erro}</div> : null}

            <div className="toolbar-wrap top-space" style={{ justifyContent: 'flex-end' }}>
              <button className="btn-secondary" onClick={onClose} disabled={enviando}>Cancelar</button>
              <button className="btn-primary" onClick={enviar} disabled={enviando || !configurada || !transportadoraNome}>
                {enviando ? 'Abrindo chamado...' : 'Abrir chamado'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
