import { useEffect, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

// Cache compartilhado entre todas as telas: uma única consulta por sessão
// (com TTL) mesmo navegando entre Simulador, CT-e, Auditoria etc.
const CACHE_TTL_MS = 5 * 60 * 1000;
let cachePromise = null;
let cacheTimestamp = 0;

// Dias sem CT-e novo a partir dos quais o aviso fica em alerta (âmbar).
const DIAS_ALERTA_DESATUALIZADO = 5;

export function invalidarStatusBaseCtes() {
  cachePromise = null;
  cacheTimestamp = 0;
}

async function consultarStatusBaseCtes() {
  const supabase = getSupabaseClient();
  if (!supabase || !isSupabaseConfigured()) return null;

  const [emissaoRes, importacaoRes] = await Promise.all([
    supabase
      .from('realizado_local_ctes')
      .select('data_emissao')
      .not('data_emissao', 'is', null)
      .order('data_emissao', { ascending: false })
      .limit(1),
    supabase
      .from('realizado_local_ctes')
      .select('created_at')
      .not('created_at', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  if (emissaoRes.error) throw emissaoRes.error;
  if (importacaoRes.error) throw importacaoRes.error;

  return {
    ultimaEmissao: emissaoRes.data?.[0]?.data_emissao || null,
    ultimaImportacao: importacaoRes.data?.[0]?.created_at || null,
  };
}

function obterStatusBaseCtes() {
  const agora = Date.now();
  if (!cachePromise || agora - cacheTimestamp > CACHE_TTL_MS) {
    cacheTimestamp = agora;
    cachePromise = consultarStatusBaseCtes().catch((err) => {
      // Erro não fica em cache: a próxima tela tenta de novo.
      cachePromise = null;
      throw err;
    });
  }
  return cachePromise;
}

function formatarData(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('pt-BR');
}

function formatarDataHora(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

function diasDesde(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
}

export default function BaseCtesStatus({ style }) {
  const [status, setStatus] = useState(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let ativo = true;
    obterStatusBaseCtes()
      .then((res) => { if (ativo) setStatus(res); })
      .catch(() => { if (ativo) setErro(true); });
    return () => { ativo = false; };
  }, []);

  if (erro) {
    return (
      <div style={{ fontSize: 12, color: '#9b6a1b', marginTop: 4, ...style }}>
        ⚠️ Não foi possível verificar a atualização da base de CT-es.
      </div>
    );
  }

  if (!status) return null;

  const dataEmissao = formatarData(status.ultimaEmissao);
  const dataImportacao = formatarDataHora(status.ultimaImportacao);
  if (!dataEmissao && !dataImportacao) return null;

  const atraso = diasDesde(status.ultimaEmissao);
  const desatualizada = atraso != null && atraso > DIAS_ALERTA_DESATUALIZADO;

  const base = {
    display: 'inline-flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    marginTop: 4,
    padding: '3px 10px',
    borderRadius: 999,
    border: desatualizada ? '1px solid #e7c98a' : '1px solid #d7dee8',
    background: desatualizada ? '#fdf6e7' : '#f4f7fb',
    color: desatualizada ? '#8a5a12' : '#4a5a6d',
  };

  return (
    <div style={{ ...base, ...style }} title="Data do CT-e mais recente na base realizado_local_ctes e data da última importação.">
      <span>📦 Base CT-es{dataEmissao ? <>: dados até <strong>{dataEmissao}</strong></> : null}</span>
      {dataImportacao ? <span>· última importação {dataImportacao}</span> : null}
      {desatualizada ? <span>· {atraso} dias sem CT-e novo — verifique se a base precisa ser atualizada</span> : null}
    </div>
  );
}
