import { cnpjPreenchidoValido, formatarCnpj, normalizarCnpj } from './cnpj';

// Planilha de referencia: "Transportadoras Via Dados Bancarios - FIXO.xlsx"
// Colunas: RESPONSAVEL, TRANSPORTADORAS, BANCO, AGENCIA, CONTA, PIX,
// CNPJ - CPF, DADOS BANCARIOS (texto consolidado, so leitura).
function normalizarCabecalho(valor) {
  return String(valor || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toUpperCase();
}

function encontrarColuna(headers, alvo) {
  const idx = headers.findIndex((h) => normalizarCabecalho(h) === alvo);
  return idx >= 0 ? idx : null;
}

export function inferirTipoChavePix(chave) {
  const valor = String(chave || '').trim();
  if (!valor) return '';
  const somenteDigitos = valor.replace(/\D/g, '');
  if (/^\S+@\S+\.\S+$/.test(valor)) return 'EMAIL';
  if (cnpjPreenchidoValido(somenteDigitos) || somenteDigitos.length === 11) return 'CNPJ_CPF';
  if (somenteDigitos.length >= 10 && somenteDigitos.length <= 11 && /^\d+$/.test(valor.replace(/[()\s-]/g, ''))) return 'TELEFONE';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor)) return 'ALEATORIA';
  return 'OUTRO';
}

// Extrai a chave PIX de uma celula que pode vir crua ("financeiro@x.com") ou
// prefixada ("PIX: financeiro@x.com" / "PIX 35.396.816/0001-60").
function limparValorPix(valor) {
  return String(valor || '').replace(/^\s*PIX\s*:?\s*/i, '').trim();
}

export function parsePlanilhaDadosBancarios(linhasBrutas = []) {
  if (!linhasBrutas.length) return { registros: [], avisos: ['Planilha vazia.'] };
  const headers = linhasBrutas[0].map(normalizarCabecalho);
  const colResponsavel = encontrarColuna(headers, 'RESPONSAVEL');
  const colTransportadora = encontrarColuna(headers, 'TRANSPORTADORAS') ?? encontrarColuna(headers, 'TRANSPORTADORA');
  const colBanco = encontrarColuna(headers, 'BANCO');
  const colAgencia = encontrarColuna(headers, 'AGENCIA');
  const colConta = encontrarColuna(headers, 'CONTA');
  const colPix = encontrarColuna(headers, 'PIX');
  const colCnpj = encontrarColuna(headers, 'CNPJ - CPF') ?? encontrarColuna(headers, 'CNPJ');

  if (colTransportadora == null) {
    return { registros: [], avisos: ['Coluna "TRANSPORTADORAS" nao encontrada na planilha.'] };
  }

  const avisos = [];
  const registros = [];
  for (let i = 1; i < linhasBrutas.length; i += 1) {
    const linha = linhasBrutas[i];
    if (!linha || !linha.length) continue;
    const transportadora = String(linha[colTransportadora] ?? '').trim();
    if (!transportadora) continue;
    const cnpjBruto = colCnpj != null ? String(linha[colCnpj] ?? '').trim() : '';
    const pixBruto = colPix != null ? limparValorPix(linha[colPix]) : '';
    const banco = colBanco != null ? String(linha[colBanco] ?? '').trim() : '';
    const agencia = colAgencia != null ? String(linha[colAgencia] ?? '').trim() : '';
    const conta = colConta != null ? String(linha[colConta] ?? '').trim() : '';
    const responsavel = colResponsavel != null ? String(linha[colResponsavel] ?? '').trim() : '';
    const cnpj = normalizarCnpj(cnpjBruto);

    if (!cnpj && !pixBruto && !banco) {
      avisos.push(`Linha ${i + 1} (${transportadora}): sem CNPJ, PIX ou dados bancarios - ignorada.`);
      continue;
    }

    registros.push({
      transportadora,
      cnpj: cnpj ? formatarCnpj(cnpj) : cnpjBruto || null,
      favorecido: transportadora,
      banco: banco || null,
      codigo_banco: null,
      agencia: agencia || null,
      conta: conta || null,
      tipo_conta: null,
      chave_pix: pixBruto || null,
      tipo_chave_pix: pixBruto ? inferirTipoChavePix(pixBruto) : null,
      principal: true,
      ativo: true,
      observacao: responsavel ? `Responsavel interno (planilha): ${responsavel}` : null,
    });
  }
  return { registros, avisos };
}
