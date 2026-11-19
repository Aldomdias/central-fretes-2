/**
 * Importacao SO DO ID do OMS (VLOG-3813): casa as linhas da aba Faturas da planilha da Verum com as faturas que JA
 * existem no banco e devolve apenas o que gravar em faturas.oms_invoice_id. Nao cria fatura, nao toca em valores,
 * CT-es nem status. Na duvida (duas faturas candidatas, Id repetido, Id diferente do ja gravado) nao grava e reporta.
 * Puro: sem rede nem banco (a gravacao fica em src/services/omsIdFaturasService.js).
 */
import { chaveFatura, lerOmsInvoiceId } from './auditoriaFretesImport.js';

const texto = (v) => String(v ?? '').trim();
const digitos = (v) => String(v ?? '').replace(/\D/g, '');
const primeiro = (row, nomes) => { for (const n of nomes) if (row[n] != null && texto(row[n]) !== '') return texto(row[n]); return ''; };

const chavePorCnpj = (numero, serie, cnpj) => (digitos(cnpj).length === 14 ? `${chaveFatura(numero, serie)}::CNPJ:${digitos(cnpj)}` : '');
const chavePorNome = (numero, serie, nome) => `${chaveFatura(numero, serie)}::${texto(nome).toUpperCase()}`;

/** Campos da linha da planilha usados no casamento. */
export function lerLinhaFatura(row) {
  return {
    numero: primeiro(row, ['Numero Fatura', 'Número Fatura']),
    serie: primeiro(row, ['Serie Fatura', 'Série Fatura']),
    transportadora: primeiro(row, ['Transportadora']),
    cnpj: primeiro(row, ['CNPJ Transportadora']),
    omsId: lerOmsInvoiceId(row),
  };
}

/**
 * rows: linhas da aba Faturas. faturasBanco: [{ id, numero_fatura, serie_fatura, transportadora, cnpj_transportadora, oms_invoice_id }].
 * Retorna { gravar: [{ id, omsId, numero }], contagem, pendencias: [{ numero, motivo }] }.
 */
export function casarIdsOms(rows, faturasBanco) {
  const porCnpj = new Map();
  const porNome = new Map();
  const somar = (mapa, chave, f) => { if (!chave) return; const l = mapa.get(chave) || []; l.push(f); mapa.set(chave, l); };
  for (const f of faturasBanco || []) {
    somar(porCnpj, chavePorCnpj(f.numero_fatura, f.serie_fatura, f.cnpj_transportadora), f);
    somar(porNome, chavePorNome(f.numero_fatura, f.serie_fatura, f.transportadora), f);
  }

  const contagem = { linhas: 0, gravar: 0, jaTinha: 0, semId: 0, naoEncontrada: 0, ambigua: 0, idDiferente: 0, idRepetido: 0 };
  const pendencias = [];
  const marcar = (chave, numero, motivo) => { contagem[chave] += 1; pendencias.push({ numero, motivo }); };

  const candidatos = [];
  for (const row of rows || []) {
    const l = lerLinhaFatura(row);
    if (!l.numero) continue;
    contagem.linhas += 1;
    if (!l.omsId) { marcar('semId', l.numero, 'linha sem Id valido (24 caracteres)'); continue; }
    // CNPJ manda sobre o nome (o nome do banco pode ser o oficial do cadastro, diferente do arquivo).
    let achadas = porCnpj.get(chavePorCnpj(l.numero, l.serie, l.cnpj)) || [];
    if (!achadas.length) achadas = porNome.get(chavePorNome(l.numero, l.serie, l.transportadora)) || [];
    if (!achadas.length) { marcar('naoEncontrada', l.numero, 'fatura nao encontrada no sistema (importe a fatura antes)'); continue; }
    if (achadas.length > 1) { marcar('ambigua', l.numero, `${achadas.length} faturas com a mesma chave: resolva a duplicidade e rode de novo`); continue; }
    candidatos.push({ ...l, fatura: achadas[0] });
  }

  // O mesmo Id nao pode apontar para duas faturas (nem duas faturas pelo mesmo Id): ninguem dessa colisao e gravado.
  const idsPorFatura = new Map();
  const faturasPorId = new Map();
  for (const c of candidatos) {
    (idsPorFatura.get(c.fatura.id) || idsPorFatura.set(c.fatura.id, new Set()).get(c.fatura.id)).add(c.omsId);
    (faturasPorId.get(c.omsId) || faturasPorId.set(c.omsId, new Set()).get(c.omsId)).add(c.fatura.id);
  }
  const gravar = [];
  const vistos = new Set();
  for (const c of candidatos) {
    if (idsPorFatura.get(c.fatura.id).size > 1 || faturasPorId.get(c.omsId).size > 1) { marcar('idRepetido', c.numero, 'Id repetido em faturas diferentes na planilha'); continue; }
    const atual = texto(c.fatura.oms_invoice_id).toLowerCase();
    if (atual && atual !== c.omsId) { marcar('idDiferente', c.numero, 'a fatura ja tem outro Id gravado: nao foi alterada'); continue; }
    if (atual === c.omsId) { contagem.jaTinha += 1; continue; }
    if (vistos.has(c.fatura.id)) continue; // linha repetida com o mesmo Id
    vistos.add(c.fatura.id);
    gravar.push({ id: c.fatura.id, omsId: c.omsId, numero: c.numero });
    contagem.gravar += 1;
  }
  return { gravar, contagem, pendencias };
}
