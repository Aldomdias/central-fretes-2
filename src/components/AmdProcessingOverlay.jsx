import amdLogo from '../assets/amd-log.png';

export const ETAPA_LABEL_AUDITORIA = {
  carregando_tabelas: 'Carregando tabelas cadastradas',
  carregando_tabelas_rotas: 'Carregando tabelas pelas rotas dos CT-es',
  carregando_tabelas_transportadora: 'Carregando tabela da transportadora',
  carregando_tabelas_completas_fallback: 'Carregando base completa de tabelas',
  processando_ctes: 'Recalculando CT-es',
  cruzando_tracking: 'Cruzando CT-es com o Tracking',
  localizando_existentes: 'Localizando CT-es já salvos',
  resimulando: 'Resimulando recorte',
  buscando_ctes: 'Buscando CT-es',
  salvando_faturas: 'Gravando faturas e CT-es',
  verificando_existentes: 'Verificando faturas já existentes',
  calculando_amd: 'Calculando status AMD',
  atualizando_faturas: 'Atualizando status AMD nas faturas',
  salvando_resultado_detalhado: 'Salvando resultados',
  salvando_resultados: 'Salvando resultados',
  limpando_resultado_anterior: 'Limpando resultado anterior',
  carregando_resultado_salvo: 'Carregando resultado salvo',
  concluido: 'Concluído',
};

export function rotuloEtapaAuditoria(progresso) {
  return ETAPA_LABEL_AUDITORIA[progresso?.etapa]
    || String(progresso?.etapa || 'Processando').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Overlay central com a logo AMD LOG — mostra etapa atual e percentual por
// cima do resto da tela enquanto processa. Usado no Simulador, Auditoria CTe
// e na importação de Faturas.
export default function AmdProcessingOverlay({ ativo, progresso, mensagemRodape = 'Pode levar mais tempo em bases grandes.' }) {
  if (!ativo) return null;

  const carregados = Number(progresso?.carregados || 0);
  const total = Number(progresso?.total || 0);
  const determinada = total > 0;
  // Sem total conhecido, sobe o percentual devagar conforme os registros vão
  // chegando (em vez de ficar travado num número fixo, o que parecia travamento).
  const percentual = determinada
    ? Math.min(100, Math.round((carregados / total) * 100))
    : Math.min(90, 8 + Math.round(Math.log10(carregados + 1) * 15));
  const etapa = rotuloEtapaAuditoria(progresso);
  const mensagem = determinada
    ? `${carregados.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')}`
    : carregados > 0
      ? `${carregados.toLocaleString('pt-BR')} registro(s) carregado(s)...`
      : 'Aguardando resposta do banco...';

  return (
    <div className="brand-processing-overlay" role="status" aria-live="polite">
      <div className="brand-processing-card">
        <div className="brand-processing-logo-wrap">
          <img src={amdLogo} alt="AMD LOG" />
        </div>
        <strong>{etapa}…</strong>
        <span>{mensagem}</span>
        <div className="brand-processing-bar" aria-hidden="true">
          <div style={{ width: `${Math.max(6, Math.min(percentual, 100))}%` }} />
        </div>
        <em>{percentual}%</em>
        <small>{mensagemRodape}</small>
      </div>
    </div>
  );
}
