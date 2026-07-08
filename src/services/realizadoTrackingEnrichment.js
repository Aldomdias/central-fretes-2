import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient.js';
import { resolverCubagemTracking, validarCubagemOperacional, criarTrackingAgregado, somarTrackingAgregado } from '../utils/trackingCubagem.js';

function numero(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

export function apenasDigitosTracking(value = '') {
  return String(value || '').replace(/\D/g, '');
}

export function normalizarChaveLongaTracking(value = '') {
  return apenasDigitosTracking(value);
}

function chaveCteTracking(row = {}) {
  const usarOriginal = Object.prototype.hasOwnProperty.call(row, 'chaveCteOriginal');
  return normalizarChaveLongaTracking(usarOriginal ? row.chaveCteOriginal : row.chaveCte);
}

function chunksTracking(lista = [], tamanho = 300) {
  const saida = [];
  for (let i = 0; i < lista.length; i += tamanho) saida.push(lista.slice(i, i + tamanho));
  return saida;
}

export function cubagemRealizadoTracking(row = {}) {
  // Mesma regra do Simulador Realizado: cubagem so e confiavel quando veio do Tracking.
  if (!row.trackingMatch) return 0;

  const total = numero(row.cubagemTotal || row.cubagem_total);
  if (total > 0) return total;

  const unitaria = numero(row.cubagemUnitaria || row.cubagem_unitaria);
  const volumes = numero(row.qtdVolumes || row.volumes || row.volume);
  return unitaria > 0 && volumes > 0 ? unitaria * volumes : 0;
}

const validarCubagemTracking = validarCubagemOperacional;

// criarTrackingAgregado/somarTrackingAgregado agora vivem em utils/trackingCubagem.js
// (compartilhados com o SimuladorPage e testados em test/freteCalcEngine.test.js).

function adicionarTrackingNoMapa(mapa, chave, item) {
  if (!chave) return;
  const atual = mapa.get(chave);
  mapa.set(chave, somarTrackingAgregado(atual, item));
}

export async function buscarTrackingParaRealizado(rows = []) {
  const vazio = {
    mapaChaveCte: new Map(),
    mapaChaveNfe: new Map(),
    mapaNota: new Map(),
    mapaNumeroCte: new Map(),
    total: 0,
    erro: '',
  };

  if (!isSupabaseConfigured() || !rows?.length) return vazio;

  const chavesCte = [...new Set(rows.map((r) => chaveCteTracking(r)).filter((v) => v.length >= 20))];
  const chavesNfe = [...new Set(rows.map((r) => normalizarChaveLongaTracking(r.chaveNfe)).filter((v) => v.length >= 20))];
  const notas = [...new Set(rows.map((r) => apenasDigitosTracking(r.notaFiscal)).filter(Boolean))];
  const numerosCte = [...new Set(rows.map((r) => apenasDigitosTracking(r.numeroCte)).filter(Boolean))];

  if (!chavesCte.length && !chavesNfe.length && !notas.length && !numerosCte.length) return vazio;

  const supabase = getSupabaseClient();
  const mapaChaveCte = new Map();
  const mapaChaveNfe = new Map();
  const mapaNota = new Map();
  const mapaNumeroCte = new Map();
  let totalEncontrado = 0;
  let erroView = '';

  async function consultarViewAgregadaPorChaveCte(chavesConsulta = chavesCte) {
    if (!chavesConsulta.length) return false;
    let consultou = false;
    for (const parte of chunksTracking(chavesConsulta, 300)) {
      if (!parte.length) continue;
      const { data, error } = await supabase
        .from('vw_tracking_cte_agregado')
        .select('chave_cte_limpa,chave_cte,chave_nfe,cte_numero,nota_fiscal,canal,transportadora,cidade_origem,uf_origem,ibge_origem,cidade_destino,uf_destino,ibge_destino,peso,peso_declarado,peso_cubado,cubagem_unitaria,cubagem_total,valor_nf,qtd_volumes,linhas_tracking,data_transporte,data_entrega,previsao_transportadora')
        .in('chave_cte_limpa', parte);

      if (error) {
        erroView = error.message || String(error);
        return false;
      }

      consultou = true;
      (data || []).forEach((item) => {
        const chave = normalizarChaveLongaTracking(item.chave_cte_limpa || item.chave_cte);
        adicionarTrackingNoMapa(mapaChaveCte, chave, criarTrackingAgregado(item, 'VIEW_CHAVE_CTE'));
        totalEncontrado += Number(item.linhas_tracking || 1);
      });
    }
    return consultou;
  }

  async function consultarRawPorColuna(coluna, valores, tipo) {
    for (const parte of chunksTracking(valores, 300)) {
      if (!parte.length) continue;
      const { data, error } = await supabase
        .from('tracking_rows')
        .select('chave_nfe,chave_cte,cte_numero,nota_fiscal,canal,transportadora,cidade_origem,uf_origem,ibge_origem,cidade_destino,uf_destino,ibge_destino,peso,peso_declarado,peso_cubado,cubagem_unitaria,cubagem_total,cubagem_final,quantidade_itens,valor_nf,qtd_volumes,data_transporte,data_entrega,previsao_transportadora,raw')
        .in(coluna, parte);
      if (error) throw error;

      (data || []).forEach((item) => {
        totalEncontrado += 1;
        if (tipo === 'CHAVE_CTE') adicionarTrackingNoMapa(mapaChaveCte, normalizarChaveLongaTracking(item.chave_cte), criarTrackingAgregado(item, 'RAW_CHAVE_CTE'));
        if (tipo === 'CHAVE_NFE') adicionarTrackingNoMapa(mapaChaveNfe, normalizarChaveLongaTracking(item.chave_nfe), criarTrackingAgregado(item, 'RAW_CHAVE_NFE'));
        if (tipo === 'NOTA') adicionarTrackingNoMapa(mapaNota, apenasDigitosTracking(item.nota_fiscal), criarTrackingAgregado(item, 'RAW_NOTA_FISCAL'));
        if (tipo === 'NUMERO_CTE') adicionarTrackingNoMapa(mapaNumeroCte, apenasDigitosTracking(item.cte_numero), criarTrackingAgregado(item, 'RAW_NUMERO_CTE'));
      });
    }
  }

  try {
    let erroRawChaves = null;
    if (chavesCte.length) {
      try {
        // As linhas brutas preservam a cubagem original de cada NF do CT-e.
        // A view pode somar totais que ja vieram multiplicados pelos volumes.
        await consultarRawPorColuna('chave_cte', chavesCte, 'CHAVE_CTE');
      } catch (error) {
        erroRawChaves = error;
      }
    }

    const chavesSemRaw = chavesCte.filter((chave) => !mapaChaveCte.has(chave));
    const viewOk = chavesSemRaw.length
      ? await consultarViewAgregadaPorChaveCte(chavesSemRaw)
      : true;

    if (erroRawChaves && !viewOk) throw erroRawChaves;
    if (chavesNfe.length) await consultarRawPorColuna('chave_nfe', chavesNfe, 'CHAVE_NFE');
    if (notas.length) await consultarRawPorColuna('nota_fiscal', notas, 'NOTA');
    if (numerosCte.length) await consultarRawPorColuna('cte_numero', numerosCte, 'NUMERO_CTE');
  } catch (error) {
    console.warn('Tracking no Supabase indisponivel para enriquecer realizado.', error?.message || error);
    return { ...vazio, erro: error?.message || String(error || '') };
  }

  return {
    mapaChaveCte,
    mapaChaveNfe,
    mapaNota,
    mapaNumeroCte,
    total: totalEncontrado,
    erro: '',
    aviso: erroView ? `View agregada indisponivel, usado fallback raw: ${erroView}` : '',
  };
}

export function obterTrackingDaLinha(row = {}, mapas) {
  if (!mapas) return null;
  const chaveCte = chaveCteTracking(row);
  const chaveNfe = normalizarChaveLongaTracking(row.chaveNfe);
  const nota = apenasDigitosTracking(row.notaFiscal);
  const numeroCte = apenasDigitosTracking(row.numeroCte);

  const porChaveCte = chaveCte ? mapas.mapaChaveCte?.get(chaveCte) : null;
  const porChaveNfe = chaveNfe ? mapas.mapaChaveNfe?.get(chaveNfe) : null;
  const porNota = nota ? mapas.mapaNota?.get(nota) : null;
  const porNumeroCte = numeroCte ? mapas.mapaNumeroCte?.get(numeroCte) : null;

  const origemCte = String(porChaveCte?.origem_vinculo_tracking || '');
  const rawPreferencial = [porChaveNfe, porNota, porNumeroCte].find((item) => item && !String(item.origem_vinculo_tracking || '').startsWith('VIEW_'));
  if (rawPreferencial && (!porChaveCte || origemCte.startsWith('VIEW_'))) return rawPreferencial;

  if (porChaveCte) return porChaveCte;
  if (porChaveNfe) return porChaveNfe;
  if (porNota) return porNota;
  if (porNumeroCte) return porNumeroCte;

  return null;
}

export function enriquecerRealizadoComTracking(rows = [], mapasTracking) {
  let vinculados = 0;
  let semTracking = 0;
  let volumesTracking = 0;
  let cubagemTracking = 0;
  let cubagemOutliers = 0;

  const linhas = (rows || []).map((row) => {
    const tracking = obterTrackingDaLinha(row, mapasTracking);

    if (!tracking) {
      semTracking += 1;
      return {
        ...row,
        trackingMatch: false,
        trackingPendente: true,
        qtdVolumes: 0,
        cubagem: 0,
        cubagemUnitaria: 0,
        cubagemTotal: 0,
        metrosCubicos: 0,
        pesoCubado: 0,
      };
    }

    vinculados += 1;

    const qtdVolumesTracking = numero(tracking.qtd_volumes);
    const cubagemUnitariaTracking = numero(tracking.cubagem_unitaria);
    const cubagemTotalDiretaTracking = numero(tracking.cubagem_total);
    const cubagemTotalTracking = cubagemTotalDiretaTracking > 0
      ? cubagemTotalDiretaTracking
      : cubagemUnitariaTracking > 0 && qtdVolumesTracking > 0
        ? cubagemUnitariaTracking * qtdVolumesTracking
        : 0;

    const pesoFisico = numero(row.peso)
      || numero(tracking.peso)
      || numero(row.pesoDeclarado)
      || numero(tracking.peso_declarado);
    const cubagemResolvida = resolverCubagemTracking({
      cubagemUnitaria: cubagemUnitariaTracking,
      cubagemTotal: cubagemTotalTracking,
      volumes: qtdVolumesTracking,
      pesoFisico,
    });
    const cubagemFoiMultiplicadaPorVolumes = cubagemResolvida.totalFoiMultiplicadoPorVolumes;
    const cubagemCandidata = cubagemResolvida.cubagemAplicada;
    const cubagemValidada = validarCubagemTracking({
      cubagemTotal: cubagemCandidata,
      qtdVolumes: qtdVolumesTracking,
      peso: pesoFisico,
    });
    const cubagemUnitariaComoTotal = cubagemValidada.outlier
      && cubagemUnitariaTracking > 0
      && cubagemUnitariaTracking <= cubagemValidada.limiteCubagem
      ? cubagemUnitariaTracking
      : 0;
    const cubagemTotalAplicada = cubagemUnitariaComoTotal || cubagemValidada.cubagemTotal;
    const pesoCubadoTracking = cubagemValidada.outlier ? 0 : numero(tracking.peso_cubado);

    if (cubagemValidada.outlier) cubagemOutliers += 1;
    if (qtdVolumesTracking > 0) volumesTracking += qtdVolumesTracking;
    if (cubagemTotalAplicada > 0) cubagemTracking += cubagemTotalAplicada;

    return {
      ...row,
      trackingMatch: true,
      trackingPendente: false,
      trackingTransportadora: tracking.transportadora || '',
      trackingLinhas: Number(tracking.linhas_tracking || 1),
      trackingOrigemVinculo: tracking.origem_vinculo_tracking || '',

      chaveCte: row.chaveCte || tracking.chave_cte || '',
      chaveNfe: row.chaveNfe || tracking.chave_nfe || '',
      notaFiscal: row.notaFiscal || tracking.nota_fiscal || '',
      numeroCte: row.numeroCte || tracking.cte_numero || '',

      qtdVolumes: qtdVolumesTracking,
      cubagem: cubagemTotalAplicada,
      cubagemUnitaria: cubagemUnitariaTracking,
      cubagemTotal: cubagemTotalAplicada,
      metrosCubicos: cubagemTotalAplicada,
      cubagemTotalOriginalTracking: cubagemValidada.cubagemOriginal,
      cubagemOutlierTracking: cubagemValidada.outlier,
      cubagemCorrigidaTracking: Boolean(cubagemFoiMultiplicadaPorVolumes || cubagemUnitariaComoTotal),
      cubagemTotalArmazenadaTracking: cubagemTotalTracking,
      limiteCubagemTracking: cubagemValidada.limiteCubagem,
      pesoCubado: pesoCubadoTracking,

      // Preserva o peso físico do CT-e; Tracking é somente fallback.
      pesoDeclarado: pesoFisico,
      valorNF: numero(row.valorNF) || numero(tracking.valor_nf),

      canal: row.canal || tracking.canal || '',
      ibgeOrigem: row.ibgeOrigem || String(tracking.ibge_origem || '').replace(/\D/g, '').slice(0, 7),
      ibgeDestino: row.ibgeDestino || String(tracking.ibge_destino || '').replace(/\D/g, '').slice(0, 7),
      cidadeOrigem: row.cidadeOrigem || tracking.cidade_origem || '',
      ufOrigem: row.ufOrigem || String(tracking.uf_origem || '').toUpperCase(),
      cidadeDestino: row.cidadeDestino || tracking.cidade_destino || '',
      ufDestino: row.ufDestino || String(tracking.uf_destino || '').toUpperCase(),
    };
  });

  return {
    linhas,
    vinculados,
    semTracking,
    volumesTracking,
    cubagemTracking,
    cubagemOutliers,
    erroTracking: mapasTracking?.erro || '',
    avisoTracking: mapasTracking?.aviso || '',
  };
}
