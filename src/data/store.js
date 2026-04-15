import { useEffect, useMemo, useState } from 'react';
import { initialTransportadoras } from './mockData';

const STORAGE_KEY = 'simulador-fretes-local-v5';

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
};

function mergeGeneralidades(value) {
  return { ...DEFAULT_GENERALIDADES, ...(value || {}) };
}

function normalizeOrigem(origem = {}) {
  return {
    ...origem,
    canal: origem.canal || 'ATACADO',
    status: origem.status || 'Ativa',
    generalidades: mergeGeneralidades(origem.generalidades),
    rotas: Array.isArray(origem.rotas) ? origem.rotas : [],
    cotacoes: Array.isArray(origem.cotacoes) ? origem.cotacoes : [],
    taxasEspeciais: Array.isArray(origem.taxasEspeciais) ? origem.taxasEspeciais : [],
  };
}

function normalizeTransportadora(transportadora = {}) {
  return {
    ...transportadora,
    status: transportadora.status || 'Ativa',
    origens: Array.isArray(transportadora.origens)
      ? transportadora.origens.map(normalizeOrigem)
      : [],
  };
}

function nextId(list) {
  return (
    list.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) || 0
  ) + 1;
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
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
        String(current.nome || '').toLowerCase() ===
        String(item.nome || '').toLowerCase()
    );

    if (!transportadora) {
      transportadora = normalizeTransportadora({
        id: nextId(next),
        nome: item.nome,
        status: item.status || 'Ativa',
        origens: [],
      });
      next.push(transportadora);
    }

    let origem = (transportadora.origens || []).find((current) =>
      sameOrigem(current, item.origem)
    );

    if (!origem) {
      origem = normalizeOrigem({
        id: nextId(transportadora.origens || []),
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
        id: nextId(origem.rotas || []) + Math.random(),
      }));
      origem.rotas = [...(origem.rotas || []), ...enriched];
    }

    if (tipo === 'cotacoes') {
      const enriched = (item.origem.cotacoes || []).map((row) => ({
        ...row,
        id: nextId(origem.cotacoes || []) + Math.random(),
      }));
      origem.cotacoes = [...(origem.cotacoes || []), ...enriched];
    }

    if (tipo === 'taxas') {
      const enriched = (item.origem.taxasEspeciais || []).map((row) => ({
        ...row,
        id: nextId(origem.taxasEspeciais || []) + Math.random(),
      }));
      origem.taxasEspeciais = [...(origem.taxasEspeciais || []), ...enriched];
    }
  });

  return next.map(normalizeTransportadora);
}

export function useFreteStore() {
  const [transportadoras, setTransportadoras] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved
      ? JSON.parse(saved).map(normalizeTransportadora)
      : clone(initialTransportadoras).map(normalizeTransportadora);
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(transportadoras));
  }, [transportadoras]);

  const api = useMemo(
    () => ({
      transportadoras,
      resetarBase() {
        setTransportadoras(clone(initialTransportadoras).map(normalizeTransportadora));
      },
      salvarGeneralidades(transportadoraId, origemId, generalidades) {
        setTransportadoras((prev) =>
          prev.map((t) =>
            t.id !== transportadoraId
              ? t
              : {
                  ...t,
                  origens: t.origens.map((o) =>
                    o.id !== origemId
                      ? o
                      : { ...o, generalidades: mergeGeneralidades(generalidades) }
                  ),
                }
          )
        );
      },
      salvarOrigem(transportadoraId, origem) {
        setTransportadoras((prev) =>
          prev.map((t) => {
            if (t.id !== transportadoraId) return t;
            const exists = t.origens.some((o) => o.id === origem.id);
            const origens = exists
              ? t.origens.map((o) =>
                  o.id === origem.id ? normalizeOrigem(origem) : o
                )
              : [...t.origens, normalizeOrigem(origem)];
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
          const exists = prev.some((item) => item.id === transportadora.id);
          const normalized = normalizeTransportadora(transportadora);
          return exists
            ? prev.map((item) =>
                item.id === transportadora.id ? normalized : item
              )
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
                    const exists = lista.some((item) => item.id === linha.id);
                    return {
                      ...o,
                      [secao]: exists
                        ? lista.map((item) =>
                            item.id === linha.id ? linha : item
                          )
                        : [...lista, linha],
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
                          [secao]: (o[secao] ?? []).filter(
                            (item) => item.id !== linhaId
                          ),
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
    [transportadoras]
  );

  return api;
}
