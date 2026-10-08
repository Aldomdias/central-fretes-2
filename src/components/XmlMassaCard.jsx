import { useMemo, useState } from 'react';
import { lerCteXml } from '../utils/cteXml';
import { listarTransportadorasCadastro } from '../services/tabelasNegociacaoService';
import { importarRealizadoMensalEnxuto } from '../services/realizadoMensalService';
import { criarIndicePorRaizCnpj, formatarCnpj, normalizarCnpj, obterRaizCnpj, resolverPorCnpjRaiz } from '../utils/cnpj';

const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');

// Sobe XMLs de CT-e em massa, sem escolher transportadora: o CNPJ do emitente
// do XML casa com o cadastro de transportadoras. Importa em modo "complementar"
// (so entram CT-es que ainda nao estao na base), um lote por competencia.
export default function XmlMassaCard() {
  const [arquivos, setArquivos] = useState([]);
  const [lido, setLido] = useState(null);
  const [lendo, setLendo] = useState(false);
  const [importando, setImportando] = useState(false);
  const [progresso, setProgresso] = useState('');
  const [erro, setErro] = useState('');
  const [resultado, setResultado] = useState(null);

  const resumoMeses = useMemo(() => {
    const m = new Map();
    (lido?.registros || []).forEach((r) => m.set(r.competencia, (m.get(r.competencia) || 0) + 1));
    return [...m.entries()].sort();
  }, [lido]);

  function selecionar(fileList) {
    const xmls = Array.from(fileList || []).filter((f) => /\.xml$/i.test(f.name));
    setArquivos(xmls);
    setLido(null);
    setResultado(null);
    setErro(xmls.length ? '' : 'Nenhum arquivo XML encontrado na seleção.');
  }

  async function ler() {
    setLendo(true);
    setErro('');
    setResultado(null);
    try {
      const transportadoras = await listarTransportadorasCadastro();
      const porCnpj = new Map();
      transportadoras.forEach((t) => { const c = normalizarCnpj(t.cnpj); if (c.length === 14) porCnpj.set(c, t); });
      const porRaiz = criarIndicePorRaizCnpj(transportadoras);

      const registros = [];
      const falhas = [];
      const semCadastro = new Map();
      const vistos = new Set();
      let duplicadosNoLote = 0;

      for (let i = 0; i < arquivos.length; i += 1) {
        const f = arquivos[i];
        if (i % 50 === 0) setProgresso(`Lendo XML ${fmt(i + 1)} de ${fmt(arquivos.length)}...`);
        try {
          const r = lerCteXml(await f.text(), f.name);
          if (vistos.has(r.chave_cte)) { duplicadosNoLote += 1; continue; }
          vistos.add(r.chave_cte);
          const transp = porCnpj.get(normalizarCnpj(r.cnpj_transportadora)) || resolverPorCnpjRaiz(r.cnpj_transportadora, porRaiz);
          if (!transp) {
            const k = normalizarCnpj(r.cnpj_transportadora) || 'sem CNPJ';
            const atual = semCadastro.get(k) || { cnpj: k, nome: r.transportadora, qtd: 0 };
            atual.qtd += 1;
            semCadastro.set(k, atual);
            continue;
          }
          registros.push({ ...r, transportadora: transp.nome, cnpj_transportadora: normalizarCnpj(transp.cnpj) || r.cnpj_transportadora });
        } catch (e) {
          falhas.push(e.message || `${f.name}: XML inválido`);
        }
      }
      setLido({ registros, falhas, semCadastro: [...semCadastro.values()], duplicadosNoLote });
      setProgresso('');
      if (!registros.length) setErro('Nenhum CT-e válido com transportadora cadastrada (por CNPJ) foi encontrado.');
    } catch (e) {
      setErro(e.message || 'Erro ao ler os XMLs.');
    } finally {
      setLendo(false);
    }
  }

  async function importar() {
    if (!lido?.registros?.length) return;
    setImportando(true);
    setErro('');
    const porMes = new Map();
    lido.registros.forEach((r) => {
      if (!/^\d{4}-\d{2}$/.test(r.competencia || '')) return;
      if (!porMes.has(r.competencia)) porMes.set(r.competencia, []);
      porMes.get(r.competencia).push(r);
    });
    const meses = [...porMes.keys()].sort();
    const linhas = [];
    try {
      for (let i = 0; i < meses.length; i += 1) {
        const mes = meses[i];
        setProgresso(`Importando ${mes} (${i + 1}/${meses.length})...`);
        const r = await importarRealizadoMensalEnxuto({
          competencia: mes,
          arquivoOrigem: `XML em massa (Ferramentas) - ${arquivos.length} arquivos`,
          registros: porMes.get(mes),
          modo: 'complementar',
          onProgress: (ev) => { if (ev?.mensagem) setProgresso(`${mes}: ${ev.mensagem}`); },
        });
        linhas.push({ mes, lidos: porMes.get(mes).length, novos: r.complementar?.novos ?? porMes.get(mes).length, jaNaBase: r.complementar?.jaNaBase ?? 0 });
      }
      setResultado(linhas);
      setProgresso('');
    } catch (e) {
      setResultado(linhas);
      setErro(`${e.message || 'Erro ao importar.'}${linhas.length ? ' Competências anteriores já foram gravadas.' : ''}`);
    } finally {
      setImportando(false);
    }
  }

  const ocupado = lendo || importando;
  return (
    <div style={{ padding: 20, display: 'grid', gap: 12 }}>
      <div style={{ fontSize: 13, color: 'var(--muted)' }}>
        Selecione vários XMLs de CT-e (ou uma pasta). A transportadora é identificada pelo CNPJ do emitente do XML e só entram CT-es que ainda não estão na base.
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <label>Vários XMLs<br /><input type="file" accept=".xml,text/xml,application/xml" multiple disabled={ocupado} onChange={(e) => selecionar(e.target.files)} /></label>
        <label>Pasta inteira<br /><input type="file" multiple webkitdirectory="" directory="" disabled={ocupado} onChange={(e) => selecionar(e.target.files)} /></label>
      </div>
      {arquivos.length ? <div style={{ fontSize: 13 }}>{fmt(arquivos.length)} XML(s) selecionado(s).</div> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="secondary" type="button" onClick={ler} disabled={ocupado || !arquivos.length}>{lendo ? 'Lendo...' : 'Ler e conferir'}</button>
        <button className="primary" type="button" onClick={importar} disabled={ocupado || !lido?.registros?.length}>{importando ? 'Importando...' : `Importar ${fmt(lido?.registros?.length)} CT-e(s)`}</button>
      </div>
      {progresso ? <div style={{ fontSize: 13 }}>{progresso}</div> : null}
      {erro ? <div style={{ fontSize: 13, color: '#b91c1c' }}>{erro}</div> : null}

      {lido ? (
        <div style={{ fontSize: 13, display: 'grid', gap: 6 }}>
          <div><strong>{fmt(lido.registros.length)}</strong> CT-e(s) prontos para importar{resumoMeses.length ? ` — ${resumoMeses.map(([m, q]) => `${m}: ${fmt(q)}`).join(' · ')}` : ''}.</div>
          {lido.duplicadosNoLote ? <div>{fmt(lido.duplicadosNoLote)} repetido(s) no próprio lote (ignorados).</div> : null}
          {lido.semCadastro.length ? (
            <div style={{ color: '#b45309' }}>
              CNPJ sem transportadora cadastrada (ignorados — cadastre a transportadora com o CNPJ e envie de novo):
              <ul style={{ margin: '4px 0 0 18px' }}>
                {lido.semCadastro.map((s) => <li key={s.cnpj}>{formatarCnpj(s.cnpj)} — {s.nome || 's/ nome'} ({fmt(s.qtd)} XML)</li>)}
              </ul>
            </div>
          ) : null}
          {lido.falhas.length ? (
            <details><summary style={{ color: '#b91c1c' }}>{fmt(lido.falhas.length)} arquivo(s) inválido(s)</summary>
              <ul style={{ margin: '4px 0 0 18px' }}>{lido.falhas.slice(0, 50).map((f) => <li key={f}>{f}</li>)}</ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {resultado ? (
        <div style={{ fontSize: 13 }}>
          <strong>Resultado</strong>
          <ul style={{ margin: '4px 0 0 18px' }}>
            {resultado.map((l) => <li key={l.mes}>{l.mes}: {fmt(l.novos)} novo(s), {fmt(l.jaNaBase)} já estavam na base</li>)}
          </ul>
          <div style={{ marginTop: 6, color: 'var(--muted)' }}>Para entrar nas faturas, reaudite/resimule a fatura na Auditoria.</div>
        </div>
      ) : null}
    </div>
  );
}
