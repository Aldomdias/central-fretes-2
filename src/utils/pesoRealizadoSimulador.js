function numeroPeso(valor) {
  if (typeof valor === 'string') {
    const texto = valor.trim();
    if (!texto) return 0;
    const normalizado = texto.includes(',')
      ? texto.replace(/\./g, '').replace(',', '.')
      : texto;
    const numero = Number(normalizado.replace(/[^0-9.-]/g, '') || 0);
    return Number.isFinite(numero) ? numero : 0;
  }
  const numero = Number(valor || 0);
  return Number.isFinite(numero) ? numero : 0;
}

// No Simulado do Realizado, "usar peso do CT-e" significa usar a coluna
// `peso` da base de CT-es. `peso_declarado` (que pode refletir o bruto da NF)
// fica apenas como fallback quando o CT-e realmente não possui peso.
export function resolverPesoCteRealizado(row = {}, filtros = {}) {
  const pesoCte = numeroPeso(row.peso);
  const pesoDeclarado = numeroPeso(row.pesoDeclarado ?? row.peso_declarado);
  const base = pesoCte > 0 ? pesoCte : pesoDeclarado;
  if (!filtros.ignorarCubagem) return base;
  const percentual = Number(filtros.percentualContingenciaPeso) || 0;
  return base * (1 + percentual / 100);
}

