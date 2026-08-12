import { useEffect, useMemo, useState } from 'react';
import { carregarFaturasSupabase } from '../services/lotacaoSupabaseService';
import {
  carregarResultadosAuditoriaMes,
  enriquecerCtesComFaturas,
} from '../services/auditoriaCteProcessamentoService';

const competenciaAtual = () => new Date().toISOString().slice(0, 7);
const normalizar = (valor) => String(valor || '').trim().toUpperCase();

function intervaloCompetencia(competencia) {
  const [ano, mes] = String(competencia || '').split('-').map(Number);
  if (!ano || !mes) return { inicio: '', fim: '' };
  const ultimoDia = new Date(ano, mes, 0).getDate();
  return {
    inicio: `${ano}-${String(mes).padStart(2, '0')}-01`,
    fim: `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`,
  };
}

function Card({ label, valor, cor = '#1d4ed8', alerta = false, sub = '' }) {
  return (
    <div className="summary-card" style={{ borderLeft: `4px solid ${cor}`, background: alerta ? '#fff7ed' : undefined }}>
      <span>{label}</span><strong>{valor.toLocaleString('pt-BR')}</strong>{sub && <small>{sub}</small>}
    </div>
  );
}

export default function PainelControleAuditoriaPage() {
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [auditor, setAuditor] = useState('');
  const [ctes, setCtes] = useState([]);
  const [faturas, setFaturas] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  async function carregar() {
    setCarregando(true);
    setErro('');
    try {
      const periodo = intervaloCompetencia(competencia);
      const [ctesSalvos, faturasMes] = await Promise.all([
        carregarResultadosAuditoriaMes({ competencia }),
        carregarFaturasSupabase({ dataEmissaoInicio: periodo.inicio, dataEmissaoFim: periodo.fim, limite: 5000 }),
      ]);
      setCtes(await enriquecerCtesComFaturas(ctesSalvos || []));
      setFaturas(faturasMes || []);
    } catch (error) {
      setErro(error.message || 'Não foi possível carregar o painel de auditoria.');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { carregar(); }, [competencia]);

  const auditores = useMemo(() => [...new Set([
    ...ctes.map((item) => item.auditor_nome_carteira),
    ...faturas.map((item) => item.auditor_nome),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [ctes, faturas]);

  const resumo = useMemo(() => {
    const nomeSelecionado = normalizar(auditor);
    const ctesFiltrados = nomeSelecionado
      ? ctes.filter((item) => normalizar(item.auditor_nome_carteira) === nomeSelecionado)
      : ctes;
    const faturasFiltradas = nomeSelecionado
      ? faturas.filter((item) => normalizar(item.auditor_nome) === nomeSelecionado)
      : faturas;
    const mapa = new Map();
    const obter = (nome) => {
      const chave = String(nome || '').trim() || 'SEM AUDITOR DEFINIDO';
      if (!mapa.has(chave)) mapa.set(chave, {
        auditor: chave, ctes: 0, auditados: 0, semFatura: 0, comFatura: 0,
        divergentes: 0, faturas: 0, pendentes: 0, prontas: 0, pagas: 0,
      });
      return mapa.get(chave);
    };
    ctesFiltrados.forEach((cte) => {
      const item = obter(cte.auditor_nome_carteira);
      item.ctes += 1;
      if (Number(cte.valor_calculado || 0) > 0) item.auditados += 1;
      if (cte.tem_fatura) item.comFatura += 1; else item.semFatura += 1;
      const diferenca = Number(cte.valor_cte || 0) - Number(cte.valor_calculado || 0);
      if (Number(cte.valor_calculado || 0) > 0 && Math.abs(diferenca) >= 0.01) item.divergentes += 1;
    });
    faturasFiltradas.forEach((fatura) => {
      const item = obter(fatura.auditor_nome);
      item.faturas += 1;
      if (fatura.status === 'PRONTA_PARA_PAGAMENTO') item.prontas += 1;
      else if (['PAGA', 'PAGA_COM_DIVERGENCIA'].includes(fatura.status)) item.pagas += 1;
      else item.pendentes += 1;
    });
    return {
      linhas: [...mapa.values()].sort((a, b) => b.semFatura - a.semFatura || a.auditor.localeCompare(b.auditor, 'pt-BR')),
      total: ctesFiltrados.length,
      auditados: ctesFiltrados.filter((item) => Number(item.valor_calculado || 0) > 0).length,
      semFatura: ctesFiltrados.filter((item) => !item.tem_fatura).length,
      comFatura: ctesFiltrados.filter((item) => item.tem_fatura).length,
      pendentes: faturasFiltradas.filter((item) => !['PRONTA_PARA_PAGAMENTO', 'PAGA', 'PAGA_COM_DIVERGENCIA'].includes(item.status)).length,
      prontas: faturasFiltradas.filter((item) => item.status === 'PRONTA_PARA_PAGAMENTO').length,
      pagas: faturasFiltradas.filter((item) => ['PAGA', 'PAGA_COM_DIVERGENCIA'].includes(item.status)).length,
    };
  }, [auditor, ctes, faturas]);

  return (
    <div className="page-shell">
      <div className="page-header">
        <span className="amd-mini-brand">Auditoria · Controle operacional</span>
        <h1>Painel da Auditoria</h1>
        <p>Acompanhamento mensal de CT-es, faturamento, auditoria e liberação para pagamento.</p>
      </div>

      <div className="panel-card" style={{ marginBottom: '1rem' }}>
        <div className="form-grid three" style={{ alignItems: 'end' }}>
          <label className="field">Competência<input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} /></label>
          <label className="field">Auditor<select value={auditor} onChange={(e) => setAuditor(e.target.value)}><option value="">Todos os auditores</option>{auditores.map((nome) => <option key={nome} value={nome}>{nome}</option>)}</select></label>
          <button className="btn-primary" type="button" onClick={carregar} disabled={carregando}>{carregando ? 'Atualizando...' : 'Atualizar painel'}</button>
        </div>
        {erro && <div className="hint-box compact" style={{ marginTop: '0.75rem' }}>{erro}</div>}
      </div>

      <div className="summary-strip" style={{ flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
        <Card label="CT-es do mês" valor={resumo.total} />
        <Card label="CT-es auditados" valor={resumo.auditados} cor="#059669" />
        <Card label="CT-es sem fatura" valor={resumo.semFatura} cor="#ea580c" alerta={resumo.semFatura > 0} sub="aguardando faturamento" />
        <Card label="CT-es com fatura" valor={resumo.comFatura} cor="#7c3aed" />
        <Card label="Faturas em auditoria" valor={resumo.pendentes} cor="#d97706" />
        <Card label="Prontas para pagamento" valor={resumo.prontas} cor="#2563eb" />
        <Card label="Faturas pagas" valor={resumo.pagas} cor="#15803d" />
      </div>

      <div className="table-card">
        <div className="panel-title" style={{ padding: '0.85rem 1rem' }}>Controle por auditor · {competencia}</div>
        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead><tr><th>Auditor</th><th>CT-es</th><th>Auditados</th><th>Sem fatura</th><th>Com fatura</th><th>Divergentes</th><th>Faturas</th><th>Em auditoria</th><th>Prontas p/ pagamento</th><th>Pagas</th></tr></thead>
            <tbody>
              {resumo.linhas.map((item) => <tr key={item.auditor}><td><strong>{item.auditor}</strong></td><td>{item.ctes}</td><td>{item.auditados}</td><td style={{ color: item.semFatura ? '#c2410c' : undefined }}><strong>{item.semFatura}</strong></td><td>{item.comFatura}</td><td>{item.divergentes}</td><td>{item.faturas}</td><td>{item.pendentes}</td><td>{item.prontas}</td><td>{item.pagas}</td></tr>)}
              {!resumo.linhas.length && <tr><td colSpan="10">{carregando ? 'Carregando...' : 'Nenhum dado encontrado para esta competência.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
