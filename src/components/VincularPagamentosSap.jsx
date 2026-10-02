import { useEffect, useMemo, useState } from 'react';
import { listarSapSemVinculo, vincularLinhaSapAFatura } from '../services/auditoriaFretesService';
import { obterRaizCnpj } from '../utils/cnpj';

const dinheiro = (valor) => Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (valor) => {
  if (!valor) return '-';
  const [ano, mes, dia] = String(valor).slice(0, 10).split('-');
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : valor;
};
const STATUS_PAGOS = new Set(['PAGA', 'PAGA_COM_DESCONTO', 'PAGA_COM_DIVERGENCIA', 'CANCELADA', 'SUBSTITUIDA']);
const LIMITE_LINHAS = 60;

const nomeBase = (txt) => String(txt || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  .replace(/[^A-Z0-9 ]/g, ' ').replace(/\b(LTDA|ME|EPP|EIRELI|SA|S A)\b/g, ' ').replace(/\s+/g, ' ').trim();
const palavras = (txt) => new Set(nomeBase(txt).split(' ').filter((p) => p.length > 2));
function nomeParecido(a, b) {
  const pa = palavras(a);
  const pb = palavras(b);
  if (!pa.size || !pb.size) return false;
  let comuns = 0;
  pa.forEach((p) => { if (pb.has(p)) comuns += 1; });
  return comuns / Math.min(pa.size, pb.size) >= 0.5;
}

// Pontua o quanto uma linha do SAP parece ser o pagamento de uma fatura.
function pontuar(fatura, linha, raizesDaTransportadora) {
  let pontos = 0;
  const motivos = [];
  if (String(linha.numero_fatura || '').trim().toUpperCase() === String(fatura.numero_fatura || '').trim().toUpperCase()) { pontos += 50; motivos.push('mesmo numero'); }
  const dif = Math.abs(Number(linha.valor_pago || 0) - Number(fatura.valor_fatura || 0));
  if (dif <= 0.01) { pontos += 30; motivos.push('valor igual'); }
  else if (Number(fatura.valor_fatura) > 0 && dif / Number(fatura.valor_fatura) <= 0.05) { pontos += 10; motivos.push('valor proximo'); }
  if (nomeParecido(linha.transportadora_sap, fatura.transportadora)) { pontos += 15; motivos.push('nome parecido'); }
  const raizLinha = obterRaizCnpj(linha.cnpj);
  const cnpjIgual = Boolean(raizLinha) && raizLinha === obterRaizCnpj(fatura.cnpj_transportadora);
  if (cnpjIgual) { pontos += 40; motivos.push('mesmo CNPJ'); }
  else if (raizesDaTransportadora.has(raizLinha)) { pontos += 10; motivos.push('CNPJ ja usado pela transportadora'); }
  const nomeIgual = nomeParecido(linha.transportadora_sap, fatura.transportadora);
  return { pontos, motivos, cnpjIgual, nomeIgual };
}

export default function VincularPagamentosSap({ state, onState, sessao }) {
  const usuarioNome = sessao?.nome || sessao?.email || '';
  const [linhas, setLinhas] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [vinculando, setVinculando] = useState('');
  const [aberto, setAberto] = useState(true);
  const [escopo, setEscopo] = useState('vencidas');
  const [auditor, setAuditor] = useState('');
  const [busca, setBusca] = useState('');
  const [soComSugestao, setSoComSugestao] = useState(true);
  const [buscaManual, setBuscaManual] = useState({});

  const carregar = async () => {
    setCarregando(true);
    setErro('');
    try {
      setLinhas(await listarSapSemVinculo());
    } catch (error) {
      setErro(`${error.message || error} — a migration 20261002_001_sap_linhas_sem_vinculo.sql ja foi aplicada?`);
    } finally {
      setCarregando(false);
    }
  };
  useEffect(() => { carregar(); }, []);

  const hoje = new Date().toISOString().slice(0, 10);
  const raizesPorTransportadora = useMemo(() => {
    const mapa = new Map();
    for (const f of state.faturas || []) {
      const raiz = obterRaizCnpj(f.cnpj_transportadora);
      if (!raiz) continue;
      const nome = nomeBase(f.transportadora);
      if (!mapa.has(nome)) mapa.set(nome, new Set());
      mapa.get(nome).add(raiz);
    }
    return mapa;
  }, [state.faturas]);

  const auditores = useMemo(() => [...new Set((state.faturas || []).map((f) => f.auditor_nome).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [state.faturas]);

  const pendentes = useMemo(() => (state.faturas || []).filter((f) => {
    if (STATUS_PAGOS.has(f.status) || f.partida) return false;
    if (escopo === 'vencidas' && !(f.data_vencimento && String(f.data_vencimento).slice(0, 10) < hoje)) return false;
    if (auditor && f.auditor_nome !== auditor) return false;
    const texto = busca.trim().toLowerCase();
    if (texto && !`${f.numero_fatura} ${f.transportadora}`.toLowerCase().includes(texto)) return false;
    return true;
  }), [state.faturas, escopo, auditor, busca, hoje]);

  const porNumero = useMemo(() => {
    const mapa = new Map();
    for (const l of linhas) {
      const n = String(l.numero_fatura || '').trim().toUpperCase();
      mapa.set(n, [...(mapa.get(n) || []), l]);
    }
    return mapa;
  }, [linhas]);

  const sugestoes = (fatura) => {
    const raizes = raizesPorTransportadora.get(nomeBase(fatura.transportadora)) || new Set();
    const numero = String(fatura.numero_fatura || '').trim().toUpperCase();
    const manual = (buscaManual[fatura.id] || '').trim().toLowerCase();
    let base = linhas;
    if (manual) {
      base = linhas.filter((l) => `${l.numero_fatura} ${l.transportadora_sap} ${l.cnpj} ${l.valor_pago} ${l.partida} ${l.lancamento_contabil}`.toLowerCase().includes(manual));
    } else {
      const cents = Math.round(Number(fatura.valor_fatura || 0) * 100);
      base = [...(porNumero.get(numero) || []), ...linhas.filter((l) => Math.round(Number(l.valor_pago || 0) * 100) === cents && String(l.numero_fatura || '').trim().toUpperCase() !== numero)];
    }
    return base
      .map((linha) => ({ linha, ...pontuar(fatura, linha, raizes) }))
      .filter((s) => manual || (s.pontos >= 40 && (s.cnpjIgual || s.nomeIgual)))
      .sort((a, b) => b.pontos - a.pontos)
      .slice(0, 5);
  };

  const linhasTela = useMemo(() => {
    const todas = pendentes.map((fatura) => ({ fatura, itens: sugestoes(fatura) }));
    return soComSugestao ? todas.filter((x) => x.itens.length || buscaManual[x.fatura.id]) : todas;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendentes, linhas, soComSugestao, buscaManual, raizesPorTransportadora]);

  const vincular = async (fatura, linha) => {
    const alerta = obterRaizCnpj(linha.cnpj) && obterRaizCnpj(linha.cnpj) !== obterRaizCnpj(fatura.cnpj_transportadora)
      ? `ATENCAO: o CNPJ do SAP (${linha.cnpj}) e diferente do CNPJ da fatura (${fatura.cnpj_transportadora || '-'}).

` : '';
    if (!window.confirm(`${alerta}Vincular o pagamento do SAP (${linha.transportadora_sap || '-'}, ${dinheiro(linha.valor_pago)}, doc. ${linha.partida || linha.lancamento_contabil || '-'}) a fatura ${fatura.numero_fatura} de ${fatura.transportadora}?`)) return;
    setVinculando(linha.id);
    setErro('');
    setMensagem('');
    try {
      const next = await vincularLinhaSapAFatura(state, linha, fatura, usuarioNome);
      onState(next);
      setLinhas((prev) => prev.filter((l) => l.id !== linha.id));
      setMensagem(`Fatura ${fatura.numero_fatura} vinculada ao pagamento do SAP.`);
    } catch (error) {
      setErro(error.message || String(error));
    } finally {
      setVinculando('');
    }
  };

  return (
    <div className="panel-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Vincular pagamentos do SAP a mao</div>
          <p className="compact">
            Linhas do relatorio SAP que nao casaram sozinhas (CNPJ diferente, numero repetido ou so o valor bate). Filtre as faturas sem pagamento,
            confira a sugestao e vincule. {linhas.length} linha(s) aguardando vinculo.
          </p>
        </div>
        <div className="audit-form-actions">
          <button className="btn-secondary" onClick={carregar} disabled={carregando}>{carregando ? 'Carregando...' : 'Atualizar'}</button>
          <button className="btn-secondary" onClick={() => setAberto((v) => !v)}>{aberto ? 'Recolher' : 'Expandir'}</button>
        </div>
      </div>
      {erro && <div className="hint-box compact error-text">{erro}</div>}
      {mensagem && <div className="hint-box compact">{mensagem}</div>}
      {aberto && (
        <>
          <div className="audit-action-bar" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <select value={escopo} onChange={(e) => setEscopo(e.target.value)}>
              <option value="vencidas">Vencidas sem pagamento</option>
              <option value="todas">Todas sem pagamento</option>
            </select>
            <select value={auditor} onChange={(e) => setAuditor(e.target.value)}>
              <option value="">Todos os auditores</option>
              {auditores.map((nome) => <option key={nome} value={nome}>{nome}</option>)}
            </select>
            <input style={{ flex: '1 1 220px' }} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar fatura ou transportadora" />
            <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={soComSugestao} onChange={(e) => setSoComSugestao(e.target.checked)} /> So com sugestao
            </label>
            <span style={{ fontSize: 12 }}>{linhasTela.length} fatura(s)</span>
          </div>
          <div className="sim-analise-tabela-wrap">
            <table className="sim-analise-tabela">
              <thead><tr><th>Fatura</th><th>Transportadora</th><th>Vencimento</th><th>Valor</th><th>Auditor</th><th>Linhas do SAP (sugestoes)</th></tr></thead>
              <tbody>
                {linhasTela.slice(0, LIMITE_LINHAS).map(({ fatura, itens }) => (
                  <tr key={fatura.id}>
                    <td><strong>{fatura.numero_fatura}</strong></td>
                    <td>{fatura.transportadora}<br /><small>{fatura.cnpj_transportadora}</small></td>
                    <td>{dataBr(fatura.data_vencimento)}</td>
                    <td>{dinheiro(fatura.valor_fatura)}</td>
                    <td>{fatura.auditor_nome || '-'}</td>
                    <td>
                      {itens.map(({ linha, pontos, motivos, cnpjIgual }) => (
                        <div key={linha.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '4px 0', borderBottom: '1px solid #eef2f7' }}>
                          <span style={{ fontSize: 12 }}>
                            <strong>{linha.transportadora_sap || '-'}</strong> · CNPJ {linha.cnpj || '-'} · fatura SAP {linha.numero_fatura} · {dinheiro(linha.valor_pago)}
                            {' '}· doc. {linha.partida || linha.lancamento_contabil || '-'}{linha.data_pagamento ? ` em ${dataBr(linha.data_pagamento)}` : ''}
                            {' '}· {linha.compensado ? 'compensado' : linha.lancada_financeiro ? 'lancado no financeiro' : 'partida lancada'}
                            <br /><small style={{ color: cnpjIgual ? '#14733b' : '#b91c1c' }}>{motivos.join(' + ') || 'busca manual'} ({pontos} pts)</small>
                          </span>
                          <button className="btn-primary" disabled={vinculando === linha.id} onClick={() => vincular(fatura, linha)}>{vinculando === linha.id ? 'Vinculando...' : 'Vincular'}</button>
                        </div>
                      ))}
                      {!itens.length && <span style={{ fontSize: 12, color: '#64748b' }}>Nenhuma sugestao automatica. </span>}
                      <input
                        style={{ marginTop: 4, width: 240, fontSize: 12 }}
                        value={buscaManual[fatura.id] || ''}
                        onChange={(e) => setBuscaManual((prev) => ({ ...prev, [fatura.id]: e.target.value }))}
                        placeholder="Buscar nas linhas do SAP (nome, valor, doc.)"
                      />
                    </td>
                  </tr>
                ))}
                {!linhasTela.length && <tr><td colSpan={6}>{carregando ? 'Carregando...' : 'Nenhuma fatura com sugestao de vinculo. Importe o relatorio do SAP para guardar as linhas sem vinculo.'}</td></tr>}
              </tbody>
            </table>
          </div>
          {linhasTela.length > LIMITE_LINHAS && <p className="compact">Mostrando {LIMITE_LINHAS} de {linhasTela.length} faturas — use os filtros para refinar.</p>}
        </>
      )}
    </div>
  );
}
