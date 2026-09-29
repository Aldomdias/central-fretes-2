// Leitura de XML de CT-e (modelo 57) para alimentar a base de CT-es (realizado_local_ctes).
// Usa o DOMParser do navegador; ignora namespace (getElementsByTagNameNS('*')).

const soDigitos = (v) => String(v || '').replace(/\D/g, '');

function no(pai, nome) {
  if (!pai) return null;
  return pai.getElementsByTagNameNS('*', nome)[0] || null;
}

function texto(pai, nome) {
  return (no(pai, nome)?.textContent || '').trim();
}

function numero(v) {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export function lerCteXml(xmlTexto, nomeArquivo = '') {
  const doc = new DOMParser().parseFromString(String(xmlTexto || ''), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error(`${nomeArquivo || 'Arquivo'}: XML inválido.`);
  const infCte = no(doc, 'infCte');
  if (!infCte) throw new Error(`${nomeArquivo || 'Arquivo'}: não é um XML de CT-e (tag infCte não encontrada).`);

  const chave = soDigitos(infCte.getAttribute('Id')) || soDigitos(texto(doc, 'chCTe'));
  if (chave.length !== 44) throw new Error(`${nomeArquivo || 'Arquivo'}: chave do CT-e não encontrada ou inválida.`);

  const ide = no(infCte, 'ide');
  const emit = no(infCte, 'emit');
  const rem = no(infCte, 'rem');
  const dest = no(infCte, 'dest');
  const vPrest = no(infCte, 'vPrest');
  const infCarga = no(infCte, 'infCarga');

  // Medidas da carga: cada <infQ> traz tpMed (rótulo), qCarga e cUnid (00=m3, 01=kg, 03=un).
  let pesoBruto = 0; let pesoCubado = 0; let pesoBase = 0; let cubagem = 0; let volumes = 0; let pesoOutro = 0;
  if (infCarga) {
    for (const q of Array.from(infCarga.getElementsByTagNameNS('*', 'infQ'))) {
      const tp = texto(q, 'tpMed').toUpperCase();
      const valor = numero(texto(q, 'qCarga'));
      const un = texto(q, 'cUnid');
      if (/CUBAG|M3|M³/.test(tp) || un === '00') cubagem = Math.max(cubagem, valor);
      else if (/VOLUME|UNIDADE|QTD/.test(tp) || un === '03') volumes = Math.max(volumes, valor);
      else if (/CUBADO/.test(tp)) pesoCubado = Math.max(pesoCubado, valor);
      else if (/BASE|BC|TAXAD|CALCULO|CÁLCULO/.test(tp)) pesoBase = Math.max(pesoBase, valor);
      else if (/BRUTO|DECLARAD/.test(tp)) pesoBruto = Math.max(pesoBruto, valor);
      else pesoOutro = Math.max(pesoOutro, valor);
    }
  }
  const pesoDeclarado = pesoBruto || pesoOutro;
  const peso = pesoDeclarado || pesoBase;

  // NFs vinculadas (infNFe/chave). A 1ª vira a "nota fiscal" da linha.
  const chavesNfe = Array.from(infCte.getElementsByTagNameNS('*', 'infNFe')).map((n) => soDigitos(texto(n, 'chave'))).filter((c) => c.length === 44);
  const chaveNfe = chavesNfe[0] || '';
  const notaFiscal = chaveNfe ? String(Number(chaveNfe.slice(25, 34))) : (texto(no(infCte, 'infNF'), 'nDoc') || '');

  const emissaoBruta = texto(ide, 'dhEmi') || texto(ide, 'dEmi');
  const emissao = emissaoBruta ? emissaoBruta.slice(0, 10) : '';
  const ibgeOrigem = soDigitos(texto(ide, 'cMunIni')).slice(0, 7);
  const ibgeDestino = soDigitos(texto(ide, 'cMunFim')).slice(0, 7);

  return {
    arquivo: nomeArquivo,
    chave_cte: chave,
    numero_cte: texto(ide, 'nCT'),
    serie_cte: texto(ide, 'serie'),
    data_emissao: emissao,
    competencia: emissao ? emissao.slice(0, 7) : '',
    transportadora: texto(emit, 'xNome'),
    cnpj_transportadora: soDigitos(texto(emit, 'CNPJ')),
    documento_remetente: soDigitos(texto(rem, 'CNPJ') || texto(rem, 'CPF')),
    documento_destinatario: soDigitos(texto(dest, 'CNPJ') || texto(dest, 'CPF')),
    valor_cte: numero(texto(vPrest, 'vTPrest')),
    valor_nf: numero(texto(infCarga, 'vCarga')),
    peso,
    peso_declarado: pesoDeclarado,
    peso_cubado: pesoCubado,
    cubagem,
    qtd_volumes: volumes,
    cidade_origem: texto(ide, 'xMunIni'),
    uf_origem: texto(ide, 'UFIni'),
    ibge_origem: ibgeOrigem,
    cidade_destino: texto(ide, 'xMunFim'),
    uf_destino: texto(ide, 'UFFim'),
    ibge_destino: ibgeDestino,
    chave_rota_ibge: ibgeOrigem && ibgeDestino ? `${ibgeOrigem}-${ibgeDestino}` : '',
    chave_nfe: chaveNfe,
    nota_fiscal: notaFiscal,
  };
}
