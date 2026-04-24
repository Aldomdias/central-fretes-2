import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';

const ORIGENS_FIXAS = {
  ITAJAI: { uf: 'SC', ibge: '4208203' },
  'ITAJAÍ': { uf: 'SC', ibge: '4208203' },
  CURITIBA: { uf: 'PR', ibge: '4106902' },
  BARUERI: { uf: 'SP', ibge: '3505708' },
  CONTAGEM: { uf: 'MG', ibge: '3118601' },
  SERRA: { uf: 'ES', ibge: '3205002' },
};

const FAIXAS_B2B = [
  { faixa: '0 a 20 kg', min: 0, max: 20 },
  { faixa: '20 a 30 kg', min: 20, max: 30 },
  { faixa: '30 a 50 kg', min: 30, max: 50 },
  { faixa: '50 a 70 kg', min: 50, max: 70 },
  { faixa: '70 a 100 kg', min: 70, max: 100 },
  { faixa: '100 a 150 kg', min: 100, max: 150 },
  { faixa: '150 a 200 kg', min: 150, max: 200 },
  { faixa: '200 a 300 kg', min: 200, max: 300 },
  { faixa: 'Acima de 300 kg (KG excedente)', min: 300, max: 999999999 },
];

function limpar(v) {
  return String(v ?? '').trim();
}

function normalizar(v) {
  return limpar(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
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
  baixarWorkbook('Rotas-modelo-template.xlsx', [
    {
      name: 'Rotas',
      rows: [
        { 'IBGE DESTINO': '4106902', 'CIDADE DE DESTINO': 'Curitiba', 'UF DESTINO': 'PR', 'CEP INICIAL': '', 'CEP FINAL': '', PRAZO: 1, 'REGIÃO': 'CAPITAL' },
        { 'IBGE DESTINO': '4106902', 'CIDADE DE DESTINO': 'Curitiba', 'UF DESTINO': 'PR', 'CEP INICIAL': '', 'CEP FINAL': '', PRAZO: 2, 'REGIÃO': 'INTERIOR 1' },
      ],
    },
  ]);
}

function montarLinhaFrete(ufDestino, faixaPeso, valor, adValorem) {
  return {
    'UF DESTINO': ufDestino,
    'FAIXA PESO': faixaPeso,
    'CAPITAL Frete kg (R$)': valor,
    'CAPITAL Ad Valorem(%)': adValorem,
    'INTERIOR 1 Frete kg (R$)': '',
    'INTERIOR 1 Ad Valorem(%)': '',
    'INTERIOR 2 Frete kg (R$)': '',
    'INTERIOR 2 Ad Valorem(%)': '',
    'INTERIOR 3 Frete kg (R$)': '',
    'INTERIOR 3 Ad Valorem(%)': '',
    'INTERIOR 4 Frete kg (R$)': '',
    'INTERIOR 4 Ad Valorem(%)': '',
    'INTERIOR 5 Frete kg (R$)': '',
    'INTERIOR 5 Ad Valorem(%)': '',
    'INTERIOR 6 Frete kg (R$)': '',
    'INTERIOR 6 Ad Valorem(%)': '',
    'INTERIOR 7 Frete kg (R$)': '',
    'INTERIOR 7 Ad Valorem(%)': '',
    'INTERIOR 8 Frete kg (R$)': '',
    'INTERIOR 8 Ad Valorem(%)': '',
    'INTERIOR 9 Frete kg (R$)': '',
    'INTERIOR 9 Ad Valorem(%)': '',
  };
}

function baixarModeloTemplateFretes() {
  baixarWorkbook('Fretes-modelo-template.xlsx', [
    {
      name: 'Fretes',
      rows: [
        montarLinhaFrete('PR', '0 a 20 kg', 80, 0.03),
        montarLinhaFrete('PR', 'Acima de 300 kg (KG excedente)', 0.95, 0.03),
      ],
    },
  ]);
}

function parseHeader(rows) {
  return (rows[0] || []).map((v) => normalizar(v));
}

async function lerPrimeiraAba(file) {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

export default function FormatacaoPage({ transportadoras = [] }) {
  const [modoEntrada, setModoEntrada] = useState('escolha');
  const [arquivoRotas, setArquivoRotas] = useState(null);
  const [arquivoFretes, setArquivoFretes] = useState(null);
  const [mensagem, setMensagem] = useState('');
  const inputImportarRotas = useRef(null);
  const inputImportarFretes = useRef(null);

  const [dadosGerais, setDadosGerais] = useState({
    transportadora: transportadoras[0]?.nome || '',
    origemNome: '',
    ufOrigem: '',
    ibgeOrigem: '',
    canal: 'ATACADO',
    metodoEnvio: 'Normal',
    regraCalculo: 'Maior valor',
  });

  const [rotas, setRotas] = useState([]);
  const [fretes, setFretes] = useState([]);

  const faixas = useMemo(() => FAIXAS_B2B, []);

  function atualizarOrigem(valor) {
    const fixa = ORIGENS_FIXAS[normalizar(valor)];
    setDadosGerais((prev) => ({
      ...prev,
      origemNome: valor,
      ufOrigem: fixa?.uf || '',
      ibgeOrigem: fixa?.ibge || '',
    }));
  }

  async function importarTemplateAutomatico() {
    if (!arquivoRotas || !arquivoFretes) {
      setMensagem('Selecione os dois arquivos do template.');
      return;
    }
    if (!dadosGerais.origemNome || !dadosGerais.ibgeOrigem) {
      setMensagem('Preencha a origem antes de importar o template.');
      return;
    }

    try {
      const rowsRotas = await lerPrimeiraAba(arquivoRotas);
      const rowsFretes = await lerPrimeiraAba(arquivoFretes);

      const hRot = parseHeader(rowsRotas);
      const idxIbgeDestino = hRot.findIndex((h) => h === 'IBGE DESTINO');
      const idxPrazo = hRot.findIndex((h) => h.startsWith('PRAZO'));
      const idxRegiao = hRot.findIndex((h) => h.startsWith('REGIAO') || h.startsWith('REGIÃO'));

      const novasRotas = [];
      for (let i = 1; i < rowsRotas.length; i++) {
        const row = rowsRotas[i] || [];
        const ibgeDestino = limpar(row[idxIbgeDestino]);
        if (!ibgeDestino) continue;
        novasRotas.push({
          id: `r${i}`,
          ibgeDestino,
          prazo: limpar(row[idxPrazo]),
          cotacaoBase: limpar(row[idxRegiao]) || 'CAPITAL',
        });
      }

      const hFrete = parseHeader(rowsFretes);
      const idxUfDestino = hFrete.findIndex((h) => h === 'UF DESTINO');
      const idxFaixa = hFrete.findIndex((h) => h === 'FAIXA PESO');

      const novasFretes = [];
      for (let i = 1; i < rowsFretes.length; i++) {
        const row = rowsFretes[i] || [];
        const ufDestino = limpar(row[idxUfDestino]);
        const faixaPeso = limpar(row[idxFaixa]);
        if (!ufDestino || !faixaPeso) continue;
        novasFretes.push({
          id: `f${i}`,
          ufDestino,
          faixaPeso,
        });
      }

      setRotas(novasRotas);
      setFretes(novasFretes);
      setModoEntrada('manual');
      setMensagem('Template importado. Agora você está no modelo criado na ferramenta.');
    } catch (error) {
      setMensagem(`Erro ao importar template: ${error.message}`);
    }
  }

  function usarModeloCriado() {
    setModoEntrada('manual');
    setMensagem('Entrou no modelo criado na ferramenta.');
  }

  function exportarModeloRotas() {
    baixarWorkbook('modelo-rotas.xlsx', [
      {
        name: 'Rotas',
        rows: rotas.length
          ? rotas.map((r) => ({
              'IBGE DESTINO': r.ibgeDestino || '',
              PRAZO: r.prazo || '',
              'COTAÇÃO BASE': r.cotacaoBase || '',
            }))
          : [{ 'IBGE DESTINO': '', PRAZO: '', 'COTAÇÃO BASE': '' }],
      },
    ]);
  }

  function exportarModeloFretes() {
    baixarWorkbook('modelo-fretes.xlsx', [
      {
        name: 'Fretes',
        rows: fretes.length
          ? fretes.map((f) => ({
              'UF DESTINO': f.ufDestino || '',
              'FAIXA PESO': f.faixaPeso || '',
              'CAPITAL Frete kg (R$)': '',
              'CAPITAL Ad Valorem(%)': '',
              'INTERIOR 1 Frete kg (R$)': '',
              'INTERIOR 1 Ad Valorem(%)': '',
              'INTERIOR 2 Frete kg (R$)': '',
              'INTERIOR 2 Ad Valorem(%)': '',
              'INTERIOR 3 Frete kg (R$)': '',
              'INTERIOR 3 Ad Valorem(%)': '',
              'INTERIOR 4 Frete kg (R$)': '',
              'INTERIOR 4 Ad Valorem(%)': '',
              'INTERIOR 5 Frete kg (R$)': '',
              'INTERIOR 5 Ad Valorem(%)': '',
              'INTERIOR 6 Frete kg (R$)': '',
              'INTERIOR 6 Ad Valorem(%)': '',
              'INTERIOR 7 Frete kg (R$)': '',
              'INTERIOR 7 Ad Valorem(%)': '',
              'INTERIOR 8 Frete kg (R$)': '',
              'INTERIOR 8 Ad Valorem(%)': '',
              'INTERIOR 9 Frete kg (R$)': '',
              'INTERIOR 9 Ad Valorem(%)': '',
            }))
          : [montarLinhaFrete('', '', '', '')],
      },
    ]);
  }

  async function importarRotasManual(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const rows = await lerPrimeiraAba(file);
    const header = parseHeader(rows);
    const idxIbge = header.findIndex((h) => h === 'IBGE DESTINO');
    const idxPrazo = header.findIndex((h) => h.startsWith('PRAZO'));
    const idxCot = header.findIndex((h) => h === 'COTAÇÃO BASE' || h === 'COTACAO BASE');
    const novas = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const ibgeDestino = limpar(row[idxIbge]);
      if (!ibgeDestino) continue;
      novas.push({
        id: `mr${i}`,
        ibgeDestino,
        prazo: limpar(row[idxPrazo]),
        cotacaoBase: limpar(row[idxCot]) || 'CAPITAL',
      });
    }
    setRotas(novas);
    setMensagem(`${novas.length} rotas importadas no modelo criado.`);
    event.target.value = '';
  }

  async function importarFretesManual(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const rows = await lerPrimeiraAba(file);
    const header = parseHeader(rows);
    const idxUf = header.findIndex((h) => h === 'UF DESTINO');
    const idxFaixa = header.findIndex((h) => h === 'FAIXA PESO');
    const novos = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const ufDestino = limpar(row[idxUf]);
      const faixaPeso = limpar(row[idxFaixa]);
      if (!ufDestino && !faixaPeso) continue;
      novos.push({ id: `mf${i}`, ufDestino, faixaPeso });
    }
    setFretes(novos);
    setMensagem(`${novos.length} fretes importados no modelo criado.`);
    event.target.value = '';
  }

  if (modoEntrada === 'escolha') {
    return (
      <div className="pagina">
        <div className="cabecalho-pagina">
          <div>
            <h2>Formatação de Tabelas</h2>
            <p>Defina a origem antes do template padrão.</p>
          </div>
        </div>

        {mensagem ? <section className="card-padrao" style={{ marginBottom: 12 }}>{mensagem}</section> : null}

        <section className="card-padrao">
          <div className="card-topo"><h3>Origem da tabela</h3></div>
          <div className="form-grid">
            <label>
              Origem
              <input value={dadosGerais.origemNome} onChange={(e) => atualizarOrigem(e.target.value)} placeholder="Ex.: Serra" />
            </label>
            <label>
              UF origem
              <input value={dadosGerais.ufOrigem} readOnly />
            </label>
            <label>
              IBGE origem
              <input value={dadosGerais.ibgeOrigem} readOnly />
            </label>
          </div>
        </section>

        <section className="card-padrao">
          <div className="card-topo"><h3>Enviar template padrão</h3></div>
          <p>Use exatamente estes modelos. A origem vem da tela.</p>
          <div className="acoes-formulario">
            <button className="botao-secundario" type="button" onClick={baixarModeloTemplateRotas}>Baixar modelo de Rotas</button>
            <button className="botao-secundario" type="button" onClick={baixarModeloTemplateFretes}>Baixar modelo de Fretes</button>
          </div>
          <div className="form-grid">
            <label>
              Arquivo de Rotas
              <input type="file" accept=".xlsx,.xls,.ods" onChange={(e) => setArquivoRotas(e.target.files?.[0] || null)} />
            </label>
            <label>
              Arquivo de Fretes
              <input type="file" accept=".xlsx,.xls,.ods" onChange={(e) => setArquivoFretes(e.target.files?.[0] || null)} />
            </label>
          </div>
          <div className="acoes-formulario">
            <button className="botao-primario" type="button" disabled={!arquivoRotas || !arquivoFretes} onClick={importarTemplateAutomatico}>
              Importar e formatar automaticamente
            </button>
            <button className="botao-secundario" type="button" onClick={usarModeloCriado}>
              Usar modelo criado na ferramenta
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="pagina">
      <div className="cabecalho-pagina">
        <div>
          <h2>Formatação de Tabelas</h2>
          <p>Agora você está no modelo criado na ferramenta.</p>
        </div>
        <div className="acoes-formulario">
          <button className="botao-secundario" type="button" onClick={() => setModoEntrada('escolha')}>
            Voltar à escolha inicial
          </button>
        </div>
      </div>

      {mensagem ? <section className="card-padrao" style={{ marginBottom: 12 }}>{mensagem}</section> : null}

      <section className="card-padrao">
        <div className="card-topo"><h3>Dados gerais</h3></div>
        <div className="form-grid">
          <label>
            Transportadora existente
            <select value={dadosGerais.transportadora} onChange={(e) => setDadosGerais((p) => ({ ...p, transportadora: e.target.value }))}>
              {transportadoras.map((t) => <option key={t.id} value={t.nome}>{t.nome}</option>)}
            </select>
          </label>
          <label>
            Origem
            <input value={dadosGerais.origemNome} onChange={(e) => atualizarOrigem(e.target.value)} />
          </label>
          <label>
            UF origem
            <input value={dadosGerais.ufOrigem} readOnly />
          </label>
          <label>
            IBGE origem
            <input value={dadosGerais.ibgeOrigem} readOnly />
          </label>
        </div>
      </section>

      <section className="card-padrao">
        <div className="card-topo">
          <h3>Rotas</h3>
          <div className="acoes-formulario">
            <input ref={inputImportarRotas} type="file" accept=".xlsx,.xls,.ods" style={{ display: 'none' }} onChange={importarRotasManual} />
            <button className="botao-secundario" type="button" onClick={exportarModeloRotas}>Exportar modelo</button>
            <button className="botao-secundario" type="button" onClick={() => inputImportarRotas.current?.click()}>Importar rotas</button>
          </div>
        </div>
        <p>{rotas.length} rotas carregadas.</p>
      </section>

      <section className="card-padrao">
        <div className="card-topo">
          <h3>Fretes</h3>
          <div className="acoes-formulario">
            <input ref={inputImportarFretes} type="file" accept=".xlsx,.xls,.ods" style={{ display: 'none' }} onChange={importarFretesManual} />
            <button className="botao-secundario" type="button" onClick={exportarModeloFretes}>Exportar modelo</button>
            <button className="botao-secundario" type="button" onClick={() => inputImportarFretes.current?.click()}>Importar fretes</button>
          </div>
        </div>
        <p>{fretes.length} fretes carregados.</p>
      </section>
    </div>
  );
}
