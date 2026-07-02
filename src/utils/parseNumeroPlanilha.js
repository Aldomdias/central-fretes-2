// Parser de numeros vindos de planilhas (XLSX raw:false entrega o texto
// FORMATADO da celula). Precisa aceitar tanto o padrao brasileiro digitado
// ("1.234,56", "177,50") quanto o padrao americano que a lib SheetJS usa ao
// formatar milhares ("1,065.00", "1,065") — 1065 com formato "#,##0.00" chega
// aqui como a string "1,065.00", e assumir BR transformava em 1.065 (bug do
// frete minimo importado como R$ 1,07).
export function parseNumeroPlanilha(valor, padrao = '') {
  if (valor === null || valor === undefined || valor === '') return padrao;

  if (typeof valor === 'number') {
    return Number.isFinite(valor) ? valor : padrao;
  }

  let texto = String(valor).trim();
  if (!texto) return padrao;

  texto = texto
    .replace(/\s/g, '')
    .replace(/R\$/gi, '')
    .replace(/%/g, '')
    // Remove unidades/letras que vêm no texto formatado da planilha (ex.: "1,93 kg",
    // "30 dias"). Sem isso, Number("1.93kg") = NaN e o valor (ex.: R$/kg) era perdido.
    .replace(/[^0-9.,-]/g, '');

  const temVirgula = texto.includes(',');
  const temPonto = texto.includes('.');

  if (temVirgula && temPonto) {
    // O separador decimal é sempre o ÚLTIMO dos dois. Cobre o formato
    // brasileiro "1.234,56" e o americano "1,065.00".
    if (texto.lastIndexOf(',') > texto.lastIndexOf('.')) {
      texto = texto.replace(/\./g, '').replace(',', '.');
    } else {
      texto = texto.replace(/,/g, '');
    }
  } else if (temVirgula) {
    // Vírgula sozinha pode ser milhar americano ("1,065" vindo do formato
    // "#,##0" do Excel via XLSX raw:false) ou decimal brasileiro ("1,07").
    // Só trata como milhar quando o padrão é inequívoco: grupos de exatamente
    // 3 dígitos e parte inteira de 1-3 dígitos não iniciada em zero.
    const partesVirgula = texto.split(',');
    const pareceMilharUs = partesVirgula.length > 1
      && partesVirgula.slice(1).every((parte) => parte.length === 3)
      && /^-?[1-9]\d{0,2}$/.test(partesVirgula[0]);
    texto = pareceMilharUs ? texto.replace(/,/g, '') : texto.replace(',', '.');
  } else if (temPonto) {
    // Sem vírgula, o ponto pode ser separador de milhar (ex.: "1.065" = 1065)
    // em vez de decimal. Só remove o ponto quando o padrão bate com milhar
    // (grupos de 3 dígitos, parte inteira não iniciada em zero), preservando
    // decimais reais como "2.5" e "0.125".
    const partes = texto.split('.');
    const pareceMilhar = partes.length > 1
      && partes.slice(1).every((parte) => parte.length === 3)
      && /^-?[1-9]\d{0,2}$/.test(partes[0]);
    if (pareceMilhar) texto = texto.replace(/\./g, '');
  }

  const n = Number(texto);
  return Number.isFinite(n) ? n : padrao;
}

export default parseNumeroPlanilha;
