import { useEffect, useMemo, useState } from 'react';
import { buscarBaseSimulacaoDb, carregarOpcoesSimuladorDb, resolverDestinoIbgeDb } from '../services/freteDatabaseService';
import { pesquisarTrackingPorPedidoAmpliado, pesquisarTrackingSupabase } from '../services/trackingSupabaseService';
import { carregarTransportadorasReversa, salvarTransportadorasReversa } from '../services/transportadorasReversaService';
import { buildLookupTables, getCidadeByIbge, getUfByIbge, simularSimples } from '../utils/calculoFrete';
import { criarSetTransportadorasReversa, elegivelParaReversa, fazReversa, normalizarNomeReversa } from '../utils/transportadorasReversa';

const CANAIS = ['', 'REVERSA', 'ATACADO', 'B2C', 'INTERCOMPANY'];

const fmt = (valor) => Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (valor, casas = 2) => Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const num = (valor) => {
  const n = Number(String(valor ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

function separarReferenciasBusca(valor = '') {
  return [...new Set(
    String(valor || '')
      .split(/[\n,;\/]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  )].slice(0, 30);
}

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

  // Quem faz reversa
  const [marcadas, setMarcadas] = useState([]);
  const [nomesTransportadoras, setNomesTransportadoras] = useState([]);
  const [mostrarConfig, setMostrarConfig] = useState(false);
  const [salvandoConfig, setSalvandoConfig] = useState(false);
  const [buscaTransportadora, setBuscaTransportadora] = useState('');
  const [avisoConfig, setAvisoConfig] = useState('');

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [lista, opcoes] = await Promise.all([
          carregarTransportadorasReversa(),
          carregarOpcoesSimuladorDb().catch(() => ({ transportadoras: [] })),
        ]);
        if (!vivo) return;
        setMarcadas(lista.map((item) => item.transportadora));
        setNomesTransportadoras(opcoes?.transportadoras || []);
      } catch (e) {
        console.warn('[SimuladorReversa] nao consegui carregar a marcacao de reversa', e);
      }
    })();
    return () => { vivo = false; };
  }, []);

  const setReversa = useMemo(
    () => criarSetTransportadorasReversa(marcadas.map((nome) => ({ transportadora: nome }))),
    [marcadas],
  );

  const alternarMarcada = (nome) => {
    setMarcadas((atual) => (
      atual.some((item) => normalizarNomeReversa(item) === normalizarNomeReversa(nome))
        ? atual.filter((item) => normalizarNomeReversa(item) !== normalizarNomeReversa(nome))
        : [...atual, nome]
    ));
  };

  const salvarConfig = async () => {
    setSalvandoConfig(true);
    setErro('');
    setAvisoConfig('');
    try {
      const { modo, motivo } = await salvarTransportadorasReversa(marcadas.map((nome) => ({ transportadora: nome })));
      setAvisoConfig(modo === 'local'
        ? `Marcação salva só neste navegador. ${motivo || 'Supabase indisponível.'}`
        : 'Marcação salva no Supabase — vale para todos os usuários.');
    } catch (e) {
      setErro(`${e.message || e}`);
    } finally {
      setSalvandoConfig(false);
    }
  };

  const buscarNoTracking = async () => {
    const termos = separarReferenciasBusca(buscaNf);
    if (!termos.length) return;
    setBuscando(true);
    setErro('');
    try {
      const resultadosPorTermo = await Promise.all(termos.map(async (termo) => {
        const somenteDigitos = termo.replace(/\D/g, '');
        if (somenteDigitos.length === 44) {
          return pesquisarTrackingSupabase({ chaveNfe: somenteDigitos }, { limit: 30 });
        }
        const resultados = await Promise.all([
          pesquisarTrackingSupabase({ notaFiscal: termo }, { limit: 30 }),
          pesquisarTrackingPorPedidoAmpliado(termo, { limit: 30 }),
        ]);
        return {
          rows: resultados.flatMap((resultado) => resultado.rows || []),
          erro: resultados.find((resultado) => resultado.erro)?.erro || '',
        };
      }));
      const porId = new Map();
      resultadosPorTermo.flatMap((resultado) => resultado.rows || []).forEach((row) => porId.set(String(row.id), row));
      const rows = [...porId.values()].slice(0, 200);
      const erroBusca = resultadosPorTermo.find((resultado) => resultado.erro)?.erro;
      if (erroBusca) setErro(erroBusca);
      setCandidatos(rows);
      if (!rows.length) setErro('Não encontramos as NFs, chaves NFe ou pedidos informados no Tracking. Confira os números ou preencha a rota manualmente abaixo.');
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
    // resolverDestinoIbgeDb ja cobre IBGE, CEP e nome de cidade, e devolve o nome
    // do municipio junto — por isso nao resolvemos o IBGE de 7 digitos aqui.
    const remoto = await resolverDestinoIbgeDb(texto);
    if (remoto?.ibge) {
      return {
        ...remoto,
        cidade: remoto.cidade || getCidadeByIbge(remoto.ibge) || '',
        uf: remoto.uf || getUfByIbge(remoto.ibge) || '',
      };
    }
    const digitos = texto.replace(/\D/g, '');
    if (digitos.length === 7) {
      return { ibge: digitos, cidade: getCidadeByIbge(digitos) || '', uf: getUfByIbge(digitos) };
    }
    return null;
  };

  // As tabelas de reversa raramente estao cadastradas no canal REVERSA — em geral
  // a rota existe no canal da entrega. Em vez de devolver "nada encontrado", vamos
  // afrouxando os filtros na ordem e avisamos qual deles foi solto.
  const tentativasBusca = () => {
    const lista = [{ origem: cd, canal, aviso: '' }];
    if (cd && canal) lista.push({ origem: cd, canal: '', aviso: `Nenhuma tabela no canal ${canal} para esse CD — resultado sem filtro de canal.` });
    if (cd) lista.push({ origem: '', canal, aviso: `Nenhuma tabela com o CD "${cd}" — resultado considera todos os CDs que atendem essa cidade.` });
    if (cd && canal) lista.push({ origem: '', canal: '', aviso: `Nenhuma tabela com o CD "${cd}" no canal ${canal} — resultado sem filtro de CD nem de canal.` });
    if (!cd && canal) lista.push({ origem: '', canal: '', aviso: `Nenhuma tabela no canal ${canal} — resultado sem filtro de canal.` });
    return lista.filter((item, idx, todos) => (
      todos.findIndex((outro) => outro.origem === item.origem && outro.canal === item.canal) === idx
    ));
  };

  const simular = async () => {
    setErro('');
    setResultado(null);
    setStatus('carregando');
    setProgresso('Identificando a cidade de coleta...');
    try {
      const transportadoraIda = String(nfSelecionada?.transportadora || '').trim();
      const coletaResolvida = await resolverColeta(coleta);
      if (!coletaResolvida?.ibge) {
        setErro('Nao foi possivel identificar a cidade de coleta. Use cidade, codigo IBGE ou CEP valido.');
        setStatus('erro');
        setProgresso('');
        return;
      }

      // As tabelas estao cadastradas no sentido da entrega (CD -> cliente). Para a
      // reversa buscamos exatamente a mesma linha: origem = CD, destino = cidade de coleta.
      let vencedora = null;
      for (const tentativa of tentativasBusca()) {
        setProgresso(tentativa.aviso
          ? 'Nada com esses filtros — tentando com o filtro mais aberto...'
          : 'Carregando as tabelas cadastradas para essa rota...');

        const base = await buscarBaseSimulacaoDb({
          origem: tentativa.origem,
          canal: tentativa.canal,
          destinoCodigo: coletaResolvida.ibge,
          // Na reversa, transportadoras/origens inativas continuam sendo opções
          // operacionais válidas para coleta e devem participar do cálculo.
          incluirOrigensInativas: true,
        });
        if (!base.length) continue;

        const lookup = buildLookupTables(base);
        const mapaCidades = new Map(lookup.cidadePorIbge || []);
        if (coletaResolvida.cidade) {
          mapaCidades.set(coletaResolvida.ibge, labelCidade(coletaResolvida.cidade, coletaResolvida.uf));
        }

        const itens = simularSimples({
          transportadoras: base,
          origem: tentativa.origem,
          canal: tentativa.canal,
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
        const comStatus = itens.map((item) => ({
          ...item,
          statusTransportadora: statusPorId.get(String(item.transportadoraId)) || 'Ativa',
        }));
        // So conta como tentativa boa se sobrou alguem que realmente faz reversa —
        // senao afrouxa mais um filtro em vez de parar num ranking que sera zerado.
        const doReverso = comStatus.filter((item) => elegivelParaReversa(item.transportadora, transportadoraIda, setReversa));
        if (!doReverso.length) continue;

        vencedora = {
          aviso: tentativa.aviso,
          cdFiltrado: tentativa.origem,
          canalFiltrado: tentativa.canal,
          itens: doReverso,
          excluidas: comStatus
            .filter((item) => !fazReversa(item.transportadora, setReversa))
            .map((item) => item.transportadora),
          restritasPorTransportadoraIda: comStatus
            .filter((item) => fazReversa(item.transportadora, setReversa))
            .filter((item) => !elegivelParaReversa(item.transportadora, transportadoraIda, setReversa))
            .map((item) => item.transportadora),
        };
        break;
      }

      const nomesEncontrados = new Set((vencedora?.itens || []).map((item) => normalizarNomeReversa(item.transportadora)));
      setResultado({
        coleta: coletaResolvida,
        aviso: vencedora?.aviso || '',
        cdFiltrado: vencedora?.cdFiltrado || '',
        canalFiltrado: vencedora?.canalFiltrado || '',
        itens: vencedora?.itens || [],
        filtroReversaAtivo: setReversa.size > 0,
        excluidas: Array.from(new Set(vencedora?.excluidas || [])),
        restritasPorTransportadoraIda: Array.from(new Set(vencedora?.restritasPorTransportadoraIda || [])),
        transportadoraIda: String(nfSelecionada?.transportadora || '').trim(),
        // Marcadas que fazem reversa mas nao apareceram: nao tem tabela pra essa
        // rota (ou a origem delas esta inativa no cadastro).
        marcadasSemTabela: marcadas.filter((nome) => !nomesEncontrados.has(normalizarNomeReversa(nome))),
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
          <label style={{ gridColumn: 'span 3' }}>NF, chave NFe ou pedido (até 30 referências)
            <textarea
              value={buscaNf}
              onChange={(e) => setBuscaNf(e.target.value)}
              placeholder={'Cole uma referência por linha\nOu separe por vírgula, ponto e vírgula ou /'}
              rows={3}
              style={{ width: '100%', resize: 'vertical' }}
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
                  <th>NF</th><th>Pedido</th><th>Data</th><th>Transportadora entrega</th><th>Origem (CD)</th>
                  <th>Destino (cliente)</th><th>Peso</th><th>Cubagem</th><th>Valor NF</th><th></th>
                </tr>
              </thead>
              <tbody>
                {candidatos.map((row) => (
                  <tr key={row.id} style={nfSelecionada?.id === row.id ? { background: '#f5f3ff' } : undefined}>
                    <td>{row.notaFiscal || '-'}</td>
                    <td>{row.pedidoMarketplace || row.pedidoLojista || row.pedido || row.pedidoErp || '-'}</td>
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
            {' '}Transportadora da ida: <strong>{nfSelecionada.transportadora || 'não identificada'}</strong>. A reversa roda no sentido contrário.
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

      <section className="sim-card" style={{ marginTop: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div className="panel-title" style={{ margin: 0 }}>
            Quem faz reversa
            <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: '0.8rem' }}>
              {' '}· {marcadas.length ? `${marcadas.length} marcada(s)` : 'nenhuma marcada — o ranking mostra todas'}
            </span>
          </div>
          <button className="sim-tab" type="button" onClick={() => setMostrarConfig((v) => !v)}>
            {mostrarConfig ? 'Fechar' : 'Marcar transportadoras'}
          </button>
        </div>

        {mostrarConfig && (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: '0.84rem', color: '#64748b', marginTop: 0 }}>
              Ter tabela para a rota não quer dizer que a transportadora faz coleta reversa. Marque só quem faz —
              as outras somem do ranking mesmo tendo tabela. Com exceção da Recoli, cada marcada só será simulada
              quando ela própria tiver feito a ida. Transportadoras inativas aparecem aqui de propósito.
            </p>
            <input
              value={buscaTransportadora}
              onChange={(e) => setBuscaTransportadora(e.target.value)}
              placeholder="Filtrar transportadora..."
              style={{ maxWidth: 320, marginBottom: 10 }}
            />
            <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 4 }}>
              {nomesTransportadoras
                .filter((nome) => !buscaTransportadora.trim()
                  || normalizarNomeReversa(nome).includes(normalizarNomeReversa(buscaTransportadora)))
                .map((nome) => {
                  const marcada = marcadas.some((item) => normalizarNomeReversa(item) === normalizarNomeReversa(nome));
                  return (
                    <label key={nome} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.84rem', cursor: 'pointer', padding: '2px 0' }}>
                      <input type="checkbox" checked={marcada} onChange={() => alternarMarcada(nome)} />
                      {nome}
                    </label>
                  );
                })}
              {!nomesTransportadoras.length && (
                <span style={{ fontSize: '0.84rem', color: '#94a3b8' }}>Carregando transportadoras...</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
              <button className="primary" type="button" onClick={salvarConfig} disabled={salvandoConfig}>
                {salvandoConfig ? 'Salvando...' : 'Salvar marcação'}
              </button>
              <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                Depois de salvar, rode a simulação de novo pra aplicar o filtro.
              </span>
            </div>

            {avisoConfig && (
              <div style={{
                marginTop: 10,
                background: avisoConfig.startsWith('Marcação salva no Supabase') ? '#ecfdf5' : '#fef9c3',
                border: `1px solid ${avisoConfig.startsWith('Marcação salva no Supabase') ? '#a7f3d0' : '#fde68a'}`,
                borderRadius: 8,
                padding: '10px 16px',
                fontSize: '0.84rem',
                color: avisoConfig.startsWith('Marcação salva no Supabase') ? '#065f46' : '#854d0e',
              }}>
                {avisoConfig}
              </div>
            )}
          </div>
        )}
      </section>

      {resultado && (
        <section className="sim-card" style={{ marginTop: '1rem' }}>
          <div className="panel-title" style={{ marginBottom: 10 }}>
            3 · Custo da reversa — {labelCidade(resultado.coleta.cidade, resultado.coleta.uf) || resultado.coleta.ibge}
            {resultado.cdFiltrado ? ` → ${resultado.cdFiltrado}` : ' → qualquer CD com tabela'}
            {resultado.itens.length > 0 && (
              <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: '0.8rem' }}>
                {' '}· canal {resultado.canalFiltrado || 'todos'}
              </span>
            )}
          </div>

          {resultado.aviso && (
            <div style={{ background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 16px', marginBottom: 12, fontSize: '0.84rem', color: '#854d0e' }}>
              {resultado.aviso}
            </div>
          )}

          {!resultado.itens.length ? (
            <p style={{ color: '#64748b' }}>
              Nenhuma tabela cadastrada atende essa cidade — nem com o CD e o canal liberados. Verifique se a rota
              existe no cadastro da transportadora que faz a reversa.
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

              {!resultado.filtroReversaAtivo && (
                <p style={{ fontSize: '0.8rem', color: '#854d0e', marginTop: 10 }}>
                  Nenhuma transportadora marcada como "faz reversa" — o ranking está mostrando todas que têm tabela.
                  Marque quem faz em <strong>Quem faz reversa</strong>, acima.
                </p>
              )}

              {resultado.excluidas.length > 0 && (
                <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: 10 }}>
                  Fora do ranking por não fazerem reversa: {resultado.excluidas.join(', ')}.
                </p>
              )}

              {resultado.restritasPorTransportadoraIda.length > 0 && (
                <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: 4 }}>
                  Fora desta simulação porque não fizeram a ida: {resultado.restritasPorTransportadoraIda.join(', ')}.
                  A Recoli é a única marcada que pode simular qualquer entrega.
                </p>
              )}

              {resultado.marcadasSemTabela.length > 0 && (
                <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: 4 }}>
                  Marcadas que não apareceram: {resultado.marcadasSemTabela.join(', ')} — sem tabela cadastrada para
                  essa rota, ou com a <strong>origem</strong> inativa no cadastro (o status da transportadora não
                  esconde ninguém aqui).
                </p>
              )}

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
