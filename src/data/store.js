import { useEffect, useMemo, useRef, useState } from 'react';
import {
  bancoConfigurado,
  carregarBaseCompletaDb,
  carregarSnapshotFretesDb,
  salvarBaseCompletaDb,
  salvarSecaoDb,
} from '../services/freteDatabaseService';

const STORAGE_KEY = 'simulador-fretes-local-v6';

const DEFAULT_GENERALIDADES = {
  incideIcms: false,
  aliquotaIcms: 0,
  adValorem: 0,
  adValoremMinimo: 0,
  pedagio: 0,
  gris: 0,
  grisMinimo: 0,
  tas: 0,
  ctrc: 0,
  cubagem: 300,
  tipoCalculo: 'PERCENTUAL',
  observacoes: '',
  freteMinimo: 0,
  regraCalculo: '',
};

function mergeGeneralidades(value) {
  return { ...DEFAULT_GENERALIDADES, ...(value || {}) };
}

function safeRandomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeOrigem(origem = {}) {
  return {
    ...origem,
    id: origem.id ?? safeRandomId(),
    canal: origem.canal || 'ATACADO',
    status: origem.status || 'Ativa',
    generalidades: mergeGeneralidades(origem.generalidades),
    rotas: Array.isArray(origem.rotas)
      ? origem.rotas.map((item) => ({ ...item, id: item.id ?? safeRandomId() }))
      : [],
    cotacoes: Array.isArray(origem.cotacoes)
      ? origem.cotacoes.map((item) => ({ ...item, id: item.id ?? safeRandomId() }))
      : [],
    taxasEspeciais: Array.isArray(origem.taxasEspeciais)
      ? origem.taxasEspeciais.map((item) => ({ ...item, id: item.id ?? safeRandomId() }))
      : [],
  };
}

function normalizeTransportadora(transportadora = {}) {
  return {
    ...transportadora,
    id: transportadora.id ?? safeRandomId(),
    status: transportadora.status || 'Ativa',
    origens: Array.isArray(transportadora.origens)
      ? transportadora.origens.map(normalizeOrigem)
      : [],
  };
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function persistLocalState(transportadoras) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(transportadoras));
    return true;
  } catch {
    return false;
  }
}

function sameOrigem(current, imported) {
  return (
    String(current.cidade || '').toLowerCase() ===
      String(imported.cidade || '').toLowerCase() &&
    String(current.canal || 'ATACADO').toUpperCase() ===
      String(imported.canal || 'ATACADO').toUpperCase()
  );
}

function mergeImport(prev, payload, tipo) {
  const next = clone(prev).map(normalizeTransportadora);

  payload.transportadoras.forEach((item) => {
    let transportadora = next.find(
      (current) =>
        String(current.nome || '').toLowerCase() === String(item.nome || '').toLowerCase()
    );

    if (!transportadora) {
      transportadora = normalizeTransportadora({
        nome: item.nome,
        status: item.status || 'Ativa',
        origens: [],
      });
      next.push(transportadora);
    }

    let origem = (transportadora.origens || []).find((current) => sameOrigem(current, item.origem));

    if (!origem) {
      origem = normalizeOrigem({
        cidade: item.origem.cidade,
        canal: item.origem.canal || 'ATACADO',
        status: item.origem.status || 'Ativa',
        generalidades: item.origem.generalidades,
        rotas: [],
        cotacoes: [],
        taxasEspeciais: [],
      });
      transportadora.origens = [...(transportadora.origens || []), origem];
    }

    if (tipo === 'generalidades' && item.origem.generalidades) {
      origem.generalidades = mergeGeneralidades(item.origem.generalidades);
    }

    if (tipo === 'rotas') {
      const enriched = (item.origem.rotas || []).map((row) => ({
        ...row,
        id: row.id ?? safeRandomId(),
      }));
      origem.rotas = [...(origem.rotas || []), ...enriched];
    }

    if (tipo === 'cotacoes') {
      const enriched = (item.origem.cotacoes || []).map((row) => ({
        ...row,
        id: row.id ?? safeRandomId(),
      }));
      origem.cotacoes = [...(origem.cotacoes || []), ...enriched];
    }

    if (tipo === 'taxas') {
      const enriched = (item.origem.taxasEspeciais || []).map((row) => ({
        ...row,
        id: row.id ?? safeRandomId(),
      }));
      origem.taxasEspeciais = [...(origem.taxasEspeciais || []), ...enriched];
    }
  });

  return next.map(normalizeTransportadora);
}

function mergeImportMany(prev, payloads = [], tipo) {
  return (payloads || []).reduce(
    (acc, payload) => mergeImport(acc, payload, tipo),
    clone(prev).map(normalizeTransportadora)
  );
}

export function useFreteStore() {
  const [transportadoras, setTransportadoras] = useState([]);
  const [syncStatus, setSyncStatus] = useState({
    modo: bancoConfigurado() ? 'supabase' : 'local',
    carregando: false,
    sincronizando: false,
    erro: '',
    ultimaSincronizacao: '',
    fonte: bancoConfigurado() ? 'supabase-seguro' : 'local',
  });
  const loadedRef = useRef(false);

  useEffect(() => {
    persistLocalState(transportadoras);
  }, [transportadoras]);

  useEffect(() => {
    let cancelled = false;

    async function carregar() {
      setSyncStatus((prev) => ({ ...prev, carregando: true, erro: '' }));
      try {
        let base = [];
        if (bancoConfigurado()) {
          base = await carregarBaseCompletaDb();
        } else {
          const snapshot = await carregarSnapshotFretesDb();
          base = snapshot?.payload?.transportadoras || [];
        }

        if (cancelled) return;

        setTransportadoras((base || []).map(normalizeTransportadora));

        let ultimaSincronizacao = '';
        try {
          const snapshot = await carregarSnapshotFretesDb();
          ultimaSincronizacao = snapshot?.updated_at || snapshot?.payload?.updatedAt || '';
        } catch {}

        loadedRef.current = true;
        setSyncStatus((prev) => ({
          ...prev,
          carregando: false,
          ultimaSincronizacao,
          fonte: bancoConfigurado() ? 'supabase-seguro' : 'local',
        }));
      } catch (error) {
        if (cancelled) return;
        loadedRef.current = true;
        setSyncStatus((prev) => ({
          ...prev,
          carregando: false,
          erro: error.message || 'Erro ao carregar base.',
        }));
      }
    }

    carregar();
    return () => {
      cancelled = true;
    };
  }, []);

  const api = useMemo(
    () => ({
      transportadoras,
      syncStatus,
      async sincronizarAgora() {
        if (!bancoConfigurado()) return false;
        setSyncStatus((prev) => ({ ...prev, sincronizando: true, erro: '' }));
        try {
          const result = await salvarBaseCompletaDb(transportadoras);
          setSyncStatus((prev) => ({
            ...prev,
            sincronizando: false,
            ultimaSincronizacao: result?.updated_at || new Date().toISOString(),
            fonte: 'supabase-seguro',
          }));
          return true;
        } catch (error) {
          setSyncStatus((prev) => ({
            ...prev,
            sincronizando: false,
            erro: error.message || 'Erro ao sincronizar agora.',
          }));
          return false;
        }
      },
      async carregarDoBanco() {
        if (!bancoConfigurado()) return false;
        setSyncStatus((prev) => ({ ...prev, carregando: true, erro: '' }));
        try {
          const base = await carregarBaseCompletaDb();
          setTransportadoras((base || []).map(normalizeTransportadora));
          const snapshot = await carregarSnapshotFretesDb();
          setSyncStatus((prev) => ({
            ...prev,
            carregando: false,
            ultimaSincronizacao: snapshot?.updated_at || snapshot?.payload?.updatedAt || '',
            fonte: 'supabase-seguro',
          }));
          return true;
        } catch (error) {
          setSyncStatus((prev) => ({
            ...prev,
            carregando: false,
            erro: error.message || 'Erro ao carregar base do banco.',
          }));
          return false;
        }
      },
      async importarESalvar(payload, tipo) {
        return this.importarLoteESalvar([payload], tipo);
      },
      async importarLoteESalvar(payloads, tipo) {
        const payloadsValidos = (payloads || []).filter(Boolean);
        if (!payloadsValidos.length) return { ok: true, modo: 'sem-alteracao' };

        const next = mergeImportMany(transportadoras, payloadsValidos, tipo);
        setTransportadoras(next);
        if (!bancoConfigurado()) return { ok: true, modo: 'local' };

        setSyncStatus((prev) => ({ ...prev, sincronizando: true, erro: '' }));
        try {
          const result = await salvarSecaoDb(next, tipo);
          setSyncStatus((prev) => ({
            ...prev,
            sincronizando: false,
            ultimaSincronizacao: result?.updated_at || new Date().toISOString(),
            fonte: 'supabase-seguro',
          }));
          return { ok: true, salvos: payloadsValidos.length };
        } catch (error) {
          setSyncStatus((prev) => ({
            ...prev,
            sincronizando: false,
            erro: error.message || 'Erro ao salvar lote.',
          }));
          return { ok: false, erro: error };
        }
      },
      resetarBase() {
        setTransportadoras([]);
      },
      salvarGeneralidades(transportadoraId, origemId, generalidades) {
        setTransportadoras((prev) =>
          prev.map((t) =>
            t.id !== transportadoraId
              ? t
              : {
                  ...t,
                  origens: t.origens.map((o) =>
                    o.id !== origemId ? o : { ...o, generalidades: mergeGeneralidades(generalidades) }
                  ),
                }
          )
        );
      },
      salvarOrigem(transportadoraId, origem) {
        setTransportadoras((prev) =>
          prev.map((t) => {
            if (t.id !== transportadoraId) return t;
            const normalized = normalizeOrigem(origem);
            const exists = t.origens.some((o) => o.id === normalized.id);
            const origens = exists
              ? t.origens.map((o) => (o.id === normalized.id ? normalized : o))
              : [...t.origens, normalized];
            return { ...t, origens };
          })
        );
      },
      removerOrigem(transportadoraId, origemId) {
        setTransportadoras((prev) =>
          prev.map((t) =>
            t.id !== transportadoraId
              ? t
              : {
                  ...t,
                  origens: t.origens.filter((o) => o.id !== origemId),
                }
          )
        );
      },
      salvarTransportadora(transportadora) {
        setTransportadoras((prev) => {
          const normalized = normalizeTransportadora(transportadora);
          const exists = prev.some((item) => item.id === normalized.id);
          return exists
            ? prev.map((item) => (item.id === normalized.id ? normalized : item))
            : [...prev, normalized];
        });
      },
      removerTransportadora(id) {
        setTransportadoras((prev) => prev.filter((item) => item.id !== id));
      },
      salvarLinha(transportadoraId, origemId, secao, linha) {
        setTransportadoras((prev) =>
          prev.map((t) =>
            t.id !== transportadoraId
              ? t
              : {
                  ...t,
                  origens: t.origens.map((o) => {
                    if (o.id !== origemId) return o;
                    const lista = o[secao] ?? [];
                    const normalized = { ...linha, id: linha.id ?? safeRandomId() };
                    const exists = lista.some((item) => item.id === normalized.id);
                    return {
                      ...o,
                      [secao]: exists
                        ? lista.map((item) => (item.id === normalized.id ? normalized : item))
                        : [...lista, normalized],
                    };
                  }),
                }
          )
        );
      },
      removerLinha(transportadoraId, origemId, secao, linhaId) {
        setTransportadoras((prev) =>
          prev.map((t) =>
            t.id !== transportadoraId
              ? t
              : {
                  ...t,
                  origens: t.origens.map((o) =>
                    o.id !== origemId
                      ? o
                      : {
                          ...o,
                          [secao]: (o[secao] ?? []).filter((item) => item.id !== linhaId),
                        }
                  ),
                }
          )
        );
      },
      importarPayload(payload, tipo) {
        setTransportadoras((prev) => mergeImport(prev, payload, tipo));
      },
      limparSecaoOrigem(transportadoraId, origemId, secao) {
        setTransportadoras((prev) =>
          prev.map((t) =>
            t.id !== transportadoraId
              ? t
              : {
                  ...t,
                  origens: t.origens.map((o) =>
                    o.id !== origemId ? o : { ...o, [secao]: [] }
                  ),
                }
          )
        );
      },
    }),
    [transportadoras, syncStatus]
  );

  return api;
}
