import { useState } from 'react';
import * as XLSX from 'xlsx';
import { exportarRealizadoLocal } from '../services/realizadoLocalDb';

const DEFAULT_CONFIG = {
  canal: '',
  inicio: '',
  fim: '',
  agrupamento: 'cidade_ibge',
  excluirEbazar: true,
  incluirDetalhe: false,
};

const CANAIS = ['', 'ATACADO', 'B2C', 'INTERCOMPANY', 'REVERSA'];

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function safeSheetName(nome) {
  return String(nome || 'Planilha').replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31) || 'Planilha';
}

function baixarXlsx(nomeArquivo, abas) {
  const wb = XLSX.utils.book_new();
  Object.entries(abas).forEach(([nome, rows]) => {
    const ws = XLSX.utils.json_to_sheet(rows || []);
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(nome));
  });
  XLSX.writeFile(wb, nomeArquivo);
}

function pesoConsiderado(row = {}) {
  return Math.max(toNumber(row.peso), toNumber(row.pesoDeclarado), toNumber(row.pesoCubado));
}

function faixaVolumetria(canal, peso) {
  const p = Number(peso || 0);
  const canalNorm = String(canal || '').toUpperCase();
  const faixasB2C = [
    [0, 2, '0 A 2'], [2, 5, '2 A 5'], [5, 10, '5 A 10'], [10, 20, '10 A 20'],
    [20, 30, '20 A 30'], [30, 50, '30 A 50'], [50, 70, '50 A 70'], [70, 100, '70 A 100'], [100, Infinity, '100 A 999999999'],
  ];
  const faixasAtacado = [
    [0, 20, '0 A 20'], [20, 30, '20 A 30'], [30, 50, '30 A 50'], [50, 70, '50 A 70'], [70, 100, '70 A 100'], [100, Infinity, '100+'],
  ];
  const faixas = canalNorm === 'B2C' ? faixasB2C : faixasAtacado;
  const match = faixas.find(([min, max]) => p >= min && p < max);
  return match?.[2] || '';
}

function chaveVolumetria(row = {}, agrupamento, faixa) {
  if (agrupamento === 'estado') return [row.canal, row.ufOrigem, row.ufDestino, faixa].join('|');
  if (agrupamento === 'ibge') return [row.canal, row.ibgeOrigem, row.ibgeDestino, faixa].join('|');
  return [row.canal, row.cidadeOrigem, row.ufOrigem, row.ibgeOrigem, row.cidadeDestino, row.ufDestino, row.ibgeDestino, faixa].join('|');
}

function linhaInicial(row = {}, agrupamento, faixa) {
  const base = {
    Canal: row.canal || '',
    Faixa_Peso: faixa,
    CTEs: 0,
    Volumes: 0,
    Peso_Real: 0,
    Peso_Declarado: 0,
    Peso_Cubado: 0,
    Peso_Considerado: 0,
    Cubagem: 0,
    Valor_NF: 0,
    Frete_Realizado: 0,
  };

  if (agrupamento === 'estado') {
    return { ...base, UF_Origem: row.ufOrigem || '', UF_Destino: row.ufDestino || '' };
  }
  if (agrupamento === 'ibge') {
    return { ...base, IBGE_Origem: row.ibgeOrigem || '', IBGE_Destino: row.ibgeDestino || '' };
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

function montarVolumetria(rows = [], config = {}) {
  const mapa = new Map();
  rows.forEach((row) => {
    const canal = String(row.canal || '').toUpperCase();
    const peso = pesoConsiderado(row);
    const faixa = canal === 'B2C' || canal === 'ATACADO' ? faixaVolumetria(canal, peso) : '';
    const chave = chaveVolumetria(row, config.agrupamento, faixa);
    if (!mapa.has(chave)) mapa.set(chave, linhaInicial(row, config.agrupamento, faixa));
    const item = mapa.get(chave);
    item.CTEs += 1;
    item.Volumes += toNumber(row.qtdVolumes);
    item.Peso_Real += toNumber(row.peso);
    item.Peso_Declarado += toNumber(row.pesoDeclarado);
    item.Peso_Cubado += toNumber(row.pesoCubado);
    item.Peso_Considerado += peso;
    item.Cubagem += toNumber(row.cubagem);
    item.Valor_NF += toNumber(row.valorNF);
    item.Frete_Realizado += toNumber(row.valorCte);
  });

  return [...mapa.values()].map((item) => ({
    ...item,
    Media_Peso_CTE: item.CTEs ? item.Peso_Considerado / item.CTEs : 0,
    Media_Volumes_CTE: item.CTEs ? item.Volumes / item.CTEs : 0,
    Percentual_Frete: item.Valor_NF ? (item.Frete_Realizado / item.Valor_NF) * 100 : 0,
  })).sort((a, b) => String(a.UF_Destino || a.IBGE_Destino || '').localeCompare(String(b.UF_Destino || b.IBGE_Destino || '')));
}

function detalheRow(row = {}) {
  const canal = String(row.canal || '').toUpperCase();
  const peso = pesoConsiderado(row);
  return {
    CTE: row.numeroCte || '',
    Data: row.dataEmissao || '',
    Canal: row.canal || '',
    Transportadora: row.transportadora || '',
    Origem: row.cidadeOrigem || '',
    UF_Origem: row.ufOrigem || '',
    IBGE_Origem: row.ibgeOrigem || '',
    Destino: row.cidadeDestino || '',
    UF_Destino: row.ufDestino || '',
    IBGE_Destino: row.ibgeDestino || '',
    Faixa_Peso: canal === 'B2C' || canal === 'ATACADO' ? faixaVolumetria(canal, peso) : '',
    Volumes: toNumber(row.qtdVolumes),
    Peso_Considerado: peso,
    Cubagem: toNumber(row.cubagem),
    Valor_NF: toNumber(row.valorNF),
    Frete_Realizado: toNumber(row.valorCte),
  };
}

export default function FerramentasPage() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');

  const alterar = (campo, valor) => setConfig((prev) => ({ ...prev, [campo]: valor }));

  async function exportarVolumetria() {
    setCarregando(true);
    setErro('');
    setMensagem('Gerando volumetria a partir do Realizado Local...');
    try {
      const { rows, totalCompativel, limit } = await exportarRealizadoLocal({
        canal: config.canal,
        inicio: config.inicio,
        fim: config.fim,
        excluirEbazar: Boolean(config.excluirEbazar),
      }, { limit: 500000 });
      if (!rows.length) throw new Error('Não existe base local com os filtros informados.');

      const volumetria = montarVolumetria(rows, config);
      const resumo = [{
        Canal: config.canal || 'Todos',
        Periodo_Inicial: config.inicio || 'Todos',
        Periodo_Final: config.fim || 'Todos',
        Agrupamento: config.agrupamento,
        CTEs: rows.length,
        Linhas_Volumetria: volumetria.length,
        Observacao: totalCompativel > limit ? 'A base passou do limite exportado. Refaça com período menor.' : 'Volumetria completa dentro do limite.',
      }];
      const abas = { Volumetria: volumetria, Resumo: resumo };
      if (config.incluirDetalhe) abas.Detalhe_CTE = rows.map(detalheRow);
      baixarXlsx(`volumetria-transportador-${config.canal || 'todos'}-${Date.now()}.xlsx`, abas);
      setMensagem(`Volumetria exportada: ${rows.length.toLocaleString('pt-BR')} CT-e(s), ${volumetria.length.toLocaleString('pt-BR')} linha(s).`);
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
        <p>Utilitários separados das telas operacionais para gerar bases de apoio, volumetria e arquivos para transportadores.</p>
      </div>

      {erro ? <div className="sim-alert error">{erro}</div> : null}
      {mensagem ? <div className="sim-alert info">{mensagem}</div> : null}

      <section className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Exportar volumetria para transportador</div>
            <p>Gera uma base agrupada do Realizado Local com origem, destino, IBGE, faixa de peso, cubagem, valor de nota e volumes.</p>
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
            Incluir detalhe por CT-e
          </label>
        </div>

        <div className="hint-box compact">
          Para ATACADO e B2C, o arquivo já inclui a faixa de peso padrão do canal para facilitar a precificação da transportadora.
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
