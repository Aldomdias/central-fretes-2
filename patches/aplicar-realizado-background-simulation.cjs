#!/usr/bin/env node
/**
 * Patch: Realizado Local - simulação em segundo plano
 *
 * Executar na raiz do projeto:
 *   node patches/aplicar-realizado-background-simulation.cjs
 *
 * Depois:
 *   npm run build
 *   git add src patches
 *   git commit -m "Melhora simulação local em segundo plano"
 */

const fs = require('fs');
const path = require('path');

const root = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function write(rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  console.log(`OK: ${rel}`);
}

function patchFile(rel, patcher) {
  const oldContent = read(rel);
  const newContent = patcher(oldContent);
  if (newContent === oldContent) {
    console.log(`SEM ALTERAÇÃO: ${rel}`);
    return;
  }
  write(rel, newContent);
}

const backgroundSimulationService = `let currentState = {
  id: null,
  status: 'idle',
  progress: null,
  result: null,
  error: '',
  meta: null,
  startedAt: null,
  finishedAt: null,
};

let currentWorker = null;
const listeners = new Set();

function cloneState() {
  return {
    ...currentState,
    progress: currentState.progress ? { ...currentState.progress } : null,
    meta: currentState.meta ? { ...currentState.meta } : null,
  };
}

function emit() {
  const snapshot = cloneState();
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      // listener isolado
    }
  });
}

export function subscribeBackgroundSimulation(listener) {
  listeners.add(listener);
  listener(cloneState());
  return () => listeners.delete(listener);
}

export function getBackgroundSimulationState() {
  return cloneState();
}

export function hasBackgroundSimulationRunning() {
  return currentState.status === 'running' || currentState.status === 'starting' || currentState.status === 'cancelling';
}

export function clearBackgroundSimulation() {
  if (hasBackgroundSimulationRunning()) return;
  currentState = {
    id: null,
    status: 'idle',
    progress: null,
    result: null,
    error: '',
    meta: null,
    startedAt: null,
    finishedAt: null,
  };
  emit();
}

export function cancelBackgroundSimulation() {
  if (!currentWorker || !hasBackgroundSimulationRunning()) return;
  currentState = {
    ...currentState,
    status: 'cancelling',
    progress: {
      ...(currentState.progress || {}),
      etapa: 'Cancelando simulação',
      mensagem: 'Aguardando o lote atual terminar para cancelar com segurança...',
    },
  };
  emit();
  currentWorker.postMessage({ type: 'cancel' });
}

export function startBackgroundSimulation(payload = {}) {
  if (hasBackgroundSimulationRunning()) {
    throw new Error('Já existe uma simulação rodando. Aguarde concluir ou cancele antes de iniciar outra.');
  }

  if (typeof Worker === 'undefined') {
    throw new Error('Este navegador não suporta Worker. Não foi possível iniciar a simulação em segundo plano.');
  }

  const id = \`sim-\${Date.now()}\`;
  const total = payload?.realizados?.length || 0;
  const meta = {
    ...(payload.meta || {}),
    total,
    transportadora: payload.nomeTransportadora || payload.meta?.transportadora || '',
    modo: payload.modoSimulacao || payload.meta?.modo || 'rapido',
  };

  currentWorker = new Worker(new URL('../workers/realizadoLocalSimulationWorker.js', import.meta.url), {
    type: 'module',
  });

  currentState = {
    id,
    status: 'starting',
    progress: {
      etapa: 'Preparando simulação em segundo plano',
      atual: 0,
      total,
      percentual: 1,
      mensagem: 'Enviando dados para o processador local. Você pode navegar nas outras telas.',
    },
    result: null,
    error: '',
    meta,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  emit();

  currentWorker.onmessage = (event) => {
    const msg = event.data || {};

    if (msg.type === 'progress') {
      currentState = {
        ...currentState,
        status: 'running',
        progress: {
          etapa: msg.etapa || msg.progress?.etapa || 'Simulando em segundo plano',
          atual: msg.atual ?? msg.progress?.atual ?? 0,
          total: msg.total ?? msg.progress?.total ?? total,
          percentual: msg.percentual ?? msg.progress?.percentual ?? 0,
          mensagem: msg.mensagem || msg.progress?.mensagem || 'A simulação continua rodando em segundo plano.',
        },
      };
      emit();
      return;
    }

    if (msg.type === 'done') {
      currentWorker?.terminate();
      currentWorker = null;
      currentState = {
        ...currentState,
        status: 'done',
        result: msg.result || null,
        error: '',
        progress: {
          etapa: 'Simulação concluída',
          atual: total,
          total,
          percentual: 100,
          mensagem: 'Resultado pronto. Abra o Realizado Local para visualizar o detalhe.',
        },
        finishedAt: new Date().toISOString(),
      };
      emit();
      return;
    }

    if (msg.type === 'cancelled') {
      currentWorker?.terminate();
      currentWorker = null;
      currentState = {
        ...currentState,
        status: 'cancelled',
        progress: {
          ...(currentState.progress || {}),
          etapa: 'Simulação cancelada',
          mensagem: 'A simulação foi cancelada pelo usuário.',
        },
        finishedAt: new Date().toISOString(),
      };
      emit();
      return;
    }

    if (msg.type === 'error') {
      currentWorker?.terminate();
      currentWorker = null;
      currentState = {
        ...currentState,
        status: 'error',
        error: msg.message || 'Erro ao simular em segundo plano.',
        progress: {
          ...(currentState.progress || {}),
          etapa: 'Erro na simulação',
          mensagem: msg.message || 'Erro ao simular em segundo plano.',
        },
        finishedAt: new Date().toISOString(),
      };
      emit();
    }
  };

  currentWorker.onerror = (event) => {
    currentWorker?.terminate();
    currentWorker = null;
    currentState = {
      ...currentState,
      status: 'error',
      error: event.message || 'Erro no Worker de simulação.',
      progress: {
        ...(currentState.progress || {}),
        etapa: 'Erro no processador',
        mensagem: event.message || 'Erro no Worker de simulação.',
      },
      finishedAt: new Date().toISOString(),
    };
    emit();
  };

  currentWorker.postMessage({
    type: 'start',
    id,
    payload,
  });

  return id;
}
`;

const simulationWorker = `import { simularRealizadoLocalRapido } from '../utils/realizadoLocalEngine';

let cancelled = false;

function postProgress(payload = {}) {
  self.postMessage({
    type: 'progress',
    ...payload,
  });
}

self.onmessage = async (event) => {
  const msg = event.data || {};

  if (msg.type === 'cancel') {
    cancelled = true;
    return;
  }

  if (msg.type !== 'start') return;

  cancelled = false;
  const payload = msg.payload || {};
  const total = payload?.realizados?.length || 0;

  try {
    postProgress({
      etapa: 'Simulação em segundo plano',
      atual: 0,
      total,
      percentual: 2,
      mensagem: 'Processador iniciado. A simulação seguirá mesmo se você navegar em outras telas.',
    });

    const result = await simularRealizadoLocalRapido({
      realizados: payload.realizados || [],
      transportadoras: payload.transportadoras || [],
      municipios: payload.municipios || [],
      nomeTransportadora: payload.nomeTransportadora || '',
      modoSimulacao: payload.modoSimulacao || 'rapido',
      onProgress: ({ atual = 0, total: totalProgress = total, etapa = 'Calculando fretes localmente' } = {}) => {
        if (cancelled) {
          throw new Error('__SIMULACAO_CANCELADA__');
        }

        const safeTotal = Math.max(Number(totalProgress) || 1, 1);
        const percentual = Math.min(99, 5 + Math.round((Number(atual || 0) / safeTotal) * 94));

        postProgress({
          etapa,
          atual,
          total: totalProgress,
          percentual,
          mensagem: \`\${Number(atual || 0).toLocaleString('pt-BR')} de \${Number(totalProgress || 0).toLocaleString('pt-BR')} CT-e(s) simulados em segundo plano...\`,
        });
      },
    });

    if (cancelled) {
      self.postMessage({ type: 'cancelled' });
      return;
    }

    self.postMessage({ type: 'done', result });
  } catch (error) {
    if (String(error?.message || '') === '__SIMULACAO_CANCELADA__') {
      self.postMessage({ type: 'cancelled' });
      return;
    }

    self.postMessage({
      type: 'error',
      message: error?.message || 'Erro ao simular em segundo plano.',
    });
  }
};
`;

const floatingComponent = `import { useEffect, useState } from 'react';
import {
  cancelBackgroundSimulation,
  clearBackgroundSimulation,
  subscribeBackgroundSimulation,
} from '../services/backgroundSimulationService';

function formatStatus(status) {
  if (status === 'running' || status === 'starting') return 'Rodando';
  if (status === 'cancelling') return 'Cancelando';
  if (status === 'done') return 'Concluída';
  if (status === 'error') return 'Erro';
  if (status === 'cancelled') return 'Cancelada';
  return '';
}

export default function SimulationFloatingStatus({ onOpen }) {
  const [job, setJob] = useState(null);

  useEffect(() => subscribeBackgroundSimulation(setJob), []);

  if (!job || job.status === 'idle') return null;

  const progress = job.progress || {};
  const isRunning = ['starting', 'running', 'cancelling'].includes(job.status);
  const percentual = Math.min(100, Math.max(0, Number(progress.percentual || 0)));

  return (
    <div
      style={{
        position: 'fixed',
        right: 18,
        bottom: 18,
        width: 340,
        zIndex: 9999,
        background: '#ffffff',
        border: '1px solid rgba(6, 31, 79, 0.18)',
        boxShadow: '0 18px 45px rgba(6, 31, 79, 0.18)',
        borderRadius: 18,
        padding: 14,
        color: '#061f4f',
      }}
    >
      <style>{\`
        @keyframes amdLogSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      \`}</style>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: '50%',
            background: '#061f4f',
            color: '#fff',
            display: 'grid',
            placeItems: 'center',
            fontSize: 10,
            fontWeight: 800,
            animation: isRunning ? 'amdLogSpin 1.1s linear infinite' : 'none',
            flex: '0 0 auto',
          }}
          title="AMD Log"
        >
          AMD
        </div>
        <div style={{ minWidth: 0 }}>
          <strong style={{ display: 'block', fontSize: 14 }}>
            Simulação Realizado Local
          </strong>
          <span style={{ display: 'block', fontSize: 12, opacity: 0.78 }}>
            {formatStatus(job.status)} • {job.meta?.transportadora || 'Transportadora'}
          </span>
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.35 }}>
        <strong>{progress.etapa || 'Processando'}</strong>
        <div style={{ opacity: 0.8 }}>{progress.mensagem || 'Simulação em andamento.'}</div>
      </div>

      <div style={{ marginTop: 10, height: 8, background: 'rgba(6,31,79,0.10)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ width: \`\${percentual}%\`, height: '100%', background: '#9153F0', borderRadius: 999, transition: 'width 180ms ease' }} />
      </div>

      <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>{Math.round(percentual)}%</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onOpen} style={{ border: '1px solid rgba(6,31,79,0.18)', background: '#fff', color: '#061f4f', borderRadius: 10, padding: '7px 10px', fontWeight: 700, cursor: 'pointer' }}>
            Abrir
          </button>
          {isRunning ? (
            <button type="button" onClick={cancelBackgroundSimulation} style={{ border: '1px solid #ffd0cc', background: '#fff4f2', color: '#b42318', borderRadius: 10, padding: '7px 10px', fontWeight: 700, cursor: 'pointer' }}>
              Cancelar
            </button>
          ) : (
            <button type="button" onClick={clearBackgroundSimulation} style={{ border: '1px solid rgba(6,31,79,0.18)', background: '#f8fafc', color: '#061f4f', borderRadius: 10, padding: '7px 10px', fontWeight: 700, cursor: 'pointer' }}>
              Ocultar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
`;

write('src/services/backgroundSimulationService.js', backgroundSimulationService);
write('src/workers/realizadoLocalSimulationWorker.js', simulationWorker);
write('src/components/SimulationFloatingStatus.jsx', floatingComponent);

patchFile('src/App.jsx', (content) => {
  let next = content;
  if (!next.includes("SimulationFloatingStatus")) {
    next = next.replace(
      "import Sidebar from './components/Sidebar';",
      "import Sidebar from './components/Sidebar';\nimport SimulationFloatingStatus from './components/SimulationFloatingStatus';"
    );
  }
  if (!next.includes("<SimulationFloatingStatus")) {
    next = next.replace(
      '      <main className="app-content">{content}</main>\n    </div>',
      '      <main className="app-content">{content}</main>\n      <SimulationFloatingStatus onOpen={() => setPaginaAtual(\'realizado-local\')} />\n    </div>'
    );
  }
  return next;
});

patchFile('src/pages/RealizadoLocalPage.jsx', (content) => {
  let next = content;

  if (!next.includes("backgroundSimulationService")) {
    next = next.replace(
      "import { carregarBaseCompletaDb, carregarMunicipiosIbgeDb } from '../services/freteDatabaseService';",
      "import { carregarBaseCompletaDb, carregarMunicipiosIbgeDb } from '../services/freteDatabaseService';\nimport {\n  getBackgroundSimulationState,\n  startBackgroundSimulation,\n  subscribeBackgroundSimulation,\n} from '../services/backgroundSimulationService';"
    );
  }

  if (!next.includes("backgroundSimulation, setBackgroundSimulation")) {
    next = next.replace(
      "  const [escopoSimulacao, setEscopoSimulacao] = useState(null);",
      "  const [escopoSimulacao, setEscopoSimulacao] = useState(null);\n  const [backgroundSimulation, setBackgroundSimulation] = useState(() => getBackgroundSimulationState());"
    );
  }

  if (!next.includes("subscribeBackgroundSimulation((nextJob)")) {
    next = next.replace(
      "\n  function alterarFiltro(campo, valor) {",
      `
  useEffect(() => {
    return subscribeBackgroundSimulation((nextJob) => {
      setBackgroundSimulation({ ...nextJob });
    });
  }, []);

  useEffect(() => {
    if (!backgroundSimulation || backgroundSimulation.status === 'idle') return;

    if (['starting', 'running', 'cancelling'].includes(backgroundSimulation.status)) {
      const p = backgroundSimulation.progress || {};
      setProgress({
        etapa: p.etapa || 'Simulando em segundo plano',
        atual: p.atual || 0,
        total: p.total || backgroundSimulation.meta?.total || 0,
        percentual: p.percentual || 0,
        mensagem: p.mensagem || 'A simulação continua rodando. Você pode navegar nas outras telas.',
      });
      setFeedback(backgroundSimulation.meta?.label || 'Simulação rodando em segundo plano. Você pode navegar nas outras telas.');
      return;
    }

    if (backgroundSimulation.status === 'done') {
      if (backgroundSimulation.result) setResultado(backgroundSimulation.result);
      setProgress(null);
      setSimulando(false);
      const resumoBg = backgroundSimulation.result?.resumo || {};
      setFeedback(
        \`Simulação em segundo plano concluída: \${Number(resumoBg.ctesComSimulacao || 0).toLocaleString('pt-BR')} CT-e(s) avaliados e \${Number(resumoBg.ctesForaMalha || 0).toLocaleString('pt-BR')} fora da malha.\`
      );
      return;
    }

    if (backgroundSimulation.status === 'error') {
      setErro(backgroundSimulation.error || 'Erro na simulação em segundo plano.');
      setProgress(null);
      setSimulando(false);
      return;
    }

    if (backgroundSimulation.status === 'cancelled') {
      setFeedback('Simulação cancelada.');
      setProgress(null);
      setSimulando(false);
    }
  }, [backgroundSimulation]);

  function alterarFiltro(campo, valor) {`
    );
  }

  const startToken = "      const analise = await simularRealizadoLocalRapido({";
  const catchToken = "\n    } catch (error) {";
  const startIndex = next.indexOf(startToken);
  const catchIndex = next.indexOf(catchToken, startIndex);

  if (startIndex !== -1 && catchIndex !== -1 && !next.slice(startIndex, catchIndex).includes("startBackgroundSimulation")) {
    const replacement = `      await startBackgroundSimulation({
        realizados: rows,
        transportadoras: baseTabelas,
        municipios,
        nomeTransportadora: filtros.transportadora,
        modoSimulacao,
        meta: {
          label: \`Simulação de \${filtros.transportadora} rodando em segundo plano. Você pode navegar nas outras telas.\`,
          transportadora: filtros.transportadora,
          modo: modoSimulacao,
          total: rows.length,
        },
      });

      setSimulando(false);
      setProgress({
        etapa: 'Simulação em segundo plano',
        atual: 0,
        total: rows.length,
        percentual: 35,
        mensagem: 'Simulação iniciada em segundo plano. Você pode navegar nas outras telas do sistema.',
      });
      setFeedback(\`Simulação iniciada em segundo plano: \${rows.length.toLocaleString('pt-BR')} CT-e(s). Você pode navegar nas outras telas.\`);`;

    next = next.slice(0, startIndex) + replacement + next.slice(catchIndex);
  }

  const oldFinally = `    } finally {
      setSimulando(false);
      setTimeout(() => setProgress(null), 2500);
    }`;

  if (next.includes(oldFinally)) {
    next = next.replace(
      oldFinally,
      `    } finally {
      setSimulando(false);
      const bgStatus = getBackgroundSimulationState().status;
      if (bgStatus !== 'running' && bgStatus !== 'starting') {
        setTimeout(() => setProgress(null), 2500);
      }
    }`
    );
  }

  return next;
});

console.log('\nPatch aplicado. Agora rode:');
console.log('  npm run build');
console.log('  git diff');
