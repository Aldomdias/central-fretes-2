import { useEffect, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const CACHE_TTL_MS = 5 * 60 * 1000;
let cachePromise = null;
let cacheTimestamp = 0;

const DIAS_ALERTA_IMPORTACAO = 7;

export function invalidarStatusBaseLotacao() {
  cachePromise = null;
  cacheTimestamp = 0;
}

async function consultarStatusBaseLotacao() {
  const supabase = getSupabaseClient();
  if (!supabase || !isSupabaseConfigured()) return null;

  const [operacionalRes, importacaoRes] = await Promise.all([
    supabase
      .from('lotacao_cargas')
      .select('coleta_realizada, coleta_planejada, importado_em')
      .or('coleta_realizada.not.is.null,coleta_planejada.not.is.null,importado_em.not.is.null')
      .order('coleta_realizada', { ascending: false, nullsFirst: false })
      .order('coleta_planejada', { ascending: false, nullsFirst: false })
      .order('importado_em', { ascending: false, nullsFirst: false })
      .limit(20),
    supabase
      .from('lotacao_cargas')
      .select('importado_em')
      .not('importado_em', 'is', null)
      .order('importado_em', { ascending: false })
      .limit(1),
  ]);

  if (operacionalRes.error) throw operacionalRes.error;
  if (importacaoRes.error) throw importacaoRes.error;

  const datasOperacionais = (operacionalRes.data || [])
    .flatMap((row) => [row.coleta_realizada, row.coleta_planejada])
    .map((valor) => new Date(valor).getTime())
    .filter((valor) => Number.isFinite(valor) && valor > 0);

  return {
    ultimaCarga: datasOperacionais.length ? new Date(Math.max(...datasOperacionais)).toISOString() : null,
    ultimaImportacao: importacaoRes.data?.[0]?.importado_em || null,
  };
}

function obterStatusBaseLotacao() {
  const agora = Date.now();
  if (!cachePromise || agora - cacheTimestamp > CACHE_TTL_MS) {
    cacheTimestamp = agora;
    cachePromise = consultarStatusBaseLotacao().catch((err) => {
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

export default function BaseLotacaoStatus({ style }) {
  const [status, setStatus] = useState(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let ativo = true;
    obterStatusBaseLotacao()
      .then((res) => { if (ativo) setStatus(res); })
      .catch(() => { if (ativo) setErro(true); });
    return () => { ativo = false; };
  }, []);

  if (erro) {
    return (
      <div style={{ fontSize: 12, color: '#9b6a1b', marginTop: 4, ...style }}>
        Nao foi possivel verificar a atualizacao da base de lotacao.
      </div>
    );
  }

  if (!status) return null;

  const dataCarga = formatarData(status.ultimaCarga);
  const dataImportacao = formatarDataHora(status.ultimaImportacao);
  if (!dataCarga && !dataImportacao) return null;

  const atrasoImportacao = diasDesde(status.ultimaImportacao);
  const desatualizada = atrasoImportacao != null && atrasoImportacao > DIAS_ALERTA_IMPORTACAO;

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
    <div style={{ ...base, ...style }} title="Data operacional mais recente do fluxo de lotacao e data em que essa base foi importada.">
      <span>Base Lotacao{dataCarga ? <>: fluxo ate <strong>{dataCarga}</strong></> : null}</span>
      {dataImportacao ? <span> - ultima importacao {dataImportacao}</span> : null}
      {desatualizada ? <span> - {atrasoImportacao} dias sem importacao</span> : null}
    </div>
  );
}
