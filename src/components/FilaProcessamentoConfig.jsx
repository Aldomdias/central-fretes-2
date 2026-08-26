import { useEffect, useState } from 'react';
import { carregarConfiguracaoFila, salvarConfiguracaoFila } from '../services/processamentoFilaService';

export default function FilaProcessamentoConfig() {
  const [orcamentoItens, setOrcamentoItens] = useState(3000);
  const [limiteTarefasGlobais, setLimiteTarefasGlobais] = useState(2);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const [infoAtual, setInfoAtual] = useState(null);

  useEffect(() => {
    let ativo = true;
    carregarConfiguracaoFila().then((config) => {
      if (!ativo) return;
      setOrcamentoItens(config.orcamentoItens);
      setLimiteTarefasGlobais(config.limiteTarefasGlobais);
      setInfoAtual(config);
      setCarregando(false);
    }).catch((error) => {
      if (ativo) { setErro(error.message || 'Erro ao carregar configuração.'); setCarregando(false); }
    });
    return () => { ativo = false; };
  }, []);

  const salvar = async () => {
    setSalvando(true);
    setMensagem('');
    setErro('');
    try {
      await salvarConfiguracaoFila({ orcamentoItens, limiteTarefasGlobais });
      setMensagem('Configuração salva. Vale para a próxima tarefa que entrar na fila.');
    } catch (error) {
      setErro(error.message || 'Erro ao salvar.');
    } finally {
      setSalvando(false);
    }
  };

  if (carregando) return <div style={{ padding: 20, color: 'var(--muted)' }}>Carregando configuração da fila...</div>;

  return (
    <div style={{ padding: '4px 20px 20px' }}>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>
        Auditoria e Simulação (Suprimentos) compartilham a mesma fila de processamento pesado.
        Em vez de contar só quantas tarefas estão rodando, o sistema soma o tamanho (quantidade de CT-es)
        das tarefas em andamento e compara com o orçamento abaixo — assim várias tarefas pequenas cabem
        juntas, e tarefas grandes ocupam mais espaço.
      </p>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', margin: '16px 0' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
          Orçamento de itens simultâneos
          <input
            type="number"
            min={1}
            value={orcamentoItens}
            onChange={(e) => setOrcamentoItens(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-soft)', width: 180 }}
          />
          <span style={{ fontWeight: 400, color: 'var(--muted)' }}>
            Ex.: 3000 = cabe 1 tarefa de 3000, 2 de 1500, ou 15 de 200 rodando ao mesmo tempo.
          </span>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
          Máximo de tarefas simultâneas (teto)
          <input
            type="number"
            min={1}
            max={20}
            value={limiteTarefasGlobais}
            onChange={(e) => setLimiteTarefasGlobais(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-soft)', width: 180 }}
          />
          <span style={{ fontWeight: 400, color: 'var(--muted)' }}>
            Vale mesmo se o orçamento de itens ainda tiver espaço sobrando.
          </span>
        </label>
      </div>

      {erro && <div style={{ padding: 10, borderRadius: 8, background: '#fef2f2', color: '#b91c1c', marginBottom: 12 }}>{erro}</div>}
      {mensagem && <div style={{ padding: 10, borderRadius: 8, background: '#dcfce7', color: '#166534', marginBottom: 12 }}>{mensagem}</div>}

      <button
        type="button"
        onClick={salvar}
        disabled={salvando}
        style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 700, cursor: salvando ? 'default' : 'pointer', opacity: salvando ? 0.7 : 1 }}
      >
        {salvando ? 'Salvando...' : 'Salvar configuração'}
      </button>

      {infoAtual?.atualizadoPor && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
          Último ajuste por {infoAtual.atualizadoPor}
          {infoAtual.atualizadoEm ? ` em ${new Date(infoAtual.atualizadoEm).toLocaleString('pt-BR')}` : ''}.
        </div>
      )}
    </div>
  );
}
