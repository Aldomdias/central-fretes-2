import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { obterRaizCnpj, raizCnpjValida } from '../utils/cnpj';
import { normalizarNomeTransportadora } from '../utils/canalTransportadora';
import { salvarDetalhesFaturaSupabase, salvarFaturaSupabase } from './lotacaoSupabaseService';
import { carregarMapaNomeOficialPorRaizCnpj, listarCarteirasAuditoria } from './auditoriaFretesService';
import { aplicarVinculoTransportadora, carregarVinculosTransportadoras, criarMapaVinculosTransportadoras } from './vinculosTransportadorasService';

const semZeros = (v) => String(v ?? '').trim().replace(/^0+(?=.)/, '');

// Faturas ja gravadas (qualquer origem, Verum ou DocCob) com os mesmos numeros.
// Casa por numero + raiz do CNPJ, sem exigir a mesma serie (o Verum e o DocCob
// nem sempre trazem a serie igual) — evita duplicar fatura ja importada.
async function buscarExistentes(faturas) {
  const supabase = getSupabaseClient();
  const numeros = [...new Set(faturas.map((f) => f.numero_fatura))];
  const mapa = new Map();
  for (let i = 0; i < numeros.length; i += 200) {
    const { data, error } = await supabase
      .from('faturas')
      .select('id, numero_fatura, cnpj_transportadora, created_at')
      .in('numero_fatura', numeros.slice(i, i + 200));
    if (error) throw new Error(`Erro ao verificar faturas existentes: ${error.message}`);
    [...(data || [])]
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
      .forEach((row) => {
        const chave = `${semZeros(row.numero_fatura)}::${obterRaizCnpj(row.cnpj_transportadora)}`;
        if (!mapa.has(chave)) mapa.set(chave, row.id);
      });
  }
  return mapa;
}

// Preview: quantas faturas sao novas e quantas ja existem no sistema.
export async function analisarFaturasDoccob(faturas) {
  if (!isSupabaseConfigured()) return { existentes: new Set() };
  const mapa = await buscarExistentes(faturas);
  const existentes = new Set();
  faturas.forEach((f) => {
    if (mapa.has(`${semZeros(f.numero_fatura)}::${obterRaizCnpj(f.cnpj_transportadora)}`)) existentes.add(f);
  });
  return { existentes };
}

async function numerosCtesDaFatura(faturaId) {
  const supabase = getSupabaseClient();
  const numeros = new Set();
  for (let ini = 0; ; ini += 1000) {
    const { data, error } = await supabase
      .from('fatura_detalhes')
      .select('numero_cte')
      .eq('fatura_id', faturaId)
      .range(ini, ini + 999);
    if (error) throw new Error(error.message);
    (data || []).forEach((r) => numeros.add(semZeros(r.numero_cte)));
    if ((data || []).length < 1000) break;
  }
  return numeros;
}

function detalheDoCte(cte, faturaId, fatura) {
  return {
    fatura_id: faturaId,
    numero_fatura: fatura.numero_fatura,
    serie_fatura: fatura.serie_fatura,
    transportadora: fatura.transportadora,
    cnpj_transportadora: fatura.cnpj_transportadora,
    numero_cte: cte.numero_cte,
    serie_cte: cte.serie_cte,
    mes_ano_emissao_cte: cte.data_emissao ? `${cte.data_emissao.slice(5, 7)}/${cte.data_emissao.slice(0, 4)}` : '',
    cnpj_emissor: cte.cnpj_emissor,
    cnpj_tomador: cte.cnpj_tomador || fatura.cnpj_tomador,
    nome_tomador: fatura.nome_tomador,
    valor_frete: cte.valor_frete,
    custo_frete: cte.valor_frete,
    status: 'PENDENTE',
    observacao: cte.notas.length ? `NF: ${cte.notas.map((n) => n.numero).join(', ')}` : '',
  };
}

// Grava as faturas do DocCob no mesmo destino da importacao Verum
// (faturas + fatura_detalhes). Fatura que ja existe nao e sobrescrita: so
// entram os CT-es que ainda nao estao nela (nao apaga calculo/tratativa).
export async function importarFaturasDoccob(faturas, { usuario = '', onProgresso } = {}) {
  if (!isSupabaseConfigured()) throw new Error('Supabase nao configurado.');
  const existentes = await buscarExistentes(faturas);
  const vinculos = criarMapaVinculosTransportadoras(await carregarVinculosTransportadoras().catch(() => []));
  const nomeOficial = await carregarMapaNomeOficialPorRaizCnpj().catch(() => new Map());
  const carteiras = await listarCarteirasAuditoria().catch(() => []);

  const auditorPorRaiz = new Map();
  const auditorPorNome = new Map();
  carteiras.forEach((c) => {
    if (!c.auditor_nome) return;
    const dados = { auditor_nome: c.auditor_nome, auditor_email: c.auditor_email || '' };
    const raiz = obterRaizCnpj(c.cnpj_transportadora);
    if (raizCnpjValida(raiz)) auditorPorRaiz.set(raiz, dados);
    auditorPorNome.set(normalizarNomeTransportadora(aplicarVinculoTransportadora(c.transportadora, vinculos)), dados);
  });

  const resumo = { novas: 0, existentes: 0, ctesGravados: 0, ctesJaExistiam: 0, erros: [] };
  const hoje = new Date().toISOString().slice(0, 10);
  let feitas = 0;

  const fila = [...faturas];
  async function worker() {
    while (fila.length) {
      const f = fila.shift();
      try {
        const raiz = obterRaizCnpj(f.cnpj_transportadora);
        const existenteId = existentes.get(`${semZeros(f.numero_fatura)}::${raiz}`);
        let faturaId = existenteId;
        const fatura = { ...f };
        const oficial = raizCnpjValida(raiz) ? nomeOficial.get(raiz) : '';
        if (oficial) fatura.transportadora = oficial;

        if (!existenteId) {
          const nomeResolvido = aplicarVinculoTransportadora(fatura.transportadora, vinculos);
          const auditor = (raizCnpjValida(raiz) && auditorPorRaiz.get(raiz))
            || auditorPorNome.get(normalizarNomeTransportadora(nomeResolvido)) || {};
          const res = await salvarFaturaSupabase({
            transportadora: fatura.transportadora,
            cnpj_transportadora: fatura.cnpj_transportadora,
            numero_fatura: fatura.numero_fatura,
            serie_fatura: fatura.serie_fatura,
            data_envio: hoje,
            data_emissao: fatura.data_emissao,
            data_vencimento: fatura.data_vencimento,
            ctes_totais: fatura.ctes.length,
            ctes_vinculados: fatura.ctes.length,
            valor_fatura: fatura.valor_fatura,
            valor_icms: fatura.valor_icms,
            banco: fatura.banco,
            cnpj_tomador: fatura.cnpj_tomador,
            nome_tomador: fatura.nome_tomador,
            status: 'RECEBIDA',
            ...auditor,
            importado_por: usuario,
            importado_em: new Date().toISOString(),
          });
          if (!res?.ok || !res.id) throw new Error('Fatura nao gravada.');
          faturaId = res.id;
          resumo.novas += 1;
        } else {
          resumo.existentes += 1;
        }

        const jaTem = existenteId ? await numerosCtesDaFatura(faturaId) : new Set();
        const novos = fatura.ctes.filter((c) => !jaTem.has(semZeros(c.numero_cte)));
        resumo.ctesJaExistiam += fatura.ctes.length - novos.length;
        if (novos.length) {
          await salvarDetalhesFaturaSupabase(novos.map((c) => detalheDoCte(c, faturaId, fatura)));
          resumo.ctesGravados += novos.length;
        }
      } catch (error) {
        resumo.erros.push(`Fatura ${f.numero_fatura}: ${error.message}`);
      }
      feitas += 1;
      onProgresso?.(feitas, faturas.length);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  return resumo;
}
