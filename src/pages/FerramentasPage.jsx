import { useState } from 'react';
import * as XLSX from 'xlsx';
import { exportarTrackingLocal } from '../utils/trackingLocal';
import { exportarRealizadoLocal } from '../services/realizadoLocalDb';
import { relacionarTrackingComCtes } from '../utils/trackingCteLink';
import { carregarMunicipiosIbgeDb } from '../services/freteDatabaseService';
import {
  carregarGradeFrete,
  salvarGradeFrete,
  restaurarGradeFretePadrao,
  encontrarLinhaGradePorPeso,
} from '../utils/gradeFreteConfig';

const DEFAULT_CONFIG = {
  canal: '',
  inicio: '',
  fim: '',
  origem: '',
  ufOrigem: '',
  ufDestino: '',
  agrupamento: 'cidade_ibge',
  excluirEbazar: true,
  incluirDetalhe: true,
  vincularCtes: true,
};

const CANAIS = ['', 'ATACADO', 'B2C'];
const CANAIS_GRADE = ['ATACADO', 'B2C'];
const UF_OPTIONS = ['', 'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

const UF_POR_CODIGO_IBGE = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value).trim();
  if (!text) return 0;
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  const parsed = Number(normalized.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function onlyDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function cleanUf(value = '') {
  const uf = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 2);
  return uf.length === 2 ? uf : '';
}

function getUfByIbge(ibge = '') {
  return UF_POR_CODIGO_IBGE[onlyDigits(ibge).slice(0, 2)] || '';
}

function normalizarCidade(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeBusca(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function safeSheetName(nome) {
  return String(nome || 'Planilha').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Planilha';
}

function isMoneyColumn(header = '') {
  const h = String(header).toUpperCase();
  return h.includes('VALOR') || h.includes('FRETE') || h.includes('NF');
}

function isPercentColumn(header = '') {
  return String(header).toUpperCase().includes('PERCENTUAL') || String(header).includes('%');
}

function isNumericColumn(header = '') {
  const h = String(header).toUpperCase();
  return [
    'NOTAS', 'VOLUMES', 'PESO', 'CUBAGEM', 'M3', 'CTES', 'MEDIA', 'MÉDIA',
    'QTD', 'TOTAL', 'PERCENTUAL', 'FRETE', 'VALOR', 'NF',
  ].some((termo) => h.includes(termo));
}

function columnWidth(header = '') {
  const h = String(header || '');
  if (h.includes('Chave') || h.includes('CHAVE')) return { wch: 44 };
  if (h.includes('Observacao') || h.includes('Observação')) return { wch: 42 };
  if (h.includes('Transportadora')) return { wch: 34 };
  if (h.includes('Origem') || h.includes('Destino')) return { wch: 28 };
  if (h.includes('IBGE')) return { wch: 14 };
  if (h.includes('Faixa')) return { wch: 18 };
  if (h.includes('Data')) return { wch: 14 };
  if (h.includes('Valor') || h.includes('Frete')) return { wch: 18 };
  return { wch: Math.min(Math.max(h.length + 4, 12), 28) };
}

function aplicarFormatoPlanilha(ws, rows = []) {
  if (!rows?.length) return;

  const headers = Object.keys(rows[0] || {});
  if (!headers.length) return;

  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  ws['!autofilter'] = { ref: XLSX.utils.encode_range(range) };
  ws['!views'] = [{ state: 'frozen', ySplit: 1 }];
  ws['!cols'] = headers.map(columnWidth);

  headers.forEach((header, colIndex) => {
    for (let rowIndex = 1; rowIndex <= rows.length; rowIndex += 1) {
      const ref = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
      const cell = ws[ref];
      if (!cell || typeof cell.v !== 'number') continue;

      if (isPercentColumn(header)) {
        cell.z = '0.00"%"';
      } else if (isMoneyColumn(header)) {
        cell.z = 'R$ #,##0.00';
      } else if (String(header).toUpperCase().includes('CUBAGEM')) {
        cell.z = '#,##0.000000';
      } else if (isNumericColumn(header)) {
        cell.z = '#,##0.00';
      }
    }
  });
}

function baixarXlsx(nomeArquivo, abas) {
  const wb = XLSX.utils.book_new();

  Object.entries(abas).forEach(([nome, rows]) => {
    const safeRows = rows || [];
    const ws = XLSX.utils.json_to_sheet(safeRows);
    aplicarFormatoPlanilha(ws, safeRows);
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(nome));
  });

  XLSX.writeFile(wb, nomeArquivo);
}

function pesoConsiderado(row = {}) {
  return Math.max(toNumber(row.peso), toNumber(row.pesoDeclarado), toNumber(row.pesoCubado));
}

function faixaVolumetria(canal, peso, grade = {}) {
  const canalNorm = String(canal || '').toUpperCase() === 'B2C' ? 'B2C' : 'ATACADO';
  const linha = encontrarLinhaGradePorPeso(grade[canalNorm] || [], peso);
  if (!linha) return '';

  const limite = Number(linha.peso || 0);
  if (!limite) return '';
  if (limite >= 999999) return '100+ kg';

  return `Até ${limite.toLocaleString('pt-BR')} kg`;
}

function chaveVolumetria(row = {}, agrupamento, faixa) {
  if (agrupamento === 'estado') return [row.canal, row.ufOrigem, row.ufDestino, faixa].join('|');
  if (agrupamento === 'ibge') return [row.canal, row.ibgeOrigem, row.ibgeDestino, faixa].join('|');

  return [
    row.canal,
    row.cidadeOrigem,
    row.ufOrigem,
    row.ibgeOrigem,
    row.cidadeDestino,
    row.ufDestino,
    row.ibgeDestino,
    faixa,
  ].join('|');
}

function linhaInicial(row = {}, agrupamento, faixa) {
  const base = {
    Canal: row.canal || '',
    Faixa_Peso: faixa,
    Notas: 0,
    Volumes: 0,
    Peso_Real: 0,
    Peso_Declarado: 0,
    Peso_Cubado: 0,
    Peso_Considerado: 0,
    Cubagem_m3: 0,
    Valor_NF: 0,
  };

  if (agrupamento === 'estado') {
    return {
      ...base,
      UF_Origem: row.ufOrigem || '',
      UF_Destino: row.ufDestino || '',
    };
  }

  if (agrupamento === 'ibge') {
    return {
      ...base,
      IBGE_Origem: row.ibgeOrigem || '',
      IBGE_Destino: row.ibgeDestino || '',
    };
  }

  return {
    ...base,
    Origem: row.cidadeOrigem || '',
    UF_Origem: row.ufOrigem || '',
    IBGE_Origem: row.ibgeOrigem || '',
    Destino: row.cidadeDestino || '',
    UF_Destino: row.ufDestino || '',
    IBGE_Destino: row.ibgeDestino || '',
  };
}

function addLocalidade(cidadeRaw, ufRaw, ibgeRaw, maps, fonte = 'base') {
  const cidade = String(cidadeRaw || '').trim();
  const cidadeKey = normalizarCidade(cidade);
  if (!cidadeKey) return;

  const ibge = onlyDigits(ibgeRaw).slice(0, 7);
  const uf = cleanUf(ufRaw) || getUfByIbge(ibge);
  if (!uf && !ibge) return;

  const localidade = {
    cidade,
    uf,
    ibge,
    fonte,
    score: (uf ? 1 : 0) + (ibge ? 2 : 0),
  };

  const listaCidade = maps.porCidade.get(cidadeKey) || [];
  listaCidade.push(localidade);
  maps.porCidade.set(cidadeKey, listaCidade);

  if (uf) {
    const chaveCidadeUf = `${cidadeKey}|${uf}`;
    const listaCidadeUf = maps.porCidadeUf.get(chaveCidadeUf) || [];
    listaCidadeUf.push(localidade);
    maps.porCidadeUf.set(chaveCidadeUf, listaCidadeUf);
  }

  if (ibge && !maps.porIbge.has(ibge)) maps.porIbge.set(ibge, localidade);
}

function criarMapasLocalidades(rows = [], municipios = []) {
  const maps = {
    porCidade: new Map(),
    porCidadeUf: new Map(),
    porIbge: new Map(),
  };

  (municipios || []).forEach((item) => {
    const ibge = onlyDigits(item.ibge || item.codigo_ibge || item.codigo || item.codigoMunicipio || '').slice(0, 7);
    const cidade = item.cidade || item.nome || item.municipio || item.nomeMunicipio || '';
    const uf = item.uf || item.estado || getUfByIbge(ibge);
    addLocalidade(cidade, uf, ibge, maps, 'municipios');
  });

  (rows || []).forEach((row) => {
    addLocalidade(row.cidadeOrigem, row.ufOrigem, row.ibgeOrigem, maps, 'tracking/cte');
    addLocalidade(row.cidadeDestino, row.ufDestino, row.ibgeDestino, maps, 'tracking/cte');
  });

  return maps;
}

function escolherMelhorLocalidade(candidatos = []) {
  const validos = (candidatos || [])
    .filter((item) => item && (item.uf || item.ibge))
    .map((item) => ({
      ...item,
      uf: cleanUf(item.uf) || getUfByIbge(item.ibge),
      ibge: onlyDigits(item.ibge).slice(0, 7),
    }))
    .filter((item) => item.uf || item.ibge);

  if (!validos.length) return null;

  const porAssinatura = new Map();
  validos.forEach((item) => {
    const assinatura = `${item.uf || ''}|${item.ibge || ''}`;
    const atual = porAssinatura.get(assinatura) || { ...item, count: 0, scoreTotal: 0 };
    atual.count += 1;
    atual.scoreTotal += Number(item.score || 0);
    porAssinatura.set(assinatura, atual);
  });

  const opcoes = [...porAssinatura.values()]
    .sort((a, b) => b.scoreTotal - a.scoreTotal || b.count - a.count);

  if (opcoes.length === 1) return opcoes[0];

  const completas = opcoes.filter((item) => item.uf && item.ibge);
  const assinaturasCompletas = new Set(completas.map((item) => `${item.uf}|${item.ibge}`));
  if (assinaturasCompletas.size === 1) return completas[0];

  return null;
}

function completarLocalidade(row = {}, prefixo, maps) {
  const cidadeCampo = prefixo === 'Origem' ? 'cidadeOrigem' : 'cidadeDestino';
  const ufCampo = prefixo === 'Origem' ? 'ufOrigem' : 'ufDestino';
  const ibgeCampo = prefixo === 'Origem' ? 'ibgeOrigem' : 'ibgeDestino';

  const cidade = String(row[cidadeCampo] || '').trim();
  const cidadeKey = normalizarCidade(cidade);
  let uf = cleanUf(row[ufCampo]);
  let ibge = onlyDigits(row[ibgeCampo]).slice(0, 7);

  const campos = [];

  if (ibge && !uf) {
    uf = getUfByIbge(ibge);
    if (uf) campos.push(`${ufCampo}=IBGE`);
  }

  if (cidadeKey) {
    let escolhido = null;
    if (uf) escolhido = escolherMelhorLocalidade(maps.porCidadeUf.get(`${cidadeKey}|${uf}`) || []);
    if (!escolhido) escolhido = escolherMelhorLocalidade(maps.porCidade.get(cidadeKey) || []);

    if (escolhido) {
      if (!uf && escolhido.uf) {
        uf = escolhido.uf;
        campos.push(`${ufCampo}=recorrencia`);
      }
      if (!ibge && escolhido.ibge) {
        ibge = escolhido.ibge;
        campos.push(`${ibgeCampo}=recorrencia`);
      }
    }
  }

  const complementosAnteriores = String(row.camposComplementadosPorRecorrencia || '').trim();
  const complementos = [...new Set([
    ...complementosAnteriores.split(' | ').filter(Boolean),
    ...campos,
  ])].join(' | ');

  return {
    ...row,
    [ufCampo]: uf,
    [ibgeCampo]: ibge,
    camposComplementadosPorRecorrencia: complementos,
    enderecoComplementadoPorRecorrencia: Boolean(complementos),
  };
}

async function carregarMunicipiosSeguro() {
  try {
    const municipios = await carregarMunicipiosIbgeDb();
    return Array.isArray(municipios) ? municipios : [];
  } catch {
    return [];
  }
}

async function completarGeografiaVolumetria(rows = []) {
  const municipios = await carregarMunicipiosSeguro();
  let maps = criarMapasLocalidades(rows, municipios);

  let preenchidas = (rows || []).map((row) => {
    const origem = completarLocalidade(row, 'Origem', maps);
    return completarLocalidade(origem, 'Destino', maps);
  });

  maps = criarMapasLocalidades(preenchidas, municipios);

  preenchidas = preenchidas.map((row) => {
    const origem = completarLocalidade(row, 'Origem', maps);
    const destino = completarLocalidade(origem, 'Destino', maps);
    const chaveRotaIbge = destino.ibgeOrigem && destino.ibgeDestino
      ? `${destino.ibgeOrigem}-${destino.ibgeDestino}`
      : '';
    return { ...destino, chaveRotaIbge };
  });

  return preenchidas;
}

function aplicarFiltrosFinais(rows = [], config = {}) {
  const origemFiltro = normalizarCidade(config.origem);
  const ufOrigemFiltro = cleanUf(config.ufOrigem);
  const ufDestinoFiltro = cleanUf(config.ufDestino);

  return (rows || []).filter((row) => {
    if (origemFiltro && !normalizarCidade(row.cidadeOrigem).includes(origemFiltro)) return false;
    if (ufOrigemFiltro && cleanUf(row.ufOrigem) !== ufOrigemFiltro) return false;
    if (ufDestinoFiltro && cleanUf(row.ufDestino) !== ufDestinoFiltro) return false;
    return true;
  });
}

function montarVolumetria(rows = [], config = {}, grade = {}) {
  const mapa = new Map();

  rows.forEach((row) => {
    const canal = String(row.canal || '').toUpperCase();
    const peso = pesoConsiderado(row);
    const faixa = canal === 'B2C' || canal === 'ATACADO' ? faixaVolumetria(canal, peso, grade) : '';
    const chave = chaveVolumetria(row, config.agrupamento, faixa);

    if (!mapa.has(chave)) mapa.set(chave, linhaInicial(row, config.agrupamento, faixa));

    const item = mapa.get(chave);
    item.Notas += 1;
    item.Volumes += toNumber(row.qtdVolumes);
    item.Peso_Real += toNumber(row.peso);
    item.Peso_Declarado += toNumber(row.pesoDeclarado);
    item.Peso_Cubado += toNumber(row.pesoCubado);
    item.Peso_Considerado += peso;
    item.Cubagem_m3 += toNumber(row.cubagem);
    item.Valor_NF += toNumber(row.valorNF);
  });

  return [...mapa.values()]
    .map((item) => ({
      ...item,
      Media_Peso_Nota: item.Notas ? item.Peso_Considerado / item.Notas : 0,
      Media_Volumes_Nota: item.Notas ? item.Volumes / item.Notas : 0,
      Media_Cubagem_Nota: item.Notas ? item.Cubagem_m3 / item.Notas : 0,
      Media_Valor_NF_Nota: item.Notas ? item.Valor_NF / item.Notas : 0,
    }))
    .sort((a, b) => String(a.UF_Destino || a.IBGE_Destino || '').localeCompare(String(b.UF_Destino || b.IBGE_Destino || '')));
}

function detalheTrackingRow(row = {}, grade = {}) {
  const canal = String(row.canal || '').toUpperCase();
  const peso = pesoConsiderado(row);

  return {
    Nota_Fiscal: row.notaFiscal || row.numeroNf || row.nfNumero || '',
    Pedido: row.pedido || '',
    Data: row.data || row.dataFaturamento || '',
    Canal: row.canal || '',
    Canal_Original: row.canalOriginal || '',
    Origem: row.cidadeOrigem || '',
    UF_Origem: row.ufOrigem || '',
    IBGE_Origem: row.ibgeOrigem || '',
    Destino: row.cidadeDestino || '',
    UF_Destino: row.ufDestino || '',
    IBGE_Destino: row.ibgeDestino || '',
    Faixa_Peso: canal === 'B2C' || canal === 'ATACADO' ? faixaVolumetria(canal, peso, grade) : '',
    Volumes: toNumber(row.qtdVolumes),
    Peso_Real: toNumber(row.peso),
    Peso_Declarado: toNumber(row.pesoDeclarado),
    Peso_Cubado: toNumber(row.pesoCubado),
    Peso_Considerado: peso,
    Cubagem_m3: toNumber(row.cubagem),
    Valor_NF: toNumber(row.valorNF),
    Complementado_CTE: row.enderecoComplementadoPorCte ? 'Sim' : 'Não',
    Complementado_Recorrencia: row.enderecoComplementadoPorRecorrencia ? 'Sim' : 'Não',
    Campos_Complementados: [row.camposComplementadosPorCte, row.camposComplementadosPorRecorrencia].filter(Boolean).join(' | '),
  };
}

function normalizarValorInput(value) {
  return String(value ?? '').replace(',', '.');
}

export default function FerramentasPage() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const [grade, setGrade] = useState(() => carregarGradeFrete());
  const [canalGrade, setCanalGrade] = useState('ATACADO');

  const alterar = (campo, valor) => setConfig((prev) => ({ ...prev, [campo]: valor }));

  const alterarGrade = (index, campo, valor) => {
    setGrade((prev) => {
      const linhas = [...(prev[canalGrade] || [])];
      linhas[index] = { ...linhas[index], [campo]: normalizarValorInput(valor) };
      return { ...prev, [canalGrade]: linhas };
    });
  };

  const adicionarFaixaGrade = () => {
    setGrade((prev) => ({
      ...prev,
      [canalGrade]: [...(prev[canalGrade] || []), { peso: '', valorNF: '', cubagem: '' }],
    }));
  };

  const removerFaixaGrade = (index) => {
    setGrade((prev) => ({
      ...prev,
      [canalGrade]: (prev[canalGrade] || []).filter((_, i) => i !== index),
    }));
  };

  const salvarGradeAtual = () => {
    const normalizada = salvarGradeFrete(grade);
    setGrade(normalizada);
    setMensagem('Grade salva. O simulador e o Realizado Local passam a usar estes pesos, valores de NF e cubagens.');
    setErro('');
  };

  const restaurarGradePadrao = () => {
    const normalizada = restaurarGradeFretePadrao();
    setGrade(normalizada);
    setMensagem('Grade padrão restaurada. Revise as cubagens antes de simular.');
    setErro('');
  };

  async function exportarVolumetria() {
    setCarregando(true);
    setErro('');
    setMensagem('Gerando volumetria a partir do Tracking local...');

    try {
      const filtroBase = {
        canal: config.canal,
        inicio: config.inicio,
        fim: config.fim,
        origem: config.origem,
        excluirEbazar: Boolean(config.excluirEbazar),
      };

      const { rows, totalCompativel, limit } = await exportarTrackingLocal(filtroBase, { limit: 500000 });

      if (!rows.length) {
        throw new Error('Não existe base de Tracking local com os filtros informados. Importe primeiro no módulo Tracking.');
      }

      let rowsBase = rows;
      let resumoVinculo = null;

      if (config.vincularCtes) {
        setMensagem('Tracking carregado. Buscando CT-es locais para complementar UF/IBGE...');
        const ctes = await exportarRealizadoLocal(filtroBase, { limit: 500000 });
        const relacionamento = relacionarTrackingComCtes(rows, ctes.rows || []);
        rowsBase = relacionamento.rows;
        resumoVinculo = relacionamento.resumo;
      }

      setMensagem('Completando UF e IBGE por município, CT-e e recorrência da própria base...');
      rowsBase = await completarGeografiaVolumetria(rowsBase);
      rowsBase = aplicarFiltrosFinais(rowsBase, config);

      if (!rowsBase.length) {
        throw new Error('Após completar UF/IBGE, nenhuma linha ficou dentro dos filtros de origem/UF selecionados.');
      }

      const volumetria = montarVolumetria(rowsBase, config, grade);
      const detalheNotas = rowsBase.map((row) => detalheTrackingRow(row, grade));

      const abas = {
        Volumetria_Agrupada: volumetria,
        Detalhe_Notas: config.incluirDetalhe ? detalheNotas : [],
      };

      baixarXlsx(`volumetria-transportador-${config.canal || 'todos'}-${Date.now()}.xlsx`, abas);

      setMensagem(`Volumetria exportada: ${rowsBase.length.toLocaleString('pt-BR')} nota(s)/linha(s), ${volumetria.length.toLocaleString('pt-BR')} linha(s) agrupadas${resumoVinculo ? `, ${resumoVinculo.vinculadas.toLocaleString('pt-BR')} com CT-e vinculado` : ''}. Filtros aplicados: origem ${config.origem || 'todas'}, UF origem ${config.ufOrigem || 'todas'}, UF destino ${config.ufDestino || 'todas'}.`);
    } catch (error) {
      setErro(error.message || 'Erro ao gerar volumetria.');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="amd-mini-brand">AMD Log • Ferramentas</div>
        <h1>Ferramentas</h1>
        <p>Utilitários separados das telas operacionais para manter grades e gerar volumetria a partir da base de Tracking.</p>
      </div>

      {erro ? <div className="sim-alert error">{erro}</div> : null}
      {mensagem ? <div className="sim-alert info">{mensagem}</div> : null}

      <section className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Manutenção da grade de peso, NF e cubagem</div>
            <p>Essa grade é usada pelo Simulador e pelo Realizado Local. Para cubagem, o cálculo usa somente a cubagem cadastrada aqui por faixa; a cubagem realizada é ignorada.</p>
          </div>
          <div className="actions-right gap-row">
            <button className="btn-secondary" type="button" onClick={restaurarGradePadrao}>Restaurar padrão</button>
            <button className="btn-primary" type="button" onClick={salvarGradeAtual}>Salvar grade</button>
          </div>
        </div>

        <div className="toggle-row">
          {CANAIS_GRADE.map((item) => (
            <button key={item} type="button" className={canalGrade === item ? 'toggle-btn active' : 'toggle-btn'} onClick={() => setCanalGrade(item)}>{item}</button>
          ))}
        </div>

        <div className="sim-analise-tabela-wrap top-space-sm">
          <table className="sim-analise-tabela">
            <thead>
              <tr>
                <th>Limite da faixa até kg</th>
                <th>Valor NF padrão</th>
                <th>Cubagem padrão da faixa m³</th>
                <th>Observação</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {(grade[canalGrade] || []).map((linha, index) => (
                <tr key={`${canalGrade}-${index}`}>
                  <td><input value={linha.peso ?? ''} onChange={(e) => alterarGrade(index, 'peso', e.target.value)} placeholder="Ex.: 50" /></td>
                  <td><input value={linha.valorNF ?? ''} onChange={(e) => alterarGrade(index, 'valorNF', e.target.value)} placeholder="Ex.: 2000" /></td>
                  <td><input value={linha.cubagem ?? ''} onChange={(e) => alterarGrade(index, 'cubagem', e.target.value)} placeholder="Ex.: 0,320" /></td>
                  <td>Usa esta cubagem para pesos até {linha.peso || '...'} kg.</td>
                  <td><button className="btn-secondary" type="button" onClick={() => removerFaixaGrade(index)}>Remover</button></td>
                </tr>
              ))}
              {!(grade[canalGrade] || []).length && <tr><td colSpan="5">Nenhuma faixa cadastrada para este canal.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="actions-right top-space-sm">
          <button className="btn-secondary" type="button" onClick={adicionarFaixaGrade}>Adicionar faixa</button>
        </div>

        <div className="hint-box compact">
          A regra usa a primeira faixa com limite maior ou igual ao peso. Exemplo: peso 51 kg usa a faixa de 70 kg ou 100 kg, conforme estiver cadastrada. O cálculo do peso cubado é: cubagem da grade × fator de cubagem da transportadora/origem.
        </div>
      </section>

      <section className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Exportar volumetria para transportador</div>
            <p>Gera uma base agrupada da base local de Tracking com origem, destino, IBGE, faixa de peso, cubagem, valor de nota e volumes para precificação do transportador.</p>
          </div>
        </div>

        <div className="form-grid three">
          <label className="field">Canal
            <select value={config.canal} onChange={(e) => alterar('canal', e.target.value)}>
              {CANAIS.map((item) => <option key={item} value={item}>{item || 'Todos'}</option>)}
            </select>
          </label>
          <label className="field">Período inicial
            <input type="date" value={config.inicio} onChange={(e) => alterar('inicio', e.target.value)} />
          </label>
          <label className="field">Período final
            <input type="date" value={config.fim} onChange={(e) => alterar('fim', e.target.value)} />
          </label>
        </div>

        <div className="form-grid three">
          <label className="field">Origem
            <input value={config.origem} onChange={(e) => alterar('origem', e.target.value)} placeholder="Ex.: Sinop, Itajaí, Serra" />
          </label>
          <label className="field">UF origem
            <select value={config.ufOrigem} onChange={(e) => alterar('ufOrigem', e.target.value)}>
              {UF_OPTIONS.map((uf) => <option key={`origem-${uf || 'todos'}`} value={uf}>{uf || 'Todas'}</option>)}
            </select>
          </label>
          <label className="field">UF destino
            <select value={config.ufDestino} onChange={(e) => alterar('ufDestino', e.target.value)}>
              {UF_OPTIONS.map((uf) => <option key={`destino-${uf || 'todos'}`} value={uf}>{uf || 'Todas'}</option>)}
            </select>
          </label>
        </div>

        <div className="form-grid three">
          <label className="field">Agrupamento
            <select value={config.agrupamento} onChange={(e) => alterar('agrupamento', e.target.value)}>
              <option value="cidade_ibge">Cidade/UF + IBGE origem e destino</option>
              <option value="ibge">IBGE origem x IBGE destino</option>
              <option value="estado">Estado origem x estado destino</option>
            </select>
          </label>
          <label className="checkbox-line">
            <input type="checkbox" checked={Boolean(config.excluirEbazar)} onChange={(e) => alterar('excluirEbazar', e.target.checked)} />
            Retirar EBAZAR
          </label>
          <label className="checkbox-line">
            <input type="checkbox" checked={Boolean(config.incluirDetalhe)} onChange={(e) => alterar('incluirDetalhe', e.target.checked)} />
            Incluir aba sem agrupamento por nota
          </label>
          <label className="checkbox-line">
            <input type="checkbox" checked={Boolean(config.vincularCtes)} onChange={(e) => alterar('vincularCtes', e.target.checked)} />
            Vincular com CT-es locais para completar dados
          </label>
        </div>

        <div className="hint-box compact">
          A aba Volumetria_Agrupada agrupa por origem/destino/faixa. A aba Detalhe_Notas sai sem agrupamento. Os filtros de UF são aplicados depois que o sistema tenta completar UF/IBGE por município cadastrado, CT-e vinculado e recorrência da própria base.
        </div>

        <div className="actions-right">
          <button className="btn-primary" type="button" onClick={exportarVolumetria} disabled={carregando}>
            {carregando ? 'Gerando...' : 'Gerar Excel de volumetria'}
          </button>
        </div>
      </section>
    </div>
  );
}
