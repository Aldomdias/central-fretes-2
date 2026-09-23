import { simularSimples } from './calculoFrete.js';

const MAX_DESTINOS = 24;
const LIMITE_REGISTROS = 100000;
const LIMITE_COTACOES_ORIGEM = 50000;

function texto(valor) {
  return String(valor ?? '').trim();
}

function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function amostrar(lista, limite) {
  if (lista.length <= limite) return lista;
  const selecionados = [];
  const usados = new Set();
  for (let i = 0; i < limite; i += 1) {
    const indice = Math.round((i * (lista.length - 1)) / Math.max(limite - 1, 1));
    if (!usados.has(indice)) {
      usados.add(indice);
      selecionados.push(lista[indice]);
    }
  }
  return selecionados;
}

export function testarTransportadoraRapido(transportadora, { maxDestinos = MAX_DESTINOS } = {}) {
  const inicio = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const origens = Array.isArray(transportadora?.origens) ? transportadora.origens : [];
  const alertas = [];
  const erros = [];
  const diagnosticoOrigens = [];
  let totalRotas = 0;
  let totalCotacoes = 0;
  let totalTaxas = 0;

  origens.forEach((origem) => {
    const rotas = Array.isArray(origem?.rotas) ? origem.rotas : [];
    const cotacoes = Array.isArray(origem?.cotacoes) ? origem.cotacoes : [];
    const taxas = Array.isArray(origem?.taxasEspeciais) ? origem.taxasEspeciais : [];
    const nomesRotas = new Set(rotas.map((rota) => texto(rota.nomeRota || rota.nome_rota)).filter(Boolean));
    const rotasSemDestino = rotas.filter((rota) => !texto(rota.ibgeDestino || rota.ibge_destino)).length;
    const cotacoesSemRota = cotacoes.filter((cotacao) => {
      const nome = texto(cotacao.rota || cotacao.nomeRota || cotacao.nome_rota);
      return nome && !nomesRotas.has(nome);
    }).length;

    totalRotas += rotas.length;
    totalCotacoes += cotacoes.length;
    totalTaxas += taxas.length;

    const item = {
      origem: texto(origem?.cidade) || 'Origem sem nome',
      canal: texto(origem?.canal) || 'Não informado',
      rotas: rotas.length,
      cotacoes: cotacoes.length,
      taxas: taxas.length,
      rotasSemDestino,
      cotacoesSemRota,
    };
    diagnosticoOrigens.push(item);

    if (!rotas.length) erros.push(`${item.origem}: nenhuma rota cadastrada.`);
    if (!cotacoes.length) erros.push(`${item.origem}: nenhuma cotação cadastrada.`);
    if (rotasSemDestino) alertas.push(`${item.origem}: ${rotasSemDestino} rota(s) sem IBGE de destino.`);
    if (cotacoesSemRota) alertas.push(`${item.origem}: ${cotacoesSemRota} cotação(ões) sem rota correspondente.`);
    if (cotacoes.length > LIMITE_COTACOES_ORIGEM) {
      erros.push(`${item.origem}: volume anormal de ${cotacoes.length.toLocaleString('pt-BR')} cotações.`);
    }
  });

  const totalRegistros = totalRotas + totalCotacoes + totalTaxas;
  if (!origens.length) erros.push('Nenhuma origem cadastrada.');
  if (totalRegistros > LIMITE_REGISTROS) {
    erros.push(`Volume total anormal: ${totalRegistros.toLocaleString('pt-BR')} registros na tabela.`);
  }

  const candidatos = origens.flatMap((origem) => (
    (origem.rotas || [])
      .filter((rota) => texto(rota.ibgeDestino || rota.ibge_destino))
      .map((rota) => ({ origem, rota, destino: texto(rota.ibgeDestino || rota.ibge_destino) }))
  ));
  const destinosTeste = amostrar(candidatos, maxDestinos);
  const perfis = [
    { nome: 'leve', peso: 2, valorNF: 200, cubagem: 0.02 },
    { nome: 'média', peso: 30, valorNF: 1500, cubagem: 0.2 },
    { nome: 'pesada', peso: 100, valorNF: 5000, cubagem: 0.8 },
  ];
  const casos = [];

  if (totalRegistros <= LIMITE_REGISTROS) {
    destinosTeste.forEach(({ origem, rota, destino }) => {
      perfis.forEach((perfil) => {
        let resultado = [];
        let erro = '';
        try {
          resultado = simularSimples({
            transportadoras: [transportadora],
            origem: origem.cidade || '',
            canal: origem.canal || 'ATACADO',
            destinoCodigo: destino,
            peso: perfil.peso,
            valorNF: perfil.valorNF,
            cubagem: perfil.cubagem,
            ignorarCubagem: false,
          });
        } catch (e) {
          erro = e?.message || 'Falha ao calcular frete.';
        }
        casos.push({
          origem: origem.cidade || '',
          rota: rota.nomeRota || rota.nome_rota || '',
          destino,
          perfil: perfil.nome,
          calculou: resultado.length > 0,
          valor: numero(resultado[0]?.total),
          erro,
        });
      });
    });
  }

  const falhasCalculo = casos.filter((caso) => !caso.calculou);
  if (falhasCalculo.length) {
    alertas.push(`${falhasCalculo.length} de ${casos.length} cenário(s) da amostra não calcularam frete.`);
  }
  const fim = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const status = erros.length ? 'bloqueada' : alertas.length ? 'alerta' : 'aprovada';

  return {
    status,
    duracaoMs: Math.round(fim - inicio),
    totais: { origens: origens.length, rotas: totalRotas, cotacoes: totalCotacoes, taxas: totalTaxas, registros: totalRegistros },
    simulacoes: { executadas: casos.length, sucesso: casos.length - falhasCalculo.length, falhas: falhasCalculo.length },
    erros,
    alertas,
    origens: diagnosticoOrigens.sort((a, b) => b.cotacoes - a.cotacoes),
    casos,
  };
}

