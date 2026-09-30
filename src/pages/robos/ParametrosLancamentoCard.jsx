import { useRef } from 'react';
import { extrairParametrosDeArquivo, isoParaBr, salvarParametros } from '../../utils/robos/lancamentoComum';

const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');

// Tabelas de Filiais e Escritorios BI (antes vinham do Parametros.xlsx via Power Query).
export default function ParametrosLancamentoCard({ parametros, onChange, onErro, onFeedback }) {
  const ref = useRef(null);
  const semTabelas = !parametros.filiais.length || !parametros.escritorios.length;

  async function importar(arquivo) {
    if (!arquivo) return;
    onErro('');
    try {
      const r = await extrairParametrosDeArquivo(arquivo);
      const novo = salvarParametros(r);
      onChange(novo);
      onFeedback(`Tabelas atualizadas: ${fmt(novo.filiais.length)} filiais e ${fmt(novo.escritorios.length)} centros de custo.`);
    } catch (e) {
      onErro(e.message || 'Nao consegui ler as tabelas.');
    } finally {
      if (ref.current) ref.current.value = '';
    }
  }

  return (
    <div className="panel-card">
      <div className="panel-title">Tabelas de parâmetros</div>
      <p>Filiais (empresa e centro pelo CNPJ do tomador) e Escritórios BI (centro de custo). Importe uma vez o <code>Parâmetros.xlsx</code> (ou qualquer planilha de lançamento que tenha as abas Filiais_Cantu e Escritorios BI); ficam guardadas neste navegador.</p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <input ref={ref} type="file" accept=".xlsx,.xlsm,.xls" onChange={(e) => importar(e.target.files?.[0])} />
        <span style={{ color: semTabelas ? '#b91c1c' : '#334155' }}>
          {semTabelas ? 'Tabelas ainda não importadas.' : `${fmt(parametros.filiais.length)} filiais · ${fmt(parametros.escritorios.length)} centros de custo · atualizado em ${isoParaBr((parametros.atualizadoEm || '').slice(0, 10))}`}
        </span>
      </div>
    </div>
  );
}
