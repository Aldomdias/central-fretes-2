import { useEffect, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const UF_OPTIONS = ['','AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];
const TABELA = 'realizado_local_ctes';

function fmt(v) { return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }
function fmtN(v) { return Number(v||0).toLocaleString('pt-BR'); }
function fmtDate(v) {
  if (!v) return '-';
  const s = String(v).slice(0,10);
  const [y,m,d] = s.split('-');
  return (d&&m&&y) ? `${d}/${m}/${y}` : s;
}

// Lê campos que podem ter nomes diferentes dependendo da versão da tabela
function campo(row, ...chaves) {
  for (const k of chaves) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== '') return row[k];
  }
  return '';
}

function SummaryCard({title,value,subtitle}) {
  return <div className="summary-card"><span>{title}</span><strong>{value}</strong><span>{subtitle}</span></div>;
}

async function buscarCtes(filtros={}) {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado. Verifique o .env.');
  const supabase = getSupabaseClient();
  const limit = Math.min(Number(filtros.limit)||200, 15000);

  // Usa select * para não depender de nomes de colunas fixos
  let query = supabase.from(TABELA).select('*').limit(limit);

  // Ordena por data — tenta os dois nomes possíveis
  try { query = query.order('data_emissao', {ascending:false}); } catch(e) {}

  if (filtros.ufOrigem) query = query.eq('uf_origem', filtros.ufOrigem);
  if (filtros.ufDestino) query = query.eq('uf_destino', filtros.ufDestino);
  if (filtros.canal) query = query.eq('canal', filtros.canal);
  if (filtros.transportadoraRealizada) query = query.ilike('transportadora', `%${filtros.transportadoraRealizada}%`);
  if (filtros.origem) query = query.ilike('cidade_origem', `${filtros.origem}%`);
  if (filtros.destino) query = query.ilike('cidade_destino', `${filtros.destino}%`);
  if (filtros.inicio) query = query.gte('data_emissao', filtros.inicio);
  if (filtros.fim) query = query.lte('data_emissao', filtros.fim);

  const {data, error} = await query;
  if (error) throw new Error(`Erro Supabase (${TABELA}): ${error.message}`);
  return data || [];
}

export default function CtePage() {
  const [filtros, setFiltros] = useState({
    transportadoraRealizada:'',origem:'',destino:'',
    ufOrigem:'',ufDestino:'',inicio:'',fim:'',canal:'',limit:500,
  });
  const [rows, setRows] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [colunas, setColunas] = useState([]);

  const set = (campo,valor) => setFiltros(prev=>({...prev,[campo]:valor}));

  const buscar = async (override) => {
    const f = override || filtros;
    setCarregando(true);
    setErro('');
    try {
      const data = await buscarCtes(f);
      setRows(data);
      if (data.length > 0) setColunas(Object.keys(data[0]));
    } catch(error) {
      setErro(error.message);
      setRows(null);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(()=>{ buscar({limit:200}); },[]);

  const totalCte = (rows||[]).reduce((a,r)=>a+(Number(campo(r,'valor_cte','valorCte'))||0),0);
  const nTransp = new Set((rows||[]).map(r=>campo(r,'transportadora')).filter(Boolean)).size;
  const nOrigem = new Set((rows||[]).map(r=>campo(r,'cidade_origem','cidadeOrigem','uf_origem','ufOrigem')).filter(Boolean)).size;

  return (
    <div className="page-shell">
      <div className="page-top between">
        <div className="page-header">
          <h1>CT-e</h1>
          <p>Base online · Supabase ({TABELA})</p>
        </div>
      </div>

      <div className="panel-card">
        <div className="panel-title">Filtros</div>
        <div className="form-grid" style={{gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:10}}>
          <div className="field"><label>Transportadora</label><input value={filtros.transportadoraRealizada} onChange={e=>set('transportadoraRealizada',e.target.value)} placeholder="Nome parcial"/></div>
          <div className="field"><label>Origem (cidade)</label><input value={filtros.origem} onChange={e=>set('origem',e.target.value)} placeholder="Ex.: Itajaí"/></div>
          <div className="field"><label>Destino (cidade)</label><input value={filtros.destino} onChange={e=>set('destino',e.target.value)} placeholder="Ex.: São Paulo"/></div>
          <div className="field"><label>Canal</label>
            <select value={filtros.canal} onChange={e=>set('canal',e.target.value)}>
              <option value="">Todos</option><option value="ATACADO">ATACADO</option><option value="B2C">B2C</option>
            </select>
          </div>
          <div className="field"><label>UF Origem</label>
            <select value={filtros.ufOrigem} onChange={e=>set('ufOrigem',e.target.value)}>
              {UF_OPTIONS.map(uf=><option key={uf} value={uf}>{uf||'Todas'}</option>)}
            </select>
          </div>
          <div className="field"><label>UF Destino</label>
            <select value={filtros.ufDestino} onChange={e=>set('ufDestino',e.target.value)}>
              {UF_OPTIONS.map(uf=><option key={uf} value={uf}>{uf||'Todas'}</option>)}
            </select>
          </div>
          <div className="field"><label>Emissão início</label><input type="date" value={filtros.inicio} onChange={e=>set('inicio',e.target.value)}/></div>
          <div className="field"><label>Emissão fim</label><input type="date" value={filtros.fim} onChange={e=>set('fim',e.target.value)}/></div>
        </div>
        <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
          <button className="btn-primary" onClick={()=>buscar()} disabled={carregando}>
            {carregando?'Buscando...':'Buscar CT-es'}
          </button>
          <label style={{display:'flex',alignItems:'center',gap:8,fontSize:13}}>Limite:
            <select value={filtros.limit} onChange={e=>set('limit',Number(e.target.value))} style={{width:90}}>
              <option value={200}>200</option><option value={500}>500</option>
              <option value={1000}>1.000</option><option value={5000}>5.000</option><option value={15000}>15.000</option>
            </select>
          </label>
        </div>
        {erro && <div style={{padding:'10px 14px',background:'#fff1f1',border:'1px solid #efc4c4',borderRadius:10,color:'#9b2323',fontSize:13}}>{erro}</div>}
      </div>

      {carregando && !rows && <div className="panel-card" style={{textAlign:'center',color:'var(--muted)',padding:20}}>Buscando no Supabase...</div>}

      {rows && <>
        <div className="summary-strip">
          <SummaryCard title="CT-es exibidos" value={fmtN(rows.length)} subtitle="registros carregados"/>
          <SummaryCard title="Valor total CT-e" value={fmt(totalCte)} subtitle="soma dos exibidos"/>
          <SummaryCard title="Transportadoras" value={fmtN(nTransp)} subtitle="distintas"/>
          <SummaryCard title="Origens" value={fmtN(nOrigem)} subtitle="cidades/UFs"/>
        </div>

        <div className="table-card">
          <div style={{marginBottom:8}}><span className="list-title">{fmtN(rows.length)} CT-e{rows.length!==1?'s':''}</span></div>
          <div style={{overflowX:'auto'}}>
            <table>
              <thead>
                <tr>
                  <th>Data</th><th>Competência</th><th>Transportadora</th><th>Origem</th><th>Destino</th>
                  <th>Nº CT-e</th><th>Valor CT-e</th><th>Valor NF</th><th>Canal</th><th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {rows.length===0 && (
                  <tr><td colSpan={10} style={{textAlign:'center',color:'var(--muted)',padding:20}}>
                    Nenhum CT-e encontrado. Ajuste os filtros ou aumente o limite.
                  </td></tr>
                )}
                {rows.map((row,idx)=>{
                  const dataEmissao = campo(row,'data_emissao','emissao','dataEmissao');
                  const transp = campo(row,'transportadora');
                  const cidOrig = campo(row,'cidade_origem','cidadeOrigem');
                  const ufOrig = campo(row,'uf_origem','ufOrigem');
                  const cidDest = campo(row,'cidade_destino','cidadeDestino');
                  const ufDest = campo(row,'uf_destino','ufDestino');
                  const nroCte = campo(row,'numero_cte','numeroCte');
                  const valCte = Number(campo(row,'valor_cte','valorCte')||0);
                  const valNf = Number(campo(row,'valor_nf','valorNF')||0);
                  const canal = campo(row,'canal');
                  const situacao = campo(row,'situacao','status');
                  const competencia = campo(row,'competencia');
                  return (
                    <tr key={row.id||idx}>
                      <td>{fmtDate(dataEmissao)}</td>
                      <td>{competencia||'-'}</td>
                      <td>{transp||'-'}</td>
                      <td>{cidOrig?`${cidOrig}${ufOrig?`/${ufOrig}`:''}`:ufOrig||'-'}</td>
                      <td>{cidDest?`${cidDest}${ufDest?`/${ufDest}`:''}`:ufDest||'-'}</td>
                      <td>{nroCte||'-'}</td>
                      <td>{fmt(valCte)}</td>
                      <td>{fmt(valNf)}</td>
                      <td>{canal||'-'}</td>
                      <td><span className={`coverage-badge ${situacao==='Autorizado'?'ok':'warn'}`}>{situacao||'-'}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </>}
    </div>
  );
}
