// Leitura automatica do painel de consumo: aponta onde esta o peso e o que fazer.
// Funcao pura (sem rede) para poder testar. Entrada = retorno de telemetria_painel
// (+ opcional telemetria_armazenamento).

const MB = 1048576;
const num = (v) => Number(v) || 0;

export function formatarBytes(bytes) {
  const b = num(bytes);
  if (b >= 1073741824) return `${(b / 1073741824).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} GB`;
  if (b >= MB) return `${(b / MB).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
  if (b >= 1024) return `${Math.round(b / 1024).toLocaleString('pt-BR')} KB`;
  return `${b.toLocaleString('pt-BR')} B`;
}

export function formatarSegundos(segundos) {
  const s = Math.max(0, Math.round(num(segundos)));
  if (s < 60) return `${s}s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return `${h}h${resto ? ` ${String(resto).padStart(2, '0')}min` : ''}`;
}

export function formatarMs(ms) {
  const v = num(ms);
  if (v < 1000) return `${Math.round(v)} ms`;
  return formatarSegundos(v / 1000);
}

function rotuloTipo(tipo) {
  return {
    AUDITORIA_CTE: 'Auditoria de CT-e (resimular)',
    AUDITORIA_CTE_AVULSA: 'Auditoria de CT-es avulsos',
    SIMULACAO_SUPRIMENTOS: 'Simulação (fila)',
    SIMULACAO_REALIZADO: 'Simulação do realizado',
    IMPORTACAO_FATURAS_VERUM: 'Importação de faturas Verum',
    TELA: 'Ação pesada de tela (automático)',
  }[tipo] || tipo;
}
export { rotuloTipo };

// Cada recomendacao: { nivel: 'critico'|'atencao'|'info', area, titulo, detalhe, acao }
export function gerarRecomendacoes(painel = {}, armazenamento = null) {
  const recs = [];
  const totais = painel.totais || {};
  const usuarios = painel.usuarios || [];
  const paginas = painel.paginas || [];
  const tabelas = painel.tabelas || [];
  const tipos = painel.processos_tipo || [];
  const porHora = painel.por_hora || [];
  const bytesTotal = num(totais.bytes_recebidos);
  const cpuTotal = num(totais.ms_cpu_travada);

  // Processos grandes demais por execucao.
  tipos.forEach((t) => {
    if (t.tipo === 'TELA') return;
    const msMedio = num(t.ms_medio);
    const itensMax = num(t.itens_max);
    const msPorItem = num(t.itens) ? num(t.ms_total) / num(t.itens) : 0;
    if (itensMax >= 3000 || msMedio >= 10 * 60000) {
      const auditoria = /AUDITORIA/.test(t.tipo);
      recs.push({
        nivel: msMedio >= 20 * 60000 || itensMax >= 10000 ? 'critico' : 'atencao',
        area: 'Processos',
        titulo: `${rotuloTipo(t.tipo)}: execuções muito grandes`,
        detalhe: `Até ${itensMax.toLocaleString('pt-BR')} itens numa execução; média de ${formatarMs(msMedio)} (pior ${formatarMs(t.ms_max)})${msPorItem ? `, ~${Math.round(msPorItem)} ms por item` : ''}.`,
        acao: auditoria
          ? 'Dividir por transportadora e por competência (lotes de até ~2.000 CT-es), rodar fora do horário de pico e preferir o robô auditor para volumes grandes.'
          : 'Quebrar a execução em partes menores (por origem/período) e rodar fora do horário de pico.',
      });
    }
    if (num(t.heap_mb_pico) >= 1500) {
      recs.push({
        nivel: num(t.heap_mb_pico) >= 2500 ? 'critico' : 'atencao',
        area: 'Memória (RAM)',
        titulo: `${rotuloTipo(t.tipo)} chega a ${Math.round(num(t.heap_mb_pico)).toLocaleString('pt-BR')} MB de RAM`,
        detalhe: 'Acima de ~2 GB o navegador fica lento ou fecha a aba ("Ah, não!").',
        acao: 'Processar em lotes menores e não manter todos os registros carregados na tela ao mesmo tempo.',
      });
    }
    if (num(t.falhas) >= 3 && num(t.falhas) / Math.max(1, num(t.execucoes)) >= 0.2) {
      recs.push({
        nivel: 'atencao', area: 'Processos',
        titulo: `${rotuloTipo(t.tipo)}: ${t.falhas} de ${t.execucoes} execuções falharam`,
        detalhe: 'Falha recorrente costuma ser timeout do banco ou memória.',
        acao: 'Ver a lista de processos (coluna erro) e reduzir o recorte.',
      });
    }
  });

  // Tabelas que concentram download / timeout.
  tabelas.slice(0, 15).forEach((t) => {
    const parte = bytesTotal ? num(t.bytes_recebidos) / bytesTotal : 0;
    if (parte >= 0.25 && num(t.bytes_recebidos) >= 50 * MB) {
      recs.push({
        nivel: parte >= 0.5 ? 'critico' : 'atencao',
        area: 'Banco',
        titulo: `${t.tabela} = ${Math.round(parte * 100)}% de tudo que foi baixado`,
        detalhe: `${formatarBytes(t.bytes_recebidos)} em ${num(t.requisicoes).toLocaleString('pt-BR')} consultas; quem mais puxa: ${t.usuario_top || '-'} (tela ${t.pagina_top || '-'}).`,
        acao: 'Selecionar só as colunas usadas, filtrar no banco (período/UF/canal), paginar ou trocar por um resumo (RPC/visão agregada) e guardar em cache local.',
      });
    }
    if (num(t.timeouts) >= 3) {
      recs.push({
        nivel: num(t.timeouts) >= 20 ? 'critico' : 'atencao',
        area: 'Banco',
        titulo: `${t.tabela}: ${t.timeouts} timeouts`,
        detalhe: `Consulta passa do tempo limite do banco (média ${formatarMs(num(t.ms_rede) / Math.max(1, num(t.requisicoes)))}).`,
        acao: 'Revisar filtro (evitar ilike em colunas grandes), criar índice na coluna filtrada ou mover para RPC com recorte.',
      });
    }
  });

  // Telas que travam o navegador (CPU).
  paginas.forEach((p) => {
    const cpu = num(p.ms_cpu_travada);
    if (cpu >= 5 * 60000 || (cpuTotal && cpu / cpuTotal >= 0.4 && cpu >= 60000)) {
      recs.push({
        nivel: cpu >= 30 * 60000 ? 'critico' : 'atencao',
        area: 'Processamento (CPU)',
        titulo: `${p.pagina_label || p.pagina}: ${formatarMs(cpu)} de navegador travado`,
        detalhe: `${num(p.usuarios)} usuário(s); ${cpuTotal ? Math.round((cpu / cpuTotal) * 100) : 0}% de todo o travamento medido.`,
        acao: 'Cálculo pesado roda na tela: levar para Web Worker / servidor (RPC) ou processar em blocos cedendo a thread.',
      });
    }
  });

  // Usuarios fora da curva.
  const comDados = usuarios.filter((u) => num(u.bytes_recebidos) > 0);
  if (comDados.length >= 3) {
    const media = comDados.reduce((s, u) => s + num(u.bytes_recebidos), 0) / comDados.length;
    comDados.forEach((u) => {
      if (num(u.bytes_recebidos) >= media * 3 && num(u.bytes_recebidos) >= 200 * MB) {
        recs.push({
          nivel: 'atencao', area: 'Usuários',
          titulo: `${u.usuario_nome}: ${formatarBytes(u.bytes_recebidos)} baixados (${(num(u.bytes_recebidos) / media).toFixed(1)}x a média)`,
          detalhe: `Tela que mais pesa: ${u.pagina_top || '-'}; ${num(u.processos)} processo(s), ${num(u.itens_processos).toLocaleString('pt-BR')} itens.`,
          acao: 'Ver com a pessoa o recorte usado (período/transportadora) e se dá para trabalhar com filtros menores.',
        });
      }
    });
  }
  usuarios.forEach((u) => {
    const online = num(u.segundos_online);
    const ocioso = num(u.segundos_ocioso) + num(u.segundos_oculto);
    if (online >= 4 * 3600 && ocioso / online >= 0.7) {
      recs.push({
        nivel: 'info', area: 'Usuários',
        titulo: `${u.usuario_nome}: ${Math.round((ocioso / online) * 100)}% do tempo conectado sem uso`,
        detalhe: `${formatarSegundos(online)} online, só ${formatarSegundos(u.segundos_ativo)} ativo. Abas paradas seguem consumindo conexão (presença/avisos).`,
        acao: 'Orientar a fechar abas que não estão em uso.',
      });
    }
    if (num(u.memoria_aparelho_gb) && num(u.memoria_aparelho_gb) <= 4 && num(u.heap_mb_max) >= 800) {
      recs.push({
        nivel: 'atencao', area: 'Usuários',
        titulo: `${u.usuario_nome}: máquina com ${u.memoria_aparelho_gb} GB de RAM usando ${Math.round(num(u.heap_mb_max))} MB no sistema`,
        detalhe: 'Equipamento no limite para os processos que essa pessoa roda.',
        acao: 'Rodar os processos pesados dessa pessoa pelo robô/servidor ou avaliar troca de máquina.',
      });
    }
  });

  // Horario de pico.
  if (porHora.length >= 6) {
    const pico = [...porHora].sort((a, b) => num(b.ms_cpu_travada) + num(b.bytes_recebidos) / 10000 - (num(a.ms_cpu_travada) + num(a.bytes_recebidos) / 10000))[0];
    if (pico) {
      const h = new Date(pico.hora);
      recs.push({
        nivel: 'info', area: 'Agenda',
        titulo: `Horário de maior carga: ${h.toLocaleDateString('pt-BR')} ${String(h.getHours()).padStart(2, '0')}h`,
        detalhe: `${num(pico.usuarios)} usuário(s), ${formatarBytes(pico.bytes_recebidos)} baixados, ${formatarMs(pico.ms_cpu_travada)} de CPU travada.`,
        acao: 'Evitar disparar auditorias/simulações grandes nesse horário.',
      });
    }
  }

  // Armazenamento.
  if (armazenamento?.tabelas?.length) {
    const totalBanco = num(armazenamento.banco_total_bytes);
    armazenamento.tabelas.slice(0, 5).forEach((t) => {
      const parte = totalBanco ? num(t.total_bytes) / totalBanco : 0;
      if (parte >= 0.2) {
        recs.push({
          nivel: parte >= 0.4 ? 'atencao' : 'info', area: 'Armazenamento',
          titulo: `${t.tabela} ocupa ${formatarBytes(t.total_bytes)} (${Math.round(parte * 100)}% do banco)`,
          detalhe: `${num(t.linhas_estimadas).toLocaleString('pt-BR')} linhas; índices ${formatarBytes(t.indices_bytes)}.`,
          acao: 'Avaliar arquivar períodos antigos, remover colunas/JSON não usados e índices duplicados.',
        });
      }
    });
  }

  const peso = { critico: 0, atencao: 1, info: 2 };
  return recs.sort((a, b) => peso[a.nivel] - peso[b.nivel]);
}
