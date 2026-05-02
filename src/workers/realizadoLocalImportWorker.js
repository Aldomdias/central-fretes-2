import { parseRealizadoCtesFile } from '../utils/realizadoCtes';
import { prepararRegistrosRealizadoLocal } from '../utils/realizadoLocalEngine';
import { carregarMunicipiosIbgeOficial } from '../utils/ibgeMunicipiosOficial';
import { salvarRealizadoLocal } from '../services/realizadoLocalDb';

function pct(atual, total) {
  const safeTotal = Math.max(Number(total) || 0, 1);
  return Math.min(100, Math.max(0, Math.round((Number(atual || 0) / safeTotal) * 100)));
}

function postProgress(payload) {
  self.postMessage({ type: 'progress', ...payload });
}

function calcularPercentualArquivo(index, totalArquivos, percentualDentroArquivo) {
  const base = (index / Math.max(totalArquivos, 1)) * 100;
  const fatia = 100 / Math.max(totalArquivos, 1);
  return Math.min(99, Math.round(base + (fatia * (percentualDentroArquivo / 100))));
}

function contarIbgeOk(rows = []) {
  return (rows || []).filter((row) => row.ibgeOk || (row.ibgeOrigem && row.ibgeDestino)).length;
}

async function importarRealizadoLocal({ files = [], municipios = [], competencia = '' }) {
  let municipiosReferencia = Array.isArray(municipios) ? municipios : [];

  if (municipiosReferencia.length < 5000) {
    postProgress({
      etapa: 'Carregando IBGE',
      atual: 0,
      total: files.length,
      percentual: 2,
      mensagem: 'Base IBGE incompleta no navegador; tentando baixar a referência oficial do IBGE...',
    });
    try {
      const oficial = await carregarMunicipiosIbgeOficial({ usarCache: true });
      if (oficial.municipios?.length > municipiosReferencia.length) {
        municipiosReferencia = oficial.municipios;
      }
    } catch {
      // Mantém a referência que veio da tela.
    }
  }

  if (!Array.isArray(municipiosReferencia) || !municipiosReferencia.length) {
    throw new Error('Base IBGE não foi carregada. Recarregue a tela e tente novamente; sem IBGE a simulação não consegue cruzar origem/destino.');
  }

  let totalLidos = 0;
  let totalPreparados = 0;
  let totalPendencias = 0;
  let totalSalvos = 0;
  const arquivos = [];
  const erros = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const nome = file?.name || `arquivo-${index + 1}`;
    const totalArquivos = files.length;

    try {
      postProgress({
        etapa: 'Lendo arquivo',
        atual: index + 1,
        total: totalArquivos,
        percentual: calcularPercentualArquivo(index, totalArquivos, 5),
        mensagem: `Lendo ${nome}. Base IBGE disponível: ${municipiosReferencia.length.toLocaleString('pt-BR')} município(s).`,
      });

      const parsed = await parseRealizadoCtesFile(file);
      totalLidos += parsed.registros.length;

      postProgress({
        etapa: 'Gerando base enxuta',
        atual: index + 1,
        total: totalArquivos,
        percentual: calcularPercentualArquivo(index, totalArquivos, 45),
        mensagem: `Gerando base enxuta e chave IBGE de ${nome}: ${parsed.registros.length.toLocaleString('pt-BR')} CT-e(s) lidos...`,
      });

      const { rows, pendencias } = prepararRegistrosRealizadoLocal(parsed.registros, municipiosReferencia, { competencia });
      const ibgeOk = contarIbgeOk(rows);
      if (rows.length && ibgeOk === 0) {
        throw new Error(`Nenhum IBGE foi localizado em ${nome}. A importação foi interrompida para não salvar uma base que não simula. Verifique se a base IBGE/tabelas foi carregada.`);
      }
      totalPreparados += rows.length;
      totalPendencias += pendencias.length;

      postProgress({
        etapa: 'Gravando base local',
        atual: 0,
        total: rows.length,
        percentual: calcularPercentualArquivo(index, totalArquivos, 65),
        mensagem: `Gravando ${rows.length.toLocaleString('pt-BR')} CT-e(s) de ${nome}; ${ibgeOk.toLocaleString('pt-BR')} com IBGE e ${pendencias.length.toLocaleString('pt-BR')} pendência(s)...`,
      });

      const save = await salvarRealizadoLocal(rows, {
        chunkSize: 1000,
        onProgress: ({ salvos, total }) => {
          const interno = 65 + Math.round(pct(salvos, total) * 0.30);
          postProgress({
            etapa: 'Gravando base local',
            atual: salvos,
            total,
            percentual: calcularPercentualArquivo(index, totalArquivos, interno),
            mensagem: `${salvos.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')} CT-e(s) gravados de ${nome}...`,
          });
        },
      });

      totalSalvos += save.salvos || rows.length;
      arquivos.push({
        nome,
        lidos: parsed.registros.length,
        preparados: rows.length,
        pendencias: pendencias.length,
        ibgeOk,
        salvos: save.salvos || rows.length,
      });

      postProgress({
        etapa: 'Arquivo concluído',
        atual: index + 1,
        total: totalArquivos,
        percentual: calcularPercentualArquivo(index + 1, totalArquivos, 0),
        mensagem: `${nome} concluído: ${(save.salvos || rows.length).toLocaleString('pt-BR')} CT-e(s) salvos localmente.`,
      });
    } catch (error) {
      erros.push({ nome, erro: error?.message || 'Erro desconhecido' });
      postProgress({
        etapa: 'Erro no arquivo',
        atual: index + 1,
        total: totalArquivos,
        percentual: calcularPercentualArquivo(index + 1, totalArquivos, 0),
        mensagem: `Erro ao processar ${nome}: ${error?.message || 'erro desconhecido'}`,
      });
    }
  }

  return { totalLidos, totalPreparados, totalPendencias, totalSalvos, arquivos, erros };
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  if (msg.type !== 'importar-realizado-local') return;

  try {
    const result = await importarRealizadoLocal(msg);
    self.postMessage({ type: 'done', result });
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || 'Erro ao importar realizado local.' });
  }
};
