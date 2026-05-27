// ============================================================
// SlaAuditoriaConfig.jsx
// Componente de configuração de SLA e alertas da Auditoria
// Para ser incluído dentro de FerramentasPage
// Acessível apenas para perfil GESTAO
//
// Instrução ao Codex:
// 1. Copie este arquivo para src/components/SlaAuditoriaConfig.jsx
// 2. Em FerramentasPage.jsx, importe e adicione o componente
//    dentro de uma aba ou seção de "Configurações de Auditoria"
//    visível apenas quando usuario.perfil === 'GESTAO'
// ============================================================

import { useEffect, useState } from 'react';
import {
  carregarSlaConfigSupabase,
  salvarSlaConfigSupabase,
} from '../services/lotacaoSupabaseService';
import { carregarSessao } from '../utils/authLocal';

function parseEmails(str) {
  if (Array.isArray(str)) return str;
  return String(str || '').split(/[,;\n]/).map((e) => e.trim()).filter(Boolean);
}

function emailsParaString(arr) {
  if (!arr) return '';
  return Array.isArray(arr) ? arr.join('\n') : String(arr);
}

export default function SlaAuditoriaConfig({ canal = 'LOTACAO' }) {
  const sessao = carregarSessao();

  const [config, setConfig] = useState({
    prazo_alerta_operacao_h: 24,
    prazo_escalonamento_dias: 2,
    emails_operacao: [],
    emails_gerencia: [],
    emails_diretoria: [],
    envio_email_ativo: true,
    alerta_visual_ativo: true,
    mensagem_padrao_email: 'Existem pendências de auditoria aguardando sua aprovação.',
    canal_modulo: canal,
  });

  const [emailsOpStr, setEmailsOpStr] = useState('');
  const [emailsGerStr, setEmailsGerStr] = useState('');
  const [emailsDirStr, setEmailsDirStr] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    carregarSlaConfigSupabase(canal)
      .then((cfg) => {
        if (cfg) {
          setConfig(cfg);
          setEmailsOpStr(emailsParaString(cfg.emails_operacao));
          setEmailsGerStr(emailsParaString(cfg.emails_gerencia));
          setEmailsDirStr(emailsParaString(cfg.emails_diretoria));
        }
      })
      .catch((err) => setMensagem(`Erro ao carregar config: ${err.message}`))
      .finally(() => setCarregando(false));
  }, [canal]);

  if (sessao?.perfil !== 'GESTAO') {
    return (
      <div className="hint-box compact">
        Configurações de SLA disponíveis apenas para gestores.
      </div>
    );
  }

  const salvar = async () => {
    setSalvando(true);
    setMensagem('');
    try {
      const payload = {
        ...config,
        emails_operacao: parseEmails(emailsOpStr),
        emails_gerencia: parseEmails(emailsGerStr),
        emails_diretoria: parseEmails(emailsDirStr),
        prazo_alerta_operacao_h: Number(config.prazo_alerta_operacao_h),
        prazo_escalonamento_dias: Number(config.prazo_escalonamento_dias),
        created_by: sessao?.email || '',
      };
      await salvarSlaConfigSupabase(payload);
      setMensagem('✓ Configurações salvas com sucesso.');
    } catch (err) {
      setMensagem(`Erro ao salvar: ${err.message}`);
    } finally {
      setSalvando(false);
    }
  };

  const set = (k, v) => setConfig((p) => ({ ...p, [k]: v }));

  if (carregando) return <div className="hint-box compact">Carregando configurações...</div>;

  return (
    <div className="panel-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Configurações de SLA e Alertas da Auditoria</div>
          <p className="compact">
            Defina prazos de aprovação, e-mails responsáveis e comportamento de alertas.
            Módulo: <strong>{canal}</strong>
          </p>
        </div>
      </div>

      <div className="form-grid three" style={{ marginTop: '0.75rem' }}>
        <label className="field">
          Prazo de alerta para operação (horas)
          <input
            type="number"
            min="1"
            value={config.prazo_alerta_operacao_h}
            onChange={(e) => set('prazo_alerta_operacao_h', e.target.value)}
          />
          <small>Após esse prazo sem aprovação, enviar alerta à operação.</small>
        </label>
        <label className="field">
          Prazo de escalonamento (dias)
          <input
            type="number"
            min="1"
            value={config.prazo_escalonamento_dias}
            onChange={(e) => set('prazo_escalonamento_dias', e.target.value)}
          />
          <small>Após esse prazo, escalar para gerência/diretoria.</small>
        </label>
      </div>

      <div className="form-grid three" style={{ marginTop: '0.5rem' }}>
        <label className="field">
          E-mails da operação (um por linha)
          <textarea
            value={emailsOpStr}
            onChange={(e) => setEmailsOpStr(e.target.value)}
            placeholder="email@empresa.com"
            style={{ minHeight: 80 }}
          />
        </label>
        <label className="field">
          E-mails da gerência (um por linha)
          <textarea
            value={emailsGerStr}
            onChange={(e) => setEmailsGerStr(e.target.value)}
            placeholder="email@empresa.com"
            style={{ minHeight: 80 }}
          />
        </label>
        <label className="field">
          E-mails da diretoria (um por linha)
          <textarea
            value={emailsDirStr}
            onChange={(e) => setEmailsDirStr(e.target.value)}
            placeholder="email@empresa.com"
            style={{ minHeight: 80 }}
          />
        </label>
      </div>

      <label className="field" style={{ marginTop: '0.5rem' }}>
        Mensagem padrão do e-mail de alerta
        <textarea
          value={config.mensagem_padrao_email}
          onChange={(e) => set('mensagem_padrao_email', e.target.value)}
          style={{ minHeight: 60 }}
        />
      </label>

      <div className="form-grid three" style={{ marginTop: '0.5rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={Boolean(config.envio_email_ativo)}
            onChange={(e) => set('envio_email_ativo', e.target.checked)}
          />
          Ativar envio de e-mail
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={Boolean(config.alerta_visual_ativo)}
            onChange={(e) => set('alerta_visual_ativo', e.target.checked)}
          />
          Ativar alerta visual no painel
        </label>
      </div>

      <div className="hint-box compact" style={{ marginTop: '0.75rem' }}>
        <strong>Nota:</strong> O envio automático de e-mails requer uma Edge Function ou job agendado no Supabase.
        Esta configuração prepara os dados para integração futura com o serviço de e-mail.
      </div>

      {mensagem && (
        <div className="hint-box compact" style={{ marginTop: '0.5rem' }}>
          {mensagem}
        </div>
      )}

      <div className="actions-right" style={{ marginTop: '0.75rem' }}>
        <button className="btn-primary" onClick={salvar} disabled={salvando}>
          {salvando ? 'Salvando...' : 'Salvar configurações'}
        </button>
      </div>
    </div>
  );
}
