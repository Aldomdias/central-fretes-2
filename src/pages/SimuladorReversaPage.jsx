import { useMemo, useState } from 'react';
import { buscarBaseSimulacaoDb, resolverDestinoIbgeDb } from '../services/freteDatabaseService';
import { pesquisarTrackingSupabase } from '../services/trackingSupabaseService';
import { buildLookupTables, getCidadeByIbge, getUfByIbge, simularSimples } from '../utils/calculoFrete';

const CANAIS = ['', 'REVERSA', 'ATACADO', 'B2C', 'INTERCOMPANY'];

const fmt = (valor) => Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (valor, casas = 2) => Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const num = (valor) => {
  const n = Number(String(valor ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

function labelCidade(cidade, uf) {
  const nome = String(cidade || '').trim();
  const sigla = String(uf || '').trim().toUpperCase();
  if (!nome) return sigla || '';
  return sigla && !nome.toUpperCase().endsWith(`/${sigla}`) ? `${nome}/${sigla}` : nome;
}

// Cubagem confiavel do Tracking: total > (unitaria x volumes). Nunca a unitaria sozinha.
function cubagemTracking(row = {}) {
  const final = Number(row.cubagemFinal || 0);
  if (final > 0) return final;
  const total = Number(row.cubagemTotal || 0);
  if (total > 0) return total;
  const unitaria = Number(row.cubagem || 0);
  const volumes = Number(row.qtdVolumes || 0);
  return unitaria > 0 && volumes > 0 ? unitaria * volumes : 0;
}

function Card({ label, valor, sub, cor = '#1e293b', destaque = false }) {
  return (
    <div className="summary-card" style={{ borderLeft: `4px solid ${cor}`, minWidth: 180 }}>
      <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>{label}</span>
      <strong style={{ display: 'block', fontSize: destaque ? '1.35rem' : '1.15rem', color: cor }}>{valor}</strong>
      {sub && <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{sub}</span>}
    </div>
  );
}

export default function SimuladorReversaPage() {
  // Busca da NF no Tracking
  const [buscaNf, setBuscaNf] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [candidatos, setCandidatos] = useState([]);
  const [nfSelecionada, setNfSelecionada] = useState(null);

  // Parametros da coleta reversa (preenchidos pela NF ou na mao)
  const [coleta, setColeta] = useState('');
  const [cd, setCd] = useState('');
  const [canal, setCanal] = useState('');
  const [peso, setPeso] = useState('');
  const [valorNf, setValorNf] = useState('');
  const [cubagem, setCubagem] = useState('');
  const [ignorarCubagem, setIgnorarCubagem] = useState(false);

  const [status, setStatus] = useState('idle');
  const [progresso, setProgresso] = useState('');
  const [erro, setErro] = useState('');
  const [resultado, setResultado] = useState(null);

  const buscarNoTracking = async () => {
    const termo = String(buscaNf || '').trim();
    if (!termo) return;
    setBuscando(true);
    setErro('');
    try {
      const somenteDigitos = termo.replace(/\D/g, '');
      const filtro = somenteDigitos.length === 44
        ? { chaveNfe: somenteDigitos }
        : { notaFiscal: termo };
      const { rows = [], erro: erroBusca } = await pesquisarTrackingSupabase(filtro, { limit: 30 });
      if (erroBusca) setErro(erroBusca);
      setCandidatos(rows);
      if (!rows.length) setErro('Nao encontramos essa NF no Tracking. Confira o numero ou preencha a rota na mao abaixo.');
    } catch (e) {
      setErro(`${e.message || e}`);
      setCandidatos([]);
    } finally {
      setBuscando(false);
    }
  };

  // A reversa percorre a rota da entrega ao contrario: quem era destino da NF
  // vira o ponto de coleta, e a origem (CD) vira o destino do retorno.
  const usarNf = (row) => {
    setNfSelecionada(row);
    setColeta(row.ibgeDestino || labelCidade(row.cidadeDestino, row.ufDestino));
    setCd(String(row.cidadeOrigem || '').trim());
    setPeso(String(row.pesoDeclarado || row.peso || ''));
    setValorNf(String(row.valorNF || ''));
    setCubagem(String(cubagemTracking(row) || ''));
    setResultado(null);
    setErro('');
  };

  const limparNf = () => {
    setNfSelecionada(null);
    setCandidatos([]);
    setResultado(null);
  };

  const resolverColeta = async (valor) => {
    const texto = String(valor || '').trim();
    if (!texto) return null;
    const digitos = texto.replace(/\D/g, '');
    if (digitos.length === 7) {
      return { ibge: digitos, cidade: getCidadeByIbge(digitos) || '', uf: getUfByIbge(digitos) };
    }
    const remoto = await resolverDestinoIbgeDb(texto);
    return remoto?.ibge ? remoto : null;
  };

  const simular = async () => {
    setErro('');
    setResultado(null);
    setStatus('carregando');
    setProgresso('Identificando a cidade de coleta...');
    try {
      const coletaResolvida = await resolverColeta(coleta);
      if (!coletaResolvida?.ibge) {
        setErro('Nao foi possivel identificar a cidade de coleta. Use cidade, codigo IBGE ou CEP valido.');
        setStatus('erro');
        setProgresso('');
        return;
      }

      setProgresso('Carregando as tabelas cadastradas para essa rota...');
      // As tabelas estao cadastradas no sentido da entrega (CD -> cliente). Para a
      // reversa buscamos exatamente a mesma linha: origem = CD, destino = cidade de coleta.
      let base = await buscarBaseSimulacaoDb({
        origem: cd,
        canal,
        destinoCodigo: coletaResolvida.ibge,
      });
      let cdAplicado = cd;
      if (!base.length && cd) {
        base = await buscarBaseSimulacaoDb({ canal, destinoCodigo: coletaResolvida.ibge });
        cdAplicado = '';
      }

      setProgresso('Calculando o custo da reversa...');
      const lookup = buildLookupTables(base);
      const mapaCidades = new Map(lookup.cidadePorIbge || []);
      if (coletaResolvida.cidade) {
        mapaCidades.set(coletaResolvida.ibge, labelCidade(coletaResolvida.cidade, coletaResolvida.uf));
      }

      const itens = simularSimples({
        transportadoras: base,
        origem: cdAplicado,
        canal,
        peso: num(peso),
        valorNF: num(valorNf),
        cubagem: ignorarCubagem ? 0 : num(cubagem),
        ignorarCubagem,
        destinoCodigo: coletaResolvida.ibge,
        cidadePorIbge: mapaCidades,
        gradeCanal: [],
        // Reversa: o trajeto real e cliente -> CD, entao o ICMS usa as UFs invertidas.
        inverterIcms: true,
      }) || [];

      const statusPorId = new Map(base.map((t) => [String(t.id), t.status || 'Ativa']));
      setResultado({
        coleta: coletaResolvida,
        cdFiltrado: cdAplicado,
        cdIgnorado: Boolean(cd && !cdAplicado),
        itens: itens.map((item) => ({ ...item, statusTransportadora: statusPorId.get(String(item.transportadoraId)) || 'Ativa' })),
      });
      setStatus('concluido');
      setProgresso('');
    } catch (e) {
      console.error('[SimuladorReversa]', e);
      setErro(`${e.message || e}`);
      setStatus('erro');
      setProgresso('');
    }
  };

  const melhor = useMemo(() => resultado?.itens?.[0] || null, [resultado]);
  const podeSimular = Boolean(String(coleta || '').trim()) && num(peso) > 0 && status !== 'carregando';

  return (
    <div className="simulador-shell">
      <div className="simulador-header compact-top">
        <div className="simulador-subtitulo">Central Fretes • Simulação</div>
        <h1>Simulador Reversa</h1>
        <p>
          Quanto custa trazer a mercadoria de volta. As tabelas estão cadastradas no sentido da entrega
          (CD → cliente); aqui a rota é lida ao contrário — a cidade do cliente vira a coleta e o CD vira o destino.
        </p>
      </div>

      {erro && <div className="sim-alert error">{erro}</div>}

      <section className="sim-card">
        <div className="panel-title" style={{ marginBottom: 10 }}>1 · Buscar a NF que foi entregue</div>
        <p style={{ fontSize: '0.84rem', color: '#64748b', marginTop: 0 }}>
          A devolução segue uma nota que já saiu para entrega, então o Tracking tem tudo: rota, peso, cubagem e valor.
        </p>
        <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end' }}>
          <label>Nota fiscal ou chave NFe
            <input
              value={buscaNf}
              onChange={(e) => setBuscaNf(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') buscarNoTracking(); }}
              placeholder="Ex.: 123456 ou chave de 44 dígitos"
            />
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <button className="primary" type="button" onClick={buscarNoTracking} disabled={buscando || !String(buscaNf).trim()}>
              {buscando ? 'Buscando...' : 'Buscar no Tracking'}
            </button>
            {(candidatos.length > 0 || nfSelecionada) && (
              <button className="sim-tab" type="button" onClick={limparNf}>Limpar</button>
            )}
          </div>
        </div>

        {candidatos.length > 0 && (
          <div className="sim-analise-tabela-wrap" style={{ marginTop: 12 }}>
            <table className="sim-analise-tabela">
              <thead>
                <tr>
                  <th>NF</th><th>Data</th><th>Transportadora entrega</th><th>Origem (CD)</th>
                  <th>Destino (cliente)</th><th>Peso</th><th>Cubagem</th><th>Valor NF</th><th></th>
                </tr>
              </thead>
              <tbody>
                {candidatos.map((row) => (
                  <tr key={row.id} style={nfSelecionada?.id === row.id ? { background: '#f5f3ff' } : undefined}>
                    <td>{row.notaFiscal || '-'}</td>
                    <td>{row.data || '-'}</td>
                    <td>{row.transportadora || '-'}</td>
                    <td>{labelCidade(row.cidadeOrigem, row.ufOrigem) || '-'}</td>
                    <td>{labelCidade(row.cidadeDestino, row.ufDestino) || '-'}</td>
                    <td>{fmtNum(row.pesoDeclarado || row.peso, 1)} kg</td>
                    <td>{fmtNum(cubagemTracking(row), 3)} m³</td>
                    <td>{fmt(row.valorNF)}</td>
                    <td>
                      <button className="sim-tab" type="button" onClick={() => usarNf(row)}>
                        {nfSelecionada?.id === row.id ? 'Selecionada' : 'Usar na reversa'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="sim-card" style={{ marginTop: '1rem' }}>
        <div className="panel-title" style={{ marginBottom: 10 }}>2 · Rota da reversa</div>
        {nfSelecionada && (
          <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 8, padding: '10px 16px', marginBottom: 12, fontSize: '0.84rem', color: '#5b21b6' }}>
            NF {nfSelecionada.notaFiscal || nfSelecionada.chaveNfe} · a entrega foi{' '}
            <strong>{labelCidade(nfSelecionada.cidadeOrigem, nfSelecionada.ufOrigem)} → {labelCidade(nfSelecionada.cidadeDestino, nfSelecionada.ufDestino)}</strong>.
            A reversa roda no sentido contrário.
          </div>
        )}
        <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end' }}>
          <label>Coleta (onde a carga está)
            <input value={coleta} onChange={(e) => setColeta(e.target.value)} placeholder="Cidade, IBGE ou CEP" />
          </label>
          <label>Destino do retorno (CD)
            <input value={cd} onChange={(e) => setCd(e.target.value)} placeholder="Ex.: Itajaí (vazio = qualquer CD)" />
          </label>
          <label>Canal
            <select value={canal} onChange={(e) => setCanal(e.target.value)} style={{ width: '100%' }}>
              {CANAIS.map((c) => <option key={c || 'todos'} value={c}>{c || 'Todos (sem filtro)'}</option>)}
            </select>
          </label>
          <label>Peso (kg)
            <input type="number" value={peso} onChange={(e) => setPeso(e.target.value)} min={0} step={0.1} />
          </label>
          <label>Valor da NF
            <input type="number" value={valorNf} onChange={(e) => setValorNf(e.target.value)} min={0} step={0.01} />
          </label>
          <label>Cubagem (m³)
            <input type="number" value={cubagem} onChange={(e) => setCubagem(e.target.value)} min={0} step={0.001} disabled={ignorarCubagem} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 22 }}>
            <input type="checkbox" checked={ignorarCubagem} onChange={(e) => setIgnorarCubagem(e.target.checked)} />
            Ignorar cubagem (só peso)
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <button className="primary" type="button" onClick={simular} disabled={!podeSimular}>
              {status === 'carregando' ? 'Simulando...' : 'Simular reversa'}
            </button>
          </div>
        </div>

        {progresso && (
          <div style={{ marginTop: 12, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 14px', fontSize: '0.85rem', color: '#1d4ed8' }}>
            {progresso}
          </div>
        )}
      </section>

      {resultado && (
        <section className="sim-card" style={{ marginTop: '1rem' }}>
          <div className="panel-title" style={{ marginBottom: 10 }}>
            3 · Custo da reversa — {labelCidade(resultado.coleta.cidade, resultado.coleta.uf) || resultado.coleta.ibge}
            {resultado.cdFiltrado ? ` → ${resultado.cdFiltrado}` : ' → qualquer CD com tabela'}
          </div>

          {resultado.cdIgnorado && (
            <div style={{ background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 16px', marginBottom: 12, fontSize: '0.84rem', color: '#854d0e' }}>
              Nenhuma tabela encontrada com o CD informado. O resultado abaixo considera todos os CDs que atendem essa cidade.
            </div>
          )}

          {!resultado.itens.length ? (
            <p style={{ color: '#64748b' }}>
              Nenhuma tabela cadastrada atende essa cidade no canal escolhido. Tente sem filtro de canal ou sem informar o CD.
            </p>
          ) : (
            <>
              <div className="summary-strip" style={{ flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
                <Card label="Mais barata" valor={fmt(melhor.total)} sub={melhor.transportadora} cor="#04C7A4" destaque />
                <Card label="Prazo" valor={`${melhor.prazo || '-'} dias`} sub="prazo de tabela" cor="#1e293b" />
                <Card label="% sobre a NF" valor={`${fmtNum(melhor.percentualSobreNF)}%`} cor="#9153F0" />
                <Card label="Opções encontradas" valor={resultado.itens.length} sub="transportadoras com tabela" cor="#1e293b" />
              </div>

              <div className="sim-analise-tabela-wrap">
                <table className="sim-analise-tabela">
                  <thead>
                    <tr>
                      <th>#</th><th>Transportadora</th><th>CD de retorno</th><th>Rota da tabela</th>
                      <th>Prazo</th><th>Peso considerado</th><th>Frete base</th><th>Taxas</th>
                      <th>ICMS</th><th>Total reversa</th><th>% NF</th><th>vs. melhor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.itens.map((item, idx) => (
                      <tr key={`${item.transportadoraId}-${item.origemId}-${idx}`}>
                        <td>{idx + 1}</td>
                        <td>
                          <strong>{item.transportadora}</strong>
                          {String(item.statusTransportadora).toUpperCase().startsWith('INATIV') && (
                            <span style={{ marginLeft: 6, fontSize: '0.68rem', background: '#fef3c7', color: '#92400e', borderRadius: 4, padding: '1px 6px', fontWeight: 700 }}>INATIVA</span>
                          )}
                        </td>
                        <td>{item.origem}</td>
                        <td>{item.detalhes?.frete?.rotaNome || '-'}</td>
                        <td>{item.prazo || '-'} d</td>
                        <td>{fmtNum(item.detalhes?.frete?.pesoConsiderado, 1)} kg</td>
                        <td>{fmt(item.valorBase)}</td>
                        <td>{fmt(item.detalhes?.taxas?.totalTaxas)}</td>
                        <td>{fmtNum(item.detalhes?.frete?.aliquotaIcms, 0)}% ({item.detalhes?.frete?.ufOrigem || '?'}→{item.detalhes?.frete?.ufDestino || '?'})</td>
                        <td style={{ fontWeight: 700 }}>{fmt(item.total)}</td>
                        <td>{fmtNum(item.percentualSobreNF)}%</td>
                        <td>{idx === 0 ? '—' : `+${fmt(item.total - melhor.total)}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: 10 }}>
                O ICMS é calculado no sentido real da reversa (coleta → CD), não no sentido em que a tabela foi cadastrada.
                Valores de tabela: disponibilidade de coleta e SLA de retorno são avaliação da operação.
              </p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
