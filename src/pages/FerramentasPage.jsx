import { useState } from 'react';
import * as XLSX from 'xlsx';
import { exportarTrackingLocal } from '../utils/trackingLocal';
import { carregarGradeFrete, salvarGradeFrete, restaurarGradeFretePadrao, encontrarLinhaGradePorPeso } from '../utils/gradeFreteConfig';

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

function faixaVolumetria(canal, peso, grade = {}) {
  const canalNorm = String(canal || '').toUpperCase() === 'B2C' ? 'B2C' : 'ATACADO';
  const linha = encontrarLinhaGradePorPeso(grade[canalNorm] || [], peso);
  if (!linha) return '';
  const limite = Number(linha.peso || 0);
  if (!limite || limite >= 999999) return `${limite >= 999999 ? '100+' : limite} kg`;
  return `Até ${limite.toLocaleString('pt-BR')} kg`;
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
    Notas: 0,
    Volumes: 0,
    Peso_Real: 0,
    Peso_Declarado: 0,
    Peso_Cubado: 0,
    Peso_Considerado: 0,
    Cubagem: 0,
    Valor_NF: 0,
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
    item.Cubagem += toNumber(row.cubagem);
    item.Valor_NF += toNumber(row.valorNF);
  });

  return [...mapa.values()].map((item) => ({
    ...item,
    Media_Peso_Nota: item.Notas ? item.Peso_Considerado / item.Notas : 0,
    Media_Volumes_Nota: item.Notas ? item.Volumes / item.Notas : 0,
    Media_Cubagem_Nota: item.Notas ? item.Cubagem / item.Notas : 0,
  })).sort((a, b) => String(a.UF_Destino || a.IBGE_Destino || '').localeCompare(String(b.UF_Destino || b.IBGE_Destino || '')));
}

function detalheRow(row = {}, grade = {}) {
  const canal = String(row.canal || '').toUpperCase();
  const peso = pesoConsiderado(row);
  return {
    Nota_Fiscal: row.notaFiscal || '',
    Pedido: row.pedido || '',
    Data: row.data || '',
    Canal: row.canal || '',
    Transportadora: row.transportadora || '',
    Origem: row.cidadeOrigem || '',
    UF_Origem: row.ufOrigem || '',
    IBGE_Origem: row.ibgeOrigem || '',
    Destino: row.cidadeDestino || '',
    UF_Destino: row.ufDestino || '',
    IBGE_Destino: row.ibgeDestino || '',
    Faixa_Peso: canal === 'B2C' || canal === 'ATACADO' ? faixaVolumetria(canal, peso, grade) : '',
    Volumes: toNumber(row.qtdVolumes),
    Peso_Considerado: peso,
    Cubagem: toNumber(row.cubagem),
    Valor_NF: toNumber(row.valorNF),
  };
}


const CANAIS_GRADE = ['ATACADO', 'B2C'];

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
      const { rows, totalCompativel, limit } = await exportarTrackingLocal({
        canal: config.canal,
        inicio: config.inicio,
        fim: config.fim,
        excluirEbazar: Boolean(config.excluirEbazar),
      }, { limit: 500000 });
      if (!rows.length) throw new Error('Não existe base de Tracking local com os filtros informados. Importe primeiro no módulo Tracking.');

      const volumetria = montarVolumetria(rows, config, grade);
      const resumo = [{
        Canal: config.canal || 'Todos',
        Periodo_Inicial: config.inicio || 'Todos',
        Periodo_Final: config.fim || 'Todos',
        Agrupamento: config.agrupamento,
        Notas: rows.length,
        Linhas_Volumetria: volumetria.length,
        Observacao: totalCompativel > limit ? 'A base passou do limite exportado. Refaça com período menor.' : 'Volumetria completa dentro do limite.',
      }];
      const abas = { Volumetria: volumetria, Resumo: resumo };
      if (config.incluirDetalhe) abas.Detalhe_Tracking = rows.map((row) => detalheRow(row, grade));
      baixarXlsx(`volumetria-transportador-${config.canal || 'todos'}-${Date.now()}.xlsx`, abas);
      setMensagem(`Volumetria exportada: ${rows.length.toLocaleString('pt-BR')} nota(s)/linha(s) do Tracking, ${volumetria.length.toLocaleString('pt-BR')} linha(s) agrupadas.`);
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
                  <td>Se o CT-e não tiver cubagem, usa esta cubagem para peso até {linha.peso || '...'} kg.</td>
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
            Incluir detalhe por nota
          </label>
        </div>

        <div className="hint-box compact">
          Para ATACADO e B2C, o arquivo já inclui a faixa de peso padrão do canal. A fonte desta volumetria agora é o Tracking local, não mais a base de CT-e.
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
