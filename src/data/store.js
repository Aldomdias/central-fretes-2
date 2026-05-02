import { useEffect, useMemo, useRef, useState } from 'react';
import {
  bancoConfigurado,
  carregarConferenciaBaseDb,
  carregarResumoBaseDb,
  carregarSnapshotFretesDb,
  carregarTransportadoraCompletaDb,
  excluirLinhaSecaoDb,
  excluirOrigemDb,
  excluirTransportadoraDb,
  limparSecaoOrigemDb,
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
    conferenciaBase: null,
    carregandoDetalheId: null,
  });
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) {
      persistLocalState(transportadoras);
    }
  }, [transportadoras]);

  useEffect(() => {
    let cancelled = false;

    async function carregar() {
      setSyncStatus((prev) => ({ ...prev, carregando: true, erro: '' }));
      try {
        if (bancoConfigurado()) {
          const resumo = await carregarResumoBaseDb();
          const conferencia = await carregarConferenciaBaseDb().catch(() => null);
          if (cancelled) return;

          setTransportadoras((resumo.transportadoras || []).map(normalizeTransportadora));
          loadedRef.current = true;
          setSyncStatus((prev) => ({
            ...prev,
            carregando: false,
            fonte: 'supabase-resumo',
            resumoBase: resumo.resumo,
            conferenciaBase: conferencia,
          }));
          return;
        }

        const cacheLocal = readLocalState();
        if (cancelled) return;

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
          erro: error.message || 'Erro ao carregar resumo da base.',
        }));
      }
    }

    carregar();
    return () => {
      cancelled = true;
    };
  }, []);

  function salvarAutomaticamente(next, acao = 'alteração', secao = 'cadastros') {
    if (!loadedRef.current || !bancoConfigurado()) return;

    const tipoSecao = {
      rotas: 'rotas',
      cotacoes: 'cotacoes',
      taxasEspeciais: 'taxas',
      taxas: 'taxas',
      generalidades: 'generalidades',
      transportadora: 'cadastros',
      origem: 'cadastros',
      cadastros: 'cadastros',
    }[secao] || 'cadastros';

    setSyncStatus((prev) => ({ ...prev, sincronizando: true, erro: '' }));

    salvarSecaoDb(next, tipoSecao, undefined, { atualizarSnapshot: false })
      .then(async (result) => {
        const resumoAtualizado = await carregarResumoBaseDb().catch(() => null);

        setSyncStatus((prev) => ({
          ...prev,
          sincronizando: false,
          ultimaSincronizacao: result?.updated_at || new Date().toISOString(),
          fonte: 'supabase-resumo',
          resumoBase: resumoAtualizado?.resumo || prev.resumoBase,
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

  const aplicarAlteracao = (updater, acao = 'alteração', secao = 'cadastros') => {
    const baseAtual = Array.isArray(transportadoras) ? transportadoras : [];
    const next = typeof updater === 'function' ? updater(baseAtual) : updater;
    const normalized = (next || []).map(normalizeTransportadora);

    setTransportadoras(normalized);
    salvarAutomaticamente(normalized, acao, secao);
  };

  const finalizarExclusao = async () => {
    const resumoAtualizado = await carregarResumoBaseDb().catch(() => null);
    setSyncStatus((prev) => ({
      ...prev,
      sincronizando: false,
      fonte: 'supabase-resumo',
      ultimaSincronizacao: new Date().toISOString(),
      resumoBase: resumoAtualizado?.resumo || prev.resumoBase,
    }));
  };

  const erroExclusao = (error, mensagem) => {
    setSyncStatus((prev) => ({
      ...prev,
      sincronizando: false,
      erro: error.message || mensagem,
    }));
  };

  const api = useMemo(
    () => ({
      transportadoras,
      syncStatus,
      async atualizarResumo() {
        if (!bancoConfigurado()) {
          setSyncStatus((prev) => ({
            ...prev,
            erro: 'Supabase não configurado. Não foi possível atualizar a base.',
          }));
          return false;
        }

        setSyncStatus((prev) => ({ ...prev, carregando: true, erro: '' }));

        try {
          const resumo = await carregarResumoBaseDb();
          const conferencia = await carregarConferenciaBaseDb().catch(() => null);

          setTransportadoras((resumo.transportadoras || []).map(normalizeTransportadora));

          setSyncStatus((prev) => ({
            ...prev,
            carregando: false,
            fonte: 'supabase-resumo',
            resumoBase: resumo.resumo,
            conferenciaBase: conferencia || prev.conferenciaBase,
            ultimaSincronizacao: new Date().toISOString(),
          }));

          return true;
        } catch (error) {
          setSyncStatus((prev) => ({
            ...prev,
            carregando: false,
            erro: error.message || 'Erro ao atualizar base pelo Supabase.',
          }));
          return false;
        }
      },
      async conferirBase() {
        if (!bancoConfigurado()) {
          setSyncStatus((prev) => ({
            ...prev,
            erro: 'Supabase não configurado. Não foi possível conferir a base.',
          }));
          return null;
        }

        setSyncStatus((prev) => ({ ...prev, carregando: true, erro: '' }));

        try {
          const conferencia = await carregarConferenciaBaseDb();

          setSyncStatus((prev) => ({
            ...prev,
            carregando: false,
            fonte: 'supabase-resumo',
            conferenciaBase: conferencia,
            ultimaSincronizacao: new Date().toISOString(),
          }));

          return conferencia;
        } catch (error) {
          setSyncStatus((prev) => ({
            ...prev,
            carregando: false,
            erro: error.message || 'Erro ao conferir base pelo Supabase.',
          }));
          return null;
        }
      },
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
        setTransportadoras(normalized);
        if (!bancoConfigurado()) return { ok: true, modo: 'local' };

        setSyncStatus((prev) => ({ ...prev, sincronizando: true, erro: '' }));
        try {
          const result = await salvarSecaoDb(normalized, tipo, undefined, { atualizarSnapshot: false });
          const resumoAtualizado = await carregarResumoBaseDb().catch(() => null);
          setSyncStatus((prev) => ({
            ...prev,
            sincronizando: false,
            ultimaSincronizacao: result?.updated_at || new Date().toISOString(),
            fonte: 'supabase-resumo',
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

        setTransportadoras(normalized);

        if (!bancoConfigurado()) return { ok: true, modo: 'local' };

        setSyncStatus((prev) => ({ ...prev, sincronizando: true, erro: '' }));

        try {
          const result = await salvarSecaoDb(normalized, tipo, undefined, { atualizarSnapshot: false });
          const resumoAtualizado = await carregarResumoBaseDb().catch(() => null);
          setSyncStatus((prev) => ({
            ...prev,
            sincronizando: false,
            ultimaSincronizacao: result?.updated_at || new Date().toISOString(),
            fonte: 'supabase-resumo',
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
      async carregarTransportadoraCompleta(transportadoraId) {
        if (!transportadoraId || !bancoConfigurado()) return false;

        setSyncStatus((prev) => ({ ...prev, carregandoDetalheId: transportadoraId, erro: '' }));

        try {
          const atual = (transportadoras || []).find((item) => String(item.id) === String(transportadoraId));
          const completa = await carregarTransportadoraCompletaDb(transportadoraId, atual?.nome || '');
          if (!completa) {
            setSyncStatus((prev) => ({ ...prev, carregandoDetalheId: null }));
            return false;
          }

          setTransportadoras((prev) =>
            (prev || []).map((item) =>
              String(item.id) === String(transportadoraId) ||
              String(item.nome || '').trim().toLowerCase() === String(completa.nome || '').trim().toLowerCase()
                ? normalizeTransportadora(completa)
                : item
            )
          );

          setSyncStatus((prev) => ({
            ...prev,
            carregandoDetalheId: null,
            fonte: 'supabase-detalhe',
          }));

          return true;
        } catch (error) {
          setSyncStatus((prev) => ({
            ...prev,
            carregandoDetalheId: null,
            erro: error.message || 'Erro ao carregar detalhes da transportadora.',
          }));
          return false;
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
          'generalidades',
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
          'origem',
          'origem'
        );
      },
      removerOrigem(transportadoraId, origemId) {
        setTransportadoras((prev) =>
          (prev || []).map((t) =>
            t.id !== transportadoraId
              ? t
              : {
                  ...t,
                  origens: t.origens.filter((o) => o.id !== origemId),
                }
          )
        );

        if (!bancoConfigurado()) return;

        setSyncStatus((prev) => ({ ...prev, sincronizando: true, erro: '' }));
        excluirOrigemDb(origemId)
          .then(finalizarExclusao)
          .catch((error) => erroExclusao(error, 'Erro ao excluir origem no Supabase.'));
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
          'transportadora',
          'transportadora'
        );
      },
      removerTransportadora(id) {
        setTransportadoras((prev) => (prev || []).filter((item) => item.id !== id));

        if (!bancoConfigurado()) return;

        setSyncStatus((prev) => ({ ...prev, sincronizando: true, erro: '' }));
        excluirTransportadoraDb(id)
          .then(finalizarExclusao)
          .catch((error) => erroExclusao(error, 'Erro ao excluir transportadora no Supabase.'));
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
          secao,
          secao
        );
      },
      removerLinha(transportadoraId, origemId, secao, linhaId) {
        setTransportadoras((prev) =>
          (prev || []).map((t) =>
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

        if (!bancoConfigurado()) return;

        setSyncStatus((prev) => ({ ...prev, sincronizando: true, erro: '' }));
        excluirLinhaSecaoDb(secao, linhaId)
          .then(finalizarExclusao)
          .catch((error) => erroExclusao(error, `Erro ao excluir ${secao} no Supabase.`));
      },
      importarPayload(payload, tipo) {
        aplicarAlteracao((prev) => mergeImport(prev, payload, tipo), tipo, tipo);
      },
      limparSecaoOrigem(transportadoraId, origemId, secao) {
        setTransportadoras((prev) =>
          (prev || []).map((t) =>
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

        if (!bancoConfigurado()) return;

        setSyncStatus((prev) => ({ ...prev, sincronizando: true, erro: '' }));
        limparSecaoOrigemDb(origemId, secao)
          .then(finalizarExclusao)
          .catch((error) => erroExclusao(error, `Erro ao limpar ${secao} no Supabase.`));
      },
    }),
    [transportadoras, syncStatus]
  );

  return api;
}
