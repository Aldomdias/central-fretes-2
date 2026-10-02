import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const TABELA = 'tracking_rows';
const PAGE_SIZE = 50;
const LIMITE_EXPORTACAO = 50000;
const LOTE_EXPORTACAO = 1000;
const COLUNAS = 'id, data, competencia, nota_fiscal, chave_nfe, chave_cte, cte_numero, pedido, pedido_erp, canal, status_pedido, transportadora, cidade_origem, uf_origem, cidade_destino, uf_destino, peso, cubagem_final, valor_nf, qtd_volumes, previsao_cliente, previsao_transportadora, data_transporte, data_entrega';
const UFS = ['', 'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
const CANAIS = ['', 'B2C', 'ATACADO', 'INTERCOMPANY', 'REVERSA', 'EBAZAR'];

function formatarNumero(value, casas = 0) {
  return Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function formatarMoeda(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarData(value) {
  if (!value) return '-';
  const [ano, mes, dia] = String(value).slice(0, 10).split('-');
  if (!ano || !mes || !dia) return '-';
  return `${dia}/${mes}/${ano}`;
}

function isoData(data) {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}

function periodoPadrao() {
  const fim = new Date();
  const inicio = new Date(fim.getFullYear(), fim.getMonth(), 1);
  return { inicio: isoData(inicio), fim: isoData(fim) };
}

function somenteDigitos(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function ehCancelado(row) {
  return String(row?.status_pedido || '').toUpperCase().includes('CANCELAD');
}

function ehReversa(row) {
  return String(row?.canal || '').toUpperCase() === 'REVERSA' || String(row?.status_pedido || '').toUpperCase().includes('REVERS');
}

function pct(parte, total) {
  return total ? `${((parte / total) * 100).toFixed(1).replace('.', ',')}% do filtro` : '-';
}

function hoje() {
  return isoData(new Date());
}

function ehAtrasado(row) {
  return !row?.data_entrega && !!row?.previsao_cliente && String(row.previsao_cliente).slice(0, 10) < hoje();
}

const FILTRO_CANCELADO = 'status_pedido.ilike.%CANCELAD%';
const FILTRO_REVERSA = 'canal.eq.REVERSA,status_pedido.ilike.%REVERS%';

function aplicarFiltros(query, filtros) {
  let q = query;
  if (filtros.inicio) q = q.gte('data', filtros.inicio);
  if (filtros.fim) q = q.lte('data', filtros.fim);
  if (filtros.canal) q = q.eq('canal', filtros.canal);
  if (filtros.ufOrigem) q = q.eq('uf_origem', filtros.ufOrigem);
  if (filtros.ufDestino) q = q.eq('uf_destino', filtros.ufDestino);
  if (filtros.transportadora.trim()) q = q.ilike('transportadora', `%${filtros.transportadora.trim()}%`);
  if (filtros.status.trim()) q = q.ilike('status_pedido', `%${filtros.status.trim()}%`);
  if (filtros.tipo === 'cancelados') q = q.or(FILTRO_CANCELADO);
  else if (filtros.tipo === 'reversa') q = q.or(FILTRO_REVERSA);
  else if (filtros.tipo === 'normais') q = q.or('status_pedido.is.null,and(status_pedido.not.ilike.%CANCELAD%,status_pedido.not.ilike.%REVERS%)').neq('canal', 'REVERSA');
  if (filtros.entrega === 'entregues') q = q.not('data_entrega', 'is', null);
  else if (filtros.entrega === 'abertos') q = q.is('data_entrega', null);
  else if (filtros.entrega === 'atrasados') q = q.is('data_entrega', null).lt('previsao_cliente', hoje());
  const cte = filtros.cte.trim();
  if (cte) {
    const digitos = somenteDigitos(cte);
    if (digitos.length === 44) q = q.eq('chave_cte', digitos);
    else q = q.eq('cte_numero', cte);
  }
  const nf = filtros.nf.trim();
  if (nf) {
    const digitos = somenteDigitos(nf);
    if (digitos.length === 44) q = q.eq('chave_nfe', digitos);
    else q = q.eq('nota_fiscal', nf);
  }
  const pedido = filtros.pedido.trim();
  if (pedido) q = q.or(`pedido.eq.${pedido},pedido_erp.eq.${pedido}`);
  return q;
}

async function contar(filtros, extra) {
  const supabase = getSupabaseClient();
  let q = supabase.from(TABELA).select('id', { count: 'exact', head: true });
  q = aplicarFiltros(q, filtros);
  if (extra) q = extra(q);
  const { count, error } = await q;
  if (error) throw error;
  return count || 0;
}

async function listarPagina(filtros, pagina) {
  const supabase = getSupabaseClient();
  let q = supabase.from(TABELA).select(COLUNAS);
  q = aplicarFiltros(q, filtros);
  const de = pagina * PAGE_SIZE;
  const { data, error } = await q
    .order('data', { ascending: false })
    .order('id', { ascending: false })
    .range(de, de + PAGE_SIZE - 1);
  if (error) throw error;
  return data || [];
}

async function buscarParaExportar(filtros, onProgress) {
  const supabase = getSupabaseClient();
  const todas = [];
  for (let de = 0; de < LIMITE_EXPORTACAO; de += LOTE_EXPORTACAO) {
    let q = supabase.from(TABELA).select(COLUNAS);
    q = aplicarFiltros(q, filtros);
    const { data, error } = await q
      .order('data', { ascending: false })
      .order('id', { ascending: false })
      .range(de, de + LOTE_EXPORTACAO - 1);
    if (error) throw error;
    todas.push(...(data || []));
    onProgress?.(todas.length);
    if ((data || []).length < LOTE_EXPORTACAO) break;
  }
  return todas;
}

const FILTROS_VAZIOS = {
  canal: '', tipo: '', entrega: '', status: '', ufOrigem: '', ufDestino: '', transportadora: '', cte: '', nf: '', pedido: '',
};

export default function ConsultaTrackingPage() {
  const [filtros, setFiltros] = useState(() => ({ ...periodoPadrao(), ...FILTROS_VAZIOS }));
  const [aplicados, setAplicados] = useState(null);
  const [linhas, setLinhas] = useState([]);
  const [pagina, setPagina] = useState(0);
  const [resumo, setResumo] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');

  function atualizar(chave, valor) {
    setFiltros((atual) => ({ ...atual, [chave]: valor }));
  }

  async function consultar(filtrosConsulta, paginaConsulta = 0, { recalcularResumo = true } = {}) {
    if (!isSupabaseConfigured()) {
      setErro('Supabase nao configurado. Verifique o .env.');
      return;
    }
    setCarregando(true);
    setErro('');
    setMensagem('');
    try {
      if (recalcularResumo) {
        const [total, cancelados, reversa, entregues, atrasados] = await Promise.all([
          contar(filtrosConsulta),
          contar(filtrosConsulta, (q) => q.or(FILTRO_CANCELADO)),
          contar(filtrosConsulta, (q) => q.or(FILTRO_REVERSA)),
          contar(filtrosConsulta, (q) => q.not('data_entrega', 'is', null)),
          contar(filtrosConsulta, (q) => q.is('data_entrega', null).lt('previsao_cliente', hoje())),
        ]);
        setResumo({ total, cancelados, reversa, entregues, atrasados });
      }
      const pagina_ = await listarPagina(filtrosConsulta, paginaConsulta);
      setLinhas(pagina_);
      setPagina(paginaConsulta);
      setAplicados(filtrosConsulta);
    } catch (error) {
      setErro(error.message || 'Erro ao consultar a base de CT-es. Reduza o periodo e tente de novo.');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    consultar(filtros).catch(() => {});
    // consulta inicial apenas
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pesquisar(event) {
    event?.preventDefault();
    if (!filtros.inicio || !filtros.fim) {
      setErro('Informe o periodo de emissao (inicio e fim).');
      return;
    }
    consultar({ ...filtros }, 0);
  }

  function limpar() {
    const novos = { ...periodoPadrao(), ...FILTROS_VAZIOS };
    setFiltros(novos);
    consultar(novos, 0);
  }

  function irParaPagina(proxima) {
    if (!aplicados || proxima < 0) return;
    consultar(aplicados, proxima, { recalcularResumo: false });
  }

  async function exportar() {
    if (!aplicados) return;
    setExportando(true);
    setErro('');
    try {
      const rows = await buscarParaExportar(aplicados, (qtd) => setMensagem(`Lendo ${formatarNumero(qtd)} CT-e(s) para exportar...`));
      const planilha = rows.map((row) => ({
        Data: formatarData(row.data),
        NF: row.nota_fiscal || '',
        'Chave NF': row.chave_nfe || '',
        'CT-e': row.cte_numero || '',
        'Chave CT-e': row.chave_cte || '',
        'Pedido ERP': row.pedido_erp || row.pedido || '',
        Canal: row.canal || '',
        'Status pedido': row.status_pedido || '',
        Tipo: ehCancelado(row) ? 'CANCELADO' : (ehReversa(row) ? 'REVERSA' : 'NORMAL'),
        Transportadora: row.transportadora || '',
        'Cidade origem': row.cidade_origem || '',
        'UF origem': row.uf_origem || '',
        'Cidade destino': row.cidade_destino || '',
        'UF destino': row.uf_destino || '',
        Peso: Number(row.peso || 0),
        Cubagem: Number(row.cubagem_final || 0),
        Volumes: Number(row.qtd_volumes || 0),
        'Valor NF': Number(row.valor_nf || 0),
        'Previsao cliente': formatarData(row.previsao_cliente),
        'Previsao transportadora': formatarData(row.previsao_transportadora),
        'Data transporte': formatarData(row.data_transporte),
        'Data entrega': formatarData(row.data_entrega),
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(planilha), 'Tracking');
      XLSX.writeFile(wb, `consulta-tracking-${aplicados.inicio}-a-${aplicados.fim}.xlsx`);
      setMensagem(`${formatarNumero(rows.length)} CT-e(s) exportado(s)${rows.length >= LIMITE_EXPORTACAO ? ` (limite de ${formatarNumero(LIMITE_EXPORTACAO)} — refine os filtros)` : ''}.`);
    } catch (error) {
      setErro(error.message || 'Erro ao exportar.');
      setMensagem('');
    } finally {
      setExportando(false);
    }
  }

  const totalPaginas = useMemo(() => Math.max(1, Math.ceil((resumo?.total || 0) / PAGE_SIZE)), [resumo]);
  const somaPagina = useMemo(() => linhas.reduce((acc, row) => acc + Number(row.valor_nf || 0), 0), [linhas]);
  const ocupado = carregando || exportando;

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="amd-mini-brand">AMD Log • Tracking</div>
        <h1>Consulta Tracking</h1>
        <p>
          Consulta da base completa do Tracking (<strong>tracking_rows</strong>), incluindo <strong>reversa</strong>, <strong>cancelados</strong> e situacao da entrega. Pesquise por NF, CT-e, pedido, canal, status e transportadora. Somente leitura.
        </p>
      </div>

      {erro ? <div className="sim-alert error">{erro}</div> : null}
      {mensagem ? <div className="sim-alert info">{mensagem}</div> : null}

      <section className="panel-card">
        <div className="panel-title">Filtros</div>
        <form onSubmit={pesquisar}>
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
            <label className="field">Emissao de
              <input type="date" value={filtros.inicio} onChange={(e) => atualizar('inicio', e.target.value)} />
            </label>
            <label className="field">Emissao ate
              <input type="date" value={filtros.fim} onChange={(e) => atualizar('fim', e.target.value)} />
            </label>
            <label className="field">Canal
              <select value={filtros.canal} onChange={(e) => atualizar('canal', e.target.value)}>
                {CANAIS.map((c) => <option key={c} value={c}>{c || 'Todos'}</option>)}
              </select>
            </label>
            <label className="field">Tipo
              <select value={filtros.tipo} onChange={(e) => atualizar('tipo', e.target.value)}>
                <option value="">Todos</option>
                <option value="cancelados">Somente cancelados</option>
                <option value="reversa">Somente reversa</option>
                <option value="normais">Sem cancelados/reversa</option>
              </select>
            </label>
            <label className="field">Entrega
              <select value={filtros.entrega} onChange={(e) => atualizar('entrega', e.target.value)}>
                <option value="">Todas</option>
                <option value="entregues">Entregues</option>
                <option value="abertos">Em aberto</option>
                <option value="atrasados">Atrasadas (sem entrega, prazo vencido)</option>
              </select>
            </label>
            <label className="field">Status do pedido
              <input value={filtros.status} onChange={(e) => atualizar('status', e.target.value)} placeholder="Parte do status" />
            </label>
            <label className="field">Pedido (ERP/numero)
              <input value={filtros.pedido} onChange={(e) => atualizar('pedido', e.target.value)} placeholder="Numero exato do pedido" />
            </label>
            <label className="field">CT-e (numero ou chave)
              <input value={filtros.cte} onChange={(e) => atualizar('cte', e.target.value)} placeholder="Ex.: 126068 ou chave de 44 digitos" />
            </label>
            <label className="field">NF (numero ou chave)
              <input value={filtros.nf} onChange={(e) => atualizar('nf', e.target.value)} placeholder="Ex.: 999 ou chave de 44 digitos" />
            </label>
            <label className="field">Transportadora
              <input value={filtros.transportadora} onChange={(e) => atualizar('transportadora', e.target.value)} placeholder="Parte do nome" />
            </label>
            <label className="field">UF origem
              <select value={filtros.ufOrigem} onChange={(e) => atualizar('ufOrigem', e.target.value)}>
                {UFS.map((uf) => <option key={uf} value={uf}>{uf || 'Todas'}</option>)}
              </select>
            </label>
            <label className="field">UF destino
              <select value={filtros.ufDestino} onChange={(e) => atualizar('ufDestino', e.target.value)}>
                {UFS.map((uf) => <option key={uf} value={uf}>{uf || 'Todas'}</option>)}
              </select>
            </label>
          </div>
          <div className="actions-right" style={{ marginTop: 10, gap: 8 }}>
            <button className="btn-primary" type="submit" disabled={ocupado}>{carregando ? 'Consultando...' : 'Pesquisar'}</button>
            <button className="btn-secondary" type="button" onClick={limpar} disabled={ocupado}>Limpar</button>
            <button className="btn-secondary" type="button" onClick={exportar} disabled={ocupado || !resumo?.total}>{exportando ? 'Exportando...' : 'Exportar Excel'}</button>
          </div>
        </form>
      </section>

      {resumo ? (
        <div className="summary-strip lotacao-summary-mini">
          <div className="summary-card"><span>Notas no filtro</span><strong>{formatarNumero(resumo.total)}</strong><small>{formatarData(aplicados?.inicio)} a {formatarData(aplicados?.fim)}</small></div>
          <div className="summary-card"><span>Cancelados</span><strong>{formatarNumero(resumo.cancelados)}</strong><small>{pct(resumo.cancelados, resumo.total)}</small></div>
          <div className="summary-card"><span>Reversa</span><strong>{formatarNumero(resumo.reversa)}</strong><small>{pct(resumo.reversa, resumo.total)}</small></div>
          <div className="summary-card"><span>Entregues</span><strong>{formatarNumero(resumo.entregues)}</strong><small>{pct(resumo.entregues, resumo.total)}</small></div>
          <div className="summary-card"><span>Atrasadas</span><strong>{formatarNumero(resumo.atrasados)}</strong><small>sem entrega e prazo vencido</small></div>
          <div className="summary-card"><span>Valor NF (pagina)</span><strong>{formatarMoeda(somaPagina)}</strong><small>{formatarNumero(linhas.length)} linha(s) exibida(s)</small></div>
        </div>
      ) : null}

      <section className="table-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Tracking</div>
            <p className="compact">Pagina {formatarNumero(pagina + 1)} de {formatarNumero(totalPaginas)}. Cancelados em vermelho; reversa e atrasadas sinalizadas.</p>
          </div>
          <div className="actions-right gap-row">
            <button className="btn-secondary" type="button" onClick={() => irParaPagina(pagina - 1)} disabled={ocupado || pagina <= 0}>Anterior</button>
            <button className="btn-secondary" type="button" onClick={() => irParaPagina(pagina + 1)} disabled={ocupado || pagina + 1 >= totalPaginas}>Proxima</button>
          </div>
        </div>
        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead>
              <tr>
                <th>Data</th>
                <th>NF</th>
                <th>CT-e</th>
                <th>Pedido ERP</th>
                <th>Transportadora</th>
                <th>Canal</th>
                <th>Status</th>
                <th>Origem</th>
                <th>Destino</th>
                <th>Peso</th>
                <th>Valor NF</th>
                <th>Prev. cliente</th>
                <th>Entrega</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((row) => {
                const cancelado = ehCancelado(row);
                const reversa = ehReversa(row);
                const atrasado = ehAtrasado(row);
                return (
                  <tr key={row.id} style={cancelado ? { background: '#fff1f2', color: '#9f1239' } : undefined}>
                    <td>{formatarData(row.data)}</td>
                    <td title={row.chave_nfe || ''}>{row.nota_fiscal || '-'}</td>
                    <td title={row.chave_cte || ''}>{row.cte_numero || '-'}</td>
                    <td>{row.pedido_erp || row.pedido || '-'}</td>
                    <td>{row.transportadora || '-'}</td>
                    <td>
                      {row.canal || '-'}
                      {reversa ? <span className="coverage-badge warn" style={{ marginLeft: 6 }}>REVERSA</span> : null}
                    </td>
                    <td><span className={`coverage-badge ${cancelado ? 'error' : 'ok'}`}>{cancelado ? 'CANCELADO' : (row.status_pedido || '-')}</span></td>
                    <td>{row.cidade_origem || '-'}/{row.uf_origem || '-'}</td>
                    <td>{row.cidade_destino || '-'}/{row.uf_destino || '-'}</td>
                    <td>{formatarNumero(row.peso, 2)}</td>
                    <td>{cancelado ? <s>{formatarMoeda(row.valor_nf)}</s> : formatarMoeda(row.valor_nf)}</td>
                    <td>{formatarData(row.previsao_cliente)}</td>
                    <td>{row.data_entrega ? formatarData(row.data_entrega) : <span className={`coverage-badge ${atrasado ? 'error' : 'warn'}`}>{atrasado ? 'ATRASADA' : 'Em aberto'}</span>}</td>
                  </tr>
                );
              })}
              {!linhas.length && <tr><td colSpan="13">{carregando ? 'Consultando...' : 'Nenhuma nota encontrada para esses filtros.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
