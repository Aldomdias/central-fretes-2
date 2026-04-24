import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';

const FALLBACK_ORIGENS = {
  ITAJAI: { uf: 'SC', ibge: '4208203' },
  'ITAJAÍ': { uf: 'SC', ibge: '4208203' },
  CURITIBA: { uf: 'PR', ibge: '4106902' },
  BARUERI: { uf: 'SP', ibge: '3505708' },
  CONTAGEM: { uf: 'MG', ibge: '3118601' },
  SERRA: { uf: 'ES', ibge: '3205002' },
};

const COTACOES_BASE = ['CAPITAL', 'INTERIOR 1', 'INTERIOR 2', 'INTERIOR 3', 'INTERIOR 4'];

function limpar(v) {
  return String(v ?? '').trim();
}

function normalizar(v) {
  return limpar(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

function ufPorIbge(ibge) {
  const c = String(ibge || '').replace(/\D/g, '').slice(0, 2);
  const mapa = {
    '11':'RO','12':'AC','13':'AM','14':'RR','15':'PA','16':'AP','17':'TO','21':'MA','22':'PI','23':'CE','24':'RN','25':'PB','26':'PE','27':'AL','28':'SE','29':'BA','31':'MG','32':'ES','33':'RJ','35':'SP','41':'PR','42':'SC','43':'RS','50':'MS','51':'MT','52':'GO','53':'DF'
  };
  return mapa[c] || '';
}

function montarCotacaoFinal(origem, ibgeDestino, cotacaoBase) {
  return [limpar(origem), ufPorIbge(ibgeDestino), limpar(cotacaoBase).toUpperCase()].filter(Boolean).join(' - ');
}

function baixarWorkbook(nome, sheets) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(({ name, rows }) => {
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  XLSX.writeFile(wb, nome);
}

function baixarModeloTemplateRotas() {
  baixarWorkbook('Rotas-modelo-template.xlsx', [{
    name: 'Rotas',
    rows: [
      { 'IBGE ORIGEM': '4106902', 'CIDADE DE ORIGEM': 'Curitiba', 'UF ORIGEM': 'PR', 'IBGE DESTINO': '4106902', 'CIDADE DE DESTINO': 'Curitiba', 'UF DESTINO': 'PR', 'CEP INICIAL': '', 'CEP FINAL': '', PRAZO: 1, 'REGIÃO': 'CAPITAL' },
      { 'IBGE ORIGEM': '4106902', 'CIDADE DE ORIGEM': 'Curitiba', 'UF ORIGEM': 'PR', 'IBGE DESTINO': '4106902', 'CIDADE DE DESTINO': 'Curitiba', 'UF DESTINO': 'PR', 'CEP INICIAL': '', 'CEP FINAL': '', PRAZO: 2, 'REGIÃO': 'INTERIOR 1' },
    ],
  }]);
}

function baixarModeloTemplateFretes() {
  baixarWorkbook('Fretes-modelo-template.xlsx', [{
    name: 'Fretes',
    rows: [
      { 'CIDADE DE ORIGEM': 'Curitiba', 'UF ORIGEM': 'PR', 'UF DESTINO': 'PR', 'FAIXA PESO': '0 a 10 kg', 'CAPITAL Frete kg (R$)': 80, 'CAPITAL Ad Valorem(%)': 0.03, 'INTERIOR 1 Frete kg (R$)': 80, 'INTERIOR 1 Ad Valorem(%)': 0.03 },
      { 'CIDADE DE ORIGEM': 'Curitiba', 'UF ORIGEM': 'PR', 'UF DESTINO': 'PR', 'FAIXA PESO': 'Acima de 300 kg (KG excedente)', 'CAPITAL Frete kg (R$)': 0.95, 'CAPITAL Ad Valorem(%)': 0.03, 'INTERIOR 1 Frete kg (R$)': 0.95, 'INTERIOR 1 Ad Valorem(%)': 0.03 },
    ],
  }]);
}

async function lerPrimeiraAba(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

export default function FormatacaoPage({ store, transportadoras = [] }) {
  const inputImportarRotas = useRef(null);
  const inputImportarFretes = useRef(null);
  const [modoEntrada, setModoEntrada] = useState('escolha');
  const [arquivoRotas, setArquivoRotas] = useState(null);
  const [arquivoFretes, setArquivoFretes] = useState(null);
  const [dadosGerais, setDadosGerais] = useState({
    transportadora: transportadoras[0]?.nome || '',
    origemNome: '',
    ufOrigem: '',
    ibgeOrigem: '',
    canal: 'ATACADO',
    metodoEnvio: 'Normal',
    regraCalculo: 'Maior valor',
    vigenciaInicial: new Date().toISOString().slice(0,10),
    vigenciaFinal: new Date(new Date().setFullYear(new Date().getFullYear()+2)).toISOString().slice(0,10),
  });
  const [rotas, setRotas] = useState([]);
  const [fretes, setFretes] = useState([]);
  const [msg, setMsg] = useState('');

  async function atualizarOrigem(valor) {
    const fallback = FALLBACK_ORIGENS[normalizar(valor)];
    setDadosGerais((prev) => ({
      ...prev,
      origemNome: valor,
      ufOrigem: fallback?.uf || prev.ufOrigem || '',
      ibgeOrigem: fallback?.ibge || prev.ibgeOrigem || '',
    }));
    setRotas((prev) => prev.map((r) => ({ ...r, cotacaoFinal: montarCotacaoFinal(valor, r.ibgeDestino, r.cotacaoBase) })));
  }

  async function importarTemplate() {
    if (!arquivoRotas || !arquivoFretes) return;
    setMsg('Template recebido. Você pode continuar a validação e ajustes.');
    setModoEntrada('manual');
  }

  async function importarRotas(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const rows = await lerPrimeiraAba(file);
    const header = (rows[0] || []).map(normalizar);
    const idxIbge = header.findIndex((h) => h === 'IBGE DESTINO');
    const idxPrazo = header.findIndex((h) => h.startsWith('PRAZO'));
    const idxCot = header.findIndex((h) => h.startsWith('REGIAO') || h.startsWith('REGIÃO') || h === 'COTAÇÃO BASE' || h === 'COTACAO BASE');
    const novas = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const ibgeDestino = limpar(row[idxIbge]);
      if (!ibgeDestino) continue;
      const cotacaoBase = limpar(row[idxCot]) || 'CAPITAL';
      novas.push({
        id: `r${i}`,
        ibgeDestino,
        prazo: limpar(row[idxPrazo]),
        cotacaoBase,
        cotacaoFinal: montarCotacaoFinal(dadosGerais.origemNome, ibgeDestino, cotacaoBase),
      });
    }
    setRotas(novas);
    event.target.value = '';
  }

  function exportarModeloRotas() {
    baixarWorkbook('modelo-rotas.xlsx', [{
      name: 'Rotas',
      rows: rotas.length ? rotas.map((r) => ({ 'IBGE DESTINO': r.ibgeDestino, PRAZO: r.prazo, 'COTAÇÃO BASE': r.cotacaoBase })) : [{ 'IBGE DESTINO': '', PRAZO: '', 'COTAÇÃO BASE': '' }],
    }]);
  }

  function exportarModeloFretes() {
    baixarWorkbook('modelo-fretes.xlsx', [{
      name: 'Fretes',
      rows: fretes.length ? fretes.map((f) => ({ 'ROTA DO FRETE': f.cotacaoFinal, 'FAIXA PESO': f.faixaPeso || '', 'PESO MÍNIMO': f.pesoInicial || '', 'PESO LIMITE': f.pesoFinal || '', 'EXCESSO DE PESO': f.excessoPeso || '', 'TAXA APLICADA': f.taxaAplicada || '', 'FRETE PERCENTUAL': f.fretePercentual || '' })) : [{ 'ROTA DO FRETE': '', 'FAIXA PESO': '', 'PESO MÍNIMO': '', 'PESO LIMITE': '', 'EXCESSO DE PESO': '', 'TAXA APLICADA': '', 'FRETE PERCENTUAL': '' }],
    }]);
  }

  if (modoEntrada === 'escolha') {
    return (
      <div className="pagina">
        <div className="cabecalho-pagina">
          <div>
            <h2>Formatação de Tabelas</h2>
            <p>Escolha como deseja começar.</p>
          </div>
        </div>

        <section className="card-padrao">
          <div className="card-topo"><h3>Enviar template padrão</h3></div>
          <p>Use exatamente estes modelos para a importação automática.</p>
          <div className="acoes-formulario">
            <button className="botao-secundario" onClick={baixarModeloTemplateRotas}>Baixar modelo de Rotas</button>
            <button className="botao-secundario" onClick={baixarModeloTemplateFretes}>Baixar modelo de Fretes</button>
          </div>
          <div className="form-grid">
            <label>Arquivo de Rotas<input type="file" accept=".xlsx,.xls,.ods" onChange={(e) => setArquivoRotas(e.target.files?.[0] || null)} /></label>
            <label>Arquivo de Fretes<input type="file" accept=".xlsx,.xls,.ods" onChange={(e) => setArquivoFretes(e.target.files?.[0] || null)} /></label>
          </div>
          <div className="acoes-formulario">
            <button className="botao-primario" onClick={importarTemplate} disabled={!arquivoRotas || !arquivoFretes}>Importar e formatar automaticamente</button>
            <button className="botao-secundario" onClick={() => setModoEntrada('manual')}>Usar modelo criado na ferramenta</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="pagina">
      <div className="cabecalho-pagina">
        <div><h2>Formatação de Tabelas</h2><p>Fluxo manual.</p></div>
        <div className="acoes-formulario">
          <button className="botao-secundario" onClick={() => setModoEntrada('escolha')}>Voltar à escolha inicial</button>
        </div>
      </div>

      {msg ? <div className="card-padrao" style={{ marginBottom: 12 }}>{msg}</div> : null}

      <section className="card-padrao">
        <div className="card-topo"><h3>Dados gerais</h3></div>
        <div className="form-grid">
          <label>Transportadora existente
            <select value={dadosGerais.transportadora} onChange={(e) => setDadosGerais((p) => ({ ...p, transportadora: e.target.value }))}>
              {transportadoras.map((t) => <option key={t.id} value={t.nome}>{t.nome}</option>)}
            </select>
          </label>
          <label>Origem<input value={dadosGerais.origemNome} onChange={(e) => atualizarOrigem(e.target.value)} /></label>
          <label>UF origem<input value={dadosGerais.ufOrigem} readOnly /></label>
          <label>IBGE origem<input value={dadosGerais.ibgeOrigem} readOnly /></label>
        </div>
      </section>

      <section className="card-padrao">
        <div className="card-topo">
          <h3>Rotas</h3>
          <div className="acoes-formulario">
            <input ref={inputImportarRotas} type="file" accept=".xlsx,.xls,.ods" style={{ display: 'none' }} onChange={importarRotas} />
            <button className="botao-secundario" onClick={exportarModeloRotas}>Exportar modelo</button>
            <button className="botao-secundario" onClick={() => inputImportarRotas.current?.click()}>Importar rotas</button>
          </div>
        </div>
      </section>

      <section className="card-padrao">
        <div className="card-topo">
          <h3>Fretes</h3>
          <div className="acoes-formulario">
            <input ref={inputImportarFretes} type="file" accept=".xlsx,.xls,.ods" style={{ display: 'none' }} />
            <button className="botao-secundario" onClick={exportarModeloFretes}>Exportar modelo</button>
          </div>
        </div>
      </section>
    </div>
  );
}
