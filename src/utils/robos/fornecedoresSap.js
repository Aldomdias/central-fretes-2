// Fornecedores com mais de um cadastro no SAP: na ME21N o campo do fornecedor recebe o CNPJ e, quando
// o CNPJ acha dois cadastros, o SAP abre a ajuda de pesquisa e o robo para ("Nao foi possivel inicializar a
// ajuda de pesquisa de controle"). Para esses CNPJ o robo digita o CODIGO do fornecedor, que cai direto no cadastro certo.
// Para incluir outro: CNPJ (so digitos) -> codigo do fornecedor no SAP.
export const FORNECEDOR_SAP_POR_CNPJ = {
  11048206000299: '2557609', // TRANSGP TRANSPORTE RODOVIARIO DE CARGAS LTDA (o outro cadastro e o CEN6002)
  11048206000370: '2788415', // TRANSGP - Cabo de Santo Agostinho (o outro cadastro e o CEN6003)
  11048206000531: '2881571', // TRANSGP - Presidente Prudente (o outro cadastro e o CEN6005)
};

// O que o robo digita no campo do fornecedor: o codigo cadastrado acima ou, sem regra, o proprio CNPJ.
export function fornecedorParaSap(cnpj) {
  const digitos = String(cnpj ?? '').replace(/\D/g, '');
  return FORNECEDOR_SAP_POR_CNPJ[digitos] || digitos;
}
