import { faturaPaga, faturaEmAntecipacao } from '../services/auditorRoboService';
import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { carregarSessao } from '../utils/authLocal';
import { casarBoletosComFaturas, divergenciasBoleto, lerBoletoPdf } from '../utils/boletosPasta';
import {
  confirmarBoletos, desfazerConfirmacaoBoleto, listarControleBoletos, STATUS_BOLETO,
} from '../services/boletoControleService';

const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-');
const norm = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

// Faturas liberadas para pagamento e ainda nao pagas: o boleto precisa estar na pasta do financeiro.
export const STATUS_EXIGE_BOLETO = new Set(['PRONTA_PARA_PAGAMENTO', 'LIBERADA_COM_DESCONTO', 'ENVIADA_AO_FINANCEIRO']);

function diasDesde(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

// faturas: faturas do recorte atual (ja filtradas por auditor); desde: { faturaId: dataLiberacaoIso }.
export default function BoletosPendentesPainel({ faturas, desde = {}, mostrarAuditor = false, onAbrirFatura }) {
  const sessao = carregarSessao();
  const [controle, setControle] = useState([]);
  const [local, setLocal] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState(false);
  const [verConfirmados, setVerConfirmados] = useState(false);
  const [busca, setBusca] = useState('');
  const [selecionadas, setSelecionadas] = useState(() => new Set());
  const [salvando, setSalvando] = useState(false);
  const [pasta, setPasta] = useState(null); // { total, casamento } da ultima conferencia da pasta

  const recarregar = () => listarControleBoletos()
    .then(({ lista, local: l }) => { setControle(lista); setLocal(l); setErro(''); })
    .catch((e) => setErro(e.message))
    .finally(() => setCarregando(false));
  useEffect(() => { recarregar(); }, []);

  const porFatura = useMemo(() => new Map(controle.map((c) => [String(c.fatura_id), c])), [controle]);
  // Fatura ja paga (partida/pagamento gravado) nao espera mais boleto, mesmo que o status ainda nao tenha virado PAGA.
  // Antecipacao (Atribuicao "Cessao" no SAP) tambem nao espera boleto: fica no bloco proprio ate ser paga.
  const exigem = useMemo(() => (faturas || []).filter((f) => STATUS_EXIGE_BOLETO.has(f.status) && !faturaPaga(f) && !faturaEmAntecipacao(f)), [faturas]);
  const emAntecipacao = useMemo(() => (faturas || []).filter((f) => STATUS_EXIGE_BOLETO.has(f.status) && faturaEmAntecipacao(f)), [faturas]);
  const [verAntecipacao, setVerAntecipacao] = useState(false);
  const termo = norm(busca);
  const filtra = (f) => !termo || [f.numero_fatura, f.transportadora, f.auditor_nome].some((v) => norm(v).includes(termo));

  const pendentes = useMemo(() => exigem
    .filter((f) => !porFatura.has(String(f.id)))
    .filter(filtra)
    .map((f) => ({ f, dias: diasDesde(desde[f.id] || f.updated_at) }))
    .sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1)), [exigem, porFatura, desde, termo]);
  const confirmados = useMemo(() => exigem
    .filter((f) => porFatura.has(String(f.id)))
    .filter(filtra)
    .map((f) => ({ f, c: porFatura.get(String(f.id)) }))
    .sort((a, b) => String(b.c.confirmado_em).localeCompare(String(a.c.confirmado_em))), [exigem, porFatura, termo]);

  const [lendo, setLendo] = useState('');
  const lerPasta = async (ev) => {
    const arquivos = Array.from(ev.target.files || []).filter((a) => /\.pdf$/i.test(a.name));
    ev.target.value = '';
    if (!arquivos.length) { setErro('Nenhum PDF encontrado na pasta escolhida.'); return; }
    setErro('');
    const leituras = new Map();
    for (let i = 0; i < arquivos.length; i += 1) {
      setLendo(`Lendo boleto ${i + 1} de ${arquivos.length}...`);
      leituras.set(arquivos[i].name, await lerBoletoPdf(arquivos[i]));
    }
    setLendo('');
    // Mesma linha digitavel em mais de um arquivo = boleto repetido.
    const porLinha = new Map();
    leituras.forEach((l, nome) => { if (l.linhaDigitavel) porLinha.set(l.linhaDigitavel, [...(porLinha.get(l.linhaDigitavel) || []), nome]); });
    const repetidos = [...porLinha.values()].filter((v) => v.length > 1);
    setPasta({ total: arquivos.length, leituras, repetidos, casamento: casarBoletosComFaturas(arquivos.map((a) => a.name), faturas) });
  };
  const achado = (f) => pasta?.casamento.porFatura.get(String(f.id));
  const leitura = (f) => (achado(f) ? pasta.leituras.get(achado(f).arquivo) : null);
  const diverge = (f) => divergenciasBoleto(leitura(f), f);
  const comArquivo = pendentes.filter(({ f }) => achado(f) && !diverge(f).length);
  const divergentes = pendentes.filter(({ f }) => achado(f) && diverge(f).length);
  const baixarEncontrados = () => aplicar(comArquivo.map(({ f }) => f), STATUS_BOLETO.NA_PASTA, 'PASTA');

  const valorPendente = pendentes.reduce((acc, { f }) => acc + Number(f.valor_fatura || 0), 0);
  const maisAntigo = pendentes.reduce((m, { dias }) => Math.max(m, dias ?? 0), 0);
  const nSel = pendentes.filter(({ f }) => selecionadas.has(String(f.id))).length;

  const alternar = (id) => setSelecionadas((prev) => {
    const novo = new Set(prev);
    if (novo.has(id)) novo.delete(id); else novo.add(id);
    return novo;
  });
  const todasMarcadas = pendentes.length > 0 && nSel === pendentes.length;
  const alternarTodas = () => setSelecionadas(todasMarcadas ? new Set() : new Set(pendentes.map(({ f }) => String(f.id))));

  const aplicar = async (lista, status, metodo = 'MANUAL') => {
    if (!lista.length || salvando) return;
    let observacao = '';
    if (status === STATUS_BOLETO.DISPENSADO) {
      observacao = (window.prompt('Por que esta fatura nao precisa de boleto? (ex.: pago por transferencia, debito automatico)') || '').trim();
      if (!observacao) return;
    } else if (lista.length > 1 && !window.confirm(`Confirmar que o boleto de ${lista.length} fatura(s) esta na pasta do financeiro?`)) {
      return;
    }
    setSalvando(true);
    setErro('');
    try {
      await confirmarBoletos(lista, { status, metodo, observacao, usuario: { nome: sessao?.nome, email: sessao?.email } });
      setSelecionadas(new Set());
      await recarregar();
    } catch (e) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  };

  const desfazer = async (f) => {
    if (!window.confirm(`Voltar a fatura ${f.numero_fatura} para "aguardando boleto"?`)) return;
    try { await desfazerConfirmacaoBoleto(f.id); await recarregar(); } catch (e) { setErro(e.message); }
  };

  const exportar = () => {
    const linhas = pendentes.map(({ f, dias }) => ({
      Fatura: f.numero_fatura || '',
      Transportadora: f.transportadora || '',
      Auditor: f.auditor_nome || '',
      Valor: Number(f.valor_fatura || 0),
      Vencimento: dataBr(f.data_vencimento),
      'Boleto na pasta': pasta ? (achado(f)?.arquivo || 'NAO') : '',
      'Valor do boleto': leitura(f)?.valor ?? '',
      'Vencimento do boleto': leitura(f)?.vencimento ? dataBr(leitura(f).vencimento) : '',
      'Divergencia': diverge(f).join(' + '),
      'Linha digitavel': leitura(f)?.linhaDigitavel || '',
      'Dias aguardando boleto': dias ?? '',
      Status: f.status,
    }));
    const ws = XLSX.utils.json_to_sheet(linhas);
    ws['!cols'] = [{ wch: 14 }, { wch: 30 }, { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 24 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Boletos pendentes');
    if (pasta) {
      const extras = [
        ...pasta.casamento.semFatura.map((x) => ({ Arquivo: x.arquivo, Situacao: x.motivo })),
        ...pasta.casamento.duvidosos.map((x) => ({ Arquivo: x.arquivo, Situacao: `Mais de uma fatura possivel: ${x.faturas.map((f) => `${f.numero_fatura} ${f.transportadora}`).join(' | ')}` })),
      ];
      if (extras.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(extras), 'Arquivos sem fatura');
    }
    XLSX.writeFile(wb, `BOLETOS_PENDENTES_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const corDias = (d) => (d == null ? '#64748b' : d >= 5 ? '#b91c1c' : d >= 2 ? '#c2410c' : '#475569');

  return (
    <div className="table-card" style={{ marginBottom: 14, borderLeft: '4px solid #0369a1' }}>
      <div
        className="panel-title audit-table-title"
        style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', cursor: 'pointer' }}
        onClick={() => setAberto((v) => !v)}
      >
        <span>{aberto ? '▾' : '▸'} Boletos na pasta do financeiro</span>
        <span style={{ fontWeight: 800, color: pendentes.length ? '#b45309' : '#14733b' }}>
          {carregando ? '...' : `${pendentes.length} pendente(s)`}
        </span>
        {!carregando && pendentes.length > 0 && (
          <span style={{ fontSize: 12, fontWeight: 400, color: '#475569' }}>
            {dinheiro(valorPendente)} · mais antigo: {maisAntigo} dia(s)
          </span>
        )}
        {emAntecipacao.length > 0 && (
          <span style={{ fontSize: 12, fontWeight: 700, color: '#6d28d9' }}>· {emAntecipacao.length} em antecipacao (cessao)</span>
        )}
      </div>
      {aberto && emAntecipacao.length > 0 && (
        <div style={{ padding: '0 12px 8px' }}>
          <button type="button" className="btn-secondary audit-small-button" onClick={() => setVerAntecipacao((v) => !v)}>
            {verAntecipacao ? 'Ocultar' : 'Ver'} {emAntecipacao.length} em antecipacao (cessao) · {dinheiro(emAntecipacao.reduce((a, f) => a + Number(f.valor_fatura || 0), 0))}
          </button>
          {verAntecipacao && (
            <div className="sim-analise-tabela-wrap" style={{ maxHeight: 280, overflowY: 'auto', marginTop: 6 }}>
              <div className="hint-box compact" style={{ marginBottom: 6 }}>
                Atribuicao "Cessao" no SAP: fatura antecipada, nao precisa de boleto. Sai daqui sozinha quando o pagamento entrar (partida 200).
              </div>
              <table className="sim-analise-tabela">
                <thead><tr><th>Fatura</th><th>Transportadora</th><th>Valor</th><th>Vencimento</th><th>Atribuicao SAP</th></tr></thead>
                <tbody>
                  {emAntecipacao.map((f) => (
                    <tr key={f.id} style={{ cursor: onAbrirFatura ? 'pointer' : undefined }} onClick={() => onAbrirFatura?.(f)}>
                      <td>{f.numero_fatura}</td><td>{f.transportadora}</td><td>{dinheiro(f.valor_fatura)}</td>
                      <td>{dataBr(f.data_vencimento)}</td><td>{f.atribuicao_sap}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {aberto && (
        <div style={{ padding: '0 12px 12px' }}>
          {local && (
            <div className="hint-box compact" style={{ borderLeft: '4px solid #b45309', marginBottom: 8 }}>
              Tabela <code>fatura_boleto_controle</code> ainda nao existe no banco: as confirmacoes ficam so neste navegador.
              Aplique a migration <code>supabase/migrations/20261014_001_fatura_boleto_controle.sql</code> para compartilhar com a equipe.
            </div>
          )}
          {erro && <div className="hint-box compact" style={{ borderLeft: '4px solid #b91c1c', marginBottom: 8 }}>{erro}</div>}
          <div className="hint-box compact" style={{ marginBottom: 8 }}>
            Fatura liberada para pagamento precisa ter o boleto na pasta do financeiro. Quando colocar o boleto na pasta,
            clique em <strong>Boleto na pasta</strong> para dar a baixa nesta lista.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <input
              type="search" placeholder="Buscar fatura, transportadora ou auditor" value={busca}
              onChange={(e) => setBusca(e.target.value)} style={{ minWidth: 260 }}
            />
            <button type="button" className="btn-primary audit-small-button" disabled={!nSel || salvando}
              onClick={() => aplicar(pendentes.filter(({ f }) => selecionadas.has(String(f.id))).map(({ f }) => f), STATUS_BOLETO.NA_PASTA)}>
              Boleto na pasta ({nSel})
            </button>
            <button type="button" className="btn-secondary audit-small-button" disabled={!nSel || salvando}
              onClick={() => aplicar(pendentes.filter(({ f }) => selecionadas.has(String(f.id))).map(({ f }) => f), STATUS_BOLETO.DISPENSADO)}>
              Nao precisa de boleto ({nSel})
            </button>
            <label className="btn-secondary audit-small-button" style={{ cursor: 'pointer' }}>
              {lendo || 'Conferir pasta de boletos'}
              <input type="file" multiple accept=".pdf" disabled={!!lendo} style={{ display: 'none' }} onChange={lerPasta}
                ref={(el) => { if (el) { el.setAttribute('webkitdirectory', ''); el.setAttribute('directory', ''); } }} />
            </label>
            {pasta && (
              <button type="button" className="btn-primary audit-small-button" disabled={!comArquivo.length || salvando} onClick={baixarEncontrados}>
                Dar baixa nos conferidos ({comArquivo.length})
              </button>
            )}
            <button type="button" className="btn-secondary audit-small-button" disabled={!pendentes.length} onClick={exportar}>
              Exportar pendentes
            </button>
            <label style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="checkbox" checked={verConfirmados} onChange={(e) => setVerConfirmados(e.target.checked)} />
              Ver ja confirmados ({confirmados.length})
            </label>
          </div>

          {pasta && (
            <div className="hint-box compact" style={{ marginBottom: 8, borderLeft: '4px solid #0369a1' }}>
              <strong>{pasta.total}</strong> boleto(s) na pasta · <strong>{comArquivo.length}</strong> de {pendentes.length} fatura(s) pendente(s) já têm arquivo ·{' '}
              <strong>{divergentes.length}</strong> com divergência de valor/vencimento ·{' '}
              <strong>{pendentes.length - comArquivo.length - divergentes.length}</strong> sem boleto ·{' '}
              {pasta.repetidos.length > 0 && <><strong style={{ color: '#b91c1c' }}>{pasta.repetidos.length} boleto(s) repetido(s)</strong> ({pasta.repetidos.map((r) => r.join(' = ')).join('; ')}) · </>}
              {pasta.casamento.semFatura.length + pasta.casamento.duvidosos.length} arquivo(s) sem fatura correspondente
              {(pasta.casamento.semFatura.length + pasta.casamento.duvidosos.length) > 0 && (
                <details style={{ marginTop: 4 }}>
                  <summary style={{ cursor: 'pointer' }}>Ver arquivos sem fatura</summary>
                  <ul style={{ margin: '4px 0 0 16px' }}>
                    {pasta.casamento.semFatura.map((x) => <li key={x.arquivo}>{x.arquivo} — {x.motivo}</li>)}
                    {pasta.casamento.duvidosos.map((x) => <li key={x.arquivo}>{x.arquivo} — mais de uma fatura possível</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}
          {!carregando && !pendentes.length && (
            <div style={{ padding: 10, color: '#14733b', fontWeight: 700 }}>✓ Nenhum boleto pendente neste recorte.</div>
          )}
          {pendentes.length > 0 && (
            <div className="sim-analise-tabela-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
              <table className="sim-analise-tabela">
                <thead>
                  <tr>
                    <th><input type="checkbox" checked={todasMarcadas} onChange={alternarTodas} /></th>
                    <th>Fatura</th>
                    <th>Transportadora</th>
                    {mostrarAuditor && <th>Auditor</th>}
                    <th>Valor</th>
                    <th>Vencimento</th>
                    {pasta && <th>Boleto</th>}
                    {pasta && <th>Valor / venc. do boleto</th>}
                    <th>Aguardando</th>
                    <th>Acao</th>
                  </tr>
                </thead>
                <tbody>
                  {pendentes.map(({ f, dias }) => (
                    <tr key={f.id}>
                      <td><input type="checkbox" checked={selecionadas.has(String(f.id))} onChange={() => alternar(String(f.id))} /></td>
                      <td>
                        {onAbrirFatura
                          ? <button type="button" className="link-button" onClick={() => onAbrirFatura(f)}>{f.numero_fatura}</button>
                          : f.numero_fatura}
                      </td>
                      <td>{f.transportadora}</td>
                      {mostrarAuditor && <td>{f.auditor_nome || 'SEM AUDITOR'}</td>}
                      <td>{dinheiro(f.valor_fatura)}</td>
                      <td>{dataBr(f.data_vencimento)}</td>
                      {pasta && (
                        <td style={{ fontWeight: 700, color: achado(f) && !diverge(f).length ? '#14733b' : '#b91c1c' }} title={achado(f)?.arquivo || ''}>
                          {!achado(f) ? 'Sem boleto' : diverge(f).length ? `Divergente: ${diverge(f).join(' + ')}` : achado(f).certeza === 'SO_NUMERO' ? 'Tem (conferir nome)' : 'Tem'}
                        </td>
                      )}
                      {pasta && (
                        <td style={{ fontSize: 12 }}>
                          {leitura(f)?.erro ? <span title={leitura(f).erro}>não lido</span>
                            : leitura(f) ? `${dinheiro(leitura(f).valor)} · ${dataBr(leitura(f).vencimento)}` : '-'}
                        </td>
                      )}
                      <td style={{ color: corDias(dias), fontWeight: 700 }}>{dias == null ? '-' : `${dias} dia(s)`}</td>
                      <td>
                        <button type="button" className="btn-primary audit-small-button" disabled={salvando}
                          onClick={() => aplicar([f], STATUS_BOLETO.NA_PASTA)}>
                          Boleto na pasta
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {verConfirmados && (
            <div className="sim-analise-tabela-wrap" style={{ marginTop: 12, maxHeight: 300, overflowY: 'auto' }}>
              <table className="sim-analise-tabela">
                <thead>
                  <tr><th>Fatura</th><th>Transportadora</th><th>Valor</th><th>Situacao</th><th>Por</th><th>Quando</th><th /></tr>
                </thead>
                <tbody>
                  {confirmados.slice(0, 200).map(({ f, c }) => (
                    <tr key={f.id}>
                      <td>{f.numero_fatura}</td>
                      <td>{f.transportadora}</td>
                      <td>{dinheiro(f.valor_fatura)}</td>
                      <td title={c.observacao || ''}>
                        {c.status === STATUS_BOLETO.DISPENSADO ? 'Nao precisa de boleto' : c.metodo === 'PASTA' ? 'Na pasta (conferido)' : 'Na pasta (confirmado)'}
                      </td>
                      <td>{c.confirmado_por || '-'}</td>
                      <td>{dataBr(c.confirmado_em)}</td>
                      <td><button type="button" className="btn-secondary audit-small-button" onClick={() => desfazer(f)}>Desfazer</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
