import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { carregarSessao, usuarioPodeAdministrarUsuarios } from '../utils/authLocal';

export const TAMANHO_LOTE_PESADO = 200;
export const LIMITE_GLOBAL_PROCESSAMENTOS = 2;
const INTERVALO_FILA_MS = 10000;
const LIMITE_FALHAS_TRANSITORIAS = 6;
export const LIMITE_SEGURO_TAREFA_TRAVADA_MINUTOS = 15;
const tarefasCanceladas = new Set();

export function verificarTarefaPesadaAtiva(id) {
  if (id && tarefasCanceladas.has(id)) {
    throw new Error('Tarefa cancelada administrativamente. O processamento foi interrompido.');
  }
}

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cliente() {
  if (!isSupabaseConfigured()) return null;
  return getSupabaseClient();
}

function sessaoObrigatoria() {
  const sessao = carregarSessao();
  if (!sessao?.id) throw new Error('Sessao do usuario nao encontrada para entrar na fila.');
  return sessao;
}

export async function criarProcessamentoPesado({ tipo, titulo, totalItens = 0, metadados = {} }) {
  const supabase = cliente();
  if (!supabase) return null;
  const usuario = sessaoObrigatoria();
  const total = Math.max(0, Number(totalItens) || 0);
  const { data, error } = await supabase.from('processamentos_pesados').insert({
    tipo,
    titulo,
    usuario_id: usuario.id,
    usuario_nome: usuario.nome || usuario.email,
    usuario_email: usuario.email || '',
    total_itens: total,
    tamanho_lote: TAMANHO_LOTE_PESADO,
    total_lotes: total ? Math.ceil(total / TAMANHO_LOTE_PESADO) : 0,
    metadados,
  }).select('*').single();
  if (error) throw new Error(`Nao foi possivel entrar na fila: ${error.message}`);
  return data;
}

export async function aguardarVezProcessamento(id, onStatus) {
  const supabase = cliente();
  if (!supabase || !id) return null;
  let falhasTransitorias = 0;
  let ciclos = 0;
  while (true) {
    const { data, error } = await supabase.rpc('tentar_iniciar_processamento_pesado', {
      p_id: id,
      p_limite_global: null,
    });
    if (error) {
      // Timeout/erro transitorio do banco (ex: pico de uso) nunca deve derrubar
      // quem so esta esperando a vez — continua tentando pra sempre. So um
      // erro real (nao-transitorio) interrompe a espera.
      const transitorio = /timeout|57014|connection|network|fetch/i.test(error.message || '');
      if (transitorio) {
        falhasTransitorias += 1;
        onStatus?.({ etapa: 'aguardando_fila', posicao: 1, avisoTransitorio: true });
        if (falhasTransitorias >= LIMITE_FALHAS_TRANSITORIAS) {
          throw new Error('A fila esta temporariamente indisponivel. Aguarde a base estabilizar e tente novamente.');
        }
        await esperar(INTERVALO_FILA_MS);
        continue;
      }
      throw new Error(`Falha ao consultar a fila: ${error.message}`);
    }
    const registro = Array.isArray(data) ? data[0] : data;
    falhasTransitorias = 0;
    ciclos += 1;
    if (!registro) throw new Error('A tarefa desapareceu da fila.');
    if (registro.status === 'PROCESSANDO') return registro;
    if (['CANCELADO', 'ERRO', 'INTERROMPIDO'].includes(registro.status)) {
      throw new Error(registro.erro || `Tarefa encerrada com status ${registro.status}.`);
    }
    let posicao = 1;
    let emAndamento = [];
    // Os detalhes visuais deixam de gerar duas consultas extras a cada ciclo.
    if (ciclos === 1 || ciclos % 3 === 0) {
      const { count } = await supabase.from('processamentos_pesados')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'AGUARDANDO')
        .or(`prioridade.lt.${registro.prioridade},and(prioridade.eq.${registro.prioridade},criado_em.lt.${registro.criado_em})`);
      const { data } = await supabase.from('processamentos_pesados')
        .select('titulo,tipo,usuario_nome,total_itens,itens_processados,etapa,heartbeat_em')
        .eq('status', 'PROCESSANDO')
        .order('iniciado_em', { ascending: true });
      posicao = (count || 0) + 1;
      emAndamento = data || [];
    }
    onStatus?.({ ...registro, posicao, emAndamento });
    await esperar(INTERVALO_FILA_MS);
  }
}

export async function atualizarProcessamentoPesado(id, progresso = {}) {
  const supabase = cliente();
  if (!supabase || !id) return;
  verificarTarefaPesadaAtiva(id);
  const temProcessados = progresso.carregados !== undefined || progresso.itensProcessados !== undefined;
  const processados = Math.max(0, Number(progresso.carregados ?? progresso.itensProcessados) || 0);
  const total = Math.max(0, Number(progresso.total) || 0);
  const patch = {
    heartbeat_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
    etapa: progresso.etapa || 'processando',
  };
  if (temProcessados) {
    patch.itens_processados = processados;
    patch.lote_atual = processados ? Math.ceil(processados / TAMANHO_LOTE_PESADO) : 0;
  }
  if (total) {
    patch.total_itens = total;
    patch.total_lotes = Math.ceil(total / TAMANHO_LOTE_PESADO);
  }
  const { data, error } = await supabase.from('processamentos_pesados').update(patch)
    .eq('id', id).eq('status', 'PROCESSANDO').select('id');
  if (error) console.warn('[Fila] Nao foi possivel atualizar o progresso:', error.message);
  if (!error && !(data || []).length) {
    const { data: atual } = await supabase.from('processamentos_pesados').select('status').eq('id', id).maybeSingle();
    if (atual?.status === 'CANCELADO') tarefasCanceladas.add(id);
  }
}

export async function finalizarProcessamentoPesado(id, status = 'CONCLUIDO', erro = null) {
  const supabase = cliente();
  if (!supabase || !id) return;
  if (tarefasCanceladas.has(id)) return;
  const { error: falha } = await supabase.from('processamentos_pesados').update({
    status,
    erro,
    finalizado_em: new Date().toISOString(),
    heartbeat_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
  }).eq('id', id).eq('status', 'PROCESSANDO');
  if (falha) console.warn('[Fila] Nao foi possivel finalizar a tarefa:', falha.message);
}

export async function executarComFila(config, executor, onStatus) {
  const tarefa = await criarProcessamentoPesado(config);
  if (!tarefa) return executor({ id: null, atualizar: () => {} });
  try {
    await aguardarVezProcessamento(tarefa.id, onStatus);
    onStatus?.({ ...tarefa, status: 'PROCESSANDO', posicao: 0 });
    const resultado = await executor({
      id: tarefa.id,
      atualizar: (progresso) => {
        verificarTarefaPesadaAtiva(tarefa.id);
        return atualizarProcessamentoPesado(tarefa.id, progresso);
      },
    });
    await finalizarProcessamentoPesado(tarefa.id, 'CONCLUIDO');
    return resultado;
  } catch (error) {
    await finalizarProcessamentoPesado(tarefa.id, 'ERRO', error?.message || String(error));
    throw error;
  }
}

export async function listarProcessamentosPesados({ limite = 200 } = {}) {
  const supabase = cliente();
  if (!supabase) return [];
  const { data, error } = await supabase.from('processamentos_pesados').select('*')
    .order('criado_em', { ascending: false }).limit(limite);
  if (error) throw new Error(`Nao foi possivel carregar a fila: ${error.message}`);
  return data || [];
}

function administradorAtual() {
  const usuario = sessaoObrigatoria();
  if (!usuarioPodeAdministrarUsuarios(usuario)) {
    throw new Error('Somente o administrador pode finalizar tarefas pesadas.');
  }
  return usuario;
}

export function tarefaPesadaEstaTravada(tarefa, limiteMinutos = LIMITE_SEGURO_TAREFA_TRAVADA_MINUTOS) {
  if (!['PROCESSANDO', 'AGUARDANDO'].includes(tarefa?.status)) return false;
  const referencia = new Date(tarefa.heartbeat_em || tarefa.criado_em || 0).getTime();
  return Number.isFinite(referencia) && Date.now() - referencia >= Math.max(10, limiteMinutos) * 60000;
}

export async function finalizarTarefaPesadaAdmin(id, motivo) {
  const supabase = cliente();
  if (!supabase) throw new Error('Supabase nao configurado.');
  const admin = administradorAtual();
  const { data, error } = await supabase.rpc('finalizar_tarefa_pesada_admin', {
    p_id: id,
    p_admin_id: admin.id,
    p_admin_email: admin.email,
    p_motivo: String(motivo || '').trim(),
  });
  if (error) throw new Error(`Nao foi possivel finalizar a tarefa: ${error.message}`);
  tarefasCanceladas.add(id);
  return Array.isArray(data) ? data[0] : data;
}

export async function finalizarTarefasTravadasAdmin(motivo, limiteMinutos = LIMITE_SEGURO_TAREFA_TRAVADA_MINUTOS) {
  const supabase = cliente();
  if (!supabase) throw new Error('Supabase nao configurado.');
  const admin = administradorAtual();
  const { data, error } = await supabase.rpc('finalizar_tarefas_pesadas_travadas_admin', {
    p_admin_id: admin.id,
    p_admin_email: admin.email,
    p_motivo: String(motivo || '').trim(),
    p_limite_minutos: Math.max(10, Number(limiteMinutos) || LIMITE_SEGURO_TAREFA_TRAVADA_MINUTOS),
  });
  if (error) throw new Error(`Nao foi possivel finalizar tarefas travadas: ${error.message}`);
  (data || []).forEach((item) => tarefasCanceladas.add(item.id));
  return data || [];
}

export async function carregarConfiguracaoFila() {
  const supabase = cliente();
  if (!supabase) return { orcamentoItens: 3000, limiteTarefasGlobais: LIMITE_GLOBAL_PROCESSAMENTOS };
  const { data, error } = await supabase.from('fila_configuracao').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error(`Nao foi possivel carregar a configuracao da fila: ${error.message}`);
  return {
    orcamentoItens: data?.orcamento_itens ?? 3000,
    limiteTarefasGlobais: data?.limite_tarefas_globais ?? LIMITE_GLOBAL_PROCESSAMENTOS,
    atualizadoEm: data?.atualizado_em || null,
    atualizadoPor: data?.atualizado_por || null,
  };
}

export async function salvarConfiguracaoFila({ orcamentoItens, limiteTarefasGlobais }) {
  const supabase = cliente();
  if (!supabase) throw new Error('Supabase nao configurado.');
  const usuario = sessaoObrigatoria();
  const { error } = await supabase.from('fila_configuracao').update({
    orcamento_itens: Math.max(1, Number(orcamentoItens) || 3000),
    limite_tarefas_globais: Math.max(1, Math.min(20, Number(limiteTarefasGlobais) || 2)),
    atualizado_em: new Date().toISOString(),
    atualizado_por: usuario.nome || usuario.email || usuario.id,
  }).eq('id', 1);
  if (error) throw new Error(`Nao foi possivel salvar a configuracao da fila: ${error.message}`);
}
