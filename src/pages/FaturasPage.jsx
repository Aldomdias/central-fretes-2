import { useEffect, useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  carregarFaturasSupabase,
  carregarDetalhesFaturaSupabase,
  salvarFaturaSupabase,
  salvarDetalhesFaturaSupabase,
} from '../services/lotacaoSupabaseService';
import { carregarSessao } from '../utils/authLocal';

function fmt(v) {
  if (v == null || v === '') return '-';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtData(v) {
  if (!v) return '-';
  const s = String(v).slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return v;
  return `${d}/${m}/${y}`;
}

function pillStatus(status) {
  const map = {
    PENDENTE: 'status-pill',
    AUDITADA: 'status-pill dark',
    APROVADA: 'status-pill',
    PAGA: 'status-pill',
    DIVERGENCIA: 'status-pill error',
    CANCELADA: 'status-pill error',
  };
  return map[status] || 'status-pill';
}

// Converte linha do xlsx no cabeçalho da fatura
function parseFaturaHeader(row) {
  return {
    transportadora: row['Transportadora'] || '',
    cnpj_transportadora: String(row['CNPJ Transportadora'] || '').replace(/\D/g, ''),
    data_envio: row['Data Envio'] ? excelDateToISO(row['Data Envio']) : null,
    data_emissao: row['Data Emissão'] ? excelDateToISO(row['Data Emissão']) : null,
    data_vencimento: row['Data Vencimento'] ? excelDateToISO(row['Data Vencimento']) : null,
    numero_fatura: String(row['Numero Fatura'] || row['Número Fatura'] || ''),
    serie_fatura: String(row['Serie Fatura'] || row['Série Fatura'] || ''),
    ctes_totais: Number(row['CTes Totais'] || row['CTes Total'] || 0),
    ctes_vinculados: Number(row['CTes Vinculados'] || 0),
    valor_fatura: Number(row['Valor Fatura'] || 0),
    valor_icms: Number(row['Valor ICMS'] || 0),
    valor_calculado: Number(row['Valor Calculado'] || 0),
    diferenca: Number(row['Diferença'] || row['Diferenca'] || 0),
    banco: String(row['Banco'] || ''),
    status: String(row['Status'] || 'PENDENTE'),
    status_fatura: String(row['Status da fatura'] || row['Status Fatura'] || ''),
    status_pagamento: String(row['Status pagamento'] || row['Status Pagamento'] || ''),
    cnpj_tomador: String(row['CNPJ Tomador da Fatura'] || row['CNPJ Tomador'] || '').replace(/\D/g, ''),
    nome_tomador: String(row['Nome Tomador da Fatura'] || row['Nome Tomador'] || ''),
    enviado_para_pagamento: String(row['Enviado para pagamento'] || '').toUpperCase() === 'SIM',
  };
}

// Converte linha do xlsx no detalhe (CT-e)
function parseFaturaDetalhe(row, faturaId, numeroFatura, serieFatura) {
  return {
    fatura_id: faturaId,
    numero_fatura: numeroFatura,
    serie_fatura: serieFatura,
    transportadora: row['Transportadora'] || '',
    cnpj_transportadora: String(row['CNPJ Transportadora'] || '').replace(/\D/g, ''),
    chave_cte: String(row['Chave CTe'] || row['Chave CT-e'] || ''),
    numero_cte: String(row['Numero CTe'] || row['Número CT-e'] || row['Numero CT-e'] || ''),
    serie_cte: String(row['Serie CTe'] || row['Série CT-e'] || ''),
    mes_ano_emissao_cte: String(row['Mes/Ano Emissão CTe'] || row['Mes/Ano Emissao CTe'] || ''),
    cnpj_emissor: String(row['CNPJ Emissor'] || '').replace(/\D/g, ''),
    cnpj_tomador: String(row['CNPJ Tomador da Fatura'] || row['CNPJ Tomador'] || '').replace(/\D/g, ''),
    nome_tomador: String(row['Nome Tomador da Fatura'] || row['Nome Tomador'] || ''),
    valor_frete: Number(row['Valor Frete'] || 0),
    custo_frete: Number(row['Custo Frete'] || 0),
    preco_frete: Number(row['Preço Frete'] || row['Preco Frete'] || 0),
    calculado_frete: Number(row['Calculado Frete'] || 0),
    diferenca: Number(row['Diferença'] || row['Diferenca'] || 0),
    status_conciliacao: String(row['Status Conciliação'] || row['Status Conciliacao'] || ''),
    status_processamento: String(row['Status Processamento'] || ''),
    cte_integrado_erp: String(row['CTe Integrado ERP'] || '').toUpperCase() === 'SIM',
    status: String(row['Status'] || 'PENDENTE'),
    codigo_tratativa: String(row['Codigo da Tratativa'] || row['Código da Tratativa'] || ''),
    tratativa: String(row['Tratativa'] || ''),
    observacao: String(row['Observação'] || row['Observacao'] || ''),
    usuario: String(row['Usuario'] || row['Usuário'] || ''),
    justificativa_inativacao: String(row['Justificativa da inativação'] || ''),
  };
}

function excelDateToISO(val) {
  if (!val) return null;
  if (typeof val === 'string') {
    // Já é string data
    const parts = val.split('/');
    if (parts.length === 3) {
      const [d, m, y] = parts;
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return val.slice(0, 10);
  }
  if (typeof val === 'number') {
    // Excel serial date
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  return null;
}

// ─── Painel de cards ─────────────────────────────────────────────────────────

function CardResumo({ label, valor, cor }) {
  return (
    <div className="summary-card" style={{ borderLeft: `4px solid ${cor || '#9153F0'}` }}>
      <span>{label}</span>
      <strong>{valor}</strong>
    </div>
  );
}

// ─── Tabela de detalhes da fatura ────────────────────────────────────────────

function DetalhesFatura({ faturaId, onFechar }) {
  const [detalhes, setDetalhes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState('');

  useEffect(() => {
    if (!faturaId) return;
    setCarregando(true);
    carregarDetalhesFaturaSupabase(faturaId)
      .then(setDetalhes)
      .catch(() => setDetalhes([]))
      .finally(() => setCarregando(false));
  }, [faturaId]);

  const lista = filtro
    ? detalhes.filter((d) =>
        [d.chave_cte, d.numero_cte, d.status, d.transportadora]
          .join(' ').toUpperCase().includes(filtro.toUpperCase())
      )
    : detalhes;

  const divergencias = detalhes.filter((d) => Number(d.diferenca || 0) !== 0).length;
  const naoCalculados = detalhes.filter((d) => !d.calculado_frete || Number(d.calculado_frete) === 0).length;

  return (
    <div className="panel-card" style={{ marginTop: '1rem' }}>
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Detalhes da fatura — CT-es</div>
          <p className="compact">
            {detalhes.length} CT-es · {divergencias} com divergência · {naoCalculados} não calculados
          </p>
        </div>
        <button className="btn-secondary" onClick={onFechar}>Fechar detalhe</button>
      </div>

      <input
        className="field"
        placeholder="Filtrar por CT-e, status, transportadora..."
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        style={{ marginBottom: '0.75rem', display: 'block', width: '100%' }}
      />

      {carregando ? (
        <div className="hint-box compact">Carregando detalhes...</div>
      ) : (
        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead>
              <tr>
                <th>Chave CT-e</th>
                <th>Nº CT-e</th>
                <th>Transportadora</th>
                <th>Valor Frete</th>
                <th>Calculado</th>
                <th>Diferença</th>
                <th>Status Conc.</th>
                <th>Status ERP</th>
                <th>Tratativa</th>
                <th>Observação</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((d, i) => (
                <tr key={d.id || i} className={Number(d.diferenca || 0) !== 0 ? 'row-alert' : ''}>
                  <td><small>{d.chave_cte || '-'}</small></td>
                  <td>{d.numero_cte || '-'}</td>
                  <td>{d.transportadora || '-'}</td>
                  <td>{fmt(d.valor_frete)}</td>
                  <td>{d.calculado_frete ? fmt(d.calculado_frete) : <span style={{ color: '#c0392b' }}>Não calc.</span>}</td>
                  <td className={Number(d.diferenca || 0) !== 0 ? 'negativo' : ''}>{fmt(d.diferenca)}</td>
                  <td><span className={pillStatus(d.status_conciliacao)}>{d.status_conciliacao || '-'}</span></td>
                  <td>{d.cte_integrado_erp ? '✓ ERP' : '-'}</td>
                  <td>{d.tratativa || d.codigo_tratativa || '-'}</td>
                  <td>{d.observacao || '-'}</td>
                </tr>
              ))}
              {!lista.length && (
                <tr><td colSpan="10">Nenhum CT-e encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function FaturasPage() {
  const sessao = carregarSessao();
  const fileRef = useRef(null);

  const [faturas, setFaturas] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [importando, setImportando] = useState(false);
  const [faturaAberta, setFaturaAberta] = useState(null);

  const [filtros, setFiltros] = useState({
    transportadora: '',
    status: '',
    vencimentoInicio: '',
    vencimentoFim: '',
  });

  // ── Carregar faturas ─────────────────────────────────────────────────────
  const carregar = async () => {
    setCarregando(true);
    setMensagem('');
    try {
      const resultado = await carregarFaturasSupabase({
        transportadora: filtros.transportadora || undefined,
        status: filtros.status || undefined,
        dataVencimentoInicio: filtros.vencimentoInicio || undefined,
        dataVencimentoFim: filtros.vencimentoFim || undefined,
      });
      setFaturas(resultado || []);
    } catch (err) {
      setMensagem(`Erro ao carregar faturas: ${err.message}`);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => { carregar(); }, []);

  // ── Importar arquivo xlsx ────────────────────────────────────────────────
  const handleImportar = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setImportando(true);
    setMensagem('Lendo arquivo...');

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array', cellDates: false });

      // Aba "Faturas"
      const wsFaturas = wb.Sheets[wb.SheetNames.find((n) => n.toLowerCase().includes('fatura')) || wb.SheetNames[0]];
      const rowsFaturas = XLSX.utils.sheet_to_json(wsFaturas, { defval: '' });

      // Aba "Detalhes"
      const wsDetalhes = wb.Sheets[wb.SheetNames.find((n) => n.toLowerCase().includes('detalhe')) || wb.SheetNames[1]];
      const rowsDetalhes = wsDetalhes ? XLSX.utils.sheet_to_json(wsDetalhes, { defval: '' }) : [];

      setMensagem(`Processando ${rowsFaturas.length} faturas e ${rowsDetalhes.length} CT-es...`);

      let faturasSalvas = 0;
      let detalhesSalvos = 0;

      for (const row of rowsFaturas) {
        const header = parseFaturaHeader(row);
        if (!header.numero_fatura && !header.transportadora) continue;

        header.importado_por = sessao?.nome || sessao?.email || '';
        header.importado_em = new Date().toISOString();

        const resultado = await salvarFaturaSupabase(header);
        if (!resultado.ok) continue;
        faturasSalvas++;
        const faturaId = resultado.id;

        // Filtrar detalhes desta fatura
        const detalhesLinhas = rowsDetalhes.filter((d) =>
          String(d['Numero Fatura'] || d['Número Fatura'] || '') === String(header.numero_fatura) &&
          String(d['Serie Fatura'] || d['Série Fatura'] || '') === String(header.serie_fatura)
        );

        if (detalhesLinhas.length > 0 && faturaId) {
          const detalhes = detalhesLinhas.map((d) =>
            parseFaturaDetalhe(d, faturaId, header.numero_fatura, header.serie_fatura)
          );
          await salvarDetalhesFaturaSupabase(detalhes);
          detalhesSalvos += detalhes.length;
        }
      }

      setMensagem(`✓ Importação concluída: ${faturasSalvas} faturas e ${detalhesSalvos} CT-es gravados.`);
      await carregar();
    } catch (err) {
      setMensagem(`Erro na importação: ${err.message}`);
    } finally {
      setImportando(false);
    }
  };

  // ── Resumos ──────────────────────────────────────────────────────────────
  const totalFaturas = faturas.length;
  const totalValor = faturas.reduce((s, f) => s + Number(f.valor_fatura || 0), 0);
  const totalDivergencia = faturas.reduce((s, f) => s + Math.abs(Number(f.diferenca || 0)), 0);
  const pendentes = faturas.filter((f) => f.status === 'PENDENTE').length;
  const hoje = new Date().toISOString().slice(0, 10);
  const vencidas = faturas.filter((f) => f.data_vencimento && f.data_vencimento < hoje && f.status !== 'PAGA').length;

  return (
    <div className="page-shell">
      <div className="page-header">
        <span className="amd-mini-brand">Auditoria · Faturas</span>
        <h1>Central de Auditoria — Faturas</h1>
        <p>Gestão e importação de faturas de transportadoras. Vinculação com CT-es, divergências e histórico.</p>
      </div>

      {/* Filtros e ações */}
      <div className="panel-card">
        <div className="section-row compact-top">
          <div className="panel-title">Filtros</div>
          <div className="actions-right gap-row">
            <button
              className="btn-secondary"
              onClick={() => fileRef.current?.click()}
              disabled={importando}
            >
              {importando ? 'Importando...' : '↑ Importar arquivo'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: 'none' }}
              onChange={handleImportar}
            />
            <button className="btn-primary" onClick={carregar} disabled={carregando}>
              {carregando ? 'Carregando...' : 'Atualizar'}
            </button>
          </div>
        </div>

        <div className="form-grid four" style={{ marginTop: '0.75rem' }}>
          <label className="field">
            Transportadora
            <input
              value={filtros.transportadora}
              onChange={(e) => setFiltros((p) => ({ ...p, transportadora: e.target.value }))}
              placeholder="Nome ou parte"
            />
          </label>
          <label className="field">
            Status
            <select
              value={filtros.status}
              onChange={(e) => setFiltros((p) => ({ ...p, status: e.target.value }))}
            >
              <option value="">Todos</option>
              <option value="PENDENTE">Pendente</option>
              <option value="AUDITADA">Auditada</option>
              <option value="APROVADA">Aprovada</option>
              <option value="PAGA">Paga</option>
              <option value="DIVERGENCIA">Com divergência</option>
              <option value="CANCELADA">Cancelada</option>
            </select>
          </label>
          <label className="field">
            Vencimento de
            <input
              type="date"
              value={filtros.vencimentoInicio}
              onChange={(e) => setFiltros((p) => ({ ...p, vencimentoInicio: e.target.value }))}
            />
          </label>
          <label className="field">
            Vencimento até
            <input
              type="date"
              value={filtros.vencimentoFim}
              onChange={(e) => setFiltros((p) => ({ ...p, vencimentoFim: e.target.value }))}
            />
          </label>
        </div>

        <div className="actions-right" style={{ marginTop: '0.5rem' }}>
          <button className="btn-secondary" onClick={() => { setFiltros({ transportadora: '', status: '', vencimentoInicio: '', vencimentoFim: '' }); }}>
            Limpar filtros
          </button>
          <button className="btn-primary" onClick={carregar}>Buscar</button>
        </div>

        {mensagem && <div className="hint-box compact" style={{ marginTop: '0.5rem' }}>{mensagem}</div>}
      </div>

      {/* Cards de resumo */}
      <div className="summary-strip">
        <CardResumo label="Total de faturas" valor={totalFaturas.toLocaleString('pt-BR')} cor="#9153F0" />
        <CardResumo label="Valor total" valor={totalValor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} cor="#04C7A4" />
        <CardResumo label="Total divergência" valor={totalDivergencia.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} cor="#f0a800" />
        <CardResumo label="Pendentes" valor={pendentes.toLocaleString('pt-BR')} cor="#9153F0" />
        <CardResumo label="Vencidas / sem pagamento" valor={vencidas.toLocaleString('pt-BR')} cor="#9b1111" />
      </div>

      {/* Tabela de faturas */}
      <div className="table-card">
        <div className="panel-title" style={{ padding: '0.75rem 1rem 0.25rem' }}>
          Faturas ({totalFaturas})
        </div>
        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead>
              <tr>
                <th>Nº Fatura / Série</th>
                <th>Transportadora</th>
                <th>Emissão</th>
                <th>Vencimento</th>
                <th>CT-es</th>
                <th>Valor Fatura</th>
                <th>Valor Calc.</th>
                <th>Diferença</th>
                <th>Status</th>
                <th>Pagamento</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {faturas.map((f) => {
                const diff = Number(f.diferenca || 0);
                return (
                  <tr key={f.id} className={diff !== 0 ? 'row-alert' : ''}>
                    <td>
                      <strong>{f.numero_fatura}</strong>
                      {f.serie_fatura ? <small> / {f.serie_fatura}</small> : ''}
                    </td>
                    <td>{f.transportadora || '-'}</td>
                    <td>{fmtData(f.data_emissao)}</td>
                    <td>
                      <span style={{ color: f.data_vencimento && f.data_vencimento < hoje && f.status !== 'PAGA' ? '#9b1111' : undefined }}>
                        {fmtData(f.data_vencimento)}
                      </span>
                    </td>
                    <td>
                      {f.ctes_vinculados || 0}/{f.ctes_totais || 0}
                    </td>
                    <td>{fmt(f.valor_fatura)}</td>
                    <td>{f.valor_calculado ? fmt(f.valor_calculado) : <span style={{ color: '#888' }}>—</span>}</td>
                    <td className={diff !== 0 ? 'negativo' : ''}>{diff !== 0 ? fmt(diff) : '—'}</td>
                    <td><span className={pillStatus(f.status)}>{f.status || 'PENDENTE'}</span></td>
                    <td><span className={pillStatus(f.status_pagamento)}>{f.status_pagamento || '—'}</span></td>
                    <td>
                      <button
                        className="btn-secondary"
                        style={{ padding: '2px 10px', fontSize: '0.8rem' }}
                        onClick={() => setFaturaAberta(faturaAberta?.id === f.id ? null : f)}
                      >
                        {faturaAberta?.id === f.id ? 'Fechar' : 'Ver CT-es'}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!faturas.length && !carregando && (
                <tr>
                  <td colSpan="11">
                    Nenhuma fatura encontrada. Importe um arquivo ou ajuste os filtros.
                  </td>
                </tr>
              )}
              {carregando && (
                <tr><td colSpan="11">Carregando...</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detalhe expandido */}
      {faturaAberta && (
        <DetalhesFatura
          faturaId={faturaAberta.id}
          onFechar={() => setFaturaAberta(null)}
        />
      )}

      <div className="hint-box compact" style={{ marginTop: '1rem' }}>
        <strong>Como importar:</strong> O arquivo deve ter duas abas: "Faturas" e "Detalhes", no layout padrão Verum.
        Colunas obrigatórias: Transportadora, Numero Fatura, Data Vencimento, Valor Fatura, Chave CTe, Valor Frete.
      </div>
    </div>
  );
}
