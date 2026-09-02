import { useEffect, useState } from 'react';
import {
  carregarConfiguracaoFila,
  finalizarTarefaPesadaAdmin,
  finalizarTarefasTravadasAdmin,
  LIMITE_SEGURO_TAREFA_TRAVADA_MINUTOS,
  listarProcessamentosPesados,
  salvarConfiguracaoFila,
  tarefaPesadaEstaTravada,
} from '../services/processamentoFilaService';
import { carregarSessao, usuarioPodeAdministrarUsuarios } from '../utils/authLocal';

export default function FilaProcessamentoConfig() {
  const [orcamentoItens, setOrcamentoItens] = useState(3000);
  const [limiteTarefasGlobais, setLimiteTarefasGlobais] = useState(2);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const [infoAtual, setInfoAtual] = useState(null);
  const [tarefas, setTarefas] = useState([]);
  const [finalizandoId, setFinalizandoId] = useState('');
  const administrador = usuarioPodeAdministrarUsuarios(carregarSessao());

  const carregarTarefas = async () => {
    const linhas = await listarProcessamentosPesados({ limite: 100 });
    setTarefas(linhas.filter((item) => ['PROCESSANDO', 'AGUARDANDO'].includes(item.status)));
  };

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

  useEffect(() => {
    let ativo = true;
    const atualizar = () => carregarTarefas().catch((error) => { if (ativo) setErro(error.message || 'Erro ao carregar tarefas.'); });
    atualizar();
    const timer = window.setInterval(atualizar, 10000);
    return () => { ativo = false; window.clearInterval(timer); };
  }, []);

  const confirmarFinalizacao = async (tarefa) => {
    if (!administrador) return;
    const motivo = window.prompt(`Motivo para finalizar "${tarefa.titulo}"?\n\nO histórico será preservado e a tarefa ficará como CANCELADO.`);
    if (!motivo?.trim()) return;
    if (!window.confirm(`Confirmar a finalização administrativa?\n\n${tarefa.titulo}\nProgresso: ${tarefa.itens_processados || 0}/${tarefa.total_itens || '?'}\nMotivo: ${motivo.trim()}\n\nA vaga e o orçamento serão liberados imediatamente.`)) return;
    setFinalizandoId(tarefa.id); setErro(''); setMensagem('');
    try {
      await finalizarTarefaPesadaAdmin(tarefa.id, motivo);
      setMensagem(`Tarefa "${tarefa.titulo}" finalizada como CANCELADO. Histórico preservado.`);
      await carregarTarefas();
    } catch (error) { setErro(error.message || 'Erro ao finalizar tarefa.'); }
    finally { setFinalizandoId(''); }
  };

  const travadas = tarefas.filter((item) => tarefaPesadaEstaTravada(item));
  const finalizarTravadas = async () => {
    if (!administrador || !travadas.length) return;
    const motivo = window.prompt(`Motivo para finalizar ${travadas.length} tarefa(s) sem progresso há pelo menos ${LIMITE_SEGURO_TAREFA_TRAVADA_MINUTOS} minutos?`);
    if (!motivo?.trim()) return;
    if (!window.confirm(`Confirmar a finalização de ${travadas.length} tarefa(s) travada(s)?\n\nElas serão marcadas como CANCELADO; nenhum histórico será apagado.`)) return;
    setFinalizandoId('travadas'); setErro(''); setMensagem('');
    try {
      const finalizadas = await finalizarTarefasTravadasAdmin(motivo);
      setMensagem(`${finalizadas.length} tarefa(s) travada(s) finalizada(s).`);
      await carregarTarefas();
    } catch (error) { setErro(error.message || 'Erro ao finalizar tarefas travadas.'); }
    finally { setFinalizandoId(''); }
  };

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

      {administrador && (
        <div style={{ marginTop: 24, paddingTop: 18, borderTop: '1px solid var(--border-soft)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div><strong>Tarefas ativas</strong><div style={{ fontSize: 12, color: 'var(--muted)' }}>A ação cancela a tarefa e preserva seu histórico.</div></div>
            <button type="button" onClick={finalizarTravadas} disabled={!travadas.length || Boolean(finalizandoId)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #b91c1c', background: travadas.length ? '#fff' : '#f8fafc', color: travadas.length ? '#b91c1c' : '#94a3b8', fontWeight: 700 }}>
              {finalizandoId === 'travadas' ? 'Finalizando...' : `Finalizar tarefas travadas (${travadas.length})`}
            </button>
          </div>
          <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
            {!tarefas.length && <div style={{ color: 'var(--muted)', fontSize: 13 }}>Nenhuma tarefa processando ou aguardando.</div>}
            {tarefas.map((tarefa) => <div key={tarefa.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: 12, border: '1px solid var(--border-soft)', borderRadius: 8 }}>
              <div><strong>{tarefa.titulo}</strong><div style={{ fontSize: 12, color: 'var(--muted)' }}>{tarefa.status} · {Number(tarefa.itens_processados || 0).toLocaleString('pt-BR')}/{Number(tarefa.total_itens || 0).toLocaleString('pt-BR')} · {tarefa.usuario_nome || 'Usuário'}{tarefaPesadaEstaTravada(tarefa) ? ' · SEM PROGRESSO' : ''}</div></div>
              <button type="button" onClick={() => confirmarFinalizacao(tarefa)} disabled={Boolean(finalizandoId)} style={{ padding: '7px 11px', borderRadius: 8, border: '1px solid #b91c1c', background: '#fff', color: '#b91c1c', fontWeight: 700, whiteSpace: 'nowrap' }}>
                {finalizandoId === tarefa.id ? 'Finalizando...' : 'Finalizar tarefa'}
              </button>
            </div>)}
          </div>
        </div>
      )}
    </div>
  );
}
