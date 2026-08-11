import { obterRaizCnpj } from './cnpj.js';

export const EMPRESAS_POR_RAIZ_CNPJ = Object.freeze({
  '08265644': Object.freeze({ codigo: 'GRIP', nome: 'GRIP' }),
  '08888040': Object.freeze({ codigo: 'CP', nome: 'CP Comercial' }),
  '10158356': Object.freeze({ codigo: 'CPX', nome: 'CPX / GP' }),
  '15426874': Object.freeze({ codigo: 'ITR', nome: 'ITR' }),
  '43362585': Object.freeze({ codigo: 'AFB', nome: 'AFB' }),
  '46378127': Object.freeze({ codigo: 'GP', nome: 'GP Pneus' }),
});

export function buscarEmpresaPorCnpj(cnpj = '') {
  const raiz = obterRaizCnpj(cnpj);
  const empresa = EMPRESAS_POR_RAIZ_CNPJ[raiz];
  return empresa ? { ...empresa, raizCnpj: raiz } : null;
}

export function cnpjPertenceEmpresaCadastrada(cnpj = '') {
  return Boolean(buscarEmpresaPorCnpj(cnpj));
}
