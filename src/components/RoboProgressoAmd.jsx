import AmdProcessingOverlay from './AmdProcessingOverlay';

const ETAPA_POR_FASE = {
  lendo: 'robo_lendo',
  corrigindo_tracking: 'robo_corrigindo_tracking',
  calculando: 'robo_calculando',
  apurando: 'robo_apurando',
};

// Tela de status AMD do Robo Auditor: mostra a fatura em andamento, a fase (lendo / calculando /
// apurando) e o avanco do lote, com botao para parar apos a fatura atual.
// atual/total = posicao no lote; ctAtual/ctTotal = avanco dos CT-es da fatura (quando calculando).
export default function RoboProgressoAmd({ ativo, atual = 1, total = 1, numero = '', faseId = 'lendo', ctAtual = 0, ctTotal = 0, enviadas = null, titulo = '', onParar = null }) {
  if (!ativo) return null;
  const fracao = faseId === 'calculando' && ctTotal > 0 ? Math.min(ctAtual / ctTotal, 1) : (faseId === 'apurando' ? 0.9 : 0.05);
  const detalhe = [
    titulo || `Fatura ${numero}`,
    total > 1 ? `(${atual} de ${total})` : '',
    faseId === 'calculando' && ctTotal > 0 ? `— CT-es ${ctAtual}/${ctTotal}` : '',
    enviadas != null ? `· ${enviadas} enviada(s) para a gestao` : '',
  ].filter(Boolean).join(' ');
  return (
    <AmdProcessingOverlay
      ativo
      progresso={{ etapa: ETAPA_POR_FASE[faseId] || 'robo_lendo', carregados: (atual - 1) + fracao, total: Math.max(total, 1) }}
      detalhe={detalhe}
      mensagemRodape="O robo calcula os CT-es, apura desconto e entrega e envia para a gestao as faturas corretas."
      onCancelar={onParar}
    />
  );
}
