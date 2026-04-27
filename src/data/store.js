import { useEffect, useMemo, useRef, useState } from 'react';
import {
  bancoConfigurado,
  carregarBaseCompletaDb,
  carregarResumoBaseDb,
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

function readLocalState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : parsed?.payload?.transportadoras || [];
  } catch {
    return [];
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

function mergeImportBatch(prev, payloads = [], tipo) {
  return (payloads || []).reduce((acc, payload) => mergeImport(acc, payload, tipo), prev);
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
    resumoBase: null,
  });
  const loadedRef = useRef(false);
  const baseCompletaRef = useRef(false);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) {
      persistLocalState(transportadoras);
    }
  }, [transportadoras]);

  useEffect(() => {
    let cancelled = false;

    async function carregarBaseCompletaEmSegundoPlano() {
      if (!bancoConfigurado()) return;

      setSyncStatus((prev) => ({ ...prev, carregandoSegundoPlano: true }));

      try {
        const baseCompleta = await carregarBaseCompletaDb();

        if ((baseCompleta || []).length) {
          salvarBaseCompletaDb(baseCompleta).catch((error) => {
            console.warn('Não foi possível criar o snapshot automático:', error);
          });
        }

        if (cancelled || dirtyRef.current) {
          setSyncStatus((prev) => ({ ...prev, carregandoSegundoPlano: false }));
          return;
        }

        baseCompletaRef.current = true;
        setTransportadoras((baseCompleta || []).map(normalizeTransportadora));
        setSyncStatus((prev) => ({
          ...prev,
          carregandoSegundoPlano: false,
          fonte: 'supabase-relacional-completa',
        }));
      } catch (error) {
        if (cancelled) return;
        setSyncStatus((prev) => ({
          ...prev,
          carregandoSegundoPlano: false,
          erro: error.message || 'Erro ao carregar base completa em segundo plano.',
        }));
      }
    }

    async function carregar() {
      setSyncStatus((prev) => ({ ...prev, carregando: true, erro: '' }));
      try {
        const snapshot = await carregarSnapshotFretesDb();

        if (snapshot?.payload?.transportadoras?.length) {
          if (cancelled) return;
          baseCompletaRef.current = true;
          setTransportadoras(snapshot.payload.transportadoras.map(normalizeTransportadora));
          loadedRef.current = true;
          setSyncStatus((prev) => ({
            ...prev,
            carregando: false,
            ultimaSincronizacao: snapshot.updated_at || snapshot.payload.updatedAt || '',
            fonte: 'supabase-snapshot',
            resumoBase: null,
          }));
          return;
        }

        if (bancoConfigurado()) {
          const resumo = await carregarResumoBaseDb();
          if (cancelled) return;

          baseCompletaRef.current = false;
          setTransportadoras((resumo.transportadoras || []).map(normalizeTransportadora));
          loadedRef.current = true;
          setSyncStatus((prev) => ({
            ...prev,
            carregando: false,
            fonte: 'supabase-resumo',
            resumoBase: resumo.resumo,
          }));

          // Deixa a tela conectada e responsiva. A base completa tenta carregar depois,
          // mas não bloqueia o dashboard nem a importação.
          carregarBaseCompletaEmSegundoPlano();
          return;
        }

        const cacheLocal = readLocalState();
        if (cancelled) return;
        baseCompletaRef.current = true;
        setTransportadoras((cacheLocal || []).map(normalizeTransportadora));
        loadedRef.current = true;
        setSyncStatus((prev) => ({
          ...prev,
          carregando: false,
          fonte: 'local',
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

  function salvarAutomaticamente(next, acao = 'alteração') {
    dirtyRef.current = true;
    if (!loadedRef.current || !bancoConfigurado()) return;

    if (!baseCompletaRef.current) {
      setSyncStatus((prev) => ({
        ...prev,
        erro: 'Base completa ainda não carregada. Para alterações manuais, aguarde a carga completa. A importação por lote pode ser usada normalmente.',
      }));
      return;
    }

    setSyncStatus((prev) => ({ ...prev, sincronizando: true, erro: '' }));

    salvarBaseCompletaDb(next)
      .then((result) => {
        setSyncStatus((prev) => ({
          ...prev,
          sincronizando: false,
          ultimaSincronizacao: result?.updated_at || new Date().toISOString(),
          fonte: 'supabase-snapshot',
        }));
      })
      .catch((error) => {
        setSyncStatus((prev) => ({
          ...prev,
          sincronizando: false,
          erro: error.message || `Erro ao salvar ${acao}.`,
        }));
      });
  }

  const aplicarAlteracao = (updater, acao = 'alteração') => {
    const baseAtual = Array.isArray(transportadoras) ? transportadoras : [];
    const next = typeof updater === 'function' ? updater(baseAtual) : updater;
    const normalized = (next || []).map(normalizeTransportadora);

    setTransportadoras(normalized);
    salvarAutomaticamente(normalized, acao);
  };

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
          const snapshot = await carregarSnapshotFretesDb();
          const base = snapshot?.payload?.transportadoras || [];
          setTransportadoras((base || []).map(normalizeTransportadora));
          setSyncStatus((prev) => ({
            ...prev,
            carregando: false,
            ultimaSincronizacao: snapshot?.updated_at || snapshot?.payload?.updatedAt || '',
            fonte: 'supabase-snapshot',
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
        const next = mergeImport(transportadoras, payload, tipo);
        const normalized = (next || []).map(normalizeTransportadora);
        dirtyRef.current = true;
        setTransportadoras(normalized);
        if (!bancoConfigurado()) return { ok: true, modo: 'local' };

        setSyncStatus((prev) => ({ ...prev, sincronizando: true, erro: '' }));
        try {
          const result = await salvarSecaoDb(
            normalized,
            tipo,
            undefined,
            { atualizarSnapshot: baseCompletaRef.current }
          );
          const resumoAtualizado = await carregarResumoBaseDb().catch(() => null);
          setSyncStatus((prev) => ({
            ...prev,
            sincronizando: false,
            ultimaSincronizacao: result?.updated_at || new Date().toISOString(),
            fonte: baseCompletaRef.current ? 'supabase-snapshot' : 'supabase-resumo',
            resumoBase: resumoAtualizado?.resumo || prev.resumoBase,
          }));
          return { ok: true };
        } catch (error) {
          setSyncStatus((prev) => ({
            ...prev,
            sincronizando: false,
            erro: error.message || 'Erro ao salvar seção.',
          }));
          return { ok: false, erro: error };
        }
      },
      async importarLoteESalvar(payloads, tipo) {
        const listaPayloads = Array.isArray(payloads) ? payloads.filter(Boolean) : [];
        if (!listaPayloads.length) return { ok: true, modo: bancoConfigurado() ? 'supabase' : 'local' };

        const next = mergeImportBatch(transportadoras, listaPayloads, tipo);
        const normalized = (next || []).map(normalizeTransportadora);

        dirtyRef.current = true;
        setTransportadoras(normalized);

        if (!bancoConfigurado()) return { ok: true, modo: 'local' };

        setSyncStatus((prev) => ({ ...prev, sincronizando: true, erro: '' }));

        try {
          const result = await salvarSecaoDb(
            normalized,
            tipo,
            undefined,
            { atualizarSnapshot: baseCompletaRef.current }
          );
          const resumoAtualizado = await carregarResumoBaseDb().catch(() => null);
          setSyncStatus((prev) => ({
            ...prev,
            sincronizando: false,
            ultimaSincronizacao: result?.updated_at || new Date().toISOString(),
            fonte: baseCompletaRef.current ? 'supabase-snapshot' : 'supabase-resumo',
            resumoBase: resumoAtualizado?.resumo || prev.resumoBase,
          }));
          return { ok: true };
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
        aplicarAlteracao(
          (prev) =>
            prev.map((t) =>
              t.id !== transportadoraId
                ? t
                : {
                    ...t,
                    origens: t.origens.map((o) =>
                      o.id !== origemId ? o : { ...o, generalidades: mergeGeneralidades(generalidades) }
                    ),
                  }
            ),
          'generalidades'
        );
      },
      salvarOrigem(transportadoraId, origem) {
        aplicarAlteracao(
          (prev) =>
            prev.map((t) => {
              if (t.id !== transportadoraId) return t;
              const normalized = normalizeOrigem(origem);
              const exists = t.origens.some((o) => o.id === normalized.id);
              const origens = exists
                ? t.origens.map((o) => (o.id === normalized.id ? normalized : o))
                : [...t.origens, normalized];
              return { ...t, origens };
            }),
          'origem'
        );
      },
      removerOrigem(transportadoraId, origemId) {
        aplicarAlteracao(
          (prev) =>
            prev.map((t) =>
              t.id !== transportadoraId
                ? t
                : {
                    ...t,
                    origens: t.origens.filter((o) => o.id !== origemId),
                  }
            ),
          'remoção de origem'
        );
      },
      salvarTransportadora(transportadora) {
        aplicarAlteracao(
          (prev) => {
            const normalized = normalizeTransportadora(transportadora);
            const exists = prev.some((item) => item.id === normalized.id);
            return exists
              ? prev.map((item) => (item.id === normalized.id ? normalized : item))
              : [...prev, normalized];
          },
          'transportadora'
        );
      },
      removerTransportadora(id) {
        aplicarAlteracao((prev) => prev.filter((item) => item.id !== id), 'remoção de transportadora');
      },
      salvarLinha(transportadoraId, origemId, secao, linha) {
        aplicarAlteracao(
          (prev) =>
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
            ),
          secao
        );
      },
      removerLinha(transportadoraId, origemId, secao, linhaId) {
        aplicarAlteracao(
          (prev) =>
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
            ),
          `remoção de ${secao}`
        );
      },
      importarPayload(payload, tipo) {
        aplicarAlteracao((prev) => mergeImport(prev, payload, tipo), tipo);
      },
      limparSecaoOrigem(transportadoraId, origemId, secao) {
        aplicarAlteracao(
          (prev) =>
            prev.map((t) =>
              t.id !== transportadoraId
                ? t
                : {
                    ...t,
                    origens: t.origens.map((o) =>
                      o.id !== origemId ? o : { ...o, [secao]: [] }
                    ),
                  }
            ),
          `limpeza de ${secao}`
        );
      },
    }),
    [transportadoras, syncStatus]
  );

  return api;
}
