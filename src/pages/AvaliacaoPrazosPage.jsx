import { useEffect, useMemo, useState } from 'react';
import {
  REGIOES_BRASIL,
  UFS_BRASIL,
  carregarAvaliacaoPrazosCobertura,
  consolidarRotas,
  consolidarUfDestino,
  filtrarLinhasAvaliacao,
} from '../services/avaliacaoPrazosService';

const FILTROS_INICIAIS = {
  busca: '',
  canal: '',
  tipoTabela: '',
  status: '',
  transportadora: '',
  ufOrigem: '',
  ufDestino: '',
  regiaoOrigem: '',
  regiaoDestino: '',
  modalidade: '',
  comPrazo: '',
};

function moeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function numero(valor, casas = 0) {
  return Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function uniq(linhas, campo) {
  return [...new Set(linhas.map((linha) => linha[campo]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

function estiloCardMapa(qtdTransportadoras) {
  if (qtdTransportadoras >= 4) return { background: '#e8f7ee', borderColor: '#86d19d', color: '#166534' };
  if (qtdTransportadoras >= 2) return { background: '#fff7e6', borderColor: '#f2c15f', color: '#92400e' };
  if (qtdTransportadoras === 1) return { background: '#fff1f2', borderColor: '#f4a5ad', color: '#9f1239' };
  return { background: '#f1f5f9', borderColor: '#cbd5e1', color: '#475569' };
}

function SelectFiltro({ label, value, onChange, options, placeholder = 'Todos' }) {
  return (
    <label style={styles.campoFiltro}>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} style={styles.input}>
        <option value="">{placeholder}</option>
        {options.map((opcao) => <option key={opcao} value={opcao}>{opcao}</option>)}
      </select>
    </label>
  );
}

function CardIndicador({ titulo, valor, detalhe }) {
  return (
    <div style={styles.cardIndicador}>
      <div style={styles.cardTitulo}>{titulo}</div>
      <div style={styles.cardValor}>{valor}</div>
      {detalhe && <div style={styles.cardDetalhe}>{detalhe}</div>}
    </div>
  );
}

function exportarCsv(linhas) {
  const colunas = [
    ['canal', 'Canal'],
    ['transportadora', 'Transportadora'],
    ['cidadeOrigem', 'Origem'],
    ['ufOrigem', 'UF Origem'],
    ['regiaoOrigem', 'Região Origem'],
    ['cidadeDestino', 'Destino'],
    ['ufDestino', 'UF Destino'],
    ['regiaoDestino', 'Região Destino'],
    ['prazoLabel', 'Prazo'],
    ['modalidade', 'Modalidade'],
    ['tipoTabela', 'Tipo Tabela'],
    ['status', 'Status'],
    ['tabelaNome', 'Tabela/Negociação'],
    ['valorReferencia', 'Valor Referência'],
    ['observacao', 'Observação'],
  ];

  const escapar = (valor) => `"${String(valor ?? '').replace(/"/g, '""')}"`;
  const conteudo = [
    colunas.map(([, label]) => escapar(label)).join(';'),
    ...linhas.map((linha) => colunas.map(([campo]) => escapar(campo === 'valorReferencia' ? moeda(linha[campo]) : linha[campo])).join(';')),
  ].join('\n');

  const blob = new Blob([`\ufeff${conteudo}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `avaliacao-prazos-cobertura-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function AvaliacaoPrazosPage() {
  const [base, setBase] = useState({ linhas: [], tabelas: [], carregadoEm: null });
  const [filtros, setFiltros] = useState(FILTROS_INICIAIS);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [aba, setAba] = useState('dashboard');

  const carregar = async () => {
    setCarregando(true);
    setErro('');
    try {
      const dados = await carregarAvaliacaoPrazosCobertura();
      setBase(dados);
    } catch (error) {
      setErro(error.message || 'Erro ao carregar avaliação de prazos.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const linhasFiltradas = useMemo(() => filtrarLinhasAvaliacao(base.linhas, filtros), [base.linhas, filtros]);
  const rotas = useMemo(() => consolidarRotas(linhasFiltradas), [linhasFiltradas]);
  const mapaUf = useMemo(() => consolidarUfDestino(linhasFiltradas), [linhasFiltradas]);

  const opcoes = useMemo(() => ({
    canais: uniq(base.linhas, 'canal'),
    tiposTabela: uniq(base.linhas, 'tipoTabela'),
    status: uniq(base.linhas, 'status'),
    transportadoras: uniq(base.linhas, 'transportadora'),
    modalidades: uniq(base.linhas, 'modalidade'),
    ufsOrigem: UFS_BRASIL.filter((uf) => base.linhas.some((linha) => linha.ufOrigem === uf)),
    ufsDestino: UFS_BRASIL,
    regioes: Object.keys(REGIOES_BRASIL),
  }), [base.linhas]);

  const indicadores = useMemo(() => {
    const transportadoras = new Set(linhasFiltradas.map((linha) => linha.transportadora).filter(Boolean));
    const prazos = linhasFiltradas.map((linha) => linha.prazo).filter((valor) => valor > 0);
    const rotasBaixaCobertura = rotas.filter((rota) => rota.qtdTransportadoras <= 1).length;
    const ufsSemCobertura = mapaUf.filter((uf) => uf.qtdTransportadoras === 0).length;
    return {
      rotas: rotas.length,
      registros: linhasFiltradas.length,
      transportadoras: transportadoras.size,
      menorPrazo: prazos.length ? Math.min(...prazos) : 0,
      prazoMedio: prazos.length ? prazos.reduce((soma, valor) => soma + valor, 0) / prazos.length : 0,
      rotasBaixaCobertura,
      ufsSemCobertura,
    };
  }, [linhasFiltradas, rotas, mapaUf]);

  const atualizarFiltro = (campo, valor) => {
    setFiltros((atual) => ({ ...atual, [campo]: valor }));
  };

  const rotasCriticas = rotas.filter((rota) => rota.qtdTransportadoras <= 1).slice(0, 10);
  const melhoresPrazos = rotas.filter((rota) => rota.menorPrazo > 0).sort((a, b) => a.menorPrazo - b.menorPrazo || b.qtdTransportadoras - a.qtdTransportadoras).slice(0, 10);
  const linhasTabela = linhasFiltradas.slice(0, 300);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <div style={styles.kicker}>4.36 · Transportadoras / Tabelas</div>
          <h1 style={styles.titulo}>Avaliação de Prazos e Cobertura</h1>
          <p style={styles.subtitulo}>
            Analise quais transportadoras existem em tabela por origem x destino, prazo de entrega, cobertura por UF/região e rotas com poucas opções.
          </p>
        </div>
        <div style={styles.acoesTopo}>
          <button type="button" onClick={carregar} disabled={carregando} style={styles.botaoSecundario}>
            {carregando ? 'Carregando...' : 'Atualizar base'}
          </button>
          <button type="button" onClick={() => exportarCsv(linhasFiltradas)} disabled={!linhasFiltradas.length} style={styles.botaoPrimario}>
            Exportar CSV
          </button>
        </div>
      </div>

      {erro && <div style={styles.alertaErro}>{erro}</div>}

      <section style={styles.filtrosBox}>
        <label style={{ ...styles.campoFiltro, gridColumn: 'span 2' }}>
          <span>Busca geral</span>
          <input
            value={filtros.busca}
            onChange={(event) => atualizarFiltro('busca', event.target.value)}
            placeholder="Transportadora, cidade, UF, tabela, observação..."
            style={styles.input}
          />
        </label>
        <SelectFiltro label="Canal" value={filtros.canal} onChange={(v) => atualizarFiltro('canal', v)} options={opcoes.canais} />
        <SelectFiltro label="Transportadora" value={filtros.transportadora} onChange={(v) => atualizarFiltro('transportadora', v)} options={opcoes.transportadoras} />
        <SelectFiltro label="Região origem" value={filtros.regiaoOrigem} onChange={(v) => atualizarFiltro('regiaoOrigem', v)} options={opcoes.regioes} />
        <SelectFiltro label="Região destino" value={filtros.regiaoDestino} onChange={(v) => atualizarFiltro('regiaoDestino', v)} options={opcoes.regioes} />
        <SelectFiltro label="UF origem" value={filtros.ufOrigem} onChange={(v) => atualizarFiltro('ufOrigem', v)} options={opcoes.ufsOrigem} />
        <SelectFiltro label="UF destino" value={filtros.ufDestino} onChange={(v) => atualizarFiltro('ufDestino', v)} options={opcoes.ufsDestino} />
        <SelectFiltro label="Modalidade" value={filtros.modalidade} onChange={(v) => atualizarFiltro('modalidade', v)} options={opcoes.modalidades} />
        <SelectFiltro label="Tipo tabela" value={filtros.tipoTabela} onChange={(v) => atualizarFiltro('tipoTabela', v)} options={opcoes.tiposTabela} />
        <SelectFiltro label="Status" value={filtros.status} onChange={(v) => atualizarFiltro('status', v)} options={opcoes.status} />
        <SelectFiltro label="Prazo" value={filtros.comPrazo} onChange={(v) => atualizarFiltro('comPrazo', v)} options={['COM_PRAZO', 'SEM_PRAZO']} />
        <div style={styles.filtroAcoes}>
          <button type="button" onClick={() => setFiltros(FILTROS_INICIAIS)} style={styles.botaoSecundario}>Limpar filtros</button>
        </div>
      </section>

      <section style={styles.indicadoresGrid}>
        <CardIndicador titulo="Rotas filtradas" valor={numero(indicadores.rotas)} detalhe={`${numero(indicadores.registros)} linhas de tabela`} />
        <CardIndicador titulo="Transportadoras" valor={numero(indicadores.transportadoras)} detalhe="com cobertura na base filtrada" />
        <CardIndicador titulo="Menor prazo" valor={indicadores.menorPrazo ? `${indicadores.menorPrazo} dia${indicadores.menorPrazo === 1 ? '' : 's'}` : 'N/I'} detalhe={`média ${numero(indicadores.prazoMedio, 1)} dias`} />
        <CardIndicador titulo="Baixa cobertura" valor={numero(indicadores.rotasBaixaCobertura)} detalhe="rotas com até 1 transportadora" />
        <CardIndicador titulo="UFs sem cobertura" valor={numero(indicadores.ufsSemCobertura)} detalhe="considerando o filtro atual" />
      </section>

      <div style={styles.abas}>
        {[
          ['dashboard', 'Dashboard'],
          ['mapa', 'Mapa por UF'],
          ['rotas', 'Rotas críticas'],
          ['relatorio', 'Relatório detalhado'],
        ].map(([chave, label]) => (
          <button key={chave} type="button" onClick={() => setAba(chave)} style={aba === chave ? styles.abaAtiva : styles.aba}>
            {label}
          </button>
        ))}
      </div>

      {aba === 'dashboard' && (
        <div style={styles.duasColunas}>
          <section style={styles.cardPainel}>
            <h2 style={styles.tituloSecao}>Melhores prazos por rota</h2>
            <div style={styles.listaCompacta}>
              {melhoresPrazos.length === 0 && <div style={styles.empty}>Nenhuma rota com prazo informado.</div>}
              {melhoresPrazos.map((rota) => (
                <div key={rota.rotaKey} style={styles.itemLista}>
                  <div>
                    <strong>{rota.rotaLabel}</strong>
                    <div style={styles.textoSuave}>{rota.melhoresTransportadoras.join(', ') || 'Transportadora N/I'}</div>
                  </div>
                  <div style={styles.badgePrazo}>{rota.menorPrazo}d</div>
                </div>
              ))}
            </div>
          </section>

          <section style={styles.cardPainel}>
            <h2 style={styles.tituloSecao}>Rotas com pouca cobertura</h2>
            <div style={styles.listaCompacta}>
              {rotasCriticas.length === 0 && <div style={styles.empty}>Nenhuma rota crítica no filtro atual.</div>}
              {rotasCriticas.map((rota) => (
                <div key={rota.rotaKey} style={styles.itemLista}>
                  <div>
                    <strong>{rota.rotaLabel}</strong>
                    <div style={styles.textoSuave}>{rota.canal} · {rota.regiaoOrigem || 'Origem N/I'} → {rota.regiaoDestino || 'Destino N/I'}</div>
                  </div>
                  <div style={styles.badgeCritico}>{rota.qtdTransportadoras} transp.</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {aba === 'mapa' && (
        <section style={styles.cardPainel}>
          <div style={styles.headerSecao}>
            <h2 style={styles.tituloSecao}>Mapa visual de cobertura por UF destino</h2>
            <div style={styles.legendaMapa}>
              <span>0 sem cobertura</span><span>1 baixa</span><span>2-3 atenção</span><span>4+ boa</span>
            </div>
          </div>
          <div style={styles.mapaGrid}>
            {mapaUf.map((uf) => (
              <div key={uf.uf} style={{ ...styles.cardUf, ...estiloCardMapa(uf.qtdTransportadoras) }}>
                <div style={styles.ufTopo}><strong>{uf.uf}</strong><span>{uf.regiao}</span></div>
                <div style={styles.ufNumero}>{uf.qtdTransportadoras}</div>
                <div style={styles.ufDetalhe}>{uf.qtdRotas} rotas · {uf.menorPrazo ? `${uf.menorPrazo}d menor prazo` : 'sem prazo'}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {aba === 'rotas' && (
        <section style={styles.cardPainel}>
          <h2 style={styles.tituloSecao}>Rotas consolidadas por cobertura</h2>
          <div style={styles.tabelaWrapper}>
            <table style={styles.tabela}>
              <thead>
                <tr>
                  <th style={styles.th}>Rota</th>
                  <th style={styles.th}>Canal</th>
                  <th style={styles.th}>Transportadoras</th>
                  <th style={styles.th}>Menor prazo</th>
                  <th style={styles.th}>Maior prazo</th>
                  <th style={styles.th}>Prazo médio</th>
                  <th style={styles.th}>Melhor prazo</th>
                </tr>
              </thead>
              <tbody>
                {rotas.map((rota) => (
                  <tr key={rota.rotaKey}>
                    <td style={styles.td}><strong>{rota.rotaLabel}</strong><div style={styles.textoSuave}>{rota.regiaoOrigem || '-'} → {rota.regiaoDestino || '-'}</div></td>
                    <td style={styles.td}>{rota.canal}</td>
                    <td style={styles.td}>{rota.qtdTransportadoras}</td>
                    <td style={styles.td}>{rota.menorPrazo ? `${rota.menorPrazo}d` : 'Sem prazo'}</td>
                    <td style={styles.td}>{rota.maiorPrazo ? `${rota.maiorPrazo}d` : 'Sem prazo'}</td>
                    <td style={styles.td}>{rota.prazoMedio ? `${numero(rota.prazoMedio, 1)}d` : 'Sem prazo'}</td>
                    <td style={styles.td}>{rota.melhoresTransportadoras.join(', ') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {aba === 'relatorio' && (
        <section style={styles.cardPainel}>
          <div style={styles.headerSecao}>
            <h2 style={styles.tituloSecao}>Relatório principal por rota e transportadora</h2>
            <span style={styles.textoSuave}>Mostrando {numero(linhasTabela.length)} de {numero(linhasFiltradas.length)} linhas filtradas</span>
          </div>
          <div style={styles.tabelaWrapper}>
            <table style={styles.tabela}>
              <thead>
                <tr>
                  <th style={styles.th}>Origem</th>
                  <th style={styles.th}>Destino</th>
                  <th style={styles.th}>Canal</th>
                  <th style={styles.th}>Transportadora</th>
                  <th style={styles.th}>Prazo</th>
                  <th style={styles.th}>Modalidade</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Tabela</th>
                  <th style={styles.th}>Valor ref.</th>
                </tr>
              </thead>
              <tbody>
                {linhasTabela.map((linha) => (
                  <tr key={linha.id}>
                    <td style={styles.td}>{linha.cidadeOrigem || '-'}<div style={styles.textoSuave}>{linha.ufOrigem || '-'} · {linha.regiaoOrigem || '-'}</div></td>
                    <td style={styles.td}>{linha.cidadeDestino || '-'}<div style={styles.textoSuave}>{linha.ufDestino || '-'} · {linha.regiaoDestino || '-'}</div></td>
                    <td style={styles.td}>{linha.canal}</td>
                    <td style={styles.td}><strong>{linha.transportadora}</strong></td>
                    <td style={styles.td}>{linha.prazoLabel}</td>
                    <td style={styles.td}>{linha.modalidade || linha.tipoVeiculo || '-'}</td>
                    <td style={styles.td}>{linha.status}</td>
                    <td style={styles.td}>{linha.tabelaNome}</td>
                    <td style={styles.td}>{linha.valorReferencia ? moeda(linha.valorReferencia) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

const styles = {
  page: { display: 'flex', flexDirection: 'column', gap: 18, paddingBottom: 32 },
  header: { display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' },
  kicker: { fontSize: 12, fontWeight: 800, color: '#CC2020', textTransform: 'uppercase', letterSpacing: 0.8 },
  titulo: { margin: '4px 0 8px', fontSize: 30, color: '#0F2347' },
  subtitulo: { margin: 0, maxWidth: 850, color: '#526070', lineHeight: 1.5 },
  acoesTopo: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  botaoPrimario: { border: 'none', background: '#CC2020', color: '#fff', borderRadius: 10, padding: '10px 14px', fontWeight: 800, cursor: 'pointer' },
  botaoSecundario: { border: '1px solid #d6dee8', background: '#fff', color: '#0F2347', borderRadius: 10, padding: '10px 14px', fontWeight: 800, cursor: 'pointer' },
  alertaErro: { border: '1px solid #fecaca', background: '#fff1f2', color: '#991b1b', borderRadius: 12, padding: 14, fontWeight: 700 },
  filtrosBox: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 16, boxShadow: '0 8px 24px rgba(15,35,71,0.05)' },
  campoFiltro: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#475569', fontWeight: 800 },
  input: { border: '1px solid #d6dee8', borderRadius: 10, padding: '10px 11px', fontSize: 14, outline: 'none', background: '#fff', color: '#0F2347' },
  filtroAcoes: { display: 'flex', alignItems: 'flex-end' },
  indicadoresGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 },
  cardIndicador: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 16, boxShadow: '0 8px 24px rgba(15,35,71,0.05)' },
  cardTitulo: { color: '#64748b', fontSize: 12, fontWeight: 800, textTransform: 'uppercase' },
  cardValor: { color: '#0F2347', fontSize: 28, fontWeight: 900, marginTop: 6 },
  cardDetalhe: { color: '#64748b', fontSize: 12, marginTop: 4 },
  abas: { display: 'flex', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid #e2e8f0', paddingBottom: 8 },
  aba: { border: '1px solid #d6dee8', background: '#fff', color: '#0F2347', borderRadius: 999, padding: '9px 13px', fontWeight: 800, cursor: 'pointer' },
  abaAtiva: { border: '1px solid #0F2347', background: '#0F2347', color: '#fff', borderRadius: 999, padding: '9px 13px', fontWeight: 800, cursor: 'pointer' },
  duasColunas: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 },
  cardPainel: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 16, boxShadow: '0 8px 24px rgba(15,35,71,0.05)' },
  headerSecao: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  tituloSecao: { margin: '0 0 12px', color: '#0F2347', fontSize: 18 },
  listaCompacta: { display: 'flex', flexDirection: 'column', gap: 10 },
  itemLista: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: 12, border: '1px solid #e2e8f0', borderRadius: 12, background: '#f8fafc' },
  textoSuave: { color: '#64748b', fontSize: 12, marginTop: 3 },
  badgePrazo: { background: '#e8f7ee', color: '#166534', borderRadius: 999, padding: '6px 10px', fontWeight: 900, whiteSpace: 'nowrap' },
  badgeCritico: { background: '#fff1f2', color: '#9f1239', borderRadius: 999, padding: '6px 10px', fontWeight: 900, whiteSpace: 'nowrap' },
  empty: { color: '#64748b', padding: 16, textAlign: 'center', background: '#f8fafc', borderRadius: 12 },
  legendaMapa: { display: 'flex', gap: 8, flexWrap: 'wrap', color: '#64748b', fontSize: 12 },
  mapaGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 },
  cardUf: { border: '1px solid', borderRadius: 14, padding: 12, minHeight: 96 },
  ufTopo: { display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 12 },
  ufNumero: { fontSize: 28, fontWeight: 900, marginTop: 8 },
  ufDetalhe: { fontSize: 11, marginTop: 4 },
  tabelaWrapper: { overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 12 },
  tabela: { width: '100%', borderCollapse: 'collapse', minWidth: 980, background: '#fff' },
  th: { textAlign: 'left', padding: '11px 12px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: 12, textTransform: 'uppercase' },
  td: { padding: '11px 12px', borderBottom: '1px solid #eef2f7', color: '#0F2347', verticalAlign: 'top', fontSize: 13 },
};
