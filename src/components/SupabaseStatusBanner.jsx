import { useEffect, useState } from 'react';
import { SUPABASE_STATUS_EVENT, verificarDisponibilidadeSupabase } from '../lib/supabaseClient';

export default function SupabaseStatusBanner() {
  const [estado, setEstado] = useState('online');
  const [verificando, setVerificando] = useState(false);

  useEffect(() => {
    const ouvir = (event) => setEstado((atual) => {
      const proximo = event.detail?.status || 'online';
      return atual === 'reiniciando' && proximo === 'online' ? 'recuperado' : proximo;
    });
    window.addEventListener(SUPABASE_STATUS_EVENT, ouvir);
    return () => window.removeEventListener(SUPABASE_STATUS_EVENT, ouvir);
  }, []);

  useEffect(() => {
    if (estado !== 'reiniciando') return undefined;
    const conferir = async () => {
      setVerificando(true);
      const online = await verificarDisponibilidadeSupabase();
      setVerificando(false);
      if (online) setEstado('recuperado');
    };
    const timer = window.setInterval(conferir, 10000);
    void conferir();
    return () => window.clearInterval(timer);
  }, [estado]);

  useEffect(() => {
    if (estado !== 'recuperado') return undefined;
    const timer = window.setTimeout(() => setEstado('online'), 6000);
    return () => window.clearTimeout(timer);
  }, [estado]);

  if (estado === 'online') return null;
  if (estado === 'recuperado') {
    return <div className="supabase-status-banner recovered"><strong>Servidor disponível novamente.</strong> Você já pode continuar ou repetir a operação.</div>;
  }
  return (
    <div className="supabase-status-banner warning" role="status" aria-live="polite">
      <span className="supabase-status-spinner" />
      <div><strong>O servidor está reiniciando ou temporariamente indisponível.</strong><br /><span>Isso pode acontecer após consultas muito pesadas. Aguarde alguns instantes; estamos verificando automaticamente.</span></div>
      <button type="button" onClick={async () => { setVerificando(true); const online = await verificarDisponibilidadeSupabase(); setVerificando(false); if (online) setEstado('recuperado'); }} disabled={verificando}>{verificando ? 'Verificando...' : 'Verificar agora'}</button>
    </div>
  );
}
