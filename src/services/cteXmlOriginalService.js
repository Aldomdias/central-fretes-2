/**
 * Guarda o XML ORIGINAL dos CT-es importados (tabela cte_xml_originais) para enviar depois ao OMS da Verum.
 * Os bytes do arquivo vao em Base64 sem parse nem reformatacao: qualquer mudanca invalida a assinatura digital.
 * Falha ao guardar nunca derruba a importacao (best-effort, so aviso no console; o conteudo do XML nao vai para log).
 */
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { arquivoParaBase64 } from './omsFaturasService';

const soDigitos = (v) => String(v || '').replace(/\D/g, '');
const semZeros = (v) => String(v || '').replace(/\D/g, '').replace(/^0+/, '');

/** Monta o registro a guardar a partir do arquivo e do CT-e ja lido (lerCteXml). */
export async function montarRegistroXml(arquivo, cte) {
  const base64 = await arquivoParaBase64(arquivo);
  const texto = await arquivo.text();
  return {
    chave_cte: cte.chave_cte,
    numero_cte: String(cte.numero_cte || ''),
    serie_cte: String(cte.serie_cte || ''),
    cnpj_emissor: soDigitos(cte.cnpj_transportadora),
    tem_protocolo: /protCTe/.test(texto),
    nome_arquivo: arquivo.name || '',
    tamanho_bytes: arquivo.size ?? null,
    xml_base64: base64,
    updated_at: new Date().toISOString(),
  };
}

/** Grava (upsert por chave). Devolve quantos foram guardados; nunca lanca. */
export async function guardarXmlsOriginais(registros) {
  const lista = (registros || []).filter((r) => r?.chave_cte && r?.xml_base64);
  if (!lista.length || !isSupabaseConfigured()) return 0;
  const client = getSupabaseClient();
  let ok = 0;
  for (let i = 0; i < lista.length; i += 50) {
    const { error } = await client.from('cte_xml_originais').upsert(lista.slice(i, i + 50), { onConflict: 'chave_cte' });
    if (error) { console.warn('Nao foi possivel guardar o XML original do CT-e.', error.message); break; }
    ok += Math.min(50, lista.length - i);
  }
  return ok;
}

/** XMLs guardados que casam com as linhas sem CT-e (numero + CNPJ do emissor; serie so quando a fatura trouxe). */
export async function buscarXmlsParaLinhas(missingCtes) {
  if (!isSupabaseConfigured()) return [];
  const linhas = (missingCtes || []).filter((l) => !l.import || l.import.status === 'failed');
  const numeros = [...new Set(linhas.flatMap((l) => [String(l.number), semZeros(l.number)]).filter(Boolean))];
  if (!numeros.length) return [];
  const { data, error } = await getSupabaseClient().from('cte_xml_originais')
    .select('chave_cte, numero_cte, serie_cte, cnpj_emissor, tem_protocolo, nome_arquivo, xml_base64')
    .in('numero_cte', numeros);
  if (error) throw new Error(error.message);
  const achados = [];
  const usados = new Set();
  for (const l of linhas) {
    const x = (data || []).find((d) => !usados.has(d.chave_cte)
      && semZeros(d.numero_cte) === semZeros(l.number)
      && soDigitos(d.cnpj_emissor) === soDigitos(l.issuerCnpj)
      && (l.serie == null || String(d.serie_cte) === String(l.serie)));
    if (x) { usados.add(x.chave_cte); achados.push({ ...x, linha: l }); }
  }
  return achados;
}

export async function marcarEnviadosAoOms(chaves) {
  if (!chaves?.length || !isSupabaseConfigured()) return;
  await getSupabaseClient().from('cte_xml_originais').update({ enviado_oms_em: new Date().toISOString() }).in('chave_cte', chaves);
}
