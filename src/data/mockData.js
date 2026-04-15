export const initialTransportadoras = [
  {
    id: 101,
    nome: 'ALFA',
    status: 'Ativa',
    origens: [
      {
        id: 161,
        cidade: 'Barueri',
        canal: 'ATACADO',
        status: 'Ativa',
        generalidades: {
          incideIcms: false,
          aliquotaIcms: 0,
          adValorem: 0.25,
          adValoremMinimo: 4,
          pedagio: 12,
          gris: 0.3,
          grisMinimo: 3,
          tas: 2.5,
          ctrc: 1.8,
          cubagem: 300,
          tipoCalculo: 'PERCENTUAL',
          observacoes: 'Origem com cálculo percentual padrão.',
        },
        rotas: [
          { id: 1, nomeRota: 'CAPITAL - SP', ibgeOrigem: '3505708', ibgeDestino: '3550308', canal: 'ATACADO', prazoEntregaDias: 2, valorMinimoFrete: 38 },
          { id: 2, nomeRota: 'INTERIOR I - SP', ibgeOrigem: '3505708', ibgeDestino: '3549805', canal: 'ATACADO', prazoEntregaDias: 3, valorMinimoFrete: 45 },
          { id: 3, nomeRota: 'INTERIOR I - MG', ibgeOrigem: '3505708', ibgeDestino: '3106200', canal: 'ATACADO', prazoEntregaDias: 4, valorMinimoFrete: 62 },
        ],
        cotacoes: [
          { id: 1, rota: 'CAPITAL - SP', pesoMin: 0, pesoMax: 1000000, rsKg: 0.62, excesso: 0.62, percentual: 1.95, valorFixo: 0 },
          { id: 2, rota: 'INTERIOR I - SP', pesoMin: 0, pesoMax: 1000000, rsKg: 0.74, excesso: 0.74, percentual: 2.1, valorFixo: 0 },
          { id: 3, rota: 'INTERIOR I - MG', pesoMin: 0, pesoMax: 1000000, rsKg: 0.98, excesso: 0.98, percentual: 2.95, valorFixo: 0 },
        ],
        taxasEspeciais: [
          { id: 1, ibgeDestino: '3106200', tda: 10, trt: 5, suframa: 0, outras: 0, gris: null, adVal: 0.35 },
        ],
      },
      {
        id: 162,
        cidade: 'Bauru',
        canal: 'ATACADO',
        status: 'Ativa',
        generalidades: {
          incideIcms: false,
          aliquotaIcms: 0,
          adValorem: 0,
          adValoremMinimo: 0,
          pedagio: 0,
          gris: 0,
          grisMinimo: 0,
          tas: 0,
          ctrc: 0,
          cubagem: 300,
          tipoCalculo: 'PERCENTUAL',
          observacoes: 'Tabela percentual por região.',
        },
        rotas: [
          { id: 1, nomeRota: 'CAPITAL - SP', ibgeOrigem: '3506003', ibgeDestino: '3550308', canal: 'ATACADO', prazoEntregaDias: 1, valorMinimoFrete: 35 },
          { id: 2, nomeRota: 'INTERIOR I - SP', ibgeOrigem: '3506003', ibgeDestino: '3549805', canal: 'ATACADO', prazoEntregaDias: 2, valorMinimoFrete: 39 },
          { id: 3, nomeRota: 'INTERIOR I - MG', ibgeOrigem: '3506003', ibgeDestino: '3106200', canal: 'ATACADO', prazoEntregaDias: 3, valorMinimoFrete: 58 },
        ],
        cotacoes: [
          { id: 1, rota: 'CAPITAL - SP', pesoMin: 0, pesoMax: 1000000, rsKg: 0, excesso: 0, percentual: 2.7, valorFixo: 0 },
          { id: 2, rota: 'INTERIOR I - SP', pesoMin: 0, pesoMax: 1000000, rsKg: 0, excesso: 0, percentual: 2.3, valorFixo: 0 },
          { id: 3, rota: 'INTERIOR I - MG', pesoMin: 0, pesoMax: 1000000, rsKg: 0, excesso: 0, percentual: 4.48, valorFixo: 0 },
        ],
        taxasEspeciais: [
          { id: 1, ibgeDestino: '4201109', tda: 100, trt: 0, suframa: 30, outras: 0, gris: null, adVal: 0.15 },
          { id: 2, ibgeDestino: '4212254', tda: 50, trt: 30, suframa: 0, outras: 0, gris: null, adVal: null },
          { id: 3, ibgeDestino: '4215901', tda: 70, trt: 0, suframa: 0, outras: 0, gris: 0.45, adVal: null },
          { id: 4, ibgeDestino: '4217253', tda: 70, trt: 30, suframa: 25, outras: 0, gris: null, adVal: null },
          { id: 5, ibgeDestino: '4218350', tda: 50, trt: 0, suframa: 0, outras: 0, gris: null, adVal: null },
        ],
      },
      {
        id: 163,
        cidade: 'Brasilia',
        canal: 'ATACADO',
        status: 'Ativa',
        generalidades: {
          incideIcms: true,
          aliquotaIcms: 12,
          adValorem: 0.2,
          adValoremMinimo: 3,
          pedagio: 8,
          gris: 0.2,
          grisMinimo: 2,
          tas: 1.5,
          ctrc: 1.2,
          cubagem: 300,
          tipoCalculo: 'FAIXA_DE_PESO',
          observacoes: 'Tabela híbrida com faixa e excedente.',
        },
        rotas: [
          { id: 1, nomeRota: 'GOIAS', ibgeOrigem: '5300108', ibgeDestino: '5208707', canal: 'ATACADO', prazoEntregaDias: 1, valorMinimoFrete: 28 },
          { id: 2, nomeRota: 'MINAS', ibgeOrigem: '5300108', ibgeDestino: '3106200', canal: 'ATACADO', prazoEntregaDias: 2, valorMinimoFrete: 42 },
        ],
        cotacoes: [
          { id: 1, rota: 'GOIAS', pesoMin: 0, pesoMax: 100, rsKg: 0, excesso: 0.32, percentual: 0.4, valorFixo: 26 },
          { id: 2, rota: 'MINAS', pesoMin: 0, pesoMax: 100, rsKg: 0, excesso: 0.48, percentual: 0.55, valorFixo: 37 },
        ],
        taxasEspeciais: [],
      },
    ],
  },
  {
    id: 102,
    nome: 'AGUIAR',
    status: 'Ativa',
    origens: [],
  },
  {
    id: 103,
    nome: 'BRASIL WEB',
    status: 'Ativa',
    origens: [
      {
        id: 260,
        cidade: 'Bauru',
        canal: 'ATACADO',
        status: 'Ativa',
        generalidades: {
          incideIcms: false,
          aliquotaIcms: 0,
          adValorem: 0.18,
          adValoremMinimo: 2.5,
          pedagio: 7,
          gris: 0.15,
          grisMinimo: 1.5,
          tas: 2,
          ctrc: 1.1,
          cubagem: 300,
          tipoCalculo: 'PERCENTUAL',
          observacoes: 'Operação com especialidade em SP e MG.',
        },
        rotas: [
          { id: 1, nomeRota: 'CAPITAL - SP', ibgeOrigem: '3506003', ibgeDestino: '3550308', canal: 'ATACADO', prazoEntregaDias: 1, valorMinimoFrete: 33 },
          { id: 2, nomeRota: 'INTERIOR I - SP', ibgeOrigem: '3506003', ibgeDestino: '3549805', canal: 'ATACADO', prazoEntregaDias: 2, valorMinimoFrete: 37 },
          { id: 3, nomeRota: 'INTERIOR I - MG', ibgeOrigem: '3506003', ibgeDestino: '3106200', canal: 'ATACADO', prazoEntregaDias: 3, valorMinimoFrete: 52 },
        ],
        cotacoes: [
          { id: 1, rota: 'CAPITAL - SP', pesoMin: 0, pesoMax: 1000000, rsKg: 0.5, excesso: 0.5, percentual: 2.4, valorFixo: 0 },
          { id: 2, rota: 'INTERIOR I - SP', pesoMin: 0, pesoMax: 1000000, rsKg: 0.58, excesso: 0.58, percentual: 2.1, valorFixo: 0 },
          { id: 3, rota: 'INTERIOR I - MG', pesoMin: 0, pesoMax: 1000000, rsKg: 0.85, excesso: 0.85, percentual: 4.1, valorFixo: 0 },
        ],
        taxasEspeciais: [
          { id: 1, ibgeDestino: '3106200', tda: 8, trt: 0, suframa: 0, outras: 0, gris: 0.3, adVal: null },
        ],
      },
    ],
  },
];

export function buildDashboardStats(transportadoras) {
  const totalTransportadoras = transportadoras.length;
  const origens = transportadoras.flatMap((t) => t.origens ?? []);
  const totalOrigens = origens.length;
  const totalRotas = origens.reduce((acc, origem) => acc + (origem.rotas?.length ?? 0), 0);
  const totalCotacoes = origens.reduce((acc, origem) => acc + (origem.cotacoes?.length ?? 0), 0);

  return [
    { id: 1, icon: '🏢', titulo: 'Transportadoras', valor: totalTransportadoras, descricao: 'Empresas de transporte cadastradas' },
    { id: 2, icon: '↔️', titulo: 'Origens', valor: totalOrigens, descricao: 'Cidades de origem configuradas' },
    { id: 3, icon: '🛣️', titulo: 'Rotas', valor: totalRotas, descricao: 'Pares IBGE origem-destino' },
    { id: 4, icon: '📈', titulo: 'Cotações', valor: totalCotacoes, descricao: 'Faixas de peso e preço' },
  ];
}
