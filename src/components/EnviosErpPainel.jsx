import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { parseEnvioErpVerum } from '../utils/auditoriaFretesImport';

const FUSO = 'America/Sao_Paulo';
const NOMES_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const PAGAS = new Set(['PAGA', 'PAGA_COM_DIVERGENCIA', 'PAGA_COM_DESCONTO']);

const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const inteiro = (v) => Number(v || 0).toLocaleString('pt-BR');

// Dia (YYYY-MM-DD) no horario de Brasilia, independente do fuso do navegador.
function diaBrasilia(iso) {
  if (!iso) return '';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '';
  return data.toLocaleDateString('sv-SE', { timeZone: FUSO });
}

function rotuloMes(mes) {
  const [ano, m] = mes.split('-');
  return `${NOMES_MES[Number(m) - 1]}/${ano}`;
}

function diasDoMes(mes) {
  const [ano, m] = mes.split('-').map(Number);
  const total = new Date(ano, m, 0).getDate();
  return Array.from({ length: total }, (_, i) => `${mes}-${String(i + 1).padStart(2, '0')}`);
}

function normalizarNumero(v) {
  return String(v ?? '').trim().toUpperCase().replace(/^0+(?=.)/, '');
}

const soDigitos = (v) => String(v || '').replace(/\D/g, '');

// Envios das faturas ao ERP: mensal, dia a dia e por pessoa. Le direto de
// state.faturas (data_envio_erp / enviado_por / valor_enviado) e cruza com a
// partida/lancamento do SAP pra mostrar o que foi enviado e ainda nao lancou.
export default function EnviosErpPainel({ state, onState }) {
  const [mesEscolhido, setMesEscolhido] = useState('');
  const [pessoaFiltro, setPessoaFiltro] = useState('');
  const [importando, setImportando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const inputRef = useRef(null);

  const envios = useMemo(() => (state.faturas || [])
    .filter((f) => f.data_envio_erp && !['SUBSTITUIDA', 'CANCELADA'].includes(f.status))
    .map((f) => ({
      id: f.id,
      dia: diaBrasilia(f.data_envio_erp),
      pessoa: String(f.enviado_por || '').trim() || '(sem nome)',
      valor: Number(f.valor_enviado ?? f.valor_fatura ?? 0),
      fatura: f,
    }))
    .filter((e) => e.dia), [state.faturas]);

  const meses = useMemo(() => [...new Set(envios.map((e) => e.dia.slice(0, 7)))].sort().reverse(), [envios]);
  const mes = mesEscolhido && meses.includes(mesEscolhido) ? mesEscolhido : (meses[0] || '');
  const pessoas = useMemo(() => [...new Set(envios.map((e) => e.pessoa))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [envios]);

  const doMes = useMemo(() => envios.filter((e) => e.dia.startsWith(mes) && (!pessoaFiltro || e.pessoa === pessoaFiltro)), [envios, mes, pessoaFiltro]);
  const pessoasDoMes = useMemo(() => [...new Set(doMes.map((e) => e.pessoa))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [doMes]);

  const totais = useMemo(() => {
    const semLancamento = doMes.filter((e) => !PAGAS.has(e.fatura.status) && !e.fatura.partida && !e.fatura.lancamento_financeiro);
    const diasComEnvio = new Set(doMes.map((e) => e.dia)).size;
    return {
      faturas: doMes.length,
      valor: doMes.reduce((s, e) => s + e.valor, 0),
      pessoas: pessoasDoMes.length,
      mediaDia: diasComEnvio ? doMes.length / diasComEnvio : 0,
      semLancamento: semLancamento.length,
      valorSemLancamento: semLancamento.reduce((s, e) => s + e.valor, 0),
    };
  }, [doMes, pessoasDoMes]);

  // dia -> pessoa -> { qtd, valor }
  const matriz = useMemo(() => {
    const mapa = new Map();
    for (const e of doMes) {
      const linha = mapa.get(e.dia) || new Map();
      const cel = linha.get(e.pessoa) || { qtd: 0, valor: 0 };
      cel.qtd += 1;
      cel.valor += e.valor;
      linha.set(e.pessoa, cel);
      mapa.set(e.dia, linha);
    }
    return mapa;
  }, [doMes]);

  // mes -> pessoa (visao mensal de todos os meses, respeitando o filtro de pessoa)
  const mensal = useMemo(() => {
    const base = envios.filter((e) => !pessoaFiltro || e.pessoa === pessoaFiltro);
    const mapa = new Map();
    for (const e of base) {
      const chave = e.dia.slice(0, 7);
      const linha = mapa.get(chave) || new Map();
      const cel = linha.get(e.pessoa) || { qtd: 0, valor: 0 };
      cel.qtd += 1;
      cel.valor += e.valor;
      linha.set(e.pessoa, cel);
      mapa.set(chave, linha);
    }
    return mapa;
  }, [envios, pessoaFiltro]);
  const pessoasMensal = useMemo(() => [...new Set([...mensal.values()].flatMap((l) => [...l.keys()]))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [mensal]);

  const semLancamentoLista = useMemo(() => doMes
    .filter((e) => !PAGAS.has(e.fatura.status) && !e.fatura.partida && !e.fatura.lancamento_financeiro)
    .sort((a, b) => a.dia.localeCompare(b.dia))
    .slice(0, 200), [doMes]);

  const importarPlanilhas = async (event) => {
    const arquivos = Array.from(event.target.files || []);
    event.target.value = '';
    if (!arquivos.length) return;
    if (!isSupabaseConfigured()) { setErro('Supabase nao configurado.'); return; }
    setImportando(true);
    setErro('');
    setMensagem('');
    try {
      // Indice das faturas ja no banco: numero + CNPJ (digitos), com fallback so no numero.
      const porNumeroCnpj = new Map();
      const porNumero = new Map();
      for (const f of state.faturas || []) {
        const n = normalizarNumero(f.numero_fatura);
        if (!n) continue;
        porNumeroCnpj.set(`${n}|${soDigitos(f.cnpj_transportadora)}`, f);
        porNumero.set(n, [...(porNumero.get(n) || []), f]);
      }
      const atualizacoes = new Map();
      let lidas = 0;
      let semEnvio = 0;
      let naoEncontradas = 0;
      for (const arquivo of arquivos) {
        setMensagem(`Lendo ${arquivo.name}...`);
        const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array', cellDates: false });
        const nomeAba = wb.SheetNames.find((n) => n.trim().toLowerCase() === 'faturas') || wb.SheetNames[0];
        const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], { defval: '' });
        for (const row of linhas) {
          const numero = normalizarNumero(row['Numero Fatura'] ?? row['Número Fatura']);
          if (!numero) continue;
          lidas += 1;
          const envio = parseEnvioErpVerum(row);
          if (!envio.data_envio_erp) { semEnvio += 1; continue; }
          const cnpj = soDigitos(row['CNPJ Transportadora']);
          let fatura = porNumeroCnpj.get(`${numero}|${cnpj}`);
          if (!fatura) {
            const candidatas = porNumero.get(numero) || [];
            fatura = candidatas.length === 1 ? candidatas[0] : null;
          }
          if (!fatura) { naoEncontradas += 1; continue; }
          atualizacoes.set(fatura.id, { id: fatura.id, ...envio, updated_at: new Date().toISOString() });
        }
      }
      const lista = [...atualizacoes.values()];
      const client = getSupabaseClient();
      for (let i = 0; i < lista.length; i += 200) {
        const lote = lista.slice(i, i + 200);
        const { error } = await client.from('faturas').upsert(lote, { onConflict: 'id' });
        if (error) throw new Error(`Erro ao gravar envios: ${error.message}`);
        setMensagem(`Gravando envios ao ERP: ${Math.min(i + 200, lista.length)} de ${lista.length}...`);
      }
      const porId = new Map(lista.map((u) => [u.id, u]));
      onState?.({ ...state, faturas: (state.faturas || []).map((f) => (porId.has(f.id) ? { ...f, ...porId.get(f.id) } : f)) });
      setMensagem(`${lista.length} fatura(s) atualizada(s) com o envio ao ERP · ${lidas} lida(s) na(s) planilha(s) · ${semEnvio} sem data de envio · ${naoEncontradas} nao encontrada(s) no sistema.`);
    } catch (e) {
      setErro(e.message || String(e));
    } finally {
      setImportando(false);
    }
  };

  const celula = (cel) => (cel ? <span title={dinheiro(cel.valor)}>{inteiro(cel.qtd)}</span> : <span style={{ color: '#cbd5e1' }}>-</span>);

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="panel">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: 0 }}>Produtividade Auditoria - envios ao ERP</h3>
            <small>Faturas enviadas ao ERP por mes, dia a dia e por pessoa. Alimentado pela coluna "Data de envio para ERP" do relatorio Verum.</small>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={mes} onChange={(e) => setMesEscolhido(e.target.value)} disabled={!meses.length}>
              {meses.map((m) => <option key={m} value={m}>{rotuloMes(m)}</option>)}
            </select>
            <select value={pessoaFiltro} onChange={(e) => setPessoaFiltro(e.target.value)}>
              <option value="">Todas as pessoas</option>
              {pessoas.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <input ref={inputRef} type="file" accept=".xlsx,.xls" multiple hidden onChange={importarPlanilhas} />
            <button type="button" className="btn-secondary" disabled={importando} onClick={() => inputRef.current?.click()}
              title="Le so a aba Faturas do relatorio Verum e grava data de envio, quem enviou e valor enviado nas faturas ja existentes">
              {importando ? 'Importando...' : 'Importar planilha(s) Verum'}
            </button>
          </div>
        </div>
        {mensagem ? <div className="sim-alert info" style={{ marginTop: 10 }}>{mensagem}</div> : null}
        {erro ? <div className="sim-alert error" style={{ marginTop: 10 }}>{erro}</div> : null}
      </div>

      {!envios.length ? (
        <div className="panel"><div className="hint-box compact">Ainda nao ha envios ao ERP gravados. Use "Importar planilha(s) Verum" com o relatorio de faturas (aba Faturas com a coluna "Data de envio para ERP").</div></div>
      ) : (
        <>
          <div className="summary-strip">
            <div className="summary-card"><span>Faturas enviadas em {mes ? rotuloMes(mes) : '-'}</span><strong>{inteiro(totais.faturas)}</strong></div>
            <div className="summary-card"><span>Valor enviado</span><strong>{dinheiro(totais.valor)}</strong></div>
            <div className="summary-card"><span>Pessoas</span><strong>{inteiro(totais.pessoas)}</strong></div>
            <div className="summary-card"><span>Media por dia com envio</span><strong>{totais.mediaDia.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</strong></div>
            <div className="summary-card"><span>Enviadas, sem lancamento no SAP</span><strong>{inteiro(totais.semLancamento)}</strong><small>{dinheiro(totais.valorSemLancamento)}</small></div>
          </div>

          <div className="table-card">
            <h4 style={{ margin: '0 0 8px' }}>Dia a dia - {mes ? rotuloMes(mes) : ''}</h4>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Dia</th>
                    {pessoasDoMes.map((p) => <th key={p} style={{ textAlign: 'right' }}>{p}</th>)}
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th style={{ textAlign: 'right' }}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {diasDoMes(mes || '1970-01').map((dia) => {
                    const linha = matriz.get(dia);
                    const qtd = linha ? [...linha.values()].reduce((s, c) => s + c.qtd, 0) : 0;
                    const valor = linha ? [...linha.values()].reduce((s, c) => s + c.valor, 0) : 0;
                    const [, , d] = dia.split('-');
                    const semana = new Date(`${dia}T12:00:00`).getDay();
                    return (
                      <tr key={dia} style={!qtd ? { opacity: 0.45 } : undefined}>
                        <td>{d}/{dia.slice(5, 7)}{semana === 0 || semana === 6 ? ' *' : ''}</td>
                        {pessoasDoMes.map((p) => <td key={p} style={{ textAlign: 'right' }}>{celula(linha?.get(p))}</td>)}
                        <td style={{ textAlign: 'right' }}><strong>{qtd ? inteiro(qtd) : '-'}</strong></td>
                        <td style={{ textAlign: 'right' }}>{qtd ? dinheiro(valor) : '-'}</td>
                      </tr>
                    );
                  })}
                  <tr style={{ fontWeight: 700, background: '#f1f5f9' }}>
                    <td>Total</td>
                    {pessoasDoMes.map((p) => {
                      const cel = doMes.filter((e) => e.pessoa === p);
                      return <td key={p} style={{ textAlign: 'right' }}>{inteiro(cel.length)}</td>;
                    })}
                    <td style={{ textAlign: 'right' }}>{inteiro(totais.faturas)}</td>
                    <td style={{ textAlign: 'right' }}>{dinheiro(totais.valor)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <small>* fim de semana. Passe o mouse sobre o numero para ver o valor enviado.</small>
          </div>

          <div className="table-card">
            <h4 style={{ margin: '0 0 8px' }}>Mensal por pessoa</h4>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Mes</th>
                    {pessoasMensal.map((p) => <th key={p} style={{ textAlign: 'right' }}>{p}</th>)}
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th style={{ textAlign: 'right' }}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {[...mensal.keys()].sort().reverse().map((chave) => {
                    const linha = mensal.get(chave);
                    const qtd = [...linha.values()].reduce((s, c) => s + c.qtd, 0);
                    const valor = [...linha.values()].reduce((s, c) => s + c.valor, 0);
                    return (
                      <tr key={chave}>
                        <td>{rotuloMes(chave)}</td>
                        {pessoasMensal.map((p) => <td key={p} style={{ textAlign: 'right' }}>{celula(linha.get(p))}</td>)}
                        <td style={{ textAlign: 'right' }}><strong>{inteiro(qtd)}</strong></td>
                        <td style={{ textAlign: 'right' }}>{dinheiro(valor)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="table-card">
            <h4 style={{ margin: '0 0 8px' }}>Enviadas ao ERP e ainda sem lancamento no SAP - {mes ? rotuloMes(mes) : ''}</h4>
            {semLancamentoLista.length ? (
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr><th>Envio</th><th>Fatura</th><th>Transportadora</th><th>Enviado por</th><th style={{ textAlign: 'right' }}>Valor enviado</th><th>Vencimento</th></tr>
                  </thead>
                  <tbody>
                    {semLancamentoLista.map((e) => (
                      <tr key={e.id}>
                        <td>{e.dia.split('-').reverse().join('/')}</td>
                        <td>{e.fatura.numero_fatura}</td>
                        <td>{e.fatura.transportadora}</td>
                        <td>{e.pessoa}</td>
                        <td style={{ textAlign: 'right' }}>{dinheiro(e.valor)}</td>
                        <td>{e.fatura.data_vencimento ? String(e.fatura.data_vencimento).slice(0, 10).split('-').reverse().join('/') : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {totais.semLancamento > semLancamentoLista.length ? <small>Mostrando as primeiras {semLancamentoLista.length} de {inteiro(totais.semLancamento)}.</small> : null}
              </div>
            ) : <div className="hint-box compact">Todas as faturas enviadas neste periodo ja tem lancamento/partida no SAP.</div>}
          </div>
        </>
      )}
    </div>
  );
}
